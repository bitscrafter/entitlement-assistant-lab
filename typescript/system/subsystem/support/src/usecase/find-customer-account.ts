import { decodeIdentifier, type Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdentifierHasher } from "../../../../port/identifier-hasher.ts";
import type { ListAccountRoles } from "../../../access/src/usecase/list-account-roles.ts";
import type {
  CustomerAccountView,
  GetCustomerAccount,
} from "../../../account/src/usecase/get-customer-account.ts";
import type { FindIndividualByEmail } from "../../../customer-identity/src/usecase/find-individual-by-email.ts";
import type { GetIndividuals } from "../../../customer-identity/src/usecase/get-individuals.ts";
import type { ComputeEffectiveEntitlements } from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";
import { type Disclosure, disclose } from "../model/disclosure.ts";
import type { ReadEnforcement } from "./read-enforcement.ts";
import type { CoveringTerm, ReadRefusal, ReadRequest } from "./read-request.ts";

export interface AccountSummary {
  readonly accountId: Uuid;
  readonly displayName: string;
  readonly accountCategory: "Standalone" | "OrganizationMember";
  /** Reason codes of the account's unreleased holds. */
  readonly holds: readonly string[];
  /** The plan of the latest term, current or ended; null when the account never had a term. */
  readonly planKey: string | null;
  readonly coveringTerm: CoveringTerm | null;
  readonly addonKeys: readonly string[];
  /** Emails of the people holding owner or admin in the account. */
  readonly ownersAndAdmins: readonly string[];
}

export interface AccountCandidate {
  readonly accountId: Uuid;
  readonly displayName: string;
  /** For an email query: whether this is the person's own account, and the roles the person holds in it. */
  readonly ownAccount: boolean;
  readonly roles: readonly string[];
}

export type FindCustomerAccountResult =
  | { readonly kind: "Found"; readonly account: AccountSummary }
  | { readonly kind: "Ambiguous"; readonly candidates: readonly AccountCandidate[] }
  | ReadRefusal;

const USE_CASE = "FindCustomerAccount";
const ADMINISTERING_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

interface Candidate extends AccountCandidate {
  readonly account: CustomerAccountView;
}

