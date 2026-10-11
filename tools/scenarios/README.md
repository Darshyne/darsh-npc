# Scénarios en jeu

Joués par le lanceur du moteur `dnd5e-combat`, depuis son dépôt :

    node tools/scenario.mjs "../Foundry dnd5e PNJ automatisés/tools/scenarios"

Chaque fichier `*.mjs` exporte `{ name, run(ctx) }` ; `ctx.call("call-module-api", { moduleId: "darsh-npc", fn, args })` atteint
les fonctions de test du module (`api.mcp`). Premiers scénarios prévus : `pnj-attaque` (étape 2), `pnj-approche`, `pnj-tireur`
(étape 3), `pnj-moral` (étape 4).
