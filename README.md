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

4. Start an emulator, then run the app. It reaches the backend at `10.0.2.2:8787`.

   ```
   cd app
   flutter run
   ```

The conversation is saved in `backend/data/buddy.sqlite`.

## Log in to a site

On the You tab, tap **Log in to Canvas**. The live view opens on the site's sign-in page. Tap the field you want, tap **Keyboard** to type, approve Duo on your phone, then tap **Done**. The app then tells you whether Buddy could open the site.

Until you tap Done, Buddy can't read the browser and nothing is recorded. If you leave the live view without tapping Done, Buddy stays locked out until you go back and tap it.

Logins are kept in the `profile` Docker volume, so they survive restarts of the backend and the container. `docker compose down` keeps them. `docker compose down --volumes` deletes them all. To forget one site's login, with the backend running:

```
curl -X DELETE http://127.0.0.1:8787/sites/canvas/login
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
- The backend only answers to `127.0.0.1`, `localhost` and `10.0.2.2`, so a page in Buddy's Browser can't get answers from it through Docker's address for this laptop.

### Known limits

- Buddy's Browser can still open connections to other programs listening on this laptop through Docker's address for it, `host.docker.internal`. Only the backend checks for this, and blocking it fully needs a firewall in the container.
- The container's control and live view ports are open to every program on this laptop, though not to the network. Android emulators on this laptop can reach them too, but the app never uses them.
- A screen reader can't read the live view, because it's a picture of the browser. The app's own controls work with one.
- The live view isn't encrypted between the emulator and the backend, which are on the same laptop. This needs fixing before a real phone connects.
- Chromium saves cookies every 30 seconds, and whenever the container stops normally. If the laptop loses power within 30 seconds of a login, that login may be lost.

## Test it

```
cd backend
npm test
npm run typecheck
npm run test:browser   # checks against the real container, on local test pages. Needs Docker Desktop.
npm run smoke          # makes one real Claude call, which costs real money

cd app
flutter test
flutter analyze
```

`npm run test:browser` uses its own profile, so it can't touch your real logins.

Tests replace everything outside Buddy with test versions. To add another outside service, add it to `backend/src/adapters.ts` and give it a test version in `backend/test/support/`.
