import { lazy, Suspense } from 'react';
import type { DiffViewProps } from './diff-view-impl';

const DiffViewImpl = lazy(() => import('./diff-view-impl'));

/** Perbandingan dua revisi berdampingan (CodeMirror merge, dimuat malas). Di tes diganti tiruan. */
export function DiffView(props: DiffViewProps) {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="flex min-h-24 items-center justify-center rounded-lg border text-sm text-muted-foreground"
        >
          Memuat perbandingan…
        </div>
      }
    >
      <DiffViewImpl {...props} />
    </Suspense>
  );
}
