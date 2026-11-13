import { WHATSAPP_TIP_ID } from '@/modules/handover/guide/tip-ids';
import { registerDemoLoader } from '../lib/demo-types';
import type { GuideEntry, GuidePermission } from '../lib/types';

const WH_VIEW: GuidePermission = { module: 'handover', level: 'view', scope: 'location' };
const WH_EDIT: GuidePermission = { module: 'handover', level: 'edit', scope: 'location' };
const QC_EDIT: GuidePermission = { module: 'qc', level: 'edit', scope: 'location' };

/**
 * Panduan dasar Serah Terima (spek 7 butir 2). Izin panduan = izin item sidebar Serah Terima (sisi WH `view` atau
 * sisi QC `edit`); langkah sisi WH (menambah task) dan sisi QC (mencentang) punya `izin` sendiri sehingga satu
 * panduan melayani keduanya. Target `data-tour`: `handover-board` (`handover-board-page.tsx`), `handover-checklist`
 * (`handover-card.tsx`, `handover-detail-view.tsx`), `handover-new` (tombol Tambah task), `handover-batch-form`
 * (`handover-batch-form.tsx`), dan `handover-paste-panel` (`whatsapp-paste-panel.tsx`). Komentar disebut di teks
 * langkah checklist (komposernya baru ada saat teks dipilih, jadi tak bisa disorot). Tur tidak mengisi field apa
 * pun: demo tempel WhatsApp ditampilkan lewat `tip`, bukan dengan menempel sungguhan.
 */
export const HANDOVER_DASAR: GuideEntry = {
  id: 'handover-dasar',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Mengenal Serah Terima',
  izin: [WH_VIEW, QC_EDIT],
  halaman: '/handover',
  steps: [
    {
      target: 'handover-board',
      route: '/handover',
      text: 'Papan ini memuat task serah terima dari WH ke QC di lokasi aktif, dikelompokkan per status.',
      advance: 'next',
    },
    {
      target: 'handover-checklist',
      text: 'Isi catatan task berupa checklist. Pilih sepotong teks di catatan untuk memberi komentar.',
      advance: 'next',
    },
    {
      target: 'handover-checklist',
      text: 'Sisi QC: centang butir yang sudah dikerjakan. Status task ikut berubah sendiri; kalau semua beres, tandai task selesai.',
      advance: 'next',
      izin: QC_EDIT,
    },
    {
      target: 'handover-new',
      text: 'Sisi WH: tombol ini membuka formulir untuk menambah task baru.',
      advance: 'next',
      izin: WH_EDIT,
    },
    {
      target: 'handover-batch-form',
      route: '/handover/new',
      text: 'Satu formulir bisa memuat banyak task sekaligus, lalu disimpan sekali jalan.',
      advance: 'next',
      izin: WH_EDIT,
    },
    {
      target: 'handover-paste-panel',
      text: 'Punya banyak orderan di WhatsApp? Tempel sekaligus di sini, nanti dipecah jadi kartu task. Lihat demonya.',
      advance: 'next',
      izin: WH_EDIT,
      tip: WHATSAPP_TIP_ID,
    },
  ],
};

/** Tooltip ikon info "Tempel dari WhatsApp" (spek 4.6): penanda titiknya di penyimpanan panduan yang sama. */
export const HANDOVER_TIP_WA: GuideEntry = {
  id: WHATSAPP_TIP_ID,
  kind: 'tip',
  status: 'disimpan',
  version: 1,
  title: 'Cara tempel banyak pesan sekaligus',
  izin: WH_EDIT,
  steps: [],
};

// Demo yang sama dipakai ikon info (`TipButton`) dan langkah tur yang menyematkannya. Dimuat malas: katalog hanya
// metadata, adegannya (JSX, `splitWhatsappBatch`) baru diunduh saat demo dibuka.
registerDemoLoader(WHATSAPP_TIP_ID, async () => {
  const { WhatsappDemoScenes } = await import('@/modules/handover/guide/whatsapp-demo');
  return WhatsappDemoScenes;
});

export const HANDOVER_GUIDES: readonly GuideEntry[] = [HANDOVER_DASAR, HANDOVER_TIP_WA];
