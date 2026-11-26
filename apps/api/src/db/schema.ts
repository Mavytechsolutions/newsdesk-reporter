// MAVY NEWS — Phase 1 database schema (Drizzle ORM, PostgreSQL)
import {
  pgTable, pgEnum, uuid, text, boolean, timestamp, integer, jsonb,
  primaryKey, index, uniqueIndex, foreignKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const languageEnum = pgEnum('language', ['te', 'en']);
export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'DELETED']);
export const roleEnum = pgEnum('role', [
  'READER', 'SUPER_ADMIN', 'MANAGING_EDITOR', 'DISTRICT_EDITOR', 'SUB_EDITOR',
  'REPORTER', 'VIDEO_JOURNALIST', 'MARKETING_MANAGER',
]);
export const locationTypeEnum = pgEnum('location_type', [
  'STATE', 'DISTRICT', 'PARLIAMENTARY_CONSTITUENCY', 'ASSEMBLY_CONSTITUENCY',
  'MUNICIPALITY', 'MANDAL', 'VILLAGE', 'WARD',
]);
export const articleStatusEnum = pgEnum('article_status', [
  'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED',
  'SCHEDULED', 'PUBLISHED', 'REJECTED', 'ARCHIVED',
]);
export const commentStatusEnum = pgEnum('comment_status', ['VISIBLE', 'HIDDEN']);
export const reportReasonEnum = pgEnum('report_reason', ['FAKE', 'WRONG_INFO', 'OFFENSIVE', 'COPYRIGHT', 'PRIVACY', 'OTHER']);
export const reportStatusEnum = pgEnum('report_status', ['OPEN', 'RESOLVED', 'REJECTED']);
export const sourceTypeEnum = pgEnum('source_type', ['STAFF', 'CITIZEN', 'AGENCY', 'AI_ASSISTED']);
/** Citizen journalist levels: Junior (0–99 approved posts) → Journalist (100+) → Senior (500+, badge). */
export const contributorLevelEnum = pgEnum('contributor_level', ['JUNIOR', 'JOURNALIST', 'SENIOR']);
export const applicationStatusEnum = pgEnum('application_status', ['PENDING', 'APPROVED', 'REJECTED']);

export type Role = (typeof roleEnum.enumValues)[number];
export type ArticleStatus = (typeof articleStatusEnum.enumValues)[number];
export type Language = (typeof languageEnum.enumValues)[number];
export type ContributorLevel = (typeof contributorLevelEnum.enumValues)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').unique(),
  email: text('email').unique(),
  /** short login name for staff, e.g. "admin" (email also works) */
  username: text('username').unique(),
  /** staff: mobile number that receives the OTP to change / reset the password */
  recoveryPhone: text('recovery_phone'),
  passwordHash: text('password_hash'),
  googleId: text('google_id').unique(),
  appleId: text('apple_id').unique(),
  name: text('name'),
  photoUrl: text('photo_url'),
  language: languageEnum('language').notNull().default('te'),
  role: roleEnum('role').notNull().default('READER'),
  status: userStatusEnum('status').notNull().default('ACTIVE'),
  notifyBreaking: boolean('notify_breaking').notNull().default(true),
  notifyDistrict: boolean('notify_district').notNull().default(true),
  /** Set when the person is an approved citizen journalist (posts from the app, reviewed by editors). */
  contributorLevel: contributorLevelEnum('contributor_level'),
  contributorSince: ts('contributor_since'),
  contributorSuspendedAt: ts('contributor_suspended_at'),
  points: integer('points').notNull().default(0),
  approvedPosts: integer('approved_posts').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
});

export const staffProfiles = pgTable('staff_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  designation: text('designation'),
  verified: boolean('verified').notNull().default(false),
  suspendedAt: ts('suspended_at'),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: locationTypeEnum('type').notNull(),
  nameEn: text('name_en').notNull(),
  nameTe: text('name_te').notNull(),
  slug: text('slug').notNull().unique(),
  parentId: uuid('parent_id'),
  /** Materialised ancestor path, e.g. "/<stateId>/<districtId>/<ownId>/" */
  path: text('path').notNull(),
}, (t) => ({
  parentIdx: index('locations_parent_idx').on(t.parentId),
  pathIdx: index('locations_path_idx').on(t.path),
  typeIdx: index('locations_type_idx').on(t.type),
  parentFk: foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: 'locations_parent_fk' }),
}));

