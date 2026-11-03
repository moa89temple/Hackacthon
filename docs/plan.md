# Buddy build plan

**Status:** agreed in the design sessions on November 1, 2026. Nothing gets built until you say so.

Terms in **bold** are defined in [GLOSSARY.md](../GLOSSARY.md). The two biggest decisions have their own records:
- [ADR 0001](adr/0001-buddy-acts-only-with-permission.md): Buddy acts only with Permission.
- [ADR 0002](adr/0002-temple-systems-through-buddys-browser.md): Buddy reaches Temple systems through its own browser.

## What we're building

Buddy is a Temple-specific personal AI assistant like Meta's Muse or OpenAI's dots, designed with first-generation students in mind.
- It learns a Student's Goals and situation and builds a Roadmap.
- It surfaces Resources and Opportunities.
- It does Tasks in the background.
- It connects the Student to the right people at Temple.

It never acts without the Student's tap, and it doesn't replace advisors.

## Scope of this version

- **One Student, you.** There are no sign-up or login screens, but the design leaves room for more Students.
- **Real data only.** There's no mock or demo data in the app. Made-up examples appear only inside automated tests.
- **No fixed deadline.**
- **Not in this version:**
  - encryption of the disk, the database or the browser's storage;
  - cloud hosting;
  - quiet hours;
  - repeating Tasks;
  - Presentation mode;
  - more than one Student.

## Architecture

- **App:** Flutter, for Android and iPhone. Android is built and tested on this laptop first. The iPhone build comes later, on your Mac with your Apple Developer membership.
- **Backend:** TypeScript on Fastify. It runs on your laptop for now and moves to the cloud later. It talks to the app over HTTPS and streams Buddy's replies as they're written.
- **AI:** Claude through the Anthropic TypeScript SDK.
  - Sonnet 5.5 handles conversations, Tasks and Briefings.
  - Haiku 5.5 handles cheap jobs, such as the Crisis check, Discovery extraction and ranking what's relevant.
  - Each model is one setting, so it's easy to swap.
- **Storage:** SQLite, behind one storage module, so a hosted database can replace it later.
- **Buddy's Browser:** a Docker container with Chromium, a virtual screen, and a live view for Takeovers. The backend controls it from outside, and it's kept apart from your files. In the cloud, each Student gets their own.
- **Phone to backend:** Tailscale, so only your own devices can reach Buddy. You pair the app once by scanning a QR code on your laptop, which gives your phone its own key. You unlock the app with your fingerprint or face.
- **Notifications:** Firebase Cloud Messaging, on Android and iPhone.
- **Laptop limit:** while the backend runs on your laptop, Briefings, Alerts and Tasks run only when it's on and awake.

## Connections

- **Route rule:**
  - Buddy uses a service's own connector only when it works without anyone else's approval. Otherwise it uses Buddy's Browser.
  - It never uses connectors made by third parties.
  - When a service's own rules forbid automated tools, as LinkedIn's do, the Read Permission card says so before you connect.
- **Order:**
  1. Google Calendar, read-only, through its secret iCal address. To put a Milestone on your calendar, Buddy shows an "Add to Google Calendar" button that you tap yourself.
  2. Canvas: courses, assignments, due dates, grades and announcements.
  3. TUportal: holds, balance and registration status.
  4. The DARS degree audit.
  5. TUmail. Buddy may read your inbox once TUmail has a Read Permission. Sending needs an Approve tap each time.
  6. Navigate360.
  7. Handshake.
- **Inside Temple systems:**
  - Buddy reads only your own records and skips pages about other people, such as class rosters, discussion boards and classmates' work. Your TUmail inbox is the one exception.
  - It never opens quizzes or exams and never submits graded work, even with an Approve tap.
  - It reads each Connection a few times a day, plus whenever you ask.
- **Logins:** you log in through a Takeover. A login lasts until you turn that Connection off.
- **Browser limits:**
  - Every click in Buddy's Browser that changes something needs an Action Permission.
  - The browser visits only your Connections and public pages.

## Guidebook and Discovery

- **Starting sources:**
  - the Bulletin, for requirements and Suggested Academic Plans;
  - the registrar's academic calendar;
  - now.temple.edu;
  - the office pages for Tuttleman Counseling, the Student Success Center, the Career Center, Student Financial Services, the Wellness Resource Center, Disability Resources and the Dean of Students;
  - searches that match your Goals, inside and outside Temple.
- **Reading pages:** Buddy reads each page the fastest way it can, and uses Buddy's Browser only when a page needs it.
- **Outside Temple:**
  - Only trustworthy Sources count: government sites, colleges and established nonprofits.
  - Their items come after Temple's options and are labeled "Outside Temple".
  - Free options come first. Something with a fee is fine when it's worth it, and Buddy always says what it costs.
- **Keeping it current:**
  - Opportunities disappear after their date.
  - Anything missing from its Source for two weeks leaves the Guidebook.
  - A Report hides an item for every Student.

## How Buddy talks

- **First conversation:** a two-sentence introduction that says what Buddy won't do and that it never acts without your tap. Then Buddy asks about your Goals.
- **Getting to know you:** Buddy asks a couple of questions at a time over the first few conversations. You can always skip them, and it says why it's asking. It asks about:
  - your year and graduation plans;
  - your major;
  - whether you're the first in your family to go to college;
  - whether you live on campus or commute;
  - your work hours;
  - financial aid or scholarship requirements;
  - what feels hardest right now.
- **Sensitive topics:**
  - Buddy never asks about immigration status or health. If you bring them up, it uses them like any other Profile fact.
  - It masks passwords, Social Security numbers and card numbers before saving anything or sending it to Claude.
