import type { ComponentPropsWithoutRef } from "react"

export interface FieldOption {
  value: string
  label: string
}

interface FieldBaseProps {
  label?: string
  error?: string | null
  required?: boolean
}

export interface InputProps
  extends Omit<ComponentPropsWithoutRef<"input">, "children">,
    FieldBaseProps {}

export interface TextareaProps
  extends Omit<ComponentPropsWithoutRef<"textarea">, "children">,
    FieldBaseProps {}

export interface SelectProps
  extends Omit<ComponentPropsWithoutRef<"select">, "children">,
    FieldBaseProps {
  options: FieldOption[]
}

const baseFieldClassName =
  "w-full rounded-md border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2"

function getFieldClassName(error?: string | null, className?: string) {
  return [
    baseFieldClassName,
    error
      ? "border-red-400 focus:ring-red-400"
      : "border-slate-300 focus:ring-blue-500",
    className,
  ]
    .filter(Boolean)
    .join(" ")
}

function FieldWrapper({
  children,
  error,
  label,
  required,
}: {
  children: React.ReactNode
  error?: string | null
  label?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1">
      {label ? (
        <label className="block text-xs font-medium text-slate-600">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

export function Input({ className, error, label, required, ...props }: InputProps) {
  return (
    <FieldWrapper error={error} label={label} required={required}>
      <input
        aria-invalid={Boolean(error)}
        className={getFieldClassName(error, className)}
        {...props}
      />
    </FieldWrapper>
  )
}

export function Textarea({ className, error, label, required, ...props }: TextareaProps) {
  return (
    <FieldWrapper error={error} label={label} required={required}>
      <textarea
        aria-invalid={Boolean(error)}
        className={getFieldClassName(error, className)}
        {...props}
      />
    </FieldWrapper>
  )
}

export function Select({ className, error, label, options, required, ...props }: SelectProps) {
  return (
    <FieldWrapper error={error} label={label} required={required}>
      <select
        aria-invalid={Boolean(error)}
        className={getFieldClassName(error, className)}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  )
}
