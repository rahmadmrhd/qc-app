import { splitWhatsappBatch } from '@shared/handover-paste';
import { Check } from 'lucide-react';
import type { DemoScene } from '@/modules/guide/lib/demo-types';

/** Id entri `tip` katalog yang memakai demo ini (`shared/guides.ts`). */
export const WHATSAPP_TIP_ID = 'tip-handover-tempel-wa';

/**
 * Teks contoh dua pesan WhatsApp, dalam bentuk yang dikenali `splitWhatsappBatch`. Hasil adegan "Pecah" dihitung
 * fungsi aslinya atas teks ini, jadi demo tidak basi bila aturan pemecahnya berubah.
 */
export const SAMPLE_TEXT = [
  '[13/11, 09.15] Rina WH: PT Maju Jaya :',
  'CRS310 = 2 unit',
  'RB5009UG = 1 unit',
  '[13/11, 09.20] Rina WH: Toko Sinar :',
  'AF 5XHD = 5 unit',
].join('\n');

/** Hasil pecah teks contoh; dipakai adegan hasil dan keterangannya. */
const SAMPLE_TASKS = splitWhatsappBatch(SAMPLE_TEXT);

/** Gelembung chat generik (ilustrasi, bukan tiruan aplikasi WhatsApp). */
function Bubble({ children, selected }: { children: string; selected?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
        }`}
      >
        {selected ? <Check className="size-3" /> : null}
      </span>
      <p
        className={`rounded-lg px-2.5 py-1.5 text-xs ${
          selected ? 'bg-primary/15 ring-1 ring-primary' : 'bg-muted'
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function ChatScene() {
  return (
    <div className="space-y-2 p-3">
      {SAMPLE_TEXT.split('\n').map((line) => (
        <Bubble key={line} selected>
          {line}
        </Bubble>
      ))}
    </div>
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
            : 'bg-secondary text-secondary-foreground'
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
 * Demo tooltip "Tempel dari WhatsApp" (spek 4.6): empat adegan `kode` dan satu adegan `klip` untuk yang terjadi di
 * luar aplikasi. Klip belum direkam pemilik (tanpa `berkas`), jadi tampil sebagai langkah teks.
 */
export const WhatsappDemoScenes: readonly DemoScene[] = [
  {
    kind: 'kode',
    caption: 'Salin semua pesan orderannya sekaligus dari WhatsApp.',
    durationMs: 3500,
    render: () => <ChatScene />,
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
  {
    kind: 'klip',
    caption:
      'Di WhatsApp: tekan lama satu pesan, ketuk pesan lainnya untuk memilih banyak, lalu salin.',
  },
];
