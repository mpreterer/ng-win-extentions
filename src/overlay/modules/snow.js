/* Snowfall Physics — перенос расширения GNOME на Windows.
 *
 * Снег падает, оседает на верхней кромке окон и внизу экрана (на панели
 * задач), осыпается при тряске/перемещении окна и падает вниз при закрытии
 * или сворачивании окна. Курсором, проведённым вдоль сугроба, скатывается
 * снежок; снежки складываются в снеговиков.
 *
 * Как и в GNOME:
 *  - падающая снежинка — одна общая картинка, рисуется со своим размером;
 *  - осевший снег — только данные; каждый сугроб рисуется ОДНОЙ картинкой и
 *    перерисовывается не чаще 4 раз в секунду;
 *  - сугроб окна рисуется на верхнем слое сразу «над окном»: его закрывают
 *    окна, которые выше по Z-порядку (отсечение их прямоугольниками);
 *  - физика — с частотой из настройки fps (рекомендуется 30). */
'use strict';

const Cairo = require('../cairo');
const Snowman = require('./snowman');
const { FestiveLayer } = require('../runtime');

const BIN = 4;            // ширина столбика сугроба, px
const GRAVITY = 600;      // px/с²
const GROUND_CAP = 46;    // максимальная высота сугроба внизу экрана, px
const REPOSE = 3.2;       // макс. перепад высот соседних столбиков (угол откоса)
const EDGE_HEIGHT = -0.5; // «высота» за краем окна: снег у края скатывается
const TELEPORT = 400;     // скачок окна за кадр, после которого снег падает целиком
const TEX = 16;
const FLUSH_INTERVAL = 0.25; // как часто перерисовывать сугробы, с
const LIP = 4;            // снег чуть свисает на заголовок окна, px
const MAX_STACKS = 14;    // снежков и снеговиков одновременно
const START_R = 6;        // радиус нового снежка
const MAX_R = 38;         // больше снежок не растёт
const ROLL_START = 26;    // сколько провести курсором по сугробу, чтобы начать катать, px
const BALL_GRAVITY = 1500;

function makeFlake(dpr) {
    return Cairo.makeCanvas(TEX, TEX, (cr, w, h) => {
        const g = new Cairo.RadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStopRGBA(0, 1, 1, 1, 1);
        g.addColorStopRGBA(0.5, 1, 1, 1, 0.85);
        g.addColorStopRGBA(1, 0.92, 0.96, 1, 0);
        cr.setSource(g);
        cr.arc(w / 2, h / 2, w / 2, 0, 2 * Math.PI);
        cr.fill();
    }, dpr);
}

/* Сугроб: столбики шириной BIN, в каждом — стопка снежинок (только данные).
 * Рисуется одной картинкой — вместо сотен отдельных снежинок. */
class Surface {
    constructor(nbins, cap, isGround) {
        this.cap = cap;
        this.isGround = isGround;
        this.bins = [];
        this.heights = [];
        this.baseY = [];
        this.count = 0;
        this.dirty = false;
        this.needsPaint = true;
        this.canvas = null;
        this.ox = 0;         // положение системы координат сугроба на экране
        this.oy = 0;
        this.paintY = 0;     // где (в координатах сугроба) верх картинки
        this.padX = 0;       // запас картинки слева/справа под свес снега
        this.pw = 1;         // размер картинки
        this.ph = 1;
        this.edge = EDGE_HEIGHT; // «высота» за краем окна (снег держится у края)
        this.resize(nbins);
    }

    get n() {
        return this.bins.length;
    }

    resize(nbins) {
        while (this.bins.length < nbins) {
            this.bins.push([]);
            this.heights.push(0);
            this.baseY.push(0);
        }
        this.bins.length = nbins;
        this.heights.length = nbins;
        this.baseY.length = nbins;
    }

    hasFloor(i) {
        return i >= 0 && i < this.n && this.baseY[i] !== Infinity;
    }

    neighbour(i) {
        if (i < 0 || i >= this.n)
            return this.isGround ? Infinity : this.edge;
        if (this.baseY[i] === Infinity)
            return EDGE_HEIGHT;
        return this.heights[i];
    }

    // Куда скатится снежинка, упавшая в столбик i. -1 — скатилась с края.
    findRest(i) {
        for (let iter = 0; iter < 8; iter++) {
            const h = this.heights[i];
            const l = this.neighbour(i - 1);
            const r = this.neighbour(i + 1);
            let target = null;
            let best = h - REPOSE;
            if (l < best) {
                best = l;
                target = i - 1;
            }
            if (r < best || (r === best && target !== null && Math.random() < 0.5)) {
                best = r;
                target = i + 1;
            }
            if (target === null)
                break;
            if (!this.hasFloor(target))
                return -1;
            i = target;
        }
        if (this.heights[i] >= this.cap)
            return -1;
        return i;
    }

    randomNonEmptyBin() {
        const n = this.n;
        if (this.count === 0 || n === 0)
            return -1;
        for (let t = 0; t < 8; t++) {
            const i = (Math.random() * n) | 0;
            if (this.bins[i].length)
                return i;
        }
        const start = (Math.random() * n) | 0;
        for (let k = 0; k < n; k++) {
            const i = (start + k) % n;
            if (this.bins[i].length)
                return i;
        }
        return -1;
    }
}

// путь контура сугроба на участке столбиков i..j (сглаженный, со свесами по краям окна)
function surfacePath(cr, surf, hs, i, j) {
    const n = surf.n;
    const base = k => surf.baseY[k];
    const isWin = !surf.isGround;
    const left = i * BIN, right = (j + 1) * BIN;
    const hl = hs[i], hr = hs[j];
    const ovL = isWin && i === 0 && hl > 4 ? Math.min(surf.padX - 2, hl * 0.45) : 0;
    const ovR = isWin && j === n - 1 && hr > 4 ? Math.min(surf.padX - 2, hr * 0.45) : 0;
    const lip = isWin ? Math.min(LIP, hl * 0.3) : 0;
    cr.newPath();
    if (ovL) {
        // снежная «шапка» свисает за край окна округлым комом
        cr.moveTo(left + 2, base(i) + lip);
        cr.curveTo(left - ovL * 0.6, base(i) + Math.min(hl * 0.35, 9),
            left - ovL * 1.25, base(i) - hl * 0.55, left + 1, base(i) - hl);
    } else {
        cr.moveTo(left, base(i) + lip);
        cr.lineTo(left, base(i) - hl);
    }
    // верх: квадратичное сглаживание по центрам столбиков
    const pts = [[left, base(i) - hl]];
    for (let k = i; k <= j; k++)
        pts.push([k * BIN + BIN / 2, base(k) - hs[k]]);
    pts.push([right, base(j) - hr]);
    let [sx, sy] = pts[0];
    for (let k = 1; k < pts.length - 1; k++) {
        const [cx, cy] = pts[k];
        const ex = (cx + pts[k + 1][0]) / 2, ey = (cy + pts[k + 1][1]) / 2;
        cr.curveTo(sx + (cx - sx) * 2 / 3, sy + (cy - sy) * 2 / 3, ex + (cx - ex) * 2 / 3, ey + (cy - ey) * 2 / 3, ex, ey);
        sx = ex;
        sy = ey;
    }
    cr.lineTo(right - (ovR ? 1 : 0), base(j) - hr);
    const lipR = isWin ? Math.min(LIP, hr * 0.3) : 0;
    if (ovR) {
        cr.curveTo(right + ovR * 1.25, base(j) - hr * 0.55,
            right + ovR * 0.6, base(j) + Math.min(hr * 0.35, 9), right - 2, base(j) + lipR);
    } else {
        cr.lineTo(right, base(j) + lipR);
    }
    // низ — вдоль опоры
    for (let k = j; k >= i; k--) {
        const l = isWin ? Math.min(LIP, hs[k] * 0.3) : 0;
        cr.lineTo(k * BIN + BIN / 2, base(k) + l);
    }
    cr.closePath();
}

