/**
 * Markdown — parsed into a closed node tree, and serialised to escaped HTML.
 *
 * Issue descriptions and comments are user input that has to come back out as
 * formatted text. That is the one place in this application where a rendering
 * bug is a *security* bug, so the module is built around a single rule:
 *
 * > **Nothing in the source is ever treated as markup.** The parser produces
 * > nodes from a fixed vocabulary; the renderers emit tags from a fixed
 * > allowlist; every piece of text that reaches an output is escaped on the way.
 *
 * The consequence worth stating plainly: `<script>alert(1)</script>` in a
 * description is a *paragraph containing that text*, not a script tag. There is
 * no HTML passthrough to disable, no `allowDangerousHtml` flag, and no sanitiser
 * pass that could be skipped — raw HTML never becomes markup in the first place,
 * because the grammar below has no production for it.
 *
 * ## Two outputs, one tree
 *
 * {@link parseMarkdown} is the only parser. {@link renderMarkdownToHtml}
 * serialises its tree to an HTML string, and `components/issue-detail`'s
 * `<Markdown>` walks the same tree into React elements. The React path is what
 * the application actually renders, so the product never calls
 * `dangerouslySetInnerHTML` at all; the HTML path exists for anywhere a string
 * is genuinely required (a print stylesheet, an export) and is held to the same
 * escaping rules so the two cannot diverge in safety.
 *
 * ## What is deliberately not supported
 *
 * - **Images.** `![alt](url)` renders its alt text as plain text. An `<img>` is
 *   a network fetch to an attacker-chosen host *and* the most convenient
 *   `onerror` surface in HTML; this product has no image uploads, so supporting
 *   one would be adding the attack surface without the feature.
 * - **Inline HTML**, per the rule above.
 * - **Reference links** (`[text][ref]`), **tables**, **footnotes**. Linear's
 *   editor emits none of them into the plain-text bodies this stores.
 *
 * ## URL handling
 *
 * {@link safeUrl} is the allowlist. A link whose URL it rejects is rendered as
 * its label text with no anchor at all — an anchor with a stripped `href` still
 * looks clickable, which is worse than not looking like a link. Links that pass
 * always carry `rel="noopener noreferrer"`; `noopener` because
 * `window.opener` on a `target="_blank"` navigation lets the opened page rewrite
 * this one, and `noreferrer` because an issue URL contains a workspace key.
 */

/* ================================================================= nodes == */

export type InlineNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "strong"; readonly children: readonly InlineNode[] }
  | { readonly kind: "em"; readonly children: readonly InlineNode[] }
  | { readonly kind: "strike"; readonly children: readonly InlineNode[] }
  | { readonly kind: "code"; readonly value: string }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly children: readonly InlineNode[];
    }
  /** `@dana` — resolved against the workspace's members at render time. */
  | { readonly kind: "mention"; readonly handle: string }
  /** `@ENG-123` or a bare `ENG-123`-shaped token following an `@`. */
  | { readonly kind: "issueRef"; readonly identifier: string };

export type HeadingLevel = 1 | 2 | 3;

export type BlockNode =
  | { readonly kind: "paragraph"; readonly children: readonly InlineNode[] }
  | {
      readonly kind: "heading";
      readonly level: HeadingLevel;
      readonly children: readonly InlineNode[];
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly InlineNode[])[];
    }
  | {
      readonly kind: "codeBlock";
      readonly language: string | null;
      readonly value: string;
    }
  | { readonly kind: "quote"; readonly children: readonly BlockNode[] }
  | { readonly kind: "rule" };

/* ================================================================== urls == */

/**
 * The schemes a link may use. Everything else — `javascript:`, `data:`,
 * `vbscript:`, `file:` — is rejected.
 *
 * `data:` is on the deny side even though a `data:image/png` URL is inert in an
 * `href`, because `data:text/html` is not, and distinguishing them by media type
 * is exactly the kind of nuance that decays into a bypass.
 */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "mailto:",
]);

/**
 * Decode the entity forms a browser would decode *inside an attribute value*.
 *
 * This is the classic filter bypass: `&#106;avascript:alert(1)` is not the
 * string `javascript:` to a naive `startsWith` check, but it is to the browser
 * that parses the attribute. Note the optional semicolon — browsers accept
 * `&#106` without one.
 *
 * `&amp;` is deliberately *not* decoded. This function feeds a rejection test
 * only, so over-decoding is safe and under-decoding is not; but decoding `&amp;`
 * would let a legitimate `?a=1&amp;b=2` masquerade as something it is not, and
 * the escaping in {@link escapeAttribute} already means a literal `&` in a URL
 * reaches the browser as `&amp;` and is decoded exactly once.
 */
function decodeNumericEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) =>
      fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);?/g, (_match, digits: string) =>
      fromCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&colon;?/gi, ":")
    .replace(/&Tab;?/gi, "\t")
    .replace(/&NewLine;?/gi, "\n");
}

/**
 * `String.fromCodePoint`, for numbers that came out of a document.
 *
 * The bare call **throws** `RangeError` for anything that is not a code point:
 * `&#x110000;` is one character past the top of Unicode, `&#99999999999;`
 * overflows, and a decoder that lets the exception out takes the whole render
 * with it. That is not a cosmetic failure — {@link safeUrl} runs on every link
 * in every description, so `[boom](&#x110000;:x)` in one issue body would make
 * the issue detail throw for *every* viewer, permanently, with no way to edit
 * the body that causes it.
 *
 * The replacement character is what a browser substitutes for exactly these
 * inputs (HTML's "numeric character reference end state" maps out-of-range
 * values, surrogates and null to U+FFFD), so agreeing with it is both safe and
 * accurate: `java&#x110000;script:` stays un-decoded into a live scheme here
 * for the same reason it does in the browser.
 */
function fromCodePoint(value: number): string {
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > 0x10ffff ||
    (value >= 0xd800 && value <= 0xdfff)
  ) {
    return "�";
  }
  return String.fromCodePoint(value);
}

/**
 * The URL allowlist. Returns the URL to use, or `null` to refuse it.
 *
 * Three separate defences, because each one alone has a known hole:
 *
 * 1. **Control characters anywhere are fatal.** `java\tscript:alert(1)` and
 *    `java\nscript:` are both live URLs in every browser — the parser strips
 *    whitespace out of the scheme before resolving it. Rejecting outright
 *    rather than stripping means no legitimate URL is silently rewritten.
 * 2. **The scheme is tested on the entity-decoded, whitespace-stripped,
 *    lowercased form**, so casing (`JaVaScRiPt:`) and encoding tricks fail.
 * 3. **A colon after the first `/`, `?` or `#` is not a scheme** — `/a:b`,
 *    `?x=a:b` and `#a:b` are relative URLs, and treating their colon as a
 *    scheme delimiter would reject perfectly ordinary links.
 *
 * Protocol-relative URLs (`//host/path`) are refused: they inherit the page's
 * scheme, they are almost never what someone typed on purpose, and they are a
 * cheap way to smuggle an off-site link past a reader skimming for `http`.
 *
 * 4. **A backslash is a slash.** WHATWG URL parsing normalises `\` to `/`
 *    before it decides anything, so `/\attacker.example/pixel` resolves to
 *    *the same URL* as `//attacker.example/pixel` — protocol-relative,
 *    off-site, and invisible to a check that only looks for two forward
 *    slashes. `/\`, `\/` and `\\` are the same trick three ways. Normalising
 *    first means the string this function reasons about is the string the
 *    browser will resolve.
 */
export function safeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;

  const probe = decodeNumericEntities(trimmed)
    .replace(/\s+/g, "")
    // A backslash is a slash to the URL parser, so it must be one here too.
    .replace(/\\/g, "/")
    .toLowerCase();
  if (probe.startsWith("//")) return null;

  const colon = probe.indexOf(":");
  if (colon > 0) {
    const firstDelimiter = Math.min(
      ...["/", "?", "#"]
        .map((char) => probe.indexOf(char))
        .filter((index) => index !== -1),
      Number.POSITIVE_INFINITY,
    );
    if (colon < firstDelimiter) {
      return ALLOWED_SCHEMES.has(probe.slice(0, colon + 1)) ? trimmed : null;
    }
  }

  return trimmed;
}

/* ============================================================== escaping == */

/**
 * Text-node escaping.
 *
 * `&` first, or the ampersands introduced by the later replacements would be
 * escaped a second time. `'` is escaped as `&#39;` rather than `&apos;` because
 * the latter is not defined in HTML 4 and old parsers pass it through verbatim.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Attribute values need the same set; kept separate so the intent is legible. */
function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

/* ================================================================ inline == */

/** Characters `\` may escape, matching CommonMark's punctuation set. */
const ESCAPABLE = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  ".",
  "!",
  ">",
  "~",
  "|",
  "@",
]);

