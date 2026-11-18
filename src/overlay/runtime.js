/* Рантайм слоёв: то, что в GNOME давали Clutter, Mutter и Shell.
 *
 *  - два холста: верхний слой (это окно) и нижний (окно над рабочим столом,
 *    открыто через window.open — тот же JS-контекст);
 *  - экраны и рабочие области, окна приложений по Z-порядку (Win32),
 *    курсор и кнопки мыши — опрос раз в кадр;
 *  - «пуст ли рабочий стол», полноэкранные окна;
 *  - плавные анимации (аналог Clutter ease) и общий цикл кадров;
 *  - мышь: окно ловит клики только над тем, что можно взять, — модули
 *    отвечают на hit(x, y, layer); перетаскивание — через capture().
 *
 * Все координаты модулей — логические px (DIP) относительно левого верхнего
 * угла общей области всех мониторов (поэтому они не бывают отрицательными). */
'use strict';

const { ipcRenderer } = require('electron');
const I18n = require('../i18n');
const Cairo = require('./cairo');

let win32 = null;
try {
    if (!process.env.NY_NOWIN32)
        win32 = require('../win32');
} catch (e) {
    console.error('win32 bindings failed', e);
}

const EASE = {
    linear: t => t,
    outQuad: t => t * (2 - t),
    inQuad: t => t * t,
    outBack: t => {
        const s = 1.70158;
        t -= 1;
        return t * t * ((s + 1) * t + s) + 1;
    },
    outElastic: t => {
        if (t <= 0)
            return 0;
        if (t >= 1)
            return 1;
        const p = 0.3, s = p / 4;
        return Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1;
    },
};

// ---------- настройки ----------

class Settings {
    constructor(values) {
        this.v = Object.assign({}, values);
        this.listeners = new Map();
        this.nextId = 1;
    }

    get(key) {
        return this.v[key];
    }

    set(key, value) {
        ipcRenderer.send('set', key, value);
        this._changed(key, value);
    }

    on(key, cb) {
        const id = this.nextId++;
        this.listeners.set(id, [key, cb]);
        return id;
    }

    off(id) {
        this.listeners.delete(id);
    }

