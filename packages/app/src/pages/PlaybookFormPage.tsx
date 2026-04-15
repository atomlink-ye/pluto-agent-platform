import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { api, type PlaybookRecord, type PlaybookUpsertInput } from "../api"
import { Button } from "../components/Button"
import { Card } from "../components/Card"
import { Input, Select, Textarea } from "../components/Input"
import { usePageChrome } from "../components/Layout"
import { Skeleton } from "../components/Skeleton"
import { useToast } from "../hooks/useToast"

interface ArtifactExpectation {
  type: string
  format?: string
  description?: string
}

interface InputSpec {
  name: string
  description?: string
  type?: string
  required?: boolean
}

type InputKind = "string" | "number" | "boolean" | "object" | "array"

interface InputRow {
  id: string
  key: string
  description: string
  type: InputKind
}

interface FormState {
  name: string
  description: string
  goal: string
  instructions: string
  expectedArtifacts: string
  qualityBar: string
}

interface FormErrors {
  name?: string
  goal?: string
}

function createInputRow(): InputRow {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    key: "",
    description: "",
    type: "string",
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeInputType(type?: string): InputKind {
  switch (type) {
    case "number":
    case "boolean":
    case "object":
    case "array":
      return type
    default:
      return "string"
  }
}

function normalizeInputRows(inputs?: InputSpec[] | Record<string, unknown>): InputRow[] {
  if (!inputs) {
    return []
  }

  if (Array.isArray(inputs)) {
    return inputs.map((input) => ({
      id: createInputRow().id,
      key: input.name,
      description: input.description ?? "",
      type: normalizeInputType(input.type),
    }))
  }

  return Object.entries(inputs).map(([key, value]) => ({
    id: createInputRow().id,
    key,
    description:
      typeof value === "string"
        ? value
        : isObject(value) && typeof value.description === "string"
          ? value.description
          : "",
    type: isObject(value) && typeof value.type === "string" ? normalizeInputType(value.type) : "string",
  }))
}

function artifactsToText(artifacts?: ArtifactExpectation[] | string) {
  if (!artifacts) {
    return ""
  }

  if (typeof artifacts === "string") {
    return artifacts
  }

  return artifacts.map((artifact) => artifact.description ?? artifact.type).join("\n")
}

function qualityBarToText(value?: string[] | string) {
  if (!value) {
    return ""
  }

  return Array.isArray(value) ? value.join("\n") : value
}

function PlaybookFormSkeleton() {
  return (
    <div className="max-w-3xl space-y-6">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index} className="p-6">
          <Skeleton width="w-40" height="h-5" />
          <div className="mt-4 space-y-4">
            <Skeleton width="w-full" height="h-10" />
            <Skeleton width="w-full" height="h-24" />
          </div>
        </Card>
      ))}
    </div>
  )
}

