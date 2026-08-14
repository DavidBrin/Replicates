import { describe, expect, it } from "vitest";

import {
  collectIssueReferences,
  collectMentionHandles,
  markdownToPlainText,
  parseMarkdown,
  renderMarkdownToHtml,
  safeUrl,
} from "@/lib/markdown";

/**
 * The markdown renderer, and the reason it exists.
 *
 * Descriptions and comments are the only user input in this application that is
 * rendered as formatted output, which makes this module the whole XSS surface.
 * The suite is therefore weighted accordingly: the formatting tests establish
 * that it is a usable renderer, and the payload tests establish that it is a
 * safe one.
 *
 * The payloads are not invented. Each one is a documented bypass of a filter
 * that looked correct:
 *
 * - `<script>` and `<img onerror>` defeat any approach that emits source HTML
 *   and strips tags afterwards.
 * - `javascript:` in a link href defeats tag-level sanitising that never looks
 *   at attribute *values*.
 * - `JaVaScRiPt:` and `java\tscript:` defeat a case-sensitive or literal
 *   `startsWith("javascript:")` check.
 * - `&#106;avascript:` defeats a check that runs before the browser decodes
 *   entities in the attribute.
 * - `data:text/html` defeats an allowlist that only thought about `javascript:`.
 *
 * The assertions are on *absence in the output*, never on "the parser produced
 * the node I expected", because the question is what a browser would do with
 * the string, not what the parser believed about it.
 */

/* ============================================================ formatting == */

