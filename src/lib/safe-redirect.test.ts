import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-redirect";

describe("safeNext", () => {
  it("allows relative paths", () => expect(safeNext("/pacientes?x=1")).toBe("/pacientes?x=1"));
  it("blocks absolute and protocol-relative urls", () => {
    expect(safeNext("https://evil.com")).toBe("/inicio");
    expect(safeNext("//evil.com")).toBe("/inicio");
    expect(safeNext("/\\evil.com")).toBe("/inicio");
  });
});
