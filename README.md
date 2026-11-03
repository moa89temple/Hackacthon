# Buddy

A Temple-specific personal AI assistant for first-generation students. It's a hackathon prototype, not an official Temple University service. See [the plan](docs/plan.md) and [the glossary](GLOSSARY.md).

## Run it

You need Node 24, Flutter, Docker Desktop and an Android emulator.

1. Paste your Anthropic API key after `ANTHROPIC_API_KEY=` in `.env.local` at the top of the repo. Git ignores this file.
2. Start Buddy's Browser. It keeps running, and starts again with Docker Desktop, until you stop it.

   ```
   cd browser
   docker compose up --detach --build
   ```

3. Start the backend, which listens on this laptop only:

   ```
   cd backend
   npm install
   npm start
   ```

4. Start an emulator, then run the app.

   ```
   cd app
   flutter run
   ```

5. Pair the app, as described next.

The conversation is saved in `backend/data/buddy.sqlite`.

## Pair your phone

Only a paired phone can talk to the backend. To get a pairing code, run this on the laptop. The backend can be running or not:

```
cd backend
npm run pair
```

It shows a QR code, the backend's address and a code. The code works once and expires after five minutes. Five wrong tries or a newer code cancel it, so run the command again if that happens.

Pairing gives the phone its own device key, which it keeps in the phone's secure storage. The backend keeps only a hash of it, and refuses every request without a valid key, the live view included.

Buddy locks whenever it goes into the background, and opens with your fingerprint, face or the phone's screen lock. It stays locked on a phone with none of these.

### On the emulator

1. Set a screen lock on the emulator, in **Settings > Security & privacy > Device unlock**.
2. Run `npm run pair`.
3. In the app, type the code and tap **Pair**. Leave the address as it is.

### On your real Android phone

The phone reaches the backend over Tailscale. Tailscale Serve gives the laptop an HTTPS address that only your own devices can open, and passes requests to the backend, which still listens on this laptop only.

