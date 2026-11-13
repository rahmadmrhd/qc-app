import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { GuideEntry } from '../../lib/types';

// Mesin tur dimuat malas: potongan JS terpisah, hanya diunduh saat tur pertama dimulai.
const TourOverlay = lazy(() => import('./tour-overlay'));

interface TourValue {
  /** Memulai tur untuk `entry` (menggantikan tur yang sedang berjalan). */
  start(entry: GuideEntry): void;
  /** True selama sebuah tur berjalan. */
  active: boolean;
}

const TourContext = createContext<TourValue>({ start: () => undefined, active: false });

export function useTour(): TourValue {
  return useContext(TourContext);
}

interface TourProviderProps {
  children: ReactNode;
  /** Adegan demo milik entri `tip` untuk langkah ber-`tip` (disambungkan ke pemutar demo oleh pemasangnya). */
  renderTip?: (tipId: string) => ReactNode;
  /** Mengganti batas waktu menunggu target (`TARGET_WAIT_MS`); untuk tes. */
  targetWaitMs?: number;
}

/**
 * Menyediakan `useTour()`. Harus berada di dalam `ActiveLocationsProvider`, router, dan (agar sidebar ponsel dapat
 * dibuka) `SidebarProvider`.
 */
export function TourProvider({ children, renderTip, targetWaitMs }: TourProviderProps) {
  const [entry, setEntry] = useState<GuideEntry | null>(null);
  const start = useCallback((next: GuideEntry) => setEntry(next), []);
  const close = useCallback(() => setEntry(null), []);
  const value = useMemo(() => ({ start, active: entry !== null }), [start, entry]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {entry ? (
        <Suspense fallback={null}>
          <TourOverlay
            key={entry.id}
            entry={entry}
            onExit={close}
            renderTip={renderTip}
            targetWaitMs={targetWaitMs}
          />
        </Suspense>
      ) : null}
    </TourContext.Provider>
  );
}
