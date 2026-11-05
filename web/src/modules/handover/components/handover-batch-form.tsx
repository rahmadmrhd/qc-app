import { HANDOVER_BATCH_MAX } from '@shared/handover';
import type { HandoverOptionsDto } from '@shared/rpc';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { FieldError } from '@/components/field-error';
import { FormHeader } from '@/components/form-header';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { LocationField } from '@/modules/location/location-field';
import type { HandoverBatchFormOutput } from '../schemas';
import { handoverBatchSchema } from '../schemas';
import { CustomerCombobox } from './customer-combobox';
import { NoteEditor } from './note-editor';
import type { PastedTask } from './whatsapp-paste-panel';
import { WhatsappPastePanel } from './whatsapp-paste-panel';

interface Card {
  key: number;
  customerName: string;
  note: string;
}

export interface HandoverBatchFormProps {
  options: HandoverOptionsDto;
  defaultLocationId?: string;
  /**
   * Simpan SEMUA task dalam SATU permintaan atomik (maks. `HANDOVER_BATCH_MAX` = 30): gagal = tidak ada yang
   * tersimpan, draf tetap utuh dan kartu bermasalah ditandai.
   */
  onSubmit: (values: HandoverBatchFormOutput) => Promise<unknown>;
  /** Semua task berhasil disimpan (jumlah task). */
  onSaved?: (count: number) => void;
  onCancel: () => void;
}

/** Galat server "Task N: pesan" → indeks kartu (0-based) dan pesan. */
function parseTaskError(error: unknown): { index: number; message: string } | null {
  if (!(error instanceof ApiError)) return null;
  const match = /^Task (\d+):\s*(.*)$/.exec(error.fields?.tasks ?? '');
  if (!match) return null;
  return { index: Number(match[1]) - 1, message: match[2] || error.message };
}

export function HandoverBatchForm({
  options,
  defaultLocationId = '',
  onSubmit,
  onSaved,
  onCancel,
}: HandoverBatchFormProps) {
  const nextKey = useRef(1);
  const newCard = (init: Partial<Card> = {}): Card => ({
    key: nextKey.current++,
    customerName: '',
    note: '',
    ...init,
  });
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [cards, setCards] = useState<Card[]>(() => [newCard()]);
  // Galat per kartu menurut `key` kartu (bukan indeks): tetap menempel pada kartu yang benar setelah ada yang dihapus.
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const baseId = useId();
  const full = cards.length >= HANDOVER_BATCH_MAX;
  // Satu kartu kosong awal akan diganti oleh hasil tempel, jadi tidak memakai slot.
  const pristine = cards.length === 1 && cards[0]?.note === '' && cards[0].customerName === '';
  const remaining = HANDOVER_BATCH_MAX - (pristine ? 0 : cards.length);

  function patch(key: number, change: Partial<Card>) {
    setCards((current) =>
      current.map((card) => (card.key === key ? { ...card, ...change } : card)),
    );
  }

  function addPasted(tasks: PastedTask[]) {
    setCards((current) => {
      const empty =
        current.length === 1 && current[0]?.note === '' && current[0].customerName === '';
      const base = empty ? [] : current;
      return [...base, ...tasks.map((task) => newCard(task))];
    });
  }

  async function submit() {
    setFormError(null);
    setLocationError(null);
    setCardErrors({});
    const keys = cards.map((card) => card.key);
    const parsed = handoverBatchSchema.safeParse({
      locationId,
      tasks: cards.map(({ customerName, note }) => ({ customerName, note })),
    });
    if (!parsed.success) {
      const errors: Record<number, string> = {};
      for (const issue of parsed.error.issues) {
        const [head, index] = issue.path;
        if (head === 'locationId') setLocationError(issue.message);
        else if (head === 'tasks' && typeof index === 'number') {
          const key = keys[index];
          if (key !== undefined) errors[key] ??= issue.message;
        } else setFormError(issue.message);
      }
      setCardErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(parsed.data);
      onSaved?.(parsed.data.tasks.length);
    } catch (error) {
      const task = parseTaskError(error);
      const key = task ? keys[task.index] : undefined;
      if (task && key !== undefined) setCardErrors({ [key]: task.message });
      else if (task) setFormError(`Task ${task.index + 1}: ${task.message}`);
      else setFormError(describeError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormHeader
        title="Tambah banyak task"
        onCancel={onCancel}
        submitting={submitting}
        submitLabel={`Simpan semua (${cards.length})`}
        busyText="Menyimpan semua task…"
      />
      <section className="space-y-1.5 rounded-lg border p-4">
        <LocationField
          id={`${baseId}-location`}
          module="handover"
          level="edit"
          value={locationId}
          onChange={setLocationId}
        />
        <FieldError errors={[locationError ?? undefined]} />
      </section>

      <WhatsappPastePanel remaining={remaining} onAdd={addPasted} />

      <div className="space-y-3">
        {cards.map((card, index) => {
          const error = cardErrors[card.key];
          return (
            <fieldset
              key={card.key}
              aria-label={`Task ${index + 1}`}
              className={`space-y-3 rounded-lg border p-4 ${error ? 'border-destructive' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{`Task ${index + 1}`}</h2>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={full}
                    onClick={() =>
                      setCards((current) => {
                        const at = current.findIndex((entry) => entry.key === card.key);
                        const copy = newCard({ note: card.note });
                        return [...current.slice(0, at + 1), copy, ...current.slice(at + 1)];
                      })
                    }
                  >
                    <Copy aria-hidden="true" />
                    Gandakan
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={cards.length === 1}
                    onClick={() => setCards((current) => current.filter((c) => c.key !== card.key))}
                  >
                    <Trash2 aria-hidden="true" />
                    Hapus
                  </Button>
                </div>
              </div>
              <CustomerCombobox
                id={`${baseId}-customer-${card.key}`}
                value={card.customerName}
                onChange={(customerName) => patch(card.key, { customerName })}
                customers={options.customers}
                inactiveNames={options.inactiveCustomerNames}
              />
              <div className="space-y-1.5">
                <span id={`${baseId}-note-${card.key}`} className="text-sm font-medium">
                  {`Catatan task ${index + 1}`}
                </span>
                <NoteEditor
                  id={`${baseId}-note-field-${card.key}`}
                  labelledBy={`${baseId}-note-${card.key}`}
                  value={card.note}
                  onChange={(note) => patch(card.key, { note })}
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={full}
        onClick={() => setCards((current) => [...current, newCard()])}
      >
        <Plus aria-hidden="true" />
        Tambah task
      </Button>
      {full ? (
        <p className="text-xs text-muted-foreground">
          Maksimal {HANDOVER_BATCH_MAX} task per batch.
        </p>
      ) : null}

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
