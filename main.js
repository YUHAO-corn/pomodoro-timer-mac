const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let mainWindow = null;
let timerInterval = null;

// Timer state
let state = {
  isRunning: false,
  totalSeconds: 0,
  currentSessionSeconds: 0,
  sessionStart: null,
  todayDate: getTodayString(),
  sessions: [] // { start, end, duration }
};

// Data file path
const dataPath = path.join(app.getPath('userData'), 'pomodoro-data.json');

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function loadData() {
  try {
    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf-8');
      const data = JSON.parse(raw);
      const today = getTodayString();
      if (data.date === today) {
        state.totalSeconds = data.totalSeconds || 0;
        state.currentSessionSeconds = data.currentSessionSeconds || 0;
        state.sessions = data.sessions || [];
      } else {
        // New day — reset
        state.totalSeconds = 0;
        state.currentSessionSeconds = 0;
        state.sessions = [];
      }
      state.todayDate = today;
    }
  } catch (e) {
    console.error('Failed to load data:', e);
  }
}

function saveData() {
  try {
    const data = {
      date: getTodayString(),
      totalSeconds: state.totalSeconds,
      currentSessionSeconds: state.currentSessionSeconds,
      sessions: state.sessions
    };
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateTray() {
  if (!tray) return;
  const timeStr = formatTime(state.currentSessionSeconds);
  console.log('updateTray called, setting title to:', timeStr);
  tray.setTitle(timeStr, { fontType: 'monospacedDigit' });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: state.isRunning ? '暂停' : '开始',
      click: () => {
        if (state.isRunning) {
          stopTimer();
        } else {
          startTimer();
        }
      }
    },
    { type: 'separator' },
    {
      label: '打开面板',
      click: () => {
        showMainWindow();
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
}

function startTimer() {
  if (state.isRunning) return;

  // Check midnight reset
  const today = getTodayString();
  if (today !== state.todayDate) {
    state.totalSeconds = 0;
    state.currentSessionSeconds = 0;
    state.sessions = [];
    state.todayDate = today;
  }

  state.isRunning = true;
  state.sessionStart = Date.now();

  timerInterval = setInterval(() => {
    // Check midnight reset
    const currentDay = getTodayString();
    if (currentDay !== state.todayDate) {
      state.totalSeconds = 0;
      state.currentSessionSeconds = 0;
      state.sessions = [];
      state.todayDate = currentDay;
      state.sessionStart = Date.now();
    }

    state.totalSeconds++;
    state.currentSessionSeconds++;

    // Every 25 minutes, show notification
    if (state.currentSessionSeconds > 0 && state.currentSessionSeconds % (25 * 60) === 0) {
      showPomodoroNotification();
    }

    updateTray();
    saveData();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('state-update', getStateForRenderer());
    }
  }, 1000);

  updateTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-update', getStateForRenderer());
  }
}

function finalizeCurrentSession() {
  if (!state.sessionStart || state.currentSessionSeconds <= 0) return;

  state.sessions.push({
    start: state.sessionStart,
    end: Date.now(),
    duration: state.currentSessionSeconds
  });
}

function advanceToNextPomodoro() {
  finalizeCurrentSession();
  state.sessionStart = Date.now();
  state.currentSessionSeconds = 0;
  saveData();
  updateTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-update', getStateForRenderer());
  }
}

function stopTimer() {
  if (!state.isRunning) return;

  clearInterval(timerInterval);
  timerInterval = null;
  state.isRunning = false;

  finalizeCurrentSession();
  state.sessionStart = null;
  state.currentSessionSeconds = 0;

  saveData();
  updateTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-update', getStateForRenderer());
  }
}

function showPomodoroNotification() {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: '番茄钟完成',
    body: '25分钟到了，要继续工作还是休息一下？',
    actions: [
      { type: 'button', text: '继续工作' },
      { type: 'button', text: '开始休息' }
    ],
    closeButtonText: '开始休息',
    timeoutType: 'never'
  });

  let userResponded = false;

  // Auto-advance after 60 seconds if no response
  const autoAdvanceTimer = setTimeout(() => {
    if (!userResponded) {
      notification.close();
      advanceToNextPomodoro();
    }
  }, 60000);

  notification.on('action', (event, index) => {
    userResponded = true;
    clearTimeout(autoAdvanceTimer);
    if (index === 0) {
      advanceToNextPomodoro();
    } else {
      stopTimer();
    }
  });

  notification.on('close', () => {
    if (!userResponded) {
      clearTimeout(autoAdvanceTimer);
      // User manually closed without clicking buttons - treat as "continue"
      advanceToNextPomodoro();
    }
  });

  notification.show();
}

function getStateForRenderer() {
  return {
    isRunning: state.isRunning,
    totalSeconds: state.totalSeconds,
    currentSessionSeconds: state.currentSessionSeconds,
    sessions: state.sessions,
    sessionStart: state.sessionStart,
    todayDate: state.todayDate
  };
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 680,
    resizable: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#F5F1E8',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.send('state-update', getStateForRenderer());
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

app.whenReady().then(() => {
  // Hide dock icon (menu bar app)
  if (app.dock) app.dock.hide();

  loadData();

  // Create tray
  // Use the real PNG asset first; SVG/template fallback only if the asset is missing.
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6.4" fill="#FFFFFF"/>
        <circle cx="8" cy="8" r="1" fill="#2C2822"/>
        <path d="M8 4.1V8.1L10.9 9.8" stroke="#2C2822" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>
    `;
    trayIcon = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }
  trayIcon = trayIcon.resize({ width: 16, height: 16 });
  trayIcon.setTemplateImage(true);

  tray = new Tray(trayIcon);
  console.log('Tray created:', tray ? 'success' : 'failed');
  tray.setToolTip('番茄钟');
  tray.setTitle(formatTime(state.currentSessionSeconds), { fontType: 'monospacedDigit' });

  updateTray();
  console.log('Initial updateTray called');

  tray.on('click', () => {
    tray.popUpContextMenu();
  });

  // Setup login item (auto-start)
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true
  });

  // IPC handlers
  ipcMain.on('start-timer', () => startTimer());
  ipcMain.on('stop-timer', () => stopTimer());
  ipcMain.on('get-state', (event) => {
    event.reply('state-update', getStateForRenderer());
  });
  ipcMain.on('get-history', (event) => {
    // Load all historical data
    const history = loadHistory();
    event.reply('history-data', history);
  });
});

function loadHistory() {
  // Return last 7 days of data
  const history = {};
  const today = getTodayString();

  // Include today's data
  history[today] = {
    totalSeconds: state.totalSeconds,
    sessions: state.sessions
  };

  // Try to load previous days (we store only today currently, but prepare structure)
  // In a real app, we'd store per-day archives
  return history;
}

app.on('window-all-closed', (e) => {
  // Keep running in tray
});

app.on('before-quit', () => {
  stopTimer();
  saveData();
});
