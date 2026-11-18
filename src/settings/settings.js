/* Окно настроек: то же, что окна prefs.js у шести расширений GNOME,
 * собранное в одно окно с разделами. */
'use strict';

const path = require('path');
const { ipcRenderer, shell } = require('electron');
const I18n = require(path.join(__dirname, '..', 'i18n.js'));
const { SCHEMA } = require(path.join(__dirname, '..', 'schema.js'));
const T = I18n.T;

const init = ipcRenderer.sendSync('settings-ready');
const values = Object.assign({}, init.values);
let hotkeys = init.hotkeys || {};
I18n.setSystemLocale(init.locale);
I18n.setLanguage(values['app.language']);

const VIS_SUB = () => T('«Только на пустом рабочем столе» — видно, когда все окна закрыты или свёрнуты',
    '“Only on an empty desktop” — visible when all windows are closed or minimized');
const VIS = () => [['above', T('Поверх окон', 'Above windows')],
    ['desktop', T('Только на пустом рабочем столе', 'Only on an empty desktop')],
    ['below', T('Под окнами', 'Below windows')]];
const KEY_SUB = () => T('Например Ctrl+Alt+X. Пустое поле — без клавиши. Сочетания Win+Alt+… в Windows 11 заняты системой',
    'E.g. Ctrl+Alt+X. Empty — no hotkey. Win+Alt+… combos are taken by Windows 11');

