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
npm run smoke          # makes real Claude calls, including Profile, masking and Crisis tests, which cost real money

cd app
flutter test
flutter analyze
```

`npm run test:browser` uses its own profile, so it can't touch your real logins.

Tests replace everything outside Buddy with test versions. To add another outside service, add it to `backend/src/adapters.ts` and give it a test version in `backend/test/support/`.
