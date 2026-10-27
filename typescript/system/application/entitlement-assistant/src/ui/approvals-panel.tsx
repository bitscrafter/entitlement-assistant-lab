import { useCallback, useEffect, useState } from "react";
import { type DenialReason, decideApproval, listApprovals, type PendingApproval } from "./changes-client.ts";
import { titleOf } from "./reply-details.ts";

/** How often the panel reads the pending approvals again (grants-and-approvals D7). */
const REFRESH_MILLISECONDS = 30 * 1000;

const DENIAL_REASONS: readonly { readonly value: DenialReason; readonly label: string }[] = [
  { value: "PolicyLimit", label: "Policy limit" },
  { value: "InsufficientJustification", label: "Insufficient justification" },
  { value: "CustomerNotEligible", label: "Customer not eligible" },
  { value: "Other", label: "Other (comment needed)" },
];

const KIND_WORDS: Readonly<Record<string, string>> = {
  CreateGrant: "Grant",
  ExtendGrant: "Extend grant",
  RevokeGrant: "Revoke grant",
};

/**
 * The approvals panel (SU-12, grants-and-approvals D7): a collapsible section at the top of the workspace, shown only
 * when the server lists approvals for the signed-in employee (holders of `approval.decide`), with how many are
 * pending; read again every 30 seconds and after each decision.
 */
export function ApprovalsPanel() {
  const [approvals, setApprovals] = useState<readonly PendingApproval[] | null>(null);
  const [mayDecide, setMayDecide] = useState(true);

  const reload = useCallback(async () => {
    const listed = await listApprovals();
    if (listed === null) setMayDecide(false);
    setApprovals(listed);
  }, []);

  useEffect(() => {
    if (!mayDecide) return;
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MILLISECONDS);
    return () => clearInterval(timer);
  }, [mayDecide, reload]);

  if (!mayDecide || approvals === null) return null;
  return (
    <details className="approvals">
      <summary>Approvals ({approvals.length} pending)</summary>
      {approvals.length === 0 ? (
        <p className="hint">Nothing waits for a decision.</p>
      ) : (
        <ul>
          {approvals.map((approval) => (
            <ApprovalRow key={approval.approval_id} approval={approval} onDecided={reload} />
          ))}
        </ul>
      )}
    </details>
  );
}

function ApprovalRow({
  approval,
  onDecided,
}: {
  readonly approval: PendingApproval;
  readonly onDecided: () => Promise<void>;
}) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState<DenialReason>("PolicyLimit");
  const [comment, setComment] = useState("");
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [working, setWorking] = useState(false);
  const parameters = approval.parameters;
  const featureKey = typeof parameters.feature_key === "string" ? parameters.feature_key : null;
  const days = typeof parameters.duration_days === "number" ? parameters.duration_days : null;
  const asked = [
    featureKey === null ? String(parameters.grant_id ?? "") : titleOf(featureKey),
    typeof parameters.quota === "number" ? `+${parameters.quota}` : "",
    days === null ? "" : `${days} ${days === 1 ? "day" : "days"}`,
  ].filter((part) => part !== "");

  async function decide(
    decision:
      | { readonly decision: "Approved" }
      | {
          readonly decision: "Denied";
          readonly decision_reason: DenialReason;
          readonly decision_comment?: string;
        },
  ) {
    setWorking(true);
    const outcome = await decideApproval(approval.approval_id, decision);
    setMessages(outcome.ok ? [] : outcome.messages);
    setWorking(false);
    if (outcome.ok) await onDecided();
  }

  return (
    <li className="approval">
      <h3>
        {KIND_WORDS[approval.change_kind] ?? "Change"}: {asked.join(" · ")}
      </h3>
      <p>
        {approval.subject.display_name ?? "An account"} <code>{approval.subject.account_id}</code>
      </p>
      <p className="reason">Reason: {String(parameters.reason ?? "")}</p>
      <p className="hint">
        Requested by {approval.requested_by.display_name ?? approval.requested_by.account_id}
        {approval.confirmed_by === null
          ? ""
          : `, confirmed by ${approval.confirmed_by.display_name ?? approval.confirmed_by.account_id}`}
        {" · "}decide before {approval.expires_at.slice(0, 16).replace("T", " ")} UTC
      </p>
      {approval.preview_reasons.length > 0 && (
        <p className="hint">
          Why it needs approval: {approval.preview_reasons.map((r) => r.description).join(" ")}
        </p>
      )}
      {messages.map((message) => (
        <p key={message} className="error" role="alert">
          {message}
        </p>
      ))}
      {denying ? (
        <div className="row-actions">
          <select
            aria-label="Denial reason"
            value={reason}
            onChange={(event) => setReason(event.target.value as DenialReason)}
          >
            {DENIAL_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Comment"
            maxLength={1000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={reason === "Other" ? "Comment (required)" : "Comment (optional)"}
          />
          <button
            type="button"
            className="inline"
            disabled={working || (reason === "Other" && comment.trim() === "")}
            onClick={() =>
              void decide({
                decision: "Denied",
                decision_reason: reason,
                ...(comment.trim() === "" ? {} : { decision_comment: comment.trim() }),
              })
            }
          >
            Deny
          </button>
          <button type="button" className="secondary inline" onClick={() => setDenying(false)}>
            Back
          </button>
        </div>
      ) : (
        <div className="row-actions">
          <button
            type="button"
            className="inline"
            disabled={working}
            onClick={() => void decide({ decision: "Approved" })}
          >
            Approve
          </button>
          <button
            type="button"
            className="secondary inline"
            disabled={working}
            onClick={() => setDenying(true)}
          >
            Deny…
          </button>
        </div>
      )}
    </li>
  );
}
