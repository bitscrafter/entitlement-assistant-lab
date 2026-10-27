import type { Catalog } from "../model/catalog.ts";

export interface CatalogRepository {
  /** @ensures The whole catalog: features with their operations, plans, and add-ons with their bundles. */
  load(): Promise<Catalog>;
}
