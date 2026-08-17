# fMP4 + HLS Packaging — Muxer Reference

**Lane R2.** This document specifies, box-by-box and bit-by-bit, everything needed to hand-write a
fragmented-MP4 (fMP4) muxer in TypeScript that consumes WebCodecs `EncodedVideoChunk` /
`EncodedAudioChunk` output and produces (a) an MSE-valid init segment + media segments, and (b) HLS
playlists that reference them. No mux.js, no mp4box.js — every field below is something the muxer code
writes itself.

All byte layouts are big-endian ("network order"), which is what ISO BMFF uses throughout. All box
sizes include the 8-byte (or 16-byte, for 64-bit "largesize") header.

Every claim below is cited against a primary source. Where the primary standard is paywalled (ISO/IEC
14496-15, ISO/IEC 23000-19 CMAF), the citation is the best available free mirror or a corroborating
production implementation. Reference key is at the end of the document; inline tags look like `[BMFF §8.8.7.1]`.

This document was cross-checked against **[Vanilagy/mp4-muxer]** — an existing, real, hand-written
TypeScript fMP4 muxer built specifically for WebCodecs output (the same problem this project is solving).
Its source (`src/box.ts`, `src/muxer.ts`, `src/misc.ts`, `src/writer.ts`) is used throughout as a working
proof that the field values below actually produce a file browsers play, not just what the spec text says
in isolation.

---

## 1. Box-by-box init segment layout

### 1.1 The tree

```
ftyp
moov
├── mvhd
├── trak                      (one per track: video, then audio)
│   ├── tkhd
│   └── mdia
│       ├── mdhd
│       ├── hdlr
│       └── minf
│           ├── vmhd  (video tracks)  |  smhd  (audio tracks)
│           ├── dinf
│           │   └── dref
│           │       └── url  (entry 1, self-contained)
│           └── stbl
│               ├── stsd   (1 sample entry: avc1/hvc1/vp09/av01 + mp4a, see §2)
│               ├── stts   (empty: entry_count = 0)
│               ├── stsc   (empty: entry_count = 0)
│               ├── stsz   (empty: sample_size = 0, sample_count = 0)
│               └── stco   (empty: entry_count = 0)
└── mvex
    └── trex                  (one per track)
```

An init segment is **exactly** `ftyp` + `moov`, nothing else, no sample data. `moov`'s sample tables carry
zero entries — they exist only because `stbl` is mandatory and `stsd` must be non-empty (it defines the
codec), but `stts`/`stsc`/`stsz`/`stco` are formally empty tables. The `mvex` box is what tells a reader
"more samples arrive later, in movie fragments" `[BMFF §8.8.1.1]`; **omitting it is a silent failure mode** —
see §10.

### 1.2 `ftyp` — File Type Box

Fourcc `ftyp`. Not a `FullBox` (no version/flags byte). Container: file, top-level, first box in the file
`[BMFF §4.3.1]`.

| Field | Width | Value |
|---|---|---|
| `major_brand` | 4 bytes (fourcc) | `iso5` |
| `minor_version` | u32 | informative only, e.g. `0x00000200` |
| `compatible_brands[]` | 4 bytes each, to end of box | `iso5`, `iso6`, `mp41` |

**Which brands, and why:**

- **`iso5`** is required to use the `default-base-is-moof` `tfhd` flag (§3.3) — that flag "is required under
  the `iso5` brand, and it shall not be used in brands or compatible brands earlier than iso5"
  `[BMFF §8.8.7.1]`. Since our muxer always uses `default-base-is-moof` (it's the only offset convention
  worth implementing — see §3.4), `iso5` must be present.
- **`iso6`** additionally requires support for `tfdt` on every `traf`, and for **version-1 `trun`** (signed
  composition offsets) `[BMFF Annex E.9]`. Our muxer always emits `tfdt` and always uses `trun` version 1
  (§3.3, §5.4), so declaring `iso6` accurately reflects the file's actual conformance. A brand in
  `compatible_brands` is "a claim that the file conforms to all requirements of that brand, and a
  permission to a reader implementing potentially only that brand to read the file" `[BMFF Annex E.1]` —
  since we don't emit the brand-conditional features we *don't* use (e.g. `saiz`/`saio`, sample groups in
  fragments), the claim is vacuously satisfied for those.
- **`mp41`** is included for maximum backward compatibility with readers that don't recognize `iso5`/`iso6`
  at all. This mirrors what a real, shipping WebCodecs muxer does: `[MP4-MUXER box.ts:74-81]` emits exactly
  `major_brand='iso5'`, `compatible_brands=['iso5','iso6','mp41']` for fragmented output.
- **Do not invent a brand.** The W3C MSE byte-stream spec states the user agent "MUST run the append error
  algorithm if... a File Type Box contains a `major_brand` or `compatible_brand` that the user agent does
  not support" `[MSE-BSF-ISOBMFF §3.1]`. Stick to well-known registered brands.
- If later conforming to CMAF, add `cmfc` (or `cmf2`) to `compatible_brands` — see §8. It changes no field
  layouts, only the claim.

### 1.3 `moov` — Movie Box

Fourcc `moov`. Not a `FullBox`. Container: file. Mandatory, exactly one `[BMFF §8.2.1.1]`. Pure container,
no fields of its own — children are `mvhd`, one `trak` per track, then `mvex`.

### 1.4 `mvhd` — Movie Header Box

Fourcc `mvhd`. `FullBox`. Container: `moov`. Mandatory, exactly one `[BMFF §8.2.2.1]`.

Version 0 uses 32-bit time fields; version 1 uses 64-bit. Use version 0 unless `creation_time` or
`duration` overflow 32 bits (they won't, in practice, for VOD content authored today — but check and
upgrade to version 1 rather than truncating).

| # | Field | Width (v0 / v1) | Value |
|---|---|---|---|
| — | version | u8 | `0` (or `1` if 64-bit needed) |
| — | flags | u24 | `0` |
| 1 | `creation_time` | u32 / u64 | seconds since 1904-01-01 UTC, or `0` |
| 2 | `modification_time` | u32 / u64 | same as `creation_time` for a fresh mux |
| 3 | `timescale` | u32 | movie-wide timescale — see §5.1. Recommend `1000`. |
| 4 | `duration` | u32 / u64 | total presentation duration, in `timescale` units above. `0` or unknown while fragmenting live |
| 5 | `rate` | i32 (fixed 16.16) | `0x00010000` (1.0, normal playback speed) |
| 6 | `volume` | i16 (fixed 8.8) | `0x0100` (1.0, full volume) |
| 7 | reserved | 2 bytes | `0` |
| 8 | reserved | 2×u32 | `0`, `0` |
| 9 | `matrix` | 9×i32 | unity matrix, see §1.9 |
| 10 | `pre_defined` | 6×u32 | `0` |
| 11 | `next_track_ID` | u32 | largest existing track ID + 1 (e.g. `3` for a video+audio file) |

`[BMFF §8.2.2.2–8.2.2.3]`

### 1.5 `trak` — Track Box

Fourcc `trak`. Not a `FullBox`. Container: `moov`. One or more `[BMFF §8.3.1.1]`. Pure container: `tkhd`
then `mdia`.

### 1.6 `tkhd` — Track Header Box

Fourcc `tkhd`. `FullBox`. Container: `trak`. Mandatory, exactly one `[BMFF §8.3.2.1]`.

**`duration` here is expressed in the *movie's* timescale (`mvhd.timescale`), not the track's own
`mdhd.timescale`** `[BMFF §8.3.2.3]` — a classic place to silently introduce drift if you reuse the track
timescale by habit (§10).

| # | Field | Width (v0/v1) | Value |
|---|---|---|---|
| — | version | u8 | `0` or `1` |
| — | flags | u24 | `0x000007` = `track_enabled (0x1)` \| `track_in_movie (0x2)` \| `track_in_preview (0x4)` — this is the documented default `[BMFF §8.3.2.1]` |
| 1 | `creation_time` | u32/u64 | as `mvhd` |
| 2 | `modification_time` | u32/u64 | as `mvhd` |
| 3 | `track_ID` | u32 | `1` for video, `2` for audio (must never be `0`, never reused) |
| 4 | reserved | u32 | `0` |
| 5 | `duration` | u32/u64 | in `mvhd.timescale` units |
| 6 | reserved | 2×u32 | `0`, `0` |
| 7 | `layer` | i16 | `0` |
| 8 | `alternate_group` | i16 | `0` |
| 9 | `volume` | i16 (fixed 8.8) | `0x0100` for audio track, `0` for video track |
| 10 | reserved | u16 | `0` |
| 11 | `matrix` | 9×i32 | unity, or a rotation matrix if you need to signal device rotation |
| 12 | `width` | u32 (fixed 16.16) | video pixel width (`0` for audio) |
| 13 | `height` | u32 (fixed 16.16) | video pixel height (`0` for audio) |

`[BMFF §8.3.2.2]`

### 1.7 `mdia` / `mdhd` / `hdlr` / `minf`

`mdia` (Media Box): not a `FullBox`, pure container, mandatory exactly one child of `trak`
`[BMFF §8.4.1.1]`. Children: `mdhd`, `hdlr`, `minf`, in that order.

**`mdhd`** — Media Header Box, `FullBox`, mandatory exactly one, container `mdia` `[BMFF §8.4.2.1]`:

| # | Field | Width (v0/v1) | Value |
|---|---|---|---|
| — | version | u8 | `0` or `1` |
| — | flags | u24 | `0` |
| 1 | `creation_time` | u32/u64 | as above |
| 2 | `modification_time` | u32/u64 | as above |
| 3 | `timescale` | u32 | **this track's own timescale** — sample rate for audio, see §5.1 for video |
| 4 | `duration` | u32/u64 | total track duration, **in this box's own `timescale`** |
| 5 | `pad` + `language` | 1 bit + 15 bits (u16) | `0b0` pad, then 3×5-bit ISO-639-2/T chars, each char = ASCII − `0x60`. `"und"` (undetermined) = `0x55C4` |
| 6 | `pre_defined` | u16 | `0` |

`[BMFF §8.4.2.2–8.4.2.3]`. Worked value for `"und"`: `u`=0x75−0x60=21=`10101`, `n`=0x6E−0x60=14=`01110`,
`d`=0x64−0x60=4=`00100` → `0 10101 01110 00100` = `0x55C4`.

**`hdlr`** — Handler Reference Box, `FullBox` version 0, mandatory exactly one, container `mdia`
`[BMFF §8.4.3.1]`:

