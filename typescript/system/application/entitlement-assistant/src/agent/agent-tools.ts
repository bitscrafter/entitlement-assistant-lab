import { jsonSchema, type Tool, tool } from "../../../../external/ai.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { CaseWorkUseCases } from "../case-work-use-cases.ts";
import { CASE_TOOLS } from "./tools.ts";

/** A tool's refusal of its arguments: shown to the model as written, unlike an unexpected failure. */
export class ToolRefusal extends Error {
  override readonly name = "ToolRefusal";
}

/**
 * The message the model and the browser may see for a failed tool call or turn: a refusal of the arguments as written
 * (by the tool or by the SDK's input check), anything else only as a generic message naming the trace id.
 */
export function shownToolError(error: unknown, traceId: string): string {
  if (error instanceof Error && (error.name === "ToolRefusal" || error.name === "AI_InvalidToolInputError"))
    return error.message;
  return `The assistant could not answer (trace ${traceId}).`;
}

export interface AgentToolContext {
  readonly caseId: Uuid;
  /** The connection's session: who asks, from the verified token, never from the model (api.md §9). */
  readonly actor: () => { readonly principalAccountId: Uuid; readonly sessionId: Uuid };
  readonly runUseCases: <Value>(work: (useCases: CaseWorkUseCases) => Promise<Value>) => Promise<Value>;
  readonly describeReason: (reasonCode: string) => string;
  readonly newTraceId: () => string;
  /** Records a tool failure for the operators; nothing about it reaches the model or the browser. */
  readonly logFailure: (failure: {
    readonly traceId: string;
    readonly toolName: string;
    readonly message: string;
  }) => void;
}

/**
 * The case tools as AI SDK tools: each validates its arguments strictly and calls one use case (A1).
 *
 * @ensures Arguments are checked by the tool's own strict schema; a refusal reaches the model as the tool's error.
 * @ensures A tool that fails unexpectedly reaches the model only as a generic error naming its trace id.
 */
export function agentTools(context: AgentToolContext): Record<string, Tool> {
  return Object.fromEntries(
    Object.values(CASE_TOOLS).map((caseTool) => [
      caseTool.definition.name,
      tool({
        description: caseTool.definition.description,
        inputSchema: jsonSchema(caseTool.definition.parameters as never),
        execute: async (input: unknown, { toolCallId }: { toolCallId: string }) => {
          const traceId = context.newTraceId();
          const actor = context.actor();
          let outcome: Awaited<ReturnType<typeof caseTool.run>>;
          try {
            outcome = await caseTool.run(input, {
              request: { ...actor, caseId: context.caseId, toolCallId, traceId },
              runUseCases: context.runUseCases,
              describeReason: context.describeReason,
            });
          } catch (error) {
            context.logFailure({ traceId, toolName: caseTool.definition.name, message: String(error) });
            throw new Error(`The tool could not complete (trace ${traceId}).`);
          }
          if ("errorText" in outcome) throw new ToolRefusal(outcome.errorText);
          return outcome.output;
        },
      }) as Tool,
    ]),
  );
}
