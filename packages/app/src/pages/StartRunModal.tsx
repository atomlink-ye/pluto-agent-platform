import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { api, type RunRecord } from "../api"
import { Button } from "../components/Button"
import { Input, Select, Textarea } from "../components/Input"
import { Modal } from "../components/Modal"
import { useToast } from "../hooks/useToast"

type InputKind = "string" | "number" | "boolean" | "object" | "array"

interface InputSpec {
  name: string
  type?: string
  required?: boolean
  description?: string
  default?: unknown
  enum?: unknown[] | null
}

interface HarnessSummary {
  id: string
  name: string
  description?: string
}

interface PlaybookSummary {
  id: string
  name: string
  inputs?: InputSpec[] | Record<string, unknown>
  harness?: HarnessSummary | null
  harnessId?: string | null
  harnesses?: HarnessSummary[]
}

interface StartRunModalProps {
  open: boolean
  onClose: () => void
  playbook: PlaybookSummary
}

type InputFormValue = string

function normalizeInputKind(type?: string): InputKind {
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

function serializeDefaultValue(value: unknown, type: InputKind) {
  if (value === undefined || value === null) {
    return type === "boolean" ? "false" : ""
  }

  if (type === "object" || type === "array") {
    return JSON.stringify(value, null, 2)
  }

  if (type === "boolean") {
    return value ? "true" : "false"
  }

  return String(value)
}

function normalizeInputs(inputs?: InputSpec[] | Record<string, unknown>): InputSpec[] {
  if (!inputs) {
    return []
  }

  if (Array.isArray(inputs)) {
    return inputs.map((input) => ({
      ...input,
      type: normalizeInputKind(input.type),
    }))
  }

  return Object.entries(inputs).map(([name, description]) => ({
    name,
    type: "string",
    required: false,
    description: typeof description === "string" ? description : undefined,
  }))
}

function normalizeHarnesses(playbook: PlaybookSummary): HarnessSummary[] {
  if (Array.isArray(playbook.harnesses) && playbook.harnesses.length > 0) {
    return playbook.harnesses
  }

  if (playbook.harness) {
    return [playbook.harness]
  }

  if (playbook.harnessId) {
    return [{ id: playbook.harnessId, name: "Attached harness" }]
  }

  return []
}

function buildInitialValues(inputs: InputSpec[]) {
  return Object.fromEntries(
    inputs.map((input) => {
      const kind = normalizeInputKind(input.type)
      return [input.name, serializeDefaultValue(input.default, kind)]
    }),
  ) as Record<string, InputFormValue>
}

function parseInputValue(input: InputSpec, rawValue: string): unknown {
  const kind = normalizeInputKind(input.type)
  const trimmedValue = rawValue.trim()

  if (!trimmedValue) {
    return ""
  }

  switch (kind) {
    case "number": {
      const parsed = Number(trimmedValue)
      if (Number.isNaN(parsed)) {
        throw new Error("Enter a valid number")
      }
      return parsed
    }
    case "boolean":
      return trimmedValue === "true"
    case "object": {
      const parsed = JSON.parse(trimmedValue) as unknown
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Enter a valid JSON object")
      }
      return parsed
    }
    case "array": {
      const parsed = JSON.parse(trimmedValue) as unknown
      if (!Array.isArray(parsed)) {
        throw new Error("Enter a valid JSON array")
      }
      return parsed
    }
    default:
      return trimmedValue
  }
}

function getFieldHelperText(input: InputSpec) {
  const kind = normalizeInputKind(input.type)

  if (input.description) {
    return input.description
  }

  switch (kind) {
    case "boolean":
      return "Choose true or false."
    case "object":
      return "Provide a JSON object."
    case "array":
      return "Provide a JSON array."
    case "number":
      return "Provide a numeric value."
    default:
      return undefined
  }
}

