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

function buildJobAlertText({ candidate, job, suggestedTip, includeSubscribeFooter = false, paymentLink = '' }) {
  let text = `Hi ${candidate.name},

We found a job that matches your profile:

Role:     ${job.job_title}
Company:  ${job.company}
Location: ${job.location}
Posted:   ${job.date || ''}

${job.snippet || ''}

Tip: ${suggestedTip || 'Good luck with your application!'}

Apply here: ${job.job_url}

---
Job Alerts — Powered by Basiq360`;

  if (includeSubscribeFooter) {
    text += `

─────────────────────────────────────────────
You've used your 2 free job alerts!

Subscribe now for ₹10 and get unlimited job alerts for 1 full month.

Click here to subscribe: ${paymentLink}
─────────────────────────────────────────────`;
  }
  return text;
}

async function sendJobAlertEmail({ candidate, job, suggestedTip, includeSubscribeFooter = false, paymentLink = '' }) {
  const transport = createTransport();
  const emails = candidate.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: `New Job Match: ${job.job_title} at ${job.company}`,
    text: buildJobAlertText({ candidate, job, suggestedTip, includeSubscribeFooter, paymentLink }),
  });
}

async function sendCandidateSubscriptionConfirmationEmail(candidate) {
  const transport = createTransport();
  const emails = candidate.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: 'Subscription Activated — Unlimited Job Alerts for 30 Days',
    text: `Hi ${candidate.name},\n\nYour subscription has been activated! You now have unlimited job alerts for the next 30 days.\n\n---\nJob Alerts — Powered by Basiq360`,
  });
}

async function sendCandidatePaymentRejectedEmail(candidate) {
  const transport = createTransport();
  const emails = candidate.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: 'Payment Not Verified — Please Resubmit',
    text: `Hi ${candidate.name},\n\nWe could not verify your payment. Please resubmit your UTR number via the payment page.\n\n---\nJob Alerts — Powered by Basiq360`,
  });
}

module.exports = { sendLeadEmail, sendSubscriptionConfirmationEmail, sendPaymentRejectedEmail, buildEmailText, sendJobAlertEmail, sendCandidateSubscriptionConfirmationEmail, sendCandidatePaymentRejectedEmail };
