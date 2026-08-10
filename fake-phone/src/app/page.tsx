import { CallScreen } from "@/components/call/call-screen";

/**
 * The entry surface is the call itself — no splash, no menu, no consent
 * interstitial. Someone opening this app is usually already in the situation
 * it exists for, and the competitive research is blunt that multi-step
 * activation is what kills apps in this category.
 *
 * Options live behind the end-call button (see `CallScreen`), which doubles as
 * cover: a bystander sees a call being ended, not a settings menu being opened.
 */
export default function Page() {
  return <CallScreen />;
}
