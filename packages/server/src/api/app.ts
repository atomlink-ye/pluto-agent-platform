/**
 * Operator API — Plan 002 Feature 6
 *
 * REST endpoints for playbooks, runs, approvals, and artifacts.
 * Provides the backend that the operator UI consumes.
 */
import express, { type Request, type Response } from "express"

function param(req: Request, name: string): string {
  const val = req.params[name]
  if (Array.isArray(val)) return val[0]
  return val
}
import type {
  PlaybookRepository,
  HarnessRepository,
  RoleSpecRepository,
  TeamSpecRepository,
  RunRepository,
  RunEventRepository,
  ApprovalRepository,
  ArtifactRepository,
  RunSessionRepository,
} from "@pluto-agent-platform/control-plane"
import type { PlaybookService } from "@pluto-agent-platform/control-plane"
import type { HarnessService } from "@pluto-agent-platform/control-plane"
import type { RoleService } from "@pluto-agent-platform/control-plane"
import type { TeamService } from "@pluto-agent-platform/control-plane"
import type { RunService } from "@pluto-agent-platform/control-plane"
import type { ApprovalService } from "@pluto-agent-platform/control-plane"
import type { ArtifactService } from "@pluto-agent-platform/control-plane"

export interface AppDeps {
  playbookService: PlaybookService
  harnessService: HarnessService
  roleService: RoleService
  teamService: TeamService
  runService: RunService
  approvalService: ApprovalService
  artifactService: ArtifactService
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
      const { playbookId, harnessId, inputs } = req.body
      const run = await deps.runService.create(playbookId, harnessId, inputs ?? {})
      res.status(201).json({ data: run })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid input" })
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

    res.json({
      data: {
        run,
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

  app.get("/api/runs/:runId/approvals", async (req: Request, res: Response) => {
    const approvals = await deps.approvalRepository.listByRunId(param(req, "runId"))
    res.json({ data: approvals })
  })

  app.post("/api/approvals/:id/resolve", async (req: Request, res: Response) => {
    try {
      const { decision, resolvedBy, note } = req.body
      const approval = await deps.approvalService.resolve(
        param(req, "id"),
        decision,
        resolvedBy,
        note,
      )
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
