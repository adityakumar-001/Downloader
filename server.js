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

// YouTube link ko single-video URL me normalize karo.
// Jaise: watch?v=ID&list=...&index=7  ->  watch?v=ID
// Isse playlist/Mix (RD...) ka extra "tab" extraction nahi hota aur
// download hamesha usi video ka hota hai jo user ne khola tha.
// youtu.be/ID, /shorts/ID, /embed/ID, /live/ID, music.youtube.com bhi support.
function normalizeUrl(raw) {
  try {
    const str = String(raw || '').trim();
    const u = new URL(str);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const isYT =
      host === 'youtube.com' || host === 'm.youtube.com' ||
      host === 'music.youtube.com' || host === 'youtu.be' ||
      host.endsWith('.youtube.com');
    if (!isYT) return str;

    // youtu.be/VIDEOID
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{6,}$/.test(id)) {
        return 'https://www.youtube.com/watch?v=' + id;
      }
      return str;
    }

    // /shorts/ID, /embed/ID, /live/ID, /v/ID
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([a-zA-Z0-9_-]{6,})/);
    if (m) {
      return 'https://www.youtube.com/watch?v=' + m[2];
    }

    // Normal watch URL: sirf v (aur t-time) rakho, list/index hatao
    const vid = u.searchParams.get('v');
    if (vid && /^[a-zA-Z0-9_-]{6,}$/.test(vid)) {
      const t = u.searchParams.get('t') || u.searchParams.get('start');
      return 'https://www.youtube.com/watch?v=' + vid + (t ? '&t=' + encodeURIComponent(t) : '');
    }
    return str;
  } catch {
    return String(raw || '').trim();
  }
}

// yt-dlp ke common options (har call me use karo)
// NOTE: player_client override mat lagao — YouTube ke SABR experiment me
// android client ke https formats me URL missing hota hai aur quality 360p par cap
// ho jati hai. yt-dlp ke default clients (web/visionos/m3u8 fallback) best dete hain.
function baseYtDlpOpts(extra) {
  return Object.assign({
    noCheckCertificates: true,
    noWarnings: true,
    noPlaylist: true,
    // Node ko JS runtime banao (yt-dlp ka "No supported JavaScript runtime" warning fix)
    jsRuntimes: 'node',
    retries: 3,
    socketTimeout: 30,
  }, extra || {});
}

// Safe filename banao
function safeFilename(name, ext) {
  let base = (name || 'video').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 100);
  if (!base) base = 'video';
  if (ext && !base.toLowerCase().endsWith(ext.toLowerCase())) base += ext;
  return base;
}

// Quality -> yt-dlp format string (Best Merge: highest-bitrate video+audio, 4K tak)
// HAMESHA video+audio dono manga jata hai taaki silent video na aaye.
// Pehle MP4 (H264+AAC) prefer hota hai taaki har player me chale,
// phir fallback VP9/AV1+Opus (4K mostly isi me hota hai) -> ffmpeg se MP4 me merge.
// Koi length limit nahi hai - 10 sec ho ya 10 ghante, sab chalega.
function qualityToFormat(q) {
  const chain = (h) => h
    ? `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/bestvideo+bestaudio/best`
    : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
  switch (q) {
    case '2160':
    case '4k':
      return chain(2160);
    case '1440':
    case '2k':
      return chain(1440);
    case '1080':
      return chain(1080);
    case '480':
      return chain(480);
    case '360':
      return chain(360);
    case 'audio':
    case 'mp3':
      return 'bestaudio[ext=m4a]/bestaudio/best';
    case 'best':
      return chain(0);
    case '720':
    default:
      return chain(720);
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
  const map = { '2160': '2160p', '4k': '2160p', '1440': '1440p', '2k': '1440p', '1080': '1080p', '720': '720p', '480': '480p', '360': '360p', 'audio': 'audio', 'mp3': 'audio', 'best': 'best' };
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

    const info = await youtubedl(normalizeUrl(url), baseYtDlpOpts({
      dumpSingleJson: true,
      skipDownload: true,
    }));

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
    const qdefs = [{ id: 'best', label: 'Best Quality ⭐ (up to 4K)' }];
    for (const h of [2160, 1440, 1080, 720, 480, 360]) {
      if ([...heights].some((x) => x >= h - 60)) {
        const name = h === 2160 ? '2160p 4K Ultra HD'
          : h === 1440 ? '1440p 2K Quad HD'
          : h === 1080 ? '1080p Full HD'
          : h === 720 ? '720p HD' : h + 'p';
        qdefs.push({ id: String(h), label: name });
      }
    }
    // Agar formats se pata na chale to standard options do (4K samet)
    if (qdefs.length <= 1) {
      qdefs.push(
        { id: '2160', label: '2160p 4K Ultra HD' },
        { id: '1440', label: '1440p 2K Quad HD' },
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
      maxHeight: heights.size ? Math.max(...heights) : null,
      qualities,
    });
  } catch (e) {
    console.error('INFO ERROR:', e.message);
    const msg = String((e && (e.stderr || e.message)) || '');
    if (msg.includes('Private') || msg.includes('Login required')) {
      return res.status(400).json({ error: 'Ye video private hai ya login mangta hai. Public video ka link try karo (login ki jarurat nahi hai public videos ke liye).' });
    }
    if (/sign in to confirm|not a bot|429|too many requests/i.test(msg)) {
      return res.status(502).json({ error: 'YouTube ne temporarily block kiya hai (bot-check). 1-2 min ruk kar dobara try karo, ya bina &list= wala clean link (sirf watch?v=ID) paste karo.' });
    }
    if (msg.includes('Unsupported URL') || msg.includes('not a valid URL')) {
      return res.status(400).json({ error: 'Ye link support nahi hota. YouTube, Instagram, Facebook, TikTok, X, Vimeo, Dailymotion ka public link try karo.' });
    }
    res.status(500).json({ error: 'Video ki info nahi mil payi. Link check karke dobara try karo. (&list=&index= wala link ho to sirf v=ID wala part rakho).' });
  }
});

