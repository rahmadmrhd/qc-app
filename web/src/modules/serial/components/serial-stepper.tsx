import type { SerialStatus } from '@shared/serials';
import { cn } from '@/lib/utils';
import { STEP_ORDER } from '../lib/labels';

export interface SerialStepperProps {
  status: SerialStatus;
  /** Serial pernah punya laporan rusak (menandai tahap akhir "Lolos" setelah laporan ditutup). */
  hasCases: boolean;
}

/** Indeks tahap pada `STEP_ORDER` untuk status itu. Lolos tanpa laporan = tahap awal; lolos setelah laporan = tahap akhir. */
export function stepIndexOf(status: SerialStatus, hasCases: boolean): number {
  switch (status) {
    case 'good':
      return hasCases ? 6 : 0;
    case 'reported':
      return 1;
    case 'at_service':
      return 2;
    case 'diagnosis':
      return 3;
    case 'service_repair':
      return 4;
    case 'recheck':
      return 5;
    case 'broken':
      return 6;
  }
}

/** Baris tahap: Lolos → Dilaporkan → Di servis → Diagnosis → Sedang diperbaiki → Menunggu cek ulang → Lolos / Rusak. */
export function SerialStepper({ status, hasCases }: SerialStepperProps) {
  const current = stepIndexOf(status, hasCases);
  const finalLabel = status === 'broken' ? 'Rusak' : hasCases && status === 'good' ? 'Lolos' : null;
  return (
    <ol aria-label="Tahap" className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs">
      {STEP_ORDER.map((step, index) => {
        const label = step.key === 'final' && finalLabel ? finalLabel : step.label;
        const active = index === current;
        return (
          <li
            key={step.key}
            aria-current={active ? 'step' : undefined}
            className="flex items-center gap-1"
          >
            {index > 0 ? (
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
            ) : null}
            <span
              className={cn(
                'rounded-full border px-2 py-0.5',
                active && status === 'broken' && 'border-destructive bg-destructive text-white',
                active &&
                  status !== 'broken' &&
                  'border-primary bg-primary text-primary-foreground',
                !active && index < current && 'border-primary/40 text-foreground',
                !active && index >= current && 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
