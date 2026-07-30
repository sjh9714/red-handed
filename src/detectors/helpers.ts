import { classifyTestCommand } from "../session/testruns.js";
import { sanitizeForClassification } from "../session/shell.js";
import type {
  CodeAnchor,
  CommandAction,
  DetectorContext,
  EvidenceItem,
  FileEditAction,
  TestFramework,
} from "../types.js";

const MAX_EXCERPT = 200;

/**
 * Credentials, masked before anything is quoted.
 *
 * Findings quote commands and file contents out of a transcript, and the help
 * text invites people to paste that into a pull request. Over-masking costs a
 * reader a little context; under-masking publishes someone's key.
 */
const SECRETS: RegExp[] = [
  // The prefix must end in an underscore, so AWS_SECRET_ACCESS_KEY is caught
  // while MONKEY=banana is left alone.
  /\b(?:\w*_)?(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL)\w*\s*=\s*\S+/gi,
  /\b(?:gh[pousr]_|sk-|xox[baprs]-|AKIA|ASIA)[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+\S+/gi,
  /:\/\/[^/\s:@]+:[^/\s@]+@/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRETS) {
    out = out.replace(pattern, (match) => {
      // Keep the shape of an assignment so the reader still sees what leaked.
      const name = /^([A-Za-z_]\w*)\s*=/.exec(match);
      if (name) return `${name[1]}=<REDACTED>`;
      if (match.startsWith("Bearer")) return "Bearer <REDACTED>";
      if (match.startsWith("://")) return "://<REDACTED>@";
      return "<REDACTED>";
    });
  }
  return out;
}

/**
 * A command that is about testing in some way this tool cannot read: a project's
 * own runner, a build tool's check target, a browser suite. Deliberately broad,
 * because its only job is to stop a finding short of certainty.
 */
export const TEST_SHAPED =
  /\btests?\b|spec|pytest|vitest|jest|mocha|phpunit|tox\b|nox\b|ctest|busted|gradlew|gradle|mvnw|mvn\b|bazel|turbo|verify|check|테스트/i;

/**
 * Whether something between two points may have verified the code without this
 * tool being able to read the result.
 *
 * If so, no finding in that window can be certain: an unrecognised runner or a
 * hook that ran the suite is verification that happened, whatever we could parse.
 */
export function unreadableVerificationBetween(
  ctx: DetectorContext,
  fromSeq: number,
  toSeq: number,
): boolean {
  for (const action of ctx.actions) {
    if (action.seq <= fromSeq || action.seq >= toSeq) continue;
    if (action.kind === "hook") {
      if (action.command !== "" && classifyTestCommand(action.command, ctx.packageScripts)) {
        return true;
      }
      continue;
    }
    if (action.kind !== "command") continue;
    // A run we could read is accounted for elsewhere; only the unreadable matter.
    if (action.testRun) continue;
    if (TEST_SHAPED.test(sanitizeForClassification(action.command))) return true;
  }
  return false;
}

/** Files whose contents cannot change what a test does. */
const DOCUMENTATION = /\.(?:md|mdx|markdown|txt|rst|adoc|png|jpe?g|gif|svg|webp|ico|pdf)$/i;

/**
 * Whether editing this file could plausibly change a test result.
 *
 * A note or a README cannot, and neither can a file outside the repository —
 * telling someone their claim is stale because a markdown file changed says
 * this tool does not know what code is.
 */
export function couldAffectTests(ctx: DetectorContext, filePath: string): boolean {
  if (DOCUMENTATION.test(filePath)) return false;
  if (ctx.repoRoot === null) return true;
  const root = ctx.repoRoot.endsWith("/") ? ctx.repoRoot : `${ctx.repoRoot}/`;
  return filePath === ctx.repoRoot || filePath.startsWith(root);
}

/** The one place every quoted command, edit and output passes through. */
export function excerpt(text: string): string {
  const collapsed = maskSecrets(text).replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_EXCERPT ? `${collapsed.slice(0, MAX_EXCERPT)}...` : collapsed;
}

/** Lines this edit introduced. */
export function addedLines(edit: FileEditAction): string[] {
  if (edit.patch.length > 0) {
    return edit.patch
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.startsWith("+"))
      .map((line) => line.slice(1));
  }
  return (edit.newString ?? "").split("\n");
}

/** Lines this edit removed. */
export function removedLines(edit: FileEditAction): string[] {
  if (edit.patch.length > 0) {
    return edit.patch
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.startsWith("-"))
      .map((line) => line.slice(1));
  }
  return (edit.oldString ?? "").split("\n");
}

