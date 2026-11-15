import { DbInstance } from '../db/database';

export interface SocialProfileSummary {
  targetUserId: string;
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
  isFollowedBy: boolean;
  isBlocked: boolean;
  blockedByMe: boolean;
  isMuted: boolean;
}

export interface UserSocialGraphState {
  followingUserIds: string[];
  followerUserIds: string[];
  blockedByMeIds: string[];
  blockedUserIds: string[];
  mutedUserIds: string[];
  followerCounts: Record<string, number>;
  followingCounts: Record<string, number>;
}

export function isBlockedBetween(db: DbInstance, userA?: string | null, userB?: string | null): boolean {
  if (!userA || !userB || userA === userB) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_user_id = ? AND blocked_user_id = ?)
          OR (blocker_user_id = ? AND blocked_user_id = ?)
       LIMIT 1`
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

export function getMutualBlockedUserIds(db: DbInstance, userId?: string | null): Set<string> {
  if (!userId) return new Set();
  const rows = db
    .prepare(
      `SELECT blocker_user_id, blocked_user_id FROM user_blocks
       WHERE blocker_user_id = ? OR blocked_user_id = ?`
    )
    .all(userId, userId) as Array<{ blocker_user_id: string; blocked_user_id: string }>;
  const blocked = new Set<string>();
  for (const r of rows) {
    if (r.blocker_user_id !== userId) blocked.add(r.blocker_user_id);
    if (r.blocked_user_id !== userId) blocked.add(r.blocked_user_id);
  }
  return blocked;
}

export function getBlockedByMeIds(db: DbInstance, userId?: string | null): Set<string> {
  if (!userId) return new Set();
  const rows = db
    .prepare('SELECT blocked_user_id FROM user_blocks WHERE blocker_user_id = ?')
    .all(userId) as Array<{ blocked_user_id: string }>;
  return new Set(rows.map((r) => r.blocked_user_id));
}

export function getMutedUserIds(db: DbInstance, userId?: string | null): Set<string> {
  if (!userId) return new Set();
  const rows = db
    .prepare('SELECT muted_user_id FROM user_mutes WHERE muter_user_id = ?')
    .all(userId) as Array<{ muted_user_id: string }>;
  return new Set(rows.map((r) => r.muted_user_id));
}

export function getFollowCountMaps(db: DbInstance): {
  followerCounts: Record<string, number>;
  followingCounts: Record<string, number>;
} {
  const followerCounts: Record<string, number> = {};
  const followingCounts: Record<string, number> = {};

  for (const row of db
    .prepare('SELECT following_user_id as user_id, COUNT(*) as cnt FROM follows GROUP BY following_user_id')
    .all() as Array<{ user_id: string; cnt: number }>) {
    followerCounts[row.user_id] = Number(row.cnt || 0);
  }

  for (const row of db
    .prepare('SELECT follower_user_id as user_id, COUNT(*) as cnt FROM follows GROUP BY follower_user_id')
    .all() as Array<{ user_id: string; cnt: number }>) {
    followingCounts[row.user_id] = Number(row.cnt || 0);
  }

  return { followerCounts, followingCounts };
}

export function getFollowSummary(
  db: DbInstance,
  targetUserId: string,
  viewerUserId?: string | null
): SocialProfileSummary {
  const followersRow = db
    .prepare('SELECT COUNT(*) as cnt FROM follows WHERE following_user_id = ?')
    .get(targetUserId) as { cnt: number };
  const followingRow = db
    .prepare('SELECT COUNT(*) as cnt FROM follows WHERE follower_user_id = ?')
    .get(targetUserId) as { cnt: number };

  const isFollowing = viewerUserId
    ? Boolean(
        db
          .prepare('SELECT 1 FROM follows WHERE follower_user_id = ? AND following_user_id = ?')
          .get(viewerUserId, targetUserId)
      )
    : false;
  const isFollowedBy = viewerUserId
    ? Boolean(
        db
          .prepare('SELECT 1 FROM follows WHERE follower_user_id = ? AND following_user_id = ?')
          .get(targetUserId, viewerUserId)
      )
    : false;

  const isBlocked = viewerUserId ? isBlockedBetween(db, viewerUserId, targetUserId) : false;
  const blockedByMe = viewerUserId
    ? Boolean(
        db
          .prepare('SELECT 1 FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?')
          .get(viewerUserId, targetUserId)
      )
    : false;
  const isMuted = viewerUserId
    ? Boolean(
        db
          .prepare('SELECT 1 FROM user_mutes WHERE muter_user_id = ? AND muted_user_id = ?')
          .get(viewerUserId, targetUserId)
      )
    : false;

  return {
    targetUserId,
    followersCount: Number(followersRow?.cnt || 0),
    followingCount: Number(followingRow?.cnt || 0),
    isFollowing,
    isFollowedBy,
    isBlocked,
    blockedByMe,
    isMuted,
  };
}

export function getUserSocialGraphState(db: DbInstance, viewerUserId?: string | null): UserSocialGraphState {
  const { followerCounts, followingCounts } = getFollowCountMaps(db);
  if (!viewerUserId) {
    return {
      followingUserIds: [],
      followerUserIds: [],
      blockedByMeIds: [],
      blockedUserIds: [],
      mutedUserIds: [],
      followerCounts,
      followingCounts,
    };
  }

  const followingRows = db
    .prepare('SELECT following_user_id FROM follows WHERE follower_user_id = ?')
    .all(viewerUserId) as Array<{ following_user_id: string }>;
  const followerRows = db
    .prepare('SELECT follower_user_id FROM follows WHERE following_user_id = ?')
    .all(viewerUserId) as Array<{ follower_user_id: string }>;

  return {
    followingUserIds: followingRows.map((r) => r.following_user_id),
    followerUserIds: followerRows.map((r) => r.follower_user_id),
    blockedByMeIds: Array.from(getBlockedByMeIds(db, viewerUserId)),
    blockedUserIds: Array.from(getMutualBlockedUserIds(db, viewerUserId)),
    mutedUserIds: Array.from(getMutedUserIds(db, viewerUserId)),
    followerCounts,
    followingCounts,
  };
}

export function resolveUserProfileLink(
  db: DbInstance,
  userId: string
): { profileView?: string; profileEntityId?: string; subtitle?: string } {
  const artist = db
    .prepare('SELECT id, title FROM individual_profiles WHERE user_id = ? LIMIT 1')
    .get(userId) as { id: string; title?: string } | undefined;
  if (artist) {
    return { profileView: 'artist_profile', profileEntityId: artist.id, subtitle: artist.title || 'Sanatçı' };
  }

  const ensemble = db
    .prepare('SELECT id, ensemble_type FROM ensembles WHERE leader_user_id = ? LIMIT 1')
    .get(userId) as { id: string; ensemble_type?: string } | undefined;
  if (ensemble) {
    return { profileView: 'ensemble_profile', profileEntityId: ensemble.id, subtitle: ensemble.ensemble_type || 'Topluluk' };
  }

  const biz = db
    .prepare('SELECT id, business_type FROM business_profiles WHERE user_id = ? LIMIT 1')
    .get(userId) as { id: string; business_type?: string } | undefined;
  if (biz) {
    return { profileView: 'business_profile', profileEntityId: biz.id, subtitle: biz.business_type || 'İşletme' };
  }

  return {};
}

export function getUserRelationshipsDetail(db: DbInstance, viewerUserId: string) {
  const blockedRows = db
    .prepare(
      `SELECT ub.blocked_user_id, ub.reason, ub.created_at,
              u.first_name, u.last_name, u.avatar_url, u.active_role
       FROM user_blocks ub
       JOIN users u ON u.id = ub.blocked_user_id
       WHERE ub.blocker_user_id = ?
       ORDER BY ub.created_at DESC`
    )
    .all(viewerUserId) as any[];

  const mutedRows = db
    .prepare(
      `SELECT um.muted_user_id, um.created_at,
              u.first_name, u.last_name, u.avatar_url, u.active_role
       FROM user_mutes um
       JOIN users u ON u.id = um.muted_user_id
       WHERE um.muter_user_id = ?
       ORDER BY um.created_at DESC`
    )
    .all(viewerUserId) as any[];

  const blockedUsers = blockedRows.map((r) => {
    const link = resolveUserProfileLink(db, r.blocked_user_id);
    return {
      userId: r.blocked_user_id,
      fullName: `${r.first_name} ${r.last_name}`.trim(),
      avatarUrl: r.avatar_url,
      activeRole: r.active_role,
      subtitle: link.subtitle || '',
      reason: r.reason || '',
      createdAt: r.created_at,
      profileView: link.profileView,
      profileEntityId: link.profileEntityId,
    };
  });

  const mutedUsers = mutedRows.map((r) => {
    const link = resolveUserProfileLink(db, r.muted_user_id);
    return {
      userId: r.muted_user_id,
      fullName: `${r.first_name} ${r.last_name}`.trim(),
      avatarUrl: r.avatar_url,
      activeRole: r.active_role,
      subtitle: link.subtitle || '',
      createdAt: r.created_at,
      profileView: link.profileView,
      profileEntityId: link.profileEntityId,
    };
  });

  return { blockedUsers, mutedUsers };
}
