/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-10-rebuild-11";

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
  "180": "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",
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGRpdiBpZD0iYmtTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2PgogPGRpdiBpZD0iZGF0YVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+CjwvZGl2PgoKPGRpdiBjbGFzcz0idGFicyIgaWQ9InRhYnMiPgogPGJ1dHRvbiBkYXRhLXRhYj0idkF4aXMiIGNsYXNzPSJvbiI+6LaF6YmE5p2/PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2RXYiPuacn+W+heWApDwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlVwc2V0Ij7ms6LkubHluqY8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZIb2xlIj7nqbTppqw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZSYWNlcyI+5YWo44Os44O844K5PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U3VtIj7lj5bjgorovrzjgb/nirbms4E8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZUZXN0Ij7mpJzoqLw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZTZXQiPuioreWumjwvYnV0dG9uPgo8L2Rpdj4KCjxkaXYgaWQ9ImdhdGUiPjwvZGl2PgoKPGRpdiBpZD0idkF4aXMiIGNsYXNzPSJ2aWV3IG9uIGNhcmQiPjxkaXYgY2xhc3M9InNtYWxsIj7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgII8L2Rpdj48L2Rpdj4KPGRpdiBpZD0idkV2IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlVwc2V0IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idkhvbGUiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2UmFjZXMiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2U3VtIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KCjxkaXYgaWQ9InZUZXN0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7lm57lj47njofjga7mpJzoqLzvvIjmiZXmiLvjgaTjgY3jg7vmmYLns7vliJfvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruaIkOe4vuOBqOaJleaIu+OBp+OAgeOAjOOBneOBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBoOOBkeOAjeOCkuS9v+OBhuODkOODg+OCr+ODhuOCueODiOOCkuOBl+OBvuOBme+8iOWQhOODrOODvOOCuTEwMOWGhu+8ieOAguOBk+OBk+OBpzxiPuWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBruWbnuWPjueOh+OBjDEwMCXjgpLotoXjgYjjgIHoqqTlt67jga7luYXjgpLlvJXjgYTjgabjgoIxMDAl5Lul5LiKPC9iPuOBqOeiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBoOOBkeOBjOOAgeeUu+mdouS4iuOBp+OAjOaknOiovOa4iOOBv+OAjeOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJidEdyYWRlIiBjbGFzcz0ic3ViIj7ph43os57jgaDjgZHvvJrjgrDjg6zjg7zjg4noo5zmraPjgYLjgoov44Gq44GX44KS5q+U6LyDPC9idXR0b24+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5rOi5Lmx5bqm44Gu5L+h6aC85bqm44KS5LiK44GS44KL77yI5YaN5qCh5q2j77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7pgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgavlho3nj77jgZfjgIHms6LkubHluqbjga7kuojmuKzjgajlrp/pmpvjga7ms6LkubHnjofjgpLnqoHjgY3lkIjjgo/jgZvjgb7jgZnjgILjgrPjg7zjgrnliKXvvIjplovlgqzloLTDl+iKneODgMOX6Led6Zuiw5fjgq/jg6njgrnvvInjga7pgY7ljrvms6LkubHnjofjgpLotrPjgZfjgZ/mlrDjg6Ljg4fjg6vjgpLkvZzjgorjgIE8Yj7nj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpM8L2I+44Gn5q+U44G544Gm44CB5piO56K644Gr6Imv44GE44Go44GN44Gg44GR5o6h55So44GX44G+44GZ44CC6Imv44GP44Gq44KJ44Gq44GR44KM44Gw54++6KGM44Gu44G+44G+44Gn44CB562J57Sa44GU44Go44Gu5a6f57i+546H44Gg44GR44KS5qSc6Ki844GX44Gf5pWw5a2X44Gr5beu44GX5pu/44GI44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPuaknOiovOOBrumWi+Wni+aXpSA8aW5wdXQgaWQ9InVwU3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIxLTAxLTAxIj48YnV0dG9uIGlkPSJ1cFJ1biI+5rOi5Lmx5bqm44KS5qSc6Ki844O75YaN5qCh5q2jPC9idXR0b24+PGJ1dHRvbiBpZD0idXBDbGVhciIgY2xhc3M9InN1YiI+5qiZ5rqW44Gr5oi744GZPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJ1cE91dCIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGM77yI6YGO5Y6744Os44O844K544Gu5Y+W5b6X5b6M44Gr5a6f6KGM44CC5pWw5YiG44GL44GL44KK44G+44GZ77yJPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InBheUV4cCIgY2xhc3M9InN1YiI+5omV5oi744KS5pu444GN5Ye644GXPC9idXR0b24+PGxhYmVsIGNsYXNzPSJzbWFsbCI+6Kqt44G/6L6844G/IDxpbnB1dCBpZD0icGF5SW1wIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uIj48L2xhYmVsPjwvZGl2PgogPGRpdiBpZD0iYnRPdXQiIGNsYXNzPSJzdGF0dXMiPuODh+ODvOOCv+WPluW+l+OBruOBguOBqOOBp+Wun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8L2Rpdj4KCjxkaXYgaWQ9InZTZXQiIGNsYXNzPSJ2aWV3IGNhcmQiPgogPGgyPuODkOODg+OCr+OCouODg+ODl+ioreWumu+8iENsb3VkZmxhcmXjgavkv53lrZjvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuODkeOCueODleODrOODvOOCuuOBrlNIQS0yNTbjgaDjgZHjgpLkvb/jgaPjgabkv53lrZjlhYjjgpLliIbjgZHjgb7jgZnvvIjjg5Hjgrnjg5Xjg6zjg7zjgrroh6rkvZPjga/pgIHjgorjgb7jgZvjgpPvvInjgILlkIzjgZjjg5Hjgrnjg5Xjg6zjg7zjgrrjgaflvqnlhYPjgafjgY3jgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJia1Bhc3MiIHR5cGU9InBhc3N3b3JkIiBwbGFjZWhvbGRlcj0i44OR44K544OV44Os44O844K677yIOOaWh+Wtl+S7peS4iu+8iSIgYXV0b2NvbXBsZXRlPSJvZmYiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIwMHB4Ij48YnV0dG9uIGlkPSJia1Nob3ciIGNsYXNzPSJzdWIiPuihqOekujwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJia0F1dG8iIHR5cGU9ImNoZWNrYm94IiBjaGVja2VkPiDlpInmm7TjgYzjgYLjgozjgbDoh6rli5Xjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgZnjgos8L2xhYmVsPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJia05vdyI+5LuK44GZ44GQ5beu5YiG44OQ44OD44Kv44Ki44OD44OXPC9idXR0b24+PGJ1dHRvbiBpZD0iYmtSZXN0b3JlIiBjbGFzcz0ic3ViIj7jg5Djg4Pjgq/jgqLjg4Pjg5fjgYvjgonlvqnlhYM8L2J1dHRvbj48YnV0dG9uIGlkPSJia0Z1bGwiIGNsYXNzPSJzdWIiPuOBmeOBueOBpuS/neWtmOOBl+ebtOOBmTwvYnV0dG9uPjwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPumBjuWOu+ODh+ODvOOCv+OBruiqreOBv+i+vOOBv++8iOS7u+aEj++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Lul5YmN44Gu44OQ44OD44Kv44Ki44OD44OXSlNPTu+8j+aIkOe4vkNTVuOBjOOBguOCjOOBsOiqreOBv+i+vOOCgeOBvuOBme+8iOWQjOOBmOaXpeOBr+mHjeikh+OBl+OBvuOBm+OCk++8ieOAgjwvZGl2PgogPGlucHV0IGlkPSJmaWxlIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uLC5jc3YsYXBwbGljYXRpb24vanNvbix0ZXh0L2NzdiI+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+6Ki65patPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lh7rppqzooajjga7oqq3jgb/lj5bjgorjgavllY/poYzjgYzjgYLjgovjgajjgY3jgIHplovlgqzloLTjgZTjgajjgasxUuOBruODmuODvOOCuOOBruS4rei6q+OCkuiqv+OBueOBpuS4i+OBq+WHuuOBl+OBvuOBmeOAguOCs+ODlOODvOOBl+OBpumAgeOBo+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJkYmdHbyIgY2xhc3M9InN1YiI+6Ki65pat5oOF5aCx44KS5L2c44KLPC9idXR0b24+PGJ1dHRvbiBpZD0iZGJnQ29weSIgY2xhc3M9InN1YiI+44Kz44OU44O8PC9idXR0b24+PC9kaXY+CiA8dGV4dGFyZWEgaWQ9ImRiZ091dCIgcmVhZG9ubHkgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjE0MHB4O2ZvbnQtc2l6ZToxMnB4Ij48L3RleHRhcmVhPgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuODqeODg+ODl+ODu+mAmumBjumghuS9jeOBruWPluOCiuebtOOBlzwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Y+W5b6X5riI44G/44Gu44Os44O844K544KS44CB44Os44O844K55YWo5L2T44Gu44Op44OD44OX77yI44OP44Ot44Oz44K/44Kk44Og77yJ44Go5ZCE6aas44Gu44Kz44O844OK44O86YCa6YGO6aCG5L2N44Gk44GN44Gn5Y+W44KK55u044GX44G+44GZ77yI44Oa44O844K544O76ISa6LOq44KS5LqI5oOz44Gr5L2/44GG44Gf44KB44Gu5rqW5YKZ77yJ44CC5L+d5a2Y5riI44G/44Gu5pel44Gv5LiK5pu444GN44GV44KM44G+44GZ44CC5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZ44CC44G+44Ga5paw44GX44GE5pyf6ZaT44GL44KJ5bCR44GX44Gg44GR6Kmm44GX44Gm44CB6Kqt44KB44Gm44GE44KL44GL44KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPumWi+Wni+aXpSA8aW5wdXQgaWQ9ImxhcFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyNi0wMS0wMSI+PGJ1dHRvbiBpZD0ibGFwR28iPuWPluOCiuebtOOBmTwvYnV0dG9uPjxidXR0b24gaWQ9ImxhcERiZyIgY2xhc3M9InN1YiI+6Kqt44G/5Y+W44KK44Gu6Ki65patPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJsYXBTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2PgogPHRleHRhcmVhIGlkPSJsYXBPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxMjBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KPC9kaXY+Cgo8L21haW4+CjxkaXYgaWQ9ImJ1c3kiPjxkaXY+PGRpdiBpZD0iYnVzeVRleHQiPuWHpueQhuS4reKApjwvZGl2PjwvZGl2PjwvZGl2Pgo8c2NyaXB0Pgpjb25zdCBVRT0oKCk9PnsKIC8qIOWun+ODh+ODvOOCv+aknOiovOOBp+mAhuWKueaenOOBoOOBo+OBn+aIkOWIhu+8iOmojuaJi+ODu+mWk+malO+8ieOBr+aXouWumuOBp09GRiAqLwogY29uc3QgREVGQVVMVD17am9ja2V5OmZhbHNlLGxheW9mZjpmYWxzZX07CiBjb25zdCBjbGFtcD0oeCxhLGIpPT5NYXRoLm1heChhLE1hdGgubWluKGIseCkpOwogY29uc3Qgc2lnbW9pZD14PT4xLygxK01hdGguZXhwKC14KSk7CiBjb25zdCBsb2dpdD1wPT57cD1jbGFtcChwLC4wMDEsLjk5OSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKIGNvbnN0IG5uPXM9PlN0cmluZyhzPz8iIikubm9ybWFsaXplKCJORktDIikudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXHNcdTMwMDBdKy9nLCIiKS5yZXBsYWNlKC9b44O7772lLu+8jlwt4oCQ4oCR4oCS4oCT4oCU4oCVJ+KAmWBdL2csIiIpLnJlcGxhY2UoL1vimIbimIXilrPilrLil4fil4ZdL2csIiIpOwogLyog6aiO5omL5ZCN77ya5YWI6aCt44Gu5qyn5a2X44Kk44OL44K344Oj44Or44KS6Zmk44GN44CB44OH44Og44O844Ot4oaS44OH44OgIOOBq+aPg+OBiOOCi++8iEpSQeOBriBDLuODh+ODoOODvOODrSDjgajpgY7ljrvjg4fjg7zjgr/jga4g77yj77yO44OH44OgIOOCkuS4gOiHtOOBleOBm+OCi++8iSAqLwogY29uc3Qgam5uPXM9PntsZXQgdj1ubihTdHJpbmcocz8/IiIpLnJlcGxhY2UoL1xkezJ9KD86XC5cZCk/XHMqKD86a2d8772L772HKS9naSwiICIpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw4fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKOagl+adsXznvo7mtaYpL2csIiAiKSk7dj12LnJlcGxhY2UoL15bYS16XSg/PVvjgqEt44O244O8XSkvLCIiKTt2PXYucmVwbGFjZSgvXuODh+ODoOODvOODrS8sIuODh+ODoCIpO3JldHVybiB2fTsKIC8qIOOCr+ODqeOCueOBruautemaju+8mjA95LiN5piOIC8gLTE95Zyw5pa5IC8gMT3mlrDppqzjg7vmnKrli53liKkgLyAyPTHli50gLyAzPTLli50gLyA0PTPli50gLyA1PeOCquODvOODl+ODs+ODu+mHjeizniAqLwogY29uc3QgbGV2ZWxPZkxhYmVsPXQ9Pntjb25zdCBzPVN0cmluZyh0fHwiIik7aWYoL+WcsOaWuXxOQVIvLnRlc3QocykpcmV0dXJuIC0xO2lmKC/mlrDppqx85pyq5Yud5YipLy50ZXN0KHMpKXJldHVybiAxO2lmKC8x5YudfDUwMOS4hy8udGVzdChzKSlyZXR1cm4gMjtpZigvMuWLnXwxMDAw5LiHLy50ZXN0KHMpKXJldHVybiAzO2lmKC8z5YudfDE2MDDkuIcvLnRlc3QocykpcmV0dXJuIDQ7aWYoL+OCquODvOODl+ODs3zvvK/vvLB8T1B844Oq44K544OG44OD44OJfOmHjeiznnzvvKd8R1sxMjNJXS9pLnRlc3QocykpcmV0dXJuIDU7cmV0dXJuIDB9OwogY29uc3QgbGV2ZWxPZlByaXplPXA9PntwPU51bWJlcihwKTtyZXR1cm4gIShwPjApPzA6cDw9NzAwPzE6cDw9OTAwPzI6cDw9MTMwMD8zOnA8PTE4MDA/NDo1fTsKIC8qIOKYheOCsOODrOODvOODie+8iOagvO+8ie+8mjA95LiN5piOL+S4i+e0miAxPU9Q44O744Oq44K544OG44OD44OJIDI9RzMgMz1HMiA0PUcx44CCCiAgICDlvpPmnaXjga8gRzEvRzIvRzMvT1Ag44KS44GZ44G544Gm44CMNeOAjeOBq+a9sOOBl+OBpuOBhOOBn+OBn+OCgeOAgUcz5Yud44Gh44GMIEcxIOOBp+OCguWJsuW8leOBleOCjOOBquOBi+OBo+OBn+OAggogICAg5Yik5a6a6aCG77ya44Op44OZ44Or77yITkZLQ+W+jCBHSS9HSUkvR0lJSS9HMeOAnEcz77yJ4oaSIDHnnYDos57ph5HvvIjkuIflhobvvInihpLvvIjlr77osaHjg6zjg7zjgrnjga7jgb/vvIlHMeODrOODvOOCueWQjSAqLwogY29uc3QgRzFfTkFNRVM9L+Wkqeeah+iznnzmnInppqzoqJjlv7V844K444Oj44OR44Oz44Kr44OD44OXfOOCuOODo+ODkeODs++8o3zlrp3loZroqJjlv7V85a6J55Sw6KiY5b+1fOODtOOCo+OCr+ODiOODquOCouODnuOCpOODq3zlpKfpmKrmna986auY5p2+5a6u6KiY5b+1fOODleOCp+ODluODqeODquODvHzjg4Hjg6Pjg7Pjg5Tjgqrjg7Pjgrp844K544OX44Oq44Oz44K/44O844K6fOODnuOCpOODq+ODgeODo+ODs+ODlOOCquODs+OCt+ODg+ODl3zjgqjjg6rjgrbjg5njgrnlpbPnjovmna9856eL6I+v6LOefOiPiuiKseiznnzmoZzoirHos55844Kq44O844Kv44K5fOWEqumnv+eJnemmrHzml6XmnKzjg4Djg7zjg5Pjg7x85p2x5Lqs5YSq6ae/fOeakOaciOiznnxOSEvjg57jgqTjg6t86Ziq56We44K444Ol44OZ44OK44Kk44OrfOacneaXpeadr3zjg5vjg7zjg5fjg5Xjg6svOwogY29uc3QgZ3JhZGVUaWVyPSh0ZXh0LHByaXplLGJ5TmFtZSk9Pntjb25zdCBzPVN0cmluZyh0ZXh0fHwiIikubm9ybWFsaXplKCJORktDIik7CiAgaWYoL+manOWus3zjgrjjg6Pjg7Pjg5d8SlwuP1xzP0cvaS50ZXN0KHMpKXJldHVybiAwOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUlJfDMpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiAyOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUl8MikoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDM7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJfDEpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiA0OwogIGNvbnN0IHA9TnVtYmVyKHByaXplKTtpZihwPjApcmV0dXJuIHA+PTEwMDAwPzQ6cD49NTAwMD8zOnA+PTM1MDA/MjpwPj0xODAwPzE6MDsKICBpZihieU5hbWUmJkcxX05BTUVTLnRlc3QocykpcmV0dXJuIDQ7CiAgaWYoL+ODquOCueODhuODg+ODiXzjgqrjg7zjg5fjg7N877yv77ywfFxiT1BcYi8udGVzdChzKSlyZXR1cm4gMTsKICByZXR1cm4gMH07CiBjb25zdCBpc0pyYVZlbnVlPWM9Pi9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyhjfHwiIikpOwogY29uc3Qgc3VyZkNvZGU9cz0+e3M9U3RyaW5nKHN8fCIiKTtyZXR1cm4gL+iKnXx0dXJmL2kudGVzdChzKT8xOi/jg4B8ZGlydC9pLnRlc3Qocyk/Mjov6ZqcfGp1bXAvaS50ZXN0KHMpPzM6MH07CiBjb25zdCBkbnVtPWQ9Pk51bWJlcihTdHJpbmcoZHx8IiIpLnJlcGxhY2UoL1xEL2csIiIpLnNsaWNlKDAsOCkpfHwwOwogZnVuY3Rpb24gcGFyc2VEYXRlKHMpewogIHM9U3RyaW5nKHN8fCIiKTtsZXQgbT1zLm1hdGNoKC8oXGR7NH0pXER7MCw0fShcZHsxLDJ9KVxEezAsNH0oXGR7MSwyfSkvKTsKICBpZighbSlyZXR1cm4iIjtyZXR1cm4gYCR7bVsxXX0tJHttWzJdLnBhZFN0YXJ0KDIsIjAiKX0tJHttWzNdLnBhZFN0YXJ0KDIsIjAiKX1gOwogfQogZnVuY3Rpb24gY3N2Um93cyh0ZXh0KXsKICBjb25zdCBsaW5lcz1TdHJpbmcodGV4dHx8IiIpLnJlcGxhY2UoL15cdUZFRkYvLCIiKS5zcGxpdCgvXHI/XG4vKS5maWx0ZXIoeD0+eC50cmltKCkpOwogIGlmKCFsaW5lcy5sZW5ndGgpcmV0dXJuW107CiAgY29uc3Qgc3BsaXQ9bD0+e2NvbnN0IGE9W107bGV0IGM9IiIscT1mYWxzZTtmb3IobGV0IGk9MDtpPGwubGVuZ3RoO2krKyl7Y29uc3QgY2g9bFtpXTsKICAgaWYoY2g9PT0nIicpe2lmKHEmJmxbaSsxXT09PSciJyl7Yys9JyInO2krK31lbHNlIHE9IXF9ZWxzZSBpZihjaD09PSIsIiYmIXEpe2EucHVzaChjKTtjPSIifWVsc2UgYys9Y2h9YS5wdXNoKGMpO3JldHVybiBhfTsKICBjb25zdCBoZWFkPXNwbGl0KGxpbmVzWzBdKS5tYXAoeD0+eC50cmltKCkpO2NvbnN0IG91dD1bXTsKICBmb3IobGV0IGk9MTtpPGxpbmVzLmxlbmd0aDtpKyspe2NvbnN0IGE9c3BsaXQobGluZXNbaV0pLG89e307Zm9yKGxldCBqPTA7ajxoZWFkLmxlbmd0aDtqKyspb1toZWFkW2pdXT1hW2pdPz8iIjtvdXQucHVzaChvKX0KICByZXR1cm4gb3V0OwogfQogY29uc3QgZj12PT57Y29uc3Qgbj1wYXJzZUZsb2F0KFN0cmluZyh2Pz8iIikucmVwbGFjZSgvLC9nLCIiKSk7cmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKT9uOm51bGx9OwogLyog44OQ44OD44Kv44Ki44OD44OXL0NTVuOBrjHooYzihpLou73ph4/ooYwgKi8KIGNvbnN0IGNsZWFuVHI9dD0+U3RyaW5nKHR8fCIiKS5yZXBsYWNlKC9ccysvZywiICIpLnRyaW0oKS5yZXBsYWNlKC9b77yIKF1bXu+8iSldezAsNn1b77yJKV0vZywiICIpLnJlcGxhY2UoLyg/Ouagl+adsXznvo7mtaZ85Zyw5pa5fOWkluWbvXzmi5vlvoUpXHMqW+ODu++9pV0/L2csIiAiKS5yZXBsYWNlKC9b44O7772lXS9nLCIgIikucmVwbGFjZSgvXHMrL2csIiAiKS50cmltKCk7CiBmdW5jdGlvbiB0b1JvdyhvKXtjb25zdCBfcj10b1JvdzAobyk7X3IudHJhaW5lcj1jbGVhblRyKG9bIuiqv+aVmeW4qyJdfHxvLnRyYWluZXJ8fCIiKTtfci5ncmQ9Z3JhZGVUaWVyKFN0cmluZyhvWyJjbGFzcyJdfHxvLmNsc3x8IiIpKyIgIitTdHJpbmcob1si44Os44O844K55ZCNIl18fG8ucmFjZV9uYW1lfHxvLnJhY2VuYW1lfHwiIiksbnVsbCxmYWxzZSk7cmV0dXJuIF9yfQogZnVuY3Rpb24gdG9Sb3cwKG8pewogIGNvbnN0IHNhPVN0cmluZyhvWyLmgKfpvaIiXXx8IiIpO2NvbnN0IGFtPXNhLm1hdGNoKC8oXGQrKS8pOwogIHJldHVybntyYWNlSWQ6U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/P29bIlVubmFtZWQ6IDAiXT8/IiIpLGRhdGU6cGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pLAogICBuYW1lOlN0cmluZyhvWyLppqzlkI0iXXx8by5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpubihvWyLppqzlkI0iXXx8by5ob3JzZSksam9ja2V5OmpubihvWyLpqI7miYsiXXx8by5qb2NrZXkpLGpuYW1lOlN0cmluZyhvWyLpqI7miYsiXXx8by5qb2NrZXl8fCIiKS50cmltKCksZmluaXNoOmYob1si552A6aCGIl0/P28uZmluaXNoKSwKICAgZGlzdDpmKG8uY291cnNlX2xlbj8/b1si6Led6ZuiIl0/P28uZGlzdGFuY2UpfHwwLHN1cmY6c3VyZkNvZGUoby5yYWNlX3R5cGV8fG9bIuiKneODgCJdfHxvLnN1cmZhY2UpLAogICBhZ2U6YW0/TnVtYmVyKGFtWzFdKTpudWxsLG51bTpmKG9bIummrOeVqiJdKSxwb3A6ZihvWyLkurrmsJciXSksb2RkczpmKG9bIuWNmOWLnSJdKSwKICAgbHZsOigoKT0+e2NvbnN0IGlkPVN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz8iIik7aWYoL15cZHsxMn0kLy50ZXN0KGlkKSYmIWlzSnJhVmVudWUoaWQuc2xpY2UoNCw2KSkpcmV0dXJuIC0xO3JldHVybiBsZXZlbE9mTGFiZWwob1siY2xhc3MiXXx8by5jbHMpfSkoKX07CiB9CiAvKiDmiJDnuL7jgrnjg4jjgqLvvIjml6Xku5jmmIfpoIbjgasgYWRkIOOBmeOCi++8iSAqLwogZnVuY3Rpb24gU3RvcmUoKXt0aGlzLmg9bmV3IE1hcCgpO3RoaXMuaj1uZXcgTWFwKCl9CiBTdG9yZS5wcm90b3R5cGUuYWRkPWZ1bmN0aW9uKHIpewogIGlmKHIuZmluaXNoPT1udWxsfHwhci5ob3JzZSlyZXR1cm47CiAgY29uc3QgdDM9ci5maW5pc2g+PTEmJnIuZmluaXNoPD0zPzE6MDsKICBsZXQgaD10aGlzLmguZ2V0KHIuaG9yc2UpO2lmKCFoKXRoaXMuaC5zZXQoci5ob3JzZSxoPXtuOjAsdG9wMzowLHdpbjowLHN1bTowLGxhc3Q6IiIscnVuczpbXSxsdjp7fX0pOwogIGgubisrO2gudG9wMys9dDM7aWYoci5maW5pc2g9PT0xKWgud2luKys7aC5zdW0rPXIuZmluaXNoO2lmKHIuZGF0ZT5oLmxhc3QpaC5sYXN0PXIuZGF0ZTsKICBjb25zdCBMPXIubHZsfHwwOyhoLmx2W0xdPWgubHZbTF18fFswLDBdKTtoLmx2W0xdWzBdKys7aC5sdltMXVsxXSs9dDM7CiAgaC5ydW5zLnB1c2goW2RudW0oci5kYXRlKSxyLmZpbmlzaCxyLmRpc3Qsci5zdXJmLEwsci5ncmR8fDAsci5jZj09bnVsbD8tMTpyLmNmXSk7aWYoaC5ydW5zLmxlbmd0aD42KXtoLnJ1bnMuc29ydCgoYSxiKT0+YVswXS1iWzBdKTtoLnJ1bnMuc2hpZnQoKX0KICBpZihyLmpvY2tleSl7bGV0IGo9dGhpcy5qLmdldChyLmpvY2tleSk7aWYoIWopdGhpcy5qLnNldChyLmpvY2tleSxqPXtuOjAsdG9wMzowfSk7ai5uKys7ai50b3AzKz10M30KIH07CiAvKiDpqI7miYvvvJrlrozlhajkuIDoh7TihpLvvIjnn63jgYTooajoqJjjgarjgonvvInliY3mlrnkuIDoh7Tjgacx5Lq644Gr57We44KM44KL44Go44GN44Gg44GR5o6h55SoICovCiBTdG9yZS5wcm90b3R5cGUuam9ja2V5PWZ1bmN0aW9uKG5hbWUpewogIGlmKCFuYW1lKXJldHVybiBudWxsOwogIGNvbnN0IGo9dGhpcy5qLmdldChuYW1lKTtpZihqKXJldHVybiBqOwogIGlmKG5hbWUubGVuZ3RoPDJ8fG5hbWUubGVuZ3RoPjQpcmV0dXJuIG51bGw7CiAgaWYoIXRoaXMuX2prfHx0aGlzLl9qa1NpemUhPT10aGlzLmouc2l6ZSl7dGhpcy5fams9Wy4uLnRoaXMuai5rZXlzKCldO3RoaXMuX2prU2l6ZT10aGlzLmouc2l6ZX0KICBjb25zdCBjPXRoaXMuX2prLmZpbHRlcihrPT5rLnN0YXJ0c1dpdGgobmFtZSl8fChuYW1lLmxlbmd0aD49MyYmay5zdGFydHNXaXRoKG5hbWUuc2xpY2UoMCwtMSkpJiZuYW1lLmxlbmd0aDw9ay5sZW5ndGgpKTsKICByZXR1cm4gYy5sZW5ndGg9PT0xP3RoaXMuai5nZXQoY1swXSk6bnVsbDsKIH07CiBjb25zdCBsYXlvZmY9KGxhc3QsdGFyZ2V0KT0+e2lmKCFsYXN0KXJldHVybiAuNTtjb25zdCBhPShuZXcgRGF0ZSh0YXJnZXQpLW5ldyBEYXRlKGxhc3QpKS84NjRlNTsKICByZXR1cm4gYTwyMT8uNzI6YTw2MD8uNjI6YTwxMjA/LjU1OmE8MjQwPy40ODouNDJ9OwogLyogPT09PT0g5a6f57i+44GL44KJ5a2m57+S44GX44Gf44Oi44OH44Or77yI54m55b606YeP4oaSM+edgOWGheeOh++8iSA9PT09PSAqLwogY29uc3QgRk49WyJiaWFzIiwib2Zmc2V0IiwibmxvZyIsIm5vSGlzdCIsImZTIiwiZkMiLCJhdmdGIiwicjNzaGFyZSIsInIzYXZnIiwibGFzdDEiLCJsYXN0QmlnIiwiY29uZERpZmYiLCJmaXJzdFN1cmYiLCJnYXBTaG9ydCIsImdhcExvbmciLCJnYXBWTG9uZyIsImFnZTMiLCJhZ2U0IiwiYWdlNyIsInN0ZXBVcCIsInN0ZXBEb3duIiwid2luUmF0ZSJdOwogY29uc3QgRko9WyJqUmVsIiwiamxvZyIsImpNaXNzIl07CiAvKiDkv4LmlbDjga8gdG9vbHMvZml0X21vZGVsLmpzIOOBp+Wtpue/ku+8iDIwMjDlubTjgJzjga7mmYLns7vliJfjg4fjg7zjgr/vvInjgIJ7fSDjgpLnva7mj5sgKi8KIGNvbnN0IE1PREVMPXsiY29yZSI6WzAuMDUyOTksMC45OTY5NywwLjA0OTUxLC0wLjI0NTQzLC0wLjUyODEyLDAuOTE5NDYsLTAuNTE0NzYsLTAuMzQ3ODYsLTAuNTc5MDQsLTAuNTUxMTgsMC4xNjc3MywxLjExODIsLTAuMzUzMDUsLTAuMTExMjgsLTAuMjI3MjgsLTAuNDAxMjksMC4xMzc3MSwwLjIxNjYyLC0wLjM5NjczLC0wLjM1MzA1LDAuMDA2MTcsLTAuNTk1NjRdLCJmdWxsIjpbMC40MDQzMywxLjM3MDA3LDAuMDYyNTEsLTAuMTIyNzksLTAuNTAyMzIsMC44Mjk3OCwtMC4zOTg5NSwtMC4zMDA3MiwtMC41MTU1OSwtMC41MjUzMiwwLjE1ODMyLDEuMDY2OTUsLTAuMzgzNzcsLTAuMDcyODIsLTAuMjI1NjgsLTAuMzUxLDAuMTUwMjUsMC4yMTI1MywtMC40MTMzNCwtMC4zMjMxOSwwLjAwNzI2LC0wLjkzNzkyLDAuNTM1NTcsMC4wMDM2NSwtMC4yMDYwNV19OwogZnVuY3Rpb24gZmVhdHMocixzdG9yZSxyYWNlLE4sd2l0aEopewogIGNvbnN0IGI9Y2xhbXAoMy9OLC4wOCwuNSksbGI9bG9naXQoYiksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxuPWg/aC5uOjAsTHQ9cmFjZS5sdmx8fDA7CiAgY29uc3QgcFM9KChoP2gudG9wMzowKSszKmIpLyhuKzMpLGZTPWxvZ2l0KHBTKS1sYjsKICAvLyDjgq/jg6njgrnoo5zmraPvvJrkvY7jgYTjgq/jg6njgrnvvIjlnLDmlrnjgpLlkKvjgoDvvInjgafjga7lpb3otbDjga/libLjgorlvJXjgY3jgIHpq5jjgYTjgq/jg6njgrnjgafjga7lh6HotbDjga/libLjgorlvJXjgY8KICBsZXQgZkM9ZlM7CiAgaWYoaCYmTHQ+MCl7bGV0IEg9MCxNPTA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKGgubHYpKXtjb25zdCBMPU51bWJlcihrKSxbY24sY3RdPWgubHZba107Y29uc3QgZz1MPT09MD8wOihMPDA/LTI6TC1MdCk7CiAgICBIKz1jdCpjbGFtcCgxKy4zKmcsLjQsMS44KTtNKz0oY24tY3QpKmNsYW1wKDEtLjMqZywuNCwxLjgpfQogICBmQz1sb2dpdCgoSCszKmIpLyhIK00rMykpLWxifQogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10scmM9cnVucy5zbGljZSgtMyksbGFzdFI9cnVucy5sZW5ndGg/cnVuc1tydW5zLmxlbmd0aC0xXTpudWxsOwogIGNvbnN0IHIzc2hhcmU9cmMubGVuZ3RoP3JjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgvcmMubGVuZ3RoOjA7CiAgY29uc3QgcjNhdmc9cmMubGVuZ3RoP2NsYW1wKChyYy5yZWR1Y2UoKGEseCk9PmEreFsxXSwwKS9yYy5sZW5ndGgtNikvNiwtMSwyKTowOwogIGNvbnN0IGxhc3QxPWxhc3RSP2NsYW1wKChsYXN0UlsxXS02KS82LC0xLDIpOjAsbGFzdEJpZz1sYXN0UiYmbGFzdFJbMV0+PTEwPzE6MDsKICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7bGV0IGNvbmREaWZmPTAsZmlyc3RTdXJmPTA7CiAgaWYoc2MmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiYoIWRpc3R8fE1hdGguYWJzKHhbMl0tZGlzdCk8PTIwMCkpOwogICBpZihjci5sZW5ndGgpY29uZERpZmY9KGNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgrMipwUykvKGNyLmxlbmd0aCsyKS1wUzsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpZmlyc3RTdXJmPTF9CiAgbGV0IGdhcD1udWxsO2lmKGgmJmgubGFzdCYmcmFjZS5kYXRlKWdhcD1NYXRoLnJvdW5kKChuZXcgRGF0ZShyYWNlLmRhdGUpLW5ldyBEYXRlKGgubGFzdCkpLzg2NGU1KTsKICBjb25zdCBhPXIuYWdlfHwwOwogIGNvbnN0IHN0ZXBEPWxhc3RSJiZsYXN0Uls0XT4wJiZMdD4wP2NsYW1wKEx0LWxhc3RSWzRdLC0zLDMpOjA7CiAgY29uc3QgeD1bMSxsYixNYXRoLmxvZygxK24pLG49PT0wPzE6MCxmUyxmQyxuP2NsYW1wKChoLnN1bS9uLTYpLzYsLTEsMik6MCxyM3NoYXJlLHIzYXZnLGxhc3QxLGxhc3RCaWcsY29uZERpZmYsZmlyc3RTdXJmLAogICBnYXAhPW51bGwmJmdhcDwyMT8xOjAsZ2FwIT1udWxsJiZnYXA+MTIwPzE6MCxnYXAhPW51bGwmJmdhcD4yNDA/MTowLGE9PT0zPzE6MCxhPT09ND8xOjAsYT49Nz8xOjAsc3RlcEQ+MD9zdGVwRDowLHN0ZXBEPDA/LXN0ZXBEOjAsCiAgIG4/KChoLndpbisuMypiKS8obisxLjUpLWIpOjBdOwogIGlmKHdpdGhKKXtjb25zdCBqPXN0b3JlLmpvY2tleShyLmpvY2tleSk7CiAgIGlmKGomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KTt4LnB1c2gobG9naXQocEopLWxiLE1hdGgubG9nKDErai5uKSwwKX1lbHNlIHgucHVzaCgwLDAsMSl9CiAgcmV0dXJuIHg7CiB9CiBjb25zdCBkb3Q9KHcseCk9PntsZXQgej0wO2ZvcihsZXQgaT0wO2k8eC5sZW5ndGg7aSsrKXorPSh3W2ldfHwwKSp4W2ldO3JldHVybiB6fTsKIGNvbnN0IG1vZGVsWj0oa2luZCx4KT0+ZG90KE1PREVMW2tpbmRdLHgpOwogLyogMemgreOBrue0oOeCuShsb2dpdCnjgajjgr/jgrDjgIJjb21wIOOBp+aIkOWIhuOCkk9OL09GRuOBp+OBjeOCi++8iOaknOiovOeUqO+8iSAqLwogZnVuY3Rpb24gaG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wPXt9KXsKICBjb21wPU9iamVjdC5hc3NpZ24oe30sREVGQVVMVCxjb21wKTtjb25zdCB1c2U9az0+Y29tcFtrXSE9PWZhbHNlJiZjb21wW2tdIT09MDsKICBjb25zdCBiPWNsYW1wKDMvTiwuMSwuNSksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxqPXN0b3JlLmouZ2V0KHIuam9ja2V5KTsKICBjb25zdCBydW5zPWg/aC5ydW5zOltdLG49aD9oLm46MCx0YWdzPVtdO2xldCB6PTAsY29uZj0i5L2OIjsKICBjb25zdCBwSD0oKGg/aC50b3AzOjApKzQqYikvKG4rNCk7eis9bG9naXQocEgpOwogIGlmKG4+PTIpY29uZj1uPj01PyLpq5giOiLkuK0iO2Vsc2UgdGFncy5wdXNoKHt0OiLlsaXmrbTkuI3otrMiLGM6ImcifSk7CiAgaWYobj49Myl7Y29uc3QgdDM9aC50b3AzL24sdz1oLndpbi9uOwogICBpZih0Mz49LjQwJiZ3PD0uMjApdGFncy5wdXNoKHt0OmDlloTmiKblnosgM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgZWxzZSBpZih0Mz49LjQ1KXRhZ3MucHVzaCh7dDpg5a6J5a6aIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGlmKHVzZSgiYXZnIikmJmguc3VtL248PTUpeis9LjEyfQogIGNvbnN0IHJjPXJ1bnMuc2xpY2UoLTMpOwogIGlmKHVzZSgicmVjZW50IikmJnJjLmxlbmd0aD49Mil7Y29uc3QgYzM9cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxhdmc9cmMucmVkdWNlKChzLHgpPT5zK3hbMV0sMCkvcmMubGVuZ3RoOwogICB6Kz0uMjIqKGMzL3JjLmxlbmd0aC1wSCkqMztpZihjMz49Mil0YWdzLnB1c2goe3Q6YOi/kSR7cmMubGVuZ3Rofei1sOOBpyR7YzN95ZueM+edgOWGhWAsYzoiYiJ9KTsKICAgY29uc3QgbGFzdD1ydW5zW3J1bnMubGVuZ3RoLTFdOwogICBpZihsYXN0JiZsYXN0WzFdPj04JiZuPj00JiZoLnRvcDMvbj49LjM1KXt6Kz0uMTU7dGFncy5wdXNoKHt0OmDliY3otbAke2xhc3RbMV19552A44GL44KJ5be744GN6L+U44GX5L2Z5ZywYCxjOiJvIn0pfQogICBpZihhdmc8PTQmJnJjLmxlbmd0aD49Myl6Kz0uMDh9CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwOwogIGlmKHVzZSgiY29uZCIpJiZzYyYmZGlzdCYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJk1hdGguYWJzKHhbMl0tZGlzdCk8PTIwMCk7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKXt6LT0uMzU7dGFncy5wdXNoKHt0OmAke3NjPT09MT8i5Yid44Gu6IqdIjoi5Yid44Gu44OA44O844OIIn3vvIjpgY7ljrvotbDjga/liKXppqzloLTvvIlgLGM6Im8ifSl9CiAgIGlmKGNyLmxlbmd0aD49Mil7Y29uc3QgdDM9Y3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxwYz0odDMrMipwSCkvKGNyLmxlbmd0aCsyKTsKICAgIHorPWNsYW1wKDIqKHBjLXBIKSwtLjUsLjUpO2lmKHQzPj0yKXRhZ3MucHVzaCh7dDpg5ZCM5p2h5Lu244GnJHt0M30vJHtjci5sZW5ndGh95ZueM+edgOWGhWAsYzoiYiJ9KX19CiAgaWYodXNlKCJqb2NrZXkiKSYmaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpLGRqPWNsYW1wKC42Kihsb2dpdChwSiktbG9naXQoYikpLC0uNCwuNSk7CiAgIHorPWRqO2lmKGRqPj0uMjUpdGFncy5wdXNoKHt0OmDpqI7miYvlpb3oqr8gM+edgOWGhSR7TWF0aC5yb3VuZChqLnRvcDMvai5uKjEwMCl9JWAsYzoiYiJ9KX0KICBpZih1c2UoImxheW9mZiIpJiZoJiZoLmxhc3Qpe2NvbnN0IGdhcD1NYXRoLnJvdW5kKChuZXcgRGF0ZShyYWNlLmRhdGUpLW5ldyBEYXRlKGgubGFzdCkpLzg2NGU1KTsKICAgeis9LjYqKGxheW9mZihoLmxhc3QscmFjZS5kYXRlKS0uNSk7aWYoZ2FwPj0xODApdGFncy5wdXNoKHt0OmAke2dhcH3ml6XjgbbjgopgLGM6Im8ifSl9CiAgaWYodXNlKCJhZ2UiKSl7Y29uc3QgYT1yLmFnZXx8NTtpZihhPT09Myl6Kz0uMTA7ZWxzZSBpZihhPT09NCl6Kz0uMDU7ZWxzZSBpZihhPj04KXt6LT0uMTU7dGFncy5wdXNoKHt0OmAke2F95q2zYCxjOiJvIn0pfX0KICByZXR1cm57eix0YWdzLGNvbmYsbn07CiB9CiAvKiAyMDIz5bm05Lul6ZmN44Gu5pmC57O75YiX5qSc6Ki844Gn44GuIOe0oOOBruWlvei1sOeOh+KGkueptOOCvuODvOODs+Wun+e4vu+8iOW5s+Wdh3AsIOWun+e4vu+8iSAqLwogY29uc3QgQ0FMPVtbMCwwLjAxXSxbMC4wMjIsMC4wMTddLFswLjA0NiwwLjAyMl0sWzAuMDc1LDAuMDQ2XSxbMC4xMDUsMC4wNjhdLFswLjEzNSwwLjA4Ml0sWzAuMTY1LDAuMDk4XSxbMC4xOTMsMC4xMDNdLFswLjIyNCwwLjEzOF0sWzAuMjU5LDAuMTYxXSxbMC4zMDIsMC4xODddLFswLjM1OCwwLjIxMV0sWzAuNDU0LDAuMjI5XV07CiAvKiDjgqrjg4PjgrrjgarjgZfjg6Ljg7zjg4nvvIjkurrmsJfjga7ku6PnkIbvvJ3pqI7miYvovrzjgb/jga7lrabnv5Ljg6Ljg4fjg6vjga7poIbkvY3jgafnqbTjgr7jg7zjg7PjgpLliKTlrprvvInjga7oo5zmraPooajjgIIyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT44Gn5L2c5oiQICovCiBjb25zdCBDQUxfUFJPWFk9W1swLDAuMDEzXSxbMC4wMjIsMC4wMjFdLFswLjA0NiwwLjAyOF0sWzAuMDc1LDAuMDU2XSxbMC4xMDUsMC4wODZdLFswLjEzNSwwLjExMV0sWzAuMTY1LDAuMTM0XSxbMC4xOTMsMC4xNDZdLFswLjIyNCwwLjIwMV0sWzAuMjU5LDAuMjE5XSxbMC4zMDEsMC4yNjFdLFswLjM1NSwwLjI5Nl0sWzAuNDM5LDAuMzY3XV07CiBmdW5jdGlvbiBpbnRlcnAoVCxwKXtmb3IobGV0IGk9MTtpPFQubGVuZ3RoO2krKylpZihwPD1UW2ldWzBdKXtjb25zdFthLGJdPVRbaS0xXSxbYyxkXT1UW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBUW1QubGVuZ3RoLTFdWzFdfQogZnVuY3Rpb24gY2FsaWJGb3IocCxtb2RlKXtyZXR1cm4gbW9kZT09PSJvZGRzIj9pbnRlcnAoQ0FMLHApOmludGVycChDQUxfUFJPWFkscCl9CiBmdW5jdGlvbiBjYWxpYihwKXtmb3IobGV0IGk9MTtpPENBTC5sZW5ndGg7aSsrKWlmKHA8PUNBTFtpXVswXSl7Y29uc3RbYSxiXT1DQUxbaS0xXSxbYyxkXT1DQUxbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIENBTFtDQUwubGVuZ3RoLTFdWzFdfQogZnVuY3Rpb24gbm9ybWFsaXplVG9wMyh6cyx0b3RhbCl7bGV0IGxvPS04LGhpPTg7CiAgZm9yKGxldCBpPTA7aTw2MDtpKyspe2NvbnN0IGM9KGxvK2hpKS8yLHM9enMucmVkdWNlKChhLHopPT5hK3NpZ21vaWQoeitjKSwwKTtpZihzPnRvdGFsKWhpPWM7ZWxzZSBsbz1jfQogIGNvbnN0IGM9KGxvK2hpKS8yO3JldHVybiB6cy5tYXAoej0+c2lnbW9pZCh6K2MpKX0KIC8qIEhhcnZpbGxl5rOV44Gn5Yud546H4oaSM+edgOWGheeOhyAqLwogZnVuY3Rpb24gdG9wM0Zyb21XaW4ocHcpe2NvbnN0IFQ9cHcucmVkdWNlKChhLGIpPT5hK2IsMCkscD1wdy5tYXAoeD0+eC9UKSxuPXAubGVuZ3RoLG91dD1uZXcgQXJyYXkobikuZmlsbCgwKTsKICBmb3IobGV0IGk9MDtpPG47aSsrKXtsZXQgcz1wW2ldOwogICBmb3IobGV0IGo9MDtqPG47aisrKWlmKGohPT1pKXtzKz1wW2pdKnBbaV0vKDEtcFtqXSk7CiAgICBmb3IobGV0IGs9MDtrPG47aysrKWlmKGshPT1pJiZrIT09ailzKz1wW2pdKnBba10vKDEtcFtqXSkqcFtpXS8oMS1wW2pdLXBba10pfQogICBvdXRbaV09c31yZXR1cm4gb3V0fQogLyog4piF5qC85LiK44GS6KOc5q2j77ya5a2m57+S5riI44G/44Oi44OH44Or44Gv552A6aCG44KS44Gd44Gu44G+44G+6KaL44KL44Gu44Gn44CB5LiL5L2N44Kw44Os44O844OJ44Gn44Gu5aW96LWw44GM6YeN6LOe44O7RzHjgafjgoLlkIzkvqHlgKTjgavjgarjgaPjgabjgYTjgZ/jgIIKICAgIOebtOi/kTPotbDjga7jgYbjgaEgT1Av6YeN6LOeKOOCr+ODqeOCuTUp44Gu6LWw44Gr44Gk44GE44Gm44CB5LuK5Zue44Gu44Kw44Os44O844OJ44Go44Gu5beu44Gg44GR6KOc5q2j44GZ44KL77yI44Kv44Op44K5NOS7peS4i+OBr+ODouODh+ODq+WBtOOBruijnOato+OBjOOBguOCi+OBruOBp+S6jOmHjeaOm+OBkeOBl+OBquOBhO+8ieOAggogICAgICDmoLzkuIrjgZLvvIjkvosgRzPihpJHMe+8ie+8muWlvei1sOOBruS+oeWApOOCkuWJsuOCiuW8leOBj++8iOedgOmghuOBjOiJr+OBhOOBu+OBqeWkp+OBjeOBj++8iQogICAgICDmoLzkuIvjgZLvvIjkvosgRzHihpJHMu+8ie+8muWHoei1sOOBruS+oeWApOOCkuWwkeOBl+aIu+OBmQogICAg5L+C5pWw44Gv5pqr5a6a5YCk44CC4pGgLTLjga7jgIzjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzmr5TovIPjgI3jgafjgIHoo5zmraPjgYLjgoov44Gq44GX44KS5ZCM44GY6YGO5Y6744OH44O844K/44Gn5q+U44G544Gm56K66KqN44GZ44KL44GT44Go44CCICovCiBjb25zdCBHUkFERT17b246dHJ1ZSxLVVA6LjMwLEtETjouMTIsTUlOOi0uOSxNQVg6LjV9OwogZnVuY3Rpb24gZ3JhZGVBZGoocixzdG9yZSxyYWNlLGNvbXApewogIGlmKCFHUkFERS5vbnx8KGNvbXAmJmNvbXAuZ3JhZGU9PT1mYWxzZSkpcmV0dXJuIDA7CiAgY29uc3QgR3Q9cmFjZS5ncmR8fDA7aWYoR3Q8MilyZXR1cm4gMDsKICBjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO2lmKCFofHwhaC5ydW5zLmxlbmd0aClyZXR1cm4gMDsKICBjb25zdCByYz1oLnJ1bnMuc2xpY2UoLTMpLFc9W1sxXSxbLjQsLjZdLFsuMiwuMywuNV1dW3JjLmxlbmd0aC0xXTtsZXQgZD0wOwogIHJjLmZvckVhY2goKHgsayk9Pntjb25zdCBmaW49eFsxXSxMPXhbNF18fDAsR3I9eFs1XXx8MDtpZihMIT09NXx8IShmaW4+MCkpcmV0dXJuOwogICBjb25zdCBncj1NYXRoLm1heChHciwyKTsgICAgICAgICAgLy8gT1Djg7vjgrDjg6zjg7zjg4nkuI3mmI7jga7jgq/jg6njgrk16LWw44GvIEczIOebuOW9k+OBqOOBl+OBpuavlOi8gwogICBpZihHdD5nciYmZmluPD01KWQtPVdba10qR1JBREUuS1VQKihHdC1ncikqKDYtZmluKS82OwogICBlbHNlIGlmKEd0PGdyJiZmaW4+PTQpZCs9V1trXSpHUkFERS5LRE4qKGdyLUd0KSpNYXRoLm1pbigxLChmaW4tMykvOCl9KTsKICByZXR1cm4gY2xhbXAoZCxHUkFERS5NSU4sR1JBREUuTUFYKX0KIGNvbnN0IEdOPVsi5LiN5piOL+S4i+e0miIsIk9Q44O7TCIsIkczIiwiRzIiLCJHMSJdOwogZnVuY3Rpb24gZ3JhZGVUYWdzKHRhZ3MsZHoscmFjZSl7Y29uc3QgdD10YWdzLnNsaWNlKCk7CiAgaWYoZHo8PS0uMil0LnVuc2hpZnQoe3Q6YOagvOS4iuOBkuaIpu+8iCR7R05bcmFjZS5ncmR8fDBdfe+8ie+8muS4i+S9jeOCsOODrOODvOODieOBruWlvei1sOOBr+WJsuW8lSAke2R6LnRvRml4ZWQoMil9YCxjOiJvIn0pOwogIGVsc2UgaWYoZHo+PS4xKXQudW5zaGlmdCh7dDpg6auY44Kw44Os44O844OJ44GL44KJ44Gu5qC85LiL44GSICR7ZHo+PTA/IisiOiIifSR7ZHoudG9GaXhlZCgyKX1gLGM6ImIifSk7CiAgcmV0dXJuIHR9CiAvKiDjg6zjg7zjgrnop6PmnpDjgIJvZGRzIOOBr+S7u+aEj++8iOWFqOmgreWIhu+8ieOAgiAqLwogY29uc3QgTFZOPVsi5LiN5piOIiwi5pyq5Yud5YipIiwiMeWLnSIsIjLli50iLCIz5YudIiwiT1AiXTsKIGZ1bmN0aW9uIGV4dHJhVGFncyh0YWdzLHIsc3RvcmUscmFjZSl7CiAgY29uc3QgdD10YWdzLnNsaWNlKCksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxMdD1yYWNlLmx2bHx8MDsKICBpZihoKXtjb25zdCBsYXN0PWgucnVucy5sZW5ndGg/aC5ydW5zW2gucnVucy5sZW5ndGgtMV06bnVsbDsKICAgaWYobGFzdCYmbGFzdFs0XT4wJiZMdD4wJiZsYXN0WzRdIT09THQpdC51bnNoaWZ0KGxhc3RbNF08THQ/e3Q6YOaYh+e0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6Im8ifTp7dDpg6ZmN57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoiYiJ9KTsKICAgaWYoaC5sdiYmaC5sdlstMV0pdC5wdXNoKHt0OiLlnLDmlrnjgafjga7lh7rotbDjgYLjgorvvIjlibLlvJXoqZXkvqHvvIkiLGM6ImcifSl9CiAgcmV0dXJuIHR9CiAvKiDjg6njg7Pjgq/vvJrnqbTjgr7jg7zjg7Pjga7lubPlnYfjgavlr77jgZnjgovlgI3njofjgacgUy9BL0IvQ++8iOWxpeattOOBjDHotbDku6XkuIvjga9C44G+44Gn77yJICovCiBjb25zdCBBVkdfSE9MRT17b2RkczouMDkxLHByb3h5Oi4xMTV9OwogZnVuY3Rpb24gcmF0aW5nKHBjLG1vZGUsbil7Y29uc3Qgcj1wYy9BVkdfSE9MRVttb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXTtsZXQgaz1yPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyI7aWYobjwyJiYoaz09PSJTInx8az09PSJBIikpaz0iQiI7cmV0dXJuIGt9CiAvKiDnmoTkuK3njofph43oppbvvJrlrp/nuL4z6LWw5Lul5LiK44O744Op44Oz44KvUy9B44O777yI44Kq44OD44K644GM5YiG44GL44KL44Go44GN44Gv77yJ5Y2Y5YudMzDlgI3mnKrmuoDjga7lpKfnqbTjgpLpmaTjgY/jgILpgY7ljrvjga7mpJzoqLzjgafjgIHnmoTkuK3njofjgYzkuIrjgYzjgorjgIHlm57lj47njofjgYzmnIDmgqrjga7lpKfnqbTjgpLpgb/jgZHjgonjgozjgZ8gKi8KIGNvbnN0IEZPQ1VTX01BWF9PRERTPTMwOwogY29uc3QgRk9DVVM9eyJvZGRzIjp7Im4iOjM2MjUsImhpdCI6MC4yMzIsImJhc2VIaXQiOjAuMTcyLCJwZXJEYXkiOjEzLjZ9LCJwcm94eSI6eyJuIjo0MDI1LCJoaXQiOjAuMjcyLCJiYXNlSGl0IjowLjIxNywicGVyRGF5IjoxNS4xfX07ICAgLy8gMjAyNOW5tOS7pemZjeOBruaknOiovO+8mueahOS4reeOh++8iGJhc2VIaXQ95b6T5p2l44GuMeS9jeWAmeijnO+8ieODu+mWi+WCrOaXpeOBguOBn+OCiuOBrumgreaVsAogZnVuY3Rpb24gcGlja0ZvY3VzKHJlcyxrKXtyZXR1cm4gcmVzLmZpbHRlcih4PT54LmhvbGUmJngubj49MyYmKHJhdGluZyh4LnBjLHgubW9kZSx4Lm4pPT09IlMifHxyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKT09PSJBIikmJih4Lm9kZD09bnVsbHx8eC5vZGQ8Rk9DVVNfTUFYX09ERFMpKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLGspfQogLyog56m06aas5YCZ6KOc77ya5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBoOOBkeOCkuOAgeWlvei1sOeOh+OBrumrmOOBhOmghuOBqyBrIOmgreOAguWxpeattOOBruS5j+OBl+OBhOmmrOOBr+WQjOeCueOBq+OBquOCiuOChOOBmeOBj+OAgemghuS9jeOBq+aEj+WRs+OBjOOBquOBhOOBn+OCgeWvvuixoeWkliAqLwogZnVuY3Rpb24gcGljayhyZXMsayl7cmV0dXJuIHJlcy5maWx0ZXIoeD0+eC5ob2xlJiZ4Lm4+PTMpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiBmdW5jdGlvbiBhbmFseXplKHJhY2Usc3RvcmUsb2Rkcyxjb21wLHBvcEFycil7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aDsKICBjb25zdCBzYz1SLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXApKTsKICBjb25zdCBkej1SLm1hcChyPT5ncmFkZUFkaihyLHN0b3JlLHJhY2UsY29tcCkpOwogIGNvbnN0IHpjMD1NT0RFTC5jb3JlP1IubWFwKHI9Pm1vZGVsWigiY29yZSIsZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKSk6c2MubWFwKHg9Pngueik7Y29uc3QgemM9emMwLm1hcCgoeixpKT0+eitkeltpXSk7CiAgY29uc3QgcD1ub3JtYWxpemVUb3AzKHpjLE1hdGgubWluKDMsTikpOwogIGxldCBta3Q9bnVsbCxwb3A9bnVsbCxtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpe21rdD10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTtwb3A9b2Rkcy5tYXAobz0+MStvZGRzLmZpbHRlcih4PT54PG8pLmxlbmd0aCk7bW9kZT0ib2RkcyJ9CiAgZWxzZSBpZihwb3BBcnImJnBvcEFyci5sZW5ndGg9PT1OJiZwb3BBcnIuZXZlcnkoeD0+eD4wKSl7cG9wPXBvcEFyci5zbGljZSgpO21vZGU9Im9kZHMifSAvLyDlrp/pmpvjga7kurrmsJfpoIbkvY3jgaDjgZHliIbjgYvjgovjgajjgY3vvIjntZDmnpzjg5rjg7zjgrjnlLHmnaXvvIkKICBlbHNleyAvLyDjgqrjg4PjgrrjgoLkurrmsJfjgoLjgarjgYTjgajjgY3vvJrpqI7miYvmiJDnuL7jgb7jgaflkKvjgoHjgZ/jgrnjgrPjgqLjga7poIbkvY3jgpLjgIzkurrmsJfjga7ku6PnkIbjgI3jgavjgZnjgovvvIjlrp/pmpvjga7kurrmsJfjgajjga7nm7jplqIgMC41NeKGkjAuNjfvvIkKICAgY29uc3QgcHg9TU9ERUwuZnVsbD9SLm1hcChyPT5tb2RlbFooImZ1bGwiLGZlYXRzKHIsc3RvcmUscmFjZSxOLHRydWUpKSk6Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTix7am9ja2V5OnRydWUsbGF5b2ZmOmZhbHNlfSkueik7Y29uc3QgcHgyPXB4Lm1hcCgodixpKT0+ditkeltpXSk7cG9wPXB4Mi5tYXAodj0+MStweDIuZmlsdGVyKHk9Pnk+dikubGVuZ3RoKX0KICBjb25zdCByYW5rPXAubWFwKHY9PjErcC5maWx0ZXIoeD0+eD52KS5sZW5ndGgpOwogIGNvbnN0IGN1dD1NYXRoLm1heCg1LE1hdGguY2VpbChOKi40KSk7CiAgcmV0dXJuIFIubWFwKChyLGkpPT4oe2ksbm86ci5udW18fGkrMSxuYW1lOnIubmFtZXx8ci5ob3JzZSxwOnBbaV0scGM6Y2FsaWJGb3IocFtpXSxtb2RlKSxtb2RlLAogICBqbjooc3RvcmUuam9ja2V5KHIuam9ja2V5KXx8e246MH0pLm4scmFuazpyYW5rW2ldLHBvcDpwb3BbaV0sYmFzZTpNYXRoLm1pbiguNSwzL04pLAogICBvZGQ6KG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKT9vZGRzW2ldOm51bGwsCiAgIGNhcmVlcjooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP3tuOmgubix0MzpoLnRvcDMsd2luOmgud2lufTpudWxsfSkoKSwKICAgcmVjZW50OigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5ydW5zLm1hcCh4PT54WzFdKTpbXX0pKCksCiAgIGpuYW1lOnIuam5hbWV8fCIiLGpzdGF0OigoKT0+e2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTtyZXR1cm4gaiYmai5uPj0xP3tuOmoubixyYXRlOmoudG9wMy9qLm59Om51bGx9KSgpLAogICBob2xlOk4+PTYmJnBvcFtpXT49Y3V0LG1rdDpta3Q/bWt0W2ldOm51bGwsdmFsdWU6bWt0P2NhbGliRm9yKHBbaV0sIm9kZHMiKS9ta3RbaV06bnVsbCwKICAgZHo6ZHpbaV0sdGFnczpncmFkZVRhZ3MoZXh0cmFUYWdzKHNjW2ldLnRhZ3MscixzdG9yZSxyYWNlKSxkeltpXSxyYWNlKSxjb25mOnNjW2ldLmNvbmYsbjpzY1tpXS5uLGN1dH0pKTsKIH0KCiAvKiA9PT09PSDpiYTmnb/ou7jppqzjg7vms6LkubHluqbvvIjnqbTppqzkuojmg7Pjgajjga/liKXjga7oqIjnrpfjgILkv4LmlbDjga8gdG9vbHMvYXhpc191cHNldF9zdHVkeS5qcyDjgaflrabnv5LjgIEyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT44Gn5qSc6Ki877yJID09PT09ICovCiBjb25zdCBBWElTPXsid1AiOlswLjA1MTkzLDEuMDE0ODMsMC4wNTE0OCwtMC4yMDY3NiwtMC41MzIxNiwwLjkxNDM3LC0wLjQ4NDY0LC0wLjMyMTE1LC0wLjU2ODAyLC0wLjU1MTM1LDAuMTczNDUsMS4wOTc0LC0wLjI4NDA3LC0wLjEwMzk3LC0wLjIxNjE3LC0wLjM0NjY4LDAuMTU5MTMsMC4yMjE5NiwtMC4zODczMiwtMC4zNDY1OCwwLjAwMzcsLTAuNTY2NDZdLCJ3TyI6WzAuNTQyNTksMC4xNTY2MSwwLjA1NDE0LC0wLjA0MzcxLC0wLjE0NTI0LDAuMTMxNzEsLTAuMTQxNzgsLTAuMTYyNjMsMC4wNTMxNiwtMC4wMjA5NywwLjAwMzksLTAuMjk4NjUsLTAuMzIzMjEsLTAuMDEzNjUsLTAuMDk1MTksLTAuMDc4MTgsMC4wMDA2LC0wLjAyMjkxLC0wLjExMjEzLDAuMDE3ODEsLTAuMDQ3NDUsLTAuMTA4NTIsMC4yNTcyMSwwLjYzMDcxXSwidXBzZXQiOnsidGhyIjoxNSwibW9kZWxzIjp7InByb3h5IjpbMi4yNDU1OSwwLjYzODQxLC0wLjA3MDgsLTAuMDgxNjEsLTAuMDc3NDMsMC4wOTEzNywwLjEzODQ3LDAuMDAyNzksLTAuMzg5MTksLTAuNjQyMTcsLTAuNTUzODEsLTAuMDE4MzcsLTAuNDQzMTcsLTAuNzY4MjUsLTAuNTIzOTMsLTIuNzM1NjEsLTAuMTQ5MDksMC4xMTQ3N10sIm9kZHMiOlstMC43MjM5NiwwLjQyODA4LC0wLjA3NDk5LC0wLjA2MTU0LC0wLjAwNjc1LDAuMDcyNDMsMC4wNzA4NSwtMC4wNDk3NCwtMC4xNTUyOCwtMC4zMjUxNiwtMC40MTgyNiwtMC4zMTM1MSwwLjIwNzU3LC0wLjIzOSwtMC4yNzkwMSwtMS44MjEwOCwtMC4wMDg1MiwwLjA4Mzk5LDAuMTUwMjQsMC4zNTI0MiwtMi4wMzgzOSwyLjg1NjY4LDAuMjI5MjksMC43MjA4NCwtMS45Nzc5N119LCJncmFkZXMiOnsicHJveHkiOnsiY3V0cyI6W1siU1NTIiwwLjU1MDM3XSxbIlNTIiwwLjQ4NTVdLFsiUyIsMC40MDQyNF0sWyJBIiwwLjI5ODhdLFsiQiIsMC4xODk1N10sWyJDIiwwLjAwNjI5XV0sInJhdGVzIjp7IlNTUyI6MC41NzQsIlNTIjowLjUwOSwiUyI6MC40MzMsIkEiOjAuMzQ3LCJCIjowLjI0NCwiQyI6MC4wODl9LCJhdmdTIjp7IlNTUyI6MTcuMiwiU1MiOjE1LjMsIlMiOjE0LjIsIkEiOjEzLjEsIkIiOjExLjgsIkMiOjkuOH19LCJvZGRzIjp7ImN1dHMiOltbIlNTUyIsMC42MDk2OF0sWyJTUyIsMC41MTU5NV0sWyJTIiwwLjQwODU0XSxbIkEiLDAuMjg3NjddLFsiQiIsMC4xNzM1OV0sWyJDIiwwLjAwNzY4XV0sInJhdGVzIjp7IlNTUyI6MC42NzksIlNTIjowLjU5OCwiUyI6MC40NTUsIkEiOjAuMzUyLCJCIjowLjI0NiwiQyI6MC4wNzl9LCJhdmdTIjp7IlNTUyI6MTguNSwiU1MiOjE2LjQsIlMiOjE0LjUsIkEiOjEzLjMsIkIiOjExLjgsIkMiOjkuNn19fX0sImJhbmRzIjp7IumJhOadvyI6eyJsbyI6MC45MiwiaGkiOjEsIm4iOjE2NiwicmF0ZSI6MC45NjM5LCJsbzk1IjowLjkzNTUsIm4yIjo4NywicmF0ZTIiOjAuOTc3LCJwZXJEYXkiOjAuNjJ9LCLmupbpiYTmnb8iOnsibG8iOjAuODgsImhpIjowLjkyLCJuIjoyNzksInJhdGUiOjAuODg1MywibG85NSI6MC44NDc5LCJuMiI6MTM5LCJyYXRlMiI6MC44OTkzLCJwZXJEYXkiOjEuMDR9LCLloIXou7giOnsibG8iOjAuODQsImhpIjowLjg4LCJuIjo0NzQsInJhdGUiOjAuODQxOCwibG85NSI6MC44MDg5LCJuMiI6MjI2LCJyYXRlMiI6MC44NDA3LCJwZXJEYXkiOjEuNzh9fX07CiBmdW5jdGlvbiBheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKXsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHhjPVIubWFwKHI9PmZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSk7CiAgY29uc3QgcFA9bm9ybWFsaXplVG9wMyh4Yy5tYXAoeD0+ZG90KEFYSVMud1AseCkpLE1hdGgubWluKDMsTikpOwogIGxldCBwTz1udWxsOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLG0zPXRvcDNGcm9tV2luKG9kZHMubWFwKG89PjEvbykpOwogICBwTz1ub3JtYWxpemVUb3AzKHhjLm1hcCgoeCxpKT0+ZG90KEFYSVMud08sWy4uLngsTWF0aC5sb2cocHdbaV0pLGxvZ2l0KE1hdGgubWluKC45OCxtM1tpXSkpXSkpLE1hdGgubWluKDMsTikpfQogIHJldHVybntwUCxwTyx4Y319CiAvKiDpiYTmnb/ou7jppqzvvJrjgqrjg4PjgrrjgYzjgYLjgovjg6zjg7zjgrnjgaDjgZHjgILkuojmuKznorrnjofjga7ljLrliIbjgZTjgajjgavjgIHpgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H44KS5re744GI44KLICovCiBmdW5jdGlvbiBheGlzUGlja3MocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBhcD1hcHx8YXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyk7aWYoIWFwLnBPKXJldHVybiBudWxsOwogIGNvbnN0IG91dD1bXTthcC5wTy5mb3JFYWNoKChwLGkpPT57CiAgIGZvcihjb25zdCBrIG9mIFsi6YmE5p2/Iiwi5rqW6YmE5p2/Iiwi5aCF6Lu4Il0pe2NvbnN0IGI9QVhJUy5iYW5kc1trXTtpZihwPj1iLmxvJiZwPChrPT09IumJhOadvyI/MS4wMTpiLmhpKSl7b3V0LnB1c2goe2kscCx0aWVyOmsscmF0ZTpiLnJhdGUsbG85NTpiLmxvOTUsbjpiLm59KTticmVha319fSk7CiAgcmV0dXJuIG91dC5zb3J0KChhLGIpPT5iLnAtYS5wKX0KIC8qIOazouS5seW6pu+8mlNTU+OAnEPjgIIz552A5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GMMTXku6XkuIrjgavjgarjgovnorrnjofjgafnrYnntJrjgaXjgZEgKi8KIGZ1bmN0aW9uIHVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBhcD1hcHx8YXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyk7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aCxwcz1hcC5wUC5zbGljZSgpLnNvcnQoKGEsYik9PmItYSk7CiAgY29uc3QgbnM9Ui5tYXAocj0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5uOjB9KSxtb250aD1OdW1iZXIoU3RyaW5nKHJhY2UuZGF0ZSkuc2xpY2UoNSw3KSl8fDAsTD1yYWNlLmx2bHx8MDsKICBjb25zdCBmPVsxLE4vMTYsTD09PTE/MTowLEw9PT0yPzE6MCxMPT09Mz8xOjAsTD09PTQ/MTowLEw9PT01PzE6MCxyYWNlLnN1cmY9PT0xPzE6MCwocmFjZS5kaXN0fHwwKS8yMDAwLAogICBucy5maWx0ZXIobj0+bj09PTApLmxlbmd0aC9OLG5zLmZpbHRlcihuPT5uPDMpLmxlbmd0aC9OLG5zLnJlZHVjZSgoYSxuKT0+YStNYXRoLmxvZygxK24pLDApL04vMywKICAgcHNbMF0scHNbMV0scHNbMl0scHMucmVkdWNlKChhLHApPT5hK3AqcCwwKSxwcy5maWx0ZXIocD0+cD4uNSkubGVuZ3RoLzMsbW9udGg+PTYmJm1vbnRoPD05PzE6MF07CiAgbGV0IG1vZGU9InByb3h5IjsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7CiAgIGNvbnN0IGludj1vZGRzLm1hcChvPT4xL28pLFQ9aW52LnJlZHVjZSgoYSxiKT0+YStiLDApLHB3PWludi5tYXAodj0+di9UKS5zb3J0KChhLGIpPT5iLWEpLG9kPW9kZHMuc2xpY2UoKS5zb3J0KChhLGIpPT5hLWIpOwogICBjb25zdCBlbnQ9LXB3LnJlZHVjZSgoYSxwKT0+YStwKk1hdGgubG9nKHApLDApL01hdGgubG9nKE4pOwogICBmLnB1c2gocHdbMF0scHdbMV0scHdbMF0rcHdbMV0rcHdbMl0sZW50LE1hdGgubG9nKG9kWzBdKSxNYXRoLmxvZyhvZFsxXSksb2QuZmlsdGVyKG89Pm88MTApLmxlbmd0aC9OKTttb2RlPSJvZGRzIn0KICByZXR1cm57Zixtb2RlLHAwOnNpZ21vaWQoZG90KEFYSVMudXBzZXQubW9kZWxzW21vZGVdLGYpKX19CiBmdW5jdGlvbiB1cHNldEdyYWRlKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgY29uc3QgdT11cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsb2RkcyxhcCksbW9kZT11Lm1vZGUscD11LnAwLEc9QVhJUy51cHNldC5ncmFkZXNbbW9kZV07CiAgbGV0IGdyYWRlPSJDIjtmb3IoY29uc3QgW2csY10gb2YgRy5jdXRzKXtpZihwPj1jKXtncmFkZT1nO2JyZWFrfX0KICByZXR1cm57Z3JhZGUscCxtb2RlLHJhdGU6Ry5yYXRlc1tncmFkZV0sYXZnUzpHLmF2Z1NbZ3JhZGVdfX0KCiAvKiDmiZXmiLvjgaTjgY3mmYLns7vliJfjg5Djg4Pjgq/jg4bjgrnjg4jjgIJyYWNlcyDjga/ml6Xku5jmmIfpoIYgW3tpZCxkYXRlLHJvd3N9XeOAgXBheUJ5SWQg44GvIHtyYWNlSWQ6e3BsYWNlOlt7bnVtYmVyLHllbn1dfX3jgIIKICAgIOeptOOCvuODvOODs+OBr+Wun+OCquODg+OCuumghuS9jeOBp+Wumue+qe+8iOODhOODvOODq+OBruOCquODg+OCuuWFpeWKm+ODouODvOODieOBqOWQjOOBmOeKtuazge+8ieOAguWQhOODrOODvOOCuTEwMOWGhuOBmuOBpOizvOWFpeOAgiAqLwogZnVuY3Rpb24gYmFja3Rlc3QocmFjZXMscGF5QnlJZCxvcHRzKXsKICBvcHRzPW9wdHN8fHt9O2NvbnN0IFNUQVJUPW9wdHMuc3RhcnR8fCIiLFNQTElUPW9wdHMuc3BsaXR8fCIiLE9PUz1vcHRzLm9vc3x8IiIsUFJPWFk9ISFvcHRzLnByb3h5LE1JTkc9TnVtYmVyKG9wdHMubWluR3JkKXx8MCxfZ09uPUdSQURFLm9uO0dSQURFLm9uPSFvcHRzLmdyYWRlT2ZmOwogIGNvbnN0IG5hbWVzPVsidG9wMSIsInRvcDIiLCJ0b3AzIiwiYWxsSG9sZSIsInZhbHVlIiwiYXhpcyIsImZvY3VzIl0scGVyPVsiYWxsIiwiQSIsIkIiLCJDIl07CiAgY29uc3QgUz17fTtmb3IoY29uc3QgbiBvZiBuYW1lcyl7U1tuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpU1tuXVtwXT17YmV0czowLGhpdHM6MCxyZXQ6MCxzcTowfX0KICBjb25zdCBTRUc9e307ICAgLy8gMeS9jeWAmeijnOOBruadoeS7tuWIpe+8iOWFqOacn+mWk++8j+WJjeWNiu+8j+W+jOWNiu+8iQogIGNvbnN0IHN0b3JlPW5ldyBTdG9yZSgpO2xldCB1c2VkPTA7CiAgY29uc3QgYWRkPShuLHAsaGl0LHllbik9Pntjb25zdCB4PVNbbl1bcF07eC5iZXRzKys7aWYoaGl0KXguaGl0cysrO3gucmV0Kz15ZW47eC5zcSs9eWVuKnllbn07CiAgY29uc3QgYWRkU2VnPShsYWJlbCxwLHllbik9Pntjb25zdCBnPVNFR1tsYWJlbF09U0VHW2xhYmVsXXx8e2FsbDp7bjowLGg6MCxyOjAscTowfSxBOntuOjAsaDowLHI6MCxxOjB9LEI6e246MCxoOjAscjowLHE6MH19O2Zvcihjb25zdCBrIG9mIFsiYWxsIixwXSl7Y29uc3QgeD1nW2tdO3gubisrO2lmKHllbj4wKXguaCsrO3gucis9eWVuO3gucSs9eWVuKnllbn19OwogIGNvbnN0IEFWPVBST1hZPy4xMTU6LjA5MTsKICBmb3IoY29uc3QgcmMgb2YgcmFjZXMpewogICAvLyDmiZXmiLvjga5JROOBr+OAjOaXpeS7mC3plovlgqzloLQtUueVquWPt+OAjeOAguODkOODg+OCr+OCouODg+ODl+OBrjEy5qGBSUTjgajjgoLjgIHlkIzjgZjlvaLlvI/jga5JROOBqOOCgue1kOOBs+S7mOOBkeOCiwogICBjb25zdCB2T2Y9L15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSg0LDYpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVszXXx8IiIsck9mPU51bWJlcigvXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDEwLDEyKTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbNF18fDApOwogICBjb25zdCBwYXk9cGF5QnlJZFtyYy5pZF18fHBheUJ5SWRbYCR7cmMuZGF0ZX0tJHt2T2Z9LSR7U3RyaW5nKHJPZikucGFkU3RhcnQoMiwiMCIpfWBdOwogICBpZihwYXkmJnBheS5wbGFjZSYmcGF5LnBsYWNlLmxlbmd0aCYmcmMuZGF0ZT49U1RBUlQmJighTUlOR3x8KChyYy5yb3dzWzBdJiZyYy5yb3dzWzBdLmdyZCl8fDApPj1NSU5HKSl7CiAgICAvLyDlh7rotbDooajjgajlkIzjgZjppqznlarpoIbjgavkuKbjgbnjgovvvIjlkIzngrnjga7jgajjgY3jga7kuKbjgbPjgafnnYDpoIbjgYzmvI/jgozjgarjgYTjgojjgYbjgavvvIkKICAgIGNvbnN0IFI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSk7CiAgICBjb25zdCBoYXNPZGRzPVIubGVuZ3RoPj02JiZSLmV2ZXJ5KHI9PnIub2Rkcz4xKSxoYXNQb3A9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5wb3A+MCk7CiAgICBpZihQUk9YWT9SLmxlbmd0aD49NjooaGFzT2Rkc3x8aGFzUG9wKSl7CiAgICAgY29uc3QgcmFjZT17ZGF0ZTpyYy5kYXRlLHN1cmY6UlswXS5zdXJmLGRpc3Q6UlswXS5kaXN0LGx2bDpSWzBdLmx2bHx8MCxncmQ6UlswXS5ncmR8fDAscnVubmVyczpSfTsKICAgICBjb25zdCByZXM9UFJPWFk/YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwpOihoYXNPZGRzP2FuYWx5emUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTphbmFseXplKHJhY2Usc3RvcmUsbnVsbCxudWxsLFIubWFwKHI9PnIucG9wKSkpOwogICAgIGNvbnN0IHllbj1uZXcgTWFwKHBheS5wbGFjZS5tYXAoeD0+W3gubnVtYmVyLHgueWVuXSkpOwogICAgIGNvbnN0IGhvbGU9cmVzLmZpbHRlcih4PT54LmhvbGUpLnNvcnQoKGEsYik9PmIucC1hLnApOwogICAgIGlmKGhvbGUubGVuZ3RoKXsKICAgICAgdXNlZCsrO2NvbnN0IHByPVNQTElUPyhyYy5kYXRlPFNQTElUPyJBIjoiQiIpOiJBIjsKICAgICAgY29uc3QgYnV5PShuLGxpc3QpPT57Zm9yKGNvbnN0IHggb2YgbGlzdCl7Y29uc3QgeT15ZW4uZ2V0KFJbeC5pXS5udW0pfHwwO2FkZChuLCJhbGwiLHk+MCx5KTthZGQobixwcix5PjAseSk7aWYoT09TJiZyYy5kYXRlPj1PT1MpYWRkKG4sIkMiLHk+MCx5KX19OwogICAgICBidXkoImZvY3VzIixwaWNrRm9jdXMocmVzLDEpKTsKICAgICAgYnV5KCJ0b3AxIixwaWNrKHJlcywxKSk7YnV5KCJ0b3AyIixwaWNrKHJlcywyKSk7YnV5KCJ0b3AzIixwaWNrKHJlcywzKSk7YnV5KCJhbGxIb2xlIixob2xlKTsKICAgICAgaWYoIVBST1hZKWJ1eSgidmFsdWUiLGhvbGUuZmlsdGVyKHg9PngudmFsdWU+PTEuMykpOwogICAgICBpZighUFJPWFkmJmhhc09kZHMpe2NvbnN0IGFwPWF4aXNQcm9icyhyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpO2lmKGFwLnBPKWJ1eSgiYXhpcyIsYXAucE8ubWFwKChwLGkpPT4oe2kscH0pKS5maWx0ZXIoeD0+eC5wPj1BWElTLmJhbmRzWyLpiYTmnb8iXS5sbykpfQogICAgICBjb25zdCB0PXBpY2socmVzLDEpWzBdOwogICAgICBpZih0KXtjb25zdCB5PXllbi5nZXQoUlt0LmldLm51bSl8fDAscj10LnBjL0FWLE49Ui5sZW5ndGg7CiAgICAgICBjb25zdCByYW5rPShyPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyIpOwogICAgICAgYWRkU2VnKCLjg6njg7Pjgq8iKyh0Lm48MiYmKHJhbms9PT0iUyJ8fHJhbms9PT0iQSIpPyJCIjpyYW5rKSxwcix5KTsKICAgICAgIGFkZFNlZyhOPD0xMD8i6aCt5pWwIOOAnDEwIjpOPD0xND8i6aCt5pWwIDEx44CcMTQiOiLpoK3mlbAgMTXjgJwiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2Uuc3VyZj09PTE/IuiKnSI6cmFjZS5zdXJmPT09Mj8i44OA44O844OIIjoi44Gd44Gu5LuWIixwcix5KTsKICAgICAgIGFkZFNlZyhyYWNlLmx2bD4wPyLjgq/jg6njgrkgIitMVk5bcmFjZS5sdmxdOiLjgq/jg6njgrkg5LiN5piOIixwcix5KTsKICAgICAgIGFkZFNlZyh0Lm4+PTU/IuWun+e4viA16LWw5Lul5LiKIjp0Lm4+PTM/IuWun+e4viAz44CcNOi1sCI6IuWun+e4viAz6LWw5pyq5rqAIixwcix5KTsKICAgICAgIGlmKCFQUk9YWSYmdC5vZGQpe2NvbnN0IG89dC5vZGQ7YWRkU2VnKG88OD8i5Y2Y5YudIOOAnDjlgI0iOm88MTU/IuWNmOWLnSA444CcMTXlgI0iOm88MzA/IuWNmOWLnSAxNeOAnDMw5YCNIjpvPDYwPyLljZjli50gMzDjgJw2MOWAjSI6IuWNmOWLnSA2MOWAjeOAnCIscHIseSk7CiAgICAgICAgaWYoaGFzT2Rkcyl7Y29uc3QgdWc9dXBzZXRHcmFkZShyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpO2FkZFNlZygi5rOi5Lmx5bqmICIrdWcuZ3JhZGUscHIseSl9fX0KICAgICB9CiAgICB9CiAgIH0KICAgZm9yKGNvbnN0IHIgb2YgcmMucm93cylzdG9yZS5hZGQocik7CiAgfQogIGNvbnN0IGZpbj17fTsKICBmb3IoY29uc3QgbiBvZiBuYW1lcyl7ZmluW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcil7Y29uc3QgeD1TW25dW3BdOwogICBpZigheC5iZXRzKXtmaW5bbl1bcF09e2JldHM6MH07Y29udGludWV9CiAgIGNvbnN0IG1lYW49eC5yZXQveC5iZXRzLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHguc3EveC5iZXRzLW1lYW4qbWVhbikpOwogICBmaW5bbl1bcF09e2JldHM6eC5iZXRzLGhpdFJhdGU6eC5oaXRzL3guYmV0cyxyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHguYmV0cykvMTAwfX19CiAgY29uc3Qgc2Vncz17fTsKICBmb3IoY29uc3QgW2ssZ10gb2YgT2JqZWN0LmVudHJpZXMoU0VHKSl7c2Vnc1trXT17fTtmb3IoY29uc3QgcCBvZiBbImFsbCIsIkEiLCJCIl0pe2NvbnN0IHg9Z1twXTsKICAgaWYoIXgubil7c2Vnc1trXVtwXT17YmV0czowfTtjb250aW51ZX1jb25zdCBtZWFuPXguci94Lm4sc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5xL3gubi1tZWFuKm1lYW4pKTsKICAgc2Vnc1trXVtwXT17YmV0czp4Lm4saGl0UmF0ZTp4LmgveC5uLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5uKS8xMDB9fX0KICBHUkFERS5vbj1fZ09uO3JldHVybntyYWNlczp1c2VkLHN0YXRzOmZpbixzZWdzfTsKIH0KIHJldHVybnt1cHNldEZlYXR1cmVzLGNsZWFuVHIsR1JBREUsZ3JhZGVUaWVyLGdyYWRlQWRqLEZPQ1VTLHJhdGluZyxwaWNrRm9jdXMsQVhJUyxheGlzUHJvYnMsYXhpc1BpY2tzLHVwc2V0R3JhZGUscGljayxmZWF0cyxNT0RFTCxGTixGSixsZXZlbE9mTGFiZWwsbGV2ZWxPZlByaXplLGJhY2t0ZXN0LGNhbGliLGNhbGliRm9yLGpubixubix0b1Jvdyxjc3ZSb3dzLFN0b3JlLGFuYWx5emUsaG9yc2VTY29yZSxub3JtYWxpemVUb3AzLHRvcDNGcm9tV2luLHN1cmZDb2RlLHBhcnNlRGF0ZX07Cn0pKCk7CgoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDjgqLjg5fjg6rlsaTvvIjlho3mp4vnr4nvvIkKICogIOODu+S/neWtmC/lho3plovjgaTjgY3jga7pgY7ljrvjg4fjg7zjgr/lj5blvpfjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjgIHmpJzoqLzjga/jgIHli5XkvZznorroqo3muIjjgb/jga7lh6bnkIbjgpLjgZ3jga7jgb7jgb7lho3liKnnlKgKICogIOODu+S7iumAseacq+OBruWPluW+l+OAgemojuaJi+ODu+iqv+aVmeW4q+OBrueFp+WQiOOAgeacn+W+heWApOOAgei2hemJhOadv+OAgeazouS5seW6puOAgeWPluOCiui+vOOBv+WTgeizquOBruihqOekuuOBr+aWsOimjwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0ICQ9aWQ9PmRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsKY29uc3QgZXNjPXM9PlN0cmluZyhzPz8iIikucmVwbGFjZSgvWyY8PiInXS9nLG09Pih7IiYiOiImYW1wOyIsIjwiOiImbHQ7IiwiPiI6IiZndDsiLCciJzoiJnF1b3Q7IiwiJyI6IiYjMzk7In1bbV0pKTsKY29uc3Qgc2xlZXA9KG1zPTApPT5uZXcgUHJvbWlzZShyPT5zZXRUaW1lb3V0KHIsbXMpKTsKZnVuY3Rpb24gYnVzeShvbixtc2c9IuWHpueQhuS4reKApiIpeyQoImJ1c3kiKS5zdHlsZS5kaXNwbGF5PW9uPyJmbGV4Ijoibm9uZSI7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1tc2d9CmxldCBEQj1udWxsLFNUT1JFPW51bGwsU1RPUkVfS0VZPSIiOwpjb25zdCBWRU5VRT17IjAxIjoi5pyt5bmMIiwiMDIiOiLlh73ppKgiLCIwMyI6Iuemj+WztiIsIjA0Ijoi5paw5r2fIiwiMDUiOiLmnbHkuqwiLCIwNiI6IuS4reWxsSIsIjA3Ijoi5Lit5LqsIiwiMDgiOiLkuqzpg70iLCIwOSI6IumYquelniIsIjEwIjoi5bCP5YCJIn07CmNvbnN0IGpzdFRvZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpjb25zdCBwY3Q9KHgsaz0wKT0+eD09bnVsbHx8IU51bWJlci5pc0Zpbml0ZSh4KT8iLSI6KHgqMTAwKS50b0ZpeGVkKGspKyIlIjsKCmZ1bmN0aW9uIG9wZW5EQigpe3JldHVybiBuZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgcj1pbmRleGVkREIub3BlbigidXBzZXRfdG9vbF9kYiIsMik7CiByLm9udXBncmFkZW5lZWRlZD1lPT57Y29uc3QgZD1lLnRhcmdldC5yZXN1bHQ7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygiZmlsZXMiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJmaWxlcyIpO2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoIm1ldGEiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJtZXRhIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygicGF5IikpZC5jcmVhdGVPYmplY3RTdG9yZSgicGF5Iil9Owogci5vbnN1Y2Nlc3M9KCk9PntEQj1yLnJlc3VsdDtvaygpfTtyLm9uZXJyb3I9KCk9Pm5nKHIuZXJyb3IpO3Iub25ibG9ja2VkPSgpPT5uZyhuZXcgRXJyb3IoIuS7luOBruOCv+ODluOBp+S9v+eUqOS4reOBp+OBmSIpKX0pfQpjb25zdCBpZGJBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJmaWxlcyIpLm9iamVjdFN0b3JlKCJmaWxlcyIpLmdldEFsbCgpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgaWRiUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJmaWxlcyIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgiZmlsZXMiLGspO29rKCl9O3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgaWRiQ2xlYXI9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpLHN0PXQub2JqZWN0U3RvcmUoImZpbGVzIik7c3Qub3BlbkN1cnNvcigpLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7aWYoIVN0cmluZyhjLmtleSkuc3RhcnRzV2l0aCgibGl2ZToiKSl7bWFya0RpcnR5KCJmaWxlcyIsYy5rZXkpO2MuZGVsZXRlKCl9Yy5jb250aW51ZSgpfX07dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKCi8qIOWPluOCiui+vOOBv+a4iOOBv+OBruWFqOihjO+8iOODkOODg+OCr+OCouODg+ODl0NTVu+8i+WPluW+l+a4iOOBv+OBruaIkOe4vu+8ieOCkumghuOBq+a4oeOBmSAqLwphc3luYyBmdW5jdGlvbiBmb3JFYWNoUm93KGNiKXsKIGNvbnN0IGZzPWF3YWl0IGlkYkFsbCgpOwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXtjb25zdCBmPWZzW2ldOwogIGlmKGYubGl2ZSl7Zm9yKGNvbnN0IHggb2YgZi5yb3dzfHxbXSljYihsaXZlUm93KHgpKX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKWNiKFVFLnRvUm93KG8pKTsKICBpZihpJTM9PT0yKWF3YWl0IHNsZWVwKDApfQp9Ci8qIOODrOODvOOCuUlE44GL44KJ6ZaL5YKs5aC044O7UueVquWPt++8iDEy5qGB44GuSlJB5b2i5byP77yP5pel5LuYLemWi+WCrOWgtC1S5b2i5byP44Gu5Lih5a++5b+c77yJICovCmZ1bmN0aW9uIHZlbnVlT2ZJZChpZCl7cmV0dXJuIC9eXGR7MTJ9JC8udGVzdChpZCk/aWQuc2xpY2UoNCw2KTpTdHJpbmcoaWQpLnNwbGl0KCItIilbM118fCIifQpmdW5jdGlvbiByYWNlTm9PZklkKGlkKXtyZXR1cm4gTnVtYmVyKC9eXGR7MTJ9JC8udGVzdChpZCk/aWQuc2xpY2UoMTAsMTIpOlN0cmluZyhpZCkuc3BsaXQoIi0iKVs0XXx8MCl9CgovKiAtLS0g5Y+W44KK6L6844G/IC0tLSAqLwphc3luYyBmdW5jdGlvbiBpbXBvcnRGaWxlKGZpbGUpewogYnVzeSh0cnVlLCLjg5XjgqHjgqTjg6vjgpLoqq3jgb/ovrzjgb/kuK3igKZcbuWkp+OBjeOBhOODleOCoeOCpOODq+OBr+aVsOWNgeenkuOBi+OBi+OCiuOBvuOBmeOAgiIpO2F3YWl0IHNsZWVwKDMwKTsKIHRyeXsKICBjb25zdCB0ZXh0PWF3YWl0IGZpbGUudGV4dCgpO2xldCBpdGVtczsKICBpZigvXC5jc3YkL2kudGVzdChmaWxlLm5hbWUpKXtpdGVtcz1be3R5cGU6InJhY2UtcmVzdWx0cyIseWVhcjowLHBsYWNlOmZpbGUubmFtZSxjc3Y6dGV4dH1dfQogIGVsc2V7Y29uc3Qgaj1KU09OLnBhcnNlKHRleHQpO2l0ZW1zPUFycmF5LmlzQXJyYXkoaik/ajooai5maWxlc3x8W2pdKX0KICBpdGVtcz1pdGVtcy5maWx0ZXIoeD0+eCYmdHlwZW9mIHguY3N2PT09InN0cmluZyIpOwogIGlmKCFpdGVtcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCJjc3bjgpLlkKvjgoDjg4fjg7zjgr/jgYzopovjgaTjgYvjgorjgb7jgZvjgpPjgILjg5Djg4Pjgq/jgqLjg4Pjg5dKU09O44GL44CBQ1NW44KS6YG444KT44Gn44GP44Gg44GV44GE44CCIik7CiAgYXdhaXQgaWRiQ2xlYXIoKTtsZXQgbj0wOwogIGZvcihsZXQgaT0wO2k8aXRlbXMubGVuZ3RoO2krKyl7Y29uc3QgaXQ9aXRlbXNbaV07YXdhaXQgaWRiUHV0KGAke2l0LnllYXJ8fDB9OiR7aXQucGxhY2V9OiR7aX1gLHt5ZWFyOml0LnllYXIscGxhY2U6aXQucGxhY2UscGxhY2VOYW1lOml0LnBsYWNlTmFtZSxjc3Y6aXQuY3N2fSk7CiAgIG4rPU1hdGgubWF4KDAsaXQuY3N2LnNwbGl0KCJcbiIpLmxlbmd0aC0xKTskKCJidXN5VGV4dCIpLnRleHRDb250ZW50PWDkv53lrZjkuK3igKYgJHtpKzF9LyR7aXRlbXMubGVuZ3RofWA7YXdhaXQgc2xlZXAoMCl9CiAgU1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7CiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluOCiui+vOOBv+WujOS6hu+8miR7aXRlbXMubGVuZ3RofeODleOCoeOCpOODq++8j+e0hCR7bi50b0xvY2FsZVN0cmluZygpfeihjDwvc3Bhbj5gOwogIGJrU2NoZWR1bGUoKTsKIH1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5Y+W44KK6L6844G/44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7YnVzeShmYWxzZSl9Cn0KCmNvbnN0IHBheUFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oInBheSIpLm9iamVjdFN0b3JlKCJwYXkiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IHBheVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oInBheSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoInBheSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgicGF5IixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IG1ldGFHZXQ9az0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oIm1ldGEiKS5vYmplY3RTdG9yZSgibWV0YSIpLmdldChrKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHQpO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgbWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJtZXRhIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmFzeW5jIGZ1bmN0aW9uIHBheVN0YXRlKCl7YXdhaXQgc2hvd1N0YXRlKCl9CgovKiAtLS0g5YWx6YCa44Gu5Y+W5b6X77yI5YaN6Kmm6KGM44Gk44GN77yJIC0tLSAqLwpsZXQgU1lOQ0lORz1mYWxzZTsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hKU09OKHVybCx3YWl0c0FyZyl7CiBsZXQgZXJyPSIiO2NvbnN0IHdhaXRzPXdhaXRzQXJnfHx3aW5kb3cuX19XQUlUU3x8WzQwMDAsMTIwMDAsMzAwMDAsNjAwMDBdOwogZm9yKGxldCB0PTA7dDw9d2FpdHMubGVuZ3RoO3QrKyl7CiAgdHJ5ewogICBjb25zdCByPWF3YWl0IGZldGNoKHVybCk7Y29uc3QgdHh0PWF3YWl0IHIudGV4dCgpO2xldCB4PXt9O3RyeXt4PUpTT04ucGFyc2UodHh0KX1jYXRjaChlKXt9CiAgIGlmKCFyLm9rfHx4Lm9rPT09ZmFsc2Upe2NvbnN0IGU9bmV3IEVycm9yKHguZXJyb3J8fGBIVFRQICR7ci5zdGF0dXN9YCsodHh0JiYheC5lcnJvcj9g77yIJHt0eHQucmVwbGFjZSgvXHMrL2csIiAiKS5zbGljZSgwLDUwKX3vvIlgOiIiKSk7ZS5zdGF0dXM9ci5zdGF0dXM7dGhyb3cgZX0KICAgcmV0dXJuIHg7CiAgfWNhdGNoKGUpewogICBlcnI9ZS5tZXNzYWdlO2NvbnN0IHJldHJ5PSFlLnN0YXR1c3x8ZS5zdGF0dXM+PTUwMHx8ZS5zdGF0dXM9PT00Mjk7CiAgIGlmKCFyZXRyeXx8dD09PXdhaXRzLmxlbmd0aClicmVhazsKICAgaWYoU1lOQ0lORykkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YOa3t+mbkeOBruOBn+OCgSR7TWF0aC5yb3VuZCh3YWl0c1t0XS8xMDAwKX3np5LlvoXjgaPjgablho3oqabooYzjgZfjgb7jgZnigKbvvIgke2Vycn3vvIlgOwogICBhd2FpdCBzbGVlcCh3YWl0c1t0XSk7CiAgfQogfQogdGhyb3cgbmV3IEVycm9yKGVycik7Cn0KY29uc3QgTU9ERUxfVFJBSU5fRU5EPSIyMDI2LTA2LTIyIjsgICAvLyDnj77lnKjjga7jg6Ljg4fjg6vjga/jgIHjgZPjga7ml6XjgojjgorliY3jga7miJDnuL7jgaflrabnv5IKY29uc3QganN0WWVzdGVyZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzLTg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpjb25zdCBhZGREYXlzPShkLG4pPT5uZXcgRGF0ZShuZXcgRGF0ZShkKyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpK24qODY0ZTUpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmZ1bmN0aW9uIG1vbnRoc0JldHdlZW4oYSxiKXtjb25zdCBvdXQ9W107bGV0W3ksbV09YS5zbGljZSgwLDcpLnNwbGl0KCItIikubWFwKE51bWJlcik7Y29uc3RbeTIsbTJdPWIuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpOwogd2hpbGUoeTx5Mnx8KHk9PT15MiYmbTw9bTIpKXtvdXQucHVzaChgJHt5fS0ke1N0cmluZyhtKS5wYWRTdGFydCgyLCIwIil9YCk7bSsrO2lmKG0+MTIpe209MTt5Kyt9fXJldHVybiBvdXR9CgoKLyogLS0tIOKRoCDjg4fjg7zjgr/lj5blvpfvvJrpgY7ljrvmiJDnuL7vvIjkurrmsJfjgaTjgY3vvInvvIvmiZXmiLvjgpLjgIHplovlgqzml6XjgZTjgajjgavlj5blvpfjgZfjgabkv53lrZggLS0tICovCmNvbnN0IFNZTkNfQkFUQ0g9NCxTWU5DX1BBUkFMTEVMPTI7CmxldCBTU1RPUD1mYWxzZSxCQUNLVVBfREFURVM9bnVsbDsKJCgic3luY1N0b3AiKS5vbmNsaWNrPSgpPT57U1NUT1A9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWV9OwokKCJzZW5kIikudmFsdWU9anN0WWVzdGVyZGF5KCk7CmFzeW5jIGZ1bmN0aW9uIGJhY2t1cERhdGVzKCl7CiBpZihCQUNLVVBfREFURVMpcmV0dXJuIEJBQ0tVUF9EQVRFUzsKIGNvbnN0IHM9bmV3IFNldCgpLGZzPWF3YWl0IGlkYkFsbCgpOwogZm9yKGNvbnN0IGYgb2YgZnMpe2lmKGYubGl2ZSljb250aW51ZTtmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSl7Y29uc3QgZD1VRS5wYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSk7aWYoZClzLmFkZChkKX1hd2FpdCBzbGVlcCgwKX0KIHJldHVybiBCQUNLVVBfREFURVM9czsKfQphc3luYyBmdW5jdGlvbiBmZXRjaERheShiYXNlLGQpewogY29uc3QgZGF5PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5P2RhdGU9JHtkfWApOwogY29uc3QgcmFjZXM9ZGF5LnJhY2VzfHxbXTtpZighcmFjZXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIik7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSs9U1lOQ19CQVRDSCljaHVua3MucHVzaChyYWNlcy5zbGljZShpLGkrU1lOQ19CQVRDSCkubWFwKHg9PnguY25hbWUpKTsKIGNvbnN0IHJvd3M9W10scGF5b3V0cz1bXTtsZXQgaWR4PTAsZmFpbGVkTj0wOwogY29uc3Qgd29ya2VyPWFzeW5jKCk9Pnt3aGlsZShpZHg8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1pZHgrKzsKICBjb25zdCByZXM9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1yZXN1bHRzP2NuYW1lcz0ke2NodW5rc1trXS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCk7CiAgcm93cy5wdXNoKC4uLihyZXMucm93c3x8W10pKTtwYXlvdXRzLnB1c2goLi4uKHJlcy5wYXlvdXRzfHxbXSkpO2ZhaWxlZE4rPShyZXMuZmFpbGVkfHxbXSkubGVuZ3RofX07CiBhd2FpdCBQcm9taXNlLmFsbChBcnJheS5mcm9tKHtsZW5ndGg6TWF0aC5taW4oU1lOQ19QQVJBTExFTCxjaHVua3MubGVuZ3RoKX0sd29ya2VyKSk7CiBjb25zdCBnb3Q9bmV3IFNldChyb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemU7CiBmYWlsZWROPU1hdGgubWF4KGZhaWxlZE4scmFjZXMubGVuZ3RoLWdvdCk7CiByZXR1cm57cm93cyxwYXlvdXRzLGZhaWxlZE4scmFjZXM6cmFjZXMubGVuZ3RofTsKfQokKCJzeW5jR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogY29uc3QgYT0kKCJzc3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpO2xldCBiPSQoInNlbmQiKS52YWx1ZXx8eWQ7aWYoYj55ZCliPXlkOwogaWYoYT5iKXskKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IumWi+Wni+aXpeOBjOe1guS6huaXpeOCiOOCiuW+jOOBp+OBmeOAgiI7cmV0dXJufQogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoInN5bmNHbyIpLmRpc2FibGVkPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD1mYWxzZTsKIGNvbnN0IHN0PXtkYXlzOjAscmFjZXM6MCxza2lwcGVkOjAsZmFpbDpbXSx0MDpEYXRlLm5vdygpfTtsZXQgY29uc2VjPTA7CiB0cnl7CiAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLkv53lrZjmuIjjgb/jg4fjg7zjgr/jgpLnorroqo3kuK3igKYiOwogIGNvbnN0IGZpbGVzPWF3YWl0IGlkYkFsbCgpLGhhdmVMaXZlPW5ldyBTZXQoZmlsZXMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkubWFwKGY9PmYuZGF0ZSkpOwogIGNvbnN0IGhhdmVQYXk9bmV3IFNldCgoYXdhaXQgcGF5QWxsKCkpLmZpbHRlcihwPT4hcC5mYWlsZWQpLm1hcChwPT5wLmRhdGUpKTsKICBjb25zdCBiaz1hd2FpdCBiYWNrdXBEYXRlcygpOwogIGNvbnN0IG1vbnRocz1tb250aHNCZXR3ZWVuKGEsYiksY3VyTW9udGg9eWQuc2xpY2UoMCw3KTsKICBmb3IobGV0IG1pPTA7bWk8bW9udGhzLmxlbmd0aDttaSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgbW9udGg9bW9udGhzW21pXTsKICAgaWYobW9udGg8Y3VyTW9udGgmJmF3YWl0IG1ldGFHZXQoIm1vbnRoOiIrbW9udGgpKXtjb250aW51ZX0KICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke21vbnRofe+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iemWi+WCrOaXpeOCkueiuuiqjeS4reKApiDlj5blvpfmuIjjgb8ke3N0LmRheXN95pelYDsKICAgbGV0IGRheXM7dHJ5e2RheXM9KGF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5cz9tb250aD0ke21vbnRofWApKS5kYXlzfHxbXTtjb25zZWM9MH1jYXRjaChlKXtzdC5mYWlsLnB1c2goYCR7bW9udGh977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICBkYXlzPWRheXMuZmlsdGVyKGQ9PmQ+PWEmJmQ8PWIpO2xldCBtb250aE9rPXRydWU7CiAgIGZvcihjb25zdCBkIG9mIGRheXMpewogICAgaWYoU1NUT1Ape21vbnRoT2s9ZmFsc2U7YnJlYWt9CiAgICBjb25zdCBuZWVkUm93cz0haGF2ZUxpdmUuaGFzKGQpJiYhYmsuaGFzKGQpLG5lZWRQYXk9IWhhdmVQYXkuaGFzKGQpOwogICAgaWYoIW5lZWRSb3dzJiYhbmVlZFBheSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfQogICAgY29uc3QgZWw9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS1zdC50MCkvMTAwMCk7CiAgICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZH0g44KS5Y+W5b6X5Lit77yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJXG7lj5blvpcke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmA7CiAgICB0cnl7CiAgICAgY29uc3Qgcj1hd2FpdCBmZXRjaERheShiYXNlLGQpOwogICAgIGlmKHIuZmFpbGVkTil7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvIgke3IuZmFpbGVkTn1S5aSx5pWX77yJYCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICAgIGlmKG5lZWRSb3dzKXthd2FpdCBpZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTtoYXZlTGl2ZS5hZGQoZCl9CiAgICAgYXdhaXQgcGF5UHV0KGQse2RhdGU6ZCxyYWNlczpyLnBheW91dHMsZmFpbGVkOjB9KTtoYXZlUGF5LmFkZChkKTsKICAgICBzdC5kYXlzKys7c3QucmFjZXMrPXIucmFjZXM7Y29uc2VjPTA7CiAgICB9Y2F0Y2goZSl7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9fQogICAgYXdhaXQgc2xlZXAoNDAwKTsKICAgfQogICBpZihtb250aE9rJiZtb250aDxjdXJNb250aClhd2FpdCBtZXRhUHV0KCJtb250aDoiK21vbnRoLHRydWUpOwogIH0KIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goU3RyaW5nKGUubWVzc2FnZXx8ZSkpfQogZmluYWxseXsKICBTWU5DSU5HPWZhbHNlO1NUT1JFPW51bGw7U1RPUkVfS0VZPSIiOyQoInN5bmNHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICAkKCJzeW5jU3RhdHVzIikuaW5uZXJIVE1MPWAke3N0LnN0b3BwZWQ/IumAo+e2muOBl+OBpuWkseaVl+OBl+OBn+OBn+OCgeS4reaWreOBl+OBvuOBl+OBn++8iENsb3VkZmxhcmXlgbTjga7mt7fpm5Hjg7vliLbpmZDjga7lj6/og73mgKfvvInjgILlsJHjgZfmmYLplpPjgpLjgYrjgYTjgabjgoLjgYbkuIDluqbmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJcbiI6IiJ9JHtTU1RPUCYmIXN0LnN0b3BwZWQ/IuWBnOatouOBl+OBvuOBl+OBn+OAgiI6KHN0LnN0b3BwZWQ/IiI6IuWujOS6huOAgiIpfeS7iuWbnuOBruWPluW+l++8miR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yI5L+d5a2Y5riI44G/44Gn44K544Kt44OD44OXICR7c3Quc2tpcHBlZH3ml6XvvIlgKyhzdC5mYWlsLmxlbmd0aD9gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIifVxu77yI44KC44GG5LiA5bqm5oq844GZ44Go44CB5aSx5pWX44GX44Gf5pel44Gg44GR44KE44KK55u044GX44G+44GZ77yJPC9zcGFuPmA6IiIpOwogIGF3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKTsKIH0KfTsKCgovKiAtLS0g5omV5oi744Gu5pu444GN5Ye644GX44O76Kqt44G/6L6844G/IC0tLSAqLwokKCJwYXlFeHAiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpcmV0dXJuIGFsZXJ0KCLmiZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgIIiKTsKIGNvbnN0IGE9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiYSIpO2EuaHJlZj1VUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtKU09OLnN0cmluZ2lmeShwcyldLHt0eXBlOiJhcHBsaWNhdGlvbi9qc29uIn0pKTsKIGEuZG93bmxvYWQ9YGtlaWJhX3BheW91dHNfJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCl9Lmpzb25gO2EuY2xpY2soKTtzZXRUaW1lb3V0KCgpPT5VUkwucmV2b2tlT2JqZWN0VVJMKGEuaHJlZiksMTAwMCl9OwokKCJwYXlJbXAiKS5vbmNoYW5nZT1hc3luYyBlPT57CiBjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKCFmKXJldHVybjsKIHRyeXtjb25zdCBqPUpTT04ucGFyc2UoYXdhaXQgZi50ZXh0KCkpO2NvbnN0IGFycj1BcnJheS5pc0FycmF5KGopP2o6KGoucmFjZXM/W2pdOltdKTsKICBjb25zdCBieURhdGU9bmV3IE1hcCgpOwogIGZvcihjb25zdCB4IG9mIGFycil7aWYoeCYmQXJyYXkuaXNBcnJheSh4LnJhY2VzKSYmeC5kYXRlKWJ5RGF0ZS5zZXQoeC5kYXRlLHtkYXRlOnguZGF0ZSxyYWNlczp4LnJhY2VzLGZhaWxlZDp4LmZhaWxlZHx8MH0pfQogIGZvcihjb25zdFtkLHJdb2YgYnlEYXRlKWF3YWl0IHBheVB1dChkLHIpOwogIGF3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKTsKIH1jYXRjaChlcnIpeyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+6Kqt44G/6L6844G/44Ko44Op44O877yaJHtlc2MoZXJyLm1lc3NhZ2UpfTwvc3Bhbj5gfQogZS50YXJnZXQudmFsdWU9IiI7Cn07CgoKLyogLS0tIOKRoC0yIOikh+WLneWbnuWPjueOh+OBruaknOiovCAtLS0gKi8KJCgiYnRSdW4iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiOwogIGNvbnN0IHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3Qgc3BsaXQ9cGRhdGVzW01hdGguZmxvb3IocGRhdGVzLmxlbmd0aC8yKV07CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKICBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiAgYnVzeSh0cnVlLCLjg5Djg4Pjgq/jg4bjgrnjg4jkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0PVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkR9KTsKICBidXN5KHRydWUsIuOCquODg+OCuuacquWFpeWKm+OBruWgtOWQiOOCkuaknOiovOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvdXRQPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkQscHJveHk6dHJ1ZX0pO2J1c3koZmFsc2UpO3RyeXtzZXRHYXRlKG91dCxvdXRQKX1jYXRjaChlKXtjb25zb2xlLmVycm9yKGUpfQogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgre+8iOWfuua6lu+8iSIsdmFsdWU6IuWmmeWRszEuM+WAjeS7peS4iiIsYXhpczoi6YmE5p2/6Lu477yIMC45MuS7peS4iuODu+OCquODg+OCuuaZgu+8iSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX08L3NwYW4+YDoiLSI7CiAgY29uc3QgdGJsPShvLHRpdGxlKT0+ewogICBsZXQgdD1gPGI+JHt0aXRsZX08L2I+PGRpdiBjbGFzcz0ic21hbGwiPuWvvuixoSAke28ucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+6LK344GE5pa5PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjx0aD7lrabnv5Llvow8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IHY9by5zdGF0c1trXTtpZighdi5hbGwuYmV0cyljb250aW51ZTsKICAgIHQrPWA8dHI+PHRkPiR7TFtrXX08L3RkPjx0ZD48L3RkPjx0ZD4ke3YuYWxsLmJldHMudG9Mb2NhbGVTdHJpbmcoKX08L3RkPjx0ZD4keyh2LmFsbC5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+PGI+JHtjKHYuYWxsKX08L2I+PC90ZD48dGQ+JHt2LkEuYmV0cz9wY3Qodi5BLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5CLmJldHM/cGN0KHYuQi5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQy5iZXRzP2Ake3BjdCh2LkMucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsodi5DLnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3YuQy5iZXRzLnRvTG9jYWxlU3RyaW5nKCl977yJPC9zcGFuPmA6Ii0ifTwvdGQ+PC90cj5gfQogICByZXR1cm4gdCsiPC90Ym9keT48L3RhYmxlPiJ9OwogIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+JHtzdGFydH3jgJzvvI/liY3ljYrvvJ0ke3NwbGl0feOCiOOCiuWJjeOAgeW+jOWNiu+8neS7pemZje+8j+WQhDEwMOWGhjwvZGl2Pjxicj5gK3RibChvdXQsIuKRoCDjgqrjg4PjgrrlhaXlipvmmYLvvIjlrp/pmpvjga7kurrmsJfjgafnqbTjgr7jg7zjg7PjgpLliKTlrprvvIkiKSsiPGJyPiIrdGJsKG91dFAsIuKRoSDjgqrjg4PjgrrmnKrlhaXlipvmmYLvvIjjg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIkiKTsKICAvLyDmnaHku7bliKXvvIjjg4Tjg7zjg6sx5L2N44Gu5Zue5Y+O546H77yJCiAgY29uc3Qgc2VnUm93cz1PYmplY3QuZW50cmllcyhvdXQuc2VncykuZmlsdGVyKChbLHZdKT0+di5hbGwuYmV0cz49MzAwKS5zb3J0KChhLGIpPT5hWzBdPGJbMF0/LTE6MSk7CiAgaWYoc2VnUm93cy5sZW5ndGgpe2grPWA8YnI+PGI+4pGiIOODhOODvOODqzHkvY3jga7mnaHku7bliKXvvIjikaDjga7loLTlkIjvvIk8L2I+PGRpdiBjbGFzcz0ic21hbGwiPuizvOWFpTMwMOWbnuS7peS4iuOBruadoeS7tuOBruOBv+OAguWJjeWNiuODu+W+jOWNiuOBruS4oeaWueOBp+WQjOOBmOWQkeOBjeOBi+OCkuimi+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7mnaHku7Y8L3RoPjx0aD48L3RoPjx0aD7os7zlhaXmlbA8L3RoPjx0aD7nmoTkuK3njoc8L3RoPjx0aD7lm57lj47njocoOTUl5bmFKTwvdGg+PHRoPuWJjeWNijwvdGg+PHRoPuW+jOWNijwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgW2ssdl0gb2Ygc2VnUm93cyloKz1gPHRyPjx0ZD4ke2VzYyhrKX08L3RkPjx0ZD48L3RkPjx0ZD4ke3YuYWxsLmJldHMudG9Mb2NhbGVTdHJpbmcoKX08L3RkPjx0ZD4keyh2LmFsbC5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+PGI+JHtjKHYuYWxsKX08L2I+PC90ZD48dGQ+JHt2LkEuYmV0cz9wY3Qodi5BLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5CLmJldHM/cGN0KHYuQi5yb2kpOiItIn08L3RkPjwvdHI+YDsKICAgaCs9IjwvdGJvZHk+PC90YWJsZT4ifQogIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+PGJyPuimi+aWue+8muOAjOWtpue/kuW+jOOAjeOBr+OAgeODouODh+ODq+OBruWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iCR7TU9ERUxfVFJBSU5fRU5EfeS7pemZje+8ieOBp+OAgeacgOOCguS/oemgvOOBp+OBjeOCi+WIl+OBp+OBmeOAguOBneOCjOS7peWJjeOBruacn+mWk+OBr+OAgeODouODh+ODq+OBjOetlOOBiOOCkuimi+OBpuOBhOOCi+OBn+OCgeOAgeOChOOChOiJr+OBj+WHuuOBvuOBmeOAguWbnuWPjueOh+OBruOAjMKx44CN44GvOTUl44Gu6Kqk5beu44Gu5bmF44Gn44CBMTAwJeOCkuS4i+WbnuOCi+S4i+mZkOOBquOCieWIqeebiuOBqOOBr+iogOOBiOOBvuOBm+OCk+OAguadoeS7tuWIpeOBr+OAgeaOouOBmeOBu+OBqeWBtueEtuOBrumrmOOBhOadoeS7tuOCkuaLvuOBhOOChOOBmeOBhOOBruOBp+OAgeWJjeWNiuODu+W+jOWNiuOBruS4oeaWueOBp+WQjOOBmOWQkeOBjeOBruOCguOBruOBoOOBkeOCkuWPguiAg+OBq+OBl+OBpuOBj+OBoOOBleOBhOOAguWmmeWRs++8iOW4guWgtOOBqOOBruW3ru+8ieOBr+OAgeaknOiovOOBp+Wfuua6luOCiOOCiuaCquOBi+OBo+OBn+OBn+OCgeOAgeWIpOaWreOBq+OBr+S9v+OCj+OBquOBhOOBp+OBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aDsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn07CgovKiAtLS0g4pGgLTMg44Kw44Os44O844OJ6KOc5q2j44Gu5Yq55p6c5q+U6LyD77yI6YeN6LOe44Gu44G/44O75ZCM44GY6YGO5Y6744OH44O844K/44Gn6KOc5q2j44GC44KKL+OBquOBl++8iSAtLS0gKi8KJCgiYnRHcmFkZSIpLm9uY2xpY2s9YXN5bmMoKT0+ewogdHJ5ewogIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CC5YWI44Gr4pGg44Gn5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHBheUJ5SWQ9e307cHMuZm9yRWFjaChwPT4ocC5yYWNlc3x8W10pLmZvckVhY2goeD0+e3BheUJ5SWRbeC5yYWNlSWRdPXh9KSk7CiAgY29uc3Qgc3RhcnQ9JCgiYnRTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSIscGRhdGVzPXBzLm1hcChwPT5wLmRhdGUpLmZpbHRlcihkPT5kPj1zdGFydCkuc29ydCgpOwogIGlmKCFwZGF0ZXMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumWi+Wni+aXpeS7pemZjeOBruaJleaIu+OBjOOBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj4nO3JldHVybn0KICBidXN5KHRydWUsIuaIkOe4vuOCkuiqreOBv+i+vOOBv+S4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBtYXA9bmV3IE1hcCgpO2xldCBncmFkZWQ9MDsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKICBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiAgcmFjZXMuZm9yRWFjaCh4PT57aWYoKHgucm93c1swXS5ncmR8fDApPj0yKWdyYWRlZCsrfSk7CiAgaWYoIWdyYWRlZCl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7pgY7ljrvjg4fjg7zjgr/jga7kuK3jgavjgIFHMeOAnEcz44Go5Yik5Yil44Gn44GN44KL44Os44O844K544GM44GC44KK44G+44Gb44KT77yI44Kv44Op44K56KGo6KiY44O7MeedgOiznumHkeOBjOeEoeOBhO+8ieOAguOCsOODrOODvOODieijnOato+OBruWKueaenOOBr+aknOiovOOBp+OBjeOBvuOBm+OCk+OAguKRpOOBruWun+ihjOaZguOBr+ODrOODvOOCueWQjeODu+WHuummrOihqOOBruOCsOODrOODvOODieihqOiomOOBp+ijnOato+OBleOCjOOBvuOBmeOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBiYXNlPXtzdGFydCxzcGxpdDoiIixvb3M6TU9ERUxfVFJBSU5fRU5ELG1pbkdyZDoyfTsKICBidXN5KHRydWUsIuijnOato+OBguOCii/jgarjgZfjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb249VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCxiYXNlKSxvZmY9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7Li4uYmFzZSxncmFkZU9mZjp0cnVlfSk7YnVzeShmYWxzZSk7CiAgY29uc3QgTD17dG9wMToi44OE44O844OrMeS9jSIsdG9wMjoi5LiK5L2NMumgrSIsdG9wMzoi5LiK5L2NM+mgrSIsYWxsSG9sZToi56m044K+44O844Oz5YWo6aCtIixmb2N1czoi4peO55qE5Lit546H6YeN6KaW44GuMeS9jSJ9OwogIGNvbnN0IHBjdD14PT4oeCoxMDApLnRvRml4ZWQoMCkrIiUiLGM9eD0+eCYmeC5iZXRzP2Ake3BjdCh4LnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHguc2UqMTk2KS50b0ZpeGVkKDApfe+8iCR7eC5iZXRzfe+8iTwvc3Bhbj5gOiItIjsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPuWvvuixoe+8mumHjeiznu+8iEcx44CcRzPvvIkke29uLnJhY2VzfeODrOODvOOCueOAguWQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+OAgeijnOato+OBguOCii/jgarjgZfjga7nmoTkuK3njofjg7vlm57lj47njocoOTUl5bmFKeOCkuavlOi8g+OBl+OBpuOBhOOBvuOBmeOAguS7tuaVsOOBjOWwkeOBquOBhOOBqOW3ruOBr+WBtueEtuOBruevhOWbsuOBp+OBme+8iOWbnuWPjueOh+OBrsKx5bmF44GM6YeN44Gq44KL44Gq44KJ5beu44Gv5Yik5pat44Gn44GN44G+44Gb44KT77yJ44CCPC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPueahOS4reeOhyDjgYLjgoo8L3RoPjx0aD7nmoTkuK3njocg44Gq44GXPC90aD48dGg+5Zue5Y+O546HIOOBguOCijwvdGg+PHRoPuWbnuWPjueOhyDjgarjgZc8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhMKSl7Y29uc3QgYT1vbi5zdGF0c1trXS5hbGwsYj1vZmYuc3RhdHNba10uYWxsO2lmKCFhfHwhYS5iZXRzKWNvbnRpbnVlOwogICBoKz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHsoYS5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+JHtiJiZiLmJldHM/KGIuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSkrIiUiOiItIn08L3RkPjx0ZD48Yj4ke2MoYSl9PC9iPjwvdGQ+PHRkPiR7YyhiKX08L3RkPjwvdHI+YH0KICAkKCJidE91dCIpLmlubmVySFRNTD1oKyI8L3Rib2R5PjwvdGFibGU+IjsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn07CgoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOiHquWLleODkOODg+OCr+OCouODg+ODl++8iENsb3VkZmxhcmUgS1bvvIkKICog44O744OH44O844K/44GM5aSJ44KP44Gj44Gf44Kw44Or44O844OX77yIY3N2LeW5tO+8j2xpdmUt5bm05pyI77yPcGF5LeW5tOaciO+8j21ldGHvvInjgaDjgZHjgpLjgIFnemlw44GX44Gm6YCB44KLCiAqIOODu+S/neWtmOWFiOOBruitmOWIpeOBr+OAgeODkeOCueODleODrOODvOOCuuOBrlNIQS0yNTbvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgZ3jga7jgoLjga7jga/pgIHjgonjgarjgYTvvIkKICog44O75b6p5YWD44Gv44CB5ZCM44GY44OR44K544OV44Os44O844K644Gn44CC5ZCM44GY44Kt44O844Gu44OH44O844K/44Gv5LiK5pu444GN44GV44KM44KLCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgQks9e3Bhc3M6IiIsYXV0bzp0cnVlLGRpcnR5Om5ldyBTZXQoKSxidXN5OmZhbHNlLGlkOiIiLHNhdmVUOm51bGwscnVuVDpudWxsLGluZm86bnVsbCxtc2c6IiIsZXJyOmZhbHNlfTsKY29uc3QgcmF3TWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgcmF3UHV0TWFueT1yZWNzPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgc3Q9Wy4uLm5ldyBTZXQocmVjcy5tYXAocj0+ci5zKSldO2lmKCFzdC5sZW5ndGgpcmV0dXJuIG9rKCk7Y29uc3QgdD1EQi50cmFuc2FjdGlvbihzdCwicmVhZHdyaXRlIik7Zm9yKGNvbnN0IHIgb2YgcmVjcyl0Lm9iamVjdFN0b3JlKHIucykucHV0KHIudixyLmspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYlJhbmdlPShzdG9yZSxyYW5nZSk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBvdXQ9W107Y29uc3QgcT1EQi50cmFuc2FjdGlvbihzdG9yZSkub2JqZWN0U3RvcmUoc3RvcmUpLm9wZW5DdXJzb3IocmFuZ2UpO3Eub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtvdXQucHVzaCh7czpzdG9yZSxrOmMua2V5LHY6Yy52YWx1ZX0pO2MuY29udGludWUoKX1lbHNlIG9rKG91dCl9O3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgaWRiS2V5cz1zdG9yZT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5nZXRBbGxLZXlzKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpmdW5jdGlvbiBncm91cE9mKHN0b3JlLGtleSl7CiBrZXk9U3RyaW5nKGtleSk7CiBpZihzdG9yZT09PSJmaWxlcyIpe2lmKGtleS5zdGFydHNXaXRoKCJsaXZlOiIpKXJldHVybiAibGl2ZS0iK2tleS5zbGljZSg1LDEyKTtjb25zdCB5PWtleS5zcGxpdCgiOiIpWzBdO3JldHVybiAvXigwfDIwXGRcZCkkLy50ZXN0KHkpPyJjc3YtIit5OiJjc3YtMCJ9CiBpZihzdG9yZT09PSJwYXkiKXJldHVybiAicGF5LSIra2V5LnNsaWNlKDAsNyk7CiByZXR1cm4gIm1ldGEiOwp9CmZ1bmN0aW9uIG1hcmtEaXJ0eShzdG9yZSxrZXkpewogaWYoc3RvcmU9PT0ibWV0YSImJihrZXk9PT0iZGlydHkifHxrZXk9PT0iYmFja3VwIikpcmV0dXJuOwogQksuZGlydHkuYWRkKGdyb3VwT2Yoc3RvcmUsa2V5KSk7CiBjbGVhclRpbWVvdXQoQksuc2F2ZVQpO0JLLnNhdmVUPXNldFRpbWVvdXQoKCk9PntyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTtia1JlbmRlcigpfSw4MDApOwp9CmFzeW5jIGZ1bmN0aW9uIHJlYWRHcm91cChuYW1lKXsKIGxldCBtOwogaWYobmFtZT09PSJtZXRhIilyZXR1cm4oYXdhaXQgaWRiUmFuZ2UoIm1ldGEiKSkuZmlsdGVyKHI9PnIuayE9PSJkaXJ0eSImJnIuayE9PSJiYWNrdXAiKTsKIGlmKG09bmFtZS5tYXRjaCgvXmNzdi0oXGQrKSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfTpgLGAke21bMV19O2ApKTsKIGlmKG09bmFtZS5tYXRjaCgvXmxpdmUtKFxkezR9LVxkezJ9KSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgbGl2ZToke21bMV19LTAwYCxgbGl2ZToke21bMV19LTk5YCkpOwogaWYobT1uYW1lLm1hdGNoKC9ecGF5LShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJwYXkiLElEQktleVJhbmdlLmJvdW5kKGAke21bMV19LTAwYCxgJHttWzFdfS05OWApKTsKIHJldHVybltdOwp9CmFzeW5jIGZ1bmN0aW9uIGFsbEdyb3VwcygpewogY29uc3QgZz1uZXcgU2V0KCk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJmaWxlcyIpKWcuYWRkKGdyb3VwT2YoImZpbGVzIixrKSk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJwYXkiKSlnLmFkZChncm91cE9mKCJwYXkiLGspKTsKIGlmKChhd2FpdCBpZGJLZXlzKCJtZXRhIikpLnNvbWUoaz0+ayE9PSJkaXJ0eSImJmshPT0iYmFja3VwIikpZy5hZGQoIm1ldGEiKTsKIHJldHVyblsuLi5nXTsKfQphc3luYyBmdW5jdGlvbiBneihzdHIpewogY29uc3QgcmF3PW5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzdHIpOwogaWYodHlwZW9mIENvbXByZXNzaW9uU3RyZWFtPT09InVuZGVmaW5lZCIpcmV0dXJue2J1ZjpyYXcsZW5jOiJyYXcifTsKIGNvbnN0IGNzPW5ldyBDb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9Y3Mud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShyYXcpO3cuY2xvc2UoKTsKIHJldHVybntidWY6bmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKGNzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKSxlbmM6Imd6aXAifTsKfQphc3luYyBmdW5jdGlvbiBndW56aXAoYnVmLGVuYyl7CiBpZihlbmM9PT0icmF3IilyZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ1Zik7CiBjb25zdCBkcz1uZXcgRGVjb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9ZHMud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShidWYpO3cuY2xvc2UoKTsKIHJldHVybiBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYXdhaXQgbmV3IFJlc3BvbnNlKGRzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKTsKfQphc3luYyBmdW5jdGlvbiBia01ha2VJZCgpewogaWYoISh3aW5kb3cuY3J5cHRvJiZjcnlwdG8uc3VidGxlKSl0aHJvdyBuZXcgRXJyb3IoIuOBk+OBrueSsOWig+OBp+OBr+S9v+OBiOOBvuOBm+OCk++8iGh0dHBzIOOBp+mWi+OBj+W/heimgeOBjOOBguOCiuOBvuOBme+8iSIpOwogY29uc3QgZD1hd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgiU0hBLTI1NiIsbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKCJrZWliYS11cHNldC1iYWNrdXA6djE6IitCSy5wYXNzKSk7CiByZXR1cm5bLi4ubmV3IFVpbnQ4QXJyYXkoZCldLm1hcChiPT5iLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCIwIikpLmpvaW4oIiIpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrRmV0Y2gocGF0aCxvcHQpewogaWYoIUJLLmlkKUJLLmlkPWF3YWl0IGJrTWFrZUlkKCk7CiByZXR1cm4gZmV0Y2goJCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpK3BhdGgsT2JqZWN0LmFzc2lnbih7fSxvcHQse2hlYWRlcnM6T2JqZWN0LmFzc2lnbih7IngtYmFja3VwLWlkIjpCSy5pZH0sKG9wdCYmb3B0LmhlYWRlcnMpfHx7fSl9KSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtKU09OKHBhdGgsb3B0KXsKIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChwYXRoLG9wdCksdD1hd2FpdCByLnRleHQoKTtsZXQgaj17fTt0cnl7aj1KU09OLnBhcnNlKHQpfWNhdGNoKGUpe30KIGlmKCFyLm9rfHxqLm9rPT09ZmFsc2UpdGhyb3cgbmV3IEVycm9yKGouZXJyb3J8fCgiSFRUUCAiK3Iuc3RhdHVzKSk7cmV0dXJuIGo7Cn0KZnVuY3Rpb24gYmtNc2codCxpc0Vycil7QksubXNnPXR8fCIiO0JLLmVycj0hIWlzRXJyO2JrUmVuZGVyKCl9CmZ1bmN0aW9uIGJrUmVuZGVyKCl7CiBjb25zdCBlbD0kKCJia1N0YXR1cyIpO2lmKCFlbClyZXR1cm47CiBjb25zdCBtPUJLLmluZm8sanN0PW1zPT5uZXcgRGF0ZShtcys5KjM2MDBlMykudG9JU09TdHJpbmcoKS5yZXBsYWNlKCJUIiwiICIpLnNsaWNlKDAsMTYpOwogbGV0IHN1bT0iIjsKIGlmKCFCSy5wYXNzKXN1bT0i44OR44K544OV44Os44O844K644KS6Kit5a6a44GZ44KL44Go44CB6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX44GM5pyJ5Yq544Gr44Gq44KK44G+44GZ44CCIjsKIGVsc2UgaWYobSYmbS5leGlzdHMpe2NvbnN0IGNzPU9iamVjdC52YWx1ZXMobS5jaHVua3N8fHt9KTtzdW09YOacgOe1guODkOODg+OCr+OCouODg+ODl++8miR7anN0KG0udXBkYXRlZEF0KX3vvIgke2NzLmxlbmd0aH3jgrDjg6vjg7zjg5fvvI8keyhjcy5yZWR1Y2UoKHMsYyk9PnMrYy5zaXplLDApLzEwNDg1NzYpLnRvRml4ZWQoMSl9TULvvIlgfQogZWxzZSBzdW09IuODkOODg+OCr+OCouODg+ODl+OBr+OBvuOBoOOBguOCiuOBvuOBm+OCk+OAgiI7CiBpZihCSy5wYXNzKXN1bSs9YO+8j+acqumAgeS/oeOBruWkieabtO+8miR7QksuZGlydHkuc2l6ZX3jgrDjg6vjg7zjg5cke0JLLmF1dG8/Iu+8iOiHquWLleOBp+mAgeOCiuOBvuOBme+8iSI6Iu+8iOiHquWLleODkOODg+OCr+OCouODg+ODl+OBr+OCquODle+8iSJ9YDsKIGVsLmlubmVySFRNTD0oQksubXNnP2A8c3BhbiBjbGFzcz0iJHtCSy5lcnI/Indhcm4iOiJnb29kIn0iPiR7ZXNjKEJLLm1zZyl9PC9zcGFuPlxuYDoiIikrZXNjKHN1bSk7Cn0KZnVuY3Rpb24gYmtOZWVkUGFzcygpe2lmKCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXtia01zZygi44OR44K544OV44Os44O844K644KSOOaWh+Wtl+S7peS4iuOBp+WFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAgiIsdHJ1ZSk7cmV0dXJuIHRydWV9cmV0dXJuIGZhbHNlfQphc3luYyBmdW5jdGlvbiBia1JlZnJlc2gobWFuKXsKIHRyeXtCSy5pbmZvPW1hbnx8YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iil9Y2F0Y2goZSl7QksuaW5mbz1udWxsO2lmKCFCSy5tc2cpYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeOBp+OBjeOBvuOBm+OCk++8miIrZS5tZXNzYWdlLHRydWUpfQogYmtSZW5kZXIoKTsKfQphc3luYyBmdW5jdGlvbiBydW5CYWNrdXAoZnVsbCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlO2NvbnN0IGluZmxpZ2h0PW5ldyBTZXQoQksuZGlydHkpO0JLLmRpcnR5LmNsZWFyKCk7CiB0cnl7CiAgYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IG1hbj1hd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiKSxoYXZlPW1hbi5leGlzdHM/KG1hbi5jaHVua3N8fHt9KTp7fTsKICBjb25zdCBuYW1lcz0oZnVsbHx8IW1hbi5leGlzdHMpP2F3YWl0IGFsbEdyb3VwcygpOlsuLi5pbmZsaWdodF07CiAgaWYoIW5hbWVzLmxlbmd0aCl7YmtNc2coIuWkieabtOOBr+OBguOCiuOBvuOBm+OCk+OAgiIpO2F3YWl0IGJrUmVmcmVzaChtYW4pO3JldHVybn0KICBjb25zdCBjaHVua3M9T2JqZWN0LmFzc2lnbih7fSxoYXZlKTtsZXQgc2VudD0wLGJ5dGVzPTA7CiAgZm9yKGxldCBpPTA7aTxuYW1lcy5sZW5ndGg7aSsrKXsKICAgY29uc3QgbmFtZT1uYW1lc1tpXTtia01zZyhg44OQ44OD44Kv44Ki44OD44OX5Lit4oCmICR7aSsxfS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHJlY3M9YXdhaXQgcmVhZEdyb3VwKG5hbWUpOwogICBpZighcmVjcy5sZW5ndGgpe2lmKGNodW5rc1tuYW1lXSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3NbbmFtZV19Y29udGludWV9CiAgIGNvbnN0IHJhdz1KU09OLnN0cmluZ2lmeSh7ZzpuYW1lLHJlY3N9KSx7YnVmLGVuY309YXdhaXQgZ3oocmF3KTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCx7bWV0aG9kOiJQVVQiLGJvZHk6YnVmfSk7CiAgIGlmKCFyLm9rKXtsZXQgZT0iIjt0cnl7ZT0oYXdhaXQgci5qc29uKCkpLmVycm9yfWNhdGNoKF8pe310aHJvdyBuZXcgRXJyb3IoZXx8KCJIVFRQICIrci5zdGF0dXMpKX0KICAgY2h1bmtzW25hbWVdPXtzaXplOmJ1Zi5ieXRlTGVuZ3RoLHJhd1NpemU6cmF3Lmxlbmd0aCxuOnJlY3MubGVuZ3RoLGVuYyxhdDpEYXRlLm5vdygpfTtzZW50Kys7Ynl0ZXMrPWJ1Zi5ieXRlTGVuZ3RoOwogIH0KICBpZihmdWxsfHwhbWFuLmV4aXN0cyl7Zm9yKGNvbnN0IG4gb2YgT2JqZWN0LmtleXMoaGF2ZSkpaWYoIW5hbWVzLmluY2x1ZGVzKG4pKXthd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobil9YCx7bWV0aG9kOiJERUxFVEUifSk7ZGVsZXRlIGNodW5rc1tuXX19CiAgY29uc3QgbWFuaWZlc3Q9e3Y6MSx1cGRhdGVkQXQ6RGF0ZS5ub3coKSxjaHVua3N9OwogIGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIse21ldGhvZDoiUFVUIixib2R5OkpTT04uc3RyaW5naWZ5KG1hbmlmZXN0KSxoZWFkZXJzOnsiY29udGVudC10eXBlIjoiYXBwbGljYXRpb24vanNvbiJ9fSk7CiAgbWFuaWZlc3QuZXhpc3RzPXRydWU7YXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbmlmZXN0LnVwZGF0ZWRBdH0pOwogIEJLLmluZm89bWFuaWZlc3Q7YmtNc2coYOODkOODg+OCr+OCouODg+ODl+WujOS6hu+8miR7c2VudH3jgrDjg6vjg7zjg5fjgpLpgIHkv6HvvIgkeyhieXRlcy8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYCk7CiB9Y2F0Y2goZSl7CiAgZm9yKGNvbnN0IG4gb2YgaW5mbGlnaHQpQksuZGlydHkuYWRkKG4pO3Jhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKS5jYXRjaCgoKT0+e30pOwogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgavlpLHmlZfjgZfjgb7jgZfjgZ/vvJoiK2UubWVzc2FnZSx0cnVlKTsKIH1maW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQphc3luYyBmdW5jdGlvbiBydW5SZXN0b3JlKCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iik7CiAgaWYoIW1hbi5leGlzdHMpe2JrTXNnKCLjgZPjga7jg5Hjgrnjg5Xjg6zjg7zjgrrjga7jg5Djg4Pjgq/jgqLjg4Pjg5fjga/opovjgaTjgYvjgorjgb7jgZvjgpPvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgpLnorroqo3jgZfjgabjgY/jgaDjgZXjgYTvvInjgIIiLHRydWUpO3JldHVybn0KICBjb25zdCBuYW1lcz1PYmplY3Qua2V5cyhtYW4uY2h1bmtzfHx7fSk7bGV0IG49MCxjbnQ9MDsKICBmb3IoY29uc3QgbmFtZSBvZiBuYW1lcyl7CiAgIGJrTXNnKGDlvqnlhYPkuK3igKYgJHsrK259LyR7bmFtZXMubGVuZ3Rofe+8iCR7bmFtZX3vvIlgKTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCk7CiAgIGlmKCFyLm9rKXRocm93IG5ldyBFcnJvcihgJHtuYW1lfSDjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPvvIhIVFRQICR7ci5zdGF0dXN977yJYCk7CiAgIGNvbnN0IG89SlNPTi5wYXJzZShhd2FpdCBndW56aXAobmV3IFVpbnQ4QXJyYXkoYXdhaXQgci5hcnJheUJ1ZmZlcigpKSxtYW4uY2h1bmtzW25hbWVdLmVuY3x8Imd6aXAiKSk7CiAgIGF3YWl0IHJhd1B1dE1hbnkoby5yZWNzKTtjbnQrPW8ucmVjcy5sZW5ndGg7CiAgfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiO0JBQ0tVUF9EQVRFUz1udWxsO0JLLmRpcnR5LmNsZWFyKCk7CiAgYXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFtdKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW4udXBkYXRlZEF0fSk7CiAgYXdhaXQgc2hvd1N0YXRlKCk7QksuaW5mbz1tYW47YmtNc2coYOW+qeWFg+WujOS6hu+8miR7bmFtZXMubGVuZ3RofeOCsOODq+ODvOODl++8jyR7Y250LnRvTG9jYWxlU3RyaW5nKCl95Lu2YCk7CiB9Y2F0Y2goZSl7YmtNc2coIuW+qeWFg+OBq+WkseaVl+OBl+OBvuOBl+OBn++8miIrZS5tZXNzYWdlLHRydWUpfQogZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KZnVuY3Rpb24gYmtTY2hlZHVsZShtcyl7CiBpZighQksuYXV0b3x8IUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpcmV0dXJuOwogY2xlYXJUaW1lb3V0KEJLLnJ1blQpO0JLLnJ1blQ9c2V0VGltZW91dCgoKT0+e2lmKCFTWU5DSU5HKXJ1bkJhY2t1cChmYWxzZSk7ZWxzZSBia1NjaGVkdWxlKDMwMDAwKX0sbXN8fDMwMDApOwp9CmZ1bmN0aW9uIGJrU2F2ZVNldHRpbmdzKCl7dHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKCJ1cHNldF9iayIsSlNPTi5zdHJpbmdpZnkoe3Bhc3M6QksucGFzcyxhdXRvOkJLLmF1dG99KSl9Y2F0Y2goZSl7fX0KYXN5bmMgZnVuY3Rpb24gYmtJbml0KCl7CiB0cnl7Y29uc3Qgbz1KU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKCJ1cHNldF9iayIpfHwie30iKTtCSy5wYXNzPW8ucGFzc3x8IiI7QksuYXV0bz1vLmF1dG8hPT1mYWxzZX1jYXRjaChlKXt9CiAkKCJia1Bhc3MiKS52YWx1ZT1CSy5wYXNzOyQoImJrQXV0byIpLmNoZWNrZWQ9QksuYXV0bzsKICQoImJrUGFzcyIpLm9uY2hhbmdlPSgpPT57QksucGFzcz0kKCJia1Bhc3MiKS52YWx1ZS50cmltKCk7QksuaWQ9IiI7QksuaW5mbz1udWxsO0JLLm1zZz0iIjtia1NhdmVTZXR0aW5ncygpO2lmKEJLLnBhc3MubGVuZ3RoPj04KWJrUmVmcmVzaCgpO2Vsc2UgYmtSZW5kZXIoKX07CiAkKCJia1Nob3ciKS5vbmNsaWNrPSgpPT57Y29uc3QgcD0kKCJia1Bhc3MiKTtwLnR5cGU9cC50eXBlPT09InBhc3N3b3JkIj8idGV4dCI6InBhc3N3b3JkIjskKCJia1Nob3ciKS50ZXh0Q29udGVudD1wLnR5cGU9PT0icGFzc3dvcmQiPyLooajnpLoiOiLpmqDjgZkifTsKICQoImJrQXV0byIpLm9uY2hhbmdlPSgpPT57QksuYXV0bz0kKCJia0F1dG8iKS5jaGVja2VkO2JrU2F2ZVNldHRpbmdzKCk7YmtSZW5kZXIoKTtpZihCSy5hdXRvKWJrU2NoZWR1bGUoMjAwMCl9OwogJCgiYmtOb3ciKS5vbmNsaWNrPSgpPT5ydW5CYWNrdXAoZmFsc2UpOwogJCgiYmtGdWxsIikub25jbGljaz0oKT0+e2lmKGNvbmZpcm0oIuOBmeOBueOBpuOBruODh+ODvOOCv+OCkuOAgeOBguOCieOBn+OCgeOBpuS/neWtmOOBl+ebtOOBl+OBvuOBmeOAguOCiOOCjeOBl+OBhOOBp+OBmeOBi++8nyIpKXJ1bkJhY2t1cCh0cnVlKX07CiAkKCJia1Jlc3RvcmUiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GT44Gu56uv5pyr44Gu44OH44O844K/44KS44CB44OQ44OD44Kv44Ki44OD44OX44Gu5YaF5a6544Gn5LiK5pu444GN44GX44G+44GZ77yI44OQ44OD44Kv44Ki44OD44OX44Gr44GC44KL44OH44O844K/44Gg44GR44GM5a++6LGh44Gn44GZ77yJ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuUmVzdG9yZSgpfTsKIHRyeXtjb25zdCBkPWF3YWl0IG1ldGFHZXQoImRpcnR5Iik7aWYoQXJyYXkuaXNBcnJheShkKSlkLmZvckVhY2goeD0+QksuZGlydHkuYWRkKHgpKX1jYXRjaChlKXt9CiB0cnl7aWYobmF2aWdhdG9yLnN0b3JhZ2UmJm5hdmlnYXRvci5zdG9yYWdlLnBlcnNpc3QpbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCgpLmNhdGNoKCgpPT57fSl9Y2F0Y2goZSl7fQogYmtSZW5kZXIoKTsKIGlmKEJLLnBhc3MubGVuZ3RoPj04KXthd2FpdCBia1JlZnJlc2goKTtpZihCSy5kaXJ0eS5zaXplKWJrU2NoZWR1bGUoNTAwMCl9CiBzZXRJbnRlcnZhbCgoKT0+e2lmKEJLLmF1dG8mJkJLLnBhc3MubGVuZ3RoPj04JiZCSy5kaXJ0eS5zaXplJiYhQksuYnVzeSYmIVNZTkNJTkcpcnVuQmFja3VwKGZhbHNlKX0sd2luZG93Ll9fQktfVElDS3x8OTAwMDAwKTsKfQoKCgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5rOi5Lmx5bqm44Gu5YaN5qCh5q2jCiAqICDnm67nmoTvvJrms6LkubHluqbjga7jgIzlvZPjgZ/jgormlrnjgI3jgpLjgIHoh6rliIbjga7pgY7ljrvjg4fjg7zjgr/jgafnorrjgYvjgoHjgIHkv6HpoLzjgafjgY3jgovmlbDlrZfjgaDjgZHjgpLlh7rjgZnjgIIKICogIOOChOOCi+OBk+OBqO+8mgogKiAgIDEpIOmBjuWOu+OBruODrOODvOOCueOCkuaZguezu+WIl+OBqzHjgaTjgZrjgaTlho3nj77jgZfjgIHjg6zjg7zjgrnliY3jgavliIbjgYvjgovmg4XloLHjgaDjgZHjgafms6LkubHluqbjgpLoqIjnrpcKICogICAyKSDnj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIhNT0RFTF9UUkFJTl9FTkTku6XpmY3vvInjgafjgIHlrp/pmpvjga7ms6LkubHnjofjgajnqoHjgY3lkIjjgo/jgZvjgosKICogICAzKSDjgrPjg7zjgrnliKXjga7pgY7ljrvms6LkubHnjofvvIjplovlgqzloLTDl+iKneODgMOX6Led6Zuiw5fjgq/jg6njgrnvvInjgarjganjgpLotrPjgZfjgZ/mlrDjg6Ljg4fjg6vjgpLkvZzjgorjgIHlkIzjgZjmnJ/plpPjgafmr5TovIMKICogICA0KSDlr77mlbDmkI3lpLHjgYzmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgajjgY3jgaDjgZHmjqHnlKjjgILjgZ3jgYbjgafjgarjgZHjgozjgbDnj77ooYzjga7jgb7jgb7jgavjgZfjgabjgIHlrp/nuL7njofjgaDjgZHmpJzoqLzlgKTjgavlt67jgZfmm7/jgYjjgosKICogIOazouS5se+8nTPnnYDku6XlhoXjga7ppqzjga7kurrmsJfjga7lkIjoqIjjgYzplr7lgKQo54++6KGM44Oi44OH44Or44Go5ZCM44GYMTUp5Lul5LiKCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgVVBLRVk9ImtlaWJhX3Vwc2V0X3YxIjsKY29uc3Qgc2lnbT16PT4xLygxK01hdGguZXhwKC16KSksbGd0PXA9PntwPU1hdGgubWluKC45OTksTWF0aC5tYXgoLjAwMSxwKSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKZnVuY3Rpb24gd2lsc29uKGssbil7aWYoIW4pcmV0dXJuWzAsMV07Y29uc3Qgej0xLjk2LHA9ay9uLGQ9MSt6KnovbixjPXAreip6LygyKm4pLGE9eipNYXRoLnNxcnQocCooMS1wKS9uK3oqei8oNCpuKm4pKTtyZXR1cm5bKGMtYSkvZCwoYythKS9kXX0KY29uc3QgZGlzdEI9ZD0+TWF0aC5tYXgoMTAwMCxNYXRoLm1pbigzMjAwLE1hdGgucm91bmQoKGR8fDApLzIwMCkqMjAwKSk7CmNvbnN0IGx2bEc9KGwsZyk9PihsfHwwKSsoZz49Mj8iRyI6IiIpOwoKLyog44Os44O844K544Gu6ZuG6KiI77yI6KGM44KS5YWo6YOo5oyB44Gf44Ga44Gr5riI44KA6Lu944GE5b2i77yJ4oaSIOODrOODvOOCueaDheWgsSAqLwpmdW5jdGlvbiBhZ2dBZGQobWFwLHIpewogaWYoIXIucmFjZUlkfHwhci5ob3JzZXx8ci5maW5pc2g9PW51bGwpcmV0dXJuOwogbGV0IGE9bWFwLmdldChyLnJhY2VJZCk7CiBpZighYSltYXAuc2V0KHIucmFjZUlkLGE9e2lkOlN0cmluZyhyLnJhY2VJZCksZGF0ZTpyLmRhdGUsc3VyZjpyLnN1cmYsZGlzdDpyLmRpc3QsbHZsOnIubHZsfHwwLGdyZDpyLmdyZHx8MCxOOjAsdDpbXX0pOwogYS5OKys7aWYoci5maW5pc2g8PTMmJnIucG9wPjApYS50LnB1c2goW3IuZmluaXNoLHIucG9wXSk7Cn0KZnVuY3Rpb24gYWdnSW5mbyhhKXsKIGlmKCFhfHxhLk48NilyZXR1cm4gbnVsbDsKIGNvbnN0IHY9L15cZHsxMn0kLy50ZXN0KGEuaWQpP2EuaWQuc2xpY2UoNCw2KTooU3RyaW5nKGEuaWQpLnNwbGl0KCItIilbM118fCIiKSxubz0vXlxkezEyfSQvLnRlc3QoYS5pZCk/TnVtYmVyKGEuaWQuc2xpY2UoMTAsMTIpKTooTnVtYmVyKFN0cmluZyhhLmlkKS5zcGxpdCgiLSIpWzRdKXx8MCk7CiBjb25zdCB0PWEudC5zbGljZSgpLnNvcnQoKHgseSk9PnhbMF0teVswXSk7CiBjb25zdCB5PXQubGVuZ3RoPj0zPyh0WzBdWzFdK3RbMV1bMV0rdFsyXVsxXT49VUUuQVhJUy51cHNldC50aHI/MTowKTpudWxsOwogcmV0dXJue2RhdGU6YS5kYXRlLHYsbm8sc3VyZjphLnN1cmYsZGlzdDphLmRpc3QsbHZsOmEubHZsLGdyZDphLmdyZCxOOmEuTix5fTsKfQoKLyog6ISa6LOq77yaMeOCs+ODvOODiuODvOOBruS9jee9ruOBruWJsuWQiO+8iDA95YWI6aCt44CBMT3mnIDlvozmlrnvvInjgILpgJrpgY7poIbkvY3jgaTjgY3jga7miJDnuL7jgYzjgYLjgovppqzjgaDjgZEgKi8KZnVuY3Rpb24gY29ybmVyRnJhYyhjb3JuZXIsTil7CiBpZighQXJyYXkuaXNBcnJheShjb3JuZXIpfHwhY29ybmVyLmxlbmd0aHx8IU58fE48NClyZXR1cm4gbnVsbDsKIHJldHVybiBNYXRoLm1pbigxLE1hdGgubWF4KDAsKGNvcm5lclswXS0xKS8oTi0xKSkpOwp9Ci8qIOODrOODvOOCueOBruODmuODvOOCueeJueW+tOmHj++8muWFiOihjOmmrOOBruWkmuOBleODu+iEmuizquOBruOBsOOCieOBpOOBjeOAguWNiuaVsOS7peS4iuOBrummrOOBq+iEmuizquODh+ODvOOCv+OBjOeEoeOBkeOCjOOBsOWFqOmDqDAgKi8KZnVuY3Rpb24gcGFjZUZlYXQocnVubmVycyxzdG9yZSl7CiBjb25zdCBOPXJ1bm5lcnMubGVuZ3RoO2xldCBrPTAsbGVhZD0wLGZyb250PTAsc3VtPTAsc3VtMj0wOwogZm9yKGNvbnN0IHIgb2YgcnVubmVycyl7CiAgY29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtpZighaCljb250aW51ZTsKICBjb25zdCB2PWgucnVucy5tYXAoeD0+eFs2XSkuZmlsdGVyKHg9PnghPW51bGwmJng+PTApO2lmKHYubGVuZ3RoPDIpY29udGludWU7CiAgY29uc3Qgdz12LnNsaWNlKC01KSxtPXcucmVkdWNlKChhLGIpPT5hK2IsMCkvdy5sZW5ndGg7CiAgaysrO3N1bSs9bTtzdW0yKz1tKm07aWYobTw9LjE1KWxlYWQrKztpZihtPD0uMzApZnJvbnQrKzsKIH0KIGlmKCFOfHxrPE4qLjUpcmV0dXJuWzAsMCwwLDAsMF07CiBjb25zdCBtZWFuPXN1bS9rLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHN1bTIvay1tZWFuKm1lYW4pKTsKIHJldHVybltrL04sbGVhZC9OKjQsZnJvbnQvTioyLG1lYW4tLjUsc2RdOwp9CgovKiDjgrPjg7zjgrnliKXjga7pgY7ljrvms6LkubHnjofvvIjlsJHjgarjgYTjg4fjg7zjgr/jga/lhajkvZPjgbjlr4TjgZvjgovvvIkgKi8KY2xhc3MgVXBQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMuYmFzZT17bjowLHU6MH07dGhpcy5tPW5ldyBNYXAoKX0KIF9rKGkpe3JldHVyblsiViIraS52LCJDIitpLnYrInwiK2kuc3VyZisifCIrZGlzdEIoaS5kaXN0KSwiTCIraS5zdXJmKyJ8IitkaXN0QihpLmRpc3QpKyJ8IitsdmxHKGkubHZsLGkuZ3JkKSwiTiIrKGkubm98fDApXX0KIGFkZChpKXtpZighaXx8aS55PT1udWxsKXJldHVybjt0aGlzLmJhc2UubisrO3RoaXMuYmFzZS51Kz1pLnk7Zm9yKGNvbnN0IGsgb2YgdGhpcy5fayhpKSl7bGV0IHg9dGhpcy5tLmdldChrKTtpZigheCl0aGlzLm0uc2V0KGsseD17bjowLHU6MH0pO3gubisrO3gudSs9aS55fX0KIGZlYXQoaSl7CiAgY29uc3QgYj10aGlzLmJhc2Uubj4yMDA/dGhpcy5iYXNlLnUvdGhpcy5iYXNlLm46LjI4NSxLPTQwOwogIGNvbnN0IHNoPShrLHBhcik9Pntjb25zdCB4PXRoaXMubS5nZXQoayl8fHtuOjAsdTowfTtyZXR1cm4oeC51K0sqcGFyKS8oeC5uK0spfTsKICBjb25zdCBba3Ysa2Msa2wsa25dPXRoaXMuX2soaSkscHY9c2goa3YsYikscGM9c2goa2MscHYpLHBsPXNoKGtsLGIpLHBuPXNoKGtuLGIpLGxiPWxndChiKTsKICByZXR1cm5bbGd0KHB2KS1sYixsZ3QocGMpLWxiLGxndChwbCktbGIsbGd0KHBuKS1sYl07CiB9Cn0KCi8qIOODreOCuOOCueODhuOCo+ODg+OCr+WbnuW4sO+8iOODi+ODpeODvOODiOODs+azleODu0wy5q2j5YmH5YyW44O75qiZ5rqW5YyW77yJICovCmZ1bmN0aW9uIHNvbHZlTGluKEEsYil7CiBjb25zdCBuPWIubGVuZ3RoLE09QS5tYXAoKHIsaSk9PlsuLi5yLGJbaV1dKTsKIGZvcihsZXQgYz0wO2M8bjtjKyspewogIGxldCBwPWM7Zm9yKGxldCByPWMrMTtyPG47cisrKWlmKE1hdGguYWJzKE1bcl1bY10pPk1hdGguYWJzKE1bcF1bY10pKXA9cjsKICBbTVtjXSxNW3BdXT1bTVtwXSxNW2NdXTtjb25zdCBkPU1bY11bY118fDFlLTk7CiAgZm9yKGxldCBrPWM7azw9bjtrKyspTVtjXVtrXS89ZDsKICBmb3IobGV0IHI9MDtyPG47cisrKWlmKHIhPT1jKXtjb25zdCBmPU1bcl1bY107aWYoZilmb3IobGV0IGs9YztrPD1uO2srKylNW3JdW2tdLT1mKk1bY11ba119CiB9CiByZXR1cm4gTS5tYXAocj0+cltuXSk7Cn0KZnVuY3Rpb24gZml0TG9naXQoWCx5LGwyKXsKIGNvbnN0IG49WC5sZW5ndGgsZD1YWzBdLmxlbmd0aCxtdT1BcnJheShkKS5maWxsKDApLHNkPUFycmF5KGQpLmZpbGwoMCk7CiBmb3IoY29uc3QgciBvZiBYKWZvcihsZXQgaj0wO2o8ZDtqKyspbXVbal0rPXJbal0vbjsKIGZvcihjb25zdCByIG9mIFgpZm9yKGxldCBqPTA7ajxkO2orKylzZFtqXSs9KHJbal0tbXVbal0pKioyL247CiBmb3IobGV0IGo9MDtqPGQ7aisrKXtzZFtqXT1NYXRoLnNxcnQoc2Rbal0pO2lmKCEoc2Rbal0+MWUtNikpc2Rbal09MX0gICAvLyDlhajjg6zjg7zjgrnjgaflkIzjgZjlgKTjga7liJfjga/jgIHoqqTlt67jgaflibLjgonjgarjgYQKIGNvbnN0IFo9WC5tYXAocj0+WzEsLi4uci5tYXAoKHYsaik9Pih2LW11W2pdKS9zZFtqXSldKSxEPWQrMSx3PUFycmF5KEQpLmZpbGwoMCk7CiBmb3IobGV0IGl0PTA7aXQ8MzA7aXQrKyl7CiAgY29uc3QgZz1BcnJheShEKS5maWxsKDApLEg9QXJyYXkuZnJvbSh7bGVuZ3RoOkR9LCgpPT5BcnJheShEKS5maWxsKDApKTsKICBmb3IobGV0IGk9MDtpPG47aSsrKXtjb25zdCB6PVpbaV07bGV0IHM9MDtmb3IobGV0IGo9MDtqPEQ7aisrKXMrPXdbal0qeltqXTsKICAgY29uc3QgcD1zaWdtKHMpLGU9cC15W2ldLHE9cCooMS1wKTsKICAgZm9yKGxldCBqPTA7ajxEO2orKyl7Z1tqXSs9ZSp6W2pdO2ZvcihsZXQgaz1qO2s8RDtrKyspSFtqXVtrXSs9cSp6W2pdKnpba119fQogIGZvcihsZXQgaj0xO2o8RDtqKyspe2dbal0rPWwyKndbal07SFtqXVtqXSs9bDJ9CiAgZm9yKGxldCBqPTA7ajxEO2orKylmb3IobGV0IGs9MDtrPGo7aysrKUhbal1ba109SFtrXVtqXTsKICBIWzBdWzBdKz0xZS05OwogIGNvbnN0IGR3PXNvbHZlTGluKEgsZyk7bGV0IG14PTA7Zm9yKGxldCBqPTA7ajxEO2orKyl7d1tqXS09ZHdbal07bXg9TWF0aC5tYXgobXgsTWF0aC5hYnMoZHdbal0pKX0KICBpZihteDwxZS03KWJyZWFrOwogfQogcmV0dXJue3csbXUsc2R9Owp9CmNvbnN0IHByZWRMb2dpdD0obSx4KT0+e2xldCBzPW0ud1swXTtmb3IobGV0IGo9MDtqPHgubGVuZ3RoO2orKyl7Y29uc3Qgej0oeFtqXS1tLm11W2pdKS9tLnNkW2pdO3MrPW0ud1tqKzFdKk1hdGgubWF4KC02LE1hdGgubWluKDYseikpfXJldHVybiBzfTsgICAvLyDlrabnv5LmmYLjga7nr4Tlm7LjgpLlpKfjgY3jgY/lpJbjgozjgZ/lhaXlipvjgafmmrTjgozjgarjgYTjgojjgYbCsTbjgavmipHjgYjjgosKCi8qIOipleS+oeaMh+aome+8muWvvuaVsOaQjeWkseODu+ODluODqeOCpOODpOODvOODu0FVQ+ODu+i8g+ato+iqpOW3rihFQ0UpICovCmZ1bmN0aW9uIGF1Y09mKHAseSl7CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSk7bGV0IHJzPTAsbjE9MDsKIGZvcihsZXQgcj0wO3I8aWR4Lmxlbmd0aDtyKyspe2lmKHlbaWR4W3JdXSl7cnMrPXIrMTtuMSsrfX0KIGNvbnN0IG4wPXkubGVuZ3RoLW4xO3JldHVybiBuMSYmbjA/KHJzLW4xKihuMSsxKS8yKS8objEqbjApOi41Owp9CmZ1bmN0aW9uIG1ldHJpY3NPZihwLHkpewogY29uc3Qgbj15Lmxlbmd0aDtsZXQgbGw9MCxicj0wOwogZm9yKGxldCBpPTA7aTxuO2krKyl7Y29uc3QgcT1NYXRoLm1pbigxLTFlLTksTWF0aC5tYXgoMWUtOSxwW2ldKSk7bGwtPXlbaV0/TWF0aC5sb2cocSk6TWF0aC5sb2coMS1xKTticis9KHBbaV0teVtpXSkqKjJ9CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSksQj0xMDtsZXQgZWNlPTA7CiBmb3IobGV0IGI9MDtiPEI7YisrKXtjb25zdCBzPWlkeC5zbGljZShNYXRoLmZsb29yKGIqbi9CKSxNYXRoLmZsb29yKChiKzEpKm4vQikpO2lmKCFzLmxlbmd0aCljb250aW51ZTsKICBjb25zdCBtcD1zLnJlZHVjZSgoYSxpKT0+YStwW2ldLDApL3MubGVuZ3RoLG15PXMucmVkdWNlKChhLGkpPT5hK3lbaV0sMCkvcy5sZW5ndGg7ZWNlKz1NYXRoLmFicyhtcC1teSkqcy5sZW5ndGgvbn0KIHJldHVybntuLGxsOmxsL24sYnJpZXI6YnIvbixhdWM6YXVjT2YocCx5KSxlY2V9Owp9CgovKiDnrYnntJrvvJrkuojmuKznorrnjofjga7pq5jjgYTpoIbjgavkuIrkvY0gMyUgLyA3JSAvIDEyJSAvIDIwJSAvIDI4JSAvIOaui+OCiu+8iFNTUy9TUy9TL0EvQi9D77yJICovCmNvbnN0IFVQX1NIQVJFPVtbIlNTUyIsLjAzXSxbIlNTIiwuMDddLFsiUyIsLjEyXSxbIkEiLC4yMF0sWyJCIiwuMjhdLFsiQyIsLjMwXV07CmZ1bmN0aW9uIG1ha2VDdXRzKHBzKXsKIGNvbnN0IHM9cHMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpO2xldCBhY2M9MDtjb25zdCBjdXRzPVtdOwogZm9yKGNvbnN0IFtnLHNoXSBvZiBVUF9TSEFSRSl7YWNjKz1zaDtpZihnPT09IkMiKXtjdXRzLnB1c2goW2csLTFdKTticmVha31jdXRzLnB1c2goW2csc1tNYXRoLm1pbihzLmxlbmd0aC0xLE1hdGgubWF4KDAsTWF0aC5yb3VuZChzLmxlbmd0aCphY2MpLTEpKV1dKX0KIHJldHVybiBjdXRzOwp9CmNvbnN0IGdyYWRlT2Y9KGN1dHMscCk9Pntmb3IoY29uc3QgW2csY10gb2YgY3V0cylpZihwPj1jKXJldHVybiBnO3JldHVybiJDIn07CmZ1bmN0aW9uIGdyYWRlVGFibGUoY3V0cyxwcyx5cyl7CiBjb25zdCB0PXt9O1VQX1NIQVJFLmZvckVhY2goKFtnXSk9PnRbZ109e246MCxrOjB9KTsKIHBzLmZvckVhY2goKHAsaSk9Pntjb25zdCB4PXRbZ3JhZGVPZihjdXRzLHApXTt4Lm4rKzt4LmsrPXlzW2ldfSk7CiBmb3IoY29uc3QgZyBpbiB0KXtjb25zdCB4PXRbZ10sdz13aWxzb24oeC5rLHgubik7eC5yYXRlPXgubj94LmsveC5uOjA7eC5sbz13WzBdO3guaGk9d1sxXX0KIHJldHVybiB0Owp9CgovKiDmlrDjg6Ljg4fjg6vjga7lhaXlipvvvJrnj77ooYzjg6Ljg4fjg6vjga7nibnlvrTph48oMTcpIO+8iyDjgqrjg4PjgrrnibnlvrTph48oNywg44Gq44GR44KM44GwMCkg77yLIOOCquODg+OCuuacieeEoSDvvIsg44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546HKDMpICovCmZ1bmN0aW9uIHVwWCh1LGUpewogY29uc3Qgb2Rkcz11Lm1vZGU9PT0ib2RkcyI7CiByZXR1cm5bLi4udS5mLnNsaWNlKDEsMTgpLC4uLihvZGRzP3UuZi5zbGljZSgxOCwyNSk6WzAsMCwwLDAsMCwwLDBdKSxvZGRzPzE6MCwuLi5lXTsKfQpmdW5jdGlvbiB1cHNldEN1c3RvbShNLHUsZSxwYyl7CiBpZighTSlyZXR1cm4gbnVsbDsKIGxldCB6O2NvbnN0IHowPWxndCh1LnAwKSx4eD0oKT0+TS5wYWNlP1suLi51cFgodSxlKSwuLi4ocGN8fFswLDAsMCwwLDBdKV06dXBYKHUsZSk7CiBpZihNLmtpbmQ9PT0ib2xkIil6PXowOwogZWxzZSBpZihNLmtpbmQ9PT0ibmV3Iil6PXByZWRMb2dpdChNLm1vZGVsLHh4KCkpOwogZWxzZSBpZihNLmtpbmQ9PT0iYmxlbmQiKXo9KHowK3ByZWRMb2dpdChNLm1vZGVsLHh4KCkpKS8yOwogZWxzZSByZXR1cm4gbnVsbDsKIGNvbnN0IHA9c2lnbSh6KSxnPWdyYWRlT2YoTS5jdXRzLHApLHI9TS5yYXRlcyYmTS5yYXRlc1tnXXx8e307CiByZXR1cm57Z3JhZGU6ZyxwLHJhdGU6ci5yYXRlPz9udWxsLGxvOnIubG8/P251bGwsaGk6ci5oaT8/bnVsbCxuOnIubj8/MH07Cn0KY29uc3QgZ2V0VXBzZXRNb2RlbD0oKT0+e3RyeXtjb25zdCBtPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oVVBLRVkpfHwibnVsbCIpO3JldHVybiBtJiZtLmN1dHMmJm0udmVyPT09Mj9tOm51bGx9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsgICAvLyB2ZXI6Mu+8neODrOODvOOCueeVquWPt+OBrueJueW+tOmHj+OBpOOBjeOAguWPpOOBhOS/neWtmOOBr+S9v+OCj+OBquOBhAoKLyogLS0tLS0tLS0tLSDmpJzoqLzjgajlho3moKHmraPjga7mnKzkvZMgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBydW5VcHNldEZpdChvcHRzKXsKIG9wdHM9b3B0c3x8e307CiBjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiMjAyMS0wMS0wMSIsVEVTVD1vcHRzLnRlc3RTdGFydHx8TU9ERUxfVFJBSU5fRU5ELG91dD1bXTsKIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7CiBjb25zdCBtYXA9bmV3IE1hcCgpOwogYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiBpZihyYWNlcy5sZW5ndGg8NTAwKXtidXN5KGZhbHNlKTtyZXR1cm57ZXJyb3I6IumBjuWOu+ODh+ODvOOCv+OBjOWwkeOBquOBmeOBjuOBvuOBme+8iCIrcmFjZXMubGVuZ3RoKyLjg6zjg7zjgrnvvInjgILlhYjjgavpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgIIifX0KIGNvbnN0IHN0b3JlPW5ldyBVRS5TdG9yZSgpLHByaT1uZXcgVXBQcmkoKSxTPVtdOwogZm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSsrKXsKICBjb25zdCByYz1yYWNlc1tpXSxhbT1uZXcgTWFwKCk7Zm9yKGNvbnN0IHIgb2YgcmMucm93cylhZ2dBZGQoYW0scik7CiAgY29uc3QgaW5mbz1hZ2dJbmZvKGFtLmdldChTdHJpbmcocmMucm93c1swXSYmcmMucm93c1swXS5yYWNlSWQpKSk7CiAgaWYoaW5mbyYmaW5mby55IT1udWxsJiZyYy5kYXRlPj1TVEFSVCl7CiAgIGNvbnN0IFI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSk7CiAgIGNvbnN0IGhhc09kZHM9Ui5ldmVyeShyPT5yLm9kZHM+MSksb2Q9aGFzT2Rkcz9SLm1hcChyPT5yLm9kZHMpOm51bGw7CiAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgIHRyeXsKICAgIGNvbnN0IGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKSx1PVVFLnVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZCxhcCk7CiAgICBTLnB1c2goe2RhdGU6cmMuZGF0ZSx1LGU6cHJpLmZlYXQoaW5mbykscGM6cGFjZUZlYXQoUixzdG9yZSkseTppbmZvLnl9KTsKICAgfWNhdGNoKGUpe30KICB9CiAgcHJpLmFkZChpbmZvKTtmb3IoY29uc3QgciBvZiByYy5yb3dzKXtyLmNmPWNvcm5lckZyYWMoci5jb3JuZXIscmMucm93cy5sZW5ndGgpO3N0b3JlLmFkZChyKX0KICBpZihpJTMwPT09Mjkpe2J1c3kodHJ1ZSxg5pmC57O75YiX44Gr5YaN54++44GX44Gm5qSc6Ki85Lit4oCmICR7aSsxfS8ke3JhY2VzLmxlbmd0aH3jg6zjg7zjgrlgKTthd2FpdCBzbGVlcCgwKX0KIH0KIGJ1c3kodHJ1ZSwi44Oi44OH44Or44KS5q+U6LyD5Lit4oCmIik7YXdhaXQgc2xlZXAoMCk7CiBjb25zdCB0cmFpbj1TLmZpbHRlcihzPT5zLmRhdGU8VEVTVCksdGVzdD1TLmZpbHRlcihzPT5zLmRhdGU+PVRFU1QpOwogY29uc3QgcmVzPXtuQWxsOlMubGVuZ3RoLG5UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsc3RhcnQ6U1RBUlQsdGVzdFN0YXJ0OlRFU1QsYmFzZTpTLmxlbmd0aD9TLnJlZHVjZSgoYSxzKT0+YStzLnksMCkvUy5sZW5ndGg6MH07CiBpZih0ZXN0Lmxlbmd0aDwzMDB8fHRyYWluLmxlbmd0aDwxNTAwKXtidXN5KGZhbHNlKTtyZXR1cm57Li4ucmVzLGVycm9yOmDmpJzoqLzjgavkvb/jgYjjgovmnJ/plpPjga7jg6zjg7zjgrnjgYzotrPjgorjgb7jgZvjgpPvvIjlrabnv5LlgbQke3RyYWluLmxlbmd0aH3jg7vmpJzoqLzlgbQke3Rlc3QubGVuZ3Rofe+8ieOAguaknOiovOOBrumWi+Wni+aXpeOCkuaXqeOCgeOCi+OBi+OAgeODh+ODvOOCv+OCkuWil+OChOOBl+OBpuOBj+OBoOOBleOBhOOAgmB9fQogY29uc3QgeVQ9dGVzdC5tYXAocz0+cy55KSx5MD10cmFpbi5tYXAocz0+cy55KTsKIC8vIOePvuihjOODouODh+ODq+OBruaknOiovOacn+mWk+OBp+OBruaIkOe4vgogY29uc3QgcDA9dGVzdC5tYXAocz0+cy51LnAwKSxtMD1tZXRyaWNzT2YocDAseVQpOwogLy8g5paw44Oi44OH44Or77yI5a2m57+S5pyf6ZaT44Gu44G/44Gn5L2c44KL77yJCiBjb25zdCB4Tj1zPT51cFgocy51LHMuZSkseFA9cz0+Wy4uLnVwWChzLnUscy5lKSwuLi5zLnBjXTsKIGNvbnN0IG1kbD1maXRMb2dpdCh0cmFpbi5tYXAoeE4pLHkwLDMpOwogY29uc3QgcE49dGVzdC5tYXAocz0+c2lnbShwcmVkTG9naXQobWRsLHhOKHMpKSkpLG1OPW1ldHJpY3NPZihwTix5VCk7CiBjb25zdCBwQj10ZXN0Lm1hcCgocyxpKT0+c2lnbSgobGd0KHAwW2ldKStwcmVkTG9naXQobWRsLHhOKHMpKSkvMikpLG1CPW1ldHJpY3NPZihwQix5VCk7CiByZXMubTA9bTA7cmVzLm1OPW1OO3Jlcy5tQj1tQjsKIC8vIOODmuODvOOCue+8iOiEmuizqu+8ieOBrueJueW+tOmHj++8muS9v+OBiOOCi+ODrOODvOOCueOBjOWNgeWIhuOBguOCi+OBqOOBjeOBoOOBkQogY29uc3QgY292VHI9dHJhaW4uZmlsdGVyKHM9PnMucGNbMF0+MCkubGVuZ3RoLGNvdlRlPXRlc3QuZmlsdGVyKHM9PnMucGNbMF0+MCkubGVuZ3RoOwogcmVzLnBhY2U9e2NvdlRyYWluOmNvdlRyLGNvdlRlc3Q6Y292VGUsdXNlZDpmYWxzZX07CiBsZXQgbWRsUD1udWxsLG1QPW51bGwsbVBCPW51bGw7CiBpZihjb3ZUcj49NDAwJiZjb3ZUZT49MTAwKXsKICBtZGxQPWZpdExvZ2l0KHRyYWluLm1hcCh4UCkseTAsMyk7CiAgY29uc3QgcFA9dGVzdC5tYXAocz0+c2lnbShwcmVkTG9naXQobWRsUCx4UChzKSkpKTttUD1tZXRyaWNzT2YocFAseVQpOwogIG1QQj1tZXRyaWNzT2YodGVzdC5tYXAoKHMsaSk9PnNpZ20oKGxndChwMFtpXSkrcHJlZExvZ2l0KG1kbFAseFAocykpKS8yKSkseVQpOwogIHJlcy5tUD1tUDtyZXMubVBCPW1QQjtyZXMucGFjZS51c2VkPXRydWU7CiB9CiAvLyDmjqHnlKjjga7liKTmlq3vvJrlr77mlbDmkI3lpLHjgYwwLjAwMuS7peS4iuiJr+OBj+OBquOCiuOAgUFVQ+OBjOaCquWMluOBl+OBpuOBhOOBquOBhOOBk+OBqAogY29uc3QgYmV0dGVyPShtLHJlZik9PihyZWYubGwtbS5sbD49LjAwMikmJihtLmF1Yz49cmVmLmF1Yy0uMDAzKTsKIGxldCBraW5kPSJvbGQiLHVzZVBhY2U9ZmFsc2U7CiBjb25zdCBjYW5kcz1bWyJuZXciLG1OLGZhbHNlXSxbImJsZW5kIixtQixmYWxzZV1dOwogaWYobVApe2NhbmRzLnB1c2goWyJuZXciLG1QLHRydWVdKTtjYW5kcy5wdXNoKFsiYmxlbmQiLG1QQix0cnVlXSk7fQogY29uc3QgY2FuZD1jYW5kcy5maWx0ZXIoKFtrLG1dKT0+YmV0dGVyKG0sbTApKS5zb3J0KChhLGIpPT5hWzFdLmxsLWJbMV0ubGwpWzBdOwogaWYoY2FuZCl7a2luZD1jYW5kWzBdO3VzZVBhY2U9Y2FuZFsyXX0KIC8vIOODmuODvOOCueOCkuS9v+OBhuWgtOWQiOOBr+OAgeODmuODvOOCueOBquOBl+OCiOOCijAuMDAx5Lul5LiK6Imv44GE44GT44Go44KC5p2h5Lu244Gr44GZ44KL77yI5YG254S244KS5o6h55So44GX44Gq44GE77yJCiBpZih1c2VQYWNlJiYhKG1OLmxsLShraW5kPT09Im5ldyI/bVAubGw6bVBCLmxsKT49LjAwMSkpe2NvbnN0IGFsdD1jYW5kcy5maWx0ZXIoKFtrLG0scF0pPT4hcCYmYmV0dGVyKG0sbTApKS5zb3J0KChhLGIpPT5hWzFdLmxsLWJbMV0ubGwpWzBdO2lmKGFsdCl7a2luZD1hbHRbMF07dXNlUGFjZT1mYWxzZX1lbHNle2tpbmQ9Im9sZCI7dXNlUGFjZT1mYWxzZX19CiByZXMudXNlUGFjZT11c2VQYWNlOwogY29uc3QgTTI9dXNlUGFjZT9tZGxQOm1kbCx4eD11c2VQYWNlP3hQOnhOOwogcmVzLmtpbmQ9a2luZDsKIC8vIOetiee0muOBruWIh+OCjOebruOBr+OAjOWtpue/kuWBtOOAjeOBruS6iOa4rOOBi+OCieaxuuOCgeOAgeaknOiovOWBtOOBp+Wun+mam+OBruazouS5seeOh+OCkua4rOOCi++8iOato+ebtOOBquWun+e4vueOh++8iQogY29uc3QgcHJlZFRyYWluPXM9PmtpbmQ9PT0ib2xkIj9zLnUucDA6a2luZD09PSJuZXciP3NpZ20ocHJlZExvZ2l0KE0yLHh4KHMpKSk6c2lnbSgobGd0KHMudS5wMCkrcHJlZExvZ2l0KE0yLHh4KHMpKSkvMik7CiBjb25zdCBjdXRzPW1ha2VDdXRzKHRyYWluLm1hcChwcmVkVHJhaW4pKTsKIGNvbnN0IHBUZXN0PXRlc3QubWFwKHByZWRUcmFpbiksdGFiPWdyYWRlVGFibGUoY3V0cyxwVGVzdCx5VCk7CiByZXMuY3V0cz1jdXRzO3Jlcy50YWI9dGFiOwogcmVzLm1vZGVsPXt2ZXI6MixraW5kLHBhY2U6dXNlUGFjZSxtb2RlbDpNMixjdXRzLHJhdGVzOk9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh0YWIpLm1hcCgoW2cseF0pPT5bZyx7cmF0ZTp4LnJhdGUsbG86eC5sbyxoaTp4LmhpLG46eC5ufV0pKSwKICBhdDpuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCksblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCx0ZXN0U3RhcnQ6VEVTVCxtMCxtTixtQixtUCxtUEIscGFjZUNvdjpbY292VHIsY292VGVdfTsKIGJ1c3koZmFsc2UpO3JldHVybiByZXM7Cn0KCmZ1bmN0aW9uIHVwc2V0UmVwb3J0KHIpewogaWYoci5lcnJvcilyZXR1cm5gPHNwYW4gY2xhc3M9ImJhZCI+JHtlc2Moci5lcnJvcil9PC9zcGFuPmA7CiBjb25zdCBmPXg9PngudG9GaXhlZCg0KSxyb3c9KGwsbSk9PmA8dHI+PHRkPiR7bH08L3RkPjx0ZD4ke2YobS5sbCl9PC90ZD48dGQ+JHtmKG0uYnJpZXIpfTwvdGQ+PHRkPiR7bS5hdWMudG9GaXhlZCgzKX08L3RkPjx0ZD4keyhtLmVjZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PC90cj5gOwogbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lrabnv5LlgbQgJHtyLm5UcmFpbn3jg6zjg7zjgrnvvIjjgJwke2VzYyhyLnRlc3RTdGFydCl944Gu5YmN5pel77yJ77yP5qSc6Ki85YG0ICR7ci5uVGVzdH3jg6zjg7zjgrnvvIgke2VzYyhyLnRlc3RTdGFydCl95Lul6ZmN77yd54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yJ44CC5YWo5L2T44Gu5rOi5Lmx546HICR7cGN0KHIuYmFzZSwxKX3jgII8L2Rpdj4KIDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7jg6Ljg4fjg6vvvIjmpJzoqLzlgbTvvIk8L3RoPjx0aD7lr77mlbDmkI3lpLHihpM8L3RoPjx0aD7oqqTlt67ihpM8L3RoPjx0aD5BVUPihpE8L3RoPjx0aD7ovIPmraPoqqTlt67ihpM8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+JHtyb3coIuePvuihjCIsci5tMCl9JHtyb3coIuaWsO+8iOOCs+ODvOOCueWIpeOCkui/veWKoO+8iSIsci5tTil9JHtyb3coIuePvuihjOOBqOaWsOOBruW5s+WdhyIsci5tQil9JHtyLm1QP3Jvdygi5paw77yI44Kz44O844K55Yil77yL44Oa44O844K577yJIixyLm1QKToiIn08L3Rib2R5PjwvdGFibGU+PC9kaXY+YDsKIGgrPXIucGFjZSYmci5wYWNlLnVzZWQ/YDxkaXYgY2xhc3M9InNtYWxsIj7jg5rjg7zjgrnjg7vohJros6rjga7nibnlvrTph4/vvJrlrabnv5LlgbQke3IucGFjZS5jb3ZUcmFpbn3jg7vmpJzoqLzlgbQke3IucGFjZS5jb3ZUZXN0feODrOODvOOCueOBp+S9v+OBiOOBvuOBl+OBn+OAgiR7ci51c2VQYWNlPyI8Yj7jg5rjg7zjgrnjgpLliqDjgYjjgovjgajmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgZ/jgoHmjqHnlKjjgZfjgb7jgZfjgZ/jgII8L2I+Ijoi44Oa44O844K544KS5Yqg44GI44Gm44KC5piO56K644Gq5pS55ZaE44Gv44Gq44GL44Gj44Gf44Gf44KB44CB5o6h55So44GX44Gm44GE44G+44Gb44KT44CCIn08L2Rpdj5gOmA8ZGl2IGNsYXNzPSJzbWFsbCI+44Oa44O844K544O76ISa6LOq77ya6YCa6YGO6aCG5L2N44Gk44GN44Gu5oiQ57i+44GM5bCR44Gq44GP77yI5a2m57+S5YG0JHtyLnBhY2U/ci5wYWNlLmNvdlRyYWluOjB944O75qSc6Ki85YG0JHtyLnBhY2U/ci5wYWNlLmNvdlRlc3Q6MH3jg6zjg7zjgrnvvInjgIHmpJzoqLzjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgILoqK3lrprjga7jgIzjg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jga7lj5bjgornm7TjgZfjgI3jgpLlrp/ooYzjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogY29uc3Qgbm09e29sZDoi54++6KGM44Oi44OH44Or44Gu44G+44G+77yI5paw44Oi44OH44Or44Gv5piO56K644Gr44Gv6Imv44GP44Gq44KJ44Gq44GL44Gj44Gf77yJIixuZXc6IuaWsOODouODh+ODq+OCkuaOoeeUqCIrKHIudXNlUGFjZT8i77yI44Oa44O844K56L6844G/77yJIjoiIiksYmxlbmQ6IuePvuihjOOBqOaWsOOBruW5s+Wdh+OCkuaOoeeUqCIrKHIudXNlUGFjZT8i77yI44Oa44O844K56L6844G/77yJIjoiIil9W3Iua2luZF07CiBoKz1gPGRpdiBjbGFzcz0iYmFubmVyICR7ci5raW5kPT09Im9sZCI/InduIjoib2sifSI+PGI+57WQ5p6c77yaJHtubX08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5o6h55So5p2h5Lu277ya5a++5pWw5pCN5aSx44GMMC4wMDLku6XkuIrmlLnlloTjgZfjgIFBVUPjgYzmgqrljJbjgZfjgabjgYTjgarjgYTjgZPjgajjgII8L3NwYW4+PC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+562J57Sa44GU44Go44GuPGI+5a6f6Zqb44Gu5rOi5Lmx546HPC9iPu+8iOaknOiovOWBtOODuzk1JeOBruW5he+8ieOAguOBk+OBruaVsOWtl+OBjOOAgeazouS5seW6puOCv+ODluOBq+ihqOekuuOBleOCjOOCi+OCiOOBhuOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7nrYnntJo8L3RoPjx0aD7jg6zjg7zjgrnmlbA8L3RoPjx0aD7lrp/pmpvjga7ms6LkubHnjoc8L3RoPjx0aD45NSXjga7luYU8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCBbZ10gb2YgVVBfU0hBUkUpe2NvbnN0IHg9ci50YWJbZ107aCs9YDx0cj48dGQ+JHtnfTwvdGQ+PHRkPiR7eC5ufTwvdGQ+PHRkPjxiPiR7cGN0KHgucmF0ZSwxKX08L2I+PC90ZD48dGQ+JHtwY3QoeC5sbyl944CcJHtwY3QoeC5oaSl9PC90ZD48L3RyPmB9CiBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiBjb25zdCBtb25vPVVQX1NIQVJFLm1hcCgoW2ddKT0+ci50YWJbZ10ucmF0ZSkuZXZlcnkoKHYsaSxhKT0+aT09PTB8fHY8PWFbaS0xXSsuMDMpOwogaWYoIW1vbm8paCs9JzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuetiee0muOBrumghuOBq+Wun+e4vueOh+OBjOWNmOiqv+OBq+S4i+OBjOOBo+OBpuOBhOOBvuOBm+OCk+OAguaknOiovOWBtOOBruODrOODvOOCueaVsOOBjOWwkeOBquOBhOOBqOi1t+OBjeOBvuOBme+8iOWBtueEtuOBruevhOWbsuOBruOBk+OBqOOBjOWkmuOBhO+8ieOAgjwvZGl2Pic7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiB1cHNldFN0YXR1c0xpbmUoKXsKIGNvbnN0IE09Z2V0VXBzZXRNb2RlbCgpOwogaWYoIU0pcmV0dXJuJzxkaXYgY2xhc3M9InNtYWxsIj7mqJnmupbjg6Ljg4fjg6vvvIjlrabnv5LmuIjjgb/jga7lm7rlrprjg6Ljg4fjg6vvvInjgILlrp/nuL7njofjga/lrabnv5LmmYLjga7mlbDlrZfjgafjgZnjgILjgIzmpJzoqLzjgI3jgr/jg5bjgafjgIHoh6rliIbjga7jg4fjg7zjgr/jgafjga7mpJzoqLzjg7vlho3moKHmraPjgYzjgafjgY3jgb7jgZnjgII8L2Rpdj4nOwogY29uc3Qgbm09e29sZDoi54++6KGM44Oi44OH44OrIixuZXc6IuWGjeagoeato+OBl+OBn+aWsOODouODh+ODqyIsYmxlbmQ6IuePvuihjOOBqOaWsOOBruW5s+WdhyJ9W00ua2luZF07CiByZXR1cm5gPGRpdiBjbGFzcz0ic21hbGwiPjxiPiR7bm19PC9iPuOBp+WIpOWumuS4re+8iOaknOiovOaXpSAke2VzYyhNLmF0KX3vvI/mpJzoqLwgJHtNLm5UZXN0feODrOODvOOCue+8ieOAguetiee0muOBruWun+e4vueOh+OBr+OAgeODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBp+a4rOOBo+OBn+WApOOBp+OBmeOAgjwvZGl2PmA7Cn0KCgovKiAtLS0tLS0tLS0tIOS/neWtmOODh+ODvOOCv+OBrueKtuazgSAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIHNob3dTdGF0ZSgpewogdHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpLHBzPWF3YWl0IHBheUFsbCgpOwogIGNvbnN0IGJhc2U9ZnMuZmlsdGVyKGY9PiFmLmxpdmUpLGxpdmU9ZnMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCk7CiAgaWYoIWZzLmxlbmd0aCYmIXBzLmxlbmd0aCl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumBjuWOu+ODh+ODvOOCv+OBr+acquWPluW+l+OBp+OBmeOAguOAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZnjgYvjgIHoqK3lrprjgYvjgonjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLlvqnlhYPjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgbGQ9bGl2ZS5tYXAoZj0+Zi5kYXRlKS5zb3J0KCksblJhY2VzPWxpdmUucmVkdWNlKChzLGYpPT5zK25ldyBTZXQoZi5yb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemUsMCk7CiAgbGV0IG5BbGw9MCxuVHI9MDtmb3IoY29uc3QgZiBvZiBsaXZlKWZvcihjb25zdCByIG9mIGYucm93cyl7bkFsbCsrO2lmKHIudHJhaW5lciluVHIrK30KICBsZXQgaD0iIjsKICBpZihsaXZlLmxlbmd0aCloKz1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluW+l+a4iOOBv+OBruaIkOe4vu+8miR7bGl2ZS5sZW5ndGh95pel77yPJHtuUmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIgke2xkWzBdfeOAnCR7bGRbbGQubGVuZ3RoLTFdfe+8iTwvc3Bhbj5gOwogIGlmKGJhc2UubGVuZ3RoKXtjb25zdCB5cz1bLi4ubmV3IFNldChiYXNlLm1hcChmPT5mLnllYXIpKV0uc29ydCgpO2grPShoPyJcbiI6IiIpK2A8c3BhbiBjbGFzcz0iZ29vZCI+44OQ44OD44Kv44Ki44OD44OXQ1NW77yaJHtiYXNlLmxlbmd0aH3jg5XjgqHjgqTjg6vvvIgke3lzWzBdfHwiLSJ944CcJHt5c1t5cy5sZW5ndGgtMV18fCItIn3lubTvvIk8L3NwYW4+YH0KICBjb25zdCBwcj1wcy5yZWR1Y2UoKHMscCk9PnMrKHAucmFjZXN8fFtdKS5sZW5ndGgsMCk7CiAgaCs9KGg/IlxuIjoiIikrKHBzLmxlbmd0aD9gPHNwYW4gY2xhc3M9Imdvb2QiPuaJleaIu++8miR7cHMubGVuZ3RofeaXpe+8jyR7cHIudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L3NwYW4+YDonPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu++8muacquWPluW+lzwvc3Bhbj4nKTsKICBpZihuQWxsKWgrPWBcbuiqv+aVmeW4q+OBpOOBjeOBruaIkOe4vu+8miR7TWF0aC5yb3VuZChuVHIvbkFsbCoxMDApfSUke25Ucj09PTA/Iu+8iOOBk+OCjOOBi+OCieWPluW+l+OBmeOCi+aIkOe4vuOBq+WFpeOCiuOBvuOBme+8iSI6IiJ9YDsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPueiuuiqjeOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZSl9PC9zcGFuPmB9Cn0KCi8qIC0tLS0tLS0tLS0g5Y+W5b6X44GX44Gf6KGMIOKGkiDlhoXpg6jjga7ooYzvvIjoqr/mlZnluKvjg7vjgrDjg6zjg7zjg4nku5jjgY3vvIkgLS0tLS0tLS0tLSAqLwpmdW5jdGlvbiBsaXZlUm93KHgpe2NvbnN0IGY9cGFyc2VGbG9hdChTdHJpbmcoeC5maW5pc2g/PyIiKS5yZXBsYWNlKC9bXlxkLl0vZywiIikpOwogcmV0dXJue3JhY2VJZDpTdHJpbmcoeC5yYWNlSWR8fCIiKSxkYXRlOlVFLnBhcnNlRGF0ZSh4LmRhdGUpLG5hbWU6U3RyaW5nKHguaG9yc2V8fCIiKS50cmltKCksaG9yc2U6VUUubm4oeC5ob3JzZSksam9ja2V5OlVFLmpubih4LmpvY2tleSksCiAgZmluaXNoOk51bWJlci5pc0Zpbml0ZShmKSYmZj4wP2Y6bnVsbCxkaXN0Ok51bWJlcih4LmRpc3RhbmNlKXx8MCxzdXJmOlVFLnN1cmZDb2RlKHguc3VyZmFjZSksYWdlOk51bWJlcih4LmFnZSl8fG51bGwsbnVtOk51bWJlcih4Lm51bWJlcil8fG51bGwsCiAgcG9wOk51bWJlcih4LnBvcCk+MD9OdW1iZXIoeC5wb3ApOm51bGwsb2RkczpudWxsLGpuYW1lOlN0cmluZyh4LmpvY2tleXx8IiIpLnRyaW0oKSx0cmFpbmVyOlVFLmNsZWFuVHIoeC50cmFpbmVyKSwKICBsdmw6KHgudmVudWVDb2RlJiYhL14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKHgudmVudWVDb2RlKSkpPy0xOihVRS5sZXZlbE9mTGFiZWwoeC5jbHMpfHxVRS5sZXZlbE9mUHJpemUoeC5wcml6ZSkpLAogIGdyZDpVRS5ncmFkZVRpZXIoKHguY2xzfHwiIikrIiAiKyh4LmdyYWRlfHwiIikseC5wcml6ZSxmYWxzZSksCiAgY29ybmVyOkFycmF5LmlzQXJyYXkoeC5jb3JuZXIpJiZ4LmNvcm5lci5sZW5ndGg/eC5jb3JuZXI6bnVsbCxsYXA6QXJyYXkuaXNBcnJheSh4LmxhcCkmJngubGFwLmxlbmd0aD94LmxhcDpudWxsfX0KCi8qIOWvvuixoeaXpeOCiOOCiuWJjeOBruWxpeattOOBoOOBkeOBp+OCueODiOOCouOCkuS9nOOCi++8iOmojuaJi+ODu+iqv+aVmeW4q+OBruaIkOe4vuOCguWQjOaZguOBq+mbhuioiO+8iSAqLwphc3luYyBmdW5jdGlvbiBidWlsZFN0b3JlKHRhcmdldCl7CiBpZihTVE9SRSYmU1RPUkVfS0VZPT09dGFyZ2V0KXJldHVybiBTVE9SRTsKIGNvbnN0IGZzPWF3YWl0IGlkYkFsbCgpO2lmKCFmcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLpgY7ljrvjg4fjg7zjgr/jgYzmnKrnmbvpjLLjgafjgZnjgILlhYjjgavjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GZ44GL44CB6Kit5a6a44Gn44OQ44OD44Kv44Ki44OD44OX44KS5b6p5YWD44GX44Gm44GP44Gg44GV44GE44CCIik7CiBjb25zdCBzdD1uZXcgVUUuU3RvcmUoKTtzdC50cj1uZXcgTWFwKCk7bGV0IHVzZWQ9MDtjb25zdCBBRz1uZXcgTWFwKCk7CiBjb25zdCB0YWtlPXI9PntpZighci5kYXRlfHxyLmRhdGU+PXRhcmdldHx8IXIuaG9yc2UpcmV0dXJuO2FnZ0FkZChBRyxyKTtzdC5hZGQocik7dXNlZCsrO2lmKHIuZGF0ZT4oc3QubGFzdERhdGV8fCIiKSlzdC5sYXN0RGF0ZT1yLmRhdGU7CiAgaWYoci50cmFpbmVyJiZyLmZpbmlzaCE9bnVsbCl7bGV0IHQ9c3QudHIuZ2V0KHIudHJhaW5lcik7aWYoIXQpc3QudHIuc2V0KHIudHJhaW5lcix0PXtuOjAsdDM6MH0pO3QubisrO2lmKHIuZmluaXNoPD0zKXQudDMrK319OwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXsKICBidXN5KHRydWUsYOmBjuWOu+ODh+ODvOOCv+OCkumbhuioiOS4reKApiAke2krMX0vJHtmcy5sZW5ndGh9XG7vvIgke3RhcmdldH3jgojjgorliY3jga7jgb/kvb/nlKjvvIlgKTsKICBpZihmc1tpXS5saXZlKXtjb25zdCByd3M9ZnNbaV0ucm93c3x8W10sY250PXt9O2Zvcihjb25zdCB4IG9mIHJ3cyljbnRbeC5yYWNlSWRdPShjbnRbeC5yYWNlSWRdfHwwKSsxO2Zvcihjb25zdCB4IG9mIHJ3cyl7Y29uc3Qgcj1saXZlUm93KHgpO3IuY2Y9Y29ybmVyRnJhYyh4LmNvcm5lcixjbnRbeC5yYWNlSWRdKTt0YWtlKHIpfX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZnNbaV0uY3N2KSl0YWtlKFVFLnRvUm93KG8pKTsKICBhd2FpdCBzbGVlcCgwKTsKIH0KIGNvbnN0IHByaT1uZXcgVXBQcmkoKTtmb3IoY29uc3QgYSBvZiBBRy52YWx1ZXMoKSlwcmkuYWRkKGFnZ0luZm8oYSkpO3N0LnVwPXByaTsKIGJ1c3koZmFsc2UpO1NUT1JFPXN0O1NUT1JFX0tFWT10YXJnZXQ7c3QuY291bnQ9dXNlZDtyZXR1cm4gc3Q7Cn0KCi8qIOWHuummrOihqOOBrjHjg6zjg7zjgrkg4oaSIOino+aekOeUqOOBruODrOODvOOCuSAqLwpmdW5jdGlvbiBta1JhY2UoYyxkKXsKIGNvbnN0IGhzPWMuaG9yc2VzfHxjLnJ1bm5lcnN8fFtdOwogY29uc3QgZ3Q9KGMuY2xhc3NOYW1lfHwiIikrIiAiKyhjLmdyYWRlfHwiIikrIiAiKyhjLnJhY2VOYW1lfHwiIik7CiBjb25zdCBncmQ9VUUuZ3JhZGVUaWVyKGd0LGMucHJpemUsdHJ1ZSk7CiByZXR1cm57ZGF0ZTpkLHN1cmY6VUUuc3VyZkNvZGUoYy5zdXJmYWNlKSxkaXN0Ok51bWJlcihjLmRpc3RhbmNlKXx8MCwKICBsdmw6VUUubGV2ZWxPZkxhYmVsKGMuY2xhc3NOYW1lKXx8VUUubGV2ZWxPZkxhYmVsKGMucmFjZU5hbWUpfHwoZ3JkPj0xPzU6MCksZ3JkLAogIHJ1bm5lcnM6aHMubWFwKChoLGkpPT57Y29uc3QgbmFtZT1oLmhvcnNlTmFtZXx8aC5ob3JzZXx8aC5uYW1lfHwiIjsKICAgcmV0dXJue25hbWUsaG9yc2U6VUUubm4obmFtZSksam9ja2V5OlVFLmpubihoLmpvY2tleXx8IiIpLGpuYW1lOlN0cmluZyhoLmpvY2tleXx8IiIpLnRyaW0oKSx0cmFpbmVyOlVFLmNsZWFuVHIoaC50cmFpbmVyfHwiIiksYWdlOmguYWdlfHxudWxsLG51bTpoLmhvcnNlTnVtYmVyfHxoLm51bWJlcnx8aSsxfX0pCiAgIC5zb3J0KCh4LHkpPT4oeC5udW18fDApLSh5Lm51bXx8MCkpfTsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOS7iumAseacq+OBruWPluW+lwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IFdLPXtkYXRlczpbXSxjYXJkczp7fSxvZGRzOnt9LG9kZHNOb3Rlczp7fSxkaWFnOltdLGNhbGM6e30sYXQ6IiIsc3RvcmVJbmZvOm51bGx9Owpjb25zdCBya2V5PShkLGMpPT5gJHtkfXwke1N0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKX0tJHtOdW1iZXIoYy5yYWNlTnVtYmVyKXx8MH1gOwpjb25zdCB3a01zZz10PT57JCgid2tTdGF0dXMiKS50ZXh0Q29udGVudD10fTsKY29uc3QgYmFzZVVybD0oKT0+JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwpmdW5jdGlvbiBuZXh0V2Vla2VuZCh0b2RheSl7Y29uc3Qgb3V0PVtdO2NvbnN0IHQ9bmV3IERhdGUodG9kYXkrIlQwMDowMDowMFoiKS5nZXRUaW1lKCk7CiBmb3IobGV0IGk9MDtpPDgmJm91dC5sZW5ndGg8MjtpKyspe2NvbnN0IGQ9bmV3IERhdGUodCtpKjg2NGU1KSx3PWQuZ2V0VVRDRGF5KCk7aWYodz09PTZ8fHc9PT0wKW91dC5wdXNoKGQudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSl9cmV0dXJuIG91dH0KCmFzeW5jIGZ1bmN0aW9uIGZldGNoQ2FyZHMoYmFzZSxkLHZlbnVlQ29kZSl7CiBjb25zdCBxPXZlbnVlQ29kZT9gJnZlbnVlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHZlbnVlQ29kZSl9YDoiIjtsZXQgZXJyPSIiOwogZm9yKGxldCB0PTA7dDwzO3QrKyl7CiAgdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSR7cX1gKTsKICAgaWYoIXIub2spe2xldCBtPSIiO3RyeXttPShhd2FpdCByLmpzb24oKSkuZXJyb3J8fCIifWNhdGNoe310aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyLnN0YXR1c30gJHttfWAudHJpbSgpKX0KICAgY29uc3QgeD1hd2FpdCByLmpzb24oKTtyZXR1cm57cmFjZXM6QXJyYXkuaXNBcnJheSh4KT94Oih4LnJhY2VzfHxbXSl9fQogIGNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7YXdhaXQgc2xlZXAoMTIwMCoodCsxKSl9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyfHwi5Y+W5b6X44Gn44GN44G+44Gb44KTIik7Cn0KCi8qIDHplovlgqzloLTjgbbjgpPjga7lh7rppqzooajjgILmrKDjgZHjg7vlpLHmlZfjgYzjgYLjgozjgbDjgIHoh6rli5Xjgacx5Zue44Gg44GR44KE44KK55u044GZICovCmFzeW5jIGZ1bmN0aW9uIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsaXNSZXRyeSl7CiBjb25zdCBjb2RlPVN0cmluZyh2LnZlbnVlQ29kZSk7CiBXSy5jYXJkc1tkXT0oV0suY2FyZHNbZF18fFtdKS5maWx0ZXIoYz0+U3RyaW5nKGMudmVudWVDb2RlKSE9PWNvZGUpOwogV0suZGlhZz1XSy5kaWFnLmZpbHRlcih4PT4hKHguZD09PWQmJnguY29kZT09PWNvZGUpKTsKIHRyeXsKICBjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLGNvZGUpOwogIGNvbnN0IG9rPXJhY2VzLmZpbHRlcihhPT4oYS5ob3JzZXN8fGEucnVubmVyc3x8W10pLmxlbmd0aCksYmFkPXJhY2VzLmxlbmd0aC1vay5sZW5ndGg7CiAgV0suY2FyZHNbZF0ucHVzaCguLi5vayk7CiAgY29uc3QgaXNzdWVzPW9rLmZpbHRlcihjPT5jLnF1YWxpdHkmJiFjLnF1YWxpdHkub2spLm1hcChjPT5gJHtjLnJhY2VOdW1iZXJ9Uu+8miR7Yy5xdWFsaXR5Lmlzc3Vlcy5qb2luKCLjg7siKX1gKTsKICBXSy5kaWFnLnB1c2goe2QsY29kZSxuYW1lOnYudmVudWVOYW1lfHxWRU5VRVtjb2RlXXx8Y29kZSxyYWNlczpyYWNlcy5sZW5ndGgsb2s6b2subGVuZ3RoLGJhZCxpc3N1ZXMsZXJyOiFyYWNlcy5sZW5ndGg/IuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyI6IiJ9KTsKICBpZigoYmFkPjB8fG9rLmxlbmd0aDw4KSYmIWlzUmV0cnkpe2F3YWl0IHNsZWVwKDgwMCk7cmV0dXJuIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsdHJ1ZSl9CiB9Y2F0Y2goZSl7CiAgV0suZGlhZy5wdXNoKHtkLGNvZGUsbmFtZTp2LnZlbnVlTmFtZXx8VkVOVUVbY29kZV18fGNvZGUscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7CiAgaWYoIWlzUmV0cnkpe2F3YWl0IHNsZWVwKDEyMDApO3JldHVybiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LHRydWUpfQogfQp9CgovKiDjgqrjg4PjgrrvvIjljZjli53vvIvopIfli53vvInjgILlh7rppqzooajjga7jg6rjg7Pjgq/jgYvjgonnm7TmjqUg4oaSIOWPluOCjOOBquOBi+OBo+OBn+ODrOODvOOCueOBr+OAgeaXpeS7mOODu+mWi+WCrOWgtOOBruODoeODi+ODpeODvOe1jOeUseOBp+ijnOOBhiAqLwphc3luYyBmdW5jdGlvbiBmZXRjaE9kZHNEYXRlKGJhc2UsZCl7CiBjb25zdCBjYXJkcz1XSy5jYXJkc1tkXXx8W10sbm90ZXM9W107V0sub2Rkc05vdGVzPVdLLm9kZHNOb3Rlc3x8e307CiBpZighY2FyZHMubGVuZ3RoKXtXSy5vZGRzTm90ZXNbZF09bm90ZXM7cmV0dXJue246MCxub3Rlc319CiBjb25zdCB3aXRoTGluaz1jYXJkcy5maWx0ZXIocj0+ci5vZGRzQ25hbWUpLGJ5Qz1uZXcgTWFwKHdpdGhMaW5rLm1hcChyPT5bci5vZGRzQ25hbWUscl0pKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHdpdGhMaW5rLmxlbmd0aDtpKz02KWNodW5rcy5wdXNoKHdpdGhMaW5rLnNsaWNlKGksaSs2KS5tYXAocj0+ci5vZGRzQ25hbWUpKTsKIGxldCBjaT0wLGZhaWxOPTA7Y29uc3QgcmVhc29ucz17fTsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoY2k8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1jaSsrOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWAsWzE1MDBdKTsKICAgZm9yKGNvbnN0IGl0IG9mICh4Lml0ZW1zfHxbXSkpe2NvbnN0IHI9YnlDLmdldChpdC5jbmFtZSk7aWYocilXSy5vZGRzW3JrZXkoZCxyKV09e3RhbjppdC5vZGRzfHx7fSxwbGFjZTppdC5wbGFjZXx8e30sYXQ6RGF0ZS5ub3coKX19CiAgIGZvcihjb25zdCBmIG9mICh4LmZhaWxlZHx8W10pKXtmYWlsTisrO2NvbnN0IG09U3RyaW5nKGYucmVhc29ufHwiIikuc2xpY2UoMCw2MCk7cmVhc29uc1ttXT0ocmVhc29uc1ttXXx8MCkrMX0KICB9Y2F0Y2goZSl7ZmFpbE4rPWNodW5rc1trXS5sZW5ndGg7Y29uc3QgbT1TdHJpbmcoZS5tZXNzYWdlfHxlKS5zbGljZSgwLDYwKTtyZWFzb25zW21dPShyZWFzb25zW21dfHwwKSsxfX19OwogYXdhaXQgUHJvbWlzZS5hbGwoW3dvcmtlcigpLHdvcmtlcigpXSk7CiBjb25zdCBkaXJlY3Q9Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoOwogbm90ZXMucHVzaChg5Ye66aas6KGo44Gu44Oq44Oz44Kv44GL44KJ55u05o6l77yaJHtkaXJlY3R9LyR7Y2FyZHMubGVuZ3RofeODrOODvOOCue+8iOODquODs+OCr+OBguOCiiAke3dpdGhMaW5rLmxlbmd0aH3jgIHlpLHmlZcgJHtmYWlsTn3vvIlgKTsKIGZvcihjb25zdCBbbSxjXSBvZiBPYmplY3QuZW50cmllcyhyZWFzb25zKSlub3Rlcy5wdXNoKGDjgIDlpLHmlZfjga7nkIbnlLHvvJoke21977yIJHtjfe+8iWApOwogY29uc3QgbWlzc2luZz1jYXJkcy5maWx0ZXIocj0+IVdLLm9kZHNbcmtleShkLHIpXSk7CiBpZihtaXNzaW5nLmxlbmd0aCl7CiAgZm9yKGNvbnN0IHYgb2YgWy4uLm5ldyBTZXQobWlzc2luZy5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKSl7CiAgIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9kYXRlPSR7ZH0mdmVudWU9JHt2fWAsWzE1MDBdKTsKICAgIGZvcihjb25zdCByIG9mICh4LnJhY2VzfHxbXSkpV0sub2Rkc1tgJHtkfXwke1N0cmluZyhyLnZlbnVlQ29kZSkucGFkU3RhcnQoMiwiMCIpfS0ke3IucmFjZU5vfWBdPXt0YW46ci5vZGRzfHx7fSxwbGFjZTpyLnBsYWNlfHx7fSxhdDpEYXRlLm5vdygpfTsKICAgIG5vdGVzLnB1c2goYOODoeODi+ODpeODvOe1jOeUsSAke1ZFTlVFW3ZdfHx2fe+8miR7KHgucmFjZXN8fFtdKS5sZW5ndGh944Os44O844K55Y+W5b6X77yI44Kq44OD44K655S76Z2i44Gr6KaL44Gk44GL44Gj44Gf44Os44O844K5ICR7eC50YXJnZXRzPz8iPyJ977yP5b2T5pel5YWo5L2TICR7eC50YXJnZXRzQWxsPz8iPyJ977yJYCk7CiAgICBub3Rlcy5wdXNoKGDjgIDopovjgaTjgYvjgaPjgZ/jg6zjg7zjgrnnlarlj7fvvJokeyh4LmZvdW5kUmFjZU5vc3x8W10pLmpvaW4oIiwiKXx8IuOBquOBlyJ977yP6Kqt44G/5Y+W44KM44Gq44GL44Gj44Gf77yaJHsoeC5ub1BhcnNlfHxbXSkuam9pbigiLCIpfHwi44Gq44GXIn1gKTsKICAgfWNhdGNoKGUpe25vdGVzLnB1c2goYOODoeODi+ODpeODvOe1jOeUsSAke1ZFTlVFW3ZdfHx2fe+8muWkseaVl++8iCR7U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCw4MCl977yJYCl9fQogfQogY29uc3Qgc3RpbGw9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYoc3RpbGwubGVuZ3RoKW5vdGVzLnB1c2goYOOCquODg+OCuuacquWPluW+l++8miR7c3RpbGwubWFwKHI9PihyLnZlbnVlTmFtZXx8IiIpK3IucmFjZU51bWJlcisiUiIpLmpvaW4oIuOAgSIpfe+8iOeZuuWjsuWJjeOAgeOBvuOBn+OBr+iqreOBv+WPluOCjOOBpuOBhOOBvuOBm+OCk++8iWApOwogV0sub2Rkc05vdGVzW2RdPW5vdGVzOwogcmV0dXJue246Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoLG5vdGVzfTsKfQoKYXN5bmMgZnVuY3Rpb24gd2Vla2VuZEdvKCl7CiBjb25zdCBiYXNlPWJhc2VVcmwoKTskKCJ3a0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJ3a09kZHMiKS5kaXNhYmxlZD10cnVlOwogV0suZGF0ZXM9W107V0suY2FyZHM9e307V0sub2Rkcz17fTtXSy5kaWFnPVtdO1dLLmNhbGM9e307CiB0cnl7CiAgd2tNc2coIumWi+WCrOaXpeOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IHRvZGF5PWpzdFRvZGF5KCk7bGV0IGRhdGVzPVtdOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHt0b2RheX0mbGlzdD0xYCxbMTUwMF0pO2RhdGVzPSh4LmF2YWlsYWJsZURhdGVzfHxbXSkuZmlsdGVyKGQ9PmQ+PXRvZGF5KX1jYXRjaChlKXt9CiAgaWYoIWRhdGVzLmxlbmd0aClkYXRlcz1uZXh0V2Vla2VuZCh0b2RheSk7CiAgZGF0ZXM9Wy4uLm5ldyBTZXQoZGF0ZXMpXS5zb3J0KCkuc2xpY2UoMCwzKTsKICBmb3IoY29uc3QgZCBvZiBkYXRlcyl7CiAgIHdrTXNnKGAke2R9IOmWi+WCrOWgtOOCkueiuuiqjeS4reKApmApOwogICBsZXQgdmVudWVzPVtdOwogICB0cnl7dmVudWVzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZH0mbGlzdD0xYCxbMTUwMF0pKS52ZW51ZXN8fFtdfQogICBjYXRjaChlKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs5aC05LiA6KanKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7Y29udGludWV9CiAgIGlmKCF2ZW51ZXMubGVuZ3RoKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs44Gq44GXKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6IuOBk+OBruaXpeOBruWHuummrOihqOOBr+acquWFrOmWi+OAgeOBvuOBn+OBr+mWi+WCrOOBjOOBguOCiuOBvuOBm+OCkyJ9KTtjb250aW51ZX0KICAgV0suY2FyZHNbZF09W107CiAgIGZvcihjb25zdCB2IG9mIHZlbnVlcyl7d2tNc2coYCR7ZH0gJHt2LnZlbnVlTmFtZXx8di52ZW51ZUNvZGV9IOOBruWHuummrOihqOOCkuWPluW+l+S4reKApu+8iCR7KFdLLmNhcmRzW2RdfHxbXSkubGVuZ3RofeODrOODvOOCueWPluW+l+a4iOOBv++8iWApO2F3YWl0IGxvYWRWZW51ZUludG8oYmFzZSxkLHYpfQogICBpZigoV0suY2FyZHNbZF18fFtdKS5sZW5ndGgpV0suZGF0ZXMucHVzaChkKTsKICB9CiAgaWYoIVdLLmRhdGVzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuWHuummrOihqOOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAguOAjOWPluOCiui+vOOBv+eKtuazgeOAjeOCv+ODluOCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogIGxldCBvZGRzTj0wLHRvdGFsPTA7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpe3drTXNnKGAke2R9IOOCquODg+OCuuOCkuWPluW+l+S4reKApmApO29kZHNOKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlLGQpKS5uO3RvdGFsKz1XSy5jYXJkc1tkXS5sZW5ndGh9CiAgd2tNc2coIumBjuWOu+ODh+ODvOOCv+OBqOeFp+WQiOOBl+OBpuOAgeWFqOODrOODvOOCueOCkuino+aekOS4reKApiIpOwogIGF3YWl0IGNhbGNXZWVrZW5kKCk7V0suYXQ9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxNik7CiAgcmVuZGVyQWxsKCk7CiAgY29uc3QgbnI9V0suZGF0ZXMucmVkdWNlKChzLGQpPT5zK1dLLmNhcmRzW2RdLmxlbmd0aCwwKTsKICB3a01zZyhg5a6M5LqG77yIJHtXSy5hdH3vvInvvJoke1dLLmRhdGVzLmpvaW4oIuOAgSIpfe+8jyR7bnJ944Os44O844K577yP44Kq44OD44K6ICR7b2Rkc05944Os44O844K5JHtvZGRzTj8iIjoi77yI55m65aOy5YmN44Gu44Gf44KB5pyq5Y+W5b6X44CC55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN77yJIn1gKTsKICAkKCJ3a09kZHMiKS5kaXNhYmxlZD1mYWxzZTtzaG93VGFiKCJ2QXhpcyIpOwogfWNhdGNoKGUpe3drTXNnKCLjgqjjg6njg7zvvJoiK2UubWVzc2FnZSk7YnVzeShmYWxzZSk7cmVuZGVyQWxsKCl9CiBmaW5hbGx5eyQoIndrR28iKS5kaXNhYmxlZD1mYWxzZX0KfQphc3luYyBmdW5jdGlvbiBvZGRzT25seSgpewogaWYoIVdLLmRhdGVzLmxlbmd0aClyZXR1cm47JCgid2tPZGRzIikuZGlzYWJsZWQ9dHJ1ZTsKIHRyeXtsZXQgbj0wO2Zvcihjb25zdCBkIG9mIFdLLmRhdGVzKXt3a01zZyhgJHtkfSDjgqrjg4PjgrrjgpLmm7TmlrDkuK3igKZgKTtuKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlVXJsKCksZCkpLm59CiAgYXdhaXQgY2FsY1dlZWtlbmQoKTtXSy5hdD1uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDExLDE2KTtyZW5kZXJBbGwoKTt3a01zZyhg44Kq44OD44K65pu05paw77yIJHtXSy5hdH3vvInvvJoke25944Os44O844K55YiGYCl9CiBjYXRjaChlKXt3a01zZygi5pu05paw44Ko44Op44O877yaIitlLm1lc3NhZ2UpfWZpbmFsbHl7JCgid2tPZGRzIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDop6PmnpDvvIgx44Os44O844K577yJ77ya6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuiA9IOacn+W+heWApOOAgeazouS5seW6puOAgemJhOadvwogKiAg6KSH5Yud56K6546H77ya44Kq44OD44K644GC44KK4oaS5biC5aC05oOF5aCx44KC5L2/44GG5a2m57+S5riI44G/44Oi44OH44OrKHBPKe+8j+OBquOBl+KGkumBjuWOu+aIkOe4vuOBruOBv+OBruODouODh+ODqyhwUCkKICogIOikh+WLneOCquODg+OCuu+8mkpSQeOBruikh+WLneOCquODg+OCuu+8iOS4i+mZkOOAnOS4iumZkO+8ieOAguiqreOCgeOBquOBhOOBqOOBjeOBr+WNmOWLneOBi+OCieaOqOWumu+8iMOX6KGo56S677yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KZnVuY3Rpb24gY2FsY1JhY2UoZCxjLHN0b3JlKXsKIGNvbnN0IHJhY2U9bWtSYWNlKGMsZCk7bGV0IG49cmFjZS5ydW5uZXJzLmxlbmd0aDtjb25zdCBzY3JhdGNoZWQ9W107CiB7Y29uc3QgbzA9V0sub2Rkc1tya2V5KGQsYyldOwogIGlmKG8wKXtjb25zdCBtaXNzPXJhY2UucnVubmVycy5maWx0ZXIocj0+IShvMC50YW5bci5udW1dPjEpKSxoYXZlPXJhY2UucnVubmVycy5sZW5ndGgtbWlzcy5sZW5ndGg7CiAgIC8vIOS4gOmDqOOBrummrOOBoOOBkeOCquODg+OCuuOBjOeEoeOBhO+8neWPlua2iOODu+mZpOWkluOBruWPr+iDveaAp+OBjOmrmOOBhOOAguWkluOBl+OBpuOAgeOCquODg+OCuui+vOOBv+OBp+ino+aekOOBmeOCi++8iOWkp+WNiuOBjOasoOOBkeOBpuOBhOOCi+OBquOCieWkluOBleOBquOBhO+8iQogICBpZihtaXNzLmxlbmd0aCYmaGF2ZT49NiYmbWlzcy5sZW5ndGg8PU1hdGgubWF4KDMsTWF0aC5mbG9vcihyYWNlLnJ1bm5lcnMubGVuZ3RoKi4yKSkpe3NjcmF0Y2hlZC5wdXNoKC4uLm1pc3MubWFwKHI9PnIubnVtKSk7cmFjZS5ydW5uZXJzPXJhY2UucnVubmVycy5maWx0ZXIocj0+bzAudGFuW3IubnVtXT4xKTtuPXJhY2UucnVubmVycy5sZW5ndGh9fX0KIGNvbnN0IGJhc2U9e2QsY2FyZDpjLHJhY2UsbixzY3JhdGNoZWQsa2V5OnJrZXkoZCxjKSx2ZW51ZTpjLnZlbnVlTmFtZXx8Yy52ZW51ZXx8IiIsbm86TnVtYmVyKGMucmFjZU51bWJlcil8fDAsCiAgbGFiZWw6YCR7Yy52ZW51ZU5hbWV8fGMudmVudWV8fCIifSR7Yy5yYWNlTnVtYmVyfHwiIn1SICR7Yy5yYWNlTmFtZXx8IiJ9YCxjb3Vyc2U6Yy5zdXJmYWNlJiZjLmRpc3RhbmNlP2Ake2Muc3VyZmFjZX0ke2MuZGlzdGFuY2V9bWA6IuOCs+ODvOOCueS4jeaYjiJ9OwogaWYoL+manOWusy8udGVzdCgoYy5yYWNlTmFtZXx8IiIpKyhjLmNsYXNzTmFtZXx8IiIpKSlyZXR1cm57Li4uYmFzZSxza2lwOiLpmpzlrrPjg6zjg7zjgrnjga/lr77osaHlpJbvvIjlubPlnLDnlKjjga7jg6Ljg4fjg6vjga7jgZ/jgoHvvIkifTsKIGlmKG48NilyZXR1cm57Li4uYmFzZSxza2lwOiI26aCt5pyq5rqAIn07CiBjb25zdCBvPVdLLm9kZHNbYmFzZS5rZXldLG9kZHM9bz9yYWNlLnJ1bm5lcnMubWFwKHI9Pm8udGFuW3IubnVtXSk6bnVsbCxoYXNPZGRzPSEhKG9kZHMmJm9kZHMuZXZlcnkoeD0+eD4xKSk7CiBjb25zdCBvZD1oYXNPZGRzP29kZHM6bnVsbDsKIGNvbnN0IHJlcz1VRS5hbmFseXplKHJhY2Usc3RvcmUsb2QpLGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKTtsZXQgdWc9VUUudXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kLGFwKTsKIGNvbnN0IFVNPWdldFVwc2V0TW9kZWwoKTsKIGlmKFVNJiZzdG9yZS51cCl7dHJ5e2NvbnN0IHU9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kLGFwKSxpbmY9e3Y6U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpLG5vOk51bWJlcihjLnJhY2VOdW1iZXIpfHwwLHN1cmY6cmFjZS5zdXJmLGRpc3Q6cmFjZS5kaXN0LGx2bDpyYWNlLmx2bCxncmQ6cmFjZS5ncmQsTjpufSxjdT11cHNldEN1c3RvbShVTSx1LHN0b3JlLnVwLmZlYXQoaW5mKSxwYWNlRmVhdChyYWNlLnJ1bm5lcnMsc3RvcmUpKTtpZihjdSl1Zz17Li4udWcsLi4uY3UsbW9kZTp1Lm1vZGUsY3VzdG9tOnRydWV9fWNhdGNoKGUpe319CiBjb25zdCBheGlzPWhhc09kZHM/VUUuYXhpc1BpY2tzKHJhY2Usc3RvcmUsb2QsYXApOm51bGw7CiBjb25zdCBtMz1oYXNPZGRzP1VFLnRvcDNGcm9tV2luKG9kLm1hcCh4PT4xL3gpKTpudWxsOwogY29uc3QgaG9yc2VzPXJhY2UucnVubmVycy5tYXAoKHIsaSk9PnsKICBjb25zdCBwPWhhc09kZHM/YXAucE9baV06YXAucFBbaV0scGw9byYmby5wbGFjZSYmby5wbGFjZVtyLm51bV07CiAgbGV0IGxvPW51bGwsaGk9bnVsbCxzcmM9bnVsbDsKICBpZihwbCYmcGwubGVuZ3RoPT09MiYmcGxbMF0+PTEpe2xvPXBsWzBdO2hpPXBsWzFdO3NyYz0i5a6fIn0KICBlbHNlIGlmKG0zKXtsbz1NYXRoLm1heCgxLDAuOC9NYXRoLm1heChtM1tpXSwuMDIpKTtoaT1sbztzcmM9IuaOqOWumiJ9CiAgY29uc3QgdHI9c3RvcmUudHImJnIudHJhaW5lcj9zdG9yZS50ci5nZXQoci50cmFpbmVyKTpudWxsLHg9cmVzW2ldOwogIHJldHVybntpLG5vOnIubnVtLG5hbWU6ci5uYW1lLGpuYW1lOnIuam5hbWUsdHJhaW5lcjpyLnRyYWluZXIsdHJOOnRyP3RyLm46MCx0clJhdGU6dHImJnRyLm4/dHIudDMvdHIubjpudWxsLGpuOnguam4sCiAgIHAsbG8saGksc3JjLGV2OmxvP3AqbG86bnVsbCxldk1pZDpsbz9wKihsbytoaSkvMjpudWxsLHdpbjpoYXNPZGRzP29kW2ldOm51bGwscG9wOngucG9wLGhvbGU6eC5ob2xlLHBjOngucGMsbW9kZTp4Lm1vZGUsbjp4Lm4sCiAgIGNhcmVlcjp4LmNhcmVlcixyZWNlbnQ6eC5yZWNlbnQsdGFnczp4LnRhZ3MscmF0aW5nOlVFLnJhdGluZyh4LnBjLHgubW9kZSx4Lm4pLHh9fSk7CiByZXR1cm57Li4uYmFzZSxoYXNPZGRzLHJlcyxhcCx1ZyxheGlzLGhvcnNlcyxwbGFjZVJlYWw6aG9yc2VzLmZpbHRlcihoPT5oLnNyYz09PSLlrp8iKS5sZW5ndGh9Owp9CmFzeW5jIGZ1bmN0aW9uIGNhbGNXZWVrZW5kKCl7CiBXSy5jYWxjPXt9OwogY29uc3Qgc3RvcmU9YXdhaXQgYnVpbGRTdG9yZShXSy5kYXRlc1swXSk7CiBXSy5zdG9yZUluZm89e2xhc3Q6c3RvcmUubGFzdERhdGV8fCIiLGNvdW50OnN0b3JlLmNvdW50fTsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBjb25zdCBjcz1bLi4uV0suY2FyZHNbZF1dLnNvcnQoKGEsYik9PlN0cmluZyhhLnZlbnVlQ29kZSkubG9jYWxlQ29tcGFyZShTdHJpbmcoYi52ZW51ZUNvZGUpKXx8KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogIFdLLmNhbGNbZF09e3JhY2VzOltdfTsKICBmb3IobGV0IGk9MDtpPGNzLmxlbmd0aDtpKyspewogICB0cnl7V0suY2FsY1tkXS5yYWNlcy5wdXNoKGNhbGNSYWNlKGQsY3NbaV0sc3RvcmUpKX0KICAgY2F0Y2goZSl7V0suY2FsY1tkXS5yYWNlcy5wdXNoKHtkLGNhcmQ6Y3NbaV0sc2tpcDoi6Kej5p6Q44Ko44Op44O877yaIitlLm1lc3NhZ2UsbGFiZWw6YCR7Y3NbaV0udmVudWVOYW1lfHwiIn0ke2NzW2ldLnJhY2VOdW1iZXJ8fCIifVJgLHZlbnVlOmNzW2ldLnZlbnVlTmFtZXx8IiIsbm86Y3NbaV0ucmFjZU51bWJlcnx8MCxob3JzZXM6W119KX0KICAgaWYoaSU0PT09Mylhd2FpdCBzbGVlcCgwKTsKICB9CiB9Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDmpJzoqLzjgrLjg7zjg4jvvJrlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPjgafjgIHoqqTlt67jgpLlvJXjgYTjgabjgoLlm57lj47njocxMDAl5Lul5LiK44Gu6LK344GE5pa544Gg44GR44CM5qSc6Ki85riI44G/44CNCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgR0FURV9LRVk9ImtlaWJhX2dhdGVfdjIiOwpjb25zdCBnZXRHYXRlPSgpPT57dHJ5e3JldHVybiBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKEdBVEVfS0VZKXx8Im51bGwiKX1jYXRjaChlKXtyZXR1cm4gbnVsbH19Owpjb25zdCBTVFJBVD17Zm9jdXM6IueptOmmrO+8iOKXjueahOS4reeOh+mHjeimlu+8iSIsdG9wMToi56m06aasMeS9jSIsdG9wMjoi56m06aas5LiK5L2NMumgrSIsdmFsdWU6IuWmmeWRszEuM+WAjeS7peS4iiIsYXhpczoi6YmE5p2/6Lu4In07CmZ1bmN0aW9uIHNldEdhdGUob3V0LG91dFApewogY29uc3QgaXRlbXM9W107CiBmb3IoY29uc3QgW3NyYyxvXSBvZiBbWyLjgqrjg4PjgrrjgYLjgooiLG91dF0sWyLjgqrjg4PjgrrjgarjgZciLG91dFBdXSl7CiAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoU1RSQVQpKXsKICAgY29uc3Qgdj1vLnN0YXRzW2tdO2lmKCF2KWNvbnRpbnVlOwogICBjb25zdCBzZWc9KHYuQyYmdi5DLmJldHM+PTMwMCk/di5DOnYuYWxsO2lmKCFzZWd8fCFzZWcuYmV0cyljb250aW51ZTsKICAgY29uc3QgbG93PXNlZy5yb2ktMS45NipzZWcuc2U7CiAgIGl0ZW1zLnB1c2goe2tleTprLGxhYmVsOlNUUkFUW2tdKyLvvIgiK3NyYysi77yJIixyb2k6c2VnLnJvaSxsb3csYmV0czpzZWcuYmV0cyxoaXQ6c2VnLmhpdFJhdGUsc2VnOnNlZz09PXYuQz8i5a2m57+S5b6MIjoi5YWo5pyf6ZaTIn0pOwogIH0KIH0KIGxvY2FsU3RvcmFnZS5zZXRJdGVtKEdBVEVfS0VZLEpTT04uc3RyaW5naWZ5KHthdDpuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCksaXRlbXN9KSk7CiByZW5kZXJHYXRlKCk7Cn0KY29uc3Qgc3RyYXRPaz1rZXk9Pntjb25zdCBnPWdldEdhdGUoKTtyZXR1cm4gISEoZyYmZy5pdGVtcy5zb21lKHg9Pngua2V5PT09a2V5JiZ4Lmxvdz49MSYmeC5iZXRzPj0zMDApKX07CmNvbnN0IHN0cmF0Q2hpcD1rZXk9PnN0cmF0T2soa2V5KT8nPHNwYW4gY2xhc3M9ImNoaXAgYiI+5qSc6Ki85riI44G/77yI5Zue5Y+O546HMTAwJei2he+8iTwvc3Bhbj4nOic8c3BhbiBjbGFzcz0iY2hpcCByIj7lm57lj47njocxMDAl6LaF44Gv5pyq56K66KqNPC9zcGFuPic7CmZ1bmN0aW9uIHJlbmRlckdhdGUoKXsKIGNvbnN0IGc9Z2V0R2F0ZSgpLGVsPSQoImdhdGUiKTsKIGlmKCFnKXtlbC5pbm5lckhUTUw9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+PGI+5Zue5Y+O546H77ya5pyq5qSc6Ki8PC9iPuOAgOOAjOaknOiovOOAjeOCv+ODluOCkuWun+ihjOOBmeOCi+OBvuOBp+OAgeOBqeOBruiyt+OBhOaWueOCguOAjDEwMCXotoXjgI3jgajjga/oqIDjgYjjgb7jgZvjgpPjgILvvIjku6XliY3jga7mpJzoqLzjgafjga/jgIHnqbTppqwx5L2N44Gu6KSH5Yud5Zue5Y+O546H44Gv57SENzLjgJw3NyXjgafjgZfjgZ/vvIk8L2Rpdj4nO3JldHVybn0KIGNvbnN0IG9rPWcuaXRlbXMuZmlsdGVyKHg9PngubG93Pj0xJiZ4LmJldHM+PTMwMCksYmVzdD1nLml0ZW1zLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi5yb2ktYS5yb2kpWzBdOwogaWYob2subGVuZ3RoKWVsLmlubmVySFRNTD1gPGRpdiBjbGFzcz0iYmFubmVyIG9rIj48Yj7mpJzoqLzmuIjjgb/vvIjlm57lj47njocxMDAl6LaF77yJ77yaPC9iPiR7b2subWFwKHg9PmAke2VzYyh4LmxhYmVsKX0gJHtwY3QoeC5yb2kpfe+8iOS4i+mZkCR7cGN0KHgubG93KX3jg7ske3guYmV0cy50b0xvY2FsZVN0cmluZygpfeWbnuODuyR7eC5zZWd977yJYCkuam9pbigi77yPIil9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5qSc6Ki85pelICR7ZXNjKGcuYXQpfeOAgumBjuWOu+OBruaIkOe4vuOBp+OBrue1kOaenOOBp+OAgeS7iuW+jOOCgue2muOBj+S/neiovOOBr+OBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj48L2Rpdj5gOwogZWxzZSBlbC5pbm5lckhUTUw9YDxkaXYgY2xhc3M9ImJhbm5lciBuZyI+PGI+5Zue5Y+O546HMTAwJei2heOCkueiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBr+OAgeOBvuOBoOOBguOCiuOBvuOBm+OCk+OAgjwvYj4ke2Jlc3Q/YOacgOmrmOOBp+OCgiAke2VzYyhiZXN0LmxhYmVsKX0g44GuICR7cGN0KGJlc3Qucm9pKX3vvIjoqqTlt67jgpLlvJXjgY/jgagke3BjdChiZXN0Lmxvdyl944O7JHtiZXN0LmJldHMudG9Mb2NhbGVTdHJpbmcoKX3lm57jg7ske2Jlc3Quc2Vnfe+8ieOAgmA6IiJ9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5qSc6Ki85pelICR7ZXNjKGcuYXQpfeOAguS4i+OBruWAmeijnOOBr+OAjOW9k+OBn+OCiuOChOOBmeOBleODu+acn+W+heWApOOBruebruWuieOAjeOBqOOBl+OBpuS9v+OBo+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj48L2Rpdj5gOwp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog6KGo56S6CiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgR1JBREVfT1JERVI9WyJTU1MiLCJTUyIsIlMiLCJBIiwiQiIsIkMiXSxHUkFERV9DT0xPUj17U1NTOiIjYjQyMzE4IixTUzoiI2Q5MmQyMCIsUzoiI2Y3OTAwOSIsQToiIzE2NjdkOSIsQjoiIzY2NzA4NSIsQzoiIzk4YTJiMyJ9Owpjb25zdCBkYXlMYWJlbD1kPT57Y29uc3Qgdz0i5pel5pyI54Gr5rC05pyo6YeR5ZyfIltuZXcgRGF0ZShkKyJUMDA6MDA6MDBaIikuZ2V0VVRDRGF5KCldO3JldHVybiBgJHtkLnNsaWNlKDUpLnJlcGxhY2UoIi0iLCIvIil9KCR7d30pYH07CmNvbnN0IGNhbGNSYWNlcz1kPT4oV0suY2FsY1tkXSYmV0suY2FsY1tkXS5yYWNlcyl8fFtdOwpjb25zdCBhbGxSYWNlcz0oKT0+V0suZGF0ZXMuZmxhdE1hcChkPT5jYWxjUmFjZXMoZCkpOwpjb25zdCBub0RhdGE9bXNnPT5gPGRpdiBjbGFzcz0ic21hbGwiPiR7bXNnfHwi44CM4pGgIOS7iumAseacq+OBruODrOODvOOCueOCkuWPluW+l+OBl+OBpuS6iOaDs+OBmeOCi+OAjeOCkuaKvOOBmeOBqOihqOekuuOBleOCjOOBvuOBmeOAgiJ9PC9kaXY+YDsKCmZ1bmN0aW9uIHJlbmRlckFsbCgpe3JlbmRlckdhdGUoKTtyZW5kZXJBeGlzKCk7cmVuZGVyRXYoKTtyZW5kZXJVcHNldCgpO3JlbmRlckhvbGUoKTtyZW5kZXJSYWNlcygpO3JlbmRlclN1bSgpfQoKLyogLS0tIOi2hemJhOadv++8iOikh+WLneWcj+WGheOBruS6iOa4rOeiuueOh+OBjOmrmOOBhOi7uOmmrO+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyQXhpcygpewogY29uc3QgZWw9JCgidkF4aXMiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgQj1VRS5BWElTLmJhbmRzOwogbGV0IGg9YDxoMj7otoXpiYTmnb/vvIjopIfli53lnI/lhoUg57SEOTUl5Lul5LiK77yJPC9oMj4ke3N0cmF0Q2hpcCgiYXhpcyIpfQogPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBoOOBkeWIpOWumuOBl+OBvuOBmeOAgumBjuWOu+OBruWun+e4vu+8mjxiPumJhOadvzwvYj7vvIjkuojmuKwke3BjdChCWyLpiYTmnb8iXS5sbyl95Lul5LiK77yJ44Gv5a6f6Zqb44GrPGI+JHtwY3QoQlsi6YmE5p2/Il0ucmF0ZSwxKX08L2I+44GMM+edgOS7peWGhe+8iCR7Qlsi6YmE5p2/Il0ubn3poK3jgIHoqqTlt67jgpLlvJXjgYTjgabjgoIke3BjdChCWyLpiYTmnb8iXS5sbzk1LDEpfe+8ieOAgTHml6XjgYLjgZ/jgorntIQke0JbIumJhOadvyJdLnBlckRheX3poK3jgIIx5pel44Gr5pyA5aSnMumgreOBoOOBkeWHuuOBl+OBvuOBmeOAgjwvZGl2PmA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgcnM9Y2FsY1JhY2VzKGQpLHBpY2tzPVtdOwogIGZvcihjb25zdCByIG9mIHJzKWlmKHIuYXhpcylmb3IoY29uc3QgeCBvZiByLmF4aXMpcGlja3MucHVzaCh7cix4LGhoOnIuaG9yc2VzW3guaV19KTsKICBwaWNrcy5zb3J0KChhLGIpPT5iLngucC1hLngucCk7CiAgY29uc3Qgbk9kZHM9cnMuZmlsdGVyKHI9PiFyLnNraXAmJnIuaGFzT2RkcykubGVuZ3RoLG5BbGw9cnMuZmlsdGVyKHI9PiFyLnNraXApLmxlbmd0aDsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl944CAPHNwYW4gY2xhc3M9InNtYWxsIj7jgqrjg4Pjgrrlj5blvpcgJHtuT2Rkc30vJHtuQWxsfeODrOODvOOCuTwvc3Bhbj48L2gzPmA7CiAgaWYoIW5PZGRzKXtoKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4PjgrrjgYzmnKrlj5blvpfjga7jgZ/jgoHliKTlrprjgafjgY3jgb7jgZvjgpPvvIjnmbrlo7Lplovlp4vlvozjgavjgIzjgqrjg4PjgrrjgaDjgZHmm7TmlrDjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTvvInjgII8L2Rpdj4nO2NvbnRpbnVlfQogIGNvbnN0IGlyb249cGlja3MuZmlsdGVyKHo9PnoueC50aWVyPT09IumJhOadvyIpLnNsaWNlKDAsMik7CiAgY29uc3QgcmVzdD1waWNrcy5maWx0ZXIoej0+ei54LnRpZXIhPT0i6YmE5p2/Iikuc2xpY2UoMCwyKTsKICBjb25zdCBjYXJkPSh6LHRhZyk9PmA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyh6LnIubGFiZWwpfTwvYj7jgIA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHouci5jb3Vyc2UpfeODuyR7ei5yLm596aCtPC9zcGFuPjxicj48Yj4ke3ouaGgubm9955WqICR7ZXNjKHouaGgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgckEiPiR7dGFnfTwvc3Bhbj7jgIDkuojmuKwgJHtwY3Qoei54LnApfTxicj4KICAgPHNwYW4gY2xhc3M9InNtYWxsIj7pqI7miYvvvJoke2VzYyh6LmhoLmpuYW1lfHwi5LiN5piOIil977yP6Kq/5pWZ5bir77yaJHtlc2Moei5oaC50cmFpbmVyfHwi5LiN5piOIil977yP5Y2Y5YudICR7ei5oaC53aW4/ei5oaC53aW4rIuWAjSI6Ii0ife+8j+ikh+WLnSAke3ouaGgubG8/ei5oaC5sby50b0ZpeGVkKDEpKyh6LmhoLmhpPnouaGgubG8/IuOAnCIrei5oaC5oaS50b0ZpeGVkKDEpOiIiKSsi5YCNIisoei5oaC5zcmM9PT0i5o6o5a6aIj8iKOaOqOWumikiOiIiKToiLSJ977yP44GT44Gu5Yy65YiG44Gu6YGO5Y675a6f57i+ICR7cGN0KHoueC5yYXRlLDEpfTwvc3Bhbj48L2Rpdj5gOwogIGlmKGlyb24ubGVuZ3RoKWgrPWlyb24ubWFwKHo9PmNhcmQoeiwi6LaF6YmE5p2/IikpLmpvaW4oIiIpOwogIGVsc2UgaCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+6LaF6YmE5p2/77yI5LqI5risOTIl5Lul5LiK77yJ44Gr6Kmy5b2T44GZ44KL6aas44Gv44GE44G+44Gb44KT44CC54Sh55CG44Gr6LK344KP44Gq44GE44Gu44KC5LiA44Gk44Gu5Yik5pat44Gn44GZ44CCPC9kaXY+JzsKICBpZighaXJvbi5sZW5ndGgmJnJlc3QubGVuZ3RoKWgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5Y+C6ICD77yIOTUl44Gr44Gv5bGK44GL44Gq44GE6Lu45YCZ6KOc77yJ77yaPC9kaXY+YCtyZXN0Lm1hcCh6PT5jYXJkKHosei54LnRpZXIpKS5qb2luKCIiKTsKIH0KIGVsLmlubmVySFRNTD1oOwp9CgovKiAtLS0g5pyf5b6F5YCk77yI6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuu+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyRXYoKXsKIGNvbnN0IGVsPSQoInZFdiIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCBldk1pbj1OdW1iZXIoJCgiZXZNaW4iKT8kKCJldk1pbiIpLnZhbHVlOjEuMDUpLHBNaW49TnVtYmVyKCQoImV2UCIpPyQoImV2UCIpLnZhbHVlOi4yNSk7CiBjb25zdCByb3dzPVtdOwogZm9yKGNvbnN0IHIgb2YgYWxsUmFjZXMoKSlpZighci5za2lwKWZvcihjb25zdCBoIG9mIHIuaG9yc2VzKWlmKGguZXYhPW51bGwmJmguZXY+PWV2TWluJiZoLnA+PXBNaW4pcm93cy5wdXNoKHtyLGh9KTsKIHJvd3Muc29ydCgoYSxiKT0+Yi5oLmV2LWEuaC5ldik7CiBjb25zdCBuT2Rkcz1hbGxSYWNlcygpLmZpbHRlcihyPT5yLmhhc09kZHMpLmxlbmd0aDsKIGxldCBoPWA8aDI+5pyf5b6F5YCk77yI6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuu+8iTwvaDI+JHtzdHJhdENoaXAoInZhbHVlIil9CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5pyf5b6F5YCk77yd44Gd44Gu6aas44GMM+edgOS7peWGheOBq+WFpeOCi+eiuueOhyDDlyDopIfli53jgqrjg4Pjgrrjga7kuIvpmZDjgIIxLjDjgpLotoXjgYjjgozjgbDjgIHnkIboq5bkuIrjga/osrfjgYTntprjgZHjgabjg5fjg6njgrnjgafjgZnjgILopIfli53jgqrjg4Pjgrrjga88Yj7lrp88L2I+77ydSlJB44Gu5a6f44Kq44OD44K644CBPGI+5o6o5a6aPC9iPu+8neWNmOWLneOBi+OCieioiOeul+OBl+OBn+ebruWuieOAgueiuueOh+OBruimi+epjeOCguOCiumBleOBhOOBjOWkp+OBjeOBj+WKueOBj+OBn+OCgeOAgeOAjOaknOiovOOAjeOBpzEwMCXotoXjgYznorroqo3jgZXjgozjgovjgb7jgafjga/nm67lronjgajjgZfjgabkvb/jgaPjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyBzbWFsbCI+5pyf5b6F5YCkIDxzZWxlY3QgaWQ9ImV2TWluIj48b3B0aW9uIHZhbHVlPSIxIj4xLjAw5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMS4wNSI+MS4wNeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjEuMSI+MS4xMOS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjEuMiI+MS4yMOS7peS4ijwvb3B0aW9uPjwvc2VsZWN0PiDopIfli53norrnjocgPHNlbGVjdCBpZD0iZXZQIj48b3B0aW9uIHZhbHVlPSIwLjE1Ij4xNSXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwLjI1Ij4yNSXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwLjQiPjQwJeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjAuNiI+NjAl5Lul5LiKPC9vcHRpb24+PC9zZWxlY3Q+PC9kaXY+YDsKIGlmKCFuT2Rkcyl7ZWwuaW5uZXJIVE1MPWgrJzxkaXYgY2xhc3M9ImJhbm5lciB3biI+44Kq44OD44K644GM5pyq5Y+W5b6X44Gu44Gf44KB44CB5pyf5b6F5YCk44Gv6KiI566X44Gn44GN44G+44Gb44KT77yI55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN77yJ44CCPC9kaXY+JztiaW5kRXYoZXZNaW4scE1pbik7cmV0dXJufQogaWYoIXJvd3MubGVuZ3RoKWgrPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuadoeS7tuOBq+WQiOOBhummrOOBr+OBhOOBvuOBm+OCk+OAgjwvZGl2Pic7CiBlbHNlewogIGgrPWA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6aasPC90aD48dGg+56K6546HPC90aD48dGg+6KSH5YudPC90aD48dGg+5pyf5b6F5YCkPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IHtyLGg6eH0gb2Ygcm93cy5zbGljZSgwLDQwKSloKz1gPHRyPjx0ZD4ke2VzYyhkYXlMYWJlbChyLmQpKX0gJHtlc2Moci5sYWJlbCl9PGJyPjxiPiR7eC5ub33nlaogJHtlc2MoeC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2MoeC5qbmFtZXx8IiIpfTwvc3Bhbj48L3RkPjx0ZD4ke3BjdCh4LnApfTwvdGQ+PHRkPiR7eC5sby50b0ZpeGVkKDEpfSR7eC5oaT54LmxvPyLjgJwiK3guaGkudG9GaXhlZCgxKToiIn08c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5zcmN9PC9zcGFuPjwvdGQ+PHRkPjxiPiR7eC5ldi50b0ZpeGVkKDIpfTwvYj48L3RkPjwvdHI+YDsKICBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiB9CiBlbC5pbm5lckhUTUw9aDtiaW5kRXYoZXZNaW4scE1pbik7Cn0KZnVuY3Rpb24gYmluZEV2KGEsYil7Y29uc3QgZT0kKCJldk1pbiIpLHA9JCgiZXZQIik7aWYoIWUpcmV0dXJuO2UudmFsdWU9U3RyaW5nKGEpO3AudmFsdWU9U3RyaW5nKGIpO2Uub25jaGFuZ2U9cC5vbmNoYW5nZT1yZW5kZXJFdn0KCi8qIC0tLSDms6LkubHluqYgLS0tICovCmZ1bmN0aW9uIHJlbmRlclVwc2V0KCl7CiBjb25zdCBlbD0kKCJ2VXBzZXQiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogbGV0IGg9YDxoMj7jg6zjg7zjgrnjga7ms6LkubHluqbvvIhTU1PjgJxD77yJPC9oMj48ZGl2IGNsYXNzPSJzbWFsbCI+44CMM+edgOS7peWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK44CN44Gr44Gq44KL56K6546H44Gn562J57Sa44Gl44GR44GX44Gm44GE44G+44GZ77yI5YWo44Os44O844K55bmz5Z2HIOe0hDI4LjUl77yJ44CC44Kq44OD44K644GM5Y+W44KM44Gf44Os44O844K544Gv44CB44Kq44OD44K66L6844G/44Gu5Yik5a6a44Gr44Gq44KK44G+44GZ44CCPC9kaXY+JHt1cHNldFN0YXR1c0xpbmUoKX1gOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IHJzPWNhbGNSYWNlcyhkKS5maWx0ZXIocj0+IXIuc2tpcCksY250PXt9O0dSQURFX09SREVSLmZvckVhY2goZz0+Y250W2ddPTApO3JzLmZvckVhY2gocj0+Y250W3IudWcuZ3JhZGVdKyspOwogIGgrPWA8aDM+JHtkYXlMYWJlbChkKX08L2gzPjxkaXYgY2xhc3M9InJvdyI+JHtHUkFERV9PUkRFUi5tYXAoZz0+YDxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltnXX0iPiR7Z30gJHtjbnRbZ119PC9zcGFuPmApLmpvaW4oIiAiKX08L2Rpdj5gOwogIGNvbnN0IHNvcnRlZD1ycy5zbGljZSgpLnNvcnQoKGEsYik9PkdSQURFX09SREVSLmluZGV4T2YoYS51Zy5ncmFkZSktR1JBREVfT1JERVIuaW5kZXhPZihiLnVnLmdyYWRlKXx8Yi51Zy5wLWEudWcucCk7CiAgaCs9YDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7jg6zjg7zjgrk8L3RoPjx0aD7nrYnntJo8L3RoPjx0aD7kuojmuKw8L3RoPjx0aD7lrp/nuL7jga7ms6LkubHnjoc8L3RoPjx0aD7liKTlrpo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3QgciBvZiBzb3J0ZWQpaCs9YDx0cj48dGQ+JHtlc2Moci5sYWJlbCl9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moci5jb3Vyc2UpfeODuyR7ci5ufemgrTwvc3Bhbj4ke3Iuc2NyYXRjaGVkJiZyLnNjcmF0Y2hlZC5sZW5ndGg/YCA8c3BhbiBjbGFzcz0iY2hpcCBvIj7pmaTlpJbmjqjlrpogJHtyLnNjcmF0Y2hlZC5qb2luKCIsIil955WqPC9zcGFuPmA6IiJ9PC90ZD48dGQ+PHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW3IudWcuZ3JhZGVdfSI+JHtyLnVnLmdyYWRlfTwvc3Bhbj48L3RkPjx0ZD4ke3BjdChyLnVnLnApfTwvdGQ+PHRkPiR7ci51Zy5jdXN0b20mJnIudWcucmF0ZSE9bnVsbD9gJHtwY3Qoci51Zy5yYXRlKX08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke3BjdChyLnVnLmxvKX3jgJwke3BjdChyLnVnLmhpKX3jg7ske3IudWcubn3ku7Y8L3NwYW4+YDpNYXRoLnJvdW5kKHIudWcucmF0ZSoxMDApKyIlIn08L3RkPjx0ZCBjbGFzcz0ic21hbGwiPiR7ci51Zy5tb2RlPT09Im9kZHMiPyLjgqrjg4Pjgrrovrzjgb8iOiLmjqjlrpoifTwvdGQ+PC90cj5gOwogIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIH0KIGVsLmlubmVySFRNTD1oOwp9CgovKiAtLS0g56m06aas77yI5aW96LWw546H44Gu6auY44GE56m06aas5YCZ6KOc77yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJIb2xlKCl7CiBjb25zdCBlbD0kKCJ2SG9sZSIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCBmb2N1cz0kKCJob2xlRm9jdXMiKT8kKCJob2xlRm9jdXMiKS52YWx1ZT09PSIxIjp0cnVlOwogbGV0IGg9YDxoMj7nqbTppqzlgJnoo5w8L2gyPiR7c3RyYXRDaGlwKCJmb2N1cyIpfQogPGRpdiBjbGFzcz0ic21hbGwiPueptOOCvuODvOODs++8iOS6uuawl+iWhO+8ieOBruS4reOBp+OAgTPnnYDku6XlhoXjgavlhaXjgovnorrnjofjgYzpq5jjgYTppqzjgILjgIzlvZPjgZ/jgorjgoTjgZnjgZXjgI3jga7nm67lronjgafjgIHlm57lj47njofjga/liKXjgafjgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyBzbWFsbCI+PHNlbGVjdCBpZD0iaG9sZUZvY3VzIj48b3B0aW9uIHZhbHVlPSIxIj7il47nmoTkuK3njofph43oppbvvIjjg6njg7Pjgq9TL0Hjga7jgb/vvIk8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwIj7jgZnjgbnjgabvvIjkuIrkvY0y6aCt77yJPC9vcHRpb24+PC9zZWxlY3Q+PC9kaXY+YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz5gOwogIGZvcihjb25zdCByIG9mIGNhbGNSYWNlcyhkKSl7CiAgIGlmKHIuc2tpcCljb250aW51ZTsKICAgY29uc3QgYz1mb2N1cz9VRS5waWNrRm9jdXMoci5yZXMsMik6VUUucGljayhyLnJlcywyKTtpZighYy5sZW5ndGgpY29udGludWU7CiAgIGgrPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyhyLmxhYmVsKX08L2I+IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moci5jb3Vyc2UpfeODuyR7ci5ufemgrSR7ci5oYXNPZGRzPyIiOiLvvIjjgqrjg4PjgrrmnKrlj5blvpfvvIkifTwvc3Bhbj5gOwogICBmb3IoY29uc3QgeCBvZiBjKXtjb25zdCBoaD1yLmhvcnNlc1t4LmldOwogICAgaCs9YDxkaXYgc3R5bGU9Im1hcmdpbi10b3A6NnB4Ij48Yj4ke3gubm9955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgciR7aGgucmF0aW5nfSI+JHtoaC5yYXRpbmd9PC9zcGFuPiA8c3BhbiBjbGFzcz0ic21hbGwiPuWlvei1sOeOhyAke3BjdCh4LnBjLDEpfSR7eC5vZGQ/YO+8j+WNmOWLnSR7eC5vZGR95YCNKCR7eC5wb3B955Wq5Lq65rCXKWA6IiJ9PC9zcGFuPjxicj4KICAgICA8c3BhbiBjbGFzcz0ic21hbGwiPiR7aGguY2FyZWVyJiZoaC5jYXJlZXIubj9g6YCa566XJHtoaC5jYXJlZXIubn3otbAgM+edgOWGhSR7aGguY2FyZWVyLnQzfeWbnmA6IumAmueul++8muWxpeattOOBquOBlyJ9JHtoaC5yZWNlbnQmJmhoLnJlY2VudC5sZW5ndGg/YO+8j+ebtOi/kSAke2hoLnJlY2VudC5zbGljZSgtNSkuam9pbigiLSIpfeedgGA6IiJ977yP6aiO5omL77yaJHtlc2MoaGguam5hbWV8fCLkuI3mmI4iKX3vvI/oqr/mlZnluKvvvJoke2VzYyhoaC50cmFpbmVyfHwi5LiN5piOIil9JHtoaC50clJhdGUhPW51bGwmJmhoLnRyTj49MjA/YCgz552A5YaFJHtwY3QoaGgudHJSYXRlKX0pYDoiIn08L3NwYW4+PGJyPmArCiAgICAgKHgudGFnc3x8W10pLnNsaWNlKDAsMykubWFwKHQ9PmA8c3BhbiBjbGFzcz0iY2hpcCAke3QuY30iPiR7ZXNjKHQudCl9PC9zcGFuPmApLmpvaW4oIiIpK2A8L2Rpdj5gfQogICBoKz0iPC9kaXY+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKIGNvbnN0IHM9JCgiaG9sZUZvY3VzIik7cy52YWx1ZT1mb2N1cz8iMSI6IjAiO3Mub25jaGFuZ2U9cmVuZGVySG9sZTsKfQoKLyogLS0tIOWFqOODrOODvOOCue+8iOmmrOOBlOOBqOOBrueiuueOh+ODu+OCquODg+OCuuODu+acn+W+heWApOODu+mojuaJi+ODu+iqv+aVmeW4q++8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyUmFjZXMoKXsKIGNvbnN0IGVsPSQoInZSYWNlcyIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBsZXQgaD0iPGgyPuWFqOODrOODvOOCuTwvaDI+IjsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz5gOwogIGZvcihjb25zdCByIG9mIGNhbGNSYWNlcyhkKSl7CiAgIGlmKHIuc2tpcCl7aCs9YDxkaXYgY2xhc3M9InNtYWxsIj4ke2VzYyhyLmxhYmVsKX3vvJoke2VzYyhyLnNraXApfTwvZGl2PmA7Y29udGludWV9CiAgIGNvbnN0IGc9ci51ZzsKICAgaCs9YDxkZXRhaWxzPjxzdW1tYXJ5PiR7ZXNjKHIubGFiZWwpfSA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK08L3NwYW4+IDxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltnLmdyYWRlXX0iPiR7Zy5ncmFkZX08L3NwYW4+PC9zdW1tYXJ5PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqzvvI/pqI7miYvvvI/oqr/mlZnluKs8L3RoPjx0aD7ljZjli508L3RoPjx0aD7opIfli508L3RoPjx0aD7norrnjoc8L3RoPjx0aD5FVjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgeCBvZiByLmhvcnNlcy5zbGljZSgpLnNvcnQoKGEsYik9PmIucC1hLnApKQogICAgaCs9YDx0cj48dGQ+PGI+JHt4Lm5vfTwvYj4gJHtlc2MoeC5uYW1lKX0ke3guaG9sZSYmeC5yYXRpbmchPT0iQyI/YCA8c3BhbiBjbGFzcz0icnQgciR7eC5yYXRpbmd9Ij4ke3gucmF0aW5nfTwvc3Bhbj5gOiIifTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5qbmFtZT9lc2MoeC5qbmFtZSk6JzxzcGFuIGNsYXNzPSJiYWQiPumojuaJi+S4jeaYjjwvc3Bhbj4nfe+8iCR7eC5qbj49NT8i6YGO5Y67Iit4LmpuKyLpqI7kuZciOiLlsaXmrbTlsJEife+8ie+8jyR7eC50cmFpbmVyP2VzYyh4LnRyYWluZXIpOic8c3BhbiBjbGFzcz0iYmFkIj7oqr/mlZnluKvkuI3mmI48L3NwYW4+J30ke3gudHJSYXRlIT1udWxsJiZ4LnRyTj49MjA/Iu+8iDPnnYDlhoUiK3BjdCh4LnRyUmF0ZSkrIu+8iSI6IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7eC53aW4/eC53aW4udG9GaXhlZCgxKToiLSJ9PC90ZD48dGQ+JHt4LmxvP3gubG8udG9GaXhlZCgxKSsoeC5oaT54LmxvPyLjgJwiK3guaGkudG9GaXhlZCgxKToiIik6Ii0ifTxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LnNyY3x8IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHgucCl9PC90ZD48dGQ+JHt4LmV2IT1udWxsP2A8YiR7eC5ldj49MS4wNT8nIGNsYXNzPSJnb29kIic6IiJ9PiR7eC5ldi50b0ZpeGVkKDIpfTwvYj5gOiItIn08L3RkPjwvdHI+YDsKICAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2RldGFpbHM+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOWPluOCiui+vOOBv+eKtuazge+8iOmgreaVsOODu+mojuaJi+ODu+iqv+aVmeW4q+ODu+OCs+ODvOOCueODu+OCquODg+OCuuOBruiqreOBv+WPluOCiue1kOaenO+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyU3VtKCl7CiBjb25zdCBlbD0kKCJ2U3VtIik7aWYoIVdLLmRhdGVzLmxlbmd0aCYmIVdLLmRpYWcubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgcnM9YWxsUmFjZXMoKS5maWx0ZXIocj0+IXIuc2tpcCk7CiBjb25zdCBob3JzZXM9cnMucmVkdWNlKChzLHIpPT5zK3IubiwwKSxqbWlzcz1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9PiFoLmpuYW1lKS5sZW5ndGgsMCksdG1pc3M9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT4haC50cmFpbmVyKS5sZW5ndGgsMCk7CiBjb25zdCBqbWF0Y2g9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT5oLmpuPj01KS5sZW5ndGgsMCksaG1hdGNoPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+aC5uPj0yKS5sZW5ndGgsMCk7CiBjb25zdCBub0NvdXJzZT1ycy5maWx0ZXIocj0+ci5jb3Vyc2U9PT0i44Kz44O844K55LiN5piOIikubGVuZ3RoLG5PZGRzPXJzLmZpbHRlcihyPT5yLmhhc09kZHMpLmxlbmd0aCxwUmVhbD1ycy5maWx0ZXIocj0+ci5wbGFjZVJlYWw+MCkubGVuZ3RoOwogbGV0IGg9YDxoMj7lj5bjgorovrzjgb/nirbms4E8L2gyPjx0YWJsZT48dGJvZHk+CiA8dHI+PHRkPuino+aekOOBl+OBn+ODrOODvOOCue+8j+WHuui1sOmmrDwvdGQ+PHRkPiR7cnMubGVuZ3RofeODrOODvOOCue+8jyR7aG9yc2VzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+6aiO5omL44KS6Kqt44KB44Gq44GL44Gj44Gf6aasPC90ZD48dGQgY2xhc3M9IiR7am1pc3M/ImJhZCI6Imdvb2QifSI+JHtqbWlzc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPuiqv+aVmeW4q+OCkuiqreOCgeOBquOBi+OBo+OBn+mmrDwvdGQ+PHRkIGNsYXNzPSIke3RtaXNzPyJiYWQiOiJnb29kIn0iPiR7dG1pc3N96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7jgrPjg7zjgrnjgpLoqq3jgoHjgarjgYvjgaPjgZ/jg6zjg7zjgrk8L3RkPjx0ZCBjbGFzcz0iJHtub0NvdXJzZT8iYmFkIjoiZ29vZCJ9Ij4ke25vQ291cnNlfTwvdGQ+PC90cj4KIDx0cj48dGQ+44Kq44OD44K644KS5Y+W5b6X44Gn44GN44Gf44Os44O844K5PC90ZD48dGQ+JHtuT2Rkc33vvI8ke3JzLmxlbmd0aH3vvIjopIfli53jga7lrp/jgqrjg4PjgrogJHtwUmVhbH3jg6zjg7zjgrnvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmmrO+8iTwvdGQ+PHRkPiR7aG1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDLotbDku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmojuaJi++8iTwvdGQ+PHRkPiR7am1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDXpqI7kuZfku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPuWtpue/kuODh+ODvOOCv+OBruacgOe1guaXpTwvdGQ+PHRkPiR7ZXNjKFdLLnN0b3JlSW5mbyYmV0suc3RvcmVJbmZvLmxhc3R8fCItIil9PC90ZD48L3RyPjwvdGJvZHk+PC90YWJsZT5gOwogY29uc3Qgc2NyPXJzLmZpbHRlcihyPT5yLnNjcmF0Y2hlZCYmci5zY3JhdGNoZWQubGVuZ3RoKSxqbXA9YWxsUmFjZXMoKS5maWx0ZXIocj0+ci5za2lwJiYv6Zqc5a6zLy50ZXN0KHIuc2tpcCkpOwogaWYoc2NyLmxlbmd0aCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4Pjgrrjga7nhKHjgYTppqzjgpLlj5bmtojjg7vpmaTlpJbjgajjgb/jgarjgZfjgablpJbjgZfjgZ/jg6zjg7zjgrnvvJoke3Njci5tYXAocj0+ZXNjKHIubGFiZWwpKyLvvIgiK3Iuc2NyYXRjaGVkLmpvaW4oIiwiKSsi55Wq77yJIikuam9pbigi77yPIil944CC5a6f6Zqb44Gr5Ye66LWw44GZ44KL6aas44Gq44KJ44CB44Kq44OD44K644Gu5Y+W5b6X5ryP44KM44Gn44GZ44CCPC9kaXY+YDsKIGlmKGptcC5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7pmpzlrrPjg6zjg7zjgrkgJHtqbXAubGVuZ3RofeS7tuOBr+OAgeW5s+WcsOeUqOOBruODouODh+ODq+OBruOBn+OCgeino+aekOOBruWvvuixoeWkluOBq+OBl+OBpuOBhOOBvuOBmeOAgjwvZGl2PmA7CiBjb25zdCBnYXA9V0suc3RvcmVJbmZvJiZXSy5zdG9yZUluZm8ubGFzdCYmV0suZGF0ZXNbMF0/TWF0aC5yb3VuZCgobmV3IERhdGUoV0suZGF0ZXNbMF0pLW5ldyBEYXRlKFdLLnN0b3JlSW5mby5sYXN0KSkvODY0ZTUpOm51bGw7CiBpZihnYXAhPW51bGwmJmdhcD4xMCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnIDmlrDjga7miJDnuL7jgYwke2dhcH3ml6XliIblhaXjgaPjgabjgYTjgb7jgZvjgpPjgILjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GX44Gm44GL44KJ44CB44KC44GG5LiA5bqm5LqI5oOz44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKIGlmKHJzLmxlbmd0aCYmaG1hdGNoPGhvcnNlcyouNCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7pgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgafjgY3jgZ/ppqzjgYzlsJHjgarjgoHjgafjgZnjgILoi6Xpp5LmiKbkuK3lv4Pjga7ml6Xjga/mraPluLjjgafjgZnjgYzjgIHjgZ3jgYbjgafjgarjgZHjgozjgbDppqzlkI3jga7ooajoqJjjgYzlkIjjgaPjgabjgYTjgarjgYTlj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgII8L2Rpdj4nOwogY29uc3Qgb249V0sub2Rkc05vdGVzfHx7fTsKIGlmKE9iamVjdC5rZXlzKG9uKS5sZW5ndGgpe2grPWA8aDM+44Kq44OD44K65Y+W5b6X44Gu5YaF6KizPC9oMz48ZGl2IGNsYXNzPSJzdGF0dXMiPiR7V0suZGF0ZXMubWFwKGQ9PmAke2RheUxhYmVsKGQpfVxuJHsob25bZF18fFtdKS5tYXAoZXNjKS5qb2luKCJcbiIpfWApLmpvaW4oIlxuXG4iKX08L2Rpdj5gfQogaCs9YDxoMz7plovlgqzloLTjgZTjgag8L2gzPjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7plovlgqzloLQ8L3RoPjx0aD7jg6zjg7zjgrk8L3RoPjx0aD7nirbmhYs8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB4IG9mIFdLLmRpYWcpewogIGNvbnN0IHByb2JzPVtdO2lmKHguZXJyKXByb2JzLnB1c2goeC5lcnIpO2lmKHguYmFkKXByb2JzLnB1c2goYOWHuui1sOmmrOOCkuiqreOCgeOBquOBhOODrOODvOOCuSAke3guYmFkfWApO3Byb2JzLnB1c2goLi4uKHguaXNzdWVzfHxbXSkpOwogIGgrPWA8dHI+PHRkPiR7ZXNjKGRheUxhYmVsKHguZCkpfSAke2VzYyh4Lm5hbWUpfTwvdGQ+PHRkPiR7eC5va30vJHt4LnJhY2VzfTwvdGQ+PHRkIHN0eWxlPSJ0ZXh0LWFsaWduOmxlZnQiPiR7cHJvYnMubGVuZ3RoP2A8c3BhbiBjbGFzcz0iYmFkIHNtYWxsIj4ke3Byb2JzLm1hcChlc2MpLmpvaW4oIjxicj4iKX08L3NwYW4+YDonPHNwYW4gY2xhc3M9Imdvb2QiPuWVj+mhjOOBquOBlzwvc3Bhbj4nfSR7eC5jb2RlP2AgPGJ1dHRvbiBjbGFzcz0ibWluaSBzdWIiIGRhdGEtcmw9IiR7ZXNjKHguZCl9fCR7ZXNjKHguY29kZSl9fCR7ZXNjKHgubmFtZSl9Ij7lho3lj5blvpc8L2J1dHRvbj5gOiIifTwvdGQ+PC90cj5gOwogfQogaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogZWwuaW5uZXJIVE1MPWg7CiBlbC5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1ybF0iKS5mb3JFYWNoKGI9PmIub25jbGljaz1hc3luYygpPT57CiAgY29uc3QgW2QsY29kZSxuYW1lXT1iLmRhdGFzZXQucmwuc3BsaXQoInwiKTtiLmRpc2FibGVkPXRydWU7d2tNc2coYCR7ZH0gJHtuYW1lfSDjgpLlho3lj5blvpfkuK3igKZgKTsKICB0cnl7YXdhaXQgbG9hZFZlbnVlSW50byhiYXNlVXJsKCksZCx7dmVudWVDb2RlOmNvZGUsdmVudWVOYW1lOm5hbWV9KTthd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2VVcmwoKSxkKTthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpO3drTXNnKCLlho3lj5blvpfjgZfjgb7jgZfjgZ8iKX0KICBjYXRjaChlKXt3a01zZygi5YaN5Y+W5b6X44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogfSk7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDmk43kvZwKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpmdW5jdGlvbiBzaG93VGFiKHQpe2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIi52aWV3IikuZm9yRWFjaCh2PT52LmNsYXNzTGlzdC50b2dnbGUoIm9uIix2LmlkPT09dCkpO2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiN0YWJzIGJ1dHRvbiIpLmZvckVhY2goYj0+Yi5jbGFzc0xpc3QudG9nZ2xlKCJvbiIsYi5kYXRhc2V0LnRhYj09PXQpKX0KZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI3RhYnMgYnV0dG9uIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PnNob3dUYWIoYi5kYXRhc2V0LnRhYikpOwokKCJ1cFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgidXBSdW4iKS5kaXNhYmxlZD10cnVlOyQoInVwT3V0IikudGV4dENvbnRlbnQ9IuaknOiovOS4reKApu+8iOaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iSI7CiB0cnl7CiAgY29uc3Qgcj1hd2FpdCBydW5VcHNldEZpdCh7c3RhcnQ6JCgidXBTdGFydCIpLnZhbHVlfHwiMjAyMS0wMS0wMSJ9KTsKICAkKCJ1cE91dCIpLmlubmVySFRNTD11cHNldFJlcG9ydChyKTsKICBpZihyLm1vZGVsKXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShVUEtFWSxKU09OLnN0cmluZ2lmeShyLm1vZGVsKSk7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX0KIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJ1cE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9ImJhZCI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7JCgidXBSdW4iKS5kaXNhYmxlZD1mYWxzZX0KfTsKJCgidXBDbGVhciIpLm9uY2xpY2s9YXN5bmMoKT0+e2xvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFVQS0VZKTskKCJ1cE91dCIpLnRleHRDb250ZW50PSLmqJnmupbjg6Ljg4fjg6vjgavmiLvjgZfjgb7jgZfjgZ/jgIIiO2lmKFdLLmRhdGVzLmxlbmd0aCl7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKX19OwokKCJ3a0dvIikub25jbGljaz13ZWVrZW5kR287CiQoIndrT2RkcyIpLm9uY2xpY2s9b2Rkc09ubHk7CiQoImJrT25lIikub25jbGljaz1hc3luYygpPT57CiBpZihCSy5idXN5KXJldHVybjsKIGlmKCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXsKICBjb25zdCBwPXByb21wdCgi44OQ44OD44Kv44Ki44OD44OX55So44Gu44OR44K544OV44Os44O844K677yIOOaWh+Wtl+S7peS4iu+8ieOCkuaxuuOCgeOBpuWFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAguW+qeWFg+OBruOBqOOBjeOBq+OCguWQjOOBmOOCguOBruOBjOW/heimgeOBp+OBmeOAgiIpOwogIGlmKCFwKXJldHVybjtCSy5wYXNzPXAudHJpbSgpO0JLLmlkPSIiO2JrU2F2ZVNldHRpbmdzKCk7JCgiYmtQYXNzIikudmFsdWU9QksucGFzczsKICBpZihCSy5wYXNzLmxlbmd0aDw4KXtia01zZygi44OR44K544OV44Os44O844K644GvOOaWh+Wtl+S7peS4iuOBq+OBl+OBpuOBj+OBoOOBleOBhOOAgiIsdHJ1ZSk7cmV0dXJufQogfQogYXdhaXQgcnVuQmFja3VwKGZhbHNlKTsKfTsKJCgiZGJnR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IG91dD0kKCJkYmdPdXQiKSxiYXNlPWJhc2VVcmwoKTsKIGlmKCFXSy5kYXRlcy5sZW5ndGgpe291dC52YWx1ZT0i5YWI44Gr44CM4pGgIOS7iumAseacq+OBruODrOODvOOCueOCkuWPluW+l+OBl+OBpuS6iOaDs+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgiI7cmV0dXJufQogb3V0LnZhbHVlPSLoqLrmlq3kuK3igKYiOyQoImRiZ0dvIikuZGlzYWJsZWQ9dHJ1ZTtjb25zdCBsaW5lcz1bYOWPluW+l+aXpSAke1dLLmRhdGVzLmpvaW4oIiwiKX1gXTsKIHRyeXsKICBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgIGNvbnN0IGNvZGVzPVsuLi5uZXcgU2V0KChXSy5jYXJkc1tkXXx8W10pLm1hcChyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pOwogICBmb3IoY29uc3QgdiBvZiBjb2Rlcyl7CiAgICBjb25zdCBycz1XSy5jYXJkc1tkXS5maWx0ZXIocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpPT09dik7CiAgICBjb25zdCBxPXJzLm1hcChyPT5yLnF1YWxpdHkpLmZpbHRlcihCb29sZWFuKTsKICAgIGxpbmVzLnB1c2goYFxu4pagJHtkfSDplovlgqzloLQke3Z977yIJHtyc1swXT8udmVudWVOYW1lfHwiIn3vvInjg6zjg7zjgrkke3JzLmxlbmd0aH3vvI/jgrPjg7zjgrnkuI3mmI4ke3JzLmZpbHRlcihyPT4hKHIuc3VyZmFjZSYmci5kaXN0YW5jZSkpLmxlbmd0aH3vvI/pqI7miYvmrKAke3EucmVkdWNlKChzLHgpPT5zKyh4LmhvcnNlcy14LmpvY2tleUZpbGxlZCksMCl977yP6Kq/5pWZ5bir5qygJHtxLnJlZHVjZSgocyx4KT0+cysoeC5ob3JzZXMteC50cmFpbmVyRmlsbGVkKSwwKX1gKTsKICAgIGNvbnN0IGJhZD1ycy5maW5kKHI9PnIucXVhbGl0eSYmIXIucXVhbGl0eS5vayl8fHJzWzBdLHJuPShiYWQmJmJhZC5yYWNlTnVtYmVyKXx8MTtsaW5lcy5wdXNoKGDvvIjllY/poYzjga7jgYLjgovjg6zjg7zjgrkgJHtybn1SIOOCkuiqv+OBueOBvuOBme+8iWApO3RyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9kZWJ1Zy1lbnRyeT9kYXRlPSR7ZH0mdmVudWU9JHt2fSZyYWNlPSR7cm59YCxbMTUwMF0pO2RlbGV0ZSB4Lm9rO2xpbmVzLnB1c2goSlNPTi5zdHJpbmdpZnkoeCkpfWNhdGNoKGUpe2xpbmVzLnB1c2goIuiouuaWreOCqOODqeODvO+8miIrZS5tZXNzYWdlKX0KICAgfQogIH0KIH1maW5hbGx5eyQoImRiZ0dvIikuZGlzYWJsZWQ9ZmFsc2V9CiBvdXQudmFsdWU9bGluZXMuam9pbigiXG4iKTsKfTsKJCgiZGJnQ29weSIpLm9uY2xpY2s9YXN5bmMoKT0+e2NvbnN0IHQ9JCgiZGJnT3V0IikudmFsdWU7dHJ5e2F3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpOyQoImRiZ0NvcHkiKS50ZXh0Q29udGVudD0i44Kz44OU44O844GX44G+44GX44GfIn1jYXRjaChlKXskKCJkYmdPdXQiKS5zZWxlY3QoKTthbGVydCgi6YG45oqe44GX44G+44GX44Gf44CC44Kz44OU44O844GX44Gm44GP44Gg44GV44GE44CCIil9fTsKJCgiZmlsZSIpLm9uY2hhbmdlPWU9Pntjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKGYpaW1wb3J0RmlsZShmKTtlLnRhcmdldC52YWx1ZT0iIn07CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GX77yI5Y+W5b6X5riI44G/44Gu5pel44KS44CB5paw44GX44GE6aCF55uu44Gk44GN44Gn5Y+W44KK55u044GZ77yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KYXN5bmMgZnVuY3Rpb24gbGFwUmVmZXRjaChkZXBzKXsKIGNvbnN0IEQ9T2JqZWN0LmFzc2lnbih7aWRiQWxsLGlkYlB1dCxtZXRhR2V0LG1ldGFQdXQsZmV0Y2hEYXl9LGRlcHN8fHt9KTsKIGNvbnN0IGJhc2U9YmFzZVVybCgpLGE9JCgibGFwU3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpLG1zZz10PT57JCgibGFwU3RhdHVzIikuaW5uZXJIVE1MPXR9OwogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoImxhcEdvIikuZGlzYWJsZWQ9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPWZhbHNlOwogY29uc3Qgc3Q9e2RheXM6MCxyYWNlczowLGxhcHM6MCxjb3JuZXJzOjAsaG9yc2VzOjAsZmFpbDpbXSxza2lwcGVkOjAsdDA6RGF0ZS5ub3coKSxub2RhdGE6ZmFsc2Usc3RvcHBlZDpmYWxzZX07bGV0IGNvbnNlYz0wLHRvdGFsPTA7CiB0cnl7CiAgY29uc3QgZmlsZXM9KGF3YWl0IEQuaWRiQWxsKCkpLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgmJmYuZGF0ZT49YSYmZi5kYXRlPD15ZCkuc29ydCgoeCx5KT0+eC5kYXRlPHkuZGF0ZT8tMToxKTsKICBjb25zdCB0b2RvPVtdOwogIGZvcihjb25zdCBmIG9mIGZpbGVzKXtpZihmLnJvd3Muc29tZShyPT5BcnJheS5pc0FycmF5KHIubGFwKSYmci5sYXAubGVuZ3RoKXx8YXdhaXQgRC5tZXRhR2V0KCJsYXBkb25lOiIrZi5kYXRlKSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfXRvZG8ucHVzaChmLmRhdGUpfQogIHRvdGFsPXRvZG8ubGVuZ3RoOwogIGlmKCF0b3RhbCl7bXNnKGDlj5bjgornm7TjgZnml6Xjga/jgYLjgorjgb7jgZvjgpPvvIgke2F95Lul6ZmN44GuJHtmaWxlcy5sZW5ndGh95pel44Gv44CB44GZ44G544Gm44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gk44GN44Gn44GZ77yJ44CCYCk7cmV0dXJufQogIGZvcihsZXQgaT0wO2k8dG9kby5sZW5ndGg7aSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgZD10b2RvW2ldLGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICBtc2coYCR7ZH3vvIgke2krMX0vJHt0b3RhbH3ml6XvvInjgpLlj5blvpfkuK3igKZcbuWPluOCiuebtOOBlyR7c3QuZGF5c33ml6XvvI/jg6njg4Pjg5fjgpLoqq3jgoHjgZ/jg6zjg7zjgrkgJHtzdC5sYXBzfS8ke3N0LnJhY2Vzfe+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmApOwogICB0cnl7CiAgICBjb25zdCByPWF3YWl0IEQuZmV0Y2hEYXkoYmFzZSxkKTsKICAgIGlmKHIuZmFpbGVkTil7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgIGNvbnN0IHJpZHM9bmV3IFNldChyLnJvd3MubWFwKHg9PngucmFjZUlkKSksbGFwUmFjZXM9bmV3IFNldChyLnJvd3MuZmlsdGVyKHg9PkFycmF5LmlzQXJyYXkoeC5sYXApJiZ4LmxhcC5sZW5ndGgpLm1hcCh4PT54LnJhY2VJZCkpOwogICAgY29uc3QgY29ybmVySG9yc2VzPXIucm93cy5maWx0ZXIoeD0+QXJyYXkuaXNBcnJheSh4LmNvcm5lcikmJnguY29ybmVyLmxlbmd0aD49MikubGVuZ3RoOwogICAgYXdhaXQgRC5pZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTsKICAgIGlmKGxhcFJhY2VzLnNpemV8fGNvcm5lckhvcnNlcylhd2FpdCBELm1ldGFQdXQoImxhcGRvbmU6IitkLHRydWUpOwogICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yaWRzLnNpemU7c3QubGFwcys9bGFwUmFjZXMuc2l6ZTtzdC5jb3JuZXJzKz1jb3JuZXJIb3JzZXM7c3QuaG9yc2VzKz1yLnJvd3MubGVuZ3RoO2NvbnNlYz0wOwogICAgaWYoc3QuZGF5cz49MiYmc3QubGFwcz09PTAmJnN0LmNvcm5lcnM9PT0wKXtzdC5ub2RhdGE9dHJ1ZTtTU1RPUD10cnVlfQogICB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgYXdhaXQgc2xlZXAoNDAwKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJsYXBHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICBjb25zdCByYXRlPSh4LHkpPT55P01hdGgucm91bmQoeC95KjEwMCkrIiUiOiItIjsKICBsZXQgaD1gJHtzdC5ub2RhdGE/JzxzcGFuIGNsYXNzPSJiYWQiPuODqeODg+ODl+OCgumAmumBjumghuS9jeOCguiqreOCgeOBvuOBm+OCk+OBp+OBl+OBn+OAguS4reaWreOBl+OBvuOBl+OBn+OAgjwvc3Bhbj5cbuOAjOiqreOBv+WPluOCiuOBruiouuaWreOAjeOCkuaKvOOBl+OAgeWHuuOBn+aWh+eroOOCkuiyvOOBo+OBpuOBj+OBoOOBleOBhOOAglxuJzooc3Quc3RvcHBlZD8i6YCj57aa44GX44Gm5aSx5pWX44GX44Gf44Gf44KB5Lit5pat44GX44G+44GX44Gf44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44CB44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOihTU1RPUD8i5YGc5q2i44GX44G+44GX44Gf44CCIjoi5a6M5LqG44CCIikpfWA7CiAgaCs9YOWPluOCiuebtOOBlyAke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJXG7jg6njg4Pjg5fjgpLoqq3jgoHjgZ/jg6zjg7zjgrnvvJoke3N0LmxhcHMudG9Mb2NhbGVTdHJpbmcoKX0vJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfe+8iCR7cmF0ZShzdC5sYXBzLHN0LnJhY2VzKX3vvIlcbumAmumBjumghuS9jeOCkuiqreOCgeOBn+mmrO+8miR7c3QuY29ybmVycy50b0xvY2FsZVN0cmluZygpfS8ke3N0LmhvcnNlcy50b0xvY2FsZVN0cmluZygpfe+8iCR7cmF0ZShzdC5jb3JuZXJzLHN0LmhvcnNlcyl977yJYDsKICBpZihzdC5mYWlsLmxlbmd0aCloKz1gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIife+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeaui+OCiuOBoOOBkee2muOBjeOBi+OCie+8iTwvc3Bhbj5gOwogIG1zZyhoKTt0cnl7YXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpfWNhdGNoKGUpe30KIH0KIHJldHVybiBzdDsKfQokKCJsYXBHbyIpLm9uY2xpY2s9KCk9PmxhcFJlZmV0Y2goKTsKJCgibGFwRGJnIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgibGFwT3V0Iik7b3V0LnZhbHVlPSLoqLrmlq3kuK3igKYiOwogdHJ5ewogIGNvbnN0IGZpbGVzPShhd2FpdCBpZGJBbGwoKSkuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkuc29ydCgoeCx5KT0+eC5kYXRlPHkuZGF0ZT8tMToxKTsKICBpZighZmlsZXMubGVuZ3RoKXtvdXQudmFsdWU9IuWPluW+l+a4iOOBv+OBruaIkOe4vuOBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+OAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIiO3JldHVybn0KICBjb25zdCBkPWZpbGVzW2ZpbGVzLmxlbmd0aC0xXS5kYXRlLGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZVVybCgpfS9qcmEtZGF5P2RhdGU9JHtkfWApLHJhY2VzPWRheS5yYWNlc3x8W107CiAgY29uc3Qgcj1yYWNlcy5maW5kKHg9PngucmFjZU5vPT09MTEpfHxyYWNlc1swXTsKICBpZighcil7b3V0LnZhbHVlPWAke2R9IOOBruODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCk2A7cmV0dXJufQogIGNvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2VVcmwoKX0vZGVidWctcmVzdWx0P2NuYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHIuY25hbWUpfWApO2RlbGV0ZSB4Lm9rOwogIG91dC52YWx1ZT1g5pel5LuYICR7ZH0g6ZaL5YKs5aC0JHtyLnZlbnVlQ29kZX0gJHtyLnJhY2VOb31SXG5gK0pTT04uc3RyaW5naWZ5KHgpOwogfWNhdGNoKGUpe291dC52YWx1ZT0i6Ki65pat44Ko44Op44O877yaIitlLm1lc3NhZ2V9Cn07CgppZigvXmh0dHBzPzovLnRlc3QobG9jYXRpb24ucHJvdG9jb2wpKSQoInd1cmwiKS52YWx1ZT1sb2NhdGlvbi5vcmlnaW47ZWxzZSAkKCJ3dXJsIikudmFsdWU9Imh0dHBzOi8va2VpYmEtYWktcGF5b3V0cy5odDE5OTUwODIyLndvcmtlcnMuZGV2IjsKcmVuZGVyR2F0ZSgpO3JlbmRlckFsbCgpOwooYXN5bmMoKT0+e3RyeXthd2FpdCBvcGVuREIoKTthd2FpdCBzaG93U3RhdGUoKTthd2FpdCBia0luaXQoKX1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5L+d5a2Y6aCY5Z+f44KS6ZaL44GR44G+44Gb44KT77yaJHtlc2MoZS5tZXNzYWdlKX1cbu+8iOODl+ODqeOCpOODmeODvOODiOODluODqeOCpuOCuuOBp+OBr+S9v+OBiOOBquOBhOOBk+OBqOOBjOOBguOCiuOBvuOBme+8iTwvc3Bhbj5gfX0pKCk7Cgo8L3NjcmlwdD4KPC9ib2R5PjwvaHRtbD4K";
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