// описание разделов: строки — {k, type, t, sub, ...}; группы — {group, desc, rows}
function sections() {
    return [
        {
            id: 'snow', icon: '❄', title: T('Снег', 'Snow'),
            desc: T('Падает и копится сугробами на заголовках окон и над панелью задач. Курсором скатываются снежки, из них складываются снеговики.',
                'Falls and piles up on window title bars and above the taskbar. Roll snowballs with the pointer and stack them into snowmen.'),
            groups: [
                {
                    title: T('Снег', 'Snow'), desc: T('⚡ — опции, от которых больше всего зависит нагрузка на систему.', '⚡ — options that affect system load the most.'),
                    rows: [
                        { k: 'enabled', type: 'switch', t: T('Снег включён', 'Snow enabled'), sub: T('То же делает горячая клавиша и меню в трее', 'The hotkey and the tray menu do the same') },
                        { k: 'flake-count', type: 'num', t: T('⚡ Падающих снежинок', '⚡ Falling snowflakes'), sub: T('Рекомендуется 80–150; больше 250 — заметная нагрузка', 'Recommended 80–150; above 250 is noticeably heavier'), step: 10 },
                        { k: 'wind', type: 'num', t: T('Ветер', 'Wind'), sub: T('px/с; отрицательное значение — дует влево', 'px/s; negative blows to the left'), step: 1 },
                    ],
                },
                {
                    title: T('Сугробы', 'Snow piles'),
                    rows: [
                        { k: 'settle-on-windows', type: 'switch', t: T('Оседать на окнах', 'Settle on windows') },
                        { k: 'settle-on-ground', type: 'switch', t: T('Оседать внизу экрана', 'Settle at the bottom of the screen'), sub: T('На верхнем краю панели задач', 'On the top edge of the taskbar') },
                        { k: 'drift-height', type: 'num', t: T('Высота сугробов на окнах, px', 'Height of drifts on windows, px'), sub: T('Плотная снежная шапка на верхней кромке окна', 'A thick snow cap on the top edge of the window'), step: 2 },
                        { k: 'drift-accumulation', type: 'num', t: T('Как быстро растут сугробы', 'How fast drifts grow'), sub: T('1 — тонкий слой, 10 — быстро наметает толстые сугробы', '1 — a thin layer, 10 — thick drifts pile up fast'), step: 1 },
                        { k: 'max-settled', type: 'num', t: T('Максимум осевших снежинок', 'Maximum settled snowflakes'), sub: T('Нагрузка небольшая (сугробы рисуются картинкой). 0 — снег не оседает', 'Low load (piles are drawn as a single image). 0 — snow does not settle'), step: 500 },
                        { k: 'melt-time', type: 'num', t: T('Время таяния, секунд', 'Melting time, seconds'), sub: T('Среднее время жизни осевшей снежинки', 'Average lifetime of a settled snowflake'), step: 10 },
                        { k: 'shake-sensitivity', type: 'num', t: T('Чувствительность к тряске', 'Shake sensitivity'), sub: T('1 — снег держится крепко, 10 — слетает от лёгкого движения', '1 — snow holds tight, 10 — falls off at the slightest move'), step: 1 },
                    ],
                },
                {
                    title: T('Снежки и снеговики', 'Snowballs and snowmen'),
                    desc: T('Проведите курсором вдоль сугроба (без нажатия) — снег скатается в шар. Шар можно взять мышью и положить на другой: из 2–5 шаров получится снеговик в шапке и шарфе.',
                        'Move the pointer along a drift (no click) and the snow rolls into a ball. Grab a ball with the mouse and drop it onto another: 2–5 balls make a snowman with a hat and a scarf.'),
                    rows: [
                        { k: 'snowballs', type: 'switch', t: T('Лепить снежки мышкой', 'Roll snowballs with the mouse') },
                    ],
                },
                {
                    title: T('Прочее', 'Other'),
                    rows: [
                        { k: 'fps', type: 'num', t: T('⚡ Кадров в секунду', '⚡ Frames per second'), sub: T('Рекомендуется 30; 60 — вдвое тяжелее', 'Recommended 30; 60 is twice as heavy'), step: 5 },
                        { k: 'visibility', type: 'choice', t: T('Где показывать', 'Where to show'), sub: VIS_SUB(), choices: VIS() },
                        { k: 'hide-in-fullscreen', type: 'switch', t: T('Прятать снег в полноэкранном режиме', 'Hide snow in fullscreen'), sub: T('Видео, игры, презентации', 'Videos, games, presentations') },
                        { k: 'toggle-key', type: 'key', t: T('Горячая клавиша вкл/выкл', 'On/off hotkey'), sub: KEY_SUB() },
                    ],
                },
            ],
            actions: [['fill', T('Намести сугробы', 'Pile up snow now')], ['shake', T('Стряхнуть весь снег', 'Shake off all snow')], ['clear', T('Убрать снежки и снеговиков', 'Remove snowballs and snowmen')]],
        },
        {
            id: 'garland', icon: '💡', title: T('Гирлянда', 'Garland'),
            desc: T('Мигающая гирлянда вдоль верха экрана; потяните шнурок справа, чтобы включить или выключить свет.',
                'A blinking garland along the top of the screen; pull the cord on the right to switch the lights.'),
            groups: [
                {
                    title: T('Гирлянда', 'Garland'),
                    rows: [
                        { k: 'enabled', type: 'switch', t: T('Гирлянда включена', 'Garland enabled'), sub: T('То же делает горячая клавиша', 'The hotkey does the same') },
                        { k: 'lights-on', type: 'switch', t: T('Лампочки горят', 'Lights on'), sub: T('Переключается и шнурком справа на гирлянде', 'Also toggled by the pull cord on the right') },
                        { k: 'show-pull', type: 'switch', t: T('Шнурок-выключатель справа', 'Pull-cord switch on the right') },
                        { k: 'mode', type: 'choice', t: T('Режим мигания', 'Blink mode'), choices: [['twinkle', T('Мерцание', 'Twinkle')], ['chase', T('Бегущие огни', 'Chase')], ['alternate', T('Попеременно', 'Alternate')], ['steady', T('Ровный свет', 'Steady')]] },
                        { k: 'palette', type: 'choice', t: T('Цвета', 'Colors'), choices: [['multicolor', T('Разноцветные', 'Multicolor')], ['warm', T('Тёплые жёлтые', 'Warm yellow')], ['cold', T('Холодные голубые', 'Cold blue')]] },
                        { k: 'speed', type: 'num', t: T('Скорость мигания', 'Blink speed'), step: 0.1, digits: 1 },
                    ],
                },
                {
                    title: T('Форма', 'Shape'),
                    rows: [
                        { k: 'wire-color', type: 'color', t: T('Цвет провода', 'Wire color'), sub: T('Готовые цвета есть и в меню в трее', 'Preset colors are also in the tray menu') },
                        { k: 'bulb-count', type: 'num', t: T('Количество лампочек', 'Number of bulbs'), step: 1 },
                        { k: 'sag', type: 'num', t: T('Провисание в середине, px', 'Sag in the middle, px'), step: 5 },
                        { k: 'bulb-scale', type: 'num', t: T('Размер лампочек', 'Bulb size'), step: 0.1, digits: 1 },
                        { k: 'visibility', type: 'choice', t: T('Где показывать', 'Where to show'), sub: VIS_SUB(), choices: VIS() },
                        { k: 'hide-in-fullscreen', type: 'switch', t: T('Прятать в полноэкранном режиме', 'Hide in fullscreen'), sub: T('Видео, игры, презентации', 'Videos, games, presentations') },
                        { k: 'toggle-key', type: 'key', t: T('Горячая клавиша вкл/выкл', 'On/off hotkey'), sub: KEY_SUB() },
                    ],
                },
            ],
        },
        {
            id: 'sleigh', icon: '🛷', title: T('Дед Мороз', 'Ded Moroz'),
            desc: T('Раз в несколько часов проезжает на санях с оленями по низу экрана. Поставьте у него на пути снежный шар — сани перевернутся.',
                'Rides a reindeer sleigh along the bottom of the screen every few hours. Put a snowball in his way — the sleigh flips over.'),
            groups: [
                {
                    title: T('Дед Мороз на санях', 'Ded Moroz on a sleigh'),
                    rows: [
                        { k: 'enabled', type: 'switch', t: T('Проезжать автоматически', 'Ride automatically'), sub: T('Выключено — только по кнопке или горячей клавише', 'Off — only by the button or the hotkey') },
                        { k: 'interval-minutes', type: 'num', t: T('Как часто проезжает, минут', 'How often it rides, minutes'), sub: T('180 = раз в 3 часа', '180 = once every 3 hours'), step: 10 },
                        { k: 'speed', type: 'num', t: T('Скорость, px/с', 'Speed, px/s'), step: 10 },
                        { k: 'scale', type: 'num', t: T('Размер', 'Size'), sub: T('1.0 — примерно 420×130 px', '1.0 ≈ 420×130 px'), step: 0.1, digits: 1 },
                        { k: 'direction', type: 'choice', t: T('Направление', 'Direction'), choices: [['random', T('Случайно', 'Random')], ['ltr', T('Слева направо', 'Left to right')], ['rtl', T('Справа налево', 'Right to left')]] },
                        { k: 'visibility', type: 'choice', t: T('Где показывать', 'Where to show'), sub: VIS_SUB(), choices: VIS() },
                        { k: 'hide-in-fullscreen', type: 'switch', t: T('Не ездить поверх полноэкранных окон', 'Do not ride over fullscreen windows'), sub: T('Видео, игры, презентации', 'Videos, games, presentations') },
                        { k: 'run-key', type: 'key', t: T('Горячая клавиша «проехать сейчас»', 'Hotkey “ride now”'), sub: KEY_SUB() },
                    ],
                },
            ],
            actions: [['run', T('Проехать сейчас', 'Ride now')]],
        },
        {
            id: 'snowballs', icon: '⚪', title: T('Снежки', 'Snowballs'),
            desc: T('Горка снежков на рабочем столе. Схватите снежок мышью и бросьте — он разобьётся о край экрана.',
                'A pile of snowballs on the desktop. Grab one with the mouse and throw it — it splats on the screen edge.'),
            groups: [
                {
                    title: T('Снежки', 'Snowballs'),
                    rows: [
                        { k: 'enabled', type: 'switch', t: T('Снежки на рабочем столе', 'Snowballs on the desktop'), sub: T('То же делает горячая клавиша', 'The hotkey does the same') },
                        { k: 'visibility', type: 'choice', t: T('Где показывать', 'Where to show'), sub: VIS_SUB(), choices: VIS() },
                        { k: 'corner', type: 'choice', t: T('Где лежит горка', 'Where the pile lies'), choices: [['bottom-right', T('Справа внизу', 'Bottom right')], ['bottom-left', T('Слева внизу', 'Bottom left')]] },
                        { k: 'pile-size', type: 'num', t: T('Снежков в горке', 'Snowballs in the pile'), step: 1 },
                        { k: 'ball-size', type: 'num', t: T('Размер снежка, px', 'Snowball size, px'), step: 2 },
                        { k: 'throw-power', type: 'num', t: T('Сила броска', 'Throw power'), step: 0.1, digits: 1 },
                        { k: 'gravity', type: 'num', t: T('Гравитация, px/с²', 'Gravity, px/s²'), sub: T('0 — летят по прямой', '0 — fly in a straight line'), step: 50 },
                        { k: 'splat-lifetime', type: 'num', t: T('Сколько держится след, секунд', 'How long splats stay, seconds'), step: 5 },
                        { k: 'toggle-key', type: 'key', t: T('Горячая клавиша вкл/выкл', 'On/off hotkey'), sub: KEY_SUB() },
                    ],
                },
            ],
            actions: [['clear', T('Убрать следы со стен', 'Clear splats from the walls')]],
        },
        {
            id: 'fireworks', icon: '🎆', title: T('Фейерверк', 'Fireworks'),
            desc: T('В меню в трее выберите «Поставить ракету / батарею / фонтан» и щёлкните по экрану. Наведите курсор на фейерверк — он станет зажигалкой; зажмите кнопку мыши, пока не загорится фитиль. Правая кнопка по фейерверку — убрать.',
                'In the tray menu choose “Place a rocket / cake / fountain” and click on the screen. Point at a firework — the pointer turns into a lighter; hold the mouse button until the fuse catches. Right click a firework to remove it.'),
            groups: [
                {
                    title: T('Фейерверк', 'Fireworks'),
                    rows: [
                        { k: 'enabled', type: 'switch', t: T('Фейерверк включён', 'Fireworks enabled') },
                        { k: 'visibility', type: 'choice', t: T('Где показывать', 'Where to show'), sub: VIS_SUB(), choices: VIS() },
                        { k: 'burst-size', type: 'num', t: T('⚡ Искр в одном взрыве', '⚡ Sparks in one burst'), sub: T('Больше — пышнее, но тяжелее для системы. Рекомендуется 80–120', 'More is fuller but heavier. Recommended 80–120'), step: 10 },
                        { k: 'show-key', type: 'key', t: T('Горячая клавиша «Салют сейчас!»', 'Hotkey “Fireworks now!”'), sub: KEY_SUB() },
                    ],
                },
            ],
            actions: [['show', T('Салют сейчас!', 'Fireworks now!')], ['place:rocket', T('Поставить ракету', 'Place a rocket')],
                ['place:battery', T('Поставить батарею', 'Place a cake')], ['place:fountain', T('Поставить фонтан', 'Place a fountain')],
                ['clear', T('Убрать все фейерверки', 'Remove all fireworks')]],
        },
        {
            id: 'tree', icon: '🎄', title: T('Ёлка', 'Christmas tree'),
            desc: T('Возьмите игрушку из ящика рядом с ёлкой и отпустите над веткой — она там повиснет. Большую звезду ставьте на макушку. Чтобы снять игрушку, утащите её с ёлки. Наряд сохраняется.',
                'Take a toy from the box next to the tree and release it over a branch — it hangs there. The big star goes on top. Drag a toy off the tree to remove it. The decorations are saved.'),
            groups: [
                {
                    title: T('Ёлка', 'Christmas tree'),
                    rows: [
                        { k: 'enabled', type: 'switch', t: T('Ёлка на рабочем столе', 'Tree on the desktop') },
                        { k: 'show-box', type: 'switch', t: T('Ящик с игрушками', 'Toy box'), sub: T('Можно убрать, когда ёлка наряжена', 'Hide it once the tree is decorated') },
                        { k: 'position', type: 'choice', t: T('Где стоит', 'Position'), sub: T('Внизу главного монитора', 'At the bottom of the primary monitor'), choices: [['right', T('Справа', 'Right')], ['center', T('По центру', 'Center')], ['left', T('Слева', 'Left')]] },
                        { k: 'tree-size', type: 'num', t: T('Размер', 'Size'), sub: T('1.0 — высота около 430 px', '1.0 is about 430 px tall'), step: 0.05, digits: 2 },
                        { k: 'tree-snow', type: 'choice', t: T('Снег на ветках', 'Snow on the branches'), sub: T('«Копится в снегопад» — пока идёт снег; потом медленно тает', '“Piles up while it snows” — while the snow is falling; then slowly melts'), choices: [['snowfall', T('Копится в снегопад', 'Piles up while it snows')], ['always', T('Всегда', 'Always')], ['never', T('Нет', 'None')]] },
                        { k: 'visibility', type: 'choice', t: T('Где показывать', 'Where to show'), sub: T('«Под окнами» — ёлка на рабочем столе, окна её закрывают', '“Below windows” — the tree stands on the desktop, windows cover it'), choices: VIS() },
                    ],
                },
            ],
            actions: [['decorate', T('Нарядить автоматически', 'Decorate automatically')], ['undecorate', T('Снять все игрушки', 'Take all toys off')]],
        },
        {
            id: 'app', icon: '⚙', title: T('Общие', 'General'),
            desc: T('Все эффекты работают в одной программе; значок — ёлочка в трее (возле часов). Если значка не видно, он может прятаться под стрелкой «^».',
                'All effects run in one program; its icon is the little tree in the tray (next to the clock). If you cannot see it, it may be hidden under the “^” arrow.'),
            groups: [
                {
                    title: T('Общие', 'General'),
                    rows: [
                        { k: 'language', type: 'choice', t: T('Язык / Language', 'Language / Язык'), choices: [['auto', T('Как в системе', 'As in the system')], ['ru', 'Русский'], ['en', 'English']] },
                        ...(init.packaged ? [{ k: 'autostart', type: 'switch', t: T('Запускать вместе с Windows', 'Start with Windows') }] : []),
                    ],
                },
            ],
        },
    ];
}

