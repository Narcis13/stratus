# Radar Tab

The **Radar** is your reply queue. While you browse X normally, the extension quietly scores every tweet that scrolls past and keeps the promising ones here, so a good reply opportunity doesn't evaporate the moment it leaves your screen. One click drafts a reply for the whole queue; one click on the angle you like copies it and opens the tweet so you can paste.

It sits in the **Operate** group, right under Today. It used to be a section *inside* Today — it moved out because it's the surface you spend the most time in during a reply session, and it's the only one that updates itself live while you're on X.

**Nothing here posts for you.** Every path ends with text on your clipboard and a tweet open in a new tab. You paste, you edit if you want, you hit Reply.

---

## What it's for and where it fits

Replies are how a small account grows: you show up under someone bigger, in front of an audience that isn't yours yet. The hard part isn't writing the reply — it's *catching the tweet in time*, while it's still climbing and the thread isn't already 400 comments deep.

That's the Radar's whole job:

- **Capture** — as you scroll, the extension computes each tweet's **band** and streams every **hot** and **warm** one into this queue ($0 — it's reading what the page already rendered, not calling the X API). Plus one exception that isn't about heat at all: a **fresh post by someone already in your circle** is captured even when the band says skip.
- **Rank** — the queue is ordered by what's actually worth your next five minutes, not by when you saw it.
- **Curate** (once the queue outgrows one batch) — a cheap scoring call grades every fresh tweet for *reply payoff*, throws the filler out of the queue, and hands the drafting money to the best of what's left.
- **Draft** — one Grok call writes **three different angles** for every queued tweet at once.
- **Hand off** — you pick the angle, it lands on your clipboard, and the tweet opens.

| Term | Meaning |
|---|---|
| **Band** | The verdict computed for each tweet as you scroll: **hot** ("reply now"), **warm** ("worth watching"), **skip** ("thread's too deep, you'd be buried"). Based on views, reply count, age, how fast it's gaining views, and whether it's "reply-bait". The thresholds live in **Settings → Tuning → Reply band** — the same twelve the on-page border uses. |
| **manual** | A tweet *you* pinned with the ⊕ button on x.com, regardless of band. "I want to reply to this one, period." |
| **your circle** | A quiet tweet that got in because of *who posted it*: someone you've replied to before, or someone on your 2–10× target roster. Same rule the reply gate uses, so anything captured this way is also something you can draft a reply to without forcing past the "dead post" warning. |
| **Angle** | How a reply engages: **extends** (build on the point), **contrarian** (respectfully disagree), **debate** (open a real question). Every draft comes as one of each. |
| **Tier** | What the people layer knows about the author: **ally**, **mutual**, or **target** (on your 2–10× roster). A warm tweet from an ally beats a hot tweet from a stranger. |

