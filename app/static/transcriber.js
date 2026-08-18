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

// 【バージョンを4系に上げないこと】4.0.1 / 4.1.0 / 4.2.0 では、同梱のONNX Runtimeが
// WASMバックエンドで量子化モデル（q8/q4）を読めない：
//   Can't create a session. qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
//                           Missing required scale: model.decoder.embed_
// WebGPUが使える環境では読めてしまうため気づきにくいが、WebGPU非対応の環境では
// 「モデルを読み込めません」になる（2026-08-18に実機で発生・spec.txt 9-4節）。
// 3.8.1はWebGPU・WASMのどちらでもq8を読める。上げる場合は必ずWASM経路を実機で確認すること。
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

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

  // 【device は wasm に固定する。webgpu へ変えないこと】
  // 2026-08-18に全組み合わせを実機で確認した結果（spec.txt 9-4節）：
  //   v4.2.0 + webgpu + q8 … 動く（5〜6秒）が、WebGPU非対応の環境では使えない
  //   v4.2.0 + wasm  + q8 … モデルを読めない（ONNX Runtimeのエラー）
  //   v4.2.0 + wasm  + fp32… 動くが61.9秒・約150MBと重い
  //   v3.8.1 + webgpu + q8 … 読み込めるが【出力が壊れる】（無意味な文字列を返す）
  //   v3.8.1 + wasm  + q8 … 8.6秒で正しく動く ← これを採用
  // WASMに固定することで、WebGPUの有無にかかわらず全環境で同じ挙動になる。
  // 速度はWebGPUに劣るが、環境ごとに違う不具合が出るより確実性を取る。
  modelPromise = (async () => {
    const pipe = await pipeline("automatic-speech-recognition", MODEL_ID, {
      device: "wasm",
      dtype: "q8",
      progress_callback: handleProgress,
    });
    modelDevice = "wasm";
    return pipe;
  })();

  // 失敗したら次回やり直せるようにしておく（ネットワーク断からの復帰用）。
  // 原因を追えるよう、握りつぶさずコンソールにも残す
  modelPromise.catch((err) => {
    console.error("モデルの読み込みに失敗しました:", err);
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
