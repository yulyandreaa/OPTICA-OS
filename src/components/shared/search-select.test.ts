import { describe, expect, it } from "vitest";
import { municipalitiesOf } from "@/lib/divipola";
import { filterOptions } from "./search-select";

const cities = (department: string) => municipalitiesOf(department).map((m) => ({ value: m.name, label: m.name }));
const labels = (options: readonly { label: string }[]) => options.map((o) => o.label);

describe("filterOptions", () => {
  it("returns every option, in order, when there is no text", () => {
    expect(labels(filterOptions(cities("Quindío"), ""))).toEqual(labels(cities("Quindío")));
  });

  it("ignores accents and case", () => {
    expect(labels(filterOptions(cities("Antioquia"), "MEDELLIN"))).toEqual(["Medellín"]);
  });

  it("matches the start of any word", () => {
    expect(labels(filterOptions(cities("Bolívar"), "indias"))).toEqual(["Cartagena de Indias"]);
    expect(labels(filterOptions(cities("Antioquia"), "llin"))).toEqual([]);
  });
});
