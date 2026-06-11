import { describe, expect, test } from 'bun:test';
import { parseMetricsAria } from './metricsAria.ts';

describe('parseMetricsAria (§9.3)', () => {
  test('English label parses every metric', () => {
    const m = parseMetricsAria('19 replies, 4 reposts, 38 likes, 2 bookmarks, 845 views');
    expect(m).toEqual({
      replies: 19,
      reposts: 4,
      likes: 38,
      bookmarks: 2,
      views: 845,
      unparsed: false,
    });
  });

  test('partial English label (zero metrics omitted by X)', () => {
    const m = parseMetricsAria('4 likes, 120 views');
    expect(m.likes).toBe(4);
    expect(m.views).toBe(120);
    expect(m.replies).toBe(0);
    expect(m.unparsed).toBe(false);
  });

  test('thousands separators: comma, dot, space', () => {
    expect(parseMetricsAria('1,234 views').views).toBe(1234);
    expect(parseMetricsAria('1.234 de vizualizări').views).toBe(1234);
    expect(parseMetricsAria('12 345 vues').views).toBe(12345);
  });

  test('Romanian UI parses (the locale that used to zero everything)', () => {
    const m = parseMetricsAria(
      '19 răspunsuri, 4 repostări, 38 de aprecieri, 2 marcaje, 845 de vizualizări',
    );
    expect(m).toEqual({
      replies: 19,
      reposts: 4,
      likes: 38,
      bookmarks: 2,
      views: 845,
      unparsed: false,
    });
  });

  test('French and Spanish stems', () => {
    const fr = parseMetricsAria('3 réponses, 2 republications, 9 j’aime, 1 signet, 410 vues');
    expect(fr.replies).toBe(3);
    expect(fr.likes).toBe(9);
    expect(fr.bookmarks).toBe(1);
    expect(fr.views).toBe(410);
    const es = parseMetricsAria('5 respuestas, 7 me gusta, 200 visualizaciones');
    expect(es.replies).toBe(5);
    expect(es.likes).toBe(7);
    expect(es.views).toBe(200);
  });

  test('German label', () => {
    const de = parseMetricsAria(
      '2 Antworten, 11 Gefällt mir-Angaben, 1 Lesezeichen, 300 Ansichten',
    );
    expect(de.replies).toBe(2);
    expect(de.likes).toBe(11);
    expect(de.bookmarks).toBe(1);
    expect(de.views).toBe(300);
  });

  test('unknown locale with numbers flags unparsed instead of silently zeroing', () => {
    const m = parseMetricsAria('19 svar, 845 visninger');
    expect(m.unparsed).toBe(true);
  });

  test('empty / null labels are not unparsed (ads carry no metrics label)', () => {
    expect(parseMetricsAria('').unparsed).toBe(false);
    expect(parseMetricsAria(null).unparsed).toBe(false);
    expect(parseMetricsAria(undefined).unparsed).toBe(false);
  });
});
