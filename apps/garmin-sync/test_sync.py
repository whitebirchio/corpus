"""Tests for sync.py — stdlib only, so CI runs them without installing
garminconnect: `python3 apps/garmin-sync/test_sync.py`.

Each test runs the real script (`pull`, `--weight-since`, `--dry-run`) via
runpy against stubbed `garminconnect` and `requests` modules, records every
worker call, and asserts on what was sent. time.sleep is stubbed so retries
and backfill pacing don't slow the suite.
"""

from __future__ import annotations

import contextlib
import copy
import datetime as dt
import io
import os
import runpy
import sys
import time
import types
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

SCRIPT = str(Path(__file__).with_name("sync.py"))

# Shaped exactly like a live get_weigh_ins(includeAll) response (2026-10-23
# probe, ADR-026), trimmed to two days; the first day
# carries a second reading to prove per-day flattening keeps every entry.
_ENTRY = {
    "samplePk": 1792754614878,
    "date": 1792740209005,
    "calendarDate": "2026-10-23",
    "weight": 70397.0,
    "bmi": None,
    "bodyFat": None,
    "sourceType": "MANUAL",
    "timestampGMT": 1792754609005,
}
WEIGH_INS = {
    "dailyWeightSummaries": [
        {
            "summaryDate": "2026-10-23",
            "numOfWeightEntries": 2,
            "allWeightMetrics": [_ENTRY, {**_ENTRY, "samplePk": 1, "timestampGMT": 1792790000000}],
        },
        {
            "summaryDate": "2026-10-22",
            "numOfWeightEntries": 1,
            "allWeightMetrics": [
                {**_ENTRY, "samplePk": 2, "calendarDate": "2026-10-22", "timestampGMT": 1792668380004}
            ],
        },
    ],
    "totalAverage": {},
}

CLOUDFLARE_1101 = (
    "<!DOCTYPE html><html><head><title>Worker threw exception | "
    "corpus-mcp.whitebirch.workers.dev | Cloudflare</title></head><body>…</body></html>"
)


class Resp:
    def __init__(self, status: int = 200, body=None, text: str = ""):
        self.status_code = status
        self.ok = status < 400
        self._body = body
        self.text = text

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


class RequestException(Exception):
    pass


class Run:
    """One execution of sync.py with scripted worker responses."""

    def __init__(self, argv, weigh_ins=lambda a, b: copy.deepcopy(WEIGH_INS), worker=None):
        self.calls: list[tuple[str, str]] = []
        self.posted: list[dict] = []
        self.sleeps: list[float] = []
        self.weigh_in_ranges: list[tuple[str, str]] = []
        self.exit = None
        # worker: optional fn(method, path, attempt_no) -> Resp | Exception
        self._worker = worker
        self._attempts: dict[tuple[str, str], int] = {}
        self._run(argv, weigh_ins)

    def _respond(self, method, url, **kw):
        path = "/" + url.split("/", 3)[3]
        self.calls.append((method, path))
        key = (method, path)
        self._attempts[key] = self._attempts.get(key, 0) + 1
        if method == "POST":
            self.posted.append(kw["json"])
        if self._worker:
            r = self._worker(method, path, self._attempts[key])
            if r is not None:
                if isinstance(r, Exception):
                    raise r
                return r
        if method == "GET":
            return Resp(body={"tokens": "blob"})
        if method == "POST":
            return Resp(body={"weighIns": {"upserted": [], "deleted": 0, "skipped": 0}})
        return Resp(body={"ok": True})

    def _run(self, argv, weigh_ins):
        req = types.ModuleType("requests")
        req.request = self._respond
        req.RequestException = RequestException
        req.Response = Resp
        sys.modules["requests"] = req

        run = self

        class Garmin:
            def __init__(self, **_):
                self.client = types.SimpleNamespace(dumps=lambda: "refreshed-blob")

            def login(self, **_):
                pass

            def get_stats(self, d):
                return {"totalSteps": 1}

            def get_sleep_data(self, d):
                return {}

            def get_hrv_data(self, d):
                return {}

            def get_training_readiness(self, d):
                return []

            def get_max_metrics(self, d):
                return []

            def get_activities_by_date(self, a, b):
                return []

            def get_weigh_ins(self, a, b):
                run.weigh_in_ranges.append((a, b))
                return weigh_ins(a, b)

        gc = types.ModuleType("garminconnect")
        gc.Garmin = Garmin
        sys.modules["garminconnect"] = gc

        real_sleep = time.sleep
        time.sleep = self.sleeps.append
        sys.argv = ["sync.py", *argv]
        self.stdout, self.stderr = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stdout(self.stdout), contextlib.redirect_stderr(self.stderr):
                runpy.run_path(SCRIPT, run_name="__main__")
        except SystemExit as e:
            self.exit = e.code
        finally:
            time.sleep = real_sleep

    @property
    def methods(self):
        return [m for m, _ in self.calls]


