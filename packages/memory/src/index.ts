import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AnalyzerResult,
  FileChange,
  Finding,
  ImpactedArea,
  RiskLevel
} from "@submuxhq/codedecay-core";
import { dedupeStrings } from "@submuxhq/codedecay-core";

export interface CodeDecayMemory {
  version: 1;
  flows: MemoryFlow[];
  commands: MemoryCommand[];
  invariants: MemoryInvariant[];
  architecture: MemoryArchitectureNote[];
  regressions: MemoryRegression[];
}

export interface MemoryMatcher {
  files?: string[] | undefined;
  areas?: ImpactedArea["kind"][] | undefined;
}

export interface MemoryFlow extends MemoryMatcher {
  name: string;
  description?: string | undefined;
  checks?: string[] | undefined;
}

export interface MemoryCommand extends MemoryMatcher {
  name: string;
  command: string;
  description?: string | undefined;
}

export interface MemoryInvariant extends MemoryMatcher {
  name: string;
  description: string;
  severity?: RiskLevel | undefined;
}

export interface MemoryArchitectureNote extends MemoryMatcher {
  title: string;
  note: string;
}

export interface MemoryRegression extends MemoryMatcher {
  title: string;
  description: string;
  check?: string | undefined;
  severity?: RiskLevel | undefined;
}

export interface LoadedCodeDecayMemory {
  memory: CodeDecayMemory;
  sourcePath?: string | undefined;
}

export interface MemoryImportCounts {
  flows: number;
  commands: number;
  invariants: number;
  architecture: number;
  regressions: number;
}

export interface MemoryImportResult {
  memory: CodeDecayMemory;
  added: MemoryImportCounts;
  merged: MemoryImportCounts;
}

export type MemoryProviderKind = "local" | "external";

export interface MemoryProviderLoadOptions {
  rootDir: string;
}

export interface MemoryProvider {
  id: string;
  name: string;
  kind: MemoryProviderKind;
  load(options: MemoryProviderLoadOptions): LoadedCodeDecayMemory;
}

export interface MemoryContextInput {
  memory: CodeDecayMemory;
  changedFiles: FileChange[];
  impactedAreas: ImpactedArea[];
  analyzerResult: AnalyzerResult;
}

export const DEFAULT_CODEDECAY_MEMORY: CodeDecayMemory = {
  version: 1,
  flows: [],
  commands: [],
  invariants: [],
  architecture: [],
  regressions: []
};

export function loadCodeDecayMemory(rootDir: string): LoadedCodeDecayMemory {
  return createLocalMemoryProvider().load({ rootDir });
}

export function loadCodeDecayMemoryFromProvider(
  provider: MemoryProvider,
  options: MemoryProviderLoadOptions
): LoadedCodeDecayMemory {
  validateMemoryProvider(provider);
  validateMemoryProviderLoadOptions(options);
  return provider.load(options);
}

export function createLocalMemoryProvider(): MemoryProvider {
  return {
    id: "local",
    name: "Local .codedecay memory",
    kind: "local",
    load: ({ rootDir }) => loadLocalMemory(rootDir)
  };
}

export class MemoryProviderRegistry {
  private readonly providers = new Map<string, MemoryProvider>();

  constructor(providers: MemoryProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: MemoryProvider): void {
    validateMemoryProvider(provider);

    if (this.providers.has(provider.id)) {
      throw new Error(`Memory provider already registered: ${provider.id}`);
    }

    this.providers.set(provider.id, provider);
  }

  get(id: string): MemoryProvider | undefined {
    validateNonEmptyString(id, "Memory provider id");
    return this.providers.get(id);
  }

  require(id: string): MemoryProvider {
    const provider = this.get(id);
    if (!provider) {
      throw new Error(`Memory provider not found: ${id}`);
    }

    return provider;
  }

  list(): MemoryProvider[] {
    return [...this.providers.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  load(id: string, options: MemoryProviderLoadOptions): LoadedCodeDecayMemory {
    return loadCodeDecayMemoryFromProvider(this.require(id), options);
  }
}

export function createMemoryProviderRegistry(providers: MemoryProvider[] = [createLocalMemoryProvider()]): MemoryProviderRegistry {
  return new MemoryProviderRegistry(providers);
}

export function importCodeDecayMemory(
  baseMemory: CodeDecayMemory,
  importedValue: unknown,
  sourceName: string = "memory import"
): MemoryImportResult {
  const importedMemory = normalizeImportedMemory(importedValue, sourceName);
  const base = cloneMemory(baseMemory);
  const added = createEmptyMemoryImportCounts();
  const merged = createEmptyMemoryImportCounts();

  return {
    memory: {
      version: 1,
      flows: mergeFlowEntries(base.flows, importedMemory.flows, added, merged),
      commands: mergeCommandEntries(base.commands, importedMemory.commands, added, merged),
      invariants: mergeInvariantEntries(base.invariants, importedMemory.invariants, added, merged),
      architecture: mergeArchitectureEntries(base.architecture, importedMemory.architecture, added, merged),
      regressions: mergeRegressionEntries(base.regressions, importedMemory.regressions, added, merged)
    },
    added,
    merged
  };
}

export function writeCodeDecayMemory(rootDir: string, memory: CodeDecayMemory): string {
  const directory = join(rootDir, ".codedecay");
  const sourcePath = join(directory, "memory.json");
  mkdirSync(directory, { recursive: true });
  writeFileSync(sourcePath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  return sourcePath;
}

export function applyMemoryContext(input: MemoryContextInput): AnalyzerResult {
  if (isEmptyMemory(input.memory)) {
    return input.analyzerResult;
  }

  const findings = [...input.analyzerResult.findings];
  const recommendedTests = [...input.analyzerResult.recommendedTests];

  for (const invariant of input.memory.invariants) {
    const match = firstMatchingFile(invariant, input.changedFiles, input.impactedAreas);
    if (!match) {
      continue;
    }

    findings.push({
      ruleId: "memory-invariant-impacted",
      title: "Project invariant may be impacted",
      description: `Memory invariant "${invariant.name}" applies to this change. ${invariant.description}`,
      severity: invariant.severity ?? "medium",
      category: "regression",
      file: match.path,
      line: firstLine(match)
    });
    recommendedTests.push(`Verify invariant: ${invariant.name}`);
  }

  for (const regression of input.memory.regressions) {
    const match = firstMatchingFile(regression, input.changedFiles, input.impactedAreas);
    if (!match) {
      continue;
    }

    findings.push({
      ruleId: "memory-past-regression-area",
      title: "Past regression area changed",
      description: `Past regression "${regression.title}" may be relevant. ${regression.description}`,
      severity: regression.severity ?? "high",
      category: "regression",
      file: match.path,
      line: firstLine(match)
    });
    recommendedTests.push(regression.check ? `Regression check: ${regression.check}` : `Regression check: ${regression.title}`);
  }

  for (const flow of input.memory.flows) {
    if (!matchesMemoryEntry(flow, input.changedFiles, input.impactedAreas)) {
      continue;
    }

    recommendedTests.push(`Verify flow: ${flow.name}`);
    recommendedTests.push(...(flow.checks ?? []).map((check) => `Flow check (${flow.name}): ${check}`));
  }

  for (const command of input.memory.commands) {
    if (!matchesMemoryEntry(command, input.changedFiles, input.impactedAreas)) {
      continue;
    }

    recommendedTests.push(`Run project command: ${command.name} (${command.command})`);
  }

  for (const note of input.memory.architecture) {
    const match = firstMatchingFile(note, input.changedFiles, input.impactedAreas);
    if (!match) {
      continue;
    }

    findings.push({
      ruleId: "memory-architecture-note",
      title: "Architecture note applies",
      description: `${note.title}: ${note.note}`,
      severity: "low",
      category: "regression",
      file: match.path,
      line: firstLine(match)
    });
  }

  return {
    ...input.analyzerResult,
    findings,
    recommendedTests: dedupeStrings(recommendedTests)
  };
}

function normalizeImportedMemory(value: unknown, sourcePath: string): CodeDecayMemory {
  const object = normalizeObject(value, sourcePath, "root");
  if (object.version !== undefined && object.version !== 1) {
    throw new Error(`Invalid CodeDecay memory import at ${sourcePath}: version must be 1.`);
  }

  const flows = normalizeArray(object.flows, sourcePath, "flows").map((item, index) => normalizeFlow(item, index, sourcePath));
  const commands = normalizeArray(object.commands, sourcePath, "commands").map((item, index) => normalizeCommand(item, index, sourcePath));
  const invariants = normalizeArray(object.invariants, sourcePath, "invariants").map((item, index) => normalizeInvariant(item, index, sourcePath));
  const architecture = normalizeArray(object.architecture, sourcePath, "architecture").map((item, index) =>
    normalizeArchitectureNote(item, index, sourcePath)
  );
  const regressions = normalizeArray(object.regressions, sourcePath, "regressions").map((item, index) =>
    normalizeRegression(item, index, sourcePath)
  );
  const ciFailures = normalizeArray(object.ciFailures, sourcePath, "ciFailures").map((item, index) =>
    normalizeImportedRegression(item, index, sourcePath, "ciFailures")
  );
  const incidents = normalizeArray(object.incidents, sourcePath, "incidents").map((item, index) =>
    normalizeImportedRegression(item, index, sourcePath, "incidents")
  );
  const pullRequests = normalizeArray(object.pullRequests, sourcePath, "pullRequests").map((item, index) =>
    normalizeImportedPullRequest(item, index, sourcePath)
  );

  return {
    version: 1,
    flows: sortFlows([...flows, ...pullRequests.flatMap((entry) => entry.flows)]),
    commands: sortCommands([...commands, ...pullRequests.flatMap((entry) => entry.commands)]),
    invariants: sortInvariants(invariants),
    architecture: sortArchitecture([...architecture, ...pullRequests.flatMap((entry) => entry.architecture)]),
    regressions: sortRegressions([
      ...regressions,
      ...ciFailures,
      ...incidents,
      ...pullRequests.flatMap((entry) => entry.regressions)
    ])
  };
}

function normalizeImportedRegression(
  value: unknown,
  index: number,
  sourcePath: string,
  field: "ciFailures" | "incidents"
): MemoryRegression {
  const object = normalizeObject(value, sourcePath, `${field}[${index}]`);
  return {
    title: requiredString(object.title ?? object.name, sourcePath, `${field}[${index}].title`),
    description: requiredString(object.description ?? object.summary, sourcePath, `${field}[${index}].description`),
    check: optionalString(object.check, sourcePath, `${field}[${index}].check`),
    severity: optionalRiskLevel(object.severity, sourcePath, `${field}[${index}].severity`) ?? "high",
    ...normalizeMatcher(object, sourcePath, `${field}[${index}]`)
  };
}

function normalizeImportedPullRequest(
  value: unknown,
  index: number,
  sourcePath: string
): {
  flows: MemoryFlow[];
  commands: MemoryCommand[];
  architecture: MemoryArchitectureNote[];
  regressions: MemoryRegression[];
} {
  const object = normalizeObject(value, sourcePath, `pullRequests[${index}]`);
  const title = requiredString(object.title, sourcePath, `pullRequests[${index}].title`);
  const description =
    optionalString(object.description, sourcePath, `pullRequests[${index}].description`) ??
    optionalString(object.summary, sourcePath, `pullRequests[${index}].summary`) ??
    `Merged PR learning for ${title}.`;
  const matcher = normalizeMatcher(object, sourcePath, `pullRequests[${index}]`);
  const checks = optionalStringArray(object.checks, sourcePath, `pullRequests[${index}].checks`) ?? [];
  const command = optionalString(object.command, sourcePath, `pullRequests[${index}].command`);

  return {
    flows:
      checks.length > 0
        ? [
            {
              name: title,
              description,
              checks,
              ...matcher
            }
          ]
        : [],
    commands:
      command
        ? [
            {
              name: `${title} check`,
              command,
              description,
              ...matcher
            }
          ]
        : [],
    architecture: [
      {
        title,
        note: description,
        ...matcher
      }
    ],
    regressions:
      checks.length > 0
        ? [
            {
              title,
              description,
              check: checks[0],
              severity: "medium",
              ...matcher
            }
          ]
        : []
  };
}

function loadLocalMemory(rootDir: string): LoadedCodeDecayMemory {
  const sourcePath = join(rootDir, ".codedecay", "memory.json");
  if (!existsSync(sourcePath)) {
    return {
      memory: cloneMemory(DEFAULT_CODEDECAY_MEMORY)
    };
  }

  const raw = readFileSync(sourcePath, "utf8");
  return {
    memory: normalizeMemory(parseJsonMemory(raw, sourcePath), sourcePath),
    sourcePath
  };
}

function validateMemoryProvider(provider: MemoryProvider): void {
  validateNonEmptyString(provider.id, "Memory provider id");
  validateNonEmptyString(provider.name, "Memory provider name");

  if (provider.kind !== "local" && provider.kind !== "external") {
    throw new Error(`Invalid memory provider kind: ${String(provider.kind)}`);
  }

  if (typeof provider.load !== "function") {
    throw new Error(`Memory provider "${provider.id}" must define load().`);
  }
}

function validateMemoryProviderLoadOptions(options: MemoryProviderLoadOptions): void {
  validateNonEmptyString(options.rootDir, "Memory provider rootDir");
}

function validateNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
}

function parseJsonMemory(raw: string, sourcePath: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid CodeDecay memory at ${sourcePath}: ${message}`);
  }
}

function normalizeMemory(value: unknown, sourcePath: string): CodeDecayMemory {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid CodeDecay memory at ${sourcePath}: expected an object.`);
  }

  if (value.version !== 1) {
    throw new Error(`Invalid CodeDecay memory at ${sourcePath}: version must be 1.`);
  }

  return {
    version: 1,
    flows: normalizeArray(value.flows, sourcePath, "flows").map((item, index) => normalizeFlow(item, index, sourcePath)),
    commands: normalizeArray(value.commands, sourcePath, "commands").map((item, index) => normalizeCommand(item, index, sourcePath)),
    invariants: normalizeArray(value.invariants, sourcePath, "invariants").map((item, index) => normalizeInvariant(item, index, sourcePath)),
    architecture: normalizeArray(value.architecture, sourcePath, "architecture").map((item, index) => normalizeArchitectureNote(item, index, sourcePath)),
    regressions: normalizeArray(value.regressions, sourcePath, "regressions").map((item, index) => normalizeRegression(item, index, sourcePath))
  };
}

function normalizeFlow(value: unknown, index: number, sourcePath: string): MemoryFlow {
  const object = normalizeObject(value, sourcePath, `flows[${index}]`);
  return {
    name: requiredString(object.name, sourcePath, `flows[${index}].name`),
    description: optionalString(object.description, sourcePath, `flows[${index}].description`),
    checks: optionalStringArray(object.checks, sourcePath, `flows[${index}].checks`),
    ...normalizeMatcher(object, sourcePath, `flows[${index}]`)
  };
}

