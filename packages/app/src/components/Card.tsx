import type { ReactNode } from "react"

export interface CardProps {
  variant?: "default" | "highlighted" | "interactive"
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ variant = "default", children, className = "", onClick }: CardProps) {
  const variants = {
    default: "rounded-xl border border-slate-200 bg-white",
    highlighted: "rounded-xl border border-amber-200 bg-amber-50",
    interactive: "cursor-pointer rounded-xl border border-slate-200 bg-white transition-all hover:border-slate-300 hover:shadow-sm",
  }
  return (
    <div className={`${variants[variant]} ${className}`} onClick={onClick}>
      {children}
    </div>
  )
}
