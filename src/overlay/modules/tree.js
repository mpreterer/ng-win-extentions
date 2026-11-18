/* Christmas Tree — перенос расширения GNOME на Windows.
 *
 * На рабочем столе стоит ёлка, рядом — ящик с игрушками. Игрушку берут из
 * ящика мышью и отпускают над ёлкой — она повисает на этом месте (крючок там,
 * где отпустили). Большая звезда ставится на макушку. Повешенную игрушку
 * можно перевесить или снять: утащить с ёлки — упадёт и исчезнет.
 * Наряд и снег на ветках сохраняются в настройках. Снег на ветках копится,
 * пока идёт снег из эффекта «Снег», и медленно тает без него.
 */
'use strict';

const Cairo = require('../cairo');
const Art = require('./tree-art');
const { FestiveLayer } = require('../runtime');

const MAX_TOYS = 90;
const SNOW_STEP = 10;          // как часто проверять снегопад, с
const SNOW_FILL = 1200;        // за сколько секунд снегопада ветки покрываются полностью
const SNOW_MELT = 3600;        // за сколько секунд без снега тает
const SNOW_MAX = 0.85;         // «немного»: шапки не превращаются в сугробы
const SLOTS = [
    ['ball', 'red'], ['ball', 'blue'], ['ball', 'gold'], ['star'], ['bell'], ['cane'], ['top'],
    ['ball', 'silver'], ['ball', 'green'], ['ball', 'purple'], ['ball', 'pink'], ['icicle'], ['cone'], ['flake'],
];

function rand(a, b) {
    return a + Math.random() * (b - a);
}

class Tree {
    constructor(rt) {
        this.rt = rt;
        this.name = 'tree';
        this.s = rt.S.view('tree');
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
        if (name === 'decorate')
            this.decorate();
        else if (name === 'undecorate')
            this.undecorate();
    }

    start() {
        if (this._running)
            return;
        const rt = this.rt;
        this._running = true;
        this._ids = [];
        this._toys = [];      // повешенные: {t, c, x, y, img, rot, ty, op}
        this._slots = [];
        this._falling = [];
        this._drag = null;
        this._s = undefined;   // при повторном включении всё строится заново
        this._imgCache = {};

        this._fl = new FestiveLayer(rt, this.s, () => {
            if (this._fl && !this._fl.shown)
                this._endDrag(false);
        });
        this._snow = this.s.get('snow-amount');
        this._savedSnow = undefined;
        this._lastPainted = undefined;

        const relayout = () => this._layout();
        this._dispId = rt.on('displays', relayout);
        const on = (key, cb) => this._ids.push(this.s.on(key, cb));
        for (const key of ['position', 'tree-size'])
            on(key, relayout);
        on('show-box', () => rt.redraw());
        on('tree-snow', () => this._snowTick());

        this._layout();
        this._snowId = setInterval(() => this._snowTick(), SNOW_STEP * 1000);
    }

    stop() {
        if (!this._running)
            return;
        this._running = false;
        this._endDrag(false);
        if (this._snowId) {
            clearInterval(this._snowId);
            this._snowId = 0;
        }
        this.s.set('snow-amount', this._snow);
        for (const id of this._ids)
            this.s.off(id);
        this._ids = [];
        this.rt.off(this._dispId);
        for (const o of [...this._toys, ...this._falling])
            this.rt.removeTweens(o);
        this._fl.destroy();
        this._fl = null;
        this._toys = [];
        this._slots = [];
        this._falling = [];
        this.rt.redraw();
    }

    // ---------- раскладка ----------

