/**
 * TaskBoard — live view of everything dispatched to the Cursor Bridge and every
 * sub-agent the conductor is running. Doubles as a satellite-window view.
 */
import { useAgents, useTasks } from "./store.js";
import type { AgentRecord, TaskRecord } from "../../shared/ipc.js";

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function TaskItem({ t }: { t: TaskRecord }): JSX.Element {
  return (
    <div className={`task-item status-${t.status}`}>
      <div className="task-top">
        <span className="task-proj">#{t.project}</span>
        <span className={`task-status ${t.status}`}>{t.status}</span>
      </div>
      <div className="task-instr">{t.instruction}</div>
      <div className="task-meta">
        {t.source} · {ago(t.createdAt)}
        {t.detail ? ` · ${t.detail}` : ""}
      </div>
    </div>
  );
}

function AgentItem({ a }: { a: AgentRecord }): JSX.Element {
  const last = a.transcript[a.transcript.length - 1];
  return (
    <div className={`task-item status-${a.status}`}>
      <div className="task-top">
        <span className="task-proj">{a.title}</span>
        <span className={`task-status ${a.status}`}>{a.status}</span>
      </div>
      <div className="task-instr">{a.result ?? last?.text ?? "working…"}</div>
      <div className="task-meta">sub-agent · {ago(a.createdAt)}</div>
    </div>
  );
}

export function TaskBoard(): JSX.Element {
  const tasks = useTasks();
  const agents = useAgents();

  return (
    <div className="task-board">
      <div className="section-title">Sub-agents</div>
      {agents.length === 0 && <p className="hint">No sub-agents running.</p>}
      {agents.map((a) => (
        <AgentItem key={a.id} a={a} />
      ))}

      <div className="section-title">Dispatched tasks</div>
      {tasks.length === 0 && <p className="hint">Nothing dispatched yet.</p>}
      {tasks.map((t) => (
        <TaskItem key={t.id} t={t} />
      ))}
    </div>
  );
}
