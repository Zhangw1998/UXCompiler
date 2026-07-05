export interface AiProtocolRequest {
  task: string;
  version: string;
  context?: Record<string, unknown>;
  data?: unknown;
  constraints?: {
    jsonOnly?: boolean;
    doNotGenerateDart?: boolean;
    doNotInventBusinessLogic?: boolean;
    mustReferenceSourceIds?: boolean;
  };
}

export interface AiProtocolOutputItem {
  sourceId: string;
  suggestion: Record<string, unknown>;
  confidence: number;
  reason: string;
}

export interface AiProtocolIssue {
  code:
    | "invalid_json"
    | "invalid_schema"
    | "unknown_source"
    | "forbidden_field"
    | "duplicate_source"
    | "unsafe_input"
    | "missing_constraint";
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface AiProtocolDecision {
  sourceId: string;
  confidence: number;
  gate: "auto_accept" | "review_required" | "rejected";
  suggestion: Record<string, unknown>;
  reason: string;
}

export interface ValidateAiProtocolRequestResult {
  version: string;
  valid: boolean;
  issues: AiProtocolIssue[];
}

export interface ValidateAiProtocolOutputResult {
  version: string;
  status: "accepted" | "partially_accepted" | "rejected";
  accepted: AiProtocolDecision[];
  review: AiProtocolDecision[];
  rejected: AiProtocolDecision[];
  issues: AiProtocolIssue[];
  warnings: Array<{ type: string; message: string }>;
}

export interface ValidateAiProtocolOutputOptions {
  output: unknown;
  allowedSourceIds: Iterable<string>;
  expectedTask?: string;
  autoAcceptConfidence?: number;
  reviewConfidence?: number;
}

const forbiddenFields = new Set([
  "flutterCode",
  "Dart",
  "dart",
  "onTap",
  "navigation",
  "state",
  "absoluteCoordinatesOverride",
  "removeNode"
]);

const rawInputFields = new Set(["rawFigmaScene", "raw_figma_scene", "root", "children", "document"]);
const singularSourceReferenceFields = new Set(["sourceId", "sourceNodeId"]);
const pluralSourceReferenceFields = new Set(["sourceIds", "sourceNodeIds"]);

export function validateAiProtocolRequest(request: unknown): ValidateAiProtocolRequestResult {
  const issues: AiProtocolIssue[] = [];
  const record = recordValue(request);
  if (!record) {
    addIssue(issues, "invalid_schema", "error", "$", "AI request must be a JSON object.");
    return { version: "2.0", valid: false, issues };
  }

  if (!stringValue(record.task)) addIssue(issues, "invalid_schema", "error", "$.task", "AI request requires a task.");
  if (!stringValue(record.version)) addIssue(issues, "invalid_schema", "error", "$.version", "AI request requires a version.");
  const constraints = recordValue(record.constraints);
  if (!constraints?.jsonOnly) addIssue(issues, "missing_constraint", "error", "$.constraints.jsonOnly", "AI request must require JSON-only output.");
  if (!constraints?.doNotGenerateDart) {
    addIssue(issues, "missing_constraint", "error", "$.constraints.doNotGenerateDart", "AI request must forbid Dart generation.");
  }
  if (!constraints?.doNotInventBusinessLogic) {
    addIssue(issues, "missing_constraint", "error", "$.constraints.doNotInventBusinessLogic", "AI request must forbid invented business logic.");
  }
  if (!constraints?.mustReferenceSourceIds) {
    addIssue(issues, "missing_constraint", "error", "$.constraints.mustReferenceSourceIds", "AI request must require source references.");
  }

  for (const path of findForbiddenPaths(record, rawInputFields)) {
    addIssue(issues, "unsafe_input", "error", path, "AI request must use summarized context, not full Raw Figma JSON.");
  }

  return {
    version: "2.0",
    valid: !issues.some((issue) => issue.severity === "error"),
    issues
  };
}

export function validateAiProtocolOutput(options: ValidateAiProtocolOutputOptions): ValidateAiProtocolOutputResult {
  const issues: AiProtocolIssue[] = [];
  const allowedSourceIds = new Set(options.allowedSourceIds);
  const autoAcceptConfidence = options.autoAcceptConfidence ?? 0.9;
  const reviewConfidence = options.reviewConfidence ?? 0.7;
  const parsed = parseOutput(options.output, issues);
  const accepted: AiProtocolDecision[] = [];
  const review: AiProtocolDecision[] = [];
  const rejected: AiProtocolDecision[] = [];
  const seenSourceIds = new Set<string>();

  if (!parsed) return result(accepted, review, rejected, issues);
  if (options.expectedTask && parsed.task !== options.expectedTask) {
    addIssue(issues, "invalid_schema", "error", "$.task", `Expected task ${options.expectedTask}.`);
  }

  for (const path of findForbiddenPaths(parsed, forbiddenFields)) {
    addIssue(issues, "forbidden_field", "error", path, "AI output contains a forbidden field.");
  }
  for (const path of findDartContentPaths(parsed)) {
    addIssue(issues, "forbidden_field", "error", path, "AI output contains Dart or Flutter code.");
  }

  parsed.items.forEach((item, index) => {
    const path = `$.items[${index}]`;
    const itemIssuesBefore = issues.length;
    if (!allowedSourceIds.has(item.sourceId)) addIssue(issues, "unknown_source", "error", `${path}.sourceId`, `Unknown sourceId ${item.sourceId}.`);
    if (seenSourceIds.has(item.sourceId)) addIssue(issues, "duplicate_source", "error", `${path}.sourceId`, `Duplicate sourceId ${item.sourceId}.`);
    seenSourceIds.add(item.sourceId);
    for (const forbiddenPath of findForbiddenPaths(item, forbiddenFields, path)) {
      addIssue(issues, "forbidden_field", "error", forbiddenPath, "AI output item contains a forbidden field.");
    }
    for (const forbiddenPath of findDartContentPaths(item, path)) {
      addIssue(issues, "forbidden_field", "error", forbiddenPath, "AI output item contains Dart or Flutter code.");
    }
    for (const sourceIssue of findSourceReferenceIssues(item.suggestion, allowedSourceIds, `${path}.suggestion`)) {
      addIssue(issues, sourceIssue.code, "error", sourceIssue.path, sourceIssue.message);
    }
    const decision: AiProtocolDecision = {
      sourceId: item.sourceId,
      confidence: item.confidence,
      suggestion: item.suggestion,
      reason: item.reason,
      gate: item.confidence >= autoAcceptConfidence ? "auto_accept" : item.confidence >= reviewConfidence ? "review_required" : "rejected"
    };
    if (issues.length > itemIssuesBefore || decision.gate === "rejected") rejected.push(decision);
    else if (decision.gate === "review_required") review.push(decision);
    else accepted.push(decision);
  });

  return result(accepted, review, rejected, issues);
}

function parseOutput(output: unknown, issues: AiProtocolIssue[]): { task: string; version: string; items: AiProtocolOutputItem[] } | undefined {
  let value = output;
  if (typeof output === "string") {
    try {
      value = JSON.parse(output);
    } catch {
      addIssue(issues, "invalid_json", "error", "$", "AI output must be valid JSON.");
      return undefined;
    }
  }
  const record = recordValue(value);
  if (!record) {
    addIssue(issues, "invalid_schema", "error", "$", "AI output must be a JSON object.");
    return undefined;
  }
  const task = stringValue(record.task);
  const version = stringValue(record.version);
  if (!task) addIssue(issues, "invalid_schema", "error", "$.task", "AI output requires a task.");
  if (!version) addIssue(issues, "invalid_schema", "error", "$.version", "AI output requires a version.");
  const rawItems = Array.isArray(record.items) ? record.items : undefined;
  if (!rawItems) {
    addIssue(issues, "invalid_schema", "error", "$.items", "AI output requires an items array.");
    return undefined;
  }

  const items: AiProtocolOutputItem[] = [];
  rawItems.forEach((entry, index) => {
    const path = `$.items[${index}]`;
    const item = recordValue(entry);
    const sourceId = stringValue(item?.sourceId);
    const suggestion = recordValue(item?.suggestion);
    const confidence = numberValue(item?.confidence);
    const reason = stringValue(item?.reason);
    if (!item) addIssue(issues, "invalid_schema", "error", path, "AI output item must be an object.");
    if (!sourceId) addIssue(issues, "invalid_schema", "error", `${path}.sourceId`, "AI output item requires sourceId.");
    if (!suggestion) addIssue(issues, "invalid_schema", "error", `${path}.suggestion`, "AI output item requires suggestion object.");
    if (confidence === undefined || confidence < 0 || confidence > 1) {
      addIssue(issues, "invalid_schema", "error", `${path}.confidence`, "AI output item confidence must be between 0 and 1.");
    }
    if (!reason) addIssue(issues, "invalid_schema", "error", `${path}.reason`, "AI output item requires reason.");
    if (sourceId && suggestion && confidence !== undefined && reason) items.push({ sourceId, suggestion, confidence, reason });
  });

  return { task: task ?? "", version: version ?? "", items };
}

function result(
  accepted: AiProtocolDecision[],
  review: AiProtocolDecision[],
  rejected: AiProtocolDecision[],
  issues: AiProtocolIssue[]
): ValidateAiProtocolOutputResult {
  const errors = issues.filter((issue) => issue.severity === "error");
  const status = accepted.length > 0 && errors.length === 0 && rejected.length === 0 && review.length === 0
    ? "accepted"
    : accepted.length > 0 || review.length > 0
      ? "partially_accepted"
      : "rejected";
  return {
    version: "2.0",
    status,
    accepted,
    review,
    rejected,
    issues,
    warnings: issues.filter((issue) => issue.severity === "warning").map((issue) => ({ type: issue.code, message: issue.message }))
  };
}

function findForbiddenPaths(value: unknown, forbidden: Set<string>, basePath = "$"): string[] {
  const paths: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => paths.push(...findForbiddenPaths(entry, forbidden, `${basePath}[${index}]`)));
    return paths;
  }
  const record = recordValue(value);
  if (!record) return paths;
  for (const [key, entry] of Object.entries(record)) {
    const path = `${basePath}.${key}`;
    if (forbidden.has(key)) paths.push(path);
    paths.push(...findForbiddenPaths(entry, forbidden, path));
  }
  return paths;
}

