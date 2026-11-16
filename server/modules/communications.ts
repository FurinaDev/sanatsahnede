import { Router } from 'express';
import { DbInstance, parseJson } from '../db/database';
import { AuthedRequest, requireAuth, requireFeatureFlag } from '../middleware/auth';
import { mapConversation } from '../db/mappers';
import { newId } from '../utils/crypto';
import { notifyUser } from '../services/notificationService';
import { DraftKind, generateDraftText } from '../services/aiService';
import { createRateLimiter } from '../middleware/rateLimit';
import {
  getMutualBlockedUserIds,
  isBlockedBetween,
  resolveUserProfileLink,
} from '../services/socialGraphService';
import { getDbRealtimeHub, RealtimeHub } from '../services/realtimeHub';
import { MessagingContact, RoleType } from '../../src/types';

const ALLOWED_REACTIONS = new Set(['👏', '❤️', '🔥', '🎵', '👍', '✨']);

function hasPriorRelationship(db: DbInstance, userA: string, userB: string): boolean {
  // 1. Follow relationship in either direction
  const follow = db
    .prepare(
      `SELECT 1 FROM follows
       WHERE (follower_user_id = ? AND following_user_id = ?)
          OR (follower_user_id = ? AND following_user_id = ?)
       LIMIT 1`
    )
    .get(userA, userB, userB, userA);
  if (follow) return true;

  // 2. Existing booking or offer between the two users
  const offer = db
    .prepare(
      `SELECT 1 FROM offers
       WHERE (employer_user_id = ? AND performer_user_id = ?)
          OR (employer_user_id = ? AND performer_user_id = ?)
       LIMIT 1`
    )
    .get(userA, userB, userB, userA);
  if (offer) return true;

  const booking = db
    .prepare(
      `SELECT 1 FROM bookings b
       LEFT JOIN business_profiles bp ON bp.id = b.business_id
       WHERE (bp.user_id = ? AND b.performer_user_id = ?)
          OR (bp.user_id = ? AND b.performer_user_id = ?)
       LIMIT 1`
    )
    .get(userA, userB, userB, userA);
  if (booking) return true;

  // 3. Shared project membership
  const projects = db.prepare('SELECT owner_user_id, members_json FROM projects').all() as Array<{
    owner_user_id: string;
    members_json: string;
  }>;
  for (const p of projects) {
    const members = parseJson<Array<{ userId: string }>>(p.members_json, []);
    const ids = new Set([p.owner_user_id, ...members.map((m) => m.userId)]);
    if (ids.has(userA) && ids.has(userB)) return true;
  }

  return false;
}

function getHub(db: DbInstance, provided?: RealtimeHub): RealtimeHub | undefined {
  return provided || getDbRealtimeHub(db);
}

