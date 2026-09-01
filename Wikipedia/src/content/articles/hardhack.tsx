import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { hardhackMeta } from "@/content/articles/meta";
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

export { hardhackMeta };

const project = projects.find((p) => p.slug === "HardHack_2026")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Detection_system", heading: "Detection system" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const hardhack: ArticleModule = {
  meta: hardhackMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="HardHack 2026"
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
          { label: "Hosted on", value: <code>David-Internet/demos/hardhack</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>HardHack 2026</B> is an interactive simulation of a break-in
        detection system built for the UC San Diego hardware hackathon. It
        follows a sensor reading from a model house to an Arduino, gateway,
        MQTT broker, and phone application.<Ref n={1} />
      </P>

      <P>
        The page recreates three hardware iterations from the weekend and
        includes an HC-SR04 ultrasonic sensor, VCNL4040 proximity sensor,
        ESP32 hardware, UART communication, and a SwiftUI application replica.
      </P>

      <Section heading="Overview">
        <P>
          Visitors can open a schematic house door or move an intruder toward
          it, then watch readings enter a serial console. A wiring overlay
          displays the hardware connections, while network controls show packet
          queueing and malformed UART traffic.
        </P>
      </Section>

      <Section heading="Detection system">
        <P>
          The browser state machine follows the Arduino firmware, including a
          moving average, armed-state gate, threshold, and confirmation count.
          An alert requires three consecutive readings under twelve centimetres,
          before JSON packets travel over UART at 9600 baud and are republished
          through MQTT.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          David&apos;s four-person HardHack team built the original project in
          January 2026. The page simulates the Uno and ESP32-S3 gateway, Arduino
          R4 WiFi, and consolidated ESP32-S3 architectures. The firmware state
          machine is ported line for line and table-tested. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="ESP32_Thermal_TinyML">ESP32 Thermal TinyML</WikiLink></li>
          <li><WikiLink to="Verilog">Verilog</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/hardhack/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Embedded systems", "2026 establishments"]} />
    </>
  ),
};
