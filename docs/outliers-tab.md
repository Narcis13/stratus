# Outliers Tab

The **Outliers** tab is a query builder for X's own advanced search. You fill in a structured form — keywords, handles, hashtags, a minimum-likes floor, a date window — and stratus compiles it into the exact operator string x.com's search box understands, shows you that string as you type, and puts it on your clipboard with one click. You paste it into X, and the results page is an ordinary x.com search page, so every button stratus already injects on tweets works there unchanged.

The name is the job: you're not browsing search, you're hunting **outliers** — the posts in your topic that did unusually well, which are the ones worth stealing the shape of or replying to. Hunts you like get saved by name and re-run later.

**Everything in this tab is free — $0.** No X API call, no AI call, on any path. See [Why there is no "search from inside stratus"](#why-there-is-no-search-from-inside-stratus) below; it is the whole reason this feature has the shape it does.

---

## What it's for and where it fits

Your swipe file (the **[Voice](./voice-tab.md)** tab) and your reply queue (the **[Radar](./radar-tab.md)** tab) both fill up from tweets that *happened to cross your timeline*. That is fine as far as it goes, but it means the quality of your library is decided by an algorithm you don't control. Finding good material *deliberately* means typing raw operator syntax — `min_faves:400 ("build in public" OR "indie hacker") -filter:replies since:2026-07-01` — into X's search box, from memory, every single time.

Outliers is where that stops being a memory exercise. It sits in the **Library** rail group, between Voice and Replies, because it's an *intake* surface: it doesn't create anything, it points the capture buttons you already have at a better set of tweets.

The loop is:

1. **Build a hunt here** — form → compiled string → **Copy**.
2. **Run it on X** — paste into X's search field (or press **Open in X**).
3. **Work the results on x.com** — **Save to stratus** on anything worth studying, **⊕ Add to Radar** on anything worth replying to.
4. **Come back** — the footer of this tab counts how many tweets your hunts actually put in the swipe file.

---

## Building a hunt

The form is five sections. Everything you type recompiles the string **instantly and locally** — no request is made while you type, so there's no lag and no way for the preview to differ from what a save would store.

### Words

| Field | What it does | Compiles to |
|---|---|---|
| **All of these** | Every word must appear. Comma- or newline-separated. | `bun sqlite` |
| **Any of these** | At least one must appear. | `(sqlite OR drizzle)` |
| **Exact phrases** | The wording, verbatim, in order. One phrase per line. | `"ships on friday"` |
| **None of these** | Excluded words. | `-crypto` |

Two rules the compiler enforces for you, both of which are real X parser behaviour rather than style:

- **The OR group is always parenthesized**, even when it has one member. On X, AND binds tighter than OR, so an unparenthesized group silently re-associates the moment another clause lands beside it. And `OR` must be uppercase — lowercase `or` is matched as the literal word "or".
- **A double quote inside a keyword is an error, not something to strip.** X has no escape character, so one stray `"` re-parses everything after it. Put the exact wording in **Exact phrases** instead.

Under **Any of these** there's a row of **channel chips** — one per active [channel](./channels-tab.md). Clicking a chip appends that channel's keywords into the any-box, de-duplicated against what's already there. It's a *seed*, not a filter: what lands in the box is ordinary editable text you can trim. A channel with no keywords renders disabled and says `· no keywords` on its label, because a channel that can't seed is information rather than a broken button.

### People & tags

**From** (one handle), **Replying to** (one handle), **Mentions** (a list) and **Hashtags** (a list). Handles may be typed with or without the leading `@`, hashtags with or without the `#`; both are validated (letters, numbers and `_`, up to 15 characters for a handle) and a bad one is reported under its own field rather than silently dropped.

If you have a **target roster** — the 2–10× band of authors from the Voice tab — a picker appears above these fields. Picking a handle types it into **From**; the follower count beside it is context only and sets no floor. The picker stays on its placeholder deliberately: the **From** box is the truth, so a handle you typed by hand is never contradicted by a dropdown claiming nothing is selected.

> **If no roster picker appears, that is not a bug.** `GET /x/voice/targets` answers with an empty roster whenever `account_snapshots` is empty — without a snapshot of your own follower count there is no "my size" to band against, and that table has been frozen since the paid reads were deleted on 2026-08-12. The tab says *"No roster in the 2–10× band yet — the From box takes any handle"* instead of showing nothing.

### Engagement floor

Three number boxes — **Min likes**, **Min reposts**, **Min replies** — each with ▲▼ steppers beside it.

The steppers walk a fixed ladder: **50 · 100 · 200 · 300 · 500 · 800 · 1200 · 2000 · 5000**. The same rungs are offered as type-ahead suggestions in each box. **The bottom rung is 0, which shows as an empty box, because `0` means "no floor"** — a `min_faves:0` clause is inert noise that eats into X's character budget, so it is never emitted.

The advice under the boxes is the honest version: **start around 300–500 likes and step up until the results thin out.** A floor is the one number that decides whether you're reading outliers or reading the firehose, and there is no way to know the right value for *your* topic except by moving it.

> **These floors are borrowed, not measured.** The shipped default (400 likes, no repost or reply floor) comes from a hand-verified cheat sheet, not from any measurement of your own corpus. stratus's usual house rule is that a number is a measurement or it is absent; that rule is knowingly bent here, which is exactly why the defaults are settings you can tune rather than constants baked into the code. A computed threshold (a percentile over your captured timeline, or an author's own median × 3) was considered and deliberately not built — the honest version needs a provenance line in the UI and a recalibration story, and that's its own feature.

### Shape & window

- **Replies** — *any* / *top-level only* (`-filter:replies`) / *replies only* (`filter:replies`).
- **Media** — *any* / *has media* / *images* / *videos* / *native video*.
- **Links** — *any* / *with a link* / *no links*. Three states rather than a checkbox: both arms are real hunts, and "plain-text posts only" (`-filter:links`) is one of them.
- **Language** — a dropdown of the codes X search actually accepts. It is an allowlist rather than a free-text box for a specific reason: an unrecognized `lang:` code returns **zero** results on X, which looks exactly like "nothing matched".
- **Since / Until** — date pickers. `until` before `since` is an error, and so is a date that doesn't exist (`2026-02-31`).
- **Hide retweets** — a checkbox for `-filter:nativeretweets`.

### Hand-off

The compiled string sits in a monospace block with a character counter beside it (`n/512`), which turns amber near the cap and red over it. Two chips — **Top** / **Latest** — pick which x.com results tab the hand-off lands on; **Top** is the default, because an outlier hunt wants best-performing rather than newest.

- **Copy** (the primary button) writes the string to your clipboard. Paste it into X's own search field. If Chrome refuses the clipboard write — it requires a focused document and a real click — the button says so and the string stays visible and selectable in the block above, so copying it by hand always works.
- **Open in X** skips the paste: it reuses your current X tab if you have one, otherwise opens a new one, landing on `x.com/search` with the query already in place.

Both buttons are **disabled whenever the query has an error**, and no request is made and no row is written while they are.

---

## Errors and warnings

Problems are a list, not an exception, and they render inline under the field they belong to. There are two severities and the difference is the whole model:

- **Errors** mean *X would refuse or misread this*. They disable Copy and Open in X, and they block a save. Empty query, a floor with nothing to match, a bad handle, an unbalanced quote, `until` before `since`, an impossible date, over 512 characters.
- **Warnings** mean *this will run, but it may not do what you think*. They never block anything. A keyword containing a `:` (the likeliest mistake of the whole form — pasting `min_faves:50` into a keyword box), a multi-word term inside **Any of these** or **None of these** (X reads `-build in public` as "exclude *build*, and require *in* and *public*"), a hashtag starting with a digit.

**A brand-new form opens in an error state, and that is correct.** The defaults are floors, a window and a results tab — no keyword — so the compile reports *"Filters and floors narrow a search, they don't find one — add a keyword, phrase, handle or hashtag"* until you type something. A search with floors but nothing to match is a request for the firehose minus a bit of it.

---

## Saved hunts

Type a name beside the buttons and press **Save hunt**. A saved hunt stores the **structured fields**, not the compiled string, which is what lets it load back into the form intact and pick up any later fix to the compiler. Each row in the **Saved hunts** list shows the name, its results tab, when it last ran, and the string it currently compiles to, with:

- **Copy** / **Open in X** — the same hand-off, straight from the list. Either one stamps "last run" (both mean the query left for X).
- **Load** — pulls every field back into the form. Editing then gives you **Save** (overwrite) and **Save as new**.
- **Pin** — pinned hunts sort to the top; the rest sort by most recently edited.
- **Delete** — two-step, the button asks *Really delete?* first.

