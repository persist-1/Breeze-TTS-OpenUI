import { useRef, useState, useEffect } from "react";
import { Button } from "./ui.tsx";
import { report } from "./store.ts";
export function LiveAudio({ taskId, file }: { taskId: string; file: string }) {
  const [playing, setPlaying] = useState(false);
  const context = useRef<AudioContext | null>(null),
    controller = useRef<AbortController | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    controller.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    void context.current?.close();
    context.current = null;
    setPlaying(false);
  };
  useEffect(
    () => () => {
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      void context.current?.close();
    },
    [taskId, file],
  );
  const start = async () => {
    try {
      const audio = new AudioContext();
      context.current = audio;
      await audio.resume();
      controller.current = new AbortController();
      setPlaying(true);
      let offset = 0,
        next = audio.currentTime;
      const poll = async () => {
        try {
          const res = await fetch(`/api/stream/${taskId}?from=${offset}`, {
            signal: controller.current!.signal,
          });
          if (res.status === 200) {
            const buffer = await res.arrayBuffer(),
              rate = Number(res.headers.get("X-Sample-Rate")),
              pcm = new Int16Array(buffer);
            offset = Number(res.headers.get("X-Next-Offset"));
            const chunk = audio.createBuffer(1, pcm.length, rate),
              channel = chunk.getChannelData(0);
            for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
            const source = audio.createBufferSource();
            source.buffer = chunk;
            source.connect(audio.destination);
            next = Math.max(next, audio.currentTime + 0.06);
            source.start(next);
            next += chunk.duration;
          } else if (res.status !== 204)
            throw Error("实时音频已不可用，请等待完成后试听。");
          if (context.current === audio) timer.current = setTimeout(poll, 200);
        } catch (e) {
          if (context.current === audio) {
            stop();
            if (!(e instanceof DOMException && e.name === "AbortError"))
              report(String(e));
          }
        }
      };
      void poll();
    } catch (e) {
      stop();
      report(String(e));
    }
  };
  return (
    <Button
      icon={playing ? "stop" : "play"}
      onClick={() => (playing ? stop() : void start())}
    >
      {playing ? "停止实时试听" : "实时试听"}
    </Button>
  );
}
