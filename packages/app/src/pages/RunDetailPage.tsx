import { useEffect, useState, useCallback } from "react"
import { useParams } from "react-router-dom"
import { api } from "../api"
import { StatusBadge } from "../components/StatusBadge"

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<any>(null)
  const [playbook, setPlaybook] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const result = await api.runs.get(id)
      setData(result)
      if (result.run?.playbook) {
        const pb = await api.playbooks.get(result.run.playbook).catch(() => null)
        setPlaybook(pb)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const handleApproval = async (approvalId: string, decision: "approved" | "denied") => {
    try {
      await api.approvals.resolve(approvalId, { decision })
      load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (loading) return <p className="text-gray-500">Loading...</p>
  if (error) return <p className="text-red-600">Error: {error}</p>
  if (!data) return <p className="text-gray-500">Run not found.</p>

  const { run, events, approvals, artifacts, sessions } = data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <StatusBadge status={run.status} />
        <h2 className="text-xl font-semibold font-mono">{run.id.slice(0, 8)}</h2>
        {run.current_phase && (
          <span className="text-sm text-gray-500">
            Phase: <span className="font-medium text-gray-700">{run.current_phase}</span>
          </span>
        )}
      </div>

      {/* Business Section */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Business
        </h3>
        {playbook ? (
          <div className="space-y-2">
            <div>
              <dt className="text-xs font-medium text-gray-500">Playbook</dt>
              <dd className="text-sm text-gray-900">{playbook.name}</dd>
            </div>
            {playbook.goal && (
              <div>
                <dt className="text-xs font-medium text-gray-500">Goal</dt>
                <dd className="text-sm text-gray-900">{playbook.goal}</dd>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Playbook: {run.playbook}</p>
        )}
        {run.input && Object.keys(run.input).length > 0 && (
          <div className="mt-3">
            <dt className="text-xs font-medium text-gray-500">Inputs</dt>
            <dd className="mt-1">
              <pre className="text-xs bg-gray-50 rounded p-2 overflow-x-auto">
                {JSON.stringify(run.input, null, 2)}
              </pre>
            </dd>
          </div>
        )}
      </section>

      {/* Governance Section */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Governance
        </h3>

        {run.failureReason && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded p-3">
            <p className="text-sm text-red-700">
              <span className="font-medium">Failure:</span> {run.failureReason}
            </p>
          </div>
        )}

        {run.blockerReason && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded p-3">
            <p className="text-sm text-amber-700">
              <span className="font-medium">Blocked:</span> {run.blockerReason}
            </p>
          </div>
        )}

        {/* Approvals */}
        {approvals && approvals.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-medium text-gray-500 mb-2">Approvals</h4>
            <div className="space-y-2">
              {approvals.map((a: any) => (
                <div key={a.id} className="border border-gray-200 rounded p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{a.title}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    {a.status === "pending" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproval(a.id, "approved")}
                          className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleApproval(a.id, "denied")}
                          className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                        >
                          Deny
                        </button>
                      </div>
                    )}
                  </div>
                  {a.context && (
                    <p className="text-xs text-gray-500 mt-1">{JSON.stringify(a.context)}</p>
                  )}
                  {a.resolution && (
                    <p className="text-xs text-gray-500 mt-1">
                      Resolved: {a.resolution.decision} by {a.resolution.resolved_by}
                      {a.resolution.note && ` — ${a.resolution.note}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Artifacts */}
        {artifacts && artifacts.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-2">Artifacts</h4>
            <div className="space-y-2">
              {artifacts.map((a: any) => (
                <div
                  key={a.id}
                  className="border border-gray-200 rounded p-3 flex items-center justify-between"
                >
                  <div>
                    <span className="text-sm font-medium">{a.title ?? a.type}</span>
                    <span className="text-xs text-gray-500 ml-2">{a.type}</span>
                    {a.format && <span className="text-xs text-gray-400 ml-1">({a.format})</span>}
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        {(!approvals || approvals.length === 0) && (!artifacts || artifacts.length === 0) && (
          <p className="text-sm text-gray-400">No approvals or artifacts yet.</p>
        )}
      </section>

      {/* Operator / Debug Section */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Operator
        </h3>

        {/* Team summary */}
        {run.resolved_team && (
          <div className="mb-4">
            <h4 className="text-xs font-medium text-gray-500 mb-2">Team</h4>
            <div className="border border-gray-200 rounded p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">{run.resolved_team.name}</span>
                {run.resolved_team.lead_role && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    Lead: {run.resolved_team.lead_role}
                  </span>
                )}
              </div>
              {run.resolved_team.description && (
                <p className="text-xs text-gray-500">{run.resolved_team.description}</p>
              )}
              {run.resolved_team.roles?.length > 0 && (
                <div className="flex gap-1.5 mt-2">
                  {run.resolved_team.roles.map((role: string) => (
                    <span
                      key={role}
                      className={`text-xs px-2 py-0.5 rounded ${
                        role === run.resolved_team.lead_role
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {role}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sessions grouped by role */}
        {sessions && sessions.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-medium text-gray-500 mb-2">Sessions</h4>
            <div className="space-y-1">
              {sessions.map((s: any) => (
                <div key={s.id} className="text-xs flex items-center gap-2">
                  <StatusBadge status={s.status} />
                  {s.role_id && (
                    <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-xs">
                      {s.role_id}
                    </span>
                  )}
                  <span className="font-mono text-gray-500">{s.session_id ?? s.id.slice(0, 8)}</span>
                  {s.provider && <span className="text-gray-400">{s.provider}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Event timeline */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 mb-2">Event Timeline</h4>
          {events && events.length > 0 ? (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {events.map((e: any, i: number) => (
                <div
                  key={e.id ?? i}
                  className={`text-xs flex items-start gap-2 py-1 ${
                    e.eventType?.startsWith("handoff.")
                      ? "bg-purple-50 rounded px-1 -mx-1"
                      : ""
                  }`}
                >
                  <span className="text-gray-400 whitespace-nowrap font-mono">
                    {new Date(e.occurredAt).toLocaleTimeString()}
                  </span>
                  <span className="font-medium text-gray-700">{e.eventType}</span>
                  {e.phase && <span className="text-gray-500">[{e.phase}]</span>}
                  {e.roleId && <span className="text-purple-600">{e.roleId}</span>}
                  {(e.payload?.fromRole || e.payload?.from_role) &&
                    (e.payload?.toRole || e.payload?.to_role) && (
                    <span className="text-purple-500">
                      {e.payload.fromRole ?? e.payload.from_role} → {e.payload.toRole ?? e.payload.to_role}
                    </span>
                  )}
                  <span className="text-gray-400">{e.source}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No events yet.</p>
          )}
        </div>
      </section>
    </div>
  )
}
