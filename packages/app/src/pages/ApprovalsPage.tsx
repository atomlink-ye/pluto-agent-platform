import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"

import { api, type ApprovalQueueRecord } from "../api"
import { Badge } from "../components/Badge"
import { Button } from "../components/Button"
import { Card } from "../components/Card"
import { EmptyState } from "../components/EmptyState"
import { usePageChrome } from "../components/Layout"
import { Skeleton } from "../components/Skeleton"
import { usePolling } from "../hooks/usePolling"
import { useToast } from "../hooks/useToast"

type ApprovalFilter = "pending" | "approved" | "denied" | "all"

const FILTER_TABS: Array<{ value: ApprovalFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "all", label: "All" },
]

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

function ApprovalTableSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-slate-200">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="grid grid-cols-5 gap-4 px-4 py-4">
            <Skeleton width="w-full" height="h-4" />
            <Skeleton width="w-24" height="h-4" />
            <Skeleton width="w-20" height="h-4" />
            <Skeleton width="w-full" height="h-4" />
            <Skeleton width="w-28" height="h-4" />
          </div>
        ))}
      </div>
    </Card>
  )
}

export function ApprovalsPage() {
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [approvals, setApprovals] = useState<ApprovalQueueRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const filter = (searchParams.get("status") as ApprovalFilter | null) ?? "pending"

  const loadApprovals = useCallback(async () => {
    try {
      const data = await api.approvals.list()
      setApprovals(data)
      setError(null)
      return true
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load approvals")
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadApprovals()
  }, [loadApprovals])

  usePolling(() => {
    void loadApprovals()
  }, 10000, filter === "pending" || approvals.some((approval) => approval.status === "pending"))

  const filteredApprovals = useMemo(() => {
    if (filter === "all") {
      return approvals
    }

    return approvals.filter((approval) => approval.status === filter)
  }, [approvals, filter])

  const counts = useMemo(() => {
    return FILTER_TABS.reduce<Record<ApprovalFilter, number>>(
      (accumulator, tab) => ({
        ...accumulator,
        [tab.value]: tab.value === "all" ? approvals.length : approvals.filter((approval) => approval.status === tab.value).length,
      }),
      { pending: 0, approved: 0, denied: 0, all: 0 },
    )
  }, [approvals])

  const pendingCount = counts.pending

  const handleRefresh = useCallback(async () => {
    const ok = await loadApprovals()
    if (ok) {
      toast.success("Approvals refreshed")
      return
    }

    toast.error("Failed to refresh approvals")
  }, [loadApprovals, toast])

  const { refreshPendingApprovals } = usePageChrome({
    breadcrumbs: [{ label: "Approvals" }],
    actions: (
      <Button variant="secondary" onClick={() => void handleRefresh()}>
        Refresh
      </Button>
    ),
  })

  const handleResolve = async (approvalId: string, decision: "approved" | "denied") => {
    const previousApprovals = approvals

    try {
      setResolvingId(approvalId)
      setApprovals((currentApprovals) =>
        currentApprovals.map((approval) =>
          approval.id === approvalId
            ? {
                ...approval,
                status: decision,
              }
            : approval,
        ),
      )
      await api.approvals.resolve(approvalId, { decision })
      await refreshPendingApprovals()
      toast.success("Approval resolved")
      await loadApprovals()
    } catch (resolveError) {
      setApprovals(previousApprovals)
      toast.error(
        "Failed to resolve approval",
        resolveError instanceof Error ? resolveError.message : "Unknown error",
      )
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Approvals</h1>
          {pendingCount > 0 ? <Badge status="pending_approval">{pendingCount} pending</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-slate-600">Resolve durable approval requests across runs.</p>
      </div>

      <div className="-mx-4 overflow-x-auto border-b border-slate-200 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex min-w-max gap-1">
          {FILTER_TABS.map((tab) => (
            <Button
              key={tab.value}
              className={[
                "rounded-none border-b-2 px-3 py-2.5",
                filter === tab.value
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
              ].join(" ")}
              variant="ghost"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams)
                nextParams.set("status", tab.value)
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

      {loading ? <ApprovalTableSkeleton /> : null}

      {!loading && error ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">Failed to load approvals</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => void handleRefresh()}>
              Retry
            </Button>
          </div>
        </Card>
      ) : null}

      {!loading && !error && filteredApprovals.length === 0 ? (
        <EmptyState
          title={filter === "pending" ? "All caught up" : "No approvals found"}
          description={
            filter === "pending"
              ? "There are no pending approvals waiting on operator action."
              : "No approvals match the current filter."
          }
        />
      ) : null}

      {!loading && !error && filteredApprovals.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Run / Playbook</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Requested</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Context</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredApprovals.map((approval) => (
                  <tr
                    key={approval.id}
                    className={approval.status === "pending" ? "bg-amber-50/70" : "hover:bg-slate-50"}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="space-y-1">
                        {approval.playbook ? (
                          <Link to={`/playbooks/${approval.playbook.id}`} className="font-medium text-slate-900 hover:text-blue-600">
                            {approval.playbook.name}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-900">Unknown playbook</span>
                        )}
                        {approval.run ? (
                          <Link to={`/runs/${approval.run.id}`} className="block font-mono text-xs text-slate-500 hover:text-blue-600">
                            {approval.run.id}
                          </Link>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="space-y-2">
                        <p className="text-sm text-slate-700">{approval.title ?? approval.action_class.replace(/_/g, " ")}</p>
                        <Badge status={approval.status} />
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-slate-600">{formatRelativeTime(approval.createdAt)}</td>
                    <td className="max-w-sm px-4 py-3 align-top text-slate-600">
                      <p className="line-clamp-3 text-sm">{approval.context?.reason ?? "No additional context provided."}</p>
                      {approval.context?.phase ? (
                        <p className="mt-1 text-xs text-slate-500">Phase: {approval.context.phase}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {approval.status === "pending" ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            loading={resolvingId === approval.id}
                            onClick={() => void handleResolve(approval.id, "approved")}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={resolvingId === approval.id}
                            onClick={() => void handleResolve(approval.id, "denied")}
                          >
                            Deny
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Badge status={approval.status} />
                          {approval.resolution?.resolved_by ? (
                            <p className="text-xs text-slate-500">by {approval.resolution.resolved_by}</p>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  )
}
