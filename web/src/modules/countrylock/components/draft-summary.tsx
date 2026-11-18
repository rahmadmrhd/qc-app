import type { ReactNode } from 'react';
import type { StagingRow } from '@/modules/serial/lib/draft';

/**
 * Ringkasan hanya-baca draft Serial Number yang belum diunggah (hasil inject dan serial manual). Tombol pencatatan
 * (`action`) hanya diberikan bila pengguna boleh mencatat; selain itu `note` menjelaskan alasannya (belum masuk atau tanpa
 * izin `serial: edit`).
 */
export function DraftSummary({
  rows,
  note,
  action,
}: {
  rows: readonly StagingRow[];
  note: string;
  action?: ReactNode;
}) {
  return (
    <section aria-label="Draft Serial Number" className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Draft Serial Number ({rows.length} baris)</h2>
        {action}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {note}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada serial di draft.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Draft serial yang belum diunggah (hanya baca)</caption>
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="px-2 py-1 font-medium">
                  Serial
                </th>
                <th scope="col" className="px-2 py-1 font-medium">
                  Tipe
                </th>
                <th scope="col" className="px-2 py-1 font-medium">
                  Business Unit
                </th>
                <th scope="col" className="px-2 py-1 font-medium">
                  Lokasi
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.clientId} className="border-b last:border-0">
                  <td className="px-2 py-1 font-mono">{row.serial}</td>
                  <td className="px-2 py-1">{row.itemLabel || '-'}</td>
                  <td className="px-2 py-1">{row.buLabel || '-'}</td>
                  <td className="px-2 py-1">{row.locationLabel || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