export function createCommunicationsRouter(db: DbInstance, providedHub?: RealtimeHub): Router {
  const router = Router();
  const contactLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
    message: 'Çok fazla iletişim talebi gönderildi. Lütfen bir dakika sonra tekrar deneyin.',
  });
  const messageLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 90,
    message: 'Çok hızlı mesaj gönderiyorsunuz. Lütfen kısa süre bekleyin.',
  });

  const emitConversationForParticipants = (
    convRow: any,
    eventType: 'conversation:created' | 'conversation:updated',
    excludeUserId?: string
  ) => {
    const hub = getHub(db, providedHub);
    if (!hub) return;
    const participants = parseJson<string[]>(convRow.participant_user_ids_json, []);
    for (const pId of participants) {
      if (excludeUserId && pId === excludeUserId) continue;
      hub.sendToUser(pId, {
        type: eventType,
        payload: {
          conversation: mapConversation(db, convRow, pId, hub.isUserOnline),
        },
      });
    }
  };

  // List current user's conversations
  router.get('/conversations', requireAuth, (req: AuthedRequest, res) => {
    const hub = getHub(db, providedHub);
    const isStaff = ['admin', 'moderator', 'support'].includes(req.user!.activeRole);
    const rows = db.prepare('SELECT * FROM conversations ORDER BY last_message_at DESC').all() as any[];
    const items = rows
      .filter((c) => {
        if (c.status === 'declined') return false;
        const participants = parseJson<string[]>(c.participant_user_ids_json, []);
        return isStaff || participants.includes(req.user!.id);
      })
      .map((c) => mapConversation(db, c, req.user!.id, hub?.isUserOnline));

    return res.json({ conversations: items });
  });

  // Searchable directory contacts for starting 1:1 or group chats
  router.get('/conversations/contacts', requireAuth, (req: AuthedRequest, res) => {
    const hub = getHub(db, providedHub);
    const q = String(req.query.q || '').trim().toLowerCase();
    const blocked = getMutualBlockedUserIds(db, req.user!.id);

    const rows = db
      .prepare(
        `SELECT id, first_name, last_name, avatar_url, active_role
         FROM users
         WHERE status = 'active' AND id != ?
         ORDER BY first_name ASC`
      )
      .all(req.user!.id) as any[];

    const contacts: MessagingContact[] = [];
    for (const r of rows) {
      if (blocked.has(r.id)) continue;
      const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Kullanıcı';
      const link = resolveUserProfileLink(db, r.id);
      const subtitle = link.subtitle || '';
      if (q) {
        const hay = `${name} ${subtitle} ${r.active_role}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      contacts.push({
        userId: r.id,
        name,
        avatarUrl: r.avatar_url || '/src/assets/images/artist_jazz_pianist_1794440057025.jpg',
        role: (r.active_role || 'audience') as RoleType,
        subtitle: link.subtitle,
        profileView: link.profileView,
        profileEntityId: link.profileEntityId,
        isOnline: hub ? hub.isUserOnline(r.id) : false,
      });
    }

    return res.json({ contacts: contacts.slice(0, 80) });
  });

  // Create or reuse conversation (1:1 direct dedup, cold DM request, or group chat)
  router.post('/conversations', requireAuth, (req: AuthedRequest, res) => {
    const {
      contextType = 'general',
      contextId = '',
      conversationType: requestedConvType,
      title,
      participantUserIds = [],
      initialMessage,
    } = req.body || {};

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) return res.status(400).json({ error: 'Görüşme başlığı zorunludur.' });

    const participants = Array.from(
      new Set([req.user!.id, ...(Array.isArray(participantUserIds) ? participantUserIds : [])].filter(Boolean))
    );
    if (participants.length < 2) {
      return res.status(400).json({ error: 'Görüşme başlatmak için en az bir katılımcı seçilmelidir.' });
    }

    for (const pId of participants) {
      if (pId !== req.user!.id && isBlockedBetween(db, req.user!.id, pId)) {
        return res.status(403).json({ error: 'Engelleme durumu nedeniyle bu kullanıcı ile görüşme başlatılamaz.' });
      }
    }

    const inferredType: 'direct' | 'group' | 'context' =
      requestedConvType === 'group' || participants.length > 2
        ? 'group'
        : requestedConvType === 'direct' || contextType === 'direct'
        ? 'direct'
        : 'context';

    if (inferredType === 'group' && participants.length < 3) {
      return res.status(400).json({ error: 'Grup sohbeti oluşturmak için en az 2 kişi seçmelisiniz.' });
    }

    const hub = getHub(db, providedHub);
    const now = new Date().toISOString();

    // 1:1 Direct deduplication: reuse existing non-declined direct conversation between the exact 2 users
    if (inferredType === 'direct' && participants.length === 2) {
      const targetUserId = participants.find((id) => id !== req.user!.id)!;
      const candidates = db
        .prepare(
          `SELECT * FROM conversations
           WHERE conversation_type = 'direct' AND status != 'declined'
           ORDER BY last_message_at DESC`
        )
        .all() as any[];

      const existing = candidates.find((c) => {
        const p = parseJson<string[]>(c.participant_user_ids_json, []);
        return p.length === 2 && p.includes(req.user!.id) && p.includes(targetUserId);
      });

      if (existing) {
        if (initialMessage && String(initialMessage).trim()) {
          const senderName = `${req.user!.firstName} ${req.user!.lastName}`.trim();
          const msgId = newId('msg');
          db.prepare(`
            INSERT INTO messages (id, conversation_id, sender_user_id, sender_name, body, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(msgId, existing.id, req.user!.id, senderName, String(initialMessage).trim(), now);
          db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(now, existing.id);
          db.prepare(`
            INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id, last_read_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(conversation_id, user_id) DO UPDATE SET
              last_read_message_id = excluded.last_read_message_id,
              last_read_at = excluded.last_read_at
          `).run(existing.id, req.user!.id, msgId, now);

          const refreshed = db.prepare('SELECT * FROM conversations WHERE id = ?').get(existing.id) as any;
          if (hub) {
            for (const pId of participants) {
              const mapped = mapConversation(db, refreshed, pId, hub.isUserOnline);
              const msg = mapped.messages.find((m) => m.id === msgId);
              hub.sendToUser(pId, {
                type: 'message:created',
                payload: { conversationId: existing.id, message: msg, conversation: mapped },
              });
            }
          }
          return res.status(200).json({
            conversation: mapConversation(db, refreshed, req.user!.id, hub?.isUserOnline),
            existing: true,
          });
        }

        return res.status(200).json({
          conversation: mapConversation(db, existing, req.user!.id, hub?.isUserOnline),
          existing: true,
        });
      }
    }

    // Cold DM request detection for 1:1 direct chats with no prior relationship
    let status: 'active' | 'pending_request' = 'active';
    if (inferredType === 'direct' && participants.length === 2) {
      const targetUserId = participants.find((id) => id !== req.user!.id)!;
      const isStaff = ['admin', 'moderator', 'support'].includes(req.user!.activeRole);
      if (!isStaff && !hasPriorRelationship(db, req.user!.id, targetUserId)) {
        const targetPref = db
          .prepare('SELECT allow_direct_messages FROM user_preferences WHERE user_id = ?')
          .get(targetUserId) as { allow_direct_messages: number } | undefined;
        if (targetPref && targetPref.allow_direct_messages === 0) {
          return res.status(403).json({
            error: 'Bu kullanıcı doğrudan mesaj isteklerini gizlilik tercihleriyle sınırlandırmış.',
          });
        }
        status = 'pending_request';
      }
    }

    const convId = newId('conv');
    db.prepare(`
      INSERT INTO conversations (
        id, context_type, context_id, conversation_type, status, created_by_user_id, title, participant_user_ids_json, last_message_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      convId,
      contextType,
      contextId || convId,
      inferredType,
      status,
      req.user!.id,
      cleanTitle,
      JSON.stringify(participants),
      now
    );

    let firstMsgId: string | null = null;
    if (initialMessage && String(initialMessage).trim()) {
      const senderName = `${req.user!.firstName} ${req.user!.lastName}`.trim();
      firstMsgId = newId('msg');
      db.prepare(`
        INSERT INTO messages (id, conversation_id, sender_user_id, sender_name, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(firstMsgId, convId, req.user!.id, senderName, String(initialMessage).trim(), now);
    }

    db.prepare(`
      INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id, last_read_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id, user_id) DO UPDATE SET
        last_read_message_id = excluded.last_read_message_id,
        last_read_at = excluded.last_read_at
    `).run(convId, req.user!.id, firstMsgId, now);

    const created = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as any;

    for (const pId of participants) {
      if (pId !== req.user!.id) {
        notifyUser(db, {
          userId: pId,
          type: status === 'pending_request' ? 'message_request' : 'new_message',
          title: status === 'pending_request' ? `Yeni Mesaj İsteği: ${cleanTitle}` : `Yeni Görüşme: ${cleanTitle}`,
          body: `${req.user!.firstName} ${req.user!.lastName}`.trim() + (initialMessage ? `: ${String(initialMessage).trim().slice(0, 70)}` : ' sizinle görüşme başlattı.'),
          linkView: 'messages',
          linkEntityId: convId,
        });
      }
    }

    emitConversationForParticipants(created, 'conversation:created', req.user!.id);

    return res.status(201).json({
      conversation: mapConversation(db, created, req.user!.id, hub?.isUserOnline),
    });
  });

  // Respond to pending message request: accept | decline | block
  router.post('/conversations/:id/respond', requireAuth, (req: AuthedRequest, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as any;
    if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

    const participants = parseJson<string[]>(conv.participant_user_ids_json, []);
    if (!participants.includes(req.user!.id)) {
      return res.status(403).json({ error: 'Bu görüşmeye yanıt verme yetkiniz yok.' });
    }
    if (conv.created_by_user_id === req.user!.id) {
      return res.status(403).json({ error: 'Kendi başlattığınız isteği onaylayamazsınız.' });
    }

    const decision = req.body?.decision;
    if (!['accept', 'decline', 'block'].includes(decision)) {
      return res.status(400).json({ error: 'Geçersiz karar. accept, decline veya block olmalıdır.' });
    }

    const nextStatus = decision === 'accept' ? 'active' : 'declined';
    db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(nextStatus, conv.id);

    if (decision === 'block' && conv.created_by_user_id) {
      const targetId = conv.created_by_user_id;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO user_blocks (blocker_user_id, blocked_user_id, reason, created_at)
        VALUES (?, ?, ?, ?)
      `).run(req.user!.id, targetId, 'Mesaj isteğinden engellendi', now);
      db.prepare(
        'DELETE FROM follows WHERE (follower_user_id = ? AND following_user_id = ?) OR (follower_user_id = ? AND following_user_id = ?)'
      ).run(req.user!.id, targetId, targetId, req.user!.id);
    }

    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id) as any;
    const hub = getHub(db, providedHub);
    emitConversationForParticipants(updated, 'conversation:updated', req.user!.id);

    return res.json({
      success: true,
      conversation: mapConversation(db, updated, req.user!.id, hub?.isUserOnline),
    });
  });

  // Mark conversation as read
  router.post('/conversations/:id/read', requireAuth, (req: AuthedRequest, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as any;
    if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

    const participants = parseJson<string[]>(conv.participant_user_ids_json, []);
    const isStaff = ['admin', 'moderator', 'support'].includes(req.user!.activeRole);
    if (!participants.includes(req.user!.id) && !isStaff) {
      return res.status(403).json({ error: 'Bu görüşmeye erişim yetkiniz yok.' });
    }

    const latestMsg = db
      .prepare('SELECT id, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(conv.id) as { id: string; created_at: string } | undefined;

    const lastReadMessageId = req.body?.lastReadMessageId || latestMsg?.id || null;
    const now = new Date().toISOString();
    const lastReadAt = latestMsg && latestMsg.created_at > now ? latestMsg.created_at : now;

    db.prepare(`
      INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id, last_read_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id, user_id) DO UPDATE SET
        last_read_message_id = excluded.last_read_message_id,
        last_read_at = excluded.last_read_at
    `).run(conv.id, req.user!.id, lastReadMessageId, lastReadAt);

    const hub = getHub(db, providedHub);
    if (hub) {
      hub.sendToUsers(participants, {
        type: 'conversation:read',
        payload: {
          conversationId: conv.id,
          userId: req.user!.id,
          lastReadMessageId,
          lastReadAt,
        },
      });
    }

    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id);
    return res.json({
      success: true,
      conversation: mapConversation(db, updated, req.user!.id, hub?.isUserOnline),
    });
  });

  // Send message (supports attachment + reply quote + read receipt + WS broadcast)
  router.post('/conversations/:id/messages', requireAuth, messageLimiter, (req: AuthedRequest, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as any;
    if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

    const participants = parseJson<string[]>(conv.participant_user_ids_json, []);
    const isStaff = ['admin', 'moderator', 'support'].includes(req.user!.activeRole);
    if (!participants.includes(req.user!.id) && !isStaff) {
      return res.status(403).json({ error: 'Bu görüşmeye mesaj gönderme yetkiniz yok.' });
    }
    if (conv.status === 'declined') {
      return res.status(403).json({ error: 'Reddedilen görüşmeye mesaj gönderilemez.' });
    }

    for (const pId of participants) {
      if (pId !== req.user!.id && isBlockedBetween(db, req.user!.id, pId)) {
        return res.status(403).json({ error: 'Engelleme durumu nedeniyle bu görüşmeye mesaj gönderilemez.' });
      }
    }

    const { body = '', attachmentUrl, attachmentName, attachmentType, replyToMessageId } = req.body || {};
    const cleanBody = String(body || '').trim();
    if (!cleanBody && !attachmentUrl) {
      return res.status(400).json({ error: 'Mesaj içeriği veya dosya eki zorunludur.' });
    }

    let validReplyId: string | null = null;
    if (replyToMessageId) {
      const target = db
        .prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ?')
        .get(String(replyToMessageId), conv.id) as { id: string } | undefined;
      if (!target) {
        return res.status(400).json({ error: 'Yanıtlanan mesaj bu görüşmede bulunamadı.' });
      }
      validReplyId = target.id;
    }

    // Auto-accept pending_request if the recipient replies
    if (conv.status === 'pending_request' && conv.created_by_user_id !== req.user!.id) {
      db.prepare("UPDATE conversations SET status = 'active' WHERE id = ?").run(conv.id);
    }

    const now = new Date().toISOString();
    const senderName = `${req.user!.firstName} ${req.user!.lastName}`.trim();
    const msgId = newId('msg');

    db.prepare(`
      INSERT INTO messages (
        id, conversation_id, sender_user_id, sender_name, body,
        attachment_url, attachment_name, attachment_type, reply_to_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msgId,
      conv.id,
      req.user!.id,
      senderName,
      cleanBody,
      attachmentUrl || null,
      attachmentName || null,
      attachmentType || null,
      validReplyId,
      now
    );

    db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(now, conv.id);

    db.prepare(`
      INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id, last_read_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id, user_id) DO UPDATE SET
        last_read_message_id = excluded.last_read_message_id,
        last_read_at = excluded.last_read_at
    `).run(conv.id, req.user!.id, msgId, now);

    const previewText = cleanBody || (attachmentName ? `📎 ${attachmentName}` : 'Ek gönderildi');
    for (const pId of participants) {
      if (pId !== req.user!.id) {
        notifyUser(db, {
          userId: pId,
          type: 'new_message',
          title: `Yeni Mesaj: ${conv.title}`,
          body: `${senderName}: ${previewText.slice(0, 80)}`,
          linkView: 'messages',
          linkEntityId: conv.id,
        });
      }
    }

    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id) as any;
    const hub = getHub(db, providedHub);

    if (hub) {
      for (const pId of participants) {
        const mapped = mapConversation(db, updated, pId, hub.isUserOnline);
        const msg = mapped.messages.find((m) => m.id === msgId);
        hub.sendToUser(pId, {
          type: 'message:created',
          payload: { conversationId: conv.id, message: msg, conversation: mapped },
        });
      }
    }

    const viewerMapped = mapConversation(db, updated, req.user!.id, hub?.isUserOnline);
    const createdMessage = viewerMapped.messages.find((m) => m.id === msgId);
    return res.status(201).json({
      message: createdMessage,
      conversation: viewerMapped,
    });
  });

  // Edit a message (sender only, non-deleted)
  router.patch('/conversations/:id/messages/:messageId', requireAuth, (req: AuthedRequest, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as any;
    if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

    const msg = db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.messageId, conv.id) as any;
    if (!msg) return res.status(404).json({ error: 'Mesaj bulunamadı.' });
    if (msg.deleted_at) return res.status(400).json({ error: 'Silinmiş mesaj düzenlenemez.' });
    if (msg.sender_user_id !== req.user!.id) {
      return res.status(403).json({ error: 'Sadece kendi gönderdiğiniz mesajları düzenleyebilirsiniz.' });
    }

    const cleanBody = String(req.body?.body || '').trim();
    if (!cleanBody) return res.status(400).json({ error: 'Mesaj içeriği boş olamaz.' });

    const editedAt = new Date().toISOString();
    db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(cleanBody, editedAt, msg.id);

    const participants = parseJson<string[]>(conv.participant_user_ids_json, []);
    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id) as any;
    const hub = getHub(db, providedHub);

    if (hub) {
      for (const pId of participants) {
        const mapped = mapConversation(db, updated, pId, hub.isUserOnline);
        const mappedMsg = mapped.messages.find((m) => m.id === msg.id);
        hub.sendToUser(pId, {
          type: 'message:updated',
          payload: { conversationId: conv.id, message: mappedMsg, conversation: mapped },
        });
      }
    }

    const viewerMapped = mapConversation(db, updated, req.user!.id, hub?.isUserOnline);
    return res.json({
      message: viewerMapped.messages.find((m) => m.id === msg.id),
      conversation: viewerMapped,
    });
  });

  // Soft-delete a message (sender or staff)
  router.delete('/conversations/:id/messages/:messageId', requireAuth, (req: AuthedRequest, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as any;
    if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

    const msg = db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.messageId, conv.id) as any;
    if (!msg) return res.status(404).json({ error: 'Mesaj bulunamadı.' });

    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    if (msg.sender_user_id !== req.user!.id && !isStaff) {
      return res.status(403).json({ error: 'Bu mesajı silme yetkiniz yok.' });
    }

    const deletedAt = new Date().toISOString();
    db.prepare(
      'UPDATE messages SET body = ?, attachment_url = NULL, attachment_name = NULL, attachment_type = NULL, deleted_at = ? WHERE id = ?'
    ).run('', deletedAt, msg.id);

    const participants = parseJson<string[]>(conv.participant_user_ids_json, []);
    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id) as any;
    const hub = getHub(db, providedHub);

    if (hub) {
      for (const pId of participants) {
        const mapped = mapConversation(db, updated, pId, hub.isUserOnline);
        hub.sendToUser(pId, {
          type: 'message:deleted',
          payload: { conversationId: conv.id, messageId: msg.id, deletedAt, conversation: mapped },
        });
      }
    }

    return res.json({
      success: true,
      conversation: mapConversation(db, updated, req.user!.id, hub?.isUserOnline),
    });
  });

  // Toggle emoji reaction on a message
  router.post('/conversations/:id/messages/:messageId/reactions', requireAuth, (req: AuthedRequest, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as any;
    if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

    const participants = parseJson<string[]>(conv.participant_user_ids_json, []);
    if (!participants.includes(req.user!.id)) {
      return res.status(403).json({ error: 'Bu görüşmeye tepki ekleme yetkiniz yok.' });
    }

    const msg = db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.messageId, conv.id) as any;
    if (!msg || msg.deleted_at) {
      return res.status(404).json({ error: 'Mesaj bulunamadı.' });
    }

    const emoji = String(req.body?.emoji || '').trim();
    if (!ALLOWED_REACTIONS.has(emoji)) {
      return res.status(400).json({ error: 'Desteklenmeyen tepki simgesi.' });
    }

    const reactions = parseJson<Record<string, string[]>>(msg.reactions_json, {});
    const currentList = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
    const hasReacted = currentList.includes(req.user!.id);

    if (hasReacted) {
      const next = currentList.filter((id) => id !== req.user!.id);
      if (next.length === 0) {
        delete reactions[emoji];
      } else {
        reactions[emoji] = next;
      }
    } else {
      reactions[emoji] = [...currentList, req.user!.id];
    }

    db.prepare('UPDATE messages SET reactions_json = ? WHERE id = ?').run(JSON.stringify(reactions), msg.id);

    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id) as any;
    const hub = getHub(db, providedHub);
    if (hub) {
      for (const pId of participants) {
        const mapped = mapConversation(db, updated, pId, hub.isUserOnline);
        hub.sendToUser(pId, {
          type: 'message:reaction',
          payload: { conversationId: conv.id, messageId: msg.id, reactions, conversation: mapped },
        });
      }
    }

    return res.json({
      reactions,
      conversation: mapConversation(db, updated, req.user!.id, hub?.isUserOnline),
    });
  });

  // Add member to group conversation
  router.post('/conversations/:id/members', requireAuth, (req: AuthedRequest, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as any;
    if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

    const participants = parseJson<string[]>(conv.participant_user_ids_json, []);
    if (conv.conversation_type !== 'group' && participants.length <= 2) {
      return res.status(400).json({ error: 'Sadece grup görüşmelerine üye eklenebilir.' });
    }

    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    if (!participants.includes(req.user!.id) && !isStaff) {
      return res.status(403).json({ error: 'Bu gruba üye ekleme yetkiniz yok.' });
    }

    const targetUserId = String(req.body?.userId || '').trim();
    if (!targetUserId) return res.status(400).json({ error: 'Eklenecek kullanıcı kimliği zorunludur.' });

    const targetUser = db
      .prepare("SELECT id FROM users WHERE id = ? AND status = 'active'")
      .get(targetUserId);
    if (!targetUser) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

    for (const pId of participants) {
      if (isBlockedBetween(db, pId, targetUserId)) {
        return res.status(403).json({ error: 'Engelleme durumu nedeniyle bu kullanıcı gruba eklenemez.' });
      }
    }

    if (!participants.includes(targetUserId)) {
      const nextParticipants = [...participants, targetUserId];
      db.prepare('UPDATE conversations SET participant_user_ids_json = ? WHERE id = ?').run(
        JSON.stringify(nextParticipants),
        conv.id
      );
    }

    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id) as any;
    const hub = getHub(db, providedHub);
    emitConversationForParticipants(updated, 'conversation:updated', req.user!.id);

    return res.json({
      conversation: mapConversation(db, updated, req.user!.id, hub?.isUserOnline),
    });
  });

  // Remove member or leave group conversation
  router.delete('/conversations/:id/members/:userId', requireAuth, (req: AuthedRequest, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as any;
    if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

    const participants = parseJson<string[]>(conv.participant_user_ids_json, []);
    if (conv.conversation_type !== 'group' && participants.length <= 2) {
      return res.status(400).json({ error: 'Sadece grup görüşmelerinden üye çıkarılabilir.' });
    }

    const targetUserId = req.params.userId;
    const isSelf = targetUserId === req.user!.id;
    const isCreator = conv.created_by_user_id === req.user!.id;
    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);

    if (!isSelf && !isCreator && !isStaff) {
      return res.status(403).json({ error: 'Bu üyeyi gruptan çıkarma yetkiniz yok.' });
    }

    const nextParticipants = participants.filter((id) => id !== targetUserId);
    db.prepare('UPDATE conversations SET participant_user_ids_json = ? WHERE id = ?').run(
      JSON.stringify(nextParticipants),
      conv.id
    );

    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id) as any;
    const hub = getHub(db, providedHub);
    emitConversationForParticipants(updated, 'conversation:updated', req.user!.id);
    if (hub) {
      hub.sendToUser(targetUserId, {
        type: 'conversation:updated',
        payload: { conversationId: conv.id, removed: true },
      });
    }

    return res.json({
      success: true,
      conversation: mapConversation(db, updated, req.user!.id, hub?.isUserOnline),
    });
  });

  // 12.9 Notifications
  router.post('/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
    return res.json({ success: true });
  });

  router.post('/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    return res.json({ success: true });
  });

  // Contact form persistence
  router.post('/contact', contactLimiter, (req, res) => {
    const { name, email, phone = '', subject, message } = req.body || {};
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Ad, e-posta, konu ve mesaj alanları zorunludur.' });
    }
    const id = newId('cnt');
    db.prepare(`
      INSERT INTO contact_messages (id, name, email, phone, subject, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(name).trim(),
      String(email).trim(),
      String(phone).trim(),
      String(subject).trim(),
      String(message).trim(),
      new Date().toISOString()
    );

    notifyUser(db, {
      userId: 'user_admin',
      type: 'contact_message',
      title: `Yeni İletişim Talebi: ${subject}`,
      body: `${name} (${email}) iletişim formu üzerinden mesaj gönderdi.`,
      linkView: 'admin_panel',
    });

    return res.status(201).json({ id, success: true });
  });

  // 14. Optional Server-Side Gemini AI Draft Helper
  router.post('/ai/draft', requireAuth, requireFeatureFlag(db, 'ai_draft_assistant'), async (req: AuthedRequest, res) => {
    const { kind, context = {} } = req.body || {};
    const allowed: DraftKind[] = ['cover_letter', 'listing_brief', 'project_brief', 'technical_rider', 'press_bio'];
    if (!allowed.includes(kind)) {
      return res.status(400).json({ error: 'Geçersiz taslak türü.' });
    }
    const result = await generateDraftText(kind, context);
    return res.json(result);
  });

  return router;
}
