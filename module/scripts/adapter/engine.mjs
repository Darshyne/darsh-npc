/**
 * Le seul passage vers le moteur (`dnd5e-combat`) : son API publique, rien d'autre (SPEC §2-2, §3.1). Le moteur ne connaît pas
 * ce module. Ce qui n'est pas public chez lui est marqué ici par la demande du SPEC §14.2 qui le concerne, et rend null.
 */
const ENGINE_ID = "dnd5e-combat";

/** L'API du moteur, ou null s'il n'est pas chargé. À lire à `setup` ou `ready` (construite à son `init`). */
export function engine() {
  return game.modules.get(ENGINE_ID)?.api ?? null;
}

/** Le moteur tourne-t-il (pas en veille Midi-QOL / système) ? */
export function active() {
  return engine()?.active === true;
}

/** Le niveau d'automatisation du moteur atteint-il `min` (`essentials` | `assisted` | `full`) ? Sans niveaux : oui. */
export function levelAtLeast(min) {
  const api = engine();
  return typeof api?.levelAtLeast === "function" ? api.levelAtLeast(min) : true;
}

/** L'identifiant dnd5e d'un item tel que le moteur le reconnaît (source premium, nom anglais de Babele compris). */
export function identifierOf(item) {
  const id = engine()?.content?.identifierOf?.(item)?.id;
  return id ?? item?.system?.identifier ?? null;
}

/** Budget du tour d'un combattant (`api.ui.budget`), ou null hors combat commencé. */
export function budget(combatant) {
  return engine()?.ui?.budget?.(combatant) ?? null;
}

/** Déplacement du tour d'un token (`api.ui.movement` : `{ spent, allowance, left, speed, units, dashed }`), ou null. */
export function movement(token) {
  return engine()?.ui?.movement?.(token) ?? null;
}

/** Lumière sur un token (`api.ui.light` : `{ key: bright | dim | dark | magical }`), ou null. */
export function light(token) {
  return engine()?.ui?.light?.(token) ?? null;
}

/**
 * L'observateur voit-il la cible ? **Non public chez le moteur** (SPEC §14.2 R2) : rend null (« inconnu »), et la vue le note
 * (`meta.visionFrom = "gm"`). Quand R2 sera livré, c'est ici que l'appel se fait, nulle part ailleurs.
 */
export function canSee(observer, target) {
  const api = engine();
  return typeof api?.vision?.canSee === "function" ? api.vision.canSee(observer, target) : null;
}

/**
 * Coût d'un chemin sans le jouer. **Non public** (SPEC §14.2 R1) : rend null, et la vue prend la distance (`meta.costIsDistance`).
 */
export function pathCost(token, goal) {
  const api = engine();
  return typeof api?.path === "function" ? (api.path(token, goal)?.cost ?? null) : null;
}

/* -------------------------------------------- */
/*  Agir par le moteur (étape 2, SPEC §9.2)      */
/* -------------------------------------------- */

/** Ce qui reste des Attaques multiples ouvertes ce tour (`api.ui.multiattackLeft` : `{ left: uuids d'items, spent, names }`), ou null. */
export function multiattackLeft(actor) {
  return engine()?.ui?.multiattackLeft?.(actor) ?? null;
}

/** La visée que ce client attend (`api.ui.targeting()`), ou null : le moteur attend un clic du MJ (sort « au début du tour »). */
export function targetingPending() {
  return engine()?.ui?.targeting?.() ?? null;
}

/**
 * Attaquer comme le fait le moteur pour un clic du MJ (SPEC §3.1) : la cible posée sur ce client, l'activité utilisée sans fenêtre
 * (`engaged` saute la visée, `confirmed` la fenêtre de légalité), puis le jet d'attaque **rattaché** à la carte d'utilisation
 * (`system.origin` : sans lui, le jet se porterait lui-même et la résolution attendrait — CLAUDE.md du moteur). Les dégâts sont
 * enchaînés par le moteur ; réactions et animations restent les siennes. `attackMode` : `thrown` pour lancer une arme de jet.
 * Rend `{ messageId }` ou null si l'utilisation n'a pas eu lieu.
 */
export async function attackWith(activity, target, { attackMode=null }={}) {
  const flags = { engaged: true, confirmed: true, ...(attackMode ? { attackMode } : {}) };
  target.object?.setTarget(true, { releaseOthers: true, groupSelection: false });
  // `subsequentActions: false` : dnd5e lancerait sinon lui-même le jet d'attaque après l'utilisation (documents/activity/attack.mjs:68,
  // mixin.mjs:310), sans la confirmation du moteur — un second jet, qui laissait au MJ une fenêtre « Attaquer quand même » (vu en jeu).
  const results = await activity.use({ [ENGINE_ID]: flags, subsequentActions: false }, { configure: false });
  const messageId = results?.message?.id ?? null;
  if ( !messageId ) return null;
  await activity.rollAttack({ [ENGINE_ID]: { confirmed: true }, ...(attackMode ? { attackMode } : {}) }, { configure: false },
    { data: { system: { origin: messageId } } });
  return { messageId };
}

const TERMINAL = new Set(["done", "missed", "undone"]);

/**
 * La résolution d'une activité, quand le moteur l'a tranchée (hook `dnd5e-combat.resolution`, publié sur le MJ actif : touché ou
 * raté, dégâts appliqués, réactions jouées). Rend la résolution, ou null au bout de `timeoutMs` (une fenêtre de réaction peut
 * attendre le MJ 20 s).
 */
export function resolutionOf(activityUuid, { timeoutMs=40000 }={}) {
  return new Promise(resolve => {
    const hook = `${ENGINE_ID}.resolution`;
    const timer = setTimeout(() => { Hooks.off(hook, id); resolve(null); }, timeoutMs);
    const id = Hooks.on(hook, resolution => {
      if ( (resolution?.activity !== activityUuid) || !TERMINAL.has(resolution?.step) ) return;
      clearTimeout(timer);
      Hooks.off(hook, id);
      resolve(resolution);
    });
  });
}

/** Le budget dit-il que le tour est déjà joué par un ordre (Injonction : `stopped`) ? Lu sur le déplacement publié. */
export function turnStopped(token) {
  const m = movement(token);
  return !!m && (m.allowance > 0) && (m.left === 0) && (m.spent === 0);
}

/** S'abonner aux résolutions tranchées du moteur (hook `dnd5e-combat.resolution`, MJ actif) : touché, raté, annulé. */
export function onResolution(fn) {
  return Hooks.on(`${ENGINE_ID}.resolution`, resolution => {
    if ( TERMINAL.has(resolution?.step) ) fn(resolution);
  });
}
