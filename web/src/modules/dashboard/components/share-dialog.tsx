import { DASHBOARD_RANGE_MAX_DAYS, type DashboardRange, widgetMeta } from '@shared/dashboard';
import type { CreateShareInput, DashboardShareDto } from '@shared/dashboard-share';
import { SHARE_LIMITS } from '@shared/dashboard-share';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import {
  FormDialog,
  FormDialogContent,
  FormDialogDescription,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { Select } from '@/components/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api';
import { useMe } from '@/modules/auth/use-me';
import { visibleWidgetsByGroup } from '../lib/access';
import { formatRangeLabel } from '../lib/format';
import { type DashboardSearch, effectiveRange } from '../lib/search';
import { useCreateShare } from '../share-queries';
import { buFilterOptions, locationFilterOptions } from './global-filters';
import { ScopeEditor, type ScopeEditorValue } from './scope-editor';

const DAY_MS = 86_400_000;
const EXPIRY_PRESETS = [7, 30, 90, 180, 365];
const CUSTOM = 'custom';

type RangeMode = 'fixed' | 'rolling';

/** `YYYY-MM-DD` ditambah `days` hari (kalender UTC, cukup untuk tanggal WIB murni). */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ShareResult({ share, onClose }: { share: DashboardShareDto; onClose: () => void }) {
  const url = share.url ?? '';
  return (
    <FormDialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <FormDialogContent className="data-[size=default]:sm:max-w-lg">
        <FormDialogHeader className="pr-10 max-md:pr-12">
          <FormDialogTitle>Tautan dibuat</FormDialogTitle>
          <FormDialogDescription>
            Siapa pun yang memegang tautan ini dapat melihat dashboard yang Anda bagikan sampai masa
            berlakunya habis atau tautan dicabut.
          </FormDialogDescription>
        </FormDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="share-result-url">Tautan</Label>
          <div className="flex gap-2">
            <Input
              id="share-result-url"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              color="primary"
              onClick={async () => {
                if (await copyText(url)) toast.success('Tautan disalin');
                else toast.error('Tautan tidak dapat disalin, salin manual dari kolom');
              }}
            >
              Salin tautan
            </Button>
          </div>
        </div>
        <FormDialogFooter>
          <Button type="button" color="primary" onClick={onClose}>
            Selesai
          </Button>
        </FormDialogFooter>
      </FormDialogContent>
    </FormDialog>
  );
}

/**
 * Dialog Bagikan dashboard: judul, cakupan (`ScopeEditor`, awal = BU/Lokasi filter aktif), mode rentang, masa berlaku
 * (7/30/90/180/365 hari atau tanggal tertentu, bawaan 30), peringatan data baris, dan ringkasan siapa-melihat-apa.
 * Dipasang hanya saat terbuka (parent merender bersyarat), jadi isiannya selalu mulai dari filter aktif.
 */
export function ShareDialog({
  onClose,
  search,
  today,
}: {
  onClose: () => void;
  search: DashboardSearch;
  today: string;
}) {
  const me = useMe();
  const create = useCreateShare();
  const allowed = visibleWidgetsByGroup(me).flatMap((entry) =>
    entry.widgets.map((meta) => meta.id),
  );
  const activeRange: DashboardRange = effectiveRange(search, today);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<ScopeEditorValue>({
    buIds: search.bu ?? [],
    locationIds: search.loc ?? [],
    widgets: [],
    offers: [],
  });
  const [rangeMode, setRangeMode] = useState<RangeMode>('fixed');
  const [rollingDays, setRollingDays] = useState('30');
  const [expiry, setExpiry] = useState(String(SHARE_LIMITS.expiryDaysDefault));
  const [customDate, setCustomDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<DashboardShareDto | null>(null);

  if (created) return <ShareResult share={created} onClose={onClose} />;

  const buOptions = buFilterOptions(me);
  const locationOptions = locationFilterOptions(me);
  const hasList = scope.widgets.some((widget) => widgetMeta(widget.id).visual === 'list');
  const days = Number(rollingDays);
  const rollingValid = Number.isInteger(days) && days >= 1 && days <= DASHBOARD_RANGE_MAX_DAYS;
  const customDays = customDate === '' ? NaN : daysBetween(today, customDate);
  const expiresInDays = expiry === CUSTOM ? customDays : Number(expiry);

  const rangeLabel =
    rangeMode === 'fixed'
      ? formatRangeLabel(activeRange)
      : `${rollingValid ? days : '?'} hari terakhir (bergulir)`;
  const names = (ids: string[], options: { id: string; label: string }[], fallback: string) =>
    ids.length === 0
      ? fallback
      : ids.map((id) => options.find((option) => option.id === id)?.label ?? id).join(', ');
  const summary = `Terlihat oleh siapa pun yang memegang tautan: periode ${rangeLabel}, BU ${names(scope.buIds, buOptions, 'semua BU Anda')}, Lokasi ${names(scope.locationIds, locationOptions, 'semua lokasi Anda')}, ${scope.widgets.length} widget.`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (title.trim() === '') next.title = 'Judul wajib diisi';
    else if (title.trim().length > SHARE_LIMITS.titleMax) {
      next.title = `Judul maksimal ${SHARE_LIMITS.titleMax} karakter`;
    }
    if (scope.widgets.length === 0) next.widgets = 'Pilih minimal satu widget';
    if (rangeMode === 'rolling' && !rollingValid) {
      next.range = `Jumlah hari harus 1-${DASHBOARD_RANGE_MAX_DAYS}`;
    }
    if (
      !Number.isInteger(expiresInDays) ||
      expiresInDays < 1 ||
      expiresInDays > SHARE_LIMITS.expiryDaysMax
    ) {
      next.expiry = `Masa berlaku harus 1-${SHARE_LIMITS.expiryDaysMax} hari`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const range: DashboardRange =
      rangeMode === 'fixed' ? activeRange : { from: addDays(today, -(days - 1)), to: today };
    const input: CreateShareInput = {
      title: title.trim(),
      filter: {
        from: range.from,
        to: range.to,
        ...(scope.buIds.length > 0 ? { buIds: scope.buIds } : {}),
        ...(scope.locationIds.length > 0 ? { locationIds: scope.locationIds } : {}),
      },
      locationFiltered: scope.locationIds.length > 0,
      range:
        rangeMode === 'fixed'
          ? { mode: 'fixed', from: range.from, to: range.to }
          : { mode: 'rolling', days },
      widgets: scope.widgets,
      offers: scope.offers,
      expiresInDays,
    };
    create.mutate(input, {
      onSuccess: (dto) => setCreated(dto),
      onError: (error) => setErrors({ form: describeError(error) }),
    });
  };

  return (
    <FormDialogShell
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      formId="share-dialog"
      title="Bagikan dashboard"
      description="Buat tautan publik: siapa pun yang memegangnya dapat melihat widget yang Anda pilih tanpa masuk."
      size="xl"
      submitting={create.isPending}
      submitLabel="Buat tautan"
    >
      <form id="share-dialog" className="space-y-5" onSubmit={submit} noValidate>
        {errors.form ? (
          <Alert color="destructive">
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="share-title" required>
            Judul tautan
          </Label>
          <Input
            id="share-title"
            value={title}
            maxLength={SHARE_LIMITS.titleMax + 20}
            aria-required="true"
            aria-invalid={errors.title ? true : undefined}
            onChange={(event) => setTitle(event.target.value)}
          />
          {errors.title ? (
            <p role="alert" className="text-xs text-destructive-text">
              {errors.title}
            </p>
          ) : null}
        </div>
        <ScopeEditor value={scope} onChange={setScope} allowedWidgetIds={allowed} />
        {errors.widgets ? (
          <p role="alert" className="text-xs text-destructive-text">
            {errors.widgets}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Select
              id="share-range-mode"
              label="Periode"
              value={rangeMode}
              onValueChange={(next) => setRangeMode(next === 'rolling' ? 'rolling' : 'fixed')}
              options={[
                { value: 'fixed', label: `Periode tetap: ${formatRangeLabel(activeRange)}` },
                { value: 'rolling', label: 'Bergulir: N hari terakhir sampai hari dibuka' },
              ]}
            />
            {rangeMode === 'rolling' ? (
              <div className="space-y-1.5">
                <Label htmlFor="share-rolling-days" className="text-xs text-muted-foreground">
                  Jumlah hari
                </Label>
                <Input
                  id="share-rolling-days"
                  type="number"
                  min={1}
                  max={DASHBOARD_RANGE_MAX_DAYS}
                  value={rollingDays}
                  onChange={(event) => setRollingDays(event.target.value)}
                />
              </div>
            ) : null}
            {errors.range ? (
              <p role="alert" className="text-xs text-destructive-text">
                {errors.range}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Select
              id="share-expiry"
              label="Masa berlaku"
              required
              value={expiry}
              onValueChange={setExpiry}
              options={[
                ...EXPIRY_PRESETS.map((value) => ({
                  value: String(value),
                  label: `${value} hari`,
                })),
                { value: CUSTOM, label: 'Tanggal tertentu' },
              ]}
            />
            {expiry === CUSTOM ? (
              <div className="space-y-1.5">
                <Label htmlFor="share-expiry-date" className="text-xs text-muted-foreground">
                  Berlaku sampai tanggal
                </Label>
                <Input
                  id="share-expiry-date"
                  type="date"
                  min={addDays(today, 1)}
                  max={addDays(today, SHARE_LIMITS.expiryDaysMax)}
                  value={customDate}
                  onChange={(event) => setCustomDate(event.target.value)}
                />
              </div>
            ) : null}
            {errors.expiry ? (
              <p role="alert" className="text-xs text-destructive-text">
                {errors.expiry}
              </p>
            ) : null}
          </div>
        </div>
        {hasList ? (
          <Alert color="warning">
            <AlertDescription>
              Baris data (mis. nama customer, nomor serial) akan terlihat oleh siapa pun yang
              memegang tautan.
            </AlertDescription>
          </Alert>
        ) : null}
        <Alert color="info">
          <AlertDescription>{summary}</AlertDescription>
        </Alert>
      </form>
    </FormDialogShell>
  );
}
