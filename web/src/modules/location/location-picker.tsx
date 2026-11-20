import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTourMenu } from '@/modules/guide/lib/tour-menu';
import { activeLocationLabel } from './active-location-label';
import { useActiveLocations } from './active-locations-context';

/** Pemilih multi-select lokasi aktif; disembunyikan bila user hanya punya satu lokasi. */
export function LocationPicker() {
  const { available, selectedIds, toggle } = useActiveLocations();
  const tourMenu = useTourMenu('location-picker');
  if (available.length <= 1) return null;
  const label = activeLocationLabel(available, selectedIds);
  return (
    <DropdownMenu {...tourMenu.rootProps}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Pilih lokasi aktif"
          data-tour="location-picker"
        >
          <MapPin aria-hidden="true" />
          {/* Ponsel sempit: ikon saja agar header muat di 360 px (nama lengkap tetap dibacakan lewat aria-label). */}
          <span className="max-sm:sr-only">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52"
        data-tour="location-menu"
        {...tourMenu.contentProps}
      >
        <DropdownMenuLabel>Lokasi aktif</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {available.map((location) => (
          <DropdownMenuCheckboxItem
            key={location.id}
            className="pr-1.5 pl-8 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:right-auto [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:left-2"
            checked={selectedIds.includes(location.id)}
            onCheckedChange={() => toggle(location.id)}
            onSelect={(event) => event.preventDefault()}
          >
            {location.name} <span className="text-muted-foreground">({location.code})</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
