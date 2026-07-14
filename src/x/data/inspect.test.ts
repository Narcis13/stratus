// S1 data core — whitelist, identifier validation, LIKE escaping, the SELECT
// guard (PRAGMA/ATTACH/multi-statement/tokens rejections), and the structural
// readonly guarantee. Runs against the in-memory auto-migrated DB
// (SQLITE_PATH=:memory:); the readonly-write test uses a real temp file.

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { like } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { people } from '../db/schema.ts';
import { InspectError, listTables, openReadonly, readTable, runSelect } from './inspect.ts';

const MARK = 'inspect_test_marker';
const H_PLAIN = 'inspect_test_ab';
const H_PCT = 'inspect_test_apctb';

async function seed(): Promise<void> {
  await db
    .insert(people)
    .values([
      { handle: H_PLAIN, notes: `${MARK} ab`, stage: 'stranger' },
      { handle: H_PCT, notes: `${MARK} a%b`, stage: 'stranger' },
    ])
    .onConflictDoNothing();
}

afterAll(async () => {
  await db.delete(people).where(like(people.notes, `${MARK}%`));
});

describe('listTables (whitelist)', () => {
  test('includes known app tables', () => {
    const names = listTables().map((t) => t.name);
    expect(names).toContain('people');
    expect(names).toContain('scheduled_posts');
    expect(names).toContain('cost_events'); // from shared-schema
  });

  test('excludes tokens entirely — not masked, absent', () => {
    expect(listTables().map((t) => t.name)).not.toContain('tokens');
  });

  test('never leaks migration scaffolding', () => {
    expect(listTables().map((t) => t.name)).not.toContain('__drizzle_migrations');
  });

  test('each table reports columns and a numeric row count', () => {
    const t = listTables().find((x) => x.name === 'people');
    expect(t).toBeDefined();
    expect(typeof t?.rowCount).toBe('number');
    expect(t?.columns.some((c) => c.name === 'handle' && c.pk)).toBe(true);
  });
});

describe('readTable', () => {
  test('unknown table → InspectError(unknown_table)', () => {
    expect(() => readTable('not_a_real_table')).toThrow('unknown_table');
  });

  test('sort against a non-existent column is rejected', () => {
    expect(() => readTable('people', { sort: 'no_such_col' })).toThrow('invalid_sort');
  });

  test('a valid column sort is accepted', () => {
    expect(() => readTable('people', { sort: 'handle', dir: 'desc' })).not.toThrow();
  });

  test('limit is clamped to 200 and bad limit/offset rejected', () => {
    expect(readTable('people', { limit: 9999 }).limit).toBe(200);
    expect(() => readTable('people', { limit: 0 })).toThrow('invalid_limit');
    expect(() => readTable('people', { offset: -1 })).toThrow('invalid_offset');
  });

  test('LIKE query escapes the user %/_ to literals', async () => {
    await seed();
    // 'a%b' must match ONLY the row whose notes literally contain "a%b" — if the
    // % were an unescaped wildcard, the 'ab' row would match too.
    const res = readTable('people', { q: 'a%b', limit: 200 });
    const hits = res.rows.filter((r) => String((r as { notes: string }).notes).startsWith(MARK));
    expect(hits.map((r) => (r as { handle: string }).handle)).toEqual([H_PCT]);
  });

  test('plain substring query matches both marked rows', async () => {
    await seed();
    const res = readTable('people', { q: MARK, limit: 200 });
    const handles = res.rows
      .map((r) => (r as { handle: string }).handle)
      .filter((h) => h.startsWith('inspect_test_'));
    expect(handles.sort()).toEqual([H_PLAIN, H_PCT].sort());
  });
});

describe('runSelect guard', () => {
  test('plain SELECT runs', () => {
    const r = runSelect('SELECT 1 AS a, 2 AS b');
    expect(r.rows).toEqual([{ a: 1, b: 2 }]);
    expect(r.columns).toEqual(['a', 'b']);
  });

  test('WITH (CTE) is allowed', () => {
    const r = runSelect('WITH x AS (SELECT 1 AS a) SELECT * FROM x');
    expect(r.rows).toEqual([{ a: 1 }]);
  });

  test('empty query rejected', () => {
    expect(() => runSelect('   ')).toThrow('empty_query');
  });

  test('non-SELECT first token rejected', () => {
    expect(() => runSelect('UPDATE people SET stage = "ally"')).toThrow('not_a_select');
    expect(() => runSelect('DELETE FROM people')).toThrow('not_a_select');
    expect(() => runSelect('DROP TABLE people')).toThrow('not_a_select');
    expect(() => runSelect('INSERT INTO people (handle) VALUES ("x")')).toThrow('not_a_select');
  });

  test('PRAGMA rejected', () => {
    expect(() => runSelect('PRAGMA table_info(people)')).toThrow('not_a_select');
  });

  test('ATTACH rejected', () => {
    expect(() => runSelect("ATTACH DATABASE 'x.db' AS y")).toThrow('not_a_select');
  });

  test('multiple statements rejected', () => {
    expect(() => runSelect('SELECT 1; DROP TABLE people')).toThrow('multiple_statements');
  });

  test('a single trailing semicolon is fine', () => {
    expect(() => runSelect('SELECT 1;')).not.toThrow();
  });

  test('tokens rejected by name (SELECT/subquery/CTE)', () => {
    expect(() => runSelect('SELECT * FROM tokens')).toThrow('tokens_forbidden');
    expect(() => runSelect('SELECT (SELECT count(*) FROM tokens) AS n')).toThrow(
      'tokens_forbidden',
    );
    expect(() => runSelect('WITH t AS (SELECT * FROM tokens) SELECT * FROM t')).toThrow(
      'tokens_forbidden',
    );
  });

  test('row cap at 500 with truncated flag', () => {
    const r = runSelect(`
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1000)
      SELECT n FROM seq`);
    expect(r.rowCount).toBe(500);
    expect(r.truncated).toBe(true);
  });

  test('a runtime SQL error surfaces as InspectError, not a 500', () => {
    expect(() => runSelect('SELECT * FROM no_such_table')).toThrow(InspectError);
  });
});

describe('readonly structural guarantee', () => {
  test('a { readonly: true } connection throws on write', () => {
    const p = join(tmpdir(), `inspect_ro_${process.pid}_${Date.now()}.db`);
    const w = new Database(p, { create: true });
    w.exec('CREATE TABLE t (x)');
    w.exec('INSERT INTO t VALUES (1)');
    w.close();
    const ro = openReadonly(p);
    try {
      expect(ro.query('SELECT count(*) AS n FROM t').get()).toEqual({ n: 1 });
      expect(() => ro.exec('INSERT INTO t VALUES (2)')).toThrow();
    } finally {
      ro.close();
      unlinkSync(p);
    }
  });
});
