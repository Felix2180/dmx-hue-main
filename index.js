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
            string : ['ip', 'host', 'transition'],
            number: ['adress', 'universe'],
            alias: {
                l: 'list',
                i: 'ip',
                h: 'host',
                a: 'adress',
                t: 'transition',
                c: 'colorloop',
                w: 'white',
                n: 'no-limit',
                u: 'universe'
            }
        })
    }
}