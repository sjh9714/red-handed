# red-handed

[한국어](README.ko.md)

Your agent said *"All tests pass ✅"*. Did they?

`red-handed` reads the session log your coding agent left behind, lines it up
with your git history, and shows you — with timestamps and quotes — where what
it *said* and what it *did* don't match.

![red-handed report: an agent caught committing past the hooks and switching a test off](docs/demo.svg)

## Try it in 10 seconds

```bash
npx red-handed demo    # a made-up session — watch every check fire
npx red-handed         # then: audit your own latest Claude Code session
```

No account, no config, no API key. Nothing leaves your machine.

## The seven checks

| what it catches | id |
| --- | --- |
| said tests pass — the last run failed | `claim-vs-fail` |
| said tests pass — none ran, not even in a subagent | `claim-no-run` |
| rewrote the expected value to match the bug, code untouched | `hardcoded-expected` |
| switched a test off (`.skip`, `.only`, `xit`, `@pytest.mark.skip`) | `skip-only` |
| hook rejected the commit → committed again with hooks off | `no-verify` |
| turned a check off (`strict: false`, CI test step deleted, suppression on a failing line) | `config-disable` |
| wrapped a fresh error in a catch that does nothing | `error-swallowing` |

Every finding carries the timestamp and the quoted line it came from, so you can
open the transcript yourself and disagree.

No model is called. The whole thing is deterministic: the same session gives the
same answer every time. Reports come in English and Korean (`--lang ko`).

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

After this, every Claude Code session is audited the moment it ends. When a
session is clean — which is most of them — you see nothing. When something was
caught, a one-line warning appears right in Claude Code:

> red-handed: 1 finding(s) caught this session — run `npx red-handed` to see them

The audit takes about a tenth of a second and never blocks the session,
whatever happens. Existing hooks are left alone and the old settings are copied
to `settings.json.red-handed-backup` first. `uninstall-hook` removes it.

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
