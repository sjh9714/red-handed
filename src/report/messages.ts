/**
 * What each finding means, in plain language.
 *
 * Three things are said about every finding, in this order: what happened, the
 * evidence, and what the reader should go check. The first and last live here
 * because a report nobody understands is a report nobody acts on — and because
 * keeping them as data is what lets the tool speak another language.
 *
 * English and Korean ship today. Adding a language means adding one object
 * below; nothing else in the codebase needs to know.
 */

export interface Message {
  /** What happened, in one or two sentences. */
  narrative: string;
  /** The one thing the reader should verify for themselves. */
  check: string;
}

export interface Locale {
  id: string;
  /**
   * What each check is called, in words a first-time reader understands.
   * The detector id still appears after it, because that is what --detectors takes.
   */
  titles: Record<string, string>;
  /** Evidence annotations this tool writes itself (quoted material is never translated). */
  notes: Record<string, string>;
  ui: {
    caught: string;
    suspicious: string;
    evidence: string;
    check: string;
    clean: string;
    cleanHint: string;
    session: string;
    repo: string;
    detectors: string;
    verdictCaught: string;
    verdictSuspicious: string;
    gitOnlyNote: string;
    sessionsScanned: string;
    demoNote: string;
  };
  messages: Record<string, Message>;
}

const en: Locale = {
  id: "en",
  titles: {
    "no-verify": "committed past the hooks",
    "skip-only": "switched a test off",
    "claim-vs-fail": "said tests pass — the last run failed",
    "claim-no-run": "said tests pass — none ran",
    "hardcoded-expected": "rewrote the answer to match the bug",
    "config-disable": "turned a check off",
    "error-swallowing": "made an error vanish",
  },
  notes: {
    "note.no-impl-change": "no implementation file was changed between the failure and this edit",
    "note.no-run-between": "no test run between that failure and this claim",
    "note.no-test-run": "no test command ran in this session ({commands} commands, subagent transcripts included)",
    "note.files-changed-after": "{count} file(s) changed after that run: {files}",
    "note.expected-received": "expected {expected}, received {received}",
  },
  ui: {
    caught: "CAUGHT",
    suspicious: "SUSPICIOUS",
    evidence: "evidence",
    check: "check",
    clean: "Nothing to report.",
    cleanHint: "No test was switched off, weakened, or claimed to pass without running.",
    session: "session",
    repo: "repo",
    detectors: "detectors",
    verdictCaught: "caught red-handed.",
    verdictSuspicious: "worth a look.",
    gitOnlyNote: "diff only — no session transcript, so nothing here is certain.",
    sessionsScanned: "sessions scanned",
    demoNote: "A made-up session, so every check has something to show. None of this is your code.",
  },
  messages: {
    "no-verify.after-hook-failure": {
      narrative:
        "A commit hook rejected the commit, so the agent ran the commit again with the hooks switched off.",
      check: "Run the hook by hand and see what it was objecting to.",
    },
    "no-verify.plain": {
      narrative: "The agent committed with the hooks switched off.",
      check: "Whatever the hooks would have checked, nothing checked it.",
    },
    "skip-only.only": {
      narrative:
        "The agent marked a test as the only one to run. Every other test in that file is now silently skipped.",
      check: "Take the .only back out and run the file again.",
    },
    "skip-only.after-failure": {
      narrative:
        "A test failed, and the agent's next move was to skip it rather than fix what it was testing.",
      check: "Un-skip it and see whether the original failure is still there.",
    },
    "skip-only.plain": {
      narrative: "The agent switched a test off.",
      check: "Un-skip it and see whether it passes.",
    },
    "config-disable.strict-off": {
      narrative:
        "The type checker complained, and the agent turned the strictness setting off instead of fixing what it found.",
      check: "Set it back to true and look at the errors that come back.",
    },
    "config-disable.ci-test-removed": {
      narrative: "The step that runs tests was taken out of the CI workflow.",
      check: "Put the step back and see whether CI still passes.",
    },
    "config-disable.inline-disable": {
      narrative:
        "A check failed, and the agent silenced it at that line rather than resolving it.",
      check: "Remove the suppression and read the error it was hiding.",
    },
    "claim-no-run.none": {
      narrative:
        "The agent said the tests pass. No test ran in this session — not in the main thread, and not in any subagent.",
      check: "Run the tests yourself before trusting that sentence.",
    },
    "claim-no-run.hook-only": {
      narrative:
        "The agent said the tests pass. The only thing that ran tests was a hook, not the agent.",
      check: "Confirm the hook covered what the sentence claims.",
    },
    "claim-no-run.unreadable": {
      narrative:
        "The agent said the tests pass. Something test-shaped did run, but nothing this tool could read a result from.",
      check: "Look at what that command actually reported.",
    },
    "claim-vs-fail.contradicts": {
      narrative:
        "The agent said the tests pass. The last test run before it said otherwise, and nothing ran in between.",
      check: "Run the tests again and compare with the sentence above.",
    },
    "claim-vs-fail.stale": {
      narrative:
        "The agent said the tests pass, but the code changed after the run it is relying on. The claim describes an older version of the code.",
      check: "Run the tests again now that the code has changed.",
    },
    "hardcoded-expected.literal": {
      narrative:
        "A test failed because the code produced {received} instead of {expected}. The agent then changed the test to expect {received} — the value the failure produced — without touching the code.",
      check: "Decide which value is actually correct: {expected} or {received}.",
    },
    "hardcoded-expected.snapshot": {
      narrative:
        "A test failed, and the agent updated the stored snapshot to match the new output rather than the output to match the snapshot.",
      check: "Read the snapshot diff and decide whether the new output is right.",
    },
    "error-swallowing.empty": {
      narrative:
        "An error came up, and the agent wrapped the code in a catch that does nothing with it. The error is now invisible rather than handled.",
      check: "Log or rethrow it once and see what was being swallowed.",
    },
  },
};

