# Calendar Tab

The **Calendar** tab is your posting week at a glance. It shows everything you have lined up to publish over the next seven days as a **week board** — one column per day, side by side — plus the empty time slots worth filling and any drafts you haven't scheduled yet. Each scheduled item shows when it's set to go out, its current status, and a preview of the text. This is where you review what's coming, drop a draft onto a good slot, jump in to edit a post, mark a hand-posted one as done, or remove something before it publishes. You don't write posts here — you plan them here.

---

## What it's for / where it fits

stratus splits post *creation* from post *management*:

- The **Composer** tab is where you write a post (or a thread), pick a time, choose API or Manual publishing, and save it. It's also where AI-drafted posts are generated.
- The **Calendar** tab is where everything you've saved shows up as a week you can plan against — see the plan, fill gaps, make changes, and confirm posts actually went out.

Think of the Composer as the pen and the Calendar as the planner. When you want to change or delete something you already saved, you start on the Calendar and it hands you back to the Composer to make the edit.

Behind the scenes, a small **background publisher** runs on the server around the clock. Roughly once a minute it checks for posts that are scheduled the **API** way and due, and publishes them to X automatically — you don't need the extension or browser open. **Manual** posts are different: the publisher never touches them; you paste them into X yourself at their slot (the Today tab reminds you), then mark them posted. The Calendar is how you watch both kinds.

---

## Reading the week board

### The seven day columns

The board shows a **rolling seven-day window** starting with today, as seven columns you can scroll **left-to-right**. Today is the first column. Each column header shows the weekday, the date, and a count of how many posts land that day.

Within a column you'll see two kinds of tile, newest schedule first:

- **Scheduled posts** — the things you've queued for that day (see the status badges below).
- **Ghost slots** — faint, empty time slots that stratus suggests are worth filling. They're not posts; they're openings (see **Filling gaps** below).

A post appears in the column its **scheduled time** falls on, shown in **your local time zone**. Below the seven columns sits the **Drafts tray**: posts you've saved but haven't given a time yet (including drafts the AI drafter produced). Because they have no time, they can't land on any day — they wait in the tray until you schedule them.

> **Good to know:** The window looks forward from today. A post that already published earlier today still shows in Today's column (marked posted), but posts from *yesterday or earlier* have scrolled out of the window. To review older history and performance, use the **Today** and metrics views.

### What a scheduled tile shows

Reading a tile: the scheduled **time** (local), a **status badge**, a preview of the **text**, and small chips for anything special:

- **manual** — this post publishes by hand, not through the API (you paste it into X yourself).
- **🧵 thread** — part of a multi-tweet thread.
- **re-up** — a quote-tweet re-share of one of your own earlier posts.
- **visual** — a Studio image was made for this slot; because the API can't attach media, it must be posted manually with its PNG.
- **pillar** — the content pillar (topic) the post was tagged with.

Clicking a tile opens that post in the Composer to edit.

### What each status means

