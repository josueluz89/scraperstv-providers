#!/usr/bin/env node
/**
 * Comprueba que el manifest y los providers cuadran.  Uso:  node validar.js
 *
 *   - manifest.json es JSON válido y tiene name/version/scrapers
 *   - cada entrada trae id, name, filename, supportedTypes (movie|tv) y enabled
 *   - cada filename existe en disco
 *   - no hay providers huérfanos (un .js que no esté en el manifest)
 *   - cada provider declara getStreams
 *
 * Sale con código 1 si hay algo roto (para poder usarlo antes de empujar).
 */
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const DIR_PROVIDERS = path.join(RAIZ, 'providers');
const TIPOS = ['movie', 'tv'];
const SIN_MANIFEST = ['_template.js']; // archivos que no son providers de verdad

const fallos = [];
const avisos = [];

function fallo(t) { fallos.push(t); }
function aviso(t) { avisos.push(t); }

// 1) manifest
let man;
try {
  man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
} catch (e) {
  console.error('X manifest.json no es JSON válido: ' + e.message);
  process.exit(1);
}
if (!man.name) fallo('manifest.json sin "name"');
if (!man.version) aviso('manifest.json sin "version"');
if (!Array.isArray(man.scrapers)) { console.error('X manifest.json sin "scrapers" (array)'); process.exit(1); }

// 2) entradas
const ids = new Set();
const archivosDeclarados = new Set();
for (const s of man.scrapers) {
  const quien = s.id || '(sin id)';
  if (!s.id) fallo('una entrada no tiene "id"');
  else if (ids.has(s.id)) fallo('id repetido: ' + s.id);
  else ids.add(s.id);
  if (!s.name) fallo(quien + ': sin "name"');
  if (typeof s.enabled !== 'boolean') fallo(quien + ': "enabled" no es true/false');
  if (!Array.isArray(s.supportedTypes) || s.supportedTypes.length === 0) {
    fallo(quien + ': "supportedTypes" vacío');
  } else {
    for (const t of s.supportedTypes) {
      if (!TIPOS.includes(t)) fallo(quien + ': tipo no válido "' + t + '" (sólo movie/tv)');
    }
  }
  const archivo = s.filename || ('providers/' + s.id + '.js');
  if (!archivo.startsWith('providers/')) aviso(quien + ': "filename" no empieza por providers/');
  archivosDeclarados.add(path.basename(archivo));
  const ruta = path.join(RAIZ, archivo);
  if (!fs.existsSync(ruta)) {
    // Un provider apagado sin archivo no rompe nada, pero es basura; se avisa.
    (s.enabled ? fallo : aviso)(quien + ': falta el archivo ' + archivo);
    continue;
  }
  const cuerpo = fs.readFileSync(ruta, 'utf8');
  if (!/getStreams/.test(cuerpo)) fallo(quien + ': ' + archivo + ' no declara getStreams');
}

// 3) huérfanos
for (const f of fs.readdirSync(DIR_PROVIDERS)) {
  if (!f.endsWith('.js') || SIN_MANIFEST.includes(f)) continue;
  if (!archivosDeclarados.has(f)) aviso('huérfano: providers/' + f + ' no está en el manifest');
}

// 4) resumen
const activos = man.scrapers.filter(s => s.enabled).length;
const apagados = man.scrapers.length - activos;
console.log('manifest: ' + man.name + ' v' + man.version);
console.log('providers: ' + activos + ' activos, ' + apagados + ' apagados');
for (const a of avisos) console.log('  ! ' + a);
for (const f of fallos) console.log('  X ' + f);
if (fallos.length) {
  console.log('\nX ' + fallos.length + ' problema(s), ' + avisos.length + ' aviso(s)');
  process.exit(1);
}
console.log('\nOK sin problemas (' + avisos.length + ' aviso(s))');
