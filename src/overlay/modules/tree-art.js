/* Рисунки ёлки и игрушек (Cairo, всё кодом).
 *
 * Ёлка: начало координат — середина низа подставки, ось y вверх
 * отрицательная. Пять ярусов-треугольников с колючими краями и свисающими
 * лапами; снег — белые шапки на лапах, толщина зависит от snow (0..1).
 * Игрушки: у каждой «крючок» в верхней середине картинки (у звезды на
 * макушке — низ середины).
 */
// Перенесено из версии для GNOME без изменений (Cairo → обёртка Canvas).
'use strict';

const Cairo = require('../cairo');

// [низ яруса, верх яруса, полуширина низа]
const TIERS = [[-44, -176, 128], [-116, -236, 104], [-178, -292, 81], [-234, -338, 59], [-284, -378, 38]];
const APEX = -378;
const TREE_W = 300;
const TREE_H = 430;      // с запасом над макушкой под звезду
const FOOT = 8;          // запас под подставкой (тень)

// полуширина ёлки на высоте y (или -1, если там нет веток)
function halfWidthAt(y) {
    let hw = -1;
    for (const [b, t, w] of TIERS) {
        if (y <= b + 6 && y >= t)
            hw = Math.max(hw, w * Math.min(1, (y - t) / (b - t)));
    }
    return hw;
}

function hash(k) {
    let x = Math.imul(k + 17, 0x9e3779b1) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
    return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}

function tierPath(cr, b, t, w, seed) {
    const m = 6;
    cr.moveTo(0, t);
    // левый край с колючками
    for (let j = 1; j <= m; j++) {
        const f = j / m;
        const x = -w * f, y = t + (b - t) * f;
        cr.lineTo(x - 5 - hash(seed + j) * 5, y + 3);
        cr.lineTo(x + 3, y - 1);
    }
    // низ — свисающие лапы
    const n = Math.max(3, Math.round(w / 17));
    for (let k = 0; k < n; k++) {
        const x0 = -w + (2 * w) * k / n, x1 = -w + (2 * w) * (k + 1) / n;
        const sag = 7 + hash(seed + 40 + k) * 6;
        cr.curveTo(x0 + (x1 - x0) * 0.25, b + sag, x0 + (x1 - x0) * 0.75, b + sag, x1, b);
    }
    // правый край
    for (let j = m; j >= 1; j--) {
        const f = j / m;
        const x = w * f, y = t + (b - t) * f;
        cr.lineTo(x - 3, y - 1);
        cr.lineTo(x + 5 + hash(seed + 20 + j) * 5, y + 3);
    }
    cr.lineTo(0, t);
    cr.closePath();
}

