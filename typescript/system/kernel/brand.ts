/** A nominal type: a `Base` value that only its constructor can produce. */
export type Brand<Base, Name extends string> = Base & { readonly __brand: Name };
