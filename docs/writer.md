# The Writer (`/writer`)

The **Writer** is a standalone, full-page writing room for **long-form articles** — the kind you publish as an X article rather than a tweet or thread. It's not a tab inside the extension side panel; it's a page served by the stratus server at **`/writer`** (open it in a normal browser tab, e.g. `https://your-stratus-host/writer`). Think of it as the long-form counterpart to the Composer: a distraction-free Markdown editor with a live preview, autosave, AI writing assists grounded in your voice, and a one-click "Copy for X" to move the finished piece into X's article composer.

Because X has no API for publishing articles (and stratus can't attach media through the API anyway), the Writer never posts anything itself. You write here; you publish by **copying** the finished article into X by hand. One upshot: since nothing is ever sent through the paid API, **the $0.20 link surcharge that governs tweets does not apply to articles** — an article can contain as many links as you like.

---

## Opening it and signing in

- Open **`/writer`** in a browser tab. It's a self-contained page (no extension required).
- The first time, it asks for your stratus **bearer token** — the same token you use everywhere else. The Writer **shares its saved token with the [Data Explorer](./s1-data-explorer.md)** (`/explorer`): sign in on either page and the other is already authenticated. The token lives in that browser's local storage; if it's ever rejected (e.g. you rotated it), the page re-prompts.
- Every data request the page makes still carries that token — the page shell is public, but nothing about your articles is readable without it.

---

## The layout

The Writer is three regions:

- **The article rail (left)** — a list of your articles, filterable by status (**All / Draft / Published / Discarded**) with a **+ new** button to start a fresh one. Each entry shows its title and a length hint; clicking one loads it into the editor. The rail reads a lean list (no full body text) so it stays fast even with many long articles.
- **The editor (middle)** — **Title** and **Subtitle** fields, a large **Markdown** text area, and, when you set one, a **Pillar** selector (your content themes, same list the Composer uses). A **word count** updates as you type.
- **The preview (right)** — a live, rendered view of your Markdown (headings, bold/italic, lists, blockquotes, inline code, links) so you can see the article take shape as you write.

---

## Writing and autosave

- Type in Markdown; the preview mirrors it instantly.
- **Autosave is automatic** — a short pause after you stop typing saves your changes to the server (no Save button to remember). It's careful about not clobbering: it saves only what actually changed and never overwrites a title you set with an empty box, so a momentary blank field can't wipe your title.
- Switching articles flushes any pending save first, so you never lose the last few keystrokes when you jump between pieces.

---

## The four AI assists

The Writer has four Grok-backed assist buttons. Each is **one AI call per click** (roughly **$0.01–0.03** depending on how much it writes), grounded in your content pillars, your best-performing past posts, and your measured guidance — the same voice discipline as the Composer's drafter. They run on whichever provider you picked in **Settings → AI**.

A contract shared by all four (and by every authoring surface in stratus): **you can steer in any language, but the output is always English.** Type a Romanian idea for an outline and you'll get an English outline back. The product publishes in English, full stop.

| Assist | What it does | What it writes |
|---|---|---|
| **Outline** | From an **idea** you type, proposes a title, subtitle, and a skeleton of section headings with beats. | Fills the title/subtitle **only if you haven't set them yourself**, and inserts the heading skeleton into the body. The structured outline is saved on the server. |
| **Draft section** | Writes the prose for the section your cursor is sitting under (it reads that `##` heading and its notes as context). | Inserts the drafted paragraphs below that heading; the rest of your body is untouched. |
| **Polish selection** | Rewrites the text you've **selected** — tighten it, or translate a non-English draft into clean English. | Replaces just the selected text. |
| **Full draft** | From an **idea**, writes a complete first draft of the whole article. | Fills an empty body. If the body already has content, it asks you to confirm before overwriting (an inline confirm, no pop-up dialog). |

Each assist **refuses before spending** if it's missing what it needs: Outline and Full draft need an idea, Draft section needs a heading to sit under, Polish needs a selection — you'll see an inline message rather than a wasted call. If the server has no AI key configured, you'll get a "Grok is not configured" message; a **discarded** article refuses assists until you revive it.

---

## Status, publishing, and Copy for X

An article moves through **draft → published → discarded**, and you drive all of it from the editor:

- **Publish / Unpublish** — mark the article published (or reopen it for editing). Publishing stamps the publish time; reopening keeps that stamp as history. There's a field to record the **published URL** — where the article landed on X — purely as your own reference (it's not how metrics are tracked and it never triggers any API call).
- **Discard / Restore** — a discarded article is frozen (no edits) except restoring it to draft; a two-click **Delete** removes it for good.
- **Copy for X** — the publish step. It copies the finished article to your clipboard as **rich text** (formatted HTML) so you can paste it straight into X's article composer with its headings and emphasis intact. A **plain-text** fallback button sits beside it for cases where rich paste doesn't take (rich-text clipboard needs a secure context — `https` or `localhost`; on a plain-`http` host, use the plain-text button and re-apply formatting in X).

---

## Tips & good to know

- **Articles never touch the paid API — so no link surcharge.** Unlike tweets, an article can hold links freely; it's published by copy-paste, not by an API call.
- **Autosave means no "lost work" — but also no undo history.** The server holds the latest saved version; there's no revision stack, so treat a big rewrite deliberately (Full draft asks before overwriting a non-empty body for exactly this reason).
- **The token is shared with the Explorer.** One sign-in covers both `/writer` and `/explorer`. Rotating your token logs you out of both.
- **Rich paste is the one thing to verify per host.** If "Copy for X" doesn't paste formatted, your host isn't a secure context — use the plain-text fallback.
- **Steer in any language; publish in English.** The assists take a Romanian (or any-language) idea and always return English prose — matching every other authoring surface in stratus.
