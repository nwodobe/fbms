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

  // Contour national réel de la Côte d'Ivoire (frontière simplifiée par
  // Douglas-Peucker, 135 points, en [lon, lat]). Source : world-geojson
  // (domaine public). Sert de fond de carte ; les localités sont projetées
  // avec les mêmes bornes pour rester alignées.
  var outline = [
    [-6.247,10.739],[-6.417,10.7],[-6.426,10.566],[-6.634,10.671],[-6.684,10.538],[-6.645,10.364],
    [-6.941,10.357],[-7.013,10.266],[-6.997,10.172],[-7.063,10.145],[-7.142,10.251],[-7.372,10.245],
    [-7.355,10.328],[-7.428,10.339],[-7.451,10.454],[-7.543,10.416],[-7.62,10.462],[-7.855,10.2],
    [-7.995,10.173],[-8.159,9.951],[-8.097,9.807],[-8.138,9.534],[-8.044,9.409],[-7.846,9.432],
    [-7.91,9.185],[-7.725,9.074],[-7.92,9.012],[-7.96,8.808],[-7.769,8.765],[-7.638,8.378],
    [-7.741,8.377],[-7.827,8.496],[-7.879,8.422],[-7.932,8.509],[-8.234,8.466],[-8.246,8.228],
    [-8.085,8.165],[-7.999,8.197],[-8.012,8.096],[-7.944,8.019],[-8.049,8.046],[-8.118,7.866],
    [-8.096,7.724],[-8.203,7.537],[-8.41,7.619],[-8.473,7.556],[-8.369,7.247],[-8.281,7.182],
    [-8.274,7.004],[-8.328,6.972],[-8.343,6.762],[-8.599,6.506],[-8.481,6.436],[-8.443,6.499],
    [-8.4,6.356],[-8.174,6.28],[-8.008,6.323],[-7.9,6.284],[-7.764,5.953],[-7.688,5.897],
    [-7.663,5.952],[-7.549,5.83],[-7.425,5.846],[-7.379,5.519],[-7.45,5.433],[-7.365,5.332],
    [-7.476,5.271],[-7.48,5.132],[-7.554,5.079],[-7.527,4.92],[-7.597,4.894],[-7.568,4.401],
    [-7.517,4.351],[-7.397,4.379],[-7.032,4.542],[-6.91,4.66],[-5.608,5.071],[-3.977,5.252],
    [-3.111,5.076],[-3.073,5.132],[-2.758,5.102],[-2.761,5.6],[-2.861,5.653],[-2.932,5.617],
    [-2.955,5.716],[-3.027,5.709],[-3.021,5.856],[-3.254,6.608],[-3.198,6.716],[-3.228,6.82],
    [-2.951,7.232],[-2.923,7.609],[-2.781,7.949],[-2.602,8.042],[-2.597,8.174],[-2.494,8.205],
    [-2.615,8.919],[-2.655,9.013],[-2.784,9.063],[-2.655,9.247],[-2.718,9.314],[-2.684,9.485],
    [-2.76,9.417],[-2.823,9.453],[-3.01,9.74],[-3.179,9.836],[-3.193,9.938],[-3.267,9.853],
    [-3.312,9.911],[-3.621,9.955],[-3.893,9.905],[-4.044,9.802],[-4.118,9.843],[-4.265,9.76],
    [-4.315,9.601],[-4.515,9.666],[-4.503,9.746],[-4.695,9.681],[-4.815,9.788],[-4.785,9.839],
    [-4.973,9.901],[-4.97,10.046],[-5.07,10.112],[-5.133,10.315],[-5.359,10.281],[-5.512,10.433],
    [-5.643,10.466],[-5.802,10.431],[-5.982,10.196],[-6.192,10.239],[-6.228,10.305],[-6.155,10.424],
    [-6.243,10.522],[-6.181,10.639],[-6.247,10.739]
  ];

  // Bornes de projection ajustées aux extrêmes réels du pays (petite marge).
  var bounds = { lonMin: -8.66, lonMax: -2.43, latMin: 4.28, latMax: 10.82 };

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
