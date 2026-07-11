// generateImages — the one place all xAI *image* calls go through (SURFACES S4).
// Mirrors the discipline askGrok gives text: bearer auth, retry on 429/5xx,
// fire-and-forget cost log into `cost_events`. Different endpoint and meter
// from the text path: POST /v1/images/generations, billed per image (flat),
// logged under platform 'xai' (the token-priced text spend stays under 'grok').
//
// The taint trap (S4): an xAI image URL is cross-origin, so drawing it straight
// onto a canvas taints it and toBlob throws. We request `b64_json` so xAI hands
// back base64 directly — no URL ever reaches the extension. If a model ignores
// the flag and returns a URL anyway, we download it server-side and encode; the
// caller only ever sees base64.

import { db } from '../db/client.ts';
import { costEvents } from '../db/shared-schema.ts';
import { isKnownImageModel, priceForImage } from './pricing.ts';

const GROK_API_BASE = 'https://api.x.ai/v1';
export const DEFAULT_IMAGE_MODEL = 'grok-2-image';

export interface GenerateImagesOptions {
  prompt: string;
  /** 1..2 (S4 caps a paint click at two). */
  n?: number;
  model?: string;
  maxAttempts?: number;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  /** Raw base64 (no data: prefix). */
  base64: string;
  /** Sniffed from magic bytes — xAI returns JPEG; PNG/WebP handled defensively. */
  mediaType: string;
  /** xAI's rewritten prompt, when present. */
  revisedPrompt: string | null;
}

export interface GenerateImagesResult {
  images: GeneratedImage[];
  model: string;
  costUsd: number;
  durationMs: number;
  requestId: string | null;
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  error?: { message?: string; type?: string; code?: string };
}

export class GrokImageError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
    public requestId: string | null,
  ) {
    super(message);
    this.name = 'GrokImageError';
  }
}

export async function generateImages(opts: GenerateImagesOptions): Promise<GenerateImagesResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY is required');

  const model = opts.model ?? DEFAULT_IMAGE_MODEL;
  const n = Math.max(1, Math.min(2, Math.trunc(opts.n ?? 1)));
  const prompt = opts.prompt.trim();
  if (prompt === '') throw new Error('generateImages: prompt is required');

  const body = { model, prompt, n, response_format: 'b64_json' };
  const maxAttempts = opts.maxAttempts ?? 3;
  const start = performance.now();
  let attempt = 0;
  let lastErr: unknown;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      };
      if (opts.signal) init.signal = opts.signal;
      const res = await fetch(`${GROK_API_BASE}/images/generations`, init);
      const requestId = res.headers.get('x-request-id');

      if (res.ok) {
        const data = (await res.json()) as ImagesResponse;
        const images = await extractImages(data);
        const durationMs = performance.now() - start;
        // Bill for what X actually returned, not what we asked for.
        const costUsd = priceForImage(model, images.length);
        if (!isKnownImageModel(model) && images.length > 0) {
          console.warn(
            `grok images: model '${model}' has no price-table entry — this call logged $0. Add it to src/grok/pricing.ts.`,
          );
        }
        logImageCost({
          status: res.status,
          count: images.length,
          costUsd,
          durationMs,
          attempts: attempt,
          requestId,
        });
        return { images, model, costUsd, durationMs, requestId };
      }

      const errText = await res.text();
      const parsed = safeParseError(errText);
      const apiErr = new GrokImageError(
        res.status,
        parsed?.code ?? null,
        parsed?.message ?? `xAI ${res.status} ${res.statusText}`,
        requestId,
      );
      if (shouldRetry(res.status) && attempt < maxAttempts) {
        await sleep(retryDelay(res, attempt));
        continue;
      }
      logImageCost({
        status: res.status,
        count: 0,
        costUsd: 0,
        durationMs: performance.now() - start,
        attempts: attempt,
        requestId,
      });
      throw apiErr;
    } catch (err) {
      lastErr = err;
      if (err instanceof GrokImageError) throw err;
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (attempt < maxAttempts) {
        await sleep(retryDelay(null, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('generateImages: exhausted attempts');
}

async function extractImages(data: ImagesResponse): Promise<GeneratedImage[]> {
  const out: GeneratedImage[] = [];
  for (const item of data.data ?? []) {
    const revisedPrompt = item.revised_prompt ?? null;
    if (item.b64_json) {
      out.push({ base64: item.b64_json, mediaType: sniffFromBase64(item.b64_json), revisedPrompt });
      continue;
    }
    // Defensive fallback: a model ignored response_format and returned a URL.
    // Download server-side so a cross-origin URL never reaches the extension.
    if (item.url) {
      const r = await fetch(item.url);
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      out.push({
        base64: Buffer.from(buf).toString('base64'),
        mediaType: r.headers.get('content-type') ?? sniffBytes(buf),
        revisedPrompt,
      });
    }
  }
  return out;
}

// --- image type sniff (magic bytes) — xAI returns JPEG; be robust anyway ---

function sniffBytes(b: Uint8Array): string {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'image/png';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'image/webp';
  return 'image/jpeg';
}

function sniffFromBase64(b64: string): string {
  // Decode just the header; the first 16 bytes cover every magic we check.
  const head = Buffer.from(b64.slice(0, 24), 'base64');
  return sniffBytes(new Uint8Array(head));
}

function safeParseError(body: string): { message?: string; type?: string; code?: string } | null {
  try {
    const j = JSON.parse(body) as { error?: { message?: string; type?: string; code?: string } };
    return j.error ?? null;
  } catch {
    return null;
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504);
}

function retryDelay(res: Response | null, attempt: number): number {
  const ra = res?.headers.get('retry-after');
  if (ra) {
    const sec = Number.parseFloat(ra);
    if (!Number.isNaN(sec)) return Math.min(60_000, sec * 1000) + jitter();
  }
  return Math.min(16_000, 1000 * 2 ** (attempt - 1)) + jitter();
}

function jitter(): number {
  return Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface LogImageCost {
  status: number;
  count: number;
  costUsd: number;
  durationMs: number;
  attempts: number;
  requestId: string | null;
}

function logImageCost(info: LogImageCost): void {
  // Fire-and-forget: a failed insert must never break the caller (same
  // guarantee as askGrok's logCost and costTracker).
  try {
    db.insert(costEvents)
      .values({
        platform: 'xai',
        endpoint: '/v1/images/generations',
        status: info.status,
        items: info.count || null,
        costUsd: Number(info.costUsd.toFixed(5)),
        durationMs: Math.round(info.durationMs),
        attempts: info.attempts,
        requestId: info.requestId,
      })
      .run();
  } catch (err) {
    console.error('grok image cost log failed:', err instanceof Error ? err.message : err);
  }
}
