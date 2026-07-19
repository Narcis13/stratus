# Profile Overhaul Playbook — Identity, Conversion, Memorability

> **Original ask (kept for future iterations):** "This is how my X profile looks now — as you correctly observed from that viral tweet it doesn't convert well. With the whole context you have, make an md playbook to overhaul my profile and identity strength to convert more. Be my coach, cofounder and X strategist — guide me to a unified, aligned, well-structured combo (banner, bio, pinned post). I also play with the idea of adding and updating weekly, in the lower part of my profile pic, the percentage toward my goal (23% = 23% of the way to 5,000 followers). I want a way for people to remember me, to craft my own identity in the timeline ocean (visually inclusive). Next stratus version will bring a brand kit + extensive bio (Me tab + goodies) — until then, help me."

**State at writing (Jul 19, 2026):** 1,015 followers → goal 5,000 = **20.3%**. Viral tail still warm (~1.7M impressions, 999 profile clicks on the hit). 56 posts scheduled for the next 14 days. The profile is the conversion funnel for all of it.

---

## Part 1 — Diagnosis: why the profile leaks

A profile converts when a stranger can answer three questions in 5 seconds: **Who is this? Why should I care? What do I get if I follow?** Right now each element answers a *different* question:

| Element | Current | Problem |
|---|---|---|
| Banner | Dark doodle, "**Just started**" | Directly contradicts your #1 asset ("30 years"). Prime real estate saying "nothing to see yet" |
| Avatar | Pirate portrait | Actually your best asset — distinctive, human, memorable. But nothing else references it, so it reads as random costume |
| Name | "Narcissus" | No descriptor. In replies (where most strangers meet you) it says nothing |
| Bio | 30 yrs / compounding loops / don't quit / fewcookies.com | Four lines, four directions. "Closing compounding loops" is insider-speak. No follow promise |
| Link | ship-or-die.com mission page | Third-party page, not your product |
| Pinned | Jun 16 "submitted FewCookies for review" | A month-old status update. No story, no numbers, no reason to follow |

**Five stories compete: Greek myth, pirate, "just started" rookie, 30-year veteran, FewCookies.** The viral visitor met a punchy question-asker, clicked through, and found none of that voice. That's the leak.

The fix is not "better lines." It's **one story told five times.**

---

## Part 2 — The identity core (decide once, reuse everywhere)

Your unfair differentiator in the build-in-public ocean (which is 95% 20-somethings): **age + receipts + the night-shift grind.** Nobody can copy "51, 30 years of code, ships with AI after the day job." And the pirate visual gives it a device the timeline can *see*: pirates ship. **Ship or die** is already your phrase.

> **Positioning statement (internal compass, never posted verbatim):**
> *The 51-year-old code pirate. 30 years of experience, shipping his first public SaaS at night with AI — real numbers, no hype. Follow to watch a veteran learn distribution in public.*

