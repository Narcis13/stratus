# PEOPLE-GRAPH-PLAN.md — implementation plan for Milestone R1 (the People Graph)

> The executable plan behind R1 of `RELATIONSHIP-OS-PROPOSAL.md`. Ships the `person`
> spine, the unified contact card, notes/tags, follow flags, and follow-up cadence —
> the foundation the rest of the Relationship OS stands on. Grounded in the real code
> (`src/x/db/schema.ts`, `src/x/routes/voice.ts`, `src/x/index.ts`, `extension/src/sidepanel/`).

---

## 1. Goal

Give stratus a first-class **person** it can build relationships on, by *synthesizing data it
already stores* rather than capturing anything new. When done:

- Every handle you've ever touched (saved a tweet from, replied to, been mentioned by, harvested)
  has one canonical `people` row.
- `GET /x/people/:handle` returns a **contact card**: profile + a merged interaction timeline +
  per-interaction outcomes + reciprocity + suggested relationship stage.
- You can add **notes**, **tags**, an **objective**, and override the **stage** on any person.
- Neglected relationships surface (follow-up cadence), reusing the `/x/voice/targets` join pattern.

All $0 (pure SQL + DOM-scraped enrichment). No X API, no Grok in R1.

---

## 2. Design: a new spine, not an overloaded `voice_authors`

`voice_authors` is *semantically* "authors I saved for voice/style reference" — keyed by handle,
with profile + a follower-momentum series. Tempting to reuse, but **overloading it is wrong**:
someone who mentions you or whom you reply to is not necessarily a voice author, and auto-inserting
them into `voice_authors` would pollute the swipe library and the Targets roster.

**Decision:** add a parallel **`people`** table (handle PK, lowercased — the same stable key
`voice.ts` already normalizes to) as the canonical relationship spine. It is created/updated lazily
by a `touchPerson()` helper called from the existing write paths. The contact card LEFT JOINs
`voice_authors` for profile/momentum when present, and UNIONs the interaction sources.

- Additive & non-destructive (like `account_snapshots` was) — no rewrite of existing tables.
- `people.handle` is the join key everywhere; `reply_drafts` already matches on
  `lower(source_author_username)`, `mentions` has `author_username`, `voice_authors` is already
  lowercased. One normalizer (`normalizeHandle`, already in `voice.ts`) governs all of it.
- The interaction **timeline is derived** (a UNION over existing tables) — no duplicated event
  store. Only *non-derivable* facts (notes, manual stage override, tags, follow flags) get columns.

---

## 3. Schema (`src/x/db/schema.ts`)

Append these to the existing schema file (same idioms: `timestamp_ms` integers, `json` mode text,
`sql\`(unixepoch() * 1000)\`` defaults, `crypto.randomUUID` PKs, `index(...)`).

```ts
// The relationship spine (Milestone R1). One row per person you've touched — saved
// a tweet from, replied to, been mentioned by, or harvested. Created/updated lazily
// by touchPerson() from the existing write paths; never captured directly. Handle is
// the lowercased @handle (same key voice_authors uses). Profile/momentum are NOT
// duplicated here — the contact card LEFT JOINs voice_authors for those.
export const people = sqliteTable(
  'people',
  {
    handle: text('handle').primaryKey(), // lowercased, no '@'
    xUserId: text('x_user_id'),
    displayName: text('display_name'),
    // Manual CRM fields — null stage means "use the computed suggestion".
    stage: text('stage'), // null | stranger | warming | engaged | mutual | ally
    objective: text('objective'), // freeform: "collab on MCP content", "just learn from"
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
    // Follow relationship — DOM-scraped on the "Save author" enrich path (R1.4).
    // null = unknown (never scraped); true/false = observed on the profile page.
    followsMe: integer('follows_me', { mode: 'boolean' }),
    iFollow: integer('i_follow', { mode: 'boolean' }),
    // Denormalized for cheap sorting/reminders — recomputed on each touch and by a
    // backfill. last_touch_at = max over (my posted replies to them, my saves of them).
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    lastTouchAt: integer('last_touch_at', { mode: 'timestamp_ms' }),
    // Where we first saw them, for provenance: voice | reply | mention | harvest.
    firstSource: text('first_source').notNull().default('voice'),
    retired: integer('retired', { mode: 'boolean' }).default(false).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    index('people_stage_idx').on(t.stage),
    index('people_last_touch_idx').on(t.lastTouchAt),
  ],
);

// Append-only, timestamped CRM notes / manual log entries for a person (R1.3).
// Freeform ("met in @x's replies, into local-LLM"), plus a `kind` so future
// automatic events (milestone hit, stage change) can share the timeline.
export const personNotes = sqliteTable(
  'person_notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    handle: text('handle')
      .notNull()
      .references(() => people.handle),
    body: text('body').notNull(),
    kind: text('kind').notNull().default('note'), // note | system
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [index('person_notes_handle_created_idx').on(t.handle, t.createdAt)],
);
```

