// Almathar Simulation Readiness Tracker — frontend v3
// Adds: name + staff ID identity, password gate, combobox assigned-to with new-entry support

const DOMAINS = [
  { id: 'billing',    label: 'Billing & Registration',     icon: 'ti-receipt',       ramp: 'blue'   },
  { id: 'nursing',    label: 'Clinical & Nursing',         icon: 'ti-stethoscope',   ramp: 'teal'   },
  { id: 'physicians', label: 'Medical Team (Physicians)',  icon: 'ti-user-heart',    ramp: 'purple' },
  { id: 'it',         label: 'IT & Systems',               icon: 'ti-device-desktop',ramp: 'coral'  },
  { id: 'lab',        label: 'Laboratory',                 icon: 'ti-test-pipe',     ramp: 'pink'   },
  { id: 'radiology',  label: 'Radiology',                  icon: 'ti-radioactive',   ramp: 'amber'  },
  { id: 'infra',      label: 'Infrastructure',             icon: 'ti-building',      ramp: 'gray'   },
  { id: 'safety',     label: 'Patient Safety & Quality',   icon: 'ti-shield-check',  ramp: 'green'  }
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
  users: [],            // [{name, staffId}]
  currentUser: null,    // {name, staffId}
  currentSim: 'OPD-002',
  currentDate: new Date().toISOString().slice(0, 10),
  inboxFilter: 'all',
  activeTab: 'capture',
  pendingNewUsers: []   // people typed into assigned-to that should be saved on next upsert
};

function userLabel(u) {
  if (!u) return '';
  if (u.staffId) return `${u.name} (${u.staffId})`;
  return u.name;
}

function parseUserLabel(s) {
  // Accept "Name (12345)" or "Name"
  const m = String(s || '').match(/^(.+?)\s*\((\d+)\)\s*$/);
  if (m) return { name: m[1].trim(), staffId: m[2].trim() };
  return { name: String(s || '').trim(), staffId: '' };
}

// ----------------------------------------------------------------
// Access gate (shared password)
// ----------------------------------------------------------------

function checkAccessGate() {
  const required = window.APP_PASSWORD || '';
  if (!required) return true; // No password set in config
  try {
    const stored = sessionStorage.getItem('almathar_access');
    if (stored === required) return true;
  } catch (e) {}
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
    const err = document.getElementById('access-error');
    err.style.display = 'block';
    input.value = '';
    input.focus();
  }
}

// ----------------------------------------------------------------
// Identity (name + staffId)
// ----------------------------------------------------------------

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
  const wrap = document.getElementById('identity-overlay');
  wrap.style.display = 'flex';
  document.getElementById('identity-name').value = '';
  document.getElementById('identity-staffid').value = '';
  document.getElementById('identity-error').style.display = 'none';
  setTimeout(() => document.getElementById('identity-name').focus(), 50);
}

async function submitIdentity() {
  const name = document.getElementById('identity-name').value.trim();
  const staffId = document.getElementById('identity-staffid').value.trim();
  const err = document.getElementById('identity-error');
  if (name.length < 2) {
    err.textContent = 'Please enter your full name.';
    err.style.display = 'block';
    return;
  }
  if (!/^\d{3,8}$/.test(staffId)) {
    err.textContent = 'Staff ID must be 3 to 8 digits.';
    err.style.display = 'block';
    return;
  }
  saveIdentity(name, staffId);
  document.getElementById('identity-overlay').style.display = 'none';
  renderIdentityBadge();
  // Register on server right away
  try {
    await fetch(window.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'registerUser', userObj: state.currentUser, user: userLabel(state.currentUser) })
    });
  } catch (e) {}
  refresh();
}

