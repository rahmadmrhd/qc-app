import { Button } from '@/components/ui/button';
import { useHasUnsavedChanges } from './unsaved-changes';
import { usePwaUpdate } from './update';

/** Spanduk yang dilepas dari DOM menjatuhkan fokus ke body: pindahkan ke area utama agar pengguna keyboard/pembaca layar tak kehilangan posisi. */
function restoreFocus() {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) {
    main.setAttribute('tabindex', '-1');
    main.style.outline = 'none';
  }
  main.focus({ preventScroll: true });
}

/** Spanduk "Ada versi baru" (FR-P11-P13): tidak memuat ulang sendiri; peringatan bila ada formulir belum disimpan. */
export function PwaUpdateBanner() {
  const { visible, pending, reload, dismiss } = usePwaUpdate();
  const unsaved = useHasUnsavedChanges();
  if (!visible) return null;
  return (
    <div
      role="status"
      data-testid="pwa-update-banner"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-lg sm:flex-row sm:items-center sm:gap-3"
    >
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">Ada versi baru</p>
        <p className="text-muted-foreground">
          {unsaved
            ? 'Ada formulir yang belum disimpan; perubahan itu akan hilang bila dimuat ulang.'
            : 'Muat ulang untuk memakai versi terbaru.'}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          color="primary"
          aria-disabled={pending}
          className="aria-disabled:opacity-50"
          onClick={() => {
            // Selama menunggu SW mengambil alih, Nanti diabaikan (SKIP_WAITING sudah terkirim).
            if (pending) return;
            dismiss();
            restoreFocus();
          }}
        >
          Nanti
        </Button>
        <Button
          size="sm"
          onClick={reload}
          aria-disabled={pending}
          aria-busy={pending}
          className="aria-disabled:opacity-50"
        >
          {pending ? 'Memuat…' : 'Muat ulang'}
        </Button>
      </div>
    </div>
  );
}
