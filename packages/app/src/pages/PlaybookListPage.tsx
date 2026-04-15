import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { api, type HarnessSummary, type PlaybookRecord } from "../api"
import { Button } from "../components/Button"
import { Card } from "../components/Card"
import { EmptyState } from "../components/EmptyState"
import { Input } from "../components/Input"
import { usePageChrome } from "../components/Layout"
import { Skeleton } from "../components/Skeleton"

type PlaybookListItem = PlaybookRecord

function getHarnesses(playbook: PlaybookListItem) {
  if (Array.isArray(playbook.harnesses) && playbook.harnesses.length > 0) {
    return playbook.harnesses
  }

  return playbook.harness ? [playbook.harness] : []
}

function PlaybookCardSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton width="w-2/3" height="h-5" />
      <Skeleton width="w-full" height="h-4" className="mt-3" />
      <Skeleton width="w-5/6" height="h-4" className="mt-2" />
      <div className="mt-4 flex gap-3">
        <Skeleton width="w-20" height="h-4" />
        <Skeleton width="w-16" height="h-4" />
      </div>
    </Card>
  )
}

function getHarnessCount(playbook: PlaybookListItem) {
  if (typeof playbook.harness_count === "number") {
    return playbook.harness_count
  }

  if (Array.isArray(playbook.harnesses)) {
    return playbook.harnesses.length
  }

  return playbook.harness ? 1 : 0
}

export function PlaybookListPage() {
  const navigate = useNavigate()
  const [playbooks, setPlaybooks] = useState<PlaybookListItem[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPlaybooks = useCallback(async () => {
    try {
      const data = await api.playbooks.list()
      setPlaybooks(data)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load playbooks")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlaybooks()
  }, [loadPlaybooks])

  usePageChrome({
    breadcrumbs: [{ label: "Playbooks" }],
    actions: (
      <Link to="/playbooks/new">
        <Button>New Playbook</Button>
      </Link>
    ),
  })

  const filteredPlaybooks = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return playbooks
    }

    return playbooks.filter((playbook) => {
      const harnessNames = getHarnesses(playbook)
        .map((harness) => harness.name)
        .join(" ")
      const haystack = [playbook.name, playbook.description, playbook.goal, harnessNames]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [playbooks, search])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Playbooks</h1>
            <p className="mt-1 text-sm text-slate-600">Reusable task intent templates for governed runs.</p>
          </div>
          <Button disabled>New Playbook</Button>
        </div>

        <Skeleton width="w-full max-w-md" height="h-10" />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <PlaybookCardSkeleton key={index} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-700">Failed to load playbooks</p>
        <p className="mt-1 text-sm text-red-600">{error}</p>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void loadPlaybooks()}>
            Retry
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Playbooks</h1>
        <p className="mt-1 text-sm text-slate-600">Task intent, expected outputs, and governance-ready starting points.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full max-w-md">
          <Input
            placeholder="Search playbooks"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <p className="text-sm text-slate-500">
          {filteredPlaybooks.length} playbook{filteredPlaybooks.length === 1 ? "" : "s"}
        </p>
      </div>

      {playbooks.length === 0 ? (
        <EmptyState
          title="No playbooks yet"
          description="Create the first playbook to define reusable task intent and launch governed runs."
          action={{ label: "New Playbook", onClick: () => navigate("/playbooks/new") }}
        />
      ) : null}

      {playbooks.length > 0 && filteredPlaybooks.length === 0 ? (
        <EmptyState
          title="No matching playbooks"
          description="Try a different search term or clear the current filter."
          action={{ label: "Clear search", onClick: () => setSearch("") }}
        />
      ) : null}

      {filteredPlaybooks.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredPlaybooks.map((playbook) => (
            <Link key={playbook.id} to={`/playbooks/${playbook.id}`} className="block">
              <Card variant="interactive" className="h-full p-5">
                <div className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-slate-900">{playbook.name}</h2>
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-600">
                        {playbook.description ?? playbook.goal ?? "No description yet."}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {playbook.run_count ?? 0} runs
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {getHarnesses(playbook).length > 0 ? (
                      getHarnesses(playbook).slice(0, 2).map((harness) => (
                        <span
                          key={harness.id}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                        >
                          {harness.name}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">
                        No harness attached
                      </span>
                    )}
                    {getHarnesses(playbook).length > 2 ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">
                        +{getHarnesses(playbook).length - 2} more
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500">
                    <span>{getHarnessCount(playbook)} harnesses</span>
                    <span className="font-medium text-slate-700">Open playbook →</span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
