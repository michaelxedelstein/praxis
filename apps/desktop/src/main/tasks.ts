/**
 * TaskStore — an in-memory record of every task dispatched to the Cursor Bridge
 * (by you, the brain, or a sub-agent), so the hive can show a live pulse on the
 * node and a task board. Emits on change for the renderer to re-render.
 */
import type { DispatchResult, StructuredTask } from "@praxis/shared-types";
import type { TaskRecord, TaskStatus } from "../shared/ipc.js";

let seq = 1;

export class TaskStore {
  private tasks: TaskRecord[] = [];
  private readonly listeners = new Set<(tasks: TaskRecord[]) => void>();

  onChange(cb: (tasks: TaskRecord[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  list(): TaskRecord[] {
    return [...this.tasks].sort((a, b) => b.createdAt - a.createdAt);
  }

  record(
    task: StructuredTask,
    result: DispatchResult,
    source: TaskRecord["source"],
  ): TaskRecord {
    const now = Date.now();
    const rec: TaskRecord = {
      id: `task-${seq++}`,
      project: task.project,
      instruction: task.instruction,
      status: result.ok ? "dispatched" : "failed",
      source,
      createdAt: now,
      updatedAt: now,
      channelId: result.channelId,
      messageTs: result.messageTs,
      detail: result.detail,
    };
    this.tasks.push(rec);
    this.emit();
    return rec;
  }

  update(id: string, status: TaskStatus, detail?: string): void {
    const rec = this.tasks.find((t) => t.id === id);
    if (!rec) return;
    rec.status = status;
    if (detail) rec.detail = detail;
    rec.updatedAt = Date.now();
    this.emit();
  }

  private emit(): void {
    const snap = this.list();
    for (const l of this.listeners) l(snap);
  }
}
