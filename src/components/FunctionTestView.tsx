import { useState, useRef } from 'react';
import { X, PlayCircle, StopCircle, Mic, MessageSquare, Brain, CheckCircle, AlertCircle } from 'lucide-react';
import type { Settings as SettingsType } from '../types';
import { sonioxService } from '../services/soniox';
import { llmService, type LLMMessage } from '../services/llm';
import { audioCaptureService } from '../services/audio-capture';
import { useTheme } from '../hooks/useTheme';

interface FunctionTestViewProps {
  settings: SettingsType;
  onClose: () => void;
}

interface TranscriptItem {
  id: string;
  text: string;
  timestamp: string;
  speaker: 'user' | 'interviewer';
  originalSpeaker: string; // spk1, spk2 など
  isFinal: boolean;
}

interface LLMResponseItem {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

export default function FunctionTestView({ settings, onClose }: FunctionTestViewProps) {
  const { getFontSize, themeClasses } = useTheme(settings.displaySettings);
  
  const [isRunning, setIsRunning] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [llmResponses, setLLMResponses] = useState<LLMResponseItem[]>([]);
  const [status, setStatus] = useState<string>('準備完了');
  const [error, setError] = useState<string>('');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [debugInfo, setDebugInfo] = useState<string>('');
  
  // 最後の面接官の質問を追跡
  const lastInterviewerQuestionRef = useRef<string>('');
  
  // 面接官の識別状態
  const [interviewerSpeaker, setInterviewerSpeaker] = useState<'spk1' | 'spk2' | null>(null);
  const interviewerSpeakerRef = useRef<'spk1' | 'spk2' | null>(null); // refで管理してコールバックで最新値を使用
  const [isIdentifying, setIsIdentifying] = useState(true);
  const isIdentifyingRef = useRef<boolean>(true); // refで管理してコールバックで最新値を使用
  const hasIdentifiedRef = useRef<boolean>(false); // 識別済みフラグ
  const startTimeRef = useRef<number>(Date.now());
  const identificationTranscriptsRef = useRef<Array<{ speaker: string; text: string }>>([]);

  // LLMで面接官を識別
  const identifyInterviewer = async () => {
    // 既に識別済みの場合はスキップ
    if (hasIdentifiedRef.current) {
      console.log('✅ 既に識別済みのためスキップ');
      return;
    }
    
    hasIdentifiedRef.current = true; // 識別開始をマーク
    
    if (identificationTranscriptsRef.current.length === 0) {
      console.warn('⚠️ 識別用の転写データがありません');
      return;
    }

    console.log('🔍 LLMで面接官を識別中...', identificationTranscriptsRef.current.length, '件の転写');
    setStatus('面接官を識別中...');

    try {
      // 転写データを整形
      const conversationText = identificationTranscriptsRef.current
        .map(t => `${t.speaker}: ${t.text}`)
        .join('\n');

      const prompt = `以下は会話の転写です。2人の話者がいます。どちらが面接官（質問する側）で、どちらが候補者（回答する側）か判断してください。

会話:
${conversationText}

上記の会話を分析して、どちらの話者が面接官か判断してください。
- spk1が面接官の場合は「spk1」とだけ答えてください
- spk2が面接官の場合は「spk2」とだけ答えてください

回答（spk1またはspk2のみ）:`;

      const messages: LLMMessage[] = [
        { 
          role: 'system', 
          content: 'あなたは会話分析の専門家です。会話の転写から面接官を識別してください。回答は「spk1」または「spk2」のみでお願いします。'
        },
        { role: 'user', content: prompt }
      ];

      const answer = await llmService.generateResponse(messages);
      const cleanAnswer = answer.trim().toLowerCase();

      console.log('🤖 LLM識別結果:', answer);

      let identifiedSpeaker: 'spk1' | 'spk2';
      
      if (cleanAnswer.includes('spk1')) {
        identifiedSpeaker = 'spk1';
        setStatus('面接官識別完了: spk1');
        console.log('✅ spk1を面接官として識別');
      } else if (cleanAnswer.includes('spk2')) {
        identifiedSpeaker = 'spk2';
        setStatus('面接官識別完了: spk2');
        console.log('✅ spk2を面接官として識別');
      } else {
        identifiedSpeaker = 'spk1';
        console.warn('⚠️ 識別結果が不明確です。デフォルトでspk1を面接官とします');
        setStatus('面接官識別完了: spk1 (デフォルト)');
      }

      // refとstateを更新
      interviewerSpeakerRef.current = identifiedSpeaker;
      setInterviewerSpeaker(identifiedSpeaker);
      
      setIsIdentifying(false);
      isIdentifyingRef.current = false;
      setDebugInfo('面接官識別完了');
      
      console.log(`🔄 転写項目を更新中... 面接官: ${identifiedSpeaker}`);
      
      // 既存の転写項目のspeakerフィールドを更新
      setTranscripts(prev => {
        console.log(`🔍 更新前の転写項目数: ${prev.length}`);
        prev.forEach((item, i) => {
          console.log(`  [${i}] originalSpeaker: "${item.originalSpeaker}", speaker: "${item.speaker}", text: "${item.text.substring(0, 20)}..."`);
        });
        
        const updated = prev.map(item => {
          const isMatch = item.originalSpeaker === identifiedSpeaker;
          const newSpeaker: 'user' | 'interviewer' = isMatch ? 'interviewer' : 'user';
          console.log(`  📝 "${item.originalSpeaker}" === "${identifiedSpeaker}"? ${isMatch} → ${newSpeaker}`);
          return {
            ...item,
            speaker: newSpeaker
          };
        });
        
        console.log(`✅ ${updated.length}件の転写項目を更新完了`);
        updated.forEach((item, i) => {
          console.log(`  [${i}] 更新後 speaker: "${item.speaker}"`);
        });
        
        return updated;
      });
      
    } catch (err) {
      console.error('❌ 面接官識別エラー:', err);
      // エラーの場合もデフォルトでspk1を面接官とする
      const identifiedSpeaker: 'spk1' = 'spk1';
      
      interviewerSpeakerRef.current = identifiedSpeaker;
      setInterviewerSpeaker(identifiedSpeaker);
      setIsIdentifying(false);
      isIdentifyingRef.current = false;
      setStatus('面接官識別完了: spk1 (エラー時デフォルト)');
      setDebugInfo('識別エラー、デフォルト設定適用');
      
      console.log(`🔄 転写項目を更新中... 面接官: ${identifiedSpeaker} (エラー時)`);
      
      // 既存の転写項目のspeakerフィールドを更新
      setTranscripts(prev => {
        console.log(`🔍 更新前の転写項目数: ${prev.length}`);
        prev.forEach((item, i) => {
          console.log(`  [${i}] originalSpeaker: "${item.originalSpeaker}", speaker: "${item.speaker}", text: "${item.text.substring(0, 20)}..."`);
        });
        
        const updated = prev.map(item => {
          const isMatch = item.originalSpeaker === identifiedSpeaker;
          const newSpeaker: 'user' | 'interviewer' = isMatch ? 'interviewer' : 'user';
          console.log(`  📝 "${item.originalSpeaker}" === "${identifiedSpeaker}"? ${isMatch} → ${newSpeaker}`);
          return {
            ...item,
            speaker: newSpeaker
          };
        });
        
        console.log(`✅ ${updated.length}件の転写項目を更新完了`);
        updated.forEach((item, i) => {
          console.log(`  [${i}] 更新後 speaker: "${item.speaker}"`);
        });
        
        return updated;
      });
    }
  };

  const handleStartTest = async () => {
    try {
      setError('');
      setStatus('接続中...');
      setDebugInfo('');
      
      // 識別状態をリセット
      setInterviewerSpeaker(null);
      interviewerSpeakerRef.current = null;
      setIsIdentifying(true);
      isIdentifyingRef.current = true; // refもリセット
      hasIdentifiedRef.current = false; // 識別フラグをリセット
      startTimeRef.current = Date.now();
      identificationTranscriptsRef.current = [];
      setTranscripts([]);
      setLLMResponses([]);
      
      console.log('🎬 機能テスト開始...');

      // LLMサービスを設定
      llmService.setConfig({
        provider: settings.llmSettings.provider,
        apiKey: settings.llmSettings.apiKey,
        model: settings.llmSettings.model,
        temperature: settings.llmSettings.temperature,
        maxTokens: settings.llmSettings.maxTokens
      });

      // Soniox STTコールバックを設定
      sonioxService.onTranscript = (text: string, isFinal: boolean, speaker?: string) => {
        console.log(`📝 転写受信 [speaker="${speaker}", isFinal=${isFinal}, isIdentifying=${isIdentifyingRef.current}, interviewer=${interviewerSpeakerRef.current}]:`, text.substring(0, 50));
        
        if (!speaker || !text.trim()) {
          console.warn('⚠️ speaker または text が空です', { speaker, text: text.trim() });
          return;
        }
        
        // 面接官識別期間中（最初の1分間）はデータを収集
        if (isIdentifyingRef.current) {
          const elapsedTime = (Date.now() - startTimeRef.current) / 1000; // 秒
          
          if (isFinal) {
            // 最終結果のみを収集
            identificationTranscriptsRef.current.push({
              speaker: speaker,
              text: text.trim()
            });
            
            console.log(`🔍 識別データ収集中: ${elapsedTime.toFixed(1)}秒経過, ${identificationTranscriptsRef.current.length}件`);
            setDebugInfo(`識別データ収集中: ${elapsedTime.toFixed(0)}秒/${60}秒`);
          }
          
          // 1分経過したら面接官を識別
          if (elapsedTime >= 60 && identificationTranscriptsRef.current.length >= 3) {
            console.log('⏰ 1分経過、面接官を識別します');
            identifyInterviewer();
          }
        }
        
        // 話者の役割を決定
        let speakerRole: 'user' | 'interviewer';
        
        if (interviewerSpeakerRef.current) {
          // 識別完了後
          const isMatch = speaker === interviewerSpeakerRef.current;
          speakerRole = isMatch ? 'interviewer' : 'user';
          console.log(`👤 話者判定 [識別済み]: "${speaker}" === "${interviewerSpeakerRef.current}"? ${isMatch} → role=${speakerRole}`);
        } else {
          // 識別中は暫定的に表示（まだLLM処理はしない）
          speakerRole = speaker === 'spk1' ? 'interviewer' : 'user';
          console.log(`👤 話者判定 [識別中]: speaker=${speaker}, 暫定role=${speakerRole}`);
        }
        
        // トランスクリプトを追加
        const transcript: TranscriptItem = {
          id: Date.now().toString() + Math.random(),
          text: text.trim(),
          timestamp: new Date().toLocaleTimeString('ja-JP'),
          speaker: speakerRole,
          originalSpeaker: speaker, // 元の話者情報を保存
          isFinal
        };
        
        console.log(`📋 転写項目作成: originalSpeaker="${speaker}", speaker="${speakerRole}", isFinal=${isFinal}`);
        
        setTranscripts(prev => {
          const lastIndex = prev.length - 1;
          
          // 最後のエントリと同じspeakerかチェック
          if (lastIndex >= 0 && prev[lastIndex].originalSpeaker === speaker) {
            const lastEntry = prev[lastIndex];
            
            // 前のエントリがfinalの場合
            if (lastEntry.isFinal) {
              // 新しいutteranceとして追加
              console.log(`  + 新しいutterance [${prev.length}], speaker=${speaker}, isFinal=${isFinal}`);
              return [...prev, transcript];
            } else {
              // 前のエントリがnon-finalの場合は更新
              console.log(`  ↻ utteranceを更新 [${lastIndex}], isFinal=${isFinal}`);
              const updated = [...prev];
              updated[lastIndex] = transcript;
              return updated;
            }
          }
          
          // 異なるspeakerまたは最初のエントリ → 新規追加
          console.log(`  + 新しい転写エントリ [${prev.length}], speaker=${speaker}, isFinal=${isFinal}`);
          return [...prev, transcript];
        });
        
        // 識別完了後、最終結果で面接官の発言の場合のみLLM処理
        const shouldCheckLLM = !isIdentifyingRef.current && isFinal && text.trim();
        console.log(`🔍 LLM処理条件チェック: isIdentifying=${isIdentifyingRef.current}, isFinal=${isFinal}, hasText=${!!text.trim()}, shouldCheck=${shouldCheckLLM}`);
        
        if (shouldCheckLLM) {
          // refから最新の面接官情報を取得
          const currentInterviewer = interviewerSpeakerRef.current;
          console.log(`🔍 詳細チェック: speaker=${speaker}, interviewer=${currentInterviewer}, match=${speaker === currentInterviewer}`);
          
          if (currentInterviewer && speaker === currentInterviewer) {
            lastInterviewerQuestionRef.current = text.trim();
            console.log('💬 ✅ 面接官の質問を検出、LLM処理開始:', text.trim().substring(0, 50) + '...');
            handleLLMResponse(text.trim());
          } else {
            console.log(`📝 ❌ 非面接官の発言またはインタビュアー未設定: speaker=${speaker}, interviewer=${currentInterviewer}`);
          }
        } else {
          if (isIdentifyingRef.current) {
            console.log('📝 識別中のためLLM処理スキップ');
          } else if (!isFinal) {
            console.log('📝 中間結果のためLLM処理スキップ');
          }
        }
      };

      sonioxService.onError = (errorMsg: string) => {
        console.error('❌ Sonioxエラー:', errorMsg);
        setError(`STTエラー: ${errorMsg}`);
        setStatus('エラー発生');
        handleStopTest();
      };

      sonioxService.onConnected = () => {
        console.log('✅ Soniox接続成功');
        setStatus('転写中...');
      };

      // Sonioxに接続
      await sonioxService.connect({
        apiKey: settings.sttSettings.sonioxApiKey,
        model: settings.sttSettings.model,
        audioFormat: settings.sttSettings.audioFormat,
        numChannels: 1,
        sampleRate: 24000,
        languageHints: settings.sttSettings.languageHints,
        context: settings.sttSettings.context,
        enableSpeakerDiarization: settings.sttSettings.enableSpeakerDiarization,
        enableLanguageIdentification: settings.sttSettings.enableLanguageIdentification,
        enableEndpointDetection: settings.sttSettings.enableEndpointDetection
      });

      // 音声キャプチャコールバックを設定
      let audioChunkCount = 0;
      audioCaptureService.onAudioData = (audioData: Float32Array) => {
        sonioxService.sendAudio(audioData);
        audioChunkCount++;
        
        // 音声レベルを計算
        let sum = 0;
        let maxAmp = 0;
        for (let i = 0; i < audioData.length; i++) {
          sum += audioData[i] * audioData[i];
          maxAmp = Math.max(maxAmp, Math.abs(audioData[i]));
        }
        const rms = Math.sqrt(sum / audioData.length);
        const level = Math.min(100, Math.floor(rms * 3000));
        
        setAudioLevel(level);
        
        if (audioChunkCount % 50 === 0) {
          setDebugInfo(`音声: レベル ${level}%, RMS ${rms.toFixed(4)}, チャンク ${audioChunkCount}`);
        }
      };

      audioCaptureService.onError = (errorMsg: string) => {
        console.error('❌ 音声キャプチャエラー:', errorMsg);
        setError(`音声エラー: ${errorMsg}`);
        setStatus('エラー発生');
        handleStopTest();
      };

      // 音声キャプチャを開始
      // 注意: システムオーディオをキャプチャするため、echo/noise suppressionは内部で無効化されます
      await audioCaptureService.start({
        sampleRate: 24000,
        echoCancellation: false, // システムオーディオをキャプチャするため無効化
        noiseSuppression: false,  // システムオーディオをキャプチャするため無効化
        autoGainControl: true
      });

      setIsRunning(true);
      setStatus('テスト実行中');
      console.log('✅ 機能テスト開始完了');
    } catch (err) {
      console.error('❌ テスト開始エラー:', err);
      setError(err instanceof Error ? err.message : 'テスト開始に失敗しました');
      setStatus('エラー発生');
      handleStopTest();
    }
  };

  const handleStopTest = () => {
    console.log('🛑 機能テスト停止...');
    
    // 音声キャプチャを停止
    audioCaptureService.stop();
    
    // Soniox接続を終了
    if (sonioxService.isConnected()) {
      sonioxService.finalize();
      sonioxService.disconnect();
    }
    
    setIsRunning(false);
    setStatus('停止');
    setAudioLevel(0);
    
    // 識別状態はリセットしない（結果を保持）
    
    console.log('✅ 機能テスト停止完了');
  };

  const handleLLMResponse = async (question: string) => {
    console.log('🤖 handleLLMResponse呼び出し:', question);
    setDebugInfo('LLM応答生成中...');
    
    try {
      console.log('🤖 LLM応答生成開始');
      console.log('🤖 LLM設定:', {
        provider: settings.llmSettings.provider,
        model: settings.llmSettings.model,
        hasApiKey: !!settings.llmSettings.apiKey
      });
      
      const systemPrompt = `あなたは面接のアシスタントです。面接官の発言を分析し、回答が必要な質問かどうかを判断してください。

【回答が必要な質問の例】
- 「〇〇について教えてください」
- 「どのような経験がありますか」
- 「なぜ〇〇だと思いますか」
- 具体的な情報や説明を求める質問

【回答が不要な発言の例】
- 「ありがとうございます」「そうなんですね」などの相槌や確認
- 「では次に〜」などの話題の移行
- 「〜と思います」などの面接官の意見表明
- 単なる感想やアドバイス

回答が必要な質問の場合のみ、5W1H原則に基づいて簡潔で自然な日本語で回答案を生成してください。
回答が不要な場合は「[回答不要]」とだけ返してください。`;

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `面接官の発言:\n${question}` }
      ];

      console.log('🤖 LLMサービスにリクエスト送信...');
      const answer = await llmService.generateResponse(messages);
      console.log('🤖 LLMから応答受信:', answer.substring(0, 100));
      
      // [回答不要]の場合はスキップ
      if (answer.trim() === '[回答不要]' || answer.includes('[回答不要]')) {
        console.log('⏭️ 回答不要と判断されました、スキップ');
        setDebugInfo('質問ではないためスキップ');
        return;
      }
      
      const response: LLMResponseItem = {
        id: Date.now().toString(),
        question,
        answer,
        timestamp: new Date().toLocaleTimeString('ja-JP')
      };
      
      console.log('🤖 LLM応答を状態に追加');
      setLLMResponses(prev => {
        console.log('🤖 現在のLLM応答数:', prev.length);
        return [response, ...prev];
      });
      setDebugInfo('LLM応答完了');
      console.log('✅ LLM応答生成完了');
    } catch (err) {
      console.error('❌ LLM応答エラー:', err);
      console.error('❌ エラー詳細:', err instanceof Error ? err.stack : err);
      const errorMsg = 'LLM応答生成エラー: ' + (err instanceof Error ? err.message : '不明なエラー');
      setError(errorMsg);
      setDebugInfo(errorMsg);
    }
  };

  return (
    <div className={`flex flex-col h-full ${themeClasses.bg}`}>
      {/* Header */}
      <div className={`${themeClasses.bgCard} border-b ${themeClasses.border} px-6 py-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className={`p-2 ${themeClasses.bgHover} rounded-lg transition-colors`}
            >
              <X className={`w-5 h-5 ${themeClasses.textLabel}`} />
            </button>
            <div>
              <h1 className={`text-lg font-semibold ${themeClasses.text}`}>機能テスト</h1>
              <p className={`text-xs ${themeClasses.textMuted}`}>リアルタイム音声転写とLLM応答のテスト</p>
            </div>
          </div>
          
          {/* Status Badge */}
          <div className="flex items-center gap-3">
            {/* 面接官識別状態 */}
            {isRunning && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
                isIdentifying ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'
              }`}>
                {isIdentifying ? (
                  <>
                    <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                    <span className="text-xs font-medium text-yellow-700">識別中...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3 h-3 text-green-600" />
                    <span className="text-xs font-medium text-green-700">
                      面接官: {interviewerSpeaker === 'spk1' ? 'Speaker 1' : 'Speaker 2'}
                    </span>
                  </>
                )}
              </div>
            )}
            
            {/* 実行状態 */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
              error ? 'bg-red-50 border-red-200' : isRunning ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                error ? 'bg-red-500' : isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
              }`}></div>
              <span className={`text-xs font-medium ${
                error ? 'text-red-700' : isRunning ? 'text-green-700' : 'text-gray-700'
              }`}>
                {error ? 'エラー' : status}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left Panel - Transcripts */}
        <div className={`flex-1 flex flex-col border-r ${themeClasses.border} ${themeClasses.bgCard}`}>
          <div className={`px-6 py-4 border-b ${themeClasses.border}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className={`text-sm font-semibold ${themeClasses.text} flex items-center gap-2`}>
                  <MessageSquare className="w-4 h-4" />
                  リアルタイム転写
                </h2>
                <p className={`text-xs ${themeClasses.textMuted} mt-0.5`}>
                  {settings.sttSettings.enableSpeakerDiarization ? '話者分離: 有効' : '話者分離: 無効'}
                </p>
              </div>
              
              {/* Audio Level Indicator */}
              {isRunning && (
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-blue-600" />
                  <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-400 transition-all duration-150"
                      style={{ width: `${audioLevel}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-mono text-gray-600">{audioLevel}%</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {transcripts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Mic className="w-12 h-12 text-gray-400 mb-3" />
                <p className="text-sm font-medium text-gray-900">音声転写待機中</p>
                <p className="text-sm text-gray-500 mt-1">音声を再生してください</p>
              </div>
            ) : (
              <div className="space-y-3">
                {transcripts.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg border ${
                      item.speaker === 'interviewer'
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-green-50 border-green-200'
                    } ${!item.isFinal ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold ${
                        item.speaker === 'interviewer' ? 'text-blue-700' : 'text-green-700'
                      }`}>
                        {isIdentifying ? (
                          // 識別中は "Speaker 1", "Speaker 2" と表示
                          item.originalSpeaker === 'spk1' ? 'Speaker 1' : 
                          item.originalSpeaker === 'spk2' ? 'Speaker 2' : 
                          'Speaker ' + item.originalSpeaker.replace('spk', '')
                        ) : (
                          // 識別完了後は "面接官" または "あなた"
                          item.speaker === 'interviewer' ? '面接官' : 'あなた'
                        )}
                      </span>
                      <span className="text-xs text-gray-400">{item.timestamp}</span>
                      {!item.isFinal && (
                        <span className="text-xs text-gray-500 ml-auto">...</span>
                      )}
                    </div>
                    <p className={`${getFontSize()} ${themeClasses.text} leading-relaxed whitespace-normal break-words overflow-wrap-anywhere`}>{item.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Debug Info */}
          {debugInfo && (
            <div className="px-6 py-2 bg-gray-50 border-t border-gray-200">
              <p className="text-xs font-mono text-gray-600">{debugInfo}</p>
            </div>
          )}
        </div>

        {/* Right Panel - LLM Responses */}
        <div className={`w-[420px] flex flex-col ${themeClasses.bgCard}`}>
          <div className={`px-6 py-4 border-b ${themeClasses.border}`}>
            <h2 className={`text-sm font-semibold ${themeClasses.text} flex items-center gap-2`}>
              <Brain className="w-4 h-4" />
              LLM応答
            </h2>
            <p className={`text-xs ${themeClasses.textMuted} mt-0.5`}>
              面接官の質問に対する回答案
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {llmResponses.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Brain className="w-12 h-12 text-gray-400 mb-3" />
                <p className="text-sm font-medium text-gray-900">LLM応答待機中</p>
                <p className="text-sm text-gray-500 mt-1">面接官の質問を検出すると</p>
                <p className="text-sm text-gray-500">自動的に応答を生成します</p>
              </div>
            ) : (
              <div className="space-y-4">
                {llmResponses.map((response) => (
                  <div key={response.id} className="space-y-3">
                    <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                      <div className="flex items-center gap-2 mb-1">
                        <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                        <span className="text-xs font-semibold text-blue-700">質問</span>
                        <span className="text-xs text-gray-400 ml-auto">{response.timestamp}</span>
                      </div>
                      <p className="text-xs text-blue-900 leading-relaxed">{response.question}</p>
                    </div>
                    
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span className="text-xs font-semibold text-gray-700">AI生成</span>
                      </div>
                      <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-line">
                        {response.answer}
                      </p>
                    </div>
                    
                    <div className="border-t border-gray-200"></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-6 py-3 bg-red-50 border-t border-red-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Control Panel */}
      <div className="px-6 py-4 bg-white border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {isRunning ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span>テスト実行中 - 音声を再生してください</span>
              </div>
            ) : (
              <span>準備完了 - テストを開始してください</span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {!isRunning ? (
              <button
                onClick={handleStartTest}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
              >
                <PlayCircle className="w-4 h-4" />
                <span>テスト開始</span>
              </button>
            ) : (
              <button
                onClick={handleStopTest}
                className="flex items-center gap-2 px-6 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors shadow-sm font-medium"
              >
                <StopCircle className="w-4 h-4" />
                <span>停止</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="px-6 py-3 bg-blue-50 border-t border-blue-100">
        <div className="flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-700 space-y-1">
            <p><strong>テスト手順:</strong></p>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li>マイクがシステムオーディオを拾えるよう設定（スピーカーの近くに配置）</li>
              <li>YouTubeなどで音声を再生（複数人の会話を推奨）</li>
              <li>音声レベルインジケーターで入力を確認</li>
              <li><strong>最初の1分間:</strong> LLMが面接官を自動識別します</li>
              <li><strong>識別完了後:</strong> 面接官の質問にのみLLMが応答を生成します</li>
              <li>リアルタイム転写と話者分離を確認</li>
            </ul>
            <p className="mt-2 text-amber-700"><strong>ヒント:</strong> エコーキャンセルは自動的に無効化されるため、マイクがシステム音声を直接キャプチャできます。</p>
            <p className="mt-1 text-green-700"><strong>面接官識別:</strong> システムが会話を分析し、どちらが質問する側（面接官）かを自動的に判断します。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
