import { describe, expect, it } from "vitest";

import { asBytes } from "./bytes";

describe("asBytes", () => {
  it("passes a Uint8Array through as the same object", () => {
    const bytes = new Uint8Array([1, 2]);
    expect(asBytes(bytes)).toBe(bytes);
  });

  it("wraps an ArrayBuffer, which is what a data channel set to arraybuffer delivers", () => {
    expect(asBytes(new Uint8Array([3, 4]).buffer)).toEqual(new Uint8Array([3, 4]));
  });

  it("views exactly the bytes another view covers, offset and all", () => {
    const buffer = new Uint8Array([0, 1, 2, 3, 4, 5]).buffer;
    expect(asBytes(new DataView(buffer, 2, 3))).toEqual(new Uint8Array([2, 3, 4]));
  });

  it("refuses anything that is not bytes", () => {
    expect(asBytes("hello")).toBeNull();
    expect(asBytes(null)).toBeNull();
    expect(asBytes({ length: 2 })).toBeNull();
  });
});
