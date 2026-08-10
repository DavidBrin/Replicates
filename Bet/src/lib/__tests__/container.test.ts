// @vitest-environment node
//
// This file exercises AuthProvider.createSession (jose), which is
// jsdom-incompatible in this project's vitest setup — see the same note in
// src/adapters/auth/__tests__/demo-session.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brand, type User } from "@/domain/entities";
import { credits } from "@/domain/money";

const seedSpy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/adapters/memory/seed", () => ({ seedDataStore: seedSpy }));

import {
  getActor,
  getContainer,
  getSessionToken,
  requireUser,
  resetContainerForTests,
} from "@/lib/container";

function reqWithCookie(cookie?: string): Request {
  return new Request("http://localhost/api/x", {
    headers: cookie ? { cookie } : {},
  });
}

async function insertUser(idSuffix: string): Promise<User> {
  const { store, clock } = await getContainer();
  const user: User = {
    id: brand(`usr_${idSuffix}`),
    handle: `handle_${idSuffix}`,
    displayName: `Test User ${idSuffix}`,
    avatarColor: "#7c6cff",
    avatarInitials: "TU",
    balance: credits(100_000),
    createdAt: clock.now(),
  };
  return store.users.insert(user);
}

describe("lib/container.ts", () => {
  beforeEach(() => {
    resetContainerForTests();
    seedSpy.mockClear();
  });
  afterEach(() => {
    resetContainerForTests();
  });

  describe("getContainer", () => {
    it("builds Clock/IdGen/AuthProvider/DataStore with the documented shape", async () => {
      const container = await getContainer();
      expect(container.clock.now()).toBeInstanceOf(Date);
      expect(container.idGen.next("usr")).toMatch(/^usr_/);
      expect(typeof container.auth.createSession).toBe("function");
      expect(typeof container.auth.verify).toBe("function");
      expect(typeof container.store.transact).toBe("function");
    });

    it("is idempotent and promise-memoized: concurrent callers all get the SAME store and seed exactly once", async () => {
      const [a, b, c] = await Promise.all([getContainer(), getContainer(), getContainer()]);
      expect(a.store).toBe(b.store);
      expect(b.store).toBe(c.store);
      expect(seedSpy).toHaveBeenCalledTimes(1);
    });

    it("a later call after the first has resolved still returns the same container without re-seeding", async () => {
      const first = await getContainer();
      const second = await getContainer();
      expect(first.store).toBe(second.store);
      expect(seedSpy).toHaveBeenCalledTimes(1);
    });

    it("resetContainerForTests forces a fresh build (and a fresh seed run) on the next call", async () => {
      const first = await getContainer();
      resetContainerForTests();
      const second = await getContainer();
      expect(first.store).not.toBe(second.store);
      expect(seedSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("getSessionToken", () => {
    it("extracts bet_session from a multi-cookie header", () => {
      const req = reqWithCookie("foo=bar; bet_session=abc123; other=1");
      expect(getSessionToken(req)).toBe("abc123");
    });

    it("returns undefined when there is no Cookie header", () => {
      expect(getSessionToken(reqWithCookie())).toBeUndefined();
    });

    it("returns undefined when bet_session specifically is absent", () => {
      expect(getSessionToken(reqWithCookie("foo=bar"))).toBeUndefined();
    });
  });

  describe("getActor", () => {
    it("returns anonymous with no cookie", async () => {
      expect(await getActor(reqWithCookie())).toEqual({ kind: "anonymous" });
    });

    it("returns anonymous for a garbage/tampered token — never throws", async () => {
      const actor = await getActor(reqWithCookie("bet_session=not-a-real-jwt"));
      expect(actor).toEqual({ kind: "anonymous" });
    });

    it("returns { userId } for a valid session, independently re-verified (not trusting any prior check)", async () => {
      const user = await insertUser("a1");
      const { auth } = await getContainer();
      const token = await auth.createSession(user.id);

      const actor = await getActor(reqWithCookie(`bet_session=${token}`));
      expect(actor).toEqual({ userId: user.id });
    });
  });

  describe("requireUser", () => {
    it("throws a forbidden AppError with no session", async () => {
      await expect(requireUser(reqWithCookie())).rejects.toMatchObject({
        code: "forbidden",
      });
    });

    it("resolves the stored User for a valid session", async () => {
      const user = await insertUser("a2");
      const { auth } = await getContainer();
      const token = await auth.createSession(user.id);

      const resolved = await requireUser(reqWithCookie(`bet_session=${token}`));
      expect(resolved.id).toBe(user.id);
      expect(resolved.handle).toBe(user.handle);
    });

    it("throws forbidden when the session's user id no longer resolves to a stored user", async () => {
      const { auth } = await getContainer();
      const token = await auth.createSession(brand("usr_ghost"));

      await expect(requireUser(reqWithCookie(`bet_session=${token}`))).rejects.toMatchObject({
        code: "forbidden",
      });
    });
  });
});
