import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { artWallMeta } from "@/content/articles/meta";
import {
  B,
  Categories,
  ExternalLink,
  Hatnote,
  Infobox,
  P,
  Ref,
  References,
  Section,
  WikiLink,
} from "@/components/wiki";

const project = projects.find((p) => p.slug === "Art_Wall")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Persistence", heading: "Persistence" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const artWall: ArticleModule = {
  meta: artWallMeta,
  body: (
    <>
      <Hatnote>
        This article is about the public drawing app. For the Million Dollar
        Homepage replica, see <WikiLink to="Dollar_Pixels">Dollar Pixels</WikiLink>.
      </Hatnote>

      <Infobox
        title="Art Wall"
        rows={[
          { label: "Type", value: "Collaborative drawing website" },
          {
            label: "Inspired by",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Repository", value: <code>{project.folder}</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Art Wall</B> is a public drawing site in its own repository,{" "}
        <code>ArtWall</code>, separate from the <code>Replicates</code>{" "}
        collection. Visitors share three full-screen surfaces — a street wall,
        an ideas wall, and a chalkboard — and leave strokes or short text
        without creating an account.
      </P>

      <P>
        The chalkboard surface uses a photograph of a real slate board rather
        than a generated green gradient, so marks sit on dust and grain
        instead of a flat fill.
      </P>

      <Section heading="Overview">
        <P>
          The visible chrome is two controls, Menu and About. Menu covers
          install, export as PNG, brush and eraser size, colour, and which
          wall is active. Each wall stores its own strokes and texts.
        </P>
      </Section>

      <Section heading="Persistence">
        <P>
          The first production database was a Supabase project that later
          went away — the hostname stopped resolving — so the live site
          failed to load the wall.<Ref n={1} /> Persistence now uses a
          dedicated Neon Postgres database, with the same <code>strokes</code>{" "}
          and <code>wall_texts</code> tables, reached only through the Next.js
          API. The page polls for new marks every few seconds.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Dollar_Pixels">Dollar Pixels</WikiLink>
          </li>
          <li>
            <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>
          </li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1">
              The original Supabase project URL no longer resolved in DNS
              (NXDOMAIN), which is why <code>GET /api/wall</code> returned
              500 until the Neon database was attached.
            </span>,
            <span key="2">
              <code>ArtWall/README.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Web applications", "Collaborative software"]} />
    </>
  ),
};
