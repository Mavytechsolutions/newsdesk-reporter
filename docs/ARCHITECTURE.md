# MAVY NEWS — System Blueprint

MAVY TECH SOLUTIONS PVT LTD · Version 1 · November 2026

This document is the master plan. Every phase of development follows it.

---

## 1. The big picture (plain language)

MAVY NEWS has **four apps** that all talk to **one central server**:

| App | Who uses it | Built with |
|---|---|---|
| **Reader app** (Android + iOS) | The public | React Native (Expo), TypeScript |
| **Journalist portal** | Reporters, video journalists | Same mobile app, separate "Reporter mode" + web pages |
| **Newsroom dashboard** (web) | Editors, admins, marketing | Next.js (React) website |
| **Advertiser dashboard** (web) | Local businesses, brands | Part of the newsroom website, separate login |

The **central server (API)** holds all the rules: who can log in, who can publish, which news goes to which district. The apps never talk to the database directly, and **no secret keys live inside the apps**.

```
 Reader app ─┐                                   ┌─ PostgreSQL (all data)
 Reporter  ──┼──▶  HTTPS  ──▶  MAVY API (NestJS) ─┼─ Redis (cache, OTP limits, queues)
 Newsroom  ──┤                     │              ├─ Object storage (photos, videos)
 Advertiser ─┘                     │              └─ OpenSearch (later, for big search)
                                   ▼
        Outside services: SMS OTP gateway · Firebase push · Video transcoding + CDN
                          · LLM (summaries/translation) · Google Text-to-Speech · AdMob
```

## 2. Technology choices

| Layer | Choice | Why |
|---|---|---|
| Mobile | React Native + Expo dev builds, TypeScript, React Navigation, TanStack Query, Zustand | One codebase for Android and iOS. Good Telugu text rendering. Large talent pool in India. |
| API | Node.js 22 + **NestJS** + REST, WebSockets for live breaking news | Clear modules, built-in validation and guards, easy to grow a team on |
| Database | **PostgreSQL 16** with **Drizzle** ORM (SQL migrations) | Reliable, handles location trees, has built-in full-text search to start with |
| Cache / limits / jobs | **Redis** + BullMQ | Feed caching, OTP rate limits, background jobs (transcoding, AI, push) |
| Media | S3-compatible storage (AWS S3 or Google Cloud Storage) + CloudFront/Cloud CDN | Cheap and fast delivery across India |
| Video | AWS MediaConvert (or GCP Transcoder) → HLS at 240p/360p/540p/720p | Adaptive streaming for 2G/3G/4G |
| Push | Firebase Cloud Messaging, with topics per district/mandal/category | Free, works on Android and iOS |
| Search | PostgreSQL full-text + trigram (Telugu-safe) → OpenSearch later | No extra cost at launch |
| AI | LLM API behind an `AiProvider` interface; Google Cloud TTS (te-IN voices) | Can swap providers without app changes |
| Hosting | AWS Mumbai region (ap-south-1): ECS Fargate or a single VM at launch | Data stays in India, low latency |
| Monitoring | Sentry (crashes), Firebase Analytics + our own event table, uptime checks | |

## 3. System modules (server side)

| # | Module | What it does | Phase |
|---|---|---|---|
| 1 | **Auth** | Phone OTP, Google, Apple, guest tokens, admin email+password, refresh tokens | 1 |
| 2 | **Users** | Profile, language, preferred locations, followed categories, account deletion | 1 |
| 3 | **Staff & Roles** | Super Admin, Managing Editor, District Editor, Sub-Editor, Reporter, Video Journalist, Marketing Manager | 1 |
| 4 | **Locations** | State → District → Parliamentary → Assembly → Municipality/Mandal → Village → Ward | 1 |
| 5 | **Categories** | For You, Breaking, AP, Telangana, … Agriculture, Local | 1 |
| 6 | **Articles** | Create/edit, Telugu + English versions, editorial workflow, scheduling, breaking flag | 1 |
| 7 | **Audit log** | Records every important editorial and admin action | 1 |
| 8 | **Feed** | Personalised, location-ranked, cursor-paginated feed | 2 |
| 9 | **Search** | Keyword, district, mandal, journalist, date; autocomplete | 2 |
| 10 | **Engagement** | Likes, bookmarks, shares, reading history | 2 |
| 11 | **Media** | Signed uploads, image resizing, video transcoding, HLS | 3 |
| 12 | **Audio** | TTS for articles and daily bulletins | 3/5 |
| 13 | **Journalist portal** | Registration, ID verification, assignments, analytics | 4 |
| 14 | **Citizen journalism** | Public submissions → moderation → verification, clearly labelled | 4 |
| 15 | **Notifications** | FCM targeting by state/district/mandal/category/segment, frequency caps, deep links | 4 |
| 16 | **AI assistant** | Summaries, translation, headlines, duplicate detection, categorisation, risk flags. **Never auto-publishes.** | 5 |
| 17 | **Recommendations** | Scores news on location, category, history, follows | 5 |
| 18 | **Ads & monetization** | AdMob slots, native ads, sponsored labels, local listings, campaigns, premium | 6 |
| 19 | **Compliance** | Grievance officer workflow, takedowns, corrections, data export/deletion (DPDP Act 2023, IT Rules 2021) | 4–7 |
| 20 | **Analytics** | DAU/MAU, retention, district growth, revenue — real events only | 4–7 |