function normalizeCommand(value: unknown, index: number, sourcePath: string): MemoryCommand {
  const object = normalizeObject(value, sourcePath, `commands[${index}]`);
  return {
    name: requiredString(object.name, sourcePath, `commands[${index}].name`),
    command: requiredString(object.command, sourcePath, `commands[${index}].command`),
    description: optionalString(object.description, sourcePath, `commands[${index}].description`),
    ...normalizeMatcher(object, sourcePath, `commands[${index}]`)
  };
}

function normalizeInvariant(value: unknown, index: number, sourcePath: string): MemoryInvariant {
  const object = normalizeObject(value, sourcePath, `invariants[${index}]`);
  return {
    name: requiredString(object.name, sourcePath, `invariants[${index}].name`),
    description: requiredString(object.description, sourcePath, `invariants[${index}].description`),
    severity: optionalRiskLevel(object.severity, sourcePath, `invariants[${index}].severity`),
    ...normalizeMatcher(object, sourcePath, `invariants[${index}]`)
  };
}

function normalizeArchitectureNote(value: unknown, index: number, sourcePath: string): MemoryArchitectureNote {
  const object = normalizeObject(value, sourcePath, `architecture[${index}]`);
  return {
    title: requiredString(object.title, sourcePath, `architecture[${index}].title`),
    note: requiredString(object.note, sourcePath, `architecture[${index}].note`),
    ...normalizeMatcher(object, sourcePath, `architecture[${index}]`)
  };
}

