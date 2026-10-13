/**
 * Les répliques en jeu (SPEC §11, étape 5 du §16) : une créature du MJ parle aux moments clés du combat — repérée, au début du combat,
 * en attaquant, touchée, ensanglantée, quand elle abat un ennemi, quand un allié ou son chef tombe, en fuyant, en se rendant, à la
 * victoire. Le choix et l'anti-répétition sont dans `core/barks.mjs` ; les lignes viennent, dans l'ordre, du token (flag `barks`), de
 * la surcouche du monde (éditeur, réglage `barks`), des tables d'autres modules (`api.ai.register`), puis des génériques du module
 * (`content/barks.mjs`). Une créature qui ne parle pas fait un **geste** (emote).
 *
 * Rendu (réglage `barkMode`) : `chat` — message en personnage, dont le cœur fait une bulle chez chacun si les bulles sont allumées ;
 * `bubble` — bulle seule (`canvas.hud.bubbles.broadcast`, montrée à qui voit le token) ; `off`. Hook annulable
 * `darsh-npc.bark(token, moment, text)` avant de parler. Le MJ actif seul fait parler. Jamais un PJ, un token caché ou à terre.
 */
import { MODULE_ID, log, setting } from "../shared.mjs";
import { levelAtLeast } from "../adapter/settings.mjs";
import * as engine from "../adapter/engine.mjs";
import { allied, hostile } from "../adapter/view.mjs";
import { factsOf } from "../adapter/sheet.mjs";
import { profileFor } from "./profile.mjs";
import { registeredBarks } from "./registry.mjs";
import { BARKS, EMOTE_FAMILIES } from "../content/barks.mjs";
import { familyOf, barkKeys, linesFor, chooseLine, mayBark, MOMENTS } from "../core/barks.mjs";

const isActiveGM = () => game.users.activeGM?.isSelf === true;
const OUT = ["dead", "unconscious", "incapacitated", "paralyzed", "petrified", "stunned"];
const isDown = actor => (actor?.system?.attributes?.hp?.value ?? 0) <= 0;
/** Au plus tant de créatures parlent pour un même évènement (un début de combat à dix gobelins). */
const PER_EVENT = 2;

/** Mémoire du MJ actif : token → `{ at, line }` ; et les moments déjà dits ce combat (`bloodied`, `victory`). */
const memory = new Map();
const said = new Set();

/** Pourquoi cette créature ne peut pas parler maintenant (null : elle peut). */
function silenced(token) {
  const actor = token?.actor;
  if ( !actor ) return "noActor";
  if ( token.hidden ) return "hidden";
  if ( (actor.type === "character") || actor.hasPlayerOwner ) return "playerCharacter";
  if ( token.getFlag?.(MODULE_ID, "barks") === false ) return "muted";
  if ( isDown(actor) ) return "down";
  const out = OUT.find(s => actor.statuses?.has(s));
  return out ? `status:${out}` : null;
}

/** Une créature du MJ qui peut parler maintenant ? */
const canSpeak = token => !silenced(token);

/** Le monde fait-il parler ses créatures ? */
function worldSpeaks() {
  return (setting("barkMode") !== "off") && setting("aiEnabled") && levelAtLeast("patrols");
}

/** La langue des répliques : le réglage, sinon celle du client du MJ actif (Q8). */
function langOf() {
  const choice = setting("barkLanguage");
  return (choice && (choice !== "auto")) ? choice : (game.i18n.lang || "en");
}

/** Ce que dirait cette créature pour ce moment (sans parler) : `{ text, emote, family, source, lang }`, ou null. */
export function lineFor(token, moment) {
  const facts = factsOf(token.actor);
  const { profile } = profileFor(token.actor, token);
  const family = familyOf(facts, profile);
  const own = token.getFlag?.(MODULE_ID, "barks");
  const lang = langOf();
  const { lines, source } = linesFor({
    token: (own && (typeof own === "object")) ? own : null,
    layers: [setting("barks") ?? {}, ...registeredBarks(), BARKS],
    keys: barkKeys(facts, family), moment, lang, speaks: !!facts.speaks
  });
  const text = chooseLine(lines, memory.get(token.id)?.line ?? null);
  if ( !text ) return null;
  return { text, emote: !facts.speaks && EMOTE_FAMILIES.includes(family), family, source, lang };
}

