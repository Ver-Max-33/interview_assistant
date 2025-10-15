import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Zap, Maximize2, Droplet } from 'lucide-react';
import type { Message, Settings as SettingsType, Suggestion } from '../types';

type CompactChannelMessage =
  | { type: 'state'; payload: CompactStatePayload }
  | { type: 'request_state' }
  | { type: 'command'; payload: CompactCommand };

type CompactCommand =
  | 'start-recording'
  | 'pause-recording'
  | 'resume-recording'
  | 'stop-recording'
  | 'close-compact';

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

const CHANNEL_NAME = 'compact-view-channel';
const OPACITY_STORAGE_KEY = 'compact-window-opacity';

export default function CompactWindow() {
  const [state, setState] = useState<CompactStatePayload | null>(null);
  const [opacity, setOpacity] = useState<number>(() => {
    const saved = localStorage.getItem(OPACITY_STORAGE_KEY);
    return saved ? Number(saved) : 0.95;
  });
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    const handleMessage = (event: MessageEvent<CompactChannelMessage>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }

      if (data.type === 'state') {
        setState(data.payload);
      }
    };

    channel.addEventListener('message', handleMessage);
    channel.postMessage({ type: 'request_state' });

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const themeClasses = useMemo(() => {
    const isDark = state?.settings.displaySettings.theme === 'dark';
    return {
      isDark,
      bg: isDark ? 'bg-gray-900/80' : 'bg-white/90',
      border: isDark ? 'border-gray-700/70' : 'border-gray-200/70',
      text: isDark ? 'text-gray-100' : 'text-gray-900',
      textMuted: isDark ? 'text-gray-400' : 'text-gray-500',
      textLabel: isDark ? 'text-gray-300' : 'text-gray-700',
      bgHover: isDark ? 'hover:bg-gray-800/80' : 'hover:bg-gray-100/80'
    };
  }, [state?.settings.displaySettings.theme]);

  const activeSpeaker = useMemo(() => {
    if (!state) {
      return {
        label: '待機中',
        detail: '話者未判定',
        indicatorClass: 'bg-gray-400'
      };
    }

    const role = state.currentSpeaker ?? state.latestMessage?.speaker ?? null;
    const original = state.currentOriginalSpeaker ?? state.latestMessage?.originalSpeaker ?? null;
    const label =
      role === 'interviewer' ? '面接官' : role === 'user' ? 'あなた' : '待機中';

    let detail = '話者未判定';
    if (original) {
      const base = original.startsWith('spk')
        ? `Speaker ${original.replace('spk', '')}`
        : original;
      if (!state.interviewerSpeaker) {
        detail = base;
      } else {
        detail =
          original === state.interviewerSpeaker
            ? `面接官 (${base})`
            : `あなた (${base})`;
      }
    }

    const indicatorClass =
      role === 'interviewer'
        ? 'bg-blue-500'
        : role === 'user'
        ? 'bg-green-500'
        : 'bg-gray-400';

    const latestTimestamp = state.latestMessage?.timestamp ?? '';
    const latestLabel =
      state.latestMessage?.speaker === 'interviewer'
        ? '面接官'
        : state.latestMessage?.speaker === 'user'
        ? 'あなた'
        : '';

    return {
      label,
      detail,
      indicatorClass,
      latestLabel,
      latestTimestamp,
      transcriptText:
        state.latestMessage && state.latestMessage.text.trim().length > 0
          ? state.latestMessage.text
          : '転写はまだありません'
    };
  }, [state, themeClasses.isDark]);

  const aiInfo = useMemo(() => {
    if (!state) {
      return {
        text: 'AIの回答はまだありません',
        sourceLabel: null as string | null,
        timestamp: ''
      };
    }

    const suggestion = state.latestSuggestion;
    const text =
      suggestion && suggestion.answer.trim().length > 0
        ? suggestion.answer
        : 'AIの回答はまだありません';

    const sourceLabel = suggestion
      ? suggestion.source === 'script'
        ? 'スクリプト'
        : 'AI生成'
      : null;

    const timestamp = suggestion?.timestamp ?? '';

    return {
      text,
      sourceLabel,
      timestamp,
      question: suggestion?.question ?? ''
    };
  }, [state]);

  const sendCommand = useCallback(
    (command: CompactCommand) => {
      channelRef.current?.postMessage({ type: 'command', payload: command });
    },
    []
  );

  const handleOpacityChange = useCallback((value: number) => {
    setOpacity(value);
    localStorage.setItem(OPACITY_STORAGE_KEY, value.toString());
  }, []);

  const handleClose = useCallback(() => {
    sendCommand('close-compact');
  }, [sendCommand]);

  return (
    <div className="w-full h-full p-3 bg-transparent">
      <div
        className={`${themeClasses.bg} border ${themeClasses.border} rounded-2xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-xl`}
        style={{ opacity }}
      >
        <div
          className={`px-4 pt-3 pb-2 border-b ${themeClasses.border} flex items-center justify-between gap-3`}
          data-tauri-drag-region
        >
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-500" />
            <div>
              <p className={`text-sm font-semibold ${themeClasses.text}`}>コンパクトビュー</p>
              <p className={`text-xs ${themeClasses.textMuted}`}>話者とAI回答を素早く確認</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className={`p-1.5 rounded-lg ${themeClasses.bgHover}`}
            aria-label="通常モードに戻る"
          >
            <Maximize2 className={`w-4 h-4 ${themeClasses.textLabel}`} />
          </button>
        </div>

        <div className="px-4 py-2 flex items-center gap-3">
          <Droplet className={`w-4 h-4 ${themeClasses.textMuted}`} />
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.05}
            value={opacity}
            onChange={event => handleOpacityChange(Number(event.target.value))}
            className="flex-1 accent-blue-500"
            aria-label="ウィンドウの透明度"
          />
          <span className={`text-xs min-w-[40px] text-right ${themeClasses.textMuted}`}>
            {Math.round(opacity * 100)}%
          </span>
        </div>

        <div className="flex-1 flex flex-col divide-y divide-gray-200/70 dark:divide-gray-700/60">
          <div className="p-4 space-y-2">
            <p className={`text-xs font-semibold uppercase tracking-wide ${themeClasses.textMuted}`}>
              現在の話者
            </p>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex w-2.5 h-2.5 rounded-full ${activeSpeaker.indicatorClass}`}
              />
              <span className={`text-sm font-semibold ${themeClasses.text}`}>
                {activeSpeaker.label}
              </span>
            </div>
            <p className={`text-xs ${themeClasses.textMuted}`}>{activeSpeaker.detail}</p>
            {activeSpeaker.latestLabel && activeSpeaker.latestTimestamp && (
              <p className={`text-xs ${themeClasses.textMuted}`}>
                最新: {activeSpeaker.latestLabel}・{activeSpeaker.latestTimestamp}
              </p>
            )}
          </div>

          <div className="p-4 space-y-3">
            <p className={`text-xs font-semibold uppercase tracking-wide ${themeClasses.textMuted}`}>
              最新の転写
            </p>
            <div
              className={`rounded-xl border px-3 py-2 min-h-[96px] ${
                themeClasses.isDark ? 'bg-gray-800 border-gray-700/60' : 'bg-white border-gray-200/70'
              }`}
            >
              <p
                className={`text-sm leading-relaxed ${themeClasses.text} whitespace-pre-wrap break-words`}
              >
                {activeSpeaker.transcriptText}
              </p>
            </div>
          </div>

          <div
            className={`p-4 space-y-3 ${
              themeClasses.isDark ? 'bg-blue-900/30' : 'bg-blue-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <p
                className={`text-xs font-semibold uppercase tracking-wide ${
                  themeClasses.isDark ? 'text-blue-200' : 'text-blue-700'
                }`}
              >
                AIの回答
              </p>
              {aiInfo.sourceLabel && (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    aiInfo.sourceLabel === 'スクリプト'
                      ? 'bg-green-500/20 text-green-700'
                      : 'bg-blue-500/20 text-blue-700'
                  }`}
                >
                  {aiInfo.sourceLabel}
                </span>
              )}
            </div>
            <div
              className={`rounded-xl border px-3 py-2 min-h-[120px] ${
                themeClasses.isDark
                  ? 'bg-blue-950/40 border-blue-800/60'
                  : 'bg-white border-blue-100'
              }`}
            >
              <p
                className={`text-sm leading-relaxed whitespace-pre-wrap ${
                  themeClasses.isDark ? 'text-gray-100' : 'text-gray-900'
                }`}
              >
                {aiInfo.text}
              </p>
              {aiInfo.timestamp && (
                <p
                  className={`text-xs mt-2 text-right ${
                    themeClasses.isDark ? 'text-blue-200' : 'text-blue-700'
                  }`}
                >
                  {aiInfo.timestamp}
                </p>
              )}
            </div>
            {aiInfo.question && (
              <p className={`text-xs ${themeClasses.isDark ? 'text-blue-200' : 'text-blue-600'}`}>
                Q: {aiInfo.question}
              </p>
            )}
          </div>
        </div>

        <div
          className={`px-4 py-3 border-t ${themeClasses.border} flex items-center justify-between`}
        >
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-flex w-2.5 h-2.5 rounded-full ${
                state?.isRecording
                  ? state.isPaused
                    ? 'bg-yellow-500'
                    : 'bg-green-500 animate-pulse'
                  : 'bg-gray-400'
              }`}
            />
            <span className={themeClasses.textMuted}>
              {state?.isRecording
                ? state.isPaused
                  ? '一時停止中'
                  : '録音中'
                : '待機中'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {state?.isRecording ? (
              <>
                <button
                  onClick={() =>
                    sendCommand(state.isPaused ? 'resume-recording' : 'pause-recording')
                  }
                  className={`px-3 py-1.5 text-xs rounded-lg ${
                    state.isPaused
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                  }`}
                >
                  {state.isPaused ? '再開' : '一時停止'}
                </button>
                <button
                  onClick={() => sendCommand('stop-recording')}
                  className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600"
                >
                  停止
                </button>
              </>
            ) : (
              <button
                onClick={() => sendCommand('start-recording')}
                className="px-4 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                録音開始
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
