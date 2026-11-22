import type { PartialPermissionMap } from '@shared/permissions';
import { LEVEL_LABELS, MODULE_LABELS, MODULES } from '@shared/permissions';
import { Badge } from '@/components/ui/badge';

export function PermissionBadges({ permissions }: { permissions: PartialPermissionMap }) {
  const entries = MODULES.flatMap((module) => {
    const level = permissions[module];
    return level && level !== 'none' ? [{ module, level }] : [];
  });
  if (entries.length === 0) {
    return <span className="text-sm text-muted-foreground">Tanpa akses</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(({ module, level }) => (
        <Badge key={module} variant="soft" color="secondary">
          {MODULE_LABELS[module]}: {LEVEL_LABELS[level]}
        </Badge>
      ))}
    </div>
  );
}
