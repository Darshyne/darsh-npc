/**
 * Drapeaux, alarme de groupe et renforts en jeu (SPEC §10.2, §10.5, §7.2 ; étape 7 du §16). Chez le MJ actif, sur la scène qu'il affiche.
 *
 *  - **Interdit** : le comportement pose `avoid` du moteur sur sa région (adapter/engine.mjs `setAvoid`), le retire s'il disparaît.
 *  - **Alarme** : une créature menée en alerte (bande `simple` et plus) qui est dans la région, ou qui y arrive en fuyant, donne
 *    l'alerte : tout son **groupe** de la scène passe en alerte et converge vers la dernière position connue de l'ennemi ; le son du
 *    drapeau joue une fois ; les réserves qui attendent l'alarme se mettent en route.
 *  - **Refuge** : destination de fuite (runtime/morale.mjs) ; `exit` : y arriver **cache** le token (jamais supprimé), carte MJ.
 *  - **Poste de tir** : lu par le pilote (runtime/pilot.mjs), rien ici.
 *  - **Réserve** : ses créatures menées sont cachées et inertes (une créature cachée n'existe pour aucune règle de ce module) ; à son
 *    déclencheur (alarme, pertes, appel d'un fuyard, MJ), après son délai (secondes hors combat, rounds en combat, ±30 %), `count`
 *    d'entre elles sont révélées (et `spawn` créées depuis `actor`), passent en alerte vers la dernière position connue et rejoignent
 *    le combat s'il y en a un.
 *
 * Le **groupe** d'un token (§4) : son flag `group`, sinon sa faction selon le moteur, sinon sa disposition.
 * État : la mémoire du MJ actif (dernière position connue par scène et par groupe, alarmes récentes, départs en attente), et le flag
 * `state` du comportement Réserve (`{ fired, sent: [ids], spawned }` — une écriture de scène).
 */
import { MODULE_ID, loc, log, setting, escape } from "../shared.mjs";
import { levelAtLeast } from "../adapter/settings.mjs";
import * as engine from "../adapter/engine.mjs";
import { hostile, centreOf, lineOfSight, footprintOf } from "../adapter/view.mjs";
import { FLAG_TYPE, RESERVE_TYPE, flagsOf, reservesOf, cellsOf, centreOfRegion, regionHas } from "../adapter/behaviors.mjs";
import { covers, groupsOf, lossesReached, reserveDelay, pickMembers, ringsAlarm } from "../core/flags.mjs";
import { refusal } from "./pilot.mjs";
import { profileFor } from "./profile.mjs";
import { bark } from "./barks.mjs";
import { alarm as alarmToken, driven } from "./clock.mjs";
import { engage } from "./engage.mjs";

const isActiveGM = () => game.users.activeGM?.isSelf === true;
const OUT = ["dead", "unconscious", "incapacitated", "paralyzed", "petrified", "stunned"];
const isDown = token => {
  const actor = token?.actor;
  return !actor || ((actor.system?.attributes?.hp?.value ?? 1) <= 0) || OUT.some(s => actor.statuses?.has(s));
};
/** Le token est-il dans un combat commencé de sa scène (il joue alors au tour par tour) ? */
const fighting = token => game.combats.some(c => c.started && (c.scene?.id === token.parent.id) && c.combatants.some(x => x.tokenId === token.id));
/** Une même alarme ne resonne pas avant tant de temps (ms) pour un même groupe. */
const ALARM_COOLDOWN_MS = 60000;

/* -------------------------------------------- */
/*  Groupes et dernière position connue          */
/* -------------------------------------------- */

/** Le groupe d'un token (§4) : flag `group`, sinon faction du moteur, sinon disposition. */
export function groupOf(token) {
  const own = token?.getFlag?.(MODULE_ID, "group");
  if ( own ) return String(own);
  return engine.factionOf(token) ?? `disposition:${token?.disposition ?? 0}`;
}

/** Deux tokens sont-ils du même groupe (et pas ennemis : un groupe posé à la main peut réunir deux factions) ? */
export const sameGroup = (a, b) => (groupOf(a) === groupOf(b)) && !hostile(a, b);

