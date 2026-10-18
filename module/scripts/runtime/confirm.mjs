/**
 * Le mode `confirm` (SPEC §12.2, Q10 : carte de chat) : avant de jouer le tour d'un token en `confirm`, l'intention est montrée aux
 * MJ dans une carte privée — « Gobelin → Cimeterre sur Alara (la plus blessée) » — avec ses boutons : **Jouer**, une **autre cible**
 * (un bouton par ennemi perçu), **Passer le tour**, **Je joue** (le pilote se coupe pour ce tour). Un délai optionnel (réglage
 * `confirmDelay`, 0 = aucun) joue tout seul.
 *
 * L'attente vit dans la mémoire du MJ actif : après un F5, les boutons d'une carte restée ouverte ne font plus rien (la carte le dit).
 */
import { MODULE_ID, loc, setting, escape } from "../shared.mjs";

/** Cartes en attente : id du message → `{ resolve, token, timer }`. */
const pending = new Map();

/** Décrire l'intention en une ligne (texte déjà échappé). */
function describe(token, { plan, move, fleeing }) {
  const why = reasons => reasons?.length ? ` — ${reasons.map(r => escape(loc(`Raison.${r}`))).join(", ")}` : "";
  if ( fleeing ) return escape(loc("Confirmer.Fuit"));
  if ( plan?.type === "attack" ) {
    return escape(loc("Confirmer.Attaque", { attack: plan.attack.name, target: token.parent.tokens.get(plan.target)?.name ?? "?" })) + why(plan.reasons);
  }
  if ( move?.type === "climb" ) {
    return escape(loc("Confirmer.Grimpe", { target: token.parent.tokens.get(move.target)?.name ?? "?", attack: move.attack.name })) + why(move.reasons);
  }
  if ( move?.type === "move" ) {
    return escape(loc("Confirmer.Approche", { target: token.parent.tokens.get(move.target)?.name ?? "?", attack: move.attack.name })) + why(move.reasons);
  }
  return escape(loc(`Pilote.Rend.${move?.reason ?? plan?.reason ?? "noEnemy"}`));
}

/**
 * Montrer l'intention et attendre la décision du MJ. Rend `{ choice: "play" | "skip" | "manual", target? }`.
 * @param {TokenDocument} token
 * @param {{plan, move, view, fleeing?: boolean}} intent
 */
export async function askConfirm(token, intent) {
  const enemies = (intent.view?.enemies ?? []).filter(e => !e.down && (e.visible !== false));
  const targets = intent.fleeing ? "" : enemies.map(e =>
    `<button type="button" data-dnpc-choice="play" data-dnpc-target="${e.id}">${escape(loc("Confirmer.Cibler", { name: e.name }))}</button>`).join("");
  const content = `<div class="dnpc-trace dnpc-confirm"><h4><i class="fa-solid fa-circle-question"></i> ${escape(token.name)}</h4>`
    + `<p>${describe(token, intent)}</p>`
    + `<div class="dnpc-buttons">`
    + `<button type="button" data-dnpc-choice="play"><i class="fa-solid fa-play"></i> ${escape(loc("Confirmer.Jouer"))}</button>`
    + `<button type="button" data-dnpc-choice="skip"><i class="fa-solid fa-forward"></i> ${escape(loc("Confirmer.Passer"))}</button>`
    + `<button type="button" data-dnpc-choice="manual"><i class="fa-solid fa-hand"></i> ${escape(loc("Confirmer.JeJoue"))}</button>`
    + `</div>${targets ? `<div class="dnpc-buttons dnpc-targets">${targets}</div>` : ""}</div>`;
  const message = await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: { alias: loc("Pilote.Nom") },
    flags: { [MODULE_ID]: { confirm: { token: token.uuid } } }
  });
  return new Promise(resolve => {
    const delay = Number(setting("confirmDelay")) || 0;
    const timer = delay > 0 ? setTimeout(() => answer(message.id, { choice: "play" }), delay * 1000) : null;
    pending.set(message.id, { resolve, token, timer });
  });
}

/** Trancher une carte en attente (bouton, délai, reprise de main, arrêt d'urgence) ; la carte garde la décision. */
export function answer(messageId, decision) {
  const entry = pending.get(messageId);
  if ( !entry ) return false;
  pending.delete(messageId);
  clearTimeout(entry.timer);
  entry.resolve(decision);
  const message = game.messages.get(messageId);
  if ( message?.isOwner ) {
    const name = decision.target ? entry.token.parent?.tokens.get(decision.target)?.name : null;
    const said = loc(`Confirmer.Choix.${decision.choice}`) + (name ? ` — ${name}` : "");
    const content = message.content.replace(/<div class="dnpc-buttons[\s\S]*$/, `<p class="dnpc-decision">${escape(said)}</p></div>`);
    message.update({ content }).catch(() => {});
  }
  return true;
}

/** Trancher les cartes en attente d'un token (ou de tous) : reprise de main, arrêt d'urgence. */
export function answerAll(choice, tokenId=null) {
  for ( const [id, entry] of [...pending] ) {
    if ( !tokenId || (entry.token.id === tokenId) ) answer(id, { choice });
  }
}

/** Les boutons de la carte, chez un MJ. */
function onRender(message, html) {
  if ( !message.getFlag(MODULE_ID, "confirm") ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const buttons = root?.querySelectorAll("[data-dnpc-choice]") ?? [];
  const live = game.user.isGM && pending.has(message.id);
  for ( const button of buttons ) {
    if ( !live ) { button.disabled = true; continue; }
    button.addEventListener("click", ev => {
      ev.preventDefault();
      answer(message.id, { choice: button.dataset.dnpcChoice, target: button.dataset.dnpcTarget ?? null });
    });
  }
  if ( !live && buttons.length && game.user.isGM ) {
    root.querySelector(".dnpc-buttons")?.insertAdjacentHTML("beforebegin", `<p class="dnpc-yield">${escape(loc("Confirmer.Expire"))}</p>`);
  }
}

export function registerConfirm() {
  game.settings.register(MODULE_ID, "confirmDelay", {
    name: "DNPC.Reglage.Confirmer.Nom", hint: "DNPC.Reglage.Confirmer.Indic", scope: "world", config: true, type: Number,
    range: { min: 0, max: 60, step: 5 }, default: 0
  });
  Hooks.on("renderChatMessageHTML", onRender);
}
