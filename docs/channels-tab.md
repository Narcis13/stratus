# Channels Tab

The **Channels** tab turns topics into *places*. A channel is a saved view built on top of simple tags: pick a topic you care about (say `#ai-agents`), and its channel gathers everything related to that topic onto one screen — the people you know in that space, the tweets you've saved as inspiration, your open ideas, recent auto-drafted replies, and (if you link it to a content pillar) how your own posts on that topic actually performed. Nothing new is created behind the scenes: a channel is nothing more than a **set of tags plus this view**. That's why it's cheap, safe, and flexible.

---

## What it's for / where it fits

stratus already collects a lot of raw material as you use it: people you interact with (the People tab), other authors' tweets you save for style reference (the "swipe file" in the Voice tab), quick ideas you jot down (the Ideas tab), and machine-drafted replies to promising tweets (the Radar). Individually, each lives in its own tab.

The Channels tab is where you slice *across* all of those by subject. Instead of asking "show me all my saved tweets," you ask "show me everything about AI agents" — the saved tweets, the people, the ideas, the drafts, and your own results, filtered to that one topic.

Two things to know up front:

- **Channels vs. pillars.** A *pillar* is one of your content themes used when drafting original posts (you manage those in the Voice tab's Pillars area). A *channel* is a broader organizing space for inputs and relationships. They're separate — but a channel can **optionally link to a pillar**, and when it does, the channel's room also shows how your own posts in that pillar performed. Think of the pillar link as "and also show me my scoreboard for this topic."
- **Everything here is free.** Channels never call the X API or any paid service. Tagging, viewing rooms, and the keyword suggestions all run on data stratus already has, at **$0**.

---

## The channel rail

The left side of the tab is the **channel rail** — a Discord-style vertical list of your channels.

| Element | What it is |
|---|---|
| `#slug` with a colored dot | One channel. The `#name` is the channel's slug (its short id); the dot shows the channel's color if you set one. |
| Highlighted row | The channel you currently have open (its room is shown on the right). |
| Dimmed / faded row | An **inactive** channel (still listed, but switched off — see the Active toggle below). |
| **+ new channel** | The button at the bottom of the rail — opens the create form. |

**Selecting a channel:** click any `#slug` row and its room loads on the right. When you first open the tab, stratus automatically selects your first active channel so you're not staring at a blank screen. If you have no channels at all, the rail shows only the **+ new channel** button.

There's also a **Refresh** button in the tab header (top right) that reloads the currently open room — handy after you've tagged some new things and want the room to catch up.

---

## The channel room

The **room** is the right-hand panel that opens when you select a channel. At the top is a header showing the channel's **label**, a `pillar: <name>` badge if it's linked to a pillar, an `inactive` badge if it's switched off, and an **Edit** button. Just below, a "suggests on:" line lists the channel's keywords (if any) so you can see what text will trigger this channel's suggestions.

Below the header, the room is a stack of sections. Each section header shows a count in parentheses, e.g. **People (4)**. Here's what each block shows.

### People

Everyone you've tagged into this channel. Each row shows the person's display name and `@handle`, plus a colored **stage chip** — the person's relationship stage in stratus (for example `stranger`, `noticed`, `engaged`, `responded`, `mutual`, or `ally`), which reflects how far your back-and-forth with them has developed. Click any person row to jump straight to their **dossier** (their full profile in the People tab).

If nobody's tagged yet, you'll see: *"Nobody tagged yet — tag people from their dossier."*

### My posts in #`<pillar>` (only when a pillar is linked)

This block appears **only if the channel is linked to a content pillar**. It shows your own posted tweets that carry that pillar, so you can see how your work on this topic actually did:

- A header count like **My posts in #ai-craft (12, 8 measured)** — total posts and how many have measured metrics.
- A summary line: **median … views · … profile visits** across the measured posts.
- Up to 8 individual posts, each with its text and metrics (**views / likes / visits**), the post's register label if it has one, and an **open ↗** link to the tweet on X. Posts not yet measured show *"not measured yet."*

If no posted tweets carry the pillar yet, you'll see *"No posted tweets carry this pillar yet."* If the channel has no pillar linked, this whole block is absent.

### Swipe file

The saved tweets ("swipe file" = your collection of other people's tweets kept for style and structure reference) that you've tagged into this channel. Each row shows the tweet's text, a clickable **@author** handle (opens that author's dossier), the tweet's hook type if it's been analyzed, and an **open ↗** link to the original tweet.

Empty state: *"No saved tweets tagged — tag them in the Voice tab or at save time."*

### Open ideas

Your **open** ideas (ideas you haven't yet used or discarded) that carry this channel's tag. Each row shows the idea's text. Empty state: *"No open ideas tagged — tag them in the Ideas tab."*

### Radar drafts

Recent auto-drafted replies ("radar drafts" = machine-suggested replies to promising tweets) tagged into this channel. This block only appears when there's at least one. Each row shows the tweet snippet, a clickable **@handle** (opens the dossier), a band chip (`hot` / `warm` — how promising the target tweet is), the draft's status (`ready` / `clicked` / `expired`), and an **open ↗** link.

### Summary: what each block answers

| Block | Answers |
|---|---|
| People | Who do I know in this space, and how warm is each relationship? |
| My posts in #pillar | How have my own posts on this topic performed? *(only if a pillar is linked)* |
| Swipe file | What good tweets have I saved as inspiration here? |
| Open ideas | What unused ideas do I have for this topic? |
| Radar drafts | What machine-drafted replies to this topic's tweets are waiting? |

---

## Creating & editing a channel

Click **+ new channel** in the rail (or **Edit** in an open room to change an existing one). Both open the same form.

### Fields

| Field | Meaning | Notes |
|---|---|---|
| **Slug** | The channel's `#name` — its short id. | Only shown when **creating**. Lowercase with dashes (e.g. `ai-agents`). **Immutable** — once created you cannot rename the slug; you'd delete and recreate. |
| **Label** | The display name shown in the room header. | Optional. If left blank, it defaults to `#<slug>`. |
| **Color** | A hex color (e.g. `#7aa2f7`) for the dot in the rail and the chip accents. | Optional. |
| **Mapped pillar** | A dropdown of your active content pillars, plus **— none —**. | Optional. Linking a pillar pulls that pillar's own-post performance into the room's "My posts" block. |
| **Keywords** | Comma-separated words/phrases that make this channel auto-suggest itself. | Optional. E.g. `agents, claude, mcp`. See the tagging section below. |
| **Active** | A checkbox. Active channels appear in tag pickers and are selected by default. | Inactive channels stay in the list (dimmed) but drop out of the everyday tagging chips. |

### Step-by-step: create a channel

1. Click **+ new channel** in the left rail.
2. Type a **Slug** — lowercase, dashes only, e.g. `ai-agents`. This is permanent, so choose it deliberately.
3. Optionally set a **Label** (otherwise it defaults to `#ai-agents`).
4. Optionally set a **Color** (hex, e.g. `#7aa2f7`).
5. Optionally pick a **Mapped pillar** if you want your own-post scoreboard for that topic in the room.
6. Optionally add **Keywords** (comma-separated) so stratus can suggest this channel when you save related tweets or view related people.
7. Leave **Active** checked.
8. Click **Create**. The new channel appears in the rail and its (empty) room opens.

To **edit** later, open the channel and click **Edit** in the room header. You can change everything except the slug. Click **Save**.

### Deleting a channel

In the edit form, click **Delete**, then **Confirm delete** (or **Keep** to back out). Deleting is **clean and safe**: it removes the channel and its saved view, but any tags already applied to people, tweets, ideas, or drafts simply stay behind as plain text strings — they cause no harm and never break anything. If you later recreate a channel with the same slug, those orphaned tags line up with it again.

---

## Tagging things into a channel

Tagging is how things enter a channel. It's **additive and non-destructive**: adding a channel tag never removes other tags a row already has, and untagging only removes that one channel.

### The shared chip picker

The same tagging control — the **chip picker** — appears in several places across the app. It renders every *active* channel as a small toggleable `#slug` chip:

- A **filled/highlighted** chip means the row is currently tagged into that channel. Click it to untag.
- An **outlined** chip means it isn't. Click it to tag.
- A chip with a **hint dot** is a *keyword suggestion* — stratus thinks this row belongs in that channel based on its text (see below). Suggested chips sort to the front and show a tooltip *"Suggested from keywords — click to confirm."* You always confirm by clicking; nothing is auto-tagged.

Where the chip picker appears:

| Location | Tags what | Suggests from |
|---|---|---|
| **Voice tab** — each saved tweet row | The saved tweet | The tweet's text |
| **People dossier** — header area | The person | Their bio |
| **Ideas tab** — each idea row | The idea | The idea's text |
| **Radar** — a sighting row (once a reply has been drafted for it) | The radar draft (all copies of that tweet's draft) | The tweet's text |

On the People dossier, tagging preserves any non-channel tags the person already carries. In the Radar, the picker only shows up *after* a reply has been drafted for that sighting (that's when there's a stored draft row to attach tags to).

### Keyword auto-suggest (how it works)

Each channel can carry **keywords**. When the chip picker (or the save-time chips below) has some text to look at — a tweet's text, an idea's text, a person's bio — stratus matches that text against every channel's keywords and surfaces the matches as suggestions.

Matching is **word-boundary aware**: the keyword `ai` matches "AI agents" but *not* "maintain," so you don't get noise. Keywords can be single words, phrases (`claude code`), or hashtags (`#buildinpublic`). Channels with more keyword hits sort first. Crucially, **suggestions are advisory** — stratus only proposes; you confirm every tag with a click.

### Inline suggested chips when you "Save to stratus" on X

When you're browsing X and click **Save to stratus** on a tweet (the button stratus injects into the tweet's action row), then after the save succeeds stratus offers up to **3** keyword-suggested channel chips right next to the button — labeled like **+ #ai-agents**. Clicking one tags the just-saved tweet into that channel:

- The tag is **additive** (it merges server-side), so clicking several chips quickly can't clobber each other.
- On success the chip turns into **✓ #ai-agents**; on failure it shows **! #ai-agents** and lets you retry.
- These inline chips **auto-dismiss after about 15 seconds** to keep X's interface clean.

This keeps the on-X experience light (only suggestions, at most three). The full picker — where you can toggle *any* channel, not just suggested ones — lives in the panel's Voice tab.

---

## Common workflows

### 1. Set up a channel for a topic I care about

1. Open the **Channels** tab, click **+ new channel**.
2. Give it a slug like `ai-agents`, maybe a color.
3. Add keywords that identify the topic: `agents, claude, mcp, llm`.
4. Optionally map it to a content pillar so you also see your own posts' performance.
5. Click **Create**.

The channel is now live and will start auto-suggesting itself whenever you save related tweets or view related people.

### 2. Tag my swipe file and people into it

- **Saved tweets:** open the **Voice** tab, find relevant saved tweets, and click the channel chip on each. Or — going forward — save tweets straight from X and click the inline **+ #** suggestion chips right after saving.
- **People:** open a person's dossier (from the People tab, or by clicking any handle in Targets/Radar/Inbox/Voice), and click the channel chip in their header.
- **Ideas:** open the **Ideas** tab and tag relevant ideas with the chip picker.

Because suggestions surface automatically from your keywords, much of this becomes one-click confirmation.

### 3. Open a channel to see everything on one topic

Go to the **Channels** tab, click the channel in the rail, and the room shows — on one screen — the people you know in that space, your saved-tweet inspiration, your open ideas, recent drafted replies, and (if a pillar is linked) how your own posts on the topic performed. Use **Refresh** after tagging new things to bring the room up to date.

---

## States

| State | What you see |
|---|---|
| **Loading channels** | The rail is still populating; the room area shows *"Loading…"* |
| **No channels yet** | The rail shows only **+ new channel**, and the room reads *"No channels yet. Create one — a channel is just tags plus this view."* |
| **Room loading** | After selecting a channel, the room area briefly shows *"Loading…"* |
| **Empty room** | The channel exists but nothing's tagged yet — each section shows its own empty hint (e.g. *"Nobody tagged yet…"*, *"No saved tweets tagged…"*, *"No open ideas tagged…"*). This is normal for a brand-new channel; it fills in as you tag. |
| **Error** | A red message at the top of the tab (e.g. failed to load) — try **Refresh**. |

---

## Tips & good to know

- **Everything in this tab is $0.** Channels never touch the X API or any paid model — tagging, rooms, and keyword suggestions all run on data stratus already has.
- **A channel is just tags + a saved view.** Nothing is duplicated or forked. That's what makes it cheap and safe to create, rename the label, or delete.
- **Deleting is safe.** Removing a channel leaves any existing tags behind harmlessly as plain strings; recreate the same slug later and they line back up.
- **The slug is permanent.** You can change the label, color, pillar, keywords, and active state anytime — but not the slug. Pick it thoughtfully.
- **Suggestions are advisory.** Keyword auto-suggest only *proposes* channels (with a hint dot / the **+ #** chips on X). You always confirm with a click; stratus never auto-tags.
- **Keyword matching is smart about boundaries.** `ai` won't fire on "maintain." Use phrases and hashtags as keywords when a single word would be too broad.
- **Map a pillar to get your scoreboard.** Only channels linked to a content pillar show the "My posts in #pillar" performance block. Leave the pillar as **— none —** if you just want an organizing space for inputs and people.
- **Inactive channels stay listed but step back.** Switch **Active** off to keep a channel around (dimmed in the rail) while dropping it out of the everyday tagging chips.
- **The chip picker follows the topic everywhere.** Voice tweets, People dossiers, Ideas, and (once a reply is drafted) Radar rows all use the same picker — so you can tag from wherever you happen to be, not only from the Channels tab.
