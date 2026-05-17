// /api/login.js - Redirect to Spotify OAuth
module.exports = (req, res) => {
  const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const REDIRECT_URI = process.env.REDIRECT_URI || 'https://orbitune.vercel.app/api/callback';
  const scope = 'user-read-playback-state user-modify-playback-state user-read-currently-playing streaming playlist-read-private user-read-email';

  const state = Math.random().toString(36).substring(2);
  // Optional: store state in cookie to validate later (not implemented here for brevity)
  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
  
  res.statusCode = 302;
  res.setHeader('Location', authUrl);
  res.end();
};