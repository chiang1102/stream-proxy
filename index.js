// Cloudflare Workers IPTV Proxy
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);

    try {
      if (params.action === "clear_cache") {
        return new Response("🚫 清除快取功能在 Workers 中需使用 Durable Objects 或 KV 實作，暫未支援", { status: 501 });
      } else if (!params.id) {
        return await generateChannelList(params);
      } else {
        return await handleChannelRequest(params);
      }
    } catch (e) {
      return new Response("系統維護中，錯誤：" + e.message, { status: 503 });
    }
  }
};

const CONFIG = {
  upstream: [
    'http://198.16.100.186:8278/',
    'http://50.7.92.106:8278/',
    'http://50.7.234.10:8278/',
    'http://50.7.220.170:8278/',
    'http://67.159.6.34:8278/'
  ],
  list_url: 'https://cdn.jsdelivr.net/gh/hostemail/cdn@main/live/smart.txt',
  backup_url: 'https://tv.alishare.cf/live/smart.txt',
  token_ttl: 2400,
  fallback: 'http://vjs.zencdn.net/v/oceans.mp4',
  clear_key: 'leifeng'
};

let upstreamIndex = 0;
function getUpstream() {
  return CONFIG.upstream[upstreamIndex++ % CONFIG.upstream.length];
}

function getChannelLogo(name) {
  if (!name) return "https://cdn.jsdelivr.net/gh/hostemail/cdn@main/images/leifeng.png";
  name = name.replace(/\s*_?HD$/i, '').replace(/\s*高清$/u, '').replace(/[\W_]+/ug, '').trim();
  return name ? `https://epg.v1.mk/logo/${name}.png` : "https://cdn.jsdelivr.net/gh/hostemail/cdn@main/images/leifeng.png";
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  return res.ok ? await res.text() : null;
}

async function getChannelList() {
  const raw = await fetchText(CONFIG.list_url) || await fetchText(CONFIG.backup_url);
  if (!raw) throw new Error("無法讀取任何頻道清單來源");
  return parseChannelData(raw);
}

function parseChannelData(raw) {
  const lines = raw.trim().split(/\n+/);
  let group = "默認分組", seen = new Set(), list = [];
  for (const line of lines) {
    if (line.includes('#genre#')) {
      group = line.split(',')[0].trim();
      continue;
    }
    const [rawName, url] = line.split(',', 2);
    if (!rawName || !url) continue;

    let name = rawName.includes('|') ? rawName.split('|')[1] : rawName;
    name = name.replace(/\s*backup\s*/ig, '').replace(/[^一-龥\w\s\-+]/ug, '').trim();
    const idMatch = url.match(/(?:[?&:]id=|^)([\w-]+)/);
    const id = idMatch ? idMatch[1] : null;
    if (id && !seen.has(id)) {
      list.push({ id, name, group, logo: getChannelLogo(name) });
      seen.add(id);
    }
  }
  return list;
}

function validateToken(token) {
  const [_, ts] = token?.split(':') || [];
  return ts && (Date.now() / 1000 - parseInt(ts)) <= CONFIG.token_ttl;
}

function createToken() {
  return `${crypto.randomUUID().replace(/-/g, '')}:${Math.floor(Date.now() / 1000)}`;
}

async function generateChannelList(params) {
  const type = (params.type || 'm3u').toLowerCase();
  const channels = await getChannelList();
  const base = 'https://example.com'; // You should replace with your own domain
  let output = '';

  if (type === 'txt') {
    let currentGroup = '';
    for (const chan of channels) {
      if (chan.group !== currentGroup) {
        output += `\n${chan.group},#genre#\n`;
        currentGroup = chan.group;
      }
      output += `${chan.name},${base}/?id=${chan.id}\n`;
    }
    return new Response(output.trim(), { headers: { 'Content-Type': 'text/plain' } });
  } else {
    output = "#EXTM3U\n";
    let currentGroup = '';
    for (const chan of channels) {
      if (chan.group !== currentGroup) {
        output += `#EXTINF:-1 group-title=\"${chan.group}\", ===== ${chan.group} =====\n${CONFIG.fallback}\n`;
        currentGroup = chan.group;
      }
      output += `#EXTINF:-1 tvg-id=\"${chan.id}\" tvg-name=\"${chan.name}\" group-title=\"${chan.group}\" tvg-logo=\"${chan.logo}\",${chan.name}\n${base}/?id=${chan.id}\n`;
    }
    return new Response(output.trim(), { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
  }
}

async function handleChannelRequest(params) {
  const id = params.id;
  const ts = params.ts;
  const token = params.token;
  const newToken = token && validateToken(token) ? token : createToken();

  if (ts) {
    const streamUrl = `${getUpstream()}${id}/${ts}`;
    const res = await fetch(streamUrl);
    if (!res.ok) return new Response("Segment Not Found", { status: 404 });
    const data = await res.arrayBuffer();
    return new Response(data, {
      headers: {
        'Content-Type': 'video/MP2T',
        'Content-Length': data.byteLength
      }
    });
  } else {
    const ct = Math.floor(Date.now() / 150000);
    const tokenHash = await sha256(`tvata nginx auth module/${id}/playlist.m3u8mc42afe745533${ct}`);
    const m3u8Url = `${getUpstream()}${id}/playlist.m3u8?tid=mc42afe745533&ct=${ct}&tsum=${tokenHash}`;
    const m3u8 = await fetchText(m3u8Url);
    if (!m3u8 || m3u8.includes('404 Not Found')) {
      return Response.redirect(CONFIG.fallback);
    }
    const base = 'https://example.com'; // Replace with your worker domain
    const updated = m3u8.replace(/(\S+\.ts)/g, (m, segment) => {
      return `${base}/?id=${encodeURIComponent(id)}&ts=${encodeURIComponent(segment)}&token=${encodeURIComponent(newToken)}`;
    });
    return new Response(updated, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl'
      }
    });
  }
}

async function sha256(input) {
  const msgBuffer = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return [...new Uint8Array(hashBuffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}
