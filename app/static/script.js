const state = {
  isRecording: false,
  hasSentence: false,
  // 再生中のお手本。古い読み上げのイベントで新しい再生の状態を壊さないための目印
  currentUtterance: null,
  // ブラウザ側録音（spec.txt 5-4節）
  mediaRecorder: null,
  mediaStream: null,
  recordedChunks: [],
  // 自分の発音の再生用。録音Blobから作るObjectURL（前回分は録音のたびに解放する）
  myAudioUrl: null,
};

// アクセントごとのお手本の声（spec.txt 5-2節）
// name は say コマンド時代と同じ声。見つからなければ lang で探し、それも無ければブラウザ既定に任せる
const ACCENT_VOICES = {
  us: { name: "Samantha", lang: "en-US" },
  uk: { name: "Daniel", lang: "en-GB" },
  au: { name: "Karen", lang: "en-AU" },
};

const el = {
  tabButtons: document.querySelectorAll(".tab-button"),
  tabPanels: document.querySelectorAll(".tab-panel"),
  btnNextSentence: document.getElementById("btn-next-sentence"),
  btnUseFreeText: document.getElementById("btn-use-free-text"),
  freeInput: document.getElementById("free-input"),
  targetSentence: document.getElementById("target-sentence"),
  btnPlayModel: document.getElementById("btn-play-model"),
  btnRecord: document.getElementById("btn-record"),
  statusIndicator: document.getElementById("status-indicator"),
  resultSection: document.getElementById("result-section"),
  diffTarget: document.getElementById("diff-target"),
  diffSaid: document.getElementById("diff-said"),
  btnPlayMine: document.getElementById("btn-play-mine"),
  btnRetry: document.getElementById("btn-retry"),
};

function getSelectedAccent() {
  return document.querySelector('input[name="accent"]:checked').value;
}

function getSelectedDifficulty() {
  return document.querySelector('input[name="difficulty"]:checked').value;
}

function setStatus(text) {
  if (!text) {
    el.statusIndicator.classList.add("hidden");
    el.statusIndicator.textContent = "";
    return;
  }
  el.statusIndicator.classList.remove("hidden");
  el.statusIndicator.textContent = text;
}

function setSentence(sentence) {
  el.targetSentence.textContent = sentence;
  state.hasSentence = true;
  el.btnPlayModel.disabled = false;
  el.btnRecord.disabled = false;
  el.resultSection.classList.add("hidden");
  el.btnPlayMine.disabled = true;
}

function setControlsEnabled(enabled) {
  document.querySelectorAll('input[name="accent"]').forEach((r) => (r.disabled = !enabled));
  document.querySelectorAll('input[name="difficulty"]').forEach((r) => (r.disabled = !enabled));
  el.tabButtons.forEach((b) => (b.disabled = !enabled));
  el.btnNextSentence.disabled = !enabled;
  el.btnUseFreeText.disabled = !enabled;
  el.btnPlayModel.disabled = !enabled || !state.hasSentence;
  el.btnRetry.disabled = !enabled;
}

el.tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    el.tabButtons.forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    const target = button.dataset.tab;
    el.tabPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== target);
    });
  });
});

el.btnNextSentence.addEventListener("click", async () => {
  const difficulty = getSelectedDifficulty();
  const res = await fetch(`/api/sentence/random?difficulty=${difficulty}`);
  const data = await res.json();
  if (data.sentence) setSentence(data.sentence);
});

