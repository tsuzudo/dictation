const state = {
  isRecording: false,
  hasSentence: false,
  // 再生中のお手本。古い読み上げのイベントで新しい再生の状態を壊さないための目印
  currentUtterance: null,
  // ブラウザ側録音（spec.txt 5-4節）
  mediaRecorder: null,
  mediaStream: null,
  recordedChunks: [],
  // あなたの録音の再生用。録音Blobから作るObjectURL（前回分は録音のたびに解放する）
  myAudioUrl: null,
  // 言語切替で出し直せるよう、状態で変わる文言は「文字列」ではなく「キー」で持つ（UI_function.txt 3-9節）
  recordButtonKey: "btn.record",
  statusKey: "",
  // ステータス文言に埋め込む値（モデル読み込みの進捗率など）。
  // 言語を切り替えても出し直せるよう、文字列ではなく値のまま持つ
  statusParams: null,
  // スキット練習（spec.txt 第10章）。一覧にいるときは skit が null
  skit: null,
  skitLineIndex: 0,
  // 「役を選ぶ」モードで練習する役のID。「全台詞」モードでは null
  skitRole: null,
};

// 隣の English_conversation/skit が公開している会話データ（spec.txt 10-1節）。
// **ここだけは絶対URLで書く。** 別サイトのデータなので相対では指せない
// （それ以外のパスは従来どおり相対のままにすること・9-3節）。
// 同じ tsuzudo.github.io なので同一オリジンで、かつ GitHub Pages は
// access-control-allow-origin: * を返すため、手元のローカル配信からも読める。
const SKITS_URL = "https://tsuzudo.github.io/Aussie_English_conversation/skits.json";

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
  langButtons: document.querySelectorAll(".lang-button"),
  // スキット（UI_function.txt 8節）
  skitListView: document.getElementById("skit-list-view"),
  skitList: document.getElementById("skit-list"),
  skitPracticeView: document.getElementById("skit-practice-view"),
  skitTitle: document.getElementById("skit-title"),
  skitProgress: document.getElementById("skit-progress"),
  skitDoneLines: document.getElementById("skit-done-lines"),
  btnBackToList: document.getElementById("btn-back-to-list"),
  btnNextLine: document.getElementById("btn-next-line"),
  btnToggleTranslation: document.getElementById("btn-toggle-translation"),
  translationBox: document.getElementById("translation-box"),
  sentenceSpeaker: document.getElementById("sentence-speaker"),
  skitRoleView: document.getElementById("skit-role-view"),
  skitRoleChoices: document.getElementById("skit-role-choices"),
  btnStartSkit: document.getElementById("btn-start-skit"),
  btnRoleBack: document.getElementById("btn-role-back"),
};

