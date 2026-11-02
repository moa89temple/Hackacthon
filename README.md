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

Whatever you mention, Claude saves right away with its `remember` tool, as a Profile fact. The backend records where the fact came from, so Claude can't say otherwise. The You tab lists every fact with its origin, and you can edit or delete each one. Goals are saved as ordinary facts until #11 gives them their own place.

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
- Opportunities aren't in the Guidebook yet (#12), and neither are the Bulletin or the academic calendar. Buddy will say it has no Source for those.
- Reads depend on the laptop being on and awake, and on the Claude budget that #27 will limit.

After changing the page list, run `npm run save-office-pages` in `backend` to refresh the saved copies the tests use.

## See what Buddy did

On the You tab, tap **See your Activity**. It lists, newest first, every read of a Connection (including failed ones, and why each happened), every Read Permission you gave or revoked, each time Buddy opened a site to check your login, each day's read of Temple's office pages, each Report you made, and each of Buddy's replies, including one it couldn't finish. Tap **How Buddy decided** on a reply to see the tools it used, the Sources it looked at and the Profile facts it had.

The backend writes all of this itself, in words from Buddy's own code, and Claude doesn't get a say. An entry can't be edited or removed one by one: the backend has no route for it, and the store has no method for it. Later tickets add their own kinds of entry, and the app shows them as they are.

### Known limits

- "Profile facts Buddy had" means the facts Claude was given for that reply: everything you told Buddy, plus the calendar if Buddy looked at it. Claude isn't asked which ones it used, because its answer couldn't be checked, so it may not have used every one. After a read that's out of date, the list can include an event that's already over, which Claude wasn't shown.
- Claude can also see the conversation so far, including what it looked at in earlier turns, so a reply can rest on those without any of it being listed. The screen says so.
- There are no Sources yet, so that part always says none. #9 gives Buddy pages to look at, and needs to add them to the turn's record.
- Each reply's record keeps its facts as they were at the time. A fact you later edit or delete, or a calendar event you later revoke, keeps its old words in the records of replies that had it, until the record is deleted (#30). Reads themselves keep no calendar details.
- `npm run check-login` is a tool for this laptop, so its read isn't recorded.
- If a Read now joins a read already under way, the entry gives the first one's reason.
- The whole list loads at once, which will get slow only after a very long time.

## Log in to a site

On the You tab, tap **Log in to Canvas**. The live view opens on the site's sign-in page. Tap the field you want, tap **Keyboard** to type, approve Duo on your phone, then tap **Done**. The app then tells you whether Buddy could open the site.

Until you tap Done, Buddy can't read the browser and nothing is recorded. If you leave the live view without tapping Done, Buddy stays locked out until you go back and tap it.

Logins are kept in the `profile` Docker volume, so they survive restarts of the backend and the container. `docker compose down` keeps them. `docker compose down --volumes` deletes them all. To forget one site's login:

```
cd backend
npm run forget-login canvas
```

Forgetting Canvas also forgets Temple's single sign-on and Duo, because otherwise the login would quietly come back. Other Temple sites may need you to log in again sooner.

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

cd app
flutter test
flutter analyze
```

`npm run test:browser` uses its own profile, so it can't touch your real logins.

Tests replace everything outside Buddy with test versions. To add another outside service, add it to `backend/src/adapters.ts` and give it a test version in `backend/test/support/`.