/* Сугроб рисуется сплошной снежной массой: сглаженный контур по высотам
 * столбиков, объём градиентом, тень на окне. */
function paintSurface(surf, cr) {
    const n = surf.n;
    if (!surf.count || !n)
        return;
    cr.translate(surf.padX, -surf.paintY);
    // Широкое сглаживание: отдельная снежинка не торчит точкой, а растекается
    // по соседним столбикам — снег сразу ложится ровным слоем в сугроб.
    let hs = surf.heights.slice();
    for (let pass = 0; pass < 3; pass++) {
        const out = new Array(n);
        for (let k = 0; k < n; k++) {
            if (surf.baseY[k] === Infinity) {
                out[k] = 0;
                continue;
            }
            let sum = 0, w = 0;
            for (let d = -3; d <= 3; d++) {
                const m = k + d;
                if (m < 0 || m >= n || surf.baseY[m] === Infinity)
                    continue;
                sum += hs[m];
                w++;
            }
            out[k] = sum / w;
        }
        hs = out;
    }
    const segs = [];
    let i = 0;
    while (i < n) {
        if (surf.baseY[i] === Infinity || hs[i] <= 1.2) {
            i++;
            continue;
        }
        let j = i;
        while (j + 1 < n && surf.baseY[j + 1] !== Infinity && hs[j + 1] > 1.2)
            j++;
        segs.push([i, j]);
        i = j + 1;
    }
    let minBase = Infinity;
    for (let k = 0; k < n; k++)
        if (surf.baseY[k] !== Infinity)
            minBase = Math.min(minBase, surf.baseY[k]);
    const grad = new Cairo.LinearGradient(0, minBase - surf.cap, 0, minBase + LIP);
    grad.addColorStopRGBA(0, 1, 1, 1, 0.98);
    grad.addColorStopRGBA(0.6, 0.96, 0.975, 1, 0.97);
    grad.addColorStopRGBA(1, 0.78, 0.84, 0.95, 0.96);

    for (const [a, b] of segs) {
        // тень на окне под сугробом
        cr.save();
        cr.translate(0.5, 2.5);
        surfacePath(cr, surf, hs, a, b);
        cr.setSourceRGBA(0.08, 0.12, 0.28, 0.2);
        cr.fill();
        cr.restore();
        surfacePath(cr, surf, hs, a, b);
        cr.setSource(grad);
        cr.fillPreserve();
        cr.setSourceRGBA(0.62, 0.7, 0.88, 0.45);
        cr.setLineWidth(1);
        cr.stroke();
    }
}

function repaintSurface(surf, dpr) {
    const w = Math.max(1, Math.ceil(surf.pw * dpr)), h = Math.max(1, Math.ceil(surf.ph * dpr));
    if (!surf.canvas || surf.canvas.width !== w || surf.canvas.height !== h)
        surf.canvas = new OffscreenCanvas(w, h);
    const ctx = surf.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintSurface(surf, new Cairo.Context(ctx));
    surf.needsPaint = false;
}

class Snow {
    constructor(rt) {
        this.rt = rt;
        this.name = 'snow';
        this.s = rt.S.view('snow');
        this._running = false;
        this.s.on('enabled', () => this._syncEnabled());
        this._syncEnabled();
    }

    get running() {
        return this._running;
    }

    _syncEnabled() {
        if (this.s.get('enabled'))
            this.start();
        else
            this.stop();
    }

    action(name) {
        if (name === 'fill')
            this.fillDrifts();
        else if (name === 'shake')
            this.shakeAll();
        else if (name === 'clear')
            this.clearSnowmen();
    }

    start() {
        if (this._running)
            return;
        const rt = this.rt;
        this._running = true;
        this._ids = [];
        this._free = [];
        this._trackers = new Map();
        this._settledCount = 0;
        this._time = 0;
        this._flushT = 0;
        this._paused = false;
        this._stacks = new Set();
        this._roll = null;
        this._rollTrack = null;
        this._drag = null;
        this._rollFlushT = 0;
        this._acc = 0;

        this._tex = makeFlake(rt.dpr);
        // где показывать: поверх окон / только на пустом столе / под окнами
        this._fl = new FestiveLayer(rt, this.s, () => this._updatePaused());

        // настройки читаем не каждый кадр, а при изменении
        this._readCfg();
        this._ids.push(this.s.on('*', (v, key) => {
            if (key.startsWith('snow.'))
                this._readCfg();
        }));
        this._buildGround();
        this._dispId = rt.on('displays', () => this._buildGround());
        const on = (key, cb) => this._ids.push(this.s.on(key, cb));
        on('flake-count', () => this._syncFlakeCount(false));
        on('hide-in-fullscreen', () => this._updatePaused());
        on('settle-on-windows', () => {
            if (!this.s.get('settle-on-windows'))
                this.shakeAll();
        });
        on('settle-on-ground', () => {
            if (!this.s.get('settle-on-ground'))
                this._meltSurface(this._ground, this._ground.count);
        });
        on('drift-height', () => {
            for (const t of this._trackers.values())
                this._layoutPainter(t);
        });
        on('snowballs', () => {
            if (!this._cfg.snowballs)
                this.clearSnowmen();
        });

        this._syncFlakeCount(true);
        this._updatePaused();

        // Для других эффектов: сани Деда Мороза врезаются в снежный
        // шар/снеговика внизу экрана — шар разлетается.
        this._groundApi = {
            heightAt: (x0, x1) => this._groundHeight(x0, x1),
            blast: (x0, x1, dir) => this._blastGround(x0, x1, dir),
            hitBall: (x0, x1, dir) => this._hitBall(x0, x1, dir),
        };
        rt.festiveGround = this._groundApi;
        rt.redraw();
    }

    stop() {
        if (!this._running)
            return;
        const rt = this.rt;
        this._running = false;
        if (rt.festiveGround === this._groundApi)
            rt.festiveGround = null;
        for (const id of this._ids)
            this.s.off(id);
        this._ids = [];
        rt.off(this._dispId);
        this._endDrag(false);
        this._roll = null;
        for (const st of [...this._stacks])
            this._destroyStack(st);
        this._trackers.clear();
        this._fl.destroy();
        this._fl = null;
        this._free = [];
        this._ground = null;
        rt.redraw();
    }

    _groundHeight(x0, x1) {
        const g = this._ground;
        if (!this._running || this._paused || !g || !g.count)
            return 0;
        const b0 = Math.max(0, Math.floor(Math.min(x0, x1) / BIN));
        const b1 = Math.min(g.n - 1, Math.floor(Math.max(x0, x1) / BIN));
        let h = 0;
        for (let i = b0; i <= b1; i++)
            h = Math.max(h, g.heights[i]);
        return h;
    }

    // Есть ли внизу экрана снежок/снеговик в полосе x0..x1? Если да — он
    // разлетается от удара, а функция возвращает true.
    _hitBall(x0, x1, dir) {
        if (!this._running || this._paused || !this._stacks)
            return false;
        const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
        for (const st of this._stacks) {
            if (st.owner || (st.state !== 'rest' && st.state !== 'roll'))
                continue;
            const r = st.geo.c[0].r;
            const g = this._ground;
            const b = Math.floor(st.x / BIN);
            // только те, что стоят на земле (не висят в воздухе над окном)
            if (!g.hasFloor(b) || st.y < g.baseY[b] - GROUND_CAP - 4)
                continue;
            if (st.x + r < lo || st.x - r > hi)
                continue;
            this._shatter(st, dir);
            return true;
        }
        return false;
    }

