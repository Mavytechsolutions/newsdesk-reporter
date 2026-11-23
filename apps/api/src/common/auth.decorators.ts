import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '../db/schema';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Endpoint can be called without logging in (a token is still read if present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Only these roles may call the endpoint. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const STAFF_ROLES: Role[] = [
  'SUPER_ADMIN', 'MANAGING_EDITOR', 'DISTRICT_EDITOR', 'SUB_EDITOR',
  'REPORTER', 'VIDEO_JOURNALIST', 'MARKETING_MANAGER',
];

export interface AuthUser {
  id: string;
  role: Role | 'GUEST';
  guest: boolean;
  /** logged in with phone OTP (reader session) */
  otp?: boolean;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest().user;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
});
