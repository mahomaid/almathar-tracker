// Almathar Simulation Readiness Tracker — frontend v8
// New in v8:
//   - "Assigned to" renamed to "Owner" across the app
//   - Owner becomes a dropdown sourced from the People tab in the Sheet
//   - Dropdown is filtered to people in the same workstream by default
//   - "Email Owner" button on each gap (mailto: link, opens email client)
//   - Legacy free-text assignedTo values are preserved and displayed

const AREA_CODES = ['ED', 'IP', 'OP', 'ICU', 'OR', 'Radiology', 'Lab', 'Pharmacy', 'Maternity', 'Admin'];

const DOMAINS = [
  { id: 'billing',     label: 'Billing & Registration',    short: 'Billing',     icon: 'ti-receipt',        ramp: 'blue'   },
  { id: 'nursing',     label: 'Clinical & Nursing',        short: 'Nursing',     icon: 'ti-stethoscope',    ramp: 'teal'   },
  { id: 'physicians',  label: 'Medical Team (Physicians)', short: 'Physicians',  icon: 'ti-user-heart',     ramp: 'purple' },
  { id: 'patientsvc',  label: 'Patient Services',          short: 'Patient Svc', icon: 'ti-users',          ramp: 'blue'   },
  { id: 'pharmacy',    label: 'Pharmacy',                  short: 'Pharmacy',    icon: 'ti-vaccine',        ramp: 'purple' },
  { id: 'foodsvc',     label: 'Food Service',              short: 'Food',        icon: 'ti-soup',           ramp: 'amber'  },
  { id: 'environ',     label: 'Environmental',             short: 'Environ',     icon: 'ti-leaf',           ramp: 'green'  },
  { id: 'ipc',         label: 'Infection Control',         short: 'IPC',         icon: 'ti-bacteria',       ramp: 'pink'   },
  { id: 'morgue',      label: 'Morgue',                    short: 'Morgue',      icon: 'ti-cross',          ramp: 'gray'   },
  { id: 'fms',         label: 'FMS (Facilities)',          short: 'FMS',         icon: 'ti-building',       ramp: 'gray'   },
  { id: 'clineng',     label: 'Clinical Engineering',      short: 'Clin Eng',    icon: 'ti-tool',           ramp: 'coral'  },
  { id: 'it',          label: 'IT & Systems',              short: 'IT',          icon: 'ti-device-desktop', ramp: 'coral'  },
  { id: 'lab',         label: 'Laboratory',                short: 'Lab',         icon: 'ti-test-pipe',      ramp: 'pink'   },
  { id: 'radiology',   label: 'Radiology',                 short: 'Radiology',   icon: 'ti-radioactive',    ramp: 'amber'  },
  { id: 'safety',      label: 'Patient Safety & Quality',  short: 'Safety',      icon: 'ti-shield-check',   ramp: 'green'  },
  { id: 'signage',     label: 'Signage & Wayfinding',      short: 'Signage',     icon: 'ti-direction-sign', ramp: 'blue'   },
  { id: 'parking',     label: 'Parking & Transport',       short: 'Parking',     icon: 'ti-parking',        ramp: 'gray'   },
  { id: 'security',    label: 'Security',                  short: 'Security',    icon: 'ti-shield',         ramp: 'amber'  },
  { id: 'general',     label: 'General / Other',           short: 'General',     icon: 'ti-help-circle',    ramp: 'gray'   }
];

const PRIORITY = {
  CR: { label: 'Critical', color: 'red' },
  HI: { label: 'High',     color: 'amber' },
  ME: { label: 'Medium',   color: 'blue' },
  LO: { label: 'Low',      color: 'gray' }
};

const STATUS = { NF: 'Not fixed', FX: 'Fixed', DF: 'Deferred' };

const state = {
  gaps: [],
  users: [],
  leaders: [],
  roleFlags: [],
  people: [],
  currentUser: null,
  currentArea: 'OP',
  currentSerial: '',
  currentDate: new Date().toISOString().slice(0, 10),
  inboxFilter: 'all',
  sourceFilter: 'all',
  captureSource: 'snag',
  activeTab: 'capture',
  quickDomain: null,
  quickPriority: 'ME',
  quickStopper: false,
  pendingPhoto: null
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
    return { pwd: p.get('p') || '', sim: p.get('sim') || '', area: p.get('area') || '', source: p.get('source') || '' };
  } catch (e) { return { pwd: '', sim: '', area: '', source: '' }; }
}

function fullSimId() {
  const serial = String(state.currentSerial || '').trim();
  if (!serial) return state.currentArea;
  return `${state.currentArea}-${serial}`;
}

function leaderFor(domainId) { return state.leaders.find(l => l.domain === domainId) || null; }

// Look up a person from the People tab by their display label.
// Format used: "Name (staffId)" — same as userLabel.
function personByLabel(label) {
  if (!label) return null;
  const parsed = parseUserLabel(label);
  if (parsed.staffId) {
    return state.people.find(p => p.staffId === parsed.staffId) || null;
  }
  return state.people.find(p => p.name.toLowerCase() === parsed.name.toLowerCase()) || null;
}

function peopleForWorkstream(domainId) {
  return state.people.filter(p => p.workstream === domainId);
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
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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
function isConfigured() { return typeof window.API_URL === 'string' && !window.API_URL.includes('PASTE_YOUR'); }

async function apiList() {
  if (!isConfigured()) return { gaps: [], users: [], leaders: [], roleFlags: [], people: [] };
  const res = await fetch(window.API_URL + '?action=list');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'list failed');
  return {
    gaps: data.gaps || [], users: data.users || [], leaders: data.leaders || [],
    roleFlags: data.roleFlags || [], people: data.people || []
  };
}

async function apiUpsert(gap, newUsers) {
  if (!isConfigured()) return gap;
  const res = await fetch(window.API_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'upsert', gap, user: userLabel(state.currentUser) || 'web', userObj: state.currentUser, newUsers: newUsers || [] })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'upsert failed');
  if (data.users) state.users = data.users;
  return data.gap;
}

