// /api/logout.js - Clear refresh token cookie and redirect to home
module.exports = (req, res) => {
  res.setHeader('Set-Cookie', `spotify_refresh_token=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`);
  res.statusCode = 302;
  res.setHeader('Location', '/');
  res.end();
};