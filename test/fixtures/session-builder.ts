import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Builds schema-accurate Claude Code transcripts for tests.
 *
 * Field shapes here are copied from real transcripts (verified against CLI
 * versions 2.1.31 - 2.1.219). If a test passes against a fixture that the real
 * format would not produce, the test is worthless, so this file is the one place
 * allowed to know the wire format in detail.
 */

interface BuilderOptions {
  cwd?: string;
  sessionId?: string;
  version?: string;
  gitBranch?: string;
  startTime?: number;
}

export interface BashResultOptions {
  stdout?: string;
  stderr?: string;
  /** Set to make this a failed command: the result becomes an "Error: Exit code N" string. */
  exitCode?: number;
  interrupted?: boolean;
  background?: boolean;
  description?: string;
  /** Blocked/permission errors: an error string with no exit code at all. */
  blocked?: string;
}

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${String(counter).padStart(6, "0")}`;
}

function structuredPatch(oldString: string, newString: string, startLine: number) {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");
  return [
    {
      oldStart: startLine,
      oldLines: oldLines.length,
      newStart: startLine,
      newLines: newLines.length,
      lines: [...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`)],
    },
  ];
}

export class SessionBuilder {
  private lines: string[] = [];
  private subagentLines = new Map<string, string[]>();
  private readonly cwd: string;
  private readonly sessionId: string;
  private readonly version: string;
  private readonly gitBranch: string;
  private time: number;
  private parentUuid: string | null = null;
  private currentAgentId: string | undefined;

  constructor(opts: BuilderOptions = {}) {
    this.cwd = opts.cwd ?? "/repo";
    this.sessionId = opts.sessionId ?? "11111111-2222-3333-4444-555555555555";
    this.version = opts.version ?? "2.1.219";
    this.gitBranch = opts.gitBranch ?? "main";
    this.time = opts.startTime ?? Date.parse("2026-07-23T21:00:00.000Z");
  }

  private stamp(): string {
    this.time += 60_000;
    return new Date(this.time).toISOString();
  }

  private push(obj: Record<string, unknown>): void {
    const target = this.currentAgentId
      ? (this.subagentLines.get(this.currentAgentId) as string[])
      : this.lines;
    target.push(JSON.stringify(obj));
  }

  private common(uuid: string, timestamp: string): Record<string, unknown> {
    const base: Record<string, unknown> = {
      parentUuid: this.parentUuid,
      uuid,
      timestamp,
      sessionId: this.sessionId,
      cwd: this.cwd,
      version: this.version,
      gitBranch: this.gitBranch,
    };
    if (this.currentAgentId) {
      base.isSidechain = true;
      base.agentId = this.currentAgentId;
    } else {
      base.isSidechain = false;
    }
    this.parentUuid = uuid;
    return base;
  }

