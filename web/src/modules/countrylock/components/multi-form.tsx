import type { PackageDto } from '@countrylock/bridge-contract';
import type { DesktopCatalogDto } from '@shared/desktop-catalog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LinkField } from '@/components/link-field';
import { Select } from '@/components/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTO_INJECT_WARNING } from '../lib/auto-inject';
import {
  isValidExcludeIp,
  loadMultiPrefs,
  MULTI_CONCURRENCY_MAX,
  MULTI_CONCURRENCY_MIN,
  parseConcurrency,
  saveMultiPrefs,
} from '../lib/multi-prefs';
import { resolveTypeApplication, tipeOptionsFor } from '../lib/type-firmware';
import { useInjectTarget } from '../use-inject-target';
import type { UseMulti } from '../use-multi';

/** Merk mode Multi: selalu Ubiquiti (aplikasi lama juga tidak mendukung Mikrotik di Multi). */
export const MULTI_BRAND = 'ubiquiti' as const;

/**
 * Form konfigurasi batch Multi: Tipe, Firmware, Business Unit, dan Lokasi dipilih sekali per batch (satu Tipe per batch,
 * keputusan pemilik 2026-11-19) dan terkunci selama Multi berjalan; Concurrent boleh diubah kapan saja; Exclude IP hanya
 * berlaku saat mulai. Semua field wajib terisi sebelum Mulai (keputusan pemilik 2026-11-18).
 */
