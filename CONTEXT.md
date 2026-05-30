# Crawler — Lead & Job Discovery System

## What This Does

This system has two independent pipelines running on the same Express server:

1. **Leads Pipeline** — Crawls Reddit and Instagram for posts where people are looking to buy a product or service. Matches those posts to registered dealers by category and location using a two-phase AI system (Gemini then Claude), then emails the dealer with the post link and an AI-generated suggested reply.

2. **Jobs Pipeline** — Fetches job listings from Adzuna (the file is named `indeed-fetcher.js` but it calls the Adzuna API) for each registered job candidate based on their role and preferred locations, scores relevance via Gemini in batch, and emails matched listings with an application tip.

Both pipelines run as continuous loops started/stopped via admin API. All data is stored in Google Sheets (no local database).

**Example (Leads):** A furniture dealer in Faridabad gets an email when someone posts "Looking for a sofa in Sector 15 Faridabad" on r/Faridabad.

**Example (Jobs):** A React developer in Bangalore gets an email with matching React job listings found on Adzuna, with a tip like "Highlight your Redux experience — the JD specifically mentions state management."

---

## How to Run

```bash
npm install
cp .env.example .env   # fill in all API keys (see Environment Variables below)
node server.js         # starts at http://localhost:3000
```

On first run with valid Google credentials but no `SPREADSHEET_ID`, the server auto-creates a new Google Sheet, prints its ID, and exits. Add that ID to `.env` then restart.

### URLs

| Page | URL |
|------|-----|
| Landing page | http://localhost:3000/ |
| Admin panel | http://localhost:3000/admin.html |
| Register dealer | http://localhost:3000/register.html |
| Register candidate | http://localhost:3000/register-candidate.html |
| Dealer payment | http://localhost:3000/pay?dealer_id=\<id\> |
| Candidate payment | http://localhost:3000/candidate-pay?candidate_id=\<id\> |

### Start/stop the crawlers (via API)
```bash
curl -X POST http://localhost:3000/api/crawl/start   # leads crawler
curl -X POST http://localhost:3000/api/jobs/start    # jobs crawler
curl http://localhost:3000/api/crawl/status
curl http://localhost:3000/api/jobs/status
```

Or use the Admin panel buttons.

---

## Environment Variables (.env)

```
# Reddit
REDDIT_USER_AGENT=web:crawler-bot:1.0 (by /u/crawler_bot)
REDDIT_CLIENT_ID=        # optional: Reddit OAuth app client ID (read-only)
REDDIT_CLIENT_SECRET=    # optional: Reddit OAuth app secret

# AI
GEMINI_API_KEY=          # Google AI Studio key (used by both pipelines)
ANTHROPIC_API_KEY=       # Not currently used in code — only appears in /api/debug-env diagnostic output

# Jobs (Adzuna API — despite file being named indeed-fetcher.js)
ADZUNA_APP_ID=           # from api.adzuna.com developer console
ADZUNA_APP_KEY=          # from api.adzuna.com developer console

# Email
SMTP_USER=               # Gmail address
SMTP_PASS=               # Gmail App Password (not regular password)
                         # Google Account → Security → 2-Step → App passwords

# Google Sheets (storage backend)
GOOGLE_CREDENTIALS_JSON= # service account JSON as a single-line string (preferred for Render/cloud)
GOOGLE_CREDENTIALS_PATH= # OR: path to service account JSON file (local dev)
SPREADSHEET_ID=          # leave blank on first run — server creates it and prints the ID

# Instagram (optional)
INSTAGRAM_USERNAME=      # dedicated account — not your personal one
INSTAGRAM_PASSWORD=      # dedicated account password

# Server
PORT=3000
BASE_URL=http://localhost:3000
```

Reddit OAuth is optional — without it the crawler uses public `/r/X/new.json` endpoints. With it, higher rate limits apply.

---

## Leads Pipeline

Crawls Reddit subreddits and Instagram for buyer-intent posts, then matches to dealers.

**Trigger:** Admin starts via `POST /api/crawl/start`. Runs as a **continuous loop** (2-minute wait between cycles). Each cycle:

```
buildSubredditList(dealers)
  → dealer city/state → CITY_SUBREDDIT_MAP → subreddit list
  ↓
Fetch Reddit posts (25 per subreddit, up to 200 total, max 5 days old)
  → saveFetchedPost() to Google Sheets fetched_posts tab
  → rate-limit aware: backs off 60s on HTTP 429, skips 403s silently
  ↓
Fetch Instagram posts (via instagrapi Python scraper, non-fatal if it fails)
  → hashtag search + caption keyword search
  → session cached to instagram_session.json after first login
  ↓
Pre-filter (no AI cost)
  → shouldCheckPost() in prefilter.js — intent phrases + dealer keyword matching
  → ~10-15% of posts pass
  ↓
[Gemini 2.5 Flash — processPostBatch() in matcher.js — batch of all filtered posts]
  Returns per post: is_lead, is_hiring_post, lead_category, what_to_sell,
                    suggested_reply, post_location, matched_dealer_ids[]
  Hiring posts and non-leads are discarded
  ↓
For each lead → for each matched dealer:
  checkSubscription(dealer) → 'send' | 'send_with_footer' | 'skip' | 'expired'
  'expired'          → resetDealerSubscription() + send expiry email + save unmatched
  'skip'             → save as unmatched
  'send'             → saveLead() + sendLeadEmail() + incrementDealerLeadCount()
  'send_with_footer' → same as 'send' but email includes ₹10/month subscribe CTA
  No dealer matched  → saveLead(status='unmatched')
```

**Sources:**

| Source | File | Method | Identifier in `subreddit` column |
|--------|------|--------|----------------------------------|
| Reddit | `crawler.js` | Public JSON or OAuth (`/r/X/new.json`) | subreddit name e.g. `delhi` |
| Instagram | `instagram-fetcher.js` + `instagram_scraper.py` | Python `instagrapi` via child_process | `instagram` |

> IndiaMART (Puppeteer scraping) was previously integrated but has been removed.

**Subscription warning emails:** If a dealer's subscription expires within 3 days, a warning email is sent once per process run (tracked in an in-memory Set — resets on server restart).

---

## Jobs Pipeline

Fetches job listings from Adzuna for each registered candidate, scores relevance with Gemini, and emails matches.

**Trigger:** Admin starts via `POST /api/jobs/start`. Runs as a **continuous loop** (5-minute wait between cycles, 90-second timeout per cycle). Each cycle:

```
getActiveCandidates()
  ↓
For each candidate:
  Build location list: [candidate.city, ...preferred_locations]
  fetchIndeedJobs(candidate.role, '', location) via Adzuna API
    → 25 results per location, sorted by date, max 3 days old
    → saveFetchedJob() to Google Sheets fetched_jobs tab
  Deduplicate across locations for this candidate
  Add new (unseen) jobs to buffer as {candidate, job} pairs
  ↓
processJobBatch(buffer) — Gemini 2.5 Flash scores all pairs at once
  Returns: [{index, is_relevant, suggested_tip}, ...]
  Retries once on failure
  ↓
For each relevant pair:
  getCandidate(id) — re-fetch for fresh subscription state
  checkCandidateSubscription(candidate) → 'send' | 'send_with_footer' | 'skip' | 'expired'
  'expired'          → resetCandidateSubscription() + send expiry email
  'skip'             → discard
  'send'             → saveJobMatch() + sendJobAlertEmail() + incrementCandidateLeadCount()
  'send_with_footer' → same + ₹10/month subscribe CTA in email
```

**Deduplication:** `seenJobs` is an in-memory Set loaded from the `job_matches` sheet on startup. A job ID seen in a previous session is never re-emailed.

**Subscription warning emails:** Same pattern as leads — warns 3 days before expiry, once per process run.

---

## Data Storage — Google Sheets

All data lives in a single Google Spreadsheet with 8 tabs. There is no local SQLite or other database.

`sheets.js` handles all reads/writes. It uses an in-memory cache for `seenPosts`, `seenJobs`, and `seenFetchedJobs` to avoid re-processing across cycles without re-querying the sheet.

**Important:** `appendRow()` uses `rows.length + 1` as the next ID. This is non-atomic — if two writes happen concurrently, IDs can collide. The server avoids this by awaiting sequential writes where needed.

### Tab: `dealers`

