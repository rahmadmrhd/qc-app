import { splitWhatsappBatch } from '@shared/handover-paste';
import { useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TipButton } from '@/modules/guide/components/tip-button';
import { WHATSAPP_TIP_ID, WhatsappDemoScenes } from '../guide/whatsapp-demo';

/** Batas teks tempelan batch (30 task × 5.000 karakter); lebih dari ini tidak dipecah. */
const MAX_PASTE_CHARS = 150_000;

export interface PastedTask {
  customerName: string;
  note: string;
}

export interface WhatsappPastePanelProps {
  /** Sisa slot task pada batch (maks. 30 dikurangi yang sudah ada). */
  remaining: number;
  onAdd: (tasks: PastedTask[]) => void;
}

type Outcome =
  | { kind: 'added'; count: number }
  | { kind: 'empty' }
  | { kind: 'over'; count: number };

/**
 * Tempelan besar dari WhatsApp dipecah menjadi task: baris judul memulai task baru dan menjadi usulan customer.
 * "Pecah" langsung menambahkan hasilnya sebagai kartu ke batch; customer dan catatan dikoreksi di kartu itu
 * sebelum "Simpan semua".
 */
export function WhatsappPastePanel({ remaining, onAdd }: WhatsappPastePanelProps) {
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  useUnsavedChanges(text.trim() !== '');

  const tooLong = text.length > MAX_PASTE_CHARS;

  function split() {
    if (tooLong) return;
    const tasks = splitWhatsappBatch(text).map((task) => ({
      customerName: task.customerSuggestion,
      note: task.note,
    }));
    if (tasks.length === 0) {
      setOutcome({ kind: 'empty' });
      return;
    }
    // Melebihi sisa slot: tidak ada yang ditambahkan dan tempelan dipertahankan agar dapat dipotong.
    if (tasks.length > remaining) {
      setOutcome({ kind: 'over', count: tasks.length });
      return;
    }
    onAdd(tasks);
    setText('');
    setOutcome({ kind: 'added', count: tasks.length });
  }

  return (
    <section
      data-tour="handover-paste-panel"
      className="space-y-3 rounded-lg border p-4"
      aria-label="Tempel dari WhatsApp"
    >
      <div>
        <div className="flex items-center gap-1">
          <h2 className="text-base font-semibold">Tempel dari WhatsApp</h2>
          <TipButton
            tipId={WHATSAPP_TIP_ID}
            label="Cara tempel banyak pesan sekaligus"
            scenes={WhatsappDemoScenes}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Tempel beberapa orderan sekaligus. Setiap pesan WhatsApp memulai task baru; baris tanpa
          jumlah yang langsung diikuti baris item (contoh “PT Maju,” atau “Orderan Online :”)
          menjadi judul dan usulan customer. Hasilnya langsung ditambahkan sebagai kartu di bawah;
          periksa dan sunting di sana sebelum disimpan.
        </p>
      </div>
      <Textarea
        aria-label="Tempelan WhatsApp"
        rows={5}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOutcome(null);
        }}
      />
      {tooLong ? (
        <p role="alert" className="text-sm text-destructive">
          {`Tempelan ${text.length.toLocaleString('id-ID')} karakter melebihi batas ${MAX_PASTE_CHARS.toLocaleString('id-ID')} karakter dan tidak dipecah; bagi tempelan menjadi beberapa bagian.`}
        </p>
      ) : null}
      <Button type="button" variant="secondary" size="sm" disabled={tooLong} onClick={split}>
        Pecah
      </Button>
      {outcome?.kind === 'empty' ? (
        <p className="text-sm text-muted-foreground">Tidak ada task yang dikenali dari tempelan.</p>
      ) : null}
      {outcome?.kind === 'over' ? (
        <p role="alert" className="text-sm text-destructive">
          {`Hasil pecah ${outcome.count} task, melebihi sisa slot batch: ${remaining}. Tidak ada yang ditambahkan; kurangi tempelan atau hapus kartu yang tidak perlu.`}
        </p>
      ) : null}
      {outcome?.kind === 'added' ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {`${outcome.count} task ditambahkan ke batch.`}
        </p>
      ) : null}
    </section>
  );
}
