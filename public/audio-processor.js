/**
 * AudioWorklet Processor for Soniox STT
 * 处理麦克风音频并发送到主线程
 */
class SonioxAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // 如果没有输入，返回true继续处理
    if (!input || input.length === 0) {
      return true;
    }

    const channelData = input[0]; // 获取第一个声道

    if (!channelData) {
      return true;
    }

    // 将音频数据累积到缓冲区
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      // 当缓冲区满时，发送到主线程
      if (this.bufferIndex >= this.bufferSize) {
        // 复制缓冲区数据
        const audioData = new Float32Array(this.buffer);

        // 发送到主线程
        this.port.postMessage({
          type: 'audio',
          data: audioData
        });

        // 重置缓冲区索引
        this.bufferIndex = 0;
      }
    }

    return true; // 继续处理
  }
}

registerProcessor('soniox-audio-processor', SonioxAudioProcessor);
