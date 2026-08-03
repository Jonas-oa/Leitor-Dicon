import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador } from './browser.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8123/';
const navegador = await abrirNavegador();
const pagina = await navegador.newPage();
await pagina.goto(`${BASE}index.html?pc=1`);
await pagina.locator('#entradaArquivos').setInputFiles([
  join(RAIZ, 'tests/dados/pixels/malicioso/0001.dcm'),
  join(RAIZ, 'tests/dados/pixels/malicioso/0002.dcm'),
]);
await pagina.waitForSelector('#seletorSerie:not([hidden])');
await pagina.waitForTimeout(200);

const resultado = await pagina.evaluate(() => ({
  executou: document.body.dataset.dicomXss || null,
  imagensInjetadas: document.querySelectorAll('#listaSeries img').length,
  texto: document.getElementById('listaSeries').textContent,
}));
const ok = !resultado.executou && resultado.imagensInjetadas === 0
  && resultado.texto.includes('<img src=x onerror=');
console.log(`${ok ? 'ok   ' : 'FALHA'} metadado DICOM tratado como texto, não como HTML`);
await navegador.close();
process.exit(ok ? 0 : 1);
