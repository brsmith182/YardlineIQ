#!/usr/bin/env node
// Refresh the shared picks board and Handle Report from the model's CSV.
const fs = require('fs');
const path = require('path');
const { decode, toLiteral } = require('./csv-to-games');

const csvPath = process.argv[2];
if (!csvPath) throw new Error('usage: node scripts/refresh-upcoming-games.js <csv-path>');

const games = decode(csvPath);
if (games.length === 0) throw new Error('No games in CSV');
const asOf = new Date(fs.statSync(csvPath).mtimeMs).toLocaleDateString('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const serverPath = path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');
const boardStart = source.indexOf('const UPCOMING_GAMES = [');
const boardEnd = source.indexOf('\n];', boardStart);
if (boardStart < 0 || boardEnd < 0) throw new Error('UPCOMING_GAMES not found');
const newline = source.includes('\r\n') ? '\r\n' : '\n';
const next = source.slice(0, boardStart)
  + toLiteral(games).replace(/\n/g, newline)
  + source.slice(boardEnd + 3);
const dated = next.replace(/const GAMES_AS_OF = '\d{4}-\d{2}-\d{2}';/, `const GAMES_AS_OF = '${asOf}';`);
if (dated === next && !next.includes(`const GAMES_AS_OF = '${asOf}';`)) throw new Error('GAMES_AS_OF not found');
fs.writeFileSync(serverPath, dated);
console.log(`Refreshed ${games.length} games as of ${asOf}`);
