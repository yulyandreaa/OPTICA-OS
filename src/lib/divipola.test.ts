import { describe, expect, it } from "vitest";
import { DEPARTMENTS, DIVIPOLA, municipalitiesOf } from "./divipola";

describe("DIVIPOLA", () => {
  it("has the 32 departments plus Bogotá D.C. and every municipality", () => {
    expect(DEPARTMENTS).toHaveLength(33);
    expect(DIVIPOLA.reduce((n, [, , m]) => n + m.length, 0)).toBe(1122);
  });

  it("uses valid, unique DANE codes nested under their department", () => {
    const codes = DIVIPOLA.flatMap(([dep, , m]) => m.map(([code]) => {
      expect(code).toMatch(/^\d{5}$/);
      expect(code.slice(0, 2)).toBe(dep);
      return code;
    }));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("lists a department's municipalities, with common names for big cities", () => {
    expect(municipalitiesOf("Valle del Cauca")).toContainEqual({ code: "76001", name: "Cali" });
    expect(municipalitiesOf("Bogotá, D.C.")).toEqual([{ code: "11001", name: "Bogotá, D.C." }]);
    expect(municipalitiesOf("No existe")).toEqual([]);
    expect(municipalitiesOf(null)).toEqual([]);
  });
});
