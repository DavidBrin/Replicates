import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { signalsMeta } from "@/content/articles/meta";
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

export { signalsMeta };

const project = projects.find((p) => p.slug === "Signals_and_Systems_Lab")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Echo_cancellation", heading: "Echo cancellation" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const signals: ArticleModule = {
  meta: signalsMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Signals and Systems Lab"
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
          { label: "Hosted on", value: <code>David-Internet/demos/signals</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Signals and Systems Lab</B> is an interactive port of five ECE 101
        MATLAB labs from UC San Diego. It runs audio decryption, echo
        cancellation, image deblurring, aliasing, and cart-pole control in
        the browser.<Ref n={1} />
      </P>

      <P>
        The labs are adapted from <i>Computer Explorations in Signals and
        Systems</i>. Audio panels use Web Audio, and the mathematical routines
        run client-side in TypeScript.
      </P>

      <Section heading="Overview">
        <P>
          The first lab reconstructs a scrambled speech signal through
          magnitude and phase unpacking and a seeded permutation. Other panels
          show a Toeplitz deblurring system, sampling-rate aliasing, and
          feedback gains that move cart-pole poles in the complex plane.
        </P>
      </Section>

      <Section heading="Echo cancellation">
        <P>
          The echo panel uses autocorrelation to identify a delay and strength,
          then applies an inverse IIR filter. As the echo strength changes,
          echo poles walk toward the unit circle; values past the stable range
          make the filter diverge.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          David ported the ECE 101 MATLAB Live Scripts to TypeScript. FFT,
          IIR filtering, pseudoinverse, and RK4 implementations are compared
          with SciPy and NumPy fixtures across all five labs. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Quantum_Playground">Quantum Playground</WikiLink></li>
          <li><WikiLink to="HardHack_2026">HardHack 2026</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/signals/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Signal processing", "2026 establishments"]} />
    </>
  ),
};
