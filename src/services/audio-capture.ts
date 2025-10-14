/**
 * 音频捕获服务
 * 提供更稳定的音频输入处理
 */

export interface AudioCaptureConfig {
  deviceId?: string;
  sampleRate: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export class AudioCaptureService {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private isPaused = false;
  
  public onAudioData?: (audioData: Float32Array) => void;
  public onError?: (error: string) => void;
  
  /**
   * 音声キャプチャを開始
   */
  async start(config: AudioCaptureConfig): Promise<void> {
    try {
      console.log('🎤 音声キャプチャを開始...', config);
      
      // メディアストリームを取得
      // 重要: システムオーディオをキャプチャする場合、echoCancellationは無効にする必要があります
      const constraints: MediaStreamConstraints = {
        audio: {
          // システムオーディオをキャプチャするため、エコーキャンセルを無効化
          echoCancellation: false,
          // ノイズ抑制も無効化（システムオーディオを保持するため）
          noiseSuppression: false,
          // 自動ゲイン制御は有効のまま
          autoGainControl: config.autoGainControl,
          // サンプルレートを明示的に指定
          sampleRate: config.sampleRate,
          // チャンネル数を指定
          channelCount: 1,
          ...(config.deviceId && { deviceId: { exact: config.deviceId } })
        } as any // TypeScriptの型定義が不完全なのでanyを使用
      };
      
      console.log('📢 マイク権限を要求中...', constraints);
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // 音声トラックを確認
      const audioTracks = this.mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('音声トラックが見つかりません');
      }
      
      const trackSettings = audioTracks[0].getSettings();
      console.log('✅ メディアストリーム取得成功:', {
        label: audioTracks[0].label,
        sampleRate: trackSettings.sampleRate,
        channelCount: trackSettings.channelCount,
        echoCancellation: trackSettings.echoCancellation,
        noiseSuppression: trackSettings.noiseSuppression,
        autoGainControl: trackSettings.autoGainControl
      });
      
      // AudioContextを作成
      this.audioContext = new AudioContext({ 
        sampleRate: config.sampleRate,
        latencyHint: 'interactive' // 低レイテンシーを優先
      });
      
      console.log('🎵 AudioContext作成:', {
        state: this.audioContext.state,
        sampleRate: this.audioContext.sampleRate,
        baseLatency: this.audioContext.baseLatency
      });
      
      // 状態を確認
      if (this.audioContext.state === 'suspended') {
        console.log('⏸️  AudioContextがサスペンド状態、再開中...');
        await this.audioContext.resume();
        console.log('▶️  AudioContext再開完了');
      }
      
      // ソースノードを作成
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // ScriptProcessorNodeを使用（より安定）
      // バッファサイズを小さくしてレイテンシーを改善
      const bufferSize = 2048; // 4096から2048に変更
      this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      let lastProcessTime = Date.now();
      let processCount = 0;
      let totalSamples = 0;
      
      this.scriptProcessor.onaudioprocess = (event) => {
        try {
          const inputData = event.inputBuffer.getChannelData(0);
          
          // 音声レベルをチェック（デバッグ用）
          let sum = 0;
          let maxAmp = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
            maxAmp = Math.max(maxAmp, Math.abs(inputData[i]));
          }
          const rms = Math.sqrt(sum / inputData.length);
          
          // コピーを作成（参照が変更される可能性があるため）
          const audioCopy = new Float32Array(inputData);
          
          // コールバックを呼び出し
          if (this.onAudioData && !this.isPaused) {
            this.onAudioData(audioCopy);
          }
          
          processCount++;
          totalSamples += inputData.length;
          const now = Date.now();
          if (now - lastProcessTime >= 5000) {
            const elapsed = (now - lastProcessTime) / 1000;
            console.log(`🎵 音声処理: ${processCount}チャンク / ${elapsed.toFixed(1)}秒, RMS: ${rms.toFixed(6)}, Max: ${maxAmp.toFixed(6)}, サンプル合計: ${totalSamples}`);
            processCount = 0;
            totalSamples = 0;
            lastProcessTime = now;
          }
        } catch (error) {
          console.error('❌ 音声処理エラー:', error);
          this.onError?.(error instanceof Error ? error.message : '音声処理エラー');
        }
      };
      
      // 接続（重要: destinationに接続しない）
      // ScriptProcessorNodeはsourceに接続するだけで動作します
      // destinationに接続するとフィードバックや不要な音声出力が発生する可能性があります
      this.sourceNode.connect(this.scriptProcessor);
      // this.scriptProcessor.connect(this.audioContext.destination); // ← この行を削除
      
      // ダミーノードに接続してGCを防ぐ
      // ScriptProcessorNodeはどこかに接続されていないとGCされる可能性があるため
      const dummyGain = this.audioContext.createGain();
      dummyGain.gain.value = 0; // 音量を0に設定
      this.scriptProcessor.connect(dummyGain);
      dummyGain.connect(this.audioContext.destination);
      
      this.isPaused = false;
      console.log('✅ 音声キャプチャ開始完了');
    } catch (error) {
      console.error('❌ 音声キャプチャ開始エラー:', error);
      this.cleanup();
      
      let errorMsg = '音声キャプチャエラー';
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMsg = 'マイクアクセスが拒否されました';
        } else if (error.name === 'NotFoundError') {
          errorMsg = '指定された音声デバイスが見つかりません';
        } else if (error.name === 'NotReadableError') {
          errorMsg = '音声デバイスが他のアプリケーションで使用中です';
        } else {
          errorMsg = error.message;
        }
      }
      
      this.onError?.(errorMsg);
      throw new Error(errorMsg);
    }
  }
  
  /**
   * 音声キャプチャを停止
   */
  stop(): void {
    console.log('🛑 音声キャプチャを停止');
    this.cleanup();
  }

  /**
   * 一時停止
   */
  pause(): void {
    if (!this.mediaStream || !this.audioContext || this.isPaused) {
      return;
    }

    this.isPaused = true;
    this.mediaStream.getTracks().forEach(track => {
      track.enabled = false;
    });

    if (this.audioContext.state === 'running') {
      this.audioContext.suspend().catch(err => {
        console.warn('⚠️ AudioContext suspend error:', err);
      });
    }
  }

  /**
   * 再開
   */
  resume(): void {
    if (!this.mediaStream || !this.audioContext || !this.isPaused) {
      return;
    }

    this.mediaStream.getTracks().forEach(track => {
      track.enabled = true;
    });

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(err => {
        console.warn('⚠️ AudioContext resume error:', err);
      });
    }

    this.isPaused = false;
  }
  
  /**
   * リソースをクリーンアップ
   */
  private cleanup(): void {
    // ScriptProcessorを切断
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor = null;
    }
    
    // AudioWorkletを切断
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    
    // ソースノードを切断
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    
    // AudioContextを閉じる
    if (this.audioContext) {
      this.audioContext.close().catch(err => {
        console.warn('⚠️ AudioContext close error:', err);
      });
      this.audioContext = null;
    }
    
    // メディアストリームを停止
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
        console.log('🛑 トラック停止:', track.label);
      });
      this.mediaStream = null;
    }

    this.isPaused = false;
  }
  
  /**
   * 現在の状態を取得
   */
  isCapturing(): boolean {
    return this.audioContext !== null && this.mediaStream !== null;
  }
  
  /**
   * AudioContextの状態を取得
   */
  getAudioContextState(): AudioContextState | null {
    return this.audioContext?.state || null;
  }
}

export const audioCaptureService = new AudioCaptureService();
