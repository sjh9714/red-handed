<h1 align="center">red-handed</h1>

<p align="center">
  <em>Your agent ran the tests. Then it shredded the receipt.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@jinhyuk9714/red-handed"><img src="https://img.shields.io/npm/v/%40jinhyuk9714%2Fred-handed?style=flat-square&color=111111&label=npm" alt="npm"></a>
  <a href="https://github.com/sjh9714/red-handed/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sjh9714/red-handed/ci.yml?branch=main&style=flat-square&color=111111&label=ci" alt="CI"></a>
  <img src="https://img.shields.io/node/v/%40jinhyuk9714%2Fred-handed?style=flat-square&color=111111" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT license">
</p>

<p align="center">
  <sub><a href="README.ko.md">한국어</a></sub>
</p>

```console
$ npx @jinhyuk9714/red-handed@latest

  Your agent ran the tests 609 times.
  It shredded the result 257 of them.                   42%

  227 of those it did to itself, piping the output
  through tail, head or grep before anything could read it.

    pnpm test 2>&1 | grep -E …                                 12
    python3 -m unittest discover -s tests 2>&1 | tail -6        7

  compare yours:  github.com/sjh9714/red-handed/issues/4
  paste this:     42% shredded · 257 of 609 runs · 227 self-inflicted · vitest pytest
```