// ---- STEP 2: Video download karo (Video + Audio MERGED) ----
app.get('/api/download', async (req, res) => {
  const base = tmpBase();
  try {
    const { url: rawUrl, quality = 'best' } = req.query;
    if (!rawUrl || !isValidUrl(rawUrl)) {
      return res.status(400).send('Sahi video link do');
    }
    // &list=&index= wale YouTube links ko clean single-video URL banao
    const url = normalizeUrl(rawUrl);

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
      const meta = await youtubedl(url, baseYtDlpOpts({
        getFilename: true,
        output: '%(title)s',
      }));
      title = String(meta).trim().split('\n')[0] || 'video';
    } catch { /* ignore, default naam use hoga */ }

    const filename = safeFilename(title, isAudio ? '.mp3' : '.mp4');

    // yt-dlp se TEMP FILE me download + ffmpeg se merge (audio fix)
    const outputTemplate = base + '.%(ext)s';
    const args = baseYtDlpOpts({
      format,
      output: outputTemplate,
      quiet: true,
      ffmpegLocation: ffmpegPath,
      concurrentFragments: 4,
    });
    if (isAudio) {
      args.extractAudio = true;
      args.audioFormat = 'mp3';
      args.audioQuality = 0;
    } else {
      // Best Merge: highest-bitrate video+audio ko MP4 me merge karo
      // (har player me audio baje + faststart se turant play ho)
      args.mergeOutputFormat = 'mp4';
      args.remuxVideo = 'mp4';
      args.embedMetadata = true;
      args.postprocessorArgs = 'Merger:-movflags +faststart';
    }

    try {
      await youtubedl(url, args);
    } catch (e) {
      // Merge fail ho to fallback: single file (isme audio pehle se hota hai)
      console.error('MERGE TRY FAIL, fallback:', (e && (e.stderr || e.message) || '').toString().slice(0, 1000));
      cleanupFiles(base);
      await youtubedl(url, baseYtDlpOpts({
        format: 'best[ext=mp4]/best',
        output: outputTemplate,
        quiet: true,
        ffmpegLocation: ffmpegPath,
      }));
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

// ---- FRONTEND LINK ----
// public/index.html ko web pe serve karo
// CHAIN: Browser (index.html) --fetch /api/*--> server.js (ye file) --yt-dlp+ffmpeg--> video
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SPA fallback: /api chhod ke har GET ko index.html do (Express 4 + 5 dono me chalega)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route nahi mila' });
  if (req.path.includes('.') && req.path !== '/') return next(); // static file miss ho to next
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Video Downloader chal raha hai: http://localhost:${PORT}`);
  console.log(`  Koi login nahi chahiye. Bas link paste karo aur download karo.\n`);
});
