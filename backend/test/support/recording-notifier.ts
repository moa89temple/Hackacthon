import type { Notifier, NotifyOutcome, PhoneNotification } from "../../src/notifier.ts";

/** Sends nothing. It keeps what would have gone to Firebase, for a test to look at. */
export class RecordingNotifier implements Notifier {
  offBecause: string | null = null;
  readonly sent: { token: string; notification: PhoneNotification }[] = [];
  /** What the next sends answer, in order. After these, every send works. */
  readonly nextOutcomes: NotifyOutcome[] = [];

  async send(token: string, notification: PhoneNotification): Promise<NotifyOutcome> {
    const outcome = this.nextOutcomes.shift() ?? { outcome: "sent" };
    if (outcome.outcome === "sent") this.sent.push({ token, notification });
    return outcome;
  }
}
