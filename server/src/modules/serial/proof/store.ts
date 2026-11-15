import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Penyimpanan sementara foto bukti QC di disk server (rancangan 2026-11-16 §4 dan §6.5): unggahan `draft` dan hasil
 * bercap yang belum naik ke Drive disimpan di volume `PROOF_STAGING_DIR` (bukan di MariaDB: dump cadangan malam tak
 * membengkak). Nama berkas SELALU buatan server (`newStagedName`, UUID acak) dan tidak pernah berasal dari klien;
 * `read`/`write`/`remove` menolak nama selain pola UUID sehingga jalur berkas tak dapat dilintasi (`../`, nama
 * absolut, atau karakter pemisah jalur).
 */
export interface ProofStore {
  /** Menulis atomik (berkas sementara `.partial` lalu rename); menimpa nama yang sama. Folder dibuat bila belum ada. */
  write(name: string, bytes: Uint8Array): Promise<void>;
  /** Isi berkas, atau `null` bila tidak ada. */
  read(name: string): Promise<Uint8Array | null>;
  /** Menghapus berkas; tidak melempar bila sudah tidak ada. */
  remove(name: string): Promise<void>;
  /** Total ukuran seluruh berkas di folder (byte), termasuk sisa `.partial`; folder belum ada = 0. */
  totalBytes(): Promise<number>;
}

const NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Nama berkas sementara baru: UUID acak buatan server. */
export function newStagedName(): string {
  return crypto.randomUUID();
}

/** True bila `name` berpola nama buatan server (UUID huruf kecil). */
export function isStagedName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

function assertName(name: string): void {
  if (!isStagedName(name)) throw new Error('Nama berkas sementara tidak valid');
}

function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ENOENT';
}

export function createProofStore(dir: string): ProofStore {
  return {
    async write(name, bytes) {
      assertName(name);
      await mkdir(dir, { recursive: true });
      const target = join(dir, name);
      const partial = `${target}.${crypto.randomUUID()}.partial`;
      try {
        await writeFile(partial, bytes);
        await rename(partial, target);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
    },
    async read(name) {
      assertName(name);
      try {
        return new Uint8Array(await readFile(join(dir, name)));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async remove(name) {
      assertName(name);
      await rm(join(dir, name), { force: true });
    },
    async totalBytes() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if (isMissing(error)) return 0;
        throw error;
      }
      let total = 0;
      for (const name of names) {
        try {
          const info = await stat(join(dir, name));
          if (info.isFile()) total += info.size;
        } catch (error) {
          if (!isMissing(error)) throw error; // berkas hilang di sela daftar dan stat: abaikan
        }
      }
      return total;
    },
  };
}
