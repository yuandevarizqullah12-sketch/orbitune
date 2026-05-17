// /api/callback.js - Exchange code for tokens, set HttpOnly cookie, redirect to frontend

module.exports = async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    console.error('OAuth error:', error);
    res.statusCode = 400;
    return res.send('Authorization failed');
  }

  const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
  const REDIRECT_URI = process.env.REDIRECT_URI || 'https://orbitune.vercel.app/api/callback';

  const params = new URLSearchParams();
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', REDIRECT_URI);

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`
      },
      body: params
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error_description || 'Token exchange failed');
    }

    const refreshToken = data.refresh_token;

    // Set HttpOnly cookie with SameSite=None, Secure (required for cross-site)
    res.setHeader('Set-Cookie', `spotify_refresh_token=${refreshToken}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=2592000`);
    // Redirect to frontend with success flag
    res.statusCode = 302;
    res.setHeader('Location', '/?login=success');
    res.end();
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.send('Token exchange failed');
  }
};