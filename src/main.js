/* New Year Effects — главный процесс.
 *
 * Версия для Windows праздничных расширений GNOME (ng-gnome-extensions):
 * снег со снеговиками, гирлянда, Дед Мороз на санях, снежки, фейерверк, ёлка.
 *
 * Устройство:
 *  - два прозрачных окна на весь экран, которые пропускают клики насквозь:
 *      верхний слой — поверх всех окон (режим «поверх окон»),
 *      нижний слой — сразу над рабочим столом, под всеми окнами
 *      (режимы «под окнами» и «только на пустом рабочем столе»);
 *    нижний слой открывается из верхнего через window.open, поэтому оба
 *    живут в одном JS-контексте: вся логика и физика — в одном месте;
 *  - окно ловит мышь только над снежками, игрушками, шнурком и т. п. —
 *    это решает рендерер и просит сюда через IPC 'interactive';
 *  - значок в трее с меню для каждого эффекта, окно настроек, горячие клавиши. */
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage } = require('electron');
const { SCHEMA, coerce, defaults } = require('./schema');
const I18n = require('./i18n');
const T = I18n.T;

// окна-слои всегда видны: не даём Chromium «усыплять» перекрытые окна
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

let win32 = null;
try {
    win32 = require('./win32');
} catch (e) {
    console.error('win32 bindings failed', e);
}

const ASSETS = path.join(__dirname, '..', 'assets');
const OVERLAY_PREFS = {
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false,
    backgroundThrottling: false,
    spellcheck: false,
};

// ---------- настройки ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let values = defaults();
let saveTimer = null;

function loadSettings() {
    try {
        const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
        for (const [k, v] of Object.entries(raw)) {
            const c = coerce(k, v);
            if (c !== undefined)
                values[k] = c;
        }
    } catch (e) {
        // первый запуск или испорченный файл — значения по умолчанию
    }
}

function saveSoon() {
    if (saveTimer)
        clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
}

function saveNow() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    try {
        fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
        const tmp = settingsFile() + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(values, null, 1));
        fs.renameSync(tmp, settingsFile());
    } catch (e) {
        console.error('save settings', e);
    }
}

function get(key) {
    return values[key];
}

function set(key, value) {
    const v = coerce(key, value);
    if (v === undefined || values[key] === v)
        return;
    values[key] = v;
    saveSoon();
    for (const w of [top, desk, settingsWin]) {
        if (w && !w.isDestroyed())
            w.webContents.send('settings', key, v);
    }
    onSettingChanged(key);
}

function toggle(key) {
    set(key, !get(key));
}

function onSettingChanged(key) {
    if (key === 'app.language')
        I18n.setLanguage(get('app.language'));
    if (key === 'app.autostart')
        applyAutostart();
    if (SCHEMA[key] && SCHEMA[key].type === 'k')
        registerHotkeys();
    if (!SCHEMA[key] || !SCHEMA[key].internal)
        queueMenu();
}

// ---------- слои ----------

let top = null;
let desk = null;
let ready = false;
let deskTimer = null;
let escapeOn = false;
const interactive = { top: false, desk: false };

function displaysInfo() {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map(d => ({
        id: d.id,
        bounds: d.bounds,
        workArea: d.workArea,
        scale: d.scaleFactor,
        primary: d.id === primary.id,
        phys: screen.dipToScreenRect(null, d.bounds),
    }));
}

function unionBounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const d of screen.getAllDisplays()) {
        const b = d.bounds;
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width);
        y1 = Math.max(y1, b.y + b.height);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function layerOptions(alwaysOnTop) {
    const b = unionBounds();
    return {
        ...b,
        transparent: true,
        backgroundColor: '#00000000',
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        show: false,
        alwaysOnTop,
        enableLargerThanScreen: true,
        title: 'New Year Effects',
        webPreferences: OVERLAY_PREFS,
    };
}

function hwndOf(w) {
    if (!win32 || !w || w.isDestroyed())
        return 0;
    return win32.addr(win32.hwndFromBuffer(w.getNativeWindowHandle()));
}

