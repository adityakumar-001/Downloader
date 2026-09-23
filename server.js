// Video Downloader Server - No login, No length limit
// Sirf link paste karo, video download karo (Video + Audio merged)
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');

console.log('ffmpeg:', ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// URL valid hai ya nahi
function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Direct video/audio file hai? (.mp4, .mp3 ...)
function isDirectFile(url) {
  return /\.(mp4|webm|mkv|mov|m4a|mp3|wav|ogg|flv|avi)(\?|#|$)/i.test(url);
}

// Safe filename banao
function safeFilename(name, ext) {
  let base = (name || 'video').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 100);
  if (!base) base = 'video';
  if (ext && !base.toLowerCase().endsWith(ext.toLowerCase())) base += ext;
  return base;
}

// Quality -> yt-dlp format string
// HAMESHA video+audio dono manga jata hai taaki silent video na aaye.
// Merge ke liye ffmpeg use hota hai (ffmpeg-static, install ki jarurat nahi).
// Koi length limit nahi hai - 10 sec ho ya 10 ghante, sab chalega.
function qualityToFormat(q) {
  switch (q) {
    case '2160':
    case '4k':
      return 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best';
    case '1440':
      return 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best';
    case '1080':
      return 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
    case '480':
      return 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
    case '360':
      return 'bestvideo[height<=360]+bestaudio/best[height<=360]/best';
    case 'audio':
    case 'mp3':
      return 'bestaudio/best';
    case 'best':
      return 'bestvideo+bestaudio/best';
    case '720':
    default:
      return 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
  }
}

// Temp folder (merge ke liye file pehle yahan download hogi, phir user ko jayegi)
const TMP_DIR = path.join(__dirname, 'temp');
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch { /* ignore */ }

function tmpBase() {
  return path.join(TMP_DIR, 'dl_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex'));
}

function cleanupFiles(base) {
  try {
    const dir = path.dirname(base);
    const prefix = path.basename(base);
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function bestQuality(q) {
  const map = { '2160': '2160p', '4k': '2160p', '1440': '1440p', '1080': '1080p', '720': '720p', '480': '480p', '360': '360p', 'audio': 'audio', 'mp3': 'audio', 'best': 'best' };
  return map[q] || 'best';
}

// Bytes ko MB/GB me dikhao
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return null;
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function fsize(f) {
  return f.filesize || f.filesize_approx || 0;
}

// Quality ke hisaab se andazan file size (video+audio merged ka jod)
function estimateSize(formats, q) {
  if (!Array.isArray(formats) || !formats.length) return 0;
  if (q === 'audio' || q === 'mp3') {
    let best = 0;
    for (const f of formats) {
      if ((!f.height || f.vcodec === 'none') && f.acodec !== 'none') {
        best = Math.max(best, fsize(f));
      }
    }
    return best;
  }
  const H = q === 'best' ? Infinity : parseInt(q, 10) || 720;
  let bestV = 0, bestA = 0, bestCombined = 0;
  for (const f of formats) {
    const s = fsize(f);
    const hasV = f.vcodec && f.vcodec !== 'none';
    const hasA = f.acodec && f.acodec !== 'none';
    const h = f.height || 0;
    if (hasV && hasA && h <= H) bestCombined = Math.max(bestCombined, s);
    if (hasV && !hasA && h <= H && h > 0) bestV = Math.max(bestV, s);
    if (!hasV && hasA) bestA = Math.max(bestA, s);
  }
  return Math.max(bestCombined, bestV + bestA);
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Server chal raha hai. No login chahiye.' });
});

// ---- STEP 1: Link ki info nikalo (title, thumbnail, duration) ----
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !isValidUrl(url)) {
      return res.status(400).json({ error: 'Sahi video link paste karo (https://...)' });
    }

    // Direct .mp4 link hai to yt-dlp ki jarurat nahi (HEAD se size nikalo)
    if (isDirectFile(url)) {
      const name = url.split('/').pop().split('?')[0] || 'video.mp4';
      let sizeText = null, size = null;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const head = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
        clearTimeout(t);
        const len = parseInt(head.headers.get('content-length') || '0', 10);
        if (len > 0) { size = len; sizeText = formatBytes(len); }
      } catch { /* size unknown rahega */ }
      const qlabel = sizeText ? `Original Quality • ~${sizeText}` : 'Original Quality';
      return res.json({
        direct: true,
        title: name,
        thumbnail: null,
        duration: null,
        durationText: 'Direct file',
        uploader: null,
        qualities: [
          { id: 'best', label: qlabel, size, sizeText },
          { id: 'audio', label: 'Audio only (MP3)', size: null, sizeText: null },
        ],
      });
    }

    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true,
      noPlaylist: true,
    });

    // Duration: koi limit nahi, bas display karo
    let durationText = 'Live / Unknown';
    if (info.duration) {
      const s = Math.floor(info.duration);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      durationText = h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
        : `${m}:${String(sec).padStart(2, '0')}`;
    } else if (info.is_live) {
      durationText = 'LIVE';
    }

    let thumbnail = null;
    if (info.thumbnail) thumbnail = info.thumbnail;
    else if (Array.isArray(info.thumbnails) && info.thumbnails.length) {
      thumbnail = info.thumbnails[info.thumbnails.length - 1].url;
    }

    // Kaunsi quality available hai, ye formats se nikalo
    const heights = new Set();
    if (Array.isArray(info.formats)) {
      for (const f of info.formats) {
        if (f.height && f.vcodec !== 'none') heights.add(f.height);
      }
    }
    const qdefs = [{ id: 'best', label: 'Best Quality ⭐' }];
    for (const h of [2160, 1440, 1080, 720, 480, 360]) {
      if ([...heights].some((x) => x >= h - 60)) {
        const name = h === 1080 ? '1080p Full HD' : h === 720 ? '720p HD' : h + 'p';
        qdefs.push({ id: String(h), label: name });
      }
    }
    // Agar formats se pata na chale to standard options do
    if (qdefs.length <= 1) {
      qdefs.push(
        { id: '1080', label: '1080p Full HD' },
        { id: '720', label: '720p HD' },
        { id: '480', label: '480p' },
        { id: '360', label: '360p' },
      );
    }
    qdefs.push({ id: 'audio', label: 'Audio only (MP3)' });

    // Har quality ke saath andazan size (MB/GB) jodo
    const qualities = qdefs.map((q) => {
      const bytes = estimateSize(info.formats, q.id);
      const sizeText = formatBytes(bytes);
      return {
        id: q.id,
        label: sizeText ? `${q.label} • ~${sizeText}` : q.label,
        size: bytes || null,
        sizeText: sizeText || null,
      };
    });

    res.json({
      direct: false,
      title: info.title || 'Untitled Video',
      thumbnail,
      duration: info.duration || null,
      durationText,
      uploader: info.uploader || info.channel || null,
      webpage: info.webpage_url || url,
      qualities,
    });
  } catch (e) {
    console.error('INFO ERROR:', e.message);
    const msg = String(e.message || '');
    if (msg.includes('Private') || msg.includes('Login required')) {
      return res.status(400).json({ error: 'Ye video private hai ya login mangta hai. Public video ka link try karo (login ki jarurat nahi hai public videos ke liye).' });
    }
    if (msg.includes('Unsupported URL') || msg.includes('not a valid URL')) {
      return res.status(400).json({ error: 'Ye link support nahi hota. YouTube, Instagram, Facebook, TikTok, X, Vimeo, Dailymotion ka public link try karo.' });
    }
    res.status(500).json({ error: 'Video ki info nahi mil payi. Link check karke dobara try karo.' });
  }
});

