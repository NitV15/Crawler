require('dotenv').config();
const { getActiveDealers, getDealer, saveLead, incrementDealerLeadCount,
        resetDealerSubscription, saveFetchedPost, isSeenPost, markPostSeen } = require('./sheets');
const { shouldCheckPost } = require('./prefilter');
const { buildSubredditList } = require('./subreddits');
const { processPostBatch } = require('./matcher');
const { sendLeadEmail, sendSubscriptionExpiryWarningEmail, sendSubscriptionExpiredEmail } = require('./mailer');
const { fetchInstagramLeads } = require('./instagram-fetcher');

const BATCH_SIZE = 200;
const CYCLE_WAIT_MS = 2 * 60 * 1000;
const POST_LIMIT = 25;
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'web:crawler-bot:1.0 (by /u/crawler_bot)';
const warnedDealers = new Set();
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

let redditToken = null;
let redditTokenExpiry = 0;

async function getRedditToken() {
  if (redditToken && Date.now() < redditTokenExpiry - 60000) return redditToken;
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) { console.error(`[reddit] Token fetch failed: HTTP ${res.status}`); return null; }
  const data = await res.json();
  redditToken = data.access_token;
  redditTokenExpiry = Date.now() + data.expires_in * 1000;
  return redditToken;
}

const crawlerState = {
  running: false,
  postsCollected: 0,
  leadsFound: 0,
  emailsSent: 0,
  lastBatchAt: null,
  currentSource: null,
};

function getCrawlerStatus() {
  return { ...crawlerState };
}

function stopCrawler() {
  crawlerState.running = false;
}

function checkSubscription(dealer) {
  const { lead_count, subscription_status, subscription_expires_at } = dealer;
  if (subscription_status === 'active') {
    if (!subscription_expires_at || new Date(subscription_expires_at) > new Date()) return 'send';
    return 'expired';
  }
  const count = parseInt(lead_count);
  if (count < 2) return 'send';
  if (count === 2) return 'send_with_footer';
  return 'skip';
}

async function fetchSubredditPosts(subreddit) {
  const token = await getRedditToken();
  const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const url = `${base}/r/${subreddit}/new.json?limit=${POST_LIMIT}`;
  const headers = { 'User-Agent': USER_AGENT };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data.children.map(c => ({
    post_id: `reddit_${c.data.id}`,
    title: c.data.title || '',
    text: c.data.selftext || '',
    subreddit,
    source: 'reddit',
    created_utc: c.data.created_utc,
    url: `https://reddit.com${c.data.permalink}`,
  }));
}

async function processBatch(buffer) {
  const dealers = await getActiveDealers();
  if (!dealers.length) return;

  const filtered = buffer.filter(p => shouldCheckPost({ title: p.title, text: p.text }, dealers));

  crawlerState.currentSource = 'Processing batch';
  const results = await processPostBatch(filtered, dealers);

  const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

  for (const result of results) {
    if (!result.is_lead || result.is_hiring_post) continue;
    crawlerState.leadsFound++;

    const post = filtered.find(p => p.post_id === result.post_id);
    if (!post) continue;

    const matchedIds = result.matched_dealer_ids || [];

    if (!matchedIds.length) {
      await saveLead({
        dealerId: null, redditPostId: post.post_id, postTitle: post.title,
        postText: post.text.slice(0, 500), postUrl: post.url, subreddit: post.subreddit,
        matchReason: null, suggestedReply: result.suggested_reply,
        whatToSell: result.what_to_sell, leadCategory: result.lead_category,
        postLocation: result.post_location, status: 'unmatched',
      });
      continue;
    }

    for (const dealerId of matchedIds) {
      const dealer = await getDealer(dealerId);
      if (!dealer) continue;

      const action = checkSubscription(dealer);

      if (action === 'expired') {
        await resetDealerSubscription(dealerId);
        sendSubscriptionExpiredEmail(dealer, `${BASE_URL}/pay?dealer_id=${dealer.id}`)
          .catch(err => console.error(`[crawler] Expiry email failed for ${dealer.name}: ${err.message}`));
        await saveLead({
          dealerId: null, redditPostId: post.post_id, postTitle: post.title,
          postText: post.text.slice(0, 500), postUrl: post.url, subreddit: post.subreddit,
          matchReason: null, suggestedReply: result.suggested_reply,
          whatToSell: result.what_to_sell, leadCategory: result.lead_category,
          postLocation: result.post_location, status: 'unmatched',
        });
        continue;
      }

      if (action === 'skip') {
        await saveLead({
          dealerId: null, redditPostId: post.post_id, postTitle: post.title,
          postText: post.text.slice(0, 500), postUrl: post.url, subreddit: post.subreddit,
          matchReason: null, suggestedReply: result.suggested_reply,
          whatToSell: result.what_to_sell, leadCategory: result.lead_category,
          postLocation: result.post_location, status: 'unmatched',
        });
        continue;
      }

      await saveLead({
        dealerId: dealer.id, redditPostId: post.post_id, postTitle: post.title,
        postText: post.text.slice(0, 500), postUrl: post.url, subreddit: post.subreddit,
        matchReason: `Category: ${result.lead_category}`, suggestedReply: result.suggested_reply,
        whatToSell: result.what_to_sell, leadCategory: result.lead_category,
        postLocation: result.post_location, status: 'matched',
      });

      await sendLeadEmail({
        dealer,
        post: { title: post.title, text: post.text, subreddit: post.subreddit, url: post.url, whatToSell: result.what_to_sell },
        suggestedReply: result.suggested_reply,
        includeSubscribeFooter: action === 'send_with_footer',
        paymentLink: `${BASE_URL}/pay?dealer_id=${dealer.id}`,
      });

      await incrementDealerLeadCount(dealer.id);
      crawlerState.emailsSent++;
      console.log(`[crawler] ✓ ${dealer.name} | ${result.what_to_sell}`);
    }
  }

  crawlerState.lastBatchAt = new Date().toISOString();
}