    _layout() {
        if (!this._running)
            return;
        const s = this.s.get('tree-size');
        const sizeChanged = s !== this._s;
        this._s = s;
        const mon = this.rt.primary;
        if (!mon)
            return;
        const wa = mon.work;
        const ground = wa.y + wa.height - 6;
        const half = Art.TREE_W / 2 * s;
        const boxW = Art.BOX_W * s;
        const pos = this.s.get('position');
        let tx, bx;
        if (pos === 'left') {
            tx = wa.x + half + 10;
            bx = tx + half * 0.85;
        } else if (pos === 'center') {
            tx = wa.x + wa.width / 2;
            bx = tx + half * 0.85;
        } else {
            tx = wa.x + wa.width - half - 10;
            bx = tx - half * 0.85 - boxW;
        }
        this._tx = tx;
        this._ty = ground;
        this._bx = bx;
        this._boxTop = ground - Art.BOX_H * s;
        if (sizeChanged) {
            this._imgCache = {};
            this._treeImg = null;
            this._boxBack = Cairo.makeCanvas(boxW, Art.BOX_H * s, cr => {
                cr.scale(s, s);
                Art.drawBoxBack(cr);
            }, this.rt.dpr);
            this._boxFront = Cairo.makeCanvas(boxW, 30 * s, cr => {
                cr.scale(s, s);
                Art.drawBoxFront(cr);
            }, this.rt.dpr);
            this._buildSlots();
            this._loadDecor();
        } else {
            this._placeSlots();
        }
        this.rt.redraw();
    }

    _treeImage() {
        const snow = this._shownSnow();
        if (!this._treeImg || Math.abs(this._treeImg.snow - snow) > 0.0005) {
            const s = this._s;
            const img = Cairo.makeCanvas(Art.TREE_W * s, (Art.TREE_H + Art.FOOT) * s, cr => {
                cr.scale(s, s);
                cr.translate(Art.TREE_W / 2, Art.TREE_H);
                Art.drawTree(cr, snow);
            }, this.rt.dpr);
            img.snow = snow;
            this._treeImg = img;
        }
        return this._treeImg;
    }

    // ---------- игрушки ----------

    _toyImage(t, c, scale = 1) {
        const key = `${t}:${c}:${scale}`;
        if (!this._imgCache[key]) {
            const [w, h] = Art.TOY_SIZE[t];
            const s = this._s * scale;
            const img = Cairo.makeCanvas(w * s, h * s, cr => {
                cr.scale(s, s);
                Art.drawToy(cr, t, c);
            }, this.rt.dpr);
            // крючок: у звезды на макушке — низ середины, у остальных — верх
            img.hook = t === 'top' ? [w * s / 2, h * s] : [w * s / 2, 3 * s];
            img.w = w * s;
            img.h = h * s;
            this._imgCache[key] = img;
        }
        return this._imgCache[key];
    }

    _buildSlots() {
        this._slots = SLOTS.map(([t, c], i) => ({ t, c, i, img: this._toyImage(t, c, t === 'top' ? 0.6 : 1), x: 0, y: 0 }));
        this._placeSlots();
    }

    // два ряда в ящике: задний повыше, передний пониже
    _placeSlots() {
        const s = this._s;
        const perRow = 7;
        for (const sl of this._slots) {
            const row = Math.floor(sl.i / perRow), col = sl.i % perRow;
            const step = (Art.BOX_W - 24) / perRow;
            const cx = this._bx + (12 + step * (col + 0.5) + (row ? step * 0.3 : 0)) * s;
            const top = this._boxTop + (row ? 2 : -14) * s;
            sl.x = Math.round(cx - sl.img.w / 2);
            sl.y = Math.round(top);
        }
    }

    _swing(toy, deg) {
        this.rt.removeTweens(toy, 'rot');
        toy.rot = deg;
        this.rt.tween(toy, { rot: 0 }, 1600, 'outElastic');
    }

    _hang(toy, save = true, swing = true) {
        toy.img = this._toyImage(toy.t, toy.c);
        toy.rot = toy.rot || 0;
        toy.ty = 0;
        toy.op = 1;
        if (toy.t === 'top') {
            // одна звезда на макушке
            for (const o of [...this._toys]) {
                if (o.t === 'top' && o !== toy)
                    this._dropToy(o);
            }
        }
        if (!this._toys.includes(toy))
            this._toys.push(toy);
        if (swing && toy.t !== 'top')
            this._swing(toy, rand(-18, 18));
        if (save)
            this._save();
        this.rt.redraw();
    }

