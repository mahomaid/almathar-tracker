
// Almathar Simulation Readiness Tracker — frontend v5
// New in v5:
//   - Quick log is the only capture mode (Full form removed)
//   - Sim ID = area code dropdown + free serial (e.g. OP + 005 -> OP-005)
//   - Day-1 stopper toggle on every gap
//   - One photo per gap, uploaded to Drive via Apps Script
//   - Dashboard prominently shows Day-1 stoppers count

const AREA_CODES = ['ED', 'IP', 'OP', 'ICU', 'OR', 'Radiology', 'Lab', 'Pharmacy', 'Maternity', 'Admin'];

const DOMAINS = [
  { id: 'billing',    label: 'Billing & Registration',     short: 'Billing',    icon: 'ti-receipt',       ramp: 'blue'   },
  { id: 'nursing',    label: 'Clinical & Nursing',         short: 'Nursing',    icon: 'ti-stethoscope',   ramp: 'teal'   },
  { id: 'physicians', label: 'Medical Team (Physicians)',  short: 'Physicians', icon: 'ti-user-heart',    ramp: 'purple' },
  { id: 'it',         label: 'IT & Systems',               short: 'IT',         icon: 'ti-device-desktop',ramp: 'coral'  },
  { id: 'lab',        label: 'Laboratory',                 short: 'Lab',        icon: 'ti-test-pipe',     ramp: 'pink'   },
  { id: 'radiology',  label: 'Radiology',                  short: 'Radiology',  icon: 'ti-radioactive',   ramp: 'amber'  },
  { id: 'infra',      label: 'Infrastructure',             short: 'Infra',      icon: 'ti-building',      ramp: 'gray'   },
  { id: 'safety',     label: 'Patient Safety & Quality',   short: 'Safety',     icon: 'ti-shield-check',  ramp: 'green'  }
];

const PRIORITY = {
  CR: { label: 'Critical', color: 'red' },
  HI: { label: 'High',     color: 'amber' },
  ME: { label: 'Medium',   color: 'blue' },
  LO: { label: 'Low',      color: 'gray' }
};

const STATUS = {
  P:  'Pending',
  IP: 'In progress',
  C:  'Completed',
  V:  'Verified',
  D:  'Deferred'
};

const state = {
  gaps: [],
  users: [],
  currentUser: null,
  currentArea: 'OP',
  currentSerial: '',
  currentDate: new Date().toISOString().slice(0, 10),
  inboxFilter: 'all',
  activeTab: 'capture',
  quickDomain: null,
  quickPriority: 'ME',
  quickStopper: false,
  pendingPhoto: null    // { url, id, name } after upload, before save
};

function userLabel(u) {
  if (!u) return '';
  if (u.staffId) return `${u.name} (${u.staffId})`;
  return u.name;
}

function parseUserLabel(s) {
  const m = String(s || '').match(/^(.+?)\s*\((\d+)\)\s*$/);
  if (m) return { name: m[1].trim(), staffId: m[2].trim() };
  return { name: String(s || '').trim(), staffId: '' };
}

function urlParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return {
      pwd: p.get('p') || '',
      sim: p.get('sim') || '',
      area: p.get('area') || ''
    };
  } catch (e) { return { pwd: '', sim: '', area: '' }; }
}

function fullSimId() {
  const serial = String(state.currentSerial || '').trim();
  if (!serial) return state.currentArea;
  return `${state.currentArea}-${serial}`;
}

// ----- Access gate -----
function checkAccessGate() {
  const required = window.APP_PASSWORD || '';
  if (!required) return true;
  const fromUrl = urlParams().pwd;
  if (fromUrl && fromUrl === required) {
    try { sessionStorage.setItem('almathar_access', required); } catch (e) {}
    return true;
  }
  try { if (sessionStorage.getItem('almathar_access') === required) return true; } catch (e) {}
  return false;
}

function submitAccessPassword() {
  const input = document.getElementById('access-input');
  const required = window.APP_PASSWORD || '';
  if (input.value === required) {
    try { sessionStorage.setItem('almathar_access', required); } catch (e) {}
    document.getElementById('access-overlay').style.display = 'none';
    bootAfterAccess();
  } else {
    document.getElementById('access-error').style.display = 'block';
    input.value = '';
    input.focus();
  }
}

