/**
 * Realistic test-runner output.
 *
 * Copied from real runs, because the status parser reads these exact summary
 * lines. Note the assertion wording: vitest prints "expected <actual> to be
 * <expected>", which is the reverse order of jest's Expected/Received block.
 */

export function vitestPass(opts: { passed?: number; files?: number } = {}): string {
  const passed = opts.passed ?? 34;
  const files = opts.files ?? 1;
  return [
    ` ✓ test/cart.test.ts (${passed} tests) 15ms`,
    "",
    ` Test Files  ${files} passed (${files})`,
    `      Tests  ${passed} passed (${passed})`,
    "   Start at  22:03:37",
    "   Duration  308ms",
    "",
  ].join("\n");
}

export function vitestFail(
  opts: { failed?: number; passed?: number; expected?: string; received?: string; testName?: string } = {},
): string {
  const failed = opts.failed ?? 1;
  const passed = opts.passed ?? 33;
  const expected = opts.expected ?? "8";
  const received = opts.received ?? "11";
  const testName = opts.testName ?? "cart > returns the total";
  return [
    ` ❯ test/cart.test.ts (${failed + passed} tests | ${failed} failed) 20ms`,
    `   × ${testName} 5ms`,
    `     → expected ${received} to be ${expected} // Object.is equality`,
    "",
    "⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯",
    "",
    ` FAIL  test/cart.test.ts > ${testName}`,
    `AssertionError: expected ${received} to be ${expected} // Object.is equality`,
    "",
    "- Expected",
    "+ Received",
    "",
    `- ${expected}`,
    `+ ${received}`,
    "",
    ` Test Files  1 failed (1)`,
    `      Tests  ${failed} failed | ${passed} passed (${failed + passed})`,
    "",
  ].join("\n");
}

export function jestFail(
  opts: { failed?: number; passed?: number; expected?: string; received?: string } = {},
): string {
  const failed = opts.failed ?? 1;
  const passed = opts.passed ?? 33;
  const expected = opts.expected ?? "8";
  const received = opts.received ?? "11";
  return [
    " FAIL  test/cart.test.js",
    "  ● cart › returns the total",
    "",
    `    expect(received).toBe(expected) // Object.is equality`,
    "",
    `    Expected: ${expected}`,
    `    Received: ${received}`,
    "",
    `Test Suites: 1 failed, 1 total`,
    `Tests:       ${failed} failed, ${passed} passed, ${failed + passed} total`,
    "Snapshots:   0 total",
    "Time:        1.2 s",
    "",
  ].join("\n");
}

export function jestPass(opts: { passed?: number } = {}): string {
  const passed = opts.passed ?? 34;
  return [
    " PASS  test/cart.test.js",
    `Test Suites: 1 passed, 1 total`,
    `Tests:       ${passed} passed, ${passed} total`,
    "Time:        1.1 s",
    "",
  ].join("\n");
}

export function mochaFail(opts: { failing?: number; passing?: number } = {}): string {
  return [
    "",
    `  ${opts.passing ?? 33} passing (120ms)`,
    `  ${opts.failing ?? 1} failing`,
    "",
    "  1) cart returns the total:",
    "     AssertionError: expected 11 to equal 8",
    "",
  ].join("\n");
}

export function pytestFail(
  opts: { failed?: number; passed?: number; expected?: string; received?: string } = {},
): string {
  const failed = opts.failed ?? 1;
  const passed = opts.passed ?? 1;
  const expected = opts.expected ?? "8";
  const received = opts.received ?? "11";
  return [
    "=================================== FAILURES ===================================",
    "_________________________________ test_total __________________________________",
    "",
    "    def test_total():",
    `>       assert total() == ${expected}`,
    `E       assert ${received} == ${expected}`,
    `E        +  where ${received} = total()`,
    "",
    "test_cart.py:5: AssertionError",
    "=========================== short test summary info ============================",
    `FAILED test_cart.py::test_total - assert ${received} == ${expected}`,
    `${failed} failed, ${passed} passed in 0.05s`,
    "",
  ].join("\n");
}

export function pytestPass(opts: { passed?: number } = {}): string {
  return ["", `============================== ${opts.passed ?? 12} passed in 0.11s ==============================`, ""].join("\n");
}

/** What survives `... 2>&1 | grep -E "error|warn"`: no summary line at all. */
export function grepped(): string {
  return "src/cart.ts:12:5 - warning: unused variable\n";
}
