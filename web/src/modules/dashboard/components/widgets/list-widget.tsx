import type { ListData } from '@shared/dashboard';
import { MobileCard } from '@/components/mobile/mobile-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { formatNumber } from '../../lib/format';

const cell = (value: string | number | undefined): string =>
  typeof value === 'number' ? formatNumber(value) : (value ?? '');

/** Daftar ringkas: tabel di desktop, kartu di ponsel, dengan "Menampilkan N dari M". */
export function ListWidget({ data }: { data: ListData }) {
  const desktop = useIsDesktop();
  if (data.rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Belum ada data</p>;
  }
  const [first, ...rest] = data.columns;
  return (
    <div className="flex flex-col gap-2">
      {desktop ? (
        <Table>
          <TableHeader>
            <TableRow>
              {data.columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: baris ringkasan tanpa id, urutan tetap
              <TableRow key={index}>
                {data.columns.map((column) => (
                  <TableCell key={column.key}>{cell(row[column.key])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.rows.map((row, index) => (
            <MobileCard
              // biome-ignore lint/suspicious/noArrayIndexKey: baris ringkasan tanpa id, urutan tetap
              key={index}
              title={first ? cell(row[first.key]) : ''}
              meta={rest.map((column) => ({
                id: column.key,
                label: column.label,
                value: cell(row[column.key]),
              }))}
            />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Menampilkan {formatNumber(data.rows.length)} dari {formatNumber(data.total)}
      </p>
    </div>
  );
}
