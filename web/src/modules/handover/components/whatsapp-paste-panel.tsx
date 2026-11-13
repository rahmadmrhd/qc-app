import { splitWhatsappBatch } from '@shared/handover-paste';
import { useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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

/**
 * Tempelan besar dari WhatsApp dipecah menjadi task: baris judul memulai task baru dan menjadi usulan customer.
 * Hasilnya dapat disunting (customer dan catatan) sebelum ditambahkan ke batch.
 */
export function WhatsappPastePanel({ remaining, onAdd }: WhatsappPastePanelProps) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PastedTask[] | null>(null);
  useUnsavedChanges(text.trim() !== '' || preview !== null);

  const tooLong = text.length > MAX_PASTE_CHARS;

  function split() {
    if (tooLong) return;
    setPreview(
      splitWhatsappBatch(text).map((task) => ({
        customerName: task.customerSuggestion,
        note: task.note,
      })),
    );
  }

  function patch(index: number, change: Partial<PastedTask>) {
    setPreview((current) =>
      current ? current.map((task, i) => (i === index ? { ...task, ...change } : task)) : current,
    );
  }

  function add() {
    if (!preview || preview.length === 0 || preview.length > remaining) return;
    onAdd(preview);
    setPreview(null);
    setText('');
  }

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Tempel dari WhatsApp">
      <div>
        <h2 className="text-base font-semibold">Tempel dari WhatsApp</h2>
        <p className="text-sm text-muted-foreground">
          Tempel beberapa orderan sekaligus. Setiap pesan WhatsApp memulai task baru; baris tanpa
          jumlah yang langsung diikuti baris item (contoh “PT Maju,” atau “Orderan Online :”)
          menjadi judul dan usulan customer. Periksa hasilnya sebelum ditambahkan.
        </p>
      </div>
      <Textarea
        aria-label="Tempelan WhatsApp"
        rows={5}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {tooLong ? (
        <p role="alert" className="text-sm text-destructive">
          {`Tempelan ${text.length.toLocaleString('id-ID')} karakter melebihi batas ${MAX_PASTE_CHARS.toLocaleString('id-ID')} karakter dan tidak dipecah; bagi tempelan menjadi beberapa bagian.`}
        </p>
      ) : null}
      <Button type="button" variant="secondary" size="sm" disabled={tooLong} onClick={split}>
        Pecah
      </Button>
      {preview !== null && preview.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada task yang dikenali dari tempelan.</p>
      ) : null}
      {preview && preview.length > 0 ? (
        <>
          <ul className="space-y-3">
            {preview.map((task, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: pratinjau tanpa urut ulang
              <li key={index} className="space-y-2 rounded-md border p-3">
                <Input
                  aria-label={`Customer task ${index + 1}`}
                  placeholder="Customer (opsional)"
                  value={task.customerName}
                  onChange={(event) => patch(index, { customerName: event.target.value })}
                />
                <Textarea
                  aria-label={`Catatan task ${index + 1}`}
                  rows={3}
                  className="font-mono text-xs"
                  value={task.note}
                  onChange={(event) => patch(index, { note: event.target.value })}
                />
              </li>
            ))}
          </ul>
          {preview.length > remaining ? (
            <p role="alert" className="text-sm text-destructive">
              Hasil pecah {preview.length} task, melebihi sisa slot batch: {remaining}.
            </p>
          ) : null}
          <Button type="button" size="sm" disabled={preview.length > remaining} onClick={add}>
            {`Tambahkan ke batch (${preview.length})`}
          </Button>
        </>
      ) : null}
    </section>
  );
}
