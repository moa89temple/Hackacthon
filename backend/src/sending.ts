import { ownAddressSaved, sendingModeChanged } from "./activity.ts";
import type { Clock } from "./clock.ts";
import type { SendingMode, SendingSettings } from "./sending-store.ts";
import { THE_STUDENT, type Store } from "./store.ts";
import { isTempleAddress } from "./tumail-rules.ts";

/** That isn't an address Buddy can take for the Student's TUmail. The message is for the Student. */
export class BadOwnAddress extends Error {
  constructor() {
    super("That doesn't look like a temple.edu address.");
  }
}

/**
 * Practice mode, and the Student's own address it sends to. Only the You tab's routes and the Student's
 * tap on an email from the Crisis card call the parts that change anything, and nothing that passes
 * through Claude ever does.
 */
export interface Sending {
  settings(): SendingSettings;
  /** Takes effect at once, and stops every card made under the old mode. */
  switchTo(mode: SendingMode): SendingSettings;
  /** Throws BadOwnAddress. */
  saveOwnAddress(address: unknown): SendingSettings;
}

export function createSending({ store, clock, afterChange }: { store: Store; clock: Clock; afterChange: () => void }): Sending {
  const settings = () => store.sending.settings(THE_STUDENT);

  return {
    settings,

    switchTo(mode) {
      const now = settings();
      if (now.mode === mode) return now;
      store.sending.save(THE_STUDENT, { ...now, mode }, sendingModeChanged(mode, clock.now()));
      afterChange();
      return settings();
    },

    saveOwnAddress(address) {
      const written = typeof address === "string" ? address.trim().toLowerCase() : "";
      if (!isTempleAddress(written)) throw new BadOwnAddress();
      const now = settings();
      if (now.ownAddress === written) return now;
      store.sending.save(THE_STUDENT, { ...now, ownAddress: written }, ownAddressSaved(written, clock.now()));
      afterChange();
      return settings();
    },
  };
}
