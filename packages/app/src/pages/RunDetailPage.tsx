import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { api, type RunDetailResponse, type RunRecord } from "../api"
import { Badge } from "../components/Badge"
import { Button } from "../components/Button"
import { Card } from "../components/Card"
import { ChatSession } from "../components/ChatSession"
import { EmptyState } from "../components/EmptyState"
import { EventTimeline } from "../components/EventTimeline"
import { usePageChrome } from "../components/Layout"
import { Skeleton } from "../components/Skeleton"
import { TeamActivityFeed } from "../components/TeamActivityFeed"
import { usePolling } from "../hooks/usePolling"
import { useTeamActivity } from "../hooks/useTeamActivity"
import { useToast } from "../hooks/useToast"

function getSessionAgentId(session: { session_id?: string; id: string }) {
  return session.session_id ?? session.id
}

function getSessionAgentLabel(session: { provider?: string; role_id?: string; session_id?: string; id: string }, index: number) {
  return (session.role_id ?? session.provider ?? getSessionAgentId(session)) || `Agent ${index + 1}`
}

function getRunName(run: RunRecord) {
  return run.playbookName ?? run.playbook_name ?? run.playbook ?? "Unknown playbook"
}

function getHarnessName(run: RunRecord) {
  return run.harnessDetail?.name ?? run.harnessName ?? run.harness_name ?? run.harness ?? "Unknown harness"
}

