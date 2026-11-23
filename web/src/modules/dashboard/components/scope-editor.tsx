import {
  type DashboardGroupId,
  GROUP_FILTERS,
  GROUP_LABELS,
  type GroupFilterField,
  WIDGETS,
  type WidgetId,
  widgetMeta,
} from '@shared/dashboard';
import type { ShareWidgetScope } from '@shared/dashboard-share';
import { LinkMultiField } from '@/components/link-field';
import { MultiSelect } from '@/components/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { useMe } from '@/modules/auth/use-me';
import { buFilterOptions, locationFilterOptions } from './global-filters';
import { RelationPicker, useRelationLabels } from './relation-field';

/** Cakupan yang dipilih pengguna: BU, lokasi, widget (beserta filter grupnya), dan filter relasi yang ditawarkan ke penonton. */
export interface ScopeEditorValue {
  buIds: string[];
  locationIds: string[];
  widgets: ShareWidgetScope[];
  /** Kunci filter relasi yang boleh dipersempit penonton. */
  offers: string[];
}

const groupOf = (id: WidgetId): DashboardGroupId => widgetMeta(id).group;

/** Filter grup yang berlaku (sama untuk semua widget terpilih di grup itu; diambil dari widget pertama). */
function groupFiltersOf(
  value: ScopeEditorValue,
  group: DashboardGroupId,
): Record<string, string[]> {
  const first = value.widgets.find((widget) => groupOf(widget.id) === group);
  return first?.filters ?? {};
}