**Circles (R3) are deliberately deferred** — R1 ships the spine only. When R3 lands it adds
`circles` + `circle_members`; no change to `people`.

### Migration

Follow the house flow exactly:

```bash
bun run drizzle-kit generate   # emits src/db/migrations/000X_*.sql from the schema diff
```

Boot auto-applies it (`src/db/client.ts` runs the bun-sqlite migrator unless `SKIP_MIGRATE=1`);
`deploy.sh` also runs `drizzle-kit migrate`. **Verify the generated SQL** creates only the two new
tables + indexes and touches nothing else (the §"Infra" note in CLAUDE.md warns that generate can
silently drop a seed INSERT — eyeball the diff).

**Backfill (one-time, in the same migration or a `scripts/backfill-people.ts`):** seed `people`
from the union of existing handles so the graph isn't empty on day one —

```sql
INSERT OR IGNORE INTO people (handle, display_name, first_source, first_seen_at, updated_at)
SELECT handle, display_name, 'voice', added_at, added_at FROM voice_authors;
INSERT OR IGNORE INTO people (handle, first_source, first_seen_at, updated_at)
SELECT DISTINCT lower(source_author_username), 'reply', min(created_at), min(created_at)
  FROM reply_drafts GROUP BY lower(source_author_username);
INSERT OR IGNORE INTO people (handle, first_source, first_seen_at, updated_at)
SELECT DISTINCT lower(author_username), 'mention', min(posted_at), min(posted_at)
  FROM mentions WHERE author_username IS NOT NULL GROUP BY lower(author_username);
-- harvest handles optional (can be noisy); include orig_handle for replies-mode targets.
```

Then run the `last_touch_at` recompute (see §5) once.

---

## 4. The `touchPerson()` integration

One helper, called from each existing write path so the graph stays live. Put it in a new
`src/x/people.ts` (mirrors `src/x/mentions.ts`).

```ts
// Upsert a person from any signal. Fill-only on existing rows (never clobber a
// manual displayName/stage); bumps lastTouchAt when the signal is an interaction.
export async function touchPerson(
  handle: string,
  signal: {
    source: 'voice' | 'reply' | 'mention' | 'harvest';
    displayName?: string | null;
    xUserId?: string | null;
    at?: Date;          // interaction time — advances last_touch_at
    interaction?: boolean; // true for reply/mention; false for a mere save
  },
): Promise<void> { /* INSERT ... ON CONFLICT DO UPDATE, fill-only, like fillAuthor() */ }
```

Wire the calls (all cheap, all inside existing handlers):

