import { Link, type LinkProps } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HeadroomBar, HeadroomFrame } from './headroom-bar';

export interface ViewTab {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

/**
 * Kerangka halaman View (spek redesain 6.6): bar headroom (judul + badge + aksi), `banner` di bawahnya,
 * tab bila isi panjang, isi, dan panel samping `aside` (di bawah isi pada layar sempit).
 */
export function ViewPage({
  title,
  badge,
  actions,
  tabs,
  aside,
  banner,
  children,
  tab,
  onTabChange,
}: {
  title: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  tabs?: readonly ViewTab[];
  aside?: ReactNode;
  banner?: ReactNode;
  children?: ReactNode;
  /** Tab aktif terkendali (mis. dari search param `tab`); tanpa ini state lokal. */
  tab?: string;
  onTabChange?: (id: string) => void;
}) {
  const [localTab, setLocalTab] = useState(tabs?.[0]?.id);
  const active = tab ?? localTab;
  const select = (id: string) => {
    setLocalTab(id);
    onTabChange?.(id);
  };

  const body = tabs ? (
    <Tabs value={active} onValueChange={select}>
      <TabsList
        variant="line"
        className="sticky top-[var(--headroom-offset,3.5rem)] z-10 h-auto w-full justify-start rounded-none border-b bg-background"
      >
        {tabs.map((entry) => (
          <TabsTrigger key={entry.id} value={entry.id} className="flex-none px-3 py-2">
            {entry.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((entry) => (
        <TabsContent key={entry.id} value={entry.id} className="pt-4">
          {entry.content}
        </TabsContent>
      ))}
      {children}
    </Tabs>
  ) : (
    <div className="space-y-6">{children}</div>
  );

  return (
    <HeadroomFrame className="gap-3">
      <HeadroomBar className="pt-1 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-xl font-semibold break-words">{title}</h1>
            {badge}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </HeadroomBar>
      {banner}
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0">{body}</div>
        {aside ? (
          <aside className="space-y-4 border-t pt-4 text-sm lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            {aside}
          </aside>
        ) : null}
      </div>
    </HeadroomFrame>
  );
}

/** Bagian isi View: judul kecil + isi. */
export function ViewSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export interface DetailItem {
  label: string;
  value: ReactNode;
  hidden?: boolean;
}

/** Daftar label–nilai (`dl`) dua kolom; nilai kosong tampil "—" dan butir `hidden` dilewati. */
export function DetailList({ items }: { items: readonly DetailItem[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
      {items
        .filter((item) => !item.hidden)
        .map((item) => (
          <div key={item.label} className="contents">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 break-words">
              {item.value === null || item.value === undefined || item.value === ''
                ? '—'
                : item.value}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  });
}

export interface ViewMetaLink {
  label: string;
  to: LinkProps['to'];
  search?: Record<string, unknown>;
  params?: Record<string, string>;
}

/**
 * Isi standar `aside`: "Dibuat oleh … · kapan" HANYA bila DTO punya `createdBy`/`createdAt`, "Diubah oleh …" dari
 * `updatedBy`/`updatedAt` bila ada, dan tautan ke data terkait TANPA angka hitungan.
 */
export function ViewMeta({
  createdBy,
  createdAt,
  updatedBy,
  updatedAt,
  links,
}: {
  createdBy?: string | null;
  createdAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  links?: readonly ViewMetaLink[];
}) {
  const created = createdBy || createdAt;
  const updated = updatedBy || updatedAt;
  return (
    <>
      {created ? (
        <p>
          <span className="text-muted-foreground">Dibuat</span>
          {createdBy ? ` oleh ${createdBy}` : ''}
          {createdAt ? ` · ${formatWhen(createdAt)}` : ''}
        </p>
      ) : null}
      {updated ? (
        <p>
          <span className="text-muted-foreground">Diubah</span>
          {updatedBy ? ` oleh ${updatedBy}` : ''}
          {updatedAt ? ` · ${formatWhen(updatedAt)}` : ''}
        </p>
      ) : null}
      {links && links.length > 0 ? (
        <ul className="space-y-1">
          {links.map((link) => (
            <li key={link.label}>
              <Link
                to={link.to}
                params={link.params as never}
                search={link.search as never}
                className="font-medium text-info-text underline-offset-4 hover:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
