# The Million Dollar Homepage — what the original actually was

Research lane 1. Sources fetched live: the surviving `milliondollarhomepage.com` homepage and
its stylesheet, the Wikipedia article, Wayback Machine snapshots of the 2005 `faq.php`,
`buy.php` and `pixellist.php`, the Harvard Library Innovation Lab link-rot study, and a 2022
independent analysis of the grid's contents.

Every claim is tagged **HIGH** (measured from the live page or a fetched archive),
**MED** (reported consistently by two or more secondary sources) or **LOW** (single source,
or inference).

---

## 1. Geometry and pricing

| Fact | Value | Confidence |
|---|---|---|
| Canvas | 1000 × 1000 px, measured from the live `<img width="1000" height="1000">` | **HIGH** |
| Minimum purchasable unit | one 10 × 10 px block = 100 pixels | **HIGH** |
| Blocks on the canvas | 10,000 | **HIGH** |
| Price | $100 per block, i.e. $1 per pixel | **HIGH** |
| Single pixels purchasable? | No. The FAQ said anything smaller than a 10×10 block would be too small to display anything meaningful, and told individuals to club together to buy a block | **HIGH** |
| Outer page column | 1002 px — 1000 px of content flanked by two 1 px dark gutter columns | **HIGH** |

**The load-bearing consequence for us:** 1000 is not divisible by 3. A $1-for-9-pixels grid
laid on a 1000 px canvas would leave a 1-pixel orphan strip on two edges and split blocks.
The canvas dimension therefore *has* to change. See `DECISIONS.md` D1.

## 2. Page structure

Classic 2005 table layout — a single centred column, no persistent sidebar. Top to bottom:

1. **Header bar**, ~45 px tall, dark grey, holding a wordmark image on the left and a
   tagline banner image in the middle stating the pixel count, the price and the pitch.
2. **Stats box**, absolutely positioned at the top right of the header, ~116 × 37 px,
   showing a live "Sold" / "Available" pixel count. The sold number rendered in bright
   green, the available number in bright red. **HIGH** — both the positioning and the
   colours are in the fetched stylesheet.
3. **Navigation bar**, ~20 px tall, gold/mustard, black bold 9pt links separated by pipes.
   Sections included the homepage, a buy page, an FAQ, a blog, a list of everyone who had
   bought pixels, press coverage and a contact link. **HIGH**
4. **The grid** — one flat composite image, 1000 × 1000.
5. **Footer**, ~24 px, muted grey text on the same dark grey as the header, carrying the
   copyright line and a disclaimer that the site was not responsible for external content.

Unsold area was tiled with a 10 × 10 two-tone light-grey checker texture — the "empty
pixel" placeholder look. **HIGH** (measured from the fetched `bg10.gif`: `#e1e1e1` /
`#d6d6d6`).

## 3. Palette measured from the live stylesheet and assets

| Role | Value | Confidence |
|---|---|---|
| Page background | `#999999` with a fine 2×2 px noise texture | **HIGH** |
| Header / footer chrome | `#646464` | **HIGH** |
| Nav bar | `#d9ab22` gold, with a subtle vertical gradient strip (`#e2b83f` → darker) | **HIGH** |
| Panel / content background | `#e1e1e1` | **HIGH** |
| Empty-grid checker | `#e1e1e1` / `#d6d6d6` | **HIGH** |
| Default link | `#000099`, bold, underlined only on hover | **HIGH** |
| "Sold" stat | `#33ff00` | **HIGH** |
| "Available" stat | `#ff0000` | **HIGH** |
| Warning / terms emphasis | `#cc0000` | **HIGH** |
| Body font | Trebuchet MS → Helvetica → Verdana, 9pt | **HIGH** |
| Footer font | 8pt, `#999999` | **HIGH** |

An independent 2022 analysis of the finished grid found the dominant colours across all
10,000 sold blocks were black, white and red, with neon pink, green and yellow heavily
represented — the garish banner-ad aesthetic of 2005. **MED**

## 4. Interaction

- The grid was **one image plus an HTML image map**, with roughly one `<area shape="rect">`
  per advertiser. **HIGH**
- **Hover** surfaced the advertiser's tagline, both through the `title` attribute and a
  custom absolutely-positioned tooltip div with a red border. **HIGH**
- **Click** followed the advertiser's URL directly, with no interstitial. **HIGH**
- **Zoom** was a magnifier effect: a hidden 2000 × 2000 double-resolution copy of the grid,
  CSS-clipped to a rectangle around the cursor and swapped over the base image. **HIGH**
- A separate **pixel list page** was the human-readable directory of owners — a plain table
  of purchase date, site description and pixel count, because the grid image itself carried
  no labels. **HIGH**

## 5. Timeline

- Created by Alex Tew, then 21, to fund a university degree. Launched 26 August 2005. **HIGH**
- ~4,700 pixels sold in the first fortnight, mostly to friends and family; $250,000 by the
  end of September 2005; 999,000 pixels by New Year's Eve. **MED**
- The final 1,000 pixels went to eBay auction, closing 11 January 2006 at $38,100 after
  Tew had to personally disqualify fraudulent bids. **HIGH**
- Gross total **$1,037,100** over roughly five months. **HIGH**
- In January 2006 the site was hit by an extortion demand and, when it was refused, a DDoS
  that took it offline for about a week. **MED**

## 6. Decay — the reason we do not replicate the link-out behaviour

- A 2017 Harvard Library Innovation Lab study of the ~2,816 embedded links found 547 fully
  dead, representing $342,000 of original pixel spend, and a further 489 redirecting
  somewhere else. **HIGH**
- A 2022 independent crawl found ~60% of advertiser domains still responding. **MED**
- Every sub-page (FAQ, buy, pixel list, press) now 404s. Only the homepage loads, and the
  version served today is a **patched mirror**: an HTML comment in the live page records
  that 1,164 broken outbound links were silently rewritten to point at Wayback Machine
  snapshots, generated 2026-01-23. **HIGH** — read directly out of the live HTML.

The single most striking fact about the original in 2026 is that the thing it sold — a
clickable link — is the part that rotted, and someone has had to quietly rewrite more than a
thousand of them to keep the artefact usable. `dollar-pixels` sells the pixels and the
caption, not an outbound link. See `DECISIONS.md` D6.

## 7. Moderation rules the original published

Paraphrased from the archived terms:

- No obscene, offensive or adult imagery or links; the operator decided what was
  appropriate and that decision was final.
- Rejected submissions got one chance to substitute; otherwise refunded and the pixels
  released.
- If a linked site later changed to offensive content the link was pulled with no refund
  for downtime.
- Images had to be exactly the size purchased, GIF or JPEG, a reasonable file size, and
  **not animated** — the stated reason being how messy the page would otherwise look.
- Links had to be to web pages and the buyer had to have authority over what they submitted.
- The site committed to staying online for at least five years.

## Citations

- `https://milliondollarhomepage.com/` — live HTML and assets, fetched directly
- `https://milliondollarhomepage.com/index_files/style.css`
- Image assets sampled for colour: `bodybg.gif`, `navbg.gif`, `bg10.gif`, `statbg-out.gif`
- `https://en.wikipedia.org/wiki/The_Million_Dollar_Homepage`
- `https://lil.law.harvard.edu/blog/2017/07/21/a-million-squandered-the-million-dollar-homepage-as-a-decaying-digital-artifact`
- `https://history.jakelee.co.uk/million-dollar-homepage/`
- Wayback Machine raw snapshots of `faq.php`, `buy.php`, `pixellist.php` (October 2005)
