import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../module");
const scripts = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? scripts(join(dir, e.name)) : (e.name.endsWith(".mjs") ? [join(dir, e.name)] : []));

/** Les clés `DNPC.*` que le code demande : `loc("…")` littérales, les clés de réglages, et les niveaux. */
function usedKeys() {
  const keys = new Set();
  for ( const file of scripts(join(ROOT, "scripts")) ) {
    const src = readFileSync(file, "utf8");
    for ( const [, k] of src.matchAll(/\bloc\("([A-Za-z.]+)"/g) ) keys.add(`DNPC.${k}`);
    for ( const [, k] of src.matchAll(/"(DNPC\.[A-Za-z.]+)"/g) ) keys.add(k);
  }
  for ( const level of ["off", "patrols", "engage", "combat", "full"] ) keys.add(`DNPC.Niveau.${level}`);
  return keys;
}

describe("fichiers de langue", () => {
  // pt-BR peut avoir du retard sur une clé neuve (Foundry montre alors l'anglais) : seuls fr et en doivent tout avoir.
  for ( const lang of ["fr", "en"] ) {
    it(`${lang} : chaque clé demandée existe`, () => {
      const json = JSON.parse(readFileSync(join(ROOT, `lang/${lang}.json`), "utf8"));
      // Un préfixe de traduction (`LOCALIZATION_PREFIXES` d'un modèle de données) existe si au moins une clé commence par lui.
      const present = k => (k in json) || Object.keys(json).some(j => j.startsWith(`${k}.FIELDS.`));
      expect(Array.from(usedKeys()).filter(k => !present(k))).toEqual([]);
    });
  }

  it("fr a les clés de en ; fr et pt-BR, ses {paramètres} et rien de plus", () => {
    const en = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
    const params = s => (String(s).match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    for ( const lang of ["fr", "pt-BR"] ) {
      const translated = JSON.parse(readFileSync(join(ROOT, `lang/${lang}.json`), "utf8"));
      // Le français suit l'anglais clé pour clé ; le portugais peut avoir du retard (une clé absente s'affiche en anglais), jamais
      // une clé en trop, une valeur vide ni des {paramètres} différents.
      if ( lang === "fr" ) expect(Object.keys(translated).sort()).toEqual(Object.keys(en).sort());
      expect(Object.keys(translated).filter(k => !(k in en)), `${lang}: clés en trop`).toEqual([]);
      for ( const k of Object.keys(translated) ) {
        expect(String(translated[k]).trim(), `${lang}: ${k}`).not.toBe("");
        expect(params(translated[k]), `${lang}: ${k}`).toEqual(params(en[k]));
      }
    }
  });

  it("module.json liste les trois langues", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
    expect(manifest.languages.map(l => l.lang).sort()).toEqual(["en", "fr", "pt-BR"]);
  });
});
