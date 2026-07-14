# Settings Tab

The **Settings** tab is where you connect the stratus extension to your stratus server and control a few privacy and behavior switches. This is the first tab you have to deal with: until you enter the API URL and bearer token here, every other tab is locked and the extension keeps you on Settings. Once those two fields are filled in and saved, the rest of the app unlocks and stays connected — you rarely need to come back unless you change servers, rotate your token, or want to flip a toggle.

---

## First-time setup (do this first)

You need two things before the extension can do anything: the **address of your stratus server** and the **bearer token** (a password-like secret) that server expects. If you don't have these yet, see [Connection settings](#connection-settings) below for where they come from.

Step by step:

1. **Open the side panel.** Click the stratus extension icon in Chrome's toolbar to open the side panel. On first launch it opens on the **Settings** tab automatically (all other tabs are greyed out and unclickable).
2. **Find the two fields at the top:** **API URL** and **Bearer token**.
3. **Enter the API URL.** Type the full address of your stratus service into the **API URL** field, for example `http://127.0.0.1:8787` for a server running on your own machine, or the `https://…` address of your hosted instance. Include the `http://` or `https://` prefix. You don't need to add a trailing slash — the extension trims one automatically.
4. **Enter the bearer token.** Paste your secret into the **Bearer token** field. It's masked (shown as dots) like a password. This value must exactly match the `API_TOKEN` setting on your stratus server — the note right under the heading reminds you: *"Bearer token must match the server's `API_TOKEN` env var."*
5. **Click Save.** The **Save** button stays disabled until both fields have something in them. When you click it, the button briefly reads **Saving…**, then a green **Saved** appears next to it.
6. **The other tabs unlock.** As soon as both fields are saved and non-empty, every other tab (Today, People, Calendar, Composer, and so on) becomes clickable. You're connected.

> **Tip:** The three toggle switches lower down (pillars, auto-type, passive capture) save **the instant you click them** — they don't wait for the Save button. The **Save** button exists only to commit the API URL and bearer token together.

---

## Connection settings

These are the two fields at the top of the tab. Together they're what "being configured" means.

### API URL

- **What it is:** the web address of *your* stratus service — the small server that does the actual work (scheduling posts, reading metrics, drafting with AI, storing your people and voice library). The extension is just a front end; this URL tells it where to send every request.
- **Where to get it:** it depends on how you run stratus.
  - If you run stratus **on your own computer**, it's a local address like `http://127.0.0.1:8787` (use `127.0.0.1`, not `localhost`).
  - If you run stratus on a **hosted server** (for example a small cloud box), it's the public `https://…` address of that box. The project ships with a default hosted instance; if you're using that, its address is the one to paste here.
- **How it's stored:** saved locally inside the extension (in Chrome's extension storage). A trailing `/` is stripped automatically, so `https://example.com/` and `https://example.com` behave the same.

### Bearer token

- **What it is:** a **shared secret** — think of it as the password that proves you're allowed to talk to your stratus server. "Bearer token" is just the technical name for a secret that's sent along with each request to authorize it.
- **Where to get it:** it's the value of the `API_TOKEN` environment variable configured on your stratus server. Whoever set up the server (that's you, since stratus is a one-person tool) chose this value. Copy the exact same string here.
- **How it's stored and used:** it's kept locally in the extension, shown as a masked password field. On **every single request** the extension makes to your server, this token is attached as an `Authorization` header (behind the scenes, all traffic is funneled through the extension's background worker, which is the one place that reads the token and stamps it onto each call). If the token is wrong or missing, the server rejects the request.

### Troubleshooting a 401 (or "everything is failing")

A **401** response means "not authorized" — the server got your request but didn't accept the token. If tabs are unlocked but data won't load or actions fail:

- Double-check the **Bearer token** matches the server's `API_TOKEN` exactly — no extra spaces, no missing characters. (The extension trims leading/trailing spaces for you, but a token that's simply *wrong* will still fail.)
- Make sure the **API URL** points at the right server and that the server is actually running and reachable.
- Remember: filling in the two fields only *unlocks* the tabs — it does **not** verify the token is correct. The extension considers you "configured" the moment both fields are non-empty. A wrong token still unlocks the UI but makes every request fail. If the app unlocked but nothing works, the token or URL is the first thing to check.
- Re-enter the token and click **Save** again after any change.

---

## Behavior & privacy toggles

Three checkboxes sit between the connection fields and the harvest section. Each one saves immediately when you click it.

### Apply content pillars to reply drafting (default off)

- **What it does:** your stratus setup has "content pillars" — the handful of themes you want to be known for. When this is **on**, the AI reply drafter is nudged to steer replies toward those pillars. When **off** (the default), replies are drafted purely from the tweet you're responding to, with no pillar steering.
- **When to turn it on:** if you want your replies to consistently reinforce your core topics. Leave it off if you'd rather each reply just react naturally to whatever it's answering.

### Auto-type Reply Master drafts into the reply box (default off)

- **What it does:** when the AI drafts a reply for you, this controls how the draft reaches the X reply box. **Off** (the default) copies the draft to your clipboard so you paste it yourself. **On** makes the extension "type" the draft character by character straight into the focused reply box on X.
- **When to turn it on:** if you'd rather skip the paste step. Leave it off if you prefer to review-and-paste, or if auto-typing interferes with how you work.

### Passive contact capture from hover cards (default on)