def boom(a, b):
    raise RuntimeError("simulated Garmin 500")


def today() -> dt.date:
    return dt.datetime.now(ZoneInfo("America/New_York")).date()


class PullTest(unittest.TestCase):
    def test_posts_flattened_weigh_ins_and_saves_tokens(self):
        r = Run(["pull", "--days", "7"])
        self.assertIsNone(r.exit)
        self.assertEqual(r.methods, ["GET", "POST", "PUT"])
        w = r.posted[0]["weighIns"]
        self.assertEqual(len(w["entries"]), 3)
        self.assertEqual(w["entries"][0]["weight"], 70397.0)  # raw grams, untouched
        self.assertIn("timestampGMT", w["entries"][0])
        start, end = dt.date.fromisoformat(w["start"]), dt.date.fromisoformat(w["end"])
        self.assertEqual(end, today())
        self.assertEqual((end - start).days, 6)

    def test_days_1_window_is_today_only(self):
        w = Run(["pull", "--days", "1"]).posted[0]["weighIns"]
        self.assertEqual(w["start"], w["end"])

    def test_weigh_in_fetch_failure_omits_key_but_still_posts(self):
        r = Run(["pull", "--days", "7"], weigh_ins=boom)
        self.assertIsNone(r.exit)
        self.assertEqual(len(r.posted), 1)
        self.assertNotIn("weighIns", r.posted[0])

    def test_unexpected_shapes_are_failures_never_empty(self):
        for bad in ({"something": "else"}, None, {"dailyWeightSummaries": "nope"}):
            with self.subTest(bad=bad):
                r = Run(["pull", "--days", "7"], weigh_ins=lambda a, b, bad=bad: bad)
                self.assertNotIn("weighIns", r.posted[0])

    def test_genuinely_empty_is_sent_as_empty(self):
        r = Run(["pull", "--days", "7"], weigh_ins=lambda a, b: {"dailyWeightSummaries": []})
        self.assertEqual(r.posted[0]["weighIns"]["entries"], [])

    def test_dry_run_never_posts_or_saves_tokens(self):
        r = Run(["pull", "--days", "7", "--dry-run"])
        self.assertEqual(r.methods, ["GET"])
        self.assertIn('"weighIns"', r.stdout.getvalue())