/** Finds a customer account by email, account id, or display-name fragment (explain-access §3). */
export class FindCustomerAccount {
  readonly #enforcement: ReadEnforcement;
  readonly #identifierHasher: IdentifierHasher;
  readonly #findIndividualByEmail: FindIndividualByEmail;
  readonly #getIndividuals: GetIndividuals;
  readonly #getCustomerAccount: GetCustomerAccount;
  readonly #listAccountRoles: ListAccountRoles;
  readonly #computeEffectiveEntitlements: ComputeEffectiveEntitlements;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly enforcement: ReadEnforcement;
    readonly identifierHasher: IdentifierHasher;
    readonly findIndividualByEmail: FindIndividualByEmail;
    readonly getIndividuals: GetIndividuals;
    readonly getCustomerAccount: GetCustomerAccount;
    readonly listAccountRoles: ListAccountRoles;
    readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements;
    readonly clock: Clock;
  }) {
    this.#enforcement = dependencies.enforcement;
    this.#identifierHasher = dependencies.identifierHasher;
    this.#findIndividualByEmail = dependencies.findIndividualByEmail;
    this.#getIndividuals = dependencies.getIndividuals;
    this.#getCustomerAccount = dependencies.getCustomerAccount;
    this.#listAccountRoles = dependencies.listAccountRoles;
    this.#computeEffectiveEntitlements = dependencies.computeEffectiveEntitlements;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures A principal without `account.read` is refused before any search, with one audit record carrying the
   *          query's keyed hash, never the query (D12): `NotFound`.
   * @ensures A query matching no account writes one `Failed` record, `support.no-matching-account`: `NotFound`.
   * @ensures Each candidate gets its own audited decision; denied candidates are left out (D3). When every candidate
   *          is denied by policies alone, `Denied` with their reasons; otherwise `NotFound`.
   * @ensures One authorized candidate is `Found` with its summary; several are `Ambiguous`, the person's own
   *          account first, then by display name.
   */
  async execute(request: ReadRequest & { readonly query: string }): Promise<FindCustomerAccountResult> {
    const query = request.query.trim();
    const queryHash = await this.#identifierHasher.hash(query);
    const gate = await this.#enforcement.permitted(request, USE_CASE, { queryHash });
    if (gate.outcome !== "Allow") return { kind: "NotFound" };

    const candidates = await this.#candidates(query);
    if (candidates.length === 0) {
      await this.#enforcement.record(
        request,
        {
          outcome: "Failed",
          reasonCodes: ["support.no-matching-account"],
          policySetVersion: gate.policySetVersion,
        },
        { subjectAccountId: null, detail: { use_case: USE_CASE, query_hmac: queryHash } },
      );
      return { kind: "NotFound" };
    }
    const decided: { readonly candidate: Candidate; readonly disclosure: Disclosure }[] = [];
    for (const candidate of candidates) {
      const decision = await this.#enforcement.decideRead(request, USE_CASE, candidate.accountId);
      decided.push({ candidate, disclosure: disclose(decision, true) });
    }
    const allowed = decided
      .filter(({ disclosure }) => disclosure.kind === "Allowed")
      .map(({ candidate }) => candidate);
    if (allowed.length === 0) {
      const refusals = decided.map(({ disclosure }) => disclosure);
      return refusals.every((refusal) => refusal.kind === "Denied")
        ? {
            kind: "Denied",
            reasonCodes: [...new Set(refusals.flatMap((refusal) => refusal.reasonCodes))].sort(),
          }
        : { kind: "NotFound" };
    }
    const [only] = allowed;
    if (allowed.length === 1 && only !== undefined)
      return { kind: "Found", account: await this.#summary(only.account) };
    return {
      kind: "Ambiguous",
      candidates: allowed.map(({ accountId, displayName, ownAccount, roles }) => ({
        accountId,
        displayName,
        ownAccount,
        roles,
      })),
    };
  }

  /** Every account the query names, once each: the person's own and member accounts, an id, or a name fragment. */
  async #candidates(query: string): Promise<readonly Candidate[]> {
    if (query.includes("@")) {
      const person = await this.#findIndividualByEmail.execute(query);
      const own = person === null ? null : await this.#getCustomerAccount.byCustomer(person.customerId);
      if (own === null) return [];
      const rolesByAccount = new Map<Uuid, string[]>();
      for (const assignment of await this.#listAccountRoles.execute({ memberAccountId: own.accountId })) {
        rolesByAccount.set(assignment.memberOfAccountId, [
          ...(rolesByAccount.get(assignment.memberOfAccountId) ?? []),
          assignment.roleKey,
        ]);
      }
      const others: Candidate[] = [];
      for (const [accountId, roles] of rolesByAccount) {
        if (accountId === own.accountId) continue;
        const account = await this.#getCustomerAccount.execute(accountId);
        if (account !== null) others.push(candidateOf(account, false, roles));
      }
      return [candidateOf(own, true, rolesByAccount.get(own.accountId) ?? []), ...byDisplayName(others)];
    }
    if (query.startsWith("acc_")) {
      const decoded = decodeIdentifier("acc", query);
      const account = decoded.ok ? await this.#getCustomerAccount.execute(decoded.value) : null;
      return account === null ? [] : [candidateOf(account, false, [])];
    }
    return (await this.#getCustomerAccount.searchByDisplayName(query)).map((account) =>
      candidateOf(account, false, []),
    );
  }

  async #summary(account: CustomerAccountView): Promise<AccountSummary> {
    const computed = await this.#computeEffectiveEntitlements.execute({
      accountId: account.accountId,
      at: this.#clock.now(),
    });
    const effective = computed?.effective;
    const administrators = new Set(
      (await this.#listAccountRoles.execute({ memberOfAccountId: account.accountId }))
        .filter((assignment) => ADMINISTERING_ROLES.has(assignment.roleKey))
        .map((assignment) => assignment.memberAccountId),
    );
    const customerIds: Uuid[] = [];
    for (const accountId of administrators) {
      const administrator = await this.#getCustomerAccount.execute(accountId);
      if (administrator !== null) customerIds.push(administrator.customerId);
    }
    const addonKeys =
      effective?.kind === "Effective"
        ? effective.entitlements.flatMap((entitlement) =>
            entitlement.sources.flatMap((source) => (source.kind === "addon" ? [source.addonKey] : [])),
          )
        : [];
    return {
      accountId: account.accountId,
      displayName: account.displayName,
      accountCategory: account.accountCategory,
      holds: account.holdReasonCodes,
      planKey: computed?.latestPlanKey ?? null,
      coveringTerm:
        effective?.kind === "Effective"
          ? { source: effective.coveringTerm.source, endsAt: effective.coveringTerm.endsAt }
          : null,
      addonKeys: [...new Set(addonKeys)].sort(),
      ownersAndAdmins: (await this.#getIndividuals.execute(customerIds))
        .map((individual) => individual.email)
        .sort(),
    };
  }
}

function candidateOf(account: CustomerAccountView, ownAccount: boolean, roles: readonly string[]): Candidate {
  return {
    account,
    accountId: account.accountId,
    displayName: account.displayName,
    ownAccount,
    roles: [...roles].sort(),
  };
}

function byDisplayName(candidates: readonly Candidate[]): readonly Candidate[] {
  return [...candidates].sort((left, right) => left.displayName.localeCompare(right.displayName));
}