- **What it does:** as you browse X normally and hover over someone's name or avatar, X shows a little profile pop-up ("hover card"). With this **on** (the default), the extension quietly reads those hover cards you naturally triggered and adds those people to your stratus roster (the "People" tab), building your contact list from ordinary browsing — no clicking "save" required.
- **What data it captures:** only what's already on the hover card X drew because *you* hovered — handle, display name, basic profile info. It does **not** synthesize hovers, crawl, or read anything you didn't naturally bring up on screen. New people are added gently (a hover glimpse never overwrites richer data you've already saved).
- **Why it's on by default:** it grows your relationship roster for free from browsing you were already doing. It's the effortless way the People layer fills itself in.
- **How to opt out:** simply **uncheck** this box. It saves immediately, and the extension stops capturing people from hover cards from that point on. This is the one place to turn passive capture off.

---

## Harvest cursors

Below the toggles is a **Harvest cursors** section — a list that starts empty and fills in as you use the Harvest feature.

- **What a harvest cursor is:** when you run a "since last" harvest of a particular person's timeline, stratus remembers the timestamp of the newest tweet it saw for that handle. The next "since last" harvest of the same person then **skips everything at or before that time** and only grabs what's new. That saved timestamp is the "cursor." There's one per handle-and-mode combination.
- **How the list reads:** each row shows the handle and mode as **`@handle · mode`**, the date/time the cursor is parked at, and a **Reset** button. If no cursors exist yet, you'll see *"No cursors yet — they appear after a completed since-last harvest."*
- **When to Reset one:** if a "since last" harvest seems to be **skipping tweets you expected to get**, its cursor is probably parked too far forward. Click **Reset** on that row to clear the cursor. The next "since last" run for that handle will then scrape the whole timeline again from the start instead of skipping. Resetting only affects future harvests — it doesn't delete anything you've already harvested.

This section exists specifically to make the "silent skip" problem visible and fixable: without it, a cursor stuck in the wrong place would quietly cause harvests to miss tweets with no explanation.

---

## Mention-refresh budget

The mention-refresh budget is **not** a control on this Settings tab — there's nothing to configure for it here. It's worth knowing about, though, because it's a built-in safety limit:

- Refreshing your **mention inbox** (pulling in new @-mentions) costs a tiny amount of money each time, so the extension caps how often you can do it. The **Refresh** button lives in the conversations/inbox area (the Today tab), not in Settings.
- There's a client-side limit of **4 refreshes per rolling 24 hours** enforced by the extension, plus a server-side backstop of **6 per day**. When you hit the limit, the Refresh button won't pull again until the window frees up.
- There's nothing to adjust — the cap is fixed. This note is just so you know why a refresh might be temporarily unavailable.

---

## Common workflows

### Connect for the first time
1. Open the side panel (it lands on **Settings**).
2. Type your server address into **API URL** (e.g. `http://127.0.0.1:8787` or your hosted `https://…` address).
3. Paste your secret into **Bearer token** (it must match the server's `API_TOKEN`).
4. Click **Save** and wait for the green **Saved**.
5. All the other tabs unlock — you're ready to use stratus.

### Opt out of passive capture
1. Go to the **Settings** tab.
2. **Uncheck** *"Passive contact capture from hover cards (default on)"*.
3. That's it — it saves the moment you click. The extension stops adding people from hover cards.

### Reset a harvest cursor that's skipping tweets
1. Go to the **Settings** tab and scroll to **Harvest cursors**.
2. Find the row for the handle (and mode) that's skipping tweets, shown as `@handle · mode`.
3. Click **Reset** on that row.
4. Run the "since last" harvest again — it will now scrape that timeline in full instead of skipping.

---

## States & troubleshooting

- **Not configured (tabs locked):** if the **API URL** or **Bearer token** is empty, every tab except **Settings** is disabled and greyed out, and trying to view another tab shows *"Configure API URL and bearer token first."* Fill in both fields and click **Save** to unlock everything. This is the expected first-run state, not an error.
- **Save button won't click:** the **Save** button is intentionally disabled until **both** the API URL and Bearer token fields contain text. Make sure neither is blank.
- **Tabs unlocked but nothing loads / requests fail (401 or errors):** the extension only checks that the two fields are *non-empty* — it doesn't verify they're correct. A wrong token or wrong URL unlocks the UI but every request fails. Re-check the token against the server's `API_TOKEN`, confirm the URL is right and the server is running, then **Save** again. See [Troubleshooting a 401](#troubleshooting-a-401-or-everything-is-failing).
- **A toggle didn't seem to stick:** the three toggles save on click, independently of the Save button. If one looks unchanged, click it again — the checkbox reflects the stored state.

---

## Tips & good to know

- **The bearer token is a shared secret — treat it like a password.** Anyone with your token and server address can act as you against your stratus server. Don't paste it anywhere public.
- **stratus is single-user by design.** One person, one server, one token. The same token is used by both this extension and any other tool (like the command-line scripts) that talks to your server. There are no accounts or logins beyond this single shared token.
- **Settings live locally in the extension.** Your URL, token, and toggle choices are stored in Chrome's extension storage and shared across all parts of the extension (side panel, background worker, content scripts). They survive closing the panel and restarting Chrome.
- **Toggles apply immediately; connection fields need Save.** Remember the split: checkboxes take effect on click, but the API URL and Bearer token are only committed when you press **Save**.
- **Changing servers or rotating your token?** Come back here, update the field(s), and click **Save**. Everything reconnects with the new values.