| Column | Description |
|--------|-------------|
| id | Auto-incremented integer |
| name | Business name |
| emails | Comma-separated email addresses |
| industry_category | One of 21 categories (see Industry Categories section) |
| services | What they sell (free text) |
| target_customers | Who they sell to |
| keywords | Comma-separated keywords for matching |
| state | e.g. `Haryana` |
| city | e.g. `Faridabad` |
| service_areas | Granular: sectors, villages (free text) |
| custom_subreddits | Extra subreddits beyond city default |
| lead_count | Free-tier counter — resets on subscription |
| subscription_status | `free` \| `active` |
| subscription_expires_at | ISO date string or empty |
| active | `1` \| `0` |
| created_at | ISO date string |

### Tab: `leads`

| Column | Description |
|--------|-------------|
| id | Auto-incremented |
| dealer_id | Empty if unmatched |
| reddit_post_id | Unique post ID (prefix: `reddit_`, `insta_`) |
| post_title | Post title |
| post_text | Post body (truncated to 500 chars) |
| post_url | Full URL |
| subreddit | Source identifier (`delhi`, `instagram`, etc.) |
| match_reason | e.g. `Category: Furniture & Home Decor` |
| suggested_reply | AI-generated reply text |
| what_to_sell | What the dealer should pitch |
| lead_category | Industry category matched |
| post_location | Location extracted from post |
| status | `matched` \| `unmatched` \| `assigned` |
| emailed_at | ISO date string |

### Tab: `payments`

| Column | Description |
|--------|-------------|
| id | Auto-incremented |
| dealer_id | References dealers.id |
| utr_number | UPI Transaction Reference |
| amount | `10` (₹10/month) |
| status | `pending` \| `verified` \| `rejected` |
| created_at | ISO date string |
| verified_at | ISO date string or empty |

### Tab: `fetched_posts`

Stores every raw post fetched in each cycle for admin browsing and manual send.

| Column | Description |
|--------|-------------|
| id | Auto-incremented |
| post_id | Unique post ID (matches `reddit_post_id` in leads) |
| post_title / post_text / post_url | Post content (text truncated to 500 chars) |
| subreddit | Source identifier |
| fetched_at | ISO date string |

### Tab: `candidates`

| Column | Description |
|--------|-------------|
| id | Auto-incremented |
| name | Candidate name |
| emails | Comma-separated email addresses |
| role | Job title they're looking for e.g. `React Developer` |
| skills | Comma-separated skills |
| experience_level | e.g. `Mid-level`, `Senior` |
| city | Primary city |
| state | State |
| preferred_locations | Comma-separated additional cities or `Remote` |
| lead_count | Free-tier counter |
| subscription_status | `free` \| `active` |
| subscription_expires_at | ISO date string or empty |
| active | `1` \| `0` |
| created_at | ISO date string |

### Tab: `job_matches`

| Column | Description |
|--------|-------------|
| id | Auto-incremented |
| candidate_id | References candidates.id |
| indeed_job_id | Adzuna job ID with `adzuna_` prefix |
| job_title / company / location | Job details |
| job_url | Adzuna redirect URL |
| snippet | Job description excerpt |
| suggested_tip | Gemini-generated application tip |
| status | `matched` |
| emailed_at | ISO date string |

### Tab: `candidate_payments`

Same structure as `payments` but references `candidate_id` instead of `dealer_id`. Amount is also ₹10.

### Tab: `fetched_jobs`

Stores every raw job fetched per cycle for admin browsing and manual send.

| Column | Description |
|--------|-------------|
| id | Auto-incremented |
| job_id | Adzuna job ID with `adzuna_` prefix |
| job_title / company / location / job_url / snippet | Job details |
| fetched_at | ISO date string |

---

## File Map