/** Le drapeau ou la réserve couvre-t-il ce token ? */
export const behaviorCovers = (behavior, token) => covers(groupsOf(behavior.system?.groups), groupOf(token));

/** `scene.id` → `group` → `{ point, at }` */
const known = new Map();
/** `scene.id` → `group` → instant de la dernière alarme */
const rung = new Map();

/** Noter où l'ennemi a été vu (l'horloge, à chaque ennemi vu). */
export function noteSeen(token, point) {
  if ( !point ) return;
  const scene = token.parent;
  if ( !known.has(scene.id) ) known.set(scene.id, new Map());
  known.get(scene.id).set(groupOf(token), { point: { x: point.x, y: point.y }, at: Date.now() });
}

/**
 * La dernière position connue de l'ennemi pour ce groupe ; à défaut (en combat, l'horloge ne voit rien), l'ennemi visible le plus
 * proche de `near` (un token hostile au groupe, non caché) ; à défaut, null.
 */
export function lastKnown(scene, group, near=null, sample=null) {
  const own = known.get(scene.id)?.get(group);
  if ( own ) return { ...own.point };
  if ( !near || !sample ) return null;
  let best = null, bestD = Infinity;
  for ( const other of scene.tokens ) {
    if ( other.hidden || isDown(other) || engine.isHidden(other) || !hostile(sample, other) ) continue;
    const at = centreOf(other);
    const d = Math.hypot(at.x - near.x, at.y - near.y);
    if ( d < bestD ) { best = at; bestD = d; }
  }
  return best;
}

/* -------------------------------------------- */
/*  Interdit                                     */
/* -------------------------------------------- */

/** Aligner le `avoid` du moteur d'une région sur ses drapeaux « Interdit » (on ne retire que ce qu'on a posé). */
async function syncForbidden(region) {
  if ( !region?.parent ) return;
  const wanted = (region.behaviors ?? []).some(b => (b.type === FLAG_TYPE) && !b.disabled && (b.system?.kind === "forbidden"));
  const ours = region.getFlag(MODULE_ID, "avoid") === true;
  if ( wanted && !engine.avoids(region) ) {
    await engine.setAvoid(region, true);
    await region.setFlag(MODULE_ID, "avoid", true);
  } else if ( !wanted && ours ) {
    await engine.setAvoid(region, false);
    await region.unsetFlag(MODULE_ID, "avoid");
  }
}

/* -------------------------------------------- */
/*  Alarme                                       */
/* -------------------------------------------- */

/** Le drapeau Alarme sous ce token, qui couvre son groupe, ou null. */
export function alarmUnder(token) {
  const at = centreOf(token);
  return flagsOf(token.parent, "alarm").find(f => behaviorCovers(f.behavior, token) && regionHas(f.region, at, token._source.elevation ?? 0)) ?? null;
}

/** L'alarme de ce groupe a-t-elle sonné il y a peu ? */
export function recentlyRung(scene, group) {
  const at = rung.get(scene.id)?.get(group) ?? 0;
  return (Date.now() - at) < ALARM_COOLDOWN_MS;
}

/** Oublier les alarmes récentes et les dernières positions connues d'une scène (scénarios, remise à zéro). */
export function resetAlarms(scene) {
  rung.delete(scene?.id);
  known.delete(scene?.id);
}

/**
 * Donner l'alerte (§10.2 `alarm`, §14.1 `api.ai.alert`) : tout le groupe de `by` sur la scène (hors combat, mené par l'IA, pas caché) passe
 * en alerte vers `point`, chacun avec un petit délai (ils ne réagissent pas tous en même temps) ; le son du drapeau ; la réplique
 * `alarm` de qui la donne ; les réserves `alarm` qui couvrent le groupe partent. Rend `{ group, alerted: [noms], reserves }`, ou null
 * (déjà sonnée il y a moins d'une minute, sauf `force`).
 */