## 4. Editorial workflow (the rules engine)

```
DRAFT ──submit──▶ SUBMITTED ──sub-editor──▶ IN_REVIEW ──editor──▶ APPROVED
  ▲                    │                        │                    │
  └──── CHANGES_REQUESTED ◀─────────────────────┘          publisher │
                                                                     ▼
                         REJECTED                 SCHEDULED ──time──▶ PUBLISHED ──▶ ARCHIVED
                                                                          │
                                                          correction / takedown (logged)
```

* Reporters can only create drafts and submit, and only in districts assigned to them.
* District Editors can approve within their districts. Managing Editor and Super Admin can approve anywhere.
* **Publishing** needs the Managing Editor, a District Editor (own district) or the Super Admin.
* Anything written by AI or a citizen carries a flag and **must** pass a human approval step.
* Every transition is written to the audit log: who, when, from-status, to-status, note.

## 5. Database design

Core tables (Phase 1 builds these; later phases add the rest):

```
users ─────────────┬── user_locations (many preferred locations)
  id, phone,       ├── user_categories (followed)
  email, name,     ├── refresh_tokens
  language,        └── staff_profiles ── staff_assignments (districts/constituencies)
  status, role            role, verified, suspended_at

locations (self-referencing tree)
  id, type (STATE…WARD), name_en, name_te, slug, parent_id, path (materialised)

categories
  id, slug, name_en, name_te, sort_order, active

articles ──────────┬── article_translations (lang: te|en, headline, summary, body)
  id, slug, status,├── article_locations (many)
  is_breaking,     ├── article_tags
  source_type      ├── article_media (photo/video refs)
  (STAFF|CITIZEN|  └── article_status_history
   AGENCY|AI_ASSIST),
  author_id, category_id, published_at, scheduled_at, view_count

audit_logs  (actor_id, action, entity, entity_id, metadata JSON, ip, created_at)
otp_requests (phone, code_hash, attempts, expires_at)
```

Later phases add: `bookmarks`, `likes`, `read_events`, `follows`, `videos`, `video_renditions`, `citizen_submissions`, `notifications`, `notification_deliveries`, `ad_campaigns`, `ad_creatives`, `ad_events`, `subscriptions`, `grievances`, `corrections`.

The full, exact schema lives in `apps/api/src/db/schema.ts`; migrations are in `apps/api/drizzle/`.

## 6. API specification (Phase 1)

