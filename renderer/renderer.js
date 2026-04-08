const { ipcRenderer } = require('electron');

// ── State ───────────────────────────────────────────────────
let appState = {
  isRunning: false,
  totalSeconds: 0,
  currentSessionSeconds: 0,
  sessions: [],
  todayDate: ''
};

// View state — which date is currently shown in the panel
let viewDate = ''; // YYYY-MM-DD, empty = today
let todayData = null; // always today's live data for the bar chart

// ── DOM refs ────────────────────────────────────────────────
const timerDisplay  = document.getElementById('timer-display');
const controlBtn    = document.getElementById('control-btn');
const btnText       = document.getElementById('btn-text');
const pomodoroNum   = document.getElementById('pomodoro-num');
const statHours     = document.getElementById('stat-hours');
const statPomodoros = document.getElementById('stat-pomodoros');
const statSessions  = document.getElementById('stat-sessions');
const progressRing  = document.getElementById('progress-ring');
const dateDisplay   = document.getElementById('date-display');
const historyDate   = document.getElementById('history-date');
const prevDayBtn    = document.getElementById('prev-day');
const nextDayBtn    = document.getElementById('next-day');
const timerRingContainer = document.querySelector('.timer-ring-container');

const RING_CIRCUMFERENCE = 2 * Math.PI * 82; // 515.22
const POMODORO_SECONDS   = 25 * 60;

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const today = getTodayStr();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split('T')[0];
  if (dateStr === today) return '今天';
  if (dateStr === yStr) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

// ── Init ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  renderDate();
  ipcRenderer.send('get-state');
  ipcRenderer.send('get-history');
  ipcRenderer.send('get-day', getTodayStr());
  startClockHands();
  generateTickMarks();
});

// ── IPC ─────────────────────────────────────────────────────
ipcRenderer.on('state-update', (_, state) => {
  appState = state;
  todayData = {
    totalSeconds: state.totalSeconds,
    sessions: state.sessions
  };
  // Always update live view if viewing today
  if (!viewDate || viewDate === getTodayStr()) {
    renderDay({
      date: getTodayStr(),
      totalSeconds: state.totalSeconds,
      currentSessionSeconds: state.currentSessionSeconds,
      sessions: state.sessions
    });
    if (todayData) {
      const hist = {};
      hist[getTodayStr()] = todayData;
      renderHistoryBars(hist);
    }
  }
});

ipcRenderer.on('history-data', (_, history) => {
  renderHistoryBars(history);
});

ipcRenderer.on('day-data', (_, data) => {
  renderDay(data);
});

