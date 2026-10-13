/**
 * Les marqueurs du moral sur les tokens (SPEC §9.5) : un drapeau blanc sur une créature rendue (vu de tous), un signe de fuite sur
 * un fuyard (vu des MJ seulement). Dessinés par le module sur le canevas — pas d'effet d'acteur, rien d'écrit.
 */
import { MODULE_ID } from "../shared.mjs";

const NAME = "dnpc-morale";

function draw(token) {
  if ( !token?.document || token.destroyed ) return;
  const state = token.document.getFlag(MODULE_ID, "morale")?.state ?? null;
  const show = (state === "surrendered") || ((state === "fleeing") && game.user.isGM);
  let marker = token.getChildByName?.(NAME);
  if ( !show ) { if ( marker ) marker.destroy(); return; }
  const glyph = state === "surrendered" ? "🏳️" : "💨";
  if ( !marker ) {
    marker = new PIXI.Text(glyph, { fontSize: Math.round(token.h * 0.28), fontFamily: "sans-serif" });
    marker.name = NAME;
    marker.anchor.set(1, 0);
    token.addChild(marker);
  } else marker.text = glyph;
  marker.position.set(token.w, 0);
}

export function registerMarkers() {
  Hooks.on("refreshToken", token => draw(token));
  Hooks.on("updateToken", (doc, changes) => {
    if ( changes.flags?.[MODULE_ID] && ("morale" in changes.flags[MODULE_ID] || "-=morale" in changes.flags[MODULE_ID]) ) draw(doc.object);
  });
}
