/**
 * Doublure de Leaflet.
 *
 * Les cartes ne sont pas l'objet de cette porte, et leurs tuiles viennent d'un
 * service tiers. Sans doublure, `L is not defined` apparaissait de façon
 * intermittente selon l'ordre de chargement — une porte qui clignote ne se lit
 * plus.
 */
(function () {
  function chainable() {
    var o = {}
    var noms = ['addTo','setView','on','off','remove','bindPopup','openPopup','addLayer','removeLayer','fitBounds','setLatLng','setStyle','invalidateSize','eachLayer','getBounds','clearLayers']
    noms.forEach(function (n) { o[n] = function () { return o } })
    return o
  }
  var L = function () { return chainable() }
  ;['map','tileLayer','marker','circle','circleMarker','polygon','polyline','layerGroup','featureGroup','geoJSON','icon','divIcon','latLng','latLngBounds','control','popup','markerClusterGroup']
    .forEach(function (n) { L[n] = function () { return chainable() } })
  L.Icon = { Default: { prototype: {}, mergeOptions: function () {} } }
  L.control.layers = function () { return chainable() }
  window.L = window.L || L
})();
