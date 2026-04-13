/**
 * Development server runner.
 *
 * Boots Express with in-memory repositories and seed data
 * so the frontend can be exercised without Postgres or Paseo.
 */
import {
  InMemoryPlaybookRepository,
  InMemoryHarnessRepository,
  InMemoryRoleSpecRepository,
  InMemoryTeamSpecRepository,
  InMemoryRunRepository,
  InMemoryRunEventRepository,
  InMemoryRunPlanRepository,
  InMemoryPolicySnapshotRepository,
  InMemoryApprovalRepository,
  InMemoryArtifactRepository,
  InMemoryRunSessionRepository,
  PlaybookService,
  HarnessService,
  RoleService,
  TeamService,
  RunService,
  ApprovalService,
  ArtifactService,
} from "@pluto-agent-platform/control-plane"

import { createApp } from "./api/app.js"
import { seedDevData } from "./seed.js"

const PORT = Number(process.env.PORT ?? 4000)

// Repositories
const playbookRepo = new InMemoryPlaybookRepository()
const harnessRepo = new InMemoryHarnessRepository()
const roleRepo = new InMemoryRoleSpecRepository()
const teamRepo = new InMemoryTeamSpecRepository()
const runRepo = new InMemoryRunRepository()
const runEventRepo = new InMemoryRunEventRepository()
const runPlanRepo = new InMemoryRunPlanRepository()
const policySnapshotRepo = new InMemoryPolicySnapshotRepository()
const approvalRepo = new InMemoryApprovalRepository()
const artifactRepo = new InMemoryArtifactRepository()
const runSessionRepo = new InMemoryRunSessionRepository()

// Services
const playbookService = new PlaybookService(playbookRepo)
const harnessService = new HarnessService(harnessRepo, playbookRepo)
const roleService = new RoleService(roleRepo)
const teamService = new TeamService(teamRepo, roleRepo)
const artifactService = new ArtifactService(artifactRepo, runRepo, playbookRepo, runEventRepo)
const runService = new RunService(
  playbookRepo,
  harnessRepo,
  runRepo,
  runEventRepo,
  runPlanRepo,
  policySnapshotRepo,
  artifactService,
)
const approvalService = new ApprovalService(approvalRepo, runService, runEventRepo)

// Wire app
const app = createApp({
  playbookService,
  harnessService,
  roleService,
  teamService,
  runService,
  approvalService,
  artifactService,
  playbookRepository: playbookRepo,
  harnessRepository: harnessRepo,
  roleRepository: roleRepo,
  teamRepository: teamRepo,
  runRepository: runRepo,
  runEventRepository: runEventRepo,
  approvalRepository: approvalRepo,
  artifactRepository: artifactRepo,
  runSessionRepository: runSessionRepo,
})

// Seed and start
async function main() {
  await seedDevData({
    playbookService,
    harnessService,
    roleService,
    teamService,
    runService,
    approvalService,
    artifactService,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runPlanRepository: runPlanRepo,
    runSessionRepository: runSessionRepo,
  })

  app.listen(PORT, () => {
    console.log(`Pluto dev server running at http://localhost:${PORT}`)
    console.log(`Frontend: http://localhost:3000 (run "pnpm --filter app dev")`)
  })
}

main().catch((err) => {
  console.error("Failed to start dev server:", err)
  process.exit(1)
})
