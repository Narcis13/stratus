#!/usr/bin/env python3
"""Gate for a week of drafted X posts.

Two modes:

  Pre-flight — validate a batch and emit the §11 table:
    validate.py posts.json --prev evals/week_x_posts_2026-08-24.md
    validate.py posts.json --prev-tail "2026-08-30 23:33"   # UTC, from scheduled_posts

  Self-audit — re-extract every post out of the finished document and check it
  against its own annotation and its §11 row:
    validate.py --doc evals/week_x_posts_2026-08-31.md

posts.json:
  {"week_start": "2026-08-31", "tz_offset_hours": 3,
   "posts": [{"tag":"N1","stream":"N","local":"2026-08-31 10:21",
              "text":"...","seed":"...","pillar":"ai-craft"}, ...]}

Exit 0 clean, 1 on any hard failure. Warnings never fail the run.
"""
import argparse, json, re, statistics, sys
from datetime import datetime, timedelta

LIMIT = 280
# Invariant #1: this is the pattern X bills the URL surcharge on ($0.20 vs $0.015).
URL_BILLING = re.compile(r"(^|\s)https?://", re.I)
URL_ANY = re.compile(r"https?://|(^|\s)www\.", re.I)
HASHTAG = re.compile(r"(^|\s)#\w")
STREAMS = {"X": "DILEMMA", "D": "CHALLENGE BOARD", "N": "NEWS PEG",
           "A": "VERDICT", "F": "FACTION SPLIT", "K": "BAKE-OFF", "W": "WORD BUDGET"}

fails, warns = [], []
def fail(m): fails.append(m)
def warn(m): warns.append(m)


def check_text(tag, kind, s):
    n = len(s)
    if n > LIMIT:
        fail(f"{tag}: {kind} is {n} chars, over the {LIMIT} limit by {n - LIMIT}")
    if URL_BILLING.search(s):
        fail(f"{tag}: {kind} contains a URL — invariant #1, this bills $0.20 not $0.015 (13x)")
    elif URL_ANY.search(s):
        warn(f"{tag}: {kind} looks like it contains a link; X may still surcharge it")
    if HASHTAG.search(s):
        fail(f"{tag}: {kind} contains a hashtag")
    if "\r" in s:
        warn(f"{tag}: {kind} contains a carriage return")
    return n


def prev_tail_from_doc(path):
    """Latest UTC timestamp in a previous document's §11 queue table."""
    txt = open(path, encoding="utf-8").read()
    stamps = re.findall(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})Z", txt)
    if not stamps:
        warn(f"no UTC timestamps found in {path}; tail collision unchecked")
        return None
    return max(datetime.strptime(s, "%Y-%m-%d %H:%M") for s in stamps)


def preflight(batch_path, prev_doc, prev_tail):
    d = json.load(open(batch_path, encoding="utf-8"))
    posts, tz = d["posts"], d.get("tz_offset_hours", 3)

    seen, rows = set(), []
    for p in posts:
        tag = p["tag"]
        if tag in seen:
            fail(f"duplicate tag {tag}")
        seen.add(tag)
        if not re.fullmatch(r"[A-Z]\d+", tag):
            warn(f"{tag}: tag should be one stream letter plus a number")
        if tag[0] != p.get("stream", tag[0]):
            fail(f"{tag}: tag letter disagrees with stream field {p.get('stream')!r}")
        n = check_text(tag, "post", p["text"])
        check_text(tag, "seed", p.get("seed", ""))
        if not p.get("seed"):
            fail(f"{tag}: no seed reply — the seed is not optional (R6)")
        loc = datetime.strptime(p["local"], "%Y-%m-%d %H:%M")
        rows.append((tag, p, loc, loc - timedelta(hours=tz), n))

    rows.sort(key=lambda r: r[3])
    if [r[0] for r in rows] != [p["tag"] for p in posts]:
        warn("posts.json is not in fire order; the emitted table is sorted by UTC")

    for a, b in zip(rows, rows[1:]):
        if b[3] <= a[3]:
            fail(f"{b[0]} fires at or before {a[0]} ({b[3]}Z vs {a[3]}Z)")
        if (b[3] - a[3]).total_seconds() < 3600:
            warn(f"{a[0]} → {b[0]} is only {(b[3]-a[3]).total_seconds()/60:.0f} min apart")

    tail = prev_tail or (prev_tail_from_doc(prev_doc) if prev_doc else None)
    if tail and rows and rows[0][3] <= tail:
        fail(f"first fire {rows[0][0]} at {rows[0][3]}Z collides with the previous "
             f"week's tail at {tail}Z")

    # one stream per day-block; a block runs 10:00 -> next 03:00
    blocks = {}
    for tag, p, loc, utc, n in rows:
        block = (loc - timedelta(hours=6)).date()
        blocks.setdefault(block, []).append(tag)
    for block, tags in blocks.items():
        letters = [t[0] for t in tags]
        dupes = {l for l in letters if letters.count(l) > 1}
        for l in dupes:
            warn(f"block {block}: two {l}-stream posts the same day ({', '.join(tags)})")

    report(rows)
    return rows


