// Sends one email through Resend's API. Strictly best-effort: callers are
// signups and sales, which must never fail because an email did, so every
// problem is logged and reported as `false` instead of thrown.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Past this the caller moves on and the email is lost, which beats a signup or
// a Stripe webhook hanging on a slow mail API.
const TIMEOUT_MS = 5000;

// `sender` is the local part of the From address; Resend refuses any sender
// outside the domain verified on the account, which the integration supplies
// as RESEND_EMAIL_DOMAIN.
async function sendEmail(tag, { senderName, sender, to, subject, text, html }) {
  const { RESEND_API_KEY, RESEND_EMAIL_DOMAIN } = process.env;
  if (!RESEND_API_KEY || !RESEND_EMAIL_DOMAIN) {
    console.warn(`[${tag}] not sent: RESEND_API_KEY and RESEND_EMAIL_DOMAIN must both be set`);
    return false;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `${senderName} <${sender}@${RESEND_EMAIL_DOMAIN}>`,
        to,
        subject,
        text,
        ...(html && { html })
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!response.ok) {
      console.error(`[${tag}] Resend refused the send (${response.status}): ${await response.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[${tag}] send failed: ${error.message}`);
    return false;
  }
}

module.exports = { sendEmail };
