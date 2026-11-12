/* AFLP 2027 · RT SOP Control · no direct updates to finance tables.
 * Server-side RPCs enforce identities, idempotency and required evidence.
 * Offline use: paper only. No financial signature is cached as approved.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const log = (message, failure=false) => {
    const el = $('status'); el.textContent = message;
    el.className = 'panel status ' + (failure ? 'error' : 'good');
  };
  const app = { sb:null, user:null,role:null,rts:[],campaigns:[],funding:[],purchases:[],evidences:[] };
  const val=(form,key)=>String(form.elements.namedItem(key)?.value??'').trim();
  const file=(form,key)=>form.elements.namedItem(key)?.files?.[0]??null;
  const RT=()=>app.rts.find(x=>x.id===$('rt').value);
  const CID=()=>$('campaign').value;
  const roleMatch=(...roles)=>roles.includes(app.role);
  const money=x=>x==null?'Non vérifié':Number(x).toLocaleString('fr-FR')+' FCFA';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const online=()=>typeof navigator!=='undefined' && navigator.onLine!==false;
  async function rpc(name,args) {
    if (!online()) throw Error('Connexion requise pour confirmer une opération ou une signature.');
    const {data,error}=await app.sb.rpc(name,args);
    if (error) throw Error(error.message||'Opération refusée');
    return data;
  }
  async function uploadEvidence(blob) {
    if (!app.user || !RT()) throw Error('Sélectionnez un RT et connectez-vous.');
    if (!online()) throw Error('La preuve doit être déposée en ligne.');
    if (!blob || blob.size===0 || blob.size>10485760) throw Error('Preuve obligatoire (10 Mo maximum).');
    const mime=blob.type||'';
    const ext={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime];
    if (!ext) throw Error('Format non autorisé : PDF, JPEG, PNG ou WebP.');
    const path=[app.user.id,RT().id,crypto.randomUUID()+'.'+ext].join('/');
    const {error}=await app.sb.storage.from('rt-sop-evidence')
      .upload(path,blob,{contentType:mime,upsert:false});
    if (error) throw Error('Dépôt de preuve refusé : '+error.message);
    return path;
  }
  function option(select,label,value){
    const op=document.createElement('option');op.value=value;op.textContent=label;
    select.appendChild(op);
  }
  function opts(id,items,formatter) {
    const el=$(id);
    el.replaceChildren();
    option(el,'Choisir...','');
    items.forEach(x=>option(el,formatter(x),x.id));
  }
  async function init(){
    if (!window.supabase?.createClient) {log('Bibliothèque de connexion absente. Rechargez la page en ligne.',true);return;}
    app.sb=window.supabase.createClient(window.ANAGROCI_SUPABASE_URL||'https://jmbdgpdthzpszfnddwzi.supabase.co',
      window.ANAGROCI_SUPABASE_ANON||'sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d');
    let userResult=await app.sb.auth.getUser();
    if (userResult.error||!userResult.data.user){log('Connectez-vous avec votre compte ANAGROCI pour consulter ce module.',true);return;}
    app.user=userResult.data.user;
    const prof=await app.sb.from('profils').select('role,nom,actif').eq('user_id',app.user.id).maybeSingle();
    if (prof.error||!prof.data?.actif){log('Profil actif introuvable. Contactez le Branch Manager.',true);return;}
    app.role=prof.data.role;
    $('account').textContent=(prof.data.nom||app.user.email)+' · '+app.role;
    const [cs,rs]=await Promise.all([
      app.sb.from('campaigns').select('id,code,status,is_current').order('created_at',{ascending:false}).limit(40),
      app.sb.from('rt').select('id,nom,cluster,village_id,village_nom,deleted').eq('deleted',false).limit(500)
    ]);
    if (cs.error||rs.error) { log('Lecture des référentiels impossible : '+(cs.error||rs.error).message,true);return;}
    app.campaigns=cs.data||[];app.rts=rs.data||[];
    opts('campaign',app.campaigns,x=>x.code+' · '+x.status);
    opts('rt',app.rts,x=>(x.nom||x.id)+' · '+(x.village_nom||x.cluster||''));
    const curr=app.campaigns.find(x=>x.is_current && x.status==='OPEN')
      ||app.campaigns.find(x=>x.status==='OPEN');
    if(curr)$('campaign').value=curr.id;
    $('rt').addEventListener('change',reload);
    $('campaign').addEventListener('change',reload);
    for(const f of document.querySelectorAll('form'))f.addEventListener('submit',submit);
    for(const b of document.querySelectorAll('[data-go]'))b.addEventListener('click',()=>show(b.dataset.go));
    document.querySelectorAll('[data-clear]').forEach(b=>b.addEventListener('click',()=>{
      const cv=$(b.dataset.clear);cv.getContext('2d').clearRect(0,0,cv.width,cv.height);cv.dataset.ink='';
    }));
    $('refreshBtn').addEventListener('click',reload);
    $('proofHistory').addEventListener('click',async function(ev){
      const button=ev.target.closest('button[data-proof]');
      if(!button)return;
      const entry=app.evidences[Number(button.dataset.proof)];
      if(!entry)return;
      button.disabled=true;
      try{
        const {data,error}=await app.sb.storage.from('rt-sop-evidence').createSignedUrl(entry.path,60);
        if(error||!data?.signedUrl)throw Error(error?.message||'Preuve inaccessible');
        const a=document.createElement('a');
        a.href=data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Voir la pièce';
        a.click();
        log('Lien privé ouvert pour 60 secondes : '+entry.label);
      }catch(e){log('Impossible d’ouvrir la preuve : '+e.message,true)}
      finally{button.disabled=false}
    });
    $('proofMode').addEventListener('change',()=>{
      $('canvasProof').hidden=$('proofMode').value!=='canvas';
      $('paperProof').hidden=$('proofMode').value==='canvas';
    });
    setupPad($('rtSignature'));setupPad($('uhSignature'));
    await reload();
    if(!['Finance','Finance Manager'].some(x=>x===app.role))
      log('Compte '+app.role+' connecté. Confirmation des versements réservée à Finance; les autres actions exigent les droits du SOP.');
  }
  async function reload(){
    if(!app.sb||!RT()||!CID())return;
    const [fs,ps,bs,ss,rr]=await Promise.all([
      app.sb.from('rt_sop_funding_requests').select('id,status,amount_fcfa,wave_reference,finance_proof_path,rt_ack_proof_path,created_at')
        .eq('rt_id',RT().id).eq('campaign_id',CID()).order('created_at',{ascending:false}).limit(100),
      app.sb.from('achats').select('id,date,producteur_nom,montant,numero_recu,statut_validation')
        .eq('rt_id',RT().id).eq('campaign_id',CID()).order('date',{ascending:false}).limit(100),
      app.sb.from('rt_sop_bev_grn_v').select('bev_code,signed_bev_kg,shipment_code,audit_status,physical_net_received_kg,grn_id,delta_bev_vs_received_kg,signed_rt_and_transporter_proof')
        .eq('rt_id',RT().id).eq('campaign_id',CID()).limit(100),
      app.sb.from('rt_sop_weekly_signoffs').select('id,period_start,period_end,rt_decision,signed_proof_path,snapshot_sha256')
        .eq('rt_id',RT().id).eq('campaign_id',CID()).order('signed_at',{ascending:false}).limit(100),
      app.sb.from('rt_sop_refunds').select('id,amount_fcfa,payment_reference,evidence_path')
        .eq('rt_id',RT().id).eq('campaign_id',CID()).limit(100)
    ]);
    if (fs.error||ps.error||bs.error||ss.error||rr.error){
      log('Module non prêt : migration Supabase ou autorisation manquante. '+(fs.error||ps.error||bs.error||ss.error||rr.error).message,true);
      return;
    }
    app.funding=fs.data||[];app.purchases=ps.data||[];
    document.querySelectorAll('[data-funding]').forEach(el=>{
      el.replaceChildren();option(el,'Choisir une demande','');
      app.funding.forEach(x=>option(el,x.status+' · '+money(x.amount_fcfa)+' · '+x.id.slice(0,8),x.id));
    });
    opts('purchases',app.purchases,x=>(x.date||'')+' · '+(x.producteur_nom||'Producteur')+' · '+money(x.montant)+' · '+(x.statut_validation||''));
    const rows=bs.data||[];
    $('bevHistory').innerHTML=rows.length?'<table><thead><tr><th>BEV</th><th>Poids</th><th>État</th><th>GRN</th></tr></thead><tbody>'+
      rows.map(x=>'<tr><td>'+esc(x.bev_code)+'</td><td>'+esc(x.signed_bev_kg)+' kg</td><td>'+esc(x.audit_status)+(x.delta_bev_vs_received_kg!=null?' · écart '+esc(x.delta_bev_vs_received_kg)+' kg':'')+'</td><td>'+esc(x.grn_id||'En attente')+'</td></tr>').join('')+'</tbody></table>':'Aucun BEV pour le RT sélectionné.';
    app.evidences=[];
    function add(label,path){
      if(path)app.evidences.push({label,path});
    }
    (fs.data||[]).forEach(x=>{
      add('Wave Finance · '+(x.wave_reference||x.id),x.finance_proof_path);
      add('Réception signée du RT · '+x.id.slice(0,8),x.rt_ack_proof_path);
    });
    (ss.data||[]).forEach(x=>add('Bilan signé · '+x.period_start+' · '+x.rt_decision,x.signed_proof_path));
    (rr.data||[]).forEach(x=>add('Restitution · '+x.payment_reference,x.evidence_path));
    rows.forEach(x=>add('BEV signé · '+x.bev_code,x.signed_rt_and_transporter_proof));
    $('proofHistory').innerHTML=app.evidences.length
      ? '<table><thead><tr><th>Document</th><th>Accès privé</th></tr></thead><tbody>'
        +app.evidences.map((x,i)=>'<tr><td>'+esc(x.label)+'</td><td><button type="button" data-proof="'+i+'">Voir la preuve</button></td></tr>').join('')
        +'</tbody></table>'
      : 'Aucune pièce signée ou confirmée disponible pour ce RT.';
    await loadSituation();
    log('Données relues. Les montants Wave ne sont jamais présumés reçus sans confirmation Finance et RT.');
  }
  const kg=x=>x==null?'Non vérifié':Number(x).toLocaleString('fr-FR')+' kg';
  const nb=x=>x==null?'Non vérifié':Number(x).toLocaleString('fr-FR');
  const line=(label,value,source)=>'<tr><td>'+esc(label)+'</td><td><strong>'+esc(value)+'</strong></td><td class="muted">'+esc(source)+'</td></tr>';
  async function loadSituation(){
    const q=(t,c)=>app.sb.from(t).select(c).eq('rt_id',RT().id).eq('campaign_id',CID());
    const [d,cash,al,jh,inc,bev,lots]=await Promise.all([
      q('rt_sop_rt_dashboard_v','*').maybeSingle(),
      q('rt_sop_cash_balance_v','*').maybeSingle(),
      q('rt_sop_alerts_v','alerte,objet,valeur,age_heures').limit(50),
      q('rt_sop_jute_history_v','movement_at,movement_type,categorie_rt,qty,delta_vides,delta_pleins,reference').order('movement_at',{ascending:false}).limit(30),
      q('rt_sop_incident_links','incident_id,domain,decided_at').is('decided_at',null).limit(50),
      q('rt_sop_bev','id,bev_code,completed_at').is('completed_at',null).limit(50),
      app.sb.from('field_lots').select('id,lot_code,status').eq('campaign_id',CID()).eq('scope_id',RT().village_id||'').limit(100)
    ]);
    const err=[d,cash,al,jh,inc,bev,lots].find(x=>x.error);
    if(err){$('situation').textContent='Situation non disponible : '+err.error.message+'. La migration de conformité est peut-être absente.';return;}
    const x=d.data||{}, c=cash.data||{};
    $('situation').innerHTML='<table><thead><tr><th>Question</th><th>Réponse</th><th>D\'où vient le chiffre</th></tr></thead><tbody>'+
      line('1. Argent Wave vraiment reçu',money(x.avances_confirmees_fcfa),'Versements Finance + signature RT')+
      line('2a. Achats payés, à vérifier',money(x.achats_en_attente_fcfa)+' · '+nb(x.achats_en_attente_nb)+' achat(s)','Achats sans décision UH')+
      line('2b. Achats validés par l\'UH',money(x.achats_uh_fcfa),'Décisions UH avec reçu et preuve')+
      line('3. Reste à justifier',money(x.reste_a_justifier_fcfa),'Reçu − validé UH − rendu ± ajustement Finance')+
      line('   Argent encore libre',money(x.disponible_theorique_fcfa),'Reçu − tous les achats − rendu')+
      line('   Espèces en main (calcul)',money(x.especes_theoriques_fcfa),'Retraits − dépôts − achats en espèces')+
      line('   Écart de caisse au dernier comptage',c.dernier_comptage_especes_fcfa==null?'Pas de comptage':money(x.ecart_caisse_fcfa),'Comptage UH/ZH')+
      line('4. Noix sous la garde du RT',kg(x.stock_sous_garde_rt_kg),'Achats − BEV signés')+
      line('5–6. Noix en transport',kg(x.en_transport_kg),'BEV signés sans GRN')+
      line('6. Noix reçues avec GRN',kg(x.recu_grn_kg),'GRN émis'+(x.bev_ecart_a_examiner?' · '+x.bev_ecart_a_examiner+' écart(s) à examiner':''))+
      line('7. Sacs vides / pleins chez le RT',nb(x.sacs_vides_theoriques)+' / '+nb(x.sacs_pleins_theoriques),'Registre sacherie')+
      line('8. Dernier bilan de la semaine',x.dernier_bilan_semaine?x.dernier_bilan_semaine+' · '+x.statut_dernier_bilan:'Aucun bilan signé','Bilans signés RT + UH')+
      line('9. Bilan signé à jour ?',x.bilan_hebdo_en_retard===false?'Oui':'Non','Signature de moins de 14 jours')+
      line('10. Écarts ouverts',nb(x.anomalies_ouvertes)+(x.suspensions_actives?' · '+x.suspensions_actives+' arrêt(s) en cours':''),'Anomalies SOP')+
      line('Dernier contrôle du ZH',x.dernier_controle_zh?String(x.dernier_controle_zh).slice(0,10):'Aucun',x.controle_zh_en_retard?'En retard (plus de 14 jours)':'À jour')+
      '</tbody></table>'+(x.source_financiere==='NON_VERIFIE'?'<p class="warning">Aucun mouvement prouvé pour ce RT dans cette campagne : rien n\'est encore vérifié.</p>':'');
    const a=al.data||[];
    $('alerts').innerHTML=a.length?'<ul>'+a.map(r=>'<li>'+esc(r.alerte.replace(/_/g,' ').toLowerCase())+(r.valeur!=null?' · '+esc(money(r.valeur)):'')+(r.age_heures!=null?' · '+esc(r.age_heures)+' h':'')+'</li>').join('')+'</ul>':'Aucune alerte.';
    const h=jh.data||[];
    $('juteHistory').innerHTML=h.length?'<table><thead><tr><th>Date</th><th>Mouvement</th><th>Sacs</th><th>Vides</th><th>Pleins</th></tr></thead><tbody>'+
      h.map(r=>'<tr><td>'+esc(String(r.movement_at||'').slice(0,10))+'</td><td>'+esc(r.categorie_rt)+' · '+esc(r.movement_type)+'</td><td>'+esc(r.qty)+'</td><td>'+esc(r.delta_vides)+'</td><td>'+esc(r.delta_pleins)+'</td></tr>').join('')+'</tbody></table>':'Aucun mouvement de sacs.';
    opts('incidentSelect',(inc.data||[]).map(r=>({id:r.incident_id,domain:r.domain})),r=>r.id+' · '+r.domain);
    opts('bevSelect',bev.data||[],r=>r.bev_code);
    const ls=$('lotSelect');ls.replaceChildren();(lots.data||[]).forEach(l=>option(ls,l.lot_code+' · '+l.status,l.id));
  }
  function show(which){
    document.querySelectorAll('[data-go]').forEach(b=>b.classList.toggle('active',b.dataset.go===which));
    document.querySelectorAll('[data-page]').forEach(s=>s.classList.toggle('active',s.dataset.page===which));
  }
  function requireFunding(form,status){
    const f=app.funding.find(x=>x.id===val(form,'funding'));
    if(!f)throw Error('Sélectionnez une demande Wave.');
    if(f.status!==status)throw Error('Cette demande est '+f.status+'; attendu : '+status+'.');
    return f;
  }
  async function makeSnapshot(form){
    const [fin,sacs]=await Promise.all([
      app.sb.from('rt_sop_cash_balance_v').select('reste_a_justifier_fcfa')
      .eq('rt_id',RT().id).eq('campaign_id',CID()).maybeSingle(),
      app.sb.from('sacherie_ct_rt_stock').select('vides,pleins')
      .eq('rt_id',RT().id).maybeSingle()
    ]);
    if(fin.error)throw Error('Solde financier indisponible : '+fin.error.message);
    if(sacs.error)throw Error('Sacherie indisponible : '+sacs.error.message);
    const n=x=>Number(val(form,x));
    const rcn=n('rcn'),empty=n('empty'),full=n('full');
    if (![rcn,empty,full].every(Number.isFinite))throw Error('Comptage RCN et sacs obligatoire.');
    const fonds=fin.data?.reste_a_justifier_fcfa??null;
    const livres=String(val(form,'pieces'));
    if(livres.length<5)throw Error('Indiquez les pièces contrôlées.');
    return {rcn_kg:rcn,reste_a_justifier_fcfa:fonds===null?null:Number(fonds),
      sacs_vides:empty,sacs_pleins:full,pieces:livres,
      sacherie_theorique:sacs.data?{vides:sacs.data.vides,pleins:sacs.data.pleins}:null,
      rt:RT().id,campaign:CID(),period_start:val(form,'start'),period_end:val(form,'end')};
  }
  function setupPad(canvas) {
    const c=canvas.getContext('2d');c.strokeStyle='#053B23';c.lineWidth=3;c.lineCap='round';c.lineJoin='round';
    let drawing=false;
    const xy=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];};
    canvas.addEventListener('pointerdown',e=>{drawing=true;canvas.setPointerCapture(e.pointerId);
      c.beginPath();c.moveTo(...xy(e));c.lineTo(...xy(e));c.stroke();canvas.dataset.ink='yes';});
    canvas.addEventListener('pointermove',e=>{if(!drawing)return;c.lineTo(...xy(e));c.stroke();});
    ['pointerup','pointercancel'].forEach(evt=>canvas.addEventListener(evt,()=>{drawing=false;}));
  }
  function blobOfCanvas(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('Signature non exportable')),'image/png'));}
  async function signBlob(snapshot,decision,reservations){
    if($('rtSignature').dataset.ink!=='yes'||$('uhSignature').dataset.ink!=='yes')
      throw Error('Le RT et l’UH doivent signer chacun dans leur espace.');
    const c=document.createElement('canvas');c.width=1100;c.height=1150;
    const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,c.width,c.height);
    g.fillStyle='#053B23';g.font='bold 32px Arial';g.fillText('ANAGROCI / PJS Global',44,65);
    g.font='bold 25px Arial';g.fillText('Bilan hebdomadaire RT · AFLP',44,112);
    g.fillStyle='#323131';g.font='20px Arial';
    const lines=[
      'RT : '+(RT().nom||RT().id),
      'Campagne : '+$('campaign').selectedOptions[0]?.textContent,
      'Période : '+snapshot.period_start+' au '+snapshot.period_end,
      'RCN compté : '+snapshot.rcn_kg+' kg',
      'Fonds à justifier : '+(snapshot.reste_a_justifier_fcfa??'Non établi')+' FCFA',
      'Sacs vides comptés : '+snapshot.sacs_vides,
      'Sacs pleins comptés : '+snapshot.sacs_pleins,
      'Décision RT : '+decision,
      'Réserves : '+(reservations||'aucune'),
      'Références : '+String(snapshot.pieces||'').slice(0,120),
      'Le RT signe librement en présence du Chef d’Unité.',
      'Document figé lors du dépôt, puis empreinte serveur.'
    ];
    lines.forEach((line,i)=>g.fillText(String(line).slice(0,92),44,163+i*35));
    g.strokeStyle='#8bb39b';g.strokeRect(42,640,1016,460);
    g.font='bold 22px Arial';g.fillText('Signature RT',64,674);g.drawImage($('rtSignature'),60,700,470,130);
    g.fillText('Signature UH',557,674);g.drawImage($('uhSignature'),555,700,470,130);
    g.font='15px Arial';g.fillText('Créé en présence des signataires · '+new Date().toISOString(),64,1000);
    return blobOfCanvas(c);
  }
  async function submit(ev){
    ev.preventDefault();
    const form=ev.currentTarget,which=form.id;
    if(!app.user||!RT()||!CID()){log('Choisissez une campagne et un RT.',true);return;}
    const button=form.querySelector('[type=submit]');button.disabled=true;
    try {
      if(!online())throw Error('Connexion requise pour enregistrer les preuves et validations.');
      let r;
      if(which==='requestForm'){
        if(!roleMatch('Branch Manager'))throw Error('Demande réservée au Branch Manager.');
        r=await rpc('rt_sop_request_funding',{p_campaign_id:CID(),p_rt_id:RT().id,
          p_amount_fcfa:Number(val(form,'amount')),p_plan:val(form,'plan'),
          p_wave_account_ref:val(form,'waveAccount'),p_key:crypto.randomUUID()});
      }else if(which==='financeForm'){
        if(!roleMatch('Finance','Finance Manager'))
          throw Error('Seule Finance peut confirmer le versement.');
        const funding=requireFunding(form,'REQUESTED');
        const proof=await uploadEvidence(file(form,'proof'));
        r=await rpc('rt_sop_finance_confirm',{p_id:funding.id,p_wave_reference:val(form,'reference'),p_proof_path:proof});
      }else if(which==='ackForm'){
        if(!roleMatch('Unit Head','Branch Manager'))throw Error('Réception RT réservée à UH/BM.');
        const funding=requireFunding(form,'FINANCE_SENT');
        const proof=await uploadEvidence(file(form,'proof'));
        r=await rpc('rt_sop_rt_acknowledge',{p_id:funding.id,p_rt_signed_path:proof});
      }else if(which==='postForm'){
        if(!roleMatch('Finance','Finance Manager'))throw Error('Inscription réservée à Finance.');
        const funding=requireFunding(form,'RT_ACK');
        r=await rpc('rt_sop_post_funding',{p_id:funding.id});
      }else if(which==='refundForm'){
        if(!roleMatch('Finance','Finance Manager'))
          throw Error('Restitution réservée à Finance.');
        const proof=await uploadEvidence(file(form,'proof'));
        r=await rpc('rt_sop_refund',{p_campaign_id:CID(),p_rt_id:RT().id,
          p_amount:Number(val(form,'amount')),p_payment_ref:val(form,'reference'),
          p_evidence_path:proof,p_key:crypto.randomUUID()});
      }else if(which==='purchaseForm'){
        if(!roleMatch('Unit Head'))throw Error('Validation réservée au Chef d’Unité.');
        const id=val(form,'achat'),dec=val(form,'decision');
        if(!id)throw Error('Choisir un achat.');
        const f=file(form,'proof');
        const proof=f?await uploadEvidence(f):'';
        r=await rpc('rt_sop_review_purchase',{p_achat_id:id,p_decision:dec,
          p_receipt_ref:val(form,'receipt'),p_payment_ref:val(form,'payment'),
          p_evidence_path:proof,p_reason:val(form,'reason'),p_key:crypto.randomUUID()});
      }else if(which==='bevForm'){
        if(!roleMatch('Unit Head'))throw Error('BEV réservé au Chef d’Unité.');
        if(!form.elements.namedItem('attest').checked)throw Error('Confirmez la vérification physique des signatures.');
        if(!RT().village_id)throw Error('Village RT non identifié.');
        if(val(form,'destinationType')==='WAREHOUSE'&&!val(form,'destinationId'))
          throw Error('L’identifiant du magasin est obligatoire.');
        const proof=await uploadEvidence(file(form,'proof'));
        r=await rpc('rt_sop_register_signed_bev',{
          p_campaign_id:CID(),p_rt_id:RT().id,p_origin_id:RT().village_id,
          p_origin_label:RT().village_nom||RT().village_id,
          p_destination_type:val(form,'destinationType'),
          p_destination_id:val(form,'destinationId'),
          p_destination_label:val(form,'destinationLabel'),
          p_bev_code:val(form,'bevCode'),p_qty_kg:Number(val(form,'kg')),
          p_bags_count:Number(val(form,'bags')),p_vehicle_plate:val(form,'plate'),
          p_transporter:val(form,'transporter'),p_driver:val(form,'driver'),
          p_proof_path:proof,p_signed_at:new Date(val(form,'signedAt')).toISOString(),
          p_key:crypto.randomUUID()});
      }else if(which==='signForm'){
        if(!roleMatch('Unit Head'))throw Error('Bilan réservé au Chef d’Unité.');
        if(!form.elements.namedItem('attest').checked)throw Error('L’attestation UH est obligatoire.');
        const snap=await makeSnapshot(form);
        const dec=val(form,'decision'),res=val(form,'reservations');
        const source=$('proofMode').value;
        const blob=source==='canvas'?await signBlob(snap,dec,res):file(form,'paper');
        const proof=await uploadEvidence(blob);
        // An existing period cannot be overwritten: new signatures create a linked version.
        const previous=await app.sb.from('rt_sop_weekly_signoffs').select('id')
          .eq('rt_id',RT().id).eq('campaign_id',CID()).eq('period_start',val(form,'start'))
          .order('signed_at',{ascending:false}).limit(1);
        if(previous.error)throw Error('Impossible de vérifier les anciens bilans : '+previous.error.message);
        const latest=previous.data?.[0]?.id||null;
        if(latest&&!form.elements.namedItem('replacement').checked)
          throw Error('Cette semaine possède déjà un bilan signé. Cochez « Corriger un bilan » pour créer une nouvelle version signée.');
        if(!latest&&form.elements.namedItem('replacement').checked)
          throw Error('Il n’existe pas de bilan à corriger pour cette semaine.');
        r=await rpc('rt_sop_weekly_sign',{p_campaign_id:CID(),p_rt_id:RT().id,
          p_period_start:val(form,'start'),p_period_end:val(form,'end'),
          p_snapshot:snap,p_rt_decision:dec,p_rt_reservations:res,
          p_signed_proof_path:proof,p_supersedes_id:latest,p_key:crypto.randomUUID()});
      }else if(which==='rejectForm'){
        if(!roleMatch('Finance','Finance Manager'))throw Error('Refus réservé à Finance.');
        const f=requireFunding(form,'REQUESTED');
        r=await rpc('rt_sop_finance_reject',{p_id:f.id,p_reason:val(form,'reason')});
      }else if(which==='cashForm'){
        const type=val(form,'type');
        if(type==='ADJUSTMENT'&&!roleMatch('Finance','Finance Manager'))throw Error('Ajustement réservé à Finance.');
        if(type==='ADJUSTMENT'&&val(form,'reason').length<10)throw Error('Motif de l\'ajustement obligatoire (10 caractères).');
        const proof=await uploadEvidence(file(form,'proof'));
        r=await rpc('rt_sop_record_cash_event',{p_campaign_id:CID(),p_rt_id:RT().id,p_event_type:type,
          p_amount:Number(val(form,'amount')),p_reference:val(form,'reference')||null,p_evidence_path:proof,
          p_reason:val(form,'reason')||null,p_key:crypto.randomUUID()});
      }else if(which==='bevCompleteForm'){
        if(!roleMatch('Unit Head'))throw Error('Complément du BEV réservé au Chef d\'Unité.');
        const lots=[...form.elements.namedItem('lots').selectedOptions].map(o=>o.value);
        r=await rpc('rt_sop_bev_complete',{p_bev_id:val(form,'bev'),p_lot_ids:lots,
          p_handed_over_by:val(form,'handedBy'),p_received_by:val(form,'receivedBy'),p_reserves:val(form,'reserves')||null});
      }else if(which==='zhForm'){
        if(!roleMatch('Zonal Head'))throw Error('Contrôle réservé au Chef de Zone.');
        const proof=await uploadEvidence(file(form,'proof'));
        r=await rpc('rt_sop_record_zh_control',{p_campaign_id:CID(),p_rt_id:RT().id,p_control_type:val(form,'type'),
          p_result:val(form,'result'),p_observations:val(form,'obs'),p_evidence_path:proof,p_key:crypto.randomUUID()});
      }else if(which==='incidentForm'){
        const stops=[['stopAchats','ACHATS'],['stopBev','BEV'],['stopFin','FINANCEMENT']].filter(([k])=>form.elements.namedItem(k).checked).map(([,v])=>v);
        if(stops.length&&!roleMatch('Zonal Head','Branch Manager'))throw Error('Seuls le Chef de Zone et le Branch Manager arrêtent des mouvements.');
        const pf=file(form,'proof');const proof=pf?await uploadEvidence(pf):null;
        r=await rpc('rt_sop_open_incident',{p_campaign_id:CID(),p_rt_id:RT().id,p_domain:val(form,'domain'),
          p_severity:val(form,'severity'),p_description:val(form,'description'),p_responsible:val(form,'responsible'),
          p_immediate_action:val(form,'action')||null,p_evidence_path:proof,p_suspend_scopes:stops,p_key:crypto.randomUUID()});
      }else if(which==='closeForm'){
        const proof=await uploadEvidence(file(form,'proof'));
        r=await rpc('rt_sop_close_incident',{p_incident_id:val(form,'incident'),p_decision:val(form,'decision'),
          p_closing_note:val(form,'note'),p_evidence_path:proof});
      }else throw Error('Formulaire inconnu.');
      log('Opération acceptée par le serveur : '+JSON.stringify(r));
      form.reset();
      await reload();
    }catch(e){log((e&&e.message)||String(e),true);}finally{button.disabled=false;}
  }
  window.addEventListener('DOMContentLoaded',()=>init().catch(e=>log('Initialisation impossible : '+e.message,true)));
})();