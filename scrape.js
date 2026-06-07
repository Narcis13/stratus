/* ============================================================================
 * X (Twitter) Harvester  —  standalone console script  (human-paced)
 * ----------------------------------------------------------------------------
 * Scrapes a public profile's POSTS or POSTS-&-REPLIES timeline into a CSV that
 * downloads to your browser's Downloads folder.
 *
 * This version scrolls like a human: variable eased "flicks", randomized
 * reading pauses (with occasional long breaks), the odd scroll-back-up, and
 * jittered waits while new tweets load — to avoid tripping automation
 * heuristics on X's backend. It is slower on purpose.
 *
 * HOW TO USE
 *   1. Log in to x.com in Chrome.
 *   2. Open the profile you want:
 *        Posts            ->  https://x.com/<handle>
 *        Posts & replies  ->  https://x.com/<handle>/with_replies
 *   3. Open DevTools (F12 / Cmd-Opt-I) -> Console tab.
 *   4. Paste this whole file and press Enter.
 *   5. Run one of:
 *        xHarvest.posts()                              // scrape the Posts tab
 *        xHarvest.replies()                            // scrape Posts & replies
 *        xHarvest.posts({ max: 500 })                  // stop after ~500 rows
 *        xHarvest.replies({ untilDate: '2026-05-01' }) // stop once older than a date
 *        xHarvest.posts({ pace: 'slow' })              // extra-cautious pacing
 *   6. KEEP THE TAB IN THE FOREGROUND. X pauses "load more on scroll" when the
 *      tab is backgrounded, so leave it visible while it runs.
 *   When it finishes it logs a summary and downloads <handle>_<mode>_<date>.csv
 *
 * OPTIONS  (all optional)
 *   max         number   stop after this many rows                (default: unlimited)
 *   untilDate   'YYYY-MM-DD'  stop once oldest item is older       (default: none)
 *   pace        'slow' | 'human' | 'fast'                          (default: 'human')
 *   stepCap     number   hard safety cap on scroll cycles          (default: 4000)
 *   ...any preset field below can also be overridden directly, e.g. { pauseMax: 5000 }
 *
 * NOTES
 *   - Metrics come from each tweet's exact aria-label (precise integers).
 *   - Timestamps are ISO 8601 UTC from each tweet's <time datetime>.
 *   - Rows are de-duplicated by tweet id, so overlapping scrolls never double up.
 *   - Reposts/retweets with no added text are skipped.
 *   - "Human" pacing means a few hundred rows can take several minutes. That's
 *     intended — gentler on rate limits and far less bot-like.
 * ========================================================================== */