1. Install [Tailscale](https://tailscale.com/download) on the laptop and the phone, and sign in to the same account on both.
2. On the laptop, run this. The first time, it gives you a link to turn on HTTPS for your account. It then prints your address, such as `https://laptop.tail1234.ts.net`.

   ```
   tailscale serve --bg 8787
   ```

3. Add the address to `.env.local`, then restart the backend:

   ```
   TAILSCALE_ADDRESS=https://laptop.tail1234.ts.net
   ```

4. Connect the phone with USB debugging on, then install the app with `flutter run --release` in `app`. A release build won't use anything but HTTPS.
5. Run `npm run pair`, then tap **Scan the QR code** in the app. If the camera doesn't work, type the address and the code instead.

If you lose the phone, remove it from your [Tailscale machines](https://login.tailscale.com/admin/machines) so that it can't reach the backend.

## What Buddy knows about you

The conversation opens with Buddy's own words (`backend/src/system-prompt.ts`), which no model writes: two sentences on what it won't do and that it never acts without your tap, then a question about your Goals. Over the first few conversations it asks a couple of getting-to-know-you questions at a time, says why, and lets you skip them. It never asks about immigration status or health.

Whatever you mention, Claude saves right away with its `remember` tool, as a Profile fact. The backend records where the fact came from, so Claude can't say otherwise. The You tab lists every fact with its origin, and you can edit or delete each one. Goals have their own place: see [Goals and your Roadmap](#goals-and-your-roadmap).

### Hiding secrets

Every message goes through `backend/src/masking.ts` first, before it's saved, before the Crisis check and before Claude sees it. So do facts, whether Claude saved them or you edited them. It replaces these with a mark such as `[password hidden]`, and the app replaces what you typed and shows a note saying Buddy hid it:

- **Social Security numbers:** three, two and four digits with a space, dash or dot between them, or any nine digits if the message also mentions a Social Security number. Other nine-digit numbers, such as a TUid, are left alone.
- **Card numbers:** 13 to 19 digits that pass the card checksum, even with an expiry date or security code right after them. If other digits pass the checksum along with part of a card, those are hidden too.
- **Passwords and PINs:** the word after "my password is" or "changed my password to", all of a quoted password, the rest of the line after "password:", or anything with both letters and digits (or four digits in a row) within six words after the word "password". It also reads a few other languages. Ordinary talk such as "my password is expired" is left alone.

- **Secret calendar addresses:** a Google Calendar address with `private-` in it, because anyone who has one can read the calendar.

It leans toward hiding, so it will sometimes hide a number that wasn't a secret.

### Known limits

- Deleting a fact takes it out of the Profile, and Buddy is told to go by the latest Profile and not bring the fact up again. The message it came from stays in the conversation, and so do the copies of the Profile in earlier turns, because the history Claude sees only ever grows. Claude can still read those, and they stay on disk until the conversation is deleted.
- These can't be recognized:
  - a password with no label, such as a message that just says "hunter2";
  - a label in a language the list doesn't cover;
  - an unquoted password that starts with an ordinary word, such as "my password is correct horse battery", which looks like talk about a password. If the first word isn't an ordinary one, only that word is hidden;
  - nine digits on their own, with no mention of a Social Security number, because they look just like a TUid.
- Only the digits 0 to 9 are read, so a number written in another numeral system isn't hidden. A number split up in an unusual way, such as "0 7 8 0 5", isn't either.
- The opening and the note are in English, because the Student hasn't written anything yet. Buddy's own replies follow the Student's language.
- Masking covers what you type in the app. What you type in the live view during a Takeover goes straight to the website, and Buddy never sees it.

## When a Student may be at risk

Every message goes through a check before Claude sees it (`backend/src/crisis-check.ts`):

- **Clear risk signals** show the Crisis card at once, before Claude is called. Claude then writes its reply below the card. If Claude fails or refuses, Buddy adds a note of its own, and the card stays.
- **Unclear messages** go to a Haiku 5.5 classifier, which has 5 seconds to answer nothing, a check-in or a Crisis. If it fails, refuses or runs out of time, Buddy checks in.
- **Everyday exaggeration** such as "this exam is killing me", and every other message, goes straight to Claude.

Claude can also raise the card itself at any point in a conversation, through its `show_crisis_card` tool. The tool takes no input, and the card's words and numbers are in the app (`app/lib/chat/crisis_card.dart`), so none of it can come from the model. Tapping a button opens the phone's dialer or messaging app with the number filled in, and the Student taps once more to call or send.

### Known limits of the check

- The word lists read English only. In other languages, the card depends on Claude using its tool, so it won't appear if Claude fails or refuses.
- Each message is checked by itself. Noticing a risk that builds up over several messages is left to Claude.
- The check runs on the backend, so if the app can't reach the backend, no card appears.
- The app locks when it goes into the background, so coming back from a call means unlocking it again.

## Connect Google Calendar

On the You tab, tap **Connect** next to Google Calendar, or use the card Buddy shows if it suggests connecting it. The card says exactly what Buddy will read. Paste the calendar's secret address and tap **Give Read Permission**. A typed "yes" in the chat never gives it. To find the address, open Google Calendar on a computer, go to **Settings**, pick your calendar under **Settings for my calendars**, open **Integrate calendar**, and copy **Secret address in iCal format**.

Buddy then reads the calendar at 7 a.m., 1 p.m. and 7 p.m. Philadelphia time, and when you tap **Read now** or ask it to look again in the chat. If the laptop was asleep at one of those times, Buddy reads once when it wakes.

Each event or repeating series in the next 14 days becomes one Profile fact. You can edit or delete it on the You tab, and that lasts through later reads. An edit changes the name Buddy sees, not the times. Buddy's free-time list comes from `backend/src/google-calendar.ts`: nothing marked busy between 8 a.m. and 8 p.m., in gaps of at least 30 minutes. Deleting a fact means Buddy can't count that event as busy.

Revoking the Read Permission deletes the address and every fact from the calendar, but not what Claude was already shown, as the limits below explain. The address is checked to be Google's own, stays on the laptop, is never returned by the backend and is never sent to Claude. If you paste it in the chat, it's hidden before anything is saved or sent.

### Known limits

- Calendar events Claude has already seen stay in the conversation's history and in Activity after you revoke, as with a deleted fact, until those are deleted. Buddy is told not to use or mention them. The history is on the laptop's disk too.
- That Claude suggests a Connection only when it's actually needed or you ask, and won't save calendar details as your own facts, are instructions to Claude, checked by `npm run smoke`, not guarantees. An earlier offer doesn't stop a later one when it's needed again.
- The feed doesn't say which guest is you, so an event you declined still counts as busy if Google includes it. Only the one calendar whose address you paste is read.
- Anyone who invites you can put text on your calendar. Claude is told it's only ever information, but that's an instruction too.
- Reads depend on the laptop being on and awake. A read that fails waits for the next read time, unless you tap **Read now**.
- All times are on Philadelphia's clock, wherever you are.

## Connect Temple's systems

Canvas, TUportal, TUmail, Navigate360 and DARS are read through Buddy's Browser, with your own login. On the You tab, tap **Connect**, read the card, tap **Give Read Permission**, then log in yourself through a Takeover, as described in [Log in to a site](#log-in-to-a-site). They share Temple's sign-on, so after the first you may not be asked to log in again.

Buddy reads each one at 7 a.m., 1 p.m. and 7 p.m. Philadelphia time, and when you tap **Read now** or ask in the chat. What it reads becomes Profile facts, which you can change or delete. Revoking deletes those facts and that Connection's login. Temple's sign-on stays while another Temple Connection is on, and goes with the last of them.

Buddy's code decides what can be opened, in each Connection's `*-rules.ts`, and the network guard enforces it in the browser. Nothing it reads can change that. It never submits anything on these sites.

| Connection | What Buddy reads | Where it is |
|---|---|---|
| Canvas | Courses, assignments, your own grades and announcements | Canvas's pages |
| TUportal | Your holds and your balance | Holds are on Banner's View Holds, and the balance is in a frame on the Cost & Aid tab |
| TUmail | Recent email from `temple.edu` addresses and from Contacts | Your inbox in Outlook on the web |
| Navigate360 | Your assigned advisor, who becomes a Contact, and your upcoming appointments | What the app's own scripts get from its server |
| DARS | Which requirements are complete, missing, in progress or planned on your newest audit | Your list of audits and that audit, at `prd-dars.temple.edu`. **Nobody has checked this against a real login yet** |

### DARS

Everything assumed about DARS is in `dars-rules.ts`, which says what was seen and what's a guess. Its pages in the tests are made up, so until `npm run check-dars` has run against a real login, none of this is known to fit. One thing the reader doesn't understand anywhere on a page means it keeps what it had and says it couldn't read it, because a wrong "complete" could mislead you about graduating.

Buddy reads the newest audit already on your list, and never runs one, deletes one or opens a What-If audit. So it's only as new as your latest audit: run one yourself at `dars.temple.edu`, then tap **Read now**. It doesn't keep your name, ID, GPA or grades.

When a recent audit doesn't match your Roadmap, Buddy shows a card in the conversation, a few changes at a time. A read outside a conversation leaves it there for when you come back to the Buddy tab. Nothing changes until you tap **Accept**, and the same change isn't shown twice. A requirement is matched to a Milestone by the Milestone's name or by a course it names, so a card can miss one or suggest one that's already covered. An audit older than 30 days makes no card.

### TUportal

The portal doesn't have your holds on it. They're on one page of Self-Service Banner, `bwskoacc.P_ViewHold`, reached through Banner's own sign-on and main menu. Those three addresses are the only ones open on Banner, because its pages can act on being opened. Adding another is a decision for a person, one page at a time. Temple's records may show these visits as you opening Banner.

Claude is given your balance only when it asks for it because you asked about your balance or what you owe. Buddy's code leaves it out of what Claude sees and out of Activity otherwise, though deciding that you asked is up to Claude. An amount on a hold comes with the hold.

Buddy doesn't read your registration status: the Student tab doesn't show it, and where it's kept is on pages Buddy never opens. It never opens TUpay or anything for paying, registering or filling in a form.

The registrar's Dashboard, `apps/our/Dashboard/ajax.jsp`, stays refused. That one address does everything the Dashboard does, including amending a record and re-enrolling, so it can't go on a read-only list by its address.

### TUmail

A usual read goes through your newest messages, as many as Outlook has drawn, about 7. When you ask about older email, or Buddy can't find what you asked about, Claude can ask it to look further back with `look_further`. That scrolls the list and goes through about your newest 60, and takes around a minute. Outlook only draws the rows in view, so Buddy collects them as it goes. It opens up to 10 messages each time, Contacts first, and more on the next read. What it finds this way isn't counted as new email.

Buddy decides who an email is from by its address, never by a display name. Someone in Temple's own directory shows by name alone when opened, so that message counts as the row's sender's only if it shows exactly the row's name and that name doesn't look like an address. In a thread, it reads only that sender's open message, so nobody else's words get in. If that isn't exactly one message, it reads none and says so.

Opening a message doesn't mark it read, and while Buddy reads, the guard refuses everything that would change your mail. A POST from Outlook gets through only if it's on the short list in `tumail-rules.ts`. That includes the one that renews its own token about every hour, because without it Outlook never asks for any mail.

Everything in an email is information, never instructions. From the moment Claude has read your email in a reply, Buddy's code refuses saving a fact or a Goal, writing a Draft and showing a card that asks you to agree to something, until you next write. An email's words aren't kept in the conversation.

### Check a Connection against your real login

Each of these runs the real reader through the real guard and prints page shape only: which pages it understood, what the guard refused, and the structure of those it didn't. It never prints your records, and it saves nothing. Each needs that Connection's Read Permission, and stays out during a Takeover.

```
cd backend
npm run check-canvas
npm run check-tuportal
npm run check-dars
npm run check-tumail
npm run check-tumail -- --further   # what a read does when it looks further back
npm run check-navigate360
```

Read what each prints, because `check-canvas` exits 0 even if a page had a problem. `check-tuportal` and `check-dars` exit 6 if a page wasn't understood, `check-tumail` exits 6 if opening a message marked it read, and `check-tumail` and `check-navigate360` exit 7 if the reader missed something. Each script's first lines list the rest.

### Known limits

- All of this was checked against one real account. That account had no holds and no upcoming appointments, so a real hold and a real appointment haven't been seen. A hold in a layout the reader doesn't know gives "couldn't read your holds", never "no holds".
- That account is on v1 of Navigate360. v2 is written from its public scripts and is unconfirmed.
- A real outside sender with an address for a display name hasn't been tried. Made-up pages cover it.
- Looking further back reaches about your newest 60 messages, so anything older still isn't seen, and Buddy is told to say so. Buddy only sees your inbox, so it can't tell you what you've sent or what's in another folder.
- A message from a Contact counts as theirs by its address, and an advisor's address must be Temple's own.
- Revoking Navigate360 removes your advisor as a Contact, but their name stays in Drafts and Activity that already have it, as a record of what happened.
- That Buddy only brings up another email if it's urgent is an instruction to Claude, not a guarantee.
- Reading email can load pictures in it, as it would for you, and that can tell the sender it was opened.
- Nobody has read Temple's, Microsoft's or EAB's terms on this. The cards say so where it matters.
- While a Takeover is open, Buddy can't read anything, and the guard is off for the Student. The app says which Connection's Takeover it is if you leave without tapping Done.

## Goals and your Roadmap

Tell Buddy what you want to achieve, and it saves that as a Goal. You can see, change and add Goals on the You tab. Goals aren't Profile facts.

When you ask for a Roadmap, Buddy needs your major and year, so it asks if the Profile doesn't say. It reads your program's Suggested Academic Plan from Temple's Bulletin, then shows a card with Milestones for each Goal, the plan's terms and Standard Milestones, each with its Source. The plan is read by code, and Claude can't change it. A Milestone Claude suggests says that it's Buddy's suggestion, not from a Temple page, and to check it with your advisor.

Nothing changes until you tap **Accept**, and a typed yes doesn't count. On the Roadmap tab you can mark Milestones done, move them, remove them, add your own and add them to Google Calendar. Buddy can suggest a change later, with a card of its own, and only your tap makes it.

### Known limits

- If Buddy doesn't know your year, there's no Roadmap yet.
- Dates for a plan's terms are Buddy's own targets, not Temple's.
- Milestones are moved with arrows, not by dragging.
- Claude could still suggest a poor Milestone. Anything specific to Temple needs a Guidebook item behind it, but that's an instruction, checked by `npm run smoke:roadmap`.

## The Guidebook

Once a day, from 6 a.m. Philadelphia time, Discovery reads 40 pages from Temple's office websites: Tuttleman Counseling, the Student Success Center, the Career Center, Student Financial Services, the Wellness Resource Center, Disability Resources and the Dean of Students. The list is in `backend/src/office-pages.ts`. It reads with plain page fetches, not Buddy's Browser, and needs no Permission because the pages are public. If the laptop was asleep, it reads once when the laptop wakes.

Haiku 5.5 lists the Resources and Contacts on each page, and only a page whose words have changed goes to Haiku. Each item keeps its Source: the page's address, its title and when Buddy last saw the item there. An item found on several pages becomes one item with several Sources.

When you ask something specific to Temple, Claude searches the Guidebook and shows a card for what it mentions, with its Source. The card's words come from the Guidebook, not from what Claude wrote, and Claude can pass only an item's number. Free Resources come first, and anything that costs money says what it costs. **How Buddy decided** in Activity lists each Source Buddy looked at for that reply.

### What's checked, and what's only asked of Claude

Buddy's own code does these:

- A phone number or email address that isn't on the page is dropped, and so are hours or a place with a number that isn't on the page. An item whose summary has such a number is left out.
- Something counts as free or paid only if Haiku quotes the page's own words about its cost, and those words are really there. A price has to be in those quoted words too. Otherwise the card says its Source doesn't say. If any of an item's pages says it costs money, the card says so.
- If a reply names an item with two or more words in its name, its card appears even if Claude didn't ask for one, up to three cards a reply. The exception is a reply next to the Crisis card.

Claude is told never to state a Temple-specific fact without a Source, to say so when it can't find one, and to treat what it reads on a page as information only. That's an instruction, not a guarantee, and `npm run smoke:guidebook` checks it on real pages. The Crisis card is the one exception on purpose: its Tuttleman number is in the app's own code, so that it appears whatever else fails.

### Reporting an item

Tap **Report** on a card if it's wrong or out of date. That hides the item for every Student straight away, and every card of it in the conversation becomes a short note. Discovery can find it again, but it stays hidden. Claude is told not to use what it saw of it earlier in the conversation. There's no way to undo a Report in the app. Only your tap does this: Claude can't report anything, so that nothing it reads on a page can hide an item.

### When items leave

An item leaves two weeks after it went missing from its page, unless another of its pages still has it. A page that doesn't answer, or answers with next to nothing, counts as missing too, from the first day it fails. If it comes back later, its items come back with it. If no page answers at all, the laptop is probably offline, so that doesn't count against anything, and Buddy tries again each hour. If Haiku fails on a page, nothing about that page changes, and it tries again the next day.

### Known limits

- Only the summary's numbers are checked against the page, not its meaning, and a number only has to be somewhere on the page. Haiku could still describe something wrongly, which is what **Report** is for.
- Items merge by name. Two things with the same name at different offices become one item, and one thing with different names at different offices stays two. Haiku is given the names already known from the same office to keep this down.
- A Report covers one item. A Resource and a Contact with the same name are two items, so the other can still show. A reported item that Haiku later names quite differently would come back as new, though it's told the reported names so as not to.
- Search goes by words. Haiku adds everyday words for each item, and Claude picks the words to search for, but a question that shares no word with an item won't find it.
- Only the pages on the list are read, so a new page isn't noticed. A page that moves stops answering, Activity lists it, and its address needs changing in the list. Its items leave after two weeks.
- The Bulletin and the academic calendar aren't in it: Buddy reads those for Roadmaps and Standard Milestones.
- Reads depend on the laptop being on and awake, and on the Claude budget that #27 will limit.

After changing the page list, run `npm run save-office-pages` in `backend` to refresh the saved copies the tests use. `npm run save-bulletin-pages` does the same for the Bulletin's pages.

## Opportunities

Opportunities are things with a date or a deadline that you could miss. On the Today tab, tap **See Opportunities**. Temple's come first, and anything from elsewhere comes after them, labeled **Outside Temple**. Tap **Save** on one and it shows at the top of Today until its date has passed. Claude finds them with its `find_opportunities` tool, which puts up their cards, and only your tap saves one.

Two things find them, both from the backend's timer, so if the laptop was asleep they run when it wakes:

- **Temple's events.** Once a day, from 6 a.m. Philadelphia time, Discovery reads the first 15 pages of now.temple.edu's events, which reach a little over two weeks ahead, and then each event's own page. Only a page whose words have changed goes to Haiku. The name and the date come from the list, not from Haiku.
- **Searches for your Goals.** Haiku runs Claude's web search for each Goal, at most 5 searches, and picks at most 8 pages. A Goal is searched within a minute of being added or having its words changed, and again each week. If its search or all of its pages fail, it tries again in an hour. Only your Goal's words go into the search, and they go to Anthropic and its search provider. What a search found goes when its Goal does, unless you saved it. Its pages get read again each week whatever later searches pick, so it stays as long as its page says it.

Buddy reads a page with a plain fetch if that works. If a page is built by script or turns plain fetches away, it goes through Buddy's Browser with its own guard: only that page's exact host opens, only reading gets through, and neither the page nor anything it loads can reach a Connection or Temple's sign-on, even with a Read Permission. It also opens in a profile of its own that's thrown away afterwards, so it can't see the one holding your logins or leave anything there.

### What's checked, and what's only asked of Claude

Buddy's own code does these:

- **The date.** A search's result needs the page's own words for its date, with the month's name, and they have to give that day. Otherwise it's dropped. An Opportunity with no date isn't one, so a rolling deadline is dropped too.
- **The place.** Whether it's Outside Temple goes by the Source's address alone: `temple.edu` and its subdomains are Temple's.
- **The Source.** An address counts only if a search really gave it, and it has to be `https` on a public address, so Claude can't make one up or point Buddy at this laptop.
- **Fees.** Something with a fee shows only with what it costs, in words quoted from the page, and a one-line reason from Claude that it's worth it. With no amount or no reason it's hidden, even if another of its pages doesn't mention a fee. An event is treated the same if its own page gives a price that Haiku didn't. Something is only called free if the page says so in the words quoted, and those words give no price. Otherwise the card says its Source doesn't say.
- **When it goes.** It's hidden from the day after its date, on Philadelphia's clock, saved or not. It leaves two weeks after it was last seen on its page or, for an event, on the list, and a new reading of its page that doesn't list it counts as not seeing it. An event the list says is cancelled goes at once. A Report hides it for every Student.

Whether a fee is really worth it is Claude's own judgment, and so is whether a page fits a Goal. Claude is told to say what's outside Temple isn't Temple's, and that's an instruction, not a guarantee.

### Known limits

- **Searches are broad on purpose, for now.** There's no check on what kind of site a Source is, so a Source outside Temple can be anyone's, which goes against the glossary's rule that only trustworthy pages count. Read its Source before you sign up, and tap **Report** if it's wrong.
- On a search's page, a fee Haiku doesn't notice shows as "Its Source doesn't say". Only an event's own page gets checked for a price Haiku left out, and that check can hide an event for a sum that wasn't its price.
- An event that moves to another day gets a new address, so its old card shows until its old date passes or two weeks go by. So does a cancelled one whose address changed in some way other than gaining the word.
- A PDF isn't read, and neither is a date written only in numbers, such as 12/1/2026.
- A page that redirects to another host can't be read at all, because the plain fetch won't follow it and the guard won't open it. Neither can a Temple page that isn't on the public list, except by plain fetch.
- Items merge by name and date, so a reworded one counts as new, and its save stays with the old one until that leaves.
- The check that a search result isn't this laptop goes by its name, so a public name that points back here would get a plain fetch. The backend refuses any host name it doesn't know.
- A page opened in Buddy's Browser can load things from any public host, as any public page can.
- These runs depend on the Claude budget that #27 will limit. The first read of the events makes about 180 Haiku calls.
- Nothing nudges you about a saved Opportunity yet: that's for the Alerts ticket.

## Send a Draft from TUmail

Tap **Buddy sends it** on a Draft card. That only makes an Action card, which shows exactly who it goes to, the subject and the message. Nothing goes until you tap **Approve**, and a typed yes never counts. Claude has no tool for any of this, and it can't make this card, approve it or switch to Live.

Buddy starts in **Practice mode**, where everything goes to your own TUmail address instead of the Contact. Add that address under **Email Buddy sends** on the You tab, because with no address nothing is sent at all. **Switch to Live** is on that same section, asks you first and is recorded in Activity. Practice mode stays on until you do that.

What happens after Approve is a fixed routine. It opens a new email in Buddy's Browser, fills it in from the card, and reads it back. If that's exactly the card, it records that the send has started, opens the guard for one request, and presses Send once. The guard looks at what that request really carries, and refuses it unless it's to exactly that recipient with exactly those words. It shuts as soon as that one has gone, and on any failure too. Reading never gets any of this: its guard has no way to open.

A card stops working if you edit the Draft, change your address, or switch between Practice and Live, even there and back. Tap **Buddy sends it** again for a new one. Tapping Approve twice, or a retry, or a restart can't send it twice. If Send was pressed and there's no clear answer, or nothing was seen to go, the card says Buddy can't tell, and it doesn't try again. Check your Sent folder.

### Known limits

- **One real Practice send has gone through this.** It went on 2026-11-03, once, with no signature set. What it can't speak for is marked UNVERIFIED in `tumail-rules.ts` and `compose-in-page.ts`, and it all fails closed: if Outlook differs, nothing is sent and the card says what didn't match. Live has never been used.
- Buddy can't check the address you type against the account that's logged in. It has to be a temple.edu address that no Contact has, and the card shows it before you approve, but a typing mistake would send your Practice email to whoever has that address.
- A message goes as plain words. The number of blank lines can differ from the Draft's, because Outlook's editor keeps them its own way, but the lines themselves can't. Any signature Outlook puts in the new email is replaced.
- The guard checks the recipient, copies, attachments, subject and words. It doesn't look at anything else a request could say, such as its From, because only Outlook's own page could put something there.
- The guard stops Outlook saving anything as a Draft, so a send that doesn't happen leaves nothing behind in Drafts.
- Buddy won't send a Draft it hid something in, such as a password, because the mark it left would go too. Change that part with Edit first.
- If a Contact's address changes while a card is waiting, the card stops working. Buddy won't send to a Contact it has more than one address for.
- Once a send has gone, or can't be told, Buddy won't make another card for exactly the same words. Change the Draft first, or open it in Outlook.

## See what Buddy did

On the You tab, tap **See your Activity**. It lists, newest first, every read of a Connection (including failed ones, and why each happened), every Read Permission you gave or revoked, each time Buddy opened a site to check your login, each day's read of Temple's office pages and of its events, each web search for a Goal and each time it read those pages again, each Report you made, each Action Permission asked for and given, each email Buddy sent or may have sent with all its words, each switch to Live or back, and each of Buddy's replies, including one it couldn't finish. Tap **How Buddy decided** on a reply to see the tools it used, the Sources it looked at and the Profile facts it had.

The backend writes all of this itself, in words from Buddy's own code, and Claude doesn't get a say. An entry can't be edited or removed one by one: the backend has no route for it, and the store has no method for it. Later tickets add their own kinds of entry, and the app shows them as they are.

### Known limits

- "Profile facts Buddy had" means the facts Claude was given for that reply: everything you told Buddy, plus the calendar if Buddy looked at it. Claude isn't asked which ones it used, because its answer couldn't be checked, so it may not have used every one. After a read that's out of date, the list can include an event that's already over, which Claude wasn't shown.
- Claude can also see the conversation so far, including what it looked at in earlier turns, so a reply can rest on those without any of it being listed. The screen says so.
- Each reply's record keeps its facts as they were at the time. A fact you later edit or delete, or a calendar event you later revoke, keeps its old words in the records of replies that had it, until the record is deleted (#30). Reads themselves keep no calendar details.
- `npm run check-login` is a tool for this laptop, so its read isn't recorded.
- If a Read now joins a read already under way, the entry gives the first one's reason.
- The whole list loads at once, which will get slow only after a very long time.

## Log in to a site

On the You tab, tap **Log in** under the Connection, such as **Log in to Canvas**, once you've given its Read Permission. The live view opens on the site's sign-in page. Tap the field you want, tap **Keyboard** to type, approve Duo on your phone, then tap **Done**. The app then tells you whether Buddy could open the site.

Until you tap Done, Buddy can't read the browser and nothing is recorded. If you leave the live view without tapping Done, Buddy can't read anything, for any Connection, until you go back and tap it. The app tells you, and the button under that Connection becomes **Continue logging in**.

Logins are kept in the `profile` Docker volume, so they survive restarts of the backend and the container. `docker compose down` keeps them. `docker compose down --volumes` deletes them all. To forget one site's login:

```
cd backend
npm run forget-login canvas
```

This forgets Temple's single sign-on and Duo only if no other Temple Connection is on. While one is, they stay, so logging in to the forgotten site may not ask you again. Temple's cookies are shared across its sites, so others may need you to log in again sooner.

To check that a login still works, including after a restart, run this with Buddy's Browser running. It prints the page's title and how much text Buddy read, not the text itself. It's refused while a Takeover is under way.

```
cd backend
npm run check-login
```

### How Buddy's Browser is kept apart

- It runs as an ordinary user with no Linux capabilities and a read-only system disk, and no folder from this laptop is mounted.
- Chromium's own sandbox stays on. `browser/chromium-seccomp.json` is Docker's default profile plus the few calls that sandbox needs.
- The password manager, autofill and browsing history are off, so the browser never saves a password or a list of the pages it visited.
- The app only ever talks to the backend. The backend passes the live view along and never looks at it or logs it.
- The backend only answers to `127.0.0.1`, `localhost`, `10.0.2.2` and your Tailscale address, so a page in Buddy's Browser can't get answers from it through Docker's address for this laptop.
- The live view needs a device key too, and the phone's key is never passed on to the container.

### Known limits

- Buddy's Browser can still open connections to other programs listening on this laptop through Docker's address for it, `host.docker.internal`. Only the backend checks for this, and blocking it fully needs a firewall in the container.
- The container's control and live view ports are open to every program on this laptop, though not to the network. Android emulators on this laptop can reach them too, but the app never uses them.
- A screen reader can't read the live view, because it's a picture of the browser. The app's own controls work with one.
- The app and the backend talk in plain HTTP on the emulator, which stays on this laptop. Debug builds accept that one address, so use a release build on a real phone.
- A phone can't be unpaired yet except by removing it from Tailscale, and that doesn't cancel its key. To cancel every key, stop the backend and delete `backend/data/buddy.sqlite`, which deletes the conversation too.
- Chromium saves cookies every 30 seconds, and whenever the container stops normally. If the laptop loses power within 30 seconds of a login, that login may be lost.

## Test it

```
cd backend
npm test
npm run typecheck
npm run test:browser   # checks against the real container, on local test pages. Needs Docker Desktop.
npm run smoke          # makes real Claude calls, including Profile, masking, Crisis and calendar tests, which cost real money
npm run smoke:handoff     # real Claude calls for Handoffs
npm run smoke:guidebook   # real Temple pages and real Claude calls for the Guidebook
npm run smoke:milestones  # real Temple pages and real Claude calls for Standard Milestones
npm run smoke:roadmap     # real Bulletin pages and real Claude calls for a Roadmap
npm run smoke:opportunities  # real events, a real web search and real Claude calls, printing what it found

cd app
flutter test
flutter analyze
```

`npm run test:browser` uses its own profile, so it can't touch your real logins.

Run `npm run smoke` after adding or changing a tool. The real API refuses every reply once the tools' schemas together get too big, and scripted tests can't see that: `test/tool-limits.test.ts` only holds the published limits. To check a Connection against your real login, see [Check a Connection against your real login](#check-a-connection-against-your-real-login).

Tests replace everything outside Buddy with test versions. To add another outside service, add it to `backend/src/adapters.ts` and give it a test version in `backend/test/support/`.
