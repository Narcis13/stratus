// Locale-hardened reading of a tweet's engagement counts (§9.3). TWO readers,
// and the file name is historical — the aria-label was the only source until
// XR.7 added the fallback below.
//
// **The label** reads like "19 replies, 4 reposts, 38 likes, 2 bookmarks, 845
// views" — but only in an English UI. The old English-only regexes silently
// zeroed every metric on non-English UIs, which fed zeros to the band model and
// the harvester without anyone noticing. `parseMetricsAria` matches per-segment
// against multi-locale keyword stems and flags the label as `unparsed` when it
// plainly carries numbers that nothing matched.
//
// **The buttons** (`readMetricCounts`) are X's own testids, which are identical
// in every locale, so they answer where the stems run out. They are a FALLBACK
// and not the primary read for one reason: the label carries exact integers
// while a button carries the abbreviated face ("1.2K"), so trading one for the
// other would trade precision for coverage on every tweet instead of only on
// the ones we cannot otherwise read.
//
// Dependency-free by contract — both readers get inlined into the content-script
// IIFE (§7.26).

export interface AriaMetrics {
  replies: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  views: number;
  /** Label exists and contains digits, but every metric parsed to zero. */
  unparsed: boolean;
}

export type MetricKey = 'replies' | 'reposts' | 'likes' | 'bookmarks' | 'views';

// Keyword stems per metric, covering the locales X actually ships. Stems, not
// words — they match declensions ("răspunsuri", "Antworten", "visualizzazioni").
const KEYWORDS: Record<MetricKey, RegExp> = {
  replies:
    /repl|răspuns|raspuns|réponse|reponse|respuesta|resposta|rispost|antwort|yanıt|yanit|odpowied|antwoord|返信|回覆|回复|답글/i,
  reposts: /repost|retweet|redistribu|republicaci|republication|reenvi|リポスト|転載|转推|재게시/i,
  likes:
    /like|aprecier|j'aime|j’aime|me gusta|curtida|mi piace|gefällt|gefallt|beğeni|begeni|polubie|vind-ik-leuk|いいね|喜欢|마음에/i,
  bookmarks:
    /bookmark|marcaj|signet|guardado|salvo|segnalibr|lesezeichen|yer işaret|yer isaret|zakładk|zakladk|bladwijzer|ブックマーク|书签|북마크/i,
  views:
    /view|vizualiz|afișăr|afisar|vue|visualizacion|visualización|vista|visualizaç|visualizac|visualizzazion|ansicht|angezeigt|görüntülen|goruntulen|wyświetle|wyswietle|weergave|表示|查看|조회/i,
};

// Order matters only for overlap safety: check the most specific stems first
// within a segment (a segment maps to exactly one metric).
const KEYS: MetricKey[] = ['bookmarks', 'reposts', 'replies', 'views', 'likes'];

function segmentNumber(segment: string): number | null {
  // "1,234", "1.234", "1 234" — strip group separators; aria-labels carry full
  // integers, never abbreviated "1.2K".
  const m = segment.match(/\d[\d.,\s ]*/);
  if (!m) return null;
  const v = Number.parseInt(m[0].replace(/[^\d]/g, ''), 10);
  return Number.isFinite(v) ? v : null;
}

export function parseMetricsAria(label: string | null | undefined): AriaMetrics {
  const res: AriaMetrics = {
    replies: 0,
    reposts: 0,
    likes: 0,
    bookmarks: 0,
    views: 0,
    unparsed: false,
  };
  if (!label) return res;

  // Segment separator is comma-plus-space — a bare comma followed by digits is
  // an English thousands separator ("1,234 views"), not a boundary.
  for (const segment of label.split(/,\s+|[，、·]/)) {
    const n = segmentNumber(segment);
    if (n === null) continue;
    for (const key of KEYS) {
      if (KEYWORDS[key].test(segment)) {
        res[key] = n;
        break;
      }
    }
  }

  res.unparsed =
    /\d/.test(label) &&
    res.replies === 0 &&
    res.reposts === 0 &&
    res.likes === 0 &&
    res.bookmarks === 0 &&
    res.views === 0;
  return res;
}

