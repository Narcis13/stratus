# Me Tab

The **Me** tab is your **living profile** — the part of who you are that changes week to week. The static biography (who you are, what you build, how you talk) already lives inside the drafting prompts and never moves. This tab holds the *dynamic* layer on top of it: your **goals**, the **events** of this week ("shipped the studio Friday"), how you **feel right now** ("frustrated with the ANAF portal"), evergreen **facts** worth remembering, and free **notes**. Every time stratus drafts a post or a reply, it reads a fresh slice of this and folds it into the prompt — so your drafts sound like a person having *this specific week*, not a frozen bio.

Everything on this tab is **$0**: it reads and writes local data only, no X API, no AI.

---

## What it's for and where it fits

stratus is a side panel that helps you grow on X: it schedules posts, drafts replies, tracks performance, and keeps files on the people you interact with. The Me tab sits underneath the *authoring* side of that — it's the personal context the drafters lean on so the writing feels current and specific.

Two ideas drive it:

- **Specific, timely, emotional content earns engagement.** A post that mentions what you actually shipped this week, or how a real frustration felt, lands harder than a generic take. This tab is where you keep those raw materials so the AI can reach for them.
- **Goals you can see, you pursue.** A follower target that tracks itself, an MRR number you update — visible progress keeps the mission in front of you, and the Sunday digest can narrate it.

The AI never *writes* your profile — it only reads it. You type the entries; Grok fabricates biography if you let it, so this data is human-authored on purpose.

---

## The three sections

### 1. Goals

Each goal is a card with a progress bar. There are five kinds:

- **Followers** — progress tracks itself from your daily account snapshot (the once-a-day follower count stratus already collects). No value to edit; the card says *auto · from daily snapshot*. Progress stays blank until the first daily snapshot lands.
- **MRR** and **Custom** — you set the current value yourself. Type it into the **Current value** box; it saves when you click away (on blur). Give the goal a **unit** ($, users, whatever) so the numbers read right.
- **Posted replies** and **Originals** — counted for you, from the day you created the goal forward ("500 replies by September"). Nothing to type: stratus tallies your posted replies and your non-reply publishes. Because they start at zero on the day you set them, they never sweep in all of history.

Every goal shows `current / target (pct%)` and, if you set a **deadline**, how many days are left (or how many days overdue, in amber). Buttons let you mark a goal **achieved**, **drop** it, **reactivate** a closed one, or **delete** it. Achieved and dropped goals sink to the bottom, dimmed — they stay for the record but are never injected into drafts.

**Add a goal** with the **+ Add goal** button: label, kind, target, optional unit, optional deadline.

**Goals close themselves.** A goal that reaches its target becomes **achieved**; one whose deadline passes becomes **missed**. That happens the next time anything reads your goals — opening Today, opening the Sunday digest, or asking an agent for `x_goals` — not on a timer. Both are one click to undo (**reactivate**). The Me tab deliberately shows what is *stored* rather than settling anything itself, so a goal can read `active` here a moment before Today settles it.

**Pacing lives on the Today tab, not here.** This tab is the ledger — the label, the number, the date. "Am I on track to make that date?" (required-vs-actual per day, the on-pace/behind chip) is a Today-tab question; see `docs/today-tab.md`.

The two counted kinds are **kept out of your drafting prompts on purpose**: "I need 290 more replies" is process, not biography, and it is exactly the kind of number that colours a draft badly. They *do* reach the Sunday digest, which is where a reply quota belongs.

### 2. Quick log

One box to capture what's true right now. Type the text, pick a **kind** chip, and log it:

- **Fact** — evergreen, e.g. "I build in public." Never fades.
- **Event** — something that happened, e.g. "shipped the studio." Fades from drafts after **30 days**.
- **Emotion** — how you feel, e.g. "frustrated with the ANAF portal." Fades after **7 days**.
- **Note** — a free jotting. Evergreen.

Optional **date** (defaults to today) and a **Pin** checkbox. Pinning keeps an entry in the drafts forever, overriding both the freshness window and the per-kind caps — use it for the handful of things you always want the AI to know.

Romanian is welcome in the box — the drafters read it fine.

### 3. Entries

Everything you've logged, grouped by kind, newest first. Each row:

- **★ / ☆** — pin or unpin.
- **Edit** — change the text inline.
- **Retire / Restore** — take an entry out of the drafts without deleting it (retired rows are dimmed).
- **Delete** — remove it permanently.

An entry that has aged past its freshness window is shown with a dashed border and a **"not injected anymore"** tag — it's still here, but the drafters have stopped using it. This flag comes straight from the server (the same window logic the drafters use), so what you see is exactly what the AI sees.

---

## What the AI sees

At the bottom is a collapsible **"What the AI sees"** panel. Open it to read the *exact* block that gets folded into your drafts, in two forms:

- **Post drafts** — the fuller block: your goals with progress, recent events and emotions, pinned facts and notes, plus a one-line instruction telling the AI to use it for grounding and never to recite or invent beyond it.
- **Reply drafts (brief)** — a compact ≤3-line version, since replies lean on your context only lightly.

Both refresh automatically after any edit, so you can log an emotion and watch it appear, or retire an entry and watch it drop out. When there's nothing to inject, the block reads *empty* — and in that state your prompts are byte-for-byte what they were before this feature existed.

---

## How it reaches your drafts

You don't do anything to "apply" the profile — it's always on:

- **Post drafts** (Composer → Draft with AI) get the full block appended at the end of the prompt.
- **Reply drafts** (Reply Master) get the brief, folded in beside the relationship context.

The block always sits at the *tail* of the prompt, after the stable instructions, so it never disturbs the cached persona. And it's the *only* extra biography the AI is allowed to use — anything not in your profile (or the static bio) stays off-limits, so drafts can't drift into invented facts.

---

## Cost

**$0.** Reading and writing the profile touches local data only. The block adds a few hundred tokens to draft calls you were already making — a fraction of a cent per draft, no new calls, nothing recurring.
