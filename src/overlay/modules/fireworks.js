/* Fireworks — перенос расширения GNOME на Windows.
 *
 * Фейерверк на рабочем столе: из меню ставите ракету, батарею салютов или
 * фонтан (щелчком в нужное место), подносите к ним курсор — он становится
 * зажигалкой — и зажимаете кнопку мыши: фитиль загорается, искра бежит
 * к заряду, и начинается салют. «Салют сейчас» запускает залп без подготовки.
 *
 * Искры — общие картинки (по одной на цвет), число искр ограничено.
 * Поставленные фейерверки ловят мышь только в своём маленьком прямоугольнике
 * и только когда их не закрывает окно.
 */
'use strict';

const Cairo = require('../cairo');
const Art = require('./fireworks-art');
const { FestiveLayer } = require('../runtime');
const { T } = require('../../i18n');

const TEX = 32;
const MARGIN = 16;          // запас вокруг изделия — легче попасть зажигалкой
const FUSE_TIME = 1.1;      // сколько горит фитиль, с
const HOLD_TIME = 0.3;      // сколько держать зажигалку у фитиля, с
const MAX_PARTICLES = 1400;
const MAX_ITEMS = 30;
const FUSE_BASE = { rocket: [2, -41], battery: [28, -12], fountain: [0, -48] };
const PALETTE = ['red', 'orange', 'gold', 'green', 'cyan', 'blue', 'purple', 'pink', 'silver'];
const BURSTS = ['peony', 'peony', 'ring', 'willow', 'crackle', 'double', 'strobe', 'heart'];

function pick(a) {
    return a[(Math.random() * a.length) | 0];
}

function rand(a, b) {
    return a + Math.random() * (b - a);
}

class Fireworks {
    constructor(rt) {
        this.rt = rt;
        this.name = 'fireworks';
        this.s = rt.S.view('fireworks');
        this._running = false;
        this._itemImg = {};
        this.s.on('enabled', () => this._sync());
        this._sync();
    }

    _sync() {
        if (this.s.get('enabled'))
            this.start();
        else
            this.stop();
    }

    action(name, arg) {
        if (name === 'show') {
            this.show();
        } else if (name === 'place') {
            if (!this.s.get('enabled'))
                this.s.set('enabled', true);
            // меню трея закрывается — ставим чуть позже
            setTimeout(() => this.beginPlace(arg), 150);
        } else if (name === 'clear') {
            this.clearAll();
        }
    }

    start() {
        if (this._running)
            return;
        const rt = this.rt;
        this._running = true;
        this._timers = new Set();
        this._items = [];
        this._particles = [];
        this._shells = [];
        this._emitters = [];
        this._hold = null;
        this._place = null;
        this._lighterOn = false;
        this._flame = 1;
        this._flameY = 1;
        this._time = 0;

        this._tex = {};
        for (const [name, rgb] of Object.entries(Art.COLORS))
            this._tex[name] = Cairo.makeCanvas(TEX, TEX, (cr, w) => Art.drawGlow(cr, w, rgb), rt.dpr);
        this._lighterBody = Cairo.makeCanvas(Art.LIGHTER_W, Art.LIGHTER_H, (cr, w) => Art.drawLighterBody(cr, w), rt.dpr);
        this._flameImg = Cairo.makeCanvas(12, 22, (cr, w, h) => Art.drawFlame(cr, w, h), rt.dpr);

        this._fl = new FestiveLayer(rt, this.s, () => {
            if (!this._fl || !this._fl.shown)
                this._cancelPlace();
        });
        this._loadItems();
    }

    stop() {
        if (!this._running)
            return;
        this._running = false;
        this._cancelPlace();
        this._endHold();
        for (const id of this._timers)
            clearTimeout(id);
        this._timers.clear();
        for (const it of this._items)
            this.rt.removeTweens(it);
        this._fl.destroy();
        this._fl = null;
        this._items = [];
        this._particles = [];
        this._shells = [];
        this._emitters = [];
        this._tex = null;
        this.rt.redraw();
    }

