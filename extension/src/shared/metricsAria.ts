// Locale-hardened parsing of X's action-row aria-label (§9.3). The label reads
// like "19 replies, 4 reposts, 38 likes, 2 bookmarks, 845 views" — but only in
// an English UI. The old English-only regexes silently zeroed every metric on
// non-English UIs, which fed zeros to the band model and the harvester without
// anyone noticing. This parser matches per-segment against multi-locale keyword
// stems and flags the label as `unparsed` when it plainly carries numbers that
// nothing matched — callers must shout (console.error), never swallow.

export interface AriaMetrics {
  replies: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  views: number;
  /** Label exists and contains digits, but every metric parsed to zero. */
  unparsed: boolean;
}

type MetricKey = 'replies' | 'reposts' | 'likes' | 'bookmarks' | 'views';

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

// One loud line per distinct label shape per session — enough to notice a
// locale gap without flooding the console on every rendered tweet.
const reported = new Set<string>();

export function reportUnparsed(context: string, label: string): void {
  const key = label.replace(/\d+/g, 'N');
  if (reported.has(key)) return;
  reported.add(key);
  console.error(
    `[stratus] metrics_unparsed (${context}): aria-label has numbers but no metric keyword matched — ` +
      `non-English UI? Metrics read as zero, which poisons the band model. Label: "${label}"`,
  );
}