| Status | Meaning | Who controls it |
|---|---|---|
| **draft** | Saved but not scheduled — it will **never** post on its own. Drafts are allowed to contain links. | You |
| **pending** | Scheduled the **API** way and armed. The background publisher posts it automatically at its minute. | You (until it's due) |
| **manual** | Scheduled but published **by hand** — the publisher never posts it. You paste it into X at its slot and hit **Mark posted**. Manual posts *are allowed to contain links* (posting by hand avoids X's link surcharge). | You |
| **segment** | A follow-on tweet in a thread (tweet 2, 3, …). The publisher posts these as replies right after the thread's first tweet. | Mostly automatic |
| **publishing** | The publisher has claimed this post and is sending it to X right now. **Locked** so it can't post twice. | Background publisher |
| **posted** | Successfully published (whether via the API or marked posted by hand). **Locked**. | Publisher / you |
| **failed** | The publisher tried and X rejected it. Kept so you can fix and reschedule. | You (to fix/retry) |
| **cancelled** | You cancelled it so it won't post. | You |

**The short version:** *draft*, *pending*, *manual*, *failed*, and *cancelled* are yours to edit. *publishing* and *posted* are read-only.

### Overdue manual posts

A **manual** post whose slot time has already passed and that you *haven't* marked posted yet is tinted as **overdue** — a nudge that X is still waiting for you to paste it. Post it, then hit **Mark posted** on the tile and the overdue tint clears.

---

## Filling gaps — ghost slots and the drafts tray

The board doesn't just show what's queued; it shows where the *openings* are and helps you fill them.

### Ghost slots (suggested openings)

The faint, empty tiles in each column are **ghost slots** — hours stratus thinks are worth posting into, based on two signals it may shade differently:

- **A measured best time** (solid accent, with a small score) — an hour where *your own* posts have historically done well.
- **An audience-active time** (soft fill, labelled **"aud"**) — an hour when your audience is active on X, from the heatmap captured on X Analytics. This is softer advice: it never outranks a measured own-time, and dead hours are never shown as peaks.
- **A plain cadence slot** (neutral dashed) — a sensible opening with no strong signal either way.

Ghost slots aren't posts and never publish anything on their own. They only become clickable once you **arm a draft** (below).

### Scheduling a draft from the tray

Each draft in the tray has two quick actions:

- **→ best slot** — stratus picks the best open slot in the week (respecting measured and audience signals and avoiding taken slots) and schedules the draft there in one click. A draft with a Studio visual is scheduled **manual** (it needs a hand-post); a plain one is scheduled **pending** (API). If the draft's text contains a link, scheduling it *pending* is refused — you'll see an inline nudge to **switch to Manual** (manual posts may hold links).
- **edit** — opens the draft in the Composer.

You can also place a draft **exactly**: click a draft to **arm** it (it highlights), then click any **ghost slot** to drop it there. stratus schedules it at that hour with a natural, off-the-top-of-the-hour minute so it doesn't look robotic.

> A slot counts as **taken** when it holds a *pending*, *manual*, *posted*, or *publishing* post — so the board never suggests an hour you've already filled. Drafts, cancelled, and failed posts don't hold a slot.

---

## Actions on a post

### Edit — click any tile

Clicking a tile takes you to the **Composer** with that post loaded. Rewrite the text, change the time, switch between API and Manual, move a link into a reply, and save.

- Editing works for **draft**, **pending**, **manual**, **failed**, and **cancelled** posts.
- Opening a **posted** or **publishing** post lets you view it, but saving a change is refused — those are locked.
- For a **thread**, opening any tweet loads the whole thread; saving updates the chain as one unit. (Threads are always API-published — there's no manual thread.)

### Mark posted — for manual posts

A manual tile carries a **Mark posted** button. After you've pasted the post into X by hand, click it and the post flips to **posted**. It records the status only — the tweet's link and its metrics are picked up automatically later by the daily reconcile, which matches your pasted tweet back to this slot by its text. (This is why you don't paste a tweet URL here: the reconcile finds it for you.)

### Delete — from the edit view

Deleting happens inside the Composer's edit view. The protections: you can't delete a **posted** or **publishing** post; deleting a **thread** removes the whole thread (delete from its first tweet — a middle segment can't be removed on its own); a thread with any posted/publishing segment is protected until that resolves.

### Refresh

The **Refresh** button re-loads the board so you see the latest state — handy for confirming a *pending* post flipped to *posted*. The board also refreshes when you open the tab.

---

## Common workflows

**Plan the week.** Open the Calendar, scroll the seven columns. Solid and "aud" ghost slots point at the best openings; the drafts tray holds what's ready to place.

**Fill a good slot fast.** In the tray, hit **→ best slot** on a draft and stratus schedules it into the strongest open hour.

**Place a draft exactly.** Click a draft to arm it, then click the ghost slot you want.

**Post a manual one.** When a manual slot comes due, the Today tab reminds you; paste the post into X, come back, and hit **Mark posted** on its tile.

**Check that an API post went out.** After its time passes, press **Refresh** — it flips **pending → posted**. If it reads **failed**, open it to fix; a lingering **publishing** usually resolves itself.

---

## States you'll see

- **Loading.** The Refresh button reads **"Loading…"** while stratus fetches posts.
- **Empty.** With nothing scheduled, columns still show their ghost slots (openings to fill); with no drafts, the tray doesn't appear.
- **Error.** If the board can't load (server unreachable, token needs re-entering), a red message appears — check connection/settings and Refresh.

---

## Tips & good to know

- **Two ways to publish.** *pending* posts go out on their own via the background publisher (~once a minute; browser can be closed). *manual* posts you paste by hand and mark posted — that's the sanctioned path for posts with links and for Studio visuals.
- **Links in a plain API post are expensive — that's why Manual exists.** X charges dramatically more to publish a standalone post containing a link. stratus **refuses to schedule** a *pending* post (or a thread's first tweet) whose text contains a link. Move the link to a reply, or switch the post to **Manual** and paste it by hand (no surcharge).
- **Audience heat is advice, not orders.** The "aud" slots come from the X Analytics heatmap and never override an hour your own posts have actually done well in. If you haven't captured a heatmap recently, the Composer nudges you to.
- **Some statuses can't be hand-edited — by design.** *publishing* and *posted* are locked to prevent double-posting or un-publishing a live tweet.
- **The Calendar looks forward.** It's a seven-day planner, not a full history. For past performance, use the Today and metrics views.
