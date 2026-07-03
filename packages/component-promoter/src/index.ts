import type {
  ComponentPromotionRule,
  ComponentRegistry,
  ComponentRegistryEntry,
  PromoteGeneratedWidgetIssue,
  PromoteGeneratedWidgetReport,
  PromoteGeneratedWidgetRequest,
  PromoteGeneratedWidgetResult
} from "@uxcompiler/ir-schemas";

export interface PromoteGeneratedWidgetInput {
  componentRegistry?: ComponentRegistry;
  promotionRules?: ComponentPromotionRule[];
  generatedFileContent: string;
  request: PromoteGeneratedWidgetRequest;
  now?: () => Date;
}

const generatedStartMarker = "@uxc-generated:start";
const generatedEndMarker = "@uxc-generated:end";

export function promoteGeneratedWidget(input: PromoteGeneratedWidgetInput): PromoteGeneratedWidgetResult {
  const now = input.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const issues: PromoteGeneratedWidgetIssue[] = [];
  const componentRegistry = cloneRegistry(input.componentRegistry);
  const promotionRules = [...(input.promotionRules ?? [])];
  const request = normalizeRequest(input.request, input.generatedFileContent);

  validateRequest(request, input.generatedFileContent, componentRegistry, issues);
  const promoted = !issues.some((issue) => issue.severity === "error");
  let rule: ComponentPromotionRule | undefined;

  if (promoted) {
    const flutter = {
      ...request.flutter,
      props: request.flutter.props ?? request.props
    };
    upsertComponent(componentRegistry, {
      id: request.componentId,
      name: request.name,
      source: "user_defined",
      instances: request.sourceNodeIds,
      props: [],
      variants: [],
      flutter,
      verified: true
    });
    rule = {
      componentId: request.componentId,
      name: request.name,
      generatedFilePath: request.generatedFilePath,
      sourceNodeIds: request.sourceNodeIds,
      flutter,
      skipGeneratedRegions: true,
      updateCallsitesOnly: true,
      promotedAt: generatedAt,
      reason: request.reason
    };
    upsertRule(promotionRules, rule);
  }

  const promoteReport: PromoteGeneratedWidgetReport = {
    version: "0.1.0",
    generatedAt,
    request,
    issues,
    promoted,
    rule
  };

  return {
    version: "0.1.0",
    componentRegistry,
    promotionRules,
    promoteReport
  };
}

function normalizeRequest(request: PromoteGeneratedWidgetRequest, content: string): PromoteGeneratedWidgetRequest {
  const markerSourceNodeId = parseMarkerValue(content, "nodeId");
  return {
    ...request,
    componentId: request.componentId.trim(),
    name: request.name.trim(),
    generatedFilePath: request.generatedFilePath.trim(),
    sourceNodeIds: unique(request.sourceNodeIds.length > 0 ? request.sourceNodeIds : markerSourceNodeId ? [markerSourceNodeId] : []),
    flutter: {
      ...request.flutter,
      import: request.flutter.import.trim(),
      constructor: request.flutter.constructor.trim()
    },
    reason: request.reason.trim()
  };
}

function validateRequest(
  request: PromoteGeneratedWidgetRequest,
  content: string,
  registry: ComponentRegistry,
  issues: PromoteGeneratedWidgetIssue[]
): void {
  if (!request.reason) addIssue(issues, "error", "missing_reason", "Promote operations must include a reason.");
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(request.componentId)) {
    addIssue(issues, "error", "invalid_component", `Component id ${request.componentId} is not stable.`);
  }
  if (!/^[A-Z][A-Za-z0-9]*$/.test(request.name)) {
    addIssue(issues, "error", "invalid_component", `Component name ${request.name} must be PascalCase.`);
  }
  if (request.sourceNodeIds.length === 0) {
    addIssue(issues, "error", "missing_source_nodes", "Promotion requires at least one sourceNodeId.");
  }
  if (!request.flutter.import || !request.flutter.constructor) {
    addIssue(issues, "error", "invalid_flutter_mapping", "Promotion requires a Flutter import and constructor.");
  }
  if (!hasGeneratedMarker(content)) {
    addIssue(
      issues,
      request.allowManualFile ? "warning" : "error",
      "missing_generated_marker",
      "Generated widget file does not contain UXCompiler generated markers."
    );
  }
  const existing = registry.components.find((component) => component.id === request.componentId);
  if (existing?.source === "rejected") {
    addIssue(issues, "error", "duplicate_component", `Component ${request.componentId} was previously rejected.`);
  } else if (existing) {
    addIssue(issues, "warning", "duplicate_component", `Component ${request.componentId} already exists and will be updated.`);
  }
}

function upsertComponent(registry: ComponentRegistry, component: ComponentRegistryEntry): void {
  const index = registry.components.findIndex((candidate) => candidate.id === component.id);
  if (index === -1) {
    registry.components.push(component);
  } else {
    registry.components[index] = {
      ...registry.components[index],
      ...component,
      props: component.props.length > 0 ? component.props : registry.components[index].props,
      variants: component.variants.length > 0 ? component.variants : registry.components[index].variants
    };
  }
  registry.components.sort((left, right) => left.id.localeCompare(right.id));
}

function upsertRule(rules: ComponentPromotionRule[], rule: ComponentPromotionRule): void {
  const index = rules.findIndex((candidate) => candidate.componentId === rule.componentId);
  if (index === -1) {
    rules.push(rule);
  } else {
    rules[index] = rule;
  }
  rules.sort((left, right) => left.componentId.localeCompare(right.componentId));
}

function cloneRegistry(registry?: ComponentRegistry): ComponentRegistry {
  return registry ? JSON.parse(JSON.stringify(registry)) as ComponentRegistry : { version: "0.1.0", components: [] };
}

function addIssue(
  issues: PromoteGeneratedWidgetIssue[],
  severity: PromoteGeneratedWidgetIssue["severity"],
  code: PromoteGeneratedWidgetIssue["code"],
  message: string
): void {
  issues.push({ severity, code, message });
}

function hasGeneratedMarker(content: string): boolean {
  return content.includes(generatedStartMarker) && content.includes(generatedEndMarker);
}

function parseMarkerValue(content: string, key: string): string | undefined {
  const marker = content.split(/\r?\n/).find((line) => line.includes(generatedStartMarker));
  if (!marker) return undefined;
  return marker.match(new RegExp(`${key}=([^\\s]+)`))?.[1];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
