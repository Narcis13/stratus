// Deterministic typography (SURFACES S3.1): the bundled Inter WOFF2s load as
// 'StudioInter' via FontFace, so a card renders pixel-identical on every
// machine. Load failure is non-fatal — the font stack's system tail takes
// over and the Studio keeps working (the card just isn't byte-stable).

const FACES: ReadonlyArray<{ path: string; weight: string }> = [
  { path: 'fonts/Inter-Regular.woff2', weight: '400' },
  { path: 'fonts/Inter-Bold.woff2', weight: '700' },
  { path: 'fonts/Inter-ExtraBold.woff2', weight: '800' },
];

let loading: Promise<void> | null = null;

export function ensureStudioFonts(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      await Promise.all(
        FACES.map(async ({ path, weight }) => {
          try {
            const face = new FontFace('StudioInter', `url(${chrome.runtime.getURL(path)})`, {
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
