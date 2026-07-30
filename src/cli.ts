#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { audit } from "./commands/audit.js";
import { demo } from "./commands/demo.js";
import { installHook, uninstallHook } from "./commands/hook.js";
import { stats } from "./commands/stats.js";
import { exitCodeFor, type FailOn } from "./report/exit-code.js";
import { renderJson } from "./report/json.js";
import { renderMarkdown } from "./report/markdown.js";
import { renderTerminal } from "./report/terminal.js";
import { resolveLocale } from "./report/messages.js";
import { allSessions, claudeHomeDir, sessionByIdOrPath, sessionsForCwd } from "./session/discover.js";
import { DETECTORS } from "./detectors/index.js";
import { renderCoverage } from "./report/coverage.js";
import type { AuditReport, SessionInfo } from "./types.js";

const VERSION = "0.1.1";

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  env?: Record<string, string | undefined>;
  /** What arrived on stdin — hooks receive their context there. */
  stdin?: string;
}

const HELP = `red-handed ${VERSION}

  Audits what your coding agent actually did against what it said it did.
  Reads Claude Code session logs and your git state. Calls no model, sends nothing anywhere.

Usage
  red-handed [options]                audit the most recent session for this directory
  red-handed demo                     see every check fire, on a made-up session
  red-handed stats [options]          add up findings across every session on this machine
  red-handed sessions [options]       list the sessions found for this directory
  red-handed install-hook             audit automatically when a session ends
  red-handed uninstall-hook           undo that

Options
  --session <id|path>   audit one specific session
  --all                 audit every session for this directory
  --git-only            audit the diff instead, for when there is no transcript
  --range <A..B>        with --git-only, audit a commit range
  --detectors <a,b>     only run these detectors
  --exclude <a,b>       run everything except these
  --fail-on <level>     caught (default) | suspicious | never
  --lang <code>         report language: en, ko
  --json                machine-readable output
  --md                  markdown, for pasting into a pull request
  --quiet               print only when something was found
  --no-color            plain text
  --since <days>        with stats, only sessions from the last N days
  --no-cache            with stats, ignore the cache in ~/.red-handed
  --cwd <path>          audit a directory other than this one
  --help, --version

Exit codes
  0 nothing found   1 findings at or above --fail-on   2 wrong usage
`;

interface ParsedArgs {
  command: string;
  session?: string;
  all: boolean;
  gitOnly: boolean;
  range?: string;
  detectors?: string[];
  exclude?: string[];
  failOn: FailOn;
  lang?: string;
  format: "terminal" | "json" | "md";
  quiet: boolean;
  color: boolean;
  sinceDays?: number;
  cwd: string;
  claudeHome?: string;
  /** Point the hook at this very build instead of npx — for before publishing. */
  localHook?: boolean;
  noCache?: boolean;
  help: boolean;
  version: boolean;
}

class UsageError extends Error {}

const COMMANDS = new Set([
  "audit",
  "demo",
  "stats",
  "sessions",
  "hook",
  "install-hook",
  "uninstall-hook",
]);

function parseArgs(argv: string[], env: Record<string, string | undefined>): ParsedArgs {
  const args: ParsedArgs = {
    command: "audit",
    all: false,
    gitOnly: false,
    failOn: "caught",
    format: "terminal",
    quiet: false,
    color: env.NO_COLOR === undefined || env.NO_COLOR === "",
    cwd: process.cwd(),
    help: false,
    version: false,
  };

  const rest = [...argv];
  if (rest.length > 0 && COMMANDS.has(rest[0] as string)) {
    args.command = rest.shift() as string;
  }

  const value = (flag: string): string => {
    const next = rest.shift();
    if (next === undefined) throw new UsageError(`${flag} needs a value`);
    return next;
  };

  while (rest.length > 0) {
    const arg = rest.shift() as string;
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--version":
      case "-V":
        args.version = true;
        break;
      case "--session":
        args.session = value(arg);
        break;
      case "--all":
        args.all = true;
        break;
      case "--git-only":
        args.gitOnly = true;
        break;
      case "--range":
        args.range = value(arg);
        break;
      case "--detectors":
        args.detectors = value(arg).split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--exclude":
      case "--exclude-detector":
        args.exclude = value(arg).split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--fail-on": {
        const level = value(arg);
        if (level !== "caught" && level !== "suspicious" && level !== "never") {
          throw new UsageError(`--fail-on must be caught, suspicious or never`);
        }
        args.failOn = level;
        break;
      }
      case "--lang":
        args.lang = value(arg);
        break;
      case "--json":
        args.format = "json";
        break;
      case "--md":
      case "--markdown":
        args.format = "md";
        break;
      case "--quiet":
      case "-q":
        args.quiet = true;
        break;
      case "--no-color":
        args.color = false;
        break;
      case "--since": {
        const days = Number(value(arg).replace(/d$/, ""));
        if (!Number.isFinite(days) || days < 0) {
          throw new UsageError(`--since needs a number of days, not "${arg}"`);
        }
        args.sinceDays = days;
        break;
      }
      case "--cwd":
        args.cwd = value(arg);
        break;
      case "--local":
        args.localHook = true;
        break;
      case "--no-cache":
        args.noCache = true;
        break;
      case "--claude-home":
        args.claudeHome = value(arg);
        break;
      default:
        throw new UsageError(`unknown option: ${arg}`);
    }
  }

  return args;
}