const ISSUE_REF = /^@?([A-Z][A-Z0-9]{1,4}-\d+)/;
const MENTION = /^@([a-zA-Z0-9][a-zA-Z0-9._-]{0,38})/;
const AUTOLINK = /^https?:\/\/[^\s<>()]+[^\s<>().,:;"'!?]/;

interface InlineMatch {
  readonly node: InlineNode;
  readonly next: number;
}

/** `[label](url)`. Nested brackets in the label are matched by depth. */
function matchLink(source: string, start: number): InlineMatch | null {
  let depth = 0;
  let cursor = start;
  for (; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || source[cursor + 1] !== "(") return null;

  const close = source.indexOf(")", cursor + 2);
  if (close === -1) return null;

  const label = source.slice(start + 1, cursor);
  // A markdown link target may carry an optional title: `(url "title")`. The
  // title is dropped — it becomes a tooltip nobody asked for, and parsing it is
  // one more place for a quote to escape the attribute.
  const target = source.slice(cursor + 2, close).split(/\s+/)[0] ?? "";
  const href = safeUrl(target);
  const children = parseInline(label);

  return {
    // A refused URL degrades to its own label text rather than to a dead
    // anchor. See the module note.
    node: href === null ? { kind: "em", children } : { kind: "link", href, children },
    next: close + 1,
  };
}

function matchEmphasis(source: string, start: number): InlineMatch | null {
  const char = source[start];
  if (char === undefined) return null;

  if ((char === "*" || char === "_" || char === "~") && source[start + 1] === char) {
    const delimiter = char + char;
    const close = source.indexOf(delimiter, start + 2);
    if (close > start + 2) {
      const children = parseInline(source.slice(start + 2, close));
      return {
        node:
          char === "~"
            ? { kind: "strike", children }
            : { kind: "strong", children },
        next: close + 2,
      };
    }
  }

  if (char === "*" || char === "_") {
    const close = source.indexOf(char, start + 1);
    if (close > start + 1) {
      return {
        node: { kind: "em", children: parseInline(source.slice(start + 1, close)) },
        next: close + 1,
      };
    }
  }

  return null;
}

/**
 * Inline text → nodes.
 *
 * Precedence follows CommonMark's: a code span wins over everything inside it,
 * so `` `**not bold**` `` is literal. Recursion is always over a strictly
 * shorter substring, so it terminates.
 */
export function parseInline(source: string): readonly InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    if (buffer !== "") {
      nodes.push({ kind: "text", value: buffer });
      buffer = "";
    }
  };

  while (index < source.length) {
    const char = source[index] as string;

    if (char === "\\") {
      const next = source[index + 1];
      if (next !== undefined && ESCAPABLE.has(next)) {
        buffer += next;
        index += 2;
        continue;
      }
    }

    if (char === "`") {
      const close = source.indexOf("`", index + 1);
      if (close !== -1) {
        flush();
        nodes.push({ kind: "code", value: source.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }

    // `![alt](url)` — the image is dropped and the alt text kept. Consuming the
    // whole construct matters: leaving the `!` and letting the `[...]( ...)`
    // parse as a link would turn an image into a link to the image host.
    if (char === "!" && source[index + 1] === "[") {
      const link = matchLink(source, index + 1);
      if (link) {
        flush();
        const inner = link.node;
        nodes.push(...(inner.kind === "link" || inner.kind === "em" ? inner.children : []));
        index = link.next;
        continue;
      }
    }

    if (char === "[") {
      const link = matchLink(source, index);
      if (link) {
        flush();
        nodes.push(link.node);
        index = link.next;
        continue;
      }
    }

    if (char === "*" || char === "_" || char === "~") {
      const emphasis = matchEmphasis(source, index);
      if (emphasis) {
        flush();
        nodes.push(emphasis.node);
        index = emphasis.next;
        continue;
      }
    }

    if (char === "@") {
      const rest = source.slice(index);
      const issue = ISSUE_REF.exec(rest);
      if (issue) {
        flush();
        nodes.push({ kind: "issueRef", identifier: issue[1] as string });
        index += issue[0].length;
        continue;
      }
      const mention = MENTION.exec(rest);
      if (mention) {
        flush();
        nodes.push({ kind: "mention", handle: mention[1] as string });
        index += mention[0].length;
        continue;
      }
    }

    if (char === "h") {
      const autolink = AUTOLINK.exec(source.slice(index));
      if (autolink) {
        const href = safeUrl(autolink[0]);
        if (href !== null) {
          flush();
          nodes.push({
            kind: "link",
            href,
            children: [{ kind: "text", value: autolink[0] }],
          });
          index += autolink[0].length;
          continue;
        }
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}

/* ================================================================ blocks == */

const HEADING = /^(#{1,3})\s+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^ {0,3}[-*+]\s+(.*)$/;
const ORDERED = /^ {0,3}\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)\s*$/;

function isBlockStart(line: string): boolean {
  return (
    line.trim() === "" ||
    HEADING.test(line) ||
    RULE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line) ||
    FENCE.test(line)
  );
}

/**
 * Source → block nodes.
 *
 * Line-based and single-pass. It is not a CommonMark implementation and does not
 * try to be: the bodies this renders come from a plain textarea, and the ~1%
 * of the specification that costs 90% of the complexity (lazy continuation
 * lines, setext headings, nested list indentation, link reference definitions)
 * buys nothing here while adding places to be wrong.
 */
export function parseMarkdown(source: string): readonly BlockNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as string;

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      const language = fence[2] === undefined || fence[2] === "" ? null : fence[2];
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] as string;
        if (current.trimStart().startsWith(marker)) {
          index += 1;
          break;
        }
        body.push(current);
        index += 1;
      }
      blocks.push({ kind: "codeBlock", language, value: body.join("\n") });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const hashes = (heading[1] as string).length;
      blocks.push({
        kind: "heading",
        level: (hashes === 1 ? 1 : hashes === 2 ? 2 : 3) satisfies HeadingLevel,
        children: parseInline((heading[2] as string).trim()),
      });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index] as string);
        if (!match) break;
        quoted.push(match[1] as string);
        index += 1;
      }
      blocks.push({ kind: "quote", children: parseMarkdown(quoted.join("\n")) });
      continue;
    }

    const ordered = ORDERED.test(line);
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? ORDERED : BULLET;
      const items: (readonly InlineNode[])[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index] as string);
        if (!match) break;
        items.push(parseInline((match[1] as string).trim()));
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && !isBlockStart(lines[index] as string)) {
      paragraph.push((lines[index] as string).trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

/* ============================================================ extraction == */

/** Walk every inline node in a tree, blocks included. */
function walkInline(
  blocks: readonly BlockNode[],
  visit: (node: InlineNode) => void,
): void {
  const visitAll = (nodes: readonly InlineNode[]): void => {
    for (const node of nodes) {
      visit(node);
      if (node.kind === "strong" || node.kind === "em" || node.kind === "strike") {
        visitAll(node.children);
      } else if (node.kind === "link") {
        visitAll(node.children);
      }
    }
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "paragraph":
      case "heading":
        visitAll(block.children);
        break;
      case "list":
        for (const item of block.items) visitAll(item);
        break;
      case "quote":
        walkInline(block.children, visit);
        break;
      case "codeBlock":
      case "rule":
        break;
    }
  }
}

/**
 * The `@handle`s in a body, lowercased and deduplicated.
 *
 * The server uses this to decide who gets a mention notification, which is why
 * it runs over the *parsed tree* rather than a regex on the raw source: a handle
 * inside a code span is a code sample, not a summons, and only the parser knows
 * the difference.
 */
export function collectMentionHandles(source: string): readonly string[] {
  const handles = new Set<string>();
  walkInline(parseMarkdown(source), (node) => {
    if (node.kind === "mention") handles.add(node.handle.toLowerCase());
  });
  return [...handles];
}

/** The `ENG-123` identifiers referenced in a body, uppercased and deduplicated. */
export function collectIssueReferences(source: string): readonly string[] {
  const identifiers = new Set<string>();
  walkInline(parseMarkdown(source), (node) => {
    if (node.kind === "issueRef") identifiers.add(node.identifier.toUpperCase());
  });
  return [...identifiers];
}

/* =============================================================== to HTML == */

export interface MarkdownHtmlOptions {
  /** `handle` (lowercased) → display name, for rendering a mention chip. */
  readonly mentions?: Readonly<Record<string, string>>;
  /** Turns an `ENG-123` reference into a link. Omit to render it as a chip. */
  readonly issueHref?: (identifier: string) => string | null;
}

/**
 * The display name for a handle, or `null` if the workspace has no such member.
 *
 * A plain `mentions[handle]` is an inherited-property lookup, and every
 * JavaScript object answers to a dozen handles nobody put in it: `@constructor`
 * resolves to `Object.prototype.constructor`, `@toString` to a function. The
 * consequence is a mention chip rendering `@function Object() { [native code] }`
 * to every reader of the issue — a stranger's name in a workspace they are not
 * in, as far as the reader can tell — from a body anyone may write.
 *
 * So: an *own* property, and a string. `hasOwnProperty` is called off
 * `Object.prototype` rather than the map, because the map may legitimately have
 * a null prototype (see `mentionDirectory`) and would then have no method to
 * call. The `typeof` check is the second half of the same guard: an own
 * property inherited through a spread of a hostile object could still be a
 * function.
 *
 * Exported because the React renderer in `components/issue-detail/markdown.tsx`
 * has to make the identical lookup, and two copies of a guard is one copy of a
 * guard.
 */
export function mentionName(
  mentions: Readonly<Record<string, string>> | undefined,
  handle: string,
): string | null {
  if (!mentions) return null;
  const key = handle.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(mentions, key)) return null;
  const name = mentions[key];
  return typeof name === "string" ? name : null;
}

