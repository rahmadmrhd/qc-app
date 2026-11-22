import { type NavigateOptions, useRouter } from '@tanstack/react-router';
import { useMemo } from 'react';
import { popTo, pushTo, replaceTo, type StackNavigator } from '@/lib/stack-nav';

/** Pathname dari opsi navigasi: `to` dengan parameter `$x` diisi (cukup untuk membandingkan layar). */
function pathOfOptions(options: NavigateOptions): string {
  const to = typeof options.to === 'string' ? options.to : '/';
  const params = (options as { params?: unknown }).params;
  const bag = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const path = to.replace(/\$([A-Za-z0-9_]+)/g, (_, name: string) => String(bag[name] ?? ''));
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Satu pintu navigasi untuk aturan riwayat-sebagai-tumpukan (butir 41c): `push` (maju), `replace` (ganti layar,
 * filter/tab/cari, ganti modul, simpan form Tambah) dan `pop` (kembali ke asal: simpan form Ubah, hapus dari View,
 * Batal; `history.back()` bila entri sebelumnya memang tujuannya, selain itu replace). Semuanya menunggu overlay
 * terbuka dilepas dulu. Lewat `router.navigate` sehingga penghalang (draf kotor) tetap berlaku.
 */
export function useStackNavigation() {
  const router = useRouter();
  return useMemo(() => {
    const nav: StackNavigator<NavigateOptions> = {
      go: (target, { replace }) => void router.navigate({ ...target, replace }),
      pathOf: pathOfOptions,
    };
    return {
      push: (target: NavigateOptions) => pushTo(nav, target),
      replace: (target: NavigateOptions) => replaceTo(nav, target),
      pop: (target: NavigateOptions) => popTo(nav, target),
    };
  }, [router]);
}
