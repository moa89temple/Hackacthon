# Buddy acts only with the Student's Permission, even in a Crisis

Personal agents like Meta's Muse and OpenAI's dots act on their own by default. Buddy doesn't. It reads a Temple system only with a Read Permission, which lasts until the Student revokes it. It sends a message, books an appointment, or contacts a human only with an Action Permission, which it asks for before every such step. The Student gives an Action Permission only by tapping Approve on a card that shows exactly what will happen; a typed "yes" in the chat never counts. We chose this because Buddy handles student records (FERPA applies), because trust is the main thing that makes or breaks a personal agent, and because first-generation students in particular need to feel in control of how they're supported.

## Considered Options

- **Standing Action Permissions** (for example, "always let Buddy book advising appointments"): rejected. Each step that has real consequences gets its own yes.
- **Approving by typing "yes" in the chat**: rejected. Typed text passes through the model, so a web page or email Buddy has read could imitate the Student's yes. The approval tap goes straight to Buddy's Permission check without passing through the model, the same way Muse routes approvals around its model.
- **A safety exception** that lets Buddy alert a human during a Crisis without Permission: rejected. It raises mandated-reporting and liability questions and would undermine Students' trust that Buddy never acts behind their back. Instead, in a Crisis Buddy immediately shows crisis Resources such as 988 and Tuttleman Counseling, and asks for Action Permission to contact someone.

## Consequences

- Buddy can work in the background on Discovery, Nudges and the Student's Tasks: reading Connections and the web, and preparing Drafts. Anything with real consequences waits for the Student's tap.
- In a Crisis, help depends on the Student acting, so crisis Resources must appear immediately and be impossible to miss.
