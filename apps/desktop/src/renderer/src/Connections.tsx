/**
 * Connections — the connect-card UI for MCP services discovered by the importer.
 * Services already wired through Cursor config show as connected; plugin-backed
 * ones that need a key show a form where you drop it in once (stored locally,
 * never in the repo). Restart applies newly connected servers to the brain.
 */
import { useEffect, useState } from "react";
import type { McpConnectionInfo } from "../../shared/ipc.js";

function Card({ conn, onSaved }: { conn: McpConnectionInfo; onSaved: (list: McpConnectionInfo[]) => void }): JSX.Element {
  const [env, setEnv] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = async (enabled: boolean): Promise<void> => {
    setSaving(true);
    const list = await window.praxis.saveMcpConnection({ id: conn.id, env, enabled });
    onSaved(list);
    setSaving(false);
  };

  return (
    <div className={`conn-card ${conn.status}`}>
      <div className="conn-top">
        <span className="conn-title">{conn.title}</span>
        <span className={`conn-status ${conn.status}`}>{conn.status}</span>
      </div>
      {conn.detail && <p className="conn-detail">{conn.detail}</p>}
      {conn.status === "needs-key" && (
        <div className="conn-form">
          {conn.requiredEnv.map((name) => (
            <label key={name}>
              <span>{name}</span>
              <input
                type="password"
                value={env[name] ?? ""}
                onChange={(e) => setEnv((s) => ({ ...s, [name]: e.target.value }))}
                placeholder={name}
              />
            </label>
          ))}
          <button className="primary" disabled={saving} onClick={() => void save(true)}>
            {saving ? "Saving…" : "Connect"}
          </button>
        </div>
      )}
      {conn.status === "needs-auth" && (
        <div className="conn-form">
          <button className="primary" disabled={saving} onClick={() => void save(true)}>
            {saving ? "Enabling…" : "Connect (opens browser)"}
          </button>
        </div>
      )}
      {conn.status === "connected" && conn.source === "plugin-catalog" && (
        <button className="link-btn" onClick={() => void save(false)}>Disable</button>
      )}
      {conn.status === "disabled" && (
        <button className="link-btn" onClick={() => void save(true)}>Enable</button>
      )}
    </div>
  );
}

export function Connections({ onClose }: { onClose: () => void }): JSX.Element {
  const [list, setList] = useState<McpConnectionInfo[]>([]);

  useEffect(() => {
    void window.praxis.listMcpConnections().then(setList);
  }, []);

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="connections" onClick={(e) => e.stopPropagation()}>
        <header className="conn-head">
          <h2>Connections</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </header>
        <p className="hint">
          Tools you use in Cursor, mapped to public MCP servers. Connected ones are live now; anything
          needing a key or browser sign-in stays off until you connect it here, and applies after a restart.
        </p>
        <div className="conn-grid">
          {list.map((c) => (
            <Card key={c.id} conn={c} onSaved={setList} />
          ))}
        </div>
      </div>
    </div>
  );
}
