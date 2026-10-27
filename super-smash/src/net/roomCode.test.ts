import { describe, expect, it } from "vitest";

import * as viaAdapter from "./adapters/webrtc";
import { DEFAULT_UNRELIABLE_CHANNEL_ID, INPUT_CHANNEL_LABEL } from "./channel";
import { ROOM_CODE_ALPHABET, makeRoomCode, normalizeRoomCode, roomCodeProblem } from "./roomCode";

describe("room codes, from their own module", () => {
  it("are the very functions the Trystero adapter has always exported", () => {
    expect(viaAdapter.normalizeRoomCode).toBe(normalizeRoomCode);
    expect(viaAdapter.makeRoomCode).toBe(makeRoomCode);
    expect(viaAdapter.ROOM_CODE_ALPHABET).toBe(ROOM_CODE_ALPHABET);
    expect(viaAdapter.DEFAULT_UNRELIABLE_CHANNEL_ID).toBe(DEFAULT_UNRELIABLE_CHANNEL_ID);
    expect(viaAdapter.INPUT_CHANNEL_LABEL).toBe(INPUT_CHANNEL_LABEL);
  });

  it("keeps the negotiated input channel on stream 42", () => {
    expect(DEFAULT_UNRELIABLE_CHANNEL_ID).toBe(42);
  });

  it("joins the same room for a code typed in lowercase, spaced or dashed", () => {
    expect(normalizeRoomCode("abcd")).toBe("ABCD");
    expect(normalizeRoomCode(" ab cd ")).toBe("ABCD");
    expect(normalizeRoomCode("ab-cd")).toBe("ABCD");
    expect(roomCodeProblem("ab-cd")).toBeNull();
  });

  it("explains an O, I, 0 or 1 instead of joining a different room", () => {
    for (const typed of ["ABOD", "abod", "AB0D", "ABID", "AB1D"]) {
      expect(normalizeRoomCode(typed)).toBeNull();
      expect(roomCodeProblem(typed)).toMatch(/never use I, O, 1 or 0/);
    }
  });

  it("explains a code of the wrong length, or with punctuation", () => {
    expect(roomCodeProblem("ABC")).toMatch(/4 letters/);
    expect(roomCodeProblem("ABCDE")).toMatch(/4 letters/);
    expect(roomCodeProblem("AB!D")).toMatch(/letters only/);
  });

  it("only ever makes codes it would accept", () => {
    for (let i = 0; i < 200; i++) expect(roomCodeProblem(makeRoomCode())).toBeNull();
  });
});