async function apiDelete(id) {
  if (!isConfigured()) return;
  const res = await fetch(window.API_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'delete', id, user: userLabel(state.currentUser) || 'web', userObj: state.currentUser })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'delete failed');
}

async function apiSetLeader(domain, name, staffId) {
  if (!isConfigured()) return;
  const res = await fetch(window.API_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'setLeader', domain, leaderName: name, leaderStaffId: staffId, user: userLabel(state.currentUser) || 'web' })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'setLeader failed');
  state.leaders = data.leaders || [];
}

async function apiClearLeader(domain) {
  if (!isConfigured()) return;
  const res = await fetch(window.API_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'clearLeader', domain, user: userLabel(state.currentUser) || 'web' })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'clearLeader failed');
  state.leaders = data.leaders || [];
}

async function apiUploadPhoto(file) {
  if (!isConfigured()) throw new Error('Not configured');
  const compressed = await compressImage(file, 1280, 0.75);
  const base64 = await fileToBase64(compressed);
  const res = await fetch(window.API_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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
        if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
        else { width = Math.round(width * (maxDim / height)); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
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

// ----- Helpers -----
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function configBanner() {
  const el = document.getElementById('config-banner');
  if (!isConfigured()) {
    el.innerHTML = '<div class="config-banner"><i class="ti ti-alert-triangle"></i> Not connected to Google Sheets.</div>';
  } else { el.innerHTML = ''; }
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

// ----- Theme (light/dark) -----
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function applyTheme(t) {
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('almathar_theme', t); } catch (e) {}
  // Swap toggle icon to indicate the action it will take next
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) icon.className = t === 'light' ? 'ti ti-moon' : 'ti ti-sun';
  // Re-render so any charts pick up the new colors
  if (state.activeTab === 'dashboard') render();
}

function toggleTheme() {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

function setTab(t) {
  ['capture', 'inbox', 'dashboard', 'leaders'].forEach(x => {
    const v = document.getElementById('view-' + x);
    if (v) v.style.display = (x === t) ? 'block' : 'none';
    const b = document.getElementById('tab-' + x);
    if (b) b.classList.toggle('active', x === t);
  });
  state.activeTab = t;
  render();
}

async function refresh() {
  try {
    const data = await apiList();
    state.gaps = data.gaps;
    state.users = data.users;
    state.leaders = data.leaders;
    state.roleFlags = data.roleFlags || [];
    state.people = data.people || [];
    render();
  } catch (err) {
    console.error(err);
    toast('Could not load — check connection', true);
  }
}

function applyUrlContext() {
  const p = urlParams();
  if (p.area && AREA_CODES.includes(p.area)) state.currentArea = p.area;
  if (p.sim) {
    const m = String(p.sim).match(/^([A-Za-z]+)-?(.+)$/);
    if (m && AREA_CODES.includes(m[1].toUpperCase())) {
      state.currentArea = m[1].toUpperCase();
      state.currentSerial = m[2];
    } else { state.currentSerial = String(p.sim); }
  }
  if (p.source === 'sim' || p.source === 'snag') state.captureSource = p.source;
}

// ----- Capture (unchanged from v7 — owner not set at logging time) -----
function renderCapture() {
  const el = document.getElementById('view-capture');
  el.innerHTML = `
    <div class="source-toggle">
      <button class="${state.captureSource === 'snag' ? 'active' : ''}" onclick="setCaptureSource('snag')">
        <i class="ti ti-clipboard-list"></i> Snag list
      </button>
      <button class="${state.captureSource === 'sim' ? 'active' : ''}" onclick="setCaptureSource('sim')">
        <i class="ti ti-flask"></i> Simulation gap
      </button>
    </div>

    <div class="source-hint">
      ${state.captureSource === 'sim'
        ? '<i class="ti ti-info-circle"></i> Use this during a planned <strong>simulation exercise</strong>. Sim ID is required.'
        : '<i class="ti ti-info-circle"></i> Use this for <strong>everyday observations</strong> outside of a simulation. No Sim ID needed.'}
    </div>

    <div class="quick-form">
      ${state.captureSource === 'sim' ? `
        <div class="sim-row">
          <div>
            <label>Area</label>
            <select id="q-area">${AREA_CODES.map(a => `<option value="${a}" ${a === state.currentArea ? 'selected' : ''}>${a}</option>`).join('')}</select>
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
      ` : ''}

      <div class="quick-label">1. Workstream</div>
      <div class="chip-row chip-grid">
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
      <textarea id="q-text" rows="2" placeholder="One sentence. Be specific."></textarea>

      <div class="stopper-row">
        <label class="stopper-toggle">
          <input type="checkbox" id="q-stopper" ${state.quickStopper ? 'checked' : ''} onchange="state.quickStopper=this.checked">
          <span class="stopper-pill"><i class="ti ti-flag-3"></i> Day-1 stopper</span>
        </label>
        <span class="stopper-hint">Tick if this blocks Day 0 launch if not resolved</span>
      </div>

      <div class="photo-row">
        <label>Photo (optional)</label>
        <div id="photo-area">${renderPhotoArea()}</div>
      </div>

      <div class="quick-meta">
        <button class="primary big" onclick="addQuickGap()"><i class="ti ti-plus"></i> Log ${state.captureSource === 'sim' ? 'simulation gap' : 'snag'}</button>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin: 1.25rem 0 8px;">
      <div style="font-size:14px; font-weight:500;">Recent items (${state.gaps.length})</div>
      <button onclick="refresh()" class="ghost-btn"><i class="ti ti-refresh"></i> Reload</button>
    </div>
    <div id="capture-list"></div>
  `;

  if (state.captureSource === 'sim') {
    const areaEl = document.getElementById('q-area');
    if (areaEl) areaEl.addEventListener('change', (e) => {
      state.currentArea = e.target.value;
      const p = document.getElementById('sim-preview');
      if (p) p.textContent = fullSimId();
    });
    const serialEl = document.getElementById('q-serial');
    if (serialEl) serialEl.addEventListener('input', (e) => {
      state.currentSerial = e.target.value;
      const p = document.getElementById('sim-preview');
      if (p) p.textContent = fullSimId();
    });
  }

  renderCaptureList();
}

function setCaptureSource(src) { state.captureSource = src; render(); }

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

  let sim = '';
  if (state.captureSource === 'sim') {
    const serial = document.getElementById('q-serial').value.trim();
    state.currentSerial = serial;
    sim = fullSimId();
    if (!serial) { toast('Sim ID needs a serial number', true); return; }
  }

  state.quickStopper = document.getElementById('q-stopper').checked;

  // Auto-populate owner = workstream leader (v9). If no leader is set, leave blank.
  const wsLead = leaderFor(state.quickDomain);
  const defaultOwner = wsLead ? userLabel(wsLead) : '';

  const gap = {
    id: 'g_' + Date.now(),
    sim, date: state.currentDate,
    domain: state.quickDomain, text,
    priority: state.quickPriority,
    owner: domainOf(state.quickDomain).label,
    assignedTo: defaultOwner, actionPlan: '', status: 'NF', due: '',
    isStopper: state.quickStopper ? 'YES' : '',
    photoUrl: state.pendingPhoto ? state.pendingPhoto.url : '',
    photoId: state.pendingPhoto ? state.pendingPhoto.id : '',
    loggedBy: userLabel(state.currentUser),
    source: state.captureSource
  };

  try {
    const saved = await apiUpsert(gap, []);
    state.gaps.push(saved);
    const what = state.captureSource === 'sim' ? 'Sim gap' : 'Snag';
    let msg = state.quickStopper ? `${what} logged · Day-1 stopper` : `${what} logged`;
    if (defaultOwner) msg += ` · Owner: ${defaultOwner.split('(')[0].trim()}`;
    toast(msg);
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
    list.innerHTML = '<div class="empty">No items yet.</div>';
    return;
  }
  list.innerHTML = sorted.map(g => {
    const d = domainOf(g.domain);
    const p = PRIORITY[g.priority] || PRIORITY.ME;
    return `
      <div class="gap-item compact">
        <div class="gap-row">
          <span class="pill source-${g.source || 'sim'}">${g.source === 'snag' ? 'Snag' : 'Sim'}</span>
          <span class="pill c-${d.ramp}"><i class="ti ${d.icon}"></i>${d.short}</span>
          <span class="pill c-${p.color}">${p.label}</span>
          ${g.isStopper === 'YES' ? '<span class="pill c-red"><i class="ti ti-flag-3"></i> Stopper</span>' : ''}
          ${g.photoUrl ? `<a href="${escapeHtml(g.photoUrl)}" target="_blank" class="pill c-gray" title="View photo"><i class="ti ti-photo"></i></a>` : ''}
          <span class="gap-text">${escapeHtml(g.text)}</span>
          <button onclick="deleteGap('${g.id}')" aria-label="Delete" class="ghost-btn"><i class="ti ti-trash"></i></button>
        </div>
        <div class="gap-byline">
          ${g.sim ? escapeHtml(g.sim) + ' · ' : ''}By ${escapeHtml(g.loggedBy || '—')}
          ${g.assignedTo ? ` · Owner: ${escapeHtml(g.assignedTo)}` : ' · No owner yet'}
          ${g.due ? ` · Due ${g.due}` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function deleteGap(id) {
  if (!confirm('Remove this item? Any attached photo will also be deleted.')) return;
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

// ----- Email composition (mailto:) -----
function buildMailto(gap) {
  const person = personByLabel(gap.assignedTo);
  if (!person || !person.email) return null;

  const d = domainOf(gap.domain);
  const p = PRIORITY[gap.priority] || PRIORITY.ME;
  const leader = leaderFor(gap.domain);
  const leaderPerson = leader ? personByLabel(userLabel(leader)) : null;

  const to = encodeURIComponent(person.email);
  const cc = (leaderPerson && leaderPerson.email && leaderPerson.email !== person.email)
    ? encodeURIComponent(leaderPerson.email) : '';

  // Subject: tag + ref + workstream + brief text
  const ref = gap.sim || (gap.source === 'snag' ? 'SNAG' : 'SIM');
  const shortText = gap.text.slice(0, 60) + (gap.text.length > 60 ? '…' : '');
  const subject = encodeURIComponent(`[Almathar Tracker] ${ref} — ${d.label}: ${shortText}`);

  // Body
  const lines = [
    `Hi ${person.name.split(' ')[0] || person.name},`,
    '',
    `Following up on a ${gap.source === 'snag' ? 'snag list item' : 'simulation gap'} that you are the owner of:`,
    '',
    `Reference: ${gap.sim || '—'} (${gap.source === 'snag' ? 'Snag list' : 'Simulation'})`,
    `Workstream: ${d.label}`,
    `Priority: ${p.label}${gap.isStopper === 'YES' ? ' (DAY-1 STOPPER)' : ''}`,
    `Status: ${STATUS[gap.status] || gap.status}`,
    `Target date: ${gap.due || 'not set'}`,
    '',
    'Description:',
    gap.text,
    '',
    gap.actionPlan ? `Current action plan:\n${gap.actionPlan}` : 'No action plan logged yet.',
    '',
    `Workstream lead: ${leader ? leader.name + (leader.staffId ? ' (' + leader.staffId + ')' : '') : 'not assigned'}`,
    `Logged by: ${gap.loggedBy || '—'}`,
    '',
    `Could you confirm progress and update the tracker?`,
    '',
    `Tracker: ${window.location.origin + window.location.pathname}`,
    '',
    `— ${state.currentUser ? state.currentUser.name : 'Almathar Tracker'}`
  ];

  const body = encodeURIComponent(lines.join('\n'));
  return `mailto:${to}${cc ? '?cc=' + cc : '?'}${cc ? '&' : ''}subject=${subject}&body=${body}`;
}

function emailOwner(id) {
  const g = state.gaps.find(x => x.id === id);
  if (!g) return;
  const link = buildMailto(g);
  if (!link) {
    toast('Owner has no email in the People tab', true);
    return;
  }
  window.location.href = link;
}

// ----- Inbox -----
function applySourceFilter(items) {
  if (state.sourceFilter === 'sim') return items.filter(g => (g.source || 'sim') === 'sim');
  if (state.sourceFilter === 'snag') return items.filter(g => g.source === 'snag');
  return items;
}

// Render an Owner picker for a specific gap.
// Returns HTML for a select element with options filtered to the gap's workstream.
function renderOwnerPicker(gap) {
  const wsPeople = peopleForWorkstream(gap.domain);
  const allPeople = state.people.slice();
  const currentLabel = gap.assignedTo || '';
  const currentPerson = personByLabel(currentLabel);

  // Build option list. If current value is a legacy free-text not matching any person,
  // include it as a disabled option so users can see it before re-picking.
  const opts = ['<option value="">— no owner —</option>'];

  if (wsPeople.length > 0) {
    opts.push(`<optgroup label="${escapeHtml(domainOf(gap.domain).label)}">`);
    wsPeople.forEach(p => {
      const label = userLabel(p);
      opts.push(`<option value="${escapeHtml(label)}" ${label === currentLabel ? 'selected' : ''}>${escapeHtml(p.name)}${p.role ? ' — ' + escapeHtml(p.role) : ''}</option>`);
    });
    opts.push('</optgroup>');
  }

  const others = allPeople.filter(p => p.workstream !== gap.domain);
  if (others.length > 0) {
    opts.push('<optgroup label="Other workstreams">');
    others.forEach(p => {
      const label = userLabel(p);
      opts.push(`<option value="${escapeHtml(label)}" ${label === currentLabel ? 'selected' : ''}>${escapeHtml(p.name)} — ${escapeHtml(domainOf(p.workstream).short || p.workstream)}</option>`);
    });
    opts.push('</optgroup>');
  }

  // Preserve legacy free-text value if it doesn't match any person
  if (currentLabel && !currentPerson) {
    opts.push(`<optgroup label="Legacy">`);
    opts.push(`<option value="${escapeHtml(currentLabel)}" selected>(legacy) ${escapeHtml(currentLabel)}</option>`);
    opts.push('</optgroup>');
  }

  if (wsPeople.length === 0 && others.length === 0) {
    return `
      <select id="as-${gap.id}" disabled>
        <option>No people in People tab yet</option>
      </select>
      <div style="font-size:11px; color:var(--warn); margin-top:4px;">
        <i class="ti ti-alert-triangle"></i> Add people to the People tab in your Google Sheet to enable Owner selection.
      </div>
    `;
  }

  return `<select id="as-${gap.id}">${opts.join('')}</select>`;
}

function renderInbox() {
  const el = document.getElementById('view-inbox');
  const filter = state.inboxFilter;
  const filteredBySource = applySourceFilter(state.gaps);
  const counts = {};
  DOMAINS.forEach(d => counts[d.id] = filteredBySource.filter(g => g.domain === d.id).length);
  const myLabel = userLabel(state.currentUser);
  const mineCount = filteredBySource.filter(g => g.assignedTo && g.assignedTo === myLabel).length;
  const unassigned = filteredBySource.filter(g => !g.assignedTo).length;
  const stoppers = filteredBySource.filter(g => g.isStopper === 'YES' && g.status !== 'FX').length;

  const simCount = state.gaps.filter(g => (g.source || 'sim') === 'sim').length;
  const snagCount = state.gaps.filter(g => g.source === 'snag').length;

  el.innerHTML = `
    <div class="source-filter-row">
      <button class="${state.sourceFilter === 'all' ? 'active' : ''}" onclick="setSourceFilter('all')">All (${state.gaps.length})</button>
      <button class="${state.sourceFilter === 'sim' ? 'active' : ''}" onclick="setSourceFilter('sim')"><i class="ti ti-flask"></i> Simulation (${simCount})</button>
      <button class="${state.sourceFilter === 'snag' ? 'active' : ''}" onclick="setSourceFilter('snag')"><i class="ti ti-clipboard-list"></i> Snag list (${snagCount})</button>
    </div>
    <div class="filter-row">
      <button class="${filter === 'all' ? 'active' : ''}" onclick="setInboxFilter('all')">All (${filteredBySource.length})</button>
      <button class="${filter === 'stoppers' ? 'active' : ''}" onclick="setInboxFilter('stoppers')">
        <i class="ti ti-flag-3"></i> Day-1 stoppers (${stoppers})
      </button>
      <button class="${filter === 'unassigned' ? 'active' : ''}" onclick="setInboxFilter('unassigned')">
        <i class="ti ti-alert-circle"></i> No owner (${unassigned})
      </button>
      <button class="${filter === 'mine' ? 'active' : ''}" onclick="setInboxFilter('mine')">
        <i class="ti ti-user"></i> Mine (${mineCount})
      </button>
      ${DOMAINS.filter(d => counts[d.id] > 0).map(d => `
        <button class="${filter === d.id ? 'active' : ''}" onclick="setInboxFilter('${d.id}')">
          <i class="ti ${d.icon}"></i> ${d.short} (${counts[d.id]})
        </button>
      `).join('')}
    </div>
    <div id="inbox-list"></div>
  `;

  const list = document.getElementById('inbox-list');
  let items = filteredBySource;
  if (filter === 'mine') items = items.filter(g => g.assignedTo && g.assignedTo === myLabel);
  else if (filter === 'unassigned') items = items.filter(g => !g.assignedTo);
  else if (filter === 'stoppers') items = items.filter(g => g.isStopper === 'YES' && g.status !== 'FX');
  else if (filter !== 'all') items = items.filter(g => g.domain === filter);

  if (items.length === 0) {
    list.innerHTML = '<div class="empty">No items in this view.</div>';
    return;
  }
  list.innerHTML = items.map(g => {
    const d = domainOf(g.domain);
    const p = PRIORITY[g.priority] || PRIORITY.ME;
    const leader = leaderFor(g.domain);
    const ownerPerson = personByLabel(g.assignedTo);
    const canEmail = ownerPerson && ownerPerson.email;

    return `
      <div class="gap-item ${g.isStopper === 'YES' ? 'is-stopper' : ''}">
        <div class="gap-meta">
          <span class="pill source-${g.source || 'sim'}">${g.source === 'snag' ? 'Snag' : 'Sim'}</span>
          <span class="pill c-${d.ramp}"><i class="ti ${d.icon}"></i>${d.label}</span>
          <span class="pill c-${p.color}">${p.label}</span>
          ${g.isStopper === 'YES' ? '<span class="pill c-red"><i class="ti ti-flag-3"></i> Day-1 stopper</span>' : ''}
          ${!g.assignedTo ? '<span class="pill c-amber"><i class="ti ti-alert-circle"></i> No owner</span>' : ''}
          <span style="color:var(--text-2); margin-left:auto;">${escapeHtml(g.sim || '—')} · ${g.date}</span>
        </div>
        ${leader ? `<div class="leader-line"><i class="ti ti-id-badge-2"></i> Workstream lead: <strong>${escapeHtml(leader.name)}</strong>${leader.staffId ? ` (${escapeHtml(leader.staffId)})` : ''}</div>` : '<div class="leader-line missing"><i class="ti ti-alert-triangle"></i> No workstream lead set — see Leaders tab</div>'}
        <div style="font-size:14px; margin-bottom:10px;">${escapeHtml(g.text)}</div>
        ${g.photoUrl ? `<div class="inbox-photo"><a href="${escapeHtml(g.photoUrl)}" target="_blank"><img src="${escapeHtml(g.photoUrl)}" alt="Photo" referrerpolicy="no-referrer"></a></div>` : ''}
        <div class="inbox-fields">
          <div>
            <label>Owner</label>
            ${renderOwnerPicker(g)}
          </div>
          <div>
            <label>Target date</label>
            <input id="du-${g.id}" type="date" value="${g.due || ''}">
          </div>
          <div>
            <label>Status</label>
            <select id="st-${g.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === g.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
          </div>
        </div>
        <div class="stopper-row" style="margin: 4px 0 10px;">
          <label class="stopper-toggle">
            <input type="checkbox" id="sp-${g.id}" ${g.isStopper === 'YES' ? 'checked' : ''}>
            <span class="stopper-pill"><i class="ti ti-flag-3"></i> Day-1 stopper</span>
          </label>
        </div>
        <label>Action plan / response</label>
        <textarea id="ap-${g.id}" rows="2" placeholder="What will you do, by when, who is responsible...">${escapeHtml(g.actionPlan || '')}</textarea>
        <div style="display:flex; gap:8px; margin-top:8px; align-items:center; flex-wrap:wrap;">
          <div style="font-size:11px; color:var(--text-2);">
            Logged by <strong>${escapeHtml(g.loggedBy || '—')}</strong>
            ${g.lastEditedBy ? ` · Last edited by <strong>${escapeHtml(g.lastEditedBy)}</strong> on ${escapeHtml(fmtDateTime(g.updatedAt))}` : ''}
          </div>
          <button onclick="emailOwner('${g.id}')" ${!canEmail ? 'disabled' : ''} title="${canEmail ? 'Email the owner' : (g.assignedTo ? 'Owner has no email in the People tab' : 'No owner set yet')}">
            <i class="ti ti-mail"></i> Email owner
          </button>
          <button class="primary" onclick="saveResponse('${g.id}')"><i class="ti ti-check"></i> Save</button>
        </div>
      </div>
    `;
  }).join('');
}

function setInboxFilter(f) { state.inboxFilter = f; render(); }
function setSourceFilter(s) { state.sourceFilter = s; state.inboxFilter = 'all'; render(); }

async function saveResponse(id) {
  if (!state.currentUser) { promptForIdentity(); return; }
  const g = state.gaps.find(x => x.id === id);
  if (!g) return;
  g.actionPlan = document.getElementById('ap-' + id).value;
  g.status = document.getElementById('st-' + id).value;
  g.assignedTo = document.getElementById('as-' + id).value || '';
  g.due = document.getElementById('du-' + id).value;
  g.isStopper = document.getElementById('sp-' + id).checked ? 'YES' : '';
  try {
    const saved = await apiUpsert(g, []);
    Object.assign(g, saved);
    toast('Saved');
    render();
  } catch (err) {
    console.error(err);
    toast('Save failed', true);
  }
}

// ----- Leaders tab — kept identical to v7 -----
function renderLeaders() {
  const el = document.getElementById('view-leaders');
  el.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <h3 style="margin:0 0 8px; font-size:15px;">Workstream Leaders</h3>
      <p style="font-size:13px; color:var(--text-2); margin:0 0 14px;">
        The person <strong>accountable</strong> for each workstream. Shown on every gap and escalated to on the dashboard for overdue items. The <strong>Owner</strong> on each gap is a different concept — the specific person doing the work, picked from the People tab in your Sheet.
      </p>
      <div class="leaders-grid">
        ${DOMAINS.map(d => {
          const l = leaderFor(d.id);
          const wsPeople = peopleForWorkstream(d.id);
          return `
            <div class="leader-card">
              <div class="leader-card-head">
                <span class="pill c-${d.ramp}"><i class="ti ${d.icon}"></i>${d.label}</span>
              </div>
              <div class="leader-card-body">
                ${l ? `
                  <div class="leader-current">
                    <strong>${escapeHtml(l.name)}</strong>
                    ${l.staffId ? `<span class="who-id">${escapeHtml(l.staffId)}</span>` : ''}
                  </div>
                  <button class="ghost-btn" onclick="onClearLeader('${d.id}')"><i class="ti ti-x"></i> Clear</button>
                ` : `<span style="color:var(--text-2); font-size:12px;">— no leader set —</span>`}
              </div>
              <div class="leader-card-foot">
                <select id="ld-${d.id}">
                  <option value="">— pick from People tab —</option>
                  ${wsPeople.map(p => `<option value="${escapeHtml(userLabel(p))}">${escapeHtml(p.name)}${p.role ? ' — ' + escapeHtml(p.role) : ''}</option>`).join('')}
                </select>
                <button class="primary" onclick="onSetLeader('${d.id}')">${l ? 'Replace' : 'Set'}</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function onSetLeader(domain) {
  if (!state.currentUser) { promptForIdentity(); return; }
  const raw = document.getElementById('ld-' + domain).value;
  if (!raw) { toast('Pick a person from the dropdown', true); return; }
  const parsed = parseUserLabel(raw);
  try {
    await apiSetLeader(domain, parsed.name, parsed.staffId || '');
    toast(`Leader set: ${parsed.name}`);
    render();
  } catch (err) {
    console.error(err);
    toast('Save failed', true);
  }
}

async function onClearLeader(domain) {
  if (!confirm('Remove the leader for ' + domainOf(domain).label + '?')) return;
  try {
    await apiClearLeader(domain);
    toast('Leader cleared');
    render();
  } catch (err) {
    console.error(err);
    toast('Clear failed', true);
  }
}

// ----- Dashboard (v9: stopper panel + scorecards + charts) -----

// Keep references to Chart.js instances so we can destroy them on re-render
let _charts = { status: null, byWorkstream: null, stoppers: null };

function destroyCharts() {
  Object.keys(_charts).forEach(k => {
    if (_charts[k]) { try { _charts[k].destroy(); } catch (e) {} _charts[k] = null; }
  });
}

function daysBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function workstreamScorecard(d, filtered) {
  const items = filtered.filter(g => g.domain === d.id);
  if (items.length === 0) return null;
  const open = items.filter(g => g.status === 'NF').length;
  const fixed = items.filter(g => g.status === 'FX').length;
  const deferred = items.filter(g => g.status === 'DF').length;
  const stoppers = items.filter(g => g.isStopper === 'YES' && g.status !== 'FX').length;
  const noOwner = items.filter(g => !g.assignedTo && g.status === 'NF').length;
  const closurePct = items.length ? Math.round(fixed / items.length * 100) : 0;
  // Avg days from createdAt to updatedAt for fixed items
  const fixedItems = items.filter(g => g.status === 'FX' && g.createdAt && g.updatedAt);
  let avgDays = null;
  if (fixedItems.length) {
    const totalDays = fixedItems.reduce((sum, g) => sum + Math.max(0, daysBetween(g.createdAt, g.updatedAt)), 0);
    avgDays = Math.round(totalDays / fixedItems.length);
  }
  return {
    ...d,
    total: items.length, open, fixed, deferred, stoppers, noOwner, closurePct, avgDays,
    leader: leaderFor(d.id)
  };
}

function renderDashboard() {
  destroyCharts();
  const el = document.getElementById('view-dashboard');
  const filtered = applySourceFilter(state.gaps);
  const total = filtered.length;
  const open = filtered.filter(g => g.status === 'NF').length;
  const fixed = filtered.filter(g => g.status === 'FX').length;
  const deferred = filtered.filter(g => g.status === 'DF').length;
  const critical = filtered.filter(g => g.priority === 'CR' && g.status === 'NF').length;
  const unassigned = filtered.filter(g => !g.assignedTo && g.status === 'NF').length;
  const stopperItems = filtered.filter(g => g.isStopper === 'YES' && g.status !== 'FX');
  const stoppers = stopperItems.length;
  const pctClosed = total ? Math.round(fixed / total * 100) : 0;

  const simCount = state.gaps.filter(g => (g.source || 'sim') === 'sim').length;
  const snagCount = state.gaps.filter(g => g.source === 'snag').length;

  // Per-workstream scorecards, sorted: most stoppers first, then most open
  const scorecards = DOMAINS
    .map(d => workstreamScorecard(d, filtered))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.stoppers !== a.stoppers) return b.stoppers - a.stoppers;
      return b.open - a.open;
    });

  // Open items table (same as before but with days-open + days-overdue columns)
  const today = new Date(state.currentDate);
  const openItems = filtered
    .filter(g => g.status === 'NF')
    .map(g => {
      let rag = 'green';
      let overdueDays = 0;
      if (!g.due) rag = 'amber';
      else {
        const days = daysBetween(g.due, state.currentDate); // positive = overdue
        if (days > 0) { rag = 'red'; overdueDays = days; }
        else if (days >= -3) rag = 'amber';
      }
      if (g.isStopper === 'YES') rag = 'red';
      if (g.priority === 'CR') rag = 'red';
      const ageDays = g.createdAt ? Math.max(0, daysBetween(g.createdAt, state.currentDate)) : null;
      return { ...g, rag, overdueDays, ageDays, leader: leaderFor(g.domain) };
    })
    .sort((a, b) => {
      if ((a.isStopper === 'YES') !== (b.isStopper === 'YES')) return a.isStopper === 'YES' ? -1 : 1;
      return ({ red: 0, amber: 1, green: 2 })[a.rag] - ({ red: 0, amber: 1, green: 2 })[b.rag];
    });

  el.innerHTML = `
    <div class="source-filter-row">
      <button class="${state.sourceFilter === 'all' ? 'active' : ''}" onclick="setSourceFilter('all')">All (${state.gaps.length})</button>
      <button class="${state.sourceFilter === 'sim' ? 'active' : ''}" onclick="setSourceFilter('sim')"><i class="ti ti-flask"></i> Simulation (${simCount})</button>
      <button class="${state.sourceFilter === 'snag' ? 'active' : ''}" onclick="setSourceFilter('snag')"><i class="ti ti-clipboard-list"></i> Snag list (${snagCount})</button>
    </div>

    ${stoppers > 0 ? `
      <div class="stopper-section">
        <div class="stopper-section-head">
          <i class="ti ti-flag-3"></i>
          <h3>${stoppers} Day-1 stopper${stoppers === 1 ? '' : 's'} open</h3>
          <span>Day 0 launch at risk if not resolved</span>
        </div>
        <div class="stopper-cards">
          ${stopperItems.slice(0, 12).map(g => {
            const d = domainOf(g.domain);
            const age = g.createdAt ? Math.max(0, daysBetween(g.createdAt, state.currentDate)) : null;
            const lead = leaderFor(g.domain);
            return `
              <div class="stopper-card" onclick="setTab('inbox'); setTimeout(()=>{state.inboxFilter='stoppers'; render();}, 50)">
                <div class="stopper-card-head">
                  <span class="pill c-${d.ramp}"><i class="ti ${d.icon}"></i>${d.short}</span>
                  ${age !== null ? `<span class="stopper-age">${age} day${age === 1 ? '' : 's'} open</span>` : ''}
                </div>
                <div class="stopper-card-text">${escapeHtml(g.text)}</div>
                <div class="stopper-card-foot">
                  <span><i class="ti ti-user"></i> Owner: <strong>${escapeHtml(g.assignedTo ? g.assignedTo.split('(')[0].trim() : 'unassigned')}</strong></span>
                  ${lead ? `<span><i class="ti ti-id-badge-2"></i> Lead: ${escapeHtml(lead.name)}</span>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}

    <div class="grid-stats">
      <div class="stat"><div class="lbl">Total</div><div class="num">${total}</div></div>
      <div class="stat stat-stopper"><div class="lbl">Day-1 stoppers</div><div class="num">${stoppers}</div></div>
      <div class="stat"><div class="lbl">Not fixed</div><div class="num" style="color:var(--warn);">${open}</div></div>
      <div class="stat"><div class="lbl">Critical</div><div class="num" style="color:var(--danger);">${critical}</div></div>
      <div class="stat"><div class="lbl">No owner</div><div class="num" style="color:var(--warn);">${unassigned}</div></div>
      <div class="stat"><div class="lbl">% fixed</div><div class="num" style="color:var(--success);">${pctClosed}%</div></div>
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <h4>Status breakdown</h4>
        ${total === 0 ? '<div class="empty">No data yet.</div>' : '<canvas id="chart-status"></canvas>'}
      </div>
      <div class="chart-card chart-card-wide">
        <h4>Open gaps by workstream</h4>
        ${scorecards.filter(s => s.open > 0).length === 0 ? '<div class="empty">No open gaps.</div>' : '<canvas id="chart-byws"></canvas>'}
      </div>
    </div>

    ${stoppers > 0 ? `
      <div class="chart-card" style="margin-bottom:1rem;">
        <h4>Stoppers by workstream</h4>
        <canvas id="chart-stoppers"></canvas>
      </div>
    ` : ''}

    <div style="font-size:14px; font-weight:500; margin: 1rem 0 8px;">Workstream scorecards</div>
    <div class="scorecard-grid">
      ${scorecards.length === 0 ? '<div class="empty">No data yet.</div>' : scorecards.map(s => `
        <div class="scorecard ${s.stoppers > 0 ? 'has-stoppers' : ''}">
          <div class="scorecard-head">
            <span class="pill c-${s.ramp}"><i class="ti ${s.icon}"></i>${s.label}</span>
            ${s.stoppers > 0 ? `<span class="pill c-red"><i class="ti ti-flag-3"></i> ${s.stoppers}</span>` : ''}
          </div>
          <div class="scorecard-numbers">
            <div><div class="sc-lbl">Total</div><div class="sc-num">${s.total}</div></div>
            <div><div class="sc-lbl">Open</div><div class="sc-num" style="color:var(--warn);">${s.open}</div></div>
            <div><div class="sc-lbl">Fixed</div><div class="sc-num" style="color:var(--success);">${s.fixed}</div></div>
            <div><div class="sc-lbl">% fixed</div><div class="sc-num">${s.closurePct}%</div></div>
          </div>
          <div class="scorecard-meta">
            ${s.leader ? `<span><i class="ti ti-id-badge-2"></i> ${escapeHtml(s.leader.name)}</span>` : '<span class="missing"><i class="ti ti-alert-triangle"></i> no lead</span>'}
            ${s.noOwner > 0 ? `<span class="missing"><i class="ti ti-alert-circle"></i> ${s.noOwner} no owner</span>` : ''}
            ${s.avgDays !== null ? `<span><i class="ti ti-clock"></i> avg ${s.avgDays}d to fix</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>

    <div style="font-size:14px; font-weight:500; margin: 1rem 0 8px;">Open action items (stoppers first, then RAG)</div>
    <div class="card" style="padding:0; overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th style="width:14px;"></th>
            <th>Src</th>
            <th>Flag</th>
            <th>Workstream</th>
            <th>Gap</th>
            <th>Owner</th>
            <th>Lead</th>
            <th>Age</th>
            <th>Due</th>
          </tr>
        </thead>
        <tbody>
          ${openItems.slice(0, 30).map(g => {
            const d = domainOf(g.domain);
            const escalate = g.overdueDays > 0 || g.isStopper === 'YES';
            return `
              <tr class="${g.isStopper === 'YES' ? 'row-stopper' : ''}">
                <td class="rag-${g.rag}"></td>
                <td><span class="pill source-${g.source || 'sim'}" style="font-size:10px;">${g.source === 'snag' ? 'Snag' : 'Sim'}</span></td>
                <td>${g.isStopper === 'YES' ? '<i class="ti ti-flag-3" style="color:var(--danger);" title="Day-1 stopper"></i>' : ''}</td>
                <td><i class="ti ${d.icon}"></i> ${d.short}</td>
                <td>${escapeHtml(g.text)}${g.photoUrl ? ' <i class="ti ti-photo" style="color:var(--text-2);"></i>' : ''}</td>
                <td>${escapeHtml(g.assignedTo ? g.assignedTo.split('(')[0].trim() : '—')}</td>
                <td>${g.leader && escalate ? `<strong style="color:var(--danger);">${escapeHtml(g.leader.name)}</strong>` : (g.leader ? escapeHtml(g.leader.name) : '<span style="color:var(--text-3);">no lead</span>')}</td>
                <td>${g.ageDays !== null ? g.ageDays + 'd' : '—'}</td>
                <td>${g.due ? (g.overdueDays > 0 ? `<span style="color:var(--danger); font-weight:500;">${g.due} (${g.overdueDays}d late)</span>` : g.due) : '—'}</td>
              </tr>
            `;
          }).join('')}
          ${openItems.length === 0 ? '<tr><td colspan="9" class="empty">All clear.</td></tr>' : ''}
        </tbody>
      </table>
    </div>

    <div style="display:flex; gap:8px; margin-top:1rem; flex-wrap:wrap;">
      <button onclick="refresh()"><i class="ti ti-refresh"></i> Reload</button>
      <button onclick="exportCSV()"><i class="ti ti-download"></i> Export CSV</button>
      <button onclick="window.print()"><i class="ti ti-printer"></i> Print</button>
    </div>
  `;

  // Render charts after DOM is in place
  if (typeof Chart === 'undefined') return; // graceful fallback if Chart.js fails to load

  const baseFont = { family: '-apple-system, BlinkMacSystemFont, sans-serif', size: 12 };

  // Pull current theme colors so charts follow light/dark
  const css = getComputedStyle(document.documentElement);
  const colors = {
    open: css.getPropertyValue('--chart-open').trim(),
    openBg: css.getPropertyValue('--chart-open-bg').trim(),
    fixed: css.getPropertyValue('--chart-fixed').trim(),
    fixedBg: css.getPropertyValue('--chart-fixed-bg').trim(),
    deferred: css.getPropertyValue('--chart-deferred').trim(),
    deferredBg: css.getPropertyValue('--chart-deferred-bg').trim(),
    danger: css.getPropertyValue('--chart-danger').trim(),
    dangerBg: css.getPropertyValue('--chart-danger-bg').trim(),
    text: css.getPropertyValue('--text').trim(),
    text2: css.getPropertyValue('--text-2').trim(),
    border: css.getPropertyValue('--border').trim()
  };
  const tickColor = colors.text2;
  const gridColor = colors.border;
  Chart.defaults.color = colors.text2;
  Chart.defaults.borderColor = colors.border;

  // 1. Status doughnut
  if (total > 0) {
    const ctx = document.getElementById('chart-status');
    if (ctx) {
      _charts.status = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Not fixed', 'Fixed', 'Deferred'],
          datasets: [{
            data: [open, fixed, deferred],
            backgroundColor: [colors.openBg, colors.fixedBg, colors.deferredBg],
            borderColor: [colors.open, colors.fixed, colors.deferred],
            borderWidth: 1.5
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { font: baseFont, padding: 12, boxWidth: 12 } },
            tooltip: { callbacks: { label: (c) => `${c.label}: ${c.parsed} (${Math.round(c.parsed/total*100)}%)` } }
          },
          cutout: '60%'
        }
      });
    }
  }

  // 2. Horizontal bar — open gaps by workstream (only ones with open > 0)
  const openByWs = scorecards.filter(s => s.open > 0);
  if (openByWs.length > 0) {
    const ctx = document.getElementById('chart-byws');
    if (ctx) {
      _charts.byWorkstream = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: openByWs.map(s => s.short),
          datasets: [{
            label: 'Open',
            data: openByWs.map(s => s.open),
            backgroundColor: colors.openBg,
            borderColor: colors.open,
            borderWidth: 1
          }, {
            label: 'Fixed',
            data: openByWs.map(s => s.fixed),
            backgroundColor: colors.fixedBg,
            borderColor: colors.fixed,
            borderWidth: 1
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { stacked: true, ticks: { font: baseFont, color: tickColor, stepSize: 1 }, grid: { color: gridColor } },
            y: { stacked: true, ticks: { font: baseFont, color: tickColor }, grid: { display: false } }
          },
          plugins: {
            legend: { position: 'bottom', labels: { font: baseFont, padding: 12, boxWidth: 12 } }
          }
        }
      });
    }
  }

  // 3. Vertical bar — stoppers by workstream (only renders when stoppers exist)
  if (stoppers > 0) {
    const stoppersByWs = scorecards.filter(s => s.stoppers > 0);
    const ctx = document.getElementById('chart-stoppers');
    if (ctx && stoppersByWs.length > 0) {
      _charts.stoppers = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: stoppersByWs.map(s => s.short),
          datasets: [{
            label: 'Day-1 stoppers',
            data: stoppersByWs.map(s => s.stoppers),
            backgroundColor: colors.dangerBg,
            borderColor: colors.danger,
            borderWidth: 1.5
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            y: { ticks: { font: baseFont, color: tickColor, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true },
            x: { ticks: { font: baseFont, color: tickColor }, grid: { display: false } }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }
  }
}


function exportCSV() {
  const cols = ['id', 'source', 'sim', 'date', 'domain', 'text', 'priority', 'isStopper', 'owner', 'assignedTo', 'actionPlan', 'status', 'due', 'photoUrl', 'loggedBy', 'lastEditedBy', 'createdAt', 'updatedAt'];
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
  if (state.activeTab === 'leaders') renderLeaders();
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
  // Sync the theme toggle icon with the theme that the inline head script applied
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) icon.className = currentTheme() === 'light' ? 'ti ti-moon' : 'ti ti-sun';

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
