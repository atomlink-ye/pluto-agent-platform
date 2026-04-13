import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api"
import { StatusBadge } from "../components/StatusBadge"

export function RunListPage() {
  const [runs, setRuns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.runs
      .list()
      .then(setRuns)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-gray-500">Loading runs...</p>
  if (error) return <p className="text-red-600">Error: {error}</p>

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Runs</h2>

      {runs.length === 0 ? (
        <p className="text-gray-500">No runs yet. Start one from a playbook.</p>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <Link
              key={run.id}
              to={`/runs/${run.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusBadge status={run.status} />
                  <span className="text-sm font-mono text-gray-500">{run.id.slice(0, 8)}</span>
                </div>
                {run.current_phase && (
                  <span className="text-xs text-gray-500">
                    Phase: <span className="font-medium text-gray-700">{run.current_phase}</span>
                  </span>
                )}
              </div>

              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                <span>Playbook: {run.playbookName ?? run.playbook}</span>
                <span>Harness: {run.harnessName ?? run.harness}</span>
              </div>

              {run.failureReason && (
                <p className="mt-2 text-xs text-red-600">{run.failureReason}</p>
              )}
              {run.blockerReason && (
                <p className="mt-2 text-xs text-amber-600">{run.blockerReason}</p>
              )}

              <p className="text-xs text-gray-400 mt-2">
                Created {new Date(run.createdAt).toLocaleString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