(function () {
    'use strict';
  
    const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
    // randomness helpers ------------------------------------------------------
    const rand = (a, b) => a + Math.random() * (b - a);
    const randInt = (a, b) => Math.floor(rand(a, b + 1));
    const chance = (p) => Math.random() < p;
    // bell-ish distribution (avg of 3 uniforms) so most values cluster mid-range
    const gauss = (min, max) => {
      let s = 0; for (let i = 0; i < 3; i++) s += Math.random();
      return min + (s / 3) * (max - min);
    };
  
    // pacing presets ----------------------------------------------------------
    const PRESETS = {
      slow: {
        flickMin: 0.25, flickMax: 0.50,        // fraction of a viewport per flick
        pauseMin: 2200, pauseMax: 4200,        // normal "reading" pause (ms)
        longChance: 0.20, longMin: 5000, longMax: 9000,   // occasional long break
        backChance: 0.12, backMin: 0.10, backMax: 0.30,   // occasional scroll-up
        loadMin: 2200, loadMax: 3800,          // wait at bottom for new tweets
        stableNeeded: 6,                       // bottom checks with no growth -> stop
      },
      human: {
        flickMin: 0.35, flickMax: 0.65,
        pauseMin: 1400, pauseMax: 2800,
        longChance: 0.14, longMin: 3500, longMax: 6500,
        backChance: 0.08, backMin: 0.08, backMax: 0.25,
        loadMin: 1600, loadMax: 3000,
        stableNeeded: 5,
      },
      fast: {
        flickMin: 0.55, flickMax: 0.85,
        pauseMin: 700, pauseMax: 1500,
        longChance: 0.06, longMin: 2000, longMax: 3500,
        backChance: 0.04, backMin: 0.06, backMax: 0.18,
        loadMin: 1200, loadMax: 2200,
        stableNeeded: 5,
      },
    };
  
    // ----- DOM helpers -------------------------------------------------------
    function profileHandle() {
      const m = location.pathname.match(/^\/([A-Za-z0-9_]+)/);
      return m ? m[1].toLowerCase() : null;
    }
  
    function parseMetrics(aria) {
      // aria like: "19 replies, 4 reposts, 38 likes, 2 bookmarks, 845 views"
      const res = { comments: 0, reposts: 0, likes: 0, bookmarks: 0, views: 0 };
      if (!aria) return res;
      const g = (re) => { const m = aria.match(re); return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0; };
      res.comments  = g(/([\d,]+)\s+repl/i);
      res.reposts   = g(/([\d,]+)\s+repost/i);
      res.likes     = g(/([\d,]+)\s+like/i);
      res.bookmarks = g(/([\d,]+)\s+bookmark/i);
      res.views     = g(/([\d,]+)\s+view/i);
      return res;
    }
  
    function idFrom(art) {
      const a = Array.from(art.querySelectorAll('a[href*="/status/"]'))
        .find((x) => /\/status\/\d+/.test(x.getAttribute('href')));
      if (!a) return null;
      const m = a.getAttribute('href').match(/\/([^\/]+)\/status\/(\d+)/);
      return m ? { handle: m[1], id: m[2], url: 'https://x.com/' + m[1] + '/status/' + m[2] } : null;
    }
  
    function extractArticle(art) {
      const id = idFrom(art);
      const txtEl = art.querySelector('div[data-testid="tweetText"]');
      const time = art.querySelector('time');
      const grp = art.querySelector('div[role="group"][aria-label]');
      const isRepost = /(reposted|You reposted)/i.test(
        (art.querySelector('[data-testid="socialContext"]') || {}).textContent || ''
      );
      return {
        handle: id ? id.handle : null,
        id: id ? id.id : null,
        url: id ? id.url : '',
        text: txtEl ? txtEl.innerText.replace(/\s*\n\s*/g, ' ').trim() : '',
        time: time ? time.getAttribute('datetime') : '',
        metrics: parseMetrics(grp ? grp.getAttribute('aria-label') : ''),
        isRepost,
      };
    }
  
    function groupsOfArticles() {
      // Conversation items in the timeline are separated by empty cells.
      const cells = Array.from(document.querySelectorAll('div[data-testid="cellInnerDiv"]'));
      const groups = [];
      let cur = [];
      for (const c of cells) {
        const a = c.querySelector('article[data-testid="tweet"]');
        if (a) cur.push(a);
        else { if (cur.length) groups.push(cur); cur = []; }
      }
      if (cur.length) groups.push(cur);
      return groups;
    }
  
    // ----- harvest one rendered screen --------------------------------------
    function harvestReplies(store, profile) {
      let added = 0;
      for (const g of groupsOfArticles()) {
        const items = g.map(extractArticle);
        for (let k = 1; k < items.length; k++) {
          const reply = items[k];
          if (reply.handle && reply.handle.toLowerCase() === profile && reply.id) {
            const orig = items[k - 1];
            if (!store[reply.id]) added++;
            store[reply.id] = {
              o_text: orig.text, o_comments: orig.metrics.comments, o_likes: orig.metrics.likes,
              o_views: orig.metrics.views, o_time: orig.time, o_handle: orig.handle,
              r_text: reply.text, r_comments: reply.metrics.comments, r_likes: reply.metrics.likes,
              r_views: reply.metrics.views, r_time: reply.time,
            };
          }
        }
      }
      return added;
    }
  
    function harvestPosts(store, profile) {
      let added = 0;
      for (const g of groupsOfArticles()) {
        for (const art of g) {
          const p = extractArticle(art);
          if (!p.id) continue;
          if (p.handle && p.handle.toLowerCase() !== profile) continue; // skip others
          if (p.isRepost) continue;                                     // skip bare reposts
          if (!store[p.id]) added++;
          store[p.id] = {
            text: p.text, comments: p.metrics.comments, reposts: p.metrics.reposts,
            likes: p.metrics.likes, bookmarks: p.metrics.bookmarks, views: p.metrics.views,
            time: p.time, handle: p.handle, url: p.url,
          };
        }
      }
      return added;
    }
  
    // ----- CSV builders ------------------------------------------------------
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  
    function repliesCSV(store) {
      const header = ['Original post text', 'Original post comments', 'Original post likes',
        'Original post views', 'Original post Date and time', 'Original post twitter handle @...',
        'Reply text', 'Reply comments', 'Reply likes', 'Reply views', 'Reply Date and time'];
      const rows = Object.values(store).sort((a, b) => (b.r_time || '').localeCompare(a.r_time || ''));
      const lines = [header.map(esc).join(',')];
      for (const r of rows) {
        lines.push([esc(r.o_text), esc(r.o_comments), esc(r.o_likes), esc(r.o_views), esc(r.o_time),
          esc('@' + (r.o_handle || '')), esc(r.r_text), esc(r.r_comments), esc(r.r_likes),
          esc(r.r_views), esc(r.r_time)].join(','));
      }
      return '﻿' + lines.join('\r\n');
    }
  
    function postsCSV(store) {
      const header = ['Post text', 'Comments', 'Reposts', 'Likes', 'Bookmarks', 'Views',
        'Date and time', 'Handle @...', 'URL'];
      const rows = Object.values(store).sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      const lines = [header.map(esc).join(',')];
      for (const r of rows) {
        lines.push([esc(r.text), esc(r.comments), esc(r.reposts), esc(r.likes), esc(r.bookmarks),
          esc(r.views), esc(r.time), esc('@' + (r.handle || '')), esc(r.url)].join(','));
      }
      return '﻿' + lines.join('\r\n');
    }
  
    function download(csv, name) {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    }
  
    // ----- human-like scrolling ---------------------------------------------
    // Animate a scroll over `distance` px in several eased increments with tiny
    // per-frame jitter, so it reads as a trackpad/wheel flick rather than a jump.
    async function humanScroll(se, distance) {
      const frames = randInt(10, 20);
      let done = 0;
      for (let i = 1; i <= frames; i++) {
        const t = i / frames;
        const ease = 1 - Math.pow(1 - t, 2);  // easeOutQuad (decelerates near end)
        const target = distance * ease;
        se.scrollTop += (target - done) + rand(-2, 2);
        done = target;
        await sleep(rand(12, 34));
      }
    }
  
    async function readingPause(cfg) {
      let ms = gauss(cfg.pauseMin, cfg.pauseMax);
      if (chance(cfg.longChance)) ms = gauss(cfg.longMin, cfg.longMax); // got distracted
      await sleep(ms);
    }
  
    // ----- main loop ---------------------------------------------------------
    async function run(mode, opts) {
      opts = opts || {};
      const profile = profileHandle();
      if (!profile) { console.error('[xHarvest] Could not read a handle from the URL.'); return; }
  
      const onReplies = /\/with_replies\b/.test(location.pathname);
      if (mode === 'replies' && !onReplies) console.warn('[xHarvest] Not on /with_replies — navigate there for reply pairs.');
      if (mode === 'posts' && onReplies) console.warn('[xHarvest] You are on /with_replies. For pure posts use the main profile tab.');
      if (document.visibilityState !== 'visible')
        console.warn('[xHarvest] Tab looks backgrounded — bring it to the foreground or X will not load more.');
  
      const cfg = Object.assign({}, PRESETS[opts.pace] || PRESETS.human, opts); // opts can override any field
      const store = {};
      const harvest = mode === 'replies' ? harvestReplies : harvestPosts;
      const oldestOf = (s) => Object.values(s).reduce((min, r) => {
        const t = mode === 'replies' ? r.r_time : r.time; return (!min || (t && t < min)) ? t : min;
      }, null);
  
      const se = document.scrollingElement;
      const max = opts.max || Infinity;
      const untilDate = opts.untilDate ? new Date(opts.untilDate + 'T00:00:00Z').toISOString() : null;
      const HARD_STEP_CAP = opts.stepCap || 4000;
      let lastH = 0, stable = 0, idle = 0, steps = 0;
  
      console.log('[xHarvest] ' + mode + ' scrape of @' + profile
        + ' — pace "' + (opts.pace || 'human') + '". Keep this tab visible; this is intentionally slow.');
      await sleep(gauss(600, 1500));            // settle before starting
      se.scrollTop = 0;
      await sleep(gauss(500, 1200));
  
      while (steps < HARD_STEP_CAP) {
        const added = harvest(store, profile);
        const count = Object.keys(store).length;
        const oldest = oldestOf(store);
  
        if (count >= max) { console.log('[xHarvest] Reached max=' + max + '.'); break; }
        if (untilDate && oldest && oldest < untilDate) { console.log('[xHarvest] Reached date cutoff ' + opts.untilDate + '.'); break; }
  
        const atBottom = se.scrollTop + se.clientHeight >= se.scrollHeight - 5;
        if (atBottom) {
          if (se.scrollHeight === lastH) {
            stable++;
            if (stable >= cfg.stableNeeded) { console.log('[xHarvest] Bottom reached, no new content.'); break; }
          } else stable = 0;
          lastH = se.scrollHeight;
          await sleep(gauss(cfg.loadMin, cfg.loadMax));   // wait for lazy-load
        } else {
          // occasionally drift back up a little, like a human re-reading
          if (chance(cfg.backChance)) {
            await humanScroll(se, -rand(cfg.backMin, cfg.backMax) * se.clientHeight);
            await sleep(gauss(500, 1300));
          }
          const frac = rand(cfg.flickMin, cfg.flickMax);
          await humanScroll(se, frac * se.clientHeight);
          await readingPause(cfg);
        }
  
        if (added === 0) idle++; else idle = 0;
        if (idle > 0 && idle % 20 === 0)
          console.log('[xHarvest] ' + count + ' rows so far (oldest ' + (oldest || '?') + ') ...');
        steps++;
      }
      harvest(store, profile);
  
      const rows = Object.values(store);
      const csv = mode === 'replies' ? repliesCSV(store) : postsCSV(store);
      const today = new Date().toISOString().slice(0, 10);
      const name = profile + '_' + mode + '_' + today + '.csv';
      download(csv, name);
  
      const times = rows.map((r) => (mode === 'replies' ? r.r_time : r.time)).filter(Boolean).sort();
      console.log('[xHarvest] DONE. ' + rows.length + ' ' + mode + ' rows. '
        + 'Range ' + (times[0] || '?') + ' .. ' + (times[times.length - 1] || '?') + '. Saved ' + name);
      window.__xHarvestLast = { mode, profile, rows, csv, name };
      return { rows: rows.length, file: name };
    }
  
    window.xHarvest = {
      posts:   (opts) => run('posts', opts),
      replies: (opts) => run('replies', opts),
      redownload: () => { const L = window.__xHarvestLast; if (L) download(L.csv, L.name); },
    };
    console.log('%c[xHarvest] loaded (human-paced).', 'color:#1d9bf0;font-weight:bold');
    console.log('Run:  xHarvest.posts()   or   xHarvest.replies()   ·   options: { pace:"slow|human|fast", max, untilDate }');
  })();
  