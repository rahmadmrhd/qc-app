import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { PublicReportPage } from '@/modules/serial/components/public-report-page';

/**
 * Halaman publik laporan rusak: SENGAJA di luar layout `_app` (tanpa `beforeLoad` yang memanggil `auth.me` atau
 * mengalihkan ke login) dan tanpa loader. Tanpa sesi tetap tampil; yang login dan berizin dialihkan ke halaman biasa
 * (`replace`, agar token tidak tersisa di riwayat peramban).
 */
export const Route = createFileRoute('/laporan/$token')({
  component: PublicReportRoute,
});

function PublicReportRoute() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const open = useCallback(
    (serialId: string, caseId: string) =>
      void navigate({
        to: '/serial/$serialId',
        params: { serialId },
        search: { case: caseId },
        replace: true,
      }),
    [navigate],
  );
  return <PublicReportPage token={token} onOpenSerial={open} />;
}
