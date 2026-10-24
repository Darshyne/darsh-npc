/**
 * Affecter un token à une patrouille ou à un poste de garde (SPEC §10.1, étape 6a) : un bouton du HUD du token (MJ) ouvre la liste
 * des patrouilles et des postes de la scène. L'affectation est un flag de token (`route` ou `post`), jamais les deux.
 */
import { MODULE_ID, loc, escape } from "../shared.mjs";
import { assignable } from "../adapter/behaviors.mjs";
import { refusal } from "../runtime/pilot.mjs";
import { forget } from "../runtime/clock.mjs";
import { groupOf } from "../runtime/flags.mjs";

/** Poser l'affectation : `regionId` d'une patrouille ou d'un poste, ou null pour la retirer. */
export async function assign(token, regionId) {
  const target = regionId ? assignable(token.parent).find(a => a.region.id === regionId) : null;
  if ( regionId && !target ) throw new Error(`region ${regionId} is neither a patrol nor a guard post`);
  await token.update({ [`flags.${MODULE_ID}.-=route`]: null, [`flags.${MODULE_ID}.-=post`]: null });
  if ( target ) await token.setFlag(MODULE_ID, target.kind, regionId);
  await forget(token);
  return target ? { kind: target.kind, region: target.region.name } : null;
}

async function openDialog(token) {
  const list = assignable(token.parent);
  const current = token.getFlag(MODULE_ID, "route") ?? token.getFlag(MODULE_ID, "post") ?? "";
  const group = token.getFlag(MODULE_ID, "group") ?? "";
  const options = [`<option value="">${escape(loc("Affecter.Aucune"))}</option>`,
    ...list.map(a => `<option value="${a.region.id}" ${a.region.id === current ? "selected" : ""}>`
      + `${escape(loc(`Affecter.${a.kind}`))} — ${escape(a.behavior.system?.label || a.region.name)}</option>`)].join("");
  const content = (list.length
    ? `<div class="form-group"><label>${escape(loc("Affecter.Choix"))}</label><select name="region">${options}</select></div>`
    : `<p>${escape(loc("Affecter.Rien"))}</p>`)
    // Étape 7 : le groupe (§4) — qui partage les alarmes ; vide, sa faction.
    + `<div class="form-group"><label>${escape(loc("Affecter.Groupe"))}</label><input type="text" name="group" value="${escape(group)}" `
    + `placeholder="${escape(groupOf(token))}"><p class="hint">${escape(loc("Affecter.GroupeIndic"))}</p></div>`;
  const answer = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Affecter.Titre", { name: token.name }) }, content,
    ok: { label: loc("Affecter.Ok"), callback: (event, button) => ({
      region: button.form.elements.region?.value ?? current, group: (button.form.elements.group?.value ?? "").trim()
    }) },
    rejectClose: false
  });
  if ( !answer ) return;
  if ( answer.group !== group ) {
    if ( answer.group ) await token.setFlag(MODULE_ID, "group", answer.group);
    else await token.unsetFlag(MODULE_ID, "group");
  }
  if ( (answer.region || "") !== current ) await assign(token, answer.region || null).catch(err => ui.notifications.warn(err.message));
}

function onTokenHUD(hud, html) {
  if ( !game.user.isGM ) return;
  const token = hud.document;
  if ( !token || refusal(token) ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.left");
  if ( !column ) return;
  const assigned = !!(token.getFlag(MODULE_ID, "route") || token.getFlag(MODULE_ID, "post"));
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon dnpc-assign${assigned ? " active" : ""}`;
  button.dataset.tooltip = loc("Affecter.Bouton");
  button.innerHTML = `<i class="fa-solid fa-route"></i>`;
  button.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); openDialog(token).then(() => hud.render()); });
  column.append(button);
}

export function registerAssign() {
  Hooks.on("renderTokenHUD", onTokenHUD);
}
