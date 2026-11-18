/* Garland Lights — перенос расширения GNOME на Windows.
 *
 * Новогодняя гирлянда провисает цепной линией вдоль верха главного экрана.
 * Провод рисуется один раз в картинку, лампочки — по картинке на цвет
 * (горящая, погасшая, ореол); мигание — смена прозрачности 20 раз в секунду.
 * Справа висит шнурок-выключатель: бусину можно потянуть мышью вниз или
 * просто щёлкнуть.
 */
'use strict';

const Cairo = require('../cairo');
const { FestiveLayer } = require('../runtime');
const { T } = require('../../i18n');

const FPS = 20;
const BULB_W = 8;   // базовые размеры лампочки при масштабе 1
const BULB_H = 15;
const GLOW = 40;

const PALETTES = {
    multicolor: ['#ff3b30', '#34c759', '#0a84ff', '#ffd60a', '#ff2d92', '#ff9f0a'],
    warm: ['#ffcf70', '#ffb347', '#ffe4a8', '#ffc04d'],
    cold: ['#8fd3ff', '#4aa8ff', '#e0f4ff', '#6fb8ff'],
};

function parseColor(hex) {
    return [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255);
}

// Лампочка: цоколь сверху + стеклянная «капля». lit=true — светящаяся.
function drawBulb(cr, w, h, rgb, lit) {
    const [r, g, b] = rgb;
    const capH = h * 0.24;
    // цоколь
    cr.setSourceRGBA(0.22, 0.24, 0.22, 1);
    cr.rectangle(w * 0.28, 0, w * 0.44, capH);
    cr.fill();
    cr.setSourceRGBA(0.45, 0.47, 0.45, 1);
    cr.rectangle(w * 0.28, capH * 0.35, w * 0.44, capH * 0.18);
    cr.fill();
    // стекло — вытянутый эллипс
    const cx = w / 2, cy = capH + (h - capH) / 2;
    const rx = w / 2 - 0.5, ry = (h - capH) / 2 - 0.2;
    cr.save();
    cr.translate(cx, cy);
    cr.scale(rx, ry);
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
    if (lit) {
        const grad = new Cairo.RadialGradient(cx - rx * 0.25, cy - ry * 0.3, 0, cx, cy, Math.max(rx, ry));
        grad.addColorStopRGBA(0, 1, 1, 1, 1);
        grad.addColorStopRGBA(0.35, Math.min(1, r * 1.1 + 0.25), Math.min(1, g * 1.1 + 0.25), Math.min(1, b * 1.1 + 0.25), 1);
        grad.addColorStopRGBA(1, r, g, b, 1);
        cr.setSource(grad);
    } else {
        cr.setSourceRGBA(r * 0.35, g * 0.35, b * 0.35, 0.95);
    }
    cr.fill();
    // блик
    cr.setSourceRGBA(1, 1, 1, lit ? 0.7 : 0.25);
    cr.save();
    cr.translate(cx - rx * 0.35, cy - ry * 0.35);
    cr.scale(rx * 0.22, ry * 0.3);
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
    cr.fill();
}

function drawGlow(cr, w, h, rgb) {
    const [r, g, b] = rgb;
    const grad = new Cairo.RadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStopRGBA(0, r, g, b, 0.55);
    grad.addColorStopRGBA(0.35, r, g, b, 0.22);
    grad.addColorStopRGBA(1, r, g, b, 0);
    cr.setSource(grad);
    cr.arc(w / 2, h / 2, w / 2, 0, 2 * Math.PI);
    cr.fill();
}

// Параметр цепной линии a: a*cosh(half/a) - a = sag
function catenaryA(half, sag) {
    let lo = 1e-3, hi = 1e7;
    for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        const s = mid * (Math.cosh(half / mid) - 1);
        if (!isFinite(s) || s > sag)
            lo = mid;
        else
            hi = mid;
    }
    return (lo + hi) / 2;
}

