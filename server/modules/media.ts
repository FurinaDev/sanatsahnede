import { Router } from 'express';
import multer from 'multer';
import { DbInstance } from '../db/database';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { logAudit } from '../services/auditService';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  createStorageAdapter,
  MAX_UPLOAD_SIZE_BYTES,
  StorageAdapter,
  verifyMagicBytes,
} from '../services/storageAdapter';
import { newId } from '../utils/crypto';

export function mapMediaAsset(row: any) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    storageProvider: row.storage_provider,
    url: row.url,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    originalName: row.original_name,
    category: row.category,
    createdAt: row.created_at,
  };
}

export function createMediaRouter(db: DbInstance, storage?: StorageAdapter): Router {
  const router = Router();
  const adapter = storage || createStorageAdapter();

  const uploadLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
    message: 'Çok fazla dosya yükleme denemesi yapıldı. Lütfen biraz bekleyin.',
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  });

  router.post(
    '/upload',
    requireAuth,
    uploadLimiter,
    (req, res, next) => {
      upload.single('file')(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Dosya boyutu en fazla 10 MB olabilir.' });
          }
          return res.status(400).json({ error: err.message || 'Dosya yüklenemedi.' });
        }
        next();
      });
    },
    async (req: AuthedRequest, res) => {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'Yüklenecek dosya bulunamadı (file alanı zorunludur).' });
      }

      const mimeType = String(file.mimetype || '').toLowerCase();
      if (!ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) {
        return res.status(400).json({
          error: 'Desteklenmeyen dosya türü. İzin verilenler: JPEG, PNG, WEBP, GIF, PDF, MP3, M4A, WAV, OGG.',
        });
      }

      if (!verifyMagicBytes(file.buffer, mimeType)) {
        return res.status(400).json({
          error: 'Dosya içeriği beyan edilen dosya türüyle uyuşmuyor.',
        });
      }

      const category = String(req.body?.category || req.query?.category || 'general')
        .replace(/[^a-z0-9_-]/gi, '')
        .toLowerCase() || 'general';

      const stored = await adapter.putObject({
        buffer: file.buffer,
        mimeType,
        originalName: file.originalname || 'dosya',
        category,
      });

      const id = newId('med');
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO media_assets (
          id, owner_user_id, storage_provider, object_key, url, mime_type, size_bytes, original_name, category, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        req.user!.id,
        stored.provider,
        stored.objectKey,
        stored.url,
        stored.mimeType,
        stored.sizeBytes,
        String(file.originalname || 'dosya').slice(0, 180),
        category,
        now
      );

      logAudit(db, {
        userId: req.user!.id,
        action: 'UPLOAD_MEDIA_ASSET',
        resourceType: 'media_asset',
        resourceId: id,
        details: { mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, category },
      });

      const row = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id);
      return res.status(201).json({ asset: mapMediaAsset(row) });
    }
  );

  router.get('/mine', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM media_assets WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user!.id) as any[];
    return res.json({ assets: rows.map(mapMediaAsset) });
  });

  router.delete('/:id', requireAuth, async (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Medya kaydı bulunamadı.' });

    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    if (row.owner_user_id !== req.user!.id && !isStaff) {
      return res.status(403).json({ error: 'Bu medya kaydını silme yetkiniz yok.' });
    }

    await adapter.deleteObject(row.object_key);
    db.prepare('DELETE FROM media_assets WHERE id = ?').run(row.id);

    logAudit(db, {
      userId: req.user!.id,
      action: 'DELETE_MEDIA_ASSET',
      resourceType: 'media_asset',
      resourceId: row.id,
    });

    return res.json({ success: true });
  });

  return router;
}
