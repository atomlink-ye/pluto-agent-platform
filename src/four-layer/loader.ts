import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

import {
  FOUR_LAYER_DIRECTORY_NAMES,
  FOUR_LAYER_FILE_EXTENSIONS,
  type FourLayerAuthoredObjectKind,
} from "../contracts/four-layer.js";
import { normalizeAuthoredObject } from "./authored-normalize.js";
import {
  validateAgent,
  validateByKind,
  validatePlaybook,
  validateRunProfile,
  validateScenario,
} from "./authored-validate.js";
import {
  FourLayerLoaderError,
  type FourLayerValidationResult,
  type FourLayerWorkspace,
  type LoadedFourLayerObject,
} from "./loader-shared.js";
import { resolveFourLayerSelection } from "./selection-resolver.js";
import { parseYaml } from "./yaml-lite.js";

export * from "./loader-shared.js";
export {
  validateAgent,
  validatePlaybook,
  validateRunProfile,
  validateScenario,
} from "./authored-validate.js";
export { resolveFourLayerSelection } from "./selection-resolver.js";
export { parseYaml } from "./yaml-lite.js";

export async function loadFourLayerWorkspace(rootDir: string): Promise<FourLayerWorkspace> {
  const [agents, playbooks, scenarios, runProfiles] = await Promise.all([
    loadKindDirectory(rootDir, "agent", validateAgent),
    loadKindDirectory(rootDir, "playbook", validatePlaybook),
    loadKindDirectory(rootDir, "scenario", validateScenario),
    loadKindDirectory(rootDir, "run_profile", validateRunProfile),
  ]);

  return { rootDir, agents, playbooks, scenarios, runProfiles };
}

export async function loadFourLayerFile<T>(
  filePath: string,
  expectedKind: FourLayerAuthoredObjectKind,
): Promise<LoadedFourLayerObject<T>> {
  const source = await readFile(filePath, "utf8");
  const parsed = parseYaml(source, filePath);
  const normalized = normalizeAuthoredObject(parsed, expectedKind, filePath);
  const validation = validateByKind(expectedKind, normalized);
  if (!validation.ok) {
    throw new FourLayerLoaderError(`invalid_${expectedKind}:${filePath}`, validation.errors);
  }
  return { path: filePath, value: validation.value as T };
}

async function loadKindDirectory<T>(
  rootDir: string,
  kind: FourLayerAuthoredObjectKind,
  validate: (value: unknown) => FourLayerValidationResult<T>,
): Promise<Map<string, LoadedFourLayerObject<T>>> {
  const directoryPath = join(rootDir, FOUR_LAYER_DIRECTORY_NAMES[kind]);
  let entries: string[] = [];
  try {
    entries = await readdir(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const files = entries
    .filter((entry) => FOUR_LAYER_FILE_EXTENSIONS.includes(extname(entry) as typeof FOUR_LAYER_FILE_EXTENSIONS[number]))
    .sort();

  const loaded = await Promise.all(files.map(async (entry) => {
    const filePath = join(directoryPath, entry);
    const source = await readFile(filePath, "utf8");
    const parsed = parseYaml(source, filePath);
    const normalized = normalizeAuthoredObject(parsed, kind, filePath);
    const validation = validate(normalized);
    if (!validation.ok) {
      throw new FourLayerLoaderError(`invalid_${kind}:${filePath}`, validation.errors);
    }
    return { filePath, value: validation.value };
  }));

  const map = new Map<string, LoadedFourLayerObject<T>>();
  for (const item of loaded) {
    const name = (item.value as { name: string }).name;
    if (map.has(name)) {
      throw new FourLayerLoaderError(`duplicate_${kind}:${name}`, [
        `${kind} ${name} is defined more than once`,
      ]);
    }
    map.set(name, { path: item.filePath, value: item.value });
  }
  return map;
}
