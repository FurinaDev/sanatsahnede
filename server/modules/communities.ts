import { Router } from 'express';
import { DbInstance, parseJson } from '../db/database';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { newId, slugifyTr } from '../utils/crypto';
import { isBlockedBetween } from '../services/socialGraphService';
import { logAudit } from '../services/auditService';
import { notifyUser } from '../services/notificationService';
import { RealtimeHub } from '../services/realtimeHub';

function mapChannel(row: any) {
  return {
    id: row.id,
    communityId: row.community_id,
    slug: row.slug,
    name: row.name,
    description: row.description || '',
    channelType: (row.channel_type || 'discussion') as 'announcement' | 'discussion',
    isReadonly: Boolean(row.is_readonly),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
  };
}

function mapCommunityMessage(db: DbInstance, row: any) {
  let replyToSnippet: { id: string; senderName: string; body: string } | undefined;
  if (row.reply_to_message_id) {
    const parent = db
      .prepare('SELECT id, sender_name, body, deleted_at FROM community_messages WHERE id = ?')
      .get(row.reply_to_message_id) as any;
    if (parent) {
      replyToSnippet = {
        id: parent.id,
        senderName: parent.sender_name,
        body: parent.deleted_at ? 'Bu mesaj silindi.' : String(parent.body || '').slice(0, 120),
      };
    }
  }
  const reactions = parseJson<Record<string, string[]>>(row.reactions_json, {});
  const memberRow = db
    .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
    .get(row.community_id, row.sender_user_id) as { role?: string } | undefined;

  return {
    id: row.id,
    channelId: row.channel_id,
    communityId: row.community_id,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
    senderAvatar: row.sender_avatar || '',
    senderRole: (memberRow?.role || 'member') as 'owner' | 'moderator' | 'member',
    body: row.deleted_at ? 'Bu mesaj silindi.' : row.body || '',
    attachmentUrl: row.deleted_at ? undefined : row.attachment_url || undefined,
    attachmentName: row.deleted_at ? undefined : row.attachment_name || undefined,
    attachmentType: row.deleted_at ? undefined : row.attachment_type || undefined,
    replyToMessageId: row.reply_to_message_id || undefined,
    replyToSnippet,
    reactions: row.deleted_at ? {} : reactions,
    isPinned: Boolean(row.is_pinned) && !row.deleted_at,
    deletedAt: row.deleted_at || undefined,
    createdAt: row.created_at,
  };
}

function mapCommunitySummary(db: DbInstance, row: any, viewerUserId?: string, hub?: RealtimeHub) {
  const memberCountRow = db
    .prepare('SELECT COUNT(*) as cnt FROM community_members WHERE community_id = ?')
    .get(row.id) as { cnt: number };
  const channels = (
    db
      .prepare('SELECT * FROM community_channels WHERE community_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(row.id) as any[]
  ).map(mapChannel);

  let myRole: 'owner' | 'moderator' | 'member' | null = null;
  let isMuted = false;
  if (viewerUserId) {
    const m = db
      .prepare('SELECT role, is_muted FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(row.id, viewerUserId) as { role: string; is_muted: number } | undefined;
    if (m) {
      myRole = m.role as any;
      isMuted = Boolean(m.is_muted);
    }
  }

  const lastMsg = db
    .prepare(
      'SELECT body, sender_name, created_at, deleted_at FROM community_messages WHERE community_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(row.id) as any;

  const ownerRow = db
    .prepare('SELECT id, first_name, last_name, avatar_url FROM users WHERE id = ?')
    .get(row.owner_user_id) as any;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || '',
    discipline: row.discipline || 'Müzik',
    city: row.city || 'İstanbul',
    avatarUrl: row.avatar_url || '',
    coverUrl: row.cover_url || '',
    visibility: (row.visibility || 'public') as 'public' | 'private_invite',
    ownerUserId: row.owner_user_id,
    ownerName: ownerRow ? `${ownerRow.first_name} ${ownerRow.last_name}`.trim() : 'Topluluk Kurucusu',
    ownerIsOnline: hub ? hub.isUserOnline(row.owner_user_id) : false,
    isVerified: Boolean(row.is_verified),
    verifiedLabel: row.verified_label || '',
    memberCount: Number(memberCountRow?.cnt || 0),
    myRole,
    isMuted,
    channels,
    lastMessagePreview: lastMsg
      ? {
          senderName: lastMsg.sender_name,
          body: lastMsg.deleted_at ? 'Bu mesaj silindi.' : lastMsg.body,
          createdAt: lastMsg.created_at,
        }
      : null,
    createdAt: row.created_at,
  };
}

function getCommunityMemberIds(db: DbInstance, communityId: string): string[] {
  return (
    db
      .prepare('SELECT user_id FROM community_members WHERE community_id = ?')
      .all(communityId) as Array<{ user_id: string }>
  ).map((r) => r.user_id);
}

export function createCommunitiesRouter(db: DbInstance, realtimeHub?: RealtimeHub): Router {
  const router = Router();

  // List communities
  router.get('/', (req: AuthedRequest, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const discipline = String(req.query.discipline || '').trim();
    const city = String(req.query.city || '').trim();
    const joinedOnly = req.query.joinedOnly === '1' || req.query.joinedOnly === 'true';
    const viewerId = req.user?.id;

    let rows = db.prepare('SELECT * FROM communities ORDER BY is_verified DESC, created_at DESC').all() as any[];

    if (discipline && discipline !== 'Tümü') {
      rows = rows.filter((r) => r.discipline === discipline);
    }
    if (city && city !== 'Tümü') {
      rows = rows.filter((r) => r.city === city);
    }
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.name || '').toLowerCase().includes(q) ||
          String(r.description || '').toLowerCase().includes(q) ||
          String(r.city || '').toLowerCase().includes(q) ||
          String(r.discipline || '').toLowerCase().includes(q)
      );
    }

    let items = rows.map((r) => mapCommunitySummary(db, r, viewerId, realtimeHub));
    if (joinedOnly && viewerId) {
      items = items.filter((item) => item.myRole !== null);
    }

    return res.json({ communities: items });
  });

  // Create community (auto creates Duyurular + #genel + owner membership)
  router.post('/', requireAuth, (req: AuthedRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const discipline = String(req.body?.discipline || 'Müzik').trim();
    const city = String(req.body?.city || 'İstanbul').trim();
    const visibility = req.body?.visibility === 'private_invite' ? 'private_invite' : 'public';
    const avatarUrl = String(req.body?.avatarUrl || '').trim();

    if (name.length < 3) {
      return res.status(400).json({ error: 'Topluluk adı en az 3 karakter olmalıdır.' });
    }

    const id = newId('comm');
    const slugBase = slugifyTr(name) || 'topluluk';
    const slug = `${slugBase}-${id.slice(-4)}`;
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO communities (
          id, slug, name, description, discipline, city, avatar_url, cover_url, visibility, owner_user_id, is_verified, verified_label, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0, '', ?)
      `).run(id, slug, name, description, discipline, city, avatarUrl, visibility, req.user!.id, now);

      db.prepare(`
        INSERT INTO community_members (community_id, user_id, role, is_muted, joined_at)
        VALUES (?, ?, 'owner', 0, ?)
      `).run(id, req.user!.id, now);

      db.prepare(`
        INSERT INTO community_channels (id, community_id, slug, name, description, channel_type, is_readonly, sort_order, created_at)
        VALUES (?, ?, 'duyurular', 'Duyurular', 'Kurucu ve moderatör duyuru kanalı.', 'announcement', 1, 0, ?)
      `).run(newId('ch'), id, now);

      db.prepare(`
        INSERT INTO community_channels (id, community_id, slug, name, description, channel_type, is_readonly, sort_order, created_at)
        VALUES (?, ?, 'genel', '#genel', 'Topluluk genel sohbet ve tanışma kanalı.', 'discussion', 0, 1, ?)
      `).run(newId('ch'), id, now);
    });
    tx();

    logAudit(db, {
      userId: req.user!.id,
      action: 'CREATE_COMMUNITY',
      resourceType: 'community',
      resourceId: id,
      details: { name, discipline, city },
    });

    const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(id);
    return res.status(201).json({ community: mapCommunitySummary(db, row, req.user!.id, realtimeHub) });
  });

  // Get single community details + channels + members
  router.get('/:id', (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM communities WHERE id = ? OR slug = ?').get(req.params.id, req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Topluluk bulunamadı.' });

    const summary = mapCommunitySummary(db, row, req.user?.id, realtimeHub);
    const memberRows = db
      .prepare(`
        SELECT cm.user_id, cm.role, cm.is_muted, cm.joined_at, u.first_name, u.last_name, u.avatar_url, u.active_role, u.is_verified
        FROM community_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.community_id = ?
        ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, cm.joined_at ASC
      `)
      .all(row.id) as any[];

    const members = memberRows.map((m) => ({
      userId: m.user_id,
      name: `${m.first_name} ${m.last_name}`.trim(),
      avatarUrl: m.avatar_url || '/src/assets/images/artist_jazz_pianist_1794440057025.jpg',
      activeRole: m.active_role,
      communityRole: m.role as 'owner' | 'moderator' | 'member',
      isMuted: Boolean(m.is_muted),
      isVerified: Boolean(m.is_verified),
      isOnline: realtimeHub ? realtimeHub.isUserOnline(m.user_id) : false,
      joinedAt: m.joined_at,
    }));

    return res.json({ community: summary, members });
  });

  // Join public community
  router.post('/:id/join', requireAuth, (req: AuthedRequest, res) => {
    const comm = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id) as any;
    if (!comm) return res.status(404).json({ error: 'Topluluk bulunamadı.' });

    const existing = db
      .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(comm.id, req.user!.id) as any;

    if (!existing) {
      if (comm.visibility === 'private_invite' && !['admin', 'moderator'].includes(req.user!.activeRole)) {
        return res.status(403).json({ error: 'Bu topluluk yalnızca davetle üye kabul etmektedir.' });
      }
      db.prepare(`
        INSERT INTO community_members (community_id, user_id, role, is_muted, joined_at)
        VALUES (?, ?, 'member', 0, ?)
      `).run(comm.id, req.user!.id, new Date().toISOString());
    }

    const updated = mapCommunitySummary(db, comm, req.user!.id, realtimeHub);
    return res.json({ community: updated });
  });

  // Leave community
  router.delete('/:id/leave', requireAuth, (req: AuthedRequest, res) => {
    const comm = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id) as any;
    if (!comm) return res.status(404).json({ error: 'Topluluk bulunamadı.' });

    const membership = db
      .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(comm.id, req.user!.id) as { role: string } | undefined;

    if (!membership) return res.status(400).json({ error: 'Bu topluluğun üyesi değilsiniz.' });

    if (membership.role === 'owner') {
      const otherOwners = db
        .prepare("SELECT COUNT(*) as cnt FROM community_members WHERE community_id = ? AND role = 'owner' AND user_id != ?")
        .get(comm.id, req.user!.id) as { cnt: number };
      if ((otherOwners?.cnt || 0) === 0) {
        return res.status(400).json({ error: 'Topluluk kurucusu topluluktan ayrılmadan önce başka bir yönetici atamalıdır.' });
      }
    }

    db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(comm.id, req.user!.id);
    const updated = mapCommunitySummary(db, comm, req.user!.id, realtimeHub);
    return res.json({ community: updated });
  });

  // Create sub-channel (owner or moderator or platform admin)
  router.post('/:id/channels', requireAuth, (req: AuthedRequest, res) => {
    const comm = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id) as any;
    if (!comm) return res.status(404).json({ error: 'Topluluk bulunamadı.' });

    const membership = db
      .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(comm.id, req.user!.id) as { role: string } | undefined;
    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    if (!isStaff && (!membership || !['owner', 'moderator'].includes(membership.role))) {
      return res.status(403).json({ error: 'Alt kanal oluşturma yetkisi yalnızca kurucu ve moderatörlerdedir.' });
    }

    const rawName = String(req.body?.name || '').trim();
    const channelType = req.body?.channelType === 'announcement' ? 'announcement' : 'discussion';
    const description = String(req.body?.description || '').trim();
    if (rawName.length < 2) {
      return res.status(400).json({ error: 'Kanal adı en az 2 karakter olmalıdır.' });
    }

    const formattedName =
      channelType === 'discussion' && !rawName.startsWith('#')
        ? `#${slugifyTr(rawName) || rawName.toLowerCase()}`
        : rawName;
    const slug = slugifyTr(rawName) || `kanal-${Date.now()}`;

    const maxOrder = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM community_channels WHERE community_id = ?')
      .get(comm.id) as { m: number };
    const id = newId('ch');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO community_channels (id, community_id, slug, name, description, channel_type, is_readonly, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, comm.id, slug, formattedName, description, channelType, channelType === 'announcement' ? 1 : 0, (maxOrder?.m || 0) + 1, now);

    const row = db.prepare('SELECT * FROM community_channels WHERE id = ?').get(id);
    const channel = mapChannel(row);

    realtimeHub?.sendToCommunity(comm.id, getCommunityMemberIds(db, comm.id), {
      type: 'community:channel_created',
      payload: { communityId: comm.id, channel },
    });

    return res.status(201).json({ channel });
  });

  // Get channel messages
  router.get('/:id/channels/:channelId/messages', (req: AuthedRequest, res) => {
    const channel = db
      .prepare('SELECT * FROM community_channels WHERE id = ? AND community_id = ?')
      .get(req.params.channelId, req.params.id) as any;
    if (!channel) return res.status(404).json({ error: 'Kanal bulunamadı.' });

    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 60)));
    const viewerId = req.user?.id;

    const rows = db
      .prepare('SELECT * FROM community_messages WHERE channel_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(channel.id, limit) as any[];

    const messages = rows
      .filter((r) => !viewerId || !isBlockedBetween(db, viewerId, r.sender_user_id))
      .map((r) => mapCommunityMessage(db, r));

    return res.json({ channel: mapChannel(channel), messages });
  });

  // Post channel message (enforces membership, mute, and Duyurular read-only permission)
  router.post('/:id/channels/:channelId/messages', requireAuth, (req: AuthedRequest, res) => {
    const comm = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id) as any;
    if (!comm) return res.status(404).json({ error: 'Topluluk bulunamadı.' });

    const channel = db
      .prepare('SELECT * FROM community_channels WHERE id = ? AND community_id = ?')
      .get(req.params.channelId, comm.id) as any;
    if (!channel) return res.status(404).json({ error: 'Kanal bulunamadı.' });

    const membership = db
      .prepare('SELECT role, is_muted FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(comm.id, req.user!.id) as { role: string; is_muted: number } | undefined;

    const isPlatformAdmin = req.user!.activeRole === 'admin';
    if (!membership && !isPlatformAdmin) {
      return res.status(403).json({ error: 'Mesaj göndermek için önce bu topluluğa katılmalısınız.' });
    }

    if (membership?.is_muted && !isPlatformAdmin) {
      return res.status(403).json({ error: 'Bu toplulukta susturulduğunuz için mesaj gönderemezsiniz.' });
    }

    const canPostAnnouncement =
      isPlatformAdmin || membership?.role === 'owner' || membership?.role === 'moderator';
    if ((Boolean(channel.is_readonly) || channel.channel_type === 'announcement') && !canPostAnnouncement) {
      return res.status(403).json({
        error: 'Duyurular kanalına yalnızca topluluk kurucuları ve moderatörler mesaj gönderebilir.',
      });
    }

    const body = String(req.body?.body || '').trim();
    const attachmentUrl = req.body?.attachmentUrl ? String(req.body.attachmentUrl).trim() : null;
    const attachmentName = req.body?.attachmentName ? String(req.body.attachmentName).trim() : null;
    const attachmentType = req.body?.attachmentType ? String(req.body.attachmentType).trim() : null;
    const replyToMessageId = req.body?.replyToMessageId ? String(req.body.replyToMessageId).trim() : null;

    if (!body && !attachmentUrl) {
      return res.status(400).json({ error: 'Mesaj metni veya ek dosya gereklidir.' });
    }

    const id = newId('cmsg');
    const now = new Date().toISOString();
    const senderName = `${req.user!.firstName} ${req.user!.lastName}`.trim();

    db.prepare(`
      INSERT INTO community_messages (
        id, channel_id, community_id, sender_user_id, sender_name, sender_avatar,
        body, attachment_url, attachment_name, attachment_type, reply_to_message_id, reactions_json, is_pinned, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 0, ?)
    `).run(
      id,
      channel.id,
      comm.id,
      req.user!.id,
      senderName,
      req.user!.avatarUrl || '',
      body,
      attachmentUrl,
      attachmentName,
      attachmentType,
      replyToMessageId,
      now
    );

    const row = db.prepare('SELECT * FROM community_messages WHERE id = ?').get(id);
    const message = mapCommunityMessage(db, row);

    realtimeHub?.sendToCommunity(comm.id, getCommunityMemberIds(db, comm.id), {
      type: 'community:message_created',
      payload: { communityId: comm.id, channelId: channel.id, message },
    });

    return res.status(201).json({ message });
  });

  // Toggle emoji reaction on community message
  router.post('/:id/channels/:channelId/messages/:msgId/reactions', requireAuth, (req: AuthedRequest, res) => {
    const msg = db
      .prepare('SELECT * FROM community_messages WHERE id = ? AND channel_id = ? AND community_id = ?')
      .get(req.params.msgId, req.params.channelId, req.params.id) as any;
    if (!msg) return res.status(404).json({ error: 'Mesaj bulunamadı.' });
    if (msg.deleted_at) return res.status(400).json({ error: 'Silinmiş mesaja tepki eklenemez.' });

    const membership = db
      .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.id, req.user!.id);
    if (!membership && req.user!.activeRole !== 'admin') {
      return res.status(403).json({ error: 'Tepki vermek için topluluğa katılmalısınız.' });
    }

    const emoji = String(req.body?.emoji || '').trim();
    if (!emoji) return res.status(400).json({ error: 'Geçerli bir tepki seçin.' });

    const reactions = parseJson<Record<string, string[]>>(msg.reactions_json, {});
    const users = new Set(Array.isArray(reactions[emoji]) ? reactions[emoji] : []);
    if (users.has(req.user!.id)) {
      users.delete(req.user!.id);
    } else {
      users.add(req.user!.id);
    }
    if (users.size === 0) delete reactions[emoji];
    else reactions[emoji] = Array.from(users);

    db.prepare('UPDATE community_messages SET reactions_json = ? WHERE id = ?').run(JSON.stringify(reactions), msg.id);
    const updated = mapCommunityMessage(db, db.prepare('SELECT * FROM community_messages WHERE id = ?').get(msg.id));

    realtimeHub?.sendToCommunity(req.params.id, getCommunityMemberIds(db, req.params.id), {
      type: 'community:message_reaction',
      payload: { communityId: req.params.id, channelId: req.params.channelId, message: updated },
    });

    return res.json({ message: updated });
  });

  // Pin / unpin announcement or message (owner/mod only)
  router.post('/:id/channels/:channelId/messages/:msgId/pin', requireAuth, (req: AuthedRequest, res) => {
    const membership = db
      .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.id, req.user!.id) as { role: string } | undefined;
    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    if (!isStaff && (!membership || !['owner', 'moderator'].includes(membership.role))) {
      return res.status(403).json({ error: 'Mesaj sabitleme yetkisi yalnızca topluluk yöneticilerindedir.' });
    }

    const msg = db
      .prepare('SELECT * FROM community_messages WHERE id = ? AND channel_id = ? AND community_id = ?')
      .get(req.params.msgId, req.params.channelId, req.params.id) as any;
    if (!msg) return res.status(404).json({ error: 'Mesaj bulunamadı.' });

    const nextPinned = msg.is_pinned ? 0 : 1;
    db.prepare('UPDATE community_messages SET is_pinned = ? WHERE id = ?').run(nextPinned, msg.id);
    const updated = mapCommunityMessage(db, db.prepare('SELECT * FROM community_messages WHERE id = ?').get(msg.id));

    realtimeHub?.sendToCommunity(req.params.id, getCommunityMemberIds(db, req.params.id), {
      type: 'community:message_updated',
      payload: { communityId: req.params.id, channelId: req.params.channelId, message: updated },
    });

    return res.json({ message: updated });
  });

  // Soft delete message (sender or owner/mod/admin)
  router.delete('/:id/channels/:channelId/messages/:msgId', requireAuth, (req: AuthedRequest, res) => {
    const msg = db
      .prepare('SELECT * FROM community_messages WHERE id = ? AND channel_id = ? AND community_id = ?')
      .get(req.params.msgId, req.params.channelId, req.params.id) as any;
    if (!msg) return res.status(404).json({ error: 'Mesaj bulunamadı.' });

    const membership = db
      .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.id, req.user!.id) as { role: string } | undefined;
    const isMod = Boolean(membership && ['owner', 'moderator'].includes(membership.role));
    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);

    if (msg.sender_user_id !== req.user!.id && !isMod && !isStaff) {
      return res.status(403).json({ error: 'Bu mesajı silme yetkiniz yok.' });
    }

    const now = new Date().toISOString();
    db.prepare(
      "UPDATE community_messages SET body = 'Bu mesaj silindi.', attachment_url = NULL, attachment_name = NULL, is_pinned = 0, deleted_at = ? WHERE id = ?"
    ).run(now, msg.id);

    const updated = mapCommunityMessage(db, db.prepare('SELECT * FROM community_messages WHERE id = ?').get(msg.id));

    realtimeHub?.sendToCommunity(req.params.id, getCommunityMemberIds(db, req.params.id), {
      type: 'community:message_deleted',
      payload: { communityId: req.params.id, channelId: req.params.channelId, message: updated },
    });

    return res.json({ message: updated });
  });

  // Member moderation: mute/unmute or role change (owner/mod)
  router.patch('/:id/members/:userId', requireAuth, (req: AuthedRequest, res) => {
    const comm = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id) as any;
    if (!comm) return res.status(404).json({ error: 'Topluluk bulunamadı.' });

    const actor = db
      .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(comm.id, req.user!.id) as { role: string } | undefined;
    const isPlatformAdmin = req.user!.activeRole === 'admin';
    if (!isPlatformAdmin && (!actor || !['owner', 'moderator'].includes(actor.role))) {
      return res.status(403).json({ error: 'Üye yönetimi için kurucu veya moderatör yetkisi gereklidir.' });
    }

    const target = db
      .prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(comm.id, req.params.userId) as any;
    if (!target) return res.status(404).json({ error: 'Üye bu toplulukta bulunamadı.' });
    if (target.role === 'owner' && !isPlatformAdmin) {
      return res.status(403).json({ error: 'Topluluk kurucusu üzerinde bu işlem yapılamaz.' });
    }

    if (typeof req.body?.isMuted === 'boolean') {
      db.prepare('UPDATE community_members SET is_muted = ? WHERE community_id = ? AND user_id = ?').run(
        req.body.isMuted ? 1 : 0,
        comm.id,
        req.params.userId
      );
    }

    if (req.body?.role && ['moderator', 'member'].includes(req.body.role)) {
      if (!isPlatformAdmin && actor?.role !== 'owner') {
        return res.status(403).json({ error: 'Moderatör atama yetkisi yalnızca topluluk kurucusundadır.' });
      }
      db.prepare('UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?').run(
        req.body.role,
        comm.id,
        req.params.userId
      );
      if (req.body.role === 'moderator') {
        notifyUser(db, {
          userId: req.params.userId,
          type: 'community_role',
          title: 'Topluluk Moderatörü Ataması',
          body: `"${comm.name}" topluluğunda moderatör olarak yetkilendirildiniz.`,
          linkView: 'communities',
          linkEntityId: comm.id,
        });
      }
    }

    const updated = db
      .prepare('SELECT role, is_muted FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(comm.id, req.params.userId) as { role: string; is_muted: number };

    realtimeHub?.sendToCommunity(comm.id, getCommunityMemberIds(db, comm.id), {
      type: 'community:member_updated',
      payload: {
        communityId: comm.id,
        userId: req.params.userId,
        role: updated.role,
        isMuted: Boolean(updated.is_muted),
      },
    });

    return res.json({
      member: {
        userId: req.params.userId,
        communityRole: updated.role,
        isMuted: Boolean(updated.is_muted),
      },
    });
  });

  return router;
}