**What is yours?** Post the line it gives you in
[the thread](https://github.com/sjh9714/red-handed/issues/4). Mine is 42%. I
have no idea whether that is high.

## Why the result goes missing

Your agent runs the tests, reads the result, and moves on. To keep its context
small it usually writes something like this:

```bash
npx vitest run 2>&1 | tail -5
```

`tail -5` throws away everything above the last five lines, and `Tests 33 passed`
is often one of them. The agent saw the answer. The transcript did not keep it.

So later nobody can check. Not you, not the next session, not whoever inherits
the code. A run whose result was thrown away is indistinguishable from a run
that never happened.

## It also audits, if you ask

The count is the part everyone gets a number from. Behind it is the original
tool: nine checks that line the session log up against your git state and report
where what the agent *said* and what it *did* don't match, with timestamps and
quotes.

<p align="center">
  <img src="docs/demo.gif" width="880" alt="red-handed catching an agent that said the tests passed after the last run had failed, and rewrote an expected value to match the bug">
</p>

Across 249 of my own sessions it confirmed nothing, and flagged seven claims
whose verification left no trace anything could read. It also accused my own
honest work six ways before I found them, one of which was a release gate in
this README that passed [by luck and reported success](#how-it-was-built) —
the exact move this tool exists to catch. All six are pinned by regression
tests. [The whole story](https://dev.to/sjh9714/i-audited-249-of-my-own-ai-coding-sessions-the-problem-wasnt-lying-4f42).

No model is called, so the same transcript gives the same verdict every time,
and nothing leaves your machine.

## Try it in 10 seconds

```bash
npx @jinhyuk9714/red-handed@latest demo    # a made-up session — watch every check fire
npx @jinhyuk9714/red-handed@latest audit   # then: your own latest Claude Code session
```

No account, no config, no API key. Your transcripts and your code never leave
your machine — the audit calls no model and makes no network request of its own.
(`npx` itself fetches the package from the npm registry, the way it does for
anything else.)

Or install it as a Claude Code plugin, and ask Claude directly whether the tests
it just reported as passing actually ran:

```bash
claude plugin marketplace add sjh9714/red-handed
claude plugin install red-handed@red-handed
```

That adds `/red-handed:audit` for this project and `/red-handed:history` for
every session on the machine. The plugin registers no hooks and runs nothing on
its own — see [Forget it is there](#forget-it-is-there) if you want the audit to
happen automatically.

## The nine checks

| what it catches | id |
| --- | --- |
| the suite got smaller — a test that no longer runs cannot fail | `test-census` |
| said tests pass — the last run failed | `claim-vs-fail` |
| said tests pass — none ran, not even in a subagent | `claim-no-run` |
| rewrote the expected value to match the bug, code untouched | `hardcoded-expected` |
| replaced the assertion with one that cannot fail, or commented it out | `assertion-weakening` |
| switched a test off (`.skip`, `.only`, `xit`, `@pytest.mark.skip`) | `skip-only` |
| hook rejected the commit → committed again with hooks off | `no-verify` |
| turned a check off (`strict: false`, CI test step deleted, suppression on a failing line) | `config-disable` |
| wrapped a fresh error in a catch that does nothing | `error-swallowing` |

Every finding carries the timestamp and the quoted line it came from, so you can
open the transcript yourself and disagree.

No model is called. The whole thing is deterministic: the same session gives the
same answer every time. Claims are matched in English, Korean, Japanese and
Chinese; reports come in English and Korean (`--lang ko`).

## What it does not do

It cannot tell you whether the code is right. It tells you when the agent's own record does not support what the agent said, which is a much smaller claim.

Known blind spots, up front:

- Claim sentences are matched in English, Korean, Japanese and Chinese. The report itself is written in English or Korean; a Japanese or Chinese session is read correctly but reported in English, because a translation nobody checked is worse than none. A session in an unlisted language produces fewer findings, never wrong ones. The patterns are a data file (`src/claims/patterns.ts`) if you want to add yours.
- Verification it cannot read is treated as verification it did not see. If your tests run through a script whose output this cannot parse, even a true claim only reaches `SUSPICIOUS`.
- Browser tests, manual checks and anything else without machine-readable output are invisible to it.
- `--git-only` mode has no transcript to read, so nothing it reports is ever more than a suspicion.

## CAUGHT and SUSPICIOUS

`CAUGHT` means two things were both true: the session shows the agent doing it, and the code still shows it now. If the agent later undid the change, there is nothing to accuse it of, and the finding disappears.

`SUSPICIOUS` means the pattern is there but the motive is not established. An empty catch block is sometimes exactly right. A test skipped on purpose is sometimes exactly right.

The tool is tuned to miss things rather than to accuse wrongly, and it is worth
saying what that costs. An adversarial review of this code found five separate
ways it could print `CAUGHT` at honest work — a test run that timed out read as
a failure, a runner it did not know (`rspec`, `phpunit`, `tox`) read as no run
at all, a re-run under a different launcher it could not see, a requested
behaviour change read as rewriting the answer, and a backgrounded command
counted as a pass. All five are fixed and each has a permanent regression test
in `test/regression/false-accusations.test.ts`. If you find a sixth, that is the
bug report I most want.

You do not have to take my word for the rate. `red-handed stats` reads your own
history and tells you what it found there:

```
194 sessions. Your agent said "tests pass" 94 times.
   89  a test ran first
    5  no test ran in that session at all
```

That is my machine. Yours will say something else.

Running it on my own history is also where the sixth one turned up. A scoped
`pytest tests/test_sync_cli.py` was followed by edits to a GitHub workflow and
two `.tsx` files in a separate web app, and the tool called the claim stale. A
Python test cannot import a `.tsx` file and a workflow is not what just ran, so
nothing about that claim had gone stale. It now only counts a change the runner
could actually have loaded.

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

Useful options: `--json` and `--md` for machine-readable output, `--lang ko` for
Korean, `--fail-on caught|suspicious|never` for CI, `--detectors a,b` to run a
subset, `--no-cache` to ignore the cache.

`stats` keeps a cache at `~/.red-handed/cache.json` (mode 0600, relocate it with
`RED_HANDED_HOME`) so repeat runs are instant. It holds excerpts from your
sessions and never leaves the machine. Credentials are masked out of every
quoted excerpt before it is written or printed.

Exit codes: `0` nothing found, `1` findings at or above `--fail-on`, `2` wrong usage.

### In CI

```yaml
- run: npx @jinhyuk9714/red-handed@latest --git-only --fail-on caught
```

Without a transcript this only reads the diff, so treat it as a smoke alarm rather than a verdict.

### Forget it is there

```
npx @jinhyuk9714/red-handed@latest install-hook
```

After this, every Claude Code session is audited the moment it ends. When a
session is clean — which is most of them — you see nothing. When something was
caught, a one-line warning appears right in Claude Code:

> red-handed: 1 finding(s) caught this session — run `npx red-handed` to see them

The audit takes about a tenth of a second and never blocks the session,
whatever happens. Existing hooks are left alone and the old settings are copied
to `settings.json.red-handed-backup` first. `uninstall-hook` removes it.

## Requirements

Node 20 or newer. Claude Code session logs are read from `~/.claude/projects`.
Test output is parsed for vitest, jest, mocha and pytest. Runs are recognised for
rspec, phpunit, tox, ctest and friends, plus `make test`, `go test`, `cargo test`,
`./gradlew test`, `./mvnw verify`, `bundle exec`, and project scripts named like
tests — recognised means a claim about them stays honest, even where the output
format is not parsed.

## How it was built

Written with Claude Code. I wrote the spec and the false-positive rules, reviewed
every detector, and then had the finished thing pulled apart by an adversarial
review that reproduced each defect against the built binary before I believed it.

That review is where most of the guards came from. It also caught the tool doing
the exact thing it exists to detect: the `0 CAUGHT` release gate I had written
into this README held because my own sessions are all JavaScript and TypeScript,
so the code path that mis-read a timeout as a failure had never once run. The
gate passed by luck and reported success — the exact move this tool exists to
catch.

## Related work

This is not the first tool to try this. I checked before assuming otherwise.

- [agent-receipts](https://github.com/0xelitesystem/agent-receipts) reads the same
  transcripts for the same purpose, and got there first. It is Python, English-only,
  and does not check whether the code it accuses still looks that way today.
- [claude-tap](https://github.com/liaohch3/claude-tap) intercepts agent API traffic
  while it happens. This reads the transcript afterwards.
- Session viewers such as [claude-code-session-viewer](https://github.com/RustingSword/claude_code_session_viewer)
  let you browse transcripts by hand.
- [vibe-kanban](https://github.com/BloopAI/vibe-kanban) orchestrates agents; it
  does not audit them.

What is different here is the tiering — a `CAUGHT` needs the change to still be in
your working tree — and how hard that was to get right. If your tool belongs on
this list, open a pull request.

## License

MIT
