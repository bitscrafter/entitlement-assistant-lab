import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { type FormEvent, useState } from "react";
import { renewSession } from "./authentication-client.ts";
import { CasePanel } from "./case-panel.tsx";
import { type CaseActionOutcome, setCaseContact, setCaseSubject } from "./cases-client.ts";
import {
  type AccountCard,
  type DetailLine,
  NAME_SEARCH_NOTICE,
  type ReplyPart,
  type ReplyView,
  replyViewOf,
  titleOf,
} from "./reply-details.ts";

/** What the CSR is told when the server closes the connection (api.md §8). */
type Notice = { readonly kind: "info" | "error"; readonly text: string } | null;

/**
 * The chat of one case, over the Agents SDK's client. Every text is rendered as text (React escapes it): no markdown,
 * no links, no images, so a reply or a customer's text cannot load anything (AI_AS_DEVELOPER.md §2, rule 10).
 */
export function CaseChat({
  caseId,
  onSessionEnded,
  onCaseClosed,
}: {
  readonly caseId: string;
  readonly onSessionEnded: () => void;
  /** The case was closed, here or in another tab: it is no longer this CSR's (case-lifecycle D7, D9). */
  readonly onCaseClosed: () => void;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState("");
  const [caseVersion, setCaseVersion] = useState(0);

  const agent = useAgent({
    agent: "case-agent",
    name: caseId,
    onOpen: () => setNotice(null),
    onClose: (event) => {
      switch (event.reason) {
        case "session_expired":
          // The connection lives as long as the token it opened with; renew, and the client reconnects with the new one.
          setNotice({ kind: "info", text: "Reconnecting with your renewed session…" });
          void renewSession().then((renewed) => {
            if (!renewed) onSessionEnded();
          });
          return;
        case "invalid_session":
          agent.close();
          onSessionEnded();
          return;
        case "rate_limited":
          setNotice({
            kind: "error",
            text: "Too many messages in the last minute. Wait a moment, then send again.",
          });
          return;
        case "message_too_big":
          setNotice({ kind: "error", text: "That message is too long. Shorten it and send again." });
          return;
        case "case_unavailable":
          agent.close();
          onCaseClosed();
          return;
      }
    },
  });
  // The agent sends the stored conversation when the connection opens, so nothing is fetched over HTTP.
  const { messages, sendMessage, status } = useAgentChat({ agent, getInitialMessages: null });

  function send() {
    const text = draft.trim();
    if (text === "" || busy) return;
    void sendMessage({ text });
    setDraft("");
  }

  const busy = status === "streaming" || status === "submitted";
  const replies = messages.map((message) =>
    message.role === "user" ? null : replyViewOf(message.parts as readonly ReplyPart[]),
  );
  const draftedSummary = replies.reduce<string | null>(
    (latest, view) => view?.draftedSummary ?? latest,
    null,
  );
  /** A click on a card's button: the endpoint decides; the panel reads the case again. */
  const caseActions: CaseActions = {
    act: async (action) => {
      const outcome: CaseActionOutcome = await action(caseId);
      setNotice(outcome.ok ? null : { kind: "error", text: outcome.message });
      setCaseVersion((version) => version + 1);
    },
  };

  return (
    <div className="case-layout">
      <CasePanel
        caseId={caseId}
        version={caseVersion}
        draftedSummary={draftedSummary}
        onClosed={() => {
          agent.close();
          onCaseClosed();
        }}
      />
      <section className="chat">
        <ol className="messages">
          {messages.map((message, index) => {
            const view = replies[index];
            return (
              <li key={message.id} className={`message ${message.role}`}>
                {view === null || view === undefined ? (
                  <p className="text">{textOf(message.parts as readonly ReplyPart[])}</p>
                ) : (
                  <Reply view={view} actions={caseActions} />
                )}
              </li>
            );
          })}
        </ol>
        {notice !== null && (
          <p
            className={notice.kind === "error" ? "error" : "hint"}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        )}
        <form
          className="composer"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea
            aria-label="Message"
            rows={2}
            maxLength={4000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Cmd+Enter on macOS, Ctrl+Enter elsewhere, sends; Enter alone starts a new line.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Ask about an account, a feature, or a person's access"
          />
          <button type="submit" disabled={busy} title={`Send (${SEND_SHORTCUT})`}>
            Send <kbd>{SEND_SHORTCUT}</kbd>
          </button>
        </form>
      </section>
    </div>
  );
}

/** The case actions a reply's cards offer; each is a click on an endpoint, never the model's (api.md A2). */
interface CaseActions {
  readonly act: (action: (caseId: string) => Promise<CaseActionOutcome>) => Promise<void>;
}

/** The send shortcut as the CSR's platform writes it. */
const SEND_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl+↵";

function textOf(parts: readonly ReplyPart[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function Reply({ view, actions }: { readonly view: ReplyView; readonly actions: CaseActions }) {
  const calls = view.tools.reduce((total, tool) => total + tool.times, 0);
  return (
    <div className="reply">
      {view.tools.length > 0 && (
        <details className="tools">
          <summary>Tools ({calls})</summary>
          <ul>
            {view.tools.map((tool, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a reply's tool list only grows, so a position never changes its call.
              <li key={index}>
                <details>
                  <summary>
                    {tool.toolName} · {tool.state}
                    {tool.times > 1 ? ` ×${tool.times}` : ""}
                  </summary>
                  <pre>{JSON.stringify(tool.input, null, 2)}</pre>
                  {tool.output !== undefined && <pre>{JSON.stringify(tool.output, null, 2)}</pre>}
                  {tool.errorText !== null && <pre>{tool.errorText}</pre>}
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
      {view.text !== "" && (
        <section>
          <h2>Answer</h2>
          <p className="text">{view.text}</p>
        </section>
      )}
      {(view.accounts.length > 0 ||
        view.choices.length > 0 ||
        view.moreMatches ||
        view.nameSearch ||
        view.refusals.length > 0) && (
        <section>
          <h2>Details</h2>
          {view.refusals.map((refusal) => (
            <p key={refusal} className="refusal">
              {refusal}
            </p>
          ))}
          {view.choices.length > 0 && (
            <div className="account">
              <h3>Several accounts match</h3>
              <ul>
                {view.choices.map((choice) => (
                  <li key={choice.accountId}>
                    {choice.displayName} <code>{choice.accountId}</code>
                    {choice.roles.length > 0 ? ` · ${choice.roles.join(", ")}` : ""}
                    {view.ownAccounts.includes(choice.accountId) && (
                      <ContactButton accountId={choice.accountId} actions={actions} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {view.moreMatches && <p className="refusal">More accounts match; refine the query.</p>}
          {view.nameSearch && <p className="notice">{NAME_SEARCH_NOTICE}</p>}
          {view.accounts.map((account) => (
            <AccountDetails
              key={account.accountId}
              account={account}
              proposed={view.proposedSubjects.includes(account.accountId)}
              ownAccount={view.ownAccounts.includes(account.accountId)}
              actions={actions}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function ContactButton({
  accountId,
  actions,
}: {
  readonly accountId: string;
  readonly actions: CaseActions;
}) {
  return (
    <button
      type="button"
      className="secondary inline"
      onClick={() => void actions.act((caseId) => setCaseContact(caseId, accountId))}
    >
      Set as contact
    </button>
  );
}

function AccountDetails({
  account,
  proposed,
  ownAccount,
  actions,
}: {
  readonly account: AccountCard;
  readonly proposed: boolean;
  readonly ownAccount: boolean;
  readonly actions: CaseActions;
}) {
  return (
    <div className="account">
      <h3>
        {account.displayName} <code>{account.accountId}</code>
      </h3>
      {proposed && (
        <button
          type="button"
          className="inline"
          onClick={() => void actions.act((caseId) => setCaseSubject(caseId, account.accountId))}
        >
          Set as case subject
        </button>
      )}
      {ownAccount && <ContactButton accountId={account.accountId} actions={actions} />}
      <dl>
        <dt>Plan</dt>
        <dd>{account.plan ?? "none"}</dd>
        <dt>Term</dt>
        <dd>{account.term ?? "no term covers today"}</dd>
      </dl>
      <ul className="lines">
        {account.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an account's lines only grow within a reply.
          <li key={index} className={lineIncluded(line) ? "included" : "missing"}>
            <DetailLineView line={line} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function lineIncluded(line: DetailLine): boolean {
  if (line.kind === "feature") return line.included;
  if (line.kind === "access") return line.allowed;
  return false;
}

function DetailLineView({ line }: { readonly line: DetailLine }) {
  switch (line.kind) {
    case "feature":
      return line.included ? (
        <>
          ✓ {titleOf(line.featureKey)}
          {line.quota === null ? "" : ` · ${line.quota === "unlimited" ? "unlimited" : line.quota}`} · from{" "}
          {line.sources.join(", ")}
        </>
      ) : (
        <>
          ✗ {titleOf(line.featureKey)} · {line.reasons.join(" ")}
          {line.remedy === null ? "" : ` · ${line.remedy}`}
        </>
      );
    case "nothing-effective":
      return <>✗ Nothing is available · {line.reasons.join(" ")}</>;
    case "access":
      return line.allowed ? (
        <>
          ✓ {line.personEmail} may {line.operation} {titleOf(line.featureKey)} · granted by{" "}
          {line.grantedBy.join(", ")}
        </>
      ) : (
        <>
          ✗ {line.personEmail} may not {line.operation} {titleOf(line.featureKey)} · {line.reasons.join(" ")}
          {line.remedy === null ? "" : ` · ${line.remedy}`}
        </>
      );
  }
}
