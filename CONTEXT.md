# Crawler — Reddit Lead Discovery System

## What This Does

Crawls Reddit for posts where people are looking to buy or hire a service. Matches those posts to registered dealers by category + location, then emails the dealer with the post link and an AI-generated suggested reply.

Example: A dealer selling office furniture in Faridabad gets an email when someone posts "Looking for a good sofa in Sector 15 Faridabad" on r/Faridabad.

---

## How to Run

```bash
npm install
cp .env.example .env   # fill in your API keys
node server.js         # starts at http://localhost:3000
```

### URLs
| Page | URL |
|------|-----|
| Admin panel | http://localhost:3000/admin.html |
| Register dealer | http://localhost:3000/register.html |
| Payment page | http://localhost:3000/pay?dealer_id=<id> |

### Trigger a crawl
- Admin panel → click **Run Crawl**
- Or CLI: `npm run crawl`

---

## Environment Variables (.env)

```
REDDIT_USER_AGENT=crawler-bot/1.0
GEMINI_API_KEY=           # Google AI Studio key
ANTHROPIC_API_KEY=        # Anthropic Console key
SMTP_USER=                # Gmail address
SMTP_PASS=                # Gmail app password (not regular password)
PORT=3000
BASE_URL=http://localhost:3000
```

Gmail app password: Google Account → Security → 2-Step Verification → App passwords.

---

## Architecture

```
Admin clicks "Run Crawl"
  ↓
buildSubredditList(dealers)
  → dealer city/state → CITY_SUBREDDIT_MAP → subreddits
  → INDIA_FALLBACK_SUBREDDITS appended
  ↓
Fetch 25 posts × N subreddits → deduplicate → max 150 posts
  ↓
Save ALL posts to fetched_posts table (admin can view + manually send)
  ↓
Pre-filter (no AI) — intent phrases + dealer keywords
  → ~10-15% pass, rest blocked cheaply
  ↓
[GEMINI 2.5 Flash — per filtered post, no dealer data]
  Returns: is_lead, is_hiring_post, lead_category, what_to_sell,
           suggested_reply, post_location
  → hiring posts and non-leads discarded
  ↓
[CLAUDE Haiku — per confirmed lead, DB tool use]
  Tools: search_dealers(category, city, state)
         get_dealer_details(dealer_id)
  Reasons about geography (NCR = Faridabad + Gurugram + Noida + Delhi)
  Returns: matched_dealer_ids[]
  ↓
For EACH matched dealer → subscription check → email
  lead_count 0-1  : send email, increment count
  lead_count = 2  : send email + "subscribe for ₹1" footer, increment count
  lead_count > 2  : skip (save as unmatched lead)
  subscription active + not expired : send (unlimited)
  subscription expired : reset to free, save as unmatched
  ↓
Unmatched leads → saved in DB → admin can manually assign to any dealer
```

---

## File Map

| File | Purpose |
|------|---------|
| `server.js` | Express app, all API routes, `createApp(db)` factory |
| `crawler.js` | Main orchestration — fetches posts, runs AI pipeline, sends emails |
| `db.js` | SQLite schema, migrations, all DB functions |
| `matcher.js` | Phase 1 — Gemini identifies if post is a lead |
| `dealer-matcher.js` | Phase 2 — Claude matches lead to dealers via tool use |
| `mailer.js` | Sends emails via nodemailer/Gmail |
| `subreddits.js` | City→subreddit map, builds priority subreddit list |
| `prefilter.js` | Fast keyword + intent phrase filter (no AI cost) |
| `public/admin.html` | Admin panel — 5 tabs, Run Crawl button |
| `public/register.html` | Dealer registration form |
| `public/pay.html` | UPI QR + UTR submission for ₹1 subscription |
| `public/images/upi-qr.png` | **You must add this** — your UPI QR code image |
| `tests/` | Jest test suite — 66 tests, 8 suites |

---

## Database Schema

