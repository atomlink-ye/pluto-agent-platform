import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { api, type HarnessSummary, type PlaybookRecord, type RunRecord } from "../api"
import { Button } from "../components/Button"
import { Card } from "../components/Card"
import { EmptyState } from "../components/EmptyState"
import { usePageChrome } from "../components/Layout"
import { Skeleton } from "../components/Skeleton"
import { StatusBadge } from "../components/StatusBadge"
import { StartRunModal } from "./StartRunModal"

interface InputSpec {
  name: string
  type?: string
  required?: boolean
  description?: string
}

interface ArtifactExpectation {
  type: string
  format?: string
  description?: string
}

function normalizeInputs(inputs?: InputSpec[] | Record<string, unknown>): InputSpec[] {
  if (!inputs) {
    return []
  }

  if (Array.isArray(inputs)) {
    return inputs
  }

  return Object.entries(inputs).map(([name, description]) => ({
    name,
    type: "string",
    description: typeof description === "string" ? description : undefined,
    required: false,
  }))
}

function normalizeQualityBar(value?: string[] | string) {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function normalizeArtifacts(value?: ArtifactExpectation[] | string) {
  if (!value) {
    return []
  }

  if (typeof value === "string") {
    return [{ type: value }]
  }

  return value
}

function PlaybookDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton width="w-64" height="h-8" />
          <Skeleton width="w-96" height="h-4" />
        </div>
        <div className="flex gap-2">
          <Skeleton width="w-24" height="h-10" />
          <Skeleton width="w-24" height="h-10" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <Skeleton width="w-40" height="h-5" />
          <div className="mt-4 space-y-4">
            <Skeleton width="w-full" height="h-20" />
            <Skeleton width="w-full" height="h-20" />
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="p-6">
            <Skeleton width="w-32" height="h-5" />
            <Skeleton width="w-full" height="h-24" className="mt-4" />
          </Card>
          <Card className="p-6">
            <Skeleton width="w-40" height="h-5" />
            <Skeleton width="w-full" height="h-20" className="mt-4" />
          </Card>
        </div>
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">{value}</pre>
    </div>
  )
}

export function PlaybookDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [playbook, setPlaybook] = useState<PlaybookRecord | null>(null)
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showStartRun, setShowStartRun] = useState(false)

  const loadPlaybook = useCallback(async () => {
    if (!id) {
      setError("Missing playbook id")
      setLoading(false)
      return
    }

    try {
      const [playbookData, runData] = await Promise.all([
        api.playbooks.get(id),
        api.runs.list(),
      ])

      let nextPlaybook = playbookData
      if (!nextPlaybook.harness && nextPlaybook.harnessId) {
        try {
          const harness = await api.harnesses.get(nextPlaybook.harnessId)
          nextPlaybook = { ...nextPlaybook, harness }
        } catch {
          nextPlaybook = { ...nextPlaybook }
        }
      }

      setPlaybook(nextPlaybook)
      setRuns(runData)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load playbook")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadPlaybook()
  }, [loadPlaybook])

  usePageChrome({
    breadcrumbs: playbook
      ? [
          { label: "Playbooks", href: "/playbooks" },
          { label: playbook.name },
        ]
      : [{ label: "Playbooks", href: "/playbooks" }, { label: "Details" }],
    actions: playbook ? (
      <>
        <Button variant="secondary" onClick={() => navigate(`/playbooks/${playbook.id}/edit`)}>
          Edit
        </Button>
        <Button onClick={() => setShowStartRun(true)}>Start Run</Button>
      </>
    ) : null,
  })

  const inputSpecs = useMemo(() => normalizeInputs(playbook?.inputs), [playbook?.inputs])
  const qualityBar = useMemo(() => normalizeQualityBar(playbook?.quality_bar), [playbook?.quality_bar])
  const artifacts = useMemo(() => normalizeArtifacts(playbook?.artifacts), [playbook?.artifacts])

  const attachedHarnesses = useMemo(() => {
    if (!playbook) {
      return []
    }

    if (Array.isArray(playbook.harnesses) && playbook.harnesses.length > 0) {
      return playbook.harnesses
    }

    return playbook.harness ? [playbook.harness] : []
  }, [playbook])

  const recentRuns = useMemo(() => {
    if (!playbook) {
      return []
    }

      return runs
      .filter((run) => {
        const runPlaybook = run.playbook
        const runPlaybookName = run.playbookName ?? run.playbook_name
        return runPlaybook === playbook.id || runPlaybookName === playbook.name
      })
      .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime())
      .slice(0, 5)
  }, [playbook, runs])

  if (loading) {
    return <PlaybookDetailSkeleton />
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-700">Failed to load playbook</p>
        <p className="mt-1 text-sm text-red-600">{error}</p>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void loadPlaybook()}>
            Retry
          </Button>
        </div>
      </Card>
    )
  }

  if (!playbook) {
    return <EmptyState title="Playbook not found" description="The requested playbook could not be loaded." />
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{playbook.name}</h1>
        <p className="mt-1 text-sm text-slate-600">{playbook.description ?? "No description provided."}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-800">Task Intent</h2>
            <div className="mt-4 space-y-4">
              <DetailField label="Goal" value={playbook.goal ?? "No goal provided."} />
              <DetailField label="Instructions" value={playbook.instructions ?? "No instructions provided."} />
              <DetailField
                label="Expected Artifacts"
                value={
                  artifacts.length > 0
                    ? artifacts
                        .map((artifact) => artifact.description ?? artifact.type)
                        .join("\n")
                    : "No expected artifacts defined."
                }
              />
              <DetailField
                label="Quality Bar"
                value={qualityBar.length > 0 ? qualityBar.join("\n") : "No quality bar defined."}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-800">Input Schema</h2>
            <div className="mt-4 space-y-3">
              {inputSpecs.length === 0 ? (
                <p className="text-sm text-slate-500">No inputs required.</p>
              ) : (
                inputSpecs.map((input) => (
                  <div key={input.name} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-sm text-slate-900">{input.name}</p>
                      <span className="text-xs text-slate-500">{input.type ?? "string"}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{input.description ?? "No description provided."}</p>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-800">Attached Harnesses</h2>
            <div className="mt-4 space-y-3">
              {attachedHarnesses.length === 0 ? (
                <p className="text-sm text-slate-500">No harnesses attached.</p>
              ) : (
                attachedHarnesses.map((harness) => (
                  <div key={harness.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-medium text-slate-900">{harness.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{harness.description ?? "No description provided."}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {Array.isArray(harness.phases) && harness.phases.length > 0
                        ? `${harness.phases.length} phases`
                        : "Phases unavailable"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800">Recent Runs</h2>

        {recentRuns.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-slate-500">No runs yet for this playbook.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Run</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Phase</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {recentRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link to={`/runs/${run.id}`} className="font-mono text-sm text-slate-900 hover:text-blue-600">
                          {run.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">{run.current_phase ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <StartRunModal open={showStartRun} onClose={() => setShowStartRun(false)} playbook={playbook} />
    </div>
  )
}
