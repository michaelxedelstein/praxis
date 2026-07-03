/**
 * App — the Jarvis command center shell.
 *
 * The main window renders the full dashboard: the hive-mind constellation with
 * a selectable repo panel, a global voice HUD, the task board, and launchers
 * for the tool palette and connections. Satellite windows (opened when you
 * expand across monitors) render a single focused view via the ?view= param.
 */
import { useEffect, useState } from "react";
import { HiveMind } from "./HiveMind.js";
import { RepoPanel } from "./RepoPanel.js";
import { TaskBoard } from "./TaskBoard.js";
import { ToolPalette } from "./ToolPalette.js";
import { Connections } from "./Connections.js";
import { Conversation } from "./Conversation.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import {
  currentView,
  useDisplayInfo,
  useProjectGraph,
  useStatus,
  useTasks,
} from "./store.js";

export function App(): JSX.Element {
  const view = currentView();
  const status = useStatus();
  const canVoice = Boolean(status?.hasVoice);

  // Satellite windows render one focused surface.
  if (view === "conversation") {
    return (
      <div className="satellite">
        <Conversation canVoice={canVoice} />
        <ConfirmDialog />
      </div>
    );
  }
  if (view === "tasks") {
    return (
      <div className="satellite">
        <TaskBoard />
        <ConfirmDialog />
      </div>
    );
  }

  return <Dashboard />;
}

function Dashboard(): JSX.Element {
  const status = useStatus();
  const { graph, refresh, loading } = useProjectGraph();
  const tasks = useTasks();
  const display = useDisplayInfo();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [showTasks, setShowTasks] = useState(true);

  const canVoice = Boolean(status?.hasVoice);
  const expanded = display?.layout === "expanded";

  // Global summon + Cmd+K palette.
  useEffect(() => {
    const off = window.praxis.onSummon(() => setSelectedId(null));
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((s) => !s);
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setShowPalette(false);
        setShowConnections(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      off();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const toggleLayout = (): void => {
    void window.praxis.setLayout(expanded ? "collapsed" : "expanded");
  };

  return (
    <div className="app jarvis">
      <header className="topbar">
        <span className="brand">PRAXIS</span>
        <span className={`dot ${status?.brainReady ? "ok" : "warn"}`} title="brain status" />
        <span className="tool-count">{status?.toolCount ?? 0} tools</span>
        <div className="spacer" />
        <button className="link-btn" onClick={() => setShowPalette(true)}>Tools (⌘K)</button>
        <button className="link-btn" onClick={() => setShowConnections(true)}>Connections</button>
        <button className="link-btn" onClick={() => setShowTasks((s) => !s)}>
          {showTasks ? "Hide board" : "Show board"}
        </button>
        <button className="link-btn" onClick={() => refresh()} disabled={loading}>
          {loading ? "Scanning…" : "Refresh"}
        </button>
        <button className="link-btn" onClick={toggleLayout}>
          {expanded ? "Collapse" : "Expand"}{display && display.displayCount > 1 ? "" : ""}
        </button>
      </header>

      <div className="stage">
        <div className="hive-wrap">
          <HiveMind graph={graph} tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
          {graph.nodes.length === 0 && (
            <div className="hive-empty">
              {loading ? "Mapping your projects…" : "No projects found. Check PRAXIS_PROJECT_ROOTS."}
            </div>
          )}
          <div className="hive-legend">
            <span><i className="swatch cyan" /> local</span>
            <span><i className="swatch amber" /> uncommitted</span>
            <span><i className="swatch violet" /> GitHub-only</span>
          </div>
        </div>

        {selectedId && (
          <RepoPanel projectId={selectedId} canVoice={canVoice} onClose={() => setSelectedId(null)} />
        )}

        {showTasks && !selectedId && (
          <aside className="board-dock">
            <TaskBoard />
          </aside>
        )}
      </div>

      {!selectedId && (
        <div className="global-hud">
          <Conversation canVoice={canVoice} compact />
        </div>
      )}

      {showPalette && <ToolPalette onClose={() => setShowPalette(false)} />}
      {showConnections && <Connections onClose={() => setShowConnections(false)} />}
      <ConfirmDialog />
    </div>
  );
}
