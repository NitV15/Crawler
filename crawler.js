require('dotenv').config();
const { openDb, getActiveDealers, getDealer, isSeenPost, markPostSeen,
        saveLead, incrementDealerLeadCount, resetDealerSubscription,
        saveFetchedPost } = require('./db');
const { shouldCheckPost } = require('./prefilter');
const { buildSubredditList } = require('./subreddits');
const { identifyLead } = require('./matcher');
const { matchDealers } = require('./dealer-matcher');
const { sendLeadEmail } = require('./mailer');
const { fetchIndiaMartLeads } = require('./indiamart-fetcher');

const POST_LIMIT = 25;
const TARGET_POSTS = 150;
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'crawler-bot/1.0';

async function fetchSubredditPosts(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${POST_LIMIT}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data.children.map(c => ({ ...c.data, _subreddit: subreddit }));
}

async function collectPosts(dealers) {
  const postMap = new Map();
  for (const sub of buildSubredditList(dealers)) {
    if (postMap.size >= TARGET_POSTS) break;
    try {
      const posts = await fetchSubredditPosts(sub);
      posts.forEach(p => { if (!postMap.has(p.id)) postMap.set(p.id, p); });
    } catch (err) {
      console.error(`[crawler] Failed r/${sub}: ${err.message}`);
    }
  }
  return [...postMap.values()].slice(0, TARGET_POSTS);
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

async function runCrawl(db) {
  const resolvedDb = db || openDb();
  const dealers = getActiveDealers(resolvedDb);

  if (!dealers.length) {
    console.log('[crawler] No active dealers.');
    return { fetched: 0, filtered: 0, leads: 0, emails: 0, unmatched: 0 };
  }

  const [redditPosts, indiamartPosts] = await Promise.all([
    collectPosts(dealers),
    fetchIndiaMartLeads(dealers).catch(err => {
      console.error(`[crawler] IndiaMART fetch failed: ${err.message}`);
      return [];
    }),
  ]);
  const allPosts = [...redditPosts, ...indiamartPosts];
  console.log(`[crawler] Fetched ${redditPosts.length} Reddit + ${indiamartPosts.length} IndiaMART posts`);

  // Save all fetched posts to DB so admin can view and manually send them
  allPosts.forEach(p => saveFetchedPost(resolvedDb, {
    postId: p.id,
    postTitle: p.title || '',
    postText: p.selftext || '',
    postUrl: `https://reddit.com${p.permalink}`,
    subreddit: p._subreddit || 'unknown',
  }));

  // Filter BEFORE marking seen — isSeenPost checks the previous run's seen set
  let seenCount = 0, emptyCount = 0, prefilterCount = 0;
  const filteredPosts = allPosts.filter(p => {
    if (isSeenPost(resolvedDb, p.id)) { seenCount++; return false; }
    if (!p.title && !p.selftext) { emptyCount++; return false; }
    const passes = shouldCheckPost({ title: p.title || '', text: p.selftext || '' }, dealers);
    if (!passes) prefilterCount++;
    return passes;
  });
  console.log(`[crawler] Filter breakdown — seen: ${seenCount}, empty: ${emptyCount}, prefilter blocked: ${prefilterCount}, passed: ${filteredPosts.length}`);

  // Mark all fetched posts seen so the next run skips them
  allPosts.forEach(p => markPostSeen(resolvedDb, p.id));

  let leads = 0, emails = 0, unmatched = 0;

  for (const post of filteredPosts) {
    const subreddit = post._subreddit || 'unknown';
    const postTitle = post.title || '';
    const postText = post.selftext || '';
    const postUrl = post.permalink?.startsWith('http')
      ? post.permalink
      : `https://reddit.com${post.permalink}`;

    try {
      console.log(`[crawler] Gemini checking: "${postTitle.slice(0, 60)}" (r/${subreddit})`);
      const lead = await identifyLead({ postTitle, postText, subreddit });
      if (lead.is_hiring_post) { console.log(`[crawler]   → hiring post, skipped`); continue; }
      if (!lead.is_lead) { console.log(`[crawler]   → not a lead`); continue; }
      console.log(`[crawler]   → LEAD: ${lead.lead_category} | "${lead.what_to_sell}" | loc: ${lead.post_location || 'none'}`);
      leads++;

      const matchedIds = await matchDealers({ ...lead, subreddit }, resolvedDb);
      console.log(`[crawler]   → matched dealers: ${matchedIds.length ? matchedIds.join(', ') : 'none'}`);

      if (!matchedIds.length) {
        saveLead(resolvedDb, {
          dealerId: null, redditPostId: post.id, postTitle, postText: postText.slice(0, 500),
          postUrl, subreddit, matchReason: null, suggestedReply: lead.suggested_reply,
          whatToSell: lead.what_to_sell, leadCategory: lead.lead_category,
          postLocation: lead.post_location, status: 'unmatched',
        });
        unmatched++;
        continue;
      }

      for (const dealerId of matchedIds) {
        const dealer = getDealer(resolvedDb, dealerId);
        if (!dealer) continue;

        const action = checkSubscription(dealer);
        console.log(`[crawler]   → dealer "${dealer.name}" action: ${action}`);

        if (action === 'expired') {
          resetDealerSubscription(resolvedDb, dealerId);
          saveLead(resolvedDb, {
            dealerId: null, redditPostId: post.id, postTitle, postText: postText.slice(0, 500),
            postUrl, subreddit, matchReason: null, suggestedReply: lead.suggested_reply,
            whatToSell: lead.what_to_sell, leadCategory: lead.lead_category,
            postLocation: lead.post_location, status: 'unmatched',
          });
          unmatched++;
          continue;
        }

        if (action === 'skip') {
          saveLead(resolvedDb, {
            dealerId: null, redditPostId: post.id, postTitle, postText: postText.slice(0, 500),
            postUrl, subreddit, matchReason: null, suggestedReply: lead.suggested_reply,
            whatToSell: lead.what_to_sell, leadCategory: lead.lead_category,
            postLocation: lead.post_location, status: 'unmatched',
          });
          unmatched++;
          continue;
        }

        const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
        saveLead(resolvedDb, {
          dealerId: dealer.id, redditPostId: post.id, postTitle, postText: postText.slice(0, 500),
          postUrl, subreddit, matchReason: `Category: ${lead.lead_category}`, suggestedReply: lead.suggested_reply,
          whatToSell: lead.what_to_sell, leadCategory: lead.lead_category,
          postLocation: lead.post_location, status: 'matched',
        });

        await sendLeadEmail({
          dealer,
          post: { title: postTitle, text: postText, subreddit, url: postUrl, whatToSell: lead.what_to_sell },
          suggestedReply: lead.suggested_reply,
          includeSubscribeFooter: action === 'send_with_footer',
          paymentLink: `${BASE_URL}/pay?dealer_id=${dealer.id}`,
        });

        incrementDealerLeadCount(resolvedDb, dealer.id);
        emails++;
        console.log(`[crawler] ✓ ${dealer.name} | ${lead.what_to_sell}`);
      }
    } catch (err) {
      console.error(`[crawler] Error on post ${post.id}: ${err.message}`);
    }
  }

  const summary = { fetched: allPosts.length, filtered: filteredPosts.length, leads, emails, unmatched };
  console.log(`[crawler] Done — ${JSON.stringify(summary)}`);
  return summary;
}

module.exports = { runCrawl, fetchSubredditPosts, collectPosts, checkSubscription };