    _changed(key, value) {
        if (this.v[key] === value)
            return;
        this.v[key] = value;
        for (const [k, cb] of [...this.listeners.values()]) {
            if (k === key || k === '*') {
                try {
                    cb(value, key);
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    view(prefix) {
        const S = this;
        const ids = new Set();
        return {
            get: key => S.get(`${prefix}.${key}`),
            set: (key, v) => S.set(`${prefix}.${key}`, v),
            on: (key, cb) => {
                const id = S.on(key === '*' ? '*' : `${prefix}.${key}`, cb);
                ids.add(id);
                return id;
            },
            off: id => {
                S.off(id);
                ids.delete(id);
            },
            offAll: () => {
                for (const id of ids)
                    S.off(id);
                ids.clear();
            },
        };
    }
}

// ---------- где показывать эффект ----------

/* Как FestiveLayer в GNOME: «поверх окон» — верхний слой; «под окнами» и
 * «только на пустом рабочем столе» — нижний; в последнем режиме слой плавно
 * появляется, когда открытых окон нет, и прячется, когда они есть. */
class FestiveLayer {
    constructor(rt, s, onChange) {
        this.rt = rt;
        this.s = s;
        this.onChange = onChange || (() => {});
        this.opacity = this.shown ? 1 : 0;
        this._id = s.on('visibility', () => this._fade(true));
        this._cid = rt.on('desktop-clear', () => this._fade(true));
    }

    get mode() {
        return this.s.get('visibility');
    }

    get layer() {
        return this.mode === 'above' ? 'top' : 'desk';
    }

    get shown() {
        return this.mode !== 'desktop' || this.rt.desktopClear;
    }

    get visible() {
        return this.opacity > 0.002;
    }

    _fade(notify) {
        const shown = this.shown;
        this.rt.removeTweens(this, 'opacity');
        if (shown)
            this.rt.tween(this, { opacity: 1 }, 450, 'outQuad');
        else
            this.rt.tween(this, { opacity: 0 }, 300, 'outQuad');
        this.rt.redraw();
        if (notify)
            this.onChange(shown);
    }

    destroy() {
        this.s.off(this._id);
        this.rt.off(this._cid);
        this.rt.removeTweens(this);
    }
}

// ---------- рантайм ----------

class Runtime {
    constructor() {
        const init = ipcRenderer.sendSync('overlay-ready');
        I18n.setSystemLocale(init.locale);
        this.S = new Settings(init.values);
        I18n.setLanguage(this.S.get('app.language'));
        this.S.on('app.language', v => I18n.setLanguage(v));
        this.own = new Set(init.own);
        this.modules = [];
        this.tweens = [];
        this.listeners = new Map();
        this.nextId = 1;
        this.dirty = { top: true, desk: true };
        this.P = { x: -1e5, y: -1e5, down: false };
        this.wins = [];
        this.allWins = new Map();
        this.desktopClear = true;
        this._clearSince = 0;
        this._capture = null;
        this._modal = null;
        this._lastDownAt = 0;
        this.hover = null;
        this._interactive = { top: false, desk: false };
        this._cursor = { top: '', desk: '' };
        this._escape = false;
        // связь между эффектами (в GNOME — globalThis.__festive*)
        this.festiveGround = null;   // снег: высота сугроба, «взрыв» сугроба, удар по снежку
        this.obstacles = new Set();  // сани: прямоугольники, под которыми взметается снег
        this.snowStamp = 0;          // когда последний раз шёл снег (секунды rt.now())

        this.dpr = window.devicePixelRatio || 1;
        this.setDisplays(init.displays);
        this.layers = {};
        this.layers.top = this._makeLayer('top', window, document);
        this._openDesk();

        ipcRenderer.on('settings', (e, key, value) => this.S._changed(key, value));
        ipcRenderer.on('displays', (e, list) => {
            this.setDisplays(list);
            for (const L of Object.values(this.layers))
                this._sizeLayer(L);
            this.emit('displays');
            this.redraw();
        });
        ipcRenderer.on('action', (e, name, arg) => this._action(name, arg));

        this._debugHooks();
        this._last = this.now();
        this._winT = 0;
        const loop = () => {
            requestAnimationFrame(loop);
            try {
                this._frame();
            } catch (e) {
                console.error('frame failed', e);
            }
        };
        requestAnimationFrame(loop);
        // спрятанное окно не получает requestAnimationFrame — подстраховка таймером
        setInterval(() => {
            if (this.now() - (this._lastFrameAt || 0) > 0.1) {
                try {
                    this._frame();
                } catch (e) {
                    console.error('frame failed', e);
                }
            }
        }, 50);
    }

    /* В полноэкранной игре или видео верхний слой убираем совсем: прозрачное
     * окно поверх мешает играм (лишняя задержка кадра). Только если все
     * эффекты верхнего слоя и так прячутся в полноэкранном режиме. */
    _syncTopVisible() {
        const S = this.S;
        const hide = this.anyFullscreen() && !this._capture && !this._modal &&
            S.get('snow.hide-in-fullscreen') && S.get('garland.hide-in-fullscreen') && S.get('sleigh.hide-in-fullscreen');
        if (hide !== this._topHidden) {
            this._topHidden = hide;
            ipcRenderer.send('top-visible', !hide);
        }
    }

    now() {
        return performance.now() / 1000;
    }

    /* Отладка: NY_ACTIONS="3:snow.fill,5:sleigh.run" — действия по таймеру (секунды);
     * NY_SNAP=папка — раз в 4 с сохранять кадры обоих слоёв в PNG. */
    _debugHooks() {
        const acts = process.env.NY_ACTIONS;
        if (acts) {
            for (const part of acts.split(',')) {
                const [t, name, arg] = part.split(':');
                setTimeout(() => this._action(name, arg), Number(t) * 1000);
            }
        }
        const dir = process.env.NY_SNAP;
        if (dir) {
            const fs = require('fs');
            const path = require('path');
            let n = 0;
            setInterval(() => {
                n++;
                for (const [name, L] of Object.entries(this.layers)) {
                    const data = L.canvas.toDataURL('image/png').split(',')[1];
                    fs.writeFileSync(path.join(dir, `${name}-${n}.png`), Buffer.from(data, 'base64'));
                }
            }, 4000);
        }
    }

    // ---------- события ----------

    on(name, cb) {
        const id = this.nextId++;
        this.listeners.set(id, [name, cb]);
        return id;
    }

    off(id) {
        this.listeners.delete(id);
    }

    emit(name, ...args) {
        for (const [n, cb] of [...this.listeners.values()]) {
            if (n === name) {
                try {
                    cb(...args);
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    // ---------- экраны ----------

    setDisplays(list) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const d of list) {
            x0 = Math.min(x0, d.bounds.x);
            y0 = Math.min(y0, d.bounds.y);
            x1 = Math.max(x1, d.bounds.x + d.bounds.width);
            y1 = Math.max(y1, d.bounds.y + d.bounds.height);
        }
        this.U = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        this.W = this.U.w;
        this.H = this.U.h;
        const loc = r => ({ x: r.x - x0, y: r.y - y0, width: r.width, height: r.height });
        this.displays = list.map(d => ({
            id: d.id,
            primary: d.primary,
            scale: d.scale,
            bounds: loc(d.bounds),
            work: loc(d.workArea),
            phys: d.phys,
            inFullscreen: false,
        }));
        this.primary = this.displays.find(d => d.primary) || this.displays[0];
    }

    // физические пиксели экрана → логические координаты слоя
    _displayForPhys(px, py) {
        let best = this.displays[0], bestD = Infinity;
        for (const d of this.displays) {
            const p = d.phys;
            const dx = px < p.x ? p.x - px : px >= p.x + p.width ? px - (p.x + p.width) + 1 : 0;
            const dy = py < p.y ? p.y - py : py >= p.y + p.height ? py - (p.y + p.height) + 1 : 0;
            const dist = dx + dy;
            if (dist < bestD) {
                bestD = dist;
                best = d;
                if (dist === 0)
                    break;
            }
        }
        return best;
    }

    physToLayer(px, py) {
        const d = this._displayForPhys(px, py);
        return [d.bounds.x + (px - d.phys.x) / d.scale, d.bounds.y + (py - d.phys.y) / d.scale];
    }

    // ---------- окна приложений ----------

    _ownWindows() {
        if (this.own.size >= 2)
            return;
        const t = this.now();
        if (t - (this._ownT || 0) < 1)
            return;
        this._ownT = t;
        for (const id of ipcRenderer.sendSync('own-windows'))
            this.own.add(id);
    }

    refreshWindows() {
        if (!win32)
            return;
        this._ownWindows();
        let list;
        try {
            list = win32.listWindows(this.own);
        } catch (e) {
            console.error(e);
            return;
        }
        const vis = [];
        const all = new Map();
        for (const r of list) {
            const d = this._displayForPhys(r.x + r.w / 2, r.y + r.h / 2);
            const w = {
                id: r.id,
                x: d.bounds.x + (r.x - d.phys.x) / d.scale,
                y: d.bounds.y + (r.y - d.phys.y) / d.scale,
                w: r.w / d.scale,
                h: r.h / d.scale,
                min: r.min,
                max: r.max,
                cloaked: r.cloaked,
                display: d,
                surface: false,
                fullscreen: false,
            };
            if (!r.min && !r.cloaked) {
                const b = d.bounds;
                w.fullscreen = w.x <= b.x + 1 && w.y <= b.y + 1 &&
                    w.x + w.w >= b.x + b.width - 1 && w.y + w.h >= b.y + b.height - 1;
                // верх развёрнутого окна — у края экрана: туда снег не сыплем
                w.surface = !w.fullscreen && !w.max && w.y > d.work.y + 1;
                vis.push(w);
            }
            all.set(r.id, w);
        }
        this.wins = vis;
        this.allWins = all;
        // полноэкранный режим монитора: самое верхнее окно на нём — во весь экран
        for (const d of this.displays) {
            d.inFullscreen = false;
            const b = d.bounds;
            for (const w of vis) {
                if (w.x < b.x + b.width && w.x + w.w > b.x && w.y < b.y + b.height && w.y + w.h > b.y) {
                    d.inFullscreen = w.fullscreen;
                    break;
                }
            }
        }
        // пуст ли рабочий стол (с задержкой — окна закрываются с анимацией)
        const clear = vis.length === 0;
        const now = this.now();
        if (clear !== this.desktopClear) {
            if (!this._clearSince)
                this._clearSince = now;
            else if (now - this._clearSince > (clear ? 0.35 : 0.08)) {
                this._clearSince = 0;
                this.desktopClear = clear;
                this.emit('desktop-clear', clear);
            }
        } else {
            this._clearSince = 0;
        }
    }

    // точку закрывает какое-то окно
    coveredAt(x, y) {
        for (const w of this.wins) {
            if (x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h)
                return true;
        }
        return false;
    }

    anyFullscreen() {
        return this.displays.some(d => d.inFullscreen);
    }

    // ---------- анимации ----------

    tween(target, props, ms, ease = 'outQuad', done = null) {
        const now = this.now();
        const keys = Object.keys(props);
        const group = { left: keys.length, done };
        for (const prop of keys) {
            this.removeTweens(target, prop);
            this.tweens.push({
                target, prop, group,
                from: target[prop], to: props[prop],
                t0: now, dur: Math.max(0.001, ms / 1000),
                ease: EASE[ease] || EASE.outQuad,
            });
        }
        this.redraw();
    }

    removeTweens(target, prop) {
        this.tweens = this.tweens.filter(t => !(t.target === target && (prop === undefined || t.prop === prop)));
    }

    hasTweens(target) {
        return this.tweens.some(t => t.target === target);
    }

    _updateTweens(now) {
        if (!this.tweens.length)
            return;
        const done = [];
        for (const t of this.tweens) {
            const p = Math.min(1, (now - t.t0) / t.dur);
            t.target[t.prop] = t.from + (t.to - t.from) * t.ease(p);
            if (p >= 1)
                done.push(t);
        }
        if (done.length) {
            this.tweens = this.tweens.filter(t => !done.includes(t));
            for (const t of done) {
                if (--t.group.left === 0 && t.group.done) {
                    try {
                        t.group.done();
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
        }
        this.redraw();
    }

    // ---------- слои и рисование ----------

    _makeLayer(name, win, doc) {
        doc.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden;background:transparent;';
        doc.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:transparent;user-select:none;';
        let canvas = doc.getElementById('layer');
        if (!canvas) {
            canvas = doc.createElement('canvas');
            canvas.id = 'layer';
            doc.body.appendChild(canvas);
        }
        canvas.style.cssText = 'position:fixed;left:0;top:0;display:block;';
        const L = { name, win, doc, canvas, ctx: canvas.getContext('2d') };
        this._sizeLayer(L);
        doc.addEventListener('mousedown', e => this._onDown(e, name));
        doc.addEventListener('mousemove', e => this._onMove(e, name));
        doc.addEventListener('mouseup', e => this._onUp(e, name));
        doc.addEventListener('contextmenu', e => e.preventDefault());
        doc.addEventListener('dragstart', e => e.preventDefault());
        return L;
    }

    _sizeLayer(L) {
        L.dpr = L.win.devicePixelRatio || 1;
        L.canvas.width = Math.ceil(this.W * L.dpr);
        L.canvas.height = Math.ceil(this.H * L.dpr);
        L.canvas.style.width = `${this.W}px`;
        L.canvas.style.height = `${this.H}px`;
        this.dirty[L.name] = true;
    }

    _openDesk() {
        const child = window.open('about:blank', 'ny-desk');
        if (!child) {
            console.error('desk layer: window.open failed');
            return;
        }
        const tryInit = () => {
            if (!child.document || !child.document.body) {
                setTimeout(tryInit, 50);
                return;
            }
            child.document.title = 'New Year Effects (desktop layer)';
            this.layers.desk = this._makeLayer('desk', child, child.document);
            this.redraw();
        };
        tryInit();
    }

    redraw(layer) {
        if (layer)
            this.dirty[layer] = true;
        else
            this.dirty.top = this.dirty.desk = true;
    }

    // плавные 60 кадров/с на ближайшие доли секунды (салют, полёт снежка)
    fast() {
        this._fastUntil = this.now() + 0.25;
    }

    _draw(name) {
        const L = this.layers[name];
        if (!L)
            return;
        const ctx = L.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
        ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
        const passes = name === 'top' ? ['under', 'main', 'over'] : ['main'];
        for (const pass of passes) {
            for (const m of this.modules) {
                if (!m.draw)
                    continue;
                ctx.save();
                try {
                    m.draw(new Cairo.Context(ctx), name, pass, ctx);
                } catch (e) {
                    console.error(`${m.name}: draw failed`, e);
                }
                ctx.restore();
            }
        }
    }

    // ---------- мышь ----------

    _findHit(x, y, onlyLayer) {
        if (!onlyLayer || onlyLayer === 'top') {
            for (let i = this.modules.length - 1; i >= 0; i--) {
                const m = this.modules[i];
                const h = m.hit && m.hit(x, y, 'top');
                if (h)
                    return Object.assign({ layer: 'top', module: m }, h);
            }
        }
        if (onlyLayer === 'top' || !this.layers.desk || this.coveredAt(x, y))
            return null;
        for (let i = this.modules.length - 1; i >= 0; i--) {
            const m = this.modules[i];
            const h = m.hit && m.hit(x, y, 'desk');
            if (h)
                return Object.assign({ layer: 'desk', module: m }, h);
        }
        return null;
    }

    _updateInput() {
        const want = { top: false, desk: false };
        const cursor = { top: '', desk: '' };
        if (this._modal) {
            want.top = true;
            cursor.top = this._modal.cursor || 'crosshair';
            this.hover = null;
        } else if (this._capture) {
            want[this._capture.layer] = true;
            cursor[this._capture.layer] = this._capture.cursor || 'grabbing';
            this.hover = null;
        } else {
            const h = this._findHit(this.P.x, this.P.y);
            this.hover = h;
            if (h) {
                want[h.layer] = true;
                cursor[h.layer] = h.cursor || 'pointer';
            }
        }
        if (want.top !== this._interactive.top || want.desk !== this._interactive.desk) {
            this._interactive = want;
            ipcRenderer.send('interactive', want);
        }
        for (const name of ['top', 'desk']) {
            const L = this.layers[name];
            if (L && cursor[name] !== this._cursor[name]) {
                this._cursor[name] = cursor[name];
                L.doc.body.style.cursor = cursor[name] || 'default';
            }
        }
        const esc = !!(this._modal || this._capture);
        if (esc !== this._escape) {
            this._escape = esc;
            ipcRenderer.send('want-escape', esc);
        }
    }

    hoverTarget() {
        return this.hover ? this.hover.target : null;
    }

    /* Перетаскивание: handler = {move(x, y, t), up(x, y, button, t), cancel(), cursor}.
     * layer — окно, в котором нажали (туда и придут события). */
    capture(handler, layer) {
        this._capture = Object.assign({ layer: layer || 'top' }, handler);
        this._captureLost = 0;
        this._updateInput();
    }

    releaseCapture() {
        this._capture = null;
    }

    get captured() {
        return !!this._capture;
    }

    // режим «щёлкните по экрану» (установка фейерверков): handler = {down, move, cancel, cursor}
    setModal(handler) {
        this._modal = handler;
        this._updateInput();
    }

    clearModal() {
        this._modal = null;
    }

    _onDown(e, layer) {
        const x = e.clientX, y = e.clientY;
        this.P.x = x;
        this.P.y = y;
        const t = this.now();
        if (this._modal) {
            this._modal.down?.({ x, y, button: e.button, time: t });
            return;
        }
        if (this._capture)
            return;
        const h = this._findHit(x, y, layer === 'top' ? 'top' : null);
        if (h && h.layer === layer && h.down)
            h.down({ x, y, button: e.button, time: t, layer });
        this._updateInput();
    }

    _onMove(e, layer) {
        const x = e.clientX, y = e.clientY;
        this.P.x = x;
        this.P.y = y;
        if (this._modal)
            this._modal.move?.(x, y, this.now());
        else if (this._capture && this._capture.layer === layer)
            this._capture.move?.(x, y, this.now());
    }

    _onUp(e, layer) {
        const x = e.clientX, y = e.clientY;
        if (this._modal) {
            this._modal.up?.({ x, y, button: e.button, time: this.now() });
            return;
        }
        const c = this._capture;
        if (c && c.layer === layer) {
            this._capture = null;
            c.up?.(x, y, e.button, this.now());
            this._updateInput();
        }
    }

    _action(name, arg) {
        if (name === 'escape') {
            if (this._capture) {
                const c = this._capture;
                this._capture = null;
                c.cancel?.();
            } else if (this._modal) {
                this._modal.cancel?.();
            }
            this._updateInput();
            return;
        }
        const [mod, act] = name.split('.');
        const m = this.modules.find(x => x.name === mod);
        if (m && m.action) {
            try {
                m.action(act, arg);
            } catch (e) {
                console.error(`${name} failed`, e);
            }
        }
    }

    // ---------- кадр ----------

    add(module) {
        this.modules.push(module);
        return module;
    }

    _frame() {
        const now = this.now();
        // спокойно — 30 кадров/с; перетаскивание, салют, анимации — 60 (даже на 144 Гц)
        const fast = this._capture || this._modal || this.tweens.length || now < (this._fastUntil || 0);
        if (now - this._last < (fast ? 1 / 62 : 1 / 31))
            return;
        this._lastFrameAt = now;
        let dt = now - this._last;
        this._last = now;
        if (dt > 0.25)
            dt = 0.25;
        if (now - this._winT >= 0.012) {
            this._winT = now;
            this.refreshWindows();
            if (win32) {
                try {
                    const [px, py] = win32.cursor();
                    const [lx, ly] = this.physToLayer(px, py);
                    if (!this._capture || !this._interactive[this._capture.layer]) {
                        this.P.x = lx;
                        this.P.y = ly;
                    }
                    this.P.down = win32.mouseDown();
                } catch (e) {
                    console.error(e);
                }
            }
        }
        // страховка: кнопку отпустили, а mouseup не пришёл (окно потеряло захват)
        if (this._capture && !this.P.down) {
            this._captureLost = (this._captureLost || 0) + dt;
            if (this._captureLost > 0.4) {
                const c = this._capture;
                this._capture = null;
                c.up?.(this.P.x, this.P.y, 0, now);
            }
        } else if (this._capture) {
            this._captureLost = 0;
        }
        this._syncTopVisible();
        this._updateTweens(now);
        for (const m of this.modules) {
            if (!m.tick)
                continue;
            try {
                m.tick(now, dt);
            } catch (e) {
                console.error(`${m.name}: tick failed`, e);
            }
        }
        this._updateInput();
        // Слой перерисовывается не чаще 30 раз в секунду (снег, гирлянда, сани),
        // во время перетаскивания, салюта и анимаций — до 60.
        for (const name of ['top', 'desk']) {
            if (this.dirty[name]) {
                this.dirty[name] = false;
                this._draw(name);
            }
        }
        if (process.env.NY_DEBUG) {
            this._dbgN = (this._dbgN || 0) + 1;
            if (now - (this._dbgT || 0) > 3) {
                const ms = ((performance.now() / 1000 - now) * 1000).toFixed(2);
                console.log(`alive: ${this._dbgN} frames, wins=${this.wins.length}, clear=${this.desktopClear}, P=${Math.round(this.P.x)},${Math.round(this.P.y)}, last frame ${ms} ms, desk=${!!this.layers.desk}`);
                this._dbgT = now;
                this._dbgN = 0;
            }
        }
    }
}

module.exports = { Runtime, FestiveLayer, EASE };