| # | Field | Width | Value |
|---|---|---|---|
| — | version/flags | u8 + u24 | `0`, `0` |
| 1 | `pre_defined` | u32 | `0` |
| 2 | `handler_type` | 4 bytes (fourcc) | `'vide'` for video track, `'soun'` for audio track |
| 3 | reserved | 3×u32 | `0` |
| 4 | `name` | null-terminated UTF-8 string | any human-readable string, e.g. `"VideoHandler\0"` — purely diagnostic |

`[BMFF §8.4.3.2–8.4.3.3]`

**`minf`** (Media Information Box): not a `FullBox`, pure container, mandatory `[BMFF §8.4.4.1]`. Children,
in order: the type-specific media header (`vmhd` or `smhd`), then `dinf`, then `stbl`.

### 1.8 `vmhd` / `smhd`

**`vmhd`** — Video Media Header, `FullBox`, mandatory for video tracks. **`flags` must be `1`** — this is
called out explicitly in the spec, not `0` like almost every other box `[BMFF §12.1.2.1]`:

| # | Field | Width | Value |
|---|---|---|---|
| — | version/flags | u8 + u24 | `0`, `0x000001` |
| 1 | `graphicsmode` | u16 | `0` (copy) |
| 2 | `opcolor` | 3×u16 | `0, 0, 0` |

`[BMFF §12.1.2.2]`

**`smhd`** — Sound Media Header, `FullBox`, mandatory for audio tracks, `flags = 0`:

| # | Field | Width | Value |
|---|---|---|---|
| — | version/flags | u8 + u24 | `0`, `0` |
| 1 | `balance` | i16 (fixed 8.8) | `0` (centered) |
| 2 | reserved | u16 | `0` |

`[BMFF §12.2.2.2]`

### 1.9 `dinf` / `dref` / `url `

`dinf` (Data Information Box): not a `FullBox`, mandatory, exactly one child `dref` `[BMFF §8.7.1.1]`.

`dref` — Data Reference Box, `FullBox`, mandatory, exactly one `[BMFF §8.7.2.1]`:

| # | Field | Width | Value |
|---|---|---|---|
| — | version/flags | u8 + u24 | `0`, `0` |
| 1 | `entry_count` | u32 | `1` |
| 2 | data entry box | — | one `url ` box (fourcc is `"url "`, with a trailing space — 4 characters) |

`url ` box, `FullBox`, flags is the meaningful field here:

| # | Field | Width | Value |
|---|---|---|---|
| — | version/flags | u8 + u24 | `0`, **`0x000001`** — "self-contained" flag: media data is in this same file |
| 1 | `location` | null-terminated string | **omitted entirely** when the self-contained flag is set — "no string (not even an empty one) shall be supplied" `[BMFF §8.7.2.1]` |

So the `url ` box body, when self-contained, is *just* the 4-byte `FullBox` header (version+flags) and
nothing else — an 12-byte box total (8-byte box header + 4-byte version/flags). `[BMFF §8.7.2.2–8.7.2.3]`

**The unity transformation matrix** used in `mvhd`/`tkhd` (9 × 32-bit values, mixed fixed-point formats):

| Index | Format | Value |
|---|---|---|
| 0 | fixed 16.16 | `0x00010000` (1.0) |
| 1 | fixed 16.16 | `0x00000000` |
| 2 | fixed 2.30 | `0x00000000` |
| 3 | fixed 16.16 | `0x00000000` |
| 4 | fixed 16.16 | `0x00010000` (1.0) |
| 5 | fixed 2.30 | `0x00000000` |
| 6 | fixed 16.16 | `0x00000000` |
| 7 | fixed 16.16 | `0x00000000` |
| 8 | fixed 2.30 | `0x40000000` (1.0 in 2.30 format) |

