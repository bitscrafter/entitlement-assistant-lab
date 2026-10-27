import { takeFromDay } from "../../kernel/usage-caps.ts";
import type { DailyAllowance } from "../../port/daily-allowance.ts";

/** Daily allowances in one process's memory: for tests and local runs. */
export class InMemoryDailyAllowance implements DailyAllowance {
  readonly #counted = new Map<string, { readonly day: string; readonly taken: number }>();

  async take(key: string, at: Date, cap: number): Promise<"Allowed" | "Refused"> {
    const result = takeFromDay(this.#counted.get(key), at, cap);
    this.#counted.set(key, result.counted);
    return result.outcome;
  }
}
