require('dotenv').config();
const Snoowrap = require('snoowrap');
const { openDb, getActiveDealers, isSeenPost, markPostSeen, saveLead } = require('./db');
const { matchPost } = require('./matcher');
const { sendLeadEmail } = require('./mailer');

const SUBREDDITS = ['entrepreneur', 'smallbusiness', 'startups', 'AskIndia', 'india', 'AskReddit'];
const POST_LIMIT = 25;

function createRedditClient() {
  return new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT || 'crawler-bot/1.0',
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
  });
}

async function runCrawl() {
  const db = openDb();
  const dealers = getActiveDealers(db);

  if (!dealers.length) {
    console.log('[crawler] No active dealers. Skipping run.');
    return;
  }

  const reddit = createRedditClient();
  const seenThisRun = new Set();
  let processed = 0, matched = 0;

  for (const subreddit of SUBREDDITS) {
    let posts;
    try {
      posts = await reddit.getSubreddit(subreddit).getNew({ limit: POST_LIMIT });
    } catch (err) {
      console.error(`[crawler] Failed to fetch r/${subreddit}: ${err.message}`);
      continue;
    }

    for (const post of posts) {
      const postId = post.id;
      if (seenThisRun.has(postId) || isSeenPost(db, postId)) continue;
      const postTitle = post.title || '';
      const postText = post.selftext || '';
      if (!postTitle && !postText) continue;

      seenThisRun.add(postId);
      markPostSeen(db, postId);
      processed++;

      try {
        const match = await matchPost({ postTitle, postText, subreddit }, dealers);
        if (!match?.matched) continue;

        const dealer = dealers.find(d => d.id === match.dealer_id);
        if (!dealer) continue;

        saveLead(db, {
          dealerId: dealer.id,
          redditPostId: postId,
          postTitle,
          postText: postText.slice(0, 500),
          postUrl: `https://reddit.com${post.permalink}`,
          subreddit,
          matchReason: match.reason,
          suggestedReply: match.suggested_reply,
        });

        await sendLeadEmail({
          dealer,
          post: { title: postTitle, text: postText, subreddit, url: `https://reddit.com${post.permalink}` },
          matchReason: match.reason,
          suggestedReply: match.suggested_reply,
        });

        matched++;
        console.log(`[crawler] ✓ Match: r/${subreddit} → ${dealer.name} | ${match.reason}`);
      } catch (err) {
        console.error(`[crawler] Error on post ${postId}: ${err.message}`);
      }
    }
  }

  console.log(`[crawler] Run complete — processed: ${processed}, matched: ${matched}`);
}

module.exports = { runCrawl };
