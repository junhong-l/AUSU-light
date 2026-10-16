const element = id => document.getElementById(id);
const targets = ['keyboard', 'slash'];
let token = '';
let connected = { keyboard: false, slash: false };
let busy = false;
let hydrated = false;
const effectPickers = new Map();
const paletteKey = 'asus-light.palette.v1';
const colorNames = { '#ffffff': '白色', '#ff4040': '红色', '#ffb52e': '琥珀色', '#37d895': '绿色', '#32c6df': '青色', '#fa73ae': '粉色' };
let palette = loadPalette();
let selectedColor = palette[0];

function loadPalette() {
  try {
    const saved = JSON.parse(localStorage.getItem(paletteKey));
    if (Array.isArray(saved) && saved.length <= 24 && saved.every(color => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))) {
      const colors = [...new Set(saved.map(color => color.toLowerCase()))];
      return colors.length ? colors : [Object.keys(colorNames)[0]];
    }
  } catch {}
  return Object.keys(colorNames);
}

function renderPalette() {
  element('color-swatches').replaceChildren();
  for (const color of palette) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.dataset.color = color;
    swatch.title = color.toUpperCase();
    swatch.setAttribute('aria-label', colorNames[color] || color.toUpperCase());
    swatch.style.setProperty('--swatch', color);
    element('color-swatches').append(swatch);
  }
}

function savePalette(next) {
  if (next.length < 1) return;
  try {
    localStorage.setItem(paletteKey, JSON.stringify(next));
  } catch {
    message('浏览器无法保存常用颜色，请检查本地存储权限。', true);
    return;
  }
  const previousIndex = palette.indexOf(selectedColor);
  palette = next;
  if (!palette.includes(selectedColor)) selectedColor = palette[Math.min(Math.max(previousIndex, 0), palette.length - 1)];
  renderPalette();
  preview('keyboard');
}

const keyRows = [
  ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Del'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Back'],
  ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
  ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'],
  ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'],
  ['Ctrl', 'Fn', 'Win', 'Alt', ' ', 'Alt', 'Ctrl', '<', '^', '>']
];
for (const row of keyRows) {
  const container = document.createElement('div');
  container.className = 'key-row';
  for (const key of row) {
    const cap = document.createElement('span');
    cap.className = `keycap${key === ' ' ? ' space' : key.length > 3 ? ' wide' : ''}`;
    cap.textContent = key;
    container.append(cap);
  }
  element('keycaps').append(container);
}

function createEffectPicker(target, kind) {
  const select = element(`${target}-${kind}`);
  const pickerId = kind === 'mode' ? `${target}-effect` : `${target}-${kind}`;
  const modes = {
    static: ['sun', 'STATIC'], breathe: ['wind', 'BREATHE'], cycle: ['palette', 'CYCLE'], strobe: ['zap', 'STROBE'],
    bounce: ['move-vertical', 'BOUNCE'], slash: ['slash', 'SLASH'], loading: ['loader-circle', 'LOADING'],
    flow: ['waves', 'FLOW'], flux: ['activity', 'FLUX'], spectrum: ['chart-column', 'SPECTRUM']
  };
  const choices = kind === 'speed' ? { 0: ['turtle', 'SLOW'], 1: ['gauge', 'NORMAL'], 2: ['rabbit', 'FAST'] } : modes;
  const choice = value => choices[value] || ['sliders-horizontal', value.toUpperCase()];
  const icon = name => {
    const node = document.createElement('i');
    node.dataset.lucide = name;
    node.setAttribute('aria-hidden', 'true');
    return node;
  };
  const wrapper = document.createElement('div');
  wrapper.className = 'effect-picker';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = `${pickerId}-trigger`;
  trigger.className = 'effect-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${pickerId}-options`);
  const name = document.createElement('span');
  name.className = 'effect-name';
  const code = document.createElement('span');
  code.className = 'effect-code';
  const leading = document.createElement('span');
  leading.className = 'effect-leading';
  leading.append(icon(kind === 'speed' ? 'gauge' : 'sparkles'));
  const chevron = icon('chevron-down');
  chevron.className = 'effect-chevron';
  trigger.append(leading, name, code, chevron);
  const menu = document.createElement('div');
  menu.id = `${pickerId}-options`;
  menu.className = 'effect-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', kind === 'speed' ? '动画速度' : target === 'keyboard' ? '键盘灯效' : 'A 面灯效');
  menu.setAttribute('popover', 'auto');
  menu.hidden = true;
  const options = Array.from(select.options);
  const rows = options.map((option, index) => {
    const row = document.createElement('div');
    row.id = `${pickerId}-${option.value}`;
    row.className = 'effect-option';
    row.setAttribute('role', 'option');
    row.dataset.index = index;
    const label = document.createElement('span');
    label.className = 'effect-option-name';
    label.textContent = option.textContent.split(' · ')[0];
    const detail = document.createElement('span');
    detail.className = 'effect-option-code';
    detail.textContent = choice(option.value)[1];
    const check = icon('check');
    check.className = 'effect-check';
    row.append(icon(choice(option.value)[0]), label, detail, check);
    menu.append(row);
    return row;
  });
  const label = select.labels[0];
  label.htmlFor = trigger.id;
  label.id = `${pickerId}-label`;
  trigger.setAttribute('aria-labelledby', `${label.id} ${pickerId}-name`);
  name.id = `${pickerId}-name`;
  wrapper.append(trigger, menu);
  select.after(wrapper);
  select.hidden = true;
  let opened = false;
  let active = select.selectedIndex;
  const sync = () => {
    name.textContent = options[select.selectedIndex].textContent.split(' · ')[0];
    code.textContent = choice(select.value)[1];
    trigger.disabled = select.disabled;
    wrapper.title = select.disabled && kind === 'speed' ? '常亮模式无需设置动画速度' : '';
    if (select.disabled) close();
    rows.forEach((row, index) => row.setAttribute('aria-selected', String(index === select.selectedIndex)));
  };
  const close = () => {
    if (typeof menu.hidePopover === 'function' && menu.matches(':popover-open')) menu.hidePopover();
    menu.hidden = true;
    opened = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
  };
  const highlight = (index, scroll = true) => {
    active = (index + rows.length) % rows.length;
    rows.forEach((row, position) => row.classList.toggle('is-active', position === active));
    trigger.setAttribute('aria-activedescendant', rows[active].id);
    if (scroll) rows[active].scrollIntoView({ block: 'nearest' });
  };
  const open = () => {
    if (busy || select.disabled) return;
    const bounds = trigger.getBoundingClientRect();
    const below = innerHeight - bounds.bottom - 12;
    const above = bounds.top - 12;
    const height = Math.min(rows.length * 44 + 12, 326, Math.max(below, above));
    menu.style.width = `${Math.min(bounds.width, innerWidth - 16)}px`;
    menu.style.maxHeight = `${height}px`;
    menu.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${below >= height ? bounds.bottom + 6 : Math.max(8, bounds.top - height - 6)}px`;
    menu.hidden = false;
    if (typeof menu.showPopover === 'function') menu.showPopover();
    opened = true;
    trigger.setAttribute('aria-expanded', 'true');
    highlight(select.selectedIndex);
  };
  const choose = index => {
    if (busy || select.disabled) return;
    select.value = options[index].value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
    close();
    trigger.focus({ preventScroll: true });
  };
  trigger.addEventListener('click', () => opened ? close() : open());
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Escape') return close();
      if (!opened) return open();
      if (event.key === 'Enter' || event.key === ' ') return choose(active);
      if (event.key === 'Home') highlight(0);
      else if (event.key === 'End') highlight(rows.length - 1);
      else highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Tab') close();
  });
  menu.addEventListener('pointerdown', event => event.preventDefault());
  menu.addEventListener('click', event => {
    const row = event.target.closest('.effect-option');
    if (row) choose(Number(row.dataset.index));
  });
  menu.addEventListener('pointermove', event => {
    const row = event.target.closest('.effect-option');
    if (row) highlight(Number(row.dataset.index), false);
  });
  menu.addEventListener('toggle', event => { if (event.newState === 'closed') close(); });
  document.addEventListener('pointerdown', event => { if (opened && !wrapper.contains(event.target)) close(); });
  document.addEventListener('scroll', event => { if (opened && !menu.contains(event.target)) close(); }, true);
  globalThis.addEventListener('resize', close);
  select.addEventListener('change', sync);
  effectPickers.set(select.id, { sync });
  sync();
}

function settingsFor(target) {
  const value = { enabled: element(`${target}-enabled`).checked, brightness: Number(element(`${target}-brightness`).value), mode: element(`${target}-mode`).value };
  if (target === 'keyboard') Object.assign(value, { color: element('keyboard-color').value, speed: Number(element('keyboard-speed').value) });
  else value.interval = Number(element('slash-interval').value);
  return value;
}

function preview(target) {
  const settings = settingsFor(target);
  element(`${target}-preview`).classList.toggle('off', !settings.enabled);
  element(`${target}-brightness-value`).value = `${settings.brightness} / 3`;
  const name = element(`${target}-mode`).selectedOptions[0].textContent.split(' · ')[0];
  element(`${target}-preview-name`).textContent = settings.enabled ? `${name} · ${target === 'keyboard' ? '单区' : '白光'}` : '已选择关闭';
  effectPickers.get(`${target}-mode`)?.sync();
  if (target === 'keyboard') {
    document.documentElement.style.setProperty('--light-color', settings.color);
    element('color-hex').value = settings.color.toUpperCase();
    element('keyboard-preview').dataset.mode = settings.mode;
    element('keyboard-preview').style.setProperty('--effect-duration', `${[5, 3, 1.5][settings.speed]}s`);
    element('keyboard-speed').disabled = settings.mode === 'static';
    effectPickers.get('keyboard-speed')?.sync();
    element('keyboard-color').disabled = settings.mode === 'cycle';
    for (const swatch of document.querySelectorAll('.swatch')) {
      const selected = swatch.dataset.color === selectedColor;
      swatch.classList.toggle('selected', selected);
      swatch.setAttribute('aria-pressed', String(selected));
    }
    element('color-add').disabled = palette.length >= 24;
    element('color-remove').disabled = palette.length <= 1;
    element('color-remove').title = palette.length <= 1 ? '至少保留一个常用颜色' : `删除选中的颜色 ${selectedColor.toUpperCase()}`;
    element('color-add').title = palette.length >= 24 ? '最多保存 24 个常用颜色' : '添加常用颜色';
  }
}

function message(text, error = false) {
  element('message').textContent = text;
  element('message').classList.toggle('error', error);
  element('message').hidden = !text;
}

function updateButtons() {
  for (const target of targets) element(`${target}-apply`).disabled = busy || !token || !connected[target];
  element('refresh').disabled = busy;
}

function status(target, text, type = '') {
  element(`${target}-status`).textContent = text;
  element(`${target}-status`).className = `apply-status ${type}`;
}

function renderEvents(events) {
  const list = element('event-log');
  list.replaceChildren();
  element('log-count').textContent = `${events.length} 条`;
  if (!events.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-log';
    empty.textContent = '暂无操作记录';
    list.append(empty);
  }
  for (const event of events) {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = event.time;
    time.textContent = new Date(event.time).toLocaleTimeString('zh-CN', { hour12: false });
    const text = document.createElement('span');
    text.className = 'event-message';
    text.textContent = `${event.target === 'keyboard' ? '键盘' : 'A 面'} · ${event.status === 'success' ? '设置已发送' : event.message}`;
    item.classList.toggle('event-error', event.status === 'error');
    item.append(time, text);
    list.append(item);
  }
}

async function refresh({ initial = false } = {}) {
  element('refresh').classList.add('loading');
  try {
    const response = await fetch('/api/state', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`服务响应异常 (${response.status})`);
    const state = await response.json();
    token = state.token;
    connected = state.device;
    if (!hydrated || initial) {
      for (const target of targets) {
        for (const [key, value] of Object.entries(state.settings[target])) {
          const input = element(`${target}-${key}`);
          if (key === 'enabled') input.checked = value;
          else input.value = value;
        }
        preview(target);
        status(target, state.appliedAt[target] ? '本次会话已发送' : '未应用', state.appliedAt[target] ? 'success' : '');
      }
      hydrated = true;
    }
    const allConnected = connected.keyboard && connected.slash;
    element('connection-dot').className = `status-dot ${allConnected ? 'connected' : 'error'}`;
    element('connection-text').textContent = allConnected ? '设备已连接' : '灯光接口不可用';
    element('keyboard-device').textContent = connected.keyboard ? '已识别 · 0x5A / 0x5D' : '未识别';
    element('slash-device').textContent = connected.slash ? '已识别 · 0x5D / 128 bytes' : '未识别';
    element('last-update').textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    renderEvents(state.events);
    if (state.warning) message(`配置提示：${state.warning}`, true);
    else if (!allConnected) message('未找到适配的灯光接口。请检查设备，或刷新重试。', true);
    else if (initial) message('');
    return state;
  } catch (error) {
    connected = { keyboard: false, slash: false };
    token = '';
    element('connection-dot').className = 'status-dot error';
    element('connection-text').textContent = '本地服务未连接';
    message(`无法连接本地服务：${error.message}`, true);
  } finally {
    element('refresh').classList.remove('loading');
    updateButtons();
  }
}

for (const target of targets) {
  element(`${target}-form`).addEventListener('input', () => {
    preview(target);
    status(target, '未应用');
    updateButtons();
  });
  element(`${target}-form`).addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !connected[target]) return;
    const settings = settingsFor(target);
    busy = true;
    updateButtons();
    element(`${target}-form`).inert = true;
    status(target, '正在发送…');
    message('');
    try {
      const response = await fetch(`/api/apply/${target}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Control-Token': token },
        body: JSON.stringify(settings),
        signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
      status(target, settings.enabled ? '已发送 · 开启' : '已发送 · 关闭', 'success');
      if (result.warning) message(`灯光已应用，但配置保存失败：${result.warning}`, true);
      await refresh();
    } catch (error) {
      status(target, '发送未确认', 'error');
      message(`${target === 'keyboard' ? '键盘' : 'A 面'}操作未确认：${error.message}。部分命令可能已生效，请观察设备后重试。`, true);
    } finally {
      busy = false;
      for (const form of document.querySelectorAll('form')) form.inert = false;
      updateButtons();
    }
  });
}

element('color-swatches').addEventListener('click', event => {
  const swatch = event.target.closest('.swatch');
  if (!swatch || swatch.disabled) return;
  selectedColor = swatch.dataset.color;
  element('keyboard-color').value = swatch.dataset.color;
  preview('keyboard');
  status('keyboard', '未应用');
});
element('color-add').addEventListener('click', () => {
  if (palette.length >= 24) return;
  element('palette-color').value = element('keyboard-color').value;
  element('palette-hex').value = element('keyboard-color').value.toUpperCase();
  element('palette-dialog').showModal();
});
element('palette-color').addEventListener('input', () => {
  element('palette-hex').value = element('palette-color').value.toUpperCase();
});
element('palette-hex').addEventListener('input', () => {
  if (/^#[\da-f]{6}$/i.test(element('palette-hex').value)) element('palette-color').value = element('palette-hex').value;
});
element('palette-cancel').addEventListener('click', () => { element('palette-dialog').close(); });
element('palette-dialog').addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  element('palette-dialog').close();
});
element('palette-form').addEventListener('submit', event => {
  event.preventDefault();
  const color = element('palette-hex').value.toLowerCase();
  if (!/^#[\da-f]{6}$/.test(color) || (!palette.includes(color) && palette.length >= 24)) return;
  const previousSelection = selectedColor;
  selectedColor = color;
  if (!palette.includes(color)) savePalette([...palette, color]);
  if (!palette.includes(color)) {
    selectedColor = previousSelection;
    return;
  }
  element('keyboard-color').value = color;
  preview('keyboard');
  status('keyboard', '未应用');
  element('palette-dialog').close();
});
element('color-remove').addEventListener('click', () => {
  if (palette.length <= 1) return;
  savePalette(palette.filter(saved => saved !== selectedColor));
});

element('refresh').addEventListener('click', () => { message(''); refresh(); });
for (const tab of ['control', 'diagnostic']) {
  element(`${tab}-tab`).addEventListener('click', () => {
    for (const name of ['control', 'diagnostic']) {
      const selected = name === tab;
      element(`${name}-tab`).classList.toggle('active', selected);
      element(`${name}-tab`).setAttribute('aria-pressed', String(selected));
      element(`${name}-view`).hidden = !selected;
    }
    if (tab === 'diagnostic' && !busy) refresh();
  });
}

for (const select of document.querySelectorAll('select')) {
  const [target, kind] = select.id.split('-');
  createEffectPicker(target, kind);
}
renderPalette();
preview('keyboard');
globalThis.lucide?.createIcons();
updateButtons();
await refresh({ initial: true });