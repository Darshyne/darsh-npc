/**
 * L'éditeur des répliques (SPEC §12.4) : la surcouche du monde (réglage `barks`), par clé — une famille (`brute`, `beast`…), un type
 * de créature (`type:humanoid`), un sous-type (`subtype:goblinoid`), l'identifiant d'une fiche — et par langue ; ou les répliques du
 * **token sélectionné** (flag de token `barks`, toutes langues). Une ligne par réplique ; une case vide garde les répliques de la couche
 * suivante (modules, puis génériques, montrées en exemple). Export et import en JSON, au format de `api.ai.register` (`barks`).
 */
import { MODULE_ID, loc, escape, setting } from "../shared.mjs";
import { BARKS } from "../content/barks.mjs";
import { MOMENTS, FAMILIES, validateBarks, validateTokenBarks } from "../core/barks.mjs";

const TOKEN_KEY = "@token";

/** La classe de la fenêtre, construite au premier appel (ApplicationV2 n'existe que dans Foundry). */
let EditorClass = null;

export function barksEditorClass() {
  if ( EditorClass ) return EditorClass;
  const { ApplicationV2 } = foundry.applications.api;

  EditorClass = class BarksEditor extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "dnpc-barks-editor",
      tag: "form",
      classes: ["dnpc-barks-editor"],
      window: { title: "DNPC.Editeur.Titre", icon: "fa-solid fa-comment-dots", resizable: true },
      position: { width: 640, height: 720 },
      form: { handler: BarksEditor.#save, closeOnSubmit: false, submitOnChange: false },
      actions: { export: BarksEditor.#export, import: BarksEditor.#import, clear: BarksEditor.#clear }
    };

    key = "brute";
    lang = (game.i18n.lang === "fr") ? "fr" : "en";

    /** Le token sélectionné sur le canevas, s'il peut avoir des répliques. */
    get token() {
      const t = canvas.tokens?.controlled?.[0]?.document ?? null;
      return (t?.actor && (t.actor.type !== "character")) ? t : null;
    }

    /** Les lignes de la clé et de la langue choisies, par moment. */
    current() {
      if ( this.key === TOKEN_KEY ) return this.token?.getFlag(MODULE_ID, "barks") || {};
      const entry = (setting("barks") ?? {})[this.key] ?? {};
      return Object.fromEntries(MOMENTS.map(m => [m, entry[m]?.[this.lang] ?? []]));
    }

    async _renderHTML() {
      const token = this.token;
      if ( (this.key === TOKEN_KEY) && !token ) this.key = "brute";
      const types = Object.keys(CONFIG.DND5E?.creatureTypes ?? {});
      const overlay = setting("barks") ?? {};
      const known = new Set([...FAMILIES, ...types.map(t => `type:${t}`)]);
      const custom = Object.keys(overlay).filter(k => !known.has(k));
      const option = (value, label) => `<option value="${escape(value)}" ${value === this.key ? "selected" : ""}>${escape(label)}</option>`;
      const keys = [
        token ? option(TOKEN_KEY, loc("Editeur.Token", { name: token.name })) : "",
        `<optgroup label="${escape(loc("Editeur.Familles"))}">${FAMILIES.map(f => option(f, loc(`Famille.${f}`))).join("")}</optgroup>`,
        `<optgroup label="${escape(loc("Editeur.Types"))}">${types.map(t => option(`type:${t}`, game.i18n.localize(CONFIG.DND5E.creatureTypes[t]?.label ?? t))).join("")}</optgroup>`,
        custom.length ? `<optgroup label="${escape(loc("Editeur.Autres"))}">${custom.map(k => option(k, k)).join("")}</optgroup>` : ""
      ].join("");
      const lines = this.current();
      const example = BARKS[FAMILIES.includes(this.key) ? this.key : "brute"] ?? {};
      const rows = MOMENTS.map(m => {
        const hint = (example[m]?.[this.lang] ?? example[m]?.en ?? []).join("\n");
        return `<div class="form-group stacked"><label>${escape(loc(`Moment.${m}`))}</label>`
          + `<textarea name="moment.${m}" rows="2" placeholder="${escape(hint)}">${escape((lines[m] ?? []).join("\n"))}</textarea></div>`;
      }).join("");
      const div = document.createElement("div");
      div.className = "dnpc-barks-body";
      div.innerHTML = `<p class="hint">${escape(loc("Editeur.Aide"))}</p>`
        + `<div class="dnpc-barks-head"><div class="form-group"><label>${escape(loc("Editeur.Cle"))}</label><select name="key">${keys}</select></div>`
        + `<div class="form-group"><label>${escape(loc("Editeur.AutreCle"))}</label><input type="text" name="customKey" placeholder="subtype:goblinoid"></div>`
        + (this.key === TOKEN_KEY ? "" : `<div class="form-group"><label>${escape(loc("Editeur.Langue"))}</label><select name="lang">`
          + ["fr", "en"].map(l => `<option value="${l}" ${l === this.lang ? "selected" : ""}>${l}</option>`).join("") + `</select></div>`)
        + `</div><div class="dnpc-barks-moments">${rows}</div>`
        + `<footer class="form-footer">`
        + `<button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${escape(loc("Editeur.Enregistrer"))}</button>`
        + `<button type="button" data-action="clear"><i class="fa-solid fa-eraser"></i> ${escape(loc("Editeur.Vider"))}</button>`
        + `<button type="button" data-action="export"><i class="fa-solid fa-file-export"></i> ${escape(loc("Editeur.Exporter"))}</button>`
        + `<button type="button" data-action="import"><i class="fa-solid fa-file-import"></i> ${escape(loc("Editeur.Importer"))}</button>`
        + `</footer>`;
      return div;
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      this.element.querySelector('[name="key"]')?.addEventListener("change", ev => { this.key = ev.target.value; this.render(); });
      this.element.querySelector('[name="lang"]')?.addEventListener("change", ev => { this.lang = ev.target.value; this.render(); });
      this.element.querySelector('[name="customKey"]')?.addEventListener("change", ev => {
        const key = ev.target.value.trim();
        if ( key ) { this.key = key; this.render(); }
      });
    }

    /** Enregistrer les lignes de la clé et de la langue choisies. */
    static async #save(event, form, formData) {
      const data = foundry.utils.expandObject(formData.object);
      const byMoment = Object.fromEntries(MOMENTS.map(m => [m, String(data.moment?.[m] ?? "").split("\n").map(l => l.trim()).filter(Boolean)]));
      if ( this.key === TOKEN_KEY ) {
        const token = this.token;
        if ( !token ) return;
        const kept = Object.fromEntries(Object.entries(byMoment).filter(([, l]) => l.length));
        const errors = validateTokenBarks(kept);
        if ( errors.length ) return ui.notifications.error(errors[0]);
        if ( Object.keys(kept).length ) await token.setFlag(MODULE_ID, "barks", kept);
        else await token.unsetFlag(MODULE_ID, "barks");
      } else {
        const overlay = foundry.utils.deepClone(setting("barks") ?? {});
        const entry = overlay[this.key] ?? {};
        for ( const [m, l] of Object.entries(byMoment) ) {
          entry[m] = { ...(entry[m] ?? {}) };
          if ( l.length ) entry[m][this.lang] = l; else delete entry[m][this.lang];
          if ( !Object.keys(entry[m]).length ) delete entry[m];
        }
        if ( Object.keys(entry).length ) overlay[this.key] = entry; else delete overlay[this.key];
        const errors = validateBarks(overlay);
        if ( errors.length ) return ui.notifications.error(errors[0]);
        await game.settings.set(MODULE_ID, "barks", overlay);
      }
      ui.notifications.info(loc("Editeur.Enregistre"));
      this.render();
    }

    /** Vider la clé choisie (toutes langues), ou les répliques du token. */
    static async #clear() {
      if ( this.key === TOKEN_KEY ) await this.token?.unsetFlag(MODULE_ID, "barks");
      else {
        const overlay = foundry.utils.deepClone(setting("barks") ?? {});
        delete overlay[this.key];
        await game.settings.set(MODULE_ID, "barks", overlay);
      }
      this.render();
    }

    /** La surcouche entière, en JSON (`{ barks: … }`, le format de `api.ai.register`). */
    static #export() {
      const data = JSON.stringify({ barks: setting("barks") ?? {} }, null, 2);
      foundry.utils.saveDataToFile(data, "application/json", "darsh-npc-barks.json");
    }

    /** Remplacer la surcouche par un fichier JSON validé. */
    static #import() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if ( !file ) return;
        let table;
        try { const parsed = JSON.parse(await file.text()); table = parsed.barks ?? parsed; }
        catch(err) { return ui.notifications.error(loc("Editeur.JsonFaux")); }
        const errors = validateBarks(table);
        if ( errors.length ) return ui.notifications.error(`${loc("Editeur.JsonFaux")} ${errors[0]}`);
        await game.settings.set(MODULE_ID, "barks", table);
        ui.notifications.info(loc("Editeur.Importe", { count: Object.keys(table).length }));
        this.render();
      });
      input.click();
    }
  };
  return EditorClass;
}

/** Le menu des réglages. À appeler à `init`. */
export function registerBarksEditor() {
  game.settings.registerMenu(MODULE_ID, "barksEditor", {
    name: "DNPC.Editeur.Menu.Nom", label: "DNPC.Editeur.Menu.Bouton", hint: "DNPC.Editeur.Menu.Indic",
    icon: "fa-solid fa-comment-dots", type: barksEditorClass(), restricted: true
  });
}
