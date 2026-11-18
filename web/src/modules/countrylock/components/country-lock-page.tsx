import { PENDING_TARGET_BRIDGE_VERSION } from '@countrylock/bridge-channels';
import type { QcBridge } from '@countrylock/bridge-contract';
import type { Brand } from '@countrylock/script-template';
import { canInject } from '@countrylock/session-machine';
import { FolderOpen, KeyRound, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LinkField } from '@/components/link-field';
import { Select } from '@/components/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { tipeOptionsFor } from '../lib/type-firmware';
import { useCatalog } from '../use-catalog';
import { useCountryLock } from '../use-country-lock';
import { useInjectTarget } from '../use-inject-target';
import { CredentialDialog } from './credential-dialog';
import { InjectProgressDialog } from './inject-progress-dialog';
import { PendingList } from './pending-list';

/** Teks konfirmasi Auto Inject (aplikasi lama, persis). */
export const AUTO_INJECT_WARNING =
  'Harap berhati-hati saat menggunakan "Auto Inject". Pastikan kembali tipe dan firmware cocok dengan perangkat yang akan di Country Lock. Yakin untuk lanjut?';

function StatusBadge({ label, up }: { label: string; up: boolean }) {
  return (
    <Badge variant={up ? 'default' : 'secondary'}>
      {label}: {up ? 'terhubung' : 'tidak terjangkau'}
    </Badge>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm">{value === '' ? '-' : value}</dd>
    </div>
  );
}

