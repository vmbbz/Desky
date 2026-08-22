import type { DeskyBridge } from '../preload';

declare global {
  interface Window {
    desky: DeskyBridge;
  }
}

export {};
