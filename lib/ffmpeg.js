// ffmpeg.js — spawn helpers with structured progress for the job bus.
'use strict';
const { spawn, execFile } = require('child_process');

function ffprobeJson(file) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', file,
    ], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}

async function mediaInfo(file) {
  const j = await ffprobeJson(file);
  const v = (j.streams || []).find(s => s.codec_type === 'video') || {};
  const a = (j.streams || []).find(s => s.codec_type === 'audio') || {};
  const fps = (() => {
    const r = v.avg_frame_rate || v.r_frame_rate || '0/1';
    const [n, d] = r.split('/').map(Number);
    return d ? n / d : 0;
  })();
  return {
    duration: parseFloat(j.format?.duration || v.duration || 0),
    bitrateKbps: Math.round((parseInt(j.format?.bit_rate || 0, 10)) / 1000),
    vcodec: v.codec_name || null,
    acodec: a.codec_name || null,
    width: v.width || 0,
    height: v.height || 0,
    pixFmt: v.pix_fmt || null,
    profile: v.profile || null,
    level: v.level || null,
    fps,
    colorPrimaries: v.color_primaries || null,
    colorTrc: v.color_transfer || null,
    colorSpace: v.color_space || null,
    colorRange: v.color_range || null,
    bitDepth: (v.bits_per_raw_sample && parseInt(v.bits_per_raw_sample, 10)) ||
              (/10le|10be|p010/.test(v.pix_fmt || '') ? 10 :
               /12le|12be/.test(v.pix_fmt || '') ? 12 : 8),
    chroma: /444/.test(v.pix_fmt || '') ? '4:4:4' :
            /422/.test(v.pix_fmt || '') ? '4:2:2' : '4:2:0',
  };
}

// Run ffmpeg, emit {frame, time, speed} via onProgress, resolve on exit 0.
function runFfmpeg(args, { onProgress, onLog } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-y', ...args]);
    let tail = '';
    p.stderr.on('data', (buf) => {
      const s = buf.toString();
      tail = (tail + s).slice(-4000);
      if (onLog) onLog(s);
      const t = /time=(\d+):(\d+):([\d.]+)/.exec(s);
      if (t && onProgress) {
        const sec = (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3]);
        const sp = /speed=\s*([\d.]+)x/.exec(s);
        onProgress({ time: sec, speed: sp ? parseFloat(sp[1]) : null });
      }
    });
    p.on('error', reject);
    p.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`ffmpeg exit ${code}\n${tail}`)));
  });
}

module.exports = { ffprobeJson, mediaInfo, runFfmpeg };