    // шар (или снеговик) разлетается на снежные комья
    _shatter(st, dir) {
        const [sx, sy] = this._screenOf(st);
        const now = this._time;
        for (const c of st.geo.c) {
            const n = Math.max(14, Math.min(70, Math.round(c.r * 1.8)));
            for (let k = 0; k < n; k++) {
                const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * c.r;
                const size = 3 + Math.random() * 8;
                const f = this._flakeProps(size);
                f.opacity = 235;
                f.x = sx + Math.cos(a) * d;
                f.y = sy + c.y + Math.sin(a) * d;
                // комья летят вперёд по ходу саней и вверх, во все стороны от центра
                f.vx = dir * (40 + Math.random() * 280) + Math.cos(a) * 160;
                f.vy = -(120 + Math.random() * 420) + Math.sin(a) * 90;
                f.k = 1.0 + Math.random() * 0.8;
                f.ignoreUntil = now;
                this._free.push(f);
            }
        }
        this._destroyStack(st);
    }

    // сугроб разлетается вверх и вперёд
    _blastGround(x0, x1, dir) {
        const g = this._ground;
        if (!this._running || !g)
            return;
        const b0 = Math.max(0, Math.floor(Math.min(x0, x1) / BIN));
        const b1 = Math.min(g.n - 1, Math.floor(Math.max(x0, x1) / BIN));
        for (let i = b0; i <= b1; i++) {
            if (!g.bins[i].length)
                continue;
            this._releaseFrom(g, i, 0, {
                vx: dir * (60 + Math.random() * 320),
                vy: -(220 + Math.random() * 520),
                k: 0.9 + Math.random() * 0.8,
                jitter: 160,
            }, null, false);
        }
        this._flushSurface(g);
    }

    _readCfg() {
        const s = this.s;
        this._cfg = {
            count: s.get('flake-count'),
            maxSettled: s.get('max-settled'),
            settleWin: s.get('settle-on-windows'),
            settleGround: s.get('settle-on-ground'),
            wind: s.get('wind'),
            meltTime: s.get('melt-time'),
            sens: s.get('shake-sensitivity'),
            driftH: s.get('drift-height'),
            // сколько «высоты» даёт одна осевшая снежинка: больше — сугробы плотнее и быстрее
            acc: 0.4 + s.get('drift-accumulation') * 0.5,
            snowballs: s.get('snowballs'),
            fps: s.get('fps'),
            hideFs: s.get('hide-in-fullscreen'),
        };
    }

    _updatePaused() {
        const fullscreen = this._cfg.hideFs && this.rt.anyFullscreen();
        // в режиме «только на пустом столе» при открытых окнах снег на паузе
        const paused = fullscreen || (this._fl && !this._fl.shown && !this._fl.visible);
        if (paused !== this._paused) {
            this._paused = paused;
            this.rt.redraw();
        }
        for (const t of this._trackers.values())
            this._syncTrackerVisibility(t);
        if (this._paused) {
            this._endDrag(false);
            this._stopRoll();
        }
    }

    // ---------- земля (низ экрана — верхний край панели задач) ----------

    _buildGround() {
        if (this._ground)
            this._settledCount -= this._ground.count;
        const rt = this.rt;
        const W = rt.W, H = rt.H;
        this._W = W;
        this._H = H;
        const n = Math.ceil(W / BIN);
        const g = new Surface(n, GROUND_CAP, true);
        let minBottom = Infinity, maxBottom = 0;
        for (let i = 0; i < n; i++) {
            const cx = i * BIN + BIN / 2;
            let y = Infinity;
            for (const d of rt.displays) {
                const b = d.bounds;
                if (cx >= b.x && cx < b.x + b.width) {
                    const bottom = d.work.y + d.work.height;
                    y = y === Infinity ? bottom : Math.max(y, bottom);
                }
            }
            g.baseY[i] = y;
            if (y !== Infinity) {
                minBottom = Math.min(minBottom, y);
                maxBottom = Math.max(maxBottom, y);
            }
        }
        if (minBottom === Infinity)
            minBottom = maxBottom = H;
        g.paintY = minBottom - GROUND_CAP - 14;
        g.pw = W;
        g.ph = maxBottom - g.paintY + 2;
        this._ground = g;
        // раскидать уже падающие снежинки по новой ширине экрана
        if (this._free) {
            for (const f of this._free)
                if (f.k === f.k0)
                    this._respawn(f, true);
        }
        // стопки внизу экрана встанут на новую землю
        for (const st of this._stacks || []) {
            if (!st.owner && st.state === 'rest')
                this._settleStack(st);
        }
    }

    // ---------- снежинки ----------

    _flakeProps(size) {
        const k0 = GRAVITY / (35 + size * 9);
        return {
            size, k0, k: k0,
            x: 0, y: 0, vx: 0, vy: 0,
            phase: Math.random() * Math.PI * 2,
            swayAmp: 8 + Math.random() * 22,
            swayFreq: 0.4 + Math.random() * 1.2,
            grip: 0.5 + Math.random() * 2.5,
            h: size * 0.42 * this._cfg.acc,
            delay: 0,
            opacity: 230,
            ignoreWin: null, ignoreUntil: 0,
        };
    }

    _newFlake(initial) {
        const r = Math.random();
        const size = 3 + r * r * 7;
        const f = this._flakeProps(size);
        f.opacity = Math.round(140 + (size - 3) / 7 * 115);
        this._respawn(f, initial);
        this._free.push(f);
        return f;
    }

    _respawn(f, initial) {
        const wind = this._cfg.wind;
        const margin = Math.min(400, Math.abs(wind) * 12) + 40;
        f.x = -margin + Math.random() * (this._W + 2 * margin);
        f.y = initial ? Math.random() * this._H : -10 - Math.random() * 60;
        f.k = f.k0;
        f.vx = 0;
        f.vy = GRAVITY / f.k;
        f.delay = 0;
        f.ignoreWin = null;
    }

    _syncFlakeCount(initial) {
        const target = this._cfg.count;
        while (this._free.length < target)
            this._newFlake(initial);
        while (this._free.length > target)
            this._free.pop();
    }

    // ---------- окна ----------

    // окна сверху вниз по Z-порядку (видимые, не свёрнутые)
    _collectWindows() {
        return this.rt.wins.map(w => ({ win: w.id, x: w.x, y: w.y, w: w.w, h: w.h, surface: w.surface }));
    }

    _getTracker(info) {
        let t = this._trackers.get(info.win);
        if (t)
            return t;
        const surf = new Surface(Math.ceil(info.w / BIN), this._cfg.driftH, false);
        surf.ox = info.x;
        surf.oy = info.y;
        t = {
            win: info.win,
            surf,
            px: info.x, py: info.y, width: info.w,
            vx: 0, vy: 0,
            emptySince: 0,
            visible: true,
            winVisible: true,
            wasMin: false,
            destroyed: false,
        };
        this._trackers.set(info.win, t);
        this._layoutPainter(t);
        return t;
    }

    // размер картинки сугроба окна: высота сугроба + запас под свес по бокам
    _layoutPainter(t) {
        const s = t.surf;
        const cap = this._cfg.driftH;
        s.cap = cap;
        s.edge = cap * 0.55;
        s.padX = Math.ceil(cap * 0.5) + 4;
        s.paintY = -(cap + 14);
        s.pw = t.width + 2 * s.padX;
        s.ph = cap + 14 + LIP + 4;
        s.needsPaint = true;
    }

    /* Окна в GNOME присылали сигналы (сдвинулось, свернулось, закрылось),
     * здесь — сверяемся со списком окон каждый кадр: сугроб едет за окном
     * без задержки, а со свёрнутого или закрытого окна снег осыпается. */
    _syncTrackers() {
        for (const t of [...this._trackers.values()]) {
            if (t.destroyed)
                continue;
            const w = this.rt.allWins.get(t.win);
            if (!w) {
                // окно закрыли (или спрятали) — снег осыпается, а не пропадает
                this._dropAll(t, 0, 0);
                this._destroyTracker(t);
                continue;
            }
            if (w.min && !t.wasMin)
                this._dropAll(t, 0, 0);
            t.wasMin = w.min;
            t.winVisible = !w.min && !w.cloaked;
            this._syncTrackerVisibility(t);
            if (!w.min && (w.x !== t.surf.ox || w.y !== t.surf.oy)) {
                t.surf.ox = w.x;
                t.surf.oy = w.y;
                this.rt.redraw('top');
            }
        }
    }

    _syncTrackerVisibility(t) {
        const v = !this._paused && t.winVisible;
        if (t.visible !== v) {
            t.visible = v;
            this.rt.redraw('top');
        }
    }

    _destroyTracker(t) {
        if (t.destroyed)
            return;
        // снежки и снеговики с этого окна падают вниз
        this._dropStacks(t, 0, 0);
        t.destroyed = true;
        this._settledCount -= t.surf.count;
        t.surf.count = 0;
        this._trackers.delete(t.win);
        this.rt.redraw('top');
    }

    _resizeTracker(t, width) {
        const n = Math.ceil(width / BIN);
        const s = t.surf;
        for (let i = n; i < s.n; i++)
            if (s.bins[i].length)
                this._releaseFrom(s, i, 0, { vx: 0, vy: 0, k: 0.8 }, t.win, false);
        s.resize(n);
        t.width = width;
        this._layoutPainter(t);
        this._flushSurface(s);
        for (const st of this._stacks) {
            if (st.owner === t && st.state === 'rest' && st.x > width)
                this._fallStack(st, 0, 0);
        }
    }

    _updateTracker(t, dt) {
        const w = this.rt.allWins.get(t.win);
        if (!w)
            return;
        this._syncTrackerVisibility(t);
        if (Math.round(w.w) !== Math.round(t.width) && !w.min)
            this._resizeTracker(t, w.w);
        const dx = w.x - t.px;
        const dy = w.y - t.py;
        t.px = w.x;
        t.py = w.y;
        if (!t.visible) {
            t.vx = t.vy = 0;
            return;
        }
        if (Math.abs(dx) + Math.abs(dy) > TELEPORT) {
            // развернули/перекинули на другой монитор: снег не удержался
            this._dropAll(t, 0, 0);
            t.vx = t.vy = 0;
            return;
        }
        const pvx = t.vx, pvy = t.vy;
        // сглаживаем скорость — движения мыши приходят неравномерно
        const vx = pvx + (dx / dt - pvx) * 0.6;
        const vy = pvy + (dy / dt - pvy) * 0.6;
        t.vx = vx;
        t.vy = vy;
        const ax = (vx - pvx) / dt;
        const ay = (vy - pvy) / dt;
        // Снег держится трением: срывает горизонтальное ускорение и
        // ускорение окна вниз (окно «уходит из-под» снега).
        const a = Math.hypot(ax, Math.max(0, ay));
        const gripBase = 6000 * Math.pow(2, (5 - this._cfg.sens) / 2);
        const cap = v => Math.max(-1500, Math.min(1500, v));
        // снеговики стоят крепче снега, но сильную тряску не выдерживают
        if (a > gripBase * 2.2)
            this._dropStacks(t, cap(pvx) * 0.6, cap(pvy) * 0.6 - 80);
        if (a < gripBase * 0.5 || t.surf.count === 0)
            return;
        const s = t.surf;
        let released = false;
        // срывается кусками: соседние столбики — одним комом
        let chunk = null, chunkLeft = 0;
        for (let i = 0; i < s.n; i++) {
            if (chunkLeft-- <= 0) {
                chunkLeft = 2 + ((Math.random() * 5) | 0);
                chunk = {
                    vx: cap(pvx) + (Math.random() - 0.5) * 120,
                    vy: cap(pvy) - Math.random() * 60,
                    k: 0.45 + Math.random() * 0.8,
                    jitter: 25,
                };
            }
            const stack = s.bins[i];
            for (let k = 0; k < stack.length; k++) {
                if (stack[k].grip * gripBase < a) {
                    this._releaseFrom(s, i, k, chunk, t.win, false);
                    released = true;
                    break;
                }
            }
        }
        if (released)
            this._flushSurface(s);
    }

    // ---------- осевший снег ----------

    _flushSurface(surf) {
        surf.dirty = false;
        surf.needsPaint = true;
        this.rt.redraw();
    }

    _settle(f, surf, i, idx) {
        const hBefore = surf.heights[i];
        const lx = i * BIN + Math.random() * BIN;
        const cy = surf.baseY[i] - hBefore - f.size * 0.65 + f.size / 2;
        surf.bins[i].push({ size: f.size, h: f.h, x: lx, y: cy, grip: f.grip, a: (f.opacity ?? 230) / 255 });
        surf.heights[i] += f.h;
        surf.count++;
        surf.dirty = true;
        this._settledCount++;

        // убираем из падающих (swap-remove) и выпускаем новую сверху
        const last = this._free.pop();
        if (last !== f)
            this._free[idx] = last;
        if (this._free.length < this._cfg.count)
            this._newFlake(false);
    }

    /* Отпускает снежинки столбика i начиная с k-й (и всё, что выше).
     * opts: {vx, vy, k, delay, jitter} — общий «ком» для соседних столбиков. */
    _releaseFrom(surf, i, k, opts, ignoreWin, flush = true) {
        const stack = surf.bins[i];
        if (k >= stack.length)
            return;
        const removed = stack.splice(k);
        const now = this._time;
        const jit = opts.jitter ?? 20;
        for (const d of removed) {
            surf.heights[i] -= d.h;
            surf.count--;
            this._settledCount--;
            const f = this._flakeProps(d.size);
            f.opacity = Math.round(d.a * 255);
            f.x = surf.ox + d.x;
            f.y = surf.oy + d.y;
            f.vx = opts.vx + (Math.random() - 0.5) * jit;
            f.vy = opts.vy - Math.random() * jit * 0.6;
            f.k = (opts.k ?? 0.8) * (0.85 + Math.random() * 0.3);
            f.delay = (opts.delay ?? 0) + Math.random() * 0.04;
            f.ignoreWin = ignoreWin;
            f.ignoreUntil = now + 0.8 + f.delay;
            this._free.push(f);
        }
        if (surf.heights[i] < 0.01)
            surf.heights[i] = 0;
        surf.dirty = true;
        if (flush)
            this._flushSurface(surf);
    }

    /* Окно закрыли/свернули/развернули: снег срывается кусками, не ровной
     * простынёй — у каждого куска свои скорость, тяжесть и задержка. */
    _dropAll(t, vx, vy) {
        if (t.destroyed)
            return;
        this._dropStacks(t, vx, vy);
        const s = t.surf;
        let i = 0;
        while (i < s.n) {
            const len = 2 + ((Math.random() * 6) | 0);
            const chunk = {
                vx: vx + (Math.random() - 0.5) * 160,
                vy: vy + Math.random() * 90,
                k: 0.35 + Math.random() * 0.75,
                delay: Math.random() * 0.28,
                jitter: 18,
            };
            for (let j = i; j < Math.min(s.n, i + len); j++) {
                if (s.bins[j].length)
                    this._releaseFrom(s, j, 0, chunk, t.win, false);
            }
            i += len;
        }
        this._flushSurface(s);
    }

    shakeAll() {
        if (!this._running)
            return;
        for (const t of this._trackers.values())
            this._dropAll(t, (Math.random() - 0.5) * 200, -80);
        this._meltSurface(this._ground, this._ground.count);
        this._flushSurface(this._ground);
    }

    _meltSurface(surf, n) {
        for (let m = 0; m < n; m++) {
            const i = surf.randomNonEmptyBin();
            if (i < 0)
                break;
            const d = surf.bins[i].pop();
            surf.heights[i] -= d.h;
            if (surf.heights[i] < 0.01)
                surf.heights[i] = 0;
            surf.count--;
            this._settledCount--;
            surf.dirty = true;
        }
    }