let current = 'snow';
const inputs = new Map();   // полный ключ → функция обновления

function set(key, value) {
    values[key] = value;
    ipcRenderer.send('set', key, value);
}

function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class')
            e.className = v;
        else if (k.startsWith('on'))
            e.addEventListener(k.slice(2), v);
        else
            e.setAttribute(k, v);
    }
    for (const k of kids)
        if (k !== null && k !== undefined)
            e.append(k);
    return e;
}

function control(full, row) {
    const s = SCHEMA[full];
    const v = values[full];
    if (row.type === 'switch') {
        const box = el('input', { type: 'checkbox' });
        box.checked = !!v;
        box.addEventListener('change', () => set(full, box.checked));
        inputs.set(full, nv => {
            box.checked = !!nv;
        });
        return el('label', { class: 'switch' }, box, el('span'));
    }
    if (row.type === 'choice') {
        const sel = el('select');
        for (const [id, text] of row.choices)
            sel.append(el('option', { value: id }, text));
        sel.value = v;
        sel.addEventListener('change', () => set(full, sel.value));
        inputs.set(full, nv => {
            sel.value = nv;
        });
        return sel;
    }
    if (row.type === 'color') {
        const c = el('input', { type: 'color' });
        c.value = v;
        c.addEventListener('input', () => set(full, c.value));
        inputs.set(full, nv => {
            c.value = nv;
        });
        return c;
    }
    if (row.type === 'key') {
        const t = el('input', { type: 'text', spellcheck: 'false' });
        t.value = v || '';
        const st = el('span', { class: 'status' });
        const showStatus = () => {
            const h = hotkeys[full];
            st.className = `status ${h === 'ok' ? 'ok' : h === 'busy' ? 'busy' : ''}`;
            st.textContent = h === 'ok' ? '✓' : h === 'busy' ? T('занята', 'taken') : '';
            st.title = h === 'busy' ? T('Это сочетание уже занято другой программой или системой', 'This combination is taken by another program or by Windows') : '';
        };
        showStatus();
        const apply = () => {
            const text = t.value.trim();
            if (text && !/^((Ctrl|Control|Alt|Shift|Super|Win|Meta|CommandOrControl|CmdOrCtrl)\+)+([A-Za-z0-9]|F[0-9]{1,2}|Space|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Plus|[-=,.;'/\\`[\]])$/i.test(text)) {
                t.classList.add('error');
                return;
            }
            t.classList.remove('error');
            set(full, text.replace(/\bWin\b/gi, 'Super'));
        };
        t.addEventListener('change', apply);
        t.addEventListener('keydown', e => {
            if (e.key === 'Enter')
                apply();
        });
        inputs.set(full, nv => {
            if (document.activeElement !== t)
                t.value = nv || '';
            showStatus();
        });
        return el('span', { class: 'ctl' }, t, st);
    }
    // число: ползунок + поле
    const digits = row.digits || 0;
    const fmt = x => Number(x).toFixed(digits);
    const range = el('input', { type: 'range', min: s.min, max: s.max, step: row.step || 1 });
    const num = el('input', { type: 'number', min: s.min, max: s.max, step: row.step || 1 });
    range.value = v;
    num.value = fmt(v);
    let timer = null;
    const commit = x => {
        clearTimeout(timer);
        timer = setTimeout(() => set(full, Number(x)), 200);
    };
    range.addEventListener('input', () => {
        num.value = fmt(range.value);
        commit(range.value);
    });
    num.addEventListener('change', () => {
        const x = Math.max(s.min, Math.min(s.max, Number(num.value) || 0));
        num.value = fmt(x);
        range.value = x;
        commit(x);
    });
    inputs.set(full, nv => {
        if (document.activeElement !== num && document.activeElement !== range) {
            range.value = nv;
            num.value = fmt(nv);
        }
    });
    return el('span', { class: 'ctl' }, range, num);
}

function render() {
    inputs.clear();
    document.title = T('Новогодние эффекты — настройки', 'New Year Effects — settings');
    const secs = sections();
    const nav = document.getElementById('nav');
    nav.replaceChildren(el('h1', {}, T('Новогодние эффекты', 'New Year Effects')));
    for (const sec of secs) {
        nav.append(el('button', {
            class: sec.id === current ? 'active' : '',
            onclick: () => {
                current = sec.id;
                render();
            },
        }, el('span', { class: 'ico' }, sec.icon), sec.title));
    }
    const sec = secs.find(x => x.id === current) || secs[0];
    const main = document.getElementById('main');
    main.replaceChildren(el('h2', {}, `${sec.icon}  ${sec.title}`), el('p', { class: 'desc' }, sec.desc));
    if (sec.actions) {
        const g = el('div', { class: 'group' }, el('h3', {}, T('Действия', 'Actions')));
        const a = el('div', { class: 'actions' });
        for (const [name, text] of sec.actions) {
            const [act, arg] = name.split(':');
            a.append(el('button', { class: 'act', onclick: () => ipcRenderer.send('action', `${sec.id}.${act}`, arg) }, text));
        }
        g.append(a);
        main.append(g);
    }
    for (const grp of sec.groups) {
        const g = el('div', { class: 'group' }, el('h3', {}, grp.title), grp.desc ? el('p', { class: 'gdesc' }, grp.desc) : null);
        for (const row of grp.rows) {
            const full = `${sec.id}.${row.k}`;
            g.append(el('div', { class: 'row' },
                el('div', { class: 'label' }, el('div', { class: 'title' }, row.t), row.sub ? el('div', { class: 'sub' }, row.sub) : null),
                control(full, row)));
        }
        main.append(g);
    }
    if (sec.id === 'app') {
        const userData = ipcRenderer.sendSync('user-data');
        main.append(el('div', { class: 'group' }, el('h3', {}, T('Файлы', 'Files')),
            el('div', { class: 'row' }, el('div', { class: 'label' },
                el('div', { class: 'title' }, T('Папка с настройками', 'Settings folder')),
                el('div', { class: 'sub' }, el('code', {}, userData))),
            el('button', { class: 'act', onclick: () => shell.openPath(userData) }, T('Открыть', 'Open')))));
    }
}

ipcRenderer.on('settings', (e, key, value) => {
    values[key] = value;
    if (key === 'app.language') {
        I18n.setLanguage(value);
        render();
        return;
    }
    const upd = inputs.get(key);
    if (upd)
        upd(value);
});

ipcRenderer.on('hotkey-status', (e, status) => {
    hotkeys = status;
    for (const [k, upd] of inputs) {
        if (SCHEMA[k] && SCHEMA[k].type === 'k')
            upd(values[k]);
    }
});

render();
