import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface StoredMediaObject {
  provider: 'local' | 's3';
  objectKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageAdapter {
  readonly providerName: 'local' | 's3';
  putObject(params: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    category?: string;
  }): Promise<StoredMediaObject>;
  deleteObject(objectKey: string): Promise<void>;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
};

export const ALLOWED_UPLOAD_MIME_TYPES = new Set(Object.keys(MIME_TO_EXT));
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Lightweight magic-byte inspection so renamed executable/HTML files cannot spoof image/PDF MIME types.
 */
export function verifyMagicBytes(buffer: Buffer, declaredMime: string): boolean {
  if (!buffer || buffer.length < 4) return false;

  switch (declaredMime) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      );
    case 'image/gif':
      return (
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x38
      );
    case 'image/webp':
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'application/pdf':
      return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    case 'audio/mpeg':
      return (
        (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) || // ID3
        (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) // MPEG frame sync
      );
    case 'audio/wav':
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WAVE'
      );
    case 'audio/ogg':
      return buffer.subarray(0, 4).toString('ascii') === 'OggS';
    case 'audio/mp4':
      return buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    default:
      return false;
  }
}

export function getUploadRoot(customDir?: string): string {
  return path.resolve(customDir || process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
}

export class LocalDiskStorageAdapter implements StorageAdapter {
  readonly providerName = 'local' as const;
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = getUploadRoot(rootDir);
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  async putObject(params: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    category?: string;
  }): Promise<StoredMediaObject> {
    const ext = MIME_TO_EXT[params.mimeType];
    if (!ext) {
      throw new Error('Desteklenmeyen dosya türü.');
    }

    const now = new Date();
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const safeCategory = (params.category || 'general').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'general';
    const fileName = `${crypto.randomUUID()}.${ext}`;
    const objectKey = `${safeCategory}/${ym}/${fileName}`;
    const fullPath = path.resolve(this.rootDir, objectKey);

    if (!fullPath.startsWith(this.rootDir + path.sep)) {
      throw new Error('Geçersiz dosya yolu.');
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, params.buffer);

    return {
      provider: 'local',
      objectKey,
      url: `/uploads/${objectKey}`,
      mimeType: params.mimeType,
      sizeBytes: params.buffer.length,
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    const normalized = objectKey.replace(/^\/+/, '');
    const fullPath = path.resolve(this.rootDir, normalized);
    if (!fullPath.startsWith(this.rootDir + path.sep)) {
      return;
    }
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
}

export function createStorageAdapter(uploadDir?: string): StorageAdapter {
  // Future S3 / Cloudflare R2 adapter can be switched via process.env.STORAGE_PROVIDER === 's3'
  return new LocalDiskStorageAdapter(uploadDir);
}
