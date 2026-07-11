# Replies Tab (Reply Master)

The **Replies** tab — nicknamed **Reply Master** — is where stratus drafts strong, on-brand replies *for* you and then gets out of the way. You point it at a tweet worth replying to, it asks Grok (the xAI model) to write two ready-to-post replies, you pick one and tweak it if you like, then you **copy it and paste it into X yourself**. stratus never posts on your behalf — it does the hard part (writing something sharp, fast) and leaves the posting to you. It also quietly checks that the tweet is actually *worth* replying to before spending a single cent, and afterward tracks how each reply performed so you learn what works.

---

## What it's for and where it fits

stratus is a side panel for growing on X/Twitter. The guiding doctrine behind it is roughly **70% engagement, 30% original posts** — most of your growth comes from replying thoughtfully to *other people's* tweets, not from broadcasting your own. Reply Master is the tool for that 70%.

Replying well, many times a day, is exhausting to do by hand: you have to find the right tweets (big enough to matter, early enough that you're not buried), then write something that isn't a generic "Great post!". Reply Master automates both halves:

- It **scores tweets** so you spend effort only where a reply can actually be seen (the *band gate*, below).
- It **drafts the reply** in your voice, giving you two distinct angles to choose from.

Everything Reply Master does also feeds the rest of stratus. Every reply you mark as posted becomes a tracked data point: it shows up in the **People** tab (as an interaction with that person), in your reply **outcomes** (views, likes, profile visits), and in the **Playbook** (which reply styles actually earn attention). So the Replies tab isn't just a drafting box — it's the front door to a feedback loop that keeps getting smarter about what to say and to whom.

---

## Getting a tweet into Reply Master

A draft always starts from a **target tweet** — the tweet you want to reply to. There are two main ways a target gets in front of Reply Master.

### 1. The 🪄 Reply Master button on x.com (the main path)

When you're browsing X with the extension installed, open any tweet's own page (its "status page" — the view you get by clicking a tweet so it's the focused one). stratus adds a small **🪄 Reply Master** button to that tweet's action row (next to reply / repost / like).

Click it and stratus will:

1. **Read the tweet** — its text, author, metrics (views, likes, replies, reposts), the top replies already under it, and how old it is.
2. **Check the band gate** (see below) — is this tweet even worth a reply?
3. **Ask Grok for two replies**, then **copy the best one to your clipboard automatically**.
4. **Drop the draft into the Replies tab**, so when you open the side panel the editor is already loaded with it.

The button shows its progress right on the page: `Drafting…` while it works, then `Copied ✓` when the reply is on your clipboard and ready to paste. (If the tweet is a dead end, it says `Dead post — click to force` instead — that's the band gate talking; see below.)

> The button only appears on a tweet's *own* status page, on the focused tweet — not on every tweet in a scrolling timeline. If you don't see it, click into the tweet first.

When you open the Replies tab and no draft is loaded yet, it reminds you of exactly this: *"Open a tweet on x.com and click 🪄 Reply Master to start a draft. The generated text is copied to your clipboard automatically."*

### 2. From a Radar, Conversations, or Inbox opportunity

Other tabs in stratus surface tweets that already deserve a reply, and each has its own one-click draft button that uses the **same Grok reply engine**:

- **Radar** — a live queue of hot/warm tweets stratus spotted while you browsed. Its "Draft replies" action writes a reply for the whole queue at once; each drafted reply is copied to your clipboard the moment you open that tweet.
- **Conversations / Inbox** — threads where someone mentioned or replied to *you* and you owe them an answer. Each open loop has a one-click Grok draft button; you Copy, paste on X, and mark it done.

These surfaces draft *in place* (right there in their own tab) rather than loading the Replies-tab editor. The Replies tab itself is fed by the 🪄 button and is where you go to **edit, re-generate, and review the full history** of your drafts. Think of the 🪄 button as "start a fresh draft from the tweet I'm looking at," and the other tabs as "work through a ready-made list of opportunities."

> **A note on replies to mentions:** when the tweet is someone replying to *you*, the band gate is skipped automatically (a mention is always worth answering, and its metrics are usually zeros anyway). Reply Master also feeds Grok your original post as context — labeled "the tweet below is a reply to it" — so the draft understands the thread.

---

## The band gate — is this tweet worth a reply?

Before stratus spends anything on Grok, it **scores the target tweet** into one of four verdicts. This is the *band gate*, and it exists to stop you from wasting a reply (and a fraction of a cent) on a tweet nobody will see it under.

### hot / warm / skip explained

The score is based on a few plain signals about the tweet:

- **Views** — how big is it? (The sweet spot is roughly 1,000–8,000 views. There's a floor around 300 views to be "worth a reply" at all — a bit lower, ~180, if the tweet is *reply-bait*.)
- **Replies already on it** — are you early, or buried? Under ~40 replies you're near the top; past ~120 you're lost in the pile.
- **Age and velocity** — how fresh it is, and how fast views are accumulating (views per minute). A brand-new tweet that's climbing fast can be worth jumping on before it's even big.
- **Reply-bait** — is it a question, a poll, or a "hot take, agree or disagree?" format? Those pull threads where a sharp early reply gets seen, so they earn a slightly lower bar.

From those, the tweet lands in a band:

| Band | Badge says | What it means |
|---|---|---|
| **hot** | *reply now* | Big enough to matter and early enough to be seen. Reply immediately. |
| **warm** | *watch* | Good size but mid-pack, or promising-but-unproven. Worth a reply, less urgent. |
| **skip** | *buried* | The thread is too deep (100+ replies) — your reply would be lost. |
| **(none)** | — | Too small and not growing — it won't get views. |

**hot** and **warm** pass the gate. **skip** and **(none)** are refused.

### Why a "skip" is refused

When the tweet scores **skip** or **(none)**, Reply Master **refuses to draft** — no Grok call, no cost, no reply slot spent on a dead post. On the page, the 🪄 button turns into **`Dead post — click to force`**. This is deliberate: your time and daily reply budget are finite, and a reply that lands under a buried or tiny tweet is effort thrown away.

### Forcing it anyway (the override)

Sometimes you *know* better — maybe it's a small account you specifically want to nurture, or a tweet you have a perfect reply for regardless of reach. The refusal isn't a wall:

- On the **page**, the `Dead post — click to force` message stays up for a few seconds. **Click the button a second time within that window** and stratus resends the request with an override, forcing the draft through.
- If you wait too long, the button resets to normal and you'd start over.

The override is meant to be a *deliberate* second action, not an accident — so a stale score can never quietly burn a Grok call, but you're never locked out of a tweet you genuinely want to reply to.

### It saves you money

The whole point of the gate is cost discipline. Grok drafting isn't free (a few tenths of a cent per draft), and the gate runs *before* any spend. Over hundreds of replies, skipping the dead posts adds up — and, more importantly, it keeps your attention on the tweets where a reply actually earns you views and profile visits.

### The same score powers the on-page badge

While you browse X with the extension on, stratus quietly badges tweets that sit in the reply sweet spot — a little **hot / warm / skip** tag (labelled *reply now* / *watch* / *buried*). That badge is computed by the **exact same classifier** as the band gate. So a tweet the badge calls "reply now" is a tweet Reply Master will happily draft for; a "buried" badge is the same verdict that triggers the force prompt. One scoring model, everywhere.

---

## Generating replies

Once a target passes the gate (or you force it), stratus asks Grok for the replies.

### The idea steer (optional)

Above the editor is an **Idea steer** box: *"Idea steer (optional — used on the next generate, then cleared)."* Type a seed here and the next draft will be built around it — an angle you want to take, a point to make, a fact to work in.

- **Romanian is fine.** The steer can be in Romanian (or any language) — *"the reply comes out in English."* Type the thought however it comes to you.
- **It's one-shot.** The steer aims exactly *one* draft. After a successful generate it clears itself, so it can't leak into the replies that follow. If you want it again, type it again.
- **Seed from the Idea Inbox.** If you've saved ideas in the **Idea Inbox** (the Ideas tab), a *"Seed from Idea Inbox"* dropdown appears above the box. Pick a saved idea and it fills the steer. When you generate, stratus marks that idea as *used* and links it to the resulting draft — so later you can see which idea produced which reply. You can also just free-type; emptying the box unlinks any picked idea.

### Generating and the two variants

Every generate returns **two distinct replies**, and each is tagged with an **angle** describing its approach:

| Angle | The reply's approach |
|---|---|
| **extends** | Builds on the original tweet — adds to the point, takes it further. |
| **contrarian** | Pushes back — offers the opposite or a sharper counter-view. |
| **debate** | Opens a genuine back-and-forth — a pointed question or challenge. |

The two variants show as **chips** above the reply box, labelled like `V1 · extends` and `V2 · contrarian`. **Click a chip to load that variant into the editor.** The active one is highlighted. This lets you A/B your own reply in one glance and pick the tone that fits.

### Editing the reply

The reply itself sits in a big text box you can freely edit:

- A **character counter** shows how many of X's 280 characters you have left; it turns red if you go over.
- Below the box, small print shows the **Grok model** used, the **cost** of the draft, an **· edited** marker once you've changed the text, and a **· saving…** flicker while your edits are being saved. (Edits are saved automatically as you type — you don't need a save button.)
- Typing your edit back to exactly the original wording clears the "edited" state.

### Regenerate

Not happy with either variant? **Regenerate** runs a fresh pair. It reuses whatever's currently in the idea steer and any system-prompt override you've set (see below), so you can tweak the steer and try again.

### What a draft costs

Drafting runs on Grok (xAI), **not** the X API — so it doesn't touch your X spend. A reply draft is roughly **$0.002–$0.004**: two variants in one call, plus — occasionally — one automatic re-draft if neither variant is specific enough (stratus quietly asks again for something less generic). The exact cost is shown under the reply box and in the history list.

### Advanced: system prompt override

Below the editor is a collapsible **System prompt override**. This replaces the *default* Grok instructions (the "voice" that makes replies sound like you) with your own, for **every** generation — both here and from the page button. Leave it empty to use the tuned default (recommended). You can open **View default prompt** to read what you'd be replacing, copy it, or use it as a starting point to tweak. A small **active** badge shows when an override is in force. This is a power-user knob; most people never touch it.

---

## Posting and tracking

Reply Master drafts; **you post.** stratus never sends a reply to X automatically. The flow is designed around a copy-and-paste hand-off, with one small step afterward that unlocks performance tracking.

### The three-step hand-off

1. **Copy** — click the **Copy** button. The current reply text goes to your clipboard and the draft's status bumps from *generated* to *copied*. (If you drafted from the 🪄 button on the page, the reply was already copied for you.)
2. **Paste on X** — open the tweet on X, paste into the reply box, and post it as you normally would.
3. **Mark posted** — come back to the panel and click **Mark posted**. A small field opens asking for the **posted tweet URL or id (optional)** — paste the link to your posted reply (`https://x.com/…/status/1234…`) or its numeric id. Click **Confirm posted**. The draft flips to *posted* and the editor closes so you're ready for the next one.

> **Marking posted matters.** It's the step that turns a draft into a *tracked* reply. And giving it the posted tweet's URL/id is what lets stratus later match your reply to its real performance numbers. It's optional — you can mark posted without it — but linking it is what makes measured outcomes appear.

### Other actions

- **Discard** — deletes the draft row entirely (with a confirm). Use it for drafts you'll never post.
- **Statuses** move in one direction: *generated → copied → posted*, with *discarded* as a terminal state. A posted reply can only be re-opened by discarding it (to drop it from your history).

### How measured outcomes appear

You don't have to do anything to *see* outcomes — they arrive on their own. Once a day (stratus's 3 AM UTC metrics pass) it reads the real numbers for every reply you posted and linked. After that, that reply carries its **measured outcome**: views, likes, replies, retweets, quotes, bookmarks, and **profile visits** (how many people clicked through to your profile from the reply — the single best "did this reply earn me a potential follower" signal).

Those numbers surface in a few places:

- In the **History** list, each row shows its model, cost, and — once linked — its `posted #<id>`.
- In your reply **outcomes** report and the **Playbook**, which crunch every posted reply to tell you which *angles* (extends / contrarian / debate) and which situations actually earn views and profile visits.
- In the **People** tab, on the dossier of whoever you replied to.

All of this is **$0** — it's read from data stratus already collects on its daily pass, not from extra API calls.

### The History list

Under the editor, **History** lists your past drafts, newest first, grouped by day (**Today**, **Yesterday**, then dates). A **Status** filter (All / Generated / Copied / Posted / Discarded) narrows the view, and a summary line counts them (`… gen · … copied · … posted · … discarded`). Each row shows the author, status, an *edited* badge if you changed it, the source tweet, your reply, and the model/cost. Click any row to reopen it in the editor.

---

## Relationship-aware drafting and pillars

Two behind-the-scenes features quietly shape what Grok writes, so the more stratus knows, the better the drafts get.

### Relationship-aware drafting

When you reply to someone stratus already has a **file** on (in the People tab), it feeds Grok a short, private summary of your history with them — automatically, on every draft:

- Their **relationship stage** (stranger → noticed → engaged → responded → mutual → ally) and your exchange counts ("6 prior exchanges — my replies: 4, their replies back: 2").
- What you last talked about, and — once there's enough data — **which reply angle has worked best** with this specific person.
- Any **private notes** you've written on their dossier.

The instruction to Grok is "use this as context and continuity — never recite it back," so the reply *builds on* your relationship rather than awkwardly announcing it. For a total stranger, none of this applies and the draft is written cold — exactly as before. This costs essentially nothing extra (a fraction of a cent at most) and is entirely automatic — there's no switch to flip. It's the difference between a reply that meets someone for the first time every time, and one that remembers you two have talked.

### Applying your content pillars

stratus lets you define **content pillars** — the two or three themes you want to be known for (in the Voice → Pillars area). Normally pillars steer your *original* posts. If you'd like them to steer your **replies** too, there's a setting for it:

- In **Settings**, turn on **"Apply content pillars to replies"** (off by default).
- With it on, every reply draft (here and in the Radar/Conversations flows) folds your active pillars into the prompt, nudging Grok to keep replies on-theme.

It's a single global toggle — flip it once and it rides along on every generate; nothing to remember per draft. Leave it off if you'd rather replies stay purely responsive to the tweet in front of you.

---

## Common workflows

### Work a Radar opportunity into a posted reply

1. Open the **Radar** section (Today tab). It's a ranked queue of hot/warm tweets stratus caught while you browsed.
2. Either use Radar's **Draft replies** to draft the whole queue, or open a tweet and let its reply come to your clipboard.
3. Open the tweet on X, paste, post.
4. Mark it done. The reply is now tracked, and the person moves along in your People CRM.

### Reply to a mention (someone replied to you)

1. Open **Conversations / Inbox** (top of the Today tab). Threads where the last word is *theirs* float to the top — those are the ones you owe.
2. On an open loop, click the one-click **Grok draft** button. The band gate is skipped (mentions are always worth answering) and your original post is fed in as context.
3. **Copy**, paste your reply on X, and mark the thread **Done** — that clears it from the inbox and records the exchange.
4. Watch for a **chain**: if they reply to *your* reply, that's the momentum you're after.

> Pulling in fresh mentions costs a tiny amount (owned reads), so the manual **refresh** in Conversations is capped at **4 per day** in the panel (with a 6/day backstop on the server). The daily 3 AM pass refreshes mentions for free, so you rarely need to spend a manual refresh.

### Steer a reply with an idea

1. In the Replies tab, type your angle into the **Idea steer** box — Romanian or English, whatever's natural. (Or pick one from the **Seed from Idea Inbox** dropdown.)
2. Draft the reply the usual way (🪄 button on the page, or **Regenerate** if a draft's already open). The steer shapes this one draft.
3. The steer clears itself afterward, so your next reply starts clean. If you seeded from the Idea Inbox, that idea is now marked used and linked to the draft.

---

## States you'll see

- **Loading / working** — the page button shows `Drafting…`; the panel's Refresh shows `Loading…`; the reply box shows `saving…` while your edits persist. Nothing to do but wait a moment.
- **Band refusal** — the page button shows **`Dead post — click to force`** (a *skip*/dead target was refused, no cost incurred). Click again within a few seconds to force it, or move on to a better tweet.
- **Error** — if a draft fails (Grok upstream error, a scrape failure, a network hiccup), you'll see a red message like `Failed: <reason>` on the button, or an error line in the editor. Common causes: you clicked from a scrolling timeline instead of the tweet's own page (`not_status_page`), the tweet couldn't be read (`scrape_failed`), or Grok was briefly unavailable. Try again; if Grok is rate-limited, wait a moment.

---

## Tips and good to know

- **Posting is always manual.** stratus drafts and copies; you paste and post. It will never tweet for you. This is by design — it keeps you in control of everything that goes out under your name.
- **The band gate saves real money and attention.** Trust it. If it refuses a tweet, that tweet probably wasn't going to earn you views. Force it only when you have a specific reason.
- **Drafts are cheap (~$0.002–$0.004), but not free.** They run on Grok, separate from your X spend. The cost shows on every draft.
- **Two variants, three angles.** Always glance at both chips before you post — the *contrarian* or *debate* take often out-performs the safe *extends* one.
- **Idea steers are one-shot.** They aim a single draft, then vanish. Re-type to reuse.
- **Mark posted, and paste the link.** Outcomes only appear for replies you mark posted — and the *rich* numbers (views, profile visits) only appear once you've given stratus the posted tweet's URL or id. This one small habit is what powers your whole reply feedback loop.
- **The 🪄 button lives on the tweet's own page.** If you can't find it, click into the tweet so it's focused.
- **Known people get better drafts automatically.** The more you use stratus (replying, saving tweets, logging notes in the People tab), the more your relationship history sharpens future replies to those same people — at no extra effort.
