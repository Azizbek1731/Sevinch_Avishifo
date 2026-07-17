import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { ErrorCode, type AuthUser, type Permission } from '@avishifo/shared';
import type { Request } from 'express';
import { AppException } from './app.exception';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skip JWT auth for this handler/controller. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** All listed permissions are required (AND). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export interface RequestWithUser extends Request {
  user?: AuthUser;
}

/** Injects the authenticated AuthUser. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!req.user) {
    throw new AppException(ErrorCode.UNAUTHORIZED, 'Not authenticated', 401);
  }
  return req.user;
});

/**
 * Injects the active branch id from the `x-branch-id` header.
 * Users with explicit branch assignments may only act within them.
 */
export const ActiveBranch = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<RequestWithUser>();
  const branchId = req.headers['x-branch-id'];
  if (!branchId || typeof branchId !== 'string') {
    throw new AppException(ErrorCode.VALIDATION_ERROR, 'x-branch-id header is required', 400);
  }
  const user = req.user;
  if (user && user.branchIds.length > 0 && !user.branchIds.includes(branchId)) {
    throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
  }
  return branchId;
});
