import type { SerialDto, SerialEventDto, SerialProofPhotoDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { buIdsWithLevelOf, canManageSerial, serialActorModules } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { MarkdownView } from '@/modules/markdown/markdown-view';
import type { SerialTab } from '../lib/detail-tabs';
import { CUSTODY_LABEL, formatDay } from '../lib/labels';
import { todayWib } from '../lib/locations';
import { ProofReplaceProvider } from '../lib/proof-replace-context';
import { hasPendingProof, PROOF_POLL_MS } from '../lib/proof-state';
import { useSerialLocations } from '../lib/use-serial-locations';
import { serialDetailQueryOptions, useRemoveSerials, useRestoreSerials } from '../queries';
import { ActButtons, type ActKind, canReportDamage } from './act-buttons';
import { ActDialog } from './act-dialog';
import { CustodyPanel } from './custody-panel';
import { EditSerialDialog } from './edit-serial-dialog';
import { ProofBadge, ProofProblemBadge } from './proof-badge';
import { ProofGallery } from './proof-gallery';
import { ProofProblemBanner } from './proof-problem-banner';
import { SerialActivityLog } from './serial-activity-log';
import { SerialStatusBadge } from './serial-status-badge';
import { SerialStepper } from './serial-stepper';
import { TimelineTabs } from './timeline-tabs';

export interface SerialDetailPageProps {
  serialId: string;
  onBack: () => void;
  /** Tab aktif terkendali (search param `tab`); tanpa ini halaman memegangnya sendiri. */
  tab?: SerialTab | undefined;
  onTabChange?: ((tab: SerialTab) => void) | undefined;
}

/** Kejadian yang berarti "lolos": pencatatan awal dan cek ulang yang lolos. */
const PASS_TYPES = new Set(['recorded', 'recheck', 'recheck_pass']);

/** Tanggal kejadian lolos terakhir (`recorded`/`recheck`/`recheck_pass`; cek ulang tidak lolos tidak dihitung). */
export function lastPassDate(events: readonly SerialEventDto[]): string | null {
  const dates = events
    .filter((event) => PASS_TYPES.has(event.type) && event.data.result !== 'fail')
    .map((event) => event.occurredOn)
    .sort();
  return dates.at(-1) ?? null;
}

/**
 * Lokasi awal: nama dari kejadian `recorded` bila ada; bila tidak (linimasa terpotong, kejadian pertama tidak termuat)
 * dicari menurut `serial.recordedLocationId` di daftar lokasi yang dikenal pengguna.
 */
function recordedLocationName(
  events: readonly SerialEventDto[],
  recordedLocationId: string,
  known: readonly { id: string; name: string }[],
): string {
  const recorded = events.find((event) => event.type === 'recorded');
  const name = recorded?.data.locationName;
  if (typeof name === 'string' && name !== '') return name;
  return known.find((location) => location.id === recordedLocationId)?.name ?? '';
}

/** Kode BU yang sudah ditinggalkan serial ini (urut kronologis); BU saat ini tidak termasuk. */
export function formerBuCodes(serial: SerialDto): string[] {
  return serial.buHistory
    .filter((entry) => entry.leftAt !== '')
    .sort((a, b) => a.firstAt.localeCompare(b.firstAt))
    .map((entry) => entry.buCode);
}

/** Foto bukti dari kejadian yang termuat ditambah foto gagal entri (tanpa ganda), terbaru dulu. */
function allProofPhotos(
  events: readonly SerialEventDto[],
  problemPhotos: readonly SerialProofPhotoDto[],
): SerialProofPhotoDto[] {
  const seen = new Set<string>();
  const out: SerialProofPhotoDto[] = [];
  for (const photo of [...events.flatMap((event) => event.proofPhotos), ...problemPhotos]) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    out.push(photo);
  }
  return out;
}

/** Catatan pada dialog hapus: stok yang sudah terpotong tidak kembali (soft delete Serial Number). */
const DELETE_USAGE =
  'Stok stiker yang sudah dipotong oleh Serial Number ini tidak dikembalikan, dan laporan rusaknya ikut tak tampil.';

