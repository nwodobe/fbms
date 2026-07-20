/* RCN TRACE - Step 7 field incident log.
   Non destructive helper: stores recette incidents locally in the browser only. */
(function (global) {
  "use strict";

  var KEY = "rcntrace:field_incidents:v1";
  var SEVERITIES = ["Bloquant", "Majeur", "Mineur", "Question métier"];
  var STEPS = [
    "01 Réception camion", "02 Sampling qualité", "03 Décision GM", "04 Déchargement / pesée",
    "05 Analyse finale", "06 Lot officiel RCN", "07 Mise en BIN", "08 Transfert Bouaké -> Yakro",
    "09 Réception Yakro entrepôt", "10 Transfert Yakro -> Calibrage", "11 Réception calibrage",
    "12 Opération CAL", "13 Checklist machine", "14 Sorties / QC", "15 Bilan matière / audit"
  ];
  var SCREENS = ["reception", "qualite", "stock