    // игрушка падает и исчезает
    _dropToy(toy) {
        const i = this._toys.indexOf(toy);
        if (i >= 0)
            this._toys.splice(i, 1);
        this._fall(toy, this._hungScreen(toy));
    }

    // экранная точка крючка повешенной игрушки
    _hungScreen(toy) {
        const s = this._s;
        return [Math.round(this._tx + toy.x * s), Math.round(this._ty + toy.y * s)];
    }

    _fall(toy, [hx, hy]) {
        const f = { img: toy.img || this._toyImage(toy.t, toy.c), hx, hy, rot: toy.rot || 0, ty: 0, op: 1 };
        this._falling.push(f);
        this.rt.tween(f, { ty: 60, op: 0 }, 500, 'inQuad', () => {
            const i = this._falling.indexOf(f);
            if (i >= 0)
                this._falling.splice(i, 1);
            this.rt.redraw();
        });
    }

    _save() {
        const list = this._toys.map(o => ({ t: o.t, c: o.c, x: Math.round(o.x * 10) / 10, y: Math.round(o.y * 10) / 10 }));
        this.s.set('decor', JSON.stringify(list));
    }

    _loadDecor() {
        this._toys = [];
        let list = [];
        try {
            list = JSON.parse(this.s.get('decor'));
        } catch (e) {
            list = [];
        }
        for (const d of Array.isArray(list) ? list : []) {
            if (!Art.TOY_SIZE[d.t] || typeof d.x !== 'number' || typeof d.y !== 'number')
                continue;
            this._hang({ t: d.t, c: d.c, x: d.t === 'top' ? 0 : d.x, y: d.t === 'top' ? Art.APEX + 6 : d.y }, false, false);
        }
    }

    // можно ли повесить крючок в точку (x, y) (в координатах ёлки)
    _onTree(x, y) {
        if (y > -52)
            return false;
        const hw = Art.halfWidthAt(y);
        return hw > 0 && Math.abs(x) <= hw - 3;
    }

    decorate() {
        if (!this._running)
            return;
        const types = ['ball', 'ball', 'ball', 'ball', 'ball', 'bell', 'cane', 'icicle', 'cone', 'flake', 'star'];
        const colors = Object.keys(Art.BALL_COLORS);
        let added = 0;
        for (let tries = 0; tries < 2000 && added < 24 && this._toys.length < MAX_TOYS; tries++) {
            const y = rand(Art.APEX + 30, -60);
            const hw = Art.halfWidthAt(y);
            if (hw <= 10)
                continue;
            const x = rand(-hw + 8, hw - 8);
            if (this._toys.some(o => Math.hypot(o.x - x, o.y - y) < 30))
                continue;
            const t = types[(Math.random() * types.length) | 0];
            this._hang({ t, c: colors[(Math.random() * colors.length) | 0], x, y }, false, true);
            added++;
        }
        if (!this._toys.some(o => o.t === 'top'))
            this._hang({ t: 'top', c: null, x: 0, y: Art.APEX + 6 }, false, false);
        this._save();
    }

    undecorate() {
        if (!this._running)
            return;
        for (const o of [...this._toys])
            this._dropToy(o);
        this._save();
    }

    // ---------- мышь ----------

    _toyRect(toy) {
        const [hx, hy] = this._hungScreen(toy);
        const img = toy.img;
        return { x: hx - img.hook[0], y: hy - img.hook[1], w: img.w, h: img.h };
    }

