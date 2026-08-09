"use client";

/**
 * Block type → component.
 *
 * A registry object rather than a switch in JSX: the mapping is data, so
 * adding a block type is one entry here plus one entry in `BLOCK_TYPE_META`,
 * and the `Record<BlockType, …>` makes the compiler flag any type left
 * unrendered.
 */

import type { ComponentType } from "react";

import type { BlockType } from "@/lib/model/types";

import { BulletedListItem } from "./blocks/BulletedListItem";
import { Callout } from "./blocks/Callout";
import { ChildDatabase } from "./blocks/ChildDatabase";
import { ChildPageLink } from "./blocks/ChildPageLink";
import { Code } from "./blocks/Code";
import { Divider } from "./blocks/Divider";
import { Heading } from "./blocks/Heading";
import { ImageBlock } from "./blocks/ImageBlock";
import { NumberedListItem } from "./blocks/NumberedListItem";
import { Paragraph } from "./blocks/Paragraph";
import { Quote } from "./blocks/Quote";
import { ToDo } from "./blocks/ToDo";
import { Toggle } from "./blocks/Toggle";
import type { BlockComponentProps } from "./blocks/shared";

export type { BlockComponentProps };

const BLOCK_COMPONENTS: Record<BlockType, ComponentType<BlockComponentProps>> = {
  paragraph: Paragraph,
  heading_1: Heading,
  heading_2: Heading,
  heading_3: Heading,
  bulleted_list_item: BulletedListItem,
  numbered_list_item: NumberedListItem,
  to_do: ToDo,
  toggle: Toggle,
  quote: Quote,
  callout: Callout,
  code: Code,
  divider: Divider,
  image: ImageBlock,
  child_page: ChildPageLink,
  child_database: ChildDatabase,
};

export function BlockRenderer({ block, depth }: BlockComponentProps) {
  // Falls back to a paragraph so a snapshot written by a newer schema renders
  // its text instead of vanishing.
  const Component = BLOCK_COMPONENTS[block.type] ?? Paragraph;
  return <Component block={block} depth={depth} />;
}
