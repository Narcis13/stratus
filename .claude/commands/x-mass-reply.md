---
description: Mass-reply session on x.com via Chrome — 35–45 replies in ~30 min. Harvest a wave of fresh cards by script, cook every reply in one pass, fire each through X's web-intent composer (one round trip per reply). No likes, no per-post browsing, no screenshots. Optional tab / Latest search source, optional notifications loop.
argument-hint: <count> [tab | q: <search terms>] [loop]
---

Post replies on x.com using Claude in Chrome, in bulk. Parse `$ARGUMENTS`:

- **count**: the first bare number. Missing → 40. **Hard cap 45.**
- **source** (optional, everything after the count that isn't `loop`):
  - `q: <terms>` → the Latest search for those terms, every wave (`https://x.com/search?q=<encoded>&f=live`). Append ` -filter:replies lang:en` unless the user already wrote operators.
  - anything else → a home tab: `Following`, `For You`, or a pinned list (`Big Boys`, `Build in Public`…). Case-insensitive. Stay on it every wave.
  - nothing → rotate **Following → For You → Following → For You…**, one source per wave.
- **`loop`** anywhere: after the last wave, answer up to 3 real replies-to-me from notifications (they don't count toward `count`).

Examples: `/x-mass-reply` → 40 replies, rotating sources. `/x-mass-reply 36 Following` → 36 on Following. `/x-mass-reply 45 q: claude code` → 45 from the Latest search. `/x-mass-reply 40 Big Boys loop`.

Running this command IS the authorization to post that many replies. Never ask before a reply. Do the work, report at the end.

**Volume note.** `/x-reply` caps at 20 because X's Original Content Rewards rules name "content generated using automated tools to create engagement" and volume is the behavioural signature they police. This command runs at 35–45 by the operator's decision. The mitigations are structural and not optional: one reply per author per day, never faster than one reply per ~20 s, waves ~8 min apart, every reply written to the post it answers, and at most two runs a day, hours apart.

## Who is replying

I'm a 51-year-old veteran dev, solopreneur, building in public, into programming, AI and marketing. I'm an aspiring X creator: the point of every reply is (a) a stranger taps my profile and follows, (b) the author replies back or notices me, (c) I end up in the replies of people 2–10× my size in adjacent niches (builders, indie hackers, AI, solo business, marketing). That background is material ONLY when the post is genuinely about building, code, AI, solo business or marketing. Under anything else it is background: never mention it, never bend the topic toward it. An advert under a news wire got 2 views out of 27k. Reply to what the post is actually about.

## Why this is fast (and why waves)

`/x-reply` spends ~9 browser round trips per reply (scroll, read, click reply, read modal, type, screenshot, post, confirm, like). This command spends **one**: X's web intent `https://x.com/intent/post?in_reply_to=<id>&text=<encoded>` opens the real reply composer, parent post shown, text prefilled, so a reply is `navigate` + one verify-and-click script. Everything else moves out of the loop:

1. **Harvest** — one script reads 40–60 cards off the feed (id, handle, ISO age, replies, views, views-per-minute, verified, lane, bait flags), ranks them, and hands the table back in one read. No screenshots, no per-card reads.
2. **Cook** — every reply for the wave is written in one pass, gated by `.claude/scripts/x-mass-reply.py`, which also prints the ready-made intent URLs.
3. **Fire** — batches of three replies per browser call, mechanical.

**Waves of 15, not one batch of 45.** Timing is the whole game (table below): a post that is 10 min old at harvest is 40 min old by the time reply #40 fires if you harvest everything first. Harvest → cook → fire in ~8-minute waves keeps every reply inside its window, and each new wave sees the cards that arrived while the last one was firing. Fire order inside a wave is freshest first. For `count` 40 that is three waves (15 / 15 / 10).

## Setup

0. Keep the Mac awake (idle-sleep at 1 min, display blank at 10 min kills the run):
   ```bash
   nohup caffeinate -dis -t 2700 >/dev/null 2>&1 &
   ```
1. Load the Chrome tools in one `ToolSearch` call if not loaded:
   `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp`
2. `tabs_context_mcp` with `createIfEmpty: true`; use that tab for the whole run (call it `TAB`).
3. Today's skip list, so no post gets a second reply across sessions:
   ```bash
   python3 .claude/scripts/x-mass-reply.py skip
   ```
   Paste the printed `const SKIP=new Set([...]);` line over the first line of the harvest script below. The stderr line tells you how many went out today already; if it is over 40, stop and say so (two runs a day is the ceiling).

## The wave loop

Repeat until `count` is reached or the sources run dry. `WAVE = min(15, remaining)`.

### 1. Harvest (one browser_batch)

For a home tab: `navigate` to `https://x.com/home` (`force: true`), `computer` wait 3, then the tab-select script, then the harvest script, then `get_page_text`. For `q:`: `navigate` to the search URL, wait 3, harvest script, `get_page_text` (no tab select).

Tab-select script (skip for For You, which is the default tab):
```js
const want='<tab label>'.toLowerCase();
[...document.querySelectorAll('[role="tablist"] [role="tab"]')].find(t=>t.innerText.trim().toLowerCase()===want)?.click();
await new Promise(r=>setTimeout(r,2500));
[...document.querySelectorAll('[role="tablist"] [role="tab"]')].find(t=>t.getAttribute('aria-selected')==='true')?.innerText.trim()
```
It returns the selected label. If it isn't the tab you asked for, **stop and report the labels** (`[...document.querySelectorAll('[role="tablist"] [role="tab"]')].map(t=>t.innerText.trim())`); never fall back silently to For You.

Harvest script (verified 2026-09-12 against the live DOM; selectors mirror the extension's fixture-tested ones):
```js
const SKIP=new Set([]);            // ← replace with the `skip` output line
const PASSES=5, MAX_AGE=60;        // minutes. Notifications pass: MAX_AGE=1440
const ONLY_REPLIES_TO='';          // '' on a feed; '13_narcissus' on /notifications/mentions
const num=s=>{if(!s)return 0;s=String(s).replace(/,/g,'');const m=s.match(/([\d.]+)\s*([KMB])?/i);if(!m)return 0;const u=(m[2]||'').toUpperCase();return Math.round(parseFloat(m[1])*(u==='K'?1e3:u==='M'?1e6:u==='B'?1e9:1));};
const pick=(aria,w)=>{const m=aria.match(new RegExp('([\\d.,]+[KMB]?)\\s*'+w,'i'));return m?num(m[1]):0;};
const LANE=/\b(ai|agents?|llm|claude|cursor|codex|gpt|openai|anthropic|code|coding|dev|developer|engineer|founder|indie|saas|mrr|startup|marketing|launch|ship|shipped|build|building|solo|bootstrap|vibe)\b/i;
const BAIT=/(drop your|reply with|comment (a|one) word|which one are you|rt if|repost if|tag someone|follow (me|back)|like if|introduce yourself|your handle|say hi|let'?s connect)/i;
const HOT=/\b(israel|gaza|ukraine|russia|trump|biden|election|shooting|dies|died|rip|funeral|cancer|hamas|iran)\b/i;
const seen=new Set(), out=[]; const hv=new Date().toISOString();
const src=[...document.querySelectorAll('[role="tablist"] [role="tab"]')].find(t=>t.getAttribute('aria-selected')==='true')?.innerText.trim()||location.pathname;
for(let p=0;p<PASSES;p++){
  for(const a of document.querySelectorAll('article[data-testid="tweet"]')){
    const link=a.querySelector('a[href*="/status/"]'); if(!link) continue;
    const m=link.pathname.match(/^\/([^/]+)\/status\/(\d+)/); if(!m) continue;
    const id=m[2]; if(seen.has(id)) continue; seen.add(id); if(SKIP.has(id)) continue;
    const dt=a.querySelector('time')?.getAttribute('datetime'); if(!dt) continue;
    const age=(Date.now()-Date.parse(dt))/60000; if(age>MAX_AGE) continue;
    const aria=a.querySelector('[data-testid="reply"]')?.closest('div[role="group"]')?.getAttribute('aria-label')||''; if(!aria) continue;
    const sc=a.querySelector('[data-testid="socialContext"]')?.textContent?.trim()||'';
    if(a.querySelector('[data-testid="placementTracking"]')||/^(ad$|promoted|sponsored)/i.test(sc)) continue;
    const isReply=/^Replying to @/m.test(a.innerText);
    if(ONLY_REPLIES_TO){ if(!new RegExp('^Replying to @'+ONLY_REPLIES_TO,'mi').test(a.innerText)) continue; } else if(isReply) continue;
    if(a.querySelector('[data-testid*="poll" i]')) continue;
    const text=(a.querySelector('[data-testid="tweetText"]')?.innerText||'').replace(/https?:\/\/\S+/g,'[link]').trim();
    if(!text) continue;
    const rep=pick(aria,'repl'), likes=pick(aria,'like'), views=pick(aria,'view');
    const vpm=Math.round(views/Math.max(age,1));
    const v=!!a.querySelector('[data-testid="User-Name"] [data-testid="icon-verified"]');
    const lane=LANE.test(text), bait=BAIT.test(text), hot=HOT.test(text), more=!!a.querySelector('[data-testid="tweet-text-show-more-link"]');
    const score=(age<15?3:age<30?2:1)+(vpm>=100?3:vpm>=30?2:vpm>=8?1:0)+(rep<10?1:0)-(rep>=40?2:0)+(v?1:0)+(lane?1:0)-(bait?9:0)-(hot?9:0)-(more?1:0);
    out.push({id,h:m[1],n:(a.querySelector('[data-testid="User-Name"] a')?.textContent||'').trim().slice(0,30),v,age:Math.round(age),rep,likes,views,vpm,lane,bait,hot,more,score,t:text.replace(/\s+/g,' ').slice(0,280)});
  }
  window.scrollBy(0,window.innerHeight*2.5); await new Promise(r=>setTimeout(r,1500));
}
out.sort((x,y)=>y.score-x.score||x.age-y.age);
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
document.body.innerHTML='<article><h1>HARVEST</h1><p>'+esc(JSON.stringify({hv,src,n:out.length,seen:seen.size}))+'</p>'+out.map(r=>'<p>'+esc(JSON.stringify(r))+'</p>').join('')+'<p>END</p></article>';
'harvested '+out.length+' of '+seen.size
```
The script replaces the page body with the table on purpose: the JS tool's own return is capped at ~1 KB, `get_page_text` is not, and the next wave reloads the page anyway. The first row is the header; copy its `hv` into the wave file. Fewer than 8 rows → switch source for this wave (Following ↔ For You, or the standing Latest search `(claude code OR cursor OR codex OR "coding agent" OR "vibe coding" OR "indie hacker" OR solopreneur OR "build in public") -filter:replies -filter:links lang:en`). Never lower `MAX_AGE`.

### 2. Cook (one pass, no browser)

Pick `WAVE` rows from the table and write every reply in one message. The table is pre-ranked by `score` then age, but the score is a sort key, not the decision:

1. **Fresh + moving + uncrowded** (`age` < 15, high `vpm`, `rep` < 10). The early slot on a post about to take off. Take every one.
2. **Fresh + on-lane + small-to-mid** (`age` < 60, `lane`, 300–2,000 views, `rep` < 40). These followers convert. Persona allowed.
3. **Fresh + off-lane + big** (`age` < 30, high `vpm`, any topic). Pure reach. Persona OFF. Only with a genuine one-line reaction.
4. Anything else fresh, only to fill the wave.

Weight toward `v: true` (verified authors: their reply threads rank Premium replies first and their audiences are the audience X now counts). Skip outright: `bait`, `hot`, `rep` ≥ 40 unless `age` < 15 and huge, a second post by an author already in this wave or today's ledger, anything you can't react to without inventing a fact, stat or anecdote. `more: true` (truncated) only if the visible part is a complete idea, never a set-up for a reveal you can't see. You don't see the existing replies in this mode; the `rep` < 10 preference is what keeps "someone already made my point" rare.

Write the wave file to the scratchpad, rows in any order:
```json
{"hv": "<hv from the HARVEST header>", "source": "Following",
 "rows": [{"id": "…", "h": "handle", "age": 12, "gist": "one line on the post", "reply": "…"}]}
```
Then gate it:
```bash
python3 .claude/scripts/x-mass-reply.py plan <scratch>/wave-N.json
```
Fix every `FAIL` (rewrite the line, or drop the row if the post can't be answered cleanly), read every `WARN`, re-run until it prints the `id / handle / age / url` table. That table is the fire list, already sorted freshest first, URLs already encoded. Do not hand-build a URL.

### 3. Fire (mechanical)

Three replies per `browser_batch`, in table order:
```
navigate {url: <url1>, tabId: TAB, force: true}
javascript_tool {VERIFY}
computer {action: "wait", duration: 8}
navigate {url: <url2>, tabId: TAB, force: true}
javascript_tool {VERIFY}
computer {action: "wait", duration: 8}
navigate {url: <url3>, tabId: TAB, force: true}
javascript_tool {VERIFY}
```
`force: true` is required: a composer left with text arms X's "Leave site?" prompt, which otherwise blocks the next navigate and kills the batch. Discarding it posts nothing.

`VERIFY` is the same script for every reply; it reads the id and text back from the URL and the expected handle from the `#h=` fragment, so nothing is substituted per reply:
```js
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=s=>(s||'').replace(/\s+/g,' ').trim();
const q=new URLSearchParams(location.search); const id=q.get('in_reply_to')||''; const want=q.get('text')||'';
const wantH=(location.hash.match(/h=([A-Za-z0-9_]+)/)||[])[1]||'';
let ta=null; for(let i=0;i<25&&!ta;i++){ta=document.querySelector('[data-testid="tweetTextarea_0"]'); if(!ta) await sleep(300);}
let out;
if(!id||!want) out='bad-url';
else if(!ta) out='no-composer';
else {
  const layer=document.getElementById('layers')||document.body;
  const parent=layer.querySelector('article[data-testid="tweet"]');
  const gotH=((layer.innerText||'').match(/Replying to @([A-Za-z0-9_]+)/i)||[])[1]||'';
  const btn=document.querySelector('[data-testid="tweetButton"]');
  if(!parent||!gotH) out='not-a-reply';
  else if(wantH&&gotH.toLowerCase()!==wantH.toLowerCase()) out='wrong-parent @'+gotH;
  else if(norm(ta.innerText)!==norm(want)) out='text-mismatch '+norm(ta.innerText).slice(0,50);
  else if(!btn||btn.getAttribute('aria-disabled')==='true') out='button-disabled';
  else { btn.click(); out='clicked-unconfirmed';
    for(let i=0;i<25;i++){ await sleep(400); const t=layer.innerText||'';
      if(/Something went wrong|unable to reply|can.t reply|cannot reply|over the daily limit|try again later/i.test(t)){out='error';break;}
      if(!document.querySelector('[data-testid="tweetTextarea_0"]')||/Your post was sent/i.test(t)){out='sent @'+gotH;break;} } }
}
id+' '+out
```
It clicks Reply only when the overlay holds exactly the parent post, "Replying to @handle" matches the fragment, and the composer text equals the plan text. Every other path returns without clicking, so the only way a standalone post could go out is if all three lie at once.

Outcomes: `sent` (done), `clicked-unconfirmed` (treat as sent; the report flags it), `no-composer` (page didn't load; retry that one URL once, it is the only retryable outcome because nothing was clicked), `not-a-reply` / `wrong-parent` / `text-mismatch` / `button-disabled` / `error` / `bad-url` (log it, move on). **Never re-fire a URL after a click, whatever the confirmation said**; a double post is worse than a missed one. Two `error` in a row → X is throttling or the account is flagged: stop the run, log, report.

This phase is mechanical. Do not re-read the post, do not rewrite the reply, do not screenshot, do not deliberate between batches: fire, note the three outcome lines, fire the next. After the wave's last batch, log it:
```bash
python3 .claude/scripts/x-mass-reply.py log <scratch>/wave-N.json <id>=sent <id>=error …
```
(`sent @handle` → write just `sent`.) The ledger is what the next wave's `skip` and the final report read, so log every wave before harvesting the next.

### 4. Next wave

Rotate the source (or stay, if one was given), re-run `skip`, harvest again. Following is chronological, so a re-harvest 8 minutes later is mostly new cards.

## Picking posts — timing is the whole game

Measured on this account (2026):

| reply posted after parent | avg views on my reply |
|---|---|
| under 15 min | 720 |
| 15–60 min | 205 |
| 1–6 h | 120 |

Ninety percent of all reply impressions came from the under-15-minute bucket, and replies under posts with fewer than 10 existing replies captured 3.3% of the parent's views. The harvest enforces the hard rule (`MAX_AGE=60`) and the fire order (freshest first) enforces the jackpot; the cook step must not undo either by picking interesting-but-old rows over dull-but-fresh ones.

## Voice — the part that decides the profile tap

One reply = one idea. A person picks one detail out of a post and reacts to it; a model answers the whole post. Grab the single word or number that struck you, echo it (their exact term, not a paraphrase), and take a position on it.

- **Open on the strongest word.** No throat-clearing. No "great point", "honestly", "I think", "this". If the sharp bit is at the end, move it to the front and cut what was there.
- **Length 40–90 characters, 140 max.** My best replies ran 34–110. One sentence is usually the whole reply. Two propositions only when the post is on-lane; then put a blank line between them.
- **No punctuation marks.** No periods, commas, semicolons, colons, exclamation marks. Line breaks do that work. A real question ends with `?` and nothing else.
- **Blank lines between thought chunks** when there's more than one, the way people type on X.
- **Lowercase is fine.** Contractions always. Fragments welcome. Dropped apostrophes fine (`dont`, `im`).
- **Take a side with a hole in it.** "probably wrong but" reads more human than a balanced take. Never both-sides.
- **Vary stance across the wave:** some extend the point to the next consequence, some push back with a defensible reason (heat not hate), some are a flat one-line reaction. Under grief, health or a funeral post: only warmth or extension, never contrarian.
- **Vary the openers across the wave.** Fifteen replies written in one sitting drift toward one rhythm; the gate fails a first word used three times, and warns on repeated two-word openers. Read the wave top to bottom once before gating: if it sounds like one person typing fifteen times, it is.
- **Match the room.** Football, a chip-history thread and a founder's launch are three registers. Write the one the room already speaks.
- **A question is not the default ending.** Most replies stop on a flat claim and let curiosity do the work. Ask only when it's a real question the author would want to answer. Never "A or B, which one actually…?"

Never, these are the 2026 LLM tells:
- em dashes, `not X but Y` / `it isn't X, it's Y` antithesis, three-item lists, `however/moreover/that said/here's the thing`, a closing line that restates the point, explaining the joke
- `delve, tapestry, testament, realm, landscape, nuanced, underscore, pivotal, crucial, foster, resonate, navigate, leverage, game-changer, unlock, elevate, hits different, the fact that X is wild, this is why X matters, absolutely, truly, genuinely, a masterclass in`
- opening with `I`/`my` (unless the reply IS the anecdote), a subordinate clause (`While…`, `Given that…`), `The reality of…`, or a restatement of the post
- hashtags, links, emoji (at most one, rarely, when the room is playful), @mentioning the author, "check my profile", "follow me", any self-promo, summoning @grok, one-word chants
- invented spelling mistakes. Sloppiness lives in rhythm and dropped punctuation, not in misspelled words.
- stacking casual markers: at most ONE of `idk / ngl / tbh / lol / yeah / …` per reply, never in a serious thread

Fabrication is the one unforgivable error: no made-up stats, no fake "happened to me yesterday", no numbers that aren't in the post or common knowledge.

## Loop (only with `loop`)

One extra mini-wave: harvest `https://x.com/notifications/mentions` with `ONLY_REPLIES_TO='13_narcissus'` and `MAX_AGE=1440`, answer up to 3 that carry a real question or pushback (skip likes-only, emoji, "great post"), one line each in the same voice, wave file `wave-loop.json` with `"source": "notifications"`, same gate, same fire, same log. A reply-to-reply chain is the strongest conversation signal the ranker has; three of them cost ~2 minutes.

## Wrap-up

1. `pkill -f 'caffeinate -dis -t' || true` (does not match Claude Code's own `-i -t 300`).
2. Close the tab you used (`tabs_close_mcp`).
3. `python3 .claude/scripts/x-mass-reply.py report` and paste its table and totals line.
4. Then, in prose: which sources each wave used and how many eligible rows each harvest produced; anything `clicked-unconfirmed` (tell the operator to eyeball `https://x.com/13_narcissus/with_replies` once); the strongest posts you skipped and why (over the hour, crowded, bait), so the timing rule stays visible; whether the run stopped early and on what.

## Failure modes

| Symptom | The actual mistake |
|---|---|
| Harvest returns 3 rows | Wrong tab selected, or For You serving hours-old cards. Check the tab-select return value; switch source, never raise `MAX_AGE` |
| `get_page_text` shows the feed instead of the table | The harvest script threw before replacing the body; run it alone (outside the batch) to read the error |
| `text-mismatch` on every reply | A hand-built URL. Only fire URLs printed by `plan` |
| `not-a-reply` on every reply | X changed the intent route or the overlay markup; stop, screenshot once, report. Do not switch to typing into the feed composer at this volume |
| Wave 3 replies all land at 40+ min | The cook step took too long, or the wave was over 15. Smaller waves, less deliberation |
| The whole wave sounds the same | Fifteen replies from one sitting. Rewrite openers and stances before gating, not after |
| Two runs inside an afternoon | The ceiling is two a day, hours apart. Volume is the signature X polices |