    _meltTick(dt) {
        const meltTime = this._cfg.meltTime;
        const surfaces = [this._ground];
        for (const t of this._trackers.values())
            surfaces.push(t.surf);
        for (const s of surfaces) {
            if (!s.count)
                continue;
            const expected = s.count * dt / meltTime;
            const n = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
            if (n)
                this._meltSurface(s, n);
        }
        // Перебор лимита — тает быстрее, но в первую очередь нижний сугроб:
        // маленькие сугробы на окнах иначе «съедались» бы так же быстро.
        let over = Math.min(40, this._settledCount - this._cfg.maxSettled);
        if (over > 0) {
            const take = Math.min(over, this._ground.count);
            this._meltSurface(this._ground, take);
            over -= take;
            if (over > 0) {
                const biggest = surfaces.reduce((m, x) => (x.count > m.count ? x : m), surfaces[0]);
                this._meltSurface(biggest, over);
            }
        }
        return surfaces;
    }

    _applyObstacles(obstacles, dt) {
        // Падающий снег сани не трогают (он идёт за упряжкой, не поверх неё),
        // а сугроб под санями выбрасывается назад и вверх — из-под полозьев.
        const ground = this._ground;
        for (const o of obstacles) {
            if (!ground || !ground.count)
                continue;
            const dir = Math.sign(o.vx) || 1;
            const b0 = Math.max(0, Math.floor(o.x / BIN));
            const b1 = Math.min(ground.n - 1, Math.floor((o.x + o.w) / BIN));
            if (b1 < b0)
                continue;
            const budget0 = Math.ceil(300 * dt);
            let budget = budget0;
            for (let tries = 0; tries < budget0 * 4 && budget > 0; tries++) {
                const i = b0 + ((Math.random() * (b1 - b0 + 1)) | 0);
                const stack = ground.bins[i];
                if (!stack.length)
                    continue;
                this._releaseFrom(ground, i, stack.length - 1, {
                    vx: -dir * (50 + Math.random() * 200),
                    vy: -(120 + Math.random() * 240),
                    k: 1.2 + Math.random(),
                    jitter: 20,
                }, null, false);
                budget--;
            }
            ground.dirty = true;
        }
    }

    // ---------- кадр ----------

    tick(now, dt) {
        if (!this._running)
            return;
        this._updatePaused();
        this._syncTrackers();
        if (this._drag)
            this.rt.redraw('top');
        // в настройках больше 30 кадров/с — просим рантайм крутиться быстрее
        if (this._cfg.fps > 31 && !this._paused)
            this.rt.fast();
        this._acc += dt;
        const step = 1 / Math.max(10, this._cfg.fps);
        if (this._acc < step * 0.95)
            return;
        let fdt = this._acc;
        this._acc = 0;
        if (this._paused || fdt <= 0)
            return;
        // «снег идёт» — для других эффектов (ёлка копит снег на ветках)
        this.rt.snowStamp = now;
        if (fdt > 0.1)
            fdt = 0.1;
        this._tick(fdt);
        this.rt.redraw(this._fl.layer);
        if (this._trackers.size)
            this.rt.redraw('top');
    }

    _tick(dt) {
        this._time += dt;
        const now = this._time;
        const cfg = this._cfg;

        for (const t of [...this._trackers.values()]) {
            if (t.destroyed)
                continue;
            this._updateTracker(t, dt);
            if (t.surf.count === 0 && !this._hasStacks(t)) {
                if (!t.emptySince)
                    t.emptySince = now;
                else if (now - t.emptySince > 4)
                    this._destroyTracker(t);
            } else {
                t.emptySince = 0;
            }
        }

        // Сани Деда Мороза кладут сюда свои прямоугольники {x, y, w, h, vx}:
        // снег под ними взметается.
        const obstacles = this.rt.obstacles;
        if (obstacles && obstacles.size)
            this._applyObstacles(obstacles, dt);

        const canSettle = cfg.maxSettled > 0;
        let allWins = null;
        const getWins = () => allWins || (allWins = this._collectWindows());
        const wins = canSettle && cfg.settleWin ? getWins() : [];
        const ground = this._ground;
        const gust = cfg.wind + Math.sin(now * 0.11) * (6 + Math.abs(cfg.wind) * 0.5) +
            Math.sin(now * 0.37 + 1.3) * 4;
        const target = cfg.count;
        const W = this._W, H = this._H;

        const free = this._free;
        for (let idx = free.length - 1; idx >= 0; idx--) {
            const f = free[idx];
            if (f.delay > 0) {
                // кусок ещё держится — срывается чуть позже соседних
                f.delay -= dt;
                continue;
            }
            const prevY = f.y;
            const decay = Math.exp(-f.k * dt);
            const windX = gust + f.swayAmp * Math.sin(now * f.swayFreq + f.phase);
            f.vx = windX + (f.vx - windX) * decay;
            const vt = GRAVITY / f.k;
            f.vy = vt + (f.vy - vt) * decay;
            f.x += f.vx * dt;
            f.y += f.vy * dt;

            let settled = false;
            if (f.vy > 0 && canSettle) {
                // окна — сверху вниз по стеку
                for (let j = 0; j < wins.length && !settled; j++) {
                    const w = wins[j];
                    if (f.x < w.x || f.x >= w.x + w.w)
                        continue;
                    if (!w.surface || (f.ignoreWin === w.win && now < f.ignoreUntil))
                        continue;
                    const t = this._trackers.get(w.win);
                    const bin = Math.floor((f.x - w.x) / BIN);
                    const surfY = w.y - (t && bin < t.surf.n ? t.surf.heights[bin] : 0);
                    if (!(prevY < surfY && f.y >= surfY))
                        continue;
                    let occluded = false;
                    for (let m = 0; m < j; m++) {
                        const o = wins[m];
                        if (f.x >= o.x && f.x < o.x + o.w && surfY >= o.y && surfY < o.y + o.h) {
                            occluded = true;
                            break;
                        }
                    }
                    if (occluded)
                        continue;
                    const tr = t || this._getTracker(w);
                    const rest = bin < tr.surf.n ? tr.surf.findRest(bin) : -1;
                    if (rest >= 0) {
                        this._settle(f, tr.surf, rest, idx);
                        settled = true;
                    } else {
                        // скатилась с края — летит дальше
                        f.ignoreWin = w.win;
                        f.ignoreUntil = now + 1;
                        f.vx += (bin < tr.surf.n / 2 ? -1 : 1) * 30;
                    }
                    break;
                }
                if (!settled && cfg.settleGround) {
                    const bin = Math.floor(f.x / BIN);
                    if (ground.hasFloor(bin) && f.y >= ground.baseY[bin] - ground.heights[bin] &&
                        prevY < ground.baseY[bin]) {
                        const rest = ground.findRest(bin);
                        if (rest >= 0) {
                            this._settle(f, ground, rest, idx);
                            settled = true;
                        }
                    }
                }
            }
            if (settled)
                continue;

            if (f.y > H + 20 || f.x < -500 || f.x > W + 500) {
                if (free.length > target) {
                    const last = free.pop();
                    if (last !== f)
                        free[idx] = last;
                } else {
                    this._respawn(f, false);
                }
            }
        }

        // снежки: катание курсором, падение, складывание в снеговиков
        if (cfg.snowballs)
            this._tickRoll(dt, getWins);
        if (this._stacks.size)
            this._tickStacks(dt, getWins);

        const surfaces = this._meltTick(dt);
        // сугроб под катящимся снежком перерисовываем чаще — видно колею
        if (this._roll) {
            this._rollFlushT += dt;
            const rs = this._roll.surf;
            if (this._rollFlushT >= 0.08 && rs.dirty) {
                this._rollFlushT = 0;
                this._flushSurface(rs);
            }
        }
        // перерисовка сугробов — не чаще 4 раз в секунду
        this._flushT += dt;
        if (this._flushT >= FLUSH_INTERVAL) {
            this._flushT = 0;
            for (const s of surfaces) {
                if (s.dirty)
                    this._flushSurface(s);
            }
            for (const st of this._stacks) {
                if (st.state === 'rest')
                    this._settleStack(st);
            }
        }
    }