    _later(sec, cb) {
        const id = setTimeout(() => {
            this._timers.delete(id);
            if (this._running)
                cb();
        }, Math.round(sec * 1000));
        this._timers.add(id);
    }

    _screen() {
        return [this.rt.W, this.rt.H];
    }

    // ---------- поставленные фейерверки ----------

    _image(kind, burnt) {
        const key = `${kind}:${burnt ? 1 : 0}`;
        if (!this._itemImg[key]) {
            const K = Art.KINDS[kind];
            const w = K.w + 2 * MARGIN, h = K.h + 2 * MARGIN;
            this._itemImg[key] = Cairo.makeCanvas(w, h, cr => {
                cr.translate(w / 2, h - MARGIN);
                Art.drawItem(cr, kind, burnt);
            }, this.rt.dpr);
        }
        return this._itemImg[key];
    }

    _loadItems() {
        let list = [];
        try {
            list = JSON.parse(this.s.get('placed'));
        } catch (e) {
            list = [];
        }
        const [W, H] = this._screen();
        for (const d of Array.isArray(list) ? list : []) {
            if (Art.KINDS[d.k] && d.x >= 0 && d.x <= W && d.y >= 0 && d.y <= H + 5)
                this._addItem(d.k, d.x, d.y, false, false);
        }
    }

    _save() {
        const list = this._items.filter(it => it.state === 'idle').map(it => ({ k: it.kind, x: Math.round(it.x), y: Math.round(it.y) }));
        this.s.set('placed', JSON.stringify(list));
    }

    _addItem(kind, x, y, save = true, animate = true) {
        if (this._items.filter(it => it.state === 'idle').length >= MAX_ITEMS)
            return null;
        const K = Art.KINDS[kind];
        const w = K.w + 2 * MARGIN, h = K.h + 2 * MARGIN;
        const it = { kind, x, y, w, h, state: 'idle', burnt: false, sc: 1, op: 1 };
        this._items.push(it);
        if (animate) {
            it.sc = 0.4;
            this.rt.tween(it, { sc: 1 }, 320, 'outBack');
        }
        if (save)
            this._save();
        this.rt.redraw();
        return it;
    }

    _removeItem(it, save) {
        const i = this._items.indexOf(it);
        if (i >= 0)
            this._items.splice(i, 1);
        this.rt.removeTweens(it);
        if (save)
            this._save();
        this.rt.redraw();
    }

    clearAll() {
        if (!this._running)
            return;
        for (const it of [...this._items]) {
            if (it.state === 'idle')
                this._removeItem(it, false);
        }
        this._save();
    }

    _itemAt(x, y) {
        for (let i = this._items.length - 1; i >= 0; i--) {
            const it = this._items[i];
            if (it.state !== 'idle')
                continue;
            const left = Math.round(it.x - it.w / 2), top = Math.round(it.y - it.h + MARGIN);
            if (x >= left && x < left + it.w && y >= top && y < top + it.h)
                return it;
        }
        return null;
    }

    // Мышь ловят только видимые фейерверки: под окном клики уходят окну.
    hit(x, y, layer) {
        if (!this._running || this._place || !this._fl || !this._fl.shown || layer !== this._fl.layer)
            return null;
        const it = this._itemAt(x, y);
        if (!it)
            return null;
        return {
            target: it,
            cursor: 'none',   // курсор — зажигалка
            down: ev => {
                if (ev.button === 2) {
                    // правая кнопка — убрать фейерверк
                    this._removeItem(it, true);
                    return;
                }
                if (ev.button !== 0)
                    return;
                this._hold = { item: it, t: 0 };
                this._holdHandler = {
                    cursor: 'none',
                    move: (mx, my) => {
                        // увели зажигалку с фейерверка — не поджигаем
                        if (this._hold && this._itemAt(mx, my) !== this._hold.item)
                            this._hold = null;
                        this.rt.redraw('top');
                    },
                    up: () => {
                        this._hold = null;
                        this._holdHandler = null;
                    },
                    cancel: () => {
                        this._hold = null;
                        this._holdHandler = null;
                    },
                };
                this.rt.capture(this._holdHandler, ev.layer);
            },
        };
    }

