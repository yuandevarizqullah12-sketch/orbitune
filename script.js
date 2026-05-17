// Orbitune - Frontend Controller
// API endpoint base (relative, works with Vercel)
const API_BASE = '/api/spotify';

// DOM elements
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userProfileDiv = document.getElementById('userProfile');
const userNameSpan = document.getElementById('userName');
const userAvatar = document.getElementById('userAvatar');
const searchInput = document.getElementById('searchInput');
const resultsContainer = document.getElementById('searchResults');
const emptyStateDiv = document.getElementById('emptyState');
const clearSearchBtn = document.getElementById('clearSearch');
const currentAlbumArt = document.getElementById('currentAlbumArt');
const currentTitle = document.getElementById('currentTitle');
const currentArtist = document.getElementById('currentArtist');
const progressFill = document.getElementById('progressFill');
const currentTimeSpan = document.getElementById('currentTime');
const totalDurationSpan = document.getElementById('totalDuration');
const playPauseBtn = document.getElementById('playPauseBtn');
const playPauseIcon = document.getElementById('playPauseIcon');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const volumeSlider = document.getElementById('volumeSlider');
const statusTextSpan = document.getElementById('statusText');
const bgBlurLayer = document.getElementById('bgBlurLayer');
const loadingOverlay = document.getElementById('loadingOverlay');

// Global state
let isLoggedIn = false;
let currentTrackUri = null;
let pollingInterval = null;
let isPlayingState = false;
let currentVolume = 50;

// Helper: show/hide loading
function showLoading(show) {
  if (show) loadingOverlay.classList.remove('hidden');
  else loadingOverlay.classList.add('hidden');
}

// API caller to backend
async function callBackend(action, body = {}) {
  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
      credentials: 'include' // send cookies (refresh_token)
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`[${action}] error:`, error);
    throw error;
  }
}

// Check login status from backend
async function checkLoginStatus() {
  try {
    const data = await callBackend('me');
    if (data && data.display_name) {
      isLoggedIn = true;
      userNameSpan.textContent = data.display_name;
      userAvatar.src = data.images?.[0]?.url || 'https://placehold.co/40x40/1DB954/white?text=U';
      loginBtn.classList.add('hidden');
      userProfileDiv.classList.remove('hidden');
      startPollingNowPlaying();
      return true;
    } else {
      throw new Error('Not logged in');
    }
  } catch (e) {
    // Not authenticated
    isLoggedIn = false;
    loginBtn.classList.remove('hidden');
    userProfileDiv.classList.add('hidden');
    stopPolling();
    resetNowPlayingUI();
    return false;
  }
}

// Reset UI when logged out
function resetNowPlayingUI() {
  currentAlbumArt.src = 'https://placehold.co/300x300/1a1a1a/1DB954?text=Orbitune';
  currentTitle.textContent = 'Not playing';
  currentArtist.textContent = '—';
  progressFill.style.width = '0%';
  currentTimeSpan.textContent = '0:00';
  totalDurationSpan.textContent = '0:00';
  playPauseIcon.className = 'fas fa-play';
  statusTextSpan.innerHTML = '<i class="fas fa-volume-off"></i> No active device';
  bgBlurLayer.style.backgroundImage = 'url(https://placehold.co/600x600/111/1DB954?text=Orbitune)';
}

// Polling current playback
async function fetchNowPlaying() {
  if (!isLoggedIn) return;
  try {
    const data = await callBackend('get_current_playing');
    if (data && data.item) {
      const track = data.item;
      currentTitle.textContent = track.name;
      currentArtist.textContent = track.artists.map(a => a.name).join(', ');
      const imgUrl = track.album.images[0]?.url || '';
      if (imgUrl) {
        currentAlbumArt.src = imgUrl;
        bgBlurLayer.style.backgroundImage = `url(${imgUrl})`;
      }
      const progressMs = data.progress_ms || 0;
      const durationMs = track.duration_ms;
      updateProgressBar(progressMs, durationMs);
      totalDurationSpan.textContent = formatTime(durationMs);
      isPlayingState = data.is_playing;
      playPauseIcon.className = isPlayingState ? 'fas fa-pause' : 'fas fa-play';
      statusTextSpan.innerHTML = `<i class="fas fa-volume-up"></i> Playing on ${data.device?.name || 'device'}`;
      currentTrackUri = track.uri;
    } else {
      // No active playback
      if (currentTitle.textContent !== 'Not playing') resetNowPlayingUI();
      statusTextSpan.innerHTML = '<i class="fas fa-volume-off"></i> No active playback';
      playPauseIcon.className = 'fas fa-play';
    }
  } catch (error) {
    console.warn('Now playing fetch error', error);
  }
}

function updateProgressBar(progress, duration) {
  if (duration && progress >= 0) {
    const percent = (progress / duration) * 100;
    progressFill.style.width = `${percent}%`;
    currentTimeSpan.textContent = formatTime(progress);
  }
}

