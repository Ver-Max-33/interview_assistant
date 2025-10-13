/**
 * Soniox WebSocket STT Service
 * Real-time speech-to-text using Soniox API
 */

export interface SonioxConfig {
  apiKey: string;
  model: string;
  audioFormat: string;
  numChannels?: number;
  sampleRate?: number;
  languageHints: string[];
  context?: string;
  enableSpeakerDiarization: boolean;
  enableLanguageIdentification: boolean;
  enableEndpointDetection: boolean;
  clientReferenceId?: string;
  translation?: {
    type: 'one_way' | 'two_way';
    targetLanguage?: string;
    languageA?: string;
    languageB?: string;
  };
}

export interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  confidence: number;
  is_final: boolean;
  speaker?: string;
  translation_status?: string;
  language?: string;
  source_language?: string;
}

export interface SonioxResponse {
  tokens: SonioxToken[];
  final_audio_proc_ms: number;
  total_audio_proc_ms: number;
  finished?: boolean;
  error_code?: number;
  error_message?: string;
}

export class SonioxSTTService {
  private ws: WebSocket | null = null;
  private config: SonioxConfig | null = null;
  private responseCount: number = 0; // デバッグ用カウンター
  
  // 現在の発話追跡（speaker別）
  private currentSpeaker: string | null = null;
  private currentFinalTokens: SonioxToken[] = [];
  private currentNonFinalTokens: SonioxToken[] = [];
  
  // Callbacks
  public onTranscript?: (text: string, isFinal: boolean, speaker?: string) => void;
  public onError?: (error: string) => void;
  public onConnected?: () => void;
  
