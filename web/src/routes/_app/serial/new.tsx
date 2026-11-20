import { createFileRoute, useBlocker } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { LeaveProofDialog } from '@/modules/serial/components/leave-proof-dialog';
import { RecordPage, type RecordPageHandle } from '@/modules/serial/components/record-page';
import {
  leaveMode,
  shouldBlockLeave,
  shouldWarnBeforeUnload,
} from '@/modules/serial/lib/leave-guard';

export const Route = createFileRoute('/_app/serial/new')({
  staticData: { crumb: 'Tambah', pageWidth: 'full', locationAware: true },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serial', 'edit'),
  component: NewSerialRoute,
});

const LEAVE_MESSAGE =
  'Masih ada serial di draft yang belum disimpan. Draft tersimpan otomatis di perangkat ini. Tetap keluar dari halaman?';

function NewSerialRoute() {
  const dirty = useRef(false);
  const hasProof = useRef(false);
  const page = useRef<RecordPageHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const stack = useStackNavigation();
  // Draft biasa: konfirmasi bawaan peramban seperti semula. Draft berfoto bukti ditangani penjaga kedua (dialog).
  useBlocker({
    shouldBlockFn: () =>
      leaveMode(dirty.current, hasProof.current) === 'confirm' &&
      shouldBlockLeave(true, () => window.confirm(LEAVE_MESSAGE)),
    // Menutup tab/memuat ulang tetap diperingatkan (juga saat ada foto).
    enableBeforeUnload: () => shouldWarnBeforeUnload(dirty.current),
  });
  const blocker = useBlocker({
    shouldBlockFn: () => leaveMode(dirty.current, hasProof.current) === 'dialog',
    withResolver: true,
  });

  async function saveThenLeave() {
    if (blocker.status !== 'blocked' || saving) return;
    const { proceed, reset } = blocker;
    setSaving(true);
    try {
      const saved = (await page.current?.save()) ?? false;
      if (saved) {
        // Draft sudah kosong: lanjutkan ke tujuan semula tanpa menahan lagi.
        dirty.current = false;
        hasProof.current = false;
        proceed();
      } else {
        // Ada baris gagal/belum lengkap: tetap di halaman agar hasilnya terlihat di tabel.
        reset();
      }
    } catch {
      reset();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <RecordPage
        handleRef={page}
        onDirtyChange={(value) => {
          dirty.current = value;
        }}
        onProofChange={(value) => {
          hasProof.current = value;
        }}
        // Semua baris tersimpan: kembali ke daftar tanpa konfirmasi keluar (draft sudah kosong).
        onAllSaved={() => {
          dirty.current = false;
          stack.replace({ to: '/serial' });
        }}
      />
      <LeaveProofDialog
        open={blocker.status === 'blocked'}
        saving={saving}
        onSave={() => void saveThenLeave()}
        onLeave={() => blocker.status === 'blocked' && blocker.proceed()}
        onStay={() => blocker.status === 'blocked' && blocker.reset()}
      />
    </div>
  );
}