function RelationFilter({
  field,
  value,
  offered,
  onChange,
  onOfferChange,
  idPrefix,
}: {
  field: GroupFilterField;
  value: string[];
  offered: boolean;
  onChange: (next: string[]) => void;
  onOfferChange: (next: boolean) => void;
  idPrefix: string;
}) {
  const { kind, labelOf, remember } = useRelationLabels(field, value);
  return (
    <div className="space-y-1.5">
      <RelationPicker
        showLabel
        kind={kind}
        field={field}
        value={value}
        labelOf={labelOf}
        onChange={onChange}
        remember={remember}
        id={`${idPrefix}-${field.key}`}
      />
      {value.length > 0 ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${idPrefix}-${field.key}-offer`}
            checked={offered}
            onCheckedChange={(next) => onOfferChange(next === true)}
          />
          <Label htmlFor={`${idPrefix}-${field.key}-offer`} className="font-normal">
            Penonton boleh mempersempit {field.label.toLowerCase()}
          </Label>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Editor cakupan yang dipakai bersama dialog Bagikan dan form laporan terjadwal: chip BU/Lokasi, daftar centang widget
 * per grup (hanya `allowedWidgetIds`), filter grup per grup widget yang terpilih, dan saklar "penonton boleh
 * mempersempit" untuk filter relasi yang terisi. Tidak mengisi apa pun sendiri: semua perubahan lewat `onChange`.
 */
export function ScopeEditor({
  value,
  onChange,
  allowedWidgetIds,
  seedFilters,
}: {
  value: ScopeEditorValue;
  onChange: (next: ScopeEditorValue) => void;
  allowedWidgetIds: readonly WidgetId[];
  /** Filter awal sebuah grup saat widget pertamanya dicentang (mis. filter grup yang sedang aktif di halaman). */
  seedFilters?: (group: DashboardGroupId) => Record<string, string[]>;
}) {
  const me = useMe();
  const buOptions = buFilterOptions(me);
  const locationOptions = locationFilterOptions(me);
  const buLabel = (id: string) =>
    buOptions.find((option) => option.id === id)?.label ?? 'BU tidak dikenal';
  const locationLabel = (id: string) =>
    locationOptions.find((option) => option.id === id)?.label ?? 'Lokasi tidak dikenal';
  const allowed = new Set(allowedWidgetIds);
  const groups = (Object.keys(GROUP_LABELS) as DashboardGroupId[])
    .map((group) => ({
      group,
      widgets: WIDGETS.filter((meta) => meta.group === group && allowed.has(meta.id)),
    }))
    .filter((entry) => entry.widgets.length > 0);
  const selected = new Set(value.widgets.map((widget) => widget.id));

  const setWidgets = (widgets: ShareWidgetScope[]) => onChange({ ...value, widgets });
  // Filter awal sebuah grup: yang sudah dipakai widget terpilih di grup itu, atau (grup masih kosong) benih dari filter aktif.
  const filtersForGroup = (group: DashboardGroupId): Record<string, string[]> =>
    value.widgets.some((widget) => groupOf(widget.id) === group)
      ? { ...groupFiltersOf(value, group) }
      : { ...(seedFilters?.(group) ?? {}) };
  const toggleWidget = (id: WidgetId, on: boolean) => {
    if (on) {
      if (selected.has(id)) return;
      setWidgets([...value.widgets, { id, filters: filtersForGroup(groupOf(id)) }]);
    } else {
      setWidgets(value.widgets.filter((widget) => widget.id !== id));
    }
  };
  const toggleGroup = (group: DashboardGroupId, ids: WidgetId[], on: boolean) => {
    const rest = value.widgets.filter((widget) => groupOf(widget.id) !== group);
    if (!on) {
      setWidgets(rest);
      return;
    }
    const filters = filtersForGroup(group);
    setWidgets([...rest, ...ids.map((id) => ({ id, filters: { ...filters } }))]);
  };
  const setGroupFilter = (group: DashboardGroupId, field: GroupFilterField, next: string[]) => {
    const widgets = value.widgets.map((widget) => {
      if (groupOf(widget.id) !== group) return widget;
      const filters = { ...widget.filters };
      if (next.length > 0) filters[field.key] = next;
      else delete filters[field.key];
      return { ...widget, filters };
    });
    const offers =
      next.length === 0 && field.kind === 'relation'
        ? value.offers.filter((key) => key !== field.key)
        : value.offers;
    onChange({ ...value, widgets, offers });
  };
  const setOffer = (key: string, on: boolean) =>
    onChange({
      ...value,
      offers: on
        ? [...new Set([...value.offers, key])]
        : value.offers.filter((existing) => existing !== key),
    });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <LinkMultiField
          maxSelected={FILTER_LIST_MAX}
          id="share-scope-bu"
          label="BU"
          placeholder="Semua BU yang Anda punya hak"
          localFilter
          highlight
          value={value.buIds}
          labelOf={buLabel}
          options={buOptions}
          onChange={(next) => onChange({ ...value, buIds: next })}
        />
        <LinkMultiField
          maxSelected={FILTER_LIST_MAX}
          id="share-scope-location"
          label="Lokasi"
          placeholder="Semua lokasi yang Anda punya hak"
          localFilter
          highlight
          value={value.locationIds}
          labelOf={locationLabel}
          options={locationOptions}
          onChange={(next) => onChange({ ...value, locationIds: next })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        BU dan lokasi dibekukan saat tautan dibuat. Dikosongkan = semua yang Anda punya hak saat
        ini, BU atau lokasi yang ditambahkan kemudian tidak ikut.
      </p>
      {groups.map(({ group, widgets }) => {
        const ids = widgets.map((meta) => meta.id);
        const picked = ids.filter((id) => selected.has(id));
        const filters = groupFiltersOf(value, group);
        const hasPicked = picked.length > 0;
        return (
          <fieldset key={group} className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{GROUP_LABELS[group]}</legend>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`share-group-${group}`}
                checked={
                  picked.length === 0
                    ? false
                    : picked.length === ids.length
                      ? true
                      : 'indeterminate'
                }
                onCheckedChange={(next) => toggleGroup(group, ids, next === true)}
              />
              <Label htmlFor={`share-group-${group}`}>
                Pilih semua widget {GROUP_LABELS[group]}
              </Label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {widgets.map((meta) => (
                <div key={meta.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`share-widget-${meta.id}`}
                    checked={selected.has(meta.id)}
                    onCheckedChange={(next) => toggleWidget(meta.id, next === true)}
                  />
                  <Label htmlFor={`share-widget-${meta.id}`} className="font-normal">
                    {meta.title}
                  </Label>
                </div>
              ))}
            </div>
            {hasPicked && GROUP_FILTERS[group].length > 0 ? (
              <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                {GROUP_FILTERS[group].map((field) => {
                  const current = filters[field.key] ?? [];
                  if (field.kind === 'enum') {
                    return (
                      <div key={field.key} className="space-y-1.5">
                        <MultiSelect
                          maxSelected={FILTER_LIST_MAX}
                          id={`share-filter-${group}-${field.key}`}
                          label={field.label}
                          placeholder={`Semua ${field.label.toLowerCase()}`}
                          options={[...(field.options ?? [])]}
                          value={current}
                          onValueChange={(next) => setGroupFilter(group, field, next)}
                        />
                      </div>
                    );
                  }
                  return (
                    <RelationFilter
                      key={field.key}
                      field={field}
                      value={current}
                      offered={value.offers.includes(field.key)}
                      onChange={(next) => setGroupFilter(group, field, next)}
                      onOfferChange={(on) => setOffer(field.key, on)}
                      idPrefix={`share-filter-${group}`}
                    />
                  );
                })}
              </div>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}
