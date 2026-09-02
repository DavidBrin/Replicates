import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { sqlMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "SQL_Playground")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Databases", heading: "Databases" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const sql: ArticleModule = {
  meta: sqlMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="SQL Playground"
        rows={[
          { label: "Type", value: "Interactive demo" },
          {
            label: "Origin",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Hosted on", value: <code>David-Internet/demos/sql</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>SQL Playground</B> is an interactive demonstration of David&apos;s
        DTU Databases coursework from fall 2025. Six databases run in the
        browser through sql.js, which is SQLite compiled to WebAssembly, and
        44 presets from the weekly answer sheets run against them with no
        server involved.<Ref n={1} />
      </P>

      <P>
        The course scripts were written for MariaDB. The build translates
        them to SQLite, and presets that relied on MariaDB-only features are
        adapted, labeled, and shown beside their originals: session variables
        become common table expressions, stored functions become correlated
        subqueries, and a SIGNAL trigger becomes RAISE.
      </P>

      <Section heading="Overview">
        <P>
          A schema browser draws each database&apos;s tables and foreign-key
          graph, with the DDL highlighted on hover, next to the surviving
          design artifacts: two hand-drawn ER designs and the bike-shop data
          sheet. The query runner holds 34 weekly answer queries as editable
          presets, covering joins, grouping, and correlated subqueries, and
          highlights the tables each query touches. A modification panel
          replays the bike-shop project&apos;s ten-step insert, update and
          delete script with before and after diffs, an undo that re-seeds
          the database, a foreign-key enforcement toggle that changes how the
          script ends, and the week-13 trigger together with the insert that
          trips it.
        </P>
      </Section>

      <Section heading="Databases">
        <P>
          Five schemas come from the course: the University database, which
          is the course&apos;s version of the Silberschatz, Korth and
          Sudarshan textbook database, the Family warm-up, the Cinema exam
          set, and the Takeaway and Bus Service exercise sets. The sixth, the
          bike shop, is a 2026 reconstruction: only the project&apos;s data
          sheet and modification script survive, so the schema and seed rows
          were rebuilt from those two files and are labeled as reconstructed
          on the page.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          Every preset is fixture-tested: the build executes each one in
          Python&apos;s sqlite3 and the test suite requires sql.js to return
          identical columns and rows, including the preset that is supposed
          to fail on the trigger. The vendored answer files have the student
          ID scrubbed. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Quantum_Playground">Quantum Playground</WikiLink>
          </li>
          <li>
            <WikiLink to="ArXiv_Semantic_Graph">arXiv Semantic Graph</WikiLink>
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
              <code>content/sql/README.md</code>, David&apos;s Internet.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Databases", "2026 establishments"]} />
    </>
  ),
};