function createLayers() {
    top = new BrowserWindow(layerOptions(true));
    top.setAlwaysOnTop(true, 'screen-saver');
    top.setIgnoreMouseEvents(true);
    top.webContents.setWindowOpenHandler(({ frameName }) => {
        if (frameName !== 'ny-desk')
            return { action: 'deny' };
        return { action: 'allow', overrideBrowserWindowOptions: layerOptions(false) };
    });
    top.webContents.on('did-create-window', child => {
        desk = child;
        desk.setIgnoreMouseEvents(true);
        desk.setBounds(unionBounds());
        desk.showInactive();
        keepDeskDown();
        if (deskTimer)
            clearInterval(deskTimer);
        deskTimer = setInterval(keepDeskDown, 400);
        desk.on('closed', () => {
            desk = null;
            if (deskTimer)
                clearInterval(deskTimer);
            deskTimer = null;
        });
    });
    top.on('closed', () => {
        top = null;
        ready = false;
    });
    top.webContents.on('render-process-gone', (e, d) => {
        console.error('overlay renderer gone', d.reason);
        // упало — перезапускаем слои
        setTimeout(() => {
            for (const w of [desk, top]) {
                if (w && !w.isDestroyed())
                    w.destroy();
            }
            top = desk = null;
            createLayers();
        }, 1500);
    });
    // ошибки слоёв — в консоль главного процесса (видно при запуске из терминала)
    top.webContents.on('console-message', (e, ...args) => {
        const level = e.level !== undefined ? e.level : args[0];
        const message = e.message !== undefined ? e.message : args[1];
        const where = e.sourceId !== undefined ? `${e.sourceId}:${e.lineNumber}` : `${args[3]}:${args[2]}`;
        if (level === 'error' || level === 'warning' || level >= 2 || process.env.NY_DEBUG)
            console.log(`[overlay ${level}] ${message} (${where})`);
    });
    top.loadFile(path.join(__dirname, 'overlay', 'index.html'));
    top.once('ready-to-show', () => {
        top.setBounds(unionBounds());
        top.showInactive();
    });
}

// нижний слой держим сразу над рабочим столом, под всеми окнами
function keepDeskDown() {
    if (!win32 || !desk || desk.isDestroyed())
        return;
    try {
        win32.keepAboveDesktop(win32.hwndFromBuffer(desk.getNativeWindowHandle()));
    } catch (e) {
        console.error('keepAboveDesktop', e);
    }
}

let displaysTimer = null;
function onDisplaysChanged() {
    if (displaysTimer)
        clearTimeout(displaysTimer);
    displaysTimer = setTimeout(() => {
        const b = unionBounds();
        for (const w of [top, desk]) {
            if (w && !w.isDestroyed())
                w.setBounds(b);
        }
        if (top && !top.isDestroyed())
            top.webContents.send('displays', displaysInfo());
    }, 300);
}

function sendAction(name, arg) {
    if (top && !top.isDestroyed() && ready)
        top.webContents.send('action', name, arg);
}

ipcMain.on('overlay-ready', e => {
    ready = true;
    e.returnValue = {
        values,
        locale: app.getLocale(),
        displays: displaysInfo(),
        own: [hwndOf(top), hwndOf(desk)].filter(Boolean),
    };
});

ipcMain.on('own-windows', e => {
    e.returnValue = [hwndOf(top), hwndOf(desk)].filter(Boolean);
});

ipcMain.on('set', (e, key, value) => set(key, value));

ipcMain.on('interactive', (e, state) => {
    for (const name of ['top', 'desk']) {
        const want = !!state[name];
        const w = name === 'top' ? top : desk;
        if (interactive[name] !== want && w && !w.isDestroyed()) {
            interactive[name] = want;
            if (process.env.NY_DEBUG)
                console.log(`interactive ${name} = ${want}`);
            w.setIgnoreMouseEvents(!want);
        }
    }
});

ipcMain.on('top-visible', (e, visible) => {
    if (!top || top.isDestroyed())
        return;
    if (visible) {
        top.showInactive();
        top.setAlwaysOnTop(true, 'screen-saver');
    } else {
        top.hide();
    }
});

ipcMain.on('want-escape', (e, on) => {
    if (on === escapeOn)
        return;
    escapeOn = on;
    if (on) {
        try {
            globalShortcut.register('Escape', () => sendAction('escape'));
        } catch (err) {
            escapeOn = false;
        }
    } else {
        globalShortcut.unregister('Escape');
    }
});

ipcMain.on('open-settings', () => openSettings());

// ---------- горячие клавиши ----------

const HOTKEYS = {
    'snow.toggle-key': () => toggle('snow.enabled'),
    'garland.toggle-key': () => toggle('garland.enabled'),
    'sleigh.run-key': () => sendAction('sleigh.run'),
    'snowballs.toggle-key': () => toggle('snowballs.enabled'),
    'fireworks.show-key': () => {
        set('fireworks.enabled', true);
        setTimeout(() => sendAction('fireworks.show'), 50);
    },
};
let registered = [];
const hotkeyStatus = {};

