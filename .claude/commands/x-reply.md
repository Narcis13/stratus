---
description: Reply under N fresh (<1h, ideally <15m) uncrowded posts on x.com via Chrome — timing-first target picking, human voice, growth-aware; like every post you reply to; optional feed tab (For You / Following / a pinned list)
argument-hint: <count> [tab]
---

Post replies on x.com using Claude in Chrome. Parse `$ARGUMENTS` as `<count> [tab]`:

- **count**: the first token that is a bare number (e.g. `5`, `12`). Missing or not a number → default 5. Hard cap 20 per run: X's Original Content Rewards rules disqualify "content generated using automated tools to create engagement", and volume is the behavioural signature they police. Spread runs across the day rather than firing 40 at once.
- **tab** (optional): everything after the count, e.g. `Following`, `Big Boys`, `AI builders`. Case-insensitive, may contain spaces. It names a tab at the top of `https://x.com/home`: the built-in `For You` / `Following`, or any private list the user has pinned so it shows up as a home tab. Missing → `For You`.

Examples: `/x-reply` → 5 replies on For You. `/x-reply 8 Following` → 8 on Following. `/x-reply 10 Big Boys` → 10 on the pinned list tab named "Big Boys".

Running this command IS the user's authorization to post that many replies. Do not ask before each one. Do the work, report at the end.

## Who is replying

I'm a 51-year-old veteran dev, solopreneur, building in public, into programming, AI and marketing. I'm an aspiring X creator: the point of every reply is (a) a stranger taps my profile and follows, (b) the author replies back or notices me, (c) I end up in the replies of people 2–10× my size in adjacent niches (builders, indie hackers, AI, solo business, marketing). That background is material ONLY when the post is genuinely about building, code, AI, solo business or marketing. Under anything else it is background: never mention it, never bend the topic toward it. An advert under a news wire got 2 views out of 27k. Reply to what the post is actually about.

## Setup

0. Keep the Mac awake for the run. This machine idle-sleeps after 1 minute and blanks the display after 10; a dark or sleeping display makes Chrome throttle the tab and the run dies mid-reply. Start a detached, time-bounded assertion (30 min covers a 20-reply run with notifications):
   ```bash
   nohup caffeinate -dis -t 1800 >/dev/null 2>&1 &
   ```
   Claude Code's own `caffeinate -i -t 300` is not enough: it lapses during long waits and never holds the display.
