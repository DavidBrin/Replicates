import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { nocturnalMeta } from "@/content/articles/meta";
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

export { nocturnalMeta };

const project = projects.find((p) => p.slug === "Nocturnal_Neuro")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "EEG_processing", heading: "EEG processing" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const nocturnal: ArticleModule = {
  meta: nocturnalMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Nocturnal Neuro"
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
          { label: "Hosted on", value: <code>David-Internet/demos/nocturnal</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Nocturnal Neuro</B> is an interactive EEG-wearable demonstration
        covering a KiCad rework of the OpenBCI Ganglion, a recorded EEG, and
        venture materials from UC San Diego&apos;s Basement program.<Ref n={1} />
      </P>

      <P>
        The browser page displays board layers and schematic sheets, then
        processes a 20-channel Cognionics EEG recording. It also presents
        business, value-proposition, and empathy canvases from November 2024.
      </P>

      <Section heading="Overview">
        <P>
          The PCB explorer separates the board into copper, mask, silkscreen,
          and drill layers. Visitors can inspect component footprints, BOM
          lines, source substitutions, and four linked schematic sheets.
        </P>
      </Section>

      <Section heading="EEG processing">
        <P>
          The brainwave laboratory lets visitors select electrodes and apply
          low-pass filtering, downsampling, a 60 Hz notch, common-average
          referencing, and Welch coherence. The board is a four-layer Ganglion rework with 140 footprints, and the TypeScript signal pipeline is
          checked against SciPy fixtures.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The page was built from an open-hardware Ganglion rework, David&apos;s
          recording, and launch-program canvases. KiCad provides the board
          source, while MNE, neurodsp, and TypeScript supply the DSP work.
          {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Verilog">Verilog</WikiLink></li>
          <li><WikiLink to="Quantum_Playground">Quantum Playground</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/nocturnal/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Neurotechnology", "2026 establishments"]} />
    </>
  ),
};
