import Image from "next/image";
import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { leadersMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Leaders_(game)")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Gameplay", heading: "Gameplay" },
  { id: "Development", heading: "Development" },
  { id: "Technology", heading: "Technology" },
  { id: "Scope", heading: "Scope" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const leaders: ArticleModule = {
  meta: leadersMeta,
  body: (
    <>
      <Hatnote>
        This article is about the browser game. For the Slay-like territory
        game, see <WikiLink to="Island_Empire_(replica)">Island Empire (replica)</WikiLink>.
      </Hatnote>

      <Infobox
        title="Leaders (game)"
        image={
          <Image
            src="/images/Leaders_(game).png"
            alt="Screenshot of round 1 of a solo practice game in Leaders: the banner of You's capital on a hex plateau, the leader and a retinue of spear-carrying followers beside it, a hint card reading Walk with your leader, the relative movement pad, and a resource header showing 150 gold, 6 happy and 15 score"
            width={300}
            height={164}
            className="h-auto w-full"
          />
        }
        rows={[
          { label: "Type", value: "Turn-based strategy browser game" },
          {
            label: "Inspired by",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Repository", value: <code>DavidBrin/Leaders</code> },
          { label: "Platform", value: "Web browser (desktop and phone)" },
          { label: "Released", value: "October 2026" },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Leaders</B> is a turn-based strategy game for two to four players
        that runs in a web browser. It is played from behind a single leader
        standing on the ground rather than from a camera above a strategic map,
        and an order to a distant city or unit must be carried there by a
        messenger before it takes effect. Its author describes it as{" "}
        <i>Sid Meier&apos;s Civilization V</i> &quot;if it were played from the
        Leader&apos;s perspective&quot;, with attack formations added. It runs
        on Cloudflare Workers with a D1 database.<Ref n={1} />
      </P>

      <Section heading="Overview">
        <P>
          A match occupies a seeded hexagonal world of 17 by 13 tiles, 221 in
          all, with one capital per civilization and a leader, a builder and an
          infantry unit apiece. Players act simultaneously within a round, and
          the server resolves production, growth, travel, messengers
          and research once everyone has ended their turn or the room&apos;s
          deadline of 60, 120 or 180 seconds expires. A host shares a
          six-character room code or an invitation link; a practice mode runs
          the same rules against a local opponent.<Ref n={2} />
        </P>
      </Section>

      <Section heading="Gameplay">
        <P>
          The camera follows the leader and looks along the leader&apos;s
          heading: the arrow keys step forward and back or turn leader and
          camera together, and an on-screen pad offers all six relative hex
          directions. There is no scrolling strategic map, and reconnaissance
          reaches four tiles around friendly cities and units. Clicking explored ground lights the cheapest route
          to it with an arrival estimate, and a second click travels. Every unit
          has six terrain points of movement a round, seven for cavalry and
          scouts; followers march with each leader step and spend their own
          budgets.<Ref n={2} />
        </P>

        <P>
          Orders are physical. A unit within three hexes of the leader accepts a
          move, improvement, follow, fortify, attack or formation order at once.
          Beyond it the same order dispatches a messenger, either the
          leader&apos;s personal one or a slot belonging to the nearest city,
          one per city level. A messenger covers six terrain points per
          resolution, delivers only on arrival, then walks back before its slot
          frees. Cities can produce more messengers, which join the
          leader&apos;s retinue.
        </P>

        <P>
          Cities hold population, hit points, a food store, a production queue
          and their own local knowledge. Base yields are 3 food, 8 production
          plus 2 per population, 4 gold and 2 science, and a city works as many
          owned tiles within two hexes as it has population. Happiness falls
          from a starting 8 with each city and every third citizen, and
          unhappiness halves any food surplus. Nine buildings, four trainable
          unit types and four improvements are available.
        </P>

        <P>
          Research is local as well. Eleven technologies form a short
          prerequisite tree from agriculture and mining up to industrialization
          and scientific method, and every city researches independently and
          must be instructed in person or by messenger. A finished technology is
          known only to that city until free city messengers carry it to the
          others, so a new or captured city does not inherit the tree.
        </P>

        <P>
          Combat is deterministic and positional: units have 100 hit points, and
          an adjacent attack spends all movement and inflicts damage with
          simultaneous retaliation. Five formations shape the result: line
          adds 15 percent to frontal defence, square 25 percent against frontal
          cavalry, wedge 25 percent attacking a line for 10 percent of its own
          defence, a cavalry flank 35 percent from off the defender&apos;s
          facing, and encirclement 30 percent with a friendly unit opposite.
          Only the strongest applicable bonus counts.
        </P>

        <P>
          Diplomacy travels too: peace, trade and alliance offers and
          declarations of war walk to a rival capital and take effect only on
          delivery, and a trade holds 20 gold in escrow until accepted or
          refunded. A match ends by conquest, on score at round 50, or by a
          scientific victory for the
          first player holding three cities with a research laboratory and
          knowledge of scientific method.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The first playable version was produced on 1 October 2026 by OpenAI
          Codex running the model GPT-6.1 Sol, from what its author calls a
          near-single prompt: one run researched the subject, wrote the design
          specification, implemented engine, client and server, commissioned
          independent reviews and deployed to a free tier. A second pass on 2
          October 2026, made with Claude, reworked the controls and the hosting,
          adding heading-relative movement with a following camera, a
          highlighted route preview in the manner of <i>Civilization</i>,
          cheaper opening technologies, first-session hints, coloured territory
          borders, clickable units, a uniform six-point movement budget so
          followers march with the leader, producible messengers, and the
          durable Cloudflare deployment.<Ref n={3} />
        </P>

        <P>
          An integrated correctness and security review reproduced three bugs,
          each fixed behind a failing regression: an ignored trade offer that
          prevented war indefinitely, remote travel validation that leaked
          hidden enemy positions, and two tabs on one seat losing distinct
          commands. It ships with {project.testStats}.<Ref n={3} />
        </P>
      </Section>

      <Section heading="Technology">
        <P>
          The client is React 19 built with Vite, with a Three.js renderer; the
          rules live in a pure TypeScript engine that returns a new state for
          each action, applied only by an authoritative Cloudflare Worker. The
          renderer sees only a filtered per-player view, so map seeds, hidden
          terrain and rival economies never reach a browser. Room documents are revisioned rows in a D1 SQLite database
          reached through Drizzle, with requests validated by zod and a
          conditional update on the revision.<Ref n={1} />
        </P>
      </Section>

      <Section heading="Scope">
        <P>
          The game is deliberately compact, and its documentation says so. There
          is no naval warfare, no religion, no espionage and no span of
          historical eras; the eleven technologies, nine buildings, four
          trainable units, five formations and 50-round cap are the content in
          full, not an attempt at the whole <i>Civilization V</i> catalogue. All
          graphics are original procedural meshes and textures generated in
          code, with no art extracted from the commercial game.<Ref n={3} />
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Island_Empire_(replica)">Island Empire (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="Super_Smash_(replica)">Super Smash (replica)</WikiLink>
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
              <code>Leaders/README.md</code>, as of 2 October 2026.
            </span>,
            <span key="2">
              <code>Leaders/docs/superpowers/specs/2026-10-01-leaders-design.md</code>,
              the game specification, 1 October 2026.
            </span>,
            <span key="3">
              <code>Leaders/docs/RELEASE.md</code>, release evidence, 1 and 2
              October 2026.
            </span>,
          ]}
        />
      </Section>

      <Categories
        categories={["Browser games", "Turn-based strategy video games", "2026 video games"]}
      />
    </>
  ),
};
