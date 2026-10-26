import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createHarness, type Harness, readRequest, uuidOf } from "../support/harness.ts";

describe("an explanation names the person as stored", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  test("ensures the person's email is the stored one, whatever case the request wrote (CM-10, CM-19)", async () => {
    const result = await harness.application.withUseCases((useCases) =>
      useCases.explainAccess.execute({
        ...readRequest("iac_blair"),
        personEmail: "CAROL@Acme.com",
        accountId: uuidOf("acc_acme"),
        featureKey: "api-access",
        operation: "create-token",
      }),
    );

    expect(result).toMatchObject({ kind: "Explained", personEmail: "carol@acme.com" });
  });
});
