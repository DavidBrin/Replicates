/** The three auth screens' components, and the frame they share. */

export { AcceptInvite, type AcceptInviteProps } from "./accept-invite";
export {
  AuthMessage,
  AuthShell,
  Field,
  Mark,
  type AuthShellProps,
} from "./auth-shell";
// The demo-account chooser is what `/signin` mounts. The typable `SignInForm`
// below is archived — kept for reference, mounted nowhere. See `demo-sign-in.tsx`.
export {
  DemoSignIn,
  type DemoAccount,
  type DemoSignInProps,
} from "./demo-sign-in";
export { SignInForm, type SignInFormProps } from "./sign-in-form";
export { SignUpForm, type SignUpFormProps } from "./sign-up-form";
