import os from 'node:os';
import dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import Util from './util.js';

const NODE_NAME = 'HueDMX';
const PORT = 6454;
const HEADER = 'Art-Net\0';
const OPCODE_OUTPUT = 0x50_00;
const OPCODE_POLL = 0x20_00;
const OPCODE_POLLREPLY = 0x21_00;
const MIN_PROTOCOL_VERSION = 14;

export function getNetworkInterface() {
  const interfaces = os.networkInterfaces();
  return Object.keys(interfaces)
    .map((n) => interfaces[n])
    .map((n) => n.find((i) => !i.internal && i.family === 'IPv4'))
    .find(Boolean);
}

export function listenArtNet(address, dmxHandler) {
  const socket = dgram.createSocket(
    { type: 'udp4', reuseAddr: true },
    (message, peer) => {
      const header = message.toString('utf8', 0, 8);
      const opcode = message.readUInt16LE(8);
      const version = message.readUInt16BE(10);

      if (header !== HEADER || version < MIN_PROTOCOL_VERSION) {
        return;
      }

      if (opcode === OPCODE_OUTPUT) {
        const sequence = message.readUInt8(12);
        const physical = message.readUInt8(13);
        const universe = message.readUInt16LE(14);
        const length = message.readUInt16BE(16);
        const dmx = [];

        for (let i = 0; i < length; ++i) {
          dmx.push(message.readUInt8(18 + i));
        }

        dmxHandler({ sequence, physical, universe, length, dmx }, peer);
      } else if (opcode === OPCODE_POLL) {
        const buffer = Buffer.alloc(238);
        const itf = getNetworkInterface();
        const ip = itf.address.split('.').map((s) => Number.parseInt(s, 10));
        const mac = itf.mac.split(':').map((s) => Number.parseInt(s, 16));
        buffer.write(HEADER, 0, 8);
        buffer.writeUInt16LE(OPCODE_POLLREPLY, 8);
        for (let i = 0; i < 4; i++) {
          buffer[10 + i] = ip[i];
        }

        buffer.writeUInt16LE(PORT, 14);
        buffer[23] = 0xa0;
        buffer.write('tm', 24, 2);
        buffer.write(NODE_NAME, 26, 18);
        buffer.write(NODE_NAME, 44, 64);
        buffer[173] = 1; 
        buffer[174] = 0x0f;
        buffer[183] = 0x0f;
        buffer[190] = 0; 
        for (let i = 0; i < 6; i++) {
          buffer[201 + i] = mac[i];
        }

        buffer[212] = 0xc;

        const to = address
          ? address.split('.')[0] + '.255.255.255'
          : '255.255.255.255';
        socket.setBroadcast(true);
        socket.send(buffer, 0, buffer.length, PORT, to);
      }
    }
  );

  return new Promise((resolve) => {
    socket.on('error', (error) =>
      Util.exit('Error: ' + (error.message ?? error))
    );
    socket.bind(PORT, address, () => resolve(socket));
  });
}