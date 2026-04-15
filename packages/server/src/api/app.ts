/**
 * Operator API — Plan 002 Feature 6
 *
 * REST endpoints for playbooks, runs, approvals, and artifacts.
 * Provides the backend that the operator UI consumes.
 */
import express, { type Request, type Response } from "express"
import type {
  ApprovalRecord,
  ApprovalRepository,
  ArtifactRepository,
  HarnessRepository,
  PlaybookRecord,
  PlaybookRepository,
  RoleSpecRepository,
  RunEventRepository,
  RunRecord,
  RunRepository,
  RunSessionRepository,
  TeamSpecRepository,
} from "@pluto-agent-platform/control-plane"
import type { ApprovalService } from "@pluto-agent-platform/control-plane"
import type { ArtifactService } from "@pluto-agent-platform/control-plane"
import type { HarnessService } from "@pluto-agent-platform/control-plane"
import type { PlaybookService } from "@pluto-agent-platform/control-plane"
import type { RoleService } from "@pluto-agent-platform/control-plane"
import type { RunCompiler } from "@pluto-agent-platform/control-plane"
import type { RunService } from "@pluto-agent-platform/control-plane"
import type { TeamService } from "@pluto-agent-platform/control-plane"
import type { PhaseController } from "@pluto-agent-platform/control-plane"

function param(req: Request, name: string): string {
  const val = req.params[name]
  if (Array.isArray(val)) return val[0]
  return val
}
function queryParam(req: Request, name: string): string | undefined {
  const val = req.query[name]
  if (Array.isArray(val)) {
    const first = val[0]
    return typeof first === "string" ? first : undefined
  }
  return typeof val === "string" ? val : undefined
}

const APPROVAL_STATUSES = new Set(["pending", "approved", "denied", "expired", "canceled"])

interface ApprovalQueueItem extends ApprovalRecord {
  run:
    | {
        id: RunRecord["id"]
        status: RunRecord["status"]
        current_phase: RunRecord["current_phase"] | null
      }
    | null
  playbook: Pick<PlaybookRecord, "id" | "name"> | null
}

export interface AppDeps {
  playbookService: PlaybookService
  harnessService: HarnessService
  roleService: RoleService
  teamService: TeamService
  runService: RunService
  runCompiler: RunCompiler
  defaultRunProvider?: string
  approvalService: ApprovalService
  artifactService: ArtifactService
  phaseController?: Pick<PhaseController, "handleApprovalResolution">
  playbookRepository: PlaybookRepository
  harnessRepository: HarnessRepository
  roleRepository: RoleSpecRepository
  teamRepository: TeamSpecRepository
  runRepository: RunRepository
  runEventRepository: RunEventRepository
  approvalRepository: ApprovalRepository
  artifactRepository: ArtifactRepository
  runSessionRepository: RunSessionRepository
}

