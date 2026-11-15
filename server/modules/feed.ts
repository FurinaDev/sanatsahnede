import { Router } from 'express';
import { DbInstance, parseJson } from '../db/database';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { newId } from '../utils/crypto';
import {
  getMutedUserIds,
  getMutualBlockedUserIds,
  isBlockedBetween,
  resolveUserProfileLink,
} from '../services/socialGraphService';
import { fetchSafeLinkPreview, UnsafeLinkError } from '../services/linkPreviewService';
import { notifyUser } from '../services/notificationService';
import { logAudit } from '../services/auditService';
import {
  ArtDiscipline,
  FeedPost,
  FeedPostComment,
  FeedPostMedia,
  FeedReactionType,
  FeedRepostSummary,
  LinkPreviewData,
} from '../../src/types';

const ALLOWED_REACTIONS = new Set<FeedReactionType>(['applause', 'bravo', 'inspire']);
const ALLOWED_POST_TYPES = new Set(['update', 'stage_call', 'showcase', 'repost', 'note']);

function sanitizeMediaUrl(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('/uploads/') || s.startsWith('/src/assets/')) return s;
  try {
    const parsed = new URL(s);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
  } catch {
    return null;
  }
  return null;
}

function resolveRepostSummary(
  db: DbInstance,
  entityType?: string | null,
  entityId?: string | null
): { summary: FeedRepostSummary | null; ownerUserId?: string | null } {
  if (!entityType || !entityId) return { summary: null };

  if (entityType === 'event') {
    const ev = db
      .prepare('SELECT id, creator_user_id, title, organizer_name, city, event_date, is_free, ticket_price FROM events WHERE id = ?')
      .get(entityId) as any;
    if (!ev) return { summary: null };
    const badge = ev.is_free
      ? 'Ücretsiz'
      : Number(ev.ticket_price || 0) > 0
      ? `₺${Number(ev.ticket_price).toLocaleString('tr-TR')}`
      : 'Etkinlik';
    return {
      ownerUserId: ev.creator_user_id,
      summary: {
        entityType: 'event',
        entityId: ev.id,
        title: ev.title,
        subtitle: ev.organizer_name,
        city: ev.city,
        date: ev.event_date,
        badge,
      },
    };
  }

  if (entityType === 'listing') {
    const l = db
      .prepare(
        `SELECT l.id, l.title, l.business_name, l.city, l.event_date, l.budget_amount, b.user_id as biz_user_id
         FROM listings l
         LEFT JOIN business_profiles b ON b.id = l.business_id
         WHERE l.id = ?`
      )
      .get(entityId) as any;
    if (!l) return { summary: null };
    return {
      ownerUserId: l.biz_user_id,
      summary: {
        entityType: 'listing',
        entityId: l.id,
        title: l.title,
        subtitle: l.business_name,
        city: l.city,
        date: l.event_date,
        badge: `₺${Number(l.budget_amount || 0).toLocaleString('tr-TR')}`,
      },
    };
  }

  if (entityType === 'project') {
    const p = db
      .prepare('SELECT id, owner_user_id, title, owner_name, city, disciplines_json, project_type, status FROM projects WHERE id = ?')
      .get(entityId) as any;
    if (!p) return { summary: null };
    const disciplines = parseJson<string[]>(p.disciplines_json, []);
    return {
      ownerUserId: p.owner_user_id,
      summary: {
        entityType: 'project',
        entityId: p.id,
        title: p.title,
        subtitle: `${p.owner_name} · ${disciplines[0] || p.project_type || 'Proje'}`,
        city: p.city,
        badge: 'Proje Lab',
      },
    };
  }

  if (entityType === 'post') {
    const parent = db
      .prepare('SELECT id, author_user_id, author_name, discipline, body, created_at FROM posts WHERE id = ? AND status = ?')
      .get(entityId, 'published') as any;
    if (!parent) return { summary: null };
    return {
      ownerUserId: parent.author_user_id,
      summary: {
        entityType: 'post',
        entityId: parent.id,
        title: parent.author_name,
        subtitle: String(parent.body || '').slice(0, 140),
        date: String(parent.created_at || '').split('T')[0],
        badge: parent.discipline,
      },
    };
  }

  return { summary: null };
}

