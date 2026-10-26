import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { NormalizedEmail } from "../../../../kernel/email.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { CustomerRepository, Individual } from "../usecase/customer-repository.ts";

interface IndividualRow extends Record<string, unknown> {
  readonly customer_id: Uuid;
  readonly email: NormalizedEmail;
  readonly given_name: string;
  readonly family_name: string;
}

const toIndividual = (row: IndividualRow): Individual => ({
  customerId: row.customer_id,
  email: row.email,
  givenName: row.given_name,
  familyName: row.family_name,
});

export class PostgresCustomerRepository implements CustomerRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  /** @relies-on db: individual_email_unique */
  async findIndividualByEmail(email: NormalizedEmail): Promise<Individual | null> {
    const [row] = await this.#connection.query<IndividualRow>(
      "SELECT customer_id, email, given_name, family_name FROM individual WHERE email = $1",
      [email],
    );
    return row === undefined ? null : toIndividual(row);
  }

  async individualsByIds(customerIds: readonly Uuid[]): Promise<readonly Individual[]> {
    const rows = await this.#connection.query<IndividualRow>(
      "SELECT customer_id, email, given_name, family_name FROM individual WHERE customer_id = ANY($1::uuid[]) ORDER BY email",
      [customerIds],
    );
    return rows.map(toIndividual);
  }

  async hasActiveMembership(individualId: Uuid, organizationId: Uuid, at: Date): Promise<boolean> {
    const rows = await this.#connection.query(
      `SELECT 1 FROM organization_membership
        WHERE individual_id = $1 AND organization_id = $2 AND joined_at <= $3 AND (ended_at IS NULL OR ended_at > $3)`,
      [individualId, organizationId, at],
    );
    return rows.length > 0;
  }
}
