# Composer Tab

The **Composer** is where you write, AI-draft, and schedule your own original posts and threads. You type (or let Grok draft) a tweet, optionally pick when it goes out, and save it. Nothing is ever published the moment you save — a post only goes live when it has a scheduled time and the background publisher reaches that minute. Everything else sits safely as a **draft** until you decide.

---

## What it's for and where it fits

stratus follows a simple posting doctrine: most of your activity on X is *replies* to other people, and a smaller share (think "the 30%") is your own *original* content. The Composer is the home for that original side — single posts and multi-tweet threads that you plan ahead of time instead of writing in the moment.

Use the Composer when you want to:

- Write a post now and schedule it for later today or this week.
- Have Grok (the AI) draft three different versions of an idea so you can pick the best one.
- Build a thread (a chain of connected tweets).
- Turn a saved tweet's structure into a fresh post of your own (a "remix").
- Edit or reschedule something you already queued.

The reply side of the doctrine lives in other tabs (Reply Master, Radar, Conversations). The Composer is strictly for things *you* originate.

---

## Single-post mode

When you open the Composer fresh, you are in single-post mode: one tweet, one text box.

### The text area and the counter

Type your post into the large **Text** box. Next to the "Text" label is a **counter** showing how many characters you have left out of X's 280-character limit. As you type it counts down: it turns amber inside the last 20 characters, then red with a negative number once you're past 280.

You can paste more than 280 characters (the box accepts a long blob on purpose). When a single post is over the limit, a warning appears:

> ⚠ *N*/280 — too long for one tweet. **Split into thread (N)**

Clicking **Split into thread** breaks your text into a clean chain of tweets at natural boundaries (paragraphs first, then sentences, then words), switches you into thread mode, and tells you how many segments it made. This is the easy way to turn a long draft into a proper thread.

### Improve with AI (rewrite assist)

Under the text box is an **Improve with AI** button. It takes whatever you've written and asks the AI for **three sharper versions** of it — typically a tightened cut, a re-hooked opening, and a restructured take. You can add an optional instruction ("make it punchier", "lead with the number") to steer the rewrite. Each version comes back as a card you can preview; clicking one **replaces the text in the box** with that version (nothing is saved to your Calendar — it just edits your draft in place, so you're free to keep editing or undo by rewriting). It's one AI call (~$0.003) and it runs on whichever provider you picked in **Settings → AI**.

### Scheduling controls

The scheduling controls live under a **Schedule** heading, with a small **⚙** on that heading — see "Tuning the cadence from the Composer" below. All times are shown and entered in *your* local time zone.

Below the text is **Scheduled for (local time)**.

- **The date/time picker** — click it to choose any date and time by hand.
- **Best time** — fills in the best open posting slot based on how your past posts at different times actually performed (see "How slots are chosen" below). The minute is always slightly randomized (for example 17:14, never 17:00) so your posts never look robot-scheduled. A short note tells you which slot it picked and its average views.
- **Next slot** — fills in the *earliest* open posting slot, ignoring performance history. Use this when you just want the next available time.
- **The ✕ button** (appears once a time is set) — clears the time. A post with no time is saved as a **draft**.

Under the picker you'll see one of three hints for the day you're scheduling:

- A **best-times line**, e.g. *"Best Wed: 17:xx **2.1k**/day (n=6) · 09:xx **1.4k**/day (n=4)"* — the top-performing hours for that weekday, with `n` being how many of your posts were measured in that slot. The `xx` in the hour is a reminder that the exact minute will be jittered.
- A **"so far" line** when hours *have* been measured but none has enough posts to clear the gate yet, e.g. *"Wed so far: 17:xx (n=2) · 09:xx (n=1) — need 3 in a slot before it counts as advice."* Those hours are shown dimmed on purpose: they're evidence that data is accumulating, not a recommendation.
- Or *"No measured best-time for Wed yet (need ≥3 posts in a slot)"* — shown when that weekday has no measured posts at all. stratus deliberately won't give you "advice" from thin data.