| Call site | File | When |
|---|---|---|
| voice scrape / enrich | `routes/voice.ts` (`fillAuthor`, `PUT authors/:handle`) | on save (`interaction:false`) |
| reply generate | `routes/replies.ts` | on draft create (`source:'reply'`, `interaction:false`) |
| reply → posted | `routes/replies.ts` PATCH (status→posted) | `interaction:true`, `at:` = paste time |
| mentions pull | `mentions.ts::pullMentions` | per inserted mention (`source:'mention'`, `interaction:true`) |
| harvest ingest | `routes/harvest.ts` | per row handle (`source:'harvest'`, `interaction:false`) |

`touchPerson` is idempotent and fill-only — reuse the exact "only overwrite still-null columns"
logic from `voice.ts::fillAuthor` so a manual `displayName`/`stage` is never stomped.

---

## 5. Computed stage + last-touch

Pure functions in `src/x/people.ts`, unit-tested like `authorMomentum`/`rankTargets`.

**`lastTouchAt`** = `max(` posted `reply_drafts.updated_at` where `lower(source_author_username)=handle`,
`voice_tweets.saved_at` where `author_handle=handle` `)`. Recomputed inside `touchPerson` for the
touched handle and by a backfill pass over all handles (one grouped query each, like the
`replyAgg` in `voice.ts`).

**Suggested stage** (used only when `people.stage` override is null):

```ts
export function suggestStage(sig: {
  followsMe: boolean | null; iFollow: boolean | null;
  mentionsFromThem: number;        // count in `mentions`
  repliesToThemPosted: number;     // count posted in `reply_drafts`
  theyRepliedToMe: number;         // mentions that are in_reply_to one of my posts
}): 'stranger' | 'warming' | 'engaged' | 'mutual' | 'ally' {
  const mutualFollow = sig.followsMe === true && sig.iFollow === true;
  const twoWay = sig.mentionsFromThem > 0 && sig.repliesToThemPosted > 0;
  if ((mutualFollow || twoWay) && sig.theyRepliedToMe >= 3) return 'ally';
  if (mutualFollow || twoWay) return 'mutual';
  if (sig.repliesToThemPosted >= 2 || sig.mentionsFromThem >= 1) return 'engaged';
  if (sig.repliesToThemPosted >= 1) return 'warming';
  return 'stranger';
}
```

Thresholds are first-guess and belong in one constants block so they're tunable (same discipline as
the BAND constants). The card returns both `stage` (override) and `suggestedStage`.

---

## 6. Endpoints — `src/x/routes/people.ts`

New Hono router, `createPeopleRouter()`, mounted in `src/x/index.ts` right after voice:
`app.route('/x', createPeopleRouter());`. All $0.

```
GET    /people?stage=&tag=&q=&needsFollowup=&sort=&limit=   list/search, ranked
GET    /people/:handle                                       the full contact card
PATCH  /people/:handle   { stage?, objective?, tags?, followsMe?, iFollow?, retired? }
POST   /people/:handle/notes   { body }                      append a note
DELETE /people/:handle/notes/:id                             remove a note
```

**`GET /people`** — list with filters (`stage`, `tag` via JSON `like`, `q` substring on
handle/displayName with the `escape '\'` pattern from `voice.ts`, `needsFollowup=true` →
`last_touch_at` older than the cadence or null). `sort` ∈ `recent | stale | stage`. For each row,
LEFT JOIN latest `voice_author_snapshots`/`voice_authors` for followers + momentum
(reuse `authorMomentum`) and the posted-reply agg (reuse the `voice.ts` `replyAgg` join verbatim).

**`GET /people/:handle`** — the contact card. Assemble in parallel `Promise.all` (the queries are
independent), then stitch:

```ts
const [person, notes, profile, momentumPts, myReplies, theirMentions, savedTweets] =
  await Promise.all([
    db.select().from(people).where(eq(people.handle, handle)),                 // spine + overrides
    db.select().from(personNotes).where(eq(personNotes.handle, handle))
      .orderBy(desc(personNotes.createdAt)),
    db.select().from(voiceAuthors).where(eq(voiceAuthors.handle, handle)),     // bio, pinned, followers
    db.select().from(voiceAuthorSnapshots).where(eq(voiceAuthorSnapshots.handle, handle))
      .orderBy(asc(voiceAuthorSnapshots.capturedAt)),                          // → authorMomentum()
    // my replies to them + each reply's latest metrics (join posts_published → metrics_snapshots,
    // exactly the /x/replies/outcomes chain, filtered by lower(source_author_username)=handle)
    myRepliesWithOutcomes(handle),
    db.select().from(mentions).where(eq(sql`lower(${mentions.authorUsername})`, handle))
      .orderBy(desc(mentions.postedAt)),
    db.select().from(voiceTweets).where(eq(voiceTweets.authorHandle, handle))
      .orderBy(desc(voiceTweets.createdAt)),
  ]);
```

Then build the response:

```jsonc
{
  "handle": "santoshstack",
  "profile": { "displayName": "...", "bio": "...", "followersCount": 12000,
               "followsMe": true, "iFollow": false, "profileUrl": "...",
               "momentum": { "delta": 340, "days": 12, "perDay": 28 } },
  "stage": null, "suggestedStage": "engaged", "objective": null, "tags": ["#ai-builder"],
  "reciprocity": { "repliesISent": 8, "mentionsFromThem": 1, "theyRepliedToMe": 1,
                   "balance": "one-sided" },
  "lastTouchAt": 1717000000000, "needsFollowup": true, "cadenceDays": 14,
  "timeline": [ /* merged, newest-first UNION of the four sources, tagged by type */
    { "type": "reply_sent",   "at": ..., "tweetId": "...", "text": "...",
      "outcome": { "views": 1200, "profileVisits": 14 } },
    { "type": "mention_recv", "at": ..., "tweetId": "...", "text": "..." },
    { "type": "tweet_saved",  "at": ..., "tweetId": "...", "text": "..." },
    { "type": "note",         "at": ..., "body": "met in @x's replies" }
  ],
  "notes": [ ... ]
}
```

The `timeline` is built in JS by concatenating the four typed lists and sorting by `at` desc — no
SQL UNION needed, and each entry keeps its type-specific fields (outcome only on `reply_sent`).

**PATCH** validates: `stage` ∈ the enum or null; `tags` a string[]; `followsMe`/`iFollow` boolean
or null; `objective` a string. Reuse `readJson`/`normalizeHandle` from the voice route (extract
them to a shared `src/x/routes/_http.ts` or copy — the codebase currently copies).

---

## 7. Extension — the People tab

**Tab registration** (`extension/src/sidepanel/App.tsx`): add `'people'` to the `Tab` union and the
`TABS` array (between `voice` and `replies` reads well), and a render branch
`activeTab === 'people' ? <PeoplePanel settings={settings} initialHandle={...} /> : ...`.

**API client** (`extension/src/sidepanel/api.ts`): add a `people` namespace mirroring `voice`:

```ts
people: {
  list(s, opts) { /* GET /x/people?... */ },
  get(s, handle) { /* GET /x/people/:handle */ },
  patch(s, handle, body) { /* PATCH */ },
  addNote(s, handle, body) { /* POST /x/people/:handle/notes */ },
},
```

Add the matching types to `extension/src/shared/types.ts` (`Person`, `PersonCard`, `TimelineEntry`,
`RelationshipStage`).

**Components** (`extension/src/sidepanel/People.tsx`, + `PersonCard.tsx`):
- **List view:** search + stage filter + a "needs follow-up" toggle; rows show handle, stage chip,
  followers + momentum, "last touch N days ago" (amber when > cadence, mirroring the Targets amber),
  reciprocity balance. Ranked by the `sort` param.
- **Card view:** the contact card — profile header, stage selector (override), objective + tags
  editors, the merged timeline (typed icons), reply outcomes inline, and a notes composer.
