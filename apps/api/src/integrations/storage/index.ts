import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

/** Keys we generate: `<uuid>/<uuid>.webp`. Anything else is rejected (no path traversal). */
export const STORAGE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/;

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
