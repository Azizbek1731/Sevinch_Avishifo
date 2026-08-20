import type { AuthUser } from '@avishifo/shared';

/**
 * Whether this caller keeps seeing what the front desk removed.
 *
 * The desk that made a mistake stops seeing it; management still does. That
 * asymmetry is the whole point of withdrawing a row rather than deleting it, so
 * the rule lives in one place — a second copy that drifted would quietly hand
 * someone the ability to erase their own corrections.
 */
export function canSeeDeleted(user?: AuthUser): boolean {
  return user?.permissions.includes('records.viewDeleted') === true;
}
