#!/usr/bin/env python3
"""Gate for one x-post original plus its seed reply.

    check.py post.json            # {"text": "...", "seed": "...", "format": "referendum"}
    check.py --text "..." --seed "..."

Exit 0 clean, 1 on any hard failure. Warnings never fail the run but every
one of them is a line the operator would have flagged, so read them.
"""
import argparse, json, re, sys, unicodedata

X_LIMIT = 280
SOFT_MAX = 200          # nothing over 200 has printed on this account
SOFT_MIN = 40
SEED_SOFT_MAX = 200

URL_BILLING = re.compile(r"(^|\s)https?://", re.I)           # invariant #1: $0.20 vs $0.015
URL_ANY = re.compile(r"https?://|(^|\s)www\.|\.(com|io|ai|dev|app|so)(/|\s|$)", re.I)
HASHTAG = re.compile(r"(^|\s)#\w")
MENTION = re.compile(r"(^|\s)@\w")
EM_DASH = re.compile(r"[—–]|(\s-\s)|(--)")
ANTITHESIS = re.compile(r"\b(not|isn'?t|it'?s not|wasn'?t)\b[^\n]{1,60}\b(but|it'?s)\b", re.I)
TRIPLE_LIST = re.compile(r"[^\n,]+,\s*[^\n,]+,?\s+(and|or)\s+[^\n,]+")

TELL_WORDS = [
    "delve", "tapestry", "testament", "realm", "landscape", "nuanced", "underscore",
    "pivotal", "crucial", "foster", "resonate", "navigate", "game-changer", "game changer",
    "unlock", "elevate", "supercharge", "turbocharge", "seamless", "robust", "holistic",
    "hits different", "is wild", "this is why", "absolutely", "truly", "genuinely",
    "masterclass", "at the end of the day", "however", "moreover", "that said",
    "here's the thing", "heres the thing", "the reality is", "let's be honest",
    "lets be honest", "unpopular opinion", "hot take", "random thought", "great question",
    "thoughts?", "agree?", "who else", "like if", "rt if", "follow for", "let's connect",
    "lets connect", "drop your", "drop a ", "in today's", "revolutionary", "disruptive",
    "leverage ",
]
CASUAL = ["idk", "ngl", "tbh", "lol", "honestly"]
PUNCT_HARD = {";": "semicolon", ":": "colon", "!": "exclamation mark", "…": "ellipsis"}


def is_emoji(ch):
    return unicodedata.category(ch) in ("So", "Sk") and ord(ch) > 0x2000


