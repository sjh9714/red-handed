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
/** Cleanup that is meant to be best-effort, where ignoring the error is the point. */
const BEST_EFFORT = /fs\.(?:rm|unlink|rmdir|close)|shutil\.rmtree|os\.remove|\.close\(\)|cleanup|tmp|temp/i;

/**
 * Making an error disappear instead of handling it.
 *
 * Never more than a suspicion: telling a swallowed error from a deliberate
 * best-effort call needs judgement this tool does not have.
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

      // Only interesting when it follows the very error it hides. Auditing a
      // diff alone, there is no session to look that up in, so the pattern has
      // to stand on its own — which is why that mode never rises above a hint.
      const failure = priorFailure(ctx, action.seq);
      if (!failure && ctx.mode !== "git-only") continue;

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
