import { describe, expect, it } from "vitest";

import { placeholder } from "./placeholder";

describe("placeholder", () => {
  it("returns true", () => {
    expect(placeholder()).toBe(true);
  });
});
