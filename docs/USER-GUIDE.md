# Corpus — a guide for new users

Welcome. This is everything you need to start using Corpus: what it is, how to
connect it to Claude (or another AI tool), and how to actually use it day to
day.

You don't need to be a developer. Nothing here involves running code.

---

## 1. What Corpus is

Corpus is a personal health-tracking system — workouts, nutrition,
medications and supplements, lab results, biometrics, and goals — all in one
database, on one timeline.

The unusual part: **there is no app to type your data into.** Corpus is built
"AI-agent-first," which means the primary way you use it is *by talking to
Claude* (or another AI assistant). You connect Corpus to your AI tool once,
and from then on you just say things like:

> "I ran 4 miles this morning, about 34 minutes, felt easy."

> "Logging lunch — chicken burrito bowl with rice, black beans, guac. Here's a photo."

> "What should I train today?"

> "How has my resting heart rate trended since April?"

The assistant handles the structure — parsing what you said into movements,
sets, foods, and macros; converting units; checking for duplicates; and
writing it to your database. You never fill in a form.

There's also a small **web dashboard** for glancing at your data on your
phone. It's a companion, not the main event.

### Why this is different from MyFitnessPal / Strava / MacroFactor

- **One timeline.** Your sleep, your squat PR, your bloodwork, and what you
  ate are all in the same database, so you can ask questions that cross
  categories: *"Do my heavy leg days follow bad sleep?"* No app can answer
  that, because no app has all of it.
- **No fixed feature set.** Anything you can express in a question, you can
  ask. There's a read-only SQL tool the assistant uses for genuinely novel
  analysis, so you aren't limited to whichever charts someone decided to build.
- **Conversational entry.** Describing a meal in a sentence is faster than
  searching a food database six times.

---

## 2. First-time setup (5 minutes)

### Step 1 — Sign in to the web dashboard

Open **https://corpus-app.whitebirch.workers.dev** and sign in with Google,
using the **exact Google account whose address was added to the allowlist**.

This first sign-in is what creates your account in the system. Do this before
step 2 — it makes the next step smoother.

