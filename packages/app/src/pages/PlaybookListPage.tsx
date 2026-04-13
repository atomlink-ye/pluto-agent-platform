import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api"

export function PlaybookListPage() {
  const [playbooks, setPlaybooks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.playbooks
      .list()
      .then(setPlaybooks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-gray-500">Loading playbooks...</p>
  if (error) return <p className="text-red-600">Error: {error}</p>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Playbooks</h2>
      </div>

      {playbooks.length === 0 ? (
        <p className="text-gray-500">No playbooks yet.</p>
      ) : (
        <div className="space-y-3">
          {playbooks.map((pb) => (
            <Link
              key={pb.id}
              to={`/playbooks/${pb.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">{pb.name}</h3>
                  {pb.description && (
                    <p className="text-sm text-gray-500 mt-1">{pb.description}</p>
                  )}
                </div>
                {pb.harness && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    {pb.harness.name}
                  </span>
                )}
              </div>
              {pb.goal && <p className="text-sm text-gray-600 mt-2">{pb.goal}</p>}
              <p className="text-xs text-gray-400 mt-2">
                Created {new Date(pb.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
