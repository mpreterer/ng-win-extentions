/* Win32 через koffi: список окон (с Z-порядком), курсор и кнопки мыши,
 * место слоя «под окнами» (сразу над рабочим столом).
 * Работает и в главном процессе, и в рендерере (nodeIntegration).
 *
 * Все координаты окон — физические пиксели экрана (поток переводится в
 * режим Per-Monitor DPI Aware v2); в DIP их переводит вызывающий код. */
'use strict';

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const RECT = koffi.struct('NY_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const POINT = koffi.struct('NY_POINT', { x: 'int32', y: 'int32' });

const EnumWindowsProc = koffi.proto('bool __stdcall NY_EnumWindowsProc(void *hwnd, intptr lParam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(NY_EnumWindowsProc *cb, intptr lParam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(void *hwnd)');
const IsZoomed = user32.func('bool __stdcall IsZoomed(void *hwnd)');
const IsWindow = user32.func('bool __stdcall IsWindow(void *hwnd)');
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(void *hwnd, int index)');
const GetWindow = user32.func('void * __stdcall GetWindow(void *hwnd, uint cmd)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ NY_RECT *rect)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hwnd, void *buf, int max)');
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void *hwnd)');
const FindWindowExW = user32.func('void * __stdcall FindWindowExW(void *parent, void *after, str16 cls, str16 title)');
const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ NY_POINT *pt)');
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vkey)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(void *hwnd, void *after, int x, int y, int cx, int cy, uint flags)');
const DwmGetWindowAttribute = dwmapi.func('long __stdcall DwmGetWindowAttribute(void *hwnd, uint attr, void *value, uint size)');
let SetThreadDpiAwarenessContext = null;
try {
    SetThreadDpiAwarenessContext = user32.func('intptr __stdcall SetThreadDpiAwarenessContext(intptr ctx)');
} catch (e) {
    SetThreadDpiAwarenessContext = null;
}

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const GW_OWNER = 4;
const GW_HWNDPREV = 3;
const WS_CAPTION = 0x00C00000;
const WS_CHILD = 0x40000000;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const WS_EX_NOACTIVATE = 0x08000000;
const WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_TOPMOST = 0x00000008;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOOWNERZORDER = 0x0200;
const SWP_NOSENDCHANGING = 0x0400;

// окна оболочки, на которых снег не лежит и которые не считаются «окнами»
const SKIP_CLASSES = new Set([
    'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW',
    'Windows.UI.Core.CoreWindow', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland',
    'Xaml_WindowedPopupClass', 'tooltips_class32', '#32768', 'ForegroundStaging',
    'MultitaskingViewFrame', 'TaskSwitcherWnd', 'XamlExplorerHostIslandWindow',
]);

function dpiAware() {
    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
    if (SetThreadDpiAwarenessContext) {
        try {
            SetThreadDpiAwarenessContext(-4);
        } catch (e) { /* старые Windows */ }
    }
}
dpiAware();

// HWND в Koffi 3 — BigInt
function addr(h) {
    return h ? Number(h) : 0;
}

const nameBuf = new Uint16Array(128);
function className(h) {
    const n = GetClassNameW(h, nameBuf, 128);
    return n > 0 ? String.fromCharCode.apply(null, nameBuf.subarray(0, n)) : '';
}

const rectBuf = Buffer.alloc(16);
function frameRect(h) {
    // видимая рамка окна, без невидимых краёв для изменения размера
    if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, rectBuf, 16) === 0) {
        return {
            x: rectBuf.readInt32LE(0), y: rectBuf.readInt32LE(4),
            w: rectBuf.readInt32LE(8) - rectBuf.readInt32LE(0),
            h: rectBuf.readInt32LE(12) - rectBuf.readInt32LE(4),
        };
    }
    const r = {};
    GetWindowRect(h, r);
    return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
}

const cloakBuf = Buffer.alloc(4);
function cloaked(h) {
    // скрытые окна UWP и окна с других виртуальных рабочих столов
    if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, cloakBuf, 4) !== 0)
        return false;
    return cloakBuf.readUInt32LE(0) !== 0;
}

