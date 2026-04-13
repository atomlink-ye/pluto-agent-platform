import { z } from "zod"

const NonEmptyStringSchema = z.string().min(1)
const StringArraySchema = z.array(NonEmptyStringSchema)

const InputSpecSchema = z
  .object({
    name: NonEmptyStringSchema,
    type: z.enum(["string", "number", "boolean", "object", "array"]),
    required: z.boolean(),
    description: z.string().optional(),
    default: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
  })
  .strict()

const PlaybookContextSchema = z
  .object({
    mcp_servers: StringArraySchema.optional(),
    repositories: StringArraySchema.optional(),
    memory_packs: StringArraySchema.optional(),
  })
  .strict()

const ArtifactExpectationSchema = z
  .object({
    type: NonEmptyStringSchema,
    format: z.string().optional(),
    description: z.string().optional(),
  })
  .strict()

const TeamPreferenceSchema = z
  .object({
    lead_role: z.string().optional(),
    preferred_roles: StringArraySchema.optional(),
    coordination_mode: z.string().optional(),
  })
  .strict()

const RunStatusSchema = z.enum([
  "queued",
  "initializing",
  "running",
  "blocked",
  "waiting_approval",
  "failing",
  "failed",
  "succeeded",
  "canceled",
  "archived",
])

const StageStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "blocked",
  "failed",
  "skipped",
])

const StatusModelSchema = z
  .object({
    run: z.array(RunStatusSchema).optional(),
    stage: z.array(StageStatusSchema).optional(),
  })
  .strict()

const TimeoutPolicySchema = z
  .object({
    total_minutes: z.number().positive().optional(),
    per_phase: z.record(z.string(), z.number().positive()).optional(),
    session_idle_minutes: z.number().positive().optional(),
    approval_wait_minutes: z.number().positive().optional(),
  })
  .strict()

const RetryRuleSchema = z
  .object({
    max_attempts: z.number().int().min(1),
    backoff: NonEmptyStringSchema,
    retryable_errors: StringArraySchema.optional(),
  })
  .strict()

const ApprovalPolicyValueSchema = z.enum(["required", "optional", "disabled", "inherit"])

const RequirementPolicySchema = z
  .object({
    evidence_links_required: z.boolean().optional(),
    artifact_registration_required: z.boolean().optional(),
    final_summary_required: z.boolean().optional(),
    review_before_publish: z.boolean().optional(),
    role_handoff_tracking_required: z.boolean().optional(),
  })
  .strict()

const ObservabilityPolicySchema = z
  .object({
    event_log_required: z.boolean().optional(),
    stage_transitions_required: z.boolean().optional(),
    artifact_emission_required: z.boolean().optional(),
    role_activity_tracking: z.boolean().optional(),
    raw_tool_events_retention_days: z.number().int().nonnegative().optional(),
  })
  .strict()

const HooksSchema = z.array(z.record(z.string(), z.unknown()))

const rejectField = (field: string, owner: "Harness" | "Playbook") =>
  z.unknown().optional().superRefine((value, ctx) => {
    if (value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} belongs to ${owner}`,
      })
    }
  })

const rejectRoleGovernanceField = (field: string) =>
  z.unknown().optional().superRefine((value, ctx) => {
    if (value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} belongs to Harness or higher-level policy, not RoleSpec`,
      })
    }
  })

const rejectTeamGovernanceField = (field: string) =>
  z.unknown().optional().superRefine((value, ctx) => {
    if (value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} belongs to Harness or higher-level policy, not TeamSpec`,
      })
    }
  })

const CoordinationPolicySchema = z
  .object({
    mode: z.string().optional(),
    shared_room: z.boolean().optional(),
    heartbeat_minutes: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((coordination, ctx) => {
    if (coordination.mode !== undefined && coordination.mode !== "supervisor-led") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "coordination.mode must be supervisor-led for this phase",
        path: ["mode"],
      })
    }
  })

export const PlaybookCreateSchema = z
  .object({
    name: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    instructions: NonEmptyStringSchema,
    owner: z.string().optional(),
    version: z.union([z.string(), z.number()]).optional(),
    inputs: z.array(InputSpecSchema).optional(),
    context: PlaybookContextSchema.optional(),
    tools: StringArraySchema.optional(),
    skills: StringArraySchema.optional(),
    team: TeamPreferenceSchema.optional(),
    artifacts: z.array(ArtifactExpectationSchema).optional(),
    quality_bar: StringArraySchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    approval_policy: rejectField("approval_policy", "Harness"),
    approvals: rejectField("approvals", "Harness"),
    timeout: rejectField("timeout", "Harness"),
    timeouts: rejectField("timeouts", "Harness"),
    retry: rejectField("retry", "Harness"),
    retries: rejectField("retries", "Harness"),
    phases: rejectField("phases", "Harness"),
    status_model: rejectField("status_model", "Harness"),
    observability: rejectField("observability", "Harness"),
    escalation: rejectField("escalation", "Harness"),
    requirements: rejectField("requirements", "Harness"),
  })
  .strict()

const HarnessPhasesSchema = z
  .array(NonEmptyStringSchema)
  .min(1)
  .superRefine((phases, ctx) => {
    const seen = new Set<string>()

    phases.forEach((phase, index) => {
      if (seen.has(phase)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate phase: ${phase}`,
          path: [index],
        })
        return
      }

      seen.add(phase)
    })
  })

