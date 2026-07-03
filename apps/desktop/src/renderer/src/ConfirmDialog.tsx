/**
 * ConfirmDialog — surfaces destructive-action approvals the brain/sub-agents
 * request (e.g. deleting a file, sending an iMessage). One at a time, on top.
 */
import { useConfirms, resolveConfirm } from "./store.js";
import { useState } from "react";

export function ConfirmDialog(): JSX.Element | null {
  const confirms = useConfirms();
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const pending = confirms.find((c) => !handled.has(c.id));
  if (!pending) return null;

  const resolve = (approved: boolean): void => {
    resolveConfirm(pending.id, approved);
    setHandled((h) => new Set(h).add(pending.id));
  };

  return (
    <div className="confirm-overlay">
      <div className="confirm">
        <div className="confirm-title">Confirm action</div>
        <p>{pending.description}</p>
        <div className="confirm-actions">
          <button onClick={() => resolve(false)}>Cancel</button>
          <button className="primary danger" onClick={() => resolve(true)}>Approve</button>
        </div>
      </div>
    </div>
  );
}
