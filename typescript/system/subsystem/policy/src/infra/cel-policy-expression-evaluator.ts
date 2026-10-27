import { CelEnvironment } from "../../../../external/cel.ts";
import { ATTRIBUTE_SCHEMA, type AttributeType, type PolicyAttributes } from "../model/policy.ts";
import type { PolicyExpressionEvaluator } from "../usecase/policy-expression-evaluator.ts";

const CEL_TYPES: Readonly<Record<AttributeType, string>> = {
  string: "string",
  int: "int",
  bool: "bool",
  timestamp: "google.protobuf.Timestamp",
};

/** Policy predicates evaluated as CEL through cel-js (PO-4; spike K1). */
export class CelPolicyExpressionEvaluator implements PolicyExpressionEvaluator {
  readonly #environment: InstanceType<typeof CelEnvironment>;

  constructor() {
    let environment = new CelEnvironment();
    for (const [namespace, attributes] of Object.entries(ATTRIBUTE_SCHEMA)) {
      const schema = Object.fromEntries(
        Object.entries(attributes).map(([name, type]) => [name, CEL_TYPES[type as AttributeType]]),
      );
      environment = environment.registerVariable({ name: namespace, schema });
    }
    this.#environment = environment;
  }

  check(expression: string): string | null {
    try {
      const result = this.#environment.check(expression) as {
        valid: boolean;
        type?: string;
        error?: { message?: string };
      };
      if (!result.valid)
        return (result.error?.message ?? "invalid expression").split("\n")[0] ?? "invalid expression";
      return result.type === "bool" ? null : `the expression is of type ${result.type}, not bool`;
    } catch (error) {
      return String(error instanceof Error ? error.message : error).split("\n")[0] ?? "invalid expression";
    }
  }

  evaluate(expression: string, attributes: PolicyAttributes): boolean {
    const value: unknown = this.#environment.evaluate(expression, toCelValues(attributes));
    if (typeof value !== "boolean")
      throw new Error(`The predicate ${expression} did not evaluate to a boolean.`);
    return value;
  }
}

/** CEL integers are BigInt; absent attributes stay absent, so `has()` sees them as unset. */
function toCelValues(attributes: PolicyAttributes): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {};
  for (const [namespace, namespaceAttributes] of Object.entries(attributes)) {
    const schema = ATTRIBUTE_SCHEMA[namespace as keyof typeof ATTRIBUTE_SCHEMA] as Readonly<
      Record<string, AttributeType>
    >;
    values[namespace] = Object.fromEntries(
      Object.entries(namespaceAttributes as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .map(([name, value]) => [name, schema[name] === "int" ? BigInt(value as number) : value]),
    );
  }
  return values;
}
