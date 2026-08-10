import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  authorizeOr404,
  handler,
  isAppError,
  jsonErr,
  jsonOk,
  parseBody,
  STATUS_BY_CODE,
  throwApp,
} from "@/lib/http";

function req(body: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function malformedReq(): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
}

describe("lib/http.ts", () => {
  describe("jsonOk / jsonErr envelope (G4)", () => {
    it("jsonOk wraps the payload under { data }", async () => {
      const res = jsonOk({ hello: "world" });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ data: { hello: "world" } });
    });

    it("jsonErr wraps the payload under { error } and picks the status from the code", async () => {
      const res = jsonErr({ code: "not_found", message: "nope" });
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({
        error: { code: "not_found", message: "nope" },
      });
    });

    it("jsonErr respects an explicit status override", () => {
      const res = jsonErr({ code: "internal", message: "x" }, 599);
      expect(res.status).toBe(599);
    });
  });

  describe("STATUS_BY_CODE (Task 4 brief's table)", () => {
    it("matches the documented mapping exactly", () => {
      expect(STATUS_BY_CODE).toEqual({
        validation: 400,
        forbidden: 403,
        not_found: 404,
        conflict: 409,
        market_closed: 409,
        insufficient_balance: 422,
        rate_limited: 429,
        internal: 500,
      });
    });
  });

  describe("isAppError", () => {
    it("recognizes a well-formed AppError", () => {
      expect(isAppError({ code: "validation", message: "x" })).toBe(true);
    });
    it("rejects a code outside ErrorCode", () => {
      expect(isAppError({ code: "teapot", message: "x" })).toBe(false);
    });
    it("rejects non-objects and objects missing message", () => {
      expect(isAppError("nope")).toBe(false);
      expect(isAppError(null)).toBe(false);
      expect(isAppError({ code: "validation" })).toBe(false);
    });
  });

  describe("parseBody", () => {
    const schema = z.object({ name: z.string().min(1) });

    it("returns the parsed, typed value on success", async () => {
      const result = await parseBody(req({ name: "maya" }), schema);
      expect(result).toEqual({ name: "maya" });
    });

    it("throws a validation AppError on a schema failure, with per-field messages", async () => {
      await expect(parseBody(req({ name: "" }), schema)).rejects.toMatchObject({
        code: "validation",
        fields: { name: expect.any(String) },
      });
    });

    it("throws a validation AppError on malformed JSON", async () => {
      await expect(parseBody(malformedReq(), schema)).rejects.toMatchObject({
        code: "validation",
      });
    });
  });

  describe("authorizeOr404", () => {
    it("no-ops when allowed", () => {
      expect(() => authorizeOr404(true)).not.toThrow();
    });

    it("throws not_found by default (sensitive resource) when denied", () => {
      try {
        authorizeOr404(false);
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({ code: "not_found" });
      }
    });

    it("throws forbidden when explicitly marked non-sensitive", () => {
      try {
        authorizeOr404(false, { sensitive: false });
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({ code: "forbidden" });
      }
    });
  });

  describe("handler()", () => {
    it("passes through a successful response untouched", async () => {
      const route = handler(async () => jsonOk({ ok: true }));
      const res = await route(req({}) as never);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ data: { ok: true } });
    });

    it("catches a thrown AppError and serializes it with the right status", async () => {
      const route = handler(async () => {
        return throwApp({ code: "conflict", message: "already exists" });
      });
      const res = await route(req({}) as never);
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({
        error: { code: "conflict", message: "already exists" },
      });
    });

    it("catches an unexpected throw, logs it, and returns a generic internal error without leaking the message", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const route = handler(async () => {
        throw new Error("some secret stack-trace-y detail");
      });
      const res = await route(req({}) as never);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("internal");
      expect(body.error.message).not.toContain("secret");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
