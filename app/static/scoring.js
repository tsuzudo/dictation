// 判定ロジック（app/app.py からの移植・spec.txt 9-2節）
//
// 静的ホスティングへの移行に伴い、サーバー側Pythonで行っていた
// 「正規化 → 単語アライメント → 差分生成」をブラウザ側へ移した。
// 出力仕様（diffの配列）は移植前と同一に保つこと。Python版との一致は
// scripts/compare_scoring.py（突き合わせテスト）で検証している。
//
// 辞書はすべて Map で持つ。素のオブジェクトだと "constructor" や "toString" の
// ような普通の英単語がプロトタイプのプロパティに当たってしまい、誤判定するため。

var NUMBER_WORDS = new Map([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4],
  ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9],
  ["ten", 10], ["eleven", 11], ["twelve", 12], ["thirteen", 13],
  ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17],
  ["eighteen", 18], ["nineteen", 19], ["twenty", 20], ["thirty", 30],
  ["forty", 40], ["fifty", 50], ["sixty", 60], ["seventy", 70],
  ["eighty", 80], ["ninety", 90], ["hundred", 100], ["thousand", 1000],
]);


function combineNumberRun(words) {
  // "two thousand five hundred" のようにhundred/thousandを含む連続する
  // 数詞をまとめて1つの数値にする（"and"でつながる表現は非対応）
  var total = 0;
  var current = 0;
  for (var idx = 0; idx < words.length; idx++) {
    var value = NUMBER_WORDS.get(words[idx]);
    if (value === 100) {
      current = (current || 1) * 100;
    } else if (value === 1000) {
      current = (current || 1) * 1000;
      total += current;
      current = 0;
    } else {
      current += value;
    }
  }
  return String(total + current);
}


// 単位の表記ゆれ吸収（2026-07-20追加。spec.txt 5節）
// 略記・米英つづり・複数形を、すべて「正規形（単数の英単語つづり）」へ寄せる。
// 値が複数語のもの（mph等）は分割して展開する。
// 英単語や他の意味と衝突する単独の in / m / t / s / c / f は意図的に含めない。
function buildUnitAliases() {
  // 正規形 -> その正規形に寄せる表記のリスト
  var groups = [
    // 長さ
    ["millimeter", ["mm", "millimetre", "millimeters", "millimetres"]],
    ["centimeter", ["cm", "centimetre", "centimeters", "centimetres"]],
    ["meter", ["metre", "meters", "metres"]],
    ["kilometer", ["km", "kms", "kilometre", "kilometers", "kilometres"]],
    ["inch", ["inches"]],
    ["foot", ["ft", "feet"]],
    ["yard", ["yd", "yds", "yards"]],
    ["mile", ["mi", "miles"]],
    // 重さ
    ["milligram", ["mg", "milligramme", "milligrams", "milligrammes"]],
    ["gram", ["g", "gramme", "grams", "grammes"]],
    ["kilogram", ["kg", "kgs", "kilo", "kilos", "kilogramme",
                  "kilograms", "kilogrammes"]],
    ["pound", ["lb", "lbs", "pounds"]],
    ["ounce", ["oz", "ounces"]],
    ["ton", ["tons", "tonne", "tonnes"]],
    // 体積
    ["milliliter", ["ml", "millilitre", "milliliters", "millilitres"]],
    ["liter", ["l", "litre", "liters", "litres"]],
    ["gallon", ["gal", "gals", "gallons"]],
    ["quart", ["qt", "qts", "quarts"]],
    ["pint", ["pt", "pts", "pints"]],
    ["tablespoon", ["tbsp", "tablespoons"]],
    ["teaspoon", ["tsp", "teaspoons"]],
    // 時間
    ["hour", ["hr", "hrs", "hours"]],
    ["minute", ["min", "mins", "minutes"]],
    ["second", ["sec", "secs", "seconds"]],
    // 速度（複数語に展開する）
    ["mile per hour", ["mph"]],
    ["kilometer per hour", ["kph", "kmh"]],
    // 温度
    ["celsius", ["centigrade"]],
    ["fahrenheit", []],
    ["degree", ["degrees"]],
    // データ量
    ["kilobyte", ["kb", "kilobytes"]],
    ["megabyte", ["mb", "megabytes"]],
    ["gigabyte", ["gb", "gigabytes"]],
    ["terabyte", ["tb", "terabytes"]],
    // 割合・通貨
    ["percent", ["pct", "percents", "percentage"]],
    ["dollar", ["dollars"]],
    ["euro", ["euros"]],
    ["cent", ["cents"]],
  ];
  var aliases = new Map();
  for (var gi = 0; gi < groups.length; gi++) {
    var canonical = groups[gi][0];
    var variants = groups[gi][1];
    // 複数語の正規形（"mile per hour"）は、その各語が単独でも
    // 正規形になっているため、キーとしては登録しない
    if (canonical.indexOf(" ") === -1) {
      aliases.set(canonical, canonical);
    }
    for (var vi = 0; vi < variants.length; vi++) {
      aliases.set(variants[vi], canonical);
    }
  }
  return aliases;
}