class Garland {
    constructor(rt) {
        this.rt = rt;
        this.name = 'garland';
        this.s = rt.S.view('garland');
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

    start() {
        if (this._running)
            return;
        const rt = this.rt;
        this._running = true;
        this._ids = [];
        this._bulbs = [];
        this._time = 0;
        this._acc = 0;
        this._pull = null;
        this._pullDrag = null;
        this._visible = true;
        this._mode = this.s.get('visibility');
        // где показывать: поверх окон / только на пустом столе / под окнами
        this._fl = new FestiveLayer(rt, this.s, () => {
            const mode = this.s.get('visibility');
            if (mode !== this._mode) {
                this._mode = mode;
                this._endPullDrag(false);
                this._queueRebuild();
            }
        });
        const rebuild = () => this._queueRebuild();
        this._dispId = rt.on('displays', rebuild);
        const on = (key, cb) => this._ids.push(this.s.on(key, cb));
        on('lights-on', () => rt.redraw());
        for (const key of ['bulb-count', 'sag', 'bulb-scale', 'palette', 'show-pull', 'wire-color'])
            on(key, rebuild);
        on('mode', () => rt.redraw());
        this._build();
    }

    stop() {
        if (!this._running)
            return;
        this._running = false;
        if (this._rebuildId) {
            clearTimeout(this._rebuildId);
            this._rebuildId = 0;
        }
        for (const id of this._ids)
            this.s.off(id);
        this._ids = [];
        this.rt.off(this._dispId);
        this._endPullDrag(false);
        if (this._pull)
            this.rt.removeTweens(this._pull);
        this._pull = null;
        this._fl.destroy();
        this._fl = null;
        this._bulbs = [];
        this.rt.redraw();
    }

    _queueRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = setTimeout(() => {
            this._rebuildId = 0;
            if (this._running)
                this._build();
        }, 150);
    }

