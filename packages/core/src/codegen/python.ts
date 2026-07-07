// ============================================================================
// Python Code Generator
// Transforms a Graph into executable Python code
// ============================================================================

import type { BlockRegistry } from "@ai-blocks/block-schemas";
import type { Graph, GraphNode } from "../graph/types.js";
import { topologicalSort, getIncomingEdges } from "../graph/graph.js";

interface CodeGenOptions {
  /** Include comments showing block names */
  comments?: boolean;
  /** Variable name prefix for block outputs */
  varPrefix?: string;
}

const DEFAULT_OPTIONS: Required<CodeGenOptions> = {
  comments: true,
  varPrefix: "out",
};

/** Sanitize a node id into a valid Python variable name */
function varName(nodeId: string, portId: string, prefix: string): string {
  const clean = nodeId.replace(/[^a-zA-Z0-9]/g, "_");
  return `${prefix}_${clean}_${portId}`;
}

/**
 * Raw substitution value for a parameter. Strings are returned verbatim — the
 * long-standing convention is that templates quote them where a string literal
 * is wanted (e.g. `if "{{params.mode}}" == "auto"`), so this must NOT quote.
 * Use {{params.x|literal}} / pyLiteral() when you need a safe, quoted literal.
 */
function paramToPython(val: unknown): string {
  if (val === undefined || val === null) return "None";
  if (typeof val === "boolean") return val ? "True" : "False";
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return val;
  return JSON.stringify(val) ?? "None";
}

/**
 * A properly-quoted, escaped Python literal for any JSON-ish value. Strings are
 * emitted as safe double-quoted literals (quotes, backslashes, and newlines
 * escaped) so user input can never break out of — or inject into — the
 * generated source. Mirrors the assembler's pyLiteral so both codegen paths
 * agree. Exposed via the {{params.x|literal}} interpolation filter.
 */
export function pyLiteral(val: unknown): string {
  if (val === null || val === undefined) return "None";
  if (typeof val === "boolean") return val ? "True" : "False";
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "float('nan')";
  if (typeof val === "string") return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(pyLiteral).join(", ")}]`;
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`)
      .join(", ");
    return `{${entries}}`;
  }
  return "None";
}

/** Interpolate {{params}}, {{inputs}}, {{outputs}}, {{branches}} in template text */
function interpolate(
  template: string,
  params: Record<string, unknown>,
  inputBindings: Record<string, string>,
  branchBodies: Record<string, string>,
  outputShortNames: Record<string, string> | undefined
): string {
  let result = template;

  // Replace {{params.xxx}} (raw) and {{params.xxx|literal}} (safe Python literal).
  // The raw form preserves the existing template convention of quoting manually;
  // the |literal form emits a properly-escaped literal for user-provided strings.
  result = result.replace(/\{\{params\.(\w+)(\|literal)?\}\}/g, (_match, key, filter) => {
    return filter ? pyLiteral(params[key]) : paramToPython(params[key]);
  });

  // Replace {{inputs.xxx}}
  result = result.replace(/\{\{inputs\.(\w+)\}\}/g, (_match, key) => {
    return inputBindings[key] ?? "None";
  });

  // Replace {{outputs.xxx}} with short local names from outputBindings (e.g. df, rf_model)
  if (outputShortNames) {
    result = result.replace(/\{\{outputs\.(\w+)\}\}/g, (_match, key) => {
      const expr = outputShortNames[key];
      if (expr === undefined) return "None";
      return interpolate(expr, params, inputBindings, branchBodies, undefined);
    });
  }

  // Replace {{branches.xxx}} with the (possibly multi-line) branch body,
  // indenting every line to the column the placeholder sits at so nested
  // Python stays syntactically valid.
  result = result.replace(/([ \t]*)\{\{branches\.(\w+)\}\}/g, (_match, indent, key) => {
    const body = branchBodies[key] ?? "pass";
    return body
      .split("\n")
      .map((line) => (line.length > 0 ? indent + line : line))
      .join("\n");
  });

  return result;
}

