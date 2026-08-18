import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { notionMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Notion_(replica)")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Architecture", heading: "Architecture" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const notion: ArticleModule = {
  meta: notionMeta,
  body: (
    <>
      <Hatnote>
        This article is about the replica. For the product it replicates, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
      </Hatnote>

      <Infobox
        title="Notion (replica)"
        rows={[
          { label: "Type", value: "Workspace / note-taking software" },
          {
            label: "Replica of",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Repository", value: <code>../{project.folder}</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Notion (replica)</B> is a rebuild of{" "}
        <ExternalLink href={project.replicaOf.url}>Notion</ExternalLink>, the
        workspace and note-taking product, developed in the{" "}
        <code>Notion</code> folder of the <code>Replicates</code> repository.
        It reproduces both a marketing site and the product itself, built in
        a single development session.
      </P>

      <P>
        The replica persists everything client-side in IndexedDB; it has no
        backend and deploys to Vercel with no environment variables.
      </P>

      <Section heading="Overview">
        <P>
          The block editor supports 15 block types, a slash menu, markdown
          shortcuts, block nesting, and splitting and merging blocks.
          Database views cover board, table, list and calendar layouts with
          filtering, sorting and grouping across 13 property types. Sharing
          supports four access levels, and the interface includes a
          command-K (⌘K) palette, a dark mode, and JSON export and import.
        </P>
      </Section>

      <Section heading="Architecture">
        <P>
          The color palette was pulled directly from Notion&apos;s shipped
          CSS custom properties, including its warm-grey background{" "}
          <code>#f9f8f7</code> — one reason, according to the project&apos;s
          own account, that Notion &ldquo;reads as paper.&rdquo;<Ref n={1} />{" "}
          Database rows are implemented as pages, mirroring Notion&apos;s own
          data model. The text editor is a custom <code>contentEditable</code>{" "}
          implementation rather than ProseMirror, chosen to avoid a lossy
          mapping between editor state and the block model. Persistence uses
          IndexedDB rather than <code>localStorage</code>, citing WebKit&apos;s
          seven-day eviction policy for the latter, and is implemented behind
          four separate <code>StorageAdapter</code> implementations.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica was built by parallel research agents, followed by a
          single-threaded foundation pass, then four parallel surface agents.
          It carries {project.testStats}. Unlike its siblings in the
          portfolio, the project has no <code>SPEC.md</code> or{" "}
          <code>DECISIONS.md</code> and no screenshots directory.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Linear_(replica)">Linear (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="YouTube_(replica)">YouTube (replica)</WikiLink>
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
              <code>Notion/README.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Note-taking software"]} />
    </>
  ),
};