- **Profile:** facts you mention are saved right away, and you can see and change all of them.
- **Boundaries:**
  - Buddy doesn't do graded work.
  - It replies in whatever language you write in.
  - It always says it's an AI.
  - It never states a Temple fact without a Source. When it can't find one, it offers a Handoff.
- **First-gen habits:**
  - Buddy explains college jargon the first time it comes up.
  - It includes the unwritten-rules Milestones.
  - It puts free Resources first.
- **Roadmap:**
  - Built from your major's Suggested Academic Plan, the Standard Milestones and the unwritten-rules Milestones.
  - Proposed as a card you accept with one tap.
  - If you have no Goal yet, Buddy helps you choose one first.
- **Crisis:**
  - The crisis card appears only on clear signals. For unclear distress, Buddy checks in instead.
  - The card lists 988 (call or text), the Crisis Text Line (text HOME to 741741), 911, and Tuttleman Counseling at (215) 204-7276.
  - The card comes from Buddy's own code, so it appears even if the AI fails or refuses.
  - Buddy contacts no one without an Action Permission.
  - The card also offers to email someone the Student chooses, through an Action card. It comes after the crisis Resources, which never wait for it. If TUmail isn't connected or its login has expired, Buddy says plainly that the email can't go out yet.

## Drafts and sending

- Every Draft ends with "Drafted with help from Buddy, an AI assistant", which you can delete.
- Each Draft card has three buttons:
  - **Open in Outlook:** opens a new TUmail email with the Draft filled in, for you to send.
  - **Copy.**
  - **Buddy sends it:** after an Approve tap, Buddy sends it through Buddy's Browser in TUmail.
- Practice mode stays on until you switch to Live.

## Nudges and Tasks

- **Briefings:** weekdays at 8 a.m., plus a week-ahead Briefing on Sundays at 6 p.m.
- **Limits:** there's no daily limit and there are no quiet hours.
- **Alerts:** you can switch each one off.
  - A Milestone is due in 7 days, and again the day before. Before you have a Roadmap, this covers the Standard Milestones.
  - A saved Opportunity closes in 3 days, and again the day before.
  - A new Opportunity strongly matches a Goal and closes within 14 days.
  - A new hold appears on your account.
  - A grade drops noticeably. This Alert is worded as a check-in.
  - An assignment is due within 24 hours and hasn't been submitted.
  - A Contact you wrote to has replied.
  - An email from a Temple office asks you to do something or mentions a deadline, such as a financial aid notice or a warning about a hold.
- **Tasks:**
  - Background work, with a progress card.
  - You get a notification when a Task is done or needs you.
  - Each Task runs once.

## Trust and control

- **Read Permissions** last until you revoke them. Revoking one deletes the Profile facts from that Connection, along with its login. A sign-on it shares with another Connection that's still on, such as Temple's, stays until the last of them is revoked, so reconnecting may not ask you to log in again.
- **Action Permissions:** each one is a single Approve tap for one exact step. A typed "yes" never counts.
- **Activity** shows:
  - everything Buddy read;
  - every Draft;
  - every Permission asked for and given;
  - every message sent;
  - how Buddy decided each reply.
- **Delete everything:** this button wipes your Profile, Goals, Roadmap, conversations, Permissions, Activity and Buddy's Browser logins.
- **Spending:**
  - Background work stops for the day after $2 of Claude usage.
  - Chat has no cap.
  - The You tab shows what Buddy spent today and this month.
  - As a backstop, you set a $50 monthly limit in the Anthropic Console.

## Look and feel

- **Tabs:** four of them: Buddy (chat with cards), Today, Roadmap and You.
- **Style:**
  - Temple cherry red as the accent color.
  - A round, friendly avatar.
  - No Temple logo or Owl.
- **Disclaimer:** the app says "Hackathon prototype, not an official Temple University service".

## Build phases

This is the proposed order. Building starts only when you say. The backend comes first, then the app. After that, each feature comes with its backend and its screens together.

0. **Setup:**
   - the repo layout: `backend/`, `app/` and `browser/`;
   - a first Claude call with your key;
   - Buddy's Browser container, tested with a real Temple login through a Takeover;
   - an empty Flutter app running on the Android emulator.
1. **Core backend:** the data model, the Permission gate, actions that can safely run twice, and Activity. Tests come first.
2. **Agent and chat:**
   - Buddy's tools;
   - streaming replies;
   - the Read Permission, Approve, Roadmap, Draft and Crisis cards;
   - the Crisis check;
   - masking.
3. **Flutter app (Android):** pairing and the app lock, the four tabs, chat with cards and Approve taps, and the Crisis card.
4. **Guidebook and Roadmap:** Discovery from the starting sources, Sources and Reports, and your first Roadmap from your major's plan.
5. **Connections:** the Takeover live view in the app, then Google Calendar, Canvas, TUportal, DARS, TUmail with Practice mode, Navigate360 and Handshake.
6. **Nudges and Tasks:** the background worker, Briefings, Alerts, Tasks, notifications and the spending limits.
7. **Polish and iPhone:** look and feel, accessibility, and the iPhone build on your Mac.

## Working agreement

- **Commits:** at the end of each phase, on a `build` branch. Nothing is pushed until you say so.
- **Tests first** for the rules that must never break: the Permission gate, the Crisis check, masking, expiry, and Alert timing.
- **Team and GitHub issues:** set aside for now.

## What you'll do along the way

- **Phase 0:** paste your Anthropic API key into `.env.local` (it's still empty), and start Docker Desktop.
- **Phase 3:** install Tailscale on your laptop and your phone.
- **Phase 5:** log in through Takeovers as each Connection is built.
- **Phase 6:** create a free Firebase project.
- **Phase 7:** build and test the iPhone version on your Mac.
- **Any time:** set a $50 monthly spend limit in the Anthropic Console.
