import { jsonSchema, type Tool, tool } from "../../../../external/ai.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { CaseWorkUseCases } from "../case-work-use-cases.ts";
import { CASE_TOOLS } from "./tools.ts";

/** A tool's refusal of its arguments: shown to the model as written, unlike an unexpected failure. */
export class ToolRefusal extends Error {
  override readonly name = "ToolRefusal";
  readonly toolName: string;

  constructor(message: string, toolName: string) {
    super(message);
    this.toolName = toolName;
  }
}

const isRefusal = (error: unknown): error is Error =>
  error instanceof Error && (error.name === "ToolRefusal" || error.name === "AI_InvalidToolInputError");

/**
 * The message the model and the browser may see for a failed tool call or turn: a refusal of the arguments as written
 * (by the tool or by the SDK's input check), anything else only as a generic message naming the trace id.
 */
export function shownToolError(error: unknown, traceId: string): string {
  if (isRefusal(error)) return error.message;
  return `The assistant could not answer (trace ${traceId}).`;
}

/**
 * The operators' log line for an error of a turn. A refused argument is not a failure, and its message quotes the
 * arguments (customer emails among them), so only the tool's name is logged.
 *
 * @ensures A refusal logs `tool-arguments-refused` with the trace id and the tool's name, never its message.
 * @ensures Anything else logs `case-agent-turn-failed` with the trace id and the error's message.
 */
export function turnErrorLogOf(error: unknown, traceId: string): Readonly<Record<string, string | null>> {
  if (isRefusal(error)) {
    const toolName = (error as { readonly toolName?: unknown }).toolName;
    return { log: "tool-arguments-refused", traceId, tool: typeof toolName === "string" ? toolName : null };
  }
  return { log: "case-agent-turn-failed", traceId, message: String(error) };
}

export interface AgentToolContext {
  readonly caseId: Uuid;
  /** The connection's session: who asks, from the verified token, never from the model (api.md §9). */
  readonly actor: () => { readonly principalAccountId: Uuid; readonly sessionId: Uuid };
  readonly runUseCases: <Value>(work: (useCases: CaseWorkUseCases) => Promise<Value>) => Promise<Value>;
  readonly describeReason: (reasonCode: string) => string;
  readonly newTraceId: () => string;
  /** Whether the case is still open and assigned to the actor: a turn under way when it closed stops (review R4). */
  readonly caseStillAssigned: () => Promise<boolean>;
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
 * @ensures In a case no longer open and assigned to the actor, no tool runs: a refusal instead.
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
            // Inside the try: a failing check is a failure like any other, never its message (review R2-1).
            outcome = !(await context.caseStillAssigned())
              ? { errorText: "This case is closed." }
              : await caseTool.run(input, {
                  request: { ...actor, caseId: context.caseId, toolCallId, traceId },
                  runUseCases: context.runUseCases,
                  describeReason: context.describeReason,
                });
          } catch (error) {
            context.logFailure({ traceId, toolName: caseTool.definition.name, message: String(error) });
            throw new Error(`The tool could not complete (trace ${traceId}).`);
          }
          if ("errorText" in outcome) throw new ToolRefusal(outcome.errorText, caseTool.definition.name);
          return outcome.output;
        },
      }) as Tool,
    ]),
  );
}