### dealers
```sql
id, name, emails,
industry_category,   -- e.g. "Furniture & Home Decor"
services,            -- what they sell (free text)
target_customers,    -- who they sell to
keywords,            -- comma-separated keywords
state,               -- e.g. "Haryana"
city,                -- e.g. "Faridabad"
service_areas,       -- granular: sectors, villages (free text)
custom_subreddits,   -- extra subreddits beyond city default
lead_count,          -- free tier counter (resets on subscription)
subscription_status, -- 'free' | 'active'
subscription_expires_at,
active               -- 0/1 toggle
```

### leads
```sql
id, dealer_id (nullable = unmatched), reddit_post_id,
post_title, post_text, post_url, subreddit,
what_to_sell, lead_category, post_location,
suggested_reply, match_reason,
status,              -- 'matched' | 'unmatched' | 'assigned'
emailed_at
```

### fetched_posts
```sql
id, post_id (reddit, UNIQUE), post_title, post_text,
post_url, subreddit, fetched_at
```

### payments
```sql
id, dealer_id, utr_number, amount (default 1),
status,              -- 'pending' | 'verified' | 'rejected'
created_at, verified_at
```

### seen_posts
```sql
post_id (PRIMARY KEY), checked_at
-- Prevents re-processing same post across crawl runs
```

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/register | Register new dealer |
| GET | /api/dealers | List all dealers |
| GET | /api/dealers/:id | Get single dealer |
| POST | /api/dealers/:id/toggle | Enable/disable dealer |
| POST | /api/crawl/trigger | Run crawl, returns summary |
| GET | /api/leads | Matched + assigned leads |
| GET | /api/leads/unmatched | Unmatched leads |
| POST | /api/leads/:id/assign | Assign lead to dealer |
| GET | /api/fetched-posts | All fetched posts (last 200) |
| POST | /api/fetched-posts/:id/send | Manually send post to a dealer |
| POST | /api/payments | Submit UTR payment |
| GET | /api/payments | List all payments |
| POST | /api/payments/:id/verify | Verify payment + activate subscription |
| POST | /api/payments/:id/reject | Reject payment + email dealer |
| GET | /pay | Payment page (HTML) |

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

## Subscription Model

- **Free tier**: 2 leads, then emails stop
- **Lead count 2**: Email sent + subscribe footer ("₹1 for unlimited 30 days")
- **Payment flow**: Dealer visits `/pay?dealer_id=X` → scans UPI QR → enters UTR → admin verifies in admin panel → subscription activated → confirmation email sent
- **Subscription**: 30 days unlimited leads, then auto-resets to free

---

## Key Design Decisions

- **No Reddit API credentials** — uses public JSON endpoints (`reddit.com/r/X/new.json`)
- **Manual crawl only** — admin clicks "Run Crawl", no scheduler/cron
- **Two-phase AI** — Gemini (cheap, bulk) for lead ID, Claude (smart) for dealer matching
- **Scalable to 1000+ dealers** — Claude queries DB via tools, never loads all dealers into context
- **All matching dealers get the lead** — one email per (lead × dealer), not winner-takes-all
- **`openDb(':memory:')` for tests** — factory pattern `createApp(db)` makes everything testable
- **seen_posts table** — prevents re-emailing the same Reddit post on subsequent crawl runs

---

## Common Issues

**0 filtered after crawl** — `seen_posts` table has old entries. Clear it:
```bash
node -e "const {openDb}=require('./db'); const db=openDb(); db.prepare('DELETE FROM seen_posts').run(); console.log('cleared')"
```

**Dealer not matching leads** — ensure dealer has `city`, `state`, and `keywords` filled in. The test dealer (id=1) registered before the redesign has empty fields.

**Email not sending** — check `SMTP_USER` and `SMTP_PASS` in `.env`. Use Gmail App Password, not your regular Gmail password.

**Claude matching failing** — check `ANTHROPIC_API_KEY` is set and valid.
