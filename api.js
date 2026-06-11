// ── NSUK PlugMe — Frontend API Client ────────────────────────────────────────
// All fetch calls use this file. Exported as window.PlugMe
// Flat file — no subdirectory imports

const BACKEND_URL = 'https://plugme-web-v2.onrender.com';

// ── Token helpers ─────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('plugme_token');
const getUser  = () => JSON.parse(localStorage.getItem('plugme_user') || 'null');
const saveAuth = (token, user) => {
  localStorage.setItem('plugme_token', token);
  localStorage.setItem('plugme_user', JSON.stringify(user));
};
const clearAuth = () => {
  localStorage.removeItem('plugme_token');
  localStorage.removeItem('plugme_user');
};

// ── Base fetch ────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) };
  const res = await fetch(`${BACKEND_URL}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
const authAPI = {
  register: (body) => api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) })
    .then(d => { saveAuth(d.token, d.user); return d; }),
  login: (body) => api('/api/auth/login', { method: 'POST', body: JSON.stringify(body) })
    .then(d => { saveAuth(d.token, d.user); return d; }),
  me: () => api('/api/auth/me'),
  logout: () => { clearAuth(); return api('/api/auth/logout', { method: 'POST' }).catch(() => {}); },
};

// ── Users ─────────────────────────────────────────────────────────────────────
const usersAPI = {
  workers: (params = {}) => api('/api/users/workers?' + new URLSearchParams(params)),
  getUser: (id) => api(`/api/users/${id}`),
  updateProfile: (body) => api('/api/users/me/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  dashboard: () => api('/api/users/dashboard'),
  notifications: () => api('/api/users/notifications'),
  markNotificationsRead: () => api('/api/users/notifications/read', { method: 'PATCH' }),
};

// ── Jobs ──────────────────────────────────────────────────────────────────────
const jobsAPI = {
  browse: (params = {}) => api('/api/jobs?' + new URLSearchParams(params)),
  get: (id) => api(`/api/jobs/${id}`),
  post: (body) => api('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
  myPosted: () => api('/api/jobs/my/posted'),
  complete: (id) => api(`/api/jobs/${id}/complete`, { method: 'PATCH' }),
  cancel: (id) => api(`/api/jobs/${id}`, { method: 'DELETE' }),
};

// ── Offers ────────────────────────────────────────────────────────────────────
const offersAPI = {
  submit: (jobId, body) => api(`/api/jobs/${jobId}/offers`, { method: 'POST', body: JSON.stringify(body) }),
  getForJob: (jobId) => api(`/api/jobs/${jobId}/offers`),
  accept: (jobId, offerId) => api(`/api/jobs/${jobId}/offers/${offerId}/accept`, { method: 'PATCH' }),
  reject: (jobId, offerId) => api(`/api/jobs/${jobId}/offers/${offerId}/reject`, { method: 'PATCH' }),
  myOffers: () => api('/api/offers/my'),
  withdraw: (offerId) => api(`/api/offers/${offerId}/withdraw`, { method: 'DELETE' }),
};

// ── Chats ─────────────────────────────────────────────────────────────────────
const chatsAPI = {
  list: () => api('/api/chats'),
  get: (chatId) => api(`/api/chats/${chatId}`),
  send: (chatId, text) => api(`/api/chats/${chatId}/send`, { method: 'POST', body: JSON.stringify({ text }) }),
};

// ── Reviews ───────────────────────────────────────────────────────────────────
const reviewsAPI = {
  submit: (jobId, body) => api(`/api/reviews/job/${jobId}`, { method: 'POST', body: JSON.stringify(body) }),
  forUser: (userId) => api(`/api/reviews/user/${userId}`),
};

// ── Unlock ────────────────────────────────────────────────────────────────────
const unlockAPI = {
  status: (workerId) => api(`/api/unlock/worker/${workerId}/status`),
  unlock: (workerId) => api(`/api/unlock/worker/${workerId}/initiate`, { method: 'POST' }),
};

// ── Socket.IO (lazy-loaded) ───────────────────────────────────────────────────
let _socket = null;

function getSocket() {
  if (_socket) return _socket;
  const script = document.createElement('script');
  script.src = `${BACKEND_URL}/socket.io/socket.io.js`;
  document.head.appendChild(script);
  return new Promise(resolve => {
    script.onload = () => {
      _socket = window.io(BACKEND_URL, { auth: { token: getToken() } });
      const user = getUser();
      if (user) _socket.emit('join_user', user._id);
      resolve(_socket);
    };
  });
}

// ── Global socket event handlers (call after getSocket()) ────────────────────
const socketHandlers = {
  onNotif: async (cb) => (await getSocket()).on('notification', cb),
  onOfferAccepted: async (cb) => (await getSocket()).on('offer_accepted', cb),
  onMessage: async (cb) => (await getSocket()).on('new_message', cb),
  onTyping: async (cb) => (await getSocket()).on('user_typing', cb),
  onStopTyping: async (cb) => (await getSocket()).on('user_stopped_typing', cb),
  joinChat: async (chatId) => (await getSocket()).emit('join_chat', chatId),
  leaveChat: async (chatId) => (await getSocket()).emit('leave_chat', chatId),
  sendTyping: async (chatId, userName) => (await getSocket()).emit('typing_start', { chatId, userName }),
  stopTyping: async (chatId) => (await getSocket()).emit('typing_stop', { chatId }),
};

// ── Redirect helpers ──────────────────────────────────────────────────────────
function requireAuth() {
  if (!getToken()) { window.location.href = 'login.html'; return false; }
  return true;
}
function redirectIfAuth() {
  if (getToken()) { window.location.href = 'app.html'; }
}

// ── Export as window.PlugMe ───────────────────────────────────────────────────
window.PlugMe = {
  BACKEND_URL,
  getToken, getUser, saveAuth, clearAuth,
  authAPI, usersAPI, jobsAPI, offersAPI, chatsAPI, reviewsAPI, unlockAPI,
  getSocket, socketHandlers,
  requireAuth, redirectIfAuth,
};
