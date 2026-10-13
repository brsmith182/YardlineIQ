// Owner alerts by email, sent through Resend's API. Strictly best-effort: a
// signup or a sale must never fail because an alert did, so every problem is
// logged and reported as `false` instead of thrown.

const { sendEmail } = require('./resend');

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
  const { NOTIFY_EMAIL } = process.env;
  if (!NOTIFY_EMAIL) {
    console.warn(`[notify:${type}] not sent: NOTIFY_EMAIL must be set`);
    return false;
  }

  const alert = composeAlert(type, data);
  if (!alert) {
    console.error(`[notify:${type}] not sent: unknown alert type`);
    return false;
  }

  return sendEmail(`notify:${type}`, {
    senderName: 'YardlineIQ Alerts',
    sender: 'alerts',
    to: [NOTIFY_EMAIL],
    subject: alert.subject,
    text: alert.text
  });
}

module.exports = { sendNotificationEmail };