function hydratePost(
  db: DbInstance,
  row: any,
  viewerUserId: string | null,
  blockedIds: Set<string>
): FeedPost {
  const mediaRows = db
    .prepare('SELECT * FROM post_media WHERE post_id = ? ORDER BY sort_order ASC')
    .all(row.id) as any[];
  const media: FeedPostMedia[] = mediaRows.map((m) => ({
    id: m.id,
    postId: m.post_id,
    mediaType: (m.media_type || 'image') as FeedPostMedia['mediaType'],
    url: m.url,
    caption: m.caption || undefined,
    sortOrder: Number(m.sort_order || 0),
  }));

  const reactionCounts: Record<FeedReactionType, number> = {
    applause: 0,
    bravo: 0,
    inspire: 0,
  };
  const reactionRows = db
    .prepare('SELECT reaction_type, COUNT(*) as cnt FROM post_reactions WHERE post_id = ? GROUP BY reaction_type')
    .all(row.id) as Array<{ reaction_type: string; cnt: number }>;
  for (const r of reactionRows) {
    if (ALLOWED_REACTIONS.has(r.reaction_type as FeedReactionType)) {
      reactionCounts[r.reaction_type as FeedReactionType] = Number(r.cnt || 0);
    }
  }

  let viewerReaction: FeedReactionType | null = null;
  if (viewerUserId) {
    const vr = db
      .prepare('SELECT reaction_type FROM post_reactions WHERE post_id = ? AND user_id = ?')
      .get(row.id, viewerUserId) as { reaction_type: string } | undefined;
    if (vr && ALLOWED_REACTIONS.has(vr.reaction_type as FeedReactionType)) {
      viewerReaction = vr.reaction_type as FeedReactionType;
    }
  }

  const allComments = db
    .prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC')
    .all(row.id) as any[];
  const visibleComments = allComments.filter((c) => !blockedIds.has(c.author_user_id));

  const comments: FeedPostComment[] = visibleComments.slice(-5).map((c) => {
    const link = resolveUserProfileLink(db, c.author_user_id);
    return {
      id: c.id,
      postId: c.post_id,
      authorUserId: c.author_user_id,
      authorName: c.author_name,
      authorAvatar: c.author_avatar,
      authorProfileView: link.profileView,
      authorProfileEntityId: link.profileEntityId,
      body: c.body,
      createdAt: c.created_at,
    };
  });

  const authorLink = resolveUserProfileLink(db, row.author_user_id);
  const { summary: repostSummary } = resolveRepostSummary(db, row.repost_entity_type, row.repost_entity_id);

  return {
    id: row.id,
    authorUserId: row.author_user_id,
    authorType: row.author_type || 'artist',
    authorEntityId: row.author_entity_id || authorLink.profileEntityId,
    authorProfileView: authorLink.profileView,
    authorName: row.author_name,
    authorAvatar: row.author_avatar,
    authorSubtitle: row.author_subtitle || authorLink.subtitle || '',
    discipline: (row.discipline || 'Müzik') as ArtDiscipline,
    postType: (row.post_type || 'update') as FeedPost['postType'],
    body: row.body || '',
    tags: parseJson<string[]>(row.tags_json, []),
    linkUrl: row.link_url || undefined,
    linkPreview: row.link_preview_json ? parseJson<LinkPreviewData | null>(row.link_preview_json, null) : null,
    repostEntityType: (row.repost_entity_type || null) as FeedPost['repostEntityType'],
    repostEntityId: row.repost_entity_id || null,
    repostSummary,
    visibility: (row.visibility === 'followers' ? 'followers' : 'public') as 'public' | 'followers',
    status: (row.status || 'published') as FeedPost['status'],
    media,
    reactionCounts,
    viewerReaction,
    commentsCount: visibleComments.length,
    comments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createFeedRouter(db: DbInstance): Router {
  const router = Router();
  const postLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 25 });
  const linkPreviewLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });

  // Cursor-paginated feed listing
  router.get('/', (req: AuthedRequest, res) => {
    const viewer = req.user || null;
    const isStaff = Boolean(
      viewer && ['admin', 'moderator', 'finance_admin', 'verification_officer', 'support'].includes(viewer.activeRole)
    );
    const scope = String(req.query.scope || 'all');
    const discipline = String(req.query.discipline || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const authorUserIdFilter = String(req.query.authorUserId || '').trim();
    const rawLimit = Number.parseInt(String(req.query.limit || '15'), 10) || 15;
    const limit = Math.min(50, Math.max(1, rawLimit));
    const cursor = String(req.query.cursor || '').trim();

    if (scope === 'following' && !viewer) {
      return res.json({ items: [], nextCursor: null, hasMore: false });
    }

    const blockedIds = getMutualBlockedUserIds(db, viewer?.id);
    const mutedIds = getMutedUserIds(db, viewer?.id);
    const followingSet = viewer
      ? new Set(
          (
            db
              .prepare('SELECT following_user_id FROM follows WHERE follower_user_id = ?')
              .all(viewer.id) as Array<{ following_user_id: string }>
          ).map((r) => r.following_user_id)
        )
      : new Set<string>();

    const privateArtistUsers = new Set(
      (
        db
          .prepare(`SELECT user_id FROM individual_profiles WHERE profile_visibility = 'private'`)
          .all() as Array<{ user_id: string }>
      ).map((r) => r.user_id)
    );

    const rows = db
      .prepare(`SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC, id DESC`)
      .all() as any[];

    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    if (cursor && cursor.includes('|')) {
      const idx = cursor.lastIndexOf('|');
      cursorCreatedAt = cursor.slice(0, idx);
      cursorId = cursor.slice(idx + 1);
    }

    const filtered = rows.filter((r) => {
      if (blockedIds.has(r.author_user_id)) return false;
      if (mutedIds.has(r.author_user_id)) return false;
      if (authorUserIdFilter && r.author_user_id !== authorUserIdFilter) return false;

      if (privateArtistUsers.has(r.author_user_id) && r.author_user_id !== viewer?.id && !isStaff) {
        return false;
      }

      if (r.visibility === 'followers' && r.author_user_id !== viewer?.id && !followingSet.has(r.author_user_id) && !isStaff) {
        return false;
      }

      if (scope === 'following' && viewer) {
        if (r.author_user_id !== viewer.id && !followingSet.has(r.author_user_id)) return false;
      }

      if (discipline && discipline !== 'Tümü' && r.discipline !== discipline) return false;

      if (q) {
        const hay = `${r.body} ${r.author_name} ${r.author_subtitle} ${r.tags_json}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (cursorCreatedAt && cursorId) {
        if (r.created_at > cursorCreatedAt) return false;
        if (r.created_at === cursorCreatedAt && r.id >= cursorId) return false;
      }

      return true;
    });

    const pageRows = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? `${last.created_at}|${last.id}` : null;

    const items = pageRows.map((row) => hydratePost(db, row, viewer?.id || null, blockedIds));
    return res.json({ items, nextCursor, hasMore });
  });

  // Single post fetch
  router.get('/posts/:id', (req: AuthedRequest, res) => {
    const viewer = req.user || null;
    const row = db.prepare(`SELECT * FROM posts WHERE id = ? AND status = 'published'`).get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Paylaşım bulunamadı.' });
    if (viewer && isBlockedBetween(db, viewer.id, row.author_user_id)) {
      return res.status(403).json({ error: 'Bu paylaşım görüntülenemiyor.' });
    }
    const blockedIds = getMutualBlockedUserIds(db, viewer?.id);
    return res.json({ post: hydratePost(db, row, viewer?.id || null, blockedIds) });
  });

  // SSRF-safe Link Preview endpoint
  router.post('/link-preview', requireAuth, linkPreviewLimiter, async (req: AuthedRequest, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'Bağlantı adresi (url) zorunludur.' });
    }
    try {
      const preview = await fetchSafeLinkPreview(rawUrl, {
        skipRemoteFetch: process.env.NODE_ENV === 'test' && Boolean(req.body?.skipRemoteFetch),
      });
      return res.json({ preview });
    } catch (err: any) {
      if (err instanceof UnsafeLinkError) {
        return res.status(err.status).json({ error: err.message });
      }
      return res.status(400).json({ error: 'Bağlantı önizlemesi alınamadı.' });
    }
  });

  // Create feed post (including reposts and media attachments)
  router.post('/posts', requireAuth, postLimiter, async (req: AuthedRequest, res) => {
    const user = req.user!;
    const {
      body,
      discipline,
      postType,
      tags,
      linkUrl,
      repostEntityType,
      repostEntityId,
      visibility,
      media,
      skipRemoteFetch,
    } = req.body || {};

    const cleanBody = String(body || '').trim().slice(0, 2000);
    const cleanMedia = Array.isArray(media)
      ? media
          .slice(0, 4)
          .map((m: any) => ({
            mediaType: ['image', 'audio', 'video_link', 'document'].includes(m?.mediaType) ? m.mediaType : 'image',
            url: sanitizeMediaUrl(m?.url),
            caption: String(m?.caption || '').trim().slice(0, 140),
          }))
          .filter((m: any) => Boolean(m.url))
      : [];

    const hasRepost = Boolean(repostEntityType && repostEntityId);
    if (!cleanBody && !hasRepost && cleanMedia.length === 0) {
      return res.status(400).json({ error: 'Paylaşım metni, medya veya yeniden paylaşılacak bir içerik seçmelisiniz.' });
    }

    if (hasRepost) {
      const { summary, ownerUserId } = resolveRepostSummary(db, repostEntityType, repostEntityId);
      if (!summary) {
        return res.status(404).json({ error: 'Yeniden paylaşılacak içerik bulunamadı.' });
      }
      if (ownerUserId && isBlockedBetween(db, user.id, ownerUserId)) {
        return res.status(403).json({ error: 'Engelleme durumu nedeniyle bu içerik yeniden paylaşılamaz.' });
      }
    }

    let linkPreview: LinkPreviewData | null = null;
    let safeLinkUrl: string | null = null;
    if (linkUrl && String(linkUrl).trim()) {
      try {
        linkPreview = await fetchSafeLinkPreview(String(linkUrl), {
          skipRemoteFetch: process.env.NODE_ENV === 'test' && Boolean(skipRemoteFetch),
        });
        safeLinkUrl = linkPreview.url;
      } catch (err: any) {
        if (err instanceof UnsafeLinkError) {
          return res.status(err.status).json({ error: err.message });
        }
        return res.status(400).json({ error: 'Bağlantı doğrulanamadı.' });
      }
    }

    const authorLink = resolveUserProfileLink(db, user.id);
    const authorType =
      authorLink.profileView === 'artist_profile'
        ? 'artist'
        : authorLink.profileView === 'ensemble_profile'
        ? 'ensemble'
        : authorLink.profileView === 'business_profile'
        ? 'business'
        : user.activeRole;

    const cleanTags = Array.isArray(tags)
      ? Array.from(
          new Set(
            tags
              .map((t: any) => String(t || '').trim().replace(/^#/, '').slice(0, 32))
              .filter(Boolean)
          )
        ).slice(0, 8)
      : [];

    const safePostType = ALLOWED_POST_TYPES.has(postType)
      ? postType
      : hasRepost
      ? 'repost'
      : 'update';
    const safeVisibility = visibility === 'followers' ? 'followers' : 'public';
    const safeDiscipline = String(discipline || 'Müzik').trim() || 'Müzik';

    const now = new Date().toISOString();
    const postId = newId('post');
    const authorName = `${user.firstName} ${user.lastName}`.trim();

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO posts (
          id, author_user_id, author_type, author_entity_id, author_name, author_avatar,
          author_subtitle, discipline, post_type, body, tags_json, link_url, link_preview_json,
          repost_entity_type, repost_entity_id, visibility, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`
      ).run(
        postId,
        user.id,
        authorType,
        authorLink.profileEntityId || null,
        authorName,
        user.avatarUrl || '',
        authorLink.subtitle || '',
        safeDiscipline,
        safePostType,
        cleanBody,
        JSON.stringify(cleanTags),
        safeLinkUrl,
        linkPreview ? JSON.stringify(linkPreview) : null,
        hasRepost ? String(repostEntityType) : null,
        hasRepost ? String(repostEntityId) : null,
        safeVisibility,
        now,
        now
      );

      const insertMedia = db.prepare(
        `INSERT INTO post_media (id, post_id, media_type, url, caption, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      cleanMedia.forEach((m: any, idx: number) => {
        insertMedia.run(newId('pmedia'), postId, m.mediaType, m.url, m.caption, idx);
      });
    });
    tx();

    const createdRow = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
    const blockedIds = getMutualBlockedUserIds(db, user.id);
    logAudit(db, {
      userId: user.id,
      action: 'CREATE_FEED_POST',
      resourceType: 'post',
      resourceId: postId,
    });

    return res.status(201).json({ post: hydratePost(db, createdRow, user.id, blockedIds) });
  });

  // Delete own or moderated post
  router.delete('/posts/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Paylaşım bulunamadı.' });
    const isStaff = ['admin', 'moderator'].includes(user.activeRole);
    if (row.author_user_id !== user.id && !isStaff) {
      return res.status(403).json({ error: 'Yalnızca kendi paylaşımınızı silebilirsiniz.' });
    }

    db.prepare('DELETE FROM posts WHERE id = ?').run(row.id);
    logAudit(db, {
      userId: user.id,
      action: 'DELETE_FEED_POST',
      resourceType: 'post',
      resourceId: row.id,
    });
    return res.json({ deleted: true, id: row.id });
  });

  // Toggle or switch reaction
  router.post('/posts/:id/reactions', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const reactionType = String(req.body?.reactionType || 'applause') as FeedReactionType;
    if (!ALLOWED_REACTIONS.has(reactionType)) {
      return res.status(400).json({ error: 'Geçersiz tepki türü.' });
    }

    const post = db.prepare(`SELECT * FROM posts WHERE id = ? AND status = 'published'`).get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Paylaşım bulunamadı.' });
    if (isBlockedBetween(db, user.id, post.author_user_id)) {
      return res.status(403).json({ error: 'Engelleme durumu nedeniyle bu paylaşıma tepki verilemez.' });
    }

    const existing = db
      .prepare('SELECT reaction_type FROM post_reactions WHERE post_id = ? AND user_id = ?')
      .get(post.id, user.id) as { reaction_type: string } | undefined;

    let nextReaction: FeedReactionType | null = reactionType;
    if (existing && existing.reaction_type === reactionType) {
      db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?').run(post.id, user.id);
      nextReaction = null;
    } else {
      db.prepare(
        `INSERT OR REPLACE INTO post_reactions (post_id, user_id, reaction_type, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(post.id, user.id, reactionType, new Date().toISOString());

      if (post.author_user_id !== user.id && !existing) {
        const actorName = `${user.firstName} ${user.lastName}`.trim();
        notifyUser(db, {
          userId: post.author_user_id,
          type: 'feed_reaction',
          title: 'Paylaşımınıza Tepki Geldi',
          body: `${actorName} paylaşımınızı alkışladı.`,
          linkView: 'feed',
          linkEntityId: post.id,
        });
      }
    }

    const blockedIds = getMutualBlockedUserIds(db, user.id);
    const hydrated = hydratePost(db, post, user.id, blockedIds);
    return res.json({
      viewerReaction: nextReaction,
      reactionCounts: hydrated.reactionCounts,
    });
  });

  // Get all comments for a post
  router.get('/posts/:id/comments', (req: AuthedRequest, res) => {
    const viewer = req.user || null;
    const post = db.prepare(`SELECT * FROM posts WHERE id = ? AND status = 'published'`).get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Paylaşım bulunamadı.' });
    if (viewer && isBlockedBetween(db, viewer.id, post.author_user_id)) {
      return res.status(403).json({ error: 'Bu paylaşımın yorumları görüntülenemiyor.' });
    }

    const blockedIds = getMutualBlockedUserIds(db, viewer?.id);
    const rows = db
      .prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC')
      .all(post.id) as any[];

    const comments: FeedPostComment[] = rows
      .filter((c) => !blockedIds.has(c.author_user_id))
      .map((c) => {
        const link = resolveUserProfileLink(db, c.author_user_id);
        return {
          id: c.id,
          postId: c.post_id,
          authorUserId: c.author_user_id,
          authorName: c.author_name,
          authorAvatar: c.author_avatar,
          authorProfileView: link.profileView,
          authorProfileEntityId: link.profileEntityId,
          body: c.body,
          createdAt: c.created_at,
        };
      });

    return res.json({ comments });
  });

  // Add comment to a post
  router.post('/posts/:id/comments', requireAuth, postLimiter, (req: AuthedRequest, res) => {
    const user = req.user!;
    const post = db.prepare(`SELECT * FROM posts WHERE id = ? AND status = 'published'`).get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Paylaşım bulunamadı.' });
    if (isBlockedBetween(db, user.id, post.author_user_id)) {
      return res.status(403).json({ error: 'Engelleme durumu nedeniyle yorum yapılamaz.' });
    }

    const cleanBody = String(req.body?.body || '').trim().slice(0, 1000);
    if (!cleanBody) {
      return res.status(400).json({ error: 'Yorum metni boş olamaz.' });
    }

    const commentId = newId('pcomment');
    const now = new Date().toISOString();
    const authorName = `${user.firstName} ${user.lastName}`.trim();

    db.prepare(
      `INSERT INTO post_comments (id, post_id, author_user_id, author_name, author_avatar, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(commentId, post.id, user.id, authorName, user.avatarUrl || '', cleanBody, now);

    if (post.author_user_id !== user.id) {
      notifyUser(db, {
        userId: post.author_user_id,
        type: 'feed_comment',
        title: 'Yeni Yorum',
        body: `${authorName} paylaşımınıza yorum yaptı: "${cleanBody.slice(0, 70)}"`,
        linkView: 'feed',
        linkEntityId: post.id,
      });
    }

    const link = resolveUserProfileLink(db, user.id);
    const comment: FeedPostComment = {
      id: commentId,
      postId: post.id,
      authorUserId: user.id,
      authorName,
      authorAvatar: user.avatarUrl || '',
      authorProfileView: link.profileView,
      authorProfileEntityId: link.profileEntityId,
      body: cleanBody,
      createdAt: now,
    };

    const blockedIds = getMutualBlockedUserIds(db, user.id);
    const allCount = (
      db.prepare('SELECT author_user_id FROM post_comments WHERE post_id = ?').all(post.id) as Array<{ author_user_id: string }>
    ).filter((c) => !blockedIds.has(c.author_user_id)).length;

    return res.status(201).json({ comment, commentsCount: allCount });
  });

  // Delete comment
  router.delete('/comments/:commentId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const comment = db.prepare('SELECT * FROM post_comments WHERE id = ?').get(req.params.commentId) as any;
    if (!comment) return res.status(404).json({ error: 'Yorum bulunamadı.' });
    const post = db.prepare('SELECT author_user_id FROM posts WHERE id = ?').get(comment.post_id) as any;
    const isStaff = ['admin', 'moderator'].includes(user.activeRole);
    if (comment.author_user_id !== user.id && post?.author_user_id !== user.id && !isStaff) {
      return res.status(403).json({ error: 'Bu yorumu silme yetkiniz yok.' });
    }
    db.prepare('DELETE FROM post_comments WHERE id = ?').run(comment.id);
    return res.json({ deleted: true, id: comment.id });
  });

  return router;
}
