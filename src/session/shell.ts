/**
 * Shell-line reading, shared by anything that has to tell what a command did
 * from its text alone.
 */

/**
 * Drops heredoc bodies.
 *
 * Agents write documentation and scripts through heredocs, and that prose
 * contains runnable-looking command examples. Writing a command down is not
 * running it: a real session showed `pnpm test  # 350 passed` inside a markdown
 * file being counted as a test run.
 */
export function stripHeredocBodies(command: string): string {
  if (!command.includes("<<")) return command;
  const lines = command.split("\n");
  const kept: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    kept.push(line);
    index += 1;
    const opener = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (!opener) continue;
    const delimiter = opener[2] as string;
    while (index < lines.length) {
      const body = (lines[index] as string).trim().replace(/[)"';]+$/, "");
      index += 1;
      if (body === delimiter) break;
    }
  }
  return kept.join("\n");
}

/**
 * Replaces quoted spans with a space.
 *
 * With `multilineOnly`, only spans that run across lines are dropped — those are
 * always data (a commit message, a pull request body), never something the shell
 * will run, while a single-line `bash -c "npm test"` still needs reading.
 */
export function stripQuotes(command: string, options: { multilineOnly: boolean }): string {
  if (options.multilineOnly && !command.includes("\n")) return command;
  let out = "";
  let index = 0;
  while (index < command.length) {
    const char = command[index] as string;
    if (char !== "'" && char !== '"') {
      out += char;
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < command.length) {
      const inner = command[end] as string;
      if (inner === "\\" && char === '"') {
        end += 2;
        continue;
      }
      if (inner === char) break;
      end += 1;
    }
    if (end >= command.length) {
      // Unbalanced quote: leave the rest untouched rather than guess.
      out += command.slice(index);
      break;
    }
    const span = command.slice(index, end + 1);
    out += !options.multilineOnly || span.includes("\n") ? " " : span;
    index = end + 1;
  }
  return out;
}

/** For deciding what a command ran. Keeps single-line quoted commands readable. */
export function sanitizeForClassification(command: string): string {
  return stripQuotes(stripHeredocBodies(command), { multilineOnly: true });
}

/**
 * For deciding which flags a command carried. Quoted text is never a flag, so
 * `git commit -m "never use --no-verify"` must not read as bypassing hooks.
 */
export function sanitizeForFlags(command: string): string {
  return stripQuotes(stripHeredocBodies(command), { multilineOnly: false });
}

/** Splits a shell line into the individual commands it runs. */
export function segments(command: string): string[] {
  return command
    .split(/\|\||&&|;|\n|\||&(?!>)/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
