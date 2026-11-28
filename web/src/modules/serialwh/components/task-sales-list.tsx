import { formatBuLabel } from '@shared/business-units';
import type { WarehouseTaskSaleDto } from '@shared/contract';
import { Badge } from '@/components/ui/badge';
import { formatDay } from '@/modules/serial/lib/labels';
import { DISPATCH_STATUS } from './dispatch-section';

export interface TaskSalesListProps {
  sales: readonly WarehouseTaskSaleDto[];
  /** Nomor riwayat menjadi tautan ke detail pengeluaran (hanya bila pengguna berhak dan bukan di aplikasi desktop). */
  linkable: boolean;
}

/** Penjualan tanpa No SO yang menaut task ini: daftar hanya-baca (tanpa ubah atau lepas). Kosong = tidak tampil. */
export function TaskSalesList({ sales, linkable }: TaskSalesListProps) {
  if (sales.length === 0) return null;
  return (
    <div className="space-y-1 text-xs">
      <p className="text-muted-foreground">Penjualan tanpa No SO tertaut task ini:</p>
      <ul className="divide-y rounded-md border" aria-label="Penjualan tanpa No SO">
        {sales.map((sale) => {
          const status = DISPATCH_STATUS[sale.status];
          return (
            <li
              key={sale.dispatchId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5"
            >
              {linkable ? (
                <a
                  href={`/serial/gudang/riwayat/${sale.dispatchId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-info-text underline-offset-4 hover:underline"
                >
                  {sale.number}
                </a>
              ) : (
                <span className="font-medium">{sale.number}</span>
              )}
              <span className="text-muted-foreground">{formatDay(sale.dispatchedOn)}</span>
              <span className="text-muted-foreground">
                {formatBuLabel({ code: sale.buCode, name: sale.buName })}
              </span>
              <Badge color={status.color} variant="soft">
                {status.label}
              </Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
