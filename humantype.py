#!/usr/bin/env python3
"""Type the clipboard contents character by character with human-like random
delays — a dependency-free replacement for hammerspoon-init.lua.

Uses only the Python stdlib: clipboard via `pbpaste`, key events via ctypes
straight into CoreGraphics (the same CGEventPost Hammerspoon uses).

Usage:
    python3 humantype.py            # 3s countdown, then types into the focused app
    python3 humantype.py 5          # 5s countdown
    python3 humantype.py 0          # type immediately (for hotkey runners)

Cancel: Ctrl+C in the terminal, or `pkill -f humantype.py` if launched headless.

The process that posts the events (Terminal / iTerm / Shortcuts) needs
Accessibility permission: System Settings → Privacy & Security → Accessibility.
"""

import ctypes
import random
import subprocess
import sys
import time

_cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
_cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")

_cg.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
_cg.CGEventCreateKeyboardEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint16, ctypes.c_bool]
_cg.CGEventKeyboardSetUnicodeString.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p]
_cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
_cf.CFRelease.argtypes = [ctypes.c_void_p]

KCG_HID_EVENT_TAP = 0
RETURN_KEYCODE = 36


def post_char(ch: str) -> None:
    """Post key-down/key-up carrying an arbitrary unicode char (diacritics, emoji ok)."""
    units = ch.encode("utf-16-le")  # surrogate pairs become 2 UniChars
    n = len(units) // 2
    buf = (ctypes.c_uint16 * n).from_buffer_copy(units)
    for down in (True, False):
        ev = _cg.CGEventCreateKeyboardEvent(None, 0, down)
        _cg.CGEventKeyboardSetUnicodeString(ev, n, buf)
        _cg.CGEventPost(KCG_HID_EVENT_TAP, ev)
        _cf.CFRelease(ev)


def post_return() -> None:
    """A real Return keypress — unicode-string events don't produce newlines."""
    for down in (True, False):
        ev = _cg.CGEventCreateKeyboardEvent(None, RETURN_KEYCODE, down)
        _cg.CGEventPost(KCG_HID_EVENT_TAP, ev)
        _cf.CFRelease(ev)


def human_delay(ch: str) -> float:
    if ch == "\n":
        return 0.25 + random.random() * 0.25  # end of line: ~250-500ms
    if ch == " ":
        return 0.08 + random.random() * 0.10  # between words: ~80-180ms
    return 0.02 + random.random() * 0.05      # normal chars: ~20-70ms


def main() -> int:
    countdown = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0

    text = subprocess.run(["pbpaste"], capture_output=True).stdout.decode("utf-8")
    if not text:
        print("clipboard is empty", file=sys.stderr)
        return 1

    text = text.replace("\r\n", "\n").replace("\r", "\n")

    if countdown > 0:
        print(f"typing {len(text)} chars in {countdown:g}s — focus the target window (Ctrl+C to cancel)")
        time.sleep(countdown)

    try:
        for ch in text:
            if ch == "\n":
                post_return()
            else:
                post_char(ch)
            time.sleep(human_delay(ch))
    except KeyboardInterrupt:
        print("\ntyping cancelled", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