var UNIT_ALIASES = buildUnitAliases();


// 米英つづりの揺れ許容（spec.txt 5節）。英式のつづりを米式へ寄せてから比較する。
// 方式はハイブリッド：(1)語尾の規則で機械変換し、(2)誤爆する語は除外リストで守り、
// (3)規則で拾えない不規則な差は個別辞書で補う。
//
// 変換は出題文・文字起こし結果の「両方」に同じようにかかるため、変換結果が
// 実在しない語（devour -> devor）になっても不一致にはならない。実害が出るのは
// 「別の実在語と同じ形になる」場合だけなので（four -> for、timbre -> timber）、
// 除外リストはそこを重点的に守る。
var SPELLING_RULES = [
  // -isation -> -ization（organisation）
  [/isation(s?)$/, "ization$1"],
  // -yse -> -yze（analyse / analysed / analysing）
  [/ys(e|es|ed|ing)$/, "yz$1"],
  // -our -> -or（colour、favourite、colourful、neighbourhood、laboured）
  // 語尾だけでなく派生形にも効かせる。ここに無い綴り（courage、journey、
  // flourish など「our」を含むだけの語）には効かない
  [/our(s|ed|ing|er|ers|ite|ites|ful|hood|less|able)?$/, "or$1"],
  // -ise -> -ize（organise / organised / organising）
  [/is(e|es|ed|ing)$/, "iz$1"],
  // -tre -> -ter、-bre -> -ber（centre、metre、fibre）
  [/tre(s?)$/, "ter$1"],
  [/bre(s?)$/, "ber$1"],
];

// 規則で拾えない不規則な差。単数形だけ書いておけば複数形（-s）も引ける
var SPELLING_ALIASES = new Map([
  // 名詞の -ce（英）-> -se（米）
  ["defence", "defense"],
  ["offence", "offense"],
  ["licence", "license"],
  ["pretence", "pretense"],
  ["practise", "practice"],
  ["practised", "practiced"],
  ["practising", "practicing"],
  // -ogue -> -og
  ["catalogue", "catalog"],
  ["dialogue", "dialog"],
  ["monologue", "monolog"],
  // 子音を重ねる英式 -> 重ねない米式
  ["traveller", "traveler"],
  ["travelled", "traveled"],
  ["travelling", "traveling"],
  ["cancelled", "canceled"],
  ["cancelling", "canceling"],
  ["labelled", "labeled"],
  ["labelling", "labeling"],
  ["modelled", "modeled"],
  ["modelling", "modeling"],
  ["jewellery", "jewelry"],
  // その他の不規則な差
  ["grey", "gray"],
  ["programme", "program"],
  ["tyre", "tire"],
  ["aluminium", "aluminum"],
  ["cheque", "check"],
  ["pyjamas", "pajamas"],
  ["plough", "plow"],
  ["mould", "mold"],
  ["moustache", "mustache"],
  ["kerb", "curb"],
  ["draught", "draft"],
  ["sceptical", "skeptical"],
  ["storey", "story"],
  ["speciality", "specialty"],
  ["manoeuvre", "maneuver"],
  ["aeroplane", "airplane"],
  ["cosy", "cozy"],
  // 過去形の英式変化（Whisperがどちらで書き起こすか揺れるため寄せる）
  ["learnt", "learned"],
  ["spelt", "spelled"],
  ["dreamt", "dreamed"],
]);


