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
import { useActiveLocations } from './active-locations-context';

/** Pemilih multi-select lokasi aktif; disembunyikan bila user hanya punya satu lokasi. */
export function LocationPicker() {
  const { available, selectedIds, toggle } = useActiveLocations();
  if (available.length <= 1) return null;
  const label =
    selectedIds.length === available.length
      ? 'Semua lokasi'
      : selectedIds.length === 1
        ? (available.find((location) => location.id === selectedIds[0])?.name ?? '1 lokasi')
        : `${selectedIds.length} lokasi`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Pilih lokasi aktif">
          <MapPin aria-hidden="true" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
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
