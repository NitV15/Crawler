require('dotenv').config();
const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function buildEmailText({ dealer, post, suggestedReply, includeSubscribeFooter = false, paymentLink = '' }) {
  const preview = post.title || (post.text || '').slice(0, 100);
  let text = `Hi ${dealer.name},

We found a potential customer for you on Reddit.

Post: "${preview}"
Subreddit: r/${post.subreddit}
Link: ${post.url}

What we can sell: ${post.whatToSell || ''}

Suggested reply:
"${suggestedReply}"

---
Crawler — Lead Discovery System`;

  if (includeSubscribeFooter) {
    text += `

─────────────────────────────────────────────
You've used your 2 free leads!

Subscribe now for ₹1 and get unlimited leads for 1 full month.

Click here to subscribe: ${paymentLink}
─────────────────────────────────────────────`;
  }
  return text;
}

async function sendLeadEmail({ dealer, post, suggestedReply, includeSubscribeFooter = false, paymentLink = '' }) {
  const transport = createTransport();
  const emails = dealer.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: `New Lead Found — ${dealer.industry_category || dealer.industry || 'General'}`,
    text: buildEmailText({ dealer, post, suggestedReply, includeSubscribeFooter, paymentLink }),
  });
}

async function sendSubscriptionConfirmationEmail(dealer) {
  const transport = createTransport();
  const emails = dealer.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: 'Subscription Activated — Unlimited Leads for 30 Days',
    text: `Hi ${dealer.name},\n\nYour subscription has been activated! You now have unlimited leads for the next 30 days.\n\n---\nCrawler — Lead Discovery System`,
  });
}

async function sendPaymentRejectedEmail(dealer) {
  const transport = createTransport();
  const emails = dealer.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: 'Payment Not Verified — Please Resubmit',
    text: `Hi ${dealer.name},\n\nWe could not verify your payment. Please resubmit your UTR number via the payment page.\n\n---\nCrawler — Lead Discovery System`,
  });
}

module.exports = { sendLeadEmail, sendSubscriptionConfirmationEmail, sendPaymentRejectedEmail, buildEmailText };
