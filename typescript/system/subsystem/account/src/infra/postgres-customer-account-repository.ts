import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { HoldReason } from "../model/hold.ts";
import type { CustomerAccount, CustomerAccountRepository } from "../usecase/customer-account-repository.ts";

export class PostgresCustomerAccountRepository implements CustomerAccountRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async findById(accountId: Uuid): Promise<CustomerAccount | null> {
    const [row] = await this.#connection.query<CustomerAccountRow>(
      `${SELECT_CUSTOMER_ACCOUNT} WHERE a.account_id = $1 ${GROUP}`,
      [accountId],
    );
    return row === undefined ? null : toCustomerAccount(row);
  }

  /** @relies-on db: customer_account_one_per_customer */
  async findByCustomer(customerId: Uuid): Promise<CustomerAccount | null> {
    const [row] = await this.#connection.query<CustomerAccountRow>(
      `${SELECT_CUSTOMER_ACCOUNT} WHERE c.customer_id = $1 ${GROUP}`,
      [customerId],
    );
    return row === undefined ? null : toCustomerAccount(row);
  }

  async searchByDisplayName(fragment: string): Promise<readonly CustomerAccount[]> {
    const pattern = `%${fragment.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const rows = await this.#connection.query<CustomerAccountRow>(
      `${SELECT_CUSTOMER_ACCOUNT} WHERE a.account_display_name ILIKE $1 ${GROUP} ORDER BY a.account_display_name`,
      [pattern],
    );
    return rows.map(toCustomerAccount);
  }
}

interface CustomerAccountRow extends Record<string, unknown> {
  readonly account_id: Uuid;
  readonly account_display_name: string;
  readonly account_category: "Standalone" | "OrganizationMember";
  readonly customer_id: Uuid;
  readonly customer_kind: "Organization" | "Individual";
  readonly holds: HoldReason[];
}

const SELECT_CUSTOMER_ACCOUNT = `
  SELECT a.account_id, a.account_display_name, c.account_category, c.customer_id, c.customer_kind,
         coalesce(array_agg(h.hold_reason ORDER BY h.hold_reason) FILTER (WHERE h.hold_id IS NOT NULL), '{}') AS holds
    FROM customer_account c JOIN account a USING (account_id)
    LEFT JOIN account_hold h ON h.account_id = a.account_id AND h.released_at IS NULL`;
const GROUP = "GROUP BY a.account_id, c.account_id";

function toCustomerAccount(row: CustomerAccountRow): CustomerAccount {
  return {
    accountId: row.account_id,
    displayName: row.account_display_name,
    accountCategory: row.account_category,
    customerId: row.customer_id,
    customerKind: row.customer_kind,
    holds: row.holds,
  };
}