el.btnUseFreeText.addEventListener("click", async () => {
  const text = el.freeInput.value.trim();
  if (!text) return;
  const res = await fetch("/api/sentence/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (data.sentence) setSentence(data.sentence);
});

// Chrome等では getVoices() が最初は空リストを返し、声は voiceschanged で非同期に読み込まれる。
// 声が揃う前に読み上げると目的の声が見つからずブラウザ既定の声になる（初回だけお手本が変な音になる問題）。
// そのため、初回の読み上げ前に声の読み込み完了を待つ。
let voicesReadyPromise = null;
function ensureVoicesLoaded() {
  if (voicesReadyPromise) return voicesReadyPromise;
  voicesReadyPromise = new Promise((resolve) => {
    if (window.speechSynthesis.getVoices().length > 0) {
      resolve();
      return;
    }
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve();
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    // voiceschanged が来ないブラウザ向けの保険（一定時間で諦めて既定の声で読む）
    setTimeout(done, 1000);
  });
  return voicesReadyPromise;
}

// getVoices() は読み込み直後に空を返すことがあるため、押下のたびに取得し直す
function pickVoice(accent) {
  const target = ACCENT_VOICES[accent] || ACCENT_VOICES.us;
  const voices = window.speechSynthesis.getVoices();
  const sameLang = (v) => v.lang.replace("_", "-") === target.lang;
  const voice = voices.find((v) => v.name === target.name && sameLang(v)) || voices.find(sameLang) || null;
  return { voice, lang: target.lang };
}

el.btnPlayModel.addEventListener("click", async () => {
  const text = el.targetSentence.textContent.trim();
  if (!text) return;

  // 声の読み込み完了を待つ（初回だけお手本が既定の声で鳴る問題を防ぐ）
  el.btnPlayModel.disabled = true;
  await ensureVoicesLoaded();

  const { voice, lang } = pickVoice(getSelectedAccent());
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  if (voice) utterance.voice = voice;

  const finish = () => {
    if (state.currentUtterance === utterance) {
      state.currentUtterance = null;
      el.btnPlayModel.disabled = false;
    }
  };
  utterance.addEventListener("end", finish);
  utterance.addEventListener("error", (event) => {
    // cancel() による中断は想定内なので、エラー表示はしない
    if (event.error !== "canceled" && event.error !== "interrupted") {
      setStatus("お手本の再生に失敗しました");
    }
    finish();
  });

  window.speechSynthesis.cancel();
  state.currentUtterance = utterance;
  el.btnPlayModel.disabled = true;
  window.speechSynthesis.speak(utterance);
});

function stopModelPlayback() {
  state.currentUtterance = null;
  window.speechSynthesis.cancel();
}

// 録音後、Blobをサーバーへ送って文字起こし・判定してもらう
async function transcribeAndShow(blob) {
  setStatus("判定中...");
  const form = new FormData();
  form.append("audio", blob, "recording.webm");
  try {
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const data = await res.json();
    if (data.diff) {
      renderDiff(data.diff);
      el.resultSection.classList.remove("hidden");
      el.btnPlayMine.disabled = false;
    } else {
      setStatus("判定に失敗しました");
      return;
    }
  } catch (err) {
    setStatus("判定に失敗しました");
    return;
  } finally {
    setControlsEnabled(true);
    el.btnRecord.disabled = false;
  }
  setStatus("");
}

// 録音したチャンクをまとめてBlobにし、自分の発音再生用のURLも用意する
function finalizeRecording() {
  // マイクを解放する（タブの録音インジケータを消す）
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((t) => t.stop());
    state.mediaStream = null;
  }
  const blob = new Blob(state.recordedChunks, {
    type: state.mediaRecorder ? state.mediaRecorder.mimeType : "audio/webm",
  });
  state.mediaRecorder = null;

  // 前回の自分の発音のURLを解放してから差し替える
  if (state.myAudioUrl) URL.revokeObjectURL(state.myAudioUrl);
  state.myAudioUrl = URL.createObjectURL(blob);

  transcribeAndShow(blob);
}

async function startRecording() {
  // お手本が再生途中だとマイクが拾ってしまうため止める
  stopModelPlayback();
  el.resultSection.classList.add("hidden");
  setStatus("");

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    // 許可されなかった/マイクが無い場合。録音は始めず初期状態のまま知らせる
    setStatus("マイクを使用できません（ブラウザのマイク許可を確認してください）");
    return;
  }

  setControlsEnabled(false);
  state.mediaStream = stream;
  state.recordedChunks = [];
  const recorder = new MediaRecorder(stream);
  state.mediaRecorder = recorder;
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) state.recordedChunks.push(e.data);
  });
  // stop() は非同期。全チャンクが出そろう stop イベントでまとめて処理する
  recorder.addEventListener("stop", finalizeRecording);
  recorder.start();

  state.isRecording = true;
  el.btnRecord.textContent = "■ 録音終了";
  el.btnRecord.classList.add("recording");
  el.btnRecord.disabled = false;
}

function stopRecording() {
  el.btnRecord.disabled = true;
  state.isRecording = false;
  el.btnRecord.textContent = "● 録音開始";
  el.btnRecord.classList.remove("recording");
  // 実際の判定は MediaRecorder の stop イベント（finalizeRecording）で行う
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }
}

el.btnRecord.addEventListener("click", () => {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

el.btnRetry.addEventListener("click", () => {
  startRecording();
});

el.btnPlayMine.addEventListener("click", () => {
  if (!state.myAudioUrl) return;
  el.btnPlayMine.disabled = true;
  const audio = new Audio(state.myAudioUrl);
  const reenable = () => (el.btnPlayMine.disabled = false);
  audio.addEventListener("ended", reenable);
  audio.addEventListener("error", reenable);
  audio.play().catch(reenable);
});

function renderDiff(diff) {
  el.diffTarget.innerHTML = "";
  el.diffSaid.innerHTML = "";

  diff.forEach((item) => {
    const targetSpan = document.createElement("span");
    const saidSpan = document.createElement("span");
    targetSpan.classList.add("word");
    saidSpan.classList.add("word");

    if (item.type === "equal") {
      targetSpan.textContent = item.word;
      saidSpan.textContent = item.word;
      targetSpan.classList.add("diff-equal");
      saidSpan.classList.add("diff-equal");
    } else if (item.type === "replace") {
      targetSpan.textContent = item.target;
      saidSpan.textContent = item.said;
      targetSpan.classList.add("diff-old");
      saidSpan.classList.add("diff-new");
    } else if (item.type === "delete") {
      targetSpan.textContent = item.target;
      targetSpan.classList.add("diff-old");
      saidSpan.textContent = "—";
      saidSpan.classList.add("diff-gap");
    } else if (item.type === "insert") {
      targetSpan.textContent = "—";
      targetSpan.classList.add("diff-gap");
      saidSpan.textContent = item.said;
      saidSpan.classList.add("diff-extra");
    }

    el.diffTarget.appendChild(targetSpan);
    el.diffSaid.appendChild(saidSpan);
  });
}