    hit(x, y, layer) {
        if (!this._running || this._drag || !this._fl || !this._fl.shown || layer !== this._fl.layer)
            return null;
        const inside = (r, px, py) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
        // сверху вниз: повешенные игрушки (последняя — сверху), потом ящик
        for (let i = this._toys.length - 1; i >= 0; i--) {
            const toy = this._toys[i];
            if (!inside(this._toyRect(toy), x, y))
                continue;
            return {
                target: toy,
                cursor: 'grab',
                down: ev => {
                    if (ev.button === 0 && this._toys.includes(toy))
                        this._startDrag(toy, ev);
                },
            };
        }
        if (this.s.get('show-box')) {
            // передний ряд ящика — сверху
            const order = [...this._slots].sort((a, b) => b.i - a.i);
            for (const sl of order) {
                if (!inside({ x: sl.x, y: sl.y, w: sl.img.w, h: sl.img.h }, x, y))
                    continue;
                return {
                    target: sl,
                    cursor: 'grab',
                    down: ev => {
                        if (ev.button === 0)
                            this._startDrag({ t: sl.t, c: sl.c, fromSlot: true }, ev);
                    },
                };
            }
        }
        return null;
    }

    _startDrag(toy, ev) {
        if (this._drag || !this._running)
            return;
        const x = ev.x, y = ev.y;
        let fromTree = false;
        let img;
        let offX = 0, offY;
        if (toy.fromSlot) {
            if (this._toys.length >= MAX_TOYS)
                return;
            toy = { t: toy.t, c: toy.c, x: 0, y: 0, rot: 0 };
            img = this._toyImage(toy.t, toy.c);
            // за что взяли — относительно крючка
            offY = -img.hook[1] - 4;
        } else {
            fromTree = true;
            img = toy.img;
            const r = this._toyRect(toy);
            offX = img.hook[0] - (x - r.x);
            offY = img.hook[1] - (y - r.y);
            this._toys.splice(this._toys.indexOf(toy), 1);
        }
        this.rt.removeTweens(toy);
        toy.rot = 0;
        toy.img = img;
        this._drag = { toy, img, offX, offY, fromTree, orig: fromTree ? [toy.x, toy.y] : null, lastX: x, hx: x + offX, hy: y + offY };
        this._dragHandler = {
            cursor: 'grabbing',
            move: (mx, my) => this._moveDrag(mx, my),
            up: (mx, my) => this._endDrag(true, [mx, my]),
            cancel: () => this._endDrag(false),
        };
        this.rt.capture(this._dragHandler, ev.layer);
        this.rt.redraw();
    }

    _moveDrag(x, y) {
        const d = this._drag;
        if (!d)
            return;
        d.hx = x + d.offX;
        d.hy = y + d.offY;
        // игрушка на ниточке чуть отклоняется при движении
        const v = Math.max(-25, Math.min(25, (x - d.lastX) * 1.5));
        d.lastX = x;
        if (d.toy.t !== 'top')
            d.toy.rot = d.toy.rot * 0.6 - v * 0.4;
        this.rt.redraw();
    }

    _endDrag(drop, coords) {
        const d = this._drag;
        if (!d)
            return;
        this._drag = null;
        if (this.rt._capture === this._dragHandler)
            this.rt.releaseCapture();
        this._dragHandler = null;
        const toy = d.toy;
        if (!this._running)
            return;
        if (drop && coords) {
            const s = this._s;
            const hx = (coords[0] + d.offX - this._tx) / s;
            const hy = (coords[1] + d.offY - this._ty) / s;
            const apexDist = Math.hypot(hx, hy - (Art.APEX + 6));
            if (toy.t === 'top') {
                // большая звезда встаёт только на макушку
                if (apexDist < 60) {
                    toy.x = 0;
                    toy.y = Art.APEX + 6;
                    this._hang(toy);
                    return;
                }
            } else if (this._onTree(hx, hy)) {
                toy.x = hx;
                toy.y = hy;
                this._hang(toy);
                return;
            }
        } else if (!drop && d.fromTree) {
            // Esc — вернуть на прежнее место
            [toy.x, toy.y] = d.orig;
            this._hang(toy, true, false);
            return;
        }
        // мимо ёлки — падает и исчезает
        this._fall(toy, [Math.round(d.hx), Math.round(d.hy)]);
        if (d.fromTree)
            this._save();
        this.rt.redraw();
    }

