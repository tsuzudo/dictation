# -*- coding: utf-8 -*-
"""判定ロジックのPython版とJavaScript版の出力を突き合わせる（spec.txt 9-2節）。

静的ホスティングへの移行で app/app.py の判定ロジックを app/static/scoring.js へ
移植した。移植ミスが最大のリスクのため、同じ入力に対して両者が完全に同じ出力を
返すことを機械的に確認する。

実行:  python3 tests/compare_scoring.py

JavaScriptの実行にはmacOS標準搭載のJavaScriptCore（jsc）を使う。
Node.jsは開発環境に導入しない方針のため（Python環境と同じ考え方）。
jscはSafariと同じエンジンなので、実際にブラウザで動く条件に近い。
"""

import json
import random
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APP_PY = REPO / "app" / "app.py"
SCORING_JS = REPO / "app" / "static" / "scoring.js"
SENTENCES = REPO / "app" / "sentences.json"
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")


def load_python_logic():
    """app.pyから判定ロジックだけを取り出して読み込む。

    そのままimportするとWhisperモデル（数百MB）の読み込みが走るため、
    ルート定義より前の部分から、Whisper・Flask関連の行を除いて実行する。
    """
    src = APP_PY.read_text(encoding="utf-8")
    head = src.split('@app.route("/")')[0]
    drop_prefixes = (
        "from faster_whisper import",
        "from flask import",
        "whisper_model = ",
        "app = Flask",
        "print(",
    )
    lines = [ln for ln in head.splitlines()
             if not ln.startswith(drop_prefixes)]
    # APP_DIR = Path(__file__)... があるため __file__ を渡しておく
    module = {"__name__": "dictation_logic", "__file__": str(APP_PY)}
    exec(compile("\n".join(lines), str(APP_PY), "exec"), module)
    return module


