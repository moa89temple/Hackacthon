# Buddy reaches Temple systems through its own browser, on a machine set aside for it

Temple's systems give Buddy no usable way in:
- Instructure's API Policy (August 2025) bans reaching Canvas through tools Instructure hasn't approved, MCP servers included.
- Microsoft 365 apps need Temple's admin consent before they can read TUmail.
- TUportal, DARS, Navigate360 and Handshake have no student API.

So Buddy reads them through Buddy's Browser. That's a Chromium browser in its own container, kept apart from the Student's devices: on the Student's laptop for now, and in the cloud later, one per Student. The Student logs in through a Takeover. The general rule: Buddy uses a service's own connector only when it works without anyone else's approval, and Buddy's Browser otherwise.

## Considered Options

- **Community connectors**, such as unofficial Canvas MCP servers on GitHub: rejected. A connector receives the Student's login and everything it reads, and it can slip instructions to Buddy.
- **Asking Temple's Office of Information Security first and waiting for a ruling**: rejected. We chose to connect now.
- **Running the browser directly on the Student's laptop**: rejected. A machine set aside for Buddy keeps its browsing apart from the Student's own files and browser. It also moves to the cloud unchanged, the way Muse gives each person their own machine.

## Consequences

- Temple's Guidelines for Generative AI apply to the data however Buddy reaches it: using non-public data with a GenAI tool requires approval from Temple's Chief Information Security Officer. The Student accepted that risk for their own records.
- Reading through a browser is slow and breaks when Temple changes a page. Buddy reads each Connection only a few times a day, plus whenever the Student asks.
- Buddy reads only the Student's own records and skips pages about other people, such as class rosters and discussion boards. The Student's TUmail inbox is the one exception. On Canvas, the browser may still load a course's list of discussion topics, because the Announcements page is built from it. Buddy never opens a discussion or anything under a topic, and keeps only what the Announcements page shows.
- Buddy never opens quizzes or exams and never submits graded work.
