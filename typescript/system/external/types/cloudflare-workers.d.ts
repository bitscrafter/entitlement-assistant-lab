/**
 * The part of the Workers runtime module `cloudflare:workers` the Agents SDK's types name. The runtime provides it;
 * these declarations only let Node's TypeScript check the code that extends it, without the Workers globals (which
 * clash with Node's).
 */
declare module "cloudflare:workers" {
  export abstract class DurableObject<Env = unknown, _Props = unknown> {
    protected ctx: unknown;
    protected env: Env;
    constructor(ctx: unknown, env: Env);
  }
  export abstract class WorkflowEntrypoint<Env = unknown, _Params = unknown> {
    protected env: Env;
    constructor(ctx: unknown, env: Env);
  }
  export class RpcTarget {}
  export type WorkflowEvent<Payload = unknown> = {
    readonly payload: Payload;
    readonly timestamp: Date;
    readonly instanceId: string;
  };
  export type WorkflowSleepDuration = string | number;
  export type WorkflowStep = unknown;
}

declare namespace Cloudflare {
  /** The bindings of a Worker; each Worker names its own. */
  type Env = object;
}
