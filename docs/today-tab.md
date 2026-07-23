# Today Tab

The **Today** tab is stratus's home screen — the "what do I do right now?" dashboard. It opens by default when you open the side panel, and it stacks everything that needs your attention into one scrollable view: a live post you just published, the replies you owe, hot tweets worth jumping on, people who noticed you, your follower trend, your daily to-do list, and a running tally of what you've spent. You don't have to click into other tabs to know what today looks like — Today answers that on its own.

Nothing on this tab posts, replies, or DMs for you. Every action that touches X ends with you copying text and pasting it into X yourself (or opening a tweet in a new tab). stratus drafts, ranks, and reminds; you stay the one who actually speaks.

---

## What it's for and where it fits

stratus is a personal growth-and-CRM tool for X (Twitter). It schedules your posts, tracks how they perform, keeps a swipe file of other people's tweets you admire, and — most importantly — remembers the people behind the handles (who replied to you, who you owe, who's worth building a relationship with).

The other tabs are where you *do* focused work:

- **Composer / Calendar** — write and schedule posts.
- **Voice** — save other people's tweets for style reference; manage your content "pillars."
- **People** — the CRM: one page ("dossier") per person you've ever interacted with.
- **Playbook** — what's actually working, measured.
- **Channels** — topic rooms.

**Today is the glue.** It pulls the most urgent, time-sensitive slices out of all of those and puts them on one screen, ranked by what matters most right now. Almost every person's handle on the Today tab is a clickable link that jumps you straight to their dossier in the People tab.

A few pieces of vocabulary used throughout this tab (explained again in context below):

| Term | Meaning |
|---|---|
| **Band** | A verdict the extension computes for each tweet as you scroll X: **hot** ("reply now"), **warm** ("worth watching"), or **skip** ("thread's too deep, you'd be buried"). Based on the tweet's views, reply count, age, how fast it's gaining views, and whether it's "reply-bait." |
| **Profile visits** (a.k.a. profile clicks) | When someone taps your name or avatar from one of your tweets to look at your profile. This is the leading sign of a potential new follower — it's the metric stratus watches most. |
| **Open loop** | A conversation where *the last word is theirs* and you haven't answered — you "owe" a reply. |
| **Chain** | An open loop where the person replied to *one of your replies*. This is the high-value moment (internally called "the 75x moment") — someone re-engaging with you directly. |
| **In-band target** | An account whose follower count is **2–10× your own** — big enough that replying to them matters, small enough that they might reply back. Your roster of these is your "Targets." |
| **The 70/30 doctrine** | The working rule that roughly **70% of your activity should be replies** to other people and **30% original posts**. Today tracks how close you are. |
| **Momentum** | How fast an account is gaining followers (followers per day), estimated from repeated glimpses of their profile. |
| **Streak** | Consecutive days you finished all of your daily "quests." |

---

## Opening it and the Refresh button

The Today tab loads automatically when you open the stratus side panel. It's the default tab.

At the top is the heading **Today** and a **Refresh** button.

**Important nuance about Refresh:** the Refresh button reloads the *Brief* — the batch of numbers stratus computes in one go: your follower KPI, the pinned-post nudge, today's plan and open slots, your reply quota, yesterday's numbers, profile-click leaders, spend, and your daily quests. While it's working the button reads **Loading…** and is disabled.

Refresh does **not** re-fetch every section. Several sections load their own data independently and have their own refresh behavior:

- **Do Next**, **Targets**, and **Top Fans** each load once when the tab opens. To force them to reload, switch to another tab and back.
- **Conversations (Inbox)** has its own **Refresh** button (which also pulls new mentions from X — see below).
- **Radar** and **Launch Room** are live — they update themselves from browser session storage as you browse X, with no button needed.
- **Sunday Digest** loads automatically on Sundays and has its own button the rest of the week.

If loading the Brief fails, a red error line appears just under the header; the rest of the tab still works.

---

## The dashboard, section by section

Sections are described in the order they appear on screen (top to bottom). Many of them **render nothing at all when there's no data** — this is intentional, and each note below says when a section is invisible.

### 1. Launch Room 🚀

