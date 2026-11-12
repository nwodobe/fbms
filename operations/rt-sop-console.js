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
  const app = { sb:null, user:null,role:null,rts:[],campaigns:[],funding:[],purchases:[] };
  const val=(form,key)=>String(form.elements.namedItem(key)?.value??'').trim();
  const file=(form,key)=>form.elements.namedItem(key)?.files?.[0]??null;
  const RT=()=>app.rts.find(x=>x.id===$('rt').value);
  const CID=()=>$('campaign').value;
  const roleMatch=(...roles)=>roles.includes(app.role);
  const money=x=>x==null?'Non vérifié':Number(x).toLocaleString('fr-FR')+' FCFA';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
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
    $('proofMode').addEventListener('change',()=>{
      $('canvasProof').hidden=$('proofMode').value!=='canvas';
      $('paperProof').hidden=$('proofMode').value==='canvas';
    });
    setupPad($('rtSignature'));setupPad($('uhSignature'));
    await reload();
    if(!['Finance','Finance Officer','Finance Manager','Accountant','Comptable'].some(x=>x===app.role))
      log('Compte '+app.role+' connecté. Confirmation des versements réservée à Finance; les autres actions exigent les droits du SOP.');
  }
  async function reload(){
    if(!app.sb||!RT()||!CID())return;
    const [fs,ps,bs]=await Promise.all([
      app.sb.from('rt_sop_funding_requests').select('id,status,amount_fcfa,wave_reference,created_at')
        .eq('rt_id',RT().id).eq('campaign_id',CID()).order('created_at',{ascending:false}).limit(100),
      app.sb.from('achats').select('id,date,producteur_nom,montant,numero_recu,statut_validation')
        .eq('rt_id',RT().id).eq('campaign_id',CID()).order('date',{ascending:false}).limit(100),
      app.sb.from('rt_sop_bev_grn_v').select('bev_code,signed_bev_kg,shipment_code,audit_status,physical_net_received_kg,grn_id,delta_bev_vs_received_kg')
        .eq('rt_id',RT().id).eq('campaign_id',CID()).limit(100)
    ]);
    if (fs.error||ps.error||bs.error){
      log('Module non prêt : migration Supabase ou autorisation manquante. '+(fs.error||ps.error||bs.error).message,true);
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
    log('Données relues. Les montants Wave ne sont jamais présumés reçus sans confirmation Finance et RT.');
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
        if(!roleMatch('Finance','Finance Officer','Finance Manager','Accountant','Comptable'))
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
        if(!roleMatch('Finance','Finance Officer','Finance Manager','Accountant','Comptable'))throw Error('Inscription réservée à Finance.');
        const funding=requireFunding(form,'RT_ACK');
        r=await rpc('rt_sop_post_funding',{p_id:funding.id});
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
        r=await rpc('rt_sop_weekly_sign',{p_campaign_id:CID(),p_rt_id:RT().id,
          p_period_start:val(form,'start'),p_period_end:val(form,'end'),
          p_snapshot:snap,p_rt_decision:dec,p_rt_reservations:res,
          p_signed_proof_path:proof,p_supersedes_id:null,p_key:crypto.randomUUID()});
      }else throw Error('Formulaire inconnu.');
      log('Opération acceptée par le serveur : '+JSON.stringify(r));
      form.reset();
      await reload();
    }catch(e){log((e&&e.message)||String(e),true);}finally{button.disabled=false;}
  }
  window.addEventListener('DOMContentLoaded',()=>init().catch(e=>log('Initialisation impossible : '+e.message,true)));
})();