/* ============================================================================
   ANAGROCI FBMS — Adaptateur Niveau 1 « Règles et intégrité »
   ----------------------------------------------------------------------------
   Fait le pont entre les écrans existants et les règles serveur des migrations
   docs/migrations/niveau1/. Chargé par terrain/achats.html et terrain/cash.html.

   PROPRIÉTÉ ESSENTIELLE — À NE PAS CASSER
   ---------------------------------------
   Ce fichier est INERTE tant que les migrations ne sont pas appliquées. Il
   sonde le serveur une fois, et s'il ne trouve pas les fonctions du Niveau 1 il
   laisse le comportement actuel strictement inchangé.

   C'est ce qui permet de livrer le frontend AVANT la base, sans livraison
   coordonnée et sans fenêtre de rupture : le jour où les migrations sont
   appliquées, l'adaptateur prend le relais tout seul, au prochain chargement.

   CE QU'IL APPORTE
   ----------------
   1. Une clé d'idempotence et un identifiant de terminal sur chaque écriture.
   2. Le routage des écritures vers n1_sync_pousser, qui renvoie un ACCUSÉ
      serveur : la file locale n'est purgée que sur cet accusé.
   3. Le refus assumé des avances hors ligne — une exposition financière ne
      naît jamais d'un cache local.
   4. La traduction des erreurs PostgreSQL en français compréhensible au champ.
   5. La journalisation durable des refus, que le ROLLBACK efface côté serveur.

   Aucune règle métier n'est décidée ici : le serveur reste seul juge. Ce
   fichier ne fait que parler sa langue.
   ========================================================================== */
