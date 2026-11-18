/* Рисунки Деда Мороза, саней и оленей (Cairo через обёртку Canvas).
 * Перенесено из ded-moroz-sleigh@local без изменений. */
'use strict';

const Cairo = require('../cairo');

const ART_W = 420;
const ART_H = 130;
const GROUND = 120;          // линия земли на рисунке
const DEER = [218, 292, 366];
const HAND = [131, 66];      // рукавица с вожжами
const STAFF_TOP = [27, 9];   // кристалл на посохе (стоит за мешком)
const SHOULDER = [90, 50];   // плечо машущей руки
const NOSE = 410;            // передний край упряжки на рисунке

function ellipse(cr, cx, cy, rx, ry, rot = 0) {
    cr.save();
    cr.translate(cx, cy);
    if (rot)
        cr.rotate(rot);
    cr.scale(rx, ry);
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
}

function rgba(cr, r, g, b, a = 1) {
    cr.setSourceRGBA(r, g, b, a);
}

function linear(x0, y0, x1, y1, stops) {
    const g = new Cairo.LinearGradient(x0, y0, x1, y1);
    for (const [o, r, gg, b, a] of stops)
        g.addColorStopRGBA(o, r, gg, b, a === undefined ? 1 : a);
    return g;
}

function radial(cx, cy, r0, r1, stops, fx = cx, fy = cy) {
    const g = new Cairo.RadialGradient(fx, fy, r0, cx, cy, r1);
    for (const [o, r, gg, b, a] of stops)
        g.addColorStopRGBA(o, r, gg, b, a === undefined ? 1 : a);
    return g;
}

// шестилучевая снежинка-узор
function snowflakeMark(cr, cx, cy, r, alpha = 0.9) {
    rgba(cr, 0.86, 0.9, 0.98, alpha);
    cr.setLineWidth(0.7);
    for (let k = 0; k < 3; k++) {
        const a = k * Math.PI / 3;
        cr.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
        cr.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    cr.stroke();
}

function bell(cr, x, y, r) {
    cr.setSource(radial(x, y, 0, r, [[0, 1, 0.95, 0.6], [0.6, 0.95, 0.75, 0.2], [1, 0.7, 0.5, 0.1]], x - r * 0.3, y - r * 0.3));
    cr.arc(x, y, r, 0, 2 * Math.PI);
    cr.fill();
    rgba(cr, 0.35, 0.22, 0.05, 0.9);
    cr.arc(x, y + r * 0.35, r * 0.25, 0, 2 * Math.PI);
    cr.fill();
}

// Нога из двух сегментов: от сустава под углом swing, колено сгибается на bend.
function deerLeg(cr, x, y, swing, bend, l1, l2, width, color) {
    const kx = x + Math.sin(swing) * l1, ky = y + Math.cos(swing) * l1;
    const a2 = swing + bend;
    const hx = kx + Math.sin(a2) * l2, hy = ky + Math.cos(a2) * l2;
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    rgba(cr, ...color);
    cr.setLineWidth(width);
    cr.moveTo(x, y);
    cr.lineTo(kx, ky);
    cr.setLineWidth(width * 0.75);
    cr.lineTo(hx, hy);
    cr.stroke();
    rgba(cr, 0.16, 0.1, 0.06, 1);
    ellipse(cr, hx + Math.sin(a2) * 1.2, hy + 0.6, 2.1, 1.5, -a2);
    cr.fill();
    return [hx, hy];
}

/* Олень. p — фаза галопа 0..1. Возвращает точку головы (для вожжей). */
function drawDeer(cr, cx, p, lead) {
    const TAU = Math.PI * 2;
    const bob = -2.6 * Math.abs(Math.sin(TAU * p));
    const headBob = 1.6 * Math.sin(TAU * p + 0.8);
    const legs = (ph, x, y, far) => {
        const s = Math.sin(TAU * ph);
        const swing = s * 0.62;                               // ±35°
        const bend = -Math.max(0, Math.sin(TAU * ph + 1.2)) * 0.95;
        const col = far ? [0.3, 0.18, 0.08, 1] : [0.42, 0.26, 0.12, 1];
        deerLeg(cr, x, y, swing, bend, 17, 18, far ? 3 : 3.4, col);
    };
    cr.save();
    cr.translate(0, bob);
    const hipY = 81;
    // дальние ноги
    legs(p + 0.12, cx + 13, hipY, true);
    legs(p + 0.62, cx - 15, hipY, true);
    // хвост
    rgba(cr, 0.97, 0.95, 0.9);
    ellipse(cr, cx - 27, 68, 4.2, 3, -0.5);
    cr.fill();
    // туловище: спина темнее, живот светлее
    cr.setSource(linear(0, 62, 0, 88, [[0, 0.5, 0.31, 0.15], [0.55, 0.64, 0.42, 0.22], [1, 0.78, 0.62, 0.45]]));
    ellipse(cr, cx, 75, 26, 11.5);
    cr.fill();
    // попона с золотой каймой
    cr.setSource(linear(0, 63, 0, 80, [[0, 0.78, 0.08, 0.12], [1, 0.55, 0.04, 0.08]]));
    cr.moveTo(cx - 10, 64.5);
    cr.lineTo(cx + 8, 64);
    cr.lineTo(cx + 9, 78);
    cr.curveTo(cx + 2, 80, cx - 6, 80, cx - 11, 78);
    cr.closePath();
    cr.fillPreserve();
    rgba(cr, 0.95, 0.78, 0.3);
    cr.setLineWidth(0.9);
    cr.stroke();
    snowflakeMark(cr, cx - 1, 71.5, 3.2, 0.85);
    // шея
    cr.setSource(linear(cx + 14, 50, cx + 30, 76, [[0, 0.58, 0.37, 0.18], [1, 0.5, 0.31, 0.15]]));
    cr.moveTo(cx + 13, 68);
    cr.lineTo(cx + 24, 76);
    cr.lineTo(cx + 36, 54 + headBob);
    cr.lineTo(cx + 27, 45 + headBob);
    cr.closePath();
    cr.fill();
    // белая шерсть на груди
    rgba(cr, 0.92, 0.86, 0.76, 0.8);
    ellipse(cr, cx + 25, 69, 2.6, 4.2, 0.5);
    cr.fill();
    // голова
    const hx = cx + 34, hy = 47 + headBob;
    cr.setSource(radial(hx, hy, 0, 11, [[0, 0.66, 0.44, 0.24], [1, 0.52, 0.32, 0.16]], hx - 2, hy - 3));
    ellipse(cr, hx, hy, 9.5, 6.3, 0.15);
    cr.fill();
    rgba(cr, 0.8, 0.66, 0.5);
    ellipse(cr, hx + 8.5, hy + 2.8, 5, 3.8, 0.2);
    cr.fill();
    // нос: у ведущего — тёмно-вишнёвый с бликом
    rgba(cr, lead ? 0.45 : 0.16, 0.06, 0.06);
    cr.arc(hx + 12.6, hy + 2, 2.3, 0, 2 * Math.PI);
    cr.fill();
    rgba(cr, 1, 1, 1, 0.6);
    cr.arc(hx + 12, hy + 1.3, 0.7, 0, 2 * Math.PI);
    cr.fill();
    // глаз с бликом
    rgba(cr, 0.08, 0.05, 0.04);
    ellipse(cr, hx + 1.5, hy - 1.6, 1.5, 1.7);
    cr.fill();
    rgba(cr, 1, 1, 1, 0.9);
    cr.arc(hx + 2, hy - 2.1, 0.5, 0, 2 * Math.PI);
    cr.fill();
    // ухо
    rgba(cr, 0.47, 0.29, 0.13);
    ellipse(cr, hx - 7, hy - 5, 4.6, 1.9, -0.5);
    cr.fill();
    rgba(cr, 0.85, 0.65, 0.55);
    ellipse(cr, hx - 7, hy - 5, 2.8, 0.9, -0.5);
    cr.fill();
    // ветвистые рога
    cr.setLineCap(Cairo.LineCap.ROUND);
    const antler = (bx, by, dir, shade) => {
        rgba(cr, 0.86 * shade, 0.72 * shade, 0.5 * shade);
        cr.setLineWidth(1.9);
        cr.moveTo(bx, by);
        cr.curveTo(bx - 3 * dir, by - 7, bx - 6 * dir, by - 12, bx - 3 * dir, by - 20);
        cr.stroke();
        cr.setLineWidth(1.3);
        cr.moveTo(bx - 2.2 * dir, by - 5);
        cr.lineTo(bx - 8 * dir, by - 8);
        cr.moveTo(bx - 4.6 * dir, by - 10);
        cr.lineTo(bx - 0.5 * dir, by - 15);
        cr.moveTo(bx - 4.8 * dir, by - 13);
        cr.lineTo(bx - 10 * dir, by - 17);
        cr.moveTo(bx - 3.4 * dir, by - 18);
        cr.lineTo(bx + 1.5 * dir, by - 22);
        cr.stroke();
    };
    antler(hx - 4, hy - 5, 1, 0.82);
    antler(hx, hy - 5.5, -1, 1);
    // упряжь: красный хомут с тремя бубенчиками
    rgba(cr, 0.72, 0.07, 0.1);
    cr.setLineWidth(3.2);
    cr.moveTo(cx + 15, 63);
    cr.curveTo(cx + 20, 70, cx + 20, 78, cx + 17, 84);
    cr.stroke();
    bell(cr, cx + 19.3, 70, 1.9);
    bell(cr, cx + 19.6, 76, 2.1);
    bell(cr, cx + 18, 82, 1.9);
    // ближние ноги
    legs(p, cx + 17, hipY, false);
    legs(p + 0.5, cx - 18, hipY, false);
    cr.restore();
    return [hx + 2, hy + bob + 1];
}

/* Кадр оленей: постромки, вожжи и три оленя в разных фазах. */
function drawDeerFrame(cr, frame) {
    const heads = [];
    // постромки (за оленями)
    rgba(cr, 0.4, 0.22, 0.08);
    cr.setLineWidth(1.4);
    cr.moveTo(162, 94);
    for (const cx of DEER) {
        cr.lineTo(cx - 22, 80);
        cr.moveTo(cx + 14, 78);
    }
    cr.stroke();
    DEER.forEach((cx, i) => {
        heads.push(drawDeer(cr, cx, frame / 4 + i * 0.29, i === DEER.length - 1));
    });
    // вожжи от рукавицы к ведущему оленю
    const [lx, ly] = heads[heads.length - 1];
    rgba(cr, 0.28, 0.14, 0.05);
    cr.setLineWidth(1);
    cr.moveTo(HAND[0], HAND[1]);
    cr.curveTo(210, 80, 300, 70, lx, ly);
    cr.stroke();
}

/* Сани, мешок и Дед Мороз (без машущей руки). */
function drawSleighFrame(cr) {
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);

    // посох (за Дедом Морозом): серебряный, витой
    cr.setSource(linear(STAFF_TOP[0] - 3, 0, STAFF_TOP[0] + 5, 0, [[0, 0.62, 0.66, 0.75], [0.5, 0.97, 0.98, 1], [1, 0.55, 0.6, 0.7]]));
    cr.setLineWidth(3.2);
    cr.moveTo(STAFF_TOP[0], STAFF_TOP[1] + 6);
    cr.lineTo(STAFF_TOP[0] + 4, 96);
    cr.stroke();
    rgba(cr, 0.45, 0.55, 0.85, 0.7);
    cr.setLineWidth(0.8);
    for (let y = STAFF_TOP[1] + 12; y < 94; y += 7) {
        cr.moveTo(STAFF_TOP[0] - 1.5 + (y - STAFF_TOP[1]) * 0.046, y);
        cr.lineTo(STAFF_TOP[0] + 1.8 + (y - STAFF_TOP[1]) * 0.046, y + 3);
    }
    cr.stroke();
    // кристалл-звезда
    cr.save();
    cr.translate(STAFF_TOP[0], STAFF_TOP[1]);
    cr.setSource(radial(0, 0, 0, 7, [[0, 1, 1, 1], [0.5, 0.75, 0.88, 1], [1, 0.35, 0.55, 0.95]]));
    for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 - Math.PI / 2;
        const r = k % 2 ? 2.6 : 6.5;
        if (k === 0)
            cr.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else
            cr.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    cr.closePath();
    cr.fill();
    cr.restore();

    // мешок с подарками
    cr.setSource(radial(44, 54, 2, 22, [[0, 0.7, 0.42, 0.22], [1, 0.45, 0.25, 0.12]], 38, 46));
    cr.moveTo(26, 78);
    cr.curveTo(18, 58, 26, 40, 40, 37);
    cr.curveTo(54, 34, 66, 46, 64, 78);
    cr.closePath();
    cr.fill();
    rgba(cr, 0.6, 0.38, 0.2);
    cr.rectangle(30, 58, 9, 8);   // заплатка
    cr.fill();
    rgba(cr, 0.35, 0.2, 0.1, 0.8);
    cr.setLineWidth(0.6);
    cr.rectangle(30, 58, 9, 8);
    cr.stroke();
    const gift = (x, y, w, h, c, rib) => {
        rgba(cr, ...c);
        cr.rectangle(x, y, w, h);
        cr.fill();
        rgba(cr, ...rib);
        cr.rectangle(x + w / 2 - 1.2, y, 2.4, h);
        cr.rectangle(x, y + h / 2 - 1.2, w, 2.4);
        cr.fill();
        ellipse(cr, x + w / 2 - 2.5, y - 1.5, 2.6, 1.6, 0.4);
        ellipse(cr, x + w / 2 + 2.5, y - 1.5, 2.6, 1.6, -0.4);
        cr.fill();
    };
    gift(30, 30, 13, 12, [0.12, 0.5, 0.78], [0.98, 0.82, 0.3]);
    gift(47, 27, 14, 14, [0.1, 0.55, 0.28], [0.85, 0.1, 0.15]);
    gift(39, 22, 9, 9, [0.85, 0.75, 0.2], [0.75, 0.12, 0.5]);

    // шуба Деда Мороза
    cr.setSource(linear(80, 40, 124, 92, [[0, 0.84, 0.1, 0.13], [0.6, 0.65, 0.05, 0.09], [1, 0.45, 0.02, 0.06]]));
    cr.moveTo(82, 92);
    cr.lineTo(85, 56);
    cr.curveTo(86, 46, 92, 42, 100, 42);
    cr.curveTo(110, 42, 116, 46, 118, 56);
    cr.lineTo(126, 92);
    cr.closePath();
    cr.fill();
    // меховая оторочка спереди и воротник
    rgba(cr, 0.98, 0.98, 1);
    cr.moveTo(113, 46);
    cr.curveTo(117, 58, 120, 74, 124, 92);
    cr.lineTo(118, 92);
    cr.curveTo(115, 74, 112, 60, 109, 47);
    cr.closePath();
    cr.fill();
    rgba(cr, 0.8, 0.84, 0.92, 0.6);
    for (let y = 52; y < 90; y += 5) {
        cr.arc(113 + (y - 47) * 0.2, y, 1, 0, 2 * Math.PI);
        cr.fill();
    }
    // пояс-кушак
    rgba(cr, 0.96, 0.78, 0.3);
    cr.moveTo(86, 70);
    cr.curveTo(98, 73, 108, 73, 118, 70);
    cr.lineTo(118.5, 74);
    cr.curveTo(108, 77, 98, 77, 86, 74);
    cr.closePath();
    cr.fill();
    rgba(cr, 0.9, 0.68, 0.2);
    cr.moveTo(90, 74);
    cr.lineTo(87, 86);
    cr.lineTo(90.5, 86);
    cr.lineTo(92, 75);
    cr.closePath();
    cr.fill();
    // серебряные узоры на шубе
    snowflakeMark(cr, 95, 61, 3.4);
    snowflakeMark(cr, 104, 82, 3);
    snowflakeMark(cr, 92, 84, 2.4);
    snowflakeMark(cr, 104, 53, 2);

    // ближняя рука с вожжами
    cr.setSource(linear(104, 50, 128, 66, [[0, 0.8, 0.09, 0.12], [1, 0.62, 0.05, 0.09]]));
    cr.setLineWidth(7);
    cr.moveTo(106, 52);
    cr.curveTo(114, 56, 120, 62, 126, 64);
    cr.stroke();
    rgba(cr, 0.98, 0.98, 1);
    ellipse(cr, 126, 64.5, 2.3, 4.2, 0.4);
    cr.fill();
    cr.setSource(radial(HAND[0], HAND[1], 0, 4, [[0, 0.95, 0.2, 0.22], [1, 0.6, 0.05, 0.08]], HAND[0] - 1, HAND[1] - 1.5));
    ellipse(cr, HAND[0], HAND[1], 3.6, 3.3);
    cr.fill();

    // лицо
    const fx = 104, fy = 33;
    cr.setSource(radial(fx, fy, 0, 10, [[0, 1, 0.88, 0.78], [1, 0.95, 0.76, 0.64]], fx + 2, fy - 2));
    cr.arc(fx, fy, 9, 0, 2 * Math.PI);
    cr.fill();
    rgba(cr, 0.98, 0.55, 0.55, 0.55);   // румянец
    ellipse(cr, fx + 5, fy + 3, 2.6, 1.8);
    cr.fill();
    // борода: длинная, волнистая
    cr.setSource(linear(0, 30, 0, 72, [[0, 1, 1, 1], [1, 0.88, 0.9, 0.95]]));
    cr.moveTo(fx - 8, fy - 1);
    cr.curveTo(fx - 10, fy + 12, fx - 6, fy + 26, fx + 1, fy + 36);
    cr.curveTo(fx + 3, fy + 32, fx + 4, fy + 34, fx + 6, fy + 30);
    cr.curveTo(fx + 8, fy + 26, fx + 9, fy + 27, fx + 10, fy + 20);
    cr.curveTo(fx + 12, fy + 12, fx + 11, fy + 6, fx + 9, fy + 2);
    cr.curveTo(fx + 4, fy + 6, fx - 3, fy + 5, fx - 8, fy - 1);
    cr.fill();
    rgba(cr, 0.7, 0.74, 0.82, 0.55);
    cr.setLineWidth(0.6);
    for (let k = 0; k < 5; k++) {
        cr.moveTo(fx - 4 + k * 2.6, fy + 8);
        cr.curveTo(fx - 5 + k * 2.6, fy + 16, fx - 2 + k * 2.4, fy + 22, fx - 1 + k * 2, fy + 28);
    }
    cr.stroke();
    // усы
    rgba(cr, 1, 1, 1);
    cr.moveTo(fx + 8, fy + 4);
    cr.curveTo(fx + 4, fy + 9, fx - 1, fy + 8, fx - 2, fy + 5);
    cr.curveTo(fx + 2, fy + 6, fx + 5, fy + 4, fx + 8, fy + 3);
    cr.fill();
    // нос, глаз, бровь
    cr.setSource(radial(fx + 8.5, fy + 2.5, 0, 3, [[0, 1, 0.66, 0.62], [1, 0.9, 0.42, 0.42]], fx + 8, fy + 1.6));
    cr.arc(fx + 8.5, fy + 2.5, 2.6, 0, 2 * Math.PI);
    cr.fill();
    rgba(cr, 0.12, 0.1, 0.12);
    ellipse(cr, fx + 4.6, fy - 1.5, 1.1, 1.4);
    cr.fill();
    rgba(cr, 0.98, 0.98, 1);
    cr.setLineWidth(1.8);
    cr.moveTo(fx + 1.5, fy - 4.5);
    cr.curveTo(fx + 4, fy - 6, fx + 6.5, fy - 5.5, fx + 8, fy - 4);
    cr.stroke();
    // шапка: красная, с широкой меховой опушкой и узором
    cr.setSource(linear(0, 14, 0, 30, [[0, 0.88, 0.12, 0.15], [1, 0.62, 0.04, 0.08]]));
    cr.moveTo(fx - 10, fy - 5);
    cr.curveTo(fx - 11, fy - 20, fx + 10, fy - 22, fx + 10, fy - 6);
    cr.closePath();
    cr.fill();
    snowflakeMark(cr, fx - 1, fy - 14, 2.6);
    cr.setSource(linear(0, fy - 8, 0, fy - 1, [[0, 1, 1, 1], [1, 0.84, 0.88, 0.95]]));
    cr.moveTo(fx - 12, fy - 7);
    cr.curveTo(fx - 4, fy - 10, fx + 5, fy - 10, fx + 12, fy - 6.5);
    cr.lineTo(fx + 11, fy - 1);
    cr.curveTo(fx + 4, fy - 4, fx - 4, fy - 4, fx - 11.5, fy - 1.5);
    cr.closePath();
    cr.fill();

    // кузов саней
    cr.setSource(linear(0, 44, 0, 112, [[0, 0.88, 0.14, 0.16], [0.7, 0.62, 0.05, 0.09], [1, 0.45, 0.03, 0.06]]));
    cr.moveTo(16, 110);
    cr.lineTo(150, 110);
    cr.curveTo(166, 110, 170, 95, 160, 88);
    cr.lineTo(128, 88);
    cr.lineTo(120, 76);
    cr.lineTo(46, 72);
    cr.curveTo(26, 71, 18, 56, 24, 46);
    cr.curveTo(28, 40, 37, 42, 35, 49);
    cr.curveTo(34, 53, 29, 52, 30, 48);
    cr.curveTo(12, 56, 8, 100, 16, 110);
    cr.closePath();
    cr.fillPreserve();
    rgba(cr, 0.98, 0.8, 0.32);
    cr.setLineWidth(1.6);
    cr.stroke();
    // золотые завитки
    rgba(cr, 0.98, 0.8, 0.32, 0.95);
    cr.setLineWidth(1.1);
    const curl = (x, y, r, dir) => {
        cr.moveTo(x, y);
        cr.curveTo(x + r * dir, y - r, x + r * 2 * dir, y + r * 0.5, x + r * 1.2 * dir, y + r * 0.6);
        cr.stroke();
        cr.arc(x + r * 1.2 * dir, y + r * 0.6, 0.9, 0, 2 * Math.PI);
        cr.fill();
    };
    cr.moveTo(26, 96);
    cr.curveTo(60, 84, 95, 104, 150, 96);
    cr.stroke();
    curl(40, 92, 5, 1);
    curl(72, 96, 5, 1);
    curl(104, 100, 5, -1);
    curl(136, 97, 4, 1);
    for (const [x, y] of [[56, 102], [88, 90], [120, 104], [150, 100]]) {
        cr.arc(x, y, 1.1, 0, 2 * Math.PI);
        cr.fill();
    }
    // меховое покрывало на коленях
    cr.setSource(linear(0, 76, 0, 92, [[0, 0.82, 0.9, 1], [1, 0.62, 0.74, 0.92]]));
    cr.moveTo(84, 78);
    cr.curveTo(100, 74, 118, 75, 130, 80);
    cr.lineTo(126, 92);
    cr.curveTo(112, 88, 98, 88, 86, 92);
    cr.closePath();
    cr.fill();
    snowflakeMark(cr, 100, 84, 2.6, 0.95);
    snowflakeMark(cr, 115, 84, 2.2, 0.95);
    rgba(cr, 1, 1, 1);
    cr.setLineWidth(2);
    cr.moveTo(85, 91);
    cr.curveTo(98, 87, 112, 87, 126, 91);
    cr.stroke();

    // полозья
    rgba(cr, 0.88, 0.68, 0.22);
    cr.setLineWidth(2);
    for (const x of [32, 78, 124]) {
        cr.moveTo(x, 110);
        cr.lineTo(x, 118);
    }
    cr.stroke();
    cr.setSource(linear(0, 115, 0, 121, [[0, 1, 0.86, 0.4], [1, 0.72, 0.52, 0.12]]));
    cr.setLineWidth(3.2);
    cr.moveTo(6, 119);
    cr.lineTo(152, 119);
    cr.curveTo(172, 119, 178, 104, 168, 96);
    cr.curveTo(161, 90, 153, 97, 158, 101);
    cr.stroke();
}

/* Машущая рука (дальняя, за шубой): плечо в точке (6, 20) холста. */
const ARM_W = 46, ARM_H = 40, ARM_PIVOT = [6, 20];
function drawArm(cr) {
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setSource(linear(0, 14, 0, 26, [[0, 0.7, 0.06, 0.1], [1, 0.5, 0.03, 0.07]]));
    cr.setLineWidth(6.5);
    cr.moveTo(ARM_PIVOT[0], ARM_PIVOT[1]);
    cr.lineTo(ARM_PIVOT[0] + 26, ARM_PIVOT[1]);
    cr.stroke();
    rgba(cr, 0.96, 0.96, 1);
    ellipse(cr, ARM_PIVOT[0] + 27, ARM_PIVOT[1], 2.3, 4.2);
    cr.fill();
    cr.setSource(radial(ARM_PIVOT[0] + 32, ARM_PIVOT[1], 0, 5, [[0, 0.95, 0.2, 0.22], [1, 0.58, 0.04, 0.08]]));
    ellipse(cr, ARM_PIVOT[0] + 32, ARM_PIVOT[1], 4.4, 3.8);
    cr.fill();
    // большой палец рукавицы
    ellipse(cr, ARM_PIVOT[0] + 31, ARM_PIVOT[1] - 3.8, 1.7, 2.3, 0.4);
    cr.fill();
}

function drawGlow(cr, w, h, r, g, b) {
    cr.setSource(radial(w / 2, h / 2, 0, w / 2, [[0, r, g, b, 0.95], [0.25, r, g, b, 0.5], [1, r, g, b, 0]]));
    cr.arc(w / 2, h / 2, w / 2, 0, 2 * Math.PI);
    cr.fill();
}

function drawSparkle(cr, w, h) {
    const c = w / 2;
    cr.setSource(radial(c, c, 0, c, [[0, 1, 1, 0.9, 1], [0.3, 1, 0.9, 0.5, 0.6], [1, 1, 0.85, 0.4, 0]]));
    cr.moveTo(c, 0);
    cr.lineTo(c + w * 0.08, c - w * 0.08);
    cr.lineTo(w, c);
    cr.lineTo(c + w * 0.08, c + w * 0.08);
    cr.lineTo(c, h);
    cr.lineTo(c - w * 0.08, c + w * 0.08);
    cr.lineTo(0, c);
    cr.lineTo(c - w * 0.08, c - w * 0.08);
    cr.closePath();
    cr.fill();
}

function drawPuff(cr, w) {
    const c = w / 2;
    cr.setSource(radial(c, c, 0, c, [[0, 1, 1, 1, 1], [0.6, 0.93, 0.96, 1, 0.85], [1, 0.85, 0.9, 1, 0]]));
    cr.arc(c, c, c, 0, 2 * Math.PI);
    cr.fill();
}

module.exports = {
    ART_W, ART_H, GROUND, DEER, HAND, STAFF_TOP, SHOULDER, NOSE, ARM_W, ARM_H, ARM_PIVOT,
    drawDeerFrame, drawSleighFrame, drawArm, drawGlow, drawSparkle, drawPuff,
};