function Summary({ serial, events }: { serial: SerialDto; events: readonly SerialEventDto[] }) {
  const lastPass = lastPassDate(events);
  const { locations } = useSerialLocations();
  const firstLocation = recordedLocationName(events, serial.recordedLocationId, locations);
  const former = formerBuCodes(serial);
  return (
    <section aria-label="Ringkasan">
      <DetailList
        items={[
          { label: 'Item', value: serial.itemLabel },
          {
            label: 'Business Unit',
            value: (
              <span className="inline-flex flex-wrap items-center gap-2">
                <Badge variant="outline" color="primary">
                  {serial.buCode}
                </Badge>
                {former.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Pernah di: {former.join(', ')}
                  </span>
                ) : null}
              </span>
            ),
          },
          { label: 'Tanggal uji (pertama)', value: formatDay(serial.testDate) },
          { label: 'Terakhir lolos', value: lastPass ? formatDay(lastPass) : null },
          { label: 'Lokasi awal', value: firstLocation },
          { label: 'Lokasi terakhir', value: serial.locationName },
          { label: 'Sample', value: serial.sample ? 'Ya' : 'Tidak' },
          { label: 'Dicatat oleh', value: serial.createdBy },
          {
            label: 'Catatan',
            value:
              serial.note === '' ? null : (
                <MarkdownView source={serial.note} className="[&_p]:whitespace-pre-line" />
              ),
          },
          {
            label: 'Stiker ditempel',
            value:
              serial.stickers.length === 0
                ? null
                : serial.stickers.map((sticker) => `${sticker.name} ×${sticker.qty}`).join(', '),
          },
        ]}
      />
    </section>
  );
}

/**
 * View Serial Number (kit CRUD): tab Detail (tahap, pengiriman, ringkasan), Riwayat (tombol update + linimasa bertab),
 * dan Foto bukti QC. Aksi: Ubah data, Hapus/Pulihkan (`serial: manage` pada semua BU riwayat). `ProofReplaceProvider`
 * membungkus `ViewPage` supaya unggah ulang foto bermasalah (banner di luar tab, galeri di tab Foto) berbagi satu pemilik
 * dan berpindah tab tidak membatalkan penggantian yang berjalan.
 */
