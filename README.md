# Converts

Conversor de arquivos para Windows. Ele fica na bandeja, em segundo plano, e abre um seletor redondo para escolher o formato. O arquivo convertido vai para `Downloads\Converts`.

O atalho padrão é `Ctrl+Shift+Espaço`. Dá para trocar esse atalho dentro do próprio seletor.

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

Também entra como origem, além desses formatos: DOC, DOCM, ODT, XLS, XLSX, XLSM, CSV, PPT, PPTX, WEBP, GIF, BMP, TIFF, AAC, OPUS, WMA, MOV e AVI.

Imagem não vira áudio, e áudio não vira imagem. O seletor avisa quando a combinação não existe.

Se o Word, o Excel ou o PowerPoint estiver aberto, o Converts usa o arquivo que está na frente, inclusive alteração que ainda não foi salva. Se não houver arquivo na janela ativa, ele abre o gerenciador para você escolher.

## Como instalar

Precisa do [Node.js](https://nodejs.org) LTS, no Windows.

Clone o repositório e entre na pasta:

```
git clone https://github.com/MaliMP3/Converts.git
cd Converts
```

Instale e abra:

```
cd converts
npm install
npm start
```

Também dá para abrir pelo `converts.bat`, na raiz do projeto. Na primeira vez ele instala sozinho e depois sobe o app. Coloque um atalho desse arquivo na área de trabalho e use esse atalho para abrir.

Quando abrir, o ícone fica na bandeja. O Converts continua em segundo plano até você desligar o computador, ou até escolher Sair no menu da bandeja. Na próxima vez que ligar o PC, abra de novo pelo atalho da área de trabalho.
