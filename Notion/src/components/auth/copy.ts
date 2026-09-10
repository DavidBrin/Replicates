/**
 * Every string on the simulated demo login dialog.
 *
 * Kept out of the component so the copy — including the disclaimer wording —
 * can be reviewed in one pass without reading component logic.
 */

export const demoLoginCopy = {
  title: "Log in",
  deck: "Use any name you like.",
  placeholder: "Your name",
  submit: "Continue",
  skip: "Skip and just look around",
  disclaimerHeading: "This is a demo.",
  disclaimerBody:
    "There are no real accounts here. The name you enter just labels this browsing session — nothing is saved, and everything resets the moment you reload or close the tab.",
  contactPrefix: "Want a working version? ",
  contactLabel: "Get in touch with David.",
} as const;