    // ---------- сугробы «по кнопке» ----------

    // Сразу насыпать плотные сугробы на видимые окна и внизу экрана.
    fillDrifts() {
        if (!this._running || this._paused)
            return;
        const cfg = this._cfg;
        const fill = (surf, target) => {
            const phase = Math.random() * 10;
            for (let i = 0; i < surf.n; i++) {
                if (surf.baseY[i] === Infinity)
                    continue;
                const wave = 0.72 + 0.16 * Math.sin(i * 0.11 + phase) + 0.1 * Math.sin(i * 0.37 + phase * 2);
                let goal = target * wave;
                // у краёв окна — скругление, как у настоящей снежной шапки
                if (!surf.isGround) {
                    const d = Math.min(i, surf.n - 1 - i);
                    goal = Math.min(goal, surf.edge + d * REPOSE * 0.8);
                }
                while (surf.heights[i] < goal) {
                    const size = 3 + Math.random() * 6;
                    const hgt = size * 0.42 * cfg.acc;
                    const x = i * BIN + Math.random() * BIN;
                    surf.bins[i].push({
                        size, h: hgt, x,
                        y: surf.baseY[i] - surf.heights[i] - size * 0.15,
                        grip: 0.5 + Math.random() * 2.5,
                        a: 0.9,
                    });
                    surf.heights[i] += hgt;
                    surf.count++;
                    this._settledCount++;
                }
            }
            surf.dirty = true;
            this._flushSurface(surf);
        };
        if (cfg.settleWin) {
            for (const w of this._collectWindows()) {
                if (w.surface)
                    fill(this._getTracker(w).surf, cfg.driftH * 0.9);
            }
        }
        if (cfg.settleGround)
            fill(this._ground, GROUND_CAP * 0.6);
    }

    // ---------- снежки и снеговики ----------

    _hasStacks(t) {
        for (const st of this._stacks) {
            if (st.owner === t)
                return true;
        }
        return false;
    }

    _screenOf(st) {
        return st.owner ? [st.owner.surf.ox + st.x, st.owner.surf.oy + st.y] : [st.x, st.y];
    }

    _newStack(balls, owner, x, y, force = false) {
        // лимит: тает самый старый одиночный снежок
        if (this._stacks.size >= MAX_STACKS && !force) {
            let oldest = null;
            for (const st of this._stacks) {
                if (st.balls.length === 1 && st.state === 'rest' && (!oldest || st.born < oldest.born))
                    oldest = st;
            }
            if (!oldest)
                return null;
            this._destroyStack(oldest);
        }
        const st = {
            balls, owner, x, y,
            vx: 0, vy: 0,
            state: 'rest',
            seed: (Math.random() * 0x7fffffff) | 0,
            born: this._time,
            ignoreWin: null, ignoreStack: null, ignoreUntil: 0,
            sx: 1, sy: 1,
            canvas: null, needsPaint: true,
        };
        this._stacks.add(st);
        this._relayoutStack(st);
        return st;
    }

    _relayoutStack(st) {
        st.geo = Snowman.layout(st.balls);
        st.needsPaint = true;
        this.rt.redraw();
    }

    _destroyStack(st) {
        if (!this._stacks.has(st))
            return;
        this._stacks.delete(st);
        if (this._roll && this._roll.stack === st)
            this._roll = null;
        this.rt.removeTweens(st);
        this.rt.redraw();
    }

    // переносит стопку к другому владельцу (окно или экран) без скачка на экране
    _reparentStack(st, owner) {
        const [sx, sy] = this._screenOf(st);
        st.owner = owner;
        st.x = owner ? sx - owner.surf.ox : sx;
        st.y = owner ? sy - owner.surf.oy : sy;
    }

    _fallStack(st, vx, vy) {
        if (this._roll && this._roll.stack === st)
            this._roll = null;
        const win = st.owner ? st.owner.win : null;
        if (st.owner)
            this._reparentStack(st, null);
        st.state = 'fall';
        st.vx = vx;
        st.vy = vy;
        st.ignoreWin = win;
        st.ignoreUntil = this._time + 0.6;
    }

    _dropStacks(t, vx, vy) {
        for (const st of [...this._stacks]) {
            if (st.owner === t && st.state !== 'drag')
                this._fallStack(st, vx + (Math.random() - 0.5) * 60, vy);
        }
    }

    clearSnowmen() {
        if (!this._running)
            return;
        this._endDrag(false);
        this._roll = null;
        for (const st of [...this._stacks])
            this._destroyStack(st);
    }

    // стопка в покое: оседает вместе со снегом под ней, у края окна — падает
    _settleStack(st) {
        let surf, base;
        const lx = st.x;
        if (st.owner) {
            surf = st.owner.surf;
            base = 0;
            if (lx < 0 || lx >= st.owner.width) {
                this._fallStack(st, 0, 0);
                return;
            }
        } else {
            surf = this._ground;
            const b = Math.floor(lx / BIN);
            if (!surf.hasFloor(b)) {
                this._fallStack(st, 0, 0);
                return;
            }
            base = surf.baseY[b];
        }
        const y = base - this._snowUnder(surf, lx, st.balls[0].r) * 0.55;
        if (Math.abs(y - st.y) >= 0.5) {
            st.y = y;
            this.rt.redraw();
        }
    }

    // высота снега под серединой шара (берём меньшую — шар проседает в колею)
    _snowUnder(surf, x, r) {
        const b0 = Math.max(0, Math.floor((x - r * 0.35) / BIN));
        const b1 = Math.min(surf.n - 1, Math.floor((x + r * 0.35) / BIN));
        let h = Infinity;
        for (let i = b0; i <= b1; i++)
            h = Math.min(h, surf.heights[i]);
        return h === Infinity ? 0 : h;
    }

    _land(st, owner) {
        this._reparentStack(st, owner);
        st.state = 'rest';
        st.vx = st.vy = 0;
        this._settleStack(st);
        if (st.state !== 'rest')
            return;
        this.rt.removeTweens(st);
        st.sx = 1.08;
        st.sy = 0.9;
        this.rt.tween(st, { sx: 1, sy: 1 }, 260, 'outBack');
    }

    _merge(st, onto) {
        onto.balls.push(...st.balls.map(b => ({ r: b.r, angle: 0 })));
        // снизу — самый большой ком
        onto.balls.sort((a, b) => b.r - a.r);
        this._destroyStack(st);
        this._relayoutStack(onto);
        this.rt.removeTweens(onto);
        onto.sx = 1.12;
        onto.sy = 0.9;
        this.rt.tween(onto, { sx: 1, sy: 1 }, 380, 'outElastic');
    }

    _tickStacks(dt, getWins) {
        const now = this._time;
        const H = this._H;
        for (const st of [...this._stacks]) {
            if (st.state !== 'fall')
                continue;
            const prev = st.y;
            st.vy = Math.min(st.vy + BALL_GRAVITY * dt, 1800);
            st.vx *= Math.exp(-0.6 * dt);
            st.x += st.vx * dt;
            st.y += st.vy * dt;
            // края экрана отражают (снежок не улетает за экран)
            const br = st.geo.c[0].r;
            if (st.x < br && st.vx < 0) {
                st.x = br;
                st.vx = -st.vx * 0.35;
            } else if (st.x > this._W - br && st.vx > 0) {
                st.x = this._W - br;
                st.vx = -st.vx * 0.35;
            }
            let landed = false;
            if (st.vy > 0) {
                // на другой снежок/снеговика — складываем
                for (const o of this._stacks) {
                    if (o === st || o.state !== 'rest' || (o === st.ignoreStack && now < st.ignoreUntil))
                        continue;
                    const [ox, oy] = this._screenOf(o);
                    const topR = o.geo.c[o.geo.c.length - 1].r;
                    const topY = oy + o.geo.stackTop + topR * 0.35;
                    if (Math.abs(st.x - ox) > topR * 0.9 + st.balls[0].r * 0.35)
                        continue;
                    if (!(prev <= topY && st.y >= topY))
                        continue;
                    if (o.balls.length + st.balls.length <= Snowman.MAX_BALLS) {
                        this._merge(st, o);
                        landed = true;
                    } else {
                        // больше пяти шаров не бывает — скатывается вбок
                        st.vx = (st.x >= ox ? 1 : -1) * 160;
                        st.vy = -140;
                        st.ignoreStack = o;
                        st.ignoreUntil = now + 0.7;
                    }
                    break;
                }
                if (landed)
                    continue;
                const wins = getWins();
                for (let j = 0; j < wins.length && !landed; j++) {
                    const w = wins[j];
                    if (st.x < w.x || st.x >= w.x + w.w)
                        continue;
                    if (st.ignoreWin === w.win && now < st.ignoreUntil)
                        continue;
                    // внутрь окна (сквозь заголовок) — не проваливаемся, но и не цепляемся
                    if (!w.surface)
                        continue;
                    const t = this._trackers.get(w.win);
                    const bin = Math.floor((st.x - w.x) / BIN);
                    const surfY = w.y - (t && bin < t.surf.n ? t.surf.heights[bin] * 0.55 : 0);
                    if (!(prev <= surfY && st.y >= surfY))
                        continue;
                    let occluded = false;
                    for (let m = 0; m < j; m++) {
                        const o = wins[m];
                        if (st.x >= o.x && st.x < o.x + o.w && surfY >= o.y && surfY < o.y + o.h) {
                            occluded = true;
                            break;
                        }
                    }
                    if (occluded)
                        continue;
                    this._land(st, t || this._getTracker(w));
                    landed = true;
                }
                if (landed)
                    continue;
                const g = this._ground;
                const bin = Math.floor(st.x / BIN);
                if (g.hasFloor(bin) && st.y >= g.baseY[bin] - g.heights[bin] * 0.55) {
                    this._land(st, null);
                    continue;
                }
            }
            if (st.y > H + 300 || st.x < -300 || st.x > this._W + 300)
                this._destroyStack(st);
        }
    }

    // ---------- катание снежка курсором ----------

    // сугроб под курсором: {surf, owner, lx, base} или null
    _driftAt(px, py, getWins) {
        const wins = getWins();
        const above = this._fl.mode === 'above';
        for (let j = 0; j < wins.length; j++) {
            const w = wins[j];
            if (px < w.x || px >= w.x + w.w)
                continue;
            if (py >= w.y && py < w.y + w.h) {
                // курсор над окном: сугроб внизу экрана виден только в режиме «поверх окон»
                if (!above)
                    return null;
                break;
            }
            if (!w.surface)
                continue;
            const t = this._trackers.get(w.win);
            if (!t || !t.visible)
                continue;
            const lx = px - w.x;
            const bin = Math.floor(lx / BIN);
            if (bin >= t.surf.n)
                continue;
            const h = Math.max(t.surf.heights[bin], 6);
            if (py >= w.y - h - 6 && py <= w.y + 2)
                return { surf: t.surf, owner: t, lx, base: 0, h: t.surf.heights[bin] };
        }
        const g = this._ground;
        const bin = Math.floor(px / BIN);
        if (!g.hasFloor(bin))
            return null;
        const h = Math.max(g.heights[bin], 6);
        if (py >= g.baseY[bin] - h - 6 && py <= g.baseY[bin] + 4)
            return { surf: g, owner: null, lx: px, base: g.baseY[bin], h: g.heights[bin] };
        return null;
    }

    _stopRoll() {
        const r = this._roll;
        this._roll = null;
        this._rollTrack = null;
        if (r && this._stacks.has(r.stack)) {
            r.stack.state = 'rest';
            this._settleStack(r.stack);
        }
    }

    // снег под шаром налипает на него: столбики под шаром выскребаются до опоры
    _scrape(surf, x0, x1) {
        let area = 0;
        const b0 = Math.max(0, Math.floor(x0 / BIN));
        const b1 = Math.min(surf.n - 1, Math.floor(x1 / BIN));
        for (let i = b0; i <= b1; i++) {
            const stack = surf.bins[i];
            if (!stack.length)
                continue;
            area += surf.heights[i] * BIN;
            surf.count -= stack.length;
            this._settledCount -= stack.length;
            surf.bins[i] = [];
            surf.heights[i] = 0;
            surf.dirty = true;
        }
        return area;
    }

    _tickRoll(dt, getWins) {
        const px = this.rt.P.x, py = this.rt.P.y;
        if (this.rt.P.down || this._drag || this.rt.captured) {
            // нажата кнопка (тащат окно, выделяют текст) — не катаем
            this._stopRoll();
            return;
        }
        const roll = this._roll;
        if (roll) {
            const st = roll.stack;
            const ball = st.balls[0];
            const [sx, sy] = this._screenOf(st);
            const r = ball.r;
            if (py < sy - 2 * r - 16 || py > sy + 10 || Math.abs(px - sx) > r + 50) {
                this._stopRoll();
                return;
            }
            const ox = st.owner ? st.owner.surf.ox : 0;
            const lx = px - ox;
            const nx = st.x + (lx - st.x) * Math.min(1, dt * 14);
            const dx = nx - st.x;
            const width = st.owner ? st.owner.width : this._W;
            if (st.owner && (nx < 0 || nx >= width)) {
                // скатился с края окна
                this._roll = null;
                st.x = nx;
                this._fallStack(st, Math.max(-500, Math.min(500, dx / dt)), -40);
                return;
            }
            st.x = Math.max(r, Math.min(width - (st.owner ? 0 : r), nx));
            ball.angle = (ball.angle || 0) + dx / r;
            if (r < MAX_R) {
                const area = this._scrape(roll.surf, st.x - r * 0.6, st.x + r * 0.6);
                if (area > 0)
                    ball.r = Math.min(MAX_R, Math.sqrt(r * r + area * 0.35 / Math.PI));
            }
            let base = roll.base;
            if (!st.owner) {
                const b = Math.floor(st.x / BIN);
                if (this._ground.hasFloor(b))
                    base = this._ground.baseY[b];
            }
            st.y = base - this._snowUnder(roll.surf, st.x, ball.r) * 0.55;
            if (Math.abs(ball.r - roll.drawnR) >= 0.5) {
                roll.drawnR = ball.r;
                this._relayoutStack(st);
            }
            return;
        }

        // начало: курсор ведут по сугробу (без нажатия) — снег скатывается в шар
        const d = this._driftAt(px, py, getWins);
        if (!d) {
            this._rollTrack = null;
            return;
        }
        let tr = this._rollTrack;
        if (!tr || tr.surf !== d.surf || Math.abs(py - tr.y) > 40) {
            tr = this._rollTrack = { surf: d.surf, x: px, y: py, travel: 0 };
            return;
        }
        tr.travel += Math.abs(px - tr.x);
        tr.x = px;
        tr.y = py;
        if (tr.travel < ROLL_START)
            return;
        // докатываем уже лежащий снежок, если курсор упёрся в него
        let st = null;
        for (const o of this._stacks) {
            if (o.state === 'rest' && o.balls.length === 1 && o.owner === d.owner &&
                Math.abs(o.x - d.lx) < o.balls[0].r + 8) {
                st = o;
                break;
            }
        }
        if (!st) {
            if (d.h < 3)
                return;
            st = this._newStack([{ r: START_R, angle: 0 }], d.owner, d.lx, d.base);
            if (!st)
                return;
        }
        st.state = 'roll';
        this._rollTrack = null;
        this._roll = { stack: st, surf: d.surf, base: d.base, drawnR: st.balls[0].r };
    }

