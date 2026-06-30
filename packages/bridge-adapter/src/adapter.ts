/**
 * SlackBridgeAdapter — the one clean entry point the brain calls to dispatch
 * work: `dispatchTask(task)`. Internally it posts a bridge-formatted message
 * into `#proj-<project>` via the Slack Web API; the cursor-slack-bridge running
 * on the Mac picks it up independently and runs `cursor-agent` in the repo.
 *
 * This is the §12.1 "Slack-routed" path: the dispatcher (desktop OR relay) only
 * needs a Slack token — it never touches the local machine directly.
 */
import { WebClient } from "@slack/web-api";
import type { DispatchResult, StructuredTask } from "@praxis/shared-types";
import { channelNameForProject, renderTaskMessage } from "./render.js";

export interface SlackBridgeAdapterOptions {
  /** Slack bot/user token Praxis posts with (xoxb-/xoxp-). */
  token: string;
  /**
   * The cursor-slack-bridge bot's user id. Used to @-mention it so the bridge's
   * `app_mention` handler fires. Strongly recommended; without it the message is
   * posted un-mentioned and the bridge will likely ignore it.
   */
  bridgeBotId?: string;
  /** Inject a pre-built client (tests). */
  client?: WebClient;
  /** Optional logger. */
  log?: (msg: string) => void;
}

export class SlackBridgeAdapter {
  private readonly client: WebClient;
  private readonly bridgeBotId?: string;
  private readonly log: (msg: string) => void;
  /** name → channel id cache to avoid re-listing on every dispatch. */
  private channelCache = new Map<string, string>();

  constructor(opts: SlackBridgeAdapterOptions) {
    this.client = opts.client ?? new WebClient(opts.token);
    this.bridgeBotId = opts.bridgeBotId;
    this.log = opts.log ?? (() => {});
  }

  async dispatchTask(task: StructuredTask): Promise<DispatchResult> {
    const channelName = channelNameForProject(task.project);
    try {
      const channelId = await this.resolveChannelId(channelName);
      if (!channelId) {
        return {
          ok: false,
          detail: `No Slack channel #${channelName} found. Create it (the bridge auto-joins proj-* channels) and retry.`,
        };
      }
      const text = renderTaskMessage(task, { bridgeBotId: this.bridgeBotId });
      const res = await this.client.chat.postMessage({ channel: channelId, text });
      this.log(`Dispatched task to #${channelName} (${channelId})`);
      return {
        ok: true,
        channelId,
        messageTs: res.ts,
        detail: this.bridgeBotId
          ? undefined
          : "Posted without a bridge mention (bridgeBotId unset); the bridge may not pick it up.",
      };
    } catch (err) {
      const detail = (err as Error).message;
      this.log(`Dispatch to #${channelName} failed: ${detail}`);
      return { ok: false, detail };
    }
  }

  /** Find the channel id for a `proj-*` name, caching across calls. */
  private async resolveChannelId(name: string): Promise<string | null> {
    const cached = this.channelCache.get(name);
    if (cached) return cached;

    let cursor: string | undefined;
    do {
      const res = await this.client.conversations.list({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      });
      for (const ch of res.channels ?? []) {
        if (ch.name && ch.id) this.channelCache.set(ch.name, ch.id);
        if (ch.name === name && ch.id) return ch.id;
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return this.channelCache.get(name) ?? null;
  }
}
