# UI kit — stratus side panel

A high-fidelity, interactive recreation of the **stratus Chrome side panel**, shown
docked against a dark **x.com** timeline — because the product's whole premise is
that it rides along *beside* X. Open `index.html` and click the tab rail to move
between the three built screens.

## Screens
- **`TodayScreen.jsx`** — the "what do I do next" home: quests + streak, the
  follower KPI with sparkline, today's plan (status-badged post rows), the reply
  quota bar, yesterday's numbers, and daily spend.
- **`ComposerScreen.jsx`** — write / AI-draft / schedule: the text field with a
  live 280 counter, the schedule row with *Best time* / *Next slot*, best-times
  hints, the live cost preview, and the Grok drafter producing three
  register-tagged draft cards (plain / spicy / reflective).
- **`ReplyScreen.jsx`** — "Reply Master": source-tweet context, angle variant
  chips, the reply editor with counter + toolbar (Copy / Regenerate / Mark
  posted / Discard), and grouped history.
- **`XTimeline.jsx`** — the backdrop x.com home column (dark theme). Not the
  product; it exists to demonstrate the companion fit.

## What it composes
Every panel screen is built from the design-system primitives on
`window.StratusDesignSystem_4635dc` — `Panel`, `Button`, `Badge`, `Field`,
`Chip`, `KpiCard`, `QuotaBar`, `TabRail`, `Message` — not bespoke markup. That is
the point of a UI kit: it shows the primitives assembled into real product views.

## Substitution flag
The X timeline backdrop uses **Lucide** icons (via CDN) as stand-ins for X's
proprietary glyphs (home, search, repost, etc.), which are not in the source repo
and must not be reconstructed. The stratus panel itself uses **no** icon set —
it relies on text tabs and a few Unicode glyphs, exactly like the real extension.
