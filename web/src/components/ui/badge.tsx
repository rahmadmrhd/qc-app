import * as React from "react"
import { cn } from "cn"
import { Slot } from "radix-ui"
import {
  colorVariantClasses,
  resolveStyle,
  type LegacyVariant,
  type UiColor,
  type UiVariant,
} from "./variant-style"

const BADGE_BASE =
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!"

/** Hover hanya berlaku bila badge dibungkus tautan, seperti shadcn asli. */
function badgeColorClasses(variant: UiVariant, color: UiColor) {
  return colorVariantClasses(variant, color)
    .split(" ")
    .map((c) => (c.startsWith("hover:") ? `[a]:${c}` : c))
    .join(" ")
}

function badgeVariants({
  variant,
  color,
  className,
}: {
  variant?: UiVariant | LegacyVariant
  color?: UiColor
  className?: string
} = {}) {
  const r = resolveStyle(variant, color)
  return cn(BADGE_BASE, badgeColorClasses(r.variant, r.color), className)
}

function Badge({
  className,
  variant,
  color,
  dot = false,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"span"> & {
  variant?: UiVariant | LegacyVariant
  color?: UiColor
  /** Titik `currentColor` 6 px sebelum isi (badge status). */
  dot?: boolean
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "span"
  const r = resolveStyle(variant, color)

  if (asChild) {
    return (
      <Comp
        data-slot="badge"
        data-variant={r.variant}
        data-color={r.color}
        className={badgeVariants({ variant, color, className })}
        {...props}
      >
        {children}
      </Comp>
    )
  }

  return (
    <Comp
      data-slot="badge"
      data-variant={r.variant}
      data-color={r.color}
      className={badgeVariants({ variant, color, className })}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          data-slot="badge-dot"
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      ) : null}
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants }
