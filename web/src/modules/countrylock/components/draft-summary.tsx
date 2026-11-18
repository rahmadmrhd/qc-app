import type { StagingRow } from '@/modules/serial/lib/draft';

/**
 * Ringkasan draft hanya-baca untuk pengguna yang belum bisa mencatat (belum masuk atau tanpa izin `serial: edit`): hasil
 * inject tetap tersimpan di komputer ini dan tampil penuh di tabel Catat Serial Number setelah masuk.
 */
export function DraftSummary({ rows, reason }: { rows: readonly StagingRow[]; reason: string }) {
  return (
    <section aria-label="Draft Serial Number" className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Draft Serial Number ({rows.length} baris)</h2>
      <p role="status" className="text-sm text-muted-foreground">
        {reason}. Hasil inject disimpan di komputer ini.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada serial di draft.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Draft serial hasil inject (hanya baca)</caption>
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