Base URL: `/api/v1`. All responses are JSON. Errors use `{ statusCode, message }`.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/auth/otp/request` | anyone | Send OTP to phone (rate-limited) |
| POST | `/auth/otp/verify` | anyone | Verify OTP → access + refresh token |
| POST | `/auth/guest` | anyone | Guest token for browsing |
| POST | `/auth/staff/login` | staff | Email + password login |
| POST | `/auth/refresh` | logged in | New access token |
| POST | `/auth/logout` | logged in | Revoke refresh token |
| GET/PATCH | `/me` | reader | View/update profile and language |
| PUT | `/me/locations` | reader | Set preferred locations |
| PUT | `/me/categories` | reader | Set followed categories |
| DELETE | `/me` | reader | Delete account (DPDP) |
| GET | `/locations?parentId=&type=` | anyone | Browse the location tree |
| GET | `/locations/search?q=` | anyone | Find a mandal/village by name (Telugu or English) |
| GET | `/categories` | anyone | Category tabs |
| GET | `/articles` | anyone | Published news (filter: category, location, breaking; cursor pages) |
| GET | `/articles/:slug` | anyone | One published article |
| POST | `/newsroom/articles` | staff | Create a draft |
| PATCH | `/newsroom/articles/:id` | staff | Edit (only allowed states) |
| POST | `/newsroom/articles/:id/transition` | staff | Move through the workflow |
| GET | `/newsroom/articles` | staff | Newsroom list with status filters |
| POST/GET | `/admin/staff` | super admin | Create staff, assign role and districts |
| PATCH | `/admin/staff/:id` | super admin | Suspend / revoke / reassign |
| GET | `/admin/audit-logs` | super admin, managing editor | Audit trail |
| GET | `/health` | anyone | Server health check |

## 7. Folder structure

```
mavy-news/
├── apps/
│   ├── api/                 ← Phase 1 (built now): NestJS server
│   │   ├── drizzle/         SQL migrations
│   │   ├── src/
│   │   │   ├── auth/        OTP, staff login, JWT, guards, SMS provider interface
│   │   │   ├── users/       reader profiles
│   │   │   ├── staff/       staff + roles + assignments
│   │   │   ├── locations/   location tree
│   │   │   ├── categories/
│   │   │   ├── articles/    public + newsroom + workflow rules
│   │   │   ├── audit/       audit log
│   │   │   ├── db/          schema, migrate, seed
│   │   │   └── common/      guards, decorators, helpers
│   │   └── test/            automated end-to-end tests
│   ├── mobile/              ← Phase 2: Expo app (reader + reporter mode)
│   └── admin/               ← Phase 4: Next.js newsroom + advertiser dashboard
├── packages/shared/         ← shared types between apps
├── infra/docker-compose.yml ← local Postgres + Redis
└── docs/                    ← this blueprint, setup guide, phase reports
```

## 8. Roadmap (MVP first)

| Phase | Delivers | Status |
|---|---|---|
| **1 Foundation** | Server, database, login, profiles, staff roles, locations, categories, news publishing API, audit log | **Built** |
| **2 Core reader app** | Home feed, categories, article page, location picker, search, bookmarks, Telugu/English | **Built** |
| 3 Media | Photo/video upload, HLS video feed, audio news | Next |
| 4 Editorial | Newsroom web dashboard, journalist portal, citizen submissions, push notifications, grievance/takedown | |
| 5 Intelligence | AI summaries, translation, TTS, recommendations, duplicate detection | |
| 6 Monetization | AdMob, sponsored content, local listings, advertiser dashboard, premium | |
| 7 Production | Security audit, load tests, Play Store + App Store release, monitoring | |

**MVP = Phases 1, 2 and the editorial core of 4.** With those, editors can publish and readers in Anantapur and Sri Sathya Sai can read local news in Telugu.

## 9. Outside services you will need (and when)

| Service | Needed in | What to get |
|---|---|---|
| SMS OTP gateway (MSG91, Twilio or 2Factor) | Before launch | API key + **DLT-registered** sender ID and template (TRAI rule in India) |
| Google Cloud / Firebase project | Phase 2 | Google login, FCM, TTS |
| Apple Developer account (₹ ~8,700/yr) | Phase 2 | Apple login + App Store |
| Google Play Console ($25 once) | Phase 7 | Play Store |
| AWS account (Mumbai region) | Phase 3 | S3, CloudFront, MediaConvert |
| LLM API key | Phase 5 | Summaries, translation |
| AdMob account | Phase 6 | Ads |

Until a key is provided, each integration runs in a safe **"console" mode** (for example, OTPs are printed in the server log during development) and the code is ready to switch on.

## 10. Legal checklist (to confirm with a lawyer)

* **IT Rules 2021, Part III**: digital news publishers must follow the Code of Ethics, have a grievance officer and respond within set times, and furnish details to the Ministry of Information & Broadcasting.
* **DPDP Act 2023**: consent notice, account deletion, data export, limited data retention.
* **Copyright**: publish only owned or licensed text, photos and video.
* Citizen reports are always labelled "Citizen report – not independently verified" until an editor verifies them.
