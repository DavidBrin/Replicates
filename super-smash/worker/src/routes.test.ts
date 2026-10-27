// @vitest-environment node
import { describe, expect, it } from "vitest";

import { routeFor } from "./routes";

describe("routing", () => {
  it("sends GET /api/ice to the TURN minting", () => {
    expect(routeFor("GET", "/api/ice")).toEqual({ kind: "ice" });
  });

  it("refuses anything but GET on /api/ice", () => {
    expect(routeFor("POST", "/api/ice")).toEqual({ kind: "not-found" });
  });

  it("sends a room socket to its Durable Object by code", () => {
    expect(routeFor("GET", "/ws/room/ABCD")).toEqual({ kind: "room", code: "ABCD" });
  });

  it("refuses a code the browser did not normalise, or one that cannot exist", () => {
    for (const path of ["/ws/room/abcd", "/ws/room/ABOD", "/ws/room/ABCDE", "/ws/room/AB", "/ws/room/ABCD/x"]) {
      expect(routeFor("GET", path)).toEqual({ kind: "not-found" });
    }
  });

  it("404s unknown /api and /ws paths instead of serving the game", () => {
    expect(routeFor("GET", "/api/nope")).toEqual({ kind: "not-found" });
    expect(routeFor("GET", "/ws/lobby")).toEqual({ kind: "not-found" });
  });

  it("leaves everything else to the static assets", () => {
    expect(routeFor("GET", "/")).toEqual({ kind: "assets" });
    expect(routeFor("GET", "/menu")).toEqual({ kind: "assets" });
  });
});