function systemLang(env: Record<string, string | undefined>): string | undefined {
  return env.RED_HANDED_LANG ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG;
}

/**
 * What the installed Stop hook runs, once per session as it ends.
 *
 * Claude Code hands the session's transcript path on stdin and shows the user
 * whatever `systemMessage` we print. Two rules matter more than anything here:
 * silence when there is nothing to say, and exit 0 no matter what — a watchdog
 * that blocks the session it watches would be doing the very thing it audits.
 */
async function runAsHook(io: CliIO, lang: string | undefined): Promise<number> {
  try {
    const input: unknown = JSON.parse(io.stdin ?? "");
    const transcriptPath =
      input !== null &&
      typeof input === "object" &&
      typeof (input as { transcript_path?: unknown }).transcript_path === "string"
        ? (input as { transcript_path: string }).transcript_path
        : null;
    if (transcriptPath === null) return 0;

    const one = await sessionByIdOrPath(transcriptPath, {});
    if (!one) return 0;
    const report = await audit({ cwd: one.cwd || process.cwd(), sessions: [one], gitOnly: false });
    const caught = report.findings.filter((f) => f.tier === "CAUGHT").length;
    if (caught === 0) return 0;

    const locale = resolveLocale(lang);
    const message =
      locale.id === "ko"
        ? `red-handed: 이번 세션에서 검거 ${caught}건 — \`npx @jinhyuk9714/red-handed@latest\`로 확인하세요`
        : `red-handed: ${caught} finding(s) caught this session — run \`npx @jinhyuk9714/red-handed@latest\` to see them`;
    io.out(`${JSON.stringify({ systemMessage: message })}\n`);
    return 0;
  } catch {
    return 0;
  }
}

