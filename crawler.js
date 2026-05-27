require('dotenv').config();
const { openDb, getActiveDealers, getDealer, saveLead, incrementDealerLeadCount,
        resetDealerSubscription, saveFetchedPost, isSeenPost, markPostSeen } = require('./db');
const { shouldCheckPost } = require('./prefilter');
const { buildSubredditList } = require('./subreddits');
const { processPostBatch } = require('./matcher');
const { sendLeadEmail } = require('./mailer');
const { fetchInstagramLeads } = require('./instagram-fetcher');

const BATCH_SIZE = 200;
const CYCLE_WAIT_MS = 2 * 60 * 1000;
const POST_LIMIT = 25;
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'crawler-bot/1.0';

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
  if (lead_count < 2) return 'send';
  if (lead_count === 2) return 'send_with_footer';
  return 'skip';
}

async function fetchSubredditPosts(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${POST_LIMIT}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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

async function processBatch(buffer, db) {
  const dealers = getActiveDealers(db);
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
      saveLead(db, {
        dealerId: null, redditPostId: post.post_id, postTitle: post.title,
        postText: post.text.slice(0, 500), postUrl: post.url, subreddit: post.subreddit,
        matchReason: null, suggestedReply: result.suggested_reply,
        whatToSell: result.what_to_sell, leadCategory: result.lead_category,
        postLocation: result.post_location, status: 'unmatched',
      });
      continue;
    }

    for (const dealerId of matchedIds) {
      const dealer = getDealer(db, dealerId);
      if (!dealer) continue;

      const action = checkSubscription(dealer);

      if (action === 'expired') {
        resetDealerSubscription(db, dealerId);
        saveLead(db, {
          dealerId: null, redditPostId: post.post_id, postTitle: post.title,
          postText: post.text.slice(0, 500), postUrl: post.url, subreddit: post.subreddit,
          matchReason: null, suggestedReply: result.suggested_reply,
          whatToSell: result.what_to_sell, leadCategory: result.lead_category,
          postLocation: result.post_location, status: 'unmatched',
        });
        continue;
      }

      if (action === 'skip') {
        saveLead(db, {
          dealerId: null, redditPostId: post.post_id, postTitle: post.title,
          postText: post.text.slice(0, 500), postUrl: post.url, subreddit: post.subreddit,
          matchReason: null, suggestedReply: result.suggested_reply,
          whatToSell: result.what_to_sell, leadCategory: result.lead_category,
          postLocation: result.post_location, status: 'unmatched',
        });
        continue;
      }

      saveLead(db, {
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

      incrementDealerLeadCount(db, dealer.id);
      crawlerState.emailsSent++;
      console.log(`[crawler] ✓ ${dealer.name} | ${result.what_to_sell}`);
    }
  }

  crawlerState.lastBatchAt = new Date().toISOString();
}

async function runCycle(db) {
  const dealers = getActiveDealers(db);
  if (!dealers.length) {
    crawlerState.currentSource = 'Waiting - no dealers';
    return;
  }

  const fiveDaysAgo = Date.now() / 1000 - 5 * 86400;
  const seenThisCycle = new Set();
  const buffer = [];

  for (const sub of buildSubredditList(dealers)) {
    if (!crawlerState.running) break;
    if (buffer.length >= BATCH_SIZE) break;
    crawlerState.currentSource = `r/${sub}`;
    try {
      const posts = await fetchSubredditPosts(sub);
      for (const post of posts) {
        if (post.created_utc < fiveDaysAgo) continue;
        if (seenThisCycle.has(post.post_id)) continue;
        if (isSeenPost(db, post.post_id)) continue;
        seenThisCycle.add(post.post_id);
        markPostSeen(db, post.post_id);
        buffer.push(post);
        crawlerState.postsCollected++;
        saveFetchedPost(db, { postId: post.post_id, postTitle: post.title, postText: post.text, postUrl: post.url, subreddit: post.subreddit });
      }
    } catch (err) {
      console.error(`[crawler] r/${sub} failed: ${err.message}`);
    }
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
        if (isSeenPost(db, post.post_id)) continue;
        seenThisCycle.add(post.post_id);
        markPostSeen(db, post.post_id);
        buffer.push(post);
        crawlerState.postsCollected++;
        saveFetchedPost(db, { postId: post.post_id, postTitle: post.title, postText: post.text, postUrl: post.url, subreddit: 'instagram' });
      }
    } catch (err) {
      console.error(`[crawler] Instagram failed: ${err.message}`);
    }
  }

  if (crawlerState.running) {
    await processBatch(buffer, db);
  }
}

async function startCrawler(db) {
  if (crawlerState.running) return;
  const resolvedDb = db || openDb();
  crawlerState.running = true;
  crawlerState.postsCollected = 0;
  crawlerState.leadsFound = 0;
  crawlerState.emailsSent = 0;
  crawlerState.lastBatchAt = null;

  console.log('[crawler] Starting continuous loop...');
  while (crawlerState.running) {
    try {
      await runCycle(resolvedDb);
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
