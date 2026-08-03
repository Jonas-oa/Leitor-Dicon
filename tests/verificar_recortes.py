#!/usr/bin/env python3
"""
Confere que cada volume regional é um recorte fiel da série de origem.

Um recorte só é confiável se duas coisas valerem:

  1. os pixels são exatamente os mesmos da origem, na janela recortada;
  2. a geometria acompanha — o voxel (0,0,0) do recorte tem que cair na mesma
     coordenada LPS do voxel correspondente da origem, senão as medidas em
     milímetros e a fusão com outras séries saem erradas.

    python3 tests/verificar_recortes.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pydicom

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
from prepare_datasets import RECORTES, slice_normal   # noqa: E402

TOLERANCIA_MM = 0.01


def lps_do_voxel(ds, coluna, linha):
    ipp = [float(x) for x in ds.ImagePositionPatient]
    iop = [float(x) for x in ds.ImageOrientationPatient]
    ps = [float(x) for x in ds.PixelSpacing]           # [linha, coluna]
    return [ipp[k] + coluna * ps[1] * iop[k] + linha * ps[0] * iop[3 + k]
            for k in range(3)]


def main():
    manifesto = {s["id"]: s for s in
                 json.loads((RAIZ / "datasets" / "manifest.json").read_text())["series"]}
    falhas = 0

    for spec in RECORTES:
        if "origem" not in spec:
            print(f"—     {spec['id']:<20} origem externa, sem série local para comparar")
            continue

        origem = sorted((RAIZ / "datasets" / spec["origem"]).glob("*.dcm"))
        destino = sorted((RAIZ / "datasets" / spec["id"]).glob("*.dcm"))
        a, b = spec["cortes"]
        esperados = origem[a - 1:b]

        problemas = []
        if len(destino) != len(esperados):
            problemas.append(f"{len(destino)} cortes, esperados {len(esperados)}")

        c0, c1, l0, l1 = spec["plano"] if spec.get("plano") else (0, None, 0, None)
        piorMm = 0.0
        pixelsIguais = True

        for k, (fo, fd) in enumerate(zip(esperados, destino)):
            dso = pydicom.dcmread(fo)
            dsd = pydicom.dcmread(fd)

            recorte = dso.pixel_array[l0:l1, c0:c1]
            if not np.array_equal(recorte, dsd.pixel_array):
                pixelsIguais = False

            # o canto do recorte tem de coincidir com o voxel (c0, l0) da origem
            alvo = lps_do_voxel(dso, c0, l0)
            obtido = lps_do_voxel(dsd, 0, 0)
            piorMm = max(piorMm, max(abs(o - e) for o, e in zip(obtido, alvo)))

            # e o corte tem de estar na mesma posição ao longo da normal
            n = slice_normal(dso.ImageOrientationPatient)
            zo = sum(float(dso.ImagePositionPatient[i]) * n[i] for i in range(3))
            zd = sum(float(dsd.ImagePositionPatient[i]) * n[i] for i in range(3))
            piorMm = max(piorMm, abs(zo - zd))

        if not pixelsIguais:
            problemas.append("pixels diferem da origem")
        if piorMm > TOLERANCIA_MM:
            problemas.append(f"geometria desloca {piorMm:.3f} mm")

        m = manifesto.get(spec["id"], {})
        ok = not problemas
        if not ok:
            falhas += 1
        print(f"{'ok   ' if ok else 'FALHA'} {spec['id']:<20} "
              f"{m.get('columns')}×{m.get('rows')}×{m.get('files')} "
              f"de {spec['origem']} cortes {a}–{b}"
              + (f"  — {'; '.join(problemas)}" if problemas
                 else f"  · pixels idênticos · desvio {piorMm:.4f} mm"))

    print("\n" + ("recortes fiéis à origem" if not falhas else f"{falhas} falha(s)"))
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(main())
