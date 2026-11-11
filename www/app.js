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
  var lastFitKey = '';
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
    if (!map || lastFitKey === key) return;
    lastFitKey = key;
    var pts = points.filter(Boolean);
    if (!pts.length) return;
    if (pts.length === 1) { map.setView(pts[0], 16); return; }
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 80], paddingBottomRight: [40, $('#sheet').offsetHeight + 30], maxZoom: 17 });
  }

  function drawMap() {
    if (!map || !state) return;
    setMarker('me', ll(pos), icon('mk mk-me', 18));
    var a = state.active, o = state.offer;
    if (a) {
      var toPickup = a.status === 'accepted' || a.status === 'arrived';
      setMarker('from', toPickup ? ll(a.from) : null, icon('mk mk-from', 16));
      setMarker('to', a.status === 'ongoing' ? ll(a.to) : null, icon('mk mk-to', 16));
      fit([ll(pos), toPickup ? ll(a.from) : ll(a.to)], 'a' + a.id + a.status);
    } else if (o) {
      setMarker('from', ll(o.from), icon('mk mk-from', 16));
      setMarker('to', ll(o.to), icon('mk mk-to', 16));
      fit([ll(pos), ll(o.from), ll(o.to)], 'o' + o.id);
    } else {
      setMarker('from', null); setMarker('to', null);
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
      pos = { lat: p.coords.latitude, lng: p.coords.longitude };
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
    var kpis = '<div class="kpis">' + stat('corridas hoje', t.rides) + stat('ganhos hoje', money(t.earnings)) + (p.rating ? stat('avaliação', '★ ' + p.rating) : '') + '</div>';
    if (!p.online) {
      return '<div class="grab"></div><h2>Você está offline <span class="chip off">offline</span></h2>' + kpis +
        '<button class="btn big ok" data-act="online"' + (busy ? ' disabled' : '') + '>Ficar online</button>';
    }
    return '<div class="grab"></div><div class="status"><div class="spinner"></div><div class="grow"><h2>Procurando corridas…</h2><span class="chip on">online</span></div></div>' + kpis +
      (pos ? '' : '<p class="note">Aguardando o sinal do GPS…</p>') +
      '<p class="muted">Mantenha o app aberto e a tela ligada para receber chamadas.</p>' +
      '<button class="btn ghost" data-act="offline">Ficar offline</button>';
  }

  function viewOffer(o) {
    return '<div class="grab"></div><div class="offer-head"><div><span class="muted">Ganho estimado</span><div class="big-money">' + money(o.earnings) + '</div></div>' +
      '<div class="timer" id="timer">' + Math.max(0, Math.ceil((offerDeadline - Date.now()) / 1000)) + '</div></div>' +
      '<div class="sum"><span>' + Number(o.km).toFixed(1).replace('.', ',') + ' km</span><span>~' + o.min + ' min</span><span>' + esc(PAY[o.payment] || o.payment) + '</span>' +
      (o.passenger && o.passenger.rating ? '<span>★ ' + esc(o.passenger.rating) + '</span>' : '') + '</div>' +
      '<div class="place"><span class="dot g"></span><div class="grow"><small>Embarque' + (o.pickup_km != null ? ' · a ' + Number(o.pickup_km).toFixed(1).replace('.', ',') + ' km de você' : '') + '</small>' + esc(o.from.address) + '</div></div>' +
      '<div class="place"><span class="dot k"></span><div class="grow"><small>Destino</small>' + esc(o.to.address) + '</div></div>' +
      '<div class="row2"><button class="btn outline" data-act="decline">Recusar</button><button class="btn ok" data-act="accept">Aceitar</button></div>';
  }

  function viewActive(a) {
    var pax = a.passenger || {};
    var call = pax.phone ? '<a class="call" href="tel:' + esc(String(pax.phone).replace(/\D/g, '')) + '">Ligar</a>' : '';
    var who = '<div class="driver"><div class="avatar">' + esc((pax.name || '?').charAt(0).toUpperCase()) + '</div><div class="grow"><b>' + esc(pax.name) + '</b>' +
      (pax.rating ? ' <span class="muted">★ ' + esc(pax.rating) + '</span>' : '') + '<div class="muted">' + esc(PAY[a.payment] || a.payment) + ' · ' + money(a.price) + '</div></div>' + call + '</div>';
    if (a.status === 'accepted') {
      return '<div class="grab"></div><h2>Vá até o passageiro</h2>' + who +
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
    return '<div class="grab"></div><h2>Em viagem</h2>' + who +
      '<div class="place"><span class="dot k"></span><div class="grow"><small>Destino</small>' + esc(a.to.address) + '</div><a class="nav" target="_blank" rel="noopener" href="' + navUrl(a.to) + '">Navegar</a></div>' +
      '<div class="card-note">Ao chegar, receba <b>' + money(a.price) + '</b> do passageiro (' + esc(PAY[a.payment] || a.payment) + '). Você fica com ' + money(a.earnings) + '.</div>' +
      '<button class="btn big ok" data-act="finish"' + (busy ? ' disabled' : '') + '>Finalizar corrida</button>';
  }

  function viewRate(r) {
    var s = '';
    for (var i = 1; i <= 5; i++) s += '<button data-act="star" data-n="' + i + '" class="' + (i <= stars ? 'on' : '') + '" aria-label="' + i + ' estrelas">★</button>';
    return '<div class="grab"></div><div class="center"><h2>Corrida finalizada ✅</h2><div class="big-money">' + money(r.earnings) + '</div>' +
      '<p class="muted">Valor da corrida: ' + money(r.price) + ' · ' + esc(PAY[r.payment] || r.payment) + '</p>' +
      '<p>Como foi o passageiro <b>' + esc(r.passenger ? r.passenger.name : '') + '</b>?</p><div class="stars">' + s + '</div></div>' +
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
    if (a === 'online') {
      unlockAudio();
      if (!pos) { toast('Aguarde o GPS encontrar sua localização'); return; }
      act('online', function () { return api('POST', '/api/driver/online', { online: true, lat: pos.lat, lng: pos.lng }).then(function (s) { state = s; keepAwake(); }); });
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

  /* ---------- menu ---------- */
  $('#btn-menu').onclick = function () {
    var p = state && state.profile;
    $('#menu-name').textContent = p ? p.name : '';
    var v = p && p.vehicle ? p.vehicle : {};
    $('#menu-vehicle').textContent = p ? [v.model, v.color, v.plate].filter(Boolean).join(' · ') : '';
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
    return [p.status, p.online, p.rating, a ? a.id + a.status : '', o ? o.id : '', s.pending_rating ? s.pending_rating.id : '', s.today.rides].join('|');
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
  }

  function refresh() {
    if (!token) return Promise.resolve();
    var p = (state && state.profile.online && pos)
      ? api('POST', '/api/driver/ping', { lat: pos.lat, lng: pos.lng })
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
