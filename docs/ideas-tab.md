# Ideas Tab (Idea Inbox)

The **Ideas** tab is a holding pen for post and reply ideas so none of them get lost. Whenever a thought hits you — a topic for a future tweet, a phrase you want to try, a reaction to something you read — you drop it here. It sits patiently in your inbox until the moment you sit down to draft a post or a reply, at which point you can pull it in as the starting point (the "seed") for what stratus writes. Think of it as the notebook between "I had an idea" and "I actually used it."

---

## What it's for / where it fits

Good ideas usually arrive when you're *not* in a position to act on them — mid-scroll, reading an article, or thinking about something unrelated. The Idea Inbox exists so that gap doesn't cost you the idea. You capture cheaply now, and consume deliberately later.

The tab connects to the two places in stratus where you actually write things:

- **Composer** — where you draft original posts (and threads and quote re-ups).
- **Reply Master** (the Replies flow) — where you draft replies to other people's tweets.

Both of those have an **idea dropdown** that reads directly from your open ideas here. Picking one drops its text in as the steer for the draft, and stratus then marks the idea as "used" and remembers what it turned into. So the Ideas tab is the front of a pipeline: **capture here → consume in Composer/Reply Master → the idea remembers what it became.**

Everything in this tab is free — capturing, editing, tagging, reopening, and deleting ideas never calls the X API or any paid service. It's all stored in your own stratus database at **$0**.

---

## Capturing an idea

There are two ways to get an idea into the inbox. Both do the same thing in the end — create an idea with `open` status.

### 1. The quick-add box (in this tab)

At the top of the Ideas tab is a box labeled **"Quick add (Romanian welcome)"**.

- Type your idea into the text area. One idea per entry — keep them separate so each can be pulled in on its own later. You can write up to 2000 characters.
- Press the **Add idea** button. The button stays disabled until you've typed something, and shows **"Adding…"** while it saves.
- On success the box clears and your new idea appears at the top of the list below.

Just under the box is a reminder of the second capture path: *"Tip: select text on any page → right-click → 'Send selection to stratus ideas'."*

The label says "Romanian welcome" for a reason: you can write ideas in Romanian (or any language). When you later use the idea to draft a post or reply, the drafter reads your Romanian seed and produces the finished tweet in English. So jot the idea down however it comes to you.

### 2. The right-click context menu (on any web page)

You don't have to be in the extension to save an idea. Anywhere on the web:

1. **Select some text** on a page (highlight it with your mouse).
2. **Right-click** the selection.
3. Choose **"Send selection to stratus ideas"** from the context menu.

This saves the **selected text** as a new idea, and automatically attaches the **page's URL** as the idea's source (so later you can click back to where the thought came from). It's a $0 capture — nothing is sent to X, it just lands in your inbox.

**The badge feedback.** Because the right-click happens outside the side panel, stratus signals success or failure by briefly flashing a small badge on the extension's toolbar icon for a couple of seconds:

- A green **✓** — the idea was saved.
- A red **!** — something went wrong (for example, stratus isn't configured yet, or the server couldn't be reached). The idea was **not** saved; try again, or add it via the quick-add box.

**It needs the token configured.** The context menu (like everything else) relies on stratus knowing your server address and bearer token — set in the extension's Settings. If those aren't filled in, the right-click save will fail with the red **!** badge. Configure the token once in Settings and it works everywhere, including this right-click menu.

---

## The idea list

Below the quick-add box is your list of ideas. A **Status** dropdown lets you choose which ideas to show:

| Filter | Shows |
|---|---|
| **Open** | Ideas you haven't used yet — this is the default, and the ones that feed the Composer/Reply Master dropdowns. |
| **Consumed** | Ideas you've already used as a seed for a draft. |
| **Discarded** | Ideas you set aside. |
| **All** | Everything, regardless of status. |

A small line next to the dropdown shows how many ideas are currently listed (e.g. *"4 shown"*). There's also a **Refresh** button in the tab header (top right) to reload the list — useful after an idea gets consumed elsewhere and you want the inbox to catch up.

### What each row shows

Each idea in the list is a card with:

- **A status badge** — a colored tag reading `open`, `consumed`, or `discarded` so you can see its state at a glance.
- **A relative time** — how long ago you added it (e.g. *"2m ago"*, *"3h ago"*, or a date for older ones).
- **The idea text** — exactly what you captured.
- **Tags** — a channel-tag picker sits on every idea (see "Tags" below). It also suggests tags based on the idea's own text.
- **Source link** — if the idea came from the right-click menu, a **"source →"** link appears; click it to open the page the text came from in a new tab.
- **"Seeded" note** — once an idea has been used, it shows what it became: *"seeded a post draft"* or *"seeded a reply draft"*.

### Every action on a row

- **Reopen** — appears on ideas that are `consumed` or `discarded`. It moves the idea back to `open` so it shows up again in the Composer/Reply Master dropdowns and can be reused. (See the note below about what reopening does to the "seeded by" link.)
- **Discard** — appears only on `open` ideas. It sets the idea aside (status becomes `discarded`) without deleting it. Discarded ideas drop out of the drafting dropdowns but stay recoverable — you can always Reopen them later.
- **Delete** — appears on every idea. It removes the idea permanently. You'll be asked to confirm first (*"Delete this idea permanently?"*), because unlike Discard this can't be undone.

**Is there a manual "consume" button?** No. There's deliberately no button here to mark an idea consumed by hand — an idea becomes `consumed` only when you actually *use* it to draft something in the Composer or Reply Master (see the next section). This keeps "consumed" honest: it always means the idea really turned into a draft, and it always carries a link to that draft.

### Editing an idea

