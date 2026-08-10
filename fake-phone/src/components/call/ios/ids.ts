/**
 * Skin-private test hooks.
 *
 * The shared `CALL_TEST_IDS` are the cross-skin contract that one e2e suite
 * drives; these are extra handles for the iOS-only details that have no Android
 * equivalent (the poster photo, the monogram, the frosted grid), so asserting
 * them never leaks an iOS assumption into the shared suite.
 */

export const IOS_TEST_IDS = {
  photo: "ios-caller-photo",
  monogram: "ios-monogram",
  controlGrid: "ios-control-grid",
  status: "ios-call-status",
} as const;
