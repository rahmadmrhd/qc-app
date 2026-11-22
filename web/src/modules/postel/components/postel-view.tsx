import type { PostelAttachmentDto, PostelDto, PostelNumberDto } from '@shared/contract';
import { toast } from 'sonner';
import { type DataColumn, DataTable, LinkCell } from '@/components/data-table';
import { type AttachmentItem, AttachmentView } from '@/components/file-dialog';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { api } from '@/lib/api';
import { describeError } from '@/lib/api/describe-error';
import { isWebUrl } from '@/lib/web-url';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { saveFileDownload } from '@/modules/qrcode/lib/download';
import { daysLeftLabel, formatPostelDate } from '../lib/condition';
import { NumberStatus } from './number-status';
import { PostelHistory } from './postel-history';
import { PostelImage } from './postel-image';

export const POSTEL_VIEW_TABS = ['detail', 'item', 'lampiran', 'riwayat'] as const;
export type PostelViewTab = (typeof POSTEL_VIEW_TABS)[number];

export interface PostelViewProps {
  /** `undefined` = catatan tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  postel: PostelDto | undefined;
  /** `sticker: edit`: Ubah, Hapus, dan Pulihkan. */
  canEdit?: boolean;
  restorePending?: boolean;
  /** Item pada tab Item menaut ke View item hanya bila pengguna berhak (`itemLinkAccess`); bawaan tanpa tautan. */
  canOpenItem?: boolean;
  /** Item TERHAPUS menaut hanya bagi pemulih (`item: manage`; soft delete §4.4). */
  canOpenDeletedItem?: boolean;
  tab?: PostelViewTab | undefined;
  onTabChange?: (tab: PostelViewTab) => void;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

const NUMBER_COLUMNS: DataColumn<PostelNumberDto>[] = [
  { id: 'number', header: 'Nomor', mobile: 'title', cell: (entry) => entry.number },
  { id: 'expires', header: 'Tanggal habis', cell: (entry) => formatPostelDate(entry.expiresOn) },
  { id: 'daysLeft', header: 'Sisa hari', cell: (entry) => daysLeftLabel(entry.daysLeft) },
  {
    id: 'status',
    header: 'Status',
    cell: (entry) => <NumberStatus role={entry.role} condition={entry.condition} />,
  },
  {
    id: 'link',
    header: 'Tautan',
    cell: (entry) =>
      isWebUrl(entry.link) ? (
        <a
          href={entry.link}
          target="_blank"
          rel="noreferrer"
          className="text-info-text underline-offset-4 hover:underline"
        >
          Buka sertifikat
        </a>
      ) : null,
  },
];

/** Unduh PDF lampiran (gambar hanya dipratinjau); galat tampil sebagai toast. */
async function downloadAttachment(attachment: PostelAttachmentDto): Promise<void> {
  try {
    const file = await api('postelFiles.get', { id: attachment.id });
    saveFileDownload({ bytes: file.bytes, mime: file.mime, filename: attachment.filename });
  } catch (failure) {
    toast.error(describeError(failure));
  }
}

function toAttachmentItem(attachment: PostelAttachmentDto): AttachmentItem {
  return {
    id: attachment.id,
    name: attachment.filename,
    mime: attachment.mime,
    size: attachment.size,
    // Gambar hanya pratinjau (spek dialog unggah §5.4); hanya PDF yang diunduh.
    ...(attachment.mime.startsWith('image/')
      ? {
          renderImage: (variant: 'thumb' | 'large') => (
            <PostelImage id={attachment.id} alt={attachment.filename} variant={variant} />
          ),
        }
      : { onDownload: () => void downloadAttachment(attachment) }),
  };
}

/**
 * Halaman baca satu catatan Postel (kit `ViewPage`): tab Detail (identitas, catatan, nomor sertifikat), Item (menurut
 * BU pembaca), Lampiran, dan Riwayat (tidak untuk catatan terhapus: riwayatnya hanya di log audit umum).
 */
export function PostelView({
  postel,
  canEdit = false,
  restorePending = false,
  canOpenItem = false,
  canOpenDeletedItem = false,
  tab,
  onTabChange,
  onBack,
  onEdit,
  onDelete,
  onRestore,
}: PostelViewProps) {
  if (!postel) {
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">Catatan Postel tidak ditemukan</h1>
        <button type="button" className="text-sm underline underline-offset-4" onClick={onBack}>
          Kembali ke daftar
        </button>
      </PageContent>
    );
  }
  const deleted = postel.deleted !== undefined;

