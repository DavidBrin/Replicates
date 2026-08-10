import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { defaultSettings } from "@/domain/settings";

import { SettingsPanel } from "./settings-panel";
import { renderWithSettings } from "./settings-test-harness";

describe("SettingsPanel", () => {
  it("saves the caller name as it is typed, with no Save step", async () => {
    // Someone configuring this is preparing for a bad moment. A lost edit is a
    // real failure, so there is no Save button to forget to press.
    const { store, user } = renderWithSettings(<SettingsPanel />);

    const name = screen.getByTestId("setting-caller-name");
    await user.clear(name);
    await user.type(name, "Sam");

    expect(store.load().caller.name).toBe("Sam");
    expect(name).toHaveValue("Sam");
  });

  it("keeps the last saved name when the field is emptied mid-edit", async () => {
    // The provider drops an invalid patch rather than storing garbage, so an
    // empty field must never reach the store — but the user must still be able
    // to clear and retype. The field holds the in-progress text locally.
    const { store, user } = renderWithSettings(<SettingsPanel />);

    const name = screen.getByTestId("setting-caller-name");
    await user.clear(name);

    expect(name).toHaveValue("");
    expect(store.load().caller.name).toBe(defaultSettings.caller.name);
  });

  it("persists the caller label", async () => {
    const { store, user } = renderWithSettings(<SettingsPanel />);

    const label = screen.getByTestId("setting-caller-label");
    await user.clear(label);
    await user.type(label, "sister");

    expect(store.load().caller.label).toBe("sister");
  });

  it("persists a change of skin", async () => {
    const { store, user } = renderWithSettings(<SettingsPanel />);

    expect(store.load().skin).toBe("ios");
    await user.click(screen.getByTestId("setting-skin-android"));

    expect(store.load().skin).toBe("android");
    expect(screen.getByTestId("setting-skin-android")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("setting-skin-ios")).toHaveAttribute("aria-checked", "false");
  });

  it("shows the AI voice tier but will not select it", async () => {
    // The AI tier ships wired and unlit (SPEC §2.2). The UI states that rather
    // than hiding the option, because a hidden capability reads as a missing
    // one and a fake-working one is the "false information" App Store
    // Guideline 1.1.6 punishes.
    const { store, user } = renderWithSettings(<SettingsPanel />);

    const ai = screen.getByTestId("setting-voice-tier-ai");
    expect(ai).toBeVisible();
    expect(ai).toHaveAttribute("aria-disabled", "true");

    await user.click(ai);

    expect(store.load().voiceTier).toBe("scripted");
    expect(ai).toHaveAttribute("aria-checked", "false");
    // The reason is next to the option, in the same block, and mentions the key.
    expect(screen.getByTestId("setting-voice-tier")).toHaveTextContent(/api key/i);
  });

  it("still lets the working tiers be chosen", async () => {
    const { store, user } = renderWithSettings(<SettingsPanel />);

    await user.click(screen.getByTestId("setting-voice-tier-silent"));

    expect(store.load().voiceTier).toBe("silent");
  });

  it("states the screen-lock caveat, and keeps stating it once a delay is chosen", async () => {
    // "It doesn't ring if the screen is off" is the #1 complaint across this
    // whole app category (research/competitive-teardown.md §4 Q1). We cannot
    // fix the platform, so the limit is permanently on screen.
    const { store, user } = renderWithSettings(<SettingsPanel />);

    const caveat = screen.getByTestId("ring-delay-caveat");
    expect(caveat).toBeVisible();
    expect(caveat).toHaveTextContent(/screen/i);

    await user.click(screen.getByTestId("setting-ring-delay-30"));

    expect(store.load().ringDelaySeconds).toBe(30);
    expect(screen.getByTestId("ring-delay-caveat")).toBeVisible();
    expect(screen.getByTestId("ring-delay-caveat")).toHaveTextContent(/screen/i);
  });

  it("steps the auto-answer delay", async () => {
    const { store, user } = renderWithSettings(<SettingsPanel />);

    await user.click(screen.getByTestId("setting-auto-answer-increment"));

    expect(store.load().autoAnswerSeconds).toBe(1);
  });

  it("persists the sound switches", async () => {
    const { store, user } = renderWithSettings(<SettingsPanel />);

    expect(store.load().ringtoneEnabled).toBe(true);
    await user.click(screen.getByTestId("setting-ringtone"));
    expect(store.load().ringtoneEnabled).toBe(false);

    await user.click(screen.getByTestId("setting-subtitles"));
    expect(store.load().showSubtitles).toBe(false);
  });

  it("persists live-mode fields without clobbering the rest of the group", async () => {
    const { store, user } = renderWithSettings(<SettingsPanel />);

    const username = screen.getByTestId("setting-live-username");
    await user.clear(username);
    await user.type(username, "rae");

    const viewers = screen.getByTestId("setting-live-viewers");
    await user.clear(viewers);
    await user.type(viewers, "512");

    const live = store.load().live;
    expect(live.username).toBe("rae");
    expect(live.viewers).toBe(512);
    // The nested group merges rather than replaces.
    expect(live.commentsPerMinute).toBe(defaultSettings.live.commentsPerMinute);
  });

  it("restores every default on reset", async () => {
    const { store, user } = renderWithSettings(<SettingsPanel />);

    await user.click(screen.getByTestId("setting-skin-android"));
    await user.click(screen.getByTestId("setting-ringtone"));
    expect(store.load().skin).toBe("android");

    await user.click(screen.getByTestId("setting-reset"));

    expect(store.load()).toEqual(defaultSettings);
    expect(screen.getByTestId("setting-skin-ios")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("setting-ringtone")).toHaveAttribute("aria-checked", "true");
  });

  it("shows stored settings rather than defaults", () => {
    renderWithSettings(<SettingsPanel />, {
      skin: "android",
      caller: { name: "Ade", label: "work" },
    });

    expect(screen.getByTestId("setting-caller-name")).toHaveValue("Ade");
    expect(screen.getByTestId("setting-skin-android")).toHaveAttribute("aria-checked", "true");
    // Nothing was flashed over: the panel is only revealed once hydrated.
    expect(screen.getByTestId("settings-panel")).toHaveAttribute("aria-busy", "false");
  });

  it("labels every control", () => {
    // Real label associations, not placeholder text: this surface is used at
    // night, at low brightness, sometimes with a screen reader.
    renderWithSettings(<SettingsPanel />);

    expect(screen.getByLabelText("Name")).toBe(screen.getByTestId("setting-caller-name"));
    expect(screen.getByLabelText("Photo")).toBe(screen.getByTestId("setting-caller-photo"));
    expect(screen.getByLabelText("Username")).toBe(screen.getByTestId("setting-live-username"));
    expect(screen.getByRole("radiogroup", { name: "Call screen" })).toBe(
      screen.getByTestId("setting-skin"),
    );
    expect(screen.getByRole("switch", { name: "Ringtone" })).toBe(
      screen.getByTestId("setting-ringtone"),
    );
  });
});
