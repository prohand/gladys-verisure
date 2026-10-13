// -----------------------------------------------------------------------------
// A fake Verisure client with the interface of src/verisure/index.js, for the
// tests of the hub and of the wiring. Its state is plain data the test edits.
// -----------------------------------------------------------------------------

import { ArmingRefusedError, MfaRequiredError } from '../../src/verisure/errors.js';
import { MODES } from '../../src/verisure/modes.js';

export function createFakeClient(overrides = {}) {
  const state = {
    installations: [{ id: '12345', panel: 'SDVFAST', name: 'Maison', address: '' }],
    alarm: { mode: MODES.DISARMED, changedBy: 'Alice', changedAt: '2026-10-13T08:00:00Z' },
    doorWindows: [{ id: 'DW 1', name: 'Entrée', kind: 'DOOR', open: false }],
    climates: [{ id: 'CL1', name: 'Salon', temperature: 20.5, humidity: 48 }],
    smartPlugs: [{ id: 'SP1', name: 'Lampe', on: false }],
    locks: [{ id: 'LK1', name: 'Porte', locked: true, doorOpen: false }],
    modes: [MODES.DISARMED, MODES.ARMED_HOME, MODES.ARMED_AWAY],
    mfa: false,
    fail: null,
    refuseArming: false,
    ...overrides,
  };
  const calls = [];
  const client = {
    platform: 'fake',
    state,
    calls,
    async login() {
      calls.push(['login']);
      if (state.mfa) {
        throw new MfaRequiredError();
      }
    },
    async requestCode() {
      calls.push(['requestCode']);
      return { channel: 'sms', destination: '******789' };
    },
    async validateCode(code) {
      calls.push(['validateCode', code]);
      state.mfa = false;
    },
    async listInstallations() {
      calls.push(['listInstallations']);
      if (state.mfa) {
        throw new MfaRequiredError();
      }
      if (state.fail) {
        throw state.fail;
      }
      return state.installations;
    },
    supportedModes() {
      return state.modes;
    },
    async fetchState(installation) {
      calls.push(['fetchState', installation.id]);
      if (state.fail) {
        throw state.fail;
      }
      return structuredClone({
        alarm: { raw: null, changedVia: null, ...state.alarm },
        doorWindows: state.doorWindows,
        climates: state.climates,
        smartPlugs: state.smartPlugs,
        locks: state.locks,
      });
    },
    async checkAlarm() {
      calls.push(['checkAlarm']);
      return state.alarm.mode;
    },
    async setAlarmMode(installation, mode, { force = false } = {}) {
      calls.push(['setAlarmMode', installation.id, mode, force]);
      if (state.refuseArming && mode !== MODES.DISARMED && !force) {
        throw new ArmingRefusedError('Open: Entrée', { allowForcing: true, code: 'OPEN_ZONE' });
      }
      state.alarm = { ...state.alarm, mode };
      return { mode };
    },
    async setSmartPlug(installation, id, on) {
      calls.push(['setSmartPlug', id, on]);
      state.smartPlugs = state.smartPlugs.map((plug) => (plug.id === id ? { ...plug, on } : plug));
    },
    async setLock(installation, id, locked) {
      calls.push(['setLock', id, locked]);
    },
    async logout() {
      calls.push(['logout']);
    },
  };
  return client;
}

/** A memory store with the interface of src/store.js. */
export function memoryStore(initial = {}) {
  let data = initial;
  return {
    load: () => data,
    save: (next) => {
      data = next;
    },
    clear: () => {
      data = {};
    },
    get data() {
      return data;
    },
  };
}
