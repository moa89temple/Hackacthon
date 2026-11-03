/** What a phone shows in its notification. These words leave Buddy for Firebase, so they name nothing about the Student. */
export interface PhoneNotification {
  title: string;
  body: string;
  /** What the app goes by when the notification is tapped. */
  data: Record<string, string>;
  /** A newer notification with the same one replaces this, on the phone and while it waits to be delivered. */
  replaces: string;
}

export type NotifyOutcome =
  | { outcome: "sent" }
  /** This phone will never get anything through this token again. */
  | { outcome: "token_gone" }
  /** It may work if tried again. The problem is in words from Buddy's own code, without the token. */
  | { outcome: "failed"; problem: string };

/** Notifications to the Student's phone. Tests use a fake that records them. See test/support/recording-notifier.ts. */
export interface Notifier {
  /** Why nothing can be sent, for the backend's log and the You tab. Null when phone notifications are on. */
  readonly offBecause: string | null;
  /** Never throws. */
  send(token: string, notification: PhoneNotification): Promise<NotifyOutcome>;
}

export function offNotifier(offBecause: string): Notifier {
  return {
    offBecause,
    send: async () => ({ outcome: "failed", problem: offBecause }),
  };
}