// ----- Identity -----
function loadIdentity() {
  try {
    const saved = localStorage.getItem('almathar_user_v3');
    if (saved) state.currentUser = JSON.parse(saved);
  } catch (e) {}
}

function saveIdentity(name, staffId) {
  state.currentUser = { name, staffId };
  try { localStorage.setItem('almathar_user_v3', JSON.stringify(state.currentUser)); } catch (e) {}
}

function clearIdentity() {
  state.currentUser = null;
  try { localStorage.removeItem('almathar_user_v3'); } catch (e) {}
}

function promptForIdentity() {
  document.getElementById('identity-overlay').style.display = 'flex';
  document.getElementById('identity-name').value = '';
  document.getElementById('identity-staffid').value = '';
  document.getElementById('identity-error').style.display = 'none';
  setTimeout(() => document.getElementById('identity-name').focus(), 50);
}

async function submitIdentity() {
  const name = document.getElementById('identity-name').value.trim();
  const staffId = document.getElementById('identity-staffid').value.trim();
  const err = document.getElementById('identity-error');
  if (name.length < 2) { err.textContent = 'Please enter your full name.'; err.style.display = 'block'; return; }
  if (!/^\d{3,8}$/.test(staffId)) { err.textContent = 'Staff ID must be 3 to 8 digits.'; err.style.display = 'block'; return; }
  saveIdentity(name, staffId);
  document.getElementById('identity-overlay').style.display = 'none';
  renderIdentityBadge();
  try {
    await fetch(window.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'registerUser', userObj: state.currentUser, user: userLabel(state.currentUser) })
    });
  } catch (e) {}
  applyUrlContext();
  refresh();
}