  async connect(config: SonioxConfig): Promise<void> {
    this.config = config;
    
    return new Promise((resolve, reject) => {
      try {
        const url = 'wss://stt-rt.soniox.com/transcribe-websocket';
        
        this.ws = new WebSocket(url);
        
        this.ws.onopen = () => {
          console.log('✅ Soniox WebSocket接続成功');
          this.sendConfiguration();
          this.onConnected?.();
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const response: SonioxResponse = JSON.parse(event.data);
            this.handleResponse(response);
          } catch (error) {
            console.error('❌ Soniox メッセージ解析エラー:', error);
          }
        };
        
        this.ws.onerror = (error) => {
          console.error('❌ Soniox WebSocketエラー:', error);
          this.onError?.('WebSocket接続エラー');
          reject(new Error('WebSocket接続エラー'));
        };
        
        this.ws.onclose = (event) => {
          console.log('🔌 Soniox WebSocket切断:', event.code, event.reason);
          if (event.code !== 1000 && event.code !== 1005) {
            const reason = event.reason || `接続が閉じられました (コード: ${event.code})`;
            this.onError?.(reason);
          }
        };
      } catch (error) {
        console.error('❌ Soniox 接続失敗:', error);
        reject(error);
      }
    });
  }
  
  private sendConfiguration(): void {
    if (!this.ws || !this.config || this.ws.readyState !== WebSocket.OPEN) {
      console.error('⚠️ WebSocketが接続されていません');
      return;
    }
    
    const configMessage: any = {
      api_key: this.config.apiKey,
      model: this.config.model,
      audio_format: this.config.audioFormat,
      language_hints: this.config.languageHints,
      enable_speaker_diarization: this.config.enableSpeakerDiarization,
      enable_language_identification: this.config.enableLanguageIdentification,
      enable_endpoint_detection: this.config.enableEndpointDetection,
    };
    
    if (this.config.numChannels) {
      configMessage.num_channels = this.config.numChannels;
    }
    
    if (this.config.sampleRate) {
      configMessage.sample_rate = this.config.sampleRate;
    }
    
    if (this.config.context) {
      configMessage.context = this.config.context;
    }
    
    if (this.config.clientReferenceId) {
      configMessage.client_reference_id = this.config.clientReferenceId;
    }
    
    if (this.config.translation) {
      configMessage.translation = this.config.translation;
    }
    
    console.log('🔧 Soniox設定を送信:', configMessage);
    this.ws.send(JSON.stringify(configMessage));
  }
  
  sendAudio(audioData: Float32Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    // Float32ArrayをInt16Arrayに変換
    const int16Array = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      const s = Math.max(-1, Math.min(1, audioData[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // バイナリデータとして送信
    this.ws.send(int16Array.buffer);
  }
  
  finalize(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    console.log('📤 Soniox: 空フレームを送信してストリームを終了');
    // 空のフレームを送信
    this.ws.send(new ArrayBuffer(0));
  }
  
  private handleResponse(response: SonioxResponse): void {
    // デバッグ: 生のレスポンスを表示（最初の数回のみ）
    if (!this.responseCount) this.responseCount = 0;
    if (this.responseCount < 10) {
      console.log('🔍 Soniox生レスポンス:', JSON.stringify(response, null, 2));
      this.responseCount++;
    }
    
    // エラーチェック
    if (response.error_code) {
      console.error('❌ Soniox エラー:', response.error_code, response.error_message);
      this.onError?.(response.error_message || `エラーコード: ${response.error_code}`);
      return;
    }
    
    // 終了チェック
    if (response.finished) {
      console.log('✅ Soniox: ストリーム完了');
      // 最後の発話を送信
      if (this.currentSpeaker && this.currentFinalTokens.length > 0) {
        const text = this.currentFinalTokens.map(t => t.text).join('');
        if (text.trim()) {
          this.onTranscript?.(text.trim(), true, this.currentSpeaker);
        }
      }
      return;
    }
    
    // トークン処理
    if (response.tokens && response.tokens.length > 0) {
      const newFinalTokens: SonioxToken[] = [];
      const newNonFinalTokens: SonioxToken[] = [];
      
      let hasEndToken = false;
      
      response.tokens.forEach(token => {
        // <end>タグの検出（utterance終了の信号）
        if (token.text === '<end>' || token.text.trim() === '<end>') {
          console.log('🔚 <end>タグ検出: utterance終了');
          hasEndToken = true;
          return;
        }
        
        // speakerがない、またはunknownの場合もスキップ
        if (!token.speaker || token.speaker === 'unknown') {
          console.log(`⚠️ speaker情報なし、スキップ: text="${token.text}"`);
          return;
        }
        
        // Speaker形式を標準化 ("1" → "spk1", "2" → "spk2", "spk1" → "spk1")
        let normalizedSpeaker = token.speaker;
        if (/^\d+$/.test(token.speaker)) {
          // 数字のみの場合は "spk" プレフィックスを追加
          normalizedSpeaker = 'spk' + token.speaker;
          console.log(`🔧 Speaker標準化: "${token.speaker}" → "${normalizedSpeaker}"`);
        }
        token.speaker = normalizedSpeaker;
        
        // Speaker変更チェック
        if (this.currentSpeaker && token.speaker !== this.currentSpeaker) {
          console.log(`🔄 Speaker変更検出: ${this.currentSpeaker} → ${token.speaker}`);
          
          // 前のspeakerの発話を完了して送信
          if (this.currentFinalTokens.length > 0) {
            const text = this.currentFinalTokens.map(t => t.text).join('');
            if (text.trim()) {
              console.log(`📤 前のspeaker [${this.currentSpeaker}] の発話完了: "${text.substring(0, 50)}..."`);
              this.onTranscript?.(text.trim(), true, this.currentSpeaker);
            }
          }
          
          // 新しいspeakerにリセット
          this.currentSpeaker = token.speaker;
          this.currentFinalTokens = [];
          this.currentNonFinalTokens = [];
        }
        
        // 最初のspeaker設定
        if (!this.currentSpeaker) {
          this.currentSpeaker = token.speaker;
        }
        
        if (token.is_final) {
          newFinalTokens.push(token);
          console.log(`🔍 Final Token [${token.speaker}]: "${token.text}"`);
        } else {
          newNonFinalTokens.push(token);
          console.log(`🔍 Non-final Token [${token.speaker}]: "${token.text}"`);
        }
      });
      
      // 現在のspeakerのtokensを更新
      if (newFinalTokens.length > 0) {
        this.currentFinalTokens.push(...newFinalTokens);
      }
      this.currentNonFinalTokens = newNonFinalTokens; // Non-finalは毎回リセット
      
      // 進行中の発話を送信（non-final含む）
      const allTokens = [...this.currentFinalTokens, ...this.currentNonFinalTokens];
      if (allTokens.length > 0) {
        const text = allTokens.map(t => t.text).join('');
        const isFinal = this.currentNonFinalTokens.length === 0;
        
        console.log(`🎤 現在の転写 [${this.currentSpeaker}] final:${this.currentFinalTokens.length}, non-final:${this.currentNonFinalTokens.length}`);
        console.log(`   テキスト: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        
        if (text.trim() && this.currentSpeaker) {
          this.onTranscript?.(text.trim(), isFinal, this.currentSpeaker);
        }
      }
      
      // <end>タグが検出された場合の処理
      if (hasEndToken) {
        console.log('🔚 <end>タグ処理: utterance完了、状態をリセット');
        // 空の転写を送信してUI側に「話し終わった」ことを通知
        if (this.currentSpeaker) {
          console.log(`📤 <end>シグナルをUIに送信: speaker=${this.currentSpeaker}`);
          this.onTranscript?.('', true, this.currentSpeaker);
        }
        // 次のutteranceのために状態をリセット（speakerは保持）
        this.currentFinalTokens = [];
        this.currentNonFinalTokens = [];
        console.log('✅ 次のutteranceの準備完了');
      }
    }
  }
  
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // 状態をクリア
    this.currentSpeaker = null;
    this.currentFinalTokens = [];
    this.currentNonFinalTokens = [];
    this.responseCount = 0;
  }
  
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const sonioxService = new SonioxSTTService();

