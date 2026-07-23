# stratus — User Guide

Welcome to **stratus**, your personal command center for growing on X (Twitter). stratus is a Chrome side-panel extension backed by your own small server. You use it *alongside* X: you browse and post on x.com as usual, and stratus rides along to help you decide **what to do next**, **draft it well**, **schedule it**, and **learn what actually works** — while keeping tight control over the tiny amounts of money X's API charges.

This guide documents the **visible part of stratus: the Chrome extension side panel**, one document per tab.

---

## Start here

If this is your first time, do these three things:

1. **Open the side panel** — click the stratus icon in Chrome to open the side panel next to any x.com page.
2. **Configure it** — go to the **Settings** tab and enter your **API base URL** and **bearer token**. Every other tab stays locked until this is done. → **[Settings](./settings-tab.md)**
3. **Open Today** — the **Today** tab is your home screen: it tells you what to do right now. → **[Today](./today-tab.md)**

---

## The big picture

stratus is built around four goals:

1. **Schedule posts a week ahead** — write and queue original posts and threads; a background worker publishes them automatically.
2. **Track what happens to every post** — once-a-day metrics snapshots feed an honest analytics view.
3. **Keep a swipe file** — stash other people's great tweets to study their style and structure.
4. **Know the people behind the handles** — a lightweight CRM: relationships, conversations, and the context behind every reply.

A recurring theme you'll see everywhere: **stratus drafts, you post.** Actual posting, replying, and DMing always stay as a manual copy-paste on X — stratus never posts on your behalf except for the posts *you* explicitly schedule. And most of what stratus does is **free ($0)**; the few actions that cost money (AI drafting via Grok, some metric reads) are always labeled.

---

## The tabs

| Tab | What it's for |
|---|---|
| **[Today](./today-tab.md)** | Your home screen — "what do I do right now": launch room, quests, follow-up queue, conversations, radar, targets, fans, follower trend, today's plan, spend, and the Sunday digest. |
| **[People](./people-tab.md)** | Your CRM — one profile ("dossier") per person you've encountered, with an auto-advancing relationship stage, notes, past exchanges, and AI icebreakers. |
| **[Channels](./channels-tab.md)** | Topics as places — group people, saved tweets, ideas, and your own post performance by subject on one screen. |
| **[Calendar](./calendar-tab.md)** | See and manage everything queued to post and everything already posted; the publishing lifecycle. |
| **[Composer](./composer-tab.md)** | Write, AI-draft, and schedule original posts and threads; suggests the best times to post. |
| **[Harvest](./harvest-tab.md)** | Bulk-collect tweets from a page you're viewing into a CSV (and into stratus) — free, no API. |
| **[Voice](./voice-tab.md)** | Your swipe file of others' tweets + your editable content pillars; extract reusable templates. |
| **[Replies](./replies-tab.md)** | "Reply Master" — AI-draft strong replies to the right tweets (band-gated to save money), then paste them yourself. |
| **[Ideas](./ideas-tab.md)** | The Idea Inbox — capture post/reply ideas (even by right-click on any page) so none get lost. |
| **[Playbook](./playbook-tab.md)** | Your personal "what's working" analytics report, gated so it never lies on thin data. |
| **[Settings](./settings-tab.md)** | Connect the extension to your server; privacy and behavior toggles. **Configure this first.** |

---

## Power & operator surfaces (S1–S4)

Beyond the side-panel tabs, stratus ships four cross-cutting surfaces from the `SURFACES-PLAN.md` roadmap. These are documented on their own because they aren't tabs — two are developer/operator tools, and two make up the visual Studio.

| Surface | What it's for |
|---|---|
| **[S1 — Data Explorer](./s1-data-explorer.md)** | A read-only browser microscope over the production SQLite (`/explorer`), plus the shared read-only data core. Browse, sort, search, run ad-hoc `SELECT`. |
| **[S2 — MCP server](./s2-mcp-server.md)** | `POST /mcp` — lets Claude Code (or any MCP client) interrogate the whole X operation: query the DB, call any route, draft a post. Never billed. |
| **[S3 — The Studio](./s3-studio.md)** | The Studio tab: deterministic, brand-consistent visuals (quote/stat/banner/pfp) composed in-browser, exported as PNG, pasted manually. |
| **[S4 — AI image layer](./s4-ai-image-layer.md)** | AI-generated backgrounds (Grok Imagine) composited *under* the Studio's canvas text, with a hard daily budget and a BLOB asset library. |

---

## On x.com itself

stratus also decorates the pages you're already reading. These aren't tabs — they're the extension's content script adding what it knows to X's own UI, always read-only and free.

| Surface | What it's for |
|---|---|
| **[S6 — Augmented X UI](./s6-augmented-ui.md)** | Person chips on the timeline and a "stratus context" panel under each tweet you open. |
| **[Notifications surface](./notifications-surface.md)** | On x.com/notifications: which post a reply is on, tier chips, and the $0 harvest of likes/reposts/follows into your CRM. |

---

## A few terms you'll meet

- **Band (hot / warm / skip)** — stratus scores a tweet by how much reach it's getting (views, replies, age, velocity) to decide whether replying to it is worth your time and money. See **[Replies](./replies-tab.md)**.
- **Relationship stage** — stranger → noticed → engaged → responded → mutual → ally, auto-advancing as you interact. See **[People](./people-tab.md)**.
- **Content pillar** — one of your (editable) core themes; your original posts are organized around them. See **[Voice](./voice-tab.md)** and **[Composer](./composer-tab.md)**.
- **In-band target** — an account roughly 2–10× your follower size; the people most worth replying to. See **[Today](./today-tab.md)**.
- **Profile visits** — how many people clicked through to your profile from a tweet; stratus treats this as a key signal.
- **The n≥20 gate** — analytics only show a confident number once ~20 measured items back it. See **[Playbook](./playbook-tab.md)**.

---

*This documentation covers the current version of the stratus Chrome extension. Each tab document is written to be read on its own, so jump to whichever tab you're using.*
