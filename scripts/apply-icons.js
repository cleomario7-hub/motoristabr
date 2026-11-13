'use strict';
// Copia os ícones prontos (resources/android/res) para o projeto Android gerado pelo Capacitor.
const fs = require('fs'), path = require('path');
const from = path.join(__dirname, '..', 'resources', 'android', 'res');
const to = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
if (!fs.existsSync(to)) { console.error('Projeto Android não encontrado: rode "npx cap add android" antes.'); process.exit(1); }
(function copy(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const f of fs.readdirSync(a)) {
    const s = path.join(a, f), d = path.join(b, f);
    fs.statSync(s).isDirectory() ? copy(s, d) : fs.copyFileSync(s, d);
  }
})(from, to);
console.log('Ícones CorridaBR aplicados.');
