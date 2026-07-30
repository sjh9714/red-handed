import type {
  CodeAnchor,
  CommandAction,
  DetectorContext,
  EvidenceItem,
  FileEditAction,
} from "../types.js";

const MAX_EXCERPT = 200;

export function excerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
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