function drawTree(cr, snow) {
    // ствол — ёлка стоит прямо на нём
    const tg = new Cairo.LinearGradient(-10, 0, 10, 0);
    tg.addColorStopRGB(0, 0.28, 0.16, 0.07);
    tg.addColorStopRGB(0.45, 0.5, 0.31, 0.15);
    tg.addColorStopRGB(1, 0.24, 0.13, 0.06);
    cr.setSource(tg);
    cr.moveTo(-10, -60);
    cr.lineTo(10, -60);
    cr.lineTo(12, 0);
    cr.lineTo(-12, 0);
    cr.closePath();
    cr.fill();

    // ярусы снизу вверх
    TIERS.forEach(([b, t, w], i) => {
        const g = new Cairo.LinearGradient(-w, 0, w, 0);
        g.addColorStopRGB(0, 0.04, 0.26, 0.11);
        g.addColorStopRGB(0.45, 0.1, 0.46, 0.2);
        g.addColorStopRGB(1, 0.03, 0.22, 0.09);
        tierPath(cr, b, t, w, i * 100);
        cr.setSource(g);
        cr.fillPreserve();
        // тень внизу яруса — объём
        const v = new Cairo.LinearGradient(0, t, 0, b + 12);
        v.addColorStopRGBA(0, 0, 0, 0, 0);
        v.addColorStopRGBA(0.6, 0, 0.05, 0, 0.12);
        v.addColorStopRGBA(1, 0, 0.08, 0.02, 0.4);
        cr.setSource(v);
        cr.fill();
        // хвоинки
        cr.setLineWidth(1);
        for (let k = 0; k < Math.round(w * 0.7); k++) {
            const fy = 0.15 + 0.85 * hash(i * 1000 + k);
            const y = t + (b - t) * fy;
            const hw = w * fy * 0.92;
            const x = -hw + 2 * hw * hash(i * 1000 + k + 500);
            const light = hash(i * 1000 + k + 900) < 0.5;
            cr.setSourceRGBA(light ? 0.25 : 0.02, light ? 0.62 : 0.2, light ? 0.3 : 0.08, 0.55);
            const dir = x < 0 ? -1 : 1;
            cr.moveTo(x, y);
            cr.lineTo(x + dir * 5, y + 3);
            cr.stroke();
        }
        // снег на лапах
        if (snow > 0.02) {
            const n = Math.max(3, Math.round(w / 17));
            const th = 0.6 + snow * 7.5;
            for (let k = 0; k < n; k++) {
                const x0 = -w + (2 * w) * (k + 0.5) / n;
                const bw = (w / n) * (0.3 + snow * 0.65);
                const y = b - 2 - Math.abs(x0) / w * 2;
                cr.setSourceRGBA(0.6, 0.7, 0.88, 0.45);
                cr.save();
                cr.translate(x0, y + 1.5);
                cr.scale(bw, th);
                cr.arc(0, 0, 1, Math.PI, 2 * Math.PI);
                cr.restore();
                cr.fill();
                cr.setSourceRGBA(1, 1, 1, 0.96);
                cr.save();
                cr.translate(x0, y);
                cr.scale(bw * 0.95, th);
                cr.arc(0, 0, 1, Math.PI, 2 * Math.PI);
                cr.restore();
                cr.fill();
            }
            // по краям ярусов — полоски снега на верхних лапах
            for (let j = 2; j <= 5; j++) {
                const f = j / 6;
                for (const side of [-1, 1]) {
                    const x = side * w * f * 0.9, y = t + (b - t) * f;
                    cr.setSourceRGBA(1, 1, 1, 0.9 * Math.min(1, snow * 1.5));
                    cr.save();
                    cr.translate(x, y - 1);
                    cr.rotate(side * 0.5);
                    cr.scale(6 + snow * 4, 1 + snow * 2.5);
                    cr.arc(0, 0, 1, Math.PI, 2 * Math.PI);
                    cr.restore();
                    cr.fill();
                }
            }
        }
    });
    if (snow > 0.02) {
        // шапка на макушке
        cr.setSourceRGBA(1, 1, 1, 0.96);
        cr.moveTo(0, APEX - 1);
        cr.lineTo(-7 - snow * 4, APEX + 12 + snow * 6);
        cr.curveTo(-3, APEX + 9, 3, APEX + 13, 7 + snow * 4, APEX + 12 + snow * 6);
        cr.closePath();
        cr.fill();
    }
}

// ---------- игрушки ----------

// [ширина, высота] картинки игрушки (до масштаба)
const TOY_SIZE = {
    ball: [26, 34], star: [40, 40], bell: [26, 34], cane: [20, 38],
    icicle: [12, 42], cone: [20, 34], flake: [30, 34], top: [52, 52],
};

const BALL_COLORS = {
    red: [0.86, 0.1, 0.13], blue: [0.15, 0.35, 0.9], gold: [0.95, 0.72, 0.15],
    silver: [0.78, 0.82, 0.88], green: [0.1, 0.65, 0.3], purple: [0.6, 0.2, 0.8],
    pink: [0.95, 0.4, 0.7],
};

function hook(cr, cx) {
    cr.setSourceRGBA(0.8, 0.75, 0.5, 0.9);
    cr.setLineWidth(1);
    cr.arc(cx, 3, 2.2, Math.PI, 2 * Math.PI);
    cr.stroke();
    cr.moveTo(cx, 3);
    cr.lineTo(cx, 7);
    cr.stroke();
}

function star(cr, x, y, R, r) {
    for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5;
        const rr = k % 2 ? r : R;
        if (k === 0)
            cr.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else
            cr.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    cr.closePath();
}

