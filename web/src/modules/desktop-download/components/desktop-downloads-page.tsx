import type { DesktopReleaseDto, DesktopReleaseFileDto } from '@shared/contract';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DetectedPlatform } from '../lib/detect-platform';
import { formatBytes, formatPublishedDate } from '../lib/format';
import { desktopReleasesQueryOptions } from '../queries';

const ARCH_LABEL: Record<DesktopReleaseFileDto['arch'], string> = {
  x64: 'Windows x64',
  arm64: 'Windows ARM',
};
const COPY_RESET_MS = 2000;

type CopyState = { key: string; state: 'copied' | 'failed' } | null;

function ChecksumRow({
  version,
  file,
  copy,
  onCopy,
}: {
  version: string;
  file: DesktopReleaseFileDto;
  copy: CopyState;
  onCopy: (key: string, text: string) => void;
}) {
  const key = `${version}:${file.arch}`;
  const mine = copy?.key === key ? copy.state : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium">{file.arch}</span>
      <code className="min-w-0 break-all text-muted-foreground">{file.sha512}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Salin checksum ${file.arch}`}
        onClick={() => onCopy(key, file.sha512)}
      >
        {mine === 'copied' ? 'Tersalin' : 'Salin'}
      </Button>
      {mine === 'failed' ? (
        <span role="status" className="text-destructive">
          Tidak bisa menyalin, salin manual
        </span>
      ) : null}
    </div>
  );
}

function ReleaseItem({
  release,
  isLatest,
  copy,
  onCopy,
}: {
  release: DesktopReleaseDto;
  isLatest: boolean;
  copy: CopyState;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">v{release.version}</span>
        <span className="text-sm text-muted-foreground">
          {formatPublishedDate(release.publishedAt)}
        </span>
        {isLatest ? null : (
          <span className="text-xs text-muted-foreground">Pasang versi lama hanya bila perlu</span>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {release.files.map((file) => (
          <a
            key={file.arch}
            href={file.url}
            download
            className="underline underline-offset-4 hover:text-primary"
          >
            {ARCH_LABEL[file.arch]} ({formatBytes(file.size)})
          </a>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer">Rincian</summary>
        <p className="mt-2 whitespace-pre-wrap">{release.changelog}</p>
      </details>
      <div className="space-y-1">
        {release.files.map((file) => (
          <ChecksumRow
            key={file.arch}
            version={release.version}
            file={file}
            copy={copy}
            onCopy={onCopy}
          />
        ))}
      </div>
    </li>
  );
}

/**
 * Halaman "Aplikasi Desktop": daftar versi yang didukung server (server sudah menyaring `>= MIN_CLIENT.desktop`) dan
 * tombol unduh sesuai OS/arsitektur terdeteksi (`platform`, disuntik rute agar mudah dites).
 */
export function DesktopDownloadsPage({ platform }: { platform: DetectedPlatform }) {
  const { data } = useSuspenseQuery(desktopReleasesQueryOptions());
  const [copy, setCopy] = useState<CopyState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function onCopy(key: string, text: string) {
    let state: 'copied' | 'failed' = 'copied';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard tidak tersedia');
      await navigator.clipboard.writeText(text);
    } catch {
      state = 'failed';
    }
    setCopy({ key, state });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy(null), COPY_RESET_MS);
  }

  const latest = data.releases[0];
  const mainFile =
    latest && platform.os === 'windows'
      ? latest.files.find((file) => file.arch === platform.arch)
      : undefined;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Aplikasi Desktop</h1>
      {!data.enabled ? (
        <p className="text-muted-foreground">Unduhan belum tersedia</p>
      ) : !latest ? (
        <p className="text-muted-foreground">Belum ada versi yang tersedia untuk diunduh</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Versi terbaru v{latest.version}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {formatPublishedDate(latest.publishedAt)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {mainFile ? (
                <Button asChild>
                  <a href={mainFile.url} download>
                    <Download aria-hidden="true" />
                    Unduh untuk {ARCH_LABEL[mainFile.arch]}
                  </a>
                </Button>
              ) : (
                <p>Aplikasi desktop baru tersedia untuk Windows</p>
              )}
              <p className="text-sm text-muted-foreground">
                Windows mungkin menampilkan peringatan &apos;penerbit tak dikenal&apos;: pilih{' '}
                <em>Info lebih lanjut</em> lalu <em>Tetap jalankan</em>.
              </p>
              <p className="text-sm text-muted-foreground">
                Untuk memeriksa unduhan, bandingkan checksum SHA-512 di bawah dengan hasil perintah{' '}
                <code>Get-FileHash -Algorithm SHA512 &lt;berkas&gt;</code> di PowerShell.
              </p>
            </CardContent>
          </Card>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Versi yang didukung</h2>
            <ul className="space-y-3">
              {data.releases.map((release, index) => (
                <ReleaseItem
                  key={release.version}
                  release={release}
                  isLatest={index === 0}
                  copy={copy}
                  onCopy={onCopy}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
