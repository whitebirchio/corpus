#!/usr/bin/env python3
"""Corpus Garmin sync — pulls daily wellness, activities and weigh-ins from
Garmin Connect and posts the raw JSON to the Corpus worker's /garmin/ingest
endpoint. All mapping and reconciliation happen server-side in @corpus/core;
this script's only job is speaking Garmin's (unofficial, reverse-engineered)
protocol.

Modes:
  bootstrap   First-time interactive login — run LOCALLY, never in CI. Garmin
              credentials are prompted (or read from GARMIN_EMAIL /
              GARMIN_PASSWORD env vars) and used once; only the resulting
              session token blob is uploaded to the worker's token store.
              Handles an MFA prompt if the account requires one.
  pull        Unattended sync (nightly GitHub Actions). Loads the token blob
              from the worker store, fetches the trailing window, posts it,
              and saves the (possibly refreshed) tokens back. With --dry-run,
              prints the payload instead of posting it and leaves the stored
              tokens untouched. With --weight-since YYYY-MM-DD, instead
              backfills every weigh-in from that date to today (one-time
              history import; weigh-ins only, in 90-day chunks).

Environment (both modes):
  CORPUS_BASE_URL        e.g. https://corpus-mcp.whitebirch.workers.dev
  CORPUS_INGEST_SECRET   shared secret, must match the worker's
                         GARMIN_INGEST_SECRET
  CORPUS_USER_EMAIL      which Corpus user the data belongs to
  CORPUS_TIMEZONE        for computing "today" (default America/New_York)

A failed run exits non-zero, which makes GitHub Actions send a failure email —
sync breakage is loud, never silent. The conversational check-in remains the
always-available fallback for data entry.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from garminconnect import Garmin

# Activity summary fields forwarded to the ingest endpoint. Everything else
# (GPS polylines, splits, HR time series) is dropped to keep payloads lean.
# Training-effect/load and running-dynamics fields have no first-class column
# server-side; they land in workout_sessions.extras (see import/garmin.ts).
ACTIVITY_FIELDS = [
    "activityId",
    "activityName",
    "activityType",
    "startTimeLocal",
    "startTimeGMT",
    "distance",
    "duration",
    "movingDuration",
    "elapsedDuration",
    "averageHR",
    "maxHR",
    "calories",
    "elevationGain",
    "averageSpeed",
    # training load / effect
    "aerobicTrainingEffect",
    "anaerobicTrainingEffect",
    "activityTrainingLoad",
    "trainingEffectLabel",
    # running dynamics
    "averageRunningCadenceInStepsPerMinute",
    "avgPower",
    "avgStrideLength",
    "avgGroundContactTime",
    "avgVerticalOscillation",
]


def first(data):
    """Both get_training_readiness and get_max_metrics return a single-element
    list wrapping the day's record; unwrap it (tolerating a bare dict or None)
    so the server always receives the object, never the list."""
    if isinstance(data, list):
        return data[0] if data else None
    return data or None


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name) or default
    if not value:
        sys.exit(f"Missing required environment variable {name}")
    return value


BASE_URL = env("CORPUS_BASE_URL").rstrip("/")
SECRET = env("CORPUS_INGEST_SECRET")
USER_EMAIL = env("CORPUS_USER_EMAIL")
TIMEZONE = os.getenv("CORPUS_TIMEZONE", "America/New_York")

AUTH_HEADERS = {"Authorization": f"Bearer {SECRET}"}


def get_stored_tokens() -> str | None:
    r = requests.get(
        f"{BASE_URL}/garmin/tokens", params={"user": USER_EMAIL}, headers=AUTH_HEADERS, timeout=30
    )
    r.raise_for_status()
    return r.json().get("tokens")


def put_stored_tokens(blob: str) -> None:
    r = requests.put(
        f"{BASE_URL}/garmin/tokens",
        params={"user": USER_EMAIL},
        headers=AUTH_HEADERS,
        json={"tokens": blob},
        timeout=30,
    )
    r.raise_for_status()


def bootstrap() -> None:
    email = os.getenv("GARMIN_EMAIL") or input("Garmin account email: ")
    password = os.getenv("GARMIN_PASSWORD") or getpass.getpass("Garmin account password: ")
    garmin = Garmin(email=email, password=password, prompt_mfa=lambda: input("Garmin MFA code: "))
    garmin.login()
    put_stored_tokens(garmin.client.dumps())
    print(f"Garmin tokens stored for {USER_EMAIL}. Nightly pulls can run unattended now.")


def fetch_weigh_ins(garmin: Garmin, start: str, end: str) -> dict:
    """Every weigh-in Garmin has filed under [start, end], as the ingest
    payload's `weighIns` block. get_weigh_ins (includeAll) groups readings by
    day; the per-day `allWeightMetrics` lists are flattened, untouched — all
    mapping happens server-side. The window travels with the entries because
    the server deletes rows in it that Garmin no longer returns, so an
    unexpected response shape raises (the caller then omits `weighIns`)
    rather than ever being sent as "no weigh-ins"."""
    data = garmin.get_weigh_ins(start, end)
    summaries = data.get("dailyWeightSummaries") if isinstance(data, dict) else None
    if not isinstance(summaries, list):
        raise ValueError(f"unexpected get_weigh_ins response: {str(data)[:200]}")
    entries = [m for day in summaries for m in (day.get("allWeightMetrics") or [])]
    return {"start": start, "end": end, "entries": entries}


def login_from_store() -> Garmin:
    blob = get_stored_tokens()
    if not blob:
        sys.exit("No stored Garmin tokens — run `python sync.py bootstrap` locally first.")

    garmin = Garmin()
    garmin.login(tokenstore=blob)  # JSON token blob; proactively refreshes if stale
    return garmin


def post_ingest(payload: dict) -> dict:
    r = requests.post(f"{BASE_URL}/garmin/ingest", headers=AUTH_HEADERS, json=payload, timeout=120)
    if not r.ok:
        sys.exit(f"Ingest failed ({r.status_code}): {r.text}")
    return r.json()


def today_local() -> date:
    return datetime.now(ZoneInfo(TIMEZONE)).date()


# Backfill chunk size: small enough that one ingest stays well inside the
# Worker's CPU/subrequest limits and any Garmin range cap.
BACKFILL_CHUNK_DAYS = 90


def backfill_weigh_ins(since: date, dry_run: bool = False) -> None:
    """One-time history import: every weigh-in from `since` to today, posted
    as weigh-in-only payloads in contiguous chunks. Each chunk is idempotent
    server-side, so a re-run (or a resume from a failed chunk) is safe. Unlike
    the scheduled pull, a failed fetch is fatal here — it's a manual run, and
    the exit message says exactly where to resume."""
    today = today_local()
    if since > today:
        sys.exit(f"--weight-since {since} is in the future")

    garmin = login_from_store()
    chunk_start = since
    while chunk_start <= today:
        chunk_end = min(chunk_start + timedelta(days=BACKFILL_CHUNK_DAYS - 1), today)
        a, b = chunk_start.isoformat(), chunk_end.isoformat()
        try:
            weigh_ins = fetch_weigh_ins(garmin, a, b)
        except Exception as e:  # noqa: BLE001
            sys.exit(f"Weigh-in fetch {a}..{b} failed: {e}\nResume with: pull --weight-since {a}")
        line = f"{a}..{b}: {len(weigh_ins['entries'])} weigh-ins"
        if not dry_run:
            payload = {"userEmail": USER_EMAIL, "days": [], "activities": [], "weighIns": weigh_ins}
            summary = post_ingest(payload).get("weighIns", {})
            line += (
                f" → upserted {len(summary.get('upserted', []))},"
                f" deleted {summary.get('deleted', 0)}, skipped {summary.get('skipped', 0)}"
            )
        print(line, flush=True)
        chunk_start = chunk_end + timedelta(days=1)
        if chunk_start <= today:
            time.sleep(1)  # be gentle with Garmin's unofficial API

    if not dry_run:
        put_stored_tokens(garmin.client.dumps())


def pull(days: int, dry_run: bool = False) -> None:
    garmin = login_from_store()

    today = today_local()
    day_payloads = []
    errors = []
    for offset in range(days):
        d = (today - timedelta(days=offset)).isoformat()
        entry: dict = {"date": d}
        try:
            entry["stats"] = garmin.get_stats(d)
        except Exception as e:  # noqa: BLE001 — a bad day shouldn't kill the run
            errors.append(f"stats {d}: {e}")
        try:
            sleep = garmin.get_sleep_data(d) or {}
            entry["sleep"] = sleep.get("dailySleepDTO")
        except Exception as e:  # noqa: BLE001
            errors.append(f"sleep {d}: {e}")
        try:
            hrv = garmin.get_hrv_data(d) or {}
            entry["hrv"] = hrv.get("hrvSummary")
        except Exception as e:  # noqa: BLE001
            errors.append(f"hrv {d}: {e}")
        # Training readiness and VO2 max are device-dependent — older watches
        # don't compute them and the endpoints 404. A miss is a warning, never
        # fatal; the field is simply omitted from the day.
        try:
            entry["trainingReadiness"] = first(garmin.get_training_readiness(d))
        except Exception as e:  # noqa: BLE001
            errors.append(f"training_readiness {d}: {e}")
        try:
            entry["maxMetrics"] = first(garmin.get_max_metrics(d))
        except Exception as e:  # noqa: BLE001
            errors.append(f"max_metrics {d}: {e}")
        day_payloads.append(entry)

    start = (today - timedelta(days=days - 1)).isoformat()
    try:
        raw_activities = garmin.get_activities_by_date(start, today.isoformat()) or []
    except Exception as e:  # noqa: BLE001
        errors.append(f"activities {start}..{today}: {e}")
        raw_activities = []
    activities = [{k: a.get(k) for k in ACTIVITY_FIELDS if k in a} for a in raw_activities]

    payload = {"userEmail": USER_EMAIL, "days": day_payloads, "activities": activities}
    # On failure the key is omitted, never sent empty: the server only
    # reconciles deletes for a window it knows was actually fetched.
    try:
        payload["weighIns"] = fetch_weigh_ins(garmin, start, today.isoformat())
    except Exception as e:  # noqa: BLE001
        errors.append(f"weigh_ins {start}..{today}: {e}")

    if dry_run:
        print(json.dumps(payload, indent=2, default=str))
    else:
        print(json.dumps(post_ingest(payload), indent=2))

        # Persist whatever got refreshed so the next run starts warm.
        put_stored_tokens(garmin.client.dumps())

    if errors:
        print("\nPer-day fetch warnings (data will self-heal on the next run):", file=sys.stderr)
        for line in errors:
            print(f"  - {line}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    sub.add_parser("bootstrap", help="Interactive first-time Garmin login (run locally)")
    p_pull = sub.add_parser("pull", help="Unattended sync of the trailing window")
    p_pull.add_argument("--days", type=int, default=7, help="Trailing days to pull (default 7)")
    p_pull.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the payload instead of posting it; tokens are not saved",
    )
    p_pull.add_argument(
        "--weight-since",
        type=date.fromisoformat,
        metavar="YYYY-MM-DD",
        help="One-time backfill: import every weigh-in from this date to today "
        "(weigh-ins only; --days is ignored)",
    )
    args = parser.parse_args()

    if args.mode == "bootstrap":
        bootstrap()
    elif args.weight_since:
        backfill_weigh_ins(args.weight_since, dry_run=args.dry_run)
    else:
        pull(max(1, args.days), dry_run=args.dry_run)


if __name__ == "__main__":
    main()