function renderIdentityBadge() {
  const el = document.getElementById('identity-badge');
  if (!state.currentUser) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <span style="font-size:12px; color:var(--text-2);">Signed in as</span>
    <strong style="font-size:13px;">${escapeHtml(state.currentUser.name)}</strong>
    <span style="font-size:11px; color:var(--text-2);">(${escapeHtml(state.currentUser.staffId)})</span>
    <button onclick="changeIdentity()" style="font-size:11px; padding:3px 8px;" title="Change identity">
      <i class="ti ti-user-edit"></i>
    </button>
  `;
}

function changeIdentity() {
  if (!confirm('Change the identity attributed to your actions?')) return;
  clearIdentity();
  promptForIdentity();
}

// ----------------------------------------------------------------
// API layer
// ----------------------------------------------------------------

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
      action: 'upsert',
      gap,
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
      action: 'delete',
      id,
      user: userLabel(state.currentUser) || 'web',
      userObj: state.currentUser
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'delete failed');
}

// ----------------------------------------------------------------
// UI helpers
// ----------------------------------------------------------------

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
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
    el.innerHTML = '<div class="config-banner"><i class="ti ti-alert-triangle"></i> Not connected to Google Sheets. Open <code>config.js</code> and paste your Apps Script <code>/exec</code> URL.</div>';
  } else {
    el.innerHTML = '';
  }
}

function domainOf(id) {
  return DOMAINS.find(d => d.id === id) || DOMAINS[0];
}

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
    toast('Could not load from Sheets — check the URL');
  }
}

// Build datalist options for the assigned-to combobox
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

// Look up user object from a free-text combobox value; create-pending if new
function resolveAssignee(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return { user: null, isNew: false };
  const parsed = parseUserLabel(raw);
  // Match existing user by staffId first, then by name
  let match = state.users.find(u => parsed.staffId && u.staffId === parsed.staffId);
  if (!match) match = state.users.find(u => u.name.toLowerCase() === parsed.name.toLowerCase());
  if (match) return { user: match, isNew: false };
  // New user — must have an ID
  if (!/^\d{3,8}$/.test(parsed.staffId)) {
    return { user: null, isNew: true, error: `New person "${parsed.name}" needs a staff ID in parentheses, e.g. "${parsed.name} (12345)"` };
  }
  return { user: parsed, isNew: true };
}

// ----------------------------------------------------------------
// Capture view
// ----------------------------------------------------------------

function renderCapture() {
  const el = document.getElementById('view-capture');
  el.innerHTML = `
    <div class="card" style="background:var(--bg-2); border:none; margin-bottom:1rem;">
      <div class="grid-3" style="margin-bottom:10px;">
        <div><label>Simulation ID</label><input id="f-sim" value="${escapeHtml(state.currentSim)}"></div>
        <div><label>Date</label><input id="f-date" type="date" value="${state.currentDate}"></div>
        <div><label>Workstream (domain)</label><select id="f-domain">${
          DOMAINS.map(d => `<option value="${d.id}">${d.label}</option>`).join('')
        }</select></div>
      </div>
      <label>Gap / observation (narrative)</label>
      <textarea id="f-text" rows="2" placeholder="Describe the gap, near-miss, or observation..."></textarea>
      <div style="display:grid; grid-template-columns:1fr 1.5fr 1fr auto; gap:10px; margin-top:10px; align-items:end;">
        <div><label>Priority</label><select id="f-priority">${
          Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')
        }</select></div>
        <div>
          <label>Assigned to (person)</label>
          <input id="f-assigned" list="users-list-capture" placeholder="Type name, e.g. Dr. Khan (12345)" autocomplete="off">
          ${userDatalistHTML('users-list-capture')}
        </div>
        <div><label>Target date</label><input id="f-due" type="date"></div>
        <button class="primary" onclick="addGap()"><i class="ti ti-plus"></i> Log gap</button>
      </div>
      <div style="font-size:11px; color:var(--text-2); margin-top:8px;">
        <i class="ti ti-info-circle"></i> Logger: <strong>${escapeHtml(userLabel(state.currentUser) || '(not set)')}</strong>
        · For a new person, type their name then their staff ID in parentheses: <code>Name (12345)</code>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
      <div style="font-size:14px; font-weight:500;">Captured gaps (${state.gaps.length})</div>
      <button onclick="refresh()" style="font-size:12px;"><i class="ti ti-refresh"></i> Reload</button>
    </div>
    <div id="capture-list"></div>
  `;

  const list = document.getElementById('capture-list');
  const sorted = [...state.gaps].sort((a, b) => (b.id > a.id ? 1 : -1));
  if (sorted.length === 0) {
    list.innerHTML = '<div class="empty">No gaps yet. Use the form above to log the first one.</div>';
    return;
  }
  list.innerHTML = sorted.map(g => {
    const d = domainOf(g.domain);
    const p = PRIORITY[g.priority] || PRIORITY.ME;
    return `
      <div class="gap-item" style="padding:10px 12px;">
        <div style="display:flex; gap:10px; align-items:center;">
          <span class="pill c-${d.ramp}"><i class="ti ${d.icon}"></i>${d.label}</span>
          <span class="pill c-${p.color}">${p.label}</span>
          <span style="flex:1; font-size:13px;">${escapeHtml(g.text)}</span>
          <span style="font-size:12px; color:var(--text-2);">${escapeHtml(g.sim)}</span>
          <button onclick="deleteGap('${g.id}')" aria-label="Delete"><i class="ti ti-trash"></i></button>
        </div>
        <div style="font-size:11px; color:var(--text-2); margin-top:6px;">
          Logged by <strong>${escapeHtml(g.loggedBy || '—')}</strong>
          ${g.assignedTo ? ` · Assigned to <strong>${escapeHtml(g.assignedTo)}</strong>` : ''}
          ${g.lastEditedBy && g.lastEditedBy !== g.loggedBy ? ` · Last edited by <strong>${escapeHtml(g.lastEditedBy)}</strong> at ${escapeHtml(fmtDateTime(g.updatedAt))}` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function addGap() {
  if (!state.currentUser) { promptForIdentity(); return; }
  const text = document.getElementById('f-text').value.trim();
  if (!text) { alert('Please describe the gap.'); return; }

  const assignedRaw = document.getElementById('f-assigned').value;
  const resolution = resolveAssignee(assignedRaw);
  if (assignedRaw && resolution.error) {
    alert(resolution.error);
    return;
  }
  const newUsers = (resolution.isNew && resolution.user) ? [resolution.user] : [];

  const gap = {
    id: 'g_' + Date.now(),
    sim: document.getElementById('f-sim').value,
    date: document.getElementById('f-date').value,
    domain: document.getElementById('f-domain').value,
    text,
    priority: document.getElementById('f-priority').value,
    owner: domainOf(document.getElementById('f-domain').value).label,
    assignedTo: resolution.user ? userLabel(resolution.user) : '',
    actionPlan: '',
    status: 'P',
    due: document.getElementById('f-due').value || '',
    loggedBy: userLabel(state.currentUser)
  };

  try {
    const saved = await apiUpsert(gap, newUsers);
    state.gaps.push(saved);
    toast(newUsers.length ? `Gap logged · ${newUsers[0].name} added to people list` : 'Gap logged');
    document.getElementById('f-text').value = '';
    document.getElementById('f-assigned').value = '';
    render();
  } catch (err) {
    console.error(err);
    toast('Save failed — check connection');
  }
}

async function deleteGap(id) {
  if (!confirm('Remove this gap?')) return;
  try {
    await apiDelete(id);
    state.gaps = state.gaps.filter(g => g.id !== id);
    toast('Deleted');
    render();
  } catch (err) {
    console.error(err);
    toast('Delete failed');
  }
}

// ----------------------------------------------------------------
// Team Inbox view
// ----------------------------------------------------------------

function renderInbox() {
  const el = document.getElementById('view-inbox');
  const filter = state.inboxFilter;
  const counts = {};
  DOMAINS.forEach(d => counts[d.id] = state.gaps.filter(g => g.domain === d.id).length);
  const myLabel = userLabel(state.currentUser);
  const minCount = state.gaps.filter(g => g.assignedTo && g.assignedTo === myLabel).length;

  el.innerHTML = `
    <div class="filter-row">
      <button class="${filter === 'all' ? 'active' : ''}" onclick="setInboxFilter('all')">All (${state.gaps.length})</button>
      <button class="${filter === 'mine' ? 'active' : ''}" onclick="setInboxFilter('mine')">
        <i class="ti ti-user"></i> Assigned to me (${minCount})
      </button>
      ${DOMAINS.map(d => `
        <button class="${filter === d.id ? 'active' : ''}" onclick="setInboxFilter('${d.id}')">
          <i class="ti ${d.icon}"></i> ${d.label} (${counts[d.id]})
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
  else items = state.gaps.filter(g => g.domain === filter);

  if (items.length === 0) {
    list.innerHTML = '<div class="empty">No gaps in this view.</div>';
    return;
  }
  list.innerHTML = items.map(g => {
    const d = domainOf(g.domain);
    const p = PRIORITY[g.priority] || PRIORITY.ME;
    return `
      <div class="gap-item">
        <div class="gap-meta">
          <span class="pill c-${d.ramp}"><i class="ti ${d.icon}"></i>${d.label}</span>
          <span class="pill c-${p.color}">${p.label}</span>
          <span style="color:var(--text-2); margin-left:auto;">${escapeHtml(g.sim)} · ${g.date}</span>
        </div>
        <div style="font-size:14px; margin-bottom:10px;">${escapeHtml(g.text)}</div>

        <div style="display:grid; grid-template-columns:1.5fr 1fr 1fr; gap:10px; margin-bottom:10px;">
          <div>
            <label>Assigned to</label>
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

        <label>Action plan / response</label>
        <textarea id="ap-${g.id}" rows="2" placeholder="What will you do, by when, who is responsible...">${escapeHtml(g.actionPlan || '')}</textarea>

        <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
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
  if (assignedRaw && resolution.error) {
    alert(resolution.error);
    return;
  }
  const newUsers = (resolution.isNew && resolution.user) ? [resolution.user] : [];

  g.actionPlan = document.getElementById('ap-' + id).value;
  g.status = document.getElementById('st-' + id).value;
  g.assignedTo = resolution.user ? userLabel(resolution.user) : '';
  g.due = document.getElementById('du-' + id).value;

  try {
    const saved = await apiUpsert(g, newUsers);
    Object.assign(g, saved);
    toast(newUsers.length ? `Saved · ${newUsers[0].name} added` : 'Saved');
    render();
  } catch (err) {
    console.error(err);
    toast('Save failed');
  }
}

// ----------------------------------------------------------------
// Dashboard view
// ----------------------------------------------------------------

function renderDashboard() {
  const el = document.getElementById('view-dashboard');
  const total = state.gaps.length;
  const open = state.gaps.filter(g => g.status === 'P' || g.status === 'IP').length;
  const completed = state.gaps.filter(g => g.status === 'C' || g.status === 'V').length;
  const critical = state.gaps.filter(g => g.priority === 'CR').length;
  const pctClosed = total ? Math.round(completed / total * 100) : 0;

  const byDomain = DOMAINS.map(d => {
    const items = state.gaps.filter(g => g.domain === d.id);
    return {
      ...d,
      total: items.length,
      open: items.filter(g => g.status === 'P' || g.status === 'IP').length,
      crit: items.filter(g => g.priority === 'CR').length,
      done: items.filter(g => g.status === 'C' || g.status === 'V').length
    };
  }).filter(d => d.total > 0);

  const today = new Date(state.currentDate);
  const openItems = state.gaps
    .filter(g => g.status === 'P' || g.status === 'IP')
    .map(g => {
      let rag = 'green';
      if (g.due) {
        const due = new Date(g.due);
        const days = Math.round((due - today) / (1000 * 60 * 60 * 24));
        if (days < 0) rag = 'red';
        else if (days <= 3) rag = 'amber';
      }
      if (g.priority === 'CR' && g.status === 'P') rag = 'red';
      return { ...g, rag };
    })
    .sort((a, b) => ({ red: 0, amber: 1, green: 2 })[a.rag] - ({ red: 0, amber: 1, green: 2 })[b.rag]);

  el.innerHTML = `
    <div class="grid-4" style="margin-bottom:1rem;">
      <div class="stat"><div class="lbl">Total gaps</div><div class="num">${total}</div></div>
      <div class="stat"><div class="lbl">Open</div><div class="num" style="color:var(--warn);">${open}</div></div>
      <div class="stat"><div class="lbl">Critical</div><div class="num" style="color:var(--danger);">${critical}</div></div>
      <div class="stat"><div class="lbl">% closed</div><div class="num" style="color:var(--success);">${pctClosed}%</div></div>
    </div>

    <div style="font-size:14px; font-weight:500; margin-bottom:8px;">Gaps by workstream</div>
    <div class="card" style="margin-bottom:1rem;">
      ${byDomain.length === 0 ? '<div class="empty">No data yet.</div>' : byDomain.map(d => {
        const openPct = d.total ? (d.open / d.total * 100) : 0;
        const donePct = d.total ? (d.done / d.total * 100) : 0;
        return `
          <div style="display:grid; grid-template-columns:200px 1fr 80px; gap:10px; align-items:center; padding:6px 0;">
            <div style="display:flex; align-items:center; gap:6px; font-size:13px;"><i class="ti ${d.icon}"></i>${d.label}</div>
            <div class="bar">
              <div class="bar-done" style="width:${donePct}%;" title="Done: ${d.done}"></div>
              <div class="bar-open" style="width:${openPct}%;" title="Open: ${d.open}"></div>
            </div>
            <div style="font-size:12px; color:var(--text-2); text-align:right;">
              ${d.done}/${d.total}${d.crit ? ` · <span style="color:var(--danger);">${d.crit} CR</span>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div style="font-size:14px; font-weight:500; margin-bottom:8px;">Open action items (RAG-sorted)</div>
    <div class="card" style="padding:0; overflow:hidden;">
      <table>
        <thead>
          <tr>
            <th style="width:14px;"></th>
            <th>Workstream</th>
            <th>Gap</th>
            <th>Assigned to</th>
            <th>Due</th>
            <th>Status</th>
            <th>Last edited</th>
          </tr>
        </thead>
        <tbody>
          ${openItems.slice(0, 20).map(g => {
            const d = domainOf(g.domain);
            return `
              <tr>
                <td class="rag-${g.rag}"></td>
                <td><i class="ti ${d.icon}"></i> ${d.label.split(' ')[0]}</td>
                <td>${escapeHtml(g.text)}</td>
                <td>${escapeHtml(g.assignedTo || '—')}</td>
                <td>${g.due || '—'}</td>
                <td>${STATUS[g.status]}</td>
                <td style="font-size:11px;">${escapeHtml(g.lastEditedBy || '—')}</td>
              </tr>
            `;
          }).join('')}
          ${openItems.length === 0 ? '<tr><td colspan="7" class="empty">No open items — all clear.</td></tr>' : ''}
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
  const cols = ['id', 'sim', 'date', 'domain', 'text', 'priority', 'owner', 'assignedTo', 'actionPlan', 'status', 'due', 'loggedBy', 'lastEditedBy', 'createdAt', 'updatedAt'];
  const rows = [cols.join(',')].concat(
    state.gaps.map(g => cols.map(c => `"${String(g[c] || '').replace(/"/g, '""')}"`).join(','))
  );
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'almathar-gaps.csv';
  a.click();
}

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------

function render() {
  if (state.activeTab === 'capture') renderCapture();
  if (state.activeTab === 'inbox') renderInbox();
  if (state.activeTab === 'dashboard') renderDashboard();
}

function bootAfterAccess() {
  configBanner();
  loadIdentity();
  renderIdentityBadge();
  setTab('capture');
  if (!state.currentUser) {
    promptForIdentity();
  } else {
    refresh();
  }
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
  // Wire identity submit on Enter
  document.getElementById('identity-staffid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitIdentity();
  });
}

init();
