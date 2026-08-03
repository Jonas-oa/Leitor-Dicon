#!/usr/bin/env python3
"""
Gera séries DICOM sintéticas para testar a reorientação do volume.

Cada série contém um marcador em uma posição LPS conhecida. As séries diferem
no plano de aquisição e na ordem em que os arquivos são gravados, de modo que
o leitor só acerta se realmente usar ImageOrientationPatient e
ImagePositionPatient para montar o volume (e não a ordem dos arquivos).

    python3 tests/gerar_sinteticos.py
"""
import json
import shutil
from pathlib import Path

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid

RAIZ = Path(__file__).resolve().parent
SAIDA = RAIZ / "dados"

# marcador em coordenadas LPS (mm) — assimétrico nos três eixos
MARCADOR = (30.0, -20.0, 25.0)
RAIO = 6.0

# caixa amostrada: LPS de -50..50 (x), -60..60 (y), -40..40 (z)
LIM = ((-50.0, 50.0), (-60.0, 60.0), (-40.0, 40.0))
PASSO = 2.0


def intensidade(x, y, z):
    """Marcador brilhante + um gradiente suave de fundo."""
    d = np.sqrt((x - MARCADOR[0]) ** 2 + (y - MARCADOR[1]) ** 2 + (z - MARCADOR[2]) ** 2)
    fundo = 100 + 0.2 * (x + y + z)
    return np.where(d < RAIO, 2000.0, fundo)


def gravar_serie(nome, dir_linha, dir_coluna, normal, inverter_ordem=False):
    """
    dir_linha   direção (LPS) de crescimento do índice de COLUNA
    dir_coluna  direção (LPS) de crescimento do índice de LINHA
    normal      direção de avanço entre cortes
    """
    dir_linha = np.array(dir_linha, float)
    dir_coluna = np.array(dir_coluna, float)
    normal = np.array(normal, float)

    def extensao(v):
        """Quantos mm a caixa mede na direção v (que é um eixo puro)."""
        eixo = int(np.argmax(np.abs(v)))
        return LIM[eixo][1] - LIM[eixo][0], eixo

    larg_mm, _ = extensao(dir_linha)
    alt_mm, _ = extensao(dir_coluna)
    prof_mm, _ = extensao(normal)

    colunas = int(larg_mm / PASSO)
    linhas = int(alt_mm / PASSO)
    cortes = int(prof_mm / PASSO)

    # canto da caixa a partir do qual caminhamos nas três direções positivas
    centro = np.array([(a + b) / 2 for a, b in LIM])
    origem = (centro
              - dir_linha * (larg_mm - PASSO) / 2
              - dir_coluna * (alt_mm - PASSO) / 2
              - normal * (prof_mm - PASSO) / 2)

    destino = SAIDA / nome
    if destino.exists():
        shutil.rmtree(destino)
    destino.mkdir(parents=True)

    estudo = generate_uid()
    serie = generate_uid()
    quadro = generate_uid()

    j, i = np.mgrid[0:linhas, 0:colunas]
    for k in range(cortes):
        pos = origem + normal * (k * PASSO)
        pontos = (pos[None, None, :]
                  + dir_linha[None, None, :] * (i * PASSO)[:, :, None]
                  + dir_coluna[None, None, :] * (j * PASSO)[:, :, None])
        valores = intensidade(pontos[:, :, 0], pontos[:, :, 1], pontos[:, :, 2])

        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = CTImageStorage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        meta.ImplementationClassUID = generate_uid()

        ds = Dataset()
        ds.file_meta = meta
        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID = estudo
        ds.SeriesInstanceUID = serie
        ds.FrameOfReferenceUID = quadro
        ds.Modality = "CT"
        ds.PatientName = "Sintetico^Teste"
        ds.PatientID = "TESTE"
        ds.SeriesDescription = nome
        ds.StudyDate = "20240101"
        ds.StudyTime = "120000"

        ds.Rows = linhas
        ds.Columns = colunas
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 1
        ds.RescaleIntercept = 0
        ds.RescaleSlope = 1
        ds.WindowCenter = 1000
        ds.WindowWidth = 2000

        ds.PixelSpacing = [PASSO, PASSO]          # [linha, coluna]
        ds.SliceThickness = PASSO
        ds.ImageOrientationPatient = [*dir_linha, *dir_coluna]
        ds.ImagePositionPatient = [float(v) for v in pos]
        ds.InstanceNumber = k + 1

        ds.PixelData = valores.astype(np.int16).tobytes()

        # a ordem do NOME do arquivo é embaralhada de propósito
        indice = (cortes - 1 - k) if inverter_ordem else k
        ds.save_as(destino / f"{indice + 1:04d}.dcm", enforce_file_format=True)

    return {
        "id": nome,
        "label": nome,
        "region": "sintético",
        "modality": "CT",
        "files": cortes,
        "path": f"tests/dados/{nome}",
        "esperado": list(MARCADOR),
    }


def main():
    SAIDA.mkdir(parents=True, exist_ok=True)
    series = [
        # axial: linha -> +x (esquerda), coluna -> +y (posterior), cortes -> +z
        gravar_serie("axial", [1, 0, 0], [0, 1, 0], [0, 0, 1]),
        # axial com cortes descendo e arquivos nomeados ao contrário
        gravar_serie("axial-invertido", [1, 0, 0], [0, 1, 0], [0, 0, -1], inverter_ordem=True),
        # sagital: linha -> +y, coluna -> -z, cortes -> +x
        gravar_serie("sagital", [0, 1, 0], [0, 0, -1], [1, 0, 0]),
        # coronal: linha -> +x, coluna -> -z, cortes -> +y
        gravar_serie("coronal", [1, 0, 0], [0, 0, -1], [0, 1, 0]),
        # axial com paciente "de cabeça para baixo" na mesa
        gravar_serie("axial-espelhado", [-1, 0, 0], [0, -1, 0], [0, 0, 1]),
    ]
    (SAIDA / "series.json").write_text(json.dumps(series, indent=1) + "\n")
    for s in series:
        print(f"  {s['id']:<18} {s['files']} cortes")
    print(f"marcador esperado em LPS {MARCADOR}")


if __name__ == "__main__":
    main()
