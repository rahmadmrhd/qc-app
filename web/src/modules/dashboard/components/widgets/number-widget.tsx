import type { DeltaGood, NumberData } from '@shared/dashboard';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { formatDelta, formatNumber } from '../../lib/format';

const TONE_CLASS = {
  success: 'text-success-text',
  danger: 'text-destructive-text',
  muted: 'text-muted-foreground',
} as const;

const DIRECTION_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;

/** Angka besar; `delta` menampilkan perbandingan dengan periode sebelumnya (kata + panah menurut arah nyata; warna menurut `deltaGood`). */
export function NumberWidget({
  data,
  delta,
  deltaGood,
}: {
  data: NumberData;
  delta: boolean;
  deltaGood?: DeltaGood;
}) {
  const change = delta ? formatDelta(data.value, data.previous, deltaGood) : null;
  const Icon = change ? DIRECTION_ICON[change.direction] : null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-3xl font-semibold tabular-nums">{formatNumber(data.value)}</p>
      {change && Icon ? (
        <p className={`flex items-center gap-1 text-sm ${TONE_CLASS[change.tone]}`}>
          <Icon aria-hidden="true" className="size-3.5" />
          <span>{change.text}</span>
        </p>
      ) : null}
      {data.note ? <p className="text-sm text-muted-foreground">{data.note}</p> : null}
    </div>
  );
}
