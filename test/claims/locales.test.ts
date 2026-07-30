import { describe, expect, test } from "vitest";
import { findClaims } from "../../src/claims/extract.js";

/**
 * Claude Code answers in the language it was asked in, so an English-only
 * matcher finds nothing in a Japanese or Chinese session. A missed claim is a
 * missed finding and never a false accusation, which is why adding a locale is
 * cheap: the worst case is that it stays as blind as it was.
 *
 * The rejects matter more than the matches. A sentence about what the agent is
 * *about to* do, or one admitting a failure, must never be read as a claim that
 * the suite is green.
 */
function families(text: string): string[] {
  return findClaims(text).map((c) => c.family);
}

function tiers(text: string): string[] {
  return findClaims(text).map((c) => c.strength);
}

describe("Japanese", () => {
  test.each([
    "テストは全て通りました。",
    "全てのテストが成功しました。",
    "テストが通りました。",
    "34件のテストが全てパスしました。",
    "テストスイートはグリーンです。",
  ])("treats %j as a test-pass claim", (text) => {
    expect(families(text)).toContain("test-pass");
  });

  test.each(["ビルドが成功しました。", "型チェックが通りました。", "型エラーはありません。"])(
    "treats %j as a build-pass claim",
    (text) => {
      expect(families(text)).toContain("build-pass");
    },
  );

  test.each([
    "テストを実行して通ることを確認します。",
    "テストが失敗しました。",
    "テストはまだ通っていません。",
    "テストを通すように修正します。",
    "6件中5件のテストが通りました。",
    "一部のテストが通りました。",
  ])("never reads %j as a claim", (text) => {
    expect(families(text)).toHaveLength(0);
  });

  test("marks a hedged sentence as weak rather than dropping it", () => {
    expect(tiers("テストは通ったと思います。")).toEqual(["weak"]);
  });
});

describe("Chinese", () => {
  test.each([
    "所有测试都通过了。",
    "测试通过。",
    "34 个测试全部通过。",
    "测试套件是绿色的。",
    "測試全部通過。",
  ])("treats %j as a test-pass claim", (text) => {
    expect(families(text)).toContain("test-pass");
  });

  test.each(["构建成功。", "类型检查通过。", "没有类型错误。"])(
    "treats %j as a build-pass claim",
    (text) => {
      expect(families(text)).toContain("build-pass");
    },
  );

  test.each([
    "我先运行测试确认是否通过。",
    "测试失败了。",
    "测试还没有通过。",
    "修改代码使测试通过。",
    "6 个测试中有 5 个通过。",
    "部分测试通过。",
  ])("never reads %j as a claim", (text) => {
    expect(families(text)).toHaveLength(0);
  });

  test("marks a hedged sentence as weak rather than dropping it", () => {
    expect(tiers("测试应该通过了。")).toEqual(["weak"]);
  });
});

describe("the languages do not interfere with each other", () => {
  test("an English session is unaffected by the new packs", () => {
    expect(families("All tests pass.")).toEqual(["test-pass"]);
  });

  test("a Korean session is unaffected by the new packs", () => {
    expect(families("테스트 전부 통과했습니다.")).toEqual(["test-pass"]);
  });

  test("one sentence is counted once, not once per locale", () => {
    expect(families("All tests pass.")).toHaveLength(1);
    expect(families("テストは全て通りました。")).toHaveLength(1);
    expect(families("所有测试都通过了。")).toHaveLength(1);
  });
});
