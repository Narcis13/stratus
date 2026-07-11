# Voice Tab

The **Voice** tab is two things in one place. First, it's your **swipe file** — a private library of other people's tweets that you saved because you admired how they were written, kept so you can study their *style and structure* later. Every tweet here was captured by reading the X page directly (a "DOM scrape"), so it costs nothing and never touches the paid X API — **$0**. Second, it holds your **content pillars** — the handful of editable themes your own original posts are organized around, which feed the post drafter. Open this tab to save and study great tweets, distill their reusable skeletons, remix one into a post of your own, or curate the themes you write about.

---

## What it's for and where it fits

stratus is a side panel that helps you grow on X: it schedules your posts, drafts replies, tracks how your tweets perform, and keeps files on the people you interact with. The Voice tab sits on the *craft* side of that — it's about learning to write better by collecting and dissecting good writing, and about defining what you write about.

Two ideas drive it:

- **A swipe file makes you a better writer.** When you see a tweet that lands, saving it (and later breaking down *why* it works — the hook, the rhythm, the structure) turns a scroll-past into a reusable lesson. stratus never asks you to copy anyone's words; it helps you learn their *structure* and reuse that.
- **Content pillars keep you on-message.** Rather than posting about random things, most people who grow on X repeat a few consistent themes. Your pillars are those themes, written down and editable — and the AI post drafter reads them so every draft stays on-brand.

You'll usually come here to save tweets you admire, to extract their templates, to remix a great one into your own draft, or to edit your pillars. Handles shown in this tab are clickable and open that person's file in the **People** tab.

---

## How tweets and authors get into the library

You don't add tweets from inside the side panel. You add them **while browsing X**, using buttons stratus injects onto the page. This is why the library isn't a mystery — everything in it, you put there with one click on x.com.

- **"Save to stratus"** — stratus adds this button to the action row (the row with reply/repost/like) under every tweet on X. Click it and stratus reads that tweet straight off the page: its text, plus the exact formatting and emoji (so your saved copy looks like the original). It also tries, best-effort, to grab the author's hover card (bio, follower counts) at the same time. If the hover card doesn't appear, the tweet is still saved with just the author's handle and name — you can enrich the author later. The button shows **Saving…**, then **Saved** (or **Saved + author** if it also captured the author). After a save you may see a few small channel-tag chips appear next to the button — a quick way to file the tweet under a topic (see [Channel tags](#channel-tags) below).

- **"Save author to stratus"** — on someone's profile page (`x.com/<handle>`), stratus adds this button to the profile header. It captures the full header — display name, bio, follower and following counts, pinned tweet — and stores it as an **enriched** author. Enriching an author is also what feeds the **Targets** roster (explained in [Common workflows](#common-workflows)).

Both buttons read the page only. No paid API call, no metrics polling, no cost.

---

## The Tweets subtab

The tab opens with a **Tweets | Pillars** switch near the top. **Tweets** is your saved-tweet library and is selected by default. There's a **Refresh** button in the header (Tweets view only) to reload the list and author list from the server.

### The controls row

At the top of the Tweets view is a row of filters and toggles:

- **Search** — a text box (`text contains…`). Type to show only saved tweets whose text contains what you typed. It updates as you type, with a brief pause so it isn't jumpy.
- **Hook type** — a text box (`e.g. stat, contrast…`). Filters to tweets whose extracted **hook type** matches. A hook type is the kind of opening a tweet uses (a statistic, a bold claim, a contrast, a question, etc.); it only exists on tweets you've run **Extract** on (see below). Leave it empty to ignore.
- **Template** — a dropdown: **all**, **extracted**, or **not extracted**. This filters by whether a tweet has had its template distilled yet, so you can, for example, quickly find every saved tweet you haven't broken down.
- **Extract templates (~$0.005/tweet)** — a button that runs a **batch extraction** over your un-extracted saved tweets in one go (covered under [Batch extract](#batch-extract)).
- **Author** — a dropdown listing every saved author with how many tweets you've saved from each (e.g. `@handle · 7`). Pick one to show only that author's saved tweets; pick **All authors (N)** to clear it. Choosing an author also opens that author's card just below the controls.
- **Render HTML** — a checkbox. Off by default, each saved tweet shows as plain text. Turn it on to render the tweet with its captured formatting and emoji exactly as X displayed it.
- **Show retired** — a checkbox. Off by default, retired tweets and authors are hidden. Turn it on to include them (retiring is explained below — it's an archive, not a delete).

Filters combine: you can, for instance, search text *and* filter to one author *and* only show un-extracted tweets at the same time.

### The author card

When you pick a specific author from the **Author** dropdown, a card for them appears above the tweet list. It shows:

- **Display name** and **@handle**. The handle is clickable and opens that person's file in the **People** tab; the small **↗** opens their profile on X in a new tab.
- A badge: **enriched** (you captured their full profile with "Save author to stratus") or **tweet-only** (stratus only knows them from a saved tweet — you can enrich them anytime by visiting their profile and clicking "Save author to stratus"). A **retired** badge appears if they're archived.
- **Follower / following counts and how many of their tweets you've saved**, e.g. `12.3K followers · 481 following · 7 saved`.
- Their **bio**, and their **pinned tweet** (marked 📌) if captured.
- Buttons: **Retire** / **Unretire** (archive or restore the author) and **Delete**. Delete asks you to **Confirm delete** first. Note: an author can only be deleted once all of their saved tweets are gone — delete or the tweets first if the button won't take.

### What each tweet row shows

Below the controls (and author card, if any) is the list of saved tweets. Each row shows:

- **Author** — display name and `@handle`, clickable to open that person's file in the **People** tab.
- **Date** — when the tweet was originally posted.
- **The tweet text** — plain by default, or with full formatting/emoji if **Render HTML** is on.
- **The template line** (only after you've extracted it) — a compact summary of the tweet's structure, shown as `hook type · skeleton · line-break pattern · length · device`. This is the reusable skeleton, separated from the actual words.
- **Channel tags** — see below.
- A row of actions: **open ↗**, **remix**, **extract** / **re-extract**, **retire** / **unretire**, and **delete**.

### Channel tags

Each tweet row has a strip of **channel chips** (like `#ai`, `#builder`). Channels are topic buckets you define in the **Channels** tab; tagging a saved tweet with one files it into that topic's room. Chips that stratus thinks fit — based on keywords in the tweet — are shown first with a subtle hint dot; you always confirm by clicking. Click a chip to add that tag, click it again to remove it. Any tags on the tweet that aren't channels are kept untouched as you toggle. (If you haven't created any channels yet, no chips appear.)

### Per-tweet actions

- **open ↗** — opens the original tweet on X in a new tab.
- **remix** — sends this tweet's *structure* to the Composer's AI post drafter and switches you to the **Composer** tab, pre-seeded to write a new original post using this tweet's skeleton. It's the fast path from "I love how this is built" to "write me one like it." It reuses structure only — it never reproduces the saved tweet's content. (Remix works best after you've **extracted** the tweet, but you can remix any saved tweet.)
- **extract** / **re-extract** — runs one AI pass (via Grok) that distills this single tweet into its template — hook type, skeleton, line-break pattern, length, and rhetorical device — and writes those onto the row (you'll see the template line appear). This costs a small amount (~$0.005). The button reads **extract** the first time and **re-extract** once a template exists.
- **retire** / **unretire** — archives the tweet (hidden unless **Show retired** is on) or restores it. Use this to keep the library tidy without losing anything.
- **delete** — permanently removes the tweet. It asks you to **confirm** first (with a **cancel** option).

### Template extraction, explained

**Template extraction** is the heart of the swipe file. A tweet you admire is worth more than its words — it's worth its *shape*. Extraction asks the AI to look at one saved tweet and describe that shape:

- **Hook type** — how it opens (stat, contrast, question, bold claim…).
- **Skeleton** — the structural outline of the tweet.
- **Line-break pattern** — how it uses whitespace and line breaks for rhythm.
- **Length** — a rough size category.
- **Device** — the rhetorical technique it leans on.

That distilled template is what you then **remix** into your own posts, and what the **Hook type** filter searches. Extraction costs roughly **$0.005 per tweet** and is a one-time thing per tweet (the result is stored). You never need to re-run it unless you want a fresh read.

The extraction distills **structure, not content** — the deliberate rule across stratus is that you learn from others' *form* and always write your own words. Nothing here reproduces someone else's tweet.

### Batch extract

Instead of extracting tweets one at a time, the **Extract templates (~$0.005/tweet)** button in the controls row runs extraction across your un-extracted saved tweets in a single batch. While it runs, the button reads **Extracting…**. When it finishes, a green notice reports how many it did, what it cost, and how many are still un-extracted, e.g. `Extracted 18/20 ($0.0900); 4 still un-extracted.` The list then refreshes so the new template lines appear. This is the efficient way to catch up a backlog of saved-but-not-yet-studied tweets.

---

## The Pillars subtab

Switch to **Pillars** using the **Tweets | Pillars** toggle at the top. This is where you curate your **content pillars**.

### What content pillars are

A **content pillar** is one of the recurring themes your original posts revolve around — for example "the craft of building with AI," "lessons from building in public," or "the unsexy problems nobody talks about." You typically have around three. They exist so your posting has a consistent identity instead of being scattered.

Crucially, **the AI post drafter writes against these pillars.** When you draft an original post in the Composer, you pick a pillar, and its guidance is fed to the AI so the draft fits that theme. Editing a pillar here changes how the AI drafts. The Composer's pillar dropdown is populated from your **active** pillars here. A note at the top of the subtab reminds you of this: *"The post drafter writes against these. Edits change how Grok drafts — saved to the server."* There's a **Refresh** button to reload.

Each pillar comes seeded with three defaults the first time, but they're entirely yours to change.

### Editing a pillar

Each pillar is a card showing its **slug** (a short lowercase id like `ai-craft`, fixed once created) and two editable fields:

- **Label** — the human-friendly name.
- **Body (guidance the drafter reads)** — the actual description the AI reads when drafting. This is where you spell out what this pillar is about, in your own words.

As soon as you change either field, an **unsaved** badge appears. Then:

- **Save** — writes your changes to the server (enabled only when there are unsaved changes).
- **Reset** — discards your edits and restores the last saved version (enabled only when there are unsaved changes).

### Activate / deactivate

Each card has a **Deactivate** (or **Activate**) button. An inactive pillar is kept but hidden from the Composer's pillar dropdown and not used for drafting — useful for parking a theme without deleting it. Inactive pillars show an **inactive** badge and a dimmed card.

**Guard:** you can't deactivate or delete your *last remaining active* pillar — there must always be at least one, or the Composer would have nothing to draft against. When a pillar is the last active one, its Deactivate and Delete buttons are disabled, and trying anyway shows *"Can't remove the last active pillar — keep at least one."*

### Delete

**Delete** permanently removes a pillar. It asks you to **Confirm** first (with **cancel**). The same last-active guard applies — you can't delete the only active pillar.

### AI tweak (revise an existing pillar)

Each pillar card has an **AI tweak** button. Click it and a small box opens where you can optionally type an instruction — how the AI should change the pillar (*"make it punchier,"* *"focus more on solo founders"*; Romanian is fine). Click **Draft revision** and the AI proposes new label and body text, which is loaded into the card's fields as an **unsaved** draft. **Nothing is saved automatically** — review it, edit it further if you like, then **Save** to keep it or **Reset** to throw it away. This costs a small amount (~$0.003).

### AI-draft a brand-new pillar

At the bottom of the list is **+ Add pillar**. Click it to open the new-pillar form. You can fill in the **Slug**, **Label**, and **Body** by hand, or let the AI do the first draft:

- In the **Idea for the AI to draft a new pillar** box, optionally describe the theme you want (Romanian is fine), then click **Draft with AI**. The AI proposes a full pillar — slug, label, and body — which fills the form for you to review and edit.
- When you're happy, click **Create** (enabled once slug, label, and body are all filled). **Cancel** discards the form.

As with AI tweak, the AI draft is only a **proposal** — it isn't saved until you click Create, so you're always in control of what actually becomes a pillar.

---

## Common workflows

### Save tweets I admire and extract their templates

While browsing X, click **Save to stratus** under any tweet whose writing you want to learn from. Later, open the Voice tab → Tweets, set the **Template** filter to **not extracted**, and click **Extract templates** to distill them all at once (or **extract** on individual rows). Now each has a template line breaking down its hook, structure, and rhythm — a growing library of *how good tweets are built*.

### Remix a great tweet's structure into my own post

Find a saved tweet whose shape you want to borrow, click **remix**. stratus jumps to the **Composer** with the AI drafter pre-seeded to write a *new, original* post using that tweet's skeleton. You supply your own topic and words; you inherit only the proven structure.

### Curate my content pillars

Open Voice → Pillars. Edit each pillar's **Label** and **Body** to describe your real themes, then **Save**. Use **AI tweak** to sharpen the wording, or **+ Add pillar** → **Draft with AI** to spin up a new theme. Keep the ones you're actively posting about **active**; deactivate the rest. From then on, every AI-drafted original post in the Composer respects these.

### Build my target-authors roster

On X, visit the profiles of accounts you want to learn from and engage with, and click **Save author to stratus** to enrich each one. Enriched authors feed the **Targets** roster elsewhere in stratus — the list of people roughly **2–10× your own follower count**, which is the sweet spot for accounts that are big enough to matter but small enough to reply back. Saving and enriching authors here is what populates that roster.

---

## States you'll see

- **Loading** — while the library loads you'll see **Loading tweets…** (and the Refresh button reads **Loading…**). The Pillars view shows **Loading pillars…**.
- **Empty library** — if no saved tweets match your current filters you'll see **No saved tweets match these filters.** If that's unexpected, check that filters (search, author, hook, template, show-retired) aren't hiding things. A brand-new library is empty until you start clicking **Save to stratus** on X.
- **Empty pillars** — a fresh install seeds three default pillars, so this is rarely truly empty; if it is, use **+ Add pillar** to create one.
- **Errors and notices** — failures (a save, extract, or delete that didn't go through) show as a red message; successful batch extraction shows a green notice with the count and cost. Pillar errors are shown in plain language (e.g. the last-active-pillar guard, or *"AI drafting is unavailable"* if the server has no AI key configured).

---

## Tips and good to know

- **Capturing tweets and authors is always $0.** The whole library is built by reading the X page in your browser — no paid X API reads, ever. That's a deliberate design choice: reading other people's tweets through the API would cost money, so stratus scrapes the DOM instead.
- **Extraction is the only thing here that costs money**, and it's tiny (~$0.005/tweet) and one-time per tweet. AI pillar tweaks/drafts are ~$0.003. Everything else — saving, filtering, remixing setup, tagging, editing pillar text, retiring, deleting — is free.
- **Structure, not content.** stratus is built around learning from *how* others write, never copying *what* they wrote. Extraction gives you skeletons; remix reuses skeletons; your words stay your own.
- **Retire before you delete.** Retiring archives without losing anything (flip **Show retired** to see the archive); deleting is permanent. When in doubt, retire.
- **This tab connects to the rest of stratus.** Saved-tweet structure flows into the **Composer** (via Remix and the drafter's few-shot grounding); your **Pillars** drive the Composer's post drafting and its pillar dropdown; enriched **authors** feed the **Targets** roster; **channel tags** file tweets into **Channels**; and every **@handle** here is one click from that person's file in the **People** tab.
