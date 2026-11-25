import type { ListData } from '@shared/dashboard';
import type { PublicListData } from '@shared/dashboard-public';
import { type DataColumn, DataTable, LinkCell } from '@/components/data-table';
import { formatNumber } from '../../lib/format';
import type { WidgetLinks } from '../../lib/links';

const cell = (value: string | number | undefined): string =>
  typeof value === 'number' ? formatNumber(value) : (value ?? '');

interface Entry {
  key: string;
  row: Record<string, string | number>;
}

/**
 * Daftar ringkas: tabel di desktop, kartu di ponsel (`DataTable`). Dengan `links` (hanya di aplikasi, bagi yang berhak),
 * klik baris membuka halaman detailnya lewat `rowTo` (id baris = kolom tersembunyi `id` dari server) dan kolom
 * pertama menjadi tautan. Data internal (`ListData`) menampilkan "Menampilkan N dari M"; data publik (`PublicListData`,
 * tanpa `total` dan tanpa `id`) hanya "Menampilkan N baris" agar jumlah seluruh baris tak terbuka.
 */
export function ListWidget({
  data,
  label,
  links,
}: {
  data: ListData | PublicListData;
  label: string;
  links?: WidgetLinks;
}) {
  if (data.rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Belum ada data</p>;
  }
  const rowLink = links?.row ?? null;
  const entries: Entry[] = data.rows.map((row, index) => ({ key: String(index), row }));
  const idOf = (entry: Entry): string | null => {
    const id = entry.row.id;
    return typeof id === 'string' && id !== '' ? id : null;
  };
  const columns: DataColumn<Entry>[] = data.columns.map((column, index) => ({
    id: column.key,
    header: column.label,
    cell: (entry) => {
      const text = cell(entry.row[column.key]);
      const id = idOf(entry);
      if (index === 0 && rowLink && id !== null) {
        const target = rowLink(id);
        return (
          <LinkCell to={target.to} params={target.params} search={target.search}>
            {text}
          </LinkCell>
        );
      }
      return text;
    },
  }));
  return (
    <div className="flex flex-col gap-2">
      <DataTable
        label={label}
        rows={entries}
        rowKey={(entry) => entry.key}
        columns={columns}
        fit="content"
        {...(rowLink
          ? {
              rowTo: (entry: Entry) => {
                const id = idOf(entry);
                return id === null ? null : rowLink(id);
              },
            }
          : {})}
      />
      <p className="text-xs text-muted-foreground">
        {'total' in data
          ? `Menampilkan ${formatNumber(data.rows.length)} dari ${formatNumber(data.total)}`
          : `Menampilkan ${formatNumber(data.rows.length)} baris`}
      </p>
    </div>
  );
}