// ===== 日英ローカライズ（spec.txt 5-9節・UI_function.txt 3-9節） =====
// 画面文言はすべてここに集約する。HTML側の data-i18n="キー" を目印に一括で差し替える。
// この対訳表が文言の正。増やすときは en/ja の両方に同じキーを足すこと。
const I18N = {
  en: {
    "app.title": "Dictation - Pronunciation Check",
    "accent.label": "Accent:",
    "accent.us": "US",
    "accent.uk": "UK",
    "accent.au": "AU",
    "tab.random": "Random",
    "tab.free": "Free Input",
    "difficulty.label": "Difficulty:",
    "difficulty.beginner": "Easy",
    "difficulty.intermediate": "Medium",
    "difficulty.advanced": "Hard",
    "btn.nextSentence": "Next Sentence",
    "free.placeholder": "Enter an English sentence to practice",
    "btn.useFreeText": "Use This Sentence",
    "sentence.label": "Sentence:",
    "btn.playModel": "▶ Model",
    "btn.record": "● Record",
    "btn.stop": "■ Stop",
    "btn.recordAgain": "● Record Again",
    "result.heading": "Result",
    "result.target": "Target:",
    "result.said": "You said:",
    "btn.playMine": "▶ Your Recording",
    "status.checking": "Checking...",
    "status.checkFailed": "Check failed",
    "status.loadingModel": "Loading the speech model (first time only, about 40 MB)... {pct}%",
    "status.modelLoadFailed": "Could not load the speech model. Check your connection and try again.",
    "status.sentencesFailed": "Could not load the sentences. Please reload the page.",
    "status.modelFailed": "Failed to play the model audio",
    "status.micUnavailable": "Microphone unavailable. Please check your browser's microphone permission.",
    "tab.skit": "Skit",
    "btn.backToList": "Back to list",
    "btn.nextLine": "Next Line",
    "btn.showTranslation": "▼ Show translation",
    "btn.hideTranslation": "▲ Hide translation",
    "skit.lineCount": "{n} lines",
    "skit.done": "Finished. Well done!",
    "status.skitLoading": "Loading skits...",
    "status.skitFailed": "Could not load the skits. Please try again later.",
    "skit.practiceLabel": "Practice:",
    "skit.allLines": "All lines",
    "skit.oneRole": "One role",
    "skit.chooseRole": "Which role do you want to practice?",
    "btn.startSkit": "Start",
    "status.skitPlaying": "Playing...",
  },
  ja: {
    "app.title": "Dictation - 発音チェック",
    "accent.label": "アクセント：",
    "accent.us": "米",
    "accent.uk": "英",
    "accent.au": "豪",
    "tab.random": "ランダム出題",
    "tab.free": "自由入力",
    "difficulty.label": "難易度：",
    "difficulty.beginner": "初級",
    "difficulty.intermediate": "中級",
    "difficulty.advanced": "上級",
    "btn.nextSentence": "次の文章を出す",
    "free.placeholder": "発音したい英文を入力してください",
    "btn.useFreeText": "この文章で出題",
    "sentence.label": "出題文：",
    "btn.playModel": "▶ お手本",
    "btn.record": "● 録音開始",
    "btn.stop": "■ 録音終了",
    "btn.recordAgain": "● 再度録音",
    "result.heading": "結果",
    "result.target": "出題文：",
    "result.said": "あなたの発音：",
    "btn.playMine": "▶ あなたの録音",
    "status.checking": "判定中...",
    "status.checkFailed": "判定に失敗しました",
    "status.loadingModel": "音声モデルを読み込み中（初回のみ・約40MB）... {pct}%",
    "status.modelLoadFailed": "音声モデルを読み込めませんでした（通信状況を確認してもう一度お試しください）",
    "status.sentencesFailed": "出題文を読み込めませんでした（ページを再読み込みしてください）",
    "status.modelFailed": "お手本の再生に失敗しました",
    "status.micUnavailable": "マイクを使用できません（ブラウザのマイク許可を確認してください）",
    "tab.skit": "スキット",
    "btn.backToList": "一覧へ",
    "btn.nextLine": "次の台詞へ",
    "btn.showTranslation": "▼ 訳・解説を見る",
    "btn.hideTranslation": "▲ 訳・解説を隠す",
    "skit.lineCount": "{n}行",
    "skit.done": "完了。お疲れさまでした",
    "status.skitLoading": "スキットを読み込み中...",
    "status.skitFailed": "スキットを読み込めませんでした（しばらくしてからお試しください）",
    "skit.practiceLabel": "練習方法：",
    "skit.allLines": "全台詞",
    "skit.oneRole": "役を選ぶ",
    "skit.chooseRole": "どちらの役で練習しますか？",
    "btn.startSkit": "練習を始める",
    "status.skitPlaying": "再生中...",
  },
};

const LANG_KEY = "dictation.lang";
const DEFAULT_LANG = "en"; // ブラウザ言語による自動判定はしない（spec.txt 5-9節）
let currentLang = DEFAULT_LANG;

function loadSavedLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && I18N[saved]) return saved;
  } catch (err) {
    // プライベートブラウズ等で読めない場合は既定言語で開く
  }
  return DEFAULT_LANG;
}

// キーから現在の言語の文言を引く。未定義のキーは英語→キー名の順にフォールバックする
function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N[DEFAULT_LANG][key] || key;
}

