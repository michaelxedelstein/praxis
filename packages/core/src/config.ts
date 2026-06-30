/**
 * Brain configuration. Models are selectable (never hardcoded to one): a
 * high-reasoning model drives autonomous, multi-step loops; a faster model
 * handles quick conversational turns. Both come from env/config.
 */
import { z } from "zod";

export const BrainConfigSchema = z.object({
  /** High-reasoning model for autonomous tool-chaining loops (Opus-class). */
  reasoningModel: z.string().default("claude-opus-4-20250514"),
  /** Faster model for quick conversational turns (Sonnet-class). */
  chatModel: z.string().default("claude-sonnet-4-20250514"),
  /** Max tokens per LLM response. */
  maxTokens: z.number().int().positive().default(2048),
  /** Hard cap on tool-execution rounds before forcing a final answer. */
  maxToolRounds: z.number().int().positive().default(8),
  /** The name the persona addresses the user by. */
  userName: z.string().default("Michael"),
  /** Default project used when the user doesn't name one for a task. */
  defaultProject: z.string().optional(),
});

export type BrainConfig = z.infer<typeof BrainConfigSchema>;

/** Build a validated config from partial overrides (env-derived, usually). */
export function resolveBrainConfig(overrides: Partial<BrainConfig> = {}): BrainConfig {
  return BrainConfigSchema.parse(overrides);
}
