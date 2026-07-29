// SC.7 — the niche lexicon the static coach grades with. Always mounted, $0
// (pure SQL, no X read, no LLM), one static path so §7.20 can't bite.
//
//   GET /coach/lexicon → { niche, specificTerms, tribeTerms }
//
// `src/shared/postCoach.ts` takes its lexicon as an ARGUMENT and ships
// `DEFAULT_LEXICON` empty on purpose (SC decision 7 / D145b): a populated
// "neutral" list is exactly how a nutrition account ends up graded on whether
// it mentions ARR. This route fills it from what the operator already curates —
// the active niche's label, active channels' keywords, active pillars — so the
// two rules that read it speak the account's own vocabulary: `concrete_detail`
// (specificTerms) and the vocative branch of `hook_opener` (tribeTerms).
//
// The derivation is deliberately dumb and inspectable: lowercase, dedupe, sort.
// No LLM, no stemming, and matching stays postCoach's own word-boundary test
// (the same one `channelSuggest.ts` uses), so what you see in the payload is
// exactly what the coach looks for.
//
// The two lists are built DIFFERENTLY, because their errors cost opposite
// amounts:
//
//   specificTerms decides `concrete_detail`. A term that fires on every draft
//   silently disables the check, so terms enter WHOLE and only from lists the
//   operator wrote as terms (channel keywords, pillar slugs). Nothing is split:
//   a kebab slug like `ai-craft` then simply never matches — the safe direction
//   — while a one-word slug like `pricing` does.
//
//   tribeTerms decides one narrow branch of `hook_opener`: the draft has to
//   literally OPEN with "<term>," (the "<term>:" form already passes on the
//   colon alone). A generous list therefore costs almost nothing, while a
//   missing audience noun costs a false nudge — so labels ARE word-split here.

import { type SQL, and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { type CoachLexicon, DEFAULT_LEXICON } from '../../shared/postCoach.ts';
import { type ReachRow, buildReachFit } from '../coach/reach.ts';
import { channels, metricsSnapshots, postsPublished } from '../db/schema.ts';
import { loadActiveNicheSafe } from '../niche/store.ts';
import { getSetting } from '../settings/registry.ts';
import { getActivePillars } from './pillars.ts';

export const coachRouter = new Hono();

/** The lexicon plus the niche it was derived from — provenance, so an operator
 *  reading the payload can tell "empty" from "wrong niche active". */
export interface CoachLexiconPayload extends CoachLexicon {
  niche: string;
}

// Each list is capped and sorted. The cap is not tidiness: `concrete_detail`
// runs one regex per specific term on every keystroke in the Composer, and the
// panel holds the whole payload in memory. Sorting first makes the truncation
// deterministic (and the payload diffable between reads).
const MAX_TERMS = 200;

// A tribe term is a noun someone could be addressed as. Three letters or fewer
// is never that, and these are the ≥4-letter English function words that survive
// the length filter — everything shorter is already gone.
const LABEL_STOPWORDS = new Set([
  'about',
  'after',
  'also',
  'been',
  'before',
  'from',
  'have',
  'into',
  'just',
  'like',
  'more',
  'most',
  'much',
  'only',
  'over',
  'same',
  'some',
  'than',
  'that',
  'their',
  'them',
  'then',
  'they',
  'this',
  'very',
  'were',
  'what',
  'when',
  'where',
  'which',
  'will',
  'with',
  'your',
]);

const MIN_TRIBE_LEN = 4;

function capped(terms: Set<string>): string[] {
  return [...terms].sort().slice(0, MAX_TERMS);
}

/** Words of a human label that could plausibly be an audience noun: letters
 *  only (so "51-year-old" contributes "year"/"old", not a number), ≥4 chars,
 *  no function words. Unicode-aware — a Romanian or German label splits the
 *  same way an English one does. */
function labelWords(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= MIN_TRIBE_LEN && !LABEL_STOPWORDS.has(w));
}

/** Pure assembly — the whole derivation, so it can be read and tested without a
 *  DB. Inputs are the raw column values; normalization happens here. */
export function assembleCoachLexicon(input: {
  nicheLabel: string;
  channelLabels: string[];
  channelKeywords: (string[] | null)[];
  pillarSlugs: string[];
  pillarLabels: string[];
}): CoachLexicon {
  const specific = new Set<string>();
  for (const list of input.channelKeywords) {
    for (const kw of list ?? []) {
      const term = kw.trim().toLowerCase();
      if (term !== '') specific.add(term);
    }
  }
  for (const slug of input.pillarSlugs) {
    const term = slug.trim().toLowerCase();
    if (term !== '') specific.add(term);
  }

  const tribe = new Set<string>();
  for (const label of [input.nicheLabel, ...input.pillarLabels, ...input.channelLabels]) {
    for (const word of labelWords(label)) tribe.add(word);
  }

  return { specificTerms: capped(specific), tribeTerms: capped(tribe) };
}

