/* ANAGROCI FBMS - Farmer Registry Phase 1 enrollment extension */
(function (global) {
  'use strict';
  if (global.FARMER_ENROLLMENT_PHASE1) return;

  var VERSION = '1.0.0';
  var CONSENT_VERSION = 'AFLP-DATA-CONSENT-2026.1';
  var SCOPES = ['identity','agriculture','gps','photos','training','inspections','transactions'];
  var original = {};

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>\"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]; }); }
  function norm(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }
  function digits(v) { var d=String(v||'').replace(/\D/g,''); return d.length===13&&d.slice(0,3)==='225'?d.slice(3):d; }
  function uuid() { try { return crypto.randomUUID(); } catch (e) { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);}); } }
  function profile() { return (global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile) || (typeof AUTH!=='undefined' && AUTH.session) || {}; }
  function sbReady() { return typeof SB !== 'undefined' && !!SB && typeof isSupabase === 'function' && isSupabase(); }
  function bool(v) { return v === true || v === 'true'; }
  function field(id) { return document.getElementById(id); }
  function value(id) { var e=field(id); return e ? String(e.value || '').trim() : ''; }
  function checked(id) { var e=field(id); return !!(e && e.checked); }
  function setValue(id,v) { var e=field(id); if(e) e.value=v==null?'':v; }
  function setChecked(id,v) { var e=field(id); if(e) e.checked=!!v; }
  function consentFingerprint(c) { return JSON.stringify({status:c.status||'',method:c.method||'',scopes:c.scopes||{},textVersion:c.textVersion||''}); }
  function message(text,kind) {
    var e=field('frpMsg');
    if(!e) { if(text) alert(text); return; }
    e.style.display=text?'block':'none';
    e.style.background=kind==='ok'?'#E3F5E8':kind==='info'?'#E9F1FB':'#FDECE9';
    e.style.color=kind==='ok'?'#1C7A3F':kind==='info'?'#2B5F9E':'#8F2D22';
    e.style.border='1px solid '+(kind==='ok'?'#BFE3B6':kind==='info'?'#BFD1E8':'#E7B7B0');
    e.textContent=text||'';
  }
  function sexCode(v) { var n=norm(v); if(n==='HOMME'||n==='MALE'||n==='M') return 'M'; if(n==='FEMME'||n==='FEMALE'||n==='F') return 'F'; return n==='OTHER'?'OTHER':'UNKNOWN'; }
  function validBirthYear(v) { var y=Number(v), now=new Date().getFullYear(); return Number.isInteger(y)&&y>=1900&&y<=now?y:null; }

  function defaultConsent(p) {
    return {
      id: uuid(), status: 'NOT_RECORDED', method: 'VERBAL', consentAt: new Date().toISOString(),
      textVersion: CONSENT_VERSION, scopes: SCOPES.reduce(function(o,k){o[k]=false;return o;},{}),
      pending: true, originalFingerprint: ''
    };
  }

  function ensureModel(p) {
    if(!p) return;
    p.prenoms=p.prenoms||'';
    p.ageBand=p.ageBand||'';
    p.telephoneAlt=p.telephoneAlt||'';
    p.preferredLanguage=p.preferredLanguage||'FR';
    p.operationalStatus=p.operationalStatus||((p.statut==='Inactif')?'INACTIVE':'ACTIVE');
    p.possibleDuplicate=!!p.possibleDuplicate;
    p.reviewRequired=!!p.reviewRequired;
    p.reviewReason=p.reviewReason||'';
    p.passportStage=p.passportStage||'INCOMPLETE';
    p.passportCompletion=Number(p.passportCompletion)||0;
    if(!p.consent) p.consent=defaultConsent(p);
    p.consent.scopes=p.consent.scopes||{};
    SCOPES.forEach(function(k){if(p.consent.scopes[k]==null)p.consent.scopes[k]=false;});
    p.consent.textVersion=p.consent.textVersion||CONSENT_VERSION;
    p.consent.method=p.consent.method||'VERBAL';
  }

  function computePassport(p) {
    var identity = p.nom && p.sexe && (validBirthYear(p.anneeNaissance)||p.ageBand) && digits(p.telephone).length>=8 ? 30 : 0;
    var assignment = p.villageId && p.rtId ? 20 : 0;
    var consent = p.consent && p.consent.status==='GRANTED' ? 15 : p.consent && p.consent.status==='PARTIAL' ? 8 : 0;
    p.passportCompletion=identity+assignment+consent;
    p.passportStage=identity===30&&assignment===20&&p.consent&&p.consent.status==='GRANTED'?'BASIC':'INCOMPLETE';
    p.riskProfile=(p.reviewRequired||p.possibleDuplicate||(p.consent&&['PARTIAL','REFUSED','WITHDRAWN'].indexOf(p.consent.status)>=0))?'REVIEW_REQUIRED':'NOT_ASSESSED';
    p.consentStatus=p.consent?p.consent.status:'NOT_RECORDED';
  }

  function sectionHtml() {
    return '<section id="frpSection" style="margin-top:18px;border:1px solid #D7E3D6;border-radius:12px;background:#F8FBF7;padding:16px">'
      +'<h3 style="margin:0 0 12px;font:800 15px Archivo,Arial;color:#053B23">Farmer Passport · Phase 1</h3>'
      +'<div id="frpMsg" style="display:none;border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:12px"></div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">'
      +'<label class="frpField">Prénoms<input id="frpPrenoms" type="text"></label>'
      +'<label class="frpField">Tranche d’âge<select id="frpAgeBand"><option value="">—</option><option>18-24</option><option>25-34</option><option>35-44</option><option>45-54</option><option>55-64</option><option>65+</option><option>UNKNOWN</option></select></label>'
      +'<label class="frpField">Téléphone alternatif<input id="frpTelAlt" type="tel" class="no-up"></label>'
      +'<label class="frpField">Langue préférée<select id="frpLanguage"><option value="FR">Français</option><option value="BAOULE">Baoulé</option><option value="DIOULA">Dioula</option><option value="SENOUFO">Sénoufo</option><option value="AUTRE">Autre</option></select></label>'
      +'<label class="frpField">Statut opérationnel<select id="frpOperational"><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option><option value="SUSPENDED">Suspendu</option><option value="REVIEW_REQUIRED">À revoir</option></select></label>'
      +'</div>'
      +'<div style="margin-top:16px;border-top:1px solid #D7E3D6;padding-top:14px">'
      +'<h4 style="margin:0 0 10px;color:#053B23;font-size:13px">AFLP Data Consent</h4>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">'
      +'<label class="frpField">Statut du consentement<select id="frpConsentStatus"><option value="NOT_RECORDED">Non recueilli</option><option value="GRANTED">Accord complet</option><option value="PARTIAL">Accord partiel</option><option value="REFUSED">Refus</option><option value="WITHDRAWN">Retiré</option></select></label>'
      +'<label class="frpField">Mode de consentement<select id="frpConsentMethod"><option value="VERBAL">Verbal</option><option value="WRITTEN">Écrit</option><option value="DIGITAL">Numérique</option><option value="WITNESSED">Avec témoin</option></select></label>'
      +'</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:7px;margin-top:10px">'
      +SCOPES.map(function(k){var labels={identity:'Données d’identité',agriculture:'Données agricoles',gps:'Données GPS',photos:'Photos',training:'Historique de formation',inspections:'Données d’inspection',transactions:'Transactions AFLP'};return '<label style="display:flex;gap:8px;align-items:flex-start;border:1px solid #E3E8E1;border-radius:8px;background:#fff;padding:9px;font-size:12px"><input id="frpScope_'+k+'" type="checkbox" style="width:auto;margin-top:2px">'+labels[k]+'</label>';}).join('')
      +'</div><div style="font-size:10px;color:#68736B;margin-top:8px">Version du texte : '+CONSENT_VERSION+'. Une preuve numérique pourra être ajoutée ultérieurement.</div></div>'
      +'<div id="frpPassport" style="margin-top:14px;border-radius:9px;background:#E0F3DE;color:#053B23;padding:10px 12px;font-size:12px;font-weight:700"></div>'
      +'</section>'
      +'<style id="frpStyle">#frpSection .frpField{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;color:#4F4E4E}#frpSection input,#frpSection select{width:100%;border:1px solid #CBD4C8;border-radius:7px;padding:9px 10px;font:14px IBM Plex Sans,Arial;background:#fff}</style>';
  }

  function refreshPassportBox() {
    if(typeof PROD_EDIT==='undefined'||!PROD_EDIT)return;
    captureExtension(); computePassport(PROD_EDIT);
    var e=field('frpPassport');
    if(e)e.textContent='Farmer Passport Completion : '+PROD_EDIT.passportCompletion+'% · Maturité : '+PROD_EDIT.passportStage+' · Risque : '+PROD_EDIT.riskProfile;
  }

  function populateExtension() {
    if(typeof PROD_EDIT==='undefined'||!PROD_EDIT)return;
    ensureModel(PROD_EDIT);
    setValue('frpPrenoms',PROD_EDIT.prenoms); setValue('frpAgeBand',PROD_EDIT.ageBand);
    setValue('frpTelAlt',PROD_EDIT.telephoneAlt); setValue('frpLanguage',PROD_EDIT.preferredLanguage);
    setValue('frpOperational',PROD_EDIT.operationalStatus); setValue('frpConsentStatus',PROD_EDIT.consent.status);
    setValue('frpConsentMethod',PROD_EDIT.consent.method);
    SCOPES.forEach(function(k){setChecked('frpScope_'+k,bool(PROD_EDIT.consent.scopes[k]));});
    refreshPassportBox();
  }

  function enhanceModal() {
    var root=field('modal-root');
    if(!root||!field('pNom')||field('frpSection'))return;
    var host=root.querySelector('.space-y-5')||root.querySelector('.space-y-4')||root.querySelector('[class*="space-y"]')||root.firstElementChild;
    if(!host)return;
    host.insertAdjacentHTML('beforeend',sectionHtml());
    populateExtension();
    root.addEventListener('input',refreshPassportBox,true);
    root.addEventListener('change',refreshPassportBox,true);
  }

  function captureExtension() {
    if(typeof PROD_EDIT==='undefined'||!PROD_EDIT||!field('frpSection'))return;
    ensureModel(PROD_EDIT);
    PROD_EDIT.prenoms=value('frpPrenoms'); PROD_EDIT.ageBand=value('frpAgeBand');
    PROD_EDIT.telephoneAlt=value('frpTelAlt'); PROD_EDIT.preferredLanguage=value('frpLanguage')||'FR';
    PROD_EDIT.operationalStatus=value('frpOperational')||'ACTIVE';
    var c=PROD_EDIT.consent;
    c.status=value('frpConsentStatus')||'NOT_RECORDED'; c.method=value('frpConsentMethod')||'VERBAL';
    c.textVersion=CONSENT_VERSION; c.consentAt=c.consentAt||new Date().toISOString();
    SCOPES.forEach(function(k){c.scopes[k]=checked('frpScope_'+k);});
    var fp=consentFingerprint(c); c.pending = !c.originalFingerprint || fp!==c.originalFingerprint;
    computePassport(PROD_EDIT);
  }

  function validateConsent(p) {
    var c=p.consent||{};
    if(c.status==='NOT_RECORDED')return 'Le statut du consentement producteur doit être enregistré.';
    var count=SCOPES.filter(function(k){return bool(c.scopes&&c.scopes[k]);}).length;
    if(c.status==='GRANTED'&&count!==SCOPES.length)return 'Un accord complet exige la validation de toutes les catégories de données.';
    if(c.status==='PARTIAL'&&count===0)return 'Un accord partiel doit préciser au moins une catégorie autorisée.';
    return '';
  }

  async function findDuplicates(p) {
    var local=(typeof STATE!=='undefined'&&STATE.producteurs||[]).filter(function(x){return x&&x.id!==p.id&&!x.deleted;}).filter(function(x){return (digits(x.telephone)&&digits(x.telephone)===digits(p.telephone))||(norm(x.nom)===norm(p.nom)&&x.villageId===p.villageId);});
    var rows=local.map(function(x){return {farmer_id:x.code,nom:x.nom,reason:'LOCAL_MATCH',confidence:75};});
    if(sbReady()){
      try{
        var r=await SB.rpc('farmer_possible_duplicates',{p_nom:p.nom||'',p_telephone:p.telephone||'',p_village_id:p.villageId||'',p_exclude_id:p.id||null});
        if(!r.error)rows=r.data||rows;
      }catch(e){/* local fallback */}
    }
    return rows;
  }

  async function loadLatestConsent(producteurId) {
    if(!sbReady()||!producteurId||typeof PROD_EDIT==='undefined'||!PROD_EDIT)return;
    try{
      var r=await SB.from('farmer_consents').select('id,status,scopes,consent_at,text_version,method').eq('producteur_id',producteurId).order('consent_at',{ascending:false}).order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(r.error||!r.data)return;
      PROD_EDIT.consent={id:r.data.id,status:r.data.status,scopes:r.data.scopes||{},consentAt:r.data.consent_at,textVersion:r.data.text_version,method:r.data.method,pending:false};
      PROD_EDIT.consent.originalFingerprint=consentFingerprint(PROD_EDIT.consent);
      populateExtension();
    }catch(e){/* non bloquant */}
  }

  function patchCapture() {
    if(typeof global.captureProdModalFields!=='function'||original.capture)return;
    original.capture=global.captureProdModalFields;
    global.captureProdModalFields=function(){var r=original.capture.apply(this,arguments);captureExtension();return r;};
  }

  function patchOpen() {
    if(typeof global.openProdModal!=='function'||original.open)return;
    original.open=global.openProdModal;
    global.openProdModal=function(id){var r=original.open.apply(this,arguments);setTimeout(function(){enhanceModal();if(id)loadLatestConsent(id);},0);return r;};
  }

  function patchView() {
    if(typeof global.ProducteursView!=='function'||original.view)return;
    original.view=global.ProducteursView;
    global.ProducteursView=function(){var html=original.view.apply(this,arguments);return String(html).replace('Registre par village — l\'application ne charge que les producteurs du village sélectionné.','AFLP Farmer Registry · Farmer Passport · consentement · traçabilité, avec cache par village.');};
  }

  function patchRemote() {
    if(typeof RemoteProducteurs==='undefined'||!RemoteProducteurs||typeof RemoteProducteurs.upsert!=='function'||original.upsert)return;
    original.upsert=RemoteProducteurs.upsert;
    RemoteProducteurs.upsert=async function(p){
      ensureModel(p); computePassport(p);
      if(!sbReady())return original.upsert.apply(this,arguments);
      var copy=typeof structuredClone==='function'?structuredClone(p):JSON.parse(JSON.stringify(p));
      var safeData=typeof structuredClone==='function'?structuredClone(copy):JSON.parse(JSON.stringify(copy));
      ['_sync','_serverUpdatedAt','consent','pieceNum','idDocumentNumber'].forEach(function(k){delete safeData[k];});
      var row={id:copy.id,data:safeData,code:(copy.code&&String(copy.code).indexOf('TMP')!==0)?copy.code:null,nom:copy.nom||'',prenoms:copy.prenoms||null,sexe:sexCode(copy.sexe),birth_year:validBirthYear(copy.anneeNaissance),age_band:copy.ageBand||null,telephone:copy.telephone||'',telephone_alt:copy.telephoneAlt||null,preferred_language:copy.preferredLanguage||null,id_document_type:copy.pieceType||null,id_document_number:copy.pieceNum||null,village_id:copy.villageId,village_nom:copy.villageNom||'',rt_id:copy.rtId||null,statut:copy.statut||'Identifié',operational_status:copy.operationalStatus||'ACTIVE',possible_duplicate:!!copy.possibleDuplicate,review_required:!!copy.reviewRequired,review_reason:copy.reviewReason||null,created_by:copy.createdBy||(typeof AUTH!=='undefined'&&AUTH.session&&AUTH.session.email)||null,deleted:false};
      var res=await SB.from('producteurs').upsert(row).select('data,code,updated_at,passport_stage,passport_completion,risk_profile,consent_status,possible_duplicate,review_required,record_version').single();
      if(res.error)throw new Error(res.error.message);
      if(copy.consent&&copy.consent.status&&copy.consent.status!=='NOT_RECORDED'&&copy.consent.pending!==false){
        var consent={id:copy.consent.id||uuid(),producteur_id:copy.id,status:copy.consent.status,scopes:copy.consent.scopes||{},consent_at:copy.consent.consentAt||new Date().toISOString(),agent_name:profile().nom||profile().email||null,text_version:CONSENT_VERSION,method:copy.consent.method||'VERBAL',source:'FIELD_ENROLLMENT'};
        var cr=await SB.from('farmer_consents').upsert(consent,{onConflict:'id',ignoreDuplicates:true});
        if(cr.error)throw new Error(cr.error.message);
        p.consent.pending=false; p.consent.originalFingerprint=consentFingerprint(p.consent);
      }
      var d=res.data||{};
      p.passportStage=d.passport_stage||p.passportStage; p.passportCompletion=Number(d.passport_completion)||p.passportCompletion;
      p.riskProfile=d.risk_profile||p.riskProfile; p.consentStatus=d.consent_status||p.consentStatus;
      p.possibleDuplicate=!!d.possible_duplicate; p.reviewRequired=!!d.review_required; p.recordVersion=d.record_version||p.recordVersion;
      return {ok:true,producteur:Object.assign(d.data||{}, {code:d.code,updatedAt:d.updated_at,passportStage:p.passportStage,passportCompletion:p.passportCompletion,riskProfile:p.riskProfile})};
    };
  }

  function patchSave() {
    if(typeof global.saveProducteur!=='function'||original.save)return;
    original.save=global.saveProducteur;
    global.saveProducteur=async function(){
      if(typeof global.captureProdModalFields==='function')global.captureProdModalFields();
      if(typeof PROD_EDIT==='undefined'||!PROD_EDIT)return original.save.apply(this,arguments);
      ensureModel(PROD_EDIT); var err=validateConsent(PROD_EDIT); if(err){message(err,'error');return false;}
      var dup=await findDuplicates(PROD_EDIT);
      if(dup.length){
        var names=dup.slice(0,3).map(function(x){return (x.farmer_id||'ID EN ATTENTE')+' · '+(x.nom||'')+' ('+(x.confidence||0)+'%)';}).join('\n');
        if(!confirm('POSSIBLE DUPLICATE\n\n'+names+'\n\nConfirmer malgré tout la création ou la mise à jour ?'))return false;
        PROD_EDIT.possibleDuplicate=true; PROD_EDIT.reviewRequired=true; PROD_EDIT.reviewReason='POSSIBLE DUPLICATE confirmé par '+(profile().nom||profile().email||'agent');
      }
      computePassport(PROD_EDIT); message('Enregistrement du Farmer Passport…','info');
      return original.save.apply(this,arguments);
    };
  }

  function install() {
    if(typeof global.openProdModal!=='function'||typeof global.saveProducteur!=='function'||typeof global.ProducteursView!=='function'||typeof RemoteProducteurs==='undefined')return false;
    patchCapture(); patchOpen(); patchView(); patchRemote(); patchSave();
    var root=field('modal-root'); if(root&&global.MutationObserver){new MutationObserver(function(){setTimeout(enhanceModal,0);}).observe(root,{childList:true,subtree:true});}
    global.FARMER_ENROLLMENT_PHASE1={version:VERSION,consentVersion:CONSENT_VERSION,installed:true};
    return true;
  }

  var tries=0, timer=setInterval(function(){tries++;if(install()||tries>80)clearInterval(timer);},100);
})(window);