| File | Purpose |
|------|---------|
| `server.js` | Express app, all API routes. Entry point: `node server.js` calls `initSheets()` then starts server. `createApp()` exported for tests. |
| `crawler.js` | Leads pipeline orchestrator — `startCrawler()` continuous loop, `runCycle()`, `processBatch()`, Reddit OAuth fetch, subscription check for dealers |
| `jobs-crawler.js` | Jobs pipeline orchestrator — `startJobsCrawler()` continuous loop, `runJobsCycle()`, subscription check for candidates |
| `matcher.js` | Leads AI — `processPostBatch(posts, dealers)` sends filtered posts to Gemini 2.5 Flash, returns per-post lead classification + dealer matching. Also exports `identifyLead()` for single-post use in the manual send flow. |
| `job-matcher.js` | Jobs AI — `processJobBatch(pairs)` sends candidate+job pairs to Gemini 2.5 Flash, returns relevance scores + application tips. One retry on failure. |
| `indeed-fetcher.js` | Adzuna API client — `fetchIndeedJobs(role, skills, city)` returns 25 job results. Named "indeed" for legacy reasons; actually calls `api.adzuna.com`. |
| `instagram-fetcher.js` | Instagram source — `fetchInstagramLeads(dealers)` spawns `instagram_scraper.py` via child_process |
| `instagram_scraper.py` | Python script using `instagrapi` — hashtag search + caption keyword search. Caches session to `instagram_session.json`. |
| `sheets.js` | Google Sheets data layer — all CRUD for all 8 tabs. Manages in-memory `seenPosts`, `seenJobs`, `seenFetchedJobs` sets. Auto-creates spreadsheet if `SPREADSHEET_ID` is missing. |
| `mailer.js` | Email via nodemailer/Gmail — leads email, job alert email, subscription confirmation, payment rejected, expiry warning for both dealers and candidates |
| `prefilter.js` | `shouldCheckPost(post, dealers)` — fast keyword + intent phrase filter, no AI cost |
| `subreddits.js` | `buildSubredditList(dealers)` — maps dealer city/state to subreddits using `CITY_SUBREDDIT_MAP` |
| `logger.js` | Intercepts `console.log/warn/error` globally, stores last 500 log entries in memory, supports SSE subscriber pattern for live log streaming. Must be `require()`d first in server.js. |
| `public/admin.html` | Admin panel |
| `public/register.html` | Dealer self-registration form |
| `public/register-candidate.html` | Candidate self-registration form |
| `public/pay.html` | Dealer UPI payment page |
| `public/candidate-pay.html` | Candidate UPI payment page |
| `public/images/upi-qr.png` | **Must add manually** — UPI QR code image for payment pages |
| `instagram_session.json` | Auto-created after first Instagram login (gitignored) |
| `gen-lang-client-*.json` | Google service account credentials file (gitignored) |
| `tests/` | Jest test suite — 11 test files |

---

## API Routes

### Dealers

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/register | Register new dealer (required: name, emails, industry_category, services, keywords, state, city) |
| GET | /api/dealers | List all dealers |
| GET | /api/dealers/:id | Get single dealer |
| PUT | /api/dealers/:id | Update dealer fields |
| POST | /api/dealers/:id/toggle | Enable/disable dealer (`{active: true/false}`) |
| POST | /api/dealers/:id/activate-subscription | Manually activate 30-day subscription |
| POST | /api/dealers/:id/reset-subscription | Reset to free tier |

### Leads

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/leads | Matched + assigned leads (last 50) |
| GET | /api/leads/all | All leads (last 500) |
| GET | /api/leads/unmatched | Unmatched leads only |
| POST | /api/leads/:id/assign | Assign lead to one dealer (`{dealer_id}`) |
| POST | /api/leads/:id/assign-many | Assign + email to multiple dealers (`{dealer_ids: []}`) |

### Fetched Posts

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/fetched-posts | All fetched posts (last 200) |
| POST | /api/fetched-posts/:id/send | Manually send a post to a dealer — runs Gemini for suggested reply (`{dealer_id}`) |

### Leads Crawler

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/crawl/start | Start continuous leads crawler loop |
| POST | /api/crawl/stop | Stop leads crawler |
| GET | /api/crawl/status | `{running, postsCollected, leadsFound, emailsSent, lastBatchAt, currentSource}` |

### Dealer Payments

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/payments | Submit UTR (`{dealer_id, utr_number}`) |
| GET | /api/payments | List all payments with dealer names |
| POST | /api/payments/:id/verify | Verify + activate subscription + send confirmation email |
| POST | /api/payments/:id/reject | Reject + send rejection email |

### Candidates

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/candidates/register | Register new candidate (required: name, emails, role, skills, city) |
| GET | /api/candidates | List all candidates |
| GET | /api/candidates/:id | Get single candidate |
| PUT | /api/candidates/:id | Update candidate fields |
| POST | /api/candidates/:id/toggle | Enable/disable candidate (`{active: true/false}`) |
| POST | /api/candidates/:id/activate-subscription | Manually activate 30-day subscription |
| POST | /api/candidates/:id/reset-subscription | Reset to free tier |

### Job Matches

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/job-matches | All job matches (last 200) with candidate names |

