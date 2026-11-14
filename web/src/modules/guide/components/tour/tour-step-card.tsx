import { X } from 'lucide-react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { Button } from '@/components/ui/button';
import type { GuideStep } from '../../lib/types';

interface TourStepCardProps {
  step: GuideStep;
  /** Nomor langkah yang sedang tampil (mulai 1) dan jumlah langkah yang berlaku bagi pengguna. */
  position: number;
  total: number;
  isLast: boolean;
  /** Adegan demo milik entri `tip` yang disematkan langkah ini (dari Task 7), bila ada. */
  tip?: ReactNode;
  style: CSSProperties;
  cardRef: Ref<HTMLDivElement>;
  onNext: () => void;
  onClose: () => void;
}

/** Kartu penjelasan satu langkah. Berposisi tetap (dihitung mesin tur) dan dapat dioperasikan dengan keyboard. */
export function TourStepCard({
  step,
  position,
  total,
  isLast,
  tip,
  style,
  cardRef,
  onNext,
  onClose,
}: TourStepCardProps) {
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      style={style}
      className="pointer-events-auto fixed flex max-h-[calc(100dvh-1.5rem)] w-[min(21rem,calc(100vw-1.5rem))] flex-col gap-3 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-hidden"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Langkah {position} dari {total}
        </p>
        <button
          type="button"
          aria-label="Tutup panduan"
          onClick={onClose}
          className="-mt-1 -mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <p className="leading-relaxed">{step.text}</p>
      {tip}
      <div className="flex items-center justify-between gap-2">
        {step.advance === 'click' ? (
          <p className="text-xs text-muted-foreground">Klik bagian yang disorot untuk lanjut.</p>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {step.advance === 'click' && !isLast ? (
            <Button type="button" variant="ghost" size="sm" onClick={onNext}>
              Lewati
            </Button>
          ) : null}
          {step.advance === 'next' || isLast ? (
            <Button type="button" size="sm" onClick={onNext}>
              {isLast ? 'Selesai' : 'Lanjut'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
