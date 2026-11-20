/* AFLP RA Lot 3. GeoJSON/KML strict Farm Unit ID; single-page private PDF archive.
   A self-contained, vector PDF avoids redistributing Esri imagery or depending on a paid export API. */
(function(global) {
 'use strict';
 function ensure(x,g,u) {
   if (!x || !g || !u || x.consentement_gps!==true || x.plot_id!==g.plot_id
     || g.status!=='VALIDE' || u.status!=='VERIFIE' || u.plot_id!==x.plot_id
     || !u.farm_id || !u.farm_unit_id || !u.source_reference
     || g.ra_statut_preparation!=='REVUE_DOCUMENTAIRE_RA_REQUISE')
     throw new Error('Dossier Rainforest Alliance incomplet : identifiants vérifiés, références terrain, contour validé et consentement requis.');
   return global.ANAGROCI_CARTE_PLANTATION.geojson(x,g).features[0].geometry;
 }
 function features(x,g,u) {
   var polygon=ensure(x,g,u);
   return {type:'FeatureCollection',features:[{
     type:'Feature',
     properties:{name:u.farm_unit_id,farm_id:u.farm_id,farm_unit_id:u.farm_unit_id,
       fbms_plot_id:x.plot_id,geometry_version:g.version_no,geometry_id:g.id,
       preparation:'REVUE_DOCUMENTAIRE_RA_REQUISE'},
     geometry:polygon
   }]};
 }
 function xml(s) {
   return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c];});
 }
 function kml(x,g,u) {
   var polygon=ensure(x,g,u),parts=polygon.coordinates;
   if (parts.length!==1) throw new Error('Polygones à trous non pris en charge par ce format.');
   var points=parts[0].map(function(p){return p[0]+','+p[1]+',0';}).join(' ');
   return '<?xml version="1.0" encoding="UTF-8"?>'
     +'<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
     +'<Placemark><name>'+xml(u.farm_unit_id)+'</name><description>'+xml('AFLP / Farm ID: '+u.farm_id)+'</description>'
     +'<Polygon><outerBoundaryIs><LinearRing><coordinates>'+points+'</coordinates></LinearRing></outerBoundaryIs></Polygon>'
     +'</Placemark></Document></kml>';
 }
 function save(name, mime, content) {
   var blob=new Blob([content],{type:mime}), href=URL.createObjectURL(blob), a=document.createElement('a');
   a.href=href;a.download=name;document.body.appendChild(a);a.click();a.remove();
   setTimeout(function(){URL.revokeObjectURL(href);},30000);
 }
 function exportFichier(x,g,u,format) {
   var suffix=String(u.farm_unit_id).replace(/[^a-zA-Z0-9_-]/g,'_');
   if(format==='kml') save('RA-'+suffix+'.kml','application/vnd.google-earth.kml+xml',kml(x,g,u));
   else if(format==='geojson') save('RA-'+suffix+'.geojson','application/geo+json',JSON.stringify(features(x,g,u),null,2));
   else throw new Error('Format inconnu');
 }
 function ascii(s) {
   return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');
 }
 function pdfEscape(s) {return ascii(s).replace(/([\\()])/g,'\\$1').slice(0,145);}
 function nativePDF(x,g,u) {
   var poly=ensure(x,g,u),pts=poly.coordinates[0],w=842,h=595;
   var content=['q','0.06 0.27 0.16 rg','0 565 842 30 re f','Q'];
   function txt(label,X,Y,size,bold) {
     content.push('BT /'+(bold?'F2':'F1')+' '+size+' Tf '+X+' '+Y+' Td ('+pdfEscape(label)+') Tj ET');
   }
   txt('ANAGROCI  |  AFLP 2027  |  CARTE DE PLANTATION',32,574,14,true);
   txt('Document interne de preparation. Non valable comme certificat Rainforest Alliance.',32,543,9);
   txt('Contour WGS84, fond vectoriel sans image Esri',32,519,10,true);
   content.push('0.94 0.96 0.92 rg','27 133 520 366 re f','0.7 0.75 0.7 RG','27 133 520 366 re S');
   var lat=pts.reduce(function(a,p){return a+p[1];},0)/pts.length;
   var cs=Math.max(.03,Math.cos(lat*Math.PI/180));
   var xy=pts.map(function(p){return [p[0]*111320*cs,p[1]*111320]});
   var x0=Math.min.apply(null,xy.map(p=>p[0])),x1=Math.max.apply(null,xy.map(p=>p[0]));
   var y0=Math.min.apply(null,xy.map(p=>p[1])),y1=Math.max.apply(null,xy.map(p=>p[1]));
   var spreadX=Math.max(1,x1-x0),spreadY=Math.max(1,y1-y0);
   var scale=Math.min(485/spreadX,325/spreadY);
   var dx=27+(520-spreadX*scale)/2,dy=133+(366-spreadY*scale)/2;
   content.push('0.03 0.39 0.21 RG','2.2 w');
   xy.forEach(function(p,i){var xx=dx+(p[0]-x0)*scale,yy=dy+(p[1]-y0)*scale;content.push(xx.toFixed(2)+' '+yy.toFixed(2)+' '+(i===0?'m':'l'));});
   content.push('h S');
   txt('N',518,474,12,true);content.push('518 450 m 518 468 l S');
   txt('Code parcelle: '+(x.plot_code||x.plot_id),568,487,9,true);
   txt('Producteur: '+(x.producteur_code||x.producteur_id),568,461,9);
   txt('Village: '+(x.village_nom||''),568,438,9);
   txt('Cluster: '+(x.cluster_code||''),568,415,9);
   txt('Farm ID:',568,389,10,true);txt(u.farm_id,568,373,9);
   txt('Farm Unit ID:',568,345,10,true);txt(u.farm_unit_id,568,329,9);
   txt('Surface: '+(Number(g.area_m2)/10000).toFixed(3)+' ha',568,300,9);
   txt('Perimetre: '+Number(g.perimeter_m).toFixed(1)+' m',568,278,9);
   txt('Version: '+g.version_no,568,256,9);
   txt('Points terrain confirmes: '+Number(g.ra_references_confirmees||0),568,233,9);
   txt('Date de generation: '+new Date().toISOString().slice(0,10),568,206,9);
   txt('Statut interne: REVUE DOCUMENTAIRE RA REQUISE',30,102,10,true);
   txt('Reperes terrain verifies et identifiants rapproches en interne, sans confirmation de la plateforme RA.',30,81,9);
   txt('Geometrie: '+g.id,30,60,8);
   txt('Source registre: '+u.source_reference,30,44,8);
   txt('Ce fichier PDF archive est vectoriel. Aucune tuile satellite Esri n est reproduite.',30,28,8);
   // ASCII only, so PDF stream length and byte offsets equal JS string length.
   var stream=content.join('\n')+'\n';
   var objects=[
     '<< /Type /Catalog /Pages 2 0 R >>',
     '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
     '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+w+' '+h+'] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
     '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
     '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
     '<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream'
   ];
   var pdf='%PDF-1.4\n',offsets=[0];
   objects.forEach(function(obj,i){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
   var xref=pdf.length;
   pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
   offsets.slice(1).forEach(function(o){pdf+=String(o).padStart(10,'0')+' 00000 n \n';});
   pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
   return new Uint8Array(pdf.split('').map(function(c){return c.charCodeAt(0);}));
 }
 async function archive(x,g,u,client,uuid) {
   var pdf=nativePDF(x,g,u);
   if(pdf.length>5242880)throw new Error('PDF trop volumineux.');
   if(!global.crypto || !global.crypto.subtle)throw new Error('HTTPS et empreinte cryptographique obligatoires.');
   var digest=await global.crypto.subtle.digest('SHA-256',pdf);
   var sha=Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
   var id=uuid(),path=x.plot_id+'/'+g.id+'/'+id+'.pdf';
   var file=new Blob([pdf],{type:'application/pdf'});
   var upload=await client.storage.from('aflp-ra-plantation-pdfs').upload(path,file,
     {contentType:'application/pdf',upsert:false,cacheControl:'0'});
   if(upload.error)throw new Error('Dépôt privé non confirmé : '+upload.error.message);
   var response=await client.rpc('plot_map_ra_document_archiver',{
      p_id:id,p_plot:x.plot_id,p_geometry:g.id,p_path:path,p_sha:sha,p_bytes:pdf.length
   });
   if(response.error)throw new Error('PDF stocké mais NON référencé : '+response.error.message+' (signaler le document '+id+')');
   return {id:id,storage_path:path,sha256_client:sha};
 }
 async function privateUrl(client,path) {
   var result=await client.storage.from('aflp-ra-plantation-pdfs').createSignedUrl(path,60);
   if(result.error)throw new Error('Lecture privée refusée : '+result.error.message);
   return result.data.signedUrl;
 }
 global.ANAGROCI_RA_LOT3={geojson:features,kml:kml,pdf:nativePDF,exporter:exportFichier,archive:archive,urlPrivee:privateUrl};
})(window);