function renderDay(data) {
  viewDate = data.date || viewDate;
  nextDayBtn.disabled = viewDate === getTodayStr();

  historyDate.textContent = getDisplayDate(viewDate);

  // Stats for this day
  const totalSecs = data.totalSeconds || 0;
  const pomodoros = Math.floor(totalSecs / POMODORO_SECONDS);
  const totalMin = Math.floor(totalSecs / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  statHours.textContent     = h > 0 ? `${h}h ${m}m` : `${m}m`;
  statPomodoros.textContent = pomodoros;
  statSessions.textContent  = (data.sessions || []).length;

  timerDisplay.textContent = formatTime(totalSecs);
  pomodoroNum.textContent = pomodoros;

  const sessionSecs = totalSecs % POMODORO_SECONDS;
  const progress = sessionSecs / POMODORO_SECONDS;
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  progressRing.style.strokeDashoffset = offset;

  drawTimeline(data.sessions || [], viewDate);

  // Button — only active when viewing today
  const isToday = viewDate === getTodayStr();
  if (isToday) {
    if (appState.isRunning) {
      controlBtn.dataset.state = 'running';
      btnText.textContent = '暂停休息';
      timerDisplay.classList.add('running');
      timerRingContainer.classList.add('running');
    } else if (appState.waitingForDecision) {
      controlBtn.dataset.state = 'waiting';
      btnText.textContent = '等待选择';
      timerDisplay.classList.remove('running');
      timerRingContainer.classList.remove('running');
    } else {
      controlBtn.dataset.state = 'idle';
      btnText.textContent = '开始专注';
      timerDisplay.classList.remove('running');
      timerRingContainer.classList.remove('running');
    }
    controlBtn.disabled = false;
  } else {
    controlBtn.dataset.state = 'idle';
    btnText.textContent = '查看历史';
    timerDisplay.classList.remove('running');
    timerRingContainer.classList.remove('running');
    controlBtn.disabled = true;
  }
}

// ── Control ─────────────────────────────────────────────────
controlBtn.addEventListener('click', () => {
  if (viewDate && viewDate !== getTodayStr()) return; // disabled for past dates
  if (appState.isRunning || appState.waitingForDecision) {
    ipcRenderer.send('stop-timer');
  } else {
    ipcRenderer.send('start-timer');
  }
});

// ── Format time ─────────────────────────────────────────────
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

// ── Date display ────────────────────────────────────────────
function renderDate() {
  const now = new Date();
  const opts = { month: 'long', day: 'numeric', weekday: 'long' };
  dateDisplay.textContent = now.toLocaleDateString('zh-CN', opts);
}

// ── Animated clock hands in header ──────────────────────────
function startClockHands() {
  const hourHand   = document.getElementById('hour-hand');
  const minuteHand = document.getElementById('minute-hand');

  function updateHands() {
    const now  = new Date();
    const hrs  = now.getHours() % 12;
    const mins = now.getMinutes();
    const secs = now.getSeconds();

    const minAngle  = (mins / 60) * 360 + (secs / 60) * 6;
    const hourAngle = (hrs / 12) * 360 + (mins / 60) * 30;

    // Hour hand: cx=12,cy=12, points to y=6.5 (up)
    const hourRad  = ((hourAngle - 90) * Math.PI) / 180;
    const minRad   = ((minAngle  - 90) * Math.PI) / 180;

    const hLen = 4;
    const mLen = 5;
    hourHand.setAttribute('x2', 12 + hLen * Math.cos(hourRad));
    hourHand.setAttribute('y2', 12 + hLen * Math.sin(hourRad));
    minuteHand.setAttribute('x2', 12 + mLen * Math.cos(minRad));
    minuteHand.setAttribute('y2', 12 + mLen * Math.sin(minRad));
  }

  updateHands();
  setInterval(updateHands, 1000);
}

// ── Generate tick marks on ring ──────────────────────────────
function generateTickMarks() {
  const g    = document.getElementById('tick-marks');
  const cx   = 100, cy = 100, r = 82;
  const count = 60;

  for (let i = 0; i < count; i++) {
    const angle   = (i / count) * 2 * Math.PI - Math.PI / 2;
    const isMajor = i % 5 === 0;
    const inner   = isMajor ? r - 7 : r - 4;
    const outer   = r + 1;

    const x1 = cx + inner * Math.cos(angle);
    const y1 = cy + inner * Math.sin(angle);
    const x2 = cx + outer * Math.cos(angle);
    const y2 = cy + outer * Math.sin(angle);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', isMajor ? '#C8C0AE' : '#DDD6C8');
    line.setAttribute('stroke-width', isMajor ? '1.5' : '0.8');
    line.setAttribute('stroke-linecap', 'round');
    g.appendChild(line);
  }
}

// ── Timeline Canvas ──────────────────────────────────────────
function drawTimeline(sessions, timelineDate) {
  const canvas = document.getElementById('timeline-canvas');
  const dpr    = window.devicePixelRatio || 1;
  const W      = canvas.offsetWidth || 424;
  const H      = 80;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = '#EDE7D6';
  roundRect(ctx, 0, 0, W, H, 8);
  ctx.fill();

  const tlDate = timelineDate || getTodayStr();
  const dayStart = new Date(tlDate + 'T00:00:00');
  const dayMs    = 24 * 60 * 60 * 1000;

  // Draw sessions as filled areas
  sessions.forEach(session => {
    const startRatio = (session.start - dayStart.getTime()) / dayMs;
    const endRatio   = (session.end   - dayStart.getTime()) / dayMs;
    const x1 = Math.max(0, startRatio) * W;
    const x2 = Math.min(1, endRatio)   * W;
    const barW = Math.max(x2 - x1, 2);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(196,98,78,0.5)');
    grad.addColorStop(1, 'rgba(196,98,78,0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(x1, 0, barW, H);

    ctx.fillStyle = '#C4624E';
    ctx.fillRect(x1, 0, barW, 2);
  });

  // If currently running and viewing today, add live segment
  if (appState.isRunning && appState.sessionStart && tlDate === getTodayStr()) {
    const now            = Date.now();
    const liveStartRatio = (appState.sessionStart - dayStart.getTime()) / dayMs;
    const liveEndRatio   = (now - dayStart.getTime()) / dayMs;
    const x1 = Math.max(0, liveStartRatio) * W;
    const x2 = Math.min(1, liveEndRatio) * W;
    const barW = Math.max(x2 - x1, 2);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(196,98,78,0.7)');
    grad.addColorStop(1, 'rgba(196,98,78,0.2)');
    ctx.fillStyle = grad;
    ctx.fillRect(x1, 0, barW, H);

    ctx.fillStyle = '#C4624E';
    ctx.fillRect(x1, 0, barW, 2);
  }

  // Hour grid lines
  ctx.strokeStyle = 'rgba(44,40,34,0.06)';
  ctx.lineWidth   = 1;
  for (let h = 1; h < 24; h++) {
    const x = (h / 24) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // Current time marker — only for today
  if (tlDate === getTodayStr()) {
    const nowRatio = (Date.now() - dayStart.getTime()) / dayMs;
    const nowX     = nowRatio * W;
    ctx.strokeStyle = 'rgba(196,98,78,0.5)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(nowX, 0);
    ctx.lineTo(nowX, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── History bars ─────────────────────────────────────────────
function renderHistoryBars(historyData) {
  const container = document.getElementById('history-bars');
  container.innerHTML = '';

  const days  = 7;
  const today = new Date();
  const todayStr = getTodayStr();

  // Ensure today is in history data
  const data = Object.assign({}, historyData);
  if (todayData) {
    data[todayStr] = todayData;
  }

  // Find max for scaling
  const allSecs = Object.values(data).map(d => d.totalSeconds || 0);
  const maxSecs = Math.max(8 * 3600, ...allSecs, 0);

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const secs = data[dateStr] ? data[dateStr].totalSeconds : 0;
    const ratio = maxSecs > 0 ? Math.min(secs / maxSecs, 1) : 0;

    const group = document.createElement('div');
    group.className = 'history-bar-group';

    const track = document.createElement('div');
    track.className = 'history-bar-track';

    const fill = document.createElement('div');
    fill.className = 'history-bar-fill' + (i === 0 ? ' today' : '');
    fill.style.height = `${ratio * 100}%`;

    track.appendChild(fill);

    const label = document.createElement('div');
    label.className = 'history-bar-label';
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    label.textContent = i === 0 ? '今' : weekdays[date.getDay()];

    group.appendChild(track);
    group.appendChild(label);
    container.appendChild(group);
  }
}

// ── History navigation ───────────────────────────────────────
prevDayBtn.addEventListener('click', () => {
  const prev = getPrevDateStr(viewDate || getTodayStr());
  ipcRenderer.send('get-day', prev);
});

nextDayBtn.addEventListener('click', () => {
  const next = getNextDateStr(viewDate || getTodayStr());
  ipcRenderer.send('get-day', next);
});

function getPrevDateStr(from) {
  const d = new Date(from + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getNextDateStr(from) {
  const today = getTodayStr();
  const d = new Date(from + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  const next = d.toISOString().split('T')[0];
  return next <= today ? next : today;
}

// Redraw timeline every 30 seconds
setInterval(() => {
  if (appState.isRunning && (!viewDate || viewDate === getTodayStr())) {
    drawTimeline(appState.sessions, getTodayStr());
  }
}, 30000);