    // ---------- мышь: взять шар (и всё, что на нём) и положить на другой ----------

    // закрыта ли точка окнами, которые выше окна win
    _occludedAbove(win, x, y) {
        for (const w of this.rt.wins) {
            if (w.id === win)
                return false;
            if (x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h)
                return true;
        }
        return true;   // окна нет в списке видимых
    }

    hit(x, y, layer) {
        if (!this._running || this._paused || !this._cfg.snowballs || this._drag || !this._fl)
            return null;
        for (const st of this._stacks) {
            if (st.state !== 'rest')
                continue;
            const [sx, sy] = this._screenOf(st);
            const g = st.geo;
            if (x < sx - g.halfW || x > sx + g.halfW || y < sy + g.top || y > sy + g.bottom)
                continue;
            if (st.owner) {
                if (layer !== 'top' || !st.owner.visible || this._occludedAbove(st.owner.win, x, y))
                    continue;
            } else if (layer !== this._fl.layer || !this._fl.visible) {
                continue;
            }
            return {
                target: st,
                cursor: 'grab',
                down: ev => {
                    if (ev.button === 0)
                        this._startDrag(st, ev);
                },
            };
        }
        return null;
    }

    _startDrag(st, ev) {
        if (this._drag || !this._running)
            return;
        const x = ev.x, y = ev.y;
        const [sx0, sy0] = this._screenOf(st);
        const idx = Snowman.pickBall(st.geo, x - sx0, y - sy0);
        let dragged = st;
        if (idx > 0) {
            // берём верхнюю часть снеговика: шар под курсором и всё, что выше
            const c = st.geo.c[idx];
            const upper = st.balls.splice(idx).map(b => ({ r: b.r, angle: 0 }));
            this._relayoutStack(st);
            dragged = this._newStack(upper, null, sx0, sy0 + c.y + c.r, true);
            if (!dragged)
                return;
            dragged.seed = st.seed;
        }
        if (this._roll && this._roll.stack === dragged)
            this._roll = null;
        // на время переноса — поверх всего
        this._reparentStack(dragged, null);
        dragged.state = 'drag';
        this.rt.removeTweens(dragged);
        dragged.sx = dragged.sy = 1.06;
        this._drag = {
            st: dragged,
            offX: dragged.x - x, offY: dragged.y - y,
            samples: [[ev.time, x, y]],
        };
        this._dragHandler = {
            cursor: 'grabbing',
            move: (mx, my, t) => {
                const d = this._drag;
                if (!d)
                    return;
                d.samples.push([t, mx, my]);
                while (d.samples.length > 2 && t - d.samples[0][0] > 0.1)
                    d.samples.shift();
                d.st.x = mx + d.offX;
                d.st.y = my + d.offY;
                this.rt.redraw('top');
            },
            up: () => this._endDrag(true),
            cancel: () => this._endDrag(false),
        };
        this.rt.capture(this._dragHandler, ev.layer);
        this.rt.redraw();
    }

    _endDrag(throwIt) {
        const d = this._drag;
        if (!d)
            return;
        this._drag = null;
        if (this.rt._capture === this._dragHandler)
            this.rt.releaseCapture();
        this._dragHandler = null;
        const st = d.st;
        if (!this._stacks.has(st))
            return;
        st.sx = st.sy = 1;
        // отпустили на ходу — шар немного летит по инерции; остановились — кладём
        let vx = 0, vy = 0;
        const now = this.rt.now();
        if (throwIt && d.samples.length >= 2) {
            const [t0, x0, y0] = d.samples[0];
            const [t1, x1, y1] = d.samples[d.samples.length - 1];
            if (t1 - t0 > 0.01 && now - t1 < 0.08) {
                vx = Math.max(-450, Math.min(450, (x1 - x0) / (t1 - t0) * 0.4));
                vy = Math.max(-450, Math.min(450, (y1 - y0) / (t1 - t0) * 0.4));
            }
        }
        // отпустили — падает (и складывается, если внизу шар), уже в слое снега
        st.state = 'fall';
        st.vx = vx;
        st.vy = vy;
        st.ignoreWin = null;
        st.ignoreStack = null;
        if (!this._running || this._paused)
            this._destroyStack(st);
        this.rt.redraw();
    }

    // ---------- рисование ----------

    _stackImage(st) {
        if (st.needsPaint || !st.canvas) {
            st.canvas = Snowman.render(st.balls, st.geo, st.seed, this.rt.dpr);
            st.needsPaint = false;
        }
        return st.canvas;
    }

    _drawStack(ctx, st) {
        const img = this._stackImage(st);
        const [sx, sy] = this._screenOf(st);
        const g = st.geo;
        ctx.save();
        ctx.translate(Math.round(sx), Math.round(sy));
        if (st.sx !== 1 || st.sy !== 1)
            ctx.scale(st.sx, st.sy);
        ctx.drawImage(img, -g.halfW, g.top, g.w, g.h);
        ctx.restore();
    }

    _drawSurface(ctx, surf) {
        if (!surf.count)
            return;
        if (surf.needsPaint || !surf.canvas)
            repaintSurface(surf, this.rt.dpr);
        ctx.drawImage(surf.canvas, surf.ox - surf.padX, surf.oy + surf.paintY, surf.pw, surf.ph);
    }

    // сугробы на окнах: каждый закрыт окнами, которые выше его окна
    _drawWindowDrifts(ctx) {
        const wins = this.rt.wins;
        const W = this.rt.W, H = this.rt.H;
        for (let j = wins.length - 1; j >= 0; j--) {
            const t = this._trackers.get(wins[j].id);
            if (!t || !t.visible || (!t.surf.count && !this._hasStacks(t)))
                continue;
            const s = t.surf;
            const x0 = s.ox - s.padX - 60, x1 = s.ox + t.width + s.padX + 60;
            const y0 = s.oy + s.paintY - 260, y1 = s.oy + LIP + 8;
            ctx.save();
            for (let m = 0; m < j; m++) {
                const o = wins[m];
                if (o.x >= x1 || o.x + o.w <= x0 || o.y >= y1 || o.y + o.h <= y0)
                    continue;
                ctx.beginPath();
                ctx.rect(0, 0, W, H);
                ctx.rect(o.x, o.y, o.w, o.h);
                ctx.clip('evenodd');
            }
            this._drawSurface(ctx, s);
            for (const st of this._stacks) {
                if (st.owner === t)
                    this._drawStack(ctx, st);
            }
            ctx.restore();
        }
    }

    draw(cr, layer, pass, ctx) {
        if (!this._running || this._paused || !this._fl)
            return;
        const fl = this._fl;
        if (layer === 'top' && pass === 'under') {
            ctx.globalAlpha = fl.opacity;
            this._drawWindowDrifts(ctx);
            return;
        }
        if (layer === 'top' && pass === 'over') {
            if (this._drag)
                this._drawStack(ctx, this._drag.st);
            return;
        }
        if (pass !== 'main' || layer !== fl.layer || !fl.visible)
            return;
        ctx.globalAlpha = fl.opacity;
        const g = this._ground;
        if (g)
            this._drawSurface(ctx, g);
        for (const st of this._stacks) {
            if (!st.owner && st.state !== 'drag')
                this._drawStack(ctx, st);
        }
        const tex = this._tex;
        for (const f of this._free) {
            ctx.globalAlpha = fl.opacity * f.opacity / 255;
            ctx.drawImage(tex, f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
        }
        ctx.globalAlpha = 1;
    }
}

module.exports = { Snow };