function inlineToHtml(
  nodes: readonly InlineNode[],
  options: MarkdownHtmlOptions,
): string {
  return nodes
    .map((node): string => {
      switch (node.kind) {
        case "text":
          return escapeHtml(node.value);
        case "strong":
          return `<strong>${inlineToHtml(node.children, options)}</strong>`;
        case "em":
          return `<em>${inlineToHtml(node.children, options)}</em>`;
        case "strike":
          return `<del>${inlineToHtml(node.children, options)}</del>`;
        case "code":
          return `<code>${escapeHtml(node.value)}</code>`;
        case "link": {
          // Re-checked here rather than trusted from the parser. The tree is a
          // public type: anyone can hand this function a hand-built node, and a
          // serialiser that trusts its input is a serialiser with a hole in it.
          const href = safeUrl(node.href);
          const inner = inlineToHtml(node.children, options);
          if (href === null) return inner;
          return `<a href="${escapeAttribute(href)}" rel="noopener noreferrer" target="_blank">${inner}</a>`;
        }
        case "mention": {
          const name = mentionName(options.mentions, node.handle);
          return `<span class="mention" data-mention="${escapeAttribute(node.handle)}">@${escapeHtml(name ?? node.handle)}</span>`;
        }
        case "issueRef": {
          const href = options.issueHref?.(node.identifier) ?? null;
          const safe = href === null ? null : safeUrl(href);
          const text = escapeHtml(node.identifier);
          return safe === null
            ? `<span class="issue-ref">${text}</span>`
            : `<a class="issue-ref" href="${escapeAttribute(safe)}" rel="noopener noreferrer">${text}</a>`;
        }
      }
    })
    .join("");
}