export function SerialDetailPage({ serialId, onBack, tab, onTabChange }: SerialDetailPageProps) {
  const me = useMe();
  const detail = useQuery({
    ...serialDetailQueryOptions(serialId),
    // Selama ada foto bukti yang menunggu cap, detail disegarkan berkala agar banner/badge "Foto bermasalah" muncul
    // begitu fotonya gagal (riwayat sudah punya polling sendiri, tetapi banner membaca kejadian detail ini).
    refetchInterval: (query) =>
      query.state.data && hasPendingProof(query.state.data.events) ? PROOF_POLL_MS : false,
  });
  const [editing, setEditing] = useState(false);
  const [acting, setActing] = useState<ActKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removeSerials = useRemoveSerials();
  const restoreSerials = useRestoreSerials();
  const serial = detail.data?.serial;
  const canManage =
    serial !== undefined &&
    canManageSerial(me, [serial.buId, ...serial.buHistory.map((entry) => entry.buId)]);

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat komponen
    // ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreSerials
      .mutateAsync({ ids: [serialId] })
      .then(() => {
        toast.success('Serial Number dipulihkan');
        void detail.refetch();
      })
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/serial',
    canRestore: canManage,
    onRestore: restore,
  });

  function remove() {
    removeSerials.mutate(
      { ids: [serialId] },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          afterDelete();
        },
        onError: (error) => {
          setConfirmDelete(false);
          toast.error(describeError(error));
        },
      },
    );
  }

  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">Memuat…</p>;
  }
  if (detail.isError || !detail.data || !serial) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive-text">
          {detail.error ? describeError(detail.error) : 'Serial tidak ditemukan.'}
        </p>
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar
        </Button>
      </div>
    );
  }
  const { events, problemPhotos } = detail.data;
  const deleted = serial.deleted !== undefined;
  const canWrite = buIdsWithLevelOf(me, 'serial', 'edit').includes(serial.buId);
  const photos = allProofPhotos(events, problemPhotos);
  const canReport = canReportDamage(
    { status: serial.status, custody: serial.custody },
    serialActorModules(me, serial.buId),
  );

  const detailTab = (
    <div className="space-y-6">
      <div data-tour="serial-stepper">
        <SerialStepper status={serial.status} hasCases={serial.cases.length > 0} />
      </div>
      <CustodyPanel serial={serial} today={todayWib()} />
      <ViewSection title="Ringkasan">
        <Summary serial={serial} events={events} />
      </ViewSection>
    </div>
  );

  const historyTab = (
    <section aria-label="Riwayat" className="space-y-3">
      {deleted ? null : (
        <ActButtons
          state={{ status: serial.status, custody: serial.custody }}
          actor={serialActorModules(me, serial.buId)}
          onPick={setActing}
        />
      )}
      <TimelineTabs serial={serial} />
    </section>
  );

  const photosTab = (
    <ViewSection title="Foto bukti QC">
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada foto bukti QC.</p>
      ) : (
        <>
          <ProofGallery photos={photos} />
          {detail.data.eventsTruncated ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Hanya foto dari 500 kejadian terbaru yang tampil di sini; foto yang lebih lama ada di
              kartu riwayatnya.
            </p>
          ) : null}
        </>
      )}
    </ViewSection>
  );

  return (
    <ProofReplaceProvider>
      <ViewPage
        title={<span className="font-mono">{serial.serial}</span>}
        badge={
          <span className="flex flex-wrap items-center gap-2">
            {deleted ? <DeletedBadge /> : null}
            <SerialStatusBadge status={serial.status} />
            <Badge variant="outline" color="primary">
              {serial.custody === 'transit'
                ? `${CUSTODY_LABEL.transit}${serial.transitToLocationName ? ` · ke ${serial.transitToLocationName}` : ''}`
                : `${CUSTODY_LABEL[serial.custody]} · ${serial.locationName}`}
            </Badge>
            {serial.openCase ? (
              <Badge
                variant="outline"
                color="primary"
              >{`${serial.openCase.number} (terbuka)`}</Badge>
            ) : null}
            {serial.hasProofPhotos ? <ProofBadge /> : null}
            <ProofProblemBadge count={serial.proofProblemCount} />
          </span>
        }
        actionItems={[
          {
            // Lapor rusak di sebelah Ubah di semua ukuran layar (desktop: bar judul; ponsel: bar bawah) (P7).
            id: 'report',
            action: 'reportDamage',
            primary: true,
            hidden: !canReport || deleted,
            onSelect: () => setActing('report'),
          },
          {
            id: 'edit',
            action: 'edit',
            label: 'Ubah data',
            primary: true,
            hidden: !canWrite || deleted,
            onSelect: () => setEditing(true),
          },
          {
            id: 'delete',
            action: 'delete',
            hidden: !canManage || deleted,
            onSelect: () => setConfirmDelete(true),
          },
          {
            id: 'restore',
            action: 'restore',
            busy: restoreSerials.isPending,
            hidden: !canManage || !deleted,
            onSelect: restore,
          },
        ]}
        banner={
          <>
            {serial.deleted ? (
              <DeletedBanner
                info={serial.deleted}
                canRestore={canManage}
                onRestore={restore}
                restoring={restoreSerials.isPending}
              />
            ) : null}
            <ProofProblemBanner count={serial.proofProblemCount} photos={problemPhotos} />
          </>
        }
        tabs={[
          { id: 'detail', label: 'Detail', content: detailTab },
          { id: 'riwayat', label: 'Riwayat', content: historyTab },
          { id: 'foto', label: 'Foto bukti', content: photosTab },
        ]}
        {...(tab ? { tab } : {})}
        onTabChange={(id) => onTabChange?.(id as SerialTab)}
        aside={
          <>
            <ViewMeta
              createdBy={serial.createdBy}
              createdAt={serial.createdAt}
              updatedBy={serial.updatedBy}
              updatedAt={serial.updatedAt}
            />
            <SerialActivityLog serialId={serial.id} />
          </>
        }
      />
      {acting ? <ActDialog serial={serial} kind={acting} onClose={() => setActing(null)} /> : null}
      {editing ? <EditSerialDialog serial={serial} onClose={() => setEditing(false)} /> : null}
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        count={1}
        subject="Serial Number"
        usage={DELETE_USAGE}
        onConfirm={remove}
        busy={removeSerials.isPending}
      />
    </ProofReplaceProvider>
  );
}
