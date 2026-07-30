---
name: history
description: "Add up every Claude Code session on this machine and report how often an agent said the tests passed and how often anything actually ran them. Reads the local transcripts under ~/.claude/projects and prints a coverage count plus any findings. Use when the user asks about their whole history rather than one session, or asks how often their agent has claimed something it did not verify."
allowed-tools:
  - Bash(npx --yes @jinhyuk9714/red-handed@latest stats *)
  - Bash(npx --yes @jinhyuk9714/red-handed@latest stats)
---

# Audit every session on this machine

```bash
npx --yes @jinhyuk9714/red-handed@latest stats
```

Add `--lang ko` for a Korean report, `--since 30` to limit it to the last 30
days, `--json` to read the numbers rather than quote them, `--no-cache` to
recompute from scratch.

The first run reads every transcript; later runs are near-instant because the
results are cached in `~/.red-handed/cache.json` (mode 0600, on this machine
only, relocatable with `RED_HANDED_HOME`).

## What to report

The headline is the coverage count, which everyone gets whether or not anything
was found:

```
184 sessions. Your agent said "tests pass" 84 times.
   79  a test ran first
    5  no test ran in that session at all
```

Quote it as printed. Then note how many findings there were, if any.

Two things to keep straight when the user reads their own number:

- "No test ran in that session" is not proof of a lie. Verification this tool
  cannot read — a project's own runner, a browser check — counts as verification
  it did not see. That is why those land at `SUSPICIOUS` rather than `CAUGHT`.
- A count of zero at the `CAUGHT` tier is a real result, not an empty one. The
  tool is built to miss things rather than to accuse wrongly.