function drawToy(cr, type, color) {
    const [w, h] = TOY_SIZE[type];
    const cx = w / 2;
    if (type === 'ball') {
        const [r, g, b] = BALL_COLORS[color] || BALL_COLORS.red;
        hook(cr, cx);
        cr.setSourceRGB(0.9, 0.75, 0.3);
        cr.rectangle(cx - 3, 6, 6, 4);
        cr.fill();
        const R = 11.5, cy = 21.5;
        const grad = new Cairo.RadialGradient(cx - 4, cy - 4, 1, cx, cy, R);
        grad.addColorStopRGB(0, Math.min(1, r + 0.55), Math.min(1, g + 0.55), Math.min(1, b + 0.55));
        grad.addColorStopRGB(0.35, r, g, b);
        grad.addColorStopRGB(1, r * 0.45, g * 0.45, b * 0.45);
        cr.setSource(grad);
        cr.arc(cx, cy, R, 0, 2 * Math.PI);
        cr.fill();
        // узор-поясок
        cr.setSourceRGBA(1, 1, 1, 0.55);
        cr.setLineWidth(1.3);
        cr.save();
        cr.translate(cx, cy + 1);
        cr.scale(R, 3);
        cr.arc(0, 0, 1, 0, Math.PI);
        cr.restore();
        cr.stroke();
        cr.setSourceRGBA(1, 1, 1, 0.7);
        cr.arc(cx - 4.5, cy - 4.5, 2.2, 0, 2 * Math.PI);
        cr.fill();
    } else if (type === 'star' || type === 'top') {
        const big = type === 'top';
        const R = big ? 24 : 15, cy = big ? 26 : 22;
        if (!big)
            hook(cr, cx);
        // сияние
        const glow = new Cairo.RadialGradient(cx, cy, 0, cx, cy, R * 1.1);
        glow.addColorStopRGBA(0, 1, 0.95, 0.6, 0.55);
        glow.addColorStopRGBA(1, 1, 0.85, 0.3, 0);
        cr.setSource(glow);
        cr.arc(cx, cy, R * 1.1, 0, 2 * Math.PI);
        cr.fill();
        const g = new Cairo.RadialGradient(cx - 3, cy - 4, 1, cx, cy, R);
        g.addColorStopRGB(0, 1, 0.98, 0.7);
        g.addColorStopRGB(0.5, 1, 0.8, 0.15);
        g.addColorStopRGB(1, 0.85, 0.5, 0.05);
        cr.setSource(g);
        star(cr, cx, cy, R * 0.92, R * 0.4);
        cr.fillPreserve();
        cr.setSourceRGBA(0.6, 0.35, 0, 0.6);
        cr.setLineWidth(1);
        cr.stroke();
    } else if (type === 'bell') {
        hook(cr, cx);
        const g = new Cairo.LinearGradient(cx - 11, 0, cx + 11, 0);
        g.addColorStopRGB(0, 0.75, 0.52, 0.08);
        g.addColorStopRGB(0.4, 1, 0.88, 0.45);
        g.addColorStopRGB(1, 0.65, 0.42, 0.05);
        cr.setSource(g);
        cr.moveTo(cx - 4, 9);
        cr.curveTo(cx - 9, 10, cx - 8, 22, cx - 12, 28);
        cr.lineTo(cx + 12, 28);
        cr.curveTo(cx + 8, 22, cx + 9, 10, cx + 4, 9);
        cr.closePath();
        cr.fill();
        cr.setSourceRGB(0.55, 0.38, 0.05);
        cr.arc(cx, 30, 2.6, 0, 2 * Math.PI);
        cr.fill();
        // бантик
        cr.setSourceRGB(0.85, 0.1, 0.12);
        cr.moveTo(cx, 9);
        cr.lineTo(cx - 7, 5);
        cr.lineTo(cx - 7, 12);
        cr.closePath();
        cr.moveTo(cx, 9);
        cr.lineTo(cx + 7, 5);
        cr.lineTo(cx + 7, 12);
        cr.closePath();
        cr.fill();
    } else if (type === 'cane') {
        // леденец-трость
        cr.setLineCap(1);
        cr.setLineWidth(5.5);
        cr.setSourceRGB(1, 1, 1);
        cr.moveTo(cx + 3, 36);
        cr.lineTo(cx + 3, 11);
        cr.arc(cx - 2, 11, 5, 0, Math.PI);
        cr.stroke();
        cr.setSourceRGB(0.85, 0.08, 0.12);
        cr.setLineWidth(2.2);
        for (let y = 15; y < 36; y += 5) {
            cr.moveTo(cx + 0.5, y + 2);
            cr.lineTo(cx + 5.5, y - 1);
        }
        cr.stroke();
        cr.arc(cx - 2, 11, 5, -0.2, 0.5);
        cr.stroke();
        cr.arc(cx - 2, 11, 5, Math.PI * 0.55, Math.PI * 0.95);
        cr.stroke();
    } else if (type === 'icicle') {
        hook(cr, cx);
        const g = new Cairo.LinearGradient(cx - 5, 0, cx + 5, 0);
        g.addColorStopRGBA(0, 0.6, 0.8, 1, 0.85);
        g.addColorStopRGBA(0.4, 1, 1, 1, 0.95);
        g.addColorStopRGBA(1, 0.5, 0.7, 0.95, 0.85);
        cr.setSource(g);
        cr.moveTo(cx - 5, 8);
        cr.lineTo(cx + 5, 8);
        cr.lineTo(cx, 41);
        cr.closePath();
        cr.fill();
    } else if (type === 'cone') {
        hook(cr, cx);
        for (let row = 0; row < 6; row++) {
            const y = 10 + row * 4;
            const rw = 8 - Math.abs(row - 2) * 1.3;
            for (let k = -1; k <= 1; k++) {
                cr.setSourceRGB(0.45 + row * 0.03, 0.26, 0.1);
                cr.save();
                cr.translate(cx + k * rw * 0.6, y + 3);
                cr.scale(rw * 0.45, 3.2);
                cr.arc(0, 0, 1, 0, Math.PI);
                cr.restore();
                cr.fill();
            }
        }
        cr.setSourceRGBA(1, 1, 1, 0.8);
        cr.arc(cx, 10, 3, Math.PI, 2 * Math.PI);
        cr.fill();
    } else if (type === 'flake') {
        hook(cr, cx);
        const cy = 20;
        cr.setSourceRGB(0.92, 0.96, 1);
        cr.setLineWidth(2);
        cr.setLineCap(1);
        for (let k = 0; k < 6; k++) {
            const a = k * Math.PI / 3;
            const ex = cx + Math.cos(a) * 12, ey = cy + Math.sin(a) * 12;
            cr.moveTo(cx, cy);
            cr.lineTo(ex, ey);
            const mx = cx + Math.cos(a) * 7, my = cy + Math.sin(a) * 7;
            cr.moveTo(mx, my);
            cr.lineTo(mx + Math.cos(a + 0.7) * 4, my + Math.sin(a + 0.7) * 4);
            cr.moveTo(mx, my);
            cr.lineTo(mx + Math.cos(a - 0.7) * 4, my + Math.sin(a - 0.7) * 4);
        }
        cr.stroke();
        cr.setSourceRGB(0.6, 0.8, 1);
        cr.arc(cx, cy, 2.5, 0, 2 * Math.PI);
        cr.fill();
    }
}

