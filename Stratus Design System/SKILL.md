---
name: stratus-design
description: Use this skill to generate well-branded interfaces and assets for stratus (an X/Twitter growth, authoring & coaching AI agent in a Chrome side-panel extension), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference
- **Product:** stratus — an X (Twitter) growth/authoring/coaching agent that lives in a Chrome side panel *beside* x.com. Principle: **"stratus drafts, you post."**
- **Link one stylesheet:** `styles.css` (imports all tokens + the bundled Inter fonts).
- **Feel:** dark-first, near-black `#0e1014` canvas, one blue accent `#4f8cff`, Inter, compact 13px base, flat surfaces with 1px `#262c36` hairlines — X-adjacent but distinct. No gradients, no shadows (except modals), almost no icons.
- **Voice:** terse, operator-to-operator, second person, numbers-first, reassuring about control & cost, brand name always lowercase, no decorative emoji.
- **Components** live on `window.<Namespace>` after loading `_ds_bundle.js` (run the design-system check to get the exact namespace): Button, Badge, Chip, Field, Message, Panel, TabRail, Modal, KpiCard, QuotaBar, Sparkline.
- **See it assembled:** `ui_kits/sidepanel/` recreates the Today / Composer / Reply Master screens docked next to a dark X timeline.

## Files
- `readme.md` — full guide: sources, content fundamentals, visual foundations, iconography, component + kit index.
- `tokens/` — colors, typography, spacing, radii CSS custom properties.
- `fonts.css`, `assets/fonts/` — bundled Inter (400/700/800).
- `assets/logo.png` — the blue S brandmark.
- `components/` — React primitives (`<Name>.jsx` + `.d.ts` + `.prompt.md`).
- `guidelines/*.card.html` — foundation specimen cards.
- `ui_kits/sidepanel/` — interactive full-screen recreation.
