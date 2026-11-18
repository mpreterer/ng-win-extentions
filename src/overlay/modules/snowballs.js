/* Snowball Fight — перенос расширения GNOME на Windows.
 *
 * На рабочем столе лежит горка снежков. Снежок можно схватить мышью и
 * бросить: скорость броска берётся из движения мыши, в полёте действует
 * гравитация. Ударившись о край экрана, снежок сплющивается в «шлепок» на
 * стене, разлетаются крошки; след медленно сползает и тает. Горка сама
 * пополняется. Стены — рабочая область главного монитора (без панели задач).
 */
'use strict';

const Cairo = require('../cairo');
const { FestiveLayer } = require('../runtime');

const TEX_BALL = 64;
const TEX_SPLAT = 160;
const TEX_CRUMB = 16;
const MAX_SPEED = 4000;
const REGEN_DELAY = 2500;   // мс до появления нового снежка в горке

// Снежок: шар с бликом слева сверху, голубоватой тенью и ямками.
function drawBall(cr, w) {
    const r = w / 2 - 1;
    const c = w / 2;
    const g = new Cairo.RadialGradient(c - r * 0.35, c - r * 0.4, r * 0.05, c, c, r);
    g.addColorStopRGBA(0, 1, 1, 1, 1);
    g.addColorStopRGBA(0.55, 0.92, 0.95, 0.99, 1);
    g.addColorStopRGBA(1, 0.7, 0.78, 0.9, 1);
    cr.setSource(g);
    cr.arc(c, c, r, 0, 2 * Math.PI);
    cr.fill();
    // ямки и комочки
    let seed = 11;
    const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    for (let i = 0; i < 14; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.85;
        const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d;
        cr.setSourceRGBA(0.55, 0.65, 0.8, 0.18 + rnd() * 0.15);
        cr.arc(x, y, r * (0.05 + rnd() * 0.07), 0, 2 * Math.PI);
        cr.fill();
    }
    cr.setSourceRGBA(0.55, 0.65, 0.82, 0.5);
    cr.setLineWidth(1);
    cr.arc(c, c, r - 0.5, 0, 2 * Math.PI);
    cr.stroke();
}

function drawCrumb(cr, w) {
    const g = new Cairo.RadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStopRGBA(0, 1, 1, 1, 1);
    g.addColorStopRGBA(0.6, 0.93, 0.96, 1, 0.9);
    g.addColorStopRGBA(1, 0.85, 0.9, 1, 0);
    cr.setSource(g);
    cr.arc(w / 2, w / 2, w / 2, 0, 2 * Math.PI);
    cr.fill();
}

// Шлепок: неровное пятно с брызгами вокруг. Каждый вариант — свой seed.
function drawSplat(cr, w, variant) {
    let seed = 1234 + variant * 977;
    const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    const c = w / 2;
    const R = w * 0.28;
    const waves = [];
    for (let k = 0; k < 5; k++)
        waves.push([2 + Math.floor(rnd() * 7), rnd() * Math.PI * 2, 0.04 + rnd() * 0.1]);
    const radius = a => {
        let f = 1;
        for (const [n, ph, amp] of waves)
            f += amp * Math.sin(n * a + ph);
        return R * f;
    };
    // основное пятно
    cr.newPath();
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
        const a = i / steps * Math.PI * 2;
        const rr = radius(a);
        const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
        if (i === 0)
            cr.moveTo(x, y);
        else
            cr.lineTo(x, y);
    }
    cr.closePath();
    const g = new Cairo.RadialGradient(c - R * 0.25, c - R * 0.25, R * 0.1, c, c, R * 1.25);
    g.addColorStopRGBA(0, 1, 1, 1, 0.98);
    g.addColorStopRGBA(0.7, 0.93, 0.96, 1, 0.95);
    g.addColorStopRGBA(1, 0.78, 0.85, 0.95, 0.9);
    cr.setSource(g);
    cr.fillPreserve();
    cr.setSourceRGBA(0.6, 0.7, 0.85, 0.45);
    cr.setLineWidth(1.2);
    cr.stroke();
    // лучи-брызги и капли
    const rays = 5 + Math.floor(rnd() * 5);
    for (let i = 0; i < rays; i++) {
        const a = rnd() * Math.PI * 2;
        const r0 = radius(a) * 0.9;
        const len = R * (0.12 + rnd() * 0.3);
        const wid = R * (0.14 + rnd() * 0.12);
        const x0 = c + Math.cos(a) * r0, y0 = c + Math.sin(a) * r0;
        const x1 = c + Math.cos(a) * (r0 + len), y1 = c + Math.sin(a) * (r0 + len);
        cr.setSourceRGBA(0.95, 0.97, 1, 0.95);
        cr.setLineWidth(wid);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.moveTo(x0, y0);
        cr.lineTo(x1, y1);
        cr.stroke();
        cr.arc(x1 + Math.cos(a) * wid, y1 + Math.sin(a) * wid, wid * (0.6 + rnd() * 0.6), 0, 2 * Math.PI);
        cr.fill();
    }
    for (let i = 0; i < 18; i++) {
        const a = rnd() * Math.PI * 2;
        const d = R * (1.15 + rnd() * 0.55);
        cr.setSourceRGBA(0.95, 0.97, 1, 0.6 + rnd() * 0.35);
        cr.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, R * (0.03 + rnd() * 0.07), 0, 2 * Math.PI);
        cr.fill();
    }
}