/** Halaman Country Lock mode tunggal; hanya dirender bila jembatan desktop tersedia. */
export function CountryLockPage({ bridge }: { bridge: QcBridge }) {
  const {
    state,
    pkg,
    info,
    tipe,
    log,
    pending,
    loading,
    loadError,
    progress,
    credentialPrompt,
    actions,
  } = useCountryLock(bridge);
  const [confirmAuto, setConfirmAuto] = useState(false);
  // Katalog offline dibaca sekali dan dipakai dropdown Tipe, BU, dan Lokasi di form.
  const catalog = useCatalog(bridge);
  const target = useInjectTarget(catalog.snapshot?.catalog ?? null, tipe?.id ?? null);
  // Tipe hanya ada bila katalog aktif di build ini; tanpa itu Merk dan Firmware dipilih manual seperti biasa.
  const showTipe = catalog.supported && catalog.status?.state !== 'disabled';
  // BU/Lokasi ikut katalog offline dan hanya dicatat oleh jembatan v6 ke atas (skema `pending.add` ketat).
  const showTarget = showTipe && bridge.version >= PENDING_TARGET_BRIDGE_VERSION;
  // Semua field yang berlaku wajib terisi sebelum inject, termasuk Auto Inject (keputusan pemilik 2026-11-18).
  const missing = [
    state.brand === null ? 'Merk' : null,
    showTipe && tipe === null ? 'Tipe' : null,
    !state.firmwareCode ? 'Firmware' : null,
    showTarget && target.buId === '' ? 'Business Unit' : null,
    showTarget && target.locationId === '' ? 'Lokasi' : null,
  ].filter((name): name is string => name !== null);
  const formComplete = missing.length === 0;
  const { setForm } = actions;
  const { pendingTarget } = target;
  // BU/lokasi terpilih dicatat bersama serial saat inject sukses, dan kelengkapan form menjaga inject (lewat ref di hook).
  useEffect(
    () => setForm({ target: pendingTarget, complete: formComplete }),
    [setForm, pendingTarget, formComplete],
  );

  if (loading) {
    return <p className="p-4 text-sm text-muted-foreground">Memuat paket skrip...</p>;
  }

  const brandEntries = pkg ? Object.values(pkg.config.brands) : [];
  const brandConfig = state.brand ? pkg?.config.brands[state.brand] : undefined;
  const missingDeviceIp = brandConfig !== undefined && brandConfig.single.ip === '';
  const catalogItems = catalog.snapshot?.catalog.items ?? [];
  const tipeItems = tipeOptionsFor(catalogItems, state.brand);
  // Firmware dikunci hanya bila Tipe terpilih punya firmware yang ada di paket (aplikasi lama).
  const firmwareLocked = tipe?.application.ok === true;
  const catalogReady = catalog.snapshot !== null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Country Lock</h1>
        {pkg ? (
          <Button type="button" variant="outline" onClick={actions.chooseDir}>
            <FolderOpen />
            Ganti folder paket
          </Button>
        ) : null}
      </div>

      {loadError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Paket tidak dapat dimuat</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {!pkg ? (
        <Card>
          <CardHeader>
            <CardTitle>Belum ada paket skrip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pilih folder yang berisi <code>config.QC</code> beserta folder skrip per merk
              (misalnya hasil unduhan dari server).
            </p>
            <Button type="button" onClick={actions.chooseDir}>
              <FolderOpen />
              Pilih folder paket
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {pkg.missing.length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Berkas skrip tidak ditemukan</AlertTitle>
              <AlertDescription>{pkg.missing.join(', ')}</AlertDescription>
            </Alert>
          ) : null}
          {pkg.warnings.length > 0 ? (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Peringatan konfigurasi</AlertTitle>
              <AlertDescription>{pkg.warnings.join('; ')}</AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Perangkat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={showTipe ? 'grid gap-4 sm:grid-cols-3' : 'grid gap-4 sm:grid-cols-2'}>
                <Select
                  id="country-lock-brand"
                  label="Merk"
                  placeholder="Pilih merk"
                  value={state.brand ?? ''}
                  options={brandEntries.map((entry) => ({
                    value: entry.brand,
                    label: entry.label,
                  }))}
                  onValueChange={(value) => actions.select(value as Brand, null)}
                  disabled={state.injecting}
                />
                {showTipe ? (
                  <LinkField
                    id="country-lock-tipe"
                    label="Tipe"
                    placeholder={
                      !brandConfig
                        ? 'Pilih merk dulu'
                        : tipeItems.length === 0
                          ? 'Belum ada Tipe di katalog'
                          : 'Pilih tipe'
                    }
                    value={tipe?.id ?? null}
                    options={tipeItems.map((item) => ({ id: item.id, label: item.model }))}
                    onChange={(id) =>
                      actions.selectTipe(tipeItems.find((item) => item.id === id) ?? null)
                    }
                    localFilter
                    disabled={!brandConfig || state.injecting || tipeItems.length === 0}
                  />
                ) : null}
                <Select
                  id="country-lock-firmware"
                  label="Firmware"
                  placeholder={brandConfig ? 'Pilih firmware' : 'Pilih merk dulu'}
                  value={state.firmwareCode ?? ''}
                  options={(brandConfig?.firmware ?? []).map((firmware) => ({
                    value: firmware.code,
                    label: firmware.label || firmware.code,
                  }))}
                  onValueChange={(value) => state.brand && actions.select(state.brand, value)}
                  disabled={!brandConfig || state.injecting || firmwareLocked}
                />
              </div>
              {showTarget ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <LinkField
                    id="country-lock-bu"
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
                    disabled={state.injecting || target.buOptions.length === 0}
                  />
                  <LinkField
                    id="country-lock-location"
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
                    disabled={state.injecting || target.locationOptions.length === 0}
                  />
                </div>
              ) : null}
              {tipe && !tipe.application.ok ? (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {tipe.application.message}
                </p>
              ) : null}

              {missingDeviceIp ? (
                <p className="text-sm text-destructive">
                  IP perangkat mode tunggal belum diatur di config.QC untuk merk ini.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <StatusBadge label="Perangkat" up={state.devicePingable} />
                <StatusBadge label="Router jump" up={state.routerPingable} />
              </div>

              <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-4">
                <InfoItem label="Model" value={info?.model ?? ''} />
                <InfoItem label="Serial" value={state.serial} />
                <InfoItem label="Negara" value={info?.country ?? ''} />
                <InfoItem label="Alamat" value={brandConfig?.single.ip ?? ''} />
              </dl>

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="country-lock-auto"
                    checked={state.autoInject}
                    onCheckedChange={(checked) => {
                      // Konfirmasi hanya saat dinyalakan; mematikan tanpa konfirmasi.
                      if (checked === true) setConfirmAuto(true);
                      else actions.toggleAuto(false);
                    }}
                  />
                  <Label htmlFor="country-lock-auto">Auto Inject</Label>
                </div>
                <Button
                  type="button"
                  onClick={actions.inject}
                  disabled={!canInject(state) || !formComplete}
                >
                  Inject
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={actions.openCredentials}
                  disabled={!brandConfig}
                >
                  <KeyRound />
                  Kredensial
                </Button>
              </div>
              {!formComplete ? (
                <p className="text-sm text-muted-foreground">
                  Wajib diisi sebelum inject: {missing.join(', ')}.
                  {showTipe && !catalogReady
                    ? ' Katalog belum tersinkron: tekan tombol sinkron di navbar.'
                    : ''}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <PendingList entries={pending} />
        </>
      )}

      <AlertDialog open={confirmAuto} onOpenChange={setConfirmAuto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nyalakan Auto Inject?</AlertDialogTitle>
            <AlertDialogDescription>{AUTO_INJECT_WARNING}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => actions.toggleAuto(true)}>Lanjut</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CredentialDialog
        prompt={credentialPrompt}
        onSubmit={actions.submitCredentials}
        onCancel={actions.dismissCredentials}
      />
      <InjectProgressDialog
        progress={progress}
        log={log}
        onCancel={actions.cancel}
        onClose={actions.closeProgress}
      />
    </div>
  );
}
