import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Markdown } from "@/components/issue-detail/markdown";

/**
 * The renderer the product actually uses, attacked directly.
 *
 * `lib/__tests__/markdown.test.ts` proves the *string* serialiser is safe. This
 * proves the same for the React path, and the two are not the same claim: React
 * has its own escaping and its own `href` handling, and a component could
 * perfectly well reach for `dangerouslySetInnerHTML` while the string renderer
 * beside it stayed impeccable.
 *
 * So the assertions are made against the rendered DOM: does a `<script>` node
 * exist, does any element carry an `on*` attribute, what does the browser think
 * an anchor's protocol is. Those are the questions an attacker's payload
 * answers, and they are answerable without trusting either implementation.
 */

function eventHandlerAttributes(container: HTMLElement): string[] {
  const found: string[] = [];
  for (const element of container.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        found.push(`${element.tagName}.${attribute.name}`);
      }
    }
  }
  return found;
}

describe("Markdown — rendering", () => {
  it("renders formatted markdown as elements", () => {
    const { container } = render(
      <Markdown source={"# Heading\n\n- one\n- two\n\n**bold** and `code`"} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Heading");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("renders a mention as a chip with the resolved display name", () => {
    render(<Markdown source="@dana take a look" mentions={{ dana: "Dana Okafor" }} />);
    const chip = screen.getByTestId("mention-dana");
    expect(chip).toHaveTextContent("@Dana Okafor");
    expect(chip).toHaveAttribute("data-mention", "dana");
  });

  it("renders an unknown handle as typed rather than dropping it", () => {
    render(<Markdown source="@ghost" />);
    expect(screen.getByTestId("mention-ghost")).toHaveTextContent("@ghost");
  });

  it("links an issue reference only when given a resolver", () => {
    const { container, rerender } = render(<Markdown source="blocked by @ENG-7" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("ENG-7");

    rerender(<Markdown source="blocked by @ENG-7" issueHref={(id) => `/demo/issue/${id}`} />);
    expect(container.querySelector("a")).toHaveAttribute("href", "/demo/issue/ENG-7");
  });

  it("gives every external link rel=noopener noreferrer", () => {
    // `window.opener` on a `target="_blank"` navigation lets the opened page
    // rewrite this one; the referrer would carry the workspace key.
    const { container } = render(<Markdown source="[docs](https://linear.app)" />);
    const anchor = container.querySelector("a");
    expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
    expect(anchor).toHaveAttribute("target", "_blank");
  });
});

describe("Markdown — XSS payloads", () => {
  it("builds no script element from a script tag", () => {
    const { container } = render(<Markdown source={'<script>alert("xss")</script>'} />);
    expect(container.querySelectorAll("script")).toHaveLength(0);
    // The text is preserved — the author typed it, so it should be readable.
    expect(container.textContent).toContain('<script>alert("xss")</script>');
  });

  it("builds no img element and no onerror handler", () => {
    const { container } = render(<Markdown source={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(eventHandlerAttributes(container)).toEqual([]);
  });

  it("drops an image construct entirely, keeping only its alt text", () => {
    const { container } = render(
      <Markdown source="![alt text](https://evil.example/x.png)" />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("alt text");
  });

  it("refuses a javascript: href and renders no anchor at all", () => {
    // Not an anchor with a stripped href: a hollow link still looks clickable.
    const { container } = render(<Markdown source="[click me](javascript:alert(1))" />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.textContent).toContain("click me");
  });

  it("refuses an anchor with a data: URL", () => {
    const { container } = render(
      <Markdown source="[open](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)" />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("data:text/html");
    expect(container.textContent).toContain("open");
  });

  it("survives a battery of payloads with no dangerous node and no handler", () => {
    const payloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      "<svg/onload=alert(1)>",
      '<iframe src="javascript:alert(1)"></iframe>',
      '<a href="javascript:alert(1)">x</a>',
      '<body onload="alert(1)">',
      "[a](JaVaScRiPt:alert(1))",
      "[a](java\tscript:alert(1))",
      "[a](&#106;avascript:alert(1))",
      "[a](vbscript:msgbox(1))",
      "> <script>alert(1)</script>",
      "- <img src=x onerror=alert(1)>",
      "```\n<script>alert(1)</script>\n```",
    ];

    for (const payload of payloads) {
      const { container, unmount } = render(<Markdown source={payload} />);
      expect(
        container.querySelectorAll("script,img,iframe,object,embed,style,svg,form,base"),
        payload,
      ).toHaveLength(0);
      expect(eventHandlerAttributes(container), payload).toEqual([]);
      for (const anchor of container.querySelectorAll("a")) {
        expect(anchor.protocol, payload).toMatch(/^(https?|mailto):$/);
      }
      unmount();
    }
  });

  it("escapes markup inside a resolved mention name", () => {
    // The display name comes from the database, which is user-controlled at
    // sign-up. It is text, and has to render as text.
    const { container } = render(
      <Markdown source="@dana" mentions={{ dana: "<img src=x onerror=alert(1)>" }} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
