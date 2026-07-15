/**
 * tools/musicProxy.js — local Newgrounds audio proxy.
 *
 * Browsers cannot query Newgrounds directly (their servers send no CORS
 * headers), which is why in-browser imports fail. Run this tiny server
 * alongside the game and the editor's Newgrounds import works for real:
 *
 *     node tools/musicProxy.js          (listens on http://localhost:8642)
 *
 * GET /ng/<songId> → { id, title, artist, duration, url, icon }
 *
 * It fetches the public listen page (https://www.newgrounds.com/audio/
 * listen/<id>) and extracts the embedded metadata + the audio.ngfiles.com
 * stream URL — the same data the page's own player uses. Only /ng/<digits>
 * is served; everything else is a 404.
 */
const http = require('http');
const https = require('https');

const PORT = 8642;

function fetchText(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (NEOVOLT level editor music proxy)',
        'Accept': 'text/html,application/json',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchText(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

/** Pull song info out of the listen page's embedded player JSON. */
function parseListenPage(html, id) {
  // stream URL: "url":"https:\/\/audio.ngfiles.com\/..."
  const urlMatch = html.match(/"url"\s*:\s*"(https:\\\/\\\/audio\.ngfiles\.com\\\/[^"]+)"/) ||
                   html.match(/"filename"\s*:\s*"(https:\\\/\\\/audio\.ngfiles\.com\\\/[^"]+)"/);
  if (!urlMatch) throw new Error('No audio stream found on the page (is the ID a song?)');
  const url = urlMatch[1].replace(/\\\//g, '/');

  const title = (html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] ||
                (html.match(/"name"\s*:\s*"([^"]+)"/) || [])[1] || `Newgrounds #${id}`;
  const artist = (html.match(/"artist"\s*:\s*"([^"]+)"/) || [])[1] ||
                 (html.match(/by\s+<a[^>]+class="user"[^>]*>([^<]+)</) || [])[1] || '';
  const duration = parseFloat((html.match(/"duration"\s*:\s*(\d+(?:\.\d+)?)/) || [])[1] || '0');
  const icon = ((html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '');

  return { id, title, artist, duration, url, icon };
}

const server = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  };
  const m = /^\/ng\/(\d{1,12})$/.exec(req.url || '');
  if (!m) {
    res.writeHead(404, cors);
    return res.end(JSON.stringify({ error: 'Use /ng/<numeric song id>' }));
  }
  const id = m[1];
  try {
    const html = await fetchText(`https://www.newgrounds.com/audio/listen/${id}`);
    const info = parseListenPage(html, id);
    res.writeHead(200, cors);
    res.end(JSON.stringify(info));
    console.log(`✓ ${id}: ${info.title}${info.artist ? ' — ' + info.artist : ''}`);
  } catch (e) {
    res.writeHead(502, cors);
    res.end(JSON.stringify({ error: e.message }));
    console.log(`✗ ${id}: ${e.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`NEOVOLT music proxy running → http://localhost:${PORT}/ng/<songId>`);
  console.log('Keep this window open while importing Newgrounds songs in the editor.');
});
