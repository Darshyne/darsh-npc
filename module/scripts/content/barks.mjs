/**
 * Répliques génériques livrées par le module (SPEC §11) : `BARKS[famille][moment][langue] = [lignes]`. Écrites pour le module,
 * aucune phrase tirée d'un livre ou d'un jeu. Les familles qui ne parlent pas (`EMOTE_FAMILIES`) ont des **gestes** : la ligne
 * suit le nom de la créature dans une emote (« Loup grogne en montrant les crocs. »).
 *
 * Familles (core/barks.mjs `familyOf`) :
 *   brute     humanoïde ou créature qui parle, sans finesse
 *   cunning   qui parle et calcule (bande `cunning` et plus, ou lanceur de sorts)
 *   fiend     fiélon qui parle
 *   undead    mort-vivant qui pense et parle
 *   dragon    dragon qui parle
 *   beast     bête (ne parle pas)
 *   mindless  mort-vivant, créature artificielle, vase ou plante sans esprit (ne parle pas)
 *   monster   tout autre monstre qui ne parle pas
 * Un moment absent d'une famille qui parle se replie sur `brute`.
 */

export const EMOTE_FAMILIES = Object.freeze(["beast", "mindless", "monster"]);

export const BARKS = Object.freeze({
  brute: {
    alarm: {
      fr: ["Alerte ! Tout le monde debout !", "On est attaqués ! À moi !", "Debout là-dedans, on a de la visite !"],
      en: ["Alarm! Everyone up!", "We're under attack! To me!", "Up, you lot, we've got company!"]
    },
    spotted: {
      fr: ["Hé ! Là-bas !", "Des intrus !", "Je vous vois !"],
      en: ["Hey! Over there!", "Intruders!", "I see you!"]
    },
    engage: {
      fr: ["Aux armes !", "Vous n'auriez pas dû venir ici.", "Allez, approchez !"],
      en: ["To arms!", "You shouldn't have come here.", "Come on, then!"]
    },
    attack: {
      fr: ["Prends ça !", "Tiens !", "Crève !"],
      en: ["Take that!", "Have some!", "Die!"]
    },
    hit: {
      fr: ["Aïe !", "C'est tout ce que t'as ?", "Tu vas me le payer !"],
      en: ["Ow!", "Is that all you've got?", "You'll pay for that!"]
    },
    bloodied: {
      fr: ["Je saigne…", "Ça commence à faire mal.", "Pas si vite…"],
      en: ["I'm bleeding…", "That's starting to hurt.", "Not so fast…"]
    },
    kill: {
      fr: ["Un de moins !", "Reste à terre.", "Au suivant !"],
      en: ["One down!", "Stay down.", "Who's next?"]
    },
    allyDown: {
      fr: ["Un des nôtres est tombé !", "Non !", "Vengeance !"],
      en: ["They got him!", "No!", "Avenge them!"]
    },
    leaderDown: {
      fr: ["Le chef est tombé !", "Qui commande, maintenant ?"],
      en: ["The boss is down!", "Who's in charge now?"]
    },
    flee: {
      fr: ["Repli ! Repli !", "Je ne meurs pas ici !", "Chacun pour soi !"],
      en: ["Fall back! Fall back!", "I'm not dying here!", "Every one for themselves!"]
    },
    surrender: {
      fr: ["Pitié ! Je me rends !", "Arrêtez ! Je pose les armes !", "Assez… assez. Vous avez gagné."],
      en: ["Mercy! I yield!", "Stop! I'm putting my weapons down!", "Enough… enough. You win."]
    },
    victory: {
      fr: ["Et c'est réglé.", "Trop facile.", "Qui d'autre ?"],
      en: ["And that's that.", "Too easy.", "Anyone else?"]
    }
  },
  cunning: {
    alarm: {
      fr: ["Donnez l'alerte, et vite !", "Qu'on prévienne les autres !", "Tout le monde à son poste !"],
      en: ["Sound the alarm, now!", "Warn the others!", "Everyone to your posts!"]
    },
    spotted: {
      fr: ["Tiens, tiens… de la visite.", "Je savais que vous viendriez.", "Encerclez-les !"],
      en: ["Well, well… visitors.", "I knew you would come.", "Surround them!"]
    },
    engage: {
      fr: ["Prenez-les de flanc !", "Visez le plus faible.", "Vous êtes tombés dans le piège."],
      en: ["Flank them!", "Go for the weakest.", "You walked right into it."]
    },
    attack: {
      fr: ["Une ouverture.", "Trop lent.", "Là."],
      en: ["An opening.", "Too slow.", "There."]
    },
    hit: {
      fr: ["Bien joué… pour cette fois.", "Une égratignure.", "Vous allez le regretter."],
      en: ["Well struck… this once.", "A scratch.", "You will regret that."]
    },
    bloodied: {
      fr: ["Il est temps de changer de plan.", "Je vous ai sous-estimés.", "Couvrez-moi !"],
      en: ["Time to change plans.", "I underestimated you.", "Cover me!"]
    },
    kill: {
      fr: ["Prévisible.", "Un problème de moins.", "Qui veut le suivre ?"],
      en: ["Predictable.", "One less problem.", "Who wants to follow?"]
    },
    allyDown: {
      fr: ["Resserrez les rangs !", "Ne restez pas groupés !", "Imbécile…"],
      en: ["Close ranks!", "Don't bunch up!", "Fool…"]
    },
    leaderDown: {
      fr: ["Le plan tombe à l'eau…", "Sans ordres, on se replie !"],
      en: ["So much for the plan…", "No orders: fall back!"]
    },
    flee: {
      fr: ["Ce n'est pas fini !", "Une autre fois, peut-être.", "Je me souviendrai de vos visages."],
      en: ["This isn't over!", "Another time, perhaps.", "I'll remember your faces."]
    },
    surrender: {
      fr: ["Discutons, voulez-vous ?", "Je peux vous être utile vivant.", "Très bien. Je me rends."],
      en: ["Let's talk, shall we?", "I'm worth more to you alive.", "Very well. I surrender."]
    },
    victory: {
      fr: ["Comme prévu.", "Fouillez les corps.", "Ils n'avaient aucune chance."],
      en: ["As planned.", "Search the bodies.", "They never stood a chance."]
    }
  },
  fiend: {
    alarm: {
      fr: ["Venez, mes frères : de la chair fraîche !", "À moi, légions !"],
      en: ["Come, my kin: fresh meat!", "To me, legions!"]
    },
    spotted: {
      fr: ["Des mortels… quelle aubaine.", "Je sens votre peur."],
      en: ["Mortals… how convenient.", "I can smell your fear."]
    },
    engage: {
      fr: ["Vos âmes m'appartiennent.", "Venez, que je vous dévore.", "Brûlez !"],
      en: ["Your souls are mine.", "Come, let me feast.", "Burn!"]
    },
    attack: {
      fr: ["Souffrez !", "Hurlez pour moi.", "À genoux !"],
      en: ["Suffer!", "Scream for me.", "Kneel!"]
    },
    hit: {
      fr: ["Insolent !", "Vous paierez cette audace.", "Ha ! Encore !"],
      en: ["Insolent!", "You will pay for that.", "Ha! Again!"]
    },
    bloodied: {
      fr: ["Cette chair n'est qu'une enveloppe !", "Vous m'avez mis en colère."],
      en: ["This flesh is but a shell!", "Now you've made me angry."]
    },
    kill: {
      fr: ["Une âme de plus.", "Délicieux."],
      en: ["Another soul.", "Delicious."]
    },
    allyDown: {
      fr: ["Faible. Il méritait de tomber.", "Peu importe."],
      en: ["Weak. It deserved to fall.", "No matter."]
    },
    victory: {
      fr: ["Ainsi finit votre histoire.", "Que l'on emporte les âmes."],
      en: ["And so your story ends.", "Gather the souls."]
    },
    flee: {
      fr: ["Ce n'est qu'un répit, mortels !", "Nous nous reverrons dans les flammes."],
      en: ["This is only a reprieve, mortals!", "We'll meet again in the flames."]
    }
  },
  undead: {
    alarm: {
      fr: ["Levez-vous… les vivants sont là.", "Éveillez-vous, serviteurs !"],
      en: ["Rise… the living are here.", "Awaken, servants!"]
    },
    spotted: {
      fr: ["Des vivants… si chauds…", "Qui trouble mon repos ?"],
      en: ["The living… so warm…", "Who disturbs my rest?"]
    },
    engage: {
      fr: ["Rejoignez-nous.", "Votre souffle sera le dernier.", "La tombe vous attend."],
      en: ["Join us.", "Your breath will be your last.", "The grave awaits you."]
    },
    attack: {
      fr: ["Froid comme la mort…", "Votre vie m'appartient."],
      en: ["Cold as death…", "Your life is mine."]
    },
    hit: {
      fr: ["Je ne sens rien.", "La douleur… est un souvenir."],
      en: ["I feel nothing.", "Pain… is a memory."]
    },
    bloodied: {
      fr: ["Ce corps se défait…", "Je reviendrai."],
      en: ["This body unravels…", "I will return."]
    },
    kill: {
      fr: ["Bienvenue parmi nous.", "Repose… pour l'instant."],
      en: ["Welcome among us.", "Rest… for now."]
    },
    victory: {
      fr: ["Le silence revient.", "Encore des corps pour la crypte."],
      en: ["Silence returns.", "More bodies for the crypt."]
    },
    flee: {
      fr: ["L'ombre me reprend…", "Ce n'est pas la fin."],
      en: ["The shadows take me back…", "This is not the end."]
    }
  },
  dragon: {
    alarm: {
      fr: ["Serviteurs ! Des voleurs dans mon antre !", "À moi ! Qu'on les chasse !"],
      en: ["Servants! Thieves in my lair!", "To me! Hunt them down!"]
    },
    spotted: {
      fr: ["Des voleurs dans mon antre ?", "Vous osez ?"],
      en: ["Thieves in my lair?", "You dare?"]
    },
    engage: {
      fr: ["Vous serez mon repas.", "Mon trésor ne sera jamais à vous.", "Agenouillez-vous devant moi !"],
      en: ["You'll make a fine meal.", "My hoard will never be yours.", "Kneel before me!"]
    },
    attack: {
      fr: ["Insectes !", "Disparaissez !"],
      en: ["Insects!", "Begone!"]
    },
    hit: {
      fr: ["Une piqûre, rien de plus.", "Vous m'agacez."],
      en: ["A mere sting.", "You annoy me."]
    },
    bloodied: {
      fr: ["Assez joué !", "Vous allez connaître ma colère !"],
      en: ["Enough games!", "Now feel my wrath!"]
    },
    kill: {
      fr: ["Pathétique.", "À qui le tour ?"],
      en: ["Pathetic.", "Who's next?"]
    },
    victory: {
      fr: ["Que cela serve de leçon.", "Mon trésor est en sécurité."],
      en: ["Let this be a lesson.", "My hoard is safe."]
    },
    flee: {
      fr: ["Ce n'est pas terminé !", "Je reviendrai plus fort."],
      en: ["This isn't finished!", "I'll return stronger."]
    }
  },
  beast: {
    alarm: { fr: ["pousse un long hurlement d'appel.", "aboie à pleine gorge."], en: ["lets out a long, calling howl.", "barks at the top of its lungs."] },
    spotted: { fr: ["dresse les oreilles et gronde."], en: ["pricks up its ears and growls."] },
    engage: { fr: ["gronde en montrant les crocs.", "pousse un rugissement."], en: ["bares its teeth with a growl.", "lets out a roar."] },
    attack: { fr: ["bondit.", "se jette en avant."], en: ["pounces.", "lunges forward."] },
    hit: { fr: ["glapit de douleur.", "recule en grognant."], en: ["yelps in pain.", "backs off, snarling."] },
    bloodied: { fr: ["gémit et baisse la tête.", "halète, la gueule ouverte."], en: ["whimpers and lowers its head.", "pants, jaws open."] },
    kill: { fr: ["hurle sa victoire."], en: ["howls in triumph."] },
    allyDown: { fr: ["pousse un long hurlement."], en: ["lets out a long howl."] },
    flee: { fr: ["détale, la queue basse.", "s'enfuit en glapissant."], en: ["bolts, tail low.", "flees, yelping."] },
    victory: { fr: ["renifle les corps."], en: ["sniffs at the bodies."] }
  },
  mindless: {
    alarm: { fr: ["pousse un râle qui porte loin."], en: ["lets out a moan that carries far."] },
    spotted: { fr: ["tourne lentement la tête.", "se fige, puis avance."], en: ["slowly turns its head.", "freezes, then lurches forward."] },
    engage: { fr: ["pousse un râle.", "avance en traînant les pieds."], en: ["lets out a rattling moan.", "shambles forward."] },
    attack: { fr: ["frappe sans un bruit.", "gémit en frappant."], en: ["strikes without a sound.", "moans as it strikes."] },
    hit: { fr: ["vacille à peine.", "continue d'avancer."], en: ["barely staggers.", "keeps coming."] },
    bloodied: { fr: ["perd des morceaux mais avance encore."], en: ["sheds pieces but keeps coming."] },
    kill: { fr: ["se penche sur sa victime."], en: ["leans over its victim."] },
    victory: { fr: ["reste immobile, à attendre."], en: ["stands still, waiting."] }
  },
  monster: {
    alarm: { fr: ["pousse un cri perçant qui résonne au loin."], en: ["lets out a piercing cry that echoes far away."] },
    spotted: { fr: ["émet un sifflement menaçant."], en: ["lets out a threatening hiss."] },
    engage: { fr: ["pousse un cri strident.", "se dresse, menaçant."], en: ["shrieks.", "rears up, menacing."] },
    attack: { fr: ["frappe avec fureur."], en: ["strikes furiously."] },
    hit: { fr: ["hurle de rage.", "se tord de douleur."], en: ["howls in rage.", "writhes in pain."] },
    bloodied: { fr: ["recule en sifflant."], en: ["recoils, hissing."] },
    kill: { fr: ["pousse un cri de triomphe."], en: ["lets out a triumphant cry."] },
    allyDown: { fr: ["pousse un cri de détresse."], en: ["lets out a cry of distress."] },
    flee: { fr: ["s'enfuit en sifflant."], en: ["flees, hissing."] },
    victory: { fr: ["se repaît de sa victoire."], en: ["gloats over its kill."] }
  }
});
