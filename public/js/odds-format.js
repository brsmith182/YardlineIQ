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
