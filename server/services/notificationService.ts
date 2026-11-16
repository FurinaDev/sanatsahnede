import { DbInstance } from '../db/database';
import { newId } from '../utils/crypto';
import { getDbRealtimeHub } from './realtimeHub';

function shouldDeliverNotification(db: DbInstance, userId: string, type: string): boolean {
  const pref = db
    .prepare(
      `SELECT notif_messages, notif_bookings, notif_followers, notif_community, notif_emergency
       FROM user_preferences WHERE user_id = ?`
    )
    .get(userId) as
    | {
        notif_messages: number;
        notif_bookings: number;
        notif_followers: number;
        notif_community: number;
        notif_emergency: number;
      }
    | undefined;
  if (!pref) return true;

  if (type === 'new_follower') return Boolean(pref.notif_followers);
  if (type === 'new_message' || type === 'message_request') return Boolean(pref.notif_messages);
  if (type === 'emergency_replacement') return Boolean(pref.notif_emergency);
  if (type.startsWith('community_')) return Boolean(pref.notif_community);
  if (
    type === 'new_application' ||
    type === 'application_shortlisted' ||
    type === 'application_selected' ||
    type === 'booking_confirmed' ||
    type === 'completion_waiting' ||
    type === 'new_offer' ||
    type === 'offer_accepted' ||
    type === 'offer_countered'
  ) {
    return Boolean(pref.notif_bookings);
  }
  return true;
}

export function notifyUser(
  db: DbInstance,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    linkView?: string;
    linkEntityId?: string;
  }
): void {
  if (!input.userId) return;
  if (!shouldDeliverNotification(db, input.userId, input.type)) return;
  const id = newId('not');
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, link_view, link_entity_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    input.userId,
    input.type,
    input.title,
    input.body,
    input.linkView ?? null,
    input.linkEntityId ?? null,
    createdAt
  );

  const hub = getDbRealtimeHub(db);
  if (hub) {
    hub.sendToUser(input.userId, {
      type: 'notification:created',
      payload: {
        notification: {
          id,
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          linkView: input.linkView,
          linkEntityId: input.linkEntityId,
          isRead: false,
          createdAt,
        },
      },
    });
  }
}