function normalizeRegression(value: unknown, index: number, sourcePath: string): MemoryRegression {
  const object = normalizeObject(value, sourcePath, `regressions[${index}]`);
  return {
    title: requiredString(object.title, sourcePath, `regressions[${index}].title`),
    description: requiredString(object.description, sourcePath, `regressions[${index}].description`),
    check: optionalString(object.check, sourcePath, `regressions[${index}].check`),
    severity: optionalRiskLevel(object.severity, sourcePath, `regressions[${index}].severity`),
    ...normalizeMatcher(object, sourcePath, `regressions[${index}]`)
  };
}

function normalizeMatcher(object: Record<string, unknown>, sourcePath: string, field: string): MemoryMatcher {
  const matcher: MemoryMatcher = {};
  const files = optionalStringArray(object.files, sourcePath, `${field}.files`);
  const areas = optionalAreas(object.areas, sourcePath, `${field}.areas`);

  if (files) {
    matcher.files = files;
  }

  if (areas) {
    matcher.areas = areas;
  }

  return matcher;
}

function mergeFlowEntries(
  baseEntries: MemoryFlow[],
  importedEntries: MemoryFlow[],
  added: MemoryImportCounts,
  merged: MemoryImportCounts
): MemoryFlow[] {
  return sortFlows(mergeNamedEntries(baseEntries, importedEntries, "flows", added, merged, mergeFlow));
}

function mergeCommandEntries(
  baseEntries: MemoryCommand[],
  importedEntries: MemoryCommand[],
  added: MemoryImportCounts,
  merged: MemoryImportCounts
): MemoryCommand[] {
  const map = new Map(baseEntries.map((entry) => [commandKey(entry), cloneCommand(entry)]));
  for (const entry of importedEntries) {
    const key = commandKey(entry);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, cloneCommand(entry));
      added.commands += 1;
      continue;
    }

    map.set(key, mergeCommand(existing, entry));
    merged.commands += 1;
  }

  return sortCommands([...map.values()]);
}

function mergeInvariantEntries(
  baseEntries: MemoryInvariant[],
  importedEntries: MemoryInvariant[],
  added: MemoryImportCounts,
  merged: MemoryImportCounts
): MemoryInvariant[] {
  return sortInvariants(mergeNamedEntries(baseEntries, importedEntries, "invariants", added, merged, mergeInvariant));
}

function mergeArchitectureEntries(
  baseEntries: MemoryArchitectureNote[],
  importedEntries: MemoryArchitectureNote[],
  added: MemoryImportCounts,
  merged: MemoryImportCounts
): MemoryArchitectureNote[] {
  return sortArchitecture(mergeNamedEntries(baseEntries, importedEntries, "architecture", added, merged, mergeArchitectureNote));
}

function mergeRegressionEntries(
  baseEntries: MemoryRegression[],
  importedEntries: MemoryRegression[],
  added: MemoryImportCounts,
  merged: MemoryImportCounts
): MemoryRegression[] {
  return sortRegressions(mergeNamedEntries(baseEntries, importedEntries, "regressions", added, merged, mergeRegression));
}

function mergeNamedEntries<
  T extends {
    name?: string;
    title?: string;
    files?: string[] | undefined;
    areas?: ImpactedArea["kind"][] | undefined;
  }
>(
  baseEntries: T[],
  importedEntries: T[],
  section: keyof MemoryImportCounts,
  added: MemoryImportCounts,
  merged: MemoryImportCounts,
  mergeEntry: (existing: T, incoming: T) => T
): T[] {
  const map = new Map(baseEntries.map((entry) => [namedKey(entry), structuredCloneEntry(entry)]));
  for (const entry of importedEntries) {
    const key = namedKey(entry);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, structuredCloneEntry(entry));
      added[section] += 1;
      continue;
    }

    map.set(key, mergeEntry(existing, entry));
    merged[section] += 1;
  }

  return [...map.values()];
}

function mergeFlow(existing: MemoryFlow, incoming: MemoryFlow): MemoryFlow {
  return {
    name: existing.name,
    description: firstDefinedString(existing.description, incoming.description),
    files: mergeOptionalStringArrays(existing.files, incoming.files),
    areas: mergeOptionalAreas(existing.areas, incoming.areas),
    checks: mergeOptionalStringArrays(existing.checks, incoming.checks)
  };
}

