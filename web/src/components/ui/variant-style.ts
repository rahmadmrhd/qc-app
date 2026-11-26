export type UiColor = 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'destructive'
export type UiVariant = 'solid' | 'soft' | 'outline' | 'ghost' | 'link'

const SOLID: Record<UiColor, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
  success: 'bg-success text-success-foreground hover:bg-success/90',
  warning: 'bg-warning text-warning-foreground hover:bg-warning/90',
  info: 'bg-info text-info-foreground hover:bg-info/90',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
}

/** Warna teks/ikon/garis di atas latar halaman; primary memakai warna teks biasa. */
const TEXT: Record<UiColor, string> = {
  primary: 'text-foreground',
  secondary: 'text-secondary-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  info: 'text-info-text',
  destructive: 'text-destructive-text',
}

const SOFT: Record<Exclude<UiColor, 'primary'>, string> = {
  secondary: 'bg-secondary-text/15 hover:bg-secondary-text/25',
  success: 'bg-success-text/15 hover:bg-success-text/25',
  warning: 'bg-warning-text/15 hover:bg-warning-text/25',
  info: 'bg-info-text/15 hover:bg-info-text/25',
  destructive: 'bg-destructive-text/15 hover:bg-destructive-text/25',
}

const OUTLINE: Record<Exclude<UiColor, 'primary'>, string> = {
  secondary: 'border-secondary-text/50 hover:bg-secondary-text/10',
  success: 'border-success-text/50 hover:bg-success-text/10',
  warning: 'border-warning-text/50 hover:bg-warning-text/10',
  info: 'border-info-text/50 hover:bg-info-text/10',
  destructive: 'border-destructive-text/50 hover:bg-destructive-text/10',
}

const GHOST: Record<Exclude<UiColor, 'primary'>, string> = {
  secondary: 'hover:bg-secondary-text/12',
  success: 'hover:bg-success-text/12',
  warning: 'hover:bg-warning-text/12',
  info: 'hover:bg-info-text/12',
  destructive: 'hover:bg-destructive-text/12',
}

/**
 * Keadaan nonaktif per palet (token `--X-disabled` dan `--X-disabled-foreground`): masih tampak warnanya,
 * tetapi jelas nonaktif. Menggantikan `opacity-50` seragam (keputusan pemilik 2026-11-25).
 */
const DISABLED_FILL: Record<UiColor, string> = {
  primary: 'disabled:bg-primary-disabled disabled:text-primary-disabled-foreground',
  secondary: 'disabled:bg-secondary-disabled disabled:text-secondary-disabled-foreground',
  success: 'disabled:bg-success-disabled disabled:text-success-disabled-foreground',
  warning: 'disabled:bg-warning-disabled disabled:text-warning-disabled-foreground',
  info: 'disabled:bg-info-disabled disabled:text-info-disabled-foreground',
  destructive: 'disabled:bg-destructive-disabled disabled:text-destructive-disabled-foreground',
}

const DISABLED_OUTLINE: Record<UiColor, string> = {
  primary: 'disabled:bg-transparent disabled:border-primary-disabled-foreground/40 disabled:text-primary-disabled-foreground',
  secondary: 'disabled:bg-transparent disabled:border-secondary-disabled-foreground/40 disabled:text-secondary-disabled-foreground',
  success: 'disabled:bg-transparent disabled:border-success-disabled-foreground/40 disabled:text-success-disabled-foreground',
  warning: 'disabled:bg-transparent disabled:border-warning-disabled-foreground/40 disabled:text-warning-disabled-foreground',
  info: 'disabled:bg-transparent disabled:border-info-disabled-foreground/40 disabled:text-info-disabled-foreground',
  destructive: 'disabled:bg-transparent disabled:border-destructive-disabled-foreground/40 disabled:text-destructive-disabled-foreground',
}

const DISABLED_TEXT: Record<UiColor, string> = {
  primary: 'disabled:text-primary-disabled-foreground',
  secondary: 'disabled:text-secondary-disabled-foreground',
  success: 'disabled:text-success-disabled-foreground',
  warning: 'disabled:text-warning-disabled-foreground',
  info: 'disabled:text-info-disabled-foreground',
  destructive: 'disabled:text-destructive-disabled-foreground',
}

/** Kelas warna untuk satu kombinasi gaya x warna (tanpa kelas dasar/ukuran). */
export function colorVariantClasses(variant: UiVariant, color: UiColor): string {
  return `${enabledClasses(variant, color)} ${disabledClasses(variant, color)}`
}

function disabledClasses(variant: UiVariant, color: UiColor): string {
  if (variant === 'solid' || variant === 'soft') return DISABLED_FILL[color]
  if (variant === 'outline') return DISABLED_OUTLINE[color]
  return DISABLED_TEXT[color]
}

function enabledClasses(variant: UiVariant, color: UiColor): string {
  const text = TEXT[color]
  if (variant === 'solid') return SOLID[color]
  if (variant === 'link') return `${text} underline-offset-4 hover:underline`
  if (color === 'primary') {
    if (variant === 'soft') return 'bg-muted text-foreground hover:bg-muted/70'
    if (variant === 'outline')
      return 'border-border text-foreground hover:bg-muted aria-expanded:bg-muted'
    return 'text-foreground hover:bg-muted aria-expanded:bg-muted'
  }
  if (variant === 'soft') return `${text} ${SOFT[color]}`
  if (variant === 'outline') return `${text} ${OUTLINE[color]}`
  return `${text} ${GHOST[color]}`
}
