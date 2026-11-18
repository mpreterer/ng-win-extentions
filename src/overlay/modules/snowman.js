/* Снежки и снеговики: геометрия и отрисовка (перенесено из версии для GNOME).
 *
 * Стопка — массив шаров снизу вверх: [{r, angle}]. Начало координат —
 * точка, где нижний шар касается опоры (x — центр, y растёт вниз).
 * Один шар — просто снежок; от двух до пяти — снеговик «в костюме»:
 * шапка, шарф, нос-морковка, руки-ветки, пуговицы; у больших —
 * варежки, метла, звезда на шапке.
 */
'use strict';

const Cairo = require('../cairo');

const MAX_BALLS = 5;

// псевдослучайное число из зерна — одинаковое при каждой перерисовке
function rnd(seed, k) {
    let x = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function armLength(torso, head) {
    return Math.max(9, torso.r * 0.95 + head.r * 0.35);
}

function layout(balls) {
    const c = [];
    for (let i = 0; i < balls.length; i++) {
        // у снеговика каждый следующий шар чуть меньше — классическая фигура
        const r = balls.length > 1 ? balls[i].r * Math.pow(0.86, i) : balls[i].r;
        const y = i === 0 ? -r * 0.92 : c[i - 1].y - (c[i - 1].r + r) * 0.8;
        c.push({ y, r });
    }
    const n = c.length;
    const head = c[n - 1];
    let halfW = Math.max(...c.map(b => b.r)) + 3;
    let top = head.y - head.r - 3;
    if (n >= 2) {
        const torso = c[n - 2];
        const L = armLength(torso, head);
        halfW = Math.max(halfW, torso.r + L + 5);
        if (n >= 4)
            halfW += L * 0.35;   // метла
        top = head.y - head.r * (n >= 5 ? 2.95 : 2.45) - 4;
    }
    const bottom = 5;
    return {
        c, halfW, top, bottom,
        w: Math.ceil(halfW * 2),
        h: Math.ceil(bottom - top),
        stackTop: head.y - head.r,
    };
}

// какой шар под точкой (x, y — в координатах стопки); шапка и руки — свои шары
function pickBall(geo, x, y) {
    const c = geo.c;
    if (y < geo.stackTop)
        return c.length - 1;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < c.length; i++) {
        const d = Math.hypot(x, y - c[i].y) - c[i].r;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

function ellipse(cr, x, y, rx, ry) {
    cr.save();
    cr.translate(x, y);
    cr.scale(rx, ry);
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
}

function drawBall(cr, y, r) {
    // лавандовая тень снизу-слева и белый объём сверху-справа, как у лепленого снега
    cr.setSourceRGB(0.76, 0.78, 0.9);
    cr.arc(0, y, r, 0, 2 * Math.PI);
    cr.fill();
    cr.save();
    cr.arc(0, y, r, 0, 2 * Math.PI);
    cr.clip();
    const g = new Cairo.RadialGradient(r * 0.25, y - r * 0.35, r * 0.1, r * 0.12, y - r * 0.1, r * 0.98);
    g.addColorStopRGB(0, 1, 1, 1);
    g.addColorStopRGB(0.75, 0.96, 0.95, 0.97);
    g.addColorStopRGB(1, 0.9, 0.9, 0.96);
    cr.setSource(g);
    cr.arc(r * 0.12, y - r * 0.12, r * 0.94, 0, 2 * Math.PI);
    cr.fill();
    cr.restore();
    cr.setSourceRGBA(0.6, 0.64, 0.8, 0.45);
    cr.setLineWidth(1);
    cr.arc(0, y, r - 0.5, 0, 2 * Math.PI);
    cr.stroke();
}

const SCARVES = [
    [0.85, 0.12, 0.13], [0.1, 0.55, 0.3], [0.15, 0.4, 0.8], [0.95, 0.6, 0.1],
];

function drawArm(cr, torso, L, side, mitten, broom) {
    const sx = side * torso.r * 0.8, sy = torso.y - torso.r * 0.3;
    const hx = side * (torso.r + L), hy = sy - L * 0.55;
    const w = Math.max(1.5, torso.r * 0.08);
    cr.setSourceRGB(0.42, 0.26, 0.13);
    cr.setLineCap(1);   // ROUND
    cr.setLineWidth(w);
    cr.moveTo(sx, sy);
    cr.lineTo(hx, hy);
    cr.stroke();
    // веточки
    cr.setLineWidth(Math.max(1, w * 0.7));
    const mx = sx + (hx - sx) * 0.62, my = sy + (hy - sy) * 0.62;
    cr.moveTo(mx, my);
    cr.lineTo(mx + side * L * 0.12, my - L * 0.32);
    cr.stroke();
    if (!mitten) {
        cr.moveTo(hx, hy);
        cr.lineTo(hx + side * L * 0.2, hy - L * 0.08);
        cr.moveTo(hx, hy);
        cr.lineTo(hx + side * L * 0.05, hy - L * 0.25);
        cr.stroke();
    }
    if (broom) {
        // метла в руке: черенок до земли и веник
        const bottom = -2;
        cr.setLineWidth(Math.max(1.5, w * 0.9));
        cr.setSourceRGB(0.55, 0.36, 0.18);
        cr.moveTo(hx, hy - L * 0.35);
        cr.lineTo(hx, bottom - L * 0.55);
        cr.stroke();
        cr.setSourceRGB(0.86, 0.7, 0.3);
        cr.moveTo(hx - L * 0.07, bottom - L * 0.58);
        cr.lineTo(hx + L * 0.07, bottom - L * 0.58);
        cr.lineTo(hx + L * 0.3, bottom);
        cr.lineTo(hx - L * 0.3, bottom);
        cr.closePath();
        cr.fill();
        cr.setSourceRGBA(0.6, 0.45, 0.15, 0.7);
        cr.setLineWidth(0.8);
        for (let k = -2; k <= 2; k++) {
            cr.moveTo(hx + k * L * 0.03, bottom - L * 0.55);
            cr.lineTo(hx + k * L * 0.12, bottom);
        }
        cr.stroke();
        cr.setSourceRGB(0.75, 0.15, 0.15);
        cr.rectangle(hx - L * 0.08, bottom - L * 0.62, L * 0.16, L * 0.07);
        cr.fill();
    }
    if (mitten) {
        cr.setSourceRGB(0.82, 0.12, 0.14);
        cr.arc(hx, hy, Math.max(2.2, torso.r * 0.14), 0, 2 * Math.PI);
        cr.fill();
    }
}

function drawFace(cr, head) {
    const R = head.r, y = head.y;
    cr.setSourceRGB(0.08, 0.08, 0.1);
    const er = Math.max(0.9, R * 0.09);
    cr.arc(-R * 0.32, y - R * 0.15, er, 0, 2 * Math.PI);
    cr.fill();
    cr.arc(R * 0.3, y - R * 0.17, er, 0, 2 * Math.PI);
    cr.fill();
    // улыбка угольками
    const mr = Math.max(0.6, R * 0.055);
    for (let k = 0; k < 5; k++) {
        const a = Math.PI * (0.25 + k * 0.125);
        cr.arc(Math.cos(a) * R * 0.48 - R * 0.02, y + Math.sin(a) * R * 0.45 + R * 0.02, mr, 0, 2 * Math.PI);
        cr.fill();
    }
    // нос-морковка
    cr.setSourceRGB(0.97, 0.5, 0.1);
    cr.moveTo(-R * 0.02, y - R * 0.08);
    cr.lineTo(R * 0.72, y + R * 0.08);
    cr.lineTo(-R * 0.02, y + R * 0.14);
    cr.closePath();
    cr.fill();
    cr.setSourceRGBA(0.7, 0.3, 0.05, 0.6);
    cr.setLineWidth(Math.max(0.6, R * 0.03));
    cr.moveTo(R * 0.18, y - R * 0.03);
    cr.lineTo(R * 0.22, y + R * 0.08);
    cr.stroke();
}

function drawScarf(cr, head, color, striped) {
    const R = head.r;
    const y = head.y + R * 0.82;
    const hgt = Math.max(3, R * 0.34);
    const [r, g, b] = color;
    // хвост шарфа
    cr.save();
    cr.translate(R * 0.42, y + hgt * 0.3);
    cr.rotate(-0.18);
    cr.setSourceRGB(r * 0.82, g * 0.82, b * 0.82);
    cr.rectangle(0, 0, R * 0.36, R * 0.95);
    cr.fill();
    if (striped) {
        cr.setSourceRGBA(1, 1, 1, 0.85);
        cr.rectangle(0, R * 0.35, R * 0.36, R * 0.12);
        cr.fill();
    }
    cr.setSourceRGB(r * 0.6, g * 0.6, b * 0.6);
    cr.setLineWidth(Math.max(0.6, R * 0.04));
    for (let k = 0; k < 3; k++) {
        const fx = R * (0.06 + k * 0.12);
        cr.moveTo(fx, R * 0.95);
        cr.lineTo(fx, R * 1.1);
    }
    cr.stroke();
    cr.restore();
    // обмотка на шее
    cr.setSourceRGB(r, g, b);
    const x0 = -R * 0.98, w = R * 1.96;
    cr.moveTo(x0, y - hgt / 2);
    cr.curveTo(x0 + w * 0.3, y - hgt / 2 + hgt * 0.35, x0 + w * 0.7, y - hgt / 2 + hgt * 0.35, x0 + w, y - hgt / 2);
    cr.lineTo(x0 + w, y + hgt / 2);
    cr.curveTo(x0 + w * 0.7, y + hgt / 2 + hgt * 0.35, x0 + w * 0.3, y + hgt / 2 + hgt * 0.35, x0, y + hgt / 2);
    cr.closePath();
    cr.fill();
    if (striped) {
        cr.setSourceRGBA(1, 1, 1, 0.85);
        for (let k = 1; k < 4; k++) {
            cr.rectangle(x0 + w * k / 4 - R * 0.05, y - hgt / 2 + hgt * 0.15, R * 0.1, hgt * 0.95);
            cr.fill();
        }
    }
    cr.setSourceRGBA(0, 0, 0, 0.18);
    cr.rectangle(x0 + 1, y + hgt * 0.15, w - 2, hgt * 0.25);
    cr.fill();
}

function drawHat(cr, head, kind, star) {
    const R = head.r, y = head.y;
    let tipX = 0, tipY = y - R * 1.75;
    if (kind === 0) {
        // красный колпак Деда Мороза
        cr.setSourceRGB(0.86, 0.12, 0.14);
        cr.moveTo(-R * 0.9, y - R * 0.62);
        cr.curveTo(-R * 0.75, y - R * 1.6, R * 0.1, y - R * 2.1, R * 0.95, y - R * 1.75);
        cr.curveTo(R * 0.55, y - R * 1.5, R * 0.75, y - R * 1.0, R * 0.9, y - R * 0.62);
        cr.closePath();
        cr.fill();
        cr.setSourceRGBA(0.55, 0.05, 0.08, 0.35);
        cr.moveTo(R * 0.2, y - R * 0.7);
        cr.curveTo(R * 0.4, y - R * 1.2, R * 0.6, y - R * 1.5, R * 0.95, y - R * 1.75);
        cr.curveTo(R * 0.55, y - R * 1.5, R * 0.75, y - R * 1.0, R * 0.9, y - R * 0.62);
        cr.closePath();
        cr.fill();
        // белая опушка и помпон
        cr.setSourceRGB(0.98, 0.98, 1);
        const bh = R * 0.34;
        cr.moveTo(-R * 1.0, y - R * 0.55);
        cr.curveTo(-R * 0.4, y - R * 0.55 - bh * 0.6, R * 0.4, y - R * 0.55 - bh * 0.6, R * 1.0, y - R * 0.55);
        cr.lineTo(R * 1.0, y - R * 0.55 - bh);
        cr.curveTo(R * 0.4, y - R * 0.55 - bh * 1.6, -R * 0.4, y - R * 0.55 - bh * 1.6, -R * 1.0, y - R * 0.55 - bh);
        cr.closePath();
        cr.fill();
        cr.arc(R * 0.98, y - R * 1.75, Math.max(1.5, R * 0.22), 0, 2 * Math.PI);
        cr.fill();
        tipX = R * 0.98;
        tipY = y - R * 1.97;
    } else if (kind === 1) {
        // чёрный цилиндр с красной лентой
        cr.setSourceRGB(0.1, 0.1, 0.12);
        cr.rectangle(-R * 0.62, y - R * 1.95, R * 1.24, R * 1.25);
        cr.fill();
        ellipse(cr, 0, y - R * 0.72, R * 1.1, Math.max(1.2, R * 0.16));
        cr.fill();
        cr.setSourceRGB(0.8, 0.1, 0.12);
        cr.rectangle(-R * 0.62, y - R * 1.05, R * 1.24, R * 0.22);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.rectangle(-R * 0.5, y - R * 1.9, R * 0.15, R * 0.8);
        cr.fill();
        tipY = y - R * 1.95;
    } else {
        // ведро
        cr.setSourceRGB(0.32, 0.52, 0.78);
        cr.moveTo(-R * 0.85, y - R * 0.62);
        cr.lineTo(-R * 0.58, y - R * 1.75);
        cr.lineTo(R * 0.58, y - R * 1.75);
        cr.lineTo(R * 0.85, y - R * 0.62);
        cr.closePath();
        cr.fill();
        cr.setSourceRGB(0.22, 0.38, 0.6);
        cr.rectangle(-R * 0.9, y - R * 0.74, R * 1.8, R * 0.14);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.25);
        cr.moveTo(-R * 0.45, y - R * 0.8);
        cr.lineTo(-R * 0.3, y - R * 1.65);
        cr.lineTo(-R * 0.2, y - R * 1.65);
        cr.lineTo(-R * 0.32, y - R * 0.8);
        cr.closePath();
        cr.fill();
    }
    if (star) {
        const s = Math.max(3, R * 0.42);
        cr.setSourceRGB(1, 0.82, 0.15);
        for (let k = 0; k < 10; k++) {
            const a = -Math.PI / 2 + k * Math.PI / 5;
            const rr = k % 2 ? s * 0.45 : s;
            const px = tipX + Math.cos(a) * rr, py = tipY - s * 0.6 + Math.sin(a) * rr;
            if (k === 0)
                cr.moveTo(px, py);
            else
                cr.lineTo(px, py);
        }
        cr.closePath();
        cr.fill();
    }
}

function drawButtons(cr, ball, count) {
    cr.setSourceRGB(0.1, 0.1, 0.12);
    const br = Math.max(0.9, ball.r * 0.08);
    for (let k = 0; k < count; k++) {
        const y = ball.y + ball.r * (count === 3 ? -0.45 + k * 0.4 : -0.25 + k * 0.45);
        cr.arc(-ball.r * 0.04, y, br, 0, 2 * Math.PI);
        cr.fill();
    }
}

// рисует стопку; начало координат cr — точка касания опоры
function paintAt(cr, balls, geo, seed) {
    const c = geo.c;
    const n = c.length;

    // тень на снегу
    cr.setSourceRGBA(0.25, 0.3, 0.48, 0.22);
    ellipse(cr, 0, 0.5, c[0].r * 1.05, Math.max(1.5, c[0].r * 0.16));
    cr.fill();

    if (n === 1) {
        drawBall(cr, c[0].y, c[0].r);
        return;
    }

    const head = c[n - 1], torso = c[n - 2];
    const L = armLength(torso, head);
    const fancy = n >= 4;
    drawArm(cr, torso, L, -1, fancy, fancy);
    drawArm(cr, torso, L, 1, fancy, false);
    for (let i = 0; i < n; i++)
        drawBall(cr, c[i].y, c[i].r);
    // пуговицы: на «туловище» и на шарах под ним (кроме самого нижнего у высоких)
    for (let i = n >= 3 ? 1 : 0; i <= n - 2; i++)
        drawButtons(cr, c[i], i === n - 2 ? 3 : 2);
    const scarf = SCARVES[Math.floor(rnd(seed, 900) * SCARVES.length)];
    drawScarf(cr, head, scarf, rnd(seed, 901) < 0.5);
    drawFace(cr, head);
    drawHat(cr, head, Math.floor(rnd(seed, 902) * 3), n >= 5);
}

// готовая картинка стопки (перерисовывается только при изменении)
function render(balls, geo, seed, dpr) {
    return Cairo.makeCanvas(geo.w, geo.h, cr => {
        cr.translate(geo.halfW, -geo.top);
        paintAt(cr, balls, geo, seed);
    }, dpr);
}

module.exports = { MAX_BALLS, layout, pickBall, render };