function registerHotkeys() {
    for (const acc of registered)
        globalShortcut.unregister(acc);
    registered = [];
    for (const [key, fn] of Object.entries(HOTKEYS)) {
        const acc = String(get(key) || '').trim();
        if (!acc) {
            hotkeyStatus[key] = 'none';
            continue;
        }
        let ok = false;
        try {
            ok = globalShortcut.register(acc, fn);
        } catch (e) {
            ok = false;
        }
        hotkeyStatus[key] = ok ? 'ok' : 'busy';
        if (ok)
            registered.push(acc);
    }
    if (settingsWin && !settingsWin.isDestroyed())
        settingsWin.webContents.send('hotkey-status', hotkeyStatus);
}

// ---------- автозапуск ----------

function applyAutostart() {
    if (!app.isPackaged)
        return;   // при запуске из исходников (npm start) не трогаем
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    try {
        app.setLoginItemSettings({ openAtLogin: !!get('app.autostart'), path: exe, args: ['--autostart'] });
    } catch (e) {
        console.error('autostart', e);
    }
}

// ---------- значок в трее ----------

let tray = null;
let menuTimer = null;

function queueMenu() {
    if (menuTimer)
        clearTimeout(menuTimer);
    menuTimer = setTimeout(() => {
        menuTimer = null;
        if (tray)
            tray.setToolTip(trayTip());
    }, 100);
}

function trayTip() {
    return T('Новогодние эффекты', 'New Year Effects');
}

const visChoices = () => [
    ['above', T('поверх окон', 'above windows')],
    ['desktop', T('только на пустом рабочем столе', 'only on an empty desktop')],
    ['below', T('под окнами', 'below windows')],
];

function check(label, key) {
    return { label, type: 'checkbox', checked: !!get(key), click: () => toggle(key) };
}

function action(label, name, arg) {
    return { label, click: () => sendAction(name, arg) };
}

// подменю выбора: [значение, подпись]; текущее значение — с точкой
function choice(label, key, choices, fmtCurrent) {
    const cur = get(key);
    const list = choices.slice();
    if (!list.some(c => c[0] === cur) && fmtCurrent)
        list.push([cur, fmtCurrent(cur)]);
    const found = list.find(c => c[0] === cur);
    return {
        label: found ? `${label}: ${found[1]}` : label,
        submenu: list.map(([v, text]) => ({
            label: text, type: 'radio', checked: v === cur, click: () => set(key, v),
        })),
    };
}

function hk(key) {
    const k = String(get(key) || '').trim();
    return k ? `\t${k}` : '';
}

function minutesToNext() {
    const now = Date.now() / 1000;
    let last = get('sleigh.last-run');
    if (last > now + 60)
        last = now;
    const left = last + get('sleigh.interval-minutes') * 60 - now;
    return Math.max(0, Math.ceil(left / 60));
}

function nextRideLabel() {
    if (!get('sleigh.enabled'))
        return T('Автоматические проезды выключены', 'Automatic rides are off');
    const m = minutesToNext();
    if (m <= 1)
        return T('Следующий проезд: в ближайшую минуту', 'Next ride: within a minute');
    return m >= 60
        ? T(`Следующий проезд: через ${Math.floor(m / 60)} ч ${m % 60} мин`, `Next ride: in ${Math.floor(m / 60)} h ${m % 60} min`)
        : T(`Следующий проезд: через ${m} мин`, `Next ride: in ${m} min`);
}

function countText(count) {
    if (count <= 150)
        return T(`${count} — рекомендуется`, `${count} — recommended`);
    if (count <= 250)
        return T(`${count} — повышенная нагрузка`, `${count} — higher load`);
    return T(`${count} — ⚡ высокая нагрузка`, `${count} — ⚡ high load`);
}

