import { useEffect, useId, useRef, useState } from "react";
import type { Waveform } from "../../../packages/contracts/src/index.ts";
import { request } from "./store.ts";
import { Button } from "./ui.tsx";
let currentAudio: HTMLAudioElement | null = null;
const time = (seconds: number) =>
  Math.floor(seconds / 60) +
  ":" +
  String(Math.floor(seconds % 60)).padStart(2, "0");
export function WaveformPlayer({
  source,
  id,
  label,
  initialDuration = 0,
}: {
  source: "audio" | "reference";
  id: string;
  label: string;
  initialDuration?: number;
}) {
  return (
    <AudioWaveform
      key={`${source}:${id}`}
      source={source}
      id={id}
      label={label}
      initialDuration={initialDuration}
    />
  );
}
function AudioWaveform({
  source,
  id,
  label,
  initialDuration = 0,
}: {
  source: "audio" | "reference";
  id: string;
  label: string;
  initialDuration?: number;
}) {
  const audio = useRef<HTMLAudioElement>(null),
    root = useRef<HTMLDivElement>(null),
    clip = useId().replace(/:/g, ""),
    [visible, setVisible] = useState(false),
    [wave, setWave] = useState<Waveform | null>(null),
    [waveError, setWaveError] = useState(""),
    [audioError, setAudioError] = useState(""),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(initialDuration),
    [loaded, setLoaded] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setWave(null);
    setWaveError("");
    void request<Waveform>(`/api/waveform/${source}/${id}`, {
      signal: controller.signal,
    })
      .then((w) => {
        if (!controller.signal.aborted) {
          setWave(w);
          setDuration(w.duration);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setWaveError(String(e).replace(/^Error: /, ""));
      });
    return () => controller.abort();
  }, [source, id, visible, retry]);
  useEffect(() => {
    const a = audio.current;
    setPosition(0);
    setPlaying(false);
    setLoaded(false);
    return () => {
      if (a === currentAudio) currentAudio = null;
      a?.pause();
    };
  }, [source, id]);
  const play = async () => {
    const a = audio.current!;
    if (!a.paused) {
      a.pause();
      return;
    }
    setAudioError("");
    if (currentAudio && currentAudio !== a) currentAudio.pause();
    currentAudio = a;
    try {
      await a.play();
    } catch {
      setAudioError("音频暂时无法播放，请检查文件后重试。");
      setPlaying(false);
    }
  };
  const restart = () => {
    setAudioError("");
    setLoaded(false);
    audio.current?.load();
    setRetry((n) => n + 1);
  };
  const max = wave?.peak || 1,
    ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <div className="wave-player" ref={root} data-audio-id={id}>
      <audio
        ref={audio}
        src={visible ? `/api/${source}/${id}` : undefined}
        preload="metadata"
        onLoadedMetadata={() => {
          const value = audio.current!.duration;
          if (Number.isFinite(value)) {
            setDuration(value);
            setLoaded(true);
          }
        }}
        onTimeUpdate={() => setPosition(audio.current!.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          if (visible) setAudioError("音频文件无法读取，请检查文件后重试。");
        }}
      />
      <div className="wave-player-main">
        <Button
          icon={playing ? "pause" : "play"}
          aria-label={(playing ? "暂停" : "播放") + label}
          title={playing ? "暂停" : "播放"}
          disabled={!visible || !!audioError}
          onClick={() => void play()}
        />
        <div className="wave-seek">
          {wave ? (
            <svg
              className="waveform"
              viewBox="0 0 400 64"
              preserveAspectRatio="none"
              role="img"
              aria-label={label + "的音频波形"}
            >
              <defs>
                <clipPath id={clip}>
                  <rect width={400 * ratio} height="64" />
                </clipPath>
              </defs>
              {[false, true].map((played) => (
                <g
                  key={String(played)}
                  className={played ? "wave-played" : "wave-unplayed"}
                  clipPath={played ? `url(#${clip})` : undefined}
                >
                  {wave.peaks.map((p, i) => {
                    const height = Math.max(2, (p / max) * 52);
                    return (
                      <rect
                        key={i}
                        x={(i * 400) / wave.peaks.length}
                        y={(64 - height) / 2}
                        width={400 / wave.peaks.length - 1.2}
                        height={height}
                        rx="1"
                      />
                    );
                  })}
                </g>
              ))}
              {ratio > 0 ? (
                <line
                  className="wave-cursor"
                  x1={400 * ratio}
                  x2={400 * ratio}
                  y1="4"
                  y2="60"
                />
              ) : null}
            </svg>
          ) : (
            <div className="wave-loading" role="status">
              {waveError ? "波形暂不可用" : "正在读取波形…"}
            </div>
          )}
          <input
            type="range"
            aria-label={label + "播放位置"}
            aria-valuetext={time(position) + " / " + time(duration)}
            min="0"
            max={duration || 1}
            step=".01"
            value={Math.min(position, duration)}
            disabled={!loaded || !!audioError}
            onChange={(e) => {
              const value = Number(e.target.value);
              audio.current!.currentTime = value;
              setPosition(value);
            }}
          />
        </div>
        <span className="wave-time">
          {time(position)}
          <span> / {time(duration)}</span>
        </span>
      </div>
      {audioError ? (
        <div className="wave-error" role="alert">
          <span>{audioError}</span>
          <Button onClick={restart}>重试</Button>
        </div>
      ) : waveError ? (
        <div className="wave-error">
          <span>波形读取失败，仍可试听。</span>
          <Button onClick={() => setRetry((n) => n + 1)}>重试波形</Button>
        </div>
      ) : null}
    </div>
  );
}