function applyLanguage(lang) {
  currentLang = I18N[lang] ? lang : DEFAULT_LANG;
  try {
    localStorage.setItem(LANG_KEY, currentLang);
  } catch (err) {
    // 保存できなくても切替自体は成立させる（次回は既定言語に戻る）
  }

  document.documentElement.lang = currentLang;
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });

  // 状態で文言が変わる箇所は、今の状態のまま表示だけ出し直す
  updateRecordButton();
  renderStatus();
  renderSkitUI();

  el.langButtons.forEach((b) => b.classList.toggle("active", b.dataset.lang === currentLang));
}

el.langButtons.forEach((button) => {
  button.addEventListener("click", () => applyLanguage(button.dataset.lang));
});

function getSelectedAccent() {
  return document.querySelector('input[name="accent"]:checked').value;
}

function getSelectedDifficulty() {
  return document.querySelector('input[name="difficulty"]:checked').value;
}

// 引数は文言そのものではなくI18Nのキー（言語を切り替えても出し直せるようにするため）。空文字で非表示。
// paramsを渡すと文言中の {名前} を置き換える（進捗率のように数値が変わるもの用）
function setStatus(key, params) {
  state.statusKey = key || "";
  state.statusParams = params || null;
  renderStatus();
}

function renderStatus() {
  if (!state.statusKey) {
    el.statusIndicator.classList.add("hidden");
    el.statusIndicator.textContent = "";
    return;
  }
  let text = t(state.statusKey);
  if (state.statusParams) {
    Object.keys(state.statusParams).forEach((name) => {
      text = text.replace("{" + name + "}", state.statusParams[name]);
    });
  }
  el.statusIndicator.classList.remove("hidden");
  el.statusIndicator.textContent = text;
}

// 録音ボタンは状態（未録音／録音中／録音済み）で文言が変わるため、キーから毎回引き直す
function updateRecordButton() {
  el.btnRecord.textContent = t(state.recordButtonKey);
}

function setSentence(sentence) {
  el.targetSentence.textContent = sentence;
  state.hasSentence = true;
  el.btnPlayModel.disabled = false;
  el.btnRecord.disabled = false;
  el.resultSection.classList.add("hidden");
  el.btnPlayMine.disabled = true;
  // 新しい出題ではまだ一度も録音していないので「録音開始」表示に戻す
  state.recordButtonKey = "btn.record";
  updateRecordButton();
  el.btnRecord.classList.remove("recording");
  state.isRecording = false;
  // スキットの付加表示（話者名・訳の開閉・次の台詞へ）を初期状態に戻す。
  // スキット以外の出題でも、前の練習の名残を消すために毎回通す
  resetSkitLineExtras();
}

function setControlsEnabled(enabled) {
  document.querySelectorAll('input[name="accent"]').forEach((r) => (r.disabled = !enabled));
  document.querySelectorAll('input[name="difficulty"]').forEach((r) => (r.disabled = !enabled));
  el.tabButtons.forEach((b) => (b.disabled = !enabled));
  el.btnNextSentence.disabled = !enabled;
  el.btnUseFreeText.disabled = !enabled;
  el.btnPlayModel.disabled = !enabled || !state.hasSentence;
  // スキットの操作（UI_function.txt 8節）。録音・判定の最中は触らせない
  el.btnBackToList.disabled = !enabled;
  el.btnNextLine.disabled = !enabled;
  el.btnToggleTranslation.disabled = !enabled;
  el.btnStartSkit.disabled = !enabled;
  el.btnRoleBack.disabled = !enabled;
  el.skitList.querySelectorAll(".skit-row").forEach((r) => (r.disabled = !enabled));
  document.querySelectorAll('input[name="skit-mode"]').forEach((r) => (r.disabled = !enabled));
  el.skitRoleChoices.querySelectorAll("input").forEach((r) => (r.disabled = !enabled));
}

el.tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    el.tabButtons.forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    const target = button.dataset.tab;
    el.tabPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== target);
    });

    if (target === "skit") {
      // 練習中にスキットタブへ戻ってきた場合は、そのまま続ける
      if (!state.skit) {
        // 一覧を出すときは、他のタブで出した出題文を片付ける（2026-10-12 決定）。
        // 残すと一覧の下に関係のない英文が並んで紛らわしいため
        clearSentence();
        showSkitList();
      }
    } else if (state.skit) {
      // スキットから離れたら練習を終えて一覧に戻す。
      // 残したままにすると、他のタブで出題文を入れ替えたあとスキットへ戻ったとき
      // 「3 / 8」の表示と出題文が食い違う（進捗は覚えない方針なので捨ててよい）
      leaveSkit();
    }
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

