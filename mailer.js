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

Subscribe now for ₹10 and get unlimited leads for 1 full month.

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

function buildExpiryWarningText(dealer, paymentLink = '') {
  return `Hi ${dealer.name},

Your lead subscription expires in 3 days.

Renew now to keep receiving unlimited leads without interruption.

Renew here: ${paymentLink}

---
Crawler — Lead Discovery System`;
}

function buildExpiredText(dealer, paymentLink = '') {
  return `Hi ${dealer.name},

Your lead subscription has expired. You are now back on the free tier (2 leads).

Renew to continue receiving unlimited leads.

Renew here: ${paymentLink}

---
Crawler — Lead Discovery System`;
}

async function sendSubscriptionExpiryWarningEmail(dealer, paymentLink) {
  const transport = createTransport();
  const emails = dealer.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: 'Your lead subscription expires in 3 days — renew now',
    text: buildExpiryWarningText(dealer, paymentLink),
  });
}

async function sendSubscriptionExpiredEmail(dealer, paymentLink) {
  const transport = createTransport();
  const emails = dealer.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: 'Your lead subscription has expired',
    text: buildExpiredText(dealer, paymentLink),
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

function buildCandidateExpiryWarningText(candidate, paymentLink = '') {
  return `Hi ${candidate.name},

Your job alerts subscription expires in 3 days.

Renew now to keep receiving unlimited job alerts without interruption.

Renew here: ${paymentLink}

---
Job Alerts — Powered by Basiq360`;
}

function buildCandidateExpiredText(candidate, paymentLink = '') {
  return `Hi ${candidate.name},

Your job alerts subscription has expired. You are now back on the free tier (2 alerts).

Renew to continue receiving unlimited job alerts.

Renew here: ${paymentLink}

---
Job Alerts — Powered by Basiq360`;
}

async function sendCandidateExpiryWarningEmail(candidate, paymentLink) {
  const transport = createTransport();
  const emails = candidate.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: 'Your job alerts subscription expires in 3 days — renew now',
    text: buildCandidateExpiryWarningText(candidate, paymentLink),
  });
}

async function sendCandidateExpiredEmail(candidate, paymentLink) {
  const transport = createTransport();
  const emails = candidate.emails.split(',').map(e => e.trim());
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: emails.join(', '),
    subject: 'Your job alerts subscription has expired',
    text: buildCandidateExpiredText(candidate, paymentLink),
  });
}

async function sendOtpEmail(email, otp) {
  const transport = createTransport();
  console.log(`[auth] Sending OTP email to ${email}`);
  const info = await transport.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: `Your Connect Market login code: ${otp}`,
    text: `Your one-time login code is:\n\n  ${otp}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.\n— Connect Market`,
    html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px">
      <h2 style="color:#111;margin-bottom:8px">Connect Market</h2>
      <p style="color:#555;margin-bottom:24px">Your one-time login code:</p>
      <div style="background:#f5f7fa;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
        <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#4f6ef7">${otp}</span>
      </div>
      <p style="color:#888;font-size:13px">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
    </div>`,
  });
  console.log(`[auth] OTP email sent, messageId: ${info.messageId}`);
}

module.exports = {
  sendLeadEmail, sendSubscriptionConfirmationEmail, sendPaymentRejectedEmail, buildEmailText,
  sendSubscriptionExpiryWarningEmail, sendSubscriptionExpiredEmail,
  buildExpiryWarningText, buildExpiredText,
  sendJobAlertEmail, sendCandidateSubscriptionConfirmationEmail, sendCandidatePaymentRejectedEmail,
  sendCandidateExpiryWarningEmail, sendCandidateExpiredEmail,
  buildCandidateExpiryWarningText, buildCandidateExpiredText,
  sendOtpEmail,
};
