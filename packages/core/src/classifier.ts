/**
 * Lightweight intent heuristic + model picker.
 *
 * The *authoritative* chat-vs-task decision is made inside the loop: the model
 * decides whether to call `dispatch_task`. This heuristic exists only to (a)
 * pick which model to start the turn on — a fast model for obvious chit-chat, a
 * reasoning model when the turn smells like real work — and (b) provide a cheap,
 * deterministic signal for tests/telemetry.
 */
import type { BrainConfig } from "./config.js";

const WORK_VERBS =
  /\b(add|build|create|implement|fix|change|update|refactor|remove|delete|rename|wire|set ?up|integrate|deploy|write|make (?:a|an|the)|generate|migrate|hook up)\b/i;

const QUESTION_LEAD =
  /^(what|what's|whats|how|how's|hows|why|when|where|who|which|did|do|does|is|are|can you (tell|show|explain|recap|summar)|tell me|show me|recap|summar|catch me up|status)/i;

/** Returns true when the utterance looks like a request to do work. */
export function looksLikeWork(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // A leading question almost always means "chat", even if a work verb appears.
  if (QUESTION_LEAD.test(t) && !WORK_VERBS.test(t)) return false;
  return WORK_VERBS.test(t);
}

/** Pick the starting model for a turn. The loop may still chain tools either way. */
export function pickModel(text: string, config: BrainConfig): string {
  return looksLikeWork(text) ? config.reasoningModel : config.chatModel;
}
