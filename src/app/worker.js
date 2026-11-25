// Analysis worker: receives File objects, returns fingerprints.
//
// Protocol
//   → { type: 'ping' }                         ← { type: 'pong', canDecode }
//   → { type: 'analyse', id, file, name }      ← { type: 'result', id, result }
//                                              ← { type: 'error', id, message }

import { analyseFile, canDecodeHere } from './analyse-file.js';
import { fingerprintTransferables } from '../engine/fingerprint.js';

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === 'ping') {
    self.postMessage({ type: 'pong', canDecode: canDecodeHere() });
    return;
  }
  if (message.type === 'analyse') {
    try {
      const result = await analyseFile(message.file, message.name);
      const transfer = result.fingerprint ? fingerprintTransferables(result.fingerprint) : [];
      self.postMessage({ type: 'result', id: message.id, result }, transfer);
    } catch (error) {
      self.postMessage({ type: 'error', id: message.id, message: String(error && error.message ? error.message : error) });
    }
  }
};
