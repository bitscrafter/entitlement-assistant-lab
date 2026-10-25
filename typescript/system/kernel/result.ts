/** An expected outcome of an operation: a value, or a typed failure. Exceptions are for faults only. */
export type Result<Value, Failure> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: Failure };

export function success<Value>(value: Value): { readonly ok: true; readonly value: Value } {
  return { ok: true, value };
}

export function failure<Failure>(failureValue: Failure): { readonly ok: false; readonly failure: Failure } {
  return { ok: false, failure: failureValue };
}

/** Marks a branch that the type system proves unreachable; reaching it at runtime is a programming error. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
