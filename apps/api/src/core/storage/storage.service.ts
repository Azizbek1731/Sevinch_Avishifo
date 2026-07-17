import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { Readable } from 'node:stream';
import { AppConfigService } from '../config/app-config.service';

export interface StoredFile {
  /** Storage key, e.g. "clinic-uuid/patients/file-uuid.pdf" */
  key: string;
}

/**
 * Abstract file storage (spec §3): local disk in dev, S3-compatible in prod.
 * Keys are always `${clinicId}/${entity}/${uuid}` — download endpoints re-verify
 * tenant ownership before streaming.
 */
export abstract class StorageService {
  abstract put(key: string, data: Buffer): Promise<StoredFile>;
  abstract getStream(key: string): Readable;
  abstract delete(key: string): Promise<void>;
}

@Injectable()
export class LocalStorageService extends StorageService {
  constructor(private readonly config: AppConfigService) {
    super();
  }

  private resolvePath(key: string): string {
    const safe = normalize(key).replace(/^(\.\.[/\\])+/, '');
    if (safe.includes('..')) throw new Error('Invalid storage key');
    return join(this.config.uploadsDir, safe);
  }

  async put(key: string, data: Buffer): Promise<StoredFile> {
    const path = this.resolvePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { key };
  }

  getStream(key: string): Readable {
    return createReadStream(this.resolvePath(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolvePath(key)).catch(() => undefined);
  }
}