function renderReport(report: AuditReport, args: ParsedArgs, lang: string | undefined): string {
  if (args.format === "json") return renderJson(report);
  if (args.format === "md") return renderMarkdown(report, { lang });
  return renderTerminal(report, { color: args.color, lang });
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  const env = io.env ?? process.env;
  let args: ParsedArgs;
  try {
    args = parseArgs(argv, env);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    io.err(`Run red-handed --help\n`);
    return 2;
  }

  if (args.help) {
    io.out(HELP);
    return 0;
  }

  const known = new Set(DETECTORS.map((d) => d.id));
  for (const id of [...(args.detectors ?? []), ...(args.exclude ?? [])]) {
    if (known.has(id)) continue;
    io.err(`unknown detector: ${id}\nAvailable: ${[...known].join(", ")}\n`);
    return 2;
  }
  if (args.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }

  const lang = args.lang ?? systemLang(env);
  const discover = args.claudeHome ? { claudeHome: args.claudeHome } : {};

  if (args.command === "hook") {
    return runAsHook(io, lang);
  }

  if (args.command === "install-hook" || args.command === "uninstall-hook") {
    const home = claudeHomeDir({ claudeHome: args.claudeHome, env });
    const localCommand = args.localHook
      ? `node ${realpathSync(fileURLToPath(import.meta.url))} hook`
      : undefined;
    try {
      const result =
        args.command === "install-hook"
          ? installHook(home, { command: localCommand })
          : uninstallHook(home);
      io.out(`${result.message}: ${result.path}\n`);
      return 0;
    } catch (error) {
      io.err(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }

  if (args.command === "demo") {
    const report = await demo(lang);
    if (args.format === "terminal") {
      io.out(`\n  ${resolveLocale(lang).ui.demoNote}\n`);
    }
    io.out(renderReport(report, args, lang));
    return exitCodeFor(report.findings, args.failOn);
  }

  if (args.command === "sessions") {
    const found = args.all ? allSessions(discover) : sessionsForCwd(args.cwd, discover);
    if (found.length === 0) {
      io.err(`no session found for ${args.cwd}\n`);
      return 0;
    }
    for (const session of found) {
      const when = new Date(session.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
      const size = `${Math.round(session.sizeBytes / 1024)}KB`;
      io.out(`${session.sessionId.slice(0, 8)}  ${when}  ${size.padStart(8)}  ${session.cwd}\n`);
    }
    return 0;
  }

  if (args.command === "stats") {
    const result = await stats({
      ...discover,
      env,
      useCache: !args.noCache,
      sinceMs:
        args.sinceDays === undefined ? undefined : Date.now() - args.sinceDays * 86_400_000,
    });
    const report: AuditReport = {
      repoRoot: null,
      branch: null,
      mode: "session",
      findings: result.findings,
      detectorCount: DETECTORS.length,
      sessionsScanned: result.sessionsScanned,
    };
    if (args.format === "json") {
      io.out(
        `${JSON.stringify(
          {
            version: 1,
            sessionsScanned: result.sessionsScanned,
            sessionsWithFindings: result.sessionsWithFindings,
            summary: { caught: result.caught, suspicious: result.suspicious },
            coverage: result.coverage,
            byDetector: result.byDetector,
            projects: result.projects,
            findings: result.findings,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      io.out(renderCoverage(result.coverage, result.sessionsScanned, lang, args.color));
      io.out(renderTerminal(report, { color: args.color, lang }));
      if (result.projects.length > 0) {
        io.out(`  ${result.sessionsWithFindings}/${result.sessionsScanned} sessions had something\n`);
        for (const project of result.projects.slice(0, 10)) {
          const name = project.project.split("/").filter(Boolean).pop() ?? project.project;
          io.out(`    ${name.padEnd(28)} caught ${project.caught}  suspicious ${project.suspicious}\n`);
        }
        io.out("\n");
      }
    }
    return exitCodeFor(result.findings, args.failOn);
  }

  let sessions: SessionInfo[] = [];
  if (!args.gitOnly) {
    if (args.session) {
      const one = await sessionByIdOrPath(args.session, discover);
      if (!one) {
        io.err(`no session matching ${args.session}\n`);
        return 2;
      }
      sessions = [one];
    } else {
      const found = sessionsForCwd(args.cwd, discover);
      sessions = args.all ? found : found.slice(0, 1);
      if (found.length === 0) {
        io.err(
          `no session log found for ${args.cwd}\nIf this project was written by another agent, try: red-handed --git-only\n`,
        );
        return 0;
      }
    }
  }

  const report = await audit({
    cwd: args.cwd,
    sessions,
    gitOnly: args.gitOnly,
    range: args.range,
    detectors: args.detectors,
    exclude: args.exclude,
  });

  const code = exitCodeFor(report.findings, args.failOn);
  if (args.quiet && code === 0 && args.format !== "json") return code;
  io.out(renderReport(report, args, lang));
  return code;
}

/**
 * Whether this file is the program being run.
 *
 * The comparison has to go through realpath: npm installs a bin as a symlink,
 * so argv[1] is node_modules/.bin/red-handed while this module is the file it
 * points at. Comparing them as written makes the command exit silently.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

if (isEntryPoint()) {
  const wantsStdin = process.argv[2] === "hook";
  void (wantsStdin ? readStdin() : Promise.resolve(""))
    .then((stdin) =>
      main(process.argv.slice(2), {
        out: (text) => process.stdout.write(text),
        err: (text) => process.stderr.write(text),
        stdin,
      }),
    )
    .then((code) => {
      process.exitCode = code;
    });
}
