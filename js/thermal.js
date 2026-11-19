// Connexion directe à une imprimante thermique depuis le navigateur.
//
//   - Bluetooth (Web Bluetooth) : imprimantes BLE de ticket, Chrome / Edge sur
//     Android, ordinateur et Chromebook. Pas disponible sur iPhone (Safari).
//   - USB (WebUSB) : Chrome / Edge sur ordinateur et Android (câble OTG).
//     Sous Windows, le pilote du système peut bloquer l'accès direct.
//
// À défaut, le document s'imprime par le navigateur (pilote de l'imprimante)
// ou s'exporte en fichier ESC/POS / texte brut.

import { load, save } from './util.js';

const PREFS_KEY = 'ayashii.thermal';

// Services GATT des imprimantes BLE les plus courantes.
const BT_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
];

export const support = {
  bluetooth: typeof navigator !== 'undefined' && !!navigator.bluetooth,
  usb: typeof navigator !== 'undefined' && !!navigator.usb,
};

export function prefs() {
  return { charset: 'cp858', ...load(PREFS_KEY, {}) };
}

export function savePrefs(patch) {
  save(PREFS_KEY, { ...prefs(), ...patch });
}

// Imprimante connectée pendant la session (le navigateur redemande
// l'autorisation après un rechargement de la page).
let printer = null;

export function connectedPrinter() {
  return printer ? { kind: printer.kind, name: printer.name } : null;
}

export function forgetPrinter() {
  printer?.close?.();
  printer = null;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function bluetoothCharacteristic(device) {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  for (const service of await server.getPrimaryServices()) {
    for (const ch of await service.getCharacteristics()) {
      if (ch.properties.writeWithoutResponse || ch.properties.write) return ch;
    }
  }
  throw new Error('Aucune sortie d’impression trouvée sur cet appareil Bluetooth.');
}

// Doit être appelée directement depuis un clic (exigence du navigateur).
export async function connectBluetooth() {
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
  let ch = await bluetoothCharacteristic(device);
  printer = {
    kind: 'bluetooth',
    name: device.name || 'Imprimante Bluetooth',
    async write(bytes) {
      if (!device.gatt.connected) ch = await bluetoothCharacteristic(device);
      // Petits paquets espacés : la mémoire tampon de ces imprimantes est réduite.
      for (let i = 0; i < bytes.length; i += 180) {
        const chunk = bytes.slice(i, i + 180);
        if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(chunk);
        else await ch.writeValue(chunk);
        await wait(25);
      }
    },
    close: () => device.gatt.connected && device.gatt.disconnect(),
  };
  savePrefs({ kind: 'bluetooth' });
  return connectedPrinter();
}

export async function connectUsb() {
  // Classe 7 = imprimante ; 0xff = classe « constructeur » de nombreux modèles POS.
  const device = await navigator.usb.requestDevice({ filters: [{ classCode: 7 }, { classCode: 0xff }] });
  await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  let target = null;
  for (const iface of device.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const ep = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
      if (ep && (!target || alt.interfaceClass === 7)) target = { iface: iface.interfaceNumber, ep: ep.endpointNumber };
    }
  }
  if (!target) {
    await device.close();
    throw new Error('Cet appareil USB n’a pas de sortie d’impression.');
  }
  await device.claimInterface(target.iface);
  printer = {
    kind: 'usb',
    name: device.productName || 'Imprimante USB',
    async write(bytes) {
      for (let i = 0; i < bytes.length; i += 4096) await device.transferOut(target.ep, bytes.slice(i, i + 4096));
    },
    close: () => device.close().catch(() => {}),
  };
  savePrefs({ kind: 'usb' });
  return connectedPrinter();
}

export async function sendToPrinter(bytes) {
  if (!printer) throw new Error('Aucune imprimante thermique connectée.');
  await printer.write(bytes);
}

export function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
