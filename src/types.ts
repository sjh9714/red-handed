import type { WorktreeReader } from "./correlate/worktree.js";

/**
 * Core data model.
 *
 * Two invariants hold everywhere in this codebase:
 *   1. A CAUGHT finding needs both session evidence and a still-present code anchor.
 *   2. A test run whose status could not be determined is `unknown`, never `failed`.
 */

export type Tier = "CAUGHT" | "SUSPICIOUS";

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Unified-diff lines, each prefixed with " ", "+", or "-". */
  lines: string[];
}

interface BaseAction {
  /** ISO timestamp, or "" when the source line carried none. */
  ts: string;
  /** Global order after merging main transcript and subagent transcripts. */
  seq: number;
  uuid: string;
  /** Present when the action came from a subagent transcript. */
  agentId?: string;
}

export interface FileEditAction extends BaseAction {
  kind: "file-edit";
  tool: "Edit" | "Write";
  filePath: string;
  opType: "create" | "update";
  oldString?: string;
  newString?: string;
  replaceAll: boolean;
  /** Full pre-edit file content, when the tool result carried it. */
  originalFile?: string;
  /** Full post-write content, for Write only. */
  content?: string;
  patch: PatchHunk[];
  userModified: boolean;
  /**
   * True when the file's content at the time of this edit no longer contained
   * the previous edit's result — something outside the agent's edits changed it.
   * Such an edit can never produce a CAUGHT finding.
   */
  precededByExternalChange: boolean;
  /** True when oldString/newString were capped, so exact matching is unreliable. */
  truncated: boolean;
}

export interface CommandAction extends BaseAction {
  kind: "command";
  command: string;
  description?: string;
  stdout: string;
  stderr: string;
  /** null when undeterminable — a pipe swallowed it, or the call was blocked. */
  exitCode: number | null;
  isError: boolean;
  interrupted: boolean;
  background: boolean;
  testRun?: TestRunEvidence;
}

export interface AssistantTextAction extends BaseAction {
  kind: "assistant-text";
  text: string;
}

export interface TodoUpdateAction extends BaseAction {
  kind: "todo-update";
  completed: string[];
  started: string[];
}

export interface UserMessageAction extends BaseAction {
  kind: "user-message";
  text: string;
}

/** A hook that ran outside the agent's control — independent verification evidence. */
export interface HookAction extends BaseAction {
  kind: "hook";
  command: string;
  exitCode: number | null;
  stdout: string;
}

export interface SessionMetaAction extends BaseAction {
  kind: "session-meta";
  cwd: string;
  version?: string;
  gitBranch?: string;
}

export type AgentAction =
  | FileEditAction
  | CommandAction
  | AssistantTextAction
  | TodoUpdateAction
  | UserMessageAction
  | HookAction
  | SessionMetaAction;

export type TestFramework = "vitest" | "jest" | "mocha" | "pytest" | "generic";
/** "unknown" is exculpatory everywhere: a run we could not read is never a failure. */
export type TestStatus = "passed" | "failed" | "unknown";

export interface TestFailureDetail {
  name?: string;
  expected?: string;
  received?: string;
  raw: string;
}

export interface TestRunEvidence {
  framework: TestFramework;
  status: TestStatus;
  passed?: number;
  failed?: number;
  skipped?: number;
  failures: TestFailureDetail[];
  /** The exact output line the status came from, quoted as evidence. */
  summaryLine?: string;
  /** "filtered" when the command named specific files or used -t/-k. */
  scope: "full" | "filtered";
}

export type ClaimFamily = "test-pass" | "build-pass";

export interface Claim {
  family: ClaimFamily;
  /** The matched sentence, quoted as evidence. */
  text: string;
  strength: "specific" | "weak";
  ts: string;
  seq: number;
  uuid: string;
  source: "assistant-text" | "todo" | "commit-message";
  agentId?: string;
}

export interface EvidenceItem {
  ts: string;
  kind: "edit" | "command" | "quote" | "test-output" | "todo" | "note";
  excerpt: string;
  uuid?: string;
}

export interface CodeAnchor {
  file: string;
  line: number;
  snippet: string;
}

export interface Finding {
  detector: string;
  /**
   * CAUGHT requires session evidence plus, for findings about code, that the
   * artifact still exists. Findings about an act the agent performed (running a
   * command) need no code anchor: the act is in the log whatever the code says.
   */
  tier: Tier;
  /** i18n key for the narrative sentence and the "what to check" line. */
  messageKey: string;
  messageVars: Record<string, string>;
  code?: CodeAnchor;
  evidence: EvidenceItem[];
  /** False when the artifact is gone from the current worktree. */
  stillPresent: boolean;
  sessionId?: string;
  projectPath?: string;
}

/** Reconstructed per-file edit history, with gaps the agent did not cause marked. */
export interface FileState {
  filePath: string;
  edits: FileEditAction[];
  /** seq values where content changed outside the agent's edits. */
  externalChangeAt: number[];
}

export interface SessionInfo {
  sessionId: string;
  transcriptPath: string;
  /** cwd read from inside the transcript, not inferred from the directory name. */
  cwd: string;
  mtimeMs: number;
  sizeBytes: number;
  subagentPaths: string[];
  toolResultsDir: string | null;
}

export interface DetectorContext {
  actions: AgentAction[];
  claims: Claim[];
  testRuns: CommandAction[];
  editsByFile: Map<string, FileState>;
  userMessages: UserMessageAction[];
  hooks: HookAction[];
  repoRoot: string | null;
  worktree: WorktreeReader;
  mode: "session" | "git-only";
  /** package.json scripts, so `npm run check` can be recognised as a test run. */
  packageScripts: Record<string, string>;
}

export interface Detector {
  id: string;
  run(ctx: DetectorContext): Finding[];
}

export interface AuditReport {
  sessionId?: string;
  /** ISO timestamp of the session's first action. */
  startedAt?: string;
  transcriptPath?: string;
  repoRoot: string | null;
  branch: string | null;
  mode: "session" | "git-only";
  findings: Finding[];
  detectorCount: number;
  /** Set when the report covers more than one session. */
  sessionsScanned?: number;
}
