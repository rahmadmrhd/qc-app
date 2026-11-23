import type { NumberData } from '@shared/dashboard';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { formatDelta, formatNumber } from '../../lib/format';

const TONE_CLASS = {
  success: 'text-success-text',
  danger: 'text-destructive-text',
  muted: 'text-muted-foreground',
} as const;

const TONE_ICON = { success: ArrowUp, danger: ArrowDown, muted: Minus } as const;

/** Angka besar; `delta` menampilkan perbandingan dengan periode sebelumnya (kata + ikon, bukan warna saja). */
export function NumberWidget({ data, delta }: { data: NumberData; delta: boolean }) {
  const change = delta ? formatDelta(data.value, data.previous) : null;
  const Icon = change ? TONE_ICON[change.tone] : null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-3xl font-semibold tabular-nums">{formatNumber(data.value)}</p>
      {change && Icon ? (
        <p className={`flex items-center gap-1 text-sm ${TONE_CLASS[change.tone]}`}>
          <Icon aria-hidden="true" className="size-3.5" />
          <span>{change.text}</span>
        </p>
      ) : null}
    </div>
  );
}
