# Audio Fingerprinting for Content ID

Implementation-grade reference for landmark (Shazam-style) audio fingerprinting: the algorithm, its parameters, robustness envelope, our concrete parameter choices, the FFT we have to write ourselves, how to get PCM out of a browser Worker or Node, the Postgres schema and match query, the product layer, and how to test it.

Primary source: Avery Li-Chun Wang, ["An Industrial-Strength Audio Search Algorithm"](http://www.ee.columbia.edu/~dpwe/papers/Wang03-shazam.pdf), ISMIR 2003 (the "Shazam paper"). Read in full for this document. Supplemented by the Shazam patent (Wang & Smith, [US 6,990,453 B2](https://patents.google.com/patent/US6990453B2/en), filed 2000/2002, granted 2006), which is more numerically explicit than the paper.

---

## 1. The Shazam algorithm, precisely

### 1.1 What the 2003 paper actually specifies (and what it doesn't)

The ISMIR paper is the canonical reference for the *architecture* of the algorithm but is deliberately light on exact signal-processing constants — it never states a window function, window size, or hop size. It does state:

- **Audio format**: "Audio sampling and processing was carried out using 8KHz, mono, 16-bit samples." (§3.1)
- Peaks are picked from a spectrogram; "a 1024-bin frequency axis yields only at most 10 bits of frequency data per peak" (§2.2) — illustrative of the order of magnitude, not a precise spec (1024 bins vs. 513 = 1024/2+1 real-FFT bins is not disambiguated in the text).

The **patent** (US 6,990,453 B2) gives the numbers the paper omits, describing one concrete embodiment:

> "a sampling rate of 8000 Hz, an FFT frame size of 1024 samples, and a stride of 64 samples for each time slice" using a "Hanning-windowed Fast Fourier Transform (FFT)"

That is a **1024-sample Hann-windowed FFT, 64-sample hop → 93.75% overlap**, at 8 kHz mono. This is an extremely dense STFT (≈125 spectral frames/second) — appropriate for Shazam's original use case (identifying a few seconds of audio recorded through a noisy cellphone mic), not necessarily what we want (§3).

**Practical implementations reconstruct these parameters differently** (all confirmed from source, see §1.7 and §3):

| | sample rate | FFT size | window | hop | overlap |
|---|---|---|---|---|---|
| Shazam patent (US 6,990,453 B2) | 8000 Hz | 1024 | Hann | 64 | 93.75% |
| [dejavu](https://github.com/worldveil/dejavu) | native (no forced resample) | 4096 | Hann | 2048 | 50% |
| [audfprint](https://github.com/dpwe/audfprint) | 11025 Hz | 512 | Hann | 256 | 50% |

Every implementation uses a Hann (dejavu/audfprint) or Hanning-branded (the patent uses "Hanning," an older name for the same window) window. None uses a rectangular or Hamming window. 50% hop is the norm outside Shazam's own extreme-overlap design point.

### 1.2 Spectral peak picking

A time-frequency point $(t_0, f_0)$ is a candidate peak "if it has a higher energy content than all its neighbors in a region centered around the point" — a **local maximum** test over a 2D neighborhood. The patent is more specific: a point at $(t_0,f_0)$ is selected "if it is the maximum-energy point within a rectangle with corners $(t_0\pm T, f_0\pm F)$" — i.e. a $2T \times 2F$ rectangular neighborhood in time and frequency. Neither document gives concrete values for $T$ and $F$; the patent says only that they are "chosen to provide a suitable number of constellation points."

**Density/robustness tradeoff** — this is the important part, and the paper reproduces it directly (§2, §2.2):

- Candidate peaks are chosen **according to a density criterion**, so the time-frequency plane has "reasonably uniform coverage" — not just the single loudest points, but the loudest point in each local region, spread across the whole spectrogram.
- Peaks are also chosen by amplitude within each locality, "with the justification that the highest amplitude peaks are most likely to survive" noise and distortion.
- The patent states a rule of thumb: **"a good landmarking scheme marks about 5–10 landmarks per second"** of audio.
- **More density → more redundancy → more robust to loss of individual peaks, but combinatorially more hashes → more storage and more spurious collisions.** The paper's own words: "Insufficient entropy leads to excessive and spurious matches at non-corresponding locations... too much entropy usually leads to fragility and non-reproducibility of fingerprint tokens in the presence of noise." §1.3's fan-out discussion quantifies this tradeoff precisely.
- "Different fan-out and density factors may be chosen for different signal conditions. For relatively clean audio, e.g. for radio monitoring applications, F may be chosen to be modestly small and the density can also be chosen to be low, versus for the somewhat more challenging mobile phone consumer application." (§2.2) — this is directly relevant to us: we are matching re-encoded video audio, not a phone-mic recording of a noisy bar, so we sit at the "radio monitoring" end of this spectrum.

Real implementations pick peaks differently from each other, and neither matches the paper's language literally:

- **dejavu** treats the whole spectrogram as a 2D image and finds local maxima with `scipy.ndimage.maximum_filter` over a dilated neighborhood (`PEAK_NEIGHBORHOOD_SIZE = 10`), thresholded at `amp_min = 10` dB. No log-frequency banding.
- **audfprint** uses an adaptive decaying-threshold forward/backward prune per frame, capped at `maxpksperframe = 5`, with an explicit tunable density target (`DENSITY`, default 20/s, CLI `-n`; their MIREX-tuned configuration used 70/s).

Neither open implementation actually splits the spectrum into fixed log-frequency bands and picks one peak per band (a description sometimes repeated online) — dejavu does global 2D local-maxima detection; audfprint does per-frame adaptive thresholding.

### 1.3 The constellation map and combinatorial hashing

Once peaks are picked, amplitude is discarded — a peak is just a $(t, f)$ coordinate. The sparse set of coordinates is the **constellation map** (named because the scatter plot "resemble[s] a star field," §2.1). Registering (sliding) a query's constellation map against a database track's is described directly as the brute-force approach the rest of the algorithm exists to avoid — "rather slow, due to raw constellation points having low entropy" (a 1024-bin frequency axis is only ~10 bits per point).

**Combinatorial hashing** (§2.2, Fig. 1C/1D):

1. Choose **anchor points** from the constellation map — in the simplest scheme, every point is an anchor.
2. Each anchor has an associated **target zone**: a region of the constellation map some distance ahead of it in time. The patent's formal definition: for anchor $(t_0, f_0)$, the target zone is $\{(t,f) : t \in [t_0+L,\ t_0+L+W],\ f \in [f_0-F,\ f_0+F]\}$, where $L$ is the **lead** (minimum forward offset, to avoid pairing an anchor with itself or with points too close to carry independent information) and $W$ is the target zone's **time width**; $F$ bounds it in frequency. Neither document gives numeric values for $L$, $W$, $F$ — those are implementation choices (see §1.7, §3 for what real systems and we use).
3. The anchor is **sequentially paired with each point inside its target zone**. Each pair $\big((t_1,f_1), (t_2,f_2)\big)$ yields a hash from $(f_1, f_2, \Delta t)$ where $\Delta t = t_2 - t_1$ (Fig. 1D: `Hash:time = [f1:f2::Δt]:t1`).
4. **Each hash is packed into a 32-bit unsigned integer.** The anchor's absolute time $t_1$ is stored *alongside* the hash, not inside it — "the absolute time is not a part of the hash itself" (§2.2).
5. Track ID is appended to build a 64-bit database record: **32 bits hash + 32 bits (time offset + track ID)**.

**Fan-out.** The number of target-zone points paired per anchor is the **fan-out factor F**. The paper works a concrete example with F=10: hashes/sec ≈ (constellation-point density/sec) × F. Note this is genuinely combinatorial ("*pairs* of time-frequency points... combinatorially associated") — it is not one hash per anchor, it is up to F hashes per anchor, one per paired target point.

**Why pairs, not single points — the speedup and survivability math (reproduced from §2.2):**

- A single constellation point carries only ~10 bits (frequency alone). A hash from a pair carries ~30 bits (two 10-bit frequencies + a 10-bit Δt in the paper's illustrative numbers) → roughly **10<sup>6</sup>× more specific**, so a single-hash index lookup is that much faster.
- But combinatorial generation means both the query and the database have **F× as many tokens** to search, so net speedup is $\frac{1{,}000{,}000}{F^2}$ — **≈10,000× for F=10**.
- **Combinatorial hashing squares the probability of point survival.** If $p$ is the probability a single spectrogram peak survives degradation (noise, compression) from source to captured sample, then a *hash from a pair* survives only with probability $\approx p^2$ (both points in the pair must survive). This is the direct cost of the speedup.
- This is mitigated by fan-out: with $F$ target points per anchor, the probability that **at least one** hash survives for a given anchor is $p \cdot [1-(1-p)^F]$. For $F>10$ and $p>0.1$, this is $\approx p$ — i.e. **fan-out approximately restores single-point survivability while keeping the combinatorial search speedup.**
- Net accounting, in the paper's own words: **"we have traded off approximately 10 times the storage space for approximately 10000 times improvement in speed, and a small loss in probability of signal detection."**

### 1.4 Quantisation and a concrete 32-bit hash layout

Neither the paper nor the patent gives a full canonical bit layout (the patent's only concrete bit example is a *scheme-selector* trick unrelated to frequency/Δt encoding: "in a 32-bit fingerprint value, the first 3 bits can be used to specify which of 8 fingerprinting schemes the following 29 bits are encoding" — i.e. multiple fingerprint *types* can share the 32-bit space, not a spec for this particular hash's fields). The paper's own worked example allocates **10 bits to each of $f_1$, $f_2$, and $\Delta t$ = 30 bits, fitting inside the 32-bit word with 2 bits to spare.** audfprint's actual production layout (from source) is narrower and delta-encoded: `F1_BITS=8` (absolute freq1 bin), `DF_BITS=6` (freq2−freq1, signed), `DT_BITS=6` (Δt) = 20 of 32 bits used, 12 reserved.

**Recommended layout for our implementation** (used consistently in §3's parameter estimates), following the paper's simpler absolute-$f_1$/absolute-$f_2$ scheme rather than audfprint's delta encoding, because it maps directly onto the paper's own diagram and is trivial to pack/unpack:

```
bit:   31        26 25          17 16           8 7            0
      [ reserved 6 ][  freq1  9  ][  freq2  9   ][   Δt   8    ]
        (0, spare)   bin index      bin index      hops forward
                      0–511          0–511          0–255
```

- **freq1 / freq2 — 9 bits each (0–511).** With our FFT size (1024 samples, §3) a real FFT produces 513 usable bins (0..512, DC to Nyquist). We drop bin 0 (DC) and the top bin (Nyquist) — both are near-zero energy for music/speech — leaving exactly 511 bins, which fits in 9 bits (2⁹=512).
- **Δt — 8 bits (0–255 hops).** At our hop size (§3, 512 samples @ 11025 Hz ≈ 46.4 ms/hop), 255 hops ≈ 11.8 s of forward reach — comfortably covers a target zone sized for whole-track matching. (Shazam's own worked example used 10 bits for Δt; audfprint uses 6; 8 is a reasonable middle value for our larger target-zone reach.)
- **6 reserved bits** — left as zero. Could later carry a coarse octave/band tag or a fingerprint-scheme selector, mirroring the patent's scheme-selector idea, without changing the layout.

```ts
// illustrative only — packing/unpacking the 32-bit hash
function packHash(freq1: number, freq2: number, dtHops: number): number {
  return ((freq1 & 0x1ff) << 17) | ((freq2 & 0x1ff) << 8) | (dtHops & 0xff);
}
function unpackHash(h: number) {
  return { freq1: (h >>> 17) & 0x1ff, freq2: (h >>> 8) & 0x1ff, dtHops: h & 0xff };
}
```

Frequency is bucketed as a **raw linear FFT bin index**, exactly as both the paper and patent do (neither uses a log-frequency/mel/chroma axis — that is Chromaprint's approach, contrasted in §2). Δt is bucketed in **integer hop units**, not milliseconds, so it is naturally quantized by the STFT's own time resolution.

### 1.5 Matching: inverted index, scatterplot, histogram, score

**Index.** The database is exactly a hash → postings-list inverted index: sort all (hash, track_id, anchor_time) triples by hash value (§2.2: "the 64-bit structs are sorted according to hash token value"). A query is fingerprinted the same way, and each query hash does an equality lookup into this index.

**Scatterplot.** For every matching hash found, form a time pair $(t'_k, t_k)$ — database anchor time vs. query anchor time — and bin these pairs by track ID. Within one track's bin, this set of pairs is literally a scatterplot: query time on one axis, database time on the other.

**Why a spike vs. a flat distribution.** If the query really is a clip of that database track, then for *every* correctly-matched hash the relationship $t'_k = t_k + \text{offset}$ holds, for the *same* offset (the true alignment between the clip and the track) — so all the true-match points sit on one line of slope 1, and $\delta t_k = t'_k - t_k$ collapses into one narrow histogram bin (Fig. 3B: a spike above 25 at the correct offset, everything else near 0–1). If the query is unrelated, hash collisions are essentially coincidental accidents of the hash's finite entropy — they land at random relative offsets, so $\delta t_k$ is spread across the whole range with no bin standing out (Fig. 2B: nothing above ~1–2). This is the entire trick: **turn "does this look like a match" into "is there an outlier bin in a 1-D histogram,"** which is solvable in $O(N\log N)$ (sort the $\delta t_k$ values, scan for the biggest cluster) instead of a 2-D robust-regression problem (Hough transform etc., explicitly rejected in the paper as "overly general, computationally expensive, and susceptible to outliers").

**Scoring rule.** *The score is simply the number of matching, time-aligned hash tokens in the winning histogram bin* (§2.3, quoted directly). Not a normalized similarity fraction, not a probability — a raw count.

**Threshold.** The paper's own methodology (§2.3.1, "Significance"), reproduced verbatim in spirit: collect the empirical distribution of scores among *incorrectly*-matching tracks across the whole database, derive the probability that the highest-scoring wrong track exceeds a given score, pick an acceptable false-positive rate (paper's examples: 0.1% or 0.01%, "depending on the application"), and set the threshold at the score that meets it. This is a data-driven calibration, not a fixed constant — it has to be re-derived for the size and content of *your* reference set (see §8 for how to do this for ours).

### 1.6 Robustness of the matching step itself

Two structural properties the paper calls out explicitly, worth restating because they matter for our implementation:

- **Discontinuity tolerance**: "a property of the scatterplot histogramming technique is that discontinuities are irrelevant" — dropouts, brief masking, or a chunk of missing audio just remove some points from the scatter; the surviving points still line up. From a heavily corrupted 15-second sample, a statistically significant match was found with **only 1–2% of generated hash tokens surviving**.
- **Transparency**: because matching is peak-based and peaks approximately linearly superpose, **multiple overlapping tracks mixed together can each be independently identified** — a useful sanity check for our own test suite (§8): a mix of two reference tracks should still surface two matches.

### 1.7 What the paper leaves as genuinely unspecified

To be explicit about what is *not* pinned down by the primary sources, so nobody treats a plausible number as gospel: the ISMIR paper never states hop size, window function by name (only the patent says "Hanning"), the exact $(L, W, F)$ target-zone dimensions, or a canonical bit-field split for the hash. These are implementation choices every real system (Shazam's own patent embodiment, dejavu, audfprint) makes independently, and they disagree with each other by large factors (FFT size ranges 512–4096 across the three; sample rate 8000–11025 Hz plus dejavu's "don't touch it" default; fan-out 3–10). §3 makes and justifies our own choices from this range.

---

## 2. Robustness — what survives and what doesn't

### What the algorithm survives (documented, with the paper's own numbers)

- **Additive noise.** Figure 4 (250 queries against a 10,000-track database, noise recorded in "a noisy pub"): 50% recognition rate at **≈ −9 dB, −6 dB, −3 dB SNR** for 15-, 10-, and 5-second query clips respectively (linear PCM, no further compression).
- **Lossy voice-codec compression stacked on top of noise.** Figure 5, same setup but with the noisy mixture additionally passed through **GSM 6.10** compression and back to PCM: 50% recognition rate at **≈ −3 dB, 0 dB, +4 dB SNR** for 15/10/5-second clips — compression costs roughly 6 dB of noise headroom.
- **EQ.** Explicitly claimed insensitive, and the mechanism is given: "generally a peak in the spectrum is still a peak with the same coordinates in a filtered spectrum (assuming that the derivative of the filter transfer function is reasonably small — peaks in the vicinity of a sharp transition in the transfer function are slightly frequency-shifted)." (§2.1)
- **Level/gain changes.** Amplitude is discarded entirely at the constellation-map stage (§2.1: "at this point the amplitude component has been eliminated") — a peak's *position* doesn't move when you turn the volume up or down, only its *height*, which isn't part of the fingerprint. Level changes are therefore a non-issue by construction, not merely "survived."
- **Dropouts / masking / partial deletion.** Per §1.6 above — the histogram method degrades gracefully as points go missing.

### What it does not survive — and why, mechanically

The 2003 paper does not test or discuss pitch shift, time stretch, or speed change at all — this is a documented gap in the primary source, not an oversight on our part. The failure is a direct, structural consequence of the algorithm's design, confirmed by later analysis: pitch shift moves every spectral peak's frequency coordinate by a multiplicative factor (a pitch shift of $r$ semitones scales every $f \to f \cdot 2^{r/12}$); time stretch/speed change scales every peak's time coordinate by a factor (and, if done as a naive playback-speed change rather than true time-stretching, scales frequency the same way simultaneously, e.g. YouTube's classic "sped up 5%" trick). Because a hash is the *exact* triple $(f_1, f_2, \Delta t)$ quantized into fixed bins, **any multiplicative rescale changes the bin index of $f_1$, $f_2$, and $\Delta t$ almost everywhere — the query's hashes and the database's hashes stop being equal**, so the inverted-index lookup in §1.5 simply misses. This is not a matter of tuning a threshold; the hash *keys themselves* diverge. ([A local fingerprinting approach for audio copy detection](https://ar5iv.labs.arxiv.org/html/1304.0793) states this mechanism directly and cites published tolerance bounds for two well-known systems: Haitsma & Kalker's Philips fingerprint tolerates only "up to around 4%" pitch/tempo change, and Google's Waveprint tolerates "speed changes up to 2% and tempo changes up to 10%" — both far short of the kind of deliberate 10–50% pitch/speed shift an uploader can apply in one click.)

This is exactly the evasion YouTube uploaders are documented to use against Content ID (speed-up, pitch-shift, or both, sometimes combined with mirroring/cropping on the video side) — reported widely in press coverage; Google has never confirmed the counter-measures in the algorithm itself (see §7's disclosure discussion).

**What a real system does about it (general literature, not a confirmed description of YouTube specifically):** the two documented architectural responses are (a) **searching multiple resampled/pitch-shifted versions** of the query (or precomputing the reference fingerprints at several pitch/tempo offsets) so that a shifted upload still collides with *some* precomputed variant — a brute-force multiplication of index size and query cost by the number of variants searched; or (b) switching to a **representation that is invariant to the distortion by construction**, e.g. a log-frequency or chroma axis where pitch shift becomes a *pure translation* rather than a rescale (this is architecturally what Chromaprint does — see §2 below — though even Chromaprint is not documented as doing an explicit transposition search; only octave-folding is confirmed, see below).

**We will not solve this.** Our replica implements the plain linear-frequency landmark algorithm as described above. It will not detect a pitch-shifted or sped-up re-upload of a reference track. This is a known, explicitly out-of-scope limitation, not a bug — and it is worth a test that documents it as expected behavior rather than silently failing (§8).

### Chromaprint / AcoustID — a genuinely different approach, for contrast

[Chromaprint](https://github.com/acoustid/chromaprint) (the fingerprinting library behind [AcoustID](https://acoustid.org), which backs MusicBrainz) solves a different problem — "is this the same recording" for whole-track identification and deduplication, not needle-in-a-haystack clip spotting in noisy/overlapping audio — with a **chroma-based** method instead of linear-frequency landmarks:

- Audio is resampled to **11025 Hz**; the STFT uses a **4096-sample frame with 2/3 overlap** (hop ≈ 1365 samples ≈ 124 ms). FFT bins are mapped to musical notes and folded across octaves into a **12-bin chroma vector per frame** ("we are only interested in notes, not octaves, so the result has 12 bins, one for each note" — [Lalinský, "How does Chromaprint work?"](https://oxygene.sk/2011/01/how-does-chromaprint-work/)).
- Successive chroma frames stack into a 2-D image (time × 12 pitch classes). A 16×12 window slides across this image one frame at a time; at each position, **16 Haar-like rectangle-difference filters** (selected by machine learning on training data, not hand-designed) each produce a 2-bit quantized value, Gray-coded — 16 × 2 bits = **one 32-bit integer per ~124 ms frame** (≈8 fingerprint ints/sec). Basis papers credited by the project: Ke/Hoiem/Sukthankar 2005, Kurth & Müller 2008, Jang et al. 2009.
- Matching compares two fingerprints' 32-bit ints via **Hamming distance** (bit-error rate) after finding the best temporal alignment via an offset histogram over the top 12 bits of each int (`ACOUSTID_MAX_ALIGN_OFFSET=120`, `ALIGN_BITS=12` in [fingerprint_matcher.cpp](https://github.com/acoustid/chromaprint/blob/master/src/fingerprint_matcher.cpp)) — a sliding search along the **time** axis, structurally analogous to Shazam's δt histogram, but over Hamming distance of chroma-derived bits rather than exact hash equality.

**Why this contrast matters:** folding all octaves of a pitch class into one bin makes Chromaprint's representation **octave-invariant by construction** — a big structural advantage over exact-frequency-bin landmark hashing when the distortion is (for example) an EQ that emphasizes different octaves. However, no primary source confirms Chromaprint performs an explicit **transposition (key-shift) search** the way it does a temporal-offset search — only octave-folding is confirmed; treat cross-key/tempo invariance as unconfirmed, not a property to assume. The project's own README describes its goal as trading "precision and robustness for search performance" for **whole-file identification and duplicate/stream-monitoring**, not short-clip-in-noise detection — a different point in the design space from what Content ID needs (identify a 10-second reused excerpt buried inside an unrelated 20-minute upload), which is exactly the problem Wang's landmark hashing was built to solve. **We are using the landmark approach, not Chromaprint's, because our problem — find a short reused excerpt inside a much longer, arbitrary upload — is the one landmark hashing was purpose-built for**, at the acknowledged cost of the pitch/tempo fragility above.

---

## 3. Parameters for our case

Our situation differs from Shazam's founding use case (5–15 s captured through a phone mic in a noisy room, against ~2M tracks) in ways that should shape parameter choices: our queries are **entire uploaded videos' audio tracks** (minutes long, not seconds), our reference catalog is **a few hundred to a few thousand tracks** (not millions), and our source material is a **clean re-encode**, not a live mic capture — closer to the paper's own "radio monitoring" regime, where it explicitly says fan-out and density can be "modestly small" (§1.2, §2.2). We do still want headroom for the transcode-quality and light-EQ/loudness-normalization degradation real uploads go through.

**Recommended parameters:**

| parameter | value | rationale |
|---|---|---|
| sample rate | 11025 Hz, mono | matches audfprint's field-tested default; covers content up to ~5.5 kHz (plenty for melodic/harmonic identification); 4× less compute than 44.1 kHz |
| FFT size | 1024 samples (~93 ms @ 11025 Hz) | between Shazam's 1024@8kHz and audfprint's 512@11025Hz; enough frequency resolution (≈10.8 Hz/bin) for the 9-bit bin quantization in §1.4 |
| window | Hann | universal choice across every source reviewed |
| hop | 512 samples (50% overlap, ≈46.4 ms) | matches dejavu/audfprint's 50% convention; far less compute than Shazam's 93.75%-overlap design, appropriate since our source audio isn't phone-mic-noisy |
| peak density target | ~30 peaks/sec | inside the paper's own 5–10/s baseline-to-mobile range scaled toward audfprint's 20–70/s range; chosen because we're at the "clean audio" end of the spectrum, not the "cellphone in a bar" end |
| fan-out (F) | 5 | matches dejavu's current default; well inside the paper's F>10-is-safe zone is not required at our density since we have long queries (whole videos), not 5–15 s clips — more temporal redundancy naturally compensates for a smaller F |
| target zone | 1–255 hops forward (≈46 ms–11.8 s), ±any freq (absolute f2 stored, §1.4) | sized to the 8-bit Δt field in our hash layout |

**Estimate: fingerprints generated per minute of audio.**
$$\text{hashes/sec} = \text{peak density} \times F = 30 \times 5 = 150 \implies \textbf{9{,}000 hashes/minute}$$

**Estimate: index size.** For a representative catalog of 2,000 reference tracks averaging 4 minutes each (8,000 track-minutes):
$$8{,}000 \text{ min} \times 9{,}000 \text{ hashes/min} \approx \textbf{72{,}000{,}000 rows}$$
At roughly 40–60 bytes/row realized on disk once Postgres's per-tuple header (~24 bytes) and a btree index entry are both accounted for (see §6), that's on the order of **5–7 GB** total for table + index — comfortably inside a single modern Postgres instance, no partitioning required at this catalog size. (This is an order-of-magnitude estimate, not a benchmark; see §6 for the schema it assumes.)

**Estimate: match query cost.** A 10-minute uploaded video generates $10 \times 9{,}000 = 90{,}000$ query hashes. Each does one btree equality lookup against a ~72M-row index ($\log_2(72\text{M}) \approx 26$, i.e. a handful of B-tree page reads, sub-millisecond each with a warm cache). Because our hash has 26 meaningful bits (32 minus 6 reserved) of entropy, accidental cross-track collisions are rare, so the realistic candidate-row count returned across all 90,000 lookups is small relative to the full index (dominated by true matches for the one correct track, plus a low noise floor) — the aggregation/histogram step (§6) then operates on tens of thousands of rows at most, which Postgres's hash-aggregate executor handles in low tens of milliseconds. Total: **order of tens to low hundreds of milliseconds per full-video match query** against a several-thousand-track catalog — well within an async job worth doing once per upload, not a hot request path.

---

## 4. FFT in TypeScript

We are not pulling in a DSP library for this — a radix-2 iterative Cooley-Tukey FFT is short, well-understood, and exactly matches our power-of-two frame size (1024, §3).

**Hann window** (applied to the frame before FFT):
$$w[n] = 0.5 \left(1 - \cos\!\left(\frac{2\pi n}{N-1}\right)\right), \quad n = 0, \dots, N-1$$
(Use the *periodic* form, $w[n]=0.5(1-\cos(2\pi n/N))$, if you ever need exact overlap-add reconstruction; for pure analysis — our case, we never resynthesize audio — the symmetric form above is standard and fine.)

**Bit-reversal permutation.** For an $N=2^k$-point FFT, the iterative algorithm requires the input reordered so that the sample at index $i$ moves to index $\text{rev}_k(i)$, the $k$-bit binary reversal of $i$. The standard in-place way to build this without computing $\text{rev}$ from scratch per index:

```ts
function bitReverseInPlace(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j |= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
}
```

**Iterative radix-2 decimation-in-time FFT.** After bit-reversal, combine butterflies in $\log_2 N$ stages, each stage doubling the sub-transform size:

```ts
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length; // must be a power of 2
  bitReverseInPlace(re, im);
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const angleStep = (-2 * Math.PI) / size; // forward transform
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = angleStep * k;
        const wr = Math.cos(angle), wi = Math.sin(angle);
        const evenI = start + k, oddI = start + k + half;
        const tr = re[oddI] * wr - im[oddI] * wi;
        const ti = re[oddI] * wi + im[oddI] * wr;
        re[oddI] = re[evenI] - tr; im[oddI] = im[evenI] - ti;
        re[evenI] += tr;           im[evenI] += ti;
      }
    }
  }
}
```

This is $O(N \log N)$. Input is real-valued audio, so `im` starts as all zeros; magnitude for peak-picking is $\sqrt{re[k]^2+im[k]^2}$ for $k=0..N/2$ (the real-input redundancy — bin $N-k$ is the conjugate of bin $k$ — means only the first half needs computing/storing, matching the "513 bins for a 1024-point FFT" figure used in §1.4). A further optimization (packing two real 1024-sample frames into one complex 1024-point FFT, or using a dedicated real-FFT algorithm) is possible but not necessary for correctness — the recognized real-input redundancy above is enough; skip the packing trick unless profiling says the FFT is actually the bottleneck.

**What the platform can and can't do for us.** `AudioContext.decodeAudioData()` / `OfflineAudioContext` (both inherited from [`BaseAudioContext`](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)) can do the *decode* and *resample/downmix* steps for us (§5) — but **not** the STFT, peak-picking, or hashing; there is no built-in API for any of that.

**`AnalyserNode` is not usable here, and it's worth saying precisely why so nobody reaches for it:**

1. `getFloatFrequencyData()`/`getByteFrequencyData()` return **smoothed magnitude only**, in dB, blended across successive calls by `smoothingTimeConstant` (default 0.8, an exponential moving average) — not a raw, independent FFT frame.
2. **No phase is exposed** anywhere on the interface.
3. It uses a **fixed internal window sized exactly to `fftSize`** — the spec fixes this to a Blackman window ("FFT Windowing and Smoothing over Time," [Web Audio API spec](https://webaudio.github.io/web-audio-api/#current-time-domain-data)) — not swappable for the Hann window we want.
4. It is a **pull API**: each getter call reads whatever is currently sitting in the node's internal ring buffer *at the moment you call it* — it is not a driven, fixed-hop STFT. Getting one uncorrelated spectrum per hop, at a hop size independent of `fftSize`, requires manually driving reads from an `AudioWorklet`'s `process()` callback (fixed 128-sample render quantum) with careful bookkeeping — awkward, and still gives no phase and no windowing control.

`AnalyserNode` is designed for real-time visualization, not for offline, sample-accurate, custom-windowed landmark analysis. Use the FFT above instead.

---

## 5. Getting the audio

### In the browser

The task already places us inside a **Worker**, during the transcode pass. This constrains the choice more than it might first appear: **`AudioContext`/`OfflineAudioContext` (and therefore `decodeAudioData`) are not available inside a Worker** — `OfflineAudioContext` is a Window-scoped interface, confirmed by [MDN's `WorkerGlobalScope`/`DedicatedWorkerGlobalScope` docs](https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope) (which don't list it) and independently by reported breakage in the wild ([`OfflineAudioContext not defined in web worker`, magenta-js#483](https://github.com/magenta/magenta-js/issues/483)). **WebCodecs' `AudioDecoder`, by contrast, is explicitly available in Dedicated Web Workers** — MDN's `AudioDecoder` page states this directly: *"This feature is available in Dedicated Web Workers."* That makes `AudioDecoder` the only viable in-Worker decode path, and almost certainly what the existing transcode pass is already using to get PCM at that point in the pipeline.

Using it: `AudioDecoder` is configured with a codec string, `sampleRate`, and `numberOfChannels` (`AudioDecoderConfig`) describing the *source* stream's actual format — these are not resampling targets, they tell the decoder how to interpret the bitstream. It consumes `EncodedAudioChunk`s and emits `AudioData` frames via a callback; `AudioData.copyTo(destination, { planeIndex, format })` copies out raw samples as interleaved or planar `f32`/`s16`/etc. **`AudioDecoder` does not parse containers** — it only decodes chunks already demuxed from MP4/WebM/OGG, so a demuxer is required upstream (the transcode pass already has to do this to feed the decoder in the first place). Two practical consequences for fingerprinting specifically:

- **Output comes out at the source's native sample rate** (whatever the upload was encoded at — typically 44.1 or 48 kHz), not our target 11025 Hz (§3). `AudioDecoder` does not resample. Since `OfflineAudioContext` (the usual way to force a target rate) isn't available in a Worker either, downsampling to 11025 Hz has to be done ourselves — a simple low-pass + decimate, or just running the FFT at a larger size to match the native rate (more compute, not incorrect).
- **Mono downmix is also on us**: average the channel planes from `copyTo()` (`0.5 * (L + R)`), matching the same formula the Web Audio API's own channel-interpretation spec uses for 2→1 downmix.

Browser support: Chrome/Edge 94+, Firefox 130+ (desktop only), Safari 26+, per [MDN's browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/AudioDecoder.json) — broadly available at this point.

(If the fingerprinting step ever runs on the **main thread** instead — e.g. during upload preview rather than the Worker transcode pass — `decodeAudioData` becomes viable again and is genuinely simpler: construct an `OfflineAudioContext` at `sampleRate: 11025, numberOfChannels: 1` up front, call `decodeAudioData` on it, and the resample-and-downmix happens for free per the [Web Audio API spec's resampling behavior](https://webaudio.github.io/web-audio-api/#dom-baseaudiocontext-decodeaudiodata).)

### In Node (server-side path)

There is no way to decode compressed audio (AAC/MP3/Opus) to PCM in Node without *some* compiled DSP dependency — the only real choice is **shelling out to the ffmpeg CLI binary** vs. **an in-process compiled decoder** (native addon or WASM), not "ffmpeg vs. nothing":

- **[`node-web-audio-api`](https://www.npmjs.com/package/node-web-audio-api)** — a Rust/NAPI-backed implementation of the real Web Audio API for Node (built on `web-audio-api-rs`, using the `symphonia` decoder crate under the hood), including `decodeAudioData`. This is the closest Node equivalent to the browser main-thread path above — same API, same automatic resample-to-context-rate behavior — as a native addon, not a CLI shell-out.
- **Per-codec WASM decoders** (e.g. the [`wasm-audio-decoders`](https://github.com/eshaz/wasm-audio-decoders) family: `mpg123-decoder`, `opus-decoder`/`ogg-opus-decoder`, `@wasm-audio-decoders/flac`) — Emscripten builds of libmpg123/libopus/libFLAC, runnable in-process. No CLI shell-out, but still a compiled-C-via-WASM dependency, just one that ships as an npm package instead of a system binary.
- Node has **no native WebCodecs support** as of recent versions; third-party packages claiming WebCodecs-in-Node exist but several still wrap ffmpeg internally rather than avoiding it.

For our case (Node path is a fallback/server-side option, not the primary target), `node-web-audio-api` is the pragmatic choice — it gives the same `decodeAudioData` semantics used in the browser main-thread fallback above, so the resample/downmix code can be shared between both paths.

---

## 6. SQL implementation

### Schema

```sql
CREATE TABLE reference_tracks (
    id           BIGSERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    duration_ms  INTEGER NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one row per (anchor, target-zone-point) hash generated during fingerprinting.
-- expected size at our parameters (§3): ~72M rows for a 2,000-track / 4-min-avg catalog.
CREATE TABLE fingerprints (
    hash            INTEGER  NOT NULL,   -- our packed 32-bit layout (§1.4), stored as signed int4 bit pattern
    track_id        BIGINT   NOT NULL REFERENCES reference_tracks(id) ON DELETE CASCADE,
    anchor_time_ms  INTEGER  NOT NULL    -- offset of the anchor point from the start of the track
);

CREATE INDEX idx_fingerprints_hash ON fingerprints USING btree (hash);
```

**Why a flat table with a single btree index, not something more exotic:** this is exactly the design dejavu uses in production (a single `fingerprints` table, `hash` column, plain `IN`-list equality lookup) and it's the right call at our scale (§3's ~72M rows). A **btree** index, not Postgres's native `HASH` index type, is the right index choice here too: btree is the default, general-purpose choice; a hash index buys only a marginal (roughly 10–20%, workload-dependent) constant-factor speedup on pure-equality lookups over a small (4-byte) key, at the cost of losing range-query capability, multi-column composition, and the broader tooling/replication maturity btree has (this trade only tends to favor `HASH` for large keys, not `int4`). A composite `(hash) INCLUDE (track_id, anchor_time_ms)` index-only-scan variant is worth adding once the table is this large, to avoid a heap fetch per matching row:

```sql
CREATE INDEX idx_fingerprints_hash_covering
    ON fingerprints (hash) INCLUDE (track_id, anchor_time_ms);
```

No partitioning is warranted at a few hundred–thousand tracks / ~72M rows — that's a routine size for a single btree in Postgres. Partitioning by `track_id` range would only start to matter at 10–100× this scale.

### Match query: histogram in SQL vs. in application code

Given a batch of query hashes with their own query-side anchor times, there are two ways to find the winning $(track\_id, \delta t)$ bin (§1.5):

- **Pull candidates into the app, group in memory.** `SELECT hash, track_id, anchor_time_ms FROM fingerprints WHERE hash = ANY($1)`, then bucket by `(track_id, anchor_time_ms - query_time)` in JS/TS.
- **Do the histogram in SQL**, joining the query's hashes (as a `VALUES` list or `unnest()`'d arrays) against `fingerprints` and letting Postgres's hash-aggregate executor do the `GROUP BY`/`HAVING`:

```sql
WITH query_hashes(hash, q_time_ms) AS (
    SELECT * FROM unnest($1::int[], $2::int[])   -- parallel arrays: hash, query-side anchor time
)
SELECT
    f.track_id,
    -- bucket the offset to absorb ±1 hop of quantization jitter between
    -- independently-computed query/reference STFT grids (cf. audfprint's
    -- --match-win default of 2 frames)
    round((f.anchor_time_ms - qh.q_time_ms) / 50.0) * 50 AS offset_bucket_ms,
    count(*) AS score
FROM fingerprints f
JOIN query_hashes qh USING (hash)
GROUP BY f.track_id, offset_bucket_ms
HAVING count(*) >= 10          -- calibrated per §8, not a universal constant
ORDER BY score DESC
LIMIT 20;
```

**Doing the histogram in SQL is the right call here**, for three reasons specific to our scale: (1) it avoids shipping potentially tens of thousands of raw candidate rows over the wire for every query, when only the aggregated `(track_id, offset_bucket, count)` triples are actually needed; (2) Postgres's hash-aggregate is well-optimized for exactly this shape of query, and our candidate-row count is bounded by our hash's entropy (§3) to be small relative to the full index for a genuine match; (3) `LIMIT` + `HAVING` push filtering down into the database instead of transferring, then discarding, most of the result. Pulling candidates into the application only becomes the better choice if the scoring logic needs something SQL can't express cheaply (e.g. a Gaussian-weighted spike detector rather than a hard-bucket count) — a reasonable *second pass*, applied only to the handful of tracks that already cleared the SQL-side `HAVING` bar, not to the whole candidate set.

---

## 7. The product layer

### What's actually documented about YouTube's Content ID

*(Product/policy mechanics only — Google has never published the fingerprinting algorithm's internals; every source below describes the workflow and consequences of a match, never how the match itself is computed. Treat that absence as the confirmed fact, not any single explicit "we won't disclose this" statement.)*

- **Claim mechanism.** Verified rights holders upload reference files; every new upload's audio (and video) is automatically scanned against the reference database. A match produces a **Content ID claim** — explicitly *not* an automatic takedown. ([How Content ID works](https://support.google.com/youtube/answer/2797370))
- **Policy options** a claimant sets per claim, current terminology: **Monetize** (run ads, "sometimes sharing revenue with the uploader"), **Track** (collect view statistics; video stays up, unaffected, no ads from the claim), **Block** (video isn't viewable), each settable globally or per territory. ([How Content ID works](https://support.google.com/youtube/answer/2797370); [Learn about Content ID claims](https://support.google.com/youtube/answer/6013276))
- **How it appears to the uploader.** In YouTube Studio's Content list, a "Restrictions" column shows "Claims: Video has a Content ID claim" on hover. If a previously-monetizing video is newly claimed, disputing within 5 days holds *all* ad revenue back to the claim date; disputing later only holds revenue from the dispute date forward (earlier revenue has already gone to the claimant). Monetization restores automatically once every claim on the video is released. ([Learn about Content ID claims](https://support.google.com/youtube/answer/6013276); [Monetization during Content ID disputes](https://support.google.com/youtube/answer/7000961))
- **Dispute process.** The uploader disputes on one of three documented grounds: they hold all necessary rights, the use is a "copyright exception, such as fair use," or the content was misidentified (explicitly *invalid* reasons: giving credit, owning a physical copy, choosing not to monetize). The claimant then has **30 days** to release the claim, reinstate it, or let it auto-expire. Google explicitly distinguishes this from a formal legal process: **"Content ID claims are different from copyright removal requests and copyright strikes"** — a strike only follows a valid DMCA-style legal takedown notice, a separate and more serious track with its own counter-notification procedure. ([Dispute a Content ID claim](https://support.google.com/youtube/answer/2797454))
- **Scale** (most recent published figures, via [YouTube's 2024 Copyright Transparency Report as covered by TorrentFreak](https://torrentfreak.com/youtube-processed-2-2-billion-content-id-copyright-claims-in-2024-250522/) — secondary coverage; the primary transparency-report page did not render for direct verification): **2.2 billion** Content ID claims processed in 2024, **99.43%** fully automated, **>90%** resulted in monetization, **<1%** disputed (of those, **>65%** resolved in the uploader's favor), **$12B+** cumulative payout to rights holders since the system's inception (~$3B in 2024 alone). An earlier anchor: over **$100M invested** in building Content ID, **$3B+** paid out as of the 2018 "How Google Fights Piracy" report ([Google blog, Nov 2018](https://blog.google/outreach-initiatives/public-policy/protecting-what-we-love-about-internet-our-efforts-stop-online-piracy/)).

### The minimal honest version for our replica

Given what's real above and what our matcher can actually do (§1–§3), a defensible minimal version:

1. **Match → claim, not takedown.** A score above the calibrated threshold (§1.5, §8) against a reference track creates a `content_id_claims` row referencing the uploaded video, the matched reference track, the matched time range, and the score — automatically, at upload/transcode time. It does not touch video availability by itself.
2. **Three policy fields on the reference track**, set once by whoever registered it: `block | monetize | track`, mirroring YouTube's terminology exactly since it's a well-tested, minimal design (no need to invent a fourth option). `block` flips the uploaded video to unlisted/unplayable; `monetize` and `track` both leave it up, differing only in whether ad revenue (if the replica has any) is redirected.
3. **Uploader visibility**: a claim badge on the video in the uploader's dashboard, with the matched track title and time range shown — no more detail than that (we do not need to expose our fingerprint internals).
4. **Dispute = a status flag + a free-text reason**, no legal review pipeline: uploader disputes, claimant is notified, claimant can release (deletes the claim) or reinstate (keeps it); if the claimant does nothing for a fixed window, auto-release. Copying the real 30-day window is a reasonable, realistic default even though nothing forces it for a toy project.
5. **No DMCA-equivalent track.** Modeling the claim/dispute loop honestly is worth doing; modeling a legal takedown-and-counter-notice process is out of scope and would be product theater, not a useful thing to build.

---

## 8. Test strategy

### Generating a synthetic reference + degraded query

Build a small synthetic corpus rather than relying on real copyrighted audio: e.g. N=50–100 short generated tracks (mixes of tones/noise/simple synthesized melodies at varying tempo/timbre so they're acoustically distinct from each other — distinctness matters for the non-match test below). Fingerprint and index all of them as the reference catalog. For each **positive** test:

1. Take a **10-second excerpt from the middle** of a reference track (mirrors Wang's own test methodology, §1.6/§3.1 of the paper — always tested with excerpts "taken from the middle of each test track," not the start).
2. Apply one degradation (see table).
3. Run it through the matcher.
4. Assert: (a) the correct track_id wins, (b) the score clears the calibrated threshold, and (c) **the recovered time offset matches the excerpt's true position in the source track** within one hop's tolerance (§6's bucket width) — asserting the offset, not just the track ID, is what actually proves the histogram/scatterplot mechanism is implemented correctly rather than just "some hash collided a lot."

| degradation | mirrors | expected result |
|---|---|---|
| additive white/pink noise, several SNR levels | Wang §3.1, Fig. 4 | recognition should degrade gracefully with SNR, not cliff-edge; a 10s clean-ish clip should match reliably down to roughly the −6 dB region reported in the paper for a 10s clip, since our source is cleaner (no phone-mic capture) than Wang's noisy-pub test signal |
| re-encode at a low bitrate (transcode → decode back to PCM) | Wang §3.1, Fig. 5 (GSM 6.10 stood in for lossy codec compression) | should still match; scores lower than the clean case but well above threshold |
| gain change (e.g. −12 dB and +6 dB) | §2 (level invariance) | should match at essentially the same score as unmodified — this should be the *least* affected degradation, since amplitude is discarded before hashing (§1.2); a test that shows *any* score drop here is worth investigating, not shrugging off |
| simple EQ (e.g. a low-shelf or high-shelf filter) | §2 (EQ insensitivity) | should still match; mild score reduction acceptable, total loss is not |
| pitch shift (e.g. +2 semitones) and/or speed change (e.g. +5%) | §2 (documented non-robustness) | **expected to NOT match** (or match with score far below threshold) — write this as an explicit assertion of the *documented limitation*, not skip it. A pitch-shift test that unexpectedly *passes* is a signal something's wrong with the test's degradation, not evidence the matcher secretly handles pitch shift |

### Asserting a non-match reliably — the harder test

A single "unrelated audio doesn't match" test is weak evidence (any threshold, however miscalibrated, passes it trivially if the unrelated clip is different enough). The paper's own approach (§2.3.1) is the right model: **build the empirical distribution of false-positive scores and set the threshold from it**, then test that distribution stays where it should, not just that one query returns a "no match."

Concretely: run every one of the N synthetic tracks as a query against **every other track** in the same catalog (leave-one-out cross non-match testing — $N(N-1)$ pairs) and record each pair's best score. Two properties to assert, together:

1. **No cross-track score exceeds the calibrated threshold.** (This is what actually validates the threshold, not an assumption.)
2. **There is a clear gap** between the maximum cross-track (non-match) score observed and the minimum true-positive score from the degradation matrix above — not just "threshold happens to sit between them," but a comfortable margin, since real uploads will be noisier than this synthetic, low-N test can fully capture. If the gap is thin, that's a signal the fan-out/density parameters (§3) need tuning before this is trustworthy at production catalog size, where more tracks means more chances for an accidental high score (the paper is explicit that false-positive rate is a function of database size, §2.3.1) — so re-run this same cross-matrix test after the catalog grows meaningfully, not just once at N=50.

A corpus deliberately including a few **near-duplicate but genuinely distinct** tracks (e.g. two different synthesized renditions of a similar melody/rhythm) strengthens this test further — it's the paper's own observation (§3.3) that the algorithm is "very sensitive to which particular version of a track has been sampled," and a non-match test that only ever compares acoustically unrelated tracks doesn't exercise that sensitivity at all.

---

## References

- Avery Li-Chun Wang, ["An Industrial-Strength Audio Search Algorithm"](http://www.ee.columbia.edu/~dpwe/papers/Wang03-shazam.pdf), ISMIR 2003.
- Avery Wang & Julius O. Smith III, ["System and methods for recognizing sound and music signals in high noise and distortion"](https://patents.google.com/patent/US6990453B2/en), US Patent 6,990,453 B2.
- Avery Wang, ["The Shazam Music Recognition Service"](https://dl.acm.org/doi/10.1145/1145287.1145312), Communications of the ACM 49(8), 2006 (referenced; full text paywalled, cited via its DOI/abstract only).
- Lukáš Lalinský, ["How does Chromaprint work?"](https://oxygene.sk/2011/01/how-does-chromaprint-work/), 2011; [acoustid/chromaprint](https://github.com/acoustid/chromaprint) (README, `fingerprint_matcher.cpp`, `chromaprint.h`); [AcoustID](https://acoustid.org).
- [worldveil/dejavu](https://github.com/worldveil/dejavu) (`dejavu/config/settings.py`, `dejavu/logic/fingerprint.py`, `dejavu/database_handler/postgres_database.py`, `dejavu/__init__.py`, `dejavu/base_classes/common_database.py`); Will Drevo, ["Audio Fingerprinting with Python and Numpy"](https://willdrevo.com/fingerprinting-and-audio-recognition-with-python/).
- [dpwe/audfprint](https://github.com/dpwe/audfprint) (`audfprint_analyze.py`, `audfprint_match.py`, README/MIREX results).
- ["A local fingerprinting approach for audio copy detection"](https://ar5iv.labs.arxiv.org/html/1304.0793), arXiv:1304.0793 (pitch-shift/time-stretch failure mechanism; Haitsma/Kalker and Waveprint tolerance bounds).
- YouTube Help: [How Content ID works](https://support.google.com/youtube/answer/2797370); [Learn about Content ID claims](https://support.google.com/youtube/answer/6013276); [Dispute a Content ID claim](https://support.google.com/youtube/answer/2797454); [Monetization during Content ID disputes](https://support.google.com/youtube/answer/7000961).
- [YouTube processed 2.2 billion Content ID copyright claims in 2024](https://torrentfreak.com/youtube-processed-2-2-billion-content-id-copyright-claims-in-2024-250522/), TorrentFreak (secondary coverage of YouTube's 2024 Copyright Transparency Report).
- [Protecting what we love about the internet: our efforts to stop online piracy](https://blog.google/outreach-initiatives/public-policy/protecting-what-we-love-about-internet-our-efforts-stop-online-piracy/), Google, Nov 2018.
- MDN: [`BaseAudioContext.decodeAudioData`](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData); [`AudioDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder); [`AudioData.copyTo`](https://developer.mozilla.org/en-US/docs/Web/API/AudioData/copyTo); [`AnalyserNode`](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode), [`getFloatFrequencyData`](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatFrequencyData), [`smoothingTimeConstant`](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/smoothingTimeConstant); [`DedicatedWorkerGlobalScope`](https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope); [mdn/browser-compat-data: AudioDecoder](https://github.com/mdn/browser-compat-data/blob/main/api/AudioDecoder.json).
- [Web Audio API spec](https://webaudio.github.io/web-audio-api/) — `decodeAudioData` resampling behavior, channel up/down-mixing rules, `AnalyserNode`'s fixed Blackman windowing ("FFT Windowing and Smoothing over Time").
- [`OfflineAudioContext not defined in web worker`, magenta-js#483](https://github.com/magenta/magenta-js/issues/483) (corroborating `OfflineAudioContext`'s unavailability in Workers).
- [`node-web-audio-api`](https://www.npmjs.com/package/node-web-audio-api); [eshaz/wasm-audio-decoders](https://github.com/eshaz/wasm-audio-decoders).
- EnterpriseDB, ["Are Hash Indexes Faster than Btree Indexes in Postgres?"](https://www.enterprisedb.com/postgres-tutorials/are-hash-indexes-faster-btree-indexes-postgres) (Postgres index-type tradeoff for the schema in §6).