### Fetched Jobs

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/fetched-jobs | All fetched jobs (last 200) |
| POST | /api/fetched-jobs/:id/send | Manually send a job to a candidate — no AI tip (`{candidate_id}`) |

### Jobs Crawler

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/jobs/start | Start continuous jobs crawler loop |
| POST | /api/jobs/stop | Stop jobs crawler |
| GET | /api/jobs/status | `{running, jobsCollected, matchesFound, emailsSent, lastBatchAt, currentCandidate}` |

### Candidate Payments

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/candidate-payments | Submit UTR (`{candidate_id, utr_number}`) |
| GET | /api/candidate-payments | List all payments with candidate names |
| POST | /api/candidate-payments/:id/verify | Verify + activate subscription + send confirmation email |
| POST | /api/candidate-payments/:id/reject | Reject + send rejection email |

### Admin & Logging

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/admin/cleanup | Delete old fetched_posts (>60 days) and unmatched leads (>90 days) from the sheet |
| GET | /api/logs | Last 500 log entries as JSON array `[{t, level, msg}]` |
| GET | /api/logs/stream | SSE stream of live log entries |
| GET | /api/debug-env | Shows which env vars are set (values masked) — useful for deployment debugging |

---

## Subscription Model

Both dealers and candidates use identical subscription logic with slightly different free-tier thresholds.

### Dealers (Leads Pipeline)

```
subscription_status = 'active' AND not expired  → 'send'   (unlimited leads)
subscription_status = 'active' AND expired      → 'expired' (reset to free, send expiry email)
lead_count < 2                                  → 'send'
lead_count === 2                                → 'send_with_footer' (email + ₹10 subscribe CTA)
lead_count > 2                                  → 'skip'
```

Free tier: **2 leads** total, then stops.

### Candidates (Jobs Pipeline)

```
subscription_status = 'active' AND not expired  → 'send'   (unlimited job alerts)
subscription_status = 'active' AND expired      → 'expired' (reset to free, send expiry email)
lead_count < 1                                  → 'send'
lead_count === 1                                → 'send_with_footer' (email + ₹10 subscribe CTA)
lead_count > 1                                  → 'skip'
```

Free tier: **1 job alert** total, then stops.

### Payment Flow (same for both)

1. User visits `/pay?dealer_id=X` or `/candidate-pay?candidate_id=X`
2. Scans UPI QR code, pays ₹10, enters UTR number
3. UTR submitted → stored as `pending` in `payments` / `candidate_payments` tab
4. Admin verifies in admin panel → subscription activated for 30 days, `lead_count` reset to 0, confirmation email sent
5. On expiry: detected on next match attempt → subscription reset to free, expiry email sent to user

---

## Admin Panel — Tabs

| Tab | What it shows | Key actions |
|-----|--------------|-------------|
| Dealers | All dealers with subscription status, lead count, city | Enable/Disable, Edit, manual subscription controls |
| Candidates | All candidates with subscription status, lead count, city | Enable/Disable, Edit |
| Matched Leads | Leads sent to dealers by the pipeline | View only |
| Unmatched Leads | Leads AI found but no dealer matched | Assign to one or multiple dealers (sends email) |
| Job Matches | Job alerts sent to candidates | View only |
| Payments (Dealers) | Dealer UTR submissions | Verify → activate subscription / Reject → rejection email |
| Payments (Candidates) | Candidate UTR submissions | Verify / Reject |
| Fetched Posts | Raw Reddit/Instagram posts from every cycle | Send to any dealer (runs Gemini for reply) |
| Fetched Jobs | Raw Adzuna jobs from every cycle | Send to any candidate (no AI tip) |
| Logs | Live log stream from logger.js | Real-time crawler activity |

**Header buttons:** Start/Stop Leads Crawler, Start/Stop Jobs Crawler, Cleanup Old Data (with confirmation dialog).

---

## Industry Categories (21)

Automotive, Real Estate, Travel & Tourism, Education & Coaching,
Healthcare & Wellness, Finance & Insurance, IT Services & Software,
Furniture & Home Decor, Fitness & Gym, Food & Catering,
Construction & Interior Design, Legal Services, Electronics & Gadgets,
Clothing & Fashion, Beauty & Salon, Marketing & Advertising,
Photography & Events, Logistics & Packers Movers, HR & Staffing,
Retail & E-commerce, Other

---

## Key Design Decisions