export async function raiseAlarm(scene, by, point, { flag=null, cause="flag", force=false, group=null }={}) {
  if ( !scene ) return null;
  const key = group ?? (by ? groupOf(by) : null);
  if ( !key ) return null;
  if ( !force && recentlyRung(scene, key) ) return null;
  if ( !rung.has(scene.id) ) rung.set(scene.id, new Map());
  rung.get(scene.id).set(key, Date.now());
  const goal = point ?? (by ? centreOf(by) : null);
  if ( goal ) {
    if ( !known.has(scene.id) ) known.set(scene.id, new Map());
    known.get(scene.id).set(key, { point: { ...goal }, at: Date.now() });
  }
  const alerted = [];
  const skipped = [];
  for ( const other of scene.tokens ) {
    if ( (other === by) || refusal(other) || (groupOf(other) !== key) ) continue;
    const why = other.hidden ? "hidden" : isDown(other) ? "down" : !driven(other) ? "notDriven" : fighting(other) ? "fighting"
      : (by && hostile(by, other)) ? "hostile" : (flag && !behaviorCovers(flag.behavior, other)) ? "notCovered" : null;
    if ( why ) { skipped.push({ name: other.name, why }); continue; }
    if ( goal ) alarmToken(other, goal, 200 + (Math.random() * 1300));
    alerted.push(other.name);
  }
  const src = flag?.behavior?.system?.sound;
  if ( src ) foundry.audio.AudioHelper.play({ src, volume: 0.8, autoplay: true, loop: false }, true);
  if ( by ) bark(by, "alarm", { force: true }).catch(() => null);
  Hooks.callAll(`${MODULE_ID}.alert`, key, scene, { cause, by: by?.id ?? null, point: goal, flag: flag?.region?.id ?? null });
  log.info(`alarm (${cause}) for group ${key}: ${alerted.join(", ") || "nobody else"}`
    + (skipped.length ? ` (skipped: ${skipped.map(x => `${x.name} ${x.why}`).join(", ")})` : ""));
  const reserves = [];
  for ( const r of reservesOf(scene) ) {
    if ( (r.behavior.system?.trigger !== "alarm") || !covers(groupsOf(r.behavior.system?.groups), key) ) continue;
    if ( schedule(r, { cause: "alarm", point: goal, group: key }) ) reserves.push(r.behavior.system?.label || r.region.name);
  }
  if ( flag || reserves.length ) await gmCard(loc("Alarme.Carte", { name: by?.name ?? "—", label: flag ? labelOf(flag) : loc("Alarme.Main"),
    names: alerted.join(", ") || "—" }), reserves.length ? loc("Alarme.Reserves", { names: reserves.join(", ") }) : null,
    { alarm: { group: key, alerted, skipped } });
  return { group: key, alerted, reserves };
}

/* -------------------------------------------- */
/*  Refuge, alarme, réserve : où fuir            */
/* -------------------------------------------- */

const labelOf = ({ region, behavior }) => behavior.system?.label || region.name;

/** Les cases d'une région où l'on peut finir (pas un autre token vivant dessus), avec leur niveau. */
function freeCells(region, token) {
  const taken = new Set();
  for ( const other of region.parent.tokens ) {
    if ( (other === token) || other.hidden || isDown(other) ) continue;
    const f = footprintOf(other);
    for ( let i = f.i0; i <= f.i1; i++ ) for ( let j = f.j0; j <= f.j1; j++ ) taken.add(`${i}.${j}`);
  }
  return cellsOf(region, { elevation: token._source.elevation ?? 0 }).filter(c => !taken.has(`${c.i}.${c.j}`));
}

/** Une région où ce token peut aller (un chemin existe, quel qu'en soit le coût) : ses cases libres, ou null. */
function reachable(token, region) {
  const cells = freeCells(region, token);
  if ( !cells.length ) return null;
  const level = token._source.level ?? null;
  // Sans plafond : un chemin existe-t-il ? (`arrives` est faux quand une porte est sur le chemin : le moteur l'ouvrira en marchant.)
  const path = engine.pathToCells(token, cells, { level, maxCost: Infinity });
  return (path?.arrives || path?.door) ? cells : null;
}

/** Une réserve peut-elle encore envoyer quelqu'un ? */
function reserveLeft({ region, behavior }) {
  const sys = behavior.system ?? {};
  const state = behavior.getFlag(MODULE_ID, "state") ?? {};
  if ( sys.once && state.fired ) return false;
  return membersOf({ region, behavior }).length > 0 || ((sys.spawn ?? 0) > 0 && !!sys.actor && !(sys.once && state.fired));
}

