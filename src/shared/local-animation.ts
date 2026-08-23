export const localAnimationPreviewStatuses = [
  'empty',
  'loading',
  'playing',
  'completed',
  'blocked',
  'error',
] as const;

export type LocalAnimationPreviewStatus = (typeof localAnimationPreviewStatuses)[number];

export interface LocalAnimationMetadata {
  assetId: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
}

export interface LocalAnimationAsset extends LocalAnimationMetadata {
  bytes: ArrayBuffer;
}

export interface LocalAnimationPreviewState {
  requestId?: string;
  selection?: LocalAnimationMetadata;
  status: LocalAnimationPreviewStatus;
  message: string;
}

export interface LocalAnimationPlayCommand {
  kind: 'play';
  requestId: string;
  asset: LocalAnimationAsset;
}

export interface LocalAnimationClearCommand {
  kind: 'clear';
}

export type LocalAnimationPreviewCommand = LocalAnimationPlayCommand | LocalAnimationClearCommand;

export interface LocalAnimationPreviewReport {
  requestId: string;
  status: Extract<LocalAnimationPreviewStatus, 'playing' | 'completed' | 'blocked' | 'error'>;
  message: string;
}

export interface LocalAnimationSelectionResult {
  cancelled: boolean;
  state: LocalAnimationPreviewState;
}

export interface LocalAnimationBridge {
  getState(): Promise<LocalAnimationPreviewState>;
  select(): Promise<LocalAnimationSelectionResult>;
  play(): Promise<LocalAnimationPreviewState>;
  clear(): Promise<LocalAnimationPreviewState>;
  getCurrentCommand(): Promise<LocalAnimationPreviewCommand | undefined>;
  report(report: LocalAnimationPreviewReport): Promise<LocalAnimationPreviewState>;
  onState(listener: (state: LocalAnimationPreviewState) => void): () => void;
  onCommand(listener: (command: LocalAnimationPreviewCommand) => void): () => void;
}

export const initialLocalAnimationPreviewState: LocalAnimationPreviewState = Object.freeze({
  status: 'empty',
  message: 'Choose a local VRM Animation file to preview it.',
});
