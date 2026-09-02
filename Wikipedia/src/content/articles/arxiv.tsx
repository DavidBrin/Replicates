import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { arxivMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "ArXiv_Semantic_Graph")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Semantic_graph", heading: "Semantic graph" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const arxiv: ArticleModule = {
  meta: arxivMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="arXiv Semantic Graph"
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
          { label: "Hosted on", value: <code>David-Internet/demos/arxiv</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>arXiv Semantic Graph</B> is an interactive demonstration of a
        recommendation-system project by Group 36 in DTU course 02807,
        Computational Tools for Data Science. It is hosted on{" "}
        <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink> and
        displays a 2,500-paper stratified subsample.<Ref n={1} />
      </P>

      <P>
        The project transforms arXiv abstracts into Universal Sentence Encoder
        embeddings, joins similar papers into a graph, finds Louvain
        communities, and supplies nearest-neighbour recommendations. It also
        includes live implementations of A-priori, Girvan-Newman, and
        Laplacian spectral clustering.
      </P>

      <Section heading="Overview">
        <P>
          Visitors can drag a similarity threshold, select a paper, and inspect
          its five nearest neighbours with same-community labels. The course
          algorithm panels use 14,963 grocery baskets for A-priori, Zachary&apos;s
          karate club for Girvan-Newman, and a Jacobi eigensolver for the
          Laplacian view.
        </P>
      </Section>

      <Section heading="Semantic graph">
        <P>
          The original pipeline used 148,477 abstracts, HNSW nearest-neighbour
          search, and a global distance threshold τ. The archived conclusion was that modularity peaked at tau 0.19 and the team shipped 0.27.
          The first value maximized modularity in the full run, while the second
          was selected in the report for usability. The browser graph uses exact
          brute-force nearest neighbours on its smaller subsample.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The demo replays a fall 2025 Group 36 project. It contains
          fixture-tested TypeScript ports of Louvain and modularity, threshold
          selection, A-priori, Girvan-Newman, and a Jacobi eigensolver.
          {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Quantum_Playground">Quantum Playground</WikiLink>
          </li>
          <li>
            <WikiLink to="Computer_Vision">Computer Vision</WikiLink>
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
              <code>content/arxiv/README.md</code>, David&apos;s Internet.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Information retrieval", "2026 establishments"]} />
    </>
  ),
};
