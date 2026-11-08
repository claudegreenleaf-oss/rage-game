// Minimal typings for the zzfx package (it ships plain JS).
declare module 'zzfx' {
  export function zzfx(...parameters: number[]): AudioBufferSourceNode;
  export const ZZFX: {
    volume: number;
    sampleRate: number;
    audioContext: AudioContext;
    play(...parameters: number[]): AudioBufferSourceNode;
    playSamples(channels: number[][], volumeScale?: number, rate?: number, pan?: number, loop?: boolean): AudioBufferSourceNode;
    buildSamples(...parameters: number[]): number[];
  };
}
