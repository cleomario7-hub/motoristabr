/* Navegação externa: abre o destino no Google Maps ou no Waze (app instalado, ou o site se não tiver). */
(function () {
  'use strict';
  function ok(p) { return p && isFinite(p.lat) && isFinite(p.lng); }
  window.CBRNav = {
    googleUrl: function (p) {
      return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + p.lat + ',' + p.lng;
    },
    wazeUrl: function (p) {
      return 'https://waze.com/ul?ll=' + p.lat + ',' + p.lng + '&navigate=yes';
    },
    // Linha com os dois botões. "label" é o texto antes dos botões (ex.: "Ir até o embarque").
    html: function (p, label) {
      if (!ok(p)) return '';
      return '<div class="navrow"><span class="muted">' + (label || 'Navegar com') + '</span>' +
        '<a class="navbtn" target="_blank" rel="noopener" href="' + CBRNav.googleUrl(p) + '">🗺️ Google Maps</a>' +
        '<a class="navbtn waze" target="_blank" rel="noopener" href="' + CBRNav.wazeUrl(p) + '">🚙 Waze</a></div>';
    }
  };
})();
