import type { PostgresClient } from "../../../../external/postgres.ts";
import { z } from "../../../../external/zod.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";

const key = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const alias = z.string().regex(/^[a-z]+_[a-z0-9_]+$/);
const instant = z.iso.datetime();
const quota = z.int().positive();

const bundleSchema = z.strictObject({ feature: key, quota: quota.optional() });

/** The product catalog of reference-data.yaml (data-model/product.md §4). */
export const catalogSchema = z.strictObject({
  products: z.array(z.strictObject({ product: key, name: z.string(), description: z.string() })),
  features: z.array(
    z.strictObject({
      feature: key,
      product: key,
      name: z.string(),
      description: z.string(),
      metered_unit: z.string().optional(),
      operations: z.array(z.strictObject({ operation: key, description: z.string() })).optional(),
    }),
  ),
  plan_ladders: z.array(z.strictObject({ plan_ladder: key, name: z.string(), description: z.string() })),
  plans: z.array(
    z.strictObject({
      plan: key,
      plan_ladder: key,
      name: z.string(),
      tier_rank: z.int().positive(),
      plan_category: z.enum(["Free", "Paid"]),
      bundles: z.array(bundleSchema),
    }),
  ),
  addons: z.array(
    z.strictObject({
      addon: key,
      name: z.string(),
      description: z.string(),
      bundles: z.array(bundleSchema),
      eligible_on: z.array(key),
    }),
  ),
});

const endSchema = {
  ended_at: instant.optional(),
  ended_by: alias.optional(),
};

/** The customer side of fixtures.yaml (explain-access §2). */
export const customerFixturesSchema = {
  organizations: z.array(
    z.strictObject({
      customer: alias,
      account: alias,
      legal_name: z.string(),
      primary_domain: z.string(),
    }),
  ),
  individuals: z.array(
    z.strictObject({
      customer: alias,
      account: alias,
      email: z.email(),
      given_name: z.string(),
      family_name: z.string(),
      account_category: z.enum(["Standalone", "OrganizationMember"]),
      memberships: z.array(
        z.strictObject({
          membership: alias,
          organization: alias,
          joined_at: instant,
          ended_at: instant.optional(),
          end_reason: z.enum(["Left", "Removed"]).optional(),
        }),
      ),
      roles: z.array(
        z.strictObject({
          assignment: alias,
          member_of: alias,
          role: key,
          ...endSchema,
          end_reason: z.enum(["Revoked", "MembershipEnded"]).optional(),
        }),
      ),
      holds: z
        .array(
          z.strictObject({
            reason: z.enum(["CustomerRemoved", "NoActiveMembership"]),
            placed_at: instant,
            placed_by: alias,
          }),
        )
        .optional(),
    }),
  ),
  customer_account_holds: z.array(
    z.strictObject({
      account: alias,
      reason: z.enum(["OperationalSuspension", "CustomerRemoved", "NoActiveMembership"]),
      placed_at: instant,
      placed_by: alias,
    }),
  ),
  subscriptions: z.array(
    z.strictObject({
      subscription: alias,
      account: alias,
      started_at: instant,
      ...endSchema,
      end_reason: z.enum(["Canceled", "CustomerRemoved"]).optional(),
      terms: z.array(
        z.strictObject({
          term: alias,
          plan: key,
          source: z.enum(["FreePlan", "Payment", "Contract", "Trial", "Courtesy", "Complimentary"]),
          starts_at: instant,
          scheduled_end_at: instant.optional(),
          ...endSchema,
          end_reason: z.enum(["PlanChanged", "SubscriptionEnded"]).optional(),
        }),
      ),
      addons: z
        .array(z.strictObject({ subscription_addon: alias, addon: key, started_at: instant }))
        .optional(),
      grants: z
        .array(
          z.strictObject({
            grant: alias,
            feature: key,
            quota: quota.optional(),
            reason: z.string(),
            starts_at: instant,
            expires_at: instant,
          }),
        )
        .optional(),
    }),
  ),
};

const customerFixtures = z.strictObject(customerFixturesSchema);

/** The account recorded as creating the seeded terms and grants: an employee in the demo (entitlement §2). */
const TERM_CREATOR = "iac_sam";

/**
 * Inserts the catalog, and one feature permission (held by individuals) per feature operation.
 *
 * @ensures Every feature operation has the permission `feature.<feature_key>.<operation>`.
 * @relies-on db: permission_feature_operation_fk (a feature permission names an existing feature operation)
 */
