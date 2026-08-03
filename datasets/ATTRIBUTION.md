# Créditos e licenças dos exames

As três séries em `datasets/` são tomografias DICOM reais, anonimizadas,
redistribuídas de repositórios públicos com licença permissiva. Nenhuma foi
sintetizada ou convertida de outro formato.

O que a preparação (`scripts/prepare_datasets.py`) faz com os arquivos:

* seleciona uma série pelo `SeriesInstanceUID`;
* reordena as fatias pela projeção de `ImagePositionPatient` na normal do corte
  e as renomeia para `0001.dcm`, `0002.dcm`, …;
* transcodifica de JPEG-LS *lossless* para Explicit VR Little Endian quando
  necessário — os valores de pixel são bit-a-bit idênticos aos originais;
* em uma série, mantém apenas 1 de cada 2 fatias (indicado abaixo).

Os cabeçalhos DICOM não são alterados de nenhuma outra forma.

---

## FNNDSC/data

<https://github.com/FNNDSC/data> — Apache License 2.0
Boston Children's Hospital, Fetal-Neonatal Neuroimaging & Developmental Science
Center. Conjunto de dados de exemplo da biblioteca [AMI](https://github.com/FNNDSC/ami).

| Série neste repositório | Origem no repositório |
|---|---|
| `ct-torax-alta-resolucao` | `dicom/andrei_abdomen/data` — TC de tórax 1 mm (**1 de cada 2 fatias**, ≈ 2 mm) |

## OHIF/viewer-testdata

<https://github.com/OHIF/viewer-testdata> — MIT License
Open Health Imaging Foundation.

| Série neste repositório | Origem no repositório |
|---|---|
| `ct-corpo-inteiro` | `dcm/Juno` — `CT WB 5.0 B35f`, série de TC de corpo inteiro |
| `ct-torax-petct` | `dcm/acrin` — `CT IMAGES` |

As séries `dcm/acrin` são dados do estudo ACRIN obtidos do
[The Cancer Imaging Archive (TCIA)](https://www.cancerimagingarchive.net/),
distribuídos pelo TCIA sob **CC BY 3.0**. Ao usá-las, cite o TCIA conforme a
[política de citação](https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/).

`ct-corpo-inteiro` e `ct-torax-petct` estavam em JPEG-LS Lossless na origem e
foram transcodificadas sem perdas. Embora as fontes também contenham outras
modalidades, somente os componentes de tomografia são redistribuídos aqui.

---

## Dados sintéticos

As séries em `tests/dados/` são geradas por `tests/gerar_sinteticos.py` e
`tests/gerar_sintaxes.py`. Não contêm dados de pacientes: são padrões
geométricos criados para verificar a reorientação do volume, o parser e a
recusa explícita de modalidades diferentes de CT.

---

## Uso

Nenhuma destas imagens serve para diagnóstico. Todas já vêm anonimizadas da
origem; nomes e identificadores presentes nos cabeçalhos são pseudônimos
atribuídos pelos próprios repositórios de origem.