/**
 * Faire parler une créature. `force` : sans délai ni tirage (fuite, reddition, demande du MJ). Rend ce qui a été dit
 * `{ text, moment, emote, … }`, ou `{ refused }`.
 */
export async function bark(token, moment, { force=false }={}) {
  if ( !MOMENTS.includes(moment) ) return { refused: "unknownMoment" };
  if ( !worldSpeaks() && !force ) return { refused: "off" };
  if ( setting("barkMode") === "off" ) return { refused: "off" };
  const why = silenced(token);
  if ( why ) return { refused: "cannotSpeak", why };
  const last = memory.get(token.id);
  if ( !mayBark({ moment, frequency: setting("barkFrequency"), lastAt: last?.at ?? 0, cooldownMs: setting("barkCooldown") * 1000, force }) ) {
    return { refused: "quiet" };
  }
  const line = lineFor(token, moment);
  if ( !line ) return { refused: "noLine" };
  if ( Hooks.call(`${MODULE_ID}.bark`, token, moment, line.text) === false ) return { refused: "cancelled" };
  memory.set(token.id, { at: Date.now(), line: line.text });
  if ( setting("barkMode") === "bubble" ) {
    const text = line.emote ? `${token.name} ${line.text}` : line.text;
    await canvas.hud?.bubbles?.broadcast(token, text, { requireVisible: true, pan: false, cssClasses: line.emote ? ["emote"] : [] });
  } else {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token }), content: line.text,
      style: line.emote ? CONST.CHAT_MESSAGE_STYLES.EMOTE : CONST.CHAT_MESSAGE_STYLES.IC,
      flags: { [MODULE_ID]: { bark: { token: token.uuid, moment, family: line.family, lang: line.lang } } }
    });
  }
  return { ...line, moment };
}

/** Quelques-unes de ces créatures parlent (au plus `PER_EVENT`), dans un ordre tiré au sort. */
async function some(tokens, moment) {
  const pool = tokens.filter(canSpeak).sort(() => Math.random() - 0.5);
  let spoken = 0;
  for ( const token of pool ) {
    if ( spoken >= PER_EVENT ) break;
    const r = await bark(token, moment);
    if ( !r.refused ) spoken += 1;
  }
  return spoken;
}

/** Repérée (engagement, §10.3) : les observateurs parlent. */
export function barkSpotted(observers) {
  if ( !isActiveGM() || !worldSpeaks() ) return;
  some(observers, "spotted").catch(err => log.error("bark failed", err));
}

/** Le token d'un acteur (uuid d'acteur, de token synthétique compris) sur la scène affichée. */
function tokenOfActor(uuid) {
  const doc = fromUuidSync(uuid ?? "", { strict: false });
  const actor = doc?.documentName === "Actor" ? doc : doc?.actor;
  if ( !actor ) return null;
  if ( actor.isToken ) return actor.token;
  return actor.getActiveTokens?.(false, true)?.find(t => t.parent === canvas.scene) ?? null;
}

/** Ceux qui sont en combat avec ce token : `{ allies, enemies }` (tokens du combat de la scène). */
function sidesOf(token, combat) {
  const others = (combat?.combatants ?? []).map(c => c.token).filter(t => t && (t.id !== token.id));
  return { allies: others.filter(t => allied(token, t)), enemies: others.filter(t => hostile(token, t)) };
}

