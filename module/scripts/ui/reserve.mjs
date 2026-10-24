/**
 * Le bouton « Faire venir » (SPEC §10.5, `trigger: manual` — et toute réserve, à la main) dans la fiche du comportement « Réserve (DAS) »,
 * et « Remettre » (ses créatures parties redeviennent la réserve). MJ seulement ; le départ lui-même se fait chez le MJ actif.
 */
import { loc } from "../shared.mjs";
import { RESERVE_TYPE } from "../adapter/behaviors.mjs";
import { callReserve, resetReserve, reserveState } from "../runtime/flags.mjs";

function onRender(app, element) {
  const behavior = app.document;
  if ( !game.user.isGM || (behavior?.type !== RESERVE_TYPE) ) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if ( !root || root.querySelector(".dnpc-reserve-actions") ) return;
  const state = reserveState(behavior);
  const bar = document.createElement("div");
  bar.className = "form-group dnpc-reserve-actions";
  bar.innerHTML = `<label>${loc("Reserve.Etat", { members: state.members.length, sent: state.state?.sent?.length ?? 0 })}</label>`
    + `<div class="form-fields"><button type="button" data-action="dnpc-call"><i class="fa-solid fa-bullhorn"></i> ${loc("Reserve.Appeler")}</button>`
    + `<button type="button" data-action="dnpc-reset"><i class="fa-solid fa-rotate-left"></i> ${loc("Reserve.Remettre")}</button></div>`;
  bar.querySelector('[data-action="dnpc-call"]').addEventListener("click", ev => {
    ev.preventDefault();
    if ( !game.users.activeGM?.isSelf ) return ui.notifications.warn(loc("Reserve.PasMJActif"));
    ui.notifications.info(loc(callReserve(behavior) ? "Reserve.EnRoute" : "Reserve.Vide"));
  });
  bar.querySelector('[data-action="dnpc-reset"]').addEventListener("click", async ev => {
    ev.preventDefault();
    await resetReserve(behavior);
    app.render();
  });
  const anchor = root.querySelector("footer, .form-footer") ?? root.querySelector("form") ?? root;
  anchor.before?.(bar) ?? root.append(bar);
}

export function registerReserveUI() {
  Hooks.on("renderRegionBehaviorConfig", onRender);
}
