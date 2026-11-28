import {
  extractPlaceholders,
  extractTempRefs,
  PLACEHOLDER_NAMES,
} from '@shared/countrylock-bundle';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { fileQueryOptions, filesQueryOptions } from '../queries';

/** Nama berkas (bagian terakhir jalur): rujukan `/temp/<nama>` dicocokkan dengan nama berkas router, seperti validasi server. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export interface ScriptRefsProps {
  /** Jalur skrip terpilih (berkas role skrip di draf); `null` = belum ada skrip. */
  scriptPath: string | null;
  /** Minta unggah berkas router bernama itu (belum ada di bundel). */
  onUpload: (name: string) => void;
  /** Boleh mengunggah berkas (`countrylock: edit`). */
  canUpload: boolean;
}

/**
 * Panel pendaftaran firmware: dari isi skrip terpilih, daftar placeholder yang dipakai (yang tak dikenal ditandai) dan
 * berkas `/temp/<nama>` yang dirujuk beserta status keberadaannya di bundel (berkas role router, dicocokkan lewat nama
 * berkas). Berkas yang belum ada dapat langsung diunggah. Deteksi memakai fungsi yang sama dengan validasi terbit.
 */
export function ScriptRefs({ scriptPath, onUpload, canUpload }: ScriptRefsProps) {
  const files = useQuery(filesQueryOptions());
  const script = files.data?.find(
    (file) => !file.removed && file.role === 'script' && file.path === scriptPath,
  );
  const detail = useQuery({ ...fileQueryOptions(script?.id ?? ''), enabled: script !== undefined });
  const text = detail.data?.text ?? null;

  const analysis = useMemo(() => {
    if (text === null) return null;
    const known = new Set(PLACEHOLDER_NAMES);
    return {
      placeholders: extractPlaceholders(text).map((name) => ({ name, known: known.has(name) })),
      temps: extractTempRefs(text),
    };
  }, [text]);

  if (scriptPath === null || script === undefined) return null;
  const routerByName = new Map(
    (files.data ?? [])
      .filter((file) => !file.removed && file.role === 'router')
      .map((file) => [baseName(file.path), file.path] as const),
  );

  return (
    <section
      aria-label="Isi skrip yang dirujuk"
      className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm"
    >
      <p className="font-medium">Yang dirujuk skrip ini</p>
      {detail.isError ? (
        <p role="alert" className="text-destructive-text">
          {describeError(detail.error)}
        </p>
      ) : null}
      {analysis === null ? (
        detail.isError ? null : (
          <p className="text-muted-foreground">Membaca skrip…</p>
        )
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Placeholder</p>
            {analysis.placeholders.length === 0 ? (
              <p className="text-muted-foreground">Tidak memakai placeholder.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {analysis.placeholders.map((item) => (
                  <li key={item.name}>
                    {item.known ? (
                      <Badge variant="soft" color="info">{`{${item.name}}`}</Badge>
                    ) : (
                      <Badge variant="soft" color="destructive">
                        {`{${item.name}} tidak dikenal`}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Berkas router (/temp)</p>
            {analysis.temps.length === 0 ? (
              <p className="text-muted-foreground">Tidak merujuk berkas /temp.</p>
            ) : (
              <ul className="space-y-1.5">
                {analysis.temps.map((name) => {
                  const existing = routerByName.get(name);
                  return (
                    <li key={name} className="flex flex-wrap items-center gap-2">
                      <code className="text-xs">{`/temp/${name}`}</code>
                      {existing === undefined ? (
                        <>
                          <span className="text-warning-text">Belum ada di bundel</span>
                          {canUpload ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              color="primary"
                              aria-label={`Unggah ${name}`}
                              onClick={() => onUpload(name)}
                            >
                              Unggah
                            </Button>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-success-text">{`Ada: ${existing}`}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
