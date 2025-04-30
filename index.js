export default {
  async fetch(request, env, ctx) {
    const { searchParams, pathname } = new URL(request.url);
    const serverIPs = [
      '50.7.234.10',
      '50.7.92.106',
      '50.7.220.170',
      '67.159.6.34',
      '198.16.100.186'
    ];
    const id = searchParams.get('id') || '';
    const ts = searchParams.get('ts') || '';
    let token = searchParams.get('token') || '';
    const cookies = parseCookies(request.headers.get('Cookie') || '');
    const now = Math.floor(Date.now() / 1000);
    let tokenValid = false;
    const tokenCookie = cookies['token'];
    const tokenTimeCookie = cookies['token_time'];
    if (token && tokenCookie && token === tokenCookie && (now - Number(tokenTimeCookie)) <= 2400) {
      tokenValid = true;
    } else {
      token = await generateSecureToken();
    }
    const selectedIP = selectServer(serverIPs, id);
    const baseUrl = `http://${selectedIP}:8278/${id}`;
    if (!tokenValid) {
      const redirectUrl = `${pathname}?id=${encodeURIComponent(id)}&token=${token}`;
      return new Response('', {
        status: 302,
        headers: {
          'Set-Cookie': `token=${token}; Path=/; HttpOnly; Secure`,
          'Set-Cookie': `token_time=${now}; Path=/; HttpOnly; Secure`,
          'Location': redirectUrl
        }
      });
    }
    if (ts) {
      const url = `${baseUrl}/${ts}`;
      const result = await getWithParallelFailover(url, serverIPs, id, ts);
      return new Response(result.body, { status: result.status });
    } else {
      let url = `${baseUrl}/playlist.m3u8`;
      const seed = "tvata nginx auth module";
      const path = new URL(url).pathname;
      const tid = "mc42afe745533";
      const t = Math.floor(now / 150).toString();
      const tsum = await md5(seed + path + tid + t);
      url += `?tid=${tid}&ct=${t}&tsum=${tsum}`;
      const result = await getWithParallelFailover(url, serverIPs, id);
      const text = await result.body.text();
      if (!text || text.includes("404 Not Found")) {
        return Response.redirect('http://vjs.zencdn.net/v/oceans.mp4', 302);
      }
      if (text.includes('EXTM3U')) {
        const lines = text.split('\n');
        let modified = '';
        for (const line of lines) {
          if (line.includes('.ts')) {
            const urlSelf = new URL(request.url);
            modified += `${urlSelf.pathname}?id=${id}&ts=${line}&token=${token}\n`;
          } else if (line.trim() !== '') {
            modified += line + '\n';
          }
        }
        return new Response(modified, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
      } else {
        return new Response(text, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
      }
    }
  }
};
async function generateSecureToken() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}
function selectServer(servers, name = '') {
  if (name) {
    const index = crc32(name) % servers.length;
    return servers[index];
  }
  return servers[Math.floor(Math.random() * servers.length)];
}
async function getWithParallelFailover(url, servers, name, path = '') {
  const fetchPromises = servers.map(ip => {
    const targetUrl = `http://${ip}:8278/${name}${path ? '/' + path : ''}`;
    return fetch(targetUrl, {
      headers: {
        'CLIENT-IP': '127.0.0.1',
        'X-FORWARDED-FOR': '127.0.0.1'
      }
    }).then(res => ({ res, ip })).catch(() => null);
  });
  const responses = await Promise.all(fetchPromises);
  for (const entry of responses) {
    if (entry && entry.res.ok && entry.res.status !== 404) {
      return { body: entry.res, status: entry.res.status };
    }
  }
  return { body: new Response('', { status: 404 }), status: 404 };
}
function parseCookies(cookieString) {
  const cookies = {};
  cookieString.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length === 2) {
      cookies[parts[0].trim()] = parts[1].trim();
    }
  });
  return cookies;
}
function crc32(str) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ str.charCodeAt(i)) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}
const table = (() => {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table.push(c);
  }
  return table;
})();
async function md5(str) {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
