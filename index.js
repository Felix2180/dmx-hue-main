import fs from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import minimist from 'minimist';
import inquirer from 'inquirer';
import chalk from 'chalk';
import Util from './lib/util.js';
import Hue from './lib/hue.js';
import { listenArtNet } from './lib/artnet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const help = `${chalk.bold('Usage:')} dmx-hue [setup] [options]
${chalk.bold('Options:')}
  -h, --host       Host Adresse            [default: '0.0.0.0']
  -a, --address    Dmx Adresse (range 1-511)          [default: 1]
  -u, --universe   Artnet Universum                       [default: 0]
  -t, --transition transition zeit in ms         [default: 100]
                   Kann auch zu 'channel' gesetzt werden wo dann ein dmx step = 100ms sind
  -c, --colorloop  Colorloop feature 
                   Wenn aktiviert und alle dmx kanäle einer lampe zu 1 gesetzt werden wird colorloop aktiviert                 
  -w, --white      2 Extra kanäle für whitebalancing
  -n, --no-limit   Sicherheits raten limiter

${chalk.bold('Commands:')}
  setup            Configure hue bridge and DMX options
    -l, --list  force   Alle hue bridges listen
    -i, --ip       Bridge ip festlegen (nutzt erste bridge wenn nicht festgelegt)
    --force        bridge setup erzwingen wenn schon konfiguriert
