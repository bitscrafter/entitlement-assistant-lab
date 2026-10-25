/** The PostgreSQL driver, reachable only through this module (rule dependencies-point-inward). */
import pg from "pg";

export const PostgresClient = pg.Client;
export type PostgresClient = pg.Client;
export type PostgresQueryResult<Row extends pg.QueryResultRow> = pg.QueryResult<Row>;
