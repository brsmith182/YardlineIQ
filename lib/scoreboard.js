const { teamAbbr } = require('../public/js/nfl-teams.js');

// ESPN's scoreboard feed abbreviates Jacksonville JAX; nfl-teams.js says jac.
// Both resolve on the logo CDN, so the split only matters as a join key —
// canonicalise here rather than editing the map the member pages depend on.
const ABBR_ALIASES = { jax: 'jac' };

function canonical(abbr) {
  const a = String(abbr || '').toLowerCase().trim();
  return ABBR_ALIASES[a] || a;
}

// The board stores full display names ("Carolina Panthers"); ESPN sends
// abbreviations. Names go through the shared map so both sides end up on the
// same key.
function boardKey(away, home) {
  return `${canonical(away)}@${canonical(home)}`;
}

// Spreads on the board are signed from the HOME team's perspective (see the
// comment above UPCOMING_GAMES in server.js). Resolve that into "who is laying
// how much", which is the only form a one-line ticker can show. Points come
// back negative because the favourite is always the one giving them away.
function resolveLine(spreadCurrent, awayCode, homeCode) {
  if (typeof spreadCurrent !== 'number' || !Number.isFinite(spreadCurrent)) return null;
  if (spreadCurrent === 0) return { team: null, points: 0 };
  return spreadCurrent < 0
    ? { team: homeCode, points: spreadCurrent }
    : { team: awayCode, points: -spreadCurrent };
}

function indexBoard(upcomingGames) {
  const byMatchup = new Map();
  if (!Array.isArray(upcomingGames)) return byMatchup;
  for (const game of upcomingGames) {
    const away = teamAbbr(game && game.away);
    const home = teamAbbr(game && game.home);
    if (!away || !home) continue;
    byMatchup.set(boardKey(away, home), game);
  }
  return byMatchup;
}

function side(competitor) {
  const team = (competitor && competitor.team) || {};
  const score = Number(competitor && competitor.score);
  const records = Array.isArray(competitor && competitor.records) ? competitor.records : [];
  return {
    abbr: String(team.abbreviation || '').toUpperCase(),
    name: team.shortDisplayName || team.displayName || '',
    score: Number.isFinite(score) ? score : 0,
    record: (records[0] && records[0].summary) || null,
    // Taken from the feed rather than rebuilt, so ticker.js needs no team data
    // of its own and can run on pages that never load nfl-teams.js.
    logo: team.logo || null,
  };
}

// ESPN -> the ~3KB payload the ticker actually renders. The raw response is
// over 200KB, which is the whole reason this is proxied instead of fetched by
// every page. Every ESPN-specific field access lives in this function, so
// swapping providers later is a rewrite of one file.
function normalizeScoreboard(espn, upcomingGames) {
  const events = espn && Array.isArray(espn.events) ? espn.events : [];
  const board = indexBoard(upcomingGames);
  const games = [];

  for (const event of events) {
    const competition = event && Array.isArray(event.competitions) ? event.competitions[0] : null;
    const competitors = (competition && Array.isArray(competition.competitors))
      ? competition.competitors
      : [];
    const away = side(competitors.find((c) => c && c.homeAway === 'away'));
    const home = side(competitors.find((c) => c && c.homeAway === 'home'));
    if (!away.abbr || !home.abbr) continue;

    const type = (event.status && event.status.type) || {};
    const state = type.state === 'in' || type.state === 'post' ? type.state : 'pre';

    const matched = board.get(boardKey(away.abbr, home.abbr));
    const spread = matched && matched.spread ? matched.spread.current : undefined;

    let winner = null;
    if (state === 'post' && away.score !== home.score) {
      winner = away.score > home.score ? 'away' : 'home';
    }

    games.push({
      id: String(event.id || ''),
      state,
      detail: type.shortDetail || '',
      // The board's kickoff carries an explicit ET offset and is the number
      // members already see on /picks; fall back to ESPN's UTC timestamp for
      // any game the board has not been updated with yet.
      kickoff: (matched && matched.kickoff) || event.date || null,
      away,
      home,
      winner,
      // Deliberately the board's own number, not ESPN's competition.odds —
      // the line on this site has to stay the site's line.
      line: state === 'pre' ? resolveLine(spread, away.abbr, home.abbr) : null,
    });
  }

  return {
    season: (espn && espn.season && espn.season.year) || null,
    week: (espn && espn.week && espn.week.number) || null,
    games,
  };
}

module.exports = { normalizeScoreboard, resolveLine };