function buildMenu() {
    const sep = { type: 'separator' };
    const minutes = m => (m % 60 === 0 ? T(`${m / 60} ч`, `${m / 60} h`) : T(`${m} мин`, `${m} min`));

    const snow = [
        check(T('Снег', 'Snow') + hk('snow.toggle-key'), 'snow.enabled'),
        choice(T('Снежинок', 'Snowflakes'), 'snow.flake-count',
            [50, 80, 120, 150, 200, 250, 400].map(n => [n, countText(n)]), countText),
        choice(T('Показывать', 'Show'), 'snow.visibility', visChoices()),
        sep,
        action(T('Намести сугробы', 'Pile up snow now'), 'snow.fill'),
        action(T('Стряхнуть весь снег', 'Shake off all snow'), 'snow.shake'),
        action(T('Убрать снежки и снеговиков', 'Remove snowballs and snowmen'), 'snow.clear'),
    ];
    const garland = [
        check(T('Гирлянда', 'Garland') + hk('garland.toggle-key'), 'garland.enabled'),
        check(T('Лампочки горят', 'Lights on'), 'garland.lights-on'),
        choice(T('Показывать', 'Show'), 'garland.visibility', visChoices()),
        choice(T('Режим', 'Mode'), 'garland.mode', [
            ['twinkle', T('Мерцание', 'Twinkle')], ['chase', T('Бегущие огни', 'Chase')],
            ['alternate', T('Попеременно', 'Alternate')], ['steady', T('Ровный свет', 'Steady')],
        ]),
        choice(T('Цвет провода', 'Wire color'), 'garland.wire-color', [
            ['#14381a', T('зелёный', 'green')], ['#111111', T('чёрный', 'black')],
            ['#f2f2f2', T('белый', 'white')], ['#c9a227', T('золотой', 'gold')],
            ['#b3121c', T('красный', 'red')], ['#a8adb5', T('серебряный', 'silver')],
        ], v => v),
        choice(T('Цвета лампочек', 'Bulb colors'), 'garland.palette', [
            ['multicolor', T('Разноцветные', 'Multicolor')], ['warm', T('Тёплые', 'Warm')], ['cold', T('Холодные', 'Cold')],
        ]),
        choice(T('Скорость мигания', 'Blink speed'), 'garland.speed',
            [0.3, 0.5, 1, 1.5, 2, 3, 4].map(v => [v, v.toFixed(1)]), v => v.toFixed(1)),
    ];
    const sleigh = [
        action(T('Проехать сейчас', 'Ride now') + hk('sleigh.run-key'), 'sleigh.run'),
        check(T('Проезжать автоматически', 'Ride automatically'), 'sleigh.enabled'),
        { label: nextRideLabel(), enabled: false },
        choice(T('Как часто', 'How often'), 'sleigh.interval-minutes',
            [15, 30, 60, 120, 180, 360, 720].map(m => [m, minutes(m)]), minutes),
        choice(T('Показывать', 'Show'), 'sleigh.visibility', visChoices()),
    ];
    const snowballs = [
        check(T('Снежки', 'Snowballs') + hk('snowballs.toggle-key'), 'snowballs.enabled'),
        choice(T('Показывать', 'Show'), 'snowballs.visibility', visChoices()),
        choice(T('Горка', 'Pile'), 'snowballs.corner', [
            ['bottom-right', T('справа внизу', 'bottom right')], ['bottom-left', T('слева внизу', 'bottom left')],
        ]),
        choice(T('Сила броска', 'Throw power'), 'snowballs.throw-power',
            [0.5, 1, 1.5, 2, 3].map(v => [v, v.toFixed(1)]), v => v.toFixed(1)),
        action(T('Убрать следы со стен', 'Clear splats from the walls'), 'snowballs.clear'),
    ];
    const fireworks = [
        check(T('Фейерверк', 'Fireworks'), 'fireworks.enabled'),
        action(T('Салют сейчас!', 'Fireworks now!') + hk('fireworks.show-key'), 'fireworks.show'),
        sep,
        action(T('Поставить ракету', 'Place a rocket'), 'fireworks.place', 'rocket'),
        action(T('Поставить батарею салютов', 'Place a firework cake'), 'fireworks.place', 'battery'),
        action(T('Поставить фонтан', 'Place a fountain'), 'fireworks.place', 'fountain'),
        action(T('Убрать все фейерверки', 'Remove all fireworks'), 'fireworks.clear'),
        sep,
        choice(T('Показывать', 'Show'), 'fireworks.visibility', visChoices()),
        choice(T('Размер взрыва', 'Burst size'), 'fireworks.burst-size',
            [50, 80, 100, 150, 200, 250].map(v => [v, String(v)]), v => String(v)),
    ];
    const tree = [
        check(T('Ёлка', 'Christmas tree'), 'tree.enabled'),
        { label: T('Игрушки — в ящике рядом: тащите мышью на ёлку', 'Toys are in the box: drag them onto the tree'), enabled: false },
        check(T('Ящик с игрушками', 'Toy box'), 'tree.show-box'),
        action(T('Нарядить автоматически', 'Decorate automatically'), 'tree.decorate'),
        action(T('Снять все игрушки', 'Take all toys off'), 'tree.undecorate'),
        sep,
        choice(T('Где стоит', 'Position'), 'tree.position', [
            ['right', T('справа', 'right')], ['center', T('по центру', 'center')], ['left', T('слева', 'left')],
        ]),
        choice(T('Снег на ветках', 'Snow on branches'), 'tree.tree-snow', [
            ['snowfall', T('копится в снегопад', 'piles up while it snows')],
            ['always', T('всегда', 'always')], ['never', T('нет', 'none')],
        ]),
        choice(T('Показывать', 'Show'), 'tree.visibility', visChoices()),
        choice(T('Размер', 'Size'), 'tree.tree-size',
            [0.6, 0.8, 1, 1.2, 1.4, 1.6].map(v => [v, `${Math.round(v * 100)}%`]), v => `${Math.round(v * 100)}%`),
    ];
    const on = key => (get(key) ? '' : T('  (выкл.)', '  (off)'));
    const template = [
        { label: T('Новогодние эффекты', 'New Year Effects'), enabled: false },
        sep,
        { label: `❄  ${T('Снег', 'Snow')}${on('snow.enabled')}`, submenu: snow },
        { label: `💡  ${T('Гирлянда', 'Garland')}${on('garland.enabled')}`, submenu: garland },
        { label: `🛷  ${T('Дед Мороз', 'Ded Moroz')}`, submenu: sleigh },
        { label: `⚪  ${T('Снежки', 'Snowballs')}${on('snowballs.enabled')}`, submenu: snowballs },
        { label: `🎆  ${T('Фейерверк', 'Fireworks')}${on('fireworks.enabled')}`, submenu: fireworks },
        { label: `🎄  ${T('Ёлка', 'Christmas tree')}${on('tree.enabled')}`, submenu: tree },
        sep,
        choice(T('Язык / Language', 'Language / Язык'), 'app.language', [
            ['auto', T('Как в системе', 'As in the system')], ['ru', 'Русский'], ['en', 'English'],
        ]),
        ...(app.isPackaged ? [check(T('Запускать вместе с Windows', 'Start with Windows'), 'app.autostart')] : []),
        { label: T('Настройки…', 'Settings…'), click: () => openSettings() },
        sep,
        { label: T('Выход', 'Quit'), click: () => app.quit() },
    ];
    return Menu.buildFromTemplate(template);
}

