/**
 * Le moral en jeu (SPEC §9.5, étape 4 du §16) : le test au début du tour d'un token piloté, la fuite, la reddition, et les répliques
 * `flee` / `surrender`. La règle est dans `core/morale.mjs` ; le jet, la marche, l'action de base et le lâcher sont ceux du moteur.
 *
 * L'état vit dans un flag de **token** (`flags["darsh-npc"].morale`), remis à neuf à chaque nouveau combat :
 *   { combat, tested: [causes], idle, calm, state: null | "fleeing" | "surrendered", disposition, fromSurrender }
 * Une créature rendue passe en disposition Neutre (donnée du token) et ne joue plus ses tours ; attaquée, elle reprend sa disposition
 * et fuit si elle peut, sinon se défend, sans nouveau test (Q4).
 */
import { MODULE_ID, loc, log, setting } from "../shared.mjs";
import * as engine from "../adapter/engine.mjs";
import { allied } from "../adapter/view.mjs";
import { factsOf } from "../adapter/sheet.mjs";
import { profileFor } from "./profile.mjs";
import { atLeast } from "../core/profile.mjs";
import { moraleTest, moraleTriggers, canSurrender, fleeAction, CALM_TURNS } from "../core/morale.mjs";

const isActiveGM = () => game.users.activeGM?.isSelf === true;
const isDown = actor => (actor?.system?.attributes?.hp?.value ?? 0) <= 0;

/** L'état de moral de ce token pour ce combat (neuf si le flag date d'un autre combat ; hors combat, tel quel). */
export function moraleOf(token, combat=game.combat) {
  const own = token?.getFlag?.(MODULE_ID, "morale");
  if ( own && (!combat || (own.combat === combat.id)) ) return { tested: [], idle: 0, calm: 0, state: null, ...own };
  return { combat: combat?.id ?? null, tested: [], idle: 0, calm: 0, state: null };
}

/** Écrire l'état de moral (flag de token : rien sur la fiche). */
export async function setMorale(token, patch, combat=game.combat) {
  const current = moraleOf(token, combat);
  const next = { ...current, ...patch, combat: combat?.id ?? current.combat ?? null };
  await token.setFlag(MODULE_ID, "morale", next);
  return next;
}

/** Une réplique en personnage (§11), si la créature parle ; bulle de chat du cœur comprise. Étape 5 : répliques complètes. */
export async function bark(token, moment) {
  const facts = factsOf(token.actor);
  if ( !facts.speaks ) return null;
  const lines = [1, 2, 3].map(n => `DNPC.Replique.${moment}.${n}`).filter(k => game.i18n.has(k)).map(k => game.i18n.localize(k));
  if ( !lines.length ) return null;
  const content = lines[Math.floor(Math.random() * lines.length)];
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token }), content, style: CONST.CHAT_MESSAGE_STYLES.IC,
    flags: { [MODULE_ID]: { bark: { token: token.uuid, moment } } }
  });
}

/** Les alliés de la créature **dans ce combat**, pour les causes `halfDown` et `leaderDown`. */
function groupOf(token, combat) {
  const out = [];
  for ( const c of combat?.combatants ?? [] ) {
    const other = c.token;
    if ( !other?.actor || (other.id === token.id) || !allied(token, other) ) continue;
    const facts = factsOf(other.actor);
    out.push({ down: isDown(other.actor), cr: facts.cr, leader: !!profileFor(other.actor, other).profile.leader });
  }
  return out;
}

/**
 * Le test de moral du début de tour, s'il y a une cause nouvelle. Toutes les causes présentes sont marquées testées (un seul jet
 * les couvre). Rend l'étape jouée `{ type: "morale", causes, total, dc, success }`, ou null (pas de cause, pas soumis, moteur ancien).
 */
export async function checkMorale(token, combat, profile) {
  if ( !setting("morale") ) return null;
  const state = moraleOf(token, combat);
  if ( state.state ) return null;
  const test = moraleTest(profile);
  if ( !test ) return null;
  const facts = factsOf(token.actor);
  const causes = moraleTriggers({ hp: facts.hp, cr: facts.cr, group: groupOf(token, combat), idle: state.idle, tested: state.tested });
  if ( !causes.length ) return null;
  const flavor = loc("Moral.Titre", { name: token.name, causes: causes.map(c => loc(`Moral.Cause.${c}`)).join(", ") });
  const result = await engine.save(token.actor, { ...test, flavor });
  if ( !result ) return null;
  const tested = [...new Set([...state.tested, ...causes])];
  if ( result.success ) await setMorale(token, { tested }, combat);
  else {
    await setMorale(token, { tested, state: "fleeing", calm: 0 }, combat);
    await bark(token, "flee");
  }
  log.info(`${token.name}: morale ${causes.join("+")} → ${result.total} vs ${result.dc} ${result.success ? "holds" : "breaks"}`);
  return { type: "morale", causes, total: result.total, dc: result.dc, success: result.success };
}

