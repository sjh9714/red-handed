import { sanitizeForClassification, segments } from "./shell.js";
import type { CommandAction, TestFailureDetail, TestFramework, TestRunEvidence } from "../types.js";

export interface TestCommandInfo {
  framework: TestFramework;
  scope: "full" | "filtered";
}

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/** Tokens that stand in front of the real command without changing what it is. */
const WRAPPERS = new Set([
  "npx",
  "uv",
  "uvx",
  "poetry",
  "pipenv",
  "python",
  "python3",
  "py",
  "-m",
  "run",
  "exec",
  "env",
  "time",
  "nice",
  "cross-env",
  "dotenv",
  "--",
]);

const RUNNERS: Record<string, TestFramework> = {
  vitest: "vitest",
  jest: "jest",
  mocha: "mocha",
  pytest: "pytest",
  "py.test": "pytest",
  unittest: "generic",
  tap: "generic",
  ava: "generic",
  rspec: "generic",
  phpunit: "generic",
  behave: "generic",
  ctest: "generic",
  busted: "generic",
  tox: "generic",
  nox: "generic",
};

/** Build tools where a specific subcommand is the test run. */
const SUBCOMMAND_RUNNERS: Record<string, string[]> = {
  make: ["test", "tests", "check", "ci"],
  go: ["test"],
  cargo: ["test", "nextest"],
  deno: ["test"],
  dotnet: ["test"],
  mvn: ["test", "verify"],
  mvnw: ["test", "verify"],
  gradle: ["test", "check"],
  gradlew: ["test", "check"],
  swift: ["test"],
  rake: ["test", "spec"],
  composer: ["test"],
  mix: ["test"],
};

/** Launchers that run another command with the project's dependencies loaded. */
const EXEC_LAUNCHERS = new Set(["bundle", "poetry", "pipenv", "pdm", "rye", "hatch"]);

/**
 * Project-specific test scripts. Real sessions run these constantly, and not
 * recognising them makes the tool claim tests never ran when they plainly did.
 */
function looksLikeTestScript(token: string): boolean {
  const name = token.replace(/^.*\//, "");
  if (/^test_[\w.-]*\.py$/.test(name)) return true;
  if (/^[\w.-]*tests?[\w.-]*\.(?:sh|bash|zsh)$/.test(name)) return true;
  if (/^(?:run-)?tests?\.(?:py|js|[cm]?ts)$/.test(name)) return true;
  return false;
}

const FILTER_FLAGS = new Set([
  "-t",
  "--testNamePattern",
  "--test-name-pattern",
  "-k",
  "--grep",
  "-g",
  "--testPathPattern",
  "--testPathPatterns",
  "--exclude",
  "--project",
  "--changed",
  "--onlyFailures",
  "--lf",
  "--last-failed",
  "--ff",
  "--failed-first",
]);

/** Subcommands and flags that do not narrow which tests run. */
const NEUTRAL_ARGS = new Set([
  "run",
  "watch",
  "--run",
  "--coverage",
  "--reporter",
  "--silent",
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "--no-color",
  "--color",
  "--ci",
  "--bail",
  "--passWithNoTests",
  "--no-watch",
  "--watchAll=false",
  "--",
  "./...",
  "discover",
]);

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

/** Flags that make the runner report on itself instead of running anything. */
const NON_RUNNING_FLAGS = new Set([
  "--version",
  "-V",
  "--help",
  "-h",
  "--collect-only",
  "--co",
  "--listTests",
  "--list-tests",
  "--fixtures",
  "--markers",
  "--showConfig",
  "--show-config",
  "init",
]);

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}


function isRedirection(token: string): boolean {
  return /^\d*[<>]/.test(token) || token === "&>";
}

function tokenize(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .filter((t) => t !== "" && !isRedirection(t));
}


function looksLikeTestPath(token: string): boolean {
  if (token.startsWith("-")) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(token)) return true;
  if (/^test_.*\.py$/.test(token) || /_test\.py$/.test(token)) return true;
  if (/\.[cm]?[jt]sx?$/.test(token) || /\.py$/.test(token)) return true;
  return token.includes("/") && !token.startsWith("--");
}

