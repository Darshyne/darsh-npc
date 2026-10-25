/**
 * Comportements de région (SPEC §10.1–10.2, étape 6a) : « Patrouille (DAS) » et « Poste de garde (DAS) », déclarés dans
 * module.json (`documentTypes.RegionBehavior.patrol`, `.post`). Ils ne réagissent à aucun évènement de région : l'horloge du MJ
 * actif (runtime/clock.mjs) les lit. Gabarit : les comportements de darsh-loot.
 *
 * Patrouille : l'itinéraire est la région elle-même — un polygone seul donne ses sommets dans l'ordre du tracé, sinon le centre de
 * chaque forme dans l'ordre où elles sont posées (core/alert.mjs `routePoints`). Poste de garde : les tokens affectés y restent, y
 * flânent un peu, regardent dans la direction `facing` au repos, et y reviennent après une alerte.
 *
 * L'affectation est un flag de **token** (`route` ou `post` = id de la région), posée depuis le HUD du token (ui/assign.mjs).
 *
 * Étape 7 (§10.2, §10.5) : « Drapeau (DAS) » (`kind` : Interdit, Refuge, Alarme, Poste de tir) et « Réserve (DAS) » (renforts cachés, ou
 * créés depuis un acteur). Ils ne réagissent eux non plus à aucun évènement : l'horloge, le pilote et runtime/flags.mjs les lisent.
 */
import { MODULE_ID } from "../shared.mjs";

export const PATROL_TYPE = `${MODULE_ID}.patrol`;
export const POST_TYPE = `${MODULE_ID}.post`;
export const FLAG_TYPE = `${MODULE_ID}.flag`;
export const RESERVE_TYPE = `${MODULE_ID}.reserve`;

let classes = null;

/** Les classes de données, construites à `init` (les champs de données n'existent que dans Foundry). */
function behaviorClasses() {
  if ( classes ) return classes;
  const fields = foundry.data.fields;
  const Base = foundry.data.regionBehaviors.RegionBehaviorType;

  class PatrolBehaviorType extends Base {
    static LOCALIZATION_PREFIXES = ["DNPC.Patrouille"];
    static defineSchema() {
      return {
        label: new fields.StringField({ required: true, blank: true, initial: "" }),
        mode: new fields.StringField({ required: true, initial: "loop",
          choices: { loop: "DNPC.Patrouille.Mode.loop", pingpong: "DNPC.Patrouille.Mode.pingpong", random: "DNPC.Patrouille.Mode.random" } }),
        pause: new fields.NumberField({ required: true, min: 0, max: 120, step: 1, initial: 3 }),
        // Heures où la patrouille est tenue (§10.6, « 06:00-22:00 ») ; vide = toujours.
        hours: new fields.StringField({ required: true, blank: true, initial: "" })
      };
    }
    static events = {};
  }

  class PostBehaviorType extends Base {
    static LOCALIZATION_PREFIXES = ["DNPC.Poste"];
    static defineSchema() {
      return {
        label: new fields.StringField({ required: true, blank: true, initial: "" }),
        facing: new fields.NumberField({ required: false, nullable: true, min: 0, max: 359, step: 1, initial: null }),
        wander: new fields.BooleanField({ initial: true }),
        scan: new fields.StringField({ required: true, blank: true, initial: "",
          choices: { "": "DNPC.Balayage.default", none: "DNPC.Balayage.none", narrow: "DNPC.Balayage.narrow", wide: "DNPC.Balayage.wide",
            full: "DNPC.Balayage.full" } }),
        hours: new fields.StringField({ required: true, blank: true, initial: "" })
      };
    }
    static events = {};
  }

  class FlagBehaviorType extends Base {
    static LOCALIZATION_PREFIXES = ["DNPC.Drapeau"];
    static defineSchema() {
      return {
        label: new fields.StringField({ required: true, blank: true, initial: "" }),
        kind: new fields.StringField({ required: true, initial: "forbidden",
          choices: { forbidden: "DNPC.Drapeau.Kind.forbidden", refuge: "DNPC.Drapeau.Kind.refuge", alarm: "DNPC.Drapeau.Kind.alarm",
            vantage: "DNPC.Drapeau.Kind.vantage" } }),
        groups: new fields.StringField({ required: true, blank: true, initial: "" }),
        exit: new fields.BooleanField({ initial: false }),
        sound: new fields.FilePathField({ required: false, blank: true, categories: ["AUDIO"], initial: "" })
      };
    }
    static events = {};
  }

  class ReserveBehaviorType extends Base {
    static LOCALIZATION_PREFIXES = ["DNPC.Reserve"];
    static defineSchema() {
      return {
        label: new fields.StringField({ required: true, blank: true, initial: "" }),
        trigger: new fields.StringField({ required: true, initial: "alarm",
          choices: { alarm: "DNPC.Reserve.Trigger.alarm", losses: "DNPC.Reserve.Trigger.losses", call: "DNPC.Reserve.Trigger.call",
            manual: "DNPC.Reserve.Trigger.manual" } }),
        lossesPercent: new fields.NumberField({ required: true, min: 1, max: 100, step: 1, initial: 50 }),
        delay: new fields.NumberField({ required: true, min: 0, max: 600, step: 1, initial: 5 }),
        groups: new fields.StringField({ required: true, blank: true, initial: "" }),
        count: new fields.NumberField({ required: true, min: 0, max: 50, step: 1, initial: 0 }),
        once: new fields.BooleanField({ initial: true }),
        actor: new fields.DocumentUUIDField({ type: "Actor", required: false, nullable: true, initial: null }),
        spawn: new fields.NumberField({ required: true, min: 0, max: 20, step: 1, initial: 0 })
      };
    }
    static events = {};
  }

  classes = { PatrolBehaviorType, PostBehaviorType, FlagBehaviorType, ReserveBehaviorType };
  return classes;
}

