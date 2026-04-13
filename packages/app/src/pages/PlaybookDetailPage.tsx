import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "../api"

export function PlaybookDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [playbook, setPlaybook] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!id) return
    api.playbooks
      .get(id)
      .then(setPlaybook)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleStartRun = async () => {
    if (!playbook || !playbook.harnessId) return
    setStarting(true)
    try {
      const run = await api.runs.create({
        playbookId: playbook.id,
        harnessId: playbook.harnessId,
        inputs: {},
      })
      navigate(`/runs/${run.id}`)
    } catch (e: any) {
      setError(e.message)
      setStarting(false)
    }
  }

  if (loading) return <p className="text-gray-500">Loading...</p>
  if (error) return <p className="text-red-600">Error: {error}</p>
  if (!playbook) return <p className="text-gray-500">Playbook not found.</p>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">{playbook.name}</h2>
          {playbook.description && (
            <p className="text-sm text-gray-500 mt-1">{playbook.description}</p>
          )}
        </div>
        {playbook.harnessId && (
          <button
            onClick={handleStartRun}
            disabled={starting}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {starting ? "Starting..." : "Start Run"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Business section */}
        <section className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Task Intent
          </h3>
          {playbook.goal && (
            <div className="mb-3">
              <dt className="text-xs font-medium text-gray-500">Goal</dt>
              <dd className="text-sm text-gray-900 mt-0.5">{playbook.goal}</dd>
            </div>
          )}
          {playbook.instructions && (
            <div className="mb-3">
              <dt className="text-xs font-medium text-gray-500">Instructions</dt>
              <dd className="text-sm text-gray-900 mt-0.5 whitespace-pre-wrap">
                {playbook.instructions}
              </dd>
            </div>
          )}
          {playbook.inputs && playbook.inputs.length > 0 && (
            <div className="mb-3">
              <dt className="text-xs font-medium text-gray-500">Inputs</dt>
              <dd className="mt-1 space-y-1">
                {playbook.inputs.map((input: any, i: number) => (
                  <div key={i} className="text-sm">
                    <span className="font-mono text-xs bg-gray-100 px-1 rounded">
                      {input.name}
                    </span>
                    <span className="text-gray-500 ml-1">({input.type})</span>
                    {input.required && <span className="text-red-500 ml-1">*</span>}
                    {input.description && (
                      <span className="text-gray-500 ml-2">— {input.description}</span>
                    )}
                  </div>
                ))}
              </dd>
            </div>
          )}
          {playbook.artifacts && playbook.artifacts.length > 0 && (
            <div className="mb-3">
              <dt className="text-xs font-medium text-gray-500">Expected Artifacts</dt>
              <dd className="mt-1 space-y-1">
                {playbook.artifacts.map((a: any, i: number) => (
                  <div key={i} className="text-sm text-gray-900">
                    {a.type}
                    {a.format && <span className="text-gray-500 ml-1">({a.format})</span>}
                  </div>
                ))}
              </dd>
            </div>
          )}
          {playbook.quality_bar && (
            <div>
              <dt className="text-xs font-medium text-gray-500">Quality Bar</dt>
              <dd className="text-sm text-gray-900 mt-0.5">{playbook.quality_bar}</dd>
            </div>
          )}
        </section>

        {/* Harness section */}
        {playbook.harness && (
          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Governance Harness
            </h3>
            <div className="mb-3">
              <dt className="text-xs font-medium text-gray-500">Name</dt>
              <dd className="text-sm text-gray-900 mt-0.5">{playbook.harness.name}</dd>
            </div>
            {playbook.harness.description && (
              <div className="mb-3">
                <dt className="text-xs font-medium text-gray-500">Description</dt>
                <dd className="text-sm text-gray-900 mt-0.5">{playbook.harness.description}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium text-gray-500">Phases</dt>
              <dd className="flex gap-2 mt-1">
                {playbook.harness.phases.map((phase: string, i: number) => (
                  <span
                    key={i}
                    className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded"
                  >
                    {phase}
                  </span>
                ))}
              </dd>
            </div>
          </section>
        )}

        {!playbook.harnessId && (
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            No harness attached. Attach a harness to start runs from this playbook.
          </p>
        )}
      </div>
    </div>
  )
}