export const HarnessCreateSchema = z
  .object({
    name: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    phases: HarnessPhasesSchema,
    version: z.union([z.string(), z.number()]).optional(),
    status_model: StatusModelSchema.optional(),
    timeouts: TimeoutPolicySchema.optional(),
    retries: z.record(z.string(), RetryRuleSchema).optional(),
    approvals: z.record(z.string(), ApprovalPolicyValueSchema).optional(),
    requirements: RequirementPolicySchema.optional(),
    observability: ObservabilityPolicySchema.optional(),
    escalation: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    goal: rejectField("goal", "Playbook"),
    instructions: rejectField("instructions", "Playbook"),
    inputs: rejectField("inputs", "Playbook"),
    tools: rejectField("tools", "Playbook"),
    skills: rejectField("skills", "Playbook"),
    quality_bar: rejectField("quality_bar", "Playbook"),
    artifacts: rejectField("artifacts", "Playbook"),
  })
  .strict()

export const RoleSpecCreateSchema = z
  .object({
    name: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    system_prompt: z.string().optional(),
    tools: StringArraySchema.optional(),
    provider_preset: z.string().optional(),
    memory_scope: z.string().optional(),
    isolation: z.string().optional(),
    background: z.boolean().optional(),
    hooks: HooksSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    approval_policy: rejectRoleGovernanceField("approval_policy"),
    approvals: rejectRoleGovernanceField("approvals"),
    timeout: rejectRoleGovernanceField("timeout"),
    timeouts: rejectRoleGovernanceField("timeouts"),
    retry: rejectRoleGovernanceField("retry"),
    retries: rejectRoleGovernanceField("retries"),
    requirements: rejectRoleGovernanceField("requirements"),
    phases: rejectRoleGovernanceField("phases"),
    status_model: rejectRoleGovernanceField("status_model"),
    observability: rejectRoleGovernanceField("observability"),
    escalation: rejectRoleGovernanceField("escalation"),
  })
  .strict()

export const TeamSpecCreateSchema = z
  .object({
    name: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    lead_role: NonEmptyStringSchema,
    roles: StringArraySchema.min(1),
    coordination: CoordinationPolicySchema.optional(),
    memory_scope: z.string().optional(),
    worktree_policy: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    approval_policy: rejectTeamGovernanceField("approval_policy"),
    approvals: rejectTeamGovernanceField("approvals"),
    timeout: rejectTeamGovernanceField("timeout"),
    timeouts: rejectTeamGovernanceField("timeouts"),
    retry: rejectTeamGovernanceField("retry"),
    retries: rejectTeamGovernanceField("retries"),
    requirements: rejectTeamGovernanceField("requirements"),
    phases: rejectTeamGovernanceField("phases"),
    status_model: rejectTeamGovernanceField("status_model"),
    observability: rejectTeamGovernanceField("observability"),
    escalation: rejectTeamGovernanceField("escalation"),
  })
  .strict()
  .superRefine((team, ctx) => {
    if (!team.roles.includes(team.lead_role)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "lead_role must be included in roles",
        path: ["lead_role"],
      })
    }
  })

export type PlaybookCreateInput = z.infer<typeof PlaybookCreateSchema>
export type HarnessCreateInput = z.infer<typeof HarnessCreateSchema>
export type RoleSpecCreateInput = z.infer<typeof RoleSpecCreateSchema>
export type TeamSpecCreateInput = z.infer<typeof TeamSpecCreateSchema>
