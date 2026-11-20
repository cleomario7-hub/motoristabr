/* Chat entre passageiro e motorista durante a corrida.
   Uso: CBRChat.init({ api: api, role: 'passenger' | 'driver', onIncoming: fn })
        CBRChat.setRide(idDaCorridaAtiva | null)   // chamar a cada atualização do estado
        CBRChat.buttonHtml()                       // botão "Mensagem" para colocar na tela da corrida
        CBRChat.open() / CBRChat.refresh()
   Endpoints esperados no servidor: veja BACKEND-CHAT.md */
(function () {
  'use strict';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  var QUICK = {
    driver: ['Estou a caminho', 'Cheguei ao local', 'Estou aguardando aqui', 'Pode me ligar?'],
    passenger: ['Já estou indo até você', 'Já estou no local', 'Pode aguardar um minutinho?', 'Pode me ligar?']
  };

  var cfg = null, role = 'passenger', rideId = null, msgs = [], seenId = 0, unread = 0;
  var isOpen = false, timer = null, busy = false, sending = false, fails = 0, root = null;

  function lastId() { return msgs.length ? msgs[msgs.length - 1].id : 0; }
  function hhmm(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function toast(m) { var t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 3500); }

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'chat';
    root.className = 'chat hidden';
    root.innerHTML =
      '<div class="chat-panel">' +
        '<div class="chat-head"><b>Mensagens</b><button type="button" class="link" id="chat-close">Fechar</button></div>' +
        '<div class="chat-list" id="chat-list"></div>' +
        '<div class="chat-quick" id="chat-quick"></div>' +
        '<form class="chat-form" id="chat-form" autocomplete="off">' +
          '<input id="chat-input" type="text" maxlength="500" placeholder="Escreva uma mensagem" enterkeyhint="send">' +
          '<button class="btn" type="submit" id="chat-send">Enviar</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    root.querySelector('#chat-close').onclick = close;
    root.querySelector('#chat-form').onsubmit = function (e) {
      e.preventDefault();
      var inp = root.querySelector('#chat-input');
      send(inp.value, function () { inp.value = ''; });
    };
    root.querySelector('#chat-quick').innerHTML = (QUICK[role] || []).map(function (q, i) {
      return '<button type="button" class="qchip" data-q="' + i + '">' + esc(q) + '</button>';
    }).join('');
    root.querySelector('#chat-quick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]');
      if (b) send(QUICK[role][Number(b.getAttribute('data-q'))]);
    });
  }

  function renderList() {
    if (!root) return;
    var list = root.querySelector('#chat-list');
    var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.innerHTML = msgs.length ? msgs.map(function (m) {
      var mine = m.from === role;
      return '<div class="msg ' + (mine ? 'me' : 'other') + '"><div class="bubble">' + esc(m.text) + '</div><span class="mt">' + esc(hhmm(m.created_at)) + '</span></div>';
    }).join('') : '<p class="muted chat-empty">Nenhuma mensagem ainda. Use um atalho abaixo ou escreva a sua.</p>';
    if (nearBottom || !list.dataset.init) { list.scrollTop = list.scrollHeight; list.dataset.init = '1'; }
  }

  function badge() {
    var els = document.querySelectorAll('[data-chat-badge]');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = unread > 99 ? '99+' : String(unread);
      els[i].classList.toggle('hidden', unread === 0);
    }
  }

  function merge(list) {
    var added = 0, incoming = 0;
    (list || []).forEach(function (m) {
      if (!m || m.id == null || m.id <= lastId()) return;
      msgs.push(m); added++;
      if (m.from !== role && m.id > seenId) incoming++;
    });
    return { added: added, incoming: incoming };
  }

  function poll() {
    if (!cfg || !rideId || busy) return Promise.resolve();
    busy = true;
    var id = rideId;
    return cfg.api('GET', '/api/rides/' + id + '/messages?after=' + lastId()).then(function (r) {
      if (id !== rideId) return;
      fails = 0;
      var res = merge(r.messages);
      if (isOpen) {
        seenId = lastId(); unread = 0;
        if (res.added) renderList();
      } else if (res.incoming) {
        unread += res.incoming;
        var last = msgs[msgs.length - 1];
        toast('💬 ' + String(last.text).slice(0, 80));
        try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) { /* ok */ }
        if (cfg.onIncoming) cfg.onIncoming();
      }
      badge();
    }).catch(function () { fails++; }).then(function () { busy = false; });
  }

  function loop() {
    clearTimeout(timer);
    if (!rideId) return;
    timer = setTimeout(function () { poll().then(loop); }, fails >= 5 ? 20000 : (isOpen ? 2000 : 3500));
  }

  function send(text, ok) {
    text = String(text || '').trim();
    if (!text || sending || !rideId) return;
    sending = true;
    var id = rideId, btn = root && root.querySelector('#chat-send');
    if (btn) btn.disabled = true;
    cfg.api('POST', '/api/rides/' + id + '/messages', { text: text }).then(function (r) {
      if (id !== rideId) return;
      if (r && r.message) merge([r.message]);
      seenId = lastId();
      if (ok) ok();
      renderList();
    }).catch(function (e) {
      toast(/\((404|405)\)/.test(e.message) ? 'O chat ainda não está disponível no servidor' : e.message);
    }).then(function () { sending = false; if (btn) btn.disabled = false; });
  }

  function open() {
    if (!cfg || !rideId) return;
    build();
    isOpen = true;
    root.classList.remove('hidden');
    seenId = lastId(); unread = 0; badge();
    renderList();
    poll().then(loop);
    setTimeout(function () { var i = root.querySelector('#chat-input'); if (i) i.focus(); }, 150);
  }
  function close() {
    isOpen = false;
    if (root) root.classList.add('hidden');
    seenId = lastId(); unread = 0; badge();
    loop();
  }

  window.CBRChat = {
    init: function (c) { cfg = c; role = c.role || 'passenger'; },
    setRide: function (id) {
      id = id || null;
      if (id === rideId) return;
      rideId = id; msgs = []; seenId = 0; unread = 0; fails = 0;
      if (!id) { clearTimeout(timer); isOpen = false; if (root) root.classList.add('hidden'); badge(); return; }
      poll().then(loop);
    },
    refresh: function () { poll(); },
    open: open,
    buttonHtml: function () {
      return '<button type="button" class="chatbtn" data-act="openChat">💬 Enviar mensagem' +
        '<span class="chat-badge' + (unread ? '' : ' hidden') + '" data-chat-badge>' + (unread > 99 ? '99+' : unread) + '</span></button>';
    }
  };
})();
