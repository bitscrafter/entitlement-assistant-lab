import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  currentPrincipal,
  renewSession,
  type SessionPrincipal,
  signIn,
  signOut,
} from "./authentication-client.ts";
import { CaseChat } from "./case-chat.tsx";
import { openCase } from "./cases-client.ts";

const RENEWAL_INTERVAL_MILLISECONDS = 5 * 60 * 1000;
/** The case the CSR works on, kept for this tab only, so a reload returns to it. */
const CASE_KEY = "entitlement-assistant.case";

type View =
  | { readonly kind: "Loading" }
  | { readonly kind: "SignedOut" }
  | { readonly kind: "SignedIn"; readonly principal: SessionPrincipal };

export function App() {
  const [view, setView] = useState<View>({ kind: "Loading" });

  const refresh = useCallback(async () => {
    const principal = await currentPrincipal();
    setView(principal === null ? { kind: "SignedOut" } : { kind: "SignedIn", principal });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (view.kind !== "SignedIn") return;
    const timer = setInterval(async () => {
      if (!(await renewSession())) setView({ kind: "SignedOut" });
    }, RENEWAL_INTERVAL_MILLISECONDS);
    return () => clearInterval(timer);
  }, [view.kind]);

  switch (view.kind) {
    case "Loading":
      return <main className="page">Loading…</main>;
    case "SignedOut":
      return <SignInForm onSignedIn={refresh} />;
    case "SignedIn":
      return (
        <SignedInPage
          principal={view.principal}
          onSignOut={async () => {
            await signOut();
            sessionStorage.removeItem(CASE_KEY);
            setView({ kind: "SignedOut" });
          }}
          onSessionEnded={() => setView({ kind: "SignedOut" })}
        />
      );
  }
}

function SignInForm({ onSignedIn }: { readonly onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const outcome = await signIn(email, password);
    setBusy(false);
    if (outcome.ok) await onSignedIn();
    else setMessage(outcome.message);
  }

  return (
    <main className="page">
      <form className="card" onSubmit={submit}>
        <h1>Entitlement Assistant</h1>
        <p className="hint">Sign in with your employee account.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {message !== null && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function SignedInPage({
  principal,
  onSignOut,
  onSessionEnded,
}: {
  readonly principal: SessionPrincipal;
  readonly onSignOut: () => Promise<void>;
  readonly onSessionEnded: () => void;
}) {
  const [caseId, setCaseId] = useState<string | null>(() => sessionStorage.getItem(CASE_KEY));
  const [message, setMessage] = useState<string | null>(null);

  async function startCase() {
    setMessage(null);
    const outcome = await openCase();
    if (!outcome.ok) {
      setMessage(outcome.message);
      return;
    }
    sessionStorage.setItem(CASE_KEY, outcome.caseId);
    setCaseId(outcome.caseId);
  }

  return (
    <main className="workspace">
      <header className="bar">
        <span>
          {principal.display_name} · {principal.job_function}, level {principal.job_level}
        </span>
        <span className="actions">
          <button type="button" onClick={() => void startCase()}>
            New case
          </button>
          <button type="button" className="secondary" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </span>
      </header>
      {message !== null && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      {caseId === null ? (
        <p className="hint">Open a case to ask the assistant about a customer's entitlements.</p>
      ) : (
        <CaseChat
          key={caseId}
          caseId={caseId}
          onSessionEnded={onSessionEnded}
          onCaseClosed={() => {
            sessionStorage.removeItem(CASE_KEY);
            setCaseId(null);
            setMessage("The case is closed.");
          }}
        />
      )}
    </main>
  );
}
