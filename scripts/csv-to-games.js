#!/usr/bin/env node
/*
 * Decodes the model's upcoming-games feature file into the UPCOMING_GAMES
 * literal that server.js serves. Run it whenever a new slate is handed over:
 *
 *   node scripts/csv-to-games.js "<path to NFL Machine Learning Unified Upcoming Games.csv>"
 *
 * Paste the output over the UPCOMING_GAMES array in server.js and update
 * GAMES_AS_OF to the date the file was generated.
 *
 * Three columns are encoded and need decoding:
 *
 * 1. Home / Away are team ids 1-32, alphabetical by city with Las Vegas at 19.
 *    Verified against 21 independent Coach+QB pairs in the file (id 29 =
 *    Macdonald + Darnold = Seattle, 16 = Reid + Mahomes = KC, 26 = Sirianni +
 *    Hurts = Philadelphia, and so on); the remaining ids fall into the only
 *    consistent alphabetical slots left over.
 *
 * 2. Date is an Excel serial on the 1900 system, so day 0 is 1899-12-30.
 *
 * 3. Gametime is a fraction of a day, Eastern.
 *
 * Opening Line and Vegas Line are signed from the HOME team's perspective
 * (negative = home laying points), and are kept that way: it is the only shape
 * that survives a line crossing zero and flipping which team is favored.
 */

const fs = require('fs');
const pathMod = require('path');

// id -> [full name, ESPN abbr]. Abbrs match public/js/nfl-teams.js.
const TEAMS = {
   1: ['Arizona Cardinals', 'ari'],       2: ['Atlanta Falcons', 'atl'],
   3: ['Baltimore Ravens', 'bal'],        4: ['Buffalo Bills', 'buf'],
   5: ['Carolina Panthers', 'car'],       6: ['Chicago Bears', 'chi'],
   7: ['Cincinnati Bengals', 'cin'],      8: ['Cleveland Browns', 'cle'],
   9: ['Dallas Cowboys', 'dal'],         10: ['Denver Broncos', 'den'],
  11: ['Detroit Lions', 'det'],          12: ['Green Bay Packers', 'gb'],
  13: ['Houston Texans', 'hou'],         14: ['Indianapolis Colts', 'ind'],
  15: ['Jacksonville Jaguars', 'jac'],   16: ['Kansas City Chiefs', 'kc'],
  17: ['Los Angeles Chargers', 'lac'],   18: ['Los Angeles Rams', 'lar'],
  19: ['Las Vegas Raiders', 'lv'],       20: ['Miami Dolphins', 'mia'],
  21: ['Minnesota Vikings', 'min'],      22: ['New England Patriots', 'ne'],
  23: ['New Orleans Saints', 'no'],      24: ['New York Giants', 'nyg'],
  25: ['New York Jets', 'nyj'],          26: ['Philadelphia Eagles', 'phi'],
  27: ['Pittsburgh Steelers', 'pit'],    28: ['San Francisco 49ers', 'sf'],
  29: ['Seattle Seahawks', 'sea'],       30: ['Tampa Bay Buccaneers', 'tb'],
  31: ['Tennessee Titans', 'ten'],       32: ['Washington Commanders', 'wsh'],
};

// US Eastern UTC offset. DST runs from the second Sunday in March to the
// first Sunday in November, which is the whole NFL regular season minus the
// last stretch of it.
function easternOffset(year, month, day) {
  if (month > 3 && month < 11) return '-04:00';
  if (month < 3 || month === 12) return '-05:00';
  if (month === 11) {
    const firstSunday = 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7);
    return day < firstSunday ? '-04:00' : '-05:00';
  }
  const firstOfMarch = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const secondSunday = 1 + ((7 - firstOfMarch) % 7) + 7;
  return day < secondSunday ? '-05:00' : '-04:00';
}

// Excel serial + fraction-of-day -> ISO string with an explicit Eastern
// offset. Assembled from UTC parts so the host machine's zone never leaks in.
function kickoffISO(serial, dayFraction) {
  const d = new Date((Number(serial) - 25569) * 86400000); // 25569 = 1970-01-01 as an Excel serial
  const minutesOfDay = Math.round(Number(dayFraction) * 24 * 60);
  const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, '0');
  const mm = String(minutesOfDay % 60).padStart(2, '0');
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  const p2 = (n) => String(n).padStart(2, '0');
  return y + '-' + p2(mo) + '-' + p2(dd) + 'T' + hh + ':' + mm + ':00' + easternOffset(y, mo, dd);
}

