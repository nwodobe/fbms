/* ANAGROCI AFLP 2027 — Carte de plantation (PDF vectoriel et GeoJSON)
   Document interne : aucune certification RA automatique, aucune tuile satellite redistribuée.
   Les exports ne se basent que sur une géométrie lue du serveur avec les droits RLS. */
(function (global) {
  'use strict';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (x) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x];
  }); }
  function nombre(v, dec) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(dec == null ? 2 : dec).replace('.', ',') : '—'; }
  function date(v) { if (!v) return '—'; var d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' }); }
  function anneau(g) {
    var raw = g && g.geojson;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { return null; } }
    if (!raw || raw.type !== 'Polygon' || !Array.isArray(raw.coordinates) || raw.coordinates.length !== 1) return null;
    var rows = raw.coordinates[0];
    if (!Array.isArray(rows) || rows.length < 4 || rows.length > 5000) return null;
    var valid = rows.every(function(p) {
      return Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0]))
        && Number.isFinite(Number(p[1])) && Number(p[0]) >= -180 && Number(p[0]) <= 180
        && Number(p[1]) >= -90 && Number(p[1]) <= 90;
    });
    if (!valid) return null;
    var pts = rows.map(function (p) { return [Number(p[0]), Number(p[1])]; });
    if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) return null;
    return pts;
  }
  function garde(x, g) {
    if (!x || !g || !x.plot_id || x.plot_id !== g.plot_id ||
        x.consentement_gps !== true || !anneau(g)) return false;
    return true;
  }
  function qualification(g) {
    if (g.status !== 'VALIDE') return 'PROVISOIRE — contour non validé FBMS';
    if (g.method === 'SATELLITE' || !Number(g.gps_points)) return 'VALIDÉ FBMS — références terrain à contrôler';
    if (g.producer_confirmation !== 'CONFIRMEE_SUR_PLACE') return 'VALIDÉ FBMS — confirmation du producteur à contrôler';
    return 'VALIDÉ FBMS — examen documentaire Rainforest Alliance requis';
  }
  function construireGeojson(x,g) {
    if (!garde(x,g)) throw new Error('Export interdit : contour serveur, parcelle ou consentement GPS indisponible.');
    var pts = anneau(g);
    return {
      type:'FeatureCollection',
      features:[{
        type:'Feature',
        properties:{
          source:'ANAGROCI AFLP 2027 / FBMS',
          fbms_plot_id:String(x.plot_id),
          plot_code:x.plot_code || null,
          producer_code:x.producteur_code || null,
          village:x.village_nom || null,
          cluster:x.cluster_code || null,
          farm_id:null,
          farm_unit_id:null,
          crop:'CASHEW',
          unit_area_ha:g.area_m2 == null ? null : Number((Number(g.area_m2)/10000).toFixed(4)),
          declared_area:x.declared_area == null ? null : Number(x.declared_area),
          declared_area_unit:x.area_unit || 'HA',
          perimeter_m:g.perimeter_m == null ? null : Number(g.perimeter_m),
          geometry_id:String(g.id), geometry_version:Number(g.version_no),
          mapping_method:g.method, server_status:g.status,
          qualification:qualification(g),
          imagery_source:g.imagery_source || null,
          captured_at:g.created_at || null,
          ground_gps_points:Number(g.gps_points||0),
          producer_confirmation:g.producer_confirmation || null,
          crs:'EPSG:4326'
        },
        geometry:{type:'Polygon',coordinates:[pts]}
      }]
    };
  }
  function fichier(x, g) {
    if (!garde(x,g)) throw new Error('Export impossible : droit GPS retiré ou géométrie non chargée.');
    var json=JSON.stringify(construireGeojson(x,g),null,2);
    var blob=new Blob([json],{type:'application/geo+json;charset=utf-8'});
    var uri=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=uri; a.download='AFLP-PLANTATION-'+String(x.plot_code||x.plot_id).replace(/[^a-zA-Z0-9_-]/g,'_')+'-v'+g.version_no+'.geojson';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(uri);},30000);
  }
  function carteSvg(g) {
    var pts=anneau(g);
    if (!pts) throw new Error('Polygone WGS84 invalide.');
    var midLat=pts.reduce(function(n,p){return n+p[1];},0)/pts.length;
    var cs=Math.max(0.03,Math.cos(midLat*Math.PI/180));
    var raw=pts.map(function(p){return [p[0]*cs*111320,p[1]*111320];});
    var xs=raw.map(function(p){return p[0];}),ys=raw.map(function(p){return p[1];});
    var minX=Math.min.apply(null,xs),maxX=Math.max.apply(null,xs),minY=Math.min.apply(null,ys),maxY=Math.max.apply(null,ys);
    var rangeX=Math.max(1,maxX-minX),rangeY=Math.max(1,maxY-minY);
    var factor=Math.min(735/rangeX,300/rangeY);
    var left=(820-rangeX*factor)/2,top=(335-rangeY*factor)/2;
    var polygon=raw.map(function(p){return (left+(p[0]-minX)*factor).toFixed(1)+','+(top+(maxY-p[1])*factor).toFixed(1);}).join(' ');
    var circles=raw.slice(0,-1).map(function(p,i){
      var cx=(left+(p[0]-minX)*factor).toFixed(1),cy=(top+(maxY-p[1])*factor).toFixed(1);
      return '<circle cx="'+cx+'" cy="'+cy+'" r="3.1" fill="#ffffff" stroke="#086b38" stroke-width="1.5"/>';
    }).join('');
    var metres=Math.min(1000,Math.max(10,Math.pow(10,Math.floor(Math.log10(120/factor)))));
    if (!Number.isFinite(metres)) metres=10;
    var px=Math.max(15,Math.min(210,metres*factor));
    return '<svg viewBox="0 0 820 365" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Contour vectoriel de la plantation">'
      + '<rect width="820" height="365" fill="#f0f3eb"/>'
      + Array.from({length:15},function(_,i){return '<path d="M0 '+(i*28)+' H820" stroke="#d5decf" stroke-width=".7"/>';}).join('')
      + Array.from({length:28},function(_,i){return '<path d="M'+(i*30)+' 0 V365" stroke="#d5decf" stroke-width=".7"/>';}).join('')
      + '<polygon points="'+polygon+'" fill="#7ab87c" fill-opacity=".37" stroke="#075931" stroke-width="3" stroke-linejoin="round"/>'
      + circles
      + '<path d="M783 35 L783 10 M777 22 L783 9 L789 22" stroke="#243f2e" stroke-width="2" fill="none"/>'
      + '<text x="783" y="45" text-anchor="middle" font-size="12" font-weight="bold" fill="#243f2e">N</text>'
      + '<path d="M30 330 H'+(30+px).toFixed(0)+'" stroke="#243f2e" stroke-width="3"/>'
      + '<path d="M30 325 V335 M'+(30+px).toFixed(0)+' 325 V335" stroke="#243f2e" stroke-width="2"/>'
      + '<text x="30" y="349" font-size="12" fill="#243f2e">0</text>'
      + '<text x="'+(30+px).toFixed(0)+'" y="349" text-anchor="end" font-size="12" fill="#243f2e">'+metres+' m</text>'
      + '</svg>';
  }
  function documentHtml(x,g) {
    if (!garde(x,g)) throw new Error('Aucun contour serveur autorisé à documenter.');
    var q=qualification(g),svg=carteSvg(g);
    var reference=esc(x.plot_code||x.plot_id);
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Carte de plantation '+reference+'</title><style>'
      +'@page{size:A4 landscape;margin:9mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#17392a;margin:0;background:#fafbf8}.page{padding:13px 17px}h1{margin:0;font-size:21px}h2{margin:6px 0 8px;font-size:13px}.muted{color:#485a4d}.top{display:flex;justify-content:space-between;border-bottom:3px solid #075931;padding-bottom:9px}.status{padding:7px 10px;background:#f4e7be;font-weight:bold;border-radius:5px}.cols{display:grid;grid-template-columns:1.9fr 1fr;gap:15px;margin-top:12px}.map svg{display:block;width:100%;height:auto;border:1px solid #b9c9b8}dl{display:grid;grid-template-columns:40% 60%;gap:6px 5px}dt{color:#546457}dd{margin:0;font-weight:600;overflow-wrap:anywhere}p{margin:8px 0}.fine{font-size:10px;color:#52665a}.foot{border-top:1px solid #a4b6a7;margin-top:14px;padding-top:7px}.noprint{margin:14px 0}.noprint button{padding:10px 16px;background:#075931;color:#fff;border:0;border-radius:6px;font-weight:bold} @media print{.noprint{display:none}.page{padding:0}body{background:#fff}}</style></head><body><main class="page">'
      +'<div class="top"><div><div class="muted">ANAGROCI · AFLP 2027 · Registre cartographique</div><h1>CARTE DE PLANTATION</h1><div class="muted">Fiche documentaire liée à une géométrie serveur</div></div><div class="status">'+esc(q)+'</div></div>'
      +'<div class="cols"><section class="map"><h2>Contour WGS84 · représentation vectorielle</h2>'+svg+'<p class="fine">Cette carte représente le polygone enregistré, sur fond neutre et non satellite. Elle ne constitue ni un bornage cadastral ni une certification Rainforest Alliance. L’imagerie Esri consultée pour le tracé n’est pas reproduite dans le PDF.</p></section>'
      +'<section><h2>Identification et mesures</h2><dl>'
      +'<dt>Code parcelle</dt><dd>'+reference+'</dd>'
      +'<dt>Producteur</dt><dd>'+esc((x.producteur_nom||'')+' '+(x.producteur_prenoms||''))+' · '+esc(x.producteur_code||x.producteur_id)+'</dd>'
      +'<dt>Village / cluster</dt><dd>'+esc(x.village_nom||'—')+' / '+esc(x.cluster_code||'—')+'</dd>'
      +'<dt>Farm ID / Farm Unit ID (RA)</dt><dd>À rapprocher du registre RA</dd>'
      +'<dt>Superficie déclarée</dt><dd>'+nombre(x.declared_area)+' '+esc(x.area_unit||'HA')+'</dd>'
      +'<dt>Superficie calculée</dt><dd>'+nombre(Number(g.area_m2)/10000)+' ha</dd>'
      +'<dt>Périmètre</dt><dd>'+nombre(g.perimeter_m)+' m</dd>'
      +'<dt>Méthode</dt><dd>'+esc(g.method)+'</dd>'
      +'<dt>Version géométrie</dt><dd>v'+esc(g.version_no)+' · '+esc(g.id)+'</dd>'
      +'<dt>Relevé / envoi</dt><dd>'+date(g.created_at)+'</dd>'
      +'<dt>Références GPS terrain</dt><dd>'+Number(g.gps_points||0)+' point(s) déclaré(s)</dd>'
      +'<dt>Confirmation producteur</dt><dd>'+esc(g.producer_confirmation||'Non renseignée')+'</dd>'
      +'<dt>Décision Chef de Zone</dt><dd>'+esc(g.status)+' · '+esc(g.decide_par_nom||'Non validé')+' · '+date(g.decided_at)+'</dd>'
      +'<dt>Source imagerie du tracé</dt><dd>'+esc(g.imagery_source||'Non renseignée')+'</dd>'
      +'</dl></section></div>'
      +'<div class="foot fine">Produit à partir d’une version serveur de la géométrie. Géolocalisation sous consentement GPS actif. Document interne de préparation et de traçabilité, non valable comme certificat Rainforest Alliance. Généré le '+date(new Date().toISOString())+'.</div>'
      +'<div class="noprint"><button type="button" onclick="window.print()">Imprimer / Enregistrer au format PDF</button></div>'
      +'</main></body></html>';
  }
  function imprimer(x,g) {
    var html=documentHtml(x,g);
    var w=global.open('','_blank');
    if (!w) throw new Error('Fenêtre d’impression bloquée : autorisez les fenêtres surgissantes.');
    w.document.open(); w.document.write(html); w.document.close();
    w.focus();
  }
  global.ANAGROCI_CARTE_PLANTATION={
    version:'1.0.0',
    geojson:construireGeojson,
    html:documentHtml,
    qualification:qualification,
    eligible:garde,
    telechargerGeojson:fichier,
    imprimer:imprimer
  };
})(window);
