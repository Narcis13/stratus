# Today Tab

The **Today** tab is stratus's home screen — the "what do I do right now?" dashboard. It opens by default when you open the side panel, and it stacks everything that needs your attention into one scrollable view: a live post you just published, the replies you owe, people who noticed you, your follower trend, your daily to-do list, and a running tally of what you've spent. You don't have to click into other tabs to know what today looks like — Today answers that on its own. (Hot tweets worth jumping on live one tab down, in **[Radar](./radar-tab.md)** — it's live-updating and long-dwell, so it got its own room.)

Nothing on this tab posts, replies, or DMs for you. Every action that touches X ends with you copying text and pasting it into X yourself (or opening a tweet in a new tab). stratus drafts, ranks, and reminds; you stay the one who actually speaks.

---

## What it's for and where it fits

stratus is a personal growth-and-CRM tool for X (Twitter). It schedules your posts, tracks how they perform, keeps a swipe file of other people's tweets you admire, and — most importantly — remembers the people behind the handles (who replied to you, who you owe, who's worth building a relationship with).

The other tabs are where you *do* focused work:

- **Radar** — the reply queue: tweets your sweep filters caught while you browsed, batch-drafted three ways.
- **Composer / Calendar** — write and schedule posts.
- **Voice** — save other people's tweets for style reference; manage your content "pillars."
- **People** — the CRM: one page ("dossier") per person you've ever interacted with.
- **Playbook** — what's actually working, measured.
- **Channels** — topic rooms.

**Today is the glue.** It pulls the most urgent, time-sensitive slices out of all of those and puts them on one screen, ranked by what matters most right now. Almost every person's handle on the Today tab is a clickable link that jumps you straight to their dossier in the People tab.

A few pieces of vocabulary used throughout this tab (explained again in context below):

| Term | Meaning |
|---|---|
| **Band** | A verdict the extension computes for each tweet as you scroll X: **hot** ("reply now"), **warm** ("worth watching"), or **skip** ("thread's too deep, you'd be buried"). Based on the tweet's views, reply count, age, how fast it's gaining views, and whether it's "reply-bait." Banded tweets queue up in **[Radar](./radar-tab.md)**. |
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
- **Launch Room** is live — it updates itself from browser session storage as you browse X, with no button needed (so does the **[Radar](./radar-tab.md)** tab next door).
- **Sunday Digest** loads automatically on Sundays and has its own button the rest of the week.

If loading the Brief fails, a red error line appears just under the header; the rest of the tab still works.

---

## The dashboard, section by section

Sections are described in the order they appear on screen (top to bottom). Many of them **render nothing at all when there's no data** — this is intentional, and each note below says when a section is invisible.

Several section headers carry a small **⚙** button. That's the inline settings affordance: it opens a little card holding exactly the knobs that shape *that* section, and it writes to the same place **Settings → Tuning** does. See **[Tuning Today from Today](#tuning-today-from-today-the--gears)** below for the full list. Where a number in this document is configurable, it's written as "N by default."

### 1. Launch Room 🚀

