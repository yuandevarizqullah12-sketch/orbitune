// /api/spotify.js - Handle POST requests from frontend (search, play, etc.)

// Helper to parse cookie header
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  });
  return cookies;
}

// Refresh access token using refresh_token
async function refreshAccessToken(refreshToken) {
  const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${auth}`
    },
    body: params
  });
  const data = await response.json();
  if (!response.ok) throw new Error('Refresh token failed');
  return data.access_token;
}

// Get valid access token from cookie
async function getAccessToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  const refreshToken = cookies.spotify_refresh_token;
  if (!refreshToken) throw new Error('No refresh token');
  return await refreshAccessToken(refreshToken);
}

// Call Spotify API
async function callSpotifyApi(accessToken, endpoint, method = 'GET', body = null) {
  const url = `https://api.spotify.com/v1/${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  };
  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  if (response.status === 401 || response.status === 403) {
    throw new Error('Unauthorized');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Spotify API error ${response.status}`);
  }
  return data;
}

module.exports = async (req, res) => {
  // CORS headers (allow frontend)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, q, uri, volume } = req.body;
  if (!action) {
    return res.status(400).json({ error: 'action required' });
  }

  try {
    let accessToken;
    try {
      accessToken = await getAccessToken(req);
    } catch (err) {
      return res.status(401).json({ error: 'session expired, login again' });
    }

    switch (action) {
      case 'me': {
        const user = await callSpotifyApi(accessToken, 'me');
        return res.json(user);
      }
      case 'search': {
        if (!q) return res.status(400).json({ error: 'query required' });
        const data = await callSpotifyApi(accessToken, `search?q=${encodeURIComponent(q)}&type=track&limit=20`);
        return res.json(data);
      }
      case 'play': {
        if (!uri) return res.status(400).json({ error: 'track uri required' });
        await callSpotifyApi(accessToken, 'me/player/play', 'PUT', { uris: [uri] });
        return res.json({ success: true });
      }
      case 'pause': {
        await callSpotifyApi(accessToken, 'me/player/pause', 'PUT');
        return res.json({ success: true });
      }
      case 'resume': {
        await callSpotifyApi(accessToken, 'me/player/play', 'PUT');
        return res.json({ success: true });
      }
      case 'next': {
        await callSpotifyApi(accessToken, 'me/player/next', 'POST');
        return res.json({ success: true });
      }
      case 'previous': {
        await callSpotifyApi(accessToken, 'me/player/previous', 'POST');
        return res.json({ success: true });
      }
      case 'set_volume': {
        if (volume === undefined) return res.status(400).json({ error: 'volume required' });
        await callSpotifyApi(accessToken, `me/player/volume?volume_percent=${volume}`, 'PUT');
        return res.json({ success: true });
      }
      case 'get_current_playing': {
        const data = await callSpotifyApi(accessToken, 'me/player');
        return res.json(data);
      }
      default:
        return res.status(400).json({ error: 'invalid action' });
    }
  } catch (err) {
    console.error('API error:', err.message);
    if (err.message === 'Unauthorized' || err.message === 'No refresh token') {
      return res.status(401).json({ error: 'session expired, login again' });
    }
    return res.status(500).json({ error: err.message });
  }
};