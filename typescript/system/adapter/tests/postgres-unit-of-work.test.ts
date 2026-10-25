import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { APPLICATION_DATABASE_ROLE, PostgresConnection } from "../postgres/postgres-connection.ts";
import { PostgresUnitOfWork } from "../postgres/postgres-unit-of-work.ts";
import { createTestDatabase, type TestDatabase } from "./support/database.ts";

describe("PostgresUnitOfWork", () => {
  let database: TestDatabase;
  let connection: PostgresConnection;

  beforeEach(async () => {
    database = await createTestDatabase();
    connection = await PostgresConnection.open(database.connectionString);
    await connection.query("CREATE TABLE probe (value text NOT NULL)");
  });

  afterEach(async () => {
    await connection.close();
    await database.drop();
  });

  const count = async () =>
    (await connection.query<{ count: string }>("SELECT count(*) FROM probe"))[0]?.count;

  test("ensures everything written commits together when the work resolves", async () => {
    await new PostgresUnitOfWork(connection, { role: null }).run(async () => {
      await connection.query("INSERT INTO probe VALUES ('a'), ('b')");
    });
    expect(await count()).toBe("2");
  });

  test("ensures nothing written is kept when the work rejects, and the rejection propagates", async () => {
    const work = new PostgresUnitOfWork(connection, { role: null }).run(async () => {
      await connection.query("INSERT INTO probe VALUES ('a')");
      throw new Error("work failed");
    });
    await expect(work).rejects.toThrow("work failed");
    expect(await count()).toBe("0");
  });

  test("ensures a nested call joins the enclosing transaction", async () => {
    const unitOfWork = new PostgresUnitOfWork(connection, { role: null });
    const work = unitOfWork.run(async () => {
      await unitOfWork.run(async () => {
        await connection.query("INSERT INTO probe VALUES ('inner')");
      });
      throw new Error("outer failed");
    });
    await expect(work).rejects.toThrow("outer failed");
    expect(await count()).toBe("0");
  });

  test("ensures every statement of a unit of work with a role acts with that role, and only inside it", async () => {
    const unitOfWork = new PostgresUnitOfWork(connection, { role: APPLICATION_DATABASE_ROLE });
    const inside = await unitOfWork.run(async () => {
      await connection.query("SELECT 1");
      return (await connection.query<{ current_user: string }>("SELECT current_user"))[0]?.current_user;
    });
    const after = (await connection.query<{ current_user: string }>("SELECT current_user"))[0]?.current_user;
    expect(inside).toBe(APPLICATION_DATABASE_ROLE);
    expect(after).not.toBe(APPLICATION_DATABASE_ROLE);
  });
});
