import { Button } from '@/components/ui/button';
import { useHasUnsavedChanges } from './unsaved-changes';
import { usePwaUpdate } from './update';

/** Spanduk "Ada versi baru" (FR-P11-P13): tidak memuat ulang sendiri; peringatan bila ada formulir belum disimpan. */
export function PwaUpdateBanner() {
  const { needRefresh, dismissed, reload, dismiss } = usePwaUpdate();
  const unsaved = useHasUnsavedChanges();
  if (!needRefresh || dismissed) return null;
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
        <Button size="sm" variant="outline" onClick={dismiss}>
          Nanti
        </Button>
        <Button size="sm" onClick={reload}>
          Muat ulang
        </Button>
      </div>
    </div>
  );
}
