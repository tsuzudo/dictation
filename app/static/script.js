const state = {
  isRecording: false,
  hasSentence: false,
  // 再生中のお手本。古い読み上げのイベントで新しい再生の状態を壊さないための目印
  currentUtterance: null,
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

// getVoices() は読み込み直後に空を返すことがあるため、押下のたびに取得し直す
function pickVoice(accent) {
  const target = ACCENT_VOICES[accent] || ACCENT_VOICES.us;
  const voices = window.speechSynthesis.getVoices();
  const sameLang = (v) => v.lang.replace("_", "-") === target.lang;
  const voice = voices.find((v) => v.name === target.name && sameLang(v)) || voices.find(sameLang) || null;
  return { voice, lang: target.lang };
}

el.btnPlayModel.addEventListener("click", () => {
  const text = el.targetSentence.textContent.trim();
  if (!text) return;

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

async function startRecording() {
  // お手本が再生途中だとマイクが拾ってしまうため止める
  stopModelPlayback();
  setControlsEnabled(false);
  el.resultSection.classList.add("hidden");
  setStatus("");
  await fetch("/api/record/start", { method: "POST" });
  state.isRecording = true;
  el.btnRecord.textContent = "■ 録音終了";
  el.btnRecord.classList.add("recording");
  el.btnRecord.disabled = false;
}

async function stopRecording() {
  el.btnRecord.disabled = true;
  setStatus("判定中...");
  const res = await fetch("/api/record/stop", { method: "POST" });
  const data = await res.json();
  setStatus("");
  state.isRecording = false;
  el.btnRecord.textContent = "● 録音開始";
  el.btnRecord.classList.remove("recording");
  setControlsEnabled(true);

  if (data.diff) {
    renderDiff(data.diff);
    el.resultSection.classList.remove("hidden");
    el.btnPlayMine.disabled = false;
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

el.btnPlayMine.addEventListener("click", async () => {
  el.btnPlayMine.disabled = true;
  await fetch("/api/playback/mine", { method: "POST" });
  el.btnPlayMine.disabled = false;
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
