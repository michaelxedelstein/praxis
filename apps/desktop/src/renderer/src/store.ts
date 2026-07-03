/**
 * Renderer state hooks over the `window.praxis` bridge. Keeps subscriptions in
 * one place so components stay declarative. No business logic here — just live
 * mirrors of what main pushes.
 */
import { useEffect, useState } from "react";
import type {
  AgentRecord,
  ConfirmRequestEvent,
  DisplayInfo,
  PraxisStatus,
  ProjectGraph,
  TaskRecord,
} from "../../shared/ipc.js";

export function useStatus(): PraxisStatus | null {
  const [status, setStatus] = useState<PraxisStatus | null>(null);
  useEffect(() => {
    void window.praxis.getStatus().then(setStatus);
    return window.praxis.onStatusUpdated(setStatus);
  }, []);
  return status;
}

export function useProjectGraph(): { graph: ProjectGraph; refresh: () => void; loading: boolean } {
  const [graph, setGraph] = useState<ProjectGraph>({ nodes: [], links: [], updatedAt: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void window.praxis.listProjects().then((g) => {
      setGraph(g);
      setLoading(false);
    });
    return window.praxis.onProjectsUpdated((g) => {
      setGraph(g);
      setLoading(false);
    });
  }, []);

  const refresh = (): void => {
    setLoading(true);
    void window.praxis.refreshProjects().then((g) => {
      setGraph(g);
      setLoading(false);
    });
  };
  return { graph, refresh, loading };
}

export function useTasks(): TaskRecord[] {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  useEffect(() => {
    void window.praxis.listTasks().then(setTasks);
    return window.praxis.onTasksUpdated(setTasks);
  }, []);
  return tasks;
}

export function useAgents(): AgentRecord[] {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  useEffect(() => {
    void window.praxis.listAgents().then(setAgents);
    return window.praxis.onAgentsUpdated(setAgents);
  }, []);
  return agents;
}

export function useDisplayInfo(): DisplayInfo | null {
  const [info, setInfo] = useState<DisplayInfo | null>(null);
  useEffect(() => {
    void window.praxis.getDisplayInfo().then(setInfo);
    return window.praxis.onLayoutChanged(setInfo);
  }, []);
  return info;
}

export function useConfirms(): ConfirmRequestEvent[] {
  const [confirms, setConfirms] = useState<ConfirmRequestEvent[]>([]);
  useEffect(() => {
    return window.praxis.onConfirmRequest((e) => setConfirms((c) => [...c, e]));
  }, []);
  return confirms;
}

export function resolveConfirm(id: string, approved: boolean): void {
  void window.praxis.confirmResolve({ id, approved });
}

/** Read the ?view= query the window manager attaches per satellite window. */
export function currentView(): "hive" | "conversation" | "tasks" {
  const v = new URLSearchParams(window.location.search).get("view");
  return v === "conversation" || v === "tasks" ? v : "hive";
}
