import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Settings,
  UserCircle,
  User,
  Brain,
  Volume2,
  BookOpen,
  Check,
  Copy,
  Zap,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Edit3,
  Save,
  XCircle,
  AlertCircle,
  FileDown,
  Trash2,
  Minimize2,
  Maximize2
} from 'lucide-react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type {
  PreparationData,
  Settings as SettingsType,
  Message,
  Suggestion
} from '../types';
import { sonioxService } from '../services/soniox';
import { llmService, type LLMMessage } from '../services/llm';
import { audioCaptureService } from '../services/audio-capture';
import { scriptMatcher } from '../services/script-matcher';
import { buildSystemPrompt } from '../utils/prompt-builder';
import { storageService } from '../services/storage';
import { extractKeywords } from '../utils/keywords';

const TOKEN_SPLIT_REGEX = /[\s、，,。．！？?!〜…・\/\\()（）「」『』【】\[\]{}:：;；\-]+/;

const tokenizeForMatching = (text: string): string[] =>
  text
    .toLowerCase()
    .split(TOKEN_SPLIT_REGEX)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !/^[0-9０-９]+$/.test(token));

const buildDefaultHeaderSummary = (data: PreparationData): string => {
  const truncate = (value: string, max = 36) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;

  const parts: string[] = [];
  if (data.company) {
    parts.push(truncate(data.company, 32));
  }
  if (data.industry) {
    parts.push(truncate(`${data.industry}業界`, 24));
  }
  if (data.position.text) {
    parts.push(truncate(data.position.text, 40));
  }
    return parts.join(' ｜ ') || '企業情報が未設定です';
};

const COMPACT_CHANNEL_NAME = 'compact-view-channel';

type CompactCommand =
  | 'start-recording'
  | 'pause-recording'
  | 'resume-recording'
  | 'stop-recording'
  | 'close-compact';

type CompactChannelMessage =
  | { type: 'request_state' }
  | { type: 'command'; payload: CompactCommand };

type IdentificationStatus = 'idle' | 'countdown' | 'awaiting_data' | 'identifying' | 'success' | 'failed';

interface CompactStatePayload {
  settings: SettingsType;
  isRecording: boolean;
  isPaused: boolean;
  currentSpeaker: 'interviewer' | 'user' | null;
  currentOriginalSpeaker: string | null;
  interviewerSpeaker: 'spk1' | 'spk2' | null;
  latestMessage: Message | null;
  latestSuggestion: Suggestion | null;
}

