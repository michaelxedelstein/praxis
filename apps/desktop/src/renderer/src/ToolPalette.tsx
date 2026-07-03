/**
 * ToolPalette — a Cmd+K launcher over every MCP tool the brain has. Search,
 * pick a tool, fill its top-level string args, and run it directly. Results
 * show inline. Auto-generated from the live tool list, so any MCP you connect
 * shows up here with no extra code.
 */
import { useEffect, useMemo, useState } from "react";
import type { RunToolResult, ToolInfo } from "../../shared/ipc.js";

export function ToolPalette({ onClose }: { onClose: () => void }): JSX.Element {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ToolInfo | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RunToolResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void window.praxis.listTools().then(setTools);
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return tools
      .filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      .slice(0, 40);
  }, [tools, query]);

  const fields = useMemo(() => {
    if (!selected) return [] as Array<{ name: string; required: boolean; desc?: string }>;
    const schema = selected.inputSchema as {
      properties?: Record<string, { description?: string }>;
      required?: string[];
    };
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    return Object.entries(props).map(([name, def]) => ({
      name,
      required: required.has(name),
      desc: def.description,
    }));
  }, [selected]);

  const run = async (): Promise<void> => {
    if (!selected) return;
    setRunning(true);
    setResult(null);
    // Coerce numeric-looking strings; leave everything else as-is.
    const parsed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (v === "") continue;
      parsed[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    }
    const res = await window.praxis.runTool({ name: selected.name, args: parsed });
    setResult(res);
    setRunning(false);
  };

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        {!selected ? (
          <>
            <input
              autoFocus
              className="palette-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools…"
            />
            <div className="palette-list">
              {filtered.map((t) => (
                <button key={t.name} className="palette-item" onClick={() => setSelected(t)}>
                  <span className="palette-name">{t.name}</span>
                  <span className="palette-desc">{t.description}</span>
                </button>
              ))}
              {filtered.length === 0 && <p className="hint">No tools match. Connect more in Connections.</p>}
            </div>
          </>
        ) : (
          <>
            <div className="palette-head">
              <button className="icon-btn" onClick={() => { setSelected(null); setResult(null); setArgs({}); }}>←</button>
              <span className="palette-name">{selected.name}</span>
            </div>
            <p className="palette-desc">{selected.description}</p>
            <div className="palette-form">
              {fields.map((f) => (
                <label key={f.name}>
                  <span>{f.name}{f.required ? " *" : ""}</span>
                  <input
                    value={args[f.name] ?? ""}
                    onChange={(e) => setArgs((a) => ({ ...a, [f.name]: e.target.value }))}
                    placeholder={f.desc ?? ""}
                  />
                </label>
              ))}
              {fields.length === 0 && <p className="hint">No arguments.</p>}
            </div>
            <button className="primary" disabled={running} onClick={() => void run()}>
              {running ? "Running…" : "Run tool"}
            </button>
            {result && (
              <pre className={`palette-result ${result.isError ? "err" : ""}`}>{result.text}</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
