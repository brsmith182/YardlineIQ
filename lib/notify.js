// Owner alerts by email, sent through Resend's API. Strictly best-effort: a
// signup or a sale must never fail because an alert did, so every problem is
// logged and reported as `false` instead of thrown.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Past this the caller moves on and the alert is lost, which beats a signup or
// a Stripe webhook hanging on a slow mail API.
const TIMEOUT_MS = 5000;

function formatDollars(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function composeAlert(type, data) {
  if (type === 'signup') {
    return {
      subject: `Free-pick signup: ${data.email}`,
      text: `${data.email} signed up for the free pick.`
    };
  }
  if (type === 'payment') {
    const price = formatDollars(data.amount);
    return {
      subject: `Sale: ${data.packageLabel}, ${price}`,
      text: `${data.name || 'A buyer'} (${data.email}) bought the ${data.packageLabel} for ${price}.`
    };
  }
  return null;
}

async function sendNotificationEmail(type, data) {
  const { RESEND_API_KEY, RESEND_EMAIL_DOMAIN, NOTIFY_EMAIL } = process.env;
  if (!RESEND_API_KEY || !RESEND_EMAIL_DOMAIN || !NOTIFY_EMAIL) {
    console.warn(`[notify:${type}] not sent: RESEND_API_KEY, RESEND_EMAIL_DOMAIN and NOTIFY_EMAIL must all be set`);
    return false;
  }

  const alert = composeAlert(type, data);
  if (!alert) {
    console.error(`[notify:${type}] not sent: unknown alert type`);
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
        // Resend refuses any sender outside the domain verified on the account,
        // which the integration supplies as RESEND_EMAIL_DOMAIN.
        from: `YardlineIQ Alerts <alerts@${RESEND_EMAIL_DOMAIN}>`,
        to: [NOTIFY_EMAIL],
        subject: alert.subject,
        text: alert.text
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!response.ok) {
      console.error(`[notify:${type}] Resend refused the send (${response.status}): ${await response.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[notify:${type}] send failed: ${error.message}`);
    return false;
  }
}

module.exports = { sendNotificationEmail };