type CommandHandlers = {
  start: () => void | Promise<void>;
  pause: () => void | Promise<void>;
  resume: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  close: () => void | Promise<void>;
};

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
  const [isPaused, setIsPaused] = useState(false);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [currentSpeaker, setCurrentSpeaker] = useState<'interviewer' | 'user' | null>(null);
  const [currentOriginalSpeaker, setCurrentOriginalSpeaker] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [interviewerSpeaker, setInterviewerSpeaker] = useState<'spk1' | 'spk2' | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [identificationStatus, setIdentificationStatus] = useState<IdentificationStatus>('idle');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');
  const [companySummary, setCompanySummary] = useState(buildDefaultHeaderSummary(preparationData));
  const [suggestionPanelWidth, setSuggestionPanelWidth] = useState(420);
  const [isCompact, setIsCompact] = useState(false);
  const compactWindowRef = useRef<WebviewWindow | null>(null);
  const compactChannelRef = useRef<BroadcastChannel | null>(null);
  const commandHandlersRef = useRef<CommandHandlers>({
    start: async () => {},
    pause: async () => {},
    resume: async () => {},
    stop: async () => {},
    close: async () => {}
  });

  const lastInterviewerQuestionRef = useRef<string>('');
  const interviewerSpeakerRef = useRef<'spk1' | 'spk2' | null>(null);
  const isIdentifyingRef = useRef<boolean>(true);
  const isActuallyIdentifyingRef = useRef<boolean>(false);
  const hasIdentifiedRef = useRef<boolean>(false);
  const startTimeRef = useRef<number>(Date.now());
  const identificationTranscriptsRef = useRef<Array<{ speaker: string; text: string }>>([]);
  const pauseStartedAtRef = useRef<number | null>(null);
  const pausedDurationRef = useRef<number>(0);
  const activeMessageMapRef = useRef<Record<string, string>>({});
  const lastFinalInfoRef = useRef<Record<string, { timestamp: number; messageId: string }>>({});
  const headerSummaryGeneratedRef = useRef<boolean>(false);

  const keywords = useMemo(() => extractKeywords(preparationData), [preparationData]);

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

  useEffect(() => {
    setCompanySummary(buildDefaultHeaderSummary(preparationData));
    headerSummaryGeneratedRef.current = false;
  }, [preparationData]);

  useEffect(() => {
    headerSummaryGeneratedRef.current = false;
  }, [settings.apiKey, settings.llmSettings.apiKey]);

  const generateCompanySummary = useCallback(async () => {
    if (headerSummaryGeneratedRef.current) {
      return;
    }

    const defaultSummary = buildDefaultHeaderSummary(preparationData);
    const apiKeyForSummary = settings.llmSettings.apiKey || settings.apiKey;
    if (!apiKeyForSummary) {
      setCompanySummary(defaultSummary);
      headerSummaryGeneratedRef.current = true;
      return;
    }

    const outlineLines = [
      `会社名: ${preparationData.company || '未入力'}`,
      `業界: ${preparationData.industry || '未入力'}`,
      `募集職種: ${preparationData.position.text || '未入力'}`,
      preparationData.companyResearch.text
        ? `企業研究メモ: ${preparationData.companyResearch.text.slice(0, 200)}`
        : '企業研究メモ: 未入力'
    ];

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content:
          'あなたは面接アシスタントです。会社情報と候補者情報をもとに、面接画面のヘッダーに表示する要約を40文字程度の日本語で1〜2行にまとめてください。会社名、業界、募集職種、注目ポイントを簡潔に含め、装飾や余計な説明は避けてください。'
      },
      {
        role: 'user',
        content: `${outlineLines.join('\n')}\n\n出力例:\n「ABC株式会社｜ITコンサル｜PM募集｜課題解決に強み」\n条件:\n1. 会社名は先頭に置く\n2. 区切りは全角「｜」などで整える\n3. 40文字程度で自然な日本語にする`
      }
    ];

    try {
      const result = await llmService.generateResponse(messages);
      const cleaned = result.trim().replace(/^['"`\s]+|['"`\s]+$/g, '');
      if (cleaned) {
        setCompanySummary(cleaned);
        headerSummaryGeneratedRef.current = true;
      } else {
        setCompanySummary(defaultSummary);
        headerSummaryGeneratedRef.current = true;
      }
    } catch (error) {
      console.error('❌ 企業サマリー生成に失敗しました:', error);
      setCompanySummary(defaultSummary);
      headerSummaryGeneratedRef.current = true;
    }
  }, [preparationData, settings.apiKey, settings.llmSettings.apiKey]);

  useEffect(() => {
    console.log('📋 面接稿チェック:', {
      type: preparationData.interviewScript.type,
      hasText: !!preparationData.interviewScript.text,
      textLength: preparationData.interviewScript.text?.length || 0
    });

    if (preparationData.interviewScript.type === 'text' && preparationData.interviewScript.text) {
      const apiKey =
        settings.llmSettings.provider === 'openai'
          ? settings.llmSettings.apiKey
          : settings.apiKey;

      scriptMatcher
        .initialize(preparationData.interviewScript.text, apiKey)
        .then(() => console.log('✅ 面接稿の初期化完了'))
        .catch(err => console.error('❌ 面接稿の初期化に失敗しました:', err));
    } else if (preparationData.interviewScript.type === 'file') {
      console.warn('⚠️ PDFアップロードが選択されていますが、内容が読み取られていません');
      console.warn('💡 PDF解析機能は未実装です。「手動入力」を使用してください');
    }

  }, [preparationData, settings]);

  useEffect(() => {
    generateCompanySummary().catch(err => {
      console.error('❌ 企業サマリー生成の自動起動に失敗しました:', err);
    });
  }, [generateCompanySummary]);

  useEffect(() => {
    storageService.clearSession();
  }, []);

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      if (isIdentifyingRef.current) {
        const now = Date.now();
        const pausedDuration =
          pausedDurationRef.current + (pauseStartedAtRef.current ? now - pauseStartedAtRef.current : 0);
        const elapsed = Math.floor((now - startTimeRef.current - pausedDuration) / 1000);
        setElapsedSeconds(Math.min(60, Math.max(0, elapsed)));
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (conversation.length === 0 && suggestions.length === 0 && !interviewerSpeaker) {
      storageService.clearSession();
    }
  }, [conversation.length, suggestions.length, interviewerSpeaker]);

  const updateConversationRoles = useCallback(
    (identifiedSpeaker: 'spk1' | 'spk2' | null) => {
      if (!identifiedSpeaker) {
        return;
      }
      setConversation(prev =>
        prev.map(item => {
          if (!item.originalSpeaker) return item;
          return {
            ...item,
            speaker: item.originalSpeaker === identifiedSpeaker ? 'interviewer' : 'user'
          };
        })
      );
    },
    []
  );

  const identifyInterviewer = useCallback(async () => {
    if (isActuallyIdentifyingRef.current) {
      console.log('⏱️ 面接官識別中のため新規リクエストをスキップ');
      return;
    }

    const transcriptCount = identificationTranscriptsRef.current.length;

    if (hasIdentifiedRef.current) {
      console.log('✅ 既に識別済みのためスキップ', { transcriptCount });
      return;
    }

    if (transcriptCount < 3) {
      console.warn('⚠️ 識別用の転写データが不足しています', { transcriptCount });
      setIdentificationStatus('awaiting_data');
      return;
    }

    const transcriptPreview = identificationTranscriptsRef.current
      .slice(-3)
      .map(item => `${item.speaker}: ${item.text.slice(0, 60)}${item.text.length > 60 ? '…' : ''}`);

    console.log('🔍 LLMで面接官を識別中...', transcriptCount, '件の転写');
    console.log('🗒️ 識別対象の最新サンプル:', transcriptPreview);

    setIdentificationStatus('identifying');
    isActuallyIdentifyingRef.current = true;

    try {
      const conversationText = identificationTranscriptsRef.current
        .map(t => `${t.speaker}: ${t.text}`)
        .join('\n');
      console.log('🧾 conversationText長さ:', conversationText.length);

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
          content:
            'あなたは会話分析の専門家です。会話の転写から面接官を識別してください。回答は「spk1」または「spk2」のみでお願いします。'
        },
        { role: 'user', content: prompt }
      ];

      const answer = await llmService.generateResponse(messages);
      const cleanAnswer = answer.trim().toLowerCase();
      console.log('🤖 LLM識別結果:', answer);
      console.log('🧮 LLM識別結果(clean):', cleanAnswer);

      let identifiedSpeaker: 'spk1' | 'spk2';

      if (cleanAnswer.includes('spk2')) {
        identifiedSpeaker = 'spk2';
      } else {
        identifiedSpeaker = 'spk1';
      }

      hasIdentifiedRef.current = true;
      interviewerSpeakerRef.current = identifiedSpeaker;
      setInterviewerSpeaker(identifiedSpeaker);
      setIsIdentifying(false);
      isIdentifyingRef.current = false;
      isActuallyIdentifyingRef.current = false;
      setElapsedSeconds(60);
      setIdentificationStatus('success');

      console.log('✅ 面接官識別完了', { identifiedSpeaker });

      updateConversationRoles(identifiedSpeaker);
    } catch (err) {
      console.error('❌ 面接官識別エラー:', err);
      hasIdentifiedRef.current = true;
      interviewerSpeakerRef.current = 'spk1';
      setInterviewerSpeaker('spk1');
      setIsIdentifying(false);
      isIdentifyingRef.current = false;
      isActuallyIdentifyingRef.current = false;
      setElapsedSeconds(60);
      setIdentificationStatus('failed');
      updateConversationRoles('spk1');
    }
  }, [updateConversationRoles]);

  const clearSessionState = () => {
    setConversation([]);
    setSuggestions([]);
    setInterviewerSpeaker(null);
    interviewerSpeakerRef.current = null;
    setIsIdentifying(true);
    isIdentifyingRef.current = true;
    isActuallyIdentifyingRef.current = false;
    hasIdentifiedRef.current = false;
    setIdentificationStatus('idle');
    identificationTranscriptsRef.current = [];
    startTimeRef.current = Date.now();
    pausedDurationRef.current = 0;
    pauseStartedAtRef.current = null;
    setElapsedSeconds(0);
    setCurrentSpeaker(null);
    setCurrentOriginalSpeaker(null);
    setIsPaused(false);
    setAudioLevel(0);
    setError('');
    setIsGenerating(false);
    activeMessageMapRef.current = {};
    setCompanySummary(buildDefaultHeaderSummary(preparationData));
    headerSummaryGeneratedRef.current = false;
    lastFinalInfoRef.current = {};
    lastInterviewerQuestionRef.current = '';
    storageService.clearSession();
  };

  const handleStartRecording = async () => {
    try {
      setError('');
      clearSessionState();
      setIdentificationStatus('countdown');

      llmService.setConfig({
        provider: settings.llmSettings.provider,
        apiKey: settings.llmSettings.apiKey,
        model: settings.llmSettings.model,
        temperature: settings.llmSettings.temperature,
        maxTokens: settings.llmSettings.maxTokens
      });

      if (!headerSummaryGeneratedRef.current) {
        generateCompanySummary().catch(err => {
          console.error('❌ 企業サマリー生成エラー:', err);
        });
      }

      startTimeRef.current = Date.now();
      pausedDurationRef.current = 0;
      pauseStartedAtRef.current = null;
      setIsPaused(false);
      setAudioLevel(0);
      activeMessageMapRef.current = {};
      lastFinalInfoRef.current = {};

      sonioxService.onTranscript = (text: string, isFinal: boolean, speaker?: string) => {
        if (!speaker) {
          console.warn('⚠️ speaker が空です');
          return;
        }

        const trimmedText = text.trim();

        if (!trimmedText && isFinal) {
          delete activeMessageMapRef.current[speaker];
          delete lastFinalInfoRef.current[speaker];
          setCurrentSpeaker(null);
          setCurrentOriginalSpeaker(null);
          return;
        }

        if (!trimmedText) {
          return;
        }

        if (isIdentifyingRef.current) {
          const now = Date.now();
          const pausedDuration =
            pausedDurationRef.current +
            (pauseStartedAtRef.current ? now - pauseStartedAtRef.current : 0);
          const elapsed = (now - startTimeRef.current - pausedDuration) / 1000;
          const transcriptLength = identificationTranscriptsRef.current.length;

          if (isFinal) {
            const transcripts = identificationTranscriptsRef.current;
            const lastEntry = transcripts[transcripts.length - 1];
            if (lastEntry && lastEntry.speaker === speaker) {
              transcripts[transcripts.length - 1] = {
                speaker,
                text: trimmedText
              };
            } else {
              transcripts.push({
                speaker,
                text: trimmedText
              });
            }
          }

          if (elapsed >= 60) {
            if (transcriptLength >= 3) {
              identifyInterviewer();
            } else {
              setIdentificationStatus(prev =>
                prev === 'awaiting_data' ? prev : 'awaiting_data'
              );
            }
          }
        }

        let speakerRole: 'user' | 'interviewer';

        if (interviewerSpeakerRef.current) {
          speakerRole =
            speaker === interviewerSpeakerRef.current ? 'interviewer' : 'user';
        } else {
          speakerRole = speaker === 'spk1' ? 'interviewer' : 'user';
        }

        if (!isFinal) {
          if (lastFinalInfoRef.current[speaker]) {
            delete activeMessageMapRef.current[speaker];
            delete lastFinalInfoRef.current[speaker];
          }
        }

        let resolvedMessageId: string | undefined = activeMessageMapRef.current[speaker];

        if (resolvedMessageId && isFinal) {
          const finalInfo = lastFinalInfoRef.current[speaker];
          if (finalInfo && finalInfo.messageId === resolvedMessageId && Date.now() - finalInfo.timestamp > 2000) {
            resolvedMessageId = undefined;
            delete activeMessageMapRef.current[speaker];
          }
        }

        if (!resolvedMessageId && isFinal) {
          const info = lastFinalInfoRef.current[speaker];
          if (info && Date.now() - info.timestamp <= 2000) {
            resolvedMessageId = info.messageId;
          }
        }

        if (resolvedMessageId) {
          const targetId = resolvedMessageId;
          setConversation(prev =>
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
          const newMessage: Message = {
            id: `${Date.now()}-${Math.random()}`,
            text: trimmedText,
            timestamp: new Date().toLocaleTimeString('ja-JP'),
            speaker: speakerRole,
            originalSpeaker: speaker,
            isFinal
          };
          resolvedMessageId = newMessage.id;
          activeMessageMapRef.current[speaker] = resolvedMessageId;
          setConversation(prev => [...prev, newMessage]);
        }

        if (!resolvedMessageId) {
          return;
        }

        activeMessageMapRef.current[speaker] = resolvedMessageId;

        if (!isFinal) {
          setCurrentSpeaker(speakerRole);
          setCurrentOriginalSpeaker(speaker);
        } else {
          setCurrentSpeaker(null);
          setCurrentOriginalSpeaker(null);
          lastFinalInfoRef.current[speaker] = {
            timestamp: Date.now(),
            messageId: resolvedMessageId
          };
        }

        const shouldCheckLLM =
          !isIdentifyingRef.current && isFinal && trimmedText.length > 0;

        if (shouldCheckLLM) {
          const currentInterviewer = interviewerSpeakerRef.current;
          if (currentInterviewer && speaker === currentInterviewer) {
            lastInterviewerQuestionRef.current = trimmedText;
            generateSuggestion(trimmedText);
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

      audioCaptureService.onAudioData = (audioData: Float32Array) => {
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
          sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        const level = Math.min(100, Math.floor(rms * 3000));
        setAudioLevel(level);
        sonioxService.sendAudio(audioData);
      };

      audioCaptureService.onError = (errorMsg: string) => {
        console.error('❌ 音声キャプチャエラー:', errorMsg);
        setError(`音声エラー: ${errorMsg}`);
        handleStopRecording();
      };

      await audioCaptureService.start({
        sampleRate: 24000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true
      });

      setIsRecording(true);
    } catch (err) {
      console.error('❌ 録音の開始に失敗しました:', err);
      setError(err instanceof Error ? err.message : 'マイクへのアクセスが拒否されました');
      handleStopRecording();
    }
  };

const handleStopRecording = () => {
    console.log('🛑 録音停止...');
    audioCaptureService.stop();

    if (sonioxService.isConnected()) {
      sonioxService.finalize();
      sonioxService.disconnect();
    }

    setIsRecording(false);
    clearSessionState();
  };

  const handlePause = () => {
    if (!isRecording || isPaused) return;
    audioCaptureService.pause();
    pauseStartedAtRef.current = Date.now();
    setIsPaused(true);
    setCurrentSpeaker(null);
    setCurrentOriginalSpeaker(null);
    setAudioLevel(0);
    sonioxService.sendKeepalive('pause');
  };

  const handleResume = () => {
    if (!isRecording || !isPaused) return;
    audioCaptureService.resume();
    if (pauseStartedAtRef.current) {
      pausedDurationRef.current += Date.now() - pauseStartedAtRef.current;
    }
    pauseStartedAtRef.current = null;
    setIsPaused(false);
    sonioxService.sendKeepalive('resume');
  };

  const handleResetSession = () => {
    const message = isRecording
      ? '録音を停止してセッションをリセットしますか？\n\n現在の会話とAI回答はすべて削除されます。'
      : 'セッションをリセットしますか？\n\n現在の会話とAI回答はすべて削除されます。';

    if (!window.confirm(message)) {
      return;
    }

    if (isRecording) {
      handleStopRecording();
    }

    clearSessionState();
  };

  const generateSuggestion = async (question: string) => {
    setIsGenerating(true);
    try {
      const needsAnswer = await checkIfQuestionNeedsAnswer(question);
      if (!needsAnswer) {
        setIsGenerating(false);
        return;
      }

      const { answer, source } = await generateAnswerForQuestion(question);

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

  const regenerateSuggestion = async (suggestionId: string, question: string) => {
    setIsGenerating(true);
    try {
      const { answer, source } = await generateAnswerForQuestion(question);
      setSuggestions(prev =>
        prev.map(item =>
          item.id === suggestionId
            ? {
                ...item,
                answer,
                source,
                timestamp: new Date().toLocaleTimeString('ja-JP')
              }
            : item
        )
      );
    } catch (err) {
      console.error('❌ 回答の再生成に失敗しました:', err);
      setError('回答再生成エラー: ' + (err instanceof Error ? err.message : '不明なエラー'));
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
        {
          role: 'user',
          content: `面接官の発言:\n${text}\n\nこれは候補者の回答を必要とする質問ですか？`
        }
      ];

      const answer = await llmService.generateResponse(messages);
      const isQuestion =
        answer.trim().includes('はい') || answer.trim().toLowerCase().includes('yes');
      return isQuestion;
    } catch (err) {
      console.error('❌ 質問判定エラー:', err);
      return true;
    }
  };

  const generateAIAnswer = async (question: string): Promise<string> => {
    const systemPrompt = buildSystemPrompt(preparationData, settings.aiSettings);

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

    return llmService.generateResponse(messages);
  };

  const collectScriptCandidates = useCallback((question: string) => {
    const entries = scriptMatcher.getQAList();
    if (!entries.length) {
      return [] as Array<{ qa: { question: string; answer: string }; score: number }>;
    }

    const questionTokens = new Set(tokenizeForMatching(question));
    const priority = settings.aiSettings.scriptPriority;

    const scored = entries.map(qa => {
      const qaTokens = tokenizeForMatching(qa.question);
      const overlap = qaTokens.filter(token => questionTokens.has(token)).length;
      let score = overlap;
      if (qa.question.replace(/\s+/g, '').includes(question.trim().replace(/\s+/g, ''))) {
        score += 6;
      }
      if (question.trim().replace(/\s+/g, '').includes(qa.question.replace(/\s+/g, ''))) {
        score += 6;
      }
      return { qa, score };
    });

    scored.sort((a, b) => b.score - a.score);

    if (priority === 'exact') {
      const strictMatches = scored.filter(item => {
        const normalizedQuestion = questionTokens;
        const qaTokens = new Set(tokenizeForMatching(item.qa.question));
        const tokenIntersection = [...normalizedQuestion].filter(token => qaTokens.has(token)).length;
        return tokenIntersection >= Math.max(2, Math.min(normalizedQuestion.size, qaTokens.size));
      });
      if (strictMatches.length > 0) {
        return strictMatches.slice(0, 3);
      }
    }

    const filtered = scored.filter(item => item.score > 0).slice(0, 5);
    if (filtered.length > 0) {
      return filtered;
    }
    return scored.slice(0, 3);
  }, [settings.aiSettings.scriptPriority]);

  const generateAnswerForQuestion = useCallback(
    async (question: string): Promise<{ answer: string; source: 'script' | 'generated' }> => {
      const scriptApiKey = settings.llmSettings.apiKey || settings.apiKey;
      if (scriptApiKey) {
        try {
          const threshold = settings.aiSettings.scriptPriority === 'exact' ? 0.97 : 0.84;
          const matchResult = await scriptMatcher.matchQuestion(
            question,
            threshold,
            scriptApiKey,
            settings.aiSettings.scriptPriority
          );

          if (matchResult.match) {
            return { answer: matchResult.match.answer, source: 'script' };
          }
        } catch (error) {
          console.error('❌ 面接稿直接マッチに失敗しました:', error);
        }
      }

      const candidates = collectScriptCandidates(question);
      const candidateSection = candidates
        .map((item, index) => `候補${index + 1}:\n質問: ${item.qa.question}\n回答: ${item.qa.answer}`)
        .join('\n\n');
      const scriptPriority = settings.aiSettings.scriptPriority;

      if (candidates.length === 0) {
        const answer = await generateAIAnswer(question);
        return { answer, source: 'generated' };
      }

      try {
        const messages: LLMMessage[] = [
          {
            role: 'system',
            content:
              'あなたは面接支援AIです。面接官の質問に対して、面接稿の候補回答が適切かを判断し、該当する場合はその回答を採用し、そうでなければ新たに回答を生成します。必ずJSONのみで返答してください。'
          },
          {
            role: 'user',
            content: `面接官の質問:\n${question}\n\n面接稿の候補一覧:\n${candidateSection || '候補なし'}\n\n面接稿の優先度: ${scriptPriority}\n\n出力フォーマット(JSONのみ):\n{\n  "source": "script" または "generated",\n  "answer": "回答",\n  "candidate": 候補番号(スクリプトを使う場合は1以上の整数、使わない場合はnull)\n}\n\n条件:\n1. 候補回答を使う場合は、内容を必要に応じて自然に整えたうえで "source" を "script" にする\n2. 適切な候補がない場合は "source" を "generated" にして新しい回答を生成する\n3. JSON以外の文字は出力しない`
          }
        ];

        const raw = await llmService.generateResponse(messages);
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const parsedSource = parsed.source === 'script' ? 'script' : 'generated';
          let resolvedAnswer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
          if (parsedSource === 'script') {
            const candidateIndex = typeof parsed.candidate === 'number' ? parsed.candidate : null;
            if ((!resolvedAnswer || resolvedAnswer.length === 0) && candidateIndex) {
              const candidate = candidates[candidateIndex - 1];
              if (candidate) {
                resolvedAnswer = candidate.qa.answer;
              }
            }
            if (!resolvedAnswer && candidates.length > 0) {
              resolvedAnswer = candidates[0].qa.answer;
            }
            if (resolvedAnswer) {
              return { answer: resolvedAnswer, source: 'script' };
            }
          } else if (resolvedAnswer) {
            return { answer: resolvedAnswer, source: 'generated' };
          }
        }
      } catch (error) {
        console.error('❌ 面接稿候補判定エラー:', error);
      }

      const fallbackAnswer = await generateAIAnswer(question);
      return { answer: fallbackAnswer, source: 'generated' };
    },
    [
      collectScriptCandidates,
      generateAIAnswer,
      settings.aiSettings.scriptPriority,
      settings.apiKey,
      settings.llmSettings.apiKey
    ]
  );

  const manuallySetInterviewer = (speaker: 'spk1' | 'spk2') => {
    interviewerSpeakerRef.current = speaker;
    setInterviewerSpeaker(speaker);
    setIsIdentifying(false);
    isIdentifyingRef.current = false;
    isActuallyIdentifyingRef.current = false;
    hasIdentifiedRef.current = true;
    setElapsedSeconds(60);
    setIdentificationStatus('success');
    updateConversationRoles(speaker);
  };

  const handleReidentify = () => {
    const transcripts = conversation
      .filter(item => item.originalSpeaker && item.isFinal)
      .map(item => ({
        speaker: item.originalSpeaker as string,
        text: item.text
      }));

    if (transcripts.length < 3) {
      setError('再識別に必要なデータが不足しています。会話をもう少し進めてください。');
      return;
    }

    hasIdentifiedRef.current = false;
    identificationTranscriptsRef.current = transcripts;
    setIsIdentifying(true);
    isIdentifyingRef.current = true;
    isActuallyIdentifyingRef.current = false;
    setInterviewerSpeaker(null);
    interviewerSpeakerRef.current = null;
    setElapsedSeconds(0);
    setIdentificationStatus('countdown');
    startTimeRef.current = Date.now();
    pausedDurationRef.current = 0;
    pauseStartedAtRef.current = null;
    identifyInterviewer();
  };

  const exportConversation = () => {
    if (conversation.length === 0) {
      alert('エクスポートする会話がありません。');
      return;
    }

    const content = conversation
      .filter(item => item.isFinal)
      .map(
        msg =>
          `[${msg.timestamp}] ${msg.speaker === 'interviewer' ? '面接官' : 'あなた'}: ${msg.text}`
      )
      .join('\n\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview_${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const beginEditMessage = (message: Message) => {
    setEditingMessageId(message.id);
    setEditedText(message.text);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditedText('');
  };

  const saveEditMessage = () => {
    if (!editingMessageId) return;

    setConversation(prev => {
      const updated = prev.map(item =>
        item.id === editingMessageId ? { ...item, text: editedText } : item
      );

      if (isIdentifyingRef.current) {
        identificationTranscriptsRef.current = updated
          .filter(item => item.originalSpeaker)
          .map(item => ({
            speaker: item.originalSpeaker as string,
            text: item.text
          }));
      }

      return updated;
    });

    setEditingMessageId(null);
    setEditedText('');
  };

  const handleChangeMessageSpeaker = (messageId: string, newOriginalSpeaker: string) => {
    if (!newOriginalSpeaker) {
      return;
    }

    let shouldTriggerSuggestion = false;
    let pendingQuestionText = '';

    setConversation(prev => {
      const target = prev.find(item => item.id === messageId);
      if (!target) {
        return prev;
      }

      if (target.originalSpeaker === newOriginalSpeaker) {
        return prev;
      }

      const resolvedRole: 'interviewer' | 'user' =
        interviewerSpeakerRef.current != null
          ? interviewerSpeakerRef.current === newOriginalSpeaker
            ? 'interviewer'
            : 'user'
          : newOriginalSpeaker === 'spk1'
          ? 'interviewer'
          : 'user';

      const updated = prev.map(item =>
        item.id === messageId
          ? {
              ...item,
              originalSpeaker: newOriginalSpeaker,
              speaker: resolvedRole
            }
          : item
      );

      identificationTranscriptsRef.current = updated
        .filter(item => item.originalSpeaker)
        .map(item => ({
          speaker: item.originalSpeaker as string,
          text: item.text
        }));

      if (target.originalSpeaker && activeMessageMapRef.current[target.originalSpeaker] === target.id) {
        delete activeMessageMapRef.current[target.originalSpeaker];
      }

      if (
        target.originalSpeaker &&
        lastFinalInfoRef.current[target.originalSpeaker]?.messageId === target.id
      ) {
        delete lastFinalInfoRef.current[target.originalSpeaker];
      }

      if (target.isFinal) {
        lastFinalInfoRef.current[newOriginalSpeaker] = {
          timestamp: Date.now(),
          messageId: target.id
        };
      } else {
        activeMessageMapRef.current[newOriginalSpeaker] = target.id;
      }

      const interviewerId = interviewerSpeakerRef.current;
      if (
        target.isFinal &&
        interviewerId &&
        interviewerId === newOriginalSpeaker &&
        target.text.trim().length > 0 &&
        !suggestions.some(s => s.question === target.text)
      ) {
        shouldTriggerSuggestion = true;
        pendingQuestionText = target.text;
      }

      if (target.isFinal && interviewerId && interviewerId === newOriginalSpeaker) {
        lastInterviewerQuestionRef.current = target.text;
      }

      return updated;
    });

    if (shouldTriggerSuggestion) {
      generateSuggestion(pendingQuestionText);
    }
  };

  const getFontSizeClasses = () => {
    switch (settings.displaySettings.fontSize) {
      case 'small':
        return 'text-xs';
      case 'large':
        return 'text-base';
      default:
        return 'text-sm';
    }
  };

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

  const diarizationSpeakers = useMemo(() => {
    const speakerSet = new Set<string>();
    conversation.forEach(item => {
      if (item.originalSpeaker) {
        speakerSet.add(item.originalSpeaker);
      }
    });
    if (!speakerSet.has('spk1')) {
      speakerSet.add('spk1');
    }
    if (!speakerSet.has('spk2')) {
      speakerSet.add('spk2');
    }
    return Array.from(speakerSet);
  }, [conversation]);

  const formatSpeakerOptionLabel = useCallback(
    (value: string) => {
      if (!value) return 'Speaker';
      const base = value.startsWith('spk') ? `Speaker ${value.replace('spk', '')}` : value;
      if (!interviewerSpeaker) {
        return base;
      }
      return value === interviewerSpeaker ? `面接官 (${base})` : `あなた (${base})`;
    },
    [interviewerSpeaker]
  );

  const broadcastCompactState = useCallback(() => {
    const channel = compactChannelRef.current;
    if (!channel) {
      return;
    }

    const latestMessage =
      conversation.length > 0 ? conversation[conversation.length - 1] : null;
    const latestSuggestion = suggestions.length > 0 ? suggestions[0] : null;

    const payload: CompactStatePayload = {
      settings,
      isRecording,
      isPaused,
      currentSpeaker,
      currentOriginalSpeaker,
      interviewerSpeaker,
      latestMessage,
      latestSuggestion
    };

    channel.postMessage({ type: 'state', payload });
  }, [
    conversation,
    currentOriginalSpeaker,
    currentSpeaker,
    interviewerSpeaker,
    isPaused,
    isRecording,
    settings,
    suggestions
  ]);

  const closeCompactWindow = useCallback(async () => {
    setIsCompact(false);
    const existing =
      compactWindowRef.current ?? (await WebviewWindow.getByLabel('compact-view'));

    if (existing) {
      compactWindowRef.current = existing;
      try {
        await existing.close();
      } catch (error) {
        console.error('❌ コンパクトウィンドウのクローズに失敗しました:', error);
      }
    }

    compactWindowRef.current = null;
  }, []);

  const openCompactWindow = useCallback(async () => {
    setIsCompact(true);
    try {
      const existing = await WebviewWindow.getByLabel('compact-view');
      if (existing) {
        compactWindowRef.current = existing;
        try {
          await existing.show();
          await existing.setFocus();
        } catch (error) {
          console.warn('⚠️ コンパクトウィンドウを前面表示できませんでした:', error);
        }
        broadcastCompactState();
        return;
      }

      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('compactWindow', '1');

      const compact = new WebviewWindow('compact-view', {
        url: currentUrl.toString(),
        width: 380,
        height: 620,
        minWidth: 340,
        minHeight: 520,
        resizable: true,
        decorations: false,
        transparent: true,
        visible: false,
        alwaysOnTop: true
      });

      compactWindowRef.current = compact;

      void compact.once('tauri://created', async () => {
        try {
          await compact.show();
          await compact.setFocus();
        } catch (error) {
          console.warn('⚠️ コンパクトウィンドウの表示に失敗しました:', error);
        }
        broadcastCompactState();
      });

      void compact.once('tauri://destroyed', () => {
        compactWindowRef.current = null;
        setIsCompact(false);
      });

      void compact.once('tauri://error', ({ payload }) => {
        console.error('❌ コンパクトウィンドウの生成に失敗しました:', payload);
        setIsCompact(false);
        compactWindowRef.current = null;
      });
    } catch (error) {
      console.error('❌ コンパクトウィンドウの生成中にエラーが発生しました:', error);
      setIsCompact(false);
      compactWindowRef.current = null;
    }
  }, [broadcastCompactState]);

  useEffect(() => {
    commandHandlersRef.current = {
      start: () => handleStartRecording(),
      pause: () => handlePause(),
      resume: () => handleResume(),
      stop: () => handleStopRecording(),
      close: () => closeCompactWindow()
    };
  }, [handlePause, handleResume, handleStartRecording, handleStopRecording, closeCompactWindow]);

  const handleCompactToggle = useCallback(() => {
    if (isCompact) {
      void closeCompactWindow();
    } else {
      void openCompactWindow();
    }
  }, [isCompact, closeCompactWindow, openCompactWindow]);

  useEffect(() => {
    const channel = new BroadcastChannel(COMPACT_CHANNEL_NAME);
    compactChannelRef.current = channel;

    const handleMessage = (event: MessageEvent<CompactChannelMessage>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }

      if (data.type === 'request_state') {
        broadcastCompactState();
        return;
      }

      if (data.type === 'command') {
        const handlers = commandHandlersRef.current;
        switch (data.payload) {
          case 'start-recording':
            void handlers.start();
            break;
          case 'pause-recording':
            void handlers.pause();
            break;
          case 'resume-recording':
            void handlers.resume();
            break;
          case 'stop-recording':
            void handlers.stop();
            break;
          case 'close-compact':
            void handlers.close();
            break;
          default:
            break;
        }
      }
    };

    channel.addEventListener('message', handleMessage);

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
      compactChannelRef.current = null;
    };
  }, [broadcastCompactState]);

  useEffect(() => {
    if (!isCompact) {
      return;
    }
    broadcastCompactState();
  }, [broadcastCompactState, isCompact]);

  useEffect(() => {
    return () => {
      if (compactWindowRef.current) {
        compactWindowRef.current
          .close()
          .catch(error => console.warn('⚠️ コンパクトウィンドウのクローズに失敗しました:', error));
      }
    };
  }, []);

  const remainingSeconds = Math.max(0, 60 - Math.floor(elapsedSeconds));

  return (
    <div className={`flex flex-col h-full ${themeClasses.bg}`}>
      <div className={`${themeClasses.bgCard} border-b ${themeClasses.border} px-6 py-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className={`text-lg font-semibold ${themeClasses.text}`}>面接セッション</h1>
            <p className={`text-xs ${themeClasses.textMuted}`}>{companySummary}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCompactToggle}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isCompact ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {isCompact ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            {isCompact ? '通常モード' : 'コンパクト'}
          </button>
          <button
            onClick={handleResetSession}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-100 text-red-700 text-sm font-medium hover:bg-red-200 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            リセット
          </button>
          <button
            onClick={exportConversation}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-100 text-blue-700 text-sm font-medium hover:bg-blue-200 transition-colors"
          >
            <FileDown className="w-4 h-4" />
            エクスポート
          </button>
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

      <div className={`flex ${isCompact ? 'flex-col lg:flex-row' : 'flex-row'} flex-1 overflow-hidden`}>
        <div
          className={`flex-1 flex flex-col ${themeClasses.bgCard} ${
            isCompact ? `border-b ${themeClasses.border} lg:border-b-0 lg:border-r` : `border-r ${themeClasses.border}`
          }`}
          style={isCompact ? { minHeight: '260px' } : undefined}
        >
          <div className={`px-6 py-4 border-b ${themeClasses.border}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className={`text-sm font-semibold ${themeClasses.text}`}>会話履歴</h2>
                <p className={`text-xs ${themeClasses.textMuted} mt-1`}>リアルタイム転写とAIサポート</p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {!isCompact && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => manuallySetInterviewer('spk1')}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Speaker 1 は面接官
                    </button>
                    <button
                      onClick={() => manuallySetInterviewer('spk2')}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Speaker 2 は面接官
                    </button>
                  </div>
                )}
                {!isCompact && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 text-gray-700 rounded-lg">
                    <span className="text-xs">AIパネル幅</span>
                    <input
                      type="range"
                      min={320}
                      max={640}
                      step={10}
                      value={suggestionPanelWidth}
                      onChange={(event) => setSuggestionPanelWidth(Number(event.target.value))}
                      className="w-24 accent-blue-500"
                    />
                  </div>
                )}
                <button
                  onClick={handleReidentify}
                  className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    isCompact ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  }`}
                  aria-label="再識別"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {isCompact ? '' : '再識別'}
                </button>
                {isRecording && (
                  <div className="flex items-center gap-2 min-w-[160px] flex-shrink-0 whitespace-nowrap">
                    <Mic className="w-4 h-4 text-blue-600" />
                    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-400 transition-all duration-150"
                        style={{ width: `${audioLevel}%` }}
                      />
                    </div>
                    {!isCompact && (
                      <span className="text-xs text-gray-500 tabular-nums w-10 text-right">
                        {audioLevel}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            {(isRecording && isIdentifying) && (
              <div className="mt-4">
                <div className="relative w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, (elapsedSeconds / 60) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {identificationStatus === 'identifying'
                    ? '面接官を識別中です...'
                    : identificationStatus === 'awaiting_data'
                    ? '面接官識別にはもう少し会話データが必要です'
                    : `面接官識別まで ${remainingSeconds} 秒`}
                </p>
              </div>
            )}
          </div>

          <div className={`px-6 py-3 border-b ${themeClasses.border} flex items-center justify-between`}>
            <div className="flex items-center gap-2 flex-wrap">
              {isRecording && identificationStatus === 'identifying' && (
                <span className="flex items-center gap-2 text-xs px-3 py-1.5 bg-yellow-50 border border-yellow-200 rounded-full text-yellow-700">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                  面接官を識別中...
                </span>
              )}
              {isRecording && identificationStatus === 'awaiting_data' && (
                <span className="flex items-center gap-2 text-xs px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-full text-orange-700">
                  <AlertCircle className="w-3.5 h-3.5" />
                  もう少し会話データが必要です
                </span>
              )}
              {isRecording && identificationStatus === 'failed' && (
                <span className="flex items-center gap-2 text-xs px-3 py-1.5 bg-red-50 border border-red-200 rounded-full text-red-700">
                  <XCircle className="w-3.5 h-3.5" />
                  面接官識別に失敗（仮で{' '}
                  {interviewerSpeaker === 'spk2' ? 'Speaker 2' : 'Speaker 1'} を使用）
                </span>
              )}
              {isRecording && identificationStatus === 'success' && interviewerSpeaker && (
                <span className="flex items-center gap-2 text-xs px-3 py-1.5 bg-green-50 border border-green-200 rounded-full text-green-700">
                  <Check className="w-3.5 h-3.5" />
                  面接官: {interviewerSpeaker === 'spk1' ? 'Speaker 1' : 'Speaker 2'}
                </span>
              )}
              {isRecording && currentSpeaker && (
                <span className="flex items-center gap-2 text-xs px-3 py-1.5 bg-red-50 border border-red-200 rounded-full text-red-700">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  {isIdentifying
                    ? currentOriginalSpeaker === 'spk1'
                      ? 'Speaker 1 が話しています'
                      : currentOriginalSpeaker === 'spk2'
                      ? 'Speaker 2 が話しています'
                      : '話者識別中'
                    : currentSpeaker === 'interviewer'
                    ? '面接官が話しています'
                    : 'あなたが話しています'}
                </span>
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
                <p className="text-sm text-gray-500">「録音開始」をクリックして面接を始めましょう</p>
              </div>
            ) : (
              conversation.map(item => {
                const isEditing = editingMessageId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`flex gap-3 ${item.speaker === 'user' ? 'flex-row-reverse' : ''} ${
                      !item.isFinal ? 'opacity-60' : ''
                    }`}
                  >
                    <div
                      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        item.speaker === 'interviewer' ? 'bg-blue-100' : 'bg-gray-100'
                      }`}
                    >
                      {item.speaker === 'interviewer' ? (
                        <UserCircle className="w-5 h-5 text-blue-600" />
                      ) : (
                        <User className="w-5 h-5 text-gray-600" />
                      )}
                    </div>
                    <div className={`flex-1 ${item.speaker === 'user' ? 'flex justify-end' : ''}`}>
                      <div
                        className={`inline-block max-w-[80%] rounded-2xl px-4 py-3 border ${
                          item.speaker === 'interviewer'
                            ? isDark
                              ? 'bg-blue-900 border-blue-700'
                              : 'bg-blue-50 border-blue-100'
                            : isDark
                            ? 'bg-gray-700 border-gray-600'
                            : 'bg-gray-100 border-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`text-xs font-semibold ${
                              item.speaker === 'interviewer'
                                ? isDark
                                  ? 'text-blue-300'
                                  : 'text-blue-700'
                                : isDark
                                ? 'text-gray-300'
                                : 'text-gray-700'
                            }`}
                          >
                            {isIdentifying
                              ? item.originalSpeaker === 'spk1'
                                ? 'Speaker 1'
                                : item.originalSpeaker === 'spk2'
                                ? 'Speaker 2'
                                : 'Speaker'
                              : item.speaker === 'interviewer'
                              ? '面接官'
                              : 'あなた'}
                          </span>
                          <span className={`text-xs ${themeClasses.textMuted}`}>
                            {item.timestamp}
                          </span>
                          {item.isFinal && (
                            <select
                              value={item.originalSpeaker || ''}
                              onChange={event =>
                                handleChangeMessageSpeaker(item.id, event.target.value)
                              }
                              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              aria-label="話者を変更"
                            >
                              {!item.originalSpeaker && <option value="">未分類</option>}
                              {diarizationSpeakers.map(speakerId => (
                                <option key={speakerId} value={speakerId}>
                                  {formatSpeakerOptionLabel(speakerId)}
                                </option>
                              ))}
                            </select>
                          )}
                          {item.isFinal && (
                            <button
                              onClick={() => beginEditMessage(item)}
                              className="ml-auto text-xs text-blue-600 hover:underline flex items-center gap-1"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              編集
                            </button>
                          )}
                        </div>
                        {isEditing ? (
                          <div className="space-y-2">
                            <textarea
                              value={editedText}
                              onChange={e => setEditedText(e.target.value)}
                              className="w-full text-sm border border-blue-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-gray-900"
                              rows={3}
                            />
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={saveEditMessage}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                              >
                                <Save className="w-3.5 h-3.5" />
                                保存
                              </button>
                              <button
                                onClick={cancelEditMessage}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                キャンセル
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p
                            className={`${getFontSizeClasses()} ${themeClasses.text} leading-relaxed whitespace-pre-wrap break-words`}
                          >
                            {item.text}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {error && (
            <div className="px-6 py-3 bg-red-50 border-t border-red-200">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-center gap-4">
              {!isRecording ? (
                <button
                  onClick={handleStartRecording}
                  className="flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm font-medium"
                >
                  <Mic className="w-5 h-5" />
                  録音開始
                </button>
              ) : (
                <>
                  {!isPaused ? (
                    <button
                      onClick={handlePause}
                      className="flex items-center gap-2 px-5 py-3 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors shadow-sm font-medium"
                    >
                      <PauseCircle className="w-5 h-5" />
                      一時停止
                    </button>
                  ) : (
                    <button
                      onClick={handleResume}
                      className="flex items-center gap-2 px-5 py-3 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-colors shadow-sm font-medium"
                    >
                      <PlayCircle className="w-5 h-5" />
                      再開
                    </button>
                  )}
                  <button
                    onClick={() => handleStopRecording()}
                    className="flex items-center gap-2 px-8 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors shadow-sm font-medium"
                  >
                    <MicOff className="w-5 h-5" />
                    停止
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div
          className={`${
            isCompact
              ? 'flex-shrink-0 w-full mt-4 lg:mt-0 lg:w-auto'
              : 'flex-shrink-0'
          } flex flex-col ${isDark ? 'bg-gradient-to-b from-gray-800 to-gray-900' : 'bg-gradient-to-b from-gray-50 to-white'}`}
          style={isCompact ? { width: '100%', minHeight: '260px' } : { width: `${suggestionPanelWidth}px` }}
        >
          <div className={`px-6 py-4 border-b ${themeClasses.border}`}>
            <h2 className={`text-sm font-semibold ${themeClasses.text}`}>AI回答案</h2>
            <p className={`text-xs ${themeClasses.textMuted} mt-1`}>AI-Generated Suggestions</p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {isGenerating && (
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
                  <div
                    className={`rounded-lg p-3 border ${
                      isDark ? 'bg-blue-900 border-blue-700' : 'bg-blue-50 border-blue-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Volume2 className="w-3.5 h-3.5 text-blue-600" />
                      <span
                        className={`text-xs font-semibold ${
                          isDark ? 'text-blue-300' : 'text-blue-700'
                        }`}
                      >
                        質問
                      </span>
                      <span className="text-xs text-gray-400 ml-auto">{suggestion.timestamp}</span>
                    </div>
                    <p className={`text-xs ${isDark ? 'text-blue-200' : 'text-blue-900'} leading-relaxed`}>
                      {suggestion.question}
                    </p>
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
                          <div className="w-2 h-2 bg-green-500 rounded-full" />
                          <span className="text-xs font-semibold text-gray-700">AI生成（5W1H準拠）</span>
                        </>
                      )}
                      <button
                        onClick={() => regenerateSuggestion(suggestion.id, suggestion.question)}
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1 ml-auto"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        回答を再生成
                      </button>
                    </div>
                    <p className={`${getFontSizeClasses()} ${themeClasses.text} leading-relaxed whitespace-pre-line`}>
                      {renderHighlightedAnswer(suggestion.answer)}
                    </p>
                  </div>

                  {index === 0 && (
                    <div className="rounded-lg p-3 border bg-blue-50 border-blue-200">
                      <div className="flex items-start gap-2">
                        <Copy className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-medium mb-1 text-blue-900">AI回答</p>
                          <ul className="text-xs space-y-0.5 text-blue-700">
                            <li>• この回答を参考にしてください</li>
                            <li>• 自然な流れで伝えましょう</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {index < suggestions.length - 1 && (
                    <div className="border-t border-gray-200 my-4" />
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