**When it appears:** only for **30 minutes** right after one of your scheduled posts actually goes live. Outside that window this section is completely absent. (The extension sets a timer for each scheduled post; when the post's time arrives it verifies with the server that the post really shipped, then opens the room and shows a browser notification: *"«your post…» just went live — open the Launch Room."*)

**Why it exists:** the first 30 minutes after a post lands is the highest-leverage window you get — replying quickly to early commenters is where relationships and reach compound. The Launch Room is a checklist and a workbench for exactly those 30 minutes.

**What's on it:**

- A **🚀 Launch Room** heading with a ticking clock, e.g. `04:12 / 30:00` (time elapsed since the post went live, out of the 30-minute window).
- A **✕** button (top right) to close the room early.
- The **text of the post** that just went live.
- **Open on X — be present** — a link that opens your live tweet in a new tab so you can watch and reply to comments there.
- A short **checklist**: "Seed the first comment yourself — extend the post, don't restate it" and "Reply to every early commenter (in X — paste, human words)". If this was a thread where the link lives in the first reply, the seed item is replaced by "Pin your first reply — the link lives there" (that first comment is already spoken for — it's the link).
- **First comment** — a **Draft seed comment** button (hidden on link-in-first-reply threads). The first comment under your own post is yours to write, and the pattern that measures well is one that *extends* the post — the detail that didn't fit, a number, the counter-case — not a restatement.
- **Early repliers** — a list of people who have already replied to your post. These are captured automatically **while you have the tweet open on X** — as you scroll the replies, stratus streams them into this list. If the list is empty it says *"Keep the tweet open on X — replies you scroll past appear here."*

**What you can do:**

- **Draft seed comment** (under "First comment") — one Grok call (~**$0.002–$0.004**) that writes your own first comment on the post, in your voice, told outright that the post is yours and to extend rather than restate it. You get the usual three angles as chips (**extends / contrarian / debate**), each carrying its **coach score** (hover the number for the worst two things about it — see **[Replies → the three variants](./replies-tab.md#generating-and-the-three-variants)**) — click one to switch the text — then **Copy** and paste it under your post on X. (The draft is marked "copied" in the background and shows up in the Replies tab like any other, filed under `@me`.)
- **Pull from X** button (next to "Early repliers") — makes one paid call to X to fetch repliers you may not have scrolled past yet. It costs roughly **$0.001–$0.005** and is limited to 6 pulls per day across the whole app. The button hints *"(best at 20m)"* if you press it too early — around 20 minutes in is when most early replies have landed. After a successful pull it shows how many new mentions came in and tells you to check the Conversations section below.
- Per replier row:
  - Their **name/handle** is a link to their **dossier** in the People tab.
  - **open** — opens their reply on X in a new tab.
  - **Draft reply** — makes one Grok AI call (roughly **$0.002–$0.004**) to write a reply in your voice, using your original post as context. Once drafted, the button becomes **Copy** — click it to copy the draft to your clipboard, then paste it into X. (The draft is marked "copied" in the background.)
  - **canned ▾** — your premade reply lists (**$0**, no AI): pick a list and stratus chooses an item you haven't used recently, fills in their name/handle, roughs it up slightly so it doesn't read as a macro, and copies it to your clipboard. Ideal for the "thanks for the early read" tier of acknowledgment. Manage the lists in **Replies → Lists** ([docs/replies-tab.md](./replies-tab.md)).

Posting the reply itself always happens by you pasting into X. stratus never auto-replies.

### 2. Manual post reminder 📌

**When it appears:** only when one of your **manual** posts (scheduled to be published by hand, not via the API) reaches its slot time. The extension sets a reminder alarm for each manual post; when its minute arrives you get a browser notification — *"Time to post: «your post…»"* — and a card appears here for about **an hour**. Outside that window the section is absent. Unlike the API publisher, stratus never posts a manual post for you — this card is the nudge to go do it.

**What's on the card:**

- The **full text** of the post, ready to copy.
- An amber **visual** note if a Studio image was made for the slot (a reminder to attach the PNG by hand — the API can't).
- **Copy** — copies the text.
- **Open X compose** — opens X's post composer in a new tab so you can paste.
- **Mark posted** — after you've published it by hand, this flips the post to *posted* and dismisses the card. (You don't paste the tweet's URL anywhere — the daily reconcile links your pasted tweet back to its calendar slot automatically, by matching the text, so its metrics get tracked like any other post.)

If more than one manual post is due at once, you'll see one card each (newest first). A post you've already handled but not marked drops off on its own once its slot is well past — the Calendar's **overdue** tint then owns the reminder.

### 3. Today's quests and streak

**When it appears:** whenever the Brief loaded (almost always). Its data comes from the Brief.

This is your gentle daily checklist — designed to encourage, never to guilt. Each quest shows **✓** (done) or **○** (not yet), a label, and progress (e.g. `4/10`, or a short note).

| Quest | What it asks | Notes |
|---|---|---|
| **Quality replies** | Post ~10 replies today | Counts replies you've actually pasted/sent today. |
| **1 original** | Publish 1 non-reply post today | |
| **2 neglected targets** | Reply to 2 in-band targets you've ignored for over a week | Scales down if you have fewer than 2 neglected targets. |
| **1 open loop closed** | Answer 1 owed mention today | Counts as done automatically if your inbox is already clear. |
| **Launch room attended** | Reply to a commenter within 30 min of one of today's posts | Marked "N/A" on days you didn't post. |
| **5 replies to your people** | Reply to 5 people you already know | Counts only people who were *already* yours when the day started. |

**About "your people."** It's the same set the reply gate uses to let you draft on a quiet post without the force dance: anyone you've actually posted a reply to before (stage **engaged** or higher), plus everyone on your 2–10× target roster. The target comes from your niche's **reciprocity** number, not from the ⚙ here.

The **"already yours when the day started"** part is the whole point of the quest, and it's worth understanding. Replying to a stranger is what *promotes* them to "engaged" — so if the quest just asked "is this person in my circle?", every first reply of the day would score, and the number would only ever repeat what the *Quality replies* quest already told you. Instead it asks who was in your circle **before** today, so it measures the thing that actually compounds: going back to the same people. If a day's replies all went to new accounts you'll see `0/5` with the note *"today went to new faces — circle back to someone"* — that's a correct reading, not a broken counter. A brand-new install shows *"no one in your circle yet"* and is counted as done.

**Gentle by design:** a quest with no opportunity today (e.g. you had no post to launch) is counted as done, with a note explaining why. A quiet day never breaks your streak. When every quest is done you'll see *"All done — the rest of the day is yours."*

The heading shows your **streak** — the number of consecutive days you finished everything (e.g. *"5-day streak"*), or *"streak starts today"* the first day. There is no red, no penalty, anywhere in this section.

The **⚙** in the header edits the quest targets themselves: originals per day, how many neglected targets to ask for, how cold "neglected" means, and the launch-room attendance window. Two quests are deliberately not in there — **Quality replies** follows your niche's reply band (or a daily commitment when one is active) and **replies to your people** follows your niche's reciprocity target. Both live on the Niche card under **Settings → General**, and a second knob for the same number would silently disagree with the first. The gear says so.

**Your commitments set two of the targets.** If you've promised yourself a daily minimum in **Settings → Commitments**, the *Quality replies* and *1 original* quests read that number instead of the defaults — the labels become e.g. *"17 quality replies"* and *"3 original posts"*. A **paused** commitment changes nothing. A commitment can only ever *raise* a bar, so a streak already on the books can't be retroactively broken. (The **Replies quota** section further down deliberately keeps showing the 10–20/day doctrine band: a personal minimum isn't a redefinition of the doctrine, so the two legitimately disagree.)

**The debt line.** Under the quest list, if you've missed a commitment on recent days, one small line appears — and only then:

- **Nothing at all** when you've missed nothing. Silence is the reward.
- **One missed day** — a quiet grey line.
- **Three or more** — amber.
- **Five or more** — amber, and it suggests *lowering the bar in Settings* rather than trying harder. A promise you keep breaking is usually the wrong promise.

Today never counts as a miss (it's still in progress), and days before you made the promise count as nothing at all — so a commitment made this morning reads zero, which is correct rather than broken.

### 4. Goals

**When it appears:** only when you have at least one **active** goal (set them in the **[Me tab](./me-tab.md)**). No goals, no card — the Me tab is where goals are created, and this is where they're chased.

Where the Me tab is the ledger ("500 replies by September"), this card answers the only question that matters day to day: **am I going to make it?**

Each goal shows:

- A **verdict chip** — `ahead`, `on pace`, `behind`, or `overdue`. A goal with no deadline, or one whose metric hasn't been measured yet, is simply left ungraded rather than guessed at.
- A **progress bar** (the same bar the replies quota uses).
- A line like **`23d left · need 4/day · doing 6/day`** — what the remaining days each have to carry, against the rate you're actually managing. That comparison *is* the verdict.
- A **drop** button (with a confirmation) for a goal you've stopped chasing. Dropping matters: an abandoned goal that stays active keeps dragging down your weekly grade.

**Goals settle themselves when you look at them.** Opening Today is what notices that a goal hit its target (**achieved**) or ran out of days (**missed**) — there's no background job. When that happens the goal simply *disappears from this card*, with no fanfare, and lives on in the Me tab's ledger. That's deliberate: this card is a to-do list, not a trophy shelf.

### 5. Do Next

**When it appears:** loads independently when the tab opens. This is your **follow-up queue** — a short, ranked list (**5 rows by default**) of the single most useful thing to do for each person or post. It's a queue, not a dashboard: work the top and it shrinks. The header **⚙** sets how many rows to show and how long the **zz** snooze lasts; *which* follow-ups qualify at all is the Follow-ups group in **Settings → Tuning**.

Each row has a small colored **kind chip**, the person's **@handle** (a link to their dossier) or *"your post"*, a one-line **reason**, and action buttons.

| Chip | Kind | What it means | What to do |
|---|---|---|---|
| **chain** | Chain live | Someone just replied to one of your replies, and the window is still hot (under 24h). The high-value re-engagement moment. | The **↗** opens their reply on X. Reply back fast. |
| **DM** | DM ready | This person recently warmed up to you (they replied, you two are becoming mutuals) — a good moment to send a direct message. | Click **draft DM** to open their dossier, where the [Draft DM box](./people-tab.md) writes a grounded message you copy and send by hand in X. |
| **target** | Neglected target | An in-band target (2–10× your size) you haven't replied to in over a week. | Go reply to something of theirs. |
| **ally** | Neglected ally | Someone you have a real two-way relationship with, gone quiet for 14+ days. | Reach back out. |
| **reup** | Re-up candidate | Not a person — one of *your* older posts (14–60 days old) that did genuinely well and is worth quote-tweeting again. | Use **draft** (see below). |
| **rising** | Momentum | An account that's heating up (gaining followers fast). A heads-up, never a demand — always at the bottom of the queue. | Consider engaging while they're on the rise. |

**Buttons on each row:**

- **↗** (when present) — opens the relevant tweet on X (their reply, or your post to re-up).
- **opener** (person rows) — expands an "icebreaker" box that drafts a reply-style opener and a DM-style opener grounded strictly on your real shared history with that person (an AI call, roughly **$0.005**). Only one opener box is open at a time. You copy and send manually.
- **draft** (re-up rows only) — drafts three quote-tweet "re-up" takes on your old winning post via Grok (roughly **$0.006**). They land as draft rows in your Calendar for you to schedule. After drafting, that candidate drops off the queue.
- **zz** — snoozes this item for **24 hours by default** (the ⚙ changes it; a snooze already pressed keeps the length it was given).

If there's nothing to do, you'll see *"Nothing owed — go hunting."* (with a count of any snoozed items). If there are more rows than the strip shows, a *"+N more in the queue"* note appears at the bottom.

### 6. Conversations (the Inbox)

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

- **Draft reply** — one Grok call drafts a reply in your voice (uses your original post as context). It may produce a couple of **variants** you can switch between with the small angle chips, each carrying its **coach score** (hover the number — see **[Replies → the three variants](./replies-tab.md#generating-and-the-three-variants)**).
- **Copy** — copies the chosen draft to your clipboard. Paste it into X.
- **Done** — marks the loop settled (once you've actually pasted your reply into X). This clears the "owed" flag immediately.
- **canned ▾** — a **$0** premade reply instead of a Grok draft: pick one of your reply lists and stratus picks an item you haven't used recently, fills their name/handle in, humanizes it and copies it. Good for loops that just need a warm acknowledgment. Lists are managed in **Replies → Lists**.

Empty state: *"No conversations yet. Refresh pulls new mentions (~$0.001 each)."*

### 7. Targets

**When it appears:** loads independently when the tab opens. This is your **roster of in-band accounts** — saved authors whose follower count is 2–10× yours, the sweet spot for replies that get noticed and reciprocated. The heading shows the count and the exact follower band (e.g. *"1.2k–6.0k followers"*).

Each row shows:

- **@handle** (a link to their dossier) and **↗** (their profile on X).
- Their **follower count**.
- **Momentum** — their follower growth, e.g. `+45/day`, or *"no trend yet"* if there aren't enough data points.
- A **"last replied to"** line: `replied 3d ago · 5× total`, or *"never replied to."* If it's been more than **7 days by default** (or never), this line turns **amber** — a neglected target you should get back to.

The header **⚙** edits that window — and it's the *same* number the **Do Next** queue and the Sunday digest use, not a lookalike, so the roster can't look calm while the queue nags about the same person. The **2–10× follower band itself is not in the gear**: it belongs to your active niche (**Settings → General → Niche**), which the gear says out loud.

Empty states: *"No account snapshot yet."* (stratus sizes the band off your own follower count, which the first 03:00 UTC pass records), or *"No saved authors in the 2–10x band."* with a hint to save authors from their profile page.

### 8. Top Fans

**When it appears:** loads independently when the tab opens. These are **people who already notice you** — ranked by how many times they've mentioned or replied to you over a trailing window.

- A **30d / 90d** toggle in the heading switches the window.
- Each row shows the **inbound count** (`5×`), the **@handle** (dossier link), a **stage chip** if you have a relationship, and a **"last acknowledged"** line: `acknowledged 2d ago` or *"never acknowledged."*
- When stratus has harvested likes/reposts/follows from your notifications page, the row also shows **`· N engagements`** for the same window (see **[Notifications surface](./notifications-surface.md)**). This is **display-only** — engagement never changes the ranking, because a like is not a conversation. The line is hidden at zero.
- If a **top-10 fan** (by default) hasn't been acknowledged by you in over **7 days** (by default), that line turns **amber** — they've given you attention and you owe some back. The header **⚙** holds both numbers: how deep the amber goes, and how long counts as unacknowledged. Only the nudge moves — the ranking is inbound volume over the window you picked, always.

Empty state: *"No inbound in the last 30 days."*

### 9. Followers KPI and conversion line

**When it appears:** whenever the Brief loaded. From the Brief.

- A big **follower number**, with a **+N / 7d** delta (green up, red down) and a small **sparkline** of your recent follower trend.
- Below it, a **conversion line** (when there's enough data): e.g. *"1.2k profile visits → +34 followers · 2.8% 7d · 3.1% 28d."* This answers "is my profile converting the attention it gets?" — of the people who visited your profile, what fraction turned into follows, over the last 7 days (and 28 days when available). It only shows once you've had at least 20 profile visits in the window.

### 10. Pinned post watch

**When it appears:** **only when there's a nudge to make** — otherwise completely absent. Your pinned tweet is the first thing profile visitors see, so stratus watches it. Two possible nudges (either or both):

- **Stale pin:** *"Your pin hasn't changed in N days — profile visitors land here first,"* with a link to see the pinned tweet. (Fires when the pin is unchanged for more than 21 days.)
- **Out-performed pin:** *"Your best work isn't pinned — a recent post has 4× the pinned tweet's views,"* showing that post's text and a link to *"Open it, then pin it."* (Fires when a post from the last 30 days has at least 3× the pinned tweet's views.)

Pinning is manual in the X app — these are reminders, not actions.

### 11. Milestone

**When it appears:** **only in the three days after you cross a follower milestone** — silent every other day. The ladder is 50 · 100 · 250 · 500 · 1,000 · 2,500 · 5,000 · 10,000 · 25,000 · 50,000 · 100,000.

Reads: *"You crossed 1,000 followers on Jul 25 — post it. Milestone posts are one of your best formats."* A **Draft it** button spends one ~$0.006 Grok call on the ordinary post drafter, pre-steered with the milestone, and lands three drafts in the [Calendar](./calendar-tab.md) — *"3 drafts in the Calendar — pick one and slot it."* From there they behave like any other draft.

Two things it deliberately doesn't do. It **doesn't check whether you already posted the milestone** — it's a nudge, not a tracker, and it goes quiet on its own after three days (same discipline as the pinned watch above). And it only reports a crossing it actually **watched happen**: the follower series has to contain a snapshot *below* the rung before the one that reaches it. So a fresh install won't congratulate you on a milestone you passed years ago — but it also means the very first snapshot after setup can never be the crossing one.

### 12. Account health

**When it appears:** **only when something actually fired** — on a normal day this section does not exist. That silence is the feature: an always-visible "all clear" panel trains you to stop reading it.

This is the one part of stratus that watches **you** rather than your audience. An account suspension zeroes every goal at once, so a handful of rules look for the shapes X's spam heuristics are known to punish — all computed from data stratus already has, at **$0**, and all **advisory**. Nothing here ever blocks an action.

Rows are colour-coded: red = critical, amber = warn, grey = advice. The five rules:

| Rule | Fires when | Reads as |
|---|---|---|
| **Posting burst** | more than 4 original posts in 24h, or any two posted under 20 minutes apart | The publisher jitters its minutes on purpose; two posts twenty minutes apart means you're posting by hand on top of the schedule. |
| **Reply burst** | more than 10 replies pasted inside any one hour (critical above 15) | The exact shape bulk-reply detection watches for. It looks at the *densest* hour of the last three, so a burst that ended ninety minutes ago still shows — X saw it either way. |
| **Near-duplicate** | two of your originals in the last 14 days overlap 80%+ | Repetitive content is its own penalty. Both tweet ids are listed. |
| **Unfollow churn** | 25+ unfollows marked in 24h (critical at 40) | This can only fire if you out-ran the [Following queue](./people-tab.md#the-following-subtab--roster-hygiene) by hand — it enforces the same 40/day ceiling. |
| **Schedule cluster** | two pending posts under 45 minutes apart | Advice, not danger. The [Composer](./composer-tab.md#schedule-time-warnings) tells you this at schedule time, when it's still one edit away from fixed. |

Every threshold is an **opening guess**, and each rule reports at most one row — so this card can never fill your screen with the same complaint five times.

One thing it deliberately doesn't do: thread tails don't count as a posting burst. They're published as self-replies, so a six-tweet thread stays one post as far as this card is concerned.

### 13. Today's plan

**When it appears:** whenever the Brief loaded. From the Brief. Two parts:

- **Scheduled posts today** — each with its time, a status badge (`pending`, `manual`, `posted`, etc.), and the post text. A `manual` badge (with a paste-hint on hover) marks a post you publish by hand rather than through the API. If nothing's scheduled: *"Nothing scheduled today."*
- **Open slots (gaps)** — the recommended posting times ("anchors") for today that you *haven't* filled, ranked highest-value first. Each shows the hour and, when there's enough history, the average views-per-day that time slot has earned (`2.1k avg views/day · n=6`), or *"no data (n=…)"* when the sample's too small to advise. If every slot is filled you'll see *"All N slots filled."*

### 14. Replies quota

**When it appears:** whenever the Brief loaded. From the Brief. Tracks the reply side of the 70/30 doctrine.

- A **progress bar** and label like **7 / 10–20 today** — replies you've posted today against the daily target range. The bar turns green once you hit the minimum.
- A **week line**: *"Week: 42 replies · 12 posts — 78% replies (target 70%)."* This is where you see whether your reply-to-post mix matches the 70/30 doctrine over the week.
- A **harvested line**, when you've harvested your own replies (**Harvest → my replies**): *"Harvested 2026-08-06: 98 replies · 61.6 views/reply."* The last **complete** day only — today's replies are still accruing views, so including them would read as a collapse every morning — and counting each reply once at its freshest capture, however many times you've harvested it. Unlike the Playbook's tables this number is **not** gated at n≥20: it's one day's raw arithmetic over everything you posted, compared against nothing, and the point is watching it move day to day. Nothing renders at all when your handle is unset (**Settings → Identity**) or nothing was harvested in the last 14 days — an absent number is not a zero.

### 15. Yesterday

**When it appears:** whenever the Brief loaded. From the Brief. Yesterday's published output with measured numbers:

- **Posts** and **Replies** lists, each tweet showing views, likes, replies, and profile visits.
- If a tweet hasn't been measured yet, it shows *"awaiting 03:00 UTC snapshot"* — stratus reads each tweet's metrics once, in a daily 3 AM UTC pass.
- If you published nothing: *"Nothing published yesterday."*

### 16. Profile-click leaders (7d)

**When it appears:** only when there's at least one leader — otherwise absent. Your tweets from the last 7 days that earned the most **profile visits** (the follow-driving metric). Each shows the text, profile-visit count, views, and whether it's a post or reply.

For **posts** (not replies) there's a **quote re-up** button: it drafts three fresh quote-tweet takes on that proven winner via Grok (roughly **$0.006**), landing them as draft rows in your Calendar. Nothing posts until you schedule one. A status line confirms *"3 quote drafts in the calendar ($0.0063)."*

### 17. Spend today (UTC)

**When it appears:** whenever the Brief loaded. From the Brief. Today's API spend, split by source: *"X $0.0120 · Grok $0.0043 · total $0.0163."* Note this section is anchored to the **UTC billing day** (unlike the rest of the tab, which uses your local day), so it lines up with X's billing.

### 18. Sunday Digest ("This week")

**When it appears:** always present at the bottom. On **Sundays** it loads automatically; any other day it waits behind a **"Read the week's digest"** button.

This is the coach's weekly note. It makes one Grok call (roughly **$0.01**) to narrate your week — but **only from real numbers**, never invented. The narration is cached per week on the server, so opening the panel twice on Sunday doesn't spend again.

- A **narrative** (a few short paragraphs), or a fallback line if Grok isn't configured or hit an error (the facts below still stand).
- A **grade badge** above the facts — a single **0–100** score for the week, with a breakdown on hover and *"+6 vs last week"* when you improved. It blends five things you can act on: how many days you finished all your quests (30%), how many separate days you published an original (20%), replies against your target (25%), how your active goals are pacing (15%), and how close your reply/post mix landed to the 70/30 doctrine (10%). A component with no data drops out and the rest re-weight, so a quiet area is never scored as a failure. The delta line celebrates a rise and states a fall plainly — no red, same as the rest of the tab.
  **No badge at all under four tracked days.** A week you barely opened the panel for isn't a week that can be graded, and half a grade is worse than none — so the whole badge is absent, and the narration is never even shown a number to comment on.
- A **facts strip**: follower delta, profile-visit conversion, posts/replies count, in-band reply share (the 70/30 roster-coverage check, with a ✓ when you're on-doctrine), quest days completed, and total spend.
- A footer showing *"week of …"* and a **Rewrite** button — the one explicit way to re-spend the ~$0.01 and regenerate the narration.

---

## Tuning Today from Today (the ⚙ gears)

Four section headers carry a **⚙**. Each one opens a small card of exactly the knobs that shape that section — the same knobs, stored in the same place, as **Settings → Tuning**. Editing one here and looking at it there shows the identical value; there is no separate "Today config."

| Gear | What it holds | Notes |
|---|---|---|
| **Today's quests** | Originals per day · neglected targets per day · neglected-after (days) · launch attend window (min) | The *reply* and *replies to your people* quests are absent on purpose — your niche's reply band (or an active commitment) and its reciprocity target own those numbers. |
| **Do next** | Rows to show · snooze length (h) | Which follow-ups qualify is the **Follow-ups** group in Settings → Tuning. |
| **Targets** | Neglected target after (days) | The same key the Do-next queue and the Sunday digest read. The 2–10× band is niche-owned. |
| **Top fans** | Fan amber rank · fan unacknowledged after (days) | Moves the nudge only, never the ranking. |

**How the gears behave:**

- **Changes save themselves.** There is no Save button. Type a number and it's written a moment after you leave the box (or press Enter) — one write per knob. Clicking outside the popover mid-edit saves what you typed rather than dropping it.
- **A rejected value snaps back.** Every knob has a floor and a ceiling defined server-side; a value outside them is refused, the row shows the error code, and the saved value reappears. The bounds are the guard — not the UI.
- **A small accent dot** next to a label means that knob is no longer at its shipped default. Click the dot to put it back.
- **A gear is invisible when the server is unreachable.** The section itself keeps working: the numbers it renders with come from a locally mirrored copy that falls back to the shipped defaults, so a dead server changes nothing about what you see, only your ability to edit it.
- **Numbers cross to the page too.** The knobs Today reads live in a mirrored blob the extension refreshes when you save. A change lands in an already-open panel within a few minutes, or immediately when you reopen it.

---

## Common workflows

### Work my reply queue this morning

1. Open the panel — you land on **Today**.
2. Start with **Do Next**: clear any **chain** rows first (someone re-engaged you — reply fast via the ↗ link), then **DM** and neglected **target/ally** rows. Snooze (zz) anything you can't get to.
3. Drop to **Conversations** and click **Refresh** to pull any new mentions (costs ~$0.001 each; you get 4/day). Work the open loops top-down: expand a thread → **Draft reply** → pick a variant → **Copy** → paste into X → **Done**.
4. Switch to the **[Radar](./radar-tab.md)** tab for the tweets your sweep caught while you scrolled. Hit **Draft replies** to batch-draft them in one Grok call, then click the angle you want on each row (which copies it and opens the tweet) and paste on X.
5. Glance at **Targets** and **Top Fans** for amber lines — neglected people who deserve a reply.
6. Check the **Replies quota** bar to see how close you are to today's target.

### Handle an open conversation loop

1. In **Conversations**, find a thread marked **owed** (chains are at the very top).
2. Click the summary to expand it and read the full exchange.
3. Click **Draft reply**. If variants appear, switch between them with the angle chips.
4. Click **Copy**, open the tweet on X (the message links are clickable), and paste your reply — editing it into your own words.
5. Back in stratus, click **Done** to settle the loop.

### Act on a Radar opportunity

That loop lives on its own tab now — see **[Radar → Workflow](./radar-tab.md#workflow-work-the-radar)**. In short: swept tweets pile up while a sweep is armed ($0), **Draft replies (N)** writes three angles for each in one Grok call, and clicking the angle you want copies it and opens the tweet.

### The 30 minutes after a post goes live (Launch Room)

1. When a scheduled post publishes, you get a browser notification and the **Launch Room** appears at the top of Today with a 30-minute clock.
2. Click **Open on X — be present** to watch your post's replies. Seed the first comment yourself — **Draft seed comment** → pick an angle → **Copy** → paste it under your post.
3. As you scroll the replies on X, early repliers stream into the room automatically. Around the 20-minute mark, optionally click **Pull from X** (~$0.001–0.005) to catch anyone you missed.
4. For each replier: **Draft reply** → **Copy** → paste on X. Reply to as many early commenters as you can — that's the whole point of the window.
5. If your post was a thread with the link in the first reply, the checklist reminds you to pin that reply.
6. The room closes itself after 30 minutes, or click **✕** to close early.

---

## States you'll see

- **Loading** — the top **Refresh** button reads *"Loading…"* while the Brief fetches. Individual sections may briefly show nothing until their own data arrives.
- **Empty** — most sections show a short coach line, usually with a second smaller line telling you what would fill it (*"Nothing owed — go hunting"* / *"Reply to a target from Radar or the roster and the chain comes back here when they answer"*). Some sections (**Launch Room**, **Pinned post**, **Milestone**, **Profile-click leaders**) render nothing at all when they have no reason to appear — that's normal, not a bug.
- **Error** — a red line appears in the affected section (or under the header for the Brief). It's scoped: an error in one section doesn't take down the rest of the tab. Common causes are a bad or missing bearer token, or the server being unreachable. Refresh to retry.

---

## Tips and good to know

- **Posting and DMs are always manual.** Every "Draft" / "Copy" flow ends with you pasting into X yourself. stratus never publishes, replies, or messages on your behalf. This is deliberate — the words stay yours.
- **Which clicks cost real money.** Most of the tab is free ($0): reading the Brief, Do Next, Conversations list, Targets, Top Fans, the digest *facts*, and every **canned ▾** pick (premade replies use no AI at all). The buttons that spend are:

  | Action | Where | Rough cost |
  |---|---|---|
  | Refresh / pull mentions | Conversations, Launch Room "Pull from X" | ~$0.001 per mention |
  | Draft a reply (single) | Conversations, Launch Room (per replier + **Draft seed comment**) | ~$0.002–$0.004 (Grok) |
  | Draft replies (batch) | the **[Radar](./radar-tab.md)** tab | one Grok call, shown after |
  | Opener / icebreaker | Do Next | ~$0.005 (Grok) |
  | Quote re-up draft | Do Next "reup", Profile-click leaders | ~$0.006 (Grok) |
  | Digest "Rewrite" | Sunday Digest | ~$0.01 (Grok) |

  The **Spend today** section is your running meter for exactly this.
- **Refresh only reloads the Brief.** To reload Do Next, Targets, or Top Fans, switch tabs and come back. Conversations and the Digest have their own buttons; the Launch Room is live.
- **Mention refreshes are rate-limited** to 4/day on your side (6/day on the server). Spend them when it counts.
- **The daily 03:00 UTC snapshot** is why yesterday's tweets sometimes read *"awaiting 03:00 UTC snapshot"* — stratus measures each tweet's numbers once a day rather than polling constantly (to keep costs near zero).
- **Time zones:** everything on Today uses your local day *except* the Spend section, which uses the UTC billing day to match X's billing.
- **Almost every handle is a link** to that person's dossier in the People tab — click through whenever you want the full history before you reply.
- **Amber means "you owe someone."** Whenever a "last replied" or "acknowledged" line turns amber (in Targets or Top Fans), it's flagging attention you've received but haven't returned. Both windows are editable from the ⚙ on those sections.
- **Every number on this tab that could be argued with is a knob.** Where a count or a window looks arbitrary, check the section's ⚙ before working around it — and see **[Settings → Tuning](./settings-tab.md)** for the full registry.
- **Green never turns red.** The quests and streak are built to encourage. A day with no opportunity counts as done, and a quiet day never breaks your streak.
