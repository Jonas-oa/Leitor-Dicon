#!/usr/bin/env python3
"""
Baixa e prepara as três séries DICOM de tomografia do Leitor DICOM.

Todas as fontes são repositórios públicos no GitHub com licença permissiva
(ver datasets/ATTRIBUTION.md). O script:

  1. clona/baixa as fontes originais (etapa `fetch`);
  2. seleciona as séries pelo SeriesInstanceUID;
  3. ordena as fatias pela projeção de ImagePositionPatient na normal do corte;
  4. transcodifica para Explicit VR Little Endian quando a origem é comprimida
     (JPEG-LS sem perdas) — o pixel é bit-a-bit idêntico;
  5. grava em datasets/<id>/0001.dcm ... e gera datasets/manifest.json
     com a geometria já resolvida, além de um PNG de pré-visualização.

Uso:
    python3 scripts/prepare_datasets.py fetch      # baixa as fontes (~700 MB)
    python3 scripts/prepare_datasets.py build      # gera datasets/
    python3 scripts/prepare_datasets.py all

Dependências: pydicom, numpy, pylibjpeg, pylibjpeg-libjpeg, pillow
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "sources"
OUT = ROOT / "datasets"

# --------------------------------------------------------------------------
# Fontes (todas em github.com, licenças permissivas)
# --------------------------------------------------------------------------
SOURCES = [
    {
        "name": "fnndsc",
        "kind": "git-sparse",
        "url": "https://github.com/FNNDSC/data.git",
        "sparse": ["dicom/andrei_abdomen"],
    },
    {
        "name": "ohif",
        "kind": "git-sparse",
        "url": "https://github.com/OHIF/viewer-testdata.git",
        "sparse": ["dcm/acrin", "dcm/Juno"],
    },
    {
        # dataset1_Thorax_Abdomen.zip — TC de tórax e abdome com contraste,
        # 2 mm, dos cursos práticos do 3D Slicer
        "name": "slicer-torax-abdome",
        "kind": "zip",
        "url": "https://github.com/Slicer/SlicerTestingData/releases/download/SHA256/"
               "17a4199aad03a373dab27dc17e5bfcf84fc194d0a30975b4073e5b595d43a56a",
    },
]

# --------------------------------------------------------------------------
# Séries selecionadas
#   step: mantém 1 fatia a cada `step` (1 = série completa)
# --------------------------------------------------------------------------
SERIES = [
    {
        "id": "ct-corpo-inteiro",
        "label": "Corpo inteiro — TC",
        "region": "Corpo inteiro (crânio à coxa)",
        "modality": "CT",
        "uid": "1.3.6.1.4.1.25403.345050719074.3824.20170125113545.4",
        "source": "ohif",
        "step": 1,
        "notes": "TC de corpo inteiro com cortes de 5 mm, cobrindo crânio, "
                 "pescoço, tórax, abdome e pelve.",
        "attribution": "OHIF/viewer-testdata (MIT)",
    },
    {
        "id": "ct-torax-alta-resolucao",
        "label": "Tórax — TC 2 mm",
        "region": "Tórax",
        "modality": "CT",
        "uid": "1.3.6.1.4.1.6279.6001.154677396354641150280013275227",
        "uid_alt": "1.3.6.1.4.1.14519.5.2.1.6279.6001.154677396354641150280013275227",
        "source": "fnndsc",
        "step": 2,
        "notes": "TC de tórax de alta resolução (série original 1 mm, 275 fatias; "
                 "reduzida para 1 a cada 2 fatias ≈ 2 mm para caber no repositório). "
                 "É o volume mais próximo do isotrópico — melhor caso para MPR.",
        "attribution": "FNNDSC/data (Apache-2.0)",
    },
    {
        "id": "ct-torax-petct",
        "label": "Tórax — TC 3,27 mm",
        "region": "Tórax e abdome superior",
        "modality": "CT",
        "uid": "1.3.6.1.4.1.14519.5.2.1.7009.2403.226151125820845824875394858561",
        "source": "ohif",
        "step": 1,
        "notes": "TC volumétrica de tórax e abdome superior, com espaçamento "
                 "de 3,27 mm entre cortes.",
        "attribution": "OHIF/viewer-testdata (MIT) — dados ACRIN via TCIA",
    },
]


# --------------------------------------------------------------------------
# Recortes regionais
#
# Não há, nos repositórios alcançáveis, séries dedicadas de TC de seios da
# face, pescoço ou membros. Estes volumes são recortes de séries reais — os
# cortes e os pixels são os originais, apenas delimitados à região. Cada
# recorte recebe novos UIDs (a norma exige isso para imagem derivada) e traz a
# origem registrada em DerivationDescription.
#
#   fonte      'datasets/<id>' para uma série já preparada, ou o nome de uma
#              fonte baixada mais o SeriesInstanceUID
#   cortes     [primeiro, último] 1-indexado, inclusive, na ordem do volume
#              (1 = corte mais inferior)
#   plano      [col0, col1, lin0, lin1] recorte no plano, ou None
# --------------------------------------------------------------------------
RECORTES = [
    {
        "id": "ct-seios-da-face",
        "label": "Seios da face — TC",
        "region": "Seios paranasais e maciço facial",
        "modality": "CT",
        "origem": "ct-corpo-inteiro",
        "cortes": [156, 174],
        "plano": [148, 372, 36, 304],
        "notes": "Seios frontal, etmoidal, maxilar e esfenoidal, órbitas e maciço "
                 "facial. Recorte da TC de corpo inteiro (5 mm) — não é um "
                 "protocolo dedicado de seios da face, que usaria cortes "
                 "submilimétricos.",
    },
    {
        "id": "ct-pescoco",
        "label": "Pescoço — TC",
        "region": "Pescoço",
        "modality": "CT",
        "origem": "ct-corpo-inteiro",
        "cortes": [142, 161],
        "plano": [150, 370, 52, 336],
        "notes": "Coluna cervical, via aérea, laringe, glândula tireoide e "
                 "espaços cervicais. Recorte da TC de corpo inteiro (5 mm).",
    },
    {
        "id": "ct-abdome",
        "label": "Abdome — TC 2 mm",
        "region": "Abdome",
        "modality": "CT",
        "fonte": "slicer-torax-abdome",
        "uid": "1.3.12.2.1107.5.1.4.50025.30000005060811542834300000776",
        "cortes": [80, 175],
        "plano": None,
        "notes": "Fígado, baço, rins, alças intestinais e coluna lombar, com "
                 "contraste. Recorte de uma TC de tórax e abdome de 2 mm com "
                 "0,51 mm no plano — a série de melhor resolução do conjunto.",
        "attribution": "Slicer/SlicerTestingData (BSD-3-Clause)",
    },
    {
        "id": "ct-membro-superior",
        "label": "Membro superior — TC",
        "region": "Braço direito",
        "modality": "CT",
        "origem": "ct-corpo-inteiro",
        "cortes": [147, 174],
        "plano": [14, 168, 28, 320],
        "notes": "Braço direito (úmero e partes moles), com o membro elevado ao "
                 "lado da cabeça, como é usual em PET-CT. Recorte da TC de "
                 "corpo inteiro (5 mm).",
    },
    {
        "id": "ct-membro-inferior",
        "label": "Membros inferiores — TC",
        "region": "Coxas",
        "modality": "CT",
        "origem": "ct-corpo-inteiro",
        "cortes": [1, 24],
        "plano": [58, 468, 130, 398],
        "notes": "Terço proximal e médio das coxas: fêmures e compartimentos "
                 "musculares dos dois lados. É até onde a aquisição de corpo "
                 "inteiro desce — não inclui joelhos, pernas nem pés.",
    },
]


# --------------------------------------------------------------------------
def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True, **kw)


def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    for src in SOURCES:
        dest = CACHE / src["name"]
        if dest.exists():
            print(f"[fetch] {src['name']}: já em cache")
            continue
        print(f"[fetch] {src['name']} <- {src['url']}")
        if src["kind"] == "git-sparse":
            run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none",
                 "--sparse", src["url"], str(dest)])
            run(["git", "-C", str(dest), "sparse-checkout", "set", *src["sparse"]])
        elif src["kind"] == "zip":
            tmp = CACHE / f"{src['name']}.zip"
            run(["curl", "-sSL", "--retry", "3", "-o", str(tmp), src["url"]])
            dest.mkdir(parents=True)
            with zipfile.ZipFile(tmp) as z:
                z.extractall(dest)
            tmp.unlink()


# --------------------------------------------------------------------------
def slice_normal(iop):
    if not iop or len(iop) != 6:
        return (0.0, 0.0, 1.0)
    r, c = [float(x) for x in iop[:3]], [float(x) for x in iop[3:]]
    return (r[1] * c[2] - r[2] * c[1],
            r[2] * c[0] - r[0] * c[2],
            r[0] * c[1] - r[1] * c[0])


def index_source(root: Path):
    """Mapeia SeriesInstanceUID -> lista de arquivos."""
    import pydicom
    index: dict[str, list[Path]] = {}
    for dirpath, _, names in os.walk(root):
        if ".git" in dirpath:
            continue
        for n in names:
            p = Path(dirpath) / n
            if p.suffix.lower() in (".md", ".txt", ".py", ".sh", ".json", ".gz", ".zip"):
                continue
            if p.name.upper() in ("DICOMDIR", "LICENSE"):
                continue
            try:
                ds = pydicom.dcmread(p, stop_before_pixels=True, force=True)
                uid = str(ds.SeriesInstanceUID)
            except Exception:
                continue
            index.setdefault(uid, []).append(p)
    return index


def build():
    import numpy as np
    import pydicom
    from pydicom.uid import ExplicitVRLittleEndian

    OUT.mkdir(parents=True, exist_ok=True)
    indexes: dict[str, dict] = {}
    manifest = []

    for spec in SERIES:
        src = spec["source"]
        if src not in indexes:
            print(f"[index] varrendo {src} ...")
            indexes[src] = index_source(CACHE / src)
        index = indexes[src]

        files = index.get(spec["uid"]) or index.get(spec.get("uid_alt", ""))
        if not files:
            print(f"[ERRO] série {spec['id']} não encontrada em {src}")
            continue

        primeira = pydicom.dcmread(files[0], stop_before_pixels=True, force=True)
        if str(getattr(primeira, "Modality", "")) != "CT":
            raise RuntimeError(f"{spec['id']}: a fonte não é uma série CT")

        # ordena pela posição ao longo da normal do corte
        import pydicom as pd
        heads = []
        for f in files:
            ds = pd.dcmread(f, stop_before_pixels=True, force=True)
            ipp = [float(x) for x in (getattr(ds, "ImagePositionPatient", None) or [0, 0, 0])]
            heads.append((ds, f, ipp))
        n = slice_normal(getattr(heads[0][0], "ImageOrientationPatient", None))
        heads.sort(key=lambda t: t[2][0] * n[0] + t[2][1] * n[1] + t[2][2] * n[2])
        heads = heads[:: spec.get("step", 1)]

        dest = OUT / spec["id"]
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)

        print(f"[build] {spec['id']}: {len(heads)} fatias")
        transcoded = False
        for i, (_, f, _) in enumerate(heads, start=1):
            ds = pd.dcmread(f, force=True)
            if not hasattr(ds, "file_meta") or "TransferSyntaxUID" not in ds.file_meta:
                ds.file_meta = getattr(ds, "file_meta", pd.dataset.FileMetaDataset())
                ds.file_meta.TransferSyntaxUID = pd.uid.ImplicitVRLittleEndian
            if ds.file_meta.TransferSyntaxUID.is_compressed:
                arr = ds.pixel_array
                ds.PixelData = arr.tobytes()
                ds["PixelData"].VR = "OW"
                ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
                transcoded = True
            ds.save_as(dest / f"{i:04d}.dcm", enforce_file_format=True)

        head = pd.dcmread(dest / "0001.dcm", stop_before_pixels=True)
        tail = pd.dcmread(dest / f"{len(heads):04d}.dcm", stop_before_pixels=True)
        p0 = [float(x) for x in (getattr(head, "ImagePositionPatient", None) or [0, 0, 0])]
        p1 = [float(x) for x in (getattr(tail, "ImagePositionPatient", None) or [0, 0, 0])]
        span = sum((p1[k] - p0[k]) * n[k] for k in range(3))
        gap = abs(span) / (len(heads) - 1) if len(heads) > 1 else float(
            getattr(head, "SliceThickness", 1) or 1)
        ps = [float(x) for x in (getattr(head, "PixelSpacing", None) or [1, 1])]
        nbytes = sum(f.stat().st_size for f in dest.glob("*.dcm"))

        entry = {
            "id": spec["id"],
            "label": spec["label"],
            "region": spec["region"],
            "modality": spec["modality"],
            "files": len(heads),
            "rows": int(head.Rows),
            "columns": int(head.Columns),
            "pixelSpacing": [round(ps[0], 6), round(ps[1], 6)],
            "sliceSpacing": round(gap, 6),
            "spanMm": round(abs(span), 2),
            "seriesDescription": str(getattr(head, "SeriesDescription", "") or ""),
            "manufacturer": str(getattr(head, "Manufacturer", "") or ""),
            "bytes": nbytes,
            "transcodedFromJpegLs": transcoded,
            "notes": spec["notes"],
            "attribution": spec["attribution"],
            "path": f"datasets/{spec['id']}",
        }
        manifest.append(entry)
        print(f"          {entry['rows']}x{entry['columns']}x{entry['files']}  "
              f"{ps[0]:.3f}x{ps[1]:.3f}x{gap:.3f} mm  {nbytes/1e6:.1f} MB"
              + ("  [transcodificado de JPEG-LS]" if transcoded else ""))

        write_preview(dest, entry)

    manifest += construir_recortes(indexes)

    (OUT / "manifest.json").write_text(
        json.dumps({"series": manifest}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8")
    total = sum(e["bytes"] for e in manifest)
    print(f"\n[build] {len(manifest)} séries, {total/1e6:.1f} MB no total")


# --------------------------------------------------------------------------
def ordenar_serie(arquivos):
    """Ordena pela projeção na normal e descarta posições repetidas."""
    import pydicom as pd
    itens = []
    for f in arquivos:
        ds = pd.dcmread(f, stop_before_pixels=True, force=True)
        ipp = [float(x) for x in (getattr(ds, "ImagePositionPatient", None) or [0, 0, 0])]
        itens.append((ds, f, ipp))
    n = slice_normal(getattr(itens[0][0], "ImageOrientationPatient", None))
    itens.sort(key=lambda t: t[2][0] * n[0] + t[2][1] * n[1] + t[2][2] * n[2])

    unicos = []
    vistos = set()
    for ds, f, ipp in itens:
        chave = round(ipp[0] * n[0] + ipp[1] * n[1] + ipp[2] * n[2], 3)
        if chave in vistos:
            continue
        vistos.add(chave)
        unicos.append(f)
    return unicos


def construir_recortes(indexes):
    """Gera os volumes regionais derivados."""
    import numpy as np
    import pydicom as pd
    from pydicom.uid import generate_uid

    saida = []
    for spec in RECORTES:
        if "origem" in spec:
            origem = OUT / spec["origem"]
            arquivos = sorted(origem.glob("*.dcm"))
            atribuicao = next((s["attribution"] for s in SERIES
                               if s["id"] == spec["origem"]), "")
            de = f"série {spec['origem']}"
        else:
            fonte = spec["fonte"]
            if fonte not in indexes:
                print(f"[index] varrendo {fonte} ...")
                indexes[fonte] = index_source(CACHE / fonte)
            arquivos = ordenar_serie(indexes[fonte].get(spec["uid"], []))
            atribuicao = spec.get("attribution", "")
            de = fonte

        if not arquivos:
            print(f"[ERRO] recorte {spec['id']}: origem vazia")
            continue

        a, b = spec["cortes"]
        selecao = arquivos[a - 1:b]
        plano = spec.get("plano")
        serie_uid = generate_uid()

        dest = OUT / spec["id"]
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)

        print(f"[recorte] {spec['id']}: cortes {a}–{b} de {de}")
        for i, f in enumerate(selecao, start=1):
            ds = pd.dcmread(f, force=True)
            if plano:
                c0, c1, l0, l1 = plano
                arr = ds.pixel_array[l0:l1, c0:c1]
                ipp = [float(x) for x in ds.ImagePositionPatient]
                iop = [float(x) for x in ds.ImageOrientationPatient]
                ps = [float(x) for x in ds.PixelSpacing]   # [linha, coluna]
                # a origem anda c0 colunas e l0 linhas dentro do plano
                ds.ImagePositionPatient = [
                    f"{ipp[k] + c0 * ps[1] * iop[k] + l0 * ps[0] * iop[3 + k]:.6f}"
                    for k in range(3)]
                ds.Rows, ds.Columns = int(arr.shape[0]), int(arr.shape[1])
                ds.PixelData = np.ascontiguousarray(arr).tobytes()
                ds["PixelData"].VR = "OW"

            # imagem derivada precisa de identificadores próprios
            ds.SpecificCharacterSet = "ISO_IR 192"   # UTF-8, para os acentos
            ds.SOPInstanceUID = generate_uid()
            ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
            ds.SeriesInstanceUID = serie_uid
            ds.SeriesDescription = spec["label"]
            ds.ImageType = ["DERIVED", "SECONDARY"]
            ds.DerivationDescription = (
                f"Recorte regional ({spec['region']}) de {de}: cortes {a}-{b}"
                + (f", plano {plano}" if plano else "") + ".")
            ds.save_as(dest / f"{i:04d}.dcm", enforce_file_format=True)

        head = pd.dcmread(dest / "0001.dcm", stop_before_pixels=True)
        tail = pd.dcmread(dest / f"{len(selecao):04d}.dcm", stop_before_pixels=True)
        n = slice_normal(getattr(head, "ImageOrientationPatient", None))
        p0 = [float(x) for x in head.ImagePositionPatient]
        p1 = [float(x) for x in tail.ImagePositionPatient]
        span = sum((p1[k] - p0[k]) * n[k] for k in range(3))
        gap = abs(span) / (len(selecao) - 1) if len(selecao) > 1 else 1.0
        ps = [float(x) for x in head.PixelSpacing]
        nbytes = sum(f.stat().st_size for f in dest.glob("*.dcm"))

        entry = {
            "id": spec["id"],
            "label": spec["label"],
            "region": spec["region"],
            "modality": spec["modality"],
            "files": len(selecao),
            "rows": int(head.Rows),
            "columns": int(head.Columns),
            "pixelSpacing": [round(ps[0], 6), round(ps[1], 6)],
            "sliceSpacing": round(gap, 6),
            "spanMm": round(abs(span), 2),
            "seriesDescription": spec["label"],
            "manufacturer": str(getattr(head, "Manufacturer", "") or ""),
            "bytes": nbytes,
            "transcodedFromJpegLs": False,
            "derivado": True,
            "notes": spec["notes"],
            "attribution": atribuicao,
            "path": f"datasets/{spec['id']}",
        }
        saida.append(entry)
        print(f"           {entry['rows']}x{entry['columns']}x{entry['files']}  "
              f"{ps[0]:.3f}x{ps[1]:.3f}x{gap:.3f} mm  {nbytes/1e6:.1f} MB")
        write_preview(dest, entry)

    return saida


# --------------------------------------------------------------------------
def write_preview(dest: Path, entry: dict):
    """Gera um PNG com um MIP coronal — usado como miniatura e para conferência."""
    import numpy as np
    import pydicom
    from PIL import Image

    files = sorted(dest.glob("*.dcm"))
    step = max(1, len(files) // 96)
    vol = []
    for f in files[::step]:
        ds = pydicom.dcmread(f)
        a = ds.pixel_array.astype(np.float32)
        a = a * float(getattr(ds, "RescaleSlope", 1) or 1) + float(getattr(ds, "RescaleIntercept", 0) or 0)
        vol.append(a)
    v = np.stack(vol)                       # (z, y, x)
    cor = v.max(axis=1)                     # MIP coronal -> (z, x)
    cor = np.flipud(cor)
    lo, hi = np.percentile(cor, [1, 99.5])
    img = np.clip((cor - lo) / max(hi - lo, 1e-6), 0, 1)

    zsp = entry["sliceSpacing"] * step
    h = max(1, int(round(cor.shape[0] * zsp)))
    w = max(1, int(round(cor.shape[1] * entry["pixelSpacing"][1])))
    scale = 320 / max(h, w)
    im = Image.fromarray((img * 255).astype(np.uint8)).resize(
        (max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    im.save(dest.parent / f"{entry['id']}.png")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("fetch", "all"):
        fetch()
    if cmd in ("build", "all"):
        build()
