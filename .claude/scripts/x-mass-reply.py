#!/usr/bin/env python3
"""Helper for the /x-mass-reply command: gate a wave plan, print intent URLs, keep the ledger.

    x-mass-reply.py skip                         # JS array of ids already replied today -> paste into the harvest script
    x-mass-reply.py plan   wave-1.json           # gate every reply; print id / handle / age / intent URL for clean rows
    x-mass-reply.py log    wave-1.json ID=sent ID=error ...   # append outcomes to the ledger
    x-mass-reply.py report                       # today's ledger as a table + the counts the wrap-up needs

Plan file shape:
    {"hv": "<harvest ISO timestamp>", "source": "Following",
     "rows": [{"id": "1234", "h": "handle", "age": 12, "gist": "one line on the post", "reply": "the reply"}]}

Ledger: ~/.cache/x-mass-reply/ledger.jsonl, one JSON object per line (append-only).
Exit 1 from `plan` on any FAIL; warnings never fail the run but each one is a line the operator would flag.
"""
import json, re, sys, unicodedata, urllib.parse
from datetime import datetime, timezone
from pathlib import Path

LEDGER = Path.home() / ".cache" / "x-mass-reply" / "ledger.jsonl"
HARD_MAX, SOFT_MAX, SOFT_MIN = 140, 110, 20

URL_ANY = re.compile(r"https?://|(^|\s)www\.|\.(com|io|ai|dev|app|so)(/|\s|$)", re.I)
HASHTAG = re.compile(r"(^|\s)#\w")
MENTION = re.compile(r"(^|\s)@\w")
EM_DASH = re.compile(r"[—–]|(\s-\s)|(--)")
ANTITHESIS = re.compile(r"\b(not|isn'?t|it'?s not|wasn'?t)\b[^\n]{1,60}\b(but|it'?s)\b", re.I)
TRIPLE_LIST = re.compile(r"[^\n,]+,\s*[^\n,]+,?\s+(and|or)\s+[^\n,]+")
PERIOD_NOT_DECIMAL = re.compile(r"(?<!\d)\.|\.(?!\d)")
PUNCT_HARD = {";": "semicolon", ":": "colon", "!": "exclamation mark", "…": "ellipsis"}

TELL_WORDS = [
    "delve", "tapestry", "testament", "realm", "landscape", "nuanced", "underscore",
    "pivotal", "crucial", "foster", "resonate", "navigate", "game-changer", "game changer",
    "unlock", "elevate", "supercharge", "seamless", "robust", "holistic", "hits different",
    "is wild", "this is why", "absolutely", "truly", "genuinely", "masterclass",
    "at the end of the day", "however", "moreover", "that said", "here's the thing",
    "heres the thing", "the reality", "let's be honest", "lets be honest", "great point",
    "great post", "so true", "love this", "well said", "spot on", "couldn't agree more",
    "couldnt agree more", "100%", "this is the way", "exactly this", "underrated take",
    "check my", "follow me", "my profile", "@grok", "leverage ",
]
CASUAL = ["idk", "ngl", "tbh", "lol", "honestly", "yeah"]
BAD_OPENERS = re.compile(
    r"^(great|honestly|i think|i feel|this[ .!]|so true|love |well said|agreed|yes[ ,.!]|exactly|totally|"
    r"while|given|although|as a |when it comes|the reality|the fact that)", re.I)


def is_emoji(ch):
    return unicodedata.category(ch) in ("So", "Sk") and ord(ch) > 0x2000


