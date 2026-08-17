# Storage and delivery

Research lane R5. Scope: object storage economics, the `BlobStore` port, upload path, HTTP range
serving, Next.js streaming mechanics, caching, key layout, and the local filesystem adapter.

Context this document assumes (set by the project, not re-litigated here): Next.js 16 App Router
on Node; Postgres holds metadata only (PGlite locally, Neon deployed); a `BlobStore` port with a
filesystem adapter for development and an R2 adapter for production, switched by one environment
variable; segments are produced client-side and uploaded ready to serve.

All prices below were read on **2026-08-16** and are cited inline. Cloud storage pricing changes
without much notice — re-verify before an actual purchasing decision, especially the AWS and B2
numbers, which came from secondary aggregators cross-checked against each other because the
official AWS pricing pages are JS-rendered tables that a text fetch can't extract.

---

## 1. Egress economics

### 1.1 Published pricing, per provider

| Provider | Storage ($/GB-mo) | Egress ($/GB) | Write ops | Read ops |
|---|---|---|---|---|
| **Cloudflare R2** (Standard) | $0.015 | **$0.00 (free)** | Class A: $4.50 / million | Class B: $0.36 / million |
| **AWS S3 Standard** (us-east-1) | $0.023 (first 50 TB) | $0.09/GB (next 10 TB, after 100 GB/mo account-wide free tier), $0.085/GB (next 40 TB), $0.07/GB (next 100 TB), $0.05/GB (beyond 150 TB) — *this is S3's own internet DTO; see §1.3 for the S3+CloudFront combo* | PUT/COPY/POST/LIST: $0.005 / 1,000 ($5.00/M) | GET/SELECT: $0.0004 / 1,000 ($0.40/M) |
| **AWS CloudFront** (US/CA/MX/EU) | n/a (CDN, not storage) | 1 TB/mo always-free, then $0.085/GB (next 10 TB), $0.080/GB (next 40 TB), $0.060/GB (next 100 TB), $0.040/GB (next 350 TB), tapering further at PB scale | n/a | $0.0100 / 10,000 HTTPS requests ($1.00/M); 10M requests/mo always-free |
| **Backblaze B2** | $0.00695 ($6.95/TB) | **Free up to 3× average monthly storage**, then $0.01/GB. Unlimited free egress through partner CDNs (Cloudflare, Fastly, bunny.net, others). | Class A (list/create): free | Class B/C (read/list): free. Class D (download-auth-adjacent): $0.004/10,000 after 2,500/day free |
| **Vercel Blob** (Pro) | $0.023 | $0.05/GB ("Blob Data Transfer", billed only on cache-miss for public delivery) | Advanced ops (`put`/`copy`/`list`): $5.00/M | Simple ops (URL access, cache-miss, or `head()`): $0.40/M |