  const detail = (
    <div className="space-y-6">
      <ViewSection title="Identitas">
        <DetailList
          items={[
            { label: 'Nama', value: postel.name },
            { label: 'Jumlah item', value: String(postel.itemCount) },
            {
              label: 'Catatan',
              value:
                postel.note.trim() === '' ? null : (
                  <span className="break-words whitespace-pre-wrap">{postel.note}</span>
                ),
            },
          ]}
        />
      </ViewSection>
      <ViewSection title="Nomor sertifikat">
        <DataTable
          rows={postel.numbers}
          rowKey={(entry) => entry.id}
          columns={NUMBER_COLUMNS}
          label="Nomor sertifikat"
          fit="content"
          empty="Belum ada nomor sertifikat."
        />
      </ViewSection>
    </div>
  );

  const itemsTab = (
    <ViewSection title="Item tergabung">
      {postel.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {postel.hiddenItemCount === 0
            ? 'Belum ada item yang tergabung.'
            : 'Tidak ada item yang dapat Anda lihat.'}
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {postel.items.map((item) => {
            const label = `${item.brand} ${item.model}`;
            const linked = canOpenItem && (!item.deleted || canOpenDeletedItem);
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-1.5">
                {linked ? (
                  <LinkCell to="/item/$itemId" params={{ itemId: item.id }}>
                    {label}
                  </LinkCell>
                ) : (
                  <span>{label}</span>
                )}
                {item.deleted ? <DeletedBadge /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {postel.hiddenItemCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {`${postel.hiddenItemCount} item lain tergabung di sini tetapi tidak terlihat oleh Anda`}
        </p>
      ) : null}
    </ViewSection>
  );

  const attachmentsTab = (
    <ViewSection title="Lampiran">
      {postel.attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada lampiran.</p>
      ) : (
        <AttachmentView
          items={postel.attachments.map(toAttachmentItem)}
          layout="list"
          label="lampiran"
        />
      )}
    </ViewSection>
  );

  return (
    <ViewPage
      title={postel.name}
      badge={deleted ? <DeletedBadge /> : undefined}
      tab={tab}
      onTabChange={(id) => onTabChange?.(id as PostelViewTab)}
      tabs={[
        { id: 'detail', label: 'Detail', content: detail },
        { id: 'item', label: 'Item', content: itemsTab },
        { id: 'lampiran', label: 'Lampiran', content: attachmentsTab },
        ...(deleted
          ? []
          : [{ id: 'riwayat', label: 'Riwayat', content: <PostelHistory id={postel.id} /> }]),
      ]}
      actionItems={
        deleted
          ? [
              {
                id: 'restore',
                action: 'restore',
                busy: restorePending,
                hidden: !(canEdit && onRestore),
                onSelect: () => onRestore?.(),
              },
            ]
          : [
              {
                id: 'edit',
                action: 'edit',
                label: 'Ubah',
                hidden: !(canEdit && onEdit),
                onSelect: () => onEdit?.(),
              },
              {
                id: 'delete',
                action: 'delete',
                hidden: !(canEdit && onDelete),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        postel.deleted ? (
          <DeletedBanner
            info={postel.deleted}
            canRestore={canEdit}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={
        <>
          <ViewMeta
            createdAt={postel.createdAt}
            updatedBy={postel.updatedBy}
            updatedAt={postel.updatedAt}
          />
          <ActivityLog kind="postel" id={postel.id} createdAt={postel.createdAt} />
        </>
      }
    />
  );
}
