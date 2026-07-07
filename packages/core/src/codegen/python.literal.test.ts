import { describe, it, expect } from "vitest";
import { BlockRegistry } from "@ai-blocks/block-schemas";
import type { BlockDefinition, PortDefinition, PortType, CodeTemplate } from "@ai-blocks/block-schemas";
import { createGraph, addNode } from "../graph/graph.js";
import { generatePython, pyLiteral } from "./python.js";

describe("pyLiteral", () => {
  it("quotes and escapes strings", () => {
    expect(pyLiteral("hi")).toBe('"hi"');
    expect(pyLiteral('he said "hi"')).toBe('"he said \\"hi\\""');
    expect(pyLiteral("line1\nline2")).toBe('"line1\\nline2"');
    expect(pyLiteral("a\\b")).toBe('"a\\\\b"');
  });

  it("renders primitives as Python literals", () => {
    expect(pyLiteral(true)).toBe("True");
    expect(pyLiteral(false)).toBe("False");
    expect(pyLiteral(null)).toBe("None");
    expect(pyLiteral(undefined)).toBe("None");
    expect(pyLiteral(3)).toBe("3");
    expect(pyLiteral(NaN)).toBe("float('nan')");
  });

  it("renders arrays and objects recursively", () => {
    expect(pyLiteral([1, "a", true])).toBe('[1, "a", True]');
    expect(pyLiteral({ k: "v", n: 2 })).toBe('{"k": "v", "n": 2}');
  });
});

// A block that routes a user-provided string through the |literal filter.
function port(id: string, type: PortType): PortDefinition {
  return { id, name: id, type, required: false };
}
function block(id: string, template: CodeTemplate, parameters: BlockDefinition["parameters"]): BlockDefinition {
  return { id, name: id, category: "test", description: "", tags: [], inputs: [], outputs: [port("out", "text")], parameters, codeTemplate: template };
}

describe("{{params.x|literal}} interpolation", () => {
  it("emits a safe, quoted literal for a string that would otherwise break codegen", () => {
    const registry = new BlockRegistry([
      block(
        "labeler",
        { imports: [], body: "", outputBindings: { out: "label({{params.text|literal}})" } },
        [{ id: "text", name: "text", type: "string", default: 'sarcastic "quote"' }]
      ),
    ]);
    const g = createGraph();
    addNode(g, registry.getOrThrow("labeler"), { x: 0, y: 0 });
    const code = generatePython(g, registry);
    // properly escaped, quoted — not the raw unbalanced string
    expect(code).toContain('label("sarcastic \\"quote\\"")');
    expect(code).not.toContain("label(sarcastic");
  });

  it("leaves the raw {{params.x}} form unquoted (backwards compatible)", () => {
    const registry = new BlockRegistry([
      block(
        "raw",
        { imports: [], body: "", outputBindings: { out: '"{{params.mode}}" == "auto"' } },
        [{ id: "mode", name: "mode", type: "string", default: "auto" }]
      ),
    ]);
    const g = createGraph();
    addNode(g, registry.getOrThrow("raw"), { x: 0, y: 0 });
    const code = generatePython(g, registry);
    // template supplied its own quotes; raw substitution must not double-quote
    expect(code).toContain('"auto" == "auto"');
    expect(code).not.toContain('""auto""');
  });
});
