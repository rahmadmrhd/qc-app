import type { HandoverSummaryDto } from '@shared/rpc';
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
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { HANDOVER_STATUS_LABELS, handoverStatusVariant } from '../lib/status';

export interface HandoversTableProps {
  handovers: readonly HandoverSummaryDto[];
  /** Kolom Lokasi hanya bila lebih dari satu lokasi terpilih (PRD FR-C5). */
  showLocation: boolean;
  locationNames: ReadonlyMap<string, string>;
  onOpen: (handover: HandoverSummaryDto) => void;
}

export function HandoversTable({
  handovers,
  showLocation,
  locationNames,
  onOpen,
}: HandoversTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nomor</TableHead>
            <TableHead>Customer</TableHead>
            {showLocation ? <TableHead>Lokasi</TableHead> : null}
            <TableHead>Progres</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Dibuat</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {handovers.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={showLocation ? 7 : 6}
                className="text-center text-muted-foreground"
              >
                Tidak ada task yang cocok.
              </TableCell>
            </TableRow>
          ) : null}
          {handovers.map((handover) => (
            <TableRow key={handover.id}>
              <TableCell className="font-medium">{handover.number}</TableCell>
              <TableCell>{handover.customerName}</TableCell>
              {showLocation ? (
                <TableCell>
                  {locationNames.get(handover.locationId) ?? handover.locationId}
                </TableCell>
              ) : null}
              <TableCell className="tabular-nums">
                {handover.doneUnits}/{handover.totalUnits} unit
                <div className="text-xs text-muted-foreground">{handover.lineCount} tipe</div>
              </TableCell>
              <TableCell>
                <Badge variant={handoverStatusVariant(handover.status)}>
                  {HANDOVER_STATUS_LABELS[handover.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatAuditTime(handover.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Buka ${handover.number}`}
                  onClick={() => onOpen(handover)}
                >
                  Buka
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
