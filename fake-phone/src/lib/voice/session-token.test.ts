// @vitest-environment node

vi.mock("server-only", () => ({}));

import { describe, expect, it, vi } from "vitest";

import {
  elapsedSecondsSince,
  mintVoiceSessionToken,
  verifyVoiceSessionToken,
  voiceSessionSigningKey,
} from "./session-token";

const TTL_MS = 600_000;
const AT = 1_700_000_000_000;

const KEY_ENV = "ANTHROPIC_API_KEY";

async function keyFrom(env: Record<string, string | undefined>): Promise<CryptoKey> {
  const key = await voiceSessionSigningKey(KEY_ENV, env);
  if (!key) throw new Error("expected a signing key");
  return key;
}

/** The ordinary deployment: one provider key, no dedicated signing secret. */
function providerKeyOnly(): Record<string, string | undefined> {
  return { [KEY_ENV]: "sk-ant-a-perfectly-ordinary-looking-key" };
}

async function mint(key: CryptoKey, at = AT): Promise<string> {
  const { token } = await mintVoiceSessionToken(
    { personaId: "friend-nearby", issuedAt: at, ttlMs: TTL_MS },
    key,
  );
  return token;
}

describe("voiceSessionSigningKey", () => {
  it("is unavailable when nothing is configured", async () => {
    expect(await voiceSessionSigningKey(KEY_ENV, {})).toBeNull();
    expect(await voiceSessionSigningKey(KEY_ENV, { [KEY_ENV]: "   " })).toBeNull();
  });

  it("prefers the dedicated secret over the provider key", async () => {
    const provider = providerKeyOnly();
    const dedicated = await keyFrom({ ...provider, VOICE_SESSION_SECRET: "a-different-secret" });

    const token = await mint(dedicated);

    // Rotating the provider key must not invalidate anything when the operator
    // has pinned a signing secret — which is the entire reason it exists.
    const afterRotation = await keyFrom({
      [KEY_ENV]: "sk-ant-rotated",
      VOICE_SESSION_SECRET: "a-different-secret",
    });
    expect(await verifyVoiceSessionToken(token, afterRotation, AT)).not.toBeNull();
    expect(await verifyVoiceSessionToken(token, await keyFrom(provider), AT)).toBeNull();
  });

  it("hands out a key whose bytes cannot be read back", async () => {
    const key = await keyFrom(providerKeyOnly());

    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toBeTruthy();
  });
});

describe("mintVoiceSessionToken", () => {
  it("round-trips the claims it signed", async () => {
    const key = await keyFrom(providerKeyOnly());

    const { token, claims } = await mintVoiceSessionToken(
      { personaId: "friend-nearby", issuedAt: AT, ttlMs: TTL_MS },
      key,
    );

    expect(await verifyVoiceSessionToken(token, key, AT + 1000)).toEqual(claims);
    expect(claims.expiresAt).toBe(AT + TTL_MS);
    expect(claims.sessionId.length).toBeGreaterThan(0);
  });

  it("mints a distinct session every time", async () => {
    const key = await keyFrom(providerKeyOnly());

    const one = await mintVoiceSessionToken({ personaId: "p", issuedAt: AT, ttlMs: TTL_MS }, key);
    const two = await mintVoiceSessionToken({ personaId: "p", issuedAt: AT, ttlMs: TTL_MS }, key);

    expect(one.claims.sessionId).not.toBe(two.claims.sessionId);
    expect(one.token).not.toBe(two.token);
  });

  it("carries no part of the secret", async () => {
    const secret = "sk-ant-a-perfectly-ordinary-looking-key";
    const key = await keyFrom({ [KEY_ENV]: secret });

    const token = await mint(key);

    expect(token).not.toContain(secret);
    expect(token).not.toContain(secret.slice(0, 12));
    // Nor a base64url encoding of it, which is the shape the token is in.
    const encoded = btoa(secret).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(token).not.toContain(encoded);
  });

  it("is URL- and header-safe, so the token can travel anywhere later", async () => {
    const key = await keyFrom(providerKeyOnly());

    expect(await mint(key)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe("verifyVoiceSessionToken", () => {
  it("rejects a token whose payload has been edited", async () => {
    const key = await keyFrom(providerKeyOnly());
    const token = await mint(key);
    const [body, signature] = token.split(".");

    const claims = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp: number;
    };
    // The obvious attack: keep the signature, give yourself an hour more call.
    claims.exp += 3_600_000;
    const forged = btoa(JSON.stringify(claims))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifyVoiceSessionToken(`${forged}.${signature}`, key, AT)).toBeNull();
  });

  it("rejects a token whose signature has been edited", async () => {
    const key = await keyFrom(providerKeyOnly());
    const [body, signature] = (await mint(key)).split(".");
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);

    expect(await verifyVoiceSessionToken(`${body}.${flipped}`, key, AT)).toBeNull();
  });

  it("rejects a token signed with a different key", async () => {
    const mine = await keyFrom(providerKeyOnly());
    const theirs = await keyFrom({ [KEY_ENV]: "sk-ant-somebody-elses-deployment" });

    expect(await verifyVoiceSessionToken(await mint(theirs), mine, AT)).toBeNull();
  });

  it("rejects a token that has expired", async () => {
    const key = await keyFrom(providerKeyOnly());
    const token = await mint(key);

    expect(await verifyVoiceSessionToken(token, key, AT + TTL_MS - 1)).not.toBeNull();
    expect(await verifyVoiceSessionToken(token, key, AT + TTL_MS)).toBeNull();
    expect(await verifyVoiceSessionToken(token, key, AT + TTL_MS + 60_000)).toBeNull();
  });

  it("rejects anything that is not a token at all", async () => {
    const key = await keyFrom(providerKeyOnly());

    for (const candidate of [
      "",
      ".",
      "no-dot-at-all",
      ".signature-only",
      "body-only.",
      "cf1f4b1e-0000-4000-8000-000000000000",
      "not base64!.not base64!",
      `${btoa("{}")}.${btoa("sig")}`,
    ]) {
      expect(await verifyVoiceSessionToken(candidate, key, AT)).toBeNull();
    }
  });

  it("rejects a validly signed payload that is not a session", async () => {
    // The signature is genuine; the claims are junk. Verification is not enough
    // on its own — the shape is checked too, after the signature and never before.
    const key = await keyFrom(providerKeyOnly());
    const body = btoa(JSON.stringify({ v: 99, sid: "x" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifyVoiceSessionToken(`${body}.${encoded}`, key, AT)).toBeNull();
  });
});

describe("elapsedSecondsSince", () => {
  it("measures from the signed issued-at, not from anything a client says", async () => {
    const key = await keyFrom(providerKeyOnly());
    const { claims } = await mintVoiceSessionToken(
      { personaId: "p", issuedAt: AT, ttlMs: TTL_MS },
      key,
    );

    expect(elapsedSecondsSince(claims, AT + 45_000)).toBe(45);
  });

  it("never reports negative elapsed time if a clock steps backwards", async () => {
    const key = await keyFrom(providerKeyOnly());
    const { claims } = await mintVoiceSessionToken(
      { personaId: "p", issuedAt: AT, ttlMs: TTL_MS },
      key,
    );

    expect(elapsedSecondsSince(claims, AT - 60_000)).toBe(0);
  });
});
