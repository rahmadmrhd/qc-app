import { describe, expect, test, vi } from 'vitest';
import type { LoadedPackage } from './local-folder';
import { createPackageSession } from './package-session';

const pkg = (dir: string): LoadedPackage => ({
  dir,
  config: {} as LoadedPackage['config'],
  scripts: {},
  missing: [],
  warnings: [],
});

describe('createPackageSession', () => {
  test('tanpa folder tersimpan = null dan tak memuat apa pun', async () => {
    const loadPackage = vi.fn(async (dir: string) => pkg(dir));
    const session = createPackageSession({ packageDir: () => null, loadPackage });
    expect(await session.ensure()).toBeNull();
    expect(loadPackage).not.toHaveBeenCalled();
    expect(session.peek()).toBeNull();
  });

  test('ensure memuat sekali lalu memakai salinan memori; reload memaksa muat ulang', async () => {
    const loadPackage = vi.fn(async (dir: string) => pkg(dir));
    const session = createPackageSession({ packageDir: () => 'D:Paket', loadPackage });
    const first = await session.ensure();
    expect(await session.ensure()).toBe(first);
    expect(loadPackage).toHaveBeenCalledTimes(1);
    const second = await session.reload();
    expect(second).not.toBe(first);
    expect(loadPackage).toHaveBeenCalledTimes(2);
    expect(session.peek()).toBe(second);
  });

  test('adopt menetapkan paket aktif tanpa memuat; reload gagal tidak meninggalkan paket lama', async () => {
    const loadPackage = vi.fn(async () => {
      throw new Error('rusak');
    });
    const session = createPackageSession({ packageDir: () => 'D:Paket', loadPackage });
    const chosen = pkg('D:Lain');
    session.adopt(chosen);
    expect(await session.ensure()).toBe(chosen);
    expect(loadPackage).not.toHaveBeenCalled();
    await expect(session.reload()).rejects.toThrow('rusak');
    expect(session.peek()).toBeNull();
  });
});
