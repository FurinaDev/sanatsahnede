import { DbInstance } from '../db/database';
import { newId } from '../utils/crypto';
import { getDbRealtimeHub } from './realtimeHub';

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
