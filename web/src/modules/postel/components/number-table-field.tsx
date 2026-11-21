import {
  daysUntil,
  isCalendarDate,
  POSTEL_LIMITS,
  postelCondition,
  postelRoles,
} from '@shared/postel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { rowOfError } from '@/modules/item/lib/row-error';
import { blankNumberRow, type NumberRow } from '../lib/schemas';
import { NumberStatus } from './number-status';

export type { NumberRow } from '../lib/schemas';

export interface NumberTableFieldProps {
  value: readonly NumberRow[];
  onChange: (rows: NumberRow[]) => void;
  /** Ambang "segera habis" dan tanggal WIB server: dasar lencana kondisi (bukan jam peramban). */
  soonDays: number;
  today: string;
  /** Pesan galat; yang berbentuk "Nomor N: ..." menandai input baris N (`aria-invalid`). */
  errors?: readonly string[] | undefined;
}

/**
 * Tabel nomor sertifikat. Urutan baris = urutan penambahan: baris terakhir berperan Aktif, sisanya Lama (dihitung,
 * sama seperti server). Hapus hanya untuk baris baru (belum tersimpan) atau baris tersimpan berperan Lama.
 */
export function NumberTableField({
  value,
  onChange,
  soonDays,
  today,
  errors,
}: NumberTableFieldProps) {
  const roles = postelRoles(value.map((_, index) => index));
  const invalidRows = new Set((errors ?? []).map((message) => rowOfError(message, 'Nomor')));
  const update = (index: number, patch: Partial<NumberRow>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="after:ml-0.5 after:text-destructive-text after:content-['*'_/_'']">
                Nomor
              </TableHead>
              <TableHead className="after:ml-0.5 after:text-destructive-text after:content-['*'_/_'']">
                Tanggal habis
              </TableHead>
              <TableHead>Tautan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {value.map((row, index) => {
              const role = roles[index] ?? 'old';
              const condition = isCalendarDate(row.expiresOn)
                ? postelCondition(daysUntil(row.expiresOn, today), soonDays)
                : null;
              const invalid = invalidRows.has(index) ? true : undefined;
              return (
                <TableRow key={row.key}>
                  <TableCell>
                    <Input
                      aria-label={`Nomor sertifikat ${index + 1}`}
                      aria-required="true"
                      aria-invalid={invalid}
                      placeholder="Nomor sertifikat"
                      value={row.number}
                      onChange={(event) => update(index, { number: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      className="w-40"
                      aria-label={`Tanggal habis ${index + 1}`}
                      aria-required="true"
                      aria-invalid={invalid}
                      value={row.expiresOn}
                      onChange={(event) => update(index, { expiresOn: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Tautan ${index + 1}`}
                      aria-invalid={invalid}
                      placeholder="https://… (opsional)"
                      value={row.link}
                      onChange={(event) => update(index, { link: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <NumberStatus role={role} condition={condition} />
                  </TableCell>
                  <TableCell className="text-right">
                    {row.id === undefined || role === 'old' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        color="primary"
                        size="sm"
                        aria-label={`Hapus nomor ${index + 1}`}
                        onClick={() => onChange(value.filter((_, i) => i !== index))}
                      >
                        Hapus
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Button
        type="button"
        variant="outline"
        color="primary"
        size="sm"
        disabled={value.length >= POSTEL_LIMITS.numbersMax}
        onClick={() => onChange([...value, blankNumberRow()])}
      >
        Tambah nomor
      </Button>
      {errors && errors.length > 0 ? (
        <div className="space-y-0.5">
          {errors.map((message) => (
            <p key={message} className="text-sm text-destructive-text">
              {message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
