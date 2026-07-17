const state = {
  isRecording: false,
  hasSentence: false,
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

el.btnPlayModel.addEventListener("click", async () => {
  el.btnPlayModel.disabled = true;
  const accent = getSelectedAccent();
  await fetch("/api/say", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accent }),
  });
  el.btnPlayModel.disabled = false;
});

async function startRecording() {
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
