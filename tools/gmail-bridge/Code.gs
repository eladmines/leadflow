/**
 * LeadFlow Gmail bridge: sends the Gmail messages you label "LeadFlow" to LeadFlow's inbound-email
 * webhook, so they appear in Conversations and become leads. Runs inside your own Google account
 * (Google Apps Script): free, no domain, nothing to verify with Google.
 *
 * Setup: see README.md in this folder. Fill in the three values below, run `install` once.
 */
const CONFIG = {
  // https://<your service>.onrender.com/api/v1/integrations/email/inbound
  URL: 'PASTE_THE_WEBHOOK_URL',
  // The same value as EMAIL_INBOUND_SECRET on the server.
  SECRET: 'PASTE_EMAIL_INBOUND_SECRET',
  // The business's address from Settings → Channels → Email.
  TO: 'PASTE_THE_FORWARDING_ADDRESS',
  // The Gmail label your filter puts on customer mail.
  LABEL: 'LeadFlow',
};

/** Runs on a timer: posts every message under the label, then takes the label off the thread. */
function forwardToLeadFlow() {
  const label = GmailApp.getUserLabelByName(CONFIG.LABEL);
  if (!label) return;
  const me = Session.getActiveUser().getEmail().toLowerCase();

  label.getThreads(0, 25).forEach(function (thread) {
    let allSent = true;
    thread.getMessages().forEach(function (message) {
      const from = parseAddress(message.getFrom());
      // What you sent yourself isn't a customer message.
      if (!from.address || from.address === me) {
        console.log('LeadFlow bridge: skipped, sent by you: ' + message.getSubject());
        return;
      }
      if (!post(message, from)) allSent = false;
    });
    // Kept on the thread when something failed, so the next run tries again. LeadFlow ignores
    // a message it already has, so repeats are harmless.
    if (allSent) thread.removeLabel(label);
  });
}

function post(message, from) {
  const body = asciiJson({
    to: CONFIG.TO,
    from: from.address,
    fromName: from.name || null,
    subject: message.getSubject() || '',
    text: message.getPlainBody() || '',
    messageId: message.getHeader('Message-ID') || message.getId(),
    autoSubmitted: isAutomatic(message),
    receivedAt: message.getDate().toISOString(),
  });
  try {
    const res = UrlFetchApp.fetch(CONFIG.URL, {
      method: 'post',
      contentType: 'application/json',
      payload: body,
      headers: { 'X-LeadFlow-Signature': 'sha256=' + sign(body) },
      muteHttpExceptions: true,
    });
    console.log(
      'LeadFlow bridge: ' + res.getResponseCode() + ' for "' + message.getSubject() + '"' +
        (isAutomatic(message) ? ' (automatic mail: ignored by LeadFlow)' : ''),
    );
    return res.getResponseCode() === 200;
  } catch (err) {
    console.error('LeadFlow bridge: request failed: ' + err.message);
    return false;
  }
}

/**
 * JSON with every non-ASCII character written as \uXXXX. The signed text and the bytes sent are
 * then identical whatever encoding Apps Script uses (Hebrew and emoji in subjects broke the
 * signature otherwise).
 */
function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

/** Vacation replies, bounces, newsletters: LeadFlow ignores them. */
function isAutomatic(message) {
  const auto = (message.getHeader('Auto-Submitted') || '').toLowerCase();
  const precedence = (message.getHeader('Precedence') || '').toLowerCase();
  return (auto !== '' && auto !== 'no') || /bulk|junk|list/.test(precedence);
}

/** HMAC-SHA256 of the body, as lowercase hex (Apps Script returns signed bytes). */
function sign(body) {
  return Utilities.computeHmacSha256Signature(body, CONFIG.SECRET)
    .map(function (b) {
      return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
    })
    .join('');
}

/** `Dana Cohen <dana@example.com>` → { name, address }. */
function parseAddress(value) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  return m
    ? { name: m[1].trim(), address: m[2].trim().toLowerCase() }
    : { name: '', address: value.trim().toLowerCase() };
}

/** Run once: checks every 5 minutes. Running it again replaces the old timer. */
function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'forwardToLeadFlow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('forwardToLeadFlow').timeBased().everyMinutes(5).create();
}

/** Prints the secret's length and edges (never all of it) to compare with Render's. */
function checkSecret() {
  const s = CONFIG.SECRET;
  console.log(
    'length ' + s.length + ', starts "' + s.slice(0, 4) + '", ends "' + s.slice(-4) + '"' +
      (s !== s.trim() ? ', HAS SPACES AT THE EDGES' : ''),
  );
}

/**
 * Sends three messages to an address that doesn't exist (LeadFlow checks the signature, then drops
 * them: nothing is created) and logs the answers: plain, with Hebrew and an emoji, and long.
 * 200 = signature accepted; 401 = rejected.
 */
function testPing() {
  const cases = {
    plain: { subject: 'ping', text: 'ping' },
    unicode: { subject: 'ping \uD83E\uDD16 בדיקה – עברית', text: 'שלום \u2019 world' },
    long: { subject: 'ping long', text: new Array(4000).join('hello world ') },
  };
  Object.keys(cases).forEach(function (name) {
    const body = asciiJson({
      to: 'nobody-ping@mail.invalid',
      from: 'ping@example.com',
      subject: cases[name].subject,
      text: cases[name].text,
      messageId: '<ping-' + name + '-' + Date.now() + '@bridge>',
    });
    const res = UrlFetchApp.fetch(CONFIG.URL, {
      method: 'post',
      contentType: 'application/json',
      payload: body,
      headers: { 'X-LeadFlow-Signature': 'sha256=' + sign(body) },
      muteHttpExceptions: true,
    });
    console.log('ping ' + name + ': ' + res.getResponseCode() + ' (' + body.length + ' bytes)');
  });
}