export async function insertCatalog(
  client: PostgresClient,
  catalog: z.infer<typeof catalogSchema>,
): Promise<void> {
  for (const product of catalog.products) {
    await client.query("INSERT INTO product (product_key, name, description) VALUES ($1, $2, $3)", [
      product.product,
      product.name,
      product.description,
    ]);
  }
  for (const feature of catalog.features) {
    await client.query(
      "INSERT INTO feature (feature_key, product_key, name, description, metered_unit) VALUES ($1, $2, $3, $4, $5)",
      [feature.feature, feature.product, feature.name, feature.description, feature.metered_unit ?? null],
    );
    for (const operation of feature.operations ?? []) {
      await client.query(
        "INSERT INTO feature_operation (feature_key, operation, description) VALUES ($1, $2, $3)",
        [feature.feature, operation.operation, operation.description],
      );
      await client.query(
        `INSERT INTO permission (permission_key, principal_kind, operation, feature_key, description)
         VALUES ($1, 'Individual', $2, $3, $4)`,
        [
          `feature.${feature.feature}.${operation.operation}`,
          operation.operation,
          feature.feature,
          operation.description,
        ],
      );
    }
  }
  for (const ladder of catalog.plan_ladders) {
    await client.query("INSERT INTO plan_ladder (plan_ladder_key, name, description) VALUES ($1, $2, $3)", [
      ladder.plan_ladder,
      ladder.name,
      ladder.description,
    ]);
  }
  for (const plan of catalog.plans) {
    await client.query(
      "INSERT INTO plan (plan_key, plan_ladder_key, name, tier_rank, plan_category) VALUES ($1, $2, $3, $4, $5)",
      [plan.plan, plan.plan_ladder, plan.name, plan.tier_rank, plan.plan_category],
    );
    for (const bundle of plan.bundles) {
      await client.query(
        "INSERT INTO plan_feature_bundle (plan_key, feature_key, quota) VALUES ($1, $2, $3)",
        [plan.plan, bundle.feature, bundle.quota ?? null],
      );
    }
  }
  for (const addon of catalog.addons) {
    await client.query("INSERT INTO addon (addon_key, name, description) VALUES ($1, $2, $3)", [
      addon.addon,
      addon.name,
      addon.description,
    ]);
    for (const bundle of addon.bundles) {
      await client.query(
        "INSERT INTO addon_feature_bundle (addon_key, feature_key, quota) VALUES ($1, $2, $3)",
        [addon.addon, bundle.feature, bundle.quota ?? null],
      );
    }
    for (const plan of addon.eligible_on) {
      await client.query("INSERT INTO addon_plan_eligibility (addon_key, plan_key) VALUES ($1, $2)", [
        addon.addon,
        plan,
      ]);
    }
  }
}

/**
 * Inserts customers, their accounts, memberships, role assignments, holds, and subscriptions. Every person
 * also holds the owner role on their own account (explain-access §2).
 *
 * @requires The employees, whose accounts place holds and create terms, are inserted.
 * @ensures A customer account is `Suspended` exactly when it has an unreleased hold.
 * @ensures Every instant passes through `instantOf`, so the fixture can be moved to another day.
 */