  private assistantBlock(block: Record<string, unknown>): void {
    const uuid = nextId("u");
    this.push({
      ...this.common(uuid, this.stamp()),
      type: "assistant",
      requestId: nextId("req"),
      message: {
        id: nextId("msg"),
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [block],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    });
  }

  private toolUse(name: string, input: Record<string, unknown>): string {
    const toolUseId = nextId("toolu");
    this.assistantBlock({ type: "tool_use", id: toolUseId, name, input });
    return toolUseId;
  }

  private toolResult(
    toolUseId: string,
    content: unknown,
    isError: boolean,
    toolUseResult: unknown,
  ): void {
    const uuid = nextId("u");
    this.push({
      ...this.common(uuid, this.stamp()),
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: toolUseId, is_error: isError, content },
        ],
      },
      toolUseResult,
      sourceToolAssistantUUID: nextId("src"),
    });
  }

  /** A typed user prompt. */
  user(text: string): this {
    const uuid = nextId("u");
    this.push({
      ...this.common(uuid, this.stamp()),
      type: "user",
      promptId: nextId("prompt"),
      message: { role: "user", content: text },
      origin: { kind: "human" },
      promptSource: "typed",
      userType: "external",
      entrypoint: "cli",
    });
    return this;
  }

  /** Assistant prose — the only place claims are read from. */
  say(text: string): this {
    this.assistantBlock({ type: "text", text });
    return this;
  }

  /** Private reasoning. Never counts as a claim. */
  think(text: string): this {
    this.assistantBlock({ type: "thinking", thinking: text, signature: "sig" });
    return this;
  }

  bash(command: string, opts: BashResultOptions = {}): this {
    const input: Record<string, unknown> = {
      command,
      description: opts.description ?? "run a command",
    };
    if (opts.background) input.run_in_background = true;
    const id = this.toolUse("Bash", input);

    if (opts.blocked !== undefined) {
      this.toolResult(id, `Error: ${opts.blocked}`, true, `Error: ${opts.blocked}`);
      return this;
    }

    const stdout = opts.stdout ?? "";
    const stderr = opts.stderr ?? "";
    if (opts.exitCode !== undefined && opts.exitCode !== 0) {
      const merged = `Error: Exit code ${opts.exitCode}\n${stdout}${stderr}`;
      this.toolResult(id, merged, true, merged);
    } else {
      const result: Record<string, unknown> = {
        stdout,
        stderr,
        interrupted: opts.interrupted ?? false,
        isImage: false,
        noOutputExpected: false,
      };
      if (opts.background) result.backgroundTaskId = nextId("bg");
      this.toolResult(id, stdout || "(no output)", false, result);
    }
    return this;
  }

  /** Emits only the tool_use, so a test can resolve it out of order later. */
  bashDeferred(command: string, description = "run a command"): string {
    return this.toolUse("Bash", { command, description, run_in_background: true });
  }

  /** Resolves a previously deferred command. */
  resolveBash(toolUseId: string, opts: BashResultOptions = {}): this {
    const stdout = opts.stdout ?? "";
    if (opts.exitCode !== undefined && opts.exitCode !== 0) {
      const merged = `Error: Exit code ${opts.exitCode}\n${stdout}`;
      this.toolResult(toolUseId, merged, true, merged);
    } else {
      this.toolResult(toolUseId, stdout || "(no output)", false, {
        stdout,
        stderr: opts.stderr ?? "",
        interrupted: false,
        isImage: false,
        noOutputExpected: false,
        backgroundTaskId: nextId("bg"),
      });
    }
    return this;
  }

  edit(
    filePath: string,
    oldString: string,
    newString: string,
    opts: { originalFile?: string; startLine?: number; failed?: boolean; replaceAll?: boolean } = {},
  ): this {
    const id = this.toolUse("Edit", {
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
      ...(opts.replaceAll ? { replace_all: true } : {}),
    });
    if (opts.failed) {
      this.toolResult(id, "Error: String to replace not found in file.", true, "Error: String to replace not found in file.");
      return this;
    }
    const originalFile = opts.originalFile ?? oldString;
    this.toolResult(id, `The file ${filePath} has been updated.`, false, {
      filePath,
      oldString,
      newString,
      originalFile,
      replaceAll: opts.replaceAll ?? false,
      structuredPatch: structuredPatch(oldString, newString, opts.startLine ?? 1),
      userModified: false,
    });
    return this;
  }

  write(filePath: string, content: string, opts: { update?: boolean; originalFile?: string } = {}): this {
    const id = this.toolUse("Write", { file_path: filePath, content });
    this.toolResult(id, `File created successfully at: ${filePath}`, false, {
      type: opts.update ? "update" : "create",
      filePath,
      content,
      originalFile: opts.originalFile ?? "",
      structuredPatch: structuredPatch(opts.originalFile ?? "", content, 1),
      userModified: false,
    });
    return this;
  }

  todo(oldTodos: Todo[], newTodos: Todo[]): this {
    const id = this.toolUse("TodoWrite", { todos: newTodos });
    this.toolResult(id, "Todos have been modified successfully.", false, { oldTodos, newTodos });
    return this;
  }

  /** Shorthand: one todo transitioning from in_progress to completed. */
  todoComplete(content: string): this {
    return this.todo(
      [{ content, status: "in_progress", activeForm: content }],
      [{ content, status: "completed", activeForm: content }],
    );
  }

  /** A hook that ran on its own — independent evidence a command executed. */
  hookSuccess(command: string, exitCode: number, stdout = ""): this {
    const uuid = nextId("u");
    this.push({
      ...this.common(uuid, this.stamp()),
      type: "attachment",
      attachment: {
        type: "hook_success",
        hookName: "PostToolUse",
        hookEvent: "PostToolUse",
        toolUseID: nextId("toolu"),
        content: stdout,
        stdout,
        stderr: "",
        exitCode,
        command,
        durationMs: 100,
      },
    });
    return this;
  }

  /** Records the enclosed steps into a separate subagent transcript. */
  subagent(agentId: string, fn: (b: SessionBuilder) => void): this {
    const previousAgent = this.currentAgentId;
    const previousParent = this.parentUuid;
    this.currentAgentId = agentId;
    this.parentUuid = null;
    if (!this.subagentLines.has(agentId)) this.subagentLines.set(agentId, []);
    fn(this);
    this.currentAgentId = previousAgent;
    this.parentUuid = previousParent;
    return this;
  }

  /** A line type this tool knows nothing about. Must be ignored, never fatal. */
  unknownLine(type: string): this {
    const uuid = nextId("u");
    this.push({ ...this.common(uuid, this.stamp()), type, someFutureField: {} });
    return this;
  }

  /** Writes the transcript (plus any subagent transcripts) into a temp project dir. */
  writeTo(projectDir?: string): { transcriptPath: string; projectDir: string } {
    const dir = projectDir ?? mkdtempSync(join(tmpdir(), "rh-session-"));
    mkdirSync(dir, { recursive: true });
    const transcriptPath = join(dir, `${this.sessionId}.jsonl`);
    writeFileSync(transcriptPath, this.lines.join("\n") + "\n");
    if (this.subagentLines.size > 0) {
      const subDir = join(dir, this.sessionId, "subagents");
      mkdirSync(subDir, { recursive: true });
      for (const [agentId, lines] of this.subagentLines) {
        writeFileSync(join(subDir, `agent-${agentId}.jsonl`), lines.join("\n") + "\n");
        writeFileSync(
          join(subDir, `agent-${agentId}.meta.json`),
          JSON.stringify({ agentId, agentType: "general-purpose" }),
        );
      }
    }
    return { transcriptPath, projectDir: dir };
  }
}

export function session(opts: BuilderOptions = {}): SessionBuilder {
  return new SessionBuilder(opts);
}
