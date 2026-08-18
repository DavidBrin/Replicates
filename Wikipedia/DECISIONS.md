# Decisions

Numbered, dated, and honest about what was measured versus assumed. Sources are
the research notes in [research/](research).

### D1 — The base page is an article, not a Main Page clone (2026-08-18)

Wikipedia's actual front page is a hand-built panel grid ("Did you know…", "On
this day"). The brief asks for a base page that "looks very similar to a normal
wikipedia article" and functions as a channel guide, so `/` renders the article
*David's Internet* instead of a Main Page replica. **Rejected:** cloning the Main
Page — it is the least article-like page on the site and its panels would be
empty theatre with seven articles of content. **What it costs:** the most
recognisable single Wikipedia page is absent; the article chrome is what carries
the resemblance.

### D2 — Original globe mark, serif wordmark; no Wikimedia assets (2026-08-18)

The puzzle-globe and lockup are Wikimedia trademarks. Per repo convention (the
youtube replica excluded captured brand paths from its own research dumps), the
logo is an original simple globe SVG with the wordmark set in the same serif
stack as article titles. **Rejected:** reproducing the puzzle-globe ("it's just a
demo" is how every asset-lifting replica starts).

### D3 — Red links are the stub mechanism (2026-08-18)

No project is deployed yet, so external "Website" links would all be dead. Rather
than inventing a "coming soon" badge, the replica uses Wikipedia's own idiom for
a target that does not exist: the red link (`#bf3c2c`), routing to a
Wikipedia-style "this page does not exist" screen that explains the stub. When a
`liveUrl` is set in `src/content/projects.ts`, the same slot renders a normal
blue external link with the arrow icon. **What it costs:** red links on
Wikipedia mean a missing *internal* page, not a missing external site — a small,
deliberate semantic stretch, traded for instant visual honesty.

### D4 — Typed TSX articles, not Markdown/MDX (2026-08-18)

Articles are TSX modules composing typed wiki primitives (`Section`, `WikiLink`,
`Infobox`, `Ref`). A registry test can then prove every internal link resolves
and every reference is cited — the class of guarantee Markdown cannot give
without building a parser. **Rejected:** MDX (adds a compile pipeline and an
untyped seam for exactly eight articles). **What it costs:** article authoring
requires editing TSX; acceptable because articles change when projects change,
which is a code event anyway.

### D5 — Non-functional chrome is greyed, never fake-clickable (2026-08-18)

Edit, View history, Talk, the language pill and the Appearance menu have no
behavior a static replica can honestly provide. They render greyed with a
tooltip saying so, matching this repo's precedent (youtube: "Make the decorative
controls real, or honestly greyed"). **Rejected:** live-looking tabs that do
nothing — the uncanny valley of replicas.

### D6 — No ports/adapters layer (2026-08-18)

Sibling projects use hexagonal architecture because they swap storage/payment
backends. This site has no IO: content is code, search is in-memory, deployment
is static. A ports layer here would be ceremony. **What it costs:** if articles
ever move to a CMS, a seam has to be cut then — the cheapest possible time to
cut it, since the content types already exist.

### D7 — Measured body type beats the research hedge (2026-08-18)

Research lane 3 could not resolve Vector's `--font-size-medium` token and hedged
"historically 14px". The design-comparison rounds measured the served page at
Text = Standard: **16px/26px**, which had made every derived size (~h1 26px vs
the real 28.8px) about 12% small. The measured constants were added to `:root`
with provenance comments; no value the research marked *verified* was changed.
The lesson is the repo's standing one: measure the running product, and treat a
hedge in a research note as a todo, not a fact.

### D8 — The sticky header shows for everyone (2026-08-18)

en.wikipedia.org only renders the sticky condensed header for logged-in
accounts. This replica has no accounts, and the sticky header is one of Vector
2022's most recognisable behaviors, so it shows for all readers. **What it
costs:** the TOC's sticky offset moves to 4rem (documented in `Toc.tsx`), a
divergence from the logged-out page geometry that is invisible unless you diff
scroll positions against the real site while logged out.
