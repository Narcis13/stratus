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

Type your post into the large **Text** box. Next to the "Text" label is a **counter** showing how many characters you have left out of X's 280-character limit. As you type it counts down; if you go past 280 it turns red and shows a negative number.

You can paste more than 280 characters (the box accepts a long blob on purpose). When a single post is over the limit, a warning appears:

> ⚠ *N*/280 — too long for one tweet. **Split into thread (N)**

Clicking **Split into thread** breaks your text into a clean chain of tweets at natural boundaries (paragraphs first, then sentences, then words), switches you into thread mode, and tells you how many segments it made. This is the easy way to turn a long draft into a proper thread.

### Scheduling controls

Below the text is **Scheduled for (local time)** — all times are shown and entered in *your* local time zone.

- **The date/time picker** — click it to choose any date and time by hand.
- **Best time** — fills in the best open posting slot based on how your past posts at different times actually performed (see "How slots are chosen" below). The minute is always slightly randomized (for example 17:14, never 17:00) so your posts never look robot-scheduled. A short note tells you which slot it picked and its average views.
- **Next slot** — fills in the *earliest* open posting slot, ignoring performance history. Use this when you just want the next available time.
- **The ✕ button** (appears once a time is set) — clears the time. A post with no time is saved as a **draft**.

Under the picker you'll see one of two hints for the day you're scheduling:

- A **best-times line**, e.g. *"Best Wed: 17:xx **2.1k**/day (n=6) · 09:xx **1.4k**/day (n=4)"* — the top-performing hours for that weekday, with `n` being how many of your posts were measured in that slot. The `xx` in the hour is a reminder that the exact minute will be jittered.
- Or *"No measured best-time for Wed yet (need ≥3 posts in a slot)"* — shown until you have enough measured history. stratus deliberately won't give you "advice" from thin data.

A small line under everything states what will happen when you save: *"Will save as pending and ship at this minute"* if a time is set, or *"Empty → saved as draft"* if it isn't.

#### How slots are chosen

stratus works from a light daily cadence of a few posts at set anchor hours — roughly **3 posts a day at 9:00 / 13:00 / 18:00**, or **4 a day at 8:00 / 12:00 / 16:00 / 20:00** once a day already has four posts queued. Both **Best time** and **Next slot** look at what you already have scheduled over the next 7 days, figure out which anchor hours are still open, and pick one — Best time by past performance, Next slot by earliest. If every anchor for the next week is already taken, you'll get a message saying there's no open slot.

### The cost preview

Above the Save button, when there's a cost to show, you'll see a live estimate like **≈ $0.015**. This is what publishing the post will bill against your X API budget. A normal post costs about **$0.015**. A post with a **link (URL) in it costs $0.20** — roughly 13× more — because of how X prices link posts. If your text contains a URL, the preview turns into a warning and shows that surcharge (see Tips below for how to avoid it).

### Saving

- **Save** — stores the post. If you set a time, it saves as **pending** (queued to publish at that minute). If you left the time empty, it saves as a **draft** you can schedule later.
- After saving, the Composer clears so you can write the next one.

The resulting post appears on your Calendar with the matching status.

---

## AI drafting (draft with Grok)

Below the scheduling controls, when you're writing a *new* post (not editing an existing one), there's a **Draft with Grok** section. This asks the Grok AI to write posts for you.

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
- **Best-times advice needs history.** Time recommendations only appear once a weekday-and-hour slot has at least three measured posts. Until then you'll see "no measured best-time yet," and **Best time** simply falls back to the earliest open slot.
- **Ideas from the Inbox get tracked.** Seeding a draft from an Idea Inbox pick marks that idea consumed and links it to the resulting post, so you can trace where a published post's idea came from. Free-typed ideas aren't tracked this way.
- **Regenerating cleans up after itself.** Generating a new set of drafts removes the previous unpicked ones, so your Calendar doesn't accumulate throwaway drafts.
