import type { HandoverChecklistItemDto, HandoverCommentDto } from '@shared/contract';
import {
  handoverNormalizeAnchorText,
  makeAnchor,
  noteToPlainText,
} from '@shared/handover-comments';
import { Clock, LoaderCircle } from 'lucide-react';
import { Children, isValidElement, useEffect, useMemo, useRef, useState } from 'react';
import type { Components } from 'react-markdown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/modules/markdown/markdown-view';
import { collectNoteText, rangeForAnchor, setNoteHighlights } from '../lib/note-dom-text';
import type { ItemSendState } from '../lib/outbox-status';
import type { PendingComment } from '../lib/use-pending-checks';
import { CommentComposer } from './comment-composer';

export interface NoteViewProps {
  note: string;
  checklist: HandoverChecklistItemDto[];
  comments: HandoverCommentDto[];
  canCheck: boolean;
  canComment: boolean;
  /** Tampilan ringkas (kartu): komentar lebih kecil, kutipan dipotong. */
  compact?: boolean;
  /** Status kirim per indeks butir: `waiting` = di antrean perangkat, `sending` = permintaan sedang berjalan. */
  itemStates?: ReadonlyMap<number, ItemSendState>;
  /** Komentar yang masih di antrean perangkat; tampil di AKHIR daftar komentar dengan label status. */
  pendingComments?: readonly PendingComment[];
  onCheck: (item: { index: number; text: string }, checked: boolean) => void;
  onComment: (input: {
    quote: string;
    before: string;
    after: string;
    body: string;
  }) => Promise<void> | void;
}

interface Anchor {
  quote: string;
  before: string;
  after: string;
}

interface Pending extends Anchor {
  top: number;
  left: number;
}

const NO_PENDING_COMMENTS: readonly PendingComment[] = [];

const TOP_LEVEL_ITEM = /^- \[[ xX]\]/;

/** Nomor baris sumber (1-based) → indeks butir checklist tingkat atas; sama dengan `extractChecklist`. */
function checklistLines(note: string): Map<number, number> {
  const map = new Map<number, number>();
  let index = 0;
  note.split(/\r\n|\r|\n/).forEach((line, i) => {
    if (TOP_LEVEL_ITEM.test(line)) map.set(i + 1, index++);
  });
  return map;
}