`[BMFF §8.2.2.2]` — the last column (`u`,`v`,`w`) uses 2.30 fixed point, not 16.16; getting this wrong
produces a matrix that *looks* plausible (all zero/identity-ish) but subtly distorts video geometry in
players that actually apply it (most don't, which is exactly why this bug hides).

### 1.10 `stbl` — Sample Table Box and its empty children

`stbl`, not a `FullBox`, mandatory, exactly one child of `minf` `[BMFF §8.5.1.1]`. In an init segment it
must still contain `stsd` (non-empty — it's where the codec configuration lives) plus the four boxes
below, each **structurally present but with zero entries**:

**`stts`** (Decoding Time to Sample), `FullBox` v0, mandatory `[BMFF §8.6.1.2]`:
```
version(u8)=0, flags(u24)=0, entry_count(u32)=0
```
8-byte body total. No table rows.

**`stsc`** (Sample to Chunk), `FullBox` v0, mandatory `[BMFF §8.7.4.1]`:
```
version(u8)=0, flags(u24)=0, entry_count(u32)=0
```

**`stsz`** (Sample Size), `FullBox` v0, mandatory `[BMFF §8.7.3.1]` — note this box has **two** count-like
fields, both zero when empty:
```
version(u8)=0, flags(u24)=0, sample_size(u32)=0, sample_count(u32)=0
```
`sample_size=0` means "sizes vary, see table"; with `sample_count=0` the (absent) table is simply empty.
12-byte body.

**`stco`** (Chunk Offset), `FullBox` v0, mandatory `[BMFF §8.7.5.1]`:
```
version(u8)=0, flags(u24)=0, entry_count(u32)=0
```

`stss` (sync sample table) is **omitted entirely** when absent — its absence means "every sample is a sync
sample" `[BMFF §8.6.2.1]`, which is irrelevant for an init segment with zero samples and also irrelevant
for fragmented files in general, since sync/non-sync is signaled per-fragment via `sample_flags` (§4), not
via `stss`.

### 1.11 `mvex` / `trex`

`mvex` (Movie Extends Box): not a `FullBox`, optional but **must be present for any fragmented file** —
"this box warns readers that there might be Movie Fragment Boxes in this file" `[BMFF §8.8.1.1]`. Children:
one `trex` per track.

`trex` — Track Extends Box, `FullBox` v0, exactly one per track `[BMFF §8.8.3.1]`:

| # | Field | Width | Value |
|---|---|---|---|
| — | version/flags | u8 + u24 | `0`, `0` |
| 1 | `track_ID` | u32 | must match the corresponding `tkhd.track_ID` |
| 2 | `default_sample_description_index` | u32 | `1` (index into `stsd`, which has one entry) |
| 3 | `default_sample_duration` | u32 | `0` |
| 4 | `default_sample_size` | u32 | `0` |
| 5 | `default_sample_flags` | u32 | `0` |

`[BMFF §8.8.3.2]`. **Practical simplification:** if your `tfhd` always supplies its own
`default_sample_duration`/`default_sample_size`/`default_sample_flags` per fragment (§3.3 — recommended,
since you already know the fragment's sample table when you write it), `trex`'s own defaults are never
consulted by a spec-conformant reader. Zero them and move on.

---

## 2. `stsd` sample entries

`stsd` itself, `FullBox` v0, mandatory, exactly one `[BMFF §8.5.2.1]`:
```
version(u8)=0, flags(u24)=0, entry_count(u32)=1, <one SampleEntry>
```

Every `SampleEntry` (video or audio) shares this common 8-byte prefix before its type-specific fields
`[BMFF §8.5.2.2]`:
```
reserved: 6 bytes = 0
data_reference_index: u16 = 1   (points at the one dref entry)
```

### 2.1 `avc1` + `avcC` (H.264 / AVC)

`VisualSampleEntry` body (after the 8-byte common prefix above) `[BMFF §12.1.3.2]`:

| # | Field | Width | Value |
|---|---|---|---|
| 1 | `pre_defined` | u16 | `0` |
| 2 | reserved | u16 | `0` |
| 3 | `pre_defined` | 3×u32 | `0` |
| 4 | `width` | u16 | pixel width |
| 5 | `height` | u16 | pixel height |
| 6 | `horizresolution` | u32 (fixed 16.16) | `0x00480000` (72 dpi) |
| 7 | `vertresolution` | u32 (fixed 16.16) | `0x00480000` (72 dpi) |
| 8 | reserved | u32 | `0` |
| 9 | `frame_count` | u16 | `1` |
| 10 | `compressorname` | 32 bytes | Pascal string; all-zero = empty |
| 11 | `depth` | u16 | `0x0018` (24-bit color, no alpha) |
| 12 | `pre_defined` | i16 | `-1` (`0xFFFF`) |

Then, as a child box, `avcC`.

**`avcC` — AVCDecoderConfigurationRecord.** Not a `FullBox` (no version/flags byte at box level — the
`configurationVersion` field plays that role) `[ISO14496-15]`:

| # | Field | Width | Value |
|---|---|---|---|
| 1 | `configurationVersion` | u8 | `1` |
| 2 | `AVCProfileIndication` | u8 | SPS byte 1 (`profile_idc`) |
| 3 | `profile_compatibility` | u8 | SPS byte 2 (constraint-flags byte) |
| 4 | `AVCLevelIndication` | u8 | SPS byte 3 (`level_idc`) |
| 5 | reserved | 6 bits = `111111` | — |
| 6 | `lengthSizeMinusOne` | 2 bits | `3` → 4-byte NAL length prefixes (the standard choice; the whole point of `avcC`-style AVC is length-prefixed NALs, not Annex-B start codes) |
| 7 | reserved | 3 bits = `111` | — |
| 8 | `numOfSequenceParameterSets` | 5 bits | typically `1` |
| 9 | per SPS: `sequenceParameterSetLength` | u16 | SPS NAL byte length |
| 10 | per SPS: `sequenceParameterSetNALUnit` | bytes | raw SPS NAL bytes (with the 1-byte NAL header, no start code) |
| 11 | `numOfPictureParameterSets` | u8 | typically `1` |
| 12 | per PPS: `pictureParameterSetLength` | u16 | PPS NAL byte length |
| 13 | per PPS: `pictureParameterSetNALUnit` | bytes | raw PPS NAL bytes |

**Conditional high-profile extension** (only present when `AVCProfileIndication` ∈ {100, 110, 122, 144} —
High, High 10, High 4:2:2, High 4:4:4 profiles):

| # | Field | Width | Value |
|---|---|---|---|
| 14 | reserved | 6 bits = `111111` | — |
| 15 | `chroma_format` | 2 bits | from SPS |
| 16 | reserved | 5 bits = `11111` | — |
| 17 | `bit_depth_luma_minus8` | 3 bits | from SPS |
| 18 | reserved | 5 bits = `11111` | — |
| 19 | `bit_depth_chroma_minus8` | 3 bits | from SPS |
| 20 | `numOfSequenceParameterSetExt` | u8 | usually `0` |
| 21 | per ext SPS: length(u16) + NAL unit | — | usually absent |

`[ISO14496-15, corroborated by MPEGGroup/CMAF#10 and mp4parser's AvcConfigurationBox.java]`. **This
conditional block is a real, documented gotcha:** FFmpeg has historically omitted it for High-profile
streams, which fails strict CMAF conformance validation (see §10).

**WebCodecs handoff:** when a `VideoEncoder` is configured with `avc: { format: 'avc' }`, the emitted
`EncodedVideoChunkMetadata.decoderConfig.description` **is already a complete, ready-to-use
AVCDecoderConfigurationRecord** exactly matching the table above — copy its bytes directly as the `avcC`
box payload. This is required (not optional) when using `format: 'avc'`: with that format, SPS/PPS are
*not* in the bitstream at all and are delivered solely via `description`
`[WEBCODECS-AVC §2, ISO14496-15 §5.3.3.1]`. Do not attempt to hand-build `avcC` fields yourself when
targeting `avc` format — parse them out of `description` only if you need individual fields (e.g. to
derive an HLS `CODECS` string, §7), otherwise treat it as an opaque blob.

### 2.2 `vp09` + `vpcC` (VP9)

Sample entry structure is identical to `avc1`'s `VisualSampleEntry` layout above, fourcc `vp09` instead.
Child box is `vpcC`.

**`vpcC` — VPCodecConfigurationBox.** `FullBox`, **version must be 1** ("version 0 is deprecated and
should not be used") `[VP9-ISOBMFF]`:

| # | Field | Width | Value |
|---|---|---|---|
| — | version/flags | u8 + u24 | `1`, `0` |
| 1 | `profile` | u8 | VP9 profile (0–3) |
| 2 | `level` | u8 | VP9 level (e.g. `10` = level 1.0) |
| 3 | `bitDepth` | 4 bits | `8`, `10`, or `12` |
| 4 | `chromaSubsampling` | 3 bits | typically `0` (4:2:0) |
| 5 | `videoFullRangeFlag` | 1 bit | `0` or `1` |
| 6 | `colourPrimaries` | u8 | `2` = unspecified, if unknown |
| 7 | `transferCharacteristics` | u8 | `2` = unspecified, if unknown |
| 8 | `matrixCoefficients` | u8 | `2` = unspecified, if unknown |
| 9 | `codecInitializationDataSize` | u16 | `0` — VP9 needs no extra codec-init blob beyond profile/level/bitDepth above |
| 10 | `codecInitializationData` | bytes | absent (size is 0) |

`[VP9-ISOBMFF]`, corroborated by `[MP4-MUXER box.ts:405-413]`, which builds exactly this layout, parsing
`profile`/`level`/`bitDepth` out of the VP9 codec string (WebCodecs does not hand back a structured VP9
decoder-config record the way it does for AVC — you get a codec string like `"vp09.00.10.08"` and must
parse the dot-separated fields yourself; see §7 for the string format).

### 2.3 `av01` + `av1C` (AV1)

Sample entry: same `VisualSampleEntry` layout, fourcc `av01`. Child box `av1C`.

**`av1C` — AV1CodecConfigurationRecord.** Not a `FullBox`. Fixed 4-byte header, then variable OBU data
`[AV1-ISOBMFF]`:

| # | Field | Width | Value |
|---|---|---|---|
| 1 | `marker` | 1 bit | `1` (required, disambiguates from an OBU header byte) |
| 2 | `version` | 7 bits | `1` |
| 3 | `seq_profile` | 3 bits | from the AV1 Sequence Header OBU |
| 4 | `seq_level_idx_0` | 5 bits | from the Sequence Header OBU |
| 5 | `seq_tier_0` | 1 bit | from the Sequence Header OBU |
| 6 | `high_bitdepth` | 1 bit | from the Sequence Header OBU |
| 7 | `twelve_bit` | 1 bit | from the Sequence Header OBU (`0` if not present there) |
| 8 | `monochrome` | 1 bit | from the Sequence Header OBU |
| 9 | `chroma_subsampling_x` | 1 bit | from the Sequence Header OBU |
| 10 | `chroma_subsampling_y` | 1 bit | from the Sequence Header OBU |
| 11 | `chroma_sample_position` | 2 bits | from the Sequence Header OBU |
| 12 | reserved | 3 bits | `0` |
| 13 | `initial_presentation_delay_present` | 1 bit | `0` unless you're deliberately signaling it |
| 14 | `initial_presentation_delay_minus_one` | 4 bits | present only if bit 13 is `1`; otherwise this nibble is reserved `= 0` |
| 15 | `configOBUs` | bytes, to end of box | see below |

`configOBUs` "SHALL contain at most one Sequence Header OBU and if present, it SHALL be the first OBU. …
When the samples associated with a sample entry do not contain any sync sample, a Sequence Header OBU
SHALL be present" `[AV1-ISOBMFF]`. In practice: **always include the Sequence Header OBU here.**

**Important, and easy to get wrong:** unlike `avcC`, fields 3–14 above are **not derivable from a codec
string** — they require parsing the actual AV1 bitstream's Sequence Header OBU. `[MP4-MUXER box.ts:417-432]`
documents this exact limitation in its own source comment: its `av1C()` implementation writes only the
`marker`/`version` byte correctly and stubs the rest to zero, with the comment *"the box contents are not
correct like this... Getting the values for the last three bytes requires peeking into the bitstream of
the coded chunks."* A correct AV1 muxer needs a small OBU parser (find the Sequence Header OBU by its
`obu_type == 1`, parse its uncompressed header fields) — treat this as a real implementation task, not a
box-writing formality.

### 2.4 `mp4a` + `esds` (AAC)

`AudioSampleEntry` body (after the 8-byte common `SampleEntry` prefix) `[BMFF §12.2.3]`, corroborated by
`[MP4-MUXER box.ts:435-451]`:

| # | Field | Width | Value |
|---|---|---|---|
| 1 | `version` | u16 | `0` |
| 2 | `revision_level` | u16 | `0` |
| 3 | `vendor` | u32 | `0` |
| 4 | `channelcount` | u16 | number of audio channels (e.g. `2`) |
| 5 | `samplesize` | u16 | `16` |
| 6 | `compression_id` | u16 | `0` |
| 7 | `packet_size` | u16 | `0` |
| 8 | `samplerate` | u32 (fixed 16.16) | sample rate, e.g. `48000` → `0x00480000`... actually the *sample rate value itself* left-shifted 16, e.g. `48000 << 16` |

Then, as a child box, `esds`.

**`esds` — ES Descriptor Box.** `FullBox` v0. Its payload is an MPEG-4 `ES_Descriptor` using the classic
expandable-length descriptor encoding (each descriptor tag is followed by a length byte/bytes; the
`0x80 0x80 0x80` continuation pattern below is the conventional, universally-supported 4-byte encoding of
a 1-byte length value — not size-minimal, but simple and fixed-width, which is what every production
muxer actually emits):

| # | Field | Width | Value |
|---|---|---|---|
| — | version/flags | u8 + u24 | `0`, `0` |
| 1 | tag+len: `ES_DescrTag` | u8 tag + 3×`0x80` + u8 len | tag `0x03`, len = `0x20 + description.length` |
| 2 | `ES_ID` | u16 | `1` |
| 3 | flags | u8 | `0` |
| 4 | tag+len: `DecoderConfigDescrTag` | u8 tag + 3×`0x80` + u8 len | tag `0x04`, len = `0x12 + description.length` |
| 5 | `objectTypeIndication` | u8 | `0x40` (MPEG-4 Audio, ISO/IEC 14496-3) |
| 6 | `streamType`(6)+`upStream`(1)+reserved(1) | u8 | `0x15` (streamType=5 "Audio", upStream=0, reserved=1) |
| 7 | `bufferSizeDB` | u24 | `0` |
| 8 | `maxBitrate` | u32 | e.g. `0x0001FC17` (≈ 130 kbps), or your actual value |
| 9 | `avgBitrate` | u32 | same |
| 10 | tag+len: `DecSpecificInfoTag` | u8 tag + 3×`0x80` + u8 len | tag `0x05`, len = `description.length` |
| 11 | `AudioSpecificConfig` | `description.length` bytes | **exactly WebCodecs' `AudioEncoder` `decoderConfig.description`** (see below) |
| 12 | tag+len: `SLConfigDescrTag` | u8 tag + u8 len | tag `0x06`, len = `1` |
| 13 | `predefined` | u8 | `0x02` ("MP4 file") |

`[MP4-MUXER box.ts:454-477]`, cross-checked against the descriptor tag values documented for `esds`
parsing across multiple MP4 libraries.

**`AudioSpecificConfig` bit layout** (this is what goes in field 11 above, and is what a WebCodecs
`AudioEncoder` configured for `'aac'` hands back as `description` — you normally don't need to build this
by hand, but you need it to compute the HLS `CODECS` string, §7):

| Field | Width | Value |
|---|---|---|
| `audioObjectType` | 5 bits | `2` = AAC-LC (the overwhelmingly common choice; `5` = SBR/HE-AAC v1, `29` = PS/HE-AAC v2 — if `audioObjectType == 31`, 6 more bits follow encoding `audioObjectType - 32`) |
| `samplingFrequencyIndex` | 4 bits | see table below; `15` means "explicit," followed by 24 bits of literal Hz |
| `channelConfiguration` | 4 bits | channel count, `1`=mono, `2`=stereo |
| (AOT-specific config) | variable | empty for plain AAC-LC at this level |

Result is padded up to a byte boundary (2 bytes for the common AAC-LC case: 5+4+4=13 bits → 2 bytes with
3 bits of zero padding).

`samplingFrequencyIndex` table `[MP4A-WIKI]`:

| Index | Hz | Index | Hz |
|---|---|---|---|
| 0 | 96000 | 7 | 22050 |
| 1 | 88200 | 8 | 16000 |
| 2 | 64000 | 9 | 12000 |
| 3 | 48000 | 10 | 11025 |
| 4 | 44100 | 11 | 8000 |
| 5 | 32000 | 12 | 7350 |
| 6 | 24000 | 13–14 | reserved |
| — | — | 15 | explicit 24-bit frequency follows |

`[MP4-MUXER box.ts:374-399]` implements exactly this to synthesize a fallback `AudioSpecificConfig` when
one isn't otherwise available. **In practice, prefer the `description` WebCodecs' `AudioEncoder` gives you
directly** over hand-rolling this — build it yourself only as a fallback / for constructing codec strings.

---

## 3. Media segment layout

### 3.1 The tree

```
[styp]        (optional; omit unless conforming to CMAF/LL-HLS chunking, §8)
moof
├── mfhd
└── traf                      (one per track present in this fragment)
    ├── tfhd
    ├── tfdt
    └── trun
mdat                          (raw sample bytes for every traf above, back-to-back)
```

`[BMFF §8.8.4]` — a media segment is `styp?` + `moof` + one-or-more `mdat` per the MSE requirement in §6;
in practice, one `moof` immediately followed by one `mdat` containing every track's samples for that
fragment, back to back, is what every real muxer emits.

### 3.2 `mfhd`

`FullBox` v0, mandatory, exactly one, container `moof` `[BMFF §8.8.5.1]`:
```
version(u8)=0, flags(u24)=0, sequence_number(u32)
```
`sequence_number` starts at 1 and increments by 1 per fragment, file-wide (not per-track) — "this allows
readers to verify integrity of the sequence" `[BMFF §8.8.5.1]`.

### 3.3 `tfhd` — Track Fragment Header Box

`FullBox`, container `traf`, mandatory exactly one `[BMFF §8.8.7.1]`.

**Flag bits** (in `tf_flags`, the 24-bit `FullBox` flags field) — exact hex values, verbatim from the
standard:

| Hex | Name | Meaning |
|---|---|---|
| `0x000001` | `base-data-offset-present` | explicit `base_data_offset` field follows |
| `0x000002` | `sample-description-index-present` | overrides `trex`'s default index |
| `0x000008` | `default-sample-duration-present` | `default_sample_duration` field follows |
| `0x000010` | `default-sample-size-present` | `default_sample_size` field follows |
| `0x000020` | `default-sample-flags-present` | `default_sample_flags` field follows |
| `0x010000` | `duration-is-empty` | this fragment adds a time interval with no samples |
| `0x020000` | `default-base-is-moof` | anchor data offsets to this `moof`'s first byte, not the file/previous-track convention |

`[BMFF §8.8.7.1]`

**Recommended combination:** `0x020038` = `default-base-is-moof (0x020000)` \| `default-sample-flags-present
(0x000020)` \| `default-sample-size-present (0x000010)` \| `default-sample-duration-present (0x000008)`.
Do **not** set `base-data-offset-present (0x000001)` — it's mutually exclusive in effect with
`default-base-is-moof`, and mixing the two conventions across tracks in the same `moof` is exactly the
bug described in §10. This matches `[MP4-MUXER box.ts:654-676]` exactly.

**Fields:**

| # | Field | Width | Present when |
|---|---|---|---|
| 1 | `track_ID` | u32 | always |
| 2 | `base_data_offset` | u64 | if `0x000001` set (we don't set it) |
| 3 | `sample_description_index` | u32 | if `0x000002` set (we don't set it — always `1`, from `trex`) |
| 4 | `default_sample_duration` | u32 | if `0x000008` set |
| 5 | `default_sample_size` | u32 | if `0x000010` set |
| 6 | `default_sample_flags` | u32 | if `0x000020` set |

`[BMFF §8.8.7.2]`. **Practical technique:** pick the *modal* (most common) duration/size/flags value across
the fragment's samples — for a fixed-frame-rate video GOP this is almost always "the delta-frame duration,
the delta-frame size varies too much to default usefully, the delta-frame's `sample_flags`" — write those
as the `tfhd` defaults, then in `trun` only include per-sample overrides for the few samples that differ
(the keyframe's duration/size/flags, typically just sample index 0 via `first-sample-flags`, §3.4).
`[MP4-MUXER box.ts:663-668]` literally picks `samples[1] ?? samples[0]` as the "reference sample" for this
exact reason — the first sample in a GOP-aligned fragment is the keyframe and is the odd one out.

### 3.4 `trun` — Track Fragment Run Box

`FullBox`, container `traf`, zero or more (we always emit exactly one per `traf`) `[BMFF §8.8.8.1]`.

**Use version 1** — it's what allows `sample_composition_time_offset` to be signed (§5.4); there's no
downside to always using version 1 even for tracks that currently have no B-frames.

**Flag bits:**

| Hex | Name | Meaning |
|---|---|---|
| `0x000001` | `data-offset-present` | `data_offset` field follows — **always set this** |
| `0x000004` | `first-sample-flags-present` | overrides `sample_flags` for sample 0 only; mutually exclusive with per-sample `sample-flags-present` below |
| `0x000100` | `sample-duration-present` | each sample's own `sample_duration` follows in the table |
| `0x000200` | `sample-size-present` | each sample's own `sample_size` follows |
| `0x000400` | `sample-flags-present` | each sample's own `sample_flags` follows |
| `0x000800` | `sample-composition-time-offsets-present` | each sample's own `sample_composition_time_offset` follows |

`[BMFF §8.8.8.1]`. Set each of the last four bits **only if that field actually varies** across the
fragment's samples — this is what `tfhd`'s defaults (§3.3) are for. A fragment of same-duration,
same-size delta frames with one leading keyframe typically needs: `data-offset-present` +
`first-sample-flags-present` + `sample-size-present` (sizes do vary per-frame even at fixed bitrate) —
duration usually doesn't vary (CFR), flags don't vary beyond the first sample.
`[MP4-MUXER box.ts:701-714]` computes exactly this minimal flag set per fragment by diffing all samples'
values.

**Fields:**

| # | Field | Width | Present when |
|---|---|---|---|
| 1 | `sample_count` | u32 | always |
| 2 | `data_offset` | i32 | if `0x000001` set — see §3.5, this is the field that requires back-patching |
| 3 | `first_sample_flags` | u32 | if `0x000004` set |
| — | *(per-sample, `sample_count` rows):* | | |
| 4 | `sample_duration` | u32 | if `0x000100` set |
| 5 | `sample_size` | u32 | if `0x000200` set |
| 6 | `sample_flags` | u32 | if `0x000400` set |
| 7 | `sample_composition_time_offset` | u32 (v0, unsigned) / i32 (v1, signed) | if `0x000800` set |

`[BMFF §8.8.8.2]`

### 3.5 `tfdt` — Track Fragment Base Media Decode Time

`FullBox`, container `traf`, **must be positioned after `tfhd` and before the first `trun`**
`[BMFF §8.8.12.1]`. Formally optional per core ISO BMFF (`Mandatory: No`), but MSE requires it on every
`traf` — see §6 and §10.

**Always use version 1** (64-bit) — see §5.3 for why version 0 overflows in well under a day for any
reasonable video timescale.

| # | Field | Width (v0/v1) | Value |
|---|---|---|---|
| — | version/flags | u8 + u24 | `1` (recommended), `0` |
| 1 | `baseMediaDecodeTime` | u32 / u64 | absolute decode time of this fragment's first sample, **in this track's own `mdhd.timescale`**, measured as the sum of every preceding sample's decode duration since track start (§5.3) |

`[BMFF §8.8.12.2–8.8.12.3]`

### 3.6 `mdat` and the `data_offset` back-patching problem

`mdat` holds the raw coded sample bytes for every track in this fragment, concatenated in the same order
implied by each track's `trun` table. It's the plainest box in the format: an 8-byte header (`size` + `'mdat'`)
followed by raw bytes, no `FullBox` wrapper `[BMFF §8.1.1]`.

**The problem.** With `default-base-is-moof` set, `trun.data_offset` (§3.4, field 2) is a byte offset
measured **from the first byte of the enclosing `moof` box**, to the first byte of this track's samples.
That value depends on:
1. the exact size of `moof` itself (which depends on every `traf`'s `trun` table — i.e. on the sample
   counts and which optional per-sample fields are present, §3.4), plus
2. the exact size of `mdat`'s own header (8 bytes normally; 16 if a 64-bit `largesize` is needed for a
   fragment ≥ 4 GiB), plus
3. the byte offset of *this* track's sample data within `mdat`, if multiple tracks share one `mdat` (i.e.
   the audio track's `data_offset` also has to skip past the video track's bytes that precede it).

You cannot know (1) with certainty until you've *fully decided* what goes in every `trun` — but you also
need to know (1) *before* you can finish writing `trun.data_offset` inside that very `moof`. Two standard
resolutions:

**A — Compute analytically, single pass, no seeking.** By the time you're closing out a fragment, you
already know every sample's final duration/size/flags for every track in it (they were buffered as they
arrived from the encoder). `moof`'s exact byte size is then fully determined by simple arithmetic — every
box in it is fixed-width once you know: sample counts, which `trun` flag bits are set, and whether 64-bit
fields are needed anywhere — no string/variable-length content exists in `moof` at all. So: compute
`moof_size` by summing box header sizes plus field-table sizes (no need to actually serialize `moof` to
get its length), then `data_offset` for the first track = `moof_size + mdat_header_size` (8 or 16), and
for each subsequent track = that, plus the sum of every earlier track's total sample bytes in this
fragment. Write `moof` once, correctly, then `mdat`, then the raw sample bytes. This needs **no seek
capability at all** — it works over a pure forward-only stream (e.g. piping straight into a
`WritableStream`/`fetch` body).

**B — Write a placeholder, then rewind and overwrite.** Write `moof` with `trun.data_offset = 0` (or any
placeholder), remembering the byte offset where `moof` started. Write `mdat` and the sample data. Now that
the true offsets are known, seek back to the recorded `moof` start position and **rewrite the exact same
`moof` box** (same box tree, same sizes — only the numeric value inside `data_offset` differs, so nothing
about the byte layout shifts) with the correct value, then seek forward again to resume appending. This is
what a real, shipping WebCodecs muxer actually does — see `[MP4-MUXER muxer.ts:806-858]`: it writes an
"initial `moof` box; will be overwritten later once actual chunk offsets are known," writes `mdat` +
samples, records `track.currentChunk.offset` and `moofOffset`, then calls `writer.seek(moofOffsetRecorded)`,
re-emits `moof` with the now-known offsets, and seeks forward again. This approach needs either a
random-access target (an in-memory `ArrayBuffer`, or a `FileSystemWritableFileStream`) **or** a streaming
writer that buffers/reorders writes by absolute position before actually flushing bytes out — which is
exactly what `[MP4-MUXER writer.ts]`'s `StreamTargetWriter` does: `write()` just records `{data, start
position}` tuples, and only `flush()` turns those into ordered output, so a "seek backward and rewrite" is
legal as long as it happens before the next `flush()`.

**Recommendation for this project:** implement (A). It's less code (no writer-side position-tracking /
patch machinery needed), it works with a plain forward-only stream from the start, and it removes an
entire class of "I patched the wrong offset" bugs. Fall back to (B)'s technique only if you find yourself
needing to know a fragment's final sample table *before* you've decided the fragment is closed (e.g. very
low-latency chunked encoding where you want to start streaming `moof` bytes before the last sample of the
fragment has even been encoded) — that scenario genuinely can't use (A).

---

## 4. Sample flags — the 32-bit `sample_flags` word

This is the exact bit layout, used identically in `trex.default_sample_flags`, `tfhd.default_sample_flags`,
and `trun.first_sample_flags` / per-sample `sample_flags`:

```
bit(4)              reserved = 0
unsigned int(2)      is_leading
unsigned int(2)      sample_depends_on
unsigned int(2)      sample_is_depended_on
unsigned int(2)      sample_has_redundancy
bit(3)               sample_padding_value
bit(1)               sample_is_non_sync_sample
unsigned int(16)     sample_degradation_priority
```
`[BMFF §8.8.3.1]` — this is the ISO/IEC 14496-12 canonical definition, not an approximation.

| Byte | Bits (MSB→LSB) | Contents |
|---|---|---|
| byte 1 (bits 31–24) | `0000` `is_leading(2)` `sample_depends_on(2)` | reserved, is_leading, sample_depends_on |
| byte 2 (bits 23–16) | `sample_is_depended_on(2)` `sample_has_redundancy(2)` `sample_padding_value(3)` `sample_is_non_sync_sample(1)` | — |
| bytes 3–4 (bits 15–0) | `sample_degradation_priority(16)` | — |

`sample_depends_on` values: `0`=unknown, `1`=depends on others (not I-frame), `2`=does not depend on
others (I-frame/IDR), `3`=reserved. `sample_is_non_sync_sample`: **`0` means this sample IS a sync sample
(keyframe)**; **`1` means it is NOT** — this flag "provides the same information as the sync sample table
[`stss`]... when this value is set 0 for a sample, it is the same as if the sample were... marked with an
entry in the sync sample table" `[BMFF §8.8.3.1]`.

**The two values you need, in practice:**

| Sample type | `sample_depends_on` | `sample_is_non_sync_sample` | Full 32-bit value |
|---|---|---|---|
| Sync sample / keyframe (WebCodecs `chunk.type === 'key'`) | `2` (does not depend) | `0` (is sync) | **`0x02000000`** |
| Non-sync / delta sample (WebCodecs `chunk.type === 'delta'`) | `1` (depends on others) | `1` (is not sync) | **`0x01010000`** |

These exact two constants — `0x02000000` for keyframes, `0x01010000` for delta frames — are what FFmpeg's
`movenc.c` writes (`MOV_FRAG_SAMPLE_FLAG_DEPENDS_NO = 0x02000000`, `MOV_FRAG_SAMPLE_FLAG_DEPENDS_YES |
MOV_FRAG_SAMPLE_FLAG_IS_NON_SYNC = 0x01000000 | 0x00010000 = 0x01010000`) and is corroborated structurally
by `[MP4-MUXER box.ts:626-643]`'s `fragmentSampleFlags()` (it computes the same `sample_depends_on` /
`sample_is_non_sync_sample` distinction, byte-shifted the same way, from `sample.type === 'delta'`).

**Why this is a classic silent bug:** get `sample_is_non_sync_sample` inverted (or leave it `1` on every
sample, including keyframes) and the file still plays perfectly from position 0 — nothing about linear
playback touches this flag. It only surfaces when a player tries to **seek**, or when MSE tries to build
its buffered-ranges / random-access-point index, or on the very first append after `changeType()` (§6),
at which point every candidate seek/resume point looks non-decodable and playback silently stalls or
refuses to (re)start. Test seeking, not just linear playback, when validating a muxer.

**Practical pattern:** put the delta-frame value (`0x01010000`) in `trex`/`tfhd`'s
`default_sample_flags`, and use `trun`'s `first_sample_flags` (§3.4, flag `0x000004`) to override just
sample 0 of a GOP-aligned fragment to the keyframe value (`0x02000000`) — this is exactly the "prefer the
second sample as the reference, since the first is the odd one out" logic in `[MP4-MUXER box.ts:663]`.

---

## 5. Timescales and timestamps

### 5.1 What timescale to choose

WebCodecs gives you `EncodedVideoChunk.timestamp` / `.duration` and `EncodedAudioChunk.timestamp` /
`.duration` **in microseconds** (integers, 1 unit = 1 µs) `[WEBCODECS, MDN EncodedVideoChunk]`.

- **Audio track (`mdhd.timescale`, and thus `tfdt`/`trun` units for that track): use the sample rate**
  (e.g. `48000`). The spec explicitly recommends this — "the timescale for an audio track should be chosen
  to match the sampling rate, or be an integer multiple of it, to enable sample-accurate timing"
  `[BMFF §12.2.3.1]`. It also makes every AAC frame's duration an exact integer with zero rounding (1024
  samples/frame at a 48000 Hz timescale is exactly `1024`, always).

- **Video track: two defensible choices.**
  - **Recommended for this muxer: `1_000_000` (pass WebCodecs' microseconds straight through).** Since the
    source data is already integer microseconds, setting the video track's `mdhd.timescale` to exactly
    `1_000_000` turns every timestamp/duration conversion into the identity function — copy the number
    across, no multiplication, no division, no rounding, and therefore **no drift is possible by
    construction.** The only cost is larger absolute integers in `stts`/`trun`/`tfdt` (still trivially
    within `u32`/`u64` range — a 2-hour video's `tfdt` at 1e6 timescale is ~7.2 billion, which is why §3.5
    said "always use `tfdt` version 1 / 64-bit").
  - **Alternative: a conventional value like `90000`** (the historical MPEG convention) or a
    frame-rate-derived highly-composite number. `[MP4-MUXER box.ts:319]` picks `frameRate ?? 57600` as its
    video timescale (57600 is divisible by nearly every common frame rate: 24, 25, 30, 48, 50, 60...).
    This produces smaller numbers and better interop with tooling that assumes "nice" timescales, at the
    cost of needing real rounding logic (below) since WebCodecs' µs timestamps won't divide evenly.

  Either is spec-correct; **pick the microsecond passthrough unless you have a specific interop reason not
  to** — it is strictly simpler and eliminates an entire bug class for this project.

- **`mvhd.timescale` (movie-wide):** unrelated to either track's media timescale — it's only used for
  `mvhd.duration` and `tkhd.duration` (§1.6), which are coarse, informational fields. `1000` (matching
  `[MP4-MUXER box.ts:132]`) is a fine, simple choice.

### 5.2 Converting without accumulating drift

**Do not** convert every sample's duration independently and round each one: `round(duration_seconds *
timescale)` summed across many samples accumulates rounding error over time, producing audible/visible
drift in long content — a classic bug. This only matters if you picked a video timescale coarser than the
source data (i.e. NOT the §5.1 recommended 1e6 passthrough, where there is nothing to round in the first
place).

If you do use a coarser timescale (audio at sample-rate has this same issue if durations aren't perfectly
integral for some reason), the standard technique is **error diffusion against a running absolute
position**, not independent per-sample rounding:

```
running_position_in_timescale_units = 0   // exact, unrounded, accumulated per track

for each new sample with absolute decodeTimestamp (µs, from WebCodecs):
    ideal_position = decodeTimestamp * timescale / 1_000_000        // exact (unrounded) target
    rounded_position = round(ideal_position)
    delta = rounded_position - running_position_in_timescale_units  // this sample's stts/trun duration
    running_position_in_timescale_units = running_position_in_timescale_units + delta
```

Each individual rounding error is bounded (< 1 timescale unit), and because you round the *absolute*
running position rather than each *relative* delta, errors cancel instead of accumulating — this is
exactly what `[MP4-MUXER muxer.ts:627-631]` does: `timescaleUnits = intoTimescale(sample.decodeTimestamp,
track.timescale, /*round=*/false); delta = Math.round(timescaleUnits - track.lastTimescaleUnits);
track.lastTimescaleUnits += delta`.

### 5.3 `tfdt` semantics and why version 1 is effectively mandatory

`baseMediaDecodeTime` is "the sum of the decode durations of all earlier samples in the media, expressed
in the media's timescale. It does not include the samples added in the enclosing track fragment"
`[BMFF §8.8.12.3]` — i.e. it's an absolute, monotonically-increasing clock for the whole track, **not**
reset to 0 per fragment. Compute it by keeping a running total of decode durations per track (the same
running total from §5.2) and stamping it into each fragment's `tfdt` before you write that fragment's
samples.

32-bit (`version 0`) overflows at `2^32` timescale units. At a `1_000_000` video timescale (§5.1
recommendation), that's **~71 minutes** — well within range for real content. At `90000` it's ~13.25
hours; audio at `48000` is ~24.8 hours. **Always use `tfdt` version 1 (64-bit)** — there's no cost to doing
so and it removes a real, content-length-dependent failure mode.

### 5.4 Composition time offsets (`ctts` / `trun` cto) and B-frames

When decode order and presentation order differ (B-frames reference *future* frames, so they must be
decoded after the frames that follow them in presentation order — the reordering is why `ctts` exists at
all), `CT(n) = DT(n) + offset(n)`. Version 0 offsets are unsigned (CT must always be ≥ DT — "closed GOP,"
every offset is non-negative); version 1 offsets are signed, allowing "open GOP" structures where a
frame's CT can precede its DT `[BMFF §8.6.1.3.1]`. The worked closed-GOP example from the standard itself:

| Frame | I1 | P4 | B2 | B3 | P7 | B5 | B6 |
|---|---|---|---|---|---|---|---|
| DT | 0 | 10 | 20 | 30 | 40 | 50 | 60 |
| CT | 10 | 40 | 20 | 30 | 70 | 50 | 60 |
| decode delta | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| composition offset | 10 | 30 | 0 | 0 | 30 | 0 | 0 |

`[BMFF §8.6.1.2, Table 2]` — frames are *stored/transmitted* in decode order (I1, P4, B2, B3, P7, B5, B6),
each tagged with `sample_duration` = decode delta to the next sample **in decode order**, and a
`sample_composition_time_offset` that shifts it to its correct presentation slot.

In `trun`, this is the per-sample `sample_composition_time_offset` field (§3.4, flag `0x000800`); in the
non-fragmented sample-table world it's the standalone `ctts` box — for a fragmented muxer you only ever
need the `trun` field, `ctts` itself doesn't apply to fragments.

**Can we avoid B-frames entirely?** Yes, and it's the right call for a first version of this muxer.
WebCodecs' `VideoEncoder`, especially configured with `latencyMode: 'realtime'`, produces low-delay output
with no frame reordering — decode order equals presentation order, `EncodedVideoChunk.timestamp` values
arrive already monotonically increasing, and `sample_composition_time_offset` is trivially always `0` for
every sample. That means: no `trun` cto field at all (omit flag `0x000800`), no signed-vs-unsigned
version concerns beyond "always use `trun` v1 defensively," and — critically — one entire class of bugs
(§10: a wrong composition offset silently mispositions a single frame in time, which is a uniquely nasty
bug to chase because everything around that one frame looks fine) simply cannot occur. The cost is purely
compression efficiency: B-frames are typically the *cheapest* frame type per unit of visual quality
(bidirectional prediction has more reference material to draw on than P-frames' single direction), so
disabling them costs roughly 5–15%+ larger files at equivalent quality, depending on content. For a
from-scratch muxer, that tradeoff is worth it: **configure encoders for zero-B-frame / low-latency output,
treat full B-frame + `ctts`/cto support as a stretch goal**, not a v1 requirement.

---

## 6. MSE requirements (W3C ISO BMFF Byte Stream Format + Media Source Extensions)

### 6.1 What makes an init segment valid

"An ISO BMFF initialization segment is defined in this specification as a single File Type Box (`ftyp`)
followed by a single Movie Box (`moov`)." Other top-level boxes (`pdin`, `free`, `sidx`) may appear before
`moov` and are ignored. `[MSE-BSF-ISOBMFF §3.1]` This matches §1.1's tree exactly — nothing extra needed,
nothing extra tolerated as *part of* the init segment (though harmless boxes before it are skipped, not
rejected).

The user agent **MUST** run the append-error algorithm (i.e. reject the segment) if any of:
- `ftyp` names a `major_brand`/`compatible_brand` the UA doesn't recognize,
- a box or field inside `moov` violates what the claimed brand(s) mandate,
- codec configuration needed to decode is not present out-of-band in the sample entry (in-band-only
  configuration is at best a "SHOULD support," never guaranteed) — **this is why `avcC`/`vpcC`/`av1C`/`esds`
  must always be present in `stsd`, in the init segment itself,** not deferred to being parsed out of the
  bitstream later `[MSE-BSF-ISOBMFF §3.1]`.

### 6.2 What makes a media segment valid

"An ISO BMFF media segment is defined in this specification as one optional Segment Type Box (`styp`)
followed by a single Movie Fragment Box (`moof`) followed by one or more Media Data Boxes (`mdat`)."
`moof` MUST contain at least one `traf`. `[MSE-BSF-ISOBMFF §3.2]` — matches §3.1's tree.

**Critically: "At least one Track Fragment Box does not contain a Track Fragment Decode Time Box (`tfdt`)"
is explicitly listed as an append-error condition** `[MSE-BSF-ISOBMFF §3.2]`. ISO/IEC 14496-12 itself marks
`tfdt` as `Mandatory: No` at the core-spec level `[BMFF §8.8.12.1]` — **MSE overrides that and makes it
required on every single `traf`, no exceptions.** Treat `tfdt` as non-optional for this project.

### 6.3 `changeType()` — rendition/codec switching mid-playback

`changeType()`'s algorithm, verbatim from the spec: validate the new MIME type is non-empty and supported,
then, notably, **"Run the reset parser state algorithm"** `[MSE §5.2, dom-sourcebuffer-changetype]`. The
reset-parser-state algorithm, in turn:
- processes any complete frames still pending, then
- **unsets** the last-decode-timestamp and last-frame-duration state on every track buffer,
- **sets the "need random access point" flag to `true`** on every track buffer,
- **sets `[[append state]]` to `WAITING_FOR_SEGMENT`**

`[MSE §5.5.2, sourcebuffer-reset-parser-state]`. Two concrete, load-bearing consequences for a rung-switch
in an ABR ladder:

1. **The very next `appendBuffer()` call after `changeType()` must be a brand-new initialization segment**
   matching the new codec/type — because `[[append state]]` is now `WAITING_FOR_SEGMENT`, any media-segment
   bytes appended before a fresh init segment are not accepted as valid media. This is, empirically, *the*
   most common "why did bitrate switching just silently stop playback" bug in hand-rolled ABR players
   (§10).
2. **The first sample appended after that point must be a random access point** (a sync sample / keyframe,
   §4) — the "need random access point" flag enforces this. This is exactly why HLS/CMAF *also* require
   every rendition's fragments to be keyframe-aligned at matching timestamps (§8) — a `changeType()`-driven
   quality switch has nowhere legal to land except a shared keyframe boundary.

**When `changeType()` isn't actually needed:** if every rung in the ladder shares the exact same codec
string (e.g. all `avc1.640028` — same profile/level, just different resolution/bitrate), you can simply
`appendBuffer()` the new rendition's init segment directly on the existing `SourceBuffer` without calling
`changeType()` at all; nothing about the MIME/codecs type changed. `changeType()` exists specifically for
switching *codec or container type* mid-stream, not for switching within one already-negotiated codec.

---

## 7. HLS

### 7.1 Master (Multivariant) Playlist

`EXT-X-STREAM-INF` attributes `[RFC8216 §4.3.4.2]`:

| Attribute | Required? | Format | Notes |
|---|---|---|---|
| `BANDWIDTH` | **MUST** always be present | decimal-integer, bits/sec | peak segment bitrate across any playable rendition combination |
| `AVERAGE-BANDWIDTH` | optional | decimal-integer, bits/sec | average segment bitrate |
| `CODECS` | RFC 8216: SHOULD. **Apple: MUST** `[APPLE-HLS-AUTH 9.14]` | quoted, comma-separated RFC 6381 strings | one entry per elementary stream referenced by this variant (video + audio, even if audio is a separate rendition group — the `CODECS` list still must include it, §7.1.1 below) |
| `RESOLUTION` | optional (recommended if video present). **Apple: MUST if variant includes video** `[APPLE-HLS-AUTH 9.15]` | `WxH` decimal-resolution | e.g. `1920x1080` |
| `FRAME-RATE` | optional, recommended if video > 30fps | decimal, 3 places | e.g. `29.970` |
| `AUDIO` | optional | quoted string | must match an `EXT-X-MEDIA` `GROUP-ID` with `TYPE=AUDIO` |
| `SUBTITLES` | optional | quoted string | must match an `EXT-X-MEDIA` `GROUP-ID` with `TYPE=SUBTITLES` |

`[RFC8216 §4.3.4.2]`. Apple additionally requires (verbatim, HLS Authoring Specification, current 2025-06
revision): "9.1 …the `BANDWIDTH` attribute. 9.2 …the `RESOLUTION` attribute if the rendition includes video.
9.3 …the `CODECS` attribute. 9.4 …the `FRAME-RATE` attribute." `[APPLE-HLS-AUTH §9]` — i.e. Apple treats all
four as mandatory in practice, stricter than the base RFC.

#### 7.1.1 `CODECS` string construction

Format is `RFC 6381` codec-parameter strings, comma-separated, one per elementary stream `[RFC8216
§4.3.4.2]`.

- **`avc1` (H.264):** `avc1.` + 6 hex digits = the 3 bytes `AVCProfileIndication`, `profile_compatibility`,
  `AVCLevelIndication` **read directly out of the `avcC` box you already built** (§2.1, fields 2–4) — "the
  hexadecimal representation of... profile_idc, the byte containing the constraint_set flags..., and
  level_idc" `[RFC6381 §3.3]`. Example: `avc1.640028` = High Profile (0x64), no constraint flags, Level
  4.0 (0x28).
- **`mp4a` (AAC):** `mp4a.40.` + `audioObjectType` decimal. AAC-LC (the common case, `audioObjectType=2`)
  → `mp4a.40.2` `[RFC6381 §3.4, RFC8216 §4.3.4.2 example]`. HE-AAC v1 → `mp4a.40.5`, HE-AAC v2 →
  `mp4a.40.29`.
- **`vp09` (VP9):** `vp09.PP.LL.DD[.CC.cp.tc.mc.F]` — profile, level, bit depth are **mandatory**; the
  remaining 5 fields (chroma subsampling, color primaries, transfer characteristics, matrix coefficients,
  full-range flag) are all-or-nothing optional. Minimal example: `vp09.00.10.08`. Full example:
  `vp09.02.10.10.01.09.16.09.01` `[VP9-ISOBMFF]`.
- **`av01` (AV1):** `av01.P.LLT.DD[.M.CCC.cp.tc.mc.F]` — profile, level+tier, bit depth mandatory; rest
  optional as a block. Example: `av01.0.04M.08` (profile 0, level 4.0, Main tier, 8-bit).
  `[AV1-ISOBMFF/WEBCODECS-AV1]`

**Codec support gotcha for HLS specifically:** Apple's own device spec lists supported video codecs as
"H.264/AVC, HEVC/H.265, Dolby Vision, or AV1" `[APPLE-HLS-AUTH §1.1]` — **VP9 is not in that list.** A
`vp09` rendition is unusable for native Apple HLS/AVFoundation playback; it's only viable through an
MSE-based player (hls.js et al.) in a browser that supports VP9-in-fMP4. If this muxer's ladder needs to
serve both native HLS clients and browser/MSE clients, treat VP9 as browser-only and don't put it in a
playlist Apple's native player will ever open.

### 7.2 Media Playlist

| Tag | Required? | Notes |
|---|---|---|
| `EXT-X-VERSION` | MUST appear whenever using tags incompatible with version 1 `[RFC8216 §4.3.1.2]` | fMP4 via `EXT-X-MAP` needs **≥ 6** (or **≥ 5** only if also using `EXT-X-I-FRAMES-ONLY`) `[RFC8216 §4.3.2.5]` |
| `EXT-X-TARGETDURATION` | REQUIRED `[RFC8216 §4.3.3.1]` | integer seconds; every `EXTINF`, rounded, MUST be ≤ this |
| `EXT-X-MAP` | REQUIRED for fMP4 media (`Apple 8.20`: "If using fMP4, `EXT-X-MAP` tags MUST be present") | `URI` required, `BYTERANGE` optional; points at the init segment |
| `EXTINF` | REQUIRED before every segment URI `[RFC8216 §4.3.2.1]` | `<duration>,[<title>]`; SHOULD be floating point |
| `EXT-X-ENDLIST` | VOD only | marks "no more segments will be added" `[RFC8216 §4.3.3.4]` |
| `EXT-X-PLAYLIST-TYPE:VOD` | recommended for VOD | "if your Media Playlists are created from static source content (VOD), you MUST add… `VOD`" `[APPLE-HLS-AUTH 8.6]` |

Apple segmentation rules relevant to a muxer `[APPLE-HLS-AUTH §7]`: "7.3 If using fMP4, the track fragment
decode time MUST be consistent with the decode time and duration of the previous segment" (i.e. `tfdt`
must be a genuinely continuous running clock across segment boundaries, §5.3, never reset arbitrarily);
"7.4 Video segments MUST start with an IDR frame"; "7.5 Target durations SHOULD be 6 seconds"; "7.7 Media
Segments MUST NOT exceed the target duration by more than 0.5 seconds."

### 7.3 `EXT-X-MEDIA` for separate audio and for subtitles

Attributes `[RFC8216 §4.3.4.1]`:

| Attribute | Required? | Notes |
|---|---|---|
| `TYPE` | REQUIRED | `AUDIO`, `VIDEO`, `SUBTITLES`, or `CLOSED-CAPTIONS` |
| `GROUP-ID` | REQUIRED | must match the referencing `EXT-X-STREAM-INF`'s `AUDIO`/`SUBTITLES` attribute |
| `NAME` | REQUIRED | human-readable, unique within the group |
| `URI` | OPTIONAL for AUDIO/VIDEO; **REQUIRED for SUBTITLES**; MUST NOT be present for CLOSED-CAPTIONS | points at that rendition's own media playlist |
| `DEFAULT` / `AUTOSELECT` | OPTIONAL, `YES`/`NO`, default `NO` | at most one `DEFAULT=YES` per group; if `DEFAULT=YES` then `AUTOSELECT` must also be `YES` |
| `LANGUAGE` | OPTIONAL | RFC 5646 tag |
| `CHANNELS` | "SHOULD" for all audio; **REQUIRED** if two renditions share a codec but differ in channel count | e.g. `"2"`, `"6"` for 5.1 |
| `FORCED` | OPTIONAL, `YES`/`NO`; **MUST NOT be present unless `TYPE=SUBTITLES`** | marks essential-to-plot subtitle content (e.g. on-screen foreign text) shown regardless of user caption preference |
| `CHARACTERISTICS` | OPTIONAL | e.g. `"public.accessibility.transcribes-spoken-dialog"` for SDH subtitles |

`[RFC8216 §4.3.4.1]`. Constraint that matters for the worked example below: **"any `EXT-X-STREAM-INF` tag
that references such a Group MUST have a `CODECS` attribute that lists every sample format present in any
Rendition in the Group"** `[RFC8216 §4.3.4.1.1]` — so every video variant's `CODECS` string must include the
shared audio group's codec too, even though the audio bytes live in a separate playlist.

Apple's subtitle-specific rules `[APPLE-HLS-AUTH §5]`: "5.2 Subtitles MUST be WebVTT… or IMSC1 in fMP4."
"5.5 The subtitle playlist MUST exist for the entirety of the main content." "5.8 If the content has forced
subtitles and regular subtitles in a given language, the regular subtitles track… MUST contain both."
"5.11 Forced subtitles SHOULD always have `AUTOSELECT=YES`." For WebVTT specifically (not fMP4-boxed),
each "segment" in that rendition's media playlist is a plain `.vtt` text file, still wrapped in ordinary
`EXTINF`/segment-URI pairs — no `EXT-X-MAP` is needed for WebVTT (it *is* needed for IMSC1-in-fMP4).

### 7.4 Worked example: 3-rung ladder

Video: 480p/1.2 Mbps, 720p/2.8 Mbps, 1080p/5 Mbps, all `avc1.640028` (High@4.0), all sharing one AAC-LC
stereo audio rendition and one English WebVTT subtitle rendition.

**Master playlist** (`master.m3u8`):

```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS

#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac-stereo",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio/stereo/playlist.m3u8"

#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="subs/en/playlist.m3u8"

#EXT-X-STREAM-INF:BANDWIDTH=1280000,AVERAGE-BANDWIDTH=1200000,RESOLUTION=854x480,FRAME-RATE=29.970,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac-stereo",SUBTITLES="subs"
video/480p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2950000,AVERAGE-BANDWIDTH=2800000,RESOLUTION=1280x720,FRAME-RATE=29.970,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac-stereo",SUBTITLES="subs"
video/720p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5200000,AVERAGE-BANDWIDTH=5000000,RESOLUTION=1920x1080,FRAME-RATE=29.970,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac-stereo",SUBTITLES="subs"
video/1080p/playlist.m3u8
```

**Video media playlist** (`video/720p/playlist.m3u8`, VOD, 6-second segments, 3 segments shown):

```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.00600,
segment0.m4s
#EXTINF:6.00600,
segment1.m4s
#EXTINF:6.00600,
segment2.m4s
#EXT-X-ENDLIST
```

**Audio media playlist** (`audio/stereo/playlist.m3u8`) — structurally identical, its own `init.mp4`
containing only the audio track (§9 covers why it's a separate init segment rather than muxed):

```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.00600,
segment0.m4s
#EXTINF:6.00600,
segment1.m4s
#EXTINF:6.00600,
segment2.m4s
#EXT-X-ENDLIST
```

**Subtitle media playlist** (`subs/en/playlist.m3u8`, plain WebVTT, no `EXT-X-MAP` needed):

```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:6.00600,
segment0.vtt
#EXTINF:6.00600,
segment1.vtt
#EXTINF:6.00600,
segment2.vtt
#EXT-X-ENDLIST
```

(`6.00600` reflects nominally-6-second segments at 29.97 fps, matching Apple's own guidance that segment
durations are "nominally 6 seconds (for example, NTSC 29.97 may be 6.006 seconds)" `[APPLE-HLS-AUTH 7.6]`.)

---

## 8. CMAF constraints

CMAF (Common Media Application Format, ISO/IEC 23000-19) layers additional structural constraints on top
of plain fragmented MP4, specifically so the *same* segment files can be referenced by both HLS and DASH
without re-packaging. (The full standard is paywalled; the constraints below are corroborated across
multiple independent technical summaries `[CMAF-SUMMARY]` and are consistent with everything already
required by MSE in §6.)

**Terminology and structure:**
- A **CMAF Fragment** ("chunk") = exactly one `moof` + its one `mdat` — the atomic unit.
- A **CMAF Segment** = one or more Fragments.
- A **CMAF Track File** = one `ftyp`+`moov` init segment (**single track** — CMAF track files, unlike
  general ISO BMFF, carry exactly one media track each) followed by its Segments.
- Two structural brands: **`cmfc`** (base constraints: box presence/order rules, but tolerates multiple
  fragments-per-chunk and legacy features) and **`cmf2`** (stricter: exactly one chunk per fragment,
  exactly one track per file, tighter `moof` — this is the brand modern low-latency/chunked pipelines
  target) `[CMAF-SUMMARY]`.
- `styp` (Segment Type Box) — `ftyp`'s counterpart for segments — is recommended at the start of each
  segment, mirroring `ftyp`'s fields exactly, with brands like `cmfc`/`cmf2`/`cmfl` (last-fragment marker).

**Should this muxer conform?** Yes, functionally — target the *shape* CMAF requires (single-track init
segments, exactly one `moof`+`mdat` pair per fragment, `default-base-is-moof`, `tfdt` on every `traf`,
identical codec/sample-entry across a track's entire lifetime) even without necessarily stamping `cmfc`/
`cmf2` into `ftyp`/`styp`. This isn't extra work — it's *already* everything §1–§6 above specify, since
MSE's own requirements (§6) are effectively a subset of CMAF's. The only genuinely optional pieces are the
brand strings themselves and emitting `styp` on media segments (harmless to add; only strictly needed if
targeting a formal CMAF conformance validator or an LL-HLS chunked-transfer pipeline).

**Segment duration: 2s vs 6s.** Apple's current authoring guidance is 6-second target duration, 2-second
IDR interval independent of that `[APPLE-HLS-AUTH 7.5, 1.13]` — i.e. multiple keyframes *inside* each
6-second segment (so I-frame/trick-play playlists and mid-segment seeking still work), but new HTTP
segment boundaries only every 6s. General industry range is 2–6s: shorter segments (2s) mean faster ABR
reaction to bandwidth changes and lower live latency, at the cost of more HTTP requests, more playlist
churn, and worse CDN cache efficiency (small objects cache and pack less efficiently); longer segments (6s)
invert that tradeoff. **Recommend 6s as the default** (matches Apple's own current guidance, and is
friendlier to CDN caching for VOD), reserving sub-2s durations for a genuinely low-latency live use case
(LL-HLS "Parts," where Apple recommends a ~1-second Part Target Duration `[APPLE-HLS-AUTH 14.2c]` — a
different, finer-grained mechanism layered on top of ordinary segments, out of scope unless this project
targets live streaming).

**IDR/alignment requirements.** Every media segment must start with an IDR/keyframe
`[APPLE-HLS-AUTH 7.4]`; keyframes should recur at least every 2 seconds within a segment
`[APPLE-HLS-AUTH 1.13]`; and — the requirement that actually makes ABR switching work at all — **every
rendition in the ladder must place its segment boundaries (and therefore its keyframes) at identical
presentation timestamps.** This is what makes a mid-playback rung switch (§6.3's `changeType()` /
new-init-segment dance) land exactly on a random access point in the new rendition, every time, with no
gap or overlap.

---

## 9. Separate vs muxed audio

**Recommendation: separate audio rendition group, own `SourceBuffer`, own init segment — not muxed into
each video fragment — for a ladder where the audio doesn't change across rungs.**

Reasons:

1. **No redundant work.** If audio is muxed into every video rung's fragments, you encode/store/transfer
   the *same* audio bytes N times (once per video rendition) instead of once. Audio is typically a small
   fraction of total ladder bitrate, so the absolute per-segment savings look modest, but it compounds
   across every segment × every rung × the CDN's cache footprint over the content's lifetime.
2. **Independent buffering in MSE.** Two `SourceBuffer`s (one audio, one video) buffer and evict
   independently. A video-only quality switch never touches the audio `SourceBuffer` at all — no extra
   parsing, no risk of an unnecessary `changeType()` on the audio side, no chance of an audio buffer stall
   caused by a video-only network hiccup.
3. **This matches how HLS is actually designed to be used.** Apple's own spec: "9.5 You SHOULD deliver
   video and audio as separate streams," and for anything beyond the simplest case it becomes mandatory:
   "9.6 If you have multichannel audio, you MUST use separate audio streams. 9.7 If you have alternative
   audio content (languages/commentary/DVS), you MUST use separate audio streams." `[APPLE-HLS-AUTH §9]`
   The worked example in §7.4 already reflects this: one shared `EXT-X-MEDIA` audio group referenced by
   all three video variants' `CODECS`/`AUDIO` attributes, rather than three copies of the audio track.
4. **The reference implementation's own data model matches this.** `[MP4-MUXER]` is built around exactly
   one video track + one audio track *per output file* — i.e. its natural unit is a single self-contained
   rendition, not a ladder. Building an adaptive ladder on top of that model means constructing **N
   video-only CMAF track files** (one per rung) plus **one shared audio-only CMAF track file**, tied
   together only at the HLS playlist layer (`EXT-X-MEDIA` + `AUDIO=` attribute) — never by re-muxing audio
   into each video rung.

**When muxed makes sense instead:** a single, non-adaptive rendition (e.g. a plain downloadable MP4, no
ladder at all), or a deployment specifically constrained to one HTTP request per segment. Neither applies
here — this project is building an adaptive ladder, so separate audio is the unambiguous right call.

---

## 10. Common failure modes — the silent ones

Every one of these produces a file that looks structurally fine (parses, box sizes check out) but either
doesn't play, doesn't seek, or drifts — none of them throw an obvious "this MP4 is broken" error.

- **Wrong/unrecognized `ftyp` brand.** MSE's byte-stream spec says the UA "MUST" append-error on a brand it
  doesn't recognize `[MSE-BSF-ISOBMFF §3.1]`. Stick to `isom`/`mp41`/`iso5`/`iso6` (§1.2) rather than
  inventing one.
- **Missing `mvex`/`trex` in the init segment.** `mvex` is what tells a reader "expect Movie Fragment
  Boxes" `[BMFF §8.8.1.1]`. Without it, a reader sees a `moov` with empty (§1.10) sample tables and
  concludes the file legitimately has **zero samples** — not "samples are coming later." Nothing crashes;
  the video is just permanently blank.
- **`trun.data_offset` off by even one byte.** The box tree is still 100% well-formed — only the pointer
  into `mdat` is wrong, so the decoder reads a shifted window of bytes: a truncated/garbled NAL length
  prefix, a corrupted frame, or a decode error, depending on exactly how far off it is. This is precisely
  the bug the two techniques in §3.6 exist to prevent — the single most common source is forgetting to add
  `mdat`'s own header size (8 or 16 bytes) on top of `moof`'s size when computing the offset.
- **Sample flags inverted or wrong** (§4) — e.g. writing `sample_is_non_sync_sample=1` on keyframes, or
  using the P/B-frame flags pattern for every sample. Linear playback from position 0 often still works
  (nothing about that path reads the sync-sample bit), so this bug hides until someone seeks, or until an
  ABR switch (§6.3) tries to resume on what should be a random access point and can't find one.
- **Timescale mismatch or mix-up.** Two distinct versions of this bug: (a) using the *wrong track's*
  timescale when computing a duration (e.g. converting an audio sample's duration using the video track's
  timescale by copy-paste error), and (b) forgetting that `tkhd.duration` is in the *movie's* timescale
  (`mvhd.timescale`) while `mdhd.duration`/`stts`/`tfdt`/`trun` are all in that *track's own*
  `mdhd.timescale` `[BMFF §8.3.2.3 vs §8.4.2.3]` — mixing these produces a file that plays but with
  audio/video gradually drifting out of sync, invisible in the first few seconds.
- **Missing `tfdt` on a `traf`.** ISO/IEC 14496-12 core spec marks it optional `[BMFF §8.8.12.1]`, but MSE
  explicitly lists a missing `tfdt` as a mandatory append-error condition `[MSE-BSF-ISOBMFF §3.2]` — a
  muxer that follows only the core spec's "optional" reading will produce segments that some/most browsers
  flatly refuse to append, with no video at all, rather than a partial degradation.
- **`stsd` with no config box, or a malformed one** (missing `avcC`/`vpcC`/`av1C`/`esds`, or — the FFmpeg
  High-profile case, §2.1 — an `avcC` missing its required chroma/bit-depth extension fields for High
  profile). "If the `format` field of a `SampleEntry` is unrecognized, neither the sample description
  itself, nor the associated media samples, shall be decoded" `[BMFF §8.5.2.1]` — the demuxer/container
  layer parses fine, the video *decoder* rejects the stream, and the typical visible symptom is just a
  black `<video>` element with no console error pointing at the actual cause.
- **Mixing `default-base-is-moof` conventions across tracks in one `moof`.** If one `traf` sets
  `default-base-is-moof` and another (incorrectly) relies on the "previous track fragment" offset
  convention instead `[BMFF §8.8.7.1]`, only one of the two tracks in that fragment desyncs — the other
  plays fine, which makes this a maddening one to isolate (audio breaks, video's perfect, or vice versa,
  and the bug is actually in the *other* track's offset math).
- **`trun`/`ctts` version mismatch with signed offsets** — writing a negative composition-time-offset value
  into a version-0 (unsigned) `trun`, where it gets silently reinterpreted as a huge positive `u32`. The
  result is a single frame with a presentation timestamp shifted by roughly `2^32` timescale units into
  the future (~71 minutes at a 1e6 timescale, §5.1) — everything plays perfectly until playback reaches
  that exact frame, then stalls or jumps.
- **Time-misaligned audio/video segment boundaries when using two `SourceBuffer`s** (§9). Each buffer is
  individually well-formed, but MSE reports a buffered-range "gap" in one relative to the other, which
  surfaces as a stall precisely at ABR-switch points even though neither track, viewed alone, has a defect.
- **Calling `changeType()` without immediately following it with a fresh init segment.** Per §6.3's
  reset-parser-state algorithm, the `SourceBuffer` is now `WAITING_FOR_SEGMENT`; media-segment bytes
  appended before a new, matching init segment are not valid input. This is, empirically, the most common
  cause of "quality switching just stops playback" in a hand-rolled ABR implementation.

---

## References

- **`[BMFF]`** ISO/IEC 14496-12:2015, *Information technology — Coding of audio-visual objects — Part 12:
  ISO base media file format.* Full standard text: https://b.goeswhere.com/ISO_IEC_14496-12_2015.pdf
- **`[ISO14496-15]`** ISO/IEC 14496-15 (*AVC in ISO BMFF* — AVCDecoderConfigurationRecord). Paywalled;
  corroborated via https://github.com/sannies/mp4parser/blob/master/isoparser/src/main/java/org/mp4parser/boxes/iso14496/part15/AvcConfigurationBox.java ,
  https://gist.github.com/yohhoy/2abc28b611797e7b407ae98faa7430e7 , and
  https://github.com/MPEGGroup/CMAF/issues/10 (High-profile extension fields).
- **`[VP9-ISOBMFF]`** *VP Codec ISO Media File Format Binding*, WebM Project. https://www.webmproject.org/vp9/mp4/
- **`[AV1-ISOBMFF]`** *AV1 Codec ISO Media File Format Binding*, Alliance for Open Media. https://aomediacodec.github.io/av1-isobmff/
- **`[RFC6381]`** RFC 6381, *The 'Codecs' and 'Profiles' Parameters for "Bucket" Media Types.* https://www.rfc-editor.org/rfc/rfc6381.html
- **`[RFC8216]`** RFC 8216, *HTTP Live Streaming.* https://www.rfc-editor.org/rfc/rfc8216
- **`[MSE-BSF-ISOBMFF]`** W3C, *ISO BMFF Byte Stream Format* (MSE byte-stream format registry entry). https://w3c.github.io/mse-byte-stream-format-isobmff/
- **`[MSE]`** W3C, *Media Source Extensions™.* https://w3c.github.io/media-source/
- **`[APPLE-HLS-AUTH]`** Apple, *HTTP Live Streaming (HLS) Authoring Specification for Apple Devices*
  (current revision, 2025-06-26). https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices
- **`[MP4A-WIKI]`** *MPEG-4 Audio* (AudioSpecificConfig bit layout, object types, sampling-frequency-index
  table). https://wiki.multimedia.cx/index.php/MPEG-4_Audio
- **`[WEBCODECS-AVC]`** W3C, *AVC (H.264) WebCodecs Registration.* https://www.w3.org/TR/webcodecs-avc-codec-registration/
- **`[WEBCODECS]`** W3C, *WebCodecs API* (`EncodedVideoChunk`/`EncodedAudioChunk` timestamp/duration in
  microseconds). https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk
- **`[MP4-MUXER]`** Vanilagy, *mp4-muxer* — a real, hand-written TypeScript fMP4 muxer for WebCodecs
  output, used throughout this document as a working cross-check. https://github.com/Vanilagy/mp4-muxer
  (files referenced: `src/box.ts`, `src/muxer.ts`, `src/misc.ts`, `src/writer.ts`)
- **`[CMAF-SUMMARY]`** ISO/IEC 23000-19 (CMAF) is paywalled; structural-constraint summaries corroborated
  across https://www.mpegflow.com/topics/protocols/cmaf and https://antmedia.io/cmaf-streaming/

**Worked example artifact:** a byte-verified 640-byte minimal init segment (single `avc1` video track,
fabricated placeholder SPS/PPS, real spec-conformant box structure) was generated and parsed back to
confirm every box's declared `size` field is internally consistent, using a small Python script against
the exact field layouts documented above. Its box tree:

```
ftyp size=28
moov size=612
  mvhd size=108
  trak size=456
    tkhd size=92
    mdia size=356
      mdhd size=32
      hdlr size=45
      minf size=271
        vmhd size=20
        dinf size=36
          dref size=28
        stbl size=207
          stsd size=131   (contains avc1 + avcC)
          stts size=16    (empty)
          stsc size=16    (empty)
          stsz size=20    (empty)
          stco size=16    (empty)
  mvex size=40
    trex size=32
```

First 48 bytes (`ftyp` box, and the start of `moov`/`mvhd`) as a hex dump, annotated:

```
offset  bytes                                            field
0x0000  00 00 00 1c                                       ftyp.size = 28
0x0004  66 74 79 70                                       'ftyp'
0x0008  69 73 6f 35                                       major_brand = 'iso5'
0x000c  00 00 02 00                                       minor_version = 0x200
0x0010  69 73 6f 35                                       compatible_brands[0] = 'iso5'
0x0014  69 73 6f 36                                       compatible_brands[1] = 'iso6'
0x0018  6d 70 34 31                                       compatible_brands[2] = 'mp41'
0x001c  00 00 02 64                                       moov.size = 612
0x0020  6d 6f 6f 76                                       'moov'
0x0024  00 00 00 6c                                       mvhd.size = 108
0x0028  6d 76 68 64                                       'mvhd'
0x002c  00 00 00 00                                       mvhd version(0)+flags(0)
0x0030  00 00 00 00                                       creation_time = 0
0x0034  00 00 00 00                                       modification_time = 0
0x0038  00 00 03 e8                                       timescale = 1000
0x003c  00 00 00 00                                       duration = 0
0x0040  00 01 00 00                                       rate = 1.0 (fixed 16.16)
0x0044  01 00                                              volume = 1.0 (fixed 8.8)
0x0046  00 00                                              reserved
```