// ---- STEP 2: Video download karo (Video + Audio MERGED) ----
app.get('/api/download', async (req, res) => {
  const base = tmpBase();
  try {
    const { url, quality = 'best' } = req.query;
    if (!url || !isValidUrl(url)) {
      return res.status(400).send('Sahi video link do');
    }

    // Direct file -> seedha proxy karke de do
    if (isDirectFile(url)) {
      const name = safeFilename(url.split('/').pop().split('?')[0], '');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      const r = await fetch(url);
      if (!r.ok) return res.status(502).send('File download nahi ho payi');
      res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
      const len = r.headers.get('content-length');
      if (len) res.setHeader('Content-Length', len);
      const buf = Buffer.from(await r.arrayBuffer());
      return res.send(buf);
    }

    const isAudio = quality === 'audio' || quality === 'mp3';
    const format = qualityToFormat(quality);

    // Pehle title pata karo (filename ke liye)
    let title = 'video';
    try {
      const meta = await youtubedl(url, {
        getFilename: true,
        output: '%(title)s',
        noPlaylist: true,
        noWarnings: true,
      });
      title = String(meta).trim().split('\n')[0] || 'video';
    } catch { /* ignore, default naam use hoga */ }

    const filename = safeFilename(title, isAudio ? '.mp3' : '.mp4');

    // yt-dlp se TEMP FILE me download + ffmpeg se merge (audio fix)
    const outputTemplate = base + '.%(ext)s';
    const args = {
      format,
      output: outputTemplate,
      quiet: true,
      noWarnings: true,
      noCheckCertificates: true,
      noPlaylist: true,
      preferFreeFormats: true,
      ffmpegLocation: ffmpegPath,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
    };
    if (isAudio) {
      args.extractAudio = true;
      args.audioFormat = 'mp3';
      args.audioQuality = 0;
    } else {
      // video+audio ko mp4 me merge karo taaki har player me audio baje
      args.mergeOutputFormat = 'mp4';
      args.remuxVideo = 'mp4';
    }

    try {
      await youtubedl(url, args);
    } catch (e) {
      // Merge fail ho to fallback: single file (isme audio pehle se hota hai)
      console.error('MERGE TRY FAIL, fallback:', e.message);
      cleanupFiles(base);
      await youtubedl(url, {
        format: 'best[ext=mp4]/best',
        output: outputTemplate,
        quiet: true,
        noWarnings: true,
        noCheckCertificates: true,
        noPlaylist: true,
        ffmpegLocation: ffmpegPath,
      });
    }

    // Bani hui file dhoondo (dl_xxx.mp4 / .mp3 / .webm ...)
    let file = null;
    try {
      const prefix = path.basename(base);
      for (const f of fs.readdirSync(TMP_DIR)) {
        if (f.startsWith(prefix)) { file = path.join(TMP_DIR, f); break; }
      }
    } catch { /* ignore */ }
    if (!file || !fs.existsSync(file)) {
      cleanupFiles(base);
      return res.status(500).send('Download fail ho gaya (file nahi bani)');
    }

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('X-Filename', encodeURIComponent(filename));

    res.sendFile(file, (err) => {
      cleanupFiles(base); // bhejne ke baad temp delete
      if (err) console.error('SEND ERROR:', err.message);
    });
  } catch (e) {
    console.error(e);
    cleanupFiles(base);
    if (!res.headersSent) res.status(500).send('Download me error aaya: ' + (e.message || ''));
  }
});

// Frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Video Downloader chal raha hai: http://localhost:${PORT}`);
  console.log(`  Koi login nahi chahiye. Bas link paste karo aur download karo.\n`);
});
