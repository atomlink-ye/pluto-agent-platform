import { Fragment } from "react"
import { Link } from "react-router-dom"

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumb({ items, className = "" }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1 text-sm ${className}`}>
      {items.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 && <span className="text-slate-300">/</span>}
          {item.href && index < items.length - 1 ? (
            <Link to={item.href} className="text-slate-500 transition-colors hover:text-slate-900">
              {item.label}
            </Link>
          ) : (
            <span className={index === items.length - 1 ? "font-medium text-slate-900" : "text-slate-500"}>
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
