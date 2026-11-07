import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

/**
 * Object storage for uploaded media. Local disk in dev/test; an S3-compatible adapter for
 * Cloudflare R2 is added at deployment (D-053) behind this same interface.
 */
export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The object's bytes, or null when it doesn't exist. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

/**
 * Keys we generate: `<uuid>/<uuid>.webp` (images) or `.mp4` (status videos, D-123). Anything
 * else is rejected (no path traversal).
 */
const STORAGE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|mp4)$/;
/** Only images are served publicly at /media; videos stay inside the app. */
export const IMAGE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/;

export class LocalDiskStorage implements StorageProvider {
  private readonly root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  private file(key: string) {
    if (!STORAGE_KEY.test(key)) throw new Error('invalid storage key');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

/**
 * Images in Postgres (D-119), for hosting whose disk doesn't survive a restart (free plans).
 * Fine for test volumes; object storage (R2, D-011) replaces it for real traffic.
 */
export class DatabaseStorage implements StorageProvider {
  constructor(private readonly prisma: PrismaClient) {}

  private check(key: string) {
    if (!STORAGE_KEY.test(key)) throw new Error('invalid storage key');
    return key;
  }

  async put(key: string, body: Buffer, contentType: string) {
    const k = this.check(key);
    const bytes = new Uint8Array(body); // Prisma's Bytes type wants a plain ArrayBuffer view
    await this.prisma.storedObject.upsert({
      where: { key: k },
      create: { key: k, body: bytes, contentType },
      update: { body: bytes, contentType },
    });
  }

  async get(key: string) {
    const row = await this.prisma.storedObject.findUnique({
      where: { key: this.check(key) },
      select: { body: true },
    });
    return row ? Buffer.from(row.body) : null;
  }

  async delete(key: string) {
    await this.prisma.storedObject.deleteMany({ where: { key: this.check(key) } });
  }
}
