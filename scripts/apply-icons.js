'use strict';
// Aplica os ícones CorridaBR no projeto Android gerado pelo Capacitor (substitui o ícone padrão).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const from = path.join(root, 'resources', 'android', 'res');
const to = path.join(root, 'android', 'app', 'src', 'main', 'res');
if (!fs.existsSync(from)) { console.error('ERRO: pasta resources/android/res não encontrada no repositório. Envie a pasta "resources" completa.'); process.exit(1); }
if (!fs.existsSync(to)) { console.error('ERRO: projeto Android não encontrado. Rode "npx cap add android" antes.'); process.exit(1); }

// remove restos do ícone padrão (webp/drawables) que poderiam sobrepor os nossos
for (const d of fs.readdirSync(to)) {
  const dir = path.join(to, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (/^ic_launcher.*\.webp$/.test(f) ||
        (d.startsWith('drawable') && /^ic_launcher_(foreground|background)\.xml$/.test(f))) {
      fs.rmSync(path.join(dir, f)); console.log('removido padrão:', d + '/' + f);
    }
  }
}
let n = 0;
(function copy(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const f of fs.readdirSync(a)) {
    const s = path.join(a, f), d = path.join(b, f);
    if (fs.statSync(s).isDirectory()) copy(s, d); else { fs.copyFileSync(s, d); n++; }
  }
})(from, to);
console.log('Ícones CorridaBR aplicados (' + n + ' arquivos).');
