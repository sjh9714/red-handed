/**
 * Counts how often a test run left nothing behind to read.
 *
 * The rest of this tool asks whether a claim was true. This asks something
 * smaller and much more often answerable: after the tests ran, was the result
 * still there. Usually the reason it is not is that the agent wrote
 * `2>&1 | tail -5` to keep its context small, and the summary line was above
 * the cut. It saw the answer. The transcript did not keep it.
 *
 * A run counts as readable only when the framework's own summary survived.
 * Falling back to an exit code does not count: an exit code is something this
 * tool can read, not something a person scrolling the log a week later can.
 */
import { buildContext } from "./correlate/context.js";
import { allSessions, type DiscoverOptions } from "./session/discover.js";
import { normalize } from "./session/normalize.js";
import type { TestFramework } from "./types.js";

/** Pipes that keep a slice of the output, which is where summary lines go to die. */
const TRUNCATING_PIPE = /\|\s*(?:tail|head|grep|sed|awk|cut)\b/;

/**
 * `detectTestRun` answers "did something test-shaped run" and casts a wide net
 * on purpose, because the detectors behind it have their own guards. This count
 * answers the narrower "did a suite run", so it drops one class the wider net
 * catches: an inline script that merely names a test file.
 *
 *     python3 - <<'PY'
 *     p = pathlib.Path("tests/test_core.py")   # editing the file, not running it
 *     PY
 *
 * Measured on a 673-run corpus this removed 9 of 14 misreads and no real runs.
 */
const INLINE_HEREDOC = /<<-?\s*['"]?\w+['"]?/;

export interface ReceiptsReport {
  sessions: number;
  total: number;
  readable: number;
  shredded: number;
  /** Of the shredded runs, how many the agent truncated itself. */
  selfInflicted: number;
  byFramework: Map<TestFramework, { total: number; shredded: number }>;
  /** The command shapes that lost the most results, worst first. */
  worstCommands: { command: string; count: number }[];
}

/**
 * Reduces a command to the shape that repeats.
 *
 * This output is built to be screenshotted, so absolute paths must not survive
 * it. A run is usually a long `cd somewhere && …`; what earns a place in the
 * list is the runner and the pipe that ate its output, and nothing else.
 */
export function commandShape(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim();

  // Show the segment that actually ran tests, not merely the last one holding a
  // package manager. `pnpm test && pnpm format:check | tail -1` is a test run
  // whose result survived; printing the format:check half blames the wrong line.
  const segment =
    flat
      .split(/&&|\|\||;/)
      .filter(
        (part) =>
          /\b(?:vitest|jest|mocha|pytest|py\.test|unittest|rspec|phpunit|--test)\b/.test(part) ||
          /\btests?\b|\bspec\b|\btest:/.test(part),
      )
      .pop() ?? flat;

  return segment
    .replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, "…")
    .replace(/<<\s*\S+[\s\S]*/g, "…")
    .replace(/(?:\/[\w.@-]+){2,}\/?/g, "…")
    .replace(/\b[\w@/.-]+\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|php)\b/g, "<file>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 54);
}

export async function countReceipts(
  options: DiscoverOptions & { onProgress?: (done: number, total: number) => void } = {},
): Promise<ReceiptsReport> {
  const sessions = allSessions(options);
  const byFramework = new Map<TestFramework, { total: number; shredded: number }>();
  const lost = new Map<string, number>();
  let scanned = 0;
  let total = 0;
  let readable = 0;
  let shredded = 0;
  let selfInflicted = 0;

  for (const [index, session] of sessions.entries()) {
    let actions;
    try {
      ({ actions } = await normalize(session.transcriptPath, {
        subagentPaths: session.subagentPaths,
        toolResultsDir: session.toolResultsDir,
      }));
    } catch {
      continue;
    }
    options.onProgress?.(index + 1, sessions.length);
    if (actions.length === 0) continue;
    scanned += 1;

    // Test evidence is attached in buildContext, not in normalize. Reading
    // `action.testRun` straight off normalize reports zero runs for an entire
    // corpus, which is how the first version of this count was wrong.
    const context = buildContext({ actions, repoRoot: session.cwd || null, mode: "session" });

    for (const action of context.actions) {
      if (action.kind !== "command" || !action.testRun) continue;
      const evidence = action.testRun;
      if (evidence.framework === "generic" && INLINE_HEREDOC.test(action.command)) continue;

      total += 1;
      const bucket = byFramework.get(evidence.framework) ?? { total: 0, shredded: 0 };
      bucket.total += 1;

      if (evidence.summaryLine) {
        readable += 1;
      } else {
        shredded += 1;
        bucket.shredded += 1;
        if (TRUNCATING_PIPE.test(action.command)) {
          selfInflicted += 1;
          const shape = commandShape(action.command);
          lost.set(shape, (lost.get(shape) ?? 0) + 1);
        }
      }
      byFramework.set(evidence.framework, bucket);
    }
  }

  const worstCommands = [...lost.entries()]
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return { sessions: scanned, total, readable, shredded, selfInflicted, byFramework, worstCommands };
}