def check(label, s, fails, warns):
    n = len(s)
    if not s.strip():
        fails.append(f"{label}: empty"); return
    if n > HARD_MAX:
        fails.append(f"{label}: {n} chars, hard max is {HARD_MAX}")
    elif n > SOFT_MAX:
        warns.append(f"{label}: {n} chars; the best replies ran 34-110")
    if n < SOFT_MIN:
        warns.append(f"{label}: {n} chars; a one-worder reads as a bot chant")
    if URL_ANY.search(s):
        fails.append(f"{label}: link or domain")
    if HASHTAG.search(s):
        fails.append(f"{label}: hashtag")
    if MENTION.search(s):
        fails.append(f"{label}: @mention (never the author, never grok)")
    emojis = [c for c in s if is_emoji(c)]
    if len(emojis) > 1:
        fails.append(f"{label}: {len(emojis)} emoji; one at most, rarely")
    if EM_DASH.search(s):
        fails.append(f"{label}: em dash / spaced hyphen / double hyphen, the loudest 2026 tell")
    for ch, name in PUNCT_HARD.items():
        if ch in s:
            fails.append(f"{label}: {name}; line breaks do that work")
    if PERIOD_NOT_DECIMAL.search(s):
        fails.append(f"{label}: period; end the line instead")
    if "," in s:
        fails.append(f"{label}: comma; break the line instead")
    if s.count("?") > 1:
        fails.append(f"{label}: more than one question mark")
    low = s.lower()
    hits = [w for w in TELL_WORDS if w in low]
    if hits:
        fails.append(f"{label}: tell words: {', '.join(hits)}")
    if ANTITHESIS.search(s):
        warns.append(f"{label}: reads like a 'not X but Y' antithesis")
    if TRIPLE_LIST.search(s):
        warns.append(f"{label}: looks like a three-item list")
    casual = [w for w in CASUAL if re.search(rf"\b{w}\b", low)]
    if len(casual) > 1:
        fails.append(f"{label}: stacked casual markers {casual}; one max")
    nonblank = [ln for ln in s.split("\n") if ln.strip()]
    if len(nonblank) >= 2 and "\n\n" not in s:
        fails.append(f"{label}: {len(nonblank)} lines with no blank line between them")
    if len(nonblank) > 3:
        warns.append(f"{label}: {len(nonblank)} lines; one idea is one or two")
    first = nonblank[0].strip() if nonblank else ""
    if BAD_OPENERS.match(first):
        fails.append(f"{label}: opener '{first.split()[0] if first.split() else first}' is a tell or a subordinate clause")
    if re.match(r"^(i |i'|im |i've|my )", first.lower()):
        warns.append(f"{label}: opens on I/my; fine only if the reply IS the anecdote")
    last = nonblank[-1].strip() if nonblank else ""
    if re.search(r"\b(lol|haha|:d)\s*$", last, re.I):
        warns.append(f"{label}: ends on a laugh marker")


def load_plan(path):
    d = json.load(open(path, encoding="utf-8"))
    rows = d.get("rows") or []
    for r in rows:
        r["id"] = str(r.get("id", "")).strip()
        r["h"] = str(r.get("h", "")).strip().lstrip("@")
        r["reply"] = (r.get("reply") or "").replace("\r\n", "\n").strip()
    return d, rows


def read_ledger():
    if not LEDGER.exists():
        return []
    out = []
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def today_rows():
    today = datetime.now().astimezone().date().isoformat()
    return [r for r in read_ledger() if str(r.get("ts", "")).startswith(today)]


def posted_ok(r):
    return r.get("status") in ("sent", "clicked-unconfirmed")


def cmd_skip():
    rows = today_rows()
    ids = sorted({r["id"] for r in rows if posted_ok(r)})
    print("const SKIP=new Set(" + json.dumps(ids) + ");")
    handles = {r.get("h") for r in rows if posted_ok(r)}
    print(f"// today: {len(ids)} replied, {len(handles)} authors, {len(rows) - len(ids)} failed/skipped rows", file=sys.stderr)


def cmd_plan(path):
    d, rows = load_plan(path)
    fails, warns = [], []
    if not d.get("hv"):
        fails.append("plan: missing hv (the harvest timestamp printed in the HARVEST header row)")
    done = today_rows()
    done_ids = {r["id"] for r in done if posted_ok(r)}
    done_handles = {r.get("h", "").lower() for r in done if posted_ok(r)}
    seen_ids, seen_handles, openers, texts = set(), {}, {}, set()
    for i, r in enumerate(rows, 1):
        label = f"#{i} @{r['h'] or '?'}"
        if not re.fullmatch(r"\d{15,25}", r["id"]):
            fails.append(f"{label}: id '{r['id']}' is not a tweet id")
        if r["id"] in done_ids:
            fails.append(f"{label}: already replied to today (ledger)")
        if r["id"] in seen_ids:
            fails.append(f"{label}: duplicate id in this wave")
        seen_ids.add(r["id"])
        h = r["h"].lower()
        if h in done_handles:
            fails.append(f"{label}: already replied to this author today; one per author per day")
        if h in seen_handles:
            fails.append(f"{label}: author appears twice in this wave (first at #{seen_handles[h]})")
        seen_handles.setdefault(h, i)
        check(label, r["reply"], fails, warns)
        key = r["reply"].strip().lower()
        if key in texts:
            fails.append(f"{label}: identical reply text to another row")
        texts.add(key)
        words = re.findall(r"[a-z0-9']+", key)
        op = " ".join(words[:2])
        if op:
            openers.setdefault(op, []).append(i)
    for op, idx in openers.items():
        if len(idx) >= 2:
            warns.append(f"opener '{op}' starts rows {idx}; vary the first words across the wave")
    firsts = {}
    for i, r in enumerate(rows, 1):
        w = re.findall(r"[a-z0-9']+", r["reply"].lower())
        if w:
            firsts.setdefault(w[0], []).append(i)
    for w, idx in firsts.items():
        if len(idx) >= 3:
            fails.append(f"first word '{w}' starts {len(idx)} rows {idx}; three of the same opener reads as a template")

    for w in warns:
        print(f"WARN  {w}")
    for f in fails:
        print(f"FAIL  {f}")
    print(f"{len(rows)} rows, {len(fails)} fail(s), {len(warns)} warn(s)")
    if fails:
        sys.exit(1)
    # Fire order is freshest first: the under-15-minute jackpots must land while they are still under 15.
    # The #h= fragment never reaches X; the verify script reads it to check the composer's "Replying to @".
    print("id\thandle\tage\turl")
    for r in sorted(rows, key=lambda r: (r.get("age") if isinstance(r.get("age"), (int, float)) else 999)):
        url = ("https://x.com/intent/post?in_reply_to=" + r["id"] + "&text="
               + urllib.parse.quote(r["reply"], safe="") + "#h=" + r["h"])
        print(f"{r['id']}\t@{r['h']}\t{r.get('age', '?')}\t{url}")


