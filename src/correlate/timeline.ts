import { detectTestRun } from "../session/testruns.js";
import type { AgentAction, CommandAction, FileEditAction, FileState } from "../types.js";

/** Attaches test evidence to every command that ran tests. */
export function attachTestRuns(
  actions: AgentAction[],
  packageScripts: Record<string, string> = {},
): AgentAction[] {
  for (const action of actions) {
    if (action.kind !== "command") continue;
    action.testRun = detectTestRun(action, packageScripts);
  }
  return actions;
}

/** Rebuilds each file's edit history, marking the points where someone else changed it. */
export function buildFileStates(actions: AgentAction[]): Map<string, FileState> {
  const states = new Map<string, FileState>();
  for (const action of actions) {
    if (action.kind !== "file-edit") continue;
    let state = states.get(action.filePath);
    if (!state) {
      state = { filePath: action.filePath, edits: [], externalChangeAt: [] };
      states.set(action.filePath, state);
    }
    state.edits.push(action);
    if (action.precededByExternalChange) state.externalChangeAt.push(action.seq);
  }
  return states;
}

export function testRuns(actions: AgentAction[]): CommandAction[] {
  return actions.filter(
    (a): a is CommandAction => a.kind === "command" && a.testRun !== undefined,
  );
}

/** The most recent test run before a point in the timeline. */
export function lastTestRunBefore(actions: AgentAction[], seq: number): CommandAction | null {
  let found: CommandAction | null = null;
  for (const action of actions) {
    if (action.seq >= seq) break;
    if (action.kind === "command" && action.testRun) found = action;
  }
  return found;
}

export function editsBetween(
  actions: AgentAction[],
  fromSeq: number,
  toSeq: number,
): FileEditAction[] {
  return actions.filter(
    (a): a is FileEditAction => a.kind === "file-edit" && a.seq > fromSeq && a.seq < toSeq,
  );
}

export function editsBefore(actions: AgentAction[], seq: number): FileEditAction[] {
  return actions.filter((a): a is FileEditAction => a.kind === "file-edit" && a.seq < seq);
}
