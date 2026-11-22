import { useRouter } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import { isStandalone } from '@/app/pwa/install';

/** Atribut `<a>` (di luar `href`, yang ditulis eksplisit oleh pemakai) untuk tautan "Buka" ke halaman lihat record. */
export interface OpenLinkProps {
  target?: '_blank';
  rel?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Pembuat atribut tautan "Buka" untuk field relasi (`LinkField`/`LinkMultiField`). Di tab peramban tautan membuka tab
 * baru agar isian form tidak hilang. Di aplikasi terpasang (PWA standalone) tidak ada tab: `target="_blank"` membuka
 * jendela baru (desktop) atau memuat ulang aplikasi di tampilan terpisah (ponsel). Di sana tautan berpindah di tempat
 * lewat router (riwayat bertambah satu entri, tombol kembali pulang ke form, dan penjaga "ada perubahan belum
 * disimpan" tetap berlaku); klik dengan tombol pengubah (Ctrl/Cmd/Shift/Alt) atau bukan tombol utama dibiarkan
 * ditangani peramban.
 */
export function useOpenLinkProps(): (href: string) => OpenLinkProps {
  // `warn: false`: komponen ini juga dirender tanpa router (tes komponen); tanpa router tautan berperilaku seperti di tab.
  const router = useRouter({ warn: false });
  const inPlace = Boolean(router) && typeof window !== 'undefined' && isStandalone(window);
  return (href) => {
    if (!inPlace || !router) return { target: '_blank', rel: 'noreferrer' };
    return {
      onClick: (event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        // `history.push` (bukan `navigate({ to })`): `href` boleh memuat query (mis. `/item/brands?id=a`).
        router.history.push(href);
      },
    };
  };
}
