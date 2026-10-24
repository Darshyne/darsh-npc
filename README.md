# DAS · Automated NPC (`darsh-npc`)

[![Tests](https://github.com/Darshyne/darsh-npc/actions/workflows/tests.yml/badge.svg)](https://github.com/Darshyne/darsh-npc/actions/workflows/tests.yml)

**[Website](https://darshyne.github.io)** · **[Discord](https://discord.gg/PDSq8dYdTP)** (questions, bugs, ideas)

Part of **Darshyne's Automation Suite (DAS)**. An **AI for the monsters and NPCs the GM plays**, for **Foundry VTT V14** and
**dnd5e 6.x**: it decides, the [`dnd5e-combat`](https://github.com/Darshyne/dnd5e-combat) engine executes.

Planned scope (see the roadmap below):

- **Out of combat, in real time**: patrols along routes drawn as Regions, guard posts, movement flags (forbidden, refuge,
  alarm, vantage point, reserve), NPC schedules on the world clock (day watch, night sleep, relief), perception through the
  engine's sight and hearing rules, alerts spreading through a group, reinforcements, and **automatic engagement**: the combat
  is created, NPC initiative rolled, players roll theirs as usual.
- **In combat, turn by turn**: target priority by **Intelligence** (bestial, simple, average, cunning, tactical), **Wisdom**,
  skills and **hatreds** (creature type, species, faction), movement by the engine's pathfinder, attacks and the **basic
  actions** (Attack, Multiattack, Dash, Disengage, Dodge, Hide), morale: **flight and surrender**.
- **Catch phrases** as in-character chat bubbles at key moments (spotted, hit, bloodied, ally down, flee, surrender).
- **The GM keeps control**: autopilot per token (on / confirm each plan / off), a scene switch, five automation levels, the
  GM takes over with any gesture on the token, pause freezes everything, a scene snapshot to reset every creature.
- **Nothing is ever written on actors or items.** State lives in token and combatant flags, Regions and world settings.
  Never a player character.

## State

**0.1.0 — step 1 of the roadmap, read-only.** The module reads a creature's **profile** from its sheet (Intelligence band,
Wisdom, courage, preferred range, mobility, senses, traits, hatreds) and builds its **view** (perceived enemies with distance,
appearance, armour, role) and the **ranked targets** it would pick, without acting. API:
`game.modules.get("darsh-npc").api.ai.profile(actor, token)`, `.view(token)`, `.targets(token)`,
`.register(source, { profiles, enmities })`. Two world settings: the NPC automation level (default **Off**) and omniscient NPCs.

**0.2.0 — step 2, the minimal turn (alpha).** With the NPC automation level set to **Combat** and a token's **autopilot** on
(brain button of the token HUD, or the world default "on for Hostile tokens"), on that token's turn the GM's client attacks the
best target **already in reach** — melee, ranged or thrown, picking the attack by expected damage, chaining Multiattack and Extra
Attack as long as the engine grants attacks — then ends the turn. A private **trace card** tells the GM what was played and why
(or why the turn is handed back: no enemy in reach, incapacitated, an order such as Command, paused, time limit). Never a player character, a player-owned or a Secret token. API: `.plan(token)` (the intent, without playing it),
`.play(token)`, `.autopilot(token, "on" | "off")`.

**Automatic combat**, also in 0.2.0: when a GM creature **sees** a creature hostile to it (the engine's vision rules: light,
walls, darkvision, Invisible — so a successful Hide —, Blinded), or when a creature **is attacked**, the combat starts on its own —
**even with the AI off**. Only the creatures concerned join: a player character no hostile creature sees stays out of the combat, and
joins as soon as one sees it, so some characters can be in the combat and others not. NPC initiative is rolled; players roll theirs;
the combat begins once everyone has one. Two toggles in the **token tool bar** (GM): **NPC AI** (brain) and **Automatic combat**
(crossed swords), both off by default.

**0.3.0 — step 3, movement (alpha).** When no enemy is in reach, the piloted creature walks toward its best target along the
engine's path (doors, opportunity attacks and the turn's movement included): to **melee reach**, or — for a **ranged** creature —
only to its **normal range, where it sees the target**, keeping its distance. A melee creature whose movement falls short **Dashes**
(its Action is spent, no attack that turn); a shot that would be at long range first closes to normal range when the movement allows.
Then it attacks as above. Needs the engine's `approach` toward a target, `path` and `basics.take` (engine ≥ 0.238.0); with an older
engine the turn is handed back to the GM.

**0.4.0 — step 4, morale and GM control (alpha).** A piloted creature checks its **morale** at the start of its turn when it drops
to half its HP, when half its group or its leader goes down, or when it has been unable to harm anyone for two turns: a DC 10 Wisdom
saving throw rolled by the engine (mindless and fanatic creatures never check; brave ones have Advantage, cowardly ones
Disadvantage). On a failure it **flees** — Disengaging first if it is clever enough and an enemy is adjacent, otherwise Dashing — and
when cornered it **surrenders** if it can (Intelligence 6 or more, not brave): it drops what it holds, turns Neutral, stops playing
its turns, and shows a white flag. Attacked after surrendering, it turns hostile again and flees if it can. Each token's autopilot
now has three modes (token HUD): off, on, and **confirm** — a private card shows the GM the intent and its reasons, with Play, Skip
turn, I'll play, and a button per perceived enemy to pick another target. Moving the token or using one of its activities during its
turn **takes over** that turn, and **Ctrl+Alt+N** (or the brain toggle) turns the AI off at once. Needs the engine's `save`, `flee`
and `drop` (engine ≥ 0.238.0).

**0.5.0 — step 5, catch phrases (alpha).** GM creatures speak at key moments of a fight — when they spot someone, when the
fight starts, when they attack, get hit, are bloodied, down an enemy, see an ally or their leader fall, flee, surrender, or win — in
character in the chat (with a bubble if chat bubbles are on), or as a bubble only. Lines are written for the module, in English and
French, by family (brute, cunning, fiend, undead, dragon); creatures that don't speak make gestures instead (beasts growl, zombies
moan). Never the same line twice in a row, a silence between two lines, and a frequency setting. Write your own lines per family,
creature type or token in the **Catch phrases** editor (module settings), and share them as JSON; other modules can register theirs
with `api.ai.register(source, { barks })`.

**0.6.0 — step 6a, NPCs out of combat (alpha).** Two new region behaviors: **Patrol (DAS)** — the region is the route (a single
polygon's vertices in drawing order, or the centre of each shape), looped, back and forth or random, with a pause at each point — and
**Guard post (DAS)** — assigned creatures stay there, wander a little and face a set direction. Assign a creature from its token HUD.
In real time (one step per second on the GM's client, frozen while the game is paused), a creature that sees an enemy becomes
**alert** (a red « ! » above it) and warns nearby allies; when it loses sight of the enemy it goes **searching** to the last known
position (an eye), stands there **confused** if it finds nothing (a grey « ? »), then goes back to its patrol or post. A doubt — a
noise, an ally's shout — makes it **suspicious** (a yellow « ? »): it turns, then goes to look. With Automatic combat on, being seen
still starts the fight. Note: after installing or updating to this version, relaunch the world so Foundry knows the new region
behaviors.

**0.8.0 — step 7, flags and reinforcements (alpha).** Two more region behaviors. **Flag (DAS)**, of four kinds: **Forbidden** (the
engine's paths avoid the area — for everyone, players included), **Refuge** (where fleeing creatures run to; marked as an exit, a
creature that reaches it leaves the scene — its token is hidden, never deleted), **Alarm** (an alert creature standing in it, or
reaching it, alerts its whole group on the scene, which converges on the enemy's last known position; optional bell sound) and
**Vantage point** (AI shooters take position there when they can see their target from it). **Reserve (DAS)**: the AI-driven
creatures inside are hidden and wait until the alarm, the group's losses, a fleeing creature that fetches them or the GM (« Bring them
in » button) calls them; after a delay (seconds out of combat, rounds in combat) they appear, alert, and join the combat with their
initiative — or the reserve creates its tokens from an actor. A token's **group** (who shares alarms) is set in its AI assignment
window; by default, its faction. A fleeing creature that thinks ahead fetches the reinforcements or rings the alarm, and the morale
test is made with Advantage while reinforcements are available. API: `api.ai.alert(token, { group, position })`,
`api.ai.reinforce(region)`, hooks `darsh-npc.alert` and `darsh-npc.reinforcements`. Relaunch the world after updating (new region
behaviors).

Roadmap:
6 Regions and real time · 7 engagement and reinforcements (done) · 7 bis scene snapshot · 8 abilities declared by the engine's content ·
9 hatreds and registered tables · 9 bis schedules.

It **requires the [`dnd5e-combat`](https://github.com/Darshyne/dnd5e-combat) engine** (≥ 0.228.0). The engine does not
depend on this module and runs without it.

## Installation

In Foundry (or on The Forge), *Install Module* → paste the manifest URL:

```
https://github.com/Darshyne/darsh-npc/releases/latest/download/module.json
```

From source: the Foundry module is the `module/` subfolder, to copy or link into `Data/modules/darsh-npc`. Tests: `npm install`
then `npm test`. In-game scenarios: `tools/scenarios/`, played with the engine's scenario runner.

## For other modules

Profiles and hatreds for your own creatures (a campaign module, a bestiary) are registered by identifier, never by copying
content: `Hooks.on("darsh-npc.register", register => register("my-module", { profiles: [...], enmities: [...] }))` at `setup`, or
`api.ai.register(...)` later. Invalid entries are reported and skipped, the rest is taken.

## Translations

The module ships English, French and Brazilian Portuguese (pt-BR translation by Henrique, [@henriquebot](https://github.com/henriquebot)). To add a language, copy `module/lang/en.json` to `module/lang/<code>.json`, translate the
values, and add an entry to `languages` in `module/module.json`; missing keys fall back to English.

## License

MIT. No book text or premium content is shipped; generic profiles and hatreds only. Dungeons & Dragons SRD 5.2 content is used
under the Creative Commons Attribution 4.0 International License.