The number in both lines is the **best-time gate** (3 by default) and it's editable — it's one of the knobs behind the ⚙ on the Schedule heading, and the same number the Today tab's cadence gaps use.

Below the measured hint you may also see **audience** lines, drawn from the X Analytics activity heatmap you captured (see [Settings → Sightings/passive capture](./settings-tab.md)):

- *"Audience peak Wed: 17:xx, 20:xx"* — the hours your **audience** is most active on X that weekday. This is softer than your own measured history: when **Best time** ranks slots, a measured own-time always wins; audience activity only breaks ties among hours with no measured signal, and it's labelled so you know which is which. Dead (zero-activity) hours are never shown as peaks.
- A **staleness nudge** — if your last heatmap capture is older than ~4 weeks (or you've never captured one), a line reminds you to revisit **X Analytics → Audience** so the audience advice stays current. Capture is passive: stratus reads the heatmap only when you happen to visit that page (with Sightings on).

A small line under everything states what will happen when you save: *"Will save as pending and ship at this minute"* if a time is set, or *"Empty → saved as draft"* if it isn't.

#### Publish mode: API or Manual

For a **single post** (not a thread), a small **API | Manual** toggle sits with the scheduling controls:

- **API** (default) — the background publisher posts it for you automatically at its minute. This is the normal path.
- **Manual** — *you* paste the post into X by hand at its slot, then mark it posted (from the Calendar or the Today reminder). Nothing is sent through the API, so **there is no cost** (the cost line reads *"$0 · you paste it"*) and, crucially, **the link surcharge doesn't apply** — a manual post may contain a URL freely. stratus auto-selects Manual when the post carries a **Studio visual** (the API can't attach media), and a scheduled time is required either way (there's nothing to remind you about without one).

The toggle never appears in **thread** mode — threads are always API-published (there's no manual thread). Switching an existing post between API and Manual just changes how it will publish; its text and time are untouched.

#### How slots are chosen

stratus works from a light daily cadence of a few posts at set anchor hours — by default **3 posts a day at 9:00 / 13:00 / 18:00**, or **4 a day at 8:00 / 12:00 / 16:00 / 20:00** once a day already has four posts queued. Both **Best time** and **Next slot** look at what you already have scheduled over the next 7 days, figure out which anchor hours are still open, and pick one — Best time by past performance, Next slot by earliest. If every anchor for the next week is already taken, you'll get a message saying there's no open slot.

#### Tuning the cadence from the Composer

The **⚙** on the **Schedule** heading opens the four numbers that drive all of the above, without a trip to Settings:

- **3/day anchor hours** and **4/day anchor hours** — comma-separated local hours (e.g. `9, 13, 18`). They commit when you click away or press Enter.
- **Ladder switch-at** — how many filled slots a day needs before the 4/day ladder takes over.
- **Best-time cell gate** — measured posts an hour needs before it can be recommended.

These are the same knobs as **Settings → Tuning**, written to the same place: change one here and the Calendar's ghost slots, the Today tab's cadence gaps and the daily brief all move with it (the panel picks the change up within a few minutes, or immediately when you reopen it). A note in the popover states what the gear *doesn't* hold: these are the anchor **hours**, not the quota — how many originals a day you owe lives in Today's quests, and the reply band comes from your niche.

### The cost preview

Above the Save button, when there's a cost to show, you'll see a live estimate like **≈ $0.015**. This is what publishing the post will bill against your X API budget. A normal post costs about **$0.015**. A post with a **link (URL) in it costs $0.20** — roughly 13× more — because of how X prices link posts. If your text contains a URL, the preview turns into a warning and shows that surcharge (see Tips below for how to avoid it).

In **Manual** publish mode the estimate reads **$0 · you paste it** and the link warning disappears — a hand-posted tweet never hits the API, so it's free and can hold a link. Manual mode is the sanctioned $0 way to post something with a link.

### Saving

- **Save** — stores the post. If you set a time, it saves as **pending** (queued to publish at that minute). If you left the time empty, it saves as a **draft** you can schedule later.
- After saving, the Composer clears so you can write the next one.

The resulting post appears on your Calendar with the matching status.

### Schedule-time warnings

After a **pending** post saves, you may see one or more **amber lines** under the confirmation. They are advice, never a refusal — the post is already saved, and the only thing that can ever *block* a save is the URL surcharge guard. There are three:

- **"N other pending posts within 45 min of this slot — the closest is X min away."** Your calendar is bunching up. The publisher jitters its minutes precisely so your posting doesn't look mechanical; two slots twenty minutes apart undoes that.
- **"Very similar to a post from N days ago (92% overlap) — repetitive content is its own penalty."** You've published something close to this within the last two weeks. X down-ranks repetition on its own.
- **"Very similar to another post already queued (100% overlap) — they will read as a repeat when both go out."** The twin isn't published yet, it's sitting in your queue. This is the useful one: it's the only moment a duplicate is still one edit away from being fixed. Once both are out, all anyone can do is note it.

The same thresholds drive the **Account health** card on the [Today tab](./today-tab.md) — the Composer warns you *before* the risk exists, Today tells you *after*. They can never disagree, because both read the same numbers.

Two things they deliberately don't do: a **draft** gets no warnings (nothing is scheduled to happen yet), and **editing** an existing post doesn't re-check (the advisory rides the initial save only).

---

## AI drafting (draft with AI)

Below the scheduling controls, when you're writing a *new* post (not editing an existing one), there's an AI drafting section. This asks the AI to write posts for you.

> **Which model?** All AI drafting here — the three-draft generator, the thread drafter, and the rewrite assist — runs on the provider you selected in **Settings → AI** (Grok by default, or an OpenRouter model like Claude/GPT/Gemini). The cost preview and cost dashboard show the exact spend under that provider. Everything below works identically whichever model you use.

### The pillar dropdown

**Pillar** lets you steer which of your content themes ("pillars") the drafts should belong to. Leave it on **"any pillar (Grok declares)"** to let the AI choose, or pick a specific pillar from the list (the list is your own editable set of pillars, managed in the Voice tab). Each draft it returns is tagged with the pillar it belongs to.

### The idea steer and the Idea Inbox dropdown

You can optionally give Grok a starting point:

- **Idea (optional, Romanian OK)** — a free-text box where you describe what you want to post about. You can write this in Romanian; the drafts come back in English. It's just a seed — the AI expands it into full posts.
- **Seed from Idea Inbox (optional)** — a dropdown of the open ideas you've saved to your Idea Inbox (captured elsewhere in the extension or via the right-click "Send selection to stratus ideas" menu). Picking one drops its text into the Idea box for you. When a draft is generated from an Idea Inbox pick, that idea is automatically marked **consumed** and gets linked to the post it seeded — so you can later see "this post came from that Monday idea." Emptying the Idea box before generating unlinks the inbox idea again.

Both are optional. With neither filled in, Grok drafts from your general voice and your best-performing past posts.

### Generating and picking a draft

Click **Generate 3 drafts (~$0.01)**. Each click makes one Grok call (roughly a cent) and returns **three register-distinct drafts** — three takes on the same idea in different tones:

- **plain** — straightforward.
- **spicy** — punchier, more opinionated.
- **reflective** — more thoughtful.

Each draft is shown as a card with its **register** badge, its **pillar** badge, a character count, and the full text. A line above the cards notes how many "winners" (your top past posts) were used as voice anchors and the exact cost.

For each card you can:

- **Use this →** — opens that draft in the editor so you can set a time and schedule it. The draft already exists on your Calendar as a `draft` row, so this just promotes it — no round-trip through the Calendar tab.
- **More like this** — feeds that draft back to Grok as the seed for three fresh takes, so you can iterate toward the tone you want.

All three drafts land on your Calendar as `draft` rows the moment they're generated. When you pick one with **Use this →**, the other two stay parked as drafts. If you regenerate, the previous unpicked drafts are cleaned up so your Calendar doesn't fill with orphans. **Nothing posts until you schedule it.**

---

## Thread mode

A **thread** is a chain of connected tweets that post one after another as self-replies. Switch to thread mode with the **Thread** button in the header (it flips to **Single post** to switch back).

### Building segments

In thread mode you get a list of **segments**, each its own tweet with its own 280-character counter (shown as position, e.g. `1/3`, plus characters remaining). Start with at least two:

- **The first segment is the hook.** Its placeholder reminds you: *"Hook — no links here ($0.20 surcharge)."* Keep links out of tweet 1.
- **Later segments accept links freely** — a link in a reply doesn't carry the surcharge.

Each segment has controls:

- **↑ / ↓** — reorder the segment up or down.
- **✕** — remove the segment (you can't go below two).
- **+ Add segment** — add another tweet to the chain.

A running total under the list shows how many segments have content and the combined character count.

### Draft thread with AI

In thread mode there's a **Draft thread with AI** button that writes the whole chain for you from a single idea. Give it an idea (the same idea box and pillar dropdown as the single-post drafter — Romanian is fine, the thread comes back in English), optionally say how many tweets you want, and it develops the idea across 4–8 tweets in one AI call (~$0.008, on your **Settings → AI** provider). The result lands on your Calendar as a `draft` head tweet plus `segment` tails sharing a thread id, and opens right here in thread mode so you can reorder, edit, or trim before scheduling. As with every AI surface, **nothing posts until you schedule it.**

### Move link to first reply

If you're in single-post mode and your text contains a link, a warning offers **Move link to first reply ($0.030)**. Clicking it strips the URL out of your post, puts your text as tweet 1 and the link as tweet 2, and switches you to thread mode. This turns a **$0.20** link post into a **~$0.030** thread — the same content, a fraction of the cost, because the link now rides in a reply instead of the main tweet.

### How a thread schedules

Set a time on the thread the same way as a single post (date picker, Best time, or Next slot — the time lives on the first tweet). When you save, the whole chain is created together: the first tweet is the schedulable head, and the rest are queued as segments sharing one thread. At publish time the background worker posts the head, then each following tweet as a reply to the previous one, a fraction of a second apart. Each segment bills the normal ~$0.015; if one segment fails to post, the rest of the chain freezes rather than posting a broken thread.

A thread with a link in the *first* tweet is rejected when you try to schedule it — move the link to a later segment first.

---

## Remix from Voice, and editing an existing post

The Composer also opens pre-loaded from two other places:

### Remix from Voice

In the **Voice** tab (your swipe file of other people's tweets), the **Remix** button on a saved tweet sends you to the Composer with that tweet's *structure* queued as a drafting seed. You'll see a line reading *"remixing structure of tweet …"* with a ✕ to cancel it. When you generate drafts, Grok reuses the saved tweet's **shape** (its hook style, rhythm, line breaks) to write brand-new posts in your own words — it borrows the skeleton, never the content.

### Editing an existing post

Arriving from the **Calendar** tab's **Edit** button (or by clicking **Use this →** on a generated draft) loads that post into the Composer with its text and schedule already filled in. The header changes to **Edit post** (or **Edit thread**), and a status line shows the post's current state — its status, whether it's part of a thread, its pillar, its posted tweet ID, any error, and "seeded by idea" if it came from the Idea Inbox.

While editing you can:

- Change the text and reschedule. Clearing the time turns a pending post back into a draft; adding a time to a draft promotes it to pending.
- **Delete** the post (with a confirmation). Deleting a thread's head deletes the whole thread.
- **New** (header button) — abandon the edit and start a fresh post.

A post that has already **posted** or is currently **publishing** is locked: its text and schedule can't be changed, and Save/Delete are disabled. In a thread being edited, only the segments that have already gone out are locked; the rest stay editable.

---

## Common workflows

**Draft three options with AI and schedule the best one**
1. In a new post, optionally set a Pillar and type an Idea (or pick one from the Idea Inbox).
2. Click **Generate 3 drafts**.
3. Read the plain / spicy / reflective cards; click **More like this** on the closest one if you want to iterate.
4. Click **Use this →** on your favorite, click **Best time** to pick a strong slot, and **Save changes**. The other two stay as drafts on the Calendar.

**Write a thread with a link**
1. Click **Thread**.
2. Write your hook in segment 1 (no link), your points in the middle segments, and put the link in the last segment.
3. Reorder with ↑/↓ if needed, set a time, and **Save**.
   (Or: write it as one long single post with the link, then click **Move link to first reply** to auto-convert it into a link-friendly thread.)

**Schedule at the best historical time**
1. Write or draft your post.
2. Click **Best time**. The Composer fills the highest-performing open slot for the coming week, with a jittered minute, and tells you the slot's average views.
3. **Save** — it's queued as pending.

**Turn a saved tweet's structure into a new post**
1. In the **Voice** tab, click **Remix** on a tweet whose shape you like.
2. Back in the Composer, optionally add an Idea steer, then **Generate 3 drafts** — they'll follow that tweet's structure in your own words.
3. **Use this →**, schedule, and **Save**.

---

## States you'll see

- **Loading** — when opening a post to edit, the form briefly loads it. The Save button shows *"Saving…"* while a save is in flight, and the drafter shows *"Drafting…"* while Grok works.
- **Empty / disabled Save** — Save stays disabled until there's something valid to save: a non-empty single post within 280 characters, or a thread with at least two filled segments.
- **Over the limit** — a single post over 280 characters shows the *"too long for one tweet"* warning with a **Split into thread** shortcut.
- **Link warning** — a URL in a single post (or a thread's first tweet) shows the **$0.20 surcharge** warning, with the **Move link to first reply** shortcut in single-post mode.
- **No open slot** — if every cadence anchor for the next 7 days is filled, **Best time** / **Next slot** report there's no open slot.
- **Validation / save errors** — if the server rejects a save (for example a link left in the first tweet of a thread), the reason appears in red above the buttons.
- **Locked post** — an already-posted or currently-publishing post shows its text greyed out and its controls disabled.
- **Success notices** — green lines confirm actions like a completed split, a moved link, or the slot that Best time chose.

---

## Tips and good to know

- **Drafts never auto-post.** A post goes live only when it has a scheduled time (status **pending**) and the publisher reaches that minute. Anything without a time — including all AI drafts as generated — just waits on the Calendar.
- **AI drafting costs about a cent per click.** Each **Generate 3 drafts** (and each **More like this**) is one Grok call, roughly $0.01. The exact cost is shown after each generation. Publishing itself is separate (~$0.015 per tweet).
- **Watch the link surcharge.** A link in your main post costs **$0.20** vs **$0.015** without one — the single biggest per-post cost. Use **Move link to first reply** (single posts) or put the link in a later thread segment to pay the cheap price. The Composer warns you before you save.
- **Minute jitter is intentional.** Best time and Next slot always pick a slightly off-the-hour minute (like 8:17 instead of 8:00) so your schedule doesn't look automated. That's why the best-times hints show the hour as `HH:xx`.
- **Best-times advice needs history.** Time recommendations only appear once a weekday-and-hour slot has at least three measured posts (the gate, editable from the Schedule ⚙). Until then you'll see the dimmed "so far" hours or "no measured best-time yet," and **Best time** falls back to audience peaks, then to the earliest open slot.
- **Ideas from the Inbox get tracked.** Seeding a draft from an Idea Inbox pick marks that idea consumed and links it to the resulting post, so you can trace where a published post's idea came from. Free-typed ideas aren't tracked this way.
- **Regenerating cleans up after itself.** Generating a new set of drafts removes the previous unpicked ones, so your Calendar doesn't accumulate throwaway drafts.