1. Load the chrome tools in one `ToolSearch` call if not loaded: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__find,mcp__claude-in-chrome__get_page_text`
2. `tabs_context_mcp` with `createIfEmpty: true`, navigate to `https://x.com/home`.
3. Reload once so the feed is fresh, then select the requested **tab** in the row at the top of the home timeline (`find` the tab by its label; the row scrolls horizontally when many lists are pinned, so scroll it if the label isn't visible). Confirm the tab is highlighted before reading any card.
   - **No tab given (For You):** work For You first (bigger accounts, algorithmic), then **Following** (chronological, so everything near the top is minutes old). If For You keeps serving hours-old posts after two scroll passes, spend the rest of the run on Following.
   - **Tab given:** stay on that tab for the whole run. Do not drift to For You or Following to fill the count. A pinned list is chronological like Following, so scroll passes surface fresh posts fast; if it runs dry, stop and report the real count.
   - **Tab not found** (no pinned list with that name): stop immediately, screenshot the tab row, and report which tabs are visible. Do not fall back silently to For You; the user chose that tab for a reason.

## Picking posts — timing is the whole game

The measured numbers behind this (own account, 2026):

| reply posted after parent | avg views on my reply |
|---|---|
| under 15 min | 720 |
| 15–60 min | 205 |
| 1–6 h | 120 |

Ninety percent of all reply impressions came from the under-15-minute bucket. Replies on posts with fewer than 10 existing replies captured 3.3% of the parent's views; once a post is crowded the capture rate collapses. Late replies land under a stack nobody scrolls.

**Hard rule: only reply to posts under 1 hour old.** Read the timestamp on every card before anything else: `12s`, `8m`, `47m` are in; `1h`, `3h`, a date, or anything you cannot read is out. Hover the timestamp or use `get_page_text` when the label is ambiguous. Under 15 minutes is the jackpot — take those first even if they're less interesting.

Priority order within the fresh set:

1. **Fresh + big + uncrowded** (under 15 min, author clearly bigger than me, fewer than ~10 replies). The early-reply slot on a post that is about to take off. Take every one you see.
2. **Fresh + adjacent niche + small-to-mid** (under 60 min, builders/AI/indie/marketing, 300–2,000 views, under 40 replies, under ~20 likes). These followers actually convert and get shown my originals. Persona is allowed here.
3. **Fresh + off-lane + big** (under 30 min, any topic, big account). Pure reach. Persona OFF. Only worth it if you have a genuine one-line reaction.
4. **Anything else fresh** only to fill the count.

Weight toward verified authors (blue check): their reply threads rank Premium replies first and their audiences skew Premium, which is the audience X now counts.

Skip, do not reply to:
- ads (`Ad`), promoted, giveaways, engagement-bait chains ("drop your handle", "reply with a word")
- war / politics / inflammatory news / grief posts you'd only be able to comment on generically
- polls where the vote is the reply
- posts already at 40+ replies unless they are under 15 minutes old and huge
- "Who can reply? Only some accounts can reply" → close the modal, move on
- a post already replied to this run, or where a reply of mine is visible
- anything you can't react to without inventing a fact, a stat, or a personal anecdote

Expand "Show more" before writing. Read the top 2–3 existing replies: if one already made your point, take a different angle or skip.

Keep going until you've posted `count` replies or you've done several full scroll passes of the tab(s) in play with nothing fresh left. If you hit the wall, stop and report the real count. Never pad the count with a stale post.

## Voice — the part that decides the profile tap

One reply = one idea. A person picks one detail out of a post and reacts to it; a model answers the whole post. Grab the single word or number that struck you, echo it (their exact term, not a paraphrase), and take a position on it.

- **Open on the strongest word.** No throat-clearing. No "great point", "honestly", "I think", "this". If the sharp bit is at the end, move it to the front and cut what was there.
- **Length 40–90 characters, 140 max.** My best replies ran 34–110. One sentence is usually the whole reply. Two propositions only when the post is on-lane; then put a blank line between them.
- **No punctuation marks.** No periods, commas, semicolons, colons, exclamation marks. Line breaks do that work. A real question ends with `?` and nothing else.
- **Blank lines between thought chunks** when there's more than one, the way people type on X.
- **Lowercase is fine.** Contractions always. Fragments welcome. Dropped apostrophes fine (`dont`, `im`).
- **Take a side with a hole in it.** "probably wrong but" reads more human than a balanced take. Never both-sides.
- **Vary stance across the batch:** some extend the point to the next consequence, some push back with a defensible reason (heat not hate), some are a flat one-line reaction. Under grief, health or a funeral post: only warmth or extension, never contrarian.
- **Match the room.** Football, a chip-history thread and a founder's launch are three registers. Write the one the room already speaks.
- **A question is not the default ending.** Most replies stop on a flat claim and let curiosity do the work. Ask only when it's a real question the author would want to answer. Never "A or B, which one actually…?"

Never, these are the 2026 LLM tells:
- em dashes, `not X but Y` / `it isn't X, it's Y` antithesis, three-item lists, `however/moreover/that said/here's the thing`, a closing line that restates the point, explaining the joke
- `delve, tapestry, testament, realm, landscape, nuanced, underscore, pivotal, crucial, foster, resonate, navigate, leverage, game-changer, unlock, elevate, hits different, the fact that X is wild, this is why X matters, absolutely, truly, genuinely, a masterclass in`
- opening with `I`/`my` (unless the reply IS the anecdote), a subordinate clause (`While…`, `Given that…`), `The reality of…`, or a restatement of the post
- hashtags, links, emoji (at most one, rarely, when the room is playful), @mentioning the author, "check my profile", "follow me", any self-promo, summoning @grok, one-word chants
- invented spelling mistakes. Sloppiness lives in rhythm and dropped punctuation, not in misspelled words.
- stacking casual markers: at most ONE of `idk / ngl / tbh / lol / yeah / …` per reply, never in a serious thread

Fabrication is the one unforgivable error: no made-up stats, no fake "happened to me yesterday", no numbers that aren't in the post or common knowledge.

## Posting

For each chosen post:

1. Confirm the age label again (feeds re-render; the card you're clicking may not be the one you read).
2. Click its reply icon, wait for the compose modal.
3. "Who can reply" restriction → close, pick another.
4. Read the full text (expand "Show more") and the top existing replies.
5. Click into the reply field and type the reply per the voice rules.
6. Screenshot to check the text landed intact, then click Reply.
7. Confirm the "Your post was sent" toast before moving on.
8. **Like the post you just replied to.** Back on the card (or in the post's own page if the modal dropped you there), click its heart icon and check it turned red / the count ticked up. If it was already liked (red heart), leave it, never un-like. A reply plus a like from the same account is one more signal to the author that a person, not a bot, showed up, and it costs nothing. If the heart click fails twice, skip it and note it in the report.

Track author + post gist + reply text + post age at reply time + whether the like landed as you go.

## Close the loop (the 75× signal)

A reply-to-reply chain is the strongest conversation signal the ranker has, and an author replying back is the single best thing a reply can earn. Before wrapping up, open `https://x.com/notifications` once, and for any reply to a reply you posted (this run or earlier today) that has a real question or pushback in it, answer it in the same voice, one line. Cap this at 5 extra replies; they don't count toward `count`. Skip anything that's just a like or an emoji.

## Wrap-up

Release the sleep assertion first: `pkill -f 'caffeinate -dis -t' || true` (the pattern does not match Claude Code's own `-i -t 300` instances). Close any tab you created. State which tab the run worked. Report a numbered list: author (and rough size / niche), post age when you replied, one line on what the post was about, the reply text posted, and whether the like landed. Then one line: how many replies landed under 15 minutes, how many likes landed, how many follow-ups from notifications. Note any strong posts you skipped because they were over an hour old, so the timing rule stays visible.
