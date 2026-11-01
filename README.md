# Buddy

A Temple-specific personal AI assistant for first-generation students. It's a hackathon prototype, not an official Temple University service. See [the plan](docs/plan.md) and [the glossary](GLOSSARY.md).

## Run it

You need Node 24, Flutter and an Android emulator.

1. Paste your Anthropic API key after `ANTHROPIC_API_KEY=` in `.env.local` at the top of the repo. Git ignores this file.
2. Start the backend, which listens on this laptop only:

   ```
   cd backend
   npm install
   npm start
   ```

3. Start an emulator, then run the app. It reaches the backend at `10.0.2.2:8787`.

   ```
   cd app
   flutter run
   ```

The conversation is saved in `backend/data/buddy.sqlite`.

## Test it

```
cd backend
npm test
npm run typecheck
npm run smoke      # makes one real Claude call, which costs real money

cd app
flutter test
flutter analyze
```

Tests replace everything outside Buddy with test versions. To add another outside service, add it to `backend/src/adapters.ts` and give it a test version in `backend/test/support/`.
