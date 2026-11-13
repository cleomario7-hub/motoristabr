// Copia o Leaflet (mapa) de node_modules para www/lib, para o app funcionar sem depender de CDN.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist');
const dst = path.join(__dirname, '..', 'www', 'lib');
if (!fs.existsSync(src)) {
  console.warn('leaflet não encontrado em node_modules — rode "npm install" primeiro.');
  process.exit(0);
}
fs.mkdirSync(dst, { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('Leaflet copiado para www/lib');