    tick() {
        if (!this._running)
            return;
        // навели курсор на висящую игрушку — она качнётся
        const h = this.rt.hoverTarget();
        if (h !== this._hovered) {
            this._hovered = h;
            if (h && !this._drag && h.t !== 'top' && this._toys.includes(h))
                this._swing(h, rand(-10, 10));
        }
    }

    // ---------- снег на ветках ----------

    _shownSnow() {
        const mode = this.s.get('tree-snow');
        if (mode === 'never')
            return 0;
        if (mode === 'always')
            return 0.65;
        return this._snow;
    }

    _snowTick() {
        if (!this._running)
            return;
        if (this.s.get('tree-snow') === 'snowfall') {
            const snowing = this.rt.now() - this.rt.snowStamp < 3 && this.rt.snowStamp > 0;
            const prev = this._snow;
            if (snowing)
                this._snow = Math.min(SNOW_MAX, this._snow + SNOW_STEP / SNOW_FILL);
            else
                this._snow = Math.max(0, this._snow - SNOW_STEP / SNOW_MELT);
            // в настройки — не каждый раз, а заметными шагами
            if (this._savedSnow === undefined || Math.abs(this._snow - this._savedSnow) >= 0.05 ||
                (this._snow === 0 && prev > 0)) {
                this._savedSnow = this._snow;
                this.s.set('snow-amount', this._snow);
            }
        }
        const shown = this._shownSnow();
        if (this._lastPainted === undefined || Math.abs(shown - this._lastPainted) >= 0.01) {
            this._lastPainted = shown;
            this._treeImg = null;
            this.rt.redraw(this._fl.layer);
        }
    }

    // ---------- рисование ----------

    _drawToy(ctx, img, hx, hy, rot, ty = 0) {
        ctx.save();
        ctx.translate(hx, hy + ty);
        if (rot)
            ctx.rotate(rot * Math.PI / 180);
        ctx.drawImage(img, -img.hook[0], -img.hook[1], img.w, img.h);
        ctx.restore();
    }

    draw(cr, layer, pass, ctx) {
        if (!this._running || !this._fl || this._s === undefined)
            return;
        if (layer === 'top' && pass === 'over') {
            // перетаскиваемая игрушка — поверх всего
            const d = this._drag;
            if (d)
                this._drawToy(ctx, d.img, Math.round(d.hx), Math.round(d.hy), d.toy.rot);
            return;
        }
        if (pass !== 'main' || layer !== this._fl.layer || !this._fl.visible)
            return;
        const alpha = this._fl.opacity;
        ctx.globalAlpha = alpha;
        const s = this._s;
        const tree = this._treeImage();
        ctx.drawImage(tree, Math.round(this._tx - Art.TREE_W / 2 * s), Math.round(this._ty - Art.TREE_H * s),
            Art.TREE_W * s, (Art.TREE_H + Art.FOOT) * s);
        for (const toy of this._toys) {
            const [hx, hy] = this._hungScreen(toy);
            this._drawToy(ctx, toy.img, hx, hy, toy.rot);
        }
        if (this.s.get('show-box')) {
            ctx.drawImage(this._boxBack, Math.round(this._bx), Math.round(this._boxTop), Art.BOX_W * s, Art.BOX_H * s);
            // задний ряд за передним
            for (const sl of this._slots)
                ctx.drawImage(sl.img, sl.x, sl.y, sl.img.w, sl.img.h);
            ctx.drawImage(this._boxFront, Math.round(this._bx), Math.round(this._ty - 30 * s), Art.BOX_W * s, 30 * s);
        }
        for (const f of this._falling) {
            ctx.globalAlpha = alpha * f.op;
            this._drawToy(ctx, f.img, f.hx, f.hy, f.rot, f.ty);
        }
        ctx.globalAlpha = 1;
    }
}

module.exports = { Tree };
