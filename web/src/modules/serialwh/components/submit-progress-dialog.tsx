import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export type ProgressState =
  | { phase: 'sending'; sent: number; chunkCount: number }
  /** Server tak terjangkau: kemajuan tersimpan di draf, dapat dilanjutkan. */
  | { phase: 'paused'; sent: number; chunkCount: number }
  /** Ditolak server pada potongan `chunkIndex`; `serial` = SN yang disebut pesan. */
  | {
      phase: 'failed';
      sent: number;
      chunkCount: number;
      chunkIndex: number;
      message: string;
      serial: string | null;
    };

export interface SubmitProgressDialogProps {
  state: ProgressState | null;
  /** Lanjutkan dari potongan yang belum terkirim (dipanggil dari klik, agar clipboard punya gestur). */
  onResume: () => void;
  /** Menutup dialog; draf dan kemajuan tetap tersimpan. */
  onClose: () => void;
  /** Membatalkan kiriman beku (hanya bila sebagian sudah tersimpan di server). */
  onDiscard: () => void;
}

/** Progres kirim bertahap. Tidak dapat ditutup selama mengirim. */
export function SubmitProgressDialog({
  state,
  onResume,
  onClose,
  onDiscard,
}: SubmitProgressDialogProps) {
  const sending = state?.phase === 'sending';
  const percent =
    state && state.chunkCount > 0 ? Math.round((state.sent / state.chunkCount) * 100) : 0;
  return (
    <AlertDialog
      open={state !== null}
      onOpenChange={(open) => {
        // Tidak dapat ditutup tak sengaja (Esc, klik luar, tombol kembali) selama mengirim.
        if (!open && !sending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {state?.phase === 'sending'
              ? 'Menyimpan pengeluaran…'
              : state?.phase === 'paused'
                ? 'Koneksi terputus'
                : 'Pengeluaran belum tersimpan semua'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {state?.phase === 'sending'
              ? `Mengirim potongan ${Math.min(state.sent + 1, state.chunkCount)} dari ${state.chunkCount}. Jangan tutup halaman ini.`
              : state?.phase === 'paused'
                ? `${state.sent} dari ${state.chunkCount} potongan sudah tersimpan. Draf aman di perangkat ini; lanjutkan setelah koneksi pulih.`
                : state
                  ? `${state.message}${
                      state.chunkIndex === 0
                        ? ' Tidak ada yang tersimpan. Perbaiki di tabel lalu simpan lagi.'
                        : ` ${state.sent} dari ${state.chunkCount} potongan sudah tersimpan.`
                    }`
                  : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {state ? (
          <div
            role="progressbar"
            aria-label="Kemajuan penyimpanan"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
        {state && state.phase !== 'sending' ? (
          <AlertDialogFooter>
            {state.phase === 'failed' && state.chunkIndex > 0 ? (
              <Button type="button" variant="ghost" color="destructive" onClick={onDiscard}>
                Batalkan kiriman
              </Button>
            ) : null}
            <Button type="button" variant="outline" color="secondary" onClick={onClose}>
              Tutup
            </Button>
            {state.phase === 'paused' || (state.phase === 'failed' && state.chunkIndex > 0) ? (
              <Button type="button" onClick={onResume}>
                {state.phase === 'paused' ? 'Lanjutkan' : 'Coba lagi'}
              </Button>
            ) : null}
          </AlertDialogFooter>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