    _endHold() {
        this._hold = null;
        if (this._holdHandler && this.rt._capture === this._holdHandler)
            this.rt.releaseCapture();
        this._holdHandler = null;
    }

    // ---------- установка: щелчок по экрану ставит фейерверк ----------

    beginPlace(kind) {
        if (!this._running || !Art.KINDS[kind])
            return;
        this._cancelPlace();
        if (this._fl.mode === 'desktop' && !this._fl.shown)
            return;
        const [W, H] = this._screen();
        this._place = { kind };
        const hint = this._hintEl();
        hint.textContent = T('Щёлкните, куда поставить. Правая кнопка или Esc — готово',
            'Click where to put it. Right click or Esc — done');
        const mon = this.rt.primary;
        hint.style.left = `${Math.round(mon.bounds.x + mon.bounds.width / 2)}px`;
        hint.style.top = `${Math.round(mon.work.y + 16)}px`;
        hint.style.display = 'block';
        this.rt.setModal({
            cursor: 'crosshair',
            down: ev => {
                if (ev.button === 0)
                    this._addItem(kind, Math.max(0, Math.min(W, ev.x)), Math.max(0, Math.min(H, ev.y)));
                else
                    this._cancelPlace();
            },
            move: () => this.rt.redraw('top'),
            cancel: () => this._cancelPlace(),
        });
        this.rt.redraw('top');
    }

    _hintEl() {
        let el = document.getElementById('fw-hint');
        if (!el) {
            el = document.createElement('div');
            el.id = 'fw-hint';
            el.style.cssText = 'position:fixed;transform:translateX(-50%);display:none;background:rgba(0,0,0,0.72);' +
                'color:#fff;padding:8px 14px;border-radius:10px;font:13px "Segoe UI",sans-serif;pointer-events:none;white-space:nowrap;';
            document.body.appendChild(el);
        }
        return el;
    }

    _cancelPlace() {
        if (!this._place)
            return;
        this._place = null;
        this._hintEl().style.display = 'none';
        this.rt.clearModal();
        this.rt.redraw('top');
    }

    // ---------- поджиг ----------

    _ignite(it) {
        it.state = 'lit';
        it.litAt = this._time;
        this._save();
        this._endHold();
        const [fx, fy] = Art.KINDS[it.kind].fuse;
        const [bx, by] = FUSE_BASE[it.kind];
        // искра бежит по фитилю от кончика к заряду
        this._emitters.push({
            until: this._time + FUSE_TIME,
            rate: 70,
            acc: 0,
            pos: () => {
                const p = Math.min(1, (this._time - it.litAt) / FUSE_TIME);
                return [it.x + fx + (bx - fx) * p, it.y + fy + (by - fy) * p];
            },
            spawn: (x, y) => this._spark(x, y, pick(['gold', 'white', 'orange']), {
                vx: rand(-90, 90), vy: rand(-140, 20), life: rand(0.15, 0.35), size: rand(5, 8), drag: 3, g: 300,
            }),
            done: () => this._launch(it),
        });
    }

