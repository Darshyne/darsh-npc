/**
 * Les couches du SPEC §5 tiennent par leurs imports, pas par convention :
 *   core/     n'importe que core/
 *   content/  n'importe que content/ et core/
 *   adapter/  n'importe jamais runtime/ ni ui/
 *   runtime/  n'importe jamais ui/
 *   ui/       importe ce qu'il veut
 * core/ ne touche à aucun global de Foundry. Et le moteur n'est nommé que dans adapter/engine.mjs (SPEC §2-2).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../module/scripts");
const LAYERS = ["core", "content", "adapter", "runtime", "ui"];

const files = layer => existsSync(join(ROOT, layer))
  ? readdirSync(join(ROOT, layer)).filter(f => f.endsWith(".mjs")).map(f => `${layer}/${f}`)
  : [];
const source = file => readFileSync(join(ROOT, file), "utf8");

function importedLayers(file) {
  const own = file.split("/")[0];
  const out = new Set();
  for ( const [, spec] of source(file).matchAll(/from\s+"([^"]+)"/g) ) {
    const m = spec.match(/^\.\.\/([a-z]+)\//);
    if ( m ) out.add(m[1]);
    else if ( spec.startsWith("./") ) out.add(own);
  }
  return out;
}

const forbidden = {
  core: ["content", "adapter", "runtime", "ui"],
  content: ["adapter", "runtime", "ui"],
  adapter: ["runtime", "ui"],
  runtime: ["ui"],
  ui: []
};

describe("couches", () => {
  for ( const layer of LAYERS ) {
    it(`${layer}/ n'importe pas ${forbidden[layer].join(", ") || "(sans contrainte)"}`, () => {
      for ( const file of files(layer) ) {
        const bad = [...importedLayers(file)].filter(l => forbidden[layer].includes(l));
        expect(bad, file).toEqual([]);
      }
    });
  }

  it("core/ ne référence aucun global de Foundry", () => {
    for ( const file of files("core") ) {
      const code = source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\b(game|canvas|Hooks|CONFIG|ui|foundry)\s*[.[]/);
    }
  });

  it("content/ ne référence aucun global de Foundry", () => {
    for ( const file of files("content") ) {
      const code = source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\b(game|canvas|Hooks|CONFIG|ui|foundry)\s*[.[]/);
    }
  });

  it("le moteur n'est nommé que dans adapter/engine.mjs (et le point d'entrée pour sa version)", () => {
    const all = [...LAYERS.flatMap(files), "darsh-npc.mjs", "shared.mjs"];
    for ( const file of all ) {
      if ( ["adapter/engine.mjs", "darsh-npc.mjs"].includes(file) ) continue;
      const code = source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/dnd5e-combat/);
    }
  });

  it("rien n'écrit sur un acteur ou un item (SPEC §2-1, §13)", () => {
    const all = [...LAYERS.flatMap(files), "darsh-npc.mjs"];
    for ( const file of all ) {
      const code = source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\b(actor|item)\.(update|setFlag|unsetFlag|createEmbeddedDocuments|deleteEmbeddedDocuments|toggleStatusEffect)\(/);
    }
  });
});
