/**
 * Reconstrução multiplanar (MPR).
 *
 * Cada viewport corta o volume canônico LPS num dos três planos ortogonais e
 * desenha o resultado respeitando o espaçamento físico (mm), de modo que uma
 * estrutura redonda continue redonda mesmo em séries anisotrópicas.
 *
 * Convenção radiológica: axial e coronal vistos com a esquerda do paciente à
 * direita da tela; sagital visto pela esquerda do paciente, com anterior à
 * esquerda da tela.
 */

export const PLANOS = {
  axial: {
    rotulo: 'Axial',
    cor: '#4fa8ff',
    eixoFixo: 2,          // z
    eixoColuna: 0,        // x  -> horizontal
    eixoLinha: 1,         // y  -> vertical
    inverteColuna: false,
    inverteLinha: true,   // anterior no topo
    letras: { topo: 'A', base: 'P', esq: 'D', dir: 'E' },
  },
  coronal: {
    rotulo: 'Coronal',
    cor: '#5fd08a',
    eixoFixo: 1,          // y
    eixoColuna: 0,        // x
    eixoLinha: 2,         // z
    inverteColuna: false,
    inverteLinha: true,   // superior no topo
    letras: { topo: 'S', base: 'I', esq: 'D', dir: 'E' },
  },
  sagital: {
    rotulo: 'Sagital',
    cor: '#f0a04b',
    eixoFixo: 0,          // x
    eixoColuna: 1,        // y
    eixoLinha: 2,         // z
    inverteColuna: true,  // anterior à esquerda
    inverteLinha: true,   // superior no topo
    letras: { topo: 'S', base: 'I', esq: 'A', dir: 'P' },
  },
};

// ---------------------------------------------------------------------------
// Paletas
// ---------------------------------------------------------------------------
function paletaCinza() {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) { p[i * 3] = i; p[i * 3 + 1] = i; p[i * 3 + 2] = i; }
  return p;
}

function paletaDe(pontos) {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = pontos[0];
    let b = pontos[pontos.length - 1];
    for (let k = 0; k < pontos.length - 1; k++) {
      if (t >= pontos[k][0] && t <= pontos[k + 1][0]) { a = pontos[k]; b = pontos[k + 1]; break; }
    }
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    p[i * 3] = a[1] + (b[1] - a[1]) * f;
    p[i * 3 + 1] = a[2] + (b[2] - a[2]) * f;
    p[i * 3 + 2] = a[3] + (b[3] - a[3]) * f;
  }
  return p;
}

export const PALETAS = {
  cinza: { rotulo: 'Escala de cinza', tabela: paletaCinza() },
  quente: {
    rotulo: 'Hot metal',
    tabela: paletaDe([[0, 0, 0, 0], [0.35, 180, 40, 0], [0.65, 255, 160, 20], [1, 255, 255, 235]]),
  },
  pet: {
    rotulo: 'PET (invertido)',
    tabela: paletaDe([[0, 255, 255, 255], [0.4, 120, 120, 200], [0.7, 200, 60, 60], [1, 0, 0, 0]]),
  },
  arcoiris: {
    rotulo: 'Arco-íris',
    tabela: paletaDe([[0, 0, 0, 60], [0.25, 0, 120, 255], [0.5, 0, 200, 90],
      [0.75, 255, 210, 0], [1, 255, 40, 40]]),
  },
};

/** Tabela de janelamento: valor bruto (-32768..32767) -> 0..255. */
export function construirLut(centro, largura) {
  const lut = new Uint8Array(65536);
  const min = centro - 0.5 - (largura - 1) / 2;
  const escala = 255 / Math.max(largura - 1, 1);
  for (let i = 0; i < 65536; i++) {
    const v = (i - 32768 - min) * escala;
    lut[i] = v <= 0 ? 0 : v >= 255 ? 255 : v;
  }
  return lut;
}