function formatTime(ms) {
  if (!ms) return '0:00';
  const secs = Math.floor(ms / 1000);
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function startPollingNowPlaying() {
  if (pollingInterval) clearInterval(pollingInterval);
  fetchNowPlaying(); // immediate
  pollingInterval = setInterval(fetchNowPlaying, 2000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// SEARCH
let searchTimeout = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const query = searchInput.value.trim();
  if (query.length < 2) {
    resultsContainer.innerHTML = '';
    emptyStateDiv.classList.remove('hidden');
    clearSearchBtn.classList.add('hidden');
    return;
  }
  clearSearchBtn.classList.remove('hidden');
  searchTimeout = setTimeout(() => performSearch(query), 500);
});

async function performSearch(query) {
  if (!isLoggedIn) {
    alert('Please login with Spotify first');
    return;
  }
  showLoading(true);
  try {
    const data = await callBackend('search', { q: query });
    if (data && data.tracks && data.tracks.items) {
      renderSearchResults(data.tracks.items);
    } else {
      resultsContainer.innerHTML = '<div class="empty-state">No results found ✨</div>';
    }
  } catch (err) {
    resultsContainer.innerHTML = '<div class="empty-state">Search error, try again</div>';
  } finally {
    showLoading(false);
  }
}

function renderSearchResults(tracks) {
  if (!tracks.length) {
    resultsContainer.innerHTML = '<div class="empty-state">No tracks found</div>';
    return;
  }
  emptyStateDiv.classList.add('hidden');
  resultsContainer.innerHTML = tracks.map(track => `
    <div class="result-card" data-uri="${track.uri}">
      <img src="${track.album.images[0]?.url || 'https://placehold.co/200x200'}" alt="cover">
      <h4>${escapeHtml(track.name)}</h4>
      <p>${escapeHtml(track.artists.map(a => a.name).join(', '))}</p>
      <button class="play-btn-card" data-uri="${track.uri}">
        <i class="fas fa-play"></i> Play
      </button>
    </div>
  `).join('');

  // add event listeners to play buttons
  document.querySelectorAll('.play-btn-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uri = btn.dataset.uri;
      playTrack(uri);
    });
  });
  document.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => {
      const uri = card.dataset.uri;
      playTrack(uri);
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// Playback actions
async function playTrack(uri) {
  if (!isLoggedIn) return;
  showLoading(true);
  try {
    await callBackend('play', { uri });
    setTimeout(fetchNowPlaying, 500);
  } catch (err) {
    alert('Cannot play. Make sure Spotify is open on any device (premium required)');
  } finally {
    showLoading(false);
  }
}

async function pausePlayback() {
  if (!isLoggedIn) return;
  try {
    await callBackend('pause');
    isPlayingState = false;
    playPauseIcon.className = 'fas fa-play';
  } catch(e) { console.error(e); }
}

async function resumePlayback() {
  if (!isLoggedIn) return;
  try {
    await callBackend('resume');
    isPlayingState = true;
    playPauseIcon.className = 'fas fa-pause';
  } catch(e) { console.error(e); }
}

async function nextTrack() {
  if (!isLoggedIn) return;
  showLoading(true);
  try {
    await callBackend('next');
    setTimeout(fetchNowPlaying, 400);
  } catch(e) { alert('Cannot skip'); } finally { showLoading(false); }
}

async function prevTrack() {
  if (!isLoggedIn) return;
  showLoading(true);
  try {
    await callBackend('previous');
    setTimeout(fetchNowPlaying, 400);
  } catch(e) { alert('Cannot go previous'); } finally { showLoading(false); }
}

async function setVolume(volume) {
  if (!isLoggedIn) return;
  try {
    await callBackend('set_volume', { volume });
  } catch(e) { console.warn('volume error'); }
}

// Event handlers
playPauseBtn.addEventListener('click', () => {
  if (!isLoggedIn) return;
  if (isPlayingState) pausePlayback();
  else resumePlayback();
});

prevBtn.addEventListener('click', prevTrack);
nextBtn.addEventListener('click', nextTrack);
volumeSlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  currentVolume = val;
  setVolume(val);
});

loginBtn.addEventListener('click', () => {
  window.location.href = '/api/spotify?action=login';
});

logoutBtn.addEventListener('click', async () => {
  // simple client logout: just redirect to logout endpoint? but we can clear session by calling backend
  window.location.href = '/api/spotify?action=logout';
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  resultsContainer.innerHTML = '';
  emptyStateDiv.classList.remove('hidden');
  clearSearchBtn.classList.add('hidden');
});

// On page load: check login status and setup
window.addEventListener('DOMContentLoaded', async () => {
  showLoading(true);
  await checkLoginStatus();
  showLoading(false);
  // Auto detect if redirected from login
  if (window.location.search.includes('login=success')) {
    window.history.replaceState({}, '', '/');
    await checkLoginStatus();
  }
});