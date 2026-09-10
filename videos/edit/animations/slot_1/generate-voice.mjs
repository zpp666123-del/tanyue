import { readFile, writeFile } from "node:fs/promises";

const apiKey = process.env.FISH_API_KEY;
if (!apiKey) {
  throw new Error("FISH_API_KEY is not available in the current environment.");
}

const text = (await readFile(new URL("./script.txt", import.meta.url), "utf8")).trim();
const response = await fetch("https://api.fish.audio/v1/tts/stream/with-timestamp", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    model: "s2-pro",
  },
  body: JSON.stringify({
    text,
    reference_id: "0f08cacd3e354471a4b94dd00b4cc4a3",
    format: "opus",
    sample_rate: 48000,
    opus_bitrate: 64000,
    latency: "normal",
    chunk_length: 200,
    normalize: true,
    temperature: 0.55,
    top_p: 0.7,
    prosody: {
      speed: 1.05,
      volume: 0,
      normalize_loudness: true,
    },
  }),
});

if (!response.ok || !response.body) {
  const message = await response.text();
  throw new Error(`Fish Audio request failed (${response.status}): ${message}`);
}

const audioChunks = [];
const alignmentByChunk = new Map();
const reader = response.body.getReader();
const decoder = new TextDecoder("utf-8");
let pending = "";

function consumeLine(line) {
  if (!line.startsWith("data: ")) return;
  const event = JSON.parse(line.slice(6));
  if (event.audio_base64) {
    audioChunks.push(Buffer.from(event.audio_base64, "base64"));
  }
  if (event.alignment) {
    alignmentByChunk.set(event.chunk_seq, {
      offset: Number(event.chunk_audio_offset_sec || 0),
      content: event.content || "",
      alignment: event.alignment,
    });
  }
}

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  pending += decoder.decode(value, { stream: true });
  const lines = pending.split(/\r?\n/);
  pending = lines.pop() || "";
  for (const line of lines) consumeLine(line);
}
pending += decoder.decode();
if (pending) consumeLine(pending);

if (audioChunks.length === 0) {
  throw new Error("Fish Audio returned no audio chunks.");
}

const words = [...alignmentByChunk.entries()]
  .sort(([a], [b]) => a - b)
  .flatMap(([, chunk]) =>
    (chunk.alignment.segments || []).map((segment) => ({
      text: segment.text,
      start: Number((chunk.offset + segment.start).toFixed(3)),
      end: Number((chunk.offset + segment.end).toFixed(3)),
    })),
  );

const duration = words.reduce((max, word) => Math.max(max, word.end), 0);
await writeFile(new URL("./narration.opus", import.meta.url), Buffer.concat(audioChunks));
await writeFile(
  new URL("./transcript.json", import.meta.url),
  `${JSON.stringify({ text, duration, words }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({ audioChunks: audioChunks.length, words: words.length, duration }, null, 2));
