// Paket skrip aktif yang dibagi proses utama: IPC (paket dipilih operator), runner inject, dan mesin Multi membaca paket
// yang SAMA. Satu muatan di memori; `reload` memaksa muat ulang dari folder (dipanggil `package.load`).

import type { LoadedPackage } from './local-folder';

export interface PackageSession {
  /** Paket aktif (dimuat dari folder tersimpan bila belum), atau `null` bila belum dipilih. */
  ensure(): Promise<LoadedPackage | null>;
  /** Membuang salinan memori lalu memuat ulang dari folder tersimpan. */
  reload(): Promise<LoadedPackage | null>;
  /** Menetapkan paket aktif yang baru saja dimuat dari folder pilihan operator. */
  adopt(pkg: LoadedPackage): void;
  /** Paket di memori tanpa memuat apa pun. */
  peek(): LoadedPackage | null;
}

export function createPackageSession(deps: {
  packageDir(): string | null;
  loadPackage(dir: string): Promise<LoadedPackage>;
}): PackageSession {
  let current: LoadedPackage | null = null;
  const session: PackageSession = {
    async ensure() {
      if (current) return current;
      const dir = deps.packageDir();
      if (!dir) return null;
      current = await deps.loadPackage(dir);
      return current;
    },
    async reload() {
      current = null;
      return session.ensure();
    },
    adopt(pkg) {
      current = pkg;
    },
    peek: () => current,
  };
  return session;
}
