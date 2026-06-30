/**
 * BrainClient — a small typed WebSocket client for talking to the headless
 * brain from Node (the desktop main process when pointed at a remote relay, or
 * scripts/tests). Browser and React Native surfaces implement their own using
 * the shared codec, but the protocol is identical.
 */
import WebSocket from "ws";
import type { ServerMessage, TurnResult } from "@praxis/shared-types";
import { encode, decodeServerMessage } from "./codec.js";

export interface BrainClientOptions {
  /** wss://… endpoint of the brain. */
  url: string;
  /** PRAXIS_AUTH_SECRET — sent as a bearer token + query param. */
  secret: string;
  onStatus?: (id: string, detail: string) => void;
  onError?: (message: string, id?: string) => void;
}

interface Pending {
  resolve: (r: TurnResult) => void;
  reject: (e: Error) => void;
}

export class BrainClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private readonly opts: BrainClientOptions;

  constructor(opts: BrainClientOptions) {
    this.opts = opts;
  }

  connect(): Promise<void> {
    const sep = this.opts.url.includes("?") ? "&" : "?";
    const url = `${this.opts.url}${sep}token=${encodeURIComponent(this.opts.secret)}`;
    this.ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.opts.secret}` },
    });

    return new Promise((resolve, reject) => {
      const ws = this.ws!;
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
      ws.on("message", (data) => this.handleMessage(data.toString()));
      ws.on("close", () => {
        for (const [, p] of this.pending) p.reject(new Error("connection closed"));
        this.pending.clear();
      });
    });
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = decodeServerMessage(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "status":
        this.opts.onStatus?.(msg.id, msg.detail);
        break;
      case "reply": {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.resolve(msg.result);
        }
        break;
      }
      case "error": {
        this.opts.onError?.(msg.message, msg.id);
        if (msg.id) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p.reject(new Error(msg.message));
          }
        }
        break;
      }
      case "pong":
        break;
    }
  }

  /** Send a transcribed utterance and await the brain's spoken-style reply. */
  send(text: string): Promise<TurnResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    const id = `c${++this.seq}`;
    return new Promise<TurnResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(encode({ type: "utterance", id, text }));
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
