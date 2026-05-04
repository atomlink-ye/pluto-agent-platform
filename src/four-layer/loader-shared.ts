import type {
  Agent,
  Playbook,
  RunProfile,
  Scenario,
} from "../contracts/four-layer.js";

export const FOUR_LAYER_KNOWLEDGE_MAX_REFS = 3;
export const FOUR_LAYER_KNOWLEDGE_MAX_TOTAL_BYTES = 8_000;
export const FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES = 4_000;

export interface FourLayerValidationError {
  ok: false;
  errors: string[];
}

export interface FourLayerValidationSuccess<T> {
  ok: true;
  value: T;
}

export type FourLayerValidationResult<T> = FourLayerValidationSuccess<T> | FourLayerValidationError;

export interface LoadedFourLayerObject<T> {
  path: string;
  value: T;
}

export interface FourLayerWorkspace {
  rootDir: string;
  agents: Map<string, LoadedFourLayerObject<Agent>>;
  playbooks: Map<string, LoadedFourLayerObject<Playbook>>;
  scenarios: Map<string, LoadedFourLayerObject<Scenario>>;
  runProfiles: Map<string, LoadedFourLayerObject<RunProfile>>;
}

export interface ResolvedTextRef {
  ref: string;
  path: string;
  content: string;
  bytes: number;
}

export interface ResolvedScenarioOverlay {
  roleName: string;
  prompt?: string;
  knowledge?: ResolvedTextRef[];
  rubric?: ResolvedTextRef;
}

export interface ResolvedFourLayerSelection {
  rootDir: string;
  playbook: LoadedFourLayerObject<Playbook>;
  scenario: LoadedFourLayerObject<Scenario>;
  runProfile?: LoadedFourLayerObject<RunProfile>;
  teamLead: LoadedFourLayerObject<Agent>;
  members: LoadedFourLayerObject<Agent>[];
  overlays: Record<string, ResolvedScenarioOverlay>;
}

export class FourLayerLoaderError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "FourLayerLoaderError";
    this.issues = issues;
  }
}

export type MutableRecord = Record<string, unknown>;