/* Окна приложений сверху вниз по Z-порядку.
 * ignore — Set адресов собственных окон (наши слои).
 * Результат: [{id, x, y, w, h, min, max, title, owned, topmost}] в физ. пикселях;
 * свёрнутые окна тоже в списке (min=true), чтобы снег с них осыпался. */
function listWindows(ignore) {
    const out = [];
    EnumWindows((h, lp) => {
        if (!IsWindowVisible(h))
            return true;
        const id = addr(h);
        if (ignore && ignore.has(id))
            return true;
        const ex = Number(GetWindowLongPtrW(h, GWL_EXSTYLE));
        const style = Number(GetWindowLongPtrW(h, GWL_STYLE));
        if (style & WS_CHILD)
            return true;
        if ((ex & WS_EX_TRANSPARENT) || ((ex & WS_EX_TOOLWINDOW) && !(ex & WS_EX_APPWINDOW)))
            return true;
        const owner = GetWindow(h, GW_OWNER);
        // окно без заголовка с владельцем — меню, подсказка и т. п.
        if (owner && !(style & WS_CAPTION))
            return true;
        if ((ex & WS_EX_NOACTIVATE) && !(ex & WS_EX_APPWINDOW))
            return true;
        const cls = className(h);
        if (SKIP_CLASSES.has(cls))
            return true;
        if (!owner && GetWindowTextLengthW(h) === 0 && !(style & WS_CAPTION))
            return true;
        const min = IsIconic(h);
        const r = frameRect(h);
        if (!min && (r.w < 40 || r.h < 20))
            return true;
        out.push({
            id, x: r.x, y: r.y, w: r.w, h: r.h,
            // cloaked — окно есть, но не показано (другой виртуальный стол, скрытое UWP)
            cloaked: cloaked(h),
            min, max: !min && IsZoomed(h),
            caption: !!(style & WS_CAPTION),
            topmost: !!(ex & WS_EX_TOPMOST),
            cls,
        });
        return true;
    }, 0);
    return out;
}

function cursor() {
    const p = {};
    GetCursorPos(p);
    return [p.x, p.y];
}

// нажата ли какая-то кнопка мыши (с учётом «левши»: кнопки меняются местами)
function mouseDown() {
    return (GetAsyncKeyState(0x01) & 0x8000) !== 0 || (GetAsyncKeyState(0x02) & 0x8000) !== 0 ||
        (GetAsyncKeyState(0x04) & 0x8000) !== 0;
}

// окно рабочего стола (то, в котором лежат значки)
function desktopWindow() {
    let found = null;
    EnumWindows((h, lp) => {
        if (FindWindowExW(h, null, 'SHELLDLL_DefView', null)) {
            found = h;
            return false;
        }
        return true;
    }, 0);
    return found || FindWindowExW(null, null, 'Progman', null);
}

function hwndFromBuffer(buf) {
    // getNativeWindowHandle() → Buffer с HWND
    return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

/* Ставит окно сразу над рабочим столом (под всеми окнами).
 * Возвращает true, если пришлось переставлять. */
function keepAboveDesktop(hwnd) {
    const desk = desktopWindow();
    if (!desk)
        return false;
    const prev = GetWindow(desk, GW_HWNDPREV);
    if (prev && addr(prev) === addr(hwnd))
        return false;
    let after = prev;
    // нельзя вставать под окно «поверх всех»: сами станем такими
    if (after && (Number(GetWindowLongPtrW(after, GWL_EXSTYLE)) & WS_EX_TOPMOST))
        return false;
    if (!after)
        return false;
    SetWindowPos(hwnd, after, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING);
    return true;
}

function foregroundId() {
    return addr(GetForegroundWindow());
}

function alive(id) {
    return IsWindow(BigInt(id));
}

module.exports = {
    listWindows, cursor, mouseDown, keepAboveDesktop, hwndFromBuffer, addr, foregroundId, alive,
    swapButtons: () => GetSystemMetrics(23) !== 0,
};
