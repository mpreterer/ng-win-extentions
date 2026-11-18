/* Two-language UI: Russian or English.
 * Двуязычный интерфейс: русский или английский.
 * Настройка "language": auto (как в системе), ru, en. */
'use strict';

let systemLocale = 'en';
let ru = false;

function setSystemLocale(locale) {
    systemLocale = String(locale || 'en').toLowerCase();
}

function setLanguage(pref) {
    ru = pref === 'ru' || (pref !== 'en' && systemLocale.startsWith('ru'));
}

function isRu() {
    return ru;
}

/* T('русский текст', 'English text') */
function T(r, e) {
    return ru ? r : e;
}

module.exports = { setSystemLocale, setLanguage, isRu, T };
