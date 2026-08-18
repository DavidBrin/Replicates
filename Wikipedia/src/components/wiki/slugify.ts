/**
 * Derives a MediaWiki-style anchor id from a heading string: spaces become
 * underscores, everything else is left alone (Wikipedia section anchors are
 * not otherwise sanitized — "C++" stays "C++").
 */
export function slugifyHeading(heading: string): string {
  return heading.trim().replace(/\s+/g, "_");
}