/** Des renforts sont-ils disponibles pour ce token (§10.5 « Lecture pour l'IA ») : une réserve non vidée qui couvre son groupe. */
export function reinforcementsAvailable(token) {
  return reservesOf(token.parent).some(r => behaviorCovers(r.behavior, token) && reserveLeft(r));
}

/**
 * Les destinations de fuite atteignables (§9.5, §10.5) : `{ reserve, alarm, refuge }`, chacune `{ region, behavior, cells, kind }` ou
 * null. Le refuge : d'abord un refuge hors de vue de tous les ennemis (un mur entre eux et son centre), sinon le plus proche.
 */
export function fleeOptions(token, enemies=[]) {
  const scene = token.parent;
  const here = centreOf(token);
  const byDistance = list => list.map(x => ({ ...x, d: Math.hypot((centreOfRegion(x.region)?.x ?? 0) - here.x, (centreOfRegion(x.region)?.y ?? 0) - here.y) }))
    .sort((a, b) => a.d - b.d);
  const first = (list, kind) => {
    for ( const x of byDistance(list) ) {
      const cells = reachable(token, x.region);
      if ( cells ) return { ...x, cells, kind };
    }
    return null;
  };
  const group = groupOf(token);
  const reserve = first(reservesOf(scene).filter(r => (r.behavior.system?.trigger === "call") && behaviorCovers(r.behavior, token) && reserveLeft(r)), "reserve");
  const alarm = recentlyRung(scene, group) ? null : first(flagsOf(scene, "alarm").filter(f => behaviorCovers(f.behavior, token)), "alarm");
  const refuges = flagsOf(scene, "refuge").filter(f => behaviorCovers(f.behavior, token));
  const hidden = refuges.filter(f => {
    const c = centreOfRegion(f.region);
    return c && enemies.every(e => !lineOfSight(centreOf(e), c));
  });
  const refuge = first(hidden, "refuge") ?? first(refuges, "refuge");
  return { reserve, alarm, refuge };
}

/**
 * Un token arrive quelque part (après une marche de fuite) : au refuge-sortie, il quitte la scène (caché) ; à l'alarme, il la donne ;
 * à une réserve qu'on appelle, elle part. Rend ce qui s'est passé : `exit` | `alarm` | `call` | null.
 */
export async function onArrive(token) {
  const scene = token.parent;
  const at = centreOf(token);
  const elevation = token._source.elevation ?? 0;
  const inside = list => list.find(x => behaviorCovers(x.behavior, token) && regionHas(x.region, at, elevation)) ?? null;
  const exit = inside(flagsOf(scene, "refuge").filter(f => f.behavior.system?.exit));
  if ( exit ) {
    await token.update({ hidden: true });
    const combatant = game.combats.find(c => c.scene?.id === scene.id)?.combatants.find(c => c.tokenId === token.id);
    if ( combatant ) await combatant.update({ hidden: true }).catch(() => {});
    await gmCard(loc("Refuge.Sortie", { name: token.name, label: labelOf(exit) }));
    log.info(`${token.name}: left the scene through ${labelOf(exit)} (hidden)`);
    return "exit";
  }
  const reserve = inside(reservesOf(scene).filter(r => r.behavior.system?.trigger === "call"));
  if ( reserve && reserveLeft(reserve) ) {
    const point = lastKnown(scene, groupOf(token), at, token);
    schedule(reserve, { cause: "call", point, group: groupOf(token), by: token });
    bark(token, "alarm", { force: true }).catch(() => null);
    return "call";
  }
  const flag = alarmUnder(token);
  if ( flag && !recentlyRung(scene, groupOf(token)) ) {
    await raiseAlarm(scene, token, lastKnown(scene, groupOf(token), at, token), { flag, cause: "flag" });
    return "alarm";
  }
  return null;
}

/* -------------------------------------------- */
/*  Réserves                                     */
/* -------------------------------------------- */

/** Les créatures d'une réserve : menées par l'IA, dans la région, pas encore parties (ni créées par une réserve : elles arrivent). */
export function membersOf({ region, behavior }) {
  const sent = new Set(behavior.getFlag(MODULE_ID, "state")?.sent ?? []);
  return region.parent.tokens.filter(t => !refusal(t) && !sent.has(t.id) && !t.getFlag(MODULE_ID, "spawnedBy") && !isDown(t) && driven(t)
    && regionHas(region, centreOf(t), t._source.elevation ?? 0));
}