export const staffAssignments = pgTable('staff_assignments', {
  staffId: uuid('staff_id').notNull().references(() => staffProfiles.userId, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: primaryKey({ columns: [t.staffId, t.locationId] }) }));

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  /** How the person logged in: 'otp' (phone) or 'pwd' (newsroom email + password). OTP sessions never get newsroom powers. */
  method: text('method').notNull().default('pwd'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ userIdx: index('refresh_user_idx').on(t.userId) }));

export const otpRequests = pgTable('otp_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  /** 'login' (phone login) or 'pwd_reset' (staff password change). Kept apart so one can never be used for the other. */
  purpose: text('purpose').notNull().default('login'),
  consumed: boolean('consumed').notNull().default(false),
  expiresAt: ts('expires_at').notNull(),
  ip: text('ip'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ phoneIdx: index('otp_phone_idx').on(t.phone, t.createdAt) }));

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameTe: text('name_te').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  /** Computed tabs (For You, Breaking, Local) — never assigned to articles */
  isVirtual: boolean('is_virtual').notNull().default(false),
});

export const userLocations = pgTable('user_locations', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  isPrimary: boolean('is_primary').notNull().default(false),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.locationId] }) }));

export const userCategories = pgTable('user_categories', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.categoryId] }) }));

export const articles = pgTable('articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  status: articleStatusEnum('status').notNull().default('DRAFT'),
  isBreaking: boolean('is_breaking').notNull().default(false),
  isFeatured: boolean('is_featured').notNull().default(false),
  sourceType: sourceTypeEnum('source_type').notNull().default('STAFF'),
  sourceName: text('source_name'),
  heroImageUrl: text('hero_image_url'),
  heroImageCredit: text('hero_image_credit'),
  authorId: uuid('author_id').notNull().references(() => users.id),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  scheduledAt: ts('scheduled_at'),
  publishedAt: ts('published_at'),
  viewCount: integer('view_count').notNull().default(0),
  likeCount: integer('like_count').notNull().default(0),
  shareCount: integer('share_count').notNull().default(0),
  dislikeCount: integer('dislike_count').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  statusPubIdx: index('articles_status_pub_idx').on(t.status, t.publishedAt),
  catIdx: index('articles_cat_idx').on(t.categoryId, t.status, t.publishedAt),
  breakingIdx: index('articles_breaking_idx').on(t.isBreaking, t.publishedAt),
}));

export const articleTranslations = pgTable('article_translations', {
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  language: languageEnum('language').notNull(),
  headline: text('headline').notNull(),
  summary: text('summary').notNull(),
  body: text('body').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.articleId, t.language] }) }));

export const articleLocations = pgTable('article_locations', {
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.articleId, t.locationId] }),
  locIdx: index('article_locations_loc_idx').on(t.locationId),
}));

export const articleTags = pgTable('article_tags', {
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.articleId, t.tag] }),
  tagIdx: index('article_tags_tag_idx').on(t.tag),
}));

export const articleStatusHistory = pgTable('article_status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  fromStatus: articleStatusEnum('from_status').notNull(),
  toStatus: articleStatusEnum('to_status').notNull(),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ artIdx: index('ash_article_idx').on(t.articleId) }));

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  metadata: jsonb('metadata'),
  ip: text('ip'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({
  entityIdx: index('audit_entity_idx').on(t.entity, t.entityId),
  createdIdx: index('audit_created_idx').on(t.createdAt),
}));

export const bookmarks = pgTable('bookmarks', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.articleId] }), userIdx: index('bookmarks_user_idx').on(t.userId, t.createdAt) }));

export const likes = pgTable('likes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.articleId] }) }));

/** Reading history (one row per user+article, updated on re-read). */
export const readEvents = pgTable('read_events', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  readAt: ts('read_at').notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.articleId] }), userIdx: index('read_user_idx').on(t.userId, t.readAt) }));

