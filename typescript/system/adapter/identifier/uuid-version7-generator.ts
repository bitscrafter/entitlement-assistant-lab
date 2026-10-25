import { uuidVersion7 } from "../../external/uuid.ts";
import type { Uuid } from "../../kernel/identifier.ts";
import type { IdGenerator } from "../../port/id-generator.ts";

/** UUIDv7 identifiers from the `uuid` library, which keeps them increasing within one process. */
export class UuidVersion7Generator implements IdGenerator {
  newId(): Uuid {
    return uuidVersion7() as Uuid;
  }
}
