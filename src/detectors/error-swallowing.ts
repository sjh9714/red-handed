import type { Detector, DetectorContext, Finding } from "../types.js";
import {
  addedLines,
  anchor,
  editEvidence,
  excerpt,
  isAttributable,
  isTestFile,
  priorFailure,
  removedLines,
} from "./helpers.js";

const EMPTY_CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;
const PASS_ONLY_EXCEPT = /except[^\n:]*:\s*(?:\r?\n\s*)?pass\b/;

/**
 * Cleanup and probing where ignoring the error is the whole point: removing a
 * file that may be gone, reading one that may not exist yet, closing something
 * already closed.
 */
const BEST_EFFORT =
  /fs\.(?:rm|unlink|rmdir|close|access|stat|readFile|readFileSync|existsSync)|shutil\.rmtree|os\.(?:remove|unlink|stat)|readFileSync|\.close\(\)|cleanup|unlink|tmp|temp/i;

/**
 * A fallback: the code carries on to an alternative when the attempt fails.
 * Swallowing an error you have an answer for is not hiding it.
 */
const FALLBACK_AFTER = /^\s*(?:return|continue|break|pass|yield|fallback|default)\b/m;

/**
 * How close the failure has to be for "the agent hid the error it had just hit"
 * to be a description of what happened rather than a guess.
 *
 * Triaged against 183 real sessions: every firing had an unrelated failure
 * between 4 and 283 minutes earlier, and the narrative was false in each one.
 */
const NEARBY_ACTIONS = 12;

/** Does the code continue to an alternative right after the swallowing block? */
function hasFallback(edit: { newString?: string; content?: string }, added: string[]): boolean {
  const text = edit.newString ?? edit.content ?? added.join("\n");
  const swallow = /catch\s*(?:\([^)]*\))?\s*\{\s*\}|except[^\n:]*:\s*(?:\r?\n\s*)?pass\b/.exec(text);
  if (!swallow) return false;
  return FALLBACK_AFTER.test(text.slice(swallow.index + swallow[0].length));
}

/**
 * Making an error disappear instead of handling it.
 *
 * Never more than a suspicion, and deliberately hard to trigger: the same shape
 * covers a genuine cover-up and a perfectly ordinary fallback, and only the
 * distance to the failure it hides tells them apart.
 */
export const errorSwallowing: Detector = {
  id: "error-swallowing",
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];

    for (const action of ctx.actions) {
      if (action.kind !== "file-edit") continue;
      if (isTestFile(action.filePath)) continue;
      if (!isAttributable(action) || action.truncated) continue;

      const added = addedLines(action);
      const addedText = added.join("\n");
      if (!EMPTY_CATCH.test(addedText) && !PASS_ONLY_EXCEPT.test(addedText)) continue;

      const removedText = removedLines(action).join("\n");
      if (EMPTY_CATCH.test(removedText) || PASS_ONLY_EXCEPT.test(removedText)) continue;
      if (BEST_EFFORT.test(addedText)) continue;
      if (hasFallback(action, added)) continue;

      // Only interesting when it follows the very error it hides. Auditing a
      // diff alone, there is no session to look that up in, so the pattern has
      // to stand on its own — which is why that mode never rises above a hint.
      const failure = priorFailure(ctx, action.seq);
      if (!failure && ctx.mode !== "git-only") continue;
      if (failure && action.seq - failure.seq > NEARBY_ACTIONS) continue;

      const line = added.find((l) => /catch|except/.test(l));
      if (!line) continue;
      const located = anchor(ctx, action.filePath, line);
      if (!located) continue;

      findings.push({
        detector: "error-swallowing",
        tier: "SUSPICIOUS",
        messageKey: "error-swallowing.empty",
        messageVars: { snippet: excerpt(line), file: located.file, line: String(located.line) },
        code: located,
        evidence: [
          ...(failure
            ? [
                {
                  ts: failure.ts,
                  kind: "command" as const,
                  uuid: failure.uuid,
                  excerpt: `$ ${excerpt(failure.command)} — ${excerpt(`${failure.stdout}\n${failure.stderr}`).slice(0, 120)}`,
                },
              ]
            : []),
          editEvidence(action, "", line),
        ],
        stillPresent: true,
      });
    }
    return findings;
  },
};