export function MultiForm({
  pkg,
  catalog,
  multi,
}: {
  pkg: PackageDto;
  catalog: DesktopCatalogDto | null;
  multi: UseMulti;
}) {
  const brandConfig = pkg.config.brands[MULTI_BRAND];
  const running = multi.snapshot?.running === true;
  const { actions } = multi;

  const [tipeId, setTipeId] = useState<string | null>(null);
  const [manualFirmware, setManualFirmware] = useState('');
  const [prefs] = useState(loadMultiPrefs);
  const [concurrencyText, setConcurrencyText] = useState(String(prefs.concurrency));
  const [excludeIp, setExcludeIp] = useState(prefs.excludeIp);
  const [localAuto, setLocalAuto] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);

  const items = useMemo(() => tipeOptionsFor(catalog?.items ?? [], MULTI_BRAND), [catalog]);
  const tipe = items.find((item) => item.id === tipeId) ?? null;
  const application = tipe ? resolveTypeApplication(tipe, pkg) : null;
  const firmwareLocked = application?.ok === true;
  const firmwareCode = application?.ok ? application.firmwareCode : manualFirmware;
  const target = useInjectTarget(catalog, tipeId);

  const concurrency = parseConcurrency(concurrencyText);
  const excludeIpValid = isValidExcludeIp(excludeIp);
  const autoInject = running ? multi.snapshot?.autoInject === true : localAuto;

  // Ingat nilai sah terakhir (nilai tak sah tidak menimpa ingatan).
  const lastPrefs = useRef(prefs);
  useEffect(() => {
    const next = {
      concurrency: concurrency ?? lastPrefs.current.concurrency,
      excludeIp: excludeIpValid ? excludeIp.trim() : lastPrefs.current.excludeIp,
    };
    lastPrefs.current = next;
    saveMultiPrefs(next);
  }, [concurrency, excludeIp, excludeIpValid]);

  // Muat ulang jendela di tengah batch: tampilkan Concurrent yang sebenarnya dipakai mesin (sekali, agar ketikan tak ditimpa).
  const syncedRef = useRef(false);
  const liveConcurrency = multi.snapshot?.running === true ? multi.snapshot.concurrency : null;
  useEffect(() => {
    if (liveConcurrency === null || syncedRef.current) return;
    syncedRef.current = true;
    setConcurrencyText(String(liveConcurrency));
  }, [liveConcurrency]);

  const missing = [
    tipe === null ? 'Tipe' : null,
    firmwareCode === '' ? 'Firmware' : null,
    target.buId === '' ? 'Business Unit' : null,
    target.locationId === '' ? 'Lokasi' : null,
  ].filter((name): name is string => name !== null);
  const catalogReady = catalog !== null;
  const canStart = missing.length === 0 && concurrency !== null && excludeIpValid;

  function start() {
    if (!canStart || concurrency === null || tipe === null) return;
    const bu = target.pendingTarget;
    void multi.start({
      firmwareCode,
      concurrency,
      excludeIp: excludeIp.trim(),
      autoInject: localAuto,
      target: {
        itemId: tipe.id,
        itemLabel: tipe.model,
        buId: bu.buId ?? '',
        buLabel: bu.buLabel ?? '',
        locationId: bu.locationId ?? '',
        locationLabel: bu.locationLabel ?? '',
      },
    });
  }

  function changeConcurrency(text: string) {
    setConcurrencyText(text);
    const n = parseConcurrency(text);
    if (running && n !== null) actions.setConcurrency(n);
  }

  function changeAuto(on: boolean) {
    setLocalAuto(on);
    if (running) actions.setAutoInject(on);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          id="multi-brand"
          label="Merk"
          value={MULTI_BRAND}
          options={[{ value: MULTI_BRAND, label: brandConfig?.label ?? 'Ubiquiti' }]}
          onValueChange={() => undefined}
          disabled
        />
        <LinkField
          id="multi-tipe"
          label="Tipe"
          placeholder={
            !catalogReady
              ? 'Belum tersinkron'
              : items.length === 0
                ? 'Belum ada Tipe Ubiquiti di katalog'
                : 'Pilih tipe'
          }
          value={tipeId}
          options={items.map((item) => ({ id: item.id, label: item.model }))}
          onChange={(id) => {
            setTipeId(id);
            setManualFirmware('');
          }}
          localFilter
          disabled={running || items.length === 0}
        />
        <Select
          id="multi-firmware"
          label="Firmware"
          placeholder="Pilih firmware"
          value={firmwareCode}
          options={(brandConfig?.firmware ?? []).map((firmware) => ({
            value: firmware.code,
            label: firmware.label || firmware.code,
          }))}
          onValueChange={setManualFirmware}
          disabled={running || firmwareLocked}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <LinkField
          id="multi-bu"
          label="Business Unit"
          placeholder={
            !catalogReady
              ? 'Belum tersinkron'
              : target.buOptions.length === 0
                ? 'Tidak ada BU'
                : 'Pilih BU'
          }
          options={target.buOptions}
          value={target.buId === '' ? null : target.buId}
          onChange={target.setBu}
          localFilter
          disabled={running || target.buOptions.length === 0}
        />
        <LinkField
          id="multi-location"
          label="Lokasi"
          placeholder={
            !catalogReady
              ? 'Belum tersinkron'
              : target.locationOptions.length === 0
                ? 'Tidak ada lokasi'
                : 'Pilih lokasi'
          }
          options={target.locationOptions}
          value={target.locationId === '' ? null : target.locationId}
          onChange={target.setLocation}
          localFilter
          disabled={running || target.locationOptions.length === 0}
        />
      </div>
      {tipe && application && !application.ok ? (
        <p className="text-sm text-warning-text">{application.message}</p>
      ) : null}

      <div className="grid items-start gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="multi-concurrency">Concurrent</Label>
          <Input
            id="multi-concurrency"
            type="number"
            inputMode="numeric"
            min={MULTI_CONCURRENCY_MIN}
            max={MULTI_CONCURRENCY_MAX}
            value={concurrencyText}
            aria-invalid={concurrency === null}
            onChange={(event) => changeConcurrency(event.target.value)}
          />
          {concurrency === null ? (
            <p className="text-xs text-destructive">
              Concurrent harus {MULTI_CONCURRENCY_MIN} sampai {MULTI_CONCURRENCY_MAX}.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="multi-exclude-ip">Exclude IP</Label>
          <Input
            id="multi-exclude-ip"
            autoComplete="off"
            placeholder="Kosong = tidak ada"
            value={excludeIp}
            aria-invalid={!excludeIpValid}
            disabled={running}
            onChange={(event) => setExcludeIp(event.target.value)}
          />
          {!excludeIpValid ? (
            <p className="text-xs text-destructive">Exclude IP harus alamat IPv4 atau kosong.</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 pt-6">
          <Checkbox
            id="multi-auto"
            checked={autoInject}
            onCheckedChange={(checked) => {
              // Konfirmasi hanya saat dinyalakan; mematikan tanpa konfirmasi (sama dengan mode tunggal).
              if (checked === true) setConfirmAuto(true);
              else changeAuto(false);
            }}
          />
          <Label htmlFor="multi-auto">Auto Inject</Label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button type="button" variant="destructive" onClick={() => void multi.stop()}>
            Hentikan
          </Button>
        ) : (
          <Button type="button" onClick={start} disabled={!canStart}>
            Mulai
          </Button>
        )}
      </div>
      {!running && missing.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Wajib diisi sebelum Multi dimulai: {missing.join(', ')}.
          {!catalogReady
            ? ' Katalog belum tersinkron: tekan tombol sinkron di kanan atas halaman ini.'
            : ''}
        </p>
      ) : null}
      {running && tipe === null ? (
        <p className="text-sm text-muted-foreground">
          Batch sedang berjalan (dimulai sebelum jendela ini dimuat ulang); Tipe, BU, dan Lokasinya
          dipegang proses utama.
        </p>
      ) : null}

      <AlertDialog open={confirmAuto} onOpenChange={setConfirmAuto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nyalakan Auto Inject?</AlertDialogTitle>
            <AlertDialogDescription>{AUTO_INJECT_WARNING}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => changeAuto(true)}>Lanjut</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
