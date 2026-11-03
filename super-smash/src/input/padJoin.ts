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
 * The indices of the pads that already drive a seat: each joined pad, and the pads nobody
 * joined that connection order gives the human seats nobody joined, one each, lowest index
 * first, as `/play` maps them (`padPortMap` over the unjoined humans).
 */
export function drivingPads(pads: readonly (Gamepad | null)[], seats: readonly SeatOfPad[]): Set<number> {
  const driving = new Set(seats.flatMap((seat) => (seat.joinedPad === null ? [] : [seat.joinedPad])));
  const open = seats.filter((seat) => seat.kind === "human" && seat.joinedPad === null).length;
  const unjoined = padsInOrder(pads).filter((pad) => !driving.has(pad.index));
  for (const pad of unjoined.slice(0, open)) driving.add(pad.index);
  return driving;
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
