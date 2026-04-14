import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { api } from "../api"
import { StatusBadge } from "../components/StatusBadge"

type ApprovalFilter = "all" | "pending" | "approved" | "denied" | "expired" | "canceled"

interface ApprovalQueueItem {
  id: string
  action_class: string
  title: string
  status: string
  createdAt: string
  context?: {
    phase?: string
    reason?: string
    stage_id?: string
  }
  resolution?: {
    decision: string
    resolved_by: string
    note?: string
  } | null
  run: {
    id: string
    status: string
    current_phase?: string | null
  } | null
  playbook: {
    id: string
    name: string
  } | null
}

const FILTERS: Array<{ value: ApprovalFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "all", label: "All statuses" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "expired", label: "Expired" },
  { value: "canceled", label: "Canceled" },
]

export function ApprovalsPage() {
  const [filter, setFilter] = useState<ApprovalFilter>("pending")
  const [approvals, setApprovals] = useState<ApprovalQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await api.approvals.list(filter === "all" ? undefined : filter)
        if (!canceled) {
          setApprovals(data)
        }
      } catch (e: any) {
        if (!canceled) {
          setError(e.message)
        }
      } finally {
        if (!canceled) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      canceled = true
    }
  }, [filter])

  const handleResolution = async (approvalId: string, decision: "approved" | "denied") => {
    try {
      setResolvingId(approvalId)
      setError(null)
      await api.approvals.resolve(approvalId, { decision, resolvedBy: "operator" })
      const data = await api.approvals.list(filter === "all" ? undefined : filter)
      setApprovals(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Approvals</h2>
          <p className="mt-1 text-sm text-gray-500">
            Review pending approval requests across runs and jump straight to the affected run.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Status
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as ApprovalFilter)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            {FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="text-gray-500">Loading approvals...</p> : null}
      {error ? <p className="text-red-600">Error: {error}</p> : null}

      {!loading && !error && approvals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
          No approvals match this filter.
        </div>
      ) : null}

      {!loading && !error && approvals.length > 0 ? (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <div key={approval.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{approval.title}</span>
                    <StatusBadge status={approval.status} />
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {approval.action_class}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    {approval.playbook ? (
                      <Link
                        to={`/playbooks/${approval.playbook.id}`}
                        className="font-medium text-gray-700 hover:text-gray-900"
                      >
                        {approval.playbook.name}
                      </Link>
                    ) : null}
                    {approval.run ? (
                      <Link
                        to={`/runs/${approval.run.id}`}
                        className="font-mono text-gray-700 hover:text-gray-900"
                      >
                        Run {approval.run.id.slice(0, 8)}
                      </Link>
                    ) : null}
                    {approval.run ? <StatusBadge status={approval.run.status} /> : null}
                    {approval.run?.current_phase ? <span>Phase: {approval.run.current_phase}</span> : null}
                  </div>

                  {approval.context?.reason ? (
                    <p className="text-sm text-gray-600">{approval.context.reason}</p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                    <span>Requested {new Date(approval.createdAt).toLocaleString()}</span>
                    {approval.context?.phase ? <span>Context phase: {approval.context.phase}</span> : null}
                    {approval.context?.stage_id ? <span>Stage: {approval.context.stage_id}</span> : null}
                  </div>

                  {approval.resolution ? (
                    <p className="text-xs text-gray-500">
                      Resolved: {approval.resolution.decision} by {approval.resolution.resolved_by}
                      {approval.resolution.note ? ` - ${approval.resolution.note}` : ""}
                    </p>
                  ) : null}
                </div>

                {approval.status === "pending" ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => handleResolution(approval.id, "approved")}
                      disabled={resolvingId === approval.id}
                      className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolution(approval.id, "denied")}
                      disabled={resolvingId === approval.id}
                      className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Deny
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
