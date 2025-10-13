import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Settings, UserCircle, User, Brain, Volume2, BookOpen, Check, Copy, Zap } from 'lucide-react';
import type { PreparationData, Settings as SettingsType, Message, Suggestion } from '../types';
import { sonioxService } from '../services/soniox';
import { llmService, type LLMMessage } from '../services/llm';
import { audioCaptureService } from '../services/audio-capture';
import { scriptMatcher } from '../services/script-matcher';
import { buildSystemPrompt } from '../utils/prompt-builder';
import { storageService } from '../services/storage';

interface MainViewProps {
  preparationData: PreparationData;
  settings: SettingsType;
  onBackToWelcome: () => void;
  onOpenSettings: () => void;
}

export default function MainView({
  preparationData,
  settings,
  onBackToWelcome,
  onOpenSettings
}: MainViewProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [currentSpeaker, setCurrentSpeaker] = useState<'interviewer' | 'user' | null>(null);
  const [currentOriginalSpeaker, setCurrentOriginalSpeaker] = useState<string | null>(null); // spk1, spk2など
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>('');
  const lastInterviewerQuestionRef = useRef<string>('');
  
  // 面接官の識別状態
  const [interviewerSpeaker, setInterviewerSpeaker] = useState<'spk1' | 'spk2' | null>(null);
  const interviewerSpeakerRef = useRef<'spk1' | 'spk2' | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(true); // 識別前の状態（Speaker 1, Speaker 2と表示）
  const isIdentifyingRef = useRef<boolean>(true);
  const [isActuallyIdentifying, setIsActuallyIdentifying] = useState(false); // 実際にLLMで識別中
  const isActuallyIdentifyingRef = useRef<boolean>(false);
  const hasIdentifiedRef = useRef<boolean>(false);
  const startTimeRef = useRef<number>(Date.now());
  const identificationTranscriptsRef = useRef<Array<{ speaker: string; text: string }>>([]);

  useEffect(() => {
    // 面接稿を初期化
    console.log('📋 面接稿チェック:', {
      type: preparationData.interviewScript.type,
      hasText: !!preparationData.interviewScript.text,
      textLength: preparationData.interviewScript.text?.length || 0
    });
    
    if (preparationData.interviewScript.type === 'text' && preparationData.interviewScript.text) {
      // LLM APIキーを使用
      const apiKey = settings.llmSettings.provider === 'openai' 
        ? settings.llmSettings.apiKey 
        : settings.apiKey; // 後方互換性
      
      console.log('📖 面接稿を初期化中... テキスト長:', preparationData.interviewScript.text.length);
      scriptMatcher.initialize(preparationData.interviewScript.text, apiKey)
        .then(() => console.log('✅ 面接稿の初期化完了'))
        .catch(err => console.error('❌ 面接稿の初期化に失敗しました:', err));
    } else if (preparationData.interviewScript.type === 'file') {
      console.warn('⚠️ PDFアップロードが選択されていますが、内容が読み取られていません');
      console.warn('💡 PDF解析機能は未実装です。「手動入力」を使用してください');
    }

    // 保存された会話履歴を読み込む
    if (settings.privacySettings.saveConversation) {
      const savedConversation = storageService.loadConversation();
      if (savedConversation.length > 0) {
        setConversation(savedConversation);
      }
    }
  }, []);

  useEffect(() => {
    // 会話履歴を保存
    if (settings.privacySettings.saveConversation && conversation.length > 0) {
      storageService.saveConversation(conversation);
    }
  }, [conversation, settings.privacySettings.saveConversation]);

  // LLMで面接官を識別
  const identifyInterviewer = async () => {
    if (hasIdentifiedRef.current) {
      console.log('✅ 既に識別済みのためスキップ');
      return;
    }
    
    hasIdentifiedRef.current = true;
    
    if (identificationTranscriptsRef.current.length === 0) {
      console.warn('⚠️ 識別用の転写データがありません');
      return;
    }

    // 実際の識別開始
    setIsActuallyIdentifying(true);
    isActuallyIdentifyingRef.current = true;
    console.log('🔍 LLMで面接官を識別中...', identificationTranscriptsRef.current.length, '件の転写');

    try {
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
        console.log('✅ spk1を面接官として識別');
      } else if (cleanAnswer.includes('spk2')) {
        identifiedSpeaker = 'spk2';
        console.log('✅ spk2を面接官として識別');
      } else {
        identifiedSpeaker = 'spk1';
        console.warn('⚠️ 識別結果が不明確です。デフォルトでspk1を面接官とします');
      }

      interviewerSpeakerRef.current = identifiedSpeaker;
      setInterviewerSpeaker(identifiedSpeaker);
      setIsIdentifying(false);
      isIdentifyingRef.current = false;
      setIsActuallyIdentifying(false);
      isActuallyIdentifyingRef.current = false;
      
      console.log(`🔄 会話履歴を更新中... 面接官: ${identifiedSpeaker}`);
      
      // 既存の会話履歴のspeakerフィールドを更新
      setConversation(prev => prev.map(item => {
        if (!item.originalSpeaker) return item;
        
        const newSpeaker: 'user' | 'interviewer' = item.originalSpeaker === identifiedSpeaker ? 'interviewer' : 'user';
        console.log(`  📝 更新: ${item.originalSpeaker} === ${identifiedSpeaker}? ${item.originalSpeaker === identifiedSpeaker} → ${newSpeaker}`);
        return { ...item, speaker: newSpeaker };
      }));
      
    } catch (err) {
      console.error('❌ 面接官識別エラー:', err);
      interviewerSpeakerRef.current = 'spk1';
      setInterviewerSpeaker('spk1');
      setIsIdentifying(false);
      isIdentifyingRef.current = false;
      setIsActuallyIdentifying(false);
      isActuallyIdentifyingRef.current = false;
    }
  };

  const handleStartRecording = async () => {
    try {
      setError('');
      console.log('🎬 録音開始...');
      
      // LLMサービスを設定
      llmService.setConfig({
        provider: settings.llmSettings.provider,
        apiKey: settings.llmSettings.apiKey,
        model: settings.llmSettings.model,
        temperature: settings.llmSettings.temperature,
        maxTokens: settings.llmSettings.maxTokens
      });

      // 識別状態をリセット
      setInterviewerSpeaker(null);
      interviewerSpeakerRef.current = null;
      setIsIdentifying(true);
      isIdentifyingRef.current = true;
      setIsActuallyIdentifying(false); // 識別はまだ開始していない
      isActuallyIdentifyingRef.current = false;
      hasIdentifiedRef.current = false;
      startTimeRef.current = Date.now();
      identificationTranscriptsRef.current = [];
      
      // Soniox STTに接続
      sonioxService.onTranscript = (text: string, isFinal: boolean, speaker?: string) => {
        console.log(`📝 転写受信 [speaker="${speaker}", isFinal=${isFinal}, isIdentifying=${isIdentifyingRef.current}, interviewer=${interviewerSpeakerRef.current}]:`, text.substring(0, 50));
        
        if (!speaker) {
          console.warn('⚠️ speaker が空です');
          return;
        }
        
        // 空のテキスト + isFinal = utterance終了シグナル（<end>タグ）
        if (!text.trim() && isFinal) {
          console.log('🔚 Utterance終了シグナル受信、話している状態をクリア');
          setCurrentSpeaker(null);
          setCurrentOriginalSpeaker(null);
          return;
        }
        
        if (!text.trim()) {
          console.warn('⚠️ text が空です');
          return;
        }
        
        // 面接官識別期間中（最初の60秒間）はデータを収集
        if (isIdentifyingRef.current) {
          const elapsedTime = (Date.now() - startTimeRef.current) / 1000;
          
          if (isFinal) {
            identificationTranscriptsRef.current.push({
              speaker: speaker,
              text: text.trim()
            });
            
            console.log(`🔍 識別データ収集中: ${elapsedTime.toFixed(1)}秒経過, ${identificationTranscriptsRef.current.length}件`);
          }
          
          // 60秒経過したら面接官を識別
          if (elapsedTime >= 60 && identificationTranscriptsRef.current.length >= 3) {
            console.log('⏰ 60秒経過、面接官を識別します');
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
        
        // 会話項目を作成
        const message: Message = {
          id: Date.now().toString() + Math.random(),
          text: text.trim(),
          timestamp: new Date().toLocaleTimeString('ja-JP'),
          speaker: speakerRole,
          originalSpeaker: speaker, // 元の話者情報を保存
          isFinal
        };
        
        console.log(`📋 会話項目作成: originalSpeaker="${speaker}", speaker="${speakerRole}", isFinal=${isFinal}`);
        
        setConversation(prev => {
          const lastIndex = prev.length - 1;
          
          // 最後のエントリと同じspeakerかチェック
          if (lastIndex >= 0 && prev[lastIndex].originalSpeaker === speaker) {
            const lastEntry = prev[lastIndex];
            
            // 前のエントリがfinalの場合
            if (lastEntry.isFinal) {
              // 新しいutteranceとして追加
              console.log(`  + 新しいutterance [${prev.length}], speaker=${speaker}, isFinal=${isFinal}`);
              return [...prev, message];
            } else {
              // 前のエントリがnon-finalの場合は更新
              console.log(`  ↻ utteranceを更新 [${lastIndex}], isFinal=${isFinal}`);
              const updated = [...prev];
              updated[lastIndex] = message;
              return updated;
            }
          }
          
          // 異なるspeakerまたは最初のエントリ → 新規追加
          console.log(`  + 新しい会話エントリ [${prev.length}], speaker=${speaker}, isFinal=${isFinal}`);
          return [...prev, message];
        });
        
        // 話している状態を更新
        if (!isFinal) {
          setCurrentSpeaker(speakerRole);
          setCurrentOriginalSpeaker(speaker); // 原始speaker IDも保存
        } else {
          setCurrentSpeaker(null);
          setCurrentOriginalSpeaker(null);
        }
        
        // 識別完了後、最終結果で面接官の発言の場合のみLLM処理
        const shouldCheckLLM = !isIdentifyingRef.current && isFinal && text.trim();
        console.log(`🔍 LLM処理条件チェック: isIdentifying=${isIdentifyingRef.current}, isFinal=${isFinal}, hasText=${!!text.trim()}, shouldCheck=${shouldCheckLLM}`);
        
        if (shouldCheckLLM) {
          // refから最新の面接官情報を取得
          const currentInterviewer = interviewerSpeakerRef.current;
          console.log(`🔍 詳細チェック: speaker=${speaker}, interviewer=${currentInterviewer}, match=${speaker === currentInterviewer}`);
          
          if (currentInterviewer && speaker === currentInterviewer) {
            lastInterviewerQuestionRef.current = text.trim();
            console.log('💬 ✅ 面接官の質問を検出、AI回答生成開始:', text.trim().substring(0, 50) + '...');
            generateSuggestion(text.trim());
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
        handleStopRecording();
      };

      sonioxService.onConnected = () => {
        console.log('✅ Soniox接続成功');
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

      // 音声キャプチャを設定
      audioCaptureService.onAudioData = (audioData: Float32Array) => {
        sonioxService.sendAudio(audioData);
      };

      audioCaptureService.onError = (errorMsg: string) => {
        console.error('❌ 音声キャプチャエラー:', errorMsg);
        setError(`音声エラー: ${errorMsg}`);
        handleStopRecording();
      };

      // 音声キャプチャを開始
      // 注意: システムオーディオをキャプチャするため、echo/noise suppressionは内部で無効化されます
      await audioCaptureService.start({
        sampleRate: 24000,
        echoCancellation: false, // システムオーディオをキャプチャするため無効化
        noiseSuppression: false,  // システムオーディオをキャプチャするため無効化
        autoGainControl: true
      });
      
      setIsRecording(true);
      console.log('✅ 録音開始完了');
    } catch (err) {
      console.error('❌ 録音の開始に失敗しました:', err);
      setError(err instanceof Error ? err.message : 'マイクへのアクセスが拒否されました');
      handleStopRecording();
    }
  };

  const handleStopRecording = () => {
    console.log('🛑 録音停止...');
    
    // 音声キャプチャを停止
    audioCaptureService.stop();
    
    // Soniox接続を終了
    if (sonioxService.isConnected()) {
      sonioxService.finalize();
      sonioxService.disconnect();
    }
    
    setIsRecording(false);
    setCurrentSpeaker(null);
    setCurrentOriginalSpeaker(null);
    
    console.log('✅ 録音停止完了');
  };

  const generateSuggestion = async (question: string) => {
    setIsGenerating(true);
    
    try {
      console.log('🤔 回答生成中:', question);
      
      // まず、回答が必要な質問かどうかを判断
      const needsAnswer = await checkIfQuestionNeedsAnswer(question);
      if (!needsAnswer) {
        console.log('⏭️ 質問ではないためスキップ:', question.substring(0, 50));
        setIsGenerating(false);
        return;
      }
      
      // LLMに直接質問を送り、面接稿の確認から回答生成まで一括処理
      console.log('🤖 LLMで回答生成開始（面接稿の確認を含む）');
      const answer = await generateAIAnswer(question);
      const source: 'script' | 'generated' = 'script'; // LLMが判断するので常にscriptとして扱う
      
      const newSuggestion: Suggestion = {
        id: Date.now().toString(),
        question,
        answer,
        source,
        timestamp: new Date().toLocaleTimeString('ja-JP')
      };
      
      setSuggestions(prev => [newSuggestion, ...prev.slice(0, settings.displaySettings.historyLimit - 1)]);
    } catch (err) {
      console.error('❌ 回答の生成に失敗しました:', err);
      setError('回答生成エラー: ' + (err instanceof Error ? err.message : '不明なエラー'));
    } finally {
      setIsGenerating(false);
    }
  };

  const checkIfQuestionNeedsAnswer = async (text: string): Promise<boolean> => {
    try {
      const systemPrompt = `あなたは面接のアシスタントです。面接官の発言が、候補者の回答を必要とする質問かどうかを判断してください。

【回答が必要な質問の例】
- 具体的な情報や説明を求める質問
- 「〇〇について教えてください」
- 「どのような経験がありますか」
- 「なぜ〇〇だと思いますか」

【回答が不要な発言の例】
- 「ありがとうございます」「そうなんですね」などの相槌や確認
- 「では次に〜」などの話題の移行のみ
- 「〜と思います」などの面接官の意見表明やアドバイス
- 単なる感想や励まし

質問かどうかを判断し、「はい」または「いいえ」のみで答えてください。`;

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `面接官の発言:\n${text}\n\nこれは候補者の回答を必要とする質問ですか？` }
      ];

      const answer = await llmService.generateResponse(messages);
      const isQuestion = answer.trim().includes('はい') || answer.trim().toLowerCase().includes('yes');
      
      console.log(`🔍 質問判定: "${text.substring(0, 30)}..." → ${isQuestion ? '質問' : '非質問'}`);
      return isQuestion;
    } catch (err) {
      console.error('❌ 質問判定エラー:', err);
      // エラー時は安全のため質問として扱う
      return true;
    }
  };

  const generateAIAnswer = async (question: string): Promise<string> => {
    const systemPrompt = buildSystemPrompt(preparationData, settings.aiSettings);
    
    // デバッグ: System Promptの一部を表示
    console.log('🤖 System Promptを使用中...');
    console.log('📋 履歴書:', preparationData.resume.text ? `✅ 使用可能 (${preparationData.resume.text.length}文字)` : '❌ テキストなし');
    console.log('📋 職務経歴書:', preparationData.careerHistory.text ? `✅ 使用可能 (${preparationData.careerHistory.text.length}文字)` : '❌ テキストなし');
    console.log('📋 応募職種:', preparationData.position.text ? `✅ 使用可能 (${preparationData.position.text.length}文字)` : '❌ テキストなし');
    console.log('📋 面接稿:', preparationData.interviewScript.text ? `✅ 使用可能 (${preparationData.interviewScript.text.length}文字)` : '❌ テキストなし');
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: `面接官の質問: ${question}\n\n5W1H原則に基づいて、自然で簡潔な日本語で回答を生成してください。`
      }
    ];
    
    const answer = await llmService.generateResponse(messages);
    return answer;
  };

  // フォントサイズのクラスを取得
  const getFontSizeClasses = () => {
    switch (settings.displaySettings.fontSize) {
      case 'small': return 'text-xs';
      case 'large': return 'text-base';
      default: return 'text-sm';
    }
  };
  
  // テーマに応じたクラスを取得
  const isDark = settings.displaySettings.theme === 'dark';
  const themeClasses = {
    bg: isDark ? 'bg-gray-900' : 'bg-gray-50',
    bgCard: isDark ? 'bg-gray-800' : 'bg-white',
    bgHover: isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100',
    border: isDark ? 'border-gray-700' : 'border-gray-200',
    text: isDark ? 'text-gray-100' : 'text-gray-900',
    textMuted: isDark ? 'text-gray-400' : 'text-gray-500',
    textLabel: isDark ? 'text-gray-300' : 'text-gray-700'
  };

  return (
    <div className={`flex flex-col h-full ${themeClasses.bg}`}>
      {/* Header */}
      <div className={`${themeClasses.bgCard} border-b ${themeClasses.border} px-6 py-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className={`text-lg font-semibold ${themeClasses.text}`}>面接中 - {preparationData.company}</h1>
            <p className={`text-xs ${themeClasses.textMuted}`}>{preparationData.position.text || '応募職種'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onBackToWelcome}
            className={`px-4 py-2 text-sm ${themeClasses.textLabel} ${themeClasses.bgHover} rounded-lg transition-colors`}
          >
            準備画面に戻る
          </button>
          <button
            onClick={onOpenSettings}
            className={`p-2 ${themeClasses.bgHover} rounded-lg transition-colors`}
          >
            <Settings className={`w-5 h-5 ${themeClasses.textLabel}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Conversation History */}
        <div className={`flex-1 flex flex-col border-r ${themeClasses.border} ${themeClasses.bgCard}`}>
          <div className={`px-6 py-4 border-b ${themeClasses.border} flex items-center justify-between`}>
            <div>
              <h2 className={`text-sm font-semibold ${themeClasses.text}`}>会話履歴</h2>
              <p className={`text-xs ${themeClasses.textMuted} mt-1`}>Conversation History</p>
            </div>
            <div className="flex items-center gap-2">
              {isRecording && isActuallyIdentifying && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 rounded-full border border-yellow-200">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                  <span className="text-xs font-medium text-yellow-700">面接官を識別中...</span>
                </div>
              )}
              {isRecording && !isIdentifying && interviewerSpeaker && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-full border border-green-200">
                  <span className="text-xs font-medium text-green-700">
                    面接官: {interviewerSpeaker === 'spk1' ? 'Speaker 1' : 'Speaker 2'}
                  </span>
                </div>
              )}
              {isRecording && currentSpeaker && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-full border border-red-200">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-xs font-medium text-red-700">
                    {isIdentifying ? (
                      // 識別中は "Speaker 1が話しています" と表示
                      currentOriginalSpeaker === 'spk1' ? 'Speaker 1が話しています' :
                      currentOriginalSpeaker === 'spk2' ? 'Speaker 2が話しています' :
                      'Speaker が話しています'
                    ) : (
                      // 識別完了後は "面接官" または "あなた"
                      currentSpeaker === 'interviewer' ? '面接官が話しています' : 'あなたが話しています'
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {conversation.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <Mic className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-900 mb-1">準備完了</p>
                <p className="text-sm text-gray-500">「録音開始」をクリックして</p>
                <p className="text-sm text-gray-500">面接を始めましょう</p>
              </div>
            ) : (
              conversation.map(item => (
                <div
                  key={item.id}
                  className={`flex gap-3 ${item.speaker === 'user' ? 'flex-row-reverse' : ''} ${!item.isFinal ? 'opacity-60' : ''}`}
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    item.speaker === 'interviewer' ? 'bg-blue-100' : 'bg-gray-100'
                  }`}>
                    {item.speaker === 'interviewer' ? (
                      <UserCircle className="w-5 h-5 text-blue-600" />
                    ) : (
                      <User className="w-5 h-5 text-gray-600" />
                    )}
                  </div>
                  <div className={`flex-1 ${item.speaker === 'user' ? 'flex justify-end' : ''}`}>
                    <div className={`inline-block max-w-[80%] rounded-2xl px-4 py-3 border ${
                      item.speaker === 'interviewer'
                        ? isDark ? 'bg-blue-900 border-blue-700' : 'bg-blue-50 border-blue-100'
                        : isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-200'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-semibold ${
                          item.speaker === 'interviewer' 
                            ? isDark ? 'text-blue-300' : 'text-blue-700'
                            : isDark ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                          {isIdentifying ? (
                            // 識別中は "Speaker 1", "Speaker 2" と表示
                            item.originalSpeaker === 'spk1' ? 'Speaker 1' : 
                            item.originalSpeaker === 'spk2' ? 'Speaker 2' : 
                            'Speaker ' + (item.originalSpeaker || '').replace('spk', '')
                          ) : (
                            // 識別完了後は "面接官" または "あなた"
                            item.speaker === 'interviewer' ? '面接官' : 'あなた'
                          )}
                        </span>
                        <span className={`text-xs ${themeClasses.textMuted}`}>{item.timestamp}</span>
                        {!item.isFinal && (
                          <span className={`text-xs ${themeClasses.textMuted} ml-auto`}>...</span>
                        )}
                      </div>
                      <p className={`${getFontSizeClasses()} ${themeClasses.text} leading-relaxed whitespace-normal break-words overflow-wrap-anywhere`}>{item.text}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Warning Message */}
          {isRecording && (
            <div className="px-6 py-3 bg-yellow-50 border-t border-yellow-200">
              <p className="text-xs text-yellow-700">
                ⚠️ 注意: 録音を途中で停止すると、面接官の識別情報がリセットされます。面接が終わるまで録音を続けてください。
              </p>
            </div>
          )}
          
          {/* Error Message */}
          {error && (
            <div className="px-6 py-3 bg-red-50 border-t border-red-200">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Recording Controls */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-center gap-4">
              {!isRecording ? (
                <button
                  onClick={handleStartRecording}
                  className="flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm font-medium"
                >
                  <Mic className="w-5 h-5" />
                  <span>録音開始</span>
                </button>
              ) : (
                <button
                  onClick={handleStopRecording}
                  className="flex items-center gap-2 px-8 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors shadow-sm font-medium"
                >
                  <MicOff className="w-5 h-5" />
                  <span>停止</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - AI Suggestions */}
        <div className={`w-[420px] flex flex-col ${isDark ? 'bg-gradient-to-b from-gray-800 to-gray-900' : 'bg-gradient-to-b from-gray-50 to-white'}`}>
          <div className={`px-6 py-4 border-b ${themeClasses.border}`}>
            <h2 className={`text-sm font-semibold ${themeClasses.text}`}>AI回答案</h2>
            <p className={`text-xs ${themeClasses.textMuted} mt-1`}>AI-Generated Suggestions</p>
          </div>
          
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {isGenerating && (
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
                  </div>
                  <span className="text-xs font-medium text-gray-600">AI思考中...</span>
                </div>
              </div>
            )}
            
            {suggestions.length === 0 && !isGenerating ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center mb-4">
                  <Brain className="w-8 h-8 text-blue-600" />
                </div>
                <p className="text-sm font-medium text-gray-900 mb-1">準備完了</p>
                <p className="text-sm text-gray-500">面接官の質問を検出すると</p>
                <p className="text-sm text-gray-500">自動的に回答案を生成します</p>
              </div>
            ) : (
              suggestions.map((suggestion, index) => (
                <div key={suggestion.id} className="space-y-3">
                  <div className={`rounded-lg p-3 border ${
                    isDark ? 'bg-blue-900 border-blue-700' : 'bg-blue-50 border-blue-100'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Volume2 className="w-3.5 h-3.5 text-blue-600" />
                      <span className={`text-xs font-semibold ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>質問</span>
                    </div>
                    <p className={`text-xs ${isDark ? 'text-blue-200' : 'text-blue-900'} leading-relaxed`}>{suggestion.question}</p>
                  </div>
                  
                  <div className={`${themeClasses.bgCard} rounded-xl p-4 shadow-sm border ${themeClasses.border}`}>
                    <div className="flex items-center gap-2 mb-3">
                      {suggestion.source === 'script' ? (
                        <>
                          <BookOpen className="w-4 h-4 text-purple-600" />
                          <span className="text-xs font-semibold text-purple-700">面接稿より</span>
                        </>
                      ) : (
                        <>
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          <span className="text-xs font-semibold text-gray-700">AI生成（5W1H準拠）</span>
                        </>
                      )}
                      <span className={`text-xs ${themeClasses.textMuted} ml-auto`}>{suggestion.timestamp}</span>
                    </div>
                    <p className={`${getFontSizeClasses()} ${themeClasses.text} leading-relaxed whitespace-pre-line`}>
                      {suggestion.answer}
                    </p>
                  </div>
                  
                  {index === 0 && (
                    <div className="rounded-lg p-3 border bg-blue-50 border-blue-200">
                      <div className="flex items-start gap-2">
                        <Copy className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-medium mb-1 text-blue-900">
                            AI回答
                          </p>
                          <ul className="text-xs space-y-0.5 text-blue-700">
                            <li>• この回答を参考にしてください</li>
                            <li>• 自然な流れで伝えましょう</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {index < suggestions.length - 1 && (
                    <div className="border-t border-gray-200 my-4"></div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
