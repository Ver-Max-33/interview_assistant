import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { X, PlayCircle, StopCircle, Mic, MessageSquare, Brain, CheckCircle, AlertCircle, RefreshCw, Edit3, Save, XCircle } from 'lucide-react';
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');
  
  // 最後の面接官の質問を追跡
  const lastInterviewerQuestionRef = useRef<string>('');
  
  // 面接官の識別状態
  const [interviewerSpeakers, setInterviewerSpeakers] = useState<string[]>([]);
  const interviewerSpeakersRef = useRef<Set<string>>(new Set()); // 最新の面接官集合
  const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);
  const detectedSpeakersRef = useRef<Set<string>>(new Set());
  const [isIdentifying, setIsIdentifying] = useState(true);
  const isIdentifyingRef = useRef<boolean>(true); // refで管理してコールバックで最新値を使用
  const hasIdentifiedRef = useRef<boolean>(false); // 識別済みフラグ
  const startTimeRef = useRef<number>(Date.now());
  const identificationTranscriptsRef = useRef<Array<{ speaker: string; text: string }>>([]);
  const activeTranscriptMapRef = useRef<Record<string, string>>({});
  const lastFinalTranscriptRef = useRef<Record<string, { timestamp: number; messageId: string }>>({});
  const keywords = useMemo(() => {
    const STOPWORDS = new Set([
      'です',
      'ます',
      'こと',
      'ため',
      'ので',
      'よう',
      'この',
      'その',
      'そして',
      'また',
      'など',
      'これ',
      'それ',
      'もの',
      'ように',
      '経験',
      '担当',
      '業務',
      '対応',
      '使用',
      '実施',
      '個人',
      '会社',
      '企業'
    ]);

    const corpus = [
      ...transcripts.map(item => item.text),
      ...llmResponses.map(item => item.answer)
    ]
      .filter(Boolean)
      .join(' ');

    const frequency = new Map<string, number>();
    corpus
      .split(/[\s、，,。．！？?!〜…・\/\\()（）「」『』【】\[\]{}:：;；\-]+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2 && token.length <= 20)
      .filter(token => !STOPWORDS.has(token))
      .forEach(token => {
        const count = frequency.get(token) || 0;
        frequency.set(token, count + 1);
      });

    return Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([token]) => token);
  }, [transcripts, llmResponses]);

  const { keywordRegex, keywordLookup } = useMemo(() => {
    const lookup = new Map<string, string>();
    const tokens = keywords
      .map(token => token.trim())
      .filter(token => token.length > 0);

    tokens.forEach(token => {
      lookup.set(token.toLowerCase(), token);
    });

    if (tokens.length === 0) {
      return { keywordRegex: null as RegExp | null, keywordLookup: lookup };
    }

    const escaped = Array.from(new Set(tokens))
      .sort((a, b) => b.length - a.length)
      .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');

    return {
      keywordRegex: escaped ? new RegExp(`(${escaped})`, 'gi') : null,
      keywordLookup: lookup
    };
  }, [keywords]);

  const renderHighlightedAnswer = useCallback(
    (text: string) => {
      if (!keywordRegex) {
        return text;
      }
      return text.split(keywordRegex).map((part, index) => {
        const normalized = part.toLowerCase();
        if (keywordLookup.has(normalized)) {
          return (
            <mark
              key={`${part}-${index}`}
              className="bg-yellow-200 text-gray-900 px-1 py-0.5 rounded"
            >
              {part}
            </mark>
          );
        }
        return <span key={`${part}-${index}`}>{part}</span>;
      });
    },
    [keywordRegex, keywordLookup]
  );

  const formatSpeakerLabel = useCallback((speakerId: string | null | undefined) => {
    if (!speakerId) {
      return 'Speaker';
    }
    return speakerId.startsWith('spk')
      ? `Speaker ${speakerId.replace('spk', '')}`
      : speakerId;
  }, []);

  useEffect(() => {
    if (!isIdentifying) {
      setElapsedSeconds(60);
      return;
    }

    const interval = window.setInterval(() => {
      const elapsed = Math.min(
        60,
        Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000))
      );
      setElapsedSeconds(elapsed);
    }, 500);

    return () => window.clearInterval(interval);
  }, [isIdentifying]);

  const updateTranscriptRoles = useCallback((identifiedSpeakers: Iterable<string> = []) => {
    const interviewerSet = new Set(Array.from(identifiedSpeakers));
    setTranscripts(prev =>
      prev.map(item => ({
        ...item,
        speaker: interviewerSet.has(item.originalSpeaker) ? 'interviewer' : 'user'
      }))
    );
  }, []);

  // LLMで面接官を識別
  const identifyInterviewer = async () => {
    if (hasIdentifiedRef.current) {
      console.log('✅ 既に識別済みのためスキップ');
      return;
    }

    const transcriptsForIdentification = identificationTranscriptsRef.current;
    if (transcriptsForIdentification.length === 0) {
      console.warn('⚠️ 識別用の転写データがありません');
      return;
    }

    const uniqueSpeakers = Array.from(
      new Set(transcriptsForIdentification.map(t => t.speaker).filter(Boolean))
    );
    if (uniqueSpeakers.length === 0) {
      console.warn('⚠️ 話者情報が取得できませんでした');
      return;
    }

    hasIdentifiedRef.current = true;
    console.log('🔍 LLMで面接官を識別中...', transcriptsForIdentification.length, '件の転写');
    setStatus('面接官を識別中...');

    const questionCount: Record<string, number> = {};
    transcriptsForIdentification.forEach(t => {
      if (!questionCount[t.speaker]) {
        questionCount[t.speaker] = 0;
      }
      if (/[？?]/.test(t.text)) {
        questionCount[t.speaker] += 1;
      }
    });

    const fallbackSpeaker = uniqueSpeakers.reduce((prev, curr) => {
      const prevScore = questionCount[prev] ?? 0;
      const currScore = questionCount[curr] ?? 0;
      if (currScore === prevScore) {
        return prev;
      }
      return currScore > prevScore ? curr : prev;
    }, uniqueSpeakers[0]);

    try {
      const conversationText = transcriptsForIdentification
        .map(t => `${t.speaker}: ${t.text}`)
        .join('\n');

      const prompt = `以下は会話の転写です。話者は ${uniqueSpeakers.join(
        ', '
      )} として識別されています。面接官（質問する側）がどの話者かをすべて特定してください。複数人でも構いません。

会話:
${conversationText}

出力形式: JSONのみで回答してください。例えば {"interviewers":["spk1","spk3"]} のように、面接官と思われる話者IDを "interviewers" 配列に列挙してください。最低でも1名は必ず含めてください。`;

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            'あなたは会話分析の専門家です。面接官に該当する話者をすべてJSONで返してください。応答は必ず {"interviewers":["spk1","spk2"]} のような形式のみで行ってください。'
        },
        { role: 'user', content: prompt }
      ];

      const rawAnswer = await llmService.generateResponse(messages);
      const answer = rawAnswer.trim();
      const jsonMatch = answer.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : answer;
      const parsed = JSON.parse(jsonString);

      const candidates = Array.isArray(parsed?.interviewers) ? parsed.interviewers : [];
      const identified = candidates
        .map((s: unknown) => (typeof s === 'string' ? s.trim() : ''))
        .filter(s => s && uniqueSpeakers.includes(s));

      const finalInterviewers = identified.length > 0 ? identified : [fallbackSpeaker];

      interviewerSpeakersRef.current = new Set(finalInterviewers);
      setInterviewerSpeakers(finalInterviewers);
      updateTranscriptRoles(finalInterviewers);
      setIsIdentifying(false);
      isIdentifyingRef.current = false;
      setElapsedSeconds(60);
      setStatus(
        `面接官識別完了: ${finalInterviewers.map(id => formatSpeakerLabel(id)).join(', ')}`
      );
      setDebugInfo('面接官識別完了');
    } catch (err) {
      console.error('❌ 面接官識別エラー:', err);
      const fallbackList = [fallbackSpeaker];
      interviewerSpeakersRef.current = new Set(fallbackList);
      setInterviewerSpeakers(fallbackList);
      updateTranscriptRoles(fallbackList);
      setIsIdentifying(false);
      isIdentifyingRef.current = false;
      setElapsedSeconds(60);
      setStatus(
        `面接官識別完了: ${formatSpeakerLabel(fallbackSpeaker)} (エラー時デフォルト)`
      );
      setDebugInfo('識別エラー、デフォルト設定適用');
    }
  };

  const toggleInterviewerSpeaker = (speaker: string) => {
    const nextSet = new Set(interviewerSpeakersRef.current);
    if (nextSet.has(speaker)) {
      nextSet.delete(speaker);
      if (nextSet.size === 0) {
        console.warn('⚠️ 少なくとも1人の面接官を選択する必要があります');
        nextSet.add(speaker);
      }
    } else {
      nextSet.add(speaker);
    }

    const nextList = Array.from(nextSet);
    interviewerSpeakersRef.current = nextSet;
    setInterviewerSpeakers(nextList);
    setIsIdentifying(false);
    isIdentifyingRef.current = false;
    hasIdentifiedRef.current = true;
    setElapsedSeconds(60);
    setStatus(
      `面接官識別完了: ${nextList.map(id => formatSpeakerLabel(id)).join(', ')} (手動設定)`
    );
    setDebugInfo('手動で面接官を設定しました');
    updateTranscriptRoles(nextList);
  };

  const handleReidentify = () => {
    const transcriptsForIdentification = transcripts
      .filter(item => item.originalSpeaker && item.isFinal)
      .map(item => ({
        speaker: item.originalSpeaker,
        text: item.text
      }));

    if (transcriptsForIdentification.length < 3) {
      setDebugInfo('再識別には最低3件の確定転写が必要です');
      return;
    }

    identificationTranscriptsRef.current = transcriptsForIdentification;
    hasIdentifiedRef.current = false;
    setInterviewerSpeakers([]);
    interviewerSpeakersRef.current = new Set();
    updateTranscriptRoles([]);
    setIsIdentifying(true);
    isIdentifyingRef.current = true;
    setElapsedSeconds(0);
    setStatus('面接官を再識別中...');
    setDebugInfo('再識別を実行しています');
    identifyInterviewer();
  };

  const beginEditTranscript = (item: TranscriptItem) => {
    setEditingMessageId(item.id);
    setEditedText(item.text);
  };

  const cancelEditTranscript = () => {
    setEditingMessageId(null);
    setEditedText('');
  };

  const saveEditTranscript = () => {
    if (!editingMessageId) return;

    setTranscripts(prev => {
      const updated = prev.map(item =>
        item.id === editingMessageId ? { ...item, text: editedText } : item
      );

      if (isIdentifyingRef.current) {
        identificationTranscriptsRef.current = updated
          .filter(item => item.originalSpeaker)
          .map(item => ({
            speaker: item.originalSpeaker,
            text: item.text
          }));
      }

      return updated;
    });

    setEditingMessageId(null);
    setEditedText('');
  };

  const handleRegenerateResponse = (response: LLMResponseItem) => {
    void handleLLMResponse(response.question, response.id);
  };

  const remainingSeconds = Math.max(0, 60 - Math.floor(elapsedSeconds));

  const handleStartTest = async () => {
    try {
      setError('');
      setStatus('接続中...');
      setDebugInfo('');
      
      // 識別状態をリセット
      setInterviewerSpeakers([]);
      interviewerSpeakersRef.current = new Set();
      setDetectedSpeakers([]);
      detectedSpeakersRef.current = new Set();
      setIsIdentifying(true);
      isIdentifyingRef.current = true; // refもリセット
      hasIdentifiedRef.current = false; // 識別フラグをリセット
      startTimeRef.current = Date.now();
      identificationTranscriptsRef.current = [];
      setElapsedSeconds(0);
      setTranscripts([]);
      setLLMResponses([]);
      setEditingMessageId(null);
      setEditedText('');
      activeTranscriptMapRef.current = {};
      lastFinalTranscriptRef.current = {};
      
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
        const trimmedText = text.trim();
        const interviewerSnapshot = Array.from(interviewerSpeakersRef.current.values());
        console.log(
          `📝 転写受信 [speaker="${speaker}", isFinal=${isFinal}, isIdentifying=${isIdentifyingRef.current}, interviewer=${interviewerSnapshot.join(',') || '未設定'}]:`,
          trimmedText.substring(0, 50)
        );

        if (!speaker) {
          console.warn('⚠️ speaker が空です');
          return;
        }

        if (!detectedSpeakersRef.current.has(speaker)) {
          detectedSpeakersRef.current.add(speaker);
          setDetectedSpeakers(prev => (prev.includes(speaker) ? prev : [...prev, speaker]));
        }

        if (!trimmedText && isFinal) {
          delete activeTranscriptMapRef.current[speaker];
          delete lastFinalTranscriptRef.current[speaker];
          return;
        }

        if (!trimmedText) {
          return;
        }

        if (isIdentifyingRef.current) {
          const elapsedTime = (Date.now() - startTimeRef.current) / 1000;

          if (isFinal) {
            const transcripts = identificationTranscriptsRef.current;
            const lastEntry = transcripts[transcripts.length - 1];
            if (lastEntry && lastEntry.speaker === speaker) {
              transcripts[transcripts.length - 1] = { speaker, text: trimmedText };
            } else {
              transcripts.push({ speaker, text: trimmedText });
            }

            console.log(`🔍 識別データ収集中: ${elapsedTime.toFixed(1)}秒経過, ${transcripts.length}件`);
            setDebugInfo(`識別データ収集中: ${elapsedTime.toFixed(0)}秒/${60}秒`);
          }

          if (elapsedTime >= 60 && identificationTranscriptsRef.current.length >= 3) {
            console.log('⏰ 1分経過、面接官を識別します');
            identifyInterviewer();
          }
        }

        let speakerRole: 'user' | 'interviewer';

        if (interviewerSpeakersRef.current.size > 0) {
          const isMatch = interviewerSpeakersRef.current.has(speaker);
          speakerRole = isMatch ? 'interviewer' : 'user';
          console.log(
            `👤 話者判定 [識別済み]: speaker=${speaker}, 面接官集合=${interviewerSnapshot.join(',')} → role=${speakerRole}`
          );
        } else {
          speakerRole = speaker === 'spk1' ? 'interviewer' : 'user';
          console.log(`👤 話者判定 [識別中]: speaker=${speaker}, 暫定role=${speakerRole}`);
        }

        if (!isFinal && lastFinalTranscriptRef.current[speaker]) {
          delete activeTranscriptMapRef.current[speaker];
          delete lastFinalTranscriptRef.current[speaker];
        }

        let resolvedTranscriptId: string | undefined = activeTranscriptMapRef.current[speaker];

        if (resolvedTranscriptId && isFinal) {
          const finalInfo = lastFinalTranscriptRef.current[speaker];
          if (finalInfo && finalInfo.messageId === resolvedTranscriptId && Date.now() - finalInfo.timestamp > 2000) {
            resolvedTranscriptId = undefined;
            delete activeTranscriptMapRef.current[speaker];
          }
        }

        if (!resolvedTranscriptId && isFinal) {
          const info = lastFinalTranscriptRef.current[speaker];
          if (info && Date.now() - info.timestamp <= 2000) {
            resolvedTranscriptId = info.messageId;
          }
        }

        if (resolvedTranscriptId) {
          const targetId = resolvedTranscriptId;
          setTranscripts(prev =>
            prev.map(item =>
              item.id === targetId
                ? {
                    ...item,
                    text: trimmedText,
                    isFinal
                  }
                : item
            )
          );
        } else {
          const transcript: TranscriptItem = {
            id: `${Date.now()}-${Math.random()}`,
            text: trimmedText,
            timestamp: new Date().toLocaleTimeString('ja-JP'),
            speaker: speakerRole,
            originalSpeaker: speaker,
            isFinal
          };
          resolvedTranscriptId = transcript.id;
          activeTranscriptMapRef.current[speaker] = resolvedTranscriptId;
          setTranscripts(prev => [...prev, transcript]);
        }

        if (!resolvedTranscriptId) {
          return;
        }

        activeTranscriptMapRef.current[speaker] = resolvedTranscriptId;

        if (isFinal) {
          lastFinalTranscriptRef.current[speaker] = {
            timestamp: Date.now(),
            messageId: resolvedTranscriptId
          };
        }

        const shouldCheckLLM = !isIdentifyingRef.current && isFinal && trimmedText.length > 0;
        console.log(`🔍 LLM処理条件チェック: isIdentifying=${isIdentifyingRef.current}, isFinal=${isFinal}, hasText=${trimmedText.length > 0}, shouldCheck=${shouldCheckLLM}`);

        if (shouldCheckLLM) {
          const isInterviewer = interviewerSpeakersRef.current.has(speaker);
          console.log(
            `🔍 詳細チェック: speaker=${speaker}, interviewers=${interviewerSnapshot.join(
              ','
            )}, match=${isInterviewer}`
          );

          if (isInterviewer) {
            lastInterviewerQuestionRef.current = trimmedText;
            console.log(
              '💬 ✅ 面接官の質問を検出、LLM処理開始:',
              trimmedText.substring(0, 50) + '...'
            );
            handleLLMResponse(trimmedText);
          } else {
            console.log(
              `📝 ❌ 非面接官の発言またはインタビュアー未設定: speaker=${speaker}, interviewers=${interviewerSnapshot.join(',')}`
            );
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
    activeTranscriptMapRef.current = {};
    lastFinalTranscriptRef.current = {};
    
    // 識別状態はリセットしない（結果を保持）
    
    console.log('✅ 機能テスト停止完了');
  };

  const handleLLMResponse = async (question: string, replaceId?: string) => {
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
        id: replaceId || Date.now().toString(),
        question,
        answer,
        timestamp: new Date().toLocaleTimeString('ja-JP')
      };
      
      console.log('🤖 LLM応答を状態に追加');
      setLLMResponses(prev => {
        if (replaceId) {
          return prev.map(item => (item.id === replaceId ? response : item));
        }
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
                      面接官: {interviewerSpeakers.length > 0 ? interviewerSpeakers.map(formatSpeakerLabel).join(', ') : '未設定'}
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
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className={`text-sm font-semibold ${themeClasses.text} flex items-center gap-2`}>
                  <MessageSquare className="w-4 h-4" />
                  リアルタイム転写
                </h2>
                <p className={`text-xs ${themeClasses.textMuted} mt-0.5`}>
                  {settings.sttSettings.enableSpeakerDiarization ? '話者分離: 有効' : '話者分離: 無効'}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
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
                {detectedSpeakers.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {detectedSpeakers.map(speakerId => {
                      const isActive = interviewerSpeakers.includes(speakerId);
                      return (
                        <button
                          key={speakerId}
                          onClick={() => toggleInterviewerSpeaker(speakerId)}
                          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                            isActive
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {formatSpeakerLabel(speakerId)} を{isActive ? '面接官から外す' : '面接官に設定'}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={handleReidentify}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  再識別
                </button>
              </div>
            </div>
            {isRunning && isIdentifying && (
              <div className="mt-4">
                <div className="relative w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, (elapsedSeconds / 60) * 100)}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  面接官識別まで {remainingSeconds} 秒
                </p>
              </div>
            )}
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
                {transcripts.map((item) => {
                  const isEditing = editingMessageId === item.id;
                  return (
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
                            formatSpeakerLabel(item.originalSpeaker)
                          ) : item.speaker === 'interviewer' ? (
                            '面接官'
                          ) : (
                            'あなた'
                          )}
                        </span>
                        <span className="text-xs text-gray-400">{item.timestamp}</span>
                        {item.isFinal && (
                          <button
                            onClick={() => beginEditTranscript(item)}
                            className="ml-auto text-xs text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            編集
                          </button>
                        )}
                        {!item.isFinal && (
                          <span className="ml-auto text-xs text-gray-500">...</span>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editedText}
                            onChange={(e) => setEditedText(e.target.value)}
                            className="w-full text-sm border border-blue-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-gray-900"
                            rows={3}
                          />
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={saveEditTranscript}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                              <Save className="w-3.5 h-3.5" />
                              保存
                            </button>
                            <button
                              onClick={cancelEditTranscript}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              キャンセル
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className={`${getFontSize()} ${themeClasses.text} leading-relaxed whitespace-normal break-words overflow-wrap-anywhere`}>
                          {item.text}
                        </p>
                      )}
                    </div>
                  );
                })}
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
                        <button
                          onClick={() => handleRegenerateResponse(response)}
                          className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          再生成
                        </button>
                      </div>
                      <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-line">
                        {renderHighlightedAnswer(response.answer)}
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