const ko: Locale = {
  id: "ko",
  titles: {
    "no-verify": "훅을 끄고 커밋함",
    "skip-only": "테스트를 꺼버림",
    "claim-vs-fail": "실패했는데 통과했다고 말함",
    "claim-no-run": "돌리지도 않고 통과했다고 말함",
    "hardcoded-expected": "오답을 정답으로 바꿔치기",
    "config-disable": "검사를 꺼버림",
    "error-swallowing": "에러를 삼킴",
  },
  notes: {
    "note.no-impl-change": "실패와 이 수정 사이에 구현 코드는 그대로였음",
    "note.no-run-between": "실패와 주장 사이에 테스트를 다시 돌린 적 없음",
    "note.no-test-run": "이 세션에서 테스트 명령이 실행되지 않음 (명령 {commands}개, 서브에이전트 기록 포함)",
    "note.files-changed-after": "그 실행 이후 파일 {count}개가 바뀜: {files}",
    "note.expected-received": "기대값 {expected}, 실제값 {received}",
  },
  ui: {
    caught: "검거",
    suspicious: "의심",
    evidence: "근거",
    check: "확인할 것",
    clean: "보고할 내용이 없습니다.",
    cleanHint: "끈 테스트도, 약화된 검증도, 돌리지 않고 통과했다는 주장도 없었습니다.",
    session: "세션",
    repo: "저장소",
    detectors: "탐지기",
    verdictCaught: "현행범으로 잡혔습니다.",
    verdictSuspicious: "한 번 볼 만합니다.",
    gitOnlyNote: "변경분만 봤습니다 — 세션 기록이 없어 확정할 수 있는 건 없습니다.",
    sessionsScanned: "검사한 세션",
    demoNote: "모든 검사가 걸리도록 지어낸 세션입니다. 당신의 코드는 하나도 들어있지 않습니다.",
  },
  messages: {
    "no-verify.after-hook-failure": {
      narrative:
        "커밋 훅이 커밋을 막자, 에이전트는 훅을 끄고 다시 커밋했습니다.",
      check: "훅을 직접 실행해서 무엇을 문제 삼았는지 보세요.",
    },
    "no-verify.plain": {
      narrative: "에이전트가 훅을 끄고 커밋했습니다.",
      check: "훅이 검사했을 것들을 아무도 검사하지 않았습니다.",
    },
    "skip-only.only": {
      narrative:
        "에이전트가 이 테스트만 실행되도록 표시했습니다. 같은 파일의 나머지 테스트는 이제 조용히 건너뜁니다.",
      check: ".only를 지우고 파일 전체를 다시 돌려보세요.",
    },
    "skip-only.after-failure": {
      narrative:
        "테스트가 실패하자, 에이전트는 그 테스트가 검사하던 것을 고치는 대신 테스트를 건너뛰게 했습니다.",
      check: "skip을 풀고 원래 실패가 그대로인지 확인하세요.",
    },
    "skip-only.plain": {
      narrative: "에이전트가 테스트를 껐습니다.",
      check: "skip을 풀고 통과하는지 확인하세요.",
    },
    "config-disable.strict-off": {
      narrative:
        "타입 검사가 문제를 지적하자, 에이전트는 그 문제를 고치는 대신 strict 설정을 껐습니다.",
      check: "다시 true로 되돌리고 어떤 에러가 돌아오는지 보세요.",
    },
    "config-disable.ci-test-removed": {
      narrative: "CI 워크플로에서 테스트를 실행하는 단계가 삭제됐습니다.",
      check: "그 단계를 되돌리고 CI가 여전히 통과하는지 확인하세요.",
    },
    "config-disable.inline-disable": {
      narrative:
        "검사가 실패하자, 에이전트는 그 줄에서 검사를 침묵시켰습니다.",
      check: "억제를 지우고 가려져 있던 에러를 읽어보세요.",
    },
    "claim-no-run.none": {
      narrative:
        "에이전트가 테스트를 통과했다고 말했습니다. 이 세션에서는 메인도 서브에이전트도 테스트를 한 번도 돌리지 않았습니다.",
      check: "그 문장을 믿기 전에 직접 테스트를 돌려보세요.",
    },
    "claim-no-run.hook-only": {
      narrative:
        "에이전트가 테스트를 통과했다고 말했습니다. 테스트를 돌린 건 에이전트가 아니라 훅뿐이었습니다.",
      check: "그 훅이 문장이 주장하는 범위를 실제로 덮는지 확인하세요.",
    },
    "claim-no-run.unreadable": {
      narrative:
        "에이전트가 테스트를 통과했다고 말했습니다. 테스트로 보이는 명령이 돌긴 했지만, 이 도구가 결과를 읽어낼 수 있는 것은 없었습니다.",
      check: "그 명령이 실제로 무엇을 보고했는지 직접 보세요.",
    },
    "claim-vs-fail.contradicts": {
      narrative:
        "에이전트가 테스트를 통과했다고 말했습니다. 그 직전 테스트 실행은 반대로 말했고, 사이에 다시 돌린 적이 없습니다.",
      check: "테스트를 다시 돌려서 위 문장과 비교해보세요.",
    },
    "claim-vs-fail.stale": {
      narrative:
        "에이전트가 테스트를 통과했다고 말했지만, 근거로 삼은 실행 이후에 코드가 바뀌었습니다. 그 주장은 이전 버전의 코드에 대한 것입니다.",
      check: "코드가 바뀐 지금 상태로 테스트를 다시 돌려보세요.",
    },
    "hardcoded-expected.literal": {
      narrative:
        "코드가 {expected}이 아니라 {received}을 내놓아 테스트가 실패했습니다. 그러자 에이전트는 코드는 그대로 둔 채, 실패에서 나온 값인 {received}을 테스트의 정답으로 바꿨습니다.",
      check: "{expected}과 {received} 중 무엇이 실제로 맞는 값인지 판단하세요.",
    },
    "hardcoded-expected.snapshot": {
      narrative:
        "테스트가 실패하자, 에이전트는 출력을 스냅샷에 맞추는 대신 저장된 스냅샷을 새 출력에 맞춰 갱신했습니다.",
      check: "스냅샷 변경분을 읽고 새 출력이 맞는지 판단하세요.",
    },
    "error-swallowing.empty": {
      narrative:
        "에러가 발생하자, 에이전트는 그 코드를 아무것도 하지 않는 catch로 감쌌습니다. 에러는 처리된 게 아니라 보이지 않게 됐습니다.",
      check: "한 번만 로그를 찍거나 다시 던져서 무엇이 삼켜지고 있었는지 보세요.",
    },
  },
};

const LOCALES: Locale[] = [en, ko];

/** Accepts "ko", "ko_KR.UTF-8", "ko-KR" and falls back to English. */
export function resolveLocale(tag: string | undefined): Locale {
  if (!tag) return en;
  const primary = tag.toLowerCase().split(/[_.\-@]/)[0];
  return LOCALES.find((locale) => locale.id === primary) ?? en;
}

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

export function titleFor(locale: Locale, detector: string): string {
  return locale.titles[detector] ?? en.titles[detector] ?? detector;
}

export function noteFor(
  locale: Locale,
  key: string,
  vars: Record<string, string>,
  fallback: string,
): string {
  const template = locale.notes[key] ?? en.notes[key];
  return template === undefined ? fallback : interpolate(template, vars);
}

export function messageFor(
  locale: Locale,
  key: string,
  vars: Record<string, string>,
): Message {
  const message = locale.messages[key] ?? en.messages[key];
  if (!message) return { narrative: key, check: "" };
  return {
    narrative: interpolate(message.narrative, vars),
    check: interpolate(message.check, vars),
  };
}
