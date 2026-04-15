import type { ReactNode } from "react"

export type ToastVariant = "success" | "error" | "info" | "warning"

export interface ToastRecord {
  id: string
  title: string
  message?: string
  variant: ToastVariant
}

export interface ToastProps {
  toast: ToastRecord
  onDismiss: (id: string) => void
}

export interface ToastContainerProps {
  toasts: ToastRecord[]
  onDismiss: (id: string) => void
}

function ToastIcon({ variant }: { variant: ToastVariant }) {
  const colorClassName: Record<ToastVariant, string> = {
    success: "text-emerald-600",
    error: "text-red-600",
    info: "text-blue-600",
    warning: "text-amber-600",
  }

  const iconByVariant: Record<ToastVariant, ReactNode> = {
    success: <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />,
    error: (
      <>
        <path d="M12 8v4" strokeLinecap="round" />
        <path d="M12 16h.01" strokeLinecap="round" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    info: (
      <>
        <path d="M12 8h.01" strokeLinecap="round" />
        <path d="M11 12h1v4h1" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    warning: (
      <>
        <path d="M12 9v4" strokeLinecap="round" />
        <path d="M12 17h.01" strokeLinecap="round" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={["mt-0.5 h-5 w-5 shrink-0", colorClassName[variant]].join(" ")}
      aria-hidden="true"
    >
      {iconByVariant[variant]}
    </svg>
  )
}

export function Toast({ onDismiss, toast }: ToastProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
      <ToastIcon variant={toast.variant} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{toast.title}</p>
        {toast.message ? <p className="mt-0.5 text-xs text-slate-500">{toast.message}</p> : null}
      </div>
      <button
        type="button"
        className="shrink-0 text-slate-400 transition-colors hover:text-slate-600"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  )
}

export function ToastContainer({ onDismiss, toasts }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
