import { createFileRoute, useBlocker } from '@tanstack/react-router';
import { useRef } from 'react';
import { requirePermission } from '@/modules/auth/permissions';
import { RecordPage } from '@/modules/serial/components/record-page';
import { shouldBlockLeave, shouldWarnBeforeUnload } from '@/modules/serial/lib/leave-guard';

export const Route = createFileRoute('/_app/serial/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serial', 'edit'),
  component: NewSerialRoute,
});

const LEAVE_MESSAGE =
  'Masih ada serial di draft yang belum disimpan. Draft tersimpan otomatis di perangkat ini. Tetap keluar dari halaman?';

function NewSerialRoute() {
  const dirty = useRef(false);
  useBlocker({
    shouldBlockFn: () => shouldBlockLeave(dirty.current, () => window.confirm(LEAVE_MESSAGE)),
    enableBeforeUnload: () => shouldWarnBeforeUnload(dirty.current),
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
