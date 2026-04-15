import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"

import { api } from "../api"
import { usePolling } from "../hooks/usePolling"
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb"

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

interface NavItem {
  to: string
  label: string
  icon: IconComponent
}

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.25 9.75V21h13.5V9.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.75 21v-6h4.5v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M6 4.5h9.75A2.25 2.25 0 0 1 18 6.75V19.5H8.25A2.25 2.25 0 0 0 6 21.75V4.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 4.5A2.25 2.25 0 0 0 3.75 6.75V18A2.25 2.25 0 0 0 6 20.25H18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M7.5 5.25v13.5L18 12 7.5 5.25Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M9 12.75 11.25 15 15 9.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const navItems: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { to: "/playbooks", label: "Playbooks", icon: BookIcon },
  { to: "/runs", label: "Runs", icon: PlayIcon },
  { to: "/approvals", label: "Approvals", icon: CheckIcon },
]

const breadcrumbLabels: Record<string, string> = {
  dashboard: "Dashboard",
  playbooks: "Playbooks",
  runs: "Runs",
  approvals: "Approvals",
}

interface PageChromeValue {
  setActions: (actions: ReactNode | null) => void
  setBreadcrumbs: (breadcrumbs: BreadcrumbItem[] | null) => void
  refreshPendingApprovals: () => Promise<void>
}

interface UsePageChromeOptions {
  breadcrumbs?: BreadcrumbItem[]
  actions?: ReactNode
}

const PageChromeContext = createContext<PageChromeValue | undefined>(undefined)

function formatSegment(segment: string) {
  return breadcrumbLabels[segment] ?? decodeURIComponent(segment).replace(/[-_]/g, " ")
}

function deriveBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split("/").filter(Boolean)

  if (segments.length === 0) {
    return [{ label: "Dashboard" }]
  }

  return segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`
    const isLast = index === segments.length - 1

    return {
      label: formatSegment(segment),
      href: isLast ? undefined : href,
    }
  })
}

export function usePageChrome({ actions, breadcrumbs }: UsePageChromeOptions) {
  const context = useContext(PageChromeContext)

  if (!context) {
    throw new Error("usePageChrome must be used within Layout")
  }

  useEffect(() => {
    context.setBreadcrumbs(breadcrumbs ?? null)

    return () => {
      context.setBreadcrumbs(null)
    }
  }, [breadcrumbs, context])

  useEffect(() => {
    context.setActions(actions ?? null)

    return () => {
      context.setActions(null)
    }
  }, [actions, context])

  return context
}

export function Layout() {
  const location = useLocation()
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0)
  const [pageBreadcrumbs, setPageBreadcrumbs] = useState<BreadcrumbItem[] | null>(null)
  const [pageActions, setPageActions] = useState<ReactNode | null>(null)

  const loadPendingApprovalsCount = useCallback(async () => {
    try {
      const approvals = await api.approvals.list("pending")
      setPendingApprovalsCount(approvals.length)
    } catch {
      setPendingApprovalsCount(0)
    }
  }, [])

  useEffect(() => {
    void loadPendingApprovalsCount()
  }, [loadPendingApprovalsCount, location.pathname])

  usePolling(loadPendingApprovalsCount, 10000, true)

  const defaultBreadcrumbs = useMemo(() => deriveBreadcrumbs(location.pathname), [location.pathname])
  const breadcrumbs = pageBreadcrumbs ?? defaultBreadcrumbs
  const pageChromeValue = useMemo<PageChromeValue>(
    () => ({
      setActions: setPageActions,
      setBreadcrumbs: setPageBreadcrumbs,
      refreshPendingApprovals: loadPendingApprovalsCount,
    }),
    [loadPendingApprovalsCount],
  )

  return (
    <PageChromeContext.Provider value={pageChromeValue}>
      <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <div className="flex h-14 items-center border-b border-slate-200 px-4">
            <span className="text-base font-semibold text-slate-900">Pluto Platform</span>
          </div>

          <nav className="flex-1 space-y-0.5 p-3">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  [
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  ].join(" ")
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{label}</span>

                {label === "Approvals" && pendingApprovalsCount > 0 ? (
                  <span className="ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {pendingApprovalsCount}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
            <Breadcrumb items={breadcrumbs} />
            <div className="ml-auto flex items-center gap-2">{pageActions}</div>
          </header>

          <main className="flex-1 bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </PageChromeContext.Provider>
  )
}
