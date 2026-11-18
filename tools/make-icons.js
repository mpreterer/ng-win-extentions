/* Рисует значки (трей и приложение) и сохраняет в assets/.
 * Запуск: npm run icons */
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', 'assets');

const DRAW = `
function tree(ctx, s) {
    // ёлочка для трея: видна и на тёмной, и на светлой панели задач
    ctx.save();
    ctx.scale(s / 32, s / 32);
    ctx.lineJoin = 'round';
    const tier = (top, bottom, half) => {
        ctx.beginPath();
        ctx.moveTo(16, top);
        ctx.lineTo(16 + half, bottom);
        ctx.lineTo(16 - half, bottom);
        ctx.closePath();
    };
    ctx.fillStyle = '#6b3d1c';
    ctx.fillRect(13.5, 25, 5, 6);
    const tiers = [[5, 14, 7], [9, 20, 10], [13, 26.5, 13]];
    for (const [t, b, h] of tiers) {
        tier(t, b, h);
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = 'rgba(0,30,10,0.85)';
        ctx.stroke();
    }
    for (const [t, b, h] of tiers) {
        tier(t, b, h);
        const g = ctx.createLinearGradient(16 - h, 0, 16 + h, 0);
        g.addColorStop(0, '#13702f');
        g.addColorStop(0.45, '#2fb352');
        g.addColorStop(1, '#0e5f27');
        ctx.fillStyle = g;
        ctx.fill();
    }
    // снег на ярусах
    ctx.fillStyle = '#ffffff';
    for (const [t, b, h] of tiers) {
        ctx.beginPath();
        ctx.ellipse(16, b - 0.6, h * 0.8, 1.3, 0, Math.PI, 2 * Math.PI);
        ctx.fill();
    }
    // игрушки
    for (const [x, y, c] of [[12, 17, '#ff3b30'], [19.5, 22, '#ffd60a'], [14, 23.5, '#0a84ff'], [18, 13, '#ff2d92']]) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, 2 * Math.PI);
        ctx.fill();
    }
    // звезда
    ctx.fillStyle = '#ffcc00';
    ctx.strokeStyle = 'rgba(120,70,0,0.9)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5;
        const r = k % 2 ? 2 : 4.6;
        ctx.lineTo(16 + Math.cos(a) * r, 4.6 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function appIcon(ctx, s) {
    ctx.save();
    ctx.scale(s / 256, s / 256);
    // тёмно-синий квадрат со скруглением, снежинки и ёлка
    const r = 56;
    ctx.beginPath();
    ctx.moveTo(r, 8); ctx.lineTo(256 - r, 8); ctx.quadraticCurveTo(248, 8, 248, r);
    ctx.lineTo(248, 256 - r); ctx.quadraticCurveTo(248, 248, 256 - r, 248);
    ctx.lineTo(r, 248); ctx.quadraticCurveTo(8, 248, 8, 256 - r);
    ctx.lineTo(8, r); ctx.quadraticCurveTo(8, 8, r, 8);
    ctx.closePath();
    const bg = ctx.createLinearGradient(0, 8, 0, 248);
    bg.addColorStop(0, '#1b2b5c');
    bg.addColorStop(1, '#0b1330');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // сугроб
    ctx.fillStyle = '#eef4ff';
    ctx.beginPath();
    ctx.moveTo(0, 214);
    ctx.bezierCurveTo(60, 188, 120, 206, 170, 194);
    ctx.bezierCurveTo(210, 186, 240, 196, 256, 190);
    ctx.lineTo(256, 256); ctx.lineTo(0, 256);
    ctx.closePath();
    ctx.fill();
    // снежинки-точки
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, rr] of [[40, 50, 5], [200, 40, 4], [222, 110, 6], [30, 130, 4], [70, 90, 3], [180, 150, 3]]) {
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, 2 * Math.PI);
        ctx.fill();
    }
    ctx.restore();
    ctx.translate(48, 26);
    tree(ctx, 160);
    ctx.restore();
}

function render(fn, s) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    fn(c.getContext('2d'), s);
    return c.toDataURL('image/png');
}

({
    tray16: render(tree, 16), tray32: render(tree, 32),
    icon16: render(appIcon, 16), icon32: render(appIcon, 32), icon48: render(appIcon, 48), icon256: render(appIcon, 256),
});
`;

function png(dataUrl) {
    return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// ICO с PNG внутри (так умеют все Windows начиная с Vista)
function ico(images) {
    const head = Buffer.alloc(6 + 16 * images.length);
    head.writeUInt16LE(0, 0);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(images.length, 4);
    let offset = head.length;
    images.forEach(([size, data], i) => {
        const e = 6 + i * 16;
        head.writeUInt8(size >= 256 ? 0 : size, e);
        head.writeUInt8(size >= 256 ? 0 : size, e + 1);
        head.writeUInt8(0, e + 2);
        head.writeUInt8(0, e + 3);
        head.writeUInt16LE(1, e + 4);
        head.writeUInt16LE(32, e + 6);
        head.writeUInt32LE(data.length, e + 8);
        head.writeUInt32LE(offset, e + 12);
        offset += data.length;
    });
    return Buffer.concat([head, ...images.map(x => x[1])]);
}

app.whenReady().then(async () => {
    const w = new BrowserWindow({ show: false, width: 300, height: 300 });
    await w.loadURL('data:text/html,<html><body></body></html>');
    const r = await w.webContents.executeJavaScript(DRAW);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'tray.png'), png(r.tray16));
    fs.writeFileSync(path.join(OUT, 'tray@2x.png'), png(r.tray32));
    fs.writeFileSync(path.join(OUT, 'icon.png'), png(r.icon256));
    fs.writeFileSync(path.join(OUT, 'icon.ico'), ico([
        [16, png(r.icon16)], [32, png(r.icon32)], [48, png(r.icon48)], [256, png(r.icon256)],
    ]));
    console.log('icons written to', OUT);
    app.quit();
});
