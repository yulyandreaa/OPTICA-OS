import { describe, expect, it } from "vitest";
import { searchFilter } from "./search";

describe("searchFilter", () => {
  it("clasifica la búsqueda para usar un solo índice", () => {
    expect(searchFilter("ana@correo.com")).toEqual({ kind: "email", value: "ana@correo.com" });
    expect(searchFilter("52.123.456")).toEqual({ kind: "number", value: "52123456" });
    expect(searchFilter("300 123 4567")).toEqual({ kind: "number", value: "3001234567" });
    expect(searchFilter("AB123456")).toEqual({ kind: "document", value: "AB123456" });
    expect(searchFilter("María Gómez")).toEqual({ kind: "name", value: "María Gómez" });
  });

  it("neutraliza caracteres que alterarían el filtro", () => {
    expect(searchFilter("ana,(x)%")).toEqual({ kind: "name", value: "ana  x" });
  });
});
