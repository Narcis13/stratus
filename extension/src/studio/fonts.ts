// Deterministic typography (SURFACES S3.1): the bundled Inter WOFF2s load as
// 'StudioInter' via FontFace, so a card renders pixel-identical on every
// machine. Load failure is non-fatal — the font stack's system tail takes
// over and the Studio keeps working (the card just isn't byte-stable).
//
// SURFACES S5.6: the code/terminal card needs a monospace with a constant
// advance ratio across machines (MONO_ADVANCE) — bundled JetBrains Mono
// (OFL-1.1) loads as 'StudioMono' with the same non-fatal-failure pattern.

const FACES: ReadonlyArray<{ path: string; family: string; weight: string }> = [
  { path: 'fonts/Inter-Regular.woff2', family: 'StudioInter', weight: '400' },
  { path: 'fonts/Inter-Bold.woff2', family: 'StudioInter', weight: '700' },
  { path: 'fonts/Inter-ExtraBold.woff2', family: 'StudioInter', weight: '800' },
  { path: 'fonts/JetBrainsMono-Regular.woff2', family: 'StudioMono', weight: '400' },
  { path: 'fonts/JetBrainsMono-Bold.woff2', family: 'StudioMono', weight: '700' },
];

let loading: Promise<void> | null = null;

export function ensureStudioFonts(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      await Promise.all(
        FACES.map(async ({ path, family, weight }) => {
          try {
            const face = new FontFace(family, `url(${chrome.runtime.getURL(path)})`, {
              weight,
            });
            await face.load();
            document.fonts.add(face);
          } catch {
            // System fallback keeps rendering.
          }
        }),
      );
    })();
  }
  return loading;
}
