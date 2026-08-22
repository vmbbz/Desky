import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface EncryptionProvider {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface VaultFile {
  version: 1;
  entries: Record<string, string>;
}

export class SecureVault {
  constructor(
    private readonly filePath: string,
    private readonly encryption: EncryptionProvider,
  ) {}

  get<T>(key: string): T | undefined {
    const encrypted = this.read().entries[key];
    if (!encrypted) return undefined;
    this.assertAvailable();
    try {
      return JSON.parse(this.encryption.decryptString(Buffer.from(encrypted, 'base64'))) as T;
    } catch {
      throw new Error('Stored OpenClaw credentials could not be decrypted. Forget the connection and pair again.');
    }
  }

  set(key: string, value: unknown): void {
    this.assertAvailable();
    const data = this.read();
    data.entries[key] = this.encryption.encryptString(JSON.stringify(value)).toString('base64');
    this.write(data);
  }

  delete(key: string): void {
    const data = this.read();
    if (!(key in data.entries)) return;
    delete data.entries[key];
    this.write(data);
  }

  private assertAvailable(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('Operating-system credential encryption is unavailable. Desky will not persist gateway secrets.');
    }
  }

  private read(): VaultFile {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as VaultFile;
      if (parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return { version: 1, entries: {} };
  }

  private write(data: VaultFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.new`;
    writeFileSync(temporary, `${JSON.stringify(data)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}
