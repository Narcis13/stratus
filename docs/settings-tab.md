# Settings Tab

The **Settings** tab is where you connect the stratus extension to your stratus server and control a few privacy and behavior switches. This is the first tab you have to deal with: until you enter the API URL and bearer token here, every other tab is locked and the extension keeps you on Settings. Once those two fields are filled in and saved, the rest of the app unlocks and stays connected — you rarely need to come back unless you change servers, rotate your token, or want to flip a toggle.

### Four subtabs: General · Tuning · AI · Prompts

Settings is split into four subtabs across the top:

- **General** — the connection fields, the behavior/privacy toggles, the reply humanizer, appearance, your niche, daily commitments, and harvest cursors. This is the default subtab.
- **Tuning** — every tunable number the server has, in one searchable list: doctrine, quests, people, follow-ups, the reply band, stat gates, budgets, workers and more. See [Tuning](#tuning-the-tuning-subtab).
- **AI** — which LLM provider drafts your content (Grok or OpenRouter), and the model/temperature/token/effort knobs. See [AI provider](#ai-provider-the-ai-subtab).
- **Prompts** — the editable text of every AI prompt behind the app, with a one-click "Restore Default Prompts". See [Prompts editor](#prompts-editor-the-prompts-subtab).

Tuning, AI and Prompts are the "power user" half — you can ignore them entirely and everything runs on the shipped defaults (Grok, stock prompts, the doctrine numbers stratus was built with). They're there for when you want to run a different model, tune how the AI writes, or move a threshold.

---

## First-time setup (do this first)

You need two things before the extension can do anything: the **address of your stratus server** and the **bearer token** (a password-like secret) that server expects. If you don't have these yet, see [Connection settings](#connection-settings) below for where they come from.

Step by step:

1. **Open the side panel.** Click the stratus extension icon in Chrome's toolbar to open the side panel. On first launch it opens on the **Settings** tab automatically (all other tabs are greyed out and unclickable).
2. **Find the two fields at the top:** **API URL** and **Bearer token**.
3. **Enter the API URL.** Type the full address of your stratus service into the **API URL** field, for example `http://127.0.0.1:8787` for a server running on your own machine, or the `https://…` address of your hosted instance. Include the `http://` or `https://` prefix. You don't need to add a trailing slash — the extension trims one automatically.
4. **Enter the bearer token.** Paste your secret into the **Bearer token** field. It's masked (shown as dots) like a password. This value must exactly match the `API_TOKEN` setting on your stratus server — the note right under the heading reminds you: *"Bearer token must match the server's `API_TOKEN` env var."*
5. **Click Save.** The **Save** button stays disabled until both fields have something in them. When you click it, the button briefly reads **Saving…**, then a green **Saved** appears next to it.
6. **The other tabs unlock.** As soon as both fields are saved and non-empty, every other tab (Today, People, Calendar, Composer, and so on) becomes clickable. You're connected.

> **Tip:** The four toggle switches lower down (pillars, auto-fill, passive capture, passive harvest) save **the instant you click them** — they don't wait for the Save button. So do the Appearance dropdowns. The **Save** button exists only to commit the API URL and bearer token together.

---

## Connection settings

These are the two fields at the top of the tab. Together they're what "being configured" means.

### API URL

- **What it is:** the web address of *your* stratus service — the small server that does the actual work (scheduling posts, reading metrics, drafting with AI, storing your people and voice library). The extension is just a front end; this URL tells it where to send every request.
- **Where to get it:** it depends on how you run stratus.
  - If you run stratus **on your own computer**, it's a local address like `http://127.0.0.1:8787` (use `127.0.0.1`, not `localhost`).
  - If you run stratus on a **hosted server** (for example a small cloud box), it's the public `https://…` address of that box. The project ships with a default hosted instance; if you're using that, its address is the one to paste here.
- **How it's stored:** saved locally inside the extension (in Chrome's extension storage). A trailing `/` is stripped automatically, so `https://example.com/` and `https://example.com` behave the same.

### Bearer token

- **What it is:** a **shared secret** — think of it as the password that proves you're allowed to talk to your stratus server. "Bearer token" is just the technical name for a secret that's sent along with each request to authorize it.
- **Where to get it:** it's the value of the `API_TOKEN` environment variable configured on your stratus server. Whoever set up the server (that's you, since stratus is a one-person tool) chose this value. Copy the exact same string here.
- **How it's stored and used:** it's kept locally in the extension, shown as a masked password field. On **every single request** the extension makes to your server, this token is attached as an `Authorization` header (behind the scenes, all traffic is funneled through the extension's background worker, which is the one place that reads the token and stamps it onto each call). If the token is wrong or missing, the server rejects the request.

### Troubleshooting a 401 (or "everything is failing")

A **401** response means "not authorized" — the server got your request but didn't accept the token. If tabs are unlocked but data won't load or actions fail:

- Double-check the **Bearer token** matches the server's `API_TOKEN` exactly — no extra spaces, no missing characters. (The extension trims leading/trailing spaces for you, but a token that's simply *wrong* will still fail.)
- Make sure the **API URL** points at the right server and that the server is actually running and reachable.
- Remember: filling in the two fields only *unlocks* the tabs — it does **not** verify the token is correct. The extension considers you "configured" the moment both fields are non-empty. A wrong token still unlocks the UI but makes every request fail. If the app unlocked but nothing works, the token or URL is the first thing to check.
- Re-enter the token and click **Save** again after any change.

---

## Behavior & privacy toggles

Four checkboxes sit between the connection fields and the harvest section. Each one saves immediately when you click it.

### Apply content pillars to reply drafting (default off)

- **What it does:** your stratus setup has "content pillars" — the handful of themes you want to be known for. When this is **on**, the AI reply drafter is nudged to steer replies toward those pillars. When **off** (the default), replies are drafted purely from the tweet you're responding to, with no pillar steering.
- **When to turn it on:** if you want your replies to consistently reinforce your core topics. Leave it off if you'd rather each reply just react naturally to whatever it's answering.
- **Note:** the content pillars themselves are owned and edited under the **Niche** card (below) — they belong to your active niche, not to a global list.

### Auto-fill Reply Master drafts into the reply box (default off)

- **What it does:** when the AI drafts a reply for you, this controls how the draft reaches the X reply box. **Off** (the default) copies the draft to your clipboard so you paste it yourself. **On** also drops it straight into the focused reply box on X, in one operation.
- **When to turn it on:** if you'd rather skip the paste step. Leave it off if you prefer to review-and-paste.
- **The draft is always on your clipboard either way.** X's composer occasionally refuses a programmatic fill (it re-renders from its own internal model). When that happens stratus leaves the reply box **empty** rather than half-filled and tells you to press ⌘V — never a mangled composer you have to clean out by hand.

### Passive contact capture from hover cards (default on)

- **What it does:** as you browse X normally and hover over someone's name or avatar, X shows a little profile pop-up ("hover card"). With this **on** (the default), the extension quietly reads those hover cards you naturally triggered and adds those people to your stratus roster (the "People" tab), building your contact list from ordinary browsing — no clicking "save" required.
- **What data it captures:** only what's already on the hover card X drew because *you* hovered — handle, display name, basic profile info. It does **not** synthesize hovers, crawl, or read anything you didn't naturally bring up on screen. New people are added gently (a hover glimpse never overwrites richer data you've already saved).
- **Why it's on by default:** it grows your relationship roster for free from browsing you were already doing. It's the effortless way the People layer fills itself in.
- **It also captures your audience heatmap.** This same toggle governs one more passive read: whenever you happen to visit **X Analytics → Audience** (`x.com/i/account_analytics`), the extension reads the *active-times heatmap* X draws there — the grid of when your audience is on X — and stores it ($0, from what's already on screen). That heatmap is what powers the **audience** best-time hints in the [Composer](./composer-tab.md) and the "aud" ghost slots on the [Calendar week board](./calendar-tab.md). Capture is entirely passive: stratus never opens Analytics on its own, and a fresh grid is only sent when it has meaningfully changed (and at most twice a day). With this toggle **off**, no heatmap is captured and the audience hints go stale (the Composer nudges you to revisit).
- **How to opt out:** simply **uncheck** this box. It saves immediately, and the extension stops capturing people from hover cards — and audience heatmaps — from that point on. This is the one place to turn passive contact capture off.

### Passive timeline harvest while browsing /home (default on, $0)

- **What it does:** while you scroll **x.com/home**, the extension records each tweet the algorithm showed you — its text and its on-screen engagement numbers — into your own stratus database. Nothing is sent to X, nothing is fetched from X's paid API: it reads the numbers already drawn on your screen, so it costs **$0** no matter how much you scroll. It's the automatic sibling of the [Harvest tab](./harvest-tab.md)'s manual bulk scrape.
- **What data it captures:** the tweet, its author's handle, its like/reply/repost/bookmark/view counts, and when you saw it — for **every** readable tweet on the home timeline, including ones you'd never reply to (those are the denominator the analytics need). Ads and promoted rows carry no readable counters and are skipped. **No one is added to your People roster from this** — being shown a tweet isn't a relationship.
- **Where it stops:** home timeline only (not profiles, search, or tweet pages); nothing while a Harvest-tab run is going in that tab; at most one row per tweet per 30 minutes; a ceiling of **2,000 rows a day**; and everything older than **60 days** is deleted automatically.
- **Why it's on by default:** it's free, invisible, and it's what powers **People → Timeline affinity** ("who does the algorithm keep showing me?") and **Playbook → Timeline funnel** ("of what I was shown, what did I actually reply to?"). Neither says anything useful until a few days of real scrolling have accumulated.
- **How to opt out:** **uncheck** this box. It takes effect immediately in every open X tab — no reload needed — and the Harvest tab's status line switches to *"Passive capture off"*.
- **Note:** this is a **separate** toggle from *Passive contact capture from hover cards* above. One grows your people roster from profile pop-ups you hover; this one grows the tweet corpus from your timeline. Turning either off leaves the other running.

---

## Reply humanizer

A card below the toggles that owns one server-side config: the small, deliberate imperfections stratus can add to an AI-drafted reply **at the moment you pick it** — a leading `honestly,`, a lowercased first letter, a dropped final period, a trailing `well said`, or a rare one-key typo. It's what stops a run of drafted replies from reading like a form letter.

**Where it applies:** [Radar](./radar-tab.md) picks, and only when that tab's **Humanize picks** checkbox is on. The checkbox at the top of this card is *the same switch* — flip it here or there, it's one setting either way, and it's **off** until you turn it on. Each canned [reply list](./replies-tab.md) still keeps its own separate humanizer; this card doesn't touch those.

**What you can edit:**

- **Prefixes** and **Suffixes** — one entry per line, never comma-separated (a shipped default is literally `honestly,`). Empty a pool and that roll can never fire again. At most 25 lines, 60 characters each.
- **Five chances**, each a number from **0** (never) to **1** (always): prefix, suffix, lowercase start, drop final period, typo. A value outside that range gets a message under the field instead of a silent failure, and **Save** stays off until you fix it.
- A line underneath tells you roughly **what share of picks come out changed** at the numbers currently on screen, so you can dial the whole thing by feel rather than by arithmetic.

**Save is only enabled when something actually differs from what's stored** — an untouched form can't be re-saved, and typing in one field while a background reload happens won't wipe what you typed. **Reset to defaults** asks first, then deletes the stored row entirely: the engine defaults come back and the Radar's humanizing turns off with them.

**The jitter is decided when you click, never written into a draft.** The stored variants on a Radar row stay exactly as the AI wrote them; what changes is the text that lands on your clipboard. The Radar's Clicked list therefore shows the verbatim variant, while the jittered text — what you actually pasted — is what the [Replies](./replies-tab.md) history records.

Everything on this card is **$0**: it's one row in your own database, no X call and no AI call.

---

## Appearance

Three dropdowns controlling how the side panel *looks*. They're panel-only — nothing here reaches the server, nothing here changes what stratus does — and each applies the instant you change it, with no Save.

- **Theme** — **System** (default, follows your OS light/dark setting), **Dark**, or **Light**. The overlays stratus draws *on X itself* (badges, chips, the context panel) are deliberately exempt: they follow X's own page theme so they never clash with the site.
- **Density** — **Cozy** (default) or **Compact**. Compact tightens the spacing throughout, fitting noticeably more on screen in a narrow side panel.
- **Text size** — **Small (12px)**, **Default (13px)**, or **Large (14px)**. Scales the whole panel, not just body copy.

These three are stored locally in the extension, like the connection fields — they're per-browser, not per-account, so they don't follow you to another machine.

---

## Tuning (the Tuning subtab)

**Tuning** is every number stratus makes a decision with, in one place. Doctrine cadence, quest targets, follow-up windows, the sweep filters, stat gates, budgets, worker schedules, display limits — all of it, live-editable, with the bounds and the reasoning attached to each row. (One group is deliberately absent — see *[The reply band left this tab](#the-reply-band-left-this-tab)*.)

The list is rendered entirely from what the server reports, so a knob added in a stratus update simply appears here — no extension update needed.

### The sixteen groups

The registry holds **79 knobs in 17 groups**; this tab renders **67 of them in 16 groups**. The missing one is **Reply band** — since 2026-08-10 those twelve classifier thresholds are not editable from the panel at all (see *[The reply band left this tab](#the-reply-band-left-this-tab)* below). This is the map of what's here — what each group decides, and where you see it change.

| Group | Knobs | What it decides | Where the change shows |
|---|---|---|---|
| **Identity** | 1 | **My X handle** (without the @) — the one thing the server can't work out for itself, since it only ever sees your numeric account id. | Own-activity reads. Leave it blank and they answer empty rather than guessing at someone else's rows. |
| **Doctrine** | 3 | The cadence ladder: the 3/day and 4/day anchor hours, and how many filled slots switches you from one to the other. | Today's gaps, the Composer's slot suggestions, the Calendar's ghost anchors. |
| **Quests** | 4 | The daily bar: originals target, how many neglected targets count, the neglect window, the launch-room attendance window. | Today's quest checklist and the streak. |
| **People** | 3 | The CRM stage ladder's promotion windows (mutual, ally, ally window). | Stages on People, and every stage-aware draft. |
| **Follow-ups** | 8 | The follow-up queue's windows: chain freshness, DM readiness, neglected target/ally days, momentum %, re-up age range, unacknowledged-fan days. | Do next, Targets, Top fans, the dossier queue. |
| **Pinned watch** | 2 | When a pinned post reads as stale, and the ratio that says something outperforms it. | Today's pinned-watch card. |
| **Digest** | 1 | How many neglected people the Sunday digest names. | The weekly digest. |
| **Stat gates** | 2 | How much data a Playbook cell and a best-time cell need before they read as evidence. | The Playbook's `insufficient data (n=…/N)` cells; the best-time advice. |
| **Radar** | 2 | How long a radar draft stays clickable, and how many tweets a curated drafting pass keeps (the effective size is the lower of this and the batch reply cap). | The **[Radar](./radar-tab.md)** tab's queue. |
| **Sweep** | 11 | **What an armed sweep is allowed to put into the Radar queue**: min/max impressions, min/max likes, min/max replies, a max tweet age, a verified-authors-only switch, two bypass switches (camped cannon accounts — **on**; circle accounts — **off**), and how long one sweep runs before it auto-stops (30 min). All eleven are **mirrored** — the page is what enforces them. | The **[Radar](./radar-tab.md#filling-the-queue)** tab's queue, while a sweep is armed. The same eleven rows are editable from the ⚙ next to **Start sweep** without leaving the Radar. |
| **Cannon** | 4 | The arbitrage lane: the **views-per-reply floor** a row must clear to surface, the **age cutoff** past which a row leaves the Cannon view, the age past which the displayed age turns **red**, and the Cannon head's own **placed-today stretch** number. All four are **mirrored**. **All four are display rules now** — since 2026-08-10 the Sweep group owns capture, and the camped-roster capture arm takes its age bound from **Max tweet age** there. | The **[Radar → Cannon](./radar-tab.md#the-cannon--reply-where-a-reply-gets-read)** view and its roster block. |
| **Workers** | 5 | The daily-metrics hour, the publisher tick, the winner re-read floor/cap, and **Discovery skips replies**. | Background only. The first two are `restart` knobs. **Discovery skips replies** is a money lever, default ON: it stops the daily pull paying $0.001 per manual reply (~$0.10/pass at Cannon volume) for numbers the $0 harvest measures better. Turning it OFF restores the paid path — but replies typed while it was on stay below the discovery checkpoint and only come back via `POST /posts/reconcile {fullScan:true, excludeReplies:false}`. |
| **Budgets** | 2 | The soft X daily watchdog and the **hard** image-generation cap. | A refused image generation; the cost log's warnings. |
| **AI calls** | 6 | Per-surface LLM defaults: reply/drafter/digest token caps, reply temperature and effort, the batch-reply ceiling. | Every AI draft — unless **Settings → AI** overrides them globally. |
| **Mentions** | 3 | How often the mention inbox may refresh from the server and from the panel, and how many mentions one pull may read. | The Replies inbox. This group is a **cost** control. |
| **Display** | 10 | List sizes: sparkline days, leaderboard rows, Do-next cap and snooze, Top-fans amber count, radar draft cap, dossier rows, channel posts, Voice and Replies list lengths. | The lists themselves — nothing here changes a decision. |

Forty-four of the 79 are also **mirrored** to the extension (Identity, all of Doctrine, the hidden Reply band, **Sweep** and Cannon, most of Display), which is what lets the side panel and the injected on-page UI show the same numbers the server decides with. The rest are server-only, because the panel already receives their effect rather than the number. The Sweep group is the one whose mirroring is not a convenience but the mechanism: no server route reads those eleven numbers at all — the content script does, off the mirrored blob.

### How a row works

Each row shows the knob's **name**, a one-line **description** carrying the *why* (and the warning, where there is one), and a control picked to fit: a **number box** for any number, a checkbox, a dropdown, or a comma-separated list for things like the posting-hour anchors.

- **Numbers are typed, not dragged.** Every number knob is a box you type an exact value into — sliders were dropped on 2026-08-10 because a filter whose ceiling is 1,000,000 impressions can't be aimed on a 110px track. **A number saves when you leave the box or press Enter**, not per keystroke (otherwise typing `500` into a knob with a floor of `100` would fight you at the first digit). A value outside the knob's floor/ceiling is snapped to the nearest one; a blank or non-numeric box reverts to what's stored.
- **Saving is automatic.** Commit a box (or click a checkbox) and it saves about a third of a second later — there is no Save button. Switching subtabs, or clicking outside an inline ⚙ popover, saves what you typed rather than dropping it.
- **A small accent dot** appears to the left of any knob you've changed from its shipped default. **Click the dot** to put that one knob back.
- **Out-of-range values are refused by the server**, not by the box. If you type something the knob's floor or ceiling forbids, the row shows the refusal code and snaps back to the value that's actually stored. Those floors and ceilings are the real guard — they're the reason a budget knob can't be talked into an unbounded number, here or by an AI agent through the MCP tools.
- **A `restart` tag** on a row means that knob is read once when the server boots (it arms a timer), so a change lands on the next restart. Only the worker schedule knobs are like this; **everything else applies to the very next request** — no restart, no rebuild.

### Search

The box at the top filters as you type, across every group at once. It matches a knob's **name**, its **description**, or its **raw key** — and if what you type matches a **group name**, the whole group stays, so searching `budget` gives you every budget knob rather than only the ones that repeat the word. The count line under the box tells you how many of the total matched.

### Per-group reset

Every group header has a **Reset group** button, which drops every override in that group back to the shipped defaults at once.

It only ever moves knobs you can actually see. **With a search query active**, the card is showing a subset of its group, so the button relabels to **Reset these N** and drops only the rows on screen — a reset that quietly moved nine knobs you'd filtered out would be the opposite of an undo. Clear the search and it goes back to being a whole-group reset.

It's **greyed out when nothing in view is overridden**, the same way a gear's footer is, so the button doubles as an answer to "have I changed anything in here?"

### The same knobs, next to the feature (inline ⚙)

Tuning is the complete list, but you rarely arrive here wondering about "the display group" — you arrive wondering why the Do-next strip only shows five rows. So the knobs that shape a section also appear behind a small **⚙** on that section's own header. The **[Today tab](./today-tab.md#tuning-today-from-today-the--gears)** has four of them (quests, Do next, Targets, Top fans) and the **[Radar tab](./radar-tab.md)** carries the fifth (its two batch caps plus the curated size — how many tweets survive a *Curate & draft* pass) **and a second one of its own**, next to **Start sweep**, over the eleven Sweep filters — two gears in one section, because "how much do I spend per click" and "what is allowed into the queue" are different questions; the **[Composer](./composer-tab.md)** (Schedule) and the **[Calendar](./calendar-tab.md)** (This week) share a sixth — the cadence ladder plus the best-time gate, one gear on both tabs because both render the same anchor hours. Four more size the lists you read most: the **[People](./people-tab.md#-dossier-list-rows)** dossier header (how many rows its capped lists show), the **[Channels](./channels-tab.md)** room's *My posts* section, the **[Voice](./voice-tab.md)** library's *Saved tweets* section, and the **[Replies](./replies-tab.md#the-history-list)** tab's *History* section. And one changes what a whole page is willing to *say*: the **[Playbook](./playbook-tab.md)** header's gear moves the per-cell sample gate (`x.gates.minCellN`), which re-gates every stat on that page and decides whether the measured guidance lines are allowed to steer your AI drafts — the one gear worth reading the warning on before you touch it.

Every gear card also ends in a **Reset to defaults** button, which drops every override *on that card* — the knobs you can see, never a whole registry group — back to the shipped numbers in one request. It greys out when nothing on the card is overridden, so it always tells you whether you've changed anything here.

There is no second store and no second copy: a gear edits the same key with the same discipline (auto-save, the same accent dot, the same server-side refusal), so a number changed in a gear reads back identically here. A gear simply doesn't render when the server is unreachable — the section keeps working off its mirrored copy.

### Where some numbers *aren't*

A few numbers you might expect in Tuning deliberately live somewhere else, because each setting has exactly one owner:

- **Your reply quota, week reply %, and the 2–10× target-follower window** belong to your **active niche** — edit them under **General → Niche**. Tuning says so at the top of the affected groups.
- **The Cannon group is not a second reply band.** The band classifier decides *hot / warm / skip*; the Cannon floor decides *is there an open slot under this post*. They read the same signals and answer different questions, and neither overrides the other — a `skip`-banded post can be a perfectly good cannon shot. The shipped floor (**120**) is the measured p90 of your own harvest corpus, not a number borrowed from someone else's account; recalibrate it from a replay of that corpus, never by feel.
- **The Sweep group is the only thing that decides your queue.** Since 2026-08-10 the Radar is manual by default and the eleven Sweep filters are the only rule an armed sweep admits by. Every Sweep default is an **opening guess**; recalibrate at 100+ swept rows from the SQL in the **[Radar doc](./radar-tab.md#tips-and-good-to-know)**, never by feel.
- **The 2–10× target-follower window has nothing to do with the cannon roster.** They're separate lists chosen on separate criteria — relationship versus reach — and widening the 2–10× band does not add anyone to the cannon.
- **AI calls is the lower of two tiers.** Those knobs are the per-surface defaults; whatever you set in **Settings → AI** is a *global* override that wins over them. The blank fields in the AI subtab are what fall back to this group. The AI subtab links straight here.

> A caution worth repeating from the descriptions themselves: the Sweep filters and the stat gates ship as **opening guesses**. They're worth recalibrating from measurements — not from a hunch — and the descriptions tell you how much data each one wants first.

### The reply band left this tab

Until 2026-08-10 a **Reply band** group sat here: twelve classifier thresholds (view floors, reply ceilings, freshness, views-per-minute, the too-small floors). It's gone from the panel, on purpose.

- **Why.** After the Radar went manual-first, those twelve stopped deciding what enters the queue — the eleven **Sweep** filters do. Two look-alike sets of numbers a tab apart, only one of which does the job you're trying to do, is a trap. There is now exactly **one** place to set what a tweet must clear: the **⚙ next to Start sweep** on the Radar (the same eleven knobs also appear as the **Sweep** group above).
- **What still happens.** The band classifier itself is untouched. It still draws the hot/warm/skip border stratus paints on a tweet as you scroll, and it still gates a single Reply Master draft — server and page reading the identical numbers, so the border can never promise a draft the server then refuses. It runs on whatever those twelve are set to today; nothing changed values.
- **If you ever need to move one.** They're still real settings (`x.band.*`) — reachable over the API (`PATCH /x/settings`) or through the MCP `x_update_setting` tool, just not from a control in the panel. That's deliberate: they're a calibration surface that wants **≥100 measured replies** behind a change, not a knob for a Tuesday.

### Coming soon

At the bottom sits the **roadmap**: features that are planned and specced but not built, each with the knobs it would add. The rows are inert — dimmed, with no controls at all, because there's nothing on the server to store yet. It's there so you can see where the product is going from inside the product. Entries are removed as they ship.

---

## Your niche (identity & strategy)

The **Niche** card is where "who you are" lives. A niche bundles the four things every AI draft and every coaching number is built from: your **persona** (the biography the post drafter grounds on), your **beliefs** (the principles it argues from), your **reply persona** (the short self-description replies use), a prose **description**, and six **doctrine** knobs. Editing any of these changes the next drafted post and reply **without a deploy** — the same way pillars became editable.

### The active-niche editor

- **Persona / beliefs / reply persona / description:** free-text fields. Save commits them; Reset discards unsaved edits. The next `/x/posts/draft` and `/x/replies/generate` immediately ground on the new text (nothing is cached across an edit).
- **Doctrine (6 numbers):** reply quota **min/max** (default 10–20 a day), the **week reply %** (70/30 doctrine → 70), the **target band** multipliers **min/max** (2–10× your follower count — who the target roster surfaces), and **replies to my people · min** (default 5 — how many of the day's replies should go to accounts you already have a relationship with; see [Your people are exempt](replies-tab.md#your-people-are-exempt)) — which is also the target of Today's *replies to your people* quest. These drive the Today brief's quota and ratio, and the voice **Targets** roster's band. Changing them is instant on the next read.
- **Saving doctrine sends all six numbers.** The server replaces the stored block rather than merging it, so a knob you never touched still travels with the save — that is why the card always shows every field filled in.

### Niches list & activation

- Exactly **one niche is active at a time.** The list shows every niche; **Activate** swaps which one grounds your drafts and doctrine. **Delete** removes an inactive niche (you can't delete the active one).
- **Creating a niche** needs a slug, label, and the persona/beliefs/reply-persona text (the server rejects empty grounding). New niches are created **inactive** — activate when you're ready.
- A niche owns its **pillars and channels.** Activate a fresh niche with no pillars yet and the post drafter will politely refuse (`no_pillars_for_niche`) rather than borrow another niche's pillars — add its pillars first (Voice → Pillars, or the wizard).

### The wizard (prose → a proposed niche)

Paste a paragraph describing a niche ("I post about evidence-based nutrition for busy parents…") and **Generate** turns it into a complete **proposed** niche — persona, beliefs, reply persona, three pillars, and up to five channels — for you to review and edit before saving. It's one AI call (~$0.01), and the proposal is **never saved automatically**: nothing changes until you click Create. Saving runs in the right order (create → activate → its pillars → its channels) so the new niche's pillars/channels attach to it, not to whatever was active before.

---

## Daily commitments

Under the Niche card is a small **Commitments** card: the daily minimums you hold yourself to. Two keys, each a number plus an **active** checkbox and its own **Save** button (they save one at a time — this is a promise, not a preference sheet).

- **replies** — how many replies a day you're committing to.
- **originals** — how many original posts a day.

Range 1–100. Leaving a row **inactive** keeps the number on file without holding you to it.

What a commitment actually does:

- It **raises the quest targets** on the [Today tab](./today-tab.md) — *"17 quality replies"* instead of the doctrine default. It can only ever raise a bar, never lower one, so no streak already earned can be retroactively broken.
- It **accumulates debt** when you miss days: a quiet line under Today's quest list, escalating to amber past three missed days, and past five it suggests lowering the bar rather than pushing harder.
- It **feeds the Sunday grade** — the reply-quota component of the weekly scorecard is measured against your commitment when there is one.

What it deliberately does **not** do: it never blocks anything, and it doesn't touch the doctrine's own 10–20/day reply band shown in Today's **Replies quota** section. Those are different numbers answering different questions — one is sustainable practice, the other is a personal promise.

Two behaviours worth knowing: editing the target **never** erases days you already missed (raising the bar isn't a fresh start), but switching a commitment from inactive back to active **does** restart the clock. And a commitment made today reads zero debt, because today can't be a missed day yet.

If the card loads blank, the fields stay empty rather than inventing a target — save and the real error will surface.

---

## AI provider (the AI subtab)

The **AI** subtab controls which large language model drafts your posts, replies, threads, ideas, and everything else the app generates. By default everything runs on **Grok** (xAI). If you'd rather draft on Claude, GPT, Gemini, or any other model, you switch the provider to **OpenRouter** here and pick a model.

- **Provider (Grok / OpenRouter):** a radio choice. **Grok** is the default and needs the server's `XAI_API_KEY`. **OpenRouter** is a gateway to hundreds of models (Claude, GPT, Gemini, Llama, …) and needs the server's `OPENROUTER_API_KEY`. If that key isn't set on the server, the OpenRouter option is greyed out with a hint — set the key in the server's environment first. (Keys live **only** in the server's environment, never in the extension or the database — that's a deliberate security rule.)
- **OpenRouter model:** a text box with autocomplete. It suggests models from OpenRouter's live catalogue (id, friendly name, and per-token price), so you can see roughly what each costs before choosing. The default is `anthropic/claude-sonnet-4.5`. Any valid OpenRouter model id works, whether or not it's in the suggestion list.
- **Temperature / Max output tokens / Reasoning effort:** optional knobs. Leave them **blank** and each draft surface uses its own sensible default (the "house" setting for that kind of draft). Fill one in and it overrides the house default for **every** surface. Temperature is 0–2 (higher = more varied); max output tokens caps the reply length; reasoning effort (none/low/medium/high) applies to models that support it.
- **Save:** commits the provider config to the server.

**Precedence, plainly:** a value typed into a specific draft (a per-request override, where the app exposes one) beats these AI-subtab settings, which in turn beat each surface's built-in default. So this subtab is the middle tier — a global preference you can still override case by case.

**Where the spend shows up:** OpenRouter charges by the token and the exact cost of each call is read back from OpenRouter and logged under platform **`openrouter`** in your cost dashboard (`/cost/today`) — separate from Grok text spend (`grok`) and image spend (`xai`). There's a soft daily budget (`OPENROUTER_DAILY_BUDGET_USD`, default $1.00) that logs a warning once crossed; it doesn't block calls.

**The Grok path is untouched.** Switching the model here only affects the OpenRouter path — Grok always drafts on `grok-4.3`. If you never touch this subtab, nothing about your drafting changes.

---

## Prompts editor (the Prompts subtab)

Every AI feature in stratus is driven by a **prompt** — the instructions the model reads before it writes. The **Prompts** subtab lets you read and edit all **16** of them, and revert to the shipped defaults whenever you want.

The 16 prompts are: **reply drafts**, **reply drafts (batch)**, **post drafts**, **thread drafts**, **rewrite assist**, **idea generator**, **template extraction**, **pillar drafting**, **Sunday digest**, **icebreakers**, **reply-list items** (the generator that fills a canned-reply list from a category prompt), **DM drafts** (the direct-message drafter grounded strictly on real shared context), **article assist** (the long-form Writer prompt behind the outline / section / polish / full drafting on the `/writer` page), **draft judge** (the 13-dimension rubric that grades one draft and hands back quoted fixes), **judge rewrite** (the annotation-driven rewrite behind **Apply all fixes** — it applies every span the judge quoted, and the result is kept only if a re-judge scores it higher), and **reply curation** (the queue scorer described just below). Each row shows its name, a one-line description, and an amber **"customized"** chip if you've edited it.

**What the reply-curation prompt decides:** it is the only prompt that *removes* things rather than writing them. It reads the fresh Radar queue and grades every tweet 0–100 for reply payoff — how likely one sharp reply under it is to earn you impressions and profile visits — and it flags filler (connection invites, follow trains, giveaways, engagement bait, announcements with nothing to add) as **low value**. A low-value flag dismisses that tweet from your queue outright, whatever its score, so the category list in that prompt is worth reading before you edit it: widen it and you throw more of the queue away. Everything the model *doesn't* answer for is left in the queue untouched — a truncated answer costs you coverage, never rows. The score itself is only ever used to rank; nothing is blocked or drafted differently because of it.

**One thing the judge prompt does not let you change:** the verdict. The rubric asks the model for thirteen 0–100 scores and nothing else — the "post it / slight rework / major rework / do not post" label is worked out from the `overall` score on stratus's side, so an edited prompt that asks the model to hand back its own verdict is simply ignored. The label and the number can never disagree. Same for the score range: an out-of-range or missing dimension makes stratus reject the whole answer rather than show you a partial one.

- **Editing a prompt:** click a row to open the editor — a big monospace text box with the full prompt, a character count, and a set of **required-placeholder chips**. Placeholders look like `{{TWEET_CONTEXT}}` or `{{IDEA}}`; they're where the app injects the actual tweet, your pillars, your winners, and so on at draft time. A chip is **green** when its placeholder is still present in your text and **red** when it's missing. You can't save while any required placeholder is missing (Save greys out, and the server refuses it too) — a prompt that dropped `{{IDEA}}` would silently ignore your idea, so the editor won't let that happen. You can freely edit all the surrounding prose.
- **Save / Reset this prompt:** Save stores your version as an override on the server; the next draft of that kind uses it immediately. "Reset this prompt" deletes just that one override, reverting it to the shipped default.
- **Show default:** lets you compare your edit against the original text.
- **Restore Default Prompts:** the big button (with a confirm dialog) that deletes **every** override at once — all 16 prompts snap back to their shipped defaults and the "customized" chips disappear. This is the recovery button if an edit made your drafts worse.

**How overrides work under the hood:** a prompt you never edit has *no* stored row — it just uses the code default, which means an improved default shipped in a later stratus update applies automatically. The moment you save an edit, a row is stored and "customized" turns on; reset/restore delete that row. So "customized" is a real fact (a row exists), not a guess.

**A caution:** editing prompts is genuinely powerful and genuinely able to make output worse — that's the point, it's yours to tune. The customized chip and Restore button are your safety net. There's no version history beyond that: defaults live in the app's source, and your only stored state is the current override.

---

## Harvest cursors

Below the toggles is a **Harvest cursors** section — a list that starts empty and fills in as you use the Harvest feature.

- **What a harvest cursor is:** when you run a "since last" harvest of a particular person's timeline, stratus remembers the timestamp of the newest tweet it saw for that handle. The next "since last" harvest of the same person then **skips everything at or before that time** and only grabs what's new. That saved timestamp is the "cursor." There's one per handle-and-mode combination.
- **How the list reads:** each row shows the handle and mode as **`@handle · mode`**, the date/time the cursor is parked at, and a **Reset** button. If no cursors exist yet, you'll see *"No cursors yet — they appear after a completed since-last harvest."*
- **When to Reset one:** if a "since last" harvest seems to be **skipping tweets you expected to get**, its cursor is probably parked too far forward. Click **Reset** on that row to clear the cursor. The next "since last" run for that handle will then scrape the whole timeline again from the start instead of skipping. Resetting only affects future harvests — it doesn't delete anything you've already harvested.

This section exists specifically to make the "silent skip" problem visible and fixable: without it, a cursor stuck in the wrong place would quietly cause harvests to miss tweets with no explanation.

---

## Mention-refresh budget

The mention-refresh budget is **not** a control on this Settings tab — there's nothing to configure for it here. It's worth knowing about, though, because it's a built-in safety limit:

- Refreshing your **mention inbox** (pulling in new @-mentions) costs a tiny amount of money each time, so the extension caps how often you can do it. The **Refresh** button lives in the conversations/inbox area (the Today tab), not in Settings.
- There's a client-side limit of **4 refreshes per rolling 24 hours** enforced by the extension, plus a server-side backstop of **6 per day**. When you hit the limit, the Refresh button won't pull again until the window frees up.
- There's nothing to adjust — the cap is fixed. This note is just so you know why a refresh might be temporarily unavailable.

---

## Common workflows

### Connect for the first time
1. Open the side panel (it lands on **Settings**).
2. Type your server address into **API URL** (e.g. `http://127.0.0.1:8787` or your hosted `https://…` address).
3. Paste your secret into **Bearer token** (it must match the server's `API_TOKEN`).
4. Click **Save** and wait for the green **Saved**.
5. All the other tabs unlock — you're ready to use stratus.

### Opt out of passive capture
1. Go to the **Settings** tab.
2. **Uncheck** *"Passive contact capture from hover cards (default on)"* to stop adding people from hover cards.
3. **Uncheck** *"Passive timeline harvest while browsing /home (default on, $0)"* to stop recording the tweets your home timeline shows you.
4. That's it — both save the moment you click, and they're independent: turning one off leaves the other running.

### Reset a harvest cursor that's skipping tweets
1. Go to the **Settings** tab and scroll to **Harvest cursors**.
2. Find the row for the handle (and mode) that's skipping tweets, shown as `@handle · mode`.
3. Click **Reset** on that row.
4. Run the "since last" harvest again — it will now scrape that timeline in full instead of skipping.

---

## States & troubleshooting

- **Not configured (tabs locked):** if the **API URL** or **Bearer token** is empty, every tab except **Settings** is disabled and greyed out, and trying to view another tab shows *"Configure API URL and bearer token first."* Fill in both fields and click **Save** to unlock everything. This is the expected first-run state, not an error.
- **Save button won't click:** the **Save** button is intentionally disabled until **both** the API URL and Bearer token fields contain text. Make sure neither is blank.
- **Tabs unlocked but nothing loads / requests fail (401 or errors):** the extension only checks that the two fields are *non-empty* — it doesn't verify they're correct. A wrong token or wrong URL unlocks the UI but every request fails. Re-check the token against the server's `API_TOKEN`, confirm the URL is right and the server is running, then **Save** again. See [Troubleshooting a 401](#troubleshooting-a-401-or-everything-is-failing).
- **A toggle didn't seem to stick:** the four toggles save on click, independently of the Save button. If one looks unchanged, click it again — the checkbox reflects the stored state.

---

## Tips & good to know

- **The bearer token is a shared secret — treat it like a password.** Anyone with your token and server address can act as you against your stratus server. Don't paste it anywhere public.
- **stratus is single-user by design.** One person, one server, one token. The same token is used by both this extension and any other tool (like the command-line scripts) that talks to your server. There are no accounts or logins beyond this single shared token.
- **Settings live locally in the extension.** Your URL, token, and toggle choices are stored in Chrome's extension storage and shared across all parts of the extension (side panel, background worker, content scripts). They survive closing the panel and restarting Chrome.
- **Toggles apply immediately; connection fields need Save.** Remember the split: checkboxes take effect on click, but the API URL and Bearer token are only committed when you press **Save**.
- **Changing servers or rotating your token?** Come back here, update the field(s), and click **Save**. Everything reconnects with the new values.
