/**
 * Lecture de la fiche (SPEC §3.3, §6) : ce qu'un acteur dnd5e 6 *est*, mis à plat en faits pour core/profile.mjs. Lecture
 * seule, jamais d'écriture. Chemins vérifiés dans dnd5e 6.0 (`../Foundry dnd5e-automation/references/dnd5e-6/src`) :
 *  - type de créature `system.details.type.value` / `.subtype` (data/actor/npc.mjs:159) ; alignement `system.details.alignment`
 *    (data/actor/templates/details.mjs:33) ;
 *  - attaque : activité `attack`, `attack.type.value` = melee | ranged, `attack.type.classification` = weapon | spell | unarmed
 *    (data/activity/attack-data.mjs:32) ; portée `range.value / long / reach / units` (data/shared/range-field.mjs:18) ;
 *  - dégâts : parties `number` / `denomination` / `bonus`, ou `custom.formula` (data/shared/damage-field.mjs:33, 59) ;
 *  - armure portée `actor.armor` → `system.attributes.ac.equippedArmor` (documents/actor/actor.mjs:228) ;
 *  - légendaire `system.resources.legact.max` / `legres.max` (data/actor/npc.mjs:109) ;
 *  - concentration : effet actif portant le statut `CONFIG.specialStatusEffects.CONCENTRATING` (documents/actor/actor.mjs:247).
 */
import { averageOf } from "../core/dice.mjs";
import { roleOf } from "../core/profile.mjs";

export { roleOf };
import { identifierOf } from "./engine.mjs";

/** @returns {import("../core/profile.mjs").Facts} */
export function factsOf(actor) {
  const sys = actor?.system ?? {};
  const details = sys.details ?? {};
  const abilities = sys.abilities ?? {};
  const movement = sys.attributes?.movement ?? {};
  const senses = sys.attributes?.senses ?? {};
  const skills = sys.skills ?? {};
  const traits = [];
  const attacks = [];
  for ( const item of actor?.items ?? [] ) {
    if ( item.type === "feat" ) { const id = identifierOf(item); if ( id ) traits.push(id); }
    for ( const activity of item.system?.activities ?? [] ) {
      if ( activity.type !== "attack" ) continue;
      const range = {
        value: activity.range?.value ?? null,
        long: activity.range?.long ?? null,
        reach: activity.range?.reach ?? null,
        units: activity.range?.units ?? null
      };
      const typed = activity.attack?.type?.value === "ranged";
      // « Attaque au corps à corps ou à distance » (Jaillissement arcanique du Mage) : dnd5e la type `melee`, mais sa portée dépasse
      // l'allonge sans être celle d'une arme de jet. Elle compte pour les deux.
      const thrown = !!item.system?.properties?.has?.("thr");
      const both = !typed && !thrown && (Number(range.value) > Math.max(Number(range.reach) || 5, 5));
      attacks.push({
        id: activity.uuid,
        item: item.id,
        name: item.name,
        ranged: typed || both,
        melee: !typed,
        spell: activity.attack?.type?.classification === "spell",
        unarmed: activity.attack?.type?.classification === "unarmed",
        thrown,
        equipped: (item.type !== "weapon") || (item.system?.equipped !== false),
        weaponType: (item.type === "weapon") ? (item.system?.type?.value ?? null) : null,
        range,
        damage: averageDamage(activity)
      });
    }
  }
  return {
    identifier: actor?.flags?.core?.sourceId?.split(".").pop() ?? null,
    type: details.type?.value || (actor?.type === "character" ? "humanoid" : null),
    subtype: String(details.type?.subtype ?? "").toLowerCase(),
    alignment: details.alignment ?? "",
    cr: actor?.type === "character" ? (details.level ?? null) : (details.cr ?? null),
    abilities: { int: abilities.int?.value ?? 10, wis: abilities.wis?.value ?? 10, cha: abilities.cha?.value ?? 10 },
    skills: {
      prcPassive: skills.prc?.passive ?? null, ste: skills.ste?.total ?? null, itm: skills.itm?.total ?? null, sur: skills.sur?.total ?? null
    },
    hp: { value: sys.attributes?.hp?.value ?? 0, max: sys.attributes?.hp?.max ?? 0, temp: sys.attributes?.hp?.temp ?? 0 },
    speed: {
      walk: movement.walk ?? 0, fly: movement.fly ?? 0, swim: movement.swim ?? 0, climb: movement.climb ?? 0, burrow: movement.burrow ?? 0,
      units: movement.units ?? null
    },
    senses: { darkvision: senses.darkvision ?? 0, blindsight: senses.blindsight ?? 0, tremorsense: senses.tremorsense ?? 0, truesight: senses.truesight ?? 0 },
    size: sys.traits?.size ?? "med",
    legendary: ((sys.resources?.legact?.max ?? 0) > 0) || ((sys.resources?.legres?.max ?? 0) > 0),
    speaks: (sys.traits?.languages?.value?.size ?? 0) > 0,
    // `attributes.spellcasting` ne dit rien : dnd5e y met une caractéristique par défaut sur toute fiche (« str » sur le Zombi).
    // Un PJ n'est lanceur qu'avec des emplacements (un tour de magie de don d'origine ne fait pas d'un Moine un mage) ; un PNJ du
    // MM 2024 lance sans emplacements, ses sorts suffisent.
    spellcaster: Object.values(sys.spells ?? {}).some(s => (s?.max ?? 0) > 0)
      || ((actor?.type !== "character") && ((actor?.itemTypes?.spell?.length ?? 0) > 0)),
    armor: armorWeightOf(actor),
    concentrating: !!actor?.concentration?.effects?.size,
    traits,
    attacks,
    species: actor?.type === "character" ? (details.race?.system?.identifier ?? details.race?.identifier ?? null) : null
  };
}

/** Poids de l'armure portée : `heavy` | `medium` | `light` | `none` | `unknown` (ce que l'IA a le droit de voir, SPEC §7.3). */
export function armorWeightOf(actor) {
  if ( !actor ) return "unknown";
  const armor = actor.armor ?? actor.system?.attributes?.ac?.equippedArmor ?? null;
  const type = armor?.system?.type?.value;
  if ( ["heavy", "medium", "light"].includes(type) ) return type;
  return "none";
}

/** Dégâts moyens d'une activité d'attaque : somme des parties, formules résolues avec les données de jet de l'activité. */
function averageDamage(activity) {
  let total = 0;
  const rollData = safeRollData(activity);
  for ( const part of activity.damage?.parts ?? [] ) {
    let formula;
    try { formula = part.formula ?? ""; } catch { formula = ""; }
    if ( !formula && Number.isFinite(part.number) && Number.isFinite(part.denomination) ) formula = `${part.number}d${part.denomination}${part.bonus ? `+${part.bonus}` : ""}`;
    const resolved = resolveFormula(formula, rollData);
    total += averageOf(resolved).average;
  }
  return Math.max(0, Math.round(total * 10) / 10);
}

function safeRollData(activity) {
  try { return activity.getRollData?.() ?? activity.item?.getRollData?.() ?? {}; } catch { return {}; }
}

/** `@mod`, `@prof`… remplacés par leurs valeurs (cœur : `Roll.replaceFormulaData`) ; ce qui reste inconnu devient 0. */
function resolveFormula(formula, rollData) {
  if ( !formula ) return "";
  try { return Roll.replaceFormulaData(String(formula), rollData, { missing: "0" }); } catch { return String(formula); }
}