class RetryTest(unittest.TestCase):
    def test_transient_ingest_500_is_retried_then_succeeds(self):
        r = Run(
            ["pull", "--days", "1"],
            worker=lambda m, p, n: Resp(500, text=CLOUDFLARE_1101) if m == "POST" and n < 3 else None,
        )
        self.assertIsNone(r.exit)
        self.assertEqual(r.methods, ["GET", "POST", "POST", "POST", "PUT"])
        self.assertEqual(r.sleeps, [15, 45])
        self.assertIn("Worker threw exception", r.stderr.getvalue())  # title, not 10 KB of HTML

    def test_network_error_is_retried(self):
        r = Run(
            ["pull", "--days", "1"],
            worker=lambda m, p, n: RequestException("timed out") if m == "POST" and n == 1 else None,
        )
        self.assertIsNone(r.exit)
        self.assertEqual(r.methods.count("POST"), 2)

    def test_persistent_failure_exits_with_a_readable_message_and_keeps_tokens(self):
        r = Run(
            ["pull", "--days", "1"],
            worker=lambda m, p, n: Resp(500, body={"error": "Ingest failed", "stage": "import",
                                                   "message": "Connection terminated"})
            if m == "POST" else None,
        )
        self.assertIsInstance(r.exit, str)
        self.assertIn("failed after 3 attempts", r.exit)
        self.assertIn("Ingest failed — import — Connection terminated", r.exit)
        self.assertNotIn("PUT", r.methods)

    def test_client_errors_are_not_retried(self):
        r = Run(
            ["pull", "--days", "1"],
            worker=lambda m, p, n: Resp(400, body={"error": "Invalid payload"}) if m == "POST" else None,
        )
        self.assertEqual(r.methods.count("POST"), 1)
        self.assertEqual(r.sleeps, [])
        self.assertIn("Invalid payload", r.exit)

    def test_token_fetch_is_retried(self):
        r = Run(
            ["pull", "--days", "1"],
            worker=lambda m, p, n: Resp(503, text="unavailable") if m == "GET" and n == 1 else None,
        )
        self.assertIsNone(r.exit)
        self.assertEqual(r.methods[:2], ["GET", "GET"])

    def test_fetch_warnings_survive_a_failed_ingest(self):
        r = Run(
            ["pull", "--days", "1"],
            weigh_ins=boom,
            worker=lambda m, p, n: Resp(500, text=CLOUDFLARE_1101) if m == "POST" else None,
        )
        self.assertIsInstance(r.exit, str)
        self.assertIn("weigh_ins", r.stderr.getvalue())


class BackfillTest(unittest.TestCase):
    since = today() - dt.timedelta(days=199)  # 200 days → 90 + 90 + 20

    def test_contiguous_chunks_weigh_ins_only_tokens_saved_once(self):
        r = Run(["pull", "--weight-since", self.since.isoformat()])
        ranges = r.weigh_in_ranges
        self.assertEqual(len(ranges), 3)
        self.assertEqual(ranges[0][0], self.since.isoformat())
        self.assertEqual(ranges[-1][1], today().isoformat())
        for (_, end), (nxt, _) in zip(ranges, ranges[1:]):
            self.assertEqual(dt.date.fromisoformat(end) + dt.timedelta(days=1), dt.date.fromisoformat(nxt))
        for a, b in ranges:
            self.assertLess((dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days, 90)
        self.assertTrue(all(p["days"] == [] and p["activities"] == [] for p in r.posted))
        self.assertEqual(r.methods, ["GET", "POST", "POST", "POST", "PUT"])

    def test_dry_run(self):
        r = Run(["pull", "--weight-since", self.since.isoformat(), "--dry-run"])
        self.assertEqual(len(r.weigh_in_ranges), 3)
        self.assertEqual(r.methods, ["GET"])

    def test_fetch_failure_prints_resume_point(self):
        n = {"calls": 0}

        def fail_second(a, b):
            n["calls"] += 1
            if n["calls"] == 2:
                raise RuntimeError("simulated 429")
            return {"dailyWeightSummaries": []}

        r = Run(["pull", "--weight-since", self.since.isoformat()], weigh_ins=fail_second)
        resume = (self.since + dt.timedelta(days=90)).isoformat()
        self.assertIn(f"--weight-since {resume}", r.exit)
        self.assertEqual(r.methods, ["GET", "POST"])

    def test_ingest_failure_prints_resume_point(self):
        r = Run(
            ["pull", "--weight-since", self.since.isoformat()],
            worker=lambda m, p, n: Resp(500, text=CLOUDFLARE_1101) if m == "POST" else None,
        )
        self.assertIn(f"--weight-since {self.since.isoformat()}", r.exit)
        self.assertNotIn("PUT", r.methods)

    def test_bad_dates_rejected(self):
        future = Run(["pull", "--weight-since", (today() + dt.timedelta(days=1)).isoformat()])
        self.assertIn("future", future.exit)
        self.assertEqual(future.calls, [])
        self.assertEqual(Run(["pull", "--weight-since", "2026-13-01"]).exit, 2)


if __name__ == "__main__":
    os.environ.update(
        CORPUS_BASE_URL="http://worker.test",
        CORPUS_INGEST_SECRET="s",
        CORPUS_USER_EMAIL="e@example.com",
        CORPUS_TIMEZONE="America/New_York",
    )
    unittest.main()
