}, 50);
}

// v14: Mini-Gantt strip inside a scorecard — shows just THIS workstream's open stoppers
// as dots on a single horizontal timeline from today to Day 0.
function renderMiniGantt(domainId, filtered) {
  const day0 = getDay0();
  const today = state.currentDate;
  const todayMs = new Date(today).getTime();
  const day0Ms = new Date(day0).getTime();
  const stoppers = filtered.filter(g =>
    g.domain === domainId && g.isStopper === 'YES' && g.status !== 'FX' && g.status !== 'DEL'
  );
  if (stoppers.length === 0) return '';

  const withDate = stoppers.filter(g => g.due);
  const noDateCount = stoppers.length - withDate.length;

  // Timeline span: today to day0, extended if any due dates fall outside that range
  let minMs = todayMs;
  let maxMs = day0Ms;
  withDate.forEach(g => {
    const ms = new Date(g.due).getTime();
    if (ms < minMs) minMs = ms;
    if (ms > maxMs) maxMs = ms;
  });
  const spanMs = Math.max(maxMs - minMs, 86400000);
  const todayPct = ((todayMs - minMs) / spanMs) * 100;
  const day0Pct = ((day0Ms - minMs) / spanMs) * 100;

  return `
    <div class="mini-gantt" title="Stopper target dates · today (blue) → Day 0 (red)">
      <div class="mini-gantt-track">
        <div class="mini-gantt-today" style="left: ${todayPct}%;"></div>
        <div class="mini-gantt-day0" style="left: ${day0Pct}%;"></div>
        ${withDate.map(g => {
          const ms = new Date(g.due).getTime();
          const pct = ((ms - minMs) / spanMs) * 100;
          let cls = 'mg-ok';
          if (ms < todayMs) cls = 'mg-overdue';
          else if (ms > day0Ms) cls = 'mg-late';
          return `<div class="mini-gantt-dot ${cls}" style="left: ${pct}%;" title="${escapeHtml(g.text.slice(0, 60))} · due ${g.due}"></div>`;
        }).join('')}
      </div>
      <div class="mini-gantt-foot">
        <span>${withDate.length}/${stoppers.length} stopper${stoppers.length === 1 ? '' : 's'} with target date${noDateCount > 0 ? ` · <span class="mg-warn">${noDateCount} missing</span>` : ''}</span>
      </div>
    </div>
  `;
}

function renderDashboard() {
destroyCharts();
const el = document.getElementById('view-dashboard');
@@ -1629,9 +1677,23 @@ function renderDashboard() {
     </div>
   ` : ''}

    ${stoppers > 0 ? renderStopperGantt(filtered) : ''}

    <div style="font-size:14px; font-weight:500; margin: 1.5rem 0 8px;">Workstream scorecards</div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin: 1.5rem 0 8px; flex-wrap:wrap; gap:10px;">
      <div style="font-size:14px; font-weight:500;">Workstream scorecards</div>
      <div style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-2);">
        <span><i class="ti ti-target"></i> Day 0:</span>
        <input type="date" value="${getDay0()}" onchange="setDay0(this.value)" style="font-size:12px; padding:4px 8px; width:auto;">
      </div>
    </div>
    ${(function(){
      const noDate = filtered.filter(g => g.isStopper === 'YES' && g.status !== 'FX' && g.status !== 'DEL' && !g.due).length;
      return noDate > 0 ? `
        <div class="gantt-warning" onclick="jumpToStoppersMissingDates()" style="margin-bottom:10px;">
          <i class="ti ti-alert-circle"></i>
          <span><strong>${noDate}</strong> Day-1 stopper${noDate === 1 ? '' : 's'} without target date${noDate === 1 ? '' : 's'} — click to set them so they appear on the timeline strips below.</span>
          <i class="ti ti-chevron-right" style="margin-left:auto;"></i>
        </div>
      ` : '';
    })()}
   <div class="scorecard-grid">
     ${scorecards.length === 0 ? '<div class="empty">No data yet.</div>' : scorecards.map(s => {
       // v14: embedded readiness bar inside scorecard
@@ -1666,6 +1728,7 @@ function renderDashboard() {
             : ''
           ).join('')}
         </div>
          ${stopperOpen > 0 ? renderMiniGantt(s.id, filtered) : ''}
         <div class="scorecard-meta">
           ${s.leader ? `<span><i class="ti ti-id-badge-2"></i> ${escapeHtml(s.leader.name)}</span>` : '<span class="missing"><i class="ti ti-alert-triangle"></i> no lead</span>'}
           ${s.noOwner > 0 ? `<span class="missing"><i class="ti ti-alert-circle"></i> ${s.noOwner} no owner</span>` : ''}
