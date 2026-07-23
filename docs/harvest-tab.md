# Harvest Tab

The **Harvest** tab bulk-collects tweets straight off an X (Twitter) profile page you're looking at — a whole timeline at once — and turns them into a spreadsheet. It works by *reading the page* the way your eyes do (scrolling and reading the numbers already on screen), so it never calls the paid X API and **costs $0**, no matter how many tweets you pull. By default every harvest saves a **CSV file** to your Downloads folder *and* uploads the same rows into stratus so the app can use them — both are checkboxes you can turn off independently (just not both at once). It's the "power tool" of the extension: a lot of data in one go, but completely safe and free. A quieter, automatic version of the same thing also runs while you browse your home timeline — see **[Passive timeline harvest](#passive-timeline-harvest-the-free-one-that-runs-itself)** below.

---

## What it's for / where it fits

Two tabs in this extension save tweets, and they're for different jobs:

- **Voice tab** — saves *one tweet at a time*. You open a single tweet you admire, click "Save to stratus", and it's stashed in your swipe file for style study. Precise, deliberate, one-by-one.
- **Harvest tab** (this one) — saves *many tweets at once* by scrolling an entire profile. Instead of picking individual tweets, you point it at a person's timeline and it sweeps everything it can reach, with all the engagement numbers attached.

Use Harvest when you want the *whole picture* of an account: every recent post with its likes/views/replies, so you can study what works, or every one of *your own* replies so stratus can measure how they performed. Use the Voice tab when you just want to keep one specific tweet.

"Harvest" here simply means **bulk-scrape** — grab a batch of tweets by reading the page.

---

## Before you start

Harvest reads whatever profile is showing in your **active browser tab**, so a little setup helps:

1. **Be signed in to X** in Chrome. You're scraping the normal logged-in view of the site.
2. **Ideally, open the profile you want to harvest** before you start — go to `x.com/theirhandle` (for posts) or `x.com/theirhandle/with_replies` (for replies).
3. It's fine if you're *not* on the right page. When you type a handle and press the harvest button, the extension will **navigate your current X tab to that profile automatically**, or **open a brand-new X tab** if your active tab isn't on X at all. You just may see the tab jump to the right place before scrolling begins.

At the top of the tab you'll see a one-line **detection message** telling you what the extension currently sees:

- *"On profile @handle in the active tab."* — you're already on a profile; the handle box is pre-filled for you.
- *"The active X tab isn't a profile — enter a handle to harvest."* — you're on X but not on a profile page (maybe the home feed); type a handle.
- *"The active tab isn't X — a new X tab will open when you harvest."* — you're somewhere else entirely; type a handle and a fresh X tab opens when you start.

The **Re-detect** button (top-right) re-checks the active tab if you switch tabs and the message looks stale.

---

## The controls

Work down the panel top to bottom.

### Handle
The X username to harvest, without the `@` (though you can type it — it's stripped). It's **pre-filled** from whatever profile the extension detected, but you can overwrite it with any handle. A handle must be 1–15 characters, letters, numbers, or underscores. Until you enter a valid one, the harvest button stays disabled and reads **"Enter a handle"**.

### Harvest (mode)
Two buttons — pick what kind of tweet to collect:

- **Posts** — the account's own original posts (its main profile timeline). Reposts (retweets) and other people's tweets are skipped; you get only tweets *authored by that account*.
- **Replies** — the account's replies to other people (the "Posts & replies" / `/with_replies` view). Each reply is paired with the tweet it was replying to, so you capture both sides.

### Date range (scope)
How far back to collect. Four buttons:

- **All** — the whole timeline, scrolling down until it reaches the bottom (or your Max rows cap). Use this the first time you study an account.
- **Today** — only tweets from *today* (your local calendar day). The scroll stops automatically once it has scrolled past midnight.
- **Yesterday** — only tweets from *yesterday* (your local calendar day).
- **Since last** — *incremental catch-up.* Collects only tweets **newer than the last time you finished harvesting this same handle in this same mode.** The very first time you use "Since last" on an account there's nothing to compare against, so it behaves exactly like **All** and does a full scrape; every run after that just picks up the new tweets since the previous finish. This is the efficient way to keep a running record without re-scraping everything each time. (Read the important caveat under **Tips** below — the "silent-skip trap".)

### Pace
How human-like the scrolling looks — **slow**, **human** (the default), or **fast**. Slower paces scroll more gently, pause longer between screens, and wait longer for X to load more tweets; faster paces move quicker. "Human" is a good balance. Slow down if a big harvest seems to be missing tweets (giving X more time to load), or speed up for small, quick pulls.

### Max rows
An optional hard cap on how many tweets to collect. Leave it blank (it shows **∞**) for no limit. Set a number if you only want, say, the latest 50 tweets, or to keep a big account's harvest short. The scroll stops as soon as it reaches that many rows.

### Min views
An optional **floor**: tweets with fewer views than this number aren't kept. Leave it blank to keep everything. Set, say, `1000` to skip the small stuff and harvest only posts that actually got reach — it thins both the CSV *and* what's uploaded to stratus. The filter is applied as each tweet is read, so a filtered-out tweet still counts as "scrolled past" — which means a **Today**/**Yesterday** harvest still stops at the right point instead of scrolling forever looking for rows it will never keep.

### Download CSV
A checkbox, **on by default**. Uncheck it when you only want the rows *inside stratus* and don't need a spreadsheet cluttering your Downloads folder. With it off, the harvest runs exactly the same — it just skips writing the file, and the result line reads *"saved N rows to stratus only (no CSV)"*.

### Send to stratus (alongside the CSV)
A checkbox, **on by default**. When on, the harvested rows are uploaded into stratus after the scrape *in addition to* the CSV download — the app then has the data to work with (see "What you get" below). When off, you only get the CSV file. **Turning it off never affects the CSV** — the file always downloads either way.

> **Both off = nothing saved.** If you uncheck **Download CSV** *and* **Send to stratus**, the harvest button is disabled and a warning appears: *"Turn on the CSV download or Send to stratus — with both off the harvest saves nothing."* Turn one back on to continue.

### Your choices are remembered
Mode, date range, pace, max rows, min views and the CSV checkbox are all **saved automatically** and restored the next time you open the panel — close the side panel mid-thought and come back to exactly the form you left. (The **Send to stratus** toggle has always been remembered too.) Only the handle is re-detected fresh each time.

### The harvest button
The big button at the bottom. It reads **"Harvest @handle"** once a valid handle is entered (or "Enter a handle" until then). Click it to begin.

### Stop
While a harvest is running, the harvest button is replaced by a red **Stop** button. Click it to end early — everything gathered *so far* is still saved to a CSV (and uploaded, if the toggle is on). Stopping is safe; you never lose what was already collected.

### Progress
While running, you'll see a live status line such as *"Scrolling @handle — posts…"*, then a running count like **"128 rows · oldest Jul 3, 2026 · 42 scrolls"** — how many tweets captured, the date of the oldest one reached, and how many scroll steps it has taken. A hint reminds you to **keep the X tab in the foreground** (X stops loading more tweets when its tab is in the background).

### Passive line (at the very bottom)
A small grey line under the button reports the *other* harvest — the one you never start:

- **"Passive: 412 rows today"** — how many tweets today's ambient timeline capture has collected so far (see the next section). The day rolls over at **midnight UTC**, not your local midnight, so the number resets at a fixed time worldwide.
- **"Passive capture off"** — the Settings toggle is off, so nothing is being collected.
- **Nothing at all** — the count hasn't loaded yet, or the server couldn't be reached. It never guesses "0".

---

## Passive timeline harvest (the free one that runs itself)

Everything above is the harvest you *start*. There's a second one that just happens: while you scroll **x.com/home**, the extension quietly records every tweet the algorithm put in front of you — the same rows, into the same place, at **$0**. It's on by default and you can turn it off in **[Settings](./settings-tab.md)**.

**What gets recorded:** every tweet on your home timeline whose on-screen numbers the extension can read — *including the ones you'd never reply to*. That's deliberate: the point is to know what you were *shown*, not just what you liked, and the boring tweets are the denominator that makes the good ones measurable. Ads and promoted rows have no readable numbers, so they're skipped automatically.

**Where it stops:**

- **Home timeline only.** Profiles, search results, and individual tweet pages are not captured — only `x.com/home`.
- **Nothing while a harvest is running.** Starting a Harvest-tab run in a tab suspends passive capture there, so the two can't double-record.
- **One row per tweet per 30 minutes.** Scrolling past the same tweet again right away adds nothing; half an hour later it adds a second reading — which is exactly the growth curve you want (see "What you get" above).
- **2,000 rows a day, 60 days of history.** A hard daily ceiling, and anything older than two months is deleted automatically. Ordinary browsing doesn't come close to the ceiling.
- **Nobody is added to your People roster from this.** Being shown a tweet isn't a relationship. The deliberate bridge is the **Timeline affinity** list in the [People tab](./people-tab.md), where *you* click "Start their file".

**What it's for.** Two screens read this corpus, and neither costs anything:

- **[People → Timeline affinity](./people-tab.md)** — who the algorithm keeps putting in front of you, ranked by how many *separate days* they showed up. The answer to "who am I being fed constantly and still not tracking?"
- **[Playbook → Timeline funnel](./playbook-tab.md)** — of the tweets you were actually shown, how many you replied to, split by how good the opportunity was. The honest measure of what you're letting slide past.

Both need real scrolling before they say anything — days, not minutes.

---

## What you get

### The CSV file
A spreadsheet lands in your Downloads folder, named like:

```
elonmusk_posts_2026-07-11.csv
elonmusk_replies_since_last_2026-07-11.csv
```

That's `handle_mode[_scope]_date.csv`. It opens cleanly in Excel, Numbers, or Google Sheets.

**Posts mode** columns (one row per post, newest first):
- **Post text** — the tweet's words
- **Comments, Reposts, Likes, Bookmarks, Views** — the engagement numbers read from the tweet's own on-screen counters
- **Date and time** — when it was posted
- **Handle @...** — the author
- **URL** — a direct link to the tweet

**Replies mode** columns (one row per reply — both the reply *and* the tweet it answered):
- **Original post** text, comments, likes, views, date/time, and handle — the tweet that was replied to
- **Reply** text, comments, likes, views, and date/time — the account's reply itself

### The rows inside stratus (if "Send to stratus" is on)
The same tweets are also uploaded into the app. Behind the scenes each harvest is recorded as a "run", and every row is stored — including a few extra details the CSV leaves out, like whether the tweet has a **photo** or **video**, whether it's a **quote tweet**, its **text length**, and how many **line breaks** it uses. These "content-shape" signals help stratus later learn *which formats earn views*.

Re-harvesting the same tweet on different days is intentional and useful — each capture is a new data point, so stratus can watch how a tweet's views and bookmarks grow over time (something the once-a-day API snapshot can't show).

**Replies mode does one more clever thing:** when you harvest *your own* replies, stratus tries to match each harvested reply back to the reply **draft** you created in the extension. If it finds the match, it links them — and if a draft was missing its posted-tweet link (because you pasted the reply manually and never marked it done), the harvest **fills that link in for you**. After a harvest, the result line tells you how many drafts it *matched* and how many it *backfilled*. This is how your reply drafts get connected to their real-world performance without any manual bookkeeping.

---

## States you'll see

- **Idle** — the form, with the detection line and the "Harvest @handle" button. Ready to go.
- **Running** — the red **Stop** button, a status line, and the live rows/oldest/scrolls counter. Leave the X tab in the foreground and let it work.
- **Done (success)** — a green box: *"Done — saved N rows to filename.csv. Range \<oldest\> … \<newest\>."* With **Download CSV** off it reads *"saved N rows to stratus only (no CSV)"* instead. If uploaded, a second line: *"Sent N rows to stratus · X matched drafts (Y backfilled)."*
- **Stopped** — same as Done, but it opens with *"Stopped — saved N rows…"* — you cancelled, and the partial results were kept.
- **Nothing found** — an amber box: *"No matching posts found"* (or *"…for today"* etc.). The account had nothing in that mode/date range — common with **Today**/**Yesterday** on an account that hasn't posted, or **Since last** when there's nothing new.
- **Upload failed (but CSV saved)** — an amber box: *"Stratus ingest failed: \<reason\> — the CSV was still saved."* The scrape worked and your file downloaded; only the upload to stratus didn't go through. You can safely re-run later.

### Error messages
If a harvest can't start or run, you'll see one of these in plain language:

- **"Couldn't read a profile handle from that page."** — the page wasn't a recognizable profile. Make sure the handle is right and try again.
- **"A harvest is already running in that tab — wait for it to finish."** — one harvest per tab at a time.
- **"The X page didn't finish loading. Try again."** — X was still loading; just retry.
- **"Lost the connection to the page (did the tab navigate or close?)."** — the X tab was closed or navigated away mid-run. Keep it open and in the foreground.
- **"The harvest crashed…"** — something unexpected; retrying usually fixes it.
- **"Couldn't open an X tab to harvest."** — the extension couldn't open a new tab; open X yourself and retry.

---

## Common workflows

### Study a top account's recent posts
1. Open the account's profile (or just type its handle).
2. Mode: **Posts**. Date range: **All** (or set **Max rows** to, say, 100 to keep it quick).
3. Leave **Send to stratus** on, press **Harvest @handle**, and keep the X tab in front.
4. Open the downloaded CSV, sort by **Views** or **Likes**, and see which posts landed — great raw material for the Voice/Playbook side of stratus.

### Keep a running record without re-scraping everything
1. First time: harvest the account with date range **Since last** (this first run does a full scrape and remembers where it stopped).
2. Next week (or whenever): harvest again with **Since last** — it collects only the tweets posted since your last finished run. Fast, and no duplicates.

### Reconcile your own replies with their outcomes
1. Go to **your own** `/with_replies` page (or type your handle).
2. Mode: **Replies**. Date range: **All** or **Since last**. Keep **Send to stratus** on.
3. Harvest. As the rows upload, stratus matches each reply to the draft you wrote and backfills any missing links — so your reply drafts finally line up with how they actually performed. The result line shows the matched/backfilled counts.

---

## Tips & good to know

- **It's free.** Harvest reads the page directly and never touches the paid X API, so a harvest of 10 or 10,000 tweets costs **$0**. This is exactly why it exists — pulling this data through the API would cost money per read.
- **Keep the X tab in the foreground.** X quietly stops loading more tweets when its tab is in the background, so a backgrounded harvest will stall. Let the tab stay visible while it scrolls.
- **Stopping is always safe.** Whatever was gathered before you hit Stop is saved and uploaded. You never lose partial progress.
- **The CSV always downloads** (when that checkbox is on), even if the stratus upload fails — the file is written to disk first, so an upload hiccup never costs you the data.
- **The "Since last" silent-skip trap.** "Since last" remembers a per-account **cursor** — the timestamp of the newest tweet your last *completed* run saw — and skips everything at or before it. That's the point, but it means a "Since last" run can quietly return *nothing new* and you might wonder where the tweets went. Two things protect you: (1) the cursor **only advances on a run that finished** — if you Stop early, it isn't moved, so nothing gets skipped by a partial run; and (2) every cursor is **visible and resettable in the Settings tab**, under **"Harvest cursors"**. Each entry shows the handle, the mode, and the cutoff time, with a **Reset** button. Reset one to make the next "Since last" run scrape that timeline in full again.
- **CSV safety (formula escaping).** Tweets sometimes start with characters like `=`, `+`, `-`, or `@`, which spreadsheet apps could otherwise treat as live formulas (a real security risk when opening files). Harvest automatically neutralizes those cells so your CSV opens as plain text — the standard "CSV injection" guard. You don't have to do anything.
- **What's captured is what's on screen.** The numbers come from each tweet's own on-page counters, so they're accurate to the moment you scrolled past. Re-harvesting later gives you a fresh, later reading — useful for tracking growth.
- **Reposts and other people's tweets are filtered out** in Posts mode; you get only the account's own authored posts. Pinned tweets don't cut a date-range harvest short.
