import type { LocationAccessDto } from '@shared/contract';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useMe } from '@/modules/auth/use-me';
import {
  ACTIVE_LOCATIONS_STORAGE_KEY,
  normalizeSelection,
  parseStoredLocationIds,
  toggleSelection,
} from './active-locations';

interface ActiveLocationsValue {
  /** Lokasi aktif yang boleh diakses user. */
  available: LocationAccessDto[];
  /** Lokasi terpilih (selalu bagian dari `available`, tidak pernah kosong bila ada lokasi). */
  selectedIds: string[];
  toggle: (id: string) => void;
}

const ActiveLocationsContext = createContext<ActiveLocationsValue | null>(null);

function readStored(): string[] | null {
  try {
    return parseStoredLocationIds(localStorage.getItem(ACTIVE_LOCATIONS_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(ids: readonly string[]): void {
  try {
    localStorage.setItem(ACTIVE_LOCATIONS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Penyimpanan bisa diblokir (mode privat); pilihan tetap berlaku selama sesi halaman.
  }
}

export function ActiveLocationsProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const available = me.locations;
  const availableIds = useMemo(() => available.map((location) => location.id), [available]);
  const [stored, setStored] = useState<string[] | null>(readStored);
  const selectedIds = useMemo(
    () => normalizeSelection(stored, availableIds),
    [stored, availableIds],
  );

  const toggle = useCallback(
    (id: string) => {
      const next = toggleSelection(selectedIds, id, availableIds);
      setStored(next);
      writeStored(next);
    },
    [selectedIds, availableIds],
  );

  const value = useMemo(
    () => ({ available, selectedIds, toggle }),
    [available, selectedIds, toggle],
  );
  return (
    <ActiveLocationsContext.Provider value={value}>{children}</ActiveLocationsContext.Provider>
  );
}

export function useActiveLocations(): ActiveLocationsValue {
  const value = useContext(ActiveLocationsContext);
  if (!value) throw new Error('useActiveLocations harus dipakai di dalam ActiveLocationsProvider');
  return value;
}

/** Seperti `useActiveLocations`, tetapi `null` bila tidak ada penyedia (komponen yang berguna juga tanpa header). */
export function useOptionalActiveLocations(): ActiveLocationsValue | null {
  return useContext(ActiveLocationsContext);
}