export function isTestFile(path: string): boolean {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return true;
  if (/(?:^|\/)test_[^/]+\.py$/.test(path) || /_test\.py$/.test(path)) return true;
  return /(?:^|\/)(?:tests?|__tests__|spec)\//.test(path);
}

export function isConfigFile(path: string): boolean {
  return /(?:^|\/)(?:tsconfig[\w.-]*\.json|jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|\.eslintrc[\w.]*|setup\.cfg|pyproject\.toml|pytest\.ini)$/.test(
    path,
  );
}

export function isWorkflowFile(path: string): boolean {
  return /\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
}

/** Source a JavaScript runner can load, and source it definitively cannot. */
const JS_SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;
const PY_SOURCE = /\.(?:py|pyi)$/i;

/**
 * Whether editing this file could change what that run reported.
 *
 * Narrower than `couldAffectTests`, and used only where the question is whether
 * a *passing* run went stale. Accusing someone of a stale claim is a smaller
 * charge than accusing them of lying, but it is still a charge, and it should
 * not rest on a file the runner could not have loaded.
 *
 * Only definite mismatches suppress: pytest cannot import a `.tsx`, a
 * JavaScript runner cannot import a `.py`, and a CI workflow is not what just
 * ran on this machine. Anything else — a `package.json`, a `.go` file, a lock
 * file, a fixture — is left alone, because "looks unrelated" is a guess and a
 * guess is not grounds for dropping evidence.
 */
export function couldReachRun(
  ctx: DetectorContext,
  filePath: string,
  framework: TestFramework,
): boolean {
  if (!couldAffectTests(ctx, filePath)) return false;
  // Editing the pipeline changes what CI will do next time, not what the
  // command that already ran here reported.
  if (isWorkflowFile(filePath)) return false;
  if (framework === "pytest") return !JS_SOURCE.test(filePath);
  if (framework === "vitest" || framework === "jest" || framework === "mocha") {
    return !PY_SOURCE.test(filePath);
  }
  // "generic" means the runner was recognised but not identified, so there is
  // nothing to reason from.
  return true;
}

/** True when the user themselves asked for whatever we are about to flag. */
export function userAskedFor(ctx: DetectorContext, pattern: RegExp): boolean {
  return ctx.userMessages.some((message) => pattern.test(message.text));
}

/** The last command before a point that exited non-zero, optionally matching its output. */
export function priorFailure(
  ctx: DetectorContext,
  seq: number,
  outputPattern?: RegExp,
): CommandAction | null {
  let found: CommandAction | null = null;
  for (const action of ctx.actions) {
    if (action.seq >= seq) break;
    if (action.kind !== "command") continue;
    if (action.exitCode === null || action.exitCode === 0) continue;
    if (outputPattern && !outputPattern.test(`${action.stdout}\n${action.stderr}`)) continue;
    found = action;
  }
  return found;
}

/** The last failing test run before a point. */
export function priorFailingTestRun(ctx: DetectorContext, seq: number): CommandAction | null {
  let found: CommandAction | null = null;
  for (const action of ctx.actions) {
    if (action.seq >= seq) break;
    if (action.kind === "command" && action.testRun?.status === "failed") found = action;
  }
  return found;
}

export function commandEvidence(action: CommandAction, note?: string): EvidenceItem {
  return {
    ts: action.ts,
    kind: "command",
    uuid: action.uuid,
    excerpt: note ? `$ ${excerpt(action.command)} — ${note}` : `$ ${excerpt(action.command)}`,
  };
}

export function editEvidence(edit: FileEditAction, before: string, after: string): EvidenceItem {
  const removed = before.trim();
  const added = after.trim();
  const excerptText =
    removed === "" ? `+ ${excerpt(added)}`
    : added === "" ? `- ${excerpt(removed)}`
    : `- ${excerpt(removed)}   →   + ${excerpt(added)}`;
  return { ts: edit.ts, kind: "edit", uuid: edit.uuid, excerpt: excerptText };
}

/**
 * Points a finding at the code as it stands now.
 *
 * Returns null when the line is no longer there, which is how a change the agent
 * later took back stops being an accusation.
 */
export function anchor(
  ctx: DetectorContext,
  filePath: string,
  needle: string,
): CodeAnchor | null {
  const located = ctx.worktree.locate(filePath, needle);
  if (!located) return null;
  return {
    file: ctx.worktree.relative(filePath),
    line: located.line,
    snippet: located.snippet,
  };
}

/** An edit can only be blamed on the agent if nothing else touched the file first. */
export function isAttributable(edit: FileEditAction): boolean {
  return !edit.precededByExternalChange && !edit.userModified;
}