/** Generate Python code from a graph */
export function generatePython(
  graph: Graph,
  registry: BlockRegistry,
  options?: CodeGenOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sorted = topologicalSort(graph);
  if (!sorted) {
    throw new Error("Cannot generate code: graph contains cycles");
  }

  const allImports = new Set<string>();
  const setupLines: string[] = [];
  const bodyLines: string[] = [];
  const teardownLines: string[] = [];

  // Map: nodeId:portId -> python variable name
  const outputVarMap = new Map<string, string>();

  // Position of each node in the topological order (for ordering branch children).
  const sortedIndex = new Map<string, number>(sorted.map((id, i) => [id, i]));

  // Nodes that live inside a scope block's branch — emitted within their parent,
  // not at the top level. (The editor does not yet populate branchChildren, so
  // for ordinary graphs this set is empty and behavior is unchanged.)
  const branchChildSet = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (!node.branchChildren) continue;
    for (const childIds of Object.values(node.branchChildren)) {
      for (const id of childIds) branchChildSet.add(id);
    }
  }

  const emitted = new Set<string>();

  /**
   * Produce the Python body lines for one node (comment + body + output-var
   * assignments), registering its output variables and collecting its imports /
   * setup / teardown. Scope blocks recurse: each branch's children are emitted
   * here and spliced into the block's {{branches.x}} placeholders.
   */
  function emitNode(nodeId: string): string[] {
    if (emitted.has(nodeId)) return [];
    const node = graph.nodes[nodeId];
    if (!node) return [];
    const blockDef = registry.get(node.blockId);
    if (!blockDef) return [];
    const template = blockDef.codeTemplate;
    if (!template) return []; // non-pipeline kinds handled by ProjectCompiler
    emitted.add(nodeId);

    for (const imp of template.imports) allImports.add(imp);

    // Build input bindings: which python variable feeds each input port.
    const inputBindings: Record<string, string> = {};
    for (const edge of getIncomingEdges(graph, nodeId)) {
      const srcVar = outputVarMap.get(`${edge.sourceNodeId}:${edge.sourcePortId}`);
      if (srcVar) inputBindings[edge.targetPortId] = srcVar;
    }

    // Branch bodies: recursively emit each branch's children (in topological
    // order), joined into one block. Empty branch => `pass`.
    const branchBodies: Record<string, string> = {};
    if (node.branchChildren) {
      for (const [branchId, childIds] of Object.entries(node.branchChildren)) {
        const ordered = [...childIds].sort(
          (a, b) => (sortedIndex.get(a) ?? 0) - (sortedIndex.get(b) ?? 0)
        );
        const childBlocks = ordered
          .map((cid) => emitNode(cid))
          .filter((lines) => lines.length > 0)
          .map((lines) => lines.join("\n"));
        branchBodies[branchId] = childBlocks.length > 0 ? childBlocks.join("\n") : "pass";
      }
    }

    const outputShortNames = template.outputBindings;

    if (template.setup) {
      setupLines.push(
        interpolate(template.setup, node.parameters, inputBindings, branchBodies, outputShortNames)
      );
    }

    const lines: string[] = [];
    if (opts.comments) lines.push(`# ${node.label ?? blockDef.name}`);
    lines.push(
      interpolate(template.body, node.parameters, inputBindings, branchBodies, outputShortNames)
    );

    for (const [portId, expr] of Object.entries(template.outputBindings)) {
      const vName = varName(nodeId, portId, opts.varPrefix);
      const resolved = interpolate(expr, node.parameters, inputBindings, branchBodies, undefined);
      lines.push(`${vName} = ${resolved}`);
      outputVarMap.set(`${nodeId}:${portId}`, vName);
    }

    if (template.teardown) {
      teardownLines.push(
        interpolate(template.teardown, node.parameters, inputBindings, branchBodies, outputShortNames)
      );
    }

    return lines;
  }

  for (const nodeId of sorted) {
    if (branchChildSet.has(nodeId)) continue; // emitted inside its parent scope
    const lines = emitNode(nodeId);
    if (lines.length > 0) {
      bodyLines.push(...lines);
      bodyLines.push(""); // blank line between top-level blocks
    }
  }

  // Assemble final script
  const sections: string[] = [];

  if (allImports.size > 0) {
    sections.push(Array.from(allImports).sort().join("\n"));
    sections.push("");
  }

  if (setupLines.length > 0) {
    sections.push(setupLines.join("\n"));
    sections.push("");
  }

  sections.push(bodyLines.join("\n"));

  if (teardownLines.length > 0) {
    sections.push("");
    sections.push(teardownLines.join("\n"));
  }

  return sections.join("\n").trimEnd() + "\n";
}
