import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Avatar, initialsOf } from "./Avatar";
import { NotchedRing } from "./NotchedRing";
import { SegmentedToggle } from "./SegmentedToggle";

describe("NotchedRing", () => {
  it("cuts a downward triangular notch into the bottom of the ring", () => {
    render(<NotchedRing value={5} />);
    const notch = screen.getByTestId("notched-ring-notch");
    const points = (notch.getAttribute("points") ?? "").split(" ").map((p) => p.split(",").map(Number));
    expect(points).toHaveLength(3);
    const ys = points.map((p) => p[1] ?? 0);
    const apexY = Math.min(...ys);
    const baseY = Math.max(...ys);
    // two vertices sit on the bottom edge, the apex points up into the ring
    expect(ys.filter((y) => y === baseY)).toHaveLength(2);
    expect(apexY).toBeLessThan(baseY);
  });

  it("shows the value in white with a 4 px dark outline", () => {
    render(<NotchedRing value={12} />);
    const text = screen.getByTestId("notched-ring-value");
    expect(text).toHaveTextContent("12");
    expect(text).toHaveAttribute("stroke", "var(--stroke-dark)");
    expect(text).toHaveAttribute("stroke-width", "4");
    expect(text).toHaveAttribute("fill", "var(--text)");
  });

  it("takes radius, stroke and label so one component serves all three call sites", () => {
    render(<NotchedRing value={7} radius={62} stroke={14} label="Total troops" />);
    const ring = screen.getByTestId("notched-ring-track");
    // the Received Troops geometry: r 62, stroke 14
    expect(ring).toHaveAttribute("r", String(62 - 14 / 2));
    expect(ring).toHaveAttribute("stroke-width", "14");
    expect(screen.getByTestId("notched-ring-label")).toHaveTextContent("Total troops");
  });

  it("paints the ring from the --danger family", () => {
    render(<NotchedRing value={1} />);
    expect(screen.getByTestId("notched-ring-track")).toHaveAttribute("stroke", "var(--danger)");
  });
});

describe("SegmentedToggle", () => {
  it("renders FFA | 1v1 and marks the active segment", () => {
    render(
      <SegmentedToggle
        testId="format-toggle"
        value="ffa"
        options={[{ value: "ffa", label: "FFA" }, { value: "1v1", label: "1v1" }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("format-toggle-ffa")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("format-toggle-1v1")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("format-toggle-ffa")).toHaveStyle({ background: "var(--cyan)" });
  });

  it("reports the picked value", () => {
    const onChange = vi.fn();
    render(
      <SegmentedToggle
        testId="format-toggle"
        value="ffa"
        options={[{ value: "ffa", label: "FFA" }, { value: "1v1", label: "1v1" }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("format-toggle-1v1"));
    expect(onChange).toHaveBeenCalledWith("1v1");
  });
});

describe("Avatar", () => {
  it("derives up to two initials from the display name, skipping the generated number", () => {
    // `<Adjective> <Noun> <NN>` (§7): a digit is not an initial.
    expect(initialsOf("Bold General 42")).toBe("BG");
    expect(initialsOf("Northern Warden 21")).toBe("NW");
    expect(initialsOf("Solace")).toBe("S");
    expect(initialsOf("42")).toBe("4");
    expect(initialsOf("   ")).toBe("?");
  });

  it("wears the gold laurel ring, the robot chip and the YOU pill on request", () => {
    render(<Avatar name="Bold General" colour="red" laurel bot you />);
    expect(screen.getByTestId("avatar-laurel")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-bot-chip")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-you")).toHaveTextContent("YOU");
  });

  it("becomes a dark disc with a white skull when the seat is eliminated", () => {
    render(<Avatar name="Bold General" colour="purple" eliminated />);
    expect(screen.getByTestId("avatar")).toHaveAttribute("data-eliminated", "true");
    expect(screen.getByTestId("icon-skull")).toBeInTheDocument();
    expect(screen.queryByTestId("avatar-initials")).toBeNull();
  });

  it("paints the disc from the owner's colour token", () => {
    render(<Avatar name="Wily Scout" colour="green" />);
    expect(screen.getByTestId("avatar-disc")).toHaveStyle({ background: "var(--p-green)" });
  });
});
