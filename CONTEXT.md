# Crawler — Lead & Job Discovery System

## What This Does

This system has two independent pipelines running on the same Express server:

1. **Leads Pipeline** — Crawls Reddit and Instagram for posts where people are looking to buy a product or service. Matches those posts to registered dealers by category and location using a two-phase AI system (Gemini then Claude), then emails the dealer with the post link and an AI-generated suggested reply.

2. **Jobs Pipeline** — Fetches job listings from Adzuna (the file is named `indeed-fetcher.js` but it calls the Adzuna API) for each registered job candidate based on their role and preferred locations, scores relevance via Gemini in batch, and emails matched listings with an application tip.

Both pipelines run as continuous loops started/stopped via admin API. All data is stored in Google Sheets (no local database). All routes are protected by JWT-based authentication.

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
| Admin login | http://localhost:3000/admin-login.html |
| Admin panel | http://localhost:3000/admin.html (requires admin auth) |
| Dealer login | http://localhost:3000/dealer-login.html |
| Dealer portal | http://localhost:3000/dealer-portal.html (requires dealer auth) |
| Candidate login | http://localhost:3000/candidate-login.html |
| Candidate portal | http://localhost:3000/candidate-portal.html (requires candidate auth) |
| Register dealer | http://localhost:3000/register.html |
| Register candidate | http://localhost:3000/register-candidate.html |
| Dealer payment | http://localhost:3000/pay?dealer_id=\<id\> |
| Candidate payment | http://localhost:3000/candidate-pay?candidate_id=\<id\> |

### Start/stop the crawlers (via API — requires admin auth cookie)
```bash
curl -X POST http://localhost:3000/api/crawl/start
curl -X POST http://localhost:3000/api/jobs/start
```

---

## Environment Variables (.env)

```
# Auth (REQUIRED)
SESSION_SECRET=          # 32-byte hex string — generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ADMIN_EMAIL=             # email address that receives admin OTP codes

# Reddit
REDDIT_USER_AGENT=web:crawler-bot:1.0 (by /u/crawler_bot)
REDDIT_CLIENT_ID=        # optional: Reddit OAuth app client ID (read-only)
REDDIT_CLIENT_SECRET=    # optional: Reddit OAuth app secret

# AI
GEMINI_API_KEY=          # Google AI Studio key (used by both pipelines)
ANTHROPIC_API_KEY=       # Not currently used in code — only appears in /api/debug-env

# Jobs (Adzuna API — despite file being named indeed-fetcher.js)
ADZUNA_APP_ID=           # from api.adzuna.com developer console
ADZUNA_APP_KEY=          # from api.adzuna.com developer console

# Email
SMTP_USER=               # Gmail address (works locally)
SMTP_PASS=               # Gmail App Password — NOT your regular Gmail password
                         # Google Account → Security → 2-Step → App passwords
RESEND_API_KEY=          # Resend API key — used on Render (Gmail SMTP is blocked there)
                         # Get from resend.com. When set, mailer uses smtp.resend.com:465

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
NODE_ENV=production      # set this on Render to enable Secure cookie flag
```

**Render env vars to set:** `SESSION_SECRET`, `ADMIN_EMAIL`, `RESEND_API_KEY`, `NODE_ENV=production`

**Email on Render:** Gmail SMTP is blocked on Render's free tier (connection timeout). `mailer.js` automatically uses Resend SMTP (`smtp.resend.com:465`) when `RESEND_API_KEY` is set. Resend's `onboarding@resend.dev` sender only delivers to the Resend account owner's email — to send to all dealers/candidates, verify a custom domain in Resend.

---

## Authentication System

All API routes (except registration and payment submission) require authentication. Three user types:

| Type | Login page | Portal | Looks up email in |
|------|-----------|--------|-------------------|
| `admin` | `/admin-login.html` | `/admin.html` | `ADMIN_EMAIL` env var |
| `dealer` | `/dealer-login.html` | `/dealer-portal.html` | `dealers` Sheet tab |
| `candidate` | `/candidate-login.html` | `/candidate-portal.html` | `candidates` Sheet tab |

