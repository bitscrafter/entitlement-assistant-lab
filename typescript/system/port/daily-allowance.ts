/**
 * Daily allowances of the demo (usage-guards D2, D3): counters per key and UTC day, shared by every Worker
 * isolate, so a cap holds across all users and connections.
 */
export interface DailyAllowance {
  /**
   * Takes one from the key's allowance for the UTC day of `at`.
   *
   * @ensures `Allowed`, and counted, while fewer than `cap` were taken that day; otherwise `Refused`, not counted.
   * @ensures Takes for one key are counted one at a time: two at once never both take the last one.
   */
  take(key: string, at: Date, cap: number): Promise<"Allowed" | "Refused">;
}
