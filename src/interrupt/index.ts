
export type { InterruptType, InterruptRequest, InterruptResult } from './types.js';
export {
  writeInterrupt,
  readInterrupt,
  clearInterrupt,
  hasInterrupt,
} from './handler.js';
