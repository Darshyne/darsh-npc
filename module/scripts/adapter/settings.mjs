/**
 * Réglages de monde (SPEC §12.1, §2-3) : le niveau d'automatisation des PNJ, et le mode omniscient. Les surcouches du monde
 * (profils, haines, répliques — §12.4) viendront avec leur éditeur ; `profiles` et `enmities` sont déjà là, cachés, pour que
 * `api.ai.register` et le registre aient leur couche « world ».
 */
import { MODULE_ID } from "../shared.mjs";

export const LEVELS = Object.freeze(["off", "patrols", "engage", "combat", "full"]);

export function registerSettings() {
  game.settings.register(MODULE_ID, "level", {
    name: "DNPC.Reglage.Niveau.Nom", hint: "DNPC.Reglage.Niveau.Indic", scope: "world", config: true, type: String,
    choices: Object.fromEntries(LEVELS.map(l => [l, `DNPC.Niveau.${l}`])), default: "off"
  });
  game.settings.register(MODULE_ID, "omniscient", {
    name: "DNPC.Reglage.Omniscient.Nom", hint: "DNPC.Reglage.Omniscient.Indic", scope: "world", config: true, type: Boolean, default: false
  });
  // Surcouche du monde (couche « world » du SPEC §6.4) : `{ profiles: [...], enmities: [...] }`, écrite par l'éditeur à venir.
  game.settings.register(MODULE_ID, "world", { scope: "world", config: false, type: Object, default: { profiles: [], enmities: [] } });
}

/** Le niveau atteint-il `min` ? */
export function levelAtLeast(min) {
  return LEVELS.indexOf(game.settings.get(MODULE_ID, "level")) >= LEVELS.indexOf(min);
}
