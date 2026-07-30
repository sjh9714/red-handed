---
name: audit
description: "Check whether what I said in this session is backed by what I actually did — did the tests I reported as passing really run, was an expected value quietly rewritten, was a test switched off. Reads this project's Claude Code transcript and git state locally and reports each gap with the timestamp and the quoted line. Use when the user asks whether the tests really ran, whether a claim holds up, or asks for an audit of this session."
allowed-tools:
  - Bash(npx --yes @jinhyuk9714/red-handed@latest *)
  - Read
---

# Audit this session

Run the audit and report what it found. Nothing here needs to be installed first;
`npx` fetches the CLI on demand.

## Running it

Default — the most recent session for this directory:

```bash
npx --yes @jinhyuk9714/red-handed@latest
```

Useful variations:

- `--all` — every session recorded for this project, not just the latest
- `--lang ko` — report in Korean (it follows the system locale by default)
- `--git-only` — when there is no transcript, audit the working tree diff instead
- `--json` — when you need to read the findings programmatically rather than quote them

The command exits 1 when something reached the CAUGHT tier and 0 otherwise. A
non-zero exit here is the tool working, not an error to retry.

## Reporting what it found

Show the tool's own output. It is written to be read by a person: each finding
already carries a plain-language description, the evidence with timestamps, and
one thing to go check.

Then, briefly:

- If nothing was found, say so plainly. That is the common case and it is not a
  disappointment. Do not pad it.
- If something was found, state it without softening and without arguing. When
  the finding is about this session, it is about **your own** work — resist the
  pull to explain it away. The user asked what the record says; the record is
  what it says.
- `CAUGHT` means the session shows it happening and the change is still in the
  working tree. `SUSPICIOUS` means the pattern is there but the motive is not
  established — an empty catch block is sometimes exactly right.
- If a finding looks wrong to you, say why in one sentence and point the user at
  the quoted evidence so they can judge. Do not silently drop it.

## What it cannot see

Worth saying out loud when it returns nothing, so a clean result is not
mistaken for a guarantee:

- Verification it cannot read counts as verification it did not see. A project's
  own test script, a browser check, anything without machine-readable output.
- Claim sentences are matched in English and Korean only.
- It says nothing about whether the code is correct. It only reports where the
  record does not support the claim.
