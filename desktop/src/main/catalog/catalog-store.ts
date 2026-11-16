// Cache lokal katalog Tipe offline (spek desktop §6.6): `catalog.json` (potret + ETag + waktu sinkron) dan folder
// `files/<id>` berisi gambar. Semua tulis atomik (berkas sementara lalu rename), sehingga crash di tengah tidak
// meninggalkan potret setengah jadi; potret yang rusak/tak lolos validasi dianggap tak ada. Jalur berkas SELALU dibangun
// dari id yang lolos `CATALOG_FILE_ID` (tak pernah dari input mentah), dan tak ada jalur yang keluar dari folder ini.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  CATALOG_FILE_ID,
  type DesktopCatalogDto,
  parseDesktopCatalog,
} from '@shared/desktop-catalog';

export interface StoredCatalog {
  catalog: DesktopCatalogDto;
  etag: string;
  syncedAt: string;
}

export interface CatalogStore {
  read(): StoredCatalog | null;
  write(stored: StoredCatalog): void;
  /** Berkas tersimpan dengan ukuran persis `size` (unduhan utuh)? */
  hasFile(id: string, size: number): boolean;
  /** Isi berkas + mime menurut potret tersimpan, atau `null` (id tak sah, tak dikenal katalog, atau belum terunduh). */
  readFile(id: string): { data: Buffer; mime: string } | null;
  /** Menyimpan unduhan yang sudah diverifikasi pemanggil (atomik). */
  putFile(id: string, data: Uint8Array): void;
  /** Membuang berkas yang tak dirujuk potret (dan sisa berkas sementara). */
  prune(keep: ReadonlySet<string>): void;
}

const CATALOG_FILE = 'catalog.json';
const FILES_DIR = 'files';

export function createCatalogStore(dir: string): CatalogStore {
  const filesDir = join(dir, FILES_DIR);
  const catalogPath = join(dir, CATALOG_FILE);
  const ensure = (): void => {
    mkdirSync(filesDir, { recursive: true });
  };
  const fileOf = (id: string): string | null =>
    CATALOG_FILE_ID.test(id) ? join(filesDir, id) : null;

  function read(): StoredCatalog | null {
    try {
      const parsed = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, unknown>;
      const catalog = parseDesktopCatalog(parsed.catalog);
      if (
        !catalog ||
        typeof parsed.etag !== 'string' ||
        typeof parsed.syncedAt !== 'string' ||
        parsed.etag === ''
      ) {
        return null;
      }
      return { catalog, etag: parsed.etag, syncedAt: parsed.syncedAt };
    } catch {
      return null;
    }
  }

  return {
    read,
    write(stored) {
      ensure();
      const temp = `${catalogPath}.tmp`;
      writeFileSync(temp, JSON.stringify(stored), 'utf8');
      renameSync(temp, catalogPath);
    },
    hasFile(id, size) {
      const path = fileOf(id);
      if (!path) return false;
      try {
        const info = statSync(path);
        return info.isFile() && info.size === size;
      } catch {
        return false;
      }
    },
    readFile(id) {
      const path = fileOf(id);
      if (!path) return null;
      const known = read()?.catalog.files.find((file) => file.id === id);
      if (!known) return null;
      try {
        return { data: readFileSync(path), mime: known.mime };
      } catch {
        return null;
      }
    },
    putFile(id, data) {
      const path = fileOf(id);
      if (!path) throw new Error('Id berkas katalog tidak sah');
      ensure();
      const temp = `${path}.part`;
      writeFileSync(temp, data);
      renameSync(temp, path);
    },
    prune(keep) {
      if (!existsSync(filesDir)) return;
      for (const name of readdirSync(filesDir)) {
        if (keep.has(name)) continue;
        try {
          rmSync(join(filesDir, name), { force: true });
        } catch {
          // gagal membuang berkas basi tidak menggagalkan sinkron
        }
      }
    },
  };
}
