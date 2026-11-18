/* Все настройки: ключ «модуль.ключ» → тип, значение по умолчанию, пределы.
 * Ключи и значения по умолчанию — как в схемах GSettings версии для GNOME.
 * Горячие клавиши — в формате Electron (Win+Alt+… в Windows 11 заняты
 * системой: Win+Alt+D — календарь, Win+Alt+B — HDR, Win+Alt+G — Game Bar). */
'use strict';

const VIS = ['above', 'desktop', 'below'];

const SCHEMA = {
    // общие
    'app.language': { type: 's', def: 'auto', choices: ['auto', 'ru', 'en'] },
    'app.autostart': { type: 'b', def: true },

    // ❄ снег
    'snow.enabled': { type: 'b', def: true },
    'snow.flake-count': { type: 'i', def: 120, min: 10, max: 400 },
    'snow.max-settled': { type: 'i', def: 6000, min: 0, max: 20000 },
    'snow.fps': { type: 'i', def: 30, min: 10, max: 60 },
    'snow.settle-on-windows': { type: 'b', def: true },
    'snow.settle-on-ground': { type: 'b', def: true },
    'snow.melt-time': { type: 'i', def: 180, min: 10, max: 3600 },
    'snow.wind': { type: 'd', def: 8, min: -100, max: 100 },
    'snow.shake-sensitivity': { type: 'i', def: 5, min: 1, max: 10 },
    'snow.drift-height': { type: 'i', def: 36, min: 8, max: 80 },
    'snow.drift-accumulation': { type: 'i', def: 5, min: 1, max: 10 },
    'snow.snowballs': { type: 'b', def: true },
    'snow.visibility': { type: 's', def: 'above', choices: VIS },
    'snow.hide-in-fullscreen': { type: 'b', def: true },
    'snow.toggle-key': { type: 'k', def: 'Ctrl+Alt+X' },

    // 💡 гирлянда
    'garland.enabled': { type: 'b', def: true },
    'garland.visibility': { type: 's', def: 'above', choices: VIS },
    'garland.wire-color': { type: 'c', def: '#14381a' },
    'garland.lights-on': { type: 'b', def: true },
    'garland.show-pull': { type: 'b', def: true },
    'garland.bulb-count': { type: 'i', def: 36, min: 5, max: 150 },
    'garland.sag': { type: 'i', def: 100, min: 10, max: 400 },
    'garland.bulb-scale': { type: 'd', def: 1.0, min: 0.5, max: 2.5 },
    'garland.mode': { type: 's', def: 'twinkle', choices: ['twinkle', 'chase', 'alternate', 'steady'] },
    'garland.palette': { type: 's', def: 'multicolor', choices: ['multicolor', 'warm', 'cold'] },
    'garland.speed': { type: 'd', def: 1.0, min: 0.2, max: 4.0 },
    'garland.hide-in-fullscreen': { type: 'b', def: true },
    'garland.toggle-key': { type: 'k', def: 'Ctrl+Alt+G' },

    // 🛷 Дед Мороз
    'sleigh.enabled': { type: 'b', def: true },
    'sleigh.visibility': { type: 's', def: 'above', choices: VIS },
    'sleigh.interval-minutes': { type: 'i', def: 180, min: 1, max: 1440 },
    'sleigh.speed': { type: 'i', def: 220, min: 60, max: 800 },
    'sleigh.scale': { type: 'd', def: 1.0, min: 0.5, max: 2.5 },
    'sleigh.direction': { type: 's', def: 'random', choices: ['random', 'ltr', 'rtl'] },
    'sleigh.hide-in-fullscreen': { type: 'b', def: true },
    'sleigh.last-run': { type: 'i', def: 0, min: 0, max: Number.MAX_SAFE_INTEGER, internal: true },
    'sleigh.run-key': { type: 'k', def: 'Ctrl+Alt+D' },

    // ⚪ снежки
    'snowballs.enabled': { type: 'b', def: true },
    'snowballs.visibility': { type: 's', def: 'desktop', choices: VIS },
    'snowballs.pile-size': { type: 'i', def: 6, min: 1, max: 15 },
    'snowballs.ball-size': { type: 'i', def: 30, min: 16, max: 80 },
    'snowballs.gravity': { type: 'i', def: 900, min: 0, max: 3000 },
    'snowballs.throw-power': { type: 'd', def: 1.0, min: 0.3, max: 3.0 },
    'snowballs.splat-lifetime': { type: 'i', def: 40, min: 3, max: 600 },
    'snowballs.corner': { type: 's', def: 'bottom-right', choices: ['bottom-right', 'bottom-left'] },
    'snowballs.toggle-key': { type: 'k', def: 'Ctrl+Alt+B' },

    // 🎆 фейерверк
    'fireworks.enabled': { type: 'b', def: true },
    'fireworks.visibility': { type: 's', def: 'above', choices: VIS },
    'fireworks.burst-size': { type: 'i', def: 100, min: 30, max: 250 },
    'fireworks.placed': { type: 'j', def: '[]', internal: true },
    'fireworks.show-key': { type: 'k', def: 'Ctrl+Alt+F' },

    // 🎄 ёлка
    'tree.enabled': { type: 'b', def: true },
    'tree.visibility': { type: 's', def: 'below', choices: VIS },
    'tree.position': { type: 's', def: 'left', choices: ['left', 'center', 'right'] },
    'tree.show-box': { type: 'b', def: true },
    'tree.tree-size': { type: 'd', def: 1.0, min: 0.5, max: 1.6 },
    'tree.tree-snow': { type: 's', def: 'snowfall', choices: ['snowfall', 'always', 'never'] },
    'tree.snow-amount': { type: 'd', def: 0.0, min: 0, max: 1, internal: true },
    'tree.decor': { type: 'j', def: '[]', internal: true },
};

// приводит значение к типу ключа; undefined — значение негодное
function coerce(key, value) {
    const s = SCHEMA[key];
    if (!s)
        return undefined;
    switch (s.type) {
    case 'b':
        return typeof value === 'boolean' ? value : undefined;
    case 'i':
    case 'd': {
        let v = Number(value);
        if (!isFinite(v))
            return undefined;
        if (s.type === 'i')
            v = Math.round(v);
        if (s.min !== undefined)
            v = Math.max(s.min, v);
        if (s.max !== undefined)
            v = Math.min(s.max, v);
        return v;
    }
    case 's':
        return s.choices && !s.choices.includes(value) ? undefined : String(value);
    case 'c':
        return /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value).toLowerCase() : undefined;
    case 'k':
    case 'j':
        return typeof value === 'string' ? value : undefined;
    }
    return undefined;
}

function defaults() {
    const out = {};
    for (const [k, s] of Object.entries(SCHEMA))
        out[k] = s.def;
    return out;
}

module.exports = { SCHEMA, coerce, defaults };
