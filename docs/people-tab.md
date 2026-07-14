# People Tab

The **People** tab is your personal CRM (customer-relationship manager — a running file on everyone you deal with) for X/Twitter. It keeps one card per person the system has ever bumped into — everyone you've replied to, saved a tweet from, been mentioned by, or even just hovered over while browsing — and quietly tracks how your relationship with each of them is developing over time. Open it to remind yourself who someone is before you reply, to jot a private note, to see every past exchange on one screen, or to get help writing a first message.

---

## What it's for and where it fits

stratus is a side panel that helps you grow on X: it schedules your posts, drafts replies, tracks how your tweets perform, and keeps a swipe file of other people's tweets. All of that is about *content*. The People tab is about *people* — the humans behind the handles.

The idea is simple: growing on X is mostly relationships, and relationships are easy to lose track of. Did this person ever reply to you? Have you talked before? Are they someone you should be nurturing, or a stranger you're meeting for the first time? The People tab answers those questions automatically, from data the rest of stratus already collects — so you never have to keep it up by hand.

You'll usually land here in one of two ways:

- You open the tab directly to browse or search your roster.
- You **click a handle somewhere else** in stratus (in the Targets list, the Radar queue, the mention Inbox, the reply editor, the Voice library) and it opens that person's file right here. This is called *click-through*, and it works from almost anywhere a handle appears.

---

## The roster view

The roster is the first thing you see: a scrollable list of everyone in your CRM, grouped by how close your relationship is.

### Relationship stages

Every person sits at one of six **stages**. A stage describes *reciprocity* — how far someone has moved from a total stranger toward a real, two-way relationship — and nothing else. It is **not** a measure of how important or famous they are.

| Stage | What it means | What advances someone to it |
|---|---|---|
| **stranger** | The system knows the handle exists but nothing has happened. | The starting point for a manually-added person with no activity yet. |
| **noticed** | You've noticed them, one direction only. | You saved one of their tweets, saved them as an author, or their profile card was captured while you browsed. |
| **engaged** | You've reached out. | You've posted at least one reply to them. |
| **responded** | They answered you back. | They mentioned or replied to you *after* your first reply to them. |
| **mutual** | A genuine back-and-forth. | At least **2 different days** where the conversation went both ways (an inbound and an outbound on the same day). |
| **ally** | A strong, recurring relationship. | At least **4 two-way exchange days** within any rolling 60-day window. |

**Stages climb on their own.** As you reply to people, save their tweets, and pull in mentions, the system recomputes each person's stage from their history. Stages only ever *ratchet up* automatically — a quiet week never demotes anyone. You can override a stage by hand (see the dossier below), but the next time the events justify a higher rank, it climbs again.

> The exact thresholds (2 exchange days for *mutual*, 4-in-60-days for *ally*) are deliberate opening guesses, meant to be tuned after a month of real use — so don't read too much precision into them yet.

### How the list is organized

People are grouped under stage headings, strongest first: **ally → mutual → responded → engaged → noticed → stranger**. Empty stages are hidden, and each heading shows how many people are in it, e.g. `mutual (3)`. The tab title shows your total, e.g. `People (42)`.

### The search box

