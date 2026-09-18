/* Shared number, line and date formatting for the member pages.
   Both /picks.html and /handle.html show the same games, so they have to
   render the same spread the same way — a line that reads "SEA -3.5" on one
   page and something else on the other costs more trust than it saves effort.

   Depends on teamCode() from nfl-teams.js, so load that first. */

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    const v = Number(n);
    return v % 1 === 0 ? String(v) : v.toFixed(1);
}

function fmtSpread(n) {
    if (n == null || isNaN(n)) return '—';
    const v = Number(n);
    if (v === 0) return 'PK';
    return (v > 0 ? '+' : '-') + fmtNum(Math.abs(v));
}

function fmtOdds(n) {
    if (n == null || isNaN(n)) return '—';
    const v = Number(n);
    return (v > 0 ? '+' : '-') + Math.abs(v);
}

/* Kickoffs always render in Eastern: the label says ET, so a member in
   another zone must see the ET time rather than their own. */
function fmtKickoff(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    const zone = { timeZone: 'America/New_York' };
    const day = d.toLocaleDateString('en-US',
        Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, zone));
    const time = d.toLocaleTimeString('en-US',
        Object.assign({ hour: 'numeric', minute: '2-digit' }, zone));
    return day.replace(',', '') + ' · ' + time + ' ET';
}

function fmtAsOf(isoDate) {
    // Read at midday UTC so a date-only string can't slip a day backwards.
    const d = new Date(isoDate + 'T12:00:00Z');
    if (isNaN(d)) return isoDate;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* Numeric weeks get the "Week" prefix; anything else is already a name. */
function weekLabel(week) {
    const w = String(week == null ? '' : week).trim();
    if (!w) return 'This week';
    return /^\d+$/.test(w) ? 'Week ' + w : escHtml(w);
}

/* Spreads are stored from the home side. Name whichever team is laying the
   points so the number never has to be read against a hidden side. */
function spreadLabel(game, homeNumber) {
    if (homeNumber == null || isNaN(homeNumber)) return '—';
    const v = Number(homeNumber);
    if (v === 0) return 'PK';
    return v < 0
        ? teamCode(game.home) + ' ' + fmtSpread(v)
        : teamCode(game.away) + ' ' + fmtSpread(-v);
}

/* Three teams to a row leaves no room for "New England Patriots", and a
   truncated city reads worse than none. Every NFL nickname is the last word. */
function nickname(name) {
    const parts = String(name || '').trim().split(/\s+/);
    return parts[parts.length - 1] || '';
}

/* ── Pick archive ─────────────────────────────────────────────────
   Past weeks are ordered by when the games were played, not by when the
   picks were posted: a Monday nighter posted first would otherwise open a
   week that starts on Thursday. */

/* When the game kicked off, in ms, or null if the pick cannot say.
   `kickoff` is the real answer. Picks posted before it was stored carry only
   the printed `time`, which parses in the reader's own zone rather than
   Eastern — that shifts every pick by the same amount, so the ordering it
   produces is still right even though the instant is not. */
function pickKickoffMs(pick) {
    const iso = pick && pick.kickoff;
    if (iso) {
        const ms = Date.parse(iso);
        if (!isNaN(ms)) return ms;
    }

    const printed = String((pick && pick.time) || '').trim();
    if (!printed) return null;
    const ms = Date.parse(printed.replace(' · ', ' ').replace(/\s*ET$/, ''));
    return isNaN(ms) ? null : ms;
}

/* Earliest game first. A pick that cannot be dated goes last rather than
   sorting as 1970 and pushing itself to the top of the week. */
function byKickoff(a, b) {
    const x = pickKickoffMs(a);
    const y = pickKickoffMs(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x - y;
}

/* A week is dated by its last game, which is what lets weeks be listed
   newest first without reading the week number — so "Super Bowl LX" lands in
   the right place too. */
function latestKickoffMs(picks) {
    let latest = null;
    (picks || []).forEach((p) => {
        const ms = pickKickoffMs(p);
        if (ms != null && (latest == null || ms > latest)) latest = ms;
    });
    return latest;
}

/* "9-7", or "9-7-1" when the week had a push. Ungraded picks are left out
   entirely: counting a pending pick as anything would misstate the record. */
function weekRecord(picks) {
    let win = 0, loss = 0, push = 0;
    (picks || []).forEach((p) => {
        const result = String((p && p.result) || '').toLowerCase();
        if (result === 'win') win++;
        else if (result === 'loss') loss++;
        else if (result === 'push') push++;
    });
    if (!win && !loss && !push) return '';
    return push ? `${win}-${loss}-${push}` : `${win}-${loss}`;
}

/* The member pages load this as a plain script; the tests require it. */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { pickKickoffMs, byKickoff, latestKickoffMs, weekRecord };
}
