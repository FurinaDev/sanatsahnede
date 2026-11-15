import { Router } from 'express';
import { DbInstance } from '../db/database';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import {
  getFollowSummary,
  getUserRelationshipsDetail,
  getUserSocialGraphState,
  isBlockedBetween,
  resolveUserProfileLink,
} from '../services/socialGraphService';
import { notifyUser } from '../services/notificationService';
import { logAudit } from '../services/auditService';

export function createSocialRouter(db: DbInstance): Router {
  const router = Router();

  router.get('/me', requireAuth, (req: AuthedRequest, res) => {
    const graph = getUserSocialGraphState(db, req.user!.id);
    return res.json(graph);
  });

  router.get('/relationships', requireAuth, (req: AuthedRequest, res) => {
    return res.json(getUserRelationshipsDetail(db, req.user!.id));
  });

  router.get('/profile/:targetUserId', (req: AuthedRequest, res) => {
    const targetUserId = String(req.params.targetUserId || '').trim();
    const targetUser = db.prepare('SELECT id, first_name, last_name, avatar_url, active_role FROM users WHERE id = ?').get(targetUserId) as any;
    if (!targetUser) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }

    const viewerId = req.user?.id || null;
    const summary = getFollowSummary(db, targetUserId, viewerId);

    if (summary.isBlocked) {
      return res.json({
        summary,
        blocked: true,
        followers: [],
        following: [],
      });
    }

    const followers = db
      .prepare(
        `SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.active_role
         FROM follows f
         JOIN users u ON u.id = f.follower_user_id
         WHERE f.following_user_id = ?
         ORDER BY f.created_at DESC
         LIMIT 50`
      )
      .all(targetUserId)
      .map((u: any) => ({
        userId: u.id,
        fullName: `${u.first_name} ${u.last_name}`.trim(),
        avatarUrl: u.avatar_url,
        activeRole: u.active_role,
      }));

    const following = db
      .prepare(
        `SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.active_role
         FROM follows f
         JOIN users u ON u.id = f.following_user_id
         WHERE f.follower_user_id = ?
         ORDER BY f.created_at DESC
         LIMIT 50`
      )
      .all(targetUserId)
      .map((u: any) => ({
        userId: u.id,
        fullName: `${u.first_name} ${u.last_name}`.trim(),
        avatarUrl: u.avatar_url,
        activeRole: u.active_role,
      }));

    return res.json({
      summary,
      blocked: false,
      followers,
      following,
    });
  });

  router.post('/follow/:targetUserId', requireAuth, (req: AuthedRequest, res) => {
    const targetUserId = String(req.params.targetUserId || '').trim();
    if (!targetUserId || targetUserId === req.user!.id) {
      return res.status(400).json({ error: 'Kendinizi takip edemezsiniz.' });
    }

    const target = db.prepare('SELECT id, first_name, last_name FROM users WHERE id = ?').get(targetUserId) as any;
    if (!target) {
      return res.status(404).json({ error: 'Takip edilecek kullanıcı bulunamadı.' });
    }

    if (isBlockedBetween(db, req.user!.id, targetUserId)) {
      return res.status(403).json({ error: 'Engelleme durumu nedeniyle bu kullanıcıyı takip edemezsiniz.' });
    }

    const existing = db
      .prepare('SELECT 1 FROM follows WHERE follower_user_id = ? AND following_user_id = ?')
      .get(req.user!.id, targetUserId);

    if (!existing) {
      db.prepare('INSERT INTO follows (follower_user_id, following_user_id, created_at) VALUES (?, ?, ?)').run(
        req.user!.id,
        targetUserId,
        new Date().toISOString()
      );
      const actorName = `${req.user!.firstName} ${req.user!.lastName}`.trim();
      const actorLink = resolveUserProfileLink(db, req.user!.id);
      notifyUser(db, {
        userId: targetUserId,
        type: 'new_follower',
        title: 'Yeni Takipçi',
        body: `${actorName} sizi takip etmeye başladı.`,
        linkView: actorLink.profileView || 'feed',
        linkEntityId: actorLink.profileEntityId,
      });
    }

    return res.status(201).json({
      following: true,
      summary: getFollowSummary(db, targetUserId, req.user!.id),
    });
  });

  router.delete('/follow/:targetUserId', requireAuth, (req: AuthedRequest, res) => {
    const targetUserId = String(req.params.targetUserId || '').trim();
    db.prepare('DELETE FROM follows WHERE follower_user_id = ? AND following_user_id = ?').run(
      req.user!.id,
      targetUserId
    );
    return res.json({
      following: false,
      summary: getFollowSummary(db, targetUserId, req.user!.id),
    });
  });

  router.post('/block/:targetUserId', requireAuth, (req: AuthedRequest, res) => {
    const targetUserId = String(req.params.targetUserId || '').trim();
    if (!targetUserId || targetUserId === req.user!.id) {
      return res.status(400).json({ error: 'Kendinizi engelleyemezsiniz.' });
    }

    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
    if (!target) {
      return res.status(404).json({ error: 'Engellenecek kullanıcı bulunamadı.' });
    }

    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT OR REPLACE INTO user_blocks (blocker_user_id, blocked_user_id, reason, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(req.user!.id, targetUserId, reason, now);

      // Sever follow relationships in both directions immediately upon blocking
      db.prepare(
        `DELETE FROM follows
         WHERE (follower_user_id = ? AND following_user_id = ?)
            OR (follower_user_id = ? AND following_user_id = ?)`
      ).run(req.user!.id, targetUserId, targetUserId, req.user!.id);
    });
    tx();

    logAudit(db, {
      userId: req.user!.id,
      action: 'BLOCK_USER',
      resourceType: 'user',
      resourceId: targetUserId,
    });

    return res.status(201).json({
      blocked: true,
      summary: getFollowSummary(db, targetUserId, req.user!.id),
    });
  });

  router.delete('/block/:targetUserId', requireAuth, (req: AuthedRequest, res) => {
    const targetUserId = String(req.params.targetUserId || '').trim();
    db.prepare('DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?').run(
      req.user!.id,
      targetUserId
    );
    logAudit(db, {
      userId: req.user!.id,
      action: 'UNBLOCK_USER',
      resourceType: 'user',
      resourceId: targetUserId,
    });
    return res.json({
      blocked: false,
      summary: getFollowSummary(db, targetUserId, req.user!.id),
    });
  });

  router.post('/mute/:targetUserId', requireAuth, (req: AuthedRequest, res) => {
    const targetUserId = String(req.params.targetUserId || '').trim();
    if (!targetUserId || targetUserId === req.user!.id) {
      return res.status(400).json({ error: 'Kendinizi sessize alamazsınız.' });
    }
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
    if (!target) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }

    db.prepare(
      `INSERT OR IGNORE INTO user_mutes (muter_user_id, muted_user_id, created_at)
       VALUES (?, ?, ?)`
    ).run(req.user!.id, targetUserId, new Date().toISOString());

    return res.status(201).json({
      muted: true,
      summary: getFollowSummary(db, targetUserId, req.user!.id),
    });
  });

  router.delete('/mute/:targetUserId', requireAuth, (req: AuthedRequest, res) => {
    const targetUserId = String(req.params.targetUserId || '').trim();
    db.prepare('DELETE FROM user_mutes WHERE muter_user_id = ? AND muted_user_id = ?').run(
      req.user!.id,
      targetUserId
    );
    return res.json({
      muted: false,
      summary: getFollowSummary(db, targetUserId, req.user!.id),
    });
  });

  return router;
}
