import { cn } from 'cn';
import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { useIsMobile } from '@/hooks/use-mobile';
import { HeadroomBar, HeadroomFrame } from './headroom-bar';
import { PageContent } from './page-container';
import { StickyActionBar } from './sticky-action-bar';

/**
 * Kerangka halaman form (spek redesain 6.7): bar headroom berisi judul (+ badge) dan aksi (Batal, tambahan, Simpan).
 * Komponen form model merender `<form id={formId}>` berisi field saja; tombol Simpan di sini berada di luar form
 * dan men-submit lewat `form={formId}`. Di tampilan lebar kerangka bleed ke tepi `<main>`: bar judul selebar penuh
 * dan isi (batas lebar menurut `pageWidth`) terpusat di tengah, tanpa panel samping (revisi lanjutan 2 R15).
 */
export function FormPage({
  formId,
  title,
  badge,
  onCancel,
  submitting,
  submitLabel = 'Simpan',
  busyText = 'Menyimpan…',
  submitDisabled,
  extra,
  children,
  tour,
  actionsTour,
  saveTour,
  hideMobileBar,
  selectionBar,
}: {
  formId: string;
  title: ReactNode;
  badge?: ReactNode;
  onCancel: () => void;
  submitting?: boolean;
  submitLabel?: string;
  busyText?: string;
  submitDisabled?: boolean;
  /** Aksi tambahan di antara Batal dan Simpan. */
  extra?: ReactNode;
  children: ReactNode;
  /** `data-tour` pada bar judul. */
  tour?: string;
  /** `data-tour` pada pembungkus tombol. */
  actionsTour?: string;
  /** `data-tour` pada tombol Simpan. */
  saveTour?: string;
  /**
   * Ponsel: sembunyikan bar bawah (Batal + Simpan) sementara halaman menampilkan bar aksi lain di tepi bawah, mis. bar
   * aksi pilihan pada tabel draft. Tak berpengaruh di desktop.
   */
  hideMobileBar?: boolean;
  /**
   * Ponsel: kontrol pilihan di sisi KIRI bar bawah, sebelum Batal dan Simpan (mis. ✕ batalkan pilihan, kotak centang
   * pilih semua, "N dipilih"); satu bar saja untuk pilihan dan aksi form. Kosong = bar Batal + Simpan biasa.
   */
  selectionBar?: ReactNode;
}) {
  const desktop = useIsDesktop();
  // SATU gerbang ponsel (viewport < 768, sama dengan judul navbar): judul tak tampil ganda pada 704-767 px.
  const phone = useIsMobile();
  // Tepat SATU set Batal/Simpan di semua lebar: `desktop` (lebar <main> >= 704) menaruhnya di bar atas, selain itu di
  // bar bawah. Bar atas hanya boleh dibuang bila aksi memang di bar bawah; pada 704-767 px `phone` dan `desktop`
  // sama-sama true dan bar atas membawa aksinya.
  const compactTop = phone && !badge && !desktop;
  const cancel = <ActionButton action="cancel" onClick={onCancel} disabled={submitting} />;
  const save = (
    <ActionButton
      action="save"
      type="submit"
      form={formId}
      label={submitLabel}
      busy={submitting}
      busyLabel={busyText}
      disabled={submitDisabled}
      data-tour={saveTour}
      className={desktop || selectionBar ? undefined : 'flex-[2]'}
    />
  );
  return (
    // `wide:` meniadakan padding `<main>` (bleed); ponsel tak berubah. TANPA `container-type` di sini: bar aksi ponsel
    // dan bar aksi pilihan halaman turunan ber-`fixed`.
    <HeadroomFrame className="gap-4 wide:-mx-[var(--main-pad)] wide:-mt-[var(--main-pad)] wide:-mb-[var(--main-pad)]">
      {compactTop ? (
        // Ponsel tanpa lencana DAN aksi di bar bawah: tak ada isi tampak untuk bar atas (judul = navbar), jadi tanpa bar
        // ber-border/bayang yang kosong; judul tetap ada bagi pembaca layar dan target panduan `tour` tetap terpasang.
        <div data-tour={tour} className="sr-only">
          <h1>{title}</h1>
        </div>
      ) : (
        <HeadroomBar tour={tour} className="border-b pt-1 pb-1 wide:pt-3 wide:pb-3">
          <div className="wide:px-[var(--main-pad)]">
            {/* Bar judul selebar penuh (tanpa batas `pageWidth`; keputusan pemilik 2026-11-23, K9). */}
            <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
              {/* Ponsel: tanpa tombol kembali dan tanpa judul tampak (judul navbar; kembali = tombol sistem). */}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className={cn('min-w-0 text-xl font-semibold break-words', phone && 'sr-only')}>
                  {title}
                </h1>
                {badge}
              </div>
              {desktop ? (
                <div data-tour={actionsTour} className="flex flex-wrap items-center gap-2">
                  {cancel}
                  {extra}
                  {save}
                </div>
              ) : null}
            </div>
          </div>
        </HeadroomBar>
      )}
      <div className="min-w-0 wide:px-[var(--main-pad)] wide:pb-[var(--main-pad)]">
        <PageContent>{children}</PageContent>
      </div>
      {desktop || hideMobileBar ? null : (
        // Ponsel: Batal + Simpan pindah ke bar bawah `fixed` (Simpan lebih lebar).
        <StickyActionBar label="Aksi form">
          <div data-tour={actionsTour} className="flex w-full items-center gap-2">
            {selectionBar ? (
              <div data-slot="form-selection" className="flex min-w-0 flex-1 items-center">
                {selectionBar}
              </div>
            ) : null}
            {cancel}
            {extra}
            {save}
          </div>
        </StickyActionBar>
      )}
    </HeadroomFrame>
  );
}