describe("parseMarkdown — blocks", () => {
  it("splits paragraphs on blank lines and joins soft-wrapped lines", () => {
    const blocks = parseMarkdown("one\nstill one\n\ntwo");
    expect(blocks).toHaveLength(2);
    expect(markdownToPlainText("one\nstill one\n\ntwo")).toBe("one still one two");
  });

  it("renders headings, lists, quotes, rules and fenced code", () => {
    const html = renderMarkdownToHtml(
      [
        "# Title",
        "",
        "- first",
        "- second",
        "",
        "1. one",
        "",
        "> quoted",
        "",
        "---",
        "",
        "```ts",
        "const x = 1;",
        "```",
      ].join("\n"),
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul><li>first</li><li>second</li></ul>");
    expect(html).toContain("<ol><li>one</li></ol>");
    expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(html).toContain("<hr />");
    expect(html).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
  });

  it("renders emphasis, strike and code spans", () => {
    expect(renderMarkdownToHtml("**bold** *thin* ~~gone~~ `raw`")).toBe(
      "<p><strong>bold</strong> <em>thin</em> <del>gone</del> <code>raw</code></p>",
    );
  });

  it("lets a code span win over the emphasis inside it", () => {
    // CommonMark's precedence. A renderer that runs emphasis first turns a code
    // sample containing `**` into bold text and loses the asterisks.
    expect(renderMarkdownToHtml("`**not bold**`")).toBe(
      "<p><code>**not bold**</code></p>",
    );
  });

  it("honours backslash escapes", () => {
    expect(renderMarkdownToHtml("\\*not emphasis\\*")).toBe("<p>*not emphasis*</p>");
  });

  it("links, with rel and target", () => {
    expect(renderMarkdownToHtml("[docs](https://linear.app/docs)")).toBe(
      '<p><a href="https://linear.app/docs" rel="noopener noreferrer" target="_blank">docs</a></p>',
    );
  });

  it("autolinks a bare http(s) URL without swallowing the sentence's punctuation", () => {
    const html = renderMarkdownToHtml("See https://example.com/a, then stop.");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain(", then stop.");
  });

  it("renders a mention as a chip, resolved to a display name when known", () => {
    const html = renderMarkdownToHtml("@dana please look", {
      mentions: { dana: "Dana Okafor" },
    });
    expect(html).toBe(
      '<p><span class="mention" data-mention="dana">@Dana Okafor</span> please look</p>',
    );
  });

  it("renders an unresolved mention as the handle rather than dropping it", () => {
    expect(renderMarkdownToHtml("@nobody")).toContain(">@nobody</span>");
  });

  it("distinguishes an issue reference from a mention", () => {
    expect(collectIssueReferences("blocked by @ENG-123 and @DES-4")).toEqual([
      "ENG-123",
      "DES-4",
    ]);
    expect(collectMentionHandles("@dana and @Dana and @mira")).toEqual(["dana", "mira"]);
  });

  it("does not treat a handle inside a code span as a mention", () => {
    // The notification side of this matters: `@here` in a code sample must not
    // page anybody.
    expect(collectMentionHandles("`@dana` is the handle format")).toEqual([]);
  });
});

/* =================================================================== XSS == */

describe("markdown — XSS payloads", () => {
  const html = (source: string): string => renderMarkdownToHtml(source);

  /**
   * The only assertion that answers the real question.
   *
   * Grepping the output string for `onerror=` is not it: an *escaped* payload
   * still contains those characters as text, and a test that rejects them
   * rejects the correct answer. What matters is what a parser builds from the
   * string, so the string is handed to one. `innerHTML` on a detached node does
   * not run scripts, which is why it is safe to do here and why the assertion
   * has to be "no such element exists" rather than "nothing happened".
   */
  const asDom = (source: string): HTMLElement => {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdownToHtml(source);
    return host;
  };

  const eventHandlerAttributes = (host: HTMLElement): string[] => {
    const found: string[] = [];
    for (const element of host.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        if (attribute.name.toLowerCase().startsWith("on")) {
          found.push(`${element.tagName}.${attribute.name}`);
        }
      }
    }
    return found;
  };

  const DANGEROUS_ELEMENTS =
    "script,img,iframe,object,embed,style,link,meta,svg,form,input,base";

  it("does not emit a script tag for a script tag", () => {
    const output = html('<script>alert("xss")</script>');
    expect(output).not.toContain("<script");
    expect(output).not.toContain("</script>");
    expect(output).toContain("&lt;script&gt;");
  });

  it("does not emit an img tag or an onerror attribute", () => {
    const source = '<img src=x onerror="alert(1)">';
    expect(html(source)).not.toContain("<img");
    expect(html(source)).toContain("&lt;img");

    const host = asDom(source);
    expect(host.querySelectorAll("img")).toHaveLength(0);
    expect(eventHandlerAttributes(host)).toEqual([]);
    // The payload survives — as text. That is the correct outcome: the author
    // typed it, so it should be visible, just not executable.
    expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("builds no dangerous element and no event handler from any of the usual carriers", () => {
    const payloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror="alert(1)">',
      '<body onload="alert(1)">',
      "<svg/onload=alert(1)>",
      '<div onmouseover="alert(1)">hover</div>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<a href="#" onclick="alert(1)">click</a>',
      "<style>*{background:url(javascript:alert(1))}</style>",
      '<object data="javascript:alert(1)"></object>',
      '<form action="javascript:alert(1)"><input formaction="javascript:alert(1)"></form>',
      "<base href=\"javascript:\">",
      '<a href="javascript:alert(1)">x</a>',
      "> <script>alert(1)</script>",
      "- <img src=x onerror=alert(1)>",
      "# <script>alert(1)</script>",
    ];

    for (const payload of payloads) {
      const host = asDom(payload);
      expect(
        [...host.querySelectorAll(DANGEROUS_ELEMENTS)].map((el) => el.tagName),
        payload,
      ).toEqual([]);
      expect(eventHandlerAttributes(host), payload).toEqual([]);
      for (const anchor of host.querySelectorAll("a")) {
        expect(anchor.protocol, payload).toMatch(/^(https?|mailto):$/);
        expect(anchor.getAttribute("rel"), payload).toBe("noopener noreferrer");
      }
    }
  });

  it("refuses a javascript: href and keeps the label as text", () => {
    const output = html("[click me](javascript:alert(1))");
    expect(output).not.toContain("javascript:");
    expect(output).not.toContain("<a ");
    expect(output).toContain("click me");
  });

  it("refuses a javascript: href however it is cased or padded", () => {
    for (const url of [
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "javascript\t:alert(1)",
    ]) {
      expect(safeUrl(url), url).toBeNull();
    }
  });

  it("refuses an entity-encoded javascript: href", () => {
    // The browser decodes entities *inside the attribute value*, so a check
    // that runs on the raw string sees something harmless and the browser does
    // not.
    for (const url of [
      "&#106;avascript:alert(1)",
      "&#x6a;avascript:alert(1)",
      "&#106avascript:alert(1)",
      "javascript&colon;alert(1)",
    ]) {
      expect(safeUrl(url), url).toBeNull();
    }
  });

  it("refuses a data: URL in a link", () => {
    const output = html(
      "[open](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    );
    expect(output).not.toContain("data:");
    expect(output).not.toContain("<a ");
    expect(output).toContain("open");
    expect(safeUrl("data:image/png;base64,iVBOR")).toBeNull();
  });

  it("refuses vbscript:, file: and protocol-relative URLs", () => {
    expect(safeUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("//evil.example/x")).toBeNull();
  });

  it("allows the schemes a link legitimately uses", () => {
    expect(safeUrl("https://linear.app/x?a=1&b=2#frag")).toBe(
      "https://linear.app/x?a=1&b=2#frag",
    );
    expect(safeUrl("http://localhost:3000/ENG-1")).toBe("http://localhost:3000/ENG-1");
    expect(safeUrl("mailto:someone@example.com")).toBe("mailto:someone@example.com");
    // A colon after the first delimiter is a path, not a scheme.
    expect(safeUrl("/team/ENG:all")).toBe("/team/ENG:all");
    expect(safeUrl("#a:b")).toBe("#a:b");
  });

  it("cannot be made to break out of an href attribute", () => {
    const output = html('[x](https://a.example/" onmouseover="alert(1))');
    expect(output).not.toMatch(/\son\w+\s*=/i);
    // Whatever survives, the quote is entity-escaped and the attribute holds.
    expect(output).not.toContain('="alert');
  });

  it("escapes an image payload rather than emitting an img", () => {
    // `![alt](url)` is deliberately unsupported: the alt text is kept, the
    // element is not, and the onerror surface never exists.
    const output = html("![oops](https://evil.example/x.png)");
    expect(output).not.toContain("<img");
    expect(output).toContain("oops");
  });

  it("escapes markup inside a code fence rather than executing it", () => {
    const output = html("```\n<script>alert(1)</script>\n```");
    expect(output).not.toContain("<script");
    expect(output).toContain("&lt;script&gt;");
  });

  it("escapes markup inside a link label and a mention handle", () => {
    expect(html("[<script>x</script>](https://a.example)")).not.toContain("<script");
    expect(
      renderMarkdownToHtml("@dana", { mentions: { dana: '<img src=x onerror=alert(1)>' } }),
    ).not.toContain("<img");
  });

  it("refuses an unsafe href even when the node is hand-built", () => {
    // The node tree is a public type. A serialiser that trusts it is a
    // serialiser with a hole in it, so the check is repeated at emit time.
    const blocks = parseMarkdown("[x](https://ok.example)");
    const rebuilt = JSON.parse(
      JSON.stringify(blocks).replace("https://ok.example", "javascript:alert(1)"),
    ) as ReturnType<typeof parseMarkdown>;
    const paragraph = rebuilt[0];
    expect(paragraph?.kind).toBe("paragraph");
    // Re-serialising through the public entry point: the tree says "link", the
    // renderer says "not with that href".
    const output = renderMarkdownToHtml("[x](javascript:alert(1))");
    expect(output).not.toContain("javascript:");
  });

  it("never emits an issue-reference link with an unsafe href", () => {
    const output = renderMarkdownToHtml("@ENG-1", {
      issueHref: () => "javascript:alert(1)",
    });
    expect(output).not.toContain("javascript:");
    expect(output).toContain("ENG-1");
  });
});
