// The confirmation a free-pick requester gets right after signing up. The pick
// itself goes out separately before kickoff; this only tells them it is coming.

const { sendEmail } = require('./resend');

const SITE_URL = 'https://www.yardlineiq.com/';
const SUBJECT = 'Your free YardlineIQ pick is on the way';
const PREHEADER = "We'll email it to you before kickoff.";

// The signup route accepts anything with an `@` in it, and anyone can submit
// the form. Sending only to a single plain address keeps the confirmation from
// mailing several people at once or carrying markup; anything else simply
// gets no confirmation.
const PLAIN_ADDRESS = /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\.]+(\.[^\s@,;<>"()[\]\\.]+)+$/;
const MAX_ADDRESS_LENGTH = 254;

function isPlainAddress(email) {
  return typeof email === 'string' && email.length <= MAX_ADDRESS_LENGTH && PLAIN_ADDRESS.test(email);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function composeText(email, picksAddress) {
  return `Thanks for requesting a free pick.

We've saved ${email} for this week's free pick. We'll send it to that address before kickoff, along with the analysis behind it, so you can judge the reasoning for yourself.

To make sure it reaches you, add ${picksAddress} to your contacts or move this email to your primary inbox.

While you wait, our full season record, including wins, losses and pushes, is posted on our homepage:
${SITE_URL}

Good luck this week,
The YardlineIQ Team

---
All picks and analysis are for entertainment purposes only. Sports betting involves risk, and no result is guaranteed. You must be 21 or older. If gambling stops being fun, call 1-800-GAMBLER.

You're receiving this because this email address requested a free pick at yardlineiq.com. If that wasn't you, you can ignore this message.
`;
}

// Email clients ignore stylesheets, so everything is inline and laid out with
// tables. Colours follow the site: #0a0a0a ground, #00ff88 accent.
function composeHtml(email, picksAddress) {
  const font = "font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;";
  const safeEmail = escapeHtml(email);
  const safePicks = escapeHtml(picksAddress);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0a0a0a;">${PREHEADER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0a" style="background:#0a0a0a;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="${font}padding:0 4px 20px;font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#00ff88;">YARDLINEIQ</td></tr>
<tr><td bgcolor="#141414" style="${font}background:#141414;border:1px solid #262626;border-radius:12px;padding:32px 28px;font-size:16px;line-height:1.6;color:#d4d4d4;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:800;color:#ffffff;">Thanks for requesting a free pick.</h1>
<p style="margin:0 0 16px;">We've saved <strong style="color:#ffffff;">${safeEmail}</strong> for this week's free pick. We'll send it to that address before kickoff, along with the analysis behind it, so you can judge the reasoning for yourself.</p>
<p style="margin:0 0 16px;">To make sure it reaches you, add <strong style="color:#ffffff;">${safePicks}</strong> to your contacts or move this email to your primary inbox.</p>
<p style="margin:0 0 20px;">While you wait, our full season record, including wins, losses and pushes, is posted on our homepage.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
<tr><td bgcolor="#00ff88" style="background:#00ff88;border-radius:8px;">
<a href="${SITE_URL}" style="${font}display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#0a0a0a;text-decoration:none;">View the season record &rarr;</a>
</td></tr>
</table>
<p style="margin:0;">Good luck this week,<br>The YardlineIQ Team</p>
</td></tr>
<tr><td style="${font}padding:24px 4px 0;font-size:12px;line-height:1.6;color:#808080;">
<p style="margin:0 0 12px;">All picks and analysis are for entertainment purposes only. Sports betting involves risk, and no result is guaranteed. You must be 21 or older. If gambling stops being fun, call 1-800-GAMBLER.</p>
<p style="margin:0;">You're receiving this because this email address requested a free pick at <a href="${SITE_URL}" style="color:#808080;">yardlineiq.com</a>. If that wasn't you, you can ignore this message.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

async function sendFreePickConfirmation(email) {
  if (!isPlainAddress(email)) {
    console.warn('[free-pick-confirmation] not sent: not a single plain email address');
    return false;
  }

  const picksAddress = `picks@${process.env.RESEND_EMAIL_DOMAIN}`;
  return sendEmail('free-pick-confirmation', {
    senderName: 'YardlineIQ',
    sender: 'picks',
    to: [email],
    subject: SUBJECT,
    text: composeText(email, picksAddress),
    html: composeHtml(email, picksAddress)
  });
}

module.exports = { sendFreePickConfirmation };
