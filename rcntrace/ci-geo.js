/* ============================================================================
   RCN TRACE — Référentiel géographique Côte d'Ivoire (rcntrace/ci-geo.js)
   ----------------------------------------------------------------------------
   Liste des localités (villes / départements) avec leur région, district et
   coordonnées (lat, lon), plus un contour simplifié du pays pour la
   cartographie. Sert :
     · à la liste déroulante « provenance / origine » des réceptions ;
     · à la rubrique Cartographie (qualité & volume par localité / région).
   Données 100 % locales (offline-first, aucune ressource externe).
   Précision ~0,1° : suffisante pour une carte nationale de pilotage.
   ========================================================================== */
(function (global) {
  "use strict";

  // Localités : { v: ville, r: région, d: district, lat, lon }
  // Couverture prioritaire de la zone anacarde (Nord, Centre, Nord-Ouest,
  // Nord-Est) + principales villes de chaque district.
  var L = [
    // — Savanes —
    ["Korhogo","Poro","Savanes",9.458,-5.629],
    ["Sinématiali","Poro","Savanes",9.580,-5.380],
    ["M'Bengué","Poro","Savanes",10.00,-5.900],
    ["Dikodougou","Poro","Savanes",9.070,-5.830],
    ["Ferkessédougou","Tchologo","Savanes",9.593,-5.194],
    ["Ouangolodougou","Tchologo","Savanes",9.980,-5.150],
    ["Kong","Tchologo","Savanes",9.130,-4.610],
    ["Boundiali","Bagoué","Savanes",9.520,-6.490],
    ["Tengréla","Bagoué","Savanes",10.480,-6.400],
    ["Kouto","Bagoué","Savanes",9.890,-6.420],
    // — Denguélé —
    ["Odienné","Kabadougou","Denguélé",9.510,-7.560],
    ["Madinani","Kabadougou","Denguélé",9.620,-7.000],
    ["Samatiguila","Kabadougou","Denguélé",9.800,-7.550],
    ["Minignan","Folon","Denguélé",9.620,-7.850],
    ["Tienko","Folon","Denguélé",10.130,-7.660],
    // — Woroba —
    ["Séguéla","Worodougou","Woroba",7.960,-6.673],
    ["Kani","Worodougou","Woroba",8.480,-6.620],
    ["Mankono","Béré","Woroba",8.060,-6.190],
    ["Dianra","Béré","Woroba",8.630,-6.110],
    ["Kounahiri","Béré","Woroba",7.720,-5.720],
    ["Touba","Bafing","Woroba",8.280,-7.680],
    ["Koro","Bafing","Woroba",8.550,-7.450],
    ["Ouaninou","Bafing","Woroba",8.030,-7.750],
    // — Vallée du Bandama —
    ["Bouaké","Gbêkê","Vallée du Bandama",7.690,-5.030],
    ["Béoumi","Gbêkê","Vallée du Bandama",7.670,-5.580],
    ["Sakassou","Gbêkê","Vallée du Bandama",7.460,-5.290],
    ["Botro","Gbêkê","Vallée du Bandama",7.850,-5.310],
    ["Dabakala","Hambol","Vallée du Bandama",8.360,-4.430],
    ["Katiola","Hambol","Vallée du Bandama",8.130,-5.100],
    ["Niakaramandougou","Hambol","Vallée du Bandama",8.660,-5.290],
    // — Yamoussoukro (District autonome) & Bélier —
    ["Yamoussoukro","Yamoussoukro","Yamoussoukro",6.820,-5.280],
    ["Attiégouakro","Bélier","Yamoussoukro",6.710,-5.150],
    ["Toumodi","Bélier","Yamoussoukro",6.550,-5.020],
    ["Tiébissou","Bélier","Yamoussoukro",7.160,-5.220],
    ["Didiévi","Bélier","Yamoussoukro",6.870,-4.900],
    // — Lacs —
    ["Dimbokro","N'Zi","Lacs",6.650,-4.700],
    ["Bocanda","N'Zi","Lacs",7.060,-4.500],
    ["Bongouanou","Moronou","Lacs",6.650,-4.200],
    ["M'Batto","Moronou","Lacs",6.470,-4.380],
    ["Daoukro","Iffou","Lacs",7.060,-3.960],
    ["Prikro","Iffou","Lacs",7.180,-3.650],
    ["M'Bahiakro","Iffou","Lacs",7.460,-4.350],
    // — Sassandra-Marahoué (Haut-Sassandra, Marahoué) —
    ["Daloa","Haut-Sassandra","Sassandra-Marahoué",6.880,-6.450],
    ["Vavoua","Haut-Sassandra","Sassandra-Marahoué",7.380,-6.480],
    ["Issia","Haut-Sassandra","Sassandra-Marahoué",6.490,-6.590],
    ["Zuénoula","Marahoué","Sassandra-Marahoué",7.430,-6.050],
    ["Bouaflé","Marahoué","Sassandra-Marahoué",6.990,-5.740],
    ["Sinfra","Marahoué","Sassandra-Marahoué",6.620,-5.920],
    // — Gôh-Djiboua —
    ["Gagnoa","Gôh","Gôh-Djiboua",6.130,-5.950],
    ["Oumé","Gôh","Gôh-Djiboua",6.380,-5.420],
    ["Divo","Lôh-Djiboua","Gôh-Djiboua",5.840,-5.360],
    ["Lakota","Lôh-Djiboua","Gôh-Djiboua",5.850,-5.680],
    // — Montagnes —
    ["Man","Tonkpi","Montagnes",7.410,-7.550],
    ["Biankouma","Tonkpi","Montagnes",7.740,-7.610],
    ["Danané","Tonkpi","Montagnes",7.260,-8.160],
    ["Zouan-Hounien","Tonkpi","Montagnes",6.920,-8.250],
    ["Duékoué","Guémon","Montagnes",6.740,-7.350],
    ["Bangolo","Guémon","Montagnes",7.010,-7.490],
    ["Kouibly","Guémon","Montagnes",7.250,-7.260],
    ["Guiglo","Cavally","Montagnes",6.540,-7.490],
    ["Bloléquin","Cavally","Montagnes",6.570,-7.940],
    ["Toulepleu","Cavally","Montagnes",6.580,-8.420],
    // — Bas-Sassandra —
    ["San-Pédro","San-Pédro","Bas-Sassandra",4.750,-6.640],
    ["Tabou","San-Pédro","Bas-Sassandra",4.420,-7.350],
    ["Sassandra","Gbôklé","Bas-Sassandra",4.950,-6.080],
    ["Fresco","Gbôklé","Bas-Sassandra",5.090,-5.570],
    ["Soubré","Nawa","Bas-Sassandra",5.790,-6.600],
    ["Méagui","Nawa","Bas-Sassandra",5.420,-6.600],
    ["Buyo","Nawa","Bas-Sassandra",6.260,-7.050],
    // — Comoé (Nord-Est & Est) —
    ["Bondoukou","Gontougo","Comoé",8.040,-2.800],
    ["Tanda","Gontougo","Comoé",7.800,-3.170],
    ["Koun-Fao","Gontougo","Comoé",7.660,-3.280],
    ["Sandégué","Gontougo","Comoé",8.020,-3.400],
    ["Bouna","Bounkani","Comoé",9.270,-3.000],
    ["Doropo","Bounkani","Comoé",9.780,-3.320],
    ["Nassian","Bounkani","Comoé",8.450,-3.470],
    ["Téhini","Bounkani","Comoé",9.600,-3.660],
    ["Abengourou","Indénié-Djuablin","Comoé",6.730,-3.490],
    ["Agnibilékrou","Indénié-Djuablin","Comoé",7.130,-3.200],
    ["Aboisso","Sud-Comoé","Comoé",5.470,-3.210],
    ["Adiaké","Sud-Comoé","Comoé",5.290,-3.300],
    ["Grand-Bassam","Sud-Comoé","Comoé",5.210,-3.740],
    ["Bonoua","Sud-Comoé","Comoé",5.270,-3.600],
    // — Lagunes & Abidjan —
    ["Abidjan","Abidjan","Abidjan",5.350,-4.020],
    ["Dabou","Grands-Ponts","Lagunes",5.320,-4.380],
    ["Jacqueville","Grands-Ponts","Lagunes",5.200,-4.410],
    ["Grand-Lahou","Grands-Ponts","Lagunes",5.140,-5.010],
    ["Agboville","Agnéby-Tiassa","Lagunes",5.930,-4.220],
    ["Tiassalé","Agnéby-Tiassa","Lagunes",5.900,-4.820],
    ["Adzopé","La Mé","Lagunes",6.110,-3.860],
    ["Akoupé","La Mé","Lagunes",6.380,-3.890],
    ["Alépé","La Mé","Lagunes",5.500,-3.660]
  ];

  var localites = L.map(function (a) { return { ville: a[0], region: a[1], district: a[2], lat: a[3], lon: a[4] }; });

  // Contour national simplifié (sens horaire), en [lon, lat]. Sert de fond de
  // carte ; les localités sont projetées avec les mêmes bornes.
  var outline = [
    [-8.60,10.30],[-8.15,10.45],[-7.90,10.16],[-7.05,10.20],[-6.55,10.43],
    [-5.95,10.28],[-5.52,9.90],[-5.18,9.62],[-4.70,9.70],[-4.28,9.61],
    [-3.90,9.92],[-3.30,9.88],[-2.92,9.48],[-2.74,9.05],[-2.83,8.55],
    [-2.60,8.18],[-3.18,7.92],[-2.95,7.55],[-3.02,6.90],[-2.76,6.58],
    [-3.24,6.10],[-2.73,5.58],[-3.30,5.12],[-4.02,5.18],[-4.66,5.08],
    [-5.30,4.98],[-6.05,4.73],[-6.68,4.52],[-7.55,4.35],[-7.53,4.92],
    [-7.92,5.50],[-8.20,6.30],[-8.48,6.90],[-8.20,7.52],[-8.06,8.22],
    [-8.42,8.82],[-8.66,9.52],[-8.60,10.30]
  ];

  // Bornes de projection (avec petite marge sur les extrêmes).
  var bounds = { lonMin: -8.80, lonMax: -2.30, latMin: 4.15, latMax: 10.90 };

  // Projette (lon,lat) vers un repère SVG W×H avec marge pad (px).
  function project(lon, lat, W, H, pad) {
    pad = pad || 0;
    var x = pad + (lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin) * (W - 2 * pad);
    var y = pad + (bounds.latMax - lat) / (bounds.latMax - bounds.latMin) * (H - 2 * pad);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }

  function findLocalite(ville) {
    if (!ville) return null;
    var key = String(ville).trim().toLowerCase();
    return localites.filter(function (l) { return l.ville.toLowerCase() === key; })[0] || null;
  }

  global.RCN_GEO = {
    localites: localites,
    villes: localites.map(function (l) { return l.ville; }),
    regions: localites.reduce(function (acc, l) { if (acc.indexOf(l.region) < 0) acc.push(l.region); return acc; }, []),
    outline: outline,
    bounds: bounds,
    project: project,
    findLocalite: findLocalite
  };
})(typeof window !== "undefined" ? window : this);