export function StartRunModal({ open, onClose, playbook }: StartRunModalProps) {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [values, setValues] = useState<Record<string, InputFormValue>>({})
  const [selectedHarnessId, setSelectedHarnessId] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const inputSpecs = useMemo(() => normalizeInputs(playbook.inputs), [playbook.inputs])
  const harnesses = useMemo(() => normalizeHarnesses(playbook), [playbook])

  useEffect(() => {
    if (!open) {
      return
    }

    setValues(buildInitialValues(inputSpecs))
    setErrors({})
    setSelectedHarnessId(harnesses[0]?.id ?? "")
  }, [harnesses, inputSpecs, open])

  const handleValueChange = (name: string, value: string) => {
    setValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }))

    setErrors((currentErrors) => {
      if (!currentErrors[name]) {
        return currentErrors
      }

      const nextErrors = { ...currentErrors }
      delete nextErrors[name]
      return nextErrors
    })
  }

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {}
    const parsedInputs: Record<string, unknown> = {}

    inputSpecs.forEach((input) => {
      const rawValue = values[input.name] ?? ""

      if (input.required && !rawValue.trim()) {
        nextErrors[input.name] = "Required"
        return
      }

      if (!rawValue.trim()) {
        return
      }

      try {
        parsedInputs[input.name] = parseInputValue(input, rawValue)
      } catch (parseError) {
        nextErrors[input.name] =
          parseError instanceof Error ? parseError.message : "Enter a valid value"
      }
    })

    if (harnesses.length > 0 && !selectedHarnessId) {
      nextErrors.harnessId = "Select a harness"
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setSubmitting(true)

    try {
      const run = await api.runs.create({
        playbookId: playbook.id,
        harnessId: selectedHarnessId,
        inputs: parsedInputs,
      })

      toast.success("Run started", `${playbook.name} is now executing.`)
      onClose()
      navigate(`/runs/${run.id}`)
    } catch (submitError) {
      toast.error(
        "Failed to start run",
        submitError instanceof Error ? submitError.message : "Unknown error",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Start Run" size="lg" closeDisabled={submitting}>
      <Modal.Body>
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium text-slate-900">{playbook.name}</p>
            <p className="mt-1 text-sm text-slate-500">
              Provide run inputs and select the governance harness for this execution.
            </p>
          </div>

          {harnesses.length > 1 ? (
            <Select
              label="Harness"
              value={selectedHarnessId}
              onChange={(event) => setSelectedHarnessId(event.target.value)}
              options={harnesses.map((harness) => ({ value: harness.id, label: harness.name }))}
              error={errors.harnessId}
            />
          ) : null}

          {harnesses.length === 1 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Harness</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{harnesses[0].name}</p>
              {harnesses[0].description ? (
                <p className="mt-1 text-sm text-slate-500">{harnesses[0].description}</p>
              ) : null}
            </div>
          ) : null}

          {harnesses.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No harness is attached to this playbook yet.
            </div>
          ) : null}

          {inputSpecs.length === 0 ? (
            <p className="text-sm text-slate-500">This playbook does not require additional inputs.</p>
          ) : (
            <div className="space-y-4">
              {inputSpecs.map((input) => {
                const kind = normalizeInputKind(input.type)
                const helperText = getFieldHelperText(input)
                const value = values[input.name] ?? ""

                if (Array.isArray(input.enum) && input.enum.length > 0) {
                  return (
                    <div key={input.name} className="space-y-1">
                      <Select
                        label={input.name}
                        required={Boolean(input.required)}
                        value={value}
                        error={errors[input.name]}
                        onChange={(event) => handleValueChange(input.name, event.target.value)}
                        options={input.enum.map((option) => ({
                          value: String(option),
                          label: String(option),
                        }))}
                      />
                      {helperText ? <p className="text-xs text-slate-500">{helperText}</p> : null}
                    </div>
                  )
                }

                if (kind === "boolean") {
                  return (
                    <div key={input.name} className="space-y-1">
                      <Select
                        label={input.name}
                        required={Boolean(input.required)}
                        value={value}
                        error={errors[input.name]}
                        onChange={(event) => handleValueChange(input.name, event.target.value)}
                        options={[
                          { value: "true", label: "True" },
                          { value: "false", label: "False" },
                        ]}
                      />
                      {helperText ? <p className="text-xs text-slate-500">{helperText}</p> : null}
                    </div>
                  )
                }

                if (kind === "object" || kind === "array") {
                  return (
                    <div key={input.name} className="space-y-1">
                      <Textarea
                        label={input.name}
                        required={Boolean(input.required)}
                        rows={6}
                        placeholder={helperText}
                        value={value}
                        error={errors[input.name]}
                        onChange={(event) => handleValueChange(input.name, event.target.value)}
                      />
                      {helperText ? <p className="text-xs text-slate-500">{helperText}</p> : null}
                    </div>
                  )
                }

                return (
                  <div key={input.name} className="space-y-1">
                    <Input
                      label={input.name}
                      required={Boolean(input.required)}
                      type={kind === "number" ? "number" : "text"}
                      placeholder={helperText ?? `Enter ${input.name}`}
                      value={value}
                      error={errors[input.name]}
                      onChange={(event) => handleValueChange(input.name, event.target.value)}
                    />
                    {helperText ? <p className="text-xs text-slate-500">{helperText}</p> : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={() => void handleSubmit()} loading={submitting} disabled={harnesses.length === 0}>
          Start Run
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
