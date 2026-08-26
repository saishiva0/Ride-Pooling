/**
 * Room strategy (Phase 3.11).
 *
 * Private, user-scoped rooms: `user:{userId}`. Rooms are joined ONLY from the
 * authenticated identity resolved by the auth seam — a client can never join
 * another user's room, and a userId is never accepted from the client as
 * proof of identity.
 */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
