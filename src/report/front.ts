import pc from "picocolors";
import type { StatsResult } from "../commands/stats.js";
import { resolveLocale } from "./messages.js";

/**
 * The screen a bare `red-handed` prints.
 *
 * One idea, in the words a person would use: your agent said the tests pass
 * this many times, and this many times nothing had run. Every number is
 * followed by the command that acts on it, because a screen that only shows
 * the problem leaves the reader with homework.
 *
 * It must fit in about twelve lines. The README GIF records exactly this
 * output, in a font large enough to read in a feed.
 */
export function renderFront(result: StatsResult, lang: string | undefined, color = true): string {
  const korean = resolveLocale(lang).id === "ko";
  const bold = (t: string): string => (color ? pc.bold(t) : t);
  const dim = (t: string): string => (color ? pc.dim(t) : t);
  const warn = (t: string): string => (color ? pc.yellow(t) : t);

  const out: string[] = [""];
  const c = result.coverage;

  if (result.sessionsScanned === 0) {
    out.push(
      korean
        ? "  이 컴퓨터에서 Claude Code 세션을 찾지 못했습니다."
        : "  No Claude Code sessions found on this machine.",
    );
    out.push(
      dim(
        korean
          ? "  세션이 몇 개 쌓인 뒤에 다시 돌려보세요."
          : "  Come back after a few sessions exist.",
      ),
    );
    out.push("");
    return out.join("\n");
  }

  out.push(
    korean
      ? `  이 컴퓨터의 세션 ${result.sessionsScanned}개를 읽었습니다.`
      : `  Read ${result.sessionsScanned} sessions on this machine.`,
  );
  out.push("");

  if (c.claims === 0) {
    out.push(
      korean
        ? '  에이전트가 "테스트 통과"라고 말한 적이 아직 없습니다.'
        : `  Your agent has not said "tests pass" yet.`,
    );
    out.push("");
    return out.join("\n");
  }

  out.push(
    korean
      ? `  에이전트가 "테스트 통과"라고 ${bold(String(c.claims))}번 말했습니다.`
      : `  Your agent said "tests pass" ${bold(String(c.claims))} times.`,
  );

  const rows: Array<[number, string, boolean]> = [
    [c.verifiedByARun, korean ? "진짜로 테스트가 돌았음" : "a test had actually run", false],
    // Not "nothing ran": on this corpus every one of these turned out to be a
    // run whose result nothing could read. The claim is unbacked either way,
    // but the smaller statement is the true one.
    [c.noRunInSession, korean ? "읽을 수 있는 실행이 없었음" : "no run it could read", true],
    [c.lastRunHadFailed, korean ? "직전 실행은 실패였음" : "the run before it had failed", true],
  ];
  const width = Math.max(...rows.map(([n]) => String(n).length));
  for (const [count, label, notable] of rows) {
    if (count === 0) continue;
    const number = String(count).padStart(width + 4);
    out.push(`${notable ? warn(bold(number)) : number}  ${notable ? label : dim(label)}`);
  }

  const unbacked = c.noRunInSession + c.lastRunHadFailed;
  out.push("");
  if (unbacked > 0) {
    out.push(
      korean
        ? `  그 ${unbacked}번이 언제 어디서였는지 보려면`
        : unbacked === 1
          ? "  to see that claim, quoted, with the time"
          : `  to see those ${unbacked}, quoted, with the time`,
    );
    out.push(`      ${bold("red-handed stats")}`);
  }
  out.push(korean ? "  다음 것을 자동으로 잡으려면" : "  to catch the next one automatically");
  out.push(`      ${bold("red-handed install-hook")}`);
  out.push("");
  return out.join("\n");
}
