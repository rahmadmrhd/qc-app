import { cn } from 'cn';
import { type CSSProperties, createContext, type ReactNode, useContext } from 'react';
import { type HeadroomState, headroomOffset, useHeadroom } from '@/hooks/use-headroom';

interface HeadroomContextValue extends HeadroomState {
  /** Nilai `--headroom-offset` bagi elemen pengikut. */
  offset: string;
}

const HeadroomContext = createContext<HeadroomContextValue | null>(null);

/**
 * Kerangka halaman dengan bar headroom: menulis `--headroom-offset` ke elemen akarnya (dibaca header tabel dan
 * tab yang menempel) dan memberi `scroll-margin-top` pada target gulir (`[data-tour]`, `:target`).
 */
export function HeadroomFrame({
  pinned = false,
  className,
  children,
}: {
  pinned?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const state = useHeadroom({ disabled: pinned });
  const offset = headroomOffset(state.hidden, state.height);
  return (
    <HeadroomContext.Provider value={{ ...state, offset }}>
      <div
        data-headroom-frame=""
        className={cn(
          'flex min-w-0 flex-col [&_:target]:scroll-mt-[var(--headroom-offset)] [&_[data-tour]]:scroll-mt-[var(--headroom-offset)]',
          className,
        )}
        style={{ '--headroom-offset': offset } as CSSProperties}
      >
        {children}
      </div>
    </HeadroomContext.Provider>
  );
}

/** Bar judul/aksi/filter yang menempel di bawah header aplikasi dan bersembunyi saat menggulir turun. */
export function HeadroomBar({
  children,
  className,
  tour,
}: {
  children: ReactNode;
  className?: string;
  tour?: string;
}) {
  const context = useContext(HeadroomContext);
  const hidden = context?.hidden ?? false;
  return (
    <div
      ref={context?.ref}
      data-tour={tour}
      data-hidden={hidden || undefined}
      data-floating={context?.floating || undefined}
      inert={hidden}
      className={cn(
        'sticky top-14 z-20 bg-background motion-safe:transition-transform',
        hidden && '-translate-y-[calc(100%+3.5rem)]',
        context?.floating && 'border-b shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}
