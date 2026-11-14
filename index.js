/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-14-rebuild-15";

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


const isPwEntry = c => /^pw01dd/i.test(String(c || ""));
const entryKey = r => `${r.date}-${r.venueCode}-${r.raceNo}`;
/* 同じレースに複数の版があるときは、PC版(pw01dde)だけを残す。PC版が無いレースはそのまま残す */
function dedupePreferPw(list) {
  const best = new Map();
  for (const r of list) {
    const k = entryKey(r), prev = best.get(k);
    if (!prev || (isPwEntry(r.cname) && !isPwEntry(prev.cname))) best.set(k, r);
  }
  return [...best.values()];
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
    const have = [...seeds.values()].filter(r => isPwEntry(r.cname) && r.date === date && (!venueFilter || r.venueCode === venueFilter)).length;
    if (have < 12) {
      menuInfo = await discoverJRAEntryLinksViaMenu(date, diagnostics, venueFilter);
      for (const link of menuInfo.links) seeds.set(link.cname, link);
    }
  }

  const baseSeeds = dedupePreferPw([...seeds.values()]);
  const pwKeys = new Set(baseSeeds.filter(r => isPwEntry(r.cname)).map(entryKey));
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
        {
        const mk = `${race.date}-${race.venueCode}-${race.raceNo}`, prev = matches.get(mk);
        // すでにPC版を読めているレースは、スマホ版・アプリ版で上書きしない
        if (!(prev && isPwEntry(prev.cname) && !isPwEntry(race.cname))) {
          matches.set(mk, { ...race, entryInfo: extractJRAEntryInfo(html), htmlLength: html.length });
        }
      }
      }

      for (const link of links) {
        if (visited.has(link.cname) || queued.has(link.cname)) continue;
        if (!isPwEntry(link.cname) && pwKeys.has(entryKey(link))) continue;   // PC版があるレースの、スマホ版・アプリ版は取らない
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
          entryKind: isPwEntry(race.cname) ? "pc" : "sp",   // pc=PC版（騎手・調教師・オッズへのリンクあり）／sp=スマホ・アプリ版（これらが無い）
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
  if (card.entryKind === "sp") issues.push("スマホ・アプリ版のページを読んでいます（騎手・調教師・オッズのリンクが無い版）");
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


/* 指定日・開催場の、単勝・複勝オッズ画面へのリンク（レース番号つき）だけを返す軽い処理 */
async function handleJraOddsLinks(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = String(url.searchParams.get("venue") || "").padStart(2, "0");
  if (!isValidDateString(date) || !/^\d{2}$/.test(venue)) return errorResponse("date=YYYY-MM-DD&venue=05 を指定してください。", 400);
  const compact = date.replace(/-/g, "");
  const re = /pw15[0-9a-z]{3}\d{2}[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/gi;
  const collect = html => [...new Set(String(html || "").replace(/%2F/gi, "/").match(re) || [])];
  const vOf = c => ((String(c).match(/^pw15[0-9a-z]{3}\d{2}(\d{2})/i) || [])[1] || "");
  const kindsOf = cs => [...new Set(cs.map(c => c.slice(0, 9)))].slice(0, 10);
  const links = new Map();
  const diag = [];
  const take = cs => {
    for (const c of cs) {
      const m = c.match(/^pw151ou\d{2}(\d{2})\d{8}(\d{2})(\d{8})\//i);
      if (m && m[1] === venue && m[3] === compact) links.set(Number(m[2]), c);
    }
  };
  try {
    const top = await fetchJRAHtmlPost("/JRADB/accessO.html", "pw15oli00/6D");
    const topC = collect(top);
    take(topC);
    const isMenu = c => /^pw15o[a-z]{2}/i.test(c) && c.includes(compact) && vOf(c) === venue;
    const menus = topC.filter(isMenu);
    diag.push({ step: "top", htmlLength: top.length, cnames: topC.length, kinds: kindsOf(topC), menus: menus.length, sample: topC.slice(0, 6) });
    const seen = new Set();
    let frontier = menus.slice(0, 3), fetched = 0;
    for (let depth = 0; depth < 2 && frontier.length && fetched < 7; depth++) {
      const next = [];
      for (const c of frontier) {
        if (seen.has(c) || fetched >= 7) continue;
        seen.add(c); fetched++;
        try {
          const html = await fetchJRAHtmlPost("/JRADB/accessO.html", c);
          const cs = collect(html);
          take(cs);
          for (const x of cs) if (isMenu(x) && !seen.has(x)) next.push(x);
          diag.push({ step: "menu" + (depth + 1), cname: c, htmlLength: html.length, cnames: cs.length, kinds: kindsOf(cs), races: [...links.keys()].length, sample: cs.filter(x => !/^pw15o[a-z]{2}/i.test(x)).slice(0, 6) });
        } catch (error) {
          diag.push({ step: "menu" + (depth + 1), cname: c, error: String(error?.message || error) });
        }
      }
      frontier = next.slice(0, 4);
    }
    return json({ ok: true, date, venue, count: links.size, links: [...links.entries()].sort((a, b) => a[0] - b[0]).map(([raceNo, cname]) => ({ raceNo, cname })), diag });
  } catch (error) {
    return errorResponse(error?.message || error, 500);
  }
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
  "512": "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAIAAAB7GkOtAAAkeUlEQVR42u3dd3xPZ//H8e83UxJRrWppiwopipDEKrVr9aY0tbeYMaLEiF1b7T2CxObWoqRmqkSM2JvUCBGrtoTs8ftDbz+3mzbz+/1c57yej/uP+6Ek1/e6rvN5n+s653uOMXe+4gYAgP5Y0AUAQAAAAAgAAAABAAAgAAAABAAAgAAAABAAAAACAABAAAAACAAAAAEAACAAAAAEAACAAAAAEAAAAAIAAEAAAAAIAAAAAQAAIAAAAAQAAIAAAAAQAABAAAAACAAAAAEAACAAAAAEAACAAAAAEAAAAAIAAEAAAAAIAAAAAQAAIAAAAAQAAIAAAAAQAACA7GFFF5hYlUGhdALwNgcmV6ITTMaYO19xeoFaD5AKBACo+AB5QACAog8QBgQAqPsASUAAUPep+wBJQABQ+gEQAwQAdR8ASUAAUPoBEAMEAKUfADFAAFD6ARADBAClHwAxQADotfQz8wAORgJA+xOOWg9wkBIAOppVFH2Aw5YA0NEcougDHMgEgL4mDXUf4KAmAPQ1Uaj7AAc4AcDMAMDBTgBoekJQ9wEOfAJAd5OA0g9QAQgABh4A1UBTLBhvqj+geZk8orX6qBhtrgAyM1qUfoClgE6KgwYDIMMDTOkHiAFdVQkLxpXqD+hNho93je0FaWoFkLGxofQDLAX0WTQsGEiOAYClgD7XARoJAKo/ADIgvbSwBZSBkaD0A6CSWDBmAJCxyqD6OkDtAKD6AyAD9BgAVH8AZIAeA4DqD4AMyCQrhhMA3lg0tPoIILVXAOkaFao/ABOcO6qYFuoFANUfABmgxwDQ/IoMgNLUqlEWGh4JTv8BUEk0EgBs/gCQnwEKLQKUCQCqPwAyQI8BQPUHQAbodwVA9QdAhdFdAHDnDwAVya9dmloBcPoPgDqjnQBIe4RS/QFIywDhiwDRAUD1B0AG6HcFAADQXQBw+g+ARQArAKo/AOqPbgKAWz8BaInMmqb2CoDTfwBUIU0FAKf/AFgEsALg9B8AtUg3AZDGkKT6A1AuA6QtAvgeAADolKwA4PQfAIsAVgAAAAKA038AVKdsYCWnKdz9iTTyaNzAwcFeSGNOnT5/9nwYg4J01TohUWHFYEA5o4b5FCzwsZDGjJs0iwCAoqRsAXH5F4AGqHUpmIvAAMAKQCvRCgBUKmUCgMu/APRGQt1jCwgAdEqZAGD/BwD1SmsBwP4PAH0ye/VjCwgAdEqNAGD/B4BalKharAAAgBWAOXABAICembcGsgIAAFYAUnEBAICK5NcuVgAAwAoAAEAAmAZXgAHAjJVQ+gqACwAA1CW8grEFBAA6RQAAAAEAACAAAAAEAACAAMhS3AMKAOath6JXANwDCkB1kusYW0AAoFMEAAAQAAAAAgAAQAAAAAgAAAABAAAgAAAABAAAgAAAABAAAAACAABAAAAACAAAgBlY0QXm0syjkd+8yfSD6ob79h3u25d+yKSBQ8cuCVhDP7ACAAAQAAAAAgAAQAAAAAgAAAABAAAgAAAABAAAgAAAABAAAAACAAAIAAAAAQAAIAAAAAQAAIAAAAAQAAAAAgAAQAAAAAgAAAABAAAgAAAABAAAgAAAABAAAAACAABAAAAACAAAAAEAACAAAAAEAACAAAAAEAAAAAIAAAgAAAABAAAgAAAABAAAgAAAABAAAAACAACgGiu6QLeWLls7cuwU+kHnDu/b+snH+ekHAgD6kpCYGBMTSz/oXEpKCp2gW2wBAQABAAAgAAAABAAAgAAAABAAAAACAABAAAAACAAAAAEAACAAAAAEAACAAAAAEAAAAAIAAEAAAAAIAAAAAQAAIAAAAAQAAIAAAAAQAAAAAgAAQAAAAAEAACAAAAAEAACAAAAAEAAAAAIAAKAuK7oAmeHRuEHrlh7h4RFXr0VcDY8Iv3b9RuStpKRkeib7ODrmLOtS0t3NpZxbmaXL1uwJPkifgACAGZR3L1u7xpe1a3z58k+SkpIjbtwMvxZxNfz61WsRL7Lh5q07ycmkQkaPUivLEsWcy7mVcXdzcXd1+czZycLir7X71fDrBAAIAJhH8WLO/1utijgVKuJUqE7tai//MCExMSIi8uorC4Wr4RG3bt9NTU2lD9+owCcf/afily7rUjJHjhxv/GuVyrvRVyAAYKYA+KxIWv6ajbW1c1En56JOr/5hfHz8teuRV69FXA2//nIT6e6f9/SZCu/kcnRzLe3uWsbdtbS7m0ve9/Ok5V+VLVvK1sYmPiGBqQgCAKauWfnyfZDhf25ra1u8WNHixYq++oexsXHh1yJe7h292Ee6d++B9nrP2tqq1OfFX+zquLu5FHX61Gg0pveH2Fhbly1T6vDRE8xGEAAwqWL/XbuzhJ1djpKfFyv5ebFX//D585i/FgrXIl7sI4WHRzx4+Ei5Hiv8aUF3Nxf3sqXLuZUpXbqErY1N5n/mFxXdCAAQADC1NO7/ZJ6Dg71LqRIupUq8+odRUdGvLBT+uq7w+MlTUV303ru53Vxd3F1Ll3NzcXN1ee/d3Fn+KypyGQAEAMywAvisqBl/e65cjq5lSrmWKfXyTx48fORcqop5+8TWxqZ0qeLubmXKubq4ubo4FS6Y3b+xQnlXo9HI5XQQACo5dyFs3KRZZmzAiVNnMh0ARUR16ekz503/S41GY5HChV7cle/mWrp0yRLW1iY9rN57N3fRIoUvXwnP2D+fuzAgl6Oj2cfu+Ikz1AQCQEcuhl2+GHZZ6Y9QolhRUe05ZfIAWLZ4Zo1qld/JZeYCWqmCa4YDYLH/ag5G3eJREMggR8ecH+XPJysATps6AHI62Ju9+hsMhsqVyjMhQQDAhKf/xZ2lNcn0K4BDh0XcflO9aiUmJAgAmE5Zl5Ki2vPw0eObt+6YPACOSfjs+fN9+NqX7AACADoKgFPmuAJ8/ORZId/CZREAAgCm8+r9lxKcPm2GAIiPjz91+pyEj1+jWmXmJAgAmIK9vZ1z0cKsAAwGw6HQ4xI+ftXKFSwtLZmZIACQ7UqXLCGt3JgrAA7KuAyQK5ejtE05EADQJteysvZ/Hj95Gnnztll+9eGjJ1NSUiR0QvVqXzAzQQAg24m7Anz6vLl+dVRU9IWLlyR0Qo2qBAAIAJhgBVBGVgCcPnPejL/90GERlwEqlHd923tjAAIAWcPBwb5oEVlXgE+a9VYcIQFga2NTtUoF5icIAGQjl1IlXr6TVohQsz4QX8h1YIPBUL9ODeYnCABko3JuZUS153pEpHlfGfbnn/evhkdI6Ip6dWoyP0EAIBtVrlROVHsOHz1p9jbsOxAqoSs+/ijfay9TAwgAZBmj0ViporusADhi/iey7QsJFdIb9VkEgABANilR3Dn3O7lENSlUwBtx9+0PFfJOLi4DgABAdpG2//M0Kjrsjytmb8ajx0/OXfhDQoe4uZbO+34eJioIAGg/AI4cPSnk1Ds45JCIQ9rCok7takxUEADIhgCoKCsAJOz//CcAxFwGqMtlABAAyGpOhQt++GFeUU2ScAX4hYOhRxMTkyS0pFb1KrY2NkxXEADI0tN/Ye+eTUxMOnHqrJDGxMTEHj95WkJLHBzsa9aownQFAYCs9IWwG0DPnLsQGxsnpz1ydoG+/aY+0xUEALJSlS9krQAkfAXsvwPgkJCWfF2vtq2tLTMWBACyRhGnQoUKfiKqSaEynsL20rETp2NiYiW0JGdOh69qfsmkBQGArFG7ZlVR7UlJSQk5cFhUkxITkw6GHhXSmG+/acCkBQGArFGnlqwAOHXm/JOnUdJ6Kej3ECEtqV+3Jq8HAAGALGBra/tlZVnPmg/ed0hgR/32+z4hLXFwsK/LN8JAACDzvvyivLTTyb0hEgMg/NoNIY+GNhgMTbgXCAQAMu8rYfs/8fHx0m4Beilod7CQltSvU9Pe3o7ZCwIAmVJbWAAcDD0eHx8vNQCk7ALZ2eVoUK8WsxcEADKuUMFPnIW9BDg45KDY7jpw6Kicr6e1at6ECQwCAJk4/Rd2A6jBYNgr8grwC/EJCfv2S/lKcM1qlT/Kn485DAIAGSTtBtDHT56ePR8mucd2idkFsrCwaNHsG+YwCABkhIODfc3qlUU1KTjkUEpKiuROk3MzqMFgaNPCg2kMAgAZUb9uTWlPlQkWvP/zwo3IW39cuiqkMUWcClUo78pMBgGAdGvcsJ60Jsn8BsBrglgEgACA0uzt7aRdAAi/duN6RKQCAbBbUAB4NG5gZ8djIUAAID3q16kh7QvA23buVqLrDoYelfOoopw5HRp9XZf5DAIA6dC4kbhnCezYtUeJrktKShbV1Lat2AUCAYA0s7PLUaeWrKeJPXkadVjMW+D/UeC2IDmNqVqlonNRJ2Y1CACkSb2vakjbOA7aHZyUlKxKB/6+94CoN1Z27dSaWQ0CAGnSuJG4+3+279yjUAfGxcWJuheoVfMmOXM6MLFBAOAf2Nvb1a1dXVSTEhOTdu/dr1Y3itoFypnTgUcDgQDAP2vSqL60JwkfOHQ0KiparW7c9VtwQmKinPZ09WxjNBqZ3iAA8HfatvpOWpN2BO1RrhujoqJDxDwYzmAwOBcpXL1qJaY3CAC8VRGnQl9UdBcXALv2qNiZgVuDRLWnm2dbZjgIALyVwCcHXLh4KeLGTRU7c9vO30U9uq5enRoFC3zMJAcBgDewtLQUeKlQ0dN/g8Fw/8FDUW+vtLCw6NyxFfMcBADeoFaNKvnyfSCtVVt37Fa3SwO37hLVno5tmzs65mSqgwDA6wRe/r0eEXni1Fl1u3RT4A5Ru0C5cjmyCAABgNflee/d+nVrSmvVxl+2Kd2rd+/e23/wiKgmeXXtIO01DyAAYGbNv2tkY20trVU//7JV9Y79aeOvotrzQd48bVryeDgCAPgPo9HYqUNLaa3649LVi2GXVe/bwK274hMSRDXJu6enpaUl054AAAwGg6FO7WrORQqLO/3ftFUDffs0KlrUK2IMBkOhgp94NP6aaU8AAAaDweDVtYPAVm3ask0b3fvThkBpTerXpytPhiAAAEOJ4s41qn0hrVUnT5+7Gh6hjR7e+VtwdPQzaYNer04NJj8BAL3r2U3i6b/q9/+8Kj4+XtTDQV/w8e7O5CcAoGt538/T7LtG0lqVmpq6act2LfXzTxvF7QKVcy9T96vqHAIEAPTLs0NLWxsbaa06fPTErdt3tdTPIQeO3Lv3QFqrRvh+z5UAAgA6ZWtj49lB4vdCtXH/z6uSk5M3bha3qVWqZHGPJtwORABAl7779l8f5M0jrVUJiYmbA3dqr7fXrv9FYKuGDvS2suI7AQQA9DYDLCy8e3YW2LBtO3Y/ePhIex1+5tzF02cvSGuVU+GC7Vo15XAgAKAv3zZuUOyzIgIbtnL1z1rt8xUiP9qg/j1z5MjBEUEAQEen/4P79xTYsJu37uwNOaTVbv9506+xsXHSWpUv3wfdPNtwUBAA0Ium3zZ0LuoksGGr1m4Q9fzkrBUVFf1L4A6BDfu+T9dcuRw5LggAaJ+lpeXA/l4CG5aSkrJ63UZtd77MXaB3c7/Tn++FEQDQg2YeDYs6fSqwYXuCD9y8dUfbnR965PjlK+ECG+bVrb3MWQECAFnGyspyYL+eMtu2QruXf+V/TBtr64ljh3CAEADQshZNGzsVLiiwYQ8ePtq+63c9DMG6nzYnJiYJbNhXtaoJfCscCABkDWtrqwHf96Asmj3qtu0U+qb7CaN9BT4aBAQAskCXjq0/LVRAZttWrtmgn4FYseonmQ0r/GnBXl6dOFIIAGhNnvfeHTygt8y2hR45funyVf2Mxd6QQ9eu35DZtgF9e3yUPx/HCwEATRnm2/cdqfd6L/BboauxSElJ8fNfLbNtdnY5xo4axPFCAEA7SpUs3qFNM5lti7x5e+uO3XobkVVrN0h7TdhLHo0bVK9aiaOGAIBGTBo71MJC6KAvWrIyOTlZbyPy7Nlzyd96mzV1rL29HQcOAQDlNW5Yr8oX5WW27fnzmJVrN+hzXPz8V4t97kWhgp+MGtqfY4cAgNpsbW3HjBwotnmr1m6IiorW59Bcu35jZ9Besc3r6tnmi4ruHEEEABTWu0enggU+ltm2lJSURUtX6Xl0Fi5ZKbZtRqNxzvTxPCmaAICqPi1UwKev3Id87di1R+zdkKaxb3/ohYuXxDaviFOhYYO9OY4IAKjHaDTOmT7Ozk7uGdx8v+UM08Ilom+B7dmtQzn3MgwTAQDFdGrf8svKFcQ27+z5sAOHjjJM6zf8+vDRY7mVwsJi3ozxPB+CAIBKCnzy0ejhPpJbOH/RMobJYDDEx8cHrFgnuYWfORcZMbQfI0UAQBmzpo7NmdNBbPPu3r238ZdtDNMLfktXx8XFSW5hz24d6tSuxkgRAFBAu9bf1axeWXILZ8xdnJCYyEi9cP/Bw2Ur10tuodFoXDB7Uv58HzJYBABEy5/vw3GjBktu4Z9/3l8u9XGY5jJ7vn98QoLkFuZ5790lC6ZaWloyWAQA5Jo5ZbTwF3zPmrckPj6ekXrVnbt/rhH/PuTKlcoN6t+TwSIAIJRnh1Z1v6ouuYX37j8MkL3dYS4z5ixOSpL+TKQB3/eo9iXPiSMAII9LqRITxvgKb+Sc+UuFX/A0l8ibt//982bphcPCwm/u5Lzv52G8CAAI4uiYc9nimcLv137w8NHS5WsZrLcvAvzkPxj1ww/zLpz7o9iHy4IA0KPZ08YW/rSg8EbOme8fG8vp/1tdDY/YtHm7/HbWql5l1DCeFUoAQIYunVo3aVRfeCMfPnrM6f8/mjZ7UWpqqvx2evfs3LrFt4wXAQAzK+tSctwPg+W3c+7CgOfPYxivvxf2x5XAbUFKNHXGlNGVKvC8aAIA5pMrl2OA3wz5j2p5/OTpkoA1jFda/DhtntgXxbzKxtp6pf/sQgU/YcgIAJiB0WicP2vip4UKyG/q1BkLnj17zpClxYWLl9ZvCFSiqe/neW/digWSHzoCAkCzfhju86/6teW383pEJKf/6TL+x1nCvxj8UvFiRZcumMZNQQQATKpDm2bePTurEVTjpvHkn3S5eeuOnzrvSqv7VXXJrx0FAaA1tapXmTpplBJNPXrs1OZfdzJk6TV91qKn6rwtuVf3jt/37sKoEQDIdiWKOy9bPNPKSo3Hcg0b/SNDlgFPnkbNmL1IoQaPGubj2aEVA0cAIBt9kDfPv1cudHTMqURrN23ZfvTYKUYtYxYuWXXr9l2FGjx14ojm333DwBEAyBZ2djnWrlhQ4JOPlGhtQmLimAkzGLUMi4+PnzB5tkINNhqN82ZOUOLGBAIAirGyslwyf6pb2dKqNNhv6arrEZEMXGas+2nzxbDLas3SpYumC38fEQgAxVhaWvrNm/K1OudWj588nTZzIQOXSSkpKT+Mn6ZWm21tbFYHzKtY3o3hIwCQFaNlYbFw9qRvv2mgUJsnT5//5GkUY5d5u34L3r13v1pttrPLsX7VwnLuZRg+AgCZrf7zZk5o6tFQoTZfuHhpScBqxi6rDBo6VpXvhb2UK5fj5vUB7AURAMg4o9E4e9rYls0aK9Tm1NTU7weNkv9yK4WEX7sxe95S5Zptb2+3buXCxg3rMYIEADJS/WdMGd2mpYdazQ5YsY5bP7Pc9Nl+ETduKtdsG2tr/0XTO7RpxggSAEifqRNHKHfk3Lv3YDS3fmaDuLi4QcPGKVlrLCxmTh3D94QJAKSVlZXl3BnjVfxepe+ICVHqPMBALbt+C962Y7eijR81zGf0iAEMIgGAf+DgYL9uxQLldn4MBsPuPSGbtmxnBLM1X9V9p6Z3z85zZ4y3trZiHAkAvNkHefNs3bSyds2qyrU8NjbOx3cMI5itIm/enjJzgbrtb9PSI3DD8g/y5mEoCQC8zrlI4V2/ritT+nMVG//jtLkqXqVUzrwFAZevXlO3/RXLu+3dtcHd1YWhJADw/yqUd90RuEbRF+xduHhp3qJlDKIJJCQm+gwercSL498mf74Pt/6yknfKEwD4S8MGX21e7//eu7lVbHxycnLfASO48d9kQg4cXrpsrdIfwdbGZt7MCZPGDlXlqeYEALKF0Wjs591t+ZJZOXLkUPQjTJu16NiJMwylKY0cOyX82g3VP0X3Lu02/dv//TzvMaAEgB7lfifX2uXzRw7pp+4rVU+cOjtlxnyG0sRiY+O8+vqmpKSo/kG+rFwhOGhD9aqVGFMCQF/KupQMDtpYr04NpctQ916D2PwxiyNHT85ZEKCBD/JR/nyb/u0/aexQdRfBBADSp1O7FjsC1xQs8LHSn2LoyIlXwq8zmuYycfJstd4W8DZGo7F7l3b7gjYo9LoLAgAZYW9v5zdv8vTJP9ja2Cj9QXYG7V22aj0DakbxCQle3r6JiUna+DjORZ12Bq71HdCbK8MEgDY5F3XavW19M49Gqn+Q+w8e9uk/nAE1u9NnL0xV+athr7Gyshzs02vXr+ucizoxuASAdlhaWvbx8gz5bWPxYkU18HH69B9+/8FDhlWC6bMXnTx9TkufyLVMKe+enowsAaARxT4rsmPLmjEjB9ra2mrg4wSsWLczaC/DKkRSUnKPPr7qPiPof82cu8TbZwQjSwBoYUnbz7tbcNDGcm4a+e775Svhw374kZEV5dLlq98PHKWBD5KcnNx/8OjR46cp/VVnBeoSXWACJT8vNm/mBEWf7fNGz549b+vpraWTTc1Yv2FLpYpundq1UPcjxMTEdureb9dvwYwmKwC1WVtbDfbptWfHz1qq/gaDoWffIZcuX2V8ZRoyfMKpM+fVPbfwaNmF6k8AaMSHH7yvsUefz5jtF7gtiJEVKz4hoUOXvk+eRinX8qio6G9beB4+eoJBJAC0IDExqf/g0T6+YzTzLdk9wQfH/TiLkRXuRuStHn0Gq7WB/uRpVJPmnjxOigDQGv/laz1adn70+IkGykoXLx8NPHlGD3YG7Z05Z7EqrX30+Enjph01dhsrAYC/hBw4XLtBc6Xf4BEXF9fOs48GYkw/xk+eHXLgsBLn/t807Xjm3EWGjADQrOsRkfUbtT567JSi7e836AcOUbUkJyd38fK5e/ee5EY+fx7TrHXX8xf+YLwIAI179PjJN806bd/5u3It91u6at1PmxlB5dy7/7CtZ5+4OKE37MYnJLTp1It9fwJAL+Li4tp19lbr6Wl7gg8OH813vlR1/OSZrj0HCrxyk5yc3Ll7/+CQUMaIANDXwrzfwFETp8xRorVnz4e17+KtmSdN6tOv238bLuxr26mpqb37Ddu6YzejQwDo0eTp84eMnCj8Rr0bkbeatu767Nlzxkt1Cxav8Fu6Sk57RoyezKYiAaBrCxev8PYZIfauykePnzRt1fXevQeMlDYMGTlxx649Elqy2H/1vEXLGBECQO9Wrd3QxWuAwA2WuLi4lu29lL5vFa9JSUnp7OVj9qdE7Ni1Z8jIiQwHAQCDwWDYtGV7u8594uPj5TQpOTm5s9cAde9YxdvExMS2aNfj5q075mrAqTPnO3v5JCfz+mgCAP+xM2hv87Y95Dxcc+DQcdu4OqdR9+49aNamW1RUtOl/deTN2y3a9YiJiWUUCAD8l337Q1u0E5EBU2cuCFixjhHRsLA/rrRo52XiQhwd/ax52+5cUiIA8GYhBw43a9PNvOdH/svXjv9xNmOheaFHjjdv291kJxypqandeg8K++MKPU8A4K0OHDrarE23589jzPLbly5bO2DIWEZBP5OtZXsv03xJeMLkOUJuQAIBINrB0GNNW5shA5YErBkwZAxv4NOVfftDW3fsld03IGzZumvarIX0NgGAtC7Pm7Y26V6Q39JVA4dy7q9He4IPtunYOz4hIZt+/oWLl7y8fTmxIACQvgxo3bGnae4NXbh4xeDh4+lz3dq9d387zz4JiYlZ/pMfP3naumMvbvsRi5fCyxUcEtqus/fqgHnZ+kbJBYtXDOVbOboXtHtfhy59VyyZnYWTLTU1tXvvQRE3bmb4J9zxjfj7v5B/UiHGjgDQ8mHZuUf/AL8ZlpaW2fHz5/stHzZqEv0Mg8GwY9eeTt2+9/ebYWNtnSU/cNbcJUG792V50X/bXyYMMoAtIOkCtwV5eQ/JjucFzVngT/XHq7bu2P1dyy5Z8h2xQ4ePj5+cjndH3/GNePG/zCwXMvkTCABI9NPGQJ/Bo7PwB6ampo4cM2XkmCn0LV6z/+CRBk3a3rn7Z2Z+yIOHjzr38ElKStPzHrK8ahMDBIDWLFu1fuykmVnyo+ITEjr38JmzwJ9exRtduHipzr9aZvhLW6mpqT16D05LhGRrpSYGCABNmT5r0cLFKzL5Qx4/edqkmeemLdvpT/yNW7fv1v+m9cHQYxn4t7Pn++/eu19IdSYGCADtGDpq0voNWzL8z69HRNZr2Cr0yHF6Ev/oaVS0R4vOm3/dma5/de582IQfZ/1jUTbxZyEDCAAtSE1N7fX90AzcWWEwGE6cOlu3YSue74+0i09I8Ozef9GSlWn/+937DP777xOYqxaTAQSAFiQlJXfo2vfEqbPp+lfbd/7e0KP9/QcP6UCkS0pKiu+ICSPHTEnLfWjjJs68cPHS35Rg81ZhtoMIAC2IjY1r1d4r8ubtNP79JQFr2nr2kfOyAShnzgL/pq27Pnz0+G/+zsHQY/P9lss/AScDCADl3bv/sHnb7v94v3ZcXFzvfsMGDh0r9rXDUMWe4IPV63gcO3Hmjf81JibWy9v3bdNMWs0lAwgA5YX9caV9F++/eZlw+LUbdRq2Wr1uI32FLHHr9t1/NWm7dNna//1PE6fMuRF5S6FqSwYQAMoLDgn18f3hjf/p1+2/1aj33bnzYfQSslBCYuKAIWO69Rr06o7iufNhC5esoHMIAJjayjUb/Jf/1xlZUlLyiNGT23n2iY5+Rv8gO/y0MbD2182vhF83GAwpKSn9Bo1625d+JZ9oswggALRgyIiJR4+devH/79691+i7DnMXBtAtyFYXwy7Xqt8scFuQ//J1b7swIL/CkgE8DVQLq/L2XfsG79wQdulKF68B3OsJ04iOfta+s7etjY3StfWOb4SeHyNKAGjB3bv36n3TOvLm7eTkZHoDppR9rxKDCbAFpBHXIyKp/pBzWk1rCQAAAAEAgNN/2kwAAAAIAACc/tNyAgAAQAC8VGVQKCMEQGmS65jZAuDA5ErMDEBLVN9FMWP7zVUP2QICAJ0iAACAAAAAEAAAkC7auI1SbzeDEgAAwApAJO4EBaAu4RXMnAHAnaAAYMZKyBYQAOgUAQAABIBUXAYAoCL5tYsVAACwAjAHrgMD0DPz1kBWAADACkAwLgMAUIsSVYsVAIAskH9SIT4FK4B04zIAAH0ye/VTZgXALhAA6pVOAwAAoMEAYBcI0ADVN9BN3H4JdU+lFQC7QACoVDoNAACABgMgjashFgGAZOruAmVVy9NYo4Tse7MCAABWAIosAgCwCFC6zXJqnXorAHaBAFCddBoAADih1vmSRZsBwKVgANo+/Re1180KAIB+T6v1fPovMQBYBABkgHItVPH0X+0VABkAkAEKVX9WAFm5CAAAhQisbGpfA2ARALAI4PRfawHAIgAgA7TUHpk1Tfm7gFgEAGSAuVqiev0x5s5XXAPFnRUDoIQ7vhGaCSENFCi+BwBA+0sBnd/vr2QApD022QgCyABT/kZt7E+I3gLSUkcDeI0JtoOyKWw0U5Q0tQXEOgBQaymQfauB7PvhWqozCgQA5/UAMSAkVzRWu6w0NpmqDAolMAAVY+DF/8nwvpBpir7GthkUuAaQgX4nAwAN+McwMPGZvvaqkDIBQAYAoP5kLZUuAqerT7kgDIDqr50AyNYxAwC9VRLFAoCNHQDUKP2uANgIAiDz9F+5M1Qlt4DIAABU/8yz0s8osn0EgBNH5VcAGavmLAUAZFOtUPT8UuG7gMgAAFR/nQYAGQCA6q/fACADAFD9M0ylR0FkeU3nsjAAPRcQjXwTOGMjwVIAgJ5PH7XzKAgyAADVP100sgWU+YLOdhBA6ddbrdDaw+AyPDYsBQCqv97OFLW2Ash8NWcpAFD6dVIctBkAmT+jJwYAaoLma4Jm3weQydFiRwig+mv+jFCzKwAGHgAVQO8BkCWn88QAwIFPAOh3KpAEAAc7AcDMIAYADnACQMdThCQAOKgJAL1PF5IA4EAmAJg9hAHAYUsAMJ8IA4CDlABgejHhAA5GAoCZB0AKzsMIAGIAoPQTACAGAEo/AQBiAKD0EwAgBgBKPwFAEpAEAHWfACAGAFD6CQCSAAB1nwAgCQBQ9wkAwgAARZ8AIA8AUPEJAJAKALWeAAAAmJ0FXQAABAAAgAAAABAAAAACAABAAAAACAAAAAEAACAAAAAEAACAAAAAEAAAAAIAAEAAAAAIAAAAAQAAIAAAAAQAAIAAAAAQAAAAAgAAQAAAAAgAAAABAAAEAACAAAAAEAAAAAIAAEAAAAAIAAAAAQAAIAAAAAQAAIAAAAAQAAAAAgAAQAAAAAgAAEC2+z+sY9WvD3ftJwAAAABJRU5ErkJggg=="
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGRpdiBpZD0iYmtTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2PgogPGRpdiBpZD0iZGF0YVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+CjwvZGl2PgoKPGRpdiBjbGFzcz0idGFicyIgaWQ9InRhYnMiPgogPGJ1dHRvbiBkYXRhLXRhYj0idkF4aXMiIGNsYXNzPSJvbiI+6LaF6YmE5p2/PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2RXYiPuacn+W+heWApDwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlVwc2V0Ij7ms6LkubHluqY8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZIb2xlIj7nqbTppqw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZSYWNlcyI+5YWo44Os44O844K5PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U3VtIj7lj5bjgorovrzjgb/nirbms4E8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZUZXN0Ij7mpJzoqLw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZTZXQiPuioreWumjwvYnV0dG9uPgo8L2Rpdj4KCjxkaXYgaWQ9ImdhdGUiPjwvZGl2PgoKPGRpdiBpZD0idkF4aXMiIGNsYXNzPSJ2aWV3IG9uIGNhcmQiPjxkaXYgY2xhc3M9InNtYWxsIj7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgII8L2Rpdj48L2Rpdj4KPGRpdiBpZD0idkV2IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlVwc2V0IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idkhvbGUiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2UmFjZXMiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2U3VtIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KCjxkaXYgaWQ9InZUZXN0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7lm57lj47njofjga7mpJzoqLzvvIjmiZXmiLvjgaTjgY3jg7vmmYLns7vliJfvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruaIkOe4vuOBqOaJleaIu+OBp+OAgeOAjOOBneOBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBoOOBkeOAjeOCkuS9v+OBhuODkOODg+OCr+ODhuOCueODiOOCkuOBl+OBvuOBme+8iOWQhOODrOODvOOCuTEwMOWGhu+8ieOAguOBk+OBk+OBpzxiPuWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBruWbnuWPjueOh+OBjDEwMCXjgpLotoXjgYjjgIHoqqTlt67jga7luYXjgpLlvJXjgYTjgabjgoIxMDAl5Lul5LiKPC9iPuOBqOeiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBoOOBkeOBjOOAgeeUu+mdouS4iuOBp+OAjOaknOiovOa4iOOBv+OAjeOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJidEdyYWRlIiBjbGFzcz0ic3ViIj7ph43os57jgaDjgZHvvJrjgrDjg6zjg7zjg4noo5zmraPjgYLjgoov44Gq44GX44KS5q+U6LyDPC9idXR0b24+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5rOi5Lmx5bqm44Gu5L+h6aC85bqm44KS5LiK44GS44KL77yI5YaN5qCh5q2j77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7pgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgavlho3nj77jgZfjgIHms6LkubHluqbjga7kuojmuKzjgajlrp/pmpvjga7ms6LkubHnjofjgpLnqoHjgY3lkIjjgo/jgZvjgb7jgZnjgILjgrPjg7zjgrnliKXvvIjplovlgqzloLTDl+iKneODgMOX6Led6Zuiw5fjgq/jg6njgrnvvInjga7pgY7ljrvms6LkubHnjofjgpLotrPjgZfjgZ/mlrDjg6Ljg4fjg6vjgpLkvZzjgorjgIE8Yj7nj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpM8L2I+44Gn5q+U44G544Gm44CB5piO56K644Gr6Imv44GE44Go44GN44Gg44GR5o6h55So44GX44G+44GZ44CC6Imv44GP44Gq44KJ44Gq44GR44KM44Gw54++6KGM44Gu44G+44G+44Gn44CB562J57Sa44GU44Go44Gu5a6f57i+546H44Gg44GR44KS5qSc6Ki844GX44Gf5pWw5a2X44Gr5beu44GX5pu/44GI44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPuaknOiovOOBrumWi+Wni+aXpSA8aW5wdXQgaWQ9InVwU3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIxLTAxLTAxIj48YnV0dG9uIGlkPSJ1cFJ1biI+5rOi5Lmx5bqm44KS5qSc6Ki844O75YaN5qCh5q2jPC9idXR0b24+PGJ1dHRvbiBpZD0idXBDbGVhciIgY2xhc3M9InN1YiI+5qiZ5rqW44Gr5oi744GZPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJ1cE91dCIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGM77yI6YGO5Y6744Os44O844K544Gu5Y+W5b6X5b6M44Gr5a6f6KGM44CC5pWw5YiG44GL44GL44KK44G+44GZ77yJPC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5aW96LWw546H77yI6KSH5Yud5ZyP5YaF546H77yJ44KS5q2j56K644Gr44GZ44KL77yI5YaN5qCh5q2j77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lkITppqzjga7jgIwz552A5Lul5YaF44Gr5YWl44KL56K6546HKCUp44CN44KS44CB5a6f6Zqb44Gu55qE5Lit546H44Gr5ZCI44KP44Gb44G+44GZ44CC6YGO5Y675oiQ57i+44GL44KJ5L2c44KL56K6546H44Go44CB5Lq65rCX6aCG5L2Nw5fpoK3mlbDjgZTjgajjga7pgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H44KS57WE44G/5ZCI44KP44Gb44Gf5paw44Oi44OH44Or44KS5L2c44KK44CBPGI+54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaTPC9iPuOBp+OAgeWun+mam+OBrueahOS4reeOh+OBqOeqgeOBjeWQiOOCj+OBm+OBvuOBmeOAguaYjueiuuOBq+iJr+OBhOOBqOOBjeOBoOOBkeaOoeeUqOOBl+OAgei2hemJhOadv++8iDk1JeS7peS4iu+8ieOBruWfuua6luOCguOBk+OBruacn+mWk+OBruWun+e4vuOBi+OCieaxuuOCgeOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7mpJzoqLzjga7plovlp4vml6UgPGlucHV0IGlkPSJwbFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAxOS0wMS0wMSI+PGJ1dHRvbiBpZD0icGxSdW4iPuWlvei1sOeOh+OCkuaknOiovOODu+WGjeagoeatozwvYnV0dG9uPjxidXR0b24gaWQ9InBsQ2xlYXIiIGNsYXNzPSJzdWIiPuaomea6luOBq+aIu+OBmTwvYnV0dG9uPjwvZGl2PgogPGRpdiBpZD0icGxPdXQiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjO+8iOmBjuWOu+ODrOODvOOCueOBruWPluW+l+W+jOOBq+Wun+ihjOOAguaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iTwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJwYXlFeHAiIGNsYXNzPSJzdWIiPuaJleaIu+OCkuabuOOBjeWHuuOBlzwvYnV0dG9uPjxsYWJlbCBjbGFzcz0ic21hbGwiPuiqreOBv+i+vOOBvyA8aW5wdXQgaWQ9InBheUltcCIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiI+PC9sYWJlbD48L2Rpdj4KIDxkaXYgaWQ9ImJ0T3V0IiBjbGFzcz0ic3RhdHVzIj7jg4fjg7zjgr/lj5blvpfjga7jgYLjgajjgaflrp/ooYzjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPC9kaXY+Cgo8ZGl2IGlkPSJ2U2V0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7jg5Djg4Pjgq/jgqLjg4Pjg5foqK3lrprvvIhDbG91ZGZsYXJl44Gr5L+d5a2Y77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7jg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU244Gg44GR44KS5L2/44Gj44Gm5L+d5a2Y5YWI44KS5YiG44GR44G+44GZ77yI44OR44K544OV44Os44O844K66Ieq5L2T44Gv6YCB44KK44G+44Gb44KT77yJ44CC5ZCM44GY44OR44K544OV44Os44O844K644Gn5b6p5YWD44Gn44GN44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0iYmtQYXNzIiB0eXBlPSJwYXNzd29yZCIgcGxhY2Vob2xkZXI9IuODkeOCueODleODrOODvOOCuu+8iDjmloflrZfku6XkuIrvvIkiIGF1dG9jb21wbGV0ZT0ib2ZmIiBzdHlsZT0iZmxleDoxO21pbi13aWR0aDoyMDBweCI+PGJ1dHRvbiBpZD0iYmtTaG93IiBjbGFzcz0ic3ViIj7ooajnpLo8L2J1dHRvbj48L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyBzbWFsbCI+PGxhYmVsPjxpbnB1dCBpZD0iYmtBdXRvIiB0eXBlPSJjaGVja2JveCIgY2hlY2tlZD4g5aSJ5pu044GM44GC44KM44Gw6Ieq5YuV44Gn44OQ44OD44Kv44Ki44OD44OX44GZ44KLPC9sYWJlbD48L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iYmtOb3ciPuS7iuOBmeOBkOW3ruWIhuODkOODg+OCr+OCouODg+ODlzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrUmVzdG9yZSIgY2xhc3M9InN1YiI+44OQ44OD44Kv44Ki44OD44OX44GL44KJ5b6p5YWDPC9idXR0b24+PGJ1dHRvbiBpZD0iYmtGdWxsIiBjbGFzcz0ic3ViIj7jgZnjgbnjgabkv53lrZjjgZfnm7TjgZk8L2J1dHRvbj48L2Rpdj4KIDxoMiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij7pgY7ljrvjg4fjg7zjgr/jga7oqq3jgb/ovrzjgb/vvIjku7vmhI/vvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuS7peWJjeOBruODkOODg+OCr+OCouODg+ODl0pTT07vvI/miJDnuL5DU1bjgYzjgYLjgozjgbDoqq3jgb/ovrzjgoHjgb7jgZnvvIjlkIzjgZjml6Xjga/ph43opIfjgZfjgb7jgZvjgpPvvInjgII8L2Rpdj4KIDxpbnB1dCBpZD0iZmlsZSIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiwuY3N2LGFwcGxpY2F0aW9uL2pzb24sdGV4dC9jc3YiPgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuiouuaWrTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Ye66aas6KGo44Gu6Kqt44G/5Y+W44KK44Gr5ZWP6aGM44GM44GC44KL44Go44GN44CB6ZaL5YKs5aC044GU44Go44GrMVLjga7jg5rjg7zjgrjjga7kuK3ouqvjgpLoqr/jgbnjgabkuIvjgavlh7rjgZfjgb7jgZnjgILjgrPjg5Tjg7zjgZfjgabpgIHjgaPjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iZGJnR28iIGNsYXNzPSJzdWIiPuiouuaWreaDheWgseOCkuS9nOOCizwvYnV0dG9uPjxidXR0b24gaWQ9ImRiZ0NvcHkiIGNsYXNzPSJzdWIiPuOCs+ODlOODvDwvYnV0dG9uPjwvZGl2PgogPHRleHRhcmVhIGlkPSJkYmdPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxNDBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KIDxoMiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij7jgqrjg4Pjgrrjga7oqLrmlq08L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBjOWPluOCjOOBquOBhOODrOODvOOCueOBjOOBguOCi+OBqOOBjeOAgeOAjEpSQeOBjOOBvuOBoOeZuuWjsuOBl+OBpuOBhOOBquOBhOOAjeOBruOBi+OAjOWPluW+l+OBruWVj+mhjOOAjeOBquOBruOBi+OCkuiqv+OBueOBvuOBmeOAguWFiOOBq+OAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZfjgabjgYvjgonjgIHmirzjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ib2Rkc0RiZyIgY2xhc3M9InN1YiI+44Kq44OD44K644Gu6Ki65pat44KS5L2c44KLPC9idXR0b24+PGJ1dHRvbiBpZD0ib2Rkc0NvcHkiIGNsYXNzPSJzdWIiPuOCs+ODlOODvDwvYnV0dG9uPjwvZGl2PgogPHRleHRhcmVhIGlkPSJvZGRzT3V0IiByZWFkb25seSBzdHlsZT0id2lkdGg6MTAwJTtoZWlnaHQ6MTYwcHg7Zm9udC1zaXplOjEycHgiPjwvdGV4dGFyZWE+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GXPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfmuIjjgb/jga7jg6zjg7zjgrnjgpLjgIHjg6zjg7zjgrnlhajkvZPjga7jg6njg4Pjg5fvvIjjg4/jg63jg7Pjgr/jgqTjg6DvvInjgajlkITppqzjga7jgrPjg7zjg4rjg7zpgJrpgY7poIbkvY3jgaTjgY3jgaflj5bjgornm7TjgZfjgb7jgZnvvIjjg5rjg7zjgrnjg7vohJros6rjgpLkuojmg7Pjgavkvb/jgYbjgZ/jgoHjga7mupblgpnvvInjgILkv53lrZjmuIjjgb/jga7ml6Xjga/kuIrmm7jjgY3jgZXjgozjgb7jgZnjgILmraLjgoHjgabjgoLntprjgY3jgYvjgonlho3plovjgafjgY3jgb7jgZnjgILjgb7jgZrmlrDjgZfjgYTmnJ/plpPjgYvjgonlsJHjgZfjgaDjgZHoqabjgZfjgabjgIHoqq3jgoHjgabjgYTjgovjgYvjgpLnorroqo3jgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+6ZaL5aeL5pelIDxpbnB1dCBpZD0ibGFwU3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDI2LTAxLTAxIj48YnV0dG9uIGlkPSJsYXBHbyI+5Y+W44KK55u044GZPC9idXR0b24+PGJ1dHRvbiBpZD0ibGFwRGJnIiBjbGFzcz0ic3ViIj7oqq3jgb/lj5bjgorjga7oqLrmlq08L2J1dHRvbj48L2Rpdj4KIDxkaXYgaWQ9ImxhcFN0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8dGV4dGFyZWEgaWQ9ImxhcE91dCIgcmVhZG9ubHkgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjEyMHB4O2ZvbnQtc2l6ZToxMnB4Ij48L3RleHRhcmVhPgo8L2Rpdj4KCjwvbWFpbj4KPGRpdiBpZD0iYnVzeSI+PGRpdj48ZGl2IGlkPSJidXN5VGV4dCI+5Yem55CG5Lit4oCmPC9kaXY+PC9kaXY+PC9kaXY+CjxzY3JpcHQ+CmNvbnN0IFVFPSgoKT0+ewogLyog5a6f44OH44O844K/5qSc6Ki844Gn6YCG5Yq55p6c44Gg44Gj44Gf5oiQ5YiG77yI6aiO5omL44O76ZaT6ZqU77yJ44Gv5pei5a6a44GnT0ZGICovCiBjb25zdCBERUZBVUxUPXtqb2NrZXk6ZmFsc2UsbGF5b2ZmOmZhbHNlfTsKIGNvbnN0IGNsYW1wPSh4LGEsYik9Pk1hdGgubWF4KGEsTWF0aC5taW4oYix4KSk7CiBjb25zdCBzaWdtb2lkPXg9PjEvKDErTWF0aC5leHAoLXgpKTsKIGNvbnN0IGxvZ2l0PXA9PntwPWNsYW1wKHAsLjAwMSwuOTk5KTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwogY29uc3Qgbm49cz0+U3RyaW5nKHM/PyIiKS5ub3JtYWxpemUoIk5GS0MiKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1tcc1x1MzAwMF0rL2csIiIpLnJlcGxhY2UoL1vjg7vvvaUu77yOXC3igJDigJHigJLigJPigJTigJUn4oCZYF0vZywiIikucmVwbGFjZSgvW+KYhuKYheKWs+KWsuKXh+KXhl0vZywiIik7CiAvKiDpqI7miYvlkI3vvJrlhYjpoK3jga7mrKflrZfjgqTjg4vjgrfjg6Pjg6vjgpLpmaTjgY3jgIHjg4fjg6Djg7zjg63ihpLjg4fjg6Ag44Gr5o+D44GI44KL77yISlJB44GuIEMu44OH44Og44O844OtIOOBqOmBjuWOu+ODh+ODvOOCv+OBriDvvKPvvI7jg4fjg6Ag44KS5LiA6Ie044GV44Gb44KL77yJICovCiBjb25zdCBqbm49cz0+e2xldCB2PW5uKFN0cmluZyhzPz8iIikucmVwbGFjZSgvXGR7Mn0oPzpcLlxkKT9ccyooPzprZ3zvvYvvvYcpL2dpLCIgIikucmVwbGFjZSgvW++8iChdW17vvIkpXXswLDh9W++8iSldL2csIiAiKS5yZXBsYWNlKC8o5qCX5p2xfOe+jua1pikvZywiICIpKTt2PXYucmVwbGFjZSgvXlthLXpdKD89W+OCoS3jg7bjg7xdKS8sIiIpO3Y9di5yZXBsYWNlKC9e44OH44Og44O844OtLywi44OH44OgIik7cmV0dXJuIHZ9OwogLyog44Kv44Op44K544Gu5q616ZqO77yaMD3kuI3mmI4gLyAtMT3lnLDmlrkgLyAxPeaWsOmmrOODu+acquWLneWIqSAvIDI9MeWLnSAvIDM9MuWLnSAvIDQ9M+WLnSAvIDU944Kq44O844OX44Oz44O76YeN6LOeICovCiBjb25zdCBsZXZlbE9mTGFiZWw9dD0+e2NvbnN0IHM9U3RyaW5nKHR8fCIiKTtpZigv5Zyw5pa5fE5BUi8udGVzdChzKSlyZXR1cm4gLTE7aWYoL+aWsOmmrHzmnKrli53liKkvLnRlc3QocykpcmV0dXJuIDE7aWYoLzHli518NTAw5LiHLy50ZXN0KHMpKXJldHVybiAyO2lmKC8y5YudfDEwMDDkuIcvLnRlc3QocykpcmV0dXJuIDM7aWYoLzPli518MTYwMOS4hy8udGVzdChzKSlyZXR1cm4gNDtpZigv44Kq44O844OX44OzfO+8r++8sHxPUHzjg6rjgrnjg4bjg4Pjg4l86YeN6LOefO+8p3xHWzEyM0ldL2kudGVzdChzKSlyZXR1cm4gNTtyZXR1cm4gMH07CiBjb25zdCBsZXZlbE9mUHJpemU9cD0+e3A9TnVtYmVyKHApO3JldHVybiAhKHA+MCk/MDpwPD03MDA/MTpwPD05MDA/MjpwPD0xMzAwPzM6cDw9MTgwMD80OjV9OwogLyog4piF44Kw44Os44O844OJ77yI5qC877yJ77yaMD3kuI3mmI4v5LiL57SaIDE9T1Djg7vjg6rjgrnjg4bjg4Pjg4kgMj1HMyAzPUcyIDQ9RzHjgIIKICAgIOW+k+adpeOBryBHMS9HMi9HMy9PUCDjgpLjgZnjgbnjgabjgIw144CN44Gr5r2w44GX44Gm44GE44Gf44Gf44KB44CBRzPli53jgaHjgYwgRzEg44Gn44KC5Ymy5byV44GV44KM44Gq44GL44Gj44Gf44CCCiAgICDliKTlrprpoIbvvJrjg6njg5njg6vvvIhORktD5b6MIEdJL0dJSS9HSUlJL0cx44CcRzPvvInihpIgMeedgOiznumHke+8iOS4h+WGhu+8ieKGku+8iOWvvuixoeODrOODvOOCueOBruOBv++8iUcx44Os44O844K55ZCNICovCiBjb25zdCBHMV9OQU1FUz0v5aSp55qH6LOefOaciemmrOiomOW/tXzjgrjjg6Pjg5Hjg7Pjgqvjg4Pjg5d844K444Oj44OR44Oz77yjfOWuneWhmuiomOW/tXzlronnlLDoqJjlv7V844O044Kj44Kv44OI44Oq44Ki44Oe44Kk44OrfOWkp+mYquadr3zpq5jmnb7lrq7oqJjlv7V844OV44Kn44OW44Op44Oq44O8fOODgeODo+ODs+ODlOOCquODs+OCunzjgrnjg5fjg6rjg7Pjgr/jg7zjgrp844Oe44Kk44Or44OB44Oj44Oz44OU44Kq44Oz44K344OD44OXfOOCqOODquOCtuODmeOCueWls+eOi+adr3znp4voj6/os5586I+K6Iqx6LOefOahnOiKseiznnzjgqrjg7zjgq/jgrl85YSq6ae/54md6aasfOaXpeacrOODgOODvOODk+ODvHzmnbHkuqzlhKrpp79855qQ5pyI6LOefE5IS+ODnuOCpOODq3zpmKrnpZ7jgrjjg6Xjg5njg4rjgqTjg6t85pyd5pel5p2vfOODm+ODvOODl+ODleODqy87CiBjb25zdCBncmFkZVRpZXI9KHRleHQscHJpemUsYnlOYW1lKT0+e2NvbnN0IHM9U3RyaW5nKHRleHR8fCIiKS5ub3JtYWxpemUoIk5GS0MiKTsKICBpZigv6Zqc5a6zfOOCuOODo+ODs+ODl3xKXC4/XHM/Ry9pLnRlc3QocykpcmV0dXJuIDA7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJSUl8MykoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDI7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJSXwyKSg/IVtBLVphLXowLTldKS8udGVzdChzKSlyZXR1cm4gMzsKICBpZigvKD86XnxbXkEtWmEtel0pRyg/Okl8MSkoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDQ7CiAgY29uc3QgcD1OdW1iZXIocHJpemUpO2lmKHA+MClyZXR1cm4gcD49MTAwMDA/NDpwPj01MDAwPzM6cD49MzUwMD8yOnA+PTE4MDA/MTowOwogIGlmKGJ5TmFtZSYmRzFfTkFNRVMudGVzdChzKSlyZXR1cm4gNDsKICBpZigv44Oq44K544OG44OD44OJfOOCquODvOODl+ODs3zvvK/vvLB8XGJPUFxiLy50ZXN0KHMpKXJldHVybiAxOwogIHJldHVybiAwfTsKIGNvbnN0IGlzSnJhVmVudWU9Yz0+L14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKGN8fCIiKSk7CiBjb25zdCBzdXJmQ29kZT1zPT57cz1TdHJpbmcoc3x8IiIpO3JldHVybiAv6IqdfHR1cmYvaS50ZXN0KHMpPzE6L+ODgHxkaXJ0L2kudGVzdChzKT8yOi/pmpx8anVtcC9pLnRlc3Qocyk/MzowfTsKIGNvbnN0IGRudW09ZD0+TnVtYmVyKFN0cmluZyhkfHwiIikucmVwbGFjZSgvXEQvZywiIikuc2xpY2UoMCw4KSl8fDA7CiBmdW5jdGlvbiBwYXJzZURhdGUocyl7CiAgcz1TdHJpbmcoc3x8IiIpO2xldCBtPXMubWF0Y2goLyhcZHs0fSlcRHswLDR9KFxkezEsMn0pXER7MCw0fShcZHsxLDJ9KS8pOwogIGlmKCFtKXJldHVybiIiO3JldHVybiBgJHttWzFdfS0ke21bMl0ucGFkU3RhcnQoMiwiMCIpfS0ke21bM10ucGFkU3RhcnQoMiwiMCIpfWA7CiB9CiBmdW5jdGlvbiBjc3ZSb3dzKHRleHQpewogIGNvbnN0IGxpbmVzPVN0cmluZyh0ZXh0fHwiIikucmVwbGFjZSgvXlx1RkVGRi8sIiIpLnNwbGl0KC9ccj9cbi8pLmZpbHRlcih4PT54LnRyaW0oKSk7CiAgaWYoIWxpbmVzLmxlbmd0aClyZXR1cm5bXTsKICBjb25zdCBzcGxpdD1sPT57Y29uc3QgYT1bXTtsZXQgYz0iIixxPWZhbHNlO2ZvcihsZXQgaT0wO2k8bC5sZW5ndGg7aSsrKXtjb25zdCBjaD1sW2ldOwogICBpZihjaD09PSciJyl7aWYocSYmbFtpKzFdPT09JyInKXtjKz0nIic7aSsrfWVsc2UgcT0hcX1lbHNlIGlmKGNoPT09IiwiJiYhcSl7YS5wdXNoKGMpO2M9IiJ9ZWxzZSBjKz1jaH1hLnB1c2goYyk7cmV0dXJuIGF9OwogIGNvbnN0IGhlYWQ9c3BsaXQobGluZXNbMF0pLm1hcCh4PT54LnRyaW0oKSk7Y29uc3Qgb3V0PVtdOwogIGZvcihsZXQgaT0xO2k8bGluZXMubGVuZ3RoO2krKyl7Y29uc3QgYT1zcGxpdChsaW5lc1tpXSksbz17fTtmb3IobGV0IGo9MDtqPGhlYWQubGVuZ3RoO2orKylvW2hlYWRbal1dPWFbal0/PyIiO291dC5wdXNoKG8pfQogIHJldHVybiBvdXQ7CiB9CiBjb25zdCBmPXY9Pntjb25zdCBuPXBhcnNlRmxvYXQoU3RyaW5nKHY/PyIiKS5yZXBsYWNlKC8sL2csIiIpKTtyZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pP246bnVsbH07CiAvKiDjg5Djg4Pjgq/jgqLjg4Pjg5cvQ1NW44GuMeihjOKGkui7vemHj+ihjCAqLwogY29uc3QgY2xlYW5Ucj10PT5TdHJpbmcodHx8IiIpLnJlcGxhY2UoL1xzKy9nLCIgIikudHJpbSgpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw2fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKD865qCX5p2xfOe+jua1pnzlnLDmlrl85aSW5Zu9fOaLm+W+hSlccypb44O7772lXT8vZywiICIpLnJlcGxhY2UoL1vjg7vvvaVdL2csIiAiKS5yZXBsYWNlKC9ccysvZywiICIpLnRyaW0oKTsKIGZ1bmN0aW9uIHRvUm93KG8pe2NvbnN0IF9yPXRvUm93MChvKTtfci50cmFpbmVyPWNsZWFuVHIob1si6Kq/5pWZ5birIl18fG8udHJhaW5lcnx8IiIpO19yLmdyZD1ncmFkZVRpZXIoU3RyaW5nKG9bImNsYXNzIl18fG8uY2xzfHwiIikrIiAiK1N0cmluZyhvWyLjg6zjg7zjgrnlkI0iXXx8by5yYWNlX25hbWV8fG8ucmFjZW5hbWV8fCIiKSxudWxsLGZhbHNlKTtyZXR1cm4gX3J9CiBmdW5jdGlvbiB0b1JvdzAobyl7CiAgY29uc3Qgc2E9U3RyaW5nKG9bIuaAp+m9oiJdfHwiIik7Y29uc3QgYW09c2EubWF0Y2goLyhcZCspLyk7CiAgcmV0dXJue3JhY2VJZDpTdHJpbmcob1siIl0/P28ucmFjZV9pZD8/b1siVW5uYW1lZDogMCJdPz8iIiksZGF0ZTpwYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSksCiAgIG5hbWU6U3RyaW5nKG9bIummrOWQjSJdfHxvLmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOm5uKG9bIummrOWQjSJdfHxvLmhvcnNlKSxqb2NrZXk6am5uKG9bIumojuaJiyJdfHxvLmpvY2tleSksam5hbWU6U3RyaW5nKG9bIumojuaJiyJdfHxvLmpvY2tleXx8IiIpLnRyaW0oKSxmaW5pc2g6ZihvWyLnnYDpoIYiXT8/by5maW5pc2gpLAogICBkaXN0OmYoby5jb3Vyc2VfbGVuPz9vWyLot53pm6IiXT8/by5kaXN0YW5jZSl8fDAsc3VyZjpzdXJmQ29kZShvLnJhY2VfdHlwZXx8b1si6Iqd44OAIl18fG8uc3VyZmFjZSksCiAgIGFnZTphbT9OdW1iZXIoYW1bMV0pOm51bGwsbnVtOmYob1si6aas55WqIl0pLHBvcDpmKG9bIuS6uuawlyJdKSxvZGRzOmYob1si5Y2Y5YudIl0pLAogICBsdmw6KCgpPT57Y29uc3QgaWQ9U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/PyIiKTtpZigvXlxkezEyfSQvLnRlc3QoaWQpJiYhaXNKcmFWZW51ZShpZC5zbGljZSg0LDYpKSlyZXR1cm4gLTE7cmV0dXJuIGxldmVsT2ZMYWJlbChvWyJjbGFzcyJdfHxvLmNscyl9KSgpfTsKIH0KIC8qIOaIkOe4vuOCueODiOOCou+8iOaXpeS7mOaYh+mghuOBqyBhZGQg44GZ44KL77yJICovCiBmdW5jdGlvbiBTdG9yZSgpe3RoaXMuaD1uZXcgTWFwKCk7dGhpcy5qPW5ldyBNYXAoKX0KIFN0b3JlLnByb3RvdHlwZS5hZGQ9ZnVuY3Rpb24ocil7CiAgaWYoci5maW5pc2g9PW51bGx8fCFyLmhvcnNlKXJldHVybjsKICBjb25zdCB0Mz1yLmZpbmlzaD49MSYmci5maW5pc2g8PTM/MTowOwogIGxldCBoPXRoaXMuaC5nZXQoci5ob3JzZSk7aWYoIWgpdGhpcy5oLnNldChyLmhvcnNlLGg9e246MCx0b3AzOjAsd2luOjAsc3VtOjAsbGFzdDoiIixydW5zOltdLGx2Ont9fSk7CiAgaC5uKys7aC50b3AzKz10MztpZihyLmZpbmlzaD09PTEpaC53aW4rKztoLnN1bSs9ci5maW5pc2g7aWYoci5kYXRlPmgubGFzdCloLmxhc3Q9ci5kYXRlOwogIGNvbnN0IEw9ci5sdmx8fDA7KGgubHZbTF09aC5sdltMXXx8WzAsMF0pO2gubHZbTF1bMF0rKztoLmx2W0xdWzFdKz10MzsKICBoLnJ1bnMucHVzaChbZG51bShyLmRhdGUpLHIuZmluaXNoLHIuZGlzdCxyLnN1cmYsTCxyLmdyZHx8MCxyLmNmPT1udWxsPy0xOnIuY2ZdKTtpZihoLnJ1bnMubGVuZ3RoPjYpe2gucnVucy5zb3J0KChhLGIpPT5hWzBdLWJbMF0pO2gucnVucy5zaGlmdCgpfQogIGlmKHIuam9ja2V5KXtsZXQgaj10aGlzLmouZ2V0KHIuam9ja2V5KTtpZighail0aGlzLmouc2V0KHIuam9ja2V5LGo9e246MCx0b3AzOjB9KTtqLm4rKztqLnRvcDMrPXQzfQogfTsKIC8qIOmojuaJi++8muWujOWFqOS4gOiHtOKGku+8iOefreOBhOihqOiomOOBquOCie+8ieWJjeaWueS4gOiHtOOBpzHkurrjgavntZ7jgozjgovjgajjgY3jgaDjgZHmjqHnlKggKi8KIFN0b3JlLnByb3RvdHlwZS5qb2NrZXk9ZnVuY3Rpb24obmFtZSl7CiAgaWYoIW5hbWUpcmV0dXJuIG51bGw7CiAgY29uc3Qgaj10aGlzLmouZ2V0KG5hbWUpO2lmKGopcmV0dXJuIGo7CiAgaWYobmFtZS5sZW5ndGg8Mnx8bmFtZS5sZW5ndGg+NClyZXR1cm4gbnVsbDsKICBpZighdGhpcy5famt8fHRoaXMuX2prU2l6ZSE9PXRoaXMuai5zaXplKXt0aGlzLl9qaz1bLi4udGhpcy5qLmtleXMoKV07dGhpcy5famtTaXplPXRoaXMuai5zaXplfQogIGNvbnN0IGM9dGhpcy5famsuZmlsdGVyKGs9Pmsuc3RhcnRzV2l0aChuYW1lKXx8KG5hbWUubGVuZ3RoPj0zJiZrLnN0YXJ0c1dpdGgobmFtZS5zbGljZSgwLC0xKSkmJm5hbWUubGVuZ3RoPD1rLmxlbmd0aCkpOwogIHJldHVybiBjLmxlbmd0aD09PTE/dGhpcy5qLmdldChjWzBdKTpudWxsOwogfTsKIGNvbnN0IGxheW9mZj0obGFzdCx0YXJnZXQpPT57aWYoIWxhc3QpcmV0dXJuIC41O2NvbnN0IGE9KG5ldyBEYXRlKHRhcmdldCktbmV3IERhdGUobGFzdCkpLzg2NGU1OwogIHJldHVybiBhPDIxPy43MjphPDYwPy42MjphPDEyMD8uNTU6YTwyNDA/LjQ4Oi40Mn07CiAvKiA9PT09PSDlrp/nuL7jgYvjgonlrabnv5LjgZfjgZ/jg6Ljg4fjg6vvvIjnibnlvrTph4/ihpIz552A5YaF546H77yJID09PT09ICovCiBjb25zdCBGTj1bImJpYXMiLCJvZmZzZXQiLCJubG9nIiwibm9IaXN0IiwiZlMiLCJmQyIsImF2Z0YiLCJyM3NoYXJlIiwicjNhdmciLCJsYXN0MSIsImxhc3RCaWciLCJjb25kRGlmZiIsImZpcnN0U3VyZiIsImdhcFNob3J0IiwiZ2FwTG9uZyIsImdhcFZMb25nIiwiYWdlMyIsImFnZTQiLCJhZ2U3Iiwic3RlcFVwIiwic3RlcERvd24iLCJ3aW5SYXRlIl07CiBjb25zdCBGSj1bImpSZWwiLCJqbG9nIiwiak1pc3MiXTsKIC8qIOS/guaVsOOBryB0b29scy9maXRfbW9kZWwuanMg44Gn5a2m57+S77yIMjAyMOW5tOOAnOOBruaZguezu+WIl+ODh+ODvOOCv++8ieOAgnt9IOOCkue9ruaPmyAqLwogY29uc3QgTU9ERUw9eyJjb3JlIjpbMC4wNTI5OSwwLjk5Njk3LDAuMDQ5NTEsLTAuMjQ1NDMsLTAuNTI4MTIsMC45MTk0NiwtMC41MTQ3NiwtMC4zNDc4NiwtMC41NzkwNCwtMC41NTExOCwwLjE2NzczLDEuMTE4MiwtMC4zNTMwNSwtMC4xMTEyOCwtMC4yMjcyOCwtMC40MDEyOSwwLjEzNzcxLDAuMjE2NjIsLTAuMzk2NzMsLTAuMzUzMDUsMC4wMDYxNywtMC41OTU2NF0sImZ1bGwiOlswLjQwNDMzLDEuMzcwMDcsMC4wNjI1MSwtMC4xMjI3OSwtMC41MDIzMiwwLjgyOTc4LC0wLjM5ODk1LC0wLjMwMDcyLC0wLjUxNTU5LC0wLjUyNTMyLDAuMTU4MzIsMS4wNjY5NSwtMC4zODM3NywtMC4wNzI4MiwtMC4yMjU2OCwtMC4zNTEsMC4xNTAyNSwwLjIxMjUzLC0wLjQxMzM0LC0wLjMyMzE5LDAuMDA3MjYsLTAuOTM3OTIsMC41MzU1NywwLjAwMzY1LC0wLjIwNjA1XX07CiBmdW5jdGlvbiBmZWF0cyhyLHN0b3JlLHJhY2UsTix3aXRoSil7CiAgY29uc3QgYj1jbGFtcCgzL04sLjA4LC41KSxsYj1sb2dpdChiKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLG49aD9oLm46MCxMdD1yYWNlLmx2bHx8MDsKICBjb25zdCBwUz0oKGg/aC50b3AzOjApKzMqYikvKG4rMyksZlM9bG9naXQocFMpLWxiOwogIC8vIOOCr+ODqeOCueijnOato++8muS9juOBhOOCr+ODqeOCue+8iOWcsOaWueOCkuWQq+OCgO+8ieOBp+OBruWlvei1sOOBr+WJsuOCiuW8leOBjeOAgemrmOOBhOOCr+ODqeOCueOBp+OBruWHoei1sOOBr+WJsuOCiuW8leOBjwogIGxldCBmQz1mUzsKICBpZihoJiZMdD4wKXtsZXQgSD0wLE09MDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoaC5sdikpe2NvbnN0IEw9TnVtYmVyKGspLFtjbixjdF09aC5sdltrXTtjb25zdCBnPUw9PT0wPzA6KEw8MD8tMjpMLUx0KTsKICAgIEgrPWN0KmNsYW1wKDErLjMqZywuNCwxLjgpO00rPShjbi1jdCkqY2xhbXAoMS0uMypnLC40LDEuOCl9CiAgIGZDPWxvZ2l0KChIKzMqYikvKEgrTSszKSktbGJ9CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxyYz1ydW5zLnNsaWNlKC0zKSxsYXN0Uj1ydW5zLmxlbmd0aD9ydW5zW3J1bnMubGVuZ3RoLTFdOm51bGw7CiAgY29uc3QgcjNzaGFyZT1yYy5sZW5ndGg/cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aC9yYy5sZW5ndGg6MDsKICBjb25zdCByM2F2Zz1yYy5sZW5ndGg/Y2xhbXAoKHJjLnJlZHVjZSgoYSx4KT0+YSt4WzFdLDApL3JjLmxlbmd0aC02KS82LC0xLDIpOjA7CiAgY29uc3QgbGFzdDE9bGFzdFI/Y2xhbXAoKGxhc3RSWzFdLTYpLzYsLTEsMik6MCxsYXN0QmlnPWxhc3RSJiZsYXN0UlsxXT49MTA/MTowOwogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDtsZXQgY29uZERpZmY9MCxmaXJzdFN1cmY9MDsKICBpZihzYyYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJighZGlzdHx8TWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKSk7CiAgIGlmKGNyLmxlbmd0aCljb25kRGlmZj0oY3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCsyKnBTKS8oY3IubGVuZ3RoKzIpLXBTOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSlmaXJzdFN1cmY9MX0KICBsZXQgZ2FwPW51bGw7aWYoaCYmaC5sYXN0JiZyYWNlLmRhdGUpZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogIGNvbnN0IGE9ci5hZ2V8fDA7CiAgY29uc3Qgc3RlcEQ9bGFzdFImJmxhc3RSWzRdPjAmJkx0PjA/Y2xhbXAoTHQtbGFzdFJbNF0sLTMsMyk6MDsKICBjb25zdCB4PVsxLGxiLE1hdGgubG9nKDErbiksbj09PTA/MTowLGZTLGZDLG4/Y2xhbXAoKGguc3VtL24tNikvNiwtMSwyKTowLHIzc2hhcmUscjNhdmcsbGFzdDEsbGFzdEJpZyxjb25kRGlmZixmaXJzdFN1cmYsCiAgIGdhcCE9bnVsbCYmZ2FwPDIxPzE6MCxnYXAhPW51bGwmJmdhcD4xMjA/MTowLGdhcCE9bnVsbCYmZ2FwPjI0MD8xOjAsYT09PTM/MTowLGE9PT00PzE6MCxhPj03PzE6MCxzdGVwRD4wP3N0ZXBEOjAsc3RlcEQ8MD8tc3RlcEQ6MCwKICAgbj8oKGgud2luKy4zKmIpLyhuKzEuNSktYik6MF07CiAgaWYod2l0aEope2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTsKICAgaWYoaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpO3gucHVzaChsb2dpdChwSiktbGIsTWF0aC5sb2coMStqLm4pLDApfWVsc2UgeC5wdXNoKDAsMCwxKX0KICByZXR1cm4geDsKIH0KIGNvbnN0IGRvdD0odyx4KT0+e2xldCB6PTA7Zm9yKGxldCBpPTA7aTx4Lmxlbmd0aDtpKyspeis9KHdbaV18fDApKnhbaV07cmV0dXJuIHp9OwogY29uc3QgbW9kZWxaPShraW5kLHgpPT5kb3QoTU9ERUxba2luZF0seCk7CiAvKiAx6aCt44Gu57Sg54K5KGxvZ2l0KeOBqOOCv+OCsOOAgmNvbXAg44Gn5oiQ5YiG44KST04vT0ZG44Gn44GN44KL77yI5qSc6Ki855So77yJICovCiBmdW5jdGlvbiBob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXA9e30pewogIGNvbXA9T2JqZWN0LmFzc2lnbih7fSxERUZBVUxULGNvbXApO2NvbnN0IHVzZT1rPT5jb21wW2tdIT09ZmFsc2UmJmNvbXBba10hPT0wOwogIGNvbnN0IGI9Y2xhbXAoMy9OLC4xLC41KSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLGo9c3RvcmUuai5nZXQoci5qb2NrZXkpOwogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10sbj1oP2gubjowLHRhZ3M9W107bGV0IHo9MCxjb25mPSLkvY4iOwogIGNvbnN0IHBIPSgoaD9oLnRvcDM6MCkrNCpiKS8obis0KTt6Kz1sb2dpdChwSCk7CiAgaWYobj49Miljb25mPW4+PTU/IumrmCI6IuS4rSI7ZWxzZSB0YWdzLnB1c2goe3Q6IuWxpeattOS4jei2syIsYzoiZyJ9KTsKICBpZihuPj0zKXtjb25zdCB0Mz1oLnRvcDMvbix3PWgud2luL247CiAgIGlmKHQzPj0uNDAmJnc8PS4yMCl0YWdzLnB1c2goe3Q6YOWWhOaIpuWeiyAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBlbHNlIGlmKHQzPj0uNDUpdGFncy5wdXNoKHt0OmDlronlrpogM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgaWYodXNlKCJhdmciKSYmaC5zdW0vbjw9NSl6Kz0uMTJ9CiAgY29uc3QgcmM9cnVucy5zbGljZSgtMyk7CiAgaWYodXNlKCJyZWNlbnQiKSYmcmMubGVuZ3RoPj0yKXtjb25zdCBjMz1yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLGF2Zz1yYy5yZWR1Y2UoKHMseCk9PnMreFsxXSwwKS9yYy5sZW5ndGg7CiAgIHorPS4yMiooYzMvcmMubGVuZ3RoLXBIKSozO2lmKGMzPj0yKXRhZ3MucHVzaCh7dDpg6L+RJHtyYy5sZW5ndGh96LWw44GnJHtjM33lm54z552A5YaFYCxjOiJiIn0pOwogICBjb25zdCBsYXN0PXJ1bnNbcnVucy5sZW5ndGgtMV07CiAgIGlmKGxhc3QmJmxhc3RbMV0+PTgmJm4+PTQmJmgudG9wMy9uPj0uMzUpe3orPS4xNTt0YWdzLnB1c2goe3Q6YOWJjei1sCR7bGFzdFsxXX3nnYDjgYvjgonlt7vjgY3ov5TjgZfkvZnlnLBgLGM6Im8ifSl9CiAgIGlmKGF2Zzw9NCYmcmMubGVuZ3RoPj0zKXorPS4wOH0KICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7CiAgaWYodXNlKCJjb25kIikmJnNjJiZkaXN0JiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmTWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKTsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpe3otPS4zNTt0YWdzLnB1c2goe3Q6YCR7c2M9PT0xPyLliJ3jga7oip0iOiLliJ3jga7jg4Djg7zjg4gife+8iOmBjuWOu+i1sOOBr+WIpemmrOWgtO+8iWAsYzoibyJ9KX0KICAgaWYoY3IubGVuZ3RoPj0yKXtjb25zdCB0Mz1jci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLHBjPSh0MysyKnBIKS8oY3IubGVuZ3RoKzIpOwogICAgeis9Y2xhbXAoMioocGMtcEgpLC0uNSwuNSk7aWYodDM+PTIpdGFncy5wdXNoKHt0OmDlkIzmnaHku7bjgacke3QzfS8ke2NyLmxlbmd0aH3lm54z552A5YaFYCxjOiJiIn0pfX0KICBpZih1c2UoImpvY2tleSIpJiZqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSksZGo9Y2xhbXAoLjYqKGxvZ2l0KHBKKS1sb2dpdChiKSksLS40LC41KTsKICAgeis9ZGo7aWYoZGo+PS4yNSl0YWdzLnB1c2goe3Q6YOmojuaJi+WlveiqvyAz552A5YaFJHtNYXRoLnJvdW5kKGoudG9wMy9qLm4qMTAwKX0lYCxjOiJiIn0pfQogIGlmKHVzZSgibGF5b2ZmIikmJmgmJmgubGFzdCl7Y29uc3QgZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogICB6Kz0uNioobGF5b2ZmKGgubGFzdCxyYWNlLmRhdGUpLS41KTtpZihnYXA+PTE4MCl0YWdzLnB1c2goe3Q6YCR7Z2FwfeaXpeOBtuOCimAsYzoibyJ9KX0KICBpZih1c2UoImFnZSIpKXtjb25zdCBhPXIuYWdlfHw1O2lmKGE9PT0zKXorPS4xMDtlbHNlIGlmKGE9PT00KXorPS4wNTtlbHNlIGlmKGE+PTgpe3otPS4xNTt0YWdzLnB1c2goe3Q6YCR7YX3mrbNgLGM6Im8ifSl9fQogIHJldHVybnt6LHRhZ3MsY29uZixufTsKIH0KIC8qIDIwMjPlubTku6XpmY3jga7mmYLns7vliJfmpJzoqLzjgafjga4g57Sg44Gu5aW96LWw546H4oaS56m044K+44O844Oz5a6f57i+77yI5bmz5Z2HcCwg5a6f57i+77yJICovCiBjb25zdCBDQUw9W1swLDAuMDFdLFswLjAyMiwwLjAxN10sWzAuMDQ2LDAuMDIyXSxbMC4wNzUsMC4wNDZdLFswLjEwNSwwLjA2OF0sWzAuMTM1LDAuMDgyXSxbMC4xNjUsMC4wOThdLFswLjE5MywwLjEwM10sWzAuMjI0LDAuMTM4XSxbMC4yNTksMC4xNjFdLFswLjMwMiwwLjE4N10sWzAuMzU4LDAuMjExXSxbMC40NTQsMC4yMjldXTsKIC8qIOOCquODg+OCuuOBquOBl+ODouODvOODie+8iOS6uuawl+OBruS7o+eQhu+8nemojuaJi+i+vOOBv+OBruWtpue/kuODouODh+ODq+OBrumghuS9jeOBp+eptOOCvuODvOODs+OCkuWIpOWumu+8ieOBruijnOato+ihqOOAgjIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafkvZzmiJAgKi8KIGNvbnN0IENBTF9QUk9YWT1bWzAsMC4wMTNdLFswLjAyMiwwLjAyMV0sWzAuMDQ2LDAuMDI4XSxbMC4wNzUsMC4wNTZdLFswLjEwNSwwLjA4Nl0sWzAuMTM1LDAuMTExXSxbMC4xNjUsMC4xMzRdLFswLjE5MywwLjE0Nl0sWzAuMjI0LDAuMjAxXSxbMC4yNTksMC4yMTldLFswLjMwMSwwLjI2MV0sWzAuMzU1LDAuMjk2XSxbMC40MzksMC4zNjddXTsKIGZ1bmN0aW9uIGludGVycChULHApe2ZvcihsZXQgaT0xO2k8VC5sZW5ndGg7aSsrKWlmKHA8PVRbaV1bMF0pe2NvbnN0W2EsYl09VFtpLTFdLFtjLGRdPVRbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIFRbVC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBjYWxpYkZvcihwLG1vZGUpe3JldHVybiBtb2RlPT09Im9kZHMiP2ludGVycChDQUwscCk6aW50ZXJwKENBTF9QUk9YWSxwKX0KIGZ1bmN0aW9uIGNhbGliKHApe2ZvcihsZXQgaT0xO2k8Q0FMLmxlbmd0aDtpKyspaWYocDw9Q0FMW2ldWzBdKXtjb25zdFthLGJdPUNBTFtpLTFdLFtjLGRdPUNBTFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gQ0FMW0NBTC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBub3JtYWxpemVUb3AzKHpzLHRvdGFsKXtsZXQgbG89LTgsaGk9ODsKICBmb3IobGV0IGk9MDtpPDYwO2krKyl7Y29uc3QgYz0obG8raGkpLzIscz16cy5yZWR1Y2UoKGEseik9PmErc2lnbW9pZCh6K2MpLDApO2lmKHM+dG90YWwpaGk9YztlbHNlIGxvPWN9CiAgY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHpzLm1hcCh6PT5zaWdtb2lkKHorYykpfQogLyogSGFydmlsbGXms5Xjgafli53njofihpIz552A5YaF546HICovCiBmdW5jdGlvbiB0b3AzRnJvbVdpbihwdyl7Y29uc3QgVD1wdy5yZWR1Y2UoKGEsYik9PmErYiwwKSxwPXB3Lm1hcCh4PT54L1QpLG49cC5sZW5ndGgsb3V0PW5ldyBBcnJheShuKS5maWxsKDApOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2xldCBzPXBbaV07CiAgIGZvcihsZXQgaj0wO2o8bjtqKyspaWYoaiE9PWkpe3MrPXBbal0qcFtpXS8oMS1wW2pdKTsKICAgIGZvcihsZXQgaz0wO2s8bjtrKyspaWYoayE9PWkmJmshPT1qKXMrPXBbal0qcFtrXS8oMS1wW2pdKSpwW2ldLygxLXBbal0tcFtrXSl9CiAgIG91dFtpXT1zfXJldHVybiBvdXR9CiAvKiDimIXmoLzkuIrjgZLoo5zmraPvvJrlrabnv5LmuIjjgb/jg6Ljg4fjg6vjga/nnYDpoIbjgpLjgZ3jga7jgb7jgb7opovjgovjga7jgafjgIHkuIvkvY3jgrDjg6zjg7zjg4njgafjga7lpb3otbDjgYzph43os57jg7tHMeOBp+OCguWQjOS+oeWApOOBq+OBquOBo+OBpuOBhOOBn+OAggogICAg55u06L+RM+i1sOOBruOBhuOBoSBPUC/ph43os54o44Kv44Op44K5NSnjga7otbDjgavjgaTjgYTjgabjgIHku4rlm57jga7jgrDjg6zjg7zjg4njgajjga7lt67jgaDjgZHoo5zmraPjgZnjgovvvIjjgq/jg6njgrk05Lul5LiL44Gv44Oi44OH44Or5YG044Gu6KOc5q2j44GM44GC44KL44Gu44Gn5LqM6YeN5o6b44GR44GX44Gq44GE77yJ44CCCiAgICAgIOagvOS4iuOBku+8iOS+iyBHM+KGkkcx77yJ77ya5aW96LWw44Gu5L6h5YCk44KS5Ymy44KK5byV44GP77yI552A6aCG44GM6Imv44GE44G744Gp5aSn44GN44GP77yJCiAgICAgIOagvOS4i+OBku+8iOS+iyBHMeKGkkcy77yJ77ya5Yeh6LWw44Gu5L6h5YCk44KS5bCR44GX5oi744GZCiAgICDkv4LmlbDjga/mmqvlrprlgKTjgILikaAtMuOBruOAjOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g+OAjeOBp+OAgeijnOato+OBguOCii/jgarjgZfjgpLlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafmr5Tjgbnjgabnorroqo3jgZnjgovjgZPjgajjgIIgKi8KIGNvbnN0IEdSQURFPXtvbjp0cnVlLEtVUDouMzAsS0ROOi4xMixNSU46LS45LE1BWDouNX07CiBmdW5jdGlvbiBncmFkZUFkaihyLHN0b3JlLHJhY2UsY29tcCl7CiAgaWYoIUdSQURFLm9ufHwoY29tcCYmY29tcC5ncmFkZT09PWZhbHNlKSlyZXR1cm4gMDsKICBjb25zdCBHdD1yYWNlLmdyZHx8MDtpZihHdDwyKXJldHVybiAwOwogIGNvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7aWYoIWh8fCFoLnJ1bnMubGVuZ3RoKXJldHVybiAwOwogIGNvbnN0IHJjPWgucnVucy5zbGljZSgtMyksVz1bWzFdLFsuNCwuNl0sWy4yLC4zLC41XV1bcmMubGVuZ3RoLTFdO2xldCBkPTA7CiAgcmMuZm9yRWFjaCgoeCxrKT0+e2NvbnN0IGZpbj14WzFdLEw9eFs0XXx8MCxHcj14WzVdfHwwO2lmKEwhPT01fHwhKGZpbj4wKSlyZXR1cm47CiAgIGNvbnN0IGdyPU1hdGgubWF4KEdyLDIpOyAgICAgICAgICAvLyBPUOODu+OCsOODrOODvOODieS4jeaYjuOBruOCr+ODqeOCuTXotbDjga8gRzMg55u45b2T44Go44GX44Gm5q+U6LyDCiAgIGlmKEd0PmdyJiZmaW48PTUpZC09V1trXSpHUkFERS5LVVAqKEd0LWdyKSooNi1maW4pLzY7CiAgIGVsc2UgaWYoR3Q8Z3ImJmZpbj49NClkKz1XW2tdKkdSQURFLktETiooZ3ItR3QpKk1hdGgubWluKDEsKGZpbi0zKS84KX0pOwogIHJldHVybiBjbGFtcChkLEdSQURFLk1JTixHUkFERS5NQVgpfQogY29uc3QgR049WyLkuI3mmI4v5LiL57SaIiwiT1Djg7tMIiwiRzMiLCJHMiIsIkcxIl07CiBmdW5jdGlvbiBncmFkZVRhZ3ModGFncyxkeixyYWNlKXtjb25zdCB0PXRhZ3Muc2xpY2UoKTsKICBpZihkejw9LS4yKXQudW5zaGlmdCh7dDpg5qC85LiK44GS5oim77yIJHtHTltyYWNlLmdyZHx8MF1977yJ77ya5LiL5L2N44Kw44Os44O844OJ44Gu5aW96LWw44Gv5Ymy5byVICR7ZHoudG9GaXhlZCgyKX1gLGM6Im8ifSk7CiAgZWxzZSBpZihkej49LjEpdC51bnNoaWZ0KHt0OmDpq5jjgrDjg6zjg7zjg4njgYvjgonjga7moLzkuIvjgZIgJHtkej49MD8iKyI6IiJ9JHtkei50b0ZpeGVkKDIpfWAsYzoiYiJ9KTsKICByZXR1cm4gdH0KIC8qIOODrOODvOOCueino+aekOOAgm9kZHMg44Gv5Lu75oSP77yI5YWo6aCt5YiG77yJ44CCICovCiBjb25zdCBMVk49WyLkuI3mmI4iLCLmnKrli53liKkiLCIx5YudIiwiMuWLnSIsIjPli50iLCJPUCJdOwogZnVuY3Rpb24gZXh0cmFUYWdzKHRhZ3MscixzdG9yZSxyYWNlKXsKICBjb25zdCB0PXRhZ3Muc2xpY2UoKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLEx0PXJhY2UubHZsfHwwOwogIGlmKGgpe2NvbnN0IGxhc3Q9aC5ydW5zLmxlbmd0aD9oLnJ1bnNbaC5ydW5zLmxlbmd0aC0xXTpudWxsOwogICBpZihsYXN0JiZsYXN0WzRdPjAmJkx0PjAmJmxhc3RbNF0hPT1MdCl0LnVuc2hpZnQobGFzdFs0XTxMdD97dDpg5piH57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoibyJ9Ont0OmDpmY3ntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJiIn0pOwogICBpZihoLmx2JiZoLmx2Wy0xXSl0LnB1c2goe3Q6IuWcsOaWueOBp+OBruWHuui1sOOBguOCiu+8iOWJsuW8leipleS+oe+8iSIsYzoiZyJ9KX0KICByZXR1cm4gdH0KIC8qIOODqeODs+OCr++8mueptOOCvuODvOODs+OBruW5s+Wdh+OBq+WvvuOBmeOCi+WAjeeOh+OBpyBTL0EvQi9D77yI5bGl5q2044GMMei1sOS7peS4i+OBr0Ljgb7jgafvvIkgKi8KIGNvbnN0IEFWR19IT0xFPXtvZGRzOi4wOTEscHJveHk6LjExNX07CiBmdW5jdGlvbiByYXRpbmcocGMsbW9kZSxuKXtjb25zdCByPXBjL0FWR19IT0xFW21vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdO2xldCBrPXI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIjtpZihuPDImJihrPT09IlMifHxrPT09IkEiKSlrPSJCIjtyZXR1cm4ga30KIC8qIOeahOS4reeOh+mHjeimlu+8muWun+e4vjPotbDku6XkuIrjg7vjg6njg7Pjgq9TL0Hjg7vvvIjjgqrjg4PjgrrjgYzliIbjgYvjgovjgajjgY3jga/vvInljZjli50zMOWAjeacqua6gOOBruWkp+eptOOCkumZpOOBj+OAgumBjuWOu+OBruaknOiovOOBp+OAgeeahOS4reeOh+OBjOS4iuOBjOOCiuOAgeWbnuWPjueOh+OBjOacgOaCquOBruWkp+eptOOCkumBv+OBkeOCieOCjOOBnyAqLwogY29uc3QgRk9DVVNfTUFYX09ERFM9MzA7CiBjb25zdCBGT0NVUz17Im9kZHMiOnsibiI6MzYyNSwiaGl0IjowLjIzMiwiYmFzZUhpdCI6MC4xNzIsInBlckRheSI6MTMuNn0sInByb3h5Ijp7Im4iOjQwMjUsImhpdCI6MC4yNzIsImJhc2VIaXQiOjAuMjE3LCJwZXJEYXkiOjE1LjF9fTsgICAvLyAyMDI05bm05Lul6ZmN44Gu5qSc6Ki877ya55qE5Lit546H77yIYmFzZUhpdD3lvpPmnaXjga4x5L2N5YCZ6KOc77yJ44O76ZaL5YKs5pel44GC44Gf44KK44Gu6aCt5pWwCiBmdW5jdGlvbiBwaWNrRm9jdXMocmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zJiYocmF0aW5nKHgucGMseC5tb2RlLHgubik9PT0iUyJ8fHJhdGluZyh4LnBjLHgubW9kZSx4Lm4pPT09IkEiKSYmKHgub2RkPT1udWxsfHx4Lm9kZDxGT0NVU19NQVhfT0REUykpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiAvKiDnqbTppqzlgJnoo5zvvJrlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gg44GR44KS44CB5aW96LWw546H44Gu6auY44GE6aCG44GrIGsg6aCt44CC5bGl5q2044Gu5LmP44GX44GE6aas44Gv5ZCM54K544Gr44Gq44KK44KE44GZ44GP44CB6aCG5L2N44Gr5oSP5ZGz44GM44Gq44GE44Gf44KB5a++6LGh5aSWICovCiBmdW5jdGlvbiBwaWNrKHJlcyxrKXtyZXR1cm4gcmVzLmZpbHRlcih4PT54LmhvbGUmJngubj49Mykuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCxrKX0KIGZ1bmN0aW9uIGFuYWx5emUocmFjZSxzdG9yZSxvZGRzLGNvbXAscG9wQXJyKXsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoOwogIGNvbnN0IHNjPVIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcCkpOwogIGNvbnN0IGR6PVIubWFwKHI9PmdyYWRlQWRqKHIsc3RvcmUscmFjZSxjb21wKSk7CiAgY29uc3QgemMwPU1PREVMLmNvcmU/Ui5tYXAocj0+bW9kZWxaKCJjb3JlIixmZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpKTpzYy5tYXAoeD0+eC56KTtjb25zdCB6Yz16YzAubWFwKCh6LGkpPT56K2R6W2ldKTsKICBjb25zdCBwPW5vcm1hbGl6ZVRvcDMoemMsTWF0aC5taW4oMyxOKSk7CiAgbGV0IG1rdD1udWxsLHBvcD1udWxsLG1vZGU9InByb3h5IjsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7bWt0PXRvcDNGcm9tV2luKG9kZHMubWFwKG89PjEvbykpO3BvcD1vZGRzLm1hcChvPT4xK29kZHMuZmlsdGVyKHg9Png8bykubGVuZ3RoKTttb2RlPSJvZGRzIn0KICBlbHNlIGlmKHBvcEFyciYmcG9wQXJyLmxlbmd0aD09PU4mJnBvcEFyci5ldmVyeSh4PT54PjApKXtwb3A9cG9wQXJyLnNsaWNlKCk7bW9kZT0ib2RkcyJ9IC8vIOWun+mam+OBruS6uuawl+mghuS9jeOBoOOBkeWIhuOBi+OCi+OBqOOBje+8iOe1kOaenOODmuODvOOCuOeUseadpe+8iQogIGVsc2V7IC8vIOOCquODg+OCuuOCguS6uuawl+OCguOBquOBhOOBqOOBje+8mumojuaJi+aIkOe4vuOBvuOBp+WQq+OCgeOBn+OCueOCs+OCouOBrumghuS9jeOCkuOAjOS6uuawl+OBruS7o+eQhuOAjeOBq+OBmeOCi++8iOWun+mam+OBruS6uuawl+OBqOOBruebuOmWoiAwLjU14oaSMC42N++8iQogICBjb25zdCBweD1NT0RFTC5mdWxsP1IubWFwKHI9Pm1vZGVsWigiZnVsbCIsZmVhdHMocixzdG9yZSxyYWNlLE4sdHJ1ZSkpKTpSLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLHtqb2NrZXk6dHJ1ZSxsYXlvZmY6ZmFsc2V9KS56KTtjb25zdCBweDI9cHgubWFwKCh2LGkpPT52K2R6W2ldKTtwb3A9cHgyLm1hcCh2PT4xK3B4Mi5maWx0ZXIoeT0+eT52KS5sZW5ndGgpfQogIGNvbnN0IHJhbms9cC5tYXAodj0+MStwLmZpbHRlcih4PT54PnYpLmxlbmd0aCk7CiAgY29uc3QgY3V0PU1hdGgubWF4KDUsTWF0aC5jZWlsKE4qLjQpKTsKICByZXR1cm4gUi5tYXAoKHIsaSk9Pih7aSxubzpyLm51bXx8aSsxLG5hbWU6ci5uYW1lfHxyLmhvcnNlLHA6cFtpXSxwYzpjYWxpYkZvcihwW2ldLG1vZGUpLG1vZGUsCiAgIGpuOihzdG9yZS5qb2NrZXkoci5qb2NrZXkpfHx7bjowfSkubixyYW5rOnJhbmtbaV0scG9wOnBvcFtpXSxiYXNlOk1hdGgubWluKC41LDMvTiksCiAgIG9kZDoob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpP29kZHNbaV06bnVsbCwKICAgY2FyZWVyOigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/e246aC5uLHQzOmgudG9wMyx3aW46aC53aW59Om51bGx9KSgpLAogICByZWNlbnQ6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLnJ1bnMubWFwKHg9PnhbMV0pOltdfSkoKSwKICAgam5hbWU6ci5qbmFtZXx8IiIsanN0YXQ6KCgpPT57Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpO3JldHVybiBqJiZqLm4+PTE/e246ai5uLHJhdGU6ai50b3AzL2oubn06bnVsbH0pKCksCiAgIGhvbGU6Tj49NiYmcG9wW2ldPj1jdXQsbWt0Om1rdD9ta3RbaV06bnVsbCx2YWx1ZTpta3Q/Y2FsaWJGb3IocFtpXSwib2RkcyIpL21rdFtpXTpudWxsLAogICBkejpkeltpXSx0YWdzOmdyYWRlVGFncyhleHRyYVRhZ3Moc2NbaV0udGFncyxyLHN0b3JlLHJhY2UpLGR6W2ldLHJhY2UpLGNvbmY6c2NbaV0uY29uZixuOnNjW2ldLm4sY3V0fSkpOwogfQoKIC8qID09PT09IOmJhOadv+i7uOmmrOODu+azouS5seW6pu+8iOeptOmmrOS6iOaDs+OBqOOBr+WIpeOBruioiOeul+OAguS/guaVsOOBryB0b29scy9heGlzX3Vwc2V0X3N0dWR5LmpzIOOBp+Wtpue/kuOAgTIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafmpJzoqLzvvIkgPT09PT0gKi8KIGNvbnN0IEFYSVM9eyJ3UCI6WzAuMDUxOTMsMS4wMTQ4MywwLjA1MTQ4LC0wLjIwNjc2LC0wLjUzMjE2LDAuOTE0MzcsLTAuNDg0NjQsLTAuMzIxMTUsLTAuNTY4MDIsLTAuNTUxMzUsMC4xNzM0NSwxLjA5NzQsLTAuMjg0MDcsLTAuMTAzOTcsLTAuMjE2MTcsLTAuMzQ2NjgsMC4xNTkxMywwLjIyMTk2LC0wLjM4NzMyLC0wLjM0NjU4LDAuMDAzNywtMC41NjY0Nl0sIndPIjpbMC41NDI1OSwwLjE1NjYxLDAuMDU0MTQsLTAuMDQzNzEsLTAuMTQ1MjQsMC4xMzE3MSwtMC4xNDE3OCwtMC4xNjI2MywwLjA1MzE2LC0wLjAyMDk3LDAuMDAzOSwtMC4yOTg2NSwtMC4zMjMyMSwtMC4wMTM2NSwtMC4wOTUxOSwtMC4wNzgxOCwwLjAwMDYsLTAuMDIyOTEsLTAuMTEyMTMsMC4wMTc4MSwtMC4wNDc0NSwtMC4xMDg1MiwwLjI1NzIxLDAuNjMwNzFdLCJ1cHNldCI6eyJ0aHIiOjE1LCJtb2RlbHMiOnsicHJveHkiOlsyLjI0NTU5LDAuNjM4NDEsLTAuMDcwOCwtMC4wODE2MSwtMC4wNzc0MywwLjA5MTM3LDAuMTM4NDcsMC4wMDI3OSwtMC4zODkxOSwtMC42NDIxNywtMC41NTM4MSwtMC4wMTgzNywtMC40NDMxNywtMC43NjgyNSwtMC41MjM5MywtMi43MzU2MSwtMC4xNDkwOSwwLjExNDc3XSwib2RkcyI6Wy0wLjcyMzk2LDAuNDI4MDgsLTAuMDc0OTksLTAuMDYxNTQsLTAuMDA2NzUsMC4wNzI0MywwLjA3MDg1LC0wLjA0OTc0LC0wLjE1NTI4LC0wLjMyNTE2LC0wLjQxODI2LC0wLjMxMzUxLDAuMjA3NTcsLTAuMjM5LC0wLjI3OTAxLC0xLjgyMTA4LC0wLjAwODUyLDAuMDgzOTksMC4xNTAyNCwwLjM1MjQyLC0yLjAzODM5LDIuODU2NjgsMC4yMjkyOSwwLjcyMDg0LC0xLjk3Nzk3XX0sImdyYWRlcyI6eyJwcm94eSI6eyJjdXRzIjpbWyJTU1MiLDAuNTUwMzddLFsiU1MiLDAuNDg1NV0sWyJTIiwwLjQwNDI0XSxbIkEiLDAuMjk4OF0sWyJCIiwwLjE4OTU3XSxbIkMiLDAuMDA2MjldXSwicmF0ZXMiOnsiU1NTIjowLjU3NCwiU1MiOjAuNTA5LCJTIjowLjQzMywiQSI6MC4zNDcsIkIiOjAuMjQ0LCJDIjowLjA4OX0sImF2Z1MiOnsiU1NTIjoxNy4yLCJTUyI6MTUuMywiUyI6MTQuMiwiQSI6MTMuMSwiQiI6MTEuOCwiQyI6OS44fX0sIm9kZHMiOnsiY3V0cyI6W1siU1NTIiwwLjYwOTY4XSxbIlNTIiwwLjUxNTk1XSxbIlMiLDAuNDA4NTRdLFsiQSIsMC4yODc2N10sWyJCIiwwLjE3MzU5XSxbIkMiLDAuMDA3NjhdXSwicmF0ZXMiOnsiU1NTIjowLjY3OSwiU1MiOjAuNTk4LCJTIjowLjQ1NSwiQSI6MC4zNTIsIkIiOjAuMjQ2LCJDIjowLjA3OX0sImF2Z1MiOnsiU1NTIjoxOC41LCJTUyI6MTYuNCwiUyI6MTQuNSwiQSI6MTMuMywiQiI6MTEuOCwiQyI6OS42fX19fSwiYmFuZHMiOnsi6YmE5p2/Ijp7ImxvIjowLjkyLCJoaSI6MSwibiI6MTY2LCJyYXRlIjowLjk2MzksImxvOTUiOjAuOTM1NSwibjIiOjg3LCJyYXRlMiI6MC45NzcsInBlckRheSI6MC42Mn0sIua6lumJhOadvyI6eyJsbyI6MC44OCwiaGkiOjAuOTIsIm4iOjI3OSwicmF0ZSI6MC44ODUzLCJsbzk1IjowLjg0NzksIm4yIjoxMzksInJhdGUyIjowLjg5OTMsInBlckRheSI6MS4wNH0sIuWghei7uCI6eyJsbyI6MC44NCwiaGkiOjAuODgsIm4iOjQ3NCwicmF0ZSI6MC44NDE4LCJsbzk1IjowLjgwODksIm4yIjoyMjYsInJhdGUyIjowLjg0MDcsInBlckRheSI6MS43OH19fTsKIGZ1bmN0aW9uIGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgseGM9Ui5tYXAocj0+ZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKTsKICBjb25zdCBwUD1ub3JtYWxpemVUb3AzKHhjLm1hcCh4PT5kb3QoQVhJUy53UCx4KSksTWF0aC5taW4oMyxOKSk7CiAgbGV0IHBPPW51bGw7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCksbTM9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7CiAgIHBPPW5vcm1hbGl6ZVRvcDMoeGMubWFwKCh4LGkpPT5kb3QoQVhJUy53TyxbLi4ueCxNYXRoLmxvZyhwd1tpXSksbG9naXQoTWF0aC5taW4oLjk4LG0zW2ldKSldKSksTWF0aC5taW4oMyxOKSl9CiAgcmV0dXJue3BQLHBPLHhjfX0KIC8qIOmJhOadv+i7uOmmrO+8muOCquODg+OCuuOBjOOBguOCi+ODrOODvOOCueOBoOOBkeOAguS6iOa4rOeiuueOh+OBruWMuuWIhuOBlOOBqOOBq+OAgemBjuWOu+OBruWun+mam+OBrjPnnYDlhoXnjofjgpLmt7vjgYjjgosgKi8KIGZ1bmN0aW9uIGF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTtpZighYXAucE8pcmV0dXJuIG51bGw7CiAgY29uc3Qgb3V0PVtdO2FwLnBPLmZvckVhY2goKHAsaSk9PnsKICAgZm9yKGNvbnN0IGsgb2YgWyLpiYTmnb8iLCLmupbpiYTmnb8iLCLloIXou7giXSl7Y29uc3QgYj1BWElTLmJhbmRzW2tdO2lmKHA+PWIubG8mJnA8KGs9PT0i6YmE5p2/Ij8xLjAxOmIuaGkpKXtvdXQucHVzaCh7aSxwLHRpZXI6ayxyYXRlOmIucmF0ZSxsbzk1OmIubG85NSxuOmIubn0pO2JyZWFrfX19KTsKICByZXR1cm4gb3V0LnNvcnQoKGEsYik9PmIucC1hLnApfQogLyog5rOi5Lmx5bqm77yaU1NT44CcQ+OAgjPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkSAqLwogZnVuY3Rpb24gdXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHBzPWFwLnBQLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi1hKTsKICBjb25zdCBucz1SLm1hcChyPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLm46MH0pLG1vbnRoPU51bWJlcihTdHJpbmcocmFjZS5kYXRlKS5zbGljZSg1LDcpKXx8MCxMPXJhY2UubHZsfHwwOwogIGNvbnN0IGY9WzEsTi8xNixMPT09MT8xOjAsTD09PTI/MTowLEw9PT0zPzE6MCxMPT09ND8xOjAsTD09PTU/MTowLHJhY2Uuc3VyZj09PTE/MTowLChyYWNlLmRpc3R8fDApLzIwMDAsCiAgIG5zLmZpbHRlcihuPT5uPT09MCkubGVuZ3RoL04sbnMuZmlsdGVyKG49Pm48MykubGVuZ3RoL04sbnMucmVkdWNlKChhLG4pPT5hK01hdGgubG9nKDErbiksMCkvTi8zLAogICBwc1swXSxwc1sxXSxwc1syXSxwcy5yZWR1Y2UoKGEscCk9PmErcCpwLDApLHBzLmZpbHRlcihwPT5wPi41KS5sZW5ndGgvMyxtb250aD49NiYmbW9udGg8PTk/MTowXTsKICBsZXQgbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLnNvcnQoKGEsYik9PmItYSksb2Q9b2Rkcy5zbGljZSgpLnNvcnQoKGEsYik9PmEtYik7CiAgIGNvbnN0IGVudD0tcHcucmVkdWNlKChhLHApPT5hK3AqTWF0aC5sb2cocCksMCkvTWF0aC5sb2coTik7CiAgIGYucHVzaChwd1swXSxwd1sxXSxwd1swXStwd1sxXStwd1syXSxlbnQsTWF0aC5sb2cob2RbMF0pLE1hdGgubG9nKG9kWzFdKSxvZC5maWx0ZXIobz0+bzwxMCkubGVuZ3RoL04pO21vZGU9Im9kZHMifQogIHJldHVybntmLG1vZGUscDA6c2lnbW9pZChkb3QoQVhJUy51cHNldC5tb2RlbHNbbW9kZV0sZikpfX0KIGZ1bmN0aW9uIHVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBjb25zdCB1PXVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZGRzLGFwKSxtb2RlPXUubW9kZSxwPXUucDAsRz1BWElTLnVwc2V0LmdyYWRlc1ttb2RlXTsKICBsZXQgZ3JhZGU9IkMiO2Zvcihjb25zdCBbZyxjXSBvZiBHLmN1dHMpe2lmKHA+PWMpe2dyYWRlPWc7YnJlYWt9fQogIHJldHVybntncmFkZSxwLG1vZGUscmF0ZTpHLnJhdGVzW2dyYWRlXSxhdmdTOkcuYXZnU1tncmFkZV19fQoKIC8qIOaJleaIu+OBpOOBjeaZguezu+WIl+ODkOODg+OCr+ODhuOCueODiOOAgnJhY2VzIOOBr+aXpeS7mOaYh+mghiBbe2lkLGRhdGUscm93c31d44CBcGF5QnlJZCDjga8ge3JhY2VJZDp7cGxhY2U6W3tudW1iZXIseWVufV19feOAggogICAg56m044K+44O844Oz44Gv5a6f44Kq44OD44K66aCG5L2N44Gn5a6a576p77yI44OE44O844Or44Gu44Kq44OD44K65YWl5Yqb44Oi44O844OJ44Go5ZCM44GY54q25rOB77yJ44CC5ZCE44Os44O844K5MTAw5YaG44Ga44Gk6LO85YWl44CCICovCiBmdW5jdGlvbiBiYWNrdGVzdChyYWNlcyxwYXlCeUlkLG9wdHMpewogIG9wdHM9b3B0c3x8e307Y29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IiIsU1BMSVQ9b3B0cy5zcGxpdHx8IiIsT09TPW9wdHMub29zfHwiIixQUk9YWT0hIW9wdHMucHJveHksTUlORz1OdW1iZXIob3B0cy5taW5HcmQpfHwwLF9nT249R1JBREUub247R1JBREUub249IW9wdHMuZ3JhZGVPZmY7CiAgY29uc3QgbmFtZXM9WyJ0b3AxIiwidG9wMiIsInRvcDMiLCJhbGxIb2xlIiwidmFsdWUiLCJheGlzIiwiZm9jdXMiXSxwZXI9WyJhbGwiLCJBIiwiQiIsIkMiXTsKICBjb25zdCBTPXt9O2Zvcihjb25zdCBuIG9mIG5hbWVzKXtTW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcilTW25dW3BdPXtiZXRzOjAsaGl0czowLHJldDowLHNxOjB9fQogIGNvbnN0IFNFRz17fTsgICAvLyAx5L2N5YCZ6KOc44Gu5p2h5Lu25Yil77yI5YWo5pyf6ZaT77yP5YmN5Y2K77yP5b6M5Y2K77yJCiAgY29uc3Qgc3RvcmU9bmV3IFN0b3JlKCk7bGV0IHVzZWQ9MDsKICBjb25zdCBhZGQ9KG4scCxoaXQseWVuKT0+e2NvbnN0IHg9U1tuXVtwXTt4LmJldHMrKztpZihoaXQpeC5oaXRzKys7eC5yZXQrPXllbjt4LnNxKz15ZW4qeWVufTsKICBjb25zdCBhZGRTZWc9KGxhYmVsLHAseWVuKT0+e2NvbnN0IGc9U0VHW2xhYmVsXT1TRUdbbGFiZWxdfHx7YWxsOntuOjAsaDowLHI6MCxxOjB9LEE6e246MCxoOjAscjowLHE6MH0sQjp7bjowLGg6MCxyOjAscTowfX07Zm9yKGNvbnN0IGsgb2YgWyJhbGwiLHBdKXtjb25zdCB4PWdba107eC5uKys7aWYoeWVuPjApeC5oKys7eC5yKz15ZW47eC5xKz15ZW4qeWVufX07CiAgY29uc3QgQVY9UFJPWFk/LjExNTouMDkxOwogIGZvcihjb25zdCByYyBvZiByYWNlcyl7CiAgIC8vIOaJleaIu+OBrklE44Gv44CM5pel5LuYLemWi+WCrOWgtC1S55Wq5Y+344CN44CC44OQ44OD44Kv44Ki44OD44OX44GuMTLmoYFJROOBqOOCguOAgeWQjOOBmOW9ouW8j+OBrklE44Go44KC57WQ44Gz5LuY44GR44KLCiAgIGNvbnN0IHZPZj0vXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDQsNik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzNdfHwiIixyT2Y9TnVtYmVyKC9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoMTAsMTIpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVs0XXx8MCk7CiAgIGNvbnN0IHBheT1wYXlCeUlkW3JjLmlkXXx8cGF5QnlJZFtgJHtyYy5kYXRlfS0ke3ZPZn0tJHtTdHJpbmcock9mKS5wYWRTdGFydCgyLCIwIil9YF07CiAgIGlmKHBheSYmcGF5LnBsYWNlJiZwYXkucGxhY2UubGVuZ3RoJiZyYy5kYXRlPj1TVEFSVCYmKCFNSU5HfHwoKHJjLnJvd3NbMF0mJnJjLnJvd3NbMF0uZ3JkKXx8MCk+PU1JTkcpKXsKICAgIC8vIOWHuui1sOihqOOBqOWQjOOBmOmmrOeVqumghuOBq+S4puOBueOCi++8iOWQjOeCueOBruOBqOOBjeOBruS4puOBs+OBp+edgOmghuOBjOa8j+OCjOOBquOBhOOCiOOBhuOBq++8iQogICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKTsKICAgIGNvbnN0IGhhc09kZHM9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5vZGRzPjEpLGhhc1BvcD1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLnBvcD4wKTsKICAgIGlmKFBST1hZP1IubGVuZ3RoPj02OihoYXNPZGRzfHxoYXNQb3ApKXsKICAgICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLGdyZDpSWzBdLmdyZHx8MCxydW5uZXJzOlJ9OwogICAgIGNvbnN0IHJlcz1QUk9YWT9hbmFseXplKHJhY2Usc3RvcmUsbnVsbCk6KGhhc09kZHM/YW5hbHl6ZShyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpOmFuYWx5emUocmFjZSxzdG9yZSxudWxsLG51bGwsUi5tYXAocj0+ci5wb3ApKSk7CiAgICAgY29uc3QgeWVuPW5ldyBNYXAocGF5LnBsYWNlLm1hcCh4PT5beC5udW1iZXIseC55ZW5dKSk7CiAgICAgY29uc3QgaG9sZT1yZXMuZmlsdGVyKHg9PnguaG9sZSkuc29ydCgoYSxiKT0+Yi5wLWEucCk7CiAgICAgaWYoaG9sZS5sZW5ndGgpewogICAgICB1c2VkKys7Y29uc3QgcHI9U1BMSVQ/KHJjLmRhdGU8U1BMSVQ/IkEiOiJCIik6IkEiOwogICAgICBjb25zdCBidXk9KG4sbGlzdCk9Pntmb3IoY29uc3QgeCBvZiBsaXN0KXtjb25zdCB5PXllbi5nZXQoUlt4LmldLm51bSl8fDA7YWRkKG4sImFsbCIseT4wLHkpO2FkZChuLHByLHk+MCx5KTtpZihPT1MmJnJjLmRhdGU+PU9PUylhZGQobiwiQyIseT4wLHkpfX07CiAgICAgIGJ1eSgiZm9jdXMiLHBpY2tGb2N1cyhyZXMsMSkpOwogICAgICBidXkoInRvcDEiLHBpY2socmVzLDEpKTtidXkoInRvcDIiLHBpY2socmVzLDIpKTtidXkoInRvcDMiLHBpY2socmVzLDMpKTtidXkoImFsbEhvbGUiLGhvbGUpOwogICAgICBpZighUFJPWFkpYnV5KCJ2YWx1ZSIsaG9sZS5maWx0ZXIoeD0+eC52YWx1ZT49MS4zKSk7CiAgICAgIGlmKCFQUk9YWSYmaGFzT2Rkcyl7Y29uc3QgYXA9YXhpc1Byb2JzKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7aWYoYXAucE8pYnV5KCJheGlzIixhcC5wTy5tYXAoKHAsaSk9Pih7aSxwfSkpLmZpbHRlcih4PT54LnA+PUFYSVMuYmFuZHNbIumJhOadvyJdLmxvKSl9CiAgICAgIGNvbnN0IHQ9cGljayhyZXMsMSlbMF07CiAgICAgIGlmKHQpe2NvbnN0IHk9eWVuLmdldChSW3QuaV0ubnVtKXx8MCxyPXQucGMvQVYsTj1SLmxlbmd0aDsKICAgICAgIGNvbnN0IHJhbms9KHI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIik7CiAgICAgICBhZGRTZWcoIuODqeODs+OCryIrKHQubjwyJiYocmFuaz09PSJTInx8cmFuaz09PSJBIik/IkIiOnJhbmspLHByLHkpOwogICAgICAgYWRkU2VnKE48PTEwPyLpoK3mlbAg44CcMTAiOk48PTE0PyLpoK3mlbAgMTHjgJwxNCI6IumgreaVsCAxNeOAnCIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5zdXJmPT09MT8i6IqdIjpyYWNlLnN1cmY9PT0yPyLjg4Djg7zjg4giOiLjgZ3jga7ku5YiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2UubHZsPjA/IuOCr+ODqeOCuSAiK0xWTltyYWNlLmx2bF06IuOCr+ODqeOCuSDkuI3mmI4iLHByLHkpOwogICAgICAgYWRkU2VnKHQubj49NT8i5a6f57i+IDXotbDku6XkuIoiOnQubj49Mz8i5a6f57i+IDPjgJw06LWwIjoi5a6f57i+IDPotbDmnKrmuoAiLHByLHkpOwogICAgICAgaWYoIVBST1hZJiZ0Lm9kZCl7Y29uc3Qgbz10Lm9kZDthZGRTZWcobzw4PyLljZjli50g44CcOOWAjSI6bzwxNT8i5Y2Y5YudIDjjgJwxNeWAjSI6bzwzMD8i5Y2Y5YudIDE144CcMzDlgI0iOm88NjA/IuWNmOWLnSAzMOOAnDYw5YCNIjoi5Y2Y5YudIDYw5YCN44CcIixwcix5KTsKICAgICAgICBpZihoYXNPZGRzKXtjb25zdCB1Zz11cHNldEdyYWRlKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7YWRkU2VnKCLms6LkubHluqYgIit1Zy5ncmFkZSxwcix5KX19fQogICAgIH0KICAgIH0KICAgfQogICBmb3IoY29uc3QgciBvZiByYy5yb3dzKXN0b3JlLmFkZChyKTsKICB9CiAgY29uc3QgZmluPXt9OwogIGZvcihjb25zdCBuIG9mIG5hbWVzKXtmaW5bbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKXtjb25zdCB4PVNbbl1bcF07CiAgIGlmKCF4LmJldHMpe2ZpbltuXVtwXT17YmV0czowfTtjb250aW51ZX0KICAgY29uc3QgbWVhbj14LnJldC94LmJldHMsc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5zcS94LmJldHMtbWVhbiptZWFuKSk7CiAgIGZpbltuXVtwXT17YmV0czp4LmJldHMsaGl0UmF0ZTp4LmhpdHMveC5iZXRzLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5iZXRzKS8xMDB9fX0KICBjb25zdCBzZWdzPXt9OwogIGZvcihjb25zdCBbayxnXSBvZiBPYmplY3QuZW50cmllcyhTRUcpKXtzZWdzW2tdPXt9O2Zvcihjb25zdCBwIG9mIFsiYWxsIiwiQSIsIkIiXSl7Y29uc3QgeD1nW3BdOwogICBpZigheC5uKXtzZWdzW2tdW3BdPXtiZXRzOjB9O2NvbnRpbnVlfWNvbnN0IG1lYW49eC5yL3gubixzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnEveC5uLW1lYW4qbWVhbikpOwogICBzZWdzW2tdW3BdPXtiZXRzOngubixoaXRSYXRlOnguaC94Lm4scm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4Lm4pLzEwMH19fQogIEdSQURFLm9uPV9nT247cmV0dXJue3JhY2VzOnVzZWQsc3RhdHM6ZmluLHNlZ3N9OwogfQogcmV0dXJue3Vwc2V0RmVhdHVyZXMsY2xlYW5UcixHUkFERSxncmFkZVRpZXIsZ3JhZGVBZGosRk9DVVMscmF0aW5nLHBpY2tGb2N1cyxBWElTLGF4aXNQcm9icyxheGlzUGlja3MsdXBzZXRHcmFkZSxwaWNrLGZlYXRzLE1PREVMLEZOLEZKLGxldmVsT2ZMYWJlbCxsZXZlbE9mUHJpemUsYmFja3Rlc3QsY2FsaWIsY2FsaWJGb3Isam5uLG5uLHRvUm93LGNzdlJvd3MsU3RvcmUsYW5hbHl6ZSxob3JzZVNjb3JlLG5vcm1hbGl6ZVRvcDMsdG9wM0Zyb21XaW4sc3VyZkNvZGUscGFyc2VEYXRlfTsKfSkoKTsKCgoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOOCouODl+ODquWxpO+8iOWGjeani+evie+8iQogKiAg44O75L+d5a2YL+WGjemWi+OBpOOBjeOBrumBjuWOu+ODh+ODvOOCv+WPluW+l+OAgeODkOODg+OCr+OCouODg+ODl+OAgeaknOiovOOBr+OAgeWLleS9nOeiuuiqjea4iOOBv+OBruWHpueQhuOCkuOBneOBruOBvuOBvuWGjeWIqeeUqAogKiAg44O75LuK6YCx5pyr44Gu5Y+W5b6X44CB6aiO5omL44O76Kq/5pWZ5bir44Gu54Wn5ZCI44CB5pyf5b6F5YCk44CB6LaF6YmE5p2/44CB5rOi5Lmx5bqm44CB5Y+W44KK6L6844G/5ZOB6LOq44Gu6KGo56S644Gv5paw6KaPCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgJD1pZD0+ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOwpjb25zdCBlc2M9cz0+U3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9bJjw+IiddL2csbT0+KHsiJiI6IiZhbXA7IiwiPCI6IiZsdDsiLCI+IjoiJmd0OyIsJyInOiImcXVvdDsiLCInIjoiJiMzOTsifVttXSkpOwpjb25zdCBzbGVlcD0obXM9MCk9Pm5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQocixtcykpOwpmdW5jdGlvbiBidXN5KG9uLG1zZz0i5Yem55CG5Lit4oCmIil7JCgiYnVzeSIpLnN0eWxlLmRpc3BsYXk9b24/ImZsZXgiOiJub25lIjskKCJidXN5VGV4dCIpLnRleHRDb250ZW50PW1zZ30KbGV0IERCPW51bGwsU1RPUkU9bnVsbCxTVE9SRV9LRVk9IiI7CmNvbnN0IFZFTlVFPXsiMDEiOiLmnK3luYwiLCIwMiI6IuWHvemkqCIsIjAzIjoi56aP5bO2IiwiMDQiOiLmlrDmvZ8iLCIwNSI6IuadseS6rCIsIjA2Ijoi5Lit5bGxIiwiMDciOiLkuK3kuqwiLCIwOCI6IuS6rOmDvSIsIjA5Ijoi6Ziq56WeIiwiMTAiOiLlsI/lgIkifTsKY29uc3QganN0VG9kYXk9KCk9Pm5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmNvbnN0IHBjdD0oeCxrPTApPT54PT1udWxsfHwhTnVtYmVyLmlzRmluaXRlKHgpPyItIjooeCoxMDApLnRvRml4ZWQoaykrIiUiOwoKZnVuY3Rpb24gb3BlbkRCKCl7cmV0dXJuIG5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCByPWluZGV4ZWREQi5vcGVuKCJ1cHNldF90b29sX2RiIiwyKTsKIHIub251cGdyYWRlbmVlZGVkPWU9Pntjb25zdCBkPWUudGFyZ2V0LnJlc3VsdDtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJmaWxlcyIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoImZpbGVzIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygibWV0YSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoIm1ldGEiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJwYXkiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJwYXkiKX07CiByLm9uc3VjY2Vzcz0oKT0+e0RCPXIucmVzdWx0O29rKCl9O3Iub25lcnJvcj0oKT0+bmcoci5lcnJvcik7ci5vbmJsb2NrZWQ9KCk9Pm5nKG5ldyBFcnJvcigi5LuW44Gu44K/44OW44Gn5L2/55So5Lit44Gn44GZIikpfSl9CmNvbnN0IGlkYkFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oImZpbGVzIikub2JqZWN0U3RvcmUoImZpbGVzIikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoImZpbGVzIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJmaWxlcyIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJDbGVhcj0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIiksc3Q9dC5vYmplY3RTdG9yZSgiZmlsZXMiKTtzdC5vcGVuQ3Vyc29yKCkub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtpZighU3RyaW5nKGMua2V5KS5zdGFydHNXaXRoKCJsaXZlOiIpKXttYXJrRGlydHkoImZpbGVzIixjLmtleSk7Yy5kZWxldGUoKX1jLmNvbnRpbnVlKCl9fTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwoKLyog5Y+W44KK6L6844G/5riI44G/44Gu5YWo6KGM77yI44OQ44OD44Kv44Ki44OD44OXQ1NW77yL5Y+W5b6X5riI44G/44Gu5oiQ57i+77yJ44KS6aCG44Gr5rih44GZICovCmFzeW5jIGZ1bmN0aW9uIGZvckVhY2hSb3coY2IpewogY29uc3QgZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IobGV0IGk9MDtpPGZzLmxlbmd0aDtpKyspe2NvbnN0IGY9ZnNbaV07CiAgaWYoZi5saXZlKXtmb3IoY29uc3QgeCBvZiBmLnJvd3N8fFtdKWNiKGxpdmVSb3coeCkpfQogIGVsc2UgZm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpY2IoVUUudG9Sb3cobykpOwogIGlmKGklMz09PTIpYXdhaXQgc2xlZXAoMCl9Cn0KLyog44Os44O844K5SUTjgYvjgonplovlgqzloLTjg7tS55Wq5Y+377yIMTLmoYHjga5KUkHlvaLlvI/vvI/ml6Xku5gt6ZaL5YKs5aC0LVLlvaLlvI/jga7kuKHlr77lv5zvvIkgKi8KZnVuY3Rpb24gdmVudWVPZklkKGlkKXtyZXR1cm4gL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSg0LDYpOlN0cmluZyhpZCkuc3BsaXQoIi0iKVszXXx8IiJ9CmZ1bmN0aW9uIHJhY2VOb09mSWQoaWQpe3JldHVybiBOdW1iZXIoL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSgxMCwxMik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzRdfHwwKX0KCi8qIC0tLSDlj5bjgorovrzjgb8gLS0tICovCmFzeW5jIGZ1bmN0aW9uIGltcG9ydEZpbGUoZmlsZSl7CiBidXN5KHRydWUsIuODleOCoeOCpOODq+OCkuiqreOBv+i+vOOBv+S4reKAplxu5aSn44GN44GE44OV44Kh44Kk44Or44Gv5pWw5Y2B56eS44GL44GL44KK44G+44GZ44CCIik7YXdhaXQgc2xlZXAoMzApOwogdHJ5ewogIGNvbnN0IHRleHQ9YXdhaXQgZmlsZS50ZXh0KCk7bGV0IGl0ZW1zOwogIGlmKC9cLmNzdiQvaS50ZXN0KGZpbGUubmFtZSkpe2l0ZW1zPVt7dHlwZToicmFjZS1yZXN1bHRzIix5ZWFyOjAscGxhY2U6ZmlsZS5uYW1lLGNzdjp0ZXh0fV19CiAgZWxzZXtjb25zdCBqPUpTT04ucGFyc2UodGV4dCk7aXRlbXM9QXJyYXkuaXNBcnJheShqKT9qOihqLmZpbGVzfHxbal0pfQogIGl0ZW1zPWl0ZW1zLmZpbHRlcih4PT54JiZ0eXBlb2YgeC5jc3Y9PT0ic3RyaW5nIik7CiAgaWYoIWl0ZW1zLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoImNzduOCkuWQq+OCgOODh+ODvOOCv+OBjOimi+OBpOOBi+OCiuOBvuOBm+OCk+OAguODkOODg+OCr+OCouODg+ODl0pTT07jgYvjgIFDU1bjgpLpgbjjgpPjgafjgY/jgaDjgZXjgYTjgIIiKTsKICBhd2FpdCBpZGJDbGVhcigpO2xldCBuPTA7CiAgZm9yKGxldCBpPTA7aTxpdGVtcy5sZW5ndGg7aSsrKXtjb25zdCBpdD1pdGVtc1tpXTthd2FpdCBpZGJQdXQoYCR7aXQueWVhcnx8MH06JHtpdC5wbGFjZX06JHtpfWAse3llYXI6aXQueWVhcixwbGFjZTppdC5wbGFjZSxwbGFjZU5hbWU6aXQucGxhY2VOYW1lLGNzdjppdC5jc3Z9KTsKICAgbis9TWF0aC5tYXgoMCxpdC5jc3Yuc3BsaXQoIlxuIikubGVuZ3RoLTEpOyQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9YOS/neWtmOS4reKApiAke2krMX0vJHtpdGVtcy5sZW5ndGh9YDthd2FpdCBzbGVlcCgwKX0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iZ29vZCI+5Y+W44KK6L6844G/5a6M5LqG77yaJHtpdGVtcy5sZW5ndGh944OV44Kh44Kk44Or77yP57SEJHtuLnRvTG9jYWxlU3RyaW5nKCl96KGMPC9zcGFuPmA7CiAgYmtTY2hlZHVsZSgpOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7lj5bjgorovrzjgb/jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXtidXN5KGZhbHNlKX0KfQoKY29uc3QgcGF5QWxsPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigicGF5Iikub2JqZWN0U3RvcmUoInBheSIpLmdldEFsbCgpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgcGF5UHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigicGF5IiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgicGF5IikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJwYXkiLGspO29rKCl9O3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgbWV0YUdldD1rPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigibWV0YSIpLm9iamVjdFN0b3JlKCJtZXRhIikuZ2V0KGspO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdCk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBtZXRhUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigibWV0YSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoIm1ldGEiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoIm1ldGEiLGspO29rKCl9O3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKYXN5bmMgZnVuY3Rpb24gcGF5U3RhdGUoKXthd2FpdCBzaG93U3RhdGUoKX0KCi8qIC0tLSDlhbHpgJrjga7lj5blvpfvvIjlho3oqabooYzjgaTjgY3vvIkgLS0tICovCmxldCBTWU5DSU5HPWZhbHNlOwphc3luYyBmdW5jdGlvbiBmZXRjaEpTT04odXJsLHdhaXRzQXJnKXsKIGxldCBlcnI9IiI7Y29uc3Qgd2FpdHM9d2FpdHNBcmd8fHdpbmRvdy5fX1dBSVRTfHxbNDAwMCwxMjAwMCwzMDAwMCw2MDAwMF07CiBmb3IobGV0IHQ9MDt0PD13YWl0cy5sZW5ndGg7dCsrKXsKICB0cnl7CiAgIGNvbnN0IHI9YXdhaXQgZmV0Y2godXJsKTtjb25zdCB0eHQ9YXdhaXQgci50ZXh0KCk7bGV0IHg9e307dHJ5e3g9SlNPTi5wYXJzZSh0eHQpfWNhdGNoKGUpe30KICAgaWYoIXIub2t8fHgub2s9PT1mYWxzZSl7Y29uc3QgZT1uZXcgRXJyb3IoeC5lcnJvcnx8YEhUVFAgJHtyLnN0YXR1c31gKyh0eHQmJiF4LmVycm9yP2DvvIgke3R4dC5yZXBsYWNlKC9ccysvZywiICIpLnNsaWNlKDAsNTApfe+8iWA6IiIpKTtlLnN0YXR1cz1yLnN0YXR1czt0aHJvdyBlfQogICByZXR1cm4geDsKICB9Y2F0Y2goZSl7CiAgIGVycj1lLm1lc3NhZ2U7Y29uc3QgcmV0cnk9IWUuc3RhdHVzfHxlLnN0YXR1cz49NTAwfHxlLnN0YXR1cz09PTQyOTsKICAgaWYoIXJldHJ5fHx0PT09d2FpdHMubGVuZ3RoKWJyZWFrOwogICBpZihTWU5DSU5HKSQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1g5re36ZuR44Gu44Gf44KBJHtNYXRoLnJvdW5kKHdhaXRzW3RdLzEwMDApfeenkuW+heOBo+OBpuWGjeippuihjOOBl+OBvuOBmeKApu+8iCR7ZXJyfe+8iWA7CiAgIGF3YWl0IHNsZWVwKHdhaXRzW3RdKTsKICB9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyKTsKfQpjb25zdCBNT0RFTF9UUkFJTl9FTkQ9IjIwMjYtMDYtMjIiOyAgIC8vIOePvuWcqOOBruODouODh+ODq+OBr+OAgeOBk+OBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBp+Wtpue/kgpjb25zdCBqc3RZZXN0ZXJkYXk9KCk9Pm5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMtODY0ZTUpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmNvbnN0IGFkZERheXM9KGQsbik9Pm5ldyBEYXRlKG5ldyBEYXRlKGQrIlQwMDowMDowMFoiKS5nZXRUaW1lKCkrbio4NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKZnVuY3Rpb24gbW9udGhzQmV0d2VlbihhLGIpe2NvbnN0IG91dD1bXTtsZXRbeSxtXT1hLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTtjb25zdFt5MixtMl09Yi5zbGljZSgwLDcpLnNwbGl0KCItIikubWFwKE51bWJlcik7CiB3aGlsZSh5PHkyfHwoeT09PXkyJiZtPD1tMikpe291dC5wdXNoKGAke3l9LSR7U3RyaW5nKG0pLnBhZFN0YXJ0KDIsIjAiKX1gKTttKys7aWYobT4xMil7bT0xO3krK319cmV0dXJuIG91dH0KCgovKiAtLS0g4pGgIOODh+ODvOOCv+WPluW+l++8mumBjuWOu+aIkOe4vu+8iOS6uuawl+OBpOOBje+8ie+8i+aJleaIu+OCkuOAgemWi+WCrOaXpeOBlOOBqOOBq+WPluW+l+OBl+OBpuS/neWtmCAtLS0gKi8KY29uc3QgU1lOQ19CQVRDSD00LFNZTkNfUEFSQUxMRUw9MjsKbGV0IFNTVE9QPWZhbHNlLEJBQ0tVUF9EQVRFUz1udWxsOwokKCJzeW5jU3RvcCIpLm9uY2xpY2s9KCk9PntTU1RPUD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZX07CiQoInNlbmQiKS52YWx1ZT1qc3RZZXN0ZXJkYXkoKTsKYXN5bmMgZnVuY3Rpb24gYmFja3VwRGF0ZXMoKXsKIGlmKEJBQ0tVUF9EQVRFUylyZXR1cm4gQkFDS1VQX0RBVEVTOwogY29uc3Qgcz1uZXcgU2V0KCksZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IoY29uc3QgZiBvZiBmcyl7aWYoZi5saXZlKWNvbnRpbnVlO2Zvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKXtjb25zdCBkPVVFLnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKTtpZihkKXMuYWRkKGQpfWF3YWl0IHNsZWVwKDApfQogcmV0dXJuIEJBQ0tVUF9EQVRFUz1zOwp9CmFzeW5jIGZ1bmN0aW9uIGZldGNoRGF5KGJhc2UsZCl7CiBjb25zdCBkYXk9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1kYXk/ZGF0ZT0ke2R9YCk7CiBjb25zdCByYWNlcz1kYXkucmFjZXN8fFtdO2lmKCFyYWNlcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHJhY2VzLmxlbmd0aDtpKz1TWU5DX0JBVENIKWNodW5rcy5wdXNoKHJhY2VzLnNsaWNlKGksaStTWU5DX0JBVENIKS5tYXAoeD0+eC5jbmFtZSkpOwogY29uc3Qgcm93cz1bXSxwYXlvdXRzPVtdO2xldCBpZHg9MCxmYWlsZWROPTA7CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGlkeDxjaHVua3MubGVuZ3RoKXtjb25zdCBrPWlkeCsrOwogIGNvbnN0IHJlcz1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLXJlc3VsdHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gKTsKICByb3dzLnB1c2goLi4uKHJlcy5yb3dzfHxbXSkpO3BheW91dHMucHVzaCguLi4ocmVzLnBheW91dHN8fFtdKSk7ZmFpbGVkTis9KHJlcy5mYWlsZWR8fFtdKS5sZW5ndGh9fTsKIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oe2xlbmd0aDpNYXRoLm1pbihTWU5DX1BBUkFMTEVMLGNodW5rcy5sZW5ndGgpfSx3b3JrZXIpKTsKIGNvbnN0IGdvdD1uZXcgU2V0KHJvd3MubWFwKHI9PnIucmFjZUlkKSkuc2l6ZTsKIGZhaWxlZE49TWF0aC5tYXgoZmFpbGVkTixyYWNlcy5sZW5ndGgtZ290KTsKIHJldHVybntyb3dzLHBheW91dHMsZmFpbGVkTixyYWNlczpyYWNlcy5sZW5ndGh9Owp9CiQoInN5bmNHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiBjb25zdCBhPSQoInNzdGFydCIpLnZhbHVlfHwiMjAyMy0wMS0wMSIseWQ9anN0WWVzdGVyZGF5KCk7bGV0IGI9JCgic2VuZCIpLnZhbHVlfHx5ZDtpZihiPnlkKWI9eWQ7CiBpZihhPmIpeyQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5aeL5pel44GM57WC5LqG5pel44KI44KK5b6M44Gn44GZ44CCIjtyZXR1cm59CiBTU1RPUD1mYWxzZTtTWU5DSU5HPXRydWU7JCgic3luY0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPWZhbHNlOwogY29uc3Qgc3Q9e2RheXM6MCxyYWNlczowLHNraXBwZWQ6MCxmYWlsOltdLHQwOkRhdGUubm93KCl9O2xldCBjb25zZWM9MDsKIHRyeXsKICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IuS/neWtmOa4iOOBv+ODh+ODvOOCv+OCkueiuuiqjeS4reKApiI7CiAgY29uc3QgZmlsZXM9YXdhaXQgaWRiQWxsKCksaGF2ZUxpdmU9bmV3IFNldChmaWxlcy5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoKS5tYXAoZj0+Zi5kYXRlKSk7CiAgY29uc3QgaGF2ZVBheT1uZXcgU2V0KChhd2FpdCBwYXlBbGwoKSkuZmlsdGVyKHA9PiFwLmZhaWxlZCkubWFwKHA9PnAuZGF0ZSkpOwogIGNvbnN0IGJrPWF3YWl0IGJhY2t1cERhdGVzKCk7CiAgY29uc3QgbW9udGhzPW1vbnRoc0JldHdlZW4oYSxiKSxjdXJNb250aD15ZC5zbGljZSgwLDcpOwogIGZvcihsZXQgbWk9MDttaTxtb250aHMubGVuZ3RoO21pKyspewogICBpZihTU1RPUClicmVhaztjb25zdCBtb250aD1tb250aHNbbWldOwogICBpZihtb250aDxjdXJNb250aCYmYXdhaXQgbWV0YUdldCgibW9udGg6Iittb250aCkpe2NvbnRpbnVlfQogICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7bW9udGh977yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJ6ZaL5YKs5pel44KS56K66KqN5Lit4oCmIOWPluW+l+a4iOOBvyR7c3QuZGF5c33ml6VgOwogICBsZXQgZGF5czt0cnl7ZGF5cz0oYXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1kYXlzP21vbnRoPSR7bW9udGh9YCkpLmRheXN8fFtdO2NvbnNlYz0wfWNhdGNoKGUpe3N0LmZhaWwucHVzaChgJHttb250aH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgIGRheXM9ZGF5cy5maWx0ZXIoZD0+ZD49YSYmZDw9Yik7bGV0IG1vbnRoT2s9dHJ1ZTsKICAgZm9yKGNvbnN0IGQgb2YgZGF5cyl7CiAgICBpZihTU1RPUCl7bW9udGhPaz1mYWxzZTticmVha30KICAgIGNvbnN0IG5lZWRSb3dzPSFoYXZlTGl2ZS5oYXMoZCkmJiFiay5oYXMoZCksbmVlZFBheT0haGF2ZVBheS5oYXMoZCk7CiAgICBpZighbmVlZFJvd3MmJiFuZWVkUGF5KXtzdC5za2lwcGVkKys7Y29udGludWV9CiAgICBjb25zdCBlbD1NYXRoLnJvdW5kKChEYXRlLm5vdygpLXN0LnQwKS8xMDAwKTsKICAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtkfSDjgpLlj5blvpfkuK3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvIlcbuWPluW+lyR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yP5aSx5pWXJHtzdC5mYWlsLmxlbmd0aH3vvI/ntYzpgY4ke01hdGguZmxvb3IoZWwvNjApfeWIhiR7ZWwlNjB956eSYDsKICAgIHRyeXsKICAgICBjb25zdCByPWF3YWl0IGZldGNoRGF5KGJhc2UsZCk7CiAgICAgaWYoci5mYWlsZWROKXttb250aE9rPWZhbHNlO3N0LmZhaWwucHVzaChgJHtkfe+8iCR7ci5mYWlsZWROfVLlpLHmlZfvvIlgKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgICAgaWYobmVlZFJvd3Mpe2F3YWl0IGlkYlB1dChgbGl2ZToke2R9YCx7bGl2ZTp0cnVlLGRhdGU6ZCxyb3dzOnIucm93c30pO2hhdmVMaXZlLmFkZChkKX0KICAgICBhd2FpdCBwYXlQdXQoZCx7ZGF0ZTpkLHJhY2VzOnIucGF5b3V0cyxmYWlsZWQ6MH0pO2hhdmVQYXkuYWRkKGQpOwogICAgIHN0LmRheXMrKztzdC5yYWNlcys9ci5yYWNlcztjb25zZWM9MDsKICAgIH1jYXRjaChlKXttb250aE9rPWZhbHNlO3N0LmZhaWwucHVzaChgJHtkfe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX19CiAgICBhd2FpdCBzbGVlcCg0MDApOwogICB9CiAgIGlmKG1vbnRoT2smJm1vbnRoPGN1ck1vbnRoKWF3YWl0IG1ldGFQdXQoIm1vbnRoOiIrbW9udGgsdHJ1ZSk7CiAgfQogfWNhdGNoKGUpe3N0LmZhaWwucHVzaChTdHJpbmcoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5ewogIFNZTkNJTkc9ZmFsc2U7U1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7JCgic3luY0dvIikuZGlzYWJsZWQ9ZmFsc2U7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlOwogICQoInN5bmNTdGF0dXMiKS5pbm5lckhUTUw9YCR7c3Quc3RvcHBlZD8i6YCj57aa44GX44Gm5aSx5pWX44GX44Gf44Gf44KB5Lit5pat44GX44G+44GX44Gf77yIQ2xvdWRmbGFyZeWBtOOBrua3t+mbkeODu+WItumZkOOBruWPr+iDveaAp++8ieOAguWwkeOBl+aZgumWk+OCkuOBiuOBhOOBpuOCguOBhuS4gOW6puaKvOOBl+OBpuOBj+OBoOOBleOBhOOAglxuIjoiIn0ke1NTVE9QJiYhc3Quc3RvcHBlZD8i5YGc5q2i44GX44G+44GX44Gf44CCIjooc3Quc3RvcHBlZD8iIjoi5a6M5LqG44CCIil95LuK5Zue44Gu5Y+W5b6X77yaJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIjkv53lrZjmuIjjgb/jgafjgrnjgq3jg4Pjg5cgJHtzdC5za2lwcGVkfeaXpe+8iWArKHN0LmZhaWwubGVuZ3RoP2BcbjxzcGFuIGNsYXNzPSJ3YXJuIj7lpLHmlZcgJHtzdC5mYWlsLmxlbmd0aH3ku7bvvJoke2VzYyhzdC5mYWlsLnNsaWNlKDAsNCkuam9pbigi44CBIikpfSR7c3QuZmFpbC5sZW5ndGg+ND8iIOKApiI6IiJ9XG7vvIjjgoLjgYbkuIDluqbmirzjgZnjgajjgIHlpLHmlZfjgZfjgZ/ml6XjgaDjgZHjgoTjgornm7TjgZfjgb7jgZnvvIk8L3NwYW4+YDoiIik7CiAgYXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpOwogfQp9OwoKCi8qIC0tLSDmiZXmiLvjga7mm7jjgY3lh7rjgZfjg7voqq3jgb/ovrzjgb8gLS0tICovCiQoInBheUV4cCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aClyZXR1cm4gYWxlcnQoIuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAgiIpOwogY29uc3QgYT1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJhIik7YS5ocmVmPVVSTC5jcmVhdGVPYmplY3RVUkwobmV3IEJsb2IoW0pTT04uc3RyaW5naWZ5KHBzKV0se3R5cGU6ImFwcGxpY2F0aW9uL2pzb24ifSkpOwogYS5kb3dubG9hZD1ga2VpYmFfcGF5b3V0c18ke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKX0uanNvbmA7YS5jbGljaygpO3NldFRpbWVvdXQoKCk9PlVSTC5yZXZva2VPYmplY3RVUkwoYS5ocmVmKSwxMDAwKX07CiQoInBheUltcCIpLm9uY2hhbmdlPWFzeW5jIGU9PnsKIGNvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoIWYpcmV0dXJuOwogdHJ5e2NvbnN0IGo9SlNPTi5wYXJzZShhd2FpdCBmLnRleHQoKSk7Y29uc3QgYXJyPUFycmF5LmlzQXJyYXkoaik/ajooai5yYWNlcz9bal06W10pOwogIGNvbnN0IGJ5RGF0ZT1uZXcgTWFwKCk7CiAgZm9yKGNvbnN0IHggb2YgYXJyKXtpZih4JiZBcnJheS5pc0FycmF5KHgucmFjZXMpJiZ4LmRhdGUpYnlEYXRlLnNldCh4LmRhdGUse2RhdGU6eC5kYXRlLHJhY2VzOngucmFjZXMsZmFpbGVkOnguZmFpbGVkfHwwfSl9CiAgZm9yKGNvbnN0W2Qscl1vZiBieURhdGUpYXdhaXQgcGF5UHV0KGQscik7CiAgYXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpOwogfWNhdGNoKGVycil7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7oqq3jgb/ovrzjgb/jgqjjg6njg7zvvJoke2VzYyhlcnIubWVzc2FnZSl9PC9zcGFuPmB9CiBlLnRhcmdldC52YWx1ZT0iIjsKfTsKCgovKiAtLS0g4pGgLTIg6KSH5Yud5Zue5Y+O546H44Gu5qSc6Ki8IC0tLSAqLwokKCJidFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogdHJ5ewogIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CC5YWI44Gr4pGg44Gn5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHBheUJ5SWQ9e307cHMuZm9yRWFjaChwPT4ocC5yYWNlc3x8W10pLmZvckVhY2goeD0+e3BheUJ5SWRbeC5yYWNlSWRdPXh9KSk7CiAgY29uc3Qgc3RhcnQ9JCgiYnRTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSI7CiAgY29uc3QgcGRhdGVzPXBzLm1hcChwPT5wLmRhdGUpLmZpbHRlcihkPT5kPj1zdGFydCkuc29ydCgpOwogIGlmKCFwZGF0ZXMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumWi+Wni+aXpeS7pemZjeOBruaJleaIu+OBjOOBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBzcGxpdD1wZGF0ZXNbTWF0aC5mbG9vcihwZGF0ZXMubGVuZ3RoLzIpXTsKICBidXN5KHRydWUsIuaIkOe4vuOCkuiqreOBv+i+vOOBv+S4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBtYXA9bmV3IE1hcCgpOwogIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKICBidXN5KHRydWUsIuODkOODg+OCr+ODhuOCueODiOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvdXQ9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7c3RhcnQsc3BsaXQsb29zOk1PREVMX1RSQUlOX0VORH0pOwogIGJ1c3kodHJ1ZSwi44Kq44OD44K65pyq5YWl5Yqb44Gu5aC05ZCI44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dFA9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7c3RhcnQsc3BsaXQsb29zOk1PREVMX1RSQUlOX0VORCxwcm94eTp0cnVlfSk7YnVzeShmYWxzZSk7dHJ5e3NldEdhdGUob3V0LG91dFApfWNhdGNoKGUpe2NvbnNvbGUuZXJyb3IoZSl9CiAgY29uc3QgTD17dG9wMToi44OE44O844OrMeS9jSIsdG9wMjoi5LiK5L2NMumgrSIsdG9wMzoi5LiK5L2NM+mgrSIsYWxsSG9sZToi56m044K+44O844Oz5YWo6aCt77yI5Z+65rqW77yJIix2YWx1ZToi5aaZ5ZGzMS4z5YCN5Lul5LiKIixheGlzOiLpiYTmnb/ou7jvvIgwLjky5Lul5LiK44O744Kq44OD44K65pmC77yJIixmb2N1czoi4peO55qE5Lit546H6YeN6KaW44GuMeS9jSJ9OwogIGNvbnN0IHBjdD14PT4oeCoxMDApLnRvRml4ZWQoMCkrIiUiLGM9eD0+eCYmeC5iZXRzP2Ake3BjdCh4LnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHguc2UqMTk2KS50b0ZpeGVkKDApfTwvc3Bhbj5gOiItIjsKICBjb25zdCB0Ymw9KG8sdGl0bGUpPT57CiAgIGxldCB0PWA8Yj4ke3RpdGxlfTwvYj48ZGl2IGNsYXNzPSJzbWFsbCI+5a++6LGhICR7by5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCuTwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7os7zlhaXmlbA8L3RoPjx0aD7nmoTkuK3njoc8L3RoPjx0aD7lm57lj47njocoOTUl5bmFKTwvdGg+PHRoPuWJjeWNijwvdGg+PHRoPuW+jOWNijwvdGg+PHRoPuWtpue/kuW+jDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhMKSl7Y29uc3Qgdj1vLnN0YXRzW2tdO2lmKCF2LmFsbC5iZXRzKWNvbnRpbnVlOwogICAgdCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7di5hbGwuYmV0cy50b0xvY2FsZVN0cmluZygpfTwvdGQ+PHRkPiR7KHYuYWxsLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD48Yj4ke2Modi5hbGwpfTwvYj48L3RkPjx0ZD4ke3YuQS5iZXRzP3BjdCh2LkEucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkIuYmV0cz9wY3Qodi5CLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5DLmJldHM/YCR7cGN0KHYuQy5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh2LkMuc2UqMTk2KS50b0ZpeGVkKDApfe+8iCR7di5DLmJldHMudG9Mb2NhbGVTdHJpbmcoKX3vvIk8L3NwYW4+YDoiLSJ9PC90ZD48L3RyPmB9CiAgIHJldHVybiB0KyI8L3Rib2R5PjwvdGFibGU+In07CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj4ke3N0YXJ0feOAnO+8j+WJjeWNiu+8nSR7c3BsaXR944KI44KK5YmN44CB5b6M5Y2K77yd5Lul6ZmN77yP5ZCEMTAw5YaGPC9kaXY+PGJyPmArdGJsKG91dCwi4pGgIOOCquODg+OCuuWFpeWKm+aZgu+8iOWun+mam+OBruS6uuawl+OBp+eptOOCvuODvOODs+OCkuWIpOWumu+8iSIpKyI8YnI+Iit0Ymwob3V0UCwi4pGhIOOCquODg+OCuuacquWFpeWKm+aZgu+8iOODhOODvOODq+aOqOWumuOBruS6uuawl+OBp+WIpOWumu+8iSIpOwogIC8vIOadoeS7tuWIpe+8iOODhOODvOODqzHkvY3jga7lm57lj47njofvvIkKICBjb25zdCBzZWdSb3dzPU9iamVjdC5lbnRyaWVzKG91dC5zZWdzKS5maWx0ZXIoKFssdl0pPT52LmFsbC5iZXRzPj0zMDApLnNvcnQoKGEsYik9PmFbMF08YlswXT8tMToxKTsKICBpZihzZWdSb3dzLmxlbmd0aCl7aCs9YDxicj48Yj7ikaIg44OE44O844OrMeS9jeOBruadoeS7tuWIpe+8iOKRoOOBruWgtOWQiO+8iTwvYj48ZGl2IGNsYXNzPSJzbWFsbCI+6LO85YWlMzAw5Zue5Lul5LiK44Gu5p2h5Lu244Gu44G/44CC5YmN5Y2K44O75b6M5Y2K44Gu5Lih5pa544Gn5ZCM44GY5ZCR44GN44GL44KS6KaL44Gm44GP44Gg44GV44GE44CCPC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuadoeS7tjwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBbayx2XSBvZiBzZWdSb3dzKWgrPWA8dHI+PHRkPiR7ZXNjKGspfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7di5hbGwuYmV0cy50b0xvY2FsZVN0cmluZygpfTwvdGQ+PHRkPiR7KHYuYWxsLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD48Yj4ke2Modi5hbGwpfTwvYj48L3RkPjx0ZD4ke3YuQS5iZXRzP3BjdCh2LkEucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkIuYmV0cz9wY3Qodi5CLnJvaSk6Ii0ifTwvdGQ+PC90cj5gOwogICBoKz0iPC90Ym9keT48L3RhYmxlPiJ9CiAgaCs9YDxkaXYgY2xhc3M9InNtYWxsIj48YnI+6KaL5pa577ya44CM5a2m57+S5b6M44CN44Gv44CB44Oi44OH44Or44Gu5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yIJHtNT0RFTF9UUkFJTl9FTkR95Lul6ZmN77yJ44Gn44CB5pyA44KC5L+h6aC844Gn44GN44KL5YiX44Gn44GZ44CC44Gd44KM5Lul5YmN44Gu5pyf6ZaT44Gv44CB44Oi44OH44Or44GM562U44GI44KS6KaL44Gm44GE44KL44Gf44KB44CB44KE44KE6Imv44GP5Ye644G+44GZ44CC5Zue5Y+O546H44Gu44CMwrHjgI3jga85NSXjga7oqqTlt67jga7luYXjgafjgIExMDAl44KS5LiL5Zue44KL5LiL6ZmQ44Gq44KJ5Yip55uK44Go44Gv6KiA44GI44G+44Gb44KT44CC5p2h5Lu25Yil44Gv44CB5o6i44GZ44G744Gp5YG254S244Gu6auY44GE5p2h5Lu244KS5ou+44GE44KE44GZ44GE44Gu44Gn44CB5YmN5Y2K44O75b6M5Y2K44Gu5Lih5pa544Gn5ZCM44GY5ZCR44GN44Gu44KC44Gu44Gg44GR44KS5Y+C6ICD44Gr44GX44Gm44GP44Gg44GV44GE44CC5aaZ5ZGz77yI5biC5aC044Go44Gu5beu77yJ44Gv44CB5qSc6Ki844Gn5Z+65rqW44KI44KK5oKq44GL44Gj44Gf44Gf44KB44CB5Yik5pat44Gr44Gv5L2/44KP44Gq44GE44Gn44GP44Gg44GV44GE44CCPC9kaXY+YDsKICAkKCJidE91dCIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfTsKCi8qIC0tLSDikaAtMyDjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzmr5TovIPvvIjph43os57jga7jgb/jg7vlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafoo5zmraPjgYLjgoov44Gq44GX77yJIC0tLSAqLwokKCJidEdyYWRlIikub25jbGljaz1hc3luYygpPT57CiB0cnl7CiAgY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavikaDjgaflj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgcGF5QnlJZD17fTtwcy5mb3JFYWNoKHA9PihwLnJhY2VzfHxbXSkuZm9yRWFjaCh4PT57cGF5QnlJZFt4LnJhY2VJZF09eH0pKTsKICBjb25zdCBzdGFydD0kKCJidFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIixwZGF0ZXM9cHMubWFwKHA9PnAuZGF0ZSkuZmlsdGVyKGQ9PmQ+PXN0YXJ0KS5zb3J0KCk7CiAgaWYoIXBkYXRlcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6ZaL5aeL5pel5Lul6ZmN44Gu5omV5oi744GM44GC44KK44G+44Gb44KT44CCPC9zcGFuPic7cmV0dXJufQogIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG1hcD1uZXcgTWFwKCk7bGV0IGdyYWRlZD0wOwogIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKICByYWNlcy5mb3JFYWNoKHg9PntpZigoeC5yb3dzWzBdLmdyZHx8MCk+PTIpZ3JhZGVkKyt9KTsKICBpZighZ3JhZGVkKXtidXN5KGZhbHNlKTskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumBjuWOu+ODh+ODvOOCv+OBruS4reOBq+OAgUcx44CcRzPjgajliKTliKXjgafjgY3jgovjg6zjg7zjgrnjgYzjgYLjgorjgb7jgZvjgpPvvIjjgq/jg6njgrnooajoqJjjg7sx552A6LOe6YeR44GM54Sh44GE77yJ44CC44Kw44Os44O844OJ6KOc5q2j44Gu5Yq55p6c44Gv5qSc6Ki844Gn44GN44G+44Gb44KT44CC4pGk44Gu5a6f6KGM5pmC44Gv44Os44O844K55ZCN44O75Ye66aas6KGo44Gu44Kw44Os44O844OJ6KGo6KiY44Gn6KOc5q2j44GV44KM44G+44GZ44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IGJhc2U9e3N0YXJ0LHNwbGl0OiIiLG9vczpNT0RFTF9UUkFJTl9FTkQsbWluR3JkOjJ9OwogIGJ1c3kodHJ1ZSwi6KOc5q2j44GC44KKL+OBquOBl+OCkuaknOiovOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvbj1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLGJhc2UpLG9mZj1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHsuLi5iYXNlLGdyYWRlT2ZmOnRydWV9KTtidXN5KGZhbHNlKTsKICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK0iLGZvY3VzOiLil47nmoTkuK3njofph43oppbjga4x5L2NIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt4LmJldHN977yJPC9zcGFuPmA6Ii0iOwogIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a++6LGh77ya6YeN6LOe77yIRzHjgJxHM++8iSR7b24ucmFjZXN944Os44O844K544CC5ZCM44GY6YGO5Y6744OH44O844K/44Gn44CB6KOc5q2j44GC44KKL+OBquOBl+OBrueahOS4reeOh+ODu+WbnuWPjueOhyg5NSXluYUp44KS5q+U6LyD44GX44Gm44GE44G+44GZ44CC5Lu25pWw44GM5bCR44Gq44GE44Go5beu44Gv5YG254S244Gu56+E5Zuy44Gn44GZ77yI5Zue5Y+O546H44GuwrHluYXjgYzph43jgarjgovjgarjgonlt67jga/liKTmlq3jgafjgY3jgb7jgZvjgpPvvInjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+6LK344GE5pa5PC90aD48dGg+PC90aD48dGg+55qE5Lit546HIOOBguOCijwvdGg+PHRoPueahOS4reeOhyDjgarjgZc8L3RoPjx0aD7lm57lj47njocg44GC44KKPC90aD48dGg+5Zue5Y+O546HIOOBquOBlzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCBhPW9uLnN0YXRzW2tdLmFsbCxiPW9mZi5zdGF0c1trXS5hbGw7aWYoIWF8fCFhLmJldHMpY29udGludWU7CiAgIGgrPWA8dHI+PHRkPiR7TFtrXX08L3RkPjx0ZD48L3RkPjx0ZD4keyhhLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD4ke2ImJmIuYmV0cz8oYi5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKSsiJSI6Ii0ifTwvdGQ+PHRkPjxiPiR7YyhhKX08L2I+PC90ZD48dGQ+JHtjKGIpfTwvdGQ+PC90cj5gfQogICQoImJ0T3V0IikuaW5uZXJIVE1MPWgrIjwvdGJvZHk+PC90YWJsZT4iOwogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfTsKCgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX77yIQ2xvdWRmbGFyZSBLVu+8iQogKiDjg7vjg4fjg7zjgr/jgYzlpInjgo/jgaPjgZ/jgrDjg6vjg7zjg5fvvIhjc3Yt5bm077yPbGl2ZS3lubTmnIjvvI9wYXkt5bm05pyI77yPbWV0Ye+8ieOBoOOBkeOCkuOAgWd6aXDjgZfjgabpgIHjgosKICog44O75L+d5a2Y5YWI44Gu6K2Y5Yil44Gv44CB44OR44K544OV44Os44O844K644GuU0hBLTI1Nu+8iOODkeOCueODleODrOODvOOCuuOBneOBruOCguOBruOBr+mAgeOCieOBquOBhO+8iQogKiDjg7vlvqnlhYPjga/jgIHlkIzjgZjjg5Hjgrnjg5Xjg6zjg7zjgrrjgafjgILlkIzjgZjjgq3jg7zjga7jg4fjg7zjgr/jga/kuIrmm7jjgY3jgZXjgozjgosKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBCSz17cGFzczoiIixhdXRvOnRydWUsZGlydHk6bmV3IFNldCgpLGJ1c3k6ZmFsc2UsaWQ6IiIsc2F2ZVQ6bnVsbCxydW5UOm51bGwsaW5mbzpudWxsLG1zZzoiIixlcnI6ZmFsc2V9Owpjb25zdCByYXdNZXRhUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigibWV0YSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoIm1ldGEiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCByYXdQdXRNYW55PXJlY3M9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBzdD1bLi4ubmV3IFNldChyZWNzLm1hcChyPT5yLnMpKV07aWYoIXN0Lmxlbmd0aClyZXR1cm4gb2soKTtjb25zdCB0PURCLnRyYW5zYWN0aW9uKHN0LCJyZWFkd3JpdGUiKTtmb3IoY29uc3QgciBvZiByZWNzKXQub2JqZWN0U3RvcmUoci5zKS5wdXQoci52LHIuayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgaWRiUmFuZ2U9KHN0b3JlLHJhbmdlKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IG91dD1bXTtjb25zdCBxPURCLnRyYW5zYWN0aW9uKHN0b3JlKS5vYmplY3RTdG9yZShzdG9yZSkub3BlbkN1cnNvcihyYW5nZSk7cS5vbnN1Y2Nlc3M9ZT0+e2NvbnN0IGM9ZS50YXJnZXQucmVzdWx0O2lmKGMpe291dC5wdXNoKHtzOnN0b3JlLGs6Yy5rZXksdjpjLnZhbHVlfSk7Yy5jb250aW51ZSgpfWVsc2Ugb2sob3V0KX07cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJLZXlzPXN0b3JlPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbihzdG9yZSkub2JqZWN0U3RvcmUoc3RvcmUpLmdldEFsbEtleXMoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmZ1bmN0aW9uIGdyb3VwT2Yoc3RvcmUsa2V5KXsKIGtleT1TdHJpbmcoa2V5KTsKIGlmKHN0b3JlPT09ImZpbGVzIil7aWYoa2V5LnN0YXJ0c1dpdGgoImxpdmU6IikpcmV0dXJuICJsaXZlLSIra2V5LnNsaWNlKDUsMTIpO2NvbnN0IHk9a2V5LnNwbGl0KCI6IilbMF07cmV0dXJuIC9eKDB8MjBcZFxkKSQvLnRlc3QoeSk/ImNzdi0iK3k6ImNzdi0wIn0KIGlmKHN0b3JlPT09InBheSIpcmV0dXJuICJwYXktIitrZXkuc2xpY2UoMCw3KTsKIHJldHVybiAibWV0YSI7Cn0KZnVuY3Rpb24gbWFya0RpcnR5KHN0b3JlLGtleSl7CiBpZihzdG9yZT09PSJtZXRhIiYmKGtleT09PSJkaXJ0eSJ8fGtleT09PSJiYWNrdXAiKSlyZXR1cm47CiBCSy5kaXJ0eS5hZGQoZ3JvdXBPZihzdG9yZSxrZXkpKTsKIGNsZWFyVGltZW91dChCSy5zYXZlVCk7Qksuc2F2ZVQ9c2V0VGltZW91dCgoKT0+e3Jhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKS5jYXRjaCgoKT0+e30pO2JrUmVuZGVyKCl9LDgwMCk7Cn0KYXN5bmMgZnVuY3Rpb24gcmVhZEdyb3VwKG5hbWUpewogbGV0IG07CiBpZihuYW1lPT09Im1ldGEiKXJldHVybihhd2FpdCBpZGJSYW5nZSgibWV0YSIpKS5maWx0ZXIocj0+ci5rIT09ImRpcnR5IiYmci5rIT09ImJhY2t1cCIpOwogaWYobT1uYW1lLm1hdGNoKC9eY3N2LShcZCspJC8pKXJldHVybiBpZGJSYW5nZSgiZmlsZXMiLElEQktleVJhbmdlLmJvdW5kKGAke21bMV19OmAsYCR7bVsxXX07YCkpOwogaWYobT1uYW1lLm1hdGNoKC9ebGl2ZS0oXGR7NH0tXGR7Mn0pJC8pKXJldHVybiBpZGJSYW5nZSgiZmlsZXMiLElEQktleVJhbmdlLmJvdW5kKGBsaXZlOiR7bVsxXX0tMDBgLGBsaXZlOiR7bVsxXX0tOTlgKSk7CiBpZihtPW5hbWUubWF0Y2goL15wYXktKFxkezR9LVxkezJ9KSQvKSlyZXR1cm4gaWRiUmFuZ2UoInBheSIsSURCS2V5UmFuZ2UuYm91bmQoYCR7bVsxXX0tMDBgLGAke21bMV19LTk5YCkpOwogcmV0dXJuW107Cn0KYXN5bmMgZnVuY3Rpb24gYWxsR3JvdXBzKCl7CiBjb25zdCBnPW5ldyBTZXQoKTsKIGZvcihjb25zdCBrIG9mIGF3YWl0IGlkYktleXMoImZpbGVzIikpZy5hZGQoZ3JvdXBPZigiZmlsZXMiLGspKTsKIGZvcihjb25zdCBrIG9mIGF3YWl0IGlkYktleXMoInBheSIpKWcuYWRkKGdyb3VwT2YoInBheSIsaykpOwogaWYoKGF3YWl0IGlkYktleXMoIm1ldGEiKSkuc29tZShrPT5rIT09ImRpcnR5IiYmayE9PSJiYWNrdXAiKSlnLmFkZCgibWV0YSIpOwogcmV0dXJuWy4uLmddOwp9CmFzeW5jIGZ1bmN0aW9uIGd6KHN0cil7CiBjb25zdCByYXc9bmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHN0cik7CiBpZih0eXBlb2YgQ29tcHJlc3Npb25TdHJlYW09PT0idW5kZWZpbmVkIilyZXR1cm57YnVmOnJhdyxlbmM6InJhdyJ9OwogY29uc3QgY3M9bmV3IENvbXByZXNzaW9uU3RyZWFtKCJnemlwIiksdz1jcy53cml0YWJsZS5nZXRXcml0ZXIoKTt3LndyaXRlKHJhdyk7dy5jbG9zZSgpOwogcmV0dXJue2J1ZjpuZXcgVWludDhBcnJheShhd2FpdCBuZXcgUmVzcG9uc2UoY3MucmVhZGFibGUpLmFycmF5QnVmZmVyKCkpLGVuYzoiZ3ppcCJ9Owp9CmFzeW5jIGZ1bmN0aW9uIGd1bnppcChidWYsZW5jKXsKIGlmKGVuYz09PSJyYXciKXJldHVybiBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYnVmKTsKIGNvbnN0IGRzPW5ldyBEZWNvbXByZXNzaW9uU3RyZWFtKCJnemlwIiksdz1kcy53cml0YWJsZS5nZXRXcml0ZXIoKTt3LndyaXRlKGJ1Zik7dy5jbG9zZSgpOwogcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShhd2FpdCBuZXcgUmVzcG9uc2UoZHMucmVhZGFibGUpLmFycmF5QnVmZmVyKCkpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrTWFrZUlkKCl7CiBpZighKHdpbmRvdy5jcnlwdG8mJmNyeXB0by5zdWJ0bGUpKXRocm93IG5ldyBFcnJvcigi44GT44Gu55Kw5aKD44Gn44Gv5L2/44GI44G+44Gb44KT77yIaHR0cHMg44Gn6ZaL44GP5b+F6KaB44GM44GC44KK44G+44GZ77yJIik7CiBjb25zdCBkPWF3YWl0IGNyeXB0by5zdWJ0bGUuZGlnZXN0KCJTSEEtMjU2IixuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoImtlaWJhLXVwc2V0LWJhY2t1cDp2MToiK0JLLnBhc3MpKTsKIHJldHVyblsuLi5uZXcgVWludDhBcnJheShkKV0ubWFwKGI9PmIudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIjAiKSkuam9pbigiIik7Cn0KYXN5bmMgZnVuY3Rpb24gYmtGZXRjaChwYXRoLG9wdCl7CiBpZighQksuaWQpQksuaWQ9YXdhaXQgYmtNYWtlSWQoKTsKIHJldHVybiBmZXRjaCgkKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIikrcGF0aCxPYmplY3QuYXNzaWduKHt9LG9wdCx7aGVhZGVyczpPYmplY3QuYXNzaWduKHsieC1iYWNrdXAtaWQiOkJLLmlkfSwob3B0JiZvcHQuaGVhZGVycyl8fHt9KX0pKTsKfQphc3luYyBmdW5jdGlvbiBia0pTT04ocGF0aCxvcHQpewogY29uc3Qgcj1hd2FpdCBia0ZldGNoKHBhdGgsb3B0KSx0PWF3YWl0IHIudGV4dCgpO2xldCBqPXt9O3RyeXtqPUpTT04ucGFyc2UodCl9Y2F0Y2goZSl7fQogaWYoIXIub2t8fGoub2s9PT1mYWxzZSl0aHJvdyBuZXcgRXJyb3Ioai5lcnJvcnx8KCJIVFRQICIrci5zdGF0dXMpKTtyZXR1cm4gajsKfQpmdW5jdGlvbiBia01zZyh0LGlzRXJyKXtCSy5tc2c9dHx8IiI7QksuZXJyPSEhaXNFcnI7YmtSZW5kZXIoKX0KZnVuY3Rpb24gYmtSZW5kZXIoKXsKIGNvbnN0IGVsPSQoImJrU3RhdHVzIik7aWYoIWVsKXJldHVybjsKIGNvbnN0IG09QksuaW5mbyxqc3Q9bXM9Pm5ldyBEYXRlKG1zKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnJlcGxhY2UoIlQiLCIgIikuc2xpY2UoMCwxNik7CiBsZXQgc3VtPSIiOwogaWYoIUJLLnBhc3Mpc3VtPSLjg5Hjgrnjg5Xjg6zjg7zjgrrjgpLoqK3lrprjgZnjgovjgajjgIHoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fjgYzmnInlirnjgavjgarjgorjgb7jgZnjgIIiOwogZWxzZSBpZihtJiZtLmV4aXN0cyl7Y29uc3QgY3M9T2JqZWN0LnZhbHVlcyhtLmNodW5rc3x8e30pO3N1bT1g5pyA57WC44OQ44OD44Kv44Ki44OD44OX77yaJHtqc3QobS51cGRhdGVkQXQpfe+8iCR7Y3MubGVuZ3RofeOCsOODq+ODvOODl++8jyR7KGNzLnJlZHVjZSgocyxjKT0+cytjLnNpemUsMCkvMTA0ODU3NikudG9GaXhlZCgxKX1NQu+8iWB9CiBlbHNlIHN1bT0i44OQ44OD44Kv44Ki44OD44OX44Gv44G+44Gg44GC44KK44G+44Gb44KT44CCIjsKIGlmKEJLLnBhc3Mpc3VtKz1g77yP5pyq6YCB5L+h44Gu5aSJ5pu077yaJHtCSy5kaXJ0eS5zaXplfeOCsOODq+ODvOODlyR7QksuYXV0bz8i77yI6Ieq5YuV44Gn6YCB44KK44G+44GZ77yJIjoi77yI6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX44Gv44Kq44OV77yJIn1gOwogZWwuaW5uZXJIVE1MPShCSy5tc2c/YDxzcGFuIGNsYXNzPSIke0JLLmVycj8id2FybiI6Imdvb2QifSI+JHtlc2MoQksubXNnKX08L3NwYW4+XG5gOiIiKStlc2Moc3VtKTsKfQpmdW5jdGlvbiBia05lZWRQYXNzKCl7aWYoIUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpe2JrTXNnKCLjg5Hjgrnjg5Xjg6zjg7zjgrrjgpI45paH5a2X5Lul5LiK44Gn5YWl5Yqb44GX44Gm44GP44Gg44GV44GE44CCIix0cnVlKTtyZXR1cm4gdHJ1ZX1yZXR1cm4gZmFsc2V9CmFzeW5jIGZ1bmN0aW9uIGJrUmVmcmVzaChtYW4pewogdHJ5e0JLLmluZm89bWFufHxhd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiKX1jYXRjaChlKXtCSy5pbmZvPW51bGw7aWYoIUJLLm1zZylia01zZygi44OQ44OD44Kv44Ki44OD44OX5YWI44KS56K66KqN44Gn44GN44G+44Gb44KT77yaIitlLm1lc3NhZ2UsdHJ1ZSl9CiBia1JlbmRlcigpOwp9CmFzeW5jIGZ1bmN0aW9uIHJ1bkJhY2t1cChmdWxsKXsKIGlmKEJLLmJ1c3l8fGJrTmVlZFBhc3MoKSlyZXR1cm47CiBCSy5idXN5PXRydWU7Y29uc3QgaW5mbGlnaHQ9bmV3IFNldChCSy5kaXJ0eSk7QksuZGlydHkuY2xlYXIoKTsKIHRyeXsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX5YWI44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgbWFuPWF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpLGhhdmU9bWFuLmV4aXN0cz8obWFuLmNodW5rc3x8e30pOnt9OwogIGNvbnN0IG5hbWVzPShmdWxsfHwhbWFuLmV4aXN0cyk/YXdhaXQgYWxsR3JvdXBzKCk6Wy4uLmluZmxpZ2h0XTsKICBpZighbmFtZXMubGVuZ3RoKXtia01zZygi5aSJ5pu044Gv44GC44KK44G+44Gb44KT44CCIik7YXdhaXQgYmtSZWZyZXNoKG1hbik7cmV0dXJufQogIGNvbnN0IGNodW5rcz1PYmplY3QuYXNzaWduKHt9LGhhdmUpO2xldCBzZW50PTAsYnl0ZXM9MDsKICBmb3IobGV0IGk9MDtpPG5hbWVzLmxlbmd0aDtpKyspewogICBjb25zdCBuYW1lPW5hbWVzW2ldO2JrTXNnKGDjg5Djg4Pjgq/jgqLjg4Pjg5fkuK3igKYgJHtpKzF9LyR7bmFtZXMubGVuZ3Rofe+8iCR7bmFtZX3vvIlgKTsKICAgY29uc3QgcmVjcz1hd2FpdCByZWFkR3JvdXAobmFtZSk7CiAgIGlmKCFyZWNzLmxlbmd0aCl7aWYoY2h1bmtzW25hbWVdKXthd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCx7bWV0aG9kOiJERUxFVEUifSk7ZGVsZXRlIGNodW5rc1tuYW1lXX1jb250aW51ZX0KICAgY29uc3QgcmF3PUpTT04uc3RyaW5naWZ5KHtnOm5hbWUscmVjc30pLHtidWYsZW5jfT1hd2FpdCBneihyYXcpOwogICBjb25zdCByPWF3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gLHttZXRob2Q6IlBVVCIsYm9keTpidWZ9KTsKICAgaWYoIXIub2spe2xldCBlPSIiO3RyeXtlPShhd2FpdCByLmpzb24oKSkuZXJyb3J9Y2F0Y2goXyl7fXRocm93IG5ldyBFcnJvcihlfHwoIkhUVFAgIityLnN0YXR1cykpfQogICBjaHVua3NbbmFtZV09e3NpemU6YnVmLmJ5dGVMZW5ndGgscmF3U2l6ZTpyYXcubGVuZ3RoLG46cmVjcy5sZW5ndGgsZW5jLGF0OkRhdGUubm93KCl9O3NlbnQrKztieXRlcys9YnVmLmJ5dGVMZW5ndGg7CiAgfQogIGlmKGZ1bGx8fCFtYW4uZXhpc3RzKXtmb3IoY29uc3QgbiBvZiBPYmplY3Qua2V5cyhoYXZlKSlpZighbmFtZXMuaW5jbHVkZXMobikpe2F3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuKX1gLHttZXRob2Q6IkRFTEVURSJ9KTtkZWxldGUgY2h1bmtzW25dfX0KICBjb25zdCBtYW5pZmVzdD17djoxLHVwZGF0ZWRBdDpEYXRlLm5vdygpLGNodW5rc307CiAgYXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iix7bWV0aG9kOiJQVVQiLGJvZHk6SlNPTi5zdHJpbmdpZnkobWFuaWZlc3QpLGhlYWRlcnM6eyJjb250ZW50LXR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIn19KTsKICBtYW5pZmVzdC5leGlzdHM9dHJ1ZTthd2FpdCByYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSk7YXdhaXQgcmF3TWV0YVB1dCgiYmFja3VwIix7YXQ6bWFuaWZlc3QudXBkYXRlZEF0fSk7CiAgQksuaW5mbz1tYW5pZmVzdDtia01zZyhg44OQ44OD44Kv44Ki44OD44OX5a6M5LqG77yaJHtzZW50feOCsOODq+ODvOODl+OCkumAgeS/oe+8iCR7KGJ5dGVzLzEwNDg1NzYpLnRvRml4ZWQoMSl9TULvvIlgKTsKIH1jYXRjaChlKXsKICBmb3IoY29uc3QgbiBvZiBpbmZsaWdodClCSy5kaXJ0eS5hZGQobik7cmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pLmNhdGNoKCgpPT57fSk7CiAgYmtNc2coIuODkOODg+OCr+OCouODg+ODl+OBq+WkseaVl+OBl+OBvuOBl+OBn++8miIrZS5tZXNzYWdlLHRydWUpOwogfWZpbmFsbHl7QksuYnVzeT1mYWxzZTtia1JlbmRlcigpfQp9CmFzeW5jIGZ1bmN0aW9uIHJ1blJlc3RvcmUoKXsKIGlmKEJLLmJ1c3l8fGJrTmVlZFBhc3MoKSlyZXR1cm47CiBCSy5idXN5PXRydWU7CiB0cnl7CiAgYmtNc2coIuODkOODg+OCr+OCouODg+ODl+OCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IG1hbj1hd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiKTsKICBpZighbWFuLmV4aXN0cyl7YmtNc2coIuOBk+OBruODkeOCueODleODrOODvOOCuuOBruODkOODg+OCr+OCouODg+ODl+OBr+imi+OBpOOBi+OCiuOBvuOBm+OCk++8iOODkeOCueODleODrOODvOOCuuOCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhO+8ieOAgiIsdHJ1ZSk7cmV0dXJufQogIGNvbnN0IG5hbWVzPU9iamVjdC5rZXlzKG1hbi5jaHVua3N8fHt9KTtsZXQgbj0wLGNudD0wOwogIGZvcihjb25zdCBuYW1lIG9mIG5hbWVzKXsKICAgYmtNc2coYOW+qeWFg+S4reKApiAkeysrbn0vJHtuYW1lcy5sZW5ndGh977yIJHtuYW1lfe+8iWApOwogICBjb25zdCByPWF3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gKTsKICAgaWYoIXIub2spdGhyb3cgbmV3IEVycm9yKGAke25hbWV9IOOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk++8iEhUVFAgJHtyLnN0YXR1c33vvIlgKTsKICAgY29uc3Qgbz1KU09OLnBhcnNlKGF3YWl0IGd1bnppcChuZXcgVWludDhBcnJheShhd2FpdCByLmFycmF5QnVmZmVyKCkpLG1hbi5jaHVua3NbbmFtZV0uZW5jfHwiZ3ppcCIpKTsKICAgYXdhaXQgcmF3UHV0TWFueShvLnJlY3MpO2NudCs9by5yZWNzLmxlbmd0aDsKICB9CiAgU1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7QkFDS1VQX0RBVEVTPW51bGw7QksuZGlydHkuY2xlYXIoKTsKICBhd2FpdCByYXdNZXRhUHV0KCJkaXJ0eSIsW10pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbi51cGRhdGVkQXR9KTsKICBhd2FpdCBzaG93U3RhdGUoKTtCSy5pbmZvPW1hbjtia01zZyhg5b6p5YWD5a6M5LqG77yaJHtuYW1lcy5sZW5ndGh944Kw44Or44O844OX77yPJHtjbnQudG9Mb2NhbGVTdHJpbmcoKX3ku7ZgKTsKIH1jYXRjaChlKXtia01zZygi5b6p5YWD44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSl9CiBmaW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQpmdW5jdGlvbiBia1NjaGVkdWxlKG1zKXsKIGlmKCFCSy5hdXRvfHwhQksucGFzc3x8QksucGFzcy5sZW5ndGg8OClyZXR1cm47CiBjbGVhclRpbWVvdXQoQksucnVuVCk7QksucnVuVD1zZXRUaW1lb3V0KCgpPT57aWYoIVNZTkNJTkcpcnVuQmFja3VwKGZhbHNlKTtlbHNlIGJrU2NoZWR1bGUoMzAwMDApfSxtc3x8MzAwMCk7Cn0KZnVuY3Rpb24gYmtTYXZlU2V0dGluZ3MoKXt0cnl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oInVwc2V0X2JrIixKU09OLnN0cmluZ2lmeSh7cGFzczpCSy5wYXNzLGF1dG86QksuYXV0b30pKX1jYXRjaChlKXt9fQphc3luYyBmdW5jdGlvbiBia0luaXQoKXsKIHRyeXtjb25zdCBvPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oInVwc2V0X2JrIil8fCJ7fSIpO0JLLnBhc3M9by5wYXNzfHwiIjtCSy5hdXRvPW8uYXV0byE9PWZhbHNlfWNhdGNoKGUpe30KICQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7JCgiYmtBdXRvIikuY2hlY2tlZD1CSy5hdXRvOwogJCgiYmtQYXNzIikub25jaGFuZ2U9KCk9PntCSy5wYXNzPSQoImJrUGFzcyIpLnZhbHVlLnRyaW0oKTtCSy5pZD0iIjtCSy5pbmZvPW51bGw7QksubXNnPSIiO2JrU2F2ZVNldHRpbmdzKCk7aWYoQksucGFzcy5sZW5ndGg+PTgpYmtSZWZyZXNoKCk7ZWxzZSBia1JlbmRlcigpfTsKICQoImJrU2hvdyIpLm9uY2xpY2s9KCk9Pntjb25zdCBwPSQoImJrUGFzcyIpO3AudHlwZT1wLnR5cGU9PT0icGFzc3dvcmQiPyJ0ZXh0IjoicGFzc3dvcmQiOyQoImJrU2hvdyIpLnRleHRDb250ZW50PXAudHlwZT09PSJwYXNzd29yZCI/IuihqOekuiI6IumaoOOBmSJ9OwogJCgiYmtBdXRvIikub25jaGFuZ2U9KCk9PntCSy5hdXRvPSQoImJrQXV0byIpLmNoZWNrZWQ7YmtTYXZlU2V0dGluZ3MoKTtia1JlbmRlcigpO2lmKEJLLmF1dG8pYmtTY2hlZHVsZSgyMDAwKX07CiAkKCJia05vdyIpLm9uY2xpY2s9KCk9PnJ1bkJhY2t1cChmYWxzZSk7CiAkKCJia0Z1bGwiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GZ44G544Gm44Gu44OH44O844K/44KS44CB44GC44KJ44Gf44KB44Gm5L+d5a2Y44GX55u044GX44G+44GZ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuQmFja3VwKHRydWUpfTsKICQoImJrUmVzdG9yZSIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZPjga7nq6/mnKvjga7jg4fjg7zjgr/jgpLjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjga7lhoXlrrnjgafkuIrmm7jjgY3jgZfjgb7jgZnvvIjjg5Djg4Pjgq/jgqLjg4Pjg5fjgavjgYLjgovjg4fjg7zjgr/jgaDjgZHjgYzlr77osaHjgafjgZnvvInjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5SZXN0b3JlKCl9OwogdHJ5e2NvbnN0IGQ9YXdhaXQgbWV0YUdldCgiZGlydHkiKTtpZihBcnJheS5pc0FycmF5KGQpKWQuZm9yRWFjaCh4PT5CSy5kaXJ0eS5hZGQoeCkpfWNhdGNoKGUpe30KIHRyeXtpZihuYXZpZ2F0b3Iuc3RvcmFnZSYmbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCluYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KCkuY2F0Y2goKCk9Pnt9KX1jYXRjaChlKXt9CiBia1JlbmRlcigpOwogaWYoQksucGFzcy5sZW5ndGg+PTgpe2F3YWl0IGJrUmVmcmVzaCgpO2lmKEJLLmRpcnR5LnNpemUpYmtTY2hlZHVsZSg1MDAwKX0KIHNldEludGVydmFsKCgpPT57aWYoQksuYXV0byYmQksucGFzcy5sZW5ndGg+PTgmJkJLLmRpcnR5LnNpemUmJiFCSy5idXN5JiYhU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpfSx3aW5kb3cuX19CS19USUNLfHw5MDAwMDApOwp9CgoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDms6LkubHluqbjga7lho3moKHmraMKICogIOebrueahO+8muazouS5seW6puOBruOAjOW9k+OBn+OCiuaWueOAjeOCkuOAgeiHquWIhuOBrumBjuWOu+ODh+ODvOOCv+OBp+eiuuOBi+OCgeOAgeS/oemgvOOBp+OBjeOCi+aVsOWtl+OBoOOBkeOCkuWHuuOBmeOAggogKiAg44KE44KL44GT44Go77yaCiAqICAgMSkg6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44GrMeOBpOOBmuOBpOWGjeePvuOBl+OAgeODrOODvOOCueWJjeOBq+WIhuOBi+OCi+aDheWgseOBoOOBkeOBp+azouS5seW6puOCkuioiOeulwogKiAgIDIpIOePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iE1PREVMX1RSQUlOX0VOROS7pemZje+8ieOBp+OAgeWun+mam+OBruazouS5seeOh+OBqOeqgeOBjeWQiOOCj+OBm+OCiwogKiAgIDMpIOOCs+ODvOOCueWIpeOBrumBjuWOu+azouS5seeOh++8iOmWi+WCrOWgtMOX6Iqd44OAw5fot53pm6LDl+OCr+ODqeOCue+8ieOBquOBqeOCkui2s+OBl+OBn+aWsOODouODh+ODq+OCkuS9nOOCiuOAgeWQjOOBmOacn+mWk+OBp+avlOi8gwogKiAgIDQpIOWvvuaVsOaQjeWkseOBjOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeaOoeeUqOOAguOBneOBhuOBp+OBquOBkeOCjOOBsOePvuihjOOBruOBvuOBvuOBq+OBl+OBpuOAgeWun+e4vueOh+OBoOOBkeaknOiovOWApOOBq+W3ruOBl+abv+OBiOOCiwogKiAg5rOi5Lmx77ydM+edgOS7peWGheOBrummrOOBruS6uuawl+OBruWQiOioiOOBjOmWvuWApCjnj77ooYzjg6Ljg4fjg6vjgajlkIzjgZgxNSnku6XkuIoKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBVUEtFWT0ia2VpYmFfdXBzZXRfdjEiOwpjb25zdCBzaWdtPXo9PjEvKDErTWF0aC5leHAoLXopKSxsZ3Q9cD0+e3A9TWF0aC5taW4oLjk5OSxNYXRoLm1heCguMDAxLHApKTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwpmdW5jdGlvbiB3aWxzb24oayxuKXtpZighbilyZXR1cm5bMCwxXTtjb25zdCB6PTEuOTYscD1rL24sZD0xK3oqei9uLGM9cCt6KnovKDIqbiksYT16Kk1hdGguc3FydChwKigxLXApL24reip6Lyg0Km4qbikpO3JldHVyblsoYy1hKS9kLChjK2EpL2RdfQpjb25zdCBkaXN0Qj1kPT5NYXRoLm1heCgxMDAwLE1hdGgubWluKDMyMDAsTWF0aC5yb3VuZCgoZHx8MCkvMjAwKSoyMDApKTsKY29uc3QgbHZsRz0obCxnKT0+KGx8fDApKyhnPj0yPyJHIjoiIik7CgovKiDjg6zjg7zjgrnjga7pm4boqIjvvIjooYzjgpLlhajpg6jmjIHjgZ/jgZrjgavmuIjjgoDou73jgYTlvaLvvInihpIg44Os44O844K55oOF5aCxICovCmZ1bmN0aW9uIGFnZ0FkZChtYXAscil7CiBpZighci5yYWNlSWR8fCFyLmhvcnNlfHxyLmZpbmlzaD09bnVsbClyZXR1cm47CiBsZXQgYT1tYXAuZ2V0KHIucmFjZUlkKTsKIGlmKCFhKW1hcC5zZXQoci5yYWNlSWQsYT17aWQ6U3RyaW5nKHIucmFjZUlkKSxkYXRlOnIuZGF0ZSxzdXJmOnIuc3VyZixkaXN0OnIuZGlzdCxsdmw6ci5sdmx8fDAsZ3JkOnIuZ3JkfHwwLE46MCx0OltdLHBmOltdLGp1bXA6ZmFsc2V9KTsKIGEuTisrO2lmKHIuZmluaXNoPD0zJiZyLnBvcD4wKWEudC5wdXNoKFtyLmZpbmlzaCxyLnBvcF0pOwogaWYoci5wb3A+MClhLnBmLnB1c2goW3IucG9wLHIuZmluaXNoXSk7CiBpZigv6Zqc5a6zLy50ZXN0KFN0cmluZyhyLnJhY2VOYW1lfHwiIikpKWEuanVtcD10cnVlOwp9CmZ1bmN0aW9uIGFnZ0luZm8oYSl7CiBpZighYXx8YS5OPDZ8fGEuanVtcClyZXR1cm4gbnVsbDsKIGNvbnN0IHY9L15cZHsxMn0kLy50ZXN0KGEuaWQpP2EuaWQuc2xpY2UoNCw2KTooU3RyaW5nKGEuaWQpLnNwbGl0KCItIilbM118fCIiKSxubz0vXlxkezEyfSQvLnRlc3QoYS5pZCk/TnVtYmVyKGEuaWQuc2xpY2UoMTAsMTIpKTooTnVtYmVyKFN0cmluZyhhLmlkKS5zcGxpdCgiLSIpWzRdKXx8MCk7CiBjb25zdCB0PWEudC5zbGljZSgpLnNvcnQoKHgseSk9PnhbMF0teVswXSk7CiBjb25zdCB5PXQubGVuZ3RoPj0zPyh0WzBdWzFdK3RbMV1bMV0rdFsyXVsxXT49VUUuQVhJUy51cHNldC50aHI/MTowKTpudWxsOwogcmV0dXJue2RhdGU6YS5kYXRlLHYsbm8sc3VyZjphLnN1cmYsZGlzdDphLmRpc3QsbHZsOmEubHZsLGdyZDphLmdyZCxOOmEuTix5fTsKfQoKLyog6ISa6LOq77yaMeOCs+ODvOODiuODvOOBruS9jee9ruOBruWJsuWQiO+8iDA95YWI6aCt44CBMT3mnIDlvozmlrnvvInjgILpgJrpgY7poIbkvY3jgaTjgY3jga7miJDnuL7jgYzjgYLjgovppqzjgaDjgZEgKi8KZnVuY3Rpb24gY29ybmVyRnJhYyhjb3JuZXIsTil7CiBpZighQXJyYXkuaXNBcnJheShjb3JuZXIpfHwhY29ybmVyLmxlbmd0aHx8IU58fE48NClyZXR1cm4gbnVsbDsKIHJldHVybiBNYXRoLm1pbigxLE1hdGgubWF4KDAsKGNvcm5lclswXS0xKS8oTi0xKSkpOwp9Ci8qIOODrOODvOOCueOBruODmuODvOOCueeJueW+tOmHj++8muWFiOihjOmmrOOBruWkmuOBleODu+iEmuizquOBruOBsOOCieOBpOOBjeOAguWNiuaVsOS7peS4iuOBrummrOOBq+iEmuizquODh+ODvOOCv+OBjOeEoeOBkeOCjOOBsOWFqOmDqDAgKi8KZnVuY3Rpb24gcGFjZUZlYXQocnVubmVycyxzdG9yZSl7CiBjb25zdCBOPXJ1bm5lcnMubGVuZ3RoO2xldCBrPTAsbGVhZD0wLGZyb250PTAsc3VtPTAsc3VtMj0wOwogZm9yKGNvbnN0IHIgb2YgcnVubmVycyl7CiAgY29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtpZighaCljb250aW51ZTsKICBjb25zdCB2PWgucnVucy5tYXAoeD0+eFs2XSkuZmlsdGVyKHg9PnghPW51bGwmJng+PTApO2lmKHYubGVuZ3RoPDIpY29udGludWU7CiAgY29uc3Qgdz12LnNsaWNlKC01KSxtPXcucmVkdWNlKChhLGIpPT5hK2IsMCkvdy5sZW5ndGg7CiAgaysrO3N1bSs9bTtzdW0yKz1tKm07aWYobTw9LjE1KWxlYWQrKztpZihtPD0uMzApZnJvbnQrKzsKIH0KIGlmKCFOfHxrPE4qLjUpcmV0dXJuWzAsMCwwLDAsMF07CiBjb25zdCBtZWFuPXN1bS9rLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHN1bTIvay1tZWFuKm1lYW4pKTsKIHJldHVybltrL04sbGVhZC9OKjQsZnJvbnQvTioyLG1lYW4tLjUsc2RdOwp9CgovKiDlkITppqzjga4z552A5YaF56K6546H44Go5Lq65rCX6aCG5L2N44GL44KJ44CB44CMM+edgOS7peWGheOBruS6uuawl+OBruWQiOioiOOBjOmWvuWApOS7peS4iuOAjeOBq+OBquOCi+eiuueOh+OCkuOCt+ODn+ODpeODrOODvOOCt+ODp+ODs+OBp+imi+epjeOCguOCiwogICDvvIjph43jgb/vvJ3norrnjofDtygx4oiS56K6546HKeOBp+OAgTPpoK3jgpLpoIbjgavmir3pgbjjgILmr47lm57lkIzjgZjntZDmnpzjgavjgarjgovjgojjgYbjgIHkubHmlbDjga/jg6zjg7zjgrnlhoXlrrnjgYvjgonmsbrjgoHjgovvvIkgKi8KZnVuY3Rpb24gc2ltVXBzZXQocCxwb3BzLHRocil7CiBjb25zdCBOPXAubGVuZ3RoO2xldCBzZWVkPTIxNjYxMzYyNjE7CiBmb3IobGV0IGk9MDtpPE47aSsrKXNlZWQ9TWF0aC5pbXVsKHNlZWReKE1hdGgucm91bmQocFtpXSoxMDAwKStwb3BzW2ldKjc5MTkpLDE2Nzc3NjE5KT4+PjA7CiBjb25zdCBybmQ9KCk9PntzZWVkPShzZWVkKzB4NkQyQjc5RjUpPj4+MDtsZXQgdD1zZWVkO3Q9TWF0aC5pbXVsKHReKHQ+Pj4xNSksdHwxKTt0Xj10K01hdGguaW11bCh0Xih0Pj4+NyksdHw2MSk7cmV0dXJuKCh0Xih0Pj4+MTQpKT4+PjApLzQyOTQ5NjcyOTZ9OwogY29uc3Qgdz1wLm1hcCh4PT5NYXRoLm1heCgxZS00LHgvKDEtTWF0aC5taW4oLjk5OSx4KSkpKTsKIGNvbnN0IEs9MzAwO2xldCBoaXQ9MCxzdW09MCxzdW0yPTA7CiBmb3IobGV0IGs9MDtrPEs7aysrKXsKICBjb25zdCB1c2VkPUFycmF5KE4pLmZpbGwoZmFsc2UpO2xldCBTPTA7CiAgZm9yKGxldCBqPTA7ajwzO2orKyl7CiAgIGxldCB0b3Q9MDtmb3IobGV0IGk9MDtpPE47aSsrKWlmKCF1c2VkW2ldKXRvdCs9d1tpXTsKICAgbGV0IHg9cm5kKCkqdG90LHBpY2s9LTE7CiAgIGZvcihsZXQgaT0wO2k8TjtpKyspe2lmKHVzZWRbaV0pY29udGludWU7eC09d1tpXTtpZih4PD0wKXtwaWNrPWk7YnJlYWt9fQogICBpZihwaWNrPDApe2ZvcihsZXQgaT1OLTE7aT49MDtpLS0paWYoIXVzZWRbaV0pe3BpY2s9aTticmVha319CiAgIHVzZWRbcGlja109dHJ1ZTtTKz1wb3BzW3BpY2tdOwogIH0KICBpZihTPj10aHIpaGl0Kys7c3VtKz1TO3N1bTIrPVMqUzsKIH0KIGNvbnN0IG09c3VtL0s7cmV0dXJuW2xndCgoaGl0Ky41KS8oSysxKSksbS8xNSxNYXRoLnNxcnQoTWF0aC5tYXgoMCxzdW0yL0stbSptKSkvMTBdOwp9Ci8qIDHjg6zjg7zjgrnjga7luILloLTovrzjgb/jga7nibnlvrTvvJrpgY7ljrvmiJDnuL7jg6Ljg4fjg6vjga7norrnjofjgajjgIHkurrmsJfpoIbkvY3jga7lrp/nuL7njofjgpLljYrjgIXjgafmt7fjgZzjgZ/norrnjocg4oaSIOOCt+ODn+ODpeODrOODvOOCt+ODp+ODsyAqLwpmdW5jdGlvbiBzaW1GZWF0KHBQLHBvcHMsTixwcmkpewogY29uc3Qgej1wUC5tYXAoKHAsaSk9Pi41KmxndChwKSsuNSpsZ3QocHJpLnJhdGUocG9wc1tpXSxOKSkpOwogcmV0dXJuIHNpbVVwc2V0KG5vcm1TdW0oeiwzKSxwb3BzLFVFLkFYSVMudXBzZXQudGhyKTsKfQoKLyog44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546H77yI5bCR44Gq44GE44OH44O844K/44Gv5YWo5L2T44G45a+E44Gb44KL77yJICovCmNsYXNzIFVwUHJpewogY29uc3RydWN0b3IoKXt0aGlzLmJhc2U9e246MCx1OjB9O3RoaXMubT1uZXcgTWFwKCl9CiBfayhpKXtyZXR1cm5bIlYiK2kudiwiQyIraS52KyJ8IitpLnN1cmYrInwiK2Rpc3RCKGkuZGlzdCksIkwiK2kuc3VyZisifCIrZGlzdEIoaS5kaXN0KSsifCIrbHZsRyhpLmx2bCxpLmdyZCksIk4iKyhpLm5vfHwwKV19CiBhZGQoaSl7aWYoIWl8fGkueT09bnVsbClyZXR1cm47dGhpcy5iYXNlLm4rKzt0aGlzLmJhc2UudSs9aS55O2Zvcihjb25zdCBrIG9mIHRoaXMuX2soaSkpe2xldCB4PXRoaXMubS5nZXQoayk7aWYoIXgpdGhpcy5tLnNldChrLHg9e246MCx1OjB9KTt4Lm4rKzt4LnUrPWkueX19CiBmZWF0KGkpewogIGNvbnN0IGI9dGhpcy5iYXNlLm4+MjAwP3RoaXMuYmFzZS51L3RoaXMuYmFzZS5uOi4yODUsSz00MDsKICBjb25zdCBzaD0oayxwYXIpPT57Y29uc3QgeD10aGlzLm0uZ2V0KGspfHx7bjowLHU6MH07cmV0dXJuKHgudStLKnBhcikvKHgubitLKX07CiAgY29uc3QgW2t2LGtjLGtsLGtuXT10aGlzLl9rKGkpLHB2PXNoKGt2LGIpLHBjPXNoKGtjLHB2KSxwbD1zaChrbCxiKSxwbj1zaChrbixiKSxsYj1sZ3QoYik7CiAgcmV0dXJuW2xndChwdiktbGIsbGd0KHBjKS1sYixsZ3QocGwpLWxiLGxndChwbiktbGJdOwogfQp9CgovKiDjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDvvIjjg4vjg6Xjg7zjg4jjg7Pms5Xjg7tMMuato+WJh+WMluODu+aomea6luWMlu+8iSAqLwpmdW5jdGlvbiBzb2x2ZUxpbihBLGIpewogY29uc3Qgbj1iLmxlbmd0aCxNPUEubWFwKChyLGkpPT5bLi4ucixiW2ldXSk7CiBmb3IobGV0IGM9MDtjPG47YysrKXsKICBsZXQgcD1jO2ZvcihsZXQgcj1jKzE7cjxuO3IrKylpZihNYXRoLmFicyhNW3JdW2NdKT5NYXRoLmFicyhNW3BdW2NdKSlwPXI7CiAgW01bY10sTVtwXV09W01bcF0sTVtjXV07Y29uc3QgZD1NW2NdW2NdfHwxZS05OwogIGZvcihsZXQgaz1jO2s8PW47aysrKU1bY11ba10vPWQ7CiAgZm9yKGxldCByPTA7cjxuO3IrKylpZihyIT09Yyl7Y29uc3QgZj1NW3JdW2NdO2lmKGYpZm9yKGxldCBrPWM7azw9bjtrKyspTVtyXVtrXS09ZipNW2NdW2tdfQogfQogcmV0dXJuIE0ubWFwKHI9PnJbbl0pOwp9CmZ1bmN0aW9uIGZpdExvZ2l0KFgseSxsMil7CiBjb25zdCBuPVgubGVuZ3RoLGQ9WFswXS5sZW5ndGgsbXU9QXJyYXkoZCkuZmlsbCgwKSxzZD1BcnJheShkKS5maWxsKDApOwogZm9yKGNvbnN0IHIgb2YgWClmb3IobGV0IGo9MDtqPGQ7aisrKW11W2pdKz1yW2pdL247CiBmb3IoY29uc3QgciBvZiBYKWZvcihsZXQgaj0wO2o8ZDtqKyspc2Rbal0rPShyW2pdLW11W2pdKSoqMi9uOwogZm9yKGxldCBqPTA7ajxkO2orKyl7c2Rbal09TWF0aC5zcXJ0KHNkW2pdKTtpZighKHNkW2pdPj0uMDUpKXNkW2pdPS4wNX0gICAvLyDjgbDjgonjgaTjgY3jgYzjgbvjgbznhKHjgYTliJfjga/jgIHlsI/jgZXjgaroqqTlt67jgaflibLjgaPjgablt6jlpKfjgarlgKTjgavjgarjgonjgarjgYTjgojjgYbjgIHkuIvpmZDjgpLoqK3jgZHjgosKIGNvbnN0IFo9WC5tYXAocj0+WzEsLi4uci5tYXAoKHYsaik9Pih2LW11W2pdKS9zZFtqXSldKSxEPWQrMSx3PUFycmF5KEQpLmZpbGwoMCk7CiBmb3IobGV0IGl0PTA7aXQ8MzA7aXQrKyl7CiAgY29uc3QgZz1BcnJheShEKS5maWxsKDApLEg9QXJyYXkuZnJvbSh7bGVuZ3RoOkR9LCgpPT5BcnJheShEKS5maWxsKDApKTsKICBmb3IobGV0IGk9MDtpPG47aSsrKXtjb25zdCB6PVpbaV07bGV0IHM9MDtmb3IobGV0IGo9MDtqPEQ7aisrKXMrPXdbal0qeltqXTsKICAgY29uc3QgcD1zaWdtKHMpLGU9cC15W2ldLHE9cCooMS1wKTsKICAgZm9yKGxldCBqPTA7ajxEO2orKyl7Z1tqXSs9ZSp6W2pdO2ZvcihsZXQgaz1qO2s8RDtrKyspSFtqXVtrXSs9cSp6W2pdKnpba119fQogIGZvcihsZXQgaj0xO2o8RDtqKyspe2dbal0rPWwyKndbal07SFtqXVtqXSs9bDJ9CiAgZm9yKGxldCBqPTA7ajxEO2orKylmb3IobGV0IGs9MDtrPGo7aysrKUhbal1ba109SFtrXVtqXTsKICBIWzBdWzBdKz0xZS05OwogIGNvbnN0IGR3PXNvbHZlTGluKEgsZyk7bGV0IG14PTA7Zm9yKGxldCBqPTA7ajxEO2orKyl7d1tqXS09ZHdbal07bXg9TWF0aC5tYXgobXgsTWF0aC5hYnMoZHdbal0pKX0KICBpZihteDwxZS03KWJyZWFrOwogfQogcmV0dXJue3csbXUsc2R9Owp9CmNvbnN0IHByZWRMb2dpdD0obSx4KT0+e2xldCBzPW0ud1swXTtmb3IobGV0IGo9MDtqPHgubGVuZ3RoO2orKyl7Y29uc3Qgej0oeFtqXS1tLm11W2pdKS9tLnNkW2pdO3MrPW0ud1tqKzFdKk1hdGgubWF4KC01LE1hdGgubWluKDUseikpfXJldHVybiBzfTsgICAvLyDlrabnv5LmmYLjga7nr4Tlm7LjgpLlpKfjgY3jgY/lpJbjgozjgZ/lhaXlipvjgafmmrTjgozjgarjgYTjgojjgYbCsTXjgavmipHjgYjjgosKCi8qIOipleS+oeaMh+aome+8muWvvuaVsOaQjeWkseODu+ODluODqeOCpOODpOODvOODu0FVQ+ODu+i8g+ato+iqpOW3rihFQ0UpICovCmZ1bmN0aW9uIGF1Y09mKHAseSl7CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSk7bGV0IHJzPTAsbjE9MDsKIGZvcihsZXQgcj0wO3I8aWR4Lmxlbmd0aDtyKyspe2lmKHlbaWR4W3JdXSl7cnMrPXIrMTtuMSsrfX0KIGNvbnN0IG4wPXkubGVuZ3RoLW4xO3JldHVybiBuMSYmbjA/KHJzLW4xKihuMSsxKS8yKS8objEqbjApOi41Owp9CmZ1bmN0aW9uIG1ldHJpY3NPZihwLHkpewogY29uc3Qgbj15Lmxlbmd0aDtsZXQgbGw9MCxicj0wOwogZm9yKGxldCBpPTA7aTxuO2krKyl7Y29uc3QgcT1NYXRoLm1pbigxLTFlLTksTWF0aC5tYXgoMWUtOSxwW2ldKSk7bGwtPXlbaV0/TWF0aC5sb2cocSk6TWF0aC5sb2coMS1xKTticis9KHBbaV0teVtpXSkqKjJ9CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSksQj0xMDtsZXQgZWNlPTA7CiBmb3IobGV0IGI9MDtiPEI7YisrKXtjb25zdCBzPWlkeC5zbGljZShNYXRoLmZsb29yKGIqbi9CKSxNYXRoLmZsb29yKChiKzEpKm4vQikpO2lmKCFzLmxlbmd0aCljb250aW51ZTsKICBjb25zdCBtcD1zLnJlZHVjZSgoYSxpKT0+YStwW2ldLDApL3MubGVuZ3RoLG15PXMucmVkdWNlKChhLGkpPT5hK3lbaV0sMCkvcy5sZW5ndGg7ZWNlKz1NYXRoLmFicyhtcC1teSkqcy5sZW5ndGgvbn0KIHJldHVybntuLGxsOmxsL24sYnJpZXI6YnIvbixhdWM6YXVjT2YocCx5KSxlY2V9Owp9CgovKiDnrYnntJrvvJrkuojmuKznorrnjofjga7pq5jjgYTpoIbjgavkuIrkvY0gMyUgLyA3JSAvIDEyJSAvIDIwJSAvIDI4JSAvIOaui+OCiu+8iFNTUy9TUy9TL0EvQi9D77yJICovCmNvbnN0IFVQX1NIQVJFPVtbIlNTUyIsLjAzXSxbIlNTIiwuMDddLFsiUyIsLjEyXSxbIkEiLC4yMF0sWyJCIiwuMjhdLFsiQyIsLjMwXV07CmZ1bmN0aW9uIG1ha2VDdXRzKHBzKXsKIGNvbnN0IHM9cHMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpO2xldCBhY2M9MDtjb25zdCBjdXRzPVtdOwogZm9yKGNvbnN0IFtnLHNoXSBvZiBVUF9TSEFSRSl7YWNjKz1zaDtpZihnPT09IkMiKXtjdXRzLnB1c2goW2csLTFdKTticmVha31jdXRzLnB1c2goW2csc1tNYXRoLm1pbihzLmxlbmd0aC0xLE1hdGgubWF4KDAsTWF0aC5yb3VuZChzLmxlbmd0aCphY2MpLTEpKV1dKX0KIHJldHVybiBjdXRzOwp9CmNvbnN0IGdyYWRlT2Y9KGN1dHMscCk9Pntmb3IoY29uc3QgW2csY10gb2YgY3V0cylpZihwPj1jKXJldHVybiBnO3JldHVybiJDIn07CmZ1bmN0aW9uIGdyYWRlVGFibGUoY3V0cyxwcyx5cyl7CiBjb25zdCB0PXt9O1VQX1NIQVJFLmZvckVhY2goKFtnXSk9PnRbZ109e246MCxrOjB9KTsKIHBzLmZvckVhY2goKHAsaSk9Pntjb25zdCB4PXRbZ3JhZGVPZihjdXRzLHApXTt4Lm4rKzt4LmsrPXlzW2ldfSk7CiBmb3IoY29uc3QgZyBpbiB0KXtjb25zdCB4PXRbZ10sdz13aWxzb24oeC5rLHgubik7eC5yYXRlPXgubj94LmsveC5uOjA7eC5sbz13WzBdO3guaGk9d1sxXX0KIHJldHVybiB0Owp9CgovKiDmlrDjg6Ljg4fjg6vjga7lhaXlipvvvJrnj77ooYzjg6Ljg4fjg6vjga7nibnlvrTph48oMTcpIO+8iyDjgqrjg4PjgrrnibnlvrTph48oNywg44Gq44GR44KM44GwMCkg77yLIOOCquODg+OCuuacieeEoSDvvIsg44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546HKDMpICovCmZ1bmN0aW9uIHVwWCh1LGUpewogY29uc3Qgb2Rkcz11Lm1vZGU9PT0ib2RkcyI7CiByZXR1cm5bLi4udS5mLnNsaWNlKDEsMTgpLC4uLihvZGRzP3UuZi5zbGljZSgxOCwyNSk6WzAsMCwwLDAsMCwwLDBdKSxvZGRzPzE6MCwuLi5lXTsKfQpmdW5jdGlvbiB1cHNldEN1c3RvbShNLHUsZSxwYyxzaW0pewogaWYoIU0pcmV0dXJuIG51bGw7CiBsZXQgejtjb25zdCB6MD1sZ3QodS5wMCkseHg9KCk9PntsZXQgeD11cFgodSxlKTtpZihNLnBhY2UpeD1bLi4ueCwuLi4ocGN8fFswLDAsMCwwLDBdKV07aWYoTS5zaW0peD1bLi4ueCxzaW0/MTowLC4uLihzaW18fFswLDAsMF0pXTtyZXR1cm4geH07CiBpZihNLmtpbmQ9PT0ib2xkIil6PXowOwogZWxzZSBpZihNLmtpbmQ9PT0ibmV3Iil6PXByZWRMb2dpdChNLm1vZGVsLHh4KCkpOwogZWxzZSBpZihNLmtpbmQ9PT0iYmxlbmQiKXo9KHowK3ByZWRMb2dpdChNLm1vZGVsLHh4KCkpKS8yOwogZWxzZSByZXR1cm4gbnVsbDsKIGNvbnN0IHA9c2lnbSh6KSxnPWdyYWRlT2YoTS5jdXRzLHApLHI9TS5yYXRlcyYmTS5yYXRlc1tnXXx8e307CiByZXR1cm57Z3JhZGU6ZyxwLHJhdGU6ci5yYXRlPz9udWxsLGxvOnIubG8/P251bGwsaGk6ci5oaT8/bnVsbCxuOnIubj8/MH07Cn0KY29uc3QgZ2V0VXBzZXRNb2RlbD0oKT0+e3RyeXtjb25zdCBtPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oVVBLRVkpfHwibnVsbCIpO3JldHVybiBtJiZtLmN1dHMmJm0udmVyPT09Mz9tOm51bGx9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsgICAvLyB2ZXI6Mu+8neODrOODvOOCueeVquWPt+OBrueJueW+tOmHj+OBpOOBjeOAguWPpOOBhOS/neWtmOOBr+S9v+OCj+OBquOBhAoKLyogLS0tLS0tLS0tLSDmpJzoqLzjgajlho3moKHmraPjga7mnKzkvZMgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBydW5VcHNldEZpdChvcHRzKXsKIG9wdHM9b3B0c3x8e307CiBjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiMjAyMS0wMS0wMSIsVEVTVD1vcHRzLnRlc3RTdGFydHx8TU9ERUxfVFJBSU5fRU5ELG91dD1bXTsKIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7CiBjb25zdCBtYXA9bmV3IE1hcCgpOwogYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiBpZihyYWNlcy5sZW5ndGg8NTAwKXtidXN5KGZhbHNlKTtyZXR1cm57ZXJyb3I6IumBjuWOu+ODh+ODvOOCv+OBjOWwkeOBquOBmeOBjuOBvuOBme+8iCIrcmFjZXMubGVuZ3RoKyLjg6zjg7zjgrnvvInjgILlhYjjgavpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgIIifX0KIGNvbnN0IHN0b3JlPW5ldyBVRS5TdG9yZSgpLHByaT1uZXcgVXBQcmkoKSxwcHJpPW5ldyBQb3BQcmkoKSxTPVtdOwogZm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSsrKXsKICBjb25zdCByYz1yYWNlc1tpXSxhbT1uZXcgTWFwKCk7Zm9yKGNvbnN0IHIgb2YgcmMucm93cylhZ2dBZGQoYW0scik7CiAgY29uc3QgaW5mbz1hZ2dJbmZvKGFtLmdldChTdHJpbmcocmMucm93c1swXSYmcmMucm93c1swXS5yYWNlSWQpKSk7CiAgaWYoaW5mbyYmaW5mby55IT1udWxsJiZyYy5kYXRlPj1TVEFSVCl7CiAgIGNvbnN0IFI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSk7CiAgIGNvbnN0IGhhc09kZHM9Ui5ldmVyeShyPT5yLm9kZHM+MSksb2Q9aGFzT2Rkcz9SLm1hcChyPT5yLm9kZHMpOm51bGw7CiAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgIHRyeXsKICAgIGNvbnN0IGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKSx1PVVFLnVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZCxhcCk7CiAgICBjb25zdCBwb3BzPVIubWFwKHI9PnIucG9wKSxwb3BzT2s9Ui5sZW5ndGg+PTYmJnBvcHMuZXZlcnkodj0+dj4wKTsKICAgIGxldCB1MD1udWxsO2lmKG9kKXt0cnl7dTA9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG51bGwsVUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsbnVsbCkpfWNhdGNoKGUpe319ICAgLy8g44Kq44OD44K65pyq5Y+W5b6X44Gu44Go44GN55So77yI5ZCM44GY44Os44O844K544KS44CB44Kq44OD44K644Gq44GX44Gu54m55b6044Gn5L2c44Gj44Gf44KC44Gu77yJCiAgICBTLnB1c2goe2RhdGU6cmMuZGF0ZSx1LHUwLGRyb3BPZGRzOihpKjQwNTAzPj4+MCklMTA8MyxlOnByaS5mZWF0KGluZm8pLHBjOnBhY2VGZWF0KFIsc3RvcmUpLHNpbTpwb3BzT2s/c2ltRmVhdChhcC5wUCxwb3BzLFIubGVuZ3RoLHBwcmkpOm51bGwsa2VlcDooaSoyNjU0NDM1NzYxPj4+MCklMTA+PTMseTppbmZvLnl9KTsKICAgfWNhdGNoKGUpe30KICB9CiAgcHJpLmFkZChpbmZvKTsKICB7Y29uc3QgUlI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpO2lmKFJSLmxlbmd0aD49NiYmUlIuZXZlcnkocj0+ci5wb3A+MCkmJiFSUi5zb21lKHI9Pi/pmpzlrrMvLnRlc3QoU3RyaW5nKHIucmFjZU5hbWV8fCIiKSkpKXBwcmkuYWRkKFJSLm1hcChyPT5bci5wb3Asci5maW5pc2hdKSxSUi5sZW5ndGgpfQogIGZvcihjb25zdCByIG9mIHJjLnJvd3Mpe3IuY2Y9Y29ybmVyRnJhYyhyLmNvcm5lcixyYy5yb3dzLmxlbmd0aCk7c3RvcmUuYWRkKHIpfQogIGlmKGklMzA9PT0yOSl7YnVzeSh0cnVlLGDmmYLns7vliJfjgavlho3nj77jgZfjgabmpJzoqLzkuK3igKYgJHtpKzF9LyR7cmFjZXMubGVuZ3RofeODrOODvOOCuWApO2F3YWl0IHNsZWVwKDApfQogfQogYnVzeSh0cnVlLCLjg6Ljg4fjg6vjgpLmr5TovIPkuK3igKYiKTthd2FpdCBzbGVlcCgwKTsKIGNvbnN0IHRyYWluPVMuZmlsdGVyKHM9PnMuZGF0ZTxURVNUKSx0ZXN0PVMuZmlsdGVyKHM9PnMuZGF0ZT49VEVTVCk7CiBjb25zdCByZXM9e25BbGw6Uy5sZW5ndGgsblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCxzdGFydDpTVEFSVCx0ZXN0U3RhcnQ6VEVTVCxiYXNlOlMubGVuZ3RoP1MucmVkdWNlKChhLHMpPT5hK3MueSwwKS9TLmxlbmd0aDowfTsKIGlmKHRlc3QubGVuZ3RoPDMwMHx8dHJhaW4ubGVuZ3RoPDE1MDApe2J1c3koZmFsc2UpO3JldHVybnsuLi5yZXMsZXJyb3I6YOaknOiovOOBq+S9v+OBiOOCi+acn+mWk+OBruODrOODvOOCueOBjOi2s+OCiuOBvuOBm+OCk++8iOWtpue/kuWBtCR7dHJhaW4ubGVuZ3RofeODu+aknOiovOWBtCR7dGVzdC5sZW5ndGh977yJ44CC5qSc6Ki844Gu6ZaL5aeL5pel44KS5pep44KB44KL44GL44CB44OH44O844K/44KS5aKX44KE44GX44Gm44GP44Gg44GV44GE44CCYH19CiBjb25zdCB5VD10ZXN0Lm1hcChzPT5zLnkpLHkwPXRyYWluLm1hcChzPT5zLnkpOwogLy8g54++6KGM44Oi44OH44Or44Gu5qSc6Ki85pyf6ZaT44Gn44Gu5oiQ57i+CiBjb25zdCBwMD10ZXN0Lm1hcChzPT5zLnUucDApLG0wPW1ldHJpY3NPZihwMCx5VCk7CiAvLyDmlrDjg6Ljg4fjg6vvvIjlrabnv5LmnJ/plpPjga7jgb/jgafkvZzjgovvvInjgILluILloLTovrzjgb/jga7nibnlvrQoc2ltKeODu+ODmuODvOOCueOBr+OAgeS9v+OBiOOCi+OBqOOBjeOBoOOBkeippuOBl+OBpuOAgeiJr+OBj+OBquOCjOOBsOi2s+OBmQogY29uc3QgeEZvcj0ocyxmbCxpc1RyYWluKT0+ewogIGxldCB4PXVwWCgoaXNUcmFpbiYmcy51MCYmcy5kcm9wT2Rkcyk/cy51MDpzLnUscy5lKTsgICAvLyDlrabnv5Ljgafjga8z5Ymy44Gu44Os44O844K544Gn44CB44Kq44OD44K66L6844G/44Gu54m55b6044KS44Kq44OD44K644Gq44GX44Gu54m55b6044Gr572u44GN5o+b44GI44CB44Kq44OD44K65pyq5Y+W5b6X44Gu44Go44GN44Gr44KC5a++5b+c44Gn44GN44KL44KI44GG44Gr44GZ44KLCiAgaWYoZmwucGFjZSl4PVsuLi54LC4uLnMucGNdOwogIGlmKGZsLnNpbSl7Y29uc3QgdXNlPXMuc2ltJiYoIWlzVHJhaW58fHMua2VlcCk7eD1bLi4ueCx1c2U/MTowLC4uLih1c2U/cy5zaW06WzAsMCwwXSldfSAgIC8vIOWtpue/kuOBp+OBrzPlibLjga7jg6zjg7zjgrnjgafluILloLTovrzjgb/jga7nibnlvrTjgpLpmqDjgZfjgIHkurrmsJfjgYzmnKrnorrlrprjga7jgajjgY3jgavjgoLlr77lv5zjgafjgY3jgovjgojjgYbjgavjgZnjgosKICByZXR1cm4geDsKIH07CiBjb25zdCBmaXQ9Zmw9PnsKICBjb25zdCBtPWZpdExvZ2l0KHRyYWluLm1hcChzPT54Rm9yKHMsZmwsdHJ1ZSkpLHkwLDMpOwogIGNvbnN0IHo9dGVzdC5tYXAocz0+cHJlZExvZ2l0KG0seEZvcihzLGZsLGZhbHNlKSkpOwogIHJldHVybntmbCxtLG1OOm1ldHJpY3NPZih6Lm1hcChzaWdtKSx5VCksbUI6bWV0cmljc09mKHoubWFwKCh2LGkpPT5zaWdtKChsZ3QocDBbaV0pK3YpLzIpKSx5VCl9OwogfTsKIGNvbnN0IFY9e2Jhc2U6Zml0KHtwYWNlOmZhbHNlLHNpbTpmYWxzZX0pfTsKIGNvbnN0IGNvdlRyPXRyYWluLmZpbHRlcihzPT5zLnBjWzBdPjApLmxlbmd0aCxjb3ZUZT10ZXN0LmZpbHRlcihzPT5zLnBjWzBdPjApLmxlbmd0aCxwYWNlT2s9Y292VHI+PTQwMCYmY292VGU+PTEwMDsKIGNvbnN0IHNpbVRyPXRyYWluLmZpbHRlcihzPT5zLnNpbSkubGVuZ3RoLHNpbVRlPXRlc3QuZmlsdGVyKHM9PnMuc2ltKS5sZW5ndGgsc2ltT2s9c2ltVHI+PTEwMDAmJnNpbVRlPj0yMDA7CiByZXMucGFjZT17Y292VHJhaW46Y292VHIsY292VGVzdDpjb3ZUZSx1c2VkOmZhbHNlfTtyZXMuc2ltPXt0cmFpbk46c2ltVHIsdGVzdE46c2ltVGUsdXNlZDpmYWxzZX07CiBpZihzaW1PaylWLnNpbT1maXQoe3BhY2U6ZmFsc2Usc2ltOnRydWV9KTsKIGlmKHBhY2VPaylWLnBhY2U9Zml0KHtwYWNlOnRydWUsc2ltOmZhbHNlfSk7CiBpZihwYWNlT2smJnNpbU9rKVYuYm90aD1maXQoe3BhY2U6dHJ1ZSxzaW06dHJ1ZX0pOwogcmVzLm0wPW0wO3Jlcy5tTj1WLmJhc2UubU47cmVzLm1CPVYuYmFzZS5tQjsKIGlmKFYuc2ltKXJlcy5tUz1WLnNpbS5tTjtpZihWLnBhY2UpcmVzLm1QPVYucGFjZS5tTjtpZihWLmJvdGgpcmVzLm1QUz1WLmJvdGgubU47CiBsZXQgY3VyPVYuYmFzZTsKIGlmKFYuc2ltJiZjdXIubU4ubGwtVi5zaW0ubU4ubGw+PS4wMDEpY3VyPVYuc2ltOwoge2NvbnN0IGNhbmQ9Y3VyLmZsLnNpbT9WLmJvdGg6Vi5wYWNlO2lmKGNhbmQmJmN1ci5tTi5sbC1jYW5kLm1OLmxsPj0uMDAxKWN1cj1jYW5kfQogY29uc3QgZmxjPWN1ci5mbCx1c2VQYWNlPSEhZmxjLnBhY2UsdXNlU2ltPSEhZmxjLnNpbTsKIHJlcy5wYWNlLnVzZWQ9dXNlUGFjZTtyZXMuc2ltLnVzZWQ9dXNlU2ltO3Jlcy51c2VQYWNlPXVzZVBhY2U7cmVzLnVzZVNpbT11c2VTaW07CiAvLyDmjqHnlKjjga7liKTmlq3vvJrnj77ooYzjgojjgorlr77mlbDmkI3lpLHjgYwwLjAwMuS7peS4iuiJr+OBj+OBquOCiuOAgUFVQ+OBjOaCquWMluOBl+OBpuOBhOOBquOBhOOBk+OBqAogY29uc3QgYmV0dGVyPShtLHJlZik9PihyZWYubGwtbS5sbD49LjAwMikmJihtLmF1Yz49cmVmLmF1Yy0uMDAzKTsKIGxldCBraW5kPSJvbGQiOwogY29uc3Qga2M9W1sibmV3IixjdXIubU5dLFsiYmxlbmQiLGN1ci5tQl1dLmZpbHRlcigoW2ssbV0pPT5iZXR0ZXIobSxtMCkpLnNvcnQoKGEsYik9PmFbMV0ubGwtYlsxXS5sbClbMF07CiBpZihrYylraW5kPWtjWzBdOwogY29uc3QgTTI9Y3VyLm0seHg9cz0+eEZvcihzLGZsYyxmYWxzZSk7CiByZXMua2luZD1raW5kOwogLy8g562J57Sa44Gu5YiH44KM55uu44Gv44CM5a2m57+S5YG044CN44Gu5LqI5ris44GL44KJ5rG644KB44CB5qSc6Ki85YG044Gn5a6f6Zqb44Gu5rOi5Lmx546H44KS5ris44KL77yI5q2j55u044Gq5a6f57i+546H77yJCiBjb25zdCBwcmVkVHJhaW49cz0+a2luZD09PSJvbGQiP3MudS5wMDpraW5kPT09Im5ldyI/c2lnbShwcmVkTG9naXQoTTIseHgocykpKTpzaWdtKChsZ3Qocy51LnAwKStwcmVkTG9naXQoTTIseHgocykpKS8yKTsKIGNvbnN0IGN1dHM9bWFrZUN1dHModHJhaW4ubWFwKHByZWRUcmFpbikpOwogY29uc3QgcFRlc3Q9dGVzdC5tYXAocHJlZFRyYWluKSx0YWI9Z3JhZGVUYWJsZShjdXRzLHBUZXN0LHlUKTsKIHJlcy5jdXRzPWN1dHM7cmVzLnRhYj10YWI7CiByZXMubW9kZWw9e3ZlcjozLGtpbmQscGFjZTp1c2VQYWNlLHNpbTp1c2VTaW0sbW9kZWw6TTIsY3V0cyxyYXRlczpPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModGFiKS5tYXAoKFtnLHhdKT0+W2cse3JhdGU6eC5yYXRlLGxvOngubG8saGk6eC5oaSxuOngubn1dKSksCiAgYXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLG5UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsdGVzdFN0YXJ0OlRFU1QsbTAsbU46cmVzLm1OLG1COnJlcy5tQixtUDpyZXMubVB8fG51bGwsbVM6cmVzLm1TfHxudWxsLG1QUzpyZXMubVBTfHxudWxsLHBhY2VDb3Y6W2NvdlRyLGNvdlRlXSxzaW1Db3Y6W3NpbVRyLHNpbVRlXX07CiBidXN5KGZhbHNlKTtyZXR1cm4gcmVzOwp9CgpmdW5jdGlvbiB1cHNldFJlcG9ydChyKXsKIGlmKHIuZXJyb3IpcmV0dXJuYDxzcGFuIGNsYXNzPSJiYWQiPiR7ZXNjKHIuZXJyb3IpfTwvc3Bhbj5gOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCkscm93PShsLG0pPT5gPHRyPjx0ZD4ke2x9PC90ZD48dGQ+JHtmKG0ubGwpfTwvdGQ+PHRkPiR7ZihtLmJyaWVyKX08L3RkPjx0ZD4ke20uYXVjLnRvRml4ZWQoMyl9PC90ZD48dGQ+JHsobS5lY2UqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjwvdHI+YDsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S5YG0ICR7ci5uVHJhaW5944Os44O844K577yI44CcJHtlc2Moci50ZXN0U3RhcnQpfeOBruWJjeaXpe+8ie+8j+aknOiovOWBtCAke3IublRlc3R944Os44O844K577yIJHtlc2Moci50ZXN0U3RhcnQpfeS7pemZje+8neePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8ieOAguWFqOS9k+OBruazouS5seeOhyAke3BjdChyLmJhc2UsMSl944CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+44Oi44OH44Or77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+6Kqk5beu4oaTPC90aD48dGg+QVVD4oaRPC90aD48dGg+6LyD5q2j6Kqk5beu4oaTPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PiR7cm93KCLnj77ooYwiLHIubTApfSR7cm93KCLmlrDvvIjjgrPjg7zjgrnliKXjgpLov73liqDvvIkiLHIubU4pfSR7cm93KCLnj77ooYzjgajmlrDjga7lubPlnYciLHIubUIpfSR7ci5tUz9yb3coIuaWsO+8iOOCs+ODvOOCueWIpe+8i+W4guWgtOi+vOOBv+OBrueiuueOh++8iSIsci5tUyk6IiJ9JHtyLm1QP3Jvdygi5paw77yI44Kz44O844K55Yil77yL44Oa44O844K577yJIixyLm1QKToiIn0ke3IubVBTP3Jvdygi5paw77yI44GZ44G544Gm77yJIixyLm1QUyk6IiJ9PC90Ym9keT48L3RhYmxlPjwvZGl2PmA7CiBoKz1yLnNpbSYmci5zaW0udGVzdE4+PTIwMD9gPGRpdiBjbGFzcz0ic21hbGwiPuW4guWgtOi+vOOBv+OBrueJueW+tO+8iOWQhOmmrOOBrueiuueOh+OBqOS6uuawl+mghuS9jeOBi+OCieOAgeazouS5seOBq+OBquOCi+eiuueOh+OCkuebtOaOpeimi+epjeOCguOCi++8ie+8muWtpue/kuWBtCR7ci5zaW0udHJhaW5OfeODu+aknOiovOWBtCR7ci5zaW0udGVzdE5944Os44O844K544Gn5L2/44GI44G+44GX44Gf44CCJHtyLnVzZVNpbT8iPGI+5Yqg44GI44KL44Go5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Gf44KB5o6h55So44GX44G+44GX44Gf44CCPC9iPiI6IuWKoOOBiOOBpuOCguaYjueiuuOBquaUueWWhOOBr+OBquOBi+OBo+OBn+OBn+OCgeOAgeaOoeeUqOOBl+OBpuOBhOOBvuOBm+OCk+OAgiJ9PC9kaXY+YDpgPGRpdiBjbGFzcz0ic21hbGwiPuW4guWgtOi+vOOBv+OBrueJueW+tO+8muS6uuawl+mghuS9jeOBpOOBjeOBruaIkOe4vuOBjOWwkeOBquOBj+OAgeaknOiovOOBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAgjwvZGl2PmA7CiBoKz1yLnBhY2UmJnIucGFjZS51c2VkP2A8ZGl2IGNsYXNzPSJzbWFsbCI+44Oa44O844K544O76ISa6LOq44Gu54m55b606YeP77ya5a2m57+S5YG0JHtyLnBhY2UuY292VHJhaW5944O75qSc6Ki85YG0JHtyLnBhY2UuY292VGVzdH3jg6zjg7zjgrnjgafkvb/jgYjjgb7jgZfjgZ/jgIIke3IudXNlUGFjZT8iPGI+44Oa44O844K544KS5Yqg44GI44KL44Go5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Gf44KB5o6h55So44GX44G+44GX44Gf44CCPC9iPiI6IuODmuODvOOCueOCkuWKoOOBiOOBpuOCguaYjueiuuOBquaUueWWhOOBr+OBquOBi+OBo+OBn+OBn+OCgeOAgeaOoeeUqOOBl+OBpuOBhOOBvuOBm+OCk+OAgiJ9PC9kaXY+YDpgPGRpdiBjbGFzcz0ic21hbGwiPuODmuODvOOCueODu+iEmuizqu+8mumAmumBjumghuS9jeOBpOOBjeOBruaIkOe4vuOBjOWwkeOBquOBj++8iOWtpue/kuWBtCR7ci5wYWNlP3IucGFjZS5jb3ZUcmFpbjowfeODu+aknOiovOWBtCR7ci5wYWNlP3IucGFjZS5jb3ZUZXN0OjB944Os44O844K577yJ44CB5qSc6Ki844Gn44GN44G+44Gb44KT44Gn44GX44Gf44CC6Kit5a6a44Gu44CM44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GX44CN44KS5a6f6KGM44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKIGNvbnN0IG5tPXtvbGQ6IuePvuihjOODouODh+ODq+OBruOBvuOBvu+8iOaWsOODouODh+ODq+OBr+aYjueiuuOBq+OBr+iJr+OBj+OBquOCieOBquOBi+OBo+OBn++8iSIsbmV3OiLmlrDjg6Ljg4fjg6vjgpLmjqHnlKgiKyhyLnVzZVNpbT8i77yI5biC5aC06L6844G/77yJIjoiIikrKHIudXNlUGFjZT8i77yI44Oa44O844K56L6844G/77yJIjoiIiksYmxlbmQ6IuePvuihjOOBqOaWsOOBruW5s+Wdh+OCkuaOoeeUqCIrKHIudXNlU2ltPyLvvIjluILloLTovrzjgb/vvIkiOiIiKSsoci51c2VQYWNlPyLvvIjjg5rjg7zjgrnovrzjgb/vvIkiOiIiKX1bci5raW5kXTsKIGgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgJHtyLmtpbmQ9PT0ib2xkIj8id24iOiJvayJ9Ij48Yj7ntZDmnpzvvJoke25tfTwvYj48YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mjqHnlKjmnaHku7bvvJrlr77mlbDmkI3lpLHjgYwwLjAwMuS7peS4iuaUueWWhOOBl+OAgUFVQ+OBjOaCquWMluOBl+OBpuOBhOOBquOBhOOBk+OBqOOAgjwvc3Bhbj48L2Rpdj5gOwogaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7nrYnntJrjgZTjgajjga48Yj7lrp/pmpvjga7ms6LkubHnjoc8L2I+77yI5qSc6Ki85YG044O7OTUl44Gu5bmF77yJ44CC44GT44Gu5pWw5a2X44GM44CB5rOi5Lmx5bqm44K/44OW44Gr6KGo56S644GV44KM44KL44KI44GG44Gr44Gq44KK44G+44GZ44CCPC9kaXY+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuetiee0mjwvdGg+PHRoPuODrOODvOOCueaVsDwvdGg+PHRoPuWun+mam+OBruazouS5seeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IFtnXSBvZiBVUF9TSEFSRSl7Y29uc3QgeD1yLnRhYltnXTtoKz1gPHRyPjx0ZD4ke2d9PC90ZD48dGQ+JHt4Lm59PC90ZD48dGQ+PGI+JHtwY3QoeC5yYXRlLDEpfTwvYj48L3RkPjx0ZD4ke3BjdCh4LmxvKX3jgJwke3BjdCh4LmhpKX08L3RkPjwvdHI+YH0KIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIGNvbnN0IG1vbm89VVBfU0hBUkUubWFwKChbZ10pPT5yLnRhYltnXS5yYXRlKS5ldmVyeSgodixpLGEpPT5pPT09MHx8djw9YVtpLTFdKy4wMyk7CiBpZighbW9ubyloKz0nPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+562J57Sa44Gu6aCG44Gr5a6f57i+546H44GM5Y2Y6Kq/44Gr5LiL44GM44Gj44Gm44GE44G+44Gb44KT44CC5qSc6Ki85YG044Gu44Os44O844K55pWw44GM5bCR44Gq44GE44Go6LW344GN44G+44GZ77yI5YG254S244Gu56+E5Zuy44Gu44GT44Go44GM5aSa44GE77yJ44CCPC9kaXY+JzsKIHJldHVybiBoOwp9CmZ1bmN0aW9uIHVwc2V0U3RhdHVzTGluZSgpewogY29uc3QgTT1nZXRVcHNldE1vZGVsKCk7CiBpZighTSlyZXR1cm4nPGRpdiBjbGFzcz0ic21hbGwiPuaomea6luODouODh+ODq++8iOWtpue/kua4iOOBv+OBruWbuuWumuODouODh+ODq++8ieOAguWun+e4vueOh+OBr+Wtpue/kuaZguOBruaVsOWtl+OBp+OBmeOAguOAjOaknOiovOOAjeOCv+ODluOBp+OAgeiHquWIhuOBruODh+ODvOOCv+OBp+OBruaknOiovOODu+WGjeagoeato+OBjOOBp+OBjeOBvuOBmeOAgjwvZGl2Pic7CiBjb25zdCBubT17b2xkOiLnj77ooYzjg6Ljg4fjg6siLG5ldzoi5YaN5qCh5q2j44GX44Gf5paw44Oi44OH44OrIixibGVuZDoi54++6KGM44Go5paw44Gu5bmz5Z2HIn1bTS5raW5kXTsKIHJldHVybmA8ZGl2IGNsYXNzPSJzbWFsbCI+PGI+JHtubX08L2I+44Gn5Yik5a6a5Lit77yI5qSc6Ki85pelICR7ZXNjKE0uYXQpfe+8j+aknOiovCAke00ublRlc3R944Os44O844K577yJ44CC562J57Sa44Gu5a6f57i+546H44Gv44CB44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT44Gn5ris44Gj44Gf5YCk44Gn44GZ44CCPC9kaXY+YDsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOWlvei1sOeOh++8iOikh+WLneWcj+WGheeOh++8ieOBruaknOiovOODu+WGjeagoeatowogKiAg55uu55qE77ya5ZCE6aas44Gu44CMM+edgOS7peWGheOBq+WFpeOCi+eiuueOhyglKeOAjeOCkuOAgeWun+mam+OBrueahOS4reeOh+OBq+WQiOOBhuaVsOWtl+OBq+OBmeOCi+OAggogKiAg44KE44KL44GT44Go77yaCiAqICAgMSkg6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44Gr5YaN54++44GX44CB44Os44O844K55YmN44Gr5YiG44GL44KL5oOF5aCx44Gg44GR44Gn5ZCE6aas44Gu56K6546H44KS6KiI566XCiAqICAgICAgICDjg7vpgY7ljrvmiJDnuL7jgYvjgonkvZzjgovjg6Ljg4fjg6vjga7norrnjofvvIjjgqrjg4PjgrrjgpLkvb/jgo/jgarjgYTvvIkKICogICAgICAgIOODu+S6uuawl+mghuS9jcOX6aCt5pWw44GU44Go44Gu44CB6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh++8iOW4guWgtOOBruaDheWgseOAguOCquODg+OCuuWPluW+l+W+jOOBr+S6uuawl+mghuS9jeOBjOaxuuOBvuOCi++8iQogKiAgIDIpIDLjgaTjgpLntYTjgb/lkIjjgo/jgZvjgZ/mlrDjg6Ljg4fjg6vvvIjjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDvvInjgpLjgIHlrabnv5LlgbTjga7mnJ/plpPjgafkvZzjgosKICogICAzKSDnj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIhNT0RFTF9UUkFJTl9FTkTku6XpmY3vvInjgafjgIHlrp/pmpvjga7nmoTkuK3njofjgajnqoHjgY3lkIjjgo/jgZvjgosKICogICA0KSDmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgajjgY3jgaDjgZHmjqHnlKjjgILotoXpiYTmnb/vvIg5NSXku6XkuIrvvInjga7liIfjgoznm67jgoLjgIHjgZPjga7mnJ/plpPjga7lrp/nuL7jgYvjgonmsbrjgoHjgosKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBQTEtFWT0ia2VpYmFfcGxhY2VfdjEiOwoKLyog5Lq65rCX6aCG5L2Nw5fpoK3mlbDjgZTjgajjga7jgIHpgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H77yI5bCR44Gq44GE44OH44O844K/44GvMy/poK3mlbDjgbjlr4TjgZvjgovvvIkgKi8KY2xhc3MgUG9wUHJpewogY29uc3RydWN0b3IoKXt0aGlzLm09bmV3IE1hcCgpfQoga2V5KHBvcCxOKXtyZXR1cm4gTWF0aC5taW4oMTgscG9wKSsifCIrTWF0aC5taW4oMTgsTWF0aC5tYXgoNixOKSl9CiBhZGQobGlzdCxOKXsKICBmb3IoY29uc3QgW3BvcCxmaW5dIG9mIGxpc3QpewogICBpZighKHBvcD4wKXx8ZmluPT1udWxsKWNvbnRpbnVlOwogICBjb25zdCBrPXRoaXMua2V5KHBvcCxOKTtsZXQgeD10aGlzLm0uZ2V0KGspO2lmKCF4KXRoaXMubS5zZXQoayx4PXtuOjAsdDowfSk7CiAgIHgubisrO2lmKGZpbjw9Myl4LnQrKzsKICB9CiB9CiByYXRlKHBvcCxOKXsKICBjb25zdCB4PXRoaXMubS5nZXQodGhpcy5rZXkocG9wLE4pKXx8e246MCx0OjB9LGJhc2U9TWF0aC5taW4oLjk1LDMvTWF0aC5tYXgoTiwzKSksSz0zMDsKICByZXR1cm4oeC50K0sqYmFzZSkvKHgubitLKTsKIH0KfQovKiDnorrnjofjga7lkIjoqIjjgpLjgaHjgofjgYbjgal0YXJnZXTjgavjgZnjgovvvIjjg63jgrjjg4Pjg4jjgpLkuIDmp5jjgavjgZrjgonjgZnvvIkgKi8KZnVuY3Rpb24gbm9ybVN1bSh6LHRhcmdldCl7CiBsZXQgbG89LTE0LGhpPTE0OwogZm9yKGxldCBpdD0wO2l0PDYwO2l0Kyspe2NvbnN0IG1pZD0obG8raGkpLzI7bGV0IHM9MDtmb3IoY29uc3QgdiBvZiB6KXMrPXNpZ20odittaWQpO2lmKHM+dGFyZ2V0KWhpPW1pZDtlbHNlIGxvPW1pZH0KIGNvbnN0IGM9KGxvK2hpKS8yO3JldHVybiB6Lm1hcCh2PT5zaWdtKHYrYykpOwp9Ci8qIDHpoK3jga7lhaXlipvvvJrjg6Ljg4fjg6vnorrnjofjg7vkurrmsJfjg5njg7zjgrnjga7lrp/nuL7njofjg7vkurrmsJfjga7kvY3nva7jg7vpoK3mlbDjg7vjg6Ljg4fjg6vlhoXjga7poIbkvY0gKi8KZnVuY3Rpb24gcGxhY2VYKHBQLHBvcCxOLHByaSxyYW5rRnJhYyl7CiByZXR1cm5bbGd0KHBQKSxsZ3QocHJpLnJhdGUocG9wLE4pKSwocG9wLTEpL01hdGgubWF4KDEsTi0xKSxOLzE2LHJhbmtGcmFjLHBvcD09PTE/MTowLHBvcDw9Mz8xOjBdOwp9CmNvbnN0IHJhbmtGcmFjcz1wcz0+e2NvbnN0IG89cHMubWFwKChwLGkpPT5pKS5zb3J0KChhLGIpPT5wc1tiXS1wc1thXSkscms9QXJyYXkocHMubGVuZ3RoKTtvLmZvckVhY2goKGkscik9PnJrW2ldPXIvTWF0aC5tYXgoMSxwcy5sZW5ndGgtMSkpO3JldHVybiBya307CmNvbnN0IHBvcHNGcm9tT2Rkcz1vZD0+b2QubWFwKHY9PjErb2QuZmlsdGVyKHc9Pnc8dikubGVuZ3RoKTsKCmNvbnN0IGdldFBsYWNlTW9kZWw9KCk9Pnt0cnl7Y29uc3QgbT1KU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKFBMS0VZKXx8Im51bGwiKTtyZXR1cm4gbSYmbS5raW5kPT09Im5ldyImJm0ubW9kZWwmJm0udmVyPT09MT9tOm51bGx9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsKCi8qIOWPjeW/nOOBrueiuuiqjeeUqO+8muS6iOa4rOOBruWMuumWk+OBlOOBqOOBruWun+e4vu+8iOS/oemgvOaAp++8iSAqLwpmdW5jdGlvbiByZWxpYWJpbGl0eUJpbnMocCx5LEIpewogY29uc3QgaWR4PXAubWFwKChfLGkpPT5pKS5zb3J0KChhLGIpPT5wW2FdLXBbYl0pLG49eS5sZW5ndGgsb3V0PVtdOwogZm9yKGxldCBiPTA7YjxCO2IrKyl7CiAgY29uc3Qgcz1pZHguc2xpY2UoTWF0aC5mbG9vcihiKm4vQiksTWF0aC5mbG9vcigoYisxKSpuL0IpKTtpZighcy5sZW5ndGgpY29udGludWU7CiAgY29uc3Qgaz1zLnJlZHVjZSgoYSxpKT0+YSt5W2ldLDApLHc9d2lsc29uKGsscy5sZW5ndGgpOwogIG91dC5wdXNoKHtsbzpwW3NbMF1dLGhpOnBbc1tzLmxlbmd0aC0xXV0sbjpzLmxlbmd0aCxtZWFuOnMucmVkdWNlKChhLGkpPT5hK3BbaV0sMCkvcy5sZW5ndGgsYWN0Omsvcy5sZW5ndGgsd2xvOndbMF0sd2hpOndbMV19KTsKIH0KIHJldHVybiBvdXQ7Cn0KZnVuY3Rpb24gdGhyZXNob2xkUm93KHAseSx0KXsKIGxldCBuPTAsaz0wO2ZvcihsZXQgaT0wO2k8cC5sZW5ndGg7aSsrKWlmKHBbaV0+PXQpe24rKztrKz15W2ldfQogY29uc3Qgdz13aWxzb24oayxuKTtyZXR1cm57dCxuLGsscmF0ZTpuP2svbjowLGxvOndbMF0saGk6d1sxXX07Cn0KCi8qIC0tLS0tLS0tLS0g5qSc6Ki844Go5YaN5qCh5q2j44Gu5pys5L2TIC0tLS0tLS0tLS0gKi8KYXN5bmMgZnVuY3Rpb24gcnVuUGxhY2VGaXQob3B0cyl7CiBvcHRzPW9wdHN8fHt9OwogY29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IjIwMTktMDEtMDEiLFRFU1Q9b3B0cy50ZXN0U3RhcnR8fE1PREVMX1RSQUlOX0VORDsKIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7CiBjb25zdCBtYXA9bmV3IE1hcCgpOwogYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiBpZihyYWNlcy5sZW5ndGg8NTAwKXtidXN5KGZhbHNlKTtyZXR1cm57ZXJyb3I6IumBjuWOu+ODh+ODvOOCv+OBjOWwkeOBquOBmeOBjuOBvuOBme+8iCIrcmFjZXMubGVuZ3RoKyLjg6zjg7zjgrnvvInjgILlhYjjgavpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgIIifX0KIGNvbnN0IHN0b3JlPW5ldyBVRS5TdG9yZSgpLHByaT1uZXcgUG9wUHJpKCksUlM9W107CiBmb3IobGV0IGk9MDtpPHJhY2VzLmxlbmd0aDtpKyspewogIGNvbnN0IHJjPXJhY2VzW2ldLFI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSksTj1SLmxlbmd0aDsKICBjb25zdCB2YWxpZD1OPj04JiZSLmV2ZXJ5KHI9PnIucG9wPjApJiZSLnNvbWUocj0+ci5maW5pc2g9PT0xKTsKICBpZih2YWxpZCYmcmMuZGF0ZT49U1RBUlQmJiEv6Zqc5a6zLy50ZXN0KFN0cmluZyhSWzBdLnJhY2VOYW1lfHwiIikpKXsKICAgY29uc3Qgb2Q9Ui5ldmVyeShyPT5yLm9kZHM+MSk/Ui5tYXAocj0+ci5vZGRzKTpudWxsOwogICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLGdyZDpSWzBdLmdyZHx8MCxydW5uZXJzOlJ9OwogICB0cnl7CiAgICBjb25zdCBhcD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxudWxsKSxhcE89b2Q/VUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2QpOm51bGwscms9cmFua0ZyYWNzKGFwLnBQKTsKICAgIFJTLnB1c2goe2RhdGU6cmMuZGF0ZSxOLGg6Ui5tYXAoKHIsaik9Pih7eDpwbGFjZVgoYXAucFBbal0sci5wb3AsTixwcmkscmtbal0pLHk6ci5maW5pc2g8PTM/MTowLHBQOmFwLnBQW2pdLHByOnByaS5yYXRlKHIucG9wLE4pLHBPOmFwTz9hcE8ucE9bal06bnVsbH0pKX0pOwogICB9Y2F0Y2goZSl7fQogIH0KICBpZih2YWxpZClwcmkuYWRkKFIubWFwKHI9PltyLnBvcCxyLmZpbmlzaF0pLE4pOwogIGZvcihjb25zdCByIG9mIHJjLnJvd3Mpe3IuY2Y9Y29ybmVyRnJhYyhyLmNvcm5lcixyYy5yb3dzLmxlbmd0aCk7c3RvcmUuYWRkKHIpfQogIGlmKGklMzA9PT0yOSl7YnVzeSh0cnVlLGDmmYLns7vliJfjgavlho3nj77jgZfjgabmpJzoqLzkuK3igKYgJHtpKzF9LyR7cmFjZXMubGVuZ3RofeODrOODvOOCuWApO2F3YWl0IHNsZWVwKDApfQogfQogYnVzeSh0cnVlLCLjg6Ljg4fjg6vjgpLmr5TovIPkuK3igKYiKTthd2FpdCBzbGVlcCgwKTsKIGNvbnN0IHRyYWluPVJTLmZpbHRlcihyPT5yLmRhdGU8VEVTVCksdGVzdD1SUy5maWx0ZXIocj0+ci5kYXRlPj1URVNUKTsKIGNvbnN0IHJlcz17blRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCxzdGFydDpTVEFSVCx0ZXN0U3RhcnQ6VEVTVH07CiBpZih0cmFpbi5sZW5ndGg8MTUwMHx8dGVzdC5sZW5ndGg8MzAwKXtidXN5KGZhbHNlKTtyZXR1cm57Li4ucmVzLGVycm9yOmDmpJzoqLzjgavkvb/jgYjjgovjg6zjg7zjgrnjgYzotrPjgorjgb7jgZvjgpPvvIjlrabnv5LlgbQke3RyYWluLmxlbmd0aH3jg7vmpJzoqLzlgbQke3Rlc3QubGVuZ3Rofe+8ieOAguaknOiovOOBrumWi+Wni+aXpeOCkuaXqeOCgeOCi+OBi+OAgeODh+ODvOOCv+OCkuWil+OChOOBl+OBpuOBj+OBoOOBleOBhOOAgmB9fQogLy8g5paw44Oi44OH44Or77ya5a2m57+S5YG044Gu44G/44Gn5L2c44KLCiBjb25zdCBYPVtdLHk9W107Zm9yKGNvbnN0IHIgb2YgdHJhaW4pZm9yKGNvbnN0IGggb2Ygci5oKXtYLnB1c2goaC54KTt5LnB1c2goaC55KX0KIGNvbnN0IG1vZGVsPWZpdExvZ2l0KFgseSw1KTsKIGNvbnN0IGZsYXQ9Zj0+e2NvbnN0IHA9W10seXk9W107Zm9yKGNvbnN0IHIgb2YgdGVzdCl7Y29uc3Qgdj1mKHIpO3IuaC5mb3JFYWNoKChoLGopPT57cC5wdXNoKHZbal0pO3l5LnB1c2goaC55KX0pfXJldHVybntwLHk6eXl9fTsKIGNvbnN0IGROZXc9ZmxhdChyPT5ub3JtU3VtKHIuaC5tYXAoaD0+cHJlZExvZ2l0KG1vZGVsLGgueCkpLDMpKTsKIGNvbnN0IGRQUD1mbGF0KHI9Pm5vcm1TdW0oci5oLm1hcChoPT5sZ3QoaC5wUCkpLDMpKTsKIGNvbnN0IGRNaz1mbGF0KHI9Pm5vcm1TdW0oci5oLm1hcChoPT5sZ3QoaC5wcikpLDMpKTsKIHJlcy5tTmV3PW1ldHJpY3NPZihkTmV3LnAsZE5ldy55KTtyZXMubVBQPW1ldHJpY3NPZihkUFAucCxkUFAueSk7cmVzLm1Naz1tZXRyaWNzT2YoZE1rLnAsZE1rLnkpOwogLy8g54++6KGM44Gu44Kq44OD44K66L6844G/56K6546HKHBPKeOBr+OAgeOCquODg+OCuuOBpOOBjeOBruaIkOe4vuOBjOOBguOCi+acn+mWk+OBoOOBkeavlOOBueOCieOCjOOCiwogY29uc3Qgc3ViPXRlc3QuZmlsdGVyKHI9PnIuaC5ldmVyeShoPT5oLnBPIT1udWxsKSk7CiByZXMubk9kZHNUZXN0PXN1Yi5sZW5ndGg7CiBpZihzdWIubGVuZ3RoPj0xNTApewogIGNvbnN0IHBuPVtdLHBvPVtdLHl5PVtdO2Zvcihjb25zdCByIG9mIHN1Yil7Y29uc3Qgdj1ub3JtU3VtKHIuaC5tYXAoaD0+cHJlZExvZ2l0KG1vZGVsLGgueCkpLDMpO3IuaC5mb3JFYWNoKChoLGopPT57cG4ucHVzaCh2W2pdKTtwby5wdXNoKGgucE8pO3l5LnB1c2goaC55KX0pfQogIHJlcy5tTmV3T2Rkcz1tZXRyaWNzT2YocG4seXkpO3Jlcy5tT2Rkcz1tZXRyaWNzT2YocG8seXkpOwogfQogLy8g5o6h55So44Gu5Yik5patCiBjb25zdCBtPXJlcy5tTmV3OwogbGV0IGFkb3B0PW0ubGw8cmVzLm1QUC5sbC0uMDAzJiZtLmxsPHJlcy5tTWsubGwtLjAwMzsKIGlmKGFkb3B0JiZyZXMubU9kZHMpYWRvcHQ9cmVzLm1OZXdPZGRzLmxsPD1yZXMubU9kZHMubGwtLjAwMDU7CiByZXMuYWRvcHQ9YWRvcHQ7cmVzLnZzT2Rkcz1yZXMubU9kZHM/IuavlOi8g+a4iOOBvyI6IuacquavlOi8gyI7CiAvLyDkv6HpoLzmgKfvvJrkuojmuKzjga7ljLrplpPjgZTjgajjga7lrp/pmpvjga7nmoTkuK3njocKIHJlcy5iaW5zPXJlbGlhYmlsaXR5QmlucyhkTmV3LnAsZE5ldy55LDEwKTsKIHJlcy50aHI9Wy41LC43LC44LC45LC45MiwuOTVdLm1hcCh0PT50aHJlc2hvbGRSb3coZE5ldy5wLGROZXcueSx0KSk7CiByZXMuYmluc1BQPXJlbGlhYmlsaXR5QmlucyhkUFAucCxkUFAueSwxMCk7CiAvLyDotoXpiYTmnb/vvJ3kuojmuKw5NSXku6XkuIrjga7ppqzvvIjkvZXpoK3jgafjgoLvvInjgILmpJzoqLzlgbTjgafjgIHlrp/pmpvjgavjganjgozjgaDjgZHlvZPjgZ/jgaPjgZ/jgYvjgpLoqJjpjLLjgZnjgosKIGxldCBpcm9uPW51bGw7CiB7Y29uc3Qgcm93PXRocmVzaG9sZFJvdyhkTmV3LnAsZE5ldy55LC45NSksZGF5cz1uZXcgU2V0KHRlc3QubWFwKHI9PnIuZGF0ZSkpLnNpemU7CiAgaWYocm93Lm4+MClpcm9uPXtjdXQ6Ljk1LHJhdGU6cm93LnJhdGUsbG86cm93LmxvLG46cm93Lm4scGVyRGF5OmRheXM/cm93Lm4vZGF5czowLGxvd046cm93Lm48MTAwfTt9CiByZXMuaXJvbj1pcm9uOwogcmVzLm1vZGVsPWFkb3B0P3t2ZXI6MSxraW5kOiJuZXciLG1vZGVsLGlyb24sYXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLG5UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsdGVzdFN0YXJ0OlRFU1QsCiAgbU5ldzpyZXMubU5ldyxtUFA6cmVzLm1QUCxtTWs6cmVzLm1NayxtT2RkczpyZXMubU9kZHN8fG51bGwsbU5ld09kZHM6cmVzLm1OZXdPZGRzfHxudWxsLHRocjpyZXMudGhyfTpudWxsOwogYnVzeShmYWxzZSk7cmV0dXJuIHJlczsKfQoKZnVuY3Rpb24gcGxhY2VSZXBvcnQocil7CiBpZihyLmVycm9yKXJldHVybmA8c3BhbiBjbGFzcz0iYmFkIj4ke2VzYyhyLmVycm9yKX08L3NwYW4+YDsKIGNvbnN0IGY9eD0+eC50b0ZpeGVkKDQpLHJvdz0obCxtKT0+YDx0cj48dGQ+JHtsfTwvdGQ+PHRkPiR7ZihtLmxsKX08L3RkPjx0ZD4ke2YobS5icmllcil9PC90ZD48dGQ+JHttLmF1Yy50b0ZpeGVkKDMpfTwvdGQ+PHRkPiR7KG0uZWNlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48L3RyPmA7CiBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPuWtpue/kuWBtCAke3IublRyYWlufeODrOODvOOCue+8j+aknOiovOWBtCAke3IublRlc3R944Os44O844K577yIJHtlc2Moci50ZXN0U3RhcnQpfeS7pemZje+8neePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8ieOAgjHpoK3jgZTjgajjgavjgIwz552A5Lul5YaF44CN44KS5b2T44Gm44Gf5oiQ57i+44Gn44GZ77yIOOmgreS7peS4iuOBruODrOODvOOCue+8ieOAgjwvZGl2PgogPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPueiuueOh+OBruOCguOBqO+8iOaknOiovOWBtO+8iTwvdGg+PHRoPuWvvuaVsOaQjeWkseKGkzwvdGg+PHRoPuiqpOW3ruKGkzwvdGg+PHRoPkFVQ+KGkTwvdGg+PHRoPui8g+ato+iqpOW3ruKGkzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT4KICR7cm93KCLpgY7ljrvmiJDnuL7jg6Ljg4fjg6vjga7jgb8iLHIubVBQKX0ke3Jvdygi5Lq65rCX6aCG5L2N44Gu5a6f57i+44Gu44G/IixyLm1Nayl9JHtyb3coIjxiPuaWsO+8iOS4oeaWueOCkue1hOOBv+WQiOOCj+OBm++8iTwvYj4iLHIubU5ldyl9PC90Ym9keT48L3RhYmxlPjwvZGl2PmA7CiBpZihyLm1PZGRzKWgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K644Gk44GN44Gu5qSc6Ki844OH44O844K/ICR7ci5uT2Rkc1Rlc3R944Os44O844K544Gn44Gu55u05o6l5q+U6LyD77ya54++6KGM77yI44Kq44OD44K66L6844G/77yJ44Gu5a++5pWw5pCN5aSxICR7ZihyLm1PZGRzLmxsKX0g77yPIOaWsCAke2Yoci5tTmV3T2Rkcy5sbCl9PC9kaXY+YDsKIGVsc2UgaCs9YDxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuOCquODg+OCuuOBpOOBjeOBruaknOiovOODh+ODvOOCv+OBjOWwkeOBquOBhOOBn+OCgeOAgeePvuihjOOBruOAjOOCquODg+OCuui+vOOBv+OBrueiuueOh+OAjeOBqOOBruebtOaOpeavlOi8g+OBr+OBp+OBjeOBpuOBhOOBvuOBm+OCk++8iOS6uuawl+mghuS9jeOBr+OAgeOCquODg+OCuuWPluW+l+W+jOOBq+axuuOBvuOCi+WApOOCkuS9v+OBo+OBpuOBhOOBvuOBme+8ieOAgjwvZGl2PmA7CiBoKz1gPGRpdiBjbGFzcz0iYmFubmVyICR7ci5hZG9wdD8ib2siOiJ3biJ9Ij48Yj7ntZDmnpzvvJoke3IuYWRvcHQ/IuaWsOODouODh+ODq+OCkuaOoeeUqO+8iOmAseacq+OBruS6iOaDs+OBrueiuueOh+OBq+WPjeaYoO+8iSI6IuePvuihjOOBruOBvuOBvu+8iOaWsOODouODh+ODq+OBr+aYjueiuuOBq+OBr+iJr+OBj+OBquOCieOBquOBi+OBo+OBn++8iSJ9PC9iPjxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaOoeeUqOadoeS7tu+8mumBjuWOu+aIkOe4vuODouODh+ODq+OBruOBv+ODu+S6uuawl+mghuS9jeOBruOBv+OBruS4oeaWueOCiOOCiuOAgeWvvuaVsOaQjeWkseOBjDAuMDAz5Lul5LiK6Imv44GE44GT44Go44CCJHtyLm1PZGRzPyLjgZXjgonjgavnj77ooYzvvIjjgqrjg4Pjgrrovrzjgb/vvInjgojjgoroia/jgYTjgZPjgajjgIIiOiIifTwvc3Bhbj48L2Rpdj5gOwogaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7kuojmuKzjga7ljLrplpPjgZTjgajjga48Yj7lrp/pmpvjga7nmoTkuK3njoc8L2I+77yI5qSc6Ki85YG044CC5LqI5ris44Go5a6f6Zqb44GM6L+R44GE44G744Gp5q2j56K677yJPC9kaXY+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuS6iOa4rOOBruevhOWbsjwvdGg+PHRoPumgreaVsDwvdGg+PHRoPuS6iOa4rOOBruW5s+WdhzwvdGg+PHRoPuWun+mamzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IGIgb2Ygci5iaW5zKWgrPWA8dHI+PHRkPiR7cGN0KGIubG8pfeOAnCR7cGN0KGIuaGkpfTwvdGQ+PHRkPiR7Yi5ufTwvdGQ+PHRkPiR7cGN0KGIubWVhbiwxKX08L3RkPjx0ZD48Yj4ke3BjdChiLmFjdCwxKX08L2I+PC90ZD48L3RyPmA7CiBoKz1gPC90Ym9keT48L3RhYmxlPjwvZGl2PjxkaXYgY2xhc3M9InNtYWxsIj7pq5jjgYTkuojmuKzjga7lrp/nuL7vvIjmpJzoqLzlgbTvvIk8L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+5LqI5risPC90aD48dGg+6aCt5pWwPC90aD48dGg+5a6f6Zqb44Gu55qE5Lit546HPC90aD48dGg+OTUl44Gu5bmFPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgdCBvZiByLnRociloKz1gPHRyPjx0ZD4ke3BjdCh0LnQpfeS7peS4ijwvdGQ+PHRkPiR7dC5ufTwvdGQ+PHRkPjxiPiR7cGN0KHQucmF0ZSwxKX08L2I+PC90ZD48dGQ+JHtwY3QodC5sbywxKX3jgJwke3BjdCh0LmhpLDEpfTwvdGQ+PC90cj5gOwogaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogaWYoci5pcm9uKWgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+PGI+6LaF6YmE5p2/77yI5LqI5risOTUl5Lul5LiK44O76aCt5pWw44Gu5Yi26ZmQ44Gq44GX77yJ77yaPC9iPuaknOiovOWBtOOBp+OAgeWun+mam+OBqyR7cGN0KHIuaXJvbi5yYXRlLDEpfeOBjDPnnYDku6XlhoXvvIgke3IuaXJvbi5ufemgreOAgTk1JeOBruW5hSAke3BjdChyLmlyb24ubG8sMSl944CcJHtwY3Qoci5pcm9uLmhpLDEpfeOAgTHml6XjgYLjgZ/jgorntIQke3IuaXJvbi5wZXJEYXkudG9GaXhlZCgyKX3poK0ke3IuaXJvbi5sb3dOPyLjgILpoK3mlbDjgYzlsJHjgarjgoHjgafluYXjgYzluoPjgYQiOiIife+8ieOAgiR7ci5pcm9uLnJhdGU+PS45NT8iIjoiPHNwYW4gY2xhc3M9XCJ3YXJuXCI+OTUl44Gr44Gv5bGK44GE44Gm44GE44G+44Gb44KT44CCPC9zcGFuPiJ9PC9kaXY+YDsKIGVsc2UgaCs9JzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuaknOiovOWBtOOBq+OAgeS6iOa4rDk1JeS7peS4iuOBrummrOOBr+OBhOOBvuOBm+OCk+OBp+OBl+OBn++8iOi2hemJhOadv+OBr+WHuuOBquOBhOOAgeOBvuOBn+OBr+WHuuOBpuOCguOBlOOBj+WwkeaVsOOBp+OBme+8ieOAgjwvZGl2Pic7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiBwbGFjZVN0YXR1c0xpbmUoKXsKIGNvbnN0IE09Z2V0UGxhY2VNb2RlbCgpOwogaWYoIU0pcmV0dXJuJzxkaXYgY2xhc3M9InNtYWxsIj7lpb3otbDnjofvvJrmqJnmupbjg6Ljg4fjg6vjga7mlbDlrZfjgafjgZnjgILjgIzmpJzoqLzjgI3jgr/jg5bjgafjgIHoh6rliIbjga7jg4fjg7zjgr/jgafjga7mpJzoqLzjg7vlho3moKHmraPjgYzjgafjgY3jgb7jgZnjgII8L2Rpdj4nOwogcmV0dXJuYDxkaXYgY2xhc3M9InNtYWxsIj7lpb3otbDnjofvvJo8Yj7lho3moKHmraPjgZfjgZ/mlrDjg6Ljg4fjg6s8L2I+44Gn6KGo56S65Lit77yI5qSc6Ki85pelICR7ZXNjKE0uYXQpfe+8j+aknOiovCAke00ublRlc3R944Os44O844K544CB5a6f6Zqb44Gu55qE5Lit546H44Gr5ZCI44KP44Gb44Gm44GC44KK44G+44GZ77yJ44CCPC9kaXY+YDsKfQoKCi8qIC0tLS0tLS0tLS0g5L+d5a2Y44OH44O844K/44Gu54q25rOBIC0tLS0tLS0tLS0gKi8KYXN5bmMgZnVuY3Rpb24gc2hvd1N0YXRlKCl7CiB0cnl7Y29uc3QgZnM9YXdhaXQgaWRiQWxsKCkscHM9YXdhaXQgcGF5QWxsKCk7CiAgY29uc3QgYmFzZT1mcy5maWx0ZXIoZj0+IWYubGl2ZSksbGl2ZT1mcy5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoKTsKICBpZighZnMubGVuZ3RoJiYhcHMubGVuZ3RoKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6YGO5Y6744OH44O844K/44Gv5pyq5Y+W5b6X44Gn44GZ44CC44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBmeOBi+OAgeioreWumuOBi+OCieODkOODg+OCr+OCouODg+ODl+OCkuW+qeWFg+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBsZD1saXZlLm1hcChmPT5mLmRhdGUpLnNvcnQoKSxuUmFjZXM9bGl2ZS5yZWR1Y2UoKHMsZik9PnMrbmV3IFNldChmLnJvd3MubWFwKHI9PnIucmFjZUlkKSkuc2l6ZSwwKTsKICBsZXQgbkFsbD0wLG5Ucj0wO2Zvcihjb25zdCBmIG9mIGxpdmUpZm9yKGNvbnN0IHIgb2YgZi5yb3dzKXtuQWxsKys7aWYoci50cmFpbmVyKW5UcisrfQogIGxldCBoPSIiOwogIGlmKGxpdmUubGVuZ3RoKWgrPWA8c3BhbiBjbGFzcz0iZ29vZCI+5Y+W5b6X5riI44G/44Gu5oiQ57i+77yaJHtsaXZlLmxlbmd0aH3ml6XvvI8ke25SYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iCR7bGRbMF1944CcJHtsZFtsZC5sZW5ndGgtMV1977yJPC9zcGFuPmA7CiAgaWYoYmFzZS5sZW5ndGgpe2NvbnN0IHlzPVsuLi5uZXcgU2V0KGJhc2UubWFwKGY9PmYueWVhcikpXS5zb3J0KCk7aCs9KGg/IlxuIjoiIikrYDxzcGFuIGNsYXNzPSJnb29kIj7jg5Djg4Pjgq/jgqLjg4Pjg5dDU1bvvJoke2Jhc2UubGVuZ3RofeODleOCoeOCpOODq++8iCR7eXNbMF18fCItIn3jgJwke3lzW3lzLmxlbmd0aC0xXXx8Ii0ifeW5tO+8iTwvc3Bhbj5gfQogIGNvbnN0IHByPXBzLnJlZHVjZSgocyxwKT0+cysocC5yYWNlc3x8W10pLmxlbmd0aCwwKTsKICBoKz0oaD8iXG4iOiIiKSsocHMubGVuZ3RoP2A8c3BhbiBjbGFzcz0iZ29vZCI+5omV5oi777yaJHtwcy5sZW5ndGh95pel77yPJHtwci50b0xvY2FsZVN0cmluZygpfeODrOODvOOCuTwvc3Bhbj5gOic8c3BhbiBjbGFzcz0id2FybiI+5omV5oi777ya5pyq5Y+W5b6XPC9zcGFuPicpOwogIGlmKG5BbGwpaCs9YFxu6Kq/5pWZ5bir44Gk44GN44Gu5oiQ57i+77yaJHtNYXRoLnJvdW5kKG5Uci9uQWxsKjEwMCl9JSR7blRyPT09MD8i77yI44GT44KM44GL44KJ5Y+W5b6X44GZ44KL5oiQ57i+44Gr5YWl44KK44G+44GZ77yJIjoiIn1gOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9aDsKIH1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+56K66KqN44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlKX08L3NwYW4+YH0KfQoKLyogLS0tLS0tLS0tLSDlj5blvpfjgZfjgZ/ooYwg4oaSIOWGhemDqOOBruihjO+8iOiqv+aVmeW4q+ODu+OCsOODrOODvOODieS7mOOBje+8iSAtLS0tLS0tLS0tICovCmZ1bmN0aW9uIGxpdmVSb3coeCl7Y29uc3QgZj1wYXJzZUZsb2F0KFN0cmluZyh4LmZpbmlzaD8/IiIpLnJlcGxhY2UoL1teXGQuXS9nLCIiKSk7CiByZXR1cm57cmFjZUlkOlN0cmluZyh4LnJhY2VJZHx8IiIpLGRhdGU6VUUucGFyc2VEYXRlKHguZGF0ZSksbmFtZTpTdHJpbmcoeC5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpVRS5ubih4LmhvcnNlKSxqb2NrZXk6VUUuam5uKHguam9ja2V5KSwKICBmaW5pc2g6TnVtYmVyLmlzRmluaXRlKGYpJiZmPjA/ZjpudWxsLGRpc3Q6TnVtYmVyKHguZGlzdGFuY2UpfHwwLHN1cmY6VUUuc3VyZkNvZGUoeC5zdXJmYWNlKSxhZ2U6TnVtYmVyKHguYWdlKXx8bnVsbCxudW06TnVtYmVyKHgubnVtYmVyKXx8bnVsbCwKICBwb3A6TnVtYmVyKHgucG9wKT4wP051bWJlcih4LnBvcCk6bnVsbCxvZGRzOm51bGwsam5hbWU6U3RyaW5nKHguam9ja2V5fHwiIikudHJpbSgpLHRyYWluZXI6VUUuY2xlYW5Ucih4LnRyYWluZXIpLAogIHJhY2VOYW1lOlN0cmluZyh4LnJhY2VOYW1lfHwiIiksCiAgbHZsOih4LnZlbnVlQ29kZSYmIS9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyh4LnZlbnVlQ29kZSkpKT8tMTooVUUubGV2ZWxPZkxhYmVsKHguY2xzKXx8VUUubGV2ZWxPZlByaXplKHgucHJpemUpKSwKICBncmQ6VUUuZ3JhZGVUaWVyKCh4LmNsc3x8IiIpKyIgIisoeC5ncmFkZXx8IiIpLHgucHJpemUsZmFsc2UpLAogIGNvcm5lcjpBcnJheS5pc0FycmF5KHguY29ybmVyKSYmeC5jb3JuZXIubGVuZ3RoP3guY29ybmVyOm51bGwsbGFwOkFycmF5LmlzQXJyYXkoeC5sYXApJiZ4LmxhcC5sZW5ndGg/eC5sYXA6bnVsbH19CgovKiDlr77osaHml6XjgojjgorliY3jga7lsaXmrbTjgaDjgZHjgafjgrnjg4jjgqLjgpLkvZzjgovvvIjpqI7miYvjg7voqr/mlZnluKvjga7miJDnuL7jgoLlkIzmmYLjgavpm4boqIjvvIkgKi8KYXN5bmMgZnVuY3Rpb24gYnVpbGRTdG9yZSh0YXJnZXQpewogaWYoU1RPUkUmJlNUT1JFX0tFWT09PXRhcmdldClyZXR1cm4gU1RPUkU7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTtpZighZnMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi6YGO5Y6744OH44O844K/44GM5pyq55m76Yyy44Gn44GZ44CC5YWI44Gr44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBmeOBi+OAgeioreWumuOBp+ODkOODg+OCr+OCouODg+ODl+OCkuW+qeWFg+OBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogY29uc3Qgc3Q9bmV3IFVFLlN0b3JlKCk7c3QudHI9bmV3IE1hcCgpO2xldCB1c2VkPTA7Y29uc3QgQUc9bmV3IE1hcCgpOwogY29uc3QgdGFrZT1yPT57aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXR8fCFyLmhvcnNlKXJldHVybjthZ2dBZGQoQUcscik7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlOwogIGlmKHIudHJhaW5lciYmci5maW5pc2ghPW51bGwpe2xldCB0PXN0LnRyLmdldChyLnRyYWluZXIpO2lmKCF0KXN0LnRyLnNldChyLnRyYWluZXIsdD17bjowLHQzOjB9KTt0Lm4rKztpZihyLmZpbmlzaDw9Myl0LnQzKyt9fTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7CiAgYnVzeSh0cnVlLGDpgY7ljrvjg4fjg7zjgr/jgpLpm4boqIjkuK3igKYgJHtpKzF9LyR7ZnMubGVuZ3RofVxu77yIJHt0YXJnZXR944KI44KK5YmN44Gu44G/5L2/55So77yJYCk7CiAgaWYoZnNbaV0ubGl2ZSl7Y29uc3QgcndzPWZzW2ldLnJvd3N8fFtdLGNudD17fTtmb3IoY29uc3QgeCBvZiByd3MpY250W3gucmFjZUlkXT0oY250W3gucmFjZUlkXXx8MCkrMTtmb3IoY29uc3QgeCBvZiByd3Mpe2NvbnN0IHI9bGl2ZVJvdyh4KTtyLmNmPWNvcm5lckZyYWMoeC5jb3JuZXIsY250W3gucmFjZUlkXSk7dGFrZShyKX19CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGZzW2ldLmNzdikpdGFrZShVRS50b1JvdyhvKSk7CiAgYXdhaXQgc2xlZXAoMCk7CiB9CiBjb25zdCBwcmk9bmV3IFVwUHJpKCkscHA9bmV3IFBvcFByaSgpO2Zvcihjb25zdCBhIG9mIEFHLnZhbHVlcygpKXtwcmkuYWRkKGFnZ0luZm8oYSkpO2lmKGEuTj49NiYmYS5wZi5sZW5ndGg9PT1hLk4mJiFhLmp1bXApcHAuYWRkKGEucGYsYS5OKX1zdC51cD1wcmk7c3QucHA9cHA7CiBidXN5KGZhbHNlKTtTVE9SRT1zdDtTVE9SRV9LRVk9dGFyZ2V0O3N0LmNvdW50PXVzZWQ7cmV0dXJuIHN0Owp9CgovKiDlh7rppqzooajjga4x44Os44O844K5IOKGkiDop6PmnpDnlKjjga7jg6zjg7zjgrkgKi8KZnVuY3Rpb24gbWtSYWNlKGMsZCl7CiBjb25zdCBocz1jLmhvcnNlc3x8Yy5ydW5uZXJzfHxbXTsKIGNvbnN0IGd0PShjLmNsYXNzTmFtZXx8IiIpKyIgIisoYy5ncmFkZXx8IiIpKyIgIisoYy5yYWNlTmFtZXx8IiIpOwogY29uc3QgZ3JkPVVFLmdyYWRlVGllcihndCxjLnByaXplLHRydWUpOwogcmV0dXJue2RhdGU6ZCxzdXJmOlVFLnN1cmZDb2RlKGMuc3VyZmFjZSksZGlzdDpOdW1iZXIoYy5kaXN0YW5jZSl8fDAsCiAgbHZsOlVFLmxldmVsT2ZMYWJlbChjLmNsYXNzTmFtZSl8fFVFLmxldmVsT2ZMYWJlbChjLnJhY2VOYW1lKXx8KGdyZD49MT81OjApLGdyZCwKICBydW5uZXJzOmhzLm1hcCgoaCxpKT0+e2NvbnN0IG5hbWU9aC5ob3JzZU5hbWV8fGguaG9yc2V8fGgubmFtZXx8IiI7CiAgIHJldHVybntuYW1lLGhvcnNlOlVFLm5uKG5hbWUpLGpvY2tleTpVRS5qbm4oaC5qb2NrZXl8fCIiKSxqbmFtZTpTdHJpbmcoaC5qb2NrZXl8fCIiKS50cmltKCksdHJhaW5lcjpVRS5jbGVhblRyKGgudHJhaW5lcnx8IiIpLGFnZTpoLmFnZXx8bnVsbCxudW06aC5ob3JzZU51bWJlcnx8aC5udW1iZXJ8fGkrMX19KQogICAuc29ydCgoeCx5KT0+KHgubnVtfHwwKS0oeS5udW18fDApKX07Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDku4rpgLHmnKvjga7lj5blvpcKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBXSz17ZGF0ZXM6W10sY2FyZHM6e30sb2Rkczp7fSxvZGRzTm90ZXM6e30sZGlhZzpbXSxjYWxjOnt9LGF0OiIiLHN0b3JlSW5mbzpudWxsfTsKY29uc3QgcmtleT0oZCxjKT0+YCR7ZH18JHtTdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIil9LSR7TnVtYmVyKGMucmFjZU51bWJlcil8fDB9YDsKY29uc3Qgd2tNc2c9dD0+eyQoIndrU3RhdHVzIikudGV4dENvbnRlbnQ9dH07CmNvbnN0IGJhc2VVcmw9KCk9PiQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKZnVuY3Rpb24gbmV4dFdlZWtlbmQodG9kYXkpe2NvbnN0IG91dD1bXTtjb25zdCB0PW5ldyBEYXRlKHRvZGF5KyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpOwogZm9yKGxldCBpPTA7aTw4JiZvdXQubGVuZ3RoPDI7aSsrKXtjb25zdCBkPW5ldyBEYXRlKHQraSo4NjRlNSksdz1kLmdldFVUQ0RheSgpO2lmKHc9PT02fHx3PT09MClvdXQucHVzaChkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCkpfXJldHVybiBvdXR9Cgphc3luYyBmdW5jdGlvbiBmZXRjaENhcmRzKGJhc2UsZCx2ZW51ZUNvZGUpewogY29uc3QgcT12ZW51ZUNvZGU/YCZ2ZW51ZT0ke2VuY29kZVVSSUNvbXBvbmVudCh2ZW51ZUNvZGUpfWA6IiI7bGV0IGVycj0iIjsKIGZvcihsZXQgdD0wO3Q8Mzt0KyspewogIHRyeXtjb25zdCByPWF3YWl0IGZldGNoKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2VuY29kZVVSSUNvbXBvbmVudChkKX0ke3F9YCk7CiAgIGlmKCFyLm9rKXtsZXQgbT0iIjt0cnl7bT0oYXdhaXQgci5qc29uKCkpLmVycm9yfHwiIn1jYXRjaHt9dGhyb3cgbmV3IEVycm9yKGBIVFRQICR7ci5zdGF0dXN9ICR7bX1gLnRyaW0oKSl9CiAgIGNvbnN0IHg9YXdhaXQgci5qc29uKCk7cmV0dXJue3JhY2VzOkFycmF5LmlzQXJyYXkoeCk/eDooeC5yYWNlc3x8W10pfX0KICBjYXRjaChlKXtlcnI9ZS5tZXNzYWdlO2F3YWl0IHNsZWVwKDEyMDAqKHQrMSkpfQogfQogdGhyb3cgbmV3IEVycm9yKGVycnx8IuWPluW+l+OBp+OBjeOBvuOBm+OCkyIpOwp9CgovKiAx6ZaL5YKs5aC044G244KT44Gu5Ye66aas6KGo44CC5qyg44GR44O75aSx5pWX44GM44GC44KM44Gw44CB6Ieq5YuV44GnMeWbnuOBoOOBkeOChOOCiuebtOOBmSAqLwphc3luYyBmdW5jdGlvbiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LGlzUmV0cnkpewogY29uc3QgY29kZT1TdHJpbmcodi52ZW51ZUNvZGUpOwogV0suY2FyZHNbZF09KFdLLmNhcmRzW2RdfHxbXSkuZmlsdGVyKGM9PlN0cmluZyhjLnZlbnVlQ29kZSkhPT1jb2RlKTsKIFdLLmRpYWc9V0suZGlhZy5maWx0ZXIoeD0+ISh4LmQ9PT1kJiZ4LmNvZGU9PT1jb2RlKSk7CiB0cnl7CiAgY29uc3Qge3JhY2VzfT1hd2FpdCBmZXRjaENhcmRzKGJhc2UsZCxjb2RlKTsKICBjb25zdCBvaz1yYWNlcy5maWx0ZXIoYT0+KGEuaG9yc2VzfHxhLnJ1bm5lcnN8fFtdKS5sZW5ndGgpLGJhZD1yYWNlcy5sZW5ndGgtb2subGVuZ3RoOwogIFdLLmNhcmRzW2RdLnB1c2goLi4ub2spOwogIGNvbnN0IGlzc3Vlcz1vay5maWx0ZXIoYz0+Yy5xdWFsaXR5JiYhYy5xdWFsaXR5Lm9rKS5tYXAoYz0+YCR7Yy5yYWNlTnVtYmVyfVLvvJoke2MucXVhbGl0eS5pc3N1ZXMuam9pbigi44O7Iil9YCk7CiAgV0suZGlhZy5wdXNoKHtkLGNvZGUsbmFtZTp2LnZlbnVlTmFtZXx8VkVOVUVbY29kZV18fGNvZGUscmFjZXM6cmFjZXMubGVuZ3RoLG9rOm9rLmxlbmd0aCxiYWQsaXNzdWVzLGVycjohcmFjZXMubGVuZ3RoPyLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiOiIifSk7CiAgaWYoKGJhZD4wfHxvay5sZW5ndGg8OCkmJiFpc1JldHJ5KXthd2FpdCBzbGVlcCg4MDApO3JldHVybiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LHRydWUpfQogfWNhdGNoKGUpewogIFdLLmRpYWcucHVzaCh7ZCxjb2RlLG5hbWU6di52ZW51ZU5hbWV8fFZFTlVFW2NvZGVdfHxjb2RlLHJhY2VzOjAsb2s6MCxiYWQ6MCxpc3N1ZXM6W10sZXJyOmUubWVzc2FnZX0pOwogIGlmKCFpc1JldHJ5KXthd2FpdCBzbGVlcCgxMjAwKTtyZXR1cm4gbG9hZFZlbnVlSW50byhiYXNlLGQsdix0cnVlKX0KIH0KfQoKLyog44Kq44OD44K677yI5Y2Y5Yud77yL6KSH5Yud77yJ44CC5Ye66aas6KGo44Gu44Oq44Oz44Kv44GL44KJ55u05o6lIOKGkiDlj5bjgozjgarjgYvjgaPjgZ/jg6zjg7zjgrnjga/jgIHml6Xku5jjg7vplovlgqzloLTjga7jg6Hjg4vjg6Xjg7zntYznlLHjgafoo5zjgYYgKi8KYXN5bmMgZnVuY3Rpb24gZmV0Y2hPZGRzRGF0ZShiYXNlLGQpewogY29uc3QgY2FyZHM9V0suY2FyZHNbZF18fFtdLG5vdGVzPVtdO1dLLm9kZHNOb3Rlcz1XSy5vZGRzTm90ZXN8fHt9OwogaWYoIWNhcmRzLmxlbmd0aCl7V0sub2Rkc05vdGVzW2RdPW5vdGVzO3JldHVybntuOjAsbm90ZXN9fQogY29uc3Qgd2l0aExpbms9Y2FyZHMuZmlsdGVyKHI9PnIub2Rkc0NuYW1lKSxieUM9bmV3IE1hcCh3aXRoTGluay5tYXAocj0+W3Iub2Rkc0NuYW1lLHJdKSk7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTx3aXRoTGluay5sZW5ndGg7aSs9NiljaHVua3MucHVzaCh3aXRoTGluay5zbGljZShpLGkrNikubWFwKHI9PnIub2Rkc0NuYW1lKSk7CiBsZXQgY2k9MCxmYWlsTj0wO2NvbnN0IHJlYXNvbnM9e307CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGNpPGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9Y2krKzsKICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gLFsxNTAwXSk7CiAgIGZvcihjb25zdCBpdCBvZiAoeC5pdGVtc3x8W10pKXtjb25zdCByPWJ5Qy5nZXQoaXQuY25hbWUpO2lmKHIpV0sub2Rkc1tya2V5KGQscildPXt0YW46aXQub2Rkc3x8e30scGxhY2U6aXQucGxhY2V8fHt9LGF0OkRhdGUubm93KCl9fQogICBmb3IoY29uc3QgZiBvZiAoeC5mYWlsZWR8fFtdKSl7ZmFpbE4rKztjb25zdCBtPVN0cmluZyhmLnJlYXNvbnx8IiIpLnNsaWNlKDAsNjApO3JlYXNvbnNbbV09KHJlYXNvbnNbbV18fDApKzF9CiAgfWNhdGNoKGUpe2ZhaWxOKz1jaHVua3Nba10ubGVuZ3RoO2NvbnN0IG09U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCw2MCk7cmVhc29uc1ttXT0ocmVhc29uc1ttXXx8MCkrMX19fTsKIGF3YWl0IFByb21pc2UuYWxsKFt3b3JrZXIoKSx3b3JrZXIoKV0pOwogY29uc3QgZGlyZWN0PWNhcmRzLmZpbHRlcihyPT5XSy5vZGRzW3JrZXkoZCxyKV0pLmxlbmd0aDsKIG5vdGVzLnB1c2goYOWHuummrOihqOOBruODquODs+OCr+OBi+OCieebtOaOpe+8miR7ZGlyZWN0fS8ke2NhcmRzLmxlbmd0aH3jg6zjg7zjgrnvvIjjg6rjg7Pjgq/jgYLjgoogJHt3aXRoTGluay5sZW5ndGh944CB5aSx5pWXICR7ZmFpbE5977yJYCk7CiBmb3IoY29uc3QgW20sY10gb2YgT2JqZWN0LmVudHJpZXMocmVhc29ucykpbm90ZXMucHVzaChg44CA5aSx5pWX44Gu55CG55Sx77yaJHttfe+8iCR7Y33vvIlgKTsKIGNvbnN0IG1pc3Npbmc9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYobWlzc2luZy5sZW5ndGgpewogIGZvcihjb25zdCB2IG9mIFsuLi5uZXcgU2V0KG1pc3NpbmcubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbikpewogICBjb25zdCBuZWVkPW5ldyBTZXQobWlzc2luZy5maWx0ZXIocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpPT09dikubWFwKHI9Pk51bWJlcihyLnJhY2VOdW1iZXIpKSk7CiAgIHRyeXsKICAgIGNvbnN0IEw9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzLWxpbmtzP2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9YCxbMTUwMF0pOwogICAgY29uc3QgYWxsPUwubGlua3N8fFtdLGxpbmtzPWFsbC5maWx0ZXIoeD0+bmVlZC5oYXMoeC5yYWNlTm8pKTsKICAgIG5vdGVzLnB1c2goYOODoeODi+ODpeODvOe1jOeUsSAke1ZFTlVFW3ZdfHx2fe+8muOCquODg+OCuueUu+mdouOBjOOBguOCi+ODrOODvOOCuSAke2FsbC5tYXAoeD0+eC5yYWNlTm8pLmpvaW4oIiwiKXx8IuOBquOBlyJ977yI5pyq5Y+W5b6XJHtuZWVkLnNpemV944Os44O844K544Gu44GG44GhJHtsaW5rcy5sZW5ndGh944Os44O844K577yJYCk7CiAgICBpZighYWxsLmxlbmd0aClub3Rlcy5wdXNoKGDjgIDnmbrlo7LliY3jga7lj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgILoqLrmlq3vvJoke0pTT04uc3RyaW5naWZ5KChMLmRpYWd8fFtdKS5tYXAoeD0+KHtzOnguc3RlcCxsZW46eC5odG1sTGVuZ3RoLG46eC5jbmFtZXMsazp4LmtpbmRzLG06eC5tZW51cyxlOnguZXJyb3J9KSkpLnNsaWNlKDAsMzYwKX1gKTsKICAgIGNvbnN0IGJ5Qz1uZXcgTWFwKGxpbmtzLm1hcCh4PT5beC5jbmFtZSx4LnJhY2VOb10pKTsKICAgIGZvcihsZXQgaT0wO2k8bGlua3MubGVuZ3RoO2krPTQpewogICAgIGNvbnN0IGNoPWxpbmtzLnNsaWNlKGksaSs0KS5tYXAoeD0+eC5jbmFtZSk7CiAgICAgdHJ5ewogICAgICBjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9jbmFtZXM9JHtjaC5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCxbMTUwMF0pOwogICAgICBmb3IoY29uc3QgaXQgb2YgKHguaXRlbXN8fFtdKSl7Y29uc3Qgbm89YnlDLmdldChpdC5jbmFtZSk7aWYobm8pV0sub2Rkc1tgJHtkfXwke3Z9LSR7bm99YF09e3RhbjppdC5vZGRzfHx7fSxwbGFjZTppdC5wbGFjZXx8e30sYXQ6RGF0ZS5ub3coKX19CiAgICAgIGZvcihjb25zdCBmIG9mICh4LmZhaWxlZHx8W10pKW5vdGVzLnB1c2goYOOAgOiqreOBv+WPluOCjOOBquOBi+OBo+OBn++8miR7VkVOVUVbdl18fHZ9JHtieUMuZ2V0KGYuY25hbWUpfVLvvIgke1N0cmluZyhmLnJlYXNvbnx8IiIpLnNsaWNlKDAsNTApfe+8iWApOwogICAgIH1jYXRjaChlKXtub3Rlcy5wdXNoKGDjgIDlj5blvpfjgqjjg6njg7wgJHtWRU5VRVt2XXx8dn3vvJoke1N0cmluZyhlLm1lc3NhZ2V8fGUpLnNsaWNlKDAsNzApfWApfQogICAgfQogICB9Y2F0Y2goZSl7bm90ZXMucHVzaChg44Oh44OL44Ol44O857WM55SxICR7VkVOVUVbdl18fHZ977ya5aSx5pWX77yIJHtTdHJpbmcoZS5tZXNzYWdlfHxlKS5zbGljZSgwLDEwMCl977yJYCl9CiAgfQogfQogY29uc3Qgc3RpbGw9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYoc3RpbGwubGVuZ3RoKW5vdGVzLnB1c2goYOOCquODg+OCuuacquWPluW+l++8miR7c3RpbGwubWFwKHI9PihyLnZlbnVlTmFtZXx8IiIpK3IucmFjZU51bWJlcisiUiIpLmpvaW4oIuOAgSIpfe+8iOeZuuWjsuWJjeOAgeOBvuOBn+OBr+iqreOBv+WPluOCjOOBpuOBhOOBvuOBm+OCk++8iWApOwogV0sub2Rkc05vdGVzW2RdPW5vdGVzOwogcmV0dXJue246Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoLG5vdGVzfTsKfQoKbGV0IE9ERFNfVElNRVI9bnVsbCxPRERTX1RSSUVTPTA7CmZ1bmN0aW9uIG9kZHNNaXNzaW5nKCl7bGV0IG09MCx0PTA7Zm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpZm9yKGNvbnN0IGMgb2YgV0suY2FyZHNbZF18fFtdKXt0Kys7aWYoIVdLLm9kZHNbcmtleShkLGMpXSltKyt9cmV0dXJue20sdH19Ci8qIOOCquODg+OCuuOBruacquWPluW+l+OBjOaui+OBo+OBpuOBhOOBpuOAgeW9k+aXpeOBruacneOAnOWkleaWueOBquOCieOAgTXliIbjgZTjgajjgavoh6rli5Xjgaflj5bjgornm7TjgZnvvIhKUkHjga/pgJrluLjjga7jg6zjg7zjgrnjgpLlvZPml6XmnJ3jgavnmbrlo7Lplovlp4vjgZnjgovjgZ/jgoHvvIkgKi8KZnVuY3Rpb24gc2NoZWR1bGVPZGRzUmV0cnkoKXsKIGlmKE9ERFNfVElNRVIpe2NsZWFyVGltZW91dChPRERTX1RJTUVSKTtPRERTX1RJTUVSPW51bGx9CiBjb25zdCB7bX09b2Rkc01pc3NpbmcoKSxoPW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLmdldFVUQ0hvdXJzKCk7CiBpZighbXx8T0REU19UUklFUz49MzZ8fGg8Nnx8aD49MTd8fCFXSy5kYXRlcy5pbmNsdWRlcyhqc3RUb2RheSgpKSlyZXR1cm4gZmFsc2U7CiBPRERTX1RSSUVTKys7T0REU19USU1FUj1zZXRUaW1lb3V0KCgpPT57T0REU19USU1FUj1udWxsO2lmKCEkKCJ3a0dvIikuZGlzYWJsZWQpb2Rkc09ubHkoKX0sNSo2MGUzKTtyZXR1cm4gdHJ1ZTsKfQpjb25zdCBvZGRzSGludD0oKT0+e2NvbnN0IHttfT1vZGRzTWlzc2luZygpO2lmKCFtKXJldHVybiIiO2NvbnN0IHNjaD1zY2hlZHVsZU9kZHNSZXRyeSgpO3JldHVybmBcbuacquWPluW+lyAke21944Os44O844K577ya55m65aOy5YmN44Gu5Y+v6IO95oCn44GM44GC44KK44G+44GZ77yISlJB44Gv6YCa5bi444Gu44Os44O844K544Gu44Kq44OD44K644KS5b2T5pel5pyd44Gr55m65aOy6ZaL5aeL77yJ44CCJHtzY2g/IjXliIbjgZTjgajjgavoh6rli5Xjgaflj5bjgornm7TjgZfjgb7jgZnjgIIiOiLnmbrlo7Lplovlp4vlvozjgavjgIzjgqrjg4PjgrrjgaDjgZHmm7TmlrDjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIifWB9Owphc3luYyBmdW5jdGlvbiB3ZWVrZW5kR28oKXtPRERTX1RSSUVTPTA7CiBjb25zdCBiYXNlPWJhc2VVcmwoKTskKCJ3a0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJ3a09kZHMiKS5kaXNhYmxlZD10cnVlOwogV0suZGF0ZXM9W107V0suY2FyZHM9e307V0sub2Rkcz17fTtXSy5kaWFnPVtdO1dLLmNhbGM9e307CiB0cnl7CiAgd2tNc2coIumWi+WCrOaXpeOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IHRvZGF5PWpzdFRvZGF5KCk7bGV0IGRhdGVzPVtdOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHt0b2RheX0mbGlzdD0xYCxbMTUwMF0pO2RhdGVzPSh4LmF2YWlsYWJsZURhdGVzfHxbXSkuZmlsdGVyKGQ9PmQ+PXRvZGF5KX1jYXRjaChlKXt9CiAgaWYoIWRhdGVzLmxlbmd0aClkYXRlcz1uZXh0V2Vla2VuZCh0b2RheSk7CiAgZGF0ZXM9Wy4uLm5ldyBTZXQoZGF0ZXMpXS5zb3J0KCkuc2xpY2UoMCwzKTsKICBmb3IoY29uc3QgZCBvZiBkYXRlcyl7CiAgIHdrTXNnKGAke2R9IOmWi+WCrOWgtOOCkueiuuiqjeS4reKApmApOwogICBsZXQgdmVudWVzPVtdOwogICB0cnl7dmVudWVzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZH0mbGlzdD0xYCxbMTUwMF0pKS52ZW51ZXN8fFtdfQogICBjYXRjaChlKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs5aC05LiA6KanKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7Y29udGludWV9CiAgIGlmKCF2ZW51ZXMubGVuZ3RoKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs44Gq44GXKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6IuOBk+OBruaXpeOBruWHuummrOihqOOBr+acquWFrOmWi+OAgeOBvuOBn+OBr+mWi+WCrOOBjOOBguOCiuOBvuOBm+OCkyJ9KTtjb250aW51ZX0KICAgV0suY2FyZHNbZF09W107CiAgIGZvcihjb25zdCB2IG9mIHZlbnVlcyl7d2tNc2coYCR7ZH0gJHt2LnZlbnVlTmFtZXx8di52ZW51ZUNvZGV9IOOBruWHuummrOihqOOCkuWPluW+l+S4reKApu+8iCR7KFdLLmNhcmRzW2RdfHxbXSkubGVuZ3RofeODrOODvOOCueWPluW+l+a4iOOBv++8iWApO2F3YWl0IGxvYWRWZW51ZUludG8oYmFzZSxkLHYpfQogICBpZigoV0suY2FyZHNbZF18fFtdKS5sZW5ndGgpV0suZGF0ZXMucHVzaChkKTsKICB9CiAgaWYoIVdLLmRhdGVzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuWHuummrOihqOOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAguOAjOWPluOCiui+vOOBv+eKtuazgeOAjeOCv+ODluOCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogIGxldCBvZGRzTj0wLHRvdGFsPTA7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpe3drTXNnKGAke2R9IOOCquODg+OCuuOCkuWPluW+l+S4reKApmApO29kZHNOKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlLGQpKS5uO3RvdGFsKz1XSy5jYXJkc1tkXS5sZW5ndGh9CiAgd2tNc2coIumBjuWOu+ODh+ODvOOCv+OBqOeFp+WQiOOBl+OBpuOAgeWFqOODrOODvOOCueOCkuino+aekOS4reKApiIpOwogIGF3YWl0IGNhbGNXZWVrZW5kKCk7V0suYXQ9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxNik7CiAgcmVuZGVyQWxsKCk7CiAgY29uc3QgbnI9V0suZGF0ZXMucmVkdWNlKChzLGQpPT5zK1dLLmNhcmRzW2RdLmxlbmd0aCwwKTsKICB3a01zZyhg5a6M5LqG77yIJHtXSy5hdH3vvInvvJoke1dLLmRhdGVzLmpvaW4oIuOAgSIpfe+8jyR7bnJ944Os44O844K577yP44Kq44OD44K6ICR7b2Rkc05944Os44O844K5JHtvZGRzSGludCgpfWApOwogICQoIndrT2RkcyIpLmRpc2FibGVkPWZhbHNlO3Nob3dUYWIoInZBeGlzIik7CiB9Y2F0Y2goZSl7d2tNc2coIuOCqOODqeODvO+8miIrZS5tZXNzYWdlKTtidXN5KGZhbHNlKTtyZW5kZXJBbGwoKX0KIGZpbmFsbHl7JCgid2tHbyIpLmRpc2FibGVkPWZhbHNlfQp9CmFzeW5jIGZ1bmN0aW9uIG9kZHNPbmx5KCl7CiBpZighV0suZGF0ZXMubGVuZ3RoKXJldHVybjskKCJ3a09kZHMiKS5kaXNhYmxlZD10cnVlOwogdHJ5e2xldCBuPTA7Zm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpe3drTXNnKGAke2R9IOOCquODg+OCuuOCkuabtOaWsOS4reKApmApO24rPShhd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2VVcmwoKSxkKSkubn0KICBhd2FpdCBjYWxjV2Vla2VuZCgpO1dLLmF0PW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsMTYpO3JlbmRlckFsbCgpO3drTXNnKGDjgqrjg4Pjgrrmm7TmlrDvvIgke1dLLmF0fe+8ie+8miR7bn3jg6zjg7zjgrnliIYke29kZHNIaW50KCl9YCl9CiBjYXRjaChlKXt3a01zZygi5pu05paw44Ko44Op44O877yaIitlLm1lc3NhZ2UpfWZpbmFsbHl7JCgid2tPZGRzIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDop6PmnpDvvIgx44Os44O844K577yJ77ya6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuiA9IOacn+W+heWApOOAgeazouS5seW6puOAgemJhOadvwogKiAg6KSH5Yud56K6546H77ya44Kq44OD44K644GC44KK4oaS5biC5aC05oOF5aCx44KC5L2/44GG5a2m57+S5riI44G/44Oi44OH44OrKHBPKe+8j+OBquOBl+KGkumBjuWOu+aIkOe4vuOBruOBv+OBruODouODh+ODqyhwUCkKICogIOikh+WLneOCquODg+OCuu+8mkpSQeOBruikh+WLneOCquODg+OCuu+8iOS4i+mZkOOAnOS4iumZkO+8ieOAguiqreOCgeOBquOBhOOBqOOBjeOBr+WNmOWLneOBi+OCieaOqOWumu+8iMOX6KGo56S677yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KZnVuY3Rpb24gY2FsY1JhY2UoZCxjLHN0b3JlKXsKIGNvbnN0IHJhY2U9bWtSYWNlKGMsZCk7bGV0IG49cmFjZS5ydW5uZXJzLmxlbmd0aDtjb25zdCBzY3JhdGNoZWQ9W107CiB7Y29uc3QgbzA9V0sub2Rkc1tya2V5KGQsYyldOwogIGlmKG8wKXtjb25zdCBtaXNzPXJhY2UucnVubmVycy5maWx0ZXIocj0+IShvMC50YW5bci5udW1dPjEpKSxoYXZlPXJhY2UucnVubmVycy5sZW5ndGgtbWlzcy5sZW5ndGg7CiAgIC8vIOS4gOmDqOOBrummrOOBoOOBkeOCquODg+OCuuOBjOeEoeOBhO+8neWPlua2iOODu+mZpOWkluOBruWPr+iDveaAp+OBjOmrmOOBhOOAguWkluOBl+OBpuOAgeOCquODg+OCuui+vOOBv+OBp+ino+aekOOBmeOCi++8iOWkp+WNiuOBjOasoOOBkeOBpuOBhOOCi+OBquOCieWkluOBleOBquOBhO+8iQogICBpZihtaXNzLmxlbmd0aCYmaGF2ZT49NiYmbWlzcy5sZW5ndGg8PU1hdGgubWF4KDMsTWF0aC5mbG9vcihyYWNlLnJ1bm5lcnMubGVuZ3RoKi4yKSkpe3NjcmF0Y2hlZC5wdXNoKC4uLm1pc3MubWFwKHI9PnIubnVtKSk7cmFjZS5ydW5uZXJzPXJhY2UucnVubmVycy5maWx0ZXIocj0+bzAudGFuW3IubnVtXT4xKTtuPXJhY2UucnVubmVycy5sZW5ndGh9fX0KIGNvbnN0IGJhc2U9e2QsY2FyZDpjLHJhY2UsbixzY3JhdGNoZWQsa2V5OnJrZXkoZCxjKSx2ZW51ZTpjLnZlbnVlTmFtZXx8Yy52ZW51ZXx8IiIsbm86TnVtYmVyKGMucmFjZU51bWJlcil8fDAsCiAgbGFiZWw6YCR7Yy52ZW51ZU5hbWV8fGMudmVudWV8fCIifSR7Yy5yYWNlTnVtYmVyfHwiIn1SICR7KGMucmFjZU5hbWUmJmMucmFjZU5hbWUhPT0i5Ye66aas6KGoIik/Yy5yYWNlTmFtZTooYy5jbGFzc05hbWV8fCIiKX1gLGNvdXJzZTpjLnN1cmZhY2UmJmMuZGlzdGFuY2U/YCR7Yy5zdXJmYWNlfSR7Yy5kaXN0YW5jZX1tYDoi44Kz44O844K55LiN5piOIn07CiBpZigv6Zqc5a6zLy50ZXN0KChjLnJhY2VOYW1lfHwiIikrKGMuY2xhc3NOYW1lfHwiIikpKXJldHVybnsuLi5iYXNlLHNraXA6IumanOWus+ODrOODvOOCueOBr+WvvuixoeWklu+8iOW5s+WcsOeUqOOBruODouODh+ODq+OBruOBn+OCge+8iSJ9OwogaWYobjw2KXJldHVybnsuLi5iYXNlLHNraXA6IjbpoK3mnKrmuoAifTsKIGNvbnN0IG89V0sub2Rkc1tiYXNlLmtleV0sb2Rkcz1vP3JhY2UucnVubmVycy5tYXAocj0+by50YW5bci5udW1dKTpudWxsLGhhc09kZHM9ISEob2RkcyYmb2Rkcy5ldmVyeSh4PT54PjEpKTsKIGNvbnN0IG9kPWhhc09kZHM/b2RkczpudWxsOwogY29uc3QgcmVzPVVFLmFuYWx5emUocmFjZSxzdG9yZSxvZCksYXA9VUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2QpO2xldCB1Zz1VRS51cHNldEdyYWRlKHJhY2Usc3RvcmUsb2QsYXApOwogY29uc3QgVU09Z2V0VXBzZXRNb2RlbCgpOwogaWYoVU0mJnN0b3JlLnVwKXt0cnl7Y29uc3QgdT1VRS51cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsb2QsYXApLGluZj17djpTdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIiksbm86TnVtYmVyKGMucmFjZU51bWJlcil8fDAsc3VyZjpyYWNlLnN1cmYsZGlzdDpyYWNlLmRpc3QsbHZsOnJhY2UubHZsLGdyZDpyYWNlLmdyZCxOOm59LHNpbT0oaGFzT2RkcyYmc3RvcmUucHAmJm4+PTYpPygoKT0+e2NvbnN0IHBvcHM9cG9wc0Zyb21PZGRzKG9kKTtyZXR1cm4gc2ltRmVhdChhcC5wUCxwb3BzLG4sc3RvcmUucHApfSkoKTpudWxsLGN1PXVwc2V0Q3VzdG9tKFVNLHUsc3RvcmUudXAuZmVhdChpbmYpLHBhY2VGZWF0KHJhY2UucnVubmVycyxzdG9yZSksc2ltKTtpZihjdSl1Zz17Li4udWcsLi4uY3UsbW9kZTp1Lm1vZGUsY3VzdG9tOnRydWV9fWNhdGNoKGUpe319CiBjb25zdCBQTT1nZXRQbGFjZU1vZGVsKCk7bGV0IHBOZXc9bnVsbDsKIGlmKFBNJiZoYXNPZGRzJiZuPj04JiZzdG9yZS5wcCl7dHJ5e2NvbnN0IHBvcHM9cG9wc0Zyb21PZGRzKG9kKSxyaz1yYW5rRnJhY3MoYXAucFApO3BOZXc9bm9ybVN1bShyYWNlLnJ1bm5lcnMubWFwKChyLGkpPT5wcmVkTG9naXQoUE0ubW9kZWwscGxhY2VYKGFwLnBQW2ldLHBvcHNbaV0sbixzdG9yZS5wcCxya1tpXSkpKSwzKX1jYXRjaChlKXtwTmV3PW51bGx9fQogbGV0IGF4aXM9aGFzT2Rkcz9VRS5heGlzUGlja3MocmFjZSxzdG9yZSxvZCxhcCk6bnVsbDsKIGlmKGhhc09kZHMpewogIGNvbnN0IHBhPXBOZXd8fGFwLnBPLGlyb25SYXRlPShwTmV3JiZQTS5pcm9uJiZQTS5pcm9uLm4+MCk/UE0uaXJvbi5yYXRlOlVFLkFYSVMuYmFuZHNbIumJhOadvyJdLnJhdGU7CiAgY29uc3QgaXJvbj1wYS5tYXAoKHAsaSk9Pih7aSxwLHRpZXI6IumJhOadvyIscmF0ZTppcm9uUmF0ZX0pKS5maWx0ZXIoeD0+eC5wPj1JUk9OX1ApOwogIGNvbnN0IGlzSXJvbj1uZXcgU2V0KGlyb24ubWFwKHg9PnguaSkpLHJlZj0oYXhpc3x8W10pLmZpbHRlcih4PT4haXNJcm9uLmhhcyh4LmkpJiZ4LnRpZXIhPT0i6YmE5p2/IikubWFwKHg9Pih7Li4ueCxwOnBhW3guaV19KSk7CiAgYXhpcz1bLi4uaXJvbiwuLi5yZWZdOwogfQogY29uc3QgbTM9aGFzT2Rkcz9VRS50b3AzRnJvbVdpbihvZC5tYXAoeD0+MS94KSk6bnVsbDsKIGNvbnN0IGhvcnNlcz1yYWNlLnJ1bm5lcnMubWFwKChyLGkpPT57CiAgY29uc3QgcD1wTmV3P3BOZXdbaV06KGhhc09kZHM/YXAucE9baV06YXAucFBbaV0pLHBsPW8mJm8ucGxhY2UmJm8ucGxhY2Vbci5udW1dOwogIGxldCBsbz1udWxsLGhpPW51bGwsc3JjPW51bGw7CiAgaWYocGwmJnBsLmxlbmd0aD09PTImJnBsWzBdPj0xKXtsbz1wbFswXTtoaT1wbFsxXTtzcmM9IuWunyJ9CiAgZWxzZSBpZihtMyl7bG89TWF0aC5tYXgoMSwwLjgvTWF0aC5tYXgobTNbaV0sLjAyKSk7aGk9bG87c3JjPSLmjqjlrpoifQogIGNvbnN0IHRyPXN0b3JlLnRyJiZyLnRyYWluZXI/c3RvcmUudHIuZ2V0KHIudHJhaW5lcik6bnVsbCx4PXJlc1tpXTsKICByZXR1cm57aSxubzpyLm51bSxuYW1lOnIubmFtZSxqbmFtZTpyLmpuYW1lLHRyYWluZXI6ci50cmFpbmVyLHRyTjp0cj90ci5uOjAsdHJSYXRlOnRyJiZ0ci5uP3RyLnQzL3RyLm46bnVsbCxqbjp4LmpuLAogICBwLHBTcmM6cE5ldz8i5YaN5qCh5q2jIjpudWxsLHBPbGQ6aGFzT2Rkcz9hcC5wT1tpXTphcC5wUFtpXSxsbyxoaSxzcmMsZXY6bG8/cCpsbzpudWxsLGV2TWlkOmxvP3AqKGxvK2hpKS8yOm51bGwsd2luOmhhc09kZHM/b2RbaV06bnVsbCxwb3A6eC5wb3AsaG9sZTp4LmhvbGUscGM6eC5wYyxtb2RlOngubW9kZSxuOngubiwKICAgY2FyZWVyOnguY2FyZWVyLHJlY2VudDp4LnJlY2VudCx0YWdzOngudGFncyxyYXRpbmc6VUUucmF0aW5nKHgucGMseC5tb2RlLHgubikseH19KTsKIHJldHVybnsuLi5iYXNlLGhhc09kZHMscmVzLGFwLHVnLGF4aXMsaG9yc2VzLHBsYWNlUmVhbDpob3JzZXMuZmlsdGVyKGg9Pmguc3JjPT09IuWunyIpLmxlbmd0aH07Cn0KYXN5bmMgZnVuY3Rpb24gY2FsY1dlZWtlbmQoKXsKIFdLLmNhbGM9e307CiBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKFdLLmRhdGVzWzBdKTsKIFdLLnN0b3JlSW5mbz17bGFzdDpzdG9yZS5sYXN0RGF0ZXx8IiIsY291bnQ6c3RvcmUuY291bnR9OwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IGNzPVsuLi5XSy5jYXJkc1tkXV0uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVDb2RlKS5sb2NhbGVDb21wYXJlKFN0cmluZyhiLnZlbnVlQ29kZSkpfHwoYS5yYWNlTnVtYmVyfHwwKS0oYi5yYWNlTnVtYmVyfHwwKSk7CiAgV0suY2FsY1tkXT17cmFjZXM6W119OwogIGZvcihsZXQgaT0wO2k8Y3MubGVuZ3RoO2krKyl7CiAgIHRyeXtXSy5jYWxjW2RdLnJhY2VzLnB1c2goY2FsY1JhY2UoZCxjc1tpXSxzdG9yZSkpfQogICBjYXRjaChlKXtXSy5jYWxjW2RdLnJhY2VzLnB1c2goe2QsY2FyZDpjc1tpXSxza2lwOiLop6PmnpDjgqjjg6njg7zvvJoiK2UubWVzc2FnZSxsYWJlbDpgJHtjc1tpXS52ZW51ZU5hbWV8fCIifSR7Y3NbaV0ucmFjZU51bWJlcnx8IiJ9UmAsdmVudWU6Y3NbaV0udmVudWVOYW1lfHwiIixubzpjc1tpXS5yYWNlTnVtYmVyfHwwLGhvcnNlczpbXX0pfQogICBpZihpJTQ9PT0zKWF3YWl0IHNsZWVwKDApOwogIH0KIH0KfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOaknOiovOOCsuODvOODiO+8muWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBp+OAgeiqpOW3ruOCkuW8leOBhOOBpuOCguWbnuWPjueOhzEwMCXku6XkuIrjga7osrfjgYTmlrnjgaDjgZHjgIzmpJzoqLzmuIjjgb/jgI0KICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBHQVRFX0tFWT0ia2VpYmFfZ2F0ZV92MiI7CmNvbnN0IGdldEdhdGU9KCk9Pnt0cnl7cmV0dXJuIEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oR0FURV9LRVkpfHwibnVsbCIpfWNhdGNoKGUpe3JldHVybiBudWxsfX07CmNvbnN0IFNUUkFUPXtmb2N1czoi56m06aas77yI4peO55qE5Lit546H6YeN6KaW77yJIix0b3AxOiLnqbTppqwx5L2NIix0b3AyOiLnqbTppqzkuIrkvY0y6aCtIix2YWx1ZToi5aaZ5ZGzMS4z5YCN5Lul5LiKIixheGlzOiLpiYTmnb/ou7gifTsKZnVuY3Rpb24gc2V0R2F0ZShvdXQsb3V0UCl7CiBjb25zdCBpdGVtcz1bXTsKIGZvcihjb25zdCBbc3JjLG9dIG9mIFtbIuOCquODg+OCuuOBguOCiiIsb3V0XSxbIuOCquODg+OCuuOBquOBlyIsb3V0UF1dKXsKICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhTVFJBVCkpewogICBjb25zdCB2PW8uc3RhdHNba107aWYoIXYpY29udGludWU7CiAgIGNvbnN0IHNlZz0odi5DJiZ2LkMuYmV0cz49MzAwKT92LkM6di5hbGw7aWYoIXNlZ3x8IXNlZy5iZXRzKWNvbnRpbnVlOwogICBjb25zdCBsb3c9c2VnLnJvaS0xLjk2KnNlZy5zZTsKICAgaXRlbXMucHVzaCh7a2V5OmssbGFiZWw6U1RSQVRba10rIu+8iCIrc3JjKyLvvIkiLHJvaTpzZWcucm9pLGxvdyxiZXRzOnNlZy5iZXRzLGhpdDpzZWcuaGl0UmF0ZSxzZWc6c2VnPT09di5DPyLlrabnv5LlvowiOiLlhajmnJ/plpMifSk7CiAgfQogfQogbG9jYWxTdG9yYWdlLnNldEl0ZW0oR0FURV9LRVksSlNPTi5zdHJpbmdpZnkoe2F0Om5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSxpdGVtc30pKTsKIHJlbmRlckdhdGUoKTsKfQpjb25zdCBzdHJhdE9rPWtleT0+e2NvbnN0IGc9Z2V0R2F0ZSgpO3JldHVybiAhIShnJiZnLml0ZW1zLnNvbWUoeD0+eC5rZXk9PT1rZXkmJngubG93Pj0xJiZ4LmJldHM+PTMwMCkpfTsKY29uc3Qgc3RyYXRDaGlwPWtleT0+c3RyYXRPayhrZXkpPyc8c3BhbiBjbGFzcz0iY2hpcCBiIj7mpJzoqLzmuIjjgb/vvIjlm57lj47njocxMDAl6LaF77yJPC9zcGFuPic6JzxzcGFuIGNsYXNzPSJjaGlwIHIiPuWbnuWPjueOhzEwMCXotoXjga/mnKrnorroqo08L3NwYW4+JzsKZnVuY3Rpb24gcmVuZGVyR2F0ZSgpewogY29uc3QgZz1nZXRHYXRlKCksZWw9JCgiZ2F0ZSIpOwogaWYoIWcpe2VsLmlubmVySFRNTD0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj48Yj7lm57lj47njofvvJrmnKrmpJzoqLw8L2I+44CA44CM5qSc6Ki844CN44K/44OW44KS5a6f6KGM44GZ44KL44G+44Gn44CB44Gp44Gu6LK344GE5pa544KC44CMMTAwJei2heOAjeOBqOOBr+iogOOBiOOBvuOBm+OCk+OAgu+8iOS7peWJjeOBruaknOiovOOBp+OBr+OAgeeptOmmrDHkvY3jga7opIfli53lm57lj47njofjga/ntIQ3MuOAnDc3JeOBp+OBl+OBn++8iTwvZGl2Pic7cmV0dXJufQogY29uc3Qgb2s9Zy5pdGVtcy5maWx0ZXIoeD0+eC5sb3c+PTEmJnguYmV0cz49MzAwKSxiZXN0PWcuaXRlbXMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLnJvaS1hLnJvaSlbMF07CiBpZihvay5sZW5ndGgpZWwuaW5uZXJIVE1MPWA8ZGl2IGNsYXNzPSJiYW5uZXIgb2siPjxiPuaknOiovOa4iOOBv++8iOWbnuWPjueOhzEwMCXotoXvvInvvJo8L2I+JHtvay5tYXAoeD0+YCR7ZXNjKHgubGFiZWwpfSAke3BjdCh4LnJvaSl977yI5LiL6ZmQJHtwY3QoeC5sb3cpfeODuyR7eC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl95Zue44O7JHt4LnNlZ33vvIlgKS5qb2luKCLvvI8iKX08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mpJzoqLzml6UgJHtlc2MoZy5hdCl944CC6YGO5Y6744Gu5oiQ57i+44Gn44Gu57WQ5p6c44Gn44CB5LuK5b6M44KC57aa44GP5L+d6Ki844Gv44GC44KK44G+44Gb44KT44CCPC9zcGFuPjwvZGl2PmA7CiBlbHNlIGVsLmlubmVySFRNTD1gPGRpdiBjbGFzcz0iYmFubmVyIG5nIj48Yj7lm57lj47njocxMDAl6LaF44KS56K66KqN44Gn44GN44Gf6LK344GE5pa544Gv44CB44G+44Gg44GC44KK44G+44Gb44KT44CCPC9iPiR7YmVzdD9g5pyA6auY44Gn44KCICR7ZXNjKGJlc3QubGFiZWwpfSDjga4gJHtwY3QoYmVzdC5yb2kpfe+8iOiqpOW3ruOCkuW8leOBj+OBqCR7cGN0KGJlc3QubG93KX3jg7ske2Jlc3QuYmV0cy50b0xvY2FsZVN0cmluZygpfeWbnuODuyR7YmVzdC5zZWd977yJ44CCYDoiIn08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mpJzoqLzml6UgJHtlc2MoZy5hdCl944CC5LiL44Gu5YCZ6KOc44Gv44CM5b2T44Gf44KK44KE44GZ44GV44O75pyf5b6F5YCk44Gu55uu5a6J44CN44Go44GX44Gm5L2/44Gj44Gm44GP44Gg44GV44GE44CCPC9zcGFuPjwvZGl2PmA7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDooajnpLoKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBJUk9OX1A9MC45NTsgICAvLyDotoXpiYTmnb/vvJ3opIfli53lnI/lhoXjgavlhaXjgovnorrnjofjgYw5NSXku6XkuIrjga7ppqzvvIjpoK3mlbDjga7liLbpmZDjgarjgZfvvIkKY29uc3QgR1JBREVfT1JERVI9WyJTU1MiLCJTUyIsIlMiLCJBIiwiQiIsIkMiXSxHUkFERV9DT0xPUj17U1NTOiIjYjQyMzE4IixTUzoiI2Q5MmQyMCIsUzoiI2Y3OTAwOSIsQToiIzE2NjdkOSIsQjoiIzY2NzA4NSIsQzoiIzk4YTJiMyJ9Owpjb25zdCBkYXlMYWJlbD1kPT57Y29uc3Qgdz0i5pel5pyI54Gr5rC05pyo6YeR5ZyfIltuZXcgRGF0ZShkKyJUMDA6MDA6MDBaIikuZ2V0VVRDRGF5KCldO3JldHVybiBgJHtkLnNsaWNlKDUpLnJlcGxhY2UoIi0iLCIvIil9KCR7d30pYH07CmNvbnN0IGNhbGNSYWNlcz1kPT4oV0suY2FsY1tkXSYmV0suY2FsY1tkXS5yYWNlcyl8fFtdOwpjb25zdCBhbGxSYWNlcz0oKT0+V0suZGF0ZXMuZmxhdE1hcChkPT5jYWxjUmFjZXMoZCkpOwpjb25zdCBub0RhdGE9bXNnPT5gPGRpdiBjbGFzcz0ic21hbGwiPiR7bXNnfHwi44CM4pGgIOS7iumAseacq+OBruODrOODvOOCueOCkuWPluW+l+OBl+OBpuS6iOaDs+OBmeOCi+OAjeOCkuaKvOOBmeOBqOihqOekuuOBleOCjOOBvuOBmeOAgiJ9PC9kaXY+YDsKCmZ1bmN0aW9uIHJlbmRlckFsbCgpe3JlbmRlckdhdGUoKTtyZW5kZXJBeGlzKCk7cmVuZGVyRXYoKTtyZW5kZXJVcHNldCgpO3JlbmRlckhvbGUoKTtyZW5kZXJSYWNlcygpO3JlbmRlclN1bSgpfQoKLyogLS0tIOi2hemJhOadv++8iOikh+WLneWcj+WGheOBruS6iOa4rOeiuueOh+OBjOmrmOOBhOi7uOmmrO+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyQXhpcygpewogY29uc3QgZWw9JCgidkF4aXMiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgQj1VRS5BWElTLmJhbmRzOwogY29uc3QgUE14PWdldFBsYWNlTW9kZWwoKSxpcm9uTmV3PVBNeCYmUE14Lmlyb24mJlBNeC5pcm9uLm4+MDsKIGxldCBoPWA8aDI+6LaF6YmE5p2/77yI6KSH5Yud5ZyP5YaFIOe0hDk1JeS7peS4iu+8iTwvaDI+JHtzdHJhdENoaXAoImF4aXMiKX0ke3BsYWNlU3RhdHVzTGluZSgpfQogJHtpcm9uTmV3P2A8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K644GM5Y+W44KM44Gf44Os44O844K544Gg44GR5Yik5a6a44GX44G+44GZ44CC6KSH5Yud5ZyP5YaF44Gu56K6546H44GMPGI+OTUl5Lul5LiKPC9iPuOBrummrOOCkuOAgemgreaVsOOBruWItumZkOOBquOBl+OBp+WHuuOBl+OBvuOBmeOAguWGjeagoeato+W+jOOBruaknOiovOOBp+OBr+OAgeS6iOa4rDk1JeS7peS4iuOBrummrOOBr+Wun+mam+OBqzxiPiR7cGN0KFBNeC5pcm9uLnJhdGUsMSl9PC9iPuOBjDPnnYDku6XlhoXvvIgke1BNeC5pcm9uLm596aCt44CB6Kqk5beu44KS5byV44GE44Gm44KCJHtwY3QoUE14Lmlyb24ubG8sMSl944CBMeaXpeOBguOBn+OCiue0hCR7UE14Lmlyb24ucGVyRGF5LnRvRml4ZWQoMil96aCt77yJ44Gn44GX44Gf44CCPC9kaXY+YDpgPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBoOOBkeWIpOWumuOBl+OBvuOBmeOAguikh+WLneWcj+WGheOBrueiuueOh+OBjDxiPjk1JeS7peS4ijwvYj7jga7ppqzjgpLjgIHpoK3mlbDjga7liLbpmZDjgarjgZfjgaflh7rjgZfjgb7jgZnjgILlj4LogIPvvJrmqJnmupbjg6Ljg4fjg6vjgafkuojmuKwke3BjdChCWyLpiYTmnb8iXS5sbyl95Lul5LiK44Gu5Yy65YiG44Gv44CB6YGO5Y6744Gr5a6f6Zqb44GrJHtwY3QoQlsi6YmE5p2/Il0ucmF0ZSwxKX3jgYwz552A5Lul5YaF77yIJHtCWyLpiYTmnb8iXS5ufemgreOAgeiqpOW3ruOCkuW8leOBhOOBpuOCgiR7cGN0KEJbIumJhOadvyJdLmxvOTUsMSl977yJ44Gn44GX44Gf44CCPC9kaXY+YH1gOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IHJzPWNhbGNSYWNlcyhkKSxwaWNrcz1bXTsKICBmb3IoY29uc3QgciBvZiBycylpZihyLmF4aXMpZm9yKGNvbnN0IHggb2Ygci5heGlzKXBpY2tzLnB1c2goe3IseCxoaDpyLmhvcnNlc1t4LmldfSk7CiAgcGlja3Muc29ydCgoYSxiKT0+Yi54LnAtYS54LnApOwogIGNvbnN0IG5PZGRzPXJzLmZpbHRlcihyPT4hci5za2lwJiZyLmhhc09kZHMpLmxlbmd0aCxuQWxsPXJzLmZpbHRlcihyPT4hci5za2lwKS5sZW5ndGg7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfeOAgDxzcGFuIGNsYXNzPSJzbWFsbCI+44Kq44OD44K65Y+W5b6XICR7bk9kZHN9LyR7bkFsbH3jg6zjg7zjgrk8L3NwYW4+PC9oMz5gOwogIGlmKCFuT2Rkcyl7aCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+44Kq44OD44K644GM5pyq5Y+W5b6X44Gu44Gf44KB5Yik5a6a44Gn44GN44G+44Gb44KT77yI55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN44KS5oq844GX44Gm44GP44Gg44GV44GE77yJ44CCPC9kaXY+Jztjb250aW51ZX0KICBjb25zdCBpcm9uPXBpY2tzLmZpbHRlcih6PT56LngudGllcj09PSLpiYTmnb8iKTsKICBjb25zdCByZXN0PXBpY2tzLmZpbHRlcih6PT56LngudGllciE9PSLpiYTmnb8iKS5zbGljZSgwLDIpOwogIGNvbnN0IGNhcmQ9KHosdGFnKT0+YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKHouci5sYWJlbCl9PC9iPuOAgDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moei5yLmNvdXJzZSl944O7JHt6LnIubn3poK08L3NwYW4+PGJyPjxiPiR7ei5oaC5ub33nlaogJHtlc2Moei5oaC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJydCByQSI+JHt0YWd9PC9zcGFuPuOAgOS6iOa4rCAke3BjdCh6LngucCl9PGJyPgogICA8c3BhbiBjbGFzcz0ic21hbGwiPumojuaJi++8miR7ZXNjKHouaGguam5hbWV8fCLkuI3mmI4iKX3vvI/oqr/mlZnluKvvvJoke2VzYyh6LmhoLnRyYWluZXJ8fCLkuI3mmI4iKX3vvI/ljZjli50gJHt6LmhoLndpbj96LmhoLndpbisi5YCNIjoiLSJ977yP6KSH5YudICR7ei5oaC5sbz96LmhoLmxvLnRvRml4ZWQoMSkrKHouaGguaGk+ei5oaC5sbz8i44CcIit6LmhoLmhpLnRvRml4ZWQoMSk6IiIpKyLlgI0iKyh6LmhoLnNyYz09PSLmjqjlrpoiPyIo5o6o5a6aKSI6IiIpOiItIn3vvI/jgZPjga7ljLrliIbjga7pgY7ljrvlrp/nuL4gJHtwY3Qoei54LnJhdGUsMSl9PC9zcGFuPjwvZGl2PmA7CiAgaWYoaXJvbi5sZW5ndGgpaCs9aXJvbi5tYXAoej0+Y2FyZCh6LCLotoXpiYTmnb8iKSkuam9pbigiIik7CiAgZWxzZSBoKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7otoXpiYTmnb/vvIjkuojmuKw5NSXku6XkuIrvvInjgavoqbLlvZPjgZnjgovppqzjga/jgYTjgb7jgZvjgpPjgILnhKHnkIbjgavosrfjgo/jgarjgYTjga7jgoLkuIDjgaTjga7liKTmlq3jgafjgZnjgII8L2Rpdj4nOwogIGlmKCFpcm9uLmxlbmd0aCYmcmVzdC5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7lj4LogIPvvIg5NSXjgavjga/lsYrjgYvjgarjgYTou7jlgJnoo5zvvInvvJo8L2Rpdj5gK3Jlc3QubWFwKHo9PmNhcmQoeix6LngudGllcikpLmpvaW4oIiIpOwogfQogZWwuaW5uZXJIVE1MPWg7Cn0KCi8qIC0tLSDmnJ/lvoXlgKTvvIjopIfli53norrnjocgw5cg6KSH5Yud44Kq44OD44K677yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJFdigpewogY29uc3QgZWw9JCgidkV2Iik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IGV2TWluPU51bWJlcigkKCJldk1pbiIpPyQoImV2TWluIikudmFsdWU6MS4wNSkscE1pbj1OdW1iZXIoJCgiZXZQIik/JCgiZXZQIikudmFsdWU6LjI1KTsKIGNvbnN0IHJvd3M9W107CiBmb3IoY29uc3QgciBvZiBhbGxSYWNlcygpKWlmKCFyLnNraXApZm9yKGNvbnN0IGggb2Ygci5ob3JzZXMpaWYoaC5ldiE9bnVsbCYmaC5ldj49ZXZNaW4mJmgucD49cE1pbilyb3dzLnB1c2goe3IsaH0pOwogcm93cy5zb3J0KChhLGIpPT5iLmguZXYtYS5oLmV2KTsKIGNvbnN0IG5PZGRzPWFsbFJhY2VzKCkuZmlsdGVyKHI9PnIuaGFzT2RkcykubGVuZ3RoOwogbGV0IGg9YDxoMj7mnJ/lvoXlgKTvvIjopIfli53norrnjocgw5cg6KSH5Yud44Kq44OD44K677yJPC9oMj4ke3N0cmF0Q2hpcCgidmFsdWUiKX0KIDxkaXYgY2xhc3M9InNtYWxsIj7mnJ/lvoXlgKTvvJ3jgZ3jga7ppqzjgYwz552A5Lul5YaF44Gr5YWl44KL56K6546HIMOXIOikh+WLneOCquODg+OCuuOBruS4i+mZkOOAgjEuMOOCkui2heOBiOOCjOOBsOOAgeeQhuirluS4iuOBr+iyt+OBhOe2muOBkeOBpuODl+ODqeOCueOBp+OBmeOAguikh+WLneOCquODg+OCuuOBrzxiPuWunzwvYj7vvJ1KUkHjga7lrp/jgqrjg4PjgrrjgIE8Yj7mjqjlrpo8L2I+77yd5Y2Y5Yud44GL44KJ6KiI566X44GX44Gf55uu5a6J44CC56K6546H44Gu6KaL56mN44KC44KK6YGV44GE44GM5aSn44GN44GP5Yq544GP44Gf44KB44CB44CM5qSc6Ki844CN44GnMTAwJei2heOBjOeiuuiqjeOBleOCjOOCi+OBvuOBp+OBr+ebruWuieOBqOOBl+OBpuS9v+OBo+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj7mnJ/lvoXlgKQgPHNlbGVjdCBpZD0iZXZNaW4iPjxvcHRpb24gdmFsdWU9IjEiPjEuMDDku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjA1Ij4xLjA15Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMS4xIj4xLjEw5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMS4yIj4xLjIw5Lul5LiKPC9vcHRpb24+PC9zZWxlY3Q+IOikh+WLneeiuueOhyA8c2VsZWN0IGlkPSJldlAiPjxvcHRpb24gdmFsdWU9IjAuMTUiPjE1JeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjAuMjUiPjI1JeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjAuNCI+NDAl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC42Ij42MCXku6XkuIo8L29wdGlvbj48L3NlbGVjdD48L2Rpdj5gOwogaWYoIW5PZGRzKXtlbC5pbm5lckhUTUw9aCsnPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4PjgrrjgYzmnKrlj5blvpfjga7jgZ/jgoHjgIHmnJ/lvoXlgKTjga/oqIjnrpfjgafjgY3jgb7jgZvjgpPvvIjnmbrlo7Lplovlp4vlvozjgavjgIzjgqrjg4PjgrrjgaDjgZHmm7TmlrDjgI3vvInjgII8L2Rpdj4nO2JpbmRFdihldk1pbixwTWluKTtyZXR1cm59CiBpZighcm93cy5sZW5ndGgpaCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+5p2h5Lu244Gr5ZCI44GG6aas44Gv44GE44G+44Gb44KT44CCPC9kaXY+JzsKIGVsc2V7CiAgaCs9YDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqw8L3RoPjx0aD7norrnjoc8L3RoPjx0aD7opIfli508L3RoPjx0aD7mnJ/lvoXlgKQ8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3Qge3IsaDp4fSBvZiByb3dzLnNsaWNlKDAsNDApKWgrPWA8dHI+PHRkPiR7ZXNjKGRheUxhYmVsKHIuZCkpfSAke2VzYyhyLmxhYmVsKX08YnI+PGI+JHt4Lm5vfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyh4LmpuYW1lfHwiIil9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHgucCl9PC90ZD48dGQ+JHt4LmxvLnRvRml4ZWQoMSl9JHt4LmhpPngubG8/IuOAnCIreC5oaS50b0ZpeGVkKDEpOiIifTxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LnNyY308L3NwYW4+PC90ZD48dGQ+PGI+JHt4LmV2LnRvRml4ZWQoMil9PC9iPjwvdGQ+PC90cj5gOwogIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIH0KIGVsLmlubmVySFRNTD1oO2JpbmRFdihldk1pbixwTWluKTsKfQpmdW5jdGlvbiBiaW5kRXYoYSxiKXtjb25zdCBlPSQoImV2TWluIikscD0kKCJldlAiKTtpZighZSlyZXR1cm47ZS52YWx1ZT1TdHJpbmcoYSk7cC52YWx1ZT1TdHJpbmcoYik7ZS5vbmNoYW5nZT1wLm9uY2hhbmdlPXJlbmRlckV2fQoKLyogLS0tIOazouS5seW6piAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyVXBzZXQoKXsKIGNvbnN0IGVsPSQoInZVcHNldCIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBsZXQgaD1gPGgyPuODrOODvOOCueOBruazouS5seW6pu+8iFNTU+OAnEPvvIk8L2gyPjxkaXYgY2xhc3M9InNtYWxsIj7jgIwz552A5Lul5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GMMTXku6XkuIrjgI3jgavjgarjgovnorrnjofjgafnrYnntJrjgaXjgZHjgZfjgabjgYTjgb7jgZnvvIjlhajjg6zjg7zjgrnlubPlnYcg57SEMjguNSXvvInjgILjgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrnjga/jgIHjgqrjg4Pjgrrovrzjgb/jga7liKTlrprjgavjgarjgorjgb7jgZnjgII8L2Rpdj4ke3Vwc2V0U3RhdHVzTGluZSgpfWA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgcnM9Y2FsY1JhY2VzKGQpLmZpbHRlcihyPT4hci5za2lwKSxjbnQ9e307R1JBREVfT1JERVIuZm9yRWFjaChnPT5jbnRbZ109MCk7cnMuZm9yRWFjaChyPT5jbnRbci51Zy5ncmFkZV0rKyk7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+PGRpdiBjbGFzcz0icm93Ij4ke0dSQURFX09SREVSLm1hcChnPT5gPHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW2ddfSI+JHtnfSAke2NudFtnXX08L3NwYW4+YCkuam9pbigiICIpfTwvZGl2PmA7CiAgY29uc3Qgc29ydGVkPXJzLnNsaWNlKCkuc29ydCgoYSxiKT0+R1JBREVfT1JERVIuaW5kZXhPZihhLnVnLmdyYWRlKS1HUkFERV9PUkRFUi5pbmRleE9mKGIudWcuZ3JhZGUpfHxiLnVnLnAtYS51Zy5wKTsKICBoKz1gPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuODrOODvOOCuTwvdGg+PHRoPuetiee0mjwvdGg+PHRoPuS6iOa4rDwvdGg+PHRoPuWun+e4vuOBruazouS5seeOhzwvdGg+PHRoPuWIpOWumjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCByIG9mIHNvcnRlZCloKz1gPHRyPjx0ZD4ke2VzYyhyLmxhYmVsKX08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyLmNvdXJzZSl944O7JHtyLm596aCtPC9zcGFuPiR7ci5zY3JhdGNoZWQmJnIuc2NyYXRjaGVkLmxlbmd0aD9gIDxzcGFuIGNsYXNzPSJjaGlwIG8iPumZpOWkluaOqOWumiAke3Iuc2NyYXRjaGVkLmpvaW4oIiwiKX3nlao8L3NwYW4+YDoiIn08L3RkPjx0ZD48c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1Jbci51Zy5ncmFkZV19Ij4ke3IudWcuZ3JhZGV9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHIudWcucCl9PC90ZD48dGQ+JHtyLnVnLmN1c3RvbSYmci51Zy5yYXRlIT1udWxsP2Ake3BjdChyLnVnLnJhdGUpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7cGN0KHIudWcubG8pfeOAnCR7cGN0KHIudWcuaGkpfeODuyR7ci51Zy5ufeS7tjwvc3Bhbj5gOk1hdGgucm91bmQoci51Zy5yYXRlKjEwMCkrIiUifTwvdGQ+PHRkIGNsYXNzPSJzbWFsbCI+JHtyLnVnLm1vZGU9PT0ib2RkcyI/IuOCquODg+OCuui+vOOBvyI6IuaOqOWumiJ9PC90ZD48L3RyPmA7CiAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogfQogZWwuaW5uZXJIVE1MPWg7Cn0KCi8qIC0tLSDnqbTppqzvvIjlpb3otbDnjofjga7pq5jjgYTnqbTppqzlgJnoo5zvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlckhvbGUoKXsKIGNvbnN0IGVsPSQoInZIb2xlIik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IEhLPSJrZWliYV9ob2xlX21vZGUiO2xldCBobT0oJCgiaG9sZUZvY3VzIikmJiQoImhvbGVGb2N1cyIpLnZhbHVlKXx8KCgpPT57dHJ5e3JldHVybiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShISyl9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fSkoKXx8IlNBIjtpZighWyJTIiwiU0EiLCJhbGwiXS5pbmNsdWRlcyhobSkpaG09IlNBIjsKIHRyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShISyxobSl9Y2F0Y2goZSl7fQogbGV0IGg9YDxoMj7nqbTppqzlgJnoo5w8L2gyPiR7c3RyYXRDaGlwKCJmb2N1cyIpfQogPGRpdiBjbGFzcz0ic21hbGwiPjxiPueptOmmrO+8neS6uuawl+OBruS4i+S9jeOBrummrDwvYj7vvIjpoK3mlbDjga7ntIQ25Ymy44KI44KK5LiL44CC5L6L77yaMTbpoK3nq4vjgabjgarjgok355Wq5Lq65rCX5Lul5LiL44CBMTLpoK3nq4vjgabku6XkuIvjgarjgok155Wq5Lq65rCX5Lul5LiL77yJ44Gu5Lit44Gn44CBM+edgOS7peWGheOBq+WFpeOCi+eiuueOh+OBjOmrmOOBhOmmrOOAguOAjOW9k+OBn+OCiuOChOOBmeOBleOAjeOBruebruWuieOBp+OAgeWbnuWPjueOh+OBr+WIpeOBp+OBmeOAguipleS+oeOBr1PvvJ5B77yeQu+8nkPjga7poIbjgafjgIFT44Gv56m06aas44Gu5bmz5Z2H44GuMi4y5YCN5Lul5LiK44Gu5aW96LWw546H44Gn44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPjxzZWxlY3QgaWQ9ImhvbGVGb2N1cyI+PG9wdGlvbiB2YWx1ZT0iUyI+U+OBoOOBke+8iOacgOOCguWlvei1sOeOh+OBjOmrmOOBhOeptOmmrO+8iTwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IlNBIj5T44O7Qe+8iOKXjueahOS4reeOh+mHjeimlu+8iTwvb3B0aW9uPjxvcHRpb24gdmFsdWU9ImFsbCI+44GZ44G544Gm77yI5LiK5L2NMumgre+8iTwvb3B0aW9uPjwvc2VsZWN0PjwvZGl2PgogJHtobT09PSJTIj8nPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+44CMU+OBoOOBkeOAjeOBr+e1nuOCiui+vOOBv+OBruihqOekuuOBp+OBmeOAgumBjuWOu+OBruaknOiovO+8iOaknOiovOOCv+ODlu+8ieOBr+OAgVPjg7tB44KS44G+44Go44KB44Gf5oiQ57i+44Gn6ZuG6KiI44GX44Gm44GE44KL44Gf44KB44CBU+OBoOOBkeOBruaIkOe4vuOBr+WIpeOBq+OBr+eiuuiqjeOBp+OBjeOBpuOBhOOBvuOBm+OCk+OAgjwvZGl2Pic6IiJ9YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz5gOwogIGZvcihjb25zdCByIG9mIGNhbGNSYWNlcyhkKSl7CiAgIGlmKHIuc2tpcCljb250aW51ZTsKICAgY29uc3QgYz1obT09PSJTIj9VRS5waWNrRm9jdXMoci5yZXMsNikuZmlsdGVyKHg9PnIuaG9yc2VzW3guaV0ucmF0aW5nPT09IlMiKS5zbGljZSgwLDMpOmhtPT09IlNBIj9VRS5waWNrRm9jdXMoci5yZXMsMik6VUUucGljayhyLnJlcywyKTtpZighYy5sZW5ndGgpY29udGludWU7CiAgIGgrPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyhyLmxhYmVsKX08L2I+IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moci5jb3Vyc2UpfeODuyR7ci5ufemgrSR7ci5oYXNPZGRzPyIiOiLvvIjjgqrjg4PjgrrmnKrlj5blvpfvvIkifTwvc3Bhbj5gOwogICBmb3IoY29uc3QgeCBvZiBjKXtjb25zdCBoaD1yLmhvcnNlc1t4LmldOwogICAgaCs9YDxkaXYgc3R5bGU9Im1hcmdpbi10b3A6NnB4Ij48Yj4ke3gubm9955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgciR7aGgucmF0aW5nfSI+JHtoaC5yYXRpbmd9PC9zcGFuPiA8c3BhbiBjbGFzcz0ic21hbGwiPuWlvei1sOeOhyAke2hoLnBTcmM/cGN0KGhoLnAsMSkrIu+8iOWGjeagoeato+W+jOOBruikh+WLneeiuueOh++8iSI6cGN0KHgucGMsMSl9JHt4Lm9kZD9g77yP5Y2Y5YudJHt4Lm9kZH3lgI0oJHt4LnBvcH3nlarkurrmsJcpYDoiIn08L3NwYW4+PGJyPgogICAgIDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtoaC5jYXJlZXImJmhoLmNhcmVlci5uP2DpgJrnrpcke2hoLmNhcmVlci5ufei1sCAz552A5YaFJHtoaC5jYXJlZXIudDN95ZueYDoi6YCa566X77ya5bGl5q2044Gq44GXIn0ke2hoLnJlY2VudCYmaGgucmVjZW50Lmxlbmd0aD9g77yP55u06L+RICR7aGgucmVjZW50LnNsaWNlKC01KS5qb2luKCItIil9552AYDoiIn3vvI/pqI7miYvvvJoke2VzYyhoaC5qbmFtZXx8IuS4jeaYjiIpfe+8j+iqv+aVmeW4q++8miR7ZXNjKGhoLnRyYWluZXJ8fCLkuI3mmI4iKX0ke2hoLnRyUmF0ZSE9bnVsbCYmaGgudHJOPj0yMD9gKDPnnYDlhoUke3BjdChoaC50clJhdGUpfSlgOiIifTwvc3Bhbj48YnI+YCsKICAgICAoeC50YWdzfHxbXSkuc2xpY2UoMCwzKS5tYXAodD0+YDxzcGFuIGNsYXNzPSJjaGlwICR7dC5jfSI+JHtlc2ModC50KX08L3NwYW4+YCkuam9pbigiIikrYDwvZGl2PmB9CiAgIGgrPSI8L2Rpdj4iOwogIH0KIH0KIGVsLmlubmVySFRNTD1oOwogY29uc3Qgcz0kKCJob2xlRm9jdXMiKTtzLnZhbHVlPWhtO3Mub25jaGFuZ2U9cmVuZGVySG9sZTsKfQoKLyogLS0tIOWFqOODrOODvOOCue+8iOmmrOOBlOOBqOOBrueiuueOh+ODu+OCquODg+OCuuODu+acn+W+heWApOODu+mojuaJi+ODu+iqv+aVmeW4q++8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyUmFjZXMoKXsKIGNvbnN0IGVsPSQoInZSYWNlcyIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBsZXQgaD0iPGgyPuWFqOODrOODvOOCuTwvaDI+IjsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz5gOwogIGZvcihjb25zdCByIG9mIGNhbGNSYWNlcyhkKSl7CiAgIGlmKHIuc2tpcCl7aCs9YDxkaXYgY2xhc3M9InNtYWxsIj4ke2VzYyhyLmxhYmVsKX3vvJoke2VzYyhyLnNraXApfTwvZGl2PmA7Y29udGludWV9CiAgIGNvbnN0IGc9ci51ZzsKICAgaCs9YDxkZXRhaWxzPjxzdW1tYXJ5PiR7ZXNjKHIubGFiZWwpfSA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK08L3NwYW4+IDxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltnLmdyYWRlXX0iPiR7Zy5ncmFkZX08L3NwYW4+PC9zdW1tYXJ5PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqzvvI/pqI7miYvvvI/oqr/mlZnluKs8L3RoPjx0aD7ljZjli508L3RoPjx0aD7opIfli508L3RoPjx0aD7norrnjoc8L3RoPjx0aD5FVjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgeCBvZiByLmhvcnNlcy5zbGljZSgpLnNvcnQoKGEsYik9PmIucC1hLnApKQogICAgaCs9YDx0cj48dGQ+PGI+JHt4Lm5vfTwvYj4gJHtlc2MoeC5uYW1lKX0ke3guaG9sZSYmeC5yYXRpbmchPT0iQyI/YCA8c3BhbiBjbGFzcz0icnQgciR7eC5yYXRpbmd9Ij4ke3gucmF0aW5nfTwvc3Bhbj5gOiIifTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5qbmFtZT9lc2MoeC5qbmFtZSk6JzxzcGFuIGNsYXNzPSJiYWQiPumojuaJi+S4jeaYjjwvc3Bhbj4nfe+8iCR7eC5qbj49NT8i6YGO5Y67Iit4LmpuKyLpqI7kuZciOiLlsaXmrbTlsJEife+8ie+8jyR7eC50cmFpbmVyP2VzYyh4LnRyYWluZXIpOic8c3BhbiBjbGFzcz0iYmFkIj7oqr/mlZnluKvkuI3mmI48L3NwYW4+J30ke3gudHJSYXRlIT1udWxsJiZ4LnRyTj49MjA/Iu+8iDPnnYDlhoUiK3BjdCh4LnRyUmF0ZSkrIu+8iSI6IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7eC53aW4/eC53aW4udG9GaXhlZCgxKToiLSJ9PC90ZD48dGQ+JHt4LmxvP3gubG8udG9GaXhlZCgxKSsoeC5oaT54LmxvPyLjgJwiK3guaGkudG9GaXhlZCgxKToiIik6Ii0ifTxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LnNyY3x8IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHgucCl9PC90ZD48dGQ+JHt4LmV2IT1udWxsP2A8YiR7eC5ldj49MS4wNT8nIGNsYXNzPSJnb29kIic6IiJ9PiR7eC5ldi50b0ZpeGVkKDIpfTwvYj5gOiItIn08L3RkPjwvdHI+YDsKICAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2RldGFpbHM+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOWPluOCiui+vOOBv+eKtuazge+8iOmgreaVsOODu+mojuaJi+ODu+iqv+aVmeW4q+ODu+OCs+ODvOOCueODu+OCquODg+OCuuOBruiqreOBv+WPluOCiue1kOaenO+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyU3VtKCl7CiBjb25zdCBlbD0kKCJ2U3VtIik7aWYoIVdLLmRhdGVzLmxlbmd0aCYmIVdLLmRpYWcubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgcnM9YWxsUmFjZXMoKS5maWx0ZXIocj0+IXIuc2tpcCk7CiBjb25zdCBob3JzZXM9cnMucmVkdWNlKChzLHIpPT5zK3IubiwwKSxqbWlzcz1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9PiFoLmpuYW1lKS5sZW5ndGgsMCksdG1pc3M9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT4haC50cmFpbmVyKS5sZW5ndGgsMCk7CiBjb25zdCBqbWF0Y2g9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT5oLmpuPj01KS5sZW5ndGgsMCksaG1hdGNoPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+aC5uPj0yKS5sZW5ndGgsMCk7CiBjb25zdCBub0NvdXJzZT1ycy5maWx0ZXIocj0+ci5jb3Vyc2U9PT0i44Kz44O844K55LiN5piOIikubGVuZ3RoLG5PZGRzPXJzLmZpbHRlcihyPT5yLmhhc09kZHMpLmxlbmd0aCxwUmVhbD1ycy5maWx0ZXIocj0+ci5wbGFjZVJlYWw+MCkubGVuZ3RoOwogbGV0IGg9YDxoMj7lj5bjgorovrzjgb/nirbms4E8L2gyPjx0YWJsZT48dGJvZHk+CiA8dHI+PHRkPuino+aekOOBl+OBn+ODrOODvOOCue+8j+WHuui1sOmmrDwvdGQ+PHRkPiR7cnMubGVuZ3RofeODrOODvOOCue+8jyR7aG9yc2VzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+6aiO5omL44KS6Kqt44KB44Gq44GL44Gj44Gf6aasPC90ZD48dGQgY2xhc3M9IiR7am1pc3M/ImJhZCI6Imdvb2QifSI+JHtqbWlzc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPuiqv+aVmeW4q+OCkuiqreOCgeOBquOBi+OBo+OBn+mmrDwvdGQ+PHRkIGNsYXNzPSIke3RtaXNzPyJiYWQiOiJnb29kIn0iPiR7dG1pc3N96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7jgrPjg7zjgrnjgpLoqq3jgoHjgarjgYvjgaPjgZ/jg6zjg7zjgrk8L3RkPjx0ZCBjbGFzcz0iJHtub0NvdXJzZT8iYmFkIjoiZ29vZCJ9Ij4ke25vQ291cnNlfTwvdGQ+PC90cj4KIDx0cj48dGQ+44Kq44OD44K644KS5Y+W5b6X44Gn44GN44Gf44Os44O844K5PC90ZD48dGQ+JHtuT2Rkc33vvI8ke3JzLmxlbmd0aH3vvIjopIfli53jga7lrp/jgqrjg4PjgrogJHtwUmVhbH3jg6zjg7zjgrnvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmmrO+8iTwvdGQ+PHRkPiR7aG1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDLotbDku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmojuaJi++8iTwvdGQ+PHRkPiR7am1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDXpqI7kuZfku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPuWtpue/kuODh+ODvOOCv+OBruacgOe1guaXpTwvdGQ+PHRkPiR7ZXNjKFdLLnN0b3JlSW5mbyYmV0suc3RvcmVJbmZvLmxhc3R8fCItIil9PC90ZD48L3RyPjwvdGJvZHk+PC90YWJsZT5gOwogY29uc3Qgc2NyPXJzLmZpbHRlcihyPT5yLnNjcmF0Y2hlZCYmci5zY3JhdGNoZWQubGVuZ3RoKSxqbXA9YWxsUmFjZXMoKS5maWx0ZXIocj0+ci5za2lwJiYv6Zqc5a6zLy50ZXN0KHIuc2tpcCkpOwogaWYoc2NyLmxlbmd0aCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4Pjgrrjga7nhKHjgYTppqzjgpLlj5bmtojjg7vpmaTlpJbjgajjgb/jgarjgZfjgablpJbjgZfjgZ/jg6zjg7zjgrnvvJoke3Njci5tYXAocj0+ZXNjKHIubGFiZWwpKyLvvIgiK3Iuc2NyYXRjaGVkLmpvaW4oIiwiKSsi55Wq77yJIikuam9pbigi77yPIil944CC5a6f6Zqb44Gr5Ye66LWw44GZ44KL6aas44Gq44KJ44CB44Kq44OD44K644Gu5Y+W5b6X5ryP44KM44Gn44GZ44CCPC9kaXY+YDsKIGlmKGptcC5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7pmpzlrrPjg6zjg7zjgrkgJHtqbXAubGVuZ3RofeS7tuOBr+OAgeW5s+WcsOeUqOOBruODouODh+ODq+OBruOBn+OCgeino+aekOOBruWvvuixoeWkluOBq+OBl+OBpuOBhOOBvuOBmeOAgjwvZGl2PmA7CiBjb25zdCBnYXA9V0suc3RvcmVJbmZvJiZXSy5zdG9yZUluZm8ubGFzdCYmV0suZGF0ZXNbMF0/TWF0aC5yb3VuZCgobmV3IERhdGUoV0suZGF0ZXNbMF0pLW5ldyBEYXRlKFdLLnN0b3JlSW5mby5sYXN0KSkvODY0ZTUpOm51bGw7CiBpZihnYXAhPW51bGwmJmdhcD4xMCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnIDmlrDjga7miJDnuL7jgYwke2dhcH3ml6XliIblhaXjgaPjgabjgYTjgb7jgZvjgpPjgILjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GX44Gm44GL44KJ44CB44KC44GG5LiA5bqm5LqI5oOz44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKIGlmKHJzLmxlbmd0aCYmaG1hdGNoPGhvcnNlcyouNCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7pgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgafjgY3jgZ/ppqzjgYzlsJHjgarjgoHjgafjgZnjgILoi6Xpp5LmiKbkuK3lv4Pjga7ml6Xjga/mraPluLjjgafjgZnjgYzjgIHjgZ3jgYbjgafjgarjgZHjgozjgbDppqzlkI3jga7ooajoqJjjgYzlkIjjgaPjgabjgYTjgarjgYTlj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgII8L2Rpdj4nOwogY29uc3Qgb249V0sub2Rkc05vdGVzfHx7fTsKIGlmKE9iamVjdC5rZXlzKG9uKS5sZW5ndGgpe2grPWA8aDM+44Kq44OD44K65Y+W5b6X44Gu5YaF6KizPC9oMz48ZGl2IGNsYXNzPSJzdGF0dXMiPiR7V0suZGF0ZXMubWFwKGQ9PmAke2RheUxhYmVsKGQpfVxuJHsob25bZF18fFtdKS5tYXAoZXNjKS5qb2luKCJcbiIpfWApLmpvaW4oIlxuXG4iKX08L2Rpdj5gfQogaCs9YDxoMz7plovlgqzloLTjgZTjgag8L2gzPjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7plovlgqzloLQ8L3RoPjx0aD7jg6zjg7zjgrk8L3RoPjx0aD7nirbmhYs8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB4IG9mIFdLLmRpYWcpewogIGNvbnN0IHByb2JzPVtdO2lmKHguZXJyKXByb2JzLnB1c2goeC5lcnIpO2lmKHguYmFkKXByb2JzLnB1c2goYOWHuui1sOmmrOOCkuiqreOCgeOBquOBhOODrOODvOOCuSAke3guYmFkfWApO3Byb2JzLnB1c2goLi4uKHguaXNzdWVzfHxbXSkpOwogIGgrPWA8dHI+PHRkPiR7ZXNjKGRheUxhYmVsKHguZCkpfSAke2VzYyh4Lm5hbWUpfTwvdGQ+PHRkPiR7eC5va30vJHt4LnJhY2VzfTwvdGQ+PHRkIHN0eWxlPSJ0ZXh0LWFsaWduOmxlZnQiPiR7cHJvYnMubGVuZ3RoP2A8c3BhbiBjbGFzcz0iYmFkIHNtYWxsIj4ke3Byb2JzLm1hcChlc2MpLmpvaW4oIjxicj4iKX08L3NwYW4+YDonPHNwYW4gY2xhc3M9Imdvb2QiPuWVj+mhjOOBquOBlzwvc3Bhbj4nfSR7eC5jb2RlP2AgPGJ1dHRvbiBjbGFzcz0ibWluaSBzdWIiIGRhdGEtcmw9IiR7ZXNjKHguZCl9fCR7ZXNjKHguY29kZSl9fCR7ZXNjKHgubmFtZSl9Ij7lho3lj5blvpc8L2J1dHRvbj5gOiIifTwvdGQ+PC90cj5gOwogfQogaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogZWwuaW5uZXJIVE1MPWg7CiBlbC5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1ybF0iKS5mb3JFYWNoKGI9PmIub25jbGljaz1hc3luYygpPT57CiAgY29uc3QgW2QsY29kZSxuYW1lXT1iLmRhdGFzZXQucmwuc3BsaXQoInwiKTtiLmRpc2FibGVkPXRydWU7d2tNc2coYCR7ZH0gJHtuYW1lfSDjgpLlho3lj5blvpfkuK3igKZgKTsKICB0cnl7YXdhaXQgbG9hZFZlbnVlSW50byhiYXNlVXJsKCksZCx7dmVudWVDb2RlOmNvZGUsdmVudWVOYW1lOm5hbWV9KTthd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2VVcmwoKSxkKTthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpO3drTXNnKCLlho3lj5blvpfjgZfjgb7jgZfjgZ8iKX0KICBjYXRjaChlKXt3a01zZygi5YaN5Y+W5b6X44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogfSk7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDmk43kvZwKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpmdW5jdGlvbiBzaG93VGFiKHQpe2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIi52aWV3IikuZm9yRWFjaCh2PT52LmNsYXNzTGlzdC50b2dnbGUoIm9uIix2LmlkPT09dCkpO2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiN0YWJzIGJ1dHRvbiIpLmZvckVhY2goYj0+Yi5jbGFzc0xpc3QudG9nZ2xlKCJvbiIsYi5kYXRhc2V0LnRhYj09PXQpKX0KZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI3RhYnMgYnV0dG9uIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PnNob3dUYWIoYi5kYXRhc2V0LnRhYikpOwokKCJ1cFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgidXBSdW4iKS5kaXNhYmxlZD10cnVlOyQoInVwT3V0IikudGV4dENvbnRlbnQ9IuaknOiovOS4reKApu+8iOaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iSI7CiB0cnl7CiAgY29uc3Qgcj1hd2FpdCBydW5VcHNldEZpdCh7c3RhcnQ6JCgidXBTdGFydCIpLnZhbHVlfHwiMjAyMS0wMS0wMSJ9KTsKICAkKCJ1cE91dCIpLmlubmVySFRNTD11cHNldFJlcG9ydChyKTsKICBpZihyLm1vZGVsKXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShVUEtFWSxKU09OLnN0cmluZ2lmeShyLm1vZGVsKSk7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX0KIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJ1cE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9ImJhZCI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7JCgidXBSdW4iKS5kaXNhYmxlZD1mYWxzZX0KfTsKJCgidXBDbGVhciIpLm9uY2xpY2s9YXN5bmMoKT0+e2xvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFVQS0VZKTskKCJ1cE91dCIpLnRleHRDb250ZW50PSLmqJnmupbjg6Ljg4fjg6vjgavmiLvjgZfjgb7jgZfjgZ/jgIIiO2lmKFdLLmRhdGVzLmxlbmd0aCl7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKX19OwokKCJwbFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgicGxSdW4iKS5kaXNhYmxlZD10cnVlOyQoInBsT3V0IikudGV4dENvbnRlbnQ9IuaknOiovOS4reKApu+8iOaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iSI7CiB0cnl7CiAgY29uc3Qgcj1hd2FpdCBydW5QbGFjZUZpdCh7c3RhcnQ6JCgicGxTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSJ9KTsKICAkKCJwbE91dCIpLmlubmVySFRNTD1wbGFjZVJlcG9ydChyKTsKICBpZihyLm1vZGVsKWxvY2FsU3RvcmFnZS5zZXRJdGVtKFBMS0VZLEpTT04uc3RyaW5naWZ5KHIubW9kZWwpKTtlbHNlIGlmKCFyLmVycm9yKWxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFBMS0VZKTsKICBpZighci5lcnJvciYmV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfQogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoInBsT3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iYmFkIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXskKCJwbFJ1biIpLmRpc2FibGVkPWZhbHNlfQp9OwokKCJwbENsZWFyIikub25jbGljaz1hc3luYygpPT57bG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oUExLRVkpOyQoInBsT3V0IikudGV4dENvbnRlbnQ9Iuaomea6luOBq+aIu+OBl+OBvuOBl+OBn+OAgiI7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX07CiQoIndrR28iKS5vbmNsaWNrPXdlZWtlbmRHbzsKJCgid2tPZGRzIikub25jbGljaz1vZGRzT25seTsKJCgiYmtPbmUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGlmKEJLLmJ1c3kpcmV0dXJuOwogaWYoIUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpewogIGNvbnN0IHA9cHJvbXB0KCLjg5Djg4Pjgq/jgqLjg4Pjg5fnlKjjga7jg5Hjgrnjg5Xjg6zjg7zjgrrvvIg45paH5a2X5Lul5LiK77yJ44KS5rG644KB44Gm5YWl5Yqb44GX44Gm44GP44Gg44GV44GE44CC5b6p5YWD44Gu44Go44GN44Gr44KC5ZCM44GY44KC44Gu44GM5b+F6KaB44Gn44GZ44CCIik7CiAgaWYoIXApcmV0dXJuO0JLLnBhc3M9cC50cmltKCk7QksuaWQ9IiI7YmtTYXZlU2V0dGluZ3MoKTskKCJia1Bhc3MiKS52YWx1ZT1CSy5wYXNzOwogIGlmKEJLLnBhc3MubGVuZ3RoPDgpe2JrTXNnKCLjg5Hjgrnjg5Xjg6zjg7zjgrrjga845paH5a2X5Lul5LiK44Gr44GX44Gm44GP44Gg44GV44GE44CCIix0cnVlKTtyZXR1cm59CiB9CiBhd2FpdCBydW5CYWNrdXAoZmFsc2UpOwp9OwokKCJkYmdHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3Qgb3V0PSQoImRiZ091dCIpLGJhc2U9YmFzZVVybCgpOwogaWYoIVdLLmRhdGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiBvdXQudmFsdWU9IuiouuaWreS4reKApiI7JCgiZGJnR28iKS5kaXNhYmxlZD10cnVlO2NvbnN0IGxpbmVzPVtg5Y+W5b6X5pelICR7V0suZGF0ZXMuam9pbigiLCIpfWBdOwogdHJ5ewogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICAgY29uc3QgY29kZXM9Wy4uLm5ldyBTZXQoKFdLLmNhcmRzW2RdfHxbXSkubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbik7CiAgIGZvcihjb25zdCB2IG9mIGNvZGVzKXsKICAgIGNvbnN0IHJzPVdLLmNhcmRzW2RdLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIik9PT12KTsKICAgIGNvbnN0IHE9cnMubWFwKHI9PnIucXVhbGl0eSkuZmlsdGVyKEJvb2xlYW4pOwogICAgbGluZXMucHVzaChgXG7ilqAke2R9IOmWi+WCrOWgtCR7dn3vvIgke3JzWzBdPy52ZW51ZU5hbWV8fCIife+8ieODrOODvOOCuSR7cnMubGVuZ3Rofe+8j+OCs+ODvOOCueS4jeaYjiR7cnMuZmlsdGVyKHI9PiEoci5zdXJmYWNlJiZyLmRpc3RhbmNlKSkubGVuZ3Rofe+8j+mojuaJi+asoCR7cS5yZWR1Y2UoKHMseCk9PnMrKHguaG9yc2VzLXguam9ja2V5RmlsbGVkKSwwKX3vvI/oqr/mlZnluKvmrKAke3EucmVkdWNlKChzLHgpPT5zKyh4LmhvcnNlcy14LnRyYWluZXJGaWxsZWQpLDApfWApOwogICAgY29uc3QgYmFkPXJzLmZpbmQocj0+ci5xdWFsaXR5JiYhci5xdWFsaXR5Lm9rKXx8cnNbMF0scm49KGJhZCYmYmFkLnJhY2VOdW1iZXIpfHwxO2xpbmVzLnB1c2goYO+8iOWVj+mhjOOBruOBguOCi+ODrOODvOOCuSAke3JufVIg44KS6Kq/44G544G+44GZ77yJYCk7dHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2RlYnVnLWVudHJ5P2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9JnJhY2U9JHtybn1gLFsxNTAwXSk7ZGVsZXRlIHgub2s7bGluZXMucHVzaChKU09OLnN0cmluZ2lmeSh4KSl9Y2F0Y2goZSl7bGluZXMucHVzaCgi6Ki65pat44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogICB9CiAgfQogfWZpbmFsbHl7JCgiZGJnR28iKS5kaXNhYmxlZD1mYWxzZX0KIG91dC52YWx1ZT1saW5lcy5qb2luKCJcbiIpOwp9OwokKCJvZGRzRGJnIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgib2Rkc091dCIpLGJhc2U9YmFzZVVybCgpOwogaWYoIVdLLmRhdGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiBvdXQudmFsdWU9IuiouuaWreS4reKApiI7JCgib2Rkc0RiZyIpLmRpc2FibGVkPXRydWU7CiBjb25zdCBMPVtg5pmC5Yi7ICR7bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDE2KS5yZXBsYWNlKCJUIiwiICIpfe+8iOaXpeacrOaZgumWk++8iWBdOwogdHJ5ewogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICAgY29uc3QgY3M9V0suY2FyZHNbZF18fFtdLHZzPVsuLi5uZXcgU2V0KGNzLm1hcChjPT5TdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pOwogICBmb3IoY29uc3QgdiBvZiB2cyl7CiAgICBjb25zdCBycz1jcy5maWx0ZXIoYz0+U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpPT09dik7CiAgICBjb25zdCBnb3Q9cnMuZmlsdGVyKGM9PldLLm9kZHNbcmtleShkLGMpXSkubWFwKGM9PmMucmFjZU51bWJlcikuam9pbigiLCIpLGxpbms9cnMuZmlsdGVyKGM9PmMub2Rkc0NuYW1lKS5tYXAoYz0+Yy5yYWNlTnVtYmVyKS5qb2luKCIsIik7CiAgICBMLnB1c2goYFxu4pagJHtkfSAke1ZFTlVFW3ZdfHx2fe+8muODrOODvOOCuSR7cnMubGVuZ3Rofe+8j+WHuummrOihqOOBq+OCquODg+OCuuOBuOOBruODquODs+OCr+OBguOCiiBbJHtsaW5rfHwi44Gq44GXIn1d77yP44Kq44OD44K65Y+W5b6X5riI44G/IFske2dvdHx8IuOBquOBlyJ9XWApOwogICAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzLWxpbmtzP2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9YCxbMTUwMF0pOwogICAgIEwucHVzaChgICDjgqrjg4PjgrrnlLvpnaLjga7jg6Hjg4vjg6Xjg7zjgavjgYLjgovjg6zjg7zjgrkgWyR7KHgubGlua3N8fFtdKS5tYXAoeT0+eS5yYWNlTm8pLmpvaW4oIiwiKXx8IuOBquOBlyJ9XWApOwogICAgIGZvcihjb25zdCBnIG9mICh4LmRpYWd8fFtdKSlMLnB1c2goIiAgIitKU09OLnN0cmluZ2lmeSh7c3RlcDpnLnN0ZXAsbGVuOmcuaHRtbExlbmd0aCxuOmcuY25hbWVzLGtpbmRzOmcua2luZHMsbWVudXM6Zy5tZW51cyxyYWNlczpnLnJhY2VzLGVycjpnLmVycm9yLHNhbXBsZTooZy5zYW1wbGV8fFtdKS5zbGljZSgwLDMpfSkpOwogICAgfWNhdGNoKGUpe0wucHVzaCgiICDjg6Hjg4vjg6Xjg7zlj5blvpfjgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9CiAgIH0KICB9CiB9ZmluYWxseXskKCJvZGRzRGJnIikuZGlzYWJsZWQ9ZmFsc2V9CiBvdXQudmFsdWU9TC5qb2luKCJcbiIpOwp9OwokKCJvZGRzQ29weSIpLm9uY2xpY2s9YXN5bmMoKT0+e2NvbnN0IHQ9JCgib2Rkc091dCIpLnZhbHVlO3RyeXthd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KTskKCJvZGRzQ29weSIpLnRleHRDb250ZW50PSLjgrPjg5Tjg7zjgZfjgb7jgZfjgZ8ifWNhdGNoKGUpeyQoIm9kZHNPdXQiKS5zZWxlY3QoKTthbGVydCgi6YG45oqe44GX44G+44GX44Gf44CC44Kz44OU44O844GX44Gm44GP44Gg44GV44GE44CCIil9fTsKJCgiZGJnQ29weSIpLm9uY2xpY2s9YXN5bmMoKT0+e2NvbnN0IHQ9JCgiZGJnT3V0IikudmFsdWU7dHJ5e2F3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpOyQoImRiZ0NvcHkiKS50ZXh0Q29udGVudD0i44Kz44OU44O844GX44G+44GX44GfIn1jYXRjaChlKXskKCJkYmdPdXQiKS5zZWxlY3QoKTthbGVydCgi6YG45oqe44GX44G+44GX44Gf44CC44Kz44OU44O844GX44Gm44GP44Gg44GV44GE44CCIil9fTsKJCgiZmlsZSIpLm9uY2hhbmdlPWU9Pntjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKGYpaW1wb3J0RmlsZShmKTtlLnRhcmdldC52YWx1ZT0iIn07CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GX77yI5Y+W5b6X5riI44G/44Gu5pel44KS44CB5paw44GX44GE6aCF55uu44Gk44GN44Gn5Y+W44KK55u044GZ77yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KYXN5bmMgZnVuY3Rpb24gbGFwUmVmZXRjaChkZXBzKXsKIGNvbnN0IEQ9T2JqZWN0LmFzc2lnbih7aWRiQWxsLGlkYlB1dCxtZXRhR2V0LG1ldGFQdXQsZmV0Y2hEYXl9LGRlcHN8fHt9KTsKIGNvbnN0IGJhc2U9YmFzZVVybCgpLGE9JCgibGFwU3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpLG1zZz10PT57JCgibGFwU3RhdHVzIikuaW5uZXJIVE1MPXR9OwogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoImxhcEdvIikuZGlzYWJsZWQ9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPWZhbHNlOwogY29uc3Qgc3Q9e2RheXM6MCxyYWNlczowLGxhcHM6MCxjb3JuZXJzOjAsaG9yc2VzOjAsZmFpbDpbXSxza2lwcGVkOjAsdDA6RGF0ZS5ub3coKSxub2RhdGE6ZmFsc2Usc3RvcHBlZDpmYWxzZX07bGV0IGNvbnNlYz0wLHRvdGFsPTA7CiB0cnl7CiAgY29uc3QgZmlsZXM9KGF3YWl0IEQuaWRiQWxsKCkpLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgmJmYuZGF0ZT49YSYmZi5kYXRlPD15ZCkuc29ydCgoeCx5KT0+eC5kYXRlPHkuZGF0ZT8tMToxKTsKICBjb25zdCB0b2RvPVtdOwogIGZvcihjb25zdCBmIG9mIGZpbGVzKXtpZihmLnJvd3Muc29tZShyPT5BcnJheS5pc0FycmF5KHIubGFwKSYmci5sYXAubGVuZ3RoKXx8YXdhaXQgRC5tZXRhR2V0KCJsYXBkb25lOiIrZi5kYXRlKSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfXRvZG8ucHVzaChmLmRhdGUpfQogIHRvdGFsPXRvZG8ubGVuZ3RoOwogIGlmKCF0b3RhbCl7bXNnKGDlj5bjgornm7TjgZnml6Xjga/jgYLjgorjgb7jgZvjgpPvvIgke2F95Lul6ZmN44GuJHtmaWxlcy5sZW5ndGh95pel44Gv44CB44GZ44G544Gm44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gk44GN44Gn44GZ77yJ44CCYCk7cmV0dXJufQogIGZvcihsZXQgaT0wO2k8dG9kby5sZW5ndGg7aSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgZD10b2RvW2ldLGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICBtc2coYCR7ZH3vvIgke2krMX0vJHt0b3RhbH3ml6XvvInjgpLlj5blvpfkuK3igKZcbuWPluOCiuebtOOBlyR7c3QuZGF5c33ml6XvvI/jg6njg4Pjg5fjgpLoqq3jgoHjgZ/jg6zjg7zjgrkgJHtzdC5sYXBzfS8ke3N0LnJhY2Vzfe+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmApOwogICB0cnl7CiAgICBjb25zdCByPWF3YWl0IEQuZmV0Y2hEYXkoYmFzZSxkKTsKICAgIGlmKHIuZmFpbGVkTil7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgIGNvbnN0IHJpZHM9bmV3IFNldChyLnJvd3MubWFwKHg9PngucmFjZUlkKSksbGFwUmFjZXM9bmV3IFNldChyLnJvd3MuZmlsdGVyKHg9PkFycmF5LmlzQXJyYXkoeC5sYXApJiZ4LmxhcC5sZW5ndGgpLm1hcCh4PT54LnJhY2VJZCkpOwogICAgY29uc3QgY29ybmVySG9yc2VzPXIucm93cy5maWx0ZXIoeD0+QXJyYXkuaXNBcnJheSh4LmNvcm5lcikmJnguY29ybmVyLmxlbmd0aD49MikubGVuZ3RoOwogICAgYXdhaXQgRC5pZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTsKICAgIGlmKGxhcFJhY2VzLnNpemV8fGNvcm5lckhvcnNlcylhd2FpdCBELm1ldGFQdXQoImxhcGRvbmU6IitkLHRydWUpOwogICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yaWRzLnNpemU7c3QubGFwcys9bGFwUmFjZXMuc2l6ZTtzdC5jb3JuZXJzKz1jb3JuZXJIb3JzZXM7c3QuaG9yc2VzKz1yLnJvd3MubGVuZ3RoO2NvbnNlYz0wOwogICAgaWYoc3QuZGF5cz49MiYmc3QubGFwcz09PTAmJnN0LmNvcm5lcnM9PT0wKXtzdC5ub2RhdGE9dHJ1ZTtTU1RPUD10cnVlfQogICB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgYXdhaXQgc2xlZXAoNDAwKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJsYXBHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICBjb25zdCByYXRlPSh4LHkpPT55P01hdGgucm91bmQoeC95KjEwMCkrIiUiOiItIjsKICBsZXQgaD1gJHtzdC5ub2RhdGE/JzxzcGFuIGNsYXNzPSJiYWQiPuODqeODg+ODl+OCgumAmumBjumghuS9jeOCguiqreOCgeOBvuOBm+OCk+OBp+OBl+OBn+OAguS4reaWreOBl+OBvuOBl+OBn+OAgjwvc3Bhbj5cbuOAjOiqreOBv+WPluOCiuOBruiouuaWreOAjeOCkuaKvOOBl+OAgeWHuuOBn+aWh+eroOOCkuiyvOOBo+OBpuOBj+OBoOOBleOBhOOAglxuJzooc3Quc3RvcHBlZD8i6YCj57aa44GX44Gm5aSx5pWX44GX44Gf44Gf44KB5Lit5pat44GX44G+44GX44Gf44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44CB44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOihTU1RPUD8i5YGc5q2i44GX44G+44GX44Gf44CCIjoi5a6M5LqG44CCIikpfWA7CiAgaCs9YOWPluOCiuebtOOBlyAke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJXG7jg6njg4Pjg5fjgpLoqq3jgoHjgZ/jg6zjg7zjgrnvvJoke3N0LmxhcHMudG9Mb2NhbGVTdHJpbmcoKX0vJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfe+8iCR7cmF0ZShzdC5sYXBzLHN0LnJhY2VzKX3vvIlcbumAmumBjumghuS9jeOCkuiqreOCgeOBn+mmrO+8miR7c3QuY29ybmVycy50b0xvY2FsZVN0cmluZygpfS8ke3N0LmhvcnNlcy50b0xvY2FsZVN0cmluZygpfe+8iCR7cmF0ZShzdC5jb3JuZXJzLHN0LmhvcnNlcyl977yJYDsKICBpZihzdC5mYWlsLmxlbmd0aCloKz1gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIife+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeaui+OCiuOBoOOBkee2muOBjeOBi+OCie+8iTwvc3Bhbj5gOwogIG1zZyhoKTt0cnl7YXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpfWNhdGNoKGUpe30KIH0KIHJldHVybiBzdDsKfQokKCJsYXBHbyIpLm9uY2xpY2s9KCk9PmxhcFJlZmV0Y2goKTsKJCgibGFwRGJnIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgibGFwT3V0Iik7b3V0LnZhbHVlPSLoqLrmlq3kuK3igKYiOwogdHJ5ewogIGNvbnN0IGZpbGVzPShhd2FpdCBpZGJBbGwoKSkuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkuc29ydCgoeCx5KT0+eC5kYXRlPHkuZGF0ZT8tMToxKTsKICBpZighZmlsZXMubGVuZ3RoKXtvdXQudmFsdWU9IuWPluW+l+a4iOOBv+OBruaIkOe4vuOBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+OAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIiO3JldHVybn0KICBjb25zdCBkPWZpbGVzW2ZpbGVzLmxlbmd0aC0xXS5kYXRlLGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZVVybCgpfS9qcmEtZGF5P2RhdGU9JHtkfWApLHJhY2VzPWRheS5yYWNlc3x8W107CiAgY29uc3Qgcj1yYWNlcy5maW5kKHg9PngucmFjZU5vPT09MTEpfHxyYWNlc1swXTsKICBpZighcil7b3V0LnZhbHVlPWAke2R9IOOBruODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCk2A7cmV0dXJufQogIGNvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2VVcmwoKX0vZGVidWctcmVzdWx0P2NuYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHIuY25hbWUpfWApO2RlbGV0ZSB4Lm9rOwogIG91dC52YWx1ZT1g5pel5LuYICR7ZH0g6ZaL5YKs5aC0JHtyLnZlbnVlQ29kZX0gJHtyLnJhY2VOb31SXG5gK0pTT04uc3RyaW5naWZ5KHgpOwogfWNhdGNoKGUpe291dC52YWx1ZT0i6Ki65pat44Ko44Op44O877yaIitlLm1lc3NhZ2V9Cn07CgppZigvXmh0dHBzPzovLnRlc3QobG9jYXRpb24ucHJvdG9jb2wpKSQoInd1cmwiKS52YWx1ZT1sb2NhdGlvbi5vcmlnaW47ZWxzZSAkKCJ3dXJsIikudmFsdWU9Imh0dHBzOi8va2VpYmEtYWktcGF5b3V0cy5odDE5OTUwODIyLndvcmtlcnMuZGV2IjsKcmVuZGVyR2F0ZSgpO3JlbmRlckFsbCgpOwooYXN5bmMoKT0+e3RyeXthd2FpdCBvcGVuREIoKTthd2FpdCBzaG93U3RhdGUoKTthd2FpdCBia0luaXQoKX1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5L+d5a2Y6aCY5Z+f44KS6ZaL44GR44G+44Gb44KT77yaJHtlc2MoZS5tZXNzYWdlKX1cbu+8iOODl+ODqeOCpOODmeODvOODiOODluODqeOCpuOCuuOBp+OBr+S9v+OBiOOBquOBhOOBk+OBqOOBjOOBguOCiuOBvuOBme+8iTwvc3Bhbj5gfX0pKCk7Cgo8L3NjcmlwdD4KPC9ib2R5PjwvaHRtbD4K";
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
      if (p === "/jra-odds-links") return await handleJraOddsLinks(request);
      if (p === "/debug-entry") return await handleDebugEntry(request);
      if (p === "/debug-result") return await handleDebugResult(request);
      return errorResponse("見つかりません: " + p, 404);
    } catch (error) {
      return errorResponse(error?.message || error, 500);
    }
  }
};
