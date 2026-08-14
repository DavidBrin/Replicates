import "server-only";

import { config } from "@/config/env";
import {
  AiConnector,
  type AiMessage,
  type AiOptions,
  type AiResponse,
  type AiTask,
} from "@/ports/ai";

import { AnthropicConnector } from "./anthropic";
import { OpenAiConnector } from "./openai";

export { AnthropicConnector } from "./anthropic";
export { OpenAiConnector } from "./openai";

/**
 * The connector composition point.
 *
 * Selection is by configured key rather than by a separate switch, so the
 * ordinary case — a fresh clone with no keys — needs no configuration at all
 * and lands on {@link DisabledConnector}.
 */

/**
 * The adapter used when nothing is configured.
 *
 * It exists so that "no API key" is a *rendered state* rather than a thrown
 * error. Every other part of this app can be exercised by someone who has
 * cloned the repository and run one command; the AI panel should be no
 * different — it explains what to set and stays out of the way.
 */
export class DisabledConnector extends AiConnector {
  readonly provider = "none" as const;
  readonly model = "none";
  readonly configured = false;

  async complete(): Promise<AiResponse> {
    return {
      ok: false,
      reason: "unconfigured",
      provider: "none",
      retryable: false,
      message:
        "No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY " +
        "to enable summaries and drafting.",
    };
  }
}

/** Build the connector for a provider, whether or not it has a key. */
export function connectorFor(provider: "anthropic" | "openai"): AiConnector {
  const { ai } = config();
  if (provider === "anthropic") {
    return new AnthropicConnector({ ...ai.anthropic, timeoutMs: ai.timeoutMs });
  }
  return new OpenAiConnector({ ...ai.openai, timeoutMs: ai.timeoutMs });
}

/**
 * The connector this deployment should use.
 *
 * Preference order: the configured default if it has a key, then whichever
 * other provider does, then disabled. Falling through to a provider that *is*
 * configured is the friendlier behaviour — someone who set only
 * `OPENAI_API_KEY` and left `AI_DEFAULT_PROVIDER` at its default should get a
 * working feature, not a message telling them to change a variable they never
 * set.
 */
export function getConnector(): AiConnector {
  const { ai } = config();

  const preferred: ("anthropic" | "openai")[] =
    ai.defaultProvider === "openai"
      ? ["openai", "anthropic"]
      : ["anthropic", "openai"];

  for (const provider of preferred) {
    const connector = connectorFor(provider);
    if (connector.configured) return connector;
  }
  return new DisabledConnector();
}

/* ---------------------------------------------------------------- tasks -- */

/**
 * The prompts, in one place.
 *
 * Kept out of the adapters so that changing what the app asks for never means
 * touching vendor code, and so the two vendors are demonstrably asked the same
 * question — the only way a comparison between them means anything.
 */
const PROMPTS: Record<AiTask, { system: string; instruction: string }> = {
  summarize: {
    system:
      "You summarise software issues for a project tracker. Reply with two to " +
      "four sentences of plain prose. No headings, no bullet points, no " +
      "preamble. State what the issue is about and what remains undecided.",
    instruction: "Summarise this issue:",
  },
  draft_description: {
    system:
      "You draft software issue descriptions for a project tracker. Reply with " +
      "markdown: a short paragraph of context, then a handful of concrete " +
      "acceptance criteria as a list. Do not invent requirements that the " +
      "title does not imply.",
    instruction: "Draft a description for an issue titled:",
  },
  suggest_title: {
    system:
      "You write software issue titles. Reply with a single title under 80 " +
      "characters, in the imperative mood, with no trailing period and no " +
      "surrounding quotes.",
    instruction: "Suggest a title for this issue description:",
  },
};

/** Run one of the app's tasks against the configured connector. */
export async function runAiTask(
  task: AiTask,
  input: string,
  options: AiOptions = {},
): Promise<AiResponse> {
  const connector = getConnector();
  const prompt = PROMPTS[task];
  const messages: AiMessage[] = [
    { role: "user", content: `${prompt.instruction}\n\n${input}` },
  ];
  return connector.complete(messages, { system: prompt.system, ...options });
}