// ---------------------------------------------------------------------------
export class Viewport {
  constructor(canvas, plano, estado) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.plano = plano;
    this.def = PLANOS[plano];
    this.estado = estado;              // estado compartilhado (volume, cursor, janela...)
    this.zoom = 1;
    this.pan = [0, 0];
    this.buffer = document.createElement('canvas');
    this.bufferCtx = this.buffer.getContext('2d');
    this.imagem = null;
    this._instalarEventos();
  }

  get volume() { return this.estado.volume; }

  /** Dimensões (colunas, linhas) da grade deste plano. */
  grade() {
    const v = this.volume;
    return [v.dims[this.def.eixoColuna], v.dims[this.def.eixoLinha]];
  }

  /** Tamanho físico em mm da imagem deste plano. */
  tamanhoMm() {
    const v = this.volume;
    return [v.dims[this.def.eixoColuna] * v.espacamento[this.def.eixoColuna],
      v.dims[this.def.eixoLinha] * v.espacamento[this.def.eixoLinha]];
  }

  /** Retângulo de destino no canvas (x, y, largura, altura). */
  destino() {
    const [mmW, mmH] = this.tamanhoMm();
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const escala = Math.min(cw / mmW, ch / mmH) * this.zoom;
    const w = mmW * escala;
    const h = mmH * escala;
    return [(cw - w) / 2 + this.pan[0], (ch - h) / 2 + this.pan[1], w, h];
  }

  /** Converte coordenadas do canvas para índices de voxel (fracionários). */
  canvasParaVoxel(cx, cy) {
    const [dx, dy, dw, dh] = this.destino();
    const [gw, gh] = this.grade();
    let col = ((cx - dx) / dw) * gw;
    let lin = ((cy - dy) / dh) * gh;
    if (this.def.inverteColuna) col = gw - col;
    if (this.def.inverteLinha) lin = gh - lin;
    const p = [...this.estado.cursor];
    p[this.def.eixoColuna] = col - 0.5;
    p[this.def.eixoLinha] = lin - 0.5;
    return p;
  }

  /** Converte índices de voxel para coordenadas do canvas. */
  voxelParaCanvas(p) {
    const [dx, dy, dw, dh] = this.destino();
    const [gw, gh] = this.grade();
    let col = p[this.def.eixoColuna] + 0.5;
    let lin = p[this.def.eixoLinha] + 0.5;
    if (this.def.inverteColuna) col = gw - col;
    if (this.def.inverteLinha) lin = gh - lin;
    return [dx + (col / gw) * dw, dy + (lin / gh) * dh];
  }

  ajustar() {
    this.zoom = 1;
    this.pan = [0, 0];
  }

  /** Extrai o corte e o desenha. */
  desenhar() {
    const v = this.volume;
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!v) return;

    const [gw, gh] = this.grade();
    if (this.buffer.width !== gw || this.buffer.height !== gh) {
      this.buffer.width = gw;
      this.buffer.height = gh;
      this.imagem = this.bufferCtx.createImageData(gw, gh);
    }

    const fixo = Math.max(0, Math.min(v.dims[this.def.eixoFixo] - 1,
      Math.round(this.estado.cursor[this.def.eixoFixo])));
    this._preencher(this.imagem.data, fixo, gw, gh);
    this.bufferCtx.putImageData(this.imagem, 0, 0);

    const [dx, dy, dw, dh] = this.destino();
    ctx.imageSmoothingEnabled = this.estado.suavizar;
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    // espelhamentos para respeitar a convenção radiológica
    ctx.translate(dx + (this.def.inverteColuna ? dw : 0), dy + (this.def.inverteLinha ? dh : 0));
    ctx.scale(this.def.inverteColuna ? -1 : 1, this.def.inverteLinha ? -1 : 1);
    ctx.drawImage(this.buffer, 0, 0, dw, dh);
    ctx.restore();

    this._sobreposicao(fixo);
  }

  _preencher(saida, fixo, gw, gh) {
    const v = this.volume;
    const lut = this.estado.lut;
    const paleta = PALETAS[this.estado.paleta].tabela;
    const dados = v.dados;
    const [nx, ny] = v.dims;
    const nxy = nx * ny;

    // strides no arranjo canônico para os eixos deste plano
    const strides = [1, nx, nxy];
    const sCol = strides[this.def.eixoColuna];
    const sLin = strides[this.def.eixoLinha];
    const base = fixo * strides[this.def.eixoFixo];

    let o = 0;
    for (let l = 0; l < gh; l++) {
      let idx = base + l * sLin;
      for (let c = 0; c < gw; c++) {
        const g = lut[dados[idx] + 32768] * 3;
        saida[o] = paleta[g];
        saida[o + 1] = paleta[g + 1];
        saida[o + 2] = paleta[g + 2];
        saida[o + 3] = 255;
        o += 4;
        idx += sCol;
      }
    }
  }

  _sobreposicao(fixo) {
    const ctx = this.ctx;
    const v = this.volume;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const def = this.def;

    // linhas do crosshair
    if (this.estado.mostrarCrosshair) {
      const [px, py] = this.voxelParaCanvas(this.estado.cursor);
      const eixos = [def.eixoColuna, def.eixoLinha];
      const cores = eixos.map((e) => corDoEixo(e));
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = cores[1];
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(cw, py); ctx.stroke();
      ctx.strokeStyle = cores[0];
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, ch); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = def.cor;
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      ctx.restore();
    }

    // letras de orientação
    ctx.save();
    ctx.font = '600 12px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(220,230,240,.75)';
    ctx.textAlign = 'center';
    ctx.fillText(def.letras.topo, cw / 2, 16);
    ctx.fillText(def.letras.base, cw / 2, ch - 6);
    ctx.textAlign = 'left';
    ctx.fillText(def.letras.esq, 6, ch / 2);
    ctx.textAlign = 'right';
    ctx.fillText(def.letras.dir, cw - 6, ch / 2);
    ctx.restore();

    // rótulo do plano e número do corte
    ctx.save();
    ctx.font = '600 12px ui-monospace, monospace';
    ctx.fillStyle = def.cor;
    ctx.textAlign = 'left';
    ctx.fillText(def.rotulo, 8, 16);
    ctx.fillStyle = 'rgba(200,215,230,.8)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`corte ${fixo + 1}/${v.dims[def.eixoFixo]}`, 8, 30);
    const mm = v.paciente(...this.estado.cursor.map((c, i) => (i === def.eixoFixo ? fixo : c)));
    ctx.fillText(`${'xyz'[def.eixoFixo].toUpperCase()} = ${mm[def.eixoFixo].toFixed(1)} mm`, 8, 43);
    ctx.restore();

    this._barraEscala();
  }

  _barraEscala() {
    const ctx = this.ctx;
    const [, , dw] = this.destino();
    const [mmW] = this.tamanhoMm();
    const pxPorMm = dw / mmW;
    if (!Number.isFinite(pxPorMm) || pxPorMm <= 0) return;

    const alvo = this.canvas.width * 0.22;
    const candidatos = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    let mm = candidatos[candidatos.length - 1];
    for (const c of candidatos) if (c * pxPorMm >= alvo) { mm = c; break; }
    const largura = mm * pxPorMm;
    const x = this.canvas.width - largura - 12;
    const y = this.canvas.height - 16;

    ctx.save();
    ctx.strokeStyle = 'rgba(220,230,240,.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + largura, y); ctx.lineTo(x + largura, y - 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(220,230,240,.8)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(mm >= 10 ? `${mm / 10} cm` : `${mm} mm`, x + largura / 2, y - 6);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  _instalarEventos() {
    const c = this.canvas;
    let modo = null;
    let ultimo = [0, 0];

    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      if (!this.volume) return;
      c.setPointerCapture(e.pointerId);
      ultimo = [e.offsetX, e.offsetY];
      if (e.button === 2 || (e.button === 0 && this.estado.ferramenta === 'janela')) modo = 'janela';
      else if (e.button === 1 || (e.button === 0 && this.estado.ferramenta === 'pan')) modo = 'pan';
      else if (e.button === 0) { modo = 'cursor'; this._moverCursor(e.offsetX, e.offsetY); }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.volume) return;
      const dx = e.offsetX - ultimo[0];
      const dy = e.offsetY - ultimo[1];
      ultimo = [e.offsetX, e.offsetY];

      this.estado.aoPassarMouse(this, e.offsetX, e.offsetY);

      if (!modo) return;
      if (modo === 'cursor') this._moverCursor(e.offsetX, e.offsetY);
      else if (modo === 'pan') { this.pan[0] += dx; this.pan[1] += dy; this.estado.redesenhar(); }
      else if (modo === 'janela') {
        const j = this.estado.janela;
        const passo = Math.max(1, j.largura / 200);
        j.largura = Math.max(1, j.largura + dx * passo);
        j.centro += dy * passo;
        this.estado.aoMudarJanela();
      }
    });

    const soltar = () => { modo = null; };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);
    c.addEventListener('pointerleave', () => { this.estado.aoSairMouse(); });

    c.addEventListener('wheel', (e) => {
      if (!this.volume) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const antes = this.canvasParaVoxel(e.offsetX, e.offsetY);
        this.zoom = Math.max(0.2, Math.min(20, this.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        const depois = this.canvasParaVoxel(e.offsetX, e.offsetY);
        const [, , dw, dh] = this.destino();
        const [gw, gh] = this.grade();
        const sc = this.def.inverteColuna ? -1 : 1;
        const sl = this.def.inverteLinha ? -1 : 1;
        this.pan[0] += (depois[this.def.eixoColuna] - antes[this.def.eixoColuna]) * (dw / gw) * sc;
        this.pan[1] += (depois[this.def.eixoLinha] - antes[this.def.eixoLinha]) * (dh / gh) * sl;
        this.estado.redesenhar();
      } else {
        const passo = e.deltaY > 0 ? 1 : -1;
        const eixo = this.def.eixoFixo;
        const n = this.volume.dims[eixo];
        this.estado.cursor[eixo] = Math.max(0, Math.min(n - 1,
          Math.round(this.estado.cursor[eixo]) + passo));
        this.estado.aoMoverCursor();
      }
    }, { passive: false });

    c.addEventListener('dblclick', () => { this.ajustar(); this.estado.redesenhar(); });
  }

  _moverCursor(cx, cy) {
    const p = this.canvasParaVoxel(cx, cy);
    const v = this.volume;
    for (let i = 0; i < 3; i++) {
      if (i === this.def.eixoFixo) continue;
      this.estado.cursor[i] = Math.max(0, Math.min(v.dims[i] - 1, Math.round(p[i])));
    }
    this.estado.aoMoverCursor();
  }
}

function corDoEixo(eixo) {
  return ['#f0a04b', '#5fd08a', '#4fa8ff'][eixo];
}