// ящик с игрушками: задняя стенка и передний бортик рисуются отдельно
const BOX_W = 220;
const BOX_H = 58;

function drawBoxBack(cr) {
    cr.setSourceRGB(0.42, 0.27, 0.14);
    cr.rectangle(4, 6, BOX_W - 8, BOX_H - 12);
    cr.fill();
}

function drawBoxFront(cr) {
    const g = new Cairo.LinearGradient(0, 0, 0, 30);
    g.addColorStopRGB(0, 0.72, 0.5, 0.28);
    g.addColorStopRGB(1, 0.55, 0.36, 0.18);
    cr.setSource(g);
    cr.rectangle(0, 0, BOX_W, 30);
    cr.fill();
    cr.setSourceRGBA(0.3, 0.18, 0.08, 0.6);
    cr.setLineWidth(1);
    for (const y of [10, 20]) {
        cr.moveTo(0, y + 0.5);
        cr.lineTo(BOX_W, y + 0.5);
    }
    cr.stroke();
    cr.setSourceRGB(0.85, 0.1, 0.12);
    cr.rectangle(BOX_W / 2 - 4, 0, 8, 30);
    cr.fill();
    cr.setSourceRGBA(0, 0, 0, 0.25);
    cr.rectangle(0, 28, BOX_W, 2);
    cr.fill();
}

module.exports = { TIERS, APEX, TREE_W, TREE_H, FOOT, TOY_SIZE, BALL_COLORS, BOX_W, BOX_H, halfWidthAt, drawTree, drawToy, drawBoxBack, drawBoxFront };
