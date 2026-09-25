# Tests AFLP DATA

Tests non destructifs du module **AFLP DATA / AFLP Reports** (programme AFLP 2027).

| Fichier | Rôle |
|---|---|
| `01_aflp_data_rollback.sql` | Jeu fictif complet puis contrôles T1 à T10 et S1. Se termine par `raise exception 'SIMULATION_RESULT …'` : tout est annulé. Ne jamais retirer cette ligne. |
| `verifier_classeur.py` | Contrôle d'un classeur exporté : nom du fichier, 16 onglets dans l'ordre, en-têtes exacts, formules de contrôle, types, section « Contrôles obligatoires ». |

## Exécution

1. Coller `01_aflp_data_rollback.sql` dans l'éditeur SQL Supabase (ou via l'outil d'exécution SQL). Le résultat est l'erreur `SIMULATION_RESULT [...]` : c'est normal, c'est le journal des tests, et la transaction est annulée.
2. Exporter un classeur depuis l'écran AFLP DATA, puis :
   `python3 tests/aflp-data/verifier_classeur.py ANAGROCI_AFLP_DATA_2027_AAAAMMJJ.xlsx`
   (ajouter `--vide` pour un export sans donnée).

## Dernière exécution (26/09/2026, base de production, transaction annulée)

| Scénario | Résultat |
|---|---|
| S1a anon refusé sur les vues AFLP | OK |
| T1 export vide : 0 ligne de données, 24 KPI, 16 contrôles sans alerte | OK |
| T2 export avec données fictives (16 sources) | OK |
| T3 cash : Opening + Received − Paid − Returned = Current, solde 325 000, écart caisse −5 000 détecté, avance non justifiée détectée | OK |
| T4 sacs jute : équation vérifiée, soldes 400 / 87 / 10 identiques au stock sacherie, sacs chez producteur depuis plus de 30 jours détectés | OK |
| T5 stock terrain : 1 500 kg achetés − 600 kg évacués = 900 kg, équation vérifiée chaque jour | OK |
| T6 évacuation : en route depuis plus de 24 h (incident automatique), réception WMS au relais WH-BROBO, écart 600 / 590 kg détecté (contrôle et incident) | OK |
| T7 performance RT : 1 500 kg sur objectif 2 000 kg = 75 %, solde cash, solde sacs, 1er du top 10 | OK |
| T8 performance village et cluster : top 10 villages, cluster Brobo 1,5 MT achetées / 0,6 MT évacuées, villages sans achat | OK |
| T9 incidents : déclaration, clôture sans note refusée, Storekeeper et Consultation refusés, anon refusé, Chef d'Unité clôt avec note, audit tracé | OK |
| T10 traçabilité producteur → village → RT → achat → évacuation | OK |
| S1b Chef d'Unité : audit masqué, encadrement visible, contrôles calculés | OK |

Après exécution : aucune donnée de test restante (villages, RT, producteurs, achats, sacherie, évacuations, réceptions, incidents, comptes).

Classeurs vérifiés (données fictives, écran testé à 390, 768 et 1440 px) : 59 contrôles OK sur l'export fictif, 54 sur l'export vide ; les colonnes « Control (= 0) » valent 0 après recalcul.
