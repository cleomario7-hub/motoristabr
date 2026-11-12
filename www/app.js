(function () {
  'use strict';

  /* ------------------------------------------------------------ */
  /* Utilidades                                                    */
  /* ------------------------------------------------------------ */
  var API = String(window.BRCORRIDA_API || '').replace(/\/$/, '');
  var $ = function (s) { return document.querySelector(s); };
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function money(n) { return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ','); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sem storage */ } return null; }

  var PAY = { dinheiro: 'Dinheiro', pix_motorista: 'Pix direto do passageiro' };
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
  var token = store('brd_token') || '';
  var L = window.L;
  var map = null;
  var pos = null;
  var state = null; // {profile, active, offer, pending_rating, today}
  var stars = 0;
  var skipRating = null;
  var busy = false;
  var markers = {};
  var fitted = {};
  var heading = null; // direção do carro (graus)
  var etaMin = null;
  var routeFor = '';
  var routeAt = 0;
  var routeBusy = false;
  var pollTimer = null;
  var polling = false;
  var sig = '';
  var seenOffer = null;
  var offerDeadline = 0;
  var audioCtx = null;
  var wakeLock = null;
  var pinValue = '';

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

  function submitAuth(e, path, isRegister) {
    e.preventDefault();
    var f = e.target;
    var btn = f.querySelector('button[type=submit]');
    var raw = {};
    new FormData(f).forEach(function (v, k) { raw[k] = v; });
    var body = { role: 'driver', phone: raw.phone, password: raw.password };
    if (isRegister) {
      body.name = raw.name;
      body.city = raw.city;
      body.vehicle = { category: raw.category, model: raw.model, color: raw.color, plate: raw.plate };
    }
    btn.disabled = true;
    $('#auth-error').textContent = '';
    api('POST', path, body).then(function (r) {
      token = r.token;
      store('brd_token', token);
      f.reset();
      startApp();
    }).catch(function (err) {
      $('#auth-error').textContent = err.message;
    }).then(function () { btn.disabled = false; });
  }
  $('#f-login').onsubmit = function (e) { submitAuth(e, '/api/auth/login', false); };
  $('#f-register').onsubmit = function (e) { submitAuth(e, '/api/auth/register', true); };

  function logout() {
    token = '';
    state = null;
    store('brd_token', null);
    releaseWake();
    showAuth();
  }
  $('#btn-logout').onclick = function () {
    if (state && state.active) { toast('Finalize a corrida antes de sair.'); return; }
    if (state && state.profile.online) {
      api('POST', '/api/driver/online', { online: false }).catch(function () {});
    }
    $('#menu').classList.add('hidden');
    logout();
  };

  /* ------------------------------------------------------------ */
  /* Som, vibração e tela ligada                                   */
  /* ------------------------------------------------------------ */
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioCtx) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* sem áudio */ }
  }
  function beep() {
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) { /* ok */ }
    if (!audioCtx) return;
    try {
      [0, 0.35, 0.7].forEach(function (t) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.value = 0.25;
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.22);
      });
    } catch (e) { /* ok */ }
  }
  function keepAwake() {
    try {
      if (navigator.wakeLock && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) {
          wakeLock = l;
          l.addEventListener('release', function () { wakeLock = null; });
        }, function () {});
      }
    } catch (e) { /* sem wake lock */ }
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ok */ } wakeLock = null; }

  /* ------------------------------------------------------------ */
  /* Mapa e GPS                                                    */
  /* ------------------------------------------------------------ */
  function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false }).setView(window.BRCORRIDA_CENTER || [-15.79, -47.88], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  }
  function icon(cls, size) {
    return L.divIcon({ className: '', html: '<div class="' + cls + '"></div>', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }
  function setMarker(key, latlng, ic) {
    if (!latlng) { if (markers[key]) { map.removeLayer(markers[key]); delete markers[key]; } return; }
    if (markers[key]) { markers[key].setLatLng(latlng); markers[key].setIcon(ic); }
    else markers[key] = L.marker(latlng, { icon: ic, interactive: false }).addTo(map);
  }
  function ll(p) { return p ? [p.lat, p.lng] : null; }
  function fit(points, key) {
    if (!map || fitted[key]) return;
    var pts = points.filter(Boolean);
    if (!pts.length) return;
    fitted[key] = true;
    if (pts.length === 1) { map.setView(pts[0], 16); return; }
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 80], paddingBottomRight: [40, $('#sheet').offsetHeight + 30], maxZoom: 17 });
  }

  function drawMap() {
    if (!map || !state) return;
    var v = state.profile && state.profile.vehicle;
    setCar('me', ll(pos), heading, v ? v.category : 'carro', false); // o próprio carro do motorista
    var a = state.active, o = state.offer;
    if (a) {
      var toPickup = a.status === 'accepted' || a.status === 'arrived';
      setMarker('from', toPickup ? ll(a.from) : null, icon('mk mk-from', 16));
      setMarker('to', a.status === 'ongoing' ? ll(a.to) : null, icon('mk mk-to', 16));
      if (pos) fit([ll(pos), toPickup ? ll(a.from) : ll(a.to)], 'a' + a.id + a.status);
    } else if (o) {
      setMarker('from', ll(o.from), icon('mk mk-from', 16));
      setMarker('to', ll(o.to), icon('mk mk-to', 16));
      if (pos) fit([ll(pos), ll(o.from), ll(o.to)], 'o' + o.id);
    } else {
      setMarker('from', null); setMarker('to', null);
      clearRoute();
    }
  }
  $('#btn-locate').onclick = function () {
    if (pos && map) map.setView([pos.lat, pos.lng], 16); else toast('Procurando sua localização…');
  };

  var gpsStarted = false;
  function startGps() {
    if (gpsStarted) return;
    gpsStarted = true;
    if (!navigator.geolocation) { toast('Este aparelho não tem GPS'); return; }
    navigator.geolocation.watchPosition(function (p) {
      var first = !pos;
      var np = { lat: p.coords.latitude, lng: p.coords.longitude };
      var hd = p.coords.heading;
      if (hd != null && isFinite(hd) && (p.coords.speed == null || p.coords.speed > 1)) heading = Math.round(hd);
      else if (pos && distKm(pos, np) > 0.008) heading = bearingDeg(pos, np);
      pos = np;
      if (first && map) map.setView([pos.lat, pos.lng], 15);
      drawMap();
    }, function (err) {
      if (err && err.code === 1) toast('Ative a permissão de localização para dirigir');
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
  }

  /* ------------------------------------------------------------ */
  /* Telas                                                         */
  /* ------------------------------------------------------------ */
  function navUrl(p) { return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + p.lat + ',' + p.lng; }
  function stat(label, value) { return '<div class="kpi"><b>' + value + '</b><span>' + label + '</span></div>'; }

  function viewPending(p) {
    var v = p.vehicle || {};
    if (p.status === 'blocked') {
      return '<div class="grab"></div><h2>Conta bloqueada</h2><p class="muted">Seu acesso foi suspenso. Entre em contato com o suporte.</p>';
    }
    return '<div class="grab"></div><h2>Cadastro em análise ⏳</h2>' +
      '<p class="muted">Recebemos seus dados. Assim que a equipe aprovar, você poderá ficar online e receber corridas. Abra o app de novo mais tarde.</p>' +
      '<div class="card-note">' + esc(v.model) + ' · ' + esc(v.color) + ' · <b>' + esc(v.plate) + '</b></div>';
  }

  function viewHome(p) {
    var t = state.today;
    var nudge = p.photo ? '' : '<div class="card-note" data-act="openProfile">📷 Adicione sua foto de perfil: os passageiros confiam mais em motoristas com foto. <b>Toque aqui</b>.</div>';
    var kpis = '<div class="kpis">' + stat('corridas hoje', t.rides) + stat('ganhos hoje', money(t.earnings)) + (p.rating ? stat('avaliação', '★ ' + p.rating) : '') + '</div>';
    if (!p.online) {
      return '<div class="grab"></div><h2>Você está offline <span class="chip off">offline</span></h2>' + nudge + kpis +
        '<button class="btn big ok" data-act="online"' + (busy ? ' disabled' : '') + '>Ficar online</button>';
    }
    return '<div class="grab"></div><div class="status"><div class="spinner"></div><div class="grow"><h2>Procurando corridas…</h2><span class="chip on">online</span></div></div>' + nudge + kpis +
      (pos ? '' : '<p class="note">Aguardando o sinal do GPS…</p>') +
      '<p class="muted">Mantenha o app aberto e a tela ligada para receber chamadas.</p>' +
      '<button class="btn ghost" data-act="offline">Ficar offline</button>';
  }

  function viewOffer(o) {
    return '<div class="grab"></div><div class="offer-head"><div><span class="muted">Ganho estimado</span><div class="big-money">' + money(o.earnings) + '</div></div>' +
      '<div class="timer" id="timer">' + Math.max(0, Math.ceil((offerDeadline - Date.now()) / 1000)) + '</div></div>' +
      '<div class="pax-row">' + avatarHtml(o.passenger && o.passenger.name, o.passenger && o.passenger.photo, 'avatar') + '<b>' + esc(o.passenger ? o.passenger.name : '') + '</b>' + (o.passenger && o.passenger.rating ? '<span class="muted">★ ' + esc(o.passenger.rating) + '</span>' : '') + '</div>' +
      '<div class="sum"><span>' + Number(o.km).toFixed(1).replace('.', ',') + ' km</span><span>~' + o.min + ' min</span><span>' + esc(PAY[o.payment] || o.payment) + '</span>' +
      (o.passenger && o.passenger.rating ? '<span>★ ' + esc(o.passenger.rating) + '</span>' : '') + '</div>' +
      '<div class="place"><span class="dot g"></span><div class="grow"><small>Embarque' + (o.pickup_km != null ? ' · a ' + Number(o.pickup_km).toFixed(1).replace('.', ',') + ' km de você' : '') + '</small>' + esc(o.from.address) + '</div></div>' +
      '<div class="place"><span class="dot k"></span><div class="grow"><small>Destino</small>' + esc(o.to.address) + '</div></div>' +
      '<div class="row2"><button class="btn outline" data-act="decline">Recusar</button><button class="btn ok" data-act="accept">Aceitar</button></div>';
  }

  function viewActive(a) {
    var pax = a.passenger || {};
    var call = pax.phone ? '<a class="call" href="tel:' + esc(String(pax.phone).replace(/\D/g, '')) + '">Ligar</a>' : '';
    var who = '<div class="driver">' + avatarHtml(pax.name, pax.photo, 'avatar') + '<div class="grow"><b>' + esc(pax.name) + '</b>' +
      (pax.rating ? ' <span class="muted">★ ' + esc(pax.rating) + '</span>' : '') + '<div class="muted">' + esc(PAY[a.payment] || a.payment) + ' · ' + money(a.price) + '</div></div>' + call + '</div>';
    if (a.status === 'accepted') {
      return '<div class="grab"></div><h2>Vá até o passageiro</h2>' + (etaMin ? '<p class="eta">Embarque a ~' + etaMin + ' min</p>' : '') + who +
        '<div class="place"><span class="dot g"></span><div class="grow"><small>Embarque</small>' + esc(a.from.address) + '</div><a class="nav" target="_blank" rel="noopener" href="' + navUrl(a.from) + '">Navegar</a></div>' +
        '<button class="btn big ok" data-act="arrived"' + (busy ? ' disabled' : '') + '>Cheguei ao local</button>' +
        '<button class="btn danger" data-act="cancelRide">Cancelar corrida</button>';
    }
    if (a.status === 'arrived') {
      return '<div class="grab"></div><h2>Aguardando o passageiro</h2>' + who +
        (a.pin_required
          ? '<p class="muted">Peça o código de 4 dígitos que aparece no app do passageiro.</p><input id="pin" class="pin-in" inputmode="numeric" maxlength="4" placeholder="••••" value="' + esc(pinValue) + '" autocomplete="off">'
          : '') +
        '<button class="btn big ok" data-act="start"' + (busy ? ' disabled' : '') + '>Iniciar corrida</button>' +
        '<button class="btn danger" data-act="cancelRide">Cancelar corrida</button>';
    }
    return '<div class="grab"></div><h2>Em viagem</h2>' + (etaMin ? '<p class="eta">Faltam ~' + etaMin + ' min</p>' : '') + who +
      '<div class="place"><span class="dot k"></span><div class="grow"><small>Destino</small>' + esc(a.to.address) + '</div><a class="nav" target="_blank" rel="noopener" href="' + navUrl(a.to) + '">Navegar</a></div>' +
      '<div class="card-note">Ao chegar, receba <b>' + money(a.price) + '</b> do passageiro (' + esc(PAY[a.payment] || a.payment) + '). Você fica com ' + money(a.earnings) + '.</div>' +
      '<button class="btn big ok" data-act="finish"' + (busy ? ' disabled' : '') + '>Finalizar corrida</button>';
  }

  function viewRate(r) {
    var s = '';
    for (var i = 1; i <= 5; i++) s += '<button data-act="star" data-n="' + i + '" class="' + (i <= stars ? 'on' : '') + '" aria-label="' + i + ' estrelas">★</button>';
    return '<div class="grab"></div><div class="center"><h2>Corrida finalizada ✅</h2><div class="big-money">' + money(r.earnings) + '</div>' +
      '<p class="muted">Valor da corrida: ' + money(r.price) + ' · ' + esc(PAY[r.payment] || r.payment) + '</p>' +
      '<div class="mid">' + avatarHtml(r.passenger && r.passenger.name, r.passenger && r.passenger.photo, 'avatar-lg') + '</div><p>Como foi o passageiro <b>' + esc(r.passenger ? r.passenger.name : '') + '</b>?</p><div class="stars">' + s + '</div></div>' +
      '<button class="btn big" data-act="sendRating"' + (stars ? '' : ' disabled') + '>Enviar avaliação</button>' +
      '<button class="link block center" data-act="skipRating">Agora não</button>';
  }

  function render() {
    if (!state) return;
    var p = state.profile, html;
    if (p.status !== 'approved') html = viewPending(p);
    else if (state.active) html = viewActive(state.active);
    else if (state.offer) html = viewOffer(state.offer);
    else if (state.pending_rating && state.pending_rating.id !== skipRating) html = viewRate(state.pending_rating);
    else html = viewHome(p);
    $('#sheet').innerHTML = html;
    $('#earn').textContent = money(state.today.earnings) + ' hoje';
    drawMap();
  }

  /* ---------- eventos ---------- */
  function act(label, fn) {
    if (busy) return;
    busy = true; render();
    fn().catch(function (e) { toast(e.message); }).then(function () { busy = false; render(); return refresh(); });
  }

  $('#sheet').addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var a = t.getAttribute('data-act');
    var ride = state && (state.active || state.offer);
    if (a === 'openProfile') { $('#btn-menu').click(); return; }
    if (a === 'online') {
      unlockAudio();
      if (!pos) { toast('Aguarde o GPS encontrar sua localização'); return; }
      act('online', function () { return api('POST', '/api/driver/online', { online: true, lat: pos.lat, lng: pos.lng, heading: heading }).then(function (s) { state = s; keepAwake(); }); });
    } else if (a === 'offline') {
      act('offline', function () { return api('POST', '/api/driver/online', { online: false }).then(function (s) { state = s; releaseWake(); }); });
    } else if (a === 'accept') {
      act('accept', function () { return api('POST', '/api/rides/' + ride.id + '/accept'); });
    } else if (a === 'decline') {
      act('decline', function () { return api('POST', '/api/rides/' + ride.id + '/decline'); });
    } else if (a === 'arrived') {
      act('arrived', function () { return api('POST', '/api/rides/' + ride.id + '/arrived'); });
    } else if (a === 'start') {
      act('start', function () { return api('POST', '/api/rides/' + ride.id + '/start', { pin: pinValue }).then(function () { pinValue = ''; }); });
    } else if (a === 'finish') {
      if (!confirm('Finalizar a corrida? Confirme que chegou ao destino.')) return;
      act('finish', function () { return api('POST', '/api/rides/' + ride.id + '/finish'); });
    } else if (a === 'cancelRide') {
      if (!confirm('Cancelar esta corrida? Cancelamentos frequentes podem afetar sua conta.')) return;
      act('cancel', function () { return api('POST', '/api/rides/' + ride.id + '/cancel'); });
    } else if (a === 'star') { stars = Number(t.getAttribute('data-n')); render(); }
    else if (a === 'sendRating') {
      var id = state.pending_rating.id;
      api('POST', '/api/rides/' + id + '/rate', { stars: stars }).then(function () { toast('Avaliação enviada'); stars = 0; return refresh(); }).catch(function (err) { toast(err.message); });
    } else if (a === 'skipRating') { skipRating = state.pending_rating.id; stars = 0; render(); }
  });
  $('#sheet').addEventListener('input', function (e) {
    if (e.target.id === 'pin') { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); pinValue = e.target.value; }
  });

  /* ---------- rota da corrida ---------- */
  function refreshRoute() {
    var rr = state && (state.active || state.offer);
    if (!rr) { routeFor = ''; etaMin = null; return; }
    var st = state.active ? state.active.status : 'searching';
    var idAt = rr.id, key = rr.id + ':' + st;
    var moving = st === 'accepted' || st === 'ongoing' || st === 'searching';
    var stale = Date.now() - routeAt > (moving ? 12000 : 60000);
    if (routeBusy || (routeFor === key && !stale)) return;
    routeBusy = true; routeFor = key;
    api('GET', '/api/rides/' + idAt + '/route').then(function (r) {
      var cur = state && (state.active || state.offer);
      if (!cur || cur.id !== idAt) return;
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
    var p = state && state.profile;
    if (!p) return;
    var v = p.vehicle || {};
    $('#prof-avatar').innerHTML = avatarHtml(p.name, p.photo, 'avatar-lg');
    $('#prof-name').value = p.name;
    $('#prof-phone').textContent = p.phone;
    $('#prof-rating').textContent = p.rating ? '★ ' + p.rating + ' de avaliação' : 'Sem avaliações ainda';
    $('#prof-vehicle').textContent = [v.model, v.color, v.plate].filter(Boolean).join(' · ');
  }
  $('#btn-photo').onclick = $('#prof-avatar').onclick = function () { $('#photo-input').click(); };
  $('#photo-input').onchange = function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toast('Enviando foto…');
    resizePhoto(f, function (err, data) {
      if (err) { toast(err.message || 'Não foi possível usar essa foto'); return; }
      api('POST', '/api/me/photo', { image: data }).then(function (r) { state.profile = r.user; fillProfile(); sig = ''; render(); toast('Foto atualizada'); }).catch(function (er) { toast(er.message); });
    });
  };
  $('#f-name').onsubmit = function (e) {
    e.preventDefault();
    api('POST', '/api/me/profile', { name: $('#prof-name').value }).then(function (r) { state.profile = r.user; fillProfile(); toast('Nome atualizado'); }).catch(function (er) { toast(er.message); });
  };

  /* ---------- menu ---------- */
  $('#btn-menu').onclick = function () {
    fillProfile();
    $('#menu').classList.remove('hidden');
    var box = $('#earnings'), ul = $('#history');
    box.textContent = 'Carregando…';
    ul.innerHTML = '';
    api('GET', '/api/driver/earnings').then(function (r) {
      box.innerHTML = '<div class="kpis">' + stat('hoje', money(r.today.earnings)) + stat('7 dias', money(r.week.earnings)) + stat('total', money(r.total.earnings)) + '</div>' +
        '<div class="card-note">A repassar à plataforma (comissão de ' + esc(r.commission_pct) + '%): <b>' + money(r.owed) + '</b><br>Você recebe o valor total direto do passageiro; a comissão é acertada com a equipe.</div>';
    }).catch(function (e) { box.textContent = e.message; });
    api('GET', '/api/rides/history').then(function (r) {
      ul.innerHTML = r.rides.length ? r.rides.map(function (x) {
        return '<li class="st-' + esc(x.status) + '"><b>' + esc(new Date(x.date).toLocaleDateString('pt-BR')) + '</b> · ' + esc(STATUS_LABEL[x.status] || x.status) +
          (x.status === 'completed' ? ' · ' + money(x.earnings) : '') + '<br><span class="muted">' + esc(x.from) + ' → ' + esc(x.to) + '</span></li>';
      }).join('') : '<li class="muted">Nenhuma corrida ainda.</li>';
    }).catch(function () {});
  };
  $('#menu-close').onclick = function () { $('#menu').classList.add('hidden'); };
  $('#menu').addEventListener('click', function (e) { if (e.target === $('#menu')) $('#menu').classList.add('hidden'); });

  /* ------------------------------------------------------------ */
  /* Atualização periódica                                         */
  /* ------------------------------------------------------------ */
  function stateSig(s) {
    var a = s.active, o = s.offer, p = s.profile;
    return [p.status, p.online, p.rating, p.photo, a ? a.id + a.status : '', o ? o.id : '', s.pending_rating ? s.pending_rating.id : '', s.today.rides, etaMin].join('|');
  }

  function applyState(s) {
    var prev = state;
    state = s;
    if (!s.offer) seenOffer = null; // permite nova oferta da mesma corrida depois
    if (s.offer && seenOffer !== s.offer.id) {
      seenOffer = s.offer.id;
      offerDeadline = Date.now() + s.offer.expires_in * 1000;
      beep();
    }
    if (prev && prev.active && !s.active && !s.pending_rating) toast('A corrida foi encerrada.');
    var ns = stateSig(s);
    if (ns !== sig) { sig = ns; render(); } else drawMap();
    if (s.profile.online) keepAwake();
    refreshRoute();
  }

  function refresh() {
    if (!token) return Promise.resolve();
    var p = (state && state.profile.online && pos)
      ? api('POST', '/api/driver/ping', { lat: pos.lat, lng: pos.lng, heading: heading })
      : api('GET', '/api/driver/state');
    return p.then(applyState, function () { /* tenta no próximo ciclo */ });
  }

  function tick() {
    if (polling) return;
    polling = true;
    refresh().then(function () { polling = false; });
  }

  // contagem regressiva da oferta (sem re-renderizar a tela toda)
  setInterval(function () {
    var el = $('#timer');
    if (!el || !state || !state.offer) return;
    var left = Math.max(0, Math.ceil((offerDeadline - Date.now()) / 1000));
    el.textContent = left;
    if (left === 0) { state.offer = null; sig = ''; render(); tick(); }
  }, 500);

  /* ------------------------------------------------------------ */
  /* Início                                                        */
  /* ------------------------------------------------------------ */
  function startApp() {
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    initMap();
    map.invalidateSize();
    startGps();
    sig = '';
    api('GET', '/api/driver/state').then(function (s) {
      applyState(s);
      render();
    }).catch(function (e) { toast(e.message); });
    clearInterval(pollTimer);
    pollTimer = setInterval(tick, 4000);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); if (state && state.profile.online) keepAwake(); } });

  function boot() {
    if (!L) { document.body.innerHTML = '<p style="padding:24px">Mapa não carregou. Rode "npm install" na pasta do app para copiar o Leaflet para www/lib.</p>'; return; }
    if (!token) { showAuth(); return; }
    startApp();
  }
  boot();
})();