    _build() {
        const rt = this.rt;
        this._endPullDrag(false);
        if (this._pull)
            rt.removeTweens(this._pull);
        this._pull = null;
        this._bulbs = [];
        const mon = rt.primary;
        if (!mon)
            return;
        const dpr = rt.dpr;
        const wa = mon.work;
        const top = Math.max(mon.bounds.y, wa.y) - 3;   // крепим чуть под верхний край
        const x0 = mon.bounds.x - 6;
        const span = mon.bounds.width + 12;
        const sag = this.s.get('sag');
        const half = span / 2;
        const a = catenaryA(half, sag);
        // цепная линия: края на высоте top, середина ниже на sag
        const wireY = x => top + sag - a * (Math.cosh((x - x0 - half) / a) - 1);

        // провод: цвет из настроек, вторая жилка чуть светлее/темнее для объёма
        let wireRgb = parseColor('#14381a');
        const wc = this.s.get('wire-color');
        if (/^#[0-9a-fA-F]{6}$/.test(wc))
            wireRgb = parseColor(wc);
        const lum = 0.3 * wireRgb[0] + 0.59 * wireRgb[1] + 0.11 * wireRgb[2];
        const shade = lum > 0.5 ? 0.78 : 1.6;
        const wireRgb2 = wireRgb.map(c => Math.min(1, c * shade + (lum > 0.5 ? 0 : 0.04)));
        this._wire = {
            x: x0, y: top - 6, w: span, h: sag + 16,
            img: Cairo.makeCanvas(span, sag + 16, cr => {
                const steps = Math.max(40, Math.round(span / 8));
                const strand = (offset, alpha, rgb) => {
                    cr.newPath();
                    for (let k = 0; k <= steps; k++) {
                        const lx = span * k / steps;
                        const ly = wireY(x0 + lx) - top + 6 + offset * Math.sin(lx / 7);
                        if (k === 0)
                            cr.moveTo(lx, ly);
                        else
                            cr.lineTo(lx, ly);
                    }
                    cr.setSourceRGBA(rgb[0], rgb[1], rgb[2], alpha);
                    cr.setLineWidth(1);
                    cr.stroke();
                };
                strand(0.6, 0.95, wireRgb);
                strand(-0.6, 0.85, wireRgb2);
            }, dpr),
        };

        // лампочки: равномерно по длине дуги
        const n = this.s.get('bulb-count');
        const scale = this.s.get('bulb-scale');
        const bw = BULB_W * scale, bh = BULB_H * scale, gs = GLOW * scale;
        const colors = PALETTES[this.s.get('palette')] || PALETTES.multicolor;
        const textures = colors.map(hex => {
            const rgb = parseColor(hex);
            return {
                off: Cairo.makeCanvas(bw, bh, (cr, w, h) => drawBulb(cr, w, h, rgb, false), dpr),
                on: Cairo.makeCanvas(bw, bh, (cr, w, h) => drawBulb(cr, w, h, rgb, true), dpr),
                glow: Cairo.makeCanvas(gs, gs, (cr, w, h) => drawGlow(cr, w, h, rgb), dpr),
            };
        });
        this._size = { bw, bh, gs };

        const samples = [];
        let len = 0;
        let px = x0, py = wireY(x0);
        const steps = 2000;
        samples.push([0, px, py]);
        for (let k = 1; k <= steps; k++) {
            const x = x0 + span * k / steps;
            const y = wireY(x);
            len += Math.hypot(x - px, y - py);
            samples.push([len, x, y]);
            px = x;
            py = y;
        }
        let si = 0;
        for (let i = 0; i < n; i++) {
            const target = len * (i + 0.5) / n;
            while (si < samples.length - 1 && samples[si + 1][0] < target)
                si++;
            const [, bx, by] = samples[si];
            this._bulbs.push({
                tex: textures[i % textures.length],
                // лампочка висит под проводом и чуть повёрнута
                x: bx, y: by - 2,
                rot: (Math.random() - 0.5) * 30 * Math.PI / 180,
                i,
                on: 1, glow: 1,
                phase: Math.random() * Math.PI * 2,
                freq: 0.5 + Math.random() * 1.1,
            });
        }
        if (this.s.get('show-pull')) {
            const pxPos = x0 + span - Math.max(40, span * 0.03);
            this._buildPull(pxPos, wireY(pxPos) - 1, Math.max(0.8, scale));
        }
        this._applyBrightness();
        rt.redraw();
    }

    /* Шнурок-выключатель. Бусину можно тянуть мышью вниз: шнур растягивается,
     * отпустили — пружинит обратно, лампочки переключаются. Простой клик тоже
     * переключает (шнурок сам дёргается). */
    _buildPull(x, y, scale) {
        const cordLen = Math.round(46 * scale);
        const w = Math.round(22 * scale);
        const knobRx = 4.5 * scale;
        const knobRy = 8 * scale;
        const knobH = Math.round(knobRy * 2 + 5 * scale);
        const maxStretch = Math.round(70 * scale);
        const knobImg = Cairo.makeCanvas(w, knobH, cr => {
            const cx = w / 2;
            const knobY = knobH - knobRy - 1;
            cr.setSourceRGBA(0.18, 0.18, 0.18, 1);
            cr.rectangle(cx - 2 * scale, 0, 4 * scale, 4 * scale);
            cr.fill();
            cr.save();
            cr.translate(cx, knobY);
            cr.scale(knobRx, knobRy);
            const g = new Cairo.RadialGradient(-0.35, -0.4, 0, 0, 0, 1);
            g.addColorStopRGBA(0, 0.55, 0.55, 0.55, 1);
            g.addColorStopRGBA(0.35, 0.12, 0.12, 0.12, 1);
            g.addColorStopRGBA(1, 0.02, 0.02, 0.02, 1);
            cr.setSource(g);
            cr.arc(0, 0, 1, 0, 2 * Math.PI);
            cr.fill();
            cr.restore();
        }, this.rt.dpr);
        this._pull = {
            x: Math.round(x - w / 2), y: Math.round(y),
            w, cordLen, knobH, maxStretch, scale, knobImg,
            cordW: Math.max(1, 1.2 * scale),
            stretch: 0,      // растяжение шнура, px
            rot: 0,          // наклон при наведении, градусы
            hover: false,
        };
    }

    _knobRect() {
        const p = this._pull;
        return { x: p.x, y: p.y + p.cordLen + p.stretch, w: p.w, h: p.knobH };
    }

    hit(x, y, layer) {
        const p = this._pull;
        if (!this._running || !p || !this._visible || !this._fl.visible || layer !== this._fl.layer || this._pullDrag)
            return null;
        const r = this._knobRect();
        if (x < r.x - 2 || x > r.x + r.w + 2 || y < r.y - 2 || y > r.y + r.h + 2)
            return null;
        return {
            target: p,
            cursor: 'pointer',
            down: ev => {
                if (ev.button === 0)
                    this._startPullDrag(ev);
            },
        };
    }

    _startPullDrag(ev) {
        const p = this._pull;
        if (!p || this._pullDrag)
            return;
        this.rt.removeTweens(p);
        p.rot = 0;
        this._pullDrag = { y0: ev.y, moved: 0, stretch: 0 };
        this._pullHandler = {
            cursor: 'grabbing',
            move: (x, y) => {
                const d = this._pullDrag;
                if (!d)
                    return;
                const dy = Math.max(0, y - d.y0);
                d.moved = Math.max(d.moved, Math.abs(y - d.y0));
                // резиновая растяжка: чем дальше тянешь, тем туже
                const s = p.maxStretch * (1 - Math.exp(-dy / p.maxStretch));
                d.stretch = s;
                p.stretch = s;
                this.rt.redraw();
            },
            up: () => this._endPullDrag(true),
            cancel: () => this._endPullDrag(false),
        };
        this.rt.capture(this._pullHandler, ev.layer);
    }

    _endPullDrag(commit) {
        const d = this._pullDrag;
        if (!d)
            return;
        this._pullDrag = null;
        if (this.rt._capture === this._pullHandler)
            this.rt.releaseCapture();
        const p = this._pull;
        if (!p)
            return;
        const click = d.moved < 4;
        const pulled = d.stretch > 10 * p.scale;
        if (commit && (click || pulled))
            this.s.set('lights-on', !this.s.get('lights-on'));
        const springBack = () => this.rt.tween(p, { stretch: 0 }, 550, 'outElastic');
        if (commit && click) {
            // простой клик: шнурок сам дёргается вниз и пружинит
            this.rt.tween(p, { stretch: 14 * p.scale }, 90, 'outQuad', springBack);
        } else {
            springBack();
        }
    }

    _brightness(bulb, n, t, mode) {
        switch (mode) {
        case 'chase': {
            const c = Math.cos(2 * Math.PI * (bulb.i / 6 - t * 0.6));
            return Math.pow(Math.max(0, c), 3);
        }
        case 'alternate': {
            const s = 0.5 + 0.5 * Math.sin(t * Math.PI * 0.8 + (bulb.i % 2) * Math.PI);
            return s * s * (3 - 2 * s);
        }
        case 'steady':
            return 0.88 + 0.12 * Math.sin(t * 0.7 * bulb.freq + bulb.phase);
        case 'twinkle':
        default: {
            const s = 0.5 + 0.5 * Math.sin(t * bulb.freq * Math.PI + bulb.phase);
            return s * s;
        }
        }
    }

    _applyBrightness() {
        const mode = this.s.get('mode');
        const n = this._bulbs.length;
        if (!this.s.get('lights-on')) {
            for (const bulb of this._bulbs)
                bulb.on = bulb.glow = 0;
            return;
        }
        for (const bulb of this._bulbs) {
            const b = Math.max(0, Math.min(1, this._brightness(bulb, n, this._time, mode)));
            bulb.on = 0.1 + 0.9 * b;
            bulb.glow = b;
        }
    }

    tick(now, dt) {
        if (!this._running)
            return;
        const p = this._pull;
        // шнурок чуть качнётся, когда на него наводят курсор
        if (p && !this._pullDrag) {
            const hover = this.rt.hoverTarget() === p;
            if (hover !== p.hover) {
                p.hover = hover;
                this.rt.tween(p, { rot: hover ? 5 : 0 }, 200, 'outQuad');
            }
        }
        const fullscreen = this.s.get('hide-in-fullscreen') && this.rt.primary && this.rt.primary.inFullscreen;
        const visible = !fullscreen;
        if (visible !== this._visible) {
            this._visible = visible;
            if (!visible)
                this._endPullDrag(false);
            this.rt.redraw();
        }
        this._acc += dt;
        if (this._acc < 1 / FPS)
            return;
        const step = Math.min(0.2, this._acc);
        this._acc = 0;
        if (!this._visible || !this._fl.shown || !this.s.get('lights-on'))
            return;
        this._time += step * this.s.get('speed');
        this._applyBrightness();
        this.rt.redraw(this._fl.layer);
    }

    draw(cr, layer, pass, ctx) {
        if (!this._running || pass !== 'main' || layer !== this._fl.layer || !this._fl.visible || !this._visible)
            return;
        const alpha = this._fl.opacity;
        ctx.globalAlpha = alpha;
        const w = this._wire;
        if (w)
            ctx.drawImage(w.img, w.x, w.y, w.w, w.h);
        const { bw, bh, gs } = this._size || { bw: 0, bh: 0, gs: 0 };
        for (const b of this._bulbs) {
            // ореол — под лампочкой; holder стоит в (x - gs/2, y)
            if (b.glow > 0.004) {
                ctx.globalAlpha = alpha * b.glow;
                ctx.drawImage(b.tex.glow, b.x - gs / 2, b.y + bh * 0.6 - gs / 2, gs, gs);
            }
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(b.rot);
            ctx.globalAlpha = alpha;
            ctx.drawImage(b.tex.off, -bw / 2, 0, bw, bh);
            if (b.on > 0.004) {
                ctx.globalAlpha = alpha * b.on;
                ctx.drawImage(b.tex.on, -bw / 2, 0, bw, bh);
            }
            ctx.restore();
        }
        const p = this._pull;
        if (p) {
            ctx.globalAlpha = alpha;
            ctx.save();
            // шнурок качается вокруг точки крепления
            ctx.translate(p.x + p.w / 2, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            ctx.translate(-p.w / 2, 0);
            ctx.fillStyle = 'rgba(26,26,26,0.92)';
            ctx.fillRect(Math.round(p.w / 2 - p.cordW / 2), 0, p.cordW, p.cordLen + p.stretch);
            ctx.drawImage(p.knobImg, 0, p.cordLen + p.stretch, p.w, p.knobH);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    }
}

// для подсказки в меню
Garland.label = () => T('Гирлянда', 'Garland');

module.exports = { Garland };