function blockToHtml(block: BlockNode, options: MarkdownHtmlOptions): string {
  switch (block.kind) {
    case "paragraph":
      return `<p>${inlineToHtml(block.children, options)}</p>`;
    case "heading":
      return `<h${block.level}>${inlineToHtml(block.children, options)}</h${block.level}>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map((item) => `<li>${inlineToHtml(item, options)}</li>`)
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "codeBlock": {
      const language =
        block.language === null
          ? ""
          : ` class="language-${escapeAttribute(block.language)}"`;
      return `<pre><code${language}>${escapeHtml(block.value)}</code></pre>`;
    }
    case "quote":
      return `<blockquote>${block.children.map((child) => blockToHtml(child, options)).join("")}</blockquote>`;
    case "rule":
      return "<hr />";
  }
}

/**
 * Markdown source → an HTML string that is safe to insert.
 *
 * "Safe" here is structural rather than filtered: the output is assembled from
 * a closed set of tags with every text run escaped, so there is no input for
 * which it can emit a tag or an attribute this function did not write itself.
 */
export function renderMarkdownToHtml(
  source: string,
  options: MarkdownHtmlOptions = {},
): string {
  return parseMarkdown(source)
    .map((block) => blockToHtml(block, options))
    .join("");
}

/**
 * The plain-text reduction of a body — for a list preview or a notification.
 *
 * Built from the tree rather than by stripping characters from the source, so
 * `**bold**` becomes `bold` and a link becomes its label rather than its URL.
 */
export function markdownToPlainText(source: string): string {
  const parts: string[] = [];
  walkInline(parseMarkdown(source), (node) => {
    if (node.kind === "text") parts.push(node.value);
    else if (node.kind === "code") parts.push(node.value);
    else if (node.kind === "mention") parts.push(`@${node.handle}`);
    else if (node.kind === "issueRef") parts.push(node.identifier);
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
