import difflib
import json
import os
import random
import re
import tempfile
import threading
from pathlib import Path

from faster_whisper import WhisperModel
from flask import Flask, jsonify, request, render_template

APP_DIR = Path(__file__).resolve().parent
SENTENCES_PATH = APP_DIR / "sentences.json"

app = Flask(__name__)

# 文字起こしエンジン（2026-07-20：openai-whisperからfaster-whisperへ移行。spec.txt 5-5節）
# int8量子化でCPU推論。メモリ・速度ともに有利で、精度は同等
WHISPER_MODEL_SIZE = os.environ.get("DICTATION_WHISPER_MODEL", "base")
print(f"Whisperモデル（{WHISPER_MODEL_SIZE}）を読み込み中...")
whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
print("読み込み完了。")

# WhisperModelは複数スレッドから同時に呼ぶことを想定していないため、
# 文字起こしは1件ずつ直列に処理する（Flaskはthreaded=Trueで動作）
transcribe_lock = threading.Lock()

with open(SENTENCES_PATH, encoding="utf-8") as f:
    SENTENCES = json.load(f)

# （2026-07-20）複数ユーザー対応のため、サーバーは利用者ごとの状態を持たない。
# 出題文と直近の出題履歴はブラウザ側が保持する（spec.txt 5-6節）


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


@app.route("/api/sentence/random", methods=["POST"])
def api_sentence_random():
    # 直近の出題履歴はブラウザ（sessionStorage）が持ち、リクエストごとに送ってくる。
    # サーバーは利用者ごとの状態を持たない（spec.txt 5-6節）
    data = request.get_json(silent=True) or {}
    difficulty = data.get("difficulty", "beginner")
    pool = SENTENCES.get(difficulty)
    if not pool:
        return jsonify({"error": "invalid difficulty"}), 400

    recent = data.get("recent")
    recent = set(recent) if isinstance(recent, list) else set()

    candidates = [s for s in pool if s not in recent]
    # プールが RECENT_LIMIT 以下だと候補が尽きうるので、その場合は履歴を無視する
    if not candidates:
        candidates = pool
    return jsonify({"sentence": random.choice(candidates)})


@app.route("/api/transcribe", methods=["POST"])
def api_transcribe():
    # ブラウザ（MediaRecorder）で録音した音声と、そのとき表示していた出題文を受け取り、
    # 文字起こし→判定して返す。出題文をブラウザから受け取ることで、サーバーは
    # 利用者ごとの状態を持たずに済む（spec.txt 5-6節）。
    # 音声形式（webm/opus/mp4等）はブラウザ依存だが、WhisperがffmpegでそのままデコードするためWAV変換は不要（spec.txt 5-4節）
    audio_file = request.files.get("audio")
    if audio_file is None:
        return jsonify({"error": "no audio uploaded"}), 400

    target_sentence = (request.form.get("target") or "").strip()
    if not target_sentence:
        return jsonify({"error": "no target sentence"}), 400

    # 一時ファイルはリクエストごとに作る（固定名だと同時利用時に
    # 他人の音声で判定してしまうため）。拡張子に依存せずffmpegが形式を判別する
    fd, temp_path = tempfile.mkstemp(prefix="dictation_", dir=str(APP_DIR))
    os.close(fd)
    try:
        audio_file.save(temp_path)

        # faster-whisperのtranscribe()はセグメントのジェネレータを返すため、
        # ここで消費して1つの文字列に連結する（ロック内で消費しきること）
        with transcribe_lock:
            segments, _info = whisper_model.transcribe(temp_path, language="en")
            transcript = "".join(segment.text for segment in segments).strip()
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass

    diff = build_diff(target_sentence, transcript)
    return jsonify({"transcript": transcript, "diff": diff})


if __name__ == "__main__":
    app.run(debug=True, threaded=True, port=5001)