/** Se rendre : lâcher ce qu'on tient (moteur), passer Neutre (token), ne plus jouer ; réplique `surrender`. */
async function surrender(token, combat) {
  const dropped = await engine.drop(token);
  const disposition = token.disposition;
  await token.update({ disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL });
  await setMorale(token, { state: "surrendered", disposition }, combat);
  await bark(token, "surrender");
  return { type: "surrender", dropped: dropped?.items ?? [] };
}

/**
 * Le tour d'un fuyard. Rend `{ steps, reason }` — `reason` : `fleeing` (il a fui), `calm` (plus d'ennemi en vue depuis assez
 * longtemps : il se calme, le tour continue normalement), `defend` (acculé et ne peut se rendre : il se bat), `surrendered`,
 * `engineTooOld`.
 */
export async function fleeTurn(token, combatant, profile, view) {
  const combat = combatant?.combat ?? game.combat;
  const state = moraleOf(token, combat);
  const enemies = (view.enemies ?? []).filter(e => !e.down && (e.visible !== false));
  if ( !enemies.length ) {
    const calm = (state.calm ?? 0) + 1;
    if ( calm >= CALM_TURNS ) { await setMorale(token, { state: null, calm: 0 }, combat); return { steps: [], reason: "calm" }; }
    await setMorale(token, { calm }, combat);
    return { steps: [], reason: "fleeing" };
  }
  if ( state.calm ) await setMorale(token, { calm: 0 }, combat);
  const nearest = enemies.reduce((a, b) => (b.distance < a.distance ? b : a));
  const anchor = token.parent.tokens.get(nearest.id);
  const threatened = enemies.some(e => e.distance === 0);
  const actionFree = !!(combatant && engine.budget(combatant)?.action);
  const speed = engine.movement(token)?.speed ?? 0;
  const kind = fleeAction(profile, threatened, atLeast);
  const probe = await engine.flee(token, anchor, { dryRun: true, extra: (actionFree && (kind === "dash")) ? speed : 0 });
  if ( probe.reason === "unsupported" ) return { steps: [], reason: "engineTooOld" };
  if ( !probe.possible ) {
    const facts = factsOf(token.actor);
    if ( !state.fromSurrender && canSurrender(profile, facts.abilities.int) ) {
      return { steps: [await surrender(token, combat)], reason: "surrendered" };
    }
    return { steps: [], reason: "defend" };
  }
  const took = actionFree ? await engine.takeBasic(token.actor, kind) : false;
  const walked = await engine.flee(token, anchor, {});
  return {
    steps: [{ type: "flee", from: anchor.name, action: took ? kind : null, gapFrom: walked.from ?? null, gapTo: walked.to ?? null, moved: !!walked.moved }],
    reason: "fleeing"
  };
}

/** Le tour vaut-il « pouvoir nuire » ? Compte les tours de suite sans le pouvoir (cause `cantHarm`). */
export async function noteHarm(token, combat, { attacked, couldNotReach }) {
  const state = moraleOf(token, combat);
  if ( attacked && state.idle ) await setMorale(token, { idle: 0 }, combat);
  else if ( !attacked && couldNotReach ) await setMorale(token, { idle: (state.idle ?? 0) + 1 }, combat);
}

/** Une créature rendue qu'on attaque reprend sa disposition et fuit si elle peut, sinon se défend (Q4), sans nouveau test. */
async function onResolution(resolution) {
  if ( !isActiveGM() || !resolution?.plan?.attack ) return;
  for ( const t of resolution.targets ?? [] ) {
    const token = fromUuidSync(t.token ?? "", { strict: false });
    if ( !token?.isOwner ) continue;
    const state = moraleOf(token);
    if ( state.state !== "surrendered" ) continue;
    if ( Number.isFinite(state.disposition) ) await token.update({ disposition: state.disposition });
    await setMorale(token, { state: "fleeing", fromSurrender: true, calm: 0 });
    log.info(`${token.name}: attacked after surrendering — flees if it can`);
  }
}

export function registerMorale() {
  game.settings.register(MODULE_ID, "morale", {
    name: "DNPC.Reglage.Moral.Nom", hint: "DNPC.Reglage.Moral.Indic", scope: "world", config: true, type: Boolean, default: true
  });
  engine.onResolution(resolution => { onResolution(resolution).catch(err => log.error("morale: surrender broken", err)); });
  // Fin du combat : un fuyard ne fuit plus (une créature rendue le reste — la suite est au MJ).
  Hooks.on("deleteCombat", async combat => {
    if ( !isActiveGM() ) return;
    for ( const c of combat.combatants ) {
      const token = c.token;
      const own = token?.getFlag?.(MODULE_ID, "morale");
      if ( own && (own.state !== "surrendered") ) await token.unsetFlag(MODULE_ID, "morale").catch(() => {});
    }
  });
}
