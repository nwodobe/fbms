# E2E-3 — validation technique

Cette phase ajoute l'identification physique des sacs RCN remplis et le suivi de stock par lot et par lieu.

Règles conservées :
- la parcelle GPS reste non bloquante pour l'achat 2027 ;
- aucun jeu de données fictif n'est persisté en production ;
- les mouvements ne peuvent pas expédier plus de stock que le solde disponible ;
- tout écart de poids reçu exige une justification ;
- un stock expédié reste visible en transit jusqu'à sa réception.
