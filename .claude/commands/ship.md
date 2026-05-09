---
description: Stage, commit, and push current changes with a context-derived message
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git branch:*)
---

Commit all current changes and push to the tracked remote. Derive the commit message from the actual diff and recent context — do not invent scope.

## Steps

1. Run in parallel:
   - `git status` (without `-uall`) — see what's staged/unstaged/untracked
   - `git diff` and `git diff --staged` — actual content changes
   - `git log -10 --oneline` — match this repo's message style
   - `git rev-parse --abbrev-ref HEAD` — current branch
2. Read the diff. Decide the message:
   - One subject line, ≤72 chars, imperative mood, lowercase first word, no trailing period.
   - Mirror the terse style in `git log` (e.g. `complete`, `new tool just born`, `Initial thin X API v2 wrapper`) — concise, lowercase, no conventional-commit prefix unless recent history uses one.
   - Add a body only if the diff spans multiple distinct concerns; otherwise subject only.
   - Do NOT include "Generated with Claude Code" or co-author trailers unless the user has asked for them in this repo before.
3. Refuse to commit anything that looks like a secret (`.env`, `.tokens.json`, `*.pem`, anything with `SECRET`/`TOKEN`/`KEY` in its contents that isn't already tracked). Warn the user and stop if you see one staged.
4. Stage explicitly by path — never `git add -A` or `git add .`. List the files you're staging in the response.
5. Commit with a HEREDOC so formatting is preserved.
6. Push to the current branch's upstream. If no upstream is set, push with `-u origin <branch>`. Never force-push.
7. Report: the commit SHA (short), the subject line, and the push result (or the remote URL if available).

## Guardrails

- If `git status` shows zero changes, say so and exit — do not create an empty commit.
- If on `main`/`master` and the diff looks substantial (>1 file or >50 lines net), pause and ask before pushing.
- If pre-commit hooks fail, fix the underlying issue and create a NEW commit. Never `--amend`, never `--no-verify`.
- If the push is rejected (non-fast-forward), stop and report — do not auto-rebase or force.
