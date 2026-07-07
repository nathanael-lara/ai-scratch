import { describe, it, expect } from "vitest";
import { BlockRegistry } from "@ai-blocks/block-schemas";
import type { BlockDefinition, PortDefinition, PortType, CodeTemplate } from "@ai-blocks/block-schemas";
import { createGraph, addNode, addEdge } from "../graph/graph.js";
import { generatePython } from "./python.js";

function port(id: string, type: PortType, required = false): PortDefinition {
  return { id, name: id, type, required };
}

function block(
  id: string,
  inputs: PortDefinition[],
  outputs: PortDefinition[],
  codeTemplate: CodeTemplate,
  parameters: BlockDefinition["parameters"] = []
): BlockDefinition {
  return { id, name: id, category: "test", description: "", tags: [], inputs, outputs, parameters, codeTemplate };
}

const registry = new BlockRegistry([
  block("load", [], [port("data", "dataframe")], {
    imports: ["import pandas as pd"],
    body: "",
    outputBindings: { data: "pd.DataFrame()" },
  }),
  block("transform", [port("df", "dataframe", true)], [port("result", "array")], {
    imports: ["import numpy as np", "import pandas as pd"], // dup pandas on purpose
    body: "",
    outputBindings: { result: "np.array({{inputs.df}})" },
  }),
  block(
    "configured",
    [],
    [port("val", "number")],
    {
      imports: [],
      body: "",
      outputBindings: { val: "{{params.n}} if {{params.flag}} else 0" },
    },
    [
      { id: "n", name: "n", type: "number", default: 3 },
      { id: "flag", name: "flag", type: "boolean", default: true },
    ]
  ),
]);

const at = { x: 0, y: 0 };

describe("generatePython", () => {
  it("emits sorted, de-duplicated imports at the top", () => {
    const g = createGraph();
    const l = addNode(g, registry.getOrThrow("load"), at);
    const t = addNode(g, registry.getOrThrow("transform"), at);
    addEdge(g, l.id, "data", t.id, "df");

    const code = generatePython(g, registry);
    expect(code).toContain("import numpy as np");
    expect(code).toContain("import pandas as pd");
    // numpy sorts before pandas
    expect(code.indexOf("import numpy")).toBeLessThan(code.indexOf("import pandas"));
    // pandas imported by two blocks but appears once
    expect(code.match(/import pandas as pd/g)).toHaveLength(1);
  });

  it("wires an upstream output variable into a downstream input", () => {
    const g = createGraph();
    const l = addNode(g, registry.getOrThrow("load"), at);
    const t = addNode(g, registry.getOrThrow("transform"), at);
    addEdge(g, l.id, "data", t.id, "df");

    const code = generatePython(g, registry);
    // transform's result should reference load's generated output var, not "None"
    expect(code).toMatch(/np\.array\(out_\w+_data\)/);
    expect(code).not.toContain("np.array(None)");
  });

  it("interpolates number and boolean params as Python literals", () => {
    const g = createGraph();
    addNode(g, registry.getOrThrow("configured"), at);
    const code = generatePython(g, registry);
    expect(code).toContain("3 if True else 0");
  });

  it("throws on a cyclic graph", () => {
    const g = createGraph();
    const a = addNode(g, registry.getOrThrow("transform"), at);
    const b = addNode(g, registry.getOrThrow("transform"), at);
    addEdge(g, a.id, "result", b.id, "df");
    addEdge(g, b.id, "result", a.id, "df");
    expect(() => generatePython(g, registry)).toThrow(/cycle/i);
  });
});
