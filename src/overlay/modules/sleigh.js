/* Ded Moroz Sleigh — перенос расширения GNOME на Windows.
 *
 * Раз в N минут (по умолчанию 3 часа) Дед Мороз на санях с тройкой оленей
 * проезжает по низу главного экрана — по верхнему краю панели задач. Пока
 * саней нет, модуль ничего не рисует и только раз в минуту проверяет время.
 *
 * Сцена собрана из слоёв, как в GNOME:
 *   олени — 4 кадра галопа; дальняя рука Деда Мороза машет (поворот);
 *   сани + Дед Мороз — одна картинка, слегка подпрыгивает;
 *   кристалл посоха и искры бубенчиков мерцают;
 *   снежные брызги — частицы из-под полозьев и копыт.
 *
 * Связь со снегом: на время проезда сани кладут свой прямоугольник в
 * rt.obstacles — снег выбрасывает сугроб из-под саней; снежный шар на пути
 * (rt.festiveGround.hitBall) — сани врезаются и переворачиваются.
 */
'use strict';

const Cairo = require('../cairo');
const Art = require('./sleigh-art');
const { FestiveLayer } = require('../runtime');

const GALLOP = 0.36;         // длительность одного шага галопа, с

/* Картинка в «художественных» координатах, растянутая на w×h пикселей. */
function art(w, h, artW, artH, draw, dpr) {
    return Cairo.makeCanvas(w, h, cr => {
        cr.scale(w / artW, h / artH);
        draw(cr, artW, artH);
    }, dpr);
}

class Sleigh {
    constructor(rt) {
        this.rt = rt;
        this.name = 'sleigh';
        this.s = rt.S.view('sleigh');
        this._run = null;
        this._obstacle = null;
        this._tex = null;
        // где показывать; сани держатся над слоем снега (модуль добавлен после снега)
        this._fl = new FestiveLayer(rt, this.s, null);
        this._checkId = setInterval(() => this._maybeRun(), 60 * 1000);
        // Первый раз после установки — показать через полминуты.
        if (this.s.get('last-run') === 0 && this.s.get('enabled')) {
            this._firstId = setTimeout(() => {
                this._firstId = 0;
                this.runNow(false);
            }, 30 * 1000);
        }
    }

    action(name) {
        if (name === 'run')
            this.runNow(true);
    }

    // manual=true — ручной запуск: режим показа не мешает, сани всегда видны
    _blocked(manual = false) {
        // режим «только на пустом столе»: ждём, пока закроют окна
        if (!manual && !this._fl.shown)
            return true;
        const mon = this.rt.primary;
        return !!(this.s.get('hide-in-fullscreen') && mon && mon.inFullscreen);
    }

    // Время последнего проезда. Если оно в будущем (часы перевели назад),
    // считаем, что проезд был только что — иначе автопроезды надолго замрут.
    _lastRun() {
        const now = Math.floor(Date.now() / 1000);
        const last = this.s.get('last-run');
        if (last > now + 60) {
            this.s.set('last-run', now);
            return now;
        }
        return last;
    }

    _maybeRun() {
        if (this._run || !this.s.get('enabled'))
            return;
        const now = Date.now() / 1000;
        const interval = this.s.get('interval-minutes') * 60;
        if (now - this._lastRun() >= interval && !this._blocked())
            this.runNow(false);
    }

    _textures(s) {
        if (this._tex && this._tex.s === s)
            return this._tex;
        const dpr = this.rt.dpr;
        const W = Art.ART_W * s, H = Art.ART_H * s;
        const gs = 26 * s;
        this._tex = {
            s,
            deer: [0, 1, 2, 3].map(f => art(W, H, Art.ART_W, Art.ART_H, cr => Art.drawDeerFrame(cr, f), dpr)),
            body: art(W, H, Art.ART_W, Art.ART_H, cr => Art.drawSleighFrame(cr), dpr),
            arm: art(Art.ARM_W * s, Art.ARM_H * s, Art.ARM_W, Art.ARM_H, cr => Art.drawArm(cr), dpr),
            glow: art(gs, gs, 26, 26, (cr, w, h) => Art.drawGlow(cr, w, h, 0.6, 0.85, 1), dpr),
            spark: art(9 * s, 9 * s, 9, 9, (cr, w, h) => Art.drawSparkle(cr, w, h), dpr),
            puff: art(12, 12, 12, 12, (cr, w) => Art.drawPuff(cr, w), dpr),
        };
        return this._tex;
    }

    /* manual=true (меню, горячая клавиша, кнопка в настройках): сани всегда
     * проезжают поверх окон, даже если выбран режим «только на пустом столе»
     * или «под окнами» — иначе ручной проезд шёл бы невидимо за окнами. */
    runNow(manual = true) {
        const mon = this.rt.primary;
        if (this._run || !mon)
            return;
        this.s.set('last-run', Math.floor(Date.now() / 1000));
        const s = this.s.get('scale');
        const W = Art.ART_W * s, H = Art.ART_H * s;
        let dir = this.s.get('direction');
        if (dir === 'random')
            dir = Math.random() < 0.5 ? 'ltr' : 'rtl';
        const sign = dir === 'ltr' ? 1 : -1;
        const tex = this._textures(s);
        // земля — верхний край панели задач (рабочая область главного монитора)
        const wa = mon.work;
        const ground = wa.y + wa.height;

        // искорки у бубенчиков
        const sparks = [];
        Art.DEER.forEach((cx, i) => {
            for (const dy of [70, 82]) {
                sparks.push({
                    cx: (cx + 19) * s, cy: (dy - 1) * s,
                    op: 0, rot: 0,
                    phase: Math.random() * 10 + i,
                    rate: 2.5 + Math.random() * 2.5,
                });
            }
        });

        this._run = {
            sign, s, W, H, tex, sparks,
            manual: manual && this._fl.mode !== 'above',
            puffs: [],
            emitAcc: 0,
            speed: this.s.get('speed') * sign,
            x: sign > 0 ? wa.x - W - 20 : wa.x + wa.width + 20,
            y: ground - H + 3 * s,
            endX: sign > 0 ? wa.x + wa.width + 20 : wa.x - W - 20,
            ground,
            t: 0, frame: 0, done: false,
            crash: null,
            visible: true,
            deerTx: 0, deerTy: 0,
            sledRot: 0, sledTy: 0, armRot: -112,
            glowOp: 1, glowScale: 1,
        };
        this._run.baseSpeed = this._run.speed;
        // хитбокс для снега: нижняя часть упряжки
        this._obstacle = { x: 0, y: 0, w: W, h: H * 0.45, vx: this._run.speed };
        this.rt.obstacles.add(this._obstacle);
        this._step(0);
    }

    // точка рисунка → экран (с учётом зеркалирования)
    _toScreen(r, ax, ay) {
        const lx = r.sign > 0 ? ax * r.s : r.W - ax * r.s;
        return [r.x + lx, r.y + ay * r.s];
    }

    _emitSpray(r, dt, moving) {
        if (!moving)
            return;
        // ~110 комочков в секунду: из-под полозьев и копыт, назад и вверх
        r.emitAcc += dt * 110;
        while (r.emitAcc >= 1) {
            r.emitAcc -= 1;
            let ax;
            const u = Math.random();
            if (u < 0.45)
                ax = 8 + Math.random() * 150;                 // полозья
            else
                ax = Art.DEER[(Math.random() * Art.DEER.length) | 0] + (Math.random() - 0.5) * 50;   // копыта
            const [x, y] = this._toScreen(r, ax, Art.GROUND - 1);
            const size = (2 + Math.random() * 4.5) * r.s;
            r.puffs.push({
                size, x, y, op: 0.9,
                vx: -r.sign * (40 + Math.random() * 190) * r.s,
                vy: -(70 + Math.random() * 230) * r.s,
                age: 0, life: 0.45 + Math.random() * 0.7,
            });
        }
    }

    _updateSpray(r, dt) {
        const g = 620 * r.s;
        for (let i = r.puffs.length - 1; i >= 0; i--) {
            const p = r.puffs[i];
            p.age += dt;
            if (p.age >= p.life) {
                r.puffs.splice(i, 1);
                continue;
            }
            p.vy += g * dt;
            p.vx *= Math.exp(-1.2 * dt);
            p.x += p.vx * dt;
            p.y = Math.min(r.ground - p.size / 2, p.y + p.vy * dt);
            p.op = 0.9 * Math.min(1, (p.life - p.age) / (p.life * 0.5));
        }
    }

    tick(now, dt) {
        if (this._run)
            this._step(Math.min(0.1, dt));
    }

    _step(dt) {
        const r = this._run;
        if (!r)
            return;
        r.t += dt;
        r.x += r.speed * dt;
        // в режиме «только на пустом столе» автопроезд прячет сам слой (плавно)
        const blocked = r.manual ? this._blocked(true)
            : this._blocked() && this._fl.mode !== 'desktop';

        // впереди снежный шар или снеговик (из эффекта «Снег») — врезаемся
        const groundApi = this.rt.festiveGround;
        if (!r.crash && !r.done && !blocked && groundApi && groundApi.hitBall) {
            const [fx] = this._toScreen(r, Art.NOSE, Art.GROUND);
            if (groundApi.hitBall(fx, fx + r.sign * 14 * r.s, r.sign))
                this._startCrash(r, fx);
        }
        const c = r.crash;
        if (c)
            this._crashStep(r, c, dt);

        // галоп: 4 кадра (во время аварии олени стоят)
        if (!c || c.t > 2.6)
            r.frame = Math.floor(r.t / (GALLOP / 4)) % 4;
        if (!c) {
            // сани подпрыгивают на неровностях
            r.sledTy = -Math.abs(Math.sin(r.t * 9.5)) * 1.6 * r.s - Math.max(0, Math.sin(r.t * 2.3)) * 1.2 * r.s;
            // Дед Мороз машет рукой
            r.armRot = -112 + 26 * Math.sin(r.t * 7.5);
        }
        // кристалл посоха пульсирует
        const pulse = Math.pow(Math.sin(r.t * 2.6), 2);
        r.glowOp = (110 + 145 * pulse) / 255;
        r.glowScale = 0.8 + 0.35 * pulse;
        // искры бубенчиков
        for (const sp of r.sparks) {
            const v = Math.max(0, Math.sin(r.t * sp.rate + sp.phase));
            sp.op = Math.pow(v, 10);
            sp.rot = r.t * 90;
        }

        r.visible = !blocked && !r.done;
        this._emitSpray(r, dt, !blocked && !r.done && (!c || c.t > 2.6));
        this._updateSpray(r, dt);

        const o = this._obstacle;   // после выезда за край его уже нет
        if (o) {
            o.x = r.x;
            o.y = r.y + r.H - o.h;
        }

        // Уехали за край: прячем упряжку, перестаём сыпать снег и ждём,
        // пока догорят последние брызги. Страховка — не дольше 3 с после выезда.
        if (!r.done && (r.sign > 0 ? r.x >= r.endX : r.x <= r.endX)) {
            r.done = true;
            r.doneAt = r.t;
            r.speed = 0;
            r.visible = false;
            if (this._obstacle) {
                this.rt.obstacles.delete(this._obstacle);
                this._obstacle = null;
            }
        }
        this.rt.redraw(this._layer(r));
        if ((r.done && (r.puffs.length === 0 || r.t - r.doneAt > 3)) || r.t > 90)
            this._finish();
    }

    /* Врезались в снежный шар: упряжка встаёт как вкопанная, шар разлетается,
     * сани подлетают и переворачиваются вверх полозьями, Дед Мороз
     * размахивает руками; потом сани кувыркаются обратно и упряжка едет дальше. */
    _startCrash(r, fx) {
        r.crash = { t: 0 };
        r.speed = 0;
        // большой снежный «бум» из-под копыт
        for (let k = 0; k < 70; k++) {
            const size = (3 + Math.random() * 6) * r.s;
            r.puffs.push({
                size, op: 0.9,
                x: fx + (Math.random() - 0.5) * 60 * r.s,
                y: r.ground - Math.random() * 30 * r.s,
                vx: r.sign * (Math.random() * 260 - 60) * r.s,
                vy: -(150 + Math.random() * 420) * r.s,
                age: 0, life: 0.7 + Math.random() * 0.9,
            });
        }
        // пока стоим, снег под санями не разбрасываем
        if (this._obstacle)
            this.rt.obstacles.delete(this._obstacle);
    }