export function PlaybookFormPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { toast } = useToast()

  const isEdit = Boolean(id)
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    goal: "",
    instructions: "",
    expectedArtifacts: "",
    qualityBar: "",
  })
  const [inputRows, setInputRows] = useState<InputRow[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [loading, setLoading] = useState(isEdit)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const pageTitle = useMemo(() => (isEdit ? "Edit Playbook" : "New Playbook"), [isEdit])

  usePageChrome({
    breadcrumbs: isEdit
      ? [
          { label: "Playbooks", href: "/playbooks" },
          ...(id && form.name ? [{ label: form.name, href: `/playbooks/${id}` }] : []),
          { label: "Edit" },
        ]
      : [{ label: "Playbooks", href: "/playbooks" }, { label: "New Playbook" }],
  })

  const loadPlaybook = useCallback(async () => {
    if (!id) {
      return
    }

    try {
      const playbook: PlaybookRecord = await api.playbooks.get(id)
      setForm({
        name: playbook.name,
        description: playbook.description ?? "",
        goal: playbook.goal ?? "",
        instructions: playbook.instructions ?? "",
        expectedArtifacts: artifactsToText(playbook.artifacts),
        qualityBar: qualityBarToText(playbook.quality_bar),
      })
      setInputRows(normalizeInputRows(playbook.inputs))
      setErrorMessage(null)
    } catch (loadError) {
      setErrorMessage(loadError instanceof Error ? loadError.message : "Failed to load playbook")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadPlaybook()
  }, [loadPlaybook])

  const updateField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  const handleSubmit = async () => {
    const nextErrors: FormErrors = {}
    if (!form.name.trim()) {
      nextErrors.name = "Name is required"
    }
    if (!form.goal.trim()) {
      nextErrors.goal = "Goal is required"
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setSubmitting(true)
    setErrorMessage(null)

    try {
      const payload: PlaybookUpsertInput = {
        kind: "playbook",
        name: form.name.trim(),
        description: form.description.trim(),
        goal: form.goal.trim(),
        instructions: form.instructions.trim(),
        artifacts: form.expectedArtifacts
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => ({ type: line })),
        quality_bar: form.qualityBar
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        inputs: inputRows
          .filter((row) => row.key.trim())
          .map((row) => ({
            name: row.key.trim(),
            type: row.type,
            description: row.description.trim() || undefined,
            required: false,
          })),
      }

      const savedPlaybook = isEdit && id
        ? await api.playbooks.update(id, payload)
        : await api.playbooks.create(payload)

      toast.success(isEdit ? "Playbook saved" : "Playbook created")
      navigate(`/playbooks/${savedPlaybook.id}`)
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : "Failed to save playbook")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <PlaybookFormSkeleton />
  }

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{pageTitle}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Define task intent, expected artifacts, and run inputs for operator-started work.
        </p>
      </div>

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{errorMessage}</p>
          {isEdit && id ? (
            <div className="mt-4">
              <Button variant="secondary" onClick={() => void loadPlaybook()}>
                Retry
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="max-w-3xl space-y-6">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-slate-800">Basic Information</h2>
          <div className="mt-4 space-y-4">
            <Input
              label="Name"
              required
              value={form.name}
              error={errors.name}
              onChange={(event) => updateField("name", event.target.value)}
            />
            <Textarea
              label="Description"
              rows={3}
              value={form.description}
              onChange={(event) => updateField("description", event.target.value)}
            />
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-slate-800">Task Intent</h2>
          <div className="mt-4 space-y-4">
            <Textarea
              label="Goal"
              required
              rows={3}
              value={form.goal}
              error={errors.goal}
              onChange={(event) => updateField("goal", event.target.value)}
            />
            <Textarea
              label="Instructions"
              rows={6}
              value={form.instructions}
              onChange={(event) => updateField("instructions", event.target.value)}
            />
            <Textarea
              label="Expected Artifacts"
              rows={4}
              placeholder="One expected artifact per line"
              value={form.expectedArtifacts}
              onChange={(event) => updateField("expectedArtifacts", event.target.value)}
            />
            <Textarea
              label="Quality Bar"
              rows={4}
              placeholder="One quality expectation per line"
              value={form.qualityBar}
              onChange={(event) => updateField("qualityBar", event.target.value)}
            />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Input Schema</h2>
              <p className="mt-1 text-sm text-slate-500">
                Define the inputs this playbook requires when starting a run.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setInputRows((currentRows) => [...currentRows, createInputRow()])}>
              Add Input
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            {inputRows.length === 0 ? (
              <p className="text-sm text-slate-500">No input fields defined yet.</p>
            ) : (
              inputRows.map((row) => (
                <div key={row.id} className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-[1fr_180px_1fr_auto] md:items-end">
                  <Input
                    label="Key"
                    value={row.key}
                    onChange={(event) =>
                      setInputRows((currentRows) =>
                        currentRows.map((currentRow) =>
                          currentRow.id === row.id ? { ...currentRow, key: event.target.value } : currentRow,
                        ),
                      )
                    }
                  />
                  <Select
                    label="Type"
                    value={row.type}
                    options={[
                      { value: "string", label: "String" },
                      { value: "number", label: "Number" },
                      { value: "boolean", label: "Boolean" },
                      { value: "object", label: "Object" },
                      { value: "array", label: "Array" },
                    ]}
                    onChange={(event) =>
                      setInputRows((currentRows) =>
                        currentRows.map((currentRow) =>
                          currentRow.id === row.id
                            ? { ...currentRow, type: event.target.value as InputKind }
                            : currentRow,
                        ),
                      )
                    }
                  />
                  <Input
                    label="Description"
                    value={row.description}
                    onChange={(event) =>
                      setInputRows((currentRows) =>
                        currentRows.map((currentRow) =>
                          currentRow.id === row.id
                            ? { ...currentRow, description: event.target.value }
                            : currentRow,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="md:mb-1"
                    onClick={() =>
                      setInputRows((currentRows) => currentRows.filter((currentRow) => currentRow.id !== row.id))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl justify-end gap-3">
          <Button variant="secondary" onClick={() => navigate(-1)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            {isEdit ? "Save Changes" : "Create Playbook"}
          </Button>
        </div>
      </div>
    </div>
  )
}
