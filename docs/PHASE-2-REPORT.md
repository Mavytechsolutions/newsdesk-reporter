# Phase 2 Report: Core News App

**Status:** Complete and tested.
* **Server:** 38 automated end-to-end tests pass (27 from Phase 1 + 11 new).
* **App:** type-checks cleanly and compiles to an Android bundle.
* **Walkthrough:** an automated reader walkthrough ran against the real server: setup, feed, story, search, save, login, profile and dark mode, with **0 errors**. Screenshots are in `docs/screenshots/`.

## Completed features

### Server (apps/api)
* **Personalised feed** `GET /feed?tab=` with these tabs:
  * **For You:** your places, your followed topics, breaking news and statewide news (everything if nothing is chosen yet).
  * **Local:** only your places, including every mandal and town inside a chosen district.
  * **Breaking** and every category tab.
  * Guests send their chosen places from the phone, so local news works without logging in.
* **Search** `GET /search`: Telugu or English words in headlines and summaries, tags, reporter names and place names, with filters for topic, district and date. When nothing matches, it offers a **"Did you mean…"** spelling suggestion.
* **Autocomplete** `GET /search/suggest`: places and tags as you type. Fast trigram indexes work for Telugu.
* **Bookmarks** (sync across phones), **likes** (once per reader), **share counter**, **reading history**, and **reset personalisation**.
* Feed cards show whether you liked or saved each story. Deleting an account also erases bookmarks, likes and history.

### Mobile app (apps/mobile): Android and iOS from one codebase
* **First launch:** pick Telugu or English, then your district and mandals/towns (you can skip this).
* **Home:**
  * Top bar: MAVY NEWS logo, current place (tap to change), search, a breaking-alerts bell and profile.
  * Category tabs from the server.
  * Two views: a **list** of image cards, or a **full-screen swipe** view (Inshorts style).
  * The feed loads 15 stories at a time as you scroll, and you pull down to refresh.
  * Grey loading cards, an "offline" screen with a Retry button, and empty screens with a helpful next step.
* **Story page:**
  * Photo with credit, headline, reporter, source, date and time, and a "citizen report" notice where it applies.
  * A **Listen** button reads the story aloud in Telugu or English.
  * A Telugu/English switch, tags, and place chips you can tap.
  * Like, Save, a **WhatsApp** button, Share, and related stories.
* **Explore:** search with suggestions, recent searches and "did you mean". You can also browse news by district (with mandal shortcuts) or by topic.
* **Saved:** stories are kept on the phone with full text, so they **open without internet**, and sync to your account when you're logged in.
* **Profile:**
  * Phone-OTP login with a 30-second resend timer, and an auto-fill code field.
  * Language, my places, followed topics, reading history, and light/dark/automatic appearance.
  * Reset personalisation, log out, and **delete account**.
* **Links:** `https://mavynews.in/n/<story>` and `mavynews://` links open the story inside the app (ready for push notifications in Phase 4).
* **Fonts and security:** Telugu text uses **Noto Sans Telugu** for clean rendering. Login tokens are stored in the phone's secure keychain, and there are **no API keys in the app**.
* **Videos tab:** shows a proper "coming soon" screen with a button back to top stories. Video news is Phase 3.

## Files created or changed
```
apps/api/src/db/schema.ts                 (+ bookmarks, likes, read_events, like/share counts)
apps/api/drizzle/0001_engagement.sql      0002_search_indexes.sql
apps/api/src/articles/feed.module.ts      (new: feed, search, engagement)
apps/api/src/articles/articles.service.ts (shared paging + liked/saved flags)
apps/api/src/users/users.module.ts        (account deletion clears engagement)
apps/api/test/phase2.e2e.test.ts
apps/mobile/                              (new app)
  App.tsx  app.json  eas.json  .env.example
  src/api/{client,hooks,types}.ts  src/store/settings.ts  src/theme.ts  src/i18n.ts
  src/components/{ui,NewsCard,FeedList}.tsx
  src/screens/{Home,Article,Explore,ListFeed,Places,Onboarding,OtherScreens}.tsx
docs/PHASE-2-REPORT.md  docs/SETUP-GUIDE.md (phone section)  docs/screenshots/
```

## Commands
| Purpose | Where | Command |
|---|---|---|
| Update database | apps/api | `npm run db:migrate` |
| Server tests | apps/api | `npm test` |
| Run app on phone | apps/mobile | `npx expo start` → scan QR with Expo Go |
| Check app code | apps/mobile | `npm run typecheck` |
| Installable Android file (APK), **later** | apps/mobile | `npx eas-cli build -p android --profile preview` (needs a free Expo account) |

## Environment variables
* `apps/mobile/.env` → `EXPO_PUBLIC_API_URL`, the server address. This is the only setting the app needs.
* Server: when the app is tested in a web browser, add that address to `CORS_ORIGINS`. Phones don't need this.

## Not yet done / next
* **APK / Play Store build:** not started, as you asked. The build profiles are ready in `eas.json`.
* **Google and Apple login:** need a Google OAuth client ID and an Apple Developer account.
* **Push notifications:** Phase 4 (needs a Firebase project). Story links are already wired.
* **Video feed, photo/video upload and AI audio bulletins:** Phase 3. Story read-aloud already works using the phone's own voice.
* **Feed caching in Redis:** to add before launch-scale traffic.
