/* Тонкая обёртка Canvas 2D с API Cairo (как в GJS): рисунки из версии для
 * GNOME переносятся почти без изменений.
 * Отличия Cairo, которые здесь учтены:
 *  - fill/stroke/clip очищают путь (в Canvas путь остаётся);
 *  - толщина линии по умолчанию 2;
 *  - newSubPath: следующая дуга начинается без соединительной линии. */
'use strict';

function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function rgba(r, g, b, a) {
    return `rgba(${Math.round(clamp01(r) * 255)},${Math.round(clamp01(g) * 255)},${Math.round(clamp01(b) * 255)},${clamp01(a)})`;
}

class Gradient {
    constructor(kind, args) {
        this.kind = kind;
        this.args = args;
        this.stops = [];
    }

    addColorStopRGB(o, r, g, b) {
        this.stops.push([o, rgba(r, g, b, 1)]);
    }

    addColorStopRGBA(o, r, g, b, a) {
        this.stops.push([o, rgba(r, g, b, a)]);
    }

    make(ctx) {
        const g = this.kind === 'linear'
            ? ctx.createLinearGradient(...this.args)
            : ctx.createRadialGradient(...this.args);
        for (const [o, c] of this.stops)
            g.addColorStop(clamp01(o), c);
        return g;
    }
}

class LinearGradient extends Gradient {
    constructor(x0, y0, x1, y1) {
        super('linear', [x0, y0, x1, y1]);
    }
}

class RadialGradient extends Gradient {
    constructor(cx0, cy0, r0, cx1, cy1, r1) {
        super('radial', [cx0, cy0, Math.max(0, r0), cx1, cy1, Math.max(0, r1)]);
    }
}

const CAPS = ['butt', 'round', 'square'];
const JOINS = ['miter', 'round', 'bevel'];

class Context {
    constructor(ctx) {
        this.c = ctx;
        this._sub = false;
        this._hasPoint = false;
        ctx.lineWidth = 2;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.beginPath();
    }

    save() {
        this.c.save();
    }

    restore() {
        this.c.restore();
    }

    translate(x, y) {
        this.c.translate(x, y);
    }

    scale(x, y) {
        this.c.scale(x, y);
    }

    rotate(a) {
        this.c.rotate(a);
    }

    newPath() {
        this.c.beginPath();
        this._hasPoint = false;
    }

    newSubPath() {
        this._sub = true;
        this._hasPoint = false;
    }

    moveTo(x, y) {
        this.c.moveTo(x, y);
        this._sub = false;
        this._hasPoint = true;
    }

    lineTo(x, y) {
        if (!this._hasPoint)
            this.c.moveTo(x, y);
        else
            this.c.lineTo(x, y);
        this._sub = false;
        this._hasPoint = true;
    }

    curveTo(x1, y1, x2, y2, x3, y3) {
        if (!this._hasPoint)
            this.c.moveTo(x1, y1);
        this.c.bezierCurveTo(x1, y1, x2, y2, x3, y3);
        this._hasPoint = true;
    }

    arc(x, y, r, a0, a1) {
        if (this._sub || !this._hasPoint)
            this.c.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0));
        this.c.arc(x, y, Math.max(0, r), a0, a1);
        this._sub = false;
        this._hasPoint = true;
    }

    arcNegative(x, y, r, a0, a1) {
        if (this._sub || !this._hasPoint)
            this.c.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0));
        this.c.arc(x, y, Math.max(0, r), a0, a1, true);
        this._sub = false;
        this._hasPoint = true;
    }

    rectangle(x, y, w, h) {
        this.c.rect(x, y, w, h);
        this._hasPoint = true;
    }

    closePath() {
        this.c.closePath();
    }

    fill() {
        this.c.fill();
        this.newPath();
    }

    fillPreserve() {
        this.c.fill();
    }

    stroke() {
        this.c.stroke();
        this.newPath();
    }

    strokePreserve() {
        this.c.stroke();
    }

    clip() {
        this.c.clip();
        this.newPath();
    }

    // залить всю текущую область отсечения
    paint() {
        const c = this.c;
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillRect(0, 0, c.canvas.width, c.canvas.height);
        c.restore();
    }

    setSourceRGB(r, g, b) {
        this.setSourceRGBA(r, g, b, 1);
    }

    setSourceRGBA(r, g, b, a) {
        const s = rgba(r, g, b, a);
        this.c.fillStyle = s;
        this.c.strokeStyle = s;
    }

    setSource(pattern) {
        const g = pattern.make(this.c);
        this.c.fillStyle = g;
        this.c.strokeStyle = g;
    }

    setLineWidth(w) {
        this.c.lineWidth = w;
    }

    setLineCap(v) {
        this.c.lineCap = CAPS[v] || 'butt';
    }

    setLineJoin(v) {
        this.c.lineJoin = JOINS[v] || 'miter';
    }

    $dispose() {
    }
}

/* Картинка заданного размера (в логических px), нарисованная через обёртку
 * Cairo. OffscreenCanvas не привязан к документу — её можно рисовать на
 * обоих слоях (верхнем и нижнем окне). */
function makeCanvas(w, h, draw, dpr = 1) {
    const cv = new OffscreenCanvas(Math.max(1, Math.ceil(w * dpr)), Math.max(1, Math.ceil(h * dpr)));
    cv.logicalW = w;
    cv.logicalH = h;
    if (draw) {
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cr = new Context(ctx);
        draw(cr, w, h);
    }
    return cv;
}

module.exports = {
    Context, LinearGradient, RadialGradient, makeCanvas, rgba,
    LineCap: { BUTT: 0, ROUND: 1, SQUARE: 2 },
    LineJoin: { MITER: 0, ROUND: 1, BEVEL: 2 },
};