async function runCycle() {
  const dealers = await getActiveDealers();
  if (!dealers.length) {
    crawlerState.currentSource = 'Waiting - no dealers';
    return;
  }

  const now = Date.now();
  const BASE_URL_WARN = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  for (const dealer of dealers) {
    if (dealer.subscription_status !== 'active' || !dealer.subscription_expires_at) continue;
    const expiresAt = new Date(dealer.subscription_expires_at).getTime();
    if (expiresAt > now && expiresAt <= now + THREE_DAYS_MS && !warnedDealers.has(String(dealer.id))) {
      warnedDealers.add(String(dealer.id));
      sendSubscriptionExpiryWarningEmail(dealer, `${BASE_URL_WARN}/pay?dealer_id=${dealer.id}`)
        .catch(err => console.error(`[crawler] Warning email failed for ${dealer.name}: ${err.message}`));
    }
  }

  const fiveDaysAgo = Date.now() / 1000 - 5 * 86400;
  const seenThisCycle = new Set();
  const buffer = [];

  let rateLimited = false;
  for (const sub of buildSubredditList(dealers)) {
    if (!crawlerState.running) break;
    if (buffer.length >= BATCH_SIZE) break;
    if (rateLimited) break;
    crawlerState.currentSource = `r/${sub}`;
    try {
      const posts = await fetchSubredditPosts(sub);
      for (const post of posts) {
        if (post.created_utc < fiveDaysAgo) continue;
        if (seenThisCycle.has(post.post_id)) continue;
        if (isSeenPost(post.post_id)) continue;
        seenThisCycle.add(post.post_id);
        buffer.push(post);
        crawlerState.postsCollected++;
        await saveFetchedPost({ postId: post.post_id, postTitle: post.title, postText: post.text, postUrl: post.url, subreddit: post.subreddit });
      }
    } catch (err) {
      if (err.message.includes('429')) {
        console.warn(`[crawler] r/${sub} rate limited — stopping cycle, waiting longer`);
        crawlerState.currentSource = 'Rate limited — backing off';
        await new Promise(r => setTimeout(r, 60000));
        rateLimited = true;
      } else if (!err.message.includes('403')) {
        console.error(`[crawler] r/${sub} failed: ${err.message}`);
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (crawlerState.running && buffer.length < BATCH_SIZE) {
    crawlerState.currentSource = 'Instagram';
    try {
      const raw = await fetchInstagramLeads(dealers);
      for (const p of raw) {
        const post = {
          post_id: `insta_${p.id || p.post_id || Date.now()}`,
          title: p.caption || p.title || '',
          text: p.text || '',
          subreddit: 'instagram',
          source: 'instagram',
          created_utc: p.created_utc || (Date.now() / 1000),
          url: p.url || p.permalink || '',
        };
        if (post.created_utc < fiveDaysAgo) continue;
        if (seenThisCycle.has(post.post_id)) continue;
        if (isSeenPost(post.post_id)) continue;
        seenThisCycle.add(post.post_id);
        buffer.push(post);
        crawlerState.postsCollected++;
        await saveFetchedPost({ postId: post.post_id, postTitle: post.title, postText: post.text, postUrl: post.url, subreddit: 'instagram' });
      }
    } catch (err) {
      console.error(`[crawler] Instagram failed: ${err.message}`);
    }
  }

  if (crawlerState.running) {
    await processBatch(buffer);
  }
}

async function startCrawler() {
  if (crawlerState.running) return;
  crawlerState.running = true;
  crawlerState.postsCollected = 0;
  crawlerState.leadsFound = 0;
  crawlerState.emailsSent = 0;
  crawlerState.lastBatchAt = null;

  console.log('[crawler] Starting continuous loop...');
  while (crawlerState.running) {
    try {
      await runCycle();
    } catch (err) {
      console.error('[crawler] Cycle error:', err.message);
    }
    if (crawlerState.running) {
      crawlerState.currentSource = 'Waiting (2 min)';
      await new Promise(r => setTimeout(r, CYCLE_WAIT_MS));
    }
  }
  crawlerState.currentSource = 'Stopped';
  console.log('[crawler] Stopped.');
}

module.exports = { startCrawler, stopCrawler, getCrawlerStatus, checkSubscription };
