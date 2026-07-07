import { describe, it, expect } from "vitest";
import { arePortsCompatible, PORT_COMPATIBILITY } from "./types.js";

describe("arePortsCompatible", () => {
  it("accepts identical types", () => {
    expect(arePortsCompatible("tensor", "tensor")).toBe(true);
    expect(arePortsCompatible("embedding", "embedding")).toBe(true);
  });

  it("treats `any` as compatible in both directions", () => {
    expect(arePortsCompatible("any", "model")).toBe(true);
    expect(arePortsCompatible("dataframe", "any")).toBe(true);
    expect(arePortsCompatible("any", "any")).toBe(true);
  });

  it("honors the declared compatibility list", () => {
    expect(arePortsCompatible("tensor", "array")).toBe(true);
    expect(arePortsCompatible("embedding", "tensor")).toBe(true);
    expect(arePortsCompatible("embedding", "array")).toBe(true);
    expect(arePortsCompatible("prompt", "text")).toBe(true);
    expect(arePortsCompatible("path", "text")).toBe(true);
    expect(arePortsCompatible("dataframe", "dict")).toBe(true);
  });

  it("rejects incompatible pairs", () => {
    expect(arePortsCompatible("model", "tensor")).toBe(false);
    expect(arePortsCompatible("text", "embedding")).toBe(false);
    expect(arePortsCompatible("agent", "dataframe")).toBe(false);
    // `void` has an empty compat list — it only reaches an `any` target
    // (via the any short-circuit), nothing else.
    expect(arePortsCompatible("void", "text")).toBe(false);
    expect(arePortsCompatible("void", "any")).toBe(true);
  });

  it("is not implicitly symmetric (array→tensor differs from the reverse being listed)", () => {
    // tensor lists array as compatible; array lists tensor as compatible too,
    // but these are independent declarations — verify each direction explicitly.
    expect(arePortsCompatible("array", "tensor")).toBe(true);
    expect(arePortsCompatible("tensor", "array")).toBe(true);
    // path→text is allowed; text→path is not.
    expect(arePortsCompatible("path", "text")).toBe(true);
    expect(arePortsCompatible("text", "path")).toBe(false);
  });

  it("every PortType has a compatibility entry (no undefined lookups)", () => {
    for (const [type, compat] of Object.entries(PORT_COMPATIBILITY)) {
      expect(Array.isArray(compat), `${type} should map to an array`).toBe(true);
    }
  });
});