(function (global) {
  "use strict";

  var CLE_TERMINAL = "anagroci_terminal_id";
  var CLE_SONDE = "anagroci_n1_disponible";
  var _disponible = null;      // null = pas encore sondé
  var _sondeEnCours = null;

  /* -- 1. Identité du terminal ---------------------------------------------
     Stable, propre à l'appareil, produite une seule fois. Elle sert à
     distinguer deux téléphones qui poussent la même opération. */
  function terminalId() {
    var id = null;
    try { id = localStorage.getItem(CLE_TERMINAL); } catch (e) { /* stockage indisponible */ }
    if (id) return id;
    try {
      id = "TEL-" + (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.round(Math.random() * 1e9)));
    } catch (e) {
      id = "TEL-" + Date.now() + "-" + Math.round(Math.random() * 1e9);
    }
    try { localStorage.setItem(CLE_TERMINAL, id); } catch (e) { /* session seulement */ }
    return id;
  }

  /* -- 2. Sonde de capacité -------------------------------------------------
     Un seul appel par session. n1_sync_etat est choisie parce qu'elle est en
     lecture seule et sans paramètre obligatoire : la sonder n'écrit rien. */
  function disponible(sb) {
    if (_disponible !== null) return Promise.resolve(_disponible);
    if (_sondeEnCours) return _sondeEnCours;

    try {
      var cache = sessionStorage.getItem(CLE_SONDE);
      if (cache === "1" || cache === "0") {
        _disponible = cache === "1";
        return Promise.resolve(_disponible);
      }
    } catch (e) { /* sessionStorage indisponible : on sonde */ }

    _sondeEnCours = sb.rpc("n1_sync_etat", { p_terminal_id: terminalId() })
      .then(function (r) {
        // Une fonction absente remonte PGRST202 ; toute autre erreur (droits,
        // réseau) ne prouve pas l'absence, donc on ne conclut pas à l'absence.
        var absente = !!(r.error && /PGRST202|does not exist|schema cache/i.test(
          String(r.error.code || "") + " " + String(r.error.message || "")));
        _disponible = !absente;
        try { sessionStorage.setItem(CLE_SONDE, _disponible ? "1" : "0"); } catch (e) {}
        return _disponible;
      })
      .catch(function () { _disponible = false; return false; });

    return _sondeEnCours;
  }

  /* -- 3. Traduction des refus serveur -------------------------------------
     Un agent qui ne comprend pas pourquoi son achat est refusé finira par
     contourner le contrôle. Le message compte autant que le refus. */
  var TRADUCTIONS = [
    [/campagne active non définie/i,
     "La campagne n'est pas encore ouverte. Le Branch Manager doit l'activer avant toute saisie."],
    [/aucun cycle de financement ouvert/i,
     "Ce RT n'a pas de cycle de financement ouvert. Une avance doit être mise en place avant d'acheter."],
    [/refinancement refusé|non réconcilié/i,
     "Le cycle précédent de ce RT n'est pas réconcilié. Aucune nouvelle avance n'est possible avant la réconciliation."],
    [/cycle .* bloqué|achats suspendus/i,
     "Le cycle de ce RT est bloqué à la suite d'un écart. Un Branch Manager doit le débloquer."],
    [/financement insuffisant/i,
     "Le financement disponible du cycle ne couvre pas cet achat. Réconciliez ou faites approuver une exception."],
    [/achats_recu|numero_recu|reçu.*doublon/i,
     "Ce numéro de reçu a déjà été enregistré. Vérifiez le carnet : un reçu ne sert qu'une fois."],
    [/montant .* incohérent/i,
     "Le montant ne correspond pas à poids net × prix au kilo. Vérifiez la pesée et le prix."],
    [/incohérence de pesée|poids net supérieur/i,
     "La pesée est incohérente : poids brut moins tare doit égaler le poids net."],
    [/producteur .* absent du référentiel/i,
     "Ce producteur n'est pas au référentiel. S'il n'est pas recensé, cochez « non référencé » et justifiez."],
    [/rt .* absent du référentiel/i,
     "Ce RT n'est pas au référentiel. Régularisez la fiche avant d'enregistrer."],
    [/non_negatif|solde de sacs insuffisant/i,
     "Le solde de sacs ne permet pas cette sortie. Comptez les sacs avant de recommencer."],
    [/stock rcn insuffisant/i,
     "Le stock RCN disponible ne permet pas cette sortie."],
    [/plafond|supérieur au plafond/i,
     "Le montant dépasse le plafond autorisé pour ce périmètre."],
    [/paramètre .* non défini/i,
     "Un plafond obligatoire n'est pas encore paramétré. Le Branch Manager doit le saisir."],
    [/séparation des tâches|auto-approbation|auteur d/i,
     "Vous ne pouvez pas valider votre propre saisie. Un contrôleur doit le faire."],
    [/modification directe interdite|suppression interdite/i,
     "Cette opération est clôturée. Une correction passe par un ajustement motivé et approuvé."],
    [/réconciliée : seul le passage/i,
     "Cette opération est réconciliée : seule sa clôture est encore possible."],
    [/exposition financière/i,
     "Cette opération engage de l'argent : elle exige une connexion. Elle ne peut pas être créée hors ligne."],
    [/date .* futur|datée dans le futur/i, "La date ne peut pas être dans le futur."],
    [/duplicate key|23505|unique/i, "Cette opération a déjà été enregistrée."],
    [/rls|permission denied|policy|jwt|42501/i,
     "Votre compte n'a pas le droit d'effectuer cette opération."],
    [/network|fetch|timeout|failed to fetch/i,
     "Réseau indisponible. L'opération reste en attente et repartira automatiquement."]
  ];

  function message(err) {
    var brut = String((err && (err.message || err.msg)) || err || "");
    for (var i = 0; i < TRADUCTIONS.length; i++) {
      if (TRADUCTIONS[i][0].test(brut)) return TRADUCTIONS[i][1];
    }
    return "Opération refusée par le serveur. Signalez ce message : " + brut.slice(0, 180);
  }

  /* Catégorie courte, pour les pastilles du journal local. */
  function categorie(err) {
    var b = String((err && (err.message || err.msg)) || err || "").toLowerCase();
    if (/réconcilié|refinancement|cycle/.test(b)) return "Cycle non réconcilié";
    if (/recu|reçu|duplicate|unique|23505/.test(b)) return "Reçu déjà utilisé";
    if (/financement insuffisant|plafond/.test(b)) return "Dépassement";
    if (/non_negatif|sacs|stock/.test(b)) return "Solde insuffisant";
    if (/montant|pesée/.test(b)) return "Saisie incohérente";
    if (/rls|permission|jwt|policy/.test(b)) return "Accès refusé";
    if (/network|fetch|timeout/.test(b)) return "Réseau";
    if (/campagne|paramètre/.test(b)) return "Paramétrage manquant";
    return "Refus serveur";
  }

  /* -- 4. Estampille d'identité sur une écriture ---------------------------- */
  function preparer(rec, source) {
    if (!rec) return rec;
    if (!rec.cle_idempotence) rec.cle_idempotence = rec.local_id || null;
    if (!rec.terminal_id) rec.terminal_id = terminalId();
    if (source && !rec.source_saisie) rec.source_saisie = source;
    return rec;
  }

  /* -- 5. Journalisation durable d'un refus ---------------------------------
     Un refus annule sa transaction : la ligne d'audit posée par le trigger
     disparaît avec elle. Ce rappel, dans une NOUVELLE transaction, la rétablit.
     Best-effort : il ne doit jamais faire échouer l'écran. */
  function journaliserRefus(sb, ressource, motif, enregistrement, rt, cluster) {
    if (_disponible !== true) return Promise.resolve(false);
    return sb.rpc("n1_journaliser_refus", {
      p_ressource: ressource,
      p_motif: String(motif || "").slice(0, 1900),
      p_enregistrement: enregistrement || null,
      p_charge: null,
      p_correlation: null,
      p_terminal: terminalId(),
      p_rt: rt || null,
      p_cluster: cluster || null
    }).then(function () { return true; }).catch(function () { return false; });
  }

  /* -- 6. Cycle de financement ---------------------------------------------
     Une avance ne peut pas naître sans cycle ouvert, et l'ouverture d'un cycle
     est une décision serveur : elle vérifie que le cycle précédent est bien
     réconcilié. Rien de tout cela ne peut être décidé depuis le cache. */
  function assurerCycle(sb, opts) {
    opts = opts || {};
    return disponible(sb).then(function (actif) {
      if (!actif) return { ok: true, passif: true };
      if (!opts.rt_id) {
        return { ok: false, message: "Ce RT n'a pas d'identifiant au référentiel : le financement ne peut pas être rattaché." };
      }
      return sb.rpc("n1_rt_refinancable", { p_rt_id: opts.rt_id, p_campagne: null })
        .then(function (r) {
          if (r.error) return { ok: false, message: message(r.error) };
          if (r.data === false) return { ok: true, cycleExistant: true };   // cycle déjà ouvert : on y ajoute
          // Aucun cycle actif : il faut en ouvrir un, ce qui est une décision.
          return sb.rpc("n1_ouvrir_cycle", {
            p_rt_id: opts.rt_id,
            p_montant_autorise: opts.montant,
            p_volume_finance_kg: opts.volume_kg || null,
            p_prix_reference_kg: opts.prix_kg || null,
            p_echeance: null,
            p_motif: opts.motif || null,
            p_exception_id: null
          }).then(function (o) {
            if (o.error) return { ok: false, message: message(o.error), brut: o.error.message };
            return { ok: true, cycle: o.data };
          });
        })
        .catch(function (e) { return { ok: false, message: message(e) }; });
    });
  }

  /* -- 7. Poussée d'une écriture, avec accusé de réception ------------------
     Retourne toujours la même forme, que le Niveau 1 soit actif ou non :
       { ok, purgeable, id, message, brut }
     `purgeable` dit à l'écran s'il peut retirer la ligne de sa file locale.
     Un refus métier est purgeable (inutile de le rejouer indéfiniment) ; une
     panne réseau ne l'est pas. */
  var TABLES_HORS_LIGNE = { achats: 1, sacs_mouvements: 1, reconciliations: 1, n1_stock_mouvements: 1 };

  function pousser(sb, table, payload) {
    return disponible(sb).then(function (actif) {
      // Mode passif : comportement historique, strictement inchangé.
      // On n'estampille SURTOUT PAS : tant que la migration 02 n'est pas
      // appliquée, cle_idempotence et terminal_id ne sont pas des colonnes, et
      // les envoyer ferait échouer l'insertion avec « column does not exist ».
      if (!actif) {
        var p = Object.assign({}, payload);
        delete p.cle_idempotence; delete p.terminal_id; delete p.source_saisie;
        return sb.from(table).upsert(p, { onConflict: "local_id", ignoreDuplicates: true })
          .then(function (r) {
            if (r.error) return { ok: false, purgeable: false, message: message(r.error), brut: r.error.message };
            return { ok: true, purgeable: true, id: null, message: "Enregistré." };
          });
      }

      preparer(payload);

      // Les écritures à exposition financière ne passent pas par la file.
      if (!TABLES_HORS_LIGNE[table]) {
        return sb.from(table).insert(payload).select("id").single()
          .then(function (r) {
            if (r.error) {
              return journaliserRefus(sb, table, r.error.message, payload.local_id,
                                      payload.rt_id, payload.cluster)
                .then(function () {
                  return { ok: false, purgeable: true, message: message(r.error), brut: r.error.message };
                });
            }
            return { ok: true, purgeable: true, id: r.data && r.data.id, message: "Enregistré et confirmé par le serveur." };
          });
      }

      // File hors ligne : le serveur répond par un accusé explicite.
      return sb.rpc("n1_sync_pousser", {
        p_cle_idempotence: payload.cle_idempotence || payload.local_id,
        p_terminal_id: terminalId(),
        p_ressource: table,
        p_charge: payload,
        p_cree_le: payload.created_at || null
      }).then(function (r) {
        if (r.error) {
          // Refus métier : on le conserve côté serveur pour que l'agent le voie.
          return sb.rpc("n1_sync_enregistrer_rejet", {
            p_cle_idempotence: payload.cle_idempotence || payload.local_id,
            p_terminal_id: terminalId(),
            p_ressource: table,
            p_charge: payload,
            p_motif: String(r.error.message || "").slice(0, 1900)
          }).catch(function () { /* best-effort */ })
            .then(function () {
              return { ok: false, purgeable: true, message: message(r.error), brut: r.error.message };
            });
        }
        var a = r.data || {};
        return {
          ok: a.resultat === "ACCEPTE" || a.resultat === "DOUBLON",
          purgeable: a.purge_locale_autorisee === true,
          id: a.enregistrement || null,
          doublon: a.resultat === "DOUBLON",
          message: a.resultat === "DOUBLON"
            ? "Déjà enregistré sur le serveur — aucun doublon créé."
            : (a.message || "Confirmé par le serveur."),
          brut: a.message || null
        };
      }).catch(function (e) {
        // Réseau : surtout ne pas purger, l'opération n'a pas atteint le serveur.
        return { ok: false, purgeable: false, message: message(e), brut: String(e && e.message || e) };
      });
    });
  }

  /* -- 8. État de synchronisation vu du serveur -----------------------------
     Après une perte d'appareil, c'est le serveur qui dit ce qui est passé. */
  function etatServeur(sb, tousTerminaux) {
    return disponible(sb).then(function (actif) {
      if (!actif) return null;
      return sb.rpc("n1_sync_etat", { p_terminal_id: tousTerminaux ? null : terminalId() })
        .then(function (r) { return r.error ? null : r.data; })
        .catch(function () { return null; });
    });
  }

  global.N1 = {
    terminalId: terminalId,
    disponible: disponible,
    preparer: preparer,
    pousser: pousser,
    assurerCycle: assurerCycle,
    journaliserRefus: journaliserRefus,
    etatServeur: etatServeur,
    message: message,
    categorie: categorie
  };
})(window);
