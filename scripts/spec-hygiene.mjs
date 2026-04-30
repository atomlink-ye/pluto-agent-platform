#!/usr/bin/env node
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_INPUT = ".local/manager/spec-prd-trd-qa-rewrite/hierarchy/";
const GENERATED_FILE_NAMES = {
  overview: "overview.md",
  PRD: "PRD.md",
  TRD: "TRD.md",
  QA: "QA.md",
};
const RULE_IDS = {
  manifestShape: "MANIFEST_SHAPE",
  manifestMissingEntry: "MANIFEST_MISSING_ENTRY",
  manifestPathMismatch: "MANIFEST_PATH_MISMATCH",
  manifestTitleKeyMismatch: "MANIFEST_TITLE_KEY_MISMATCH",
  metaMissingField: "META_MISSING_FIELD",
  metaInvalidStatus: "META_INVALID_STATUS",
  metaWrongSpecType: "META_WRONG_SPEC_TYPE",
  duplicateSpec: "DUPLICATE_SPEC",
  addendumWarning: "ADDENDUM_WARNING",
};
const VALID_STATUSES = new Set(["idea", "draft v0", "draft v1", "accepted", "superseded", "archived"]);
const LEGACY_DRAFT_STATUS = "Draft";
const STATUS_LIST = Array.from(VALID_STATUSES).join(", ");
const SPEC_METADATA_REQUIREMENTS = {
  "overview.md": {
    specType: "overview",
    requiredFields: ["Owner", "Spec depends on", "Last Updated", "Spec Type", "Status"],
    sourceFields: ["Source", "Source path"],
    linkedPages: ["PRD", "TRD", "QA"],
  },
  "PRD.md": {
    specType: "PRD",
    requiredFields: ["Owner", "Spec depends on", "Last Updated", "Spec Type", "Status"],
    sourceFields: ["Source", "Source path"],
    linkedPages: ["TRD", "QA"],
  },
  "TRD.md": {
    specType: "TRD",
    requiredFields: ["Owner", "Spec depends on", "Last Updated", "Spec Type", "Status"],
    sourceFields: ["Source", "Source path"],
    linkedPages: ["PRD", "QA"],
  },
  "QA.md": {
    specType: "QA",
    requiredFields: ["Owner", "Spec depends on", "Last Updated", "Spec Type", "Status"],
    sourceFields: ["Source", "Source path"],
    linkedPages: ["PRD", "TRD"],
  },
};