// 出題文はブラウザ側で読み込んで抽選する（サーバーを持たないため・spec.txt 9-2節）。
// 一度読んだら使い回す。パスは相対（GitHub Pagesのサブパス配下でも届くようにするため）
let sentencesPromise = null;
function loadSentences() {
  if (!sentencesPromise) {
    sentencesPromise = fetch("static/sentences.json").then((res) => {
      if (!res.ok) throw new Error("sentences.json HTTP " + res.status);
      return res.json();
    });
    // 失敗したら次回やり直せるようにしておく
    sentencesPromise.catch(() => {
      sentencesPromise = null;
    });
  }
  return sentencesPromise;
}

el.btnNextSentence.addEventListener("click", async () => {
  let data;
  try {
    data = await loadSentences();
  } catch (err) {
    setStatus("status.sentencesFailed");
    return;
  }
  const pool = data[getSelectedDifficulty()];
  if (!pool || pool.length === 0) return;

  // 直近に出した文を避ける。候補が尽きたら履歴を無視する
  // （サーバー側 api_sentence_random と同じ考え方・spec.txt 5-6節）
  const recent = loadRecentSentences();
  let candidates = pool.filter((s) => recent.indexOf(s) === -1);
  if (candidates.length === 0) {
    candidates = pool;
  }
  const sentence = candidates[Math.floor(Math.random() * candidates.length)];
  rememberSentence(sentence);
  setSentence(sentence);
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

// お手本の読み上げ。お手本ボタンからも、スキットの相手役の自動再生（8-7節）からも使う。
// options.onEnd … 読み終わったときに呼ぶ（中断されたときは呼ばない）
// options.onError … 鳴らせなかったときに呼ぶ（中断は失敗に数えない）
// options.keepButtonEnabled … お手本ボタンを押せるままにする（自動再生用）
async function speakModel(text, options) {
  const opts = options || {};

  // 声の読み込み完了を待つ（初回だけお手本が既定の声で鳴る問題を防ぐ）
  if (!opts.keepButtonEnabled) el.btnPlayModel.disabled = true;
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
  utterance.addEventListener("end", () => {
    finish();
    if (opts.onEnd) opts.onEnd();
  });
  utterance.addEventListener("error", (event) => {
    // cancel() による中断は想定内なので、エラー表示はしないし失敗にも数えない
    const interrupted = event.error === "canceled" || event.error === "interrupted";
    if (!interrupted) setStatus("status.modelFailed");
    finish();
    if (!interrupted && opts.onError) opts.onError();
  });

  window.speechSynthesis.cancel();
  state.currentUtterance = utterance;
  if (!opts.keepButtonEnabled) el.btnPlayModel.disabled = true;
  window.speechSynthesis.speak(utterance);
}

el.btnPlayModel.addEventListener("click", () => {
  const text = el.targetSentence.textContent.trim();
  if (!text) return;
  speakModel(text);
});

function stopModelPlayback() {
  state.currentUtterance = null;
  window.speechSynthesis.cancel();
}

// モデル読み込みの進捗をステータス行に出す。
// 1%刻みで書き換えると描画が忙しいので、値が変わったときだけ更新する
// 2回目以降はモデルがブラウザにキャッシュされていて一瞬で読み終わるため、
// 呼ばれた瞬間に表示すると「読み込み中」が出てすぐ消えるちらつきになる。
// 少し待っても終わらないときだけ表示する（初回のダウンロードでは従来どおり進捗が出る）
const PROGRESS_DELAY_MS = 400;
let progressTimer = null;
let progressVisible = false;
let lastShownPercent = -1;

function beginModelProgress() {
  lastShownPercent = -1;
  progressVisible = false;
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => {
    progressVisible = true;
  }, PROGRESS_DELAY_MS);
}

// 読み込みが終わったら進捗表示を片付ける。
// これが無いと、録音中に読み込みが完了した場合に「100%」が出たまま残る
function endModelProgress() {
  clearTimeout(progressTimer);
  progressVisible = false;
  // 進捗以外のもの（エラーなど）が出ている場合は消さない
  if (state.statusKey === "status.loadingModel") {
    setStatus("");
  }
}

function showModelProgress(info) {
  if (!progressVisible) return;
  const pct = Math.min(100, Math.floor(info.progress || 0));
  if (pct === lastShownPercent) return;
  lastShownPercent = pct;
  setStatus("status.loadingModel", { pct: pct });
}

// モデルの読み込みを先に始めておく（待つのは録音が終わってから）。
// 録音している数秒のあいだにダウンロードが進むので、初回の待ち時間が短くなる
function preloadModel() {
  if (!window.Transcriber) return;
  beginModelProgress();
  window.Transcriber.ensureModel(showModelProgress)
    .then(endModelProgress)
    .catch(() => {
      // 失敗をここでは知らせない（実際に文字起こしを試みたときに改めて知らせる）。
      // ただし進捗表示は片付ける
      endModelProgress();
    });
}

// 録音後、ブラウザ内のWhisperで文字起こしして判定する（spec.txt 9-2節）。
// 音声は端末外に出ない。サーバーへは何も送らない
async function transcribeAndShow(blob) {
  if (!window.Transcriber || typeof buildDiff !== "function") {
    setStatus("status.checkFailed");
    setControlsEnabled(true);
    el.btnRecord.disabled = false;
    return;
  }

  const target = el.targetSentence.textContent.trim();
  try {
    // モデルが未読み込みならここで待つ（進捗はステータス行に出る）
    beginModelProgress();
    await window.Transcriber.ensureModel(showModelProgress);
    endModelProgress();
  } catch (err) {
    endModelProgress();
    setStatus("status.modelLoadFailed");
    setControlsEnabled(true);
    el.btnRecord.disabled = false;
    return;
  }

  setStatus("status.checking");
  try {
    const transcript = await window.Transcriber.transcribe(blob);
    const diff = buildDiff(target, transcript);
    renderDiff(diff);
    el.resultSection.classList.remove("hidden");
    el.btnPlayMine.disabled = false;
    // スキットの練習中だけ、結果の下に「次の台詞へ」を出す（8-8節）
    if (state.skit) el.btnNextLine.classList.remove("hidden");
  } catch (err) {
    setStatus("status.checkFailed");
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

  // 前回の録音のURLを解放してから差し替える
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
    setStatus("status.micUnavailable");
    return;
  }

  setControlsEnabled(false);
  // 録音と並行してモデルを読み込ませる（初回の待ち時間を録音時間で相殺する）
  preloadModel();
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
  state.recordButtonKey = "btn.stop";
  updateRecordButton();
  el.btnRecord.classList.add("recording");
  el.btnRecord.disabled = false;
}

function stopRecording() {
  el.btnRecord.disabled = true;
  state.isRecording = false;
  // 一度録音した後は再録音できるよう「再度録音」表示にする（次の出題で「録音開始」へ戻す）
  state.recordButtonKey = "btn.recordAgain";
  updateRecordButton();
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

// ===== スキット発音練習（spec.txt 第10章・UI_function.txt 8節） =====
// 隣の English_conversation/skit の英会話を、上から順に音読の練習に使う。
// 判定ロジックには手を入れていない（出題文の出どころが増えるだけ・10-6節）。

// 文言に {名前} を埋めてその場で文字列を返す。setStatus（キーで持ち回す方式）とは
// 用途が違い、データから作る表示（一覧の行数など）で使う
function tf(key, params) {
  let text = t(key);
  Object.keys(params || {}).forEach((name) => {
    text = text.replace("{" + name + "}", params[name]);
  });
  return text;
}

// 一覧ぶんの会話データ。一度読んだら使い回す（sentences.json と同じ考え方）
let skitData = null;
let skitsPromise = null;

function loadSkits() {
  if (!skitsPromise) {
    skitsPromise = fetch(SKITS_URL).then((res) => {
      if (!res.ok) throw new Error("skits.json HTTP " + res.status);
      return res.json();
    });
    // 失敗したら次回やり直せるようにしておく
    skitsPromise.catch(() => {
      skitsPromise = null;
    });
  }
  return skitsPromise;
}

// 話者IDから画面に出す名前を引く。英語UIは label_en、日本語UIは role_ja（8-6節）
function speakerLabel(skit, speakerId) {
  const sp = (skit.speakers || []).find((x) => x.id === speakerId);
  if (!sp) return speakerId;
  const name = currentLang === "ja" ? sp.role_ja : sp.label_en;
  return name || sp.label_en || sp.id;
}

// 話者名は日本語UIだけ全角かっこにする（英語UIで「（Waiter）」になるのを防ぐ）
function speakerTag(skit, speakerId) {
  const label = speakerLabel(skit, speakerId);
  return currentLang === "ja" ? "（" + label + "）" : "(" + label + ")";
}

// --- 一覧 ---

function renderSkitListRows() {
  el.skitList.innerHTML = "";
  if (!skitData || !Array.isArray(skitData.skits)) return;

  skitData.skits.forEach((skit) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "skit-row";

    const title = document.createElement("span");
    title.className = "skit-row-title";
    // タイトルは英語UIでも日本語のまま。データに英語タイトルが無いため（10-7節）
    title.textContent = skit.title;

    const meta = document.createElement("span");
    meta.className = "skit-row-meta";
    const who = (skit.speakers || []).map((sp) => (currentLang === "ja" ? sp.role_ja : sp.label_en));
    meta.textContent = who.join(" / ") + " ・ " + tf("skit.lineCount", { n: skit.lines.length });

    row.appendChild(title);
    row.appendChild(meta);
    row.addEventListener("click", () => startSkit(skit.slug));
    el.skitList.appendChild(row);
  });
}

async function showSkitList() {
  // 読み込めなかった場合もスキットタブの中だけで知らせる。
  // 他のタブ（ランダム・自由入力）は sentences.json を使うので影響を受けない（10-8節）
  if (!skitData) setStatus("status.skitLoading");
  try {
    skitData = await loadSkits();
  } catch (err) {
    setStatus("status.skitFailed");
    return;
  }
  if (state.statusKey === "status.skitLoading") setStatus("");
  renderSkitListRows();
}

// --- 練習 ---

function getSkitMode() {
  const checked = document.querySelector('input[name="skit-mode"]:checked');
  return checked ? checked.value : "all";
}

function startSkit(slug) {
  const skit = (skitData && skitData.skits || []).find((x) => x.slug === slug);
  if (!skit || !skit.lines.length) return;

  state.skit = skit;
  state.skitRole = null;
  setStatus("");

  // 「役を選ぶ」モードなら、始める前にどの役かを聞く（8-6節）。
  // 話者が1人しかいない会話では聞く意味がないので、そのまま全台詞で始める
  if (getSkitMode() === "role" && (skit.speakers || []).length > 1) {
    el.skitListView.classList.add("hidden");
    el.skitRoleView.classList.remove("hidden");
    renderRoleChoices();
    return;
  }
  beginPractice(null);
}

// 役の選択肢を作る。話者が3人以上の会話でもそのまま並ぶ。
// keepSelection は言語を切り替えて作り直すときだけ true にする。
// **会話を選び直したときは引き継がない。** 話者IDのA・Bが指す役は会話ごとに違い
// （`Me`と`Friend`が逆の会話もある）、前回と同じIDが同じ立場とは限らないため
function renderRoleChoices(keepSelection) {
  const skit = state.skit;
  const prev = keepSelection
    ? el.skitRoleChoices.querySelector('input[name="skit-role"]:checked')
    : null;
  const prevValue = prev ? prev.value : null;

  el.skitRoleChoices.innerHTML = "";
  if (!skit) return;

  (skit.speakers || []).forEach((sp, i) => {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "skit-role";
    radio.value = sp.id;
    if (prevValue ? sp.id === prevValue : i === 0) radio.checked = true;

    const span = document.createElement("span");
    // 英語UIは label_en、日本語UIは role_ja（8-6節）
    span.textContent = currentLang === "ja" ? (sp.role_ja || sp.label_en || sp.id)
                                            : (sp.label_en || sp.id);
    label.appendChild(radio);
    label.appendChild(span);
    el.skitRoleChoices.appendChild(label);
  });
}

// roleId を渡すと「役を選ぶ」モード、null なら「全台詞」モード
function beginPractice(roleId) {
  if (!state.skit) return;
  state.skitRole = roleId || null;
  state.skitLineIndex = 0;   // 進捗は覚えない。毎回1行目から（10-3節）
  el.skitListView.classList.add("hidden");
  el.skitRoleView.classList.add("hidden");
  el.skitPracticeView.classList.remove("hidden");
  el.skitTitle.textContent = state.skit.title;
  setStatus("");
  renderSkitDoneLines();
  showSkitLine();
}

el.btnStartSkit.addEventListener("click", () => {
  const chosen = el.skitRoleChoices.querySelector('input[name="skit-role"]:checked');
  beginPractice(chosen ? chosen.value : null);
});

el.btnRoleBack.addEventListener("click", leaveSkit);

function showSkitLine() {
  const skit = state.skit;
  if (!skit) return;
  const line = skit.lines[state.skitLineIndex];
  if (!line) {
    finishSkit();
    return;
  }

  el.skitProgress.textContent = (state.skitLineIndex + 1) + " / " + skit.lines.length;
  // setSentence が付加表示（話者名・訳・次の台詞へ）を片付けるので、その後に出す
  setSentence(line.en);
  el.sentenceSpeaker.textContent = speakerTag(skit, line.speaker);
  // 訳が無い会話ではボタンそのものを出さない（8-5節）
  if (line.ja || line.note) el.btnToggleTranslation.classList.remove("hidden");

  // 「役を選ぶ」モードで相手役の台詞なら、自分では読まずにお手本を鳴らす（8-7節）
  if (state.skitRole && line.speaker !== state.skitRole) playOtherRoleLine(line);
}

// 相手役の台詞。お手本を自動で鳴らし、読み終わったら次の行へ進む。
// 相手役が続けて話す場合は、そのまま次も自動で鳴る
function playOtherRoleLine(line) {
  const atIndex = state.skitLineIndex;

  // 相手役の台詞は録音しない。お手本の声をマイクが拾うのも防ぐ（3-4節と同じ対策）
  el.btnRecord.disabled = true;
  // **ブラウザは利用者の操作なしに音を鳴らすことを制限している**（特にiOS Safari・8-7節）。
  // 鳴らなかったときに先へ進めなくならないよう、「次の台詞へ」を最初から出し、
  // お手本ボタンも押せるままにしておく
  el.btnNextLine.classList.remove("hidden");
  setStatus("status.skitPlaying");

  speakModel(line.en, {
    keepButtonEnabled: true,
    onEnd: () => {
      // 読み終わる前に手で次へ進んでいたら、二重に進めない
      if (!state.skit || state.skitLineIndex !== atIndex) return;
      setStatus("");
      nextSkitLine();
    },
    onError: () => {
      // 鳴らせなかった場合。自動では進めず、手で進めてもらう
      // （status は speakModel 側で「お手本の再生に失敗しました」になっている）
      if (!state.skit || state.skitLineIndex !== atIndex) return;
    },
  });
}

// 済んだ台詞を上に残す。会話の流れの中で練習する目的なので、
// 単文の出題と違って前の台詞が見えていることに意味がある（8-3節）
function renderSkitDoneLines() {
  el.skitDoneLines.innerHTML = "";
  const skit = state.skit;
  if (!skit) return;

  skit.lines.slice(0, state.skitLineIndex).forEach((line) => {
    const li = document.createElement("li");
    const who = document.createElement("span");
    who.className = "done-speaker";
    who.textContent = speakerLabel(skit, line.speaker);
    const text = document.createElement("span");
    text.className = "done-text";
    text.textContent = line.en;
    li.appendChild(who);
    li.appendChild(text);
    el.skitDoneLines.appendChild(li);
  });
}

function nextSkitLine() {
  if (!state.skit) return;
  state.skitLineIndex += 1;
  if (state.skitLineIndex >= state.skit.lines.length) {
    finishSkit();
    return;
  }
  renderSkitDoneLines();
  showSkitLine();
}

function finishSkit() {
  leaveSkit();
  setStatus("skit.done");
}

// 出題文を片付けて、お手本・録音も止める。
// スキットの一覧を出すときに使う（出題文の欄はタブ共通なので、
// 片付けないと一覧の下に前のタブの英文が残って紛らわしい）
function clearSentence() {
  stopModelPlayback();
  el.targetSentence.textContent = "";
  state.hasSentence = false;
  el.btnPlayModel.disabled = true;
  el.btnRecord.disabled = true;
  el.resultSection.classList.add("hidden");
  resetSkitLineExtras();
}

// 一覧へ戻る。出題文も片付ける（スキットから抜けたら録音もお手本も意味がない）
function leaveSkit() {
  state.skit = null;
  state.skitLineIndex = 0;
  state.skitRole = null;
  el.skitPracticeView.classList.add("hidden");
  el.skitRoleView.classList.add("hidden");
  el.skitListView.classList.remove("hidden");
  // 練習中に言語を切り替えた場合、一覧は切り替え前の言語のまま残っている
  // （renderSkitUI は練習中だと練習画面しか描き直さないため）。ここで描き直す
  renderSkitListRows();
  el.skitDoneLines.innerHTML = "";
  el.skitProgress.textContent = "";
  el.skitTitle.textContent = "";

  clearSentence();
  setStatus("");
}

// スキット用の付加表示を初期状態に戻す。setSentence から毎回呼ぶので、
// 次の台詞では訳が閉じた状態から始まる（開いたままだと訳を先に読んでしまう・8-5節）
function resetSkitLineExtras() {
  el.sentenceSpeaker.textContent = "";
  el.btnToggleTranslation.classList.add("hidden");
  setTranslationButton(false);
  el.translationBox.classList.add("hidden");
  el.translationBox.innerHTML = "";
  el.btnNextLine.classList.add("hidden");
}

// data-i18n も書き換える。そうしないと言語を切り替えたときに
// 開いているのに「訳を見る」へ戻ってしまう
function setTranslationButton(open) {
  const key = open ? "btn.hideTranslation" : "btn.showTranslation";
  el.btnToggleTranslation.dataset.i18n = key;
  el.btnToggleTranslation.textContent = t(key);
}

el.btnToggleTranslation.addEventListener("click", () => {
  const closed = el.translationBox.classList.contains("hidden");
  if (!closed) {
    el.translationBox.classList.add("hidden");
    setTranslationButton(false);
    return;
  }
  const line = state.skit && state.skit.lines[state.skitLineIndex];
  if (!line) return;

  el.translationBox.innerHTML = "";
  if (line.ja) {
    const ja = document.createElement("p");
    ja.className = "translation-ja";
    ja.textContent = line.ja;
    el.translationBox.appendChild(ja);
  }
  if (line.note) {
    const note = document.createElement("p");
    note.className = "translation-note";
    note.textContent = line.note;
    el.translationBox.appendChild(note);
  }
  el.translationBox.classList.remove("hidden");
  setTranslationButton(true);
});

el.btnNextLine.addEventListener("click", nextSkitLine);
el.btnBackToList.addEventListener("click", leaveSkit);

// 言語を切り替えたとき、データから作っている表示を描き直す
// （data-i18n の一括差し替えでは直せないため）
function renderSkitUI() {
  if (!skitData) return;
  // 役を選んでいる最中なら、役名を今の言語で作り直す（選択は保つ）
  if (!el.skitRoleView.classList.contains("hidden")) {
    renderRoleChoices(true);
    return;
  }
  if (state.skit) {
    const line = state.skit.lines[state.skitLineIndex];
    if (line) el.sentenceSpeaker.textContent = speakerTag(state.skit, line.speaker);
    renderSkitDoneLines();
  } else {
    renderSkitListRows();
  }
}

// 起動時に、前回選んだ言語（無ければ既定の英語）でUI全体を描画する
applyLanguage(loadSavedLang());
