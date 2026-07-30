# red-handed

[한국어](README.ko.md)

Audit what your coding agent actually did against what it said it did.

```
npx red-handed demo
```

That command needs no repository and no setup. It runs a made-up session where an
agent cuts every corner this tool knows about, and prints exactly what you would
see on your own project. Two of the seven findings it reports:

```
  RED-HANDED · session d3m0d3m0 (2026-07-23 21:00) · repo demo-project @ main
  CAUGHT 6   SUSPICIOUS 1   detectors 7

  CAUGHT  claim-vs-fail
  │ The agent said the tests pass. The last test run before it said otherwise,
  │ and nothing ran in between.
  │
  │ evidence
  │ 21:01:34  $ npx vitest run
  │           Tests 1 failed | 33 passed (34)
  │ 21:06:16  All 34 tests pass now — the cart total is fixed.
  │ 21:06:16  no test run between that failure and this claim
  │
  │ → check: Run the tests again and compare with the sentence above.

  CAUGHT  hardcoded-expected  test/cart.test.ts:2
  │ A test failed because the code produced 11 instead of 8. The agent then
  │ changed the test to expect 11 — the value the failure produced — without
  │ touching the code.
  │
  │ evidence
  │ 21:01:34  Tests 1 failed | 33 passed (34) — expected 8, received 11
  │ 21:03:08  - expect(total()).toBe(8)   →   + expect(total()).toBe(11)
  │ 21:03:08  no implementation file was changed between the failure and this edit
  │
  │ → check: Decide which value is actually correct: 8 or 11.
```

Then run it on your own project:

```
npx red-handed
```

## What it does

It reads two things: the Claude Code session log for your project, and your git state. It lines them up and looks for the gap between what the agent said and what it did.

There are seven checks:

| check | what it looks for |
| --- | --- |
| `claim-vs-fail` | the agent said the tests pass, and the last run before that said otherwise |
| `claim-no-run` | the agent said the tests pass, and no test ran at all — in the main thread or in any subagent |
| `hardcoded-expected` | a test failed, and the expected value was rewritten to the value the failure produced, with the code left alone |
| `skip-only` | a test was switched off with `.skip`, `.only`, `xit` or `@pytest.mark.skip` |
| `no-verify` | a commit hook rejected the commit, so the commit ran again with the hooks off |
| `config-disable` | `strict` turned off, a test step deleted from CI, a suppression added at the line a check had just failed on |
| `error-swallowing` | an error came up and got wrapped in a catch that does nothing with it |

Every finding carries the timestamp and the quoted line it came from, so you can go read the transcript yourself and disagree.

No model is called. Nothing is uploaded. The whole thing is deterministic: the same session gives the same answer every time.

## What it does not do

It cannot tell you whether the code is right. It tells you when the agent's own record does not support what the agent said, which is a much smaller claim.

Known blind spots, up front:

- Claims are matched in English and Korean only. A session in another language will produce fewer findings, not wrong ones. The patterns are a data file (`src/claims/patterns.ts`) if you want to add yours.
- Verification it cannot read is treated as verification it did not see. If your project runs tests through a script whose output this does not parse, a real claim gets downgraded to a suspicion rather than accepted.
- Browser tests, manual checks and anything else without machine-readable output are invisible to it.
- `--git-only` mode has no transcript to read, so nothing it reports is ever more than a suspicion.

## CAUGHT and SUSPICIOUS

`CAUGHT` means two things were both true: the session shows the agent doing it, and the code still shows it now. If the agent later undid the change, there is nothing to accuse it of, and the finding disappears.

`SUSPICIOUS` means the pattern is there but the motive is not established. An empty catch block is sometimes exactly right. A test skipped on purpose is sometimes exactly right.

The tool is tuned to miss things rather than to accuse wrongly. Running it against 183 of my own Claude Code sessions produced 0 `CAUGHT` and 13 `SUSPICIOUS` across 6 sessions. That number is in the repository because it is the honest one: if a tool like this cries wolf, it is worse than not having it.

## Usage

```
red-handed                        audit the most recent session for this directory
red-handed --all                  audit every session for this directory
red-handed --session <id|path>    audit one specific session
red-handed --git-only             audit the diff instead, when there is no transcript
red-handed stats                  add up findings across every session on this machine
red-handed demo                   see every check fire, on a made-up session
red-handed install-hook           audit automatically when a session ends
```

Useful options: `--json` and `--md` for machine-readable output, `--lang ko` for Korean, `--fail-on caught|suspicious|never` for CI, `--detectors a,b` to run a subset.

Exit codes: `0` nothing found, `1` findings at or above `--fail-on`, `2` wrong usage.

### In CI

```yaml
- run: npx red-handed --git-only --fail-on caught
```

Without a transcript this only reads the diff, so treat it as a smoke alarm rather than a verdict.

### Forget it is there

```
npx red-handed install-hook
```

Adds a Stop hook to `~/.claude/settings.json` that audits each session as it ends and stays quiet unless something was caught. Existing hooks are left alone and the old settings are copied to `settings.json.red-handed-backup` first. `uninstall-hook` removes it.

## Requirements

Node 20 or newer. Claude Code session logs are read from `~/.claude/projects`. Test output is parsed for vitest, jest, mocha and pytest, plus `make test`, `go test`, `cargo test` and project scripts named like tests.

## How it was built

Written with Claude Code. I wrote the spec and the false-positive rules, reviewed every detector, and ran the result against my own session history to find where it was wrong — which it was, in four different ways, before the checks above got their guards.

The tool is also run against this repository's own sessions. That is not a slogan; it is where several of the guards came from.

## Related work

- [claude-tap](https://github.com/liaohch3/claude-tap) intercepts and inspects agent API traffic while it happens. This reads the transcript afterwards.
- Session viewers such as [claude-code-session-viewer](https://github.com/RustingSword/claude_code_session_viewer) let you browse transcripts by hand.
- [vibe-kanban](https://github.com/BloopAI/vibe-kanban) orchestrates agents rather than auditing them.

If your tool belongs on this list, open a pull request.

## License

MIT
