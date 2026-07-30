import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractClaims } from "../claims/extract.js";
import type { AgentAction, DetectorContext, HookAction, UserMessageAction } from "../types.js";
import { attachTestRuns, buildFileStates, testRuns } from "./timeline.js";
import { createWorktreeReader } from "./worktree.js";

export interface BuildContextOptions {
  actions: AgentAction[];
  repoRoot: string | null;
  mode: "session" | "git-only";
  packageScripts?: Record<string, string>;
}

/** So that `npm run check` counts as a test run when the script runs tests. */
function readPackageScripts(repoRoot: string | null): Record<string, string> {
  if (!repoRoot) return {};
  try {
    const raw = readFileSync(join(repoRoot, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return {};
    const scripts = (parsed as { scripts?: unknown }).scripts;
    if (scripts === null || typeof scripts !== "object") return {};
    const out: Record<string, string> = {};
    for (const [name, body] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof body === "string") out[name] = body;
    }
    return out;
  } catch {
    return {};
  }
}

/** Assembles everything the detectors read, so each one stays a pure function. */
export function buildContext(options: BuildContextOptions): DetectorContext {
  const packageScripts = options.packageScripts ?? readPackageScripts(options.repoRoot);
  const actions = attachTestRuns(options.actions, packageScripts);

  return {
    actions,
    claims: extractClaims(actions),
    testRuns: testRuns(actions),
    editsByFile: buildFileStates(actions),
    userMessages: actions.filter((a): a is UserMessageAction => a.kind === "user-message"),
    hooks: actions.filter((a): a is HookAction => a.kind === "hook"),
    repoRoot: options.repoRoot,
    worktree: createWorktreeReader(options.repoRoot),
    mode: options.mode,
    packageScripts,
  };
}
