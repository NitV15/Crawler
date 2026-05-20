require('dotenv').config();
const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendLeadEmail({ dealer, post, matchReason, suggestedReply }) {
  const transport = createTransport();
  const emails = dealer.emails.split(',').map(e => e.trim());
  const preview = post.title || (post.text || '').slice(0, 100);

  const text = `Hi ${dealer.name},

We found a potential customer for you on Reddit.

Post: "${preview}"
Subreddit: r/${post.subreddit}
Link: ${post.url}

Why we matched this to you:
${matchReason}

Suggested reply:
"${suggestedReply}"

---
Crawler — Lead Discovery System`;

  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: `🎯 New Lead Found — ${dealer.industry}`,
    text,
  });
}

module.exports = { sendLeadEmail };