def cmd_log(path, pairs):
    d, rows = load_plan(path)
    by_id = {r["id"]: r for r in rows}
    hv = d.get("hv")
    now = datetime.now().astimezone()
    try:
        hv_dt = datetime.fromisoformat(str(hv).replace("Z", "+00:00")) if hv else None
    except ValueError:
        hv_dt = None
    elapsed = (now - hv_dt.astimezone()).total_seconds() / 60 if hv_dt else 0
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with LEDGER.open("a", encoding="utf-8") as f:
        for p in pairs:
            if "=" not in p:
                print(f"skip '{p}': expected ID=status", file=sys.stderr); continue
            tid, status = p.split("=", 1)
            r = by_id.get(tid.strip())
            if not r:
                print(f"skip '{tid}': not in {path}", file=sys.stderr); continue
            age0 = r.get("age")
            f.write(json.dumps({
                "ts": now.isoformat(timespec="seconds"), "id": r["id"], "h": r["h"],
                "source": d.get("source", ""), "age_harvest": age0,
                "age_post": round(age0 + elapsed) if isinstance(age0, (int, float)) else None,
                "gist": r.get("gist", ""), "reply": r["reply"], "status": status.strip(),
            }, ensure_ascii=False) + "\n")
            n += 1
    print(f"logged {n} row(s) to {LEDGER}")


def cmd_report():
    rows = today_rows()
    if not rows:
        print("nothing logged today"); return
    print("#\tage@post\tstatus\thandle\treply")
    for i, r in enumerate(rows, 1):
        print(f"{i}\t{r.get('age_post', '?')}m\t{r.get('status')}\t@{r.get('h')}\t{r.get('reply', '').replace(chr(10), ' / ')}")
    ok = [r for r in rows if posted_ok(r)]
    unconf = [r for r in rows if r.get("status") == "clicked-unconfirmed"]
    u15 = [r for r in ok if isinstance(r.get("age_post"), (int, float)) and r["age_post"] < 15]
    u60 = [r for r in ok if isinstance(r.get("age_post"), (int, float)) and r["age_post"] < 60]
    failed = [r for r in rows if not posted_ok(r)]
    srcs = {}
    for r in ok:
        srcs[r.get("source", "?")] = srcs.get(r.get("source", "?"), 0) + 1
    print()
    print(f"posted {len(ok)} ({len(unconf)} clicked but unconfirmed), failed {len(failed)}, "
          f"under 15 min {len(u15)}, under 60 min {len(u60)}, authors {len({r.get('h') for r in ok})}")
    print("sources: " + ", ".join(f"{k} {v}" for k, v in srcs.items()))
    if failed:
        print("failed: " + ", ".join(f"@{r.get('h')}={r.get('status')}" for r in failed))


def main(argv):
    if len(argv) < 2 or argv[1] not in ("skip", "plan", "log", "report"):
        print(__doc__); sys.exit(2)
    cmd = argv[1]
    if cmd == "skip":
        cmd_skip()
    elif cmd == "plan":
        if len(argv) < 3:
            print("plan needs a wave file"); sys.exit(2)
        cmd_plan(argv[2])
    elif cmd == "log":
        if len(argv) < 4:
            print("log needs a wave file and ID=status pairs"); sys.exit(2)
        cmd_log(argv[2], argv[3:])
    else:
        cmd_report()


if __name__ == "__main__":
    main(sys.argv)
