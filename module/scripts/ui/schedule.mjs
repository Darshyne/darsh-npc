/**
 * L'éditeur d'horaires (SPEC §10.6, étape 9 bis) : un bouton du HUD du token (MJ) ouvre la liste de ses créneaux — de ce token, ou de
 * tout son groupe sur la scène. Un créneau : de, à, activité, région, réveil (secondes, pour le sommeil).
 */
import { loc, escape } from "../shared.mjs";
import { refusal } from "../runtime/pilot.mjs";
import { groupOf } from "../runtime/flags.mjs";
import { ownSchedule, groupSchedule, setOwnSchedule, setGroupSchedule, worldMinute, slotOf } from "../runtime/schedule.mjs";
import { ACTIVITIES, WAKE_SECONDS, normalizeSlots, formatTime } from "../core/schedule.mjs";
import { PATROL_TYPE, POST_TYPE } from "../adapter/behaviors.mjs";

/** Les régions de la scène, avec ce qu'elles portent (patrouille, poste). */
function regionsOf(scene) {
  return scene.regions.contents.map(r => {
    const tags = [];
    if ( r.behaviors.some(b => b.type === PATROL_TYPE) ) tags.push(loc("Affecter.route"));
    if ( r.behaviors.some(b => b.type === POST_TYPE) ) tags.push(loc("Affecter.post"));
    return { id: r.id, name: r.name, label: tags.length ? `${r.name} (${tags.join(", ")})` : r.name };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function rowHtml(slot, regions) {
  const acts = ACTIVITIES.map(a => `<option value="${a}" ${slot.activity === a ? "selected" : ""}>${escape(loc(`Horaire.Activite.${a}`))}</option>`).join("");
  const regs = [`<option value="">—</option>`, ...regions.map(r => `<option value="${r.id}" ${slot.region === r.id ? "selected" : ""}>${escape(r.label)}</option>`)].join("");
  return `<tr class="dnpc-slot">
    <td><input type="time" name="from" value="${escape(slot.from ?? "06:00")}"></td>
    <td><input type="time" name="to" value="${escape(slot.to ?? "18:00")}"></td>
    <td><select name="activity">${acts}</select></td>
    <td><select name="region">${regs}</select></td>
    <td><input type="number" name="wake" min="0" step="1" value="${escape(slot.wake ?? WAKE_SECONDS)}" style="width:4em"></td>
    <td><a class="dnpc-slot-remove" data-tooltip="${escape(loc("Horaire.Retirer"))}"><i class="fa-solid fa-trash"></i></a></td>
  </tr>`;
}

function rowsOf(root) {
  return [...root.querySelectorAll("tr.dnpc-slot")].map(tr => {
    const v = n => tr.querySelector(`[name="${n}"]`)?.value ?? "";
    const slot = { from: v("from"), to: v("to"), activity: v("activity") };
    if ( v("region") ) slot.region = v("region");
    if ( slot.activity === "sleep" ) slot.wake = Number(v("wake") || WAKE_SECONDS);
    return slot;
  });
}

export async function openScheduleEditor(token) {
  const scene = token.parent;
  const regions = regionsOf(scene);
  const group = groupOf(token);
  const { minute } = worldMinute();
  const slot = slotOf(token);
  const lists = { token: ownSchedule(token) ?? [], group: groupSchedule(token) ?? [] };
  const initial = lists.token.length || !lists.group.length ? "token" : "group";
  const body = list => list.map(s => rowHtml(s, regions)).join("");
  const content = `<div class="dnpc-schedule">
    <p>${escape(loc("Horaire.Maintenant", { time: formatTime(minute), slot: slot?.activity ? loc(`Horaire.Activite.${slot.activity}`) : "—" }))}</p>
    <div class="form-group"><label>${escape(loc("Horaire.Pour"))}</label><select name="target">
      <option value="token" ${initial === "token" ? "selected" : ""}>${escape(loc("Horaire.PourToken", { name: token.name }))}</option>
      <option value="group" ${initial === "group" ? "selected" : ""}>${escape(loc("Horaire.PourGroupe", { group }))}</option>
    </select></div>
    <table><thead><tr><th>${escape(loc("Horaire.De"))}</th><th>${escape(loc("Horaire.A"))}</th><th>${escape(loc("Horaire.Activite.Titre"))}</th>
      <th>${escape(loc("Horaire.Region"))}</th><th data-tooltip="${escape(loc("Horaire.ReveilIndic"))}">${escape(loc("Horaire.Reveil"))}</th><th></th></tr></thead>
      <tbody>${body(lists[initial])}</tbody></table>
    <button type="button" class="dnpc-slot-add"><i class="fa-solid fa-plus"></i> ${escape(loc("Horaire.Ajouter"))}</button>
    <p class="hint">${escape(loc("Horaire.Indic"))}</p>
  </div>`;
  let current = initial;
  const answer = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Horaire.Titre", { name: token.name }) },
    position: { width: 640 },
    content,
    render: (event, dialog) => {
      const root = dialog.element;
      const tbody = root.querySelector(".dnpc-schedule tbody");
      root.querySelector(".dnpc-slot-add")?.addEventListener("click", () => tbody.insertAdjacentHTML("beforeend", rowHtml({}, regions)));
      root.addEventListener("click", ev => {
        const remove = ev.target.closest(".dnpc-slot-remove");
        if ( remove ) remove.closest("tr")?.remove();
      });
      root.querySelector('select[name="target"]')?.addEventListener("change", ev => {
        lists[current] = rowsOf(root);
        current = ev.target.value;
        tbody.innerHTML = body(lists[current]);
      });
    },
    ok: { label: loc("Horaire.Ok"), callback: (event, button) => ({ target: button.form.elements.target.value, slots: rowsOf(button.form) }) },
    rejectClose: false
  });
  if ( !answer ) return;
  const { slots, problems } = normalizeSlots(answer.slots);
  if ( problems.length ) ui.notifications.warn(loc("Horaire.Ecartes", { problems: problems.join(" ; ") }));
  // On garde la saisie telle quelle (« 22:00 »), seulement les créneaux lisibles.
  const kept = slots.map(s => answer.slots[s.index]);
  if ( answer.target === "group" ) await setGroupSchedule(scene, group, kept);
  else await setOwnSchedule(token, kept);
}

function onTokenHUD(hud, html) {
  if ( !game.user.isGM ) return;
  const token = hud.document;
  if ( !token || refusal(token) ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.left");
  if ( !column ) return;
  const has = !!(ownSchedule(token)?.length || groupSchedule(token)?.length);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon dnpc-schedule-button${has ? " active" : ""}`;
  button.dataset.tooltip = loc("Horaire.Bouton");
  button.innerHTML = `<i class="fa-solid fa-clock"></i>`;
  button.addEventListener("click", ev => {
    ev.preventDefault(); ev.stopPropagation();
    openScheduleEditor(token).then(() => hud.render()).catch(err => ui.notifications.warn(err.message));
  });
  column.append(button);
}

export function registerScheduleUI() {
  Hooks.on("renderTokenHUD", onTokenHUD);
}
