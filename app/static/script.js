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
  // 新しい出題ではまだ一度も録音していないので「録音開始」表示に戻す
  el.btnRecord.textContent = "● 録音開始";
  el.btnRecord.classList.remove("recording");
  state.isRecording = false;
}

function setControlsEnabled(enabled) {
  document.querySelectorAll('input[name="accent"]').forEach((r) => (r.disabled = !enabled));
  document.querySelectorAll('input[name="difficulty"]').forEach((r) => (r.disabled = !enabled));
  el.tabButtons.forEach((b) => (b.disabled = !enabled));
  el.btnNextSentence.disabled = !enabled;
  el.btnUseFreeText.disabled = !enabled;
  el.btnPlayModel.disabled = !enabled || !state.hasSentence;
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

// （2026-07-20）サーバーは利用者ごとの状態を持たないため、直近の出題履歴は
// ブラウザ側で保持し、出題のたびにサーバーへ送って除外してもらう（spec.txt 5-6節）。
// sessionStorageに置くのでタブを閉じるとリセットされる
const RECENT_KEY = "dictation.recentSentences";
const RECENT_LIMIT = 10;

function loadRecentSentences() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RECENT_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch (err) {
    return [];
  }
}

function rememberSentence(sentence) {
  const recent = loadRecentSentences();
  recent.push(sentence);
  // 古いものから溢れさせて直近RECENT_LIMIT件だけ残す
  try {
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(-RECENT_LIMIT)));
  } catch (err) {
    // プライベートブラウズ等で保存できない場合は重複回避を諦める（出題自体は続行）
  }
}

el.btnNextSentence.addEventListener("click", async () => {
  const res = await fetch("/api/sentence/random", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      difficulty: getSelectedDifficulty(),
      recent: loadRecentSentences(),
    }),
  });
  const data = await res.json();
  if (data.sentence) {
    rememberSentence(data.sentence);
    setSentence(data.sentence);
  }
});

el.btnUseFreeText.addEventListener("click", () => {
  // 自由入力の文はサーバーに知らせる必要がない（録音送信時に一緒に送る）。
  // 従来の /api/sentence/custom は廃止した
  const text = el.freeInput.value.trim();
  if (!text) return;
  setSentence(text);
});

// Chrome等では getVoices() が最初は空リストを返し、声は voiceschanged で非同期に読み込まれる。
// 声が揃う前に読み上げると目的の声が見つからずブラウザ既定の声になる（初回だけお手本が変な音になる問題）。
// そのため、初回の読み上げ前に声の読み込み完了を待つ。
// （2026-07-20修正）「リストが1つでもあれば完了」では不十分だった。Chromeは
// まずローカルの声だけを返し、その後 voiceschanged でネットワーク経由の声を
// 追加で読み込む。1段目の時点で完了と判断すると目的の声がまだ無く、既定の声に
// フォールバックしてしまう（初回だけお手本が変な音になる問題の再発）。
// そこで「対応アクセント3つ分の言語が揃うまで」待つようにする。
const VOICES_TIMEOUT_MS = 3000;
let voicesReadyPromise = null;

// 3アクセント（en-US/en-GB/en-AU）すべての声が出揃ったか
function accentVoicesAvailable() {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return false;
  return Object.values(ACCENT_VOICES).every((target) =>
    voices.some((v) => v.lang.replace("_", "-") === target.lang)
  );
}

function ensureVoicesLoaded() {
  if (voicesReadyPromise) return voicesReadyPromise;
  voicesReadyPromise = new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", onChanged);
      clearInterval(timer);
      // 声が1つも取れないまま時間切れになった場合は、次回もう一度待ち直せるようにする
      if (window.speechSynthesis.getVoices().length === 0) voicesReadyPromise = null;
      resolve();
    };
    const onChanged = () => {
      if (accentVoicesAvailable()) finish();
    };
    // 揃わないブラウザ（en-AUが無い等）向けの保険。時間切れなら既定の声で読む
    const timer = setInterval(() => {
      if (accentVoicesAvailable() || Date.now() - startedAt > VOICES_TIMEOUT_MS) finish();
    }, 100);
    window.speechSynthesis.addEventListener("voiceschanged", onChanged);
    if (accentVoicesAvailable()) finish();
  });
  return voicesReadyPromise;
}

// ボタンを押してから読み込み始めるのでは間に合わないため、ページ表示の時点で
// 声の読み込みを先行させておく（押した時にはすでに揃っている状態にする）
ensureVoicesLoaded();

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
  // 出題文を録音と一緒に送る。サーバーが出題文を覚えないので、
  // 同時に複数人が使っても他人の文と比較されることがない（spec.txt 5-6節）
  form.append("target", el.targetSentence.textContent.trim());
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
  // 一度録音した後は再録音できるよう「再度録音」表示にする（次の出題で「録音開始」へ戻す）
  el.btnRecord.textContent = "● 再度録音";
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

    // （2026-07-20修正）単語spanの間に空白文字が無いと、ブラウザは行全体を
    // 折り返せない1単語とみなし、長い文でアプリの枠をはみ出す。単語の区切りは
    // CSSのmargin-rightで付けているため、幅を増やさない<wbr>（折り返し可能位置）
    // を挟んで改行できるようにする
    el.diffTarget.appendChild(document.createElement("wbr"));
    el.diffSaid.appendChild(document.createElement("wbr"));
  });
}
