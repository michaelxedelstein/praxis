/**
 * RepoPanel — the detail view that slides in when you select a node. Shows the
 * repo's vitals, quick actions (Cursor / Finder / GitHub), a dispatch box, and
 * a project-scoped conversation grounded in that repo's files.
 */
import { useEffect, useState } from "react";
import type { TaskMode } from "@praxis/shared-types";
import type { ProjectDetail } from "../../shared/ipc.js";
import { Conversation } from "./Conversation.js";

export function RepoPanel({
  projectId,
  canVoice,
  onClose,
}: {
  projectId: string;
  canVoice: boolean;
  onClose: () => void;
}): JSX.Element {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState<TaskMode>("edit");
  const [dispatchMsg, setDispatchMsg] = useState<string>("");

  useEffect(() => {
    setDetail(null);
    void window.praxis.getProjectDetail(projectId).then(setDetail);
  }, [projectId]);

  const node = detail?.node;
  const shortName = node?.name ?? projectId;

  const dispatch = async (): Promise<void> => {
    if (!instruction.trim()) return;
    setDispatchMsg("dispatching…");
    const res = await window.praxis.dispatchTask({ project: shortName, instruction, mode });
    setDispatchMsg(res.ok ? `Sent to #proj-${shortName}.` : `Failed: ${res.detail ?? "unknown"}`);
    if (res.ok) setInstruction("");
  };

  return (
    <aside className="repo-panel">
      <header className="repo-head">
        <div>
          <h2>{shortName}</h2>
          {node && (
            <div className="repo-sub">
              <span className={`chip ${node.kind}`}>{node.kind}</span>
              {node.branch && <span className="chip">{node.branch}{node.dirty ? " •" : ""}</span>}
              {node.language && <span className="chip">{node.language}</span>}
              {node.github?.stars != null && <span className="chip">★ {node.github.stars}</span>}
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} title="Close">✕</button>
      </header>

      <div className="repo-actions">
        {node?.path && (
          <>
            <button onClick={() => void window.praxis.projectAction({ id: projectId, action: "openInCursor" })}>
              Open in Cursor
            </button>
            <button onClick={() => void window.praxis.projectAction({ id: projectId, action: "revealInFinder" })}>
              Reveal in Finder
            </button>
          </>
        )}
        {node?.github?.url && (
          <button onClick={() => void window.praxis.projectAction({ id: projectId, action: "openGitHub" })}>
            Open on GitHub
          </button>
        )}
      </div>

      <div className="dispatch-box">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={`Dispatch a task to ${shortName} (runs via Cursor Bridge)…`}
          rows={2}
        />
        <div className="dispatch-row">
          <select value={mode} onChange={(e) => setMode(e.target.value as TaskMode)}>
            <option value="edit">edit</option>
            <option value="plan">plan</option>
            <option value="ask">ask</option>
          </select>
          <button className="primary" onClick={() => void dispatch()}>Dispatch</button>
          {dispatchMsg && <span className="dispatch-msg">{dispatchMsg}</span>}
        </div>
      </div>

      {detail && detail.commits.length > 0 && (
        <details className="repo-commits">
          <summary>Recent commits</summary>
          <ul>
            {detail.commits.slice(0, 6).map((c) => (
              <li key={c.hash}>
                <code>{c.hash}</code> {c.subject}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="repo-chat">
        <div className="section-title">Talk about {shortName}</div>
        <Conversation projectId={projectId} canVoice={canVoice} compact />
      </div>
    </aside>
  );
}
