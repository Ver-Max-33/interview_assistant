declare const registerProcessor: (name: string, processorCtor: any) => void;

interface AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (): AudioWorkletProcessor;
};

const CHUNK_SIZE = 1024;

type FlushMessage = { type: 'flush' };
type AudioCaptureMessage = FlushMessage;

interface AudioChunkPayload {
  audio: Float32Array;
  rms: number;
  peak: number;
}

class AudioCaptureProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array;
  private writeIndex: number;
  private sumSquares: number;
  private peak: number;

  constructor() {
    super();
    this.buffer = new Float32Array(CHUNK_SIZE);
    this.writeIndex = 0;
    this.sumSquares = 0;
    this.peak = 0;

    this.port.onmessage = (event: MessageEvent<AudioCaptureMessage>) => {
      if (event.data?.type === 'flush') {
        this.flush();
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channelData = inputs[0]?.[0];
    if (!channelData || channelData.length === 0) {
      return true;
    }

    let sourceIndex = 0;
    while (sourceIndex < channelData.length) {
      const remaining = CHUNK_SIZE - this.writeIndex;
      const copyCount = Math.min(remaining, channelData.length - sourceIndex);

      const slice = channelData.subarray(sourceIndex, sourceIndex + copyCount);
      this.buffer.set(slice, this.writeIndex);

      for (let i = 0; i < copyCount; i++) {
        const sample = slice[i];
        this.sumSquares += sample * sample;
        const magnitude = Math.abs(sample);
        if (magnitude > this.peak) {
          this.peak = magnitude;
        }
      }

      this.writeIndex += copyCount;
      sourceIndex += copyCount;

      if (this.writeIndex === CHUNK_SIZE) {
        this.dispatchChunk(this.buffer, CHUNK_SIZE);
        this.resetBuffer();
      }
    }

    return true;
  }

  private dispatchChunk(buffer: Float32Array, frames: number): void {
    const rms = frames > 0 ? Math.sqrt(this.sumSquares / frames) : 0;
    const payload: AudioChunkPayload = {
      audio: buffer,
      rms,
      peak: this.peak
    };

    this.port.postMessage(payload, [buffer.buffer]);
  }

  private flush(): void {
    if (this.writeIndex === 0) {
      return;
    }

    const trimmed = this.buffer.slice(0, this.writeIndex);
    this.dispatchChunk(trimmed, this.writeIndex);
    this.resetBuffer();
  }

  private resetBuffer(): void {
    this.buffer = new Float32Array(CHUNK_SIZE);
    this.writeIndex = 0;
    this.sumSquares = 0;
    this.peak = 0;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);

export {};
