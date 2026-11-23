// MAVY NEWS — Phase 1 database schema (Drizzle ORM, PostgreSQL)
import {
  pgTable, pgEnum, uuid, text, boolean, timestamp, integer, jsonb,
  primaryKey, index, foreignKey,
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

export type Role = (typeof roleEnum.enumValues)[number];
export type ArticleStatus = (typeof articleStatusEnum.enumValues)[number];
export type Language = (typeof languageEnum.enumValues)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').unique(),
  email: text('email').unique(),
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
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ userIdx: index('refresh_user_idx').on(t.userId) }));

export const otpRequests = pgTable('otp_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
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