function buildSpellingExceptions() {
  // 規則を当ててはいけない語。活用形（-s/-ed/-ing）もまとめて守る
  var bases = [
    // -our で終わるが英式の接尾辞ではない語。
    // four -> for は別の実在語と衝突するため必ず守る。
    // hour は変換すると UNIT_ALIASES（時間の単位）に当たらなくなるため必須
    "our", "your", "four", "hour", "pour", "sour", "tour", "flour",
    "scour", "devour", "contour", "detour", "velour", "dour",
    // -ise で終わるが米式でも -ise のままの語
    "promise", "surprise", "exercise", "compromise", "advertise",
    "merchandise", "franchise", "disguise", "despise", "revise",
    "devise", "supervise", "improvise", "arise", "rise", "wise",
    "otherwise", "likewise", "clockwise",
    "praise", "raise", "cruise", "noise", "prise", "precise", "concise",
    "paradise", "expertise", "treatise", "guise", "premise",
    // -bre で終わるが変換できない語。timbre -> timber は別語と衝突する
    "macabre", "timbre",
  ];
  var words = new Set();
  for (var i = 0; i < bases.length; i++) {
    var base = bases[i];
    words.add(base);
    words.add(base + "s");
    words.add(base + "d");
    words.add(base + "ed");
    words.add(base + "ing");
    if (base.endsWith("e")) {
      // promise -> promising のように e を落とす活用形
      words.add(base.slice(0, -1) + "ing");
    }
  }
  return words;
}


var SPELLING_EXCEPTIONS = buildSpellingExceptions();


function normalizeSpelling(word) {
  if (SPELLING_EXCEPTIONS.has(word)) {
    return word;
  }
  // 個別辞書が最優先。単数形で登録しておけば複数形（-s）も引ける
  if (SPELLING_ALIASES.has(word)) {
    return SPELLING_ALIASES.get(word);
  }
  if (word.endsWith("s") && SPELLING_ALIASES.has(word.slice(0, -1))) {
    return SPELLING_ALIASES.get(word.slice(0, -1)) + "s";
  }
  for (var i = 0; i < SPELLING_RULES.length; i++) {
    var pattern = SPELLING_RULES[i][0];
    var replacement = SPELLING_RULES[i][1];
    if (!pattern.test(word)) {
      continue;
    }
    var newWord = word.replace(pattern, replacement);
    // 語そのものが接尾辞と同じ長さになる（our -> or）変換はしない
    if (newWord !== word && word.length > 3) {
      return newWord;
    }
  }
  return word;
}


function replaceSymbolUnits(text) {
  // 記号を含む単位は、句読点除去で記号が消える前に単語へ置き換える
  // 「25°C」は「25 degrees Celsius」と読まれるため degree を補う
  text = text.replace(/℃|°\s*c\b/g, " degree celsius ");
  text = text.replace(/℉|°\s*f\b/g, " degree fahrenheit ");
  text = text.replace(/°/g, " degree ");
  // Python の str.replace は全置換なので、JS側も必ず g フラグで揃える
  text = text.replace(/%/g, " percent ");
  text = text.replace(/\bkm\s*\/\s*h(r|our)?\b/g, " kph ");
  text = text.replace(/\bmi(les?)?\s*\/\s*h(r|our)?\b/g, " mph ");
  // 通貨記号は「$5」のように単位が前に来るため、語順を入れ替える
  text = text.replace(/\$\s*([\d.,]+)/g, " $1 dollar ");
  text = text.replace(/£\s*([\d.,]+)/g, " $1 pound ");
  text = text.replace(/€\s*([\d.,]+)/g, " $1 euro ");
  return text;
}


