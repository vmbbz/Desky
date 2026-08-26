import { OpenClawRuntime } from './openclaw-runtime';
import type { CreateProfileRuntimes } from './profile-runtime-contract';

/** Store-free module graph: remote OpenClaw only; no local process adapters. */
export const createProfileRuntimes: CreateProfileRuntimes = (input) => [
  new OpenClawRuntime(input.openClaw),
];