/** Une résolution tranchée : touché, ensanglanté, abattu, allié ou chef tombé, victoire. */
async function onResolution(resolution) {
  if ( !isActiveGM() || !worldSpeaks() ) return;
  const combat = game.combat;
  const attacker = tokenOfActor(resolution.source);
  for ( const t of resolution.targets ?? [] ) {
    if ( !((t.damage?.applied ?? 0) > 0) ) continue;
    const target = fromUuidSync(t.token ?? "", { strict: false });
    if ( !target?.actor || (target.parent !== canvas.scene) ) continue;
    const key = `${combat?.id ?? "-"}.${target.id}`;
    if ( isDown(target.actor) ) {
      // L'attaquant abat un ennemi ; les alliés de la victime la voient tomber.
      if ( attacker && hostile(attacker, target) ) await bark(attacker, "kill");
      const { allies } = sidesOf(target, combat);
      if ( !allies.length ) continue;
      // Le chef : marqué comme tel, ou de FP plus haut que tous ses alliés du combat (comme la cause de moral `leaderDown`).
      const cr = factsOf(target.actor).cr ?? 0;
      const leader = !!profileFor(target.actor, target).profile.leader || ((cr > 0) && allies.every(a => (factsOf(a.actor).cr ?? 0) < cr));
      await some(allies, leader ? "leaderDown" : "allyDown");
      continue;
    }
    const hp = target.actor.system?.attributes?.hp ?? {};
    if ( (hp.max > 0) && (hp.value <= hp.max / 2) && !said.has(`${key}.bloodied`) ) {
      said.add(`${key}.bloodied`);
      await bark(target, "bloodied");
    } else await bark(target, "hit");
  }
  // Victoire : l'attaquant ne voit plus d'ennemi debout dans le combat.
  if ( attacker && combat?.started && !said.has(`${combat.id}.${attacker.id}.victory`) ) {
    const { enemies } = sidesOf(attacker, combat);
    if ( enemies.length && enemies.every(e => isDown(e.actor)) ) {
      said.add(`${combat.id}.${attacker.id}.victory`);
      await bark(attacker, "victory");
    }
  }
}

export function registerBarks() {
  game.settings.register(MODULE_ID, "barkMode", {
    name: "DNPC.Reglage.Repliques.Nom", hint: "DNPC.Reglage.Repliques.Indic", scope: "world", config: true, type: String,
    choices: { chat: "DNPC.Reglage.Repliques.chat", bubble: "DNPC.Reglage.Repliques.bubble", off: "DNPC.Reglage.Repliques.off" }, default: "chat"
  });
  game.settings.register(MODULE_ID, "barkFrequency", {
    name: "DNPC.Reglage.Frequence.Nom", hint: "DNPC.Reglage.Frequence.Indic", scope: "world", config: true, type: String,
    choices: { rare: "DNPC.Reglage.Frequence.rare", normal: "DNPC.Reglage.Frequence.normal", chatty: "DNPC.Reglage.Frequence.chatty",
      always: "DNPC.Reglage.Frequence.always" }, default: "normal"
  });
  game.settings.register(MODULE_ID, "barkCooldown", {
    name: "DNPC.Reglage.Silence.Nom", hint: "DNPC.Reglage.Silence.Indic", scope: "world", config: true, type: Number,
    range: { min: 0, max: 60, step: 1 }, default: 10
  });
  game.settings.register(MODULE_ID, "barkLanguage", {
    name: "DNPC.Reglage.Langue.Nom", hint: "DNPC.Reglage.Langue.Indic", scope: "world", config: true, type: String,
    choices: { auto: "DNPC.Reglage.Langue.auto", fr: "Français", en: "English" }, default: "auto"
  });
  // Surcouche du monde (§12.4), écrite par l'éditeur : `{ clé: { moment: { langue: [lignes] } } }`.
  game.settings.register(MODULE_ID, "barks", { scope: "world", config: false, type: Object, default: {} });

  Hooks.on("combatStart", combat => {
    if ( !isActiveGM() || !worldSpeaks() ) return;
    const npcs = combat.combatants.map(c => c.token).filter(Boolean);
    some(npcs, "engage").catch(err => log.error("bark failed", err));
  });
  Hooks.on("createCombatant", combatant => {
    if ( !isActiveGM() || !worldSpeaks() || !combatant.combat?.started || !combatant.token ) return;
    bark(combatant.token, "engage").catch(err => log.error("bark failed", err));
  });
  Hooks.on("deleteCombat", combat => {
    for ( const key of [...said] ) if ( key.startsWith(`${combat.id}.`) ) said.delete(key);
  });
  engine.onResolution(resolution => { onResolution(resolution).catch(err => log.error("bark failed", err)); });
}
