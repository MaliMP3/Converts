# Converts

Projeto open source para Windows. O Converts fica na bandeja, em segundo plano, e abre um seletor redondo para converter arquivos e mídias. O resultado vai para `Downloads\Converts`.

O atalho padrão é `Ctrl+Shift+Espaço`. Dá para trocar esse atalho dentro do próprio seletor.

## Baixar e usar

Se você só quer usar o Converts, não precisa instalar Node. Clique no botão, baixe o arquivo e abra.

[![Baixar Converts para Windows](https://img.shields.io/badge/Baixar-Converts.exe-0A7EA4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/MaliMP3/Converts/releases/latest/download/Converts.exe)

Outras versões ficam na [página de Releases](https://github.com/MaliMP3/Converts/releases).

Depois de abrir:

1. O ícone aparece na bandeja
2. O app continua em segundo plano até você desligar o PC, ou até escolher Sair no menu da bandeja
3. Para converter, use `Ctrl+Shift+Espaço`
4. Escolha se é arquivo ou áudio, escolha o formato e pronto

Se o Word, o Excel ou o PowerPoint estiver aberto, o Converts usa o arquivo que está na frente, inclusive alteração que ainda não foi salva. Se não houver arquivo na janela ativa, ele abre o gerenciador para você escolher.

## O que ele converte

Arquivos de saída:

- PDF
- DOCX
- PNG
- JPEG
- SVG
- HTML
- TXT
- RTF

Áudio e vídeo de saída:

- MP3
- WAV
- M4A
- FLAC
- OGG
- MP4
- MKV
- WEBM

Também entram como origem, além desses formatos: DOC, DOCM, ODT, XLS, XLSX, XLSM, CSV, PPT, PPTX, WEBP, GIF, BMP, TIFF, AAC, OPUS, WMA, MOV e AVI.

Imagem não vira áudio, e áudio não vira imagem. O seletor avisa quando a combinação não existe.

## Rodar pelo código

Para testar ou alterar o projeto, precisa do [Node.js](https://nodejs.org) LTS, no Windows.

```
git clone https://github.com/MaliMP3/Converts.git
cd Converts
cd converts
npm install
npm start
```

Também dá para abrir pelo `converts.bat`, na raiz do projeto. Na primeira vez ele instala sozinho e depois sobe o app. Se quiser, coloque um atalho desse arquivo na área de trabalho.

## Contribuir

O Converts é open source. Qualquer pessoa pode usar, estudar, fazer fork e contribuir.

Se quiser ajudar:

1. Faça um fork do repositório
2. Crie uma branch para a sua alteração
3. Abra um pull request descrevendo o que mudou

Sugestões, correções e melhorias são bem-vindas. Se achar um bug ou tiver uma ideia, abra uma issue no GitHub.
