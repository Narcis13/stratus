// N0.2 — niche CRUD + activation ratchet over the real (in-memory,
// auto-migrated) SQLite DB; bun run test runs with SQLITE_PATH=:memory:. The
// router carries no auth of its own (the /x bearer middleware is shared and
// covered by app.test/mcp.test), so it mounts on a bare Hono like channels.test.
// afterAll restores the single active `builder` row so the shared DB stays clean
// for other files (the store suite + mcp x_niche assume builder is present).

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { niches } from '../db/schema.ts';
import { DEFAULT_DOCTRINE, DEFAULT_NICHE } from '../niche/defaults.ts';
import { buildNicheWizardInput, parseNicheProposal } from '../niche/wizard.ts';
import { nicheRouter } from './niche.ts';

const app = new Hono();
app.route('/x', nicheRouter);

const N1 = 'nutrition-test-n2';
const N2 = 'fitness-test-n2';

const FULL = {
  slug: N1,
  label: 'Nutrition',
  persona: 'A registered dietitian who ships evidence-based meal plans.',
  beliefs: 'Whole foods > supplements. Adherence beats optimality.',
  replyPersona: 'I am a dietitian. I build in public.',
  description: 'Nutrition niche for the N0.2 route suite.',
};

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const parsed = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { status: res.status, body: parsed };
}

afterAll(() => {
  db.delete(niches)
    .where(inArray(niches.slug, [N1, N2]))
    .run();
  db.update(niches).set({ active: false }).run();
  const b = db.select({ slug: niches.slug }).from(niches).where(eq(niches.slug, 'builder')).get();
  if (b) {
    db.update(niches).set({ active: true }).where(eq(niches.slug, 'builder')).run();
  } else {
    db.insert(niches)
      .values({
        slug: DEFAULT_NICHE.slug,
        label: DEFAULT_NICHE.label,
        description: DEFAULT_NICHE.description,
        persona: DEFAULT_NICHE.persona,
        beliefs: DEFAULT_NICHE.beliefs,
        replyPersona: DEFAULT_NICHE.replyPersona,
        active: true,
      })
      .run();
  }
});

interface NicheRow {
  slug: string;
  label: string;
  active: boolean;
  doctrine: unknown;
}

describe('niche CRUD + activation', () => {
  test('GET /niche returns the active niche + resolved doctrine', async () => {
    const { status, body } = await send<{ niche: NicheRow; doctrine: typeof DEFAULT_DOCTRINE }>(
      '/x/niche',
      'GET',
    );
    expect(status).toBe(200);
    expect(typeof body.niche.slug).toBe('string');
    expect(body.niche.slug.length).toBeGreaterThan(0);
    // builder is seeded active with a null doctrine → all defaults.
    expect(body.doctrine).toEqual(DEFAULT_DOCTRINE);
  });

  test('POST /niches creates an INACTIVE niche', async () => {
    const { status, body } = await send<NicheRow>('/x/niches', 'POST', FULL);
    expect(status).toBe(201);
    expect(body.slug).toBe(N1);
    expect(body.active).toBe(false);
  });

  test('POST validation: bad slug 400, duplicate 409, missing persona 400', async () => {
    const bad = await send<{ error: string }>('/x/niches', 'POST', { ...FULL, slug: 'Bad Slug' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_slug');

    const dup = await send<{ error: string }>('/x/niches', 'POST', FULL);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('slug_exists');

    const noPersona = await send<{ error: string }>('/x/niches', 'POST', {
      slug: N2,
      label: 'Fitness',
      beliefs: 'b',
      replyPersona: 'r',
    });
    expect(noPersona.status).toBe(400);
    expect(noPersona.body.error).toBe('invalid_persona');
  });

  test('GET /niches lists active first', async () => {
    const { status, body } = await send<NicheRow[]>('/x/niches', 'GET');
    expect(status).toBe(200);
    expect(body[0]?.active).toBe(true);
    expect(body.some((r) => r.slug === N1)).toBe(true);
  });

  test('PATCH edits fields', async () => {
    const { status, body } = await send<NicheRow>(`/x/niches/${N1}`, 'PATCH', {
      label: 'Nutrition (edited)',
    });
    expect(status).toBe(200);
    expect(body.label).toBe('Nutrition (edited)');
  });

  test('activation swap is atomic — old active flips off in the same txn', async () => {
    const { status, body } = await send<NicheRow>(`/x/niches/${N1}`, 'PATCH', { active: true });
    expect(status).toBe(200);
    expect(body.active).toBe(true);

    // Invariant: at most one active row, and it is N1.
    const activeRows = db
      .select({ slug: niches.slug })
      .from(niches)
      .where(eq(niches.active, true))
      .all();
    expect(activeRows.length).toBe(1);
    expect(activeRows[0]?.slug).toBe(N1);

    const g = await send<{ niche: NicheRow }>('/x/niche', 'GET');
    expect(g.body.niche.slug).toBe(N1);
  });

  test('deactivating the only active niche → 409 last_active_niche', async () => {
    const { status, body } = await send<{ error: string }>(`/x/niches/${N1}`, 'PATCH', {
      active: false,
    });
    expect(status).toBe(409);
    expect(body.error).toBe('last_active_niche');
  });

  test('doctrine PATCH round-trips resolved values; garbage → 400', async () => {
    const ok = await send<NicheRow>(`/x/niches/${N1}`, 'PATCH', {
      doctrine: { replyTargetMin: 3, targetBandMaxX: 5 },
    });
    expect(ok.status).toBe(200);

    // N1 is active → GET /niche resolves its stored doctrine over defaults.
    const g = await send<{ doctrine: typeof DEFAULT_DOCTRINE }>('/x/niche', 'GET');
    expect(g.body.doctrine).toEqual({ ...DEFAULT_DOCTRINE, replyTargetMin: 3, targetBandMaxX: 5 });

    const bad = await send<{ error: string }>(`/x/niches/${N1}`, 'PATCH', {
      doctrine: { replyTargetMin: 'x' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_doctrine');
  });

  test('DELETE active → 409; reactivate builder then DELETE inactive → 200; unknown → 404', async () => {
    const active = await send<{ error: string }>(`/x/niches/${N1}`, 'DELETE');
    expect(active.status).toBe(409);
    expect(active.body.error).toBe('niche_active');

    // Swap the active niche back to builder — N1 becomes inactive.
    await send('/x/niches/builder', 'PATCH', { active: true });
    const inactive = await send<{ ok: boolean }>(`/x/niches/${N1}`, 'DELETE');
    expect(inactive.status).toBe(200);
    expect(inactive.body.ok).toBe(true);

    const gone = db.select({ slug: niches.slug }).from(niches).where(eq(niches.slug, N1)).get();
    expect(gone).toBeUndefined();

    const unknown = await send<{ error: string }>('/x/niches/does-not-exist-n2', 'DELETE');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe('not_found');
  });
});

// A valid, well-formed proposal Grok would return (structured outputs). Shared by
// the parse tests below.
const VALID_PROPOSAL = {
  slug: 'nutrition',
  label: 'Evidence-based nutrition',
  description: 'A registered dietitian building science-first meal systems in public.',
  persona: '- Registered dietitian, 10 years clinical.\n- Ships evidence-based plans.',
  beliefs: '- Whole foods > supplements.\n- Adherence beats optimality.',
  replyPersona: '- I am a dietitian.\n- I build in public.',
  pillars: [
    { slug: 'meal-prep', label: 'Meal prep — the HOW', body: 'Practical batch cooking systems.' },
    {
      slug: 'myth-busting',
      label: 'Myth busting — the WHY',
      body: 'Debunk fad diets with evidence.',
    },
    {
      slug: 'client-wins',
      label: 'Client wins — the WHO',
      body: 'Real adherence stories from clients.',
    },
  ],
  channels: [
    { slug: 'protein', label: 'Protein', keywords: ['Protein', 'whey', 'protein'] },
    { slug: 'fasting', label: 'Fasting', keywords: ['fasting', 'IF'] },
  ],
};

describe('niche wizard (N0.8)', () => {
  test('POST /niche/draft — empty description → 400 (pre-network)', async () => {
    const { status, body } = await send<{ error: string }>('/x/niche/draft', 'POST', {
      description: '   ',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_description');
  });

  test('POST /niche/draft — oversize description → 400 (pre-network)', async () => {
    const { status, body } = await send<{ error: string }>('/x/niche/draft', 'POST', {
      description: 'x'.repeat(5001),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_description');
  });

  test('POST /niche/draft — valid description, no XAI key → 503 (no Grok call)', async () => {
    // Force the key absent + restore, so this NEVER spends even on a dev machine
    // that has XAI_API_KEY set. The description is valid, so a 503 proves the key
    // check gates the paid call.
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = undefined;
    // biome-ignore lint/performance/noDelete: must actually unset, not set to "undefined"
    delete process.env.XAI_API_KEY;
    try {
      const { status, body } = await send<{ error: string }>('/x/niche/draft', 'POST', {
        description: 'A vegan nutrition coach who ships meal plans and debunks fad diets.',
      });
      expect(status).toBe(503);
      expect(body.error).toBe('grok_not_configured');
    } finally {
      if (prev !== undefined) process.env.XAI_API_KEY = prev;
    }
  });

  test('parseNicheProposal — valid proposal parses, keywords lowercased + deduped', () => {
    const p = parseNicheProposal(JSON.stringify(VALID_PROPOSAL));
    expect(p).not.toBeNull();
    expect(p?.slug).toBe('nutrition');
    expect(p?.pillars.length).toBe(3);
    expect(p?.channels.length).toBe(2);
    expect(p?.channels[0]?.keywords).toEqual(['protein', 'whey']);
  });

  test('parseNicheProposal — uncoercible niche slug → null', () => {
    expect(parseNicheProposal(JSON.stringify({ ...VALID_PROPOSAL, slug: '!!!' }))).toBeNull();
  });

  test('parseNicheProposal — wrong pillar count → null', () => {
    const two = { ...VALID_PROPOSAL, pillars: VALID_PROPOSAL.pillars.slice(0, 2) };
    expect(parseNicheProposal(JSON.stringify(two))).toBeNull();
  });

  test('parseNicheProposal — junk JSON → null', () => {
    expect(parseNicheProposal('not json {')).toBeNull();
  });

  test('buildNicheWizardInput puts the user description after the instruction block', () => {
    const desc = 'UNIQUE_MARKER_DESCRIPTION_9x7q';
    const [msg] = buildNicheWizardInput(desc);
    expect(msg?.content.indexOf(desc)).toBeGreaterThan(msg?.content.indexOf('EXAMPLE NICHE') ?? -1);
  });
});
