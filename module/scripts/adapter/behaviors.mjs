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
 */
import { MODULE_ID } from "../shared.mjs";

export const PATROL_TYPE = `${MODULE_ID}.patrol`;
export const POST_TYPE = `${MODULE_ID}.post`;

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
        pause: new fields.NumberField({ required: true, min: 0, max: 120, step: 1, initial: 3 })
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
        wander: new fields.BooleanField({ initial: true })
      };
    }
    static events = {};
  }

  classes = { PatrolBehaviorType, PostBehaviorType };
  return classes;
}

export function registerBehaviors() {
  const { PatrolBehaviorType, PostBehaviorType } = behaviorClasses();
  CONFIG.RegionBehavior.dataModels[PATROL_TYPE] = PatrolBehaviorType;
  CONFIG.RegionBehavior.dataModels[POST_TYPE] = PostBehaviorType;
  CONFIG.RegionBehavior.typeIcons[PATROL_TYPE] = "fa-solid fa-route";
  CONFIG.RegionBehavior.typeIcons[POST_TYPE] = "fa-solid fa-shield-halved";
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
