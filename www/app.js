(function () {
  'use strict';

  /* ------------------------------------------------------------ */
  /* Utilidades                                                    */
  /* ------------------------------------------------------------ */
  var API = String(window.BRCORRIDA_API || '').replace(/\/$/, '');
  var $ = function (s) { return document.querySelector(s); };
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function money(n) { return 'R$ ' + Number(n).toFixed(2).replace('.', ','); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sem storage */ } return null; }

  var PAY = { dinheiro: 'Dinheiro', pix_motorista: 'Pix ao motorista', mercadopago_pix: 'Pix no app (Mercado Pago)' };
  var ICON = { carro: '🚗', moto: '🏍️' };
  var STATUS_LABEL = { completed: 'Concluída', cancelled: 'Cancelada', no_driver: 'Sem motorista' };

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  /* ------------------------------------------------------------ */
  /* Foto de perfil, carro desenhado e rota no mapa                */
  /* ------------------------------------------------------------ */
  function photoSrc(p) { return p ? API + p : ''; }
  function avatarHtml(name, photo, cls) {
    cls = cls || 'avatar';
    if (photo) return '<img class="' + cls + '" src="' + esc(photoSrc(photo)) + '" alt="">';
    return '<div class="' + cls + '">' + esc(String(name || '?').trim().charAt(0).toUpperCase()) + '</div>';
  }

  // Recorta a foto em quadrado, reduz para 320 px e converte para JPEG leve
  function resizePhoto(file, done) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h), size = Math.min(320, side);
        var c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
        var q = 0.85, out = c.toDataURL('image/jpeg', q);
        while (out.length > 180000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        URL.revokeObjectURL(url);
        done(null, out);
      } catch (e) { URL.revokeObjectURL(url); done(e); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); done(new Error('Não foi possível abrir essa imagem')); };
    img.src = url;
  }

  function bearingDeg(a, b) {
    var rad = Math.PI / 180, y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
    var x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
    return Math.round(((Math.atan2(y, x) / rad) + 360) % 360);
  }
  function distKm(a, b) {
    var rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 12742 * Math.asin(Math.sqrt(h));
  }
  function nearAngle(prev, next) { return prev + ((((next - prev) % 360) + 540) % 360) - 180; } // gira pelo lado mais curto

  // Carro e moto vistos de cima (frente para cima = norte)
  var CAR_SVG = '<svg viewBox="0 0 36 64" width="30" height="53" xmlns="http://www.w3.org/2000/svg">' +
    '<ellipse cx="18" cy="35" rx="17" ry="29" fill="#000" opacity=".22"/>' +
    '<rect x="2" y="9" width="6" height="13" rx="2.5" fill="#111827"/><rect x="28" y="9" width="6" height="13" rx="2.5" fill="#111827"/>' +
    '<rect x="2" y="42" width="6" height="13" rx="2.5" fill="#111827"/><rect x="28" y="42" width="6" height="13" rx="2.5" fill="#111827"/>' +
    '<path d="M18 2C28 2 31 8 31 17V48C31 58 27 62 18 62C9 62 5 58 5 48V17C5 8 8 2 18 2Z" fill="#0B5FFF" stroke="#fff" stroke-width="2"/>' +
    '<path d="M9 21Q18 16 27 21L26 29Q18 26 10 29Z" fill="#1e293b"/>' +
    '<rect x="9" y="31" width="18" height="11" rx="3" fill="#dbeafe"/>' +
    '<path d="M10 45Q18 48 26 45L27 52Q18 55 9 52Z" fill="#1e293b"/>' +
    '<circle cx="10" cy="6.5" r="2" fill="#fde047"/><circle cx="26" cy="6.5" r="2" fill="#fde047"/></svg>';
  var MOTO_SVG = '<svg viewBox="0 0 28 64" width="22" height="50" xmlns="http://www.w3.org/2000/svg">' +
    '<ellipse cx="14" cy="34" rx="12" ry="29" fill="#000" opacity=".22"/>' +
    '<rect x="12" y="2" width="4" height="16" rx="2" fill="#111827"/><rect x="12" y="46" width="4" height="16" rx="2" fill="#111827"/>' +
    '<rect x="3" y="15" width="22" height="4" rx="2" fill="#111827"/>' +
    '<path d="M14 14C20 14 21 22 20 34C19 44 17 48 14 48C11 48 9 44 8 34C7 22 8 14 14 14Z" fill="#0B5FFF" stroke="#fff" stroke-width="2"/>' +
    '<circle cx="14" cy="30" r="6" fill="#1e293b" stroke="#fff" stroke-width="1.5"/></svg>';

  var carState = {};
  function removeCar(key) {
    var c = carState[key];
    if (c) { cancelAnimationFrame(c.anim); if (map) map.removeLayer(c.marker); delete carState[key]; }
  }
  function slideTo(c, to) {
    cancelAnimationFrame(c.anim);
    var from = c.pos, t0 = performance.now(), dur = 3000;
    if (!from || (from[0] === to[0] && from[1] === to[1]) || distKm({ lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] }) > 1.5) {
      c.marker.setLatLng(to); c.pos = to; return;
    }
    (function step(t) {
      var k = Math.max(0, Math.min(1, (t - t0) / dur));
      var cur = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
      c.marker.setLatLng(cur); c.pos = cur;
      if (k < 1) c.anim = requestAnimationFrame(step);
    })(t0);
  }
  // Desenha (ou move) o carro no mapa; "animate" faz ele deslizar suavemente entre uma posição e outra
  function setCar(key, latlng, heading, cat, animate) {
    if (!map) return;
    if (!latlng) { removeCar(key); return; }
    var c = carState[key];
    if (c && c.cat !== cat) { removeCar(key); c = null; }
    if (!c) {
      var ic = L.divIcon({ className: 'car-marker', html: '<div class="car-rot">' + (cat === 'moto' ? MOTO_SVG : CAR_SVG) + '</div>', iconSize: [44, 44], iconAnchor: [22, 22] });
      c = carState[key] = { marker: L.marker(latlng, { icon: ic, interactive: false, zIndexOffset: 1000 }).addTo(map), cat: cat, angle: 0, pos: latlng, anim: 0 };
    } else if (animate) slideTo(c, latlng);
    else { c.marker.setLatLng(latlng); c.pos = latlng; }
    if (heading != null && isFinite(heading)) c.angle = nearAngle(c.angle, Number(heading));
    var node = c.marker.getElement && c.marker.getElement();
    if (node && node.firstChild) node.firstChild.style.transform = 'rotate(' + c.angle + 'deg)';
  }

  // Rota: trecho sólido azul (com contorno branco); quando há dois trechos, o 2º vai tracejado
  var routeLayers = [];
  var routeSig = '';
  function clearRoute() {
    routeLayers.forEach(function (l) { if (map) map.removeLayer(l); });
    routeLayers = []; routeSig = '';
  }
  function drawLegs(legs, fitKey) {
    if (!map || !legs || !legs.length) return;
    var sig = legs.map(function (g) { var q = g.geometry; return g.type + q.length + ':' + q[0] + ':' + q[q.length - 1]; }).join('|');
    if (sig !== routeSig) {
      clearRoute(); routeSig = sig;
      legs.forEach(function (g) {
        if (!g.geometry || g.geometry.length < 2) return;
        var dashed = g.type === 'trip' && legs.length > 1;
        if (!dashed) routeLayers.push(L.polyline(g.geometry, { color: '#ffffff', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map));
        routeLayers.push(L.polyline(g.geometry, dashed
          ? { color: '#111827', weight: 4, opacity: 0.7, dashArray: '2 10', lineCap: 'round', interactive: false }
          : { color: '#0B5FFF', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map));
      });
    }
    if (fitKey) {
      var all = [];
      legs.forEach(function (g) { all = all.concat(g.geometry); });
      fit(all, fitKey);
    }
  }

  /* ------------------------------------------------------------ */
  /* Estado                                                        */
  /* ------------------------------------------------------------ */
  var token = store('brc_token') || '';
  var me = null;
  var map = null;
  var L = window.L;
  var pos = null; // GPS atual
  var origin = null; // {lat,lng,address}
  var originCustom = false;
  var dest = null;
  var estimate = null;
  var category = 'carro';
  var payment = 'dinheiro';
  var ride = null; // corrida ativa vinda do servidor
  var pendingRating = null;
  var skipRating = null;
  var mode = 'idle'; // idle | pickOrigin | pickDest | choose
  var query = '';
  var results = [];
  var stars = 0;
  var busy = false;
  var pollTimer = null;
  var rideSig = '';
  var etaMin = null; // minutos até o motorista chegar / até o destino
  var routeFor = '';
  var routeAt = 0;
  var routeBusy = false;
  var markers = {};
  var fitted = {};

  /* ------------------------------------------------------------ */
  /* API                                                           */
  /* ------------------------------------------------------------ */
  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    return fetch(API + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && token && path.indexOf('/api/auth') !== 0) {
          logout();
          throw new Error('Sua sessão expirou. Entre de novo.');
        }
        if (!res.ok) throw new Error(data.error || 'Erro (' + res.status + ')');
        return data;
      });
    }, function () { throw new Error('Sem conexão com o servidor'); });
  }

  /* ------------------------------------------------------------ */
  /* Login / cadastro                                              */
  /* ------------------------------------------------------------ */
  function showAuth() {
    $('#app').classList.add('hidden');
    $('#auth').classList.remove('hidden');
    clearInterval(pollTimer);
  }
  function setTab(login) {
    $('#tab-login').classList.toggle('on', login);
    $('#tab-register').classList.toggle('on', !login);
    $('#f-login').classList.toggle('hidden', !login);
    $('#f-register').classList.toggle('hidden', login);
    $('#auth-error').textContent = '';
  }
  $('#tab-login').onclick = function () { setTab(true); };
  $('#tab-register').onclick = function () { setTab(false); };

  function submitAuth(e, path, extra) {
    e.preventDefault();
    var f = e.target;
    var btn = f.querySelector('button[type=submit]');
    var body = { role: 'passenger' };
    new FormData(f).forEach(function (v, k) { body[k] = v; });
    for (var k in extra) body[k] = extra[k];
    btn.disabled = true;
    $('#auth-error').textContent = '';
    api('POST', path, body).then(function (r) {
      token = r.token;
      store('brc_token', token);
      me = r.user;
      f.reset();
      startApp();
    }).catch(function (err) {
      $('#auth-error').textContent = err.message;
    }).then(function () { btn.disabled = false; });
  }
  $('#f-login').onsubmit = function (e) { submitAuth(e, '/api/auth/login', {}); };
  $('#f-register').onsubmit = function (e) { submitAuth(e, '/api/auth/register', {}); };

  function logout() {
    token = '';
    me = null;
    store('brc_token', null);
    ride = null; pendingRating = null; dest = null; estimate = null; mode = 'idle';
    showAuth();
  }
  $('#btn-logout').onclick = function () {
    if (ride && !confirm('Você tem uma corrida em andamento. Sair mesmo assim?')) return;
    $('#menu').classList.add('hidden');
    logout();
  };

  /* ------------------------------------------------------------ */
  /* Mapa                                                          */
  /* ------------------------------------------------------------ */
  function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView(window.BRCORRIDA_CENTER || [-15.79, -47.88], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    map.on('click', function (e) {
      if (mode === 'pickOrigin') setPoint('origin', e.latlng.lat, e.latlng.lng);
      else if (mode === 'pickDest') setPoint('dest', e.latlng.lat, e.latlng.lng);
    });
  }

  function icon(cls, size) {
    return L.divIcon({ className: '', html: '<div class="' + cls + '"></div>', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }
  function setMarker(key, latlng, ic) {
    if (!latlng) {
      if (markers[key]) { map.removeLayer(markers[key]); delete markers[key]; }
      return;
    }
    if (markers[key]) { markers[key].setLatLng(latlng); markers[key].setIcon(ic); }
    else markers[key] = L.marker(latlng, { icon: ic, interactive: false }).addTo(map);
  }
  function ll(p) { return p ? [p.lat, p.lng] : null; }

  function fit(points, key) {
    if (!map || fitted[key]) return;
    var pts = points.filter(Boolean);
    if (!pts.length) return;
    fitted[key] = true;
    var h = $('#sheet').offsetHeight;
    if (pts.length === 1) { map.setView(pts[0], 16); return; }
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 80], paddingBottomRight: [40, h + 30], maxZoom: 17 });
  }

  function drawMap() {
    if (!map) return;
    setMarker('me', ll(pos), icon('mk mk-me', 18));
    if (ride) {
      setMarker('from', ll(ride.from), icon('mk mk-from', 16));
      setMarker('to', ll(ride.to), icon('mk mk-to', 16));
      var d = ride.driver && ride.driver.loc;
      setCar('car', d ? ll(d) : null, d ? d.heading : null, ride.category, true);
      var key = 'ride-' + ride.id + '-' + ride.status;
      if (ride.status === 'accepted' || ride.status === 'arrived') {
        if (d) fit([ll(d), ll(ride.from)], key); else fit([ll(ride.from)], key + '-semcarro');
      } else if (ride.status === 'ongoing') {
        if (d) fit([ll(d), ll(ride.to)], key); else fit([ll(ride.to)], key + '-semcarro');
      } else fit([ll(ride.from)], key);
      return;
    }
    setCar('car', null);
    setMarker('from', mode === 'idle' && !dest ? null : ll(origin), icon('mk mk-from', 16));
    setMarker('to', ll(dest), icon('mk mk-to', 16));
    if (mode === 'choose' && estimate) {
      drawLegs([{ type: 'trip', geometry: estimate.geometry }]);
      fit([ll(origin), ll(dest)], 'choose-' + origin.lat + dest.lat + dest.lng);
    } else {
      clearRoute();
    }
  }

  $('#btn-locate').onclick = function () {
    if (pos && map) map.setView([pos.lat, pos.lng], 16);
    else toast('Procurando sua localização…');
  };

  /* ------------------------------------------------------------ */
  /* GPS                                                           */
  /* ------------------------------------------------------------ */
  var gpsStarted = false;
  function startGps() {
    if (gpsStarted) return;
    gpsStarted = true;
    if (!navigator.geolocation) { toast('Este aparelho não tem GPS'); return; }
    navigator.geolocation.watchPosition(function (p) {
      var first = !pos;
      pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (first && map) map.setView([pos.lat, pos.lng], 15);
      if (!originCustom && !ride && (!origin || haversine(origin, pos) > 0.05)) {
        origin = { lat: pos.lat, lng: pos.lng, address: 'Minha localização' };
        if (mode === 'idle') render();
        reverse(pos.lat, pos.lng).then(function (a) {
          if (!originCustom && origin && origin.lat === pos.lat) { origin.address = a; if (mode === 'idle') render(); }
        });
      }
      drawMap();
    }, function (err) {
      if (err && err.code === 1) toast('Ative a permissão de localização para pedir corridas');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
  function haversine(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function reverse(lat, lng) {
    return api('GET', '/api/reverse?lat=' + lat + '&lng=' + lng).then(function (r) { return r.address; }, function () { return 'Local no mapa'; });
  }

  /* ------------------------------------------------------------ */
  /* Escolha de origem/destino                                     */
  /* ------------------------------------------------------------ */
  function setPoint(which, lat, lng) {
    var pt = { lat: lat, lng: lng, address: 'Buscando endereço…' };
    if (which === 'origin') { origin = pt; originCustom = true; mode = 'idle'; }
    else { dest = pt; }
    render();
    reverse(lat, lng).then(function (a) {
      pt.address = a;
      if (which === 'dest') loadEstimate(); else render();
    });
  }

  function search() {
    query = ($('#q') || {}).value || query;
    if (query.trim().length < 3) { toast('Digite pelo menos 3 letras'); return; }
    var c = pos || origin || {};
    var qs = '/api/geocode?q=' + encodeURIComponent(query.trim());
    if (c.lat != null) qs += '&lat=' + c.lat + '&lng=' + c.lng;
    busy = true;
    api('GET', qs).then(function (r) {
      results = r.results;
      if (!results.length) toast('Nenhum endereço encontrado. Tente incluir a cidade ou escolha no mapa.');
    }).catch(function (e) { toast(e.message); }).then(function () { busy = false; render(); });
  }

  function loadEstimate() {
    if (!origin || !dest) { toast('Aguarde o GPS encontrar sua localização'); return; }
    busy = true;
    mode = 'choose';
    estimate = null;
    render();
    api('POST', '/api/rides/estimate', { from: origin, to: dest }).then(function (r) {
      estimate = r;
      if (!r.options.some(function (o) { return o.category === category; })) category = r.options[0].category;
    }).catch(function (e) {
      toast(e.message);
      mode = 'idle'; dest = null;
    }).then(function () { busy = false; render(); });
  }

  function requestRide() {
    if (busy || !estimate) return;
    busy = true;
    render();
    api('POST', '/api/rides', { from: origin, to: dest, category: category, payment: payment }).then(function (r) {
      ride = r.ride;
      mode = 'idle'; results = []; query = '';
    }).catch(function (e) { toast(e.message); }).then(function () { busy = false; render(); });
  }

  /* ------------------------------------------------------------ */
  /* Telas do painel inferior                                      */
  /* ------------------------------------------------------------ */
  function currentView() {
    if (ride) return 'ride';
    if (pendingRating && pendingRating.id !== skipRating) return 'rate';
    return mode;
  }

  function driverCard(d) {
    var v = d.vehicle || {};
    return '<div class="driver">' + avatarHtml(d.name, d.photo, 'avatar') + '<div class="grow"><b>' + esc(d.name) + '</b>' +
      (d.rating ? ' <span class="muted">★ ' + esc(d.rating) + '</span>' : '') +
      '<div class="muted">' + esc(v.model) + ' · ' + esc(v.color) + '</div><span class="plate">' + esc(v.plate) + '</span></div>' +
      '<a class="call" href="tel:' + esc(String(d.phone || '').replace(/\D/g, '')) + '">Ligar</a></div>';
  }

  function viewIdle() {
    var html = '<div class="grab"></div><h2>Para onde vamos?</h2>' +
      '<div class="place"><span class="dot g"></span><div class="grow"><small>Embarque</small>' + esc(origin ? origin.address : 'Buscando sua localização…') +
      '</div><button class="link" data-act="pickOrigin">Alterar</button></div>' +
      '<form class="search" data-form="search"><input id="q" type="search" placeholder="Digite o destino (rua, bairro, local)" value="' + esc(query) + '" autocomplete="off"><button class="btn" type="submit"' + (busy ? ' disabled' : '') + '>Buscar</button></form>' +
      '<button class="link block" data-act="pickDest">📍 Escolher destino no mapa</button>';
    if (results.length) {
      html += '<ul class="results">' + results.map(function (r, i) { return '<li data-act="pick" data-i="' + i + '">' + esc(r.address) + '</li>'; }).join('') + '</ul>';
    }
    return html;
  }

  function viewPick(which) {
    return '<div class="grab"></div><h2>' + (which === 'origin' ? 'Onde você está?' : 'Onde você quer ir?') + '</h2>' +
      '<p class="muted">Toque no mapa para marcar o ' + (which === 'origin' ? 'ponto de embarque' : 'destino') + '.</p>' +
      '<button class="btn ghost" data-act="cancelPick">Cancelar</button>';
  }

  function viewChoose() {
    if (!estimate) {
      return '<div class="grab"></div><div class="status"><div class="spinner"></div><h2>Calculando o preço…</h2></div>';
    }
    var sel = estimate.options.filter(function (o) { return o.category === category; })[0] || estimate.options[0];
    return '<div class="grab"></div>' +
      '<div class="place"><span class="dot g"></span><div class="grow">' + esc(origin.address) + '</div></div>' +
      '<div class="place"><span class="dot k"></span><div class="grow">' + esc(dest.address) + '</div></div>' +
      '<div class="sum"><span>' + Number(estimate.km).toFixed(1).replace('.', ',') + ' km</span><span>~' + estimate.min + ' min</span></div>' +
      '<div class="opts">' + estimate.options.map(function (o) {
        return '<div class="opt' + (o.category === category ? ' sel' : '') + '" data-act="cat" data-cat="' + esc(o.category) + '"><span class="ic">' + (ICON[o.category] || '🚘') + '</span><span class="grow"><b>' + esc(o.label) + '</b></span><b>' + money(o.price) + '</b></div>';
      }).join('') + '</div>' +
      '<select id="pay">' + Object.keys(PAY).map(function (k) { return '<option value="' + k + '"' + (k === payment ? ' selected' : '') + '>Pagamento: ' + esc(PAY[k]) + '</option>'; }).join('') + '</select>' +
      (estimate.approx ? '<p class="note">Valor aproximado: não foi possível traçar a rota exata agora. O preço final é confirmado ao pedir.</p>' : '') +
      '<button class="btn big" data-act="request"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Pedindo…' : 'Pedir ' + esc(sel.label) + ' · ' + money(sel.price)) + '</button>' +
      '<button class="link block" data-act="back">Voltar</button>';
  }

  function viewRide() {
    var r = ride, html = '<div class="grab"></div>';
    if (r.status === 'searching') {
      html += '<div class="status"><div class="spinner"></div><h2>Procurando motorista…</h2></div>' +
        '<div class="place"><span class="dot k"></span><div class="grow">' + esc(r.to.address) + '</div><b>' + money(r.price) + '</b></div>' +
        '<p class="muted">Estamos chamando os motoristas mais próximos. Isso costuma levar menos de 1 minuto.</p>' +
        '<button class="btn danger" data-act="cancelRide">Cancelar pedido</button>';
    } else if (r.status === 'accepted' || r.status === 'arrived') {
      html += '<h2>' + (r.status === 'arrived' ? '🟢 Seu motorista chegou!' : 'Motorista a caminho') + '</h2>' +
        (r.status === 'accepted' && etaMin ? '<p class="eta">Chega em ~' + etaMin + ' min</p>' : '') +
        (r.driver ? driverCard(r.driver) : '') +
        (r.pin ? '<div class="pin"><span class="muted">Diga este código ao motorista para iniciar</span><b>' + esc(r.pin) + '</b></div>' : '') +
        '<div class="place"><span class="dot k"></span><div class="grow">' + esc(r.to.address) + '</div><b>' + money(r.price) + '</b></div>' +
        '<p class="muted">Pagamento: ' + esc(PAY[r.payment] || r.payment) + '. Confira a placa antes de entrar.</p>' +
        '<button class="btn danger" data-act="cancelRide">Cancelar corrida</button>';
    } else if (r.status === 'ongoing') {
      html += '<h2>Em viagem</h2>' + (etaMin ? '<p class="eta">Faltam ~' + etaMin + ' min</p>' : '') + (r.driver ? driverCard(r.driver) : '') +
        '<div class="place"><span class="dot k"></span><div class="grow"><small>Destino</small>' + esc(r.to.address) + '</div><b>' + money(r.price) + '</b></div>' +
        '<p class="muted">Pagamento: ' + esc(PAY[r.payment] || r.payment) + '. Pague ao motorista ao chegar.</p>';
    }
    return html;
  }

  function viewRate() {
    var r = pendingRating, name = r.driver ? r.driver.name : 'o motorista';
    var s = '';
    for (var i = 1; i <= 5; i++) s += '<button data-act="star" data-n="' + i + '" class="' + (i <= stars ? 'on' : '') + '" aria-label="' + i + ' estrelas">★</button>';
    var pix = r.payment === 'mercadopago_pix' ? (r.payment_status === 'paid' ? '<div id="pix-result"><p class="success">Pagamento Pix confirmado ✅</p></div>' : '<div id="pix-result" class="card-note"><b>Pagamento Pix</b><p>Gere seu QR Code para pagar a CorridaBR com segurança.</p>' + (r.payment_qr_code_base64 ? '<img alt="QR Code Pix" style="display:block;max-width:220px;margin:12px auto" src="data:image/png;base64,' + esc(r.payment_qr_code_base64) + '">' : '') + (r.payment_qr_code ? '<textarea readonly rows="4">' + esc(r.payment_qr_code) + '</textarea><button class="btn" data-act="copyPix">Copiar Pix</button>' : '<input id="pix-email" type="email" placeholder="Seu e-mail para o Mercado Pago" value="' + esc(me && me.email || '') + '"><button class="btn big" data-act="createPix">Gerar Pix / Ver QR Code</button>') + (r.payment_ticket_url ? '<a class="link block" target="_blank" rel="noopener" href="' + esc(r.payment_ticket_url) + '">Abrir Mercado Pago</a>' : '') + '<p class="muted">A confirmação aparece automaticamente após o Mercado Pago confirmar.</p></div>') : '';
    return '<div class="grab"></div><div class="center"><h2>Chegamos! 🎉</h2><p class="muted">Corrida de ' + money(r.price) + ' · ' + esc(PAY[r.payment] || r.payment) + '</p>' + pix +
      '<div class="mid">' + avatarHtml(name, r.driver && r.driver.photo, 'avatar-lg') + '</div><p>Como foi a viagem com <b>' + esc(name) + '</b>?</p><div class="stars">' + s + '</div></div>' +
      '<button class="btn big" data-act="sendRating"' + (stars ? '' : ' disabled') + '>Enviar avaliação</button>' +
      '<button class="link block center" data-act="skipRating">Agora não</button>';
  }

  function render() {
    var v = currentView(), html;
    if (v === 'ride') html = viewRide();
    else if (v === 'rate') html = viewRate();
    else if (v === 'pickOrigin') html = viewPick('origin');
    else if (v === 'pickDest') html = viewPick('dest');
    else if (v === 'choose') html = viewChoose();
    else html = viewIdle();
    $('#sheet').innerHTML = html;
    drawMap();
  }

  /* ---------- eventos do painel ---------- */
  $('#sheet').addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'pickOrigin') { mode = 'pickOrigin'; render(); }
    else if (act === 'pickDest') { mode = 'pickDest'; render(); }
    else if (act === 'cancelPick') { mode = 'idle'; render(); }
    else if (act === 'pick') {
      var r = results[Number(t.getAttribute('data-i'))];
      if (r) { dest = { lat: r.lat, lng: r.lng, address: r.address }; results = []; loadEstimate(); }
    }
    else if (act === 'cat') { category = t.getAttribute('data-cat'); render(); }
    else if (act === 'request') requestRide();
    else if (act === 'back') { mode = 'idle'; dest = null; estimate = null; render(); }
    else if (act === 'cancelRide') {
      if (!confirm('Cancelar esta corrida?')) return;
      api('POST', '/api/rides/' + ride.id + '/cancel').then(function () { ride = null; render(); poll(); }).catch(function (err) { toast(err.message); });
    }
    else if (act === 'createPix') {
      var email = ($('#pix-email') && $('#pix-email').value || '').trim();
      t.disabled = true; t.textContent = 'Gerando Pix…';
      api('POST', '/api/rides/' + pendingRating.id + '/payment/pix', { email: email }).then(function (r) {
        var box = $('#pix-result'); if (!box) return;
        if (r.status === 'paid') { box.innerHTML = '<p class="success">Pagamento já confirmado ✅</p>'; return; }
        box.innerHTML = (r.qr_code_base64 ? '<img alt="QR Code Pix" style="display:block;max-width:220px;margin:12px auto" src="data:image/png;base64,' + esc(r.qr_code_base64) + '">' : '') + '<textarea readonly rows="4">' + esc(r.qr_code || '') + '</textarea><button class="btn" data-act="copyPix">Copiar Pix</button>' + (r.ticket_url ? '<a class="link block" target="_blank" rel="noopener" href="' + esc(r.ticket_url) + '">Abrir Mercado Pago</a>' : '') + '<p class="muted">A confirmação aparece automaticamente após o Mercado Pago confirmar.</p>';
      }).catch(function (err) { toast(err.message); }).then(function () { if (t.isConnected) { t.disabled = false; t.textContent = 'Gerar Pix / Ver QR Code'; } });
    }
    else if (act === 'copyPix') { var q = $('#pix-result textarea'); if (q) { q.select(); document.execCommand('copy'); toast('Código Pix copiado'); } }
    else if (act === 'star') { stars = Number(t.getAttribute('data-n')); render(); }
    else if (act === 'sendRating') {
      var id = pendingRating.id;
      api('POST', '/api/rides/' + id + '/rate', { stars: stars }).then(function () {
        toast('Obrigado pela avaliação!'); pendingRating = null; stars = 0; render();
      }).catch(function (err) { toast(err.message); });
    }
    else if (act === 'skipRating') { skipRating = pendingRating.id; stars = 0; render(); }
  });
  $('#sheet').addEventListener('submit', function (e) {
    if (e.target.getAttribute('data-form') === 'search') { e.preventDefault(); search(); }
  });
  $('#sheet').addEventListener('input', function (e) { if (e.target.id === 'q') query = e.target.value; });
  $('#sheet').addEventListener('change', function (e) { if (e.target.id === 'pay') payment = e.target.value; });

  /* ---------- rota da corrida ---------- */
  function refreshRoute() {
    if (!ride) return;
    var idAt = ride.id, key = ride.id + ':' + ride.status;
    var moving = ride.status === 'accepted' || ride.status === 'ongoing';
    var stale = Date.now() - routeAt > (moving ? 12000 : 60000);
    if (routeBusy || (routeFor === key && !stale)) return;
    routeBusy = true; routeFor = key;
    api('GET', '/api/rides/' + idAt + '/route').then(function (r) {
      if (!ride || ride.id !== idAt || ride.status !== r.status) return;
      routeAt = Date.now();
      drawLegs(r.legs, 'route-' + idAt + '-' + r.status);
      var first = r.legs[0], m = null;
      if (r.status === 'accepted' && first && first.type === 'pickup') m = first.min;
      else if (r.status === 'ongoing' && first) m = first.min;
      if (m !== etaMin) { etaMin = m; render(); }
    }).catch(function () { /* tenta de novo no próximo ciclo */ }).then(function () { routeBusy = false; });
  }

  /* ---------- perfil ---------- */
  function fillProfile() {
    if (!me) return;
    $('#prof-avatar').innerHTML = avatarHtml(me.name, me.photo, 'avatar-lg');
    $('#prof-name').value = me.name;
    $('#prof-phone').textContent = me.phone;
    $('#prof-rating').textContent = me.rating ? '★ ' + me.rating + ' de avaliação' : 'Sem avaliações ainda';
  }
  $('#btn-photo').onclick = $('#prof-avatar').onclick = function () { $('#photo-input').click(); };
  $('#photo-input').onchange = function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toast('Enviando foto…');
    resizePhoto(f, function (err, data) {
      if (err) { toast(err.message || 'Não foi possível usar essa foto'); return; }
      api('POST', '/api/me/photo', { image: data }).then(function (r) { me = r.user; fillProfile(); toast('Foto atualizada'); }).catch(function (er) { toast(er.message); });
    });
  };
  $('#f-name').onsubmit = function (e) {
    e.preventDefault();
    api('POST', '/api/me/profile', { name: $('#prof-name').value }).then(function (r) { me = r.user; fillProfile(); toast('Nome atualizado'); }).catch(function (er) { toast(er.message); });
  };

  /* ---------- menu / histórico ---------- */
  function openMenuTab(tab) {
    fillProfile();
    $('#menu').classList.remove('hidden');
    ['profile','rides'].forEach(function (name) { $('#tab-' + name).classList.toggle('hidden', name !== tab); });
    document.querySelectorAll('[data-menu-tab]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-menu-tab') === tab); });
    if (tab === 'rides') {
      var ul = $('#history'); ul.innerHTML = '<li class="muted">Carregando…</li>';
      api('GET', '/api/rides/history').then(function (r) {
        if (!r.rides.length) { ul.innerHTML = '<li class="muted">Você ainda não fez corridas.</li>'; return; }
        ul.innerHTML = r.rides.map(function (x) {
          var d = new Date(x.date);
          return '<li class="st-' + esc(x.status) + '"><b>' + esc(d.toLocaleDateString('pt-BR')) + '</b> · ' + esc(STATUS_LABEL[x.status] || x.status) +
            (x.status === 'completed' ? ' · ' + money(x.price) : '') + '<br><span class="muted">' + esc(x.from) + ' → ' + esc(x.to) + '</span></li>';
        }).join('');
      }).catch(function (e) { ul.innerHTML = '<li class="muted">' + esc(e.message) + '</li>'; });
    }
  }
  $('#btn-menu').onclick = function () { openMenuTab('profile'); };
  document.querySelectorAll('[data-menu-tab]').forEach(function (b) { b.onclick = function () { openMenuTab(b.getAttribute('data-menu-tab')); }; });
  $('#menu-close').onclick = function () { $('#menu').classList.add('hidden'); };
  $('#menu').addEventListener('click', function (e) { if (e.target === $('#menu')) $('#menu').classList.add('hidden'); });

  /* ------------------------------------------------------------ */
  /* Atualização periódica (polling)                               */
  /* ------------------------------------------------------------ */
  function sigOf(r) {
    if (!r) return 'none';
    return [r.id, r.status, r.payment_status || '', r.payment_qr_code || '', r.pin, r.driver ? r.driver.name : '', r.driver ? r.driver.rating : '', r.driver ? r.driver.photo : '', etaMin].join('|');
  }

  var polling = false;
  function poll() {
    if (!token || polling) return;
    polling = true;
    api('GET', '/api/passenger/state').then(function (s) {
      var prev = ride;
      ride = s.active;
      pendingRating = s.pending_rating;
      if (s.last_ended && s.last_ended.status === 'no_driver') toast('Não encontramos motorista agora. Tente de novo em instantes.');
      if (prev && !ride && !pendingRating) toast('A corrida foi encerrada.');
      if (!ride) { etaMin = null; routeFor = ''; } else refreshRoute();
      var sig = sigOf(ride) + '#' + (pendingRating ? pendingRating.id + ':' + (pendingRating.payment_status || '') : '');
      if (sig !== rideSig) { rideSig = sig; if (ride) { dest = null; estimate = null; mode = 'idle'; } render(); }
      else drawMap(); // só atualiza a posição do carro no mapa
    }).catch(function () { /* mantém o estado; tenta de novo no próximo ciclo */ }).then(function () { polling = false; });
  }

  /* ------------------------------------------------------------ */
  /* Início                                                        */
  /* ------------------------------------------------------------ */
  function startApp() {
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    initMap();
    map.invalidateSize();
    startGps();
    render();
    poll();
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, 3000);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  function boot() {
    if (!L) { document.body.innerHTML = '<p style="padding:24px">Mapa não carregou. Rode "npm install" na pasta do app para copiar o Leaflet para www/lib.</p>'; return; }
    if (!token) { showAuth(); return; }
    api('GET', '/api/me').then(function (r) { me = r.user; startApp(); }, function (e) {
      if (token) { toast(e.message); showAuth(); }
    });
  }
  boot();
})();