// ------------------------------------------------------- the testid fallback

/** X's own testid on each action-row button. **Identical in every locale**,
 *  which is exactly what the aria-label is not — so when a locale slips past
 *  `KEYWORDS` these still answer.
 *
 *  Views have no button: X renders them as the analytics link at the end of the
 *  row, hence the separate selector. */
export const METRIC_BUTTON_TESTIDS: Readonly<Record<Exclude<MetricKey, 'views'>, string>> = {
  replies: 'reply',
  reposts: 'retweet',
  likes: 'like',
  bookmarks: 'bookmark',
};

export const VIEWS_LINK_SELECTOR = 'a[href*="/analytics"]';

/** "1,234" / "1.234" / "1 234" / "1.2K" / "3M" → an integer, or null.
 *
 *  **Group separators are locale-dependent and the abbreviation suffix is too,
 *  so this is a best effort by construction** — but it only ever runs where the
 *  alternative is a zero that looks like a measurement. Under 1,000 (most
 *  tweets) every locale renders bare digits and the answer is exact; above it a
 *  `K`/`M`/`B` face rounds, and an unrecognised suffix is read as the bare
 *  number rather than guessed at.
 *
 *  A bare "1.2" with no suffix is 12 once separators are stripped, which is why
 *  the decimal is only honoured when a magnitude suffix follows it. */
export function parseCountToken(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d[\d.,\s ]*)\s*([KMBkmb])?/);
  if (!m?.[1]) return null;
  const digits = m[1].trim();
  const suffix = m[2]?.toUpperCase();
  if (suffix) {
    const scale = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : 1e9;
    // The face is "1.2K" in some locales and "1,2 K" in others; either way the
    // last separator before a suffix is the decimal point.
    const n = Number.parseFloat(digits.replace(/[\s ]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * scale) : null;
  }
  const n = Number.parseInt(digits.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** Read the requested metrics off the action row's buttons instead of its label.
 *
 *  Prefers each control's OWN `aria-label`, where the count is an exact integer
 *  ("1234 Likes" — only the word is localized), and falls back to the visible,
 *  abbreviated face. Only counts it actually found are returned, so a caller
 *  merging these can never turn a real reading into a zero.
 *
 *  `keys` is the caller's missing set: this is a fallback and querying for a
 *  metric the label already supplied would cost DOM work on the harvester's
 *  scroll loop for an answer that is thrown away. */
export function readMetricCounts(
  root: Element,
  keys: readonly MetricKey[],
): Partial<Record<MetricKey, number>> {
  const out: Partial<Record<MetricKey, number>> = {};
  for (const key of keys) {
    const selector =
      key === 'views' ? VIEWS_LINK_SELECTOR : `[data-testid="${METRIC_BUTTON_TESTIDS[key]}"]`;
    const el = root.querySelector(selector);
    if (!el) continue;
    const n = parseCountToken(el.getAttribute('aria-label')) ?? parseCountToken(el.textContent);
    // A zero found here changes nothing a caller could act on, and X renders no
    // number at all for a zero metric — so "found 0" is really "found nothing".
    if (n !== null && n > 0) out[key] = n;
  }
  return out;
}

// One loud line per distinct label shape per session — enough to notice a
// locale gap without flooding the console on every rendered tweet.
const reported = new Set<string>();

/** `recovered` says the testid fallback filled the label's gap, which changes
 *  the CONSEQUENCE and not the finding: the locale gap is still real and still
 *  worth one line, but the data is no longer zeroed. Saying it poisons the band
 *  model when it does not is how a console warning stops being read. */
export function reportUnparsed(context: string, label: string, recovered = false): void {
  const key = label.replace(/\d+/g, 'N');
  if (reported.has(key)) return;
  reported.add(key);
  console.error(
    `[stratus] metrics_unparsed (${context}): aria-label has numbers but no metric keyword matched — ` +
      `non-English UI? ${
        recovered
          ? "Recovered from X's own testid buttons, so the numbers are right; the stem list is not."
          : 'Metrics read as zero, which poisons the band model.'
      } Label: "${label}"`,
  );
}
