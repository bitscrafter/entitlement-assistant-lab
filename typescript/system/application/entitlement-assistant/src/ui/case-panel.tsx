import { type FormEvent, useEffect, useRef, useState } from "react";
import { caseGuidance } from "./case-guidance.ts";
import {
  type AccountSearch,
  authenticateContact,
  type CaseAccount,
  type CaseState,
  closeCase,
  closedCases,
  getCase,
  type PastCase,
  searchAccounts,
  setCaseContact,
  setCaseSubject,
} from "./cases-client.ts";
import { NAME_SEARCH_NOTICE } from "./reply-details.ts";

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
  const [, setNow] = useState(0);
  // The guidance depends on the time: re-render when the authentication expires (D20; review R3-2).
  const expiresAt = state?.contact_authentication?.expires_at ?? null;
  useEffect(() => {
    if (expiresAt === null) return;
    const delay = new Date(expiresAt).getTime() - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), delay + 500);
    return () => clearTimeout(timer);
  }, [expiresAt]);
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
      {caseGuidance(state, new Date()).map((line) => (
        <p key={line} className="guidance" role="note">
          {line}
        </p>
      ))}
      <AccountFinder
        onSetSubject={async (accountId) => outcome(await setCaseSubject(caseId, accountId))}
        onSetContact={async (accountId) => outcome(await setCaseContact(caseId, accountId))}
        subjectSet={state.subject !== null}
      />
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

/**
 * The case panel's account search (case-lifecycle D18): the assistant's lookup, without the assistant. Every
 * button calls an endpoint, which decides; a contact must be a person's own account (D3).
 */
function AccountFinder({
  onSetSubject,
  onSetContact,
  subjectSet,
}: {
  readonly onSetSubject: (accountId: string) => Promise<void>;
  readonly onSetContact: (accountId: string) => Promise<void>;
  readonly subjectSet: boolean;
}) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [search, setSearch] = useState<AccountSearch | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const latest = useRef(0);

  async function find(event: FormEvent) {
    event.preventDefault();
    const submission = ++latest.current;
    const outcome = await searchAccounts(query.trim());
    // An answer to an older search arriving late is ignored (review R3-4).
    if (submission !== latest.current) return;
    setSearched(query.trim());
    setSearch(outcome.ok ? outcome.search : null);
    setMessage(outcome.ok ? null : outcome.message);
  }

  const byEmail = searched?.includes("@") === true;
  const byName = searched !== null && !byEmail && !searched.startsWith("acc_");
  const rows =
    search === null
      ? []
      : search.result === "found"
        ? [
            {
              account_id: search.account.account_id,
              display_name: search.account.display_name,
              own: byEmail,
              roles: [],
            },
          ]
        : search.candidates.map((candidate) => ({
            account_id: candidate.account_id,
            display_name: candidate.display_name,
            own: candidate.own_account,
            roles: candidate.roles,
          }));
  return (
    <section>
      <h3>Find an account</h3>
      <form className="finder" onSubmit={find}>
        <input
          aria-label="Account id, email, or part of a name"
          placeholder="Account id, email, or part of a name"
          maxLength={320}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={query.trim().length < 3}>
          Find
        </button>
      </form>
      {message !== null && <p className="refusal">{message}</p>}
      {rows.length > 0 && (
        <ul className="finder-results">
          {rows.map((row) => (
            <li key={row.account_id}>
              {row.display_name} <code>{row.account_id}</code>
              {row.roles.length > 0 ? ` · ${row.roles.join(", ")}` : ""}
              {!subjectSet && (
                <button type="button" className="inline" onClick={() => void onSetSubject(row.account_id)}>
                  Set as case subject
                </button>
              )}
              {row.own && (
                <button
                  type="button"
                  className="secondary inline"
                  onClick={() => void onSetContact(row.account_id)}
                >
                  Set as contact
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {search?.result === "ambiguous" && search.more_matches && (
        <p className="refusal">More accounts match; refine the query.</p>
      )}
      {byName && search !== null && <p className="notice">{NAME_SEARCH_NOTICE}</p>}
    </section>
  );
}