function mergeCommand(existing: MemoryCommand, incoming: MemoryCommand): MemoryCommand {
  return {
    name: existing.name,
    command: existing.command,
    description: firstDefinedString(existing.description, incoming.description),
    files: mergeOptionalStringArrays(existing.files, incoming.files),
    areas: mergeOptionalAreas(existing.areas, incoming.areas)
  };
}

function mergeInvariant(existing: MemoryInvariant, incoming: MemoryInvariant): MemoryInvariant {
  return {
    name: existing.name,
    description: firstDefinedString(existing.description, incoming.description) ?? existing.description,
    severity: higherRisk(existing.severity, incoming.severity),
    files: mergeOptionalStringArrays(existing.files, incoming.files),
    areas: mergeOptionalAreas(existing.areas, incoming.areas)
  };
}

function mergeArchitectureNote(existing: MemoryArchitectureNote, incoming: MemoryArchitectureNote): MemoryArchitectureNote {
  return {
    title: existing.title,
    note: firstDefinedString(existing.note, incoming.note) ?? existing.note,
    files: mergeOptionalStringArrays(existing.files, incoming.files),
    areas: mergeOptionalAreas(existing.areas, incoming.areas)
  };
}

function mergeRegression(existing: MemoryRegression, incoming: MemoryRegression): MemoryRegression {
  return {
    title: existing.title,
    description: firstDefinedString(existing.description, incoming.description) ?? existing.description,
    check: firstDefinedString(existing.check, incoming.check),
    severity: higherRisk(existing.severity, incoming.severity),
    files: mergeOptionalStringArrays(existing.files, incoming.files),
    areas: mergeOptionalAreas(existing.areas, incoming.areas)
  };
}

function matchesMemoryEntry(entry: MemoryMatcher, changedFiles: FileChange[], impactedAreas: ImpactedArea[]): boolean {
  return Boolean(firstMatchingFile(entry, changedFiles, impactedAreas));
}

function firstMatchingFile(
  entry: MemoryMatcher,
  changedFiles: FileChange[],
  impactedAreas: ImpactedArea[]
): FileChange | undefined {
  const matchingAreaFiles = new Set(
    impactedAreas
      .filter((area) => entry.areas?.includes(area.kind))
      .flatMap((area) => area.files)
  );

  return changedFiles.find((file) => {
    if (matchingAreaFiles.has(file.path)) {
      return true;
    }

    return entry.files?.some((pattern) => matchesPathPattern(file.path, pattern)) ?? false;
  });
}

function matchesPathPattern(path: string, pattern: string): boolean {
  if (pattern === path) {
    return true;
  }

  if (!pattern.includes("*")) {
    return path.includes(pattern);
  }

  const regex = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
  return regex.test(path);
}

function normalizeArray(value: unknown, sourcePath: string, field: string): unknown[] {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  throw new Error(`Invalid CodeDecay memory at ${sourcePath}: ${field} must be an array.`);
}

function normalizeObject(value: unknown, sourcePath: string, field: string): Record<string, unknown> {
  if (isPlainObject(value)) {
    return value;
  }

  throw new Error(`Invalid CodeDecay memory at ${sourcePath}: ${field} must be an object.`);
}

function requiredString(value: unknown, sourcePath: string, field: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new Error(`Invalid CodeDecay memory at ${sourcePath}: ${field} is required.`);
}

function optionalString(value: unknown, sourcePath: string, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  throw new Error(`Invalid CodeDecay memory at ${sourcePath}: ${field} must be a string.`);
}

function optionalStringArray(value: unknown, sourcePath: string, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...value];
  }

  throw new Error(`Invalid CodeDecay memory at ${sourcePath}: ${field} must be a string array.`);
}

function optionalRiskLevel(value: unknown, sourcePath: string, field: string): RiskLevel | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  throw new Error(`Invalid CodeDecay memory at ${sourcePath}: ${field} must be low, medium, or high.`);
}

function optionalAreas(value: unknown, sourcePath: string, field: string): ImpactedArea["kind"][] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const validAreas = new Set(["api", "ui", "database", "auth", "config", "test", "source", "docs"]);
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && validAreas.has(item))) {
    return [...value] as ImpactedArea["kind"][];
  }

  throw new Error(`Invalid CodeDecay memory at ${sourcePath}: ${field} must contain valid impacted area names.`);
}

