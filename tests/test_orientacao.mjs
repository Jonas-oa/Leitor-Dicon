/**
 * Verifica que o volume é montado no sistema canônico LPS independentemente do
 * plano de aquisição e da ordem dos arquivos.
 *
 *   python3 tests/gerar_sinteticos.py
 *   python3 scripts/serve.py 8123 &
 *   node tests/test_orientacao.mjs [http://localhost:8123/]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8123/';
const TOLERANCIA = 2.5;  // mm (o voxel sintético tem 2 mm)

const series = JSON.parse(readFileSync(join(RAIZ, 'tests/dados/series.json'), 'utf8'));

const navegador = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const pagina = await navegador.newPage();
const falhasJs = [];
pagina.on('pageerror', (e) => falhasJs.push(e.message));
await pagina.goto(BASE);

let falhas = 0;

// cada série é testada em resolução original e nas reduções usadas no celular
const CARGAS = [
  { rotulo: '', opcoes: {} },
  { rotulo: ' [plano ÷2]', opcoes: { reducaoPlano: 2 } },
  { rotulo: ' [cortes ÷2]', opcoes: { passoFatia: 2 } },
  { rotulo: ' [plano ÷2, cortes ÷2]', opcoes: { reducaoPlano: 2, passoFatia: 2 } },
];

for (const s of series) {
 for (const carga of CARGAS) {
  const r = await pagina.evaluate(async ({ spec, opcoes }) => {
    const mv = await import('/js/volume.js');
    const urls = Array.from({ length: spec.files },
      (_, i) => `${spec.path}/${String(i + 1).padStart(4, '0')}.dcm`);
    const vol = mv.montarVolume(await mv.carregarUrls(urls), () => {}, opcoes);

    // voxel mais brilhante
    let melhor = -1e9;
    let idx = 0;
    for (let i = 0; i < vol.dados.length; i++) {
      if (vol.dados[i] > melhor) { melhor = vol.dados[i]; idx = i; }
    }
    const [nx, ny] = vol.dims;
    const x = idx % nx;
    const y = Math.floor(idx / nx) % ny;
    const z = Math.floor(idx / (nx * ny));

    // centroide do marcador (mais estável que um único voxel)
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let k = 0; k < vol.dims[2]; k++) {
      for (let j = 0; j < vol.dims[1]; j++) {
        for (let i = 0; i < vol.dims[0]; i++) {
          if (vol.valor(i, j, k) >= melhor * 0.95) { sx += i; sy += j; sz += k; n++; }
        }
      }
    }
    return {
      dims: vol.dims,
      espacamento: vol.espacamento,
      pico: melhor,
      lpsPico: vol.paciente(x, y, z),
      lpsCentroide: vol.paciente(sx / n, sy / n, sz / n),
      extensao: vol.extensao,
      voxels: n,
    };
  }, { spec: s, opcoes: carga.opcoes });

  const esperado = s.esperado;
  const erro = r.lpsCentroide.map((v, i) => Math.abs(v - esperado[i]));
  // a extensão física do volume tem de continuar a mesma, reduzido ou não
  const extensaoOk = r.extensao.every((e, i) => Math.abs(e - [100, 120, 80][i]) <= 4.1);
  const ok = erro.every((e) => e <= TOLERANCIA + (carga.opcoes.reducaoPlano ? 1 : 0))
    && r.espacamento.every((e) => e > 0)
    && extensaoOk;

  if (!ok) falhas++;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${(s.id + carga.rotulo).padEnd(40)} `
    + `dims=${r.dims.join('×')} esp=${r.espacamento.map((e) => e.toFixed(1)).join('×')} `
    + `centroide=(${r.lpsCentroide.map((v) => v.toFixed(1)).join(', ')}) `
    + `erro=(${erro.map((e) => e.toFixed(1)).join(', ')}) mm`);
 }
}

if (falhasJs.length) {
  console.log('erros de JS:\n' + falhasJs.join('\n'));
  falhas += falhasJs.length;
}

console.log(falhas ? `\n${falhas} falha(s)` : `\n${series.length} séries: todas corretas`);
await navegador.close();
process.exit(falhas ? 1 : 0);
