import { describe, it, expect } from "vitest";
import { BlockRegistry } from "@ai-blocks/block-schemas";
import type { BlockDefinition, CodeTemplate, ScopeBranch } from "@ai-blocks/block-schemas";
import { createGraph, addNode } from "../graph/graph.js";
import { generatePython } from "./python.js";

function scope(
  id: string,
  body: string,
  branches: ScopeBranch[],
  parameters: BlockDefinition["parameters"] = []
): BlockDefinition {
  const codeTemplate: CodeTemplate = { imports: [], body, outputBindings: {} };
  return {
    id, name: id, category: "control-flow", description: "", tags: [],
    inputs: [], outputs: [], parameters, codeTemplate,
    scopeType: "branch", branches,
  };
}

function leaf(id: string, body: string): BlockDefinition {
  return {
    id, name: id, category: "test", description: "", tags: [],
    inputs: [], outputs: [], parameters: [],
    codeTemplate: { imports: [], body, outputBindings: {} },
  };
}

const registry = new BlockRegistry([
  scope(
    "if-block",
    "if {{params.cond}}:\n    {{branches.if_body}}\nelse:\n    {{branches.else_body}}",
    [
      { id: "if_body", label: "If", accepts: "any" },
      { id: "else_body", label: "Else", accepts: "any" },
    ],
    [{ id: "cond", name: "cond", type: "string", default: "x > 0" }]
  ),
  scope(
    "for-block",
    "for i in range({{params.n}}):\n    {{branches.loop_body}}",
    [{ id: "loop_body", label: "Body", accepts: "any" }],
    [{ id: "n", name: "n", type: "number", default: 3 }]
  ),
  leaf("stmt", "value = 42"),
]);

const at = { x: 0, y: 0 };

describe("control-flow scope codegen", () => {
  it("emits `pass` for a scope with empty branches", () => {
    const g = createGraph();
    addNode(g, registry.getOrThrow("if-block"), at);
    const code = generatePython(g, registry, { comments: false });
    expect(code).toContain("if x > 0:\n    pass\nelse:\n    pass");
  });

  it("nests a child block, indented, inside the `if` branch", () => {
    const g = createGraph();
    const ifNode = addNode(g, registry.getOrThrow("if-block"), at);
    const child = addNode(g, registry.getOrThrow("stmt"), at);
    ifNode.branchChildren!.if_body = [child.id];

    const code = generatePython(g, registry, { comments: false });
    expect(code).toContain("if x > 0:\n    value = 42\nelse:\n    pass");
  });

  it("nests a child inside a `for` loop body", () => {
    const g = createGraph();
    const forNode = addNode(g, registry.getOrThrow("for-block"), at);
    const child = addNode(g, registry.getOrThrow("stmt"), at);
    forNode.branchChildren!.loop_body = [child.id];

    const code = generatePython(g, registry, { comments: false });
    expect(code).toContain("for i in range(3):\n    value = 42");
  });

  it("indents correctly across two nested scopes (loop inside if)", () => {
    const g = createGraph();
    const ifNode = addNode(g, registry.getOrThrow("if-block"), at);
    const forNode = addNode(g, registry.getOrThrow("for-block"), at);
    const child = addNode(g, registry.getOrThrow("stmt"), at);
    ifNode.branchChildren!.if_body = [forNode.id];
    forNode.branchChildren!.loop_body = [child.id];

    const code = generatePython(g, registry, { comments: false });
    // loop header at 4 spaces, grandchild at 8; `else:` stays at column 0
    expect(code).toContain("if x > 0:\n    for i in range(3):\n        value = 42\nelse:\n    pass");
  });

  it("does not also emit a branch child at the top level (no duplication)", () => {
    const g = createGraph();
    const ifNode = addNode(g, registry.getOrThrow("if-block"), at);
    const child = addNode(g, registry.getOrThrow("stmt"), at);
    ifNode.branchChildren!.if_body = [child.id];

    const code = generatePython(g, registry, { comments: false });
    expect(code.match(/value = 42/g)).toHaveLength(1);
  });
});
