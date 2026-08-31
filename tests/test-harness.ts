namespace TanYueTests {
  type TestBody = () => void | Promise<void>;

  const cases: Array<{ name: string; body: TestBody }> = [];

  export function test(name: string, body: TestBody): void {
    cases.push({ name, body });
  }

  export function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  export function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
      throw new Error(`${message}；期望 ${String(expected)}，实际 ${String(actual)}`);
    }
  }

  export async function rejects(body: () => Promise<unknown>, code: string): Promise<void> {
    try {
      await body();
    } catch (error) {
      assert(error instanceof TanYue.SourceAdapterError, "应抛出 SourceAdapterError");
      equal(error.code, code, "错误码应匹配");
      return;
    }
    throw new Error(`应以 ${code} 失败`);
  }

  export function throws(body: () => unknown, messagePart: string): void {
    try {
      body();
    } catch (error) {
      assert(error instanceof Error, "应抛出 Error");
      assert(error.message.includes(messagePart), `错误信息应包含 ${messagePart}`);
      return;
    }
    throw new Error(`应抛出包含 ${messagePart} 的错误`);
  }

  export async function run(): Promise<void> {
    let passed = 0;
    const failures: string[] = [];

    for (const entry of cases) {
      try {
        await entry.body();
        passed += 1;
        console.log(`✓ ${entry.name}`);
      } catch (error) {
        const reason = error instanceof Error ? error.stack || error.message : String(error);
        failures.push(`${entry.name}\n${reason}`);
        console.error(`✗ ${entry.name}`);
      }
    }

    console.log(`\n${passed}/${cases.length} tests passed`);
    if (failures.length) {
      console.error(`\n${failures.join("\n\n")}`);
      throw new Error(`${failures.length} tests failed`);
    }
  }
}
