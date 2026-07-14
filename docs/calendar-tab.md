# Calendar Tab

The **Calendar** tab is your posting queue at a glance. It shows everything you have lined up to publish over the next seven days — one column per day — plus any drafts you haven't scheduled yet. Each item shows when it's set to go out, its current status (waiting, publishing, already posted, and so on), and a preview of the text. This is where you review what's coming, jump in to edit a post, or remove something before it publishes. You don't create posts here — you manage them here.

---

## What it's for / where it fits

stratus splits post *creation* from post *management*:

- The **Composer** tab is where you write a post (or a thread), pick a time, and save it. It's also where AI-drafted posts are generated.
- The **Calendar** tab is where everything you've saved shows up so you can see the plan, make changes, and confirm posts actually went out.

Think of the Composer as the pen and the Calendar as the planner. When you want to change or delete something you already saved, you start on the Calendar and it hands you back to the Composer to make the edit.

Behind the scenes, a small **background publisher** runs on the server around the clock. Roughly once a minute it checks for posts that are scheduled and due, and publishes them to X automatically. You don't have to keep the extension — or even your browser — open for a scheduled post to go out. The Calendar is how you watch that happen.

---

## Reading the list

### How posts are grouped and ordered

The Calendar shows a **rolling seven-day window** starting with today. You'll see seven day cards in order: **Today**, then the next six days. Today's card is highlighted so it's easy to find.

- A post appears under the day its **scheduled time** falls on, shown in **your local time zone**.
- Within a day, posts are sorted **earliest first**.
- Each day header shows a **count** of how many posts land that day. A day with nothing shows a dash (`—`).

Below the seven day cards there's a separate **"Drafts (unscheduled)"** section. These are posts you've saved but *haven't* given a date and time yet (including drafts the AI drafter produced). Because they have no scheduled time, they can't fall on any day — so they collect here until you schedule them. This section only appears when you actually have unscheduled drafts.

> **Good to know:** The seven-day window looks forward from today. A post that already published earlier today still shows on Today's card (marked as posted), but posts from *yesterday or earlier* have scrolled out of the window and won't appear here. To review older posting history and performance, use the **Today** and metrics views rather than the Calendar.

### What each row shows

Reading a row from left to right:

- **Time** — the scheduled time in your local time zone (for example, `9:00 AM`). Unscheduled drafts have no time shown.
- **Status badge** — a colored label telling you where the post is in its life (see the table below).
- **Thread marker (🧵)** — shown when the post is part of a multi-tweet thread.
- **"re-up" badge** — shown when the post is a quote-tweet re-share of one of your own earlier posts.
- **Pillar badge** — the content pillar (topic category) the post was tagged with, if any.
- **Text** — a preview of the post's wording.

The whole row is a button. Clicking it opens that post in the Composer (see **Actions on a post** below).

### What each status means

Every post moves through a lifecycle. Some stages are yours to control; others are owned by the background publisher and can't be changed by hand. Here's the full set:

| Status | Meaning | Who controls it |
|---|---|---|
| **draft** | Saved but not scheduled. It will **never** post on its own — it's a work-in-progress. Give it a date/time (which turns it into *pending*) when you're ready. Drafts are allowed to contain links. | You |
| **pending** | Scheduled and armed. The background publisher will pick it up and post it automatically at its scheduled minute. This is the normal "waiting to go out" state. | You (until it's due) |
| **segment** | A follow-on tweet in a thread — that is, tweet 2, 3, 4, and so on. Segments don't post on their own; the publisher posts them as replies right after the thread's first tweet goes out. Their timing and scheduling follow the thread's first tweet. | Mostly automatic |
| **publishing** | The publisher has claimed this post and is sending it to X right now (or is waiting to confirm the result). It's **locked** while in this state so it can't be posted twice. | Background publisher |
| **posted** | Successfully published to X. It's **locked** — stratus won't edit or delete a live tweet. | Background publisher |
| **failed** | The publisher tried to post it but X rejected it. The post is kept (not thrown away) so you can open it, fix the problem, and reschedule. | You (to fix/retry) |
| **cancelled** | You explicitly cancelled it so it won't post. It stays in the record as cancelled unless you delete it outright. | You |

**The short version:** *draft*, *pending*, *failed*, and *cancelled* are yours to edit and change. *publishing* and *posted* belong to the background publisher and are read-only — you can't hand-edit or delete them. *segment* rows follow their thread's first tweet.

---

## Actions on a post

### Edit — click any row

Clicking a post row takes you straight to the **Composer** with that post loaded and ready to change. From there you can rewrite the text, change the scheduled time, move a link into a reply, and save.

A few things to expect:

- Editing works for **draft**, **pending**, **failed**, and **cancelled** posts.
- If you open a **posted** or **publishing** post, you can view it, but any attempt to save a change is refused — those are locked. (You'll see a message rather than a silent change.)
- For a **thread**, opening any tweet in it loads the whole thread for editing, and saving updates the chain as one unit.

### Delete — from the edit view

Deleting happens inside the Composer's edit view (the same place editing opens). Look for the **Delete** button; you'll be asked to confirm first. The rules that protect you:

- You **cannot delete a posted post** — stratus won't un-publish a live tweet.
- You **cannot delete a post that's currently publishing** — its outcome is still being resolved, and deleting mid-flight risks a double post.
- **Deleting a thread removes the whole thread.** Delete from the thread's **first tweet** and all its segments go with it. You **cannot delete a single middle segment** on its own — that would break the chain the publisher walks through, so it's blocked.
- If any part of a thread has already posted or is publishing, the whole thread is protected from deletion until that resolves.

If a deletion is refused, it's one of the rules above doing its job — nothing is broken.

### Refresh

The **Refresh** button in the header (top right) re-loads the list from the server so you see the latest state — handy for confirming that a *pending* post has flipped to *posted*, or that a *publishing* post finished. The button shows **"Loading…"** while it works. The list also refreshes automatically when you open the tab.

---

## Threads in the calendar

A thread is a single scheduled unit made of several tweets. In the Calendar:

- The thread's **first tweet** appears as a normal row on the day it's scheduled, carrying the **🧵** marker.
- Its follow-on tweets show up as **segment** rows — they ride along with the first tweet's schedule rather than having their own time.
- Clicking any tweet in the thread opens the **whole thread** in the Composer, so you edit the entire chain together.

When the scheduled time arrives, the publisher posts the first tweet, then posts each segment as a reply, in order, a moment apart — turning the chain into a proper X thread automatically. Deleting the thread's first tweet removes the entire thread at once.

---

## Common workflows

**Review what's going out today (or this week).** Open the Calendar. Today's highlighted card shows today's posts, earliest first; scan the next six day cards for the rest of the week. The day-header counts give you a quick sense of how loaded each day is. Statuses tell you what's already gone out versus what's still waiting.

**Edit a scheduled post.** Find the post on its day and click the row. You land in the Composer with it loaded. Change the wording or the time, then save. (This works for pending, draft, failed, and cancelled posts.)

**Cancel or delete something before it posts.** Click the pending post to open it in the Composer, then use **Delete** and confirm. It disappears from the queue and won't publish. (If you'd rather keep a record than remove it, cancelling leaves it as a *cancelled* row instead.) Remember: once a post is *publishing* or *posted*, it's locked and can't be pulled back.

**Check that a post actually went out.** After a scheduled time passes, hit **Refresh**. A successful post flips from **pending** to **posted**. If you instead see **failed**, open the post to read the problem and fix it; if it's stuck on **publishing** for a while, the server is still resolving it (it may already be live on X) — give it time and refresh again.

**Schedule a leftover draft.** Scroll to the **Drafts (unscheduled)** section, click a draft, give it a date and time in the Composer, and save. It moves out of the drafts section and onto its day as a *pending* post.

---

## States you'll see

- **Loading.** When the tab first opens or you press Refresh, the button reads **"Loading…"** while stratus fetches the latest posts.
- **Empty.** If nothing is scheduled in the next seven days, each day card shows a dash (`—`) and a count of `0`. If you also have no unscheduled drafts, the drafts section simply doesn't appear. An empty Calendar just means there's nothing queued — head to the Composer to add something.
- **Error.** If the list can't load (for example, the server is unreachable or your access token needs re-entering), a red error message appears near the top. Check your connection and settings, then press **Refresh** to try again.

---

## Tips & good to know

- **Auto-publishing is hands-off.** Scheduled (*pending*) posts go out on their own via the background publisher, which checks about once a minute. You don't need the extension or browser open. A post may publish up to roughly a minute after its scheduled time — that small delay is normal.
- **Some statuses can't be hand-edited — by design.** *publishing* and *posted* posts are owned by the publisher and are locked. This isn't a bug; it prevents double-posting a tweet or trying to un-publish a live one.
- **Links in a plain post are expensive — move them to a reply.** X charges dramatically more to publish a standalone post that contains a link than one without. Because of that, stratus **refuses to schedule** a plain post (or the *first* tweet of a thread) whose text contains a link — you'll be told to move the link elsewhere. The fix is to put the link in a **reply / later thread segment** instead, which costs the normal amount. The Composer has a one-click **"Move link to first reply"** helper that does this for you. (Drafts are allowed to hold links; the check runs when you schedule the draft to go live.)
- **A stuck *publishing* post usually resolves itself.** If a post sits on *publishing* longer than expected, the tweet may already exist on X; the server reconciles these automatically. Avoid trying to force it — just refresh periodically.
- **The Calendar looks forward.** It's a seven-day planner, not a full history. For performance of past posts and older activity, use the Today and metrics views.
