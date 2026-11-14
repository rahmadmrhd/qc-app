import { HANDOVER_LIMITS } from '@shared/handover';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { DemoScene } from '@/modules/guide/lib/demo-types';
import {
  DEMO_COMMENT_BODY,
  DEMO_ITEMS,
  DemoHandoverCard,
  demoComment,
  demoHandover,
  useDemoSelection,
} from './demo-card';

/**
 * Demo tooltip `tip-handover-komentar` (spek 4.6), pada kartu contoh yang sama dengan demo checklist:
 * (a) teks dipilih (seleksi asli peramban; `NoteView` memunculkan tombol "Balas" sendiri), (b) komposer komentar,
 * (c) komentar tampil dengan kutipan dan sorotan jangkar. Tanpa efek samping: hanya seleksi dokumen yang disentuh.
 */
const QUOTE = DEMO_ITEMS[0];

/** Menelan klik dan tombol Enter/Spasi di seluruh bingkai: kartu asli ini tak boleh membuka komposer sungguhan. */
function blockInteraction(event: { preventDefault: () => void; stopPropagation: () => void }) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Adegan pilih-teks tak dapat dibungkus `inert` (seleksi programatiknya bisa dilepas peramban pada simpul inert),
 * jadi dibuat tak dapat dioperasikan lewat penelan peristiwa tahap tangkap: tombol "Tambah komentar"/"Balas" aslinya
 * tampil tetapi tak berfungsi, sehingga `CommentComposer` (yang memasang status "belum disimpan") tak pernah terbuka.
 */
function SelectFrame() {
  const ref = useDemoSelection(QUOTE);
  return (
    <div
      ref={ref}
      className="pointer-events-none"
      onClickCapture={blockInteraction}
      onKeyDownCapture={blockInteraction}
    >
      <DemoHandoverCard handover={demoHandover(0)} interactiveLook={false} />
    </div>
  );
}

/**
 * Tiruan tampilan `CommentComposer` (komponen aslinya memegang status "belum disimpan" aplikasi dan hanya dapat
 * diketik, jadi tidak dipakai di demo): kutipan, kolom komentar (maks. `HANDOVER_LIMITS.comment` karakter), Batal, Kirim.
 */
function ComposerFrame() {
  return (
    <div inert>
      <DemoHandoverCard handover={demoHandover(0)} interactiveLook={false} />
      <div className="px-3 pb-3" data-slot="demo-composer">
        <div className="space-y-2 rounded-md border bg-card p-3">
          <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">{QUOTE}</blockquote>
          <Textarea
            aria-label="Komentar"
            maxLength={HANDOVER_LIMITS.comment}
            readOnly
            value={DEMO_COMMENT_BODY}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" tabIndex={-1}>
              Batal
            </Button>
            <Button type="button" size="sm" tabIndex={-1}>
              Kirim
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommentedFrame() {
  return (
    <div inert>
      <DemoHandoverCard handover={demoHandover(0, [demoComment()])} interactiveLook={false} />
    </div>
  );
}

export const CommentDemoScenes: readonly DemoScene[] = [
  {
    kind: 'kode',
    caption: 'Pilih sepotong teks di catatan, nanti muncul tombol Balas.',
    durationMs: 3500,
    render: () => <SelectFrame />,
  },
  {
    kind: 'kode',
    caption: 'Tulis komentarnya lalu Kirim. Kutipan teks yang dipilih ikut tersimpan.',
    durationMs: 4000,
    render: () => <ComposerFrame />,
  },
  {
    kind: 'kode',
    caption: 'Komentar tampil di bawah catatan, dan teks yang dikomentari ditandai.',
    durationMs: 4000,
    render: () => <CommentedFrame />,
  },
];
