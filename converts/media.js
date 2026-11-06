const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MEDIA = [
  { id: 'mp3', label: 'MP3', ext: '.mp3' },
  { id: 'wav', label: 'WAV', ext: '.wav' },
  { id: 'm4a', label: 'M4A', ext: '.m4a' },
  { id: 'flac', label: 'FLAC', ext: '.flac' },
  { id: 'ogg', label: 'OGG', ext: '.ogg' },
  { id: 'mp4', label: 'MP4', ext: '.mp4' },
  { id: 'mkv', label: 'MKV', ext: '.mkv' },
  { id: 'webm', label: 'WEBM', ext: '.webm' },
];

const MEDIA_EXT = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wma',
  '.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi',
]);

function ffmpegBin() {
  const bundled = require('ffmpeg-static');
  if (bundled && fs.existsSync(bundled)) return bundled;
  return 'ffmpeg';
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), ['-nostdin', '-hide_banner', '-y', ...args], {
      windowsHide: true,
    });
    let err = '';
    child.stderr.on('data', (chunk) => {
      err = (err + chunk.toString('utf8')).slice(-1500);
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim().split(/\r?\n/).pop() || 'O ffmpeg não concluiu a conversão.'));
    });
  });
}

function attempts(formatId) {
  if (formatId === 'mp3') return [['-vn', '-c:a', 'libmp3lame', '-q:a', '2']];
  if (formatId === 'wav') return [['-vn', '-c:a', 'pcm_s16le']];
  if (formatId === 'm4a') return [['-vn', '-c:a', 'aac', '-b:a', '192k']];
  if (formatId === 'flac') return [['-vn', '-c:a', 'flac']];
  if (formatId === 'ogg') return [['-vn', '-c:a', 'libvorbis', '-q:a', '5']];
  if (formatId === 'mp4') {
    return [
      ['-c', 'copy', '-movflags', '+faststart'],
      ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'],
      ['-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
    ];
  }
  if (formatId === 'mkv') {
    return [
      ['-c', 'copy'],
      ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k'],
      ['-vn', '-c:a', 'aac', '-b:a', '192k'],
    ];
  }
  return [
    ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-c:a', 'libopus', '-b:a', '128k'],
    ['-vn', '-c:a', 'libopus', '-b:a', '128k'],
  ];
}

async function convertMedia(source, formatId, dest) {
  const format = MEDIA.find((item) => item.id === formatId);
  if (!format) throw new Error('Formato de áudio desconhecido.');
  if (!source || !source.path || !fs.existsSync(source.path)) {
    throw new Error('Não encontrei o áudio para converter.');
  }
  const ext = (source.ext || path.extname(source.path) || '').toLowerCase();
  if (!MEDIA_EXT.has(ext)) throw new Error('Esse arquivo não é áudio nem vídeo.');
  if (ext === format.ext) {
    fs.copyFileSync(source.path, dest);
    return;
  }
  let last = null;
  for (const codec of attempts(formatId)) {
    fs.rmSync(dest, { force: true });
    try {
      await runFfmpeg(['-i', source.path, ...codec, dest]);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 32) return;
    } catch (error) {
      last = error;
    }
  }
  throw last || new Error('Não consegui converter esse áudio.');
}

module.exports = { MEDIA, MEDIA_EXT, convertMedia };
