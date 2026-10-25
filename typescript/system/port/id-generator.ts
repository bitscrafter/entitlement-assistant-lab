import type { Uuid } from "../kernel/identifier.ts";

/** The source of identifiers for entities with a lifecycle (CM-14). */
export interface IdGenerator {
  /**
   * @ensures Returns a UUIDv7 never returned before by this generator.
   * @ensures Identifiers from one generator increase in creation order.
   */
  newId(): Uuid;
}
