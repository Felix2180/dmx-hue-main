#!usr/bin/env node
import process from 'node:process';
import { Converter } from '../index.js';

const prg = new Converter(process.argv.slice(2));
prg.run();