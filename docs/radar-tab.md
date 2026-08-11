# Radar Tab

The **Radar** is your reply queue. **It is manual by default**: nothing enters it except tweets you ⊕ by hand. When you want the queue to fill itself, you arm a **sweep** for a bounded session and state, as numbers, what it is allowed to admit. One click drafts a reply for the whole queue; one click on the angle you like copies it and opens the tweet so you can paste.

> **This changed on 2026-08-10.** The Radar used to fill itself on every scroll from three ambient rules, and the only way to shape that was twelve band thresholds encoding someone else's model of "worth replying to". Now capture is a valve you open. Expect a much smaller queue — that is the feature, not a regression.
>
> **And on 2026-08-11 those twelve thresholds were deleted**, along with the classifier they fed: no more coloured left border or dimmed rows on x.com, no more "dead post" refusal from Reply Master. The sweep filters below are the only rule that decides what a tweet qualifies for.

It sits in the **Operate** group, right under Today. It used to be a section *inside* Today — it moved out because it's the surface you spend the most time in during a reply session, and it's the only one that updates itself live while you're on X.

**Nothing here posts for you.** Every path ends with text on your clipboard and a tweet open in a new tab. You paste, you edit if you want, you hit Reply.

---

## What it's for and where it fits

Replies are how a small account grows: you show up under someone bigger, in front of an audience that isn't yours yet. The hard part isn't writing the reply — it's *catching the tweet in time*, while it's still climbing and the thread isn't already 400 comments deep.

That's the Radar's whole job:

- **Capture** — by default, only what you ⊕. Arm a **sweep** and, for as long as it runs, tweets you scroll past that clear your filters queue up on sight ($0 — it's reading what the page already rendered, not calling the X API).
- **Rank** — the queue is ordered by what's actually worth your next five minutes, not by when you saw it.
- **Curate** (once the queue outgrows one batch) — a cheap scoring call grades every fresh tweet for *reply payoff*, throws the filler out of the queue, and hands the drafting money to the best of what's left.
- **Draft** — one Grok call writes only the angles that fit each tweet's **room**. A football joke and a funeral post no longer get the same reply menu.
- **Hand off** — you pick the angle, it lands on your clipboard, and the tweet opens.

| Term | Meaning |
|---|---|
| **Band** | The verdict computed for each tweet as you scroll: **hot** ("reply now"), **warm** ("worth watching"), **skip** ("thread's too deep, you'd be buried"). Based on views, reply count, age, how fast it's gaining views, and whether it's "reply-bait". The thresholds are a **fixed classifier** — since 2026-08-10 they're no longer editable in the panel (they left Settings along with any suggestion that they filter anything). **They do not decide what enters the queue** — they draw the border you decide from, and they gate a single Reply Master draft. |
| **Sweep** | A bounded session during which tweets may enter the queue by themselves. You arm it from the Radar header (**Start sweep**), it stops when you press Stop, when you click the on-page chip, or on its own after **30 minutes** by default. Absent = manual, which is where a fresh install, a cleared profile and an expired session all land. |
| **manual** | A tweet *you* pinned with the ⊕ button on x.com, regardless of the filters. "I want to reply to this one, period." The only way in when no sweep is armed. |
| **swept** | A tweet an armed sweep's filters admitted — the ordinary way a row arrives. Hover it: *"your sweep filters admitted this one — the band classifier had no opinion."* If the classifier *did* say hot or warm, the row keeps that chip instead. |
| **your circle** | A quiet tweet that got in because of *who posted it*: someone you've replied to before, or someone on your 2–10× target roster. Only during a sweep, and only with the **Circle accounts bypass** switch on (it ships **off**). Same rule the reply gate uses, so anything captured this way is also something you can draft a reply to without forcing past the "dead post" warning. |
| **cannon** | A tweet whose author is on your camped **cannon roster**, admitted during a sweep without meeting the metric filters (it still obeys the max age). The **Camped accounts bypass** switch ships **on**. See **The Cannon**, below. |
| **Cannon score** | `views ÷ (replies + 1)` — how many eyes a post has per reply already under it. A lot of views and almost nobody in the comments means an early reply actually gets read. It deliberately knows nothing about the author's follower count: a 200k account's dead post is worth less than a 2k account's live one, and looking size up would cost $0.010 per handle to measure the wrong axis. |
| **Room / mode** | What kind of conversation the post is in: **expertise**, **hot-take**, **news**, **wholesome**, **banter**, or **general** when nothing resolves. The server decides it per post from an explicit request override, a curation label, a cannon-roster topic pin, or the post text, in that order. Every drafted row shows the room and why it was picked before you paste. |
| **Angle** | How a reply engages: **extends** (build on the point), **contrarian** (take the other side), **debate** (open an argument), **observation** (notice one concrete detail), or **question** (ask something the author would want to answer). The room narrows the menu: banter gets two safe angles; wholesome and news get observation/question; expertise keeps the original argument-heavy set. |
| **Tier** | What the people layer knows about the author: **ally**, **mutual**, or **target** (on your 2–10× roster). A warm tweet from an ally beats a hot tweet from a stranger. |

**The queue only grows while you browse.** It's stored in the extension's own local storage, so it survives a browser restart, an extension reload and a service-worker recycle — it used to live in *session* memory, which Chrome drops on any of those, and a queue that collapsed mid-scroll was the result. Three things take a tweet out: **you dismiss it** (the ✕ or Clear), **a drafting pass consumes it** (see *A pass empties the queue*, below), or it **ages out after 24 hours** — a tweet you first saw yesterday isn't a reply opportunity today. It holds **500 rows**, which is a storage bound rather than a policy: a whole sweep session lands, and the 100-row ceiling that used to drop tweets your own filters had admitted is gone.

**A dismissal now expires after 24 hours.** The dismissed list used to be a permanent blocklist of the last 500 ids — dismiss enough and tweets stopped entering the queue for reasons you couldn't see. A tombstone only has to outlive the tweet it buries (a sweep won't re-admit anything older than your age bound anyway), so it lasts a day and then stops mattering. **A ⊕ pin overrides its own tombstone**: dismissing something and then deliberately pinning it is you changing your mind, and it used to be answered with silence.

Drafted replies are also saved server-side and rehydrate into the queue the next time you open the panel, with the variants the room allowed intact.

---

## Filling the queue

Two ways in, both free. One is always open; the other you arm.

### 1. By hand, with ⊕ — the default and always-on path

Every tweet's action row on x.com carries a round **⊕ "Add to Radar"** button. It pushes that tweet into the queue whatever the filters would say — a question you want to answer properly later, a stranger nobody has noticed yet. Pinned tweets get a **`manual`** band chip and rank at the very top.

**The ⊕ stays lit on tweets that are already queued.** Scroll away, scroll back, and the button on a queued tweet renders in its filled state with the tooltip *"Already in the Radar queue"* — so you never pin the same post twice or wonder whether the click registered. Dismiss the row in the panel and the ⊕ goes back to empty on the next scan.

### 2. During an armed sweep

Press **Start sweep** in the Radar header. While it runs, a tweet you scroll past enters the queue if it clears **your** filters — eleven numbers you own, typed into the **⚙** next to the button (or the **Sweep** group in **Settings → Tuning**; same knobs, same values). This is the **only** admission rule there is:

| Filter | Default | What it admits |
|---|---|---|
| **Min impressions** | 300 | A tweet needs at least this many views. Inherited from the old reply band's "worth a reply" floor, restated rather than shared — moving it does not move the on-page border. |
| **Max impressions** | 2000 | Past this, the post is too big: your reply lands under a crowd. An order of magnitude above the floor, so the admitted band is still wide enough to fill a session. |
| **Min likes** | 0 (no floor) | |
| **Max likes** | 20 | The like ceiling matching the impressions one at the ~1% like rate a small post runs at. |
| **Min replies** | 0 (no floor) | A floor on "is anyone actually there". |
| **Max replies** | 40 | Past this you're buried in the thread. The old reply band's "still near the top" number, restated. |
| **Max tweet age** | 60 min | Nothing older is swept in. **The one age rule** — it applies to every arm, including the two bypasses below, and it is what keeps them from flooding the queue. |
| **Verified authors only** | **on** | Only sweep in tweets whose author carries the verified badge — only Premium viewers' impressions count toward the goal, so a reply under an unverified author is unpaid work. |
| **Camped accounts bypass** | **on** | A post by someone on your camped **cannon roster** gets in without meeting the metric filters — a three-minute-old post has no numbers yet, and that is exactly when the slot under it is open. Still obeys the max age. Chip: `cannon`. |
| **Circle accounts bypass** | off | Same, for people in your CRM circle. Chip: `your circle`. |
| **Sweep auto-stop** | 30 min | How long one armed sweep lasts. Not a filter. |

**On every maximum except the age one, `0` means "no ceiling"** — two of them ship as real ceilings now, but type a 0 into one yourself and that ceiling comes off. The age bound is the exception and it is always enforced — its floor in the settings is 1 minute, and 0 there is refused rather than read as "unlimited".

**A swept tweet reads `swept`.** The two bypass arms keep their own chips (`cannon`, `your circle`), so the Cannon view's membership means exactly what it always did. Every chip now names a *capture reason* — how the row got here — rather than a verdict about the tweet.

**Verified is the one filter that can fail quietly, and it fails in the safe direction.** The badge is read off X's own markup, which X owns and will change. An author whose name block can't be read counts as **not verified**, so a drift shows up as a visibly empty queue rather than as a filter that silently stopped filtering. It ships **on** anyway, because an unverified author's impressions do not count toward the goal — but that makes it the **first switch to turn off** when the queue goes unexpectedly empty, since a drifted selector and a genuinely quiet feed look identical from the panel.

**Row order:** manually pinned first (you asked for it), then who the author is (ally / mutual / target outranks a stranger), then how fast the tweet is gaining views, then recency. **The capture reason does not sort the queue** — with the classifier gone every band says how a row arrived, not how loud it is, and how loud it is, is exactly what views-per-minute measures. **The Queue is deliberately not re-sorted by cannon score** — that ordering exists in the Cannon view and nowhere else, because the Queue is the relationship lane and an arbitrage shot must not push an ally off the top of it.

**Under pressure the queue keeps what you asked for.** It holds 500 rows; when it overflows, `your circle` captures are dropped first, then the oldest `swept` / `cannon` sightings, then **anything already carrying a drafted or copied reply** (a Grok call was spent on it — a scroll past a hundred strangers must not be what throws it away), and a ⊕ pin is dropped last.

**"Your circle" means *stage `engaged` or better*** — someone you have actually posted a reply to — plus your target roster. It deliberately does **not** mean everyone stratus has a row for: simply hovering someone's name on the timeline files them away, and treating that as a relationship would put most of x.com in this queue.

### What a sweep does *not* change

- **The free passive harvest still runs.** Every tweet that scrolls past keeps feeding the corpus the Playbook's timeline funnel measures against. Gating it would make that funnel measure your button-pressing instead of your timeline.
- **Nothing marks up the timeline.** There used to be a green/amber left border and a dimmed row, drawn by a reply-band classifier. Both are gone as of 2026-08-11, along with the classifier and its twelve `x.band.*` thresholds — the filters above are the only rule left. **Reply Master no longer refuses a draft** either: the "dead post — click to force" warning came from the same classifier.

---

## The sweep row

Directly under the Queue / Cannon / Clicked strip, in **all three views** (a sweep is global — hiding it in one view is how you end up sweeping for an hour without knowing it):

**`[Start sweep]  Manual — only ⊕ pins enter the queue  ⚙`**

- **Start sweep / Stop sweep** — arms and disarms capture. Armed, the button goes green: *armed* means "a thing is running", which is why it is not the accent tint the selected tab uses. Start again as many times as you like in one session.
- **The state line, three shapes:**

  | You see | It means |
  |---|---|
  | `Manual — only ⊕ pins enter the queue` | The default state. Nothing is being captured. |
  | `Sweeping · 24m left` | Armed, counting down. The number is whole minutes, rounded up, so a fresh 30-minute sweep reads `30m left`. |
  | `Sweep ended — nothing new is being captured` | The sweep **expired on its own** while you were watching. It clears back to the manual line after a minute. |

  The ended notice only appears for an expiry the panel actually watched — a Stop you pressed goes straight back to `Manual`, and opening the panel long after a sweep expired shows plain `Manual` too. The notice exists to catch an auto-stop mid-session, not to report history.

- **⚙** — the eleven sweep filters, typed as exact numbers, with the same reset dots and refusal messages as the Settings tab, and a **Reset to defaults** button at the foot of the card that drops every override on it back to the shipped numbers in one request (greyed out when nothing is overridden). Its note states the split so the band stays legible: *these numbers are the only thing that decides what a sweep admits; the reply band still draws the on-page border and gates a single reply draft, but it is a fixed classifier now, not a filter you tune.*

**Both writes are optimistic and roll back honestly.** If arming fails the row goes back to `Manual`; if stopping fails the row goes back to **`Sweeping`** and says so — because the page really is still capturing, and a row claiming a stop that did not happen is the one lie this control cannot afford.

**The countdown is a label, never the decision.** Whether a sweep is live is re-resolved from its stored expiry every time either surface renders, so a panel or a tab that was throttled or asleep past the deadline captures nothing on wake. No timer owns the truth.

---

## Header actions

- **Draft replies (N)** — makes **one** Grok call for every un-drafted tweet in the queue (**20 at a time by default**). Each post is resolved into its own room and receives that room's angle set: 2 or 3 variants in English, or one `extends` variant when the batch resolves to another language. The cost of that single call is shown right after, e.g. `12/12 drafted · $0.0431`. It drafts the *top* N of the queue — the ranking decides, nothing is graded — and **clears everything it didn't draft** (see below). In the **Cannon** view the same button drafts the cannon rows instead, and consumes only those.
- **Curate & draft (N)** — the same thing, but it grades first. See below. **These two are the only buttons on the tab that spend money.** It renders in the **Queue view only** — see *The Cannon*, below, for why.
- **Clear** — dismisses everything currently shown in the view you're looking at. In the Cannon view that means exactly the rows on screen, never the ones the 30-minute cutoff is hiding. Dismissed tweets don't re-enter the queue for 24 hours, even though the page keeps re-sighting them while they're on screen — and a ⊕ pin puts one back immediately if you change your mind.
- **⚙** (next to the header buttons) — the batch sizes. Three numbers live in there: the radar's own **draft cap**, the **batch cap the server enforces**, and the **curated batch size**. A plain click sends the *lower of the first two*, so raising one past the other can't buy you a refused click; the third sizes a curated pass and is itself capped by the server's batch cap. What lands on the radar at all isn't here — that's the sweep ⚙ next to **Start sweep**. (⊕ pins and fresh posts by your circle get in regardless of the sweep filters — see the three ways in, above.)

### A pass empties the queue

**Either drafting button consumes the whole fresh queue, not just the rows it sends.** When the call comes back, every un-drafted row the pass covered is cleared: the ones the model silently skipped, the ones past the batch cap that were never sent, and **⊕ pins that didn't make the cut**. Nothing undrafted survives a pass. What's left is the reply-ready rows and nothing else, so the next sweep starts from a clean slate — that is the trade for letting a sweep ingest without a ceiling. The note says how many went: `18/20 drafted · cleared 37 · $0.0512`.

Cleared rows are dismissed the same way the ✕ dismisses, so they don't re-enter while you keep scrolling — and, like every dismissal now, that tombstone expires after a day.

**A failed call clears nothing.** If the drafting call itself fails — server unreachable, a 500, a bad token — the queue is untouched and the note ends in `· queue kept`. A dead call is not a verdict on any tweet, and it's the one failure on this tab that couldn't be undone. Retry is one click.

**In the Cannon view a pass consumes only the cannon rows**, never the queue rows the view isn't showing.

---

## Curate & draft — spend on the best 25, not the newest 25

After a long scroll session the queue holds 40+ tweets, and "Draft replies" spends on whatever ranked first. Ranking is about *heat and who posted it* — it can't see that a tweet is a "drop a link, let's connect" thread with nothing to reply to. So once the queue outgrows one curated batch, a second button appears next to the first:

**Curate & draft (25)** — one cheap scoring call grades **every fresh tweet in the queue** for reply payoff ("if I write one sharp reply under this, will it earn impressions and profile visits for *me*?"), then:

1. Everything flagged as **filler** is **dismissed from the queue** — connection invites, follow trains and pods, giveaways, contentless engagement bait, or a personal announcement that cannot be answered without inventing a story.
2. Everything below the cut is dismissed too. Only the **top 25** (or whatever the knob says) survive.
3. Those survivors get the normal room-specific batch draft — one Grok call, exactly as before.

**Your ⊕ pins are never scored away.** A tweet you pinned by hand isn't sent for grading at all, and it's always in the draft set, ahead of the curated survivors. A deliberate human click outranks the model. (It can still be *cleared* at the end of the pass if the batch cap couldn't fit it — no row survives a pass undrafted.) `roster`, `hot` and `warm` rows all get graded — content quality is exactly the thing the band numbers can't see.

**The button only appears when the queue is bigger than the curated size.** Below that, "Draft replies" already covers everything and grading would be a second call that changes nothing.

**Two calls, one price line.** The note under the header reports the whole click:

| You see | It means |
|---|---|
| `scored 42 · dropped 17 · drafted 25/25 · $0.0491` | The normal, good outcome. |
| `scored 38 · 4 unscored · dropped 17 · drafted 21/21 · cleared 4 · $0.0463` | The model's answer came back short. The 4 it never graded weren't *dismissed on a verdict* — they were **cleared with everything else the pass didn't draft**, because a pass empties the queue. A degraded answer costs you coverage, not a mystery row that sits there forever. |
| `scored 42 · dropped 42 · nothing left to draft · $0.0051` | Everything graded as filler. You paid for the grading only. |
| `scored 42 · dropped 17 · draft failed: … · rest of the queue kept · $0.0051` | The drafting call failed *after* the drops. **The drops stand** — they were dismissed on their own merit — but nothing else is cleared, because the pass never got an answer. The grading spend is still reported. |
| `Curate failed: …` | The grading call itself failed. **Nothing was dismissed and nothing was drafted** — you can't lose queue rows to a call that never answered. |
| `nothing to grade — 4 ⊕ pinned, 31 with no text · use Draft replies` | The queue is long enough for the button, but none of it is gradeable: every fresh row is either a ⊕ pin (never scored, by design) or has no text to score. **Nothing was spent** — the call was never made. |

**Dismissal lasts a day.** Dropped tweets go onto the same dismissed list the **✕** button uses, so they don't come back while you keep scrolling. That's the point — a curated pass is a decision, not a filter you can undo within the session — but the tombstone expires after 24 hours, so the list can never become a blocklist that quietly stops your queue from filling. If the queue feels over-culled, the size knob is in **⚙** (**Curated batch size**, also in **[Settings → Tuning → Radar](./settings-tab.md)**): 5 to 50, default 25, and the effective size is always the *lower* of it and the batch reply cap.

**Rows with no text aren't graded — but they don't survive the pass either.** An image-only sighting has nothing to grade and nothing to reply to, so it's skipped by both halves of the pass and then cleared with everything else undrafted.

**Only the top 100 of the queue are ever graded in one pass.** That's the server's limit on a single scoring call, and it's separate from the buffer's 500. On a queue longer than that, the rest is never scored — and, like everything else the pass didn't draft, it's cleared when the pass ends.

The rubric itself — what earns a high score, and the exact list of what counts as filler — is an editable prompt: **[Settings → Prompts → reply curation](./settings-tab.md#prompts-editor-the-prompts-subtab)**. It now scores the **concrete hook** a reply can grab — a named thing, number, visible detail, claim, or moment — regardless of whether the topic is in your professional lane. The scorer also returns a room label for free, which outranks detection when the survivors are drafted. It's the only prompt in stratus that *removes* things rather than writing them, so widening its filler list throws more of your queue away. Both the default size and that list are **opening guesses**; change them from what you see in your own measured reply outcomes, not on a hunch.

---

## The three views

- **Queue** — the not-yet-worked opportunities, split into **Reply ready** (drafts waiting) and **New** (no reply yet). "Draft replies" only ever spends on the **New** group.
- **Cannon** — the same buffer read for **arbitrage**: only posts where a reply would actually be seen, sorted by score, nothing older than 30 minutes. See below.
- **Clicked** — tweets whose reply you've already taken. They move here so the queue stays the fresh set.

---

## The Cannon — reply where a reply gets read

The Queue answers *"who should I be talking to?"*. The Cannon answers a different question: **"where is there an open slot right now?"** A post with 200k views and 6 replies is a slot; the same account's post with 200k views and 400 replies is a wall. Reply *placement* is the thing that compounds impressions, and the band classifier can't see it — it's size-agnostic and it doesn't rank by density.

**Cannon score = `views ÷ (replies + 1)`.** That's the whole model. The `+ 1` is the divide-by-zero guard and the source measurement's own formula. Author size is never fetched — it's a $0.010 lookup per handle for an axis that turned out to be nearly uncorrelated with yield.

### What's in the view

A row is in the Cannon if **either** is true:

- its score clears the floor (`x.cannon.scoreMin`, **120** by default — see the note on that number below), **or**
- it was captured on the cannon arm in the first place (band `cannon`), which also covers roster accounts whose fresh post has too few views to score yet.

So a dense swept tweet shows up here without being re-banded, and a roster account's three-minute-old post shows up before it has any numbers at all. Both, and neither is redundant.

**The score is a *display* rule now, not a capture rule.** It used to also pull tweets into the queue on sight; since 2026-08-10 the sweep filters own admission, and `x.cannon.scoreMin` decides only what surfaces in this view out of what's already queued. The camped-roster half survives as a capture arm — the **Camped accounts bypass** switch in the sweep filters, on by default — and it only fires while a sweep is armed.

**Rows are sorted by score, highest first** (freshest wins a tie), each leading with a **score chip**. The `why` line shows `views · replies · Nm`, and the age turns **red past 15 minutes** — you're still in time, but not for long.

### The 30-minute rule

**A row whose displayed age passes 30 minutes disappears from this view.** Not dismissed, not deleted: it's still in the Queue under its normal 24-hour TTL, and you can still work it there. The cutoff is a *display* rule, because a stale cannon entry costs a reply slot for a 12-view return — and if it's still on screen, you'll spend one on it.

That's also why the empty state has two spellings, and they mean opposite things:

| You see | It means |
|---|---|
| *"Nothing scoring above 120 right now — the cannon queue fills from posts under 30 minutes old."* | There was nothing to shoot at. Browse a roster account's profile or your timeline. |
| *"N entries aged out past 30 minutes."* | **You missed the window.** They're still in Queue. The fix is browsing closer to when things get posted, not a wider roster. |

Only one of those is a reason to go change the roster. The view never collapses them into one line.

**A session where you didn't have X open produces an empty Cannon view, and that's correct, not a bug** — the capture side only runs while the extension can see the page.

### `placed today N / T`

The head of the Cannon view carries one live counter: how many replies you've **pasted today**, against your target. It's the daily instrument for the whole lane.

Two things worth knowing about it:

- **It counts the whole day's replies from every surface**, not cannon shots specifically. `T` is the same number the replies quest uses — your active `replies` commitment's daily target, or the doctrine's reply ceiling if you haven't set one. Two owners of that number is how a header and a quest start disagreeing on the same screen.
- **It reads and writes nothing.** `GET /brief` reports the same count but files a streak on the way, which is why the panel may refresh this one freely after a pick and may not poll that one. It updates on mount and after each pick — never on a timer.

### Drafting from the Cannon

**Draft replies (N)** renders here too, over the cannon rows that don't have a draft yet.

**`Curate & draft` is deliberately absent from this view, and it's staying absent.** Curation is a model call that *ranks* a queue — but the cannon score already ranked these rows, from measured numbers, for free. Paying a second model call to re-rank a set a measurement already ordered is exactly the spend that gets refused everywhere else in this codebase.

If every roster handle in the draft set declares the same reply **language**, the batch is drafted in it and the note line says so (`12/12 drafted · $0.0431 · in Japanese`). A mixed or undeclared set gets English and says that too (`· mixed languages — drafted in English`) — one language per call is the honest shape, since the batch prompt has a single instruction block.

**The server can now pick a language nobody declared.** If no roster handle in the set pinned one, it reads the posts' own **script**: when *every* tweet in the batch is in the same language, the whole batch is drafted in it; if they disagree, or if even one is undetectable, the batch goes out in English. That is all-or-nothing on purpose — one instruction block per call means the alternative is 25 replies in a language only the first tweet was written in. An explicit roster pick still wins over detection, and a batch drafted in a detected language says so in the same note line.

**A non-English batch drafts one variant per tweet, on the `extends` angle**, with a literal English **gloss** under it — so a row you can't read still tells you what it says before you copy it. There are no angle tabs on those rows: there's one angle by construction. Full reasoning in **[Replies → Replying in another language](./replies-tab.md#replying-in-another-language)**.

### The roster — who you camp

At the foot of the Cannon view sits a collapsed **Roster** block. It's the Sunday review, not part of the daily loop, which is why it's cold and collapsed and never refreshes itself while you're working the queue above it.

Each row is `score · @handle · nN · scored Nd ago`, ranked score-desc with never-scored handles last:

- The **score** here is the *author's* number, not a post's: `median(views) ÷ (median(comments) + 1)` over their **last 30 harvested posts**. It's computed from tweets your harvester already captured — **$0, no X API call, ever.**
- A handle with **fewer than 8 harvested posts reads `unscored`, never `0`.** "We looked and there wasn't enough" and "this author is worthless" are different facts, and a median over 3 posts is one outlier away from putting a dead account at the top of your roster.
- **`belowFloor`** rows are tinted as a warning — those are the Sunday drop candidates.
- **bench / camp** — benching keeps the row and its score but stops capturing their posts, and stops them opening the reply gate. **drop** deletes the target outright (behind a confirm); the harvested posts it was scored from stay, so re-adding and rescoring rebuilds the exact same number.
- **Rescore ($0)** recomputes every target from the harvest. It's a click, deliberately — no worker, no alarm. The numbers must not move under you mid-review.
- **+ add handle**, and under it a **Candidates** list: authors already in your harvest, scored the same way, not yet camped. One click adds them.

**The roster is only as good as your harvest.** A target you never harvest scores `unscored` forever. That's the honest failure mode, and it's why the Cannon view's *score-only* membership matters — the view still works with an empty roster.

**Never follow a cannon target.** The cannon is one-way: you're camping them for the audience in their replies, and that's a different relationship from the one the Circles lane builds.

### Two numbers to know about

- **The floor is 120, not 5,000.** The source measurement this lane came from used a 5,000 views-per-reply floor. Replayed over *our own* harvest corpus (1,841 rows, 296 handles, 30 days), only **0.60%** of rows cleared it — a floor that nothing crosses is indistinguishable from a broken feature. The shipped floor is that corpus's measured **p90 (120)**. If your own posting neighbourhood is louder or quieter, the knob is in **Settings → Tuning → Cannon**.
- **The 2–10× target band was NOT widened for this.** `targetBandMinX/MaxX` stay 2/10. The cannon roster is its own set, chosen for reach rather than relationship, and it deliberately never enters the 2–10× roster — widening that band would unblock nothing here and would quietly exempt every large account you ever saved from the reply gate.

---

## A row, part by part

- A **band chip** — `manual`, a muted, dashed `swept` (hover it: *"your sweep filters admitted this one"*; the dash is there because the rule that admitted it is one you can change), a muted `your circle` (hover it: it explains that the row is here for the person, not the numbers), or `cannon`. All four name *how the row was captured*; none is a judgement about the tweet. **Hover `cannon` too:** *"either it cleared the views-per-reply floor when it was sighted, or its author is on your camped cannon roster. Work it in the Cannon view — the slot closes fast."* A band whose reason isn't visible in the numbers always carries its reason in a tooltip.
- In the **Cannon view only**, a **score chip** ahead of the band chip — the row's `views ÷ (replies + 1)`.
- The **author** — click to open their dossier in the People tab.
- A **tier chip** if they're on your roster (`ally`, `mutual`, `target`) — also a dossier link. This is *why* they outrank a louder stranger.
- A **room chip** once drafted — `expertise`, `hot-take`, `news`, `wholesome`, `banter`, or `general`. Hover it to see whether the server used an explicit override, the curation pass, a roster topic pin, text detection, or the honest fallback. A wrong room is visible before the paste; pin the handle's topic in the cannon roster when an account consistently lives in one room.
- **reply ready** once a draft exists.
- **✕** to dismiss the row (done, or not worth it).
- The **tweet text**, as a link — clicking it just opens the tweet on X.
- A **"why" line**: `1.5k views · 8 replies · 22m · 70/min · bait` — the numbers the row was captured with. The age keeps ticking while the row sits in the queue, so a stale opportunity looks stale.
- **Angle tabs** (once drafted) — the subset this room allows, drawn from `extends` · `contrarian` · `debate` · `observation` · `question`, each with that variant's **coach score** (hover the number for the worst two things about it — see **[Replies → the three variants](./replies-tab.md#generating-and-the-three-variants)**). Click a tab to read that version; nothing else happens. The room's first angle is the primary pick, and the score never reorders the tabs. **A non-English draft has one variant, so no tab strip renders at all** — not an empty one.
- **A gloss line** under the reply body on a non-English draft: a literal, muted English rendering of what that reply actually says. It is never copied — clicking the body still yields only the reply itself.
- **The reply body** — the angle currently selected. **Clicking it does the whole handoff:** copies that exact text to your clipboard, opens the tweet in a new tab, and moves the row to **Clicked**. The hint under the text says `click → copies + opens the tweet`, and flips to `copied ✓` for a moment after — or to `copied ✓ · jitter: prefix, typo:swap` / `copied ✓ · no jitter this time` when **Humanize picks** is on (below).
- A **channel tag picker** (once a reply exists) to file the tweet under one of your topic channels.

The angle you click is the one recorded as what went out — so the Playbook's angle numbers reflect what you actually chose, not always the first variant.

**Empty states.** The Queue's has two spellings and they mean opposite things — never read as one:

| You see | It means |
|---|---|
| *"Nothing pinned yet."* — press ⊕ on any tweet, or **Start sweep** | The default state of a working install. Nothing is wrong; nothing is being captured because you haven't asked for it. |
| *"Sweeping — nothing has cleared the filters yet."* | A sweep **is** running and admitting nothing. Keep scrolling, or open the ⚙ next to Stop sweep. This is also the line that surfaces a drifted verified-badge selector when **Verified authors only** is on. |

Clicked's is unchanged: *"Replies you copy land here — most recent first."*

---

## Humanize picks

Under the Queue/Clicked strip sits a checkbox: **Humanize picks**, with the odds next to it (`~56% of picks come out changed` at the default chances). Off by default.

With it on, the angle you click is roughened on the way to your clipboard — a leading `honestly,`, a trailing `well said`, a lowercased first word, a dropped final period, or a small typo. Handles, names and links are never touched. The hint line then names what fired, so the feature is never silently doing nothing.

**Keep this off until you have reviewed the suffix pool.** The shipped suffixes predate the reply-craft overhaul: `well said`, `love this`, `good stuff`, `solid point`, and `nice one`. They are exactly the generic closing filler the drafting prompt now removes, and the default 0.20 suffix chance can staple one onto an otherwise sharp reply. The project default remains off; if you enable it now, first empty the suffix pool or set **Suffix chance** to `0` in Settings. A deterministic-humanizer overhaul is tracked separately.

Two things it deliberately does **not** do:

- **It never rewrites the stored draft.** The variants on the row stay exactly as Grok wrote them, so re-reading the card shows the real draft and the coach scores stay meaningful. What the jitter produces is recorded only as *what actually went out* — the same field a hand-edit lands in.
- **It doesn't re-roll.** The jitter is decided at the moment you click; the row keeps showing the stored text afterwards.

**So the Clicked list shows the verbatim variant, not the text you pasted.** That's the same rule seen from the other side, not a bug: the jittered version lives in your reply history (**[Replies](./replies-tab.md)**), because that's where "what actually went out" belongs. If you re-copy a row from Clicked, the jitter is rolled again — it's a fresh pick.

The chances and the prefix/suffix pools are project-level (shared by any surface that picks one up) and live server-side, so the checkbox survives a panel close and an extension reinstall. Edit them in **[Settings → General → Reply humanizer](./settings-tab.md#reply-humanizer)**: the two pools one entry per line, the five chances as numbers from 0 to 1, and a **Reset to defaults** that deletes the stored config outright — which also turns this checkbox off, since it's the same setting. Each canned **reply list** still keeps its own separate humanizer override.

If the panel can't reach the server when the tab mounts, the checkbox renders **disabled** and picks stay verbatim. Decoration never breaks the queue.

---

## On x.com while a sweep runs: the chip

A small **`● Sweeping · 24m left`** chip sits in the **bottom-left** of every x.com page while a sweep is armed (bottom-right belongs to X's compose button). It is the answer to "am I capturing right now?" without switching to the panel, and it is why you can never sweep unaware.

- **Click it to stop the sweep** — one click, reversible, and the panel's row follows immediately.
- **It disappears on expiry**, even on a page you've stopped scrolling.
- **If the stop fails, the chip stays and keeps counting down** rather than vanishing — the page really is still capturing.
- There is deliberately **no filter editing, no Start control and no capture counter on it**. Stopping from the page is safe because it is reversible; starting would need the filters visible to be honest, and those live in the panel.

---

## On the tweet page: the angle chips

When you open a drafted tweet on x.com, the same room-specific angles appear as a small chip strip on that tweet's action row — so you don't have to switch back to the panel to change your mind.

**Clicking a chip copies that variant to your clipboard and nothing else.** The hint reads *"Copied — press ⌘V in the reply box."* Paste it yourself and hit Reply.

It used to type the text straight into X's reply box. That was removed: X's composer is a rich-text editor that re-renders from its own model, and a fill that half-lands leaves a mangled draft you have to clear by hand — worse than the one keystroke it saved. The clipboard always works.

Clicking a chip also marks that draft **posted** on the server (a human claim at copy time, exactly like Reply Master's **Done**), which is what pulls the reply into your measured history: outcomes, angle effectiveness, reply latency, and the daily quota. If you copy and then decide not to send it, your quota reads one high until the next day.

---

## Workflow: work the Radar

1. Browse X normally, hitting **⊕** on anything you want to reply to. If you'd rather let the queue fill itself for a while, press **Start sweep** first — tweets clearing your filters queue up on sight ($0), the chip on the page reminds you it's running, and it stops itself after 30 minutes.
2. Open **Radar**. Skim the **why** lines and dismiss (**✕**) whatever isn't worth it *before* drafting — you don't pay for tweets you dropped.
3. Click **Draft replies (N)** — one Grok call, cost shown afterwards. If the queue got long enough for **Curate & draft (N)** to appear, prefer it: it does step 2's culling for you and puts the drafting money on the tweets most likely to pay.
4. For each **reply ready** row: check the room chip, read the available angle tabs, then click the body of the one you want. It's copied and the tweet opens.
5. On X: paste, edit it into your own words if you like, hit Reply.
6. The row is in **Clicked** now. When you're done, **Clear** the view.

---

## States you'll see

- **Empty queue** — the coach line above, with a second line reminding you nothing is fetched for this: it's what the page already showed you, banded and ranked.
- **Drafting…** / **Curating…** — the button that's working says so, and **both** buttons are disabled until it finishes. That's deliberate: a curated pass is busy dismissing rows a plain draft would otherwise be mid-way through drafting.
- **A status line** under the header after a draft run: `N/M drafted · $0.0xxx`, or `Draft failed: <reason>`. After a curated run it's the longer line — see the table in **Curate & draft**, above. `scored … · drafting…` is the halfway point: the grading is done and paid for, the drafting call is in flight.
- **No Curate & draft button** — the fresh queue isn't bigger than the curated size yet. Expected, not a bug.
- **Rows with no angle tabs** — an older draft (or one made from the CLI) that only kept a single reply. It still copies and opens the same way; with no tabs to carry it, the coach score sits at the end of the hint line under the reply.
- **A queue that empties itself on browser restart** — expected. Anything that was drafted comes back; undrafted sightings don't.

---

## Tips and good to know

- **Dismiss before you draft.** Drafting is one call for the whole batch, but a bigger batch is a bigger call. Culling the queue first is the cheapest way to spend less — **✕** by hand is free, and **Curate & draft** is the paid version of the same idea for when the queue got away from you.
- **Curating is cheap; drafting is not.** The scoring call reads text only and answers in a number per tweet — a few tenths of a cent for a whole 40-tweet queue, against a couple of cents for the drafting call it protects. That asymmetry is the entire argument for the button.
- **The ⊕ is the whole default path, not an escape hatch any more.** The band classifier no longer decides admission, so a tweet it would have skipped is one click away like any other.
- **Expect `Curate & draft` to stop appearing most days.** It only renders once the fresh queue outgrows the curated size (25 by default), and a handpicked queue rarely does. That is correct — curation exists to thin a queue you did not choose. Don't "fix" it by lowering the curated size.
- **Pressing Start more than twice in a sitting means the auto-stop is too short.** 30 minutes is a guess about attention span, not a measurement; the knob is right there in the ⚙.
- **A pinned tweet never pollutes your analytics.** `manual` is queue metadata about how the row was captured: pinned rows are excluded from the Playbook's hot/warm comparisons, because you chose them for reasons the classifier can't see. **`swept`, `your circle` and `cannon` work the same way** — one says your filters let it in, one says who posted it, one says the Cannon view wanted it. Four queue-metadata bands now, one rule: none of them ever lands in a Playbook hot/warm cell.
- **Whether manual-first changed what you reply to is one SQL query**, in the explorer or through `x_query` — there is deliberately no Playbook section for it:

  ```sql
  SELECT band, COUNT(*) drafted,
         SUM(CASE WHEN status IN ('clicked') THEN 1 ELSE 0 END) worked
  FROM radar_drafts WHERE created_at > (strftime('%s','now')-30*86400)*1000
  GROUP BY band ORDER BY drafted DESC;
  ```

  Recalibrate the sweep defaults from that at **100+ swept rows**, never earlier and never by feel.
- **`your circle` rows are the reciprocity lane's other half.** The Today tab counts how many of today's replies went to people who were already yours (*"N replies to your people"*); this is where those replies come from. A quiet post by an ally is worth more to you than a hot post by a stranger, and neither the band nor the reply gate will stop you any more.
- **Every handle is a link.** Before replying to someone you half-recognize, click through to their dossier and see the history first.
- **What this tab costs.** Capturing, ranking and rendering the queue: **$0**. The whole Cannon view, the roster, its scores, **Rescore** and the `placed today` counter: **$0 too** — every one of those is SQL over tweets your own browsing already captured, and none of that code can reach the X API. The spend is the two drafting buttons: **Draft replies** (one Grok call per click, price shown after) and **Curate & draft** (a cheap scoring call *plus* that same drafting call — two prices, reported as one total). See **[Spend today](./today-tab.md)** on Today for the running meter.

---

## See also

- **[Today](./today-tab.md)** — the rest of the daily loop: quests, follow-ups, conversations, quota.
- **[Replies](./replies-tab.md)** — Reply Master (one tweet, deeper context) and the canned reply lists.
- **[Playbook](./playbook-tab.md)** — which angles and which situations actually earn views and profile visits.
- **[On x.com itself](./s6-augmented-ui.md)** — the ⊕ button, the band border, the timeline chips and the context panel.
- **[Settings → Tuning](./settings-tab.md)** — the eleven **Sweep** filters (the same ones the ⚙ here edits), the two batch caps, the curated batch size and the four **Cannon** knobs. The reply-band thresholds are **[no longer there](./settings-tab.md#the-reply-band-left-this-tab)**.
- **[Settings → Prompts](./settings-tab.md#prompts-editor-the-prompts-subtab)** — `reply curation`, the topic-agnostic hook rubric that decides what counts as filler and returns each post's room.