- **Deep links:** the Targets and Radar rows already carry handles — add a "Open contact" action
  that sets `initialHandle` and switches to the People tab (same pattern as `startEdit`/`startRemix`
  in `App.tsx`). Reply Master's source author gets the same link (this is the seam R2 plugs into).

**DOM enrichment for follow flags (R1.4):** extend the existing "Save author" content-script scrape
to also read the "Follows you" badge and the Follow/Following button label, POST them to
`PATCH /x/people/:handle` (`followsMe`/`iFollow`). Human-paced, on-screen, $0 — no API.

---

## 8. Tests

Match the house test discipline (`bun:test`, pure functions + money-path guards):

- `src/x/people.test.ts` — `suggestStage` truth table, `lastTouch` selection, `touchPerson`
  fill-only semantics (never clobbers a manual field), timeline merge/sort ordering.
- Extend `src/app.test.ts` — the pre-DB validation guards on `PATCH /people/:handle` (bad stage →
  400, bad tags → 400) and `POST notes` (empty body → 400), plus bearer 401 on `/x/people`.
- `scripts/smoke-people.ts` — rerunnable end-to-end over the real DB (in-process Hono, like
  `scripts/smoke-targets.ts`): touch a throwaway handle from each source, assert the card stitches
  all four timeline types, assert `needsFollowup` flips with a backdated `last_touch_at`, clean up.

---

## 9. Task breakdown (build order)

1. **Schema + migration.** Add `people` + `person_notes`; `drizzle-kit generate`; eyeball the SQL;
   write the backfill INSERTs + the one-time `last_touch_at` recompute.
2. **`src/x/people.ts`** — `touchPerson`, `suggestStage`, `lastTouch`, reciprocity helpers + unit tests.
3. **Wire `touchPerson`** into voice / replies / mentions / harvest write paths (5 call sites).
4. **`src/x/routes/people.ts`** — the five endpoints; mount in `index.ts`; app.test guards.
5. **`scripts/smoke-people.ts`** — green end-to-end.
6. **Extension** — types, `api.people`, `People.tsx` + `PersonCard.tsx`, tab in `App.tsx`, deep
   links from Targets/Radar/Replies.
7. **DOM follow-flag capture** (R1.4) in the content script.
8. **Docs** — add "Milestone R1" to `PLAN.md` + a CLAUDE.md phase-status line; note the new tables.

Steps 1–5 are the shippable server slice (usable via the stratus skill/CLI immediately); 6–7 are
the UI; 8 keeps the one-source-of-truth discipline.

---

## 10. Compliance & guardrails (R1-specific)

- **$0.** No X API, no Grok in R1 — pure SQL over stored data + DOM-scraped follow flags.
- **Follow flags are DOM-only**, captured from a profile you're already viewing — never the
  follower/following-list API (5× cost, pagination caps, invariant #5 territory).
- **The reciprocity ledger is personal bookkeeping.** No amplification asks, no "reply back"
  automation — it only counts real, already-happened interactions.
- **No new automated writes.** `people`/`person_notes` are written only by user actions and by the
  `touchPerson` upsert that rides on writes you already trigger.
- **Per-platform isolation** holds — everything lives under `src/x/`.

---

## 11. Open decisions (worth a quick call before/while building)

1. **Include harvest handles in the spine?** They can be noisy (you harvest people you don't
   interact with). Proposal: include but tag `first_source:'harvest'` and default-hide them behind a
   filter so the graph stays "people I actually engage."
2. **Cadence default.** 14 days (proposed) vs per-stage cadence (allies weekly, warming biweekly).
   Start with one global number; make it per-stage in R4 if it earns its complexity.
3. **`display_name` source of truth** when voice_authors and mentions disagree — proposal: prefer a
   manual override, else voice_authors (profile-scraped), else the most recent scraped name.
4. **Stage override vs. suggestion drift** — when signals later imply a *higher* stage than your
   manual override, surface "suggested: mutual (you set: warming)" rather than auto-bumping.
```
