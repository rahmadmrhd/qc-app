import type { SerialServiceSettingsDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { serialKeys } from '../keys';
import { toLocationOptions } from '../lib/locations';
import { useSerialLocations } from '../lib/use-serial-locations';
import { serialServiceSettingsQueryOptions, useSaveSerialServiceSettings } from '../queries';

interface BodyProps {
  settings: SerialServiceSettingsDto;
  serverError: string | null;
  onSave: (locationIds: string[]) => Promise<string | null>;
  onServerError: (message: string | null) => void;
}

function Body({ settings, serverError, onSave, onServerError }: BodyProps) {
  const { locations, isPending } = useSerialLocations();
  const all = toLocationOptions(locations);
  const [ids, setIds] = useState<string[]>(settings.locationIds);
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(ids.join('|') !== settings.locationIds.join('|'));

  const chosen = new Set(ids);
  const key = normalizeKey(term);
  const options: LinkOption[] = all.filter(
    (option) => !chosen.has(option.id) && (key === '' || normalizeKey(option.label).includes(key)),
  );

  async function submit() {
    if (busy) return;
    setBusy(true);
    onServerError(null);
    let message: string | null;
    try {
      message = await onSave(ids);
    } catch {
      message = 'Gagal menyimpan lokasi tim servis';
    }
    setBusy(false);
    onServerError(message);
  }

  return (
    <form
      noValidate
      aria-label="Lokasi tim servis"
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-base font-semibold">Lokasi tim servis</h2>
      <p className="text-sm text-muted-foreground">
        Lokasi tujuan saat unit dikirim ke servis. Kalau cuma satu lokasi aktif, tujuannya otomatis;
        kalau lebih, QC memilih salah satunya. Kosong berarti semua lokasi dianggap lokasi servis.
        Daftar ini berlaku untuk semua BU, dan lokasi yang sudah nonaktif diabaikan.
      </p>
      <LinkMultiField
        id="serial-service-locations"
        label="Lokasi tim servis"
        placeholder="Pilih lokasi servis (kosong = semua lokasi)"
        value={ids}
        labelOf={(id) => all.find((option) => option.id === id)?.label ?? 'Lokasi tidak aktif'}
        options={options}
        loading={isPending}
        onSearchChange={setTerm}
        searchDebounceMs={0}
        onChange={setIds}
      />
      {serverError ? (
        <p role="alert" className="text-sm text-destructive-text">
          {serverError}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? 'Menyimpan…' : 'Simpan lokasi servis'}
      </Button>
    </form>
  );
}

/**
 * Bagian "Lokasi tim servis" di Pengaturan Serial Number (hanya pengelola, `canManageSerialSettings`): daftar global,
 * ETag sendiri. `key` = versi tersimpan, jadi isian mulai dari data terbaru setelah simpan atau muat ulang (usang).
 */
export function ServiceLocationsSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery(serialServiceSettingsQueryOptions());
  const save = useSaveSerialServiceSettings();
  const [serverError, setServerError] = useState<string | null>(null);

  if (settings.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;
  if (settings.isError || !settings.data) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        {settings.error ? describeError(settings.error) : 'Lokasi tim servis tidak bisa dimuat.'}
      </p>
    );
  }
  const current = settings.data;
  return (
    <Body
      key={current.updatedAt}
      settings={current}
      serverError={serverError}
      onServerError={setServerError}
      onSave={async (locationIds) => {
        try {
          await save.mutateAsync({ expectedUpdatedAt: current.updatedAt, locationIds });
          toast.success('Lokasi tim servis disimpan');
          return null;
        } catch (error) {
          if (isStaleSaveError(error)) {
            void queryClient.invalidateQueries({ queryKey: serialKeys.serviceSettings });
            return `${STALE_SAVE_MESSAGE}. Pengaturan sudah dimuat ulang; cek isiannya lalu simpan lagi.`;
          }
          return describeError(error);
        }
      }}
    />
  );
}
