import nodemailer from 'nodemailer';

// Outbound email over SMTP (works with Microsoft 365/Outlook, Gmail app
// passwords, SendGrid/Resend/Postmark SMTP relays, etc.). Configure with:
//   SMTP_HOST, SMTP_PORT (default 587; 465 = implicit TLS), SMTP_USER,
//   SMTP_PASS, SMTP_FROM ("D Magazine Content Intelligence <you@…>"), and
//   APP_BASE_URL (the site's public URL — links in emails are built from
//   this, never from the request's Host header, which an attacker controls).
const isProd = process.env.NODE_ENV === 'production';

export const mailConfigured = () =>
  !!(process.env.SMTP_HOST && process.env.SMTP_FROM && process.env.APP_BASE_URL);

export function appBaseUrl() {
  const url = process.env.APP_BASE_URL || (isProd ? '' : 'http://localhost:5173');
  return url.replace(/\/$/, '');
}

// In production sign-ups need working email. In development without SMTP the
// link is printed to the server console instead, so the flow is testable.
export const signupsAvailable = () => mailConfigured() || !isProd;

let transport;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendSignupEmail({ to, name, link }) {
  const subject = 'Finish creating your Content Intelligence account';
  const text = `Hi ${name},\n\nUse this link to confirm your email and choose a password (it expires in 24 hours):\n\n${link}\n\nIf you didn't ask for this, you can ignore this email — no account is created until the link is used.`;
  const html = `<p>Hi ${esc(name)},</p><p>Use this link to confirm your email and choose a password (it expires in 24 hours):</p><p><a href="${esc(link)}">Finish creating your account</a></p><p style="color:#666;font-size:13px">If you didn't ask for this, you can ignore this email — no account is created until the link is used.</p>`;

  if (!mailConfigured()) {
    if (isProd) throw new Error('Email is not configured');
    console.log(`[Mail] (dev — SMTP not configured) sign-up link for ${to}: ${link}`);
    return;
  }
  await getTransport().sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
}