**When it appears:** only for **30 minutes** right after one of your scheduled posts actually goes live. Outside that window this section is completely absent. (The extension sets a timer for each scheduled post; when the post's time arrives it verifies with the server that the post really shipped, then opens the room and shows a browser notification: *"«your post…» just went live — open the Launch Room."*)

**Why it exists:** the first 30 minutes after a post lands is the highest-leverage window you get — replying quickly to early commenters is where relationships and reach compound. The Launch Room is a checklist and a workbench for exactly those 30 minutes.

**What's on it:**

- A **🚀 Launch Room** heading with a ticking clock, e.g. `04:12 / 30:00` (time elapsed since the post went live, out of the 30-minute window).
- A **✕** button (top right) to close the room early.
- The **text of the post** that just went live.
- **Open on X — be present** — a link that opens your live tweet in a new tab so you can watch and reply to comments there.
- A short **checklist**: "Reply to every early commenter (in X — paste, human words)" and, if this was a thread where the link lives in the first reply, "Pin your first reply — the link lives there."
- **Early repliers** — a list of people who have already replied to your post. These are captured automatically **while you have the tweet open on X** — as you scroll the replies, stratus streams them into this list. If the list is empty it says *"Keep the tweet open on X — replies you scroll past appear here."*

**What you can do:**

- **Pull from X** button (next to "Early repliers") — makes one paid call to X to fetch repliers you may not have scrolled past yet. It costs roughly **$0.001–$0.005** and is limited to 6 pulls per day across the whole app. The button hints *"(best at 20m)"* if you press it too early — around 20 minutes in is when most early replies have landed. After a successful pull it shows how many new mentions came in and tells you to check the Conversations section below.
- Per replier row:
  - Their **name/handle** is a link to their **dossier** in the People tab.
  - **open** — opens their reply on X in a new tab.
  - **Draft reply** — makes one Grok AI call (roughly **$0.002–$0.004**) to write a reply in your voice, using your original post as context. Once drafted, the button becomes **Copy** — click it to copy the draft to your clipboard, then paste it into X. (The draft is marked "copied" in the background.)
  - **canned ▾** — your premade reply lists (**$0**, no AI): pick a list and stratus chooses an item you haven't used recently, fills in their name/handle, roughs it up slightly so it doesn't read as a macro, and copies it to your clipboard. Ideal for the "thanks for the early read" tier of acknowledgment. Manage the lists in **Replies → Lists** ([docs/replies-tab.md](./replies-tab.md)).

Posting the reply itself always happens by you pasting into X. stratus never auto-replies.

### 2. Today's quests and streak

**When it appears:** whenever the Brief loaded (almost always). Its data comes from the Brief.

This is your gentle daily checklist — designed to encourage, never to guilt. Each quest shows **✓** (done) or **○** (not yet), a label, and progress (e.g. `4/10`, or a short note).

| Quest | What it asks | Notes |
|---|---|---|
| **Quality replies** | Post ~10 replies today | Counts replies you've actually pasted/sent today. |
| **1 original** | Publish 1 non-reply post today | |
| **2 neglected targets** | Reply to 2 in-band targets you've ignored for over a week | Scales down if you have fewer than 2 neglected targets. |
| **1 open loop closed** | Answer 1 owed mention today | Counts as done automatically if your inbox is already clear. |
| **Launch room attended** | Reply to a commenter within 30 min of one of today's posts | Marked "N/A" on days you didn't post. |

**Gentle by design:** a quest with no opportunity today (e.g. you had no post to launch) is counted as done, with a note explaining why. A quiet day never breaks your streak. When every quest is done you'll see *"All done — the rest of the day is yours."*

The heading shows your **streak** — the number of consecutive days you finished everything (e.g. *"· 5-day streak"*), or *"· streak starts today"* the first day. There is no red, no penalty, anywhere in this section.

### 3. Do Next

**When it appears:** loads independently when the tab opens. This is your **follow-up queue** — a short, ranked list (max 5 shown) of the single most useful thing to do for each person or post. It's a queue, not a dashboard: work the top and it shrinks.

Each row has a small colored **kind chip**, the person's **@handle** (a link to their dossier) or *"your post"*, a one-line **reason**, and action buttons.

| Chip | Kind | What it means | What to do |
|---|---|---|---|
| **chain** | Chain live | Someone just replied to one of your replies, and the window is still hot (under 24h). The high-value re-engagement moment. | The **↗** opens their reply on X. Reply back fast. |
| **DM** | DM ready | This person recently warmed up to you (they replied, you two are becoming mutuals) — a good moment to send a direct message. | Use **opener** to draft a DM starter, then send it manually in X. |
| **target** | Neglected target | An in-band target (2–10× your size) you haven't replied to in over a week. | Go reply to something of theirs. |
| **ally** | Neglected ally | Someone you have a real two-way relationship with, gone quiet for 14+ days. | Reach back out. |
| **reup** | Re-up candidate | Not a person — one of *your* older posts (14–60 days old) that did genuinely well and is worth quote-tweeting again. | Use **draft** (see below). |
| **rising** | Momentum | An account that's heating up (gaining followers fast). A heads-up, never a demand — always at the bottom of the queue. | Consider engaging while they're on the rise. |

**Buttons on each row:**

- **↗** (when present) — opens the relevant tweet on X (their reply, or your post to re-up).
- **opener** (person rows) — expands an "icebreaker" box that drafts a reply-style opener and a DM-style opener grounded strictly on your real shared history with that person (an AI call, roughly **$0.005**). Only one opener box is open at a time. You copy and send manually.
- **draft** (re-up rows only) — drafts three quote-tweet "re-up" takes on your old winning post via Grok (roughly **$0.006**). They land as draft rows in your Calendar for you to schedule. After drafting, that candidate drops off the queue.
- **zz** — snoozes this item for 24 hours.

If there's nothing to do, you'll see *"Nothing owed — go hunting."* (with a count of any snoozed items). If there are more than 5 items, a *"+N more in the queue"* note appears at the bottom.

### 4. Conversations (the Inbox)

**When it appears:** loads independently when the tab opens. This is your **mention inbox rendered as threaded conversations** — grouped by conversation, not as a flat list of tweets. The conversations where the last word is theirs (open loops) sort to the top, and **chains** (they replied to your reply) sit at the very top.

The heading reads e.g. **Inbox — 3 owed (1 chain)**: 3 replies you owe, 1 of which is a chain.

**Refresh button:** pulls new mentions from X (about **$0.001 each**). You're limited to **4 refreshes per rolling 24 hours** on your side (the server also caps at 6/day). The button shows how many you have left; when you're out it's disabled with a "back tomorrow" tooltip.

**Each thread row shows:**

- A **blue dot** if there's new activity since you last read it.
- A **chain** badge (red) if they replied to your reply.
- The other person's **@handle** (a link to their dossier), or their name if no dossier exists yet.
- A **stage chip** (e.g. `mutual`, `ally`) — how far your relationship with them has progressed.
- **owed 2h** — how long you've owed a reply.
- **zz** to snooze the thread 24h (click again to unsnooze); **✕** to mute the thread entirely (click again to unmute). Muted/snoozed threads sink to the bottom.

**Expanding a thread** (click the *"N msg ▸"* summary) reveals the full back-and-forth — your messages marked "me," theirs marked with their handle, each with age and a link to the tweet. Expanding an unread thread marks it read.

When a thread is an open loop, expanding it reveals the reply workflow:

- **Draft reply** — one Grok call drafts a reply in your voice (uses your original post as context). It may produce a couple of **variants** you can switch between with the small angle chips.
- **Copy** — copies the chosen draft to your clipboard. Paste it into X.
- **Done** — marks the loop settled (once you've actually pasted your reply into X). This clears the "owed" flag immediately.
- **canned ▾** — a **$0** premade reply instead of a Grok draft: pick one of your reply lists and stratus picks an item you haven't used recently, fills their name/handle in, humanizes it and copies it. Good for loops that just need a warm acknowledgment. Lists are managed in **Replies → Lists**.

Empty state: *"No conversations yet. Refresh pulls new mentions (~$0.001 each)."*

### 5. Radar

**When it appears:** always present, fed live from your browsing session. **This is $0 and free-flowing.** As you scroll X, the extension quietly scores each tweet's **band** (hot/warm/skip). Every **hot** or **warm** tweet you scroll past gets added to the Radar queue here, so a good reply opportunity doesn't evaporate the moment it leaves your screen. You can also **pin any tweet regardless of band** with the round **⊕ "add to Radar"** button that sits on every tweet's action row on x.com — "I want to reply to this one, period." A pinned tweet gets a **`manual`** band chip and ranks at the very top of the queue. (The queue lives in browser session memory and clears when you close the browser — though drafted replies are saved on the server and rehydrate after a restart.)

Rows are ranked by: **manually pinned** first, then **who the author is** (an ally/mutual/target outranks a stranger), then band (hot before warm), then how fast the tweet is gaining views, then recency.

**Header actions:**

- **Draft replies (N)** — makes **one** Grok call that drafts a reply — three angle variants (extends / contrarian / debate) — for every un-drafted tweet in the queue (up to 20 at a time). The cost of that single call is shown afterward. Each tweet then shows its ready reply (the first variant), and drafts survive a browser restart with all three variants intact.
- **Clear** — dismisses everything currently shown (so it won't come back).

**Two tabs:**

- **Queue** — the not-yet-worked opportunities, split into **Reply ready** (already has a drafted reply) and **New** (no reply yet).
- **Clicked** — tweets whose drafted reply you've already copied (they move here so the queue stays the fresh set).

**Each Radar row shows:**

- A **band chip** — `hot`, `warm`, or `manual` (a tweet you pinned with ⊕).
- The **author** (a link to their dossier).
- A **tier chip** if the author is on your roster: `ally`, `mutual`, or `target` (also a dossier link) — this is *why* they outrank a louder stranger.
- **reply ready** if a reply's been drafted.
- **✕** to dismiss the row (done, or not worth it — dismissed tweets never re-enter the queue).
- The **tweet text** as a link. If a reply has been drafted, **clicking the link copies that reply to your clipboard** (and opens the tweet in a new tab) — so you land on X with your reply ready to paste. On the tweet page, the three angle chips also appear beside the reply box: clicking one types that variant in and marks the draft **posted** (it becomes a measured `reply_drafts` row). The row then moves to the "Clicked" tab.
- A **"why" line**, e.g. `1.5k views · 8 replies · 22m · 70/min · bait` — the signals behind the band verdict (views, replies, age, views-per-minute, and whether it's reply-bait). The age keeps ticking while it sits in the queue.
- The **drafted reply text** (once drafted), with a hint that opening the tweet copies it.
- A **channel tag picker** (once a reply exists) to file the tweet under one of your topic channels.

Empty state: *"Browse X — hot/warm tweets you scroll past queue up here."*

### 6. Targets

**When it appears:** loads independently when the tab opens. This is your **roster of in-band accounts** — saved authors whose follower count is 2–10× yours, the sweet spot for replies that get noticed and reciprocated. The heading shows the count and the exact follower band (e.g. *"1.2k–6.0k followers"*).

Each row shows:

- **@handle** (a link to their dossier) and **↗** (their profile on X).
- Their **follower count**.
- **Momentum** — their follower growth, e.g. `+45/day`, or *"no trend yet"* if there aren't enough data points.
- A **"last replied to"** line: `replied 3d ago · 5× total`, or *"never replied to."* If it's been more than **7 days** (or never), this line turns **amber** — a neglected target you should get back to.

Empty states: *"No account snapshot yet — runs after the first 03:00 UTC pass"* (stratus needs to know your own follower count first, which it records daily), or *"No saved authors in the 2–10x band. Save authors from their profile page to build the roster."*

### 7. Top Fans

**When it appears:** loads independently when the tab opens. These are **people who already notice you** — ranked by how many times they've mentioned or replied to you over a trailing window.

- A **30d / 90d** toggle in the heading switches the window.
- Each row shows the **inbound count** (`5×`), the **@handle** (dossier link), a **stage chip** if you have a relationship, and a **"last acknowledged"** line: `acknowledged 2d ago` or *"never acknowledged."*
- When stratus has harvested likes/reposts/follows from your notifications page, the row also shows **`· N engagements`** for the same window (see **[Notifications surface](./notifications-surface.md)**). This is **display-only** — engagement never changes the ranking, because a like is not a conversation. The line is hidden at zero.
- If a **top-10 fan** hasn't been acknowledged by you in over 7 days, that line turns **amber** — they've given you attention and you owe some back.

Empty state: *"No inbound in the last 30 days."*

### 8. Followers KPI and conversion line

**When it appears:** whenever the Brief loaded. From the Brief.

- A big **follower number**, with a **+N / 7d** delta (green up, red down) and a small **sparkline** of your recent follower trend.
- Below it, a **conversion line** (when there's enough data): e.g. *"1.2k profile visits → +34 followers · 2.8% 7d · 3.1% 28d."* This answers "is my profile converting the attention it gets?" — of the people who visited your profile, what fraction turned into follows, over the last 7 days (and 28 days when available). It only shows once you've had at least 20 profile visits in the window.

### 9. Pinned post watch

**When it appears:** **only when there's a nudge to make** — otherwise completely absent. Your pinned tweet is the first thing profile visitors see, so stratus watches it. Two possible nudges (either or both):

- **Stale pin:** *"Your pin hasn't changed in N days — profile visitors land here first,"* with a link to see the pinned tweet. (Fires when the pin is unchanged for more than 21 days.)
- **Out-performed pin:** *"Your best work isn't pinned — a recent post has 4× the pinned tweet's views,"* showing that post's text and a link to *"Open it, then pin it."* (Fires when a post from the last 30 days has at least 3× the pinned tweet's views.)

Pinning is manual in the X app — these are reminders, not actions.

### 10. Today's plan

**When it appears:** whenever the Brief loaded. From the Brief. Two parts:

- **Scheduled posts today** — each with its time, a status badge (`pending`, `posted`, etc.), and the post text. If nothing's scheduled: *"Nothing scheduled today."*
- **Open slots (gaps)** — the recommended posting times ("anchors") for today that you *haven't* filled, ranked highest-value first. Each shows the hour and, when there's enough history, the average views-per-day that time slot has earned (`2.1k avg views/day · n=6`), or *"no data (n=…)"* when the sample's too small to advise. If every slot is filled you'll see *"All N slots filled."*

### 11. Replies quota

**When it appears:** whenever the Brief loaded. From the Brief. Tracks the reply side of the 70/30 doctrine.

- A **progress bar** and label like **7 / 10–20 today** — replies you've posted today against the daily target range. The bar turns green once you hit the minimum.
- A **week line**: *"Week: 42 replies · 12 posts — 78% replies (target 70%)."* This is where you see whether your reply-to-post mix matches the 70/30 doctrine over the week.

### 12. Yesterday

**When it appears:** whenever the Brief loaded. From the Brief. Yesterday's published output with measured numbers:

- **Posts** and **Replies** lists, each tweet showing views, likes, replies, and profile visits.
- If a tweet hasn't been measured yet, it shows *"awaiting 03:00 UTC snapshot"* — stratus reads each tweet's metrics once, in a daily 3 AM UTC pass.
- If you published nothing: *"Nothing published yesterday."*

### 13. Profile-click leaders (7d)

**When it appears:** only when there's at least one leader — otherwise absent. Your tweets from the last 7 days that earned the most **profile visits** (the follow-driving metric). Each shows the text, profile-visit count, views, and whether it's a post or reply.

For **posts** (not replies) there's a **quote re-up** button: it drafts three fresh quote-tweet takes on that proven winner via Grok (roughly **$0.006**), landing them as draft rows in your Calendar. Nothing posts until you schedule one. A status line confirms *"3 quote drafts in the calendar ($0.0063)."*

### 14. Spend today (UTC)

**When it appears:** whenever the Brief loaded. From the Brief. Today's API spend, split by source: *"X $0.0120 · Grok $0.0043 · total $0.0163."* Note this section is anchored to the **UTC billing day** (unlike the rest of the tab, which uses your local day), so it lines up with X's billing.

### 15. Sunday Digest ("This week")

**When it appears:** always present at the bottom. On **Sundays** it loads automatically; any other day it waits behind a **"Read the week's digest"** button.

This is the coach's weekly note. It makes one Grok call (roughly **$0.01**) to narrate your week — but **only from real numbers**, never invented. The narration is cached per week on the server, so opening the panel twice on Sunday doesn't spend again.

- A **narrative** (a few short paragraphs), or a fallback line if Grok isn't configured or hit an error (the facts below still stand).
- A **facts strip**: follower delta, profile-visit conversion, posts/replies count, in-band reply share (the 70/30 roster-coverage check, with a ✓ when you're on-doctrine), quest days completed, and total spend.
- A footer showing *"week of …"* and a **Rewrite** button — the one explicit way to re-spend the ~$0.01 and regenerate the narration.

---

## Common workflows

### Work my reply queue this morning

1. Open the panel — you land on **Today**.
2. Start with **Do Next**: clear any **chain** rows first (someone re-engaged you — reply fast via the ↗ link), then **DM** and neglected **target/ally** rows. Snooze (zz) anything you can't get to.
3. Drop to **Conversations** and click **Refresh** to pull any new mentions (costs ~$0.001 each; you get 4/day). Work the open loops top-down: expand a thread → **Draft reply** → pick a variant → **Copy** → paste into X → **Done**.
4. Check **Radar** for hot/warm tweets you scrolled past. Hit **Draft replies** to batch-draft them in one Grok call, then click each tweet (which copies its reply) and paste on X.
5. Glance at **Targets** and **Top Fans** for amber lines — neglected people who deserve a reply.
6. Check the **Replies quota** bar to see how close you are to today's target.

### Handle an open conversation loop

1. In **Conversations**, find a thread marked **owed** (chains are at the very top).
2. Click the summary to expand it and read the full exchange.
3. Click **Draft reply**. If variants appear, switch between them with the angle chips.
4. Click **Copy**, open the tweet on X (the message links are clickable), and paste your reply — editing it into your own words.
5. Back in stratus, click **Done** to settle the loop.

### Act on a Radar opportunity

1. While browsing X normally, hot/warm tweets accumulate in **Radar** automatically ($0).
2. In the **Radar** section, click **Draft replies (N)** — one Grok call drafts a reply for each queued tweet.
3. Each row now says **reply ready**. Click the tweet text: this copies the reply to your clipboard *and* opens the tweet in a new tab. The row moves to **Clicked**.
4. On X, paste and send. If a tweet isn't worth it, hit **✕** to dismiss it (it won't come back).

### The 30 minutes after a post goes live (Launch Room)

1. When a scheduled post publishes, you get a browser notification and the **Launch Room** appears at the top of Today with a 30-minute clock.
2. Click **Open on X — be present** to watch your post's replies.
3. As you scroll the replies on X, early repliers stream into the room automatically. Around the 20-minute mark, optionally click **Pull from X** (~$0.001–0.005) to catch anyone you missed.
4. For each replier: **Draft reply** → **Copy** → paste on X. Reply to as many early commenters as you can — that's the whole point of the window.
5. If your post was a thread with the link in the first reply, the checklist reminds you to pin that reply.
6. The room closes itself after 30 minutes, or click **✕** to close early.

---

## States you'll see

- **Loading** — the top **Refresh** button reads *"Loading…"* while the Brief fetches. Individual sections may briefly show nothing until their own data arrives.
- **Empty** — most sections show a plain gray line when there's genuinely nothing to do (*"Nothing owed — go hunting,"* *"Browse X — hot/warm tweets… queue up here,"* *"No conversations yet,"* etc.). Some sections (**Launch Room**, **Pinned post**, **Profile-click leaders**) render nothing at all when they have no reason to appear — that's normal, not a bug.
- **Error** — a red line appears in the affected section (or under the header for the Brief). It's scoped: an error in one section doesn't take down the rest of the tab. Common causes are a bad or missing bearer token, or the server being unreachable. Refresh to retry.

---

## Tips and good to know

- **Posting and DMs are always manual.** Every "Draft" / "Copy" flow ends with you pasting into X yourself. stratus never publishes, replies, or messages on your behalf. This is deliberate — the words stay yours.
- **Which clicks cost real money.** Most of the tab is free ($0): reading the Brief, Do Next, Conversations list, Radar rendering, Targets, Top Fans, the digest *facts*, and every **canned ▾** pick (premade replies use no AI at all). The buttons that spend are:

  | Action | Where | Rough cost |
  |---|---|---|
  | Refresh / pull mentions | Conversations, Launch Room "Pull from X" | ~$0.001 per mention |
  | Draft a reply (single) | Conversations, Launch Room | ~$0.002–$0.004 (Grok) |
  | Draft replies (batch) | Radar | one Grok call, shown after |
  | Opener / icebreaker | Do Next | ~$0.005 (Grok) |
  | Quote re-up draft | Do Next "reup", Profile-click leaders | ~$0.006 (Grok) |
  | Digest "Rewrite" | Sunday Digest | ~$0.01 (Grok) |

  The **Spend today** section is your running meter for exactly this.
- **Refresh only reloads the Brief.** To reload Do Next, Targets, or Top Fans, switch tabs and come back. Conversations and the Digest have their own buttons; Radar and Launch Room are live.
- **Mention refreshes are rate-limited** to 4/day on your side (6/day on the server). Spend them when it counts.
- **The daily 03:00 UTC snapshot** is why yesterday's tweets sometimes read *"awaiting 03:00 UTC snapshot"* — stratus measures each tweet's numbers once a day rather than polling constantly (to keep costs near zero).
- **Time zones:** everything on Today uses your local day *except* the Spend section, which uses the UTC billing day to match X's billing.
- **Almost every handle is a link** to that person's dossier in the People tab — click through whenever you want the full history before you reply.
- **Amber means "you owe someone."** Whenever a "last replied" or "acknowledged" line turns amber (in Targets or Top Fans), it's flagging attention you've received but haven't returned.
- **Green never turns red.** The quests and streak are built to encourage. A day with no opportunity counts as done, and a quiet day never breaks your streak.