    _crashStep(r, c, dt) {
        c.t += dt;
        const t = c.t, s = r.s;
        const easeOut = p => 1 - Math.pow(1 - p, 3);
        const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
        let rot, hop;
        if (t < 0.6) {
            const p = t / 0.6;
            rot = 180 * easeOut(p);
            hop = -Math.sin(Math.PI * p) * 60 * s;
        } else if (t < 2.0) {
            // лежат вверх полозьями и покачиваются
            const u = t - 0.6;
            rot = 180 + 7 * Math.sin(u * 13) * Math.exp(-u * 2.2);
            hop = -Math.abs(Math.sin(u * 13)) * 4 * s * Math.exp(-u * 3);
        } else if (t < 2.6) {
            const p = (t - 2.0) / 0.6;
            rot = 180 + 180 * easeInOut(p);
            hop = -Math.sin(Math.PI * p) * 48 * s;
        } else {
            rot = 0;
            hop = 0;
            // разгон
            r.speed = r.baseSpeed * Math.min(1, (t - 2.6) / 0.7);
        }
        r.sledRot = rot % 360;
        r.sledTy = hop;
        // руки: в воздухе и вверх ногами Дед Мороз отчаянно машет
        r.armRot = t < 2.6 ? -112 + 70 * Math.sin(t * 22) : -112 + 26 * Math.sin(r.t * 7.5);
        // олени от удара подскакивают и отшатываются
        r.deerTy = t < 0.4 ? -Math.sin(Math.PI * t / 0.4) * 12 * s : 0;
        r.deerTx = t < 0.4 ? -Math.sin(Math.PI * t / 0.4) * 8 * s : 0;
        if (t >= 3.3) {
            r.crash = null;
            r.speed = r.baseSpeed;
            r.sledRot = 0;
            if (this._obstacle)
                this.rt.obstacles.add(this._obstacle);
        }
    }

    _finish() {
        if (this._obstacle) {
            this.rt.obstacles.delete(this._obstacle);
            this._obstacle = null;
        }
        if (this._run)
            this.rt.redraw(this._layer(this._run));
        this._run = null;
    }

    _layer(r) {
        return r.manual ? 'top' : this._fl.layer;
    }

    draw(cr, layer, pass, ctx) {
        const r = this._run;
        if (!r || pass !== 'main' || layer !== this._layer(r))
            return;
        const alpha = r.manual ? 1 : this._fl.opacity;
        if (alpha <= 0.002)
            return;
        const { tex, W, H, s } = r;
        const D = Math.PI / 180;
        if (r.visible) {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(Math.round(r.x), Math.round(r.y));
            if (r.sign < 0) {
                // упряжка зеркалится целиком для движения справа налево
                ctx.translate(W, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(tex.deer[r.frame], r.deerTx, r.deerTy, W, H);
            // сани: поворот вокруг середины саней, подскок
            ctx.save();
            ctx.translate(0.2 * W, 0.48 * H + r.sledTy);
            ctx.rotate(r.sledRot * D);
            ctx.translate(-0.2 * W, -0.48 * H);
            ctx.save();
            ctx.translate(Art.SHOULDER[0] * s, Art.SHOULDER[1] * s);
            ctx.rotate(r.armRot * D);
            ctx.drawImage(tex.arm, -Art.ARM_PIVOT[0] * s, -Art.ARM_PIVOT[1] * s, Art.ARM_W * s, Art.ARM_H * s);
            ctx.restore();
            ctx.drawImage(tex.body, 0, 0, W, H);
            const gs = 26 * s;
            ctx.save();
            ctx.globalAlpha = alpha * r.glowOp;
            ctx.translate(Art.STAFF_TOP[0] * s, Art.STAFF_TOP[1] * s);
            ctx.scale(r.glowScale, r.glowScale);
            ctx.drawImage(tex.glow, -gs / 2, -gs / 2, gs, gs);
            ctx.restore();
            ctx.restore();
            const ss = 9 * s;
            for (const sp of r.sparks) {
                if (sp.op < 0.004)
                    continue;
                ctx.save();
                ctx.globalAlpha = alpha * sp.op;
                ctx.translate(sp.cx, sp.cy);
                ctx.rotate(sp.rot * D);
                ctx.drawImage(tex.spark, -ss / 2, -ss / 2, ss, ss);
                ctx.restore();
            }
            ctx.restore();
        }
        // брызги снега — в экранных координатах, поверх полозьев
        for (const p of r.puffs) {
            ctx.globalAlpha = alpha * p.op;
            ctx.drawImage(tex.puff, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
    }
}

module.exports = { Sleigh };
