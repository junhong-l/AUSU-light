import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, LightingController, validateSettings } from '../src/lighting.js';

function mockHid({ badResponse = false, shortWrite = false, missing = false } = {}) {
  const calls = [];
  const devices = [
    { vendorId: 0x0b05, productId: 0x19b6, usagePage: 0xff31, usage: 0x76, path: 'keyboard' },
    { vendorId: 0x0b05, productId: 0x19b6, usagePage: 0xff31, usage: 0x79, path: 'aura' },
    { vendorId: 0x0b05, productId: 0x19b6, usagePage: 0xff82, usage: 0xcf, path: 'firmware' }
  ];
  const hid = {
    devicesAsync: async () => missing ? [] : devices,
    HIDAsync: {
      open: async path => {
        calls.push({ operation: 'open', path });
        const write = async (operation, report) => {
          calls.push({ operation, path, report: [...report] });
          return shortWrite ? 1 : report.length;
        };
        return {
          sendFeatureReport: report => write('feature', report),
          write: report => write('output', report),
          getFeatureReport: async () => {
            const report = Buffer.alloc(128);
            if (!badResponse) report.set([0x5d, 0xd2, 3, 0, 0x0c, 1, 0x10, 2, 0x12, 3, 0x13]);
            return report;
          },
          close: async () => { calls.push({ operation: 'close', path }); }
        };
      }
    }
  };
  return { calls, controller: new LightingController(hid) };
}

test('inspection never writes or opens hardware', async () => {
  const { calls, controller } = mockHid();
  assert.equal((await controller.inspect()).keyboard, true);
  assert.deepEqual(calls, []);
});

test('keyboard uses only verified interfaces and exact report lengths', async () => {
  const { calls, controller } = mockHid();
  await controller.apply('keyboard', DEFAULTS.keyboard);
  const reports = calls.filter(call => call.report);
  assert.equal(reports.length, 7);
  assert.ok(reports.every(call => call.report.length === (call.path === 'keyboard' ? 63 : 128)));
  assert.deepEqual(reports[1].report.slice(0, 5), [0x5a, 0xba, 0xc5, 0xc4, 1]);
  assert.deepEqual(reports[4].report.slice(0, 8), [0x5d, 0xb3, 0, 0, 128, 0, 0, 0xeb]);
  assert.ok(!calls.some(call => call.path === 'firmware'));
});

test('keyboard animation modes encode mode, speed and breathing flag', async () => {
  for (const [mode, code] of [['breathe', 1], ['cycle', 2], ['strobe', 10]]) {
    const { calls, controller } = mockHid();
    await controller.apply('keyboard', { ...DEFAULTS.keyboard, mode, speed: 2 });
    const report = calls.find(call => call.report?.[1] === 0xb3).report;
    assert.equal(report[3], code);
    assert.equal(report[7], 0xf5);
    assert.equal(report[9], mode === 'breathe' ? 1 : 0);
    assert.deepEqual(report.slice(10, 13), [0, 0, 0]);
  }
});

test('keyboard off does not send Aura or Slash commands', async () => {
  const { calls, controller } = mockHid();
  await controller.apply('keyboard', { ...DEFAULTS.keyboard, enabled: false });
  assert.ok(calls.every(call => call.path === 'keyboard'));
  assert.equal(calls.filter(call => call.report)[1].report[4], 0);
});

test('Slash preserves other mode slots and uses the tested static sequence', async () => {
  const { calls, controller } = mockHid();
  await controller.apply('slash', DEFAULTS.slash);
  const reports = calls.filter(call => call.report);
  assert.ok(reports.every(call => call.path === 'aura' && call.operation === 'feature' && call.report.length === 128));
  const mode = reports.find(call => call.report[1] === 0xd3 && call.report[2] === 4);
  assert.deepEqual(mode.report.slice(4, 11), [0x0c, 1, 6, 2, 0x12, 3, 0x13]);
  assert.equal(reports.at(-2).report[10], 0x55);
  assert.deepEqual(reports.at(-1).report.slice(0, 6), [0x5d, 0xd4, 0, 0, 1, 0xab]);
  assert.ok(!reports.some(call => call.report[1] === 0xd8 && call.report[2] !== 2));
});

test('bad Slash response stops before enable or configuration writes', async () => {
  const { calls, controller } = mockHid({ badResponse: true });
  await assert.rejects(controller.apply('slash', DEFAULTS.slash), /Unrecognized Slash/);
  assert.ok(!calls.some(call => call.report?.[1] === 0xd8 || call.report?.[1] === 0xd3));
  assert.equal(calls.at(-1).operation, 'close');
});

test('short writes close handles and stop subsequent commands', async () => {
  const { calls, controller } = mockHid({ shortWrite: true });
  await assert.rejects(controller.apply('keyboard', DEFAULTS.keyboard), /Incomplete HID/);
  assert.equal(calls.filter(call => call.report).length, 1);
  assert.equal(calls.at(-1).operation, 'close');
});

test('shared device commands are serialized', async () => {
  const { calls, controller } = mockHid();
  await Promise.all([controller.apply('keyboard', DEFAULTS.keyboard), controller.apply('slash', DEFAULTS.slash)]);
  const firstSlash = calls.findIndex(call => call.report?.[1] === 0xc2);
  const lastKeyboardApply = calls.findIndex(call => call.report?.[1] === 0xb4);
  assert.ok(firstSlash > lastKeyboardApply);
});

test('missing devices fail without writes', async () => {
  const { calls, controller } = mockHid({ missing: true });
  await assert.rejects(controller.apply('keyboard', DEFAULTS.keyboard), /not found/);
  assert.deepEqual(calls, []);
});

test('invalid and prototype-named modes are rejected', () => {
  for (const mode of ['constructor', '__proto__', 'unsupported']) assert.throws(() => validateSettings('keyboard', { ...DEFAULTS.keyboard, mode }));
  assert.throws(() => validateSettings('keyboard', { ...DEFAULTS.keyboard, brightness: 0 }));
  assert.throws(() => validateSettings('keyboard', { ...DEFAULTS.keyboard, color: '#oops' }));
  assert.throws(() => validateSettings('slash', { ...DEFAULTS.slash, interval: 256 }));
  assert.throws(() => validateSettings('slash', { ...DEFAULTS.slash, extra: 1 }));
});
