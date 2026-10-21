export const KEYBOARD_MODES = Object.freeze({ static: 0, breathe: 1, cycle: 2, strobe: 10 });
export const SLASH_MODES = Object.freeze({ static: 0x06, bounce: 0x10, slash: 0x12, loading: 0x13, flow: 0x19, flux: 0x25, spectrum: 0x26 });

export const DEFAULTS = Object.freeze({
  keyboard: { enabled: true, brightness: 1, color: '#800000', mode: 'static', speed: 1, sleepOff: true },
  slash: { enabled: true, brightness: 1, mode: 'static', interval: 0 }
});

export function validateSettings(target, input) {
  if (!Object.hasOwn(DEFAULTS, target)) throw new Error('Unknown lighting target');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings');
  const keys = Object.keys(DEFAULTS[target]);
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('Unknown setting');
  if (typeof input.enabled !== 'boolean') throw new Error('Enabled must be boolean');
  if (!Number.isInteger(input.brightness) || input.brightness < 1 || input.brightness > 3) throw new Error('Brightness must be 1-3');
  const modes = target === 'keyboard' ? KEYBOARD_MODES : SLASH_MODES;
  if (!Object.hasOwn(modes, input.mode)) throw new Error('Unsupported lighting mode');
  if (target === 'keyboard') {
    if (typeof input.color !== 'string' || !/^#[\da-f]{6}$/i.test(input.color)) throw new Error('Invalid RGB color');
    if (!Number.isInteger(input.speed) || input.speed < 0 || input.speed > 2) throw new Error('Speed must be 0-2');
    if (input.sleepOff !== undefined && typeof input.sleepOff !== 'boolean') throw new Error('Sleep off must be boolean');
  } else if (!Number.isInteger(input.interval) || input.interval < 0 || input.interval > 255) {
    throw new Error('Interval must be 0-255');
  }
  return Object.fromEntries(keys.map(key => [key, input[key] === undefined ? DEFAULTS[target][key] : input[key]]));
}

export class LightingController {
  #hid;
  #queue = Promise.resolve();

  constructor(hid) { this.#hid = hid; }

  #serial(action) {
    const result = this.#queue.then(action);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #interfaces() {
    const devices = await this.#hid.devicesAsync(0x0b05, 0x19b6);
    return {
      keyboard: devices.find(device => device.vendorId === 0x0b05 && device.productId === 0x19b6 && device.usagePage === 0xff31 && device.usage === 0x76),
      aura: devices.find(device => device.vendorId === 0x0b05 && device.productId === 0x19b6 && device.usagePage === 0xff31 && device.usage === 0x79)
    };
  }

  inspect() {
    return this.#serial(async () => {
      const interfaces = await this.#interfaces();
      return { keyboard: Boolean(interfaces.keyboard && interfaces.aura), slash: Boolean(interfaces.aura), profile: 'GA403WP / 0B05:19B6' };
    });
  }

  apply(target, input) {
    const settings = validateSettings(target, input);
    return this.#serial(async () => {
      const interfaces = await this.#interfaces();
      if (!interfaces.aura || (target === 'keyboard' && !interfaces.keyboard)) throw new Error('Lighting interface not found. Check device connection.');
      if (target === 'keyboard') await this.#keyboard(interfaces, settings);
      else await this.#slash(interfaces.aura, settings);
      return settings;
    });
  }

  async #open(device, action) {
    const handle = await this.#hid.HIDAsync.open(device.path);
    try { return await action(handle); }
    finally { await handle.close(); }
  }

  async #send(handle, payload, length, feature = true) {
    if (payload.length > length) throw new Error('Report exceeds verified length');
    const report = Buffer.alloc(length);
    report.set(payload);
    const written = feature ? await handle.sendFeatureReport(report) : await handle.write(report);
    if (written !== length) throw new Error(`Incomplete HID report (${written}/${length}); stopped`);
  }

  async #keyboard(interfaces, settings) {
    await this.#open(interfaces.keyboard, async handle => {
      await this.#send(handle, [0x5a, ...Buffer.from('ASUS Tech.Inc.', 'ascii')], 63);
      await this.#send(handle, [0x5a, 0xba, 0xc5, 0xc4, settings.enabled ? settings.brightness : 0], 63);
    });
    const color = [1, 3, 5].map(offset => Number.parseInt(settings.color.slice(offset, offset + 2), 16));
    const speed = [0xe1, 0xeb, 0xf5][settings.speed];
    await this.#open(interfaces.aura, async handle => {
      if (settings.enabled) for (const payload of [
        [0x5d, 0xb9],
        [0x5d, ...Buffer.from('ASUS Tech.Inc.', 'ascii')],
        [0x5d, 0xb3, 0, KEYBOARD_MODES[settings.mode], ...color, speed, 0, settings.mode === 'breathe' ? 1 : 0, 0, 0, 0],
        [0x5d, 0xb5, 0, 0, 0],
        [0x5d, 0xb4]
      ]) await this.#send(handle, payload, 128, false);
      const power = settings.enabled ? (settings.sleepOff ? 0x08 : 0x28) : 0;
      await this.#send(handle, [0x5d, 0xbd, 1, power, 0, 0, 0, 0xff], 128, false);
    });
  }

  async #slash(device, settings) {
    await this.#open(device, async handle => {
      const send = command => this.#send(handle, [0x5d, ...command], 128);
      await send([...Buffer.from('ASUS Tech.Inc.', 'ascii')]);
      await send([0xc2]);
      await send([0xd1, 1, 0, 1]);
      if (!settings.enabled) {
        await send([0xd8, 2, 0, 1, 0x80]);
        return;
      }
      await send([0xd2, 3, 0, 0x0c]);
      const mode = Buffer.from(await handle.getFeatureReport(0x5d, 128));
      if (mode.length !== 128 || mode[0] !== 0x5d || mode[1] !== 0xd2 || mode[4] !== 0x0c || mode[5] !== 1) {
        throw new Error('Unrecognized Slash response; settings were not applied');
      }
      mode[1] = 0xd3;
      mode[2] = 4;
      mode[6] = SLASH_MODES[settings.mode];
      await send([0xd8, 2, 0, 1, 0]);
      await send([0xd7, 0, 0, 1, 0xac]);
      await send([0xd2, 2, 1, 8, 0xab]);
      await this.#send(handle, mode, 128);
      await send([0xd3, 3, 1, 8, 0xab, 0xff, 1, 1, 6, Math.floor(settings.brightness * 85.333), 0xff, settings.interval]);
      await send([0xd4, 0, 0, 1, 0xab]);
    });
  }
}