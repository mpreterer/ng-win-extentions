/* Рисунки фейерверка (Cairo): ракета в бутылке, батарея салютов, фонтан,
 * зажигалка и светящиеся искры. Всё рисуется кодом, без картинок.
 *
 * У каждого изделия начало координат — середина низа; KINDS[k] хранит
 * размер и точку кончика фитиля (куда подносить зажигалку и где бежит искра).
 */
// Перенесено из версии для GNOME без изменений (Cairo → обёртка Canvas).
'use strict';

const Cairo = require('../cairo');

const KINDS = {
    rocket: { w: 34, h: 88, fuse: [14, -48] },
    battery: { w: 66, h: 50, fuse: [38, -19] },
    fountain: { w: 38, h: 52, fuse: [3, -58] },
};

// цвета искр: [r, g, b]
const COLORS = {
    red: [1, 0.22, 0.2],
    orange: [1, 0.55, 0.12],
    gold: [1, 0.8, 0.3],
    green: [0.3, 1, 0.35],
    cyan: [0.3, 0.95, 1],
    blue: [0.35, 0.5, 1],
    purple: [0.75, 0.35, 1],
    pink: [1, 0.4, 0.75],
    white: [1, 1, 1],
    silver: [0.85, 0.9, 1],
};

// светящаяся искра: белое ядро, цветной ореол, мягкий край
function drawGlow(cr, w, rgb) {
    const c = w / 2;
    const [r, g, b] = rgb;
    const grad = new Cairo.RadialGradient(c, c, 0, c, c, c);
    grad.addColorStopRGBA(0, 1, 1, 1, 1);
    grad.addColorStopRGBA(0.18, Math.min(1, r * 0.5 + 0.5), Math.min(1, g * 0.5 + 0.5), Math.min(1, b * 0.5 + 0.5), 1);
    grad.addColorStopRGBA(0.42, r, g, b, 0.75);
    grad.addColorStopRGBA(0.7, r, g, b, 0.22);
    grad.addColorStopRGBA(1, r, g, b, 0);
    cr.setSource(grad);
    cr.arc(c, c, c, 0, 2 * Math.PI);
    cr.fill();
}

function roundRect(cr, x, y, w, h, r) {
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

function drawFuse(cr, x0, y0, x1, y1, burnt) {
    // скрученный фитиль
    cr.setLineCap(1);
    cr.setLineWidth(2.2);
    cr.setSourceRGB(burnt ? 0.2 : 0.38, burnt ? 0.2 : 0.42, burnt ? 0.2 : 0.3);
    cr.moveTo(x0, y0);
    cr.curveTo(x0 + (x1 - x0) * 0.3, y0 - 6, x0 + (x1 - x0) * 0.7, y1 + 6, x1, y1);
    cr.stroke();
    if (!burnt) {
        cr.setSourceRGBA(0.85, 0.8, 0.55, 0.9);
        cr.arc(x1, y1, 1.6, 0, 2 * Math.PI);
        cr.fill();
    }
}

function drawRocket(cr) {
    // ракета на палочке, воткнутой в землю
    const g = new Cairo.LinearGradient(-1.6, 0, 1.6, 0);
    g.addColorStopRGB(0, 0.55, 0.38, 0.2);
    g.addColorStopRGB(0.5, 0.82, 0.62, 0.38);
    g.addColorStopRGB(1, 0.5, 0.34, 0.18);
    cr.setSource(g);
    cr.rectangle(-1.6, -44, 3.2, 44);
    cr.fill();
    cr.setSourceRGBA(0, 0, 0, 0.18);
    cr.save();
    cr.translate(0, -1);
    cr.scale(5, 1.5);
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
    cr.fill();
    // корпус в полоску
    const top = -84, bottom = -40;
    cr.save();
    roundRect(cr, -6, top + 12, 12, bottom - top - 12, 2);
    cr.clip();
    cr.setSourceRGB(0.86, 0.12, 0.16);
    cr.paint();
    cr.setSourceRGB(1, 1, 1);
    for (let y = top + 16; y < bottom; y += 9) {
        cr.moveTo(-6, y);
        cr.lineTo(6, y + 4);
        cr.lineTo(6, y + 7);
        cr.lineTo(-6, y + 3);
        cr.closePath();
        cr.fill();
    }
    const sh = new Cairo.LinearGradient(-6, 0, 6, 0);
    sh.addColorStopRGBA(0, 0, 0, 0, 0.25);
    sh.addColorStopRGBA(0.4, 1, 1, 1, 0.2);
    sh.addColorStopRGBA(1, 0, 0, 0, 0.35);
    cr.setSource(sh);
    cr.paint();
    cr.restore();
    // золотой конус
    cr.setSourceRGB(0.98, 0.76, 0.2);
    cr.moveTo(-7, top + 13);
    cr.lineTo(0, top);
    cr.lineTo(7, top + 13);
    cr.closePath();
    cr.fill();
    cr.setSourceRGBA(0.7, 0.45, 0.05, 0.6);
    cr.moveTo(0, top);
    cr.lineTo(7, top + 13);
    cr.lineTo(2, top + 13);
    cr.closePath();
    cr.fill();
    // фитиль снизу корпуса
    const [fx, fy] = KINDS.rocket.fuse;
    drawFuse(cr, 2, bottom - 1, fx, fy, false);
}

function drawBattery(cr, burnt) {
    const w = 60, h = 42;
    // коробка
    const g = new Cairo.LinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStopRGB(0, 0.75, 0.08, 0.12);
    g.addColorStopRGB(0.5, 0.92, 0.18, 0.2);
    g.addColorStopRGB(1, 0.6, 0.05, 0.1);
    cr.setSource(g);
    roundRect(cr, -w / 2, -h, w, h, 3);
    cr.fill();
    // крышка с трубками
    cr.setSourceRGB(0.95, 0.78, 0.25);
    cr.rectangle(-w / 2, -h, w, 6);
    cr.fill();
    cr.setSourceRGB(0.08, 0.06, 0.05);
    for (let i = 0; i < 4; i++)
        for (let j = 0; j < 2; j++) {
            cr.save();
            cr.translate(-w / 2 + 9 + i * 14, -h + 2 + j * 2.6);
            cr.scale(1, 0.32);
            cr.arc(0, 0, 5, 0, 2 * Math.PI);
            cr.restore();
            cr.fill();
        }
    {
        // звёзды на боку
        cr.setSourceRGB(1, 0.85, 0.25);
        const star = (x, y, s) => {
            for (let k = 0; k < 10; k++) {
                const a = -Math.PI / 2 + k * Math.PI / 5;
                const rr = k % 2 ? s * 0.45 : s;
                if (k === 0)
                    cr.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
                else
                    cr.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            }
            cr.closePath();
            cr.fill();
        };
        star(-16, -22, 7);
        star(2, -14, 4.5);
        star(14, -27, 5);
        star(-3, -31, 3);
        cr.setSourceRGBA(1, 1, 1, 0.18);
        cr.rectangle(-w / 2 + 3, -h + 8, 4, h - 12);
        cr.fill();
        if (!burnt) {
            const [fx, fy] = KINDS.battery.fuse;
            drawFuse(cr, w / 2 - 2, -12, fx, fy, false);
        }
    }
}

function drawFountain(cr, burnt) {
    // конус на подставке
    cr.setSourceRGB(0.2, 0.2, 0.25);
    cr.save();
    cr.translate(0, -3);
    cr.scale(1, 0.3);
    cr.arc(0, 0, 18, 0, 2 * Math.PI);
    cr.restore();
    cr.fill();
    cr.save();
    cr.moveTo(-15, -4);
    cr.lineTo(-3, -48);
    cr.lineTo(3, -48);
    cr.lineTo(15, -4);
    cr.closePath();
    cr.clip();
    cr.setSourceRGB(0.15, 0.45, 0.9);
    cr.paint();
    cr.setSourceRGB(1, 0.85, 0.25);
    for (let y = -44; y < -4; y += 10) {
        cr.rectangle(-20, y, 40, 4);
        cr.fill();
    }
    const sh = new Cairo.LinearGradient(-15, 0, 15, 0);
    sh.addColorStopRGBA(0, 0, 0, 0, 0.3);
    sh.addColorStopRGBA(0.4, 1, 1, 1, 0.22);
    sh.addColorStopRGBA(1, 0, 0, 0, 0.4);
    cr.setSource(sh);
    cr.paint();
    cr.restore();
    if (!burnt) {
        const [fx, fy] = KINDS.fountain.fuse;
        drawFuse(cr, 0, -48, fx, fy, false);
    }
}

function drawItem(cr, kind, burnt) {
    // burnt — фитиль догорел (изделие доработает и плавно исчезнет)
    if (kind === 'rocket')
        drawRocket(cr);
    else if (kind === 'battery')
        drawBattery(cr, burnt);
    else
        drawFountain(cr, burnt);
}

/* Зажигалка: корпус и откидная крышка; пламя — отдельной картинкой,
 * чтобы оно дрожало без перерисовки. Кончик пламени — в (0, 0) пламени. */
const LIGHTER_W = 26;
const LIGHTER_H = 40;

function drawLighterBody(cr, w) {
    const x = (w - 20) / 2;
    // корпус
    const g = new Cairo.LinearGradient(x, 0, x + 20, 0);
    g.addColorStopRGB(0, 0.55, 0.57, 0.62);
    g.addColorStopRGB(0.35, 0.92, 0.93, 0.96);
    g.addColorStopRGB(1, 0.45, 0.47, 0.52);
    cr.setSource(g);
    roundRect(cr, x, 12, 20, 28, 3);
    cr.fill();
    // открытая крышка сбоку
    cr.setSource(g);
    roundRect(cr, x + 14, 0, 10, 13, 2);
    cr.fill();
    // ветрозащита с дырочками
    cr.setSourceRGB(0.75, 0.77, 0.8);
    cr.rectangle(x + 3, 4, 12, 9);
    cr.fill();
    cr.setSourceRGB(0.35, 0.36, 0.4);
    for (let i = 0; i < 3; i++)
        for (let j = 0; j < 2; j++) {
            cr.arc(x + 5.5 + i * 3.5, 6.5 + j * 3.5, 0.9, 0, 2 * Math.PI);
            cr.fill();
        }
    cr.setSourceRGBA(0, 0, 0, 0.35);
    cr.rectangle(x, 22, 20, 1.2);
    cr.fill();
}

function drawFlame(cr, w, h) {
    const cx = w / 2;
    const outer = new Cairo.RadialGradient(cx, h * 0.72, 1, cx, h * 0.6, h * 0.6);
    outer.addColorStopRGBA(0, 1, 1, 0.85, 1);
    outer.addColorStopRGBA(0.35, 1, 0.75, 0.2, 0.95);
    outer.addColorStopRGBA(0.8, 1, 0.35, 0.05, 0.5);
    outer.addColorStopRGBA(1, 1, 0.2, 0, 0);
    cr.setSource(outer);
    cr.moveTo(cx, 0);
    cr.curveTo(cx + w * 0.5, h * 0.45, cx + w * 0.42, h, cx, h);
    cr.curveTo(cx - w * 0.42, h, cx - w * 0.5, h * 0.45, cx, 0);
    cr.closePath();
    cr.fill();
    cr.setSourceRGBA(0.45, 0.65, 1, 0.75);
    cr.save();
    cr.translate(cx, h * 0.86);
    cr.scale(w * 0.16, h * 0.12);
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
    cr.fill();
}

module.exports = { KINDS, COLORS, LIGHTER_W, LIGHTER_H, drawGlow, drawItem, drawLighterBody, drawFlame };