`;

export class Converter {
    constructor(args) {
      this._args = minimist(args, {
        boolean: [
          'list',
          'force',
          'help',
          'version',
          'colorloop',
          'white',
          'no-limit'
        ],
        string: ['ip', 'host', 'transition'],
        number: ['address', 'universe'],
        alias: {
          l: 'list',
          i: 'ip',
          h: 'host',
          a: 'address',
          t: 'transition',
          c: 'colorloop',
          w: 'white',
          n: 'no-limit',
          u: 'universe'
        }
      });
      this._hue = new Hue();
      this._lastUpdate = 0;
      this._delayedUpdate = null;
    }
  
    start(options) {
      if (options.address <= 0 || options.address > 511) {
        Util.exit('Invalid DMX address');
      }
  
      options = { ...options };
      const dmxChannelsPerFixture = options.white ? 5 : 3;
  
      this._hue
        .getLights()
        .then((lights) => {
          const ordered = options.order.reduce((r, id) => {
            const light = lights.find(
              (light) => String(light.id) === id.toString()
            );
            if (light && !options.disabled[id]) {
              r.push(light);
            }
  
            return r;
          }, []);
          const remaining = lights.filter(
            (light) =>
              !options.disabled[light.id] &&
              !ordered.some((o) => light.id === o.id)
          );
          options.lights = [...ordered, ...remaining];
          options.transitionChannel = options.transition === 'channel';
          options.colors = {};
          const dmxChannelCount =
            dmxChannelsPerFixture * options.lights.length +
            (options.transitionChannel ? 1 : 0);
          const extraDmxAddress = options.address + dmxChannelCount - 512;
  
          if (extraDmxAddress >= 0) {
            console.warn(
              chalk.yellow(
                'Warnung: Zu wenige dmx kanäle'
              )
            );
            const lightsToRemove = Math.ceil(
              extraDmxAddress / dmxChannelsPerFixture
            );
            options.lights = options.lights.slice(0, -lightsToRemove);
          }
  
          return listenArtNet(options.host, (data) => {
            if (data.universe === options.universe) {
              this._updateLights(data.dmx, options);
            }
          });
        })
        .then(() => {
          let currentAddress = options.address;
          if (options.noLimit) {
            console.warn(
              chalk.yellow('Warnung, safety rate limiting ist aus!\n')
            );
          }
  
          console.log(
            chalk.bold(`DMX addressen auf universe ${options.universe}:`)
          );
          if (options.transitionChannel) {
            console.log(` ${chalk.cyan(currentAddress++)}: transition time`);
          }
  
          for (const light of options.lights) {
            console.log(
              ` ${chalk.cyan(`${currentAddress}:`)} ${light.name} ${chalk.grey(
                `(Hue ID: ${light.id})`
              )}`
            );
            currentAddress += dmxChannelsPerFixture;
          }
  
          console.log('\nArtNet node started (CTRL+C quit)');
        });
    }
  
    setup(ip, force) {
      this._hue.setupBridge(ip, force).then(() => this._setupOptions());
    }
  
    _hasColorChanged(previous, color, channels) {
      if (!previous) {
        return true;
      }
  
      for (let i = 0; i < channels; i++) {
        if (previous[i] !== color[i]) {
          return true;
        }
      }
  
      return false;
    }
  
    _updateLights(dmxData, options) {
      if (this._delayedUpdate) {
        clearTimeout(this._delayedUpdate);
        this._delayedUpdate = null;
      }
  
      let address = options.address - 1;
  
      if (options.transitionChannel) {
        options.transition = dmxData[address] * 100;
        address++;
      }
  
      const dmxChannelsPerFixture = options.white ? 5 : 3;
      const dmx = dmxData.slice(
        address,
        address + dmxChannelsPerFixture * options.lights.length
      );
      let j = 0;
      const { length } = options.lights;
      let indices = Array.from({ length }, (_, i) => i);
      indices = this._shuffle(indices);
  
      let i;
      for (i of indices) {
        const lightId = options.lights[i].id;
        j = i * dmxChannelsPerFixture;
        const color = dmx.slice(j, j + 5);
        const previous = options.colors[lightId];

        if (this._hasColorChanged(previous, color, dmxChannelsPerFixture)) {
          const now = Date.now();
          if (options.noLimit || now - this._lastUpdate >= 100) {
            const state = options.white
              ? this._hue.createLightState(
                  color[0],
                  color[1],
                  color[2],
                  color[3],
                  color[4],
                  options
                )
              : this._hue.createLightState(
                  color[0],
                  color[1],
                  color[2],
                  undefined,
                  undefined,
                  options
                );
            this._lastUpdate = now;
            this._hue.setLight(lightId, state);
            options.colors[lightId] = color;
          } else if (!this._delayedUpdate) {
            this._delayedUpdate = setTimeout(
              () => this._updateLights(dmxData, options),
              100
            );
          }
        }
      }
    }
  
    _setupOptions() {
      const disabled = Util.config.get('disabledLights') ?? {};
      const transition = Util.config.get('transition') ?? 0;
      this._hue.getLights().then((lights) => {
        return inquirer
          .prompt([
            {
              type: 'input',
              name: 'dmxAddress',
              message: 'DMX adresse setzen (range 1-511)',
              default: Util.config.get('dmxAddress') ?? 1,
              validate(input) {
                const value = Number.parseInt(input, 10);
                return value > 0 && value <= 511;
              }
            },
            {
              type: 'input',
              name: 'universe',
              message: 'Artnet universum setzten',
              default: Util.config.get('universe') ?? 0,
              validate: (input) => Number.parseInt(input, 10) >= 0
            },
            {
              type: 'confirm',
              name: 'colorloop',
              message:
                'Color Loop feature aktivieren (Wenn rgb kanäle zu 1 gesetzt sind)',
              default: Util.config.get('colorloop') ?? false
            },
            {
              type: 'confirm',
              name: 'white',
              message:
                'White control aktivieren (fügt 2 dmx kanäle pro fixture hinzu)',
              default: Util.config.get('white') ?? false
            },
            {
              type: 'confirm',
              name: 'transitionChannel',
              message: 'dmx kanal für übergangszeit nutzen',
              default: transition === 'channel'
            },
            {
              type: 'input',
              name: 'transition',
              message: 'Transition zeit in ms setzen',
              default: transition === 'channel' ? '100' : transition,
              when: (answers) => !answers.transitionChannel,
              validate: (input) => Number.parseInt(input, 10) > 0
            },
            {
              type: 'checkbox',
              name: 'lights',
              message: 'lichter auswählen',
              choices: lights.map((light) => ({
                name: light.name,
                value: light.id,
                checked: !disabled[light.id]
              }))
            }
          ])
          .then((answers) => {
            Util.config.set(
              'dmxAddress',
              Number.parseInt(answers.dmxAddress, 10)
            );
            Util.config.set('universe', Number.parseInt(answers.universe, 10));
            Util.config.set('colorloop', answers.colorloop);
            Util.config.set('white', answers.white);
            Util.config.set(
              'transition',
              answers.transitionChannel
                ? 'channel'
                : Number.parseInt(answers.transition, 10)
            );
            Util.config.set(
              'disabledLights',
              lights
                .filter((light) => !answers.lights.includes(light.id))
                .reduce((l, light) => {
                  l[light.id] = true;
                  return l;
                }, {})
            );
            console.log(
              `Configuration gespeichert in ${chalk.green(Util.config.path)}`
            );
          });
      });
    }
  
    _shuffle(array) {
      let currentIndex = array.length;
      let temporaryValue;
      let randomIndex;

      while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;
  
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
      }
  
      return array;
    }
  
    async run() {
      if (this._args.help) {
        Util.exit(help, 0);
      } else if (this._args.version) {
        const file = fs.readFileSync(path.join(__dirname, 'package.json'));
        const pkg = JSON.parse(file);
        Util.exit(pkg.version, 0);
      } else if (this._args._[0] === 'setup') {
        return this._args.list
          ? this._hue.listBridges(true)
          : this.setup(this._args.ip, this._args.force);
      }
  
      if (this._args.transition !== 'channel') {
        const value = Number.parseInt(this._args.transition, 10);
        this._args.transition = value >= 0 ? value : 0;
      }
  
      console.log(this._args.transition);
  
      return this.start({
        host: this._args.host,
        address: this._args.address ?? Util.config.get('dmxAddress') ?? 1,
        colorloop:
          (this._args.colorloop || Util.config.get('colorloop')) ?? false,
        white: (this._args.white || Util.config.get('white')) ?? false,
        transition:
          (this._args.transition || Util.config.get('transition')) ?? 100,
        noLimit: (this._args['no-limit'] || Util.config.get('noLimit')) ?? false,
        universe: this._args.universe ?? Util.config.get('universe') ?? 0,
        disabled: Util.config.get('disabledLights') ?? {},
        order: Util.config.get('lightsOrder') ?? []
      });
    }
  }