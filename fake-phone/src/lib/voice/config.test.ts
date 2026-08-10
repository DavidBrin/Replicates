// @vitest-environment node

/**
 * `config.ts` imports `server-only`, whose sole export throws outside a
 * React-server module resolution. Mocking the bare specifier is the standard
 * way to test a server module — and it keeps the real marker in place for the
 * build, which is what stops a component importing this file.
 */
vi.mock("server-only", () => ({}));

import { describe, expect, it, vi } from "vitest";

import {
  API_KEY_ENV_VARS,
  DEFAULT_MAX_DURATION_SECONDS,
  DEFAULT_MAX_TOKENS,
  IMPLEMENTED_AI_PROVIDERS,
  describeVoiceConfig,
  hasModelClient,
  isConfigured,
  readVoiceConfig,
  type VoiceEnv,
} from "./config";
import { MAX_TOKENS_PER_TURN, WRAP_UP_SECONDS, WRAP_UP_TOKENS } from "./requests";

const SECRET = "sk-ant-do-not-leak-me-0123456789";

describe("readVoiceConfig", () => {
  it("ships inert: a completely empty environment resolves to the scripted tier", () => {
    const config = readVoiceConfig({});

    expect(config.voiceProvider).toBe("scripted");
    expect(config.hasApiKey).toBe(false);
    expect(isConfigured(config)).toBe(false);
  });

  it("uses the documented defaults for the cost guardrails", () => {
    const config = readVoiceConfig({});

    expect(config.maxDurationSeconds).toBe(DEFAULT_MAX_DURATION_SECONDS);
    expect(config.maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("treats adding a key as the only step needed to light the AI tier up", () => {
    const config = readVoiceConfig({ ANTHROPIC_API_KEY: SECRET });

    expect(config.voiceProvider).toBe("ai");
    expect(config.hasApiKey).toBe(true);
    expect(isConfigured(config)).toBe(true);
  });

  it("treats an empty-string key exactly like an unset one", () => {
    expect(isConfigured(readVoiceConfig({ ANTHROPIC_API_KEY: "" }))).toBe(false);
    expect(isConfigured(readVoiceConfig({ ANTHROPIC_API_KEY: "   " }))).toBe(false);
  });

  it("honours VOICE_PROVIDER=scripted as a kill switch even with a key present", () => {
    const config = readVoiceConfig({
      ANTHROPIC_API_KEY: SECRET,
      VOICE_PROVIDER: "scripted",
    });

    expect(config.voiceProvider).toBe("scripted");
    expect(config.hasApiKey).toBe(true);
    expect(isConfigured(config)).toBe(false);
  });

  it("only counts the selected provider's key", () => {
    const config = readVoiceConfig({
      AI_PROVIDER: "openai",
      ANTHROPIC_API_KEY: SECRET,
    });

    expect(config.aiProvider).toBe("openai");
    expect(config.hasApiKey).toBe(false);
    expect(isConfigured(config)).toBe(false);
  });

  it("is unconfigured for a provider this build has no client for, key or not", () => {
    // `openai` is a declared seam (SPEC §3.4) with no implementation. Saying so
    // here is what makes `/turn` fail fast and typed rather than throwing out of
    // the model resolver as an untyped 500 halfway through a call.
    const config = readVoiceConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-openai-configured-but-unbuilt",
    });

    expect(config.aiProvider).toBe("openai");
    expect(config.hasApiKey).toBe(true);
    expect(hasModelClient("openai")).toBe(false);
    expect(isConfigured(config)).toBe(false);
  });

  it("names the providers it can actually call", () => {
    expect(IMPLEMENTED_AI_PROVIDERS).toEqual(["anthropic"]);
    expect(hasModelClient("anthropic")).toBe(true);
  });

  it("names the env var per provider without ever exposing a value", () => {
    expect(API_KEY_ENV_VARS.anthropic).toBe("ANTHROPIC_API_KEY");
    expect(API_KEY_ENV_VARS.openai).toBe("OPENAI_API_KEY");
  });

  it("repairs rather than throws on nonsense values", () => {
    const config = readVoiceConfig({
      VOICE_PROVIDER: "telepathy",
      AI_PROVIDER: "definitely-not-a-vendor",
      VOICE_CALL_MAX_DURATION_SECONDS: "banana",
      VOICE_CALL_MAX_TOKENS: "-17",
    });

    expect(config.voiceProvider).toBe("scripted");
    expect(config.aiProvider).toBe("anthropic");
    expect(config.maxDurationSeconds).toBe(DEFAULT_MAX_DURATION_SECONDS);
    expect(config.maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("clamps out-of-range guardrails back to the defaults", () => {
    const config = readVoiceConfig({
      VOICE_CALL_MAX_DURATION_SECONDS: "99999",
      VOICE_CALL_MAX_TOKENS: "999999",
    });

    expect(config.maxDurationSeconds).toBe(DEFAULT_MAX_DURATION_SECONDS);
    expect(config.maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("accepts in-range overrides", () => {
    const config = readVoiceConfig({
      VOICE_CALL_MAX_DURATION_SECONDS: "90",
      VOICE_CALL_MAX_TOKENS: "1200",
    });

    expect(config.maxDurationSeconds).toBe(90);
    expect(config.maxTokens).toBe(1200);
  });

  it("refuses a budget that would be spent before the first line", () => {
    // The old floors (15s, 64 tokens) sat *below* the wrap-up margins, so those
    // configurations were capped from turn one: the caller spoke the wrap-up
    // line and the model was never called at all. A budget that cannot buy a
    // call is not a smaller budget, it is a broken one — so it falls back to the
    // documented default rather than being honoured.
    const config = readVoiceConfig({
      VOICE_CALL_MAX_DURATION_SECONDS: String(WRAP_UP_SECONDS),
      VOICE_CALL_MAX_TOKENS: String(WRAP_UP_TOKENS),
    });

    expect(config.maxDurationSeconds).toBe(DEFAULT_MAX_DURATION_SECONDS);
    expect(config.maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("keeps every accepted budget clear of the wrap-up margins", () => {
    // The smallest thing the schema will accept must still leave room for one
    // real turn on top of the margin that ends the call in persona.
    const smallest = readVoiceConfig({
      VOICE_CALL_MAX_DURATION_SECONDS: String(WRAP_UP_SECONDS * 2),
      VOICE_CALL_MAX_TOKENS: String(WRAP_UP_TOKENS + MAX_TOKENS_PER_TURN),
    });

    expect(smallest.maxDurationSeconds).toBeGreaterThan(WRAP_UP_SECONDS);
    expect(smallest.maxTokens).toBeGreaterThan(WRAP_UP_TOKENS);
    // i.e. a turn starting at zero elapsed and zero spent is not already capped.
    expect(0 >= smallest.maxDurationSeconds - WRAP_UP_SECONDS).toBe(false);
    expect(0 >= smallest.maxTokens - WRAP_UP_TOKENS).toBe(false);
  });

  it("never puts the key on the config object", () => {
    const config = readVoiceConfig({ ANTHROPIC_API_KEY: SECRET });

    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(Object.values(config)).not.toContain(SECRET);
  });
});

describe("describeVoiceConfig", () => {
  const env: VoiceEnv = {
    ANTHROPIC_API_KEY: SECRET,
    OPENAI_API_KEY: "sk-openai-also-secret",
    VOICE_CALL_MAX_TOKENS: "1500",
  };

  it("redacts every key, including the one for the unselected provider", () => {
    const dump = describeVoiceConfig(env);

    expect(dump.ANTHROPIC_API_KEY).toBe("set (redacted)");
    expect(dump.OPENAI_API_KEY).toBe("set (redacted)");
  });

  it("leaks no fragment of a key anywhere in the dump", () => {
    const serialised = JSON.stringify(describeVoiceConfig(env));

    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain("sk-openai-also-secret");
    // Not even a prefix or a length — both are useful to an attacker.
    expect(serialised).not.toContain(SECRET.slice(0, 8));
    expect(serialised).not.toContain(String(SECRET.length));
  });

  it("distinguishes unset from set without revealing which value", () => {
    const dump = describeVoiceConfig({});

    expect(dump.ANTHROPIC_API_KEY).toBe("unset");
    expect(dump.configured).toBe("false");
  });

  it("reports the resolved guardrails so a deploy can be verified at a glance", () => {
    const dump = describeVoiceConfig(env);

    expect(dump.VOICE_CALL_MAX_TOKENS).toBe("1500");
    expect(dump.configured).toBe("true");
  });
});
