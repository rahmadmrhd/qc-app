import type { WarehouseHandoverCandidateDto } from '@shared/contract';
import { noteToPlainText } from '@shared/handover-comments';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Children, Fragment, isValidElement, type ReactNode, useMemo } from 'react';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { checklistLines } from '@/modules/handover/components/note-view';
import { MarkdownView } from '@/modules/markdown/markdown-view';

type Mark = 'match' | 'mismatch' | null;

const MARK_CLASS: Record<'match' | 'mismatch', string> = {
  match: 'rounded-sm border-l-2 border-success-text bg-success-text/10 pl-1.5',
  mismatch: 'rounded-sm border-l-2 border-warning-text bg-warning-text/10 pl-1.5',
};

/** Ikon dan teks pembaca layar di awal baris bertanda: penanda tidak hanya mengandalkan warna. */
function MarkLead({ mark }: { mark: 'match' | 'mismatch' }) {
  return mark === 'match' ? (
    <>
      <CircleCheck
        aria-hidden="true"
        className="mr-1 inline size-3.5 text-success-text align-[-2px]"
      />
      <span className="sr-only">Menyebut Item ini: </span>
    </>
  ) : (
    <>
      <TriangleAlert
        aria-hidden="true"
        className="mr-1 inline size-3.5 text-warning-text align-[-2px]"
      />
      <span className="sr-only">Menyebut Item lain: </span>
    </>
  );
}

/** Teks polos satu baris sumber catatan (sama dengan yang dipakai server untuk `matchedLines`/`mismatchLines`). */
function plainOfLine(source: readonly string[], line: number | undefined): string {
  if (line === undefined) return '';
  return noteToPlainText(source[line - 1] ?? '');
}

/** Memecah anak paragraf/butir menjadi baris sumber (soft break dan `<br>` = baris baru). */
function splitLines(children: ReactNode): ReactNode[][] {
  const lines: ReactNode[][] = [[]];
  const last = () => lines[lines.length - 1] as ReactNode[];
  for (const child of Children.toArray(children)) {
    if (typeof child === 'string') {
      child.split('\n').forEach((part, index) => {
        if (index > 0) lines.push([]);
        if (part !== '') last().push(part);
      });
    } else if (isValidElement(child) && child.type === 'br') {
      lines.push([]);
    } else {
      last().push(child);
    }
  }
  return lines;
}

export interface CandidateNoteProps {
  candidate: Pick<
    WarehouseHandoverCandidateDto,
    'note' | 'checklist' | 'matchedLines' | 'mismatchLines'
  >;
  className?: string;
}

/**
 * Catatan task Serah Terima, HANYA-BACA: Markdown ter-render dengan centang dari checklist (tidak dapat diubah dari
 * sini). Baris yang menyebut Item terpilih ditandai hijau, baris yang menyebut Item lain kuning (dari
 * `matchedLines`/`mismatchLines` server), lengkap dengan ikon dan teks pembaca layar. Tinggi dibatasi dan menggulir.
 */
export function CandidateNote({ candidate, className }: CandidateNoteProps) {
  const { note, checklist, matchedLines, mismatchLines } = candidate;
  const components = useMemo<Components>(() => {
    const source = note.split(/\r\n|\r|\n/);
    const lines = checklistLines(note);
    const matched = new Set(matchedLines);
    const mismatch = new Set(mismatchLines);
    const markOf = (line: number | undefined): Mark => {
      const plain = plainOfLine(source, line);
      if (plain === '') return null;
      if (matched.has(plain)) return 'match';
      if (mismatch.has(plain)) return 'mismatch';
      return null;
    };
    // Tiap baris sumber ditandai sendiri: baris pertama paragraf/butir pada `startLine`, baris lanjutan (soft break)
    // pada `startLine + i`. Baris yang cocok tidak mewarnai baris lain yang tak cocok.
    const renderLines = (children: ReactNode, startLine: number | undefined): ReactNode =>
      splitLines(children).map((line, index) => {
        const mark = markOf(startLine === undefined ? undefined : startLine + index);
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: baris statis menurut urutan sumber
            key={index}
            data-mark={mark ?? undefined}
            className={cn('block', mark && MARK_CLASS[mark])}
          >
            {mark ? <MarkLead mark={mark} /> : null}
            {line.map((part, partIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: bagian statis menurut urutan sumber
              <Fragment key={partIndex}>{part}</Fragment>
            ))}
          </span>
        );
      });
    return {
      input: () => null,
      img: ({ alt }) => (alt ? <span>{alt}</span> : null),
      p: ({ node, children }) => <p>{renderLines(children, node?.position?.start.line)}</p>,
      li: ({ node, children, className: liClass }) => {
        const isTask = typeof liClass === 'string' && liClass.includes('task-list-item');
        const start = node?.position?.start;
        const nodes = Children.toArray(children);
        const lists = nodes.filter(
          (child) => isValidElement(child) && (child.type === 'ul' || child.type === 'ol'),
        );
        const content = nodes.filter((child) => !lists.includes(child));
        // Butir longgar membungkus isinya dalam paragraf yang menandai barisnya sendiri.
        const loose = Boolean(
          node?.children?.some((child) => child.type === 'element' && child.tagName === 'p'),
        );
        const body = loose ? content : renderLines(content, start?.line);
        if (!isTask) {
          return (
            <li>
              {body}
              {lists}
            </li>
          );
        }
        const index = start && start.column === 1 ? lines.get(start.line) : undefined;
        const item = index === undefined ? undefined : checklist[index];
        const inputNode = node?.children?.find(
          (child) => child.type === 'element' && child.tagName === 'input',
        );
        const nestedChecked = Boolean(
          inputNode && 'properties' in inputNode && inputNode.properties?.checked,
        );
        return (
          <li className="list-none">
            <span className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={item ? item.checked : nestedChecked}
                disabled
                readOnly
                aria-label={item?.text ?? 'Butir catatan'}
                className="mt-0.5 size-4 shrink-0"
              />
              <span className="min-w-0 flex-1">{body}</span>
            </span>
            {lists}
          </li>
        );
      },
    };
  }, [note, checklist, matchedLines, mismatchLines]);

  return (
    <div
      data-testid="candidate-note"
      className={cn(
        'max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0.5 [&_ul]:pl-4',
        className,
      )}
    >
      <MarkdownView source={note} components={components} />
    </div>
  );
}

/** Keterangan warna penanda baris (untuk daftar kandidat dan dialog konfirmasi). */
export function MarkLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <CircleCheck aria-hidden="true" className="size-3.5 text-success-text" />
        Baris hijau: menyebut Item ini
      </span>
      <span className="inline-flex items-center gap-1">
        <TriangleAlert aria-hidden="true" className="size-3.5 text-warning-text" />
        Baris kuning: menyebut Item lain
      </span>
    </p>
  );
}
