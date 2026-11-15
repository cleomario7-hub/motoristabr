/* Notificações push (Firebase) — usa o plugin nativo; fora do app Android não faz nada. */
(function () {
  'use strict';
  var Cap = window.Capacitor;
  var P = Cap && Cap.Plugins && Cap.Plugins.PushNotifications;
  var native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var current = null, send = null, onEvent = null, wired = false;

  function wire() {
    if (wired) return;
    wired = true;
    P.addListener('registration', function (t) {
      current = t && t.value;
      if (current && send) send('POST', '/api/me/push-token', { token: current }).catch(function () {});
    });
    P.addListener('registrationError', function () {});
    P.addListener('pushNotificationReceived', function () { if (onEvent) onEvent(); });
    P.addListener('pushNotificationActionPerformed', function () { if (onEvent) onEvent(); });
    try {
      P.createChannel({ id: 'corridas', name: 'Corridas', description: 'Chamadas e andamento das corridas', importance: 5, sound: 'default', vibration: true });
      P.createChannel({ id: 'avisos', name: 'Avisos', description: 'Avisos da CorridaBR', importance: 4, sound: 'default', vibration: true });
    } catch (e) {}
  }

  window.CBRPush = {
    // apiFn: função api(method, path, body) do app; refresh: chamada quando chega um aviso
    start: function (apiFn, refresh) {
      if (!native || !P) return;
      send = apiFn;
      onEvent = refresh;
      try {
        wire();
        P.checkPermissions().then(function (r) {
          return r.receive === 'granted' ? r : P.requestPermissions();
        }).then(function (r) {
          if (r && r.receive === 'granted') return P.register();
        }).catch(function () {});
      } catch (e) {}
    },
    // chamar antes de limpar o login, para este aparelho parar de receber avisos da conta
    stop: function (apiFn) {
      if (current && apiFn) apiFn('POST', '/api/me/push-token/remove', { token: current }).catch(function () {});
      send = null;
    }
  };
})();
