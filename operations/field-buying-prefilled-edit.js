/* FIELD BUYING — édition préremplie.
   Réconciliation : l'édition RT / Village / Producteur vit dans
   operations/field-buying.js, le moteur unique : mêmes formulaires
   préremplis (openRtForm / openVillageForm / openFarmerForm avec editId),
   update() ciblé sur l'id existant, anti-doublon avec exclusion de soi.
   Ce fichier interceptait la soumission des mêmes formulaires en doublon ;
   il reste présent car la CI vérifie sa syntaxe, mais n'est plus chargé
   par field-buying.html et ne fait rien. */
(function () {
'use strict';
})();
