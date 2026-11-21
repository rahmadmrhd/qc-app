import { ChevronRight, MapPin, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTourMenu } from '@/modules/guide/lib/tour-menu';
import { activeLocationLabel } from '../active-location-label';
import { useActiveLocations } from '../active-locations-context';
import { LocationSheet } from './location-sheet';

/**
 * Baris kedua header ponsel (butir 42c): lokasi aktif di bawah judul, hanya pada halaman berlokasi. Tinggi visual
 * 16 px agar header tetap 3,5 rem; area tekan 44 px lewat pseudo-elemen. Mengetuknya membuka lembar pemilih lokasi.
 */
export function LocationLine() {
  const { available, selectedIds } = useActiveLocations();
  const tourMenu = useTourMenu('location-picker');
  const [open, setOpen] = useState(false);
  const warn = selectedIds.length === 0;
  const label = activeLocationLabel(available, selectedIds);
  const Icon = warn ? TriangleAlert : MapPin;
  return (
    <>
      <button
        type="button"
        data-tour="location-picker"
        data-slot="location-line"
        aria-label={`Lokasi aktif: ${label}. Ketuk untuk mengganti`}
        onClick={() => setOpen(true)}
        className={`relative flex h-4 w-full max-w-full items-center gap-1 text-left text-xs after:absolute after:inset-x-0 after:-inset-y-3.5 after:content-[''] ${
          warn ? 'font-medium text-warning-text' : 'text-muted-foreground'
        }`}
      >
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight className="size-3 shrink-0" aria-hidden />
      </button>
      <LocationSheet
        open={open || tourMenu.forced}
        onOpenChange={(next) => {
          setOpen(next);
          tourMenu.rootProps.onOpenChange(next);
        }}
        tourProps={{ 'data-tour': 'location-menu', ...tourMenu.contentProps }}
      />
    </>
  );
}