function hasFilterArgs(args: string[]): boolean {
  for (const arg of args) {
    if (NEUTRAL_ARGS.has(arg)) continue;
    const flagName = arg.split("=")[0] as string;
    if (FILTER_FLAGS.has(flagName)) return true;
    if (arg.startsWith("-")) continue;
    if (looksLikeTestPath(arg)) return true;
  }
  return false;
}

interface SegmentMatch {
  framework: TestFramework;
  filtered: boolean;
}

function matchSegment(
  segment: string,
  scripts: Record<string, string>,
  depth: number,
): SegmentMatch | null {
  const tokens = tokenize(segment);
  if (tokens.length === 0) return null;

  let index = 0;
  while (index < tokens.length && isEnvAssignment(tokens[index] as string)) index += 1;
  const head = tokens[index];
  if (head === undefined) return null;

  if (SHELLS.has(head) && depth < 3) {
    const rest = tokens.slice(index + 1);
    const flag = rest.indexOf("-c");
    if (flag !== -1) {
      const inner = rest
        .slice(flag + 1)
        .join(" ")
        .replace(/^(['"])([\s\S]*)\1$/, "$2");
      return matchCommand(inner, scripts, depth + 1);
    }
    // `bash scripts/test.sh` — the shell is just a launcher.
    return matchSegment(rest.join(" "), scripts, depth + 1);
  }

  // `./gradlew test`, `./mvnw verify`: the launcher lives in the repository.
  const headBare = head.replace(/^.*\//, "");

  if (EXEC_LAUNCHERS.has(headBare) && depth < 3) {
    const rest = tokens.slice(index + 1);
    if (rest[0] !== "exec" && rest[0] !== "run") return null;
    return matchSegment(rest.slice(1).join(" "), scripts, depth + 1);
  }

  const subcommands = SUBCOMMAND_RUNNERS[headBare];
  if (subcommands) {
    const sub = tokens[index + 1];
    if (sub === undefined || !subcommands.includes(sub)) return null;
    return { framework: "generic", filtered: hasFilterArgs(tokens.slice(index + 2)) };
  }

  if (PACKAGE_MANAGERS.has(head)) {
    let rest = tokens.slice(index + 1);
    if (rest[0] === "exec" || rest[0] === "x" || rest[0] === "dlx") {
      return matchSegment(rest.slice(1).join(" "), scripts, depth);
    }
    if (rest[0] === "run" || rest[0] === "run-script") rest = rest.slice(1);
    const scriptName = rest[0];
    if (scriptName === undefined) return null;
    const scriptArgs = rest.slice(1);
    const isTestScript = scriptName === "test" || scriptName.startsWith("test:");
    const body = scripts[scriptName];
    const resolved =
      depth < 2 && body !== undefined ? matchCommand(body, scripts, depth + 1) : null;
    if (resolved) {
      return { framework: resolved.framework, filtered: resolved.filtered || hasFilterArgs(scriptArgs) };
    }
    if (isTestScript) return { framework: "generic", filtered: hasFilterArgs(scriptArgs) };
    return null;
  }

  if (head === "node" && tokens.slice(index).includes("--test")) {
    return { framework: "generic", filtered: hasFilterArgs(tokens.slice(index + 1).filter((t) => t !== "--test")) };
  }

  while (index < tokens.length && WRAPPERS.has(tokens[index] as string)) index += 1;
  const runnerToken = tokens[index];
  if (runnerToken === undefined) return null;
  const bare = runnerToken.replace(/^.*\//, "");
  const args = tokens.slice(index + 1);
  if (args.some((arg) => NON_RUNNING_FLAGS.has(arg.split("=")[0] as string))) return null;
  const framework = RUNNERS[bare];
  if (framework) return { framework, filtered: hasFilterArgs(args) };
  if (looksLikeTestScript(runnerToken)) return { framework: "generic", filtered: false };
  return null;
}

function matchCommand(
  command: string,
  scripts: Record<string, string>,
  depth: number,
): SegmentMatch | null {
  let best: SegmentMatch | null = null;
  for (const segment of segments(sanitizeForClassification(command))) {
    const match = matchSegment(segment, scripts, depth);
    if (!match) continue;
    // A specific runner beats a bare `npm test`.
    if (!best || (best.framework === "generic" && match.framework !== "generic")) best = match;
    if (match.filtered && best) best.filtered = true;
  }
  return best;
}

/**
 * Decides whether a shell command runs tests, and whether it runs all of them.
 * A filtered run cannot support a claim that the whole suite passes.
 */
export function classifyTestCommand(
  command: string,
  packageScripts: Record<string, string> = {},
): TestCommandInfo | null {
  const match = matchCommand(command, packageScripts, 0);
  if (!match) return null;
  return { framework: match.framework, scope: match.filtered ? "filtered" : "full" };
}

interface ParsedOutput {
  status: TestRunEvidence["status"];
  passed?: number;
  failed?: number;
  skipped?: number;
  failures: TestFailureDetail[];
  summaryLine?: string;
}

function counts(text: string): { passed?: number; failed?: number; skipped?: number } {
  const read = (label: string): number | undefined => {
    const match = new RegExp(`(\\d+)\\s+${label}`).exec(text);
    return match ? Number(match[1]) : undefined;
  };
  return {
    passed: read("passed") ?? read("passing"),
    failed: read("failed") ?? read("failing") ?? read("errors?"),
    skipped: read("skipped") ?? read("pending") ?? read("todo"),
  };
}

function statusFromCounts(c: { passed?: number; failed?: number }): TestRunEvidence["status"] | null {
  if (c.failed !== undefined && c.failed > 0) return "failed";
  if (c.passed !== undefined && c.passed > 0) return "passed";
  if (c.failed === 0 && c.passed === 0) return "unknown";
  return null;
}

function parseVitest(output: string): ParsedOutput | null {
  const testsLine = /^[ \t]*Tests[ \t]+(.+)$/m.exec(output);
  const filesLine = /^[ \t]*Test Files[ \t]+(.+)$/m.exec(output);
  const line = testsLine ?? filesLine;
  if (!line) return null;
  const c = counts(line[1] as string);
  const status = statusFromCounts(c);
  if (!status) return null;
  return { status, ...c, failures: [], summaryLine: line[0].trim() };
}

function parseJest(output: string): ParsedOutput | null {
  const line = /^[ \t]*Tests:[ \t]+(.+)$/m.exec(output);
  if (!line) return null;
  const c = counts(line[1] as string);
  const status = statusFromCounts(c);
  if (!status) return null;
  return { status, ...c, failures: [], summaryLine: line[0].trim() };
}

function parseMocha(output: string): ParsedOutput | null {
  const passing = /^[ \t]*(\d+) passing/m.exec(output);
  const failing = /^[ \t]*(\d+) failing/m.exec(output);
  if (!passing && !failing) return null;
  const passed = passing ? Number(passing[1]) : undefined;
  const failed = failing ? Number(failing[1]) : 0;
  const status = failed > 0 ? "failed" : passed !== undefined && passed > 0 ? "passed" : "unknown";
  const summaryLine = [passing?.[0].trim(), failing?.[0].trim()].filter(Boolean).join(", ");
  return { status, passed, failed, failures: [], summaryLine };
}

function parsePytest(output: string): ParsedOutput | null {
  if (/no tests ran/i.test(output)) {
    return { status: "unknown", failures: [] };
  }
  const line =
    /^[=\s]*((?:\d+\s+(?:failed|passed|skipped|error|errors|xfailed|xpassed|deselected|warning|warnings)(?:,\s*)?)+)\s*in\s+[\d.]+s.*$/m.exec(
      output,
    );
  if (!line) return null;
  const c = counts(line[1] as string);
  const status = statusFromCounts(c);
  if (!status) return null;
  return { status, ...c, failures: [], summaryLine: line[0].replace(/=+/g, "").trim() };
}

function clean(value: string): string {
  return value
    .trim()
    .replace(/\s*\/\/.*$/, "")
    .replace(/[,;]$/, "")
    .trim();
}

/** Pulls out what the test wanted and what the code actually produced. */
function parseFailures(output: string): TestFailureDetail[] {
  const failures: TestFailureDetail[] = [];

  const expectedReceived = /^[ \t]*Expected:[ \t]*(.*)\n(?:.*\n)??[ \t]*Received:[ \t]*(.*)$/gm;
  for (const match of output.matchAll(expectedReceived)) {
    failures.push({
      expected: clean(match[1] as string),
      received: clean(match[2] as string),
      raw: match[0].trim(),
    });
  }

  const inline = /expected\s+(.+?)\s+to\s+(?:be|equal|deeply equal|strictly equal)\s+(.+?)$/gm;
  for (const match of output.matchAll(inline)) {
    failures.push({
      received: clean(match[1] as string),
      expected: clean(match[2] as string),
      raw: match[0].trim(),
    });
  }

  const pythonAssert = /^E\s+(?:assert|AssertionError:\s*assert)\s+(.+?)\s*(?:==|!=)\s*(.+)$/gm;
  for (const match of output.matchAll(pythonAssert)) {
    failures.push({
      received: clean(match[1] as string),
      expected: clean(match[2] as string),
      raw: match[0].trim(),
    });
  }

  const seen = new Set<string>();
  return failures.filter((f) => {
    const key = `${f.expected ?? ""}|${f.received ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PARSERS: Record<string, (output: string) => ParsedOutput | null> = {
  vitest: parseVitest,
  jest: parseJest,
  mocha: parseMocha,
  pytest: parsePytest,
};

/**
 * Reads pass/fail out of runner output. Output is the primary signal because
 * agents pipe their test commands, which hides the exit code.
 */
export function parseTestOutput(output: string, framework: TestFramework): ParsedOutput {
  const order = [framework, "vitest", "jest", "mocha", "pytest"].filter(
    (f, i, arr) => f !== "generic" && arr.indexOf(f) === i,
  );
  for (const candidate of order) {
    const parser = PARSERS[candidate];
    if (!parser) continue;
    const parsed = parser(output);
    if (parsed && parsed.status !== "unknown") {
      return { ...parsed, failures: parseFailures(output) };
    }
    if (parsed) return { ...parsed, failures: [] };
  }
  return { status: "unknown", failures: [] };
}

/**
 * The exit code only means something when the shell line is a single plain
 * command: a pipe reports the last stage's status, and an && chain may have
 * failed before the tests ever ran.
 */
function exitCodeIsTrustworthy(command: string): boolean {
  const stripped = sanitizeForClassification(command).replace(/\d*[<>]&?\d*/g, " ");
  return !/[|;\n]|&&/.test(stripped);
}

/** Attaches test evidence to a command, or returns undefined if it is not a test run. */
export function detectTestRun(
  action: CommandAction,
  packageScripts: Record<string, string> = {},
): TestRunEvidence | undefined {
  const info = classifyTestCommand(action.command, packageScripts);
  if (!info) return undefined;

  const output = [action.stdout, action.stderr].filter((s) => s !== "").join("\n");
  const parsed = parseTestOutput(output, info.framework);
  if (parsed.status !== "unknown") {
    return {
      framework: info.framework,
      status: parsed.status,
      passed: parsed.passed,
      failed: parsed.failed,
      skipped: parsed.skipped,
      failures: parsed.failures,
      summaryLine: parsed.summaryLine,
      scope: info.scope,
    };
  }

  // A backgrounded command started a run; it did not report one. Scoring its
  // empty output as a pass would invent a verification that never happened.
  if (action.background) return undefined;

  let status: TestRunEvidence["status"] = "unknown";
  if (
    !action.interrupted &&
    action.exitCode !== null &&
    exitCodeIsTrustworthy(action.command)
  ) {
    status = action.exitCode === 0 ? "passed" : "failed";
  }

  return {
    framework: info.framework,
    status,
    failures: parsed.failures,
    scope: info.scope,
  };
}