At the top is a **Search handle or name…** box. Type to filter the whole roster by handle or display name; results update as you type (with a short pause so it isn't jumpy). Clear it to see everyone again.

### The stage filter

Below the search box is a row of filter buttons: **All**, then one per stage (`ally`, `mutual`, `responded`, `engaged`, `noticed`, `stranger`). Tap a stage to show only those people; tap it again (or tap **All**) to clear the filter. Search and stage filter work together.

### What each row shows

Each person is one row. Tapping it opens their dossier. A row shows:

- **Name and handle** — the display name (if known) followed by `@handle`.
- **Counts** — `↗` is how many times you've reached *out* to them (your replies), `↘` is how many times they've come *in* to you (their mentions/replies).
- **Last seen** — how long ago the system last recorded any activity with them (e.g. `3d ago`).

### The Refresh button

Top-right of the header. Reloads the roster from the server. The list also reloads on its own when you change the search or stage filter.

### How people get into the roster

There are three ways a person appears here:

1. **Explicit save** — when you save one of their tweets or save them as an author from the Voice library, or reply to them, or the daily mention pull finds them, they're added automatically.
2. **Passive hover capture** — just *hovering* someone's profile card while you browse X can add them (see Tips below). This grows the roster in the background with zero effort.
3. **Manual "Start their file"** — you can create a file for any handle by hand, even one the system has never seen (see the *unknown handle* state below).

---

## The dossier view

Tapping any row opens that person's **dossier** — everything the system knows about one human, on one screen. At the top are a **← People** button (to go back to the roster) and an **open on X ↗** link (opens their X profile in a new tab). The rest of the dossier is a stack of sections.

### Header — identity, stage, and tags

The top block shows the person's display name, `@handle`, and, when known: their follower count, when you last heard *from* them (**last inbound**), and when you last replied *to* them (**last reply**). Their X bio appears below if it's on file.

- **Stage picker** — a small dropdown, colored to match the stage, sitting next to the name. It shows the current stage; pick a different one to override it by hand. This is the one place you can move someone *down* a stage as well as up. Its tooltip reminds you: *"Stage auto-advances from events; setting it by hand overrides (may demote)."* An override sticks until the person's activity re-earns a higher rank.
- **Channel tags** — a row of chips (`#slug`) for your topic *channels* (saved topic views elsewhere in stratus). Click a chip to tag or untag this person to that channel; the change saves immediately. Channels the system guesses from their bio are suggested first with a hint dot — you always confirm by clicking. Any tags that aren't channels are kept untouched. (If you haven't created any channels, this row is empty.)

### Notes — your private memory

A free-text **Notes** box for anything the machine can't know: how you met, what they're working on, a reminder to follow up. Type, then hit **Save notes** (the button reads **Saved** and greys out when there's nothing unsaved). These notes are private to you, and — importantly — they're fed to the icebreaker feature (below) so any suggested opener respects what you actually know about the person. Clearing the box and saving removes the note.

### Quick log — record something by hand

A one-line box (**Log something — a note, a DM you sent…**) with two buttons:

- **Note** — files a quick timeline note.
- **DM sent** — logs that you sent them a direct message manually in X. stratus can't see your DMs, so this keeps your relationship timeline honest and complete when you take a conversation private.

Type your text, tap the matching button, and it lands on the timeline. Both buttons stay disabled until you've typed something.

### Openers — suggest a conversation starter

The **Openers** section holds the **Suggest an opener** button (icebreakers). Covered in its own section below.

### My replies to them — with measured outcomes

If you've replied to this person, this section lists your recent replies (up to 5) and how each one actually performed. The heading shows the totals, e.g. *My replies to them (7, 5 measured)* — how many replies, and how many have real metrics yet.

Each reply shows its text plus, once measured, its **views**, **replies**, and **profile visits** (how many people clicked through to *your* profile from that reply — the number that actually grows your following). Replies not yet scored read **not measured yet**.

**Angle chips** appear above the list when there's data. Every drafted reply carries an *angle* (its rhetorical approach, e.g. *extends*, *contrarian*, *debate*). A chip like `contrarian: 3× · ~12 visits` means you've used that angle 3 times with this person, earning a median of ~12 profile visits. Over time this shows which approach lands best with this specific person — and stratus quietly uses that preference when drafting your next reply to them.

### Their mentions of me

Up to 5 recent tweets where this person mentioned or replied to you, each with its status (e.g. `answered`, `unanswered`) and how long ago. A quick way to see how they've engaged with you.

### Their saved tweets

Up to 5 of their tweets you've stashed in your Voice/swipe library, each stamped with when you saved it. Useful context for their style and what you found worth keeping.

### Follower series

When enough follower snapshots exist, the dossier can show how their follower count has moved over time — handy for spotting someone who's heating up. This fills in gradually as the system captures their profile.

### Timeline — the full history

The complete, newest-first log of every interaction, each with an icon, a short summary, and how long ago it happened. The icons:

| Icon | Event | Meaning |
|---|---|---|
| 📌 | saved tweet | You saved one of their tweets. |
| 📇 | saved author | You saved them as an author. |
| ↗ | my reply | You replied to them. |
| ↘ | their mention | They mentioned you. |
| ⚡ | their reply to me | They replied to one of your replies (the strongest inbound signal). |
| 👀 | hover sighting | Their profile card was captured while you browsed. |
| 🌾 | harvest seen | Seen during a bulk harvest of a conversation. |
| 📝 | note | A note you logged. |
| ✉ | DM sent | A manual DM you logged. |

---

## Icebreakers — get help writing the first message

When you're not sure how to open with someone, the **Suggest an opener** button (in the dossier's *Openers* section) drafts two conversation starters for you using Grok (the AI writing engine stratus uses).

