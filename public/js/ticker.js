/* Live score strip, pinned above the nav on every public page.

   Self-contained on purpose: the site has no shared header and no shared
   stylesheet, so rather than edit twenty inline <style> blocks this builds its
   own DOM and injects its own CSS. Adding it to a page is one <script> tag.

   It also has no dependency on nfl-teams.js or odds-format.js, because most of
   the pages it runs on never load them — logo URLs come down with the payload,
   and text is written with textContent rather than interpolated HTML. */
(function () {
    'use strict';

    var ENDPOINT = '/api/scoreboard';
    var POLL_LIVE_MS = 30 * 1000;      // a game is in progress; scores move
    var POLL_IDLE_MS = 5 * 60 * 1000;  // nothing is live; just keep the slate fresh
    var strip, rail, timer;
    var lastHeight = null;

    /* Styling matches the house system: Barlow Semi Condensed with tabular
       figures for anything numeric, #00ff88 for the live state, #0a0a0a ground.
       Colours are literal hex here the way they are everywhere else. */
    var CSS = [
        '.yiq-tk{position:fixed;top:0;left:0;right:0;z-index:1100;height:48px;',
        'display:flex;align-items:stretch;background:#08090b;',
        'border-bottom:1px solid rgba(255,255,255,0.07);',
        'box-shadow:0 1px 2px rgba(0,0,0,.5),0 4px 10px rgba(0,0,0,.35);',
        'font-family:"Barlow Semi Condensed","Inter",sans-serif;',
        'opacity:0;transition:opacity .25s ease}',
        '.yiq-tk.is-ready{opacity:1}',

        '.yiq-tk__label{display:flex;flex-direction:column;justify-content:center;',
        'padding:0 14px;border-right:1px solid rgba(255,255,255,0.07);',
        'background:#05070a;flex:0 0 auto}',
        '.yiq-tk__label b{font-size:13px;font-weight:700;letter-spacing:.06em;color:#00ff88;line-height:1.1}',
        '.yiq-tk__label span{font-size:10px;letter-spacing:.08em;color:rgba(255,255,255,.35);line-height:1.1}',

        '.yiq-tk__rail{display:flex;align-items:stretch;overflow-x:auto;overflow-y:hidden;',
        'scroll-snap-type:x proximity;scrollbar-width:none;-ms-overflow-style:none;flex:1 1 auto}',
        '.yiq-tk__rail::-webkit-scrollbar{display:none}',

        '.yiq-tk__game{flex:0 0 auto;scroll-snap-align:start;display:flex;flex-direction:column;',
        'justify-content:center;gap:1px;padding:0 16px;min-width:132px;',
        'border-right:1px solid rgba(255,255,255,0.05)}',

        '.yiq-tk__row{display:flex;align-items:center;gap:6px;line-height:1.15}',
        '.yiq-tk__row img{width:15px;height:15px;object-fit:contain;flex:0 0 auto}',
        '.yiq-tk__abbr{font-size:12px;font-weight:600;letter-spacing:.03em;color:rgba(255,255,255,.82)}',
        '.yiq-tk__score{margin-left:auto;font-size:13px;font-weight:700;color:#fff;',
        'font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}',
        '.yiq-tk__game.is-final .yiq-tk__row.is-loser .yiq-tk__abbr,',
        '.yiq-tk__game.is-final .yiq-tk__row.is-loser .yiq-tk__score{color:rgba(255,255,255,.38)}',

        '.yiq-tk__status{display:flex;align-items:center;gap:5px;font-size:10px;',
        'letter-spacing:.05em;color:rgba(255,255,255,.4);white-space:nowrap;',
        'font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}',
        '.yiq-tk__status.is-live{color:#00ff88}',
        '.yiq-tk__dot{width:5px;height:5px;border-radius:50%;background:#00ff88;',
        'flex:0 0 auto;animation:yiq-tk-pulse 1.6s ease-in-out infinite}',
        '@keyframes yiq-tk-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
        '@media (prefers-reduced-motion:reduce){.yiq-tk__dot{animation:none}}',

        '.yiq-tk__line{color:rgba(255,255,255,.55)}',

        '@media (max-width:768px){',
        '.yiq-tk{height:44px}',
        '.yiq-tk__label{padding:0 10px}',
        '.yiq-tk__game{min-width:118px;padding:0 12px}',
        '}'
    ].join('');

    function injectCss() {
        var style = document.createElement('style');
        style.id = 'yiq-ticker-css';
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    /* Two header patterns exist on this site and the strip must not cover
       either. Read which one this page uses rather than hard-coding a list:

         fixed  (index + the article/calculator pages) — these clear their own
                header with padding on the content, so the header and the body
                have to move down together by the same amount or the nav lands
                closer to the content than the page was designed for.
         sticky (picks / trends / handle) — normal document flow, same offset.
         none   (terms / disclaimer / 404) — body padding only. */
    function applyOffset() {
        if (!strip) return;
        var height = strip.offsetHeight;
        if (height === lastHeight) return;
        lastHeight = height;

        var header = document.querySelector('header.header');
        var position = header ? window.getComputedStyle(header).position : 'none';

        if (header && (position === 'fixed' || position === 'sticky')) {
            // index.html and the article pages put `transition: all .3s` on the
            // header for their scrolled state, which would animate this offset
            // and slide the nav down on every page load. Suppress the
            // transition for exactly this change, then hand it straight back.
            var transition = header.style.transition;
            header.style.transition = 'none';
            header.style.top = height + 'px';
            void header.offsetHeight; // commit before transitions come back
            header.style.transition = transition;
        }

        // Header and content both move down by exactly the strip's height, so
        // every page keeps the spacing it was designed with and the strip is
        // a pure translation rather than a reflow. A full-height hero then
        // runs the strip's height past the fold, which is the deliberate
        // trade: shortening it instead re-centres its content and changes the
        // gap between the nav and the headline on the one page that has one.
        document.body.style.paddingTop = height + 'px';
    }

    function clearOffset() {
        var header = document.querySelector('header.header');
        if (header) header.style.top = '';
        document.body.style.paddingTop = '';
        lastHeight = null;
    }

    function hide() {
        if (strip) strip.classList.remove('is-ready');
        clearOffset();
    }

    /* Kickoff times are shown in Eastern regardless of where the reader is, the
       way the rest of the site does it — a bettor reads a slate in ET. */
    function formatKickoff(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        var opts = { timeZone: 'America/New_York' };
        var time = date.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit'
        });
        var today = new Date().toLocaleDateString('en-US', opts);
        if (date.toLocaleDateString('en-US', opts) === today) return time + ' ET';
        var weekday = date.toLocaleDateString('en-US', {
            timeZone: 'America/New_York', weekday: 'short'
        });
        return weekday + ' ' + time + ' ET';
    }

    function formatLine(line) {
        if (!line) return '';
        if (!line.team) return 'PK';
        return line.team + ' ' + line.points;
    }

    function teamRow(team, isPre, isLoser) {
        var row = el('div', 'yiq-tk__row' + (isLoser ? ' is-loser' : ''));
        if (team.logo) {
            var img = el('img');
            img.src = team.logo;
            img.alt = '';
            img.loading = 'lazy';
            row.appendChild(img);
        }
        row.appendChild(el('span', 'yiq-tk__abbr', team.abbr));
        row.appendChild(el('span', 'yiq-tk__score', isPre ? '' : String(team.score)));
        return row;
    }

    function gameCard(game) {
        var isPre = game.state === 'pre';
        var card = el('div', 'yiq-tk__game' + (game.state === 'post' ? ' is-final' : ''));

        card.appendChild(teamRow(game.away, isPre, game.winner === 'home'));
        card.appendChild(teamRow(game.home, isPre, game.winner === 'away'));

        var status = el('div', 'yiq-tk__status' + (game.state === 'in' ? ' is-live' : ''));
        if (game.state === 'in') status.appendChild(el('span', 'yiq-tk__dot'));

        if (isPre) {
            status.appendChild(el('span', null, formatKickoff(game.kickoff)));
            if (game.line) {
                status.appendChild(el('span', 'yiq-tk__line', '· ' + formatLine(game.line)));
            }
        } else {
            status.appendChild(el('span', null, game.detail));
        }
        card.appendChild(status);
        return card;
    }

    function render(data) {
        if (!data || !data.games || !data.games.length) {
            hide();
            return false;
        }

        var label = strip.querySelector('.yiq-tk__label');
        label.textContent = '';
        label.appendChild(el('b', null, data.week ? 'WEEK ' + data.week : 'NFL'));
        label.appendChild(el('span', null, data.season ? String(data.season) : 'SCORES'));

        var next = document.createDocumentFragment();
        data.games.forEach(function (game) { next.appendChild(gameCard(game)); });
        rail.textContent = '';
        rail.appendChild(next);

        strip.classList.add('is-ready');
        applyOffset();
        return data.games.some(function (game) { return game.state === 'in'; });
    }

    function schedule(isLive) {
        clearTimeout(timer);
        timer = setTimeout(poll, isLive ? POLL_LIVE_MS : POLL_IDLE_MS);
    }

    /* Polling stops while the tab is in the background — there is no point
       burning requests on scores nobody is reading, and the visibilitychange
       listener starts it again on return. Only the repeat is skipped, never the
       first load: a page opened in a background tab still fills its strip so it
       is ready the moment that tab comes forward. */
    function poll() {
        if (document.visibilityState === 'hidden') return;
        load();
    }

    function load() {
        fetch(ENDPOINT, { headers: { Accept: 'application/json' } })
            .then(function (res) {
                if (!res.ok) throw new Error('scoreboard ' + res.status);
                return res.json();
            })
            .then(function (data) { schedule(render(data)); })
            .catch(function () {
                // The strip is decoration on a page that sells picks. If the
                // feed is down it leaves quietly and tries again later.
                hide();
                schedule(false);
            });
    }

    function init() {
        injectCss();

        strip = el('div', 'yiq-tk');
        strip.setAttribute('aria-label', 'NFL scoreboard');
        strip.appendChild(el('div', 'yiq-tk__label'));
        rail = el('div', 'yiq-tk__rail');
        strip.appendChild(rail);
        document.body.appendChild(strip);

        window.addEventListener('resize', applyOffset);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') load();
        });

        load();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
