import difflib
import json
import random
import re
import threading
from collections import deque
from pathlib import Path

import whisper
from flask import Flask, jsonify, request, render_template

APP_DIR = Path(__file__).resolve().parent
SENTENCES_PATH = APP_DIR / "sentences.json"
# ブラウザからアップロードされた録音の一時保存先。形式（webm/opus/mp4等）は
# 拡張子に依存せずffmpegが内容から判別するため、固定名でよい（spec.txt 5-4節）
RECORDING_PATH = APP_DIR / "last_recording"
# 一度出題した文は、その後この回数分の出題では再び出さない（spec.txt 4-1節）
RECENT_LIMIT = 10

app = Flask(__name__)

print("Whisperモデルを読み込み中...")
whisper_model = whisper.load_model("base")
print("読み込み完了。")

with open(SENTENCES_PATH, encoding="utf-8") as f:
    SENTENCES = json.load(f)

state_lock = threading.Lock()
state = {
    "target_sentence": "",
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


# 単位の表記ゆれ吸収（2026-07-20追加。spec.txt 5節）
# 略記・米英つづり・複数形を、すべて「正規形（単数の英単語つづり）」へ寄せる。
# 値が複数語のもの（mph等）は分割して展開する。
# 英単語や他の意味と衝突する単独の in / m / t / s / c / f は意図的に含めない。
def _unit_aliases():
    # 正規形 -> その正規形に寄せる表記のリスト
    groups = {
        # 長さ
        "millimeter": ["mm", "millimetre", "millimeters", "millimetres"],
        "centimeter": ["cm", "centimetre", "centimeters", "centimetres"],
        "meter": ["metre", "meters", "metres"],
        "kilometer": ["km", "kms", "kilometre", "kilometers", "kilometres"],
        "inch": ["inches"],
        "foot": ["ft", "feet"],
        "yard": ["yd", "yds", "yards"],
        "mile": ["mi", "miles"],
        # 重さ
        "milligram": ["mg", "milligramme", "milligrams", "milligrammes"],
        "gram": ["g", "gramme", "grams", "grammes"],
        "kilogram": ["kg", "kgs", "kilo", "kilos", "kilogramme",
                     "kilograms", "kilogrammes"],
        "pound": ["lb", "lbs", "pounds"],
        "ounce": ["oz", "ounces"],
        "ton": ["tons", "tonne", "tonnes"],
        # 体積
        "milliliter": ["ml", "millilitre", "milliliters", "millilitres"],
        "liter": ["l", "litre", "liters", "litres"],
        "gallon": ["gal", "gals", "gallons"],
        "quart": ["qt", "qts", "quarts"],
        "pint": ["pt", "pts", "pints"],
        "tablespoon": ["tbsp", "tablespoons"],
        "teaspoon": ["tsp", "teaspoons"],
        # 時間
        "hour": ["hr", "hrs", "hours"],
        "minute": ["min", "mins", "minutes"],
        "second": ["sec", "secs", "seconds"],
        # 速度（複数語に展開する）
        "mile per hour": ["mph"],
        "kilometer per hour": ["kph", "kmh"],
        # 温度
        "celsius": ["centigrade"],
        "fahrenheit": [],
        "degree": ["degrees"],
        # データ量
        "kilobyte": ["kb", "kilobytes"],
        "megabyte": ["mb", "megabytes"],
        "gigabyte": ["gb", "gigabytes"],
        "terabyte": ["tb", "terabytes"],
        # 割合・通貨
        "percent": ["pct", "percents", "percentage"],
        "dollar": ["dollars"],
        "euro": ["euros"],
        "cent": ["cents"],
    }
    aliases = {}
    for canonical, variants in groups.items():
        # 複数語の正規形（"mile per hour"）は、その各語が単独でも
        # 正規形になっているため、キーとしては登録しない
        if " " not in canonical:
            aliases[canonical] = canonical
        for variant in variants:
            aliases[variant] = canonical
    return aliases


UNIT_ALIASES = _unit_aliases()


def _replace_symbol_units(text):
    # 記号を含む単位は、句読点除去で記号が消える前に単語へ置き換える
    # 「25°C」は「25 degrees Celsius」と読まれるため degree を補う
    text = re.sub(r"℃|°\s*c\b", " degree celsius ", text)
    text = re.sub(r"℉|°\s*f\b", " degree fahrenheit ", text)
    text = re.sub(r"°", " degree ", text)
    text = text.replace("%", " percent ")
    text = re.sub(r"\bkm\s*/\s*h(r|our)?\b", " kph ", text)
    text = re.sub(r"\bmi(les?)?\s*/\s*h(r|our)?\b", " mph ", text)
    # 通貨記号は「$5」のように単位が前に来るため、語順を入れ替える
    text = re.sub(r"\$\s*([\d.,]+)", r" \1 dollar ", text)
    text = re.sub(r"£\s*([\d.,]+)", r" \1 pound ", text)
    text = re.sub(r"€\s*([\d.,]+)", r" \1 euro ", text)
    return text


def normalize_words(text):
    text = text.lower()
    text = _replace_symbol_units(text)
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
            # 単位は正規形へ（"kg" と "kilograms" をどちらも "kilogram" に）
            result.extend(UNIT_ALIASES.get(words[i], words[i]).split())
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


@app.route("/api/transcribe", methods=["POST"])
def api_transcribe():
    # ブラウザ（MediaRecorder）で録音した音声を受け取り、文字起こし→判定して返す。
    # 形式（webm/opus/mp4等）はブラウザ依存だが、WhisperがffmpegでそのままデコードするためWAV変換は不要（spec.txt 5-4節）
    audio_file = request.files.get("audio")
    if audio_file is None:
        return jsonify({"error": "no audio uploaded"}), 400

    audio_file.save(str(RECORDING_PATH))

    with state_lock:
        target_sentence = state["target_sentence"]

    result = whisper_model.transcribe(str(RECORDING_PATH), language="en")
    transcript = result["text"].strip()
    diff = build_diff(target_sentence, transcript)

    return jsonify({"transcript": transcript, "diff": diff})


if __name__ == "__main__":
    app.run(debug=True, threaded=True, port=5001)
