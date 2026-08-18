// ブラウザ内での文字起こし（spec.txt 9-2節）
//
// サーバー側のfaster-whisper（base）を、ブラウザ内のTransformers.js＋Whisper tiny.enへ
// 置き換える。音声は端末外に出ない。
//
// モデルはHugging FaceのCDNから取得する（初回のみ・約40MB。以降はブラウザがキャッシュ）。
// ライブラリ本体もjsDelivrのCDNから読み込むため、リポジトリには同梱しない。
//
// 【重要】このファイルはESモジュール。<script type="module"> で読み込むこと。
// script.js（通常のスクリプト）からは window.Transcriber 経由で呼ぶ。

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

// ブラウザ内蔵のモデルキャッシュを使う（2回目以降のダウンロードを避ける）
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/whisper-tiny.en";
const TARGET_SAMPLE_RATE = 16000; // Whisperが前提とするサンプリングレート

let modelPromise = null;
let modelDevice = null;

/**
 * モデルを読み込む（初回のみ実際にダウンロードが走る）。
 * 何度呼んでも読み込みは1回だけ。録音開始と同時に呼んでおき、
 * 録音終了後に改めてawaitすることで待ち時間を短縮する使い方を想定している。
 *
 * @param {(info: {progress: number, loaded: number, total: number}) => void} onProgress
 */
function ensureModel(onProgress) {
  if (modelPromise) {
    return modelPromise;
  }

  const handleProgress = (info) => {
    if (!onProgress || info.status !== "progress") {
      return;
    }
    onProgress({
      progress: typeof info.progress === "number" ? info.progress : 0,
      loaded: info.loaded || 0,
      total: info.total || 0,
    });
  };

  // WebGPUが使えるなら使う。GitHub PagesではCOOP/COEPヘッダを付けられず
  // WebAssemblyがシングルスレッドになるため（spec.txt 9-2節）、GPUが使えると差が大きい。
  // 使えない環境ではWASMへ自動で切り替える
  modelPromise = (async () => {
    const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
    if (hasWebGPU) {
      try {
        const pipe = await pipeline("automatic-speech-recognition", MODEL_ID, {
          device: "webgpu",
          dtype: "q8",
          progress_callback: handleProgress,
        });
        modelDevice = "webgpu";
        return pipe;
      } catch (err) {
        console.warn("WebGPUでの読み込みに失敗したためWASMへ切り替えます:", err);
      }
    }
    const pipe = await pipeline("automatic-speech-recognition", MODEL_ID, {
      device: "wasm",
      dtype: "q8",
      progress_callback: handleProgress,
    });
    modelDevice = "wasm";
    return pipe;
  })();

  // 失敗したら次回やり直せるようにしておく（ネットワーク断からの復帰用）
  modelPromise.catch(() => {
    modelPromise = null;
  });

  return modelPromise;
}


/**
 * MediaRecorderが出力した音声Blob（webm/opus等・ブラウザ依存）を、
 * Whisperが要求する16kHzモノラルのPCM波形へ変換する。
 * サーバー構成ではffmpegが担っていた工程（spec.txt 5-4節・9-2節）。
 */
async function blobToPcm(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const decodeCtx = new AudioCtx();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    // デコード専用に作ったコンテキストは必ず閉じる（開きっぱなしだと
    // ブラウザの同時オーディオコンテキスト数の上限に当たる）
    decodeCtx.close();
  }

  const frameCount = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  if (frameCount <= 0) {
    return new Float32Array(0);
  }

  // decodeAudioDataのサンプリングレートは端末依存（48kHz等）のため、
  // OfflineAudioContextで16kHzモノラルへ明示的に変換する。
  // 出力チャンネル数を1にすることでステレオ録音も自動でモノラルに混ぜられる
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}


/**
 * 音声Blobを文字起こしする。
 * @returns {Promise<string>} 文字起こし結果
 */
async function transcribe(blob, onProgress) {
  const pipe = await ensureModel(onProgress);
  const audio = await blobToPcm(blob);
  if (audio.length === 0) {
    return "";
  }
  // language/taskは指定しない。tiny.enは英語専用モデルであり、
  // 指定するとエラーになるため（サーバー版のlanguage="en"に相当する役割は
  // モデル自体が担っている）
  const output = await pipe(audio);
  const text = Array.isArray(output) ? output[0].text : output.text;
  return (text || "").trim();
}


window.Transcriber = {
  ensureModel,
  transcribe,
  blobToPcm,
  getDevice: () => modelDevice,
  MODEL_ID,
};

// script.js側が「モジュールの読み込みが済んだか」を待てるようにしておく。
// モジュールは通常スクリプトより後に実行されるため、この合図が無いと
// 読み込み完了前に window.Transcriber を参照してしまう可能性がある
window.dispatchEvent(new Event("transcriber-ready"));