**New hunt** clears the form and re-reads your defaults, so a change made in the gear is visible on the very next fresh hunt. (If you drag a slider in the gear and click **New hunt** in the same breath, close the gear first — the settings write is debounced by a fraction of a second.)

Your **unsaved** form is mirrored to local storage as you type, so closing the side panel mid-hunt doesn't lose it, and it always wins over the defaults when the tab reopens.

---

## The footer: did this actually fill the swipe file?

The last line of the tab counts the tweets you saved **off a search-results page** in the last 30 days:

> *12 tweets saved from search results, last 30 days.*

or, when there are none yet:

> *No tweets saved from search results yet — Save to stratus on any result counts here (last 30 days).*

This is the feature's own report card, and it is a real count, not a placeholder. When you click **Save to stratus** on a tweet, the page tells the server *which* x.com page you were on, and the server decides what that means: a `/search` page stamps the saved tweet's provenance as `outlier_search`, anything else as an ordinary scrape. Two properties worth knowing:

- **First save wins.** Provenance is written once, when the row is created. A tweet you found through a hunt and later re-save off your timeline keeps its `outlier_search` stamp, and vice versa — the column answers "how did this get into the library", which only the save that created the row can know.
- **The 30-day window is fixed and is not the hunt window.** Changing how far back your *hunts* look must not silently redefine what the counter underneath them measures.

A zero here is a measurement, so the line renders rather than hiding.

---

## Settings

The gear in this tab's header edits the six **Outliers** knobs (also visible in the [Settings](./settings-tab.md) tab):

| Setting | Ships as | What it decides |
|---|---|---|
| Default min likes | **400** | The likes floor a fresh hunt opens with. `0` omits the operator. |
| Default min reposts | **0** (off) | Likes and reposts measure much the same thing on most posts; stacking floors thins results faster than it sharpens them. |
| Default min replies | **0** (off) | The one to raise when hunting a *reply target* rather than swipe-file copy — replies mean an argument is already happening. |
| Default window | **30** days | How far back a fresh hunt looks. |
| Default language | **blank** | Blank means no `lang:` operator at all. |
| Default results tab | **top** | Which x.com tab **Open in X** lands on. |

They are **defaults handed to the form**, not rules anything enforces: changing one never touches a hunt you have already saved, and never changes the form you have open — only the next fresh one.

---

## Why there is no "search from inside stratus"

The results are worked on x.com. stratus never fetches them, and this is a cost decision made deliberately rather than a missing feature:

**X's API v2 has no `min_faves`, `min_retweets` or `min_replies` operator, at any access tier.** On the API, "minimum engagement" could only be a filter applied *after* the results came back — and X bills for every result it returns (~$0.005 per other-user post). A `min_faves:400` hunt would pay for roughly a hundred tweets to keep half a dozen. The web dialect supports these operators natively, at $0.

So the whole feature compiles a string and hands it to you. stratus's standing rule is that **the only billed X call is publishing a scheduled post**; this tab is that rule holding rather than bending. There is no API search path, no "estimated spend" display, and no results scraper — the per-tweet buttons already on the page cover capture with no new code.

---

## Watch items

- **X does not document the web search operator set, and a retired operator is *ignored*, not rejected.** That failure mode is the dangerous kind: the query silently returns the unfiltered firehose, and a broken feature looks exactly like a working one. The operators here were checked against live x.com on **2026-08-24** by reading the returned posts' own like counts. **If a hunt suddenly returns far more results, at much lower engagement, that is the symptom** — report it rather than assuming your topic got popular.
- **The 512-character cap is borrowed from X's API limit**, not measured against the web search box, whose real cap is undocumented and probably higher. It is deliberately the tighter bound: over-restricting shows you a fixable error, over-permitting truncates your query into something that quietly matches the wrong thing.
- **The ⊕ Add to Radar button on search results has not been confirmed by eye.** stratus's on-page decoration attaches the **Save to stratus** button and the **⊕ Add to Radar** pin from the same, path-agnostic scan loop, so both are expected on any page that renders tweets — this is a code reading, and it is a stronger one than the original design note, which had only read the Save button's attachment. The live check could not be paid from the session that shipped this doc, because the browser it drives does not have the stratus extension loaded (the control — the same two buttons on `/home`, where they certainly work — came back absent too). It's filed as an outstanding verification item; if you're on a search page and the ⊕ is missing while Save is present, that's the finding.
