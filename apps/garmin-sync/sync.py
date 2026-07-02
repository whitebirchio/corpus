#!/usr/bin/env python3
"""Corpus Garmin sync — pulls daily wellness + activities from Garmin Connect
and posts the raw JSON to the Corpus worker's /garmin/ingest endpoint. All
mapping and reconciliation happen server-side in @corpus/core; this script's
only job is speaking Garmin's (unofficial, reverse-engineered) protocol.

Modes:
  bootstrap   First-time interactive login — run LOCALLY, never in CI. Garmin
              credentials are prompted (or read from GARMIN_EMAIL /
              GARMIN_PASSWORD env vars) and used once; only the resulting
              session token blob is uploaded to the worker's token store.
              Handles an MFA prompt if the account requires one.
  pull        Unattended sync (nightly GitHub Actions). Loads the token blob
              from the worker store, fetches the trailing window, posts it,
              and saves the (possibly refreshed) tokens back.

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
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from garminconnect import Garmin

# Activity summary fields forwarded to the ingest endpoint. Everything else
# (GPS polylines, splits, HR time series) is dropped to keep payloads lean.
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
]


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


def pull(days: int) -> None:
    blob = get_stored_tokens()
    if not blob:
        sys.exit("No stored Garmin tokens — run `python sync.py bootstrap` locally first.")

    garmin = Garmin()
    garmin.login(tokenstore=blob)  # JSON token blob; proactively refreshes if stale

    today = datetime.now(ZoneInfo(TIMEZONE)).date()
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
        day_payloads.append(entry)

    start = (today - timedelta(days=days - 1)).isoformat()
    try:
        raw_activities = garmin.get_activities_by_date(start, today.isoformat()) or []
    except Exception as e:  # noqa: BLE001
        errors.append(f"activities {start}..{today}: {e}")
        raw_activities = []
    activities = [{k: a.get(k) for k in ACTIVITY_FIELDS if k in a} for a in raw_activities]

    r = requests.post(
        f"{BASE_URL}/garmin/ingest",
        headers=AUTH_HEADERS,
        json={"userEmail": USER_EMAIL, "days": day_payloads, "activities": activities},
        timeout=120,
    )
    if not r.ok:
        sys.exit(f"Ingest failed ({r.status_code}): {r.text}")
    print(json.dumps(r.json(), indent=2))

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
    args = parser.parse_args()

    if args.mode == "bootstrap":
        bootstrap()
    else:
        pull(max(1, args.days))


if __name__ == "__main__":
    main()
