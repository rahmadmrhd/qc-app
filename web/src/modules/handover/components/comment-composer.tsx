import { HANDOVER_LIMITS } from '@shared/handover';
import { useId, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface CommentComposerProps {
  quote: string;
  onSubmit: (body: string) => Promise<void> | void;
  onCancel: () => void;
}

/** Form komentar kecil untuk kutipan yang dipilih (`quote` kosong = komentar umum tanpa seleksi); galat pengiriman ditampilkan dan isi dipertahankan. */
export function CommentComposer({ quote, onSubmit, onCancel }: CommentComposerProps) {
  const fieldId = useId();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(body.trim() !== '');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = body.trim();
    if (text === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Komentar gagal dikirim');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2 rounded-md border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {quote !== '' ? (
        <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">{quote}</blockquote>
      ) : null}
      <Textarea
        id={fieldId}
        aria-label="Komentar"
        maxLength={HANDOVER_LIMITS.comment}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" size="sm" disabled={busy || body.trim() === ''}>
          Kirim
        </Button>
      </div>
    </form>
  );
}
