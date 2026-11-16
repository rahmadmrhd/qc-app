// Penyimpanan token Bearer desktop. Token hanya hidup di proses utama: tidak pernah ke renderer,
// log, atau galat. Di disk selalu terenkripsi (`safeStorage` Electron, disuntik lewat `crypto`);
// bila enkripsi tak tersedia (`crypto === null`) token hanya di memori dan tidak menulis disk.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StoredToken {
  token: string;
  email: string;
  /** Epoch ms kedaluwarsa (dari server). */
  expiresAt: number;
}

export interface TokenStore {
  get(): StoredToken | null;
  set(value: StoredToken): void;
  clear(): void;
}

/** Bentuk `safeStorage` yang dipakai; mudah ditiru di tes. */
export interface TokenCrypto {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

function isStoredToken(value: unknown): value is StoredToken {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.token === 'string' &&
    v.token !== '' &&
    typeof v.email === 'string' &&
    typeof v.expiresAt === 'number' &&
    Number.isFinite(v.expiresAt)
  );
}

export function createTokenStore(
  file: string,
  crypto: TokenCrypto | null,
  now: () => number = Date.now,
): TokenStore {
  let current: StoredToken | null = null;

  const removeFile = (): void => {
    try {
      rmSync(file, { force: true });
    } catch {
      // Berkas tak dapat dihapus: tetap dianggap kosong di memori.
    }
  };

  if (crypto) {
    try {
      const wrapper = JSON.parse(readFileSync(file, 'utf8')) as { data?: unknown };
      if (typeof wrapper.data === 'string') {
        const plain = crypto.decrypt(Buffer.from(wrapper.data, 'base64'));
        const parsed: unknown = JSON.parse(plain);
        if (isStoredToken(parsed)) current = parsed;
      }
    } catch {
      // Berkas tak ada, rusak, atau tak dapat didekripsi (mis. profil OS lain): anggap kosong.
      current = null;
    }
  }

  const live = (): StoredToken | null => {
    if (current && current.expiresAt <= now()) {
      current = null;
      removeFile();
    }
    return current;
  };

  return {
    get() {
      const value = live();
      return value ? { ...value } : null;
    },
    set(value) {
      current = { token: value.token, email: value.email, expiresAt: value.expiresAt };
      if (!crypto) return;
      try {
        const data = crypto.encrypt(JSON.stringify(current)).toString('base64');
        mkdirSync(dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, `${JSON.stringify({ v: 1, data })}\n`, 'utf8');
        renameSync(temp, file);
      } catch {
        // Enkripsi/tulis gagal: token tetap di memori saja, tidak pernah ditulis polos.
      }
    },
    clear() {
      current = null;
      removeFile();
    },
  };
}
