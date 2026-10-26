import type { Clock } from "../../../../port/clock.ts";
import {
  combinePolicies,
  type PolicyAttributes,
  type PolicyFinding,
  type PolicySet,
} from "../model/policy.ts";
import type { PolicyExpressionEvaluator } from "./policy-expression-evaluator.ts";
import type { PolicySetRepository } from "./policy-set-repository.ts";

export type { PolicyAttributes, PolicyFinding };

/** How long a confirmation that the bundled set is active stands before it is checked again (policy §6). */
const ACTIVATION_RECHECK_MILLISECONDS = 60_000;

/** When the bundled set was last confirmed active; one per Worker isolate, shared by every request in it. */
export class PolicySetActivationCheck {
  confirmedAt: Date | null = null;
}

export class PolicySetInactiveError extends Error {
  constructor(version: string) {
    super(`The bundled policy set ${version} is not active; no decision is made.`);
  }
}

/** The policy step of a decision (PO-3), with the bundled set that decided (EvaluatePolicies, internal). */
export class EvaluatePolicies {
  readonly #policySet: PolicySet;
  readonly #evaluator: PolicyExpressionEvaluator;
  readonly #policySets: PolicySetRepository;
  readonly #activation: PolicySetActivationCheck;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly policySet: PolicySet;
    readonly evaluator: PolicyExpressionEvaluator;
    readonly policySets: PolicySetRepository;
    readonly activation: PolicySetActivationCheck;
    readonly clock: Clock;
  }) {
    this.#policySet = dependencies.policySet;
    this.#evaluator = dependencies.evaluator;
    this.#policySets = dependencies.policySets;
    this.#activation = dependencies.activation;
    this.#clock = dependencies.clock;
  }

  get policySetVersion(): string {
    return this.#policySet.version;
  }

  /**
   * @ensures The combination of every policy governing `actionKey` over `attributes` (`combinePolicies`).
   * @ensures Decides only while the bundled set is active, confirmed at most a minute ago; otherwise rejects with
   *          `PolicySetInactiveError` (fail closed).
   */
  async execute(request: {
    readonly actionKey: string;
    readonly attributes: PolicyAttributes;
  }): Promise<PolicyFinding> {
    await this.#confirmActive();
    return combinePolicies(this.#policySet.policies, request.actionKey, (expression) =>
      this.#evaluator.evaluate(expression, request.attributes),
    );
  }

  async #confirmActive(): Promise<void> {
    const now = this.#clock.now();
    const confirmedAt = this.#activation.confirmedAt;
    if (confirmedAt !== null && now.getTime() - confirmedAt.getTime() < ACTIVATION_RECHECK_MILLISECONDS)
      return;
    if (!(await this.#policySets.isActive(this.#policySet.version))) {
      this.#activation.confirmedAt = null;
      throw new PolicySetInactiveError(this.#policySet.version);
    }
    this.#activation.confirmedAt = now;
  }
}