// Minimal RFC-4180 split. The file has no embedded commas today, but a coach
// or referee name could gain one.
function splitRow(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const num = (v) => (v === '' || v == null ? null : Number(v));

// The share columns are stored as fractions (0.41); the UI wants whole percents.
const pct = (v) => (v === '' || v == null ? null : Math.round(Number(v) * 100));

function decode(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const header = splitRow(lines[0]);
  const col = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error('column not found in CSV: ' + name);
    return i;
  };

  const c = {
    home: col('Home'), away: col('Away'),
    season: col('Season'), week: col('Week of Season'),
    date: col('Date'), gametime: col('Gametime'),
    homefield: col('Homefield'),
    open: col('Opening Line'), vegas: col('Vegas Line'),
    homeSpreadOdds: col('Home Spread Odds'), awaySpreadOdds: col('Away Spread Odds'),
    ou: col('OverUnder'), over: col('Over Odds'), under: col('Under Odds'),
    homeML: col('Home Moneyline'), awayML: col('Away Moneyline'),
    // Only the home side is populated; the away columns exist but are blank,
    // so the away share is derived rather than read.
    moneyHome: col('Home BET %'), ticketsHome: col('Home Ticket %'),
  };

  return lines.slice(1).map((line) => {
    const r = splitRow(line);
    const home = TEAMS[Number(r[c.home])];
    const away = TEAMS[Number(r[c.away])];
    if (!home || !away) {
      throw new Error('unknown team id in row: ' + r[c.home] + ' vs ' + r[c.away]);
    }
    const season = Number(r[c.season]);
    const week = Number(r[c.week]);
    return {
      id: season + '-w' + week + '-' + away[1] + '-at-' + home[1],
      season: season,
      week: week,
      kickoff: kickoffISO(r[c.date], r[c.gametime]),
      away: away[0],
      home: home[0],
      neutralSite: Number(r[c.homefield]) === 0,
      spread: {
        open: num(r[c.open]),
        current: num(r[c.vegas]),
        home: num(r[c.homeSpreadOdds]),
        away: num(r[c.awaySpreadOdds]),
      },
      total: { current: num(r[c.ou]), over: num(r[c.over]), under: num(r[c.under]) },
      moneyline: { home: num(r[c.homeML]), away: num(r[c.awayML]) },
      // Feeds the handle report. Stored as whole percents on the home side;
      // the away share is 100 minus it, so the pair can never disagree.
      split: { moneyHome: pct(r[c.moneyHome]), ticketsHome: pct(r[c.ticketsHome]) },
    };
  }).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
}

function toLiteral(games) {
  const j = JSON.stringify;
  const rows = games.map((g) => [
    '  {',
    "    id: '" + g.id + "',",
    '    season: ' + g.season + ', week: ' + g.week + ',',
    "    kickoff: '" + g.kickoff + "',",
    '    away: ' + j(g.away) + ',',
    '    home: ' + j(g.home) + ',',
    g.neutralSite ? '    neutralSite: true,' : null,
    '    spread: { open: ' + g.spread.open + ', current: ' + g.spread.current +
      ', home: ' + g.spread.home + ', away: ' + g.spread.away + ' },',
    '    total: { current: ' + g.total.current + ', over: ' + g.total.over +
      ', under: ' + g.total.under + ' },',
    '    moneyline: { home: ' + g.moneyline.home + ', away: ' + g.moneyline.away + ' },',
    '    split: { moneyHome: ' + g.split.moneyHome + ', ticketsHome: ' + g.split.ticketsHome + ' },',
    '  },',
  ].filter(Boolean).join('\n')).join('\n');

  return 'const UPCOMING_GAMES = [\n' + rows + '\n];';
}

if (require.main === module) {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('usage: node scripts/csv-to-games.js "<path to upcoming games csv>"');
    process.exit(1);
  }
  const games = decode(csvPath);
  console.log('// ' + games.length + ' games decoded from ' + pathMod.basename(csvPath));
  console.log(toLiteral(games));
}

module.exports = { decode, toLiteral, TEAMS, kickoffISO };
