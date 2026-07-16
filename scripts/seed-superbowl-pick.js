// One-off: write the Super Bowl LX pick (mirroring the dev stub, incl. result 'Win')
// into production Redis, since there is no API to set a pick's result.
const fs = require('fs');
const path = require('path');
const { createClient } = require('redis');

// Load REDIS_URL from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
const line = env.split(/\r?\n/).find(l => l.startsWith('REDIS_URL='));
const REDIS_URL = line ? line.slice('REDIS_URL='.length).replace(/^["']|["']$/g, '').trim() : null;
if (!REDIS_URL) { console.error('REDIS_URL not found in .env.local'); process.exit(1); }

const pick = {
  id: 1,
  week: 'Super Bowl LX',
  game: 'New England Patriots vs Seattle Seahawks',
  time: 'February 8, 2026 · 6:30 PM ET',
  pick: 'Seattle Seahawks -4.5',
  confidence: 'High',
  reasoning: 'Seahawks cover because their defense creates negative plays and turnovers, their special teams win hidden yardage, and their offense does enough without giving the Patriots short fields.',
  result: 'Win'
};

(async () => {
  const client = createClient({ url: REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e.message));
  await client.connect();

  const existing = await client.sMembers('all_picks');
  console.log('Existing pick ids before:', existing);

  await client.set(`pick:${pick.id}`, JSON.stringify(pick));
  await client.sAdd('all_picks', String(pick.id));

  const after = await client.sMembers('all_picks');
  console.log('Pick ids after:', after);
  console.log('Stored pick:', await client.get(`pick:${pick.id}`));

  await client.quit();
})().catch((e) => { console.error(e); process.exit(1); });