- Tap **Suggest an opener** (it reads **Thinking…** while it works). You get two drafts:
  - a **Reply**-style opener (public, for replying to one of their tweets), and
  - a **DM**-style opener (for a direct message).
- Each has its own **Copy** button. Copy the one you want, then paste it into X yourself — **sending always stays manual**; stratus never messages anyone for you.
- **Again** re-drafts. **What it knew** reveals exactly the grounding the AI was given (your notes, their bio, recent exchanges, saved tweets, shared channels) — nothing else. It is not allowed to invent shared history or pretend to know things you don't; every opener is built strictly from real context. **Hide grounding** collapses it again.
- The small **cost** figure (about **$0.005** per click) is shown next to the buttons. Nothing is charged unless you press the button.

If there isn't enough real shared context yet, you'll see *"Nothing real to open with yet — save one of their tweets or log an exchange first."* — do that and try again. If the server has no AI key configured, you'll see *"Grok is not configured on the server."*

---

## Common workflows

**Review a new person before replying to them.** Click their handle anywhere in stratus (or search for them). Read the header (stage, followers, last exchange), skim the timeline and their mentions of you, and glance at the angle chips to see what's worked before. Now you know who you're talking to.

**Log a DM you sent.** Open their dossier, type a one-line summary in the quick-log box (e.g. "pitched a collab over DM"), and tap **DM sent**. It lands on the timeline so your history stays complete even though stratus can't see DMs.

**Promote or demote someone's stage.** Open their dossier and pick a new stage from the stage-picker dropdown. Use this to bump someone to *ally* you know is important, or to reset a stage that climbed too eagerly. Remember it may re-climb automatically as new events come in.

**Add a note about someone.** Open their dossier, type in the **Notes** box, and hit **Save notes**. This is your private memory *and* it grounds any future icebreaker.

**Start a file on someone brand new.** Click their handle (or navigate to them) and choose **Start their file** on the unknown-handle screen. Then add notes, tags, and log your first interaction.

**Write a first message.** Open the dossier, tap **Suggest an opener**, copy the Reply or DM draft, and paste it into X.

---

## States you'll see

- **Loading** — the roster shows **Loading…** on the Refresh button; a dossier shows **Loading…** while it fetches.
- **Empty roster** — before anyone's on file you'll see: *"Nobody yet. People appear as you reply, save tweets, and pull mentions…"*. Just use stratus normally and people will fill in.
- **Unknown handle** — if you click through to someone the system has no file for, the dossier shows *"No file on @handle yet."* with a **Start their file** button. Tapping it creates the person (logging a "added manually from the panel" note) and opens their fresh dossier so you can start adding context.
- **Errors** — if something fails to load you'll see a short error message; use **Refresh** to retry.

---

## Tips and good to know

- **Passive capture is on by default.** The first time you open the People tab you'll see a one-time note: *"👀 Passive capture is on: hover cards you see while browsing X grow this roster automatically. Turn it off in Settings."* This means simply hovering over people's profile cards as you scroll X can quietly add them to your roster — no clicking required. It only reads what X already shows you, and it never triggers hovers on its own. If you'd rather keep the roster to people you deliberately engage, turn **passive capture** off in the **Settings** tab. Tap **Got it** to dismiss the note.
- **Costs are tiny and only on demand.** Browsing the roster and dossiers is free. The only thing that costs money is **Suggest an opener** (~$0.005 per click), and only when you press it. Everything else here is built from data stratus already collected.
- **Stages are guesses, not verdicts.** They're a helpful sorting of your relationships, tuned by opening-guess thresholds. Trust the direction (stranger → ally) more than the exact boundary, and override by hand whenever your judgment differs.
- **Click-through is everywhere.** Almost any handle in stratus opens that person's dossier here. When you're deciding whether to reply to someone, that one click gives you their whole history first.
- **Nothing is sent for you.** Icebreakers and DM logging are aids, not automation. Every message you send, you send yourself in X.