class SnowballGame {
    constructor(rt) {
        this.rt = rt;
        this.name = 'snowballs';
        this.s = rt.S.view('snowballs');
        this._running = false;
        this.s.on('enabled', () => this._sync());
        this._sync();
    }

    _sync() {
        if (this.s.get('enabled'))
            this.start();
        else
            this.stop();
    }

    action(name) {
        if (name === 'clear')
            this.clearSplats();
    }

    start() {
        if (this._running)
            return;
        const rt = this.rt;
        this._running = true;
        this._ids = [];
        this._slots = [];
        this._flying = [];
        this._crumbs = [];
        this._splats = [];
        this._timers = new Set();
        this._drag = null;

        const dpr = rt.dpr;
        this._texBall = Cairo.makeCanvas(TEX_BALL, TEX_BALL, (cr, w) => drawBall(cr, w), dpr);
        this._texCrumb = Cairo.makeCanvas(TEX_CRUMB, TEX_CRUMB, (cr, w) => drawCrumb(cr, w), dpr);
        this._texSplat = [0, 1, 2, 3].map(v => Cairo.makeCanvas(TEX_SPLAT, TEX_SPLAT, (cr, w) => drawSplat(cr, w, v), dpr));

        // где показывать: поверх окон / только на пустом столе / под окнами
        this._fl = new FestiveLayer(rt, this.s, shown => {
            if (!shown)
                this._endDrag(false);
        });
        const rebuild = () => this._queueRebuild();
        this._dispId = rt.on('displays', rebuild);
        for (const key of ['pile-size', 'ball-size', 'corner'])
            this._ids.push(this.s.on(key, rebuild));
        this._buildPile();
    }

    stop() {
        if (!this._running)
            return;
        this._running = false;
        this._endDrag(false);
        for (const id of this._timers)
            clearTimeout(id);
        this._timers.clear();
        if (this._rebuildId) {
            clearTimeout(this._rebuildId);
            this._rebuildId = 0;
        }
        for (const id of this._ids)
            this.s.off(id);
        this._ids = [];
        this.rt.off(this._dispId);
        for (const o of [...this._slots.map(s => s.ball), ...this._splats])
            if (o)
                this.rt.removeTweens(o);
        this._fl.destroy();
        this._fl = null;
        this._slots = [];
        this._flying = [];
        this._crumbs = [];
        this._splats = [];
        this.rt.redraw();
    }

    _later(ms, cb) {
        const id = setTimeout(() => {
            this._timers.delete(id);
            cb();
        }, ms);
        this._timers.add(id);
    }

