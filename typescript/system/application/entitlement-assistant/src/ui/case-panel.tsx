import { type FormEvent, useEffect, useState } from "react";
import {
  authenticateContact,
  type CaseAccount,
  type CaseState,
  closeCase,
  closedCases,
  getCase,
  type PastCase,
} from "./cases-client.ts";

/** The methods the CSR may record in this deployment, by kind (case-lifecycle D4). */
const METHODS = [
  { kind: "Knowledge", method: "SecurityQuestion", label: "Security questions" },
  { kind: "Knowledge", method: "AccountDetails", label: "Account details on file" },
] as const;

/**
 * The case panel (left of the chat): the case's subject, contact, and contact authentication, the close form, and
 * the subject's past cases. Every change is a click that calls an endpoint, then the panel reads the case again
 * (case-lifecycle D16); the assistant can propose, never click (api.md A2). Every text is rendered as text.
 */
export function CasePanel({
  caseId,
  version,
  draftedSummary,
  onClosed,
}: {
  readonly caseId: string;
  /** Changes whenever the chat changed the case (a subject or contact set), so the panel reads it again. */
  readonly version: number;
  readonly draftedSummary: string | null;
  readonly onClosed: () => void;
}) {
  const [state, setState] = useState<CaseState | null>(null);
  const [reads, setReads] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` and `reads` are the triggers to read again.
  useEffect(() => {
    let current = true;
    void getCase(caseId).then((read) => {
      if (current) setState(read);
    });
    return () => {
      current = false;
    };
  }, [caseId, version, reads]);

  const reread = () => setReads((count) => count + 1);
  const outcome = (result: { ok: true } | { ok: false; message: string }) => {
    setMessage(result.ok ? null : result.message);
    reread();
  };

  if (state === null) return <aside className="case-panel">Loading the case…</aside>;
  return (
    <aside className="case-panel">
      <h2>Case</h2>
      <p className="hint">
        <code>{state.case_id}</code> · opened {state.opened_at.slice(11, 16)}
      </p>
      {message !== null && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      <section>
        <h3>Subject</h3>
        {state.subject === null ? (
          <p className="hint">Not set. The assistant proposes one; set it from its card.</p>
        ) : (
          <AccountSummary account={state.subject} />
        )}
      </section>
      <section>
        <h3>Contact</h3>
        {state.contact === null ? (
          <p className="hint">Not set. Look the person up by email, then set them from their card.</p>
        ) : (
          <AccountSummary account={state.contact} />
        )}
      </section>
      {state.contact !== null && (
        <Authentication
          state={state}
          onRecord={async (kind, method, passed) =>
            outcome(await authenticateContact(caseId, kind, method, passed))
          }
        />
      )}
      <CloseForm
        draftedSummary={draftedSummary}
        onClose={async (reason, summary) => {
          const result = await closeCase(caseId, reason, summary);
          if (result.ok) onClosed();
          else setMessage(result.message);
        }}
      />
      {state.subject?.readable === true && (
        <PastCases accountId={state.subject.account_id} name={state.subject.display_name} />
      )}
    </aside>
  );
}

function AccountSummary({ account }: { readonly account: CaseAccount }) {
  if (!account.readable)
    return (
      <p className="hint">
        <code>{account.account_id}</code> · you may not read this account now
      </p>
    );
  return (
    <dl>
      <dt>Name</dt>
      <dd>
        {account.display_name} <code>{account.account_id}</code>
      </dd>
      <dt>Holds</dt>
      <dd className={account.holds.length > 0 ? "refusal" : undefined}>
        {account.holds.length > 0 ? account.holds.join(", ") : "none"}
      </dd>
      {account.roles_in_subject !== undefined && (
        <>
          <dt>Roles in the subject</dt>
          <dd>
            {account.roles_in_subject === null
              ? "not shown"
              : account.roles_in_subject.length > 0
                ? account.roles_in_subject.join(", ")
                : "none"}
          </dd>
        </>
      )}
    </dl>
  );
}

function Authentication({
  state,
  onRecord,
}: {
  readonly state: CaseState;
  readonly onRecord: (kind: string, method: string, passed: boolean) => Promise<void>;
}) {
  const [choice, setChoice] = useState(0);
  const authentication = state.contact_authentication;
  const expired = authentication !== null && new Date(authentication.expires_at).getTime() <= Date.now();
  const selected = METHODS[choice] ?? METHODS[0];
  return (
    <section>
      <h3>Contact authentication</h3>
      {authentication === null ? (
        <p className="hint">Not authenticated.</p>
      ) : (
        <p className={expired ? "refusal" : undefined}>
          {authentication.kind} · {authentication.method} · {authentication.authenticated_at.slice(11, 16)} ·{" "}
          {expired ? "expired" : "expires"} {authentication.expires_at.slice(11, 16)}
        </p>
      )}
      <label>
        Method
        <select value={choice} onChange={(event) => setChoice(Number(event.target.value))}>
          {METHODS.map((method, index) => (
            <option key={method.method} value={index}>
              {method.label}
            </option>
          ))}
        </select>
      </label>
      <span className="actions">
        <button type="button" onClick={() => void onRecord(selected.kind, selected.method, true)}>
          Passed
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void onRecord(selected.kind, selected.method, false)}
        >
          Failed
        </button>
      </span>
    </section>
  );
}

function CloseForm({
  draftedSummary,
  onClose,
}: {
  readonly draftedSummary: string | null;
  readonly onClose: (reason: string, summary: string) => Promise<void>;
}) {
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("Resolved");
  return (
    <form
      className="close-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onClose(reason, summary.trim());
      }}
    >
      <h3>Close</h3>
      {draftedSummary !== null && (
        <button type="button" className="secondary" onClick={() => setSummary(draftedSummary)}>
          Use the assistant's draft
        </button>
      )}
      <p className="hint">
        Anyone who may read the subject account reads this summary: keep it about the subject only.
      </p>
      <label>
        Summary (reviewed by you)
        <textarea
          rows={4}
          maxLength={4000}
          required
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </label>
      <label>
        Reason
        <select value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="Resolved">Resolved</option>
          <option value="Abandoned">Abandoned</option>
        </select>
      </label>
      <button type="submit" disabled={summary.trim() === ""}>
        Close case
      </button>
    </form>
  );
}

function PastCases({ accountId, name }: { readonly accountId: string; readonly name: string }) {
  const [cases, setCases] = useState<readonly PastCase[]>([]);
  useEffect(() => {
    void closedCases(accountId).then(setCases);
  }, [accountId]);
  if (cases.length === 0) return null;
  return (
    <section>
      <h3>Past cases of {name}</h3>
      <ul className="past-cases">
        {cases.map((past) => (
          <li key={past.case_id}>
            {past.closed_at.slice(0, 16).replace("T", " ")} · {past.close_reason} ·{" "}
            {past.closed_by.display_name ?? past.closed_by.account_id}
            <p className="text">{past.summary}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