function renderIdentityBadge() {
  const el = document.getElementById('identity-badge');
  if (!state.currentUser) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <span class="who-name">${escapeHtml(state.currentUser.name)}</span>
    <span class="who-id">${escapeHtml(state.currentUser.staffId)}</span>
    <button onclick="changeIdentity()" class="who-edit" title="Change identity" aria-label="Change identity">
      <i class="ti ti-user-edit"></i>
    </button>
  `;
}

function changeIdentity() {
  if (!confirm('Change the identity attributed to your actions?')) return;
  clearIdentity();
  promptForIdentity();
}

// ----- API -----
function isConfigured() {
  return typeof window.API_URL === 'string' && !window.API_URL.includes('PASTE_YOUR');
}

async function apiList() {
  if (!isConfigured()) return { gaps: [], users: [] };
  const res = await fetch(window.API_URL + '?action=list');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'list failed');
  return { gaps: data.gaps || [], users: data.users || [] };
}

async function apiUpsert(gap, newUsers) {
  if (!isConfigured()) return gap;
  const res = await fetch(window.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'upsert', gap,
      user: userLabel(state.currentUser) || 'web',
      userObj: state.currentUser,
      newUsers: newUsers || []
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'upsert failed');
  if (data.users) state.users = data.users;
  return data.gap;
}

async function apiDelete(id) {
  if (!isConfigured()) return;
  const res = await fetch(window.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'delete', id,
      user: userLabel(state.currentUser) || 'web',
      userObj: state.currentUser
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'delete failed');
}

async function apiUploadPhoto(file) {
  if (!isConfigured()) throw new Error('Not configured');
  // Read file as base64, compress if large
  const compressed = await compressImage(file, 1280, 0.75);
  const base64 = await fileToBase64(compressed);
  const res = await fetch(window.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'uploadPhoto',
      filename: file.name || ('photo_' + Date.now() + '.jpg'),
      mimeType: compressed.type || 'image/jpeg',
      base64,
      user: userLabel(state.currentUser) || 'web'
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'upload failed');
  return data.photo;
}

// ----- Image utilities -----
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('compression failed'));
        blob.name = file.name;
        resolve(blob);
      }, 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ----- helpers -----
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function configBanner() {
  const el = document.getElementById('config-banner');
  if (!isConfigured()) {
    el.innerHTML = '<div class="config-banner"><i class="ti ti-alert-triangle"></i> Not connected to Google Sheets.</div>';
  } else {
    el.innerHTML = '';
  }
}

function domainOf(id) { return DOMAINS.find(d => d.id === id) || DOMAINS[0]; }

function fmtDateTime(s) {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) { return s; }
}

function setTab(t) {
  ['capture', 'inbox', 'dashboard'].forEach(x => {
    document.getElementById('view-' + x).style.display = (x === t) ? 'block' : 'none';
    document.getElementById('tab-' + x).classList.toggle('active', x === t);
  });
  state.activeTab = t;
  render();
}

async function refresh() {
  try {
    const data = await apiList();
    state.gaps = data.gaps;
    state.users = data.users;
    render();
  } catch (err) {
    console.error(err);
    toast('Could not load — check connection', true);
  }
}

function userDatalistHTML(listId) {
  const seen = new Set();
  const opts = [];
  state.users.forEach(u => {
    const label = userLabel(u);
    if (!seen.has(label.toLowerCase())) {
      seen.add(label.toLowerCase());
      opts.push(`<option value="${escapeHtml(label)}">`);
    }
  });
  return `<datalist id="${listId}">${opts.join('')}</datalist>`;
}

function resolveAssignee(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return { user: null, isNew: false };
  const parsed = parseUserLabel(raw);
  let match = state.users.find(u => parsed.staffId && u.staffId === parsed.staffId);
  if (!match) match = state.users.find(u => u.name.toLowerCase() === parsed.name.toLowerCase());
  if (match) return { user: match, isNew: false };
  if (!/^\d{3,8}$/.test(parsed.staffId)) {
    return { user: null, isNew: true, error: `New person "${parsed.name}" needs a staff ID in parentheses, e.g. "${parsed.name} (12345)"` };
  }
  return { user: parsed, isNew: true };
}

function applyUrlContext() {
  const p = urlParams();
  if (p.area && AREA_CODES.includes(p.area)) state.currentArea = p.area;
  if (p.sim) {
    // Accept "OP-005" or just a serial like "005"
    const m = String(p.sim).match(/^([A-Za-z]+)-?(.+)$/);
    if (m && AREA_CODES.includes(m[1].toUpperCase())) {
      state.currentArea = m[1].toUpperCase();
      state.currentSerial = m[2];
    } else {
      state.currentSerial = String(p.sim);
    }
  }
}

// ----- Capture (single mode) -----
function renderCapture() {
  const el = document.getElementById('view-capture');
  el.innerHTML = `
    <div class="quick-form">
      <div class="sim-row">
        <div>
          <label>Area</label>
          <select id="q-area">
            ${AREA_CODES.map(a => `<option value="${a}" ${a === state.currentArea ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Serial</label>
          <input id="q-serial" value="${escapeHtml(state.currentSerial)}" placeholder="001" inputmode="numeric">
        </div>
        <div class="sim-preview">
          <label>Sim ID</label>
          <div class="sim-tag" id="sim-preview">${escapeHtml(fullSimId())}</div>
        </div>
      </div>

      <div class="quick-label">1. Workstream</div>
      <div class="chip-row">
        ${DOMAINS.map(d => `
          <button class="chip chip-${d.ramp} ${state.quickDomain === d.id ? 'selected' : ''}" onclick="pickDomain('${d.id}')">
            <i class="ti ${d.icon}"></i><span>${d.short}</span>
          </button>
        `).join('')}
      </div>

      <div class="quick-label">2. Priority</div>
      <div class="chip-row priority-row">
        ${Object.entries(PRIORITY).map(([k, v]) => `
          <button class="chip chip-${v.color} ${state.quickPriority === k ? 'selected' : ''}" onclick="pickPriority('${k}')">${v.label}</button>
        `).join('')}
      </div>

      <div class="quick-label">3. What happened?</div>
      <textarea id="q-text" rows="2" placeholder="One sentence. Be specific. (e.g. POS terminal not available at front desk)"></textarea>

      <div class="stopper-row">
        <label class="stopper-toggle">
          <input type="checkbox" id="q-stopper" ${state.quickStopper ? 'checked' : ''} onchange="state.quickStopper=this.checked">
          <span class="stopper-pill">
            <i class="ti ti-flag-3"></i> Day-1 stopper
          </span>
        </label>
        <span class="stopper-hint">Tick if this blocks Day 0 launch if not resolved</span>
      </div>

      <div class="photo-row">
        <label>Photo (optional)</label>
        <div id="photo-area">
          ${renderPhotoArea()}
        </div>
      </div>

      <div class="quick-meta">
        <button class="primary big" onclick="addQuickGap()"><i class="ti ti-plus"></i> Log gap</button>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin: 1.25rem 0 8px;">
      <div style="font-size:14px; font-weight:500;">Recent gaps (${state.gaps.length})</div>
      <button onclick="refresh()" class="ghost-btn"><i class="ti ti-refresh"></i> Reload</button>
    </div>
    <div id="capture-list"></div>
  `;

  document.getElementById('q-area').addEventListener('change', (e) => {
    state.currentArea = e.target.value;
    document.getElementById('sim-preview').textContent = fullSimId();
  });
  document.getElementById('q-serial').addEventListener('input', (e) => {
    state.currentSerial = e.target.value;
    document.getElementById('sim-preview').textContent = fullSimId();
  });

  renderCaptureList();
}

function renderPhotoArea() {
  if (state.pendingPhoto) {
    return `
      <div class="photo-preview">
        <img src="${escapeHtml(state.pendingPhoto.url)}" alt="Preview" referrerpolicy="no-referrer">
        <button class="ghost-btn" onclick="clearPendingPhoto()"><i class="ti ti-x"></i> Remove</button>
      </div>
    `;
  }
  return `
    <label class="photo-btn">
      <input type="file" accept="image/*" capture="environment" onchange="onPhotoSelected(event)" style="display:none;">
      <i class="ti ti-camera"></i> Take or choose photo
    </label>
  `;
}

async function onPhotoSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  toast('Uploading photo…');
  try {
    const photo = await apiUploadPhoto(file);
    state.pendingPhoto = photo;
    document.getElementById('photo-area').innerHTML = renderPhotoArea();
    toast('Photo attached');
  } catch (err) {
    console.error(err);
    toast('Photo upload failed', true);
  }
}

function clearPendingPhoto() {
  state.pendingPhoto = null;
  document.getElementById('photo-area').innerHTML = renderPhotoArea();
}

function pickDomain(id) {
  state.quickDomain = id;
  // Re-render only the chip rows to avoid wiping the textarea
  const chipRows = document.querySelectorAll('.chip-row');
  if (chipRows.length) chipRows[0].innerHTML = DOMAINS.map(d => `
    <button class="chip chip-${d.ramp} ${state.quickDomain === d.id ? 'selected' : ''}" onclick="pickDomain('${d.id}')">
      <i class="ti ${d.icon}"></i><span>${d.short}</span>
    </button>
  `).join('');
}

function pickPriority(p) {
  state.quickPriority = p;
  const chipRows = document.querySelectorAll('.chip-row');
  if (chipRows.length >= 2) chipRows[1].innerHTML = Object.entries(PRIORITY).map(([k, v]) => `
    <button class="chip chip-${v.color} ${state.quickPriority === k ? 'selected' : ''}" onclick="pickPriority('${k}')">${v.label}</button>
  `).join('');
}

async function addQuickGap() {
  if (!state.currentUser) { promptForIdentity(); return; }
  const text = document.getElementById('q-text').value.trim();
  if (!state.quickDomain) { toast('Pick a workstream', true); return; }
  if (!text) { toast('Add a description', true); return; }
  const serial = document.getElementById('q-serial').value.trim();
  state.currentSerial = serial;
  const sim = fullSimId();
  state.quickStopper = document.getElementById('q-stopper').checked;

  const gap = {
    id: 'g_' + Date.now(),
    sim,
    date: state.currentDate,
    domain: state.quickDomain,
    text,
    priority: state.quickPriority,
    owner: domainOf(state.quickDomain).label,
    assignedTo: '',
    actionPlan: '',
    status: 'P',
    due: '',
    isStopper: state.quickStopper ? 'YES' : '',
    photoUrl: state.pendingPhoto ? state.pendingPhoto.url : '',
    photoId: state.pendingPhoto ? state.pendingPhoto.id : '',
    loggedBy: userLabel(state.currentUser)
  };

  try {
    const saved = await apiUpsert(gap, []);
    state.gaps.push(saved);
    toast(state.quickStopper ? 'Logged · flagged as Day-1 stopper' : 'Logged');
    document.getElementById('q-text').value = '';
    document.getElementById('q-stopper').checked = false;
    state.quickStopper = false;
    state.pendingPhoto = null;
    document.getElementById('photo-area').innerHTML = renderPhotoArea();
    renderCaptureList();
  } catch (err) {
    console.error(err);
    toast('Save failed', true);
  }
}

function renderCaptureList() {
  const list = document.getElementById('capture-list');
  if (!list) return;
  const sorted = [...state.gaps].sort((a, b) => (b.id > a.id ? 1 : -1)).slice(0, 15);
  if (sorted.length === 0) {
    list.innerHTML = '<div class="empty">No gaps yet.</div>';
    return;
  }
  list.innerHTML = sorted.map(g => {
    const d = domainOf(g.domain);
    const p = PRIORITY[g.priority] || PRIORITY.ME;
    return `
      <div class="gap-item compact">
        <div class="gap-row">
          <span class="pill c-${d.ramp}"><i class="ti ${d.icon}"></i>${d.short}</span>
          <span class="pill c-${p.color}">${p.label}</span>
          ${g.isStopper === 'YES' ? '<span class="pill c-red"><i class="ti ti-flag-3"></i> Stopper</span>' : ''}
          ${g.photoUrl ? `<a href="${escapeHtml(g.photoUrl)}" target="_blank" class="pill c-gray" title="View photo"><i class="ti ti-photo"></i></a>` : ''}
          <span class="gap-text">${escapeHtml(g.text)}</span>
          <button onclick="deleteGap('${g.id}')" aria-label="Delete" class="ghost-btn"><i class="ti ti-trash"></i></button>
        </div>
        <div class="gap-byline">
          ${escapeHtml(g.sim)} · By ${escapeHtml(g.loggedBy || '—')}
          ${g.assignedTo ? ` · To ${escapeHtml(g.assignedTo)}` : ' · Awaiting assignment'}
          ${g.due ? ` · Due ${g.due}` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function deleteGap(id) {
  if (!confirm('Remove this gap? Any attached photo will also be deleted.')) return;
  try {
    await apiDelete(id);
    state.gaps = state.gaps.filter(g => g.id !== id);
    toast('Deleted');
    render();
  } catch (err) {
    console.error(err);
    toast('Delete failed', true);
  }
}

// ----- Inbox -----
function renderInbox() {
  const el = document.getElementById('view-inbox');
  const filter = state.inboxFilter;
  const counts = {};
  DOMAINS.forEach(d => counts[d.id] = state.gaps.filter(g => g.domain === d.id).length);
  const myLabel = userLabel(state.currentUser);
  const mineCount = state.gaps.filter(g => g.assignedTo && g.assignedTo === myLabel).length;
  const unassigned = state.gaps.filter(g => !g.assignedTo).length;
  const stoppers = state.gaps.filter(g => g.isStopper === 'YES' && g.status !== 'C' && g.status !== 'V').length;

  el.innerHTML = `
    <div class="filter-row">
      <button class="${filter === 'all' ? 'active' : ''}" onclick="setInboxFilter('all')">All (${state.gaps.length})</button>
      <button class="${filter === 'stoppers' ? 'active' : ''}" onclick="setInboxFilter('stoppers')">
        <i class="ti ti-flag-3"></i> Day-1 stoppers (${stoppers})
      </button>
      <button class="${filter === 'unassigned' ? 'active' : ''}" onclick="setInboxFilter('unassigned')">
        <i class="ti ti-alert-circle"></i> Unassigned (${unassigned})
      </button>
      <button class="${filter === 'mine' ? 'active' : ''}" onclick="setInboxFilter('mine')">
        <i class="ti ti-user"></i> Mine (${mineCount})
      </button>
      ${DOMAINS.map(d => `
        <button class="${filter === d.id ? 'active' : ''}" onclick="setInboxFilter('${d.id}')">
          <i class="ti ${d.icon}"></i> ${d.short} (${counts[d.id]})
        </button>
      `).join('')}
    </div>
    <div id="inbox-list"></div>
    ${userDatalistHTML('users-list-inbox')}
  `;

  const list = document.getElementById('inbox-list');
  let items;
  if (filter === 'all') items = state.gaps;
  else if (filter === 'mine') items = state.gaps.filter(g => g.assignedTo && g.assignedTo === myLabel);
  else if (filter === 'unassigned') items = state.gaps.filter(g => !g.assignedTo);
  else if (filter === 'stoppers') items = state.gaps.filter(g => g.isStopper === 'YES' && g.status !== 'C' && g.status !== 'V');
  else items = state.gaps.filter(g => g.domain === filter);

  if (items.length === 0) {
    list.innerHTML = '<div class="empty">No gaps in this view.</div>';
    return;
  }
  list.innerHTML = items.map(g => {
    const d = domainOf(g.domain);
    const p = PRIORITY[g.priority] || PRIORITY.ME;
    return `
      <div class="gap-item ${g.isStopper === 'YES' ? 'is-stopper' : ''}">
        <div class="gap-meta">
          <span class="pill c-${d.ramp}"><i class="ti ${d.icon}"></i>${d.label}</span>
          <span class="pill c-${p.color}">${p.label}</span>
          ${g.isStopper === 'YES' ? '<span class="pill c-red"><i class="ti ti-flag-3"></i> Day-1 stopper</span>' : ''}
          ${!g.assignedTo ? '<span class="pill c-amber"><i class="ti ti-alert-circle"></i> Unassigned</span>' : ''}
          <span style="color:var(--text-2); margin-left:auto;">${escapeHtml(g.sim)} · ${g.date}</span>
        </div>
        <div style="font-size:14px; margin-bottom:10px;">${escapeHtml(g.text)}</div>
        ${g.photoUrl ? `
          <div class="inbox-photo">
            <a href="${escapeHtml(g.photoUrl)}" target="_blank">
              <img src="${escapeHtml(g.photoUrl)}" alt="Photo" referrerpolicy="no-referrer">
            </a>
          </div>
        ` : ''}
        <div class="inbox-fields">
          <div>
            <label>Assigned to (person)</label>
            <input id="as-${g.id}" list="users-list-inbox" value="${escapeHtml(g.assignedTo || '')}" placeholder="Type name (staffId)" autocomplete="off">
          </div>
          <div>
            <label>Target date</label>
            <input id="du-${g.id}" type="date" value="${g.due || ''}">
          </div>
          <div>
            <label>Status</label>
            <select id="st-${g.id}">
              ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === g.status ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="stopper-row" style="margin: 4px 0 10px;">
          <label class="stopper-toggle">
            <input type="checkbox" id="sp-${g.id}" ${g.isStopper === 'YES' ? 'checked' : ''}>
            <span class="stopper-pill">
              <i class="ti ti-flag-3"></i> Day-1 stopper
            </span>
          </label>
        </div>
        <label>Action plan / response</label>
        <textarea id="ap-${g.id}" rows="2" placeholder="What will you do, by when, who is responsible...">${escapeHtml(g.actionPlan || '')}</textarea>
        <div style="display:flex; gap:8px; margin-top:8px; align-items:center; flex-wrap:wrap;">
          <div style="font-size:11px; color:var(--text-2);">
            Logged by <strong>${escapeHtml(g.loggedBy || '—')}</strong>
            ${g.lastEditedBy ? ` · Last edited by <strong>${escapeHtml(g.lastEditedBy)}</strong> on ${escapeHtml(fmtDateTime(g.updatedAt))}` : ''}
          </div>
          <button class="primary" onclick="saveResponse('${g.id}')" style="margin-left:auto;">
            <i class="ti ti-check"></i> Save
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function setInboxFilter(f) { state.inboxFilter = f; render(); }

async function saveResponse(id) {
  if (!state.currentUser) { promptForIdentity(); return; }
  const g = state.gaps.find(x => x.id === id);
  if (!g) return;
  const assignedRaw = document.getElementById('as-' + id).value;
  const resolution = resolveAssignee(assignedRaw);
  if (assignedRaw && resolution.error) { alert(resolution.error); return; }
  const newUsers = (resolution.isNew && resolution.user) ? [resolution.user] : [];

  g.actionPlan = document.getElementById('ap-' + id).value;
  g.status = document.getElementById('st-' + id).value;
  g.assignedTo = resolution.user ? userLabel(resolution.user) : '';
  g.due = document.getElementById('du-' + id).value;
  g.isStopper = document.getElementById('sp-' + id).checked ? 'YES' : '';
  try {
    const saved = await apiUpsert(g, newUsers);
    Object.assign(g, saved);
    toast(newUsers.length ? `Saved · ${newUsers[0].name} added` : 'Saved');
    render();
  } catch (err) {
    console.error(err);
    toast('Save failed', true);
  }
}

// ----- Dashboard -----
function renderDashboard() {
  const el = document.getElementById('view-dashboard');
  const total = state.gaps.length;
  const open = state.gaps.filter(g => g.status === 'P' || g.status === 'IP').length;
  const completed = state.gaps.filter(g => g.status === 'C' || g.status === 'V').length;
  const critical = state.gaps.filter(g => g.priority === 'CR').length;
  const unassigned = state.gaps.filter(g => !g.assignedTo).length;
  const stoppers = state.gaps.filter(g => g.isStopper === 'YES' && g.status !== 'C' && g.status !== 'V').length;
  const pctClosed = total ? Math.round(completed / total * 100) : 0;

  const byDomain = DOMAINS.map(d => {
    const items = state.gaps.filter(g => g.domain === d.id);
    return {
      ...d,
      total: items.length,
      open: items.filter(g => g.status === 'P' || g.status === 'IP').length,
      stoppers: items.filter(g => g.isStopper === 'YES' && g.status !== 'C' && g.status !== 'V').length,
      done: items.filter(g => g.status === 'C' || g.status === 'V').length
    };
  }).filter(d => d.total > 0);

  const today = new Date(state.currentDate);
  const openItems = state.gaps
    .filter(g => g.status === 'P' || g.status === 'IP')
    .map(g => {
      let rag = 'green';
      if (!g.due) rag = 'amber';
      else {
        const due = new Date(g.due);
        const days = Math.round((due - today) / (1000 * 60 * 60 * 24));
        if (days < 0) rag = 'red';
        else if (days <= 3) rag = 'amber';
      }
      if (g.isStopper === 'YES') rag = 'red';
      if (g.priority === 'CR' && g.status === 'P') rag = 'red';
      return { ...g, rag };
    })
    .sort((a, b) => {
      // Stoppers always first within each rag
      if ((a.isStopper === 'YES') !== (b.isStopper === 'YES')) return a.isStopper === 'YES' ? -1 : 1;
      return ({ red: 0, amber: 1, green: 2 })[a.rag] - ({ red: 0, amber: 1, green: 2 })[b.rag];
    });

  el.innerHTML = `
    ${stoppers > 0 ? `
      <div class="stopper-banner">
        <i class="ti ti-flag-3"></i>
        <strong>${stoppers}</strong> Day-1 stopper${stoppers === 1 ? '' : 's'} open — Day 0 launch at risk if not resolved.
      </div>
    ` : ''}

    <div class="grid-stats">
      <div class="stat"><div class="lbl">Total</div><div class="num">${total}</div></div>
      <div class="stat stat-stopper"><div class="lbl">Day-1 stoppers</div><div class="num">${stoppers}</div></div>
      <div class="stat"><div class="lbl">Open</div><div class="num" style="color:var(--warn);">${open}</div></div>
      <div class="stat"><div class="lbl">Critical</div><div class="num" style="color:var(--danger);">${critical}</div></div>
      <div class="stat"><div class="lbl">Unassigned</div><div class="num" style="color:var(--warn);">${unassigned}</div></div>
      <div class="stat"><div class="lbl">% closed</div><div class="num" style="color:var(--success);">${pctClosed}%</div></div>
    </div>

    <div style="font-size:14px; font-weight:500; margin-bottom:8px;">Gaps by workstream</div>
    <div class="card" style="margin-bottom:1rem;">
      ${byDomain.length === 0 ? '<div class="empty">No data yet.</div>' : byDomain.map(d => {
        const openPct = d.total ? (d.open / d.total * 100) : 0;
        const donePct = d.total ? (d.done / d.total * 100) : 0;
        return `
          <div class="bar-row">
            <div class="bar-label"><i class="ti ${d.icon}"></i>${d.label}</div>
            <div class="bar">
              <div class="bar-done" style="width:${donePct}%;"></div>
              <div class="bar-open" style="width:${openPct}%;"></div>
            </div>
            <div class="bar-count">${d.done}/${d.total}${d.stoppers ? ` · <span style="color:var(--danger);"><i class="ti ti-flag-3"></i> ${d.stoppers}</span>` : ''}</div>
          </div>
        `;
      }).join('')}
    </div>

    <div style="font-size:14px; font-weight:500; margin-bottom:8px;">Open action items (stoppers first, then RAG)</div>
    <div class="card" style="padding:0; overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th style="width:14px;"></th>
            <th>Flag</th>
            <th>Workstream</th>
            <th>Gap</th>
            <th>Assigned</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${openItems.slice(0, 25).map(g => {
            const d = domainOf(g.domain);
            return `
              <tr>
                <td class="rag-${g.rag}"></td>
                <td>${g.isStopper === 'YES' ? '<i class="ti ti-flag-3" style="color:var(--danger);" title="Day-1 stopper"></i>' : ''}</td>
                <td><i class="ti ${d.icon}"></i> ${d.short}</td>
                <td>${escapeHtml(g.text)} ${g.photoUrl ? '<i class="ti ti-photo" style="color:var(--text-2); margin-left:4px;"></i>' : ''}</td>
                <td>${escapeHtml(g.assignedTo || '—')}</td>
                <td>${g.due || '—'}</td>
                <td>${STATUS[g.status]}</td>
              </tr>
            `;
          }).join('')}
          ${openItems.length === 0 ? '<tr><td colspan="7" class="empty">All clear.</td></tr>' : ''}
        </tbody>
      </table>
    </div>

    <div style="display:flex; gap:8px; margin-top:1rem; flex-wrap:wrap;">
      <button onclick="refresh()"><i class="ti ti-refresh"></i> Reload</button>
      <button onclick="exportCSV()"><i class="ti ti-download"></i> Export CSV</button>
      <button onclick="window.print()"><i class="ti ti-printer"></i> Print</button>
    </div>
  `;
}

function exportCSV() {
  const cols = ['id', 'sim', 'date', 'domain', 'text', 'priority', 'isStopper', 'owner', 'assignedTo', 'actionPlan', 'status', 'due', 'photoUrl', 'loggedBy', 'lastEditedBy', 'createdAt', 'updatedAt'];
  const rows = [cols.join(',')].concat(
    state.gaps.map(g => cols.map(c => `"${String(g[c] || '').replace(/"/g, '""')}"`).join(','))
  );
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'almathar-gaps.csv'; a.click();
}

// ----- Init -----
function render() {
  if (state.activeTab === 'capture') renderCapture();
  if (state.activeTab === 'inbox') renderInbox();
  if (state.activeTab === 'dashboard') renderDashboard();
}

function bootAfterAccess() {
  configBanner();
  loadIdentity();
  renderIdentityBadge();
  applyUrlContext();
  setTab('capture');
  if (!state.currentUser) promptForIdentity();
  else refresh();
}

function init() {
  if (!checkAccessGate()) {
    document.getElementById('access-overlay').style.display = 'flex';
    setTimeout(() => document.getElementById('access-input').focus(), 50);
    document.getElementById('access-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitAccessPassword();
    });
  } else {
    bootAfterAccess();
  }
  document.getElementById('identity-staffid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitIdentity();
  });
}

init();
