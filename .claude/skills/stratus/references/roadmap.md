# Roadmap — planned surfaces (NOT live yet)

The `plans/` folder holds the next development wave. **None of the endpoints below
exist until their plan ships.** Before using one, probe:

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' "$STRATUS_BASE_URL/x/me" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN")
# 404 → not deployed yet; fall back to what exists and tell the user it's planned.
```

When a probe succeeds, the plan file in `plans/` is the spec — read it before
driving the new surface, then update this file (move the feature to "shipped" in
SKILL.md's endpoint map and document shapes in the right reference file).

## What's coming (one line each, with the operator-relevant deltas)

- **Me profile** (`2026-07-16-me-profile.md`) — personal-context layer injected at
  every draft's prompt tail. `GET /x/me`, `POST/PATCH/DELETE /x/me/entries`
  (kinds: fact|event|emotion|note; emotions fresh 7d, events 30d),
  `POST/PATCH/DELETE /x/me/goals`, `GET /x/me/context?mode=post|reply` (see
  exactly what the AI sees). MCP: `x_me`, `x_add_me_entry`. Coach angle: journal
  session events into `/x/me/entries` so drafts sound like *this specific week*.
- **Niche** (`2026-07-16-niche.md`) — persona/beliefs/doctrine knobs become a DB
  entity. `GET /x/niche` (active + resolved doctrine), `GET/POST /x/niches`,
  `PATCH/DELETE /x/niches/:slug`, `POST /x/niche/draft` (AI wizard, ~$0.01).
  Doctrine knobs will drive brief quota + targets band — read them from
  `/x/niche` instead of assuming 10–20 and 2–10×. New drafter refusal:
  `409 no_pillars_for_niche`.
- **Reply lists** (`2026-07-16-reply-lists.md`) — canned-reply lists with var
  substitution + humanizer. `GET/POST /x/reply-lists`, items CRUD,
  `POST /x/reply-lists/:id/use` (server picks anti-repeat; `preview:true` = no
  side effects), `POST /:id/generate` (proposal-only, ~$0.003–0.01).
- **Radar/reply unification** (`2026-07-16-radar-reply-unification.md`) — every
  draft gets **3** angle variants (today: 2 single / 1 batch);
  `GET /x/radar/drafts?tweetId=`, `POST /x/radar/drafts/:tweetId/confirm`
  (promotes a radar draft into a `reply_drafts` row, idempotent), `reply_drafts.source`
  column, manual `band:'manual'` adds excluded from band calibration.
- **AI layer** (`2026-07-17-ai-layer.md`) — DB-editable prompts + OpenRouter as a
  second provider + generate-everywhere. `GET/PATCH /llm/settings`,
  `GET /llm/models`, `GET/PATCH /x/prompts(/:key)` + reset/restore-defaults,
  `POST /x/posts/draft-thread`, `POST /x/posts/rewrite`, `POST /x/ideas/generate`.
  Per-request `provider`/`model` overrides; Playbook gains model-effectiveness.
- **Guardrails** (`2026-07-17-guardrails.md`) — following ledger + curation queue
  (DOM-scraped, manual unfollow only, capped batches), activity monitor
  (`GET /x/monitor` — spam-heuristic advisories), goals/commitments
  (`GET/POST/PATCH/DELETE /x/goals`, `GET/PUT /x/commitments`), brief gains
  `monitor`/`goals`/`commitments`, scheduling responses gain non-blocking
  `warnings[]`. MCP: `x_monitor`, `x_goals`. Coach angle: goals give the weekly
  review real targets with pacing; never automate unfollows.
- **Harvest 2.0** (`2026-07-17-harvest-enhancements.md`) — passive home-timeline
  capture ($0, 2000 rows/day). `POST /x/harvest/passive`,
  `GET /x/harvest/affinity` ("who the algorithm keeps showing you"), Playbook
  gains `timelineFunnel` (of hot tweets seen, % replied — the opportunity-capture
  rate, a coach's favorite).
- **Notifications** (`2026-07-16-notifications.md`) — notifications-page
  augmentation + like/repost/follow capture. `POST /x/people/engagements`
  (idempotent, ≤50/batch); engagement events are timeline-only, never move stage.
- **Augmented X UI** (`2026-07-16-augmented-x-ui.md`) — `GET /x/people/glance`
  (timeline decoration map: stage/target/owed per handle).
- **Authoring 3** (`2026-07-17-authoring-3.md`) + **Studio 2**
  (`2026-07-16-studio-2.md`) — mostly extension-side (template gallery, mascot,
  patterns); Studio 2's only server touch widens asset kinds.

## Cross-cutting cautions

- Several plans all claim migration `0013` — whichever ships first takes the
  number. Never infer feature presence from migration numbers.
- MCP tool count will drift upward from 16 as plans land; probe with
  `tools/list`, don't assume.
- Every plan keeps **posting manual** (clipboard paste). Nothing in the roadmap
  adds auto-posting — if a user asks for it, the answer is still the policy wall.
- Doctrine knobs (quota, band, ratio) become *data* once Niche ships — prefer
  reading them over hardcoding the defaults in coaching output.