def make_cases():
    """突き合わせ用の入力ペア（出題文, 文字起こし結果）を作る。

    実際に起こる崩れ方（脱落・言い間違い・余計な語・表記ゆれ）に加えて、
    SequenceMatcherのタイブレーク（同じ長さの一致が複数ある場合にどれを選ぶか）
    を突くために、同じ単語が繰り返し出てくる文も混ぜる。
    """
    rng = random.Random(20260818)
    pool = []
    data = json.loads(SENTENCES.read_text(encoding="utf-8"))
    for level in data.values():
        pool.extend(level)

    # 表記ゆれ・記号単位を狙い撃ちする手書きケース
    handmade = [
        ("It costs $25 and weighs 3.5 kg.", "it costs 25 dollars and weighs three point five kilograms"),
        ("The temperature is 25°C today.", "the temperature is twenty five degrees celsius today"),
        ("We drove at 60 km/h for 2 hours.", "we drove at sixty kph for two hrs"),
        ("Only 15% of the colour was gray.", "only fifteen percent of the color was grey"),
        ("I analysed the catalogue in the centre.", "I analyzed the catalog in the center"),
        ("She travelled 4 miles in 30 minutes.", "she traveled four mi in thirty mins"),
        ("Two thousand five hundred people came.", "2500 people came"),
        ("The four hour tour was a surprise.", "the four hour tour was a surprise"),
        ("He practised his favourite programme.", "he practiced his favorite program"),
        # 同じ語の繰り返し（タイブレーク狙い）
        ("the cat and the dog and the bird", "the dog and the cat and the bird"),
        ("a a a b b b a a a", "a a b b a a a a a"),
        ("one one one two two", "one two one two one"),
        # 空・極端なケース
        ("Hello world.", ""),
        ("", "hello world"),
        ("", ""),
        ("Hello world.", "completely different sentence here"),
        # 記号が1文に複数回出るケース。JSのString.replaceは既定で最初の1つしか
        # 置換しないため、gフラグの付け忘れをここで検出する
        ("Sales rose 10% and profits fell 5%.", "sales rose ten percent and profits fell five percent"),
        ("It was 20°C at noon and 15°C at night.", "it was twenty degrees celsius at noon and fifteen degrees celsius at night"),
        ("I paid $30 for one and $45 for the other.", "i paid thirty dollars for one and forty five dollars for the other"),
        ("We ran 5 km/h then 8 km/h.", "we ran five kph then eight kph"),
        # 3文字の語。つづり規則の語長ガード（len > 3）の境界を突く。
        # 実在しない語でも、両版が同じ結果を返すかの確認としては有効
        ("our tre bre ise yse", "our tre bre ise yse"),
        ("Our tour of the centre was sour.", "our tour of the center was sour"),
        # JSのオブジェクトのプロパティ名と衝突する普通の英単語。
        # 辞書を素のオブジェクトで持つと、これらがプロトタイプ経由で
        # 「登録済み」と誤判定される（Map を使っている理由）
        ("The constructor read the toString value.", "the constructor read the tostring value"),
        ("constructor prototype valueOf hasOwnProperty", "constructor prototype valueof hasownproperty"),
        ("Our constructor travelled to the centre.", "our constructor traveled to the center"),
        # アクセント付き文字（Pythonの \w との差を確認）
        ("We visited a café in México.", "we visited a cafe in mexico"),
        ("naïve résumé", "naive resume"),
    ]

    cases = list(handmade)
    extra_words = ["quickly", "very", "the", "a", "and", "house", "run", "blue"]

    for sentence in pool:
        words = sentence.split()
        if not words:
            continue
        # そのまま（完全一致）
        cases.append((sentence, sentence.lower()))
        # 1語脱落
        if len(words) > 1:
            k = rng.randrange(len(words))
            cases.append((sentence, " ".join(words[:k] + words[k + 1:])))
        # 1語置換
        k = rng.randrange(len(words))
        replaced = list(words)
        replaced[k] = rng.choice(extra_words)
        cases.append((sentence, " ".join(replaced)))
        # 1語挿入
        k = rng.randrange(len(words) + 1)
        inserted = words[:k] + [rng.choice(extra_words)] + words[k:]
        cases.append((sentence, " ".join(inserted)))
        # 語順の入れ替え
        if len(words) > 2:
            swapped = list(words)
            k = rng.randrange(len(words) - 1)
            swapped[k], swapped[k + 1] = swapped[k + 1], swapped[k]
            cases.append((sentence, " ".join(swapped)))
        # 前半だけ言えた
        if len(words) > 3:
            cases.append((sentence, " ".join(words[:len(words) // 2])))
        # 英式つづりへ寄せる（米英ゆれ許容が効くか）
        british = sentence
        for us, uk in (("color", "colour"), ("center", "centre"), ("meter", "metre"),
                       ("organize", "organise"), ("traveled", "travelled"),
                       ("gray", "grey"), ("program", "programme")):
            british = re.sub(r"\b" + us, uk, british, flags=re.IGNORECASE)
        if british != sentence:
            cases.append((sentence, british.lower()))
        # 句読点と大文字を落とす（Whisperの出力揺れを模す）
        cases.append((sentence, re.sub(r"[.,!?;:]", "", sentence).lower()))
    return cases


def run_js(cases):
    """jscでJavaScript版を実行し、結果を受け取る。"""
    tmp = REPO / "tests" / "_cases.generated.js"
    runner = REPO / "tests" / "_runner.generated.js"
    tmp.write_text("var CASES = " + json.dumps(cases, ensure_ascii=False) + ";\n",
                   encoding="utf-8")
    runner.write_text(
        "var out = [];\n"
        "for (var i = 0; i < CASES.length; i++) {\n"
        "  out.push({\n"
        "    target_words: normalizeWords(CASES[i][0]),\n"
        "    said_words: normalizeWords(CASES[i][1]),\n"
        "    diff: buildDiff(CASES[i][0], CASES[i][1])\n"
        "  });\n"
        "}\n"
        "print(JSON.stringify(out));\n",
        encoding="utf-8")
    proc = subprocess.run(
        [str(JSC), str(SCORING_JS), str(tmp), str(runner)],
        capture_output=True, text=True)
    if proc.returncode != 0:
        print("jscの実行に失敗しました:", file=sys.stderr)
        print(proc.stderr, file=sys.stderr)
        sys.exit(1)
    tmp.unlink()
    runner.unlink()
    return json.loads(proc.stdout)


def main():
    if not JSC.exists():
        print(f"JavaScriptCore（jsc）が見つかりません: {JSC}", file=sys.stderr)
        sys.exit(1)

    logic = load_python_logic()
    cases = make_cases()
    print(f"突き合わせケース数: {len(cases)}")

    py_results = []
    for target, said in cases:
        py_results.append({
            "target_words": logic["normalize_words"](target),
            "said_words": logic["normalize_words"](said),
            "diff": logic["build_diff"](target, said),
        })

    js_results = run_js(cases)

    if len(py_results) != len(js_results):
        print(f"NG: 件数が違う python={len(py_results)} js={len(js_results)}")
        sys.exit(1)

    mismatches = []
    for idx, (py, js) in enumerate(zip(py_results, js_results)):
        if py != js:
            mismatches.append((idx, cases[idx], py, js))

    if not mismatches:
        print(f"OK: 全 {len(cases)} ケースでPython版とJavaScript版の出力が一致しました")
        return 0

    print(f"NG: {len(mismatches)} 件が不一致")
    for idx, case, py, js in mismatches[:10]:
        print("-" * 70)
        print(f"[case {idx}]")
        print(f"  出題文  : {case[0]!r}")
        print(f"  発話文  : {case[1]!r}")
        for key in ("target_words", "said_words", "diff"):
            if py[key] != js[key]:
                print(f"  {key} python: {json.dumps(py[key], ensure_ascii=False)}")
                print(f"  {key} js    : {json.dumps(js[key], ensure_ascii=False)}")
    if len(mismatches) > 10:
        print(f"...ほか {len(mismatches) - 10} 件")
    return 1


if __name__ == "__main__":
    sys.exit(main())
