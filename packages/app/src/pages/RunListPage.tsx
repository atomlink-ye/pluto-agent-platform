import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { api, type RunRecord } from "../api"
import { Badge } from "../components/Badge"
import { Button } from "../components/Button"
import { Card } from "../components/Card"
import { EmptyState } from "../components/EmptyState"
import { Input } from "../components/Input"
import { usePageChrome } from "../components/Layout"
import { Pagination } from "../components/Pagination"
import { Skeleton } from "../components/Skeleton"
import { usePolling } from "../hooks/usePolling"
import { useToast } from "../hooks/useToast"

type RunFilter = "all" | "running" | "pending_approval" | "succeeded" | "failed"

const FILTER_TABS: Array<{ value: RunFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
]

function matchesFilter(run: RunRecord, filter: RunFilter) {
  const status = run.status as string

  if (filter === "all") {
    return true
  }

  if (filter === "pending_approval") {
    return status === "pending_approval" || status === "waiting_approval"
  }

  if (filter === "running") {
    return status === "running" || status === "initializing" || status === "queued"
  }

  return status === filter
}

function getPlaybookName(run: RunRecord) {
  return run.playbookName ?? run.playbook_name ?? run.playbook ?? "Unknown playbook"
}

function formatRelativeTime(value?: string) {
  if (!value) {
    return "—"
  }

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) {
    return value
  }

  const deltaMinutes = Math.floor((Date.now() - timestamp) / 60000)
  if (deltaMinutes < 1) {
    return "just now"
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes} min ago`
  }

  const deltaHours = Math.floor(deltaMinutes / 60)
  if (deltaHours < 24) {
    return `${deltaHours} hr ago`
  }

  const deltaDays = Math.floor(deltaHours / 24)
  return `${deltaDays} day${deltaDays === 1 ? "" : "s"} ago`
}

function formatDuration(run: RunRecord) {
  const startValue = run.startedAt ?? run.createdAt
  if (!startValue) {
    return "—"
  }

  const start = new Date(startValue).getTime()
  if (Number.isNaN(start)) {
    return "—"
  }

  const end = new Date(run.completedAt ?? run.updatedAt ?? Date.now()).getTime()
  const durationMinutes = Math.floor(Math.max(0, end - start) / 60000)

  if (durationMinutes < 1) {
    return "<1 min"
  }

  if (durationMinutes < 60) {
    return `${durationMinutes} min`
  }

  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`
}

function RunTableSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-slate-200">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="grid grid-cols-5 gap-4 px-4 py-4">
            <Skeleton width="w-full" height="h-4" />
            <Skeleton width="w-20" height="h-4" />
            <Skeleton width="w-20" height="h-4" />
            <Skeleton width="w-24" height="h-4" />
            <Skeleton width="w-16" height="h-4" />
          </div>
        ))}
      </div>
    </Card>
  )
}

export function RunListPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const activeFilter = (searchParams.get("status") as RunFilter | null) ?? "all"
  const search = searchParams.get("q") ?? ""
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)

  const loadRuns = useCallback(async () => {
    try {
      const data = await api.runs.list()
      setRuns(data)
      setError(null)
      return true
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load runs")
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    const ok = await loadRuns()
    if (ok) {
      toast.success("Runs refreshed")
      return
    }

    toast.error("Failed to refresh runs")
  }, [loadRuns, toast])

  usePageChrome({
    breadcrumbs: [{ label: "Runs" }],
    actions: (
      <Button variant="secondary" onClick={() => void handleRefresh()}>
        Refresh
      </Button>
    ),
  })

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  const hasRunningRuns = useMemo(() => runs.some((run) => matchesFilter(run, "running")), [runs])
  usePolling(() => {
    void loadRuns()
  }, 10000, (activeFilter === "all" || activeFilter === "running") && hasRunningRuns)

  const filteredRuns = useMemo(() => {
    const query = search.trim().toLowerCase()

    return runs
      .filter((run) => matchesFilter(run, activeFilter))
      .filter((run) => {
        if (!query) {
          return true
        }

        return `${getPlaybookName(run)} ${run.id}`.toLowerCase().includes(query)
      })
      .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime())
  }, [activeFilter, runs, search])

  const counts = useMemo(
    () =>
      FILTER_TABS.reduce<Record<RunFilter, number>>(
        (accumulator, tab) => ({
          ...accumulator,
          [tab.value]: runs.filter((run) => matchesFilter(run, tab.value)).length,
        }),
        { all: 0, running: 0, pending_approval: 0, succeeded: 0, failed: 0 },
      ),
    [runs],
  )

  const pageSize = 20
  const paginatedRuns = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredRuns.slice(start, start + pageSize)
  }, [filteredRuns, page])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Runs</h1>
        <p className="mt-1 text-sm text-slate-600">Scan active, pending approval, and recently completed execution.</p>
      </div>

      <div className="-mx-4 overflow-x-auto border-b border-slate-200 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex min-w-max gap-1 pb-1">
          {FILTER_TABS.map((tab) => (
            <Button
              key={tab.value}
              variant="ghost"
              className={[
                "rounded-none border-b-2 px-3 py-2.5",
                activeFilter === tab.value
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
              ].join(" ")}
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams)
                nextParams.set("status", tab.value)
                nextParams.set("page", "1")
                setSearchParams(nextParams)
              }}
            >
              {tab.label}
              {counts[tab.value] > 0 ? (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {counts[tab.value]}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-md flex-1">
          <Input
            placeholder="Search by playbook or run ID"
            value={search}
            onChange={(event) => {
              const nextParams = new URLSearchParams(searchParams)
              nextParams.set("page", "1")
              if (event.target.value) {
                nextParams.set("q", event.target.value)
              } else {
                nextParams.delete("q")
              }
              setSearchParams(nextParams)
            }}
          />
        </div>
        <p className="text-sm text-slate-500">
          {filteredRuns.length} result{filteredRuns.length === 1 ? "" : "s"}
        </p>
      </div>

      {loading ? <RunTableSkeleton /> : null}

      {!loading && error ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-red-700">Failed to load runs</p>
              <p className="mt-1 text-sm text-red-600">{error}</p>
            </div>
            <Button variant="secondary" onClick={() => void handleRefresh()}>
              Retry
            </Button>
          </div>
        </Card>
      ) : null}

      {!loading && !error && filteredRuns.length === 0 ? (
        <EmptyState
          title="No runs found"
          description={search ? "Try a different search term." : "Start a run from a playbook to populate this view."}
        />
      ) : null}

      {!loading && !error && filteredRuns.length > 0 ? (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Playbook</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Phase</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Started</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {paginatedRuns.map((run) => (
                    <tr
                      key={run.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => navigate(`/runs/${run.id}`)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{getPlaybookName(run)}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">{run.id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge status={run.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">{run.current_phase ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{formatRelativeTime(run.startedAt ?? run.createdAt)}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDuration(run)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex justify-end">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={filteredRuns.length}
              onPageChange={(nextPage) => {
                const nextParams = new URLSearchParams(searchParams)
                nextParams.set("page", String(nextPage))
                setSearchParams(nextParams)
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
