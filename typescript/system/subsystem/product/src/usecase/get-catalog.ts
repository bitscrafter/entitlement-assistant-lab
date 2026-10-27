import { type Catalog, catalogViolations } from "../model/catalog.ts";
import type { CatalogRepository } from "./catalog-repository.ts";

/**
 * The product catalog, refused when it breaks a catalog rule (product §3).
 *
 * @ensures The returned catalog has no catalog violation.
 * @ensures A catalog with a violation is a fault of the seeded reference data: the call rejects, naming it.
 */
export class GetCatalog {
  readonly #catalogs: CatalogRepository;

  constructor(dependencies: { readonly catalogs: CatalogRepository }) {
    this.#catalogs = dependencies.catalogs;
  }

  async execute(): Promise<Catalog> {
    const catalog = await this.#catalogs.load();
    const violations = catalogViolations(catalog);
    if (violations.length > 0) throw new Error(`The catalog breaks its rules: ${violations.join("; ")}.`);
    return catalog;
  }
}
