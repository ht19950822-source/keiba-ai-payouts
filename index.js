/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-08-rebuild-4";

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

    corner:
      extractCornerInfo(
        row
      ),

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
          going: r.going || "", raceName: r.raceName || "", frame: r.frame ?? null
        });
      }
      const clsText = ((String(html).match(/<div class="cell class">\s*([^<]*?)\s*<\/div>/) || [])[1] || "").trim();
      const prizeM = String(html).match(/<li><span class="cap">1着<\/span><span class="num">([\d,]+)<\/span>/);
      const prize1 = prizeM ? Number(prizeM[1].replace(/,/g, "")) : null;
      const gradeText = extractJRAGradeText(html);
      for (const row of rows) { if (row.raceId === makeRaceId(race.date, race.venueCode, race.raceNo)) { row.cls = clsText; row.prize = prize1; row.grade = gradeText; } }
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
  const cnameRe = /pw15o[a-z]{2}\d{2}[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/g;
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
    let frontier = topC.filter(c => c.includes(compact) && !/^pw151ou/i.test(c));
    let fetched = 0;
    for (let depth = 0; depth < 3 && frontier.length && fetched < 10; depth++) {
      const next = [];
      for (const c of frontier) {
        if (seen.has(c) || fetched >= 10) continue;
        seen.add(c); fetched++;
        try {
          const html = await fetchJRAHtmlPost("/JRADB/accessO.html", c);
          const cs = collect(html);
          cs.forEach(addRace);
          for (const x of cs) if (x.includes(compact) && !/^pw151ou/i.test(x) && !seen.has(x)) next.push(x);
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
    for (const c of targets.slice(0, 14)) {
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
    return json({ ok: true, date, count: races.length, targets: targets.length, targetsAll: targetsAll.length, races, diagnostics: diag.slice(0, 24) });
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGRpdiBpZD0iYmtTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2PgogPGRpdiBpZD0iZGF0YVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+CjwvZGl2PgoKPGRpdiBjbGFzcz0idGFicyIgaWQ9InRhYnMiPgogPGJ1dHRvbiBkYXRhLXRhYj0idkF4aXMiIGNsYXNzPSJvbiI+6LaF6YmE5p2/PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2RXYiPuacn+W+heWApDwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlVwc2V0Ij7ms6LkubHluqY8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZIb2xlIj7nqbTppqw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZSYWNlcyI+5YWo44Os44O844K5PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U3VtIj7lj5bjgorovrzjgb/nirbms4E8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZUZXN0Ij7mpJzoqLw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZTZXQiPuioreWumjwvYnV0dG9uPgo8L2Rpdj4KCjxkaXYgaWQ9ImdhdGUiPjwvZGl2PgoKPGRpdiBpZD0idkF4aXMiIGNsYXNzPSJ2aWV3IG9uIGNhcmQiPjxkaXYgY2xhc3M9InNtYWxsIj7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgII8L2Rpdj48L2Rpdj4KPGRpdiBpZD0idkV2IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlVwc2V0IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idkhvbGUiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2UmFjZXMiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2U3VtIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KCjxkaXYgaWQ9InZUZXN0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7lm57lj47njofjga7mpJzoqLzvvIjmiZXmiLvjgaTjgY3jg7vmmYLns7vliJfvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruaIkOe4vuOBqOaJleaIu+OBp+OAgeOAjOOBneOBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBoOOBkeOAjeOCkuS9v+OBhuODkOODg+OCr+ODhuOCueODiOOCkuOBl+OBvuOBme+8iOWQhOODrOODvOOCuTEwMOWGhu+8ieOAguOBk+OBk+OBpzxiPuWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBruWbnuWPjueOh+OBjDEwMCXjgpLotoXjgYjjgIHoqqTlt67jga7luYXjgpLlvJXjgYTjgabjgoIxMDAl5Lul5LiKPC9iPuOBqOeiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBoOOBkeOBjOOAgeeUu+mdouS4iuOBp+OAjOaknOiovOa4iOOBv+OAjeOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJidEdyYWRlIiBjbGFzcz0ic3ViIj7ph43os57jgaDjgZHvvJrjgrDjg6zjg7zjg4noo5zmraPjgYLjgoov44Gq44GX44KS5q+U6LyDPC9idXR0b24+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InBheUV4cCIgY2xhc3M9InN1YiI+5omV5oi744KS5pu444GN5Ye644GXPC9idXR0b24+PGxhYmVsIGNsYXNzPSJzbWFsbCI+6Kqt44G/6L6844G/IDxpbnB1dCBpZD0icGF5SW1wIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uIj48L2xhYmVsPjwvZGl2PgogPGRpdiBpZD0iYnRPdXQiIGNsYXNzPSJzdGF0dXMiPuODh+ODvOOCv+WPluW+l+OBruOBguOBqOOBp+Wun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8L2Rpdj4KCjxkaXYgaWQ9InZTZXQiIGNsYXNzPSJ2aWV3IGNhcmQiPgogPGgyPuODkOODg+OCr+OCouODg+ODl+ioreWumu+8iENsb3VkZmxhcmXjgavkv53lrZjvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuODkeOCueODleODrOODvOOCuuOBrlNIQS0yNTbjgaDjgZHjgpLkvb/jgaPjgabkv53lrZjlhYjjgpLliIbjgZHjgb7jgZnvvIjjg5Hjgrnjg5Xjg6zjg7zjgrroh6rkvZPjga/pgIHjgorjgb7jgZvjgpPvvInjgILlkIzjgZjjg5Hjgrnjg5Xjg6zjg7zjgrrjgaflvqnlhYPjgafjgY3jgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJia1Bhc3MiIHR5cGU9InBhc3N3b3JkIiBwbGFjZWhvbGRlcj0i44OR44K544OV44Os44O844K677yIOOaWh+Wtl+S7peS4iu+8iSIgYXV0b2NvbXBsZXRlPSJvZmYiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIwMHB4Ij48YnV0dG9uIGlkPSJia1Nob3ciIGNsYXNzPSJzdWIiPuihqOekujwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJia0F1dG8iIHR5cGU9ImNoZWNrYm94IiBjaGVja2VkPiDlpInmm7TjgYzjgYLjgozjgbDoh6rli5Xjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgZnjgos8L2xhYmVsPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJia05vdyI+5LuK44GZ44GQ5beu5YiG44OQ44OD44Kv44Ki44OD44OXPC9idXR0b24+PGJ1dHRvbiBpZD0iYmtSZXN0b3JlIiBjbGFzcz0ic3ViIj7jg5Djg4Pjgq/jgqLjg4Pjg5fjgYvjgonlvqnlhYM8L2J1dHRvbj48YnV0dG9uIGlkPSJia0Z1bGwiIGNsYXNzPSJzdWIiPuOBmeOBueOBpuS/neWtmOOBl+ebtOOBmTwvYnV0dG9uPjwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPumBjuWOu+ODh+ODvOOCv+OBruiqreOBv+i+vOOBv++8iOS7u+aEj++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Lul5YmN44Gu44OQ44OD44Kv44Ki44OD44OXSlNPTu+8j+aIkOe4vkNTVuOBjOOBguOCjOOBsOiqreOBv+i+vOOCgeOBvuOBme+8iOWQjOOBmOaXpeOBr+mHjeikh+OBl+OBvuOBm+OCk++8ieOAgjwvZGl2PgogPGlucHV0IGlkPSJmaWxlIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uLC5jc3YsYXBwbGljYXRpb24vanNvbix0ZXh0L2NzdiI+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+6Ki65patPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lh7rppqzooajjga7oqq3jgb/lj5bjgorjgavllY/poYzjgYzjgYLjgovjgajjgY3jgIHplovlgqzloLTjgZTjgajjgasxUuOBruODmuODvOOCuOOBruS4rei6q+OCkuiqv+OBueOBpuS4i+OBq+WHuuOBl+OBvuOBmeOAguOCs+ODlOODvOOBl+OBpumAgeOBo+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJkYmdHbyIgY2xhc3M9InN1YiI+6Ki65pat5oOF5aCx44KS5L2c44KLPC9idXR0b24+PGJ1dHRvbiBpZD0iZGJnQ29weSIgY2xhc3M9InN1YiI+44Kz44OU44O8PC9idXR0b24+PC9kaXY+CiA8dGV4dGFyZWEgaWQ9ImRiZ091dCIgcmVhZG9ubHkgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjE0MHB4O2ZvbnQtc2l6ZToxMnB4Ij48L3RleHRhcmVhPgo8L2Rpdj4KCjwvbWFpbj4KPGRpdiBpZD0iYnVzeSI+PGRpdj48ZGl2IGlkPSJidXN5VGV4dCI+5Yem55CG5Lit4oCmPC9kaXY+PC9kaXY+PC9kaXY+CjxzY3JpcHQ+CmNvbnN0IFVFPSgoKT0+ewogLyog5a6f44OH44O844K/5qSc6Ki844Gn6YCG5Yq55p6c44Gg44Gj44Gf5oiQ5YiG77yI6aiO5omL44O76ZaT6ZqU77yJ44Gv5pei5a6a44GnT0ZGICovCiBjb25zdCBERUZBVUxUPXtqb2NrZXk6ZmFsc2UsbGF5b2ZmOmZhbHNlfTsKIGNvbnN0IGNsYW1wPSh4LGEsYik9Pk1hdGgubWF4KGEsTWF0aC5taW4oYix4KSk7CiBjb25zdCBzaWdtb2lkPXg9PjEvKDErTWF0aC5leHAoLXgpKTsKIGNvbnN0IGxvZ2l0PXA9PntwPWNsYW1wKHAsLjAwMSwuOTk5KTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwogY29uc3Qgbm49cz0+U3RyaW5nKHM/PyIiKS5ub3JtYWxpemUoIk5GS0MiKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1tcc1x1MzAwMF0rL2csIiIpLnJlcGxhY2UoL1vjg7vvvaUu77yOXC3igJDigJHigJLigJPigJTigJUn4oCZYF0vZywiIikucmVwbGFjZSgvW+KYhuKYheKWs+KWsuKXh+KXhl0vZywiIik7CiAvKiDpqI7miYvlkI3vvJrlhYjpoK3jga7mrKflrZfjgqTjg4vjgrfjg6Pjg6vjgpLpmaTjgY3jgIHjg4fjg6Djg7zjg63ihpLjg4fjg6Ag44Gr5o+D44GI44KL77yISlJB44GuIEMu44OH44Og44O844OtIOOBqOmBjuWOu+ODh+ODvOOCv+OBriDvvKPvvI7jg4fjg6Ag44KS5LiA6Ie044GV44Gb44KL77yJICovCiBjb25zdCBqbm49cz0+e2xldCB2PW5uKFN0cmluZyhzPz8iIikucmVwbGFjZSgvXGR7Mn0oPzpcLlxkKT9ccyooPzprZ3zvvYvvvYcpL2dpLCIgIikucmVwbGFjZSgvW++8iChdW17vvIkpXXswLDh9W++8iSldL2csIiAiKS5yZXBsYWNlKC8o5qCX5p2xfOe+jua1pikvZywiICIpKTt2PXYucmVwbGFjZSgvXlthLXpdKD89W+OCoS3jg7bjg7xdKS8sIiIpO3Y9di5yZXBsYWNlKC9e44OH44Og44O844OtLywi44OH44OgIik7cmV0dXJuIHZ9OwogLyog44Kv44Op44K544Gu5q616ZqO77yaMD3kuI3mmI4gLyAtMT3lnLDmlrkgLyAxPeaWsOmmrOODu+acquWLneWIqSAvIDI9MeWLnSAvIDM9MuWLnSAvIDQ9M+WLnSAvIDU944Kq44O844OX44Oz44O76YeN6LOeICovCiBjb25zdCBsZXZlbE9mTGFiZWw9dD0+e2NvbnN0IHM9U3RyaW5nKHR8fCIiKTtpZigv5Zyw5pa5fE5BUi8udGVzdChzKSlyZXR1cm4gLTE7aWYoL+aWsOmmrHzmnKrli53liKkvLnRlc3QocykpcmV0dXJuIDE7aWYoLzHli518NTAw5LiHLy50ZXN0KHMpKXJldHVybiAyO2lmKC8y5YudfDEwMDDkuIcvLnRlc3QocykpcmV0dXJuIDM7aWYoLzPli518MTYwMOS4hy8udGVzdChzKSlyZXR1cm4gNDtpZigv44Kq44O844OX44OzfO+8r++8sHxPUHzjg6rjgrnjg4bjg4Pjg4l86YeN6LOefO+8p3xHWzEyM0ldL2kudGVzdChzKSlyZXR1cm4gNTtyZXR1cm4gMH07CiBjb25zdCBsZXZlbE9mUHJpemU9cD0+e3A9TnVtYmVyKHApO3JldHVybiAhKHA+MCk/MDpwPD03MDA/MTpwPD05MDA/MjpwPD0xMzAwPzM6cDw9MTgwMD80OjV9OwogLyog4piF44Kw44Os44O844OJ77yI5qC877yJ77yaMD3kuI3mmI4v5LiL57SaIDE9T1Djg7vjg6rjgrnjg4bjg4Pjg4kgMj1HMyAzPUcyIDQ9RzHjgIIKICAgIOW+k+adpeOBryBHMS9HMi9HMy9PUCDjgpLjgZnjgbnjgabjgIw144CN44Gr5r2w44GX44Gm44GE44Gf44Gf44KB44CBRzPli53jgaHjgYwgRzEg44Gn44KC5Ymy5byV44GV44KM44Gq44GL44Gj44Gf44CCCiAgICDliKTlrprpoIbvvJrjg6njg5njg6vvvIhORktD5b6MIEdJL0dJSS9HSUlJL0cx44CcRzPvvInihpIgMeedgOiznumHke+8iOS4h+WGhu+8ieKGku+8iOWvvuixoeODrOODvOOCueOBruOBv++8iUcx44Os44O844K55ZCNICovCiBjb25zdCBHMV9OQU1FUz0v5aSp55qH6LOefOaciemmrOiomOW/tXzjgrjjg6Pjg5Hjg7Pjgqvjg4Pjg5d844K444Oj44OR44Oz77yjfOWuneWhmuiomOW/tXzlronnlLDoqJjlv7V844O044Kj44Kv44OI44Oq44Ki44Oe44Kk44OrfOWkp+mYquadr3zpq5jmnb7lrq7oqJjlv7V844OV44Kn44OW44Op44Oq44O8fOODgeODo+ODs+ODlOOCquODs+OCunzjgrnjg5fjg6rjg7Pjgr/jg7zjgrp844Oe44Kk44Or44OB44Oj44Oz44OU44Kq44Oz44K344OD44OXfOOCqOODquOCtuODmeOCueWls+eOi+adr3znp4voj6/os5586I+K6Iqx6LOefOahnOiKseiznnzjgqrjg7zjgq/jgrl85YSq6ae/54md6aasfOaXpeacrOODgOODvOODk+ODvHzmnbHkuqzlhKrpp79855qQ5pyI6LOefE5IS+ODnuOCpOODq3zpmKrnpZ7jgrjjg6Xjg5njg4rjgqTjg6t85pyd5pel5p2vfOODm+ODvOODl+ODleODqy87CiBjb25zdCBncmFkZVRpZXI9KHRleHQscHJpemUsYnlOYW1lKT0+e2NvbnN0IHM9U3RyaW5nKHRleHR8fCIiKS5ub3JtYWxpemUoIk5GS0MiKTsKICBpZigv6Zqc5a6zfOOCuOODo+ODs+ODl3xKXC4/XHM/Ry9pLnRlc3QocykpcmV0dXJuIDA7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJSUl8MykoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDI7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJSXwyKSg/IVtBLVphLXowLTldKS8udGVzdChzKSlyZXR1cm4gMzsKICBpZigvKD86XnxbXkEtWmEtel0pRyg/Okl8MSkoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDQ7CiAgY29uc3QgcD1OdW1iZXIocHJpemUpO2lmKHA+MClyZXR1cm4gcD49MTAwMDA/NDpwPj01MDAwPzM6cD49MzUwMD8yOnA+PTE4MDA/MTowOwogIGlmKGJ5TmFtZSYmRzFfTkFNRVMudGVzdChzKSlyZXR1cm4gNDsKICBpZigv44Oq44K544OG44OD44OJfOOCquODvOODl+ODs3zvvK/vvLB8XGJPUFxiLy50ZXN0KHMpKXJldHVybiAxOwogIHJldHVybiAwfTsKIGNvbnN0IGlzSnJhVmVudWU9Yz0+L14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKGN8fCIiKSk7CiBjb25zdCBzdXJmQ29kZT1zPT57cz1TdHJpbmcoc3x8IiIpO3JldHVybiAv6IqdfHR1cmYvaS50ZXN0KHMpPzE6L+ODgHxkaXJ0L2kudGVzdChzKT8yOi/pmpx8anVtcC9pLnRlc3Qocyk/MzowfTsKIGNvbnN0IGRudW09ZD0+TnVtYmVyKFN0cmluZyhkfHwiIikucmVwbGFjZSgvXEQvZywiIikuc2xpY2UoMCw4KSl8fDA7CiBmdW5jdGlvbiBwYXJzZURhdGUocyl7CiAgcz1TdHJpbmcoc3x8IiIpO2xldCBtPXMubWF0Y2goLyhcZHs0fSlcRHswLDR9KFxkezEsMn0pXER7MCw0fShcZHsxLDJ9KS8pOwogIGlmKCFtKXJldHVybiIiO3JldHVybiBgJHttWzFdfS0ke21bMl0ucGFkU3RhcnQoMiwiMCIpfS0ke21bM10ucGFkU3RhcnQoMiwiMCIpfWA7CiB9CiBmdW5jdGlvbiBjc3ZSb3dzKHRleHQpewogIGNvbnN0IGxpbmVzPVN0cmluZyh0ZXh0fHwiIikucmVwbGFjZSgvXlx1RkVGRi8sIiIpLnNwbGl0KC9ccj9cbi8pLmZpbHRlcih4PT54LnRyaW0oKSk7CiAgaWYoIWxpbmVzLmxlbmd0aClyZXR1cm5bXTsKICBjb25zdCBzcGxpdD1sPT57Y29uc3QgYT1bXTtsZXQgYz0iIixxPWZhbHNlO2ZvcihsZXQgaT0wO2k8bC5sZW5ndGg7aSsrKXtjb25zdCBjaD1sW2ldOwogICBpZihjaD09PSciJyl7aWYocSYmbFtpKzFdPT09JyInKXtjKz0nIic7aSsrfWVsc2UgcT0hcX1lbHNlIGlmKGNoPT09IiwiJiYhcSl7YS5wdXNoKGMpO2M9IiJ9ZWxzZSBjKz1jaH1hLnB1c2goYyk7cmV0dXJuIGF9OwogIGNvbnN0IGhlYWQ9c3BsaXQobGluZXNbMF0pLm1hcCh4PT54LnRyaW0oKSk7Y29uc3Qgb3V0PVtdOwogIGZvcihsZXQgaT0xO2k8bGluZXMubGVuZ3RoO2krKyl7Y29uc3QgYT1zcGxpdChsaW5lc1tpXSksbz17fTtmb3IobGV0IGo9MDtqPGhlYWQubGVuZ3RoO2orKylvW2hlYWRbal1dPWFbal0/PyIiO291dC5wdXNoKG8pfQogIHJldHVybiBvdXQ7CiB9CiBjb25zdCBmPXY9Pntjb25zdCBuPXBhcnNlRmxvYXQoU3RyaW5nKHY/PyIiKS5yZXBsYWNlKC8sL2csIiIpKTtyZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pP246bnVsbH07CiAvKiDjg5Djg4Pjgq/jgqLjg4Pjg5cvQ1NW44GuMeihjOKGkui7vemHj+ihjCAqLwogY29uc3QgY2xlYW5Ucj10PT5TdHJpbmcodHx8IiIpLnJlcGxhY2UoL1xzKy9nLCIgIikudHJpbSgpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw2fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKD865qCX5p2xfOe+jua1pnzlnLDmlrl85aSW5Zu9fOaLm+W+hSlccypb44O7772lXT8vZywiICIpLnJlcGxhY2UoL1vjg7vvvaVdL2csIiAiKS5yZXBsYWNlKC9ccysvZywiICIpLnRyaW0oKTsKIGZ1bmN0aW9uIHRvUm93KG8pe2NvbnN0IF9yPXRvUm93MChvKTtfci50cmFpbmVyPWNsZWFuVHIob1si6Kq/5pWZ5birIl18fG8udHJhaW5lcnx8IiIpO19yLmdyZD1ncmFkZVRpZXIoU3RyaW5nKG9bImNsYXNzIl18fG8uY2xzfHwiIikrIiAiK1N0cmluZyhvWyLjg6zjg7zjgrnlkI0iXXx8by5yYWNlX25hbWV8fG8ucmFjZW5hbWV8fCIiKSxudWxsLGZhbHNlKTtyZXR1cm4gX3J9CiBmdW5jdGlvbiB0b1JvdzAobyl7CiAgY29uc3Qgc2E9U3RyaW5nKG9bIuaAp+m9oiJdfHwiIik7Y29uc3QgYW09c2EubWF0Y2goLyhcZCspLyk7CiAgcmV0dXJue3JhY2VJZDpTdHJpbmcob1siIl0/P28ucmFjZV9pZD8/b1siVW5uYW1lZDogMCJdPz8iIiksZGF0ZTpwYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSksCiAgIG5hbWU6U3RyaW5nKG9bIummrOWQjSJdfHxvLmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOm5uKG9bIummrOWQjSJdfHxvLmhvcnNlKSxqb2NrZXk6am5uKG9bIumojuaJiyJdfHxvLmpvY2tleSksam5hbWU6U3RyaW5nKG9bIumojuaJiyJdfHxvLmpvY2tleXx8IiIpLnRyaW0oKSxmaW5pc2g6ZihvWyLnnYDpoIYiXT8/by5maW5pc2gpLAogICBkaXN0OmYoby5jb3Vyc2VfbGVuPz9vWyLot53pm6IiXT8/by5kaXN0YW5jZSl8fDAsc3VyZjpzdXJmQ29kZShvLnJhY2VfdHlwZXx8b1si6Iqd44OAIl18fG8uc3VyZmFjZSksCiAgIGFnZTphbT9OdW1iZXIoYW1bMV0pOm51bGwsbnVtOmYob1si6aas55WqIl0pLHBvcDpmKG9bIuS6uuawlyJdKSxvZGRzOmYob1si5Y2Y5YudIl0pLAogICBsdmw6KCgpPT57Y29uc3QgaWQ9U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/PyIiKTtpZigvXlxkezEyfSQvLnRlc3QoaWQpJiYhaXNKcmFWZW51ZShpZC5zbGljZSg0LDYpKSlyZXR1cm4gLTE7cmV0dXJuIGxldmVsT2ZMYWJlbChvWyJjbGFzcyJdfHxvLmNscyl9KSgpfTsKIH0KIC8qIOaIkOe4vuOCueODiOOCou+8iOaXpeS7mOaYh+mghuOBqyBhZGQg44GZ44KL77yJICovCiBmdW5jdGlvbiBTdG9yZSgpe3RoaXMuaD1uZXcgTWFwKCk7dGhpcy5qPW5ldyBNYXAoKX0KIFN0b3JlLnByb3RvdHlwZS5hZGQ9ZnVuY3Rpb24ocil7CiAgaWYoci5maW5pc2g9PW51bGx8fCFyLmhvcnNlKXJldHVybjsKICBjb25zdCB0Mz1yLmZpbmlzaD49MSYmci5maW5pc2g8PTM/MTowOwogIGxldCBoPXRoaXMuaC5nZXQoci5ob3JzZSk7aWYoIWgpdGhpcy5oLnNldChyLmhvcnNlLGg9e246MCx0b3AzOjAsd2luOjAsc3VtOjAsbGFzdDoiIixydW5zOltdLGx2Ont9fSk7CiAgaC5uKys7aC50b3AzKz10MztpZihyLmZpbmlzaD09PTEpaC53aW4rKztoLnN1bSs9ci5maW5pc2g7aWYoci5kYXRlPmgubGFzdCloLmxhc3Q9ci5kYXRlOwogIGNvbnN0IEw9ci5sdmx8fDA7KGgubHZbTF09aC5sdltMXXx8WzAsMF0pO2gubHZbTF1bMF0rKztoLmx2W0xdWzFdKz10MzsKICBoLnJ1bnMucHVzaChbZG51bShyLmRhdGUpLHIuZmluaXNoLHIuZGlzdCxyLnN1cmYsTCxyLmdyZHx8MF0pO2lmKGgucnVucy5sZW5ndGg+Nil7aC5ydW5zLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7aC5ydW5zLnNoaWZ0KCl9CiAgaWYoci5qb2NrZXkpe2xldCBqPXRoaXMuai5nZXQoci5qb2NrZXkpO2lmKCFqKXRoaXMuai5zZXQoci5qb2NrZXksaj17bjowLHRvcDM6MH0pO2oubisrO2oudG9wMys9dDN9CiB9OwogLyog6aiO5omL77ya5a6M5YWo5LiA6Ie04oaS77yI55+t44GE6KGo6KiY44Gq44KJ77yJ5YmN5pa55LiA6Ie044GnMeS6uuOBq+e1nuOCjOOCi+OBqOOBjeOBoOOBkeaOoeeUqCAqLwogU3RvcmUucHJvdG90eXBlLmpvY2tleT1mdW5jdGlvbihuYW1lKXsKICBpZighbmFtZSlyZXR1cm4gbnVsbDsKICBjb25zdCBqPXRoaXMuai5nZXQobmFtZSk7aWYoailyZXR1cm4gajsKICBpZihuYW1lLmxlbmd0aDwyfHxuYW1lLmxlbmd0aD40KXJldHVybiBudWxsOwogIGlmKCF0aGlzLl9qa3x8dGhpcy5famtTaXplIT09dGhpcy5qLnNpemUpe3RoaXMuX2prPVsuLi50aGlzLmoua2V5cygpXTt0aGlzLl9qa1NpemU9dGhpcy5qLnNpemV9CiAgY29uc3QgYz10aGlzLl9qay5maWx0ZXIoaz0+ay5zdGFydHNXaXRoKG5hbWUpfHwobmFtZS5sZW5ndGg+PTMmJmsuc3RhcnRzV2l0aChuYW1lLnNsaWNlKDAsLTEpKSYmbmFtZS5sZW5ndGg8PWsubGVuZ3RoKSk7CiAgcmV0dXJuIGMubGVuZ3RoPT09MT90aGlzLmouZ2V0KGNbMF0pOm51bGw7CiB9OwogY29uc3QgbGF5b2ZmPShsYXN0LHRhcmdldCk9PntpZighbGFzdClyZXR1cm4gLjU7Y29uc3QgYT0obmV3IERhdGUodGFyZ2V0KS1uZXcgRGF0ZShsYXN0KSkvODY0ZTU7CiAgcmV0dXJuIGE8MjE/LjcyOmE8NjA/LjYyOmE8MTIwPy41NTphPDI0MD8uNDg6LjQyfTsKIC8qID09PT09IOWun+e4vuOBi+OCieWtpue/kuOBl+OBn+ODouODh+ODq++8iOeJueW+tOmHj+KGkjPnnYDlhoXnjofvvIkgPT09PT0gKi8KIGNvbnN0IEZOPVsiYmlhcyIsIm9mZnNldCIsIm5sb2ciLCJub0hpc3QiLCJmUyIsImZDIiwiYXZnRiIsInIzc2hhcmUiLCJyM2F2ZyIsImxhc3QxIiwibGFzdEJpZyIsImNvbmREaWZmIiwiZmlyc3RTdXJmIiwiZ2FwU2hvcnQiLCJnYXBMb25nIiwiZ2FwVkxvbmciLCJhZ2UzIiwiYWdlNCIsImFnZTciLCJzdGVwVXAiLCJzdGVwRG93biIsIndpblJhdGUiXTsKIGNvbnN0IEZKPVsialJlbCIsImpsb2ciLCJqTWlzcyJdOwogLyog5L+C5pWw44GvIHRvb2xzL2ZpdF9tb2RlbC5qcyDjgaflrabnv5LvvIgyMDIw5bm044Cc44Gu5pmC57O75YiX44OH44O844K/77yJ44CCe30g44KS572u5o+bICovCiBjb25zdCBNT0RFTD17ImNvcmUiOlswLjA1Mjk5LDAuOTk2OTcsMC4wNDk1MSwtMC4yNDU0MywtMC41MjgxMiwwLjkxOTQ2LC0wLjUxNDc2LC0wLjM0Nzg2LC0wLjU3OTA0LC0wLjU1MTE4LDAuMTY3NzMsMS4xMTgyLC0wLjM1MzA1LC0wLjExMTI4LC0wLjIyNzI4LC0wLjQwMTI5LDAuMTM3NzEsMC4yMTY2MiwtMC4zOTY3MywtMC4zNTMwNSwwLjAwNjE3LC0wLjU5NTY0XSwiZnVsbCI6WzAuNDA0MzMsMS4zNzAwNywwLjA2MjUxLC0wLjEyMjc5LC0wLjUwMjMyLDAuODI5NzgsLTAuMzk4OTUsLTAuMzAwNzIsLTAuNTE1NTksLTAuNTI1MzIsMC4xNTgzMiwxLjA2Njk1LC0wLjM4Mzc3LC0wLjA3MjgyLC0wLjIyNTY4LC0wLjM1MSwwLjE1MDI1LDAuMjEyNTMsLTAuNDEzMzQsLTAuMzIzMTksMC4wMDcyNiwtMC45Mzc5MiwwLjUzNTU3LDAuMDAzNjUsLTAuMjA2MDVdfTsKIGZ1bmN0aW9uIGZlYXRzKHIsc3RvcmUscmFjZSxOLHdpdGhKKXsKICBjb25zdCBiPWNsYW1wKDMvTiwuMDgsLjUpLGxiPWxvZ2l0KGIpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksbj1oP2gubjowLEx0PXJhY2UubHZsfHwwOwogIGNvbnN0IHBTPSgoaD9oLnRvcDM6MCkrMypiKS8obiszKSxmUz1sb2dpdChwUyktbGI7CiAgLy8g44Kv44Op44K56KOc5q2j77ya5L2O44GE44Kv44Op44K577yI5Zyw5pa544KS5ZCr44KA77yJ44Gn44Gu5aW96LWw44Gv5Ymy44KK5byV44GN44CB6auY44GE44Kv44Op44K544Gn44Gu5Yeh6LWw44Gv5Ymy44KK5byV44GPCiAgbGV0IGZDPWZTOwogIGlmKGgmJkx0PjApe2xldCBIPTAsTT0wOwogICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhoLmx2KSl7Y29uc3QgTD1OdW1iZXIoayksW2NuLGN0XT1oLmx2W2tdO2NvbnN0IGc9TD09PTA/MDooTDwwPy0yOkwtTHQpOwogICAgSCs9Y3QqY2xhbXAoMSsuMypnLC40LDEuOCk7TSs9KGNuLWN0KSpjbGFtcCgxLS4zKmcsLjQsMS44KX0KICAgZkM9bG9naXQoKEgrMypiKS8oSCtNKzMpKS1sYn0KICBjb25zdCBydW5zPWg/aC5ydW5zOltdLHJjPXJ1bnMuc2xpY2UoLTMpLGxhc3RSPXJ1bnMubGVuZ3RoP3J1bnNbcnVucy5sZW5ndGgtMV06bnVsbDsKICBjb25zdCByM3NoYXJlPXJjLmxlbmd0aD9yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoL3JjLmxlbmd0aDowOwogIGNvbnN0IHIzYXZnPXJjLmxlbmd0aD9jbGFtcCgocmMucmVkdWNlKChhLHgpPT5hK3hbMV0sMCkvcmMubGVuZ3RoLTYpLzYsLTEsMik6MDsKICBjb25zdCBsYXN0MT1sYXN0Uj9jbGFtcCgobGFzdFJbMV0tNikvNiwtMSwyKTowLGxhc3RCaWc9bGFzdFImJmxhc3RSWzFdPj0xMD8xOjA7CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwO2xldCBjb25kRGlmZj0wLGZpcnN0U3VyZj0wOwogIGlmKHNjJiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmKCFkaXN0fHxNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApKTsKICAgaWYoY3IubGVuZ3RoKWNvbmREaWZmPShjci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoKzIqcFMpLyhjci5sZW5ndGgrMiktcFM7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKWZpcnN0U3VyZj0xfQogIGxldCBnYXA9bnVsbDtpZihoJiZoLmxhc3QmJnJhY2UuZGF0ZSlnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgY29uc3QgYT1yLmFnZXx8MDsKICBjb25zdCBzdGVwRD1sYXN0UiYmbGFzdFJbNF0+MCYmTHQ+MD9jbGFtcChMdC1sYXN0Uls0XSwtMywzKTowOwogIGNvbnN0IHg9WzEsbGIsTWF0aC5sb2coMStuKSxuPT09MD8xOjAsZlMsZkMsbj9jbGFtcCgoaC5zdW0vbi02KS82LC0xLDIpOjAscjNzaGFyZSxyM2F2ZyxsYXN0MSxsYXN0QmlnLGNvbmREaWZmLGZpcnN0U3VyZiwKICAgZ2FwIT1udWxsJiZnYXA8MjE/MTowLGdhcCE9bnVsbCYmZ2FwPjEyMD8xOjAsZ2FwIT1udWxsJiZnYXA+MjQwPzE6MCxhPT09Mz8xOjAsYT09PTQ/MTowLGE+PTc/MTowLHN0ZXBEPjA/c3RlcEQ6MCxzdGVwRDwwPy1zdGVwRDowLAogICBuPygoaC53aW4rLjMqYikvKG4rMS41KS1iKTowXTsKICBpZih3aXRoSil7Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpOwogICBpZihqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSk7eC5wdXNoKGxvZ2l0KHBKKS1sYixNYXRoLmxvZygxK2oubiksMCl9ZWxzZSB4LnB1c2goMCwwLDEpfQogIHJldHVybiB4OwogfQogY29uc3QgZG90PSh3LHgpPT57bGV0IHo9MDtmb3IobGV0IGk9MDtpPHgubGVuZ3RoO2krKyl6Kz0od1tpXXx8MCkqeFtpXTtyZXR1cm4gen07CiBjb25zdCBtb2RlbFo9KGtpbmQseCk9PmRvdChNT0RFTFtraW5kXSx4KTsKIC8qIDHpoK3jga7ntKDngrkobG9naXQp44Go44K/44Kw44CCY29tcCDjgafmiJDliIbjgpJPTi9PRkbjgafjgY3jgovvvIjmpJzoqLznlKjvvIkgKi8KIGZ1bmN0aW9uIGhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcD17fSl7CiAgY29tcD1PYmplY3QuYXNzaWduKHt9LERFRkFVTFQsY29tcCk7Y29uc3QgdXNlPWs9PmNvbXBba10hPT1mYWxzZSYmY29tcFtrXSE9PTA7CiAgY29uc3QgYj1jbGFtcCgzL04sLjEsLjUpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksaj1zdG9yZS5qLmdldChyLmpvY2tleSk7CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxuPWg/aC5uOjAsdGFncz1bXTtsZXQgej0wLGNvbmY9IuS9jiI7CiAgY29uc3QgcEg9KChoP2gudG9wMzowKSs0KmIpLyhuKzQpO3orPWxvZ2l0KHBIKTsKICBpZihuPj0yKWNvbmY9bj49NT8i6auYIjoi5LitIjtlbHNlIHRhZ3MucHVzaCh7dDoi5bGl5q205LiN6LazIixjOiJnIn0pOwogIGlmKG4+PTMpe2NvbnN0IHQzPWgudG9wMy9uLHc9aC53aW4vbjsKICAgaWYodDM+PS40MCYmdzw9LjIwKXRhZ3MucHVzaCh7dDpg5ZaE5oim5Z6LIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGVsc2UgaWYodDM+PS40NSl0YWdzLnB1c2goe3Q6YOWuieWumiAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBpZih1c2UoImF2ZyIpJiZoLnN1bS9uPD01KXorPS4xMn0KICBjb25zdCByYz1ydW5zLnNsaWNlKC0zKTsKICBpZih1c2UoInJlY2VudCIpJiZyYy5sZW5ndGg+PTIpe2NvbnN0IGMzPXJjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgsYXZnPXJjLnJlZHVjZSgocyx4KT0+cyt4WzFdLDApL3JjLmxlbmd0aDsKICAgeis9LjIyKihjMy9yYy5sZW5ndGgtcEgpKjM7aWYoYzM+PTIpdGFncy5wdXNoKHt0OmDov5Eke3JjLmxlbmd0aH3otbDjgacke2MzfeWbnjPnnYDlhoVgLGM6ImIifSk7CiAgIGNvbnN0IGxhc3Q9cnVuc1tydW5zLmxlbmd0aC0xXTsKICAgaWYobGFzdCYmbGFzdFsxXT49OCYmbj49NCYmaC50b3AzL24+PS4zNSl7eis9LjE1O3RhZ3MucHVzaCh7dDpg5YmN6LWwJHtsYXN0WzFdfeedgOOBi+OCieW3u+OBjei/lOOBl+S9meWcsGAsYzoibyJ9KX0KICAgaWYoYXZnPD00JiZyYy5sZW5ndGg+PTMpeis9LjA4fQogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDsKICBpZih1c2UoImNvbmQiKSYmc2MmJmRpc3QmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiZNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSl7ei09LjM1O3RhZ3MucHVzaCh7dDpgJHtzYz09PTE/IuWIneOBruiKnSI6IuWIneOBruODgOODvOODiCJ977yI6YGO5Y676LWw44Gv5Yil6aas5aC077yJYCxjOiJvIn0pfQogICBpZihjci5sZW5ndGg+PTIpe2NvbnN0IHQzPWNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgscGM9KHQzKzIqcEgpLyhjci5sZW5ndGgrMik7CiAgICB6Kz1jbGFtcCgyKihwYy1wSCksLS41LC41KTtpZih0Mz49Mil0YWdzLnB1c2goe3Q6YOWQjOadoeS7tuOBpyR7dDN9LyR7Y3IubGVuZ3RofeWbnjPnnYDlhoVgLGM6ImIifSl9fQogIGlmKHVzZSgiam9ja2V5IikmJmomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KSxkaj1jbGFtcCguNioobG9naXQocEopLWxvZ2l0KGIpKSwtLjQsLjUpOwogICB6Kz1kajtpZihkaj49LjI1KXRhZ3MucHVzaCh7dDpg6aiO5omL5aW96Kq/IDPnnYDlhoUke01hdGgucm91bmQoai50b3AzL2oubioxMDApfSVgLGM6ImIifSl9CiAgaWYodXNlKCJsYXlvZmYiKSYmaCYmaC5sYXN0KXtjb25zdCBnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgIHorPS42KihsYXlvZmYoaC5sYXN0LHJhY2UuZGF0ZSktLjUpO2lmKGdhcD49MTgwKXRhZ3MucHVzaCh7dDpgJHtnYXB95pel44G244KKYCxjOiJvIn0pfQogIGlmKHVzZSgiYWdlIikpe2NvbnN0IGE9ci5hZ2V8fDU7aWYoYT09PTMpeis9LjEwO2Vsc2UgaWYoYT09PTQpeis9LjA1O2Vsc2UgaWYoYT49OCl7ei09LjE1O3RhZ3MucHVzaCh7dDpgJHthfeats2AsYzoibyJ9KX19CiAgcmV0dXJue3osdGFncyxjb25mLG59OwogfQogLyogMjAyM+W5tOS7pemZjeOBruaZguezu+WIl+aknOiovOOBp+OBriDntKDjga7lpb3otbDnjofihpLnqbTjgr7jg7zjg7Plrp/nuL7vvIjlubPlnYdwLCDlrp/nuL7vvIkgKi8KIGNvbnN0IENBTD1bWzAsMC4wMV0sWzAuMDIyLDAuMDE3XSxbMC4wNDYsMC4wMjJdLFswLjA3NSwwLjA0Nl0sWzAuMTA1LDAuMDY4XSxbMC4xMzUsMC4wODJdLFswLjE2NSwwLjA5OF0sWzAuMTkzLDAuMTAzXSxbMC4yMjQsMC4xMzhdLFswLjI1OSwwLjE2MV0sWzAuMzAyLDAuMTg3XSxbMC4zNTgsMC4yMTFdLFswLjQ1NCwwLjIyOV1dOwogLyog44Kq44OD44K644Gq44GX44Oi44O844OJ77yI5Lq65rCX44Gu5Luj55CG77yd6aiO5omL6L6844G/44Gu5a2m57+S44Oi44OH44Or44Gu6aCG5L2N44Gn56m044K+44O844Oz44KS5Yik5a6a77yJ44Gu6KOc5q2j6KGo44CCMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+S9nOaIkCAqLwogY29uc3QgQ0FMX1BST1hZPVtbMCwwLjAxM10sWzAuMDIyLDAuMDIxXSxbMC4wNDYsMC4wMjhdLFswLjA3NSwwLjA1Nl0sWzAuMTA1LDAuMDg2XSxbMC4xMzUsMC4xMTFdLFswLjE2NSwwLjEzNF0sWzAuMTkzLDAuMTQ2XSxbMC4yMjQsMC4yMDFdLFswLjI1OSwwLjIxOV0sWzAuMzAxLDAuMjYxXSxbMC4zNTUsMC4yOTZdLFswLjQzOSwwLjM2N11dOwogZnVuY3Rpb24gaW50ZXJwKFQscCl7Zm9yKGxldCBpPTE7aTxULmxlbmd0aDtpKyspaWYocDw9VFtpXVswXSl7Y29uc3RbYSxiXT1UW2ktMV0sW2MsZF09VFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gVFtULmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIGNhbGliRm9yKHAsbW9kZSl7cmV0dXJuIG1vZGU9PT0ib2RkcyI/aW50ZXJwKENBTCxwKTppbnRlcnAoQ0FMX1BST1hZLHApfQogZnVuY3Rpb24gY2FsaWIocCl7Zm9yKGxldCBpPTE7aTxDQUwubGVuZ3RoO2krKylpZihwPD1DQUxbaV1bMF0pe2NvbnN0W2EsYl09Q0FMW2ktMV0sW2MsZF09Q0FMW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBDQUxbQ0FMLmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIG5vcm1hbGl6ZVRvcDMoenMsdG90YWwpe2xldCBsbz0tOCxoaT04OwogIGZvcihsZXQgaT0wO2k8NjA7aSsrKXtjb25zdCBjPShsbytoaSkvMixzPXpzLnJlZHVjZSgoYSx6KT0+YStzaWdtb2lkKHorYyksMCk7aWYocz50b3RhbCloaT1jO2Vsc2UgbG89Y30KICBjb25zdCBjPShsbytoaSkvMjtyZXR1cm4genMubWFwKHo9PnNpZ21vaWQoeitjKSl9CiAvKiBIYXJ2aWxsZeazleOBp+WLneeOh+KGkjPnnYDlhoXnjocgKi8KIGZ1bmN0aW9uIHRvcDNGcm9tV2luKHB3KXtjb25zdCBUPXB3LnJlZHVjZSgoYSxiKT0+YStiLDApLHA9cHcubWFwKHg9PngvVCksbj1wLmxlbmd0aCxvdXQ9bmV3IEFycmF5KG4pLmZpbGwoMCk7CiAgZm9yKGxldCBpPTA7aTxuO2krKyl7bGV0IHM9cFtpXTsKICAgZm9yKGxldCBqPTA7ajxuO2orKylpZihqIT09aSl7cys9cFtqXSpwW2ldLygxLXBbal0pOwogICAgZm9yKGxldCBrPTA7azxuO2srKylpZihrIT09aSYmayE9PWopcys9cFtqXSpwW2tdLygxLXBbal0pKnBbaV0vKDEtcFtqXS1wW2tdKX0KICAgb3V0W2ldPXN9cmV0dXJuIG91dH0KIC8qIOKYheagvOS4iuOBkuijnOato++8muWtpue/kua4iOOBv+ODouODh+ODq+OBr+edgOmghuOCkuOBneOBruOBvuOBvuimi+OCi+OBruOBp+OAgeS4i+S9jeOCsOODrOODvOODieOBp+OBruWlvei1sOOBjOmHjeiznuODu0cx44Gn44KC5ZCM5L6h5YCk44Gr44Gq44Gj44Gm44GE44Gf44CCCiAgICDnm7Tov5Ez6LWw44Gu44GG44GhIE9QL+mHjeiznijjgq/jg6njgrk1KeOBrui1sOOBq+OBpOOBhOOBpuOAgeS7iuWbnuOBruOCsOODrOODvOODieOBqOOBruW3ruOBoOOBkeijnOato+OBmeOCi++8iOOCr+ODqeOCuTTku6XkuIvjga/jg6Ljg4fjg6vlgbTjga7oo5zmraPjgYzjgYLjgovjga7jgafkuozph43mjpvjgZHjgZfjgarjgYTvvInjgIIKICAgICAg5qC85LiK44GS77yI5L6LIEcz4oaSRzHvvInvvJrlpb3otbDjga7kvqHlgKTjgpLlibLjgorlvJXjgY/vvIjnnYDpoIbjgYzoia/jgYTjgbvjganlpKfjgY3jgY/vvIkKICAgICAg5qC85LiL44GS77yI5L6LIEcx4oaSRzLvvInvvJrlh6HotbDjga7kvqHlgKTjgpLlsJHjgZfmiLvjgZkKICAgIOS/guaVsOOBr+aaq+WumuWApOOAguKRoC0y44Gu44CM44Kw44Os44O844OJ6KOc5q2j44Gu5Yq55p6c5q+U6LyD44CN44Gn44CB6KOc5q2j44GC44KKL+OBquOBl+OCkuWQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+avlOOBueOBpueiuuiqjeOBmeOCi+OBk+OBqOOAgiAqLwogY29uc3QgR1JBREU9e29uOnRydWUsS1VQOi4zMCxLRE46LjEyLE1JTjotLjksTUFYOi41fTsKIGZ1bmN0aW9uIGdyYWRlQWRqKHIsc3RvcmUscmFjZSxjb21wKXsKICBpZighR1JBREUub258fChjb21wJiZjb21wLmdyYWRlPT09ZmFsc2UpKXJldHVybiAwOwogIGNvbnN0IEd0PXJhY2UuZ3JkfHwwO2lmKEd0PDIpcmV0dXJuIDA7CiAgY29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtpZighaHx8IWgucnVucy5sZW5ndGgpcmV0dXJuIDA7CiAgY29uc3QgcmM9aC5ydW5zLnNsaWNlKC0zKSxXPVtbMV0sWy40LC42XSxbLjIsLjMsLjVdXVtyYy5sZW5ndGgtMV07bGV0IGQ9MDsKICByYy5mb3JFYWNoKCh4LGspPT57Y29uc3QgZmluPXhbMV0sTD14WzRdfHwwLEdyPXhbNV18fDA7aWYoTCE9PTV8fCEoZmluPjApKXJldHVybjsKICAgY29uc3QgZ3I9TWF0aC5tYXgoR3IsMik7ICAgICAgICAgIC8vIE9Q44O744Kw44Os44O844OJ5LiN5piO44Gu44Kv44Op44K5Nei1sOOBryBHMyDnm7jlvZPjgajjgZfjgabmr5TovIMKICAgaWYoR3Q+Z3ImJmZpbjw9NSlkLT1XW2tdKkdSQURFLktVUCooR3QtZ3IpKig2LWZpbikvNjsKICAgZWxzZSBpZihHdDxnciYmZmluPj00KWQrPVdba10qR1JBREUuS0ROKihnci1HdCkqTWF0aC5taW4oMSwoZmluLTMpLzgpfSk7CiAgcmV0dXJuIGNsYW1wKGQsR1JBREUuTUlOLEdSQURFLk1BWCl9CiBjb25zdCBHTj1bIuS4jeaYji/kuIvntJoiLCJPUOODu0wiLCJHMyIsIkcyIiwiRzEiXTsKIGZ1bmN0aW9uIGdyYWRlVGFncyh0YWdzLGR6LHJhY2Upe2NvbnN0IHQ9dGFncy5zbGljZSgpOwogIGlmKGR6PD0tLjIpdC51bnNoaWZ0KHt0OmDmoLzkuIrjgZLmiKbvvIgke0dOW3JhY2UuZ3JkfHwwXX3vvInvvJrkuIvkvY3jgrDjg6zjg7zjg4njga7lpb3otbDjga/libLlvJUgJHtkei50b0ZpeGVkKDIpfWAsYzoibyJ9KTsKICBlbHNlIGlmKGR6Pj0uMSl0LnVuc2hpZnQoe3Q6YOmrmOOCsOODrOODvOODieOBi+OCieOBruagvOS4i+OBkiAke2R6Pj0wPyIrIjoiIn0ke2R6LnRvRml4ZWQoMil9YCxjOiJiIn0pOwogIHJldHVybiB0fQogLyog44Os44O844K56Kej5p6Q44CCb2RkcyDjga/ku7vmhI/vvIjlhajpoK3liIbvvInjgIIgKi8KIGNvbnN0IExWTj1bIuS4jeaYjiIsIuacquWLneWIqSIsIjHli50iLCIy5YudIiwiM+WLnSIsIk9QIl07CiBmdW5jdGlvbiBleHRyYVRhZ3ModGFncyxyLHN0b3JlLHJhY2UpewogIGNvbnN0IHQ9dGFncy5zbGljZSgpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksTHQ9cmFjZS5sdmx8fDA7CiAgaWYoaCl7Y29uc3QgbGFzdD1oLnJ1bnMubGVuZ3RoP2gucnVuc1toLnJ1bnMubGVuZ3RoLTFdOm51bGw7CiAgIGlmKGxhc3QmJmxhc3RbNF0+MCYmTHQ+MCYmbGFzdFs0XSE9PUx0KXQudW5zaGlmdChsYXN0WzRdPEx0P3t0OmDmmIfntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJvIn06e3Q6YOmZjee0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6ImIifSk7CiAgIGlmKGgubHYmJmgubHZbLTFdKXQucHVzaCh7dDoi5Zyw5pa544Gn44Gu5Ye66LWw44GC44KK77yI5Ymy5byV6KmV5L6h77yJIixjOiJnIn0pfQogIHJldHVybiB0fQogLyog44Op44Oz44Kv77ya56m044K+44O844Oz44Gu5bmz5Z2H44Gr5a++44GZ44KL5YCN546H44GnIFMvQS9CL0PvvIjlsaXmrbTjgYwx6LWw5Lul5LiL44GvQuOBvuOBp++8iSAqLwogY29uc3QgQVZHX0hPTEU9e29kZHM6LjA5MSxwcm94eTouMTE1fTsKIGZ1bmN0aW9uIHJhdGluZyhwYyxtb2RlLG4pe2NvbnN0IHI9cGMvQVZHX0hPTEVbbW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il07bGV0IGs9cj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiO2lmKG48MiYmKGs9PT0iUyJ8fGs9PT0iQSIpKWs9IkIiO3JldHVybiBrfQogLyog55qE5Lit546H6YeN6KaW77ya5a6f57i+M+i1sOS7peS4iuODu+ODqeODs+OCr1MvQeODu++8iOOCquODg+OCuuOBjOWIhuOBi+OCi+OBqOOBjeOBr++8ieWNmOWLnTMw5YCN5pyq5rqA44Gu5aSn56m044KS6Zmk44GP44CC6YGO5Y6744Gu5qSc6Ki844Gn44CB55qE5Lit546H44GM5LiK44GM44KK44CB5Zue5Y+O546H44GM5pyA5oKq44Gu5aSn56m044KS6YG/44GR44KJ44KM44GfICovCiBjb25zdCBGT0NVU19NQVhfT0REUz0zMDsKIGNvbnN0IEZPQ1VTPXsib2RkcyI6eyJuIjozNjI1LCJoaXQiOjAuMjMyLCJiYXNlSGl0IjowLjE3MiwicGVyRGF5IjoxMy42fSwicHJveHkiOnsibiI6NDAyNSwiaGl0IjowLjI3MiwiYmFzZUhpdCI6MC4yMTcsInBlckRheSI6MTUuMX19OyAgIC8vIDIwMjTlubTku6XpmY3jga7mpJzoqLzvvJrnmoTkuK3njofvvIhiYXNlSGl0PeW+k+adpeOBrjHkvY3lgJnoo5zvvInjg7vplovlgqzml6XjgYLjgZ/jgorjga7poK3mlbAKIGZ1bmN0aW9uIHBpY2tGb2N1cyhyZXMsayl7cmV0dXJuIHJlcy5maWx0ZXIoeD0+eC5ob2xlJiZ4Lm4+PTMmJihyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKT09PSJTInx8cmF0aW5nKHgucGMseC5tb2RlLHgubik9PT0iQSIpJiYoeC5vZGQ9PW51bGx8fHgub2RkPEZPQ1VTX01BWF9PRERTKSkuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCxrKX0KIC8qIOeptOmmrOWAmeijnO+8muWun+e4vuOBruOBguOCi+mmrO+8iDPotbDku6XkuIrvvInjgaDjgZHjgpLjgIHlpb3otbDnjofjga7pq5jjgYTpoIbjgasgayDpoK3jgILlsaXmrbTjga7kuY/jgZfjgYTppqzjga/lkIzngrnjgavjgarjgorjgoTjgZnjgY/jgIHpoIbkvY3jgavmhI/lkbPjgYzjgarjgYTjgZ/jgoHlr77osaHlpJYgKi8KIGZ1bmN0aW9uIHBpY2socmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLGspfQogZnVuY3Rpb24gYW5hbHl6ZShyYWNlLHN0b3JlLG9kZHMsY29tcCxwb3BBcnIpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGg7CiAgY29uc3Qgc2M9Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wKSk7CiAgY29uc3QgZHo9Ui5tYXAocj0+Z3JhZGVBZGoocixzdG9yZSxyYWNlLGNvbXApKTsKICBjb25zdCB6YzA9TU9ERUwuY29yZT9SLm1hcChyPT5tb2RlbFooImNvcmUiLGZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSkpOnNjLm1hcCh4PT54LnopO2NvbnN0IHpjPXpjMC5tYXAoKHosaSk9PnorZHpbaV0pOwogIGNvbnN0IHA9bm9ybWFsaXplVG9wMyh6YyxNYXRoLm1pbigzLE4pKTsKICBsZXQgbWt0PW51bGwscG9wPW51bGwsbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXtta3Q9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7cG9wPW9kZHMubWFwKG89PjErb2Rkcy5maWx0ZXIoeD0+eDxvKS5sZW5ndGgpO21vZGU9Im9kZHMifQogIGVsc2UgaWYocG9wQXJyJiZwb3BBcnIubGVuZ3RoPT09TiYmcG9wQXJyLmV2ZXJ5KHg9Png+MCkpe3BvcD1wb3BBcnIuc2xpY2UoKTttb2RlPSJvZGRzIn0gLy8g5a6f6Zqb44Gu5Lq65rCX6aCG5L2N44Gg44GR5YiG44GL44KL44Go44GN77yI57WQ5p6c44Oa44O844K455Sx5p2l77yJCiAgZWxzZXsgLy8g44Kq44OD44K644KC5Lq65rCX44KC44Gq44GE44Go44GN77ya6aiO5omL5oiQ57i+44G+44Gn5ZCr44KB44Gf44K544Kz44Ki44Gu6aCG5L2N44KS44CM5Lq65rCX44Gu5Luj55CG44CN44Gr44GZ44KL77yI5a6f6Zqb44Gu5Lq65rCX44Go44Gu55u46ZaiIDAuNTXihpIwLjY377yJCiAgIGNvbnN0IHB4PU1PREVMLmZ1bGw/Ui5tYXAocj0+bW9kZWxaKCJmdWxsIixmZWF0cyhyLHN0b3JlLHJhY2UsTix0cnVlKSkpOlIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4se2pvY2tleTp0cnVlLGxheW9mZjpmYWxzZX0pLnopO2NvbnN0IHB4Mj1weC5tYXAoKHYsaSk9PnYrZHpbaV0pO3BvcD1weDIubWFwKHY9PjErcHgyLmZpbHRlcih5PT55PnYpLmxlbmd0aCl9CiAgY29uc3QgcmFuaz1wLm1hcCh2PT4xK3AuZmlsdGVyKHg9Png+dikubGVuZ3RoKTsKICBjb25zdCBjdXQ9TWF0aC5tYXgoNSxNYXRoLmNlaWwoTiouNCkpOwogIHJldHVybiBSLm1hcCgocixpKT0+KHtpLG5vOnIubnVtfHxpKzEsbmFtZTpyLm5hbWV8fHIuaG9yc2UscDpwW2ldLHBjOmNhbGliRm9yKHBbaV0sbW9kZSksbW9kZSwKICAgam46KHN0b3JlLmpvY2tleShyLmpvY2tleSl8fHtuOjB9KS5uLHJhbms6cmFua1tpXSxwb3A6cG9wW2ldLGJhc2U6TWF0aC5taW4oLjUsMy9OKSwKICAgb2RkOihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSk/b2Rkc1tpXTpudWxsLAogICBjYXJlZXI6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD97bjpoLm4sdDM6aC50b3AzLHdpbjpoLndpbn06bnVsbH0pKCksCiAgIHJlY2VudDooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gucnVucy5tYXAoeD0+eFsxXSk6W119KSgpLAogICBqbmFtZTpyLmpuYW1lfHwiIixqc3RhdDooKCk9Pntjb25zdCBqPXN0b3JlLmpvY2tleShyLmpvY2tleSk7cmV0dXJuIGomJmoubj49MT97bjpqLm4scmF0ZTpqLnRvcDMvai5ufTpudWxsfSkoKSwKICAgaG9sZTpOPj02JiZwb3BbaV0+PWN1dCxta3Q6bWt0P21rdFtpXTpudWxsLHZhbHVlOm1rdD9jYWxpYkZvcihwW2ldLCJvZGRzIikvbWt0W2ldOm51bGwsCiAgIGR6OmR6W2ldLHRhZ3M6Z3JhZGVUYWdzKGV4dHJhVGFncyhzY1tpXS50YWdzLHIsc3RvcmUscmFjZSksZHpbaV0scmFjZSksY29uZjpzY1tpXS5jb25mLG46c2NbaV0ubixjdXR9KSk7CiB9CgogLyogPT09PT0g6YmE5p2/6Lu46aas44O75rOi5Lmx5bqm77yI56m06aas5LqI5oOz44Go44Gv5Yil44Gu6KiI566X44CC5L+C5pWw44GvIHRvb2xzL2F4aXNfdXBzZXRfc3R1ZHkuanMg44Gn5a2m57+S44CBMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+aknOiovO+8iSA9PT09PSAqLwogY29uc3QgQVhJUz17IndQIjpbMC4wNTE5MywxLjAxNDgzLDAuMDUxNDgsLTAuMjA2NzYsLTAuNTMyMTYsMC45MTQzNywtMC40ODQ2NCwtMC4zMjExNSwtMC41NjgwMiwtMC41NTEzNSwwLjE3MzQ1LDEuMDk3NCwtMC4yODQwNywtMC4xMDM5NywtMC4yMTYxNywtMC4zNDY2OCwwLjE1OTEzLDAuMjIxOTYsLTAuMzg3MzIsLTAuMzQ2NTgsMC4wMDM3LC0wLjU2NjQ2XSwid08iOlswLjU0MjU5LDAuMTU2NjEsMC4wNTQxNCwtMC4wNDM3MSwtMC4xNDUyNCwwLjEzMTcxLC0wLjE0MTc4LC0wLjE2MjYzLDAuMDUzMTYsLTAuMDIwOTcsMC4wMDM5LC0wLjI5ODY1LC0wLjMyMzIxLC0wLjAxMzY1LC0wLjA5NTE5LC0wLjA3ODE4LDAuMDAwNiwtMC4wMjI5MSwtMC4xMTIxMywwLjAxNzgxLC0wLjA0NzQ1LC0wLjEwODUyLDAuMjU3MjEsMC42MzA3MV0sInVwc2V0Ijp7InRociI6MTUsIm1vZGVscyI6eyJwcm94eSI6WzIuMjQ1NTksMC42Mzg0MSwtMC4wNzA4LC0wLjA4MTYxLC0wLjA3NzQzLDAuMDkxMzcsMC4xMzg0NywwLjAwMjc5LC0wLjM4OTE5LC0wLjY0MjE3LC0wLjU1MzgxLC0wLjAxODM3LC0wLjQ0MzE3LC0wLjc2ODI1LC0wLjUyMzkzLC0yLjczNTYxLC0wLjE0OTA5LDAuMTE0NzddLCJvZGRzIjpbLTAuNzIzOTYsMC40MjgwOCwtMC4wNzQ5OSwtMC4wNjE1NCwtMC4wMDY3NSwwLjA3MjQzLDAuMDcwODUsLTAuMDQ5NzQsLTAuMTU1MjgsLTAuMzI1MTYsLTAuNDE4MjYsLTAuMzEzNTEsMC4yMDc1NywtMC4yMzksLTAuMjc5MDEsLTEuODIxMDgsLTAuMDA4NTIsMC4wODM5OSwwLjE1MDI0LDAuMzUyNDIsLTIuMDM4MzksMi44NTY2OCwwLjIyOTI5LDAuNzIwODQsLTEuOTc3OTddfSwiZ3JhZGVzIjp7InByb3h5Ijp7ImN1dHMiOltbIlNTUyIsMC41NTAzN10sWyJTUyIsMC40ODU1XSxbIlMiLDAuNDA0MjRdLFsiQSIsMC4yOTg4XSxbIkIiLDAuMTg5NTddLFsiQyIsMC4wMDYyOV1dLCJyYXRlcyI6eyJTU1MiOjAuNTc0LCJTUyI6MC41MDksIlMiOjAuNDMzLCJBIjowLjM0NywiQiI6MC4yNDQsIkMiOjAuMDg5fSwiYXZnUyI6eyJTU1MiOjE3LjIsIlNTIjoxNS4zLCJTIjoxNC4yLCJBIjoxMy4xLCJCIjoxMS44LCJDIjo5Ljh9fSwib2RkcyI6eyJjdXRzIjpbWyJTU1MiLDAuNjA5NjhdLFsiU1MiLDAuNTE1OTVdLFsiUyIsMC40MDg1NF0sWyJBIiwwLjI4NzY3XSxbIkIiLDAuMTczNTldLFsiQyIsMC4wMDc2OF1dLCJyYXRlcyI6eyJTU1MiOjAuNjc5LCJTUyI6MC41OTgsIlMiOjAuNDU1LCJBIjowLjM1MiwiQiI6MC4yNDYsIkMiOjAuMDc5fSwiYXZnUyI6eyJTU1MiOjE4LjUsIlNTIjoxNi40LCJTIjoxNC41LCJBIjoxMy4zLCJCIjoxMS44LCJDIjo5LjZ9fX19LCJiYW5kcyI6eyLpiYTmnb8iOnsibG8iOjAuOTIsImhpIjoxLCJuIjoxNjYsInJhdGUiOjAuOTYzOSwibG85NSI6MC45MzU1LCJuMiI6ODcsInJhdGUyIjowLjk3NywicGVyRGF5IjowLjYyfSwi5rqW6YmE5p2/Ijp7ImxvIjowLjg4LCJoaSI6MC45MiwibiI6Mjc5LCJyYXRlIjowLjg4NTMsImxvOTUiOjAuODQ3OSwibjIiOjEzOSwicmF0ZTIiOjAuODk5MywicGVyRGF5IjoxLjA0fSwi5aCF6Lu4Ijp7ImxvIjowLjg0LCJoaSI6MC44OCwibiI6NDc0LCJyYXRlIjowLjg0MTgsImxvOTUiOjAuODA4OSwibjIiOjIyNiwicmF0ZTIiOjAuODQwNywicGVyRGF5IjoxLjc4fX19OwogZnVuY3Rpb24gYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyl7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aCx4Yz1SLm1hcChyPT5mZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpOwogIGNvbnN0IHBQPW5vcm1hbGl6ZVRvcDMoeGMubWFwKHg9PmRvdChBWElTLndQLHgpKSxNYXRoLm1pbigzLE4pKTsKICBsZXQgcE89bnVsbDsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7CiAgIGNvbnN0IGludj1vZGRzLm1hcChvPT4xL28pLFQ9aW52LnJlZHVjZSgoYSxiKT0+YStiLDApLHB3PWludi5tYXAodj0+di9UKSxtMz10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTsKICAgcE89bm9ybWFsaXplVG9wMyh4Yy5tYXAoKHgsaSk9PmRvdChBWElTLndPLFsuLi54LE1hdGgubG9nKHB3W2ldKSxsb2dpdChNYXRoLm1pbiguOTgsbTNbaV0pKV0pKSxNYXRoLm1pbigzLE4pKX0KICByZXR1cm57cFAscE8seGN9fQogLyog6YmE5p2/6Lu46aas77ya44Kq44OD44K644GM44GC44KL44Os44O844K544Gg44GR44CC5LqI5ris56K6546H44Gu5Yy65YiG44GU44Go44Gr44CB6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh+OCkua3u+OBiOOCiyAqLwogZnVuY3Rpb24gYXhpc1BpY2tzKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpO2lmKCFhcC5wTylyZXR1cm4gbnVsbDsKICBjb25zdCBvdXQ9W107YXAucE8uZm9yRWFjaCgocCxpKT0+ewogICBmb3IoY29uc3QgayBvZiBbIumJhOadvyIsIua6lumJhOadvyIsIuWghei7uCJdKXtjb25zdCBiPUFYSVMuYmFuZHNba107aWYocD49Yi5sbyYmcDwoaz09PSLpiYTmnb8iPzEuMDE6Yi5oaSkpe291dC5wdXNoKHtpLHAsdGllcjprLHJhdGU6Yi5yYXRlLGxvOTU6Yi5sbzk1LG46Yi5ufSk7YnJlYWt9fX0pOwogIHJldHVybiBvdXQuc29ydCgoYSxiKT0+Yi5wLWEucCl9CiAvKiDms6LkubHluqbvvJpTU1PjgJxD44CCM+edgOWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK44Gr44Gq44KL56K6546H44Gn562J57Sa44Gl44GRICovCiBmdW5jdGlvbiB1cHNldEdyYWRlKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpOwogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgscHM9YXAucFAuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpOwogIGNvbnN0IG5zPVIubWFwKHI9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gubjowfSksbW9udGg9TnVtYmVyKFN0cmluZyhyYWNlLmRhdGUpLnNsaWNlKDUsNykpfHwwLEw9cmFjZS5sdmx8fDA7CiAgY29uc3QgZj1bMSxOLzE2LEw9PT0xPzE6MCxMPT09Mj8xOjAsTD09PTM/MTowLEw9PT00PzE6MCxMPT09NT8xOjAscmFjZS5zdXJmPT09MT8xOjAsKHJhY2UuZGlzdHx8MCkvMjAwMCwKICAgbnMuZmlsdGVyKG49Pm49PT0wKS5sZW5ndGgvTixucy5maWx0ZXIobj0+bjwzKS5sZW5ndGgvTixucy5yZWR1Y2UoKGEsbik9PmErTWF0aC5sb2coMStuKSwwKS9OLzMsCiAgIHBzWzBdLHBzWzFdLHBzWzJdLHBzLnJlZHVjZSgoYSxwKT0+YStwKnAsMCkscHMuZmlsdGVyKHA9PnA+LjUpLmxlbmd0aC8zLG1vbnRoPj02JiZtb250aDw9OT8xOjBdOwogIGxldCBtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCkuc29ydCgoYSxiKT0+Yi1hKSxvZD1vZGRzLnNsaWNlKCkuc29ydCgoYSxiKT0+YS1iKTsKICAgY29uc3QgZW50PS1wdy5yZWR1Y2UoKGEscCk9PmErcCpNYXRoLmxvZyhwKSwwKS9NYXRoLmxvZyhOKTsKICAgZi5wdXNoKHB3WzBdLHB3WzFdLHB3WzBdK3B3WzFdK3B3WzJdLGVudCxNYXRoLmxvZyhvZFswXSksTWF0aC5sb2cob2RbMV0pLG9kLmZpbHRlcihvPT5vPDEwKS5sZW5ndGgvTik7bW9kZT0ib2RkcyJ9CiAgY29uc3QgcD1zaWdtb2lkKGRvdChBWElTLnVwc2V0Lm1vZGVsc1ttb2RlXSxmKSksRz1BWElTLnVwc2V0LmdyYWRlc1ttb2RlXTsKICBsZXQgZ3JhZGU9IkMiO2Zvcihjb25zdCBbZyxjXSBvZiBHLmN1dHMpe2lmKHA+PWMpe2dyYWRlPWc7YnJlYWt9fQogIHJldHVybntncmFkZSxwLG1vZGUscmF0ZTpHLnJhdGVzW2dyYWRlXSxhdmdTOkcuYXZnU1tncmFkZV19fQoKIC8qIOaJleaIu+OBpOOBjeaZguezu+WIl+ODkOODg+OCr+ODhuOCueODiOOAgnJhY2VzIOOBr+aXpeS7mOaYh+mghiBbe2lkLGRhdGUscm93c31d44CBcGF5QnlJZCDjga8ge3JhY2VJZDp7cGxhY2U6W3tudW1iZXIseWVufV19feOAggogICAg56m044K+44O844Oz44Gv5a6f44Kq44OD44K66aCG5L2N44Gn5a6a576p77yI44OE44O844Or44Gu44Kq44OD44K65YWl5Yqb44Oi44O844OJ44Go5ZCM44GY54q25rOB77yJ44CC5ZCE44Os44O844K5MTAw5YaG44Ga44Gk6LO85YWl44CCICovCiBmdW5jdGlvbiBiYWNrdGVzdChyYWNlcyxwYXlCeUlkLG9wdHMpewogIG9wdHM9b3B0c3x8e307Y29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IiIsU1BMSVQ9b3B0cy5zcGxpdHx8IiIsT09TPW9wdHMub29zfHwiIixQUk9YWT0hIW9wdHMucHJveHksTUlORz1OdW1iZXIob3B0cy5taW5HcmQpfHwwLF9nT249R1JBREUub247R1JBREUub249IW9wdHMuZ3JhZGVPZmY7CiAgY29uc3QgbmFtZXM9WyJ0b3AxIiwidG9wMiIsInRvcDMiLCJhbGxIb2xlIiwidmFsdWUiLCJheGlzIiwiZm9jdXMiXSxwZXI9WyJhbGwiLCJBIiwiQiIsIkMiXTsKICBjb25zdCBTPXt9O2Zvcihjb25zdCBuIG9mIG5hbWVzKXtTW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcilTW25dW3BdPXtiZXRzOjAsaGl0czowLHJldDowLHNxOjB9fQogIGNvbnN0IFNFRz17fTsgICAvLyAx5L2N5YCZ6KOc44Gu5p2h5Lu25Yil77yI5YWo5pyf6ZaT77yP5YmN5Y2K77yP5b6M5Y2K77yJCiAgY29uc3Qgc3RvcmU9bmV3IFN0b3JlKCk7bGV0IHVzZWQ9MDsKICBjb25zdCBhZGQ9KG4scCxoaXQseWVuKT0+e2NvbnN0IHg9U1tuXVtwXTt4LmJldHMrKztpZihoaXQpeC5oaXRzKys7eC5yZXQrPXllbjt4LnNxKz15ZW4qeWVufTsKICBjb25zdCBhZGRTZWc9KGxhYmVsLHAseWVuKT0+e2NvbnN0IGc9U0VHW2xhYmVsXT1TRUdbbGFiZWxdfHx7YWxsOntuOjAsaDowLHI6MCxxOjB9LEE6e246MCxoOjAscjowLHE6MH0sQjp7bjowLGg6MCxyOjAscTowfX07Zm9yKGNvbnN0IGsgb2YgWyJhbGwiLHBdKXtjb25zdCB4PWdba107eC5uKys7aWYoeWVuPjApeC5oKys7eC5yKz15ZW47eC5xKz15ZW4qeWVufX07CiAgY29uc3QgQVY9UFJPWFk/LjExNTouMDkxOwogIGZvcihjb25zdCByYyBvZiByYWNlcyl7CiAgIC8vIOaJleaIu+OBrklE44Gv44CM5pel5LuYLemWi+WCrOWgtC1S55Wq5Y+344CN44CC44OQ44OD44Kv44Ki44OD44OX44GuMTLmoYFJROOBqOOCguOAgeWQjOOBmOW9ouW8j+OBrklE44Go44KC57WQ44Gz5LuY44GR44KLCiAgIGNvbnN0IHZPZj0vXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDQsNik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzNdfHwiIixyT2Y9TnVtYmVyKC9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoMTAsMTIpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVs0XXx8MCk7CiAgIGNvbnN0IHBheT1wYXlCeUlkW3JjLmlkXXx8cGF5QnlJZFtgJHtyYy5kYXRlfS0ke3ZPZn0tJHtTdHJpbmcock9mKS5wYWRTdGFydCgyLCIwIil9YF07CiAgIGlmKHBheSYmcGF5LnBsYWNlJiZwYXkucGxhY2UubGVuZ3RoJiZyYy5kYXRlPj1TVEFSVCYmKCFNSU5HfHwoKHJjLnJvd3NbMF0mJnJjLnJvd3NbMF0uZ3JkKXx8MCk+PU1JTkcpKXsKICAgIC8vIOWHuui1sOihqOOBqOWQjOOBmOmmrOeVqumghuOBq+S4puOBueOCi++8iOWQjOeCueOBruOBqOOBjeOBruS4puOBs+OBp+edgOmghuOBjOa8j+OCjOOBquOBhOOCiOOBhuOBq++8iQogICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKTsKICAgIGNvbnN0IGhhc09kZHM9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5vZGRzPjEpLGhhc1BvcD1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLnBvcD4wKTsKICAgIGlmKFBST1hZP1IubGVuZ3RoPj02OihoYXNPZGRzfHxoYXNQb3ApKXsKICAgICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLGdyZDpSWzBdLmdyZHx8MCxydW5uZXJzOlJ9OwogICAgIGNvbnN0IHJlcz1QUk9YWT9hbmFseXplKHJhY2Usc3RvcmUsbnVsbCk6KGhhc09kZHM/YW5hbHl6ZShyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpOmFuYWx5emUocmFjZSxzdG9yZSxudWxsLG51bGwsUi5tYXAocj0+ci5wb3ApKSk7CiAgICAgY29uc3QgeWVuPW5ldyBNYXAocGF5LnBsYWNlLm1hcCh4PT5beC5udW1iZXIseC55ZW5dKSk7CiAgICAgY29uc3QgaG9sZT1yZXMuZmlsdGVyKHg9PnguaG9sZSkuc29ydCgoYSxiKT0+Yi5wLWEucCk7CiAgICAgaWYoaG9sZS5sZW5ndGgpewogICAgICB1c2VkKys7Y29uc3QgcHI9U1BMSVQ/KHJjLmRhdGU8U1BMSVQ/IkEiOiJCIik6IkEiOwogICAgICBjb25zdCBidXk9KG4sbGlzdCk9Pntmb3IoY29uc3QgeCBvZiBsaXN0KXtjb25zdCB5PXllbi5nZXQoUlt4LmldLm51bSl8fDA7YWRkKG4sImFsbCIseT4wLHkpO2FkZChuLHByLHk+MCx5KTtpZihPT1MmJnJjLmRhdGU+PU9PUylhZGQobiwiQyIseT4wLHkpfX07CiAgICAgIGJ1eSgiZm9jdXMiLHBpY2tGb2N1cyhyZXMsMSkpOwogICAgICBidXkoInRvcDEiLHBpY2socmVzLDEpKTtidXkoInRvcDIiLHBpY2socmVzLDIpKTtidXkoInRvcDMiLHBpY2socmVzLDMpKTtidXkoImFsbEhvbGUiLGhvbGUpOwogICAgICBpZighUFJPWFkpYnV5KCJ2YWx1ZSIsaG9sZS5maWx0ZXIoeD0+eC52YWx1ZT49MS4zKSk7CiAgICAgIGlmKCFQUk9YWSYmaGFzT2Rkcyl7Y29uc3QgYXA9YXhpc1Byb2JzKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7aWYoYXAucE8pYnV5KCJheGlzIixhcC5wTy5tYXAoKHAsaSk9Pih7aSxwfSkpLmZpbHRlcih4PT54LnA+PUFYSVMuYmFuZHNbIumJhOadvyJdLmxvKSl9CiAgICAgIGNvbnN0IHQ9cGljayhyZXMsMSlbMF07CiAgICAgIGlmKHQpe2NvbnN0IHk9eWVuLmdldChSW3QuaV0ubnVtKXx8MCxyPXQucGMvQVYsTj1SLmxlbmd0aDsKICAgICAgIGNvbnN0IHJhbms9KHI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIik7CiAgICAgICBhZGRTZWcoIuODqeODs+OCryIrKHQubjwyJiYocmFuaz09PSJTInx8cmFuaz09PSJBIik/IkIiOnJhbmspLHByLHkpOwogICAgICAgYWRkU2VnKE48PTEwPyLpoK3mlbAg44CcMTAiOk48PTE0PyLpoK3mlbAgMTHjgJwxNCI6IumgreaVsCAxNeOAnCIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5zdXJmPT09MT8i6IqdIjpyYWNlLnN1cmY9PT0yPyLjg4Djg7zjg4giOiLjgZ3jga7ku5YiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2UubHZsPjA/IuOCr+ODqeOCuSAiK0xWTltyYWNlLmx2bF06IuOCr+ODqeOCuSDkuI3mmI4iLHByLHkpOwogICAgICAgYWRkU2VnKHQubj49NT8i5a6f57i+IDXotbDku6XkuIoiOnQubj49Mz8i5a6f57i+IDPjgJw06LWwIjoi5a6f57i+IDPotbDmnKrmuoAiLHByLHkpOwogICAgICAgaWYoIVBST1hZJiZ0Lm9kZCl7Y29uc3Qgbz10Lm9kZDthZGRTZWcobzw4PyLljZjli50g44CcOOWAjSI6bzwxNT8i5Y2Y5YudIDjjgJwxNeWAjSI6bzwzMD8i5Y2Y5YudIDE144CcMzDlgI0iOm88NjA/IuWNmOWLnSAzMOOAnDYw5YCNIjoi5Y2Y5YudIDYw5YCN44CcIixwcix5KTsKICAgICAgICBpZihoYXNPZGRzKXtjb25zdCB1Zz11cHNldEdyYWRlKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7YWRkU2VnKCLms6LkubHluqYgIit1Zy5ncmFkZSxwcix5KX19fQogICAgIH0KICAgIH0KICAgfQogICBmb3IoY29uc3QgciBvZiByYy5yb3dzKXN0b3JlLmFkZChyKTsKICB9CiAgY29uc3QgZmluPXt9OwogIGZvcihjb25zdCBuIG9mIG5hbWVzKXtmaW5bbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKXtjb25zdCB4PVNbbl1bcF07CiAgIGlmKCF4LmJldHMpe2ZpbltuXVtwXT17YmV0czowfTtjb250aW51ZX0KICAgY29uc3QgbWVhbj14LnJldC94LmJldHMsc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5zcS94LmJldHMtbWVhbiptZWFuKSk7CiAgIGZpbltuXVtwXT17YmV0czp4LmJldHMsaGl0UmF0ZTp4LmhpdHMveC5iZXRzLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5iZXRzKS8xMDB9fX0KICBjb25zdCBzZWdzPXt9OwogIGZvcihjb25zdCBbayxnXSBvZiBPYmplY3QuZW50cmllcyhTRUcpKXtzZWdzW2tdPXt9O2Zvcihjb25zdCBwIG9mIFsiYWxsIiwiQSIsIkIiXSl7Y29uc3QgeD1nW3BdOwogICBpZigheC5uKXtzZWdzW2tdW3BdPXtiZXRzOjB9O2NvbnRpbnVlfWNvbnN0IG1lYW49eC5yL3gubixzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnEveC5uLW1lYW4qbWVhbikpOwogICBzZWdzW2tdW3BdPXtiZXRzOngubixoaXRSYXRlOnguaC94Lm4scm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4Lm4pLzEwMH19fQogIEdSQURFLm9uPV9nT247cmV0dXJue3JhY2VzOnVzZWQsc3RhdHM6ZmluLHNlZ3N9OwogfQogcmV0dXJue2NsZWFuVHIsR1JBREUsZ3JhZGVUaWVyLGdyYWRlQWRqLEZPQ1VTLHJhdGluZyxwaWNrRm9jdXMsQVhJUyxheGlzUHJvYnMsYXhpc1BpY2tzLHVwc2V0R3JhZGUscGljayxmZWF0cyxNT0RFTCxGTixGSixsZXZlbE9mTGFiZWwsbGV2ZWxPZlByaXplLGJhY2t0ZXN0LGNhbGliLGNhbGliRm9yLGpubixubix0b1Jvdyxjc3ZSb3dzLFN0b3JlLGFuYWx5emUsaG9yc2VTY29yZSxub3JtYWxpemVUb3AzLHRvcDNGcm9tV2luLHN1cmZDb2RlLHBhcnNlRGF0ZX07Cn0pKCk7CgoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDjgqLjg5fjg6rlsaTvvIjlho3mp4vnr4nvvIkKICogIOODu+S/neWtmC/lho3plovjgaTjgY3jga7pgY7ljrvjg4fjg7zjgr/lj5blvpfjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjgIHmpJzoqLzjga/jgIHli5XkvZznorroqo3muIjjgb/jga7lh6bnkIbjgpLjgZ3jga7jgb7jgb7lho3liKnnlKgKICogIOODu+S7iumAseacq+OBruWPluW+l+OAgemojuaJi+ODu+iqv+aVmeW4q+OBrueFp+WQiOOAgeacn+W+heWApOOAgei2hemJhOadv+OAgeazouS5seW6puOAgeWPluOCiui+vOOBv+WTgeizquOBruihqOekuuOBr+aWsOimjwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0ICQ9aWQ9PmRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsKY29uc3QgZXNjPXM9PlN0cmluZyhzPz8iIikucmVwbGFjZSgvWyY8PiInXS9nLG09Pih7IiYiOiImYW1wOyIsIjwiOiImbHQ7IiwiPiI6IiZndDsiLCciJzoiJnF1b3Q7IiwiJyI6IiYjMzk7In1bbV0pKTsKY29uc3Qgc2xlZXA9KG1zPTApPT5uZXcgUHJvbWlzZShyPT5zZXRUaW1lb3V0KHIsbXMpKTsKZnVuY3Rpb24gYnVzeShvbixtc2c9IuWHpueQhuS4reKApiIpeyQoImJ1c3kiKS5zdHlsZS5kaXNwbGF5PW9uPyJmbGV4Ijoibm9uZSI7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1tc2d9CmxldCBEQj1udWxsLFNUT1JFPW51bGwsU1RPUkVfS0VZPSIiOwpjb25zdCBWRU5VRT17IjAxIjoi5pyt5bmMIiwiMDIiOiLlh73ppKgiLCIwMyI6Iuemj+WztiIsIjA0Ijoi5paw5r2fIiwiMDUiOiLmnbHkuqwiLCIwNiI6IuS4reWxsSIsIjA3Ijoi5Lit5LqsIiwiMDgiOiLkuqzpg70iLCIwOSI6IumYquelniIsIjEwIjoi5bCP5YCJIn07CmNvbnN0IGpzdFRvZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpjb25zdCBwY3Q9KHgsaz0wKT0+eD09bnVsbHx8IU51bWJlci5pc0Zpbml0ZSh4KT8iLSI6KHgqMTAwKS50b0ZpeGVkKGspKyIlIjsKCmZ1bmN0aW9uIG9wZW5EQigpe3JldHVybiBuZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgcj1pbmRleGVkREIub3BlbigidXBzZXRfdG9vbF9kYiIsMik7CiByLm9udXBncmFkZW5lZWRlZD1lPT57Y29uc3QgZD1lLnRhcmdldC5yZXN1bHQ7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygiZmlsZXMiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJmaWxlcyIpO2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoIm1ldGEiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJtZXRhIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygicGF5IikpZC5jcmVhdGVPYmplY3RTdG9yZSgicGF5Iil9Owogci5vbnN1Y2Nlc3M9KCk9PntEQj1yLnJlc3VsdDtvaygpfTtyLm9uZXJyb3I9KCk9Pm5nKHIuZXJyb3IpO3Iub25ibG9ja2VkPSgpPT5uZyhuZXcgRXJyb3IoIuS7luOBruOCv+ODluOBp+S9v+eUqOS4reOBp+OBmSIpKX0pfQpjb25zdCBpZGJBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJmaWxlcyIpLm9iamVjdFN0b3JlKCJmaWxlcyIpLmdldEFsbCgpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgaWRiUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJmaWxlcyIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgiZmlsZXMiLGspO29rKCl9O3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgaWRiQ2xlYXI9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpLHN0PXQub2JqZWN0U3RvcmUoImZpbGVzIik7c3Qub3BlbkN1cnNvcigpLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7aWYoIVN0cmluZyhjLmtleSkuc3RhcnRzV2l0aCgibGl2ZToiKSl7bWFya0RpcnR5KCJmaWxlcyIsYy5rZXkpO2MuZGVsZXRlKCl9Yy5jb250aW51ZSgpfX07dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKCi8qIOWPluOCiui+vOOBv+a4iOOBv+OBruWFqOihjO+8iOODkOODg+OCr+OCouODg+ODl0NTVu+8i+WPluW+l+a4iOOBv+OBruaIkOe4vu+8ieOCkumghuOBq+a4oeOBmSAqLwphc3luYyBmdW5jdGlvbiBmb3JFYWNoUm93KGNiKXsKIGNvbnN0IGZzPWF3YWl0IGlkYkFsbCgpOwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXtjb25zdCBmPWZzW2ldOwogIGlmKGYubGl2ZSl7Zm9yKGNvbnN0IHggb2YgZi5yb3dzfHxbXSljYihsaXZlUm93KHgpKX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKWNiKFVFLnRvUm93KG8pKTsKICBpZihpJTM9PT0yKWF3YWl0IHNsZWVwKDApfQp9Ci8qIOODrOODvOOCuUlE44GL44KJ6ZaL5YKs5aC044O7UueVquWPt++8iDEy5qGB44GuSlJB5b2i5byP77yP5pel5LuYLemWi+WCrOWgtC1S5b2i5byP44Gu5Lih5a++5b+c77yJICovCmZ1bmN0aW9uIHZlbnVlT2ZJZChpZCl7cmV0dXJuIC9eXGR7MTJ9JC8udGVzdChpZCk/aWQuc2xpY2UoNCw2KTpTdHJpbmcoaWQpLnNwbGl0KCItIilbM118fCIifQpmdW5jdGlvbiByYWNlTm9PZklkKGlkKXtyZXR1cm4gTnVtYmVyKC9eXGR7MTJ9JC8udGVzdChpZCk/aWQuc2xpY2UoMTAsMTIpOlN0cmluZyhpZCkuc3BsaXQoIi0iKVs0XXx8MCl9CgovKiAtLS0g5Y+W44KK6L6844G/IC0tLSAqLwphc3luYyBmdW5jdGlvbiBpbXBvcnRGaWxlKGZpbGUpewogYnVzeSh0cnVlLCLjg5XjgqHjgqTjg6vjgpLoqq3jgb/ovrzjgb/kuK3igKZcbuWkp+OBjeOBhOODleOCoeOCpOODq+OBr+aVsOWNgeenkuOBi+OBi+OCiuOBvuOBmeOAgiIpO2F3YWl0IHNsZWVwKDMwKTsKIHRyeXsKICBjb25zdCB0ZXh0PWF3YWl0IGZpbGUudGV4dCgpO2xldCBpdGVtczsKICBpZigvXC5jc3YkL2kudGVzdChmaWxlLm5hbWUpKXtpdGVtcz1be3R5cGU6InJhY2UtcmVzdWx0cyIseWVhcjowLHBsYWNlOmZpbGUubmFtZSxjc3Y6dGV4dH1dfQogIGVsc2V7Y29uc3Qgaj1KU09OLnBhcnNlKHRleHQpO2l0ZW1zPUFycmF5LmlzQXJyYXkoaik/ajooai5maWxlc3x8W2pdKX0KICBpdGVtcz1pdGVtcy5maWx0ZXIoeD0+eCYmdHlwZW9mIHguY3N2PT09InN0cmluZyIpOwogIGlmKCFpdGVtcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCJjc3bjgpLlkKvjgoDjg4fjg7zjgr/jgYzopovjgaTjgYvjgorjgb7jgZvjgpPjgILjg5Djg4Pjgq/jgqLjg4Pjg5dKU09O44GL44CBQ1NW44KS6YG444KT44Gn44GP44Gg44GV44GE44CCIik7CiAgYXdhaXQgaWRiQ2xlYXIoKTtsZXQgbj0wOwogIGZvcihsZXQgaT0wO2k8aXRlbXMubGVuZ3RoO2krKyl7Y29uc3QgaXQ9aXRlbXNbaV07YXdhaXQgaWRiUHV0KGAke2l0LnllYXJ8fDB9OiR7aXQucGxhY2V9OiR7aX1gLHt5ZWFyOml0LnllYXIscGxhY2U6aXQucGxhY2UscGxhY2VOYW1lOml0LnBsYWNlTmFtZSxjc3Y6aXQuY3N2fSk7CiAgIG4rPU1hdGgubWF4KDAsaXQuY3N2LnNwbGl0KCJcbiIpLmxlbmd0aC0xKTskKCJidXN5VGV4dCIpLnRleHRDb250ZW50PWDkv53lrZjkuK3igKYgJHtpKzF9LyR7aXRlbXMubGVuZ3RofWA7YXdhaXQgc2xlZXAoMCl9CiAgU1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7CiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluOCiui+vOOBv+WujOS6hu+8miR7aXRlbXMubGVuZ3RofeODleOCoeOCpOODq++8j+e0hCR7bi50b0xvY2FsZVN0cmluZygpfeihjDwvc3Bhbj5gOwogIGJrU2NoZWR1bGUoKTsKIH1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5Y+W44KK6L6844G/44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7YnVzeShmYWxzZSl9Cn0KCmNvbnN0IHBheUFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oInBheSIpLm9iamVjdFN0b3JlKCJwYXkiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IHBheVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oInBheSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoInBheSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgicGF5IixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IG1ldGFHZXQ9az0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oIm1ldGEiKS5vYmplY3RTdG9yZSgibWV0YSIpLmdldChrKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHQpO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgbWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJtZXRhIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmFzeW5jIGZ1bmN0aW9uIHBheVN0YXRlKCl7YXdhaXQgc2hvd1N0YXRlKCl9CgovKiAtLS0g5YWx6YCa44Gu5Y+W5b6X77yI5YaN6Kmm6KGM44Gk44GN77yJIC0tLSAqLwpsZXQgU1lOQ0lORz1mYWxzZTsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hKU09OKHVybCx3YWl0c0FyZyl7CiBsZXQgZXJyPSIiO2NvbnN0IHdhaXRzPXdhaXRzQXJnfHx3aW5kb3cuX19XQUlUU3x8WzQwMDAsMTIwMDAsMzAwMDAsNjAwMDBdOwogZm9yKGxldCB0PTA7dDw9d2FpdHMubGVuZ3RoO3QrKyl7CiAgdHJ5ewogICBjb25zdCByPWF3YWl0IGZldGNoKHVybCk7Y29uc3QgdHh0PWF3YWl0IHIudGV4dCgpO2xldCB4PXt9O3RyeXt4PUpTT04ucGFyc2UodHh0KX1jYXRjaChlKXt9CiAgIGlmKCFyLm9rfHx4Lm9rPT09ZmFsc2Upe2NvbnN0IGU9bmV3IEVycm9yKHguZXJyb3J8fGBIVFRQICR7ci5zdGF0dXN9YCsodHh0JiYheC5lcnJvcj9g77yIJHt0eHQucmVwbGFjZSgvXHMrL2csIiAiKS5zbGljZSgwLDUwKX3vvIlgOiIiKSk7ZS5zdGF0dXM9ci5zdGF0dXM7dGhyb3cgZX0KICAgcmV0dXJuIHg7CiAgfWNhdGNoKGUpewogICBlcnI9ZS5tZXNzYWdlO2NvbnN0IHJldHJ5PSFlLnN0YXR1c3x8ZS5zdGF0dXM+PTUwMHx8ZS5zdGF0dXM9PT00Mjk7CiAgIGlmKCFyZXRyeXx8dD09PXdhaXRzLmxlbmd0aClicmVhazsKICAgaWYoU1lOQ0lORykkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YOa3t+mbkeOBruOBn+OCgSR7TWF0aC5yb3VuZCh3YWl0c1t0XS8xMDAwKX3np5LlvoXjgaPjgablho3oqabooYzjgZfjgb7jgZnigKbvvIgke2Vycn3vvIlgOwogICBhd2FpdCBzbGVlcCh3YWl0c1t0XSk7CiAgfQogfQogdGhyb3cgbmV3IEVycm9yKGVycik7Cn0KY29uc3QgTU9ERUxfVFJBSU5fRU5EPSIyMDI2LTA2LTIyIjsgICAvLyDnj77lnKjjga7jg6Ljg4fjg6vjga/jgIHjgZPjga7ml6XjgojjgorliY3jga7miJDnuL7jgaflrabnv5IKY29uc3QganN0WWVzdGVyZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzLTg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpjb25zdCBhZGREYXlzPShkLG4pPT5uZXcgRGF0ZShuZXcgRGF0ZShkKyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpK24qODY0ZTUpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmZ1bmN0aW9uIG1vbnRoc0JldHdlZW4oYSxiKXtjb25zdCBvdXQ9W107bGV0W3ksbV09YS5zbGljZSgwLDcpLnNwbGl0KCItIikubWFwKE51bWJlcik7Y29uc3RbeTIsbTJdPWIuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpOwogd2hpbGUoeTx5Mnx8KHk9PT15MiYmbTw9bTIpKXtvdXQucHVzaChgJHt5fS0ke1N0cmluZyhtKS5wYWRTdGFydCgyLCIwIil9YCk7bSsrO2lmKG0+MTIpe209MTt5Kyt9fXJldHVybiBvdXR9CgoKLyogLS0tIOKRoCDjg4fjg7zjgr/lj5blvpfvvJrpgY7ljrvmiJDnuL7vvIjkurrmsJfjgaTjgY3vvInvvIvmiZXmiLvjgpLjgIHplovlgqzml6XjgZTjgajjgavlj5blvpfjgZfjgabkv53lrZggLS0tICovCmNvbnN0IFNZTkNfQkFUQ0g9NCxTWU5DX1BBUkFMTEVMPTI7CmxldCBTU1RPUD1mYWxzZSxCQUNLVVBfREFURVM9bnVsbDsKJCgic3luY1N0b3AiKS5vbmNsaWNrPSgpPT57U1NUT1A9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWV9OwokKCJzZW5kIikudmFsdWU9anN0WWVzdGVyZGF5KCk7CmFzeW5jIGZ1bmN0aW9uIGJhY2t1cERhdGVzKCl7CiBpZihCQUNLVVBfREFURVMpcmV0dXJuIEJBQ0tVUF9EQVRFUzsKIGNvbnN0IHM9bmV3IFNldCgpLGZzPWF3YWl0IGlkYkFsbCgpOwogZm9yKGNvbnN0IGYgb2YgZnMpe2lmKGYubGl2ZSljb250aW51ZTtmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSl7Y29uc3QgZD1VRS5wYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSk7aWYoZClzLmFkZChkKX1hd2FpdCBzbGVlcCgwKX0KIHJldHVybiBCQUNLVVBfREFURVM9czsKfQphc3luYyBmdW5jdGlvbiBmZXRjaERheShiYXNlLGQpewogY29uc3QgZGF5PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5P2RhdGU9JHtkfWApOwogY29uc3QgcmFjZXM9ZGF5LnJhY2VzfHxbXTtpZighcmFjZXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIik7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSs9U1lOQ19CQVRDSCljaHVua3MucHVzaChyYWNlcy5zbGljZShpLGkrU1lOQ19CQVRDSCkubWFwKHg9PnguY25hbWUpKTsKIGNvbnN0IHJvd3M9W10scGF5b3V0cz1bXTtsZXQgaWR4PTAsZmFpbGVkTj0wOwogY29uc3Qgd29ya2VyPWFzeW5jKCk9Pnt3aGlsZShpZHg8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1pZHgrKzsKICBjb25zdCByZXM9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1yZXN1bHRzP2NuYW1lcz0ke2NodW5rc1trXS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCk7CiAgcm93cy5wdXNoKC4uLihyZXMucm93c3x8W10pKTtwYXlvdXRzLnB1c2goLi4uKHJlcy5wYXlvdXRzfHxbXSkpO2ZhaWxlZE4rPShyZXMuZmFpbGVkfHxbXSkubGVuZ3RofX07CiBhd2FpdCBQcm9taXNlLmFsbChBcnJheS5mcm9tKHtsZW5ndGg6TWF0aC5taW4oU1lOQ19QQVJBTExFTCxjaHVua3MubGVuZ3RoKX0sd29ya2VyKSk7CiBjb25zdCBnb3Q9bmV3IFNldChyb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemU7CiBmYWlsZWROPU1hdGgubWF4KGZhaWxlZE4scmFjZXMubGVuZ3RoLWdvdCk7CiByZXR1cm57cm93cyxwYXlvdXRzLGZhaWxlZE4scmFjZXM6cmFjZXMubGVuZ3RofTsKfQokKCJzeW5jR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogY29uc3QgYT0kKCJzc3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpO2xldCBiPSQoInNlbmQiKS52YWx1ZXx8eWQ7aWYoYj55ZCliPXlkOwogaWYoYT5iKXskKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IumWi+Wni+aXpeOBjOe1guS6huaXpeOCiOOCiuW+jOOBp+OBmeOAgiI7cmV0dXJufQogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoInN5bmNHbyIpLmRpc2FibGVkPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD1mYWxzZTsKIGNvbnN0IHN0PXtkYXlzOjAscmFjZXM6MCxza2lwcGVkOjAsZmFpbDpbXSx0MDpEYXRlLm5vdygpfTtsZXQgY29uc2VjPTA7CiB0cnl7CiAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLkv53lrZjmuIjjgb/jg4fjg7zjgr/jgpLnorroqo3kuK3igKYiOwogIGNvbnN0IGZpbGVzPWF3YWl0IGlkYkFsbCgpLGhhdmVMaXZlPW5ldyBTZXQoZmlsZXMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkubWFwKGY9PmYuZGF0ZSkpOwogIGNvbnN0IGhhdmVQYXk9bmV3IFNldCgoYXdhaXQgcGF5QWxsKCkpLmZpbHRlcihwPT4hcC5mYWlsZWQpLm1hcChwPT5wLmRhdGUpKTsKICBjb25zdCBiaz1hd2FpdCBiYWNrdXBEYXRlcygpOwogIGNvbnN0IG1vbnRocz1tb250aHNCZXR3ZWVuKGEsYiksY3VyTW9udGg9eWQuc2xpY2UoMCw3KTsKICBmb3IobGV0IG1pPTA7bWk8bW9udGhzLmxlbmd0aDttaSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgbW9udGg9bW9udGhzW21pXTsKICAgaWYobW9udGg8Y3VyTW9udGgmJmF3YWl0IG1ldGFHZXQoIm1vbnRoOiIrbW9udGgpKXtjb250aW51ZX0KICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke21vbnRofe+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iemWi+WCrOaXpeOCkueiuuiqjeS4reKApiDlj5blvpfmuIjjgb8ke3N0LmRheXN95pelYDsKICAgbGV0IGRheXM7dHJ5e2RheXM9KGF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5cz9tb250aD0ke21vbnRofWApKS5kYXlzfHxbXTtjb25zZWM9MH1jYXRjaChlKXtzdC5mYWlsLnB1c2goYCR7bW9udGh977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICBkYXlzPWRheXMuZmlsdGVyKGQ9PmQ+PWEmJmQ8PWIpO2xldCBtb250aE9rPXRydWU7CiAgIGZvcihjb25zdCBkIG9mIGRheXMpewogICAgaWYoU1NUT1Ape21vbnRoT2s9ZmFsc2U7YnJlYWt9CiAgICBjb25zdCBuZWVkUm93cz0haGF2ZUxpdmUuaGFzKGQpJiYhYmsuaGFzKGQpLG5lZWRQYXk9IWhhdmVQYXkuaGFzKGQpOwogICAgaWYoIW5lZWRSb3dzJiYhbmVlZFBheSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfQogICAgY29uc3QgZWw9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS1zdC50MCkvMTAwMCk7CiAgICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZH0g44KS5Y+W5b6X5Lit77yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJXG7lj5blvpcke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmA7CiAgICB0cnl7CiAgICAgY29uc3Qgcj1hd2FpdCBmZXRjaERheShiYXNlLGQpOwogICAgIGlmKHIuZmFpbGVkTil7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvIgke3IuZmFpbGVkTn1S5aSx5pWX77yJYCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICAgIGlmKG5lZWRSb3dzKXthd2FpdCBpZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTtoYXZlTGl2ZS5hZGQoZCl9CiAgICAgYXdhaXQgcGF5UHV0KGQse2RhdGU6ZCxyYWNlczpyLnBheW91dHMsZmFpbGVkOjB9KTtoYXZlUGF5LmFkZChkKTsKICAgICBzdC5kYXlzKys7c3QucmFjZXMrPXIucmFjZXM7Y29uc2VjPTA7CiAgICB9Y2F0Y2goZSl7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9fQogICAgYXdhaXQgc2xlZXAoNDAwKTsKICAgfQogICBpZihtb250aE9rJiZtb250aDxjdXJNb250aClhd2FpdCBtZXRhUHV0KCJtb250aDoiK21vbnRoLHRydWUpOwogIH0KIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goU3RyaW5nKGUubWVzc2FnZXx8ZSkpfQogZmluYWxseXsKICBTWU5DSU5HPWZhbHNlO1NUT1JFPW51bGw7U1RPUkVfS0VZPSIiOyQoInN5bmNHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICAkKCJzeW5jU3RhdHVzIikuaW5uZXJIVE1MPWAke3N0LnN0b3BwZWQ/IumAo+e2muOBl+OBpuWkseaVl+OBl+OBn+OBn+OCgeS4reaWreOBl+OBvuOBl+OBn++8iENsb3VkZmxhcmXlgbTjga7mt7fpm5Hjg7vliLbpmZDjga7lj6/og73mgKfvvInjgILlsJHjgZfmmYLplpPjgpLjgYrjgYTjgabjgoLjgYbkuIDluqbmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJcbiI6IiJ9JHtTU1RPUCYmIXN0LnN0b3BwZWQ/IuWBnOatouOBl+OBvuOBl+OBn+OAgiI6KHN0LnN0b3BwZWQ/IiI6IuWujOS6huOAgiIpfeS7iuWbnuOBruWPluW+l++8miR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yI5L+d5a2Y5riI44G/44Gn44K544Kt44OD44OXICR7c3Quc2tpcHBlZH3ml6XvvIlgKyhzdC5mYWlsLmxlbmd0aD9gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIifVxu77yI44KC44GG5LiA5bqm5oq844GZ44Go44CB5aSx5pWX44GX44Gf5pel44Gg44GR44KE44KK55u044GX44G+44GZ77yJPC9zcGFuPmA6IiIpOwogIGF3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKTsKIH0KfTsKCgovKiAtLS0g5omV5oi744Gu5pu444GN5Ye644GX44O76Kqt44G/6L6844G/IC0tLSAqLwokKCJwYXlFeHAiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpcmV0dXJuIGFsZXJ0KCLmiZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgIIiKTsKIGNvbnN0IGE9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiYSIpO2EuaHJlZj1VUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtKU09OLnN0cmluZ2lmeShwcyldLHt0eXBlOiJhcHBsaWNhdGlvbi9qc29uIn0pKTsKIGEuZG93bmxvYWQ9YGtlaWJhX3BheW91dHNfJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCl9Lmpzb25gO2EuY2xpY2soKTtzZXRUaW1lb3V0KCgpPT5VUkwucmV2b2tlT2JqZWN0VVJMKGEuaHJlZiksMTAwMCl9OwokKCJwYXlJbXAiKS5vbmNoYW5nZT1hc3luYyBlPT57CiBjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKCFmKXJldHVybjsKIHRyeXtjb25zdCBqPUpTT04ucGFyc2UoYXdhaXQgZi50ZXh0KCkpO2NvbnN0IGFycj1BcnJheS5pc0FycmF5KGopP2o6KGoucmFjZXM/W2pdOltdKTsKICBjb25zdCBieURhdGU9bmV3IE1hcCgpOwogIGZvcihjb25zdCB4IG9mIGFycil7aWYoeCYmQXJyYXkuaXNBcnJheSh4LnJhY2VzKSYmeC5kYXRlKWJ5RGF0ZS5zZXQoeC5kYXRlLHtkYXRlOnguZGF0ZSxyYWNlczp4LnJhY2VzLGZhaWxlZDp4LmZhaWxlZHx8MH0pfQogIGZvcihjb25zdFtkLHJdb2YgYnlEYXRlKWF3YWl0IHBheVB1dChkLHIpOwogIGF3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKTsKIH1jYXRjaChlcnIpeyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+6Kqt44G/6L6844G/44Ko44Op44O877yaJHtlc2MoZXJyLm1lc3NhZ2UpfTwvc3Bhbj5gfQogZS50YXJnZXQudmFsdWU9IiI7Cn07CgoKLyogLS0tIOKRoC0yIOikh+WLneWbnuWPjueOh+OBruaknOiovCAtLS0gKi8KJCgiYnRSdW4iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiOwogIGNvbnN0IHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3Qgc3BsaXQ9cGRhdGVzW01hdGguZmxvb3IocGRhdGVzLmxlbmd0aC8yKV07CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKICBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiAgYnVzeSh0cnVlLCLjg5Djg4Pjgq/jg4bjgrnjg4jkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0PVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkR9KTsKICBidXN5KHRydWUsIuOCquODg+OCuuacquWFpeWKm+OBruWgtOWQiOOCkuaknOiovOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvdXRQPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkQscHJveHk6dHJ1ZX0pO2J1c3koZmFsc2UpO3RyeXtzZXRHYXRlKG91dCxvdXRQKX1jYXRjaChlKXtjb25zb2xlLmVycm9yKGUpfQogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgre+8iOWfuua6lu+8iSIsdmFsdWU6IuWmmeWRszEuM+WAjeS7peS4iiIsYXhpczoi6YmE5p2/6Lu477yIMC45MuS7peS4iuODu+OCquODg+OCuuaZgu+8iSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX08L3NwYW4+YDoiLSI7CiAgY29uc3QgdGJsPShvLHRpdGxlKT0+ewogICBsZXQgdD1gPGI+JHt0aXRsZX08L2I+PGRpdiBjbGFzcz0ic21hbGwiPuWvvuixoSAke28ucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+6LK344GE5pa5PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjx0aD7lrabnv5Llvow8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IHY9by5zdGF0c1trXTtpZighdi5hbGwuYmV0cyljb250aW51ZTsKICAgIHQrPWA8dHI+PHRkPiR7TFtrXX08L3RkPjx0ZD48L3RkPjx0ZD4ke3YuYWxsLmJldHMudG9Mb2NhbGVTdHJpbmcoKX08L3RkPjx0ZD4keyh2LmFsbC5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+PGI+JHtjKHYuYWxsKX08L2I+PC90ZD48dGQ+JHt2LkEuYmV0cz9wY3Qodi5BLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5CLmJldHM/cGN0KHYuQi5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQy5iZXRzP2Ake3BjdCh2LkMucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsodi5DLnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3YuQy5iZXRzLnRvTG9jYWxlU3RyaW5nKCl977yJPC9zcGFuPmA6Ii0ifTwvdGQ+PC90cj5gfQogICByZXR1cm4gdCsiPC90Ym9keT48L3RhYmxlPiJ9OwogIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+JHtzdGFydH3jgJzvvI/liY3ljYrvvJ0ke3NwbGl0feOCiOOCiuWJjeOAgeW+jOWNiu+8neS7pemZje+8j+WQhDEwMOWGhjwvZGl2Pjxicj5gK3RibChvdXQsIuKRoCDjgqrjg4PjgrrlhaXlipvmmYLvvIjlrp/pmpvjga7kurrmsJfjgafnqbTjgr7jg7zjg7PjgpLliKTlrprvvIkiKSsiPGJyPiIrdGJsKG91dFAsIuKRoSDjgqrjg4PjgrrmnKrlhaXlipvmmYLvvIjjg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIkiKTsKICAvLyDmnaHku7bliKXvvIjjg4Tjg7zjg6sx5L2N44Gu5Zue5Y+O546H77yJCiAgY29uc3Qgc2VnUm93cz1PYmplY3QuZW50cmllcyhvdXQuc2VncykuZmlsdGVyKChbLHZdKT0+di5hbGwuYmV0cz49MzAwKS5zb3J0KChhLGIpPT5hWzBdPGJbMF0/LTE6MSk7CiAgaWYoc2VnUm93cy5sZW5ndGgpe2grPWA8YnI+PGI+4pGiIOODhOODvOODqzHkvY3jga7mnaHku7bliKXvvIjikaDjga7loLTlkIjvvIk8L2I+PGRpdiBjbGFzcz0ic21hbGwiPuizvOWFpTMwMOWbnuS7peS4iuOBruadoeS7tuOBruOBv+OAguWJjeWNiuODu+W+jOWNiuOBruS4oeaWueOBp+WQjOOBmOWQkeOBjeOBi+OCkuimi+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7mnaHku7Y8L3RoPjx0aD48L3RoPjx0aD7os7zlhaXmlbA8L3RoPjx0aD7nmoTkuK3njoc8L3RoPjx0aD7lm57lj47njocoOTUl5bmFKTwvdGg+PHRoPuWJjeWNijwvdGg+PHRoPuW+jOWNijwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgW2ssdl0gb2Ygc2VnUm93cyloKz1gPHRyPjx0ZD4ke2VzYyhrKX08L3RkPjx0ZD48L3RkPjx0ZD4ke3YuYWxsLmJldHMudG9Mb2NhbGVTdHJpbmcoKX08L3RkPjx0ZD4keyh2LmFsbC5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+PGI+JHtjKHYuYWxsKX08L2I+PC90ZD48dGQ+JHt2LkEuYmV0cz9wY3Qodi5BLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5CLmJldHM/cGN0KHYuQi5yb2kpOiItIn08L3RkPjwvdHI+YDsKICAgaCs9IjwvdGJvZHk+PC90YWJsZT4ifQogIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+PGJyPuimi+aWue+8muOAjOWtpue/kuW+jOOAjeOBr+OAgeODouODh+ODq+OBruWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iCR7TU9ERUxfVFJBSU5fRU5EfeS7pemZje+8ieOBp+OAgeacgOOCguS/oemgvOOBp+OBjeOCi+WIl+OBp+OBmeOAguOBneOCjOS7peWJjeOBruacn+mWk+OBr+OAgeODouODh+ODq+OBjOetlOOBiOOCkuimi+OBpuOBhOOCi+OBn+OCgeOAgeOChOOChOiJr+OBj+WHuuOBvuOBmeOAguWbnuWPjueOh+OBruOAjMKx44CN44GvOTUl44Gu6Kqk5beu44Gu5bmF44Gn44CBMTAwJeOCkuS4i+WbnuOCi+S4i+mZkOOBquOCieWIqeebiuOBqOOBr+iogOOBiOOBvuOBm+OCk+OAguadoeS7tuWIpeOBr+OAgeaOouOBmeOBu+OBqeWBtueEtuOBrumrmOOBhOadoeS7tuOCkuaLvuOBhOOChOOBmeOBhOOBruOBp+OAgeWJjeWNiuODu+W+jOWNiuOBruS4oeaWueOBp+WQjOOBmOWQkeOBjeOBruOCguOBruOBoOOBkeOCkuWPguiAg+OBq+OBl+OBpuOBj+OBoOOBleOBhOOAguWmmeWRs++8iOW4guWgtOOBqOOBruW3ru+8ieOBr+OAgeaknOiovOOBp+Wfuua6luOCiOOCiuaCquOBi+OBo+OBn+OBn+OCgeOAgeWIpOaWreOBq+OBr+S9v+OCj+OBquOBhOOBp+OBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aDsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn07CgovKiAtLS0g4pGgLTMg44Kw44Os44O844OJ6KOc5q2j44Gu5Yq55p6c5q+U6LyD77yI6YeN6LOe44Gu44G/44O75ZCM44GY6YGO5Y6744OH44O844K/44Gn6KOc5q2j44GC44KKL+OBquOBl++8iSAtLS0gKi8KJCgiYnRHcmFkZSIpLm9uY2xpY2s9YXN5bmMoKT0+ewogdHJ5ewogIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CC5YWI44Gr4pGg44Gn5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHBheUJ5SWQ9e307cHMuZm9yRWFjaChwPT4ocC5yYWNlc3x8W10pLmZvckVhY2goeD0+e3BheUJ5SWRbeC5yYWNlSWRdPXh9KSk7CiAgY29uc3Qgc3RhcnQ9JCgiYnRTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSIscGRhdGVzPXBzLm1hcChwPT5wLmRhdGUpLmZpbHRlcihkPT5kPj1zdGFydCkuc29ydCgpOwogIGlmKCFwZGF0ZXMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumWi+Wni+aXpeS7pemZjeOBruaJleaIu+OBjOOBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj4nO3JldHVybn0KICBidXN5KHRydWUsIuaIkOe4vuOCkuiqreOBv+i+vOOBv+S4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBtYXA9bmV3IE1hcCgpO2xldCBncmFkZWQ9MDsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKICBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiAgcmFjZXMuZm9yRWFjaCh4PT57aWYoKHgucm93c1swXS5ncmR8fDApPj0yKWdyYWRlZCsrfSk7CiAgaWYoIWdyYWRlZCl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7pgY7ljrvjg4fjg7zjgr/jga7kuK3jgavjgIFHMeOAnEcz44Go5Yik5Yil44Gn44GN44KL44Os44O844K544GM44GC44KK44G+44Gb44KT77yI44Kv44Op44K56KGo6KiY44O7MeedgOiznumHkeOBjOeEoeOBhO+8ieOAguOCsOODrOODvOODieijnOato+OBruWKueaenOOBr+aknOiovOOBp+OBjeOBvuOBm+OCk+OAguKRpOOBruWun+ihjOaZguOBr+ODrOODvOOCueWQjeODu+WHuummrOihqOOBruOCsOODrOODvOODieihqOiomOOBp+ijnOato+OBleOCjOOBvuOBmeOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBiYXNlPXtzdGFydCxzcGxpdDoiIixvb3M6TU9ERUxfVFJBSU5fRU5ELG1pbkdyZDoyfTsKICBidXN5KHRydWUsIuijnOato+OBguOCii/jgarjgZfjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb249VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCxiYXNlKSxvZmY9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7Li4uYmFzZSxncmFkZU9mZjp0cnVlfSk7YnVzeShmYWxzZSk7CiAgY29uc3QgTD17dG9wMToi44OE44O844OrMeS9jSIsdG9wMjoi5LiK5L2NMumgrSIsdG9wMzoi5LiK5L2NM+mgrSIsYWxsSG9sZToi56m044K+44O844Oz5YWo6aCtIixmb2N1czoi4peO55qE5Lit546H6YeN6KaW44GuMeS9jSJ9OwogIGNvbnN0IHBjdD14PT4oeCoxMDApLnRvRml4ZWQoMCkrIiUiLGM9eD0+eCYmeC5iZXRzP2Ake3BjdCh4LnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHguc2UqMTk2KS50b0ZpeGVkKDApfe+8iCR7eC5iZXRzfe+8iTwvc3Bhbj5gOiItIjsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPuWvvuixoe+8mumHjeiznu+8iEcx44CcRzPvvIkke29uLnJhY2VzfeODrOODvOOCueOAguWQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+OAgeijnOato+OBguOCii/jgarjgZfjga7nmoTkuK3njofjg7vlm57lj47njocoOTUl5bmFKeOCkuavlOi8g+OBl+OBpuOBhOOBvuOBmeOAguS7tuaVsOOBjOWwkeOBquOBhOOBqOW3ruOBr+WBtueEtuOBruevhOWbsuOBp+OBme+8iOWbnuWPjueOh+OBrsKx5bmF44GM6YeN44Gq44KL44Gq44KJ5beu44Gv5Yik5pat44Gn44GN44G+44Gb44KT77yJ44CCPC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPueahOS4reeOhyDjgYLjgoo8L3RoPjx0aD7nmoTkuK3njocg44Gq44GXPC90aD48dGg+5Zue5Y+O546HIOOBguOCijwvdGg+PHRoPuWbnuWPjueOhyDjgarjgZc8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhMKSl7Y29uc3QgYT1vbi5zdGF0c1trXS5hbGwsYj1vZmYuc3RhdHNba10uYWxsO2lmKCFhfHwhYS5iZXRzKWNvbnRpbnVlOwogICBoKz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHsoYS5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+JHtiJiZiLmJldHM/KGIuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSkrIiUiOiItIn08L3RkPjx0ZD48Yj4ke2MoYSl9PC9iPjwvdGQ+PHRkPiR7YyhiKX08L3RkPjwvdHI+YH0KICAkKCJidE91dCIpLmlubmVySFRNTD1oKyI8L3Rib2R5PjwvdGFibGU+IjsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn07CgoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOiHquWLleODkOODg+OCr+OCouODg+ODl++8iENsb3VkZmxhcmUgS1bvvIkKICog44O744OH44O844K/44GM5aSJ44KP44Gj44Gf44Kw44Or44O844OX77yIY3N2LeW5tO+8j2xpdmUt5bm05pyI77yPcGF5LeW5tOaciO+8j21ldGHvvInjgaDjgZHjgpLjgIFnemlw44GX44Gm6YCB44KLCiAqIOODu+S/neWtmOWFiOOBruitmOWIpeOBr+OAgeODkeOCueODleODrOODvOOCuuOBrlNIQS0yNTbvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgZ3jga7jgoLjga7jga/pgIHjgonjgarjgYTvvIkKICog44O75b6p5YWD44Gv44CB5ZCM44GY44OR44K544OV44Os44O844K644Gn44CC5ZCM44GY44Kt44O844Gu44OH44O844K/44Gv5LiK5pu444GN44GV44KM44KLCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgQks9e3Bhc3M6IiIsYXV0bzp0cnVlLGRpcnR5Om5ldyBTZXQoKSxidXN5OmZhbHNlLGlkOiIiLHNhdmVUOm51bGwscnVuVDpudWxsLGluZm86bnVsbCxtc2c6IiIsZXJyOmZhbHNlfTsKY29uc3QgcmF3TWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgcmF3UHV0TWFueT1yZWNzPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgc3Q9Wy4uLm5ldyBTZXQocmVjcy5tYXAocj0+ci5zKSldO2lmKCFzdC5sZW5ndGgpcmV0dXJuIG9rKCk7Y29uc3QgdD1EQi50cmFuc2FjdGlvbihzdCwicmVhZHdyaXRlIik7Zm9yKGNvbnN0IHIgb2YgcmVjcyl0Lm9iamVjdFN0b3JlKHIucykucHV0KHIudixyLmspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYlJhbmdlPShzdG9yZSxyYW5nZSk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBvdXQ9W107Y29uc3QgcT1EQi50cmFuc2FjdGlvbihzdG9yZSkub2JqZWN0U3RvcmUoc3RvcmUpLm9wZW5DdXJzb3IocmFuZ2UpO3Eub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtvdXQucHVzaCh7czpzdG9yZSxrOmMua2V5LHY6Yy52YWx1ZX0pO2MuY29udGludWUoKX1lbHNlIG9rKG91dCl9O3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgaWRiS2V5cz1zdG9yZT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5nZXRBbGxLZXlzKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpmdW5jdGlvbiBncm91cE9mKHN0b3JlLGtleSl7CiBrZXk9U3RyaW5nKGtleSk7CiBpZihzdG9yZT09PSJmaWxlcyIpe2lmKGtleS5zdGFydHNXaXRoKCJsaXZlOiIpKXJldHVybiAibGl2ZS0iK2tleS5zbGljZSg1LDEyKTtjb25zdCB5PWtleS5zcGxpdCgiOiIpWzBdO3JldHVybiAvXigwfDIwXGRcZCkkLy50ZXN0KHkpPyJjc3YtIit5OiJjc3YtMCJ9CiBpZihzdG9yZT09PSJwYXkiKXJldHVybiAicGF5LSIra2V5LnNsaWNlKDAsNyk7CiByZXR1cm4gIm1ldGEiOwp9CmZ1bmN0aW9uIG1hcmtEaXJ0eShzdG9yZSxrZXkpewogaWYoc3RvcmU9PT0ibWV0YSImJihrZXk9PT0iZGlydHkifHxrZXk9PT0iYmFja3VwIikpcmV0dXJuOwogQksuZGlydHkuYWRkKGdyb3VwT2Yoc3RvcmUsa2V5KSk7CiBjbGVhclRpbWVvdXQoQksuc2F2ZVQpO0JLLnNhdmVUPXNldFRpbWVvdXQoKCk9PntyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTtia1JlbmRlcigpfSw4MDApOwp9CmFzeW5jIGZ1bmN0aW9uIHJlYWRHcm91cChuYW1lKXsKIGxldCBtOwogaWYobmFtZT09PSJtZXRhIilyZXR1cm4oYXdhaXQgaWRiUmFuZ2UoIm1ldGEiKSkuZmlsdGVyKHI9PnIuayE9PSJkaXJ0eSImJnIuayE9PSJiYWNrdXAiKTsKIGlmKG09bmFtZS5tYXRjaCgvXmNzdi0oXGQrKSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfTpgLGAke21bMV19O2ApKTsKIGlmKG09bmFtZS5tYXRjaCgvXmxpdmUtKFxkezR9LVxkezJ9KSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgbGl2ZToke21bMV19LTAwYCxgbGl2ZToke21bMV19LTk5YCkpOwogaWYobT1uYW1lLm1hdGNoKC9ecGF5LShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJwYXkiLElEQktleVJhbmdlLmJvdW5kKGAke21bMV19LTAwYCxgJHttWzFdfS05OWApKTsKIHJldHVybltdOwp9CmFzeW5jIGZ1bmN0aW9uIGFsbEdyb3VwcygpewogY29uc3QgZz1uZXcgU2V0KCk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJmaWxlcyIpKWcuYWRkKGdyb3VwT2YoImZpbGVzIixrKSk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJwYXkiKSlnLmFkZChncm91cE9mKCJwYXkiLGspKTsKIGlmKChhd2FpdCBpZGJLZXlzKCJtZXRhIikpLnNvbWUoaz0+ayE9PSJkaXJ0eSImJmshPT0iYmFja3VwIikpZy5hZGQoIm1ldGEiKTsKIHJldHVyblsuLi5nXTsKfQphc3luYyBmdW5jdGlvbiBneihzdHIpewogY29uc3QgcmF3PW5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzdHIpOwogaWYodHlwZW9mIENvbXByZXNzaW9uU3RyZWFtPT09InVuZGVmaW5lZCIpcmV0dXJue2J1ZjpyYXcsZW5jOiJyYXcifTsKIGNvbnN0IGNzPW5ldyBDb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9Y3Mud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShyYXcpO3cuY2xvc2UoKTsKIHJldHVybntidWY6bmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKGNzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKSxlbmM6Imd6aXAifTsKfQphc3luYyBmdW5jdGlvbiBndW56aXAoYnVmLGVuYyl7CiBpZihlbmM9PT0icmF3IilyZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ1Zik7CiBjb25zdCBkcz1uZXcgRGVjb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9ZHMud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShidWYpO3cuY2xvc2UoKTsKIHJldHVybiBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYXdhaXQgbmV3IFJlc3BvbnNlKGRzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKTsKfQphc3luYyBmdW5jdGlvbiBia01ha2VJZCgpewogaWYoISh3aW5kb3cuY3J5cHRvJiZjcnlwdG8uc3VidGxlKSl0aHJvdyBuZXcgRXJyb3IoIuOBk+OBrueSsOWig+OBp+OBr+S9v+OBiOOBvuOBm+OCk++8iGh0dHBzIOOBp+mWi+OBj+W/heimgeOBjOOBguOCiuOBvuOBme+8iSIpOwogY29uc3QgZD1hd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgiU0hBLTI1NiIsbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKCJrZWliYS11cHNldC1iYWNrdXA6djE6IitCSy5wYXNzKSk7CiByZXR1cm5bLi4ubmV3IFVpbnQ4QXJyYXkoZCldLm1hcChiPT5iLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCIwIikpLmpvaW4oIiIpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrRmV0Y2gocGF0aCxvcHQpewogaWYoIUJLLmlkKUJLLmlkPWF3YWl0IGJrTWFrZUlkKCk7CiByZXR1cm4gZmV0Y2goJCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpK3BhdGgsT2JqZWN0LmFzc2lnbih7fSxvcHQse2hlYWRlcnM6T2JqZWN0LmFzc2lnbih7IngtYmFja3VwLWlkIjpCSy5pZH0sKG9wdCYmb3B0LmhlYWRlcnMpfHx7fSl9KSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtKU09OKHBhdGgsb3B0KXsKIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChwYXRoLG9wdCksdD1hd2FpdCByLnRleHQoKTtsZXQgaj17fTt0cnl7aj1KU09OLnBhcnNlKHQpfWNhdGNoKGUpe30KIGlmKCFyLm9rfHxqLm9rPT09ZmFsc2UpdGhyb3cgbmV3IEVycm9yKGouZXJyb3J8fCgiSFRUUCAiK3Iuc3RhdHVzKSk7cmV0dXJuIGo7Cn0KZnVuY3Rpb24gYmtNc2codCxpc0Vycil7QksubXNnPXR8fCIiO0JLLmVycj0hIWlzRXJyO2JrUmVuZGVyKCl9CmZ1bmN0aW9uIGJrUmVuZGVyKCl7CiBjb25zdCBlbD0kKCJia1N0YXR1cyIpO2lmKCFlbClyZXR1cm47CiBjb25zdCBtPUJLLmluZm8sanN0PW1zPT5uZXcgRGF0ZShtcys5KjM2MDBlMykudG9JU09TdHJpbmcoKS5yZXBsYWNlKCJUIiwiICIpLnNsaWNlKDAsMTYpOwogbGV0IHN1bT0iIjsKIGlmKCFCSy5wYXNzKXN1bT0i44OR44K544OV44Os44O844K644KS6Kit5a6a44GZ44KL44Go44CB6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX44GM5pyJ5Yq544Gr44Gq44KK44G+44GZ44CCIjsKIGVsc2UgaWYobSYmbS5leGlzdHMpe2NvbnN0IGNzPU9iamVjdC52YWx1ZXMobS5jaHVua3N8fHt9KTtzdW09YOacgOe1guODkOODg+OCr+OCouODg+ODl++8miR7anN0KG0udXBkYXRlZEF0KX3vvIgke2NzLmxlbmd0aH3jgrDjg6vjg7zjg5fvvI8keyhjcy5yZWR1Y2UoKHMsYyk9PnMrYy5zaXplLDApLzEwNDg1NzYpLnRvRml4ZWQoMSl9TULvvIlgfQogZWxzZSBzdW09IuODkOODg+OCr+OCouODg+ODl+OBr+OBvuOBoOOBguOCiuOBvuOBm+OCk+OAgiI7CiBpZihCSy5wYXNzKXN1bSs9YO+8j+acqumAgeS/oeOBruWkieabtO+8miR7QksuZGlydHkuc2l6ZX3jgrDjg6vjg7zjg5cke0JLLmF1dG8/Iu+8iOiHquWLleOBp+mAgeOCiuOBvuOBme+8iSI6Iu+8iOiHquWLleODkOODg+OCr+OCouODg+ODl+OBr+OCquODle+8iSJ9YDsKIGVsLmlubmVySFRNTD0oQksubXNnP2A8c3BhbiBjbGFzcz0iJHtCSy5lcnI/Indhcm4iOiJnb29kIn0iPiR7ZXNjKEJLLm1zZyl9PC9zcGFuPlxuYDoiIikrZXNjKHN1bSk7Cn0KZnVuY3Rpb24gYmtOZWVkUGFzcygpe2lmKCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXtia01zZygi44OR44K544OV44Os44O844K644KSOOaWh+Wtl+S7peS4iuOBp+WFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAgiIsdHJ1ZSk7cmV0dXJuIHRydWV9cmV0dXJuIGZhbHNlfQphc3luYyBmdW5jdGlvbiBia1JlZnJlc2gobWFuKXsKIHRyeXtCSy5pbmZvPW1hbnx8YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iil9Y2F0Y2goZSl7QksuaW5mbz1udWxsO2lmKCFCSy5tc2cpYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeOBp+OBjeOBvuOBm+OCk++8miIrZS5tZXNzYWdlLHRydWUpfQogYmtSZW5kZXIoKTsKfQphc3luYyBmdW5jdGlvbiBydW5CYWNrdXAoZnVsbCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlO2NvbnN0IGluZmxpZ2h0PW5ldyBTZXQoQksuZGlydHkpO0JLLmRpcnR5LmNsZWFyKCk7CiB0cnl7CiAgYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IG1hbj1hd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiKSxoYXZlPW1hbi5leGlzdHM/KG1hbi5jaHVua3N8fHt9KTp7fTsKICBjb25zdCBuYW1lcz0oZnVsbHx8IW1hbi5leGlzdHMpP2F3YWl0IGFsbEdyb3VwcygpOlsuLi5pbmZsaWdodF07CiAgaWYoIW5hbWVzLmxlbmd0aCl7YmtNc2coIuWkieabtOOBr+OBguOCiuOBvuOBm+OCk+OAgiIpO2F3YWl0IGJrUmVmcmVzaChtYW4pO3JldHVybn0KICBjb25zdCBjaHVua3M9T2JqZWN0LmFzc2lnbih7fSxoYXZlKTtsZXQgc2VudD0wLGJ5dGVzPTA7CiAgZm9yKGxldCBpPTA7aTxuYW1lcy5sZW5ndGg7aSsrKXsKICAgY29uc3QgbmFtZT1uYW1lc1tpXTtia01zZyhg44OQ44OD44Kv44Ki44OD44OX5Lit4oCmICR7aSsxfS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHJlY3M9YXdhaXQgcmVhZEdyb3VwKG5hbWUpOwogICBpZighcmVjcy5sZW5ndGgpe2lmKGNodW5rc1tuYW1lXSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3NbbmFtZV19Y29udGludWV9CiAgIGNvbnN0IHJhdz1KU09OLnN0cmluZ2lmeSh7ZzpuYW1lLHJlY3N9KSx7YnVmLGVuY309YXdhaXQgZ3oocmF3KTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCx7bWV0aG9kOiJQVVQiLGJvZHk6YnVmfSk7CiAgIGlmKCFyLm9rKXtsZXQgZT0iIjt0cnl7ZT0oYXdhaXQgci5qc29uKCkpLmVycm9yfWNhdGNoKF8pe310aHJvdyBuZXcgRXJyb3IoZXx8KCJIVFRQICIrci5zdGF0dXMpKX0KICAgY2h1bmtzW25hbWVdPXtzaXplOmJ1Zi5ieXRlTGVuZ3RoLHJhd1NpemU6cmF3Lmxlbmd0aCxuOnJlY3MubGVuZ3RoLGVuYyxhdDpEYXRlLm5vdygpfTtzZW50Kys7Ynl0ZXMrPWJ1Zi5ieXRlTGVuZ3RoOwogIH0KICBpZihmdWxsfHwhbWFuLmV4aXN0cyl7Zm9yKGNvbnN0IG4gb2YgT2JqZWN0LmtleXMoaGF2ZSkpaWYoIW5hbWVzLmluY2x1ZGVzKG4pKXthd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobil9YCx7bWV0aG9kOiJERUxFVEUifSk7ZGVsZXRlIGNodW5rc1tuXX19CiAgY29uc3QgbWFuaWZlc3Q9e3Y6MSx1cGRhdGVkQXQ6RGF0ZS5ub3coKSxjaHVua3N9OwogIGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIse21ldGhvZDoiUFVUIixib2R5OkpTT04uc3RyaW5naWZ5KG1hbmlmZXN0KSxoZWFkZXJzOnsiY29udGVudC10eXBlIjoiYXBwbGljYXRpb24vanNvbiJ9fSk7CiAgbWFuaWZlc3QuZXhpc3RzPXRydWU7YXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbmlmZXN0LnVwZGF0ZWRBdH0pOwogIEJLLmluZm89bWFuaWZlc3Q7YmtNc2coYOODkOODg+OCr+OCouODg+ODl+WujOS6hu+8miR7c2VudH3jgrDjg6vjg7zjg5fjgpLpgIHkv6HvvIgkeyhieXRlcy8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYCk7CiB9Y2F0Y2goZSl7CiAgZm9yKGNvbnN0IG4gb2YgaW5mbGlnaHQpQksuZGlydHkuYWRkKG4pO3Jhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKS5jYXRjaCgoKT0+e30pOwogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgavlpLHmlZfjgZfjgb7jgZfjgZ/vvJoiK2UubWVzc2FnZSx0cnVlKTsKIH1maW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQphc3luYyBmdW5jdGlvbiBydW5SZXN0b3JlKCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iik7CiAgaWYoIW1hbi5leGlzdHMpe2JrTXNnKCLjgZPjga7jg5Hjgrnjg5Xjg6zjg7zjgrrjga7jg5Djg4Pjgq/jgqLjg4Pjg5fjga/opovjgaTjgYvjgorjgb7jgZvjgpPvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgpLnorroqo3jgZfjgabjgY/jgaDjgZXjgYTvvInjgIIiLHRydWUpO3JldHVybn0KICBjb25zdCBuYW1lcz1PYmplY3Qua2V5cyhtYW4uY2h1bmtzfHx7fSk7bGV0IG49MCxjbnQ9MDsKICBmb3IoY29uc3QgbmFtZSBvZiBuYW1lcyl7CiAgIGJrTXNnKGDlvqnlhYPkuK3igKYgJHsrK259LyR7bmFtZXMubGVuZ3Rofe+8iCR7bmFtZX3vvIlgKTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCk7CiAgIGlmKCFyLm9rKXRocm93IG5ldyBFcnJvcihgJHtuYW1lfSDjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPvvIhIVFRQICR7ci5zdGF0dXN977yJYCk7CiAgIGNvbnN0IG89SlNPTi5wYXJzZShhd2FpdCBndW56aXAobmV3IFVpbnQ4QXJyYXkoYXdhaXQgci5hcnJheUJ1ZmZlcigpKSxtYW4uY2h1bmtzW25hbWVdLmVuY3x8Imd6aXAiKSk7CiAgIGF3YWl0IHJhd1B1dE1hbnkoby5yZWNzKTtjbnQrPW8ucmVjcy5sZW5ndGg7CiAgfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiO0JBQ0tVUF9EQVRFUz1udWxsO0JLLmRpcnR5LmNsZWFyKCk7CiAgYXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFtdKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW4udXBkYXRlZEF0fSk7CiAgYXdhaXQgc2hvd1N0YXRlKCk7QksuaW5mbz1tYW47YmtNc2coYOW+qeWFg+WujOS6hu+8miR7bmFtZXMubGVuZ3RofeOCsOODq+ODvOODl++8jyR7Y250LnRvTG9jYWxlU3RyaW5nKCl95Lu2YCk7CiB9Y2F0Y2goZSl7YmtNc2coIuW+qeWFg+OBq+WkseaVl+OBl+OBvuOBl+OBn++8miIrZS5tZXNzYWdlLHRydWUpfQogZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KZnVuY3Rpb24gYmtTY2hlZHVsZShtcyl7CiBpZighQksuYXV0b3x8IUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpcmV0dXJuOwogY2xlYXJUaW1lb3V0KEJLLnJ1blQpO0JLLnJ1blQ9c2V0VGltZW91dCgoKT0+e2lmKCFTWU5DSU5HKXJ1bkJhY2t1cChmYWxzZSk7ZWxzZSBia1NjaGVkdWxlKDMwMDAwKX0sbXN8fDMwMDApOwp9CmZ1bmN0aW9uIGJrU2F2ZVNldHRpbmdzKCl7dHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKCJ1cHNldF9iayIsSlNPTi5zdHJpbmdpZnkoe3Bhc3M6QksucGFzcyxhdXRvOkJLLmF1dG99KSl9Y2F0Y2goZSl7fX0KYXN5bmMgZnVuY3Rpb24gYmtJbml0KCl7CiB0cnl7Y29uc3Qgbz1KU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKCJ1cHNldF9iayIpfHwie30iKTtCSy5wYXNzPW8ucGFzc3x8IiI7QksuYXV0bz1vLmF1dG8hPT1mYWxzZX1jYXRjaChlKXt9CiAkKCJia1Bhc3MiKS52YWx1ZT1CSy5wYXNzOyQoImJrQXV0byIpLmNoZWNrZWQ9QksuYXV0bzsKICQoImJrUGFzcyIpLm9uY2hhbmdlPSgpPT57QksucGFzcz0kKCJia1Bhc3MiKS52YWx1ZS50cmltKCk7QksuaWQ9IiI7QksuaW5mbz1udWxsO0JLLm1zZz0iIjtia1NhdmVTZXR0aW5ncygpO2lmKEJLLnBhc3MubGVuZ3RoPj04KWJrUmVmcmVzaCgpO2Vsc2UgYmtSZW5kZXIoKX07CiAkKCJia1Nob3ciKS5vbmNsaWNrPSgpPT57Y29uc3QgcD0kKCJia1Bhc3MiKTtwLnR5cGU9cC50eXBlPT09InBhc3N3b3JkIj8idGV4dCI6InBhc3N3b3JkIjskKCJia1Nob3ciKS50ZXh0Q29udGVudD1wLnR5cGU9PT0icGFzc3dvcmQiPyLooajnpLoiOiLpmqDjgZkifTsKICQoImJrQXV0byIpLm9uY2hhbmdlPSgpPT57QksuYXV0bz0kKCJia0F1dG8iKS5jaGVja2VkO2JrU2F2ZVNldHRpbmdzKCk7YmtSZW5kZXIoKTtpZihCSy5hdXRvKWJrU2NoZWR1bGUoMjAwMCl9OwogJCgiYmtOb3ciKS5vbmNsaWNrPSgpPT5ydW5CYWNrdXAoZmFsc2UpOwogJCgiYmtGdWxsIikub25jbGljaz0oKT0+e2lmKGNvbmZpcm0oIuOBmeOBueOBpuOBruODh+ODvOOCv+OCkuOAgeOBguOCieOBn+OCgeOBpuS/neWtmOOBl+ebtOOBl+OBvuOBmeOAguOCiOOCjeOBl+OBhOOBp+OBmeOBi++8nyIpKXJ1bkJhY2t1cCh0cnVlKX07CiAkKCJia1Jlc3RvcmUiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GT44Gu56uv5pyr44Gu44OH44O844K/44KS44CB44OQ44OD44Kv44Ki44OD44OX44Gu5YaF5a6544Gn5LiK5pu444GN44GX44G+44GZ77yI44OQ44OD44Kv44Ki44OD44OX44Gr44GC44KL44OH44O844K/44Gg44GR44GM5a++6LGh44Gn44GZ77yJ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuUmVzdG9yZSgpfTsKIHRyeXtjb25zdCBkPWF3YWl0IG1ldGFHZXQoImRpcnR5Iik7aWYoQXJyYXkuaXNBcnJheShkKSlkLmZvckVhY2goeD0+QksuZGlydHkuYWRkKHgpKX1jYXRjaChlKXt9CiB0cnl7aWYobmF2aWdhdG9yLnN0b3JhZ2UmJm5hdmlnYXRvci5zdG9yYWdlLnBlcnNpc3QpbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCgpLmNhdGNoKCgpPT57fSl9Y2F0Y2goZSl7fQogYmtSZW5kZXIoKTsKIGlmKEJLLnBhc3MubGVuZ3RoPj04KXthd2FpdCBia1JlZnJlc2goKTtpZihCSy5kaXJ0eS5zaXplKWJrU2NoZWR1bGUoNTAwMCl9CiBzZXRJbnRlcnZhbCgoKT0+e2lmKEJLLmF1dG8mJkJLLnBhc3MubGVuZ3RoPj04JiZCSy5kaXJ0eS5zaXplJiYhQksuYnVzeSYmIVNZTkNJTkcpcnVuQmFja3VwKGZhbHNlKX0sd2luZG93Ll9fQktfVElDS3x8OTAwMDAwKTsKfQoKCgovKiAtLS0tLS0tLS0tIOS/neWtmOODh+ODvOOCv+OBrueKtuazgSAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIHNob3dTdGF0ZSgpewogdHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpLHBzPWF3YWl0IHBheUFsbCgpOwogIGNvbnN0IGJhc2U9ZnMuZmlsdGVyKGY9PiFmLmxpdmUpLGxpdmU9ZnMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCk7CiAgaWYoIWZzLmxlbmd0aCYmIXBzLmxlbmd0aCl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumBjuWOu+ODh+ODvOOCv+OBr+acquWPluW+l+OBp+OBmeOAguOAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZnjgYvjgIHoqK3lrprjgYvjgonjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLlvqnlhYPjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgbGQ9bGl2ZS5tYXAoZj0+Zi5kYXRlKS5zb3J0KCksblJhY2VzPWxpdmUucmVkdWNlKChzLGYpPT5zK25ldyBTZXQoZi5yb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemUsMCk7CiAgbGV0IG5BbGw9MCxuVHI9MDtmb3IoY29uc3QgZiBvZiBsaXZlKWZvcihjb25zdCByIG9mIGYucm93cyl7bkFsbCsrO2lmKHIudHJhaW5lciluVHIrK30KICBsZXQgaD0iIjsKICBpZihsaXZlLmxlbmd0aCloKz1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluW+l+a4iOOBv+OBruaIkOe4vu+8miR7bGl2ZS5sZW5ndGh95pel77yPJHtuUmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIgke2xkWzBdfeOAnCR7bGRbbGQubGVuZ3RoLTFdfe+8iTwvc3Bhbj5gOwogIGlmKGJhc2UubGVuZ3RoKXtjb25zdCB5cz1bLi4ubmV3IFNldChiYXNlLm1hcChmPT5mLnllYXIpKV0uc29ydCgpO2grPShoPyJcbiI6IiIpK2A8c3BhbiBjbGFzcz0iZ29vZCI+44OQ44OD44Kv44Ki44OD44OXQ1NW77yaJHtiYXNlLmxlbmd0aH3jg5XjgqHjgqTjg6vvvIgke3lzWzBdfHwiLSJ944CcJHt5c1t5cy5sZW5ndGgtMV18fCItIn3lubTvvIk8L3NwYW4+YH0KICBjb25zdCBwcj1wcy5yZWR1Y2UoKHMscCk9PnMrKHAucmFjZXN8fFtdKS5sZW5ndGgsMCk7CiAgaCs9KGg/IlxuIjoiIikrKHBzLmxlbmd0aD9gPHNwYW4gY2xhc3M9Imdvb2QiPuaJleaIu++8miR7cHMubGVuZ3RofeaXpe+8jyR7cHIudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L3NwYW4+YDonPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu++8muacquWPluW+lzwvc3Bhbj4nKTsKICBpZihuQWxsKWgrPWBcbuiqv+aVmeW4q+OBpOOBjeOBruaIkOe4vu+8miR7TWF0aC5yb3VuZChuVHIvbkFsbCoxMDApfSUke25Ucj09PTA/Iu+8iOOBk+OCjOOBi+OCieWPluW+l+OBmeOCi+aIkOe4vuOBq+WFpeOCiuOBvuOBme+8iSI6IiJ9YDsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPueiuuiqjeOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZSl9PC9zcGFuPmB9Cn0KCi8qIC0tLS0tLS0tLS0g5Y+W5b6X44GX44Gf6KGMIOKGkiDlhoXpg6jjga7ooYzvvIjoqr/mlZnluKvjg7vjgrDjg6zjg7zjg4nku5jjgY3vvIkgLS0tLS0tLS0tLSAqLwpmdW5jdGlvbiBsaXZlUm93KHgpe2NvbnN0IGY9cGFyc2VGbG9hdChTdHJpbmcoeC5maW5pc2g/PyIiKS5yZXBsYWNlKC9bXlxkLl0vZywiIikpOwogcmV0dXJue3JhY2VJZDpTdHJpbmcoeC5yYWNlSWR8fCIiKSxkYXRlOlVFLnBhcnNlRGF0ZSh4LmRhdGUpLG5hbWU6U3RyaW5nKHguaG9yc2V8fCIiKS50cmltKCksaG9yc2U6VUUubm4oeC5ob3JzZSksam9ja2V5OlVFLmpubih4LmpvY2tleSksCiAgZmluaXNoOk51bWJlci5pc0Zpbml0ZShmKSYmZj4wP2Y6bnVsbCxkaXN0Ok51bWJlcih4LmRpc3RhbmNlKXx8MCxzdXJmOlVFLnN1cmZDb2RlKHguc3VyZmFjZSksYWdlOk51bWJlcih4LmFnZSl8fG51bGwsbnVtOk51bWJlcih4Lm51bWJlcil8fG51bGwsCiAgcG9wOk51bWJlcih4LnBvcCk+MD9OdW1iZXIoeC5wb3ApOm51bGwsb2RkczpudWxsLGpuYW1lOlN0cmluZyh4LmpvY2tleXx8IiIpLnRyaW0oKSx0cmFpbmVyOlVFLmNsZWFuVHIoeC50cmFpbmVyKSwKICBsdmw6KHgudmVudWVDb2RlJiYhL14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKHgudmVudWVDb2RlKSkpPy0xOihVRS5sZXZlbE9mTGFiZWwoeC5jbHMpfHxVRS5sZXZlbE9mUHJpemUoeC5wcml6ZSkpLAogIGdyZDpVRS5ncmFkZVRpZXIoKHguY2xzfHwiIikrIiAiKyh4LmdyYWRlfHwiIikseC5wcml6ZSxmYWxzZSl9fQoKLyog5a++6LGh5pel44KI44KK5YmN44Gu5bGl5q2044Gg44GR44Gn44K544OI44Ki44KS5L2c44KL77yI6aiO5omL44O76Kq/5pWZ5bir44Gu5oiQ57i+44KC5ZCM5pmC44Gr6ZuG6KiI77yJICovCmFzeW5jIGZ1bmN0aW9uIGJ1aWxkU3RvcmUodGFyZ2V0KXsKIGlmKFNUT1JFJiZTVE9SRV9LRVk9PT10YXJnZXQpcmV0dXJuIFNUT1JFOwogY29uc3QgZnM9YXdhaXQgaWRiQWxsKCk7aWYoIWZzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIumBjuWOu+ODh+ODvOOCv+OBjOacqueZu+mMsuOBp+OBmeOAguWFiOOBq+OAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZnjgYvjgIHoqK3lrprjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLlvqnlhYPjgZfjgabjgY/jgaDjgZXjgYTjgIIiKTsKIGNvbnN0IHN0PW5ldyBVRS5TdG9yZSgpO3N0LnRyPW5ldyBNYXAoKTtsZXQgdXNlZD0wOwogY29uc3QgdGFrZT1yPT57aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXR8fCFyLmhvcnNlKXJldHVybjtzdC5hZGQocik7dXNlZCsrO2lmKHIuZGF0ZT4oc3QubGFzdERhdGV8fCIiKSlzdC5sYXN0RGF0ZT1yLmRhdGU7CiAgaWYoci50cmFpbmVyJiZyLmZpbmlzaCE9bnVsbCl7bGV0IHQ9c3QudHIuZ2V0KHIudHJhaW5lcik7aWYoIXQpc3QudHIuc2V0KHIudHJhaW5lcix0PXtuOjAsdDM6MH0pO3QubisrO2lmKHIuZmluaXNoPD0zKXQudDMrK319OwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXsKICBidXN5KHRydWUsYOmBjuWOu+ODh+ODvOOCv+OCkumbhuioiOS4reKApiAke2krMX0vJHtmcy5sZW5ndGh9XG7vvIgke3RhcmdldH3jgojjgorliY3jga7jgb/kvb/nlKjvvIlgKTsKICBpZihmc1tpXS5saXZlKXtmb3IoY29uc3QgeCBvZiBmc1tpXS5yb3dzfHxbXSl0YWtlKGxpdmVSb3coeCkpfQogIGVsc2UgZm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmc1tpXS5jc3YpKXRha2UoVUUudG9Sb3cobykpOwogIGF3YWl0IHNsZWVwKDApOwogfQogYnVzeShmYWxzZSk7U1RPUkU9c3Q7U1RPUkVfS0VZPXRhcmdldDtzdC5jb3VudD11c2VkO3JldHVybiBzdDsKfQoKLyog5Ye66aas6KGo44GuMeODrOODvOOCuSDihpIg6Kej5p6Q55So44Gu44Os44O844K5ICovCmZ1bmN0aW9uIG1rUmFjZShjLGQpewogY29uc3QgaHM9Yy5ob3JzZXN8fGMucnVubmVyc3x8W107CiBjb25zdCBndD0oYy5jbGFzc05hbWV8fCIiKSsiICIrKGMuZ3JhZGV8fCIiKSsiICIrKGMucmFjZU5hbWV8fCIiKTsKIGNvbnN0IGdyZD1VRS5ncmFkZVRpZXIoZ3QsYy5wcml6ZSx0cnVlKTsKIHJldHVybntkYXRlOmQsc3VyZjpVRS5zdXJmQ29kZShjLnN1cmZhY2UpLGRpc3Q6TnVtYmVyKGMuZGlzdGFuY2UpfHwwLAogIGx2bDpVRS5sZXZlbE9mTGFiZWwoYy5jbGFzc05hbWUpfHxVRS5sZXZlbE9mTGFiZWwoYy5yYWNlTmFtZSl8fChncmQ+PTE/NTowKSxncmQsCiAgcnVubmVyczpocy5tYXAoKGgsaSk9Pntjb25zdCBuYW1lPWguaG9yc2VOYW1lfHxoLmhvcnNlfHxoLm5hbWV8fCIiOwogICByZXR1cm57bmFtZSxob3JzZTpVRS5ubihuYW1lKSxqb2NrZXk6VUUuam5uKGguam9ja2V5fHwiIiksam5hbWU6U3RyaW5nKGguam9ja2V5fHwiIikudHJpbSgpLHRyYWluZXI6VUUuY2xlYW5UcihoLnRyYWluZXJ8fCIiKSxhZ2U6aC5hZ2V8fG51bGwsbnVtOmguaG9yc2VOdW1iZXJ8fGgubnVtYmVyfHxpKzF9fSkKICAgLnNvcnQoKHgseSk9Pih4Lm51bXx8MCktKHkubnVtfHwwKSl9Owp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5LuK6YCx5pyr44Gu5Y+W5b6XCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgV0s9e2RhdGVzOltdLGNhcmRzOnt9LG9kZHM6e30sb2Rkc05vdGVzOnt9LGRpYWc6W10sY2FsYzp7fSxhdDoiIixzdG9yZUluZm86bnVsbH07CmNvbnN0IHJrZXk9KGQsYyk9PmAke2R9fCR7U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpfS0ke051bWJlcihjLnJhY2VOdW1iZXIpfHwwfWA7CmNvbnN0IHdrTXNnPXQ9PnskKCJ3a1N0YXR1cyIpLnRleHRDb250ZW50PXR9Owpjb25zdCBiYXNlVXJsPSgpPT4kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CmZ1bmN0aW9uIG5leHRXZWVrZW5kKHRvZGF5KXtjb25zdCBvdXQ9W107Y29uc3QgdD1uZXcgRGF0ZSh0b2RheSsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKTsKIGZvcihsZXQgaT0wO2k8OCYmb3V0Lmxlbmd0aDwyO2krKyl7Y29uc3QgZD1uZXcgRGF0ZSh0K2kqODY0ZTUpLHc9ZC5nZXRVVENEYXkoKTtpZih3PT09Nnx8dz09PTApb3V0LnB1c2goZC50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApKX1yZXR1cm4gb3V0fQoKYXN5bmMgZnVuY3Rpb24gZmV0Y2hDYXJkcyhiYXNlLGQsdmVudWVDb2RlKXsKIGNvbnN0IHE9dmVudWVDb2RlP2AmdmVudWU9JHtlbmNvZGVVUklDb21wb25lbnQodmVudWVDb2RlKX1gOiIiO2xldCBlcnI9IiI7CiBmb3IobGV0IHQ9MDt0PDM7dCsrKXsKICB0cnl7Y29uc3Qgcj1hd2FpdCBmZXRjaChgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHtlbmNvZGVVUklDb21wb25lbnQoZCl9JHtxfWApOwogICBpZighci5vayl7bGV0IG09IiI7dHJ5e209KGF3YWl0IHIuanNvbigpKS5lcnJvcnx8IiJ9Y2F0Y2h7fXRocm93IG5ldyBFcnJvcihgSFRUUCAke3Iuc3RhdHVzfSAke219YC50cmltKCkpfQogICBjb25zdCB4PWF3YWl0IHIuanNvbigpO3JldHVybntyYWNlczpBcnJheS5pc0FycmF5KHgpP3g6KHgucmFjZXN8fFtdKX19CiAgY2F0Y2goZSl7ZXJyPWUubWVzc2FnZTthd2FpdCBzbGVlcCgxMjAwKih0KzEpKX0KIH0KIHRocm93IG5ldyBFcnJvcihlcnJ8fCLlj5blvpfjgafjgY3jgb7jgZvjgpMiKTsKfQoKLyogMemWi+WCrOWgtOOBtuOCk+OBruWHuummrOihqOOAguasoOOBkeODu+WkseaVl+OBjOOBguOCjOOBsOOAgeiHquWLleOBpzHlm57jgaDjgZHjgoTjgornm7TjgZkgKi8KYXN5bmMgZnVuY3Rpb24gbG9hZFZlbnVlSW50byhiYXNlLGQsdixpc1JldHJ5KXsKIGNvbnN0IGNvZGU9U3RyaW5nKHYudmVudWVDb2RlKTsKIFdLLmNhcmRzW2RdPShXSy5jYXJkc1tkXXx8W10pLmZpbHRlcihjPT5TdHJpbmcoYy52ZW51ZUNvZGUpIT09Y29kZSk7CiBXSy5kaWFnPVdLLmRpYWcuZmlsdGVyKHg9PiEoeC5kPT09ZCYmeC5jb2RlPT09Y29kZSkpOwogdHJ5ewogIGNvbnN0IHtyYWNlc309YXdhaXQgZmV0Y2hDYXJkcyhiYXNlLGQsY29kZSk7CiAgY29uc3Qgb2s9cmFjZXMuZmlsdGVyKGE9PihhLmhvcnNlc3x8YS5ydW5uZXJzfHxbXSkubGVuZ3RoKSxiYWQ9cmFjZXMubGVuZ3RoLW9rLmxlbmd0aDsKICBXSy5jYXJkc1tkXS5wdXNoKC4uLm9rKTsKICBjb25zdCBpc3N1ZXM9b2suZmlsdGVyKGM9PmMucXVhbGl0eSYmIWMucXVhbGl0eS5vaykubWFwKGM9PmAke2MucmFjZU51bWJlcn1S77yaJHtjLnF1YWxpdHkuaXNzdWVzLmpvaW4oIuODuyIpfWApOwogIFdLLmRpYWcucHVzaCh7ZCxjb2RlLG5hbWU6di52ZW51ZU5hbWV8fFZFTlVFW2NvZGVdfHxjb2RlLHJhY2VzOnJhY2VzLmxlbmd0aCxvazpvay5sZW5ndGgsYmFkLGlzc3VlcyxlcnI6IXJhY2VzLmxlbmd0aD8i44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIjoiIn0pOwogIGlmKChiYWQ+MHx8b2subGVuZ3RoPDgpJiYhaXNSZXRyeSl7YXdhaXQgc2xlZXAoODAwKTtyZXR1cm4gbG9hZFZlbnVlSW50byhiYXNlLGQsdix0cnVlKX0KIH1jYXRjaChlKXsKICBXSy5kaWFnLnB1c2goe2QsY29kZSxuYW1lOnYudmVudWVOYW1lfHxWRU5VRVtjb2RlXXx8Y29kZSxyYWNlczowLG9rOjAsYmFkOjAsaXNzdWVzOltdLGVycjplLm1lc3NhZ2V9KTsKICBpZighaXNSZXRyeSl7YXdhaXQgc2xlZXAoMTIwMCk7cmV0dXJuIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsdHJ1ZSl9CiB9Cn0KCi8qIOOCquODg+OCuu+8iOWNmOWLne+8i+ikh+WLne+8ieOAguWHuummrOihqOOBruODquODs+OCr+OBi+OCieebtOaOpSDihpIg5Y+W44KM44Gq44GL44Gj44Gf44Os44O844K544Gv44CB5pel5LuY44O76ZaL5YKs5aC044Gu44Oh44OL44Ol44O857WM55Sx44Gn6KOc44GGICovCmFzeW5jIGZ1bmN0aW9uIGZldGNoT2Rkc0RhdGUoYmFzZSxkKXsKIGNvbnN0IGNhcmRzPVdLLmNhcmRzW2RdfHxbXSxub3Rlcz1bXTtXSy5vZGRzTm90ZXM9V0sub2Rkc05vdGVzfHx7fTsKIGlmKCFjYXJkcy5sZW5ndGgpe1dLLm9kZHNOb3Rlc1tkXT1ub3RlcztyZXR1cm57bjowLG5vdGVzfX0KIGNvbnN0IHdpdGhMaW5rPWNhcmRzLmZpbHRlcihyPT5yLm9kZHNDbmFtZSksYnlDPW5ldyBNYXAod2l0aExpbmsubWFwKHI9PltyLm9kZHNDbmFtZSxyXSkpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8d2l0aExpbmsubGVuZ3RoO2krPTYpY2h1bmtzLnB1c2god2l0aExpbmsuc2xpY2UoaSxpKzYpLm1hcChyPT5yLm9kZHNDbmFtZSkpOwogbGV0IGNpPTAsZmFpbE49MDtjb25zdCByZWFzb25zPXt9OwogY29uc3Qgd29ya2VyPWFzeW5jKCk9Pnt3aGlsZShjaTxjaHVua3MubGVuZ3RoKXtjb25zdCBrPWNpKys7CiAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzP2NuYW1lcz0ke2NodW5rc1trXS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCxbMTUwMF0pOwogICBmb3IoY29uc3QgaXQgb2YgKHguaXRlbXN8fFtdKSl7Y29uc3Qgcj1ieUMuZ2V0KGl0LmNuYW1lKTtpZihyKVdLLm9kZHNbcmtleShkLHIpXT17dGFuOml0Lm9kZHN8fHt9LHBsYWNlOml0LnBsYWNlfHx7fSxhdDpEYXRlLm5vdygpfX0KICAgZm9yKGNvbnN0IGYgb2YgKHguZmFpbGVkfHxbXSkpe2ZhaWxOKys7Y29uc3QgbT1TdHJpbmcoZi5yZWFzb258fCIiKS5zbGljZSgwLDYwKTtyZWFzb25zW21dPShyZWFzb25zW21dfHwwKSsxfQogIH1jYXRjaChlKXtmYWlsTis9Y2h1bmtzW2tdLmxlbmd0aDtjb25zdCBtPVN0cmluZyhlLm1lc3NhZ2V8fGUpLnNsaWNlKDAsNjApO3JlYXNvbnNbbV09KHJlYXNvbnNbbV18fDApKzF9fX07CiBhd2FpdCBQcm9taXNlLmFsbChbd29ya2VyKCksd29ya2VyKCldKTsKIGNvbnN0IGRpcmVjdD1jYXJkcy5maWx0ZXIocj0+V0sub2Rkc1tya2V5KGQscildKS5sZW5ndGg7CiBub3Rlcy5wdXNoKGDlh7rppqzooajjga7jg6rjg7Pjgq/jgYvjgonnm7TmjqXvvJoke2RpcmVjdH0vJHtjYXJkcy5sZW5ndGh944Os44O844K577yI44Oq44Oz44Kv44GC44KKICR7d2l0aExpbmsubGVuZ3RofeOAgeWkseaVlyAke2ZhaWxOfe+8iWApOwogZm9yKGNvbnN0IFttLGNdIG9mIE9iamVjdC5lbnRyaWVzKHJlYXNvbnMpKW5vdGVzLnB1c2goYOOAgOWkseaVl+OBrueQhueUse+8miR7bX3vvIgke2N977yJYCk7CiBjb25zdCBtaXNzaW5nPWNhcmRzLmZpbHRlcihyPT4hV0sub2Rkc1tya2V5KGQscildKTsKIGlmKG1pc3NpbmcubGVuZ3RoKXsKICBmb3IoY29uc3QgdiBvZiBbLi4ubmV3IFNldChtaXNzaW5nLm1hcChyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pKXsKICAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzP2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9YCxbMTUwMF0pOwogICAgZm9yKGNvbnN0IHIgb2YgKHgucmFjZXN8fFtdKSlXSy5vZGRzW2Ake2R9fCR7U3RyaW5nKHIudmVudWVDb2RlKS5wYWRTdGFydCgyLCIwIil9LSR7ci5yYWNlTm99YF09e3RhbjpyLm9kZHN8fHt9LHBsYWNlOnIucGxhY2V8fHt9LGF0OkRhdGUubm93KCl9OwogICAgbm90ZXMucHVzaChg44Oh44OL44Ol44O857WM55SxICR7VkVOVUVbdl18fHZ977yaJHsoeC5yYWNlc3x8W10pLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfvvIjjgqrjg4PjgrrnlLvpnaLjgavopovjgaTjgYvjgaPjgZ/jg6zjg7zjgrkgJHt4LnRhcmdldHM/PyI/In3vvI/lvZPml6XlhajkvZMgJHt4LnRhcmdldHNBbGw/PyI/In3vvIlgKTsKICAgfWNhdGNoKGUpe25vdGVzLnB1c2goYOODoeODi+ODpeODvOe1jOeUsSAke1ZFTlVFW3ZdfHx2fe+8muWkseaVl++8iCR7U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCw4MCl977yJYCl9fQogfQogY29uc3Qgc3RpbGw9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYoc3RpbGwubGVuZ3RoKW5vdGVzLnB1c2goYOOCquODg+OCuuacquWPluW+l++8miR7c3RpbGwubWFwKHI9PihyLnZlbnVlTmFtZXx8IiIpK3IucmFjZU51bWJlcisiUiIpLmpvaW4oIuOAgSIpfe+8iOeZuuWjsuWJjeOAgeOBvuOBn+OBr+iqreOBv+WPluOCjOOBpuOBhOOBvuOBm+OCk++8iWApOwogV0sub2Rkc05vdGVzW2RdPW5vdGVzOwogcmV0dXJue246Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoLG5vdGVzfTsKfQoKYXN5bmMgZnVuY3Rpb24gd2Vla2VuZEdvKCl7CiBjb25zdCBiYXNlPWJhc2VVcmwoKTskKCJ3a0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJ3a09kZHMiKS5kaXNhYmxlZD10cnVlOwogV0suZGF0ZXM9W107V0suY2FyZHM9e307V0sub2Rkcz17fTtXSy5kaWFnPVtdO1dLLmNhbGM9e307CiB0cnl7CiAgd2tNc2coIumWi+WCrOaXpeOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IHRvZGF5PWpzdFRvZGF5KCk7bGV0IGRhdGVzPVtdOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHt0b2RheX0mbGlzdD0xYCxbMTUwMF0pO2RhdGVzPSh4LmF2YWlsYWJsZURhdGVzfHxbXSkuZmlsdGVyKGQ9PmQ+PXRvZGF5KX1jYXRjaChlKXt9CiAgaWYoIWRhdGVzLmxlbmd0aClkYXRlcz1uZXh0V2Vla2VuZCh0b2RheSk7CiAgZGF0ZXM9Wy4uLm5ldyBTZXQoZGF0ZXMpXS5zb3J0KCkuc2xpY2UoMCwzKTsKICBmb3IoY29uc3QgZCBvZiBkYXRlcyl7CiAgIHdrTXNnKGAke2R9IOmWi+WCrOWgtOOCkueiuuiqjeS4reKApmApOwogICBsZXQgdmVudWVzPVtdOwogICB0cnl7dmVudWVzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZH0mbGlzdD0xYCxbMTUwMF0pKS52ZW51ZXN8fFtdfQogICBjYXRjaChlKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs5aC05LiA6KanKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7Y29udGludWV9CiAgIGlmKCF2ZW51ZXMubGVuZ3RoKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs44Gq44GXKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6IuOBk+OBruaXpeOBruWHuummrOihqOOBr+acquWFrOmWi+OAgeOBvuOBn+OBr+mWi+WCrOOBjOOBguOCiuOBvuOBm+OCkyJ9KTtjb250aW51ZX0KICAgV0suY2FyZHNbZF09W107CiAgIGZvcihjb25zdCB2IG9mIHZlbnVlcyl7d2tNc2coYCR7ZH0gJHt2LnZlbnVlTmFtZXx8di52ZW51ZUNvZGV9IOOBruWHuummrOihqOOCkuWPluW+l+S4reKApu+8iCR7KFdLLmNhcmRzW2RdfHxbXSkubGVuZ3RofeODrOODvOOCueWPluW+l+a4iOOBv++8iWApO2F3YWl0IGxvYWRWZW51ZUludG8oYmFzZSxkLHYpfQogICBpZigoV0suY2FyZHNbZF18fFtdKS5sZW5ndGgpV0suZGF0ZXMucHVzaChkKTsKICB9CiAgaWYoIVdLLmRhdGVzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuWHuummrOihqOOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAguOAjOWPluOCiui+vOOBv+eKtuazgeOAjeOCv+ODluOCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogIGxldCBvZGRzTj0wLHRvdGFsPTA7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpe3drTXNnKGAke2R9IOOCquODg+OCuuOCkuWPluW+l+S4reKApmApO29kZHNOKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlLGQpKS5uO3RvdGFsKz1XSy5jYXJkc1tkXS5sZW5ndGh9CiAgd2tNc2coIumBjuWOu+ODh+ODvOOCv+OBqOeFp+WQiOOBl+OBpuOAgeWFqOODrOODvOOCueOCkuino+aekOS4reKApiIpOwogIGF3YWl0IGNhbGNXZWVrZW5kKCk7V0suYXQ9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxNik7CiAgcmVuZGVyQWxsKCk7CiAgY29uc3QgbnI9V0suZGF0ZXMucmVkdWNlKChzLGQpPT5zK1dLLmNhcmRzW2RdLmxlbmd0aCwwKTsKICB3a01zZyhg5a6M5LqG77yIJHtXSy5hdH3vvInvvJoke1dLLmRhdGVzLmpvaW4oIuOAgSIpfe+8jyR7bnJ944Os44O844K577yP44Kq44OD44K6ICR7b2Rkc05944Os44O844K5JHtvZGRzTj8iIjoi77yI55m65aOy5YmN44Gu44Gf44KB5pyq5Y+W5b6X44CC55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN77yJIn1gKTsKICAkKCJ3a09kZHMiKS5kaXNhYmxlZD1mYWxzZTtzaG93VGFiKCJ2QXhpcyIpOwogfWNhdGNoKGUpe3drTXNnKCLjgqjjg6njg7zvvJoiK2UubWVzc2FnZSk7YnVzeShmYWxzZSk7cmVuZGVyQWxsKCl9CiBmaW5hbGx5eyQoIndrR28iKS5kaXNhYmxlZD1mYWxzZX0KfQphc3luYyBmdW5jdGlvbiBvZGRzT25seSgpewogaWYoIVdLLmRhdGVzLmxlbmd0aClyZXR1cm47JCgid2tPZGRzIikuZGlzYWJsZWQ9dHJ1ZTsKIHRyeXtsZXQgbj0wO2Zvcihjb25zdCBkIG9mIFdLLmRhdGVzKXt3a01zZyhgJHtkfSDjgqrjg4PjgrrjgpLmm7TmlrDkuK3igKZgKTtuKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlVXJsKCksZCkpLm59CiAgYXdhaXQgY2FsY1dlZWtlbmQoKTtXSy5hdD1uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDExLDE2KTtyZW5kZXJBbGwoKTt3a01zZyhg44Kq44OD44K65pu05paw77yIJHtXSy5hdH3vvInvvJoke25944Os44O844K55YiGYCl9CiBjYXRjaChlKXt3a01zZygi5pu05paw44Ko44Op44O877yaIitlLm1lc3NhZ2UpfWZpbmFsbHl7JCgid2tPZGRzIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDop6PmnpDvvIgx44Os44O844K577yJ77ya6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuiA9IOacn+W+heWApOOAgeazouS5seW6puOAgemJhOadvwogKiAg6KSH5Yud56K6546H77ya44Kq44OD44K644GC44KK4oaS5biC5aC05oOF5aCx44KC5L2/44GG5a2m57+S5riI44G/44Oi44OH44OrKHBPKe+8j+OBquOBl+KGkumBjuWOu+aIkOe4vuOBruOBv+OBruODouODh+ODqyhwUCkKICogIOikh+WLneOCquODg+OCuu+8mkpSQeOBruikh+WLneOCquODg+OCuu+8iOS4i+mZkOOAnOS4iumZkO+8ieOAguiqreOCgeOBquOBhOOBqOOBjeOBr+WNmOWLneOBi+OCieaOqOWumu+8iMOX6KGo56S677yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KZnVuY3Rpb24gY2FsY1JhY2UoZCxjLHN0b3JlKXsKIGNvbnN0IHJhY2U9bWtSYWNlKGMsZCksbj1yYWNlLnJ1bm5lcnMubGVuZ3RoOwogY29uc3QgYmFzZT17ZCxjYXJkOmMscmFjZSxuLGtleTpya2V5KGQsYyksdmVudWU6Yy52ZW51ZU5hbWV8fGMudmVudWV8fCIiLG5vOk51bWJlcihjLnJhY2VOdW1iZXIpfHwwLAogIGxhYmVsOmAke2MudmVudWVOYW1lfHxjLnZlbnVlfHwiIn0ke2MucmFjZU51bWJlcnx8IiJ9UiAke2MucmFjZU5hbWV8fCIifWAsY291cnNlOmMuc3VyZmFjZSYmYy5kaXN0YW5jZT9gJHtjLnN1cmZhY2V9JHtjLmRpc3RhbmNlfW1gOiLjgrPjg7zjgrnkuI3mmI4ifTsKIGlmKG48NilyZXR1cm57Li4uYmFzZSxza2lwOiI26aCt5pyq5rqAIn07CiBjb25zdCBvPVdLLm9kZHNbYmFzZS5rZXldLG9kZHM9bz9yYWNlLnJ1bm5lcnMubWFwKHI9Pm8udGFuW3IubnVtXSk6bnVsbCxoYXNPZGRzPSEhKG9kZHMmJm9kZHMuZXZlcnkoeD0+eD4xKSk7CiBjb25zdCBvZD1oYXNPZGRzP29kZHM6bnVsbDsKIGNvbnN0IHJlcz1VRS5hbmFseXplKHJhY2Usc3RvcmUsb2QpLGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKSx1Zz1VRS51cHNldEdyYWRlKHJhY2Usc3RvcmUsb2QsYXApOwogY29uc3QgYXhpcz1oYXNPZGRzP1VFLmF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kLGFwKTpudWxsOwogY29uc3QgbTM9aGFzT2Rkcz9VRS50b3AzRnJvbVdpbihvZC5tYXAoeD0+MS94KSk6bnVsbDsKIGNvbnN0IGhvcnNlcz1yYWNlLnJ1bm5lcnMubWFwKChyLGkpPT57CiAgY29uc3QgcD1oYXNPZGRzP2FwLnBPW2ldOmFwLnBQW2ldLHBsPW8mJm8ucGxhY2UmJm8ucGxhY2Vbci5udW1dOwogIGxldCBsbz1udWxsLGhpPW51bGwsc3JjPW51bGw7CiAgaWYocGwmJnBsLmxlbmd0aD09PTImJnBsWzBdPj0xKXtsbz1wbFswXTtoaT1wbFsxXTtzcmM9IuWunyJ9CiAgZWxzZSBpZihtMyl7bG89TWF0aC5tYXgoMSwwLjgvTWF0aC5tYXgobTNbaV0sLjAyKSk7aGk9bG87c3JjPSLmjqjlrpoifQogIGNvbnN0IHRyPXN0b3JlLnRyJiZyLnRyYWluZXI/c3RvcmUudHIuZ2V0KHIudHJhaW5lcik6bnVsbCx4PXJlc1tpXTsKICByZXR1cm57aSxubzpyLm51bSxuYW1lOnIubmFtZSxqbmFtZTpyLmpuYW1lLHRyYWluZXI6ci50cmFpbmVyLHRyTjp0cj90ci5uOjAsdHJSYXRlOnRyJiZ0ci5uP3RyLnQzL3RyLm46bnVsbCxqbjp4LmpuLAogICBwLGxvLGhpLHNyYyxldjpsbz9wKmxvOm51bGwsZXZNaWQ6bG8/cCoobG8raGkpLzI6bnVsbCx3aW46aGFzT2Rkcz9vZFtpXTpudWxsLHBvcDp4LnBvcCxob2xlOnguaG9sZSxwYzp4LnBjLG1vZGU6eC5tb2RlLG46eC5uLAogICBjYXJlZXI6eC5jYXJlZXIscmVjZW50OngucmVjZW50LHRhZ3M6eC50YWdzLHJhdGluZzpVRS5yYXRpbmcoeC5wYyx4Lm1vZGUseC5uKSx4fX0pOwogcmV0dXJuey4uLmJhc2UsaGFzT2RkcyxyZXMsYXAsdWcsYXhpcyxob3JzZXMscGxhY2VSZWFsOmhvcnNlcy5maWx0ZXIoaD0+aC5zcmM9PT0i5a6fIikubGVuZ3RofTsKfQphc3luYyBmdW5jdGlvbiBjYWxjV2Vla2VuZCgpewogV0suY2FsYz17fTsKIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoV0suZGF0ZXNbMF0pOwogV0suc3RvcmVJbmZvPXtsYXN0OnN0b3JlLmxhc3REYXRlfHwiIixjb3VudDpzdG9yZS5jb3VudH07CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgY3M9Wy4uLldLLmNhcmRzW2RdXS5zb3J0KChhLGIpPT5TdHJpbmcoYS52ZW51ZUNvZGUpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudmVudWVDb2RlKSl8fChhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKICBXSy5jYWxjW2RdPXtyYWNlczpbXX07CiAgZm9yKGxldCBpPTA7aTxjcy5sZW5ndGg7aSsrKXsKICAgdHJ5e1dLLmNhbGNbZF0ucmFjZXMucHVzaChjYWxjUmFjZShkLGNzW2ldLHN0b3JlKSl9CiAgIGNhdGNoKGUpe1dLLmNhbGNbZF0ucmFjZXMucHVzaCh7ZCxjYXJkOmNzW2ldLHNraXA6Iuino+aekOOCqOODqeODvO+8miIrZS5tZXNzYWdlLGxhYmVsOmAke2NzW2ldLnZlbnVlTmFtZXx8IiJ9JHtjc1tpXS5yYWNlTnVtYmVyfHwiIn1SYCx2ZW51ZTpjc1tpXS52ZW51ZU5hbWV8fCIiLG5vOmNzW2ldLnJhY2VOdW1iZXJ8fDAsaG9yc2VzOltdfSl9CiAgIGlmKGklND09PTMpYXdhaXQgc2xlZXAoMCk7CiAgfQogfQp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5qSc6Ki844Ky44O844OI77ya5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT44Gn44CB6Kqk5beu44KS5byV44GE44Gm44KC5Zue5Y+O546HMTAwJeS7peS4iuOBruiyt+OBhOaWueOBoOOBkeOAjOaknOiovOa4iOOBv+OAjQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEdBVEVfS0VZPSJrZWliYV9nYXRlX3YyIjsKY29uc3QgZ2V0R2F0ZT0oKT0+e3RyeXtyZXR1cm4gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShHQVRFX0tFWSl8fCJudWxsIil9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsKY29uc3QgU1RSQVQ9e2ZvY3VzOiLnqbTppqzvvIjil47nmoTkuK3njofph43oppbvvIkiLHRvcDE6IueptOmmrDHkvY0iLHRvcDI6IueptOmmrOS4iuS9jTLpoK0iLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uCJ9OwpmdW5jdGlvbiBzZXRHYXRlKG91dCxvdXRQKXsKIGNvbnN0IGl0ZW1zPVtdOwogZm9yKGNvbnN0IFtzcmMsb10gb2YgW1si44Kq44OD44K644GC44KKIixvdXRdLFsi44Kq44OD44K644Gq44GXIixvdXRQXV0pewogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKFNUUkFUKSl7CiAgIGNvbnN0IHY9by5zdGF0c1trXTtpZighdiljb250aW51ZTsKICAgY29uc3Qgc2VnPSh2LkMmJnYuQy5iZXRzPj0zMDApP3YuQzp2LmFsbDtpZighc2VnfHwhc2VnLmJldHMpY29udGludWU7CiAgIGNvbnN0IGxvdz1zZWcucm9pLTEuOTYqc2VnLnNlOwogICBpdGVtcy5wdXNoKHtrZXk6ayxsYWJlbDpTVFJBVFtrXSsi77yIIitzcmMrIu+8iSIscm9pOnNlZy5yb2ksbG93LGJldHM6c2VnLmJldHMsaGl0OnNlZy5oaXRSYXRlLHNlZzpzZWc9PT12LkM/IuWtpue/kuW+jCI6IuWFqOacn+mWkyJ9KTsKICB9CiB9CiBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShHQVRFX0tFWSxKU09OLnN0cmluZ2lmeSh7YXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLGl0ZW1zfSkpOwogcmVuZGVyR2F0ZSgpOwp9CmNvbnN0IHN0cmF0T2s9a2V5PT57Y29uc3QgZz1nZXRHYXRlKCk7cmV0dXJuICEhKGcmJmcuaXRlbXMuc29tZSh4PT54LmtleT09PWtleSYmeC5sb3c+PTEmJnguYmV0cz49MzAwKSl9Owpjb25zdCBzdHJhdENoaXA9a2V5PT5zdHJhdE9rKGtleSk/JzxzcGFuIGNsYXNzPSJjaGlwIGIiPuaknOiovOa4iOOBv++8iOWbnuWPjueOhzEwMCXotoXvvIk8L3NwYW4+JzonPHNwYW4gY2xhc3M9ImNoaXAgciI+5Zue5Y+O546HMTAwJei2heOBr+acqueiuuiqjTwvc3Bhbj4nOwpmdW5jdGlvbiByZW5kZXJHYXRlKCl7CiBjb25zdCBnPWdldEdhdGUoKSxlbD0kKCJnYXRlIik7CiBpZighZyl7ZWwuaW5uZXJIVE1MPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPjxiPuWbnuWPjueOh++8muacquaknOiovDwvYj7jgIDjgIzmpJzoqLzjgI3jgr/jg5bjgpLlrp/ooYzjgZnjgovjgb7jgafjgIHjganjga7osrfjgYTmlrnjgoLjgIwxMDAl6LaF44CN44Go44Gv6KiA44GI44G+44Gb44KT44CC77yI5Lul5YmN44Gu5qSc6Ki844Gn44Gv44CB56m06aasMeS9jeOBruikh+WLneWbnuWPjueOh+OBr+e0hDcy44CcNzcl44Gn44GX44Gf77yJPC9kaXY+JztyZXR1cm59CiBjb25zdCBvaz1nLml0ZW1zLmZpbHRlcih4PT54Lmxvdz49MSYmeC5iZXRzPj0zMDApLGJlc3Q9Zy5pdGVtcy5zbGljZSgpLnNvcnQoKGEsYik9PmIucm9pLWEucm9pKVswXTsKIGlmKG9rLmxlbmd0aCllbC5pbm5lckhUTUw9YDxkaXYgY2xhc3M9ImJhbm5lciBvayI+PGI+5qSc6Ki85riI44G/77yI5Zue5Y+O546HMTAwJei2he+8ie+8mjwvYj4ke29rLm1hcCh4PT5gJHtlc2MoeC5sYWJlbCl9ICR7cGN0KHgucm9pKX3vvIjkuIvpmZAke3BjdCh4Lmxvdyl944O7JHt4LmJldHMudG9Mb2NhbGVTdHJpbmcoKX3lm57jg7ske3guc2Vnfe+8iWApLmpvaW4oIu+8jyIpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaknOiovOaXpSAke2VzYyhnLmF0KX3jgILpgY7ljrvjga7miJDnuL7jgafjga7ntZDmnpzjgafjgIHku4rlvozjgoLntprjgY/kv53oqLzjga/jgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+PC9kaXY+YDsKIGVsc2UgZWwuaW5uZXJIVE1MPWA8ZGl2IGNsYXNzPSJiYW5uZXIgbmciPjxiPuWbnuWPjueOhzEwMCXotoXjgpLnorroqo3jgafjgY3jgZ/osrfjgYTmlrnjga/jgIHjgb7jgaDjgYLjgorjgb7jgZvjgpPjgII8L2I+JHtiZXN0P2DmnIDpq5jjgafjgoIgJHtlc2MoYmVzdC5sYWJlbCl9IOOBriAke3BjdChiZXN0LnJvaSl977yI6Kqk5beu44KS5byV44GP44GoJHtwY3QoYmVzdC5sb3cpfeODuyR7YmVzdC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl95Zue44O7JHtiZXN0LnNlZ33vvInjgIJgOiIifTxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaknOiovOaXpSAke2VzYyhnLmF0KX3jgILkuIvjga7lgJnoo5zjga/jgIzlvZPjgZ/jgorjgoTjgZnjgZXjg7vmnJ/lvoXlgKTjga7nm67lronjgI3jgajjgZfjgabkvb/jgaPjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+PC9kaXY+YDsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOihqOekugogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEdSQURFX09SREVSPVsiU1NTIiwiU1MiLCJTIiwiQSIsIkIiLCJDIl0sR1JBREVfQ09MT1I9e1NTUzoiI2I0MjMxOCIsU1M6IiNkOTJkMjAiLFM6IiNmNzkwMDkiLEE6IiMxNjY3ZDkiLEI6IiM2NjcwODUiLEM6IiM5OGEyYjMifTsKY29uc3QgZGF5TGFiZWw9ZD0+e2NvbnN0IHc9IuaXpeaciOeBq+awtOacqOmHkeWcnyJbbmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFVUQ0RheSgpXTtyZXR1cm4gYCR7ZC5zbGljZSg1KS5yZXBsYWNlKCItIiwiLyIpfSgke3d9KWB9Owpjb25zdCBjYWxjUmFjZXM9ZD0+KFdLLmNhbGNbZF0mJldLLmNhbGNbZF0ucmFjZXMpfHxbXTsKY29uc3QgYWxsUmFjZXM9KCk9PldLLmRhdGVzLmZsYXRNYXAoZD0+Y2FsY1JhY2VzKGQpKTsKY29uc3Qgbm9EYXRhPW1zZz0+YDxkaXYgY2xhc3M9InNtYWxsIj4ke21zZ3x8IuOAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgIIifTwvZGl2PmA7CgpmdW5jdGlvbiByZW5kZXJBbGwoKXtyZW5kZXJHYXRlKCk7cmVuZGVyQXhpcygpO3JlbmRlckV2KCk7cmVuZGVyVXBzZXQoKTtyZW5kZXJIb2xlKCk7cmVuZGVyUmFjZXMoKTtyZW5kZXJTdW0oKX0KCi8qIC0tLSDotoXpiYTmnb/vvIjopIfli53lnI/lhoXjga7kuojmuKznorrnjofjgYzpq5jjgYTou7jppqzvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlckF4aXMoKXsKIGNvbnN0IGVsPSQoInZBeGlzIik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IEI9VUUuQVhJUy5iYW5kczsKIGxldCBoPWA8aDI+6LaF6YmE5p2/77yI6KSH5Yud5ZyP5YaFIOe0hDk1JeS7peS4iu+8iTwvaDI+JHtzdHJhdENoaXAoImF4aXMiKX0KIDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrnjgaDjgZHliKTlrprjgZfjgb7jgZnjgILpgY7ljrvjga7lrp/nuL7vvJo8Yj7piYTmnb88L2I+77yI5LqI5risJHtwY3QoQlsi6YmE5p2/Il0ubG8pfeS7peS4iu+8ieOBr+Wun+mam+OBqzxiPiR7cGN0KEJbIumJhOadvyJdLnJhdGUsMSl9PC9iPuOBjDPnnYDku6XlhoXvvIgke0JbIumJhOadvyJdLm596aCt44CB6Kqk5beu44KS5byV44GE44Gm44KCJHtwY3QoQlsi6YmE5p2/Il0ubG85NSwxKX3vvInjgIEx5pel44GC44Gf44KK57SEJHtCWyLpiYTmnb8iXS5wZXJEYXl96aCt44CCMeaXpeOBq+acgOWkpzLpoK3jgaDjgZHlh7rjgZfjgb7jgZnjgII8L2Rpdj5gOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IHJzPWNhbGNSYWNlcyhkKSxwaWNrcz1bXTsKICBmb3IoY29uc3QgciBvZiBycylpZihyLmF4aXMpZm9yKGNvbnN0IHggb2Ygci5heGlzKXBpY2tzLnB1c2goe3IseCxoaDpyLmhvcnNlc1t4LmldfSk7CiAgcGlja3Muc29ydCgoYSxiKT0+Yi54LnAtYS54LnApOwogIGNvbnN0IG5PZGRzPXJzLmZpbHRlcihyPT4hci5za2lwJiZyLmhhc09kZHMpLmxlbmd0aCxuQWxsPXJzLmZpbHRlcihyPT4hci5za2lwKS5sZW5ndGg7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfeOAgDxzcGFuIGNsYXNzPSJzbWFsbCI+44Kq44OD44K65Y+W5b6XICR7bk9kZHN9LyR7bkFsbH3jg6zjg7zjgrk8L3NwYW4+PC9oMz5gOwogIGlmKCFuT2Rkcyl7aCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+44Kq44OD44K644GM5pyq5Y+W5b6X44Gu44Gf44KB5Yik5a6a44Gn44GN44G+44Gb44KT77yI55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN44KS5oq844GX44Gm44GP44Gg44GV44GE77yJ44CCPC9kaXY+Jztjb250aW51ZX0KICBjb25zdCBpcm9uPXBpY2tzLmZpbHRlcih6PT56LngudGllcj09PSLpiYTmnb8iKS5zbGljZSgwLDIpOwogIGNvbnN0IHJlc3Q9cGlja3MuZmlsdGVyKHo9PnoueC50aWVyIT09IumJhOadvyIpLnNsaWNlKDAsMik7CiAgY29uc3QgY2FyZD0oeix0YWcpPT5gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moei5yLmxhYmVsKX08L2I+44CAPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyh6LnIuY291cnNlKX3jg7ske3ouci5ufemgrTwvc3Bhbj48YnI+PGI+JHt6LmhoLm5vfeeVqiAke2VzYyh6LmhoLm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHJBIj4ke3RhZ308L3NwYW4+44CA5LqI5risICR7cGN0KHoueC5wKX08YnI+CiAgIDxzcGFuIGNsYXNzPSJzbWFsbCI+6aiO5omL77yaJHtlc2Moei5oaC5qbmFtZXx8IuS4jeaYjiIpfe+8j+iqv+aVmeW4q++8miR7ZXNjKHouaGgudHJhaW5lcnx8IuS4jeaYjiIpfe+8j+WNmOWLnSAke3ouaGgud2luP3ouaGgud2luKyLlgI0iOiItIn3vvI/opIfli50gJHt6LmhoLmxvP3ouaGgubG8udG9GaXhlZCgxKSsoei5oaC5oaT56LmhoLmxvPyLjgJwiK3ouaGguaGkudG9GaXhlZCgxKToiIikrIuWAjSIrKHouaGguc3JjPT09IuaOqOWumiI/IijmjqjlrpopIjoiIik6Ii0ife+8j+OBk+OBruWMuuWIhuOBrumBjuWOu+Wun+e4viAke3BjdCh6LngucmF0ZSwxKX08L3NwYW4+PC9kaXY+YDsKICBpZihpcm9uLmxlbmd0aCloKz1pcm9uLm1hcCh6PT5jYXJkKHosIui2hemJhOadvyIpKS5qb2luKCIiKTsKICBlbHNlIGgrPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPui2hemJhOadv++8iOS6iOa4rDkyJeS7peS4iu+8ieOBq+ipsuW9k+OBmeOCi+mmrOOBr+OBhOOBvuOBm+OCk+OAgueEoeeQhuOBq+iyt+OCj+OBquOBhOOBruOCguS4gOOBpOOBruWIpOaWreOBp+OBmeOAgjwvZGl2Pic7CiAgaWYoIWlyb24ubGVuZ3RoJiZyZXN0Lmxlbmd0aCloKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWPguiAg++8iDk1JeOBq+OBr+WxiuOBi+OBquOBhOi7uOWAmeijnO+8ie+8mjwvZGl2PmArcmVzdC5tYXAoej0+Y2FyZCh6LHoueC50aWVyKSkuam9pbigiIik7CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOacn+W+heWApO+8iOikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrrvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlckV2KCl7CiBjb25zdCBlbD0kKCJ2RXYiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgZXZNaW49TnVtYmVyKCQoImV2TWluIik/JCgiZXZNaW4iKS52YWx1ZToxLjA1KSxwTWluPU51bWJlcigkKCJldlAiKT8kKCJldlAiKS52YWx1ZTouMjUpOwogY29uc3Qgcm93cz1bXTsKIGZvcihjb25zdCByIG9mIGFsbFJhY2VzKCkpaWYoIXIuc2tpcClmb3IoY29uc3QgaCBvZiByLmhvcnNlcylpZihoLmV2IT1udWxsJiZoLmV2Pj1ldk1pbiYmaC5wPj1wTWluKXJvd3MucHVzaCh7cixofSk7CiByb3dzLnNvcnQoKGEsYik9PmIuaC5ldi1hLmguZXYpOwogY29uc3Qgbk9kZHM9YWxsUmFjZXMoKS5maWx0ZXIocj0+ci5oYXNPZGRzKS5sZW5ndGg7CiBsZXQgaD1gPGgyPuacn+W+heWApO+8iOikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrrvvIk8L2gyPiR7c3RyYXRDaGlwKCJ2YWx1ZSIpfQogPGRpdiBjbGFzcz0ic21hbGwiPuacn+W+heWApO+8neOBneOBrummrOOBjDPnnYDku6XlhoXjgavlhaXjgovnorrnjocgw5cg6KSH5Yud44Kq44OD44K644Gu5LiL6ZmQ44CCMS4w44KS6LaF44GI44KM44Gw44CB55CG6KuW5LiK44Gv6LK344GE57aa44GR44Gm44OX44Op44K544Gn44GZ44CC6KSH5Yud44Kq44OD44K644GvPGI+5a6fPC9iPu+8nUpSQeOBruWun+OCquODg+OCuuOAgTxiPuaOqOWumjwvYj7vvJ3ljZjli53jgYvjgonoqIjnrpfjgZfjgZ/nm67lronjgILnorrnjofjga7opovnqY3jgoLjgorpgZXjgYTjgYzlpKfjgY3jgY/lirnjgY/jgZ/jgoHjgIHjgIzmpJzoqLzjgI3jgacxMDAl6LaF44GM56K66KqN44GV44KM44KL44G+44Gn44Gv55uu5a6J44Go44GX44Gm5L2/44Gj44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuacn+W+heWApCA8c2VsZWN0IGlkPSJldk1pbiI+PG9wdGlvbiB2YWx1ZT0iMSI+MS4wMOS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjEuMDUiPjEuMDXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjEiPjEuMTDku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjIiPjEuMjDku6XkuIo8L29wdGlvbj48L3NlbGVjdD4g6KSH5Yud56K6546HIDxzZWxlY3QgaWQ9ImV2UCI+PG9wdGlvbiB2YWx1ZT0iMC4xNSI+MTUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC4yNSI+MjUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC40Ij40MCXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwLjYiPjYwJeS7peS4ijwvb3B0aW9uPjwvc2VsZWN0PjwvZGl2PmA7CiBpZighbk9kZHMpe2VsLmlubmVySFRNTD1oKyc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBjOacquWPluW+l+OBruOBn+OCgeOAgeacn+W+heWApOOBr+ioiOeul+OBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAje+8ieOAgjwvZGl2Pic7YmluZEV2KGV2TWluLHBNaW4pO3JldHVybn0KIGlmKCFyb3dzLmxlbmd0aCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnaHku7bjgavlkIjjgYbppqzjga/jgYTjgb7jgZvjgpPjgII8L2Rpdj4nOwogZWxzZXsKICBoKz1gPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPummrDwvdGg+PHRoPueiuueOhzwvdGg+PHRoPuikh+WLnTwvdGg+PHRoPuacn+W+heWApDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCB7cixoOnh9IG9mIHJvd3Muc2xpY2UoMCw0MCkpaCs9YDx0cj48dGQ+JHtlc2MoZGF5TGFiZWwoci5kKSl9ICR7ZXNjKHIubGFiZWwpfTxicj48Yj4ke3gubm9955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHguam5hbWV8fCIiKX08L3NwYW4+PC90ZD48dGQ+JHtwY3QoeC5wKX08L3RkPjx0ZD4ke3gubG8udG9GaXhlZCgxKX0ke3guaGk+eC5sbz8i44CcIit4LmhpLnRvRml4ZWQoMSk6IiJ9PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guc3JjfTwvc3Bhbj48L3RkPjx0ZD48Yj4ke3guZXYudG9GaXhlZCgyKX08L2I+PC90ZD48L3RyPmA7CiAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogfQogZWwuaW5uZXJIVE1MPWg7YmluZEV2KGV2TWluLHBNaW4pOwp9CmZ1bmN0aW9uIGJpbmRFdihhLGIpe2NvbnN0IGU9JCgiZXZNaW4iKSxwPSQoImV2UCIpO2lmKCFlKXJldHVybjtlLnZhbHVlPVN0cmluZyhhKTtwLnZhbHVlPVN0cmluZyhiKTtlLm9uY2hhbmdlPXAub25jaGFuZ2U9cmVuZGVyRXZ9CgovKiAtLS0g5rOi5Lmx5bqmIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJVcHNldCgpewogY29uc3QgZWw9JCgidlVwc2V0Iik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGxldCBoPWA8aDI+44Os44O844K544Gu5rOi5Lmx5bqm77yIU1NT44CcQ++8iTwvaDI+PGRpdiBjbGFzcz0ic21hbGwiPuOAjDPnnYDku6XlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOAjeOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkeOBl+OBpuOBhOOBvuOBme+8iOWFqOODrOODvOOCueW5s+WdhyDntIQyOC41Je+8ieOAguOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBr+OAgeOCquODg+OCuui+vOOBv+OBruWIpOWumuOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PmA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgcnM9Y2FsY1JhY2VzKGQpLmZpbHRlcihyPT4hci5za2lwKSxjbnQ9e307R1JBREVfT1JERVIuZm9yRWFjaChnPT5jbnRbZ109MCk7cnMuZm9yRWFjaChyPT5jbnRbci51Zy5ncmFkZV0rKyk7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+PGRpdiBjbGFzcz0icm93Ij4ke0dSQURFX09SREVSLm1hcChnPT5gPHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW2ddfSI+JHtnfSAke2NudFtnXX08L3NwYW4+YCkuam9pbigiICIpfTwvZGl2PmA7CiAgY29uc3Qgc29ydGVkPXJzLnNsaWNlKCkuc29ydCgoYSxiKT0+R1JBREVfT1JERVIuaW5kZXhPZihhLnVnLmdyYWRlKS1HUkFERV9PUkRFUi5pbmRleE9mKGIudWcuZ3JhZGUpfHxiLnVnLnAtYS51Zy5wKTsKICBoKz1gPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuODrOODvOOCuTwvdGg+PHRoPuetiee0mjwvdGg+PHRoPumBjuWOu+OBruazouS5seeOhzwvdGg+PHRoPuWIpOWumjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCByIG9mIHNvcnRlZCloKz1gPHRyPjx0ZD4ke2VzYyhyLmxhYmVsKX08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyLmNvdXJzZSl944O7JHtyLm596aCtPC9zcGFuPjwvdGQ+PHRkPjxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltyLnVnLmdyYWRlXX0iPiR7ci51Zy5ncmFkZX08L3NwYW4+PC90ZD48dGQ+JHtNYXRoLnJvdW5kKHIudWcucmF0ZSoxMDApfSU8L3RkPjx0ZCBjbGFzcz0ic21hbGwiPiR7ci51Zy5tb2RlPT09Im9kZHMiPyLjgqrjg4Pjgrrovrzjgb8iOiLmjqjlrpoifTwvdGQ+PC90cj5gOwogIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIH0KIGVsLmlubmVySFRNTD1oOwp9CgovKiAtLS0g56m06aas77yI5aW96LWw546H44Gu6auY44GE56m06aas5YCZ6KOc77yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJIb2xlKCl7CiBjb25zdCBlbD0kKCJ2SG9sZSIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCBmb2N1cz0kKCJob2xlRm9jdXMiKT8kKCJob2xlRm9jdXMiKS52YWx1ZT09PSIxIjp0cnVlOwogbGV0IGg9YDxoMj7nqbTppqzlgJnoo5w8L2gyPiR7c3RyYXRDaGlwKCJmb2N1cyIpfQogPGRpdiBjbGFzcz0ic21hbGwiPueptOOCvuODvOODs++8iOS6uuawl+iWhO+8ieOBruS4reOBp+OAgTPnnYDku6XlhoXjgavlhaXjgovnorrnjofjgYzpq5jjgYTppqzjgILjgIzlvZPjgZ/jgorjgoTjgZnjgZXjgI3jga7nm67lronjgafjgIHlm57lj47njofjga/liKXjgafjgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyBzbWFsbCI+PHNlbGVjdCBpZD0iaG9sZUZvY3VzIj48b3B0aW9uIHZhbHVlPSIxIj7il47nmoTkuK3njofph43oppbvvIjjg6njg7Pjgq9TL0Hjga7jgb/vvIk8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwIj7jgZnjgbnjgabvvIjkuIrkvY0y6aCt77yJPC9vcHRpb24+PC9zZWxlY3Q+PC9kaXY+YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz5gOwogIGZvcihjb25zdCByIG9mIGNhbGNSYWNlcyhkKSl7CiAgIGlmKHIuc2tpcCljb250aW51ZTsKICAgY29uc3QgYz1mb2N1cz9VRS5waWNrRm9jdXMoci5yZXMsMik6VUUucGljayhyLnJlcywyKTtpZighYy5sZW5ndGgpY29udGludWU7CiAgIGgrPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyhyLmxhYmVsKX08L2I+IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moci5jb3Vyc2UpfeODuyR7ci5ufemgrSR7ci5oYXNPZGRzPyIiOiLvvIjjgqrjg4PjgrrmnKrlj5blvpfvvIkifTwvc3Bhbj5gOwogICBmb3IoY29uc3QgeCBvZiBjKXtjb25zdCBoaD1yLmhvcnNlc1t4LmldOwogICAgaCs9YDxkaXYgc3R5bGU9Im1hcmdpbi10b3A6NnB4Ij48Yj4ke3gubm9955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgciR7aGgucmF0aW5nfSI+JHtoaC5yYXRpbmd9PC9zcGFuPiA8c3BhbiBjbGFzcz0ic21hbGwiPuWlvei1sOeOhyAke3BjdCh4LnBjLDEpfSR7eC5vZGQ/YO+8j+WNmOWLnSR7eC5vZGR95YCNKCR7eC5wb3B955Wq5Lq65rCXKWA6IiJ9PC9zcGFuPjxicj4KICAgICA8c3BhbiBjbGFzcz0ic21hbGwiPiR7aGguY2FyZWVyJiZoaC5jYXJlZXIubj9g6YCa566XJHtoaC5jYXJlZXIubn3otbAgM+edgOWGhSR7aGguY2FyZWVyLnQzfeWbnmA6IumAmueul++8muWxpeattOOBquOBlyJ9JHtoaC5yZWNlbnQmJmhoLnJlY2VudC5sZW5ndGg/YO+8j+ebtOi/kSAke2hoLnJlY2VudC5zbGljZSgtNSkuam9pbigiLSIpfeedgGA6IiJ977yP6aiO5omL77yaJHtlc2MoaGguam5hbWV8fCLkuI3mmI4iKX3vvI/oqr/mlZnluKvvvJoke2VzYyhoaC50cmFpbmVyfHwi5LiN5piOIil9JHtoaC50clJhdGUhPW51bGwmJmhoLnRyTj49MjA/YCgz552A5YaFJHtwY3QoaGgudHJSYXRlKX0pYDoiIn08L3NwYW4+PGJyPmArCiAgICAgKHgudGFnc3x8W10pLnNsaWNlKDAsMykubWFwKHQ9PmA8c3BhbiBjbGFzcz0iY2hpcCAke3QuY30iPiR7ZXNjKHQudCl9PC9zcGFuPmApLmpvaW4oIiIpK2A8L2Rpdj5gfQogICBoKz0iPC9kaXY+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKIGNvbnN0IHM9JCgiaG9sZUZvY3VzIik7cy52YWx1ZT1mb2N1cz8iMSI6IjAiO3Mub25jaGFuZ2U9cmVuZGVySG9sZTsKfQoKLyogLS0tIOWFqOODrOODvOOCue+8iOmmrOOBlOOBqOOBrueiuueOh+ODu+OCquODg+OCuuODu+acn+W+heWApOODu+mojuaJi+ODu+iqv+aVmeW4q++8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyUmFjZXMoKXsKIGNvbnN0IGVsPSQoInZSYWNlcyIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBsZXQgaD0iPGgyPuWFqOODrOODvOOCuTwvaDI+IjsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz5gOwogIGZvcihjb25zdCByIG9mIGNhbGNSYWNlcyhkKSl7CiAgIGlmKHIuc2tpcCl7aCs9YDxkaXYgY2xhc3M9InNtYWxsIj4ke2VzYyhyLmxhYmVsKX3vvJoke2VzYyhyLnNraXApfTwvZGl2PmA7Y29udGludWV9CiAgIGNvbnN0IGc9ci51ZzsKICAgaCs9YDxkZXRhaWxzPjxzdW1tYXJ5PiR7ZXNjKHIubGFiZWwpfSA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK08L3NwYW4+IDxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltnLmdyYWRlXX0iPiR7Zy5ncmFkZX08L3NwYW4+PC9zdW1tYXJ5PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqzvvI/pqI7miYvvvI/oqr/mlZnluKs8L3RoPjx0aD7ljZjli508L3RoPjx0aD7opIfli508L3RoPjx0aD7norrnjoc8L3RoPjx0aD5FVjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgeCBvZiByLmhvcnNlcy5zbGljZSgpLnNvcnQoKGEsYik9PmIucC1hLnApKQogICAgaCs9YDx0cj48dGQ+PGI+JHt4Lm5vfTwvYj4gJHtlc2MoeC5uYW1lKX0ke3guaG9sZSYmeC5yYXRpbmchPT0iQyI/YCA8c3BhbiBjbGFzcz0icnQgciR7eC5yYXRpbmd9Ij4ke3gucmF0aW5nfTwvc3Bhbj5gOiIifTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5qbmFtZT9lc2MoeC5qbmFtZSk6JzxzcGFuIGNsYXNzPSJiYWQiPumojuaJi+S4jeaYjjwvc3Bhbj4nfe+8iCR7eC5qbj49NT8i6YGO5Y67Iit4LmpuKyLpqI7kuZciOiLlsaXmrbTlsJEife+8ie+8jyR7eC50cmFpbmVyP2VzYyh4LnRyYWluZXIpOic8c3BhbiBjbGFzcz0iYmFkIj7oqr/mlZnluKvkuI3mmI48L3NwYW4+J30ke3gudHJSYXRlIT1udWxsJiZ4LnRyTj49MjA/Iu+8iDPnnYDlhoUiK3BjdCh4LnRyUmF0ZSkrIu+8iSI6IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7eC53aW4/eC53aW4udG9GaXhlZCgxKToiLSJ9PC90ZD48dGQ+JHt4LmxvP3gubG8udG9GaXhlZCgxKSsoeC5oaT54LmxvPyLjgJwiK3guaGkudG9GaXhlZCgxKToiIik6Ii0ifTxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LnNyY3x8IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHgucCl9PC90ZD48dGQ+JHt4LmV2IT1udWxsP2A8YiR7eC5ldj49MS4wNT8nIGNsYXNzPSJnb29kIic6IiJ9PiR7eC5ldi50b0ZpeGVkKDIpfTwvYj5gOiItIn08L3RkPjwvdHI+YDsKICAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2RldGFpbHM+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOWPluOCiui+vOOBv+eKtuazge+8iOmgreaVsOODu+mojuaJi+ODu+iqv+aVmeW4q+ODu+OCs+ODvOOCueODu+OCquODg+OCuuOBruiqreOBv+WPluOCiue1kOaenO+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyU3VtKCl7CiBjb25zdCBlbD0kKCJ2U3VtIik7aWYoIVdLLmRhdGVzLmxlbmd0aCYmIVdLLmRpYWcubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgcnM9YWxsUmFjZXMoKS5maWx0ZXIocj0+IXIuc2tpcCk7CiBjb25zdCBob3JzZXM9cnMucmVkdWNlKChzLHIpPT5zK3IubiwwKSxqbWlzcz1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9PiFoLmpuYW1lKS5sZW5ndGgsMCksdG1pc3M9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT4haC50cmFpbmVyKS5sZW5ndGgsMCk7CiBjb25zdCBqbWF0Y2g9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT5oLmpuPj01KS5sZW5ndGgsMCksaG1hdGNoPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+aC5uPj0yKS5sZW5ndGgsMCk7CiBjb25zdCBub0NvdXJzZT1ycy5maWx0ZXIocj0+ci5jb3Vyc2U9PT0i44Kz44O844K55LiN5piOIikubGVuZ3RoLG5PZGRzPXJzLmZpbHRlcihyPT5yLmhhc09kZHMpLmxlbmd0aCxwUmVhbD1ycy5maWx0ZXIocj0+ci5wbGFjZVJlYWw+MCkubGVuZ3RoOwogbGV0IGg9YDxoMj7lj5bjgorovrzjgb/nirbms4E8L2gyPjx0YWJsZT48dGJvZHk+CiA8dHI+PHRkPuino+aekOOBl+OBn+ODrOODvOOCue+8j+WHuui1sOmmrDwvdGQ+PHRkPiR7cnMubGVuZ3RofeODrOODvOOCue+8jyR7aG9yc2VzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+6aiO5omL44KS6Kqt44KB44Gq44GL44Gj44Gf6aasPC90ZD48dGQgY2xhc3M9IiR7am1pc3M/ImJhZCI6Imdvb2QifSI+JHtqbWlzc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPuiqv+aVmeW4q+OCkuiqreOCgeOBquOBi+OBo+OBn+mmrDwvdGQ+PHRkIGNsYXNzPSIke3RtaXNzPyJiYWQiOiJnb29kIn0iPiR7dG1pc3N96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7jgrPjg7zjgrnjgpLoqq3jgoHjgarjgYvjgaPjgZ/jg6zjg7zjgrk8L3RkPjx0ZCBjbGFzcz0iJHtub0NvdXJzZT8iYmFkIjoiZ29vZCJ9Ij4ke25vQ291cnNlfTwvdGQ+PC90cj4KIDx0cj48dGQ+44Kq44OD44K644KS5Y+W5b6X44Gn44GN44Gf44Os44O844K5PC90ZD48dGQ+JHtuT2Rkc33vvI8ke3JzLmxlbmd0aH3vvIjopIfli53jga7lrp/jgqrjg4PjgrogJHtwUmVhbH3jg6zjg7zjgrnvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmmrO+8iTwvdGQ+PHRkPiR7aG1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDLotbDku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmojuaJi++8iTwvdGQ+PHRkPiR7am1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDXpqI7kuZfku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPuWtpue/kuODh+ODvOOCv+OBruacgOe1guaXpTwvdGQ+PHRkPiR7ZXNjKFdLLnN0b3JlSW5mbyYmV0suc3RvcmVJbmZvLmxhc3R8fCItIil9PC90ZD48L3RyPjwvdGJvZHk+PC90YWJsZT5gOwogY29uc3QgZ2FwPVdLLnN0b3JlSW5mbyYmV0suc3RvcmVJbmZvLmxhc3QmJldLLmRhdGVzWzBdP01hdGgucm91bmQoKG5ldyBEYXRlKFdLLmRhdGVzWzBdKS1uZXcgRGF0ZShXSy5zdG9yZUluZm8ubGFzdCkpLzg2NGU1KTpudWxsOwogaWYoZ2FwIT1udWxsJiZnYXA+MTApaCs9YDxkaXYgY2xhc3M9ImJhbm5lciB3biI+5pyA5paw44Gu5oiQ57i+44GMJHtnYXB95pel5YiG5YWl44Gj44Gm44GE44G+44Gb44KT44CC44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBi+OCieOAgeOCguOBhuS4gOW6puS6iOaDs+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiBpZihycy5sZW5ndGgmJmhtYXRjaDxob3JzZXMqLjQpaCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+6YGO5Y6744OH44O844K/44Go54Wn5ZCI44Gn44GN44Gf6aas44GM5bCR44Gq44KB44Gn44GZ44CC6Iul6aeS5oim5Lit5b+D44Gu5pel44Gv5q2j5bi444Gn44GZ44GM44CB44Gd44GG44Gn44Gq44GR44KM44Gw6aas5ZCN44Gu6KGo6KiY44GM5ZCI44Gj44Gm44GE44Gq44GE5Y+v6IO95oCn44GM44GC44KK44G+44GZ44CCPC9kaXY+JzsKIGNvbnN0IG9uPVdLLm9kZHNOb3Rlc3x8e307CiBpZihPYmplY3Qua2V5cyhvbikubGVuZ3RoKXtoKz1gPGgzPuOCquODg+OCuuWPluW+l+OBruWGheioszwvaDM+PGRpdiBjbGFzcz0ic3RhdHVzIj4ke1dLLmRhdGVzLm1hcChkPT5gJHtkYXlMYWJlbChkKX1cbiR7KG9uW2RdfHxbXSkubWFwKGVzYykuam9pbigiXG4iKX1gKS5qb2luKCJcblxuIil9PC9kaXY+YH0KIGgrPWA8aDM+6ZaL5YKs5aC044GU44GoPC9oMz48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6ZaL5YKs5aC0PC90aD48dGg+44Os44O844K5PC90aD48dGg+54q25oWLPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgeCBvZiBXSy5kaWFnKXsKICBjb25zdCBwcm9icz1bXTtpZih4LmVycilwcm9icy5wdXNoKHguZXJyKTtpZih4LmJhZClwcm9icy5wdXNoKGDlh7rotbDppqzjgpLoqq3jgoHjgarjgYTjg6zjg7zjgrkgJHt4LmJhZH1gKTtwcm9icy5wdXNoKC4uLih4Lmlzc3Vlc3x8W10pKTsKICBoKz1gPHRyPjx0ZD4ke2VzYyhkYXlMYWJlbCh4LmQpKX0gJHtlc2MoeC5uYW1lKX08L3RkPjx0ZD4ke3gub2t9LyR7eC5yYWNlc308L3RkPjx0ZCBzdHlsZT0idGV4dC1hbGlnbjpsZWZ0Ij4ke3Byb2JzLmxlbmd0aD9gPHNwYW4gY2xhc3M9ImJhZCBzbWFsbCI+JHtwcm9icy5tYXAoZXNjKS5qb2luKCI8YnI+Iil9PC9zcGFuPmA6JzxzcGFuIGNsYXNzPSJnb29kIj7llY/poYzjgarjgZc8L3NwYW4+J30ke3guY29kZT9gIDxidXR0b24gY2xhc3M9Im1pbmkgc3ViIiBkYXRhLXJsPSIke2VzYyh4LmQpfXwke2VzYyh4LmNvZGUpfXwke2VzYyh4Lm5hbWUpfSI+5YaN5Y+W5b6XPC9idXR0b24+YDoiIn08L3RkPjwvdHI+YDsKIH0KIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIGVsLmlubmVySFRNTD1oOwogZWwucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtcmxdIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9YXN5bmMoKT0+ewogIGNvbnN0IFtkLGNvZGUsbmFtZV09Yi5kYXRhc2V0LnJsLnNwbGl0KCJ8Iik7Yi5kaXNhYmxlZD10cnVlO3drTXNnKGAke2R9ICR7bmFtZX0g44KS5YaN5Y+W5b6X5Lit4oCmYCk7CiAgdHJ5e2F3YWl0IGxvYWRWZW51ZUludG8oYmFzZVVybCgpLGQse3ZlbnVlQ29kZTpjb2RlLHZlbnVlTmFtZTpuYW1lfSk7YXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlVXJsKCksZCk7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKTt3a01zZygi5YaN5Y+W5b6X44GX44G+44GX44GfIil9CiAgY2F0Y2goZSl7d2tNc2coIuWGjeWPluW+l+OCqOODqeODvO+8miIrZS5tZXNzYWdlKX0KIH0pOwp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5pON5L2cCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KZnVuY3Rpb24gc2hvd1RhYih0KXtkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIudmlldyIpLmZvckVhY2godj0+di5jbGFzc0xpc3QudG9nZ2xlKCJvbiIsdi5pZD09PXQpKTtkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIjdGFicyBidXR0b24iKS5mb3JFYWNoKGI9PmIuY2xhc3NMaXN0LnRvZ2dsZSgib24iLGIuZGF0YXNldC50YWI9PT10KSl9CmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiN0YWJzIGJ1dHRvbiIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5zaG93VGFiKGIuZGF0YXNldC50YWIpKTsKJCgid2tHbyIpLm9uY2xpY2s9d2Vla2VuZEdvOwokKCJ3a09kZHMiKS5vbmNsaWNrPW9kZHNPbmx5OwokKCJia09uZSIpLm9uY2xpY2s9YXN5bmMoKT0+ewogaWYoQksuYnVzeSlyZXR1cm47CiBpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7CiAgY29uc3QgcD1wcm9tcHQoIuODkOODg+OCr+OCouODg+ODl+eUqOOBruODkeOCueODleODrOODvOOCuu+8iDjmloflrZfku6XkuIrvvInjgpLmsbrjgoHjgablhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgILlvqnlhYPjga7jgajjgY3jgavjgoLlkIzjgZjjgoLjga7jgYzlv4XopoHjgafjgZnjgIIiKTsKICBpZighcClyZXR1cm47QksucGFzcz1wLnRyaW0oKTtCSy5pZD0iIjtia1NhdmVTZXR0aW5ncygpOyQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7CiAgaWYoQksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOBrzjmloflrZfku6XkuIrjgavjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybn0KIH0KIGF3YWl0IHJ1bkJhY2t1cChmYWxzZSk7Cn07CiQoImRiZ0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgiZGJnT3V0IiksYmFzZT1iYXNlVXJsKCk7CiBpZighV0suZGF0ZXMubGVuZ3RoKXtvdXQudmFsdWU9IuWFiOOBq+OAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIiO3JldHVybn0KIG91dC52YWx1ZT0i6Ki65pat5Lit4oCmIjskKCJkYmdHbyIpLmRpc2FibGVkPXRydWU7Y29uc3QgbGluZXM9W2Dlj5blvpfml6UgJHtXSy5kYXRlcy5qb2luKCIsIil9YF07CiB0cnl7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogICBjb25zdCBjb2Rlcz1bLi4ubmV3IFNldCgoV0suY2FyZHNbZF18fFtdKS5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKTsKICAgZm9yKGNvbnN0IHYgb2YgY29kZXMpewogICAgY29uc3QgcnM9V0suY2FyZHNbZF0uZmlsdGVyKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKT09PXYpOwogICAgY29uc3QgcT1ycy5tYXAocj0+ci5xdWFsaXR5KS5maWx0ZXIoQm9vbGVhbik7CiAgICBsaW5lcy5wdXNoKGBcbuKWoCR7ZH0g6ZaL5YKs5aC0JHt2fe+8iCR7cnNbMF0/LnZlbnVlTmFtZXx8IiJ977yJ44Os44O844K5JHtycy5sZW5ndGh977yP44Kz44O844K55LiN5piOJHtycy5maWx0ZXIocj0+IShyLnN1cmZhY2UmJnIuZGlzdGFuY2UpKS5sZW5ndGh977yP6aiO5omL5qygJHtxLnJlZHVjZSgocyx4KT0+cysoeC5ob3JzZXMteC5qb2NrZXlGaWxsZWQpLDApfe+8j+iqv+aVmeW4q+asoCR7cS5yZWR1Y2UoKHMseCk9PnMrKHguaG9yc2VzLXgudHJhaW5lckZpbGxlZCksMCl9YCk7CiAgICBjb25zdCBiYWQ9cnMuZmluZChyPT5yLnF1YWxpdHkmJiFyLnF1YWxpdHkub2spfHxyc1swXSxybj0oYmFkJiZiYWQucmFjZU51bWJlcil8fDE7bGluZXMucHVzaChg77yI5ZWP6aGM44Gu44GC44KL44Os44O844K5ICR7cm59UiDjgpLoqr/jgbnjgb7jgZnvvIlgKTt0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vZGVidWctZW50cnk/ZGF0ZT0ke2R9JnZlbnVlPSR7dn0mcmFjZT0ke3JufWAsWzE1MDBdKTtkZWxldGUgeC5vaztsaW5lcy5wdXNoKEpTT04uc3RyaW5naWZ5KHgpKX1jYXRjaChlKXtsaW5lcy5wdXNoKCLoqLrmlq3jgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9CiAgIH0KICB9CiB9ZmluYWxseXskKCJkYmdHbyIpLmRpc2FibGVkPWZhbHNlfQogb3V0LnZhbHVlPWxpbmVzLmpvaW4oIlxuIik7Cn07CiQoImRiZ0NvcHkiKS5vbmNsaWNrPWFzeW5jKCk9Pntjb25zdCB0PSQoImRiZ091dCIpLnZhbHVlO3RyeXthd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KTskKCJkYmdDb3B5IikudGV4dENvbnRlbnQ9IuOCs+ODlOODvOOBl+OBvuOBl+OBnyJ9Y2F0Y2goZSl7JCgiZGJnT3V0Iikuc2VsZWN0KCk7YWxlcnQoIumBuOaKnuOBl+OBvuOBl+OBn+OAguOCs+ODlOODvOOBl+OBpuOBj+OBoOOBleOBhOOAgiIpfX07CiQoImZpbGUiKS5vbmNoYW5nZT1lPT57Y29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZihmKWltcG9ydEZpbGUoZik7ZS50YXJnZXQudmFsdWU9IiJ9OwoKaWYoL15odHRwcz86Ly50ZXN0KGxvY2F0aW9uLnByb3RvY29sKSkkKCJ3dXJsIikudmFsdWU9bG9jYXRpb24ub3JpZ2luO2Vsc2UgJCgid3VybCIpLnZhbHVlPSJodHRwczovL2tlaWJhLWFpLXBheW91dHMuaHQxOTk1MDgyMi53b3JrZXJzLmRldiI7CnJlbmRlckdhdGUoKTtyZW5kZXJBbGwoKTsKKGFzeW5jKCk9Pnt0cnl7YXdhaXQgb3BlbkRCKCk7YXdhaXQgc2hvd1N0YXRlKCk7YXdhaXQgYmtJbml0KCl9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuS/neWtmOmgmOWfn+OCkumWi+OBkeOBvuOBm+OCk++8miR7ZXNjKGUubWVzc2FnZSl9XG7vvIjjg5fjg6njgqTjg5njg7zjg4jjg5bjg6njgqbjgrrjgafjga/kvb/jgYjjgarjgYTjgZPjgajjgYzjgYLjgorjgb7jgZnvvIk8L3NwYW4+YH19KSgpOwoKPC9zY3JpcHQ+CjwvYm9keT48L2h0bWw+Cg==";
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
      return errorResponse("見つかりません: " + p, 404);
    } catch (error) {
      return errorResponse(error?.message || error, 500);
    }
  }
};
