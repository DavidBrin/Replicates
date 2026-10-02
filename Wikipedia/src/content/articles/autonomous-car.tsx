import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { autonomousCarMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Autonomous_Car")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Lane_vision", heading: "Lane vision" },
  { id: "ROS_2_pipeline", heading: "ROS 2 pipeline" },
  { id: "Control", heading: "Control" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const autonomousCar: ArticleModule = {
  meta: autonomousCarMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Autonomous Car"
        rows={[
          { label: "Type", value: "Interactive demo" },
          {
            label: "Origin",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David (software); Team 3 (hardware)" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Hosted on", value: <code>David-Internet/demos/autonomous-car</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Autonomous Car</B> is an interactive demonstration of a 1/10-scale
        ROS 2 robocar built for the spring 2025 final project of ECE/MAE 148 at
        UC San Diego.<Ref n={1} /> The car followed a dashed line of yellow tape
        across a parking lot and, when its camera spotted garbage, drove to it,
        stopped, and collected it with a servo-driven scoop arm.<Ref n={2} />
      </P>

      <P>
        David wrote all of the car&apos;s software. The rest of Team 3 built the
        hardware, including the 3D-printed parts. The demo runs TypeScript
        ports of David&apos;s nodes, checked against the Python originals, on
        a simulated lot. It concentrates on three parts of the stack:
        computer vision, the ROS 2 message pipeline, and the steering
        controller.
      </P>

      <Section heading="Overview">
        <P>
          The page has five panels. The first steps a camera frame through the
          lane detector with every calibration value on a slider. The second
          animates the node graph at its real message rates, with a topic echo
          pane and the startup probe. The third closes the loop around a
          simulated car with adjustable gains and strip charts. The fourth
          replays a garbage run through its state machine, servo duty cycles
          and command timeline. The fifth shows the real car in photographs,
          clips and a recorded lane-following run.
        </P>
      </Section>

      <Section heading="Lane vision">
        <P>
          The lane node began from the course teaching assistant&apos;s example
          and was reworked for this car. It watches one band of each frame,
          keeps pixels whose HSV color falls in a tuned yellow range, and
          cleans the mask with a blur, one erosion and four dilations before the
          width filter. Only contours whose rotated bounding box is between 15
          and 112 pixels wide count. Their centroids become a single steering
          error measured from a centre line at 55 percent of the frame width.
          With one dash in view the error points at it. With several, the node
          averages them on a straight and chooses the nearest line outside the
          threshold band on a curve.
        </P>
        <P>
          A separate camera node runs a Roboflow garbage detector on the OAK-D
          Lite itself and publishes a detection flag, a steering error toward
          the target, and the width of the widest box in pixels.
        </P>
      </Section>

      <Section heading="ROS 2 pipeline">
        <P>
          Four standing nodes share six topics. The camera node publishes the
          frame and the detector outputs, the lane node publishes its error on{" "}
          <code>/centroid</code>, and the guidance node turns whichever error it
          follows into <code>/cmd_vel</code> for the motor controller. A fifth
          node, the servo sweeper, is spawned only when the arm has to move. At
          startup the guidance node listens for detections for three seconds
          and then commits the whole run to either lane-following or
          garbage-seeking.
        </P>
      </Section>

      <Section heading="Control">
        <P>
          Steering comes from a PID controller with gains of 0.2, 0 and 0.1,
          clamped to plus or minus one. Throttle is scheduled on the error: 0.2
          inside the threshold band, easing linearly to 0.1 as the error grows,
          so the car slows into corners. When the widest detection passes 200
          pixels the node stops, spawns the servo sweeper to swing the arm from
          0 to 100 degrees over I2C, and after five seconds runs a fixed
          five-step maneuver before resuming.
        </P>
        <P>
          The demo notes two properties of the controller as written. The
          derivative term divides by a fixed 1/20 second while frames arrive at
          10 hertz, which doubles the effective derivative gain, and the
          integral term is clamped so tightly that the integral gain has no
          effect.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The demo was built in September 2026 from the team&apos;s public
          repository. At build time the original Python nodes are imported
          under stand-in ROS, camera and servo modules, and their outputs become
          test fixtures for the TypeScript ports. {project.testStats}: the lane
          port reproduces every intermediate image bit for bit against OpenCV
          4.11 across 12 frames and 8 parameter sets, and the guidance port
          sends the same 448 <code>/cmd_vel</code> messages over a 45-second
          run. The camera frames, detections and vehicle physics are simulated,
          and the page says so.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Computer_Vision">Computer Vision</WikiLink></li>
          <li><WikiLink to="HardHack_2026">HardHack 2026</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/autonomous-car/README.md</code>, David&apos;s Internet.</span>,
            <span key="2">
              <ExternalLink href={project.replicaOf.url}>
                148-spring-2025-final-project-team-3
              </ExternalLink>
              , UCSD Silberman Classes and Projects, GitHub.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Robotics", "2026 establishments"]} />
    </>
  ),
};
