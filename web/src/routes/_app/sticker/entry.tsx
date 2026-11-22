import type { AdjustStockBatchInput, RecordStockBatchInput } from '@shared/contract';
import { STICKER_LIMITS } from '@shared/stickers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useBlocker, useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormPage } from '@/components/page/form-page';
import { PageContent } from '@/components/page/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { leaveBlocker } from '@/lib/leave-blocker';
import { locationsWith, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import { EntryPage, type EntrySaveResult } from '@/modules/sticker/components/entry-page';
import { stickerKeys } from '@/modules/sticker/keys';
import type { EntryMode } from '@/modules/sticker/lib/entry-rows';
import {
  stickerStockQuery,
  useAdjustStockBatch,
  useRecordStockBatch,
} from '@/modules/sticker/queries';

const searchSchema = z.object({
  mode: z.enum(['in', 'out', 'adjust']).optional().catch(undefined),
  /** Id stiker dari tombol "Entri stok" di View Stiker: mengisi kolom cari dan masuk entri awal. */
  sticker: z.string().max(100).optional().catch(undefined),
  /** Id stiker dari aksi stok massal di katalog Stiker: semuanya masuk entri awal. */
  stickers: z.array(z.string().max(100)).max(STICKER_LIMITS.opnameRows).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/sticker/entry')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  // Masuk dan Keluar butuh `stickerstock: edit`; mode Koreksi butuh `manage` (diturunkan ke Masuk bila tak berhak).
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'stickerstock', 'edit'),
  component: StickerEntryRoute,
  staticData: { crumb: 'Entri stok', pageWidth: 'narrow', locationAware: true },
});

const LEAVE_MESSAGE = 'Isian entri stok belum disimpan dan akan hilang. Tetap keluar dari halaman?';
const FORM_ID = 'sticker-entry';

function StickerEntryRoute() {
  const me = useMe();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const { selectedIds } = useActiveLocations();
  const canAdjust = locationsWith(me, 'stickerstock', 'manage', selectedIds).length > 0;
  const mode: EntryMode = search.mode === 'adjust' && !canAdjust ? 'in' : (search.mode ?? 'in');
  // Hanya lokasi terpilih yang boleh dilihat user yang diminta: satu lokasi terlarang menolak seluruh permintaan.
  const readable = locationsWith(me, 'stickerstock', 'view', selectedIds);
  const stock = useQuery(stickerStockQuery(readable.map((location) => location.id)));
  const record = useRecordStockBatch();
  const adjust = useAdjustStockBatch();
  const [busy, setBusy] = useState(false);
  const [submittable, setSubmittable] = useState(false);
  const dirty = useRef(false);
  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  // Isian hilang bila halaman ditinggalkan (tautan sidebar, tombol kembali): tanyakan dulu. Menutup tab juga.
  useBlocker({
    shouldBlockFn: leaveBlocker(() => dirty.current && !window.confirm(LEAVE_MESSAGE)),
    enableBeforeUnload: () => dirty.current,
  });

  const backToStock = () => stack.pop({ to: '/sticker' });

  async function handleSave(
    kind: EntryMode,
    input: RecordStockBatchInput | AdjustStockBatchInput,
  ): Promise<EntrySaveResult> {
    try {
      if (kind === 'adjust') await adjust.mutateAsync(input as AdjustStockBatchInput);
      else await record.mutateAsync(input as RecordStockBatchInput);
      toast.success('Stok dicatat');
      return null;
    } catch (error) {
      // Stok bisa berubah oleh orang lain (mis. "Stok tidak cukup"): muat ulang agar "Tercatat" terbaru; isian tetap.
      void queryClient.invalidateQueries({ queryKey: stickerKeys.stocks });
      return { message: describeError(error) };
    }
  }

  if (locationsWith(me, 'stickerstock', 'edit', selectedIds).length === 0) {
    return (
      <PageContent className="space-y-2">
        <h1 className="text-2xl font-semibold">Entri stok</h1>
        <NoLocationNotice />
        <p className="text-sm text-muted-foreground">
          Tidak ada lokasi terpilih yang dapat Anda catat stoknya. Pilih lokasi lain di header.
        </p>
      </PageContent>
    );
  }
  if (stock.isPending) {
    return (
      <PageContent>
        <Skeleton className="h-64 w-full" />
      </PageContent>
    );
  }
  if (stock.isError) {
    return (
      <PageContent>
        <p role="alert" className="text-sm text-destructive-text">
          {describeError(stock.error)}
        </p>
      </PageContent>
    );
  }

  return (
    <FormPage
      formId={FORM_ID}
      title="Entri stok"
      onCancel={backToStock}
      submitting={busy}
      submitDisabled={!submittable}
    >
      <EntryPage
        formId={FORM_ID}
        mode={mode}
        // Mode memengaruhi URL (dapat dibagikan): ganti entri riwayat, jangan menumpuknya.
        onModeChange={(next) =>
          void navigate({ search: (prev) => ({ ...prev, mode: next }), replace: true })
        }
        rows={stock.data}
        canAdjust={canAdjust}
        initialStickerId={search.sticker}
        {...(search.stickers ? { initialStickerIds: search.stickers } : {})}
        onSave={handleSave}
        onDirtyChange={setDirty}
        onBusyChange={setBusy}
        onSubmittableChange={setSubmittable}
        onDone={() => {
          // Sudah tersimpan: keluar tanpa konfirmasi.
          dirty.current = false;
          backToStock();
        }}
      />
    </FormPage>
  );
}
