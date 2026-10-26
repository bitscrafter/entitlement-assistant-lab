import { type Remedy, remedyFor } from "../model/catalog.ts";
import type { GetCatalog } from "./get-catalog.ts";

export type { Remedy };

/** What would make a feature available to an account on its current plan (PR-10). */
export class FindLowestPlanIncluding {
  readonly #getCatalog: GetCatalog;

  constructor(dependencies: { readonly getCatalog: GetCatalog }) {
    this.#getCatalog = dependencies.getCatalog;
  }

  /** @ensures The remedy of `remedyFor` over the current catalog. */
  async execute(request: {
    readonly featureKey: string;
    readonly currentPlanKey: string | null;
  }): Promise<Remedy> {
    return remedyFor(await this.#getCatalog.execute(), request.featureKey, request.currentPlanKey);
  }
}