export const dislikes = pgTable('dislikes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.articleId] }) }));

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  status: commentStatusEnum('status').notNull().default('VISIBLE'),
  hiddenBy: uuid('hidden_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ artIdx: index('comments_article_idx').on(t.articleId, t.createdAt), userIdx: index('comments_user_idx').on(t.userId) }));

/** Reader complaints about a story (IT Rules grievance channel). */
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  reason: reportReasonEnum('reason').notNull(),
  note: text('note'),
  status: reportStatusEnum('status').notNull().default('OPEN'),
  resolution: text('resolution'),
  handledBy: uuid('handled_by'),
  ip: text('ip'),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
}, (t) => ({ statusIdx: index('reports_status_idx').on(t.status, t.createdAt) }));

/** "Become a journalist" requests from the app. The Aadhaar photo is private and deleted once a decision is made. */
export const journalistApplications = pgTable('journalist_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone'),
  /** Where the person will report from (district or mandal). Decides which sub-admin reviews the request. */
  locationId: uuid('location_id').notNull().references(() => locations.id),
  aadhaarFile: text('aadhaar_file'),
  status: applicationStatusEnum('status').notNull().default('PENDING'),
  note: text('note'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ statusIdx: index('ja_status_idx').on(t.status, t.createdAt), userIdx: index('ja_user_idx').on(t.userId) }));

/** One row per approved (published) story of a citizen journalist. */
export const pointEvents = pgTable('point_events', {
  articleId: uuid('article_id').primaryKey().references(() => articles.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  points: integer('points').notNull(),
  level: contributorLevelEnum('level').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ userIdx: index('pe_user_idx').on(t.userId, t.createdAt) }));

// ---- relations (used by query builder) ----
export const articlesRelations = relations(articles, ({ many, one }) => ({
  translations: many(articleTranslations),
  locations: many(articleLocations),
  tags: many(articleTags),
  category: one(categories, { fields: [articles.categoryId], references: [categories.id] }),
  author: one(users, { fields: [articles.authorId], references: [users.id] }),
}));
export const articleTranslationsRelations = relations(articleTranslations, ({ one }) => ({
  article: one(articles, { fields: [articleTranslations.articleId], references: [articles.id] }),
}));
export const articleLocationsRelations = relations(articleLocations, ({ one }) => ({
  article: one(articles, { fields: [articleLocations.articleId], references: [articles.id] }),
  location: one(locations, { fields: [articleLocations.locationId], references: [locations.id] }),
}));
export const articleTagsRelations = relations(articleTags, ({ one }) => ({
  article: one(articles, { fields: [articleTags.articleId], references: [articles.id] }),
}));
export const usersRelations = relations(users, ({ many, one }) => ({
  locations: many(userLocations),
  categories: many(userCategories),
  staff: one(staffProfiles, { fields: [users.id], references: [staffProfiles.userId] }),
}));
export const staffProfilesRelations = relations(staffProfiles, ({ many, one }) => ({
  user: one(users, { fields: [staffProfiles.userId], references: [users.id] }),
  assignments: many(staffAssignments),
}));
export const staffAssignmentsRelations = relations(staffAssignments, ({ one }) => ({
  staff: one(staffProfiles, { fields: [staffAssignments.staffId], references: [staffProfiles.userId] }),
  location: one(locations, { fields: [staffAssignments.locationId], references: [locations.id] }),
}));
export const userLocationsRelations = relations(userLocations, ({ one }) => ({
  user: one(users, { fields: [userLocations.userId], references: [users.id] }),
  location: one(locations, { fields: [userLocations.locationId], references: [locations.id] }),
}));
export const userCategoriesRelations = relations(userCategories, ({ one }) => ({
  user: one(users, { fields: [userCategories.userId], references: [users.id] }),
  category: one(categories, { fields: [userCategories.categoryId], references: [categories.id] }),
}));
export const categoriesRelations = relations(categories, ({ many }) => ({
  articles: many(articles),
}));

// ---------- Auto News (Step 1: settings + sources) ----------
export const autoNewsSourceKindEnum = pgEnum('auto_news_source_kind', ['PRESS_RELEASE', 'OFFICIAL_ALERT', 'RSS', 'TIP_ONLY']);