function stripSpace(text: string): string {
  return text.replace(/\s+/g, '');
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Kutipan dari seleksi layar: baris dirapikan agar sama dengan teks polos catatan. */
function normalizeQuote(raw: string): string {
  return handoverNormalizeAnchorText(raw)
    .replace(/\r/g, '')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
}

/**
 * Jangkar komentar dari kutipan + teks sebelum seleksi: bila kutipan muncul berkali-kali pada teks polos,
 * pilih kemunculan yang konteks sebelumnya paling cocok dengan DOM.
 */
function buildAnchor(note: string, quote: string, textBefore: string): Anchor {
  const plain = noteToPlainText(note);
  const target = stripSpace(textBefore);
  let best = -1;
  let bestScore = -1;
  for (let i = plain.indexOf(quote); i >= 0; i = plain.indexOf(quote, i + 1)) {
    const score = commonSuffix(target, stripSpace(plain.slice(0, i)));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return { quote, before: '', after: '' };
  return makeAnchor(plain, best, best + quote.length);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function NoteView({
  note,
  checklist,
  comments,
  canCheck,
  canComment,
  compact = false,
  itemStates,
  pendingComments = NO_PENDING_COMMENTS,
  onCheck,
  onComment,
}: NoteViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [composer, setComposer] = useState<Anchor | null>(null);
  const pressingRef = useRef(false);
  const highlightOwner = useRef({});
  const noteRef = useRef(note);
  noteRef.current = note;

  // Tombol "Balas" untuk setiap seleksi teks di dalam catatan (desktop dan ponsel), bukan menu klik kanan.
  useEffect(() => {
    if (!canComment) {
      setPending(null);
      return;
    }
    function onSelectionChange() {
      // Menekan tombol Balas dapat meruntuhkan seleksi (mis. sentuhan di ponsel): jangan lepas tombolnya sebelum klik.
      if (pressingRef.current) return;
      const selection = window.getSelection();
      const body = bodyRef.current;
      const wrapper = wrapperRef.current;
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !body || !wrapper) {
        setPending(null);
        return;
      }
      const range = selection.getRangeAt(0);
      // Seleksi triple-klik berakhir di awal blok berikutnya (bisa di luar catatan): cukup awalnya berada di catatan.
      if (!body.contains(range.startContainer)) {
        setPending(null);
        return;
      }
      // Jangkar dari teks DOM tanpa meta ("oleh … · waktu"); cadangan: teks seleksi + konteks sebelum seleksi.
      let anchor = collectNoteText(body).anchorFor(range);
      if (anchor === null) {
        const quote = normalizeQuote(selection.toString());
        if (quote === '') {
          setPending(null);
          return;
        }
        const before = document.createRange();
        before.selectNodeContents(body);
        before.setEnd(range.startContainer, range.startOffset);
        anchor = buildAnchor(noteRef.current, quote, before.toString());
      }
      const rect = range.getBoundingClientRect();
      const box = wrapper.getBoundingClientRect();
      setPending({
        ...anchor,
        top: Math.max(0, rect.bottom - box.top + 6),
        left: Math.max(0, Math.min(rect.left - box.left, box.width - 72)),
      });
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [canComment]);

  // Sorot kutipan komentar (CSS Custom Highlight API bila tersedia; tidak mengubah DOM React). Rentang dicari
  // lewat teks DOM berpemisah blok + `locateAnchor`, jadi kutipan berulang dan lintas butir tepat.
  // biome-ignore lint/correctness/useExhaustiveDependencies: DOM catatan berubah bersama `note`
  useEffect(() => {
    const body = bodyRef.current;
    const owner = highlightOwner.current;
    if (!body) return;
    const ranges: Range[] = [];
    for (const comment of comments) {
      if (comment.stale || comment.quote === '') continue;
      const range = rangeForAnchor(body, comment);
      if (range) ranges.push(range);
    }
    setNoteHighlights(owner, ranges);
    return () => setNoteHighlights(owner, []);
  }, [comments, note, checklist]);

  const components = useMemo<Components>(() => {
    const lines = checklistLines(note);
    return {
      input: () => null,
      // Catatan Serah Terima tidak menampilkan gambar (hanya teks alt).
      img: ({ alt }) => (alt ? <span>{alt}</span> : null),
      li: ({ node, children, className }) => {
        const isTask = typeof className === 'string' && className.includes('task-list-item');
        if (!isTask) return <li>{children}</li>;
        const start = node?.position?.start;
        const index = start && start.column === 1 ? lines.get(start.line) : undefined;
        const item = index === undefined ? undefined : checklist[index];
        const nodes = Children.toArray(children);
        const lists = nodes.filter(
          (child) => isValidElement(child) && (child.type === 'ul' || child.type === 'ol'),
        );
        const content = nodes.filter((child) => !lists.includes(child));
        if (!item) {
          // Butir bersarang: hanya tampilan, tidak termasuk checklist.
          const checkbox = node?.children?.find(
            (child) => child.type === 'element' && child.tagName === 'input',
          );
          const checked = Boolean(
            checkbox && 'properties' in checkbox && checkbox.properties?.checked,
          );
          return (
            <li className="list-none">
              <span className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled
                  readOnly
                  className="mt-0.5 size-5 shrink-0"
                />
                <span>{content}</span>
              </span>
              {lists}
            </li>
          );
        }
        return (
          <li className="list-none">
            <label className="flex items-start gap-2 py-0.5 touch:min-h-11 touch:py-2">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0"
                checked={item.checked}
                disabled={!canCheck}
                onChange={(event) =>
                  onCheck({ index: item.index, text: item.text }, event.target.checked)
                }
              />
              <span>{content}</span>
            </label>
            {itemStates?.get(item.index) === 'sending' ? (
              <span
                data-note-meta=""
                className="ml-7 touch:ml-8 block text-xs italic text-muted-foreground"
              >
                <LoaderCircle
                  aria-hidden="true"
                  className="mr-1 inline size-3 animate-spin align-[-2px]"
                />
                Mengirim…
              </span>
            ) : itemStates?.get(item.index) === 'waiting' ? (
              <span
                data-note-meta=""
                className="ml-7 touch:ml-8 block text-xs italic text-muted-foreground"
              >
                <Clock aria-hidden="true" className="mr-1 inline size-3 align-[-2px]" />
                Belum terkirim
              </span>
            ) : item.checked && item.by !== '' ? (
              <span
                data-note-meta=""
                className="ml-7 touch:ml-8 block text-xs text-muted-foreground"
              >
                oleh {item.by} · {formatTime(item.at)}
              </span>
            ) : null}
            {lists}
          </li>
        );
      },
    };
  }, [note, checklist, canCheck, onCheck, itemStates]);

  return (
    <div ref={wrapperRef} className="relative space-y-3">
      <div ref={bodyRef}>
        <MarkdownView source={note} components={components} />
      </div>
      {pending && !composer ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          tabIndex={0}
          className="absolute z-10 shadow-md"
          style={{ top: pending.top, left: pending.left }}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            event.preventDefault();
            pressingRef.current = true;
          }}
          onPointerCancel={() => {
            pressingRef.current = false;
          }}
          onClick={() => {
            pressingRef.current = false;
            setComposer({ quote: pending.quote, before: pending.before, after: pending.after });
            setPending(null);
          }}
        >
          Balas
        </Button>
      ) : null}
      {composer ? (
        <CommentComposer
          quote={composer.quote}
          onCancel={() => setComposer(null)}
          onSubmit={async (body) => {
            await onComment({ ...composer, body });
            setComposer(null);
          }}
        />
      ) : null}
      {comments.length > 0 || pendingComments.length > 0 ? (
        <ul aria-label="Komentar" className={cn('space-y-2', compact && 'space-y-1.5')}>
          {comments.map((comment) => (
            <li
              key={comment.id}
              className={cn('rounded-md border text-sm', compact ? 'p-2 text-xs' : 'p-3')}
            >
              {comment.quote !== '' ? (
                <blockquote
                  className={cn(
                    'border-l-2 pl-3 text-muted-foreground',
                    compact && 'line-clamp-2 break-words',
                  )}
                >
                  {comment.quote}
                </blockquote>
              ) : null}
              <p className={cn('whitespace-pre-wrap break-words', comment.quote !== '' && 'mt-1')}>
                {comment.body}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {comment.author} · {formatTime(comment.at)}
                {comment.stale ? (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-medium">usang</span>
                ) : null}
              </p>
            </li>
          ))}
          {pendingComments.map((comment) => (
            <li
              key={comment.id}
              data-pending-comment=""
              className={cn(
                'rounded-md border border-dashed text-sm',
                compact ? 'p-2 text-xs' : 'p-3',
              )}
            >
              {comment.quote !== '' ? (
                <blockquote
                  className={cn(
                    'border-l-2 pl-3 text-muted-foreground',
                    compact && 'line-clamp-2 break-words',
                  )}
                >
                  {comment.quote}
                </blockquote>
              ) : null}
              <p className={cn('whitespace-pre-wrap break-words', comment.quote !== '' && 'mt-1')}>
                {comment.body}
              </p>
              <p className="mt-1 text-xs italic text-muted-foreground">
                {comment.status === 'sending' ? (
                  <>
                    <LoaderCircle
                      aria-hidden="true"
                      className="mr-1 inline size-3 animate-spin align-[-2px]"
                    />
                    Mengirim…
                  </>
                ) : (
                  <>
                    <Clock aria-hidden="true" className="mr-1 inline size-3 align-[-2px]" />
                    Belum terkirim
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {canComment && !composer ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setComposer({ quote: '', before: '', after: '' })}
        >
          Tambah komentar
        </Button>
      ) : null}
    </div>
  );
}
