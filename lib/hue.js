import Color from 'color';
import { v3 as hue } from 'node-hue-api';
import inquirer from 'inquirer';
import Util from './util.js';

const { LightState } = hue.lightStates;
const APP_DESCRIPTION = 'dmx-hue utility';

export default class Hue {
  async getLights() {
    try {
      const api = await this.api();
      return api.lights.getAll();
    } catch {
      Util.exit('Keine lichter gefunden');
    }
  }

  createLightState(r, g, b, temperature, brightness, options) {
    const state = new LightState().transition(options.transition);
    const mapRange = (value, low1, high1, low2, high2) =>
      low2 + ((high2 - low2) * (value - low1)) / (high1 - low1);

    const mappedTemperature = options.white
      ? mapRange(temperature, 0, 255, 153, 500)
      : 0;
    const mappedBrightness = options.white
      ? mapRange(brightness, 0, 255, 0, 100)
      : 0;

    if (
      r === g &&
      g === b &&
      b === 0 &&
      (!options.white || mappedBrightness === 0)
    ) {
      state.off();
    } else if (r === g && g === b && b === 0 && options.white) {
      state.on().white(mappedTemperature, mappedBrightness);
    } else if (options.colorloop && r === g && g === b && b === 1) {
      state.on().effect('colorloop').sat(254).bri(254);
    } else {
      const hsv = Color.rgb(r, g, b).hsv().array();
      state.on().effect('none').hsb(hsv[0], hsv[1], hsv[2]);
    }

    return state;
  }

  async setLight(id, state) {
    const api = await this.api();
    return api.lights.setLightState(id, state);
  }

  async listBridges(print) {
    try {
      let bridges = await hue.discovery.nupnpSearch();
      if (bridges.length === 0) {
        console.log('Keine Hue bridges gefunden, versuche langsamere suche');
        bridges = await hue.discovery.upnpSearch();
      }

      console.log(`Found ${bridges.length} bridge(s)`);

      if (print) {
        for (const b of bridges) {
          console.log(`- ${b.ipaddress} (${b.name})`);
        }
      }

      return bridges;
    } catch {
      Util.exit('Keine brücke gefunden');
    }
  }

  async setupBridge(ip = null, force = false) {
    const bridge = Util.config.get('bridge');
    if (bridge && Util.config.get('user') && !force) {
      console.log(`Brücke konfiguriert ${bridge}`);
      return;
    }

    try {
      const bridges = await this.listBridges();
      let bridge = ip ? bridges.find((b) => b.ipaddress === ip) : bridges[0];
      if (bridges.length > 1 && !ip) {
        bridge = await inquirer.prompt([
          {
            type: 'list',
            name: 'bridge',
            message: 'Mehrere brücken gefunden, wähle eine aus',
            choices: bridges.map((b) => ({
              name: `${b.name} (${b.ipaddress})`,
              value: b
            }))
          }
        ]);
      }

      if (!bridge) {
        throw new Error('Keine brücken gefunden');
      }

      Util.config.set('bridge', bridge.ipaddress);
      console.log(`Brücke gefunden auf ${bridge.ipaddress}`);
    } catch {
      if (ip) {
        Util.config.set('bridge', ip);
        console.log(`forced bridge auf ${ip}`);
      } else {
        Util.exit('keine brücken gefunden');
      }
    }

    try {
      const user = await hue.api
        .createLocal(this.bridge)
        .connect()
        .then((api) => api.users.createUser(APP_DESCRIPTION))
        .then((user) => user.username);
      Util.config.set('user', user);
      console.log('brücke erfolgreich verbunden');
    } catch {
      Util.exit('konnte nicht verbinden, bitte button auf der brücke noch einmal drücken');
    }
  }

  async api() {
    if (!this._api) {
      this._api = await hue.api.createLocal(this.bridge).connect(this.user);
    }

    return this._api;
  }

  get bridge() {
    return (
      Util.config.get('bridge') ||
      Util.exit('brücke nicht konfiguriert bitte "dmx-hue setup" ausführen :)')
    );
  }

  get user() {
    return (
      Util.config.get('user') ||
      Util.exit('brücke nicht verbunden bitte "dmx-hue setup" ausführen :)')
    );
  }
}