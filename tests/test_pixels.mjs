import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArquivoDicom } from '../js/dicom.js';
import { montarVolume } from '../js/volume.js';
import { abrirNavegador } from './browser.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8123/';
const arquivo = (nome) => {
  const b = readFileSync(join(RAIZ, 'tests/dados/pixels', nome));
  return new ArquivoDicom(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), nome);
};

let falhas = 0;
function conferir(nome, atual, esperado, tolerancia = 0) {
  const ok = atual.length === esperado.length
    && atual.every((v, i) => Math.abs(v - esperado[i]) <= tolerancia);
  if (!ok) falhas++;
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome.padEnd(28)} [${atual.join(', ')}]`);
}

conferir('signed 12-bit / HighBit', [...arquivo('signed12.dcm').pixels()],
  [-2048, -1, 0, 2047]);
conferir('unsigned 16-bit sem corte', [...arquivo('unsigned16.dcm').pixels()],
  [0, 32767, 40000, 65535]);
conferir('rescale fracionário', [...arquivo('slope.dcm').pixels()], [0.5, 1.5, 2.5], 1e-6);
conferir('RGB planar', [...arquivo('rgb-planar.dcm').pixels()], [76, 150]);

const mono = ['0001.dcm', '0002.dcm']
  .map((n) => arquivo(`mono1/${n}`));
const volMono = montarVolume(mono);
conferir('MONOCHROME1 preserva valor', [...mono[0].pixels()], [0, 100, 200]);
if (!volMono.inverterMonocromatico) {
  console.log('FALHA MONOCHROME1 não marcou inversão de apresentação');
  falhas++;
}

function conferirRecusa(nome, pasta, arquivos, mensagem) {
  try {
    montarVolume(arquivos.map((n) => arquivo(`${pasta}/${n}`)));
    console.log(`FALHA ${nome} foi aceita`);
    falhas++;
  } catch (e) {
    const ok = mensagem.test(e.message);
    console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome} recusada: ${e.message}`);
    if (!ok) falhas++;
  }
}
conferirRecusa('modalidade não-CT', 'nao-ct', ['0001.dcm', '0002.dcm'],
  /exclusivamente.*tomografia/i);
conferirRecusa('TC sem geometria', 'sem-geometria', ['0001.dcm', '0002.dcm'],
  /ImageOrientationPatient/i);
conferirRecusa('inclinação de gantry', 'gantry', ['0001.dcm', '0002.dcm'],
  /inclinação do gantry/i);
conferirRecusa('espaçamento irregular', 'irregular',
  ['0001.dcm', '0002.dcm', '0003.dcm'], /espaçamento irregular/i);

const navegador = await abrirNavegador();
const pagina = await navegador.newPage();
await pagina.goto(BASE);
const tela = await pagina.evaluate(async () => {
  const mv = await import('/js/volume.js');
  const mm = await import('/js/mpr.js');
  const vol = mv.montarVolume(await mv.carregarUrls([
    '/tests/dados/pixels/mono1/0001.dcm', '/tests/dados/pixels/mono1/0002.dcm',
  ]));
  const canvas = document.createElement('canvas');
  canvas.width = 300; canvas.height = 100; document.body.append(canvas);
  const estado = {
    volume: vol, cursor: [1, 0, 0], janela: { centro: 100, largura: 201 },
    lut: mm.construirLut(100, 201), paleta: 'cinza', suavizar: false,
    mostrarCrosshair: false, ferramenta: 'cursor', redesenhar() {}, aoMoverCursor() {},
    aoMudarJanela() {}, aoPassarMouse() {}, aoSairMouse() {},
  };
  const vp = new mm.Viewport(canvas, 'axial', estado);
  vp.desenhar();
  return [vp.imagem.data[0], vp.imagem.data[4], vp.imagem.data[8]];
});
conferir('MONOCHROME1 na tela', tela, [255, 127, 0], 1);
await navegador.close();

console.log(falhas ? `\n${falhas} falha(s)` : '\npixels e apresentação corretos');
process.exit(falhas ? 1 : 0);