**Identity laws (the memorability contract):**
1. **The face never changes.** Same portrait, same crop, forever. The avatar is how 48px strangers recognize you in the reply ocean.
2. **One color pair everywhere:** deep navy + gold (they're already in the portrait). Banner, cards, progress visuals — same two colors.
3. **One catchphrase:** "Ship or die." Use as signature on weekly recap posts only (weekly = signature; daily = spam).
4. **One number:** the % to 5,000. It appears in the name field, the banner, and the Sunday post — always the same number, updated once a week. A moving number people check back on is a *serialized story*.

---

## Part 3 — The five surfaces

### 3.1 Name field (50 chars max — shows in every reply you write)

| Option | Chars | Angle |
|---|---|---|
| **`Narcissus ⚓ 20% → 5K`** ✅ | 23 | The progress hook. Strangers in replies see a moving number and get curious |
| `Narcissus ⚓ ships nightly` | 25 | The identity hook, static |
| `Narcissus \| 51yo builder` | 24 | Plainest, safest |

**Recommendation:** `Narcissus ⚓ 20% → 5K`. The ⚓ is your visual glyph (matches the pirate, renders everywhere), and the arrow creates an open loop the bio then closes. Update the % each Sunday — the name field is the only place a weekly % is legible *in the timeline itself*.

### 3.2 Bio (160 chars max)

| Option | Chars | Notes |
|---|---|---|
| **"30 years of code. Now shipping in public at 51 — SaaS + AI agents, nights only. Numbers, not vibes. Next stop: 5,000 of us."** ✅ | 123 | Closes the name field's loop ("→ 5K … 5,000 of us"). Credibility + promise + community framing |
| "51 yo. 30 years of code. Shipping FewCookies at night with AI agents — in public, real numbers included. Mission: replace the salary, not the hype." | 147 | Product-forward variant |
| "I ship a SaaS at night, after the day job. 51 yo, 30 years of code, AI in the loop. Daily: build-in-public numbers, boring-niche gold, dev psychology." | 150 | Content-promise-forward variant |

**Structure logic (whichever you pick):** line 1 = credibility contrast (30 yrs / 51 / nights), line 2 = what following gets you, line 3 = the quest. Cut from the current bio: "compounding loops" (insider), "only way to lose is to quit" (generic motivation — your *posts* carry the psychology, the bio shouldn't), "First project:" (moves to the link field + pinned thread).

### 3.3 Link field

**Change `ship-or-die.com/u/narcissus` → `fewcookies.com`.** One destination, your product, where the traffic should compound. The Ship-or-Die mission page moves into the pinned thread's reply (and Highlights). Rule: the profile has exactly one outbound door.

### 3.4 Banner (1500×500 — the billboard above the fold)

Kill "Just started." The banner's job is to say in 2 seconds what the bio says in 5.

**Layout spec** (keep text in the vertical middle band; bottom-left ~400×200 hides under the avatar on web):

```
┌─────────────────────────────────────────────────────────┐
│  (navy #0B1220 base, subtle wave/rigging texture)        │
│                                                          │
│        30 YEARS OF CODE.                                 │
│        SHIPPING IN PUBLIC AT 51.        ⚓ (gold)        │
│        ─────────────────────────                         │
│        SaaS · AI agents · build in public · growth       │
│                                                          │
│  [avatar zone —          → 5,000   ▓▓▓░░░░░░░░  20%     │
│   keep empty]            (gold progress bar, right side) │
└─────────────────────────────────────────────────────────┘
```

**Build it today with what stratus already ships:** extension → **Studio tab → banner template** (1500×500: headline + pillar keyword strip + follower milestone are built in). Set the **brand kit** first: bg `#0B1220`, accent gold `#E8B44F`, handle `@13_narcissus`, watermark on — save as preset `pirate`. The progress bar isn't a template element yet (good candidate for the next Studio iteration); until then add it over the exported PNG in Canva/Figma — 60 seconds weekly, same gold on navy.

### 3.5 Avatar + your progress-ring idea (my honest coach take)

The idea is good — the *placement* needs one correction. A **number** in the lower part of the pfp dies at timeline size (48px — "23%" becomes noise), and redrawing the avatar's content weekly violates law #1 (recognition).

**The design that keeps both:** a **progress ring** — a thin gold arc along the avatar's circular edge, filling clockwise from 12 o'clock, over a muted navy track. At 20% it's a small gold arc; by 5,000 it's a full gold circle. The face and crop never change; only the arc grows.

- Legible as "something is filling up" even at 48px; the exact number lives in the name field right next to it.
- The constant gold-on-navy ring becomes *more* recognizable, not less — and the slowly closing circle is a story regulars literally watch. When it closes at 5,000, that's a ready-made viral post ("the ring is complete").
- Update Sundays only, together with banner + name field. Never mid-week.
- The Studio's pfp-frame template (400×400, accent ring) is 90% of this already — a `progress` arc option is a small future addition; until then, 2 minutes in Figma with a saved template.

### 3.6 Pinned post — replace with an identity thread (ready to ship)

Pin the *conversion asset*, not a status update. A 4-tweet thread: hook with borrowed credibility from the viral hit → story → mission → follow promise. Schedule it through stratus threads (link goes in a reply — the link-in-first-reply pattern), then **pin T1 manually** and delete the old pin.

**T1 — the hook (~240 chars):**
```
51 years old. 30 years of writing code. 8 weeks of posting in public.

Last Friday a 2-line question I asked here hit 1.7M impressions.

So let me properly introduce myself — who I am, what I'm building at night, and why now. 🧵
```

**T2 — the story:**
```
I ran a hospital accounting office for 10 years before tech.

Then 30 years of code: Turbo Pascal on a 386 → AI agents reviewing my pull requests.

Day job by day. Builder by night, 2–4 hours.

I've watched every hype cycle die. This one is different.
```

**T3 — the mission:**
```
What I'm building: FewCookies — my first public SaaS.

The bigger mission: boring software for real businesses. My wife does the books for ~20 small firms — none care about tech Twitter. All of them pay for saved hours.

Goal: quietly replace a salary. Not a unicorn.
```

**T4 — the promise + quest:**
```
What you get if you follow:

Build-in-public numbers — the ugly ones too.
AI workflows that actually ship code.
Boring niches full of money.
The psychology of not quitting at 51.

The quest: 5,000 of us. Currently at 20%.

Ship or die. ⚓
```

**Reply to T4 (the one door):** `Start here → fewcookies.com` (+ optionally the Ship-or-Die mission link).

**Pin hygiene:** refresh the pin when something 3× better lands (stratus pinned-watch already nags at >21 days stale or when a recent post outperforms 3×). The thread above should hold 4–6 weeks.

---

## Part 4 — The Sunday ritual (10 minutes, ties into the scheduled plan)

Every Sunday (the 14-day plan already has Sunday-audit slots):

1. Read follower count → compute % (`followers / 5000`).
2. Update **name field** %, **banner** bar, **avatar ring**. Same number, three places.
3. The scheduled Sunday-audit post carries the number + "Ship or die." signature.
4. Log a `me_entries` note in stratus (Me tab is live) so drafts stay grounded in the real number.

Consistency of the *ritual* is itself the brand: people learn that Sunday = your scoreboard day.

---

## Part 5 — Measurement (so this isn't vibes)

**KPI: follows per 100 profile clicks, weekly.** Baseline from the viral window: 999 clicks on the hit → ~143 net follows across 2 days ≈ 10–14/100 (mixed sources). Target after overhaul: **+25–40%**.

- Numerator: `account_snapshots` daily deltas (already collected).
- Denominator: `user_profile_clicks` summed over the week's snapshots (already collected).
- The next [VIRAL-Q] wave (7 slots scheduled) is the A/B test: same post format, new profile behind it.
- Secondary: pinned thread's own metrics (it gets snapshotted like everything) and Highlights curation (add the viral hit + the milestone post there).

Housekeeping, low priority: 761 following / 1,015 followers reads a bit follow-for-follow. Don't mass-unfollow (looks worse); just slow follow-backs and let the ratio drift toward <60%.

---

## Part 6 — Execution checklist (~45 min tonight)

- [ ] Name → `Narcissus ⚓ 20% → 5K`
- [ ] Bio → the 123-char version (or your favorite of the three)
- [ ] Link → `fewcookies.com`
- [ ] Studio: create `pirate` brand kit (navy `#0B1220` / gold `#E8B44F`) → render banner → add progress bar → upload
- [ ] Avatar: add the 20% gold ring (same portrait, same crop) → upload
- [x] Identity thread SCHEDULED — Mon Jul 20, 18:04 local, threadId `ddc7b95f-baad-4bdc-8c68-9dc63353b7f7` (5 segments, link in the last one, publisher chains them as self-replies)
- [ ] When posted (Mon ~18:05): **pin T1**, unpin the Jun 16 post — pinning is manual in the X app
- [ ] Add viral hit + milestone post to **Highlights**
- [ ] Promote the 1,000-follower milestone draft (id `cd73d65f`) — it's true now (1,015)
- [ ] Sunday: first ritual run — recompute %, update all three surfaces

*The 56 scheduled posts are the traffic. This playbook is the landing page. Ship both.*
