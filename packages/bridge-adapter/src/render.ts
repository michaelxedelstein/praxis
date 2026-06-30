/**
 * Pure rendering of a StructuredTask into the cursor-slack-bridge's text
 * contract. Kept side-effect-free so it can be unit-tested without Slack.
 *
 * The bridge triggers on its `app_mention` handler, so the message must contain
 * the bridge bot's mention token. Leading slash-directives it understands:
 *   /plan, /ask  (read-only modes)   and   /model <phrase>
 * Default (edit) mode adds no directive.
 */
import type { StructuredTask } from "@praxis/shared-types";

/** Channel name the bridge maps to a local repo: `proj-<project>`. */
export function channelNameForProject(project: string): string {
  const slug = project
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `proj-${slug}`;
}

export interface RenderOptions {
  /** The bridge bot's Slack user id; when present we @-mention to trigger it. */
  bridgeBotId?: string;
}

/** Render the task into the exact message text to post into the channel. */
export function renderTaskMessage(task: StructuredTask, opts: RenderOptions = {}): string {
  const directives: string[] = [];
  if (task.mode === "plan") directives.push("/plan");
  else if (task.mode === "ask") directives.push("/ask");
  if (task.model) directives.push(`/model ${task.model}`);

  const mention = opts.bridgeBotId ? `<@${opts.bridgeBotId}> ` : "";
  const head = `${mention}${directives.join(" ")}${directives.length ? " " : ""}${task.instruction.trim()}`;

  if (task.context && task.context.trim()) {
    return `${head}\n\nContext:\n${task.context.trim()}`;
  }
  return head;
}
