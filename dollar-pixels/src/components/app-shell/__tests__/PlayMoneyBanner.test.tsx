import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayMoneyBanner } from "../PlayMoneyBanner";

describe("PlayMoneyBanner", () => {
  it("renders nothing when the provider is live", () => {
    const { container } = render(<PlayMoneyBanner live />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a landmark saying plainly that no card is charged when it is not", () => {
    render(<PlayMoneyBanner live={false} />);

    const banner = screen.getByRole("complementary", { name: "Play money notice" });
    expect(banner).toHaveTextContent(/play money/i);
    expect(banner).toHaveTextContent(/no card is charged/i);
  });
});
