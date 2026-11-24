/**
 * Citizen journalist levels and points.
 *  Junior Journalist   0–99 approved posts   5 points per approved post
 *  Journalist          100–499               10 points
 *  Senior Journalist   500+ (badge)          20 points
 * A post counts when it is published. If the story is later taken down, its points and count are taken back.
 */
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { pointEvents, users, ContributorLevel } from '../db/schema';

export const LEVELS: { level: ContributorLevel; from: number; points: number; te: string; en: string }[] = [
  { level: 'JUNIOR', from: 0, points: 5, te: 'జూనియర్ జర్నలిస్ట్', en: 'Junior Journalist' },
  { level: 'JOURNALIST', from: 100, points: 10, te: 'జర్నలిస్ట్', en: 'Journalist' },
  { level: 'SENIOR', from: 500, points: 20, te: 'సీనియర్ జర్నలిస్ట్', en: 'Senior Journalist' },
];

export function levelFor(approvedPosts: number): ContributorLevel {
  return [...LEVELS].reverse().find((l) => approvedPosts >= l.from)!.level;
}
export const pointsFor = (level: ContributorLevel) => LEVELS.find((l) => l.level === level)!.points;

/** Next level target, e.g. { level: 'JOURNALIST', at: 100, remaining: 37 } — null for seniors. */
export function nextLevel(approvedPosts: number) {
  const n = LEVELS.find((l) => l.from > approvedPosts);
  return n ? { level: n.level, at: n.from, remaining: n.from - approvedPosts } : null;
}

/** Called inside the publish transaction. Does nothing for staff stories or if already counted. */
export async function awardForPublish(tx: Db, articleId: string, authorId: string) {
  const [u] = await tx.select({ level: users.contributorLevel, n: users.approvedPosts }).from(users).where(eq(users.id, authorId)).for('update');
  if (!u?.level) return null;
  const level = u.level;
  const points = pointsFor(level);
  const ins = await tx.insert(pointEvents).values({ articleId, userId: authorId, points, level }).onConflictDoNothing().returning();
  if (!ins.length) return null;
  const n = u.n + 1;
  await tx.update(users).set({ approvedPosts: n, points: sql`${users.points} + ${points}`, contributorLevel: levelFor(n), updatedAt: new Date() }).where(eq(users.id, authorId));
  return { points, level: levelFor(n), promoted: levelFor(n) !== level };
}

/** Story taken down: give back what it earned. */
export async function revokeForTakedown(tx: Db, articleId: string) {
  const [ev] = await tx.delete(pointEvents).where(eq(pointEvents.articleId, articleId)).returning();
  if (!ev) return null;
  const [u] = await tx.select({ n: users.approvedPosts }).from(users).where(eq(users.id, ev.userId)).for('update');
  const n = Math.max(0, u.n - 1);
  await tx.update(users).set({ approvedPosts: n, points: sql`greatest(${users.points} - ${ev.points}, 0)`, contributorLevel: levelFor(n), updatedAt: new Date() }).where(eq(users.id, ev.userId));
  return ev;
}