/** Cacher les créatures des réserves pas encore parties (MJ actif, scène affichée). */
async function hideMembers(scene) {
  const updates = [];
  for ( const r of reservesOf(scene) ) for ( const t of membersOf(r) ) if ( !t.hidden ) updates.push({ _id: t.id, hidden: true });
  if ( updates.length ) await scene.updateEmbeddedDocuments("Token", updates);
}

/** Départs en attente : `behavior.uuid` → `{ at? (ms), round? , cause, point, group }`. */
const pending = new Map();

/** Combat commencé de la scène, ou null. */
const startedCombat = scene => game.combats.find(c => c.started && (c.scene?.id === scene.id)) ?? null;

/**
 * Mettre une réserve en route : après son délai (secondes réelles hors combat, rounds en combat, ±30 %), elle arrive. Rend false si elle
 * ne peut plus rien envoyer ou si elle est déjà en route.
 */
export function schedule(reserve, { cause, point=null, group=null, by=null, now=false }={}) {
  const { region, behavior } = reserve;
  if ( !isActiveGM() || pending.has(behavior.uuid) || !reserveLeft(reserve) ) return false;
  const sys = behavior.system ?? {};
  const combat = startedCombat(region.parent);
  const entry = { cause, point, group, by: by?.id ?? null };
  if ( now || !(sys.delay > 0) ) {
    pending.set(behavior.uuid, entry);
    arrive(reserve).catch(err => log.error("reinforcements failed", err));
    return true;
  }
  if ( combat ) entry.round = combat.round + reserveDelay(sys.delay, Math.random, { rounds: true });
  else entry.at = Date.now() + (reserveDelay(sys.delay) * 1000);
  pending.set(behavior.uuid, entry);
  if ( entry.at ) setTimeout(() => { if ( pending.get(behavior.uuid) === entry ) arrive(reserve).catch(err => log.error("reinforcements failed", err)); },
    entry.at - Date.now());
  log.info(`reserve ${labelOf(reserve)} (${cause}) on its way: ${entry.round ? `round ${entry.round}` : `${Math.round((entry.at - Date.now()) / 1000)} s`}`);
  return true;
}

/** Des cases libres de la région pour y créer des tokens (un token caché qui y attend compte aussi). */
function spawnCells(region, n) {
  const taken = new Set();
  for ( const other of region.parent.tokens ) {
    if ( isDown(other) ) continue;
    const f = footprintOf(other);
    for ( let i = f.i0; i <= f.i1; i++ ) for ( let j = f.j0; j <= f.j1; j++ ) taken.add(`${i}.${j}`);
  }
  return cellsOf(region).filter(c => !taken.has(`${c.i}.${c.j}`)).slice(0, n);
}

/** L'arrivée des renforts (§10.5) : révélés, créés, en alerte vers la dernière position connue, dans le combat s'il y en a un. */
async function arrive(reserve) {
  const { region, behavior } = reserve;
  const entry = pending.get(behavior.uuid) ?? {};
  pending.delete(behavior.uuid);
  const scene = region.parent;
  if ( !reserveLeft(reserve) ) return null;
  const sys = behavior.system ?? {};
  const state = behavior.getFlag(MODULE_ID, "state") ?? {};
  const leaving = pickMembers(membersOf(reserve), sys.count);
  if ( leaving.length ) await scene.updateEmbeddedDocuments("Token", leaving.map(t => ({ _id: t.id, hidden: false })));
  let created = [];
  const spawn = (state.fired && sys.once) ? 0 : Math.max(0, sys.spawn ?? 0);
  if ( spawn && sys.actor ) {
    const actor = await fromUuid(sys.actor).catch(() => null);
    if ( actor?.documentName === "Actor" ) {
      const data = [];
      for ( const cell of spawnCells(region, spawn) ) {
        const size = scene.grid.size;
        const doc = await actor.getTokenDocument({ x: cell.j * size, y: cell.i * size, hidden: false });
        const obj = doc.toObject();
        foundry.utils.setProperty(obj, `flags.${MODULE_ID}.autopilot`, "on");
        foundry.utils.setProperty(obj, `flags.${MODULE_ID}.spawnedBy`, behavior.id);
        data.push(obj);
      }
      if ( data.length ) created = await scene.createEmbeddedDocuments("Token", data);
    } else log.warn(`reserve ${labelOf(reserve)}: actor ${sys.actor} not found`);
  }
  const arrived = [...leaving.map(t => scene.tokens.get(t.id)).filter(Boolean), ...created];
  await behavior.setFlag(MODULE_ID, "state", { fired: true, sent: [...(state.sent ?? []), ...leaving.map(t => t.id), ...created.map(t => t.id)],
    spawned: (state.spawned ?? 0) + created.length });
  if ( !arrived.length ) return null;
  const sample = arrived[0];
  const near = centreOfRegion(region);
  const point = entry.point ?? lastKnown(scene, entry.group ?? groupOf(sample), near, sample);
  for ( const t of arrived ) {
    if ( point ) alarmToken(t, point, 300 + (Math.random() * 900));
    await t.setFlag(MODULE_ID, "alert", { state: "alert", at: Date.now() }).catch(() => {});
  }
  bark(arrived[0], startedCombat(scene) ? "engage" : "alarm", { force: true }).catch(() => null);
  const combat = game.combats.find(c => c.scene?.id === scene.id);
  if ( combat ) await engage(scene, arrived, arrived.map(t => ({ observer: t.name, target: labelOf(reserve) }))).catch(err => log.error("reinforcements: engagement failed", err));
  await gmCard(loc("Renforts.Carte", { count: arrived.length, names: arrived.map(t => t.name).join(", "), label: labelOf(reserve) }),
    loc(`Renforts.Cause.${entry.cause ?? "manual"}`));
  Hooks.callAll(`${MODULE_ID}.reinforcements`, scene, { region: region.id, tokens: arrived.map(t => t.id), cause: entry.cause ?? "manual" });
  log.info(`reinforcements from ${labelOf(reserve)}: ${arrived.map(t => t.name).join(", ")}`);
  return arrived;
}

/** Faire venir une réserve à la main (bouton du comportement, `api.ai.reinforce`) : sans délai si `now`. */
export function callReserve(behavior, { now=false }={}) {
  const region = behavior?.parent;
  if ( !region ) return false;
  return schedule({ region, behavior }, { cause: "manual", now });
}

/** Remettre une réserve à neuf (scénarios, MJ) : ses créatures parties redeviennent membres (et sont recachées). */
export async function resetReserve(behavior) {
  pending.delete(behavior.uuid);
  await behavior.unsetFlag(MODULE_ID, "state");
  if ( isActiveGM() && (behavior.parent?.parent === canvas.scene) ) await hideMembers(canvas.scene);
}

/** L'état d'une réserve (scénarios) : `{ members, state, pending }`. */
export function reserveState(behavior) {
  const region = behavior.parent;
  return { members: membersOf({ region, behavior }).map(t => t.name), state: behavior.getFlag(MODULE_ID, "state") ?? null,
    pending: pending.get(behavior.uuid) ?? null, left: reserveLeft({ region, behavior }) };
}

/** Pertes (§10.5 `losses`) : une réserve dont le groupe a perdu sa part part. */
function checkLosses(scene) {
  if ( !scene || (scene !== canvas.scene) ) return;
  for ( const r of reservesOf(scene) ) {
    const sys = r.behavior.system ?? {};
    if ( (sys.trigger !== "losses") || pending.has(r.behavior.uuid) || !reserveLeft(r) ) continue;
    const members = new Set(membersOf(r).map(t => t.id));
    const groups = groupsOf(sys.groups);
    const group = scene.tokens.filter(t => !refusal(t) && !members.has(t.id) && (!t.hidden || isDown(t)) && covers(groups, groupOf(t))
      && !t.getFlag(MODULE_ID, "spawnedBy"));
    if ( lossesReached(group.map(t => ({ down: isDown(t) })), sys.lossesPercent) ) {
      schedule(r, { cause: "losses", group: groups[0] ?? (group[0] ? groupOf(group[0]) : null) });
    }
  }
}