Sources: [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) (read 2026-08-16);
S3 Standard storage and request pricing cross-verified via [nOps](https://www.nops.io/blog/aws-s3-pricing/)
and independent search-aggregated figures against `aws.amazon.com/s3/pricing/` (read 2026-08-16,
official page did not extract via text fetch — JS-rendered);
CloudFront figures via [EgressCost.com](https://egresscost.com/aws/cloudfront-pricing/), cross-checked
against a second aggregator (read 2026-08-16);
[Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing) (read 2026-08-16 — note the
per-GB storage rate reflects a 2026 increase from B2's earlier $0.005–0.006/GB headline, so don't
trust older blog posts that quote $5/TB);
[Vercel Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) (page `last_updated:
2026-06-16`, read 2026-08-16).

Two structural facts drive everything below:

- **R2 charges zero for egress, full stop.** This is the entire pitch. Storage and request costs
  are the same order of magnitude as S3; the difference is that S3's bill is dominated by
  data-transfer-out once you have real viewers, and R2's isn't.
- **CloudFront's 1 TB/month always-free egress tier is generous enough to hide the S3 story at toy
  scale.** The worked example below shows this explicitly — at 10,000 views/month, CloudFront's
  free tier absorbs almost all of the transfer, so S3+CloudFront looks deceptively cheap. It stops
  being free the moment the free tier is exhausted, which for a real video product happens fast.

### 1.2 Worked example: assumptions

- **Catalog**: 1,000 videos, average 5:00 (300 s) each.
- **Ladder**: 6 renditions, fMP4/CMAF, combined video+audio bitrate per the table below (video
  bitrates follow a standard practical ladder shape; the 1080p/720p/480p figures match [Mux's
  worked ffmpeg-to-HLS example](https://www.mux.com/articles/how-to-convert-mp4-to-hls-format-with-ffmpeg-a-step-by-step-guide)
  read 2026-08-16 — 5000k/2800k/1400k — extended downward for 360p/240p/144p using the same
  roughly-halving pattern that guide and most encoding-ladder references use):

| Rendition | Resolution | Video kbps | Audio kbps | Combined kbps | Size @ 300s |
|---|---|---|---|---|---|
| 1080p | 1920×1080 | 5000 | 192 | 5192 | 190.1 MB |
| 720p  | 1280×720  | 2800 | 128 | 2928 | 107.2 MB |
| 480p  | 854×480   | 1400 | 96  | 1496 | 54.8 MB |
| 360p  | 640×360   | 800  | 96  | 896  | 32.8 MB |
| 240p  | 426×240   | 400  | 64  | 464  | 17.0 MB |
| 144p  | 256×144   | 200  | 64  | 264  | 9.7 MB |

  Formula: `size_MB = kbps × seconds / 8 / 1024`. Sum of all six rungs = **411.6 MB/video**.

- **Segment length**: 6 s (a common fMP4/CMAF choice) → 50 segments + 1 `init.mp4` per rendition
  for a 300 s video.
- **Progressive fallback**: one whole non-fragmented MP4 (moov-at-front) for the no-WebCodecs Range
  path (§4). Assumption: it reuses the 1080p rung's audio/video streams repackaged, not a separate
  higher-bitrate master — so it costs the same **190.1 MB**. (If you keep a true untranscoded
  original instead, add its size on top; this example doesn't, to keep the arithmetic checkable
  against a single stated design choice.)
- **Thumbnails**: 3 JPEGs × 150 KB = 0.44 MB. **Captions**: one VTT ≈ 0.03 MB. Both are rounding
  noise (<0.1% of total) but included for completeness.
- **Per-video total storage** = 411.6 (ladder) + 190.1 (fallback) + 0.44 (thumbs) + 0.03 (captions)
  = **602.2 MB**.
- **Library storage** = 1,000 × 602.2 MB = 602,200 MB ≈ **588 GB**.
- **Traffic**: 10,000 views/month, each assumed to watch the *entire* 300 s at the 720p rung (a
  simplifying, deliberately conservative assumption — real average watch time is shorter than
  total length, and ABR mixes rungs; this treats every view as a full 720p download, which
  overstates egress for all four providers equally and keeps the comparison fair). Egress per view
  = 107.2 MB.
- **Monthly egress** = 10,000 × 107.2 MB = 1,072,000 MB ≈ **1,047 GB**.
- **Requests per view**: 50 segment GETs + 1 init GET + 1 rendition playlist + 1 master playlist =
  **53 GETs/view** → 10,000 × 53 = **530,000 GETs/month**. This treats every view as an
  uncached origin fetch (worst case for R2 and Vercel Blob, whose per-request costs *do* benefit
  from CDN cache hits — see the caveat after the table below; it doesn't change S3/CloudFront's or
  B2's numbers, which are billed on bytes delivered to the viewer regardless of origin cache
  status).
- **Upload requests**: 6 renditions × (50 segments + 1 init) + 1 fallback + 3 thumbnails + 1
  caption + 7 playlists (1 master + 6 rendition) = 318 objects/video → **318,000 PUTs** for the
  whole catalog (one-time, not monthly-recurring after initial upload).

### 1.3 Worked example: the bill

**At 10,000 views/month (588 GB stored, 1,047 GB egressed, 530,000 reads, 318,000 one-time writes):**

| Provider | Storage | Egress | Requests | **Total/mo** |
|---|---|---|---|---|
| **R2** | 588.1 GB × $0.015 = $8.82, − 10 GB free tier = **$8.67** | $0 (free) | 318K PUTs, 530K GETs — both under the 1M/10M free tier = **$0** | **≈ $8.67** |
| **S3 + CloudFront** | 588.1 GB × $0.023 = **$13.53** | S3→CloudFront same-account transfer is free; CloudFront DTO: 1,047.1 GB − 1,024 GB (1 TB) free tier = 23.1 GB × $0.085 = **$1.97** | S3 PUT 318K × $0.005/1000 = $1.59; S3 GET (CF origin misses, ≈ one per unique object) 318K × $0.0004/1000 = $0.13; CloudFront requests 530K, under 10M free = $0 → **$1.72** | **≈ $17.22** |
| **Backblaze B2** | 588.1 GB × $0.00695 = **$4.09** | Free allowance = 3 × 588.1 GB = 1,764 GB; actual 1,047.1 GB is under it = **$0** | Class A/B/C free; Class D ≈ (530K − 75K/mo free) / 10,000 × $0.004 = **$0.18** | **≈ $4.27** |
| **Vercel Blob** | 588.1 GB × $0.023 = **$13.53** | 1,047.1 GB × $0.05 (worst case, no edge-cache credit) = **$52.36** | Simple ops (530K−100K incl.)/1M × $0.40 = $0.17; Advanced ops (318K−10K incl.)/1M × $5.00 = $1.54 → **$1.71** | **≈ $67.60** |

At this toy traffic level R2 is the cheapest, B2 is close behind it (helped by the 3× free-egress
allowance), S3+CloudFront looks artificially good because CloudFront's 1 TB free tier absorbs 98%
of the egress, and Vercel Blob is roughly 4–8× R2's cost, dominated by the $0.05/GB transfer meter.

**Why this understates the real gap — the same model at 100× traffic (1,000,000 views/month,
104,713 GB egress, 53,000,000 reads; storage and upload counts unchanged since they're a function
of catalog size, not views):**

| Provider | Storage | Egress | Requests | **Total/mo** |
|---|---|---|---|---|
| **R2** | $8.67 | $0 | Class B: (53M − 10M free)/1M × $0.36 = **$15.48** | **≈ $24.15** |
| **S3 + CloudFront** | $13.53 | CloudFront DTO across tiers: 10,240 GB@$0.085=$870.40 + 40,960 GB@$0.080=$3,276.80 + remaining 52,489 GB@$0.060=$3,149.36 = **$7,296.57** | S3 ≈$1.72 (unchanged); CloudFront requests (53M−10M)/1M×$1.00 = $43.00 | **≈ $7,354.82** |
| **Backblaze B2** | $4.09 | Free allowance still 1,764 GB (based on *storage*, not traffic); billable = (104,713−1,764) × $0.01 = **$1,029.49** | Class D ≈ 53M/10,000 × $0.004 ≈ $21.20 | **≈ $1,054.78** |
| **Vercel Blob** | $13.53 | 104,713 GB × $0.05 = **$5,235.67** | Simple ops ≈53M/1M×$0.40=$21.20; advanced ≈$1.54 | **≈ $5,271.94** |

At 100× traffic R2 costs **$24/month**; S3+CloudFront costs **$7,355/month** — a ~300× gap that
didn't exist at the smaller scale because the free tier was masking it. That's the arithmetic that
justifies R2 for a project where storage cost is explicitly an architectural concern: the choice
matters more as the product succeeds, not less.

**Caveats on this model, stated so the numbers are checkable and adjustable:**
- Fronting R2 (or Vercel Blob) with a cached custom domain and long-lived `Cache-Control`
  (§6) collapses Class B/Simple-Operations toward the *unique object count* (~318,000) instead of
  scaling with view count, making R2's own number even smaller — this model deliberately doesn't
  take that credit, to keep the request-count assumption identical (and thus fair) across all four
  providers.
- Real average watch time is shorter than total video length, and ABR players mix rungs rather than
  pinning to 720p for the whole watch — both effects would lower egress for every provider
  proportionally, without changing the relative ranking.
- B2's free-egress allowance is explicitly "3× average storage," not traffic-scaled, which is why
  it degrades from "fully covers our traffic" to "covers under 2%" between the two scenarios above.

---

## 2. R2 API surface

### 2.1 What subset of S3 we actually need

| Operation | Used for |
|---|---|
| `PutObject` | Uploading segments/init/playlists/thumbnails/captions (usually via presigned PUT, §3) |
| `GetObject` (+ `Range`) | Serving the progressive fallback file (§4); reading manifests server-side if needed |
| `HeadObject` | Existence/size/ETag checks without a body — needed to answer HTTP `HEAD` for the fallback route |
| `DeleteObject` / `DeleteObjects` (batch) | Deleting a video: list-by-prefix then batch delete |
| `ListObjectsV2` | Prefix listing (`videos/{id}/`) for deletion and admin/debug tooling |
| `CreateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload` / `AbortMultipartUpload` | Only needed for objects that individually exceed the 5 GiB single-PUT ceiling — realistically only the raw/original fallback file for long or high-bitrate uploads, not the segments (each a few hundred KB to a few MB) |

R2 confirms support for all of these plus conditional headers (`If-Match`/`If-None-Match`) on
`PutObject` and `GetObject`, `ListObjectsV2` with full query-parameter support, and the full
multipart lifecycle including `UploadPartCopy`. Not supported and not needed here: ACLs
(`x-amz-acl`), object tagging, request-payer, AWS KMS encryption, object locking/versioning.
Source: [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) and
[R2 API extensions](https://developers.cloudflare.com/r2/api/s3/extensions/) (read 2026-08-16).

### 2.2 SDK choice

Use `@aws-sdk/client-s3` (the standard AWS SDK for JavaScript v3) pointed at R2's endpoint. This is
Cloudflare's own recommended path for anything running in a normal Node.js process (our Route
Handlers, running `runtime = 'nodejs'`). The only reason to reach for `aws4fetch` or a hand-rolled
SigV4 signer instead is if code needs to run in the Cloudflare Workers runtime itself (no Node
APIs) — not our case, since everything here runs inside Next.js on Node.

```ts
import { S3Client } from '@aws-sdk/client-s3'

const s3 = new S3Client({
  region: 'auto', // required by the SDK, ignored by R2
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
})
```

Source: [R2 aws-sdk-js-v3 example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
(read 2026-08-16).

### 2.3 R2-specific gotchas, current as of the read date

**Checksum headers break uploads on recent SDK versions.** Starting with
`@aws-sdk/client-s3` v3.729.0 (December 2024), the SDK changed its defaults to attach an
`x-amz-checksum-crc32` header to every `PutObject`/`UploadPart` call and to validate checksums on
`GetObject` by default. R2 doesn't implement CRC32 checksums and rejects the header with
`NotImplemented: Header 'x-amz-checksum-crc32' ... not implemented`. This has broken production
uploads for people who bumped a minor SDK version with no code changes. Fix: explicitly set the
integrity-protection config flags back to opt-in behavior:

```ts
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})
```

Sources: [AWS SDK JS v3 issue #6810, "Announcement: S3 default integrity change"](https://github.com/aws/aws-sdk-js-v3/issues/6810);
[Cloudflare community: "@aws-sdk/client-s3 v3.729.0 Breaks UploadPart and PutObject R2 S3 API
Compatibility"](https://community.cloudflare.com/t/aws-sdk-client-s3-v3-729-0-breaks-uploadpart-and-putobject-r2-s3-api-compatibility/758637)
(read 2026-08-16). Pin this config explicitly in the R2 adapter rather than relying on SDK defaults
— the default has already changed once underneath people and can change again.

**Multipart `InvalidPart` errors that look like corruption but aren't.** The most common cause
reported is sending the wrong `ETag` back in `CompleteMultipartUpload` — if the ETag doesn't match
what R2 recorded for that part number, you get `InvalidPart`, which reads like a data-integrity
failure but is almost always a bookkeeping bug in the multipart-part-list assembly, not corrupted
bytes.

**Multipart size constraints**: minimum part size 5 MiB (except the last part), maximum part size
5 GiB, maximum 10,000 parts, maximum object size ~4.995 TiB via multipart, maximum single-PUT
object size ~4.995 GiB (5 GiB minus overhead). Source:
[R2 platform limits](https://developers.cloudflare.com/r2/platform/limits/) (read 2026-08-16).
None of our per-object sizes (segments: sub-MB to a few MB; even the 1080p fallback at ~190 MB)
come close to needing multipart in this project's traffic profile.

**Presigned URL differences from vanilla S3.** `getSignedUrl()` from
`@aws-sdk/s3-request-presigner` works against R2 the same way it does against S3 — same function
call, same `expiresIn`. Two things differ in practice:

1. `region` must be `'auto'` and the endpoint must be the account-scoped R2 URL, or the signature
   won't validate.
2. If `Content-Type` (or any other header) is included in the signed request, the *exact same
   header* must be present, byte-identical, on the actual upload request the browser sends —
   otherwise R2 (like S3) returns `403 SignatureDoesNotMatch`. This has bitten people who signed
   with a specific `Content-Type` and then let the browser's `fetch`/`XHR` send a slightly
   different one (or none at all).
3. Presigned URL expiry range is 1 second to 7 days (604,800 s) — same ceiling as S3.

Source: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) (read
2026-08-16).

**CORS: wildcard `AllowedHeaders: ["*"]` is unreliable on R2 even though it works on S3.**
Multiple independent reports say R2's CORS enforcement wants explicit header names
(`Content-Type`, etc.) rather than `*` for presigned-PUT flows, where AWS S3 tolerates the
wildcard. The official example, matching what direct-to-R2 segment uploads need:

```json
[
  {
    "AllowedOrigins": ["https://your-app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Without a CORS policy that matches exactly what the presigned URL will be used for, "browser-based
uploads and downloads using presigned URLs will fail, even though the presigned URL itself is
valid" — R2's own docs call this out explicitly, and expired-presigned-URL 403s also arrive without
CORS headers attached, so the browser's JS can't read the actual error, only that the fetch failed.
Source: [R2 bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/), cross-checked against
[kian.org.uk's R2 CORS writeup](https://kian.org.uk/configuring-cors-on-cloudflare-r2/) (read
2026-08-16).

**Custom domain vs. `r2.dev`.** `r2.dev` is a Cloudflare-managed subdomain, explicitly
non-production ("intended for non-production traffic," rate-limited, 429s under load, no caching
controls, no WAF/bot management). A custom domain (a zone you control, pointed at the bucket) is
required for production: it's the only path that gets Cloudflare's edge cache in front of the
bucket, which matters twice — it's what makes `Cache-Control: immutable` (§6) actually save R2
read-operation cost (cache hits don't count as Class B reads), and it's what makes the bucket
usable at real traffic without hitting rate limits. Source:
[R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) (read
2026-08-16).

**Write concurrency to a single key is limited to 1/second.** Irrelevant for this project's key
scheme (§7) because every segment/init/playlist key is written exactly once, ever — but worth
knowing if a design ever moves toward content-addressed dedup keys written concurrently by many
uploaders.

---

## 3. Presigned uploads

### 3.1 The tradeoff

**Through our Next.js route handler** (browser → Next.js server → R2):
- We see every byte, so validation (file type, size, malware-adjacent checks, rejecting a
  malformed segment before it's stored) happens inline, synchronously, before the object exists.
- Auth is simple: the route handler is already behind our session/auth middleware; no separate
  token-issuance step.
- Costs our server compute and bandwidth for every byte uploaded, and — critically on Vercel — hits
  a **hard 4.5 MB request-body cap** that has nothing to do with how we read the body. Confirmed
  directly by Vercel: "the request body size is the maximum amount of data that can be included in
  the body of a request to a function... 4.5 MB" and this is described as "an infrastructure-level
  restriction that cannot be bypassed by changing application code settings" — streaming the read
  does not help, because the limit is enforced by Vercel's ingress before the function ever sees
  the bytes. Sources:
  [Vercel Functions limitations](https://vercel.com/docs/functions/limitations),
  [Vercel KB: bypassing the 4.5 MB limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
  (read 2026-08-16).
- Since our video segments and the progressive fallback file can individually exceed 4.5 MB (the
  1080p fallback alone is ~190 MB in the worked example above, and even individual 720p segments
  can cross a few MB), routing uploads through the Next.js function on Vercel isn't just
  suboptimal, it's **not viable** for this project's file sizes without chunking every upload into
  sub-4.5 MB pieces reassembled server-side — extra complexity that buys nothing.

**Direct to R2 with presigned PUT URLs** (browser → R2 directly, Next.js only issues the URL):
- Bytes never touch our server, so the 4.5 MB Vercel cap is irrelevant and our function compute
  cost for uploads is near-zero.
- Auth moves to token issuance: the route handler authenticates the user and authorizes *which key*
  they're allowed to write, then returns a short-lived (minutes, not the 7-day max) presigned URL
  scoped to that exact key and `Content-Type`. The R2/S3 signature itself enforces that the browser
  can't write to a different key or with a different content type than what was authorized.
- Validation moves from "before it's stored" to "after it's stored, before it's trusted." We can't
  reject a bad segment inline anymore — the upload already succeeded against R2 by the time we'd
  know. The fix is a second, cheap step: after the browser reports upload completion, the server
  does a `HeadObject` (size, `Content-Type`, existence) and, if the segment format needs deeper
  validation, a `GetObject` with a small Range to sniff the fMP4 box header — then flips a
  Postgres row from `pending` to `ready`, or issues a `DeleteObject` and asks the client to retry.
  The playlist (manifest) is only ever generated/finalized after every referenced segment has
  passed this check, so a bad segment can never become reachable through a served playlist — it
  just sits as an orphaned, unreferenced object until a cleanup job reaps it.

### 3.2 Recommendation

**Direct-to-R2 presigned PUT**, for segments, thumbnails, captions, and the fallback file. This
isn't really optional given the Vercel body-size ceiling and the file sizes involved — it's closer
to mandatory. What it costs: an async "reject a bad segment" path instead of a synchronous one
(implemented as a `pending` → `ready`/`rejected` state machine in Postgres, checked on
`HeadObject`/small-range `GetObject` after the client reports completion), and slightly more
plumbing in the upload flow (issue presigned URL → client PUTs → client reports completion → server
verifies → server finalizes). In exchange: no 4.5 MB ceiling, near-zero server compute/bandwidth
cost per upload, and a `BlobStore.url()` method (§8) that's exercised on the hot path rather than
being a nice-to-have.

The one place a server-mediated upload still makes sense is genuinely tiny, trusted payloads where
synchronous validation matters more than bypassing the body limit — arguably nothing in this
project's segment/thumbnail/caption/playlist set, since captions and thumbnails are also easily
under a few hundred KB but gain nothing from being proxied and still benefit from the same
presign-and-verify pattern for consistency.

---

## 4. HTTP Range serving

This section is for the progressive-MP4 fallback path: one whole file, served with byte-range
support, for browsers without WebCodecs. All section numbers below are from **RFC 9110 (HTTP
Semantics)**, confirmed against the RFC's table of contents. Source:
[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) /
[httpwg.org mirror](https://httpwg.org/specs/rfc9110.html) (read 2026-08-16).

### 4.1 What the server must do

**Advertise support.** Every response for the resource (200 or 206) includes:
```
Accept-Ranges: bytes
```
Defined in §14.3. Its absence is itself meaningful — a client that never sees this header should
not assume range requests work, which is exactly the fallback path's failure mode if this is
forgotten.

**Parse the `Range` request header** (§14.2, byte-ranges specified in §14.1.2). Three forms must be
handled, all inside `Range: bytes=<spec>`:

| Form | Example | Meaning |
|---|---|---|
| Closed range | `bytes=200-999` | Bytes 200 through 999 inclusive |
| Open-ended | `bytes=200-` | Byte 200 through end of file |
| Suffix range | `bytes=-500` | The **last** 500 bytes of the file |

Parsing sketch (illustrative, not the full adapter):

```ts
function parseRange(header: string, totalSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match) return null
  const [, startStr, endStr] = match
  if (startStr === '' && endStr === '') return null // "bytes=-" is invalid
  if (startStr === '') {
    // suffix range: last N bytes
    const suffixLength = parseInt(endStr, 10)
    if (suffixLength === 0) return null // zero-length suffix is unsatisfiable
    const start = Math.max(0, totalSize - suffixLength)
    return { start, end: totalSize - 1 }
  }
  const start = parseInt(startStr, 10)
  const end = endStr === '' ? totalSize - 1 : parseInt(endStr, 10)
  if (start >= totalSize || start > end) return null // unsatisfiable
  return { start, end: Math.min(end, totalSize - 1) }
}
```

(Multiple ranges in one request, `bytes=0-99,200-299`, and `multipart/byteranges` responses per
§14.6, are legal HTTP but not something video `<video>` playback needs — treating a multi-range
request as if it were a plain unranged request, or just serving the first range, is accepted
practice for this use case and what most static-file servers do.)

**Respond correctly for each case:**

- **Satisfiable range → `206 Partial Content`** (§15.3.7), with:
  - `Content-Range: bytes {start}-{end}/{totalSize}` (§14.4)
  - `Content-Length: {end - start + 1}` — the size of *this response body*, not the full file
  - `Accept-Ranges: bytes`
  - `ETag` and/or `Last-Modified`, so `If-Range` (below) has something to validate against
- **No `Range` header at all → `200 OK`**, full body, `Content-Length` = full file size,
  `Accept-Ranges: bytes` still present.
- **Unsatisfiable range → `416 Range Not Satisfiable`** (§15.5.17) — e.g. `start >= totalSize`, or a
  zero-length suffix. The response must include `Content-Range: bytes */{totalSize}` so the client
  learns the actual size and can retry correctly.

**Conditional range requests (`If-Range`, §13.1.5).** A client resuming a paused
download/seek sends `If-Range: "<etag>"` (or a `Last-Modified` date) alongside `Range`. The
contract: if the validator still matches the current resource, honor the range and return 206; if
it doesn't match (the file changed since the client last saw it), **ignore the `Range` header
entirely and return the full resource as a normal 200** — never return a 206 built from a range
computed against a since-changed representation. For our content-addressed/immutable segment and
fallback files (§6, §7), the ETag never changes after publish, so `If-Range` is nearly always a
guaranteed match — but the server must still implement the comparison correctly rather than
special-casing it away, because a stale client cache or a re-encoded replacement at the same key
(which our upload discipline is designed to prevent, but shouldn't be assumed impossible by the
serving code) is exactly the scenario this header exists to handle safely.

### 4.2 Safari specifics

Safari is the browser that actually enforces range support as a *requirement*, not an optimization,
for `<video>` playback, and it tests aggressively:

- **Safari probes with a tiny range request before committing to a source.** It requests as little
  as the first 2 bytes; if the response isn't a correct `206` with the right headers, Safari treats
  the source as unusable and (if there's a fallback `<source>`) moves on, rather than falling back
  to a full download.
- **Safari doesn't stream the rest of the file in one range request the way Chrome/Firefox often
  do.** It fetches in windows — closing the connection after roughly 4–5 MB of a given range
  response and issuing a new range request to continue — so the server needs to handle a high
  volume of range requests per playback session cleanly, not just get the first one right.
- **Seeking aborts the in-flight request and starts a new ranged one** at the byte offset Safari
  computes for the target time, rather than continuing the old stream — so range parsing has to be
  correct and fast on every request, not just the first.
- **`HEAD` matters.** Safari's probing behavior depends on getting correct `Accept-Ranges` and
  `Content-Length` from a `HEAD` request too, not only `GET` — the server's range-serving logic
  should answer `HEAD` consistently with what a corresponding `GET` would report.

Net effect: if the 206/`Content-Range`/`Accept-Ranges` contract is even slightly wrong — wrong
byte count, missing `Accept-Ranges` on the 200 case, a 200 returned where a 206 was requested and
satisfiable — Safari doesn't degrade gracefully, it fails to play. Chrome and Firefox are much more
forgiving of an imperfect implementation, which makes Safari the browser to test against, not an
afterthought.

Sources: [smoores.dev, "Serving Video with HTTP Range Requests"](https://smoores.dev/post/http_range_requests/);
[LogRocket, "Streaming video in Safari: Why is it so difficult?"](https://blog.logrocket.com/streaming-video-in-safari/)
(both read 2026-08-16).

---

## 5. Streaming in Next.js App Router

### 5.1 Returning a streaming response

A Route Handler can return a `Response` built from a `ReadableStream` directly — this is documented,
current behavior for Next.js 16's App Router and needs no special configuration beyond running on
the Node runtime (default):

```ts
// app/api/stream/route.ts
export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(new TextEncoder().encode('chunk'))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
}
```

For piping a **Node** stream (e.g. `fs.createReadStream` for the Range-served fallback file, §4)
into that `Response`, Next.js's own docs show using `FileHandle.readableWebStream()`
(`node:fs/promises`) to get a Web `ReadableStream` straight from the filesystem without buffering
the whole file:

```ts
import { open } from 'node:fs/promises'

export async function GET(request: Request) {
  const file = await open('/path/to/file.mp4')
  // For a ranged read, open with { start, end } options via fs.createReadStream instead,
  // then Readable.toWeb(nodeStream) to bridge Node stream -> Web ReadableStream.
  return new Response(file.readableWebStream(), {
    headers: { 'Content-Type': 'video/mp4' },
  })
}
```

For an explicit byte range, `fs.createReadStream(path, { start, end })` (Node's classic streams
API) plus `Readable.toWeb()` (from `node:stream`) bridges it to the Web `ReadableStream` that
`Response` expects.

Source: [Next.js Streaming guide](https://nextjs.org/docs/app/guides/streaming), version 16.3.1,
`lastUpdated: 2026-07-30` (read 2026-08-16).

### 5.2 Receiving a streaming upload body without buffering it entirely

`request.body` in a Route Handler is already a standard Web `ReadableStream` — no special parsing
is required to avoid Next.js buffering it for you. To hand it to something that wants a Node
stream (e.g. certain filesystem or SDK APIs), bridge with `Readable.fromWeb(request.body)` from
`node:stream`, then `stream.pipeline()` it to the destination. In practice, this project's chosen
upload path (§3) means the Next.js server rarely receives raw segment bytes at all — but this
matters for anything that *does* proxy through the server (small metadata blobs, or a
server-upload fallback for browsers where the presigned-PUT path fails).

### 5.3 What breaks on the Edge runtime, and the size/duration caveats

- **`runtime = 'edge'` has no Node.js APIs** — no `fs`, no `node:stream`, no native modules. Any
  filesystem-backed adapter (the local dev `BlobStore`, §9) or any code using `Readable.toWeb`/
  `Readable.fromWeb` must run on the **Node runtime**. This project's Route Handlers should
  explicitly set (or simply not override, since Node is default) `export const runtime = 'nodejs'`
  wherever the `BlobStore` port is touched.
- **The classic "4MB API route response" cap is a Pages-Router-era limit**, worked around via
  `export const config = { api: { responseLimit: false } }` — App Router Route Handlers don't use
  that config shape, and a genuinely streamed `Response` (chunked transfer) isn't subject to it the
  same way; but see the next point, which is the limit that actually matters here.
- **Vercel's platform-level 4.5 MB request/response body cap is separate from and stricter than
  anything Next.js itself imposes**, and — critically — **streaming does not exempt the request
  side of it**. It's enforced by Vercel's ingress layer before code runs, described directly as "an
  infrastructure-level restriction that cannot be bypassed by changing application code settings."
  This is why §3 lands on direct-to-R2 presigned uploads rather than "just stream the request body
  through the Node runtime" — that would work in `next dev` (no such cap locally) but fail in
  production on Vercel for anything over 4.5 MB, which every segment-heavy upload is. Response
  *streaming* does get an exemption for response bodies specifically (a streaming function isn't
  held to the flat response-size cap the same way), which is relevant to the Range-serving path
  (§4) serving a large file back out — that direction is fine.
- **`maxDuration`**: default 300 s on all plans; Pro/Enterprise can extend to 800 s (generally
  available) or 1800 s (beta, requires function-level config and specific runtime versions). For
  request handlers this includes time spent streaming the response, not just computing it — a
  long-held Range-serving connection counts against this budget.

Sources: [Next.js: "API Routes Response Size Limited to 4MB"](https://nextjs.org/docs/messages/api-routes-response-size-limit);
[Vercel Functions limitations](https://vercel.com/docs/functions/limitations), `last_updated:
2026-07-01`; [Vercel KB: bypassing the 4.5MB limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
(all read 2026-08-16).

---

## 6. Caching

Two distinct classes of object, two distinct policies:

| Object class | Example | `Cache-Control` |
|---|---|---|
| Immutable media segment | `videos/{id}/{rendition}/seg-00001.m4s`, `init.mp4`, thumbnails, captions, the progressive fallback | `public, max-age=31536000, immutable` |
| Finalized VOD playlist | `videos/{id}/master.m3u8`, `videos/{id}/{rendition}/index.m3u8` — **only once the upload is finalized** | `public, max-age=31536000, immutable` |
| Playlist/status before finalization (if ever served at all) | An in-progress upload's not-yet-complete manifest | `no-store`, or if polled, a short `max-age` with `stale-while-revalidate` (see below) — never `immutable` |

Rationale, tied to this project's stated model: segments are content-addressed by position and
never overwritten once written (§7), and per the brief, "a VOD playlist also never changes once the
upload completes" — so once an object is published at its final key, it is safe to cache forever,
with no revalidation. The only object that needs a different policy is a playlist queried *before*
that finalization point exists — and the right answer there isn't a cache tuning knob, it's to not
expose that key/URL as servable until the upload is actually finalized (§3's "the playlist is only
generated after every segment passes verification" rule), which mostly makes the "mutable playlist"
row above a non-issue rather than something requiring careful cache-header tuning.

**What each directive does:**

- **`immutable`**: tells the cache the response body will never change while it's fresh, so skip
  conditional revalidation (`If-None-Match`/`If-Modified-Since`) even on a user-triggered hard
  reload — which is exactly the case Chrome/Firefox/Safari otherwise treat specially (force-reload
  normally forces a revalidation round-trip regardless of `max-age`; `immutable` suppresses even
  that). It exists specifically for content-hashed or otherwise-guaranteed-never-to-change URLs.
- **`max-age=31536000`** (1 year, the practical ceiling browsers/CDNs treat as "forever"): the
  freshness lifetime. Combined with `immutable`, this is the standard pattern for cache-busted
  static assets.
- **`stale-while-revalidate=N`**: after `max-age` expires, the cache may still serve the stale
  response immediately (hiding revalidation latency from the client) while it revalidates against
  origin in the background, for up to `N` more seconds. This directive doesn't apply to anything in
  this project's steady state (everything servable is `immutable`), but it's the right tool for
  the "in-progress upload status" case above, e.g. `Cache-Control: public, max-age=2,
  stale-while-revalidate=10`, if that status is ever served through a cache rather than fetched
  live.
- **What a CDN does with each**: `immutable` + long `max-age` means the CDN edge serves purely from
  cache with zero origin round-trips for the life of the object — on R2 specifically, this is also
  what keeps Class B read-operation cost near the unique-object count rather than scaling with view
  count (§1's caveat, §2's "custom domain vs r2.dev" point — this behavior requires the custom
  domain, since `r2.dev` doesn't offer the caching controls a `Cache-Control` header depends on).
  `stale-while-revalidate` is a background-refresh instruction most CDNs (Cloudflare, Fastly,
  Vercel's edge network) and modern browsers honor as a response directive — MDN's caveat about
  poor support is for the *request*-direction stale directives (`max-stale`, `min-fresh`,
  `stale-if-error` as a request header), not this response directive.

Source: [MDN, `Cache-Control`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
(read 2026-08-16); R2 Class-B-vs-caching interaction cross-checked against Cloudflare community
discussion of custom-domain caching reducing R2 read-operation billing (read 2026-08-16).

---

## 7. Key layout

```
videos/{videoId}/{rendition}/init.mp4
videos/{videoId}/{rendition}/seg-00001.m4s
videos/{videoId}/{rendition}/seg-00002.m4s
...
videos/{videoId}/{rendition}/index.m3u8      # per-rendition playlist
videos/{videoId}/master.m3u8                 # top-level playlist listing all renditions
videos/{videoId}/fallback.mp4                # progressive, byte-range-served (§4)
videos/{videoId}/thumbnails/{n}.jpg
videos/{videoId}/captions/{lang}.vtt
```

`{rendition}` is a fixed label from the ladder (`1080p`, `720p`, …), `{videoId}` is the video's
Postgres-assigned identifier, and segment numbers are zero-padded (`seg-00001.m4s`) both for lexical
sort order matching playback order and for headroom well beyond any real segment count at this
project's video lengths.

### 7.1 Sequential/semantic keys vs. content-addressed keys

**Content-addressed** (key = a hash of the object's bytes, e.g.
`blobs/sha256/ab/cd/abcd1234….m4s`, with the video→segment mapping kept as metadata in Postgres
rather than in the key):

- *Caching*: safe unconditional `immutable` for free — a hash key can never legitimately be
  overwritten with different content, so there's no upload-discipline burden to get this right.
- *Dedup*: identical bytes at two logical locations collapse to one stored object automatically.
  For video segments this buys almost nothing in practice — segments from two different uploads
  are essentially never byte-identical — so the benefit is theoretical here, not real.
  *Deletion*: this is where it costs you. You can't delete-by-video, because a given blob might
  (in principle) be referenced by more than one logical video, so deletion requires reference
  counting and garbage collection (the Git/IPFS model) — real infrastructure to build and get
  right, for a benefit (dedup) this project's content doesn't actually realize.

**Sequential/semantic** (the scheme above, key = logical identity):

- *Caching*: equally safe to mark `immutable` forever, **as long as the upload discipline holds**:
  each key is written exactly once, ever. This is enforced at the `put()` layer with a conditional
  write (`If-None-Match: *`, which R2 supports on `PutObject`, same as S3) rather than by the key
  itself being unforgeable — slightly more discipline required, but it's a single guard in the port
  implementation, not a distributed system.
- *Dedup*: none. Not needed.
- *Deletion*: trivial and matches the actual product requirement (a user deletes their video):
  `ListObjectsV2` with `prefix=videos/{id}/`, then a batch `DeleteObjects` call removes the entire
  video in one pass. No reference counting, no GC job, no risk of deleting a segment another video
  still points to (nothing else ever points to it, by construction).

**Recommendation: sequential/semantic keys**, as given above — because this project's actual hard
requirement is "delete this user's video," which content-addressing makes *harder* in exchange for
a dedup benefit this content doesn't realize. Immutability is achieved through write-once discipline
(conditional `PutObject`) instead of being structurally guaranteed by the key, which is a fully
adequate substitute once it's implemented as a single check in the `BlobStore` port rather than
left to caller discipline.

---

## 8. The port

```ts
/** A byte range for a partial read. `end` is inclusive; omit for "to end of object". */
export interface BlobRange {
  start: number
  end?: number
}

export interface PutOptions {
  contentType: string
  /** Required when `body` is a stream without a known length; used for Content-Length. */
  contentLength?: number
  /** Defaults per §6 policy if omitted — adapters should not require callers to restate it. */
  cacheControl?: string
  /** Enforce write-once semantics (§7.1). Adapters should default this to true for this project's key scheme. */
  ifNoneMatch?: boolean
}

export interface PutResult {
  key: string
  etag: string
  size: number
}

export interface GetOptions {
  range?: BlobRange
  /** Mirrors RFC 9110 §13.1.5 If-Range: only honor `range` if this ETag still matches. */
  ifRange?: string
}

export interface BlobObject {
  body: ReadableStream<Uint8Array>
  contentType: string
  /** Bytes in this response body (may be less than totalSize for a ranged read). */
  contentLength: number
  totalSize: number
  etag: string
  lastModified: Date
  /** Present iff this is a 206-equivalent partial read. */
  range?: { start: number; end: number }
}

export interface BlobMetadata {
  key: string
  size: number
  etag: string
  lastModified: Date
  contentType?: string
}

export interface ListOptions {
  prefix?: string
  cursor?: string
  limit?: number
}

export interface ListResult {
  objects: BlobMetadata[]
  /** Present iff there are more results; pass back in as `cursor`. */
  cursor?: string
}

export interface UrlOptions {
  method?: 'GET' | 'PUT'
  /** Seconds; adapters should clamp to their backend's max (R2/S3: 604800). */
  expiresIn?: number
  /** Required for a PUT url; becomes part of the signature (§2.3) — must match the actual upload's header exactly. */
  contentType?: string
}

export interface BlobStore {
  /** Write an object. Enforces write-once by default (§7.1) unless `ifNoneMatch: false` is passed. */
  put(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array | Buffer,
    options: PutOptions,
  ): Promise<PutResult>

  /** Read an object, optionally by range. Returns null if the key doesn't exist. */
  get(key: string, options?: GetOptions): Promise<BlobObject | null>

  /** Metadata only, no body — backs HTTP HEAD (§4's Safari-probing requirement). Null if absent. */
  head(key: string): Promise<BlobMetadata | null>

  /** Idempotent: deleting a missing key is not an error. */
  delete(key: string): Promise<void>

  /** Prefix-scoped listing, e.g. for delete-by-video (§7.1). */
  list(options?: ListOptions): Promise<ListResult>

  /**
   * A URL the client can use directly — presigned (§3) in production, a local route in dev.
   * `method: 'PUT'` requires `contentType`; the returned URL's signature is scoped to it.
   */
  url(key: string, options?: UrlOptions): Promise<string>
}
```

Seven methods, all present because a section above required them: `put`/`get`/`delete`/`list`/`url`
were specified directly; `head` exists because §4 (Safari's `HEAD` probing) and §3 (post-upload
verification without downloading the body) both need metadata-only reads; range support lives on
`get` as an option rather than a separate method, matching how both the R2/S3 API and RFC 9110
treat it — a `Range` header modifies a `GET`, it isn't a different operation. Nothing here requires
the R2 adapter to expose anything beyond what `@aws-sdk/client-s3` already gives it for these seven
S3 operations (`PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `ListObjectsV2`,
`getSignedUrl`), so the interface is honest about the R2 side; the filesystem adapter is described
next.

---

## 9. Local filesystem adapter

**Location**: `.data/blobs/`, at the project root, mirroring the key scheme directly —
`.data/blobs/videos/{id}/{rendition}/seg-00001.m4s` on disk maps 1:1 to blob key
`videos/{id}/{rendition}/seg-00001.m4s`. No hashing or bucketing of the local path is needed at
this project's scale; a flat mirror of the key namespace keeps `list()` a straightforward recursive
directory walk filtered by prefix.

**How ranges are served from disk**: `fs.createReadStream(path, { start, end })` does the range
read natively — Node's `fs` module accepts the same inclusive `start`/`end` byte offsets this
port's `BlobRange` already uses, so the adapter's `get()` just forwards the parsed range (§4)
straight through, then bridges the resulting Node `Readable` to a Web `ReadableStream` via
`Readable.toWeb()` (§5.1) to satisfy the port's `body: ReadableStream<Uint8Array>` return type.
`totalSize` comes from an `fs.stat()` alongside the read. `head()` is a bare `fs.stat()`, no stream
opened at all.

**ETags**: a real content hash isn't necessary for a dev-only adapter; `` `"${size}-${mtimeMs}"` ``
(the same weak-etag pattern most static file servers use) is sufficient to make `If-Range` and
`HeadObject`-equivalent checks behave correctly against local file changes.

**Writes**: write to a temp path in the same directory, then `fs.rename()` into place, to keep
`put()` atomic with respect to any concurrent `get()` — relevant because the port's write-once
semantics (§7.1, §8) should hold locally too, and a partial write briefly visible at the final path
would violate that.

**Size target**: this is genuinely a small adapter — `put`/`get`/`head`/`delete`/`list`/`url` each
map to one or two `node:fs/promises` calls, with no network, no auth, no retries, and no pagination
protocol to implement (a local directory walk doesn't need R2/S3's cursor-based `ListObjectsV2`
semantics, just a full recursive listing filtered by prefix, since the whole point of a cursor is
bounding a single network response's size, which doesn't apply to a local filesystem call). `url()`
in dev returns a same-origin route (e.g. `/api/blobs/{key}`) that itself delegates to `get()`/range
handling — not a real presigned URL, since there's no separate storage origin to presign against
locally, and the two-step "authenticate then let the client hit the URL directly" flow in §3
collapses to "the client's request goes through this route handler anyway" in dev, which is fine —
the point of matching the port's shape is that swapping the environment variable to the R2 adapter
in production doesn't require touching any calling code, not that the dev adapter has to replicate
every production property.

**Keeping it out of git**: add `.data/` to `.gitignore` at the project root (not just
`.data/blobs/`, since PGlite's local Postgres files likely live under the same `.data/` directory
per the project's stated local-dev setup, and both should be excluded for the same reason — they're
generated, potentially large, and environment-specific).

---

## 10. Quotas and limits

**Cloudflare R2** (free tier, applies to Standard storage only — Infrequent Access has no free
allowance):
- 10 GB-month storage free
- 1,000,000 Class A operations/month free
- 10,000,000 Class B operations/month free
- Egress: always free, no tier distinction
- Platform ceilings regardless of plan: max object size ~4.995 TiB (multipart) / ~4.995 GiB
  (single PUT), object key length 1,024 bytes, object metadata 8,192 bytes, max 10,000 multipart
  parts, ~1,000 buckets/account (an enhanced paginated `ListBuckets` exists specifically for
  accounts that exceed 1,000), 1 write/second to the same object key, `r2.dev` subject to an
  unpublished but real rate limit (429s under load — don't use it for anything but local sanity
  checks).

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 platform limits](https://developers.cloudflare.com/r2/platform/limits/),
[R2 API extensions](https://developers.cloudflare.com/r2/api/s3/extensions/) (read 2026-08-16).

**Neon** (free tier, per project):
- 0.5 GB storage
- 100 CU-hours/month compute (enough for a 0.25 CU instance to run ~400 hours/month, i.e.
  effectively continuous at the smallest size, but far less if autoscaled up)
- Autoscales up to 2 CU (8 GB RAM) — and cannot be pinned above that on free
- Autosuspend after 5 minutes idle, **cannot be disabled** on free — meaning a cold request after
  idle pays a resume latency; worth knowing before assuming Postgres reads are uniformly fast in a
  demo/staging environment
- 100 projects, 10 branches/project, 5 GB/month included public network egress, 1 day metrics
  retention, 1 manual snapshot/project

This project stores metadata only in Postgres (media bytes live in the `BlobStore`), so 0.5 GB is
likely fine for a good while — but it's worth actually checking row-size growth (especially if
segment-level metadata, one row per `seg-NNNNN.m4s`, is tracked in Postgres for the verification
step in §3) rather than assuming metadata is inherently small. At 6 renditions × ~50 segments ×
1,000 videos = 300,000 segment rows, even a lean row won't threaten 0.5 GB — but it's the kind of
assumption worth re-checking once the schema is real, not left implicit.

Source: [Neon plans/limits](https://neon.com/docs/introduction/plans) (read 2026-08-16).

**Vercel** (Functions and Blob):
- Function request/response body: **4.5 MB hard cap**, platform-level, not bypassed by streaming
  the request side (§3, §5.3) — the load-bearing limit for this project's upload architecture
  decision.
- Function `maxDuration`: 300 s default/max on Hobby; 300 s default, 800 s max (GA), 1800 s max
  (beta) on Pro/Enterprise.
- Function memory: 2 GB/1 vCPU default (all plans), up to 4 GB/2 vCPU on Pro/Enterprise.
- Function bundle size: 250 MB uncompressed standard, up to 5 GB via the "large functions" path.
- Vercel Blob (if ever used instead of / alongside R2 — not this project's chosen production
  adapter, but relevant if compared again later): Hobby is free within unpublished usage caps and
  simply blocks further use (with a 30-day cooldown) if exceeded, rather than billing; store count
  caps (100 Hobby / 500 Pro / 1,000 Enterprise); operation rate limits as low as 1,200 simple-ops/
  min (20/s) and 900 advanced-ops/min (15/s) on Hobby; 512 MB per-blob cache ceiling, above which
  every access is a cache miss; 5 TB absolute max object size.

Sources: [Vercel Functions limitations](https://vercel.com/docs/functions/limitations),
[Vercel Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) (both read
2026-08-16).

---

## Sources

- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) — read 2026-08-16
- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) — read 2026-08-16
- [Cloudflare R2 API extensions](https://developers.cloudflare.com/r2/api/s3/extensions/) — read 2026-08-16
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) — read 2026-08-16
- [Cloudflare R2 aws-sdk-js-v3 example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) — read 2026-08-16
- [Cloudflare R2 bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/) — read 2026-08-16
- [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) — read 2026-08-16
- [Cloudflare R2 platform limits](https://developers.cloudflare.com/r2/platform/limits/) — read 2026-08-16
- [AWS SDK JS v3 issue #6810 — S3 default integrity change](https://github.com/aws/aws-sdk-js-v3/issues/6810) — read 2026-08-16
- [Cloudflare community — @aws-sdk/client-s3 v3.729.0 breaks R2 compatibility](https://community.cloudflare.com/t/aws-sdk-client-s3-v3-729-0-breaks-uploadpart-and-putobject-r2-s3-api-compatibility/758637) — read 2026-08-16
- [kian.org.uk — Configuring CORS on Cloudflare R2](https://kian.org.uk/configuring-cors-on-cloudflare-r2/) — read 2026-08-16
- [nOps — AWS S3 pricing](https://www.nops.io/blog/aws-s3-pricing/) — read 2026-08-16
- [EgressCost.com — AWS CloudFront pricing](https://egresscost.com/aws/cloudfront-pricing/) — read 2026-08-16
- [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing) — read 2026-08-16
- [Vercel Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) — read 2026-08-16
- [Vercel Functions limitations](https://vercel.com/docs/functions/limitations) — read 2026-08-16
- [Vercel KB — bypassing the 4.5MB body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) — read 2026-08-16
- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) / [httpwg.org mirror](https://httpwg.org/specs/rfc9110.html) — read 2026-08-16
- [smoores.dev — Serving Video with HTTP Range Requests](https://smoores.dev/post/http_range_requests/) — read 2026-08-16
- [LogRocket — Streaming video in Safari: Why is it so difficult?](https://blog.logrocket.com/streaming-video-in-safari/) — read 2026-08-16
- [Next.js — Streaming guide](https://nextjs.org/docs/app/guides/streaming) (v16.3.1) — read 2026-08-16
- [Next.js — API Routes Response Size Limited to 4MB](https://nextjs.org/docs/messages/api-routes-response-size-limit) — read 2026-08-16
- [MDN — Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) — read 2026-08-16
- [Mux — Convert MP4 to HLS with ffmpeg](https://www.mux.com/articles/how-to-convert-mp4-to-hls-format-with-ffmpeg-a-step-by-step-guide) — read 2026-08-16
- [Neon — Plans and limits](https://neon.com/docs/introduction/plans) — read 2026-08-16