function normalizeWords(text) {
  text = text.toLowerCase();
  text = replaceSymbolUnits(text);
  // Python の \w は Unicode の文字・数字を含むため、JS側も \p{L}\p{N} で揃える
  // （JSの \w は [A-Za-z0-9_] しか含まないので、そのままでは挙動が変わる）
  text = text.replace(/[^\p{L}\p{N}_\s']/gu, "");
  // Python の str.split() は連続空白をまとめ、前後の空白を捨てる
  var words = text.split(/\s+/).filter(function (w) { return w.length > 0; });

  var result = [];
  var i = 0;
  while (i < words.length) {
    if (NUMBER_WORDS.has(words[i])) {
      var j = i;
      while (j < words.length && NUMBER_WORDS.has(words[j])) {
        j++;
      }
      var run = words.slice(i, j);
      if (run.indexOf("hundred") !== -1 || run.indexOf("thousand") !== -1) {
        result.push(combineNumberRun(run));
      } else {
        for (var k = 0; k < run.length; k++) {
          result.push(String(NUMBER_WORDS.get(run[k])));
        }
      }
      i = j;
    } else {
      // 先に米英つづりを米式へ寄せる（"favour" -> "favor"、"metre" -> "meter"）。
      // 単位より先に行うことで、綴り違いの単位も UNIT_ALIASES が受けられる
      var word = normalizeSpelling(words[i]);
      // 単位は正規形へ（"kg" と "kilograms" をどちらも "kilogram" に）
      var canonical = UNIT_ALIASES.has(word) ? UNIT_ALIASES.get(word) : word;
      var parts = canonical.split(/\s+/).filter(function (w) { return w.length > 0; });
      for (var p = 0; p < parts.length; p++) {
        result.push(parts[p]);
      }
      i++;
    }
  }
  return result;
}


// Python標準ライブラリ difflib.SequenceMatcher の移植。
// JavaScriptに同等品が無いため自前実装した（spec.txt 9-2節）。
// 「最長一致ブロックを見つけ、その左右を再帰的に処理する」方式で、
// 同点の場合は a側・b側の順に添字が小さいものを選ぶ（このタイブレークまで
// 揃えないと差分の出方がPython版とずれる）。
function SequenceMatcher(a, b, autojunk) {
  this.a = a;
  this.b = b;
  this.autojunk = autojunk === undefined ? true : autojunk;
  this.matchingBlocks = null;
  this.chainB();
}


SequenceMatcher.prototype.chainB = function () {
  var b = this.b;
  var b2j = new Map();
  for (var i = 0; i < b.length; i++) {
    if (!b2j.has(b[i])) {
      b2j.set(b[i], []);
    }
    b2j.get(b[i]).push(i);
  }
  // Python版は isjunk=None で呼んでいるため、junk要素は常に空
  this.bjunk = new Set();
  // 頻出しすぎる要素を比較対象から外す autojunk。b が200要素以上のときだけ働く。
  // 1文の出題では通常発動しないが、Python版と揃えるため実装しておく
  this.bpopular = new Set();
  var n = b.length;
  if (this.autojunk && n >= 200) {
    var ntest = Math.floor(n / 100) + 1;
    var self = this;
    b2j.forEach(function (idxs, elt) {
      if (idxs.length > ntest) {
        self.bpopular.add(elt);
      }
    });
    this.bpopular.forEach(function (elt) {
      b2j.delete(elt);
    });
  }
  this.b2j = b2j;
};


SequenceMatcher.prototype.findLongestMatch = function (alo, ahi, blo, bhi) {
  var a = this.a;
  var b = this.b;
  var b2j = this.b2j;
  var bjunk = this.bjunk;
  var besti = alo;
  var bestj = blo;
  var bestsize = 0;

  // j2len[j] = 「a[i]で終わり b[j]で終わる連続一致の長さ」。
  // iを1つ進めるたびに作り直すことで、直前の行の値だけを引き継ぐ
  var j2len = new Map();
  for (var i = alo; i < ahi; i++) {
    var newj2len = new Map();
    var indices = b2j.has(a[i]) ? b2j.get(a[i]) : [];
    for (var x = 0; x < indices.length; x++) {
      var j = indices[x];
      if (j < blo) { continue; }
      if (j >= bhi) { break; }
      var prev = j2len.has(j - 1) ? j2len.get(j - 1) : 0;
      var k = prev + 1;
      newj2len.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = newj2len;
  }

  // 見つけたブロックを、junkでない要素で前後に伸ばす
  while (besti > alo && bestj > blo &&
         !bjunk.has(b[bestj - 1]) &&
         a[besti - 1] === b[bestj - 1]) {
    besti--; bestj--; bestsize++;
  }
  while (besti + bestsize < ahi && bestj + bestsize < bhi &&
         !bjunk.has(b[bestj + bestsize]) &&
         a[besti + bestsize] === b[bestj + bestsize]) {
    bestsize++;
  }

  // 続けて、junk要素の分も前後に伸ばす
  while (besti > alo && bestj > blo &&
         bjunk.has(b[bestj - 1]) &&
         a[besti - 1] === b[bestj - 1]) {
    besti--; bestj--; bestsize++;
  }
  while (besti + bestsize < ahi && bestj + bestsize < bhi &&
         bjunk.has(b[bestj + bestsize]) &&
         a[besti + bestsize] === b[bestj + bestsize]) {
    bestsize++;
  }

  return [besti, bestj, bestsize];
};


SequenceMatcher.prototype.getMatchingBlocks = function () {
  if (this.matchingBlocks !== null) {
    return this.matchingBlocks;
  }
  var la = this.a.length;
  var lb = this.b.length;

  var queue = [[0, la, 0, lb]];
  var blocks = [];
  while (queue.length > 0) {
    var range = queue.pop();
    var alo = range[0], ahi = range[1], blo = range[2], bhi = range[3];
    var match = this.findLongestMatch(alo, ahi, blo, bhi);
    var i = match[0], j = match[1], k = match[2];
    if (k) {
      blocks.push([i, j, k]);
      if (alo < i && blo < j) {
        queue.push([alo, i, blo, j]);
      }
      if (i + k < ahi && j + k < bhi) {
        queue.push([i + k, ahi, j + k, bhi]);
      }
    }
  }
  // Pythonのタプル比較と同じ順序（i → j → k）で並べ替える。
  // JSのsortは既定が文字列比較なので、比較関数を必ず渡すこと
  blocks.sort(function (x, y) {
    return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
  });

  // 隣接するブロックを1つにまとめる
  var i1 = 0, j1 = 0, k1 = 0;
  var nonAdjacent = [];
  for (var bi = 0; bi < blocks.length; bi++) {
    var i2 = blocks[bi][0], j2 = blocks[bi][1], k2 = blocks[bi][2];
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
    } else {
      if (k1) {
        nonAdjacent.push([i1, j1, k1]);
      }
      i1 = i2; j1 = j2; k1 = k2;
    }
  }
  if (k1) {
    nonAdjacent.push([i1, j1, k1]);
  }
  nonAdjacent.push([la, lb, 0]);

  this.matchingBlocks = nonAdjacent;
  return nonAdjacent;
};


SequenceMatcher.prototype.getOpcodes = function () {
  var i = 0, j = 0;
  var answer = [];
  var blocks = this.getMatchingBlocks();
  for (var bi = 0; bi < blocks.length; bi++) {
    var ai = blocks[bi][0], bj = blocks[bi][1], size = blocks[bi][2];
    var tag = "";
    if (i < ai && j < bj) {
      tag = "replace";
    } else if (i < ai) {
      tag = "delete";
    } else if (j < bj) {
      tag = "insert";
    }
    if (tag) {
      answer.push([tag, i, ai, j, bj]);
    }
    i = ai + size;
    j = bj + size;
    if (size) {
      answer.push(["equal", ai, i, bj, j]);
    }
  }
  return answer;
};


function buildDiff(targetText, saidText) {
  var targetWords = normalizeWords(targetText);
  var saidWords = normalizeWords(saidText);
  var matcher = new SequenceMatcher(targetWords, saidWords);

  var diff = [];
  var opcodes = matcher.getOpcodes();
  for (var oi = 0; oi < opcodes.length; oi++) {
    var tag = opcodes[oi][0];
    var i1 = opcodes[oi][1], i2 = opcodes[oi][2];
    var j1 = opcodes[oi][3], j2 = opcodes[oi][4];
    if (tag === "equal") {
      for (var e = i1; e < i2; e++) {
        diff.push({ type: "equal", word: targetWords[e] });
      }
    } else if (tag === "replace") {
      var targetChunk = targetWords.slice(i1, i2);
      var saidChunk = saidWords.slice(j1, j2);
      var len = Math.max(targetChunk.length, saidChunk.length);
      for (var k = 0; k < len; k++) {
        var t = k < targetChunk.length ? targetChunk[k] : null;
        var s = k < saidChunk.length ? saidChunk[k] : null;
        if (t !== null && s !== null) {
          diff.push({ type: "replace", target: t, said: s });
        } else if (t !== null) {
          diff.push({ type: "delete", target: t });
        } else {
          diff.push({ type: "insert", said: s });
        }
      }
    } else if (tag === "delete") {
      for (var d = i1; d < i2; d++) {
        diff.push({ type: "delete", target: targetWords[d] });
      }
    } else if (tag === "insert") {
      for (var n = j1; n < j2; n++) {
        diff.push({ type: "insert", said: saidWords[n] });
      }
    }
  }
  return diff;
}


// テスト（jsc）からもブラウザからも同じ形で使えるようにしておく
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeWords: normalizeWords,
    buildDiff: buildDiff,
    SequenceMatcher: SequenceMatcher,
  };
}