Corpus is private and invite-only: only allowlisted email addresses can sign
in at all. Anyone else who finds the URL gets a flat "This Corpus instance is
private." Add it to your phone's home screen and it behaves like a normal app
(it's a PWA).

### Step 2 — Connect Corpus to Claude

The connector URL you'll need in every tool below:

```
https://corpus-mcp.whitebirch.workers.dev/mcp
```

**On claude.ai (web, desktop, or mobile)** — this is the main path, and
requires a paid Claude plan (Pro or Max):

1. Go to **Settings → Connectors**.
2. Click **Add custom connector**.
3. Paste the URL above. Name it "Corpus."
4. Click **Connect**. A Google sign-in window opens — use the same Google
   account as step 1, and approve access.
5. Corpus now appears in your connector list. Start a new chat and you should
   see it available in the tools/attachments menu.

That's it. The connection persists — you won't re-authenticate every session.

**In Claude Code** (if you use the CLI):

```bash
claude mcp add --transport http corpus https://corpus-mcp.whitebirch.workers.dev/mcp
```

Then run `/mcp` inside Claude Code and authenticate when prompted.

### Step 3 — Say hello

Start a chat with Claude and try:

> "What's in my Corpus profile?"

It should come back with your name, timezone, and (empty, for now) goals. If
it does, you're wired up correctly.

---

## 3. Connecting other AI tools

Corpus speaks **MCP** (Model Context Protocol), an open standard, so it isn't
Claude-only. Anything that supports remote MCP servers with OAuth can connect
to the same URL.

> Heads-up: these product UIs change frequently. The menu names below were
> accurate at the time of writing; if you can't find them, search that tool's
> current docs for "remote MCP server" or "custom connector."

### ChatGPT

ChatGPT supports custom MCP connectors, but with real caveats:

- You need a paid plan, and you must turn on **developer mode** for custom
  connectors (roughly: **Settings → Connectors → Advanced settings →
  Developer mode**), then add the connector URL there.
- ChatGPT's older/simpler "connector" path is built for *search-and-retrieve*
  sources and expects the server to offer `search` and `fetch` tools. Corpus
  doesn't have those — it has 42 specific tools like `log_meal` and
  `get_daily_summary` — so that path won't work well. Developer mode, which
  exposes all tools, is the one to use.
- Write-capable tools in ChatGPT typically require per-action confirmation.

Practically: **Corpus works best in Claude.** The prompts described in the
next section are Claude-specific features, and the whole system was designed
and tested against Claude. ChatGPT will work for asking questions and logging,
but expect more friction.

### Other clients

Cursor, VS Code (Copilot), Zed, Cline, Goose, and similar tools all support
remote MCP servers — look for an "MCP servers" section in settings and add
the same URL with transport type "HTTP" (sometimes called "Streamable HTTP").
These are developer tools, so this is optional unless you already live in one.

---

## 4. Daily use

### Shortcuts worth knowing

Corpus ships **10 guided prompts** — pre-written multi-step routines. In
Claude, they appear when you pick Corpus from the attachments/tools menu in a
chat; select one instead of typing your request from scratch. Each one tells
Claude exactly which data to pull first, so the answers are grounded in your
real numbers rather than generic advice.

| Prompt | What it does |
|---|---|
| `morning_checkin` | ~30-second morning routine: energy and soreness, plus a recap of your latest weigh-in |
| `log_workout_conversation` | Describe a workout; it captures the structure correctly |
| `log_meal_conversation` | Log a meal from a photo + caption, itemized honestly |
| `plan_todays_workout` | Recommends today's session from recovery + recent volume |
| `finish_my_macros` | "What should I eat to close out my day?" |
| `import_lab_report` | Walks a lab PDF or fitness test into structured results |
| `weekly_review` | Looks back at the week: adherence, trends, what to change |
| `plan_my_week` | Builds a training week around your goals and constraints |
| `adjust_my_plan` | Reshuffles the plan when life happens |
| `review_training_strategy` | Steps back: is the current approach still right? |

You never *have* to use these — plain conversation works fine. They're just
the well-worn paths.

### Logging things

Just describe them. Some examples that work well:

**A workout:**
> "Back squat 5x5 at 225, then 3 sets of 10 RDLs at 135, finished with 15
> minutes on the bike."

**A meal (photos are great here):**
> "Breakfast — three eggs scrambled in butter, two slices of sourdough, black
> coffee." *(attach a photo and it'll spot what you forgot to mention)*

**How you're feeling:**
> "Slept badly, maybe 5 hours. Energy's a 2 out of 5. Left shoulder is sore."

**Meds and supplements:**
> "I'm starting creatine, 5g a day in the morning."

**Lab results:**
> Attach the PDF and say "import this lab panel."

A few things the system does automatically, so you don't have to think about
them:

- **Units are handled for you.** Say "225 lb" or "4 miles" or "102 kg" —
  whatever's natural. Everything is stored in canonical metric internally and
  converted back for display. Never do the math yourself.
- **Duplicates are caught.** If you log the same meal twice, Corpus flags it
  as a possible duplicate and asks rather than silently double-counting.
- **Dates are local.** "Yesterday" and "this morning" resolve against your
  timezone (see the notes in §6).

### Asking questions

This is where it earns its keep. Anything goes:

> "What's my average sleep over the last two weeks?"

> "Show me every time I've benched over 185 this year."

> "Am I hitting my protein target consistently, or just on weekdays?"

> "My LDL was 130 in March — what is it now, and what's the trend?"

> "I've got 40 minutes and only dumbbells. What should I do?"

When there's no purpose-built tool for what you asked, the assistant writes a
read-only SQL query against your data. It cannot modify anything that way —
the query tool is locked to SELECT-only, with a row cap and a timeout.

### The web dashboard

**https://corpus-app.whitebirch.workers.dev** — four screens:

- **Today** — the day at a glance: recovery, a calorie progress bar and
  macro meters (blue = under target, amber = within 10%, red = over), what
  you've logged, what's planned.
- **Trends** — charts over time: weight, body fat, calories in/out, sleep,
  HRV, resting HR, steps, running distance, lifting volume, and more. (The
  wearable charts stay empty without Garmin sync — see §6.)
- **Plan** — your training week.
- **Scan** — a barcode scanner for packaged food. This is the one place in
  the dashboard where you *write* data; it's faster than describing a label to
  an assistant while standing in your kitchen.

Everything else in the dashboard is read-only by design. Adding data is the
assistant's job.

---

## 5. What Corpus can track

The full surface, roughly grouped. You don't need to memorize any of this —
the assistant picks the right tool. It's here so you know what's possible.

**Daily & body**
`log_daily_checkin` (sleep, energy, soreness, weight) · `log_observation`
(anything measurable) · `get_daily_summary`

**Training**
`log_workout` · `update_workout` · `delete_workout` · `get_recent_workouts` ·
`get_movement_history` (per-exercise history and PRs)

**Training plans**
`plan_week` · `update_planned_session` · `link_workout_to_plan` ·
`get_training_plan` · `get_training_profile` · `upsert_equipment_item` ·
`upsert_capability_estimate` · `upsert_planning_constraint` ·
`set_home_location` (weather-aware planning)

**Nutrition**
`log_meal` · `update_meal` · `delete_meal` · `search_foods` · `upsert_food`
(personal food catalog) · `save_recipe` / `get_recipe` (reusable meals) ·
`lookup_barcode` · `set_nutrition_targets`

**Meds & supplements**
`upsert_regimen_item` · `end_regimen_item` · `log_regimen_event` (missed
doses, changes) · `get_regimen`

**Labs & testing**
`record_lab_panel` (~90 canonical analytes) · `record_fitness_test` (VO2 max,
RMR, DEXA) · `get_lab_history` · `create_document_upload` (store the original
PDF)

**Goals & notes**
`upsert_goal` · `update_goal_status` · `upsert_milestone` ·
`update_milestone_status` · `save_insight` / `archive_insight` · `get_goals`

**Analysis**
`query_data` — read-only SQL for anything the above doesn't cover

---

## 6. Things worth knowing up front

**Your data is yours.** Every table is protected by row-level security in the
database, scoped to your user ID. Other users of this instance cannot see your
data through the app, the API, or even the SQL query tool. Fair disclosure:
Scott runs and administers the instance, so he has database-level access the
way any self-hoster does — this is a personal system shared with you, not a
commercial product with a privacy department.

**Defaults you may want changed.** New accounts start with timezone
`America/New_York` and **imperial** units (lb, mi). There's currently no tool
to change these yourself — ask Scott to update it directly if either is wrong
for you. Getting the timezone right matters, because it decides what counts as
"today."

**Wearable sync isn't set up for you.** There's an automated nightly Garmin
import, but it's currently configured for Scott's account only. So a few of
the prompts — `morning_checkin` especially — assume sleep/HRV/resting-HR data
that will be blank for you. Everything still works; you'll just be entering
those manually, or skipping them. One thing to know: `morning_checkin`
expects weigh-ins to arrive from Garmin, so it **won't ask for your weight** —
just volunteer it ("…and I weighed 172 this morning") and it gets logged. If
you have a Garmin and want it wired up, that's a conversation to have.

**Nutrition targets are ceilings — all of them.** Calories, carbs, fat, *and
protein* are each treated as a daily maximum: the dashboard meter turns amber
as you get close and red once you go over. So set protein to the most you
want to eat, not the minimum you're trying to reach.

**Start with goals.** The planning and review prompts get dramatically better
once Corpus knows what you're working toward. Early on, spend five minutes on:

> "Let's set up my goals. I want to ..."

**Be honest with the assistant about uncertainty.** When you say "a handful of
almonds, maybe 20?", it records that as a low-confidence estimate rather than
a fact. That's a feature — the data stays truthful about how good it is.

**Corrections are easy.** "Actually that was 245, not 225" or "delete that
meal, I logged it twice" both work.

---

## 7. Troubleshooting

**"This Corpus instance is private." (403)**
You're signed in with a Google account that isn't on the allowlist. Check
you're using the exact address that was added — if you have multiple Google
accounts in one browser, you may have picked the wrong one. Sign out and retry.

**The connector won't authenticate.**
Make sure you're completing the Google sign-in popup, and that pop-ups aren't
blocked. If it hangs, remove the connector and re-add it.

**Claude doesn't seem to see Corpus in a chat.**
Connectors have to be enabled per-conversation in some Claude clients — check
the tools/attachments menu in that chat. Starting a fresh chat after adding
the connector also helps.

**A tool call fails or a number looks wrong.**
Ask the assistant to show you what it saved — it can read the record straight
back. Most oddities are logging mistakes (wrong date, wrong unit) that are
fixable in a sentence. If something looks like an actual bug, note what you
asked and what happened, and send it to Scott.

**Something you want to track isn't supported.**
Say so. Corpus is actively developed, and "I wish it could do X" is how new
capabilities get added.

---

## 8. A suggested first week

1. **Day 1** — Sign in to the dashboard. Connect Claude. Ask "what's in my
   profile?" to confirm it works.
2. **Day 1** — Set up your goals, and your nutrition targets if you have them.
3. **Days 2–3** — Log meals and workouts as they happen. Get a feel for how
   much detail is worth giving (usually: less than you'd expect).
4. **Day 4** — Try `plan_todays_workout` and see whether the recommendation is
   sensible. Push back on it conversationally if not.
5. **End of week** — Run `weekly_review`. This is the moment where having the
   data in one place starts to pay off.

Don't try to backfill your history. Start from today and let it accumulate.

---

## Quick reference

| | |
|---|---|
| Dashboard | https://corpus-app.whitebirch.workers.dev |
| Connector URL | `https://corpus-mcp.whitebirch.workers.dev/mcp` |
| Sign-in | Google, allowlisted addresses only |
| Best client | Claude (Pro or Max plan) |
| Tools available | 42, across training, nutrition, labs, regimen, goals |
| Guided prompts | 10 |