export async function insertCustomers(
  client: PostgresClient,
  fixtures: z.infer<typeof customerFixtures>,
  idOf: (alias: string) => Uuid,
  instantOf: (instant: string) => string,
  seededAt: string,
): Promise<void> {
  const holdsOf = new Map<string, number>();
  for (const hold of fixtures.customer_account_holds)
    holdsOf.set(hold.account, (holdsOf.get(hold.account) ?? 0) + 1);
  for (const person of fixtures.individuals) {
    holdsOf.set(person.account, (holdsOf.get(person.account) ?? 0) + (person.holds ?? []).length);
  }
  const insertCustomerAccount = async (
    customer: string,
    account: string,
    kind: "Organization" | "Individual",
    displayName: string,
  ) => {
    await client.query(
      "INSERT INTO customer (customer_id, customer_kind, customer_status, created_at) VALUES ($1, $2, 'Active', $3)",
      [idOf(customer), kind, seededAt],
    );
    await client.query(
      `INSERT INTO account (account_id, account_kind, account_display_name, account_status, created_at)
       VALUES ($1, 'Customer', $2, $3, $4)`,
      [idOf(account), displayName, (holdsOf.get(account) ?? 0) > 0 ? "Suspended" : "Active", seededAt],
    );
  };
  const linkCustomerAccount = (
    customer: string,
    account: string,
    kind: "Organization" | "Individual",
    category: "Standalone" | "OrganizationMember",
  ) =>
    client.query(
      "INSERT INTO customer_account (account_id, customer_id, customer_kind, account_category) VALUES ($1, $2, $3, $4)",
      [idOf(account), idOf(customer), kind, category],
    );

  for (const organization of fixtures.organizations) {
    await insertCustomerAccount(
      organization.customer,
      organization.account,
      "Organization",
      organization.legal_name,
    );
    await client.query(
      "INSERT INTO organization (customer_id, legal_name, primary_domain, created_at) VALUES ($1, $2, $3, $4)",
      [idOf(organization.customer), organization.legal_name, organization.primary_domain, seededAt],
    );
    await linkCustomerAccount(organization.customer, organization.account, "Organization", "Standalone");
  }
  for (const person of fixtures.individuals) {
    const displayName = `${person.given_name} ${person.family_name}`;
    await insertCustomerAccount(person.customer, person.account, "Individual", displayName);
    await client.query(
      "INSERT INTO individual (customer_id, email, given_name, family_name, created_at) VALUES ($1, $2, $3, $4, $5)",
      [idOf(person.customer), person.email, person.given_name, person.family_name, seededAt],
    );
    await linkCustomerAccount(person.customer, person.account, "Individual", person.account_category);
  }
  for (const person of fixtures.individuals) {
    for (const membership of person.memberships) {
      await client.query(
        `INSERT INTO organization_membership (membership_id, organization_id, individual_id, joined_at, ended_at, end_reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          idOf(membership.membership),
          idOf(membership.organization),
          idOf(person.customer),
          instantOf(membership.joined_at),
          membership.ended_at === undefined ? null : instantOf(membership.ended_at),
          membership.end_reason ?? null,
        ],
      );
    }
    const roles: readonly (typeof person.roles)[number][] = [
      { assignment: `ara_${person.account}_owner`, member_of: person.account, role: "owner" },
      ...person.roles,
    ];
    for (const role of roles) {
      await client.query(
        `INSERT INTO account_role_assignment (assignment_id, member_account_id, member_of_account_id, role_key,
                                              assigned_at, assigned_by, ended_at, ended_by, end_reason)
         VALUES ($1, $2, $3, $4, $5, $2, $6, $7, $8)`,
        [
          idOf(role.assignment),
          idOf(person.account),
          idOf(role.member_of),
          role.role,
          seededAt,
          role.ended_at === undefined ? null : instantOf(role.ended_at),
          role.ended_by === undefined ? null : idOf(role.ended_by),
          role.end_reason ?? null,
        ],
      );
    }
  }
  const holds = [
    ...fixtures.customer_account_holds,
    ...fixtures.individuals.flatMap((person) =>
      (person.holds ?? []).map((hold) => ({ ...hold, account: person.account })),
    ),
  ];
  for (const [index, hold] of holds.entries()) {
    await client.query(
      "INSERT INTO account_hold (hold_id, account_id, hold_reason, placed_at, placed_by) VALUES ($1, $2, $3, $4, $5)",
      [
        idOf(`hld_${hold.account}_${index}`),
        idOf(hold.account),
        hold.reason,
        instantOf(hold.placed_at),
        idOf(hold.placed_by),
      ],
    );
  }
  for (const subscription of fixtures.subscriptions) {
    await client.query(
      `INSERT INTO subscription (subscription_id, account_id, started_at, ended_at, ended_by, end_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        idOf(subscription.subscription),
        idOf(subscription.account),
        instantOf(subscription.started_at),
        subscription.ended_at === undefined ? null : instantOf(subscription.ended_at),
        subscription.ended_by === undefined ? null : idOf(subscription.ended_by),
        subscription.end_reason ?? null,
      ],
    );
    for (const term of subscription.terms) {
      await client.query(
        `INSERT INTO subscription_term (term_id, subscription_id, plan_key, source, starts_at, scheduled_end_at,
                                        ended_at, ended_by, end_reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          idOf(term.term),
          idOf(subscription.subscription),
          term.plan,
          term.source,
          instantOf(term.starts_at),
          term.scheduled_end_at === undefined ? null : instantOf(term.scheduled_end_at),
          term.ended_at === undefined ? null : instantOf(term.ended_at),
          term.ended_by === undefined ? null : idOf(term.ended_by),
          term.end_reason ?? null,
          idOf(TERM_CREATOR),
        ],
      );
    }
    for (const addon of subscription.addons ?? []) {
      await client.query(
        "INSERT INTO subscription_addon (subscription_addon_id, subscription_id, addon_key, started_at) VALUES ($1, $2, $3, $4)",
        [
          idOf(addon.subscription_addon),
          idOf(subscription.subscription),
          addon.addon,
          instantOf(addon.started_at),
        ],
      );
    }
    for (const grant of subscription.grants ?? []) {
      await client.query(
        `INSERT INTO entitlement_grant (grant_id, subscription_id, feature_key, quota, reason, granted_by, starts_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          idOf(grant.grant),
          idOf(subscription.subscription),
          grant.feature,
          grant.quota ?? null,
          grant.reason,
          idOf(TERM_CREATOR),
          instantOf(grant.starts_at),
          instantOf(grant.expires_at),
        ],
      );
    }
  }
}
