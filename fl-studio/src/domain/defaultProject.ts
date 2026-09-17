/**
 * The default project (SPEC.md §2.2) — what a first visit gets, and the
 * fallback when a save is absent or corrupt.
 *
 * Channels Kick, Clap, Closed hat, Open hat, Snare (step channels) plus Bass
 * and Lead (melodic); the two hats share choke group `"hats"`, so a closed hat
 * chokes a ringing open hat (SPEC.md §3.3). One empty pattern, two playlist
 * tracks, 8 insert strips plus Master, 140 BPM.
 *
 * Ids are fixed literals rather than minted, so the default project is
 * deterministic: tests can name `"ch-kick"`, and two boots produce identical
 * JSON. `now` is injected because `src/domain` may not read a clock.
 */

import { colorAt } from "./palette";
import {
  DEFAULT_TEMPO,
  MASTER_MIXER_TRACK_ID,
  type Channel,
  type ChannelId,
  type MixerTrack,
  type MixerTrackId,
  type Pattern,
  type PlaylistTrack,
  type PlaylistTrackId,
  type Project,
  type VoiceKind,
} from "./types";

export const EPOCH = "1970-01-01T00:00:00.000Z";

export const DEFAULT_PROJECT_ID = "prj-default";
export const DEFAULT_PATTERN_ID = "pat-1";

/** Insert strips besides Master (SPEC.md §1.1 Mixer: "N insert strips (default 8)"). */
export const DEFAULT_INSERT_COUNT = 8;

interface ChannelSeed {
  id: ChannelId;
  name: string;
  voice: VoiceKind;
  chokeGroup?: string;
  defaultStepPitch?: number;
}

const CHANNEL_SEEDS: readonly ChannelSeed[] = [
  { id: "ch-kick", name: "Kick", voice: "kick" },
  { id: "ch-clap", name: "Clap", voice: "clap" },
  { id: "ch-hat-closed", name: "Closed hat", voice: "hatClosed", chokeGroup: "hats" },
  { id: "ch-hat-open", name: "Open hat", voice: "hatOpen", chokeGroup: "hats" },
  { id: "ch-snare", name: "Snare", voice: "snare" },
  // Melodic channels: a step toggle on these should sound like a bassline root
  // and a mid-register lead note rather than both landing on the same C4.
  { id: "ch-bass", name: "Bass", voice: "bass", defaultStepPitch: 36 },
  { id: "ch-lead", name: "Lead", voice: "lead", defaultStepPitch: 72 },
];

const DEFAULT_CHANNEL_VOLUME = 0.8;
const DEFAULT_STEP_PITCH = 60;

function seedChannel(seed: ChannelSeed, index: number): Channel {
  const channel: Channel = {
    id: seed.id,
    name: seed.name,
    color: colorAt(index),
    voice: seed.voice,
    volume: DEFAULT_CHANNEL_VOLUME,
    pan: 0,
    muted: false,
    defaultStepPitch: seed.defaultStepPitch ?? DEFAULT_STEP_PITCH,
    routedToMixerTrackId: MASTER_MIXER_TRACK_ID,
  };
  if (seed.chokeGroup !== undefined) channel.chokeGroup = seed.chokeGroup;
  return channel;
}

export interface DefaultProjectOptions {
  /** ISO 8601 timestamp; injected so the domain never reads a clock. */
  now?: string;
  id?: string;
  name?: string;
}

export function createDefaultProject(options: DefaultProjectOptions = {}): Project {
  const now = options.now ?? EPOCH;

  const channels: Record<ChannelId, Channel> = {};
  const channelOrder: ChannelId[] = [];
  CHANNEL_SEEDS.forEach((seed, index) => {
    channels[seed.id] = seedChannel(seed, index);
    channelOrder.push(seed.id);
  });

  const pattern: Pattern = {
    id: DEFAULT_PATTERN_ID,
    name: "Pattern 1",
    color: colorAt(6),
    notes: {},
  };

  const playlistTracks: Record<PlaylistTrackId, PlaylistTrack> = {};
  const playlistTrackOrder: PlaylistTrackId[] = [];
  for (let i = 1; i <= 2; i += 1) {
    const id = `trk-${i}`;
    playlistTracks[id] = { id, name: `Track ${i}`, color: colorAt(i + 3), muted: false };
    playlistTrackOrder.push(id);
  }

  const mixerTracks: Record<MixerTrackId, MixerTrack> = {
    [MASTER_MIXER_TRACK_ID]: {
      id: MASTER_MIXER_TRACK_ID,
      name: "Master",
      volume: 0.8,
      pan: 0,
      muted: false,
    },
  };
  const mixerTrackOrder: MixerTrackId[] = [MASTER_MIXER_TRACK_ID];
  for (let i = 1; i <= DEFAULT_INSERT_COUNT; i += 1) {
    const id = `mix-${i}`;
    mixerTracks[id] = { id, name: `Insert ${i}`, volume: 0.8, pan: 0, muted: false };
    mixerTrackOrder.push(id);
  }

  return {
    id: options.id ?? DEFAULT_PROJECT_ID,
    name: options.name ?? "New project",
    createdAt: now,
    updatedAt: now,
    tempo: DEFAULT_TEMPO,
    globalSwing: 0,
    channels,
    channelOrder,
    patterns: { [pattern.id]: pattern },
    patternOrder: [pattern.id],
    playlistTracks,
    playlistTrackOrder,
    clips: {},
    mixerTracks,
    mixerTrackOrder,
    playbackMode: "pattern",
    activePatternId: pattern.id,
  };
}
