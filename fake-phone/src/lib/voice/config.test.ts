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
  describeVoiceConfig,
  isConfigured,
  readVoiceConfig,
  type VoiceEnv,
} from "./config";

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
      VOICE_CALL_MAX_TOKENS: "500",
    });

    expect(config.maxDurationSeconds).toBe(90);
    expect(config.maxTokens).toBe(500);
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