// N0.6: a channel belongs to the active niche when its stamp matches — or is
// NULL (legacy rows pre-dating the column). The same scope `GET /channels` uses.
function ownedByNiche(slug: string): SQL | undefined {
  return or(eq(channels.niche, slug), isNull(channels.niche));
}

/** The active lexicon, for the route and for any server-side caller that wants
 *  a coach opinion. Never throws: a niche-layer or DB failure degrades to the
 *  neutral default, because a coach running on platform and prose rules alone is
 *  still right about two thirds of what it says (SC decision 7). */
export async function loadActiveCoachLexicon(): Promise<CoachLexiconPayload> {
  const niche = loadActiveNicheSafe();
  try {
    const channelRows = await db
      .select({ label: channels.label, keywords: channels.keywords })
      .from(channels)
      .where(and(eq(channels.active, true), ownedByNiche(niche.slug)));
    // The drafter's own loader — niche scope + the fresh-DB seed fallback live
    // there, so the coach and the prompt read one set of pillars.
    const pillarRows = await getActivePillars();
    return {
      niche: niche.slug,
      ...assembleCoachLexicon({
        nicheLabel: niche.label,
        channelLabels: channelRows.map((r) => r.label),
        channelKeywords: channelRows.map((r) => r.keywords),
        pillarSlugs: pillarRows.map((p) => p.slug),
        pillarLabels: pillarRows.map((p) => p.label),
      }),
    };
  } catch (err) {
    console.error(
      'coach: lexicon assembly failed, using default:',
      err instanceof Error ? err.message : err,
    );
    return { niche: niche.slug, ...DEFAULT_LEXICON };
  }
}

coachRouter.get('/coach/lexicon', async (c) => c.json(await loadActiveCoachLexicon()));

// ------------------------------------------------------- reach band (SC.8)

/** Own originals with the FIRST snapshot's raw view count — deliberately NOT
 *  the `latestOutcomes` shape every other aggregate uses, and the reason is in
 *  `../coach/reach.ts`'s header: the second snapshot only exists on posts that
 *  already won, so "latest" is two measurement protocols selected on the
 *  outcome. First-seen wins here because snapshots come back oldest-first.
 *
 *  $0 — two indexed reads over rows already paid for, no X call, no LLM. */
async function loadReachRows(): Promise<ReachRow[]> {
  const posts = await db
    .select({
      tweetId: postsPublished.tweetId,
      text: postsPublished.text,
      postedAt: postsPublished.postedAt,
    })
    .from(postsPublished)
    .where(eq(postsPublished.isReply, false));
  if (posts.length === 0) return [];

  const snaps = await db
    .select({
      tweetId: metricsSnapshots.tweetId,
      publicMetrics: metricsSnapshots.publicMetrics,
      nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
      ageAtSnapshotMin: metricsSnapshots.ageAtSnapshotMin,
    })
    .from(metricsSnapshots)
    .where(
      inArray(
        metricsSnapshots.tweetId,
        posts.map((p) => p.tweetId),
      ),
    )
    .orderBy(asc(metricsSnapshots.snapshotAt));

  const first = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!first.has(s.tweetId)) first.set(s.tweetId, s);

  return posts.map((p) => {
    const s = first.get(p.tweetId);
    const pub = (s?.publicMetrics ?? null) as Record<string, number> | null;
    const priv = (s?.nonPublicMetrics ?? null) as Record<string, number> | null;
    return {
      text: p.text,
      postedAt: p.postedAt,
      views: pub?.impression_count ?? priv?.impression_count ?? null,
      ageAtSnapshotMin: s?.ageAtSnapshotMin ?? null,
    };
  });
}

// One payload per mount, not one per keystroke: the fit only moves when a post
// publishes and gets measured, while the draft's format changes as you type. So
// the panel takes the whole table and looks up its own format locally — the
// same division of labour as `GET /posts/cooldowns` (SC.6).
coachRouter.get('/coach/reach', async (c) =>
  c.json(buildReachFit(await loadReachRows(), getSetting<number>('x.gates.minCellN'))),
);