You can change an idea's **tags** directly from its row using the tag picker. There's no in-place editor for the idea's *text* in this list — if you want to reword an idea, the simplest path is to add a fresh one and delete or discard the old. (The idea's text is what gets pulled into the drafter, so treat each captured idea as a snapshot of the thought.)

**Tags** let you file an idea under one or more topics (channels). Adding a tag doesn't change the idea's status or move it — it just makes the idea findable by topic elsewhere in stratus (for example, an idea tagged for a given channel shows up in that channel's room). The picker also offers suggestions based on words in the idea itself, so tagging is usually one click.

---

## Using (consuming) an idea

This is the payoff: turning a saved idea into an actual draft.

### How it flows into Composer / Reply Master

Both drafting surfaces show a dropdown labeled **"Seed from Idea Inbox"** (Composer) / **"Seed from Idea Inbox"** (Reply Master) whenever you have open ideas. It's populated with your **open** ideas.

1. Open the **Composer** (to draft an original post) or **Reply Master** (to draft a reply).
2. In the idea dropdown, pick the idea you want to build on. Its text drops into the idea/steer box automatically. (You can still edit that text, or ignore the dropdown entirely and free-type a steer — the dropdown is optional. The default option reads *"— free-typed / none —"*.)
3. Generate the draft as usual.

When the draft is created from a dropdown-picked idea, stratus does two things behind the scenes:

- It marks the idea **consumed** (its status flips from `open` to `consumed`, so it disappears from the open dropdowns).
- It records a **backlink** from the idea to the exact draft it produced — this is the *"seeded by"* / *"seeded a post draft"* provenance.

### What "consumed" and "seeded by" mean

- **Consumed** = "this idea has done its job — it became a draft." It stops cluttering your open inbox and your drafting dropdowns.
- **Seeded by** = the connection between the idea and the draft it created. On the idea's row you'll see *"seeded a post draft"* or *"seeded a reply draft."* And in the **Composer**, when you open a draft that came from an idea, you'll see a *"seeded by idea: …"* note showing the original thought. It's a two-way memory: the idea knows what it became, and the draft knows where it came from. Handy weeks later when you're wondering "where did this post come from?"

### A failed or refused draft leaves the idea open

Consumption only happens **after** a draft is actually created. If the draft generation fails — for example the request errors out, or a reply is refused by the safety/band gate before anything is written — the idea is **not** consumed. It stays `open` and ready to try again. You never lose an idea to a failed attempt.

(One convenience worth knowing: in Reply Master, a picked idea is a one-shot steer — it's used on the very next generate and then cleared, so it doesn't silently carry over into your next, unrelated reply.)

---

## Common workflows

### Capture a thought while browsing

You're reading an article or scrolling X and something sparks a post idea. Highlight the relevant sentence (or just any text on the page), right-click, and choose **"Send selection to stratus ideas."** Watch for the green **✓** on the toolbar icon. The idea — with a link back to the page — is now waiting in your inbox. Keep browsing; you'll deal with it when you're in writing mode.

### Turn Monday's idea into Thursday's post

Ideas you jot down early in the week are exactly what the inbox is for. When you sit down later to write:

1. Open the **Composer**.
2. In the **Seed from Idea Inbox** dropdown, pick Monday's idea.
3. Generate your drafts, schedule the one you like.

The idea flips to **consumed** and now shows *"seeded a post draft."* If you ever open that scheduled post again, its *"seeded by idea"* note points right back to the thought that started it.

### Reopen an idea I discarded

Changed your mind about an idea you set aside? Switch the **Status** dropdown to **Discarded** (or **All**), find the idea, and press **Reopen**. It returns to `open` and reappears in the Composer/Reply Master dropdowns, ready to use. The same works for a **consumed** idea you want to reuse for a second, different draft — reopen it and pick it again.

> Note: reopening an idea clears its old "seeded by" link. That's intentional — once it's open again it's a fresh seed, and it'll record a new backlink the next time you consume it.

---

## States you'll see

- **Loading** — while the list is fetching, the header button reads **"Loading…"** and the area shows *"Loading…"* until your ideas appear.
- **Empty inbox (Open filter)** — if you have no open ideas, you'll see: *"No open ideas. Ideas you add here appear as dropdown seeds in the Composer and Reply Master."* — a reminder of what the inbox is for.
- **Empty (other filters)** — under Consumed / Discarded / All with nothing to show, you'll see a plain *"Nothing here."*
- **Error** — if a save, update, or load fails, a short error message appears near the top (for example if the server is unreachable). Fix the underlying issue (often the token/URL in Settings) and try again.

---

## Tips & good to know

- **It's completely free.** Every action in this tab — quick-add, right-click capture, tagging, reopening, deleting — is $0. Nothing here touches the paid X API.
- **Write ideas in Romanian if that's how they come.** The drafters translate: a Romanian seed produces an English post or reply. Capture the thought in whatever language is fastest for you.
- **Capture liberally, curate later.** The whole point is to not lose thoughts. Add anything that might be worth writing about; you can Discard or Delete the ones that don't pan out. An idea sitting `open` costs nothing.
- **The provenance backlinks are yours to mine.** The "seeded by" links (idea → draft, and the draft's "seeded by idea" note in the Composer) are free content archaeology. Months from now they answer "which of my ideas actually turned into posts, and what did they become?"
- **Consumed isn't gone.** A consumed idea is still there under the Consumed filter, complete with what it seeded. Reopen it any time to spin a second, different draft from the same thought.
- **The token unlocks everything.** If the right-click badge flashes red, or the list won't load, check that the extension's server URL and bearer token are set in Settings — that's the single thing every capture and read depends on.
