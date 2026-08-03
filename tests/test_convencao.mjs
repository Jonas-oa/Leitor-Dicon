/**
 * Verifica a convenção radiológica NA TELA, e não só na montagem do volume.
 *
 * O teste de orientação garante que o voxel certo está no índice certo; este
 * garante que esse voxel é desenhado no canto certo da imagem:
 *
 *   Axial     esquerda do paciente à direita da tela, anterior no topo
 *   Coronal   esquerda do paciente à direita da tela, superior no topo
 *   Sagital   anterior à esquerda da tela, superior no topo
 *
 * Usa a série sintética, cujo marcador fica numa posição LPS conhecida e
 * assimétrica nos três eixos (esquerda, anterior e superior), e procura o
 * pixel mais claro do que foi realmente desenhado no canvas.
 *
 *   python3 tests/gerar_sinteticos.py
 *   python3 scripts/serve.py 8123 &
 *   node tests/test_convencao.mjs [http://localhost:8123/]
 */
import { abrirNavegador } from './browser.mjs';

const BASE = process.argv[2] || 'http://localhost:8123/';

// marcador em LPS = (+30, -20, +25): esquerda, anterior e superior
// (veja MARCADOR em tests/gerar_sinteticos.py)
const ESPERADO = {
  axial: { h: 'direita', v: 'topo', porque: 'esquerda do paciente / anterior' },
  coronal: { h: 'direita', v: 'topo', porque: 'esquerda do paciente / superior' },
  sagital: { h: 'esquerda', v: 'topo', porque: 'anterior / superior' },
};

const navegador = await abrirNavegador();
const pagina = await navegador.newPage({ viewport: { width: 900, height: 700 } });
const falhasJs = [];
pagina.on('pageerror', (e) => falhasJs.push(e.message));
await pagina.goto(BASE);

const resultado = await pagina.evaluate(async () => {
  const mv = await import('/js/volume.js');
  const mm = await import('/js/mpr.js');

  const urls = Array.from({ length: 40 },
    (_, i) => `tests/dados/axial/${String(i + 1).padStart(4, '0')}.dcm`);
  const vol = mv.montarVolume(await mv.carregarUrls(urls));

  // voxel mais claro = centro do marcador
  let melhor = -1e9;
  let idx = 0;
  for (let i = 0; i < vol.dados.length; i++) {
    if (vol.dados[i] > melhor) { melhor = vol.dados[i]; idx = i; }
  }
  const [nx, ny] = vol.dims;
  const marcador = [idx % nx, Math.floor(idx / nx) % ny, Math.floor(idx / (nx * ny))];

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:400px';
  document.body.append(canvas);
  canvas.width = 400;
  canvas.height = 400;

  const estado = {
    volume: vol, cursor: [...marcador],
    janela: { centro: 1050, largura: 1900 }, lut: mm.construirLut(1050, 1900),
    paleta: 'cinza', suavizar: false, mostrarCrosshair: false, ferramenta: 'cursor',
    redesenhar() {}, aoMoverCursor() {}, aoMudarJanela() {},
    aoPassarMouse() {}, aoSairMouse() {},
  };

  const saida = {};
  for (const plano of ['axial', 'coronal', 'sagital']) {
    const vp = new mm.Viewport(canvas, plano, estado);
    vp.desenhar();

    // procura o pixel mais claro dentro da área da imagem
    const [dx, dy, dw, dh] = vp.destino();
    const dados = canvas.getContext('2d')
      .getImageData(Math.max(0, dx), Math.max(0, dy), Math.min(dw, 400), Math.min(dh, 400)).data;
    const larg = Math.round(Math.min(dw, 400));
    let max = -1;
    let px = 0;
    let py = 0;
    for (let i = 0; i < dados.length; i += 4) {
      if (dados[i] > max) {
        max = dados[i];
        const p = i / 4;
        px = p % larg;
        py = Math.floor(p / larg);
      }
    }
    saida[plano] = {
      horizontal: px < larg / 2 ? 'esquerda' : 'direita',
      vertical: py < Math.min(dh, 400) / 2 ? 'topo' : 'base',
      fracao: [+(px / larg).toFixed(2), +(py / Math.min(dh, 400)).toFixed(2)],
      brilho: max,
      letras: vp.def.letras,
    };
  }
  canvas.remove();
  return { marcador, dims: vol.dims, lps: vol.paciente(...marcador), planos: saida };
});

console.log(`marcador no voxel [${resultado.marcador}] de ${resultado.dims.join('×')}`
  + `  =  LPS (${resultado.lps.map((v) => v.toFixed(0)).join(', ')}) mm`
  + '  [esquerda, anterior, superior]\n');

let falhas = 0;
for (const [plano, esperado] of Object.entries(ESPERADO)) {
  const r = resultado.planos[plano];
  const ok = r.horizontal === esperado.h && r.vertical === esperado.v && r.brilho > 200;
  if (!ok) falhas++;
  const letra = r.horizontal === 'esquerda' ? r.letras.esq : r.letras.dir;
  const letraV = r.vertical === 'topo' ? r.letras.topo : r.letras.base;
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${plano.padEnd(8)} `
    + `marcador em ${r.horizontal}/${r.vertical} (${r.fracao.join(', ')} do quadro) `
    + `sob as letras ${letra}/${letraV}`
    + (ok ? '' : `  — esperado ${esperado.h}/${esperado.v}: ${esperado.porque}`));
}

if (falhasJs.length) {
  falhas += falhasJs.length;
  console.log('erros de JS:\n' + falhasJs.join('\n'));
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nconvenção radiológica correta nos três planos');
await navegador.close();
process.exit(falhas ? 1 : 0);
