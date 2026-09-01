import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { esp32Meta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "ESP32_Thermal_TinyML")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Pipeline", heading: "Pipeline" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const esp32: ArticleModule = {
  meta: esp32Meta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="ESP32 Thermal TinyML"
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
          { label: "Hosted on", value: <code>David-Internet/demos/esp32</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>ESP32 Thermal TinyML</B> is an interactive demonstration of a
        TinyML pipeline that classifies whether a person is present from an
        8 by 8 thermal image. It was built from ECE 140 coursework at UC San
        Diego and is hosted on{" "}
        <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>. The
        page runs every stage in the browser: the camera stream, three
        network transports, a 76-feature extractor, and a 6,672-byte INT8
        model whose kernels match TensorFlow Lite integer arithmetic.
        <Ref n={1} />
      </P>

      <P>
        The hardware origin is an AMG8833 thermal array on an ESP32-S3. The
        class dataset holds 22,054 frames. About 500 anonymized frames ship
        with the demo. Course scaffolding for WiFi and MQTT came from ECE 140
        staff; the completions, tests, and deployed model are David&apos;s.
      </P>

      <Section heading="Overview">
        <P>
          Visitors can scrub a thermal stream, watch the same frame travel as
          serial CSV, MQTT, and WebSocket traffic, and see a breadth-first
          flood fill mark the largest warm region. A side panel compares
          float32 and INT8 activations, then reports a present or empty
          verdict on the live stream. A separate WiFi net-map panel replays
          a lab assignment that posted ESP32 scans to a FastAPI server; the
          scans on the page are synthetic so they do not identify neighbors.
        </P>
      </Section>

      <Section heading="Pipeline">
        <P>
          Each frame is normalized against its own median. Intensity
          statistics and spatial features, including the largest connected
          warm blob, produce a 76-dimensional vector. A dense network
          (76→32→16→1) was trained with GroupKFold by student and quantized
          to INT8. The TypeScript port of the feature code and the integer
          kernels is checked against fixtures taken from <code>features.py</code>{" "}
          and the TFLite interpreter, so a later rewrite cannot silently
          drift from the original assignment.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The demo was assembled on 31 August 2026 from the ECE 140 labs and
          tech assignments. An earlier spec described a 65-feature tutorial
          pipeline; the deployed assignment uses 76 features, and 76 is what
          the page runs. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="HardHack_2026">HardHack 2026</WikiLink>
          </li>
          <li>
            <WikiLink to="Verilog">Verilog</WikiLink>
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
              <code>content/esp32/README.md</code>, David&apos;s Internet.
            </span>,
          ]}
        />
      </Section>

      <Categories
        categories={["Interactive demos", "Machine learning", "Embedded systems", "2026 establishments"]}
      />
    </>
  ),
};
