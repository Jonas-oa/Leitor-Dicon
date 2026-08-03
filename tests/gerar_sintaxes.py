#!/usr/bin/env python3
"""
Gera variantes da mesma série em diferentes sintaxes de transferência, para
verificar que o parser produz exatamente os mesmos pixels em todas elas — e que
recusa com uma mensagem clara as que não sabe abrir.

    python3 tests/gerar_sintaxes.py     (depende de tests/dados/axial)
"""
import shutil
from pathlib import Path

import pydicom
from pydicom.uid import (ExplicitVRBigEndian, ImplicitVRLittleEndian,
                         RLELossless, JPEGLSLossless)

RAIZ = Path(__file__).resolve().parent
ORIGEM = RAIZ / "dados" / "axial"

VARIANTES = [
    ("implicit-le", ImplicitVRLittleEndian),
    ("explicit-be", ExplicitVRBigEndian),
    ("rle", RLELossless),
    ("jpegls", JPEGLSLossless),      # não suportado pelo leitor: deve dar erro claro
]


def main():
    if not ORIGEM.exists():
        raise SystemExit("rode antes: python3 tests/gerar_sinteticos.py")

    arquivos = sorted(ORIGEM.glob("*.dcm"))[:12]
    for nome, sintaxe in VARIANTES:
        destino = RAIZ / "dados" / f"sintaxe-{nome}"
        if destino.exists():
            shutil.rmtree(destino)
        destino.mkdir(parents=True)
        try:
            for i, f in enumerate(arquivos, start=1):
                ds = pydicom.dcmread(f)
                if sintaxe.is_compressed:
                    ds.compress(sintaxe)
                else:
                    ds.file_meta.TransferSyntaxUID = sintaxe
                if sintaxe == ExplicitVRBigEndian:
                    # o pydicom não inverte os bytes de PixelData (OW) ao gravar
                    # em big endian — a troca tem de ser feita aqui, senão o
                    # arquivo fica com pixels little endian num dataset BE.
                    import numpy as np
                    ds.PixelData = (np.frombuffer(ds.PixelData, dtype="<u2")
                                    .astype(">u2").tobytes())
                    ds["PixelData"].VR = "OW"
                    pydicom.dcmwrite(destino / f"{i:04d}.dcm", ds, implicit_vr=False,
                                     little_endian=False, enforce_file_format=True)
                else:
                    ds.save_as(destino / f"{i:04d}.dcm", enforce_file_format=True)
            print(f"  {nome:<12} {len(arquivos)} arquivos")
        except Exception as e:
            shutil.rmtree(destino)
            if nome == "jpegls":
                # Para testar a recusa do leitor basta uma encapsulação marcada
                # como JPEG-LS; não é necessário um codificador JPEG-LS real.
                # O payload deliberadamente não é decodificado pelo leitor.
                from pydicom.encaps import encapsulate
                destino.mkdir(parents=True)
                for i, f in enumerate(arquivos, start=1):
                    ds = pydicom.dcmread(f)
                    ds.PixelData = encapsulate([ds.PixelData])
                    ds["PixelData"].VR = "OB"
                    ds.file_meta.TransferSyntaxUID = JPEGLSLossless
                    ds.save_as(destino / f"{i:04d}.dcm", enforce_file_format=True)
                print(f"  {nome:<12} {len(arquivos)} arquivos (marcador de sintaxe)")
            else:
                print(f"  {nome:<12} PULADO ({type(e).__name__}: {e})")


if __name__ == "__main__":
    main()
