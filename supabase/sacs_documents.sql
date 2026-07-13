-- FBMS — Module Sacs : document de transaction (scan) par mouvement
--
-- Aujourd'hui, le document scanne accompagnant chaque mouvement de sacs est
-- conserve SUR L'APPAREIL (localStorage, indexe par local_id) afin de ne pas
-- risquer de casser la synchronisation. Ce script ajoute une colonne `document`
-- (data URI JPEG) a la table sacs_mouvements pour permettre, dans un second
-- temps, de synchroniser aussi l'image entre appareils.
--
-- A executer dans Supabase (SQL editor) quand vous voulez activer la synchro du
-- document. Cote application, il suffira ensuite d'inclure `document` dans le
-- payload d'upsert (voir terrain/sacs.html, fonction syncAll).

alter table public.sacs_mouvements
  add column if not exists document text;

-- Remarque : les data URI JPEG peuvent etre volumineux. Si le volume devient
-- important, envisager plutot un bucket Supabase Storage et ne stocker ici que
-- l'URL du fichier.