export function parseArgs(argv) {
  let inputPath = DEFAULT_INPUT;
  let requireMirror = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --input");
      }
      inputPath = value;
      index += 1;
      continue;
    }

    if (arg === "--require-mirror") {
      requireMirror = true;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return { inputPath, requireMirror };
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPosixPath(value) {
  return value.split(path.sep).join(path.posix.sep);
}

function isRelativeWithinRoot(value) {
  return !value.startsWith("..") && !path.isAbsolute(value);
}

function extractMirrorRelativePath(rootPath, candidatePath) {
  const normalizedCandidate = candidatePath.replace(/\\/gu, "/");
  const rootName = path.basename(rootPath);
  const marker = `/${rootName}/`;
  const markerIndex = normalizedCandidate.lastIndexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  return normalizedCandidate.slice(markerIndex + marker.length);
}

async function resolveMirrorFileTarget(rootPath, candidatePath, fallbackRelativePath) {
  const candidates = [];
  const seen = new Set();

  function pushTarget(displayPath, absolutePath) {
    const normalizedDisplayPath = toPosixPath(displayPath);
    const normalizedAbsolutePath = path.normalize(absolutePath);
    const key = `${normalizedDisplayPath}::${normalizedAbsolutePath}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push({ displayPath: normalizedDisplayPath, absolutePath: normalizedAbsolutePath });
  }

  if (typeof candidatePath === "string") {
    if (path.isAbsolute(candidatePath)) {
      const relativePath = path.relative(rootPath, candidatePath);
      if (isRelativeWithinRoot(relativePath)) {
        pushTarget(relativePath, candidatePath);
      }
      pushTarget(fallbackRelativePath ?? candidatePath, candidatePath);
    } else {
      const extractedRelativePath = extractMirrorRelativePath(rootPath, candidatePath);
      if (extractedRelativePath) {
        pushTarget(extractedRelativePath, path.join(rootPath, extractedRelativePath));
      }
      pushTarget(candidatePath, path.join(rootPath, candidatePath));
    }
  }

  if (fallbackRelativePath) {
    pushTarget(fallbackRelativePath, path.join(rootPath, fallbackRelativePath));
  }

  for (const candidate of candidates) {
    try {
      const details = await stat(candidate.absolutePath);
      if (details.isFile()) {
        return candidate;
      }
    } catch {
      // Continue to the next candidate.
    }
  }

  return candidates[0] ?? {
    displayPath: fallbackRelativePath ?? String(candidatePath ?? "manifest.json"),
    absolutePath: path.join(rootPath, fallbackRelativePath ?? String(candidatePath ?? "manifest.json")),
  };
}

function createDiagnostic(ruleId, filePath, message, severity = "error") {
  return { severity, ruleId, filePath, message };
}

function createIssue(ruleId, filePath, message) {
  return createDiagnostic(ruleId, filePath, message, "error");
}

function createWarning(ruleId, filePath, message) {
  return createDiagnostic(ruleId, filePath, message, "warning");
}

function formatDiagnostic(diagnostic) {
  const prefix = diagnostic.severity === "warning" ? "WARN" : "ERROR";
  return `${prefix} [${diagnostic.ruleId}] ${diagnostic.filePath}: ${diagnostic.message}`;
}

export function parseSpecMetadataBlock(markdown) {
  const metadata = {};
  const lines = markdown.split(/\r?\n/u);
  let foundMetadata = false;

  for (const line of lines) {
    if (line.trim() === "") {
      if (foundMetadata) {
        break;
      }
      continue;
    }

    const match = line.match(/^([A-Za-z][A-Za-z ]+):\s*(.+)$/u);
    if (!match) {
      break;
    }

    foundMetadata = true;
    metadata[match[1]] = match[2].trim();
  }

  return foundMetadata ? metadata : null;
}

async function readSpecTitle(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const headingMatch = content.match(/^#\s+(.+)$/mu);
    return headingMatch ? headingMatch[1].trim() : null;
  } catch {
    return null;
  }
}

function normalizeTitle(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function normalizeTitleKey(value) {
  return normalizeTitle(value).replace(/ +/gu, "_");
}

function normalizeSlug(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function normalizeSourcePath(value) {
  return path.posix.normalize(value).toLowerCase();
}

function normalizeAddendumBaseTitle(value) {
  return normalizeTitle(value)
    .replace(/\b(addendum|appendix|amendment|supplement)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isLikelyAddendumTitle(value) {
  return /\b(addendum|appendix|amendment|supplement)\b/iu.test(value);
}

function formatReferenceList(references) {
  return references.map((reference) => `"${reference}"`).join(", ");
}

function pushDuplicateDiagnostics(diagnostics, kind, records, normalizeValue) {
  const seen = new Map();

  for (const record of records) {
    if (!record.value) {
      continue;
    }

    const normalizedValue = normalizeValue(record.value);
    const matches = seen.get(normalizedValue) ?? [];
    matches.push(record);
    seen.set(normalizedValue, matches);
  }

  for (const [normalizedValue, matches] of seen.entries()) {
    if (matches.length < 2) {
      continue;
    }

    for (const match of matches) {
      diagnostics.push(
        createIssue(
          RULE_IDS.duplicateSpec,
          match.filePath,
          `duplicate ${kind} "${normalizedValue}" also seen in ${formatReferenceList(
            matches.filter((candidate) => candidate.reference !== match.reference).map((candidate) => candidate.reference)
          )}`
        )
      );
    }
  }
}

async function collectSpecIdentity(rootPath, entry, index) {
  const specDirectory = entry.spec_directory ?? entry.slug ?? `entries[${index}]`;
  const fallbackOverviewPath = path.posix.join(specDirectory, GENERATED_FILE_NAMES.overview);
  const overviewTarget = await resolveMirrorFileTarget(rootPath, entry.generated_files?.overview, fallbackOverviewPath);
  const title = typeof entry.title === "string" ? entry.title : await readSpecTitle(overviewTarget.absolutePath);
  const reference =
    entry.manifestFormat === "object-map"
      ? `manifest[${JSON.stringify(entry.manifestTitle)}] (${specDirectory})`
      : `entries[${index}] (${specDirectory})`;

  return {
    reference,
    specDirectory,
    filePath: overviewTarget.displayPath,
    title,
    slug: specDirectory,
    sourcePath: entry.source_combined_file,
  };
}

async function validateSpecIdentities(rootPath, manifestEntries) {
  const issues = [];
  const warnings = [];
  const identities = await Promise.all(
    manifestEntries.map((entry, index) => collectSpecIdentity(rootPath, entry, index))
  );

  pushDuplicateDiagnostics(
    issues,
    "title",
    identities.map((identity) => ({
      reference: identity.reference,
      filePath: identity.filePath,
      value: identity.title,
    })),
    normalizeTitle
  );
  pushDuplicateDiagnostics(
    issues,
    "spec directory",
    identities.map((identity) => ({
      reference: identity.reference,
      filePath: `${identity.specDirectory}/manifest.json`,
      value: identity.slug,
    })),
    normalizeSlug
  );
  pushDuplicateDiagnostics(
    issues,
    "source path",
    identities.map((identity) => ({
      reference: identity.reference,
      filePath: identity.sourcePath ?? `${identity.specDirectory}/source.md`,
      value: identity.sourcePath,
    })),
    normalizeSourcePath
  );

  for (let index = 0; index < identities.length; index += 1) {
    const current = identities[index];
    if (!current.title) {
      continue;
    }

    for (let otherIndex = index + 1; otherIndex < identities.length; otherIndex += 1) {
      const other = identities[otherIndex];
      if (!other.title) {
        continue;
      }

      const currentBase = normalizeAddendumBaseTitle(current.title);
      const otherBase = normalizeAddendumBaseTitle(other.title);
      if (!currentBase || currentBase !== otherBase) {
        continue;
      }

      if (normalizeTitle(current.title) === normalizeTitle(other.title)) {
        continue;
      }

      if (!isLikelyAddendumTitle(current.title) && !isLikelyAddendumTitle(other.title)) {
        continue;
      }

      warnings.push(
        createWarning(
          RULE_IDS.addendumWarning,
          other.filePath,
          `title overlaps with "${current.title}" from ${current.filePath}`
        )
      );
    }
  }

  return { issues, warnings };
}

function validateCanonicalRelativePath(specDirectory, actualValue, expectedBaseName, filePath, issues) {
  const expectedValue = path.posix.join(specDirectory, expectedBaseName);
  if (actualValue !== expectedValue) {
    issues.push(
      createIssue(
        RULE_IDS.manifestPathMismatch,
        filePath,
        `expected path "${expectedValue}" but found "${actualValue}"`
      )
    );
  }
}

async function validateExistingFile(relativePath, absolutePath, issues) {
  try {
    const details = await stat(absolutePath);
    if (!details.isFile()) {
      issues.push(createIssue(RULE_IDS.manifestMissingEntry, relativePath, "expected a file referenced by the manifest"));
      return false;
    }
    return true;
  } catch {
    issues.push(createIssue(RULE_IDS.manifestMissingEntry, relativePath, "referenced file is missing"));
    return false;
  }
}

function pushMissingMetadataField(issues, relativePath, fieldName) {
  issues.push(createIssue(RULE_IDS.metaMissingField, relativePath, `missing metadata field "${fieldName}"`));
}

async function validateSpecPageMetadata(relativePath, absolutePath, issues, warnings) {
  const fileName = path.basename(relativePath);
  const requirements = SPEC_METADATA_REQUIREMENTS[fileName];
  if (!requirements) {
    return;
  }

  const content = await readFile(absolutePath, "utf8");
  const metadata = parseSpecMetadataBlock(content);

  if (!metadata) {
    for (const field of requirements.requiredFields) {
      pushMissingMetadataField(issues, relativePath, field);
    }
    pushMissingMetadataField(issues, relativePath, requirements.sourceFields.join(" or "));
    for (const linkedPage of requirements.linkedPages) {
      pushMissingMetadataField(issues, relativePath, linkedPage);
    }
    return;
  }

  for (const field of requirements.requiredFields) {
    if (!metadata[field]) {
      pushMissingMetadataField(issues, relativePath, field);
    }
  }

  const sourceField = requirements.sourceFields.find((field) => metadata[field]);
  if (!sourceField) {
    pushMissingMetadataField(issues, relativePath, requirements.sourceFields.join(" or "));
  }

  const declaredSpecType = metadata["Spec Type"];
  if (declaredSpecType && declaredSpecType !== requirements.specType) {
    issues.push(
      createIssue(
        RULE_IDS.metaWrongSpecType,
        relativePath,
        `Spec Type must be "${requirements.specType}" (got "${declaredSpecType}")`
      )
    );
  }

  const specDirectory = path.dirname(relativePath);
  if (sourceField) {
    validateCanonicalRelativePath(specDirectory, metadata[sourceField], "source.md", relativePath, issues);
  }

  for (const linkedPage of requirements.linkedPages) {
    const linkedValue = metadata[linkedPage];
    if (!linkedValue) {
      pushMissingMetadataField(issues, relativePath, linkedPage);
      continue;
    }

    validateCanonicalRelativePath(specDirectory, linkedValue, GENERATED_FILE_NAMES[linkedPage], relativePath, issues);
  }

  const status = metadata.Status;
  if (!status) {
    return;
  }

  if (VALID_STATUSES.has(status)) {
    return;
  }

  if (status === LEGACY_DRAFT_STATUS) {
    warnings.push(
      createWarning(
        RULE_IDS.metaInvalidStatus,
        relativePath,
        'legacy Status "Draft" should be replaced with "draft v0" or "draft v1"'
      )
    );
    return;
  }

  issues.push(
    createIssue(
      RULE_IDS.metaInvalidStatus,
      relativePath,
      `invalid Status "${status}"; expected one of: ${STATUS_LIST}`
    )
  );
}

async function validateManifestEntry(rootPath, entry, index) {
  if (entry.manifestFormat === "object-map") {
    return validateObjectMapManifestEntry(rootPath, entry);
  }

  const issues = [];
  const warnings = [];
  const manifestPath = "manifest.json";

  if (!entry.spec_directory || typeof entry.spec_directory !== "string") {
    issues.push(
      createIssue(RULE_IDS.manifestMissingEntry, manifestPath, `entries[${index}].spec_directory must be a string`)
    );
    return { issues, warnings };
  }

  const specDirectoryPath = path.join(rootPath, entry.spec_directory);
  try {
    const details = await stat(specDirectoryPath);
    if (!details.isDirectory()) {
      issues.push(
        createIssue(
          RULE_IDS.manifestMissingEntry,
          entry.spec_directory,
          "spec directory must exist as a directory"
        )
      );
    }
  } catch {
    issues.push(createIssue(RULE_IDS.manifestMissingEntry, entry.spec_directory, "spec directory is missing"));
  }

  if (!entry.source_combined_file || typeof entry.source_combined_file !== "string") {
    issues.push(
      createIssue(
        RULE_IDS.manifestMissingEntry,
        manifestPath,
        `entries[${index}].source_combined_file must be a string`
      )
    );
  } else {
    validateCanonicalRelativePath(
      entry.spec_directory,
      entry.source_combined_file,
      "source.md",
      manifestPath,
      issues
    );
    await validateExistingFile(entry.source_combined_file, path.join(rootPath, entry.source_combined_file), issues);
  }

  if (!entry.title_key || typeof entry.title_key !== "string") {
    issues.push(createIssue(RULE_IDS.manifestMissingEntry, manifestPath, `entries[${index}].title_key must be a string`));
  }

  const generatedFiles = entry.generated_files;
  if (!generatedFiles || typeof generatedFiles !== "object") {
    issues.push(
      createIssue(RULE_IDS.manifestMissingEntry, manifestPath, `entries[${index}].generated_files must be an object`)
    );
  } else {
    for (const [key, expectedBaseName] of Object.entries(GENERATED_FILE_NAMES)) {
      const value = generatedFiles[key];

      if (!value || typeof value !== "string") {
        issues.push(
          createIssue(
            RULE_IDS.manifestMissingEntry,
            manifestPath,
            `entries[${index}].generated_files.${key} must be a string`
          )
        );
        continue;
      }

      validateCanonicalRelativePath(entry.spec_directory, value, expectedBaseName, manifestPath, issues);
      const fileExists = await validateExistingFile(value, path.join(rootPath, value), issues);
      if (fileExists) {
        await validateSpecPageMetadata(value, path.join(rootPath, value), issues, warnings);
      }
    }
  }

  if (typeof entry.title_key === "string" && typeof generatedFiles?.overview === "string") {
    const overviewTitle = await readSpecTitle(path.join(rootPath, generatedFiles.overview));
    if (overviewTitle) {
      const expectedTitleKey = normalizeTitleKey(overviewTitle);
      if (entry.title_key !== expectedTitleKey) {
        issues.push(
          createIssue(
            RULE_IDS.manifestTitleKeyMismatch,
            manifestPath,
            `entries[${index}].title_key must be "${expectedTitleKey}" but found "${entry.title_key}"`
          )
        );
      }
    }
  }

  return { issues, warnings };
}

async function validateObjectMapManifestEntry(rootPath, entry) {
  const issues = [];
  const warnings = [];
  const manifestPath = "manifest.json";
  const entryPrefix = `manifest[${JSON.stringify(entry.manifestTitle)}]`;

  if (!entry.slug || typeof entry.slug !== "string") {
    issues.push(createIssue(RULE_IDS.manifestMissingEntry, manifestPath, `${entryPrefix}.slug must be a string`));
    return { issues, warnings };
  }

  const specDirectoryPath = path.join(rootPath, entry.slug);
  try {
    const details = await stat(specDirectoryPath);
    if (!details.isDirectory()) {
      issues.push(createIssue(RULE_IDS.manifestMissingEntry, entry.slug, "spec directory must exist as a directory"));
    }
  } catch {
    issues.push(createIssue(RULE_IDS.manifestMissingEntry, entry.slug, "spec directory is missing"));
  }

  if (entry.source_combined_file !== undefined && typeof entry.source_combined_file !== "string") {
    issues.push(
      createIssue(RULE_IDS.manifestMissingEntry, manifestPath, `${entryPrefix}.source_combined_file must be a string`)
    );
  }

  if (entry.generated_files !== undefined && !isPlainObject(entry.generated_files)) {
    issues.push(createIssue(RULE_IDS.manifestMissingEntry, manifestPath, `${entryPrefix}.generated_files must be an object`));
    return { issues, warnings };
  }

  const generatedFiles = isPlainObject(entry.generated_files) ? entry.generated_files : {};

  for (const [key, expectedBaseName] of Object.entries(GENERATED_FILE_NAMES)) {
    const rawValue = generatedFiles[key];
    if (rawValue !== undefined && typeof rawValue !== "string") {
      issues.push(
        createIssue(
          RULE_IDS.manifestMissingEntry,
          manifestPath,
          `${entryPrefix}.generated_files.${key} must be a string`
        )
      );
      continue;
    }

    const fallbackRelativePath = path.posix.join(entry.slug, expectedBaseName);
    const resolvedTarget = await resolveMirrorFileTarget(rootPath, rawValue, fallbackRelativePath);
    await validateExistingFile(resolvedTarget.displayPath, resolvedTarget.absolutePath, issues);
  }

  return { issues, warnings };
}

function normalizeManifest(manifest) {
  if (!isPlainObject(manifest)) {
    return {
      issues: [
        createIssue(
          RULE_IDS.manifestShape,
          "manifest.json",
          'must be either an "entries" array or an object map keyed by spec title'
        ),
      ],
      entries: [],
    };
  }

  if (Object.hasOwn(manifest, "entries")) {
    if (!Array.isArray(manifest.entries)) {
      return {
        issues: [
          createIssue(
            RULE_IDS.manifestShape,
            "manifest.json",
            'must be either an "entries" array or an object map keyed by spec title'
          ),
        ],
        entries: [],
      };
    }

    return {
      issues: [],
      entries: manifest.entries.map((entry) => ({ ...entry, manifestFormat: "entries-array" })),
    };
  }

  return {
    issues: [],
    entries: Object.entries(manifest).map(([manifestTitle, entry]) => ({
      ...(isPlainObject(entry) ? entry : {}),
      manifestFormat: "object-map",
      manifestTitle,
      title: isPlainObject(entry) && typeof entry.title === "string" ? entry.title : manifestTitle,
    })),
  };
}

export async function validateSpecMirror(rootPath) {
  const manifestPath = path.join(rootPath, "manifest.json");
  const manifest = await loadJson(manifestPath);
  const normalizedManifest = normalizeManifest(manifest);

  if (normalizedManifest.issues.length > 0) {
    return { issues: normalizedManifest.issues, warnings: [] };
  }

  const issues = [];
  const warnings = [];
  for (const [index, entry] of normalizedManifest.entries.entries()) {
    const result = await validateManifestEntry(rootPath, entry, index);
    issues.push(...result.issues);
    warnings.push(...result.warnings);
  }

  const identityResult = await validateSpecIdentities(rootPath, normalizedManifest.entries);
  issues.push(...identityResult.issues);
  warnings.push(...identityResult.warnings);

  return { issues, warnings };
}

export async function run(argv = process.argv.slice(2)) {
  try {
    const { inputPath, requireMirror } = parseArgs(argv);
    const resolvedInput = path.resolve(inputPath);

    if (!(await pathExists(resolvedInput))) {
      console.log(`spec mirror not found at ${inputPath}; nothing to validate`);
      return requireMirror ? 2 : 0;
    }

    const { issues, warnings } = await validateSpecMirror(resolvedInput);
    for (const warning of warnings) {
      console.warn(formatDiagnostic(warning));
    }

    if (issues.length > 0) {
      for (const issue of issues) {
        console.error(formatDiagnostic(issue));
      }
      return 1;
    }

    console.log(`spec hygiene ok for ${inputPath}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await run();
  process.exit(exitCode);
}
