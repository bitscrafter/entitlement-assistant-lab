/** A transaction that the use cases of several subsystems join (AI_AS_ARCHITECT.md, transactions). */
export interface UnitOfWork {
  /**
   * Runs `work` inside one transaction.
   *
   * @ensures When `work` resolves, everything it wrote is committed together.
   * @ensures When `work` rejects, nothing it wrote is kept, and the rejection is propagated.
   * @ensures A nested call joins the enclosing transaction instead of starting another.
   */
  run<Value>(work: () => Promise<Value>): Promise<Value>;
}
