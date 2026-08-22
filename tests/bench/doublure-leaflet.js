/**
 * Doublure Leaflet du banc — surface plus complète que celle du dépôt.
 *
 * Pourquoi ce fichier existe : la doublure de `.github/vendor/doublures/leaflet.js`
 * n'implémente pas `map.createPane`. Or `fbms/fbms_carte.html` appelle
 * `map.createPane('labels')` dès la troisième instruction de son script. Avec la
 * doublure du dépôt, tout le script de la page s'interrompt là — plus de
 * chargement de données, plus de minuterie de rafraîchissement, plus d'abonnement
 * temps réel. La page paraissait donc n'émettre AUCUNE requête, ce qui aurait
 * conduit à sous-estimer sa charge d'un facteur important.
 *
 * Cette doublure ne dessine rien : elle fournit juste assez d'API pour que le
 * script de la page s'exécute jusqu'au bout, afin que la DEMANDE RÉSEAU réelle
 * de la page soit mesurable. Elle ne remplace pas un test de rendu
 * cartographique, qui reste `NON TESTÉ`.
 */
(function () {
  'use strict'
  function couche() {
    const o = {
      addTo() { return o }, remove() { return o }, removeFrom() { return o },
      bindPopup() { return o }, openPopup() { return o }, closePopup() { return o },
      setLatLng() { return o }, setStyle() { return o }, setZIndexOffset() { return o },
      on() { return o }, off() { return o }, clearLayers() { return o },
      addLayer() { return o }, removeLayer() { return o }, eachLayer() { return o },
      getBounds() { return { isValid: () => false } },
      setIcon() { return o }, bringToFront() { return o }, bringToBack() { return o },
      redraw() { return o }, setContent() { return o },
    }
    return o
  }
  const panneaux = {}
  function carte() {
    const c = {
      setView() { return c }, fitBounds() { return c }, setZoom() { return c },
      getZoom() { return 9 }, getCenter() { return { lat: 0, lng: 0 } },
      getBounds() { return { contains: () => true, isValid: () => true } },
      on() { return c }, off() { return c }, once() { return c },
      addLayer() { return c }, removeLayer() { return c }, hasLayer() { return false },
      invalidateSize() { return c }, remove() { return c },
      createPane(nom) { panneaux[nom] = { style: {}, className: '', classList: { add() {} } }; return panneaux[nom] },
      getPane(nom) { return panneaux[nom] || (panneaux[nom] = { style: {}, className: '', classList: { add() {} } }) },
      addControl() { return c }, removeControl() { return c },
      openPopup() { return c }, closePopup() { return c }, panTo() { return c },
      getContainer() { return document.createElement('div') },
      latLngToContainerPoint() { return { x: 0, y: 0 } },
      containerPointToLatLng() { return { lat: 0, lng: 0 } },
    }
    return c
  }
  const L = {
    map: carte,
    tileLayer: () => couche(),
    marker: () => couche(),
    circleMarker: () => couche(),
    circle: () => couche(),
    polyline: () => couche(),
    polygon: () => couche(),
    rectangle: () => couche(),
    layerGroup: () => couche(),
    featureGroup: () => couche(),
    markerClusterGroup: () => couche(),
    geoJSON: () => couche(),
    divIcon: (o) => ({ options: o || {} }),
    icon: (o) => ({ options: o || {} }),
    popup: () => couche(),
    tooltip: () => couche(),
    latLng: (a, b) => ({ lat: a, lng: b }),
    latLngBounds: () => ({ isValid: () => false, extend() { return this }, contains: () => true }),
    control: Object.assign(() => ({ addTo() { return this } }), {
      layers: () => ({ addTo() { return this } }),
      scale: () => ({ addTo() { return this } }),
      attribution: () => ({ addTo() { return this } }),
    }),
    DomUtil: { create: (t) => document.createElement(t || 'div'), addClass() {}, removeClass() {} },
    DomEvent: { on() {}, off() {}, stop() {}, disableClickPropagation() {}, disableScrollPropagation() {} },
    Icon: { Default: { prototype: {}, mergeOptions() {} } },
    Util: { extend: Object.assign },
  }
  L.tileLayer.wms = () => couche()
  window.L = L
})()
