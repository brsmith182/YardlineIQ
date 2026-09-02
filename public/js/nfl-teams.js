/* NFL team lookup — shared by picks.html and handle.html.
   Abbreviations are ESPN's, not the standard NFL ones (jac not JAX,
   wsh not WAS), because they double as the logo CDN path segment. */

const NFL_LOGOS = {
    'patriots': 'ne', 'new england patriots': 'ne',
    'seahawks': 'sea', 'seattle seahawks': 'sea',
    'chiefs': 'kc', 'kansas city chiefs': 'kc',
    'eagles': 'phi', 'philadelphia eagles': 'phi',
    '49ers': 'sf', 'san francisco 49ers': 'sf',
    'bills': 'buf', 'buffalo bills': 'buf',
    'ravens': 'bal', 'baltimore ravens': 'bal',
    'bengals': 'cin', 'cincinnati bengals': 'cin',
    'browns': 'cle', 'cleveland browns': 'cle',
    'steelers': 'pit', 'pittsburgh steelers': 'pit',
    'texans': 'hou', 'houston texans': 'hou',
    'colts': 'ind', 'indianapolis colts': 'ind',
    'jaguars': 'jac', 'jacksonville jaguars': 'jac',
    'titans': 'ten', 'tennessee titans': 'ten',
    'broncos': 'den', 'denver broncos': 'den',
    'raiders': 'lv', 'las vegas raiders': 'lv',
    'chargers': 'lac', 'los angeles chargers': 'lac',
    'cowboys': 'dal', 'dallas cowboys': 'dal',
    'giants': 'nyg', 'new york giants': 'nyg',
    'jets': 'nyj', 'new york jets': 'nyj',
    'commanders': 'wsh', 'washington commanders': 'wsh',
    'bears': 'chi', 'chicago bears': 'chi',
    'lions': 'det', 'detroit lions': 'det',
    'packers': 'gb', 'green bay packers': 'gb',
    'vikings': 'min', 'minnesota vikings': 'min',
    'falcons': 'atl', 'atlanta falcons': 'atl',
    'panthers': 'car', 'carolina panthers': 'car',
    'saints': 'no', 'new orleans saints': 'no',
    'buccaneers': 'tb', 'tampa bay buccaneers': 'tb',
    'cardinals': 'ari', 'arizona cardinals': 'ari',
    'rams': 'lar', 'los angeles rams': 'lar',
    'dolphins': 'mia', 'miami dolphins': 'mia',
};

/* Lowercase ESPN abbr, or null if the name isn't recognised. */
function teamAbbr(name) {
    return NFL_LOGOS[String(name || '').toLowerCase().trim()] || null;
}

/* Uppercase code for display on a board. Falls back to the first three
   letters so an unrecognised team still gets a label instead of a blank. */
function teamCode(name) {
    const abbr = teamAbbr(name);
    if (abbr) return abbr.toUpperCase();
    return String(name || '').trim().slice(0, 3).toUpperCase() || '—';
}

function teamLogoUrl(name) {
    const abbr = teamAbbr(name);
    return abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png` : null;
}

/* Splits a free-text "Away vs Home" pick string. Structured game records
   carry away/home separately and don't need this. */
function parseTeams(game) {
    const parts = String(game || '').split(/\s+vs\.?\s+/i);
    if (parts.length !== 2) return null;
    return { away: parts[0].trim(), home: parts[1].trim() };
}