- **Google Sheets as database** — no SQLite, no Postgres. Easy to inspect and edit manually. Trade-off: non-atomic writes can cause duplicate IDs under concurrent writes.
- **Continuous loops, not cron** — both crawlers run as async while-loops with sleep between cycles. Start/stop via API. Status visible in real time.
- **Single-phase AI (Leads)** — `matcher.js` now handles everything in one Gemini batch call (lead classification + dealer matching). Previously this was two phases: Gemini then Claude Haiku via tool use.
- **Batch AI (Jobs)** — all candidate+job pairs in a cycle are scored in a single Gemini call, with one retry on failure.
- **Adzuna, not Indeed** — `indeed-fetcher.js` calls `api.adzuna.com`. The file name is a legacy artifact from when it used the Indeed API.
- **No Reddit credentials required** — works with public endpoints. Add `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` for higher rate limits; crawler automatically uses OAuth when both are set.
- **Instagram is non-fatal** — all Instagram errors are caught; the leads pipeline continues without it.
- **logger.js must be required first** — it monkey-patches `console.log/warn/error` globally so all modules are captured automatically.
- **In-memory seen sets** — `seenPosts`, `seenJobs`, `seenFetchedJobs` are loaded from Sheets on startup and kept in memory for the process lifetime. Re-fetching within a session uses the in-memory check, not a Sheets query.
- **Factory pattern for tests** — `createApp()` in server.js; tests use `jest.mock('./sheets')` to inject mock data without hitting Google Sheets.

---

## Tests

```bash
npm test   # jest --runInBand (sequential — important because tests share mocked module state)
```

11 test files in `tests/`:

| File | What it tests |
|------|--------------|
| `server.test.js` | All API routes end-to-end |
| `crawler.test.js` | Leads crawler cycle, subscription check for dealers |
| `jobs-crawler.test.js` | Jobs crawler cycle, subscription check for candidates |
| `matcher.test.js` | Gemini lead classification batch (mocked AI) |
| `job-matcher.test.js` | Gemini job relevance scoring batch (mocked AI) |
| `indeed-fetcher.test.js` | Adzuna API fetch (mocked fetch) |
| `instagram.test.js` | Instagram fetcher (mocked child_process) |
| `mailer.test.js` | Email sending (mocked nodemailer) |
| `prefilter.test.js` | Keyword intent filter logic |
| `sheets.test.js` | Google Sheets CRUD (mocked googleapis) |
| `subreddits.test.js` | Subreddit list builder |

---

## Common Issues

**Crawler runs but finds 0 leads**
The `seenPosts` in-memory set is pre-loaded from `fetched_posts` on startup. If all current Reddit posts were already fetched in previous sessions, they're skipped. Check the Fetched Posts admin tab to see what's coming in. Old entries auto-clean after 60 days.

**Google Sheets: `SPREADSHEET_ID` not set**
Run the server once with `GOOGLE_CREDENTIALS_JSON` or `GOOGLE_CREDENTIALS_PATH` set but without `SPREADSHEET_ID`. The server auto-creates the sheet, logs its ID, and exits with `process.exit(0)`. Copy the ID to `.env` then restart normally.

**Sheets write errors / duplicate IDs**
`appendRow()` is non-atomic. Avoid parallel writes to the same tab. The jobs crawler awaits `saveFetchedJob()` sequentially for this reason.

**Email not sending**
`SMTP_PASS` must be a Gmail App Password (16-char code from Google Account → Security → 2-Step → App passwords), not your regular Gmail password.

**Jobs crawler: 0 jobs collected**
`ADZUNA_APP_ID` and `ADZUNA_APP_KEY` must both be set. Verify at `/api/debug-env` — `HAS_ADZUNA` should be `true`.

**Instagram not working**
`INSTAGRAM_USERNAME` and `INSTAGRAM_PASSWORD` must be set. Failures are non-fatal. Check the Logs tab for `[crawler] Instagram failed:` messages. The session file `instagram_session.json` is created after first successful login.

**Subscription expiry warning sent repeatedly after restart**
The `warnedDealers` / `warnedCandidates` Sets are in-memory and reset on server restart. Each fresh start re-sends warnings for subscriptions expiring within 3 days. This is by design.

**`/api/debug-env` shows what's set**
Use this endpoint to quickly verify all credentials are loaded correctly on any environment (local or Render).
