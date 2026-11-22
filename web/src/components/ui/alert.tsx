import * as React from "react"
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react"
import { cn } from "cn"

type AlertColor = "neutral" | "info" | "success" | "warning" | "destructive"

const alertBase =
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4"

const ALERT_COLORS: Record<AlertColor, string> = {
  neutral: "bg-card text-card-foreground",
  info: "border-info-text/35 bg-info-text/10 text-info-text *:data-[slot=alert-title]:text-info-text *:data-[slot=alert-description]:text-foreground",
  success:
    "border-success-text/35 bg-success-text/10 text-success-text *:data-[slot=alert-title]:text-success-text *:data-[slot=alert-description]:text-foreground",
  warning:
    "border-warning-text/35 bg-warning-text/10 text-warning-text *:data-[slot=alert-title]:text-warning-text *:data-[slot=alert-description]:text-foreground",
  destructive:
    "border-destructive-text/35 bg-destructive-text/10 text-destructive-text *:data-[slot=alert-title]:text-destructive-text *:data-[slot=alert-description]:text-foreground",
}

const ALERT_ICONS: Record<Exclude<AlertColor, "neutral">, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleX,
}

function Alert({
  className,
  color,
  icon,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "color"> & {
  /** Tanpa `color` = netral. */
  color?: AlertColor
  /** Ikon bawaan per warna; bawaan true bila `color` diberikan dan bukan neutral. */
  icon?: boolean
}) {
  const resolved: AlertColor = color ?? "neutral"
  const showIcon = icon ?? (color !== undefined && resolved !== "neutral")
  const Icon = resolved === "neutral" ? null : ALERT_ICONS[resolved]
  return (
    <div
      data-slot="alert"
      data-color={resolved}
      role="alert"
      className={cn(alertBase, ALERT_COLORS[resolved], className)}
      {...props}
    >
      {showIcon && Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
