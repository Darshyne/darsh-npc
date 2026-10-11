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