/** Un round de plus : les réserves attendues en combat. */
function onRound(combat) {
  if ( !isActiveGM() || !combat?.started ) return;
  for ( const [uuid, entry] of pending ) {
    if ( !entry.round || (combat.round < entry.round) ) continue;
    const behavior = fromUuidSync(uuid);
    if ( behavior?.parent && (behavior.parent.parent?.id === combat.scene?.id) ) arrive({ region: behavior.parent, behavior }).catch(err => log.error("reinforcements failed", err));
    else pending.delete(uuid);
  }
}

/* -------------------------------------------- */
/*  Carte au MJ                                  */
/* -------------------------------------------- */

async function gmCard(title, detail=null, extra={}) {
  await ChatMessage.create({
    content: `<div class="dnpc-trace"><h4><i class="fa-solid fa-bell"></i> ${escape(title)}</h4>${detail ? `<p>${escape(detail)}</p>` : ""}</div>`,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: { alias: loc("Pilote.Nom") },
    flags: { [MODULE_ID]: { flagCard: true, ...extra } }
  });
}

/* -------------------------------------------- */
/*  Branchements                                 */
/* -------------------------------------------- */

/**
 * L'horloge, à chaque pas d'une créature en alerte (§10.2) : dans le drapeau Alarme de son groupe, une créature qui y pense (bande
 * `simple` et plus) donne l'alerte.
 */
export function onAlertStep(token, goal) {
  if ( !levelAtLeast("patrols") ) return;
  const scene = token.parent;
  const group = groupOf(token);
  if ( recentlyRung(scene, group) ) return;
  const flag = alarmUnder(token);
  if ( !flag ) return;
  let band = "simple";
  try { band = profileFor(token.actor, token)?.profile?.band ?? band; } catch { /* profil illisible */ }
  if ( !ringsAlarm(band) ) return;
  raiseAlarm(scene, token, goal ?? lastKnown(scene, group, centreOf(token), token), { flag, cause: "flag" }).catch(err => log.error("alarm failed", err));
}

export function registerFlags() {
  Hooks.once("ready", async () => {
    if ( !isActiveGM() ) return;
    for ( const scene of game.scenes ) for ( const region of scene.regions ) await syncForbidden(region).catch(() => {});
  });
  const onBehavior = behavior => {
    if ( !isActiveGM() ) return;
    const region = behavior.parent;
    if ( behavior.type === FLAG_TYPE ) syncForbidden(region).catch(err => log.error("forbidden flag not synced", err));
    if ( (behavior.type === RESERVE_TYPE) && (region?.parent === canvas.scene) ) hideMembers(canvas.scene).catch(() => {});
  };
  Hooks.on("createRegionBehavior", onBehavior);
  Hooks.on("updateRegionBehavior", onBehavior);
  Hooks.on("deleteRegionBehavior", behavior => {
    if ( !isActiveGM() ) return;
    pending.delete(behavior.uuid);
    if ( behavior.type === FLAG_TYPE ) syncForbidden(behavior.parent).catch(() => {});
  });
  Hooks.on("canvasReady", () => { if ( isActiveGM() ) hideMembers(canvas.scene).catch(() => {}); });
  // Une région créée avec ses comportements (ou redessinée) : pas de `createRegionBehavior` pour eux.
  const onRegion = region => {
    if ( !isActiveGM() || !region.behaviors?.some(b => [FLAG_TYPE, RESERVE_TYPE].includes(b.type)) ) return;
    syncForbidden(region).catch(err => log.error("forbidden flag not synced", err));
    if ( region.parent === canvas.scene ) hideMembers(canvas.scene).catch(() => {});
  };
  Hooks.on("createRegion", onRegion);
  Hooks.on("updateRegion", onRegion);
  Hooks.on("updateCombat", (combat, changes) => { if ( "round" in changes ) onRound(combat); });
  // Pertes : un PV qui tombe, un état qui neutralise.
  const later = foundry.utils.debounce(() => checkLosses(canvas.scene), 300);
  Hooks.on("updateActor", (actor, changes) => { if ( isActiveGM() && changes.system?.attributes?.hp ) later(); });
  Hooks.on("createActiveEffect", () => { if ( isActiveGM() ) later(); });
  Hooks.on("canvasInit", () => { pending.clear(); });
}
