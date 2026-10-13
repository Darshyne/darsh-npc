/**
 * Les marqueurs de l'IA au-dessus des tokens (demande de l'utilisateur du 2026-10-13 : « tous les retours visuels de l'IA des PNJ
 * s'affichent en haut du token »). Dessinés par le module sur le canevas — pas d'effet d'acteur, rien d'écrit.
 *
 *   « ! » rouge     alerte : un ennemi vu (et l'engagement qui suit)        — vu de tous ; en combat, seulement à son apparition
 *   « ? » jaune     soupçon : un bruit, un doute                             — vu de tous
 *   œil             recherche : va voir la dernière position connue         — vu de tous
 *   « ? » gris      confusion : n'a rien trouvé, va rentrer                  — vu de tous
 *   drapeau blanc   s'est rendu (§9.5)                                       — vu de tous
 *   souffle         fuit (§9.5)                                              — MJ seulement
 */
import { MODULE_ID } from "../shared.mjs";

const NAME = "dnpc-marker";
/** Un « ! » reste visible tant de temps quand le combat commence (le temps de le voir). */
const ALERT_FLASH_MS = 3000;

const GLYPHS = {
  alert: { text: "!", fill: "#ff3b3b", weight: "900" },
  suspicious: { text: "?", fill: "#ffd23f", weight: "900" },
  searching: { text: "👁", fill: "#ffffff", weight: "400" },
  confused: { text: "?", fill: "#c8c8c8", weight: "900" },
  surrendered: { text: "🏳️", fill: "#ffffff", weight: "400" },
  fleeing: { text: "💨", fill: "#ffffff", weight: "400", gm: true }
};

/** Le marqueur à montrer pour ce token, ou null. */
function glyphOf(token) {
  const doc = token.document;
  const morale = doc.getFlag(MODULE_ID, "morale")?.state ?? null;
  if ( morale && GLYPHS[morale] ) return GLYPHS[morale].gm && !game.user.isGM ? null : GLYPHS[morale];
  const alert = doc.getFlag(MODULE_ID, "alert");
  const state = alert?.state;
  if ( !state || (state === "idle") || !GLYPHS[state] ) return null;
  // En combat, le « ! » ne fait qu'apparaître ; les autres états n'ont pas cours.
  if ( doc.inCombat ) return ((state === "alert") && ((Date.now() - (alert.at ?? 0)) < ALERT_FLASH_MS)) ? GLYPHS.alert : null;
  return GLYPHS[state];
}

function draw(token) {
  if ( !token?.document || token.destroyed ) return;
  const glyph = glyphOf(token);
  let marker = token.getChildByName?.(NAME);
  if ( !glyph ) { if ( marker ) marker.destroy(); return; }
  const size = Math.round(Math.max(18, token.h * 0.32));
  if ( !marker || (marker._dnpcText !== glyph.text) || (marker._dnpcSize !== size) ) {
    marker?.destroy();
    marker = new PIXI.Text(glyph.text, {
      fontFamily: "Signika, sans-serif", fontSize: size, fontWeight: glyph.weight, fill: glyph.fill,
      stroke: "#000000", strokeThickness: Math.max(3, Math.round(size / 7)),
      dropShadow: true, dropShadowColor: "#000000", dropShadowBlur: 4, dropShadowDistance: 0
    });
    marker.name = NAME;
    marker._dnpcText = glyph.text;
    marker._dnpcSize = size;
    marker.anchor.set(0.5, 1);
    marker.eventMode = "none";
    token.addChild(marker);
  }
  // Au-dessus du token, centré, au-dessus de la barre de nom s'il y en a une en haut.
  marker.position.set(token.w / 2, -2);
  marker.zIndex = 10;
}

export function registerMarkers() {
  Hooks.on("refreshToken", token => draw(token));
  Hooks.on("updateToken", (doc, changes) => {
    const flags = changes.flags?.[MODULE_ID];
    if ( !flags ) return;
    if ( ["morale", "-=morale", "alert", "-=alert"].some(k => k in flags) ) {
      draw(doc.object);
      // Le « ! » d'un combat qui commence s'efface de lui-même.
      if ( flags.alert?.state === "alert" ) setTimeout(() => draw(doc.object), ALERT_FLASH_MS + 100);
    }
  });
  Hooks.on("createCombatant", combatant => draw(combatant.token?.object));
  Hooks.on("deleteCombat", combat => { for ( const c of combat.combatants ) draw(c.token?.object); });
}
