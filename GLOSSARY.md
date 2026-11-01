# Buddy

A Temple-specific personal AI assistant for first-generation students. It makes Temple's existing support system easier to navigate; it does not replace advisors, faculty, or university services.

## Language

### Actors

**Student**:
Any Temple student who uses Buddy. Buddy is designed with first-generation students in mind, but it treats every Student the same way.
_Avoid_: User, first-gen student (as a separate kind of Student)

**Buddy**:
The AI assistant itself: a knowledgeable Temple guide that a student carries in their pocket.
_Avoid_: Mentor, chatbot, assistant, agent

**Mentor**:
A human at Temple (peer mentor, faculty mentor, staff mentor) who gives a student ongoing personal guidance. Never Buddy.
_Avoid_: Using "mentor" for Buddy

### What Buddy knows

**Profile**:
Everything Buddy knows about a Student's situation, such as their major, year, whether they commute, and their work hours. It comes from what the Student tells Buddy and from their Connections, and the Student can always see and change all of it.
_Avoid_: Dossier, memory, user data

**Goal**:
Something a Student wants to achieve, such as "get into PA school" or "graduate in four years." A Student can have several Goals at once.
_Avoid_: Objective, aspiration, plan

**Milestone**:
A point in a Student's time at Temple where something must be decided or done, such as declaring a major, landing an internship, or applying to grad school. Each Milestone either belongs to exactly one of the Student's Goals or is a Standard Milestone.
_Avoid_: Step, checkpoint

**Standard Milestone**:
A Milestone every Temple Student faces whatever their Goals, such as registering for next semester or renewing the FAFSA.
_Avoid_: Default milestone, requirement

**Roadmap**:
A Student's personal, ordered list of Milestones: the Standard Milestones plus the Milestones for each of their Goals. Buddy proposes it, or any change to it, as a card the Student accepts with one tap; after that the Student can add, remove, or reorder Milestones. A Student with no Goal has no Roadmap yet; Buddy first helps them choose a Goal.
_Avoid_: Plan, journey, path, timeline

**Connection**:
Any system Buddy can read for a Student: a Temple system such as Canvas, the degree audit, or the student account, or another service the Student asks Buddy to connect to. Each one stays off until the Student gives a Read Permission for it.
_Avoid_: Integration, data source, link

**Buddy's Browser**:
Buddy's own web browser, on a machine set aside for Buddy rather than on the Student's devices. Buddy uses it for public pages and for Connections that have no connector it can use, and the Student logs in to it only through a Takeover, so Buddy never learns a password.
_Avoid_: Agent browser, scraper, headless browser

**Takeover**:
The Student controlling Buddy's Browser through a live view, to do a step only they should do, such as logging in or approving Duo. Until the Student hands control back, Buddy can't see the screen and nothing is recorded.
_Avoid_: Handoff (that's connecting the Student to a Contact), remote control

### Trust

**Permission**:
A Student's explicit yes that lets Buddy do something it otherwise never does. It is either a Read Permission or an Action Permission.
_Avoid_: Consent, authorization, opt-in

**Read Permission**:
A Permission for Buddy to read one whole Connection. It lasts until the Student revokes it, and revoking it also deletes every Profile fact that came from that Connection.
_Avoid_: Access, sharing

**Action Permission**:
A Permission for Buddy to take one specific step for the Student that has real consequences, such as sending a message or booking an appointment. The Student gives it only by tapping Approve on a card that shows exactly what will happen, and it covers exactly that step: if anything changes, Buddy needs a new one. A typed "yes" never counts.
_Avoid_: Approval, confirmation, standing permission

**Activity**:
The Student's record of everything Buddy read and did for them: Connection reads, Drafts, Permissions asked for and given, messages sent, and how Buddy decided each reply.
_Avoid_: Log, history, audit trail

### What Buddy surfaces

**Guidebook**:
Everything Buddy has discovered: all the Resources, Opportunities, and Contacts it knows about, each with its Source. Anything missing from its Source for two weeks leaves the Guidebook.
_Avoid_: Catalog, directory, database, knowledge base

**Discovery**:
Buddy finding Resources, Opportunities, and Contacts on the web by itself and adding them to the Guidebook, including searching for things that match each Student's Goals.
_Avoid_: Crawling, scraping, research

**Resource**:
A standing service a Student can use whenever they need it, at Temple or elsewhere, such as the Writing Center, tutoring, or counseling.
_Avoid_: Service (alone), support, offering

**Opportunity**:
Something with a deadline or a fixed date that a Student can miss, at Temple or elsewhere, such as a scholarship, a research position, or a career fair. It can help a Student reach a Milestone, but it doesn't have to. Buddy stops showing it once its deadline or date has passed.
_Avoid_: Event, posting, resource

**Source**:
The web page where Buddy found a Resource, Opportunity, or Contact. Buddy shows it every time it mentions one, and never states a Temple-specific fact without one. Outside Temple, only trustworthy pages count as a Source: government sites, colleges, and established nonprofits.
_Avoid_: Citation, reference, link

**Report**:
A Student telling Buddy that a Resource, Opportunity, or Contact is wrong or out of date. After a Report, Buddy stops showing it to every Student.
_Avoid_: Flag, complaint, feedback

**Nudge**:
Any message Buddy sends that the Student didn't ask for. It can be about anything relevant to the Student: a Resource, an Opportunity, a Milestone, or something new in a Connection. It is either a Briefing or an Alert, and the Student controls how often Briefings come and which Alerts they get.
_Avoid_: Notification, push, reminder

**Briefing**:
A regular Nudge that collects what's relevant to the Student right now.
_Avoid_: Digest, daily cards, feed

**Alert**:
A Nudge set off by a specific event, such as a deadline coming up, a Milestone falling due, or a new hold on the student account.
_Avoid_: Warning, notification

### Human support

**Contact**:
Any Temple office or named person a Student can be handed off to, such as the Career Center or the Student's own academic advisor.
_Avoid_: Referral target, staff, office (alone)

**Crisis**:
A conversation that clearly suggests a Student's safety may be at risk; everyday exaggeration such as "this exam is killing me" isn't one. In a Crisis, Buddy immediately shows crisis Resources and asks for Action Permission to contact someone, and never contacts anyone without it.
_Avoid_: Emergency, red flag, escalation

**Handoff**:
Buddy connecting a Student to one specific Contact and preparing a Draft for them, such as an email. Buddy then offers two other routes if the Student wants them: explaining the issue itself, or contacting the Contact for the Student, which needs an Action Permission. Anything Buddy sends goes out from the Student's own TUmail, in the Student's name and voice.
_Avoid_: Escalation, referral, transfer

**Draft**:
A message Buddy prepares for a Student to send to a Contact, ending with a line the Student can delete that says Buddy, an AI assistant, helped write it. It stays a Draft until the Student sends it or gives an Action Permission for Buddy to send it.
_Avoid_: Prepared message, outreach, template

**Practice mode**:
The setting in which everything Buddy sends for a Student goes to the Student's own address instead of to the Contact. Buddy starts in Practice mode, and only the Student can switch it to Live.
_Avoid_: Test mode, sandbox, dry run

### Work Buddy does

**Task**:
Work the Student asks Buddy to do in the background, such as researching summer programs and checking which ones the Student qualifies for. Buddy tells the Student when a Task is done or needs them.
_Avoid_: Job, errand, request