export function createApp(deps: AppDeps): express.Express {
  const app = express()
  app.use(express.json())

  // -----------------------------------------------------------------------
  // Playbooks
  // -----------------------------------------------------------------------

  app.get("/api/playbooks", async (_req: Request, res: Response) => {
    const playbooks = await deps.playbookService.list()
    res.json({ data: playbooks })
  })

  app.get("/api/playbooks/:id", async (req: Request, res: Response) => {
    const playbook = await deps.playbookService.getById(param(req, "id"))
    if (!playbook) {
      res.status(404).json({ error: "Playbook not found" })
      return
    }
    res.json({ data: playbook })
  })

  app.post("/api/playbooks", async (req: Request, res: Response) => {
    try {
      const playbook = await deps.playbookService.create(req.body)
      res.status(201).json({ data: playbook })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid input" })
    }
  })

  app.put("/api/playbooks/:id", async (req: Request, res: Response) => {
    try {
      const playbook = await deps.playbookService.update(param(req, "id"), req.body)
      res.json({ data: playbook })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid input"
      res.status(message.includes("not found") ? 404 : 400).json({ error: message })
    }
  })

  // -----------------------------------------------------------------------
  // Roles
  // -----------------------------------------------------------------------

  app.get("/api/roles", async (_req: Request, res: Response) => {
    const roles = await deps.roleService.list()
    res.json({ data: roles })
  })

  app.get("/api/roles/:id", async (req: Request, res: Response) => {
    const role = await deps.roleService.getById(param(req, "id"))
    if (!role) {
      res.status(404).json({ error: "Role not found" })
      return
    }
    res.json({ data: role })
  })

  app.post("/api/roles", async (req: Request, res: Response) => {
    try {
      const role = await deps.roleService.create(req.body)
      res.status(201).json({ data: role })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid input" })
    }
  })

  // -----------------------------------------------------------------------
  // Teams
  // -----------------------------------------------------------------------

  app.get("/api/teams", async (_req: Request, res: Response) => {
    const teams = await deps.teamService.list()
    res.json({ data: teams })
  })

  app.get("/api/teams/:id", async (req: Request, res: Response) => {
    const team = await deps.teamService.getById(param(req, "id"))
    if (!team) {
      res.status(404).json({ error: "Team not found" })
      return
    }
    res.json({ data: team })
  })

  app.post("/api/teams", async (req: Request, res: Response) => {
    try {
      const team = await deps.teamService.create(req.body)
      res.status(201).json({ data: team })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid input" })
    }
  })

  // -----------------------------------------------------------------------
  // Harnesses
  // -----------------------------------------------------------------------

  app.get("/api/harnesses", async (_req: Request, res: Response) => {
    const harnesses = await deps.harnessRepository.list()
    res.json({ data: harnesses })
  })

  app.get("/api/harnesses/:id", async (req: Request, res: Response) => {
    const harness = await deps.harnessRepository.getById(param(req, "id"))
    if (!harness) {
      res.status(404).json({ error: "Harness not found" })
      return
    }
    res.json({ data: harness })
  })

  app.post("/api/harnesses", async (req: Request, res: Response) => {
    try {
      const harness = await deps.harnessService.create(req.body)
      res.status(201).json({ data: harness })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid input" })
    }
  })

  app.post("/api/harnesses/:id/attach/:playbookId", async (req: Request, res: Response) => {
    try {
      const playbook = await deps.harnessService.attachToPlaybook(
        param(req, "id"),
        param(req, "playbookId"),
      )
      res.json({ data: playbook })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid input" })
    }
  })

  // -----------------------------------------------------------------------
  // Runs
  // -----------------------------------------------------------------------

  app.get("/api/runs", async (_req: Request, res: Response) => {
    const runs = await deps.runRepository.list()

    // Enrich with playbook and harness names for display
    const enriched = await Promise.all(
      runs.map(async (run) => {
        const [pb, hs] = await Promise.all([
          deps.playbookRepository.getById(run.playbook),
          deps.harnessRepository.getById(run.harness),
        ])
        return {
          ...run,
          playbookName: pb?.name ?? run.playbook,
          harnessName: hs?.name ?? run.harness,
        }
      }),
    )

    res.json({ data: enriched })
  })

  app.post("/api/runs", async (req: Request, res: Response) => {
    try {
      const { playbookId, harnessId, inputs, teamId, provider, workingDirectory } = req.body
      const resolvedProvider = typeof provider === "string" && provider.length > 0
        ? provider
        : deps.defaultRunProvider
      const run = await deps.runCompiler.compile({
        playbookId,
        harnessId,
        inputs: inputs ?? {},
        ...(typeof teamId === "string" && teamId.length > 0 ? { teamId } : {}),
        ...(typeof resolvedProvider === "string" && resolvedProvider.length > 0 ? { provider: resolvedProvider } : {}),
        ...(typeof workingDirectory === "string" && workingDirectory.length > 0
          ? { workingDirectory }
          : {}),
      })
      res.status(201).json({ data: run })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid input" })
    }
  })

  app.post("/api/runs/:id/cancel", async (req: Request, res: Response) => {
    try {
      const run = await deps.runService.transition(param(req, "id"), "canceled")
      res.json({ data: run })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid input"
      res.status(message.includes("not found") ? 404 : 400).json({ error: message })
    }
  })

  app.get("/api/runs/:id", async (req: Request, res: Response) => {
    const run = await deps.runRepository.getById(param(req, "id"))
    if (!run) {
      res.status(404).json({ error: "Run not found" })
      return
    }

    // Enrich with events, approvals, artifacts, sessions
    const [events, approvals, artifacts, sessions] = await Promise.all([
      deps.runEventRepository.listByRunId(run.id),
      deps.approvalRepository.listByRunId(run.id),
      deps.artifactRepository.listByRunId(run.id),
      deps.runSessionRepository.listByRunId(run.id),
    ])

    // Resolve team data for the UI
    let resolved_team = null
    if (run.team) {
      const teamSpec = await deps.teamRepository.getById(run.team)
      if (teamSpec) {
        resolved_team = {
          id: teamSpec.id,
          name: teamSpec.name,
          description: teamSpec.description,
          lead_role: teamSpec.lead_role,
          roles: teamSpec.roles,
          coordination: teamSpec.coordination,
        }
      }
    }

    res.json({
      data: {
        run: { ...run, resolved_team },
        events,
        approvals,
        artifacts,
        sessions,
      },
    })
  })

  // -----------------------------------------------------------------------
  // Approvals
  // -----------------------------------------------------------------------

  app.get("/api/approvals", async (req: Request, res: Response) => {
    const status = queryParam(req, "status")
    if (status && !APPROVAL_STATUSES.has(status)) {
      res.status(400).json({ error: `Invalid approval status: ${status}` })
      return
    }

    const [approvals, runs] = await Promise.all([
      deps.approvalRepository.list(),
      deps.runRepository.list(),
    ])
    const runById = new Map<string, RunRecord>(runs.map((run) => [run.id, run]))
    const playbookIds = Array.from(
      new Set(
        approvals
          .map((approval) => runById.get(approval.run_id)?.playbook)
          .filter((playbookId): playbookId is string => Boolean(playbookId)),
      ),
    )
    const playbooks = await Promise.all(
      playbookIds.map((playbookId) => deps.playbookRepository.getById(playbookId)),
    )
    const playbookById = new Map<string, PlaybookRecord>(
      playbooks
        .filter((playbook): playbook is PlaybookRecord => playbook !== null)
        .map((playbook) => [playbook.id, playbook]),
    )

    const filteredApprovals = approvals.filter((approval) => (status ? approval.status === status : true))
    const enriched: ApprovalQueueItem[] = filteredApprovals
      .map((approval) => {
        const run = runById.get(approval.run_id)
        const playbook = run ? playbookById.get(run.playbook) : null

        return {
          ...approval,
          run: run
            ? {
                id: run.id,
                status: run.status,
                current_phase: run.current_phase ?? null,
              }
            : null,
          playbook: playbook
            ? {
                id: playbook.id,
                name: playbook.name,
              }
            : null,
        }
      })
      .sort((left, right) => {
        if (!status && left.status !== right.status) {
          if (left.status === "pending") return -1
          if (right.status === "pending") return 1
        }

        return right.createdAt.localeCompare(left.createdAt)
      })

    res.json({ data: enriched })
  })

  app.get("/api/runs/:runId/approvals", async (req: Request, res: Response) => {
    const approvals = await deps.approvalRepository.listByRunId(param(req, "runId"))
    res.json({ data: approvals })
  })

  app.post("/api/approvals/:id/resolve", async (req: Request, res: Response) => {
    try {
      const { decision, note } = req.body
      const approval = await deps.approvalService.resolve(
        param(req, "id"),
        decision,
        "operator",
        note,
      )
      if (decision === "approved") {
        await deps.phaseController?.handleApprovalResolution(approval.run_id, approval.id, "approved")
      }
      res.json({ data: approval })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid input" })
    }
  })

  // -----------------------------------------------------------------------
  // Artifacts
  // -----------------------------------------------------------------------

  app.get("/api/runs/:runId/artifacts", async (req: Request, res: Response) => {
    const artifacts = await deps.artifactRepository.listByRunId(param(req, "runId"))
    res.json({ data: artifacts })
  })

  // -----------------------------------------------------------------------
  // Run Events
  // -----------------------------------------------------------------------

  app.get("/api/runs/:runId/events", async (req: Request, res: Response) => {
    const events = await deps.runEventRepository.listByRunId(param(req, "runId"))
    res.json({ data: events })
  })

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  })

  return app
}
