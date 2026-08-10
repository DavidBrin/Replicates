// @vitest-environment node
//
// `jose`'s "webapi" build behaves inconsistently under vitest's default
// jsdom environment in this project (a cross-realm `Uint8Array` mismatch
// surfaces as "payload must be an instance of Uint8Array" from deep inside
// jose's signer, confirmed NOT to reproduce under plain Node — see the
// Task 4 report). Session signing/verification has no DOM dependency, so
// this file runs under the real Node environment instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { brand } from "@/domain/entities";
import {
  DemoSessionAuthProvider,
  DEV_FALLBACK_SECRET,
  getSecretKey,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from "@/adapters/auth/demo-session";

describe("adapters/auth/demo-session.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("DemoSessionAuthProvider", () => {
    beforeEach(() => {
      vi.stubEnv("AUTH_SECRET", "test-secret-value-not-the-fallback");
      vi.stubEnv("NODE_ENV", "test");
    });

    it("round-trips createSession -> verify", async () => {
      const provider = new DemoSessionAuthProvider();
      const userId = brand<"UserId">("usr_123");
      const token = await provider.createSession(userId);
      expect(typeof token).toBe("string");
      const verified = await provider.verify(token);
      expect(verified).toEqual({ userId });
    });

    it("verify returns null for garbage input", async () => {
      const provider = new DemoSessionAuthProvider();
      expect(await provider.verify("not-a-jwt")).toBeNull();
      expect(await provider.verify("")).toBeNull();
    });

    it("verify returns null for a token signed with a different secret (tampered)", async () => {
      const signer = new DemoSessionAuthProvider();
      const token = await signer.createSession(brand<"UserId">("usr_1"));

      vi.stubEnv("AUTH_SECRET", "a-completely-different-secret");
      const verifier = new DemoSessionAuthProvider();
      expect(await verifier.verify(token)).toBeNull();
    });

    it("rejects a token signed with a different HMAC algorithm (HS512) against the SAME secret", async () => {
      // Same key bytes as the provider would use — this isn't a wrong-secret
      // case, it's an algorithm-confusion case: verify() must pin `alg` to
      // HS256, not just check the signature against a compatible key.
      const key = getSecretKey();
      const foreignAlgToken = await new SignJWT({ sub: "usr_alg_confusion" })
        .setProtectedHeader({ alg: "HS512" })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
        .sign(key);

      const provider = new DemoSessionAuthProvider();
      expect(await provider.verify(foreignAlgToken)).toBeNull();
    });
  });

  describe("sessionCookieOptions", () => {
    it("uses the documented cookie name, path, sameSite and 7-day maxAge", () => {
      vi.stubEnv("NODE_ENV", "test");
      const opts = sessionCookieOptions();
      expect(opts.name).toBe(SESSION_COOKIE_NAME);
      expect(opts.name).toBe("bet_session");
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe("lax");
      expect(opts.path).toBe("/");
      expect(opts.maxAge).toBe(SESSION_TTL_SECONDS);
      expect(SESSION_TTL_SECONDS).toBe(60 * 60 * 24 * 7);
    });

    it("secure is false outside production and true in production", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(sessionCookieOptions().secure).toBe(false);
      vi.stubEnv("NODE_ENV", "production");
      expect(sessionCookieOptions().secure).toBe(true);
    });
  });

  describe("getSecretKey dev fallback / production guard", () => {
    it("uses the documented fallback secret with a one-time console.warn when AUTH_SECRET is unset outside production", async () => {
      vi.resetModules();
      vi.stubEnv("AUTH_SECRET", "");
      vi.stubEnv("NODE_ENV", "development");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const mod = await import("@/adapters/auth/demo-session");
      const key1 = mod.getSecretKey();
      const key2 = mod.getSecretKey();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(key1).toEqual(new TextEncoder().encode(DEV_FALLBACK_SECRET));
      expect(key2).toEqual(key1);

      warnSpy.mockRestore();
    });

    it("throws instead of using the fallback when NODE_ENV is production and AUTH_SECRET is unset", async () => {
      vi.resetModules();
      vi.stubEnv("AUTH_SECRET", "");
      vi.stubEnv("NODE_ENV", "production");

      const mod = await import("@/adapters/auth/demo-session");
      expect(() => mod.getSecretKey()).toThrow(/AUTH_SECRET/);
    });

    it("never throws in production when AUTH_SECRET is set", async () => {
      vi.resetModules();
      vi.stubEnv("AUTH_SECRET", "a-real-production-secret");
      vi.stubEnv("NODE_ENV", "production");

      const mod = await import("@/adapters/auth/demo-session");
      expect(() => mod.getSecretKey()).not.toThrow();
    });
  });
});
