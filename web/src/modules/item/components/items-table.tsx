import type { ItemSummaryDto } from '@shared/contract';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NoManualBookNote } from './manual-book-note';
import { NoPostelNote } from './no-postel-note';
import { NoInstructionsNote } from './sticker-instructions-view';

export interface ItemsTableProps {
  items: readonly ItemSummaryDto[];
  /** Per item: BU item menentukan hak (keputusan 13), jadi tak cukup satu tanda global. */
  canEdit: (item: ItemSummaryDto) => boolean;
  canManage: (item: ItemSummaryDto) => boolean;
  pendingStatusId: string | null;
  onOpen: (item: ItemSummaryDto) => void;
  onEdit: (item: ItemSummaryDto) => void;
  onToggleStatus: (item: ItemSummaryDto) => void;
}

export function ItemsTable({
  items,
  canEdit,
  canManage,
  pendingStatusId,
  onOpen,
  onEdit,
  onToggleStatus,
}: ItemsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Merk</TableHead>
            <TableHead>Tipe</TableHead>
            <TableHead>BU</TableHead>
            <TableHead>Lock</TableHead>
            <TableHead className="text-right">Gambar</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                Tidak ada item yang cocok.
              </TableCell>
            </TableRow>
          ) : null}
          {items.map((item) => {
            const label = `${item.brand} ${item.model}`;
            return (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.brand}</TableCell>
                <TableCell>
                  <div>{item.model}</div>
                  {item.hasInstructions ? null : <NoInstructionsNote className="block" />}
                  {/* Hanya item aktif: item nonaktif tak lagi memerlukan label Manual Book. */}
                  {item.status === 'active' && !item.hasManualBook ? (
                    <NoManualBookNote className="block" />
                  ) : null}
                  {item.status === 'active' && !item.hasPostel ? (
                    <NoPostelNote className="block" />
                  ) : null}
                  {item.aliases.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      <span className="sr-only">Nama lain: </span>
                      {item.aliases.join(', ')}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.businessUnits.map((bu) => (
                      <Badge key={bu.id} variant="outline" title={bu.name}>
                        {bu.code}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {item.isCountryLock ? (
                    <Badge color="secondary" variant="outline">
                      Country lock
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{item.imageCount}</TableCell>
                <TableCell>
                  <Badge
                    color={item.status === 'active' ? 'success' : 'secondary'}
                    variant="soft"
                    dot
                  >
                    {item.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Lihat ${label}`}
                    onClick={() => onOpen(item)}
                  >
                    Lihat
                  </Button>
                  {canEdit(item) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Ubah ${label}`}
                      onClick={() => onEdit(item)}
                    >
                      Ubah
                    </Button>
                  ) : null}
                  {canManage(item) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${item.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${label}`}
                      disabled={pendingStatusId === item.id}
                      onClick={() => onToggleStatus(item)}
                    >
                      {item.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
