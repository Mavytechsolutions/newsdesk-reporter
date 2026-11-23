import type { ArticleStatus, Role } from '../db/schema';

/**
 * The editorial rulebook. Every status change goes through here.
 * `scoped: true` means the actor must be assigned to every district/area of the article
 * (Managing Editor and Super Admin are never scoped).
 */
export type WorkflowAction =
  | 'submit' | 'start_review' | 'request_changes' | 'approve' | 'reject'
  | 'publish' | 'unschedule' | 'archive' | 'reopen';

interface Rule {
  from: ArticleStatus[];
  to: ArticleStatus;
  roles: Role[];
  authorOnly?: boolean;
  scoped?: boolean;
  noteRequired?: boolean;
}

const EDITORS: Role[] = ['SUB_EDITOR', 'DISTRICT_EDITOR', 'MANAGING_EDITOR', 'SUPER_ADMIN'];
const APPROVERS: Role[] = ['DISTRICT_EDITOR', 'MANAGING_EDITOR', 'SUPER_ADMIN'];
const PUBLISHERS: Role[] = ['DISTRICT_EDITOR', 'MANAGING_EDITOR', 'SUPER_ADMIN'];
const AUTHORS: Role[] = ['REPORTER', 'VIDEO_JOURNALIST', ...EDITORS];

export const WORKFLOW: Record<WorkflowAction, Rule> = {
  submit:          { from: ['DRAFT', 'CHANGES_REQUESTED'], to: 'SUBMITTED', roles: AUTHORS, authorOnly: true },
  start_review:    { from: ['SUBMITTED'], to: 'IN_REVIEW', roles: EDITORS, scoped: true },
  request_changes: { from: ['SUBMITTED', 'IN_REVIEW', 'APPROVED'], to: 'CHANGES_REQUESTED', roles: EDITORS, scoped: true, noteRequired: true },
  approve:         { from: ['IN_REVIEW'], to: 'APPROVED', roles: APPROVERS, scoped: true },
  reject:          { from: ['SUBMITTED', 'IN_REVIEW'], to: 'REJECTED', roles: APPROVERS, scoped: true, noteRequired: true },
  publish:         { from: ['APPROVED'], to: 'PUBLISHED', roles: PUBLISHERS, scoped: true }, // → SCHEDULED if scheduledAt is in the future
  unschedule:      { from: ['SCHEDULED'], to: 'APPROVED', roles: PUBLISHERS, scoped: true },
  archive:         { from: ['PUBLISHED'], to: 'ARCHIVED', roles: ['MANAGING_EDITOR', 'SUPER_ADMIN'], noteRequired: true }, // takedown
  reopen:          { from: ['REJECTED', 'ARCHIVED'], to: 'DRAFT', roles: ['MANAGING_EDITOR', 'SUPER_ADMIN'], noteRequired: true },
};

export const UNSCOPED_ROLES: Role[] = ['MANAGING_EDITOR', 'SUPER_ADMIN'];

/** Who may edit content in each status (author = the article's own reporter). */
export function canEdit(status: ArticleStatus, role: Role, isAuthor: boolean): boolean {
  if (status === 'DRAFT' || status === 'CHANGES_REQUESTED') return isAuthor || EDITORS.includes(role);
  if (['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'SCHEDULED'].includes(status)) return EDITORS.includes(role);
  if (status === 'PUBLISHED') return APPROVERS.includes(role); // corrections, always audit-logged
  return false;
}
