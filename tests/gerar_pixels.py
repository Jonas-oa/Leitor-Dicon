#!/usr/bin/env python3
"""Gera casos pequenos para fidelidade de pixels e segurança da interface."""
from pathlib import Path

import numpy as np
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid


RAIZ = Path(__file__).resolve().parent / "dados" / "pixels"


def base(path: Path, *, modalidade="CT", descricao="Teste", serie_uid=None):
    meta = FileMetaDataset()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.MediaStorageSOPClassUID = generate_uid()
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.ImplementationClassUID = generate_uid()
    ds = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = serie_uid or generate_uid()
    ds.SeriesDescription = descricao
    ds.Modality = modalidade
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    return ds


def gravar_mono(nome, valores, *, signed=False, bits=16, slope=1, intercept=0,
                 photo="MONOCHROME2"):
    path = RAIZ / f"{nome}.dcm"
    ds = base(path)
    ds.Rows = 1
    ds.Columns = len(valores)
    ds.BitsStored = bits
    ds.HighBit = bits - 1
    ds.PixelRepresentation = 1 if signed else 0
    ds.RescaleSlope = str(slope)
    ds.RescaleIntercept = str(intercept)
    ds.PhotometricInterpretation = photo
    ds.PixelData = np.array(valores, dtype="<u2").tobytes()
    ds.save_as(path, enforce_file_format=True)


def gravar_volume(diretorio, *, modalidade="CT", photo="MONOCHROME2",
                  descricao="Volume", malicioso=False, posicoes=None,
                  sem_geometria=False):
    destino = RAIZ / diretorio
    destino.mkdir(parents=True, exist_ok=True)
    uid = generate_uid()
    posicoes = posicoes or [0, 1]
    for k, posicao in enumerate(posicoes):
        desc = ('<img src=x onerror="document.body.dataset.dicomXss=1">'
                if malicioso and k == 0 else descricao)
        ds = base(destino / f"{k + 1:04d}.dcm", modalidade=modalidade,
                  descricao=desc, serie_uid=uid if not malicioso else generate_uid())
        ds.Rows = 1
        ds.Columns = 3
        if not sem_geometria:
            ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
            ds.ImagePositionPatient = posicao if isinstance(posicao, list) else [0, 0, posicao]
            ds.PixelSpacing = [1, 1]
            ds.SliceThickness = 1
        ds.PhotometricInterpretation = photo
        ds.PixelData = np.array([0, 100, 200], dtype="<u2").tobytes()
        ds.save_as(destino / f"{k + 1:04d}.dcm", enforce_file_format=True)


def main():
    RAIZ.mkdir(parents=True, exist_ok=True)
    # Signed 12-bit com bits superiores zerados: exige extensão de sinal pelo HighBit.
    gravar_mono("signed12", [0x800, 0xFFF, 0, 0x7FF], signed=True, bits=12)
    gravar_mono("unsigned16", [0, 32767, 40000, 65535])
    gravar_mono("slope", [1, 3, 5], slope=0.5)

    rgb = base(RAIZ / "rgb-planar.dcm")
    rgb.Rows = 1
    rgb.Columns = 2
    rgb.SamplesPerPixel = 3
    rgb.PhotometricInterpretation = "RGB"
    rgb.PlanarConfiguration = 1
    rgb.BitsAllocated = rgb.BitsStored = 8
    rgb.HighBit = 7
    rgb.PixelData = bytes([255, 0, 0, 255, 0, 0])
    rgb.save_as(RAIZ / "rgb-planar.dcm", enforce_file_format=True)

    gravar_volume("mono1", photo="MONOCHROME1")
    gravar_volume("nao-ct", modalidade="MR")
    gravar_volume("sem-geometria", sem_geometria=True)
    gravar_volume("gantry", posicoes=[[0, 0, 0], [0.2, 0, 1]])
    gravar_volume("irregular", posicoes=[0, 1, 3])
    gravar_volume("malicioso", malicioso=True)
    print("  pixels       casos de faixa, sinal, MONOCHROME1, RGB e segurança")


if __name__ == "__main__":
    main()
