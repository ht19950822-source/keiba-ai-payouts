/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-08-rebuild-9";

const HISTORY_VENUES = {

  "01": "札幌",
  "02": "函館",
  "03": "福島",
  "04": "新潟",
  "05": "東京",
  "06": "中山",
  "07": "中京",
  "08": "京都",
  "09": "阪神",
  "10": "小倉"

};


/* =========================================================
 * 共通JSON
 * ======================================================= */

function json(
  data,
  status = 200
) {

  return new Response(

    JSON.stringify(
      data,
      null,
      2
    ),

    {
      status,

      headers: {

        "Content-Type":
          "application/json; charset=UTF-8",

        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Methods":
          "GET,HEAD,OPTIONS",

        "Access-Control-Allow-Headers":
          "*",

        "Cache-Control":
          "no-store"

      }

    }

  );

}


/* =========================================================
 * OPTIONS
 * ======================================================= */

function handleOptions() {

  return new Response(
    null,
    {
      status: 204,

      headers: {

        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Methods":
          "GET,PUT,DELETE,HEAD,OPTIONS",

        "Access-Control-Allow-Headers":
          "*",

        "Access-Control-Max-Age":
          "86400"

      }
    }
  );

}


/* =========================================================
 * エラー
 * ======================================================= */

function errorResponse(
  message,
  status = 500
) {

  return json(

    {
      ok: false,
      error:
        String(
          message ||
          "Unknown Error"
        )
    },

    status

  );

}


/* =========================================================
 * 文字列正規化
 * ======================================================= */

function normalizeText(
  value
) {

  return String(
    value || ""
  )

    .replace(
      /&nbsp;/gi,
      " "
    )

    .replace(
      /&amp;/gi,
      "&"
    )

    .replace(
      /&lt;/gi,
      "<"
    )

    .replace(
      /&gt;/gi,
      ">"
    )

    .replace(
      /&quot;/gi,
      '"'
    )

    .replace(
      /&#39;/gi,
      "'"
    )

    .replace(
      /&#x27;/gi,
      "'"
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim();

}


/* =========================================================
 * HTMLタグ除去
 * ======================================================= */

function stripHtml(
  html
) {

  return String(
    html || ""
  )

    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )

    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )

    .replace(
      /<[^>]+>/g,
      " "
    );

}


/* =========================================================
 * 数値変換
 * ======================================================= */

function toNumberOrNull(
  value
) {

  const text =
    normalizeText(
      value
    );

  if (!text) {
    return null;
  }

  const number =
    Number(
      text.replace(
        /,/g,
        ""
      )
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;

}


/* =========================================================
 * 日付文字列
 * ======================================================= */

function getDaysInMonth(
  year,
  month
) {

  return new Date(
    year,
    month,
    0
  ).getDate();

}


/* =========================================================
 * 日付チェック
 * ======================================================= */

function isValidDateString(
  date
) {

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date || ""
    )
  ) {

    return false;

  }

  const parts =
    date.split("-");

  const year =
    Number(parts[0]);

  const month =
    Number(parts[1]);

  const day =
    Number(parts[2]);

  if (
    year < 1900 ||
    year > 2100
  ) {

    return false;

  }

  if (
    month < 1 ||
    month > 12
  ) {

    return false;

  }

  const maxDay =
    getDaysInMonth(
      year,
      month
    );

  return (
    day >= 1 &&
    day <= maxDay
  );

}


/* =========================================================
 * JRA HTML取得
 *
 * JRAはShift_JISのページがあるため
 * arrayBufferからTextDecoderで変換する。
 * ======================================================= */

async function fetchJRAHtmlOnce(
  url
) {

  const response =
    await fetch(

      url,

      {
        method: "GET",

        headers: {

          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          "Accept-Language":
            "ja,en-US;q=0.9,en;q=0.8",

          "Cache-Control":
            "no-cache"

        }

      }

    );

  if (
    !response.ok
  ) {

    throw new Error(
      `JRA取得失敗: HTTP ${response.status} ${url}`
    );

  }

  const buffer =
    await response.arrayBuffer();

  const decoder =
    new TextDecoder(
      "shift_jis"
    );

  return decoder.decode(
    buffer
  );

}


/* =========================================================
 * JRA URLを絶対URLへ変換
 * ======================================================= */

function extractJRAInternalCnames(
  html,
  targetPrefix
) {

  const found =
    new Set();

  if (!html) {
    return [];
  }

  /*
   * CNAME=形式
   */

  const cnamePattern =
    /CNAME\s*=\s*["']?([^"'&<>\s#]+)["']?/gi;

  let match;

  while (
    (match =
      cnamePattern.exec(html)) !== null
  ) {

    let cname =
      match[1]
        .replace(/&amp;/gi, "&")
        .replace(/%26/gi, "&")
        .trim();

    cname =
      cname
        .split('"')[0]
        .split("'")[0]
        .split(">")[0]
        .split("<")[0];

    if (
      cname
        .toLowerCase()
        .startsWith(
          targetPrefix.toLowerCase()
        )
    ) {

      found.add(
        cname
      );

    }
  }


  /*
   * JavaScript等に直接書かれている形式
   */

  const directPattern =
    new RegExp(
      `(${targetPrefix}[^"'<>\\s]+)`,
      "gi"
    );

  while (
    (match =
      directPattern.exec(html)) !== null
  ) {

    let cname =
      match[1]
        .replace(
          /&amp;/gi,
          "&"
        )
        .trim();

    cname =
      cname
        .split('"')[0]
        .split("'")[0]
        .split(">")[0]
        .split("<")[0]
        .split(")")[0]
        .split(";")[0];

    if (
      cname
        .toLowerCase()
        .startsWith(
          targetPrefix.toLowerCase()
        )
    ) {

      found.add(
        cname
      );

    }
  }


  return Array.from(
    found
  );
}


/* =========================================================
 * JRAレースリンク抽出
 * ======================================================= */

function parseJRACname(url) {

  try {

    const u =
      new URL(url);

    const cname =
      u.searchParams.get("CNAME") || "";

    const m =
      cname.match(
        /pw01sde(\d{4})(\d{8})(\d{2})(\d{8})(?:\/[^\/]+)?$/i
      );

    if (!m) {
      return null;
    }

    return {

      type: "result",

      venueCode:
        m[1].slice(-2),

      meetingDate:
        m[2],

      raceNo:
        Number(m[3]),

      date:
        `${m[4].slice(0, 4)}-${m[4].slice(4, 6)}-${m[4].slice(6, 8)}`,

      url

    };

  } catch {

    return null;

  }

}

function extractCourseInfo(
  html
) {
  const result = { surface: "", distance: null, raw: "" };
  // 全角の数字・記号（１，６００ｍ など）を半角に揃える
  const T = normalizeText(stripHtml(html)).normalize("NFKC");
  const validDistance = n => Number.isFinite(n) && n >= 800 && n <= 4500;
  const toDist = v => Number(String(v).replace(/[,，]/g, ""));
  const SURF = /(ダート|芝|障害|ダ(?!ート))/;
  const toSurface = w => (w === "芝" ? "芝" : w === "障害" ? "障害" : w ? "ダート" : "");

  // 診断用：コース情報の周辺の文字（取得できなかったときに原因を確認できる）
  const ci = T.search(/コース/);
  const near = ci >= 0 ? T.slice(ci, ci + 90) : "";
  result.raw = near;

  // 距離①：「コース：」の直後
  let m = near.match(/([\d,]{3,6})\s*(?:メートル|m|M)/);
  if (m && validDistance(toDist(m[1]))) result.distance = toDist(m[1]);

  // 距離②：全体から「数字＋メートル/m」を順に探し、距離として妥当な最初のもの
  let distIndex = -1;
  if (!result.distance) {
    for (const mm of T.matchAll(/([\d,]{3,6})\s*(?:メートル|m|M)/g)) {
      if (validDistance(toDist(mm[1]))) { result.distance = toDist(mm[1]); distIndex = mm.index; break; }
    }
  }
  // 距離③：「芝1,600」「ダート1200」「芝・外 1,600」型
  if (!result.distance) {
    const mm = T.match(/(?:芝|ダート|ダ|障害)[^\d]{0,8}([\d,]{4,6})/);
    if (mm && validDistance(toDist(mm[1]))) result.distance = toDist(mm[1]);
  }

  // 芝・ダート①：「コース：」の周辺（括弧の中の順序が違っても拾う）
  m = near.match(SURF);
  if (m) result.surface = toSurface(m[1]);
  // ②：距離の前後
  if (!result.surface && result.distance) {
    const k = distIndex >= 0 ? distIndex : T.search(new RegExp(String(result.distance).replace(/(\d)(\d{3})$/, "$1,?$2") + "\\s*(?:メートル|m|M)"));
    if (k >= 0) {
      const around = T.slice(Math.max(0, k - 40), k + 60);
      const mm = around.match(SURF);
      if (mm) result.surface = toSurface(mm[1]);
    }
  }
  // ③：ページ冒頭付近（ナビゲーションなど無関係な文字が混ざりにくい範囲）
  if (!result.surface) {
    const mm = T.slice(0, 1500).match(SURF);
    if (mm) result.surface = toSurface(mm[1]);
  }
  return result;
}

/* =========================================================
 * レース名
 * ======================================================= */

function extractRaceName(
  html
) {

  const patterns = [

    /<span[^>]*class=["'][^"']*\brace_name\b[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\/span>/i,

    /<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/i

  ];


  for (
    const pattern of patterns
  ) {

    const match =
      html.match(
        pattern
      );

    if (!match) {
      continue;
    }


    const value =
      normalizeText(
        stripHtml(
          match[1]
        )
      );


    if (value) {
      return value;
    }

  }


  return "";

}


/* =========================================================
 * 天候
 * ======================================================= */

function extractWeather(
  html
) {

  const patterns = [

    /<li[^>]*class=["'][^"']*\bweather\b[^"']*["'][\s\S]*?<span[^>]*class=["'][^"']*\btxt\b[^"']*["'][^>]*>\s*([^<]+?)\s*<\/span>/i,

    /天候[：:]\s*([^ <]+)/i

  ];


  for (
    const pattern of patterns
  ) {

    const match =
      html.match(
        pattern
      );


    if (!match) {
      continue;
    }


    const value =
      normalizeText(
        match[1]
      );


    if (value) {
      return value;
    }

  }


  return "";

}


/* =========================================================
 * 馬場状態
 * ======================================================= */

function extractTrackCondition(
  html
) {

  const patterns = [

    /<li[^>]*class=["'][^"']*\bdurt\b[^"']*["'][\s\S]*?<span[^>]*class=["'][^"']*\btxt\b[^"']*["'][^>]*>\s*([^<]+?)\s*<\/span>/i,

    /馬場[：:]\s*([^ <]+)/i

  ];


  for (
    const pattern of patterns
  ) {

    const match =
      html.match(
        pattern
      );


    if (!match) {
      continue;
    }


    const value =
      normalizeText(
        match[1]
      );


    if (value) {
      return value;
    }

  }


  return "";

}


/* =========================================================
 * TDセルの文字列取得
 * ======================================================= */

function getCellText(
  row,
  className
) {

  const escaped =
    className.replace(
      /[-/\\^$*+?.()|[\]{}]/g,
      "\\$&"
    );


  const re =
    new RegExp(

      `<td[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,

      "i"

    );


  const match =
    row.match(
      re
    );


  if (!match) {
    return "";
  }


  return normalizeText(
    stripHtml(
      match[1]
    )
  );

}


/* =========================================================
 * 枠番
 * ======================================================= */

function extractFrameNumber(
  row
) {

  const patterns = [

    /<td[^>]*class=["'][^"']*\bwaku\b[^"']*["'][^>]*>[\s\S]*?<img[^>]*alt=["']枠(\d+)[^"']*["']/i,

    /枠(\d+)/i

  ];


  for (
    const pattern of patterns
  ) {

    const match =
      row.match(
        pattern
      );


    if (!match) {
      continue;
    }


    const value =
      Number(
        match[1]
      );


    if (
      Number.isFinite(
        value
      )
    ) {

      return value;

    }

  }


  return null;

}
/* =========================================================
 * 第3回 / 10
 * 馬データ解析・JRA結果解析
 * ======================================================= */


/* =========================================================
 * 馬名取得
 * ======================================================= */

function extractHorseName(row) {
  const horseCell = String(row || "").match(
    /<td[^>]*class=["'][^"']*\bhorse\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
  );
  if (!horseCell) return "";

  const inner = horseCell[1];
  const anchorPattern = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(inner)) !== null) {
    const name = normalizeText(stripHtml(match[1]));
    if (name) return name;
  }

  const plain = normalizeText(stripHtml(inner));
  return plain;
}


/* =========================================================
 * 性齢解析
 * ======================================================= */

function parseSexAge(
  value
) {

  const text =
    normalizeText(
      value
    );


  const ageMatch =
    text.match(
      /(\d+)/
    );


  const age =
    ageMatch
      ? Number(
          ageMatch[1]
        )
      : null;


  const sex =
    text
      .replace(
        /\d/g,
        ""
      )
      .trim();


  return {

    sex,

    age

  };

}


/* =========================================================
 * 馬体重解析
 * ======================================================= */

function parseHorseWeight(
  value
) {

  const text =
    normalizeText(
      value
    );


  const match =
    text.match(
      /^(\d+)\s*(?:\(([+-]?\d+)\))?$/
    );


  if (!match) {

    return {

      horseWeight:
        null,

      horseWeightChange:
        null

    };

  }


  return {

    horseWeight:
      Number(
        match[1]
      ),

    horseWeightChange:
      match[2] != null
        ? Number(
            match[2]
          )
        : null

  };

}


/* =========================================================
 * コーナー情報
 * ======================================================= */

function extractCornerInfo(
  row
) {

  const result = [];


  const re =
    /title=["'][^"']*(?:コーナー|corner)[^"']*["'][^>]*>\s*([^<]+)\s*</gi;


  let match;


  while (
    (match = re.exec(
      row
    )) !== null
  ) {

    const value =
      normalizeText(
        match[1]
      );


    if (value) {

      result.push(
        value
      );

    }

  }


  return [
    ...new Set(
      result
    )
  ];

}


/* =========================================================
 * JRA馬1頭分の解析
 * ======================================================= */


/* 馬ごとのコーナー通過順位（数値の配列）。表のcorner列(li/div/テキスト)→title属性の順に試す */
function extractCornerPositions(row) {
  const src = String(row || "");
  const cell = src.match(/<td[^>]*class="[^"]*\bcorner\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
  let vals = [];
  if (cell) {
    const body = cell[1];
    const lis = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => normalizeText(stripHtml(m[1])));
    vals = lis.map(t => (t.match(/\d{1,2}/g) || []).pop()).filter(Boolean).map(Number);
    if (!vals.length) vals = (normalizeText(stripHtml(body)).match(/\d{1,2}/g) || []).map(Number);
  }
  if (!vals.length) {
    const re = /title=["'][^"']*コーナー[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*(\d{1,2})/gi;
    let m;
    while ((m = re.exec(src)) !== null) vals.push(Number(m[1]));
  }
  return vals.filter(v => v >= 1 && v <= 18).slice(0, 4);
}

/* レースのラップ（ハロンタイム）。「ハロンタイム」の後ろの 10〜20秒台の数値の並び */
function extractJRALap(html) {
  const text = String(html || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  for (const label of ["ハロンタイム", "ラップタイム"]) {
    let from = 0;
    while (true) {
      const i = text.indexOf(label, from);
      if (i < 0) break;
      const seg = text.slice(i + label.length, i + label.length + 420);
      const nums = [];
      const re = /(\d{1,2}\.\d)(?!\d)/g;
      let m, lastEnd = 0;
      while ((m = re.exec(seg)) !== null) {
        const gap = seg.slice(lastEnd, m.index);
        if (nums.length && /[^\s\-－―–~〜,、.:：]/.test(gap)) break;
        const v = Number(m[1]);
        if (v < 9 || v > 20) { if (nums.length) break; lastEnd = re.lastIndex; continue; }
        nums.push(v);
        lastEnd = re.lastIndex;
      }
      if (nums.length >= 5) return nums;
      from = i + label.length;
    }
  }
  return null;
}

/* 診断：ラップ・通過順位がページのどこにどう書かれているか */
async function handleDebugResult(request) {
  const url = new URL(request.url);
  const cname = String(url.searchParams.get("cname") || "");
  if (!/^pw01sde\d{4}\d{8}\d{2}\d{8}\/[0-9A-Za-z]{1,4}$/.test(cname)) return errorResponse("cname=pw01sde… を指定してください。", 400);
  try {
    const html = await fetchJRAHtml(`${JRA_BASE}/JRADB/accessS.html?CNAME=${encodeURIComponent(cname)}`);
    const flat = s => String(s || "").replace(/\s+/g, " ");
    const at = (needle, w) => { const i = html.indexOf(needle); return i < 0 ? "" : flat(html.slice(Math.max(0, i - 80), i + w)); };
    const rows = (html.match(/<tr[\s\S]*?<\/tr>/gi) || []).filter(t => /accessU\.html/i.test(t));
    return json({
      ok: true, htmlLength: html.length,
      hasHalon: html.includes("ハロンタイム"), hasLapLabel: html.includes("ラップ"),
      lap: extractJRALap(html),
      lapSnippet: at("ハロンタイム", 700) || at("ラップ", 700),
      cornerLabelSnippet: at("コーナー", 500),
      rowCount: rows.length,
      firstRowCorner: rows.slice(0, 6).map(r => extractCornerPositions(r)),
      cornerCellHtml: flat((rows[0] || "").match(/<td[^>]*class="[^"]*\bcorner\b[^"]*"[\s\S]*?<\/td>/i)?.[0] || "").slice(0, 700),
      firstRowHtml: flat(rows[0] || "").slice(0, 1800)
    });
  } catch (error) {
    return errorResponse(error?.message || error, 500);
  }
}

function parseJRAHorseRow(
  row
) {

  const horseName =
    extractHorseName(
      row
    );


  /*
   * 馬名がない行は
   * 馬データではない。
   *
   * これにより
   * 「1:32.9」
   * 「不良」
   * 「稍重」
   * などの誤認識を防ぐ。
   */

  if (!horseName) {
    return null;
  }


  const finishText =
    getCellText(
      row,
      "place"
    );


  const numberText =
    getCellText(
      row,
      "num"
    );


  const weightText =
    getCellText(
      row,
      "weight"
    );


  const jockey =
    getCellText(
      row,
      "jockey"
    )
      .replace(
        /^☆\s*/,
        ""
      )
      .trim();


  const trainer =
    getCellText(
      row,
      "trainer"
    );


  const time =
    getCellText(
      row,
      "time"
    );


  const estimatedLast3F =
    toNumberOrNull(
      getCellText(
        row,
        "f_time"
      )
    );


  const sexAgeText =
    getCellText(
      row,
      "age"
    );


  const sexAge =
    parseSexAge(
      sexAgeText
    );


  const horseWeight =
    parseHorseWeight(
      getCellText(
        row,
        "h_weight"
      )
    );


  /*
   * 人気は保存する。
   *
   * ただしAI入力では使用しない。
   */

  const popularity =
    toNumberOrNull(
      getCellText(
        row,
        "pop"
      )
    );


  return {

    finishPosition:
      toNumberOrNull(
        finishText
      ),

    frame:
      extractFrameNumber(
        row
      ),

    horseNumber:
      toNumberOrNull(
        numberText
      ),

    horseName,

    sex:
      sexAge.sex,

    age:
      sexAge.age,

    weight:
      toNumberOrNull(
        weightText
      ),

    jockey,

    trainer,

    time,

    estimatedLast3F,

    horseWeight:
      horseWeight.horseWeight,

    horseWeightChange:
      horseWeight.horseWeightChange,

    corner: extractCornerPositions(row),

    popularity

  };

}


/* =========================================================
 * JRA結果ページ解析
 * ======================================================= */

function extractJRAResultInfo(
  html
) {

  const result = {

    raceName:
      extractRaceName(
        html
      ),

    surface:
      "",

    distance:
      null,

    weather:
      extractWeather(
        html
      ),

    trackCondition:
      extractTrackCondition(
        html
      ),

    horses:
      []

  };


  const course =
    extractCourseInfo(
      html
    );


  result.surface =
    course.surface;


  result.distance =
    course.distance;


  /*
   * tbodyごとに解析する。
   */

  const tbodyMatches =
    String(
      html || ""
    ).match(
      /<tbody[\s\S]*?<\/tbody>/gi
    ) || [];


  for (
    const tbody of tbodyMatches
  ) {

    const rows =
      tbody.match(
        /<tr[\s\S]*?<\/tr>/gi
      ) || [];


    for (
      const row of rows
    ) {

      const horse =
        parseJRAHorseRow(
          row
        );


      if (horse) {

        result.horses.push(
          horse
        );

      }

    }

  }


  return result;

}


/* =========================================================
 * 1レース取得
 * ======================================================= */

function raceResultToRows(
  result
) {

  const rows = [];

  /*
   * raceNumber が存在しない場合は
   * raceNo から取得する。
   *
   * 現在のJRAデータでは raceNo が
   * 入っているため、これで undefined を防ぐ。
   */
  const raceNumber =
    result.raceNumber ??
    result.raceNo;

  for (
    const horse of
      result.horses || []
  ) {

    rows.push({

      date:
        result.date,

      raceId:
        makeRaceId(
          result.date,
          result.venueCode,
          raceNumber
        ),

      raceNumber:
        raceNumber,

      place:
        result.venue,

      venueCode:
        result.venueCode,

      raceName:
        result.raceName,

      surface:
        result.surface,

      distance:
        result.distance,

      weather:
        result.weather,

      going:
        result.trackCondition,

      finish:
        horse.finishPosition,

      frame:
        horse.frame,

      number:
        horse.horseNumber,

      horse:
        horse.horseName,

      age:
        horse.age,

      sex:
        horse.sex,

      weight:
        horse.weight,

      jockey:
        horse.jockey,

      trainer:
        horse.trainer,

      horseWeight:
        horse.horseWeight,

      horseWeightChange:
        horse.horseWeightChange,

      time:
        horse.time,

      estimatedLast3F:
        horse.estimatedLast3F,

      corner:
        horse.corner,

      /*
       * 保存はする。
       * AI入力には使用しない。
       */
      popularity:
        horse.popularity

    });

  }

  return rows;
}

/* =========================================================
 * レースID生成
 * ======================================================= */

function makeRaceId(
  date,
  venueCode,
  raceNumber
) {

  return (

    `${date}-` +
    `${venueCode}-` +
    `${String(
      raceNumber
    ).padStart(2, "0")}`

  );

}


/* =========================================================
 * AI入力からオッズ・人気を除外
 * ======================================================= */

async function fetchJRAHtmlPostOnce(
  path,
  cname
) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language":
      "ja,en-US;q=0.9,en;q=0.8",
    "Cache-Control":
      "no-cache"
  };

  // まずPOST方式で取得
  try {
    const response = await fetch(
      `${JRA_BASE}${path}`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body:
          `cname=${encodeURIComponent(cname)}`
      }
    );

    if (response.ok) {
      const buffer =
        await response.arrayBuffer();

      return new TextDecoder(
        "shift_jis"
      ).decode(buffer);
    }
  } catch (error) {
    // POST失敗時はGET方式を試す
  }

  // POSTが失敗した場合はGET方式で再試行
  const url = new URL(
    `${JRA_BASE}${path}`
  );

  url.searchParams.set(
    "CNAME",
    cname
  );

  const response = await fetch(
    url.toString(),
    {
      method: "GET",
      headers
    }
  );

  if (!response.ok) {
    throw new Error(
      `JRA取得失敗: POSTおよびGETが失敗。HTTP ${response.status} ${url.toString()}`
    );
  }

  const buffer =
    await response.arrayBuffer();

  return new TextDecoder(
    "shift_jis"
  ).decode(buffer);
}


/* =========================================================
 * JRA年月チェックコード取得
 *
 * JRA形式:
 * objParam["1904"]="XX"
 *
 * 1904 = 2019年04月
 * 2301 = 2023年01月
 * ======================================================= */


/* 一時的な失敗（5xx・429・通信断）は間隔をあけて最大3回まで再試行する */
async function withRetry(fn) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const msg = String(e?.message || e);
      if (/HTTP 4(?!29)\d\d/.test(msg)) break;          // 404などは再試行しない
      await new Promise(r => setTimeout(r, 400 * (i + 1) * (i + 1)));
    }
  }
  throw last;
}
async function fetchJRAHtml(url) { return withRetry(() => fetchJRAHtmlOnce(url)); }
async function fetchJRAHtmlPost(path, cname) { return withRetry(() => fetchJRAHtmlPostOnce(path, cname)); }

async function getJRAMonthCheckCode(
  year,
  month
) {

  const searchPage =
    await fetchJRAHtmlPost(
      "/JRADB/accessS.html",
      "pw01skl00999999/B3"
    );


  const yy =
    String(year)
      .slice(-2);

  const mm =
    String(month)
      .padStart(2, "0");

  const targetKey =
    `${yy}${mm}`;


  /*
   * JRAページ内の
   *
   * objParam["1901"]="XX"
   * objParam["1902"]="XX"
   *
   * を全部取得する。
   *
   * 特定年月だけを直接検索するより
   * JRA側の空白・改行等にも強い。
   */

  const pattern =
    /objParam\s*\[\s*["'](\d{4})["']\s*\]\s*=\s*["']([^"']+)["']/gi;


  const params =
    new Map();

  let match;

  while (
    (match =
      pattern.exec(
        searchPage
      )) !== null
  ) {

    params.set(
      match[1],
      match[2]
    );

  }


  const checkCode =
    params.get(
      targetKey
    );


  if (!checkCode) {

    throw new Error(
      `JRA年月チェックコード取得失敗: ${year}-${mm} / key=${targetKey} / found=${params.size}`
    );

  }


  return checkCode;
}


/* =========================================================
 * 指定年月の開催日ページを取得
 *
 * 過去レース検索
 * ↓
 * pw01srl
 * ↓
 * 開催日ページ
 * ======================================================= */

async function discoverJRAMeetingPages(
  year,
  month
) {

  const checkCode =
    await getJRAMonthCheckCode(
      year,
      month
    );


  const yyyymm =
    `${year}${String(month).padStart(2, "0")}`;


  const cname =
    `pw01skl10${yyyymm}/${checkCode}`;


  const html =
    await fetchJRAHtmlPost(
      "/JRADB/accessS.html",
      cname
    );

 
console.log("JRA開催ページHTML調査", {
  cname,
  htmlLength: html ? html.length : 0,
  hasSrl: /pw01srl/i.test(html || ""),
  srlMatches: (html || "").match(/.{0,100}pw01srl.{0,200}/gi)?.slice(0, 5) || [],
  links: (html || "").match(/(?:href|action)\s*=\s*["'][^"']+["']/gi)?.slice(0, 15) || [],
  scripts: (html || "").match(/<script[^>]*src=["'][^"']+["']/gi)?.slice(0, 10) || [],
  title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim(),
  hasObjParam: /objParam/i.test(html),
  hasKaisai: /開催|競馬場|レース検索/.test(html),
  bodyStart: (html.match(/<body[^>]*>([\s\S]{0,600})/i)?.[1] || "").replace(/\s+/g, " ").slice(0, 400)
});



  if (
    !html ||
    html.length < 500
  ) {

    throw new Error(
      `JRA過去レース検索ページ取得失敗: ${yyyymm}`
    );

  }


  /*
   * 開催日ページ
   *
   * pw01srl
   *
   * を抽出する。
   */

  const srlCnames =
    extractJRAInternalCnames(
      html,
      "pw01srl"
    );

  console.log("JRA月別ページ調査", {
  htmlLength: html.length,
  meetingLinkCount: srlCnames.length,
  meetingLinks: srlCnames.slice(0, 10)
});

  return srlCnames;
}


/* =========================================================
 * 指定日のレース結果URLを発見
 *
 * 年月
 * ↓
 * 開催日ページ
 * ↓
 * レース結果URL
 * ======================================================= */

function parseJRAEntryCname(cname, sourceUrl = "") {
  const value = String(cname || "").replace(/&amp;/gi, "&").trim();
  // JRA公式ページでは pw01dde / sw01dde / sw01ddd など複数の接頭辞が使われる。
  // 接頭辞や末尾の識別コードをレース番号から推測せず、実際のCNAMEを解析する。
  const m = value.match(
    /^(?:pw|sw)01dd[de]01(\d{2})(\d{8})(\d{2})(\d{8})\/([0-9a-f]+)$/i
  );
  if (!m) return null;

  const [, venueCode, meetingDate, raceNoText, dateText] = m;
  const raceNo = Number(raceNoText);
  if (!HISTORY_VENUES[venueCode] || raceNo < 1 || raceNo > 12) return null;
  if (!/^\d{8}$/.test(dateText) || !/^\d{8}$/.test(meetingDate)) return null;

  // リンクから取得できた場合は、JRA側が実際に指定したホストを維持する。
  // CNAME単独の場合のみ接頭辞に基づく既知の公式ホストを選ぶ。
  let host = "www.jra.go.jp";
  try {
    if (sourceUrl) host = new URL(sourceUrl).hostname;
    else if (/^sw01ddd/i.test(value)) host = "sp.jra.jp";
    else if (/^sw01dde/i.test(value)) host = "app.jra.jp";
  } catch {}

  return {
    type: "entry",
    date: `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`,
    venueCode,
    venue: HISTORY_VENUES[venueCode],
    venueName: HISTORY_VENUES[venueCode],
    meetingDate,
    raceNo,
    raceNumber: raceNo,
    cname: value,
    url: `https://${host}/JRADB/accessD.html?CNAME=${encodeURIComponent(value)}`
  };
}

function extractJRAEntryLinks(html, baseUrl = JRA_BASE) {
  const found = new Map();
  if (!html) return [];

  const addCandidate = (raw) => {
    if (!raw) return;
    let absolute;
    try {
      absolute = new URL(
        String(raw).replace(/&amp;/gi, "&").replace(/&#x2f;/gi, "/").replace(/&#47;/gi, "/"),
        baseUrl
      );
    } catch {
      return;
    }

    if (!["www.jra.go.jp", "sp.jra.jp", "app.jra.jp", "own.jra.jp"].includes(absolute.hostname)) return;
    if (!/\/JRADB\/accessD\.html$/i.test(absolute.pathname)) return;

    const cname = absolute.searchParams.get("CNAME");
    const parsed = parseJRAEntryCname(cname, absolute.toString());
    if (!parsed) return;

    // 公式リンクで指定されたホストとCNAMEを維持する。
    found.set(parsed.cname, { ...parsed, url: absolute.toString() });
  };

  const attrPattern = /(?:href|action)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrPattern.exec(html)) !== null) addCandidate(match[1]);

  // JRA pages sometimes embed CNAME links in JavaScript rather than href.
  const cnamePattern = /(?:https?:\/\/(?:www\.jra\.go\.jp|sp\.jra\.jp|app\.jra\.jp|own\.jra\.jp)?\/?[^"'<> ]*\/JRADB\/accessD\.html)?[^"'<> ]*CNAME(?:=|%3D)([^"'<> &]+)(?:&amp;|&|["'])?/gi;
  while ((match = cnamePattern.exec(html)) !== null) {
    let cname = match[1] || "";
    try { cname = decodeURIComponent(cname); } catch {}
    const parsed = parseJRAEntryCname(cname);
    if (parsed) found.set(parsed.cname, parsed);
  }

  // Also catch bare CNAME values embedded in script strings.
  const directPattern = /(((?:pw|sw)01dd[de])01\d{2}\d{8}\d{2}\d{8}\/[0-9a-f]{1,16})/gi;
  while ((match = directPattern.exec(html)) !== null) {
    const parsed = parseJRAEntryCname(match[1]);
    if (parsed) found.set(parsed.cname, parsed);
  }

  return [...found.values()];
}

function extractJRAEntryLinksForDate(html, date) {
  const found = new Map();
  if (!html) return [];
  // Lightweight scan: only inspect JRA's embedded CNAME-shaped race links.
  // This avoids the three full-HTML scans used by the general-purpose extractor.
  const directPattern = /(((?:pw|sw)01dd[de])01\d{2}\d{8}\d{2}\d{8}\/[0-9a-f]{1,16})/gi;
  let match;
  while ((match = directPattern.exec(html)) !== null) {
    const parsed = parseJRAEntryCname(match[1]);
    if (parsed && parsed.date === date) found.set(parsed.cname, parsed);
  }
  return [...found.values()];
}

/* =========================================================
 * 出馬表メニュー経由の探索
 * JRA公式の「出馬表」メニュー（固定CNAME）→ 開催場別ページ → 各レース
 * 結果ページの探索（月別→開催日→レース）と同じ考え方。
 * ======================================================= */

const JRA_ENTRY_TOP_CNAME = "pw01dli00/F3";

function extractJRAEntryListCnames(html) {
  const found = new Set();
  const re = /pw01dr[a-z]\d{2}\d*\/[0-9A-Fa-f]{1,4}/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) found.add(m[0]);
  return [...found];
}

async function discoverJRAEntryLinksViaMenu(date, diagnostics, venueFilter = null) {
  const out = [];
  let availableDates = [];
  try {
    const top = await fetchJRAHtmlPost("/JRADB/accessD.html", JRA_ENTRY_TOP_CNAME);
    const lists = extractJRAEntryListCnames(top);
    // 実物の形式：pw01drl00 + 開催場(2) + 開催(8) + 日付(8) + /チェック
    const parsed = lists.map(c => {
      const m = c.match(/^pw01dr[a-z]\d{2}(\d{2})(\d{8})(\d{8})\//i);
      return m
        ? { cname: c, venueCode: m[1], date: `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6, 8)}` }
        : { cname: c, venueCode: null, date: null };
    });
    availableDates = [...new Set(parsed.map(p => p.date).filter(Boolean))].sort();
    let target = parsed.filter(p => p.date === date && (!venueFilter || p.venueCode === venueFilter));
    if (!target.length && !availableDates.length) target = parsed; // 形式が想定外のときだけ全て候補にする
    diagnostics.push({
      step: "menu-top",
      htmlLength: top.length,
      listCount: lists.length,
      availableDates,
      targetCount: target.length,
      sample: lists.slice(0, 6)
    });
    for (const l of extractJRAEntryLinksForDate(top, date)) out.push(l);
    for (const p of target.slice(0, 6)) {
      try {
        const html = await fetchJRAHtmlPost("/JRADB/accessD.html", p.cname);
        const links = extractJRAEntryLinksForDate(html, date);
        diagnostics.push({
          step: "menu-list",
          cname: p.cname,
          htmlLength: html.length,
          raceLinks: links.length,
          ddeSamples: (html.match(/pw01dd[a-z]\d+\/[0-9A-Fa-f]+/gi) || []).slice(0, 3)
        });
        for (const l of links) out.push(l);
      } catch (error) {
        diagnostics.push({ step: "menu-list", cname: p.cname, error: String(error?.message || error) });
      }
    }
  } catch (error) {
    diagnostics.push({ step: "menu-top", error: String(error?.message || error) });
  }
  return { links: out, availableDates };
}

async function discoverJRAEntryRacesForDate(date = null, venueFilter = null) {
  if (date != null && !isValidDateString(date)) {
    throw new Error("date は YYYY-MM-DD 形式で指定してください");
  }

  const seedPages = [
    "https://www.jra.go.jp/keiba/thisweek/",
    "https://www.jra.go.jp/keiba/"
  ];
  const seeds = new Map();
  const diagnostics = [];

  // 最初の2ページだけを入口として確認する。
  for (const pageUrl of seedPages) {
    try {
      const html = await fetchJRAHtml(pageUrl);
      const links = extractJRAEntryLinks(html, pageUrl);
      diagnostics.push({ pageUrl, htmlLength: html.length, entryLinks: links.length });
      for (const link of links) seeds.set(link.cname, link);
    } catch (error) {
      diagnostics.push({ pageUrl, error: String(error?.message || error) });
    }
  }

  // 開催場を指定した場合は、その開催場のページだけをたどる（1回あたりの通信回数を減らす）。
  // 入口ページにその開催場のリンクがない場合のみ、他開催場のページ経由で探す。
  // 入口ページだけでは指定開催場の全レースが揃わない場合、出馬表メニュー経由で補う
  let menuInfo = null;
  if (date != null) {
    const have = [...seeds.values()].filter(r => r.date === date && (!venueFilter || r.venueCode === venueFilter)).length;
    if (have < 12) {
      menuInfo = await discoverJRAEntryLinksViaMenu(date, diagnostics, venueFilter);
      for (const link of menuInfo.links) seeds.set(link.cname, link);
    }
  }

  const baseSeeds = [...seeds.values()];
  const strictVenue = !!venueFilter && baseSeeds.some(r => r.venueCode === venueFilter);
  const allSeeds = strictVenue ? baseSeeds.filter(r => r.venueCode === venueFilter) : baseSeeds;
  const sameDateSeeds = date == null
    ? []
    : allSeeds.filter(race => race.date === date);

  // 指定日が入口ページにない場合、無関係なページを最大45件たどる旧処理を避け、
  // まず最大8件だけを探索する。対象日が見つかったら、その日の出馬表を優先する。
  const discoveryLimit = 8;
  const queue = date == null
    ? [...allSeeds]
    : sameDateSeeds.length > 0
      ? [...sameDateSeeds]
      : allSeeds.slice(0, discoveryLimit);

  const visited = new Set();
  const queued = new Set(queue.map(race => race.cname));
  const matches = new Map();
  const visitedByVenue = new Map();
  const maxPages = 45;

  while (queue.length > 0 && visited.size < maxPages) {
    const race = queue.shift();
    if (!race || visited.has(race.cname)) continue;
    visited.add(race.cname);

    try {
      const html = await fetchJRAHtml(race.url);

      // 1開催場あたり最初の2ページだけ、指定日分のCNAMEを軽量抽出する。
      // 旧処理は探索全体の先頭4ページだけを調べたため、7-10Rや12Rなどが欠落することがあった。
      // 汎用リンク抽出の3回スキャンを避け、対象日だけを拾ってCPU負荷も抑える。
      const venueVisits = (visitedByVenue.get(race.venueCode) || 0) + 1;
      visitedByVenue.set(race.venueCode, venueVisits);
      const shouldDiscoverLinks = date == null
        ? visited.size <= 6
        : (venueVisits <= 2 || matches.size === 0);
      const links = shouldDiscoverLinks
        ? (date == null
            ? extractJRAEntryLinks(html, race.url)
            : extractJRAEntryLinksForDate(html, date))
        : [];

      if ((date == null || race.date === date) && (!venueFilter || race.venueCode === venueFilter)) {
        matches.set(`${race.date}-${race.venueCode}-${race.raceNo}`, {
          ...race,
          entryInfo: extractJRAEntryInfo(html),
          htmlLength: html.length
        });
      }

      for (const link of links) {
        if (visited.has(link.cname) || queued.has(link.cname)) continue;
        if (date != null && link.date !== date) continue;
        if (strictVenue && link.venueCode !== venueFilter) continue;
        if (queue.length >= maxPages) continue;
        queue.push(link);
        queued.add(link.cname);
      }
    } catch (error) {
      diagnostics.push({
        cname: race.cname,
        error: String(error?.message || error)
      });
      if ((date == null || race.date === date) && (!venueFilter || race.venueCode === venueFilter)) {
        matches.set(`${race.date}-${race.venueCode}-${race.raceNo}`, {
          ...race,
          entryInfo: { raceName: "", surface: "", distance: null, horses: [] },
          fetchError: String(error?.message || error)
        });
      }
    }
  }

  const result = [...matches.values()]
    .filter(race => (date == null || race.date === date) && (!venueFilter || race.venueCode === venueFilter))
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.venueCode.localeCompare(b.venueCode) ||
      a.raceNo - b.raceNo
    );

  console.log("JRA出馬表リンク探索", {
    date,
    seedCount: seeds.size,
    sameDateSeedCount: sameDateSeeds.length,
    visitedCount: visited.size,
    raceCount: result.length,
    diagnostics: diagnostics.slice(0, 8)
  });

  if (result.length === 0 && menuInfo && menuInfo.availableDates.length && !menuInfo.availableDates.includes(date)) {
    throw new Error(
      `${date} はJRAの開催日ではありません。現在公開されている開催日：${menuInfo.availableDates.join("、")}`
    );
  }

  if (result.length === 0) {
    const searchNote = date != null && sameDateSeeds.length === 0
      ? ` 指定日のリンクが入口ページにないため、先頭${Math.min(discoveryLimit, allSeeds.length)}件だけ追加探索しました。`
      : "";
    throw new Error(
      `JRA公式ページから${date || "次回開催"}の出馬表リンクを発見できませんでした。` +
      `JRAの出馬表公開状況、または公式ページのリンク構造を確認してください。` +
      searchNote +
      ` (seed=${seeds.size}, visited=${visited.size})` +
      ` 診断=${JSON.stringify(diagnostics.slice(0, 6)).slice(0, 900)}`
    );
  }

  return result;
}

function getCellTextAny(row, classNames) {
  for (const className of classNames) {
    const value = getCellText(row, className);
    if (value) return value;
  }
  return "";
}

// JRA出馬表のHTMLは開催・端末向けページによってclass名が変わるため、
// class名が一致しない場合も馬リンクとセル順から必要情報を補完する。

function getEntryCells(row) {
  const cells = [];
  const re = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(String(row || ""))) !== null) {
    cells.push({ attrs: m[1] || "", html: m[2] || "", text: normalizeText(stripHtml(m[2] || "")) });
  }
  return cells;
}

function extractEntryHorseName(row) {
  const byClass = extractHorseName(row);
  if (byClass) return byClass;
  const anchors = String(row || "").match(/<a\b[^>]*href=["'][^"']*(?:accessU\.html|horse)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const anchor of anchors) {
    const m = anchor.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    const name = m ? normalizeText(stripHtml(m[1])) : "";
    if (name && !/^\d+$/.test(name)) return name;
  }
  return "";
}

/* 出馬表の騎手欄は「58.0kg 川田 将雅 (栗東)」のように重量・所属が混ざることがあるため、名前だけにする */

function cleanJockeyText(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t
    .replace(/\d{2}(?:\.\d)?\s*(?:kg|ｋｇ|Kg)/gi, " ")
    .replace(/(?:^|\s)\d{2}\.\d(?=\s|$)/g, " ")
    .replace(/[（(][^）)]{0,8}[）)]/g, " ")
    .replace(/(?:栗東|美浦|地方|外国|招待|ＪＲＡ|JRA)/g, " ")
    .replace(/[☆★▲△◇◆]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}


/* 調教師欄は「栗東・杉山 晴紀」「(栗)杉山晴紀」のように所属が混ざることがあるため、名前だけにする */
function cleanTrainerText(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t
    .replace(/[（(][^）)]{0,6}[）)]/g, " ")
    .replace(/(?:栗東|美浦|地方|外国|招待|ＪＲＡ|JRA)\s*[・･]?/g, " ")
    .replace(/[・･]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

/* 入れ子の要素（p/div/span等）のclass名から読む */
function pickInner(row, names) {
  const re = new RegExp("<(p|div|span|a|li|dd|dt)\\b[^>]*class=[\"'][^\"']*\\b(?:" + names.join("|") + ")\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/\\1>", "i");
  const m = String(row || "").match(re);
  return m ? normalizeText(stripHtml(m[2])) : "";
}
/* リンク先のURLで読む（騎手=accessK / 調教師=accessC） */
function pickAnchor(row, hrefPattern) {
  const re = new RegExp("<a\\b[^>]*href=[\"'][^\"']*(?:" + hrefPattern + ")[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/a>", "i");
  const m = String(row || "").match(re);
  return m ? normalizeText(stripHtml(m[1])) : "";
}
/* 表の見出し（騎手・調教師の列位置）。class名が合わないとき、列の並びから読むために使う */
function entryHeaderMap(headHtml) {
  const ths = [...String(headHtml || "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => normalizeText(stripHtml(m[1])));
  if (!ths.length) return null;
  const find = re => ths.findIndex(t => re.test(t));
  return { len: ths.length, jockey: find(/騎手/), trainer: find(/調教師|厩舎/), texts: ths.join("|") };
}
function parseJRAEntryHorseRow(row, hdr) {
  const horseName = extractEntryHorseName(row);
  if (!horseName) return null;
  const cells = getEntryCells(row);
  const horseCellIdx = cells.findIndex(c => /accessU\.html/i.test(c.html) || /\b(?:horse|bamei)\b/i.test(c.attrs));
  // 馬番：class名 → 入れ子class → 馬名セルより前の数字セルのうち最後（枠→馬番→馬名の並び）
  let numberText = getCellTextAny(row, ["num", "umaban", "horse_num", "horseNumber", "HorseNum", "Umaban"]);
  if (!numberText) numberText = pickInner(row, ["umaban", "horse_num", "num"]);
  if (!numberText) {
    const lim = horseCellIdx > 0 ? horseCellIdx : Math.min(cells.length, 4);
    let last = "";
    for (const cell of cells.slice(0, lim)) {
      const value = String(cell.text || "").replace(/[^0-9]/g, "");
      const n = Number(value);
      if (value && Number.isInteger(n) && n >= 1 && n <= 18) last = String(n);
    }
    numberText = last;
  }
  const horseNumber = toNumberOrNull(String(numberText).replace(/[^0-9]/g, ""));
  if (horseNumber == null || horseNumber < 1 || horseNumber > 18) return null;
  const weightText = getCellTextAny(row, ["weight", "futan", "burden_weight"]) || pickInner(row, ["weight", "futan"]);
  // 騎手：class名 → セル属性 → 入れ子class → リンク先
  let jockey = getCellTextAny(row, ["jockey", "kisyu", "rider"]);
  if (!jockey) jockey = cells.find(c => /(?:jockey|kisyu|rider)/i.test(c.attrs))?.text || "";
  if (!jockey) jockey = pickInner(row, ["jockey", "kisyu", "rider"]);
  if (!jockey) jockey = pickAnchor(row, "accessK\\.html");
  if (!jockey && hdr && hdr.jockey >= 0 && cells.length === hdr.len) jockey = cells[hdr.jockey]?.text || "";
  const jockeyRaw = jockey;
  jockey = cleanJockeyText(jockey.replace(/^[☆★▲△\s]+/, "").trim());
  const ageText = getCellTextAny(row, ["age", "sex_age", "sexage"]) || pickInner(row, ["age", "sex_age"]);
  const ageMatch = ageText.match(/([牡牝セ騙])\s*(\d+)/);
  // 調教師：class名 → セル属性 → 入れ子class → リンク先 → 「(栗)名前」の形
  let trainer = getCellTextAny(row, ["trainer", "chokyo", "trainer_name"]);
  if (!trainer) trainer = cells.find(c => /(?:trainer|chokyo|kyusya|stable)/i.test(c.attrs))?.text || "";
  if (!trainer) trainer = pickInner(row, ["trainer", "chokyo", "kyusya"]);
  if (!trainer) trainer = pickAnchor(row, "accessC\\.html");
  if (!trainer) {
    const t = normalizeText(stripHtml(row)).match(/[（(](?:栗|美)[）)]\s*([^\s（()）\d]{1,6}(?:\s[^\s（()）\d]{1,6})?)/);
    trainer = t ? t[1] : "";
  }
  if (!trainer && hdr && hdr.trainer >= 0 && cells.length === hdr.len) trainer = cells[hdr.trainer]?.text || "";
  const trainerRaw = trainer;
  trainer = cleanTrainerText(trainer);
  if (trainer && jockey && trainer === jockey) trainer = "";
  return {
    finishPosition: null,
    frame: extractFrameNumber(row),
    horseNumber,
    horseName,
    sex: ageMatch ? ageMatch[1] : "",
    age: ageMatch ? Number(ageMatch[2]) : null,
    weight: toNumberOrNull(weightText.replace(/[^\d.]/g, "")),
    jockey,
    jockeyRaw,
    trainer,
    trainerRaw,
    time: "",
    estimatedLast3F: null,
    horseWeight: null,
    horseWeightChange: null,
    corner: [],
    popularity: null
  };
}

function findOddsCname(html) {
  const t = String(html || "").replace(/%2F/gi, "/");
  const m = t.match(/pw151ou[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/i);
  return m ? m[0] : "";
}

/* レースのグレード表記（GI/GII/GIII）は画像のalt属性にあることが多く、stripHtmlで消えるため別に拾う */

function extractJRAGradeText(html) {
  const t = String(html || "");
  const m = t.match(/<img[^>]*alt=["']([^"']*(?:G\s*[1-3IⅠⅡⅢ]|Ｇ\s*[１-３ⅠⅡⅢ])[^"']*)["']/i);
  return m ? normalizeText(m[1]) : "";
}

/* 1着賞金（万円）。グレード判別の予備（G1は1億円以上など） */

function extractJRAPrize1(html) {
  const m = String(html || "").match(/<li><span class="cap">1着<\/span><span class="num">([\d,]+)<\/span>/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

function extractJRAEntryInfo(html) {
  const result = {
    oddsCname: findOddsCname(html),
    grade: extractJRAGradeText(html),
    prize1: extractJRAPrize1(html),
    raceName: extractRaceName(html),
    cls: ((String(html || "").match(/<div class="cell class">\s*([^<]*?)\s*<\/div>/) || [])[1] || "").trim(),
    surface: "",
    distance: null,
    weather: "",
    trackCondition: "",
    horses: []
  };

  const course = extractCourseInfo(html);
  result.surface = course.surface;
  result.distance = course.distance;
  result.courseRaw = course.raw;
  const hdr = entryHeaderMap((String(html || "").match(/<thead[\s\S]*?<\/thead>/i) || [""])[0]);
  result.header = hdr ? hdr.texts : "";

  const tbodies = String(html || "").match(/<tbody[\s\S]*?<\/tbody>/gi) || [];
  for (const tbody of tbodies) {
    const rows = tbody.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const horse = parseJRAEntryHorseRow(row, hdr);
      if (horse && horse.horseNumber != null) result.horses.push(horse);
    }
  }

  // Some JRA page variants place the entries in a table without tbody.
  if (result.horses.length === 0) {
    const rows = String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const horse = parseJRAEntryHorseRow(row, hdr);
      if (horse && horse.horseNumber != null) result.horses.push(horse);
    }
  }

  const seen = new Set();
  let dup = 0;
  result.horses = result.horses.filter(horse => {
    if (seen.has(horse.horseNumber)) { dup++; return false; }
    seen.add(horse.horseNumber);
    return true;
  }).sort((a, b) => a.horseNumber - b.horseNumber);
  result.dupDropped = dup;
  result.nameRows = (String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || []).filter(r => extractEntryHorseName(r)).length;
  return result;
}

async function discoverJRAEntryVenuesForDate(date) {
  const seedPages = ["https://www.jra.go.jp/keiba/thisweek/", "https://www.jra.go.jp/keiba/"];
  const seeds = new Map();
  const diagnostics = [];
  for (const pageUrl of seedPages) {
    try {
      const html = await fetchJRAHtml(pageUrl);
      for (const link of extractJRAEntryLinks(html, pageUrl)) seeds.set(link.cname, link);
    } catch (error) {
      diagnostics.push({ pageUrl, error: String(error?.message || error) });
    }
  }
  const menuInfo = await discoverJRAEntryLinksViaMenu(date, diagnostics);
  for (const link of menuInfo.links) seeds.set(link.cname, link);
  let same = [...seeds.values()].filter(r => r.date === date);
  if (!same.length) {
    // 入口ページに指定日のリンクがない場合：開催場ごとに1ページだけ開いて指定日のリンクを探す
    const picked = [];
    const seen = new Set();
    for (const r of seeds.values()) {
      if (!seen.has(r.venueCode)) { seen.add(r.venueCode); picked.push(r); }
    }
    for (const r of picked.slice(0, 4)) {
      try {
        const html = await fetchJRAHtml(r.url);
        for (const link of extractJRAEntryLinksForDate(html, date)) same.push(link);
      } catch (error) {
        diagnostics.push({ cname: r.cname, error: String(error?.message || error) });
      }
    }
  }
  const venues = new Map();
  for (const r of same) {
    if (!venues.has(r.venueCode)) venues.set(r.venueCode, { venueCode: r.venueCode, venueName: r.venueName, seedCount: 0 });
    venues.get(r.venueCode).seedCount++;
  }
  return { venues: [...venues.values()].sort((a, b) => a.venueCode.localeCompare(b.venueCode)), availableDates: menuInfo.availableDates, diagnostics };
}

async function handleRaceCardsRaw(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!isValidDateString(date)) {
    return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  }

  try {
    if (url.searchParams.get("list") === "1") {
      const v = await discoverJRAEntryVenuesForDate(date);
      return json({ ok: true, source: "JRA", date, venues: v.venues, availableDates: v.availableDates, diagnostics: v.diagnostics });
    }
    const venueParam = url.searchParams.get("venue");
    const races = await discoverJRAEntryRacesForDate(date, venueParam || null);
    const cards = [];

    for (const race of races) {
      try {
        const parsed = race.entryInfo || { raceName: "", surface: "", distance: null, horses: [] };
        cards.push({
          date,
          venue: race.venue,
          venueName: race.venueName || race.venue,
          venueCode: race.venueCode,
          raceNumber: race.raceNumber ?? race.raceNo,
          raceName: parsed.raceName,
          className: parsed.cls || "",
          grade: parsed.grade || "",
          rowStats: { nameRows: parsed.nameRows ?? null, dupDropped: parsed.dupDropped ?? 0 },
          prize: parsed.prize1 ?? null,
          oddsCname: parsed.oddsCname || "",
          courseRaw: (!parsed.surface || !parsed.distance) ? (parsed.courseRaw || "") : "",
          surface: parsed.surface,
          distance: parsed.distance,
          horses: parsed.horses,
          horseCount: parsed.horses.length,
          error: race.fetchError || undefined,
          url: race.url
        });
      } catch (error) {
        cards.push({
          date,
          venue: race.venue,
          venueName: race.venueName || race.venue,
          venueCode: race.venueCode,
          raceNumber: race.raceNumber ?? race.raceNo,
          horses: [],
          horseCount: 0,
          error: String(error?.message || error),
          url: race.url
        });
      }
    }

    return json({
      ok: true,
      source: "JRA",
      date,
      raceCount: cards.length,
      races: cards,
      warning: cards.some(card => card.horseCount === 0)
        ? "一部レースの出馬表解析で馬を取得できませんでした。"
        : null
    });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}



/* 取り込み品質：レースごとに「頭数」「馬番が1..Nで連続」「騎手・調教師を読めた数」を付ける */
function entryQuality(card) {
  const hs = Array.isArray(card.horses) ? card.horses : [];
  const nums = hs.map(h => Number(h.horseNumber)).filter(Number.isFinite).sort((a, b) => a - b);
  const maxNo = nums.length ? nums[nums.length - 1] : 0;
  const issues = [];
  if (hs.length < 5) issues.push("出走馬が" + hs.length + "頭しか読めていません");
  if (nums.length && maxNo > hs.length + 1 && hs.length < maxNo) issues.push("馬番が抜けています（最大" + maxNo + "番に対し" + hs.length + "頭）");
  const jk = hs.filter(h => String(h.jockey || "").trim().length >= 2).length;
  const tr = hs.filter(h => String(h.trainer || "").trim().length >= 2).length;
  if (hs.length && jk < hs.length) issues.push("騎手を読めない馬 " + (hs.length - jk) + "頭");
  if (hs.length && tr < hs.length) issues.push("調教師を読めない馬 " + (hs.length - tr) + "頭");
  if (!card.surface || !card.distance) issues.push("コース（芝ダ・距離）を読めていません");
  if (card.rowStats && card.rowStats.dupDropped) issues.push("馬番が重複して読めた馬 " + card.rowStats.dupDropped + "頭を除外（馬番の読み取りに問題）");
  return { horses: hs.length, jockeyFilled: jk, trainerFilled: tr, ok: issues.length === 0, issues };
}
async function handleRaceCards(request) {
  const res = await handleRaceCardsRaw(request);
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("list") === "1") return res;
    const data = await res.clone().json();
    if (Array.isArray(data.races)) {
      for (const r of data.races) r.quality = entryQuality(r);
      data.quality = {
        races: data.races.length,
        okRaces: data.races.filter(r => r.quality.ok).length,
        jockeyMissing: data.races.reduce((a, r) => a + (r.quality.horses - r.quality.jockeyFilled), 0),
        trainerMissing: data.races.reduce((a, r) => a + (r.quality.horses - r.quality.trainerFilled), 0)
      };
      return json(data);
    }
  } catch (e) { /* 品質情報が付けられなくても本体の結果は返す */ }
  return res;
}

function extractJRARefund(html,url){
  html=String(html||"");
  const i=html.indexOf('class="refund_unit');
  const area=i>=0?html.slice(i):"";
  const toN=s=>Number(String(s).replace(/[^\d.]/g,""));
  const pay={};let m;
  const lre=/<li class="(win|place|wakuren|umaren|umatan|wide|fuku3|tan3|sanrenpuku|sanrentan)">([\s\S]*?)<\/li>/g;
  while((m=lre.exec(area))){
    const lines=[],lr=/<div class="num">([^<]*)<\/div>\s*<div class="yen">([\d,]+)[\s\S]*?<div class="pop">(\d+)/g;let l;
    while((l=lr.exec(m[2])))lines.push({num:l[1].trim(),yen:toN(l[2]),pop:Number(l[3])});
    if(lines.length&&!pay[m[1]])pay[m[1]]=lines;
  }
  const cm=String(url||"").match(/CNAME=pw01sde10(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})(\d{8})/);
  const raceId=cm?`${cm[2]}${cm[1]}${cm[3]}${cm[4]}${cm[5]}`:null;
  const toList=a=>(a||[]).map(x=>({number:Number(x.num),yen:x.yen,pop:x.pop}));
  return{raceId,date:cm?`${cm[6].slice(0,4)}-${cm[6].slice(4,6)}-${cm[6].slice(6,8)}`:null,
   venueCode:cm?cm[1]:null,raceNo:cm?Number(cm[5]):null,win:toList(pay.win),place:toList(pay.place)};
}

function parseMeetingDate(cname) {
  const m = String(cname || "").match(/(\d{8})\/[0-9A-Za-z]{1,4}$/);
  if (!m) return null;
  const d = m[1];
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) ? iso : null;
}

async function handleJraDays(request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") || "";
  const mm = month.match(/^(\d{4})-(\d{2})$/);
  if (!mm) return errorResponse("month=YYYY-MM を指定してください。", 400);
  try {
    const srl = await discoverJRAMeetingPages(Number(mm[1]), Number(mm[2]));
    const days = [...new Set(srl.map(parseMeetingDate).filter(d => d && d.startsWith(month)))].sort();
    return json({
      ok: true, month, days, meetingPages: srl.length,
      unparsed: srl.filter(c => !parseMeetingDate(c)).length,
      sample: srl.slice(0, 3)
    });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}

async function handleJraDay(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!isValidDateString(date)) return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  try {
    const [y, m] = date.split("-").map(Number);
    const srl = await discoverJRAMeetingPages(y, m);
    let target = srl.filter(c => parseMeetingDate(c) === date);
    // 日付を読めない形式のときだけ、月内の全ページを調べる
    if (!target.length && srl.some(c => !parseMeetingDate(c))) target = srl;
    const found = new Map();
    const failed = [];
    for (const meeting of target) {
      try {
        const html = await fetchJRAHtmlPost("/JRADB/accessS.html", meeting);
        if (!html || html.length < 500) continue;
        for (const cname of extractJRAInternalCnames(html, "pw01sde")) {
          const race = parseJRACname(`${JRA_BASE}/JRADB/accessS.html?CNAME=${encodeURIComponent(cname)}`);
          if (!race || race.date !== date || !HISTORY_VENUES[race.venueCode]) continue;
          if (race.raceNo < 1 || race.raceNo > 12) continue;
          const key = `${race.venueCode}-${race.raceNo}`;
          if (!found.has(key)) {
            found.set(key, { date, venueCode: race.venueCode, venueName: HISTORY_VENUES[race.venueCode], raceNo: race.raceNo, cname });
          }
        }
      } catch (error) {
        failed.push({ meeting, reason: String(error?.message || error) });
      }
    }
    const races = [...found.values()].sort((a, b) => a.venueCode.localeCompare(b.venueCode) || a.raceNo - b.raceNo);
    return json({ ok: true, date, pages: target.length, count: races.length, races, failed });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}

async function handleJraResults(request) {
  const url = new URL(request.url);
  const list = String(url.searchParams.get("cnames") || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!list.length) return errorResponse("cnames=… を指定してください。", 400);
  if (list.length > 8) return errorResponse("cnames は最大8件までです。", 400);
  const rows = [];
  const payouts = [];
  const failed = [];
  for (const cname of list) {
    try {
      if (!/^pw01sde\d{4}\d{8}\d{2}\d{8}\/[0-9A-Za-z]{1,4}$/.test(cname)) throw new Error("CNAMEの形式が正しくありません");
      const pageUrl = `${JRA_BASE}/JRADB/accessS.html?CNAME=${encodeURIComponent(cname)}`;
      const race = parseJRACname(pageUrl);
      if (!race) throw new Error("CNAMEを解析できません");
      const html = await fetchJRAHtml(pageUrl);
      const parsed = extractJRAResultInfo(html);
      if (!parsed || !Array.isArray(parsed.horses) || !parsed.horses.length) throw new Error("結果が0頭");
      const result = {
        date: race.date, venue: HISTORY_VENUES[race.venueCode], venueCode: race.venueCode,
        raceNumber: race.raceNo, raceName: parsed.raceName, surface: parsed.surface, distance: parsed.distance,
        weather: parsed.weather, trackCondition: parsed.trackCondition, horses: parsed.horses
      };
      for (const r of raceResultToRows(result)) {
        rows.push({
          date: r.date, raceId: r.raceId, venueCode: r.venueCode, raceNumber: r.raceNumber,
          surface: r.surface, distance: r.distance, finish: r.finish, number: r.number,
          horse: r.horse, age: r.age, jockey: r.jockey, pop: r.popularity ?? null,
          trainer: r.trainer || "", sex: r.sex || "", weight: r.weight ?? null,
          horseWeight: r.horseWeight ?? null, last3F: r.estimatedLast3F ?? null,
          going: r.going || "", raceName: r.raceName || "", frame: r.frame ?? null,
          corner: Array.isArray(r.corner) ? r.corner : []
        });
      }
      const clsText = ((String(html).match(/<div class="cell class">\s*([^<]*?)\s*<\/div>/) || [])[1] || "").trim();
      const prizeM = String(html).match(/<li><span class="cap">1着<\/span><span class="num">([\d,]+)<\/span>/);
      const prize1 = prizeM ? Number(prizeM[1].replace(/,/g, "")) : null;
      const gradeText = extractJRAGradeText(html);
      for (const row of rows) { if (row.raceId === makeRaceId(race.date, race.venueCode, race.raceNo)) { row.cls = clsText; row.prize = prize1; row.grade = gradeText; } }
      {
        let lap = extractJRALap(html);
        const dist = Number(parsed.distance) || 0;
        if (lap && dist && Math.abs(lap.length - Math.round(dist / 200)) > 1) lap = null;
        const rid = makeRaceId(race.date, race.venueCode, race.raceNo);
        const win = rows.find(x => x.raceId === rid && x.finish === 1);
        if (win && lap) win.lap = lap;
      }
      const refund = extractJRARefund(html, pageUrl);
      if (refund.place.length) {
        payouts.push({
          raceId: makeRaceId(race.date, race.venueCode, race.raceNo), date: race.date,
          venueCode: race.venueCode, raceNo: race.raceNo, win: refund.win, place: refund.place
        });
      }
    } catch (error) {
      failed.push({ cname, reason: String(error?.message || error) });
    }
  }
  return json({ ok: true, count: rows.length, rows, payouts, failed });
}

/* ---- オッズ（JRAのオッズ画面の構造は実物未確認のため、複数の読み方と診断つき） ---- */

function parseJraOddsHtmlTan(html) {
  const text = String(html || "");
  // 読み方A：class名に num / odds_tan を使う形
  const a = {};
  for (const row of text.split(/<tr[\s>]/i).slice(1)) {
    const num = row.match(/<td[^>]*class="[^"]*\bnum\b[^"]*"[^>]*>\s*(\d{1,2})\s*<\/td>/i);
    if (!num) continue;
    const o = row.match(/class="[^"]*odds_tan[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([\d,]+\.\d)/i);
    if (o) a[Number(num[1])] = Number(o[1].replace(/,/g, ""));
  }
  // 読み方B：表のセルを順に見て、「馬番の次が馬名、その後ろの最初の小数が単勝」
  const b = {};
  for (const row of text.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
    if (cells.length < 3) continue;
    const ni = cells.findIndex(c => /[\u3040-\u30ff\u4e00-\u9fff]/.test(c) && !/^\d/.test(c));
    if (ni < 1 || !/^\d{1,2}$/.test(cells[ni - 1])) continue;
    const o = cells.slice(ni + 1).find(c => /^[\d,]+\.\d$/.test(c));
    if (o) b[Number(cells[ni - 1])] = Number(o.replace(/,/g, ""));
  }
  const ca = Object.keys(a).length, cb = Object.keys(b).length;
  return cb > ca ? { odds: b, method: "cells" } : { odds: a, method: "class" };
}


/* 複勝オッズ（下限〜上限）。読み方が複数あるため、2通り試して多く読めた方を採用 */
function parseJraPlaceOdds(html) {
  const text = String(html || "");
  const num = x => Number(String(x).replace(/,/g, ""));
  const a = {};
  for (const row of text.split(/<tr[\s>]/i).slice(1)) {
    const n = row.match(/<td[^>]*class="[^"]*\bnum\b[^"]*"[^>]*>\s*(\d{1,2})\s*<\/td>/i);
    const f = row.match(/class="[^"]*odds_fuku[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (!n || !f) continue;
    const v = (f[1].replace(/<[^>]+>/g, " ").match(/[\d,]+\.\d/g) || []).map(num);
    if (v.length >= 2 && v[0] >= 1 && v[1] >= v[0]) a[Number(n[1])] = [v[0], v[1]];
  }
  const b = {};
  for (const row of text.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
    if (cells.length < 4) continue;
    const ni = cells.findIndex(c => /[\u3040-\u30ff\u4e00-\u9fff]/.test(c) && !/^\d/.test(c));
    if (ni < 1 || !/^\d{1,2}$/.test(cells[ni - 1])) continue;
    const rest = cells.slice(ni + 1);
    const ti = rest.findIndex(c => /^[\d,]+\.\d$/.test(c));
    if (ti < 0) continue;
    const tail = rest.slice(ti + 1).join(" ");
    const v = (tail.match(/[\d,]+\.\d/g) || []).map(num);
    if (v.length >= 2 && v[0] >= 1 && v[1] >= v[0]) b[Number(cells[ni - 1])] = [v[0], v[1]];
  }
  return Object.keys(b).length > Object.keys(a).length ? b : a;
}
function parseJraOddsHtml(html) {
  const r = parseJraOddsHtmlTan(html);
  r.place = parseJraPlaceOdds(html);
  return r;
}

function oddsSnippet(html) {
  const t = String(html || "");
  const i = t.search(/<table/i);
  return t.slice(Math.max(0, i), Math.max(0, i) + 700).replace(/\s+/g, " ");
}

async function fetchOddsPage(cname) {
  let html = "";
  try { html = await fetchJRAHtmlPost("/JRADB/accessO.html", cname); } catch (e) { html = ""; }
  if (!html || html.length < 500) {
    html = await fetchJRAHtml(`${JRA_BASE}/JRADB/accessO.html?CNAME=${encodeURIComponent(cname)}`);
  }
  return html;
}

async function handleJraOdds(request) {
  const url = new URL(request.url);
  // 方式1：出馬表から拾ったオッズ画面のCNAMEを直接読む（最も確実）
  const direct = String(url.searchParams.get("cnames") || "").split(",").map(x => x.trim()).filter(Boolean);
  if (direct.length) {
    if (direct.length > 8) return errorResponse("cnames は最大8件までです。", 400);
    const items = [], failed = [];
    let sample = "";
    for (const c of direct) {
      try {
        if (!/^pw151ou[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}$/i.test(c)) throw new Error("CNAMEの形式が正しくありません");
        const html = await fetchOddsPage(c);
        const p = parseJraOddsHtml(html);
        const n = Object.keys(p.odds).length;
        if (n < 4) { if (!sample) sample = oddsSnippet(html); throw new Error(`オッズを読み取れません（${n}頭）`); }
        items.push({ cname: c, odds: p.odds, place: p.place || {}, count: n, method: p.method, placeCount: Object.keys(p.place || {}).length });
      } catch (error) {
        failed.push({ cname: c, reason: String(error?.message || error) });
      }
    }
    return json({ ok: true, count: items.length, items, failed, sample });
  }
  // 方式2：オッズ画面のメニューからたどる（出馬表にリンクがないとき）
  const date = url.searchParams.get("date");
  const venueFilter = url.searchParams.get("venue");
  if (!isValidDateString(date)) return errorResponse("date=YYYY-MM-DD または cnames=… を指定してください。", 400);
  const compact = date.replace(/-/g, "");
  const diag = [];
  const cnameRe = /pw15[0-9a-z]{3}\d{2}[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/gi;
  const collect = html => [...new Set(String(html || "").replace(/%2F/gi, "/").match(cnameRe) || [])];
  try {
    const top = await fetchJRAHtmlPost("/JRADB/accessO.html", "pw15oli00/6D");
    const topC = collect(top);
    diag.push({ step: "odds-top", htmlLength: top.length, cnames: topC.length, kinds: [...new Set(topC.map(c => c.slice(0, 9)))].slice(0, 8), sample: topC.slice(0, 5) });
    const raceLevel = new Map();
    const seen = new Set();
    const addRace = c => { if (/^pw151ou/i.test(c)) raceLevel.set(c, true); };
    topC.forEach(addRace);
    // 最大3階層まで、指定日を含むページをたどる
    const vOf = c => ((String(c).match(/^pw15[0-9a-z]{3}\d{2}(\d{2})/i) || [])[1] || "");
    const vf0 = venueFilter ? String(venueFilter).padStart(2, "0") : "";
    const isMenu = c => /^pw15o[a-z]{2}/i.test(c) && c.includes(compact) && (!vf0 || vOf(c) === vf0);
    let frontier = topC.filter(isMenu);
    let fetched = 0;
    for (let depth = 0; depth < 3 && frontier.length && fetched < 16; depth++) {
      const next = [];
      for (const c of frontier) {
        if (seen.has(c) || fetched >= 16) continue;
        seen.add(c); fetched++;
        try {
          const html = await fetchJRAHtmlPost("/JRADB/accessO.html", c);
          const cs = collect(html);
          cs.forEach(addRace);
          for (const x of cs) if (isMenu(x) && !seen.has(x)) next.push(x);
          diag.push({ step: "odds-level" + (depth + 1), cname: c, htmlLength: html.length, found: cs.length, raceLevel: cs.filter(x => /^pw151ou/i.test(x)).length });
        } catch (error) {
          diag.push({ step: "odds-level" + (depth + 1), cname: c, error: String(error?.message || error) });
        }
      }
      frontier = next;
    }
    const targetsAll = [...raceLevel.keys()].filter(c => c.includes(compact));
    const vf = venueFilter ? String(venueFilter).padStart(2, "0") : "";
    const targets = vf ? targetsAll.filter(c => { const mm = c.match(/^pw151ou\d{2}(\d{2})/i); return mm && mm[1] === vf; }) : targetsAll;
    const races = [];
    for (const c of targets.slice(0, 18)) {
      try {
        const html = await fetchOddsPage(c);
        const p = parseJraOddsHtml(html);
        const m = c.match(/^pw151ou\d{2}(\d{2})\d{8}(\d{2})\d{8}/i);
        const venueCode = m ? m[1] : null, raceNo = m ? Number(m[2]) : null;
        const n = Object.keys(p.odds).length;
        diag.push({ step: "odds-race", cname: c, venueCode, raceNo, horses: n, method: p.method, htmlLength: html.length });
        if (n >= 4 && venueCode && raceNo && (!venueFilter || venueCode === String(venueFilter))) races.push({ venueCode, raceNo, odds: p.odds, place: p.place || {} });
      } catch (error) {
        diag.push({ step: "odds-race", cname: c, error: String(error?.message || error) });
      }
    }
    return json({ ok: true, date, count: races.length, targets: targets.length, targetsAll: targetsAll.length, races, diagnostics: diag.slice(0, 60), foundRaceNos: targets.map(c => { const m = c.match(/^pw151ou\d{2}\d{2}\d{8}(\d{2})/i); return m ? Number(m[1]) : null; }).filter(Boolean).sort((a, b) => a - b), noParse: diag.filter(x => x.step === "odds-race" && (x.error || x.horses < 4)).map(x => x.raceNo || x.cname) });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error), diagnostics: diag }, 502);
  }
}


/* =========================================================
 * 自動バックアップ（Cloudflare KV）
 *   GET/PUT  /backup/manifest        バックアップの一覧（どのチャンクがいつ保存されたか）
 *   GET/PUT/DELETE /backup/chunk?name=…   データ本体（gzip済み、グループごと）
 * パスフレーズのSHA-256（64桁）を x-backup-id ヘッダで受け取り、その値ごとに保存先を分ける。
 * KV の binding 名は BACKUP（wrangler.jsonc の kv_namespaces）。
 * ======================================================= */

const BACKUP_NAME_RE = /^(csv-(?:0|20\d\d)|live-20\d\d-(?:0[1-9]|1[0-2])|pay-20\d\d-(?:0[1-9]|1[0-2])|meta)$/;

const BACKUP_MAX_BYTES = 20 * 1024 * 1024;

function backupHeaders(extra) {
  return Object.assign({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,DELETE,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": "no-store"
  }, extra || {});
}

async function handleBackup(request, env, pathname) {
  const method = request.method.toUpperCase();
  const jsonHeaders = backupHeaders({ "Content-Type": "application/json; charset=UTF-8" });
  const fail = (message, status) => new Response(JSON.stringify({ ok: false, error: message }), { status, headers: jsonHeaders });
  if (!env || !env.BACKUP) {
    return fail("バックアップ用のKV（BACKUP）が設定されていません。wrangler.jsonc の kv_namespaces を確認してください。", 501);
  }
  const id = request.headers.get("x-backup-id") || "";
  if (!/^[0-9a-f]{64}$/.test(id)) return fail("認証情報が正しくありません。", 401);
  const url = new URL(request.url);

  if (pathname === "/backup/manifest") {
    if (method === "GET") {
      const v = await env.BACKUP.get(`${id}:m`, "text");
      return new Response(v || JSON.stringify({ ok: true, exists: false }), { headers: jsonHeaders });
    }
    if (method === "PUT") {
      const text = await request.text();
      if (text.length > 300000) return fail("manifest が大きすぎます。", 413);
      let obj;
      try { obj = JSON.parse(text); } catch (e) { return fail("JSON が正しくありません。", 400); }
      obj.ok = true; obj.exists = true;
      await env.BACKUP.put(`${id}:m`, JSON.stringify(obj));
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }
    return fail("未対応のメソッドです。", 405);
  }

  if (pathname === "/backup/chunk") {
    const name = url.searchParams.get("name") || "";
    if (!BACKUP_NAME_RE.test(name)) return fail("チャンク名が正しくありません。", 400);
    const key = `${id}:c:${name}`;
    if (method === "GET") {
      const buf = await env.BACKUP.get(key, "arrayBuffer");
      if (!buf) return fail("チャンクがありません。", 404);
      return new Response(buf, { headers: backupHeaders({ "Content-Type": "application/octet-stream" }) });
    }
    if (method === "PUT") {
      const len = Number(request.headers.get("content-length")) || 0;
      if (len > BACKUP_MAX_BYTES) return fail("データが大きすぎます（1チャンク20MBまで）。", 413);
      const buf = await request.arrayBuffer();
      if (buf.byteLength > BACKUP_MAX_BYTES) return fail("データが大きすぎます（1チャンク20MBまで）。", 413);
      await env.BACKUP.put(key, buf);
      return new Response(JSON.stringify({ ok: true, bytes: buf.byteLength }), { headers: jsonHeaders });
    }
    if (method === "DELETE") {
      await env.BACKUP.delete(key);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }
    return fail("未対応のメソッドです。", 405);
  }
  return fail("見つかりません。", 404);
}


/* =========================================================
 * アプリ化（ホーム画面に追加）用：manifest とアイコン
 * ======================================================= */

const APP_ICONS = {
  "180": "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAMLUlEQVR42u2daVwURxqHe4ZLI3hGxQNQvDUaF6NBEUgkauKNChhvxCAuIlF/4rkhRk2iJjEkwf3JqjHxFhHwjBcGCa5GEPEEZQZGUBAVvFCQwdkPZFkWEbuqu6erh//zUauqi+5n3requ7pa1dC2MwdAdahxCgDkAJADQA4AOQDkAJADQA4AOQDkAJADAMgBIAcQjrmMx3YJOYMLwIfE1c6yHFdl5Ef2EEJBohhJDjihREsklwNaKFcRCeV4rRZypVLFIdeZlEqOV/09EEJBJ1Z8OaCFySgishzVdhpaGFMREc+2mHK83FdoIYsiYp12NcwwvQmLWDNEcSJHld5ACxZCiPCroIYZphpChMcPNcyAH5LIATNM2w+1RH0CTA1RjS0HHpood64rrRxIKLUhuahF7wcwmeRCIwcSSi1JLmrZ9QTMBg+1EQQECg0e5jKKKReR29a7urzLv3z+3fs9ensoN3hQ/57Na+EPyNzcwsrKin95K0vL2hlpyNJKZQcx2lDiyIMoiuClJgA5AOQA8siBAUdtG3YgcgDIASAHgBwAcgDIASAHUBhMPHibFeC7PDSE2XPUrNmbhbnXjHzQvu8NT0vPQOQASCsAcgDIASAHgBwAQA4AOQDkAJADQA4AOQDkAIpHea9D3rtfkJWVrbhud+rYzsbGGnJIy9Hj8YGfLlZct6N3bXrPrS/SCsCYA0AOADkAgBwAcgDIASAHgBwAcgBlYDpbTQ70cAuaOU2TqdNqdZpMXYYmS6fLLnn+3AiHtrAw79alUy+nHu84vZ1/917o8m8gB1v0eaenq8u7lXefffHiRc6tXI1Wp9FmaTJ1Gm2WNlOnu5mj15cJP5yDfetyG975W48e3btUbGyal5cPOZijW5dOVVOmWm1v18rertX77v0q/lGvL9PdzNFm6jK0WT//svOGJpNn+w0b1Hfq2b1ciF5OPZo0blRtMVvbZm3b2Gdm3YQc4rBh847tu6J5Fn5VpnirG6/PXJqbm7VzdGjn6DDQw23L9j18qoz38Zwz279dWweVSsWnvEvf3i/LMXn6bAtzgrP98NFjyMFxHFdcXFxcXCykhfr1bexatySqUlT0NP26hqeO7R3b8G/ZpW/vrTuiqvzj48dPMFuRh66dO5JWSUm9/OLFCz4lE/99jqhll769MZVliLe6dSKtknT+Is+SeXn52kyCMYRd65akYQxySDka7UosR/L5VP6F/zj9J1HjA9xdIAcrOPd2IpYj5RL/wqSZZehHH0AOJmjWtEnnTu2JquTl5efm3SGRgyxyuLk6W1vXgxzy49qfeCP2pJSLROVv3c7L0hEsebeytBzk4QY55MfNhViOZEI5qDLLQMghP+6uxHIk/HGWtEp8AtmX0gZ5uCn9+1+Kl8PerpWDfWuiKgWFD1JSL5Me6HjcqbIygocy1tb13FydIYfCwsbJ3xN53v6qTOGDh2fPpRBV8R49HHLIyUAPd+IYcDKB7li/HT1JVH74sEGNGzWEHPJQv77NoA/I5DAYDHHxicaRw8rScpzXSMghDyOGDiId9F26kpaff4/ucDc0mRqtjqjKlIlekEMevEYPI84pJ04JOeLho3FE5Tt2aOfcpxfkMDa2ts369+tjtAEHXWbhOG7qJG/IYWzGjByiVpP1/9Gjx+eSLwg56Nlz5wsfPCSqMmr44FctG4MckuWUMcQTxdgDRwUuINXry2L2/0Y2LLWymhXgCzmMh1PP7m9370paa9eeWOGH3hlJ3Mgn0yYocU6rVDk+DfqEtErOrdzTZ5KEH/rPcylEa384jqtX743AGVMhhzHo0N5x6IcepLV279lnMBhE6cDOyBjSKv5+Exs1bAA5JCc40I90KMpx3M49+8TqwC5yz6yt6/19xhTIIS0tW9h6jxlBWuv8hUs3MrRi9eFm9i2KDDXDb5KyRh7KkyMwYKqFhTnFb13cbuzYTZxZbGysQ5fMgxxS0cK2+dSJxPeU9PqyvTGHxO1J7IEjz54Rv2szafwYBd0wVZgcXy1f9MYbdUlr7Y09eO9+gbg9efKkaNvOvaS1VCrVd6tCKSIf5HgNHu+7jhw2mKLiD+s2SdGf8PWbiZb/lNOlcwelTGsVI4eVldWaL5dSVDwed+rK1XQpupSly95/6BhFxZC5gfZ2rSCHaMwLntG2jT1Fxe9/2iBdr36kikl169b5fs0XFLNxyFEN7R3bzA70o6iYnHKRdNU46QyZrv333fstmBcIOQQnFEvL9eGr6VZyh0kZNv46RDjlIebPmUm6jA1yVOXbVaFOPbtTVNRodQd/OyF1947HJaSlZ1BUVKlUEeFr6HIl5OA4jpvuO37CuNF0ddf+GEGxypwUg8GwZu06uroN6tv8uiGsTp06kIMY5z69vly2iK5u6qWrFDcx6dgbe/hPwrcWKnirW+fwtSvZHJyyK0cL2+a/bAiju19kMBhClqwwQtioYHHo19SPfEePGvITk34wKsebTRpHblvfrGkTuuq7o/ZT/5TpSE65uDtqP3X1j71HhX//JWt+qNmMGYditlDsx1JOUdHT0BUybPa4bOV3FE9bKhjnNZI1P5iTw96u1aGYLR3aO1K3sGbtujt37hq/57l5d6intRV+rAv7ih0/2JKjQ7u2h2O3tnGwo25Bo9X9M+JXufr/w7qNt3PzhLTgM3ZE5PaIpm82gRz/R88e3Q7GbGnZwlbIrHL+4i+el5bK9Sc8e1Y8J+RzgY0McHdJOB7NwpaETMihUqlmBfgeObBD4C/mh3WbTsaflvdvOXo8PmLjVoGNNG/eNDby53nBAfKmGPnlaN68adSODctDQywtLIS0k5ScuuLrtSy4/tnyb65euy6wETMzs6ULgyO3R8i4A4zMcnw0eEBiXGzlvcnpePjo8bSAuaLseC+ckpISv5nzSkpKBLaj15fF7DtsnA8/MCeHW3/n7ZvDRXlVMGjOkuyc2+yMn9LSM5Z8vkpIC89LS6d8Erxle1QtTSun/jgTELRA+PjxX5u20S26kZSNm3dQvHVdTmmpfsr04EPSPzVkOq3s2rPPe4K/kE3jL1y88o9lqzkmCfx0Mf9PdlSecwXNXUItlkkNSOMTzgwfM6Wg8AFF3RuaTK/x/jJm5ZopKHww2sePaDdcjuOWrfxW9BcpFDyVTb10dcTYqaQLxLNzbo/ymib6snJxybmV6+njx3/XhoiNW8PCNzLSeVZugl25mj5s9GT+GzLl598b5e0r8HakcUi/rvGeOOPp02evLXnk2O+LPvuKnZ6rmTqJQz0n8XksUvjgoec4P9JX3WUkKTl18vTg0lJ9DWWydNkzZoUYc5nBa2Hr7ZoMbZbnOL+D0VtqeCG9qOip13h/4XeZjMyJkwkzgxeu/3GVmZnZy/9bXFw8yW92lU935S6sZnO6Fl871MbIUc61tBveE/yLip5Wn03u3vcc50exczkLREUf9Jk081F1H2+bu2DZ5StplbWo1oya/8v05eA4Lun8xQm+gS/PQS5dSRvw4dhzSRc4xXLiZMLAYR9X+TxgVPTByisa+Vx74/jB6Eqw+IQzM4MWVl54F3vgyODhH9+6nccpnOs3NB8M8al42+Xe/YIFS1dSRAUjhBB215BG7zu8YlUYx3EGg2HVt+G+/nOErLNi7f6Hp8+08lvj8xctv19QyGY/mX7d+7uw9R3bOx4+Ehd74AhnWpSW6mfPW7r/0NFj/900ly4M5C7USTdEZX0vgICgBZzpItAMqf1QcwBADmYRPq6UaGQKOQDkAJLKkbj6fx/Mcgk5g3OnICpfr8rXEZEDIK0AyAEYlQPDDikQfgur5hboBhyIHEAyORA8WAge/MOG5HIQxSUgtR9EtUivndC0guDBMgKvDo0cCB7SBQ/+kYCoMN1VU8uuJ6DIFHzKCL8uqoa2nUVxAuFEdISsPhfl6tAv9klc7YyYwewURpTfrWj3OSCKyYxDxZGjipLwg0EzhKR7oZEDfpiqGeKkFfhhkmYImq28Ns9h/iLjIEOUky/agPTl3iCEKNoMMSNHDUIghBhzViLi2RZZjhoCBhRR3EkWXw4oYgJaSCsHnzEHRGH8TEooB4alRkDSH5jkckARJWphVDlgiYKckE0OiMK4EKzIARgHryYAyAEgB4AcAHIAyAEgB4AcAHIAyAEgBwCQA/DnP4M8pmUYAKTKAAAAAElFTkSuQmCC",
  "192": "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",
  "512": "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"
};

function iconResponse(size) {
  const bin = Uint8Array.from(atob(APP_ICONS[size]), c => c.charCodeAt(0));
  return new Response(bin, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}

function manifestResponse() {
  const manifest = {
    name: "穴馬好走ツール", short_name: "穴馬AI", start_url: "/", scope: "/", display: "standalone",
    background_color: "#101828", theme_color: "#101828", lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json; charset=UTF-8", "Cache-Control": "public, max-age=3600" } });
}


/* =========================================================
 * 診断：出馬表ページの中身を確認する（開催場ごとにページの形が違うときの原因調べ用）
 *   /debug-entry?date=YYYY-MM-DD&venue=08&race=1
 * ======================================================= */

async function handleDebugEntry(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race") || 1);
  if (!isValidDateString(date) || !venue) return errorResponse("date=YYYY-MM-DD&venue=08&race=1 を指定してください。", 400);
  try {
    const races = await discoverJRAEntryRacesForDate(date, venue);
    const r = races.find(x => Number(x.raceNo) === raceNo) || races[0];
    if (!r) return json({ ok: true, date, venue, found: 0, note: "この開催場のレースを見つけられませんでした" });
    const html = await fetchJRAHtml(r.url);
    const text = normalizeText(stripHtml(html)).normalize("NFKC");
    const parsed = extractJRAEntryInfo(html);
    const kinds = {};
    for (const m of String(html).replace(/%2F/gi, "/").matchAll(/pw[0-9a-z]{4,}\d*\/[0-9A-Fa-f]{1,4}/gi)) {
      const k = m[0].slice(0, 9).toLowerCase();
      kinds[k] = (kinds[k] || 0) + 1;
    }
    const horseRows = (String(html).match(/<tr[\s\S]*?<\/tr>/gi) || []).filter(t => /accessU\.html/i.test(t) || /horse|馬名|umaban|waku/i.test(t));
    const sampleRows = horseRows.slice(0, 2).map(t => t.replace(/\s+/g, " ").slice(0, 2200));
    const rowSummary = horseRows.slice(0, 24).map(t => { const h = parseJRAEntryHorseRow(t); return h ? h.horseNumber + "|" + h.horseName + "|J:" + (h.jockey || "-") + "|T:" + (h.trainer || "-") : "×解析不可:" + (extractEntryHorseName(t) || "名前なし") + "|" + t.replace(/\s+/g, " ").slice(0, 160); });
    const firstHorseRow = (String(html).match(/<tr[\s\S]*?<\/tr>/gi) || []).find(t => /horse|馬名|umaban|waku/i.test(t)) || "";
    return json({
      ok: true, date, venueCode: venue, raceNo: r.raceNo, pageUrl: r.url, htmlLength: String(html).length,
      textHead: text.slice(0, 400),
      courseNear: (() => { const i = text.search(/コース/); return i >= 0 ? text.slice(i, i + 100) : "（「コース」の文字がありません）"; })(),
      meterNear: (() => { const m = text.match(/.{0,30}(?:メートル|\d\s*m\b).{0,30}/); return m ? m[0] : "（距離の文字がありません）"; })(),
      parsed: { raceName: parsed.raceName, cls: parsed.cls, surface: parsed.surface, distance: parsed.distance, horses: parsed.horses.length, oddsCname: parsed.oddsCname, firstJockey: parsed.horses[0] ? parsed.horses[0].jockey : "" },
      cnameKinds: kinds,
      hasOddsWord: /オッズ/.test(text),
      tableCount: (String(html).match(/<table/gi) || []).length,
      firstHorseRow: firstHorseRow.replace(/\s+/g, " ").slice(0, 300),
      rowStats: { nameRows: parsed.nameRows, dupDropped: parsed.dupDropped, horses: parsed.horses.length },
      header: parsed.header || "",
      theadText: ((String(html).match(/<thead[\s\S]*?<\/thead>/i) || [""])[0]).replace(/\s+/g, " ").slice(0, 700),
      rowSummary,
      sampleRows
    });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}

/* =========================================================
 * メインWorker
 * ======================================================= */

/* ---- 画面（ビルド時に埋め込み） ---- */
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGRpdiBpZD0iYmtTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2PgogPGRpdiBpZD0iZGF0YVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+CjwvZGl2PgoKPGRpdiBjbGFzcz0idGFicyIgaWQ9InRhYnMiPgogPGJ1dHRvbiBkYXRhLXRhYj0idkF4aXMiIGNsYXNzPSJvbiI+6LaF6YmE5p2/PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2RXYiPuacn+W+heWApDwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlVwc2V0Ij7ms6LkubHluqY8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZIb2xlIj7nqbTppqw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZSYWNlcyI+5YWo44Os44O844K5PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U3VtIj7lj5bjgorovrzjgb/nirbms4E8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZUZXN0Ij7mpJzoqLw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZTZXQiPuioreWumjwvYnV0dG9uPgo8L2Rpdj4KCjxkaXYgaWQ9ImdhdGUiPjwvZGl2PgoKPGRpdiBpZD0idkF4aXMiIGNsYXNzPSJ2aWV3IG9uIGNhcmQiPjxkaXYgY2xhc3M9InNtYWxsIj7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgII8L2Rpdj48L2Rpdj4KPGRpdiBpZD0idkV2IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlVwc2V0IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idkhvbGUiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2UmFjZXMiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2U3VtIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KCjxkaXYgaWQ9InZUZXN0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7lm57lj47njofjga7mpJzoqLzvvIjmiZXmiLvjgaTjgY3jg7vmmYLns7vliJfvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruaIkOe4vuOBqOaJleaIu+OBp+OAgeOAjOOBneOBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBoOOBkeOAjeOCkuS9v+OBhuODkOODg+OCr+ODhuOCueODiOOCkuOBl+OBvuOBme+8iOWQhOODrOODvOOCuTEwMOWGhu+8ieOAguOBk+OBk+OBpzxiPuWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBruWbnuWPjueOh+OBjDEwMCXjgpLotoXjgYjjgIHoqqTlt67jga7luYXjgpLlvJXjgYTjgabjgoIxMDAl5Lul5LiKPC9iPuOBqOeiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBoOOBkeOBjOOAgeeUu+mdouS4iuOBp+OAjOaknOiovOa4iOOBv+OAjeOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJidEdyYWRlIiBjbGFzcz0ic3ViIj7ph43os57jgaDjgZHvvJrjgrDjg6zjg7zjg4noo5zmraPjgYLjgoov44Gq44GX44KS5q+U6LyDPC9idXR0b24+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5rOi5Lmx5bqm44Gu5L+h6aC85bqm44KS5LiK44GS44KL77yI5YaN5qCh5q2j77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7pgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgavlho3nj77jgZfjgIHms6LkubHluqbjga7kuojmuKzjgajlrp/pmpvjga7ms6LkubHnjofjgpLnqoHjgY3lkIjjgo/jgZvjgb7jgZnjgILjgrPjg7zjgrnliKXvvIjplovlgqzloLTDl+iKneODgMOX6Led6Zuiw5fjgq/jg6njgrnvvInjga7pgY7ljrvms6LkubHnjofjgpLotrPjgZfjgZ/mlrDjg6Ljg4fjg6vjgpLkvZzjgorjgIE8Yj7nj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpM8L2I+44Gn5q+U44G544Gm44CB5piO56K644Gr6Imv44GE44Go44GN44Gg44GR5o6h55So44GX44G+44GZ44CC6Imv44GP44Gq44KJ44Gq44GR44KM44Gw54++6KGM44Gu44G+44G+44Gn44CB562J57Sa44GU44Go44Gu5a6f57i+546H44Gg44GR44KS5qSc6Ki844GX44Gf5pWw5a2X44Gr5beu44GX5pu/44GI44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPuaknOiovOOBrumWi+Wni+aXpSA8aW5wdXQgaWQ9InVwU3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIxLTAxLTAxIj48YnV0dG9uIGlkPSJ1cFJ1biI+5rOi5Lmx5bqm44KS5qSc6Ki844O75YaN5qCh5q2jPC9idXR0b24+PGJ1dHRvbiBpZD0idXBDbGVhciIgY2xhc3M9InN1YiI+5qiZ5rqW44Gr5oi744GZPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJ1cE91dCIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGM77yI6YGO5Y6744Os44O844K544Gu5Y+W5b6X5b6M44Gr5a6f6KGM44CC5pWw5YiG44GL44GL44KK44G+44GZ77yJPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InBheUV4cCIgY2xhc3M9InN1YiI+5omV5oi744KS5pu444GN5Ye644GXPC9idXR0b24+PGxhYmVsIGNsYXNzPSJzbWFsbCI+6Kqt44G/6L6844G/IDxpbnB1dCBpZD0icGF5SW1wIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uIj48L2xhYmVsPjwvZGl2PgogPGRpdiBpZD0iYnRPdXQiIGNsYXNzPSJzdGF0dXMiPuODh+ODvOOCv+WPluW+l+OBruOBguOBqOOBp+Wun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8L2Rpdj4KCjxkaXYgaWQ9InZTZXQiIGNsYXNzPSJ2aWV3IGNhcmQiPgogPGgyPuODkOODg+OCr+OCouODg+ODl+ioreWumu+8iENsb3VkZmxhcmXjgavkv53lrZjvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuODkeOCueODleODrOODvOOCuuOBrlNIQS0yNTbjgaDjgZHjgpLkvb/jgaPjgabkv53lrZjlhYjjgpLliIbjgZHjgb7jgZnvvIjjg5Hjgrnjg5Xjg6zjg7zjgrroh6rkvZPjga/pgIHjgorjgb7jgZvjgpPvvInjgILlkIzjgZjjg5Hjgrnjg5Xjg6zjg7zjgrrjgaflvqnlhYPjgafjgY3jgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJia1Bhc3MiIHR5cGU9InBhc3N3b3JkIiBwbGFjZWhvbGRlcj0i44OR44K544OV44Os44O844K677yIOOaWh+Wtl+S7peS4iu+8iSIgYXV0b2NvbXBsZXRlPSJvZmYiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIwMHB4Ij48YnV0dG9uIGlkPSJia1Nob3ciIGNsYXNzPSJzdWIiPuihqOekujwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJia0F1dG8iIHR5cGU9ImNoZWNrYm94IiBjaGVja2VkPiDlpInmm7TjgYzjgYLjgozjgbDoh6rli5Xjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgZnjgos8L2xhYmVsPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJia05vdyI+5LuK44GZ44GQ5beu5YiG44OQ44OD44Kv44Ki44OD44OXPC9idXR0b24+PGJ1dHRvbiBpZD0iYmtSZXN0b3JlIiBjbGFzcz0ic3ViIj7jg5Djg4Pjgq/jgqLjg4Pjg5fjgYvjgonlvqnlhYM8L2J1dHRvbj48YnV0dG9uIGlkPSJia0Z1bGwiIGNsYXNzPSJzdWIiPuOBmeOBueOBpuS/neWtmOOBl+ebtOOBmTwvYnV0dG9uPjwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPumBjuWOu+ODh+ODvOOCv+OBruiqreOBv+i+vOOBv++8iOS7u+aEj++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Lul5YmN44Gu44OQ44OD44Kv44Ki44OD44OXSlNPTu+8j+aIkOe4vkNTVuOBjOOBguOCjOOBsOiqreOBv+i+vOOCgeOBvuOBme+8iOWQjOOBmOaXpeOBr+mHjeikh+OBl+OBvuOBm+OCk++8ieOAgjwvZGl2PgogPGlucHV0IGlkPSJmaWxlIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uLC5jc3YsYXBwbGljYXRpb24vanNvbix0ZXh0L2NzdiI+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+6Ki65patPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lh7rppqzooajjga7oqq3jgb/lj5bjgorjgavllY/poYzjgYzjgYLjgovjgajjgY3jgIHplovlgqzloLTjgZTjgajjgasxUuOBruODmuODvOOCuOOBruS4rei6q+OCkuiqv+OBueOBpuS4i+OBq+WHuuOBl+OBvuOBmeOAguOCs+ODlOODvOOBl+OBpumAgeOBo+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJkYmdHbyIgY2xhc3M9InN1YiI+6Ki65pat5oOF5aCx44KS5L2c44KLPC9idXR0b24+PGJ1dHRvbiBpZD0iZGJnQ29weSIgY2xhc3M9InN1YiI+44Kz44OU44O8PC9idXR0b24+PC9kaXY+CiA8dGV4dGFyZWEgaWQ9ImRiZ091dCIgcmVhZG9ubHkgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjE0MHB4O2ZvbnQtc2l6ZToxMnB4Ij48L3RleHRhcmVhPgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuODqeODg+ODl+ODu+mAmumBjumghuS9jeOBruWPluOCiuebtOOBlzwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Y+W5b6X5riI44G/44Gu44Os44O844K544KS44CB44Os44O844K55YWo5L2T44Gu44Op44OD44OX77yI44OP44Ot44Oz44K/44Kk44Og77yJ44Go5ZCE6aas44Gu44Kz44O844OK44O86YCa6YGO6aCG5L2N44Gk44GN44Gn5Y+W44KK55u044GX44G+44GZ77yI44Oa44O844K544O76ISa6LOq44KS5LqI5oOz44Gr5L2/44GG44Gf44KB44Gu5rqW5YKZ77yJ44CC5L+d5a2Y5riI44G/44Gu5pel44Gv5LiK5pu444GN44GV44KM44G+44GZ44CC5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZ44CC44G+44Ga5paw44GX44GE5pyf6ZaT44GL44KJ5bCR44GX44Gg44GR6Kmm44GX44Gm44CB6Kqt44KB44Gm44GE44KL44GL44KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPumWi+Wni+aXpSA8aW5wdXQgaWQ9ImxhcFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyNi0wMS0wMSI+PGJ1dHRvbiBpZD0ibGFwR28iPuWPluOCiuebtOOBmTwvYnV0dG9uPjxidXR0b24gaWQ9ImxhcERiZyIgY2xhc3M9InN1YiI+6Kqt44G/5Y+W44KK44Gu6Ki65patPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJsYXBTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2PgogPHRleHRhcmVhIGlkPSJsYXBPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxMjBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KPC9kaXY+Cgo8L21haW4+CjxkaXYgaWQ9ImJ1c3kiPjxkaXY+PGRpdiBpZD0iYnVzeVRleHQiPuWHpueQhuS4reKApjwvZGl2PjwvZGl2PjwvZGl2Pgo8c2NyaXB0Pgpjb25zdCBVRT0oKCk9PnsKIC8qIOWun+ODh+ODvOOCv+aknOiovOOBp+mAhuWKueaenOOBoOOBo+OBn+aIkOWIhu+8iOmojuaJi+ODu+mWk+malO+8ieOBr+aXouWumuOBp09GRiAqLwogY29uc3QgREVGQVVMVD17am9ja2V5OmZhbHNlLGxheW9mZjpmYWxzZX07CiBjb25zdCBjbGFtcD0oeCxhLGIpPT5NYXRoLm1heChhLE1hdGgubWluKGIseCkpOwogY29uc3Qgc2lnbW9pZD14PT4xLygxK01hdGguZXhwKC14KSk7CiBjb25zdCBsb2dpdD1wPT57cD1jbGFtcChwLC4wMDEsLjk5OSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKIGNvbnN0IG5uPXM9PlN0cmluZyhzPz8iIikubm9ybWFsaXplKCJORktDIikudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXHNcdTMwMDBdKy9nLCIiKS5yZXBsYWNlKC9b44O7772lLu+8jlwt4oCQ4oCR4oCS4oCT4oCU4oCVJ+KAmWBdL2csIiIpLnJlcGxhY2UoL1vimIbimIXilrPilrLil4fil4ZdL2csIiIpOwogLyog6aiO5omL5ZCN77ya5YWI6aCt44Gu5qyn5a2X44Kk44OL44K344Oj44Or44KS6Zmk44GN44CB44OH44Og44O844Ot4oaS44OH44OgIOOBq+aPg+OBiOOCi++8iEpSQeOBriBDLuODh+ODoOODvOODrSDjgajpgY7ljrvjg4fjg7zjgr/jga4g77yj77yO44OH44OgIOOCkuS4gOiHtOOBleOBm+OCi++8iSAqLwogY29uc3Qgam5uPXM9PntsZXQgdj1ubihTdHJpbmcocz8/IiIpLnJlcGxhY2UoL1xkezJ9KD86XC5cZCk/XHMqKD86a2d8772L772HKS9naSwiICIpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw4fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKOagl+adsXznvo7mtaYpL2csIiAiKSk7dj12LnJlcGxhY2UoL15bYS16XSg/PVvjgqEt44O244O8XSkvLCIiKTt2PXYucmVwbGFjZSgvXuODh+ODoOODvOODrS8sIuODh+ODoCIpO3JldHVybiB2fTsKIC8qIOOCr+ODqeOCueOBruautemaju+8mjA95LiN5piOIC8gLTE95Zyw5pa5IC8gMT3mlrDppqzjg7vmnKrli53liKkgLyAyPTHli50gLyAzPTLli50gLyA0PTPli50gLyA1PeOCquODvOODl+ODs+ODu+mHjeizniAqLwogY29uc3QgbGV2ZWxPZkxhYmVsPXQ9Pntjb25zdCBzPVN0cmluZyh0fHwiIik7aWYoL+WcsOaWuXxOQVIvLnRlc3QocykpcmV0dXJuIC0xO2lmKC/mlrDppqx85pyq5Yud5YipLy50ZXN0KHMpKXJldHVybiAxO2lmKC8x5YudfDUwMOS4hy8udGVzdChzKSlyZXR1cm4gMjtpZigvMuWLnXwxMDAw5LiHLy50ZXN0KHMpKXJldHVybiAzO2lmKC8z5YudfDE2MDDkuIcvLnRlc3QocykpcmV0dXJuIDQ7aWYoL+OCquODvOODl+ODs3zvvK/vvLB8T1B844Oq44K544OG44OD44OJfOmHjeiznnzvvKd8R1sxMjNJXS9pLnRlc3QocykpcmV0dXJuIDU7cmV0dXJuIDB9OwogY29uc3QgbGV2ZWxPZlByaXplPXA9PntwPU51bWJlcihwKTtyZXR1cm4gIShwPjApPzA6cDw9NzAwPzE6cDw9OTAwPzI6cDw9MTMwMD8zOnA8PTE4MDA/NDo1fTsKIC8qIOKYheOCsOODrOODvOODie+8iOagvO+8ie+8mjA95LiN5piOL+S4i+e0miAxPU9Q44O744Oq44K544OG44OD44OJIDI9RzMgMz1HMiA0PUcx44CCCiAgICDlvpPmnaXjga8gRzEvRzIvRzMvT1Ag44KS44GZ44G544Gm44CMNeOAjeOBq+a9sOOBl+OBpuOBhOOBn+OBn+OCgeOAgUcz5Yud44Gh44GMIEcxIOOBp+OCguWJsuW8leOBleOCjOOBquOBi+OBo+OBn+OAggogICAg5Yik5a6a6aCG77ya44Op44OZ44Or77yITkZLQ+W+jCBHSS9HSUkvR0lJSS9HMeOAnEcz77yJ4oaSIDHnnYDos57ph5HvvIjkuIflhobvvInihpLvvIjlr77osaHjg6zjg7zjgrnjga7jgb/vvIlHMeODrOODvOOCueWQjSAqLwogY29uc3QgRzFfTkFNRVM9L+Wkqeeah+iznnzmnInppqzoqJjlv7V844K444Oj44OR44Oz44Kr44OD44OXfOOCuOODo+ODkeODs++8o3zlrp3loZroqJjlv7V85a6J55Sw6KiY5b+1fOODtOOCo+OCr+ODiOODquOCouODnuOCpOODq3zlpKfpmKrmna986auY5p2+5a6u6KiY5b+1fOODleOCp+ODluODqeODquODvHzjg4Hjg6Pjg7Pjg5Tjgqrjg7Pjgrp844K544OX44Oq44Oz44K/44O844K6fOODnuOCpOODq+ODgeODo+ODs+ODlOOCquODs+OCt+ODg+ODl3zjgqjjg6rjgrbjg5njgrnlpbPnjovmna9856eL6I+v6LOefOiPiuiKseiznnzmoZzoirHos55844Kq44O844Kv44K5fOWEqumnv+eJnemmrHzml6XmnKzjg4Djg7zjg5Pjg7x85p2x5Lqs5YSq6ae/fOeakOaciOiznnxOSEvjg57jgqTjg6t86Ziq56We44K444Ol44OZ44OK44Kk44OrfOacneaXpeadr3zjg5vjg7zjg5fjg5Xjg6svOwogY29uc3QgZ3JhZGVUaWVyPSh0ZXh0LHByaXplLGJ5TmFtZSk9Pntjb25zdCBzPVN0cmluZyh0ZXh0fHwiIikubm9ybWFsaXplKCJORktDIik7CiAgaWYoL+manOWus3zjgrjjg6Pjg7Pjg5d8SlwuP1xzP0cvaS50ZXN0KHMpKXJldHVybiAwOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUlJfDMpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiAyOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUl8MikoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDM7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJfDEpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiA0OwogIGNvbnN0IHA9TnVtYmVyKHByaXplKTtpZihwPjApcmV0dXJuIHA+PTEwMDAwPzQ6cD49NTAwMD8zOnA+PTM1MDA/MjpwPj0xODAwPzE6MDsKICBpZihieU5hbWUmJkcxX05BTUVTLnRlc3QocykpcmV0dXJuIDQ7CiAgaWYoL+ODquOCueODhuODg+ODiXzjgqrjg7zjg5fjg7N877yv77ywfFxiT1BcYi8udGVzdChzKSlyZXR1cm4gMTsKICByZXR1cm4gMH07CiBjb25zdCBpc0pyYVZlbnVlPWM9Pi9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyhjfHwiIikpOwogY29uc3Qgc3VyZkNvZGU9cz0+e3M9U3RyaW5nKHN8fCIiKTtyZXR1cm4gL+iKnXx0dXJmL2kudGVzdChzKT8xOi/jg4B8ZGlydC9pLnRlc3Qocyk/Mjov6ZqcfGp1bXAvaS50ZXN0KHMpPzM6MH07CiBjb25zdCBkbnVtPWQ9Pk51bWJlcihTdHJpbmcoZHx8IiIpLnJlcGxhY2UoL1xEL2csIiIpLnNsaWNlKDAsOCkpfHwwOwogZnVuY3Rpb24gcGFyc2VEYXRlKHMpewogIHM9U3RyaW5nKHN8fCIiKTtsZXQgbT1zLm1hdGNoKC8oXGR7NH0pXER7MCw0fShcZHsxLDJ9KVxEezAsNH0oXGR7MSwyfSkvKTsKICBpZighbSlyZXR1cm4iIjtyZXR1cm4gYCR7bVsxXX0tJHttWzJdLnBhZFN0YXJ0KDIsIjAiKX0tJHttWzNdLnBhZFN0YXJ0KDIsIjAiKX1gOwogfQogZnVuY3Rpb24gY3N2Um93cyh0ZXh0KXsKICBjb25zdCBsaW5lcz1TdHJpbmcodGV4dHx8IiIpLnJlcGxhY2UoL15cdUZFRkYvLCIiKS5zcGxpdCgvXHI/XG4vKS5maWx0ZXIoeD0+eC50cmltKCkpOwogIGlmKCFsaW5lcy5sZW5ndGgpcmV0dXJuW107CiAgY29uc3Qgc3BsaXQ9bD0+e2NvbnN0IGE9W107bGV0IGM9IiIscT1mYWxzZTtmb3IobGV0IGk9MDtpPGwubGVuZ3RoO2krKyl7Y29uc3QgY2g9bFtpXTsKICAgaWYoY2g9PT0nIicpe2lmKHEmJmxbaSsxXT09PSciJyl7Yys9JyInO2krK31lbHNlIHE9IXF9ZWxzZSBpZihjaD09PSIsIiYmIXEpe2EucHVzaChjKTtjPSIifWVsc2UgYys9Y2h9YS5wdXNoKGMpO3JldHVybiBhfTsKICBjb25zdCBoZWFkPXNwbGl0KGxpbmVzWzBdKS5tYXAoeD0+eC50cmltKCkpO2NvbnN0IG91dD1bXTsKICBmb3IobGV0IGk9MTtpPGxpbmVzLmxlbmd0aDtpKyspe2NvbnN0IGE9c3BsaXQobGluZXNbaV0pLG89e307Zm9yKGxldCBqPTA7ajxoZWFkLmxlbmd0aDtqKyspb1toZWFkW2pdXT1hW2pdPz8iIjtvdXQucHVzaChvKX0KICByZXR1cm4gb3V0OwogfQogY29uc3QgZj12PT57Y29uc3Qgbj1wYXJzZUZsb2F0KFN0cmluZyh2Pz8iIikucmVwbGFjZSgvLC9nLCIiKSk7cmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKT9uOm51bGx9OwogLyog44OQ44OD44Kv44Ki44OD44OXL0NTVuOBrjHooYzihpLou73ph4/ooYwgKi8KIGNvbnN0IGNsZWFuVHI9dD0+U3RyaW5nKHR8fCIiKS5yZXBsYWNlKC9ccysvZywiICIpLnRyaW0oKS5yZXBsYWNlKC9b77yIKF1bXu+8iSldezAsNn1b77yJKV0vZywiICIpLnJlcGxhY2UoLyg/Ouagl+adsXznvo7mtaZ85Zyw5pa5fOWkluWbvXzmi5vlvoUpXHMqW+ODu++9pV0/L2csIiAiKS5yZXBsYWNlKC9b44O7772lXS9nLCIgIikucmVwbGFjZSgvXHMrL2csIiAiKS50cmltKCk7CiBmdW5jdGlvbiB0b1JvdyhvKXtjb25zdCBfcj10b1JvdzAobyk7X3IudHJhaW5lcj1jbGVhblRyKG9bIuiqv+aVmeW4qyJdfHxvLnRyYWluZXJ8fCIiKTtfci5ncmQ9Z3JhZGVUaWVyKFN0cmluZyhvWyJjbGFzcyJdfHxvLmNsc3x8IiIpKyIgIitTdHJpbmcob1si44Os44O844K55ZCNIl18fG8ucmFjZV9uYW1lfHxvLnJhY2VuYW1lfHwiIiksbnVsbCxmYWxzZSk7cmV0dXJuIF9yfQogZnVuY3Rpb24gdG9Sb3cwKG8pewogIGNvbnN0IHNhPVN0cmluZyhvWyLmgKfpvaIiXXx8IiIpO2NvbnN0IGFtPXNhLm1hdGNoKC8oXGQrKS8pOwogIHJldHVybntyYWNlSWQ6U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/P29bIlVubmFtZWQ6IDAiXT8/IiIpLGRhdGU6cGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pLAogICBuYW1lOlN0cmluZyhvWyLppqzlkI0iXXx8by5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpubihvWyLppqzlkI0iXXx8by5ob3JzZSksam9ja2V5OmpubihvWyLpqI7miYsiXXx8by5qb2NrZXkpLGpuYW1lOlN0cmluZyhvWyLpqI7miYsiXXx8by5qb2NrZXl8fCIiKS50cmltKCksZmluaXNoOmYob1si552A6aCGIl0/P28uZmluaXNoKSwKICAgZGlzdDpmKG8uY291cnNlX2xlbj8/b1si6Led6ZuiIl0/P28uZGlzdGFuY2UpfHwwLHN1cmY6c3VyZkNvZGUoby5yYWNlX3R5cGV8fG9bIuiKneODgCJdfHxvLnN1cmZhY2UpLAogICBhZ2U6YW0/TnVtYmVyKGFtWzFdKTpudWxsLG51bTpmKG9bIummrOeVqiJdKSxwb3A6ZihvWyLkurrmsJciXSksb2RkczpmKG9bIuWNmOWLnSJdKSwKICAgbHZsOigoKT0+e2NvbnN0IGlkPVN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz8iIik7aWYoL15cZHsxMn0kLy50ZXN0KGlkKSYmIWlzSnJhVmVudWUoaWQuc2xpY2UoNCw2KSkpcmV0dXJuIC0xO3JldHVybiBsZXZlbE9mTGFiZWwob1siY2xhc3MiXXx8by5jbHMpfSkoKX07CiB9CiAvKiDmiJDnuL7jgrnjg4jjgqLvvIjml6Xku5jmmIfpoIbjgasgYWRkIOOBmeOCi++8iSAqLwogZnVuY3Rpb24gU3RvcmUoKXt0aGlzLmg9bmV3IE1hcCgpO3RoaXMuaj1uZXcgTWFwKCl9CiBTdG9yZS5wcm90b3R5cGUuYWRkPWZ1bmN0aW9uKHIpewogIGlmKHIuZmluaXNoPT1udWxsfHwhci5ob3JzZSlyZXR1cm47CiAgY29uc3QgdDM9ci5maW5pc2g+PTEmJnIuZmluaXNoPD0zPzE6MDsKICBsZXQgaD10aGlzLmguZ2V0KHIuaG9yc2UpO2lmKCFoKXRoaXMuaC5zZXQoci5ob3JzZSxoPXtuOjAsdG9wMzowLHdpbjowLHN1bTowLGxhc3Q6IiIscnVuczpbXSxsdjp7fX0pOwogIGgubisrO2gudG9wMys9dDM7aWYoci5maW5pc2g9PT0xKWgud2luKys7aC5zdW0rPXIuZmluaXNoO2lmKHIuZGF0ZT5oLmxhc3QpaC5sYXN0PXIuZGF0ZTsKICBjb25zdCBMPXIubHZsfHwwOyhoLmx2W0xdPWgubHZbTF18fFswLDBdKTtoLmx2W0xdWzBdKys7aC5sdltMXVsxXSs9dDM7CiAgaC5ydW5zLnB1c2goW2RudW0oci5kYXRlKSxyLmZpbmlzaCxyLmRpc3Qsci5zdXJmLEwsci5ncmR8fDBdKTtpZihoLnJ1bnMubGVuZ3RoPjYpe2gucnVucy5zb3J0KChhLGIpPT5hWzBdLWJbMF0pO2gucnVucy5zaGlmdCgpfQogIGlmKHIuam9ja2V5KXtsZXQgaj10aGlzLmouZ2V0KHIuam9ja2V5KTtpZighail0aGlzLmouc2V0KHIuam9ja2V5LGo9e246MCx0b3AzOjB9KTtqLm4rKztqLnRvcDMrPXQzfQogfTsKIC8qIOmojuaJi++8muWujOWFqOS4gOiHtOKGku+8iOefreOBhOihqOiomOOBquOCie+8ieWJjeaWueS4gOiHtOOBpzHkurrjgavntZ7jgozjgovjgajjgY3jgaDjgZHmjqHnlKggKi8KIFN0b3JlLnByb3RvdHlwZS5qb2NrZXk9ZnVuY3Rpb24obmFtZSl7CiAgaWYoIW5hbWUpcmV0dXJuIG51bGw7CiAgY29uc3Qgaj10aGlzLmouZ2V0KG5hbWUpO2lmKGopcmV0dXJuIGo7CiAgaWYobmFtZS5sZW5ndGg8Mnx8bmFtZS5sZW5ndGg+NClyZXR1cm4gbnVsbDsKICBpZighdGhpcy5famt8fHRoaXMuX2prU2l6ZSE9PXRoaXMuai5zaXplKXt0aGlzLl9qaz1bLi4udGhpcy5qLmtleXMoKV07dGhpcy5famtTaXplPXRoaXMuai5zaXplfQogIGNvbnN0IGM9dGhpcy5famsuZmlsdGVyKGs9Pmsuc3RhcnRzV2l0aChuYW1lKXx8KG5hbWUubGVuZ3RoPj0zJiZrLnN0YXJ0c1dpdGgobmFtZS5zbGljZSgwLC0xKSkmJm5hbWUubGVuZ3RoPD1rLmxlbmd0aCkpOwogIHJldHVybiBjLmxlbmd0aD09PTE/dGhpcy5qLmdldChjWzBdKTpudWxsOwogfTsKIGNvbnN0IGxheW9mZj0obGFzdCx0YXJnZXQpPT57aWYoIWxhc3QpcmV0dXJuIC41O2NvbnN0IGE9KG5ldyBEYXRlKHRhcmdldCktbmV3IERhdGUobGFzdCkpLzg2NGU1OwogIHJldHVybiBhPDIxPy43MjphPDYwPy42MjphPDEyMD8uNTU6YTwyNDA/LjQ4Oi40Mn07CiAvKiA9PT09PSDlrp/nuL7jgYvjgonlrabnv5LjgZfjgZ/jg6Ljg4fjg6vvvIjnibnlvrTph4/ihpIz552A5YaF546H77yJID09PT09ICovCiBjb25zdCBGTj1bImJpYXMiLCJvZmZzZXQiLCJubG9nIiwibm9IaXN0IiwiZlMiLCJmQyIsImF2Z0YiLCJyM3NoYXJlIiwicjNhdmciLCJsYXN0MSIsImxhc3RCaWciLCJjb25kRGlmZiIsImZpcnN0U3VyZiIsImdhcFNob3J0IiwiZ2FwTG9uZyIsImdhcFZMb25nIiwiYWdlMyIsImFnZTQiLCJhZ2U3Iiwic3RlcFVwIiwic3RlcERvd24iLCJ3aW5SYXRlIl07CiBjb25zdCBGSj1bImpSZWwiLCJqbG9nIiwiak1pc3MiXTsKIC8qIOS/guaVsOOBryB0b29scy9maXRfbW9kZWwuanMg44Gn5a2m57+S77yIMjAyMOW5tOOAnOOBruaZguezu+WIl+ODh+ODvOOCv++8ieOAgnt9IOOCkue9ruaPmyAqLwogY29uc3QgTU9ERUw9eyJjb3JlIjpbMC4wNTI5OSwwLjk5Njk3LDAuMDQ5NTEsLTAuMjQ1NDMsLTAuNTI4MTIsMC45MTk0NiwtMC41MTQ3NiwtMC4zNDc4NiwtMC41NzkwNCwtMC41NTExOCwwLjE2NzczLDEuMTE4MiwtMC4zNTMwNSwtMC4xMTEyOCwtMC4yMjcyOCwtMC40MDEyOSwwLjEzNzcxLDAuMjE2NjIsLTAuMzk2NzMsLTAuMzUzMDUsMC4wMDYxNywtMC41OTU2NF0sImZ1bGwiOlswLjQwNDMzLDEuMzcwMDcsMC4wNjI1MSwtMC4xMjI3OSwtMC41MDIzMiwwLjgyOTc4LC0wLjM5ODk1LC0wLjMwMDcyLC0wLjUxNTU5LC0wLjUyNTMyLDAuMTU4MzIsMS4wNjY5NSwtMC4zODM3NywtMC4wNzI4MiwtMC4yMjU2OCwtMC4zNTEsMC4xNTAyNSwwLjIxMjUzLC0wLjQxMzM0LC0wLjMyMzE5LDAuMDA3MjYsLTAuOTM3OTIsMC41MzU1NywwLjAwMzY1LC0wLjIwNjA1XX07CiBmdW5jdGlvbiBmZWF0cyhyLHN0b3JlLHJhY2UsTix3aXRoSil7CiAgY29uc3QgYj1jbGFtcCgzL04sLjA4LC41KSxsYj1sb2dpdChiKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLG49aD9oLm46MCxMdD1yYWNlLmx2bHx8MDsKICBjb25zdCBwUz0oKGg/aC50b3AzOjApKzMqYikvKG4rMyksZlM9bG9naXQocFMpLWxiOwogIC8vIOOCr+ODqeOCueijnOato++8muS9juOBhOOCr+ODqeOCue+8iOWcsOaWueOCkuWQq+OCgO+8ieOBp+OBruWlvei1sOOBr+WJsuOCiuW8leOBjeOAgemrmOOBhOOCr+ODqeOCueOBp+OBruWHoei1sOOBr+WJsuOCiuW8leOBjwogIGxldCBmQz1mUzsKICBpZihoJiZMdD4wKXtsZXQgSD0wLE09MDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoaC5sdikpe2NvbnN0IEw9TnVtYmVyKGspLFtjbixjdF09aC5sdltrXTtjb25zdCBnPUw9PT0wPzA6KEw8MD8tMjpMLUx0KTsKICAgIEgrPWN0KmNsYW1wKDErLjMqZywuNCwxLjgpO00rPShjbi1jdCkqY2xhbXAoMS0uMypnLC40LDEuOCl9CiAgIGZDPWxvZ2l0KChIKzMqYikvKEgrTSszKSktbGJ9CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxyYz1ydW5zLnNsaWNlKC0zKSxsYXN0Uj1ydW5zLmxlbmd0aD9ydW5zW3J1bnMubGVuZ3RoLTFdOm51bGw7CiAgY29uc3QgcjNzaGFyZT1yYy5sZW5ndGg/cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aC9yYy5sZW5ndGg6MDsKICBjb25zdCByM2F2Zz1yYy5sZW5ndGg/Y2xhbXAoKHJjLnJlZHVjZSgoYSx4KT0+YSt4WzFdLDApL3JjLmxlbmd0aC02KS82LC0xLDIpOjA7CiAgY29uc3QgbGFzdDE9bGFzdFI/Y2xhbXAoKGxhc3RSWzFdLTYpLzYsLTEsMik6MCxsYXN0QmlnPWxhc3RSJiZsYXN0UlsxXT49MTA/MTowOwogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDtsZXQgY29uZERpZmY9MCxmaXJzdFN1cmY9MDsKICBpZihzYyYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJighZGlzdHx8TWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKSk7CiAgIGlmKGNyLmxlbmd0aCljb25kRGlmZj0oY3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCsyKnBTKS8oY3IubGVuZ3RoKzIpLXBTOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSlmaXJzdFN1cmY9MX0KICBsZXQgZ2FwPW51bGw7aWYoaCYmaC5sYXN0JiZyYWNlLmRhdGUpZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogIGNvbnN0IGE9ci5hZ2V8fDA7CiAgY29uc3Qgc3RlcEQ9bGFzdFImJmxhc3RSWzRdPjAmJkx0PjA/Y2xhbXAoTHQtbGFzdFJbNF0sLTMsMyk6MDsKICBjb25zdCB4PVsxLGxiLE1hdGgubG9nKDErbiksbj09PTA/MTowLGZTLGZDLG4/Y2xhbXAoKGguc3VtL24tNikvNiwtMSwyKTowLHIzc2hhcmUscjNhdmcsbGFzdDEsbGFzdEJpZyxjb25kRGlmZixmaXJzdFN1cmYsCiAgIGdhcCE9bnVsbCYmZ2FwPDIxPzE6MCxnYXAhPW51bGwmJmdhcD4xMjA/MTowLGdhcCE9bnVsbCYmZ2FwPjI0MD8xOjAsYT09PTM/MTowLGE9PT00PzE6MCxhPj03PzE6MCxzdGVwRD4wP3N0ZXBEOjAsc3RlcEQ8MD8tc3RlcEQ6MCwKICAgbj8oKGgud2luKy4zKmIpLyhuKzEuNSktYik6MF07CiAgaWYod2l0aEope2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTsKICAgaWYoaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpO3gucHVzaChsb2dpdChwSiktbGIsTWF0aC5sb2coMStqLm4pLDApfWVsc2UgeC5wdXNoKDAsMCwxKX0KICByZXR1cm4geDsKIH0KIGNvbnN0IGRvdD0odyx4KT0+e2xldCB6PTA7Zm9yKGxldCBpPTA7aTx4Lmxlbmd0aDtpKyspeis9KHdbaV18fDApKnhbaV07cmV0dXJuIHp9OwogY29uc3QgbW9kZWxaPShraW5kLHgpPT5kb3QoTU9ERUxba2luZF0seCk7CiAvKiAx6aCt44Gu57Sg54K5KGxvZ2l0KeOBqOOCv+OCsOOAgmNvbXAg44Gn5oiQ5YiG44KST04vT0ZG44Gn44GN44KL77yI5qSc6Ki855So77yJICovCiBmdW5jdGlvbiBob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXA9e30pewogIGNvbXA9T2JqZWN0LmFzc2lnbih7fSxERUZBVUxULGNvbXApO2NvbnN0IHVzZT1rPT5jb21wW2tdIT09ZmFsc2UmJmNvbXBba10hPT0wOwogIGNvbnN0IGI9Y2xhbXAoMy9OLC4xLC41KSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLGo9c3RvcmUuai5nZXQoci5qb2NrZXkpOwogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10sbj1oP2gubjowLHRhZ3M9W107bGV0IHo9MCxjb25mPSLkvY4iOwogIGNvbnN0IHBIPSgoaD9oLnRvcDM6MCkrNCpiKS8obis0KTt6Kz1sb2dpdChwSCk7CiAgaWYobj49Miljb25mPW4+PTU/IumrmCI6IuS4rSI7ZWxzZSB0YWdzLnB1c2goe3Q6IuWxpeattOS4jei2syIsYzoiZyJ9KTsKICBpZihuPj0zKXtjb25zdCB0Mz1oLnRvcDMvbix3PWgud2luL247CiAgIGlmKHQzPj0uNDAmJnc8PS4yMCl0YWdzLnB1c2goe3Q6YOWWhOaIpuWeiyAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBlbHNlIGlmKHQzPj0uNDUpdGFncy5wdXNoKHt0OmDlronlrpogM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgaWYodXNlKCJhdmciKSYmaC5zdW0vbjw9NSl6Kz0uMTJ9CiAgY29uc3QgcmM9cnVucy5zbGljZSgtMyk7CiAgaWYodXNlKCJyZWNlbnQiKSYmcmMubGVuZ3RoPj0yKXtjb25zdCBjMz1yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLGF2Zz1yYy5yZWR1Y2UoKHMseCk9PnMreFsxXSwwKS9yYy5sZW5ndGg7CiAgIHorPS4yMiooYzMvcmMubGVuZ3RoLXBIKSozO2lmKGMzPj0yKXRhZ3MucHVzaCh7dDpg6L+RJHtyYy5sZW5ndGh96LWw44GnJHtjM33lm54z552A5YaFYCxjOiJiIn0pOwogICBjb25zdCBsYXN0PXJ1bnNbcnVucy5sZW5ndGgtMV07CiAgIGlmKGxhc3QmJmxhc3RbMV0+PTgmJm4+PTQmJmgudG9wMy9uPj0uMzUpe3orPS4xNTt0YWdzLnB1c2goe3Q6YOWJjei1sCR7bGFzdFsxXX3nnYDjgYvjgonlt7vjgY3ov5TjgZfkvZnlnLBgLGM6Im8ifSl9CiAgIGlmKGF2Zzw9NCYmcmMubGVuZ3RoPj0zKXorPS4wOH0KICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7CiAgaWYodXNlKCJjb25kIikmJnNjJiZkaXN0JiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmTWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKTsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpe3otPS4zNTt0YWdzLnB1c2goe3Q6YCR7c2M9PT0xPyLliJ3jga7oip0iOiLliJ3jga7jg4Djg7zjg4gife+8iOmBjuWOu+i1sOOBr+WIpemmrOWgtO+8iWAsYzoibyJ9KX0KICAgaWYoY3IubGVuZ3RoPj0yKXtjb25zdCB0Mz1jci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLHBjPSh0MysyKnBIKS8oY3IubGVuZ3RoKzIpOwogICAgeis9Y2xhbXAoMioocGMtcEgpLC0uNSwuNSk7aWYodDM+PTIpdGFncy5wdXNoKHt0OmDlkIzmnaHku7bjgacke3QzfS8ke2NyLmxlbmd0aH3lm54z552A5YaFYCxjOiJiIn0pfX0KICBpZih1c2UoImpvY2tleSIpJiZqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSksZGo9Y2xhbXAoLjYqKGxvZ2l0KHBKKS1sb2dpdChiKSksLS40LC41KTsKICAgeis9ZGo7aWYoZGo+PS4yNSl0YWdzLnB1c2goe3Q6YOmojuaJi+WlveiqvyAz552A5YaFJHtNYXRoLnJvdW5kKGoudG9wMy9qLm4qMTAwKX0lYCxjOiJiIn0pfQogIGlmKHVzZSgibGF5b2ZmIikmJmgmJmgubGFzdCl7Y29uc3QgZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogICB6Kz0uNioobGF5b2ZmKGgubGFzdCxyYWNlLmRhdGUpLS41KTtpZihnYXA+PTE4MCl0YWdzLnB1c2goe3Q6YCR7Z2FwfeaXpeOBtuOCimAsYzoibyJ9KX0KICBpZih1c2UoImFnZSIpKXtjb25zdCBhPXIuYWdlfHw1O2lmKGE9PT0zKXorPS4xMDtlbHNlIGlmKGE9PT00KXorPS4wNTtlbHNlIGlmKGE+PTgpe3otPS4xNTt0YWdzLnB1c2goe3Q6YCR7YX3mrbNgLGM6Im8ifSl9fQogIHJldHVybnt6LHRhZ3MsY29uZixufTsKIH0KIC8qIDIwMjPlubTku6XpmY3jga7mmYLns7vliJfmpJzoqLzjgafjga4g57Sg44Gu5aW96LWw546H4oaS56m044K+44O844Oz5a6f57i+77yI5bmz5Z2HcCwg5a6f57i+77yJICovCiBjb25zdCBDQUw9W1swLDAuMDFdLFswLjAyMiwwLjAxN10sWzAuMDQ2LDAuMDIyXSxbMC4wNzUsMC4wNDZdLFswLjEwNSwwLjA2OF0sWzAuMTM1LDAuMDgyXSxbMC4xNjUsMC4wOThdLFswLjE5MywwLjEwM10sWzAuMjI0LDAuMTM4XSxbMC4yNTksMC4xNjFdLFswLjMwMiwwLjE4N10sWzAuMzU4LDAuMjExXSxbMC40NTQsMC4yMjldXTsKIC8qIOOCquODg+OCuuOBquOBl+ODouODvOODie+8iOS6uuawl+OBruS7o+eQhu+8nemojuaJi+i+vOOBv+OBruWtpue/kuODouODh+ODq+OBrumghuS9jeOBp+eptOOCvuODvOODs+OCkuWIpOWumu+8ieOBruijnOato+ihqOOAgjIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafkvZzmiJAgKi8KIGNvbnN0IENBTF9QUk9YWT1bWzAsMC4wMTNdLFswLjAyMiwwLjAyMV0sWzAuMDQ2LDAuMDI4XSxbMC4wNzUsMC4wNTZdLFswLjEwNSwwLjA4Nl0sWzAuMTM1LDAuMTExXSxbMC4xNjUsMC4xMzRdLFswLjE5MywwLjE0Nl0sWzAuMjI0LDAuMjAxXSxbMC4yNTksMC4yMTldLFswLjMwMSwwLjI2MV0sWzAuMzU1LDAuMjk2XSxbMC40MzksMC4zNjddXTsKIGZ1bmN0aW9uIGludGVycChULHApe2ZvcihsZXQgaT0xO2k8VC5sZW5ndGg7aSsrKWlmKHA8PVRbaV1bMF0pe2NvbnN0W2EsYl09VFtpLTFdLFtjLGRdPVRbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIFRbVC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBjYWxpYkZvcihwLG1vZGUpe3JldHVybiBtb2RlPT09Im9kZHMiP2ludGVycChDQUwscCk6aW50ZXJwKENBTF9QUk9YWSxwKX0KIGZ1bmN0aW9uIGNhbGliKHApe2ZvcihsZXQgaT0xO2k8Q0FMLmxlbmd0aDtpKyspaWYocDw9Q0FMW2ldWzBdKXtjb25zdFthLGJdPUNBTFtpLTFdLFtjLGRdPUNBTFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gQ0FMW0NBTC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBub3JtYWxpemVUb3AzKHpzLHRvdGFsKXtsZXQgbG89LTgsaGk9ODsKICBmb3IobGV0IGk9MDtpPDYwO2krKyl7Y29uc3QgYz0obG8raGkpLzIscz16cy5yZWR1Y2UoKGEseik9PmErc2lnbW9pZCh6K2MpLDApO2lmKHM+dG90YWwpaGk9YztlbHNlIGxvPWN9CiAgY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHpzLm1hcCh6PT5zaWdtb2lkKHorYykpfQogLyogSGFydmlsbGXms5Xjgafli53njofihpIz552A5YaF546HICovCiBmdW5jdGlvbiB0b3AzRnJvbVdpbihwdyl7Y29uc3QgVD1wdy5yZWR1Y2UoKGEsYik9PmErYiwwKSxwPXB3Lm1hcCh4PT54L1QpLG49cC5sZW5ndGgsb3V0PW5ldyBBcnJheShuKS5maWxsKDApOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2xldCBzPXBbaV07CiAgIGZvcihsZXQgaj0wO2o8bjtqKyspaWYoaiE9PWkpe3MrPXBbal0qcFtpXS8oMS1wW2pdKTsKICAgIGZvcihsZXQgaz0wO2s8bjtrKyspaWYoayE9PWkmJmshPT1qKXMrPXBbal0qcFtrXS8oMS1wW2pdKSpwW2ldLygxLXBbal0tcFtrXSl9CiAgIG91dFtpXT1zfXJldHVybiBvdXR9CiAvKiDimIXmoLzkuIrjgZLoo5zmraPvvJrlrabnv5LmuIjjgb/jg6Ljg4fjg6vjga/nnYDpoIbjgpLjgZ3jga7jgb7jgb7opovjgovjga7jgafjgIHkuIvkvY3jgrDjg6zjg7zjg4njgafjga7lpb3otbDjgYzph43os57jg7tHMeOBp+OCguWQjOS+oeWApOOBq+OBquOBo+OBpuOBhOOBn+OAggogICAg55u06L+RM+i1sOOBruOBhuOBoSBPUC/ph43os54o44Kv44Op44K5NSnjga7otbDjgavjgaTjgYTjgabjgIHku4rlm57jga7jgrDjg6zjg7zjg4njgajjga7lt67jgaDjgZHoo5zmraPjgZnjgovvvIjjgq/jg6njgrk05Lul5LiL44Gv44Oi44OH44Or5YG044Gu6KOc5q2j44GM44GC44KL44Gu44Gn5LqM6YeN5o6b44GR44GX44Gq44GE77yJ44CCCiAgICAgIOagvOS4iuOBku+8iOS+iyBHM+KGkkcx77yJ77ya5aW96LWw44Gu5L6h5YCk44KS5Ymy44KK5byV44GP77yI552A6aCG44GM6Imv44GE44G744Gp5aSn44GN44GP77yJCiAgICAgIOagvOS4i+OBku+8iOS+iyBHMeKGkkcy77yJ77ya5Yeh6LWw44Gu5L6h5YCk44KS5bCR44GX5oi744GZCiAgICDkv4LmlbDjga/mmqvlrprlgKTjgILikaAtMuOBruOAjOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g+OAjeOBp+OAgeijnOato+OBguOCii/jgarjgZfjgpLlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafmr5Tjgbnjgabnorroqo3jgZnjgovjgZPjgajjgIIgKi8KIGNvbnN0IEdSQURFPXtvbjp0cnVlLEtVUDouMzAsS0ROOi4xMixNSU46LS45LE1BWDouNX07CiBmdW5jdGlvbiBncmFkZUFkaihyLHN0b3JlLHJhY2UsY29tcCl7CiAgaWYoIUdSQURFLm9ufHwoY29tcCYmY29tcC5ncmFkZT09PWZhbHNlKSlyZXR1cm4gMDsKICBjb25zdCBHdD1yYWNlLmdyZHx8MDtpZihHdDwyKXJldHVybiAwOwogIGNvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7aWYoIWh8fCFoLnJ1bnMubGVuZ3RoKXJldHVybiAwOwogIGNvbnN0IHJjPWgucnVucy5zbGljZSgtMyksVz1bWzFdLFsuNCwuNl0sWy4yLC4zLC41XV1bcmMubGVuZ3RoLTFdO2xldCBkPTA7CiAgcmMuZm9yRWFjaCgoeCxrKT0+e2NvbnN0IGZpbj14WzFdLEw9eFs0XXx8MCxHcj14WzVdfHwwO2lmKEwhPT01fHwhKGZpbj4wKSlyZXR1cm47CiAgIGNvbnN0IGdyPU1hdGgubWF4KEdyLDIpOyAgICAgICAgICAvLyBPUOODu+OCsOODrOODvOODieS4jeaYjuOBruOCr+ODqeOCuTXotbDjga8gRzMg55u45b2T44Go44GX44Gm5q+U6LyDCiAgIGlmKEd0PmdyJiZmaW48PTUpZC09V1trXSpHUkFERS5LVVAqKEd0LWdyKSooNi1maW4pLzY7CiAgIGVsc2UgaWYoR3Q8Z3ImJmZpbj49NClkKz1XW2tdKkdSQURFLktETiooZ3ItR3QpKk1hdGgubWluKDEsKGZpbi0zKS84KX0pOwogIHJldHVybiBjbGFtcChkLEdSQURFLk1JTixHUkFERS5NQVgpfQogY29uc3QgR049WyLkuI3mmI4v5LiL57SaIiwiT1Djg7tMIiwiRzMiLCJHMiIsIkcxIl07CiBmdW5jdGlvbiBncmFkZVRhZ3ModGFncyxkeixyYWNlKXtjb25zdCB0PXRhZ3Muc2xpY2UoKTsKICBpZihkejw9LS4yKXQudW5zaGlmdCh7dDpg5qC85LiK44GS5oim77yIJHtHTltyYWNlLmdyZHx8MF1977yJ77ya5LiL5L2N44Kw44Os44O844OJ44Gu5aW96LWw44Gv5Ymy5byVICR7ZHoudG9GaXhlZCgyKX1gLGM6Im8ifSk7CiAgZWxzZSBpZihkej49LjEpdC51bnNoaWZ0KHt0OmDpq5jjgrDjg6zjg7zjg4njgYvjgonjga7moLzkuIvjgZIgJHtkej49MD8iKyI6IiJ9JHtkei50b0ZpeGVkKDIpfWAsYzoiYiJ9KTsKICByZXR1cm4gdH0KIC8qIOODrOODvOOCueino+aekOOAgm9kZHMg44Gv5Lu75oSP77yI5YWo6aCt5YiG77yJ44CCICovCiBjb25zdCBMVk49WyLkuI3mmI4iLCLmnKrli53liKkiLCIx5YudIiwiMuWLnSIsIjPli50iLCJPUCJdOwogZnVuY3Rpb24gZXh0cmFUYWdzKHRhZ3MscixzdG9yZSxyYWNlKXsKICBjb25zdCB0PXRhZ3Muc2xpY2UoKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLEx0PXJhY2UubHZsfHwwOwogIGlmKGgpe2NvbnN0IGxhc3Q9aC5ydW5zLmxlbmd0aD9oLnJ1bnNbaC5ydW5zLmxlbmd0aC0xXTpudWxsOwogICBpZihsYXN0JiZsYXN0WzRdPjAmJkx0PjAmJmxhc3RbNF0hPT1MdCl0LnVuc2hpZnQobGFzdFs0XTxMdD97dDpg5piH57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoibyJ9Ont0OmDpmY3ntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJiIn0pOwogICBpZihoLmx2JiZoLmx2Wy0xXSl0LnB1c2goe3Q6IuWcsOaWueOBp+OBruWHuui1sOOBguOCiu+8iOWJsuW8leipleS+oe+8iSIsYzoiZyJ9KX0KICByZXR1cm4gdH0KIC8qIOODqeODs+OCr++8mueptOOCvuODvOODs+OBruW5s+Wdh+OBq+WvvuOBmeOCi+WAjeeOh+OBpyBTL0EvQi9D77yI5bGl5q2044GMMei1sOS7peS4i+OBr0Ljgb7jgafvvIkgKi8KIGNvbnN0IEFWR19IT0xFPXtvZGRzOi4wOTEscHJveHk6LjExNX07CiBmdW5jdGlvbiByYXRpbmcocGMsbW9kZSxuKXtjb25zdCByPXBjL0FWR19IT0xFW21vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdO2xldCBrPXI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIjtpZihuPDImJihrPT09IlMifHxrPT09IkEiKSlrPSJCIjtyZXR1cm4ga30KIC8qIOeahOS4reeOh+mHjeimlu+8muWun+e4vjPotbDku6XkuIrjg7vjg6njg7Pjgq9TL0Hjg7vvvIjjgqrjg4PjgrrjgYzliIbjgYvjgovjgajjgY3jga/vvInljZjli50zMOWAjeacqua6gOOBruWkp+eptOOCkumZpOOBj+OAgumBjuWOu+OBruaknOiovOOBp+OAgeeahOS4reeOh+OBjOS4iuOBjOOCiuOAgeWbnuWPjueOh+OBjOacgOaCquOBruWkp+eptOOCkumBv+OBkeOCieOCjOOBnyAqLwogY29uc3QgRk9DVVNfTUFYX09ERFM9MzA7CiBjb25zdCBGT0NVUz17Im9kZHMiOnsibiI6MzYyNSwiaGl0IjowLjIzMiwiYmFzZUhpdCI6MC4xNzIsInBlckRheSI6MTMuNn0sInByb3h5Ijp7Im4iOjQwMjUsImhpdCI6MC4yNzIsImJhc2VIaXQiOjAuMjE3LCJwZXJEYXkiOjE1LjF9fTsgICAvLyAyMDI05bm05Lul6ZmN44Gu5qSc6Ki877ya55qE5Lit546H77yIYmFzZUhpdD3lvpPmnaXjga4x5L2N5YCZ6KOc77yJ44O76ZaL5YKs5pel44GC44Gf44KK44Gu6aCt5pWwCiBmdW5jdGlvbiBwaWNrRm9jdXMocmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zJiYocmF0aW5nKHgucGMseC5tb2RlLHgubik9PT0iUyJ8fHJhdGluZyh4LnBjLHgubW9kZSx4Lm4pPT09IkEiKSYmKHgub2RkPT1udWxsfHx4Lm9kZDxGT0NVU19NQVhfT0REUykpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiAvKiDnqbTppqzlgJnoo5zvvJrlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gg44GR44KS44CB5aW96LWw546H44Gu6auY44GE6aCG44GrIGsg6aCt44CC5bGl5q2044Gu5LmP44GX44GE6aas44Gv5ZCM54K544Gr44Gq44KK44KE44GZ44GP44CB6aCG5L2N44Gr5oSP5ZGz44GM44Gq44GE44Gf44KB5a++6LGh5aSWICovCiBmdW5jdGlvbiBwaWNrKHJlcyxrKXtyZXR1cm4gcmVzLmZpbHRlcih4PT54LmhvbGUmJngubj49Mykuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCxrKX0KIGZ1bmN0aW9uIGFuYWx5emUocmFjZSxzdG9yZSxvZGRzLGNvbXAscG9wQXJyKXsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoOwogIGNvbnN0IHNjPVIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcCkpOwogIGNvbnN0IGR6PVIubWFwKHI9PmdyYWRlQWRqKHIsc3RvcmUscmFjZSxjb21wKSk7CiAgY29uc3QgemMwPU1PREVMLmNvcmU/Ui5tYXAocj0+bW9kZWxaKCJjb3JlIixmZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpKTpzYy5tYXAoeD0+eC56KTtjb25zdCB6Yz16YzAubWFwKCh6LGkpPT56K2R6W2ldKTsKICBjb25zdCBwPW5vcm1hbGl6ZVRvcDMoemMsTWF0aC5taW4oMyxOKSk7CiAgbGV0IG1rdD1udWxsLHBvcD1udWxsLG1vZGU9InByb3h5IjsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7bWt0PXRvcDNGcm9tV2luKG9kZHMubWFwKG89PjEvbykpO3BvcD1vZGRzLm1hcChvPT4xK29kZHMuZmlsdGVyKHg9Png8bykubGVuZ3RoKTttb2RlPSJvZGRzIn0KICBlbHNlIGlmKHBvcEFyciYmcG9wQXJyLmxlbmd0aD09PU4mJnBvcEFyci5ldmVyeSh4PT54PjApKXtwb3A9cG9wQXJyLnNsaWNlKCk7bW9kZT0ib2RkcyJ9IC8vIOWun+mam+OBruS6uuawl+mghuS9jeOBoOOBkeWIhuOBi+OCi+OBqOOBje+8iOe1kOaenOODmuODvOOCuOeUseadpe+8iQogIGVsc2V7IC8vIOOCquODg+OCuuOCguS6uuawl+OCguOBquOBhOOBqOOBje+8mumojuaJi+aIkOe4vuOBvuOBp+WQq+OCgeOBn+OCueOCs+OCouOBrumghuS9jeOCkuOAjOS6uuawl+OBruS7o+eQhuOAjeOBq+OBmeOCi++8iOWun+mam+OBruS6uuawl+OBqOOBruebuOmWoiAwLjU14oaSMC42N++8iQogICBjb25zdCBweD1NT0RFTC5mdWxsP1IubWFwKHI9Pm1vZGVsWigiZnVsbCIsZmVhdHMocixzdG9yZSxyYWNlLE4sdHJ1ZSkpKTpSLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLHtqb2NrZXk6dHJ1ZSxsYXlvZmY6ZmFsc2V9KS56KTtjb25zdCBweDI9cHgubWFwKCh2LGkpPT52K2R6W2ldKTtwb3A9cHgyLm1hcCh2PT4xK3B4Mi5maWx0ZXIoeT0+eT52KS5sZW5ndGgpfQogIGNvbnN0IHJhbms9cC5tYXAodj0+MStwLmZpbHRlcih4PT54PnYpLmxlbmd0aCk7CiAgY29uc3QgY3V0PU1hdGgubWF4KDUsTWF0aC5jZWlsKE4qLjQpKTsKICByZXR1cm4gUi5tYXAoKHIsaSk9Pih7aSxubzpyLm51bXx8aSsxLG5hbWU6ci5uYW1lfHxyLmhvcnNlLHA6cFtpXSxwYzpjYWxpYkZvcihwW2ldLG1vZGUpLG1vZGUsCiAgIGpuOihzdG9yZS5qb2NrZXkoci5qb2NrZXkpfHx7bjowfSkubixyYW5rOnJhbmtbaV0scG9wOnBvcFtpXSxiYXNlOk1hdGgubWluKC41LDMvTiksCiAgIG9kZDoob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpP29kZHNbaV06bnVsbCwKICAgY2FyZWVyOigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/e246aC5uLHQzOmgudG9wMyx3aW46aC53aW59Om51bGx9KSgpLAogICByZWNlbnQ6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLnJ1bnMubWFwKHg9PnhbMV0pOltdfSkoKSwKICAgam5hbWU6ci5qbmFtZXx8IiIsanN0YXQ6KCgpPT57Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpO3JldHVybiBqJiZqLm4+PTE/e246ai5uLHJhdGU6ai50b3AzL2oubn06bnVsbH0pKCksCiAgIGhvbGU6Tj49NiYmcG9wW2ldPj1jdXQsbWt0Om1rdD9ta3RbaV06bnVsbCx2YWx1ZTpta3Q/Y2FsaWJGb3IocFtpXSwib2RkcyIpL21rdFtpXTpudWxsLAogICBkejpkeltpXSx0YWdzOmdyYWRlVGFncyhleHRyYVRhZ3Moc2NbaV0udGFncyxyLHN0b3JlLHJhY2UpLGR6W2ldLHJhY2UpLGNvbmY6c2NbaV0uY29uZixuOnNjW2ldLm4sY3V0fSkpOwogfQoKIC8qID09PT09IOmJhOadv+i7uOmmrOODu+azouS5seW6pu+8iOeptOmmrOS6iOaDs+OBqOOBr+WIpeOBruioiOeul+OAguS/guaVsOOBryB0b29scy9heGlzX3Vwc2V0X3N0dWR5LmpzIOOBp+Wtpue/kuOAgTIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafmpJzoqLzvvIkgPT09PT0gKi8KIGNvbnN0IEFYSVM9eyJ3UCI6WzAuMDUxOTMsMS4wMTQ4MywwLjA1MTQ4LC0wLjIwNjc2LC0wLjUzMjE2LDAuOTE0MzcsLTAuNDg0NjQsLTAuMzIxMTUsLTAuNTY4MDIsLTAuNTUxMzUsMC4xNzM0NSwxLjA5NzQsLTAuMjg0MDcsLTAuMTAzOTcsLTAuMjE2MTcsLTAuMzQ2NjgsMC4xNTkxMywwLjIyMTk2LC0wLjM4NzMyLC0wLjM0NjU4LDAuMDAzNywtMC41NjY0Nl0sIndPIjpbMC41NDI1OSwwLjE1NjYxLDAuMDU0MTQsLTAuMDQzNzEsLTAuMTQ1MjQsMC4xMzE3MSwtMC4xNDE3OCwtMC4xNjI2MywwLjA1MzE2LC0wLjAyMDk3LDAuMDAzOSwtMC4yOTg2NSwtMC4zMjMyMSwtMC4wMTM2NSwtMC4wOTUxOSwtMC4wNzgxOCwwLjAwMDYsLTAuMDIyOTEsLTAuMTEyMTMsMC4wMTc4MSwtMC4wNDc0NSwtMC4xMDg1MiwwLjI1NzIxLDAuNjMwNzFdLCJ1cHNldCI6eyJ0aHIiOjE1LCJtb2RlbHMiOnsicHJveHkiOlsyLjI0NTU5LDAuNjM4NDEsLTAuMDcwOCwtMC4wODE2MSwtMC4wNzc0MywwLjA5MTM3LDAuMTM4NDcsMC4wMDI3OSwtMC4zODkxOSwtMC42NDIxNywtMC41NTM4MSwtMC4wMTgzNywtMC40NDMxNywtMC43NjgyNSwtMC41MjM5MywtMi43MzU2MSwtMC4xNDkwOSwwLjExNDc3XSwib2RkcyI6Wy0wLjcyMzk2LDAuNDI4MDgsLTAuMDc0OTksLTAuMDYxNTQsLTAuMDA2NzUsMC4wNzI0MywwLjA3MDg1LC0wLjA0OTc0LC0wLjE1NTI4LC0wLjMyNTE2LC0wLjQxODI2LC0wLjMxMzUxLDAuMjA3NTcsLTAuMjM5LC0wLjI3OTAxLC0xLjgyMTA4LC0wLjAwODUyLDAuMDgzOTksMC4xNTAyNCwwLjM1MjQyLC0yLjAzODM5LDIuODU2NjgsMC4yMjkyOSwwLjcyMDg0LC0xLjk3Nzk3XX0sImdyYWRlcyI6eyJwcm94eSI6eyJjdXRzIjpbWyJTU1MiLDAuNTUwMzddLFsiU1MiLDAuNDg1NV0sWyJTIiwwLjQwNDI0XSxbIkEiLDAuMjk4OF0sWyJCIiwwLjE4OTU3XSxbIkMiLDAuMDA2MjldXSwicmF0ZXMiOnsiU1NTIjowLjU3NCwiU1MiOjAuNTA5LCJTIjowLjQzMywiQSI6MC4zNDcsIkIiOjAuMjQ0LCJDIjowLjA4OX0sImF2Z1MiOnsiU1NTIjoxNy4yLCJTUyI6MTUuMywiUyI6MTQuMiwiQSI6MTMuMSwiQiI6MTEuOCwiQyI6OS44fX0sIm9kZHMiOnsiY3V0cyI6W1siU1NTIiwwLjYwOTY4XSxbIlNTIiwwLjUxNTk1XSxbIlMiLDAuNDA4NTRdLFsiQSIsMC4yODc2N10sWyJCIiwwLjE3MzU5XSxbIkMiLDAuMDA3NjhdXSwicmF0ZXMiOnsiU1NTIjowLjY3OSwiU1MiOjAuNTk4LCJTIjowLjQ1NSwiQSI6MC4zNTIsIkIiOjAuMjQ2LCJDIjowLjA3OX0sImF2Z1MiOnsiU1NTIjoxOC41LCJTUyI6MTYuNCwiUyI6MTQuNSwiQSI6MTMuMywiQiI6MTEuOCwiQyI6OS42fX19fSwiYmFuZHMiOnsi6YmE5p2/Ijp7ImxvIjowLjkyLCJoaSI6MSwibiI6MTY2LCJyYXRlIjowLjk2MzksImxvOTUiOjAuOTM1NSwibjIiOjg3LCJyYXRlMiI6MC45NzcsInBlckRheSI6MC42Mn0sIua6lumJhOadvyI6eyJsbyI6MC44OCwiaGkiOjAuOTIsIm4iOjI3OSwicmF0ZSI6MC44ODUzLCJsbzk1IjowLjg0NzksIm4yIjoxMzksInJhdGUyIjowLjg5OTMsInBlckRheSI6MS4wNH0sIuWghei7uCI6eyJsbyI6MC44NCwiaGkiOjAuODgsIm4iOjQ3NCwicmF0ZSI6MC44NDE4LCJsbzk1IjowLjgwODksIm4yIjoyMjYsInJhdGUyIjowLjg0MDcsInBlckRheSI6MS43OH19fTsKIGZ1bmN0aW9uIGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgseGM9Ui5tYXAocj0+ZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKTsKICBjb25zdCBwUD1ub3JtYWxpemVUb3AzKHhjLm1hcCh4PT5kb3QoQVhJUy53UCx4KSksTWF0aC5taW4oMyxOKSk7CiAgbGV0IHBPPW51bGw7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCksbTM9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7CiAgIHBPPW5vcm1hbGl6ZVRvcDMoeGMubWFwKCh4LGkpPT5kb3QoQVhJUy53TyxbLi4ueCxNYXRoLmxvZyhwd1tpXSksbG9naXQoTWF0aC5taW4oLjk4LG0zW2ldKSldKSksTWF0aC5taW4oMyxOKSl9CiAgcmV0dXJue3BQLHBPLHhjfX0KIC8qIOmJhOadv+i7uOmmrO+8muOCquODg+OCuuOBjOOBguOCi+ODrOODvOOCueOBoOOBkeOAguS6iOa4rOeiuueOh+OBruWMuuWIhuOBlOOBqOOBq+OAgemBjuWOu+OBruWun+mam+OBrjPnnYDlhoXnjofjgpLmt7vjgYjjgosgKi8KIGZ1bmN0aW9uIGF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTtpZighYXAucE8pcmV0dXJuIG51bGw7CiAgY29uc3Qgb3V0PVtdO2FwLnBPLmZvckVhY2goKHAsaSk9PnsKICAgZm9yKGNvbnN0IGsgb2YgWyLpiYTmnb8iLCLmupbpiYTmnb8iLCLloIXou7giXSl7Y29uc3QgYj1BWElTLmJhbmRzW2tdO2lmKHA+PWIubG8mJnA8KGs9PT0i6YmE5p2/Ij8xLjAxOmIuaGkpKXtvdXQucHVzaCh7aSxwLHRpZXI6ayxyYXRlOmIucmF0ZSxsbzk1OmIubG85NSxuOmIubn0pO2JyZWFrfX19KTsKICByZXR1cm4gb3V0LnNvcnQoKGEsYik9PmIucC1hLnApfQogLyog5rOi5Lmx5bqm77yaU1NT44CcQ+OAgjPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkSAqLwogZnVuY3Rpb24gdXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHBzPWFwLnBQLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi1hKTsKICBjb25zdCBucz1SLm1hcChyPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLm46MH0pLG1vbnRoPU51bWJlcihTdHJpbmcocmFjZS5kYXRlKS5zbGljZSg1LDcpKXx8MCxMPXJhY2UubHZsfHwwOwogIGNvbnN0IGY9WzEsTi8xNixMPT09MT8xOjAsTD09PTI/MTowLEw9PT0zPzE6MCxMPT09ND8xOjAsTD09PTU/MTowLHJhY2Uuc3VyZj09PTE/MTowLChyYWNlLmRpc3R8fDApLzIwMDAsCiAgIG5zLmZpbHRlcihuPT5uPT09MCkubGVuZ3RoL04sbnMuZmlsdGVyKG49Pm48MykubGVuZ3RoL04sbnMucmVkdWNlKChhLG4pPT5hK01hdGgubG9nKDErbiksMCkvTi8zLAogICBwc1swXSxwc1sxXSxwc1syXSxwcy5yZWR1Y2UoKGEscCk9PmErcCpwLDApLHBzLmZpbHRlcihwPT5wPi41KS5sZW5ndGgvMyxtb250aD49NiYmbW9udGg8PTk/MTowXTsKICBsZXQgbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLnNvcnQoKGEsYik9PmItYSksb2Q9b2Rkcy5zbGljZSgpLnNvcnQoKGEsYik9PmEtYik7CiAgIGNvbnN0IGVudD0tcHcucmVkdWNlKChhLHApPT5hK3AqTWF0aC5sb2cocCksMCkvTWF0aC5sb2coTik7CiAgIGYucHVzaChwd1swXSxwd1sxXSxwd1swXStwd1sxXStwd1syXSxlbnQsTWF0aC5sb2cob2RbMF0pLE1hdGgubG9nKG9kWzFdKSxvZC5maWx0ZXIobz0+bzwxMCkubGVuZ3RoL04pO21vZGU9Im9kZHMifQogIHJldHVybntmLG1vZGUscDA6c2lnbW9pZChkb3QoQVhJUy51cHNldC5tb2RlbHNbbW9kZV0sZikpfX0KIGZ1bmN0aW9uIHVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBjb25zdCB1PXVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZGRzLGFwKSxtb2RlPXUubW9kZSxwPXUucDAsRz1BWElTLnVwc2V0LmdyYWRlc1ttb2RlXTsKICBsZXQgZ3JhZGU9IkMiO2Zvcihjb25zdCBbZyxjXSBvZiBHLmN1dHMpe2lmKHA+PWMpe2dyYWRlPWc7YnJlYWt9fQogIHJldHVybntncmFkZSxwLG1vZGUscmF0ZTpHLnJhdGVzW2dyYWRlXSxhdmdTOkcuYXZnU1tncmFkZV19fQoKIC8qIOaJleaIu+OBpOOBjeaZguezu+WIl+ODkOODg+OCr+ODhuOCueODiOOAgnJhY2VzIOOBr+aXpeS7mOaYh+mghiBbe2lkLGRhdGUscm93c31d44CBcGF5QnlJZCDjga8ge3JhY2VJZDp7cGxhY2U6W3tudW1iZXIseWVufV19feOAggogICAg56m044K+44O844Oz44Gv5a6f44Kq44OD44K66aCG5L2N44Gn5a6a576p77yI44OE44O844Or44Gu44Kq44OD44K65YWl5Yqb44Oi44O844OJ44Go5ZCM44GY54q25rOB77yJ44CC5ZCE44Os44O844K5MTAw5YaG44Ga44Gk6LO85YWl44CCICovCiBmdW5jdGlvbiBiYWNrdGVzdChyYWNlcyxwYXlCeUlkLG9wdHMpewogIG9wdHM9b3B0c3x8e307Y29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IiIsU1BMSVQ9b3B0cy5zcGxpdHx8IiIsT09TPW9wdHMub29zfHwiIixQUk9YWT0hIW9wdHMucHJveHksTUlORz1OdW1iZXIob3B0cy5taW5HcmQpfHwwLF9nT249R1JBREUub247R1JBREUub249IW9wdHMuZ3JhZGVPZmY7CiAgY29uc3QgbmFtZXM9WyJ0b3AxIiwidG9wMiIsInRvcDMiLCJhbGxIb2xlIiwidmFsdWUiLCJheGlzIiwiZm9jdXMiXSxwZXI9WyJhbGwiLCJBIiwiQiIsIkMiXTsKICBjb25zdCBTPXt9O2Zvcihjb25zdCBuIG9mIG5hbWVzKXtTW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcilTW25dW3BdPXtiZXRzOjAsaGl0czowLHJldDowLHNxOjB9fQogIGNvbnN0IFNFRz17fTsgICAvLyAx5L2N5YCZ6KOc44Gu5p2h5Lu25Yil77yI5YWo5pyf6ZaT77yP5YmN5Y2K77yP5b6M5Y2K77yJCiAgY29uc3Qgc3RvcmU9bmV3IFN0b3JlKCk7bGV0IHVzZWQ9MDsKICBjb25zdCBhZGQ9KG4scCxoaXQseWVuKT0+e2NvbnN0IHg9U1tuXVtwXTt4LmJldHMrKztpZihoaXQpeC5oaXRzKys7eC5yZXQrPXllbjt4LnNxKz15ZW4qeWVufTsKICBjb25zdCBhZGRTZWc9KGxhYmVsLHAseWVuKT0+e2NvbnN0IGc9U0VHW2xhYmVsXT1TRUdbbGFiZWxdfHx7YWxsOntuOjAsaDowLHI6MCxxOjB9LEE6e246MCxoOjAscjowLHE6MH0sQjp7bjowLGg6MCxyOjAscTowfX07Zm9yKGNvbnN0IGsgb2YgWyJhbGwiLHBdKXtjb25zdCB4PWdba107eC5uKys7aWYoeWVuPjApeC5oKys7eC5yKz15ZW47eC5xKz15ZW4qeWVufX07CiAgY29uc3QgQVY9UFJPWFk/LjExNTouMDkxOwogIGZvcihjb25zdCByYyBvZiByYWNlcyl7CiAgIC8vIOaJleaIu+OBrklE44Gv44CM5pel5LuYLemWi+WCrOWgtC1S55Wq5Y+344CN44CC44OQ44OD44Kv44Ki44OD44OX44GuMTLmoYFJROOBqOOCguOAgeWQjOOBmOW9ouW8j+OBrklE44Go44KC57WQ44Gz5LuY44GR44KLCiAgIGNvbnN0IHZPZj0vXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDQsNik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzNdfHwiIixyT2Y9TnVtYmVyKC9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoMTAsMTIpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVs0XXx8MCk7CiAgIGNvbnN0IHBheT1wYXlCeUlkW3JjLmlkXXx8cGF5QnlJZFtgJHtyYy5kYXRlfS0ke3ZPZn0tJHtTdHJpbmcock9mKS5wYWRTdGFydCgyLCIwIil9YF07CiAgIGlmKHBheSYmcGF5LnBsYWNlJiZwYXkucGxhY2UubGVuZ3RoJiZyYy5kYXRlPj1TVEFSVCYmKCFNSU5HfHwoKHJjLnJvd3NbMF0mJnJjLnJvd3NbMF0uZ3JkKXx8MCk+PU1JTkcpKXsKICAgIC8vIOWHuui1sOihqOOBqOWQjOOBmOmmrOeVqumghuOBq+S4puOBueOCi++8iOWQjOeCueOBruOBqOOBjeOBruS4puOBs+OBp+edgOmghuOBjOa8j+OCjOOBquOBhOOCiOOBhuOBq++8iQogICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKTsKICAgIGNvbnN0IGhhc09kZHM9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5vZGRzPjEpLGhhc1BvcD1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLnBvcD4wKTsKICAgIGlmKFBST1hZP1IubGVuZ3RoPj02OihoYXNPZGRzfHxoYXNQb3ApKXsKICAgICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLGdyZDpSWzBdLmdyZHx8MCxydW5uZXJzOlJ9OwogICAgIGNvbnN0IHJlcz1QUk9YWT9hbmFseXplKHJhY2Usc3RvcmUsbnVsbCk6KGhhc09kZHM/YW5hbHl6ZShyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpOmFuYWx5emUocmFjZSxzdG9yZSxudWxsLG51bGwsUi5tYXAocj0+ci5wb3ApKSk7CiAgICAgY29uc3QgeWVuPW5ldyBNYXAocGF5LnBsYWNlLm1hcCh4PT5beC5udW1iZXIseC55ZW5dKSk7CiAgICAgY29uc3QgaG9sZT1yZXMuZmlsdGVyKHg9PnguaG9sZSkuc29ydCgoYSxiKT0+Yi5wLWEucCk7CiAgICAgaWYoaG9sZS5sZW5ndGgpewogICAgICB1c2VkKys7Y29uc3QgcHI9U1BMSVQ/KHJjLmRhdGU8U1BMSVQ/IkEiOiJCIik6IkEiOwogICAgICBjb25zdCBidXk9KG4sbGlzdCk9Pntmb3IoY29uc3QgeCBvZiBsaXN0KXtjb25zdCB5PXllbi5nZXQoUlt4LmldLm51bSl8fDA7YWRkKG4sImFsbCIseT4wLHkpO2FkZChuLHByLHk+MCx5KTtpZihPT1MmJnJjLmRhdGU+PU9PUylhZGQobiwiQyIseT4wLHkpfX07CiAgICAgIGJ1eSgiZm9jdXMiLHBpY2tGb2N1cyhyZXMsMSkpOwogICAgICBidXkoInRvcDEiLHBpY2socmVzLDEpKTtidXkoInRvcDIiLHBpY2socmVzLDIpKTtidXkoInRvcDMiLHBpY2socmVzLDMpKTtidXkoImFsbEhvbGUiLGhvbGUpOwogICAgICBpZighUFJPWFkpYnV5KCJ2YWx1ZSIsaG9sZS5maWx0ZXIoeD0+eC52YWx1ZT49MS4zKSk7CiAgICAgIGlmKCFQUk9YWSYmaGFzT2Rkcyl7Y29uc3QgYXA9YXhpc1Byb2JzKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7aWYoYXAucE8pYnV5KCJheGlzIixhcC5wTy5tYXAoKHAsaSk9Pih7aSxwfSkpLmZpbHRlcih4PT54LnA+PUFYSVMuYmFuZHNbIumJhOadvyJdLmxvKSl9CiAgICAgIGNvbnN0IHQ9cGljayhyZXMsMSlbMF07CiAgICAgIGlmKHQpe2NvbnN0IHk9eWVuLmdldChSW3QuaV0ubnVtKXx8MCxyPXQucGMvQVYsTj1SLmxlbmd0aDsKICAgICAgIGNvbnN0IHJhbms9KHI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIik7CiAgICAgICBhZGRTZWcoIuODqeODs+OCryIrKHQubjwyJiYocmFuaz09PSJTInx8cmFuaz09PSJBIik/IkIiOnJhbmspLHByLHkpOwogICAgICAgYWRkU2VnKE48PTEwPyLpoK3mlbAg44CcMTAiOk48PTE0PyLpoK3mlbAgMTHjgJwxNCI6IumgreaVsCAxNeOAnCIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5zdXJmPT09MT8i6IqdIjpyYWNlLnN1cmY9PT0yPyLjg4Djg7zjg4giOiLjgZ3jga7ku5YiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2UubHZsPjA/IuOCr+ODqeOCuSAiK0xWTltyYWNlLmx2bF06IuOCr+ODqeOCuSDkuI3mmI4iLHByLHkpOwogICAgICAgYWRkU2VnKHQubj49NT8i5a6f57i+IDXotbDku6XkuIoiOnQubj49Mz8i5a6f57i+IDPjgJw06LWwIjoi5a6f57i+IDPotbDmnKrmuoAiLHByLHkpOwogICAgICAgaWYoIVBST1hZJiZ0Lm9kZCl7Y29uc3Qgbz10Lm9kZDthZGRTZWcobzw4PyLljZjli50g44CcOOWAjSI6bzwxNT8i5Y2Y5YudIDjjgJwxNeWAjSI6bzwzMD8i5Y2Y5YudIDE144CcMzDlgI0iOm88NjA/IuWNmOWLnSAzMOOAnDYw5YCNIjoi5Y2Y5YudIDYw5YCN44CcIixwcix5KTsKICAgICAgICBpZihoYXNPZGRzKXtjb25zdCB1Zz11cHNldEdyYWRlKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7YWRkU2VnKCLms6LkubHluqYgIit1Zy5ncmFkZSxwcix5KX19fQogICAgIH0KICAgIH0KICAgfQogICBmb3IoY29uc3QgciBvZiByYy5yb3dzKXN0b3JlLmFkZChyKTsKICB9CiAgY29uc3QgZmluPXt9OwogIGZvcihjb25zdCBuIG9mIG5hbWVzKXtmaW5bbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKXtjb25zdCB4PVNbbl1bcF07CiAgIGlmKCF4LmJldHMpe2ZpbltuXVtwXT17YmV0czowfTtjb250aW51ZX0KICAgY29uc3QgbWVhbj14LnJldC94LmJldHMsc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5zcS94LmJldHMtbWVhbiptZWFuKSk7CiAgIGZpbltuXVtwXT17YmV0czp4LmJldHMsaGl0UmF0ZTp4LmhpdHMveC5iZXRzLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5iZXRzKS8xMDB9fX0KICBjb25zdCBzZWdzPXt9OwogIGZvcihjb25zdCBbayxnXSBvZiBPYmplY3QuZW50cmllcyhTRUcpKXtzZWdzW2tdPXt9O2Zvcihjb25zdCBwIG9mIFsiYWxsIiwiQSIsIkIiXSl7Y29uc3QgeD1nW3BdOwogICBpZigheC5uKXtzZWdzW2tdW3BdPXtiZXRzOjB9O2NvbnRpbnVlfWNvbnN0IG1lYW49eC5yL3gubixzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnEveC5uLW1lYW4qbWVhbikpOwogICBzZWdzW2tdW3BdPXtiZXRzOngubixoaXRSYXRlOnguaC94Lm4scm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4Lm4pLzEwMH19fQogIEdSQURFLm9uPV9nT247cmV0dXJue3JhY2VzOnVzZWQsc3RhdHM6ZmluLHNlZ3N9OwogfQogcmV0dXJue3Vwc2V0RmVhdHVyZXMsY2xlYW5UcixHUkFERSxncmFkZVRpZXIsZ3JhZGVBZGosRk9DVVMscmF0aW5nLHBpY2tGb2N1cyxBWElTLGF4aXNQcm9icyxheGlzUGlja3MsdXBzZXRHcmFkZSxwaWNrLGZlYXRzLE1PREVMLEZOLEZKLGxldmVsT2ZMYWJlbCxsZXZlbE9mUHJpemUsYmFja3Rlc3QsY2FsaWIsY2FsaWJGb3Isam5uLG5uLHRvUm93LGNzdlJvd3MsU3RvcmUsYW5hbHl6ZSxob3JzZVNjb3JlLG5vcm1hbGl6ZVRvcDMsdG9wM0Zyb21XaW4sc3VyZkNvZGUscGFyc2VEYXRlfTsKfSkoKTsKCgoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOOCouODl+ODquWxpO+8iOWGjeani+evie+8iQogKiAg44O75L+d5a2YL+WGjemWi+OBpOOBjeOBrumBjuWOu+ODh+ODvOOCv+WPluW+l+OAgeODkOODg+OCr+OCouODg+ODl+OAgeaknOiovOOBr+OAgeWLleS9nOeiuuiqjea4iOOBv+OBruWHpueQhuOCkuOBneOBruOBvuOBvuWGjeWIqeeUqAogKiAg44O75LuK6YCx5pyr44Gu5Y+W5b6X44CB6aiO5omL44O76Kq/5pWZ5bir44Gu54Wn5ZCI44CB5pyf5b6F5YCk44CB6LaF6YmE5p2/44CB5rOi5Lmx5bqm44CB5Y+W44KK6L6844G/5ZOB6LOq44Gu6KGo56S644Gv5paw6KaPCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgJD1pZD0+ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOwpjb25zdCBlc2M9cz0+U3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9bJjw+IiddL2csbT0+KHsiJiI6IiZhbXA7IiwiPCI6IiZsdDsiLCI+IjoiJmd0OyIsJyInOiImcXVvdDsiLCInIjoiJiMzOTsifVttXSkpOwpjb25zdCBzbGVlcD0obXM9MCk9Pm5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQocixtcykpOwpmdW5jdGlvbiBidXN5KG9uLG1zZz0i5Yem55CG5Lit4oCmIil7JCgiYnVzeSIpLnN0eWxlLmRpc3BsYXk9b24/ImZsZXgiOiJub25lIjskKCJidXN5VGV4dCIpLnRleHRDb250ZW50PW1zZ30KbGV0IERCPW51bGwsU1RPUkU9bnVsbCxTVE9SRV9LRVk9IiI7CmNvbnN0IFZFTlVFPXsiMDEiOiLmnK3luYwiLCIwMiI6IuWHvemkqCIsIjAzIjoi56aP5bO2IiwiMDQiOiLmlrDmvZ8iLCIwNSI6IuadseS6rCIsIjA2Ijoi5Lit5bGxIiwiMDciOiLkuK3kuqwiLCIwOCI6IuS6rOmDvSIsIjA5Ijoi6Ziq56WeIiwiMTAiOiLlsI/lgIkifTsKY29uc3QganN0VG9kYXk9KCk9Pm5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmNvbnN0IHBjdD0oeCxrPTApPT54PT1udWxsfHwhTnVtYmVyLmlzRmluaXRlKHgpPyItIjooeCoxMDApLnRvRml4ZWQoaykrIiUiOwoKZnVuY3Rpb24gb3BlbkRCKCl7cmV0dXJuIG5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCByPWluZGV4ZWREQi5vcGVuKCJ1cHNldF90b29sX2RiIiwyKTsKIHIub251cGdyYWRlbmVlZGVkPWU9Pntjb25zdCBkPWUudGFyZ2V0LnJlc3VsdDtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJmaWxlcyIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoImZpbGVzIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygibWV0YSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoIm1ldGEiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJwYXkiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJwYXkiKX07CiByLm9uc3VjY2Vzcz0oKT0+e0RCPXIucmVzdWx0O29rKCl9O3Iub25lcnJvcj0oKT0+bmcoci5lcnJvcik7ci5vbmJsb2NrZWQ9KCk9Pm5nKG5ldyBFcnJvcigi5LuW44Gu44K/44OW44Gn5L2/55So5Lit44Gn44GZIikpfSl9CmNvbnN0IGlkYkFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oImZpbGVzIikub2JqZWN0U3RvcmUoImZpbGVzIikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoImZpbGVzIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJmaWxlcyIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJDbGVhcj0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIiksc3Q9dC5vYmplY3RTdG9yZSgiZmlsZXMiKTtzdC5vcGVuQ3Vyc29yKCkub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtpZighU3RyaW5nKGMua2V5KS5zdGFydHNXaXRoKCJsaXZlOiIpKXttYXJrRGlydHkoImZpbGVzIixjLmtleSk7Yy5kZWxldGUoKX1jLmNvbnRpbnVlKCl9fTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwoKLyog5Y+W44KK6L6844G/5riI44G/44Gu5YWo6KGM77yI44OQ44OD44Kv44Ki44OD44OXQ1NW77yL5Y+W5b6X5riI44G/44Gu5oiQ57i+77yJ44KS6aCG44Gr5rih44GZICovCmFzeW5jIGZ1bmN0aW9uIGZvckVhY2hSb3coY2IpewogY29uc3QgZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IobGV0IGk9MDtpPGZzLmxlbmd0aDtpKyspe2NvbnN0IGY9ZnNbaV07CiAgaWYoZi5saXZlKXtmb3IoY29uc3QgeCBvZiBmLnJvd3N8fFtdKWNiKGxpdmVSb3coeCkpfQogIGVsc2UgZm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpY2IoVUUudG9Sb3cobykpOwogIGlmKGklMz09PTIpYXdhaXQgc2xlZXAoMCl9Cn0KLyog44Os44O844K5SUTjgYvjgonplovlgqzloLTjg7tS55Wq5Y+377yIMTLmoYHjga5KUkHlvaLlvI/vvI/ml6Xku5gt6ZaL5YKs5aC0LVLlvaLlvI/jga7kuKHlr77lv5zvvIkgKi8KZnVuY3Rpb24gdmVudWVPZklkKGlkKXtyZXR1cm4gL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSg0LDYpOlN0cmluZyhpZCkuc3BsaXQoIi0iKVszXXx8IiJ9CmZ1bmN0aW9uIHJhY2VOb09mSWQoaWQpe3JldHVybiBOdW1iZXIoL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSgxMCwxMik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzRdfHwwKX0KCi8qIC0tLSDlj5bjgorovrzjgb8gLS0tICovCmFzeW5jIGZ1bmN0aW9uIGltcG9ydEZpbGUoZmlsZSl7CiBidXN5KHRydWUsIuODleOCoeOCpOODq+OCkuiqreOBv+i+vOOBv+S4reKAplxu5aSn44GN44GE44OV44Kh44Kk44Or44Gv5pWw5Y2B56eS44GL44GL44KK44G+44GZ44CCIik7YXdhaXQgc2xlZXAoMzApOwogdHJ5ewogIGNvbnN0IHRleHQ9YXdhaXQgZmlsZS50ZXh0KCk7bGV0IGl0ZW1zOwogIGlmKC9cLmNzdiQvaS50ZXN0KGZpbGUubmFtZSkpe2l0ZW1zPVt7dHlwZToicmFjZS1yZXN1bHRzIix5ZWFyOjAscGxhY2U6ZmlsZS5uYW1lLGNzdjp0ZXh0fV19CiAgZWxzZXtjb25zdCBqPUpTT04ucGFyc2UodGV4dCk7aXRlbXM9QXJyYXkuaXNBcnJheShqKT9qOihqLmZpbGVzfHxbal0pfQogIGl0ZW1zPWl0ZW1zLmZpbHRlcih4PT54JiZ0eXBlb2YgeC5jc3Y9PT0ic3RyaW5nIik7CiAgaWYoIWl0ZW1zLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoImNzduOCkuWQq+OCgOODh+ODvOOCv+OBjOimi+OBpOOBi+OCiuOBvuOBm+OCk+OAguODkOODg+OCr+OCouODg+ODl0pTT07jgYvjgIFDU1bjgpLpgbjjgpPjgafjgY/jgaDjgZXjgYTjgIIiKTsKICBhd2FpdCBpZGJDbGVhcigpO2xldCBuPTA7CiAgZm9yKGxldCBpPTA7aTxpdGVtcy5sZW5ndGg7aSsrKXtjb25zdCBpdD1pdGVtc1tpXTthd2FpdCBpZGJQdXQoYCR7aXQueWVhcnx8MH06JHtpdC5wbGFjZX06JHtpfWAse3llYXI6aXQueWVhcixwbGFjZTppdC5wbGFjZSxwbGFjZU5hbWU6aXQucGxhY2VOYW1lLGNzdjppdC5jc3Z9KTsKICAgbis9TWF0aC5tYXgoMCxpdC5jc3Yuc3BsaXQoIlxuIikubGVuZ3RoLTEpOyQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9YOS/neWtmOS4reKApiAke2krMX0vJHtpdGVtcy5sZW5ndGh9YDthd2FpdCBzbGVlcCgwKX0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iZ29vZCI+5Y+W44KK6L6844G/5a6M5LqG77yaJHtpdGVtcy5sZW5ndGh944OV44Kh44Kk44Or77yP57SEJHtuLnRvTG9jYWxlU3RyaW5nKCl96KGMPC9zcGFuPmA7CiAgYmtTY2hlZHVsZSgpOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7lj5bjgorovrzjgb/jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXtidXN5KGZhbHNlKX0KfQoKY29uc3QgcGF5QWxsPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigicGF5Iikub2JqZWN0U3RvcmUoInBheSIpLmdldEFsbCgpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgcGF5UHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigicGF5IiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgicGF5IikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJwYXkiLGspO29rKCl9O3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgbWV0YUdldD1rPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigibWV0YSIpLm9iamVjdFN0b3JlKCJtZXRhIikuZ2V0KGspO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdCk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBtZXRhUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigibWV0YSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoIm1ldGEiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoIm1ldGEiLGspO29rKCl9O3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKYXN5bmMgZnVuY3Rpb24gcGF5U3RhdGUoKXthd2FpdCBzaG93U3RhdGUoKX0KCi8qIC0tLSDlhbHpgJrjga7lj5blvpfvvIjlho3oqabooYzjgaTjgY3vvIkgLS0tICovCmxldCBTWU5DSU5HPWZhbHNlOwphc3luYyBmdW5jdGlvbiBmZXRjaEpTT04odXJsLHdhaXRzQXJnKXsKIGxldCBlcnI9IiI7Y29uc3Qgd2FpdHM9d2FpdHNBcmd8fHdpbmRvdy5fX1dBSVRTfHxbNDAwMCwxMjAwMCwzMDAwMCw2MDAwMF07CiBmb3IobGV0IHQ9MDt0PD13YWl0cy5sZW5ndGg7dCsrKXsKICB0cnl7CiAgIGNvbnN0IHI9YXdhaXQgZmV0Y2godXJsKTtjb25zdCB0eHQ9YXdhaXQgci50ZXh0KCk7bGV0IHg9e307dHJ5e3g9SlNPTi5wYXJzZSh0eHQpfWNhdGNoKGUpe30KICAgaWYoIXIub2t8fHgub2s9PT1mYWxzZSl7Y29uc3QgZT1uZXcgRXJyb3IoeC5lcnJvcnx8YEhUVFAgJHtyLnN0YXR1c31gKyh0eHQmJiF4LmVycm9yP2DvvIgke3R4dC5yZXBsYWNlKC9ccysvZywiICIpLnNsaWNlKDAsNTApfe+8iWA6IiIpKTtlLnN0YXR1cz1yLnN0YXR1czt0aHJvdyBlfQogICByZXR1cm4geDsKICB9Y2F0Y2goZSl7CiAgIGVycj1lLm1lc3NhZ2U7Y29uc3QgcmV0cnk9IWUuc3RhdHVzfHxlLnN0YXR1cz49NTAwfHxlLnN0YXR1cz09PTQyOTsKICAgaWYoIXJldHJ5fHx0PT09d2FpdHMubGVuZ3RoKWJyZWFrOwogICBpZihTWU5DSU5HKSQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1g5re36ZuR44Gu44Gf44KBJHtNYXRoLnJvdW5kKHdhaXRzW3RdLzEwMDApfeenkuW+heOBo+OBpuWGjeippuihjOOBl+OBvuOBmeKApu+8iCR7ZXJyfe+8iWA7CiAgIGF3YWl0IHNsZWVwKHdhaXRzW3RdKTsKICB9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyKTsKfQpjb25zdCBNT0RFTF9UUkFJTl9FTkQ9IjIwMjYtMDYtMjIiOyAgIC8vIOePvuWcqOOBruODouODh+ODq+OBr+OAgeOBk+OBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBp+Wtpue/kgpjb25zdCBqc3RZZXN0ZXJkYXk9KCk9Pm5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMtODY0ZTUpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmNvbnN0IGFkZERheXM9KGQsbik9Pm5ldyBEYXRlKG5ldyBEYXRlKGQrIlQwMDowMDowMFoiKS5nZXRUaW1lKCkrbio4NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKZnVuY3Rpb24gbW9udGhzQmV0d2VlbihhLGIpe2NvbnN0IG91dD1bXTtsZXRbeSxtXT1hLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTtjb25zdFt5MixtMl09Yi5zbGljZSgwLDcpLnNwbGl0KCItIikubWFwKE51bWJlcik7CiB3aGlsZSh5PHkyfHwoeT09PXkyJiZtPD1tMikpe291dC5wdXNoKGAke3l9LSR7U3RyaW5nKG0pLnBhZFN0YXJ0KDIsIjAiKX1gKTttKys7aWYobT4xMil7bT0xO3krK319cmV0dXJuIG91dH0KCgovKiAtLS0g4pGgIOODh+ODvOOCv+WPluW+l++8mumBjuWOu+aIkOe4vu+8iOS6uuawl+OBpOOBje+8ie+8i+aJleaIu+OCkuOAgemWi+WCrOaXpeOBlOOBqOOBq+WPluW+l+OBl+OBpuS/neWtmCAtLS0gKi8KY29uc3QgU1lOQ19CQVRDSD00LFNZTkNfUEFSQUxMRUw9MjsKbGV0IFNTVE9QPWZhbHNlLEJBQ0tVUF9EQVRFUz1udWxsOwokKCJzeW5jU3RvcCIpLm9uY2xpY2s9KCk9PntTU1RPUD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZX07CiQoInNlbmQiKS52YWx1ZT1qc3RZZXN0ZXJkYXkoKTsKYXN5bmMgZnVuY3Rpb24gYmFja3VwRGF0ZXMoKXsKIGlmKEJBQ0tVUF9EQVRFUylyZXR1cm4gQkFDS1VQX0RBVEVTOwogY29uc3Qgcz1uZXcgU2V0KCksZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IoY29uc3QgZiBvZiBmcyl7aWYoZi5saXZlKWNvbnRpbnVlO2Zvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKXtjb25zdCBkPVVFLnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKTtpZihkKXMuYWRkKGQpfWF3YWl0IHNsZWVwKDApfQogcmV0dXJuIEJBQ0tVUF9EQVRFUz1zOwp9CmFzeW5jIGZ1bmN0aW9uIGZldGNoRGF5KGJhc2UsZCl7CiBjb25zdCBkYXk9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1kYXk/ZGF0ZT0ke2R9YCk7CiBjb25zdCByYWNlcz1kYXkucmFjZXN8fFtdO2lmKCFyYWNlcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHJhY2VzLmxlbmd0aDtpKz1TWU5DX0JBVENIKWNodW5rcy5wdXNoKHJhY2VzLnNsaWNlKGksaStTWU5DX0JBVENIKS5tYXAoeD0+eC5jbmFtZSkpOwogY29uc3Qgcm93cz1bXSxwYXlvdXRzPVtdO2xldCBpZHg9MCxmYWlsZWROPTA7CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGlkeDxjaHVua3MubGVuZ3RoKXtjb25zdCBrPWlkeCsrOwogIGNvbnN0IHJlcz1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLXJlc3VsdHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gKTsKICByb3dzLnB1c2goLi4uKHJlcy5yb3dzfHxbXSkpO3BheW91dHMucHVzaCguLi4ocmVzLnBheW91dHN8fFtdKSk7ZmFpbGVkTis9KHJlcy5mYWlsZWR8fFtdKS5sZW5ndGh9fTsKIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oe2xlbmd0aDpNYXRoLm1pbihTWU5DX1BBUkFMTEVMLGNodW5rcy5sZW5ndGgpfSx3b3JrZXIpKTsKIGNvbnN0IGdvdD1uZXcgU2V0KHJvd3MubWFwKHI9PnIucmFjZUlkKSkuc2l6ZTsKIGZhaWxlZE49TWF0aC5tYXgoZmFpbGVkTixyYWNlcy5sZW5ndGgtZ290KTsKIHJldHVybntyb3dzLHBheW91dHMsZmFpbGVkTixyYWNlczpyYWNlcy5sZW5ndGh9Owp9CiQoInN5bmNHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiBjb25zdCBhPSQoInNzdGFydCIpLnZhbHVlfHwiMjAyMy0wMS0wMSIseWQ9anN0WWVzdGVyZGF5KCk7bGV0IGI9JCgic2VuZCIpLnZhbHVlfHx5ZDtpZihiPnlkKWI9eWQ7CiBpZihhPmIpeyQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5aeL5pel44GM57WC5LqG5pel44KI44KK5b6M44Gn44GZ44CCIjtyZXR1cm59CiBTU1RPUD1mYWxzZTtTWU5DSU5HPXRydWU7JCgic3luY0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPWZhbHNlOwogY29uc3Qgc3Q9e2RheXM6MCxyYWNlczowLHNraXBwZWQ6MCxmYWlsOltdLHQwOkRhdGUubm93KCl9O2xldCBjb25zZWM9MDsKIHRyeXsKICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IuS/neWtmOa4iOOBv+ODh+ODvOOCv+OCkueiuuiqjeS4reKApiI7CiAgY29uc3QgZmlsZXM9YXdhaXQgaWRiQWxsKCksaGF2ZUxpdmU9bmV3IFNldChmaWxlcy5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoKS5tYXAoZj0+Zi5kYXRlKSk7CiAgY29uc3QgaGF2ZVBheT1uZXcgU2V0KChhd2FpdCBwYXlBbGwoKSkuZmlsdGVyKHA9PiFwLmZhaWxlZCkubWFwKHA9PnAuZGF0ZSkpOwogIGNvbnN0IGJrPWF3YWl0IGJhY2t1cERhdGVzKCk7CiAgY29uc3QgbW9udGhzPW1vbnRoc0JldHdlZW4oYSxiKSxjdXJNb250aD15ZC5zbGljZSgwLDcpOwogIGZvcihsZXQgbWk9MDttaTxtb250aHMubGVuZ3RoO21pKyspewogICBpZihTU1RPUClicmVhaztjb25zdCBtb250aD1tb250aHNbbWldOwogICBpZihtb250aDxjdXJNb250aCYmYXdhaXQgbWV0YUdldCgibW9udGg6Iittb250aCkpe2NvbnRpbnVlfQogICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7bW9udGh977yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJ6ZaL5YKs5pel44KS56K66KqN5Lit4oCmIOWPluW+l+a4iOOBvyR7c3QuZGF5c33ml6VgOwogICBsZXQgZGF5czt0cnl7ZGF5cz0oYXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1kYXlzP21vbnRoPSR7bW9udGh9YCkpLmRheXN8fFtdO2NvbnNlYz0wfWNhdGNoKGUpe3N0LmZhaWwucHVzaChgJHttb250aH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgIGRheXM9ZGF5cy5maWx0ZXIoZD0+ZD49YSYmZDw9Yik7bGV0IG1vbnRoT2s9dHJ1ZTsKICAgZm9yKGNvbnN0IGQgb2YgZGF5cyl7CiAgICBpZihTU1RPUCl7bW9udGhPaz1mYWxzZTticmVha30KICAgIGNvbnN0IG5lZWRSb3dzPSFoYXZlTGl2ZS5oYXMoZCkmJiFiay5oYXMoZCksbmVlZFBheT0haGF2ZVBheS5oYXMoZCk7CiAgICBpZighbmVlZFJvd3MmJiFuZWVkUGF5KXtzdC5za2lwcGVkKys7Y29udGludWV9CiAgICBjb25zdCBlbD1NYXRoLnJvdW5kKChEYXRlLm5vdygpLXN0LnQwKS8xMDAwKTsKICAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtkfSDjgpLlj5blvpfkuK3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvIlcbuWPluW+lyR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yP5aSx5pWXJHtzdC5mYWlsLmxlbmd0aH3vvI/ntYzpgY4ke01hdGguZmxvb3IoZWwvNjApfeWIhiR7ZWwlNjB956eSYDsKICAgIHRyeXsKICAgICBjb25zdCByPWF3YWl0IGZldGNoRGF5KGJhc2UsZCk7CiAgICAgaWYoci5mYWlsZWROKXttb250aE9rPWZhbHNlO3N0LmZhaWwucHVzaChgJHtkfe+8iCR7ci5mYWlsZWROfVLlpLHmlZfvvIlgKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgICAgaWYobmVlZFJvd3Mpe2F3YWl0IGlkYlB1dChgbGl2ZToke2R9YCx7bGl2ZTp0cnVlLGRhdGU6ZCxyb3dzOnIucm93c30pO2hhdmVMaXZlLmFkZChkKX0KICAgICBhd2FpdCBwYXlQdXQoZCx7ZGF0ZTpkLHJhY2VzOnIucGF5b3V0cyxmYWlsZWQ6MH0pO2hhdmVQYXkuYWRkKGQpOwogICAgIHN0LmRheXMrKztzdC5yYWNlcys9ci5yYWNlcztjb25zZWM9MDsKICAgIH1jYXRjaChlKXttb250aE9rPWZhbHNlO3N0LmZhaWwucHVzaChgJHtkfe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX19CiAgICBhd2FpdCBzbGVlcCg0MDApOwogICB9CiAgIGlmKG1vbnRoT2smJm1vbnRoPGN1ck1vbnRoKWF3YWl0IG1ldGFQdXQoIm1vbnRoOiIrbW9udGgsdHJ1ZSk7CiAgfQogfWNhdGNoKGUpe3N0LmZhaWwucHVzaChTdHJpbmcoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5ewogIFNZTkNJTkc9ZmFsc2U7U1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7JCgic3luY0dvIikuZGlzYWJsZWQ9ZmFsc2U7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlOwogICQoInN5bmNTdGF0dXMiKS5pbm5lckhUTUw9YCR7c3Quc3RvcHBlZD8i6YCj57aa44GX44Gm5aSx5pWX44GX44Gf44Gf44KB5Lit5pat44GX44G+44GX44Gf77yIQ2xvdWRmbGFyZeWBtOOBrua3t+mbkeODu+WItumZkOOBruWPr+iDveaAp++8ieOAguWwkeOBl+aZgumWk+OCkuOBiuOBhOOBpuOCguOBhuS4gOW6puaKvOOBl+OBpuOBj+OBoOOBleOBhOOAglxuIjoiIn0ke1NTVE9QJiYhc3Quc3RvcHBlZD8i5YGc5q2i44GX44G+44GX44Gf44CCIjooc3Quc3RvcHBlZD8iIjoi5a6M5LqG44CCIil95LuK5Zue44Gu5Y+W5b6X77yaJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIjkv53lrZjmuIjjgb/jgafjgrnjgq3jg4Pjg5cgJHtzdC5za2lwcGVkfeaXpe+8iWArKHN0LmZhaWwubGVuZ3RoP2BcbjxzcGFuIGNsYXNzPSJ3YXJuIj7lpLHmlZcgJHtzdC5mYWlsLmxlbmd0aH3ku7bvvJoke2VzYyhzdC5mYWlsLnNsaWNlKDAsNCkuam9pbigi44CBIikpfSR7c3QuZmFpbC5sZW5ndGg+ND8iIOKApiI6IiJ9XG7vvIjjgoLjgYbkuIDluqbmirzjgZnjgajjgIHlpLHmlZfjgZfjgZ/ml6XjgaDjgZHjgoTjgornm7TjgZfjgb7jgZnvvIk8L3NwYW4+YDoiIik7CiAgYXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpOwogfQp9OwoKCi8qIC0tLSDmiZXmiLvjga7mm7jjgY3lh7rjgZfjg7voqq3jgb/ovrzjgb8gLS0tICovCiQoInBheUV4cCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aClyZXR1cm4gYWxlcnQoIuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAgiIpOwogY29uc3QgYT1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJhIik7YS5ocmVmPVVSTC5jcmVhdGVPYmplY3RVUkwobmV3IEJsb2IoW0pTT04uc3RyaW5naWZ5KHBzKV0se3R5cGU6ImFwcGxpY2F0aW9uL2pzb24ifSkpOwogYS5kb3dubG9hZD1ga2VpYmFfcGF5b3V0c18ke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKX0uanNvbmA7YS5jbGljaygpO3NldFRpbWVvdXQoKCk9PlVSTC5yZXZva2VPYmplY3RVUkwoYS5ocmVmKSwxMDAwKX07CiQoInBheUltcCIpLm9uY2hhbmdlPWFzeW5jIGU9PnsKIGNvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoIWYpcmV0dXJuOwogdHJ5e2NvbnN0IGo9SlNPTi5wYXJzZShhd2FpdCBmLnRleHQoKSk7Y29uc3QgYXJyPUFycmF5LmlzQXJyYXkoaik/ajooai5yYWNlcz9bal06W10pOwogIGNvbnN0IGJ5RGF0ZT1uZXcgTWFwKCk7CiAgZm9yKGNvbnN0IHggb2YgYXJyKXtpZih4JiZBcnJheS5pc0FycmF5KHgucmFjZXMpJiZ4LmRhdGUpYnlEYXRlLnNldCh4LmRhdGUse2RhdGU6eC5kYXRlLHJhY2VzOngucmFjZXMsZmFpbGVkOnguZmFpbGVkfHwwfSl9CiAgZm9yKGNvbnN0W2Qscl1vZiBieURhdGUpYXdhaXQgcGF5UHV0KGQscik7CiAgYXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpOwogfWNhdGNoKGVycil7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7oqq3jgb/ovrzjgb/jgqjjg6njg7zvvJoke2VzYyhlcnIubWVzc2FnZSl9PC9zcGFuPmB9CiBlLnRhcmdldC52YWx1ZT0iIjsKfTsKCgovKiAtLS0g4pGgLTIg6KSH5Yud5Zue5Y+O546H44Gu5qSc6Ki8IC0tLSAqLwokKCJidFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogdHJ5ewogIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CC5YWI44Gr4pGg44Gn5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHBheUJ5SWQ9e307cHMuZm9yRWFjaChwPT4ocC5yYWNlc3x8W10pLmZvckVhY2goeD0+e3BheUJ5SWRbeC5yYWNlSWRdPXh9KSk7CiAgY29uc3Qgc3RhcnQ9JCgiYnRTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSI7CiAgY29uc3QgcGRhdGVzPXBzLm1hcChwPT5wLmRhdGUpLmZpbHRlcihkPT5kPj1zdGFydCkuc29ydCgpOwogIGlmKCFwZGF0ZXMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumWi+Wni+aXpeS7pemZjeOBruaJleaIu+OBjOOBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBzcGxpdD1wZGF0ZXNbTWF0aC5mbG9vcihwZGF0ZXMubGVuZ3RoLzIpXTsKICBidXN5KHRydWUsIuaIkOe4vuOCkuiqreOBv+i+vOOBv+S4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBtYXA9bmV3IE1hcCgpOwogIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKICBidXN5KHRydWUsIuODkOODg+OCr+ODhuOCueODiOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvdXQ9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7c3RhcnQsc3BsaXQsb29zOk1PREVMX1RSQUlOX0VORH0pOwogIGJ1c3kodHJ1ZSwi44Kq44OD44K65pyq5YWl5Yqb44Gu5aC05ZCI44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dFA9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7c3RhcnQsc3BsaXQsb29zOk1PREVMX1RSQUlOX0VORCxwcm94eTp0cnVlfSk7YnVzeShmYWxzZSk7dHJ5e3NldEdhdGUob3V0LG91dFApfWNhdGNoKGUpe2NvbnNvbGUuZXJyb3IoZSl9CiAgY29uc3QgTD17dG9wMToi44OE44O844OrMeS9jSIsdG9wMjoi5LiK5L2NMumgrSIsdG9wMzoi5LiK5L2NM+mgrSIsYWxsSG9sZToi56m044K+44O844Oz5YWo6aCt77yI5Z+65rqW77yJIix2YWx1ZToi5aaZ5ZGzMS4z5YCN5Lul5LiKIixheGlzOiLpiYTmnb/ou7jvvIgwLjky5Lul5LiK44O744Kq44OD44K65pmC77yJIixmb2N1czoi4peO55qE5Lit546H6YeN6KaW44GuMeS9jSJ9OwogIGNvbnN0IHBjdD14PT4oeCoxMDApLnRvRml4ZWQoMCkrIiUiLGM9eD0+eCYmeC5iZXRzP2Ake3BjdCh4LnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHguc2UqMTk2KS50b0ZpeGVkKDApfTwvc3Bhbj5gOiItIjsKICBjb25zdCB0Ymw9KG8sdGl0bGUpPT57CiAgIGxldCB0PWA8Yj4ke3RpdGxlfTwvYj48ZGl2IGNsYXNzPSJzbWFsbCI+5a++6LGhICR7by5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCuTwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7os7zlhaXmlbA8L3RoPjx0aD7nmoTkuK3njoc8L3RoPjx0aD7lm57lj47njocoOTUl5bmFKTwvdGg+PHRoPuWJjeWNijwvdGg+PHRoPuW+jOWNijwvdGg+PHRoPuWtpue/kuW+jDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhMKSl7Y29uc3Qgdj1vLnN0YXRzW2tdO2lmKCF2LmFsbC5iZXRzKWNvbnRpbnVlOwogICAgdCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7di5hbGwuYmV0cy50b0xvY2FsZVN0cmluZygpfTwvdGQ+PHRkPiR7KHYuYWxsLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD48Yj4ke2Modi5hbGwpfTwvYj48L3RkPjx0ZD4ke3YuQS5iZXRzP3BjdCh2LkEucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkIuYmV0cz9wY3Qodi5CLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5DLmJldHM/YCR7cGN0KHYuQy5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh2LkMuc2UqMTk2KS50b0ZpeGVkKDApfe+8iCR7di5DLmJldHMudG9Mb2NhbGVTdHJpbmcoKX3vvIk8L3NwYW4+YDoiLSJ9PC90ZD48L3RyPmB9CiAgIHJldHVybiB0KyI8L3Rib2R5PjwvdGFibGU+In07CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj4ke3N0YXJ0feOAnO+8j+WJjeWNiu+8nSR7c3BsaXR944KI44KK5YmN44CB5b6M5Y2K77yd5Lul6ZmN77yP5ZCEMTAw5YaGPC9kaXY+PGJyPmArdGJsKG91dCwi4pGgIOOCquODg+OCuuWFpeWKm+aZgu+8iOWun+mam+OBruS6uuawl+OBp+eptOOCvuODvOODs+OCkuWIpOWumu+8iSIpKyI8YnI+Iit0Ymwob3V0UCwi4pGhIOOCquODg+OCuuacquWFpeWKm+aZgu+8iOODhOODvOODq+aOqOWumuOBruS6uuawl+OBp+WIpOWumu+8iSIpOwogIC8vIOadoeS7tuWIpe+8iOODhOODvOODqzHkvY3jga7lm57lj47njofvvIkKICBjb25zdCBzZWdSb3dzPU9iamVjdC5lbnRyaWVzKG91dC5zZWdzKS5maWx0ZXIoKFssdl0pPT52LmFsbC5iZXRzPj0zMDApLnNvcnQoKGEsYik9PmFbMF08YlswXT8tMToxKTsKICBpZihzZWdSb3dzLmxlbmd0aCl7aCs9YDxicj48Yj7ikaIg44OE44O844OrMeS9jeOBruadoeS7tuWIpe+8iOKRoOOBruWgtOWQiO+8iTwvYj48ZGl2IGNsYXNzPSJzbWFsbCI+6LO85YWlMzAw5Zue5Lul5LiK44Gu5p2h5Lu244Gu44G/44CC5YmN5Y2K44O75b6M5Y2K44Gu5Lih5pa544Gn5ZCM44GY5ZCR44GN44GL44KS6KaL44Gm44GP44Gg44GV44GE44CCPC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuadoeS7tjwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBbayx2XSBvZiBzZWdSb3dzKWgrPWA8dHI+PHRkPiR7ZXNjKGspfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7di5hbGwuYmV0cy50b0xvY2FsZVN0cmluZygpfTwvdGQ+PHRkPiR7KHYuYWxsLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD48Yj4ke2Modi5hbGwpfTwvYj48L3RkPjx0ZD4ke3YuQS5iZXRzP3BjdCh2LkEucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkIuYmV0cz9wY3Qodi5CLnJvaSk6Ii0ifTwvdGQ+PC90cj5gOwogICBoKz0iPC90Ym9keT48L3RhYmxlPiJ9CiAgaCs9YDxkaXYgY2xhc3M9InNtYWxsIj48YnI+6KaL5pa577ya44CM5a2m57+S5b6M44CN44Gv44CB44Oi44OH44Or44Gu5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yIJHtNT0RFTF9UUkFJTl9FTkR95Lul6ZmN77yJ44Gn44CB5pyA44KC5L+h6aC844Gn44GN44KL5YiX44Gn44GZ44CC44Gd44KM5Lul5YmN44Gu5pyf6ZaT44Gv44CB44Oi44OH44Or44GM562U44GI44KS6KaL44Gm44GE44KL44Gf44KB44CB44KE44KE6Imv44GP5Ye644G+44GZ44CC5Zue5Y+O546H44Gu44CMwrHjgI3jga85NSXjga7oqqTlt67jga7luYXjgafjgIExMDAl44KS5LiL5Zue44KL5LiL6ZmQ44Gq44KJ5Yip55uK44Go44Gv6KiA44GI44G+44Gb44KT44CC5p2h5Lu25Yil44Gv44CB5o6i44GZ44G744Gp5YG254S244Gu6auY44GE5p2h5Lu244KS5ou+44GE44KE44GZ44GE44Gu44Gn44CB5YmN5Y2K44O75b6M5Y2K44Gu5Lih5pa544Gn5ZCM44GY5ZCR44GN44Gu44KC44Gu44Gg44GR44KS5Y+C6ICD44Gr44GX44Gm44GP44Gg44GV44GE44CC5aaZ5ZGz77yI5biC5aC044Go44Gu5beu77yJ44Gv44CB5qSc6Ki844Gn5Z+65rqW44KI44KK5oKq44GL44Gj44Gf44Gf44KB44CB5Yik5pat44Gr44Gv5L2/44KP44Gq44GE44Gn44GP44Gg44GV44GE44CCPC9kaXY+YDsKICAkKCJidE91dCIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfTsKCi8qIC0tLSDikaAtMyDjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzmr5TovIPvvIjph43os57jga7jgb/jg7vlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafoo5zmraPjgYLjgoov44Gq44GX77yJIC0tLSAqLwokKCJidEdyYWRlIikub25jbGljaz1hc3luYygpPT57CiB0cnl7CiAgY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavikaDjgaflj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgcGF5QnlJZD17fTtwcy5mb3JFYWNoKHA9PihwLnJhY2VzfHxbXSkuZm9yRWFjaCh4PT57cGF5QnlJZFt4LnJhY2VJZF09eH0pKTsKICBjb25zdCBzdGFydD0kKCJidFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIixwZGF0ZXM9cHMubWFwKHA9PnAuZGF0ZSkuZmlsdGVyKGQ9PmQ+PXN0YXJ0KS5zb3J0KCk7CiAgaWYoIXBkYXRlcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6ZaL5aeL5pel5Lul6ZmN44Gu5omV5oi744GM44GC44KK44G+44Gb44KT44CCPC9zcGFuPic7cmV0dXJufQogIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG1hcD1uZXcgTWFwKCk7bGV0IGdyYWRlZD0wOwogIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKICByYWNlcy5mb3JFYWNoKHg9PntpZigoeC5yb3dzWzBdLmdyZHx8MCk+PTIpZ3JhZGVkKyt9KTsKICBpZighZ3JhZGVkKXtidXN5KGZhbHNlKTskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumBjuWOu+ODh+ODvOOCv+OBruS4reOBq+OAgUcx44CcRzPjgajliKTliKXjgafjgY3jgovjg6zjg7zjgrnjgYzjgYLjgorjgb7jgZvjgpPvvIjjgq/jg6njgrnooajoqJjjg7sx552A6LOe6YeR44GM54Sh44GE77yJ44CC44Kw44Os44O844OJ6KOc5q2j44Gu5Yq55p6c44Gv5qSc6Ki844Gn44GN44G+44Gb44KT44CC4pGk44Gu5a6f6KGM5pmC44Gv44Os44O844K55ZCN44O75Ye66aas6KGo44Gu44Kw44Os44O844OJ6KGo6KiY44Gn6KOc5q2j44GV44KM44G+44GZ44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IGJhc2U9e3N0YXJ0LHNwbGl0OiIiLG9vczpNT0RFTF9UUkFJTl9FTkQsbWluR3JkOjJ9OwogIGJ1c3kodHJ1ZSwi6KOc5q2j44GC44KKL+OBquOBl+OCkuaknOiovOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvbj1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLGJhc2UpLG9mZj1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHsuLi5iYXNlLGdyYWRlT2ZmOnRydWV9KTtidXN5KGZhbHNlKTsKICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK0iLGZvY3VzOiLil47nmoTkuK3njofph43oppbjga4x5L2NIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt4LmJldHN977yJPC9zcGFuPmA6Ii0iOwogIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a++6LGh77ya6YeN6LOe77yIRzHjgJxHM++8iSR7b24ucmFjZXN944Os44O844K544CC5ZCM44GY6YGO5Y6744OH44O844K/44Gn44CB6KOc5q2j44GC44KKL+OBquOBl+OBrueahOS4reeOh+ODu+WbnuWPjueOhyg5NSXluYUp44KS5q+U6LyD44GX44Gm44GE44G+44GZ44CC5Lu25pWw44GM5bCR44Gq44GE44Go5beu44Gv5YG254S244Gu56+E5Zuy44Gn44GZ77yI5Zue5Y+O546H44GuwrHluYXjgYzph43jgarjgovjgarjgonlt67jga/liKTmlq3jgafjgY3jgb7jgZvjgpPvvInjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+6LK344GE5pa5PC90aD48dGg+PC90aD48dGg+55qE5Lit546HIOOBguOCijwvdGg+PHRoPueahOS4reeOhyDjgarjgZc8L3RoPjx0aD7lm57lj47njocg44GC44KKPC90aD48dGg+5Zue5Y+O546HIOOBquOBlzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCBhPW9uLnN0YXRzW2tdLmFsbCxiPW9mZi5zdGF0c1trXS5hbGw7aWYoIWF8fCFhLmJldHMpY29udGludWU7CiAgIGgrPWA8dHI+PHRkPiR7TFtrXX08L3RkPjx0ZD48L3RkPjx0ZD4keyhhLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD4ke2ImJmIuYmV0cz8oYi5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKSsiJSI6Ii0ifTwvdGQ+PHRkPjxiPiR7YyhhKX08L2I+PC90ZD48dGQ+JHtjKGIpfTwvdGQ+PC90cj5gfQogICQoImJ0T3V0IikuaW5uZXJIVE1MPWgrIjwvdGJvZHk+PC90YWJsZT4iOwogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfTsKCgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX77yIQ2xvdWRmbGFyZSBLVu+8iQogKiDjg7vjg4fjg7zjgr/jgYzlpInjgo/jgaPjgZ/jgrDjg6vjg7zjg5fvvIhjc3Yt5bm077yPbGl2ZS3lubTmnIjvvI9wYXkt5bm05pyI77yPbWV0Ye+8ieOBoOOBkeOCkuOAgWd6aXDjgZfjgabpgIHjgosKICog44O75L+d5a2Y5YWI44Gu6K2Y5Yil44Gv44CB44OR44K544OV44Os44O844K644GuU0hBLTI1Nu+8iOODkeOCueODleODrOODvOOCuuOBneOBruOCguOBruOBr+mAgeOCieOBquOBhO+8iQogKiDjg7vlvqnlhYPjga/jgIHlkIzjgZjjg5Hjgrnjg5Xjg6zjg7zjgrrjgafjgILlkIzjgZjjgq3jg7zjga7jg4fjg7zjgr/jga/kuIrmm7jjgY3jgZXjgozjgosKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBCSz17cGFzczoiIixhdXRvOnRydWUsZGlydHk6bmV3IFNldCgpLGJ1c3k6ZmFsc2UsaWQ6IiIsc2F2ZVQ6bnVsbCxydW5UOm51bGwsaW5mbzpudWxsLG1zZzoiIixlcnI6ZmFsc2V9Owpjb25zdCByYXdNZXRhUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigibWV0YSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoIm1ldGEiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCByYXdQdXRNYW55PXJlY3M9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBzdD1bLi4ubmV3IFNldChyZWNzLm1hcChyPT5yLnMpKV07aWYoIXN0Lmxlbmd0aClyZXR1cm4gb2soKTtjb25zdCB0PURCLnRyYW5zYWN0aW9uKHN0LCJyZWFkd3JpdGUiKTtmb3IoY29uc3QgciBvZiByZWNzKXQub2JqZWN0U3RvcmUoci5zKS5wdXQoci52LHIuayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgaWRiUmFuZ2U9KHN0b3JlLHJhbmdlKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IG91dD1bXTtjb25zdCBxPURCLnRyYW5zYWN0aW9uKHN0b3JlKS5vYmplY3RTdG9yZShzdG9yZSkub3BlbkN1cnNvcihyYW5nZSk7cS5vbnN1Y2Nlc3M9ZT0+e2NvbnN0IGM9ZS50YXJnZXQucmVzdWx0O2lmKGMpe291dC5wdXNoKHtzOnN0b3JlLGs6Yy5rZXksdjpjLnZhbHVlfSk7Yy5jb250aW51ZSgpfWVsc2Ugb2sob3V0KX07cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJLZXlzPXN0b3JlPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbihzdG9yZSkub2JqZWN0U3RvcmUoc3RvcmUpLmdldEFsbEtleXMoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmZ1bmN0aW9uIGdyb3VwT2Yoc3RvcmUsa2V5KXsKIGtleT1TdHJpbmcoa2V5KTsKIGlmKHN0b3JlPT09ImZpbGVzIil7aWYoa2V5LnN0YXJ0c1dpdGgoImxpdmU6IikpcmV0dXJuICJsaXZlLSIra2V5LnNsaWNlKDUsMTIpO2NvbnN0IHk9a2V5LnNwbGl0KCI6IilbMF07cmV0dXJuIC9eKDB8MjBcZFxkKSQvLnRlc3QoeSk/ImNzdi0iK3k6ImNzdi0wIn0KIGlmKHN0b3JlPT09InBheSIpcmV0dXJuICJwYXktIitrZXkuc2xpY2UoMCw3KTsKIHJldHVybiAibWV0YSI7Cn0KZnVuY3Rpb24gbWFya0RpcnR5KHN0b3JlLGtleSl7CiBpZihzdG9yZT09PSJtZXRhIiYmKGtleT09PSJkaXJ0eSJ8fGtleT09PSJiYWNrdXAiKSlyZXR1cm47CiBCSy5kaXJ0eS5hZGQoZ3JvdXBPZihzdG9yZSxrZXkpKTsKIGNsZWFyVGltZW91dChCSy5zYXZlVCk7Qksuc2F2ZVQ9c2V0VGltZW91dCgoKT0+e3Jhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKS5jYXRjaCgoKT0+e30pO2JrUmVuZGVyKCl9LDgwMCk7Cn0KYXN5bmMgZnVuY3Rpb24gcmVhZEdyb3VwKG5hbWUpewogbGV0IG07CiBpZihuYW1lPT09Im1ldGEiKXJldHVybihhd2FpdCBpZGJSYW5nZSgibWV0YSIpKS5maWx0ZXIocj0+ci5rIT09ImRpcnR5IiYmci5rIT09ImJhY2t1cCIpOwogaWYobT1uYW1lLm1hdGNoKC9eY3N2LShcZCspJC8pKXJldHVybiBpZGJSYW5nZSgiZmlsZXMiLElEQktleVJhbmdlLmJvdW5kKGAke21bMV19OmAsYCR7bVsxXX07YCkpOwogaWYobT1uYW1lLm1hdGNoKC9ebGl2ZS0oXGR7NH0tXGR7Mn0pJC8pKXJldHVybiBpZGJSYW5nZSgiZmlsZXMiLElEQktleVJhbmdlLmJvdW5kKGBsaXZlOiR7bVsxXX0tMDBgLGBsaXZlOiR7bVsxXX0tOTlgKSk7CiBpZihtPW5hbWUubWF0Y2goL15wYXktKFxkezR9LVxkezJ9KSQvKSlyZXR1cm4gaWRiUmFuZ2UoInBheSIsSURCS2V5UmFuZ2UuYm91bmQoYCR7bVsxXX0tMDBgLGAke21bMV19LTk5YCkpOwogcmV0dXJuW107Cn0KYXN5bmMgZnVuY3Rpb24gYWxsR3JvdXBzKCl7CiBjb25zdCBnPW5ldyBTZXQoKTsKIGZvcihjb25zdCBrIG9mIGF3YWl0IGlkYktleXMoImZpbGVzIikpZy5hZGQoZ3JvdXBPZigiZmlsZXMiLGspKTsKIGZvcihjb25zdCBrIG9mIGF3YWl0IGlkYktleXMoInBheSIpKWcuYWRkKGdyb3VwT2YoInBheSIsaykpOwogaWYoKGF3YWl0IGlkYktleXMoIm1ldGEiKSkuc29tZShrPT5rIT09ImRpcnR5IiYmayE9PSJiYWNrdXAiKSlnLmFkZCgibWV0YSIpOwogcmV0dXJuWy4uLmddOwp9CmFzeW5jIGZ1bmN0aW9uIGd6KHN0cil7CiBjb25zdCByYXc9bmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHN0cik7CiBpZih0eXBlb2YgQ29tcHJlc3Npb25TdHJlYW09PT0idW5kZWZpbmVkIilyZXR1cm57YnVmOnJhdyxlbmM6InJhdyJ9OwogY29uc3QgY3M9bmV3IENvbXByZXNzaW9uU3RyZWFtKCJnemlwIiksdz1jcy53cml0YWJsZS5nZXRXcml0ZXIoKTt3LndyaXRlKHJhdyk7dy5jbG9zZSgpOwogcmV0dXJue2J1ZjpuZXcgVWludDhBcnJheShhd2FpdCBuZXcgUmVzcG9uc2UoY3MucmVhZGFibGUpLmFycmF5QnVmZmVyKCkpLGVuYzoiZ3ppcCJ9Owp9CmFzeW5jIGZ1bmN0aW9uIGd1bnppcChidWYsZW5jKXsKIGlmKGVuYz09PSJyYXciKXJldHVybiBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYnVmKTsKIGNvbnN0IGRzPW5ldyBEZWNvbXByZXNzaW9uU3RyZWFtKCJnemlwIiksdz1kcy53cml0YWJsZS5nZXRXcml0ZXIoKTt3LndyaXRlKGJ1Zik7dy5jbG9zZSgpOwogcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShhd2FpdCBuZXcgUmVzcG9uc2UoZHMucmVhZGFibGUpLmFycmF5QnVmZmVyKCkpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrTWFrZUlkKCl7CiBpZighKHdpbmRvdy5jcnlwdG8mJmNyeXB0by5zdWJ0bGUpKXRocm93IG5ldyBFcnJvcigi44GT44Gu55Kw5aKD44Gn44Gv5L2/44GI44G+44Gb44KT77yIaHR0cHMg44Gn6ZaL44GP5b+F6KaB44GM44GC44KK44G+44GZ77yJIik7CiBjb25zdCBkPWF3YWl0IGNyeXB0by5zdWJ0bGUuZGlnZXN0KCJTSEEtMjU2IixuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoImtlaWJhLXVwc2V0LWJhY2t1cDp2MToiK0JLLnBhc3MpKTsKIHJldHVyblsuLi5uZXcgVWludDhBcnJheShkKV0ubWFwKGI9PmIudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIjAiKSkuam9pbigiIik7Cn0KYXN5bmMgZnVuY3Rpb24gYmtGZXRjaChwYXRoLG9wdCl7CiBpZighQksuaWQpQksuaWQ9YXdhaXQgYmtNYWtlSWQoKTsKIHJldHVybiBmZXRjaCgkKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIikrcGF0aCxPYmplY3QuYXNzaWduKHt9LG9wdCx7aGVhZGVyczpPYmplY3QuYXNzaWduKHsieC1iYWNrdXAtaWQiOkJLLmlkfSwob3B0JiZvcHQuaGVhZGVycyl8fHt9KX0pKTsKfQphc3luYyBmdW5jdGlvbiBia0pTT04ocGF0aCxvcHQpewogY29uc3Qgcj1hd2FpdCBia0ZldGNoKHBhdGgsb3B0KSx0PWF3YWl0IHIudGV4dCgpO2xldCBqPXt9O3RyeXtqPUpTT04ucGFyc2UodCl9Y2F0Y2goZSl7fQogaWYoIXIub2t8fGoub2s9PT1mYWxzZSl0aHJvdyBuZXcgRXJyb3Ioai5lcnJvcnx8KCJIVFRQICIrci5zdGF0dXMpKTtyZXR1cm4gajsKfQpmdW5jdGlvbiBia01zZyh0LGlzRXJyKXtCSy5tc2c9dHx8IiI7QksuZXJyPSEhaXNFcnI7YmtSZW5kZXIoKX0KZnVuY3Rpb24gYmtSZW5kZXIoKXsKIGNvbnN0IGVsPSQoImJrU3RhdHVzIik7aWYoIWVsKXJldHVybjsKIGNvbnN0IG09QksuaW5mbyxqc3Q9bXM9Pm5ldyBEYXRlKG1zKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnJlcGxhY2UoIlQiLCIgIikuc2xpY2UoMCwxNik7CiBsZXQgc3VtPSIiOwogaWYoIUJLLnBhc3Mpc3VtPSLjg5Hjgrnjg5Xjg6zjg7zjgrrjgpLoqK3lrprjgZnjgovjgajjgIHoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fjgYzmnInlirnjgavjgarjgorjgb7jgZnjgIIiOwogZWxzZSBpZihtJiZtLmV4aXN0cyl7Y29uc3QgY3M9T2JqZWN0LnZhbHVlcyhtLmNodW5rc3x8e30pO3N1bT1g5pyA57WC44OQ44OD44Kv44Ki44OD44OX77yaJHtqc3QobS51cGRhdGVkQXQpfe+8iCR7Y3MubGVuZ3RofeOCsOODq+ODvOODl++8jyR7KGNzLnJlZHVjZSgocyxjKT0+cytjLnNpemUsMCkvMTA0ODU3NikudG9GaXhlZCgxKX1NQu+8iWB9CiBlbHNlIHN1bT0i44OQ44OD44Kv44Ki44OD44OX44Gv44G+44Gg44GC44KK44G+44Gb44KT44CCIjsKIGlmKEJLLnBhc3Mpc3VtKz1g77yP5pyq6YCB5L+h44Gu5aSJ5pu077yaJHtCSy5kaXJ0eS5zaXplfeOCsOODq+ODvOODlyR7QksuYXV0bz8i77yI6Ieq5YuV44Gn6YCB44KK44G+44GZ77yJIjoi77yI6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX44Gv44Kq44OV77yJIn1gOwogZWwuaW5uZXJIVE1MPShCSy5tc2c/YDxzcGFuIGNsYXNzPSIke0JLLmVycj8id2FybiI6Imdvb2QifSI+JHtlc2MoQksubXNnKX08L3NwYW4+XG5gOiIiKStlc2Moc3VtKTsKfQpmdW5jdGlvbiBia05lZWRQYXNzKCl7aWYoIUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpe2JrTXNnKCLjg5Hjgrnjg5Xjg6zjg7zjgrrjgpI45paH5a2X5Lul5LiK44Gn5YWl5Yqb44GX44Gm44GP44Gg44GV44GE44CCIix0cnVlKTtyZXR1cm4gdHJ1ZX1yZXR1cm4gZmFsc2V9CmFzeW5jIGZ1bmN0aW9uIGJrUmVmcmVzaChtYW4pewogdHJ5e0JLLmluZm89bWFufHxhd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiKX1jYXRjaChlKXtCSy5pbmZvPW51bGw7aWYoIUJLLm1zZylia01zZygi44OQ44OD44Kv44Ki44OD44OX5YWI44KS56K66KqN44Gn44GN44G+44Gb44KT77yaIitlLm1lc3NhZ2UsdHJ1ZSl9CiBia1JlbmRlcigpOwp9CmFzeW5jIGZ1bmN0aW9uIHJ1bkJhY2t1cChmdWxsKXsKIGlmKEJLLmJ1c3l8fGJrTmVlZFBhc3MoKSlyZXR1cm47CiBCSy5idXN5PXRydWU7Y29uc3QgaW5mbGlnaHQ9bmV3IFNldChCSy5kaXJ0eSk7QksuZGlydHkuY2xlYXIoKTsKIHRyeXsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX5YWI44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgbWFuPWF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpLGhhdmU9bWFuLmV4aXN0cz8obWFuLmNodW5rc3x8e30pOnt9OwogIGNvbnN0IG5hbWVzPShmdWxsfHwhbWFuLmV4aXN0cyk/YXdhaXQgYWxsR3JvdXBzKCk6Wy4uLmluZmxpZ2h0XTsKICBpZighbmFtZXMubGVuZ3RoKXtia01zZygi5aSJ5pu044Gv44GC44KK44G+44Gb44KT44CCIik7YXdhaXQgYmtSZWZyZXNoKG1hbik7cmV0dXJufQogIGNvbnN0IGNodW5rcz1PYmplY3QuYXNzaWduKHt9LGhhdmUpO2xldCBzZW50PTAsYnl0ZXM9MDsKICBmb3IobGV0IGk9MDtpPG5hbWVzLmxlbmd0aDtpKyspewogICBjb25zdCBuYW1lPW5hbWVzW2ldO2JrTXNnKGDjg5Djg4Pjgq/jgqLjg4Pjg5fkuK3igKYgJHtpKzF9LyR7bmFtZXMubGVuZ3Rofe+8iCR7bmFtZX3vvIlgKTsKICAgY29uc3QgcmVjcz1hd2FpdCByZWFkR3JvdXAobmFtZSk7CiAgIGlmKCFyZWNzLmxlbmd0aCl7aWYoY2h1bmtzW25hbWVdKXthd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCx7bWV0aG9kOiJERUxFVEUifSk7ZGVsZXRlIGNodW5rc1tuYW1lXX1jb250aW51ZX0KICAgY29uc3QgcmF3PUpTT04uc3RyaW5naWZ5KHtnOm5hbWUscmVjc30pLHtidWYsZW5jfT1hd2FpdCBneihyYXcpOwogICBjb25zdCByPWF3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gLHttZXRob2Q6IlBVVCIsYm9keTpidWZ9KTsKICAgaWYoIXIub2spe2xldCBlPSIiO3RyeXtlPShhd2FpdCByLmpzb24oKSkuZXJyb3J9Y2F0Y2goXyl7fXRocm93IG5ldyBFcnJvcihlfHwoIkhUVFAgIityLnN0YXR1cykpfQogICBjaHVua3NbbmFtZV09e3NpemU6YnVmLmJ5dGVMZW5ndGgscmF3U2l6ZTpyYXcubGVuZ3RoLG46cmVjcy5sZW5ndGgsZW5jLGF0OkRhdGUubm93KCl9O3NlbnQrKztieXRlcys9YnVmLmJ5dGVMZW5ndGg7CiAgfQogIGlmKGZ1bGx8fCFtYW4uZXhpc3RzKXtmb3IoY29uc3QgbiBvZiBPYmplY3Qua2V5cyhoYXZlKSlpZighbmFtZXMuaW5jbHVkZXMobikpe2F3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuKX1gLHttZXRob2Q6IkRFTEVURSJ9KTtkZWxldGUgY2h1bmtzW25dfX0KICBjb25zdCBtYW5pZmVzdD17djoxLHVwZGF0ZWRBdDpEYXRlLm5vdygpLGNodW5rc307CiAgYXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iix7bWV0aG9kOiJQVVQiLGJvZHk6SlNPTi5zdHJpbmdpZnkobWFuaWZlc3QpLGhlYWRlcnM6eyJjb250ZW50LXR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIn19KTsKICBtYW5pZmVzdC5leGlzdHM9dHJ1ZTthd2FpdCByYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSk7YXdhaXQgcmF3TWV0YVB1dCgiYmFja3VwIix7YXQ6bWFuaWZlc3QudXBkYXRlZEF0fSk7CiAgQksuaW5mbz1tYW5pZmVzdDtia01zZyhg44OQ44OD44Kv44Ki44OD44OX5a6M5LqG77yaJHtzZW50feOCsOODq+ODvOODl+OCkumAgeS/oe+8iCR7KGJ5dGVzLzEwNDg1NzYpLnRvRml4ZWQoMSl9TULvvIlgKTsKIH1jYXRjaChlKXsKICBmb3IoY29uc3QgbiBvZiBpbmZsaWdodClCSy5kaXJ0eS5hZGQobik7cmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pLmNhdGNoKCgpPT57fSk7CiAgYmtNc2coIuODkOODg+OCr+OCouODg+ODl+OBq+WkseaVl+OBl+OBvuOBl+OBn++8miIrZS5tZXNzYWdlLHRydWUpOwogfWZpbmFsbHl7QksuYnVzeT1mYWxzZTtia1JlbmRlcigpfQp9CmFzeW5jIGZ1bmN0aW9uIHJ1blJlc3RvcmUoKXsKIGlmKEJLLmJ1c3l8fGJrTmVlZFBhc3MoKSlyZXR1cm47CiBCSy5idXN5PXRydWU7CiB0cnl7CiAgYmtNc2coIuODkOODg+OCr+OCouODg+ODl+OCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IG1hbj1hd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiKTsKICBpZighbWFuLmV4aXN0cyl7YmtNc2coIuOBk+OBruODkeOCueODleODrOODvOOCuuOBruODkOODg+OCr+OCouODg+ODl+OBr+imi+OBpOOBi+OCiuOBvuOBm+OCk++8iOODkeOCueODleODrOODvOOCuuOCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhO+8ieOAgiIsdHJ1ZSk7cmV0dXJufQogIGNvbnN0IG5hbWVzPU9iamVjdC5rZXlzKG1hbi5jaHVua3N8fHt9KTtsZXQgbj0wLGNudD0wOwogIGZvcihjb25zdCBuYW1lIG9mIG5hbWVzKXsKICAgYmtNc2coYOW+qeWFg+S4reKApiAkeysrbn0vJHtuYW1lcy5sZW5ndGh977yIJHtuYW1lfe+8iWApOwogICBjb25zdCByPWF3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gKTsKICAgaWYoIXIub2spdGhyb3cgbmV3IEVycm9yKGAke25hbWV9IOOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk++8iEhUVFAgJHtyLnN0YXR1c33vvIlgKTsKICAgY29uc3Qgbz1KU09OLnBhcnNlKGF3YWl0IGd1bnppcChuZXcgVWludDhBcnJheShhd2FpdCByLmFycmF5QnVmZmVyKCkpLG1hbi5jaHVua3NbbmFtZV0uZW5jfHwiZ3ppcCIpKTsKICAgYXdhaXQgcmF3UHV0TWFueShvLnJlY3MpO2NudCs9by5yZWNzLmxlbmd0aDsKICB9CiAgU1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7QkFDS1VQX0RBVEVTPW51bGw7QksuZGlydHkuY2xlYXIoKTsKICBhd2FpdCByYXdNZXRhUHV0KCJkaXJ0eSIsW10pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbi51cGRhdGVkQXR9KTsKICBhd2FpdCBzaG93U3RhdGUoKTtCSy5pbmZvPW1hbjtia01zZyhg5b6p5YWD5a6M5LqG77yaJHtuYW1lcy5sZW5ndGh944Kw44Or44O844OX77yPJHtjbnQudG9Mb2NhbGVTdHJpbmcoKX3ku7ZgKTsKIH1jYXRjaChlKXtia01zZygi5b6p5YWD44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSl9CiBmaW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQpmdW5jdGlvbiBia1NjaGVkdWxlKG1zKXsKIGlmKCFCSy5hdXRvfHwhQksucGFzc3x8QksucGFzcy5sZW5ndGg8OClyZXR1cm47CiBjbGVhclRpbWVvdXQoQksucnVuVCk7QksucnVuVD1zZXRUaW1lb3V0KCgpPT57aWYoIVNZTkNJTkcpcnVuQmFja3VwKGZhbHNlKTtlbHNlIGJrU2NoZWR1bGUoMzAwMDApfSxtc3x8MzAwMCk7Cn0KZnVuY3Rpb24gYmtTYXZlU2V0dGluZ3MoKXt0cnl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oInVwc2V0X2JrIixKU09OLnN0cmluZ2lmeSh7cGFzczpCSy5wYXNzLGF1dG86QksuYXV0b30pKX1jYXRjaChlKXt9fQphc3luYyBmdW5jdGlvbiBia0luaXQoKXsKIHRyeXtjb25zdCBvPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oInVwc2V0X2JrIil8fCJ7fSIpO0JLLnBhc3M9by5wYXNzfHwiIjtCSy5hdXRvPW8uYXV0byE9PWZhbHNlfWNhdGNoKGUpe30KICQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7JCgiYmtBdXRvIikuY2hlY2tlZD1CSy5hdXRvOwogJCgiYmtQYXNzIikub25jaGFuZ2U9KCk9PntCSy5wYXNzPSQoImJrUGFzcyIpLnZhbHVlLnRyaW0oKTtCSy5pZD0iIjtCSy5pbmZvPW51bGw7QksubXNnPSIiO2JrU2F2ZVNldHRpbmdzKCk7aWYoQksucGFzcy5sZW5ndGg+PTgpYmtSZWZyZXNoKCk7ZWxzZSBia1JlbmRlcigpfTsKICQoImJrU2hvdyIpLm9uY2xpY2s9KCk9Pntjb25zdCBwPSQoImJrUGFzcyIpO3AudHlwZT1wLnR5cGU9PT0icGFzc3dvcmQiPyJ0ZXh0IjoicGFzc3dvcmQiOyQoImJrU2hvdyIpLnRleHRDb250ZW50PXAudHlwZT09PSJwYXNzd29yZCI/IuihqOekuiI6IumaoOOBmSJ9OwogJCgiYmtBdXRvIikub25jaGFuZ2U9KCk9PntCSy5hdXRvPSQoImJrQXV0byIpLmNoZWNrZWQ7YmtTYXZlU2V0dGluZ3MoKTtia1JlbmRlcigpO2lmKEJLLmF1dG8pYmtTY2hlZHVsZSgyMDAwKX07CiAkKCJia05vdyIpLm9uY2xpY2s9KCk9PnJ1bkJhY2t1cChmYWxzZSk7CiAkKCJia0Z1bGwiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GZ44G544Gm44Gu44OH44O844K/44KS44CB44GC44KJ44Gf44KB44Gm5L+d5a2Y44GX55u044GX44G+44GZ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuQmFja3VwKHRydWUpfTsKICQoImJrUmVzdG9yZSIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZPjga7nq6/mnKvjga7jg4fjg7zjgr/jgpLjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjga7lhoXlrrnjgafkuIrmm7jjgY3jgZfjgb7jgZnvvIjjg5Djg4Pjgq/jgqLjg4Pjg5fjgavjgYLjgovjg4fjg7zjgr/jgaDjgZHjgYzlr77osaHjgafjgZnvvInjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5SZXN0b3JlKCl9OwogdHJ5e2NvbnN0IGQ9YXdhaXQgbWV0YUdldCgiZGlydHkiKTtpZihBcnJheS5pc0FycmF5KGQpKWQuZm9yRWFjaCh4PT5CSy5kaXJ0eS5hZGQoeCkpfWNhdGNoKGUpe30KIHRyeXtpZihuYXZpZ2F0b3Iuc3RvcmFnZSYmbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCluYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KCkuY2F0Y2goKCk9Pnt9KX1jYXRjaChlKXt9CiBia1JlbmRlcigpOwogaWYoQksucGFzcy5sZW5ndGg+PTgpe2F3YWl0IGJrUmVmcmVzaCgpO2lmKEJLLmRpcnR5LnNpemUpYmtTY2hlZHVsZSg1MDAwKX0KIHNldEludGVydmFsKCgpPT57aWYoQksuYXV0byYmQksucGFzcy5sZW5ndGg+PTgmJkJLLmRpcnR5LnNpemUmJiFCSy5idXN5JiYhU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpfSx3aW5kb3cuX19CS19USUNLfHw5MDAwMDApOwp9CgoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDms6LkubHluqbjga7lho3moKHmraMKICogIOebrueahO+8muazouS5seW6puOBruOAjOW9k+OBn+OCiuaWueOAjeOCkuOAgeiHquWIhuOBrumBjuWOu+ODh+ODvOOCv+OBp+eiuuOBi+OCgeOAgeS/oemgvOOBp+OBjeOCi+aVsOWtl+OBoOOBkeOCkuWHuuOBmeOAggogKiAg44KE44KL44GT44Go77yaCiAqICAgMSkg6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44GrMeOBpOOBmuOBpOWGjeePvuOBl+OAgeODrOODvOOCueWJjeOBq+WIhuOBi+OCi+aDheWgseOBoOOBkeOBp+azouS5seW6puOCkuioiOeulwogKiAgIDIpIOePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iE1PREVMX1RSQUlOX0VOROS7pemZje+8ieOBp+OAgeWun+mam+OBruazouS5seeOh+OBqOeqgeOBjeWQiOOCj+OBm+OCiwogKiAgIDMpIOOCs+ODvOOCueWIpeOBrumBjuWOu+azouS5seeOh++8iOmWi+WCrOWgtMOX6Iqd44OAw5fot53pm6LDl+OCr+ODqeOCue+8ieOBquOBqeOCkui2s+OBl+OBn+aWsOODouODh+ODq+OCkuS9nOOCiuOAgeWQjOOBmOacn+mWk+OBp+avlOi8gwogKiAgIDQpIOWvvuaVsOaQjeWkseOBjOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeaOoeeUqOOAguOBneOBhuOBp+OBquOBkeOCjOOBsOePvuihjOOBruOBvuOBvuOBq+OBl+OBpuOAgeWun+e4vueOh+OBoOOBkeaknOiovOWApOOBq+W3ruOBl+abv+OBiOOCiwogKiAg5rOi5Lmx77ydM+edgOS7peWGheOBrummrOOBruS6uuawl+OBruWQiOioiOOBjOmWvuWApCjnj77ooYzjg6Ljg4fjg6vjgajlkIzjgZgxNSnku6XkuIoKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBVUEtFWT0ia2VpYmFfdXBzZXRfdjEiOwpjb25zdCBzaWdtPXo9PjEvKDErTWF0aC5leHAoLXopKSxsZ3Q9cD0+e3A9TWF0aC5taW4oLjk5OSxNYXRoLm1heCguMDAxLHApKTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwpmdW5jdGlvbiB3aWxzb24oayxuKXtpZighbilyZXR1cm5bMCwxXTtjb25zdCB6PTEuOTYscD1rL24sZD0xK3oqei9uLGM9cCt6KnovKDIqbiksYT16Kk1hdGguc3FydChwKigxLXApL24reip6Lyg0Km4qbikpO3JldHVyblsoYy1hKS9kLChjK2EpL2RdfQpjb25zdCBkaXN0Qj1kPT5NYXRoLm1heCgxMDAwLE1hdGgubWluKDMyMDAsTWF0aC5yb3VuZCgoZHx8MCkvMjAwKSoyMDApKTsKY29uc3QgbHZsRz0obCxnKT0+KGx8fDApKyhnPj0yPyJHIjoiIik7CgovKiDjg6zjg7zjgrnjga7pm4boqIjvvIjooYzjgpLlhajpg6jmjIHjgZ/jgZrjgavmuIjjgoDou73jgYTlvaLvvInihpIg44Os44O844K55oOF5aCxICovCmZ1bmN0aW9uIGFnZ0FkZChtYXAscil7CiBpZighci5yYWNlSWR8fCFyLmhvcnNlfHxyLmZpbmlzaD09bnVsbClyZXR1cm47CiBsZXQgYT1tYXAuZ2V0KHIucmFjZUlkKTsKIGlmKCFhKW1hcC5zZXQoci5yYWNlSWQsYT17aWQ6U3RyaW5nKHIucmFjZUlkKSxkYXRlOnIuZGF0ZSxzdXJmOnIuc3VyZixkaXN0OnIuZGlzdCxsdmw6ci5sdmx8fDAsZ3JkOnIuZ3JkfHwwLE46MCx0OltdfSk7CiBhLk4rKztpZihyLmZpbmlzaDw9MyYmci5wb3A+MClhLnQucHVzaChbci5maW5pc2gsci5wb3BdKTsKfQpmdW5jdGlvbiBhZ2dJbmZvKGEpewogaWYoIWF8fGEuTjw2KXJldHVybiBudWxsOwogY29uc3Qgdj0vXlxkezEyfSQvLnRlc3QoYS5pZCk/YS5pZC5zbGljZSg0LDYpOihTdHJpbmcoYS5pZCkuc3BsaXQoIi0iKVszXXx8IiIpOwogY29uc3QgdD1hLnQuc2xpY2UoKS5zb3J0KCh4LHkpPT54WzBdLXlbMF0pOwogY29uc3QgeT10Lmxlbmd0aD49Mz8odFswXVsxXSt0WzFdWzFdK3RbMl1bMV0+PVVFLkFYSVMudXBzZXQudGhyPzE6MCk6bnVsbDsKIHJldHVybntkYXRlOmEuZGF0ZSx2LHN1cmY6YS5zdXJmLGRpc3Q6YS5kaXN0LGx2bDphLmx2bCxncmQ6YS5ncmQsTjphLk4seX07Cn0KCi8qIOOCs+ODvOOCueWIpeOBrumBjuWOu+azouS5seeOh++8iOWwkeOBquOBhOODh+ODvOOCv+OBr+WFqOS9k+OBuOWvhOOBm+OCi++8iSAqLwpjbGFzcyBVcFByaXsKIGNvbnN0cnVjdG9yKCl7dGhpcy5iYXNlPXtuOjAsdTowfTt0aGlzLm09bmV3IE1hcCgpfQogX2soaSl7cmV0dXJuWyJWIitpLnYsIkMiK2kudisifCIraS5zdXJmKyJ8IitkaXN0QihpLmRpc3QpLCJMIitpLnN1cmYrInwiK2Rpc3RCKGkuZGlzdCkrInwiK2x2bEcoaS5sdmwsaS5ncmQpXX0KIGFkZChpKXtpZighaXx8aS55PT1udWxsKXJldHVybjt0aGlzLmJhc2UubisrO3RoaXMuYmFzZS51Kz1pLnk7Zm9yKGNvbnN0IGsgb2YgdGhpcy5fayhpKSl7bGV0IHg9dGhpcy5tLmdldChrKTtpZigheCl0aGlzLm0uc2V0KGsseD17bjowLHU6MH0pO3gubisrO3gudSs9aS55fX0KIGZlYXQoaSl7CiAgY29uc3QgYj10aGlzLmJhc2Uubj4yMDA/dGhpcy5iYXNlLnUvdGhpcy5iYXNlLm46LjI4NSxLPTQwOwogIGNvbnN0IHNoPShrLHBhcik9Pntjb25zdCB4PXRoaXMubS5nZXQoayl8fHtuOjAsdTowfTtyZXR1cm4oeC51K0sqcGFyKS8oeC5uK0spfTsKICBjb25zdCBba3Ysa2Msa2xdPXRoaXMuX2soaSkscHY9c2goa3YsYikscGM9c2goa2MscHYpLHBsPXNoKGtsLGIpLGxiPWxndChiKTsKICByZXR1cm5bbGd0KHB2KS1sYixsZ3QocGMpLWxiLGxndChwbCktbGJdOwogfQp9CgovKiDjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDvvIjjg4vjg6Xjg7zjg4jjg7Pms5Xjg7tMMuato+WJh+WMluODu+aomea6luWMlu+8iSAqLwpmdW5jdGlvbiBzb2x2ZUxpbihBLGIpewogY29uc3Qgbj1iLmxlbmd0aCxNPUEubWFwKChyLGkpPT5bLi4ucixiW2ldXSk7CiBmb3IobGV0IGM9MDtjPG47YysrKXsKICBsZXQgcD1jO2ZvcihsZXQgcj1jKzE7cjxuO3IrKylpZihNYXRoLmFicyhNW3JdW2NdKT5NYXRoLmFicyhNW3BdW2NdKSlwPXI7CiAgW01bY10sTVtwXV09W01bcF0sTVtjXV07Y29uc3QgZD1NW2NdW2NdfHwxZS05OwogIGZvcihsZXQgaz1jO2s8PW47aysrKU1bY11ba10vPWQ7CiAgZm9yKGxldCByPTA7cjxuO3IrKylpZihyIT09Yyl7Y29uc3QgZj1NW3JdW2NdO2lmKGYpZm9yKGxldCBrPWM7azw9bjtrKyspTVtyXVtrXS09ZipNW2NdW2tdfQogfQogcmV0dXJuIE0ubWFwKHI9PnJbbl0pOwp9CmZ1bmN0aW9uIGZpdExvZ2l0KFgseSxsMil7CiBjb25zdCBuPVgubGVuZ3RoLGQ9WFswXS5sZW5ndGgsbXU9QXJyYXkoZCkuZmlsbCgwKSxzZD1BcnJheShkKS5maWxsKDApOwogZm9yKGNvbnN0IHIgb2YgWClmb3IobGV0IGo9MDtqPGQ7aisrKW11W2pdKz1yW2pdL247CiBmb3IoY29uc3QgciBvZiBYKWZvcihsZXQgaj0wO2o8ZDtqKyspc2Rbal0rPShyW2pdLW11W2pdKSoqMi9uOwogZm9yKGxldCBqPTA7ajxkO2orKylzZFtqXT1NYXRoLnNxcnQoc2Rbal0pfHwxOwogY29uc3QgWj1YLm1hcChyPT5bMSwuLi5yLm1hcCgodixqKT0+KHYtbXVbal0pL3NkW2pdKV0pLEQ9ZCsxLHc9QXJyYXkoRCkuZmlsbCgwKTsKIGZvcihsZXQgaXQ9MDtpdDwzMDtpdCsrKXsKICBjb25zdCBnPUFycmF5KEQpLmZpbGwoMCksSD1BcnJheS5mcm9tKHtsZW5ndGg6RH0sKCk9PkFycmF5KEQpLmZpbGwoMCkpOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2NvbnN0IHo9WltpXTtsZXQgcz0wO2ZvcihsZXQgaj0wO2o8RDtqKyspcys9d1tqXSp6W2pdOwogICBjb25zdCBwPXNpZ20ocyksZT1wLXlbaV0scT1wKigxLXApOwogICBmb3IobGV0IGo9MDtqPEQ7aisrKXtnW2pdKz1lKnpbal07Zm9yKGxldCBrPWo7azxEO2srKylIW2pdW2tdKz1xKnpbal0qeltrXX19CiAgZm9yKGxldCBqPTE7ajxEO2orKyl7Z1tqXSs9bDIqd1tqXTtIW2pdW2pdKz1sMn0KICBmb3IobGV0IGo9MDtqPEQ7aisrKWZvcihsZXQgaz0wO2s8ajtrKyspSFtqXVtrXT1IW2tdW2pdOwogIEhbMF1bMF0rPTFlLTk7CiAgY29uc3QgZHc9c29sdmVMaW4oSCxnKTtsZXQgbXg9MDtmb3IobGV0IGo9MDtqPEQ7aisrKXt3W2pdLT1kd1tqXTtteD1NYXRoLm1heChteCxNYXRoLmFicyhkd1tqXSkpfQogIGlmKG14PDFlLTcpYnJlYWs7CiB9CiByZXR1cm57dyxtdSxzZH07Cn0KY29uc3QgcHJlZExvZ2l0PShtLHgpPT57bGV0IHM9bS53WzBdO2ZvcihsZXQgaj0wO2o8eC5sZW5ndGg7aisrKXMrPW0ud1tqKzFdKih4W2pdLW0ubXVbal0pL20uc2Rbal07cmV0dXJuIHN9OwoKLyog6KmV5L6h5oyH5qiZ77ya5a++5pWw5pCN5aSx44O744OW44Op44Kk44Ok44O844O7QVVD44O76LyD5q2j6Kqk5beuKEVDRSkgKi8KZnVuY3Rpb24gYXVjT2YocCx5KXsKIGNvbnN0IGlkeD1wLm1hcCgoXyxpKT0+aSkuc29ydCgoYSxiKT0+cFthXS1wW2JdKTtsZXQgcnM9MCxuMT0wOwogZm9yKGxldCByPTA7cjxpZHgubGVuZ3RoO3IrKyl7aWYoeVtpZHhbcl1dKXtycys9cisxO24xKyt9fQogY29uc3QgbjA9eS5sZW5ndGgtbjE7cmV0dXJuIG4xJiZuMD8ocnMtbjEqKG4xKzEpLzIpLyhuMSpuMCk6LjU7Cn0KZnVuY3Rpb24gbWV0cmljc09mKHAseSl7CiBjb25zdCBuPXkubGVuZ3RoO2xldCBsbD0wLGJyPTA7CiBmb3IobGV0IGk9MDtpPG47aSsrKXtjb25zdCBxPU1hdGgubWluKDEtMWUtOSxNYXRoLm1heCgxZS05LHBbaV0pKTtsbC09eVtpXT9NYXRoLmxvZyhxKTpNYXRoLmxvZygxLXEpO2JyKz0ocFtpXS15W2ldKSoqMn0KIGNvbnN0IGlkeD1wLm1hcCgoXyxpKT0+aSkuc29ydCgoYSxiKT0+cFthXS1wW2JdKSxCPTEwO2xldCBlY2U9MDsKIGZvcihsZXQgYj0wO2I8QjtiKyspe2NvbnN0IHM9aWR4LnNsaWNlKE1hdGguZmxvb3IoYipuL0IpLE1hdGguZmxvb3IoKGIrMSkqbi9CKSk7aWYoIXMubGVuZ3RoKWNvbnRpbnVlOwogIGNvbnN0IG1wPXMucmVkdWNlKChhLGkpPT5hK3BbaV0sMCkvcy5sZW5ndGgsbXk9cy5yZWR1Y2UoKGEsaSk9PmEreVtpXSwwKS9zLmxlbmd0aDtlY2UrPU1hdGguYWJzKG1wLW15KSpzLmxlbmd0aC9ufQogcmV0dXJue24sbGw6bGwvbixicmllcjpici9uLGF1YzphdWNPZihwLHkpLGVjZX07Cn0KCi8qIOetiee0mu+8muS6iOa4rOeiuueOh+OBrumrmOOBhOmghuOBq+S4iuS9jSAzJSAvIDclIC8gMTIlIC8gMjAlIC8gMjglIC8g5q6L44KK77yIU1NTL1NTL1MvQS9CL0PvvIkgKi8KY29uc3QgVVBfU0hBUkU9W1siU1NTIiwuMDNdLFsiU1MiLC4wN10sWyJTIiwuMTJdLFsiQSIsLjIwXSxbIkIiLC4yOF0sWyJDIiwuMzBdXTsKZnVuY3Rpb24gbWFrZUN1dHMocHMpewogY29uc3Qgcz1wcy5zbGljZSgpLnNvcnQoKGEsYik9PmItYSk7bGV0IGFjYz0wO2NvbnN0IGN1dHM9W107CiBmb3IoY29uc3QgW2csc2hdIG9mIFVQX1NIQVJFKXthY2MrPXNoO2lmKGc9PT0iQyIpe2N1dHMucHVzaChbZywtMV0pO2JyZWFrfWN1dHMucHVzaChbZyxzW01hdGgubWluKHMubGVuZ3RoLTEsTWF0aC5tYXgoMCxNYXRoLnJvdW5kKHMubGVuZ3RoKmFjYyktMSkpXV0pfQogcmV0dXJuIGN1dHM7Cn0KY29uc3QgZ3JhZGVPZj0oY3V0cyxwKT0+e2Zvcihjb25zdCBbZyxjXSBvZiBjdXRzKWlmKHA+PWMpcmV0dXJuIGc7cmV0dXJuIkMifTsKZnVuY3Rpb24gZ3JhZGVUYWJsZShjdXRzLHBzLHlzKXsKIGNvbnN0IHQ9e307VVBfU0hBUkUuZm9yRWFjaCgoW2ddKT0+dFtnXT17bjowLGs6MH0pOwogcHMuZm9yRWFjaCgocCxpKT0+e2NvbnN0IHg9dFtncmFkZU9mKGN1dHMscCldO3gubisrO3guays9eXNbaV19KTsKIGZvcihjb25zdCBnIGluIHQpe2NvbnN0IHg9dFtnXSx3PXdpbHNvbih4LmsseC5uKTt4LnJhdGU9eC5uP3guay94Lm46MDt4LmxvPXdbMF07eC5oaT13WzFdfQogcmV0dXJuIHQ7Cn0KCi8qIOaWsOODouODh+ODq+OBruWFpeWKm++8muePvuihjOODouODh+ODq+OBrueJueW+tOmHjygxNykg77yLIOOCquODg+OCuueJueW+tOmHjyg3LCDjgarjgZHjgozjgbAwKSDvvIsg44Kq44OD44K65pyJ54ShIO+8iyDjgrPjg7zjgrnliKXjga7pgY7ljrvms6LkubHnjocoMykgKi8KZnVuY3Rpb24gdXBYKHUsZSl7CiBjb25zdCBvZGRzPXUubW9kZT09PSJvZGRzIjsKIHJldHVyblsuLi51LmYuc2xpY2UoMSwxOCksLi4uKG9kZHM/dS5mLnNsaWNlKDE4LDI1KTpbMCwwLDAsMCwwLDAsMF0pLG9kZHM/MTowLC4uLmVdOwp9CmZ1bmN0aW9uIHVwc2V0Q3VzdG9tKE0sdSxlKXsKIGlmKCFNKXJldHVybiBudWxsOwogbGV0IHo7Y29uc3QgejA9bGd0KHUucDApOwogaWYoTS5raW5kPT09Im9sZCIpej16MDsKIGVsc2UgaWYoTS5raW5kPT09Im5ldyIpej1wcmVkTG9naXQoTS5tb2RlbCx1cFgodSxlKSk7CiBlbHNlIGlmKE0ua2luZD09PSJibGVuZCIpej0oejArcHJlZExvZ2l0KE0ubW9kZWwsdXBYKHUsZSkpKS8yOwogZWxzZSByZXR1cm4gbnVsbDsKIGNvbnN0IHA9c2lnbSh6KSxnPWdyYWRlT2YoTS5jdXRzLHApLHI9TS5yYXRlcyYmTS5yYXRlc1tnXXx8e307CiByZXR1cm57Z3JhZGU6ZyxwLHJhdGU6ci5yYXRlPz9udWxsLGxvOnIubG8/P251bGwsaGk6ci5oaT8/bnVsbCxuOnIubj8/MH07Cn0KY29uc3QgZ2V0VXBzZXRNb2RlbD0oKT0+e3RyeXtjb25zdCBtPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oVVBLRVkpfHwibnVsbCIpO3JldHVybiBtJiZtLmN1dHM/bTpudWxsfWNhdGNoKGUpe3JldHVybiBudWxsfX07CgovKiAtLS0tLS0tLS0tIOaknOiovOOBqOWGjeagoeato+OBruacrOS9kyAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIHJ1blVwc2V0Rml0KG9wdHMpewogb3B0cz1vcHRzfHx7fTsKIGNvbnN0IFNUQVJUPW9wdHMuc3RhcnR8fCIyMDIxLTAxLTAxIixURVNUPW9wdHMudGVzdFN0YXJ0fHxNT0RFTF9UUkFJTl9FTkQsb3V0PVtdOwogYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTsKIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKIGlmKHJhY2VzLmxlbmd0aDw1MDApe2J1c3koZmFsc2UpO3JldHVybntlcnJvcjoi6YGO5Y6744OH44O844K/44GM5bCR44Gq44GZ44GO44G+44GZ77yIIityYWNlcy5sZW5ndGgrIuODrOODvOOCue+8ieOAguWFiOOBq+mBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgiJ9fQogY29uc3Qgc3RvcmU9bmV3IFVFLlN0b3JlKCkscHJpPW5ldyBVcFByaSgpLFM9W107CiBmb3IobGV0IGk9MDtpPHJhY2VzLmxlbmd0aDtpKyspewogIGNvbnN0IHJjPXJhY2VzW2ldLGFtPW5ldyBNYXAoKTtmb3IoY29uc3QgciBvZiByYy5yb3dzKWFnZ0FkZChhbSxyKTsKICBjb25zdCBpbmZvPWFnZ0luZm8oYW0uZ2V0KFN0cmluZyhyYy5yb3dzWzBdJiZyYy5yb3dzWzBdLnJhY2VJZCkpKTsKICBpZihpbmZvJiZpbmZvLnkhPW51bGwmJnJjLmRhdGU+PVNUQVJUKXsKICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKTsKICAgY29uc3QgaGFzT2Rkcz1SLmV2ZXJ5KHI9PnIub2Rkcz4xKSxvZD1oYXNPZGRzP1IubWFwKHI9PnIub2Rkcyk6bnVsbDsKICAgY29uc3QgcmFjZT17ZGF0ZTpyYy5kYXRlLHN1cmY6UlswXS5zdXJmLGRpc3Q6UlswXS5kaXN0LGx2bDpSWzBdLmx2bHx8MCxncmQ6UlswXS5ncmR8fDAscnVubmVyczpSfTsKICAgdHJ5ewogICAgY29uc3QgYXA9VUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2QpLHU9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kLGFwKTsKICAgIFMucHVzaCh7ZGF0ZTpyYy5kYXRlLHUsZTpwcmkuZmVhdChpbmZvKSx5OmluZm8ueX0pOwogICB9Y2F0Y2goZSl7fQogIH0KICBwcmkuYWRkKGluZm8pO2Zvcihjb25zdCByIG9mIHJjLnJvd3Mpc3RvcmUuYWRkKHIpOwogIGlmKGklMzA9PT0yOSl7YnVzeSh0cnVlLGDmmYLns7vliJfjgavlho3nj77jgZfjgabmpJzoqLzkuK3igKYgJHtpKzF9LyR7cmFjZXMubGVuZ3RofeODrOODvOOCuWApO2F3YWl0IHNsZWVwKDApfQogfQogYnVzeSh0cnVlLCLjg6Ljg4fjg6vjgpLmr5TovIPkuK3igKYiKTthd2FpdCBzbGVlcCgwKTsKIGNvbnN0IHRyYWluPVMuZmlsdGVyKHM9PnMuZGF0ZTxURVNUKSx0ZXN0PVMuZmlsdGVyKHM9PnMuZGF0ZT49VEVTVCk7CiBjb25zdCByZXM9e25BbGw6Uy5sZW5ndGgsblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCxzdGFydDpTVEFSVCx0ZXN0U3RhcnQ6VEVTVCxiYXNlOlMubGVuZ3RoP1MucmVkdWNlKChhLHMpPT5hK3MueSwwKS9TLmxlbmd0aDowfTsKIGlmKHRlc3QubGVuZ3RoPDMwMHx8dHJhaW4ubGVuZ3RoPDE1MDApe2J1c3koZmFsc2UpO3JldHVybnsuLi5yZXMsZXJyb3I6YOaknOiovOOBq+S9v+OBiOOCi+acn+mWk+OBruODrOODvOOCueOBjOi2s+OCiuOBvuOBm+OCk++8iOWtpue/kuWBtCR7dHJhaW4ubGVuZ3RofeODu+aknOiovOWBtCR7dGVzdC5sZW5ndGh977yJ44CC5qSc6Ki844Gu6ZaL5aeL5pel44KS5pep44KB44KL44GL44CB44OH44O844K/44KS5aKX44KE44GX44Gm44GP44Gg44GV44GE44CCYH19CiBjb25zdCB5VD10ZXN0Lm1hcChzPT5zLnkpLHkwPXRyYWluLm1hcChzPT5zLnkpOwogLy8g54++6KGM44Oi44OH44Or44Gu5qSc6Ki85pyf6ZaT44Gn44Gu5oiQ57i+CiBjb25zdCBwMD10ZXN0Lm1hcChzPT5zLnUucDApLG0wPW1ldHJpY3NPZihwMCx5VCk7CiAvLyDmlrDjg6Ljg4fjg6vvvIjlrabnv5LmnJ/plpPjga7jgb/jgafkvZzjgovvvIkKIGNvbnN0IG1kbD1maXRMb2dpdCh0cmFpbi5tYXAocz0+dXBYKHMudSxzLmUpKSx5MCwzKTsKIGNvbnN0IHBOPXRlc3QubWFwKHM9PnNpZ20ocHJlZExvZ2l0KG1kbCx1cFgocy51LHMuZSkpKSksbU49bWV0cmljc09mKHBOLHlUKTsKIGNvbnN0IHBCPXRlc3QubWFwKChzLGkpPT5zaWdtKChsZ3QocDBbaV0pK3ByZWRMb2dpdChtZGwsdXBYKHMudSxzLmUpKSkvMikpLG1CPW1ldHJpY3NPZihwQix5VCk7CiByZXMubTA9bTA7cmVzLm1OPW1OO3Jlcy5tQj1tQjsKIC8vIOaOoeeUqOOBruWIpOaWre+8muWvvuaVsOaQjeWkseOBjDAuMDAy5Lul5LiK6Imv44GP44Gq44KK44CBQVVD44GM5oKq5YyW44GX44Gm44GE44Gq44GE44GT44GoCiBjb25zdCBiZXR0ZXI9KG0scmVmKT0+KHJlZi5sbC1tLmxsPj0uMDAyKSYmKG0uYXVjPj1yZWYuYXVjLS4wMDMpOwogbGV0IGtpbmQ9Im9sZCI7CiBjb25zdCBjYW5kPVtbIm5ldyIsbU5dLFsiYmxlbmQiLG1CXV0uZmlsdGVyKChbayxtXSk9PmJldHRlcihtLG0wKSkuc29ydCgoYSxiKT0+YVsxXS5sbC1iWzFdLmxsKVswXTsKIGlmKGNhbmQpa2luZD1jYW5kWzBdOwogcmVzLmtpbmQ9a2luZDsKIC8vIOetiee0muOBruWIh+OCjOebruOBr+OAjOWtpue/kuWBtOOAjeOBruS6iOa4rOOBi+OCieaxuuOCgeOAgeaknOiovOWBtOOBp+Wun+mam+OBruazouS5seeOh+OCkua4rOOCi++8iOato+ebtOOBquWun+e4vueOh++8iQogY29uc3QgcHJlZFRyYWluPXM9PmtpbmQ9PT0ib2xkIj9zLnUucDA6a2luZD09PSJuZXciP3NpZ20ocHJlZExvZ2l0KG1kbCx1cFgocy51LHMuZSkpKTpzaWdtKChsZ3Qocy51LnAwKStwcmVkTG9naXQobWRsLHVwWChzLnUscy5lKSkpLzIpOwogY29uc3QgY3V0cz1tYWtlQ3V0cyh0cmFpbi5tYXAocHJlZFRyYWluKSk7CiBjb25zdCBwVGVzdD10ZXN0Lm1hcChwcmVkVHJhaW4pLHRhYj1ncmFkZVRhYmxlKGN1dHMscFRlc3QseVQpOwogcmVzLmN1dHM9Y3V0cztyZXMudGFiPXRhYjsKIHJlcy5tb2RlbD17a2luZCxtb2RlbDptZGwsY3V0cyxyYXRlczpPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModGFiKS5tYXAoKFtnLHhdKT0+W2cse3JhdGU6eC5yYXRlLGxvOngubG8saGk6eC5oaSxuOngubn1dKSksCiAgYXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLG5UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsdGVzdFN0YXJ0OlRFU1QsbTAsbU4sbUJ9OwogYnVzeShmYWxzZSk7cmV0dXJuIHJlczsKfQoKZnVuY3Rpb24gdXBzZXRSZXBvcnQocil7CiBpZihyLmVycm9yKXJldHVybmA8c3BhbiBjbGFzcz0iYmFkIj4ke2VzYyhyLmVycm9yKX08L3NwYW4+YDsKIGNvbnN0IGY9eD0+eC50b0ZpeGVkKDQpLHJvdz0obCxtKT0+YDx0cj48dGQ+JHtsfTwvdGQ+PHRkPiR7ZihtLmxsKX08L3RkPjx0ZD4ke2YobS5icmllcil9PC90ZD48dGQ+JHttLmF1Yy50b0ZpeGVkKDMpfTwvdGQ+PHRkPiR7KG0uZWNlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48L3RyPmA7CiBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPuWtpue/kuWBtCAke3IublRyYWlufeODrOODvOOCue+8iOOAnCR7ZXNjKHIudGVzdFN0YXJ0KX3jga7liY3ml6XvvInvvI/mpJzoqLzlgbQgJHtyLm5UZXN0feODrOODvOOCue+8iCR7ZXNjKHIudGVzdFN0YXJ0KX3ku6XpmY3vvJ3nj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvInjgILlhajkvZPjga7ms6LkubHnjocgJHtwY3Qoci5iYXNlLDEpfeOAgjwvZGl2PgogPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuODouODh+ODq++8iOaknOiovOWBtO+8iTwvdGg+PHRoPuWvvuaVsOaQjeWkseKGkzwvdGg+PHRoPuiqpOW3ruKGkzwvdGg+PHRoPkFVQ+KGkTwvdGg+PHRoPui8g+ato+iqpOW3ruKGkzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT4ke3Jvdygi54++6KGMIixyLm0wKX0ke3Jvdygi5paw77yI44Kz44O844K55Yil44KS6L+95Yqg77yJIixyLm1OKX0ke3Jvdygi54++6KGM44Go5paw44Gu5bmz5Z2HIixyLm1CKX08L3Rib2R5PjwvdGFibGU+PC9kaXY+YDsKIGNvbnN0IG5tPXtvbGQ6IuePvuihjOODouODh+ODq+OBruOBvuOBvu+8iOaWsOODouODh+ODq+OBr+aYjueiuuOBq+OBr+iJr+OBj+OBquOCieOBquOBi+OBo+OBn++8iSIsbmV3OiLmlrDjg6Ljg4fjg6vjgpLmjqHnlKgiLGJsZW5kOiLnj77ooYzjgajmlrDjga7lubPlnYfjgpLmjqHnlKgifVtyLmtpbmRdOwogaCs9YDxkaXYgY2xhc3M9ImJhbm5lciAke3Iua2luZD09PSJvbGQiPyJ3biI6Im9rIn0iPjxiPue1kOaenO+8miR7bm19PC9iPjxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaOoeeUqOadoeS7tu+8muWvvuaVsOaQjeWkseOBjDAuMDAy5Lul5LiK5pS55ZaE44GX44CBQVVD44GM5oKq5YyW44GX44Gm44GE44Gq44GE44GT44Go44CCPC9zcGFuPjwvZGl2PmA7CiBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuetiee0muOBlOOBqOOBrjxiPuWun+mam+OBruazouS5seeOhzwvYj7vvIjmpJzoqLzlgbTjg7s5NSXjga7luYXvvInjgILjgZPjga7mlbDlrZfjgYzjgIHms6LkubHluqbjgr/jg5bjgavooajnpLrjgZXjgozjgovjgojjgYbjgavjgarjgorjgb7jgZnjgII8L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+562J57SaPC90aD48dGg+44Os44O844K55pWwPC90aD48dGg+5a6f6Zqb44Gu5rOi5Lmx546HPC90aD48dGg+OTUl44Gu5bmFPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgW2ddIG9mIFVQX1NIQVJFKXtjb25zdCB4PXIudGFiW2ddO2grPWA8dHI+PHRkPiR7Z308L3RkPjx0ZD4ke3gubn08L3RkPjx0ZD48Yj4ke3BjdCh4LnJhdGUsMSl9PC9iPjwvdGQ+PHRkPiR7cGN0KHgubG8pfeOAnCR7cGN0KHguaGkpfTwvdGQ+PC90cj5gfQogaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogY29uc3QgbW9ubz1VUF9TSEFSRS5tYXAoKFtnXSk9PnIudGFiW2ddLnJhdGUpLmV2ZXJ5KCh2LGksYSk9Pmk9PT0wfHx2PD1hW2ktMV0rLjAzKTsKIGlmKCFtb25vKWgrPSc8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7nrYnntJrjga7poIbjgavlrp/nuL7njofjgYzljZjoqr/jgavkuIvjgYzjgaPjgabjgYTjgb7jgZvjgpPjgILmpJzoqLzlgbTjga7jg6zjg7zjgrnmlbDjgYzlsJHjgarjgYTjgajotbfjgY3jgb7jgZnvvIjlgbbnhLbjga7nr4Tlm7Ljga7jgZPjgajjgYzlpJrjgYTvvInjgII8L2Rpdj4nOwogcmV0dXJuIGg7Cn0KZnVuY3Rpb24gdXBzZXRTdGF0dXNMaW5lKCl7CiBjb25zdCBNPWdldFVwc2V0TW9kZWwoKTsKIGlmKCFNKXJldHVybic8ZGl2IGNsYXNzPSJzbWFsbCI+5qiZ5rqW44Oi44OH44Or77yI5a2m57+S5riI44G/44Gu5Zu65a6a44Oi44OH44Or77yJ44CC5a6f57i+546H44Gv5a2m57+S5pmC44Gu5pWw5a2X44Gn44GZ44CC44CM5qSc6Ki844CN44K/44OW44Gn44CB6Ieq5YiG44Gu44OH44O844K/44Gn44Gu5qSc6Ki844O75YaN5qCh5q2j44GM44Gn44GN44G+44GZ44CCPC9kaXY+JzsKIGNvbnN0IG5tPXtvbGQ6IuePvuihjOODouODh+ODqyIsbmV3OiLlho3moKHmraPjgZfjgZ/mlrDjg6Ljg4fjg6siLGJsZW5kOiLnj77ooYzjgajmlrDjga7lubPlnYcifVtNLmtpbmRdOwogcmV0dXJuYDxkaXYgY2xhc3M9InNtYWxsIj48Yj4ke25tfTwvYj7jgafliKTlrprkuK3vvIjmpJzoqLzml6UgJHtlc2MoTS5hdCl977yP5qSc6Ki8ICR7TS5uVGVzdH3jg6zjg7zjgrnvvInjgILnrYnntJrjga7lrp/nuL7njofjga/jgIHjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPjgafmuKzjgaPjgZ/lgKTjgafjgZnjgII8L2Rpdj5gOwp9CgoKLyogLS0tLS0tLS0tLSDkv53lrZjjg4fjg7zjgr/jga7nirbms4EgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBzaG93U3RhdGUoKXsKIHRyeXtjb25zdCBmcz1hd2FpdCBpZGJBbGwoKSxwcz1hd2FpdCBwYXlBbGwoKTsKICBjb25zdCBiYXNlPWZzLmZpbHRlcihmPT4hZi5saXZlKSxsaXZlPWZzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpOwogIGlmKCFmcy5sZW5ndGgmJiFwcy5sZW5ndGgpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7pgY7ljrvjg4fjg7zjgr/jga/mnKrlj5blvpfjgafjgZnjgILjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GZ44GL44CB6Kit5a6a44GL44KJ44OQ44OD44Kv44Ki44OD44OX44KS5b6p5YWD44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IGxkPWxpdmUubWFwKGY9PmYuZGF0ZSkuc29ydCgpLG5SYWNlcz1saXZlLnJlZHVjZSgocyxmKT0+cytuZXcgU2V0KGYucm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplLDApOwogIGxldCBuQWxsPTAsblRyPTA7Zm9yKGNvbnN0IGYgb2YgbGl2ZSlmb3IoY29uc3QgciBvZiBmLnJvd3Mpe25BbGwrKztpZihyLnRyYWluZXIpblRyKyt9CiAgbGV0IGg9IiI7CiAgaWYobGl2ZS5sZW5ndGgpaCs9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5blvpfmuIjjgb/jga7miJDnuL7vvJoke2xpdmUubGVuZ3RofeaXpe+8jyR7blJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yIJHtsZFswXX3jgJwke2xkW2xkLmxlbmd0aC0xXX3vvIk8L3NwYW4+YDsKICBpZihiYXNlLmxlbmd0aCl7Y29uc3QgeXM9Wy4uLm5ldyBTZXQoYmFzZS5tYXAoZj0+Zi55ZWFyKSldLnNvcnQoKTtoKz0oaD8iXG4iOiIiKStgPHNwYW4gY2xhc3M9Imdvb2QiPuODkOODg+OCr+OCouODg+ODl0NTVu+8miR7YmFzZS5sZW5ndGh944OV44Kh44Kk44Or77yIJHt5c1swXXx8Ii0ifeOAnCR7eXNbeXMubGVuZ3RoLTFdfHwiLSJ95bm077yJPC9zcGFuPmB9CiAgY29uc3QgcHI9cHMucmVkdWNlKChzLHApPT5zKyhwLnJhY2VzfHxbXSkubGVuZ3RoLDApOwogIGgrPShoPyJcbiI6IiIpKyhwcy5sZW5ndGg/YDxzcGFuIGNsYXNzPSJnb29kIj7miZXmiLvvvJoke3BzLmxlbmd0aH3ml6XvvI8ke3ByLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9zcGFuPmA6JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvvvJrmnKrlj5blvpc8L3NwYW4+Jyk7CiAgaWYobkFsbCloKz1gXG7oqr/mlZnluKvjgaTjgY3jga7miJDnuL7vvJoke01hdGgucm91bmQoblRyL25BbGwqMTAwKX0lJHtuVHI9PT0wPyLvvIjjgZPjgozjgYvjgonlj5blvpfjgZnjgovmiJDnuL7jgavlhaXjgorjgb7jgZnvvIkiOiIifWA7CiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7norroqo3jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2UpfTwvc3Bhbj5gfQp9CgovKiAtLS0tLS0tLS0tIOWPluW+l+OBl+OBn+ihjCDihpIg5YaF6YOo44Gu6KGM77yI6Kq/5pWZ5bir44O744Kw44Os44O844OJ5LuY44GN77yJIC0tLS0tLS0tLS0gKi8KZnVuY3Rpb24gbGl2ZVJvdyh4KXtjb25zdCBmPXBhcnNlRmxvYXQoU3RyaW5nKHguZmluaXNoPz8iIikucmVwbGFjZSgvW15cZC5dL2csIiIpKTsKIHJldHVybntyYWNlSWQ6U3RyaW5nKHgucmFjZUlkfHwiIiksZGF0ZTpVRS5wYXJzZURhdGUoeC5kYXRlKSxuYW1lOlN0cmluZyh4LmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOlVFLm5uKHguaG9yc2UpLGpvY2tleTpVRS5qbm4oeC5qb2NrZXkpLAogIGZpbmlzaDpOdW1iZXIuaXNGaW5pdGUoZikmJmY+MD9mOm51bGwsZGlzdDpOdW1iZXIoeC5kaXN0YW5jZSl8fDAsc3VyZjpVRS5zdXJmQ29kZSh4LnN1cmZhY2UpLGFnZTpOdW1iZXIoeC5hZ2UpfHxudWxsLG51bTpOdW1iZXIoeC5udW1iZXIpfHxudWxsLAogIHBvcDpOdW1iZXIoeC5wb3ApPjA/TnVtYmVyKHgucG9wKTpudWxsLG9kZHM6bnVsbCxqbmFtZTpTdHJpbmcoeC5qb2NrZXl8fCIiKS50cmltKCksdHJhaW5lcjpVRS5jbGVhblRyKHgudHJhaW5lciksCiAgbHZsOih4LnZlbnVlQ29kZSYmIS9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyh4LnZlbnVlQ29kZSkpKT8tMTooVUUubGV2ZWxPZkxhYmVsKHguY2xzKXx8VUUubGV2ZWxPZlByaXplKHgucHJpemUpKSwKICBncmQ6VUUuZ3JhZGVUaWVyKCh4LmNsc3x8IiIpKyIgIisoeC5ncmFkZXx8IiIpLHgucHJpemUsZmFsc2UpLAogIGNvcm5lcjpBcnJheS5pc0FycmF5KHguY29ybmVyKSYmeC5jb3JuZXIubGVuZ3RoP3guY29ybmVyOm51bGwsbGFwOkFycmF5LmlzQXJyYXkoeC5sYXApJiZ4LmxhcC5sZW5ndGg/eC5sYXA6bnVsbH19CgovKiDlr77osaHml6XjgojjgorliY3jga7lsaXmrbTjgaDjgZHjgafjgrnjg4jjgqLjgpLkvZzjgovvvIjpqI7miYvjg7voqr/mlZnluKvjga7miJDnuL7jgoLlkIzmmYLjgavpm4boqIjvvIkgKi8KYXN5bmMgZnVuY3Rpb24gYnVpbGRTdG9yZSh0YXJnZXQpewogaWYoU1RPUkUmJlNUT1JFX0tFWT09PXRhcmdldClyZXR1cm4gU1RPUkU7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTtpZighZnMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi6YGO5Y6744OH44O844K/44GM5pyq55m76Yyy44Gn44GZ44CC5YWI44Gr44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBmeOBi+OAgeioreWumuOBp+ODkOODg+OCr+OCouODg+ODl+OCkuW+qeWFg+OBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogY29uc3Qgc3Q9bmV3IFVFLlN0b3JlKCk7c3QudHI9bmV3IE1hcCgpO2xldCB1c2VkPTA7Y29uc3QgQUc9bmV3IE1hcCgpOwogY29uc3QgdGFrZT1yPT57aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXR8fCFyLmhvcnNlKXJldHVybjthZ2dBZGQoQUcscik7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlOwogIGlmKHIudHJhaW5lciYmci5maW5pc2ghPW51bGwpe2xldCB0PXN0LnRyLmdldChyLnRyYWluZXIpO2lmKCF0KXN0LnRyLnNldChyLnRyYWluZXIsdD17bjowLHQzOjB9KTt0Lm4rKztpZihyLmZpbmlzaDw9Myl0LnQzKyt9fTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7CiAgYnVzeSh0cnVlLGDpgY7ljrvjg4fjg7zjgr/jgpLpm4boqIjkuK3igKYgJHtpKzF9LyR7ZnMubGVuZ3RofVxu77yIJHt0YXJnZXR944KI44KK5YmN44Gu44G/5L2/55So77yJYCk7CiAgaWYoZnNbaV0ubGl2ZSl7Zm9yKGNvbnN0IHggb2YgZnNbaV0ucm93c3x8W10pdGFrZShsaXZlUm93KHgpKX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZnNbaV0uY3N2KSl0YWtlKFVFLnRvUm93KG8pKTsKICBhd2FpdCBzbGVlcCgwKTsKIH0KIGNvbnN0IHByaT1uZXcgVXBQcmkoKTtmb3IoY29uc3QgYSBvZiBBRy52YWx1ZXMoKSlwcmkuYWRkKGFnZ0luZm8oYSkpO3N0LnVwPXByaTsKIGJ1c3koZmFsc2UpO1NUT1JFPXN0O1NUT1JFX0tFWT10YXJnZXQ7c3QuY291bnQ9dXNlZDtyZXR1cm4gc3Q7Cn0KCi8qIOWHuummrOihqOOBrjHjg6zjg7zjgrkg4oaSIOino+aekOeUqOOBruODrOODvOOCuSAqLwpmdW5jdGlvbiBta1JhY2UoYyxkKXsKIGNvbnN0IGhzPWMuaG9yc2VzfHxjLnJ1bm5lcnN8fFtdOwogY29uc3QgZ3Q9KGMuY2xhc3NOYW1lfHwiIikrIiAiKyhjLmdyYWRlfHwiIikrIiAiKyhjLnJhY2VOYW1lfHwiIik7CiBjb25zdCBncmQ9VUUuZ3JhZGVUaWVyKGd0LGMucHJpemUsdHJ1ZSk7CiByZXR1cm57ZGF0ZTpkLHN1cmY6VUUuc3VyZkNvZGUoYy5zdXJmYWNlKSxkaXN0Ok51bWJlcihjLmRpc3RhbmNlKXx8MCwKICBsdmw6VUUubGV2ZWxPZkxhYmVsKGMuY2xhc3NOYW1lKXx8VUUubGV2ZWxPZkxhYmVsKGMucmFjZU5hbWUpfHwoZ3JkPj0xPzU6MCksZ3JkLAogIHJ1bm5lcnM6aHMubWFwKChoLGkpPT57Y29uc3QgbmFtZT1oLmhvcnNlTmFtZXx8aC5ob3JzZXx8aC5uYW1lfHwiIjsKICAgcmV0dXJue25hbWUsaG9yc2U6VUUubm4obmFtZSksam9ja2V5OlVFLmpubihoLmpvY2tleXx8IiIpLGpuYW1lOlN0cmluZyhoLmpvY2tleXx8IiIpLnRyaW0oKSx0cmFpbmVyOlVFLmNsZWFuVHIoaC50cmFpbmVyfHwiIiksYWdlOmguYWdlfHxudWxsLG51bTpoLmhvcnNlTnVtYmVyfHxoLm51bWJlcnx8aSsxfX0pCiAgIC5zb3J0KCh4LHkpPT4oeC5udW18fDApLSh5Lm51bXx8MCkpfTsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOS7iumAseacq+OBruWPluW+lwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IFdLPXtkYXRlczpbXSxjYXJkczp7fSxvZGRzOnt9LG9kZHNOb3Rlczp7fSxkaWFnOltdLGNhbGM6e30sYXQ6IiIsc3RvcmVJbmZvOm51bGx9Owpjb25zdCBya2V5PShkLGMpPT5gJHtkfXwke1N0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKX0tJHtOdW1iZXIoYy5yYWNlTnVtYmVyKXx8MH1gOwpjb25zdCB3a01zZz10PT57JCgid2tTdGF0dXMiKS50ZXh0Q29udGVudD10fTsKY29uc3QgYmFzZVVybD0oKT0+JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwpmdW5jdGlvbiBuZXh0V2Vla2VuZCh0b2RheSl7Y29uc3Qgb3V0PVtdO2NvbnN0IHQ9bmV3IERhdGUodG9kYXkrIlQwMDowMDowMFoiKS5nZXRUaW1lKCk7CiBmb3IobGV0IGk9MDtpPDgmJm91dC5sZW5ndGg8MjtpKyspe2NvbnN0IGQ9bmV3IERhdGUodCtpKjg2NGU1KSx3PWQuZ2V0VVRDRGF5KCk7aWYodz09PTZ8fHc9PT0wKW91dC5wdXNoKGQudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSl9cmV0dXJuIG91dH0KCmFzeW5jIGZ1bmN0aW9uIGZldGNoQ2FyZHMoYmFzZSxkLHZlbnVlQ29kZSl7CiBjb25zdCBxPXZlbnVlQ29kZT9gJnZlbnVlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHZlbnVlQ29kZSl9YDoiIjtsZXQgZXJyPSIiOwogZm9yKGxldCB0PTA7dDwzO3QrKyl7CiAgdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSR7cX1gKTsKICAgaWYoIXIub2spe2xldCBtPSIiO3RyeXttPShhd2FpdCByLmpzb24oKSkuZXJyb3J8fCIifWNhdGNoe310aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyLnN0YXR1c30gJHttfWAudHJpbSgpKX0KICAgY29uc3QgeD1hd2FpdCByLmpzb24oKTtyZXR1cm57cmFjZXM6QXJyYXkuaXNBcnJheSh4KT94Oih4LnJhY2VzfHxbXSl9fQogIGNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7YXdhaXQgc2xlZXAoMTIwMCoodCsxKSl9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyfHwi5Y+W5b6X44Gn44GN44G+44Gb44KTIik7Cn0KCi8qIDHplovlgqzloLTjgbbjgpPjga7lh7rppqzooajjgILmrKDjgZHjg7vlpLHmlZfjgYzjgYLjgozjgbDjgIHoh6rli5Xjgacx5Zue44Gg44GR44KE44KK55u044GZICovCmFzeW5jIGZ1bmN0aW9uIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsaXNSZXRyeSl7CiBjb25zdCBjb2RlPVN0cmluZyh2LnZlbnVlQ29kZSk7CiBXSy5jYXJkc1tkXT0oV0suY2FyZHNbZF18fFtdKS5maWx0ZXIoYz0+U3RyaW5nKGMudmVudWVDb2RlKSE9PWNvZGUpOwogV0suZGlhZz1XSy5kaWFnLmZpbHRlcih4PT4hKHguZD09PWQmJnguY29kZT09PWNvZGUpKTsKIHRyeXsKICBjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLGNvZGUpOwogIGNvbnN0IG9rPXJhY2VzLmZpbHRlcihhPT4oYS5ob3JzZXN8fGEucnVubmVyc3x8W10pLmxlbmd0aCksYmFkPXJhY2VzLmxlbmd0aC1vay5sZW5ndGg7CiAgV0suY2FyZHNbZF0ucHVzaCguLi5vayk7CiAgY29uc3QgaXNzdWVzPW9rLmZpbHRlcihjPT5jLnF1YWxpdHkmJiFjLnF1YWxpdHkub2spLm1hcChjPT5gJHtjLnJhY2VOdW1iZXJ9Uu+8miR7Yy5xdWFsaXR5Lmlzc3Vlcy5qb2luKCLjg7siKX1gKTsKICBXSy5kaWFnLnB1c2goe2QsY29kZSxuYW1lOnYudmVudWVOYW1lfHxWRU5VRVtjb2RlXXx8Y29kZSxyYWNlczpyYWNlcy5sZW5ndGgsb2s6b2subGVuZ3RoLGJhZCxpc3N1ZXMsZXJyOiFyYWNlcy5sZW5ndGg/IuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyI6IiJ9KTsKICBpZigoYmFkPjB8fG9rLmxlbmd0aDw4KSYmIWlzUmV0cnkpe2F3YWl0IHNsZWVwKDgwMCk7cmV0dXJuIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsdHJ1ZSl9CiB9Y2F0Y2goZSl7CiAgV0suZGlhZy5wdXNoKHtkLGNvZGUsbmFtZTp2LnZlbnVlTmFtZXx8VkVOVUVbY29kZV18fGNvZGUscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7CiAgaWYoIWlzUmV0cnkpe2F3YWl0IHNsZWVwKDEyMDApO3JldHVybiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LHRydWUpfQogfQp9CgovKiDjgqrjg4PjgrrvvIjljZjli53vvIvopIfli53vvInjgILlh7rppqzooajjga7jg6rjg7Pjgq/jgYvjgonnm7TmjqUg4oaSIOWPluOCjOOBquOBi+OBo+OBn+ODrOODvOOCueOBr+OAgeaXpeS7mOODu+mWi+WCrOWgtOOBruODoeODi+ODpeODvOe1jOeUseOBp+ijnOOBhiAqLwphc3luYyBmdW5jdGlvbiBmZXRjaE9kZHNEYXRlKGJhc2UsZCl7CiBjb25zdCBjYXJkcz1XSy5jYXJkc1tkXXx8W10sbm90ZXM9W107V0sub2Rkc05vdGVzPVdLLm9kZHNOb3Rlc3x8e307CiBpZighY2FyZHMubGVuZ3RoKXtXSy5vZGRzTm90ZXNbZF09bm90ZXM7cmV0dXJue246MCxub3Rlc319CiBjb25zdCB3aXRoTGluaz1jYXJkcy5maWx0ZXIocj0+ci5vZGRzQ25hbWUpLGJ5Qz1uZXcgTWFwKHdpdGhMaW5rLm1hcChyPT5bci5vZGRzQ25hbWUscl0pKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHdpdGhMaW5rLmxlbmd0aDtpKz02KWNodW5rcy5wdXNoKHdpdGhMaW5rLnNsaWNlKGksaSs2KS5tYXAocj0+ci5vZGRzQ25hbWUpKTsKIGxldCBjaT0wLGZhaWxOPTA7Y29uc3QgcmVhc29ucz17fTsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoY2k8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1jaSsrOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWAsWzE1MDBdKTsKICAgZm9yKGNvbnN0IGl0IG9mICh4Lml0ZW1zfHxbXSkpe2NvbnN0IHI9YnlDLmdldChpdC5jbmFtZSk7aWYocilXSy5vZGRzW3JrZXkoZCxyKV09e3RhbjppdC5vZGRzfHx7fSxwbGFjZTppdC5wbGFjZXx8e30sYXQ6RGF0ZS5ub3coKX19CiAgIGZvcihjb25zdCBmIG9mICh4LmZhaWxlZHx8W10pKXtmYWlsTisrO2NvbnN0IG09U3RyaW5nKGYucmVhc29ufHwiIikuc2xpY2UoMCw2MCk7cmVhc29uc1ttXT0ocmVhc29uc1ttXXx8MCkrMX0KICB9Y2F0Y2goZSl7ZmFpbE4rPWNodW5rc1trXS5sZW5ndGg7Y29uc3QgbT1TdHJpbmcoZS5tZXNzYWdlfHxlKS5zbGljZSgwLDYwKTtyZWFzb25zW21dPShyZWFzb25zW21dfHwwKSsxfX19OwogYXdhaXQgUHJvbWlzZS5hbGwoW3dvcmtlcigpLHdvcmtlcigpXSk7CiBjb25zdCBkaXJlY3Q9Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoOwogbm90ZXMucHVzaChg5Ye66aas6KGo44Gu44Oq44Oz44Kv44GL44KJ55u05o6l77yaJHtkaXJlY3R9LyR7Y2FyZHMubGVuZ3RofeODrOODvOOCue+8iOODquODs+OCr+OBguOCiiAke3dpdGhMaW5rLmxlbmd0aH3jgIHlpLHmlZcgJHtmYWlsTn3vvIlgKTsKIGZvcihjb25zdCBbbSxjXSBvZiBPYmplY3QuZW50cmllcyhyZWFzb25zKSlub3Rlcy5wdXNoKGDjgIDlpLHmlZfjga7nkIbnlLHvvJoke21977yIJHtjfe+8iWApOwogY29uc3QgbWlzc2luZz1jYXJkcy5maWx0ZXIocj0+IVdLLm9kZHNbcmtleShkLHIpXSk7CiBpZihtaXNzaW5nLmxlbmd0aCl7CiAgZm9yKGNvbnN0IHYgb2YgWy4uLm5ldyBTZXQobWlzc2luZy5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKSl7CiAgIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9kYXRlPSR7ZH0mdmVudWU9JHt2fWAsWzE1MDBdKTsKICAgIGZvcihjb25zdCByIG9mICh4LnJhY2VzfHxbXSkpV0sub2Rkc1tgJHtkfXwke1N0cmluZyhyLnZlbnVlQ29kZSkucGFkU3RhcnQoMiwiMCIpfS0ke3IucmFjZU5vfWBdPXt0YW46ci5vZGRzfHx7fSxwbGFjZTpyLnBsYWNlfHx7fSxhdDpEYXRlLm5vdygpfTsKICAgIG5vdGVzLnB1c2goYOODoeODi+ODpeODvOe1jOeUsSAke1ZFTlVFW3ZdfHx2fe+8miR7KHgucmFjZXN8fFtdKS5sZW5ndGh944Os44O844K55Y+W5b6X77yI44Kq44OD44K655S76Z2i44Gr6KaL44Gk44GL44Gj44Gf44Os44O844K5ICR7eC50YXJnZXRzPz8iPyJ977yP5b2T5pel5YWo5L2TICR7eC50YXJnZXRzQWxsPz8iPyJ977yJYCk7CiAgICBub3Rlcy5wdXNoKGDjgIDopovjgaTjgYvjgaPjgZ/jg6zjg7zjgrnnlarlj7fvvJokeyh4LmZvdW5kUmFjZU5vc3x8W10pLmpvaW4oIiwiKXx8IuOBquOBlyJ977yP6Kqt44G/5Y+W44KM44Gq44GL44Gj44Gf77yaJHsoeC5ub1BhcnNlfHxbXSkuam9pbigiLCIpfHwi44Gq44GXIn1gKTsKICAgfWNhdGNoKGUpe25vdGVzLnB1c2goYOODoeODi+ODpeODvOe1jOeUsSAke1ZFTlVFW3ZdfHx2fe+8muWkseaVl++8iCR7U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCw4MCl977yJYCl9fQogfQogY29uc3Qgc3RpbGw9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYoc3RpbGwubGVuZ3RoKW5vdGVzLnB1c2goYOOCquODg+OCuuacquWPluW+l++8miR7c3RpbGwubWFwKHI9PihyLnZlbnVlTmFtZXx8IiIpK3IucmFjZU51bWJlcisiUiIpLmpvaW4oIuOAgSIpfe+8iOeZuuWjsuWJjeOAgeOBvuOBn+OBr+iqreOBv+WPluOCjOOBpuOBhOOBvuOBm+OCk++8iWApOwogV0sub2Rkc05vdGVzW2RdPW5vdGVzOwogcmV0dXJue246Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoLG5vdGVzfTsKfQoKYXN5bmMgZnVuY3Rpb24gd2Vla2VuZEdvKCl7CiBjb25zdCBiYXNlPWJhc2VVcmwoKTskKCJ3a0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJ3a09kZHMiKS5kaXNhYmxlZD10cnVlOwogV0suZGF0ZXM9W107V0suY2FyZHM9e307V0sub2Rkcz17fTtXSy5kaWFnPVtdO1dLLmNhbGM9e307CiB0cnl7CiAgd2tNc2coIumWi+WCrOaXpeOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IHRvZGF5PWpzdFRvZGF5KCk7bGV0IGRhdGVzPVtdOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHt0b2RheX0mbGlzdD0xYCxbMTUwMF0pO2RhdGVzPSh4LmF2YWlsYWJsZURhdGVzfHxbXSkuZmlsdGVyKGQ9PmQ+PXRvZGF5KX1jYXRjaChlKXt9CiAgaWYoIWRhdGVzLmxlbmd0aClkYXRlcz1uZXh0V2Vla2VuZCh0b2RheSk7CiAgZGF0ZXM9Wy4uLm5ldyBTZXQoZGF0ZXMpXS5zb3J0KCkuc2xpY2UoMCwzKTsKICBmb3IoY29uc3QgZCBvZiBkYXRlcyl7CiAgIHdrTXNnKGAke2R9IOmWi+WCrOWgtOOCkueiuuiqjeS4reKApmApOwogICBsZXQgdmVudWVzPVtdOwogICB0cnl7dmVudWVzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZH0mbGlzdD0xYCxbMTUwMF0pKS52ZW51ZXN8fFtdfQogICBjYXRjaChlKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs5aC05LiA6KanKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7Y29udGludWV9CiAgIGlmKCF2ZW51ZXMubGVuZ3RoKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs44Gq44GXKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6IuOBk+OBruaXpeOBruWHuummrOihqOOBr+acquWFrOmWi+OAgeOBvuOBn+OBr+mWi+WCrOOBjOOBguOCiuOBvuOBm+OCkyJ9KTtjb250aW51ZX0KICAgV0suY2FyZHNbZF09W107CiAgIGZvcihjb25zdCB2IG9mIHZlbnVlcyl7d2tNc2coYCR7ZH0gJHt2LnZlbnVlTmFtZXx8di52ZW51ZUNvZGV9IOOBruWHuummrOihqOOCkuWPluW+l+S4reKApu+8iCR7KFdLLmNhcmRzW2RdfHxbXSkubGVuZ3RofeODrOODvOOCueWPluW+l+a4iOOBv++8iWApO2F3YWl0IGxvYWRWZW51ZUludG8oYmFzZSxkLHYpfQogICBpZigoV0suY2FyZHNbZF18fFtdKS5sZW5ndGgpV0suZGF0ZXMucHVzaChkKTsKICB9CiAgaWYoIVdLLmRhdGVzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuWHuummrOihqOOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAguOAjOWPluOCiui+vOOBv+eKtuazgeOAjeOCv+ODluOCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogIGxldCBvZGRzTj0wLHRvdGFsPTA7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpe3drTXNnKGAke2R9IOOCquODg+OCuuOCkuWPluW+l+S4reKApmApO29kZHNOKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlLGQpKS5uO3RvdGFsKz1XSy5jYXJkc1tkXS5sZW5ndGh9CiAgd2tNc2coIumBjuWOu+ODh+ODvOOCv+OBqOeFp+WQiOOBl+OBpuOAgeWFqOODrOODvOOCueOCkuino+aekOS4reKApiIpOwogIGF3YWl0IGNhbGNXZWVrZW5kKCk7V0suYXQ9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxNik7CiAgcmVuZGVyQWxsKCk7CiAgY29uc3QgbnI9V0suZGF0ZXMucmVkdWNlKChzLGQpPT5zK1dLLmNhcmRzW2RdLmxlbmd0aCwwKTsKICB3a01zZyhg5a6M5LqG77yIJHtXSy5hdH3vvInvvJoke1dLLmRhdGVzLmpvaW4oIuOAgSIpfe+8jyR7bnJ944Os44O844K577yP44Kq44OD44K6ICR7b2Rkc05944Os44O844K5JHtvZGRzTj8iIjoi77yI55m65aOy5YmN44Gu44Gf44KB5pyq5Y+W5b6X44CC55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN77yJIn1gKTsKICAkKCJ3a09kZHMiKS5kaXNhYmxlZD1mYWxzZTtzaG93VGFiKCJ2QXhpcyIpOwogfWNhdGNoKGUpe3drTXNnKCLjgqjjg6njg7zvvJoiK2UubWVzc2FnZSk7YnVzeShmYWxzZSk7cmVuZGVyQWxsKCl9CiBmaW5hbGx5eyQoIndrR28iKS5kaXNhYmxlZD1mYWxzZX0KfQphc3luYyBmdW5jdGlvbiBvZGRzT25seSgpewogaWYoIVdLLmRhdGVzLmxlbmd0aClyZXR1cm47JCgid2tPZGRzIikuZGlzYWJsZWQ9dHJ1ZTsKIHRyeXtsZXQgbj0wO2Zvcihjb25zdCBkIG9mIFdLLmRhdGVzKXt3a01zZyhgJHtkfSDjgqrjg4PjgrrjgpLmm7TmlrDkuK3igKZgKTtuKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlVXJsKCksZCkpLm59CiAgYXdhaXQgY2FsY1dlZWtlbmQoKTtXSy5hdD1uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDExLDE2KTtyZW5kZXJBbGwoKTt3a01zZyhg44Kq44OD44K65pu05paw77yIJHtXSy5hdH3vvInvvJoke25944Os44O844K55YiGYCl9CiBjYXRjaChlKXt3a01zZygi5pu05paw44Ko44Op44O877yaIitlLm1lc3NhZ2UpfWZpbmFsbHl7JCgid2tPZGRzIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDop6PmnpDvvIgx44Os44O844K577yJ77ya6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuiA9IOacn+W+heWApOOAgeazouS5seW6puOAgemJhOadvwogKiAg6KSH5Yud56K6546H77ya44Kq44OD44K644GC44KK4oaS5biC5aC05oOF5aCx44KC5L2/44GG5a2m57+S5riI44G/44Oi44OH44OrKHBPKe+8j+OBquOBl+KGkumBjuWOu+aIkOe4vuOBruOBv+OBruODouODh+ODqyhwUCkKICogIOikh+WLneOCquODg+OCuu+8mkpSQeOBruikh+WLneOCquODg+OCuu+8iOS4i+mZkOOAnOS4iumZkO+8ieOAguiqreOCgeOBquOBhOOBqOOBjeOBr+WNmOWLneOBi+OCieaOqOWumu+8iMOX6KGo56S677yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KZnVuY3Rpb24gY2FsY1JhY2UoZCxjLHN0b3JlKXsKIGNvbnN0IHJhY2U9bWtSYWNlKGMsZCk7bGV0IG49cmFjZS5ydW5uZXJzLmxlbmd0aDtjb25zdCBzY3JhdGNoZWQ9W107CiB7Y29uc3QgbzA9V0sub2Rkc1tya2V5KGQsYyldOwogIGlmKG8wKXtjb25zdCBtaXNzPXJhY2UucnVubmVycy5maWx0ZXIocj0+IShvMC50YW5bci5udW1dPjEpKSxoYXZlPXJhY2UucnVubmVycy5sZW5ndGgtbWlzcy5sZW5ndGg7CiAgIC8vIOS4gOmDqOOBrummrOOBoOOBkeOCquODg+OCuuOBjOeEoeOBhO+8neWPlua2iOODu+mZpOWkluOBruWPr+iDveaAp+OBjOmrmOOBhOOAguWkluOBl+OBpuOAgeOCquODg+OCuui+vOOBv+OBp+ino+aekOOBmeOCi++8iOWkp+WNiuOBjOasoOOBkeOBpuOBhOOCi+OBquOCieWkluOBleOBquOBhO+8iQogICBpZihtaXNzLmxlbmd0aCYmaGF2ZT49NiYmbWlzcy5sZW5ndGg8PU1hdGgubWF4KDMsTWF0aC5mbG9vcihyYWNlLnJ1bm5lcnMubGVuZ3RoKi4yKSkpe3NjcmF0Y2hlZC5wdXNoKC4uLm1pc3MubWFwKHI9PnIubnVtKSk7cmFjZS5ydW5uZXJzPXJhY2UucnVubmVycy5maWx0ZXIocj0+bzAudGFuW3IubnVtXT4xKTtuPXJhY2UucnVubmVycy5sZW5ndGh9fX0KIGNvbnN0IGJhc2U9e2QsY2FyZDpjLHJhY2UsbixzY3JhdGNoZWQsa2V5OnJrZXkoZCxjKSx2ZW51ZTpjLnZlbnVlTmFtZXx8Yy52ZW51ZXx8IiIsbm86TnVtYmVyKGMucmFjZU51bWJlcil8fDAsCiAgbGFiZWw6YCR7Yy52ZW51ZU5hbWV8fGMudmVudWV8fCIifSR7Yy5yYWNlTnVtYmVyfHwiIn1SICR7Yy5yYWNlTmFtZXx8IiJ9YCxjb3Vyc2U6Yy5zdXJmYWNlJiZjLmRpc3RhbmNlP2Ake2Muc3VyZmFjZX0ke2MuZGlzdGFuY2V9bWA6IuOCs+ODvOOCueS4jeaYjiJ9OwogaWYoL+manOWusy8udGVzdCgoYy5yYWNlTmFtZXx8IiIpKyhjLmNsYXNzTmFtZXx8IiIpKSlyZXR1cm57Li4uYmFzZSxza2lwOiLpmpzlrrPjg6zjg7zjgrnjga/lr77osaHlpJbvvIjlubPlnLDnlKjjga7jg6Ljg4fjg6vjga7jgZ/jgoHvvIkifTsKIGlmKG48NilyZXR1cm57Li4uYmFzZSxza2lwOiI26aCt5pyq5rqAIn07CiBjb25zdCBvPVdLLm9kZHNbYmFzZS5rZXldLG9kZHM9bz9yYWNlLnJ1bm5lcnMubWFwKHI9Pm8udGFuW3IubnVtXSk6bnVsbCxoYXNPZGRzPSEhKG9kZHMmJm9kZHMuZXZlcnkoeD0+eD4xKSk7CiBjb25zdCBvZD1oYXNPZGRzP29kZHM6bnVsbDsKIGNvbnN0IHJlcz1VRS5hbmFseXplKHJhY2Usc3RvcmUsb2QpLGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKTtsZXQgdWc9VUUudXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kLGFwKTsKIGNvbnN0IFVNPWdldFVwc2V0TW9kZWwoKTsKIGlmKFVNJiZzdG9yZS51cCl7dHJ5e2NvbnN0IHU9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kLGFwKSxpbmY9e3Y6U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpLHN1cmY6cmFjZS5zdXJmLGRpc3Q6cmFjZS5kaXN0LGx2bDpyYWNlLmx2bCxncmQ6cmFjZS5ncmQsTjpufSxjdT11cHNldEN1c3RvbShVTSx1LHN0b3JlLnVwLmZlYXQoaW5mKSk7aWYoY3UpdWc9ey4uLnVnLC4uLmN1LG1vZGU6dS5tb2RlLGN1c3RvbTp0cnVlfX1jYXRjaChlKXt9fQogY29uc3QgYXhpcz1oYXNPZGRzP1VFLmF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kLGFwKTpudWxsOwogY29uc3QgbTM9aGFzT2Rkcz9VRS50b3AzRnJvbVdpbihvZC5tYXAoeD0+MS94KSk6bnVsbDsKIGNvbnN0IGhvcnNlcz1yYWNlLnJ1bm5lcnMubWFwKChyLGkpPT57CiAgY29uc3QgcD1oYXNPZGRzP2FwLnBPW2ldOmFwLnBQW2ldLHBsPW8mJm8ucGxhY2UmJm8ucGxhY2Vbci5udW1dOwogIGxldCBsbz1udWxsLGhpPW51bGwsc3JjPW51bGw7CiAgaWYocGwmJnBsLmxlbmd0aD09PTImJnBsWzBdPj0xKXtsbz1wbFswXTtoaT1wbFsxXTtzcmM9IuWunyJ9CiAgZWxzZSBpZihtMyl7bG89TWF0aC5tYXgoMSwwLjgvTWF0aC5tYXgobTNbaV0sLjAyKSk7aGk9bG87c3JjPSLmjqjlrpoifQogIGNvbnN0IHRyPXN0b3JlLnRyJiZyLnRyYWluZXI/c3RvcmUudHIuZ2V0KHIudHJhaW5lcik6bnVsbCx4PXJlc1tpXTsKICByZXR1cm57aSxubzpyLm51bSxuYW1lOnIubmFtZSxqbmFtZTpyLmpuYW1lLHRyYWluZXI6ci50cmFpbmVyLHRyTjp0cj90ci5uOjAsdHJSYXRlOnRyJiZ0ci5uP3RyLnQzL3RyLm46bnVsbCxqbjp4LmpuLAogICBwLGxvLGhpLHNyYyxldjpsbz9wKmxvOm51bGwsZXZNaWQ6bG8/cCoobG8raGkpLzI6bnVsbCx3aW46aGFzT2Rkcz9vZFtpXTpudWxsLHBvcDp4LnBvcCxob2xlOnguaG9sZSxwYzp4LnBjLG1vZGU6eC5tb2RlLG46eC5uLAogICBjYXJlZXI6eC5jYXJlZXIscmVjZW50OngucmVjZW50LHRhZ3M6eC50YWdzLHJhdGluZzpVRS5yYXRpbmcoeC5wYyx4Lm1vZGUseC5uKSx4fX0pOwogcmV0dXJuey4uLmJhc2UsaGFzT2RkcyxyZXMsYXAsdWcsYXhpcyxob3JzZXMscGxhY2VSZWFsOmhvcnNlcy5maWx0ZXIoaD0+aC5zcmM9PT0i5a6fIikubGVuZ3RofTsKfQphc3luYyBmdW5jdGlvbiBjYWxjV2Vla2VuZCgpewogV0suY2FsYz17fTsKIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoV0suZGF0ZXNbMF0pOwogV0suc3RvcmVJbmZvPXtsYXN0OnN0b3JlLmxhc3REYXRlfHwiIixjb3VudDpzdG9yZS5jb3VudH07CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgY3M9Wy4uLldLLmNhcmRzW2RdXS5zb3J0KChhLGIpPT5TdHJpbmcoYS52ZW51ZUNvZGUpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudmVudWVDb2RlKSl8fChhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKICBXSy5jYWxjW2RdPXtyYWNlczpbXX07CiAgZm9yKGxldCBpPTA7aTxjcy5sZW5ndGg7aSsrKXsKICAgdHJ5e1dLLmNhbGNbZF0ucmFjZXMucHVzaChjYWxjUmFjZShkLGNzW2ldLHN0b3JlKSl9CiAgIGNhdGNoKGUpe1dLLmNhbGNbZF0ucmFjZXMucHVzaCh7ZCxjYXJkOmNzW2ldLHNraXA6Iuino+aekOOCqOODqeODvO+8miIrZS5tZXNzYWdlLGxhYmVsOmAke2NzW2ldLnZlbnVlTmFtZXx8IiJ9JHtjc1tpXS5yYWNlTnVtYmVyfHwiIn1SYCx2ZW51ZTpjc1tpXS52ZW51ZU5hbWV8fCIiLG5vOmNzW2ldLnJhY2VOdW1iZXJ8fDAsaG9yc2VzOltdfSl9CiAgIGlmKGklND09PTMpYXdhaXQgc2xlZXAoMCk7CiAgfQogfQp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5qSc6Ki844Ky44O844OI77ya5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT44Gn44CB6Kqk5beu44KS5byV44GE44Gm44KC5Zue5Y+O546HMTAwJeS7peS4iuOBruiyt+OBhOaWueOBoOOBkeOAjOaknOiovOa4iOOBv+OAjQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEdBVEVfS0VZPSJrZWliYV9nYXRlX3YyIjsKY29uc3QgZ2V0R2F0ZT0oKT0+e3RyeXtyZXR1cm4gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShHQVRFX0tFWSl8fCJudWxsIil9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsKY29uc3QgU1RSQVQ9e2ZvY3VzOiLnqbTppqzvvIjil47nmoTkuK3njofph43oppbvvIkiLHRvcDE6IueptOmmrDHkvY0iLHRvcDI6IueptOmmrOS4iuS9jTLpoK0iLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uCJ9OwpmdW5jdGlvbiBzZXRHYXRlKG91dCxvdXRQKXsKIGNvbnN0IGl0ZW1zPVtdOwogZm9yKGNvbnN0IFtzcmMsb10gb2YgW1si44Kq44OD44K644GC44KKIixvdXRdLFsi44Kq44OD44K644Gq44GXIixvdXRQXV0pewogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKFNUUkFUKSl7CiAgIGNvbnN0IHY9by5zdGF0c1trXTtpZighdiljb250aW51ZTsKICAgY29uc3Qgc2VnPSh2LkMmJnYuQy5iZXRzPj0zMDApP3YuQzp2LmFsbDtpZighc2VnfHwhc2VnLmJldHMpY29udGludWU7CiAgIGNvbnN0IGxvdz1zZWcucm9pLTEuOTYqc2VnLnNlOwogICBpdGVtcy5wdXNoKHtrZXk6ayxsYWJlbDpTVFJBVFtrXSsi77yIIitzcmMrIu+8iSIscm9pOnNlZy5yb2ksbG93LGJldHM6c2VnLmJldHMsaGl0OnNlZy5oaXRSYXRlLHNlZzpzZWc9PT12LkM/IuWtpue/kuW+jCI6IuWFqOacn+mWkyJ9KTsKICB9CiB9CiBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShHQVRFX0tFWSxKU09OLnN0cmluZ2lmeSh7YXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLGl0ZW1zfSkpOwogcmVuZGVyR2F0ZSgpOwp9CmNvbnN0IHN0cmF0T2s9a2V5PT57Y29uc3QgZz1nZXRHYXRlKCk7cmV0dXJuICEhKGcmJmcuaXRlbXMuc29tZSh4PT54LmtleT09PWtleSYmeC5sb3c+PTEmJnguYmV0cz49MzAwKSl9Owpjb25zdCBzdHJhdENoaXA9a2V5PT5zdHJhdE9rKGtleSk/JzxzcGFuIGNsYXNzPSJjaGlwIGIiPuaknOiovOa4iOOBv++8iOWbnuWPjueOhzEwMCXotoXvvIk8L3NwYW4+JzonPHNwYW4gY2xhc3M9ImNoaXAgciI+5Zue5Y+O546HMTAwJei2heOBr+acqueiuuiqjTwvc3Bhbj4nOwpmdW5jdGlvbiByZW5kZXJHYXRlKCl7CiBjb25zdCBnPWdldEdhdGUoKSxlbD0kKCJnYXRlIik7CiBpZighZyl7ZWwuaW5uZXJIVE1MPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPjxiPuWbnuWPjueOh++8muacquaknOiovDwvYj7jgIDjgIzmpJzoqLzjgI3jgr/jg5bjgpLlrp/ooYzjgZnjgovjgb7jgafjgIHjganjga7osrfjgYTmlrnjgoLjgIwxMDAl6LaF44CN44Go44Gv6KiA44GI44G+44Gb44KT44CC77yI5Lul5YmN44Gu5qSc6Ki844Gn44Gv44CB56m06aasMeS9jeOBruikh+WLneWbnuWPjueOh+OBr+e0hDcy44CcNzcl44Gn44GX44Gf77yJPC9kaXY+JztyZXR1cm59CiBjb25zdCBvaz1nLml0ZW1zLmZpbHRlcih4PT54Lmxvdz49MSYmeC5iZXRzPj0zMDApLGJlc3Q9Zy5pdGVtcy5zbGljZSgpLnNvcnQoKGEsYik9PmIucm9pLWEucm9pKVswXTsKIGlmKG9rLmxlbmd0aCllbC5pbm5lckhUTUw9YDxkaXYgY2xhc3M9ImJhbm5lciBvayI+PGI+5qSc6Ki85riI44G/77yI5Zue5Y+O546HMTAwJei2he+8ie+8mjwvYj4ke29rLm1hcCh4PT5gJHtlc2MoeC5sYWJlbCl9ICR7cGN0KHgucm9pKX3vvIjkuIvpmZAke3BjdCh4Lmxvdyl944O7JHt4LmJldHMudG9Mb2NhbGVTdHJpbmcoKX3lm57jg7ske3guc2Vnfe+8iWApLmpvaW4oIu+8jyIpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaknOiovOaXpSAke2VzYyhnLmF0KX3jgILpgY7ljrvjga7miJDnuL7jgafjga7ntZDmnpzjgafjgIHku4rlvozjgoLntprjgY/kv53oqLzjga/jgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+PC9kaXY+YDsKIGVsc2UgZWwuaW5uZXJIVE1MPWA8ZGl2IGNsYXNzPSJiYW5uZXIgbmciPjxiPuWbnuWPjueOhzEwMCXotoXjgpLnorroqo3jgafjgY3jgZ/osrfjgYTmlrnjga/jgIHjgb7jgaDjgYLjgorjgb7jgZvjgpPjgII8L2I+JHtiZXN0P2DmnIDpq5jjgafjgoIgJHtlc2MoYmVzdC5sYWJlbCl9IOOBriAke3BjdChiZXN0LnJvaSl977yI6Kqk5beu44KS5byV44GP44GoJHtwY3QoYmVzdC5sb3cpfeODuyR7YmVzdC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl95Zue44O7JHtiZXN0LnNlZ33vvInjgIJgOiIifTxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaknOiovOaXpSAke2VzYyhnLmF0KX3jgILkuIvjga7lgJnoo5zjga/jgIzlvZPjgZ/jgorjgoTjgZnjgZXjg7vmnJ/lvoXlgKTjga7nm67lronjgI3jgajjgZfjgabkvb/jgaPjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+PC9kaXY+YDsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOihqOekugogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEdSQURFX09SREVSPVsiU1NTIiwiU1MiLCJTIiwiQSIsIkIiLCJDIl0sR1JBREVfQ09MT1I9e1NTUzoiI2I0MjMxOCIsU1M6IiNkOTJkMjAiLFM6IiNmNzkwMDkiLEE6IiMxNjY3ZDkiLEI6IiM2NjcwODUiLEM6IiM5OGEyYjMifTsKY29uc3QgZGF5TGFiZWw9ZD0+e2NvbnN0IHc9IuaXpeaciOeBq+awtOacqOmHkeWcnyJbbmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFVUQ0RheSgpXTtyZXR1cm4gYCR7ZC5zbGljZSg1KS5yZXBsYWNlKCItIiwiLyIpfSgke3d9KWB9Owpjb25zdCBjYWxjUmFjZXM9ZD0+KFdLLmNhbGNbZF0mJldLLmNhbGNbZF0ucmFjZXMpfHxbXTsKY29uc3QgYWxsUmFjZXM9KCk9PldLLmRhdGVzLmZsYXRNYXAoZD0+Y2FsY1JhY2VzKGQpKTsKY29uc3Qgbm9EYXRhPW1zZz0+YDxkaXYgY2xhc3M9InNtYWxsIj4ke21zZ3x8IuOAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgIIifTwvZGl2PmA7CgpmdW5jdGlvbiByZW5kZXJBbGwoKXtyZW5kZXJHYXRlKCk7cmVuZGVyQXhpcygpO3JlbmRlckV2KCk7cmVuZGVyVXBzZXQoKTtyZW5kZXJIb2xlKCk7cmVuZGVyUmFjZXMoKTtyZW5kZXJTdW0oKX0KCi8qIC0tLSDotoXpiYTmnb/vvIjopIfli53lnI/lhoXjga7kuojmuKznorrnjofjgYzpq5jjgYTou7jppqzvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlckF4aXMoKXsKIGNvbnN0IGVsPSQoInZBeGlzIik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IEI9VUUuQVhJUy5iYW5kczsKIGxldCBoPWA8aDI+6LaF6YmE5p2/77yI6KSH5Yud5ZyP5YaFIOe0hDk1JeS7peS4iu+8iTwvaDI+JHtzdHJhdENoaXAoImF4aXMiKX0KIDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrnjgaDjgZHliKTlrprjgZfjgb7jgZnjgILpgY7ljrvjga7lrp/nuL7vvJo8Yj7piYTmnb88L2I+77yI5LqI5risJHtwY3QoQlsi6YmE5p2/Il0ubG8pfeS7peS4iu+8ieOBr+Wun+mam+OBqzxiPiR7cGN0KEJbIumJhOadvyJdLnJhdGUsMSl9PC9iPuOBjDPnnYDku6XlhoXvvIgke0JbIumJhOadvyJdLm596aCt44CB6Kqk5beu44KS5byV44GE44Gm44KCJHtwY3QoQlsi6YmE5p2/Il0ubG85NSwxKX3vvInjgIEx5pel44GC44Gf44KK57SEJHtCWyLpiYTmnb8iXS5wZXJEYXl96aCt44CCMeaXpeOBq+acgOWkpzLpoK3jgaDjgZHlh7rjgZfjgb7jgZnjgII8L2Rpdj5gOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IHJzPWNhbGNSYWNlcyhkKSxwaWNrcz1bXTsKICBmb3IoY29uc3QgciBvZiBycylpZihyLmF4aXMpZm9yKGNvbnN0IHggb2Ygci5heGlzKXBpY2tzLnB1c2goe3IseCxoaDpyLmhvcnNlc1t4LmldfSk7CiAgcGlja3Muc29ydCgoYSxiKT0+Yi54LnAtYS54LnApOwogIGNvbnN0IG5PZGRzPXJzLmZpbHRlcihyPT4hci5za2lwJiZyLmhhc09kZHMpLmxlbmd0aCxuQWxsPXJzLmZpbHRlcihyPT4hci5za2lwKS5sZW5ndGg7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfeOAgDxzcGFuIGNsYXNzPSJzbWFsbCI+44Kq44OD44K65Y+W5b6XICR7bk9kZHN9LyR7bkFsbH3jg6zjg7zjgrk8L3NwYW4+PC9oMz5gOwogIGlmKCFuT2Rkcyl7aCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+44Kq44OD44K644GM5pyq5Y+W5b6X44Gu44Gf44KB5Yik5a6a44Gn44GN44G+44Gb44KT77yI55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN44KS5oq844GX44Gm44GP44Gg44GV44GE77yJ44CCPC9kaXY+Jztjb250aW51ZX0KICBjb25zdCBpcm9uPXBpY2tzLmZpbHRlcih6PT56LngudGllcj09PSLpiYTmnb8iKS5zbGljZSgwLDIpOwogIGNvbnN0IHJlc3Q9cGlja3MuZmlsdGVyKHo9PnoueC50aWVyIT09IumJhOadvyIpLnNsaWNlKDAsMik7CiAgY29uc3QgY2FyZD0oeix0YWcpPT5gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moei5yLmxhYmVsKX08L2I+44CAPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyh6LnIuY291cnNlKX3jg7ske3ouci5ufemgrTwvc3Bhbj48YnI+PGI+JHt6LmhoLm5vfeeVqiAke2VzYyh6LmhoLm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHJBIj4ke3RhZ308L3NwYW4+44CA5LqI5risICR7cGN0KHoueC5wKX08YnI+CiAgIDxzcGFuIGNsYXNzPSJzbWFsbCI+6aiO5omL77yaJHtlc2Moei5oaC5qbmFtZXx8IuS4jeaYjiIpfe+8j+iqv+aVmeW4q++8miR7ZXNjKHouaGgudHJhaW5lcnx8IuS4jeaYjiIpfe+8j+WNmOWLnSAke3ouaGgud2luP3ouaGgud2luKyLlgI0iOiItIn3vvI/opIfli50gJHt6LmhoLmxvP3ouaGgubG8udG9GaXhlZCgxKSsoei5oaC5oaT56LmhoLmxvPyLjgJwiK3ouaGguaGkudG9GaXhlZCgxKToiIikrIuWAjSIrKHouaGguc3JjPT09IuaOqOWumiI/IijmjqjlrpopIjoiIik6Ii0ife+8j+OBk+OBruWMuuWIhuOBrumBjuWOu+Wun+e4viAke3BjdCh6LngucmF0ZSwxKX08L3NwYW4+PC9kaXY+YDsKICBpZihpcm9uLmxlbmd0aCloKz1pcm9uLm1hcCh6PT5jYXJkKHosIui2hemJhOadvyIpKS5qb2luKCIiKTsKICBlbHNlIGgrPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPui2hemJhOadv++8iOS6iOa4rDkyJeS7peS4iu+8ieOBq+ipsuW9k+OBmeOCi+mmrOOBr+OBhOOBvuOBm+OCk+OAgueEoeeQhuOBq+iyt+OCj+OBquOBhOOBruOCguS4gOOBpOOBruWIpOaWreOBp+OBmeOAgjwvZGl2Pic7CiAgaWYoIWlyb24ubGVuZ3RoJiZyZXN0Lmxlbmd0aCloKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWPguiAg++8iDk1JeOBq+OBr+WxiuOBi+OBquOBhOi7uOWAmeijnO+8ie+8mjwvZGl2PmArcmVzdC5tYXAoej0+Y2FyZCh6LHoueC50aWVyKSkuam9pbigiIik7CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOacn+W+heWApO+8iOikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrrvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlckV2KCl7CiBjb25zdCBlbD0kKCJ2RXYiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgZXZNaW49TnVtYmVyKCQoImV2TWluIik/JCgiZXZNaW4iKS52YWx1ZToxLjA1KSxwTWluPU51bWJlcigkKCJldlAiKT8kKCJldlAiKS52YWx1ZTouMjUpOwogY29uc3Qgcm93cz1bXTsKIGZvcihjb25zdCByIG9mIGFsbFJhY2VzKCkpaWYoIXIuc2tpcClmb3IoY29uc3QgaCBvZiByLmhvcnNlcylpZihoLmV2IT1udWxsJiZoLmV2Pj1ldk1pbiYmaC5wPj1wTWluKXJvd3MucHVzaCh7cixofSk7CiByb3dzLnNvcnQoKGEsYik9PmIuaC5ldi1hLmguZXYpOwogY29uc3Qgbk9kZHM9YWxsUmFjZXMoKS5maWx0ZXIocj0+ci5oYXNPZGRzKS5sZW5ndGg7CiBsZXQgaD1gPGgyPuacn+W+heWApO+8iOikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrrvvIk8L2gyPiR7c3RyYXRDaGlwKCJ2YWx1ZSIpfQogPGRpdiBjbGFzcz0ic21hbGwiPuacn+W+heWApO+8neOBneOBrummrOOBjDPnnYDku6XlhoXjgavlhaXjgovnorrnjocgw5cg6KSH5Yud44Kq44OD44K644Gu5LiL6ZmQ44CCMS4w44KS6LaF44GI44KM44Gw44CB55CG6KuW5LiK44Gv6LK344GE57aa44GR44Gm44OX44Op44K544Gn44GZ44CC6KSH5Yud44Kq44OD44K644GvPGI+5a6fPC9iPu+8nUpSQeOBruWun+OCquODg+OCuuOAgTxiPuaOqOWumjwvYj7vvJ3ljZjli53jgYvjgonoqIjnrpfjgZfjgZ/nm67lronjgILnorrnjofjga7opovnqY3jgoLjgorpgZXjgYTjgYzlpKfjgY3jgY/lirnjgY/jgZ/jgoHjgIHjgIzmpJzoqLzjgI3jgacxMDAl6LaF44GM56K66KqN44GV44KM44KL44G+44Gn44Gv55uu5a6J44Go44GX44Gm5L2/44Gj44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuacn+W+heWApCA8c2VsZWN0IGlkPSJldk1pbiI+PG9wdGlvbiB2YWx1ZT0iMSI+MS4wMOS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjEuMDUiPjEuMDXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjEiPjEuMTDku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjIiPjEuMjDku6XkuIo8L29wdGlvbj48L3NlbGVjdD4g6KSH5Yud56K6546HIDxzZWxlY3QgaWQ9ImV2UCI+PG9wdGlvbiB2YWx1ZT0iMC4xNSI+MTUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC4yNSI+MjUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC40Ij40MCXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwLjYiPjYwJeS7peS4ijwvb3B0aW9uPjwvc2VsZWN0PjwvZGl2PmA7CiBpZighbk9kZHMpe2VsLmlubmVySFRNTD1oKyc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBjOacquWPluW+l+OBruOBn+OCgeOAgeacn+W+heWApOOBr+ioiOeul+OBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAje+8ieOAgjwvZGl2Pic7YmluZEV2KGV2TWluLHBNaW4pO3JldHVybn0KIGlmKCFyb3dzLmxlbmd0aCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnaHku7bjgavlkIjjgYbppqzjga/jgYTjgb7jgZvjgpPjgII8L2Rpdj4nOwogZWxzZXsKICBoKz1gPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPummrDwvdGg+PHRoPueiuueOhzwvdGg+PHRoPuikh+WLnTwvdGg+PHRoPuacn+W+heWApDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCB7cixoOnh9IG9mIHJvd3Muc2xpY2UoMCw0MCkpaCs9YDx0cj48dGQ+JHtlc2MoZGF5TGFiZWwoci5kKSl9ICR7ZXNjKHIubGFiZWwpfTxicj48Yj4ke3gubm9955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHguam5hbWV8fCIiKX08L3NwYW4+PC90ZD48dGQ+JHtwY3QoeC5wKX08L3RkPjx0ZD4ke3gubG8udG9GaXhlZCgxKX0ke3guaGk+eC5sbz8i44CcIit4LmhpLnRvRml4ZWQoMSk6IiJ9PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guc3JjfTwvc3Bhbj48L3RkPjx0ZD48Yj4ke3guZXYudG9GaXhlZCgyKX08L2I+PC90ZD48L3RyPmA7CiAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogfQogZWwuaW5uZXJIVE1MPWg7YmluZEV2KGV2TWluLHBNaW4pOwp9CmZ1bmN0aW9uIGJpbmRFdihhLGIpe2NvbnN0IGU9JCgiZXZNaW4iKSxwPSQoImV2UCIpO2lmKCFlKXJldHVybjtlLnZhbHVlPVN0cmluZyhhKTtwLnZhbHVlPVN0cmluZyhiKTtlLm9uY2hhbmdlPXAub25jaGFuZ2U9cmVuZGVyRXZ9CgovKiAtLS0g5rOi5Lmx5bqmIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJVcHNldCgpewogY29uc3QgZWw9JCgidlVwc2V0Iik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGxldCBoPWA8aDI+44Os44O844K544Gu5rOi5Lmx5bqm77yIU1NT44CcQ++8iTwvaDI+PGRpdiBjbGFzcz0ic21hbGwiPuOAjDPnnYDku6XlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOAjeOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkeOBl+OBpuOBhOOBvuOBme+8iOWFqOODrOODvOOCueW5s+WdhyDntIQyOC41Je+8ieOAguOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBr+OAgeOCquODg+OCuui+vOOBv+OBruWIpOWumuOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PiR7dXBzZXRTdGF0dXNMaW5lKCl9YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBjb25zdCBycz1jYWxjUmFjZXMoZCkuZmlsdGVyKHI9PiFyLnNraXApLGNudD17fTtHUkFERV9PUkRFUi5mb3JFYWNoKGc9PmNudFtnXT0wKTtycy5mb3JFYWNoKHI9PmNudFtyLnVnLmdyYWRlXSsrKTsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz48ZGl2IGNsYXNzPSJyb3ciPiR7R1JBREVfT1JERVIubWFwKGc9PmA8c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbZ119Ij4ke2d9ICR7Y250W2ddfTwvc3Bhbj5gKS5qb2luKCIgIil9PC9kaXY+YDsKICBjb25zdCBzb3J0ZWQ9cnMuc2xpY2UoKS5zb3J0KChhLGIpPT5HUkFERV9PUkRFUi5pbmRleE9mKGEudWcuZ3JhZGUpLUdSQURFX09SREVSLmluZGV4T2YoYi51Zy5ncmFkZSl8fGIudWcucC1hLnVnLnApOwogIGgrPWA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+44Os44O844K5PC90aD48dGg+562J57SaPC90aD48dGg+5LqI5risPC90aD48dGg+5a6f57i+44Gu5rOi5Lmx546HPC90aD48dGg+5Yik5a6aPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IHIgb2Ygc29ydGVkKWgrPWA8dHI+PHRkPiR7ZXNjKHIubGFiZWwpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK08L3NwYW4+JHtyLnNjcmF0Y2hlZCYmci5zY3JhdGNoZWQubGVuZ3RoP2AgPHNwYW4gY2xhc3M9ImNoaXAgbyI+6Zmk5aSW5o6o5a6aICR7ci5zY3JhdGNoZWQuam9pbigiLCIpfeeVqjwvc3Bhbj5gOiIifTwvdGQ+PHRkPjxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltyLnVnLmdyYWRlXX0iPiR7ci51Zy5ncmFkZX08L3NwYW4+PC90ZD48dGQ+JHtwY3Qoci51Zy5wKX08L3RkPjx0ZD4ke3IudWcuY3VzdG9tJiZyLnVnLnJhdGUhPW51bGw/YCR7cGN0KHIudWcucmF0ZSl9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHtwY3Qoci51Zy5sbyl944CcJHtwY3Qoci51Zy5oaSl944O7JHtyLnVnLm595Lu2PC9zcGFuPmA6TWF0aC5yb3VuZChyLnVnLnJhdGUqMTAwKSsiJSJ9PC90ZD48dGQgY2xhc3M9InNtYWxsIj4ke3IudWcubW9kZT09PSJvZGRzIj8i44Kq44OD44K66L6844G/Ijoi5o6o5a6aIn08L3RkPjwvdHI+YDsKICBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOeptOmmrO+8iOWlvei1sOeOh+OBrumrmOOBhOeptOmmrOWAmeijnO+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVySG9sZSgpewogY29uc3QgZWw9JCgidkhvbGUiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgZm9jdXM9JCgiaG9sZUZvY3VzIik/JCgiaG9sZUZvY3VzIikudmFsdWU9PT0iMSI6dHJ1ZTsKIGxldCBoPWA8aDI+56m06aas5YCZ6KOcPC9oMj4ke3N0cmF0Q2hpcCgiZm9jdXMiKX0KIDxkaXYgY2xhc3M9InNtYWxsIj7nqbTjgr7jg7zjg7PvvIjkurrmsJfoloTvvInjga7kuK3jgafjgIEz552A5Lul5YaF44Gr5YWl44KL56K6546H44GM6auY44GE6aas44CC44CM5b2T44Gf44KK44KE44GZ44GV44CN44Gu55uu5a6J44Gn44CB5Zue5Y+O546H44Gv5Yil44Gn44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPjxzZWxlY3QgaWQ9ImhvbGVGb2N1cyI+PG9wdGlvbiB2YWx1ZT0iMSI+4peO55qE5Lit546H6YeN6KaW77yI44Op44Oz44KvUy9B44Gu44G/77yJPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMCI+44GZ44G544Gm77yI5LiK5L2NMumgre+8iTwvb3B0aW9uPjwvc2VsZWN0PjwvZGl2PmA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+YDsKICBmb3IoY29uc3QgciBvZiBjYWxjUmFjZXMoZCkpewogICBpZihyLnNraXApY29udGludWU7CiAgIGNvbnN0IGM9Zm9jdXM/VUUucGlja0ZvY3VzKHIucmVzLDIpOlVFLnBpY2soci5yZXMsMik7aWYoIWMubGVuZ3RoKWNvbnRpbnVlOwogICBoKz1gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moci5sYWJlbCl9PC9iPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK0ke3IuaGFzT2Rkcz8iIjoi77yI44Kq44OD44K65pyq5Y+W5b6X77yJIn08L3NwYW4+YDsKICAgZm9yKGNvbnN0IHggb2YgYyl7Y29uc3QgaGg9ci5ob3JzZXNbeC5pXTsKICAgIGgrPWA8ZGl2IHN0eWxlPSJtYXJnaW4tdG9wOjZweCI+PGI+JHt4Lm5vfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHIke2hoLnJhdGluZ30iPiR7aGgucmF0aW5nfTwvc3Bhbj4gPHNwYW4gY2xhc3M9InNtYWxsIj7lpb3otbDnjocgJHtwY3QoeC5wYywxKX0ke3gub2RkP2DvvI/ljZjli50ke3gub2RkfeWAjSgke3gucG9wfeeVquS6uuawlylgOiIifTwvc3Bhbj48YnI+CiAgICAgPHNwYW4gY2xhc3M9InNtYWxsIj4ke2hoLmNhcmVlciYmaGguY2FyZWVyLm4/YOmAmueulyR7aGguY2FyZWVyLm596LWwIDPnnYDlhoUke2hoLmNhcmVlci50M33lm55gOiLpgJrnrpfvvJrlsaXmrbTjgarjgZcifSR7aGgucmVjZW50JiZoaC5yZWNlbnQubGVuZ3RoP2DvvI/nm7Tov5EgJHtoaC5yZWNlbnQuc2xpY2UoLTUpLmpvaW4oIi0iKX3nnYBgOiIife+8j+mojuaJi++8miR7ZXNjKGhoLmpuYW1lfHwi5LiN5piOIil977yP6Kq/5pWZ5bir77yaJHtlc2MoaGgudHJhaW5lcnx8IuS4jeaYjiIpfSR7aGgudHJSYXRlIT1udWxsJiZoaC50ck4+PTIwP2AoM+edgOWGhSR7cGN0KGhoLnRyUmF0ZSl9KWA6IiJ9PC9zcGFuPjxicj5gKwogICAgICh4LnRhZ3N8fFtdKS5zbGljZSgwLDMpLm1hcCh0PT5gPHNwYW4gY2xhc3M9ImNoaXAgJHt0LmN9Ij4ke2VzYyh0LnQpfTwvc3Bhbj5gKS5qb2luKCIiKStgPC9kaXY+YH0KICAgaCs9IjwvZGl2PiI7CiAgfQogfQogZWwuaW5uZXJIVE1MPWg7CiBjb25zdCBzPSQoImhvbGVGb2N1cyIpO3MudmFsdWU9Zm9jdXM/IjEiOiIwIjtzLm9uY2hhbmdlPXJlbmRlckhvbGU7Cn0KCi8qIC0tLSDlhajjg6zjg7zjgrnvvIjppqzjgZTjgajjga7norrnjofjg7vjgqrjg4Pjgrrjg7vmnJ/lvoXlgKTjg7vpqI7miYvjg7voqr/mlZnluKvvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlclJhY2VzKCl7CiBjb25zdCBlbD0kKCJ2UmFjZXMiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogbGV0IGg9IjxoMj7lhajjg6zjg7zjgrk8L2gyPiI7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+YDsKICBmb3IoY29uc3QgciBvZiBjYWxjUmFjZXMoZCkpewogICBpZihyLnNraXApe2grPWA8ZGl2IGNsYXNzPSJzbWFsbCI+JHtlc2Moci5sYWJlbCl977yaJHtlc2Moci5za2lwKX08L2Rpdj5gO2NvbnRpbnVlfQogICBjb25zdCBnPXIudWc7CiAgIGgrPWA8ZGV0YWlscz48c3VtbWFyeT4ke2VzYyhyLmxhYmVsKX0gPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyLmNvdXJzZSl944O7JHtyLm596aCtPC9zcGFuPiA8c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbZy5ncmFkZV19Ij4ke2cuZ3JhZGV9PC9zcGFuPjwvc3VtbWFyeT48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6aas77yP6aiO5omL77yP6Kq/5pWZ5birPC90aD48dGg+5Y2Y5YudPC90aD48dGg+6KSH5YudPC90aD48dGg+56K6546HPC90aD48dGg+RVY8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IHggb2Ygci5ob3JzZXMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLnAtYS5wKSkKICAgIGgrPWA8dHI+PHRkPjxiPiR7eC5ub308L2I+ICR7ZXNjKHgubmFtZSl9JHt4LmhvbGUmJngucmF0aW5nIT09IkMiP2AgPHNwYW4gY2xhc3M9InJ0IHIke3gucmF0aW5nfSI+JHt4LnJhdGluZ308L3NwYW4+YDoiIn08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guam5hbWU/ZXNjKHguam5hbWUpOic8c3BhbiBjbGFzcz0iYmFkIj7pqI7miYvkuI3mmI48L3NwYW4+J33vvIgke3guam4+PTU/IumBjuWOuyIreC5qbisi6aiO5LmXIjoi5bGl5q205bCRIn3vvInvvI8ke3gudHJhaW5lcj9lc2MoeC50cmFpbmVyKTonPHNwYW4gY2xhc3M9ImJhZCI+6Kq/5pWZ5bir5LiN5piOPC9zcGFuPid9JHt4LnRyUmF0ZSE9bnVsbCYmeC50ck4+PTIwPyLvvIgz552A5YaFIitwY3QoeC50clJhdGUpKyLvvIkiOiIifTwvc3Bhbj48L3RkPjx0ZD4ke3gud2luP3gud2luLnRvRml4ZWQoMSk6Ii0ifTwvdGQ+PHRkPiR7eC5sbz94LmxvLnRvRml4ZWQoMSkrKHguaGk+eC5sbz8i44CcIit4LmhpLnRvRml4ZWQoMSk6IiIpOiItIn08c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5zcmN8fCIifTwvc3Bhbj48L3RkPjx0ZD4ke3BjdCh4LnApfTwvdGQ+PHRkPiR7eC5ldiE9bnVsbD9gPGIke3guZXY+PTEuMDU/JyBjbGFzcz0iZ29vZCInOiIifT4ke3guZXYudG9GaXhlZCgyKX08L2I+YDoiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+PC9kZXRhaWxzPiI7CiAgfQogfQogZWwuaW5uZXJIVE1MPWg7Cn0KCi8qIC0tLSDlj5bjgorovrzjgb/nirbms4HvvIjpoK3mlbDjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgrPjg7zjgrnjg7vjgqrjg4Pjgrrjga7oqq3jgb/lj5bjgorntZDmnpzvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlclN1bSgpewogY29uc3QgZWw9JCgidlN1bSIpO2lmKCFXSy5kYXRlcy5sZW5ndGgmJiFXSy5kaWFnLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IHJzPWFsbFJhY2VzKCkuZmlsdGVyKHI9PiFyLnNraXApOwogY29uc3QgaG9yc2VzPXJzLnJlZHVjZSgocyxyKT0+cytyLm4sMCksam1pc3M9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT4haC5qbmFtZSkubGVuZ3RoLDApLHRtaXNzPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+IWgudHJhaW5lcikubGVuZ3RoLDApOwogY29uc3Qgam1hdGNoPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+aC5qbj49NSkubGVuZ3RoLDApLGhtYXRjaD1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9Pmgubj49MikubGVuZ3RoLDApOwogY29uc3Qgbm9Db3Vyc2U9cnMuZmlsdGVyKHI9PnIuY291cnNlPT09IuOCs+ODvOOCueS4jeaYjiIpLmxlbmd0aCxuT2Rkcz1ycy5maWx0ZXIocj0+ci5oYXNPZGRzKS5sZW5ndGgscFJlYWw9cnMuZmlsdGVyKHI9PnIucGxhY2VSZWFsPjApLmxlbmd0aDsKIGxldCBoPWA8aDI+5Y+W44KK6L6844G/54q25rOBPC9oMj48dGFibGU+PHRib2R5PgogPHRyPjx0ZD7op6PmnpDjgZfjgZ/jg6zjg7zjgrnvvI/lh7rotbDppqw8L3RkPjx0ZD4ke3JzLmxlbmd0aH3jg6zjg7zjgrnvvI8ke2hvcnNlc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPumojuaJi+OCkuiqreOCgeOBquOBi+OBo+OBn+mmrDwvdGQ+PHRkIGNsYXNzPSIke2ptaXNzPyJiYWQiOiJnb29kIn0iPiR7am1pc3N96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7oqr/mlZnluKvjgpLoqq3jgoHjgarjgYvjgaPjgZ/ppqw8L3RkPjx0ZCBjbGFzcz0iJHt0bWlzcz8iYmFkIjoiZ29vZCJ9Ij4ke3RtaXNzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+44Kz44O844K544KS6Kqt44KB44Gq44GL44Gj44Gf44Os44O844K5PC90ZD48dGQgY2xhc3M9IiR7bm9Db3Vyc2U/ImJhZCI6Imdvb2QifSI+JHtub0NvdXJzZX08L3RkPjwvdHI+CiA8dHI+PHRkPuOCquODg+OCuuOCkuWPluW+l+OBp+OBjeOBn+ODrOODvOOCuTwvdGQ+PHRkPiR7bk9kZHN977yPJHtycy5sZW5ndGh977yI6KSH5Yud44Gu5a6f44Kq44OD44K6ICR7cFJlYWx944Os44O844K577yJPC90ZD48L3RyPgogPHRyPjx0ZD7pgY7ljrvjg4fjg7zjgr/jgajjga7nhaflkIjvvIjppqzvvIk8L3RkPjx0ZD4ke2htYXRjaH3vvI8ke2hvcnNlc33poK3vvIgy6LWw5Lul5LiK77yJPC90ZD48L3RyPgogPHRyPjx0ZD7pgY7ljrvjg4fjg7zjgr/jgajjga7nhaflkIjvvIjpqI7miYvvvIk8L3RkPjx0ZD4ke2ptYXRjaH3vvI8ke2hvcnNlc33poK3vvIg16aiO5LmX5Lul5LiK77yJPC90ZD48L3RyPgogPHRyPjx0ZD7lrabnv5Ljg4fjg7zjgr/jga7mnIDntYLml6U8L3RkPjx0ZD4ke2VzYyhXSy5zdG9yZUluZm8mJldLLnN0b3JlSW5mby5sYXN0fHwiLSIpfTwvdGQ+PC90cj48L3Rib2R5PjwvdGFibGU+YDsKIGNvbnN0IHNjcj1ycy5maWx0ZXIocj0+ci5zY3JhdGNoZWQmJnIuc2NyYXRjaGVkLmxlbmd0aCksam1wPWFsbFJhY2VzKCkuZmlsdGVyKHI9PnIuc2tpcCYmL+manOWusy8udGVzdChyLnNraXApKTsKIGlmKHNjci5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9ImJhbm5lciB3biI+44Kq44OD44K644Gu54Sh44GE6aas44KS5Y+W5raI44O76Zmk5aSW44Go44G/44Gq44GX44Gm5aSW44GX44Gf44Os44O844K577yaJHtzY3IubWFwKHI9PmVzYyhyLmxhYmVsKSsi77yIIityLnNjcmF0Y2hlZC5qb2luKCIsIikrIueVqu+8iSIpLmpvaW4oIu+8jyIpfeOAguWun+mam+OBq+WHuui1sOOBmeOCi+mmrOOBquOCieOAgeOCquODg+OCuuOBruWPluW+l+a8j+OCjOOBp+OBmeOAgjwvZGl2PmA7CiBpZihqbXAubGVuZ3RoKWgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+6Zqc5a6z44Os44O844K5ICR7am1wLmxlbmd0aH3ku7bjga/jgIHlubPlnLDnlKjjga7jg6Ljg4fjg6vjga7jgZ/jgoHop6PmnpDjga7lr77osaHlpJbjgavjgZfjgabjgYTjgb7jgZnjgII8L2Rpdj5gOwogY29uc3QgZ2FwPVdLLnN0b3JlSW5mbyYmV0suc3RvcmVJbmZvLmxhc3QmJldLLmRhdGVzWzBdP01hdGgucm91bmQoKG5ldyBEYXRlKFdLLmRhdGVzWzBdKS1uZXcgRGF0ZShXSy5zdG9yZUluZm8ubGFzdCkpLzg2NGU1KTpudWxsOwogaWYoZ2FwIT1udWxsJiZnYXA+MTApaCs9YDxkaXYgY2xhc3M9ImJhbm5lciB3biI+5pyA5paw44Gu5oiQ57i+44GMJHtnYXB95pel5YiG5YWl44Gj44Gm44GE44G+44Gb44KT44CC44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBi+OCieOAgeOCguOBhuS4gOW6puS6iOaDs+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiBpZihycy5sZW5ndGgmJmhtYXRjaDxob3JzZXMqLjQpaCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+6YGO5Y6744OH44O844K/44Go54Wn5ZCI44Gn44GN44Gf6aas44GM5bCR44Gq44KB44Gn44GZ44CC6Iul6aeS5oim5Lit5b+D44Gu5pel44Gv5q2j5bi444Gn44GZ44GM44CB44Gd44GG44Gn44Gq44GR44KM44Gw6aas5ZCN44Gu6KGo6KiY44GM5ZCI44Gj44Gm44GE44Gq44GE5Y+v6IO95oCn44GM44GC44KK44G+44GZ44CCPC9kaXY+JzsKIGNvbnN0IG9uPVdLLm9kZHNOb3Rlc3x8e307CiBpZihPYmplY3Qua2V5cyhvbikubGVuZ3RoKXtoKz1gPGgzPuOCquODg+OCuuWPluW+l+OBruWGheioszwvaDM+PGRpdiBjbGFzcz0ic3RhdHVzIj4ke1dLLmRhdGVzLm1hcChkPT5gJHtkYXlMYWJlbChkKX1cbiR7KG9uW2RdfHxbXSkubWFwKGVzYykuam9pbigiXG4iKX1gKS5qb2luKCJcblxuIil9PC9kaXY+YH0KIGgrPWA8aDM+6ZaL5YKs5aC044GU44GoPC9oMz48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6ZaL5YKs5aC0PC90aD48dGg+44Os44O844K5PC90aD48dGg+54q25oWLPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgeCBvZiBXSy5kaWFnKXsKICBjb25zdCBwcm9icz1bXTtpZih4LmVycilwcm9icy5wdXNoKHguZXJyKTtpZih4LmJhZClwcm9icy5wdXNoKGDlh7rotbDppqzjgpLoqq3jgoHjgarjgYTjg6zjg7zjgrkgJHt4LmJhZH1gKTtwcm9icy5wdXNoKC4uLih4Lmlzc3Vlc3x8W10pKTsKICBoKz1gPHRyPjx0ZD4ke2VzYyhkYXlMYWJlbCh4LmQpKX0gJHtlc2MoeC5uYW1lKX08L3RkPjx0ZD4ke3gub2t9LyR7eC5yYWNlc308L3RkPjx0ZCBzdHlsZT0idGV4dC1hbGlnbjpsZWZ0Ij4ke3Byb2JzLmxlbmd0aD9gPHNwYW4gY2xhc3M9ImJhZCBzbWFsbCI+JHtwcm9icy5tYXAoZXNjKS5qb2luKCI8YnI+Iil9PC9zcGFuPmA6JzxzcGFuIGNsYXNzPSJnb29kIj7llY/poYzjgarjgZc8L3NwYW4+J30ke3guY29kZT9gIDxidXR0b24gY2xhc3M9Im1pbmkgc3ViIiBkYXRhLXJsPSIke2VzYyh4LmQpfXwke2VzYyh4LmNvZGUpfXwke2VzYyh4Lm5hbWUpfSI+5YaN5Y+W5b6XPC9idXR0b24+YDoiIn08L3RkPjwvdHI+YDsKIH0KIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIGVsLmlubmVySFRNTD1oOwogZWwucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtcmxdIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9YXN5bmMoKT0+ewogIGNvbnN0IFtkLGNvZGUsbmFtZV09Yi5kYXRhc2V0LnJsLnNwbGl0KCJ8Iik7Yi5kaXNhYmxlZD10cnVlO3drTXNnKGAke2R9ICR7bmFtZX0g44KS5YaN5Y+W5b6X5Lit4oCmYCk7CiAgdHJ5e2F3YWl0IGxvYWRWZW51ZUludG8oYmFzZVVybCgpLGQse3ZlbnVlQ29kZTpjb2RlLHZlbnVlTmFtZTpuYW1lfSk7YXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlVXJsKCksZCk7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKTt3a01zZygi5YaN5Y+W5b6X44GX44G+44GX44GfIil9CiAgY2F0Y2goZSl7d2tNc2coIuWGjeWPluW+l+OCqOODqeODvO+8miIrZS5tZXNzYWdlKX0KIH0pOwp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5pON5L2cCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KZnVuY3Rpb24gc2hvd1RhYih0KXtkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIudmlldyIpLmZvckVhY2godj0+di5jbGFzc0xpc3QudG9nZ2xlKCJvbiIsdi5pZD09PXQpKTtkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIjdGFicyBidXR0b24iKS5mb3JFYWNoKGI9PmIuY2xhc3NMaXN0LnRvZ2dsZSgib24iLGIuZGF0YXNldC50YWI9PT10KSl9CmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiN0YWJzIGJ1dHRvbiIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5zaG93VGFiKGIuZGF0YXNldC50YWIpKTsKJCgidXBSdW4iKS5vbmNsaWNrPWFzeW5jKCk9PnsKICQoInVwUnVuIikuZGlzYWJsZWQ9dHJ1ZTskKCJ1cE91dCIpLnRleHRDb250ZW50PSLmpJzoqLzkuK3igKbvvIjmlbDliIbjgYvjgYvjgorjgb7jgZnvvIkiOwogdHJ5ewogIGNvbnN0IHI9YXdhaXQgcnVuVXBzZXRGaXQoe3N0YXJ0OiQoInVwU3RhcnQiKS52YWx1ZXx8IjIwMjEtMDEtMDEifSk7CiAgJCgidXBPdXQiKS5pbm5lckhUTUw9dXBzZXRSZXBvcnQocik7CiAgaWYoci5tb2RlbCl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oVVBLRVksSlNPTi5zdHJpbmdpZnkoci5tb2RlbCkpO2lmKFdLLmRhdGVzLmxlbmd0aCl7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKX19CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgidXBPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJiYWQiPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5eyQoInVwUnVuIikuZGlzYWJsZWQ9ZmFsc2V9Cn07CiQoInVwQ2xlYXIiKS5vbmNsaWNrPWFzeW5jKCk9Pntsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShVUEtFWSk7JCgidXBPdXQiKS50ZXh0Q29udGVudD0i5qiZ5rqW44Oi44OH44Or44Gr5oi744GX44G+44GX44Gf44CCIjtpZihXSy5kYXRlcy5sZW5ndGgpe2F3YWl0IGNhbGNXZWVrZW5kKCk7cmVuZGVyQWxsKCl9fTsKJCgid2tHbyIpLm9uY2xpY2s9d2Vla2VuZEdvOwokKCJ3a09kZHMiKS5vbmNsaWNrPW9kZHNPbmx5OwokKCJia09uZSIpLm9uY2xpY2s9YXN5bmMoKT0+ewogaWYoQksuYnVzeSlyZXR1cm47CiBpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7CiAgY29uc3QgcD1wcm9tcHQoIuODkOODg+OCr+OCouODg+ODl+eUqOOBruODkeOCueODleODrOODvOOCuu+8iDjmloflrZfku6XkuIrvvInjgpLmsbrjgoHjgablhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgILlvqnlhYPjga7jgajjgY3jgavjgoLlkIzjgZjjgoLjga7jgYzlv4XopoHjgafjgZnjgIIiKTsKICBpZighcClyZXR1cm47QksucGFzcz1wLnRyaW0oKTtCSy5pZD0iIjtia1NhdmVTZXR0aW5ncygpOyQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7CiAgaWYoQksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOBrzjmloflrZfku6XkuIrjgavjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybn0KIH0KIGF3YWl0IHJ1bkJhY2t1cChmYWxzZSk7Cn07CiQoImRiZ0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgiZGJnT3V0IiksYmFzZT1iYXNlVXJsKCk7CiBpZighV0suZGF0ZXMubGVuZ3RoKXtvdXQudmFsdWU9IuWFiOOBq+OAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIiO3JldHVybn0KIG91dC52YWx1ZT0i6Ki65pat5Lit4oCmIjskKCJkYmdHbyIpLmRpc2FibGVkPXRydWU7Y29uc3QgbGluZXM9W2Dlj5blvpfml6UgJHtXSy5kYXRlcy5qb2luKCIsIil9YF07CiB0cnl7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogICBjb25zdCBjb2Rlcz1bLi4ubmV3IFNldCgoV0suY2FyZHNbZF18fFtdKS5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKTsKICAgZm9yKGNvbnN0IHYgb2YgY29kZXMpewogICAgY29uc3QgcnM9V0suY2FyZHNbZF0uZmlsdGVyKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKT09PXYpOwogICAgY29uc3QgcT1ycy5tYXAocj0+ci5xdWFsaXR5KS5maWx0ZXIoQm9vbGVhbik7CiAgICBsaW5lcy5wdXNoKGBcbuKWoCR7ZH0g6ZaL5YKs5aC0JHt2fe+8iCR7cnNbMF0/LnZlbnVlTmFtZXx8IiJ977yJ44Os44O844K5JHtycy5sZW5ndGh977yP44Kz44O844K55LiN5piOJHtycy5maWx0ZXIocj0+IShyLnN1cmZhY2UmJnIuZGlzdGFuY2UpKS5sZW5ndGh977yP6aiO5omL5qygJHtxLnJlZHVjZSgocyx4KT0+cysoeC5ob3JzZXMteC5qb2NrZXlGaWxsZWQpLDApfe+8j+iqv+aVmeW4q+asoCR7cS5yZWR1Y2UoKHMseCk9PnMrKHguaG9yc2VzLXgudHJhaW5lckZpbGxlZCksMCl9YCk7CiAgICBjb25zdCBiYWQ9cnMuZmluZChyPT5yLnF1YWxpdHkmJiFyLnF1YWxpdHkub2spfHxyc1swXSxybj0oYmFkJiZiYWQucmFjZU51bWJlcil8fDE7bGluZXMucHVzaChg77yI5ZWP6aGM44Gu44GC44KL44Os44O844K5ICR7cm59UiDjgpLoqr/jgbnjgb7jgZnvvIlgKTt0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vZGVidWctZW50cnk/ZGF0ZT0ke2R9JnZlbnVlPSR7dn0mcmFjZT0ke3JufWAsWzE1MDBdKTtkZWxldGUgeC5vaztsaW5lcy5wdXNoKEpTT04uc3RyaW5naWZ5KHgpKX1jYXRjaChlKXtsaW5lcy5wdXNoKCLoqLrmlq3jgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9CiAgIH0KICB9CiB9ZmluYWxseXskKCJkYmdHbyIpLmRpc2FibGVkPWZhbHNlfQogb3V0LnZhbHVlPWxpbmVzLmpvaW4oIlxuIik7Cn07CiQoImRiZ0NvcHkiKS5vbmNsaWNrPWFzeW5jKCk9Pntjb25zdCB0PSQoImRiZ091dCIpLnZhbHVlO3RyeXthd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KTskKCJkYmdDb3B5IikudGV4dENvbnRlbnQ9IuOCs+ODlOODvOOBl+OBvuOBl+OBnyJ9Y2F0Y2goZSl7JCgiZGJnT3V0Iikuc2VsZWN0KCk7YWxlcnQoIumBuOaKnuOBl+OBvuOBl+OBn+OAguOCs+ODlOODvOOBl+OBpuOBj+OBoOOBleOBhOOAgiIpfX07CiQoImZpbGUiKS5vbmNoYW5nZT1lPT57Y29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZihmKWltcG9ydEZpbGUoZik7ZS50YXJnZXQudmFsdWU9IiJ9OwoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOODqeODg+ODl+ODu+mAmumBjumghuS9jeOBruWPluOCiuebtOOBl++8iOWPluW+l+a4iOOBv+OBruaXpeOCkuOAgeaWsOOBl+OBhOmgheebruOBpOOBjeOBp+WPluOCiuebtOOBme+8iQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmFzeW5jIGZ1bmN0aW9uIGxhcFJlZmV0Y2goZGVwcyl7CiBjb25zdCBEPU9iamVjdC5hc3NpZ24oe2lkYkFsbCxpZGJQdXQsbWV0YUdldCxtZXRhUHV0LGZldGNoRGF5fSxkZXBzfHx7fSk7CiBjb25zdCBiYXNlPWJhc2VVcmwoKSxhPSQoImxhcFN0YXJ0IikudmFsdWV8fCIyMDIzLTAxLTAxIix5ZD1qc3RZZXN0ZXJkYXkoKSxtc2c9dD0+eyQoImxhcFN0YXR1cyIpLmlubmVySFRNTD10fTsKIFNTVE9QPWZhbHNlO1NZTkNJTkc9dHJ1ZTskKCJsYXBHbyIpLmRpc2FibGVkPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD1mYWxzZTsKIGNvbnN0IHN0PXtkYXlzOjAscmFjZXM6MCxsYXBzOjAsY29ybmVyczowLGhvcnNlczowLGZhaWw6W10sc2tpcHBlZDowLHQwOkRhdGUubm93KCksbm9kYXRhOmZhbHNlLHN0b3BwZWQ6ZmFsc2V9O2xldCBjb25zZWM9MCx0b3RhbD0wOwogdHJ5ewogIGNvbnN0IGZpbGVzPShhd2FpdCBELmlkYkFsbCgpKS5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoJiZmLmRhdGU+PWEmJmYuZGF0ZTw9eWQpLnNvcnQoKHgseSk9PnguZGF0ZTx5LmRhdGU/LTE6MSk7CiAgY29uc3QgdG9kbz1bXTsKICBmb3IoY29uc3QgZiBvZiBmaWxlcyl7aWYoZi5yb3dzLnNvbWUocj0+QXJyYXkuaXNBcnJheShyLmxhcCkmJnIubGFwLmxlbmd0aCl8fGF3YWl0IEQubWV0YUdldCgibGFwZG9uZToiK2YuZGF0ZSkpe3N0LnNraXBwZWQrKztjb250aW51ZX10b2RvLnB1c2goZi5kYXRlKX0KICB0b3RhbD10b2RvLmxlbmd0aDsKICBpZighdG90YWwpe21zZyhg5Y+W44KK55u044GZ5pel44Gv44GC44KK44G+44Gb44KT77yIJHthfeS7pemZjeOBriR7ZmlsZXMubGVuZ3RofeaXpeOBr+OAgeOBmeOBueOBpuODqeODg+ODl+ODu+mAmumBjumghuS9jeOBpOOBjeOBp+OBme+8ieOAgmApO3JldHVybn0KICBmb3IobGV0IGk9MDtpPHRvZG8ubGVuZ3RoO2krKyl7CiAgIGlmKFNTVE9QKWJyZWFrO2NvbnN0IGQ9dG9kb1tpXSxlbD1NYXRoLnJvdW5kKChEYXRlLm5vdygpLXN0LnQwKS8xMDAwKTsKICAgbXNnKGAke2R977yIJHtpKzF9LyR7dG90YWx95pel77yJ44KS5Y+W5b6X5Lit4oCmXG7lj5bjgornm7TjgZcke3N0LmRheXN95pel77yP44Op44OD44OX44KS6Kqt44KB44Gf44Os44O844K5ICR7c3QubGFwc30vJHtzdC5yYWNlc33vvI/lpLHmlZcke3N0LmZhaWwubGVuZ3Rofe+8j+e1jOmBjiR7TWF0aC5mbG9vcihlbC82MCl95YiGJHtlbCU2MH3np5JgKTsKICAgdHJ5ewogICAgY29uc3Qgcj1hd2FpdCBELmZldGNoRGF5KGJhc2UsZCk7CiAgICBpZihyLmZhaWxlZE4pe3N0LmZhaWwucHVzaChgJHtkfe+8iCR7ci5mYWlsZWROfVLlpLHmlZfvvIlgKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgICBjb25zdCByaWRzPW5ldyBTZXQoci5yb3dzLm1hcCh4PT54LnJhY2VJZCkpLGxhcFJhY2VzPW5ldyBTZXQoci5yb3dzLmZpbHRlcih4PT5BcnJheS5pc0FycmF5KHgubGFwKSYmeC5sYXAubGVuZ3RoKS5tYXAoeD0+eC5yYWNlSWQpKTsKICAgIGNvbnN0IGNvcm5lckhvcnNlcz1yLnJvd3MuZmlsdGVyKHg9PkFycmF5LmlzQXJyYXkoeC5jb3JuZXIpJiZ4LmNvcm5lci5sZW5ndGg+PTIpLmxlbmd0aDsKICAgIGF3YWl0IEQuaWRiUHV0KGBsaXZlOiR7ZH1gLHtsaXZlOnRydWUsZGF0ZTpkLHJvd3M6ci5yb3dzfSk7CiAgICBpZihsYXBSYWNlcy5zaXplfHxjb3JuZXJIb3JzZXMpYXdhaXQgRC5tZXRhUHV0KCJsYXBkb25lOiIrZCx0cnVlKTsKICAgIHN0LmRheXMrKztzdC5yYWNlcys9cmlkcy5zaXplO3N0LmxhcHMrPWxhcFJhY2VzLnNpemU7c3QuY29ybmVycys9Y29ybmVySG9yc2VzO3N0LmhvcnNlcys9ci5yb3dzLmxlbmd0aDtjb25zZWM9MDsKICAgIGlmKHN0LmRheXM+PTImJnN0LmxhcHM9PT0wJiZzdC5jb3JuZXJzPT09MCl7c3Qubm9kYXRhPXRydWU7U1NUT1A9dHJ1ZX0KICAgfWNhdGNoKGUpe3N0LmZhaWwucHVzaChgJHtkfe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX19CiAgIGF3YWl0IHNsZWVwKDQwMCk7CiAgfQogfWNhdGNoKGUpe3N0LmZhaWwucHVzaChTdHJpbmcoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5ewogIFNZTkNJTkc9ZmFsc2U7U1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7JCgibGFwR28iKS5kaXNhYmxlZD1mYWxzZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWU7CiAgY29uc3QgcmF0ZT0oeCx5KT0+eT9NYXRoLnJvdW5kKHgveSoxMDApKyIlIjoiLSI7CiAgbGV0IGg9YCR7c3Qubm9kYXRhPyc8c3BhbiBjbGFzcz0iYmFkIj7jg6njg4Pjg5fjgoLpgJrpgY7poIbkvY3jgoLoqq3jgoHjgb7jgZvjgpPjgafjgZfjgZ/jgILkuK3mlq3jgZfjgb7jgZfjgZ/jgII8L3NwYW4+XG7jgIzoqq3jgb/lj5bjgorjga7oqLrmlq3jgI3jgpLmirzjgZfjgIHlh7rjgZ/mlofnq6DjgpLosrzjgaPjgabjgY/jgaDjgZXjgYTjgIJcbic6KHN0LnN0b3BwZWQ/IumAo+e2muOBl+OBpuWkseaVl+OBl+OBn+OBn+OCgeS4reaWreOBl+OBvuOBl+OBn+OAguWwkeOBl+aZgumWk+OCkuOBiuOBhOOBpuOAgeOCguOBhuS4gOW6puaKvOOBl+OBpuOBj+OBoOOBleOBhOOAglxuIjooU1NUT1A/IuWBnOatouOBl+OBvuOBl+OBn+OAgiI6IuWujOS6huOAgiIpKX1gOwogIGgrPWDlj5bjgornm7TjgZcgJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIjkv53lrZjmuIjjgb/jgafjgrnjgq3jg4Pjg5cgJHtzdC5za2lwcGVkfeaXpe+8iVxu44Op44OD44OX44KS6Kqt44KB44Gf44Os44O844K577yaJHtzdC5sYXBzLnRvTG9jYWxlU3RyaW5nKCl9LyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3vvIgke3JhdGUoc3QubGFwcyxzdC5yYWNlcyl977yJXG7pgJrpgY7poIbkvY3jgpLoqq3jgoHjgZ/ppqzvvJoke3N0LmNvcm5lcnMudG9Mb2NhbGVTdHJpbmcoKX0vJHtzdC5ob3JzZXMudG9Mb2NhbGVTdHJpbmcoKX3vvIgke3JhdGUoc3QuY29ybmVycyxzdC5ob3JzZXMpfe+8iWA7CiAgaWYoc3QuZmFpbC5sZW5ndGgpaCs9YFxuPHNwYW4gY2xhc3M9Indhcm4iPuWkseaVlyAke3N0LmZhaWwubGVuZ3RofeS7tu+8miR7ZXNjKHN0LmZhaWwuc2xpY2UoMCw0KS5qb2luKCLjgIEiKSl9JHtzdC5mYWlsLmxlbmd0aD40PyIg4oCmIjoiIn3vvIjjgoLjgYbkuIDluqbmirzjgZnjgajjgIHmrovjgorjgaDjgZHntprjgY3jgYvjgonvvIk8L3NwYW4+YDsKICBtc2coaCk7dHJ5e2F3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKX1jYXRjaChlKXt9CiB9CiByZXR1cm4gc3Q7Cn0KJCgibGFwR28iKS5vbmNsaWNrPSgpPT5sYXBSZWZldGNoKCk7CiQoImxhcERiZyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3Qgb3V0PSQoImxhcE91dCIpO291dC52YWx1ZT0i6Ki65pat5Lit4oCmIjsKIHRyeXsKICBjb25zdCBmaWxlcz0oYXdhaXQgaWRiQWxsKCkpLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpLnNvcnQoKHgseSk9PnguZGF0ZTx5LmRhdGU/LTE6MSk7CiAgaWYoIWZpbGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlj5blvpfmuIjjgb/jga7miJDnuL7jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiAgY29uc3QgZD1maWxlc1tmaWxlcy5sZW5ndGgtMV0uZGF0ZSxkYXk9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2VVcmwoKX0vanJhLWRheT9kYXRlPSR7ZH1gKSxyYWNlcz1kYXkucmFjZXN8fFtdOwogIGNvbnN0IHI9cmFjZXMuZmluZCh4PT54LnJhY2VObz09PTExKXx8cmFjZXNbMF07CiAgaWYoIXIpe291dC52YWx1ZT1gJHtkfSDjga7jg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpNgO3JldHVybn0KICBjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlVXJsKCl9L2RlYnVnLXJlc3VsdD9jbmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChyLmNuYW1lKX1gKTtkZWxldGUgeC5vazsKICBvdXQudmFsdWU9YOaXpeS7mCAke2R9IOmWi+WCrOWgtCR7ci52ZW51ZUNvZGV9ICR7ci5yYWNlTm99UlxuYCtKU09OLnN0cmluZ2lmeSh4KTsKIH1jYXRjaChlKXtvdXQudmFsdWU9IuiouuaWreOCqOODqeODvO+8miIrZS5tZXNzYWdlfQp9OwoKaWYoL15odHRwcz86Ly50ZXN0KGxvY2F0aW9uLnByb3RvY29sKSkkKCJ3dXJsIikudmFsdWU9bG9jYXRpb24ub3JpZ2luO2Vsc2UgJCgid3VybCIpLnZhbHVlPSJodHRwczovL2tlaWJhLWFpLXBheW91dHMuaHQxOTk1MDgyMi53b3JrZXJzLmRldiI7CnJlbmRlckdhdGUoKTtyZW5kZXJBbGwoKTsKKGFzeW5jKCk9Pnt0cnl7YXdhaXQgb3BlbkRCKCk7YXdhaXQgc2hvd1N0YXRlKCk7YXdhaXQgYmtJbml0KCl9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuS/neWtmOmgmOWfn+OCkumWi+OBkeOBvuOBm+OCk++8miR7ZXNjKGUubWVzc2FnZSl9XG7vvIjjg5fjg6njgqTjg5njg7zjg4jjg5bjg6njgqbjgrrjgafjga/kvb/jgYjjgarjgYTjgZPjgajjgYzjgYLjgorjgb7jgZnvvIk8L3NwYW4+YH19KSgpOwoKPC9zY3JpcHQ+CjwvYm9keT48L2h0bWw+Cg==";
function serveApp() {
  const bin = atob(APP_HTML_BASE64);
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function handleHealth(env) {
  let kv = "未設定";
  try { if (env && env.BACKUP) { await env.BACKUP.list({ limit: 1 }); kv = "OK"; } } catch (e) { kv = "エラー: " + String(e?.message || e); }
  return json({ ok: true, version: WORKER_VERSION, kv, time: new Date().toISOString() });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const p = url.pathname;
      const method = request.method.toUpperCase();
      if (method === "OPTIONS") return handleOptions();
      if (p.startsWith("/backup/")) return await handleBackup(request, env, p);
      if (method !== "GET" && method !== "HEAD") return errorResponse("GET / HEAD / OPTIONS のみ対応しています。", 405);
      if (p === "/" || p === "/index.html") return serveApp();
      if (p === "/manifest.webmanifest") return manifestResponse();
      if (p === "/icon-180.png") return iconResponse("180");
      if (p === "/icon-192.png") return iconResponse("192");
      if (p === "/icon-512.png") return iconResponse("512");
      if (p === "/health") return await handleHealth(env);
      if (p === "/race-cards") return await handleRaceCards(request);
      if (p === "/jra-days") return await handleJraDays(request);
      if (p === "/jra-day") return await handleJraDay(request);
      if (p === "/jra-results") return await handleJraResults(request);
      if (p === "/jra-odds") return await handleJraOdds(request);
      if (p === "/debug-entry") return await handleDebugEntry(request);
      if (p === "/debug-result") return await handleDebugResult(request);
      return errorResponse("見つかりません: " + p, 404);
    } catch (error) {
      return errorResponse(error?.message || error, 500);
    }
  }
};