### OTP Flow

1. User enters their registered email on the login page
2. `POST /api/auth/request-otp` → validates email (always returns 200 to prevent enumeration), generates 6-digit OTP, stores in in-memory Map (10-min TTL), sends via email in background
3. User enters OTP code
4. `POST /api/auth/verify-otp` → validates OTP (timing-safe comparison, max 10 attempts), signs JWT `{type, id}` with `SESSION_SECRET`, sets `HttpOnly SameSite=Strict` cookie
5. Redirected to portal

### JWT Sessions

- Stored in `HttpOnly SameSite=Strict` cookie named `cm_auth`
- Signed with `SESSION_SECRET` (HS256), expires in 7 days
- Stateless — no server-side session store — scales to any number of users
- `Secure` flag enabled when `NODE_ENV=production`

### Auth Middleware (`auth-middleware.js`)

```js
requireAuth('dealer', 'admin')  // accepts dealer OR admin
// For non-admin types: also checks req.params.id === payload.id (IDOR prevention)
// Returns 401 if no/invalid token, 403 if wrong type or wrong id
```

### Inactivity Auto-Logout

Client-side (`public/js/auth.js`): 15 min of no activity → 60-second countdown overlay → auto-logout if no response.

### Security Features

- OTP rate limit: 5 requests per email per 10 min (request endpoint)
- OTP verify rate limit: 10 failed attempts locks out and invalidates the OTP
- Registration rate limit: 5 requests per IP per 15 min
- Payment rate limit: 10 requests per IP per 15 min
- `helmet` security headers on all routes (X-Frame-Options: DENY, etc.)
- UTR number format validated: `/^[A-Za-z0-9]{8,25}$/`
- Email uniqueness check on profile updates (prevents account takeover)
- Timing-safe OTP comparison (`crypto.timingSafeEqual`)
- Server refuses to start without `SESSION_SECRET`

---

## User Portals

### Dealer Portal (`/dealer-portal.html`)

Self-service dashboard for dealers. Requires dealer JWT cookie.

- **Stats row:** Total leads, Subscription status + expiry, Leads this month
- **Subscription banner:** Orange if expiring ≤3 days, Red if expired or free leads exhausted
- **Leads table:** Paginated (20/page), shows post title, source, category, AI suggested reply snippet, "View Post →" link
- **Edit Profile:** Centered modal via nav dropdown — all fields except email. Saves via `PUT /api/dealers/:id`
- **Theme toggle:** Dark (default) / Light — persisted in `localStorage`

### Candidate Portal (`/candidate-portal.html`)

Same structure as dealer portal but shows job alerts.

- **Stats row:** Total job alerts, Subscription status, Role + city
- **Job alerts table:** Paginated (20/page), shows job title, company, location, snippet, AI application tip, "Apply →" link
- **Edit Profile:** Name, role, skills, experience level, city, state, preferred locations

### Shared Client Module (`public/js/auth.js`)

Loaded by all portal and login pages. Exposes `window.CmAuth`:
- `initTheme()` / `toggleTheme()` — dark/light via `data-theme` + `localStorage`
- `requirePortalAuth(type, loginUrl)` — calls `/api/auth/me`, redirects if wrong type
- `logout(loginUrl)` — calls `POST /api/auth/logout`, redirects
- `initIdleTimer(loginUrl)` — 15 min idle → 60s countdown → auto-logout
- `dismissCountdown(loginUrl)` — "Stay logged in" handler
- `initOtpInputs()` — wires up 6 individual OTP digit boxes with auto-advance, backspace, paste support
- `getOtpValue()` — returns current 6-digit code

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
  'send'             → saveJobMatch() + sendJobAlertEmail() + incrementCandidateLeadCount()
  'send_with_footer' → same + ₹10/month subscribe CTA in email