    _queueRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = setTimeout(() => {
            this._rebuildId = 0;
            if (this._running)
                this._buildPile();
        }, 200);
    }

    // Стены — рабочая область главного монитора (без панели задач).
    _walls() {
        const wa = this.rt.primary.work;
        return { l: wa.x, t: wa.y, r: wa.x + wa.width, b: wa.y + wa.height };
    }

    clearSplats() {
        if (!this._running)
            return;
        for (const sp of this._splats) {
            this.rt.removeTweens(sp, 'op');
            this.rt.tween(sp, { op: 0 }, 600, 'outQuad', () => this._removeSplat(sp));
        }
    }

    _removeSplat(sp) {
        const i = this._splats.indexOf(sp);
        if (i >= 0)
            this._splats.splice(i, 1);
        this.rt.removeTweens(sp);
        this.rt.redraw();
    }

    // ---------- горка ----------

    _buildPile() {
        for (const sl of this._slots)
            if (sl.ball)
                this.rt.removeTweens(sl.ball);
        this._slots = [];
        if (!this.rt.primary)
            return;
        const n = this.s.get('pile-size');
        const d = this.s.get('ball-size');
        const r = d / 2;
        const w = this._walls();
        const right = this.s.get('corner') !== 'bottom-left';
        // пирамида: нижний ряд шире
        let rows = 1;
        while (rows * (rows + 1) / 2 < n)
            rows++;
        const baseX = right ? w.r - 40 - rows * d : w.l + 40;
        let placed = 0;
        for (let row = 0; row < rows && placed < n; row++) {
            const count = rows - row;
            for (let k = 0; k < count && placed < n; k++, placed++) {
                const cx = baseX + r + row * r + k * d * 0.96;
                const cy = w.b - r - 2 - row * d * 0.84;
                this._slots.push({ x: cx, y: cy, ball: null });
            }
        }
        for (const slot of this._slots)
            this._fillSlot(slot, false);
        this.rt.redraw();
    }

    _fillSlot(slot, animate) {
        if (slot.ball || !this._running || !this._slots.includes(slot))
            return;
        const d = this.s.get('ball-size');
        const ball = { d, rot: Math.random() * 360, sc: 1, slot };
        slot.ball = ball;
        if (animate) {
            ball.sc = 0.1;
            this.rt.tween(ball, { sc: 1 }, 350, 'outBack');
        }
        this.rt.redraw();
    }

    // ---------- бросок ----------

    hit(x, y, layer) {
        if (!this._running || this._drag || !this._fl || layer !== this._fl.layer || !this._fl.visible)
            return null;
        for (const slot of this._slots) {
            const b = slot.ball;
            if (!b)
                continue;
            if (Math.hypot(x - slot.x, y - slot.y) > b.d / 2 + 1)
                continue;
            return {
                target: b,
                cursor: 'grab',
                down: ev => {
                    if (ev.button === 0)
                        this._startDrag(b, ev);
                },
            };
        }
        return null;
    }

    _startDrag(ball, ev) {
        if (this._drag)
            return;
        const slot = ball.slot;
        if (slot) {
            slot.ball = null;
            ball.slot = null;
            this._later(REGEN_DELAY, () => this._fillSlot(slot, true));
        }
        const x = ev.x, y = ev.y;
        this.rt.removeTweens(ball);
        ball.sc = 1.12;   // «взяли в руку»
        this._drag = {
            ball,
            samples: [[ev.time, x, y]],
            x, y,
        };
        this._dragHandler = {
            cursor: 'grabbing',
            move: (mx, my, t) => {
                const d = this._drag;
                if (!d)
                    return;
                d.x = mx;
                d.y = my;
                d.samples.push([t, mx, my]);
                while (d.samples.length > 2 && t - d.samples[0][0] > 0.1)
                    d.samples.shift();
                this.rt.redraw(this._fl.layer);
            },
            up: () => this._endDrag(true),
            cancel: () => this._endDrag(false),
        };
        this.rt.capture(this._dragHandler, ev.layer);
        this.rt.redraw();
    }

    _endDrag(throwIt) {
        const drag = this._drag;
        if (!drag)
            return;
        this._drag = null;
        if (this.rt._capture === this._dragHandler)
            this.rt.releaseCapture();
        this._dragHandler = null;
        if (!this._running)
            return;
        const ball = drag.ball;
        // скорость — по движению мыши за последние ~0.1 с
        let vx = 0, vy = 0;
        const now = this.rt.now();
        const recent = drag.samples.filter(s => now - s[0] < 0.12);
        if (throwIt && recent.length >= 2) {
            const [t0, x0, y0] = recent[0];
            const [t1, x1, y1] = recent[recent.length - 1];
            const dt = Math.max(0.016, t1 - t0);
            const power = this.s.get('throw-power');
            vx = (x1 - x0) / dt * power;
            vy = (y1 - y0) / dt * power;
            const sp = Math.hypot(vx, vy);
            if (sp > MAX_SPEED) {
                vx *= MAX_SPEED / sp;
                vy *= MAX_SPEED / sp;
            }
        }
        ball.sc = 1;
        const r = ball.d / 2;
        this._flying.push({ ball, x: drag.x, y: drag.y, vx, vy, r, spin: vx * 0.3 });
        this.rt.redraw();
    }

    // ---------- полёт, удар, крошки ----------

    tick(now, dtFrame) {
        if (!this._running)
            return;
        if (this._drag)
            this.rt.redraw(this._fl.layer);
        if (!this._flying.length && !this._crumbs.length)
            return;
        this.rt.fast();
        const dt = Math.min(0.033, dtFrame);
        const g = this.s.get('gravity');
        const w = this._walls();

        for (let i = this._flying.length - 1; i >= 0; i--) {
            const f = this._flying[i];
            f.vy += g * dt;
            const drag = Math.exp(-0.15 * dt);
            f.vx *= drag;
            f.vy *= drag;
            f.x += f.vx * dt;
            f.y += f.vy * dt;
            f.ball.rot += f.spin * dt;
            let hit = null;
            if (f.x - f.r <= w.l)
                hit = { side: 'left', x: w.l, y: f.y };
            else if (f.x + f.r >= w.r)
                hit = { side: 'right', x: w.r, y: f.y };
            else if (f.y - f.r <= w.t)
                hit = { side: 'top', x: f.x, y: w.t };
            else if (f.y + f.r >= w.b)
                hit = { side: 'bottom', x: f.x, y: w.b };
            if (hit) {
                this._flying.splice(i, 1);
                this._splat(f, hit);
            }
        }

        for (let i = this._crumbs.length - 1; i >= 0; i--) {
            const c = this._crumbs[i];
            c.age += dt;
            if (c.age >= c.life) {
                this._crumbs.splice(i, 1);
                continue;
            }
            c.vy += g * 0.9 * dt;
            c.vx *= Math.exp(-1.5 * dt);
            c.x += c.vx * dt;
            c.y += c.vy * dt;
            // крошки не вылетают за стены
            if (c.x < w.l) {
                c.x = w.l;
                c.vx = Math.abs(c.vx) * 0.3;
            } else if (c.x > w.r) {
                c.x = w.r;
                c.vx = -Math.abs(c.vx) * 0.3;
            }
            if (c.y > w.b - c.size / 2) {
                c.y = w.b - c.size / 2;
                c.vy = -Math.abs(c.vy) * 0.25;
                c.vx *= 0.6;
            }
            c.op = Math.min(1, (c.life - c.age) / (c.life * 0.4));
        }
        this.rt.redraw(this._fl.layer);
    }

    _splat(f, hit) {
        const speed = Math.hypot(f.vx, f.vy);
        const strength = Math.max(0.35, Math.min(1.3, speed / 1400));

        // нормаль стены (внутрь экрана) и касательная
        const N = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] }[hit.side];
        const Tn = [-N[1], N[0]];
        const d = f.r * 2;

        // пятно на стене: сплющено вдоль нормали, растёт «шлепком»
        const size = d * (1.5 + strength * 0.9);
        const flat = 0.68 + 0.12 * (1 - strength);
        const sx = N[0] !== 0 ? flat : 1, sy = N[1] !== 0 ? flat : 1;
        const splat = {
            tex: this._texSplat[(Math.random() * 4) | 0],
            size,
            cx: hit.x + N[0] * size * 0.12,
            cy: hit.y + N[1] * size * 0.12,
            rot: (Math.random() - 0.5) * 40,
            sx: sx * 0.3, sy: sy * 0.3,
            ty: 0, op: 1,
        };
        this._splats.push(splat);
        this.rt.tween(splat, { sx, sy }, 90, 'outQuad');
        // след на вертикальной стене медленно сползает, потом тает
        const lifetime = this.s.get('splat-lifetime') * 1000;
        if (hit.side === 'left' || hit.side === 'right')
            this.rt.tween(splat, { ty: 6 + Math.random() * 18 }, Math.min(lifetime, 12000), 'outQuad');
        this._later(lifetime, () => {
            if (!this._running || !this._splats.includes(splat))
                return;
            this.rt.tween(splat, { op: 0 }, 2500, 'inQuad', () => this._removeSplat(splat));
        });
        // не копим бесконечно: максимум 60 следов
        if (this._splats.length > 60)
            this._removeSplat(this._splats[0]);

        // крошки отлетают от стены, с частью касательной скорости снежка
        const vt = f.vx * Tn[0] + f.vy * Tn[1];
        const n = Math.round(14 + 26 * strength);
        for (let i = 0; i < n; i++) {
            const big = Math.random() < 0.25;
            const csize = big ? 6 + Math.random() * 6 : 2.5 + Math.random() * 3.5;
            const out = (80 + Math.random() * 420) * strength;
            const side = (Math.random() - 0.5) * 520 * strength + vt * 0.35;
            this._crumbs.push({
                size: csize, op: 1,
                x: hit.x + N[0] * (f.r * 0.6) + Tn[0] * (Math.random() - 0.5) * d,
                y: hit.y + N[1] * (f.r * 0.6) + Tn[1] * (Math.random() - 0.5) * d,
                vx: N[0] * out + Tn[0] * side,
                vy: N[1] * out + Tn[1] * side - (hit.side === 'bottom' ? 0 : Math.random() * 120),
                age: 0,
                life: 0.5 + Math.random() * 0.8,
            });
        }
        this.rt.redraw();
    }

    // ---------- рисование ----------

    _drawBall(ctx, ball, x, y) {
        const d = ball.d;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ball.rot * Math.PI / 180);
        if (ball.sc !== 1)
            ctx.scale(ball.sc, ball.sc);
        ctx.drawImage(this._texBall, -d / 2, -d / 2, d, d);
        ctx.restore();
    }

    draw(cr, layer, pass, ctx) {
        if (!this._running || pass !== 'main' || layer !== this._fl.layer || !this._fl.visible)
            return;
        const alpha = this._fl.opacity;
        // следы на стенах
        for (const sp of this._splats) {
            ctx.save();
            ctx.globalAlpha = alpha * sp.op;
            ctx.translate(sp.cx, sp.cy + sp.ty);
            ctx.rotate(sp.rot * Math.PI / 180);
            ctx.scale(sp.sx, sp.sy);
            ctx.drawImage(sp.tex, -sp.size / 2, -sp.size / 2, sp.size, sp.size);
            ctx.restore();
        }
        ctx.globalAlpha = alpha;
        // горка
        for (const slot of this._slots) {
            if (slot.ball)
                this._drawBall(ctx, slot.ball, slot.x, slot.y);
        }
        // летящие и тот, что в руке
        for (const f of this._flying)
            this._drawBall(ctx, f.ball, f.x, f.y);
        if (this._drag)
            this._drawBall(ctx, this._drag.ball, this._drag.x, this._drag.y);
        for (const c of this._crumbs) {
            ctx.globalAlpha = alpha * c.op;
            ctx.drawImage(this._texCrumb, c.x - c.size / 2, c.y - c.size / 2, c.size, c.size);
        }
        ctx.globalAlpha = 1;
    }
}

module.exports = { SnowballGame };
