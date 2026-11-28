import { useEffect } from 'react';

/** Penanda isian bermasalah: field `aria-invalid` atau pesan galat `FieldError` (urutan dokumen = urutan layar). */
const INVALID_SELECTOR = '[aria-invalid="true"], [data-slot="field-error"]';
/** Jarak aman dari tepi atas/bawah (bar judul, tab, dan bar aksi menempel) agar isian tak tertutup. */
const SAFE_EDGE_PX = 96;
/** Lama menunggu galat tampil setelah Simpan (validasi asinkron + render ulang). */
const WAIT_MS = 1500;

/** Pembuka tab: isian bergalat di panel tab tersembunyi membuka tabnya dulu (klik pemicu yang sama dengan pengguna). */
function revealTab(marker: Element): void {
  const panel = marker.closest<HTMLElement>('[role="tabpanel"]');
  if (!panel || (!panel.hidden && panel.dataset.state !== 'inactive')) return;
  const triggerId = panel.getAttribute('aria-labelledby');
  const trigger = triggerId ? document.getElementById(triggerId) : null;
  trigger?.click();
}

/**
 * Menggulir ke isian bergalat PERTAMA di `root` bila belum terlihat; membuka tab yang memuatnya. Mengembalikan
 * `true` bila ada isian bergalat (terlihat atau digulir), `false` bila tidak ada.
 */
export function revealFirstInvalid(root: ParentNode): boolean {
  const marker = root.querySelector(INVALID_SELECTOR);
  if (!marker) return false;
  revealTab(marker);
  // Setelah tab terbuka tata letak berubah: ukur dan gulir pada frame berikutnya.
  requestAnimationFrame(() => {
    const rect = marker.getBoundingClientRect();
    if (rect.top >= SAFE_EDGE_PX && rect.bottom <= window.innerHeight - SAFE_EDGE_PX) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    marker.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  });
  return true;
}

/**
 * Satu pendengar untuk SEMUA form: saat form dikirim (tombol Simpan, juga yang berada di luar `<form>` lewat
 * atribut `form=`) dan muncul isian bergalat yang tak terlihat, layar digulir ke isian pertama (dan tabnya dibuka).
 * Diperiksa lagi selama `WAIT_MS` karena galat bisa muncul setelah validasi asinkron atau jawaban server.
 */
export function useScrollToInvalidOnSubmit(): void {
  useEffect(() => {
    let stop: (() => void) | null = null;
    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      stop?.();
      let done = false;
      const check = () => {
        if (done) return;
        if (revealFirstInvalid(form)) finish();
      };
      const observer = new MutationObserver(check);
      observer.observe(form, { subtree: true, childList: true, attributes: true });
      const first = window.setTimeout(check, 120);
      const last = window.setTimeout(() => finish(), WAIT_MS);
      function finish() {
        done = true;
        observer.disconnect();
        window.clearTimeout(first);
        window.clearTimeout(last);
        stop = null;
      }
      stop = finish;
    };
    document.addEventListener('submit', onSubmit, true);
    return () => {
      document.removeEventListener('submit', onSubmit, true);
      stop?.();
    };
  }, []);
}
