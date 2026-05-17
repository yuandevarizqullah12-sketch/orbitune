// /api/spotify.js - Vercel Serverless Function
// Handles OAuth, token refresh, Spotify API proxy

// For Vercel, use global fetch. We'll keep it standard.

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || null; // set in vercel env or dynamic

// Helper to build redirect uri based on request
function getRedirectUri(req) {
  if (REDIRECT_URI) return REDIRECT_URI;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${protocol}://${host}/api/spotify?action=callback`;
}

// Helper to parse cookies
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  });
  return cookies;
}

// set cookie helper
function setRefreshTokenCookie(res, refreshToken) {
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  res.setHeader('Set-Cookie', `spotify_refresh_token=${refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

function clearRefreshTokenCookie(res) {
  res.setHeader('Set-Cookie', `spotify_refresh_token=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`);
}

// Exchange code for tokens
async function exchangeCodeForTokens(code, redirectUri) {
  const params = new URLSearchParams();
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', redirectUri);
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
  if (!response.ok) throw new Error(data.error_description || 'token exchange failed');
  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

// Refresh access token using refresh_token
async function refreshAccessToken(refreshToken) {
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

// Helper to get valid access token from request cookies
async function getAccessTokenFromRefreshCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  const refreshToken = cookies.spotify_refresh_token;
  if (!refreshToken) throw new Error('No refresh token');
  const newAccessToken = await refreshAccessToken(refreshToken);
  return newAccessToken;
}

// Spotify API proxy caller
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
  const res = await fetch(url, options);
  if (res.status === 401 || res.status === 403) {
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Spotify API error ${res.status}`);
  }
  return data;
}

// Main Handler
module.exports = async (req, res) => {
  // Enable CORS for dev (optional but safe)
  res.setHeader('Access-Control-Allow-Origin', 'https://orbitune.vercel.app');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { method, query, body } = req;

  // ---------- GET endpoints (login, callback, logout) ----------
  if (method === 'GET') {
    const action = query.action;
    // LOGIN redirect
    if (action === 'login') {
      const redirectUri = getRedirectUri(req);
      const scope = 'user-read-playback-state user-modify-playback-state user-read-currently-playing streaming playlist-read-private user-read-email';
      const state = Math.random().toString(36).substring(2);
      const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
      res.statusCode = 302;
      res.setHeader('Location', authUrl);
      return res.end();
    }
    // CALLBACK
    if (action === 'callback') {
      const code = query.code;
      const error = query.error;
      if (error || !code) {
        res.statusCode = 400;
        return res.end('Authorization failed');
      }
      const redirectUri = getRedirectUri(req);
      try {
        const tokens = await exchangeCodeForTokens(code, redirectUri);
        setRefreshTokenCookie(res, tokens.refresh_token);
        // redirect back to frontend with success flag
        return res.status(200).send(`
           <script>
        window.location.href='/?login=success';
           </script>
      `);
      } catch (err) {
        console.error(err);
        res.statusCode = 500;
        return res.end('Token exchange failed');
      }
    }
    // LOGOUT: clear cookie
    if (action === 'logout') {
      clearRefreshTokenCookie(res);
      res.statusCode = 302;
      res.setHeader('Location', '/');
      return res.end();
    }
    res.statusCode = 404;
    return res.json({ error: 'Not found' });
  }

  // ---------- POST endpoints (all actions require auth) ----------
  if (method === 'POST') {
    const { action, q, uri, volume } = body;
    if (!action) return res.status(400).json({ error: 'action required' });

    try {
      let accessToken;
      try {
        accessToken = await getAccessTokenFromRefreshCookie(req);
      } catch (err) {
        return res.status(401).json({ error: 'Unauthorized, please login' });
      }

      // Action routing
      if (action === 'me') {
        const user = await callSpotifyApi(accessToken, 'me');
        return res.json(user);
      }
      if (action === 'search') {
        if (!q) return res.status(400).json({ error: 'query required' });
        const data = await callSpotifyApi(accessToken, `search?q=${encodeURIComponent(q)}&type=track&limit=20`);
        return res.json(data);
      }
      if (action === 'play') {
        if (!uri) return res.status(400).json({ error: 'track uri required' });
        await callSpotifyApi(accessToken, 'me/player/play', 'PUT', { uris: [uri] });
        return res.json({ success: true });
      }
      if (action === 'pause') {
        await callSpotifyApi(accessToken, 'me/player/pause', 'PUT');
        return res.json({ success: true });
      }
      if (action === 'resume') {
        await callSpotifyApi(accessToken, 'me/player/play', 'PUT');
        return res.json({ success: true });
      }
      if (action === 'next') {
        await callSpotifyApi(accessToken, 'me/player/next', 'POST');
        return res.json({ success: true });
      }
      if (action === 'previous') {
        await callSpotifyApi(accessToken, 'me/player/previous', 'POST');
        return res.json({ success: true });
      }
      if (action === 'set_volume') {
        if (volume === undefined) return res.status(400).json({ error: 'volume required' });
        await callSpotifyApi(accessToken, `me/player/volume?volume_percent=${volume}`, 'PUT');
        return res.json({ success: true });
      }
      if (action === 'get_current_playing') {
        const data = await callSpotifyApi(accessToken, 'me/player');
        return res.json(data);
      }
      return res.status(400).json({ error: 'invalid action' });
    } catch (err) {
      console.error('API error:', err.message);
      if (err.message === 'Unauthorized' || err.message.includes('No refresh token')) {
        return res.status(401).json({ error: 'session expired, login again' });
      }
      return res.status(500).json({ error: err.message });
    }
  }
  res.status(405).json({ error: 'Method not allowed' });
};