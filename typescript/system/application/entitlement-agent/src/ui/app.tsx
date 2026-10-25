import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  currentPrincipal,
  renewSession,
  type SessionPrincipal,
  signIn,
  signOut,
} from "./authentication-client.ts";

const RENEWAL_INTERVAL_MILLISECONDS = 5 * 60 * 1000;

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
            setView({ kind: "SignedOut" });
          }}
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
        <h1>Entitlement Agent</h1>
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
}: {
  readonly principal: SessionPrincipal;
  readonly onSignOut: () => Promise<void>;
}) {
  return (
    <main className="page">
      <section className="card">
        <h1>Signed in as {principal.display_name}</h1>
        <dl>
          <dt>Department</dt>
          <dd>{principal.department}</dd>
          <dt>Job function</dt>
          <dd>
            {principal.job_function}, level {principal.job_level}
          </dd>
          <dt>Roles</dt>
          <dd>{principal.roles.join(", ")}</dd>
        </dl>
        <button type="button" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </section>
    </main>
  );
}
