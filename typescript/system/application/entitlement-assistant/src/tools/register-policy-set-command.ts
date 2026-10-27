import { registerBundledPolicySet } from "./policy-set-registration.ts";

/** Registers the bundled policy set and activates it (policy §6): `npm run policies:register`. */
const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const { version, revision } = await registerBundledPolicySet(connectionString);
console.log(`Policy set ${version} registered and active (revision ${revision}).`);
