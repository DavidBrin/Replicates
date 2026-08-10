import { describe, expect, it } from "vitest";
import { deriveResolutionView } from "../resolution-view";

const NOW = new Date("2026-08-09T18:00:00.000Z");

describe("deriveResolutionView", () => {
  it("open market: nothing is actionable for anyone, including the creator", () => {
    const view = deriveResolutionView({
      status: "open",
      creatorId: "u-creator",
      viewerId: "u-creator",
      isParticipant: true,
      now: NOW,
    });
    expect(view.phase).toBe("not_closed");
    expect(view.canPropose).toBe(false);
  });

  it("closed market: only the creator can propose", () => {
    const creatorView = deriveResolutionView({
      status: "closed",
      creatorId: "u-creator",
      viewerId: "u-creator",
      isParticipant: false,
      now: NOW,
    });
    expect(creatorView.phase).toBe("awaiting_proposal");
    expect(creatorView.canPropose).toBe(true);

    const participantView = deriveResolutionView({
      status: "closed",
      creatorId: "u-creator",
      viewerId: "u-other",
      isParticipant: true,
      now: NOW,
    });
    expect(participantView.canPropose).toBe(false);
  });

  it("resolving (dispute window open): eligible users can dispute, no one can finalize yet", () => {
    const view = deriveResolutionView({
      status: "resolving",
      creatorId: "u-creator",
      viewerId: "u-participant",
      isParticipant: true,
      resolution: {
        winningOutcomeId: "out-yes",
        proposedBy: "u-creator",
        proposedAt: "2026-08-09T12:00:00.000Z",
        finalizesAt: "2026-08-10T00:00:00.000Z", // 6h from NOW
      },
      now: NOW,
    });
    expect(view.phase).toBe("dispute_window");
    expect(view.canDispute).toBe(true);
    expect(view.canFinalize).toBe(false);
    expect(view.disputeDeadline).toEqual(new Date("2026-08-10T00:00:00.000Z"));
  });

  it("resolving, window elapsed: finalize is offered, dispute is not", () => {
    const view = deriveResolutionView({
      status: "resolving",
      creatorId: "u-creator",
      viewerId: "u-participant",
      isParticipant: true,
      resolution: {
        winningOutcomeId: "out-yes",
        proposedBy: "u-creator",
        proposedAt: "2026-08-08T12:00:00.000Z",
        finalizesAt: "2026-08-09T12:00:00.000Z", // 6h before NOW
      },
      now: NOW,
    });
    expect(view.canDispute).toBe(false);
    expect(view.canFinalize).toBe(true);
  });

  it("resolving: a stranger (not creator, not participant) can neither dispute nor finalize", () => {
    const view = deriveResolutionView({
      status: "resolving",
      creatorId: "u-creator",
      viewerId: "u-stranger",
      isParticipant: false,
      resolution: {
        winningOutcomeId: "out-yes",
        proposedBy: "u-creator",
        proposedAt: "2026-08-08T12:00:00.000Z",
        finalizesAt: "2026-08-09T12:00:00.000Z",
      },
      now: NOW,
    });
    expect(view.canDispute).toBe(false);
    expect(view.canFinalize).toBe(false);
  });

  it("disputed: reports the viewer's own cast vote and allows re-voting", () => {
    const view = deriveResolutionView({
      status: "disputed",
      creatorId: "u-creator",
      viewerId: "u-participant",
      isParticipant: true,
      resolution: {
        winningOutcomeId: "out-yes",
        proposedBy: "u-creator",
        proposedAt: "2026-08-08T12:00:00.000Z",
        finalizesAt: "2026-08-09T00:00:00.000Z",
        disputedBy: "u-participant",
        disputedAt: "2026-08-08T13:00:00.000Z",
        votes: { "u-participant": "out-no" },
      },
      now: NOW,
    });
    expect(view.phase).toBe("disputed");
    expect(view.myVote).toBe("out-no");
    expect(view.canVote).toBe(true);
    expect(view.canFinalize).toBe(true); // at least one vote cast
  });

  it("disputed with no votes yet: finalize is not offered", () => {
    const view = deriveResolutionView({
      status: "disputed",
      creatorId: "u-creator",
      viewerId: "u-participant",
      isParticipant: true,
      resolution: {
        winningOutcomeId: "out-yes",
        proposedBy: "u-creator",
        proposedAt: "2026-08-08T12:00:00.000Z",
        finalizesAt: "2026-08-09T00:00:00.000Z",
        votes: {},
      },
      now: NOW,
    });
    expect(view.canFinalize).toBe(false);
  });

  it("resolved: nothing is actionable", () => {
    const view = deriveResolutionView({
      status: "resolved",
      creatorId: "u-creator",
      viewerId: "u-creator",
      isParticipant: true,
      resolution: {
        winningOutcomeId: "out-yes",
        proposedBy: "u-creator",
        proposedAt: "2026-08-08T12:00:00.000Z",
        finalizesAt: "2026-08-09T00:00:00.000Z",
        resolvedAt: "2026-08-09T00:00:01.000Z",
      },
      now: NOW,
    });
    expect(view.phase).toBe("resolved");
    expect(view.canPropose).toBe(false);
    expect(view.canDispute).toBe(false);
    expect(view.canVote).toBe(false);
    expect(view.canFinalize).toBe(false);
  });
});
