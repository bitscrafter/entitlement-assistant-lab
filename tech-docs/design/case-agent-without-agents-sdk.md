# The Case Agent Without the Agents SDK

| | |
| :--- | :--- |
| **Purpose** | Describes, in full, how the case agent is built on Cloudflare's plain Durable Object and WebSocket APIs instead of the Agents SDK: what each SDK feature becomes, what it costs, and how to move between the two. The chosen design is the hardened `AIChatAgent` (CM-18); this is its documented alternative. |
| **Status** | Alternative, not built in the application. An implementation of it was built and tested during the explain-access feature before CM-18 was decided (records: discoveries 7, 20–23 in [`../features/explain-access/workflow/discoveries.md`](../features/explain-access/workflow/discoveries.md)). |
| **References** | • Decision: [CM-18](../adr/common.md#cm-18-the-case-agent-is-a-hardened-aichatagent)<br>• Connection sequence: [`../diagrams/agent-connection.sequence.puml`](../diagrams/agent-connection.sequence.puml)<br>• API: [`../api/api.md`](../api/api.md) §8, §9<br>• Glossary: [`../entitlement-assistant-proposal.md`](../entitlement-assistant-proposal.md) §4 (case agent, WebSocket message guard, HTTP request guard) |

## Contents

1. [When this alternative fits](#1-when-this-alternative-fits)
2. [What the Agents SDK provides to the case agent](#2-what-the-agents-sdk-provides-to-the-case-agent)
3. [The shape of the alternative](#3-the-shape-of-the-alternative)
4. [Each SDK feature, without the SDK](#4-each-sdk-feature-without-the-sdk)
5. [Code](#5-code)
6. [Security](#6-security)
7. [Testing](#7-testing)
8. [What is given up](#8-what-is-given-up)
9. [The middle option: the SDK's base `Agent` class](#9-the-middle-option-the-sdks-base-agent-class)
10. [Moving between the designs](#10-moving-between-the-designs)
11. [Comparison](#11-comparison)

---

## 1. When this alternative fits

- **Fewer dependencies matter more than features.** The server needs only the Workers runtime and the AI SDK: no
  `agents`, no `@cloudflare/ai-chat`, and none of the three MCP packages the SDK requires.
- **The chat protocol must be fully owned.** Every frame the server accepts is one the application defined; nothing
  is accepted by default.
- **The SDK's features are not needed:** resumable streams, live updates across tabs, client-side tools, MCP,
  scheduling helpers.
- **Tests must run the agent without the Workers runtime.** The agent's logic is a plain class, tested in Node
  against the real database.

It fits less when the platform's own agent framework is expected, when a CSR works in several tabs at once, or when
replies are long enough that a dropped connection should resume mid-stream.

## 2. What the Agents SDK provides to the case agent

| SDK part | What it does for the case agent |
| --- | --- |
| `getAgentByName`, `routeAgentRequest` | Finds the Durable Object of a case by name and routes `/agents/<class>/<name>` to it. |
| `Agent` (base class) | The Durable Object lifecycle; connections as objects with server-side per-connection state; WebSocket hibernation; `schedule()` for delayed work; a SQL helper. |
| `Agent` state sync | A shared state object, broadcast to clients and writable by them (`setState`); refused by the case agent. |
| `AIChatAgent` | The chat protocol over the WebSocket; message storage; resumable streams; broadcasting each turn to every connection; tool continuations, client tools, and tool approvals. |
| `getCurrentAgent()` | The current agent and connection inside a turn, so a tool knows which connection asked. |
| `useAgent`, `useAgentChat` (client) | The browser side: connection with reconnects, the chat state, restoring messages. |

## 3. The shape of the alternative

```text
Browser ── WebSocket ──► Worker (HTTP request guard: HTTPS, origin, session, principal, assignee)
                            │  builds a fresh request: handshake headers + verified session header
                            ▼
                         CaseAgentObject  (plain Durable Object, WebSocket hibernation API)
                            │  accept, attach the session to the socket, schedule the expiry alarm
                            ▼
                         CaseAgent  (plain TypeScript class, no runtime or SDK import)
                            ├─ WebSocket message guard: size, kind, rate, expiry, principal
                            ├─ tool loop: LanguageModel port, at most 5 steps per message
                            ├─ tools: the four strict tool runners → use cases
                            └─ CaseConversationStore port (Durable Object storage)
```

The case agent's behavior lives in the plain class; the Durable Object only adapts the runtime's events
(`fetch`, `webSocketMessage`, `webSocketClose`, `alarm`) to it. Three ports separate it from the platform:

| Port | Production adapter | Test adapter |
| --- | --- | --- |
| `LanguageModel`: one model step (text and tool calls) for a conversation | the AI SDK's `generateText` with the Workers AI provider, tools declared without `execute` so the agent runs them | a scripted model |
| `CaseConversationStore`: the turns of the case, as the server recorded them | the Durable Object's storage | in memory |
| `MessageRateLimiter` (shared with the chosen design) | a Durable Object per employee | in memory |

## 4. Each SDK feature, without the SDK

| Feature | Without the SDK |
| --- | --- |
| **Routing** | The Worker already routes `GET /agents/case-agent/{case_id}` after its own checks; it reaches the case's object with `namespace.idFromName(caseId)` and `get(id).fetch(request)`. |
| **Connection and its session** | The object creates a `WebSocketPair`, calls `ctx.acceptWebSocket(server)`, and stores the verified session on the socket with `serializeAttachment`. The attachment is server-side and survives hibernation; the browser cannot write it. |
| **Hibernation** | When the object wakes for a message, it rebuilds the plain agent and re-attaches every open socket from `ctx.getWebSockets()` and `deserializeAttachment()`. |
| **Token expiry (D6)** | The agent reports `nextAlarmAt()` (the earliest expiry of an open connection); the object sets `ctx.storage.setAlarm()` to it after every connect, message, and close; `alarm()` closes expired connections with `4401 session_expired`. |
| **Conversation storage** | `CaseConversationStore` over `ctx.storage` (key-value, or SQLite through `ctx.storage.sql` for long conversations). Written only by the agent, after a turn. |
| **Chat protocol, inbound** | The agent reads one message type, `cf_agent_use_chat_request`, and from it only the newest user message's text. Every other message is ignored. |
| **Chat protocol, outbound** | The agent writes the frames the SDK's client understands: `cf_agent_use_chat_response` carrying AI SDK UI stream chunks (`start`, `start-step`, `text-start`, `text-delta`, `text-end`, `tool-input-available`, `tool-output-available`, `tool-output-error`, `finish-step`, `finish`), a final `done: true` frame, and `cf_agent_chat_messages` with the stored conversation when a connection opens. |
| **Tool loop** | The agent calls the model one step at a time, runs the tool calls itself, appends the results, and stops when a step has no tool calls or after five steps. |
| **Current connection in a tool** | Not needed: the agent passes the connection's principal into each tool call directly. |
| **Rate limit (D13)** | The same `MessageRateLimiter` Durable Object as in the chosen design. |
| **Multi-tab updates** | Not built; added by sending each turn's frames to every open connection of the case. |
| **Resumable streams** | Not built; a dropped connection sees the full reply when it reconnects, once the turn is stored. |
| **Client** | Either the SDK's client, which works with these frames, or a small client of the application's own. |

## 5. Code

The parts that differ from the chosen design, as they were built.

**Handing the upgrade to the case's object** (the Worker; identical in spirit to CM-18): only the handshake headers
and the verified session are forwarded, never the client's headers.

```ts
export function forwardToCaseAgent(namespace, request, caseId, session) {
  const headers = new Headers({ Upgrade: "websocket", Connection: "Upgrade" });
  for (const name of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("x-connection-session", JSON.stringify({ caseId, ...session }));
  return namespace.get(namespace.idFromName(caseId)).fetch(new Request("https://case-agent.internal/connect", { headers }));
}
```

**Accepting a connection** (the Durable Object):

```ts
async fetch(request) {
  const forwarded = JSON.parse(request.headers.get("x-connection-session"));
  await this.state.storage.put("case_id", forwarded.caseId);
  const pair = new WebSocketPair();
  const stored = { connectionId: crypto.randomUUID(), principalAccountId: forwarded.principalAccountId,
                   sessionId: forwarded.sessionId, expiresAt: forwarded.expiresAt };
  this.state.acceptWebSocket(pair[1]);
  pair[1].serializeAttachment(stored);            // server-side, survives hibernation
  const agent = await this.caseAgent();
  await agent.connect(connectionOf(pair[1], stored), sessionOf(stored));   // sends the stored conversation
  await this.scheduleAlarm(agent);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

async webSocketMessage(socket, message) {
  const agent = await this.caseAgent();             // rebuilt after hibernation, sockets re-attached
  await agent.receive(connectionOf(socket, socket.deserializeAttachment()), message);
  await this.scheduleAlarm(agent);
}

async alarm() {
  const agent = await this.caseAgent();
  await agent.alarm();                              // closes connections whose token expired: 4401
  await this.scheduleAlarm(agent);
}
```

**One message** (the plain agent): the guard, then a bounded tool loop.

```ts
async receive(connection, frame) {
  if (byteLength(frame) > 16 * 1024) return close(connection, 1009, "message_too_big");
  const message = newestUserMessageOf(frame);        // null for every other message type
  if (message === null) return;
  if (await rateLimiter.attempt(principal, now) === "Refused") return close(connection, 4429, "rate_limited");
  if (now >= session.expiresAt) return close(connection, 4401, "session_expired");
  if (!(await principalMayAct(principal))) return close(connection, 4401, "invalid_session");
  const messages = [...storedConversationAsModelMessages(), { role: "user", text: message.text }];
  for (let step = 0; step < 5; step += 1) {
    const answer = await languageModel.respond({ instructions, messages, tools });
    send text and tool-call chunks;
    for (const call of answer.toolCalls) send the tool's output or error chunk, append it to messages;
    if (answer.toolCalls.length === 0) break;
  }
  send "finish" and the done frame; store the user turn and the assistant's steps;
}
```

## 6. Security

| Concern | Without the SDK | Hardened `AIChatAgent` (CM-18) |
| --- | --- | --- |
| History sent by the browser | Never read: the agent reads only the newest message's text. | Replaced by the guard with the stored conversation before the SDK sees it. |
| Clear chat, tool results, approvals, state writes | No handler exists for them. | Dropped by the guard; state writes also refused by `validateStateChange`. |
| Where the guarantees live | In the agent, by construction. | In the guard, in front of SDK code that would otherwise accept these frames. |
| Exposure to SDK changes | None. | An SDK release that changes how `AIChatAgent` installs `onMessage` could bypass the guard; the hardening tests in the Workers runtime must pass before an upgrade. |
| Dependencies on the server | The AI SDK and its Workers AI provider. | Also `agents`, `@cloudflare/ai-chat`, and three MCP packages. |

Both designs share the HTTP request guard, the forwarded session header, the per-message principal re-check, and the
use cases' own decisions: in both, the model never authorizes anything.

## 7. Testing

- **The agent is a plain class.** Every `[agent]` scenario runs in Node against the real PostgreSQL, with the scripted
  model and in-memory adapters for the rate limiter and the conversation store. Each test takes milliseconds.
- **The Durable Object is a thin adapter.** Its events are tested in the Workers runtime through Wrangler's test
  harness, which bundles the database driver (`pg` cannot be loaded by the Workers test plugin, spike K2).
- **Hibernation can be unit-tested** with a fake of the small runtime surface the object uses (`acceptWebSocket`,
  `getWebSockets`, attachments, `setAlarm`), which the SDK's classes do not allow.

With the SDK, the agent runs only in the Workers runtime, so its scenarios run there, each against a fresh Worker,
with test controls inside the agent (discovery 25).

## 8. What is given up

| Lost | Effect | Way back |
| --- | --- | --- |
| Resumable streams | A connection dropped mid-reply does not resume the stream; the reply appears when it reconnects, once stored. | Buffer the turn's chunks and replay them to a reconnecting socket. |
| Live updates across tabs | A second tab shows new turns only when it reconnects. | Send each turn's frames to every open connection. |
| `useAgentChat` as-is | The SDK's client works with the frames above, but nothing guarantees it stays compatible. | A small client of the application's own (about 100 lines). |
| The protocol is the application's to maintain | About 200 lines that follow the SDK's frame format. | — |
| The platform's expected framework | A reader expecting the Agents SDK does not see it. | CM-18. |

## 9. The middle option: the SDK's base `Agent` class

Extending `Agent` without `AIChatAgent` keeps the SDK's routing (`getAgentByName`), connection objects with
server-side state, hibernation, and `schedule()`, and leaves the chat handling to the application, as in §4. It does
not take the browser's history, because there is no chat layer; its state sync still has to be refused
(`validateStateChange`), and it still needs the SDK's MCP packages.

## 10. Moving between the designs

Only the agent's adapter changes; the use cases, the decision point, the tools' strict runners, the WebSocket message guard's
checks, the HTTP request guard, and the rate limiter stay.

| From CM-18 to this alternative | Change |
| --- | --- |
| `src/durable-objects.ts` | `CaseAgentObject` becomes a plain Durable Object (§5) over a plain `CaseAgent` class. |
| `src/agent/` | The guard's checks move into `CaseAgent.receive`; the tool loop replaces `streamText`; the tool runners are called directly. |
| Ports | `LanguageModel` and `CaseConversationStore` return, with their adapters (§3). |
| Tests | The `[agent]` scenarios move back to Node, against the plain class; the runtime tests keep the handshake, the reconnect, and the forged session header. |
| Dependencies | `agents`, `@cloudflare/ai-chat`, and the MCP packages are removed. |

## 11. Comparison

| | Without the SDK | Hardened `AIChatAgent` (chosen) |
| --- | --- | --- |
| Uses the platform's agent framework | no | yes |
| Browser-supplied history | impossible by construction | refused by the guard |
| Resumable streams, multi-tab updates | to build | included |
| Client | SDK client or own | `useAgentChat` |
| Server dependencies | AI SDK only | AI SDK, Agents SDK, `@cloudflare/ai-chat`, MCP packages |
| Agent scenarios run in | Node (milliseconds) | the Workers runtime (about half a second each) |
| Hibernation testable locally | yes, with a fake runtime | no |
| Exposure to SDK internals | none | how `AIChatAgent` installs `onMessage` |
| Code to maintain | protocol and Durable Object adapter (about 400 lines) | the guard and the subclass (about 250 lines) |
