/**
 * Verifica que um clique/toque cai no voxel certo, em telas de densidade 1, 2
 * e 3 — os eventos de ponteiro chegam em pixels de CSS, mas a geometria do
 * viewport é medida em pixels do canvas.
 *
 *   python3 tests/gerar_sinteticos.py
 *   python3 scripts/serve.py 8123 &
 *   node tests/test_ponteiro.mjs [http://localhost:8123/]
 */
import { abrirNavegador } from './browser.mjs';

const BASE = process.argv[2] || 'http://localhost:8123/';
const DENSIDADES = [1, 2, 3];
const TOLERANCIA = 1.5;   // voxels

const navegador = await abrirNavegador();

let falhas = 0;

for (const dpr of DENSIDADES) {
  for (const toque of [false, true]) {
    const ctx = await navegador.newContext({
      viewport: { width: 900, height: 700 },
      deviceScaleFactor: dpr,
      hasTouch: toque,
    });
    const pagina = await ctx.newPage();
    await pagina.goto(BASE);

    const r = await pagina.evaluate(async ({ dprPagina, comToque }) => {
      const mv = await import('/js/volume.js');
      const mm = await import('/js/mpr.js');

      const urls = Array.from({ length: 40 },
        (_, i) => `tests/dados/axial/${String(i + 1).padStart(4, '0')}.dcm`);
      const vol = mv.montarVolume(await mv.carregarUrls(urls));

      // canvas com tamanho de CSS conhecido e backing store escalado
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:400px';
      document.body.append(canvas);
      canvas.width = Math.round(600 * dprPagina);
      canvas.height = Math.round(400 * dprPagina);

      const estado = {
        volume: vol, cursor: [25, 30, 20],
        janela: { centro: 100, largura: 200 }, lut: mm.construirLut(100, 200),
        paleta: 'cinza', suavizar: true, mostrarCrosshair: true, ferramenta: 'cursor',
        redesenhar() {}, aoMoverCursor() {}, aoMudarJanela() {},
        aoPassarMouse() {}, aoSairMouse() {},
      };
      canvas.setPointerCapture = () => {};   // evento sintético não tem ponteiro real
      const vp = new mm.Viewport(canvas, 'axial', estado, { toque: comToque });
      vp.desenhar();
      const fator = vp.fatorPonteiro;

      // Onde o alvo aparece na tela, em pixels de CSS — que é a unidade em que
      // o navegador entrega clientX/offsetX.
      const cssDoVoxel = (alvo) => {
        const [cx, cy] = vp.voxelParaCanvas(alvo);
        const r = canvas.getBoundingClientRect();
        return [r.left + cx * (r.width / canvas.width),
          r.top + cy * (r.height / canvas.height)];
      };

      const testes = [[5, 8], [25, 30], [44, 51]];
      const saida = [];
      for (const [vx, vy] of testes) {
        estado.cursor = [0, 0, 20];
        const [cssX, cssY] = cssDoVoxel([vx, vy, 20]);
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
          pointerId: 1, button: 0, buttons: 1, bubbles: true,
          // pointerType 'mouse' mesmo no modo de toque: eventos sintéticos do
          // tipo touch não recebem offsetX no Chrome. O toque de verdade é
          // testado adiante, na página do celular, com evento confiável.
          clientX: cssX, clientY: cssY, pointerType: 'mouse',
        }));
        saida.push({
          alvo: [vx, vy],
          obtido: [estado.cursor[0], estado.cursor[1]],
          erro: [Math.abs(estado.cursor[0] - vx), Math.abs(estado.cursor[1] - vy)],
        });
        canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
        await new Promise((r) => setTimeout(r, 360));   // acima do duplo toque
      }
      canvas.remove();
      return { fator, testes: saida };
    }, { dprPagina: dpr, comToque: toque });

    const pior = Math.max(...r.testes.flatMap((t) => t.erro));
    const ok = pior <= TOLERANCIA && Math.abs(r.fator[0] - dpr) < 0.02;
    if (!ok) falhas++;
    console.log(`${ok ? 'ok   ' : 'FALHA'} dpr=${dpr} ${toque ? 'toque ' : 'mouse '} `
      + `fator=${r.fator.map((f) => f.toFixed(2)).join(',')} `
      + `erro máx=${pior.toFixed(2)} voxel  `
      + r.testes.map((t) => `[${t.alvo}]→[${t.obtido.map((v) => v.toFixed(1))}]`).join(' '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// Toque de verdade (evento confiável) na página do celular, com densidade 2,75
// ---------------------------------------------------------------------------
{
  const ctx = await navegador.newContext({
    viewport: { width: 393, height: 727 }, deviceScaleFactor: 2.75,
    hasTouch: true, isMobile: true,
  });
  const pagina = await ctx.newPage();
  const erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));
  await pagina.goto(`${BASE}celular.html`);
  await pagina.waitForFunction(() => !!window.leitorDicom, null, { timeout: 20000 });

  // injeta a série sintética direto no app
  await pagina.evaluate(async () => {
    const mv = await import('/js/volume.js');
    const urls = Array.from({ length: 40 },
      (_, i) => `tests/dados/axial/${String(i + 1).padStart(4, '0')}.dcm`);
    window.leitorDicom.aplicarVolume(mv.montarVolume(await mv.carregarUrls(urls)));
    document.getElementById('cortina').hidden = true;
    for (const id of ['folhaExames', 'folhaAjustes', 'folhaSeries']) {
      document.getElementById(id).hidden = true;
    }
    window.leitorDicom.dimensionar();
  });
  await pagina.waitForTimeout(400);

  for (const alvo of [[8, 12], [25, 30], [41, 47]]) {
    const ponto = await pagina.evaluate((a) => {
      const vp = window.leitorDicom.viewports.axial;
      window.leitorDicom.estado.cursor = [0, 0, 20];
      const [cx, cy] = vp.voxelParaCanvas([a[0], a[1], 20]);
      const r = vp.canvas.getBoundingClientRect();
      return [r.left + cx * (r.width / vp.canvas.width),
        r.top + cy * (r.height / vp.canvas.height)];
    }, alvo);

    await pagina.touchscreen.tap(ponto[0], ponto[1]);
    await pagina.waitForTimeout(380);   // acima do limiar de duplo toque
    const obtido = await pagina.evaluate(() => window.leitorDicom.estado.cursor.slice(0, 2));
    const erro = obtido.map((v, i) => Math.abs(v - alvo[i]));
    const ok = erro.every((e) => e <= TOLERANCIA);
    if (!ok) falhas++;
    console.log(`${ok ? 'ok   ' : 'FALHA'} dpr=2.75 toque real  `
      + `[${alvo}]→[${obtido}] erro=(${erro.join(', ')}) voxel`);
  }

  if (erros.length) { falhas += erros.length; console.log('erros de JS:\n' + erros.join('\n')); }
  await ctx.close();
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nclique e toque precisos em todas as densidades');
await navegador.close();
process.exit(falhas ? 1 : 0);
