# garmin-sync

Nightly pull of Garmin Connect wellness data (sleep, HRV, resting HR, steps,
body battery, stress) and activity summaries into Corpus, via the worker's
`/garmin/ingest` endpoint. Runs as a GitHub Actions scheduled workflow
([.github/workflows/garmin-sync.yml](../../.github/workflows/garmin-sync.yml));
this uses Garmin's unofficial API through
[garminconnect](https://github.com/cyberjunky/python-garminconnect) — real
Python with real sockets, which the Cloudflare Workers sandbox can't run.

All mapping/reconciliation logic lives in `@corpus/core` (`src/import/garmin.ts`);
this script only authenticates and fetches.

Setup and the one-time interactive bootstrap are documented in
[docs/SETUP.md §7](../../docs/SETUP.md). Quick reference:

```sh
cd apps/garmin-sync
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# one-time interactive login (MFA-capable); uploads tokens to the worker store
CORPUS_BASE_URL=https://corpus-mcp.whitebirch.workers.dev \
CORPUS_INGEST_SECRET=... \
CORPUS_USER_EMAIL=scott.schmalz@gmail.com \
.venv/bin/python sync.py bootstrap

# manual pull (what the nightly job runs)
... .venv/bin/python sync.py pull --days 7
```

If a nightly run fails (GitHub emails on workflow failure), it's usually a
dead Garmin refresh token — re-run `bootstrap` locally and the next pull
self-heals, backfilling the missed window.