```

---

## Data Storage — Google Sheets

All data lives in a single Google Spreadsheet with 8 tabs. There is no local SQLite or other database.

`sheets.js` handles all reads/writes. It uses an in-memory cache for `seenPosts`, `seenJobs`, and `seenFetchedJobs` to avoid re-processing across cycles without re-querying the sheet.

**Important:** `appendRow()` uses `rows.length + 1` as the next ID. This is non-atomic — if two writes happen concurrently, IDs can collide.

### Tabs: `dealers`, `leads`, `payments`, `fetched_posts`, `candidates`, `job_matches`, `candidate_payments`, `fetched_jobs`

See original schema documentation — unchanged. Key: `dealers.emails` is comma-separated and used for OTP email lookup.

---

## File Map

| File | Purpose |
|------|---------|
| `server.js` | Express app, all API routes. Entry point. `createApp()` exported for tests. Uses `helmet`, `express-rate-limit`, `cookie-parser`. |
| `auth-middleware.js` | `requireAuth(...types)` — verifies JWT cookie, checks type, checks id match for non-admin |
| `crawler.js` | Leads pipeline orchestrator |
| `jobs-crawler.js` | Jobs pipeline orchestrator |
| `matcher.js` | Leads AI — `processPostBatch()` + `identifyLead()` |
| `job-matcher.js` | Jobs AI — `processJobBatch()` |
| `indeed-fetcher.js` | Adzuna API client (named "indeed" for legacy reasons) |
| `instagram-fetcher.js` | Instagram source via Python child_process |
| `instagram_scraper.py` | Python `instagrapi` scraper |
| `sheets.js` | Google Sheets data layer — all 8 tabs. Exports `readSheet`. |
| `mailer.js` | All email sending. Auto-selects Resend SMTP (if `RESEND_API_KEY` set) or Gmail. |
| `prefilter.js` | `shouldCheckPost()` — fast keyword filter, no AI cost |
| `subreddits.js` | `buildSubredditList()` — city→subreddit map |
| `logger.js` | Global console interceptor, last 500 logs, SSE streaming. Must be required first. |
| `public/js/auth.js` | Shared client auth module — theme, idle timer, OTP inputs, auth check |
| `public/admin.html` | Admin panel (requires admin JWT cookie) |
| `public/admin-login.html` | Admin OTP login |
| `public/dealer-login.html` | Dealer OTP login |
| `public/candidate-login.html` | Candidate OTP login |
| `public/dealer-portal.html` | Dealer self-service portal |
| `public/candidate-portal.html` | Candidate self-service portal |
| `public/register.html` | Dealer registration (public) |
| `public/register-candidate.html` | Candidate registration (public) |
| `public/pay.html` | Dealer UPI payment page (public) |
| `public/candidate-pay.html` | Candidate UPI payment page (public) |
| `public/images/upi-qr.png` | **Must add manually** — UPI QR code |
| `tests/` | Jest test suite — 12 test files, 151 tests |

---

## API Routes

### Auth (public)

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/request-otp | `{email, type}` → always 200, sends OTP if email found |
| POST | /api/auth/verify-otp | `{email, otp, type}` → validates, sets JWT cookie |
| POST | /api/auth/logout | Clears JWT cookie |
| GET | /api/auth/me | Returns `{type, id, name}` for current session |

### Dealers

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/register | Public | Register new dealer |
| GET | /api/dealers | Admin | List all dealers |
| GET | /api/dealers/:id | Dealer/Admin | Get single dealer |
| PUT | /api/dealers/:id | Dealer/Admin | Update dealer (validates email uniqueness) |
| POST | /api/dealers/:id/toggle | Admin | Enable/disable |
| POST | /api/dealers/:id/activate-subscription | Admin | Manually activate |
| POST | /api/dealers/:id/reset-subscription | Admin | Reset to free |
| GET | /api/dealers/:id/leads | Dealer/Admin | Paginated leads for this dealer (`?page=N`, max 100) |
| GET | /api/dealers/:id/stats | Dealer/Admin | `{total_leads, this_month, subscription_status, subscription_expires_at, lead_count}` |

### Leads

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /api/leads | Admin | All matched+assigned leads (last 50) |
| GET | /api/leads/all | Admin | All leads (last 500) |
| GET | /api/leads/unmatched | Admin | Unmatched leads |
| POST | /api/leads/:id/assign | Admin | Assign to one dealer |
| POST | /api/leads/:id/assign-many | Admin | Assign + email to multiple dealers |
| GET | /api/fetched-posts | Admin | Last 200 raw posts |
| POST | /api/fetched-posts/:id/send | Admin | Manually send post to dealer |

### Leads Crawler

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/crawl/start | Admin | Start continuous loop |
| POST | /api/crawl/stop | Admin | Stop |
| GET | /api/crawl/status | Admin | `{running, postsCollected, leadsFound, emailsSent, lastBatchAt, currentSource}` |

### Dealer Payments

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/payments | Public (rate limited) | Submit UTR (validates format) |
| GET | /api/payments | Admin | List all |
| POST | /api/payments/:id/verify | Admin | Verify + activate subscription |
| POST | /api/payments/:id/reject | Admin | Reject + email dealer |

### Candidates

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/candidates/register | Public | Register new candidate |
| GET | /api/candidates | Admin | List all |
| GET | /api/candidates/:id | Candidate/Admin | Get single |
| PUT | /api/candidates/:id | Candidate/Admin | Update (validates email uniqueness) |
| POST | /api/candidates/:id/toggle | Admin | Enable/disable |
| POST | /api/candidates/:id/activate-subscription | Admin | Manually activate |
| POST | /api/candidates/:id/reset-subscription | Admin | Reset to free |
| GET | /api/candidates/:id/job-matches | Candidate/Admin | Paginated job alerts (`?page=N`, max 100) |
| GET | /api/candidates/:id/stats | Candidate/Admin | `{total_alerts, subscription_status, subscription_expires_at, lead_count, role, city}` |

### Jobs Crawler & Matches

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/jobs/start | Admin | Start continuous loop |
| POST | /api/jobs/stop | Admin | Stop |
| GET | /api/jobs/status | Admin | `{running, jobsCollected, matchesFound, emailsSent, lastBatchAt, currentCandidate}` |
| GET | /api/job-matches | Admin | All job matches (last 200) |
| GET | /api/fetched-jobs | Admin | Last 200 raw jobs |
| POST | /api/fetched-jobs/:id/send | Admin | Manually send job to candidate |

### Candidate Payments

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/candidate-payments | Public (rate limited) | Submit UTR |
| GET | /api/candidate-payments | Admin | List all |
| POST | /api/candidate-payments/:id/verify | Admin | Verify + activate |
| POST | /api/candidate-payments/:id/reject | Admin | Reject |

### Admin & Logging

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/admin/cleanup | Admin | Delete old data from sheets |
| GET | /api/logs | Admin | Last 500 log entries `[{t, level, msg}]` |
| GET | /api/logs/stream | Admin | SSE live log stream |
| GET | /api/debug-env | Admin | Which env vars are set (values masked) |

---

## Subscription Model

### Dealers (Leads Pipeline)

```
subscription_status = 'active' AND not expired  → 'send'   (unlimited leads)
subscription_status = 'active' AND expired      → 'expired' (reset to free, send expiry email)
lead_count < 2                                  → 'send'
lead_count === 2                                → 'send_with_footer' (email + ₹10 subscribe CTA)
lead_count > 2                                  → 'skip'
```

### Candidates (Jobs Pipeline)

```
subscription_status = 'active' AND not expired  → 'send'
lead_count < 1                                  → 'send'
lead_count === 1                                → 'send_with_footer'
lead_count > 1                                  → 'skip'
```

### Payment Flow

1. User visits `/pay?dealer_id=X` or `/candidate-pay?candidate_id=X`
2. Scans UPI QR → enters UTR (validated: 8–25 alphanumeric chars)
3. Admin verifies in admin panel → 30-day subscription activated, `lead_count` reset to 0

---

## Admin Panel — Tabs

| Tab | Auth | Key actions |
|-----|------|-------------|
| Dealers | Admin | Enable/Disable, Edit, subscription controls |
| Candidates | Admin | Enable/Disable, Edit |
| Matched Leads | Admin | View only |
| Unmatched Leads | Admin | Assign to one or multiple dealers |
| Job Matches | Admin | View only |
| Payments (Dealers) | Admin | Verify / Reject |
| Payments (Candidates) | Admin | Verify / Reject |
| Fetched Posts | Admin | Send to any dealer (runs Gemini for reply) |
| Fetched Jobs | Admin | Send to any candidate |
| Logs | Admin | Real-time crawler activity via SSE |

Admin panel is hidden until auth confirms (`visibility:hidden` until JWT verified).

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

- **JWT stateless auth** — no session store, scales to 1000s of users, server restarts don't log users out
- **OTP via email** — no passwords to manage. Dealers/candidates use their registered email; admin uses `ADMIN_EMAIL` env var
- **Google Sheets as database** — no SQLite, no Postgres. Easy to inspect manually. Non-atomic writes can produce duplicate IDs under concurrency.
- **Continuous loops, not cron** — both crawlers run as async while-loops. Start/stop via API.
- **Single-phase AI (Leads)** — Gemini batch call handles lead classification + dealer matching in one request
- **Batch AI (Jobs)** — all candidate+job pairs scored in a single Gemini call per cycle
- **Adzuna, not Indeed** — `indeed-fetcher.js` calls `api.adzuna.com` (legacy name)
- **Email on Render** — Gmail SMTP is blocked on Render free tier. Use `RESEND_API_KEY` to route via Resend SMTP. Domain verification needed to send to all users.
- **OTP fire-and-forget** — email sent in background so response is immediate regardless of SMTP speed
- **logger.js must be required first** — monkey-patches `console.log/warn/error` globally

---

## Tests

```bash
npm test   # jest --runInBand
```

12 test files, 151 tests. All pass. Protected routes in `server.test.js` use an admin JWT cookie header.

```js
// Pattern used in server.test.js for protected routes:
process.env.SESSION_SECRET = 'test-secret';
const jwt = require('jsonwebtoken');
const adminToken = jwt.sign({ type: 'admin', id: 0 }, 'test-secret');
request(app).get('/api/dealers').set('Cookie', `cm_auth=${adminToken}`)
```

---

## Common Issues

**Admin login "email not found"**
Check `ADMIN_EMAIL` env var is set on Render. Must exactly match what you type in the login form.

**OTP email not arriving on Render**
Gmail SMTP is blocked on Render's free tier. Set `RESEND_API_KEY` on Render. With Resend's `onboarding@resend.dev` sender, emails only deliver to the Resend account owner's email. To send to all users, verify a custom domain in Resend.

**OTP shows "Sending…" indefinitely**
Fixed — OTP email is now sent in background. If stuck, check Render logs for `[auth] OTP email failed:` error.

**Admin panel briefly visible before redirect**
Not a data leak — all API calls require auth so 401 is returned. Panel body is hidden with `visibility:hidden` until auth check completes.

**Crawler runs but finds 0 leads**
`seenPosts` in-memory set is pre-loaded from `fetched_posts` on startup. Old posts auto-clean after 60 days.

**Sheets write errors / duplicate IDs**
`appendRow()` is non-atomic. Avoid parallel writes to the same tab.

**`/api/debug-env` shows what's set**
Use this endpoint to verify all credentials are loaded on any environment. Requires admin auth.

**Server refuses to start**
`SESSION_SECRET` must be set. Server calls `process.exit(1)` if missing.