**The queue only grows while you browse.** It's stored in the extension's own local storage, so it survives a browser restart, an extension reload and a service-worker recycle — it used to live in *session* memory, which Chrome drops on any of those, and a queue that collapsed mid-scroll was the result. Two things take a tweet out, and only two: **you dismiss it** (the ✕, Clear, or a curated pass's drops), or it **ages out after 24 hours** — a tweet you first saw yesterday isn't a reply opportunity today. Beyond 100 rows the least-recently-seen are evicted (pins last).

Drafted replies are also saved server-side and rehydrate into the queue the next time you open the panel, all three angles intact.

---

## Filling the queue

Three ways in, all free:

1. **Automatically, by browsing.** Any **hot** or **warm** tweet you scroll past on x.com is added. You don't do anything.
2. **Automatically, because it's your people.** A tweet by someone you've already replied to, or someone on your 2–10× target roster, is added even when the band says skip — as long as it's **less than 24 hours old**. Reach is not the point of those replies; the relationship is. These rows carry a quiet **`your circle`** chip.
3. **By hand, with ⊕.** Every tweet's action row on x.com carries a round **⊕ "Add to Radar"** button. It pushes that tweet into the queue whatever its band — a question you want to answer properly later, a stranger nobody has noticed yet. Pinned tweets get a **`manual`** band chip and rank at the very top.

**Row order:** manually pinned first (you asked for it), then who the author is (ally / mutual / target outranks a stranger), then band (hot, then warm, then `your circle`), then how fast the tweet is gaining views, then recency.

**Under pressure the queue keeps the loud ones.** It holds 100 rows; when it overflows, `your circle` captures are dropped first, then the oldest hot/warm sightings, and a ⊕ pin is dropped last. A talkative circle can't push the day's biggest opportunity out.

**Why 24 hours, and why not everyone you know:** "your circle" means *stage `engaged` or better* — someone you have actually posted a reply to — plus your target roster. It deliberately does **not** mean everyone stratus has a row for: simply hovering someone's name on the timeline files them away, and treating that as a relationship would put most of x.com in this queue.

---

## Header actions

- **Draft replies (N)** — makes **one** Grok call that drafts **three angle variants** (extends / contrarian / debate) for every un-drafted tweet in the queue (**20 at a time by default**). The cost of that single call is shown right after, e.g. `12/12 drafted · $0.0431`. It drafts the *top* N of the queue — the ranking decides, nothing is graded.
- **Curate & draft (N)** — the same thing, but it grades first. See below. **These two are the only buttons on the tab that spend money.**
- **Clear** — dismisses everything currently shown in the view you're looking at. Dismissed tweets never re-enter the queue, even though the page keeps re-sighting them while they're on screen.
- **⚙** — the batch sizes. Three numbers live in there: the radar's own **draft cap**, the **batch cap the server enforces**, and the **curated batch size**. A plain click sends the *lower of the first two*, so raising one past the other can't buy you a refused click; the third sizes a curated pass and is itself capped by the server's batch cap. What lands on the radar by band isn't here — it's the **Reply band** group in **Settings → Tuning**, the same thresholds the on-page border uses, which is why the border can never promise a draft the server then refuses. (⊕ pins and fresh posts by your circle get in regardless of those thresholds — see the three ways in, above.)

---

## Curate & draft — spend on the best 25, not the newest 25

After a long scroll session the queue holds 40+ tweets, and "Draft replies" spends on whatever ranked first. Ranking is about *heat and who posted it* — it can't see that a tweet is a "drop a link, let's connect" thread with nothing to reply to. So once the queue outgrows one curated batch, a second button appears next to the first:

**Curate & draft (25)** — one cheap scoring call grades **every fresh tweet in the queue** for reply payoff ("if I write one sharp reply under this, will it earn impressions and profile visits for *me*?"), then:

1. Everything flagged as **filler** is **dismissed from the queue** — connection invites, follow trains and pods, giveaways, contentless engagement bait, bare announcements with nothing to add to.
2. Everything below the cut is dismissed too. Only the **top 25** (or whatever the knob says) survive.
3. Those survivors get the normal 3-variant batch draft — one Grok call, exactly as before.

**Your ⊕ pins are never scored away.** A tweet you pinned by hand isn't sent for grading at all, and it's always in the draft set, ahead of the curated survivors. A deliberate human click outranks the model. `roster`, `hot` and `warm` rows all get graded — content quality is exactly the thing the band numbers can't see.

**The button only appears when the queue is bigger than the curated size.** Below that, "Draft replies" already covers everything and grading would be a second call that changes nothing.

**Two calls, one price line.** The note under the header reports the whole click:

| You see | It means |
|---|---|
| `scored 42 · dropped 17 · drafted 25/25 · $0.0491` | The normal, good outcome. |
| `scored 38 · 4 unscored · dropped 17 · drafted 21/21 · $0.0463` | The model's answer came back short. **The 4 it never graded are neither drafted nor dismissed** — they stay in the queue. A degraded answer costs you coverage, never queue rows. |
| `scored 42 · dropped 42 · nothing left to draft · $0.0051` | Everything graded as filler. You paid for the grading only. |
| `scored 42 · dropped 17 · draft failed: … · $0.0051` | The drafting call failed *after* the drops. **The drops stand** — they were dismissed on their own merit, not as a side effect. The grading spend is still reported. |
| `Curate failed: …` | The grading call itself failed. **Nothing was dismissed and nothing was drafted** — you can't lose queue rows to a call that never answered. |
| `nothing to grade — 4 ⊕ pinned, 31 with no text · use Draft replies` | The queue is long enough for the button, but none of it is gradeable: every fresh row is either a ⊕ pin (never scored, by design) or has no text to score. **Nothing was spent** — the call was never made. |

**Dismissal is permanent.** Dropped tweets go onto the same dismissed list the **✕** button uses, so they don't come back when you scroll past them again. That's the point — but it does mean a curated pass is a decision, not a filter you can undo. If the queue feels over-culled, the size knob is in **⚙** (**Curated batch size**, also in **[Settings → Tuning → Radar](./settings-tab.md)**): 5 to 50, default 25, and the effective size is always the *lower* of it and the batch reply cap.

**Rows with no text are left alone.** An image-only sighting has nothing to grade and nothing to reply to, so it's skipped by both halves of the pass and stays in the queue.

The rubric itself — what earns a high score, and the exact list of what counts as filler — is an editable prompt: **[Settings → Prompts → reply curation](./settings-tab.md#prompts-editor-the-prompts-subtab)**. It's the only prompt in stratus that *removes* things rather than writing them, so widening its filler list throws more of your queue away. Both the default size and that list are **opening guesses**; change them from what you see in your own measured reply outcomes, not on a hunch.

---

## The two views

- **Queue** — the not-yet-worked opportunities, split into **Reply ready** (drafts waiting) and **New** (no reply yet). "Draft replies" only ever spends on the **New** group.
- **Clicked** — tweets whose reply you've already taken. They move here so the queue stays the fresh set.

---

## A row, part by part

- A **band chip** — `hot`, `warm`, `manual`, or a muted `your circle` (hover it: it explains that the row is here for the person, not the numbers).
- The **author** — click to open their dossier in the People tab.
- A **tier chip** if they're on your roster (`ally`, `mutual`, `target`) — also a dossier link. This is *why* they outrank a louder stranger.
- **reply ready** once a draft exists.
- **✕** to dismiss the row (done, or not worth it).
- The **tweet text**, as a link — clicking it just opens the tweet on X.
- A **"why" line**: `1.5k views · 8 replies · 22m · 70/min · bait` — the signals behind the band verdict. The age keeps ticking while the row sits in the queue, so a stale opportunity looks stale.
- **Angle tabs** (once drafted) — `extends` · `contrarian` · `debate`, each with that variant's **coach score** (hover the number for the worst two things about it — see **[Replies → the three variants](./replies-tab.md#generating-and-the-three-variants)**). Click a tab to read that version; nothing else happens. The score never reorders the tabs.
- **The reply body** — the angle currently selected. **Clicking it does the whole handoff:** copies that exact text to your clipboard, opens the tweet in a new tab, and moves the row to **Clicked**. The hint under the text says `click → copies + opens the tweet`, and flips to `copied ✓` for a moment after — or to `copied ✓ · jitter: prefix, typo:swap` / `copied ✓ · no jitter this time` when **Humanize picks** is on (below).
- A **channel tag picker** (once a reply exists) to file the tweet under one of your topic channels.

The angle you click is the one recorded as what went out — so the Playbook's angle numbers reflect what you actually chose, not always the first variant.

Empty states: *"Browse X — hot/warm tweets you scroll past queue up here."* (Queue) and *"Replies you copy land here — most recent first."* (Clicked).

---

## Humanize picks

Under the Queue/Clicked strip sits a checkbox: **Humanize picks**, with the odds next to it (`~56% of picks come out changed` at the default chances). Off by default.

With it on, the angle you click is roughened on the way to your clipboard — a leading `honestly,`, a trailing `well said`, a lowercased first word, a dropped final period, or a small typo. Handles, names and links are never touched. The hint line then names what fired, so the feature is never silently doing nothing.

Two things it deliberately does **not** do:

- **It never rewrites the stored draft.** The variants on the row stay exactly as Grok wrote them, so re-reading the card shows the real draft and the coach scores stay meaningful. What the jitter produces is recorded only as *what actually went out* — the same field a hand-edit lands in.
- **It doesn't re-roll.** The jitter is decided at the moment you click; the row keeps showing the stored text afterwards.

**So the Clicked list shows the verbatim variant, not the text you pasted.** That's the same rule seen from the other side, not a bug: the jittered version lives in your reply history (**[Replies](./replies-tab.md)**), because that's where "what actually went out" belongs. If you re-copy a row from Clicked, the jitter is rolled again — it's a fresh pick.

The chances and the prefix/suffix pools are project-level (shared by any surface that picks one up) and live server-side, so the checkbox survives a panel close and an extension reinstall. Edit them in **[Settings → General → Reply humanizer](./settings-tab.md#reply-humanizer)**: the two pools one entry per line, the five chances as numbers from 0 to 1, and a **Reset to defaults** that deletes the stored config outright — which also turns this checkbox off, since it's the same setting. Each canned **reply list** still keeps its own separate humanizer override.

If the panel can't reach the server when the tab mounts, the checkbox renders **disabled** and picks stay verbatim. Decoration never breaks the queue.

---

## On the tweet page: the angle chips

When you open a drafted tweet on x.com, the same three angles appear as a small chip strip on that tweet's action row — so you don't have to switch back to the panel to change your mind.

**Clicking a chip copies that variant to your clipboard and nothing else.** The hint reads *"Copied — press ⌘V in the reply box."* Paste it yourself and hit Reply.

It used to type the text straight into X's reply box. That was removed: X's composer is a rich-text editor that re-renders from its own model, and a fill that half-lands leaves a mangled draft you have to clear by hand — worse than the one keystroke it saved. The clipboard always works.

Clicking a chip also marks that draft **posted** on the server (a human claim at copy time, exactly like Reply Master's **Done**), which is what pulls the reply into your measured history: outcomes, angle effectiveness, reply latency, and the daily quota. If you copy and then decide not to send it, your quota reads one high until the next day.

---

## Workflow: work the Radar

1. Browse X normally for a while. Hot and warm tweets — plus fresh posts by your circle — accumulate here on their own ($0). Hit **⊕** on anything else you want in the queue regardless of band.
2. Open **Radar**. Skim the **why** lines and dismiss (**✕**) whatever isn't worth it *before* drafting — you don't pay for tweets you dropped.
3. Click **Draft replies (N)** — one Grok call, cost shown afterwards. If the queue got long enough for **Curate & draft (N)** to appear, prefer it: it does step 2's culling for you and puts the drafting money on the tweets most likely to pay.
4. For each **reply ready** row: read the three angle tabs, click the body of the one you want. It's copied and the tweet opens.
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
- **The ⊕ is the escape hatch from the band rules.** If the classifier keeps skipping something you'd have replied to, pin it — and if that happens a lot, the thresholds are editable in **Settings → Tuning → Reply band**.
- **A pinned tweet never pollutes your analytics.** `manual` is queue metadata, not a band verdict: pinned rows are excluded from the Playbook's hot/warm comparisons, because you chose them for reasons the classifier can't see. **`your circle` works the same way** — it says who posted it, not how it did.
- **`your circle` rows are the reciprocity lane's other half.** The Today tab counts how many of today's replies went to people who were already yours (*"N replies to your people"*); this is where those replies come from. A quiet post by an ally is worth more to you than a hot post by a stranger, and neither the band nor the reply gate will stop you any more.
- **Every handle is a link.** Before replying to someone you half-recognize, click through to their dossier and see the history first.
- **What this tab costs.** Capturing, ranking and rendering the queue: **$0**. The spend is the two drafting buttons: **Draft replies** (one Grok call per click, price shown after) and **Curate & draft** (a cheap scoring call *plus* that same drafting call — two prices, reported as one total). See **[Spend today](./today-tab.md)** on Today for the running meter.

---

## See also

- **[Today](./today-tab.md)** — the rest of the daily loop: quests, follow-ups, conversations, quota.
- **[Replies](./replies-tab.md)** — Reply Master (one tweet, deeper context) and the canned reply lists.
- **[Playbook](./playbook-tab.md)** — which angles and which situations actually earn views and profile visits.
- **[On x.com itself](./s6-augmented-ui.md)** — the ⊕ button, the band border, the timeline chips and the context panel.
- **[Settings → Tuning](./settings-tab.md)** — the Reply band thresholds, the two batch caps and the curated batch size.
- **[Settings → Prompts](./settings-tab.md#prompts-editor-the-prompts-subtab)** — `reply curation`, the rubric that decides what counts as filler.
