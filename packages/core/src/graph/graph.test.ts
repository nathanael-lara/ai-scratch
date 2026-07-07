import { describe, it, expect } from "vitest";
import { BlockRegistry } from "@ai-blocks/block-schemas";
import type { BlockDefinition, PortDefinition, PortType } from "@ai-blocks/block-schemas";
import {
  createGraph,
  addNode,
  addEdge,
  validateGraph,
  topologicalSort,
} from "./graph.js";

// ── Minimal fixtures ─────────────────────────────────────────────────────────
function port(id: string, type: PortType, required = false): PortDefinition {
  return { id, name: id, type, required };
}

function block(
  id: string,
  inputs: PortDefinition[],
  outputs: PortDefinition[]
): BlockDefinition {
  return {
    id,
    name: id,
    category: "test",
    description: "",
    tags: [],
    inputs,
    outputs,
    parameters: [],
    codeTemplate: { imports: [], body: "", outputBindings: {} },
  };
}

// source: no inputs, one text output. sink: one required text input.
const registry = new BlockRegistry([
  block("source", [], [port("out", "text")]),
  block("sink", [port("in", "text", true)], []),
  block("model-source", [], [port("out", "model")]),
]);

const at = { x: 0, y: 0 };

describe("validateGraph", () => {
  it("passes when a required input is connected with compatible types", () => {
    const g = createGraph();
    const s = addNode(g, registry.getOrThrow("source"), at);
    const k = addNode(g, registry.getOrThrow("sink"), at);
    addEdge(g, s.id, "out", k.id, "in");
    expect(validateGraph(g, registry)).toEqual([]);
  });

  it("flags a disconnected required input", () => {
    const g = createGraph();
    addNode(g, registry.getOrThrow("sink"), at);
    const errors = validateGraph(g, registry);
    expect(errors.map((e) => e.type)).toContain("disconnected_required");
  });

  it("flags a type mismatch on an edge", () => {
    const g = createGraph();
    const m = addNode(g, registry.getOrThrow("model-source"), at);
    const k = addNode(g, registry.getOrThrow("sink"), at);
    addEdge(g, m.id, "out", k.id, "in"); // model -> text: incompatible
    const errors = validateGraph(g, registry);
    expect(errors.map((e) => e.type)).toContain("type_mismatch");
  });

  it("flags an unknown block type", () => {
    const g = createGraph();
    const s = addNode(g, registry.getOrThrow("source"), at);
    g.nodes[s.id].blockId = "does-not-exist";
    const errors = validateGraph(g, registry);
    expect(errors.some((e) => e.message.includes("Unknown block type"))).toBe(true);
  });

  it("detects a cycle", () => {
    // Two source-like nodes wired into a loop by hand.
    const g = createGraph();
    const a = addNode(g, registry.getOrThrow("source"), at);
    const b = addNode(g, registry.getOrThrow("source"), at);
    addEdge(g, a.id, "out", b.id, "in");
    addEdge(g, b.id, "out", a.id, "in");
    const errors = validateGraph(g, registry);
    expect(errors.map((e) => e.type)).toContain("cycle");
  });
});

describe("addEdge", () => {
  it("rejects self-connections", () => {
    const g = createGraph();
    const s = addNode(g, registry.getOrThrow("source"), at);
    expect(addEdge(g, s.id, "out", s.id, "in")).toBeNull();
  });

  it("rejects duplicate edges", () => {
    const g = createGraph();
    const s = addNode(g, registry.getOrThrow("source"), at);
    const k = addNode(g, registry.getOrThrow("sink"), at);
    expect(addEdge(g, s.id, "out", k.id, "in")).not.toBeNull();
    expect(addEdge(g, s.id, "out", k.id, "in")).toBeNull();
  });
});

describe("topologicalSort", () => {
  it("orders dependencies before dependents", () => {
    const g = createGraph();
    const s = addNode(g, registry.getOrThrow("source"), at);
    const k = addNode(g, registry.getOrThrow("sink"), at);
    addEdge(g, s.id, "out", k.id, "in");
    const order = topologicalSort(g);
    expect(order).not.toBeNull();
    expect(order!.indexOf(s.id)).toBeLessThan(order!.indexOf(k.id));
  });

  it("returns null on a cyclic graph", () => {
    const g = createGraph();
    const a = addNode(g, registry.getOrThrow("source"), at);
    const b = addNode(g, registry.getOrThrow("source"), at);
    addEdge(g, a.id, "out", b.id, "in");
    addEdge(g, b.id, "out", a.id, "in");
    expect(topologicalSort(g)).toBeNull();
  });
});