def report(rows):
    lens = [r[4] for r in rows]
    by = {}
    for tag, p, loc, utc, n in rows:
        by.setdefault(tag[0], []).append(n)

    print(f"\n{len(rows)} posts · mean {statistics.mean(lens):.0f} · "
          f"median {statistics.median(lens):.0f} · min {min(lens)} · max {max(lens)}")
    print(f"under 110 chars: {sum(1 for n in lens if n < 110)}  |  "
          f"over 215: {sum(1 for n in lens if n > 215)}")
    print("\nper stream:")
    for letter in sorted(by):
        v = by[letter]
        print(f"  {letter} {STREAMS.get(letter,'?'):<16} n={len(v):<3} "
              f"median={statistics.median(v):>4.0f}  ({min(v)}–{max(v)})")

    print("\n### §11 table — paste this, do not retype\n")
    print("| tag | stream | fires (Bucharest) | UTC | chars | pillar |")
    print("|---|---|---|---|---|---|")
    for tag, p, loc, utc, n in rows:
        print(f"| **{tag}** | {STREAMS.get(tag[0], p.get('stream',''))} | "
              f"{loc.strftime('%a %d %b %H:%M')} | {utc.strftime('%Y-%m-%d %H:%MZ')} | "
              f"{n} | {p.get('pillar','ai-craft')} |")
    print(f"\nbudget: {len(rows)} x $0.015 = ${len(rows)*0.015:.2f}")


def extract_posts(md):
    """Pull (tag, body, annotated_len) out of the day-by-day sections."""
    out = []
    for m in re.finditer(r"^\*\*\d{2}:\d{2}(?:\s+\w+)?\s+—\s+([A-Z]\d+)\s+·", md, re.M):
        tag = m.group(1)
        lines = md[m.end():].split("\n")[1:]
        i = 0
        while i < len(lines) and not lines[i].startswith(">"):
            i += 1
        body = []
        while i < len(lines):
            l = lines[i]
            if l.startswith("> "):
                body.append(l[2:])
            elif l == ">":
                body.append("")
            else:
                break
            i += 1
        tail = "\n".join(lines[i:i + 12])
        am = re.search(r"`stream\s+[A-Z]\s+·\s+(\d+)\s+chars", tail)
        out.append((tag, "\n".join(body), int(am.group(1)) if am else None))
    return out


def audit(doc_path):
    md = open(doc_path, encoding="utf-8").read()
    posts = extract_posts(md)
    if not posts:
        fail("no post sections found — check the heading format in references/document.md")
        return []

    table = {}
    for row in re.finditer(r"^\|\s*\*\*([A-Z]\d+)\*\*\s*\|(.+)$", md, re.M):
        cells = [c.strip() for c in row.group(2).split("|")]
        nums = [c for c in cells if c.isdigit()]
        table[row.group(1)] = int(nums[-1]) if nums else None

    seen = set()
    for tag, body, ann in posts:
        if tag in seen:
            fail(f"{tag}: appears twice in the day-by-day sections")
        seen.add(tag)
        n = check_text(tag, "post", body)
        if ann is None:
            fail(f"{tag}: no `stream … · N chars` annotation")
        elif ann != n:
            fail(f"{tag}: annotation says {ann} chars, body is {n}")
        if tag not in table:
            fail(f"{tag}: missing from the §11 queue table")
        elif table[tag] != n:
            fail(f"{tag}: §11 table says {table[tag]} chars, body is {n}")

    for tag in table:
        if tag not in seen:
            fail(f"{tag}: in the §11 table but has no post section")

    stamps = [datetime.strptime(s, "%Y-%m-%d %H:%M")
              for s in re.findall(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})Z", md)]
    if stamps != sorted(stamps) or len(set(stamps)) != len(stamps):
        fail("§11 UTC timestamps are not strictly increasing")

    if "NOT SUBMITTED" not in md and "Queue state" in md:
        warn("§11 is not marked NOT SUBMITTED — is this batch actually queued?")

    lens = [len(b) for _, b, _ in posts]
    print(f"\naudited {len(posts)} posts in {doc_path}")
    print(f"mean {statistics.mean(lens):.0f} · median {statistics.median(lens):.0f} · "
          f"min {min(lens)} · max {max(lens)}")
    return posts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("batch", nargs="?", help="posts.json")
    ap.add_argument("--prev", help="previous week's document, for the tail check")
    ap.add_argument("--prev-tail", help="UTC 'YYYY-MM-DD HH:MM' of the last pending post")
    ap.add_argument("--doc", help="finished document to self-audit")
    a = ap.parse_args()

    tail = datetime.strptime(a.prev_tail, "%Y-%m-%d %H:%M") if a.prev_tail else None
    if a.doc:
        audit(a.doc)
    elif a.batch:
        preflight(a.batch, a.prev, tail)
    else:
        ap.error("give a posts.json or --doc")

    for w in warns:
        print(f"  warn  {w}", file=sys.stderr)
    if fails:
        print(f"\nFAILED ({len(fails)}):", file=sys.stderr)
        for f in fails:
            print(f"  FAIL  {f}", file=sys.stderr)
        sys.exit(1)
    print(f"\nOK — no hard failures{f', {len(warns)} warning(s)' if warns else ''}")


if __name__ == "__main__":
    main()