function createEmptyMemoryImportCounts(): MemoryImportCounts {
  return {
    flows: 0,
    commands: 0,
    invariants: 0,
    architecture: 0,
    regressions: 0
  };
}

function commandKey(command: MemoryCommand): string {
  return `${command.name.toLowerCase()}::${command.command.toLowerCase()}`;
}

function namedKey(entry: { name?: string; title?: string }): string {
  return (entry.name ?? entry.title ?? "").trim().toLowerCase();
}

function firstDefinedString(left: string | undefined, right: string | undefined): string | undefined {
  return left && left.length > 0 ? left : right;
}

function mergeOptionalStringArrays(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const merged = dedupeStrings([...(left ?? []), ...(right ?? [])]);
  return merged.length > 0 ? merged : undefined;
}

function mergeOptionalAreas(
  left: ImpactedArea["kind"][] | undefined,
  right: ImpactedArea["kind"][] | undefined
): ImpactedArea["kind"][] | undefined {
  const merged = dedupeStrings([...(left ?? []), ...(right ?? [])]) as ImpactedArea["kind"][];
  return merged.length > 0 ? merged : undefined;
}

function higherRisk(left: RiskLevel | undefined, right: RiskLevel | undefined): RiskLevel | undefined {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  if (left === "high" || right === "high") {
    return "high";
  }

  if (left === "medium" || right === "medium") {
    return "medium";
  }

  return "low";
}

function cloneCommand(command: MemoryCommand): MemoryCommand {
  return {
    ...command,
    files: command.files ? [...command.files] : undefined,
    areas: command.areas ? [...command.areas] : undefined
  };
}

function structuredCloneEntry<T extends { files?: string[] | undefined; areas?: ImpactedArea["kind"][] | undefined }>(
  entry: T
): T {
  return {
    ...entry,
    files: entry.files ? [...entry.files] : undefined,
    areas: entry.areas ? [...entry.areas] : undefined
  };
}

function sortFlows(entries: MemoryFlow[]): MemoryFlow[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

function sortCommands(entries: MemoryCommand[]): MemoryCommand[] {
  return [...entries].sort((left, right) => `${left.name}:${left.command}`.localeCompare(`${right.name}:${right.command}`));
}

function sortInvariants(entries: MemoryInvariant[]): MemoryInvariant[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

function sortArchitecture(entries: MemoryArchitectureNote[]): MemoryArchitectureNote[] {
  return [...entries].sort((left, right) => left.title.localeCompare(right.title));
}

function sortRegressions(entries: MemoryRegression[]): MemoryRegression[] {
  return [...entries].sort((left, right) => left.title.localeCompare(right.title));
}

function cloneMemory(memory: CodeDecayMemory): CodeDecayMemory {
  return {
    version: 1,
    flows: memory.flows.map((flow) => ({ ...flow, files: flow.files ? [...flow.files] : undefined, areas: flow.areas ? [...flow.areas] : undefined, checks: flow.checks ? [...flow.checks] : undefined })),
    commands: memory.commands.map((command) => ({ ...command, files: command.files ? [...command.files] : undefined, areas: command.areas ? [...command.areas] : undefined })),
    invariants: memory.invariants.map((invariant) => ({ ...invariant, files: invariant.files ? [...invariant.files] : undefined, areas: invariant.areas ? [...invariant.areas] : undefined })),
    architecture: memory.architecture.map((note) => ({ ...note, files: note.files ? [...note.files] : undefined, areas: note.areas ? [...note.areas] : undefined })),
    regressions: memory.regressions.map((regression) => ({ ...regression, files: regression.files ? [...regression.files] : undefined, areas: regression.areas ? [...regression.areas] : undefined }))
  };
}

function isEmptyMemory(memory: CodeDecayMemory): boolean {
  return (
    memory.flows.length === 0 &&
    memory.commands.length === 0 &&
    memory.invariants.length === 0 &&
    memory.architecture.length === 0 &&
    memory.regressions.length === 0
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstLine(change: FileChange): number | undefined {
  return change.addedLines[0]?.line;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
