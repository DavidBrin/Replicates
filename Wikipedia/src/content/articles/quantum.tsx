import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { quantumMeta } from "@/content/articles/meta";
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

export { quantumMeta };

const project = projects.find((p) => p.slug === "Quantum_Playground")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Quantum_algorithms", heading: "Quantum algorithms" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const quantum: ArticleModule = {
  meta: quantumMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Quantum Playground"
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
          { label: "Hosted on", value: <code>David-Internet/demos/quantum</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Quantum Playground</B> is an interactive state-vector simulator
        based on the Quantum Information course at the Technical University
        of Denmark. It supports one to five qubits and renders the course
        algorithms in a browser.<Ref n={1} />
      </P>

      <P>
        The demonstration includes a three.js Bloch sphere, a circuit builder,
        and visualizations for Deutsch-Jozsa, Bernstein-Vazirani, Simon&apos;s
        algorithm, and Grover&apos;s algorithm.
      </P>

      <Section heading="Overview">
        <P>
          The Bloch-sphere panel represents single-qubit gates as rotations.
          In the circuit builder, amplitude bars change as a playhead moves
          across two- and three-qubit circuits, and measurement can run
          repeated shots.
        </P>
      </Section>

      <Section heading="Quantum algorithms">
        <P>
          Simon&apos;s panel pairs inputs with a hidden string and sends measured
          equations to a GF(2) solver. Grover reflects every amplitude about the mean after its oracle marks a result, showing the rise and later
          over-rotation of the selected state&apos;s probability.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The simulator was written in TypeScript from the DTU course arc.
          Its state vectors, algorithm distributions, Bloch vectors, and
          Grover probability curves are tested against NumPy fixtures from
          course solutions. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Signals_and_Systems_Lab">Signals and Systems Lab</WikiLink></li>
          <li><WikiLink to="Nocturnal_Neuro">Nocturnal Neuro</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/quantum/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Quantum computing", "2026 establishments"]} />
    </>
  ),
};