function trayImage() {
    const file = path.join(ASSETS, 'tray.png');
    const img = nativeImage.createFromPath(file);
    return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function createTray() {
    tray = new Tray(trayImage());
    tray.setToolTip(trayTip());
    const pop = () => tray.popUpContextMenu(buildMenu());
    tray.on('click', pop);
    tray.on('right-click', pop);
}

// ---------- окно настроек ----------

let settingsWin = null;

function openSettings() {
    if (settingsWin && !settingsWin.isDestroyed()) {
        if (settingsWin.isMinimized())
            settingsWin.restore();
        settingsWin.show();
        settingsWin.focus();
        return;
    }
    settingsWin = new BrowserWindow({
        width: 760,
        height: 860,
        minWidth: 560,
        minHeight: 480,
        show: false,
        autoHideMenuBar: true,
        title: T('Новогодние эффекты — настройки', 'New Year Effects — settings'),
        icon: path.join(ASSETS, 'icon.png'),
        backgroundColor: '#1d2433',
        webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, spellcheck: false },
    });
    settingsWin.setMenu(null);
    settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
    settingsWin.once('ready-to-show', () => settingsWin.show());
    settingsWin.on('closed', () => {
        settingsWin = null;
    });
}

ipcMain.on('settings-ready', e => {
    e.returnValue = { values, locale: app.getLocale(), hotkeys: hotkeyStatus, packaged: app.isPackaged };
});

ipcMain.on('action', (e, name, arg) => sendAction(name, arg));

ipcMain.on('user-data', e => {
    e.returnValue = app.getPath('userData');
});

// ---------- запуск ----------

app.on('second-instance', () => openSettings());

app.whenReady().then(() => {
    loadSettings();
    I18n.setSystemLocale(app.getLocale());
    I18n.setLanguage(get('app.language'));
    applyAutostart();
    // первый запуск прямо из установщика иногда не успевает записать автозапуск — повторяем
    setTimeout(applyAutostart, 15000);
    createLayers();
    createTray();
    registerHotkeys();
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed'])
        screen.on(ev, onDisplaysChanged);
    if (process.env.NY_OPEN_SETTINGS)
        openSettings();
    if (!process.argv.includes('--autostart') && !fs.existsSync(path.join(app.getPath('userData'), 'settings.json')))
        saveNow();   // первый запуск: файл настроек, чтобы было видно, где он
});

app.on('window-all-closed', e => {
    // не выходим: живём в трее
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    saveNow();
    if (tray) {
        tray.destroy();
        tray = null;
    }
});