/** One row only (id = 1). Auto News stays OFF and in test mode until the Super Admin changes it. */
export const autoNewsSettings = pgTable('auto_news_settings', {
  id: integer('id').primaryKey().default(1),
  enabled: boolean('enabled').notNull().default(false),
  testMode: boolean('test_mode').notNull().default(true),
  intervalMinutes: integer('interval_minutes').notNull().default(30),
  /** Old US-cents limit, no longer used (kept so old data stays valid). */
  dailyCostLimitCents: integer('daily_cost_limit_cents').notNull().default(150),
  /** Daily Claude spending limit in rupees. When today's estimated cost reaches it, Auto News stops until midnight (India time). */
  dailyCostLimitInr: integer('daily_cost_limit_inr').notNull().default(100),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const autoNewsSources = pgTable('auto_news_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull().unique(),
  kind: autoNewsSourceKindEnum('kind').notNull().default('PRESS_RELEASE'),
  enabled: boolean('enabled').notNull().default(true),
  /** Publish without approval. OFF unless the Super Admin turns it on, and only allowed for official alerts. */
  autoPublish: boolean('auto_publish').notNull().default(false),
  /** Photos from this source may be used (government sources only). */
  photosAllowed: boolean('photos_allowed').notNull().default(false),
  note: text('note'),
  lastCheckedAt: ts('last_checked_at'),
  lastError: text('last_error'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ---------- Auto News (Step 2: collected items + check log) ----------
/** NEW = waiting to be written by Claude · DUPLICATE = same news already collected · TIP = other channel, headline + link only
 *  SKIPPED = not for us (old, other state …) */
export const autoNewsItemStatusEnum = pgEnum('auto_news_item_status', ['NEW', 'DUPLICATE', 'TIP', 'SKIPPED']);

export const autoNewsItems = pgTable('auto_news_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => autoNewsSources.id, { onDelete: 'set null' }),
  sourceName: text('source_name').notNull(),
  externalId: text('external_id').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  /** Short text from the source (empty for tip-only sources: we never keep other outlets' text). */
  summary: text('summary'),
  /** Alert details (event, severity, area, expires, Telugu/English headline) for official alerts. */
  details: jsonb('details'),
  area: text('area'),
  language: text('language'),
  publishedAt: ts('published_at'),
  fingerprint: text('fingerprint').notNull(),
  status: autoNewsItemStatusEnum('status').notNull().default('NEW'),
  duplicateOf: uuid('duplicate_of'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({
  srcExtIdx: uniqueIndex('auto_news_items_source_ext_idx').on(t.sourceId, t.externalId),
  fpIdx: index('auto_news_items_fp_idx').on(t.fingerprint, t.createdAt),
  createdIdx: index('auto_news_items_created_idx').on(t.createdAt),
}));

/** One row per source per check: what was found, what was new, and any error. */
export const autoNewsRuns = pgTable('auto_news_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => autoNewsSources.id, { onDelete: 'set null' }),
  sourceName: text('source_name').notNull(),
  trigger: text('trigger').notNull().default('schedule'),
  found: integer('found').notNull().default(0),
  added: integer('added').notNull().default(0),
  duplicates: integer('duplicates').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  error: text('error'),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
}, (t) => ({ startedIdx: index('auto_news_runs_started_idx').on(t.startedAt) }));

// ---------- Auto News (Step 3: Claude key + post log / cost) ----------
/** Secrets saved from the admin page, encrypted with a key derived from the server's own secret. Never sent to any page or app. */
export const autoNewsSecrets = pgTable('auto_news_secrets', {
  name: text('name').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  last4: text('last4').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** One row per Claude call: where the post came from, what Claude was given, and what it cost. */
export const autoNewsPosts = pgTable('auto_news_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  articleId: uuid('article_id').references(() => articles.id, { onDelete: 'set null' }),
  itemId: uuid('item_id').references(() => autoNewsItems.id, { onDelete: 'set null' }),
  origin: text('origin').notNull(), // 'quick' (pasted by an editor) | 'auto' (from a source)
  sourceKind: text('source_kind').notNull(), // OFFICIAL | REPORTER | UNVERIFIED | ALERT …
  sourceName: text('source_name').notNull(),
  sourceUrl: text('source_url'),
  inputText: text('input_text'),
  photoCount: integer('photo_count').notNull().default(0),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costPaise: integer('cost_paise').notNull().default(0),
  needsVerification: boolean('needs_verification').notNull().default(false),
  notes: text('notes'),
  error: text('error'),
  actorId: uuid('actor_id').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ createdIdx: index('auto_news_posts_created_idx').on(t.createdAt) }));