function findDartContentPaths(value: unknown, basePath = "$"): string[] {
  const paths: string[] = [];
  if (typeof value === "string") {
    if (/\b(class\s+\w+\s+extends\s+(StatelessWidget|StatefulWidget)|Widget\s+build\s*\(|import\s+['"]package:flutter|Navigator\.|setState\s*\()/u.test(value)) {
      paths.push(basePath);
    }
    return paths;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => paths.push(...findDartContentPaths(entry, `${basePath}[${index}]`)));
    return paths;
  }
  const record = recordValue(value);
  if (!record) return paths;
  for (const [key, entry] of Object.entries(record)) paths.push(...findDartContentPaths(entry, `${basePath}.${key}`));
  return paths;
}

function findSourceReferenceIssues(
  value: unknown,
  allowedSourceIds: Set<string>,
  basePath = "$"
): Array<{ code: "invalid_schema" | "unknown_source"; path: string; message: string }> {
  const issues: Array<{ code: "invalid_schema" | "unknown_source"; path: string; message: string }> = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => issues.push(...findSourceReferenceIssues(entry, allowedSourceIds, `${basePath}[${index}]`)));
    return issues;
  }
  const record = recordValue(value);
  if (!record) return issues;

  for (const [key, entry] of Object.entries(record)) {
    const path = `${basePath}.${key}`;
    if (singularSourceReferenceFields.has(key)) {
      const sourceId = stringValue(entry);
      if (!sourceId) issues.push({ code: "invalid_schema", path, message: `${key} must be a non-empty string.` });
      else if (!allowedSourceIds.has(sourceId)) issues.push({ code: "unknown_source", path, message: `Unknown ${key} ${sourceId}.` });
      continue;
    }
    if (pluralSourceReferenceFields.has(key)) {
      if (!Array.isArray(entry)) {
        issues.push({ code: "invalid_schema", path, message: `${key} must be an array of source IDs.` });
        continue;
      }
      entry.forEach((sourceId, index) => {
        const itemPath = `${path}[${index}]`;
        if (!stringValue(sourceId)) issues.push({ code: "invalid_schema", path: itemPath, message: `${key} entries must be non-empty strings.` });
        else if (!allowedSourceIds.has(sourceId)) issues.push({ code: "unknown_source", path: itemPath, message: `Unknown source reference ${sourceId}.` });
      });
      continue;
    }
    issues.push(...findSourceReferenceIssues(entry, allowedSourceIds, path));
  }
  return issues;
}

function addIssue(issues: AiProtocolIssue[], code: AiProtocolIssue["code"], severity: AiProtocolIssue["severity"], path: string, message: string): void {
  issues.push({ code, severity, path, message });
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