def check(label, s, fails, warns, is_seed=False):
    n = len(s)
    if not s.strip():
        fails.append(f"{label}: empty")
        return
    if n > X_LIMIT:
        fails.append(f"{label}: {n} chars, over X's {X_LIMIT} limit")
    elif n > (SEED_SOFT_MAX if is_seed else SOFT_MAX):
        warns.append(f"{label}: {n} chars; nothing over {SOFT_MAX} has printed on this account")
    if not is_seed and n < SOFT_MIN:
        warns.append(f"{label}: {n} chars; under {SOFT_MIN} is a one-liner, make sure it still has a hole")

    if URL_BILLING.search(s):
        fails.append(f"{label}: contains a URL (invariant #1, and links die in originals)")
    elif URL_ANY.search(s):
        warns.append(f"{label}: looks like it contains a link or domain")
    if HASHTAG.search(s):
        fails.append(f"{label}: hashtag")
    if MENTION.search(s):
        fails.append(f"{label}: @mention")

    emojis = [c for c in s if is_emoji(c)]
    if emojis:
        fails.append(f"{label}: {len(emojis)} emoji ({''.join(emojis)}); originals carry none")

    if EM_DASH.search(s):
        fails.append(f"{label}: em dash / spaced hyphen / double hyphen, the loudest 2026 tell")
    for ch, name in PUNCT_HARD.items():
        if ch in s:
            fails.append(f"{label}: {name} found; line breaks do that work")
    periods = s.count(".")
    commas = s.count(",")
    if periods >= 3:
        fails.append(f"{label}: {periods} periods; this is written, not typed. cut to at most 2")
    elif periods:
        warns.append(f"{label}: {periods} period(s); each one is a line break you did not take")
    if commas >= 3:
        fails.append(f"{label}: {commas} commas; break the lines instead")
    elif commas:
        warns.append(f"{label}: {commas} comma(s)")
    if s.count("?") > (2 if is_seed else 1):
        warns.append(f"{label}: more than one question mark; one ask per post")

    low = s.lower()
    hits = [w for w in TELL_WORDS if w in low]
    if hits:
        fails.append(f"{label}: tell words: {', '.join(hits)}")
    if ANTITHESIS.search(s):
        warns.append(f"{label}: reads like a 'not X but Y' antithesis; check it")
    if TRIPLE_LIST.search(s):
        warns.append(f"{label}: looks like a three-item list")
    casual = [w for w in CASUAL if re.search(rf"\b{w}\b", low)]
    if len(casual) > 1:
        fails.append(f"{label}: stacked casual markers {casual}; one max")

    lines = [ln for ln in s.split("\n")]
    nonblank = [ln for ln in lines if ln.strip()]
    if not is_seed and len(nonblank) >= 2 and "\n\n" not in s:
        fails.append(f"{label}: {len(nonblank)} lines with no blank line between them")
    if len(nonblank) > 5:
        warns.append(f"{label}: {len(nonblank)} lines; three is usually the post")
    long_lines = [ln for ln in nonblank if len(ln) > 110]
    if long_lines:
        warns.append(f"{label}: a line runs {max(len(l) for l in long_lines)} chars; split it")

    first = nonblank[0].strip().lower() if nonblank else ""
    if not is_seed and re.match(r"^(i |i'|im |i've|my )", first):
        warns.append(f"{label}: opens on I/my; fine only if the post is the confession")
    if re.match(r"^(while|given|although|as a|when it comes)", first):
        fails.append(f"{label}: opens on a subordinate clause")

    last = nonblank[-1].strip() if nonblank else ""
    if not is_seed and last.endswith("."):
        warns.append(f"{label}: ends on a period; end on the open element (yet, still, pick, ?)")
    if not is_seed and re.search(r"\b(lol|haha|:d)\s*$", last, re.I):
        warns.append(f"{label}: ends on a laugh marker; that is the punchline you were told not to write")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?")
    ap.add_argument("--text")
    ap.add_argument("--seed")
    a = ap.parse_args()
    if a.path:
        d = json.load(open(a.path, encoding="utf-8"))
        text, seed = d.get("text", ""), d.get("seed", "")
        fmt = d.get("format", "")
    else:
        text, seed, fmt = a.text or "", a.seed or "", ""

    fails, warns = [], []
    check("post", text, fails, warns)
    if not seed.strip():
        fails.append("seed: missing; the seed is not optional")
    else:
        check("seed", seed, fails, warns, is_seed=True)
        if seed.strip().lower() == text.strip().lower():
            fails.append("seed: identical to the post")
        if len(seed) > len(text) * 1.5 and len(seed) > 120:
            warns.append("seed: much longer than the post; the seed never out-writes the post")
        if re.match(r"^\s*(great|thanks|agreed|so true)", seed, re.I):
            fails.append("seed: opens on praise/thanks")

    nlines = len([ln for ln in text.split("\n") if ln.strip()])
    print(f"post  {len(text):>3} chars  {nlines} lines  format={fmt or '?'}")
    print(f"seed  {len(seed):>3} chars")
    for w in warns:
        print(f"WARN  {w}")
    for f in fails:
        print(f"FAIL  {f}")
    print("clean" if not fails else f"{len(fails)} fail(s)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
