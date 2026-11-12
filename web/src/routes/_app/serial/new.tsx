import { createFileRoute, useBlocker } from '@tanstack/react-router';
import { useRef } from 'react';
import { requirePermission } from '@/modules/auth/permissions';
import { RecordPage } from '@/modules/serial/components/record-page';

export const Route = createFileRoute('/_app/serial/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serial', 'edit'),
  component: NewSerialRoute,
});

const LEAVE_MESSAGE =
  'Tabel sementara masih berisi serial yang belum disimpan. Draf tersimpan otomatis di perangkat ini; tetap keluar dari halaman?';

function NewSerialRoute() {
  const dirty = useRef(false);
  useBlocker({
    shouldBlockFn: () => dirty.current && !window.confirm(LEAVE_MESSAGE),
    enableBeforeUnload: () => dirty.current,
  });
  return (
    <div className="max-w-7xl">
      <RecordPage
        onDirtyChange={(value) => {
          dirty.current = value;
        }}
      />
    </div>
  );
}
