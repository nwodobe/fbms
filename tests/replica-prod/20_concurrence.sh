#!/usr/bin/env bash
# S15 · deux achats simultanés (60 000 + 60 000) sur un disponible de 100 000 FCFA.
# Deux sessions PostgreSQL réelles ; la première garde sa transaction ouverte 2 s.
set -uo pipefail
DB=${1:-rt_sop_replica}
UHB=a0000000-0000-4000-8000-000000000005
run_case(){ # $1 campagne  $2 étiquette
  local C=$1 L=$2
  psql -q -X -d "$DB" -c "select t.fund('RT-B1',100000,'$C','s15-$L')" >/dev/null
  for i in 1 2; do
    psql -X -q -d "$DB" >"/tmp/s15-$L-$i.log" 2>&1 <<SQL &
begin;
set role authenticated;
select set_config('request.jwt.claim.sub','$UHB',true);
insert into achats(local_id,date,cluster,village_id,rt_id,rt_nom,poids_net,prix_kg,montant,numero_recu,campaign_id)
 values ('s15-$L-$i',current_date,'CLUSTER-B','V-B1','RT-B1','RT FICTIF',150,400,60000,'R-15$i','$C');
select pg_sleep(2);
commit;
SQL
    sleep 0.3
  done
  wait
  local n total
  n=$(psql -Atq -X -d "$DB" -c "select count(*) from achats where local_id like 's15-$L-%'")
  total=$(psql -Atq -X -d "$DB" -c "select coalesce(sum(montant),0) from achats where local_id like 's15-$L-%'")
  local statut=PASS; [ "$n" = "1" ] || statut=FAIL
  local err; err=$(grep -h -o 'ERROR:.*' /tmp/s15-$L-*.log | head -1 | cut -c1-110)
  psql -q -X -d "$DB" -c "select t.rec('S15-$L','Concurrence ($L)','au plus 100 000 FCFA consommés','achats acceptés $n, total $total ; refus : ${err//\'/ }',$([ $statut = PASS ] && echo true || echo false),'2 sessions psql simultanées')" >/dev/null
  echo "S15-$L $statut : $n achat(s), $total FCFA ; ${err}"
}
run_case c0000000-0000-4000-8000-00000000000a REELLE
run_case c0000000-0000-4000-8000-00000000000b SIMULATION
