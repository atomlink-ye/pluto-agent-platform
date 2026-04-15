import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { api, type ApprovalQueueRecord, type RunRecord } from "../api"
import { Badge } from "../components/Badge"
import { Button } from "../components/Button"
import { Card } from "../components/Card"
import { EmptyState } from "../components/EmptyState"
import { usePageChrome } from "../components/Layout"
import { Skeleton } from "../components/Skeleton"
import { StatusBadge } from "../components/StatusBadge"
import { usePolling } from "../hooks/usePolling"
import { useToast } from "../hooks/useToast"

interface AttentionItem {
  id: string
  href: string
  kind: "approval" | "failed"
  title: string
  description: string
  createdAt?: string
  status: string
}

function getRunPlaybookName(run: RunRecord) {
  return run.playbookName ?? run.playbook_name ?? run.playbook ?? "Unknown playbook"
}

function formatRelativeTime(value?: string) {
  if (!value) {
    return "—"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const deltaMs = Date.now() - date.getTime()
  const deltaMinutes = Math.floor(deltaMs / 60000)

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

  const endValue = run.completedAt ?? run.updatedAt
  const end = endValue ? new Date(endValue).getTime() : Date.now()
  const durationMs = Math.max(0, end - start)
  const durationMinutes = Math.floor(durationMs / 60000)

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

function isTerminalStatus(status: RunRecord["status"] | "cancelled") {
  return ["failed", "succeeded", "canceled", "cancelled", "archived"].includes(status)
}

function isRunningLikeStatus(status: RunRecord["status"]) {
  return ["queued", "initializing", "running"].includes(status)
}

function isToday(value?: string) {
  if (!value) {
    return false
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return false
  }

  const now = new Date()
  return date.toDateString() === now.toDateString()
}

function StatCard({
  label,
  value,
  to,
  accentClassName,
}: {
  label: string
  value: number
  to: string
  accentClassName: string
}) {
  return (
    <Link to={to} className="block">
      <Card className={`border-l-4 p-4 transition-colors hover:border-slate-300 ${accentClassName}`}>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      </Card>
    </Link>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="p-4">
            <Skeleton width="w-1/2" height="h-4" />
            <Skeleton width="w-1/4" height="h-8" className="mt-4" />
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <Skeleton width="w-40" height="h-5" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} width="w-full" height="h-12" />
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <Skeleton width="w-32" height="h-5" />
        </div>
        <div className="divide-y divide-slate-200 px-4 py-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="grid grid-cols-4 gap-4 py-3">
              <Skeleton width="w-full" height="h-4" />
              <Skeleton width="w-20" height="h-4" />
              <Skeleton width="w-20" height="h-4" />
              <Skeleton width="w-16" height="h-4" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [approvals, setApprovals] = useState<ApprovalQueueRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    try {
      const [runData, approvalData] = await Promise.all([
        api.runs.list(),
        api.approvals.list("pending"),
      ])

      setRuns(runData)
      setApprovals(approvalData)
      setError(null)
      return true
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard")
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    const ok = await loadDashboard()
    if (ok) {
      toast.success("Dashboard refreshed")
      return
    }

    toast.error("Failed to refresh dashboard")
  }, [loadDashboard, toast])

  usePageChrome({
    breadcrumbs: [{ label: "Dashboard" }],
    actions: (
      <Button variant="secondary" onClick={() => void handleRefresh()}>
        Refresh
      </Button>
    ),
  })

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  usePolling(() => {
    void loadDashboard()
  }, 30000, true)

  const stats = useMemo(() => {
    const activeRuns = runs.filter((run) => isRunningLikeStatus(run.status)).length
    const succeededToday = runs.filter((run) => run.status === "succeeded" && isToday(run.completedAt ?? run.updatedAt ?? run.createdAt)).length
    const failedToday = runs.filter((run) => run.status === "failed" && isToday(run.completedAt ?? run.updatedAt ?? run.createdAt)).length

    return {
      activeRuns,
      pendingApprovals: approvals.length,
      succeededToday,
      failedToday,
    }
  }, [approvals.length, runs])

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const approvalItems = approvals.map<AttentionItem>((approval) => ({
      id: `approval-${approval.id}`,
      href: approval.run ? `/runs/${approval.run.id}` : "/approvals?status=pending",
      kind: "approval",
      title: approval.title ?? "Approval required",
      description:
        approval.context?.reason ??
        approval.playbook?.name ??
        approval.action_class.replace(/_/g, " "),
      createdAt: approval.createdAt,
      status: approval.status,
    }))

    const failedItems = runs
      .filter((run) => run.status === "failed")
      .map<AttentionItem>((run) => ({
        id: `run-${run.id}`,
        href: `/runs/${run.id}`,
        kind: "failed",
        title: getRunPlaybookName(run),
        description: run.failureReason ?? run.blockerReason ?? "Run needs operator review",
        createdAt: run.updatedAt ?? run.createdAt,
        status: run.status,
      }))

    return [...approvalItems, ...failedItems]
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "approval" ? -1 : 1
        }

        const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0
        const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0
        return rightTime - leftTime
      })
      .slice(0, 5)
  }, [approvals, runs])

  const recentRuns = useMemo(
    () =>
      [...runs]
        .sort((left, right) => {
          const leftTime = new Date(left.createdAt ?? 0).getTime()
          const rightTime = new Date(right.createdAt ?? 0).getTime()
          return rightTime - leftTime
        })
        .slice(0, 10),
    [runs],
  )

  if (loading) {
    return <DashboardSkeleton />
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-700">Failed to load dashboard</p>
        <p className="mt-1 text-sm text-red-600">{error}</p>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void handleRefresh()}>
            Retry
          </Button>
        </div>
      </Card>
    )
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        description="Start a run from a playbook to populate the operator dashboard."
        action={<Button onClick={() => navigate("/playbooks")}>Go to Playbooks</Button>}
      />
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Run-first operator summary across active work, approvals, and recent execution.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Runs" value={stats.activeRuns} to="/runs?status=running" accentClassName="border-l-blue-500" />
        <StatCard label="Pending Approvals" value={stats.pendingApprovals} to="/approvals?status=pending" accentClassName="border-l-amber-500" />
        <StatCard label="Succeeded Today" value={stats.succeededToday} to="/runs?status=succeeded" accentClassName="border-l-emerald-500" />
        <StatCard label="Failed Today" value={stats.failedToday} to="/runs?status=failed" accentClassName="border-l-red-500" />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Requires Attention</h2>
          <Link to="/approvals" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            View queue
          </Link>
        </div>

        {attentionItems.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-slate-500">Nothing urgent right now.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {attentionItems.map((item) => (
              <Link key={item.id} to={item.href} className="block">
                <Card className={`p-4 transition-colors hover:border-slate-300 ${item.kind === "approval" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{item.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Badge status={item.status} />
                      <span className="text-xs text-slate-500">{formatRelativeTime(item.createdAt)}</span>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Recent Runs</h2>
          <Link to="/runs" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            View all runs
          </Link>
        </div>

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
                {recentRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/runs/${run.id}`} className="font-medium text-slate-900 hover:text-blue-600">
                        {getRunPlaybookName(run)}
                      </Link>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">{run.id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
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
      </section>
    </div>
  )
}
