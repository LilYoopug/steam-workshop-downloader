// Steam Workshop metadata shim — fetches Steam, adds CORS. Deploy as a Cloudflare Worker.
// GET /?id=<workshop_id>  ->  full JSON: title, desc, thumb, tags, versions, gallery, size, date

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    const id = (url.searchParams.get('id') || '').replace(/\D/g, '');
    if (!id) return json({ error: 'missing ?id=' }, 400);

    // 1) Steam WebAPI: title, desc, tags, thumb, size, date
    const apiRes = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ itemcount: '1', 'publishedfileids[0]': id }).toString(),
    });
    const payload = await apiRes.json();
    const item = payload?.response?.publishedfiledetails?.[0];
    if (!item || item.result !== 1) return json({ error: 'workshop item not found' }, 404);

    const tags = (item.tags || []).map(t => t.tag || '');
    const rwVersions = tags.filter(t => /^\d+\.\d+$/.test(t));

    // 2) Workshop page: rgFullScreenshotURLs (Steam's own gallery data) — capped so slow pages don't stall the whole response
    let images = [];
    try {
      const pagePromise = fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }).then(r => r.ok ? r.text() : null);
      const html = await Promise.race([pagePromise, new Promise(res => setTimeout(() => res(null), 6000))]);
      if (html) {
        const m = html.match(/var\s+rgFullScreenshotURLs\s*=\s*\[([\s\S]*?)\];/);
        if (m) images = [...m[1].matchAll(/'url'\s*:\s*'([^']+)'/g)].map(x => x[1]);
        if (!images.length) {
          const m2 = html.match(/var\s+rgScreenshotURLs\s*=\s*\{([\s\S]*?)\};/);
          if (m2) images = [...m2[1].matchAll(/'\d+'\s*:\s*'([^']+)'/g)].map(x => x[1]);
        }
      }
    } catch (e) { /* gallery optional */ }

    return json({
      id: item.publishedfileid,
      title: item.title,
      description: item.description,
      preview_url: item.preview_url,
      tags,
      rimworld_versions: rwVersions,
      time_updated: item.time_updated,
      file_size: item.file_size,
      subscriptions: item.subscriptions,
      views: item.views,
      images,
    });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}
