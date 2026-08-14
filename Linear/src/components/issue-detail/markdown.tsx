import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import {
  mentionName,
  parseMarkdown,
  safeUrl,
  type BlockNode,
  type InlineNode,
} from "@/lib/markdown";

/**
 * Markdown, rendered as React elements.
 *
 * This is the path the product actually takes, and the reason
 * `dangerouslySetInnerHTML` appears nowhere in this feature. React builds the
 * elements from the node tree, so every text run is a text node by
 * construction — there is no string in between for a `<` to be reinterpreted
 * in, and no sanitiser pass that could be forgotten or bypassed.
 *
 * `lib/markdown`'s `renderMarkdownToHtml` exists for the places a string is
 * genuinely required and is held to the same allowlist. The two share one
 * parser so they cannot disagree about what the source *is*; they differ only
 * in what they emit it as.
 *
 * The one non-obvious line is the `href` handling: an unsafe URL renders as
 * plain text with **no anchor**, rather than as an anchor with a stripped
 * `href`. A hollow anchor still looks and feels clickable, which is a worse
 * outcome than a link that visibly is not one.
 */

export interface MarkdownProps {
  source: string;
  /** `@handle` (lowercased) → display name. Unknown handles render as typed. */
  mentions?: Readonly<Record<string, string>>;
  /** `ENG-123` → href. Return null to render the reference as a chip. */
  issueHref?: (identifier: string) => string | null;
  className?: string;
  "data-testid"?: string;
}

function Inline({
  nodes,
  mentions,
  issueHref,
}: {
  nodes: readonly InlineNode[];
  mentions: Readonly<Record<string, string>> | undefined;
  issueHref: MarkdownProps["issueHref"];
}): ReactNode {
  return nodes.map((node, index) => {
    const key = index;
    switch (node.kind) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "strong":
        return (
          <strong key={key} className="[font-weight:var(--weight-title)]">
            <Inline nodes={node.children} mentions={mentions} issueHref={issueHref} />
          </strong>
        );
      case "em":
        return (
          <em key={key}>
            <Inline nodes={node.children} mentions={mentions} issueHref={issueHref} />
          </em>
        );
      case "strike":
        return (
          <del key={key} className="text-tertiary">
            <Inline nodes={node.children} mentions={mentions} issueHref={issueHref} />
          </del>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded-[var(--radius-sm)] bg-elevated px-1 py-0.5 font-mono text-[0.875em]"
          >
            {node.value}
          </code>
        );
      case "link": {
        const href = safeUrl(node.href);
        const children = (
          <Inline nodes={node.children} mentions={mentions} issueHref={issueHref} />
        );
        if (href === null) return <Fragment key={key}>{children}</Fragment>;
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-text)] hover:underline"
          >
            {children}
          </a>
        );
      }
      case "mention": {
        // `mentionName`, not `mentions[handle]`: an inherited-property lookup
        // answers `@constructor` with `Object.prototype.constructor`, and the
        // chip then prints a name nobody in this workspace has. See
        // `lib/markdown.ts`.
        const name = mentionName(mentions, node.handle);
        return (
          <span
            key={key}
            data-testid={`mention-${node.handle.toLowerCase()}`}
            data-mention={node.handle}
            className={cn(
              "rounded-[var(--radius-sm)] px-1",
              "bg-[var(--accent-tint)] text-[var(--accent-text)]",
              "[font-weight:var(--weight-medium)]",
            )}
          >
            @{name ?? node.handle}
          </span>
        );
      }
      case "issueRef": {
        const href = issueHref?.(node.identifier) ?? null;
        const safe = href === null ? null : safeUrl(href);
        if (safe === null) {
          return (
            <span key={key} className="font-mono text-tertiary">
              {node.identifier}
            </span>
          );
        }
        return (
          <a
            key={key}
            href={safe}
            className="font-mono text-[var(--accent-text)] hover:underline"
          >
            {node.identifier}
          </a>
        );
      }
    }
  });
}

function Block({
  block,
  mentions,
  issueHref,
}: {
  block: BlockNode;
  mentions: Readonly<Record<string, string>> | undefined;
  issueHref: MarkdownProps["issueHref"];
}): ReactNode {
  const inline = (nodes: readonly InlineNode[]): ReactNode => (
    <Inline nodes={nodes} mentions={mentions} issueHref={issueHref} />
  );

  switch (block.kind) {
    case "paragraph":
      return <p className="my-2 first:mt-0 last:mb-0">{inline(block.children)}</p>;
    case "heading": {
      const size =
        block.level === 1
          ? "text-title3"
          : block.level === 2
            ? "text-large"
            : "text-regular";
      const Tag = (`h${block.level}` as const) satisfies "h1" | "h2" | "h3";
      return (
        <Tag className={cn("mt-4 mb-2 first:mt-0 [font-weight:var(--weight-title)]", size)}>
          {inline(block.children)}
        </Tag>
      );
    }
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className="my-0.5">
          {inline(item)}
        </li>
      ));
      return block.ordered ? (
        <ol className="my-2 list-decimal pl-5">{items}</ol>
      ) : (
        <ul className="my-2 list-disc pl-5">{items}</ul>
      );
    }
    case "codeBlock":
      return (
        <pre className="my-2 overflow-x-auto rounded-[var(--radius-md)] border border-subtle bg-elevated p-3">
          <code className="font-mono text-small">{block.value}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="my-2 border-l-2 border-strong pl-3 text-secondary">
          {block.children.map((child, index) => (
            <Block key={index} block={child} mentions={mentions} issueHref={issueHref} />
          ))}
        </blockquote>
      );
    case "rule":
      return <hr className="my-4 border-0 border-t border-default" />;
  }
}

export function Markdown({
  source,
  mentions,
  issueHref,
  className,
  "data-testid": testId,
}: MarkdownProps) {
  const blocks = parseMarkdown(source);

  return (
    <div
      data-testid={testId}
      data-markdown=""
      className={cn(
        "text-regular text-secondary [line-height:1.6] break-words",
        className,
      )}
    >
      {blocks.map((block, index) => (
        <Block key={index} block={block} mentions={mentions} issueHref={issueHref} />
      ))}
    </div>
  );
}
