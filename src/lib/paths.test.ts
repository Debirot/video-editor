import { describe, expect, it } from "vitest";
import { baseName, relativePath, resolvePath } from "./paths";

describe("relativePath", () => {
  it.each([
    ["C:\\Users\\m\\Projetos\\Viagem.vproj", "C:\\Users\\m\\Videos\\trem.mp4", "../../Videos/trem.mp4"],
    ["C:/Users/m/Projetos/Viagem.vproj", "C:/Users/m/Projetos/Viagem.vproj/assets/logo.png", "assets/logo.png"],
    ["c:\\USERS\\m\\P.vproj", "C:\\Users\\m\\v.mp4", "../v.mp4"], // Windows ignora maiúsculas
    ["/home/m/P.vproj", "/home/m/Videos/a.mov", "../Videos/a.mov"],
  ])("%s → %s = %s", (from, to, rel) => {
    expect(relativePath(from, to)).toBe(rel);
  });

  it("discos diferentes não têm caminho relativo", () => {
    expect(relativePath("C:\\P.vproj", "D:\\Videos\\a.mp4")).toBeNull();
  });
});

describe("resolvePath", () => {
  it("volta a montar o caminho absoluto", () => {
    expect(resolvePath("C:\\Users\\m\\Projetos\\Viagem.vproj", "../../Videos/trem.mp4")).toBe("C:\\Users\\m\\Videos\\trem.mp4");
    expect(resolvePath("/home/m/P.vproj", "../Videos/a.mov")).toBe("/home/m/Videos/a.mov");
  });

  it("ida e volta: mover a pasta inteira mantém a mídia achável", () => {
    const rel = relativePath("C:\\Antigo\\Proj.vproj", "C:\\Antigo\\Videos\\a.mp4")!;
    expect(resolvePath("E:\\Backup\\Proj.vproj", rel)).toBe("E:\\Backup\\Videos\\a.mp4");
  });
});

describe("baseName", () => {
  it("funciona com as duas barras", () => {
    expect(baseName("C:\\a\\b\\Viagem.vproj")).toBe("Viagem.vproj");
    expect(baseName("/x/y/z.mp4")).toBe("z.mp4");
  });
});
