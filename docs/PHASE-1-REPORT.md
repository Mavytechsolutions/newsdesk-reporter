# Phase 1 Report: Foundation

**Status:** Complete and tested (27 automated end-to-end tests passing against a real PostgreSQL database).

## Completed features

* **Reader login** by phone OTP (+91 numbers only). OTPs are hashed, expire in 5 minutes, have a limit of 5 per phone per hour and 5 wrong attempts, and IP throttling.
* **Guest browsing** token: guests can read news but cannot use profile features.
* **Tokens:** 15-minute access tokens, 30-day refresh tokens that rotate (old ones stop working), and logout.
* **Reader profile:** name, photo, Telugu/English, notification switches, multiple preferred locations with one primary, followed categories.
* **Account deletion** (DPDP): personal data is erased, sessions are revoked and the action is logged.
* **Newsroom login** (email + password, bcrypt).
* **7 staff roles**, with district/constituency assignments. Suspend/revoke takes effect **immediately** and role changes apply on the next request.
* **Location tree:** AP → Anantapur & Sri Sathya Sai → Lok Sabha → Assembly → Municipalities → Mandals → Wards (91 places, Telugu + English), with browse, breadcrumb and Telugu/English search.
* **16 category tabs** (For You, Breaking and Local are computed tabs).
* **News publishing API:** Telugu + English versions, tags, breaking/featured flags, source type (staff/agency/citizen/AI-assisted, with reader-facing labels), photo credit required, summary ≤ 100 words.
* **Editorial workflow:** Draft → Submitted → In review → Approved → Published/Scheduled, plus request changes, reject, takedown and reopen. Every rule depends on role and district. Notes are required for rejections and takedowns. Two editors cannot act on the same story at once.
* **Scheduled publishing** runs automatically every 30 seconds.
* **Corrections:** editing a live story requires a correction note, and the old text is kept in the audit log.
* **Public news API:** feed filtered by category, district (including everything inside it) or breaking, with cursor pagination for low-bandwidth paging, an article page with view count, related stories and a share URL.
* **Audit log** of logins, staff changes, every editorial step and account deletions.
* Security: Helmet headers, strict input validation (unknown fields rejected), CORS allow-list, no secrets in code, production refuses weak keys and console SMS.

## Files created

```
docs/ARCHITECTURE.md  docs/SETUP-GUIDE.md  docs/PHASE-1-REPORT.md
infra/docker-compose.yml
apps/api/package.json  tsconfig*.json  drizzle.config.ts  .env.example
apps/api/drizzle/0000_init.sql                   ← database migration
apps/api/src/main.ts  app.module.ts  config.ts
apps/api/src/db/{schema,db.module,migrate,seed}.ts
apps/api/src/common/{auth.decorators,auth.guard,text}.ts
apps/api/src/auth/{auth.module,auth.service}.ts  auth/sms/sms.provider.ts
apps/api/src/{users,staff,locations,categories,audit}/*.module.ts
apps/api/src/articles/{articles.module,articles.service,articles.dto,workflow}.ts
apps/api/test/{setup-env.ts,phase1.e2e.test.ts}
```

## Commands

| Purpose | Command (inside `apps/api`) |
|---|---|
| Install | `npm install` |
| Create/update database tables | `npm run db:migrate` |
| Load locations, categories, admin | `npm run db:seed` |
| Run in development | `npm run dev` |
| Build for production | `npm run build`, then `npm start` |
| Tests | `npm test` |
| After changing `schema.ts` | `npm run db:generate` then `npm run db:migrate` |

## Environment variables

See `apps/api/.env.example`. Each one is explained there. For production you must set `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (long random text), `DATABASE_URL`, `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID` (DLT-approved).

## Technical note

The database layer uses **Drizzle ORM** in place of Prisma (both were allowed by the plan). Drizzle runs fully in Node.js with no extra engine downloads and produces plain SQL migration files.

## Remaining / next

* **Google & Apple login:** the endpoints exist and return "coming in Phase 2". They need a Google OAuth client ID and an Apple Developer account.
* **Real SMS:** the MSG91 provider is written and needs a DLT-registered template.
* **Location data:** verify the mandal list and add villages and wards with the newsroom before launch.
* **Phase 2:** personalised "For You" and Local feeds, search, bookmarks/likes and the Expo reader app (to start only when you say so).
* Redis caching of the public feed will be added in Phase 2 when the feed endpoints are built.