export function registerBehaviors() {
  const { PatrolBehaviorType, PostBehaviorType, FlagBehaviorType, ReserveBehaviorType } = behaviorClasses();
  CONFIG.RegionBehavior.dataModels[PATROL_TYPE] = PatrolBehaviorType;
  CONFIG.RegionBehavior.dataModels[POST_TYPE] = PostBehaviorType;
  CONFIG.RegionBehavior.dataModels[FLAG_TYPE] = FlagBehaviorType;
  CONFIG.RegionBehavior.dataModels[RESERVE_TYPE] = ReserveBehaviorType;
  CONFIG.RegionBehavior.typeIcons[PATROL_TYPE] = "fa-solid fa-route";
  CONFIG.RegionBehavior.typeIcons[POST_TYPE] = "fa-solid fa-shield-halved";
  CONFIG.RegionBehavior.typeIcons[FLAG_TYPE] = "fa-solid fa-flag";
  CONFIG.RegionBehavior.typeIcons[RESERVE_TYPE] = "fa-solid fa-people-group";
}

/** Le comportement actif d'un type sur une région, ou null. */
export function behaviorOf(region, type) {
  return region?.behaviors?.find(b => (b.type === type) && !b.disabled) ?? null;
}

/** Les patrouilles et les postes d'une scène : `[{ region, behavior, kind }]`. */
export function assignable(scene) {
  const out = [];
  for ( const region of scene?.regions ?? [] ) {
    const patrol = behaviorOf(region, PATROL_TYPE);
    if ( patrol ) out.push({ region, behavior: patrol, kind: "route" });
    const post = behaviorOf(region, POST_TYPE);
    if ( post ) out.push({ region, behavior: post, kind: "post" });
  }
  return out;
}

/** Le point est-il dans la région (à l'élévation du token si elle compte) ? */
export function regionHas(region, point, elevation=0) {
  try {
    if ( typeof region?.testPoint === "function" ) return region.testPoint({ x: point.x, y: point.y, elevation });
  } catch { /* ancienne signature */ }
  const b = region?.object?.bounds;
  return !!b && b.contains(point.x, point.y);
}

/** Les drapeaux actifs d'une scène, d'une sorte : `[{ region, behavior }]`. */
export function flagsOf(scene, kind) {
  const out = [];
  for ( const region of scene?.regions ?? [] ) {
    for ( const behavior of region.behaviors ?? [] ) {
      if ( (behavior.type === FLAG_TYPE) && !behavior.disabled && (behavior.system?.kind === kind) ) out.push({ region, behavior });
    }
  }
  return out;
}

/** Les réserves actives d'une scène : `[{ region, behavior }]`. */
export function reservesOf(scene) {
  const out = [];
  for ( const region of scene?.regions ?? [] ) {
    for ( const behavior of region.behaviors ?? [] ) if ( (behavior.type === RESERVE_TYPE) && !behavior.disabled ) out.push({ region, behavior });
  }
  return out;
}

/** Les cases de la grille dont le centre est dans la région (au plus `max`, en lignes depuis le haut). */
export function cellsOf(region, { elevation=0, max=400 }={}) {
  const scene = region?.parent;
  const b = region?.object?.bounds ?? boundsOfShapes(region);
  if ( !scene || !b ) return [];
  const grid = scene.grid;
  const size = grid.size;
  const cells = [];
  const top = grid.getOffset({ x: b.x + 1, y: b.y + 1 });
  const bottom = grid.getOffset({ x: b.x + b.width - 1, y: b.y + b.height - 1 });
  for ( let i = top.i; i <= bottom.i; i++ ) {
    for ( let j = top.j; j <= bottom.j; j++ ) {
      const p = { x: (j + 0.5) * size, y: (i + 0.5) * size };
      if ( regionHas(region, p, elevation) ) cells.push({ i, j, x: p.x, y: p.y });
      if ( cells.length >= max ) return cells;
    }
  }
  return cells;
}

/** Les bornes d'une région d'après ses formes (sans canevas : rectangle et polygone). */
function boundsOfShapes(region) {
  const xs = [], ys = [];
  for ( const s of region?.shapes ?? [] ) {
    if ( s.type === "rectangle" ) { xs.push(s.x, s.x + s.width); ys.push(s.y, s.y + s.height); }
    else if ( Array.isArray(s.points) ) s.points.forEach((v, k) => (k % 2 ? ys : xs).push(v));
  }
  if ( !xs.length ) return null;
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Le centre d'une région (ses bornes). */
export function centreOfRegion(region) {
  const b = region?.object?.bounds ?? boundsOfShapes(region);
  return b ? { x: b.x + (b.width / 2), y: b.y + (b.height / 2) } : null;
}
