import { splitWhatsappBatch } from '@shared/handover-paste';
import type { DemoScene } from '@/modules/guide/lib/demo-types';
import { type WaMessage, WhatsappMock } from './whatsapp-mock';

/** Pesan pesanan contoh: sumber tunggal untuk `SAMPLE_TEXT` (tempelan) dan bubble chat tiruan WhatsApp. */
const ORDER_MESSAGES = [
  {
    id: 'order-1',
    date: '13/11',
    time: '09.15',
    sender: 'Rina WH',
    lines: ['PT Maju Jaya :', 'CRS310 = 2 unit', 'RB5009UG = 1 unit'],
  },
  {
    id: 'order-2',
    date: '13/11',
    time: '09.20',
    sender: 'Rina WH',
    lines: ['Toko Sinar :', 'AF 5XHD = 5 unit'],
  },
] as const;

/**
 * Teks contoh dua pesan WhatsApp, dalam bentuk ekspor yang dikenali `splitWhatsappBatch` (awalan
 * `[tanggal, jam] Pengirim:` pada baris pertama tiap pesan). Hasil adegan "Pecah" dihitung fungsi aslinya atas teks
 * ini, jadi demo tidak basi bila aturan pemecahnya berubah. Di bubble chat, awalan itu tampil sebagai nama pengirim
 * dan jam (bukan bracket mentah).
 */
export const SAMPLE_TEXT = ORDER_MESSAGES.flatMap((message) =>
  message.lines.map((line, index) =>
    index === 0 ? `[${message.date}, ${message.time}] ${message.sender}: ${line}` : line,
  ),
).join('\n');

/** Hasil pecah teks contoh; dipakai adegan hasil dan keterangannya. */
const SAMPLE_TASKS = splitWhatsappBatch(SAMPLE_TEXT);

/** Isi chat tiruan: sapaan (bukan pesanan, tak ikut dipilih), dua pesan pesanan, dan balasan keluar. */
const CHAT_MESSAGES: readonly WaMessage[] = [
  {
    id: 'sapaan',
    sender: 'Dani Gudang',
    senderTone: 1,
    time: '09.10',
    lines: ['Pagi tim, ada orderan hari ini ya.'],
  },
  ...ORDER_MESSAGES.map((message) => ({
    id: message.id,
    sender: message.sender,
    senderTone: 0 as const,
    time: message.time,
    lines: message.lines,
  })),
  { id: 'balasan', outgoing: true, time: '09.22', lines: ['Siap, saya proses.'] },
];

const ORDER_IDS = ORDER_MESSAGES.map((message) => message.id);

function Chat({ selectedIds, copied }: { selectedIds?: readonly string[]; copied?: boolean }) {
  return (
    <WhatsappMock
      contactName="Tim Gudang QC"
      contactSubtitle="Dani Gudang, Rina WH, Anda"
      messages={CHAT_MESSAGES}
      selectedIds={selectedIds}
      copied={copied}
    />
  );
}

function PasteBox({ filled, highlightButton }: { filled: boolean; highlightButton: boolean }) {
  return (
    <div className="space-y-2 p-3">
      <div className="min-h-24 rounded-md border bg-background p-2">
        {filled ? (
          <pre className="font-sans text-xs whitespace-pre-wrap">{SAMPLE_TEXT}</pre>
        ) : (
          <p className="text-xs text-muted-foreground">Tempelan WhatsApp</p>
        )}
      </div>
      <span
        className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${
          highlightButton
            ? 'bg-primary text-primary-foreground ring-2 ring-ring ring-offset-2 ring-offset-background'
            : 'bg-muted text-foreground'
        }`}
      >
        Pecah
      </span>
    </div>
  );
}

function ResultScene() {
  return (
    <div className="space-y-2 p-3">
      {SAMPLE_TASKS.map((task, index) => (
        <div
          key={`${task.customerSuggestion}|${task.note}`}
          className="rounded-md border bg-card p-2"
        >
          <p className="text-xs font-semibold">{`Task ${index + 1}`}</p>
          <p className="text-xs text-muted-foreground">{`Customer: ${task.customerSuggestion || '-'}`}</p>
          <pre className="mt-1 font-sans text-xs whitespace-pre-wrap">{task.note}</pre>
        </div>
      ))}
    </div>
  );
}

/**
 * Demo tooltip "Tempel dari WhatsApp" (spek 4.6), semuanya adegan `kode`, urut sesuai alur: pilih pesan di WhatsApp
 * (tiruan tampilan WhatsApp, bukan klip), salin, tempel di kotak, tekan Pecah, lalu hasil kartu task.
 */
export const WhatsappDemoScenes: readonly DemoScene[] = [
  {
    kind: 'kode',
    caption: 'Mulai dari WhatsApp: buka chat yang berisi orderan.',
    durationMs: 3000,
    render: () => <Chat />,
  },
  {
    kind: 'kode',
    caption: 'Tekan lama satu pesan orderan.',
    durationMs: 3000,
    render: () => <Chat selectedIds={ORDER_IDS.slice(0, 1)} />,
  },
  {
    kind: 'kode',
    caption: 'Ketuk pesan orderan lainnya biar ikut terpilih.',
    durationMs: 3000,
    render: () => <Chat selectedIds={ORDER_IDS} />,
  },
  {
    kind: 'kode',
    caption: 'Ketuk ikon salin.',
    durationMs: 3000,
    render: () => <Chat selectedIds={ORDER_IDS} copied />,
  },
  {
    kind: 'kode',
    caption: 'Tempel sekali saja di kotak Tempel dari WhatsApp.',
    durationMs: 3500,
    render: () => <PasteBox filled highlightButton={false} />,
  },
  {
    kind: 'kode',
    caption: 'Tekan Pecah.',
    durationMs: 2500,
    render: () => <PasteBox filled highlightButton />,
  },
  {
    kind: 'kode',
    caption: `Hasilnya ${SAMPLE_TASKS.length} kartu task, customer terisi dari judul pesan. Periksa dulu sebelum disimpan.`,
    durationMs: 4500,
    render: () => <ResultScene />,
  },
];