function normalizeQualityBar(value?: string[] | string) {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function formatDateTime(value?: string) {
  if (!value) {
    return "—"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
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

function isTerminalStatus(status: RunRecord["status"]) {
  return ["failed", "succeeded", "canceled", "archived"].includes(status)
}

function RunDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton width="w-64" height="h-8" />
          <Skeleton width="w-56" height="h-4" />
        </div>
        <Skeleton width="w-28" height="h-10" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="p-6">
              <Skeleton width="w-40" height="h-5" />
              <Skeleton width="w-full" height="h-20" className="mt-4" />
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index} className="p-6">
              <Skeleton width="w-32" height="h-5" />
              <Skeleton width="w-full" height="h-24" className="mt-4" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

function PhaseProgress({ currentPhase, phases }: { currentPhase?: string | null; phases: string[] }) {
  if (phases.length === 0) {
    return <p className="text-sm text-slate-500">Current phase: {currentPhase ?? "Unavailable"}</p>
  }

  const currentIndex = currentPhase ? phases.findIndex((phase) => phase === currentPhase) : -1

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Current phase: <span className="font-medium text-slate-900">{currentPhase ?? "Unavailable"}</span>
      </p>
      <div className="flex items-start gap-0 overflow-x-auto pb-2">
        {phases.map((phase, index) => {
          const state =
            currentIndex === -1
              ? "pending"
              : index < currentIndex
                ? "completed"
                : index === currentIndex
                  ? "active"
                  : "pending"

          return (
            <div key={phase} className="flex items-start">
              <div className="flex min-w-[140px] flex-col items-center">
                <div
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
                    state === "completed"
                      ? "bg-emerald-100 text-emerald-700"
                      : state === "active"
                        ? "bg-blue-100 text-blue-700 ring-2 ring-blue-400 ring-offset-2"
                        : "bg-slate-100 text-slate-400",
                  ].join(" ")}
                >
                  {state === "completed" ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <p className={[
                  "mt-2 text-center text-xs font-medium",
                  state === "completed"
                    ? "text-emerald-700"
                    : state === "active"
                      ? "text-blue-700"
                      : "text-slate-500",
                ].join(" ")}>
                  {phase}
                </p>
              </div>
              {index < phases.length - 1 ? (
                <div
                  className={[
                    "mt-3.5 h-0.5 w-8 shrink-0",
                    index < currentIndex ? "bg-emerald-300" : "bg-slate-200",
                  ].join(" ")}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [detail, setDetail] = useState<RunDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRawEvents, setShowRawEvents] = useState(false)
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null)

  const loadRun = useCallback(async () => {
    if (!id) {
      setError("Missing run id")
      setLoading(false)
      return false
    }

    try {
      const data = await api.runs.get(id)

      if (!data.run.playbookName && !data.run.playbook_name) {
        try {
          const playbook = await api.playbooks.get(data.run.playbook)
          data.run = { ...data.run, playbookName: playbook.name }
        } catch {
          // keep the id fallback from the run payload
        }
      }

      if (data.run.harness) {
        try {
          const harnessDetail = await api.harnesses.get(data.run.harness)
          data.run = { ...data.run, harnessDetail }
        } catch {
          data.run = { ...data.run, harnessDetail: null }
        }
      }

      setDetail(data)
      setError(null)
      return true
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load run")
      return false
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadRun()
  }, [loadRun])

  const run = detail?.run ?? null

  const handleRefresh = useCallback(async () => {
    const ok = await loadRun()
    if (ok) {
      toast.success("Run refreshed")
      return
    }

    toast.error("Failed to refresh run")
  }, [loadRun, toast])

  usePageChrome({
    breadcrumbs: [{ label: "Runs", href: "/runs" }, { label: run?.id ?? "Run detail" }],
    actions: (
      <Button variant="secondary" onClick={() => void handleRefresh()}>
        Refresh
      </Button>
    ),
  })

  usePolling(() => {
    void loadRun()
  }, 5000, Boolean(run && !isTerminalStatus(run.status)))

  const pendingApprovals = useMemo(
    () => detail?.approvals.filter((approval) => approval.status === "pending") ?? [],
    [detail?.approvals],
  )
  const resolvedApprovals = useMemo(
    () => detail?.approvals.filter((approval) => approval.status !== "pending") ?? [],
    [detail?.approvals],
  )
  const blockers = useMemo(() => {
    if (!run) {
      return []
    }

    return [...(run.blockers ?? []), ...(run.blockerReason ? [run.blockerReason] : [])]
  }, [run])
  const phases = useMemo(() => run?.harnessDetail?.phases ?? [], [run?.harnessDetail?.phases])
  const qualityBar = useMemo(
    () => normalizeQualityBar(run?.quality_bar ?? run?.harnessDetail?.quality_bar),
    [run?.harnessDetail?.quality_bar, run?.quality_bar],
  )
  const runName = useMemo(() => (run ? getRunName(run) : "Run detail"), [run])

  const defaultAgentId = useMemo(() => {
    const preferredSession =
      detail?.sessions?.find((session) => session.status === "running") ??
      detail?.sessions?.find((session) => session.status === "active") ??
      detail?.sessions?.[0]

    if (preferredSession) {
      return getSessionAgentId(preferredSession)
    }

    return run?.id ?? "default"
  }, [detail?.sessions, run?.id])
  const defaultAgentLabel = useMemo(() => {
    const defaultSession = detail?.sessions?.find((session) => getSessionAgentId(session) === defaultAgentId)

    if (!defaultSession) {
      return defaultAgentId
    }

    return getSessionAgentLabel(defaultSession, detail?.sessions?.findIndex((session) => session.id === defaultSession.id) ?? 0)
  }, [defaultAgentId, detail?.sessions])

  const navigateToChat = useCallback(
    (agentId: string, agentLabel?: string) => {
      navigate(`/runs/${run?.id ?? id}/agents/${agentId}/chat`, {
        state: {
          agentLabel,
          runName,
        },
      })
    },
    [id, navigate, run?.id, runName],
  )

  const teamActivity = useTeamActivity({
    runId: run?.id ?? "",
    resolvedTeam: run?.harnessDetail
      ? {
          roles: run.harnessDetail.phases?.length
            ? detail?.sessions?.map((session, i) => ({
                  id: session.role_id ?? session.id,
                  name: getSessionAgentLabel(session, i),
                  agentId: getSessionAgentId(session),
                }))
            : undefined,
          coordination: undefined,
        }
      : null,
  })

  const handleResolveApproval = async (approvalId: string, decision: "approved" | "denied") => {
    if (!detail) {
      return
    }

    const previousApprovals = detail.approvals
    setResolvingApprovalId(approvalId)
    setDetail({
      ...detail,
      approvals: detail.approvals.map((approval) =>
        approval.id === approvalId
          ? {
              ...approval,
              status: decision,
            }
          : approval,
      ),
    })

    try {
      await api.approvals.resolve(approvalId, { decision })
      toast.success("Approval resolved")
      await loadRun()
    } catch (resolveError) {
      setDetail({ ...detail, approvals: previousApprovals })
      toast.error(
        "Failed to resolve approval",
        resolveError instanceof Error ? resolveError.message : "Unknown error",
      )
    } finally {
      setResolvingApprovalId(null)
    }
  }

  if (loading) {
    return <RunDetailSkeleton />
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-red-700">Failed to load run</p>
            <p className="mt-1 text-sm text-red-600">{error}</p>
          </div>
          <Button variant="secondary" onClick={() => void loadRun()}>
            Retry
          </Button>
        </div>
      </Card>
    )
  }

  if (!detail || !run) {
    return <EmptyState title="Run not found" description="The requested run could not be loaded." />
  }

  return (
    <div className="space-y-8">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{getRunName(run)}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm text-slate-500">{run.id}</span>
              <Badge status={run.status} />
              <span className="text-sm text-slate-500">Started {formatDateTime(run.startedAt ?? run.createdAt)}</span>
              <span className="text-sm text-slate-500">Duration {formatDuration(run)}</span>
            </div>
          </div>
        </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <Card className="p-6">
            <div className="mb-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Business</p>
              <h2 className="text-lg font-semibold text-slate-900">Current Phase</h2>
            </div>
            <PhaseProgress currentPhase={run.current_phase} phases={phases} />
          </Card>

          {blockers.length > 0 ? (
            <Card variant="highlighted" className="p-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-amber-500" />
                <div>
                  <h2 className="text-lg font-semibold text-amber-900">Blockers</h2>
                  <div className="mt-3 space-y-2">
                    {blockers.map((blocker, index) => (
                      <p key={`${blocker}-${index}`} className="text-sm text-amber-800">
                        {blocker}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">Provided Inputs</h2>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Show input payload</summary>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                {JSON.stringify(run.input ?? {}, null, 2)}
              </pre>
            </details>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">Outputs</h2>
            <div className="mt-4 space-y-3">
              {detail.artifacts.length === 0 ? (
                <p className="text-sm italic text-slate-400">No artifacts produced yet.</p>
              ) : (
                detail.artifacts.map((artifact) => (
                  <div key={artifact.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{artifact.title ?? artifact.type}</p>
                        <p className="mt-1 text-sm text-slate-600">{artifact.summary ?? artifact.format ?? artifact.type}</p>
                      </div>
                      {artifact.status ? <Badge status={artifact.status} /> : null}
                    </div>
                    {artifact.url ?? artifact.downloadUrl ? (
                      <a
                        href={artifact.url ?? artifact.downloadUrl}
                        className="mt-3 inline-flex text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        Open artifact
                      </a>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        </section>

        <aside className="space-y-4">
          <Card className="p-6">
            <div className="mb-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Governance</p>
              <h2 className="text-lg font-semibold text-slate-900">Harness</h2>
            </div>
            <p className="text-sm font-medium text-slate-900">{getHarnessName(run)}</p>
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Quality Bar</p>
              {qualityBar.length === 0 ? (
                <p className="text-sm italic text-slate-400">No quality bar attached.</p>
              ) : (
                qualityBar.map((item) => (
                  <p key={item} className="text-sm text-slate-700">
                    {item}
                  </p>
                ))
              )}
            </div>
          </Card>

          <Card variant="highlighted" className="p-6">
            <h2 className="text-lg font-semibold text-amber-900">Pending Approvals</h2>
            <div className="mt-4 space-y-3">
              {pendingApprovals.length === 0 ? (
                <p className="text-sm italic text-slate-400">No pending approvals.</p>
              ) : (
                pendingApprovals.map((approval) => (
                  <div key={approval.id} className="rounded-lg border border-amber-200 bg-white/70 p-4">
                    <p className="text-sm font-semibold text-amber-900">
                      {approval.title ?? approval.action_class.replace(/_/g, " ")}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      {approval.context?.reason ?? "No additional context provided."}
                    </p>
                    <div className="mt-4 flex gap-2">
                      <Button
                        size="sm"
                        loading={resolvingApprovalId === approval.id}
                        onClick={() => void handleResolveApproval(approval.id, "approved")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={resolvingApprovalId === approval.id}
                        onClick={() => void handleResolveApproval(approval.id, "denied")}
                      >
                        Deny
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">Resolved Approvals</h2>
            <div className="mt-4 space-y-3">
              {resolvedApprovals.length === 0 ? (
                <p className="text-sm italic text-slate-400">No resolved approvals yet.</p>
              ) : (
                resolvedApprovals.map((approval) => (
                  <div key={approval.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{approval.title ?? approval.action_class}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {approval.resolution?.resolved_by ? `Resolved by ${approval.resolution.resolved_by}` : "Resolved"}
                      </p>
                    </div>
                    <Badge status={approval.status} />
                  </div>
                ))
              )}
            </div>
          </Card>
        </aside>
      </div>

      <section className="space-y-4 rounded-2xl bg-slate-950 p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Operator / Debug</p>
          <h2 className="text-lg font-semibold text-white">Execution Detail</h2>
        </div>

        <TeamActivityFeed
          teamActivity={teamActivity}
          onOpenAgent={(agentId) => navigateToChat(agentId, teamActivity.agents.find((agent) => agent.id === agentId)?.name)}
          dark
        />

        <Card className="border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-medium text-slate-100">Event Timeline</h3>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-200 hover:bg-slate-800 hover:text-white"
              onClick={() => setShowRawEvents((current) => !current)}
            >
              {showRawEvents ? "Hide raw events" : "Show raw events"}
            </Button>
          </div>
          <div className="mt-4">
            <EventTimeline events={detail.events} showRaw={showRawEvents} dark />
          </div>
        </Card>

        <Card className="border-slate-800 bg-slate-900 p-6">
          <h3 className="text-base font-medium text-slate-100">Chat Session</h3>
          <div className="mt-4">
            <ChatSession
              agentId={defaultAgentId}
              runId={run.id}
              compact
              dark
              onExpand={() => navigateToChat(defaultAgentId, defaultAgentLabel)}
            />
          </div>
        </Card>

      </section>
    </div>
  )
}
