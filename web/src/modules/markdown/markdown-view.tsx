import { parseFileRef } from '@shared/files';
import type { Components } from 'react-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useFileUrl } from '@/modules/files/queries';

const SAFE_LINK = /^(https?:|mailto:)/i;

/** Hanya tautan http(s)/mailto dan gambar `qcfile:` yang lolos; atribut URL lain dibuang. */
function urlTransform(url: string, key: string): string | null {
  if (key === 'src') return parseFileRef(url) ? url : null;
  if (key === 'href') return SAFE_LINK.test(url) ? url : null;
  return null;
}

function MarkdownImage({ id, alt }: { id: string; alt: string }) {
  const { url, isLoading, isError } = useFileUrl(id);
  if (isLoading) {
    return (
      <span
        role="img"
        aria-label="Memuat gambar"
        className="inline-block h-24 w-40 animate-pulse rounded-md bg-muted"
      />
    );
  }
  if (isError || !url) {
    return <span className="text-xs text-muted-foreground">[gambar tidak tersedia]</span>;
  }
  return <img src={url} alt={alt} className="my-2 max-h-96 max-w-full rounded-md border" />;
}

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) => {
    const id = typeof src === 'string' ? parseFileRef(src) : null;
    return id ? <MarkdownImage id={id} alt={alt ?? ''} /> : null;
  },
};

export interface MarkdownViewProps {
  source: string;
  className?: string;
  /** Penimpa komponen tambahan (mis. checkbox interaktif pada catatan); digabung dengan bawaan. */
  components?: Components;
}

/** Render Markdown tanpa HTML mentah (tidak memakai rehype-raw); aman terhadap XSS (PRD FA6). */
export function MarkdownView({ source, className, components: extra }: MarkdownViewProps) {
  return (
    <div
      className={cn(
        'space-y-3 break-words text-sm leading-relaxed',
        '[&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs',
        '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3',
        '[&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1',
        '[&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={extra ? { ...components, ...extra } : components}
      >
        {source}
      </Markdown>
    </div>
  );
}
