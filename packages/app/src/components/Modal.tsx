import {
  useEffect,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

export type ModalSize = "sm" | "md" | "lg"

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  size?: ModalSize
  closeDisabled?: boolean
  children: ReactNode
}

export interface ModalSectionProps extends PropsWithChildren<HTMLAttributes<HTMLDivElement>> {}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
}

function ModalBody({ children, className = "", ...props }: ModalSectionProps) {
  return (
    <div className={["flex-1 overflow-y-auto px-6 py-4", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  )
}

function ModalFooter({ children, className = "", ...props }: ModalSectionProps) {
  return (
    <div
      className={[
        "flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  )
}

function ModalRoot({ children, closeDisabled = false, onClose, open, size = "md", title }: ModalProps) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) {
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [closeDisabled, onClose, open])

  if (!open || typeof document === "undefined") {
    return null
  }

  const handleClose = () => {
    if (!closeDisabled) {
      onClose()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity" onClick={handleClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
        <div
          className={[
            "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl",
            sizeClasses[size],
          ].join(" ")}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <button
              type="button"
              className="text-slate-400 transition-colors hover:text-slate-600"
              onClick={handleClose}
              disabled={closeDisabled}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export const Modal = Object.assign(ModalRoot, {
  Body: ModalBody,
  Footer: ModalFooter,
})
