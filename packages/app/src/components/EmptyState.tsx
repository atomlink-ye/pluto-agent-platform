import type { ReactNode } from "react"

import { Button } from "./Button"

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode | {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  const renderedAction =
    action && typeof action === "object" && !Array.isArray(action) && "label" in action && "onClick" in action ? (
      <Button onClick={action.onClick}>{action.label}</Button>
    ) : (
      action ?? null
    )

  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white/80 px-6 py-12 text-center ${className}`}>
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          {icon}
        </div>
      ) : null}
      <h3 className="mb-1 text-base font-semibold text-slate-900">{title}</h3>
      {description ? <p className="mb-4 max-w-sm text-sm text-slate-600">{description}</p> : null}
      {renderedAction}
    </div>
  )
}
