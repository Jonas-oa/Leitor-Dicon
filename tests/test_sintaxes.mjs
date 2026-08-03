/**
 * Verifica o parser DICOM nas sintaxes de transferência suportadas: as
 * variantes têm de produzir pixels idênticos aos da série de referência
 * (Explicit VR Little Endian). As não suportadas têm de falhar com mensagem
 * explicativa, e não silenciosamente.
 *
 *   python3 tests/gerar_sinteticos.py && python3 tests/gerar_sintaxes.py
 *   python3 scripts/serve.py 8123 &
 *   node tests/test_sintaxes.mjs [http://localhost:8123/]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8123/';
const N = 12;   // as variantes têm 12 cortes

const CASOS = [
  { dir: 'tests/dados/axial', nome: 'explicit-le (referência)', suportado: true },
  { dir: 'tests/dados/sintaxe-implicit-le', nome: 'implicit-le', suportado: true },
  { dir: 'tests/dados/sintaxe-explicit-be', nome: 'explicit-be', suportado: true },
  { dir: 'tests/dados/sintaxe-rle', nome: 'rle-lossless', suportado: true },
  { dir: 'tests/dados/sintaxe-jpegls', nome: 'jpeg-ls (não suportado)', suportado: false },
];

const navegador = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const pagina = await navegador.newPage();
await pagina.goto(BASE);

let falhas = 0;
let referencia = null;

for (const caso of CASOS) {
  const r = await pagina.evaluate(async ({ dir, n }) => {
    const mv = await import('/js/volume.js');
    const urls = Array.from({ length: n },
      (_, i) => `${dir}/${String(i + 1).padStart(4, '0')}.dcm`);
    try {
      const arquivos = await mv.carregarUrls(urls);
      const vol = mv.montarVolume(arquivos);
      // soma de verificação simples sobre todos os voxels
      let soma = 0;
      let min = 1e9;
      let max = -1e9;
      for (let i = 0; i < vol.dados.length; i++) {
        soma = (soma + vol.dados[i] * (i % 97 + 1)) % 2147483647;
        if (vol.dados[i] < min) min = vol.dados[i];
        if (vol.dados[i] > max) max = vol.dados[i];
      }
      return { ok: true, soma, min, max, dims: vol.dims, sintaxe: vol.sintaxe };
    } catch (e) {
      return { ok: false, erro: e.message };
    }
  }, { dir: caso.dir, n: N });

  if (caso.suportado) {
    if (!r.ok) {
      console.log(`FALHA ${caso.nome.padEnd(26)} não abriu: ${r.erro}`);
      falhas++;
      continue;
    }
    if (referencia === null) {
      referencia = r;
      console.log(`ok    ${caso.nome.padEnd(26)} ${r.sintaxe} · dims=${r.dims.join('×')} `
        + `· faixa=${r.min}..${r.max} · soma=${r.soma}`);
      continue;
    }
    const igual = r.soma === referencia.soma && r.min === referencia.min && r.max === referencia.max;
    if (!igual) falhas++;
    console.log(`${igual ? 'ok   ' : 'FALHA'} ${caso.nome.padEnd(26)} ${r.sintaxe} · `
      + `${igual ? 'pixels idênticos à referência' : `DIVERGE (soma ${r.soma} ≠ ${referencia.soma})`}`);
  } else {
    const bom = !r.ok && /não suportad/i.test(r.erro);
    if (!bom) falhas++;
    console.log(`${bom ? 'ok   ' : 'FALHA'} ${caso.nome.padEnd(26)} `
      + (r.ok ? 'abriu quando deveria recusar' : `recusou: "${r.erro.slice(0, 90)}…"`));
  }
}

console.log(falhas ? `\n${falhas} falha(s)` : `\ntodas as sintaxes conferem`);
await navegador.close();
process.exit(falhas ? 1 : 0);
