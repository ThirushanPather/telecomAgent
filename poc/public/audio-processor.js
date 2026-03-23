/**
 * PCM capture AudioWorklet processor.
 * Buffers Float32 samples from the microphone and emits raw Int16 PCM chunks
 * (~200 ms at 16 kHz) to the main thread via postMessage.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 0;
    this._targetSize = 3200; // 200 ms × 16 000 Hz = 3 200 samples
  }

  process(inputs) {
    const input = inputs[0][0];
    if (!input || input.length === 0) return true;

    this._buffer.push(new Float32Array(input));
    this._bufferSize += input.length;

    if (this._bufferSize >= this._targetSize) {
      const combined = new Float32Array(this._bufferSize);
      let offset = 0;
      for (const chunk of this._buffer) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const pcm = new Int16Array(combined.length);
      for (let i = 0; i < combined.length; i++) {
        const s = Math.max(-1, Math.min(1, combined[i]));
        pcm[i] = s < 0 ? s * 32768 : s * 32767;
      }

      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this._buffer = [];
      this._bufferSize = 0;
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
