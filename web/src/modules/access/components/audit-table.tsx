import type { AuditEntryDto } from '@shared/rpc';
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
import { auditActionLabel, formatAuditTime } from '../lib/audit-actions';

export interface AuditTableProps {
  entries: readonly AuditEntryDto[];
  onSelect: (entry: AuditEntryDto) => void;
}

export function AuditTable({ entries, onSelect }: AuditTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Waktu</TableHead>
            <TableHead>Pelaku</TableHead>
            <TableHead>Aksi</TableHead>
            <TableHead>Target</TableHead>
            <TableHead className="text-right">Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                Belum ada catatan yang cocok.
              </TableCell>
            </TableRow>
          ) : null}
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="whitespace-nowrap">{formatAuditTime(entry.ts)}</TableCell>
              <TableCell>{entry.actor}</TableCell>
              <TableCell>
                <Badge variant="outline">{auditActionLabel(entry.action)}</Badge>
              </TableCell>
              <TableCell className="font-medium">{entry.target}</TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Lihat detail ${auditActionLabel(entry.action)} ${entry.target}`}
                  onClick={() => onSelect(entry)}
                >
                  Lihat
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