    _launch(it) {
        if (!this._running || !this._items.includes(it))
            return;
        it.burnt = true;
        const scale = this._burstScale();
        if (it.kind === 'rocket') {
            // ракета улетает вместе с палочкой — на месте ничего не остаётся
            this._removeItem(it, false);
            this._shell(it.x, it.y - 70, rand(-40, 40), null, { scale: scale * 1.15 });
        } else if (it.kind === 'battery') {
            const shots = 12;
            let t = 0;
            for (let i = 0; i < shots; i++) {
                this._later(t, () => {
                    // выстрел из трубки: вспышка над коробкой и снаряд
                    this._spark(it.x + rand(-20, 20), it.y - 46, 'gold', { life: 0.12, size: 22, drag: 0, g: 0 });
                    this._shell(it.x + rand(-20, 20), it.y - 46, rand(-160, 160), null, { scale: scale * rand(0.6, 0.85), apexFrac: rand(0.25, 0.55) });
                });
                t += rand(0.28, 0.5);
            }
            this._later(t, () => this._retire(it, 0.8));
        } else {
            const color = pick(['gold', 'silver']);
            this._emitters.push({
                until: this._time + 5.5,
                rate: 150,
                acc: 0,
                pos: () => [it.x, it.y - 50],
                spawn: (x, y) => {
                    const a = -Math.PI / 2 + rand(-0.32, 0.32);
                    const sp = rand(320, 640);
                    this._spark(x, y, Math.random() < 0.8 ? color : 'white', {
                        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.7, 1.25), size: rand(6, 10), drag: 0.9, g: 520,
                    });
                },
                done: () => this._retire(it, 0.4),
            });
        }
    }

    // отработавший фейерверк гаснет и исчезает
    _retire(it, sec) {
        this._later(sec, () => {
            if (!this._items.includes(it))
                return;
            this.rt.tween(it, { op: 0 }, 900, 'inQuad', () => this._removeItem(it, false));
        });
    }

    _burstScale() {
        return this.s.get('burst-size') / 100;
    }

    // ---------- залп без подготовки ----------

    show() {
        if (!this._running)
            return;
        if (this._fl.mode === 'desktop' && !this._fl.shown)
            return;
        const mon = this.rt.primary;
        let t = 0;
        for (let i = 0; i < 9; i++) {
            this._later(t, () => {
                const x = mon.bounds.x + mon.bounds.width * rand(0.12, 0.88);
                this._shell(x, mon.work.y + mon.work.height, rand(-60, 60), null, { scale: this._burstScale() * rand(0.85, 1.15) });
            });
            t += rand(0.35, 0.8);
        }
    }

    // ---------- снаряды и взрывы ----------

    _shell(x, y, vx, burst, opts = {}) {
        const mon = this.rt.displays.find(m => x >= m.bounds.x && x < m.bounds.x + m.bounds.width) || this.rt.primary;
        const frac = opts.apexFrac ?? rand(0.15, 0.4);
        const apexY = mon.bounds.y + mon.bounds.height * frac;
        const dist = Math.max(80, y - apexY);
        // скорость, чтобы долететь почти до верхней точки при «гравитации» 380
        const vy = -Math.sqrt(2 * 380 * dist) * 1.05;
        const head = this._spark(x, y, 'gold', { life: 99, size: 9, drag: 0, g: 0, keep: true });
        if (!head)
            return;
        this._shells.push({
            x, y, vx, vy, apexY, head,
            burst: burst || pick(BURSTS),
            colors: [pick(PALETTE), pick(PALETTE)],
            scale: opts.scale ?? 1,
            trail: 0,
        });
    }

    _burst(s) {
        const [, H] = this._screen();
        const scale = s.scale;
        const N = Math.round(this.s.get('burst-size') * Math.min(1.3, Math.max(0.5, scale)));
        const S = H * 0.5 * Math.max(0.5, scale);
        const [c1, c2] = s.colors;
        this._spark(s.x, s.y, 'white', { life: 0.16, size: 90 * scale, drag: 0, g: 0, fadeFast: true });
        const add = (ang, sp, color, o = {}) => this._spark(s.x, s.y, color, Object.assign({
            vx: Math.cos(ang) * sp + s.vx * 0.3, vy: Math.sin(ang) * sp + s.vy * 0.2,
            life: rand(1.2, 1.8), size: rand(9, 13), drag: 1.6, g: 95,
        }, o));
        switch (s.burst) {
        case 'ring':
            for (let i = 0; i < N; i++)
                add(i / N * Math.PI * 2, S * rand(0.88, 0.95), i % 2 ? c1 : c2, { life: rand(1.2, 1.5) });
            break;
        case 'willow':
            for (let i = 0; i < N; i++)
                add(Math.random() * Math.PI * 2, S * 0.8 * Math.sqrt(Math.random()), 'gold', { life: rand(2.6, 3.4), size: rand(8, 11), drag: 2.2, g: 70, trail: true });
            break;
        case 'crackle':
            for (let i = 0; i < N; i++)
                add(Math.random() * Math.PI * 2, S * rand(0.4, 1), pick(['gold', 'silver']), { crackle: true, life: rand(1.0, 1.5) });
            break;
        case 'double':
            for (let i = 0; i < N; i++) {
                const inner = i % 2 === 0;
                add(Math.random() * Math.PI * 2, S * (inner ? rand(0.45, 0.55) : rand(0.85, 1)), inner ? c2 : c1);
            }
            break;
        case 'strobe':
            for (let i = 0; i < N; i++)
                add(Math.random() * Math.PI * 2, S * rand(0.5, 1), pick(['white', 'silver']), { strobe: true, life: rand(1.4, 2) });
            break;
        case 'heart':
            // сердечко (праздник же)
            for (let i = 0; i < N; i++) {
                const t = i / N * Math.PI * 2;
                const hx = 16 * Math.pow(Math.sin(t), 3);
                const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
                const k = S / 17 * 0.85;
                this._spark(s.x, s.y, i % 3 ? 'pink' : 'red', {
                    vx: hx * k, vy: -hy * k, life: rand(1.3, 1.6), size: rand(9, 12), drag: 1.6, g: 40,
                });
            }
            break;
        default: // peony — шар искр
            for (let i = 0; i < N; i++)
                add(Math.random() * Math.PI * 2, S * Math.sqrt(1 - Math.pow(Math.random(), 2)), i % 4 === 0 ? c2 : c1);
        }
    }

    // ---------- искры ----------

    _spark(x, y, color, o) {
        if (this._particles.length >= MAX_PARTICLES && !o.keep)
            return null;
        const size = o.size ?? 10;
        const p = {
            tex: this._tex[color] || this._tex.white,
            x, y, size,
            vx: o.vx ?? 0, vy: o.vy ?? 0,
            life: o.life ?? 1, max: o.life ?? 1,
            drag: o.drag ?? 1.5, g: o.g ?? 90,
            trail: o.trail, crackle: o.crackle, strobe: o.strobe, fadeFast: o.fadeFast,
            keep: o.keep, trailT: 0,
            op: 1, sc: 1,
        };
        this._particles.push(p);
        return p;
    }

    // ---------- кадр ----------

    _busy() {
        return this._particles.length > 0 || this._shells.length > 0 || this._emitters.length > 0;
    }

    tick(now, dtFrame) {
        if (!this._running)
            return;
        const dt = Math.min(0.05, Math.max(0.001, dtFrame));
        this._time += dt;
        const time = this._time;

        // зажигалка: видна над фейерверком, пламя дрожит, у фитиля — разгорается
        const hoverItem = this.rt.hoverTarget();
        const lighter = !this._place && (this._hold !== null ||
            (hoverItem && this._items.includes(hoverItem) && hoverItem.state === 'idle'));
        if (lighter || this._lighterOn) {
            this._lighterOn = !!lighter;
            const big = this._hold ? 1.45 : 1;
            this._flame = big * rand(0.85, 1.05);
            this._flameY = big * rand(0.85, 1.15);
            this.rt.redraw('top');
        }
        if (this._hold) {
            this._hold.t += dt;
            if (this._hold.t >= HOLD_TIME) {
                const it = this._hold.item;
                this._endHold();
                if (this._items.includes(it) && it.state === 'idle')
                    this._ignite(it);
            }
        }
        if (!this._busy())
            return;
        this.rt.fast();

        // фитили и фонтаны
        for (const e of [...this._emitters]) {
            if (time >= e.until) {
                this._emitters.splice(this._emitters.indexOf(e), 1);
                e.done?.();
                continue;
            }
            e.acc += e.rate * dt;
            const [x, y] = e.pos();
            while (e.acc >= 1) {
                e.acc -= 1;
                e.spawn(x, y);
            }
        }

        // летящие снаряды
        for (const s of [...this._shells]) {
            s.vy += 380 * dt;
            s.vx *= Math.exp(-0.4 * dt);
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            const h = s.head;
            h.x = s.x;
            h.y = s.y;
            s.trail += dt;
            while (s.trail > 0.012) {
                s.trail -= 0.012;
                this._spark(s.x + rand(-1.5, 1.5), s.y + 4, pick(['gold', 'orange']), {
                    vx: rand(-25, 25), vy: rand(30, 110), life: rand(0.25, 0.5), size: rand(4, 7), drag: 2.5, g: 120,
                });
            }
            if (s.y <= s.apexY || s.vy >= -60) {
                this._shells.splice(this._shells.indexOf(s), 1);
                h.life = 0;
                this._burst(s);
            }
        }

        // искры
        const parts = this._particles;
        const born = [];
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.life -= dt;
            if (p.life <= 0) {
                if (p.crackle && parts.length < MAX_PARTICLES) {
                    // треск: каждая искра лопается белыми вспышками
                    for (let k = 0; k < 2; k++)
                        born.push([p.x, p.y, 'white', { vx: rand(-80, 80), vy: rand(-80, 80), life: rand(0.08, 0.16), size: rand(6, 10), drag: 2, g: 0, fadeFast: true }]);
                }
                parts[i] = parts[parts.length - 1];
                parts.pop();
                continue;
            }
            if (!p.keep) {
                const d = Math.exp(-p.drag * dt);
                p.vx *= d;
                p.vy = p.vy * d + p.g * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
            }
            const t = p.life / p.max;
            let alpha = p.fadeFast ? t : (t < 0.35 ? t / 0.35 : 1);
            if (p.strobe)
                alpha *= Math.random() < 0.45 ? 1 : 0.12;
            p.op = Math.max(0, Math.min(1, alpha));
            p.sc = p.keep ? rand(0.85, 1.1) : 0.55 + 0.45 * t;
            if (p.trail) {
                p.trailT += dt;
                if (p.trailT > 0.05 && parts.length < MAX_PARTICLES * 0.8) {
                    p.trailT = 0;
                    born.push([p.x, p.y, 'gold', { vx: 0, vy: 10, life: rand(0.4, 0.7), size: rand(4, 6), drag: 3, g: 30 }]);
                }
            }
        }
        for (const [x, y, color, o] of born)
            this._spark(x, y, color, o);
        this.rt.redraw(this._fl.layer);
    }

    // ---------- рисование ----------

    _drawItem(ctx, kind, burnt, x, y, sc = 1) {
        const img = this._image(kind, burnt);
        const w = img.logicalW, h = img.logicalH;
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y));
        if (sc !== 1)
            ctx.scale(sc, sc);
        ctx.drawImage(img, -w / 2, -(h - MARGIN), w, h);
        ctx.restore();
    }

    draw(cr, layer, pass, ctx) {
        if (!this._running || !this._fl)
            return;
        if (layer === 'top' && pass === 'over') {
            const P = this.rt.P;
            if (this._place) {
                // «призрак» фейерверка под курсором
                ctx.globalAlpha = 170 / 255;
                this._drawItem(ctx, this._place.kind, false, P.x, P.y);
                ctx.globalAlpha = 1;
            } else if (this._lighterOn) {
                // зажигалка: кончик пламени — точка курсора
                const bx = (Art.LIGHTER_W - 20) / 2;
                ctx.save();
                ctx.translate(Math.round(P.x), Math.round(P.y));
                ctx.drawImage(this._lighterBody, -(bx + 9), 22, Art.LIGHTER_W, Art.LIGHTER_H);
                // пламя растёт от основания (pivot — низ пламени)
                ctx.translate(0, 22);
                ctx.scale(this._flame, this._flameY);
                ctx.drawImage(this._flameImg, -6, -22, 12, 22);
                ctx.restore();
            }
            return;
        }
        if (pass !== 'main' || layer !== this._fl.layer || !this._fl.visible)
            return;
        const alpha = this._fl.opacity;
        for (const it of this._items) {
            ctx.globalAlpha = alpha * it.op;
            this._drawItem(ctx, it.kind, it.burnt, it.x, it.y, it.sc);
        }
        for (const p of this._particles) {
            if (p.op <= 0.004)
                continue;
            ctx.globalAlpha = alpha * p.op;
            const sz = p.size * p.sc;
            ctx.drawImage(p.tex, p.x - sz / 2, p.y - sz / 2, sz, sz);
        }
        ctx.globalAlpha = 1;
    }
}

module.exports = { Fireworks };
