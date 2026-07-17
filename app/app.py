import difflib
import json
import random
import re
import subprocess
import threading
from collections import deque
from pathlib import Path

import numpy as np
import sounddevice as sd
import whisper
from flask import Flask, jsonify, request, render_template
from scipy.io.wavfile import write as write_wav

APP_DIR = Path(__file__).resolve().parent
SENTENCES_PATH = APP_DIR / "sentences.json"
RECORDING_PATH = APP_DIR / "last_recording.wav"
SAMPLE_RATE = 44100
# 一度出題した文は、その後この回数分の出題では再び出さない（spec.txt 4-1節）
RECENT_LIMIT = 10

ACCENT_VOICES = {
    "us": "Samantha",
    "uk": "Daniel",
    "au": "Karen",
}

app = Flask(__name__)

print("Whisperモデルを読み込み中...")
whisper_model = whisper.load_model("base")
print("読み込み完了。")

with open(SENTENCES_PATH, encoding="utf-8") as f:
    SENTENCES = json.load(f)

state_lock = threading.Lock()
state = {
    "target_sentence": "",
    "stream": None,
    "frames": [],
    "has_recording": False,
    # 直近に出題した文（難易度をまたいで1つで管理。古いものから自動で溢れる）
    "recent_sentences": deque(maxlen=RECENT_LIMIT),
}


NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100, "thousand": 1000,
}


def _combine_number_run(words):
    # "two thousand five hundred" のようにhundred/thousandを含む連続する
    # 数詞をまとめて1つの数値にする（"and"でつながる表現は非対応）
    total = 0
    current = 0
    for word in words:
        value = NUMBER_WORDS[word]
        if value == 100:
            current = (current or 1) * 100
        elif value == 1000:
            current = (current or 1) * 1000
            total += current
            current = 0
        else:
            current += value
    return str(total + current)


def normalize_words(text):
    text = text.lower()
    text = re.sub(r"[^\w\s']", "", text)
    words = text.split()

    result = []
    i = 0
    while i < len(words):
        if words[i] in NUMBER_WORDS:
            j = i
            while j < len(words) and words[j] in NUMBER_WORDS:
                j += 1
            run = words[i:j]
            if "hundred" in run or "thousand" in run:
                result.append(_combine_number_run(run))
            else:
                result.extend(str(NUMBER_WORDS[w]) for w in run)
            i = j
        else:
            result.append(words[i])
            i += 1
    return result


def build_diff(target_text, said_text):
    target_words = normalize_words(target_text)
    said_words = normalize_words(said_text)
    matcher = difflib.SequenceMatcher(a=target_words, b=said_words)

    diff = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for word in target_words[i1:i2]:
                diff.append({"type": "equal", "word": word})
        elif tag == "replace":
            target_chunk = target_words[i1:i2]
            said_chunk = said_words[j1:j2]
            for k in range(max(len(target_chunk), len(said_chunk))):
                t = target_chunk[k] if k < len(target_chunk) else None
                s = said_chunk[k] if k < len(said_chunk) else None
                if t is not None and s is not None:
                    diff.append({"type": "replace", "target": t, "said": s})
                elif t is not None:
                    diff.append({"type": "delete", "target": t})
                else:
                    diff.append({"type": "insert", "said": s})
        elif tag == "delete":
            for word in target_words[i1:i2]:
                diff.append({"type": "delete", "target": word})
        elif tag == "insert":
            for word in said_words[j1:j2]:
                diff.append({"type": "insert", "said": word})
    return diff


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/sentence/random")
def api_sentence_random():
    difficulty = request.args.get("difficulty", "beginner")
    pool = SENTENCES.get(difficulty)
    if not pool:
        return jsonify({"error": "invalid difficulty"}), 400
    with state_lock:
        recent = state["recent_sentences"]
        candidates = [s for s in pool if s not in recent]
        # プールが RECENT_LIMIT 以下だと候補が尽きうるので、その場合は履歴を無視する
        if not candidates:
            candidates = pool
        sentence = random.choice(candidates)
        recent.append(sentence)
        state["target_sentence"] = sentence
    return jsonify({"sentence": sentence})


@app.route("/api/sentence/custom", methods=["POST"])
def api_sentence_custom():
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text is empty"}), 400
    with state_lock:
        state["target_sentence"] = text
    return jsonify({"sentence": text})


@app.route("/api/say", methods=["POST"])
def api_say():
    data = request.get_json(force=True)
    accent = data.get("accent", "us")
    voice = ACCENT_VOICES.get(accent, ACCENT_VOICES["us"])
    with state_lock:
        text = state["target_sentence"]
    if not text:
        return jsonify({"error": "no target sentence"}), 400
    subprocess.run(["say", "-v", voice, text])
    return jsonify({"status": "done"})


def _record_callback(indata, frames, time_info, status):
    with state_lock:
        state["frames"].append(indata.copy())


@app.route("/api/record/start", methods=["POST"])
def api_record_start():
    with state_lock:
        if state["stream"] is not None:
            return jsonify({"error": "already recording"}), 400
        state["frames"] = []
        stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            callback=_record_callback,
        )
        stream.start()
        state["stream"] = stream
    return jsonify({"status": "recording"})


@app.route("/api/record/stop", methods=["POST"])
def api_record_stop():
    with state_lock:
        stream = state["stream"]
        if stream is None:
            return jsonify({"error": "not recording"}), 400
        state["stream"] = None

    # stream.stop()/close() はコールバックスレッドの終了を待つため、
    # state_lock を保持したまま呼ぶとコールバック側のロック取得待ちとデッドロックする。
    # ロックの外で呼び出す。
    stream.stop()
    stream.close()

    with state_lock:
        frames = state["frames"]
        target_sentence = state["target_sentence"]

    if not frames:
        return jsonify({"error": "no audio captured"}), 400

    audio = np.concatenate(frames, axis=0)
    write_wav(str(RECORDING_PATH), SAMPLE_RATE, audio)

    peak = float(np.abs(audio).max()) if audio.size else 0.0
    print(f"[record] captured {len(audio)} samples, peak amplitude={peak:.4f}"
          + ("  !! ほぼ無音（マイク権限/デバイス選択を確認）" if peak < 0.01 else ""))

    with state_lock:
        state["has_recording"] = True

    result = whisper_model.transcribe(str(RECORDING_PATH), language="en")
    transcript = result["text"].strip()
    diff = build_diff(target_sentence, transcript)

    return jsonify({"transcript": transcript, "diff": diff})


@app.route("/api/playback/mine", methods=["POST"])
def api_playback_mine():
    with state_lock:
        has_recording = state["has_recording"]
    if not has_recording:
        return jsonify({"error": "no recording yet"}), 400
    subprocess.run(["afplay", str(RECORDING_PATH)])
    return jsonify({"status": "done"})


if __name__ == "__main__":
    app.run(debug=True, threaded=True, port=5001)
