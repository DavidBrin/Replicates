/**
 * Press-to-join (Plan 6, Task 30): on the character select, a pad that drives no seat yet
 * claims one by pressing A (standard button 0) or Start (9). A pad that already drives a
 * seat, joined or by connection order (a lone pad plays P1), takes no other: the solo
 * player keeps the CPU opponent (fix round 1's ruling). Pure: the caller polls and seats
 * (`useMatchConfig.seatPad`, ruling R-P6-11).
 */

import { padsInOrder } from "./gamepad";

const JOIN_BUTTONS = [0, 9] as const;

/** What `drivingPads` reads of a seat: a `PlayerSlot`'s kind and joined pad. */
export interface SeatOfPad {
  readonly kind: "human" | "cpu";
  readonly joinedPad: number | null;
}

/**
 * The `Gamepad.index` of the pad that drives `seats[seat]`, or null: the one rule for which
 * pad plays whom (final wave, seam review I-1), as `/play`'s `GamepadInput` maps them
 * (`portForPadIndex` for the joined, `padPortMap` over the unjoined humans). A joined seat
 * is its own pad's, connected or not, and no other pad takes it. The k-th human seat nobody
 * joined is the k-th connected pad nobody joined, lowest index first. A CPU seat has none.
 * `seats` is in port order, so `seat` is the port.
 */
export function padIndexForSeat(pads: readonly (Gamepad | null)[], seats: readonly SeatOfPad[], seat: number): number | null {
  const own = seats[seat];
  if (own === undefined || own.kind !== "human") return null;
  if (own.joinedPad !== null) return own.joinedPad;
  const joined = new Set(seats.flatMap((s) => (s.joinedPad === null ? [] : [s.joinedPad])));
  const before = seats.slice(0, seat).filter((s) => s.kind === "human" && s.joinedPad === null).length;
  return padsInOrder(pads).filter((pad) => !joined.has(pad.index))[before]?.index ?? null;
}

/** The indices of the pads that already drive a seat (`padIndexForSeat`), joined or by connection order. */
export function drivingPads(pads: readonly (Gamepad | null)[], seats: readonly SeatOfPad[]): Set<number> {
  return new Set(seats.flatMap((_, seat) => padIndexForSeat(pads, seats, seat) ?? []));
}

/**
 * The indices of the connected pads, not in `seated`, whose A or Start went down since
 * the last call. `last` is the caller's, kept between calls: each pad's press, so a held
 * button joins once.
 */
export function joinPresses(pads: readonly (Gamepad | null)[], seated: ReadonlySet<number>, last: Map<number, boolean>): number[] {
  const out: number[] = [];
  for (const pad of pads) {
    if (pad === null || !pad.connected) continue;
    const down = JOIN_BUTTONS.some((b) => pad.buttons[b]?.pressed === true);
    const was = last.get(pad.index) ?? false;
    last.set(pad.index, down);
    if (down && !was && !seated.has(pad.index)) out.push(pad.index);
  }
  return out;
}
