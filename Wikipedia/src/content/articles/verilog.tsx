import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { verilogMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Verilog")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Viterbi_decoder", heading: "Viterbi decoder" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const verilog: ArticleModule = {
  meta: verilogMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Verilog"
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
          { label: "Hosted on", value: <code>David-Internet/demos/verilog</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Verilog</B> is an interactive demonstration of an eight-state
        Viterbi decoder and an RTL module library based on ECE 111 work at UC
        San Diego. It presents a convolutional encoder, noisy channel,
        animated trellis, and traceback in the browser.<Ref n={1} />
      </P>

      <P>
        The page also includes live versions of course modules such as UART
        transmitters and receivers, a barrel shifter, LFSR, carry-lookahead
        adder, counters, and an ALU. Its waveforms come from build-time Icarus
        Verilog simulations.
      </P>

      <Section heading="Overview">
        <P>
          Visitors can enter a message, select an error pattern, and observe
          the encoded and decoded bits. A logic-analyzer panel shows
          per-cycle path metrics and output traces, while the module shelf
          pairs each widget with RTL and testbench results.
        </P>
      </Section>

      <Section heading="Viterbi decoder">
        <P>
          The rate-1/2 decoder uses eight states, branch-metric blocks,
          survivor registers, and traceback logic. In the trellis, eight add-compare-select units race down the trellis as the decoder
          selects survivor paths and recovers the message.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The demo ports ECE 111 coursework to TypeScript and Canvas. The
          TypeScript model is checked cycle by cycle against the RTL, and
          Icarus Verilog testbenches provide pass or fail results for channel
          patterns and module implementations. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Nocturnal_Neuro">Nocturnal Neuro</WikiLink></li>
          <li><WikiLink to="Signals_and_Systems_Lab">Signals and Systems Lab</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/verilog/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Digital design", "2026 establishments"]} />
    </>
  ),
};
