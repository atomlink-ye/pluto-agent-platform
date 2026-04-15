import type { HTMLAttributes, ReactNode } from "react"

export type BadgeVariant =
  | 'running' | 'pending' | 'completed' | 'failed' | 'cancelled'
  | 'pending_approval' | 'approved' | 'rejected'
  | 'success' | 'warning' | 'error' | 'info' | 'default';

type LegacyBadgeStatus =
  | 'queued'
  | 'draft'
  | 'initializing'
  | 'created'
  | 'waiting_approval'
  | 'succeeded'
  | 'registered'
  | 'denied'
  | 'failing'
  | 'blocked'
  | 'canceled'
  | 'expired'
  | 'archived'
  | 'superseded';

type ResolvedBadgeStatus = BadgeVariant | LegacyBadgeStatus

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status?: string
  variant?: BadgeVariant
  children?: ReactNode
  className?: string
}

const variantStyles: Record<ResolvedBadgeStatus, string> = {
  running: 'bg-blue-50 text-blue-700',
  pending: 'bg-slate-100 text-slate-600',
  completed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
  pending_approval: 'border border-amber-200 bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  error: 'bg-red-50 text-red-700',
  info: 'bg-blue-50 text-blue-700',
  default: 'bg-slate-100 text-slate-600',
  queued: 'bg-slate-100 text-slate-600',
  draft: 'bg-slate-100 text-slate-600',
  initializing: 'bg-blue-50 text-blue-700',
  created: 'bg-blue-50 text-blue-700',
  waiting_approval: 'border border-amber-200 bg-amber-50 text-amber-700',
  succeeded: 'bg-emerald-50 text-emerald-700',
  registered: 'bg-emerald-50 text-emerald-700',
  denied: 'bg-red-50 text-red-700',
  failing: 'bg-red-50 text-red-700',
  blocked: 'bg-red-50 text-red-700',
  canceled: 'bg-slate-100 text-slate-500',
  expired: 'bg-slate-100 text-slate-500',
  archived: 'bg-slate-100 text-slate-500',
  superseded: 'bg-slate-100 text-slate-500',
}

const labelOverrides: Partial<Record<ResolvedBadgeStatus, string>> = {
  pending_approval: 'pending approval',
  waiting_approval: 'pending approval',
  canceled: 'cancelled',
}

function formatStatus(status: string) {
  return status.replace(/_/g, ' ')
}

export function Badge({ status, variant = 'default', children, className = '', ...props }: BadgeProps) {
  const resolvedStatus = status ?? variant;
  const badgeStyle = variantStyles[resolvedStatus as ResolvedBadgeStatus] ?? variantStyles.default;
  const label = children ?? labelOverrides[resolvedStatus as ResolvedBadgeStatus] ?? formatStatus(resolvedStatus);

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeStyle} ${className}`} {...props}>
      {resolvedStatus === 'running' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
      )}
      {label}
    </span>
  )
}

export { Badge as StatusBadge };
