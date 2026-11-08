/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-08-rebuild-8";

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
  "192": "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAMx0lEQVR42u2de1xMeR/Hz0xDcq0sGy/rbotcklwS1i4ilNLq4tKicieXeIhosRIWj/vlyWXXIvfWWmKJlGtIWNeZZtKSakqlIWp6/sjjcanM+Z0zZ84583n/OTPfc37nnPd8v7/fufyOxNzKhgKAFCl2AYBAAAIBCAQgEAAQCEAgAIEABAIAAgEIBCAQgEAAQCDAMjI+NMJp1iUcCTISlnUxbAMkhrofCNKIQyauBYI3IjOJI4HgjVhN4kKgz9pj8EIuXAy+b/UrUAWbB2nEsbf1KFCZ2wNvDGWSnva8XgSCOsajEfsCfdpuqMMrjdg9HFLYY2wDMXZHxFLYA4d4UcI+ahPU4X85Y+UYSWGP0aYiVvKQFPbAIR51omGPELtEhhQIF7nEN87nTiAULxQyqZ7aBIykkJEL9L62sEfoDhEnISlze4Axd4ak7IoMjK2Q4akMwAiSSxni6/1sXb+8caOvaIW8KNB4eI8WX/Gie0Bl+A9RFGXbyrqlTQtaIbl5+dhvKGGAc4Ewesd4HhkIoIQBCASMTiB0gNANQgYCKGEAAgEIBAAEAhAIQCAgVPh1NV4qlUbv3879ehs1bEA3pFrVqkcP7jTIXrr/QB48ZyEEKgOJRNKtaydh/PNkJoZqahVTU5QwgD4QABAIQCAAgQAEAhAIAAgEIBCAQAACAQCBAAQCEAiIF8HPztGslWN2znPhtt+urW1szAFkIIASBgAEAhAIQCAAgQCAQAACAQgEIBAAEAjoAdHOVN+/X68ZQWMVCpU8RSVXqBQpKrlC+Tw3j8s2VK1qZtfW1sG+XQf7tllZ6hmzF0IgwdDBro29XRt7uzbvf5id81wuV/5PKaVcoZKnqF68KGAtn0ulLZo3KTXGwb5dK5sWJiYmpV+ps3OC5ywqKSmBQMKgtW0ZL5GxtDC3dLDr6GD3/ocZmWq5QilXKOUpqhMnY+/df0RrRXXr1O5g386hfdsO9u3s7VrXqFG9zJ/VtrT4ukXT+w/kEEiPFBcX93MbRiskLz+/HIGsdTegbp3ajp07UBQllyt1FKjXt92H+Xg42Lf7qkF9HVfk5NjpU4EeylPobvKLggIIVC6Xr15nvhDzWjXr17MiCEy8nqzjLxvUt/Jwc6G1cCfHjtt27vnow4ICDSubjFGY3uvXZ3ma/uxp+jMdfxx/8Qrd5Xdz7IhhvDCwbWVNEKV7+qEoSq5Qpadn0Ost1f2iedPGEEgIGYhIoOs3kmn9PuHiVbqr6O7UGQIJALu2tvrOQBRFxV+gXcX6OX8LgfiOpYU5QQnTarU3bt7Wt0Df9HCsXr0aBOI13Z06SyQSulH3H8gLCjS0Qh4plBkZWbRCTCtXdu7VAwLxmm+6k7yHim79Ik5CA1z6QCBe06ObI5FASdwI5Nyrh2nlyhCIp9SvZ9WsaSOCwLNxFwmiYuMu0A2pXr1aj+5dIJCo6teDh/LUx/8QBCpVjwkubw0UURUTn0Ak9euv2HjiNR6POUM3xN21r5lZFQjEO2Qyk+96OhEEnj5znlygU7F0Q2rWrOHu2g8C8TD9dK3zRW26Ua9evUq4lEi80sRrN7PU2XSjRg73gkC8w8tzIEHU+YQrhYWFxCvVarUn/zpHN6pTx/YtbVpAIB5hZlZlQL/eBIGnzsQxXPWJk7EEUT8MGwKBeET/fr2qVatK0gGKPc9w1WfOJRS+fk03ynvIIFM+vbjJ2AUa4kFSv1KUqYqUVIarLijQxCdcphtlXqumu2tfCMQLLC3Mv+vZjSAw+o+TrDQg+o8YgqigiQEEl+0gkB7Sj6drpUokt+dGHYhmpQFHjsa8evWKblRLmxZuA5whkIGRyUwmjh1JEHjz1t90n8Eoj/z8F8eOnyYInDV9gqCTkBgE8nQfoPujER+kn/3RLDZjz74jBFGtWn7t2r8PBDIYEolk6qRAgsDi4uKDR46x2JLYuAt075IWQRISvEB9+/S0sW5OMvY+m5CRqWaxJVqtNurgUYJA21bWA116QyDDMI0o/VAUtfdANOuN2bPvMFlgyKwpMpkJBOKarl0cOnVsT9bn/fPEGdbbc/+BPCn5DkGgjXXzCWNGQiCuez/zQ6ZxOerWhd/2HiILnB08iWwoAIEIGe47uHNHe7LYTf/5RU+t2h11mGwSGTOzKsuXhEIgjqhtaRE2L5gs9tTpuL/vPtBTwzSal5E7dhMPCAQ3pBeqQD+GBltamJPFrl63Va9t2xK5i+DaaikRP80V1oNjghSoS6cOQ709yGITrydfYHD7mC5kZKrJTipSFFXP6suFocEQSI/IZCarloURn3lbvXYLB41cv3G7Vqslix3l5+Pl6QaB9EXIzClkZw4pinooTzlOdPMXXR4plH/GkJ8mWL38R7IJRiDQZ3Ab4Dx1ciBx+NoNkcSJgS5rNkQSx5qZVfk1ck2tmjUgEJvYWDff8O9w4uKVnp4Rtf93zlp7NTGJYP6XdzRp3HDzumX8v0YmGIFq1ayxa9s6sptW3w7clqx8/eYNl22eFxbBZFrWvn16zpw2HgKx0UqpdOuGFWTPLL8dfF27GXXgd46bnZR8h3g4Vsrs4En+I30hEFNC50zrw2BWFK1WO2vuYoPM0bwwfJVG85I4XCKRrAifHzBqKAQiZ0HI9KmTApgsYdeeQ3Qnj2KLZ88yV65heuJg+ZLQMf7DIRDJ/y9i8Vwmwy6KonLz8heFrzLgVqzbtP1x2hOGC4lYPHdcoB8EotfvWbtyMfN/XvjytQSPHrNIYWFh2OIVzJcTvnDO5PGjIZBOyGQmWzesGOYzmOFy7t1/RHxpk0UORR+/dOUaCz2q+TMjN63k1cUyPgpkYV5r944Ngwe5MFxOUVHxlODQoqJiPmzUxKkhdOdgLJPBg1zOnTzUtnVLCFQ23Z06J8RG92FjJspF4auuJibxZLsUKakzQxaxsqimTRqePLaXJ8N7HglUqZJsQcj0I/u21bP6kvnSTseeX7txG6/+G3v2HTl4mJ3nQEwrV14RPn/dqp8g0FuaNW0Uc3TP1MmBUikLTUpPzxg3eTYPX8417V9hZHPplXmCYEvkLghEURRVt07tU8ei2rdrzcrStFpt4MSZhh15lUd+/ouACcHMu2WP0570dRuafPsuBKIoisrIVHuPGMfWU1oRP68nmH2XM64mJkX8vJ7JElSpaQM8RqhS09AH+mC3Og/0kStUDJcTF39pxepNFL9ZuWYz8aREWerswT7+zM9MirATrUpN6+vqyyQt37pzz89/Cmd3/DApsn4BQYnXbtIN1Gheeg8fx3xCI9EO49XZOW6eP1y7QfLWgYfyFE+fgNy8fEoIaDQvvYaPpTXHdFFRsV9A0PWkW7zaEN6dB8rNy/fw9qf7FsjHaU/ch4zOzFJTwiHnea6HN41iFBQcynw2PvELVDpU8fQN1L0jnJGRNWjIqCdP0ymh8TT92WBvf10GjFu3/bY76jAPN4Gnr/0uKNB4jxh3eG/kZx99z3me6+49OkWZSgmTRwrlkKFjjh7cWcEVrsRrN+eGLf3AvNlljDbqLW3Effv5ezW+tJdw+869iuvd976Bd+89pIRMUvKd74eOUWfnlPltZpbaLyDozZuid+qUaU/FXxmjQKV+ePoGlDe2fyhP6e3ixbdOJRmXr17v5eL16Xx7JSUlAeODS98lraMfHGvE9zsSMzLV7l6jPn0b9+nY8737ez9SKCmxoEpNc3b1PXX6g1nPt0Tuiou/VF7NqlgjCPSWtH+eeg0f9/69EOs37/AeMT5PICN2WqMHH7/x6zfveKfUwvBVxDZw45Awbqq/feee//gZJSUlha9fTwiaMy8sori4mBIjWq12XljElBnzXr95ExQcqtG8ZOIBBw7JhLJnY06dnbtgaeKNZP7c4qM/ft19MC7+Mk+udokhA5WycesvxmDPu/rFSgrRdxKSUgBAIFHCVvLQaxKCQAACAaEIlLDs/y/Vdpp1CbtPNLx/NN8/yshAACUMQCAAgdAN4hq27u/57HKIO0DIQAAlDEmIkzTGpkCoYhjAIwMZRRLi4C5pKbsKA/44pEsU82NHKBBBrgNcOkTgHNkxlZhb2RiqfAICPntpXXd1WDl8rPWBUMg4S0XlKVLBV/o7Xowy0KftQB4S3MiL4VFjmoFgjNBheASlelUb8D/9GH4Y/5HCcMhIihebGQgOGac9LHSiK/YGPSTeli22Dg2bfaBP24RUJG572O9EwyGjsoflElaxNChnfBhtsX4U9CIQNDIGdfQuUMX1CyaJY2/rVyAdu0GQSbj7lguB0JU2FBz8MzkSCCaJzBuDCQSTxOGN4QWCTMKVhncCAeGCpzIABAIQCEAgAIEAgEAAAgEIBCAQABAIQCAAgQAEAqAM/guLgPiW96QH6gAAAABJRU5ErkJggg==",
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGRpdiBpZD0iYmtTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2PgogPGRpdiBpZD0iZGF0YVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+CjwvZGl2PgoKPGRpdiBjbGFzcz0idGFicyIgaWQ9InRhYnMiPgogPGJ1dHRvbiBkYXRhLXRhYj0idkF4aXMiIGNsYXNzPSJvbiI+6LaF6YmE5p2/PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2RXYiPuacn+W+heWApDwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlVwc2V0Ij7ms6LkubHluqY8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZIb2xlIj7nqbTppqw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZSYWNlcyI+5YWo44Os44O844K5PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U3VtIj7lj5bjgorovrzjgb/nirbms4E8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZUZXN0Ij7mpJzoqLw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZTZXQiPuioreWumjwvYnV0dG9uPgo8L2Rpdj4KCjxkaXYgaWQ9ImdhdGUiPjwvZGl2PgoKPGRpdiBpZD0idkF4aXMiIGNsYXNzPSJ2aWV3IG9uIGNhcmQiPjxkaXYgY2xhc3M9InNtYWxsIj7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgII8L2Rpdj48L2Rpdj4KPGRpdiBpZD0idkV2IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlVwc2V0IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idkhvbGUiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2UmFjZXMiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2U3VtIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KCjxkaXYgaWQ9InZUZXN0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7lm57lj47njofjga7mpJzoqLzvvIjmiZXmiLvjgaTjgY3jg7vmmYLns7vliJfvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruaIkOe4vuOBqOaJleaIu+OBp+OAgeOAjOOBneOBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBoOOBkeOAjeOCkuS9v+OBhuODkOODg+OCr+ODhuOCueODiOOCkuOBl+OBvuOBme+8iOWQhOODrOODvOOCuTEwMOWGhu+8ieOAguOBk+OBk+OBpzxiPuWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBruWbnuWPjueOh+OBjDEwMCXjgpLotoXjgYjjgIHoqqTlt67jga7luYXjgpLlvJXjgYTjgabjgoIxMDAl5Lul5LiKPC9iPuOBqOeiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBoOOBkeOBjOOAgeeUu+mdouS4iuOBp+OAjOaknOiovOa4iOOBv+OAjeOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJidEdyYWRlIiBjbGFzcz0ic3ViIj7ph43os57jgaDjgZHvvJrjgrDjg6zjg7zjg4noo5zmraPjgYLjgoov44Gq44GX44KS5q+U6LyDPC9idXR0b24+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5rOi5Lmx5bqm44Gu5L+h6aC85bqm44KS5LiK44GS44KL77yI5YaN5qCh5q2j77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7pgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgavlho3nj77jgZfjgIHms6LkubHluqbjga7kuojmuKzjgajlrp/pmpvjga7ms6LkubHnjofjgpLnqoHjgY3lkIjjgo/jgZvjgb7jgZnjgILjgrPjg7zjgrnliKXvvIjplovlgqzloLTDl+iKneODgMOX6Led6Zuiw5fjgq/jg6njgrnvvInjga7pgY7ljrvms6LkubHnjofjgpLotrPjgZfjgZ/mlrDjg6Ljg4fjg6vjgpLkvZzjgorjgIE8Yj7nj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpM8L2I+44Gn5q+U44G544Gm44CB5piO56K644Gr6Imv44GE44Go44GN44Gg44GR5o6h55So44GX44G+44GZ44CC6Imv44GP44Gq44KJ44Gq44GR44KM44Gw54++6KGM44Gu44G+44G+44Gn44CB562J57Sa44GU44Go44Gu5a6f57i+546H44Gg44GR44KS5qSc6Ki844GX44Gf5pWw5a2X44Gr5beu44GX5pu/44GI44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPuaknOiovOOBrumWi+Wni+aXpSA8aW5wdXQgaWQ9InVwU3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIxLTAxLTAxIj48YnV0dG9uIGlkPSJ1cFJ1biI+5rOi5Lmx5bqm44KS5qSc6Ki844O75YaN5qCh5q2jPC9idXR0b24+PGJ1dHRvbiBpZD0idXBDbGVhciIgY2xhc3M9InN1YiI+5qiZ5rqW44Gr5oi744GZPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJ1cE91dCIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGM77yI6YGO5Y6744Os44O844K544Gu5Y+W5b6X5b6M44Gr5a6f6KGM44CC5pWw5YiG44GL44GL44KK44G+44GZ77yJPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InBheUV4cCIgY2xhc3M9InN1YiI+5omV5oi744KS5pu444GN5Ye644GXPC9idXR0b24+PGxhYmVsIGNsYXNzPSJzbWFsbCI+6Kqt44G/6L6844G/IDxpbnB1dCBpZD0icGF5SW1wIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uIj48L2xhYmVsPjwvZGl2PgogPGRpdiBpZD0iYnRPdXQiIGNsYXNzPSJzdGF0dXMiPuODh+ODvOOCv+WPluW+l+OBruOBguOBqOOBp+Wun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8L2Rpdj4KCjxkaXYgaWQ9InZTZXQiIGNsYXNzPSJ2aWV3IGNhcmQiPgogPGgyPuODkOODg+OCr+OCouODg+ODl+ioreWumu+8iENsb3VkZmxhcmXjgavkv53lrZjvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuODkeOCueODleODrOODvOOCuuOBrlNIQS0yNTbjgaDjgZHjgpLkvb/jgaPjgabkv53lrZjlhYjjgpLliIbjgZHjgb7jgZnvvIjjg5Hjgrnjg5Xjg6zjg7zjgrroh6rkvZPjga/pgIHjgorjgb7jgZvjgpPvvInjgILlkIzjgZjjg5Hjgrnjg5Xjg6zjg7zjgrrjgaflvqnlhYPjgafjgY3jgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJia1Bhc3MiIHR5cGU9InBhc3N3b3JkIiBwbGFjZWhvbGRlcj0i44OR44K544OV44Os44O844K677yIOOaWh+Wtl+S7peS4iu+8iSIgYXV0b2NvbXBsZXRlPSJvZmYiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIwMHB4Ij48YnV0dG9uIGlkPSJia1Nob3ciIGNsYXNzPSJzdWIiPuihqOekujwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJia0F1dG8iIHR5cGU9ImNoZWNrYm94IiBjaGVja2VkPiDlpInmm7TjgYzjgYLjgozjgbDoh6rli5Xjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgZnjgos8L2xhYmVsPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJia05vdyI+5LuK44GZ44GQ5beu5YiG44OQ44OD44Kv44Ki44OD44OXPC9idXR0b24+PGJ1dHRvbiBpZD0iYmtSZXN0b3JlIiBjbGFzcz0ic3ViIj7jg5Djg4Pjgq/jgqLjg4Pjg5fjgYvjgonlvqnlhYM8L2J1dHRvbj48YnV0dG9uIGlkPSJia0Z1bGwiIGNsYXNzPSJzdWIiPuOBmeOBueOBpuS/neWtmOOBl+ebtOOBmTwvYnV0dG9uPjwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPumBjuWOu+ODh+ODvOOCv+OBruiqreOBv+i+vOOBv++8iOS7u+aEj++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Lul5YmN44Gu44OQ44OD44Kv44Ki44OD44OXSlNPTu+8j+aIkOe4vkNTVuOBjOOBguOCjOOBsOiqreOBv+i+vOOCgeOBvuOBme+8iOWQjOOBmOaXpeOBr+mHjeikh+OBl+OBvuOBm+OCk++8ieOAgjwvZGl2PgogPGlucHV0IGlkPSJmaWxlIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uLC5jc3YsYXBwbGljYXRpb24vanNvbix0ZXh0L2NzdiI+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+6Ki65patPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lh7rppqzooajjga7oqq3jgb/lj5bjgorjgavllY/poYzjgYzjgYLjgovjgajjgY3jgIHplovlgqzloLTjgZTjgajjgasxUuOBruODmuODvOOCuOOBruS4rei6q+OCkuiqv+OBueOBpuS4i+OBq+WHuuOBl+OBvuOBmeOAguOCs+ODlOODvOOBl+OBpumAgeOBo+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJkYmdHbyIgY2xhc3M9InN1YiI+6Ki65pat5oOF5aCx44KS5L2c44KLPC9idXR0b24+PGJ1dHRvbiBpZD0iZGJnQ29weSIgY2xhc3M9InN1YiI+44Kz44OU44O8PC9idXR0b24+PC9kaXY+CiA8dGV4dGFyZWEgaWQ9ImRiZ091dCIgcmVhZG9ubHkgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjE0MHB4O2ZvbnQtc2l6ZToxMnB4Ij48L3RleHRhcmVhPgo8L2Rpdj4KCjwvbWFpbj4KPGRpdiBpZD0iYnVzeSI+PGRpdj48ZGl2IGlkPSJidXN5VGV4dCI+5Yem55CG5Lit4oCmPC9kaXY+PC9kaXY+PC9kaXY+CjxzY3JpcHQ+CmNvbnN0IFVFPSgoKT0+ewogLyog5a6f44OH44O844K/5qSc6Ki844Gn6YCG5Yq55p6c44Gg44Gj44Gf5oiQ5YiG77yI6aiO5omL44O76ZaT6ZqU77yJ44Gv5pei5a6a44GnT0ZGICovCiBjb25zdCBERUZBVUxUPXtqb2NrZXk6ZmFsc2UsbGF5b2ZmOmZhbHNlfTsKIGNvbnN0IGNsYW1wPSh4LGEsYik9Pk1hdGgubWF4KGEsTWF0aC5taW4oYix4KSk7CiBjb25zdCBzaWdtb2lkPXg9PjEvKDErTWF0aC5leHAoLXgpKTsKIGNvbnN0IGxvZ2l0PXA9PntwPWNsYW1wKHAsLjAwMSwuOTk5KTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwogY29uc3Qgbm49cz0+U3RyaW5nKHM/PyIiKS5ub3JtYWxpemUoIk5GS0MiKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1tcc1x1MzAwMF0rL2csIiIpLnJlcGxhY2UoL1vjg7vvvaUu77yOXC3igJDigJHigJLigJPigJTigJUn4oCZYF0vZywiIikucmVwbGFjZSgvW+KYhuKYheKWs+KWsuKXh+KXhl0vZywiIik7CiAvKiDpqI7miYvlkI3vvJrlhYjpoK3jga7mrKflrZfjgqTjg4vjgrfjg6Pjg6vjgpLpmaTjgY3jgIHjg4fjg6Djg7zjg63ihpLjg4fjg6Ag44Gr5o+D44GI44KL77yISlJB44GuIEMu44OH44Og44O844OtIOOBqOmBjuWOu+ODh+ODvOOCv+OBriDvvKPvvI7jg4fjg6Ag44KS5LiA6Ie044GV44Gb44KL77yJICovCiBjb25zdCBqbm49cz0+e2xldCB2PW5uKFN0cmluZyhzPz8iIikucmVwbGFjZSgvXGR7Mn0oPzpcLlxkKT9ccyooPzprZ3zvvYvvvYcpL2dpLCIgIikucmVwbGFjZSgvW++8iChdW17vvIkpXXswLDh9W++8iSldL2csIiAiKS5yZXBsYWNlKC8o5qCX5p2xfOe+jua1pikvZywiICIpKTt2PXYucmVwbGFjZSgvXlthLXpdKD89W+OCoS3jg7bjg7xdKS8sIiIpO3Y9di5yZXBsYWNlKC9e44OH44Og44O844OtLywi44OH44OgIik7cmV0dXJuIHZ9OwogLyog44Kv44Op44K544Gu5q616ZqO77yaMD3kuI3mmI4gLyAtMT3lnLDmlrkgLyAxPeaWsOmmrOODu+acquWLneWIqSAvIDI9MeWLnSAvIDM9MuWLnSAvIDQ9M+WLnSAvIDU944Kq44O844OX44Oz44O76YeN6LOeICovCiBjb25zdCBsZXZlbE9mTGFiZWw9dD0+e2NvbnN0IHM9U3RyaW5nKHR8fCIiKTtpZigv5Zyw5pa5fE5BUi8udGVzdChzKSlyZXR1cm4gLTE7aWYoL+aWsOmmrHzmnKrli53liKkvLnRlc3QocykpcmV0dXJuIDE7aWYoLzHli518NTAw5LiHLy50ZXN0KHMpKXJldHVybiAyO2lmKC8y5YudfDEwMDDkuIcvLnRlc3QocykpcmV0dXJuIDM7aWYoLzPli518MTYwMOS4hy8udGVzdChzKSlyZXR1cm4gNDtpZigv44Kq44O844OX44OzfO+8r++8sHxPUHzjg6rjgrnjg4bjg4Pjg4l86YeN6LOefO+8p3xHWzEyM0ldL2kudGVzdChzKSlyZXR1cm4gNTtyZXR1cm4gMH07CiBjb25zdCBsZXZlbE9mUHJpemU9cD0+e3A9TnVtYmVyKHApO3JldHVybiAhKHA+MCk/MDpwPD03MDA/MTpwPD05MDA/MjpwPD0xMzAwPzM6cDw9MTgwMD80OjV9OwogLyog4piF44Kw44Os44O844OJ77yI5qC877yJ77yaMD3kuI3mmI4v5LiL57SaIDE9T1Djg7vjg6rjgrnjg4bjg4Pjg4kgMj1HMyAzPUcyIDQ9RzHjgIIKICAgIOW+k+adpeOBryBHMS9HMi9HMy9PUCDjgpLjgZnjgbnjgabjgIw144CN44Gr5r2w44GX44Gm44GE44Gf44Gf44KB44CBRzPli53jgaHjgYwgRzEg44Gn44KC5Ymy5byV44GV44KM44Gq44GL44Gj44Gf44CCCiAgICDliKTlrprpoIbvvJrjg6njg5njg6vvvIhORktD5b6MIEdJL0dJSS9HSUlJL0cx44CcRzPvvInihpIgMeedgOiznumHke+8iOS4h+WGhu+8ieKGku+8iOWvvuixoeODrOODvOOCueOBruOBv++8iUcx44Os44O844K55ZCNICovCiBjb25zdCBHMV9OQU1FUz0v5aSp55qH6LOefOaciemmrOiomOW/tXzjgrjjg6Pjg5Hjg7Pjgqvjg4Pjg5d844K444Oj44OR44Oz77yjfOWuneWhmuiomOW/tXzlronnlLDoqJjlv7V844O044Kj44Kv44OI44Oq44Ki44Oe44Kk44OrfOWkp+mYquadr3zpq5jmnb7lrq7oqJjlv7V844OV44Kn44OW44Op44Oq44O8fOODgeODo+ODs+ODlOOCquODs+OCunzjgrnjg5fjg6rjg7Pjgr/jg7zjgrp844Oe44Kk44Or44OB44Oj44Oz44OU44Kq44Oz44K344OD44OXfOOCqOODquOCtuODmeOCueWls+eOi+adr3znp4voj6/os5586I+K6Iqx6LOefOahnOiKseiznnzjgqrjg7zjgq/jgrl85YSq6ae/54md6aasfOaXpeacrOODgOODvOODk+ODvHzmnbHkuqzlhKrpp79855qQ5pyI6LOefE5IS+ODnuOCpOODq3zpmKrnpZ7jgrjjg6Xjg5njg4rjgqTjg6t85pyd5pel5p2vfOODm+ODvOODl+ODleODqy87CiBjb25zdCBncmFkZVRpZXI9KHRleHQscHJpemUsYnlOYW1lKT0+e2NvbnN0IHM9U3RyaW5nKHRleHR8fCIiKS5ub3JtYWxpemUoIk5GS0MiKTsKICBpZigv6Zqc5a6zfOOCuOODo+ODs+ODl3xKXC4/XHM/Ry9pLnRlc3QocykpcmV0dXJuIDA7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJSUl8MykoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDI7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJSXwyKSg/IVtBLVphLXowLTldKS8udGVzdChzKSlyZXR1cm4gMzsKICBpZigvKD86XnxbXkEtWmEtel0pRyg/Okl8MSkoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDQ7CiAgY29uc3QgcD1OdW1iZXIocHJpemUpO2lmKHA+MClyZXR1cm4gcD49MTAwMDA/NDpwPj01MDAwPzM6cD49MzUwMD8yOnA+PTE4MDA/MTowOwogIGlmKGJ5TmFtZSYmRzFfTkFNRVMudGVzdChzKSlyZXR1cm4gNDsKICBpZigv44Oq44K544OG44OD44OJfOOCquODvOODl+ODs3zvvK/vvLB8XGJPUFxiLy50ZXN0KHMpKXJldHVybiAxOwogIHJldHVybiAwfTsKIGNvbnN0IGlzSnJhVmVudWU9Yz0+L14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKGN8fCIiKSk7CiBjb25zdCBzdXJmQ29kZT1zPT57cz1TdHJpbmcoc3x8IiIpO3JldHVybiAv6IqdfHR1cmYvaS50ZXN0KHMpPzE6L+ODgHxkaXJ0L2kudGVzdChzKT8yOi/pmpx8anVtcC9pLnRlc3Qocyk/MzowfTsKIGNvbnN0IGRudW09ZD0+TnVtYmVyKFN0cmluZyhkfHwiIikucmVwbGFjZSgvXEQvZywiIikuc2xpY2UoMCw4KSl8fDA7CiBmdW5jdGlvbiBwYXJzZURhdGUocyl7CiAgcz1TdHJpbmcoc3x8IiIpO2xldCBtPXMubWF0Y2goLyhcZHs0fSlcRHswLDR9KFxkezEsMn0pXER7MCw0fShcZHsxLDJ9KS8pOwogIGlmKCFtKXJldHVybiIiO3JldHVybiBgJHttWzFdfS0ke21bMl0ucGFkU3RhcnQoMiwiMCIpfS0ke21bM10ucGFkU3RhcnQoMiwiMCIpfWA7CiB9CiBmdW5jdGlvbiBjc3ZSb3dzKHRleHQpewogIGNvbnN0IGxpbmVzPVN0cmluZyh0ZXh0fHwiIikucmVwbGFjZSgvXlx1RkVGRi8sIiIpLnNwbGl0KC9ccj9cbi8pLmZpbHRlcih4PT54LnRyaW0oKSk7CiAgaWYoIWxpbmVzLmxlbmd0aClyZXR1cm5bXTsKICBjb25zdCBzcGxpdD1sPT57Y29uc3QgYT1bXTtsZXQgYz0iIixxPWZhbHNlO2ZvcihsZXQgaT0wO2k8bC5sZW5ndGg7aSsrKXtjb25zdCBjaD1sW2ldOwogICBpZihjaD09PSciJyl7aWYocSYmbFtpKzFdPT09JyInKXtjKz0nIic7aSsrfWVsc2UgcT0hcX1lbHNlIGlmKGNoPT09IiwiJiYhcSl7YS5wdXNoKGMpO2M9IiJ9ZWxzZSBjKz1jaH1hLnB1c2goYyk7cmV0dXJuIGF9OwogIGNvbnN0IGhlYWQ9c3BsaXQobGluZXNbMF0pLm1hcCh4PT54LnRyaW0oKSk7Y29uc3Qgb3V0PVtdOwogIGZvcihsZXQgaT0xO2k8bGluZXMubGVuZ3RoO2krKyl7Y29uc3QgYT1zcGxpdChsaW5lc1tpXSksbz17fTtmb3IobGV0IGo9MDtqPGhlYWQubGVuZ3RoO2orKylvW2hlYWRbal1dPWFbal0/PyIiO291dC5wdXNoKG8pfQogIHJldHVybiBvdXQ7CiB9CiBjb25zdCBmPXY9Pntjb25zdCBuPXBhcnNlRmxvYXQoU3RyaW5nKHY/PyIiKS5yZXBsYWNlKC8sL2csIiIpKTtyZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pP246bnVsbH07CiAvKiDjg5Djg4Pjgq/jgqLjg4Pjg5cvQ1NW44GuMeihjOKGkui7vemHj+ihjCAqLwogY29uc3QgY2xlYW5Ucj10PT5TdHJpbmcodHx8IiIpLnJlcGxhY2UoL1xzKy9nLCIgIikudHJpbSgpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw2fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKD865qCX5p2xfOe+jua1pnzlnLDmlrl85aSW5Zu9fOaLm+W+hSlccypb44O7772lXT8vZywiICIpLnJlcGxhY2UoL1vjg7vvvaVdL2csIiAiKS5yZXBsYWNlKC9ccysvZywiICIpLnRyaW0oKTsKIGZ1bmN0aW9uIHRvUm93KG8pe2NvbnN0IF9yPXRvUm93MChvKTtfci50cmFpbmVyPWNsZWFuVHIob1si6Kq/5pWZ5birIl18fG8udHJhaW5lcnx8IiIpO19yLmdyZD1ncmFkZVRpZXIoU3RyaW5nKG9bImNsYXNzIl18fG8uY2xzfHwiIikrIiAiK1N0cmluZyhvWyLjg6zjg7zjgrnlkI0iXXx8by5yYWNlX25hbWV8fG8ucmFjZW5hbWV8fCIiKSxudWxsLGZhbHNlKTtyZXR1cm4gX3J9CiBmdW5jdGlvbiB0b1JvdzAobyl7CiAgY29uc3Qgc2E9U3RyaW5nKG9bIuaAp+m9oiJdfHwiIik7Y29uc3QgYW09c2EubWF0Y2goLyhcZCspLyk7CiAgcmV0dXJue3JhY2VJZDpTdHJpbmcob1siIl0/P28ucmFjZV9pZD8/b1siVW5uYW1lZDogMCJdPz8iIiksZGF0ZTpwYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSksCiAgIG5hbWU6U3RyaW5nKG9bIummrOWQjSJdfHxvLmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOm5uKG9bIummrOWQjSJdfHxvLmhvcnNlKSxqb2NrZXk6am5uKG9bIumojuaJiyJdfHxvLmpvY2tleSksam5hbWU6U3RyaW5nKG9bIumojuaJiyJdfHxvLmpvY2tleXx8IiIpLnRyaW0oKSxmaW5pc2g6ZihvWyLnnYDpoIYiXT8/by5maW5pc2gpLAogICBkaXN0OmYoby5jb3Vyc2VfbGVuPz9vWyLot53pm6IiXT8/by5kaXN0YW5jZSl8fDAsc3VyZjpzdXJmQ29kZShvLnJhY2VfdHlwZXx8b1si6Iqd44OAIl18fG8uc3VyZmFjZSksCiAgIGFnZTphbT9OdW1iZXIoYW1bMV0pOm51bGwsbnVtOmYob1si6aas55WqIl0pLHBvcDpmKG9bIuS6uuawlyJdKSxvZGRzOmYob1si5Y2Y5YudIl0pLAogICBsdmw6KCgpPT57Y29uc3QgaWQ9U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/PyIiKTtpZigvXlxkezEyfSQvLnRlc3QoaWQpJiYhaXNKcmFWZW51ZShpZC5zbGljZSg0LDYpKSlyZXR1cm4gLTE7cmV0dXJuIGxldmVsT2ZMYWJlbChvWyJjbGFzcyJdfHxvLmNscyl9KSgpfTsKIH0KIC8qIOaIkOe4vuOCueODiOOCou+8iOaXpeS7mOaYh+mghuOBqyBhZGQg44GZ44KL77yJICovCiBmdW5jdGlvbiBTdG9yZSgpe3RoaXMuaD1uZXcgTWFwKCk7dGhpcy5qPW5ldyBNYXAoKX0KIFN0b3JlLnByb3RvdHlwZS5hZGQ9ZnVuY3Rpb24ocil7CiAgaWYoci5maW5pc2g9PW51bGx8fCFyLmhvcnNlKXJldHVybjsKICBjb25zdCB0Mz1yLmZpbmlzaD49MSYmci5maW5pc2g8PTM/MTowOwogIGxldCBoPXRoaXMuaC5nZXQoci5ob3JzZSk7aWYoIWgpdGhpcy5oLnNldChyLmhvcnNlLGg9e246MCx0b3AzOjAsd2luOjAsc3VtOjAsbGFzdDoiIixydW5zOltdLGx2Ont9fSk7CiAgaC5uKys7aC50b3AzKz10MztpZihyLmZpbmlzaD09PTEpaC53aW4rKztoLnN1bSs9ci5maW5pc2g7aWYoci5kYXRlPmgubGFzdCloLmxhc3Q9ci5kYXRlOwogIGNvbnN0IEw9ci5sdmx8fDA7KGgubHZbTF09aC5sdltMXXx8WzAsMF0pO2gubHZbTF1bMF0rKztoLmx2W0xdWzFdKz10MzsKICBoLnJ1bnMucHVzaChbZG51bShyLmRhdGUpLHIuZmluaXNoLHIuZGlzdCxyLnN1cmYsTCxyLmdyZHx8MF0pO2lmKGgucnVucy5sZW5ndGg+Nil7aC5ydW5zLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7aC5ydW5zLnNoaWZ0KCl9CiAgaWYoci5qb2NrZXkpe2xldCBqPXRoaXMuai5nZXQoci5qb2NrZXkpO2lmKCFqKXRoaXMuai5zZXQoci5qb2NrZXksaj17bjowLHRvcDM6MH0pO2oubisrO2oudG9wMys9dDN9CiB9OwogLyog6aiO5omL77ya5a6M5YWo5LiA6Ie04oaS77yI55+t44GE6KGo6KiY44Gq44KJ77yJ5YmN5pa55LiA6Ie044GnMeS6uuOBq+e1nuOCjOOCi+OBqOOBjeOBoOOBkeaOoeeUqCAqLwogU3RvcmUucHJvdG90eXBlLmpvY2tleT1mdW5jdGlvbihuYW1lKXsKICBpZighbmFtZSlyZXR1cm4gbnVsbDsKICBjb25zdCBqPXRoaXMuai5nZXQobmFtZSk7aWYoailyZXR1cm4gajsKICBpZihuYW1lLmxlbmd0aDwyfHxuYW1lLmxlbmd0aD40KXJldHVybiBudWxsOwogIGlmKCF0aGlzLl9qa3x8dGhpcy5famtTaXplIT09dGhpcy5qLnNpemUpe3RoaXMuX2prPVsuLi50aGlzLmoua2V5cygpXTt0aGlzLl9qa1NpemU9dGhpcy5qLnNpemV9CiAgY29uc3QgYz10aGlzLl9qay5maWx0ZXIoaz0+ay5zdGFydHNXaXRoKG5hbWUpfHwobmFtZS5sZW5ndGg+PTMmJmsuc3RhcnRzV2l0aChuYW1lLnNsaWNlKDAsLTEpKSYmbmFtZS5sZW5ndGg8PWsubGVuZ3RoKSk7CiAgcmV0dXJuIGMubGVuZ3RoPT09MT90aGlzLmouZ2V0KGNbMF0pOm51bGw7CiB9OwogY29uc3QgbGF5b2ZmPShsYXN0LHRhcmdldCk9PntpZighbGFzdClyZXR1cm4gLjU7Y29uc3QgYT0obmV3IERhdGUodGFyZ2V0KS1uZXcgRGF0ZShsYXN0KSkvODY0ZTU7CiAgcmV0dXJuIGE8MjE/LjcyOmE8NjA/LjYyOmE8MTIwPy41NTphPDI0MD8uNDg6LjQyfTsKIC8qID09PT09IOWun+e4vuOBi+OCieWtpue/kuOBl+OBn+ODouODh+ODq++8iOeJueW+tOmHj+KGkjPnnYDlhoXnjofvvIkgPT09PT0gKi8KIGNvbnN0IEZOPVsiYmlhcyIsIm9mZnNldCIsIm5sb2ciLCJub0hpc3QiLCJmUyIsImZDIiwiYXZnRiIsInIzc2hhcmUiLCJyM2F2ZyIsImxhc3QxIiwibGFzdEJpZyIsImNvbmREaWZmIiwiZmlyc3RTdXJmIiwiZ2FwU2hvcnQiLCJnYXBMb25nIiwiZ2FwVkxvbmciLCJhZ2UzIiwiYWdlNCIsImFnZTciLCJzdGVwVXAiLCJzdGVwRG93biIsIndpblJhdGUiXTsKIGNvbnN0IEZKPVsialJlbCIsImpsb2ciLCJqTWlzcyJdOwogLyog5L+C5pWw44GvIHRvb2xzL2ZpdF9tb2RlbC5qcyDjgaflrabnv5LvvIgyMDIw5bm044Cc44Gu5pmC57O75YiX44OH44O844K/77yJ44CCe30g44KS572u5o+bICovCiBjb25zdCBNT0RFTD17ImNvcmUiOlswLjA1Mjk5LDAuOTk2OTcsMC4wNDk1MSwtMC4yNDU0MywtMC41MjgxMiwwLjkxOTQ2LC0wLjUxNDc2LC0wLjM0Nzg2LC0wLjU3OTA0LC0wLjU1MTE4LDAuMTY3NzMsMS4xMTgyLC0wLjM1MzA1LC0wLjExMTI4LC0wLjIyNzI4LC0wLjQwMTI5LDAuMTM3NzEsMC4yMTY2MiwtMC4zOTY3MywtMC4zNTMwNSwwLjAwNjE3LC0wLjU5NTY0XSwiZnVsbCI6WzAuNDA0MzMsMS4zNzAwNywwLjA2MjUxLC0wLjEyMjc5LC0wLjUwMjMyLDAuODI5NzgsLTAuMzk4OTUsLTAuMzAwNzIsLTAuNTE1NTksLTAuNTI1MzIsMC4xNTgzMiwxLjA2Njk1LC0wLjM4Mzc3LC0wLjA3MjgyLC0wLjIyNTY4LC0wLjM1MSwwLjE1MDI1LDAuMjEyNTMsLTAuNDEzMzQsLTAuMzIzMTksMC4wMDcyNiwtMC45Mzc5MiwwLjUzNTU3LDAuMDAzNjUsLTAuMjA2MDVdfTsKIGZ1bmN0aW9uIGZlYXRzKHIsc3RvcmUscmFjZSxOLHdpdGhKKXsKICBjb25zdCBiPWNsYW1wKDMvTiwuMDgsLjUpLGxiPWxvZ2l0KGIpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksbj1oP2gubjowLEx0PXJhY2UubHZsfHwwOwogIGNvbnN0IHBTPSgoaD9oLnRvcDM6MCkrMypiKS8obiszKSxmUz1sb2dpdChwUyktbGI7CiAgLy8g44Kv44Op44K56KOc5q2j77ya5L2O44GE44Kv44Op44K577yI5Zyw5pa544KS5ZCr44KA77yJ44Gn44Gu5aW96LWw44Gv5Ymy44KK5byV44GN44CB6auY44GE44Kv44Op44K544Gn44Gu5Yeh6LWw44Gv5Ymy44KK5byV44GPCiAgbGV0IGZDPWZTOwogIGlmKGgmJkx0PjApe2xldCBIPTAsTT0wOwogICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhoLmx2KSl7Y29uc3QgTD1OdW1iZXIoayksW2NuLGN0XT1oLmx2W2tdO2NvbnN0IGc9TD09PTA/MDooTDwwPy0yOkwtTHQpOwogICAgSCs9Y3QqY2xhbXAoMSsuMypnLC40LDEuOCk7TSs9KGNuLWN0KSpjbGFtcCgxLS4zKmcsLjQsMS44KX0KICAgZkM9bG9naXQoKEgrMypiKS8oSCtNKzMpKS1sYn0KICBjb25zdCBydW5zPWg/aC5ydW5zOltdLHJjPXJ1bnMuc2xpY2UoLTMpLGxhc3RSPXJ1bnMubGVuZ3RoP3J1bnNbcnVucy5sZW5ndGgtMV06bnVsbDsKICBjb25zdCByM3NoYXJlPXJjLmxlbmd0aD9yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoL3JjLmxlbmd0aDowOwogIGNvbnN0IHIzYXZnPXJjLmxlbmd0aD9jbGFtcCgocmMucmVkdWNlKChhLHgpPT5hK3hbMV0sMCkvcmMubGVuZ3RoLTYpLzYsLTEsMik6MDsKICBjb25zdCBsYXN0MT1sYXN0Uj9jbGFtcCgobGFzdFJbMV0tNikvNiwtMSwyKTowLGxhc3RCaWc9bGFzdFImJmxhc3RSWzFdPj0xMD8xOjA7CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwO2xldCBjb25kRGlmZj0wLGZpcnN0U3VyZj0wOwogIGlmKHNjJiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmKCFkaXN0fHxNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApKTsKICAgaWYoY3IubGVuZ3RoKWNvbmREaWZmPShjci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoKzIqcFMpLyhjci5sZW5ndGgrMiktcFM7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKWZpcnN0U3VyZj0xfQogIGxldCBnYXA9bnVsbDtpZihoJiZoLmxhc3QmJnJhY2UuZGF0ZSlnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgY29uc3QgYT1yLmFnZXx8MDsKICBjb25zdCBzdGVwRD1sYXN0UiYmbGFzdFJbNF0+MCYmTHQ+MD9jbGFtcChMdC1sYXN0Uls0XSwtMywzKTowOwogIGNvbnN0IHg9WzEsbGIsTWF0aC5sb2coMStuKSxuPT09MD8xOjAsZlMsZkMsbj9jbGFtcCgoaC5zdW0vbi02KS82LC0xLDIpOjAscjNzaGFyZSxyM2F2ZyxsYXN0MSxsYXN0QmlnLGNvbmREaWZmLGZpcnN0U3VyZiwKICAgZ2FwIT1udWxsJiZnYXA8MjE/MTowLGdhcCE9bnVsbCYmZ2FwPjEyMD8xOjAsZ2FwIT1udWxsJiZnYXA+MjQwPzE6MCxhPT09Mz8xOjAsYT09PTQ/MTowLGE+PTc/MTowLHN0ZXBEPjA/c3RlcEQ6MCxzdGVwRDwwPy1zdGVwRDowLAogICBuPygoaC53aW4rLjMqYikvKG4rMS41KS1iKTowXTsKICBpZih3aXRoSil7Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpOwogICBpZihqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSk7eC5wdXNoKGxvZ2l0KHBKKS1sYixNYXRoLmxvZygxK2oubiksMCl9ZWxzZSB4LnB1c2goMCwwLDEpfQogIHJldHVybiB4OwogfQogY29uc3QgZG90PSh3LHgpPT57bGV0IHo9MDtmb3IobGV0IGk9MDtpPHgubGVuZ3RoO2krKyl6Kz0od1tpXXx8MCkqeFtpXTtyZXR1cm4gen07CiBjb25zdCBtb2RlbFo9KGtpbmQseCk9PmRvdChNT0RFTFtraW5kXSx4KTsKIC8qIDHpoK3jga7ntKDngrkobG9naXQp44Go44K/44Kw44CCY29tcCDjgafmiJDliIbjgpJPTi9PRkbjgafjgY3jgovvvIjmpJzoqLznlKjvvIkgKi8KIGZ1bmN0aW9uIGhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcD17fSl7CiAgY29tcD1PYmplY3QuYXNzaWduKHt9LERFRkFVTFQsY29tcCk7Y29uc3QgdXNlPWs9PmNvbXBba10hPT1mYWxzZSYmY29tcFtrXSE9PTA7CiAgY29uc3QgYj1jbGFtcCgzL04sLjEsLjUpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksaj1zdG9yZS5qLmdldChyLmpvY2tleSk7CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxuPWg/aC5uOjAsdGFncz1bXTtsZXQgej0wLGNvbmY9IuS9jiI7CiAgY29uc3QgcEg9KChoP2gudG9wMzowKSs0KmIpLyhuKzQpO3orPWxvZ2l0KHBIKTsKICBpZihuPj0yKWNvbmY9bj49NT8i6auYIjoi5LitIjtlbHNlIHRhZ3MucHVzaCh7dDoi5bGl5q205LiN6LazIixjOiJnIn0pOwogIGlmKG4+PTMpe2NvbnN0IHQzPWgudG9wMy9uLHc9aC53aW4vbjsKICAgaWYodDM+PS40MCYmdzw9LjIwKXRhZ3MucHVzaCh7dDpg5ZaE5oim5Z6LIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGVsc2UgaWYodDM+PS40NSl0YWdzLnB1c2goe3Q6YOWuieWumiAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBpZih1c2UoImF2ZyIpJiZoLnN1bS9uPD01KXorPS4xMn0KICBjb25zdCByYz1ydW5zLnNsaWNlKC0zKTsKICBpZih1c2UoInJlY2VudCIpJiZyYy5sZW5ndGg+PTIpe2NvbnN0IGMzPXJjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgsYXZnPXJjLnJlZHVjZSgocyx4KT0+cyt4WzFdLDApL3JjLmxlbmd0aDsKICAgeis9LjIyKihjMy9yYy5sZW5ndGgtcEgpKjM7aWYoYzM+PTIpdGFncy5wdXNoKHt0OmDov5Eke3JjLmxlbmd0aH3otbDjgacke2MzfeWbnjPnnYDlhoVgLGM6ImIifSk7CiAgIGNvbnN0IGxhc3Q9cnVuc1tydW5zLmxlbmd0aC0xXTsKICAgaWYobGFzdCYmbGFzdFsxXT49OCYmbj49NCYmaC50b3AzL24+PS4zNSl7eis9LjE1O3RhZ3MucHVzaCh7dDpg5YmN6LWwJHtsYXN0WzFdfeedgOOBi+OCieW3u+OBjei/lOOBl+S9meWcsGAsYzoibyJ9KX0KICAgaWYoYXZnPD00JiZyYy5sZW5ndGg+PTMpeis9LjA4fQogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDsKICBpZih1c2UoImNvbmQiKSYmc2MmJmRpc3QmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiZNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSl7ei09LjM1O3RhZ3MucHVzaCh7dDpgJHtzYz09PTE/IuWIneOBruiKnSI6IuWIneOBruODgOODvOODiCJ977yI6YGO5Y676LWw44Gv5Yil6aas5aC077yJYCxjOiJvIn0pfQogICBpZihjci5sZW5ndGg+PTIpe2NvbnN0IHQzPWNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgscGM9KHQzKzIqcEgpLyhjci5sZW5ndGgrMik7CiAgICB6Kz1jbGFtcCgyKihwYy1wSCksLS41LC41KTtpZih0Mz49Mil0YWdzLnB1c2goe3Q6YOWQjOadoeS7tuOBpyR7dDN9LyR7Y3IubGVuZ3RofeWbnjPnnYDlhoVgLGM6ImIifSl9fQogIGlmKHVzZSgiam9ja2V5IikmJmomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KSxkaj1jbGFtcCguNioobG9naXQocEopLWxvZ2l0KGIpKSwtLjQsLjUpOwogICB6Kz1kajtpZihkaj49LjI1KXRhZ3MucHVzaCh7dDpg6aiO5omL5aW96Kq/IDPnnYDlhoUke01hdGgucm91bmQoai50b3AzL2oubioxMDApfSVgLGM6ImIifSl9CiAgaWYodXNlKCJsYXlvZmYiKSYmaCYmaC5sYXN0KXtjb25zdCBnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgIHorPS42KihsYXlvZmYoaC5sYXN0LHJhY2UuZGF0ZSktLjUpO2lmKGdhcD49MTgwKXRhZ3MucHVzaCh7dDpgJHtnYXB95pel44G244KKYCxjOiJvIn0pfQogIGlmKHVzZSgiYWdlIikpe2NvbnN0IGE9ci5hZ2V8fDU7aWYoYT09PTMpeis9LjEwO2Vsc2UgaWYoYT09PTQpeis9LjA1O2Vsc2UgaWYoYT49OCl7ei09LjE1O3RhZ3MucHVzaCh7dDpgJHthfeats2AsYzoibyJ9KX19CiAgcmV0dXJue3osdGFncyxjb25mLG59OwogfQogLyogMjAyM+W5tOS7pemZjeOBruaZguezu+WIl+aknOiovOOBp+OBriDntKDjga7lpb3otbDnjofihpLnqbTjgr7jg7zjg7Plrp/nuL7vvIjlubPlnYdwLCDlrp/nuL7vvIkgKi8KIGNvbnN0IENBTD1bWzAsMC4wMV0sWzAuMDIyLDAuMDE3XSxbMC4wNDYsMC4wMjJdLFswLjA3NSwwLjA0Nl0sWzAuMTA1LDAuMDY4XSxbMC4xMzUsMC4wODJdLFswLjE2NSwwLjA5OF0sWzAuMTkzLDAuMTAzXSxbMC4yMjQsMC4xMzhdLFswLjI1OSwwLjE2MV0sWzAuMzAyLDAuMTg3XSxbMC4zNTgsMC4yMTFdLFswLjQ1NCwwLjIyOV1dOwogLyog44Kq44OD44K644Gq44GX44Oi44O844OJ77yI5Lq65rCX44Gu5Luj55CG77yd6aiO5omL6L6844G/44Gu5a2m57+S44Oi44OH44Or44Gu6aCG5L2N44Gn56m044K+44O844Oz44KS5Yik5a6a77yJ44Gu6KOc5q2j6KGo44CCMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+S9nOaIkCAqLwogY29uc3QgQ0FMX1BST1hZPVtbMCwwLjAxM10sWzAuMDIyLDAuMDIxXSxbMC4wNDYsMC4wMjhdLFswLjA3NSwwLjA1Nl0sWzAuMTA1LDAuMDg2XSxbMC4xMzUsMC4xMTFdLFswLjE2NSwwLjEzNF0sWzAuMTkzLDAuMTQ2XSxbMC4yMjQsMC4yMDFdLFswLjI1OSwwLjIxOV0sWzAuMzAxLDAuMjYxXSxbMC4zNTUsMC4yOTZdLFswLjQzOSwwLjM2N11dOwogZnVuY3Rpb24gaW50ZXJwKFQscCl7Zm9yKGxldCBpPTE7aTxULmxlbmd0aDtpKyspaWYocDw9VFtpXVswXSl7Y29uc3RbYSxiXT1UW2ktMV0sW2MsZF09VFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gVFtULmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIGNhbGliRm9yKHAsbW9kZSl7cmV0dXJuIG1vZGU9PT0ib2RkcyI/aW50ZXJwKENBTCxwKTppbnRlcnAoQ0FMX1BST1hZLHApfQogZnVuY3Rpb24gY2FsaWIocCl7Zm9yKGxldCBpPTE7aTxDQUwubGVuZ3RoO2krKylpZihwPD1DQUxbaV1bMF0pe2NvbnN0W2EsYl09Q0FMW2ktMV0sW2MsZF09Q0FMW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBDQUxbQ0FMLmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIG5vcm1hbGl6ZVRvcDMoenMsdG90YWwpe2xldCBsbz0tOCxoaT04OwogIGZvcihsZXQgaT0wO2k8NjA7aSsrKXtjb25zdCBjPShsbytoaSkvMixzPXpzLnJlZHVjZSgoYSx6KT0+YStzaWdtb2lkKHorYyksMCk7aWYocz50b3RhbCloaT1jO2Vsc2UgbG89Y30KICBjb25zdCBjPShsbytoaSkvMjtyZXR1cm4genMubWFwKHo9PnNpZ21vaWQoeitjKSl9CiAvKiBIYXJ2aWxsZeazleOBp+WLneeOh+KGkjPnnYDlhoXnjocgKi8KIGZ1bmN0aW9uIHRvcDNGcm9tV2luKHB3KXtjb25zdCBUPXB3LnJlZHVjZSgoYSxiKT0+YStiLDApLHA9cHcubWFwKHg9PngvVCksbj1wLmxlbmd0aCxvdXQ9bmV3IEFycmF5KG4pLmZpbGwoMCk7CiAgZm9yKGxldCBpPTA7aTxuO2krKyl7bGV0IHM9cFtpXTsKICAgZm9yKGxldCBqPTA7ajxuO2orKylpZihqIT09aSl7cys9cFtqXSpwW2ldLygxLXBbal0pOwogICAgZm9yKGxldCBrPTA7azxuO2srKylpZihrIT09aSYmayE9PWopcys9cFtqXSpwW2tdLygxLXBbal0pKnBbaV0vKDEtcFtqXS1wW2tdKX0KICAgb3V0W2ldPXN9cmV0dXJuIG91dH0KIC8qIOKYheagvOS4iuOBkuijnOato++8muWtpue/kua4iOOBv+ODouODh+ODq+OBr+edgOmghuOCkuOBneOBruOBvuOBvuimi+OCi+OBruOBp+OAgeS4i+S9jeOCsOODrOODvOODieOBp+OBruWlvei1sOOBjOmHjeiznuODu0cx44Gn44KC5ZCM5L6h5YCk44Gr44Gq44Gj44Gm44GE44Gf44CCCiAgICDnm7Tov5Ez6LWw44Gu44GG44GhIE9QL+mHjeiznijjgq/jg6njgrk1KeOBrui1sOOBq+OBpOOBhOOBpuOAgeS7iuWbnuOBruOCsOODrOODvOODieOBqOOBruW3ruOBoOOBkeijnOato+OBmeOCi++8iOOCr+ODqeOCuTTku6XkuIvjga/jg6Ljg4fjg6vlgbTjga7oo5zmraPjgYzjgYLjgovjga7jgafkuozph43mjpvjgZHjgZfjgarjgYTvvInjgIIKICAgICAg5qC85LiK44GS77yI5L6LIEcz4oaSRzHvvInvvJrlpb3otbDjga7kvqHlgKTjgpLlibLjgorlvJXjgY/vvIjnnYDpoIbjgYzoia/jgYTjgbvjganlpKfjgY3jgY/vvIkKICAgICAg5qC85LiL44GS77yI5L6LIEcx4oaSRzLvvInvvJrlh6HotbDjga7kvqHlgKTjgpLlsJHjgZfmiLvjgZkKICAgIOS/guaVsOOBr+aaq+WumuWApOOAguKRoC0y44Gu44CM44Kw44Os44O844OJ6KOc5q2j44Gu5Yq55p6c5q+U6LyD44CN44Gn44CB6KOc5q2j44GC44KKL+OBquOBl+OCkuWQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+avlOOBueOBpueiuuiqjeOBmeOCi+OBk+OBqOOAgiAqLwogY29uc3QgR1JBREU9e29uOnRydWUsS1VQOi4zMCxLRE46LjEyLE1JTjotLjksTUFYOi41fTsKIGZ1bmN0aW9uIGdyYWRlQWRqKHIsc3RvcmUscmFjZSxjb21wKXsKICBpZighR1JBREUub258fChjb21wJiZjb21wLmdyYWRlPT09ZmFsc2UpKXJldHVybiAwOwogIGNvbnN0IEd0PXJhY2UuZ3JkfHwwO2lmKEd0PDIpcmV0dXJuIDA7CiAgY29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtpZighaHx8IWgucnVucy5sZW5ndGgpcmV0dXJuIDA7CiAgY29uc3QgcmM9aC5ydW5zLnNsaWNlKC0zKSxXPVtbMV0sWy40LC42XSxbLjIsLjMsLjVdXVtyYy5sZW5ndGgtMV07bGV0IGQ9MDsKICByYy5mb3JFYWNoKCh4LGspPT57Y29uc3QgZmluPXhbMV0sTD14WzRdfHwwLEdyPXhbNV18fDA7aWYoTCE9PTV8fCEoZmluPjApKXJldHVybjsKICAgY29uc3QgZ3I9TWF0aC5tYXgoR3IsMik7ICAgICAgICAgIC8vIE9Q44O744Kw44Os44O844OJ5LiN5piO44Gu44Kv44Op44K5Nei1sOOBryBHMyDnm7jlvZPjgajjgZfjgabmr5TovIMKICAgaWYoR3Q+Z3ImJmZpbjw9NSlkLT1XW2tdKkdSQURFLktVUCooR3QtZ3IpKig2LWZpbikvNjsKICAgZWxzZSBpZihHdDxnciYmZmluPj00KWQrPVdba10qR1JBREUuS0ROKihnci1HdCkqTWF0aC5taW4oMSwoZmluLTMpLzgpfSk7CiAgcmV0dXJuIGNsYW1wKGQsR1JBREUuTUlOLEdSQURFLk1BWCl9CiBjb25zdCBHTj1bIuS4jeaYji/kuIvntJoiLCJPUOODu0wiLCJHMyIsIkcyIiwiRzEiXTsKIGZ1bmN0aW9uIGdyYWRlVGFncyh0YWdzLGR6LHJhY2Upe2NvbnN0IHQ9dGFncy5zbGljZSgpOwogIGlmKGR6PD0tLjIpdC51bnNoaWZ0KHt0OmDmoLzkuIrjgZLmiKbvvIgke0dOW3JhY2UuZ3JkfHwwXX3vvInvvJrkuIvkvY3jgrDjg6zjg7zjg4njga7lpb3otbDjga/libLlvJUgJHtkei50b0ZpeGVkKDIpfWAsYzoibyJ9KTsKICBlbHNlIGlmKGR6Pj0uMSl0LnVuc2hpZnQoe3Q6YOmrmOOCsOODrOODvOODieOBi+OCieOBruagvOS4i+OBkiAke2R6Pj0wPyIrIjoiIn0ke2R6LnRvRml4ZWQoMil9YCxjOiJiIn0pOwogIHJldHVybiB0fQogLyog44Os44O844K56Kej5p6Q44CCb2RkcyDjga/ku7vmhI/vvIjlhajpoK3liIbvvInjgIIgKi8KIGNvbnN0IExWTj1bIuS4jeaYjiIsIuacquWLneWIqSIsIjHli50iLCIy5YudIiwiM+WLnSIsIk9QIl07CiBmdW5jdGlvbiBleHRyYVRhZ3ModGFncyxyLHN0b3JlLHJhY2UpewogIGNvbnN0IHQ9dGFncy5zbGljZSgpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksTHQ9cmFjZS5sdmx8fDA7CiAgaWYoaCl7Y29uc3QgbGFzdD1oLnJ1bnMubGVuZ3RoP2gucnVuc1toLnJ1bnMubGVuZ3RoLTFdOm51bGw7CiAgIGlmKGxhc3QmJmxhc3RbNF0+MCYmTHQ+MCYmbGFzdFs0XSE9PUx0KXQudW5zaGlmdChsYXN0WzRdPEx0P3t0OmDmmIfntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJvIn06e3Q6YOmZjee0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6ImIifSk7CiAgIGlmKGgubHYmJmgubHZbLTFdKXQucHVzaCh7dDoi5Zyw5pa544Gn44Gu5Ye66LWw44GC44KK77yI5Ymy5byV6KmV5L6h77yJIixjOiJnIn0pfQogIHJldHVybiB0fQogLyog44Op44Oz44Kv77ya56m044K+44O844Oz44Gu5bmz5Z2H44Gr5a++44GZ44KL5YCN546H44GnIFMvQS9CL0PvvIjlsaXmrbTjgYwx6LWw5Lul5LiL44GvQuOBvuOBp++8iSAqLwogY29uc3QgQVZHX0hPTEU9e29kZHM6LjA5MSxwcm94eTouMTE1fTsKIGZ1bmN0aW9uIHJhdGluZyhwYyxtb2RlLG4pe2NvbnN0IHI9cGMvQVZHX0hPTEVbbW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il07bGV0IGs9cj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiO2lmKG48MiYmKGs9PT0iUyJ8fGs9PT0iQSIpKWs9IkIiO3JldHVybiBrfQogLyog55qE5Lit546H6YeN6KaW77ya5a6f57i+M+i1sOS7peS4iuODu+ODqeODs+OCr1MvQeODu++8iOOCquODg+OCuuOBjOWIhuOBi+OCi+OBqOOBjeOBr++8ieWNmOWLnTMw5YCN5pyq5rqA44Gu5aSn56m044KS6Zmk44GP44CC6YGO5Y6744Gu5qSc6Ki844Gn44CB55qE5Lit546H44GM5LiK44GM44KK44CB5Zue5Y+O546H44GM5pyA5oKq44Gu5aSn56m044KS6YG/44GR44KJ44KM44GfICovCiBjb25zdCBGT0NVU19NQVhfT0REUz0zMDsKIGNvbnN0IEZPQ1VTPXsib2RkcyI6eyJuIjozNjI1LCJoaXQiOjAuMjMyLCJiYXNlSGl0IjowLjE3MiwicGVyRGF5IjoxMy42fSwicHJveHkiOnsibiI6NDAyNSwiaGl0IjowLjI3MiwiYmFzZUhpdCI6MC4yMTcsInBlckRheSI6MTUuMX19OyAgIC8vIDIwMjTlubTku6XpmY3jga7mpJzoqLzvvJrnmoTkuK3njofvvIhiYXNlSGl0PeW+k+adpeOBrjHkvY3lgJnoo5zvvInjg7vplovlgqzml6XjgYLjgZ/jgorjga7poK3mlbAKIGZ1bmN0aW9uIHBpY2tGb2N1cyhyZXMsayl7cmV0dXJuIHJlcy5maWx0ZXIoeD0+eC5ob2xlJiZ4Lm4+PTMmJihyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKT09PSJTInx8cmF0aW5nKHgucGMseC5tb2RlLHgubik9PT0iQSIpJiYoeC5vZGQ9PW51bGx8fHgub2RkPEZPQ1VTX01BWF9PRERTKSkuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCxrKX0KIC8qIOeptOmmrOWAmeijnO+8muWun+e4vuOBruOBguOCi+mmrO+8iDPotbDku6XkuIrvvInjgaDjgZHjgpLjgIHlpb3otbDnjofjga7pq5jjgYTpoIbjgasgayDpoK3jgILlsaXmrbTjga7kuY/jgZfjgYTppqzjga/lkIzngrnjgavjgarjgorjgoTjgZnjgY/jgIHpoIbkvY3jgavmhI/lkbPjgYzjgarjgYTjgZ/jgoHlr77osaHlpJYgKi8KIGZ1bmN0aW9uIHBpY2socmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLGspfQogZnVuY3Rpb24gYW5hbHl6ZShyYWNlLHN0b3JlLG9kZHMsY29tcCxwb3BBcnIpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGg7CiAgY29uc3Qgc2M9Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wKSk7CiAgY29uc3QgZHo9Ui5tYXAocj0+Z3JhZGVBZGoocixzdG9yZSxyYWNlLGNvbXApKTsKICBjb25zdCB6YzA9TU9ERUwuY29yZT9SLm1hcChyPT5tb2RlbFooImNvcmUiLGZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSkpOnNjLm1hcCh4PT54LnopO2NvbnN0IHpjPXpjMC5tYXAoKHosaSk9PnorZHpbaV0pOwogIGNvbnN0IHA9bm9ybWFsaXplVG9wMyh6YyxNYXRoLm1pbigzLE4pKTsKICBsZXQgbWt0PW51bGwscG9wPW51bGwsbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXtta3Q9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7cG9wPW9kZHMubWFwKG89PjErb2Rkcy5maWx0ZXIoeD0+eDxvKS5sZW5ndGgpO21vZGU9Im9kZHMifQogIGVsc2UgaWYocG9wQXJyJiZwb3BBcnIubGVuZ3RoPT09TiYmcG9wQXJyLmV2ZXJ5KHg9Png+MCkpe3BvcD1wb3BBcnIuc2xpY2UoKTttb2RlPSJvZGRzIn0gLy8g5a6f6Zqb44Gu5Lq65rCX6aCG5L2N44Gg44GR5YiG44GL44KL44Go44GN77yI57WQ5p6c44Oa44O844K455Sx5p2l77yJCiAgZWxzZXsgLy8g44Kq44OD44K644KC5Lq65rCX44KC44Gq44GE44Go44GN77ya6aiO5omL5oiQ57i+44G+44Gn5ZCr44KB44Gf44K544Kz44Ki44Gu6aCG5L2N44KS44CM5Lq65rCX44Gu5Luj55CG44CN44Gr44GZ44KL77yI5a6f6Zqb44Gu5Lq65rCX44Go44Gu55u46ZaiIDAuNTXihpIwLjY377yJCiAgIGNvbnN0IHB4PU1PREVMLmZ1bGw/Ui5tYXAocj0+bW9kZWxaKCJmdWxsIixmZWF0cyhyLHN0b3JlLHJhY2UsTix0cnVlKSkpOlIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4se2pvY2tleTp0cnVlLGxheW9mZjpmYWxzZX0pLnopO2NvbnN0IHB4Mj1weC5tYXAoKHYsaSk9PnYrZHpbaV0pO3BvcD1weDIubWFwKHY9PjErcHgyLmZpbHRlcih5PT55PnYpLmxlbmd0aCl9CiAgY29uc3QgcmFuaz1wLm1hcCh2PT4xK3AuZmlsdGVyKHg9Png+dikubGVuZ3RoKTsKICBjb25zdCBjdXQ9TWF0aC5tYXgoNSxNYXRoLmNlaWwoTiouNCkpOwogIHJldHVybiBSLm1hcCgocixpKT0+KHtpLG5vOnIubnVtfHxpKzEsbmFtZTpyLm5hbWV8fHIuaG9yc2UscDpwW2ldLHBjOmNhbGliRm9yKHBbaV0sbW9kZSksbW9kZSwKICAgam46KHN0b3JlLmpvY2tleShyLmpvY2tleSl8fHtuOjB9KS5uLHJhbms6cmFua1tpXSxwb3A6cG9wW2ldLGJhc2U6TWF0aC5taW4oLjUsMy9OKSwKICAgb2RkOihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSk/b2Rkc1tpXTpudWxsLAogICBjYXJlZXI6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD97bjpoLm4sdDM6aC50b3AzLHdpbjpoLndpbn06bnVsbH0pKCksCiAgIHJlY2VudDooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gucnVucy5tYXAoeD0+eFsxXSk6W119KSgpLAogICBqbmFtZTpyLmpuYW1lfHwiIixqc3RhdDooKCk9Pntjb25zdCBqPXN0b3JlLmpvY2tleShyLmpvY2tleSk7cmV0dXJuIGomJmoubj49MT97bjpqLm4scmF0ZTpqLnRvcDMvai5ufTpudWxsfSkoKSwKICAgaG9sZTpOPj02JiZwb3BbaV0+PWN1dCxta3Q6bWt0P21rdFtpXTpudWxsLHZhbHVlOm1rdD9jYWxpYkZvcihwW2ldLCJvZGRzIikvbWt0W2ldOm51bGwsCiAgIGR6OmR6W2ldLHRhZ3M6Z3JhZGVUYWdzKGV4dHJhVGFncyhzY1tpXS50YWdzLHIsc3RvcmUscmFjZSksZHpbaV0scmFjZSksY29uZjpzY1tpXS5jb25mLG46c2NbaV0ubixjdXR9KSk7CiB9CgogLyogPT09PT0g6YmE5p2/6Lu46aas44O75rOi5Lmx5bqm77yI56m06aas5LqI5oOz44Go44Gv5Yil44Gu6KiI566X44CC5L+C5pWw44GvIHRvb2xzL2F4aXNfdXBzZXRfc3R1ZHkuanMg44Gn5a2m57+S44CBMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+aknOiovO+8iSA9PT09PSAqLwogY29uc3QgQVhJUz17IndQIjpbMC4wNTE5MywxLjAxNDgzLDAuMDUxNDgsLTAuMjA2NzYsLTAuNTMyMTYsMC45MTQzNywtMC40ODQ2NCwtMC4zMjExNSwtMC41NjgwMiwtMC41NTEzNSwwLjE3MzQ1LDEuMDk3NCwtMC4yODQwNywtMC4xMDM5NywtMC4yMTYxNywtMC4zNDY2OCwwLjE1OTEzLDAuMjIxOTYsLTAuMzg3MzIsLTAuMzQ2NTgsMC4wMDM3LC0wLjU2NjQ2XSwid08iOlswLjU0MjU5LDAuMTU2NjEsMC4wNTQxNCwtMC4wNDM3MSwtMC4xNDUyNCwwLjEzMTcxLC0wLjE0MTc4LC0wLjE2MjYzLDAuMDUzMTYsLTAuMDIwOTcsMC4wMDM5LC0wLjI5ODY1LC0wLjMyMzIxLC0wLjAxMzY1LC0wLjA5NTE5LC0wLjA3ODE4LDAuMDAwNiwtMC4wMjI5MSwtMC4xMTIxMywwLjAxNzgxLC0wLjA0NzQ1LC0wLjEwODUyLDAuMjU3MjEsMC42MzA3MV0sInVwc2V0Ijp7InRociI6MTUsIm1vZGVscyI6eyJwcm94eSI6WzIuMjQ1NTksMC42Mzg0MSwtMC4wNzA4LC0wLjA4MTYxLC0wLjA3NzQzLDAuMDkxMzcsMC4xMzg0NywwLjAwMjc5LC0wLjM4OTE5LC0wLjY0MjE3LC0wLjU1MzgxLC0wLjAxODM3LC0wLjQ0MzE3LC0wLjc2ODI1LC0wLjUyMzkzLC0yLjczNTYxLC0wLjE0OTA5LDAuMTE0NzddLCJvZGRzIjpbLTAuNzIzOTYsMC40MjgwOCwtMC4wNzQ5OSwtMC4wNjE1NCwtMC4wMDY3NSwwLjA3MjQzLDAuMDcwODUsLTAuMDQ5NzQsLTAuMTU1MjgsLTAuMzI1MTYsLTAuNDE4MjYsLTAuMzEzNTEsMC4yMDc1NywtMC4yMzksLTAuMjc5MDEsLTEuODIxMDgsLTAuMDA4NTIsMC4wODM5OSwwLjE1MDI0LDAuMzUyNDIsLTIuMDM4MzksMi44NTY2OCwwLjIyOTI5LDAuNzIwODQsLTEuOTc3OTddfSwiZ3JhZGVzIjp7InByb3h5Ijp7ImN1dHMiOltbIlNTUyIsMC41NTAzN10sWyJTUyIsMC40ODU1XSxbIlMiLDAuNDA0MjRdLFsiQSIsMC4yOTg4XSxbIkIiLDAuMTg5NTddLFsiQyIsMC4wMDYyOV1dLCJyYXRlcyI6eyJTU1MiOjAuNTc0LCJTUyI6MC41MDksIlMiOjAuNDMzLCJBIjowLjM0NywiQiI6MC4yNDQsIkMiOjAuMDg5fSwiYXZnUyI6eyJTU1MiOjE3LjIsIlNTIjoxNS4zLCJTIjoxNC4yLCJBIjoxMy4xLCJCIjoxMS44LCJDIjo5Ljh9fSwib2RkcyI6eyJjdXRzIjpbWyJTU1MiLDAuNjA5NjhdLFsiU1MiLDAuNTE1OTVdLFsiUyIsMC40MDg1NF0sWyJBIiwwLjI4NzY3XSxbIkIiLDAuMTczNTldLFsiQyIsMC4wMDc2OF1dLCJyYXRlcyI6eyJTU1MiOjAuNjc5LCJTUyI6MC41OTgsIlMiOjAuNDU1LCJBIjowLjM1MiwiQiI6MC4yNDYsIkMiOjAuMDc5fSwiYXZnUyI6eyJTU1MiOjE4LjUsIlNTIjoxNi40LCJTIjoxNC41LCJBIjoxMy4zLCJCIjoxMS44LCJDIjo5LjZ9fX19LCJiYW5kcyI6eyLpiYTmnb8iOnsibG8iOjAuOTIsImhpIjoxLCJuIjoxNjYsInJhdGUiOjAuOTYzOSwibG85NSI6MC45MzU1LCJuMiI6ODcsInJhdGUyIjowLjk3NywicGVyRGF5IjowLjYyfSwi5rqW6YmE5p2/Ijp7ImxvIjowLjg4LCJoaSI6MC45MiwibiI6Mjc5LCJyYXRlIjowLjg4NTMsImxvOTUiOjAuODQ3OSwibjIiOjEzOSwicmF0ZTIiOjAuODk5MywicGVyRGF5IjoxLjA0fSwi5aCF6Lu4Ijp7ImxvIjowLjg0LCJoaSI6MC44OCwibiI6NDc0LCJyYXRlIjowLjg0MTgsImxvOTUiOjAuODA4OSwibjIiOjIyNiwicmF0ZTIiOjAuODQwNywicGVyRGF5IjoxLjc4fX19OwogZnVuY3Rpb24gYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyl7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aCx4Yz1SLm1hcChyPT5mZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpOwogIGNvbnN0IHBQPW5vcm1hbGl6ZVRvcDMoeGMubWFwKHg9PmRvdChBWElTLndQLHgpKSxNYXRoLm1pbigzLE4pKTsKICBsZXQgcE89bnVsbDsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7CiAgIGNvbnN0IGludj1vZGRzLm1hcChvPT4xL28pLFQ9aW52LnJlZHVjZSgoYSxiKT0+YStiLDApLHB3PWludi5tYXAodj0+di9UKSxtMz10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTsKICAgcE89bm9ybWFsaXplVG9wMyh4Yy5tYXAoKHgsaSk9PmRvdChBWElTLndPLFsuLi54LE1hdGgubG9nKHB3W2ldKSxsb2dpdChNYXRoLm1pbiguOTgsbTNbaV0pKV0pKSxNYXRoLm1pbigzLE4pKX0KICByZXR1cm57cFAscE8seGN9fQogLyog6YmE5p2/6Lu46aas77ya44Kq44OD44K644GM44GC44KL44Os44O844K544Gg44GR44CC5LqI5ris56K6546H44Gu5Yy65YiG44GU44Go44Gr44CB6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh+OCkua3u+OBiOOCiyAqLwogZnVuY3Rpb24gYXhpc1BpY2tzKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpO2lmKCFhcC5wTylyZXR1cm4gbnVsbDsKICBjb25zdCBvdXQ9W107YXAucE8uZm9yRWFjaCgocCxpKT0+ewogICBmb3IoY29uc3QgayBvZiBbIumJhOadvyIsIua6lumJhOadvyIsIuWghei7uCJdKXtjb25zdCBiPUFYSVMuYmFuZHNba107aWYocD49Yi5sbyYmcDwoaz09PSLpiYTmnb8iPzEuMDE6Yi5oaSkpe291dC5wdXNoKHtpLHAsdGllcjprLHJhdGU6Yi5yYXRlLGxvOTU6Yi5sbzk1LG46Yi5ufSk7YnJlYWt9fX0pOwogIHJldHVybiBvdXQuc29ydCgoYSxiKT0+Yi5wLWEucCl9CiAvKiDms6LkubHluqbvvJpTU1PjgJxD44CCM+edgOWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK44Gr44Gq44KL56K6546H44Gn562J57Sa44Gl44GRICovCiBmdW5jdGlvbiB1cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpOwogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgscHM9YXAucFAuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpOwogIGNvbnN0IG5zPVIubWFwKHI9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gubjowfSksbW9udGg9TnVtYmVyKFN0cmluZyhyYWNlLmRhdGUpLnNsaWNlKDUsNykpfHwwLEw9cmFjZS5sdmx8fDA7CiAgY29uc3QgZj1bMSxOLzE2LEw9PT0xPzE6MCxMPT09Mj8xOjAsTD09PTM/MTowLEw9PT00PzE6MCxMPT09NT8xOjAscmFjZS5zdXJmPT09MT8xOjAsKHJhY2UuZGlzdHx8MCkvMjAwMCwKICAgbnMuZmlsdGVyKG49Pm49PT0wKS5sZW5ndGgvTixucy5maWx0ZXIobj0+bjwzKS5sZW5ndGgvTixucy5yZWR1Y2UoKGEsbik9PmErTWF0aC5sb2coMStuKSwwKS9OLzMsCiAgIHBzWzBdLHBzWzFdLHBzWzJdLHBzLnJlZHVjZSgoYSxwKT0+YStwKnAsMCkscHMuZmlsdGVyKHA9PnA+LjUpLmxlbmd0aC8zLG1vbnRoPj02JiZtb250aDw9OT8xOjBdOwogIGxldCBtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCkuc29ydCgoYSxiKT0+Yi1hKSxvZD1vZGRzLnNsaWNlKCkuc29ydCgoYSxiKT0+YS1iKTsKICAgY29uc3QgZW50PS1wdy5yZWR1Y2UoKGEscCk9PmErcCpNYXRoLmxvZyhwKSwwKS9NYXRoLmxvZyhOKTsKICAgZi5wdXNoKHB3WzBdLHB3WzFdLHB3WzBdK3B3WzFdK3B3WzJdLGVudCxNYXRoLmxvZyhvZFswXSksTWF0aC5sb2cob2RbMV0pLG9kLmZpbHRlcihvPT5vPDEwKS5sZW5ndGgvTik7bW9kZT0ib2RkcyJ9CiAgcmV0dXJue2YsbW9kZSxwMDpzaWdtb2lkKGRvdChBWElTLnVwc2V0Lm1vZGVsc1ttb2RlXSxmKSl9fQogZnVuY3Rpb24gdXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kZHMsYXApewogIGNvbnN0IHU9dXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kZHMsYXApLG1vZGU9dS5tb2RlLHA9dS5wMCxHPUFYSVMudXBzZXQuZ3JhZGVzW21vZGVdOwogIGxldCBncmFkZT0iQyI7Zm9yKGNvbnN0IFtnLGNdIG9mIEcuY3V0cyl7aWYocD49Yyl7Z3JhZGU9ZzticmVha319CiAgcmV0dXJue2dyYWRlLHAsbW9kZSxyYXRlOkcucmF0ZXNbZ3JhZGVdLGF2Z1M6Ry5hdmdTW2dyYWRlXX19CgogLyog5omV5oi744Gk44GN5pmC57O75YiX44OQ44OD44Kv44OG44K544OI44CCcmFjZXMg44Gv5pel5LuY5piH6aCGIFt7aWQsZGF0ZSxyb3dzfV3jgIFwYXlCeUlkIOOBryB7cmFjZUlkOntwbGFjZTpbe251bWJlcix5ZW59XX1944CCCiAgICDnqbTjgr7jg7zjg7Pjga/lrp/jgqrjg4PjgrrpoIbkvY3jgaflrprnvqnvvIjjg4Tjg7zjg6vjga7jgqrjg4PjgrrlhaXlipvjg6Ljg7zjg4njgajlkIzjgZjnirbms4HvvInjgILlkITjg6zjg7zjgrkxMDDlhobjgZrjgaTos7zlhaXjgIIgKi8KIGZ1bmN0aW9uIGJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsb3B0cyl7CiAgb3B0cz1vcHRzfHx7fTtjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiIixTUExJVD1vcHRzLnNwbGl0fHwiIixPT1M9b3B0cy5vb3N8fCIiLFBST1hZPSEhb3B0cy5wcm94eSxNSU5HPU51bWJlcihvcHRzLm1pbkdyZCl8fDAsX2dPbj1HUkFERS5vbjtHUkFERS5vbj0hb3B0cy5ncmFkZU9mZjsKICBjb25zdCBuYW1lcz1bInRvcDEiLCJ0b3AyIiwidG9wMyIsImFsbEhvbGUiLCJ2YWx1ZSIsImF4aXMiLCJmb2N1cyJdLHBlcj1bImFsbCIsIkEiLCJCIiwiQyJdOwogIGNvbnN0IFM9e307Zm9yKGNvbnN0IG4gb2YgbmFtZXMpe1Nbbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKVNbbl1bcF09e2JldHM6MCxoaXRzOjAscmV0OjAsc3E6MH19CiAgY29uc3QgU0VHPXt9OyAgIC8vIDHkvY3lgJnoo5zjga7mnaHku7bliKXvvIjlhajmnJ/plpPvvI/liY3ljYrvvI/lvozljYrvvIkKICBjb25zdCBzdG9yZT1uZXcgU3RvcmUoKTtsZXQgdXNlZD0wOwogIGNvbnN0IGFkZD0obixwLGhpdCx5ZW4pPT57Y29uc3QgeD1TW25dW3BdO3guYmV0cysrO2lmKGhpdCl4LmhpdHMrKzt4LnJldCs9eWVuO3guc3ErPXllbip5ZW59OwogIGNvbnN0IGFkZFNlZz0obGFiZWwscCx5ZW4pPT57Y29uc3QgZz1TRUdbbGFiZWxdPVNFR1tsYWJlbF18fHthbGw6e246MCxoOjAscjowLHE6MH0sQTp7bjowLGg6MCxyOjAscTowfSxCOntuOjAsaDowLHI6MCxxOjB9fTtmb3IoY29uc3QgayBvZiBbImFsbCIscF0pe2NvbnN0IHg9Z1trXTt4Lm4rKztpZih5ZW4+MCl4LmgrKzt4LnIrPXllbjt4LnErPXllbip5ZW59fTsKICBjb25zdCBBVj1QUk9YWT8uMTE1Oi4wOTE7CiAgZm9yKGNvbnN0IHJjIG9mIHJhY2VzKXsKICAgLy8g5omV5oi744GuSUTjga/jgIzml6Xku5gt6ZaL5YKs5aC0LVLnlarlj7fjgI3jgILjg5Djg4Pjgq/jgqLjg4Pjg5fjga4xMuahgUlE44Go44KC44CB5ZCM44GY5b2i5byP44GuSUTjgajjgoLntZDjgbPku5jjgZHjgosKICAgY29uc3Qgdk9mPS9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoNCw2KTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbM118fCIiLHJPZj1OdW1iZXIoL15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSgxMCwxMik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzRdfHwwKTsKICAgY29uc3QgcGF5PXBheUJ5SWRbcmMuaWRdfHxwYXlCeUlkW2Ake3JjLmRhdGV9LSR7dk9mfS0ke1N0cmluZyhyT2YpLnBhZFN0YXJ0KDIsIjAiKX1gXTsKICAgaWYocGF5JiZwYXkucGxhY2UmJnBheS5wbGFjZS5sZW5ndGgmJnJjLmRhdGU+PVNUQVJUJiYoIU1JTkd8fCgocmMucm93c1swXSYmcmMucm93c1swXS5ncmQpfHwwKT49TUlORykpewogICAgLy8g5Ye66LWw6KGo44Go5ZCM44GY6aas55Wq6aCG44Gr5Lim44G544KL77yI5ZCM54K544Gu44Go44GN44Gu5Lim44Gz44Gn552A6aCG44GM5ryP44KM44Gq44GE44KI44GG44Gr77yJCiAgICBjb25zdCBSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpOwogICAgY29uc3QgaGFzT2Rkcz1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLm9kZHM+MSksaGFzUG9wPVIubGVuZ3RoPj02JiZSLmV2ZXJ5KHI9PnIucG9wPjApOwogICAgaWYoUFJPWFk/Ui5sZW5ndGg+PTY6KGhhc09kZHN8fGhhc1BvcCkpewogICAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgICAgY29uc3QgcmVzPVBST1hZP2FuYWx5emUocmFjZSxzdG9yZSxudWxsKTooaGFzT2Rkcz9hbmFseXplKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk6YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwsbnVsbCxSLm1hcChyPT5yLnBvcCkpKTsKICAgICBjb25zdCB5ZW49bmV3IE1hcChwYXkucGxhY2UubWFwKHg9Plt4Lm51bWJlcix4Lnllbl0pKTsKICAgICBjb25zdCBob2xlPXJlcy5maWx0ZXIoeD0+eC5ob2xlKS5zb3J0KChhLGIpPT5iLnAtYS5wKTsKICAgICBpZihob2xlLmxlbmd0aCl7CiAgICAgIHVzZWQrKztjb25zdCBwcj1TUExJVD8ocmMuZGF0ZTxTUExJVD8iQSI6IkIiKToiQSI7CiAgICAgIGNvbnN0IGJ1eT0obixsaXN0KT0+e2Zvcihjb25zdCB4IG9mIGxpc3Qpe2NvbnN0IHk9eWVuLmdldChSW3guaV0ubnVtKXx8MDthZGQobiwiYWxsIix5PjAseSk7YWRkKG4scHIseT4wLHkpO2lmKE9PUyYmcmMuZGF0ZT49T09TKWFkZChuLCJDIix5PjAseSl9fTsKICAgICAgYnV5KCJmb2N1cyIscGlja0ZvY3VzKHJlcywxKSk7CiAgICAgIGJ1eSgidG9wMSIscGljayhyZXMsMSkpO2J1eSgidG9wMiIscGljayhyZXMsMikpO2J1eSgidG9wMyIscGljayhyZXMsMykpO2J1eSgiYWxsSG9sZSIsaG9sZSk7CiAgICAgIGlmKCFQUk9YWSlidXkoInZhbHVlIixob2xlLmZpbHRlcih4PT54LnZhbHVlPj0xLjMpKTsKICAgICAgaWYoIVBST1hZJiZoYXNPZGRzKXtjb25zdCBhcD1heGlzUHJvYnMocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTtpZihhcC5wTylidXkoImF4aXMiLGFwLnBPLm1hcCgocCxpKT0+KHtpLHB9KSkuZmlsdGVyKHg9PngucD49QVhJUy5iYW5kc1si6YmE5p2/Il0ubG8pKX0KICAgICAgY29uc3QgdD1waWNrKHJlcywxKVswXTsKICAgICAgaWYodCl7Y29uc3QgeT15ZW4uZ2V0KFJbdC5pXS5udW0pfHwwLHI9dC5wYy9BVixOPVIubGVuZ3RoOwogICAgICAgY29uc3QgcmFuaz0ocj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiKTsKICAgICAgIGFkZFNlZygi44Op44Oz44KvIisodC5uPDImJihyYW5rPT09IlMifHxyYW5rPT09IkEiKT8iQiI6cmFuaykscHIseSk7CiAgICAgICBhZGRTZWcoTjw9MTA/IumgreaVsCDjgJwxMCI6Tjw9MTQ/IumgreaVsCAxMeOAnDE0Ijoi6aCt5pWwIDE144CcIixwcix5KTsKICAgICAgIGFkZFNlZyhyYWNlLnN1cmY9PT0xPyLoip0iOnJhY2Uuc3VyZj09PTI/IuODgOODvOODiCI6IuOBneOBruS7liIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5sdmw+MD8i44Kv44Op44K5ICIrTFZOW3JhY2UubHZsXToi44Kv44Op44K5IOS4jeaYjiIscHIseSk7CiAgICAgICBhZGRTZWcodC5uPj01PyLlrp/nuL4gNei1sOS7peS4iiI6dC5uPj0zPyLlrp/nuL4gM+OAnDTotbAiOiLlrp/nuL4gM+i1sOacqua6gCIscHIseSk7CiAgICAgICBpZighUFJPWFkmJnQub2RkKXtjb25zdCBvPXQub2RkO2FkZFNlZyhvPDg/IuWNmOWLnSDjgJw45YCNIjpvPDE1PyLljZjli50gOOOAnDE15YCNIjpvPDMwPyLljZjli50gMTXjgJwzMOWAjSI6bzw2MD8i5Y2Y5YudIDMw44CcNjDlgI0iOiLljZjli50gNjDlgI3jgJwiLHByLHkpOwogICAgICAgIGlmKGhhc09kZHMpe2NvbnN0IHVnPXVwc2V0R3JhZGUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTthZGRTZWcoIuazouS5seW6piAiK3VnLmdyYWRlLHByLHkpfX19CiAgICAgfQogICAgfQogICB9CiAgIGZvcihjb25zdCByIG9mIHJjLnJvd3Mpc3RvcmUuYWRkKHIpOwogIH0KICBjb25zdCBmaW49e307CiAgZm9yKGNvbnN0IG4gb2YgbmFtZXMpe2ZpbltuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpe2NvbnN0IHg9U1tuXVtwXTsKICAgaWYoIXguYmV0cyl7ZmluW25dW3BdPXtiZXRzOjB9O2NvbnRpbnVlfQogICBjb25zdCBtZWFuPXgucmV0L3guYmV0cyxzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnNxL3guYmV0cy1tZWFuKm1lYW4pKTsKICAgZmluW25dW3BdPXtiZXRzOnguYmV0cyxoaXRSYXRlOnguaGl0cy94LmJldHMscm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4LmJldHMpLzEwMH19fQogIGNvbnN0IHNlZ3M9e307CiAgZm9yKGNvbnN0IFtrLGddIG9mIE9iamVjdC5lbnRyaWVzKFNFRykpe3NlZ3Nba109e307Zm9yKGNvbnN0IHAgb2YgWyJhbGwiLCJBIiwiQiJdKXtjb25zdCB4PWdbcF07CiAgIGlmKCF4Lm4pe3NlZ3Nba11bcF09e2JldHM6MH07Y29udGludWV9Y29uc3QgbWVhbj14LnIveC5uLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHgucS94Lm4tbWVhbiptZWFuKSk7CiAgIHNlZ3Nba11bcF09e2JldHM6eC5uLGhpdFJhdGU6eC5oL3gubixyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHgubikvMTAwfX19CiAgR1JBREUub249X2dPbjtyZXR1cm57cmFjZXM6dXNlZCxzdGF0czpmaW4sc2Vnc307CiB9CiByZXR1cm57dXBzZXRGZWF0dXJlcyxjbGVhblRyLEdSQURFLGdyYWRlVGllcixncmFkZUFkaixGT0NVUyxyYXRpbmcscGlja0ZvY3VzLEFYSVMsYXhpc1Byb2JzLGF4aXNQaWNrcyx1cHNldEdyYWRlLHBpY2ssZmVhdHMsTU9ERUwsRk4sRkosbGV2ZWxPZkxhYmVsLGxldmVsT2ZQcml6ZSxiYWNrdGVzdCxjYWxpYixjYWxpYkZvcixqbm4sbm4sdG9Sb3csY3N2Um93cyxTdG9yZSxhbmFseXplLGhvcnNlU2NvcmUsbm9ybWFsaXplVG9wMyx0b3AzRnJvbVdpbixzdXJmQ29kZSxwYXJzZURhdGV9Owp9KSgpOwoKCgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog44Ki44OX44Oq5bGk77yI5YaN5qeL56+J77yJCiAqICDjg7vkv53lrZgv5YaN6ZaL44Gk44GN44Gu6YGO5Y6744OH44O844K/5Y+W5b6X44CB44OQ44OD44Kv44Ki44OD44OX44CB5qSc6Ki844Gv44CB5YuV5L2c56K66KqN5riI44G/44Gu5Yem55CG44KS44Gd44Gu44G+44G+5YaN5Yip55SoCiAqICDjg7vku4rpgLHmnKvjga7lj5blvpfjgIHpqI7miYvjg7voqr/mlZnluKvjga7nhaflkIjjgIHmnJ/lvoXlgKTjgIHotoXpiYTmnb/jgIHms6LkubHluqbjgIHlj5bjgorovrzjgb/lk4Hos6rjga7ooajnpLrjga/mlrDopo8KICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCAkPWlkPT5kb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7CmNvbnN0IGVzYz1zPT5TdHJpbmcocz8/IiIpLnJlcGxhY2UoL1smPD4iJ10vZyxtPT4oeyImIjoiJmFtcDsiLCI8IjoiJmx0OyIsIj4iOiImZ3Q7IiwnIic6IiZxdW90OyIsIiciOiImIzM5OyJ9W21dKSk7CmNvbnN0IHNsZWVwPShtcz0wKT0+bmV3IFByb21pc2Uocj0+c2V0VGltZW91dChyLG1zKSk7CmZ1bmN0aW9uIGJ1c3kob24sbXNnPSLlh6bnkIbkuK3igKYiKXskKCJidXN5Iikuc3R5bGUuZGlzcGxheT1vbj8iZmxleCI6Im5vbmUiOyQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9bXNnfQpsZXQgREI9bnVsbCxTVE9SRT1udWxsLFNUT1JFX0tFWT0iIjsKY29uc3QgVkVOVUU9eyIwMSI6IuacreW5jCIsIjAyIjoi5Ye96aSoIiwiMDMiOiLnpo/ls7YiLCIwNCI6IuaWsOa9nyIsIjA1Ijoi5p2x5LqsIiwiMDYiOiLkuK3lsbEiLCIwNyI6IuS4reS6rCIsIjA4Ijoi5Lqs6YO9IiwiMDkiOiLpmKrnpZ4iLCIxMCI6IuWwj+WAiSJ9Owpjb25zdCBqc3RUb2RheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgcGN0PSh4LGs9MCk9Png9PW51bGx8fCFOdW1iZXIuaXNGaW5pdGUoeCk/Ii0iOih4KjEwMCkudG9GaXhlZChrKSsiJSI7CgpmdW5jdGlvbiBvcGVuREIoKXtyZXR1cm4gbmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHI9aW5kZXhlZERCLm9wZW4oInVwc2V0X3Rvb2xfZGIiLDIpOwogci5vbnVwZ3JhZGVuZWVkZWQ9ZT0+e2NvbnN0IGQ9ZS50YXJnZXQucmVzdWx0O2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoImZpbGVzIikpZC5jcmVhdGVPYmplY3RTdG9yZSgiZmlsZXMiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJtZXRhIikpZC5jcmVhdGVPYmplY3RTdG9yZSgibWV0YSIpO2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoInBheSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoInBheSIpfTsKIHIub25zdWNjZXNzPSgpPT57REI9ci5yZXN1bHQ7b2soKX07ci5vbmVycm9yPSgpPT5uZyhyLmVycm9yKTtyLm9uYmxvY2tlZD0oKT0+bmcobmV3IEVycm9yKCLku5bjga7jgr/jg5bjgafkvb/nlKjkuK3jgafjgZkiKSl9KX0KY29uc3QgaWRiQWxsPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigiZmlsZXMiKS5vYmplY3RTdG9yZSgiZmlsZXMiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYlB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgiZmlsZXMiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoImZpbGVzIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYkNsZWFyPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKSxzdD10Lm9iamVjdFN0b3JlKCJmaWxlcyIpO3N0Lm9wZW5DdXJzb3IoKS5vbnN1Y2Nlc3M9ZT0+e2NvbnN0IGM9ZS50YXJnZXQucmVzdWx0O2lmKGMpe2lmKCFTdHJpbmcoYy5rZXkpLnN0YXJ0c1dpdGgoImxpdmU6Iikpe21hcmtEaXJ0eSgiZmlsZXMiLGMua2V5KTtjLmRlbGV0ZSgpfWMuY29udGludWUoKX19O3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CgovKiDlj5bjgorovrzjgb/muIjjgb/jga7lhajooYzvvIjjg5Djg4Pjgq/jgqLjg4Pjg5dDU1bvvIvlj5blvpfmuIjjgb/jga7miJDnuL7vvInjgpLpoIbjgavmuKHjgZkgKi8KYXN5bmMgZnVuY3Rpb24gZm9yRWFjaFJvdyhjYil7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7Y29uc3QgZj1mc1tpXTsKICBpZihmLmxpdmUpe2Zvcihjb25zdCB4IG9mIGYucm93c3x8W10pY2IobGl2ZVJvdyh4KSl9CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSljYihVRS50b1JvdyhvKSk7CiAgaWYoaSUzPT09Milhd2FpdCBzbGVlcCgwKX0KfQovKiDjg6zjg7zjgrlJROOBi+OCiemWi+WCrOWgtOODu1Lnlarlj7fvvIgxMuahgeOBrkpSQeW9ouW8j++8j+aXpeS7mC3plovlgqzloLQtUuW9ouW8j+OBruS4oeWvvuW/nO+8iSAqLwpmdW5jdGlvbiB2ZW51ZU9mSWQoaWQpe3JldHVybiAvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzNdfHwiIn0KZnVuY3Rpb24gcmFjZU5vT2ZJZChpZCl7cmV0dXJuIE51bWJlcigvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDEwLDEyKTpTdHJpbmcoaWQpLnNwbGl0KCItIilbNF18fDApfQoKLyogLS0tIOWPluOCiui+vOOBvyAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gaW1wb3J0RmlsZShmaWxlKXsKIGJ1c3kodHJ1ZSwi44OV44Kh44Kk44Or44KS6Kqt44G/6L6844G/5Lit4oCmXG7lpKfjgY3jgYTjg5XjgqHjgqTjg6vjga/mlbDljYHnp5LjgYvjgYvjgorjgb7jgZnjgIIiKTthd2FpdCBzbGVlcCgzMCk7CiB0cnl7CiAgY29uc3QgdGV4dD1hd2FpdCBmaWxlLnRleHQoKTtsZXQgaXRlbXM7CiAgaWYoL1wuY3N2JC9pLnRlc3QoZmlsZS5uYW1lKSl7aXRlbXM9W3t0eXBlOiJyYWNlLXJlc3VsdHMiLHllYXI6MCxwbGFjZTpmaWxlLm5hbWUsY3N2OnRleHR9XX0KICBlbHNle2NvbnN0IGo9SlNPTi5wYXJzZSh0ZXh0KTtpdGVtcz1BcnJheS5pc0FycmF5KGopP2o6KGouZmlsZXN8fFtqXSl9CiAgaXRlbXM9aXRlbXMuZmlsdGVyKHg9PngmJnR5cGVvZiB4LmNzdj09PSJzdHJpbmciKTsKICBpZighaXRlbXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigiY3N244KS5ZCr44KA44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44CC44OQ44OD44Kv44Ki44OD44OXSlNPTuOBi+OAgUNTVuOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgiIpOwogIGF3YWl0IGlkYkNsZWFyKCk7bGV0IG49MDsKICBmb3IobGV0IGk9MDtpPGl0ZW1zLmxlbmd0aDtpKyspe2NvbnN0IGl0PWl0ZW1zW2ldO2F3YWl0IGlkYlB1dChgJHtpdC55ZWFyfHwwfToke2l0LnBsYWNlfToke2l9YCx7eWVhcjppdC55ZWFyLHBsYWNlOml0LnBsYWNlLHBsYWNlTmFtZTppdC5wbGFjZU5hbWUsY3N2Oml0LmNzdn0pOwogICBuKz1NYXRoLm1heCgwLGl0LmNzdi5zcGxpdCgiXG4iKS5sZW5ndGgtMSk7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1g5L+d5a2Y5Lit4oCmICR7aSsxfS8ke2l0ZW1zLmxlbmd0aH1gO2F3YWl0IHNsZWVwKDApfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5bjgorovrzjgb/lrozkuobvvJoke2l0ZW1zLmxlbmd0aH3jg5XjgqHjgqTjg6vvvI/ntIQke24udG9Mb2NhbGVTdHJpbmcoKX3ooYw8L3NwYW4+YDsKICBia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuWPluOCiui+vOOBv+OCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5e2J1c3koZmFsc2UpfQp9Cgpjb25zdCBwYXlBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJwYXkiKS5vYmplY3RTdG9yZSgicGF5IikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBwYXlQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJwYXkiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJwYXkiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoInBheSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBtZXRhR2V0PWs9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJtZXRhIikub2JqZWN0U3RvcmUoIm1ldGEiKS5nZXQoayk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0KTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IG1ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgibWV0YSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwphc3luYyBmdW5jdGlvbiBwYXlTdGF0ZSgpe2F3YWl0IHNob3dTdGF0ZSgpfQoKLyogLS0tIOWFsemAmuOBruWPluW+l++8iOWGjeippuihjOOBpOOBje+8iSAtLS0gKi8KbGV0IFNZTkNJTkc9ZmFsc2U7CmFzeW5jIGZ1bmN0aW9uIGZldGNoSlNPTih1cmwsd2FpdHNBcmcpewogbGV0IGVycj0iIjtjb25zdCB3YWl0cz13YWl0c0FyZ3x8d2luZG93Ll9fV0FJVFN8fFs0MDAwLDEyMDAwLDMwMDAwLDYwMDAwXTsKIGZvcihsZXQgdD0wO3Q8PXdhaXRzLmxlbmd0aDt0KyspewogIHRyeXsKICAgY29uc3Qgcj1hd2FpdCBmZXRjaCh1cmwpO2NvbnN0IHR4dD1hd2FpdCByLnRleHQoKTtsZXQgeD17fTt0cnl7eD1KU09OLnBhcnNlKHR4dCl9Y2F0Y2goZSl7fQogICBpZighci5va3x8eC5vaz09PWZhbHNlKXtjb25zdCBlPW5ldyBFcnJvcih4LmVycm9yfHxgSFRUUCAke3Iuc3RhdHVzfWArKHR4dCYmIXguZXJyb3I/YO+8iCR7dHh0LnJlcGxhY2UoL1xzKy9nLCIgIikuc2xpY2UoMCw1MCl977yJYDoiIikpO2Uuc3RhdHVzPXIuc3RhdHVzO3Rocm93IGV9CiAgIHJldHVybiB4OwogIH1jYXRjaChlKXsKICAgZXJyPWUubWVzc2FnZTtjb25zdCByZXRyeT0hZS5zdGF0dXN8fGUuc3RhdHVzPj01MDB8fGUuc3RhdHVzPT09NDI5OwogICBpZighcmV0cnl8fHQ9PT13YWl0cy5sZW5ndGgpYnJlYWs7CiAgIGlmKFNZTkNJTkcpJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWDmt7fpm5Hjga7jgZ/jgoEke01hdGgucm91bmQod2FpdHNbdF0vMTAwMCl956eS5b6F44Gj44Gm5YaN6Kmm6KGM44GX44G+44GZ4oCm77yIJHtlcnJ977yJYDsKICAgYXdhaXQgc2xlZXAod2FpdHNbdF0pOwogIH0KIH0KIHRocm93IG5ldyBFcnJvcihlcnIpOwp9CmNvbnN0IE1PREVMX1RSQUlOX0VORD0iMjAyNi0wNi0yMiI7ICAgLy8g54++5Zyo44Gu44Oi44OH44Or44Gv44CB44GT44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gn5a2m57+SCmNvbnN0IGpzdFllc3RlcmRheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMy04NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgYWRkRGF5cz0oZCxuKT0+bmV3IERhdGUobmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKStuKjg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpmdW5jdGlvbiBtb250aHNCZXR3ZWVuKGEsYil7Y29uc3Qgb3V0PVtdO2xldFt5LG1dPWEuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpO2NvbnN0W3kyLG0yXT1iLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTsKIHdoaWxlKHk8eTJ8fCh5PT09eTImJm08PW0yKSl7b3V0LnB1c2goYCR7eX0tJHtTdHJpbmcobSkucGFkU3RhcnQoMiwiMCIpfWApO20rKztpZihtPjEyKXttPTE7eSsrfX1yZXR1cm4gb3V0fQoKCi8qIC0tLSDikaAg44OH44O844K/5Y+W5b6X77ya6YGO5Y675oiQ57i+77yI5Lq65rCX44Gk44GN77yJ77yL5omV5oi744KS44CB6ZaL5YKs5pel44GU44Go44Gr5Y+W5b6X44GX44Gm5L+d5a2YIC0tLSAqLwpjb25zdCBTWU5DX0JBVENIPTQsU1lOQ19QQVJBTExFTD0yOwpsZXQgU1NUT1A9ZmFsc2UsQkFDS1VQX0RBVEVTPW51bGw7CiQoInN5bmNTdG9wIikub25jbGljaz0oKT0+e1NTVE9QPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlfTsKJCgic2VuZCIpLnZhbHVlPWpzdFllc3RlcmRheSgpOwphc3luYyBmdW5jdGlvbiBiYWNrdXBEYXRlcygpewogaWYoQkFDS1VQX0RBVEVTKXJldHVybiBCQUNLVVBfREFURVM7CiBjb25zdCBzPW5ldyBTZXQoKSxmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihjb25zdCBmIG9mIGZzKXtpZihmLmxpdmUpY29udGludWU7Zm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpe2NvbnN0IGQ9VUUucGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pO2lmKGQpcy5hZGQoZCl9YXdhaXQgc2xlZXAoMCl9CiByZXR1cm4gQkFDS1VQX0RBVEVTPXM7Cn0KYXN5bmMgZnVuY3Rpb24gZmV0Y2hEYXkoYmFzZSxkKXsKIGNvbnN0IGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheT9kYXRlPSR7ZH1gKTsKIGNvbnN0IHJhY2VzPWRheS5yYWNlc3x8W107aWYoIXJhY2VzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyIpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krPVNZTkNfQkFUQ0gpY2h1bmtzLnB1c2gocmFjZXMuc2xpY2UoaSxpK1NZTkNfQkFUQ0gpLm1hcCh4PT54LmNuYW1lKSk7CiBjb25zdCByb3dzPVtdLHBheW91dHM9W107bGV0IGlkeD0wLGZhaWxlZE49MDsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoaWR4PGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9aWR4Kys7CiAgY29uc3QgcmVzPWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtcmVzdWx0cz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWApOwogIHJvd3MucHVzaCguLi4ocmVzLnJvd3N8fFtdKSk7cGF5b3V0cy5wdXNoKC4uLihyZXMucGF5b3V0c3x8W10pKTtmYWlsZWROKz0ocmVzLmZhaWxlZHx8W10pLmxlbmd0aH19OwogYXdhaXQgUHJvbWlzZS5hbGwoQXJyYXkuZnJvbSh7bGVuZ3RoOk1hdGgubWluKFNZTkNfUEFSQUxMRUwsY2h1bmtzLmxlbmd0aCl9LHdvcmtlcikpOwogY29uc3QgZ290PW5ldyBTZXQocm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplOwogZmFpbGVkTj1NYXRoLm1heChmYWlsZWROLHJhY2VzLmxlbmd0aC1nb3QpOwogcmV0dXJue3Jvd3MscGF5b3V0cyxmYWlsZWROLHJhY2VzOnJhY2VzLmxlbmd0aH07Cn0KJCgic3luY0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKIGNvbnN0IGE9JCgic3N0YXJ0IikudmFsdWV8fCIyMDIzLTAxLTAxIix5ZD1qc3RZZXN0ZXJkYXkoKTtsZXQgYj0kKCJzZW5kIikudmFsdWV8fHlkO2lmKGI+eWQpYj15ZDsKIGlmKGE+Yil7JCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLplovlp4vml6XjgYzntYLkuobml6XjgojjgorlvozjgafjgZnjgIIiO3JldHVybn0KIFNTVE9QPWZhbHNlO1NZTkNJTkc9dHJ1ZTskKCJzeW5jR28iKS5kaXNhYmxlZD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9ZmFsc2U7CiBjb25zdCBzdD17ZGF5czowLHJhY2VzOjAsc2tpcHBlZDowLGZhaWw6W10sdDA6RGF0ZS5ub3coKX07bGV0IGNvbnNlYz0wOwogdHJ5ewogICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i5L+d5a2Y5riI44G/44OH44O844K/44KS56K66KqN5Lit4oCmIjsKICBjb25zdCBmaWxlcz1hd2FpdCBpZGJBbGwoKSxoYXZlTGl2ZT1uZXcgU2V0KGZpbGVzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpLm1hcChmPT5mLmRhdGUpKTsKICBjb25zdCBoYXZlUGF5PW5ldyBTZXQoKGF3YWl0IHBheUFsbCgpKS5maWx0ZXIocD0+IXAuZmFpbGVkKS5tYXAocD0+cC5kYXRlKSk7CiAgY29uc3QgYms9YXdhaXQgYmFja3VwRGF0ZXMoKTsKICBjb25zdCBtb250aHM9bW9udGhzQmV0d2VlbihhLGIpLGN1ck1vbnRoPXlkLnNsaWNlKDAsNyk7CiAgZm9yKGxldCBtaT0wO21pPG1vbnRocy5sZW5ndGg7bWkrKyl7CiAgIGlmKFNTVE9QKWJyZWFrO2NvbnN0IG1vbnRoPW1vbnRoc1ttaV07CiAgIGlmKG1vbnRoPGN1ck1vbnRoJiZhd2FpdCBtZXRhR2V0KCJtb250aDoiK21vbnRoKSl7Y29udGludWV9CiAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHttb250aH3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvInplovlgqzml6XjgpLnorroqo3kuK3igKYg5Y+W5b6X5riI44G/JHtzdC5kYXlzfeaXpWA7CiAgIGxldCBkYXlzO3RyeXtkYXlzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheXM/bW9udGg9JHttb250aH1gKSkuZGF5c3x8W107Y29uc2VjPTB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke21vbnRofe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgZGF5cz1kYXlzLmZpbHRlcihkPT5kPj1hJiZkPD1iKTtsZXQgbW9udGhPaz10cnVlOwogICBmb3IoY29uc3QgZCBvZiBkYXlzKXsKICAgIGlmKFNTVE9QKXttb250aE9rPWZhbHNlO2JyZWFrfQogICAgY29uc3QgbmVlZFJvd3M9IWhhdmVMaXZlLmhhcyhkKSYmIWJrLmhhcyhkKSxuZWVkUGF5PSFoYXZlUGF5LmhhcyhkKTsKICAgIGlmKCFuZWVkUm93cyYmIW5lZWRQYXkpe3N0LnNraXBwZWQrKztjb250aW51ZX0KICAgIGNvbnN0IGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke2R9IOOCkuWPluW+l+S4re+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iVxu5Y+W5b6XJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvI/lpLHmlZcke3N0LmZhaWwubGVuZ3Rofe+8j+e1jOmBjiR7TWF0aC5mbG9vcihlbC82MCl95YiGJHtlbCU2MH3np5JgOwogICAgdHJ5ewogICAgIGNvbnN0IHI9YXdhaXQgZmV0Y2hEYXkoYmFzZSxkKTsKICAgICBpZihyLmZhaWxlZE4pe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgICBpZihuZWVkUm93cyl7YXdhaXQgaWRiUHV0KGBsaXZlOiR7ZH1gLHtsaXZlOnRydWUsZGF0ZTpkLHJvd3M6ci5yb3dzfSk7aGF2ZUxpdmUuYWRkKGQpfQogICAgIGF3YWl0IHBheVB1dChkLHtkYXRlOmQscmFjZXM6ci5wYXlvdXRzLGZhaWxlZDowfSk7aGF2ZVBheS5hZGQoZCk7CiAgICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yLnJhY2VzO2NvbnNlYz0wOwogICAgfWNhdGNoKGUpe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgIGF3YWl0IHNsZWVwKDQwMCk7CiAgIH0KICAgaWYobW9udGhPayYmbW9udGg8Y3VyTW9udGgpYXdhaXQgbWV0YVB1dCgibW9udGg6Iittb250aCx0cnVlKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJzeW5jR28iKS5kaXNhYmxlZD1mYWxzZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWU7CiAgJCgic3luY1N0YXR1cyIpLmlubmVySFRNTD1gJHtzdC5zdG9wcGVkPyLpgKPntprjgZfjgablpLHmlZfjgZfjgZ/jgZ/jgoHkuK3mlq3jgZfjgb7jgZfjgZ/vvIhDbG91ZGZsYXJl5YG044Gu5re36ZuR44O75Yi26ZmQ44Gu5Y+v6IO95oCn77yJ44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOiIifSR7U1NUT1AmJiFzdC5zdG9wcGVkPyLlgZzmraLjgZfjgb7jgZfjgZ/jgIIiOihzdC5zdG9wcGVkPyIiOiLlrozkuobjgIIiKX3ku4rlm57jga7lj5blvpfvvJoke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJYCsoc3QuZmFpbC5sZW5ndGg/YFxuPHNwYW4gY2xhc3M9Indhcm4iPuWkseaVlyAke3N0LmZhaWwubGVuZ3RofeS7tu+8miR7ZXNjKHN0LmZhaWwuc2xpY2UoMCw0KS5qb2luKCLjgIEiKSl9JHtzdC5mYWlsLmxlbmd0aD40PyIg4oCmIjoiIn1cbu+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeWkseaVl+OBl+OBn+aXpeOBoOOBkeOChOOCiuebtOOBl+OBvuOBme+8iTwvc3Bhbj5gOiIiKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Cn07CgoKLyogLS0tIOaJleaIu+OBruabuOOBjeWHuuOBl+ODu+iqreOBv+i+vOOBvyAtLS0gKi8KJCgicGF5RXhwIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXJldHVybiBhbGVydCgi5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIik7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocHMpXSx7dHlwZToiYXBwbGljYXRpb24vanNvbiJ9KSk7CiBhLmRvd25sb2FkPWBrZWliYV9wYXlvdXRzXyR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApfS5qc29uYDthLmNsaWNrKCk7c2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApfTsKJCgicGF5SW1wIikub25jaGFuZ2U9YXN5bmMgZT0+ewogY29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZighZilyZXR1cm47CiB0cnl7Y29uc3Qgaj1KU09OLnBhcnNlKGF3YWl0IGYudGV4dCgpKTtjb25zdCBhcnI9QXJyYXkuaXNBcnJheShqKT9qOihqLnJhY2VzP1tqXTpbXSk7CiAgY29uc3QgYnlEYXRlPW5ldyBNYXAoKTsKICBmb3IoY29uc3QgeCBvZiBhcnIpe2lmKHgmJkFycmF5LmlzQXJyYXkoeC5yYWNlcykmJnguZGF0ZSlieURhdGUuc2V0KHguZGF0ZSx7ZGF0ZTp4LmRhdGUscmFjZXM6eC5yYWNlcyxmYWlsZWQ6eC5mYWlsZWR8fDB9KX0KICBmb3IoY29uc3RbZCxyXW9mIGJ5RGF0ZSlhd2FpdCBwYXlQdXQoZCxyKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZXJyKXskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuiqreOBv+i+vOOBv+OCqOODqeODvO+8miR7ZXNjKGVyci5tZXNzYWdlKX08L3NwYW4+YH0KIGUudGFyZ2V0LnZhbHVlPSIiOwp9OwoKCi8qIC0tLSDikaAtMiDopIfli53lm57lj47njofjga7mpJzoqLwgLS0tICovCiQoImJ0UnVuIikub25jbGljaz1hc3luYygpPT57CiB0cnl7CiAgY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavikaDjgaflj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgcGF5QnlJZD17fTtwcy5mb3JFYWNoKHA9PihwLnJhY2VzfHxbXSkuZm9yRWFjaCh4PT57cGF5QnlJZFt4LnJhY2VJZF09eH0pKTsKICBjb25zdCBzdGFydD0kKCJidFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIjsKICBjb25zdCBwZGF0ZXM9cHMubWFwKHA9PnAuZGF0ZSkuZmlsdGVyKGQ9PmQ+PXN0YXJ0KS5zb3J0KCk7CiAgaWYoIXBkYXRlcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6ZaL5aeL5pel5Lul6ZmN44Gu5omV5oi744GM44GC44KK44G+44Gb44KT44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHNwbGl0PXBkYXRlc1tNYXRoLmZsb29yKHBkYXRlcy5sZW5ndGgvMildOwogIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIGJ1c3kodHJ1ZSwi44OQ44OD44Kv44OG44K544OI5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5EfSk7CiAgYnVzeSh0cnVlLCLjgqrjg4PjgrrmnKrlhaXlipvjga7loLTlkIjjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0UD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5ELHByb3h5OnRydWV9KTtidXN5KGZhbHNlKTt0cnl7c2V0R2F0ZShvdXQsb3V0UCl9Y2F0Y2goZSl7Y29uc29sZS5lcnJvcihlKX0KICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK3vvIjln7rmupbvvIkiLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uO+8iDAuOTLku6XkuIrjg7vjgqrjg4PjgrrmmYLvvIkiLGZvY3VzOiLil47nmoTkuK3njofph43oppbjga4x5L2NIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl9PC9zcGFuPmA6Ii0iOwogIGNvbnN0IHRibD0obyx0aXRsZSk9PnsKICAgbGV0IHQ9YDxiPiR7dGl0bGV9PC9iPjxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvLnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48dGg+5a2m57+S5b6MPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW8uc3RhdHNba107aWYoIXYuYWxsLmJldHMpY29udGludWU7CiAgICB0Kz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkMuYmV0cz9gJHtwY3Qodi5DLnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHYuQy5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt2LkMuYmV0cy50b0xvY2FsZVN0cmluZygpfe+8iTwvc3Bhbj5gOiItIn08L3RkPjwvdHI+YH0KICAgcmV0dXJuIHQrIjwvdGJvZHk+PC90YWJsZT4ifTsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPiR7c3RhcnR944Cc77yP5YmN5Y2K77ydJHtzcGxpdH3jgojjgorliY3jgIHlvozljYrvvJ3ku6XpmY3vvI/lkIQxMDDlhoY8L2Rpdj48YnI+YCt0Ymwob3V0LCLikaAg44Kq44OD44K65YWl5Yqb5pmC77yI5a6f6Zqb44Gu5Lq65rCX44Gn56m044K+44O844Oz44KS5Yik5a6a77yJIikrIjxicj4iK3RibChvdXRQLCLikaEg44Kq44OD44K65pyq5YWl5Yqb5pmC77yI44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgLy8g5p2h5Lu25Yil77yI44OE44O844OrMeS9jeOBruWbnuWPjueOh++8iQogIGNvbnN0IHNlZ1Jvd3M9T2JqZWN0LmVudHJpZXMob3V0LnNlZ3MpLmZpbHRlcigoWyx2XSk9PnYuYWxsLmJldHM+PTMwMCkuc29ydCgoYSxiKT0+YVswXTxiWzBdPy0xOjEpOwogIGlmKHNlZ1Jvd3MubGVuZ3RoKXtoKz1gPGJyPjxiPuKRoiDjg4Tjg7zjg6sx5L2N44Gu5p2h5Lu25Yil77yI4pGg44Gu5aC05ZCI77yJPC9iPjxkaXYgY2xhc3M9InNtYWxsIj7os7zlhaUzMDDlm57ku6XkuIrjga7mnaHku7bjga7jgb/jgILliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+5p2h5Lu2PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IFtrLHZdIG9mIHNlZ1Jvd3MpaCs9YDx0cj48dGQ+JHtlc2Moayl9PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+In0KICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxicj7opovmlrnvvJrjgIzlrabnv5LlvozjgI3jga/jgIHjg6Ljg4fjg6vjga7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIgke01PREVMX1RSQUlOX0VORH3ku6XpmY3vvInjgafjgIHmnIDjgoLkv6HpoLzjgafjgY3jgovliJfjgafjgZnjgILjgZ3jgozku6XliY3jga7mnJ/plpPjga/jgIHjg6Ljg4fjg6vjgYznrZTjgYjjgpLopovjgabjgYTjgovjgZ/jgoHjgIHjgoTjgoToia/jgY/lh7rjgb7jgZnjgILlm57lj47njofjga7jgIzCseOAjeOBrzk1JeOBruiqpOW3ruOBruW5heOBp+OAgTEwMCXjgpLkuIvlm57jgovkuIvpmZDjgarjgonliKnnm4rjgajjga/oqIDjgYjjgb7jgZvjgpPjgILmnaHku7bliKXjga/jgIHmjqLjgZnjgbvjganlgbbnhLbjga7pq5jjgYTmnaHku7bjgpLmi77jgYTjgoTjgZnjgYTjga7jgafjgIHliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jga7jgoLjga7jgaDjgZHjgpLlj4LogIPjgavjgZfjgabjgY/jgaDjgZXjgYTjgILlppnlkbPvvIjluILloLTjgajjga7lt67vvInjga/jgIHmpJzoqLzjgafln7rmupbjgojjgormgqrjgYvjgaPjgZ/jgZ/jgoHjgIHliKTmlq3jgavjga/kvb/jgo/jgarjgYTjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogICQoImJ0T3V0IikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOKRoC0zIOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g++8iOmHjeiznuOBruOBv+ODu+WQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+ijnOato+OBguOCii/jgarjgZfvvIkgLS0tICovCiQoImJ0R3JhZGUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiLHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTtsZXQgZ3JhZGVkPTA7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIHJhY2VzLmZvckVhY2goeD0+e2lmKCh4LnJvd3NbMF0uZ3JkfHwwKT49MilncmFkZWQrK30pOwogIGlmKCFncmFkZWQpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6YGO5Y6744OH44O844K/44Gu5Lit44Gr44CBRzHjgJxHM+OBqOWIpOWIpeOBp+OBjeOCi+ODrOODvOOCueOBjOOBguOCiuOBvuOBm+OCk++8iOOCr+ODqeOCueihqOiomOODuzHnnYDos57ph5HjgYznhKHjgYTvvInjgILjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzjga/mpJzoqLzjgafjgY3jgb7jgZvjgpPjgILikaTjga7lrp/ooYzmmYLjga/jg6zjg7zjgrnlkI3jg7vlh7rppqzooajjga7jgrDjg6zjg7zjg4nooajoqJjjgafoo5zmraPjgZXjgozjgb7jgZnjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgYmFzZT17c3RhcnQsc3BsaXQ6IiIsb29zOk1PREVMX1RSQUlOX0VORCxtaW5HcmQ6Mn07CiAgYnVzeSh0cnVlLCLoo5zmraPjgYLjgoov44Gq44GX44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG9uPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsYmFzZSksb2ZmPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsey4uLmJhc2UsZ3JhZGVPZmY6dHJ1ZX0pO2J1c3koZmFsc2UpOwogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgrSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3guYmV0c33vvIk8L3NwYW4+YDoiLSI7CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lr77osaHvvJrph43os57vvIhHMeOAnEcz77yJJHtvbi5yYWNlc33jg6zjg7zjgrnjgILlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafjgIHoo5zmraPjgYLjgoov44Gq44GX44Gu55qE5Lit546H44O75Zue5Y+O546HKDk1JeW5hSnjgpLmr5TovIPjgZfjgabjgYTjgb7jgZnjgILku7bmlbDjgYzlsJHjgarjgYTjgajlt67jga/lgbbnhLbjga7nr4Tlm7LjgafjgZnvvIjlm57lj47njofjga7CseW5heOBjOmHjeOBquOCi+OBquOCieW3ruOBr+WIpOaWreOBp+OBjeOBvuOBm+OCk++8ieOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7nmoTkuK3njocg44GC44KKPC90aD48dGg+55qE5Lit546HIOOBquOBlzwvdGg+PHRoPuWbnuWPjueOhyDjgYLjgoo8L3RoPjx0aD7lm57lj47njocg44Gq44GXPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IGE9b24uc3RhdHNba10uYWxsLGI9b2ZmLnN0YXRzW2tdLmFsbDtpZighYXx8IWEuYmV0cyljb250aW51ZTsKICAgaCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7KGEuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPiR7YiYmYi5iZXRzPyhiLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpKyIlIjoiLSJ9PC90ZD48dGQ+PGI+JHtjKGEpfTwvYj48L3RkPjx0ZD4ke2MoYil9PC90ZD48L3RyPmB9CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aCsiPC90Ym9keT48L3RhYmxlPiI7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fvvIhDbG91ZGZsYXJlIEtW77yJCiAqIOODu+ODh+ODvOOCv+OBjOWkieOCj+OBo+OBn+OCsOODq+ODvOODl++8iGNzdi3lubTvvI9saXZlLeW5tOaciO+8j3BheS3lubTmnIjvvI9tZXRh77yJ44Gg44GR44KS44CBZ3ppcOOBl+OBpumAgeOCiwogKiDjg7vkv53lrZjlhYjjga7orZjliKXjga/jgIHjg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU277yI44OR44K544OV44Os44O844K644Gd44Gu44KC44Gu44Gv6YCB44KJ44Gq44GE77yJCiAqIOODu+W+qeWFg+OBr+OAgeWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+OAguWQjOOBmOOCreODvOOBruODh+ODvOOCv+OBr+S4iuabuOOBjeOBleOCjOOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEJLPXtwYXNzOiIiLGF1dG86dHJ1ZSxkaXJ0eTpuZXcgU2V0KCksYnVzeTpmYWxzZSxpZDoiIixzYXZlVDpudWxsLHJ1blQ6bnVsbCxpbmZvOm51bGwsbXNnOiIiLGVycjpmYWxzZX07CmNvbnN0IHJhd01ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IHJhd1B1dE1hbnk9cmVjcz0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHN0PVsuLi5uZXcgU2V0KHJlY3MubWFwKHI9PnIucykpXTtpZighc3QubGVuZ3RoKXJldHVybiBvaygpO2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oc3QsInJlYWR3cml0ZSIpO2Zvcihjb25zdCByIG9mIHJlY3MpdC5vYmplY3RTdG9yZShyLnMpLnB1dChyLnYsci5rKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJSYW5nZT0oc3RvcmUscmFuZ2UpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgb3V0PVtdO2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5vcGVuQ3Vyc29yKHJhbmdlKTtxLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7b3V0LnB1c2goe3M6c3RvcmUsazpjLmtleSx2OmMudmFsdWV9KTtjLmNvbnRpbnVlKCl9ZWxzZSBvayhvdXQpfTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYktleXM9c3RvcmU9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKHN0b3JlKS5vYmplY3RTdG9yZShzdG9yZSkuZ2V0QWxsS2V5cygpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKZnVuY3Rpb24gZ3JvdXBPZihzdG9yZSxrZXkpewoga2V5PVN0cmluZyhrZXkpOwogaWYoc3RvcmU9PT0iZmlsZXMiKXtpZihrZXkuc3RhcnRzV2l0aCgibGl2ZToiKSlyZXR1cm4gImxpdmUtIitrZXkuc2xpY2UoNSwxMik7Y29uc3QgeT1rZXkuc3BsaXQoIjoiKVswXTtyZXR1cm4gL14oMHwyMFxkXGQpJC8udGVzdCh5KT8iY3N2LSIreToiY3N2LTAifQogaWYoc3RvcmU9PT0icGF5IilyZXR1cm4gInBheS0iK2tleS5zbGljZSgwLDcpOwogcmV0dXJuICJtZXRhIjsKfQpmdW5jdGlvbiBtYXJrRGlydHkoc3RvcmUsa2V5KXsKIGlmKHN0b3JlPT09Im1ldGEiJiYoa2V5PT09ImRpcnR5Inx8a2V5PT09ImJhY2t1cCIpKXJldHVybjsKIEJLLmRpcnR5LmFkZChncm91cE9mKHN0b3JlLGtleSkpOwogY2xlYXJUaW1lb3V0KEJLLnNhdmVUKTtCSy5zYXZlVD1zZXRUaW1lb3V0KCgpPT57cmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pLmNhdGNoKCgpPT57fSk7YmtSZW5kZXIoKX0sODAwKTsKfQphc3luYyBmdW5jdGlvbiByZWFkR3JvdXAobmFtZSl7CiBsZXQgbTsKIGlmKG5hbWU9PT0ibWV0YSIpcmV0dXJuKGF3YWl0IGlkYlJhbmdlKCJtZXRhIikpLmZpbHRlcihyPT5yLmshPT0iZGlydHkiJiZyLmshPT0iYmFja3VwIik7CiBpZihtPW5hbWUubWF0Y2goL15jc3YtKFxkKykkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYCR7bVsxXX06YCxgJHttWzFdfTtgKSk7CiBpZihtPW5hbWUubWF0Y2goL15saXZlLShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYGxpdmU6JHttWzFdfS0wMGAsYGxpdmU6JHttWzFdfS05OWApKTsKIGlmKG09bmFtZS5tYXRjaCgvXnBheS0oXGR7NH0tXGR7Mn0pJC8pKXJldHVybiBpZGJSYW5nZSgicGF5IixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfS0wMGAsYCR7bVsxXX0tOTlgKSk7CiByZXR1cm5bXTsKfQphc3luYyBmdW5jdGlvbiBhbGxHcm91cHMoKXsKIGNvbnN0IGc9bmV3IFNldCgpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygiZmlsZXMiKSlnLmFkZChncm91cE9mKCJmaWxlcyIsaykpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygicGF5IikpZy5hZGQoZ3JvdXBPZigicGF5IixrKSk7CiBpZigoYXdhaXQgaWRiS2V5cygibWV0YSIpKS5zb21lKGs9PmshPT0iZGlydHkiJiZrIT09ImJhY2t1cCIpKWcuYWRkKCJtZXRhIik7CiByZXR1cm5bLi4uZ107Cn0KYXN5bmMgZnVuY3Rpb24gZ3ooc3RyKXsKIGNvbnN0IHJhdz1uZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc3RyKTsKIGlmKHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbT09PSJ1bmRlZmluZWQiKXJldHVybntidWY6cmF3LGVuYzoicmF3In07CiBjb25zdCBjcz1uZXcgQ29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWNzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUocmF3KTt3LmNsb3NlKCk7CiByZXR1cm57YnVmOm5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShjcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSksZW5jOiJnemlwIn07Cn0KYXN5bmMgZnVuY3Rpb24gZ3VuemlwKGJ1ZixlbmMpewogaWYoZW5jPT09InJhdyIpcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShidWYpOwogY29uc3QgZHM9bmV3IERlY29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWRzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUoYnVmKTt3LmNsb3NlKCk7CiByZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGF3YWl0IG5ldyBSZXNwb25zZShkcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtNYWtlSWQoKXsKIGlmKCEod2luZG93LmNyeXB0byYmY3J5cHRvLnN1YnRsZSkpdGhyb3cgbmV3IEVycm9yKCLjgZPjga7nkrDlooPjgafjga/kvb/jgYjjgb7jgZvjgpPvvIhodHRwcyDjgafplovjgY/lv4XopoHjgYzjgYLjgorjgb7jgZnvvIkiKTsKIGNvbnN0IGQ9YXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoIlNIQS0yNTYiLG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSgia2VpYmEtdXBzZXQtYmFja3VwOnYxOiIrQksucGFzcykpOwogcmV0dXJuWy4uLm5ldyBVaW50OEFycmF5KGQpXS5tYXAoYj0+Yi50b1N0cmluZygxNikucGFkU3RhcnQoMiwiMCIpKS5qb2luKCIiKTsKfQphc3luYyBmdW5jdGlvbiBia0ZldGNoKHBhdGgsb3B0KXsKIGlmKCFCSy5pZClCSy5pZD1hd2FpdCBia01ha2VJZCgpOwogcmV0dXJuIGZldGNoKCQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKStwYXRoLE9iamVjdC5hc3NpZ24oe30sb3B0LHtoZWFkZXJzOk9iamVjdC5hc3NpZ24oeyJ4LWJhY2t1cC1pZCI6QksuaWR9LChvcHQmJm9wdC5oZWFkZXJzKXx8e30pfSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrSlNPTihwYXRoLG9wdCl7CiBjb25zdCByPWF3YWl0IGJrRmV0Y2gocGF0aCxvcHQpLHQ9YXdhaXQgci50ZXh0KCk7bGV0IGo9e307dHJ5e2o9SlNPTi5wYXJzZSh0KX1jYXRjaChlKXt9CiBpZighci5va3x8ai5vaz09PWZhbHNlKXRocm93IG5ldyBFcnJvcihqLmVycm9yfHwoIkhUVFAgIityLnN0YXR1cykpO3JldHVybiBqOwp9CmZ1bmN0aW9uIGJrTXNnKHQsaXNFcnIpe0JLLm1zZz10fHwiIjtCSy5lcnI9ISFpc0Vycjtia1JlbmRlcigpfQpmdW5jdGlvbiBia1JlbmRlcigpewogY29uc3QgZWw9JCgiYmtTdGF0dXMiKTtpZighZWwpcmV0dXJuOwogY29uc3QgbT1CSy5pbmZvLGpzdD1tcz0+bmV3IERhdGUobXMrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgiVCIsIiAiKS5zbGljZSgwLDE2KTsKIGxldCBzdW09IiI7CiBpZighQksucGFzcylzdW09IuODkeOCueODleODrOODvOOCuuOCkuioreWumuOBmeOCi+OBqOOAgeiHquWLleODkOODg+OCr+OCouODg+ODl+OBjOacieWKueOBq+OBquOCiuOBvuOBmeOAgiI7CiBlbHNlIGlmKG0mJm0uZXhpc3RzKXtjb25zdCBjcz1PYmplY3QudmFsdWVzKG0uY2h1bmtzfHx7fSk7c3VtPWDmnIDntYLjg5Djg4Pjgq/jgqLjg4Pjg5fvvJoke2pzdChtLnVwZGF0ZWRBdCl977yIJHtjcy5sZW5ndGh944Kw44Or44O844OX77yPJHsoY3MucmVkdWNlKChzLGMpPT5zK2Muc2l6ZSwwKS8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYH0KIGVsc2Ugc3VtPSLjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgb7jgaDjgYLjgorjgb7jgZvjgpPjgIIiOwogaWYoQksucGFzcylzdW0rPWDvvI/mnKrpgIHkv6Hjga7lpInmm7TvvJoke0JLLmRpcnR5LnNpemV944Kw44Or44O844OXJHtCSy5hdXRvPyLvvIjoh6rli5XjgafpgIHjgorjgb7jgZnvvIkiOiLvvIjoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgqrjg5XvvIkifWA7CiBlbC5pbm5lckhUTUw9KEJLLm1zZz9gPHNwYW4gY2xhc3M9IiR7QksuZXJyPyJ3YXJuIjoiZ29vZCJ9Ij4ke2VzYyhCSy5tc2cpfTwvc3Bhbj5cbmA6IiIpK2VzYyhzdW0pOwp9CmZ1bmN0aW9uIGJrTmVlZFBhc3MoKXtpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOCkjjmloflrZfku6XkuIrjgaflhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybiB0cnVlfXJldHVybiBmYWxzZX0KYXN5bmMgZnVuY3Rpb24gYmtSZWZyZXNoKG1hbil7CiB0cnl7QksuaW5mbz1tYW58fGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpfWNhdGNoKGUpe0JLLmluZm89bnVsbDtpZighQksubXNnKWJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3jgafjgY3jgb7jgZvjgpPvvJoiK2UubWVzc2FnZSx0cnVlKX0KIGJrUmVuZGVyKCk7Cn0KYXN5bmMgZnVuY3Rpb24gcnVuQmFja3VwKGZ1bGwpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTtjb25zdCBpbmZsaWdodD1uZXcgU2V0KEJLLmRpcnR5KTtCSy5kaXJ0eS5jbGVhcigpOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0IiksaGF2ZT1tYW4uZXhpc3RzPyhtYW4uY2h1bmtzfHx7fSk6e307CiAgY29uc3QgbmFtZXM9KGZ1bGx8fCFtYW4uZXhpc3RzKT9hd2FpdCBhbGxHcm91cHMoKTpbLi4uaW5mbGlnaHRdOwogIGlmKCFuYW1lcy5sZW5ndGgpe2JrTXNnKCLlpInmm7Tjga/jgYLjgorjgb7jgZvjgpPjgIIiKTthd2FpdCBia1JlZnJlc2gobWFuKTtyZXR1cm59CiAgY29uc3QgY2h1bmtzPU9iamVjdC5hc3NpZ24oe30saGF2ZSk7bGV0IHNlbnQ9MCxieXRlcz0wOwogIGZvcihsZXQgaT0wO2k8bmFtZXMubGVuZ3RoO2krKyl7CiAgIGNvbnN0IG5hbWU9bmFtZXNbaV07YmtNc2coYOODkOODg+OCr+OCouODg+ODl+S4reKApiAke2krMX0vJHtuYW1lcy5sZW5ndGh977yIJHtuYW1lfe+8iWApOwogICBjb25zdCByZWNzPWF3YWl0IHJlYWRHcm91cChuYW1lKTsKICAgaWYoIXJlY3MubGVuZ3RoKXtpZihjaHVua3NbbmFtZV0pe2F3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gLHttZXRob2Q6IkRFTEVURSJ9KTtkZWxldGUgY2h1bmtzW25hbWVdfWNvbnRpbnVlfQogICBjb25zdCByYXc9SlNPTi5zdHJpbmdpZnkoe2c6bmFtZSxyZWNzfSkse2J1ZixlbmN9PWF3YWl0IGd6KHJhdyk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiUFVUIixib2R5OmJ1Zn0pOwogICBpZighci5vayl7bGV0IGU9IiI7dHJ5e2U9KGF3YWl0IHIuanNvbigpKS5lcnJvcn1jYXRjaChfKXt9dGhyb3cgbmV3IEVycm9yKGV8fCgiSFRUUCAiK3Iuc3RhdHVzKSl9CiAgIGNodW5rc1tuYW1lXT17c2l6ZTpidWYuYnl0ZUxlbmd0aCxyYXdTaXplOnJhdy5sZW5ndGgsbjpyZWNzLmxlbmd0aCxlbmMsYXQ6RGF0ZS5ub3coKX07c2VudCsrO2J5dGVzKz1idWYuYnl0ZUxlbmd0aDsKICB9CiAgaWYoZnVsbHx8IW1hbi5leGlzdHMpe2Zvcihjb25zdCBuIG9mIE9iamVjdC5rZXlzKGhhdmUpKWlmKCFuYW1lcy5pbmNsdWRlcyhuKSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG4pfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3Nbbl19fQogIGNvbnN0IG1hbmlmZXN0PXt2OjEsdXBkYXRlZEF0OkRhdGUubm93KCksY2h1bmtzfTsKICBhd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiLHttZXRob2Q6IlBVVCIsYm9keTpKU09OLnN0cmluZ2lmeShtYW5pZmVzdCksaGVhZGVyczp7ImNvbnRlbnQtdHlwZSI6ImFwcGxpY2F0aW9uL2pzb24ifX0pOwogIG1hbmlmZXN0LmV4aXN0cz10cnVlO2F3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW5pZmVzdC51cGRhdGVkQXR9KTsKICBCSy5pbmZvPW1hbmlmZXN0O2JrTXNnKGDjg5Djg4Pjgq/jgqLjg4Pjg5flrozkuobvvJoke3NlbnR944Kw44Or44O844OX44KS6YCB5L+h77yIJHsoYnl0ZXMvMTA0ODU3NikudG9GaXhlZCgxKX1NQu+8iWApOwogfWNhdGNoKGUpewogIGZvcihjb25zdCBuIG9mIGluZmxpZ2h0KUJLLmRpcnR5LmFkZChuKTtyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSk7CiB9ZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KYXN5bmMgZnVuY3Rpb24gcnVuUmVzdG9yZSgpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTsKIHRyeXsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgbWFuPWF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpOwogIGlmKCFtYW4uZXhpc3RzKXtia01zZygi44GT44Gu44OR44K544OV44Os44O844K644Gu44OQ44OD44Kv44Ki44OD44OX44Gv6KaL44Gk44GL44KK44G+44Gb44KT77yI44OR44K544OV44Os44O844K644KS56K66KqN44GX44Gm44GP44Gg44GV44GE77yJ44CCIix0cnVlKTtyZXR1cm59CiAgY29uc3QgbmFtZXM9T2JqZWN0LmtleXMobWFuLmNodW5rc3x8e30pO2xldCBuPTAsY250PTA7CiAgZm9yKGNvbnN0IG5hbWUgb2YgbmFtZXMpewogICBia01zZyhg5b6p5YWD5Lit4oCmICR7KytufS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWApOwogICBpZighci5vayl0aHJvdyBuZXcgRXJyb3IoYCR7bmFtZX0g44KS5Y+W5b6X44Gn44GN44G+44Gb44KT77yISFRUUCAke3Iuc3RhdHVzfe+8iWApOwogICBjb25zdCBvPUpTT04ucGFyc2UoYXdhaXQgZ3VuemlwKG5ldyBVaW50OEFycmF5KGF3YWl0IHIuYXJyYXlCdWZmZXIoKSksbWFuLmNodW5rc1tuYW1lXS5lbmN8fCJnemlwIikpOwogICBhd2FpdCByYXdQdXRNYW55KG8ucmVjcyk7Y250Kz1vLnJlY3MubGVuZ3RoOwogIH0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjtCQUNLVVBfREFURVM9bnVsbDtCSy5kaXJ0eS5jbGVhcigpOwogIGF3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbXSk7YXdhaXQgcmF3TWV0YVB1dCgiYmFja3VwIix7YXQ6bWFuLnVwZGF0ZWRBdH0pOwogIGF3YWl0IHNob3dTdGF0ZSgpO0JLLmluZm89bWFuO2JrTXNnKGDlvqnlhYPlrozkuobvvJoke25hbWVzLmxlbmd0aH3jgrDjg6vjg7zjg5fvvI8ke2NudC50b0xvY2FsZVN0cmluZygpfeS7tmApOwogfWNhdGNoKGUpe2JrTXNnKCLlvqnlhYPjgavlpLHmlZfjgZfjgb7jgZfjgZ/vvJoiK2UubWVzc2FnZSx0cnVlKX0KIGZpbmFsbHl7QksuYnVzeT1mYWxzZTtia1JlbmRlcigpfQp9CmZ1bmN0aW9uIGJrU2NoZWR1bGUobXMpewogaWYoIUJLLmF1dG98fCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXJldHVybjsKIGNsZWFyVGltZW91dChCSy5ydW5UKTtCSy5ydW5UPXNldFRpbWVvdXQoKCk9PntpZighU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpO2Vsc2UgYmtTY2hlZHVsZSgzMDAwMCl9LG1zfHwzMDAwKTsKfQpmdW5jdGlvbiBia1NhdmVTZXR0aW5ncygpe3RyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgidXBzZXRfYmsiLEpTT04uc3RyaW5naWZ5KHtwYXNzOkJLLnBhc3MsYXV0bzpCSy5hdXRvfSkpfWNhdGNoKGUpe319CmFzeW5jIGZ1bmN0aW9uIGJrSW5pdCgpewogdHJ5e2NvbnN0IG89SlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgidXBzZXRfYmsiKXx8Int9Iik7QksucGFzcz1vLnBhc3N8fCIiO0JLLmF1dG89by5hdXRvIT09ZmFsc2V9Y2F0Y2goZSl7fQogJCgiYmtQYXNzIikudmFsdWU9QksucGFzczskKCJia0F1dG8iKS5jaGVja2VkPUJLLmF1dG87CiAkKCJia1Bhc3MiKS5vbmNoYW5nZT0oKT0+e0JLLnBhc3M9JCgiYmtQYXNzIikudmFsdWUudHJpbSgpO0JLLmlkPSIiO0JLLmluZm89bnVsbDtCSy5tc2c9IiI7YmtTYXZlU2V0dGluZ3MoKTtpZihCSy5wYXNzLmxlbmd0aD49OClia1JlZnJlc2goKTtlbHNlIGJrUmVuZGVyKCl9OwogJCgiYmtTaG93Iikub25jbGljaz0oKT0+e2NvbnN0IHA9JCgiYmtQYXNzIik7cC50eXBlPXAudHlwZT09PSJwYXNzd29yZCI/InRleHQiOiJwYXNzd29yZCI7JCgiYmtTaG93IikudGV4dENvbnRlbnQ9cC50eXBlPT09InBhc3N3b3JkIj8i6KGo56S6Ijoi6Zqg44GZIn07CiAkKCJia0F1dG8iKS5vbmNoYW5nZT0oKT0+e0JLLmF1dG89JCgiYmtBdXRvIikuY2hlY2tlZDtia1NhdmVTZXR0aW5ncygpO2JrUmVuZGVyKCk7aWYoQksuYXV0bylia1NjaGVkdWxlKDIwMDApfTsKICQoImJrTm93Iikub25jbGljaz0oKT0+cnVuQmFja3VwKGZhbHNlKTsKICQoImJrRnVsbCIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZnjgbnjgabjga7jg4fjg7zjgr/jgpLjgIHjgYLjgonjgZ/jgoHjgabkv53lrZjjgZfnm7TjgZfjgb7jgZnjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5CYWNrdXAodHJ1ZSl9OwogJCgiYmtSZXN0b3JlIikub25jbGljaz0oKT0+e2lmKGNvbmZpcm0oIuOBk+OBruerr+acq+OBruODh+ODvOOCv+OCkuOAgeODkOODg+OCr+OCouODg+ODl+OBruWGheWuueOBp+S4iuabuOOBjeOBl+OBvuOBme+8iOODkOODg+OCr+OCouODg+ODl+OBq+OBguOCi+ODh+ODvOOCv+OBoOOBkeOBjOWvvuixoeOBp+OBme+8ieOAguOCiOOCjeOBl+OBhOOBp+OBmeOBi++8nyIpKXJ1blJlc3RvcmUoKX07CiB0cnl7Y29uc3QgZD1hd2FpdCBtZXRhR2V0KCJkaXJ0eSIpO2lmKEFycmF5LmlzQXJyYXkoZCkpZC5mb3JFYWNoKHg9PkJLLmRpcnR5LmFkZCh4KSl9Y2F0Y2goZSl7fQogdHJ5e2lmKG5hdmlnYXRvci5zdG9yYWdlJiZuYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KW5hdmlnYXRvci5zdG9yYWdlLnBlcnNpc3QoKS5jYXRjaCgoKT0+e30pfWNhdGNoKGUpe30KIGJrUmVuZGVyKCk7CiBpZihCSy5wYXNzLmxlbmd0aD49OCl7YXdhaXQgYmtSZWZyZXNoKCk7aWYoQksuZGlydHkuc2l6ZSlia1NjaGVkdWxlKDUwMDApfQogc2V0SW50ZXJ2YWwoKCk9PntpZihCSy5hdXRvJiZCSy5wYXNzLmxlbmd0aD49OCYmQksuZGlydHkuc2l6ZSYmIUJLLmJ1c3kmJiFTWU5DSU5HKXJ1bkJhY2t1cChmYWxzZSl9LHdpbmRvdy5fX0JLX1RJQ0t8fDkwMDAwMCk7Cn0KCgoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOazouS5seW6puOBruWGjeagoeatowogKiAg55uu55qE77ya5rOi5Lmx5bqm44Gu44CM5b2T44Gf44KK5pa544CN44KS44CB6Ieq5YiG44Gu6YGO5Y6744OH44O844K/44Gn56K644GL44KB44CB5L+h6aC844Gn44GN44KL5pWw5a2X44Gg44GR44KS5Ye644GZ44CCCiAqICDjgoTjgovjgZPjgajvvJoKICogICAxKSDpgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgasx44Gk44Ga44Gk5YaN54++44GX44CB44Os44O844K55YmN44Gr5YiG44GL44KL5oOF5aCx44Gg44GR44Gn5rOi5Lmx5bqm44KS6KiI566XCiAqICAgMikg54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yITU9ERUxfVFJBSU5fRU5E5Lul6ZmN77yJ44Gn44CB5a6f6Zqb44Gu5rOi5Lmx546H44Go56qB44GN5ZCI44KP44Gb44KLCiAqICAgMykg44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546H77yI6ZaL5YKs5aC0w5foip3jg4DDl+i3nembosOX44Kv44Op44K577yJ44Gq44Gp44KS6Laz44GX44Gf5paw44Oi44OH44Or44KS5L2c44KK44CB5ZCM44GY5pyf6ZaT44Gn5q+U6LyDCiAqICAgNCkg5a++5pWw5pCN5aSx44GM5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Go44GN44Gg44GR5o6h55So44CC44Gd44GG44Gn44Gq44GR44KM44Gw54++6KGM44Gu44G+44G+44Gr44GX44Gm44CB5a6f57i+546H44Gg44GR5qSc6Ki85YCk44Gr5beu44GX5pu/44GI44KLCiAqICDms6LkubHvvJ0z552A5Lul5YaF44Gu6aas44Gu5Lq65rCX44Gu5ZCI6KiI44GM6Za+5YCkKOePvuihjOODouODh+ODq+OBqOWQjOOBmDE1KeS7peS4igogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IFVQS0VZPSJrZWliYV91cHNldF92MSI7CmNvbnN0IHNpZ209ej0+MS8oMStNYXRoLmV4cCgteikpLGxndD1wPT57cD1NYXRoLm1pbiguOTk5LE1hdGgubWF4KC4wMDEscCkpO3JldHVybiBNYXRoLmxvZyhwLygxLXApKX07CmZ1bmN0aW9uIHdpbHNvbihrLG4pe2lmKCFuKXJldHVyblswLDFdO2NvbnN0IHo9MS45NixwPWsvbixkPTEreip6L24sYz1wK3oqei8oMipuKSxhPXoqTWF0aC5zcXJ0KHAqKDEtcCkvbit6KnovKDQqbipuKSk7cmV0dXJuWyhjLWEpL2QsKGMrYSkvZF19CmNvbnN0IGRpc3RCPWQ9Pk1hdGgubWF4KDEwMDAsTWF0aC5taW4oMzIwMCxNYXRoLnJvdW5kKChkfHwwKS8yMDApKjIwMCkpOwpjb25zdCBsdmxHPShsLGcpPT4obHx8MCkrKGc+PTI/IkciOiIiKTsKCi8qIOODrOODvOOCueOBrumbhuioiO+8iOihjOOCkuWFqOmDqOaMgeOBn+OBmuOBq+a4iOOCgOi7veOBhOW9ou+8ieKGkiDjg6zjg7zjgrnmg4XloLEgKi8KZnVuY3Rpb24gYWdnQWRkKG1hcCxyKXsKIGlmKCFyLnJhY2VJZHx8IXIuaG9yc2V8fHIuZmluaXNoPT1udWxsKXJldHVybjsKIGxldCBhPW1hcC5nZXQoci5yYWNlSWQpOwogaWYoIWEpbWFwLnNldChyLnJhY2VJZCxhPXtpZDpTdHJpbmcoci5yYWNlSWQpLGRhdGU6ci5kYXRlLHN1cmY6ci5zdXJmLGRpc3Q6ci5kaXN0LGx2bDpyLmx2bHx8MCxncmQ6ci5ncmR8fDAsTjowLHQ6W119KTsKIGEuTisrO2lmKHIuZmluaXNoPD0zJiZyLnBvcD4wKWEudC5wdXNoKFtyLmZpbmlzaCxyLnBvcF0pOwp9CmZ1bmN0aW9uIGFnZ0luZm8oYSl7CiBpZighYXx8YS5OPDYpcmV0dXJuIG51bGw7CiBjb25zdCB2PS9eXGR7MTJ9JC8udGVzdChhLmlkKT9hLmlkLnNsaWNlKDQsNik6KFN0cmluZyhhLmlkKS5zcGxpdCgiLSIpWzNdfHwiIik7CiBjb25zdCB0PWEudC5zbGljZSgpLnNvcnQoKHgseSk9PnhbMF0teVswXSk7CiBjb25zdCB5PXQubGVuZ3RoPj0zPyh0WzBdWzFdK3RbMV1bMV0rdFsyXVsxXT49VUUuQVhJUy51cHNldC50aHI/MTowKTpudWxsOwogcmV0dXJue2RhdGU6YS5kYXRlLHYsc3VyZjphLnN1cmYsZGlzdDphLmRpc3QsbHZsOmEubHZsLGdyZDphLmdyZCxOOmEuTix5fTsKfQoKLyog44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546H77yI5bCR44Gq44GE44OH44O844K/44Gv5YWo5L2T44G45a+E44Gb44KL77yJICovCmNsYXNzIFVwUHJpewogY29uc3RydWN0b3IoKXt0aGlzLmJhc2U9e246MCx1OjB9O3RoaXMubT1uZXcgTWFwKCl9CiBfayhpKXtyZXR1cm5bIlYiK2kudiwiQyIraS52KyJ8IitpLnN1cmYrInwiK2Rpc3RCKGkuZGlzdCksIkwiK2kuc3VyZisifCIrZGlzdEIoaS5kaXN0KSsifCIrbHZsRyhpLmx2bCxpLmdyZCldfQogYWRkKGkpe2lmKCFpfHxpLnk9PW51bGwpcmV0dXJuO3RoaXMuYmFzZS5uKys7dGhpcy5iYXNlLnUrPWkueTtmb3IoY29uc3QgayBvZiB0aGlzLl9rKGkpKXtsZXQgeD10aGlzLm0uZ2V0KGspO2lmKCF4KXRoaXMubS5zZXQoayx4PXtuOjAsdTowfSk7eC5uKys7eC51Kz1pLnl9fQogZmVhdChpKXsKICBjb25zdCBiPXRoaXMuYmFzZS5uPjIwMD90aGlzLmJhc2UudS90aGlzLmJhc2UubjouMjg1LEs9NDA7CiAgY29uc3Qgc2g9KGsscGFyKT0+e2NvbnN0IHg9dGhpcy5tLmdldChrKXx8e246MCx1OjB9O3JldHVybih4LnUrSypwYXIpLyh4Lm4rSyl9OwogIGNvbnN0IFtrdixrYyxrbF09dGhpcy5fayhpKSxwdj1zaChrdixiKSxwYz1zaChrYyxwdikscGw9c2goa2wsYiksbGI9bGd0KGIpOwogIHJldHVybltsZ3QocHYpLWxiLGxndChwYyktbGIsbGd0KHBsKS1sYl07CiB9Cn0KCi8qIOODreOCuOOCueODhuOCo+ODg+OCr+WbnuW4sO+8iOODi+ODpeODvOODiOODs+azleODu0wy5q2j5YmH5YyW44O75qiZ5rqW5YyW77yJICovCmZ1bmN0aW9uIHNvbHZlTGluKEEsYil7CiBjb25zdCBuPWIubGVuZ3RoLE09QS5tYXAoKHIsaSk9PlsuLi5yLGJbaV1dKTsKIGZvcihsZXQgYz0wO2M8bjtjKyspewogIGxldCBwPWM7Zm9yKGxldCByPWMrMTtyPG47cisrKWlmKE1hdGguYWJzKE1bcl1bY10pPk1hdGguYWJzKE1bcF1bY10pKXA9cjsKICBbTVtjXSxNW3BdXT1bTVtwXSxNW2NdXTtjb25zdCBkPU1bY11bY118fDFlLTk7CiAgZm9yKGxldCBrPWM7azw9bjtrKyspTVtjXVtrXS89ZDsKICBmb3IobGV0IHI9MDtyPG47cisrKWlmKHIhPT1jKXtjb25zdCBmPU1bcl1bY107aWYoZilmb3IobGV0IGs9YztrPD1uO2srKylNW3JdW2tdLT1mKk1bY11ba119CiB9CiByZXR1cm4gTS5tYXAocj0+cltuXSk7Cn0KZnVuY3Rpb24gZml0TG9naXQoWCx5LGwyKXsKIGNvbnN0IG49WC5sZW5ndGgsZD1YWzBdLmxlbmd0aCxtdT1BcnJheShkKS5maWxsKDApLHNkPUFycmF5KGQpLmZpbGwoMCk7CiBmb3IoY29uc3QgciBvZiBYKWZvcihsZXQgaj0wO2o8ZDtqKyspbXVbal0rPXJbal0vbjsKIGZvcihjb25zdCByIG9mIFgpZm9yKGxldCBqPTA7ajxkO2orKylzZFtqXSs9KHJbal0tbXVbal0pKioyL247CiBmb3IobGV0IGo9MDtqPGQ7aisrKXNkW2pdPU1hdGguc3FydChzZFtqXSl8fDE7CiBjb25zdCBaPVgubWFwKHI9PlsxLC4uLnIubWFwKCh2LGopPT4odi1tdVtqXSkvc2Rbal0pXSksRD1kKzEsdz1BcnJheShEKS5maWxsKDApOwogZm9yKGxldCBpdD0wO2l0PDMwO2l0KyspewogIGNvbnN0IGc9QXJyYXkoRCkuZmlsbCgwKSxIPUFycmF5LmZyb20oe2xlbmd0aDpEfSwoKT0+QXJyYXkoRCkuZmlsbCgwKSk7CiAgZm9yKGxldCBpPTA7aTxuO2krKyl7Y29uc3Qgej1aW2ldO2xldCBzPTA7Zm9yKGxldCBqPTA7ajxEO2orKylzKz13W2pdKnpbal07CiAgIGNvbnN0IHA9c2lnbShzKSxlPXAteVtpXSxxPXAqKDEtcCk7CiAgIGZvcihsZXQgaj0wO2o8RDtqKyspe2dbal0rPWUqeltqXTtmb3IobGV0IGs9ajtrPEQ7aysrKUhbal1ba10rPXEqeltqXSp6W2tdfX0KICBmb3IobGV0IGo9MTtqPEQ7aisrKXtnW2pdKz1sMip3W2pdO0hbal1bal0rPWwyfQogIGZvcihsZXQgaj0wO2o8RDtqKyspZm9yKGxldCBrPTA7azxqO2srKylIW2pdW2tdPUhba11bal07CiAgSFswXVswXSs9MWUtOTsKICBjb25zdCBkdz1zb2x2ZUxpbihILGcpO2xldCBteD0wO2ZvcihsZXQgaj0wO2o8RDtqKyspe3dbal0tPWR3W2pdO214PU1hdGgubWF4KG14LE1hdGguYWJzKGR3W2pdKSl9CiAgaWYobXg8MWUtNylicmVhazsKIH0KIHJldHVybnt3LG11LHNkfTsKfQpjb25zdCBwcmVkTG9naXQ9KG0seCk9PntsZXQgcz1tLndbMF07Zm9yKGxldCBqPTA7ajx4Lmxlbmd0aDtqKyspcys9bS53W2orMV0qKHhbal0tbS5tdVtqXSkvbS5zZFtqXTtyZXR1cm4gc307CgovKiDoqZXkvqHmjIfmqJnvvJrlr77mlbDmkI3lpLHjg7vjg5bjg6njgqTjg6Tjg7zjg7tBVUPjg7vovIPmraPoqqTlt64oRUNFKSAqLwpmdW5jdGlvbiBhdWNPZihwLHkpewogY29uc3QgaWR4PXAubWFwKChfLGkpPT5pKS5zb3J0KChhLGIpPT5wW2FdLXBbYl0pO2xldCBycz0wLG4xPTA7CiBmb3IobGV0IHI9MDtyPGlkeC5sZW5ndGg7cisrKXtpZih5W2lkeFtyXV0pe3JzKz1yKzE7bjErK319CiBjb25zdCBuMD15Lmxlbmd0aC1uMTtyZXR1cm4gbjEmJm4wPyhycy1uMSoobjErMSkvMikvKG4xKm4wKTouNTsKfQpmdW5jdGlvbiBtZXRyaWNzT2YocCx5KXsKIGNvbnN0IG49eS5sZW5ndGg7bGV0IGxsPTAsYnI9MDsKIGZvcihsZXQgaT0wO2k8bjtpKyspe2NvbnN0IHE9TWF0aC5taW4oMS0xZS05LE1hdGgubWF4KDFlLTkscFtpXSkpO2xsLT15W2ldP01hdGgubG9nKHEpOk1hdGgubG9nKDEtcSk7YnIrPShwW2ldLXlbaV0pKioyfQogY29uc3QgaWR4PXAubWFwKChfLGkpPT5pKS5zb3J0KChhLGIpPT5wW2FdLXBbYl0pLEI9MTA7bGV0IGVjZT0wOwogZm9yKGxldCBiPTA7YjxCO2IrKyl7Y29uc3Qgcz1pZHguc2xpY2UoTWF0aC5mbG9vcihiKm4vQiksTWF0aC5mbG9vcigoYisxKSpuL0IpKTtpZighcy5sZW5ndGgpY29udGludWU7CiAgY29uc3QgbXA9cy5yZWR1Y2UoKGEsaSk9PmErcFtpXSwwKS9zLmxlbmd0aCxteT1zLnJlZHVjZSgoYSxpKT0+YSt5W2ldLDApL3MubGVuZ3RoO2VjZSs9TWF0aC5hYnMobXAtbXkpKnMubGVuZ3RoL259CiByZXR1cm57bixsbDpsbC9uLGJyaWVyOmJyL24sYXVjOmF1Y09mKHAseSksZWNlfTsKfQoKLyog562J57Sa77ya5LqI5ris56K6546H44Gu6auY44GE6aCG44Gr5LiK5L2NIDMlIC8gNyUgLyAxMiUgLyAyMCUgLyAyOCUgLyDmrovjgorvvIhTU1MvU1MvUy9BL0IvQ++8iSAqLwpjb25zdCBVUF9TSEFSRT1bWyJTU1MiLC4wM10sWyJTUyIsLjA3XSxbIlMiLC4xMl0sWyJBIiwuMjBdLFsiQiIsLjI4XSxbIkMiLC4zMF1dOwpmdW5jdGlvbiBtYWtlQ3V0cyhwcyl7CiBjb25zdCBzPXBzLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi1hKTtsZXQgYWNjPTA7Y29uc3QgY3V0cz1bXTsKIGZvcihjb25zdCBbZyxzaF0gb2YgVVBfU0hBUkUpe2FjYys9c2g7aWYoZz09PSJDIil7Y3V0cy5wdXNoKFtnLC0xXSk7YnJlYWt9Y3V0cy5wdXNoKFtnLHNbTWF0aC5taW4ocy5sZW5ndGgtMSxNYXRoLm1heCgwLE1hdGgucm91bmQocy5sZW5ndGgqYWNjKS0xKSldXSl9CiByZXR1cm4gY3V0czsKfQpjb25zdCBncmFkZU9mPShjdXRzLHApPT57Zm9yKGNvbnN0IFtnLGNdIG9mIGN1dHMpaWYocD49YylyZXR1cm4gZztyZXR1cm4iQyJ9OwpmdW5jdGlvbiBncmFkZVRhYmxlKGN1dHMscHMseXMpewogY29uc3QgdD17fTtVUF9TSEFSRS5mb3JFYWNoKChbZ10pPT50W2ddPXtuOjAsazowfSk7CiBwcy5mb3JFYWNoKChwLGkpPT57Y29uc3QgeD10W2dyYWRlT2YoY3V0cyxwKV07eC5uKys7eC5rKz15c1tpXX0pOwogZm9yKGNvbnN0IGcgaW4gdCl7Y29uc3QgeD10W2ddLHc9d2lsc29uKHguayx4Lm4pO3gucmF0ZT14Lm4/eC5rL3gubjowO3gubG89d1swXTt4LmhpPXdbMV19CiByZXR1cm4gdDsKfQoKLyog5paw44Oi44OH44Or44Gu5YWl5Yqb77ya54++6KGM44Oi44OH44Or44Gu54m55b606YePKDE3KSDvvIsg44Kq44OD44K654m55b606YePKDcsIOOBquOBkeOCjOOBsDApIO+8iyDjgqrjg4PjgrrmnInnhKEg77yLIOOCs+ODvOOCueWIpeOBrumBjuWOu+azouS5seeOhygzKSAqLwpmdW5jdGlvbiB1cFgodSxlKXsKIGNvbnN0IG9kZHM9dS5tb2RlPT09Im9kZHMiOwogcmV0dXJuWy4uLnUuZi5zbGljZSgxLDE4KSwuLi4ob2Rkcz91LmYuc2xpY2UoMTgsMjUpOlswLDAsMCwwLDAsMCwwXSksb2Rkcz8xOjAsLi4uZV07Cn0KZnVuY3Rpb24gdXBzZXRDdXN0b20oTSx1LGUpewogaWYoIU0pcmV0dXJuIG51bGw7CiBsZXQgejtjb25zdCB6MD1sZ3QodS5wMCk7CiBpZihNLmtpbmQ9PT0ib2xkIil6PXowOwogZWxzZSBpZihNLmtpbmQ9PT0ibmV3Iil6PXByZWRMb2dpdChNLm1vZGVsLHVwWCh1LGUpKTsKIGVsc2UgaWYoTS5raW5kPT09ImJsZW5kIil6PSh6MCtwcmVkTG9naXQoTS5tb2RlbCx1cFgodSxlKSkpLzI7CiBlbHNlIHJldHVybiBudWxsOwogY29uc3QgcD1zaWdtKHopLGc9Z3JhZGVPZihNLmN1dHMscCkscj1NLnJhdGVzJiZNLnJhdGVzW2ddfHx7fTsKIHJldHVybntncmFkZTpnLHAscmF0ZTpyLnJhdGU/P251bGwsbG86ci5sbz8/bnVsbCxoaTpyLmhpPz9udWxsLG46ci5uPz8wfTsKfQpjb25zdCBnZXRVcHNldE1vZGVsPSgpPT57dHJ5e2NvbnN0IG09SlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShVUEtFWSl8fCJudWxsIik7cmV0dXJuIG0mJm0uY3V0cz9tOm51bGx9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsKCi8qIC0tLS0tLS0tLS0g5qSc6Ki844Go5YaN5qCh5q2j44Gu5pys5L2TIC0tLS0tLS0tLS0gKi8KYXN5bmMgZnVuY3Rpb24gcnVuVXBzZXRGaXQob3B0cyl7CiBvcHRzPW9wdHN8fHt9OwogY29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IjIwMjEtMDEtMDEiLFRFU1Q9b3B0cy50ZXN0U3RhcnR8fE1PREVMX1RSQUlOX0VORCxvdXQ9W107CiBidXN5KHRydWUsIuaIkOe4vuOCkuiqreOBv+i+vOOBv+S4reKApiIpOwogY29uc3QgbWFwPW5ldyBNYXAoKTsKIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogaWYocmFjZXMubGVuZ3RoPDUwMCl7YnVzeShmYWxzZSk7cmV0dXJue2Vycm9yOiLpgY7ljrvjg4fjg7zjgr/jgYzlsJHjgarjgZnjgY7jgb7jgZnvvIgiK3JhY2VzLmxlbmd0aCsi44Os44O844K577yJ44CC5YWI44Gr6YGO5Y6744Os44O844K544KS5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCIn19CiBjb25zdCBzdG9yZT1uZXcgVUUuU3RvcmUoKSxwcmk9bmV3IFVwUHJpKCksUz1bXTsKIGZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krKyl7CiAgY29uc3QgcmM9cmFjZXNbaV0sYW09bmV3IE1hcCgpO2Zvcihjb25zdCByIG9mIHJjLnJvd3MpYWdnQWRkKGFtLHIpOwogIGNvbnN0IGluZm89YWdnSW5mbyhhbS5nZXQoU3RyaW5nKHJjLnJvd3NbMF0mJnJjLnJvd3NbMF0ucmFjZUlkKSkpOwogIGlmKGluZm8mJmluZm8ueSE9bnVsbCYmcmMuZGF0ZT49U1RBUlQpewogICBjb25zdCBSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpOwogICBjb25zdCBoYXNPZGRzPVIuZXZlcnkocj0+ci5vZGRzPjEpLG9kPWhhc09kZHM/Ui5tYXAocj0+ci5vZGRzKTpudWxsOwogICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLGdyZDpSWzBdLmdyZHx8MCxydW5uZXJzOlJ9OwogICB0cnl7CiAgICBjb25zdCBhcD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCksdT1VRS51cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsb2QsYXApOwogICAgUy5wdXNoKHtkYXRlOnJjLmRhdGUsdSxlOnByaS5mZWF0KGluZm8pLHk6aW5mby55fSk7CiAgIH1jYXRjaChlKXt9CiAgfQogIHByaS5hZGQoaW5mbyk7Zm9yKGNvbnN0IHIgb2YgcmMucm93cylzdG9yZS5hZGQocik7CiAgaWYoaSUzMD09PTI5KXtidXN5KHRydWUsYOaZguezu+WIl+OBq+WGjeePvuOBl+OBpuaknOiovOS4reKApiAke2krMX0vJHtyYWNlcy5sZW5ndGh944Os44O844K5YCk7YXdhaXQgc2xlZXAoMCl9CiB9CiBidXN5KHRydWUsIuODouODh+ODq+OCkuavlOi8g+S4reKApiIpO2F3YWl0IHNsZWVwKDApOwogY29uc3QgdHJhaW49Uy5maWx0ZXIocz0+cy5kYXRlPFRFU1QpLHRlc3Q9Uy5maWx0ZXIocz0+cy5kYXRlPj1URVNUKTsKIGNvbnN0IHJlcz17bkFsbDpTLmxlbmd0aCxuVHJhaW46dHJhaW4ubGVuZ3RoLG5UZXN0OnRlc3QubGVuZ3RoLHN0YXJ0OlNUQVJULHRlc3RTdGFydDpURVNULGJhc2U6Uy5sZW5ndGg/Uy5yZWR1Y2UoKGEscyk9PmErcy55LDApL1MubGVuZ3RoOjB9OwogaWYodGVzdC5sZW5ndGg8MzAwfHx0cmFpbi5sZW5ndGg8MTUwMCl7YnVzeShmYWxzZSk7cmV0dXJuey4uLnJlcyxlcnJvcjpg5qSc6Ki844Gr5L2/44GI44KL5pyf6ZaT44Gu44Os44O844K544GM6Laz44KK44G+44Gb44KT77yI5a2m57+S5YG0JHt0cmFpbi5sZW5ndGh944O75qSc6Ki85YG0JHt0ZXN0Lmxlbmd0aH3vvInjgILmpJzoqLzjga7plovlp4vml6XjgpLml6njgoHjgovjgYvjgIHjg4fjg7zjgr/jgpLlopfjgoTjgZfjgabjgY/jgaDjgZXjgYTjgIJgfX0KIGNvbnN0IHlUPXRlc3QubWFwKHM9PnMueSkseTA9dHJhaW4ubWFwKHM9PnMueSk7CiAvLyDnj77ooYzjg6Ljg4fjg6vjga7mpJzoqLzmnJ/plpPjgafjga7miJDnuL4KIGNvbnN0IHAwPXRlc3QubWFwKHM9PnMudS5wMCksbTA9bWV0cmljc09mKHAwLHlUKTsKIC8vIOaWsOODouODh+ODq++8iOWtpue/kuacn+mWk+OBruOBv+OBp+S9nOOCi++8iQogY29uc3QgbWRsPWZpdExvZ2l0KHRyYWluLm1hcChzPT51cFgocy51LHMuZSkpLHkwLDMpOwogY29uc3QgcE49dGVzdC5tYXAocz0+c2lnbShwcmVkTG9naXQobWRsLHVwWChzLnUscy5lKSkpKSxtTj1tZXRyaWNzT2YocE4seVQpOwogY29uc3QgcEI9dGVzdC5tYXAoKHMsaSk9PnNpZ20oKGxndChwMFtpXSkrcHJlZExvZ2l0KG1kbCx1cFgocy51LHMuZSkpKS8yKSksbUI9bWV0cmljc09mKHBCLHlUKTsKIHJlcy5tMD1tMDtyZXMubU49bU47cmVzLm1CPW1COwogLy8g5o6h55So44Gu5Yik5pat77ya5a++5pWw5pCN5aSx44GMMC4wMDLku6XkuIroia/jgY/jgarjgorjgIFBVUPjgYzmgqrljJbjgZfjgabjgYTjgarjgYTjgZPjgagKIGNvbnN0IGJldHRlcj0obSxyZWYpPT4ocmVmLmxsLW0ubGw+PS4wMDIpJiYobS5hdWM+PXJlZi5hdWMtLjAwMyk7CiBsZXQga2luZD0ib2xkIjsKIGNvbnN0IGNhbmQ9W1sibmV3IixtTl0sWyJibGVuZCIsbUJdXS5maWx0ZXIoKFtrLG1dKT0+YmV0dGVyKG0sbTApKS5zb3J0KChhLGIpPT5hWzFdLmxsLWJbMV0ubGwpWzBdOwogaWYoY2FuZClraW5kPWNhbmRbMF07CiByZXMua2luZD1raW5kOwogLy8g562J57Sa44Gu5YiH44KM55uu44Gv44CM5a2m57+S5YG044CN44Gu5LqI5ris44GL44KJ5rG644KB44CB5qSc6Ki85YG044Gn5a6f6Zqb44Gu5rOi5Lmx546H44KS5ris44KL77yI5q2j55u044Gq5a6f57i+546H77yJCiBjb25zdCBwcmVkVHJhaW49cz0+a2luZD09PSJvbGQiP3MudS5wMDpraW5kPT09Im5ldyI/c2lnbShwcmVkTG9naXQobWRsLHVwWChzLnUscy5lKSkpOnNpZ20oKGxndChzLnUucDApK3ByZWRMb2dpdChtZGwsdXBYKHMudSxzLmUpKSkvMik7CiBjb25zdCBjdXRzPW1ha2VDdXRzKHRyYWluLm1hcChwcmVkVHJhaW4pKTsKIGNvbnN0IHBUZXN0PXRlc3QubWFwKHByZWRUcmFpbiksdGFiPWdyYWRlVGFibGUoY3V0cyxwVGVzdCx5VCk7CiByZXMuY3V0cz1jdXRzO3Jlcy50YWI9dGFiOwogcmVzLm1vZGVsPXtraW5kLG1vZGVsOm1kbCxjdXRzLHJhdGVzOk9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh0YWIpLm1hcCgoW2cseF0pPT5bZyx7cmF0ZTp4LnJhdGUsbG86eC5sbyxoaTp4LmhpLG46eC5ufV0pKSwKICBhdDpuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCksblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCx0ZXN0U3RhcnQ6VEVTVCxtMCxtTixtQn07CiBidXN5KGZhbHNlKTtyZXR1cm4gcmVzOwp9CgpmdW5jdGlvbiB1cHNldFJlcG9ydChyKXsKIGlmKHIuZXJyb3IpcmV0dXJuYDxzcGFuIGNsYXNzPSJiYWQiPiR7ZXNjKHIuZXJyb3IpfTwvc3Bhbj5gOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCkscm93PShsLG0pPT5gPHRyPjx0ZD4ke2x9PC90ZD48dGQ+JHtmKG0ubGwpfTwvdGQ+PHRkPiR7ZihtLmJyaWVyKX08L3RkPjx0ZD4ke20uYXVjLnRvRml4ZWQoMyl9PC90ZD48dGQ+JHsobS5lY2UqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjwvdHI+YDsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S5YG0ICR7ci5uVHJhaW5944Os44O844K577yI44CcJHtlc2Moci50ZXN0U3RhcnQpfeOBruWJjeaXpe+8ie+8j+aknOiovOWBtCAke3IublRlc3R944Os44O844K577yIJHtlc2Moci50ZXN0U3RhcnQpfeS7pemZje+8neePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8ieOAguWFqOS9k+OBruazouS5seeOhyAke3BjdChyLmJhc2UsMSl944CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+44Oi44OH44Or77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+6Kqk5beu4oaTPC90aD48dGg+QVVD4oaRPC90aD48dGg+6LyD5q2j6Kqk5beu4oaTPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PiR7cm93KCLnj77ooYwiLHIubTApfSR7cm93KCLmlrDvvIjjgrPjg7zjgrnliKXjgpLov73liqDvvIkiLHIubU4pfSR7cm93KCLnj77ooYzjgajmlrDjga7lubPlnYciLHIubUIpfTwvdGJvZHk+PC90YWJsZT48L2Rpdj5gOwogY29uc3Qgbm09e29sZDoi54++6KGM44Oi44OH44Or44Gu44G+44G+77yI5paw44Oi44OH44Or44Gv5piO56K644Gr44Gv6Imv44GP44Gq44KJ44Gq44GL44Gj44Gf77yJIixuZXc6IuaWsOODouODh+ODq+OCkuaOoeeUqCIsYmxlbmQ6IuePvuihjOOBqOaWsOOBruW5s+Wdh+OCkuaOoeeUqCJ9W3Iua2luZF07CiBoKz1gPGRpdiBjbGFzcz0iYmFubmVyICR7ci5raW5kPT09Im9sZCI/InduIjoib2sifSI+PGI+57WQ5p6c77yaJHtubX08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5o6h55So5p2h5Lu277ya5a++5pWw5pCN5aSx44GMMC4wMDLku6XkuIrmlLnlloTjgZfjgIFBVUPjgYzmgqrljJbjgZfjgabjgYTjgarjgYTjgZPjgajjgII8L3NwYW4+PC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+562J57Sa44GU44Go44GuPGI+5a6f6Zqb44Gu5rOi5Lmx546HPC9iPu+8iOaknOiovOWBtOODuzk1JeOBruW5he+8ieOAguOBk+OBruaVsOWtl+OBjOOAgeazouS5seW6puOCv+ODluOBq+ihqOekuuOBleOCjOOCi+OCiOOBhuOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7nrYnntJo8L3RoPjx0aD7jg6zjg7zjgrnmlbA8L3RoPjx0aD7lrp/pmpvjga7ms6LkubHnjoc8L3RoPjx0aD45NSXjga7luYU8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCBbZ10gb2YgVVBfU0hBUkUpe2NvbnN0IHg9ci50YWJbZ107aCs9YDx0cj48dGQ+JHtnfTwvdGQ+PHRkPiR7eC5ufTwvdGQ+PHRkPjxiPiR7cGN0KHgucmF0ZSwxKX08L2I+PC90ZD48dGQ+JHtwY3QoeC5sbyl944CcJHtwY3QoeC5oaSl9PC90ZD48L3RyPmB9CiBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiBjb25zdCBtb25vPVVQX1NIQVJFLm1hcCgoW2ddKT0+ci50YWJbZ10ucmF0ZSkuZXZlcnkoKHYsaSxhKT0+aT09PTB8fHY8PWFbaS0xXSsuMDMpOwogaWYoIW1vbm8paCs9JzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuetiee0muOBrumghuOBq+Wun+e4vueOh+OBjOWNmOiqv+OBq+S4i+OBjOOBo+OBpuOBhOOBvuOBm+OCk+OAguaknOiovOWBtOOBruODrOODvOOCueaVsOOBjOWwkeOBquOBhOOBqOi1t+OBjeOBvuOBme+8iOWBtueEtuOBruevhOWbsuOBruOBk+OBqOOBjOWkmuOBhO+8ieOAgjwvZGl2Pic7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiB1cHNldFN0YXR1c0xpbmUoKXsKIGNvbnN0IE09Z2V0VXBzZXRNb2RlbCgpOwogaWYoIU0pcmV0dXJuJzxkaXYgY2xhc3M9InNtYWxsIj7mqJnmupbjg6Ljg4fjg6vvvIjlrabnv5LmuIjjgb/jga7lm7rlrprjg6Ljg4fjg6vvvInjgILlrp/nuL7njofjga/lrabnv5LmmYLjga7mlbDlrZfjgafjgZnjgILjgIzmpJzoqLzjgI3jgr/jg5bjgafjgIHoh6rliIbjga7jg4fjg7zjgr/jgafjga7mpJzoqLzjg7vlho3moKHmraPjgYzjgafjgY3jgb7jgZnjgII8L2Rpdj4nOwogY29uc3Qgbm09e29sZDoi54++6KGM44Oi44OH44OrIixuZXc6IuWGjeagoeato+OBl+OBn+aWsOODouODh+ODqyIsYmxlbmQ6IuePvuihjOOBqOaWsOOBruW5s+WdhyJ9W00ua2luZF07CiByZXR1cm5gPGRpdiBjbGFzcz0ic21hbGwiPjxiPiR7bm19PC9iPuOBp+WIpOWumuS4re+8iOaknOiovOaXpSAke2VzYyhNLmF0KX3vvI/mpJzoqLwgJHtNLm5UZXN0feODrOODvOOCue+8ieOAguetiee0muOBruWun+e4vueOh+OBr+OAgeODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBp+a4rOOBo+OBn+WApOOBp+OBmeOAgjwvZGl2PmA7Cn0KCgovKiAtLS0tLS0tLS0tIOS/neWtmOODh+ODvOOCv+OBrueKtuazgSAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIHNob3dTdGF0ZSgpewogdHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpLHBzPWF3YWl0IHBheUFsbCgpOwogIGNvbnN0IGJhc2U9ZnMuZmlsdGVyKGY9PiFmLmxpdmUpLGxpdmU9ZnMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCk7CiAgaWYoIWZzLmxlbmd0aCYmIXBzLmxlbmd0aCl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumBjuWOu+ODh+ODvOOCv+OBr+acquWPluW+l+OBp+OBmeOAguOAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZnjgYvjgIHoqK3lrprjgYvjgonjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLlvqnlhYPjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgbGQ9bGl2ZS5tYXAoZj0+Zi5kYXRlKS5zb3J0KCksblJhY2VzPWxpdmUucmVkdWNlKChzLGYpPT5zK25ldyBTZXQoZi5yb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemUsMCk7CiAgbGV0IG5BbGw9MCxuVHI9MDtmb3IoY29uc3QgZiBvZiBsaXZlKWZvcihjb25zdCByIG9mIGYucm93cyl7bkFsbCsrO2lmKHIudHJhaW5lciluVHIrK30KICBsZXQgaD0iIjsKICBpZihsaXZlLmxlbmd0aCloKz1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluW+l+a4iOOBv+OBruaIkOe4vu+8miR7bGl2ZS5sZW5ndGh95pel77yPJHtuUmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIgke2xkWzBdfeOAnCR7bGRbbGQubGVuZ3RoLTFdfe+8iTwvc3Bhbj5gOwogIGlmKGJhc2UubGVuZ3RoKXtjb25zdCB5cz1bLi4ubmV3IFNldChiYXNlLm1hcChmPT5mLnllYXIpKV0uc29ydCgpO2grPShoPyJcbiI6IiIpK2A8c3BhbiBjbGFzcz0iZ29vZCI+44OQ44OD44Kv44Ki44OD44OXQ1NW77yaJHtiYXNlLmxlbmd0aH3jg5XjgqHjgqTjg6vvvIgke3lzWzBdfHwiLSJ944CcJHt5c1t5cy5sZW5ndGgtMV18fCItIn3lubTvvIk8L3NwYW4+YH0KICBjb25zdCBwcj1wcy5yZWR1Y2UoKHMscCk9PnMrKHAucmFjZXN8fFtdKS5sZW5ndGgsMCk7CiAgaCs9KGg/IlxuIjoiIikrKHBzLmxlbmd0aD9gPHNwYW4gY2xhc3M9Imdvb2QiPuaJleaIu++8miR7cHMubGVuZ3RofeaXpe+8jyR7cHIudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L3NwYW4+YDonPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu++8muacquWPluW+lzwvc3Bhbj4nKTsKICBpZihuQWxsKWgrPWBcbuiqv+aVmeW4q+OBpOOBjeOBruaIkOe4vu+8miR7TWF0aC5yb3VuZChuVHIvbkFsbCoxMDApfSUke25Ucj09PTA/Iu+8iOOBk+OCjOOBi+OCieWPluW+l+OBmeOCi+aIkOe4vuOBq+WFpeOCiuOBvuOBme+8iSI6IiJ9YDsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPueiuuiqjeOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZSl9PC9zcGFuPmB9Cn0KCi8qIC0tLS0tLS0tLS0g5Y+W5b6X44GX44Gf6KGMIOKGkiDlhoXpg6jjga7ooYzvvIjoqr/mlZnluKvjg7vjgrDjg6zjg7zjg4nku5jjgY3vvIkgLS0tLS0tLS0tLSAqLwpmdW5jdGlvbiBsaXZlUm93KHgpe2NvbnN0IGY9cGFyc2VGbG9hdChTdHJpbmcoeC5maW5pc2g/PyIiKS5yZXBsYWNlKC9bXlxkLl0vZywiIikpOwogcmV0dXJue3JhY2VJZDpTdHJpbmcoeC5yYWNlSWR8fCIiKSxkYXRlOlVFLnBhcnNlRGF0ZSh4LmRhdGUpLG5hbWU6U3RyaW5nKHguaG9yc2V8fCIiKS50cmltKCksaG9yc2U6VUUubm4oeC5ob3JzZSksam9ja2V5OlVFLmpubih4LmpvY2tleSksCiAgZmluaXNoOk51bWJlci5pc0Zpbml0ZShmKSYmZj4wP2Y6bnVsbCxkaXN0Ok51bWJlcih4LmRpc3RhbmNlKXx8MCxzdXJmOlVFLnN1cmZDb2RlKHguc3VyZmFjZSksYWdlOk51bWJlcih4LmFnZSl8fG51bGwsbnVtOk51bWJlcih4Lm51bWJlcil8fG51bGwsCiAgcG9wOk51bWJlcih4LnBvcCk+MD9OdW1iZXIoeC5wb3ApOm51bGwsb2RkczpudWxsLGpuYW1lOlN0cmluZyh4LmpvY2tleXx8IiIpLnRyaW0oKSx0cmFpbmVyOlVFLmNsZWFuVHIoeC50cmFpbmVyKSwKICBsdmw6KHgudmVudWVDb2RlJiYhL14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKHgudmVudWVDb2RlKSkpPy0xOihVRS5sZXZlbE9mTGFiZWwoeC5jbHMpfHxVRS5sZXZlbE9mUHJpemUoeC5wcml6ZSkpLAogIGdyZDpVRS5ncmFkZVRpZXIoKHguY2xzfHwiIikrIiAiKyh4LmdyYWRlfHwiIikseC5wcml6ZSxmYWxzZSl9fQoKLyog5a++6LGh5pel44KI44KK5YmN44Gu5bGl5q2044Gg44GR44Gn44K544OI44Ki44KS5L2c44KL77yI6aiO5omL44O76Kq/5pWZ5bir44Gu5oiQ57i+44KC5ZCM5pmC44Gr6ZuG6KiI77yJICovCmFzeW5jIGZ1bmN0aW9uIGJ1aWxkU3RvcmUodGFyZ2V0KXsKIGlmKFNUT1JFJiZTVE9SRV9LRVk9PT10YXJnZXQpcmV0dXJuIFNUT1JFOwogY29uc3QgZnM9YXdhaXQgaWRiQWxsKCk7aWYoIWZzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIumBjuWOu+ODh+ODvOOCv+OBjOacqueZu+mMsuOBp+OBmeOAguWFiOOBq+OAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZnjgYvjgIHoqK3lrprjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLlvqnlhYPjgZfjgabjgY/jgaDjgZXjgYTjgIIiKTsKIGNvbnN0IHN0PW5ldyBVRS5TdG9yZSgpO3N0LnRyPW5ldyBNYXAoKTtsZXQgdXNlZD0wO2NvbnN0IEFHPW5ldyBNYXAoKTsKIGNvbnN0IHRha2U9cj0+e2lmKCFyLmRhdGV8fHIuZGF0ZT49dGFyZ2V0fHwhci5ob3JzZSlyZXR1cm47YWdnQWRkKEFHLHIpO3N0LmFkZChyKTt1c2VkKys7aWYoci5kYXRlPihzdC5sYXN0RGF0ZXx8IiIpKXN0Lmxhc3REYXRlPXIuZGF0ZTsKICBpZihyLnRyYWluZXImJnIuZmluaXNoIT1udWxsKXtsZXQgdD1zdC50ci5nZXQoci50cmFpbmVyKTtpZighdClzdC50ci5zZXQoci50cmFpbmVyLHQ9e246MCx0MzowfSk7dC5uKys7aWYoci5maW5pc2g8PTMpdC50MysrfX07CiBmb3IobGV0IGk9MDtpPGZzLmxlbmd0aDtpKyspewogIGJ1c3kodHJ1ZSxg6YGO5Y6744OH44O844K/44KS6ZuG6KiI5Lit4oCmICR7aSsxfS8ke2ZzLmxlbmd0aH1cbu+8iCR7dGFyZ2V0feOCiOOCiuWJjeOBruOBv+S9v+eUqO+8iWApOwogIGlmKGZzW2ldLmxpdmUpe2Zvcihjb25zdCB4IG9mIGZzW2ldLnJvd3N8fFtdKXRha2UobGl2ZVJvdyh4KSl9CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGZzW2ldLmNzdikpdGFrZShVRS50b1JvdyhvKSk7CiAgYXdhaXQgc2xlZXAoMCk7CiB9CiBjb25zdCBwcmk9bmV3IFVwUHJpKCk7Zm9yKGNvbnN0IGEgb2YgQUcudmFsdWVzKCkpcHJpLmFkZChhZ2dJbmZvKGEpKTtzdC51cD1wcmk7CiBidXN5KGZhbHNlKTtTVE9SRT1zdDtTVE9SRV9LRVk9dGFyZ2V0O3N0LmNvdW50PXVzZWQ7cmV0dXJuIHN0Owp9CgovKiDlh7rppqzooajjga4x44Os44O844K5IOKGkiDop6PmnpDnlKjjga7jg6zjg7zjgrkgKi8KZnVuY3Rpb24gbWtSYWNlKGMsZCl7CiBjb25zdCBocz1jLmhvcnNlc3x8Yy5ydW5uZXJzfHxbXTsKIGNvbnN0IGd0PShjLmNsYXNzTmFtZXx8IiIpKyIgIisoYy5ncmFkZXx8IiIpKyIgIisoYy5yYWNlTmFtZXx8IiIpOwogY29uc3QgZ3JkPVVFLmdyYWRlVGllcihndCxjLnByaXplLHRydWUpOwogcmV0dXJue2RhdGU6ZCxzdXJmOlVFLnN1cmZDb2RlKGMuc3VyZmFjZSksZGlzdDpOdW1iZXIoYy5kaXN0YW5jZSl8fDAsCiAgbHZsOlVFLmxldmVsT2ZMYWJlbChjLmNsYXNzTmFtZSl8fFVFLmxldmVsT2ZMYWJlbChjLnJhY2VOYW1lKXx8KGdyZD49MT81OjApLGdyZCwKICBydW5uZXJzOmhzLm1hcCgoaCxpKT0+e2NvbnN0IG5hbWU9aC5ob3JzZU5hbWV8fGguaG9yc2V8fGgubmFtZXx8IiI7CiAgIHJldHVybntuYW1lLGhvcnNlOlVFLm5uKG5hbWUpLGpvY2tleTpVRS5qbm4oaC5qb2NrZXl8fCIiKSxqbmFtZTpTdHJpbmcoaC5qb2NrZXl8fCIiKS50cmltKCksdHJhaW5lcjpVRS5jbGVhblRyKGgudHJhaW5lcnx8IiIpLGFnZTpoLmFnZXx8bnVsbCxudW06aC5ob3JzZU51bWJlcnx8aC5udW1iZXJ8fGkrMX19KQogICAuc29ydCgoeCx5KT0+KHgubnVtfHwwKS0oeS5udW18fDApKX07Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDku4rpgLHmnKvjga7lj5blvpcKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBXSz17ZGF0ZXM6W10sY2FyZHM6e30sb2Rkczp7fSxvZGRzTm90ZXM6e30sZGlhZzpbXSxjYWxjOnt9LGF0OiIiLHN0b3JlSW5mbzpudWxsfTsKY29uc3QgcmtleT0oZCxjKT0+YCR7ZH18JHtTdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIil9LSR7TnVtYmVyKGMucmFjZU51bWJlcil8fDB9YDsKY29uc3Qgd2tNc2c9dD0+eyQoIndrU3RhdHVzIikudGV4dENvbnRlbnQ9dH07CmNvbnN0IGJhc2VVcmw9KCk9PiQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKZnVuY3Rpb24gbmV4dFdlZWtlbmQodG9kYXkpe2NvbnN0IG91dD1bXTtjb25zdCB0PW5ldyBEYXRlKHRvZGF5KyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpOwogZm9yKGxldCBpPTA7aTw4JiZvdXQubGVuZ3RoPDI7aSsrKXtjb25zdCBkPW5ldyBEYXRlKHQraSo4NjRlNSksdz1kLmdldFVUQ0RheSgpO2lmKHc9PT02fHx3PT09MClvdXQucHVzaChkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCkpfXJldHVybiBvdXR9Cgphc3luYyBmdW5jdGlvbiBmZXRjaENhcmRzKGJhc2UsZCx2ZW51ZUNvZGUpewogY29uc3QgcT12ZW51ZUNvZGU/YCZ2ZW51ZT0ke2VuY29kZVVSSUNvbXBvbmVudCh2ZW51ZUNvZGUpfWA6IiI7bGV0IGVycj0iIjsKIGZvcihsZXQgdD0wO3Q8Mzt0KyspewogIHRyeXtjb25zdCByPWF3YWl0IGZldGNoKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2VuY29kZVVSSUNvbXBvbmVudChkKX0ke3F9YCk7CiAgIGlmKCFyLm9rKXtsZXQgbT0iIjt0cnl7bT0oYXdhaXQgci5qc29uKCkpLmVycm9yfHwiIn1jYXRjaHt9dGhyb3cgbmV3IEVycm9yKGBIVFRQICR7ci5zdGF0dXN9ICR7bX1gLnRyaW0oKSl9CiAgIGNvbnN0IHg9YXdhaXQgci5qc29uKCk7cmV0dXJue3JhY2VzOkFycmF5LmlzQXJyYXkoeCk/eDooeC5yYWNlc3x8W10pfX0KICBjYXRjaChlKXtlcnI9ZS5tZXNzYWdlO2F3YWl0IHNsZWVwKDEyMDAqKHQrMSkpfQogfQogdGhyb3cgbmV3IEVycm9yKGVycnx8IuWPluW+l+OBp+OBjeOBvuOBm+OCkyIpOwp9CgovKiAx6ZaL5YKs5aC044G244KT44Gu5Ye66aas6KGo44CC5qyg44GR44O75aSx5pWX44GM44GC44KM44Gw44CB6Ieq5YuV44GnMeWbnuOBoOOBkeOChOOCiuebtOOBmSAqLwphc3luYyBmdW5jdGlvbiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LGlzUmV0cnkpewogY29uc3QgY29kZT1TdHJpbmcodi52ZW51ZUNvZGUpOwogV0suY2FyZHNbZF09KFdLLmNhcmRzW2RdfHxbXSkuZmlsdGVyKGM9PlN0cmluZyhjLnZlbnVlQ29kZSkhPT1jb2RlKTsKIFdLLmRpYWc9V0suZGlhZy5maWx0ZXIoeD0+ISh4LmQ9PT1kJiZ4LmNvZGU9PT1jb2RlKSk7CiB0cnl7CiAgY29uc3Qge3JhY2VzfT1hd2FpdCBmZXRjaENhcmRzKGJhc2UsZCxjb2RlKTsKICBjb25zdCBvaz1yYWNlcy5maWx0ZXIoYT0+KGEuaG9yc2VzfHxhLnJ1bm5lcnN8fFtdKS5sZW5ndGgpLGJhZD1yYWNlcy5sZW5ndGgtb2subGVuZ3RoOwogIFdLLmNhcmRzW2RdLnB1c2goLi4ub2spOwogIGNvbnN0IGlzc3Vlcz1vay5maWx0ZXIoYz0+Yy5xdWFsaXR5JiYhYy5xdWFsaXR5Lm9rKS5tYXAoYz0+YCR7Yy5yYWNlTnVtYmVyfVLvvJoke2MucXVhbGl0eS5pc3N1ZXMuam9pbigi44O7Iil9YCk7CiAgV0suZGlhZy5wdXNoKHtkLGNvZGUsbmFtZTp2LnZlbnVlTmFtZXx8VkVOVUVbY29kZV18fGNvZGUscmFjZXM6cmFjZXMubGVuZ3RoLG9rOm9rLmxlbmd0aCxiYWQsaXNzdWVzLGVycjohcmFjZXMubGVuZ3RoPyLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiOiIifSk7CiAgaWYoKGJhZD4wfHxvay5sZW5ndGg8OCkmJiFpc1JldHJ5KXthd2FpdCBzbGVlcCg4MDApO3JldHVybiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LHRydWUpfQogfWNhdGNoKGUpewogIFdLLmRpYWcucHVzaCh7ZCxjb2RlLG5hbWU6di52ZW51ZU5hbWV8fFZFTlVFW2NvZGVdfHxjb2RlLHJhY2VzOjAsb2s6MCxiYWQ6MCxpc3N1ZXM6W10sZXJyOmUubWVzc2FnZX0pOwogIGlmKCFpc1JldHJ5KXthd2FpdCBzbGVlcCgxMjAwKTtyZXR1cm4gbG9hZFZlbnVlSW50byhiYXNlLGQsdix0cnVlKX0KIH0KfQoKLyog44Kq44OD44K677yI5Y2Y5Yud77yL6KSH5Yud77yJ44CC5Ye66aas6KGo44Gu44Oq44Oz44Kv44GL44KJ55u05o6lIOKGkiDlj5bjgozjgarjgYvjgaPjgZ/jg6zjg7zjgrnjga/jgIHml6Xku5jjg7vplovlgqzloLTjga7jg6Hjg4vjg6Xjg7zntYznlLHjgafoo5zjgYYgKi8KYXN5bmMgZnVuY3Rpb24gZmV0Y2hPZGRzRGF0ZShiYXNlLGQpewogY29uc3QgY2FyZHM9V0suY2FyZHNbZF18fFtdLG5vdGVzPVtdO1dLLm9kZHNOb3Rlcz1XSy5vZGRzTm90ZXN8fHt9OwogaWYoIWNhcmRzLmxlbmd0aCl7V0sub2Rkc05vdGVzW2RdPW5vdGVzO3JldHVybntuOjAsbm90ZXN9fQogY29uc3Qgd2l0aExpbms9Y2FyZHMuZmlsdGVyKHI9PnIub2Rkc0NuYW1lKSxieUM9bmV3IE1hcCh3aXRoTGluay5tYXAocj0+W3Iub2Rkc0NuYW1lLHJdKSk7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTx3aXRoTGluay5sZW5ndGg7aSs9NiljaHVua3MucHVzaCh3aXRoTGluay5zbGljZShpLGkrNikubWFwKHI9PnIub2Rkc0NuYW1lKSk7CiBsZXQgY2k9MCxmYWlsTj0wO2NvbnN0IHJlYXNvbnM9e307CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGNpPGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9Y2krKzsKICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gLFsxNTAwXSk7CiAgIGZvcihjb25zdCBpdCBvZiAoeC5pdGVtc3x8W10pKXtjb25zdCByPWJ5Qy5nZXQoaXQuY25hbWUpO2lmKHIpV0sub2Rkc1tya2V5KGQscildPXt0YW46aXQub2Rkc3x8e30scGxhY2U6aXQucGxhY2V8fHt9LGF0OkRhdGUubm93KCl9fQogICBmb3IoY29uc3QgZiBvZiAoeC5mYWlsZWR8fFtdKSl7ZmFpbE4rKztjb25zdCBtPVN0cmluZyhmLnJlYXNvbnx8IiIpLnNsaWNlKDAsNjApO3JlYXNvbnNbbV09KHJlYXNvbnNbbV18fDApKzF9CiAgfWNhdGNoKGUpe2ZhaWxOKz1jaHVua3Nba10ubGVuZ3RoO2NvbnN0IG09U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCw2MCk7cmVhc29uc1ttXT0ocmVhc29uc1ttXXx8MCkrMX19fTsKIGF3YWl0IFByb21pc2UuYWxsKFt3b3JrZXIoKSx3b3JrZXIoKV0pOwogY29uc3QgZGlyZWN0PWNhcmRzLmZpbHRlcihyPT5XSy5vZGRzW3JrZXkoZCxyKV0pLmxlbmd0aDsKIG5vdGVzLnB1c2goYOWHuummrOihqOOBruODquODs+OCr+OBi+OCieebtOaOpe+8miR7ZGlyZWN0fS8ke2NhcmRzLmxlbmd0aH3jg6zjg7zjgrnvvIjjg6rjg7Pjgq/jgYLjgoogJHt3aXRoTGluay5sZW5ndGh944CB5aSx5pWXICR7ZmFpbE5977yJYCk7CiBmb3IoY29uc3QgW20sY10gb2YgT2JqZWN0LmVudHJpZXMocmVhc29ucykpbm90ZXMucHVzaChg44CA5aSx5pWX44Gu55CG55Sx77yaJHttfe+8iCR7Y33vvIlgKTsKIGNvbnN0IG1pc3Npbmc9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYobWlzc2luZy5sZW5ndGgpewogIGZvcihjb25zdCB2IG9mIFsuLi5uZXcgU2V0KG1pc3NpbmcubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbikpewogICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/ZGF0ZT0ke2R9JnZlbnVlPSR7dn1gLFsxNTAwXSk7CiAgICBmb3IoY29uc3QgciBvZiAoeC5yYWNlc3x8W10pKVdLLm9kZHNbYCR7ZH18JHtTdHJpbmcoci52ZW51ZUNvZGUpLnBhZFN0YXJ0KDIsIjAiKX0tJHtyLnJhY2VOb31gXT17dGFuOnIub2Rkc3x8e30scGxhY2U6ci5wbGFjZXx8e30sYXQ6RGF0ZS5ub3coKX07CiAgICBub3Rlcy5wdXNoKGDjg6Hjg4vjg6Xjg7zntYznlLEgJHtWRU5VRVt2XXx8dn3vvJokeyh4LnJhY2VzfHxbXSkubGVuZ3RofeODrOODvOOCueWPluW+l++8iOOCquODg+OCuueUu+mdouOBq+imi+OBpOOBi+OBo+OBn+ODrOODvOOCuSAke3gudGFyZ2V0cz8/Ij8ife+8j+W9k+aXpeWFqOS9kyAke3gudGFyZ2V0c0FsbD8/Ij8ife+8iWApOwogICAgbm90ZXMucHVzaChg44CA6KaL44Gk44GL44Gj44Gf44Os44O844K555Wq5Y+377yaJHsoeC5mb3VuZFJhY2VOb3N8fFtdKS5qb2luKCIsIil8fCLjgarjgZcife+8j+iqreOBv+WPluOCjOOBquOBi+OBo+OBn++8miR7KHgubm9QYXJzZXx8W10pLmpvaW4oIiwiKXx8IuOBquOBlyJ9YCk7CiAgIH1jYXRjaChlKXtub3Rlcy5wdXNoKGDjg6Hjg4vjg6Xjg7zntYznlLEgJHtWRU5VRVt2XXx8dn3vvJrlpLHmlZfvvIgke1N0cmluZyhlLm1lc3NhZ2V8fGUpLnNsaWNlKDAsODApfe+8iWApfX0KIH0KIGNvbnN0IHN0aWxsPWNhcmRzLmZpbHRlcihyPT4hV0sub2Rkc1tya2V5KGQscildKTsKIGlmKHN0aWxsLmxlbmd0aClub3Rlcy5wdXNoKGDjgqrjg4PjgrrmnKrlj5blvpfvvJoke3N0aWxsLm1hcChyPT4oci52ZW51ZU5hbWV8fCIiKStyLnJhY2VOdW1iZXIrIlIiKS5qb2luKCLjgIEiKX3vvIjnmbrlo7LliY3jgIHjgb7jgZ/jga/oqq3jgb/lj5bjgozjgabjgYTjgb7jgZvjgpPvvIlgKTsKIFdLLm9kZHNOb3Rlc1tkXT1ub3RlczsKIHJldHVybntuOmNhcmRzLmZpbHRlcihyPT5XSy5vZGRzW3JrZXkoZCxyKV0pLmxlbmd0aCxub3Rlc307Cn0KCmFzeW5jIGZ1bmN0aW9uIHdlZWtlbmRHbygpewogY29uc3QgYmFzZT1iYXNlVXJsKCk7JCgid2tHbyIpLmRpc2FibGVkPXRydWU7JCgid2tPZGRzIikuZGlzYWJsZWQ9dHJ1ZTsKIFdLLmRhdGVzPVtdO1dLLmNhcmRzPXt9O1dLLm9kZHM9e307V0suZGlhZz1bXTtXSy5jYWxjPXt9OwogdHJ5ewogIHdrTXNnKCLplovlgqzml6XjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCB0b2RheT1qc3RUb2RheSgpO2xldCBkYXRlcz1bXTsKICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7dG9kYXl9Jmxpc3Q9MWAsWzE1MDBdKTtkYXRlcz0oeC5hdmFpbGFibGVEYXRlc3x8W10pLmZpbHRlcihkPT5kPj10b2RheSl9Y2F0Y2goZSl7fQogIGlmKCFkYXRlcy5sZW5ndGgpZGF0ZXM9bmV4dFdlZWtlbmQodG9kYXkpOwogIGRhdGVzPVsuLi5uZXcgU2V0KGRhdGVzKV0uc29ydCgpLnNsaWNlKDAsMyk7CiAgZm9yKGNvbnN0IGQgb2YgZGF0ZXMpewogICB3a01zZyhgJHtkfSDplovlgqzloLTjgpLnorroqo3kuK3igKZgKTsKICAgbGV0IHZlbnVlcz1bXTsKICAgdHJ5e3ZlbnVlcz0oYXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2R9Jmxpc3Q9MWAsWzE1MDBdKSkudmVudWVzfHxbXX0KICAgY2F0Y2goZSl7V0suZGlhZy5wdXNoKHtkLGNvZGU6IiIsbmFtZToiKOmWi+WCrOWgtOS4gOimpykiLHJhY2VzOjAsb2s6MCxiYWQ6MCxpc3N1ZXM6W10sZXJyOmUubWVzc2FnZX0pO2NvbnRpbnVlfQogICBpZighdmVudWVzLmxlbmd0aCl7V0suZGlhZy5wdXNoKHtkLGNvZGU6IiIsbmFtZToiKOmWi+WCrOOBquOBlykiLHJhY2VzOjAsb2s6MCxiYWQ6MCxpc3N1ZXM6W10sZXJyOiLjgZPjga7ml6Xjga7lh7rppqzooajjga/mnKrlhazplovjgIHjgb7jgZ/jga/plovlgqzjgYzjgYLjgorjgb7jgZvjgpMifSk7Y29udGludWV9CiAgIFdLLmNhcmRzW2RdPVtdOwogICBmb3IoY29uc3QgdiBvZiB2ZW51ZXMpe3drTXNnKGAke2R9ICR7di52ZW51ZU5hbWV8fHYudmVudWVDb2RlfSDjga7lh7rppqzooajjgpLlj5blvpfkuK3igKbvvIgkeyhXSy5jYXJkc1tkXXx8W10pLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfmuIjjgb/vvIlgKTthd2FpdCBsb2FkVmVudWVJbnRvKGJhc2UsZCx2KX0KICAgaWYoKFdLLmNhcmRzW2RdfHxbXSkubGVuZ3RoKVdLLmRhdGVzLnB1c2goZCk7CiAgfQogIGlmKCFXSy5kYXRlcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLlh7rppqzooajjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgILjgIzlj5bjgorovrzjgb/nirbms4HjgI3jgr/jg5bjgpLnorroqo3jgZfjgabjgY/jgaDjgZXjgYTjgIIiKTsKICBsZXQgb2Rkc049MCx0b3RhbD0wOwogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXt3a01zZyhgJHtkfSDjgqrjg4PjgrrjgpLlj5blvpfkuK3igKZgKTtvZGRzTis9KGF3YWl0IGZldGNoT2Rkc0RhdGUoYmFzZSxkKSkubjt0b3RhbCs9V0suY2FyZHNbZF0ubGVuZ3RofQogIHdrTXNnKCLpgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgZfjgabjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDkuK3igKYiKTsKICBhd2FpdCBjYWxjV2Vla2VuZCgpO1dLLmF0PW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsMTYpOwogIHJlbmRlckFsbCgpOwogIGNvbnN0IG5yPVdLLmRhdGVzLnJlZHVjZSgocyxkKT0+cytXSy5jYXJkc1tkXS5sZW5ndGgsMCk7CiAgd2tNc2coYOWujOS6hu+8iCR7V0suYXR977yJ77yaJHtXSy5kYXRlcy5qb2luKCLjgIEiKX3vvI8ke25yfeODrOODvOOCue+8j+OCquODg+OCuiAke29kZHNOfeODrOODvOOCuSR7b2Rkc04/IiI6Iu+8iOeZuuWjsuWJjeOBruOBn+OCgeacquWPluW+l+OAgueZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAje+8iSJ9YCk7CiAgJCgid2tPZGRzIikuZGlzYWJsZWQ9ZmFsc2U7c2hvd1RhYigidkF4aXMiKTsKIH1jYXRjaChlKXt3a01zZygi44Ko44Op44O877yaIitlLm1lc3NhZ2UpO2J1c3koZmFsc2UpO3JlbmRlckFsbCgpfQogZmluYWxseXskKCJ3a0dvIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KYXN5bmMgZnVuY3Rpb24gb2Rkc09ubHkoKXsKIGlmKCFXSy5kYXRlcy5sZW5ndGgpcmV0dXJuOyQoIndrT2RkcyIpLmRpc2FibGVkPXRydWU7CiB0cnl7bGV0IG49MDtmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7d2tNc2coYCR7ZH0g44Kq44OD44K644KS5pu05paw5Lit4oCmYCk7bis9KGF3YWl0IGZldGNoT2Rkc0RhdGUoYmFzZVVybCgpLGQpKS5ufQogIGF3YWl0IGNhbGNXZWVrZW5kKCk7V0suYXQ9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxNik7cmVuZGVyQWxsKCk7d2tNc2coYOOCquODg+OCuuabtOaWsO+8iCR7V0suYXR977yJ77yaJHtufeODrOODvOOCueWIhmApfQogY2F0Y2goZSl7d2tNc2coIuabtOaWsOOCqOODqeODvO+8miIrZS5tZXNzYWdlKX1maW5hbGx5eyQoIndrT2RkcyIpLmRpc2FibGVkPWZhbHNlfQp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog6Kej5p6Q77yIMeODrOODvOOCue+8ie+8muikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrogPSDmnJ/lvoXlgKTjgIHms6LkubHluqbjgIHpiYTmnb8KICogIOikh+WLneeiuueOh++8muOCquODg+OCuuOBguOCiuKGkuW4guWgtOaDheWgseOCguS9v+OBhuWtpue/kua4iOOBv+ODouODh+ODqyhwTynvvI/jgarjgZfihpLpgY7ljrvmiJDnuL7jga7jgb/jga7jg6Ljg4fjg6socFApCiAqICDopIfli53jgqrjg4PjgrrvvJpKUkHjga7opIfli53jgqrjg4PjgrrvvIjkuIvpmZDjgJzkuIrpmZDvvInjgILoqq3jgoHjgarjgYTjgajjgY3jga/ljZjli53jgYvjgonmjqjlrprvvIjDl+ihqOekuu+8iQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmZ1bmN0aW9uIGNhbGNSYWNlKGQsYyxzdG9yZSl7CiBjb25zdCByYWNlPW1rUmFjZShjLGQpO2xldCBuPXJhY2UucnVubmVycy5sZW5ndGg7Y29uc3Qgc2NyYXRjaGVkPVtdOwoge2NvbnN0IG8wPVdLLm9kZHNbcmtleShkLGMpXTsKICBpZihvMCl7Y29uc3QgbWlzcz1yYWNlLnJ1bm5lcnMuZmlsdGVyKHI9PiEobzAudGFuW3IubnVtXT4xKSksaGF2ZT1yYWNlLnJ1bm5lcnMubGVuZ3RoLW1pc3MubGVuZ3RoOwogICAvLyDkuIDpg6jjga7ppqzjgaDjgZHjgqrjg4PjgrrjgYznhKHjgYTvvJ3lj5bmtojjg7vpmaTlpJbjga7lj6/og73mgKfjgYzpq5jjgYTjgILlpJbjgZfjgabjgIHjgqrjg4Pjgrrovrzjgb/jgafop6PmnpDjgZnjgovvvIjlpKfljYrjgYzmrKDjgZHjgabjgYTjgovjgarjgonlpJbjgZXjgarjgYTvvIkKICAgaWYobWlzcy5sZW5ndGgmJmhhdmU+PTYmJm1pc3MubGVuZ3RoPD1NYXRoLm1heCgzLE1hdGguZmxvb3IocmFjZS5ydW5uZXJzLmxlbmd0aCouMikpKXtzY3JhdGNoZWQucHVzaCguLi5taXNzLm1hcChyPT5yLm51bSkpO3JhY2UucnVubmVycz1yYWNlLnJ1bm5lcnMuZmlsdGVyKHI9Pm8wLnRhbltyLm51bV0+MSk7bj1yYWNlLnJ1bm5lcnMubGVuZ3RofX19CiBjb25zdCBiYXNlPXtkLGNhcmQ6YyxyYWNlLG4sc2NyYXRjaGVkLGtleTpya2V5KGQsYyksdmVudWU6Yy52ZW51ZU5hbWV8fGMudmVudWV8fCIiLG5vOk51bWJlcihjLnJhY2VOdW1iZXIpfHwwLAogIGxhYmVsOmAke2MudmVudWVOYW1lfHxjLnZlbnVlfHwiIn0ke2MucmFjZU51bWJlcnx8IiJ9UiAke2MucmFjZU5hbWV8fCIifWAsY291cnNlOmMuc3VyZmFjZSYmYy5kaXN0YW5jZT9gJHtjLnN1cmZhY2V9JHtjLmRpc3RhbmNlfW1gOiLjgrPjg7zjgrnkuI3mmI4ifTsKIGlmKC/pmpzlrrMvLnRlc3QoKGMucmFjZU5hbWV8fCIiKSsoYy5jbGFzc05hbWV8fCIiKSkpcmV0dXJuey4uLmJhc2Usc2tpcDoi6Zqc5a6z44Os44O844K544Gv5a++6LGh5aSW77yI5bmz5Zyw55So44Gu44Oi44OH44Or44Gu44Gf44KB77yJIn07CiBpZihuPDYpcmV0dXJuey4uLmJhc2Usc2tpcDoiNumgreacqua6gCJ9OwogY29uc3Qgbz1XSy5vZGRzW2Jhc2Uua2V5XSxvZGRzPW8/cmFjZS5ydW5uZXJzLm1hcChyPT5vLnRhbltyLm51bV0pOm51bGwsaGFzT2Rkcz0hIShvZGRzJiZvZGRzLmV2ZXJ5KHg9Png+MSkpOwogY29uc3Qgb2Q9aGFzT2Rkcz9vZGRzOm51bGw7CiBjb25zdCByZXM9VUUuYW5hbHl6ZShyYWNlLHN0b3JlLG9kKSxhcD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCk7bGV0IHVnPVVFLnVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZCxhcCk7CiBjb25zdCBVTT1nZXRVcHNldE1vZGVsKCk7CiBpZihVTSYmc3RvcmUudXApe3RyeXtjb25zdCB1PVVFLnVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZCxhcCksaW5mPXt2OlN0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSxzdXJmOnJhY2Uuc3VyZixkaXN0OnJhY2UuZGlzdCxsdmw6cmFjZS5sdmwsZ3JkOnJhY2UuZ3JkLE46bn0sY3U9dXBzZXRDdXN0b20oVU0sdSxzdG9yZS51cC5mZWF0KGluZikpO2lmKGN1KXVnPXsuLi51ZywuLi5jdSxtb2RlOnUubW9kZSxjdXN0b206dHJ1ZX19Y2F0Y2goZSl7fX0KIGNvbnN0IGF4aXM9aGFzT2Rkcz9VRS5heGlzUGlja3MocmFjZSxzdG9yZSxvZCxhcCk6bnVsbDsKIGNvbnN0IG0zPWhhc09kZHM/VUUudG9wM0Zyb21XaW4ob2QubWFwKHg9PjEveCkpOm51bGw7CiBjb25zdCBob3JzZXM9cmFjZS5ydW5uZXJzLm1hcCgocixpKT0+ewogIGNvbnN0IHA9aGFzT2Rkcz9hcC5wT1tpXTphcC5wUFtpXSxwbD1vJiZvLnBsYWNlJiZvLnBsYWNlW3IubnVtXTsKICBsZXQgbG89bnVsbCxoaT1udWxsLHNyYz1udWxsOwogIGlmKHBsJiZwbC5sZW5ndGg9PT0yJiZwbFswXT49MSl7bG89cGxbMF07aGk9cGxbMV07c3JjPSLlrp8ifQogIGVsc2UgaWYobTMpe2xvPU1hdGgubWF4KDEsMC44L01hdGgubWF4KG0zW2ldLC4wMikpO2hpPWxvO3NyYz0i5o6o5a6aIn0KICBjb25zdCB0cj1zdG9yZS50ciYmci50cmFpbmVyP3N0b3JlLnRyLmdldChyLnRyYWluZXIpOm51bGwseD1yZXNbaV07CiAgcmV0dXJue2ksbm86ci5udW0sbmFtZTpyLm5hbWUsam5hbWU6ci5qbmFtZSx0cmFpbmVyOnIudHJhaW5lcix0ck46dHI/dHIubjowLHRyUmF0ZTp0ciYmdHIubj90ci50My90ci5uOm51bGwsam46eC5qbiwKICAgcCxsbyxoaSxzcmMsZXY6bG8/cCpsbzpudWxsLGV2TWlkOmxvP3AqKGxvK2hpKS8yOm51bGwsd2luOmhhc09kZHM/b2RbaV06bnVsbCxwb3A6eC5wb3AsaG9sZTp4LmhvbGUscGM6eC5wYyxtb2RlOngubW9kZSxuOngubiwKICAgY2FyZWVyOnguY2FyZWVyLHJlY2VudDp4LnJlY2VudCx0YWdzOngudGFncyxyYXRpbmc6VUUucmF0aW5nKHgucGMseC5tb2RlLHgubikseH19KTsKIHJldHVybnsuLi5iYXNlLGhhc09kZHMscmVzLGFwLHVnLGF4aXMsaG9yc2VzLHBsYWNlUmVhbDpob3JzZXMuZmlsdGVyKGg9Pmguc3JjPT09IuWunyIpLmxlbmd0aH07Cn0KYXN5bmMgZnVuY3Rpb24gY2FsY1dlZWtlbmQoKXsKIFdLLmNhbGM9e307CiBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKFdLLmRhdGVzWzBdKTsKIFdLLnN0b3JlSW5mbz17bGFzdDpzdG9yZS5sYXN0RGF0ZXx8IiIsY291bnQ6c3RvcmUuY291bnR9OwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IGNzPVsuLi5XSy5jYXJkc1tkXV0uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVDb2RlKS5sb2NhbGVDb21wYXJlKFN0cmluZyhiLnZlbnVlQ29kZSkpfHwoYS5yYWNlTnVtYmVyfHwwKS0oYi5yYWNlTnVtYmVyfHwwKSk7CiAgV0suY2FsY1tkXT17cmFjZXM6W119OwogIGZvcihsZXQgaT0wO2k8Y3MubGVuZ3RoO2krKyl7CiAgIHRyeXtXSy5jYWxjW2RdLnJhY2VzLnB1c2goY2FsY1JhY2UoZCxjc1tpXSxzdG9yZSkpfQogICBjYXRjaChlKXtXSy5jYWxjW2RdLnJhY2VzLnB1c2goe2QsY2FyZDpjc1tpXSxza2lwOiLop6PmnpDjgqjjg6njg7zvvJoiK2UubWVzc2FnZSxsYWJlbDpgJHtjc1tpXS52ZW51ZU5hbWV8fCIifSR7Y3NbaV0ucmFjZU51bWJlcnx8IiJ9UmAsdmVudWU6Y3NbaV0udmVudWVOYW1lfHwiIixubzpjc1tpXS5yYWNlTnVtYmVyfHwwLGhvcnNlczpbXX0pfQogICBpZihpJTQ9PT0zKWF3YWl0IHNsZWVwKDApOwogIH0KIH0KfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOaknOiovOOCsuODvOODiO+8muWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBp+OAgeiqpOW3ruOCkuW8leOBhOOBpuOCguWbnuWPjueOhzEwMCXku6XkuIrjga7osrfjgYTmlrnjgaDjgZHjgIzmpJzoqLzmuIjjgb/jgI0KICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBHQVRFX0tFWT0ia2VpYmFfZ2F0ZV92MiI7CmNvbnN0IGdldEdhdGU9KCk9Pnt0cnl7cmV0dXJuIEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oR0FURV9LRVkpfHwibnVsbCIpfWNhdGNoKGUpe3JldHVybiBudWxsfX07CmNvbnN0IFNUUkFUPXtmb2N1czoi56m06aas77yI4peO55qE5Lit546H6YeN6KaW77yJIix0b3AxOiLnqbTppqwx5L2NIix0b3AyOiLnqbTppqzkuIrkvY0y6aCtIix2YWx1ZToi5aaZ5ZGzMS4z5YCN5Lul5LiKIixheGlzOiLpiYTmnb/ou7gifTsKZnVuY3Rpb24gc2V0R2F0ZShvdXQsb3V0UCl7CiBjb25zdCBpdGVtcz1bXTsKIGZvcihjb25zdCBbc3JjLG9dIG9mIFtbIuOCquODg+OCuuOBguOCiiIsb3V0XSxbIuOCquODg+OCuuOBquOBlyIsb3V0UF1dKXsKICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhTVFJBVCkpewogICBjb25zdCB2PW8uc3RhdHNba107aWYoIXYpY29udGludWU7CiAgIGNvbnN0IHNlZz0odi5DJiZ2LkMuYmV0cz49MzAwKT92LkM6di5hbGw7aWYoIXNlZ3x8IXNlZy5iZXRzKWNvbnRpbnVlOwogICBjb25zdCBsb3c9c2VnLnJvaS0xLjk2KnNlZy5zZTsKICAgaXRlbXMucHVzaCh7a2V5OmssbGFiZWw6U1RSQVRba10rIu+8iCIrc3JjKyLvvIkiLHJvaTpzZWcucm9pLGxvdyxiZXRzOnNlZy5iZXRzLGhpdDpzZWcuaGl0UmF0ZSxzZWc6c2VnPT09di5DPyLlrabnv5LlvowiOiLlhajmnJ/plpMifSk7CiAgfQogfQogbG9jYWxTdG9yYWdlLnNldEl0ZW0oR0FURV9LRVksSlNPTi5zdHJpbmdpZnkoe2F0Om5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSxpdGVtc30pKTsKIHJlbmRlckdhdGUoKTsKfQpjb25zdCBzdHJhdE9rPWtleT0+e2NvbnN0IGc9Z2V0R2F0ZSgpO3JldHVybiAhIShnJiZnLml0ZW1zLnNvbWUoeD0+eC5rZXk9PT1rZXkmJngubG93Pj0xJiZ4LmJldHM+PTMwMCkpfTsKY29uc3Qgc3RyYXRDaGlwPWtleT0+c3RyYXRPayhrZXkpPyc8c3BhbiBjbGFzcz0iY2hpcCBiIj7mpJzoqLzmuIjjgb/vvIjlm57lj47njocxMDAl6LaF77yJPC9zcGFuPic6JzxzcGFuIGNsYXNzPSJjaGlwIHIiPuWbnuWPjueOhzEwMCXotoXjga/mnKrnorroqo08L3NwYW4+JzsKZnVuY3Rpb24gcmVuZGVyR2F0ZSgpewogY29uc3QgZz1nZXRHYXRlKCksZWw9JCgiZ2F0ZSIpOwogaWYoIWcpe2VsLmlubmVySFRNTD0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj48Yj7lm57lj47njofvvJrmnKrmpJzoqLw8L2I+44CA44CM5qSc6Ki844CN44K/44OW44KS5a6f6KGM44GZ44KL44G+44Gn44CB44Gp44Gu6LK344GE5pa544KC44CMMTAwJei2heOAjeOBqOOBr+iogOOBiOOBvuOBm+OCk+OAgu+8iOS7peWJjeOBruaknOiovOOBp+OBr+OAgeeptOmmrDHkvY3jga7opIfli53lm57lj47njofjga/ntIQ3MuOAnDc3JeOBp+OBl+OBn++8iTwvZGl2Pic7cmV0dXJufQogY29uc3Qgb2s9Zy5pdGVtcy5maWx0ZXIoeD0+eC5sb3c+PTEmJnguYmV0cz49MzAwKSxiZXN0PWcuaXRlbXMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLnJvaS1hLnJvaSlbMF07CiBpZihvay5sZW5ndGgpZWwuaW5uZXJIVE1MPWA8ZGl2IGNsYXNzPSJiYW5uZXIgb2siPjxiPuaknOiovOa4iOOBv++8iOWbnuWPjueOhzEwMCXotoXvvInvvJo8L2I+JHtvay5tYXAoeD0+YCR7ZXNjKHgubGFiZWwpfSAke3BjdCh4LnJvaSl977yI5LiL6ZmQJHtwY3QoeC5sb3cpfeODuyR7eC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl95Zue44O7JHt4LnNlZ33vvIlgKS5qb2luKCLvvI8iKX08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mpJzoqLzml6UgJHtlc2MoZy5hdCl944CC6YGO5Y6744Gu5oiQ57i+44Gn44Gu57WQ5p6c44Gn44CB5LuK5b6M44KC57aa44GP5L+d6Ki844Gv44GC44KK44G+44Gb44KT44CCPC9zcGFuPjwvZGl2PmA7CiBlbHNlIGVsLmlubmVySFRNTD1gPGRpdiBjbGFzcz0iYmFubmVyIG5nIj48Yj7lm57lj47njocxMDAl6LaF44KS56K66KqN44Gn44GN44Gf6LK344GE5pa544Gv44CB44G+44Gg44GC44KK44G+44Gb44KT44CCPC9iPiR7YmVzdD9g5pyA6auY44Gn44KCICR7ZXNjKGJlc3QubGFiZWwpfSDjga4gJHtwY3QoYmVzdC5yb2kpfe+8iOiqpOW3ruOCkuW8leOBj+OBqCR7cGN0KGJlc3QubG93KX3jg7ske2Jlc3QuYmV0cy50b0xvY2FsZVN0cmluZygpfeWbnuODuyR7YmVzdC5zZWd977yJ44CCYDoiIn08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mpJzoqLzml6UgJHtlc2MoZy5hdCl944CC5LiL44Gu5YCZ6KOc44Gv44CM5b2T44Gf44KK44KE44GZ44GV44O75pyf5b6F5YCk44Gu55uu5a6J44CN44Go44GX44Gm5L2/44Gj44Gm44GP44Gg44GV44GE44CCPC9zcGFuPjwvZGl2PmA7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDooajnpLoKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBHUkFERV9PUkRFUj1bIlNTUyIsIlNTIiwiUyIsIkEiLCJCIiwiQyJdLEdSQURFX0NPTE9SPXtTU1M6IiNiNDIzMTgiLFNTOiIjZDkyZDIwIixTOiIjZjc5MDA5IixBOiIjMTY2N2Q5IixCOiIjNjY3MDg1IixDOiIjOThhMmIzIn07CmNvbnN0IGRheUxhYmVsPWQ9Pntjb25zdCB3PSLml6XmnIjngavmsLTmnKjph5HlnJ8iW25ldyBEYXRlKGQrIlQwMDowMDowMFoiKS5nZXRVVENEYXkoKV07cmV0dXJuIGAke2Quc2xpY2UoNSkucmVwbGFjZSgiLSIsIi8iKX0oJHt3fSlgfTsKY29uc3QgY2FsY1JhY2VzPWQ9PihXSy5jYWxjW2RdJiZXSy5jYWxjW2RdLnJhY2VzKXx8W107CmNvbnN0IGFsbFJhY2VzPSgpPT5XSy5kYXRlcy5mbGF0TWFwKGQ9PmNhbGNSYWNlcyhkKSk7CmNvbnN0IG5vRGF0YT1tc2c9PmA8ZGl2IGNsYXNzPSJzbWFsbCI+JHttc2d8fCLjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GZ44Go6KGo56S644GV44KM44G+44GZ44CCIn08L2Rpdj5gOwoKZnVuY3Rpb24gcmVuZGVyQWxsKCl7cmVuZGVyR2F0ZSgpO3JlbmRlckF4aXMoKTtyZW5kZXJFdigpO3JlbmRlclVwc2V0KCk7cmVuZGVySG9sZSgpO3JlbmRlclJhY2VzKCk7cmVuZGVyU3VtKCl9CgovKiAtLS0g6LaF6YmE5p2/77yI6KSH5Yud5ZyP5YaF44Gu5LqI5ris56K6546H44GM6auY44GE6Lu46aas77yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJBeGlzKCl7CiBjb25zdCBlbD0kKCJ2QXhpcyIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCBCPVVFLkFYSVMuYmFuZHM7CiBsZXQgaD1gPGgyPui2hemJhOadv++8iOikh+WLneWcj+WGhSDntIQ5NSXku6XkuIrvvIk8L2gyPiR7c3RyYXRDaGlwKCJheGlzIil9CiA8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K644GM5Y+W44KM44Gf44Os44O844K544Gg44GR5Yik5a6a44GX44G+44GZ44CC6YGO5Y6744Gu5a6f57i+77yaPGI+6YmE5p2/PC9iPu+8iOS6iOa4rCR7cGN0KEJbIumJhOadvyJdLmxvKX3ku6XkuIrvvInjga/lrp/pmpvjgas8Yj4ke3BjdChCWyLpiYTmnb8iXS5yYXRlLDEpfTwvYj7jgYwz552A5Lul5YaF77yIJHtCWyLpiYTmnb8iXS5ufemgreOAgeiqpOW3ruOCkuW8leOBhOOBpuOCgiR7cGN0KEJbIumJhOadvyJdLmxvOTUsMSl977yJ44CBMeaXpeOBguOBn+OCiue0hCR7Qlsi6YmE5p2/Il0ucGVyRGF5femgreOAgjHml6XjgavmnIDlpKcy6aCt44Gg44GR5Ye644GX44G+44GZ44CCPC9kaXY+YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBjb25zdCBycz1jYWxjUmFjZXMoZCkscGlja3M9W107CiAgZm9yKGNvbnN0IHIgb2YgcnMpaWYoci5heGlzKWZvcihjb25zdCB4IG9mIHIuYXhpcylwaWNrcy5wdXNoKHtyLHgsaGg6ci5ob3JzZXNbeC5pXX0pOwogIHBpY2tzLnNvcnQoKGEsYik9PmIueC5wLWEueC5wKTsKICBjb25zdCBuT2Rkcz1ycy5maWx0ZXIocj0+IXIuc2tpcCYmci5oYXNPZGRzKS5sZW5ndGgsbkFsbD1ycy5maWx0ZXIocj0+IXIuc2tpcCkubGVuZ3RoOwogIGgrPWA8aDM+JHtkYXlMYWJlbChkKX3jgIA8c3BhbiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuWPluW+lyAke25PZGRzfS8ke25BbGx944Os44O844K5PC9zcGFuPjwvaDM+YDsKICBpZighbk9kZHMpe2grPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBjOacquWPluW+l+OBruOBn+OCgeWIpOWumuOBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhO+8ieOAgjwvZGl2Pic7Y29udGludWV9CiAgY29uc3QgaXJvbj1waWNrcy5maWx0ZXIoej0+ei54LnRpZXI9PT0i6YmE5p2/Iikuc2xpY2UoMCwyKTsKICBjb25zdCByZXN0PXBpY2tzLmZpbHRlcih6PT56LngudGllciE9PSLpiYTmnb8iKS5zbGljZSgwLDIpOwogIGNvbnN0IGNhcmQ9KHosdGFnKT0+YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKHouci5sYWJlbCl9PC9iPuOAgDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moei5yLmNvdXJzZSl944O7JHt6LnIubn3poK08L3NwYW4+PGJyPjxiPiR7ei5oaC5ub33nlaogJHtlc2Moei5oaC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJydCByQSI+JHt0YWd9PC9zcGFuPuOAgOS6iOa4rCAke3BjdCh6LngucCl9PGJyPgogICA8c3BhbiBjbGFzcz0ic21hbGwiPumojuaJi++8miR7ZXNjKHouaGguam5hbWV8fCLkuI3mmI4iKX3vvI/oqr/mlZnluKvvvJoke2VzYyh6LmhoLnRyYWluZXJ8fCLkuI3mmI4iKX3vvI/ljZjli50gJHt6LmhoLndpbj96LmhoLndpbisi5YCNIjoiLSJ977yP6KSH5YudICR7ei5oaC5sbz96LmhoLmxvLnRvRml4ZWQoMSkrKHouaGguaGk+ei5oaC5sbz8i44CcIit6LmhoLmhpLnRvRml4ZWQoMSk6IiIpKyLlgI0iKyh6LmhoLnNyYz09PSLmjqjlrpoiPyIo5o6o5a6aKSI6IiIpOiItIn3vvI/jgZPjga7ljLrliIbjga7pgY7ljrvlrp/nuL4gJHtwY3Qoei54LnJhdGUsMSl9PC9zcGFuPjwvZGl2PmA7CiAgaWYoaXJvbi5sZW5ndGgpaCs9aXJvbi5tYXAoej0+Y2FyZCh6LCLotoXpiYTmnb8iKSkuam9pbigiIik7CiAgZWxzZSBoKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7otoXpiYTmnb/vvIjkuojmuKw5MiXku6XkuIrvvInjgavoqbLlvZPjgZnjgovppqzjga/jgYTjgb7jgZvjgpPjgILnhKHnkIbjgavosrfjgo/jgarjgYTjga7jgoLkuIDjgaTjga7liKTmlq3jgafjgZnjgII8L2Rpdj4nOwogIGlmKCFpcm9uLmxlbmd0aCYmcmVzdC5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7lj4LogIPvvIg5NSXjgavjga/lsYrjgYvjgarjgYTou7jlgJnoo5zvvInvvJo8L2Rpdj5gK3Jlc3QubWFwKHo9PmNhcmQoeix6LngudGllcikpLmpvaW4oIiIpOwogfQogZWwuaW5uZXJIVE1MPWg7Cn0KCi8qIC0tLSDmnJ/lvoXlgKTvvIjopIfli53norrnjocgw5cg6KSH5Yud44Kq44OD44K677yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJFdigpewogY29uc3QgZWw9JCgidkV2Iik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IGV2TWluPU51bWJlcigkKCJldk1pbiIpPyQoImV2TWluIikudmFsdWU6MS4wNSkscE1pbj1OdW1iZXIoJCgiZXZQIik/JCgiZXZQIikudmFsdWU6LjI1KTsKIGNvbnN0IHJvd3M9W107CiBmb3IoY29uc3QgciBvZiBhbGxSYWNlcygpKWlmKCFyLnNraXApZm9yKGNvbnN0IGggb2Ygci5ob3JzZXMpaWYoaC5ldiE9bnVsbCYmaC5ldj49ZXZNaW4mJmgucD49cE1pbilyb3dzLnB1c2goe3IsaH0pOwogcm93cy5zb3J0KChhLGIpPT5iLmguZXYtYS5oLmV2KTsKIGNvbnN0IG5PZGRzPWFsbFJhY2VzKCkuZmlsdGVyKHI9PnIuaGFzT2RkcykubGVuZ3RoOwogbGV0IGg9YDxoMj7mnJ/lvoXlgKTvvIjopIfli53norrnjocgw5cg6KSH5Yud44Kq44OD44K677yJPC9oMj4ke3N0cmF0Q2hpcCgidmFsdWUiKX0KIDxkaXYgY2xhc3M9InNtYWxsIj7mnJ/lvoXlgKTvvJ3jgZ3jga7ppqzjgYwz552A5Lul5YaF44Gr5YWl44KL56K6546HIMOXIOikh+WLneOCquODg+OCuuOBruS4i+mZkOOAgjEuMOOCkui2heOBiOOCjOOBsOOAgeeQhuirluS4iuOBr+iyt+OBhOe2muOBkeOBpuODl+ODqeOCueOBp+OBmeOAguikh+WLneOCquODg+OCuuOBrzxiPuWunzwvYj7vvJ1KUkHjga7lrp/jgqrjg4PjgrrjgIE8Yj7mjqjlrpo8L2I+77yd5Y2Y5Yud44GL44KJ6KiI566X44GX44Gf55uu5a6J44CC56K6546H44Gu6KaL56mN44KC44KK6YGV44GE44GM5aSn44GN44GP5Yq544GP44Gf44KB44CB44CM5qSc6Ki844CN44GnMTAwJei2heOBjOeiuuiqjeOBleOCjOOCi+OBvuOBp+OBr+ebruWuieOBqOOBl+OBpuS9v+OBo+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj7mnJ/lvoXlgKQgPHNlbGVjdCBpZD0iZXZNaW4iPjxvcHRpb24gdmFsdWU9IjEiPjEuMDDku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjA1Ij4xLjA15Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMS4xIj4xLjEw5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMS4yIj4xLjIw5Lul5LiKPC9vcHRpb24+PC9zZWxlY3Q+IOikh+WLneeiuueOhyA8c2VsZWN0IGlkPSJldlAiPjxvcHRpb24gdmFsdWU9IjAuMTUiPjE1JeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjAuMjUiPjI1JeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjAuNCI+NDAl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC42Ij42MCXku6XkuIo8L29wdGlvbj48L3NlbGVjdD48L2Rpdj5gOwogaWYoIW5PZGRzKXtlbC5pbm5lckhUTUw9aCsnPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4PjgrrjgYzmnKrlj5blvpfjga7jgZ/jgoHjgIHmnJ/lvoXlgKTjga/oqIjnrpfjgafjgY3jgb7jgZvjgpPvvIjnmbrlo7Lplovlp4vlvozjgavjgIzjgqrjg4PjgrrjgaDjgZHmm7TmlrDjgI3vvInjgII8L2Rpdj4nO2JpbmRFdihldk1pbixwTWluKTtyZXR1cm59CiBpZighcm93cy5sZW5ndGgpaCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+5p2h5Lu244Gr5ZCI44GG6aas44Gv44GE44G+44Gb44KT44CCPC9kaXY+JzsKIGVsc2V7CiAgaCs9YDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqw8L3RoPjx0aD7norrnjoc8L3RoPjx0aD7opIfli508L3RoPjx0aD7mnJ/lvoXlgKQ8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3Qge3IsaDp4fSBvZiByb3dzLnNsaWNlKDAsNDApKWgrPWA8dHI+PHRkPiR7ZXNjKGRheUxhYmVsKHIuZCkpfSAke2VzYyhyLmxhYmVsKX08YnI+PGI+JHt4Lm5vfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyh4LmpuYW1lfHwiIil9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHgucCl9PC90ZD48dGQ+JHt4LmxvLnRvRml4ZWQoMSl9JHt4LmhpPngubG8/IuOAnCIreC5oaS50b0ZpeGVkKDEpOiIifTxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LnNyY308L3NwYW4+PC90ZD48dGQ+PGI+JHt4LmV2LnRvRml4ZWQoMil9PC9iPjwvdGQ+PC90cj5gOwogIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIH0KIGVsLmlubmVySFRNTD1oO2JpbmRFdihldk1pbixwTWluKTsKfQpmdW5jdGlvbiBiaW5kRXYoYSxiKXtjb25zdCBlPSQoImV2TWluIikscD0kKCJldlAiKTtpZighZSlyZXR1cm47ZS52YWx1ZT1TdHJpbmcoYSk7cC52YWx1ZT1TdHJpbmcoYik7ZS5vbmNoYW5nZT1wLm9uY2hhbmdlPXJlbmRlckV2fQoKLyogLS0tIOazouS5seW6piAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyVXBzZXQoKXsKIGNvbnN0IGVsPSQoInZVcHNldCIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBsZXQgaD1gPGgyPuODrOODvOOCueOBruazouS5seW6pu+8iFNTU+OAnEPvvIk8L2gyPjxkaXYgY2xhc3M9InNtYWxsIj7jgIwz552A5Lul5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GMMTXku6XkuIrjgI3jgavjgarjgovnorrnjofjgafnrYnntJrjgaXjgZHjgZfjgabjgYTjgb7jgZnvvIjlhajjg6zjg7zjgrnlubPlnYcg57SEMjguNSXvvInjgILjgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrnjga/jgIHjgqrjg4Pjgrrovrzjgb/jga7liKTlrprjgavjgarjgorjgb7jgZnjgII8L2Rpdj4ke3Vwc2V0U3RhdHVzTGluZSgpfWA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgcnM9Y2FsY1JhY2VzKGQpLmZpbHRlcihyPT4hci5za2lwKSxjbnQ9e307R1JBREVfT1JERVIuZm9yRWFjaChnPT5jbnRbZ109MCk7cnMuZm9yRWFjaChyPT5jbnRbci51Zy5ncmFkZV0rKyk7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+PGRpdiBjbGFzcz0icm93Ij4ke0dSQURFX09SREVSLm1hcChnPT5gPHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW2ddfSI+JHtnfSAke2NudFtnXX08L3NwYW4+YCkuam9pbigiICIpfTwvZGl2PmA7CiAgY29uc3Qgc29ydGVkPXJzLnNsaWNlKCkuc29ydCgoYSxiKT0+R1JBREVfT1JERVIuaW5kZXhPZihhLnVnLmdyYWRlKS1HUkFERV9PUkRFUi5pbmRleE9mKGIudWcuZ3JhZGUpfHxiLnVnLnAtYS51Zy5wKTsKICBoKz1gPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuODrOODvOOCuTwvdGg+PHRoPuetiee0mjwvdGg+PHRoPuS6iOa4rDwvdGg+PHRoPuWun+e4vuOBruazouS5seeOhzwvdGg+PHRoPuWIpOWumjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCByIG9mIHNvcnRlZCloKz1gPHRyPjx0ZD4ke2VzYyhyLmxhYmVsKX08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyLmNvdXJzZSl944O7JHtyLm596aCtPC9zcGFuPiR7ci5zY3JhdGNoZWQmJnIuc2NyYXRjaGVkLmxlbmd0aD9gIDxzcGFuIGNsYXNzPSJjaGlwIG8iPumZpOWkluaOqOWumiAke3Iuc2NyYXRjaGVkLmpvaW4oIiwiKX3nlao8L3NwYW4+YDoiIn08L3RkPjx0ZD48c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1Jbci51Zy5ncmFkZV19Ij4ke3IudWcuZ3JhZGV9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHIudWcucCl9PC90ZD48dGQ+JHtyLnVnLmN1c3RvbSYmci51Zy5yYXRlIT1udWxsP2Ake3BjdChyLnVnLnJhdGUpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7cGN0KHIudWcubG8pfeOAnCR7cGN0KHIudWcuaGkpfeODuyR7ci51Zy5ufeS7tjwvc3Bhbj5gOk1hdGgucm91bmQoci51Zy5yYXRlKjEwMCkrIiUifTwvdGQ+PHRkIGNsYXNzPSJzbWFsbCI+JHtyLnVnLm1vZGU9PT0ib2RkcyI/IuOCquODg+OCuui+vOOBvyI6IuaOqOWumiJ9PC90ZD48L3RyPmA7CiAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogfQogZWwuaW5uZXJIVE1MPWg7Cn0KCi8qIC0tLSDnqbTppqzvvIjlpb3otbDnjofjga7pq5jjgYTnqbTppqzlgJnoo5zvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlckhvbGUoKXsKIGNvbnN0IGVsPSQoInZIb2xlIik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IGZvY3VzPSQoImhvbGVGb2N1cyIpPyQoImhvbGVGb2N1cyIpLnZhbHVlPT09IjEiOnRydWU7CiBsZXQgaD1gPGgyPueptOmmrOWAmeijnDwvaDI+JHtzdHJhdENoaXAoImZvY3VzIil9CiA8ZGl2IGNsYXNzPSJzbWFsbCI+56m044K+44O844Oz77yI5Lq65rCX6JaE77yJ44Gu5Lit44Gn44CBM+edgOS7peWGheOBq+WFpeOCi+eiuueOh+OBjOmrmOOBhOmmrOOAguOAjOW9k+OBn+OCiuOChOOBmeOBleOAjeOBruebruWuieOBp+OAgeWbnuWPjueOh+OBr+WIpeOBp+OBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj48c2VsZWN0IGlkPSJob2xlRm9jdXMiPjxvcHRpb24gdmFsdWU9IjEiPuKXjueahOS4reeOh+mHjeimlu+8iOODqeODs+OCr1MvQeOBruOBv++8iTwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjAiPuOBmeOBueOBpu+8iOS4iuS9jTLpoK3vvIk8L29wdGlvbj48L3NlbGVjdD48L2Rpdj5gOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGgrPWA8aDM+JHtkYXlMYWJlbChkKX08L2gzPmA7CiAgZm9yKGNvbnN0IHIgb2YgY2FsY1JhY2VzKGQpKXsKICAgaWYoci5za2lwKWNvbnRpbnVlOwogICBjb25zdCBjPWZvY3VzP1VFLnBpY2tGb2N1cyhyLnJlcywyKTpVRS5waWNrKHIucmVzLDIpO2lmKCFjLmxlbmd0aCljb250aW51ZTsKICAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKHIubGFiZWwpfTwvYj4gPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyLmNvdXJzZSl944O7JHtyLm596aCtJHtyLmhhc09kZHM/IiI6Iu+8iOOCquODg+OCuuacquWPluW+l++8iSJ9PC9zcGFuPmA7CiAgIGZvcihjb25zdCB4IG9mIGMpe2NvbnN0IGhoPXIuaG9yc2VzW3guaV07CiAgICBoKz1gPGRpdiBzdHlsZT0ibWFyZ2luLXRvcDo2cHgiPjxiPiR7eC5ub33nlaogJHtlc2MoeC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJydCByJHtoaC5yYXRpbmd9Ij4ke2hoLnJhdGluZ308L3NwYW4+IDxzcGFuIGNsYXNzPSJzbWFsbCI+5aW96LWw546HICR7cGN0KHgucGMsMSl9JHt4Lm9kZD9g77yP5Y2Y5YudJHt4Lm9kZH3lgI0oJHt4LnBvcH3nlarkurrmsJcpYDoiIn08L3NwYW4+PGJyPgogICAgIDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtoaC5jYXJlZXImJmhoLmNhcmVlci5uP2DpgJrnrpcke2hoLmNhcmVlci5ufei1sCAz552A5YaFJHtoaC5jYXJlZXIudDN95ZueYDoi6YCa566X77ya5bGl5q2044Gq44GXIn0ke2hoLnJlY2VudCYmaGgucmVjZW50Lmxlbmd0aD9g77yP55u06L+RICR7aGgucmVjZW50LnNsaWNlKC01KS5qb2luKCItIil9552AYDoiIn3vvI/pqI7miYvvvJoke2VzYyhoaC5qbmFtZXx8IuS4jeaYjiIpfe+8j+iqv+aVmeW4q++8miR7ZXNjKGhoLnRyYWluZXJ8fCLkuI3mmI4iKX0ke2hoLnRyUmF0ZSE9bnVsbCYmaGgudHJOPj0yMD9gKDPnnYDlhoUke3BjdChoaC50clJhdGUpfSlgOiIifTwvc3Bhbj48YnI+YCsKICAgICAoeC50YWdzfHxbXSkuc2xpY2UoMCwzKS5tYXAodD0+YDxzcGFuIGNsYXNzPSJjaGlwICR7dC5jfSI+JHtlc2ModC50KX08L3NwYW4+YCkuam9pbigiIikrYDwvZGl2PmB9CiAgIGgrPSI8L2Rpdj4iOwogIH0KIH0KIGVsLmlubmVySFRNTD1oOwogY29uc3Qgcz0kKCJob2xlRm9jdXMiKTtzLnZhbHVlPWZvY3VzPyIxIjoiMCI7cy5vbmNoYW5nZT1yZW5kZXJIb2xlOwp9CgovKiAtLS0g5YWo44Os44O844K577yI6aas44GU44Go44Gu56K6546H44O744Kq44OD44K644O75pyf5b6F5YCk44O76aiO5omL44O76Kq/5pWZ5bir77yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJSYWNlcygpewogY29uc3QgZWw9JCgidlJhY2VzIik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGxldCBoPSI8aDI+5YWo44Os44O844K5PC9oMj4iOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGgrPWA8aDM+JHtkYXlMYWJlbChkKX08L2gzPmA7CiAgZm9yKGNvbnN0IHIgb2YgY2FsY1JhY2VzKGQpKXsKICAgaWYoci5za2lwKXtoKz1gPGRpdiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIubGFiZWwpfe+8miR7ZXNjKHIuc2tpcCl9PC9kaXY+YDtjb250aW51ZX0KICAgY29uc3QgZz1yLnVnOwogICBoKz1gPGRldGFpbHM+PHN1bW1hcnk+JHtlc2Moci5sYWJlbCl9IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moci5jb3Vyc2UpfeODuyR7ci5ufemgrTwvc3Bhbj4gPHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW2cuZ3JhZGVdfSI+JHtnLmdyYWRlfTwvc3Bhbj48L3N1bW1hcnk+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPummrO+8j+mojuaJi++8j+iqv+aVmeW4qzwvdGg+PHRoPuWNmOWLnTwvdGg+PHRoPuikh+WLnTwvdGg+PHRoPueiuueOhzwvdGg+PHRoPkVWPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCB4IG9mIHIuaG9yc2VzLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi5wLWEucCkpCiAgICBoKz1gPHRyPjx0ZD48Yj4ke3gubm99PC9iPiAke2VzYyh4Lm5hbWUpfSR7eC5ob2xlJiZ4LnJhdGluZyE9PSJDIj9gIDxzcGFuIGNsYXNzPSJydCByJHt4LnJhdGluZ30iPiR7eC5yYXRpbmd9PC9zcGFuPmA6IiJ9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LmpuYW1lP2VzYyh4LmpuYW1lKTonPHNwYW4gY2xhc3M9ImJhZCI+6aiO5omL5LiN5piOPC9zcGFuPid977yIJHt4LmpuPj01PyLpgY7ljrsiK3guam4rIumojuS5lyI6IuWxpeattOWwkSJ977yJ77yPJHt4LnRyYWluZXI/ZXNjKHgudHJhaW5lcik6JzxzcGFuIGNsYXNzPSJiYWQiPuiqv+aVmeW4q+S4jeaYjjwvc3Bhbj4nfSR7eC50clJhdGUhPW51bGwmJngudHJOPj0yMD8i77yIM+edgOWGhSIrcGN0KHgudHJSYXRlKSsi77yJIjoiIn08L3NwYW4+PC90ZD48dGQ+JHt4Lndpbj94Lndpbi50b0ZpeGVkKDEpOiItIn08L3RkPjx0ZD4ke3gubG8/eC5sby50b0ZpeGVkKDEpKyh4LmhpPngubG8/IuOAnCIreC5oaS50b0ZpeGVkKDEpOiIiKToiLSJ9PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guc3JjfHwiIn08L3NwYW4+PC90ZD48dGQ+JHtwY3QoeC5wKX08L3RkPjx0ZD4ke3guZXYhPW51bGw/YDxiJHt4LmV2Pj0xLjA1PycgY2xhc3M9Imdvb2QiJzoiIn0+JHt4LmV2LnRvRml4ZWQoMil9PC9iPmA6Ii0ifTwvdGQ+PC90cj5gOwogICBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PjwvZGV0YWlscz4iOwogIH0KIH0KIGVsLmlubmVySFRNTD1oOwp9CgovKiAtLS0g5Y+W44KK6L6844G/54q25rOB77yI6aCt5pWw44O76aiO5omL44O76Kq/5pWZ5bir44O744Kz44O844K544O744Kq44OD44K644Gu6Kqt44G/5Y+W44KK57WQ5p6c77yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJTdW0oKXsKIGNvbnN0IGVsPSQoInZTdW0iKTtpZighV0suZGF0ZXMubGVuZ3RoJiYhV0suZGlhZy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCBycz1hbGxSYWNlcygpLmZpbHRlcihyPT4hci5za2lwKTsKIGNvbnN0IGhvcnNlcz1ycy5yZWR1Y2UoKHMscik9PnMrci5uLDApLGptaXNzPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+IWguam5hbWUpLmxlbmd0aCwwKSx0bWlzcz1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9PiFoLnRyYWluZXIpLmxlbmd0aCwwKTsKIGNvbnN0IGptYXRjaD1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9Pmguam4+PTUpLmxlbmd0aCwwKSxobWF0Y2g9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT5oLm4+PTIpLmxlbmd0aCwwKTsKIGNvbnN0IG5vQ291cnNlPXJzLmZpbHRlcihyPT5yLmNvdXJzZT09PSLjgrPjg7zjgrnkuI3mmI4iKS5sZW5ndGgsbk9kZHM9cnMuZmlsdGVyKHI9PnIuaGFzT2RkcykubGVuZ3RoLHBSZWFsPXJzLmZpbHRlcihyPT5yLnBsYWNlUmVhbD4wKS5sZW5ndGg7CiBsZXQgaD1gPGgyPuWPluOCiui+vOOBv+eKtuazgTwvaDI+PHRhYmxlPjx0Ym9keT4KIDx0cj48dGQ+6Kej5p6Q44GX44Gf44Os44O844K577yP5Ye66LWw6aasPC90ZD48dGQ+JHtycy5sZW5ndGh944Os44O844K577yPJHtob3JzZXN96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7pqI7miYvjgpLoqq3jgoHjgarjgYvjgaPjgZ/ppqw8L3RkPjx0ZCBjbGFzcz0iJHtqbWlzcz8iYmFkIjoiZ29vZCJ9Ij4ke2ptaXNzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+6Kq/5pWZ5bir44KS6Kqt44KB44Gq44GL44Gj44Gf6aasPC90ZD48dGQgY2xhc3M9IiR7dG1pc3M/ImJhZCI6Imdvb2QifSI+JHt0bWlzc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPuOCs+ODvOOCueOCkuiqreOCgeOBquOBi+OBo+OBn+ODrOODvOOCuTwvdGQ+PHRkIGNsYXNzPSIke25vQ291cnNlPyJiYWQiOiJnb29kIn0iPiR7bm9Db3Vyc2V9PC90ZD48L3RyPgogPHRyPjx0ZD7jgqrjg4PjgrrjgpLlj5blvpfjgafjgY3jgZ/jg6zjg7zjgrk8L3RkPjx0ZD4ke25PZGRzfe+8jyR7cnMubGVuZ3Rofe+8iOikh+WLneOBruWun+OCquODg+OCuiAke3BSZWFsfeODrOODvOOCue+8iTwvdGQ+PC90cj4KIDx0cj48dGQ+6YGO5Y6744OH44O844K/44Go44Gu54Wn5ZCI77yI6aas77yJPC90ZD48dGQ+JHtobWF0Y2h977yPJHtob3JzZXN96aCt77yIMui1sOS7peS4iu+8iTwvdGQ+PC90cj4KIDx0cj48dGQ+6YGO5Y6744OH44O844K/44Go44Gu54Wn5ZCI77yI6aiO5omL77yJPC90ZD48dGQ+JHtqbWF0Y2h977yPJHtob3JzZXN96aCt77yINemojuS5l+S7peS4iu+8iTwvdGQ+PC90cj4KIDx0cj48dGQ+5a2m57+S44OH44O844K/44Gu5pyA57WC5pelPC90ZD48dGQ+JHtlc2MoV0suc3RvcmVJbmZvJiZXSy5zdG9yZUluZm8ubGFzdHx8Ii0iKX08L3RkPjwvdHI+PC90Ym9keT48L3RhYmxlPmA7CiBjb25zdCBzY3I9cnMuZmlsdGVyKHI9PnIuc2NyYXRjaGVkJiZyLnNjcmF0Y2hlZC5sZW5ndGgpLGptcD1hbGxSYWNlcygpLmZpbHRlcihyPT5yLnNraXAmJi/pmpzlrrMvLnRlc3Qoci5za2lwKSk7CiBpZihzY3IubGVuZ3RoKWgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBrueEoeOBhOmmrOOCkuWPlua2iOODu+mZpOWkluOBqOOBv+OBquOBl+OBpuWkluOBl+OBn+ODrOODvOOCue+8miR7c2NyLm1hcChyPT5lc2Moci5sYWJlbCkrIu+8iCIrci5zY3JhdGNoZWQuam9pbigiLCIpKyLnlarvvIkiKS5qb2luKCLvvI8iKX3jgILlrp/pmpvjgavlh7rotbDjgZnjgovppqzjgarjgonjgIHjgqrjg4Pjgrrjga7lj5blvpfmvI/jgozjgafjgZnjgII8L2Rpdj5gOwogaWYoam1wLmxlbmd0aCloKz1gPGRpdiBjbGFzcz0ic21hbGwiPumanOWus+ODrOODvOOCuSAke2ptcC5sZW5ndGh95Lu244Gv44CB5bmz5Zyw55So44Gu44Oi44OH44Or44Gu44Gf44KB6Kej5p6Q44Gu5a++6LGh5aSW44Gr44GX44Gm44GE44G+44GZ44CCPC9kaXY+YDsKIGNvbnN0IGdhcD1XSy5zdG9yZUluZm8mJldLLnN0b3JlSW5mby5sYXN0JiZXSy5kYXRlc1swXT9NYXRoLnJvdW5kKChuZXcgRGF0ZShXSy5kYXRlc1swXSktbmV3IERhdGUoV0suc3RvcmVJbmZvLmxhc3QpKS84NjRlNSk6bnVsbDsKIGlmKGdhcCE9bnVsbCYmZ2FwPjEwKWgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuacgOaWsOOBruaIkOe4vuOBjCR7Z2FwfeaXpeWIhuWFpeOBo+OBpuOBhOOBvuOBm+OCk+OAguOAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZfjgabjgYvjgonjgIHjgoLjgYbkuIDluqbkuojmg7PjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogaWYocnMubGVuZ3RoJiZobWF0Y2g8aG9yc2VzKi40KWgrPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPumBjuWOu+ODh+ODvOOCv+OBqOeFp+WQiOOBp+OBjeOBn+mmrOOBjOWwkeOBquOCgeOBp+OBmeOAguiLpemnkuaIpuS4reW/g+OBruaXpeOBr+ato+W4uOOBp+OBmeOBjOOAgeOBneOBhuOBp+OBquOBkeOCjOOBsOmmrOWQjeOBruihqOiomOOBjOWQiOOBo+OBpuOBhOOBquOBhOWPr+iDveaAp+OBjOOBguOCiuOBvuOBmeOAgjwvZGl2Pic7CiBjb25zdCBvbj1XSy5vZGRzTm90ZXN8fHt9OwogaWYoT2JqZWN0LmtleXMob24pLmxlbmd0aCl7aCs9YDxoMz7jgqrjg4Pjgrrlj5blvpfjga7lhoXoqLM8L2gzPjxkaXYgY2xhc3M9InN0YXR1cyI+JHtXSy5kYXRlcy5tYXAoZD0+YCR7ZGF5TGFiZWwoZCl9XG4keyhvbltkXXx8W10pLm1hcChlc2MpLmpvaW4oIlxuIil9YCkuam9pbigiXG5cbiIpfTwvZGl2PmB9CiBoKz1gPGgzPumWi+WCrOWgtOOBlOOBqDwvaDM+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPumWi+WCrOWgtDwvdGg+PHRoPuODrOODvOOCuTwvdGg+PHRoPueKtuaFizwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IHggb2YgV0suZGlhZyl7CiAgY29uc3QgcHJvYnM9W107aWYoeC5lcnIpcHJvYnMucHVzaCh4LmVycik7aWYoeC5iYWQpcHJvYnMucHVzaChg5Ye66LWw6aas44KS6Kqt44KB44Gq44GE44Os44O844K5ICR7eC5iYWR9YCk7cHJvYnMucHVzaCguLi4oeC5pc3N1ZXN8fFtdKSk7CiAgaCs9YDx0cj48dGQ+JHtlc2MoZGF5TGFiZWwoeC5kKSl9ICR7ZXNjKHgubmFtZSl9PC90ZD48dGQ+JHt4Lm9rfS8ke3gucmFjZXN9PC90ZD48dGQgc3R5bGU9InRleHQtYWxpZ246bGVmdCI+JHtwcm9icy5sZW5ndGg/YDxzcGFuIGNsYXNzPSJiYWQgc21hbGwiPiR7cHJvYnMubWFwKGVzYykuam9pbigiPGJyPiIpfTwvc3Bhbj5gOic8c3BhbiBjbGFzcz0iZ29vZCI+5ZWP6aGM44Gq44GXPC9zcGFuPid9JHt4LmNvZGU/YCA8YnV0dG9uIGNsYXNzPSJtaW5pIHN1YiIgZGF0YS1ybD0iJHtlc2MoeC5kKX18JHtlc2MoeC5jb2RlKX18JHtlc2MoeC5uYW1lKX0iPuWGjeWPluW+lzwvYnV0dG9uPmA6IiJ9PC90ZD48L3RyPmA7CiB9CiBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiBlbC5pbm5lckhUTUw9aDsKIGVsLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLXJsXSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPWFzeW5jKCk9PnsKICBjb25zdCBbZCxjb2RlLG5hbWVdPWIuZGF0YXNldC5ybC5zcGxpdCgifCIpO2IuZGlzYWJsZWQ9dHJ1ZTt3a01zZyhgJHtkfSAke25hbWV9IOOCkuWGjeWPluW+l+S4reKApmApOwogIHRyeXthd2FpdCBsb2FkVmVudWVJbnRvKGJhc2VVcmwoKSxkLHt2ZW51ZUNvZGU6Y29kZSx2ZW51ZU5hbWU6bmFtZX0pO2F3YWl0IGZldGNoT2Rkc0RhdGUoYmFzZVVybCgpLGQpO2F3YWl0IGNhbGNXZWVrZW5kKCk7cmVuZGVyQWxsKCk7d2tNc2coIuWGjeWPluW+l+OBl+OBvuOBl+OBnyIpfQogIGNhdGNoKGUpe3drTXNnKCLlho3lj5blvpfjgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9CiB9KTsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOaTjeS9nAogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmZ1bmN0aW9uIHNob3dUYWIodCl7ZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiLnZpZXciKS5mb3JFYWNoKHY9PnYuY2xhc3NMaXN0LnRvZ2dsZSgib24iLHYuaWQ9PT10KSk7ZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI3RhYnMgYnV0dG9uIikuZm9yRWFjaChiPT5iLmNsYXNzTGlzdC50b2dnbGUoIm9uIixiLmRhdGFzZXQudGFiPT09dCkpfQpkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIjdGFicyBidXR0b24iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+c2hvd1RhYihiLmRhdGFzZXQudGFiKSk7CiQoInVwUnVuIikub25jbGljaz1hc3luYygpPT57CiAkKCJ1cFJ1biIpLmRpc2FibGVkPXRydWU7JCgidXBPdXQiKS50ZXh0Q29udGVudD0i5qSc6Ki85Lit4oCm77yI5pWw5YiG44GL44GL44KK44G+44GZ77yJIjsKIHRyeXsKICBjb25zdCByPWF3YWl0IHJ1blVwc2V0Rml0KHtzdGFydDokKCJ1cFN0YXJ0IikudmFsdWV8fCIyMDIxLTAxLTAxIn0pOwogICQoInVwT3V0IikuaW5uZXJIVE1MPXVwc2V0UmVwb3J0KHIpOwogIGlmKHIubW9kZWwpe2xvY2FsU3RvcmFnZS5zZXRJdGVtKFVQS0VZLEpTT04uc3RyaW5naWZ5KHIubW9kZWwpKTtpZihXSy5kYXRlcy5sZW5ndGgpe2F3YWl0IGNhbGNXZWVrZW5kKCk7cmVuZGVyQWxsKCl9fQogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoInVwT3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iYmFkIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXskKCJ1cFJ1biIpLmRpc2FibGVkPWZhbHNlfQp9OwokKCJ1cENsZWFyIikub25jbGljaz1hc3luYygpPT57bG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oVVBLRVkpOyQoInVwT3V0IikudGV4dENvbnRlbnQ9Iuaomea6luODouODh+ODq+OBq+aIu+OBl+OBvuOBl+OBn+OAgiI7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX07CiQoIndrR28iKS5vbmNsaWNrPXdlZWtlbmRHbzsKJCgid2tPZGRzIikub25jbGljaz1vZGRzT25seTsKJCgiYmtPbmUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGlmKEJLLmJ1c3kpcmV0dXJuOwogaWYoIUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpewogIGNvbnN0IHA9cHJvbXB0KCLjg5Djg4Pjgq/jgqLjg4Pjg5fnlKjjga7jg5Hjgrnjg5Xjg6zjg7zjgrrvvIg45paH5a2X5Lul5LiK77yJ44KS5rG644KB44Gm5YWl5Yqb44GX44Gm44GP44Gg44GV44GE44CC5b6p5YWD44Gu44Go44GN44Gr44KC5ZCM44GY44KC44Gu44GM5b+F6KaB44Gn44GZ44CCIik7CiAgaWYoIXApcmV0dXJuO0JLLnBhc3M9cC50cmltKCk7QksuaWQ9IiI7YmtTYXZlU2V0dGluZ3MoKTskKCJia1Bhc3MiKS52YWx1ZT1CSy5wYXNzOwogIGlmKEJLLnBhc3MubGVuZ3RoPDgpe2JrTXNnKCLjg5Hjgrnjg5Xjg6zjg7zjgrrjga845paH5a2X5Lul5LiK44Gr44GX44Gm44GP44Gg44GV44GE44CCIix0cnVlKTtyZXR1cm59CiB9CiBhd2FpdCBydW5CYWNrdXAoZmFsc2UpOwp9OwokKCJkYmdHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3Qgb3V0PSQoImRiZ091dCIpLGJhc2U9YmFzZVVybCgpOwogaWYoIVdLLmRhdGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiBvdXQudmFsdWU9IuiouuaWreS4reKApiI7JCgiZGJnR28iKS5kaXNhYmxlZD10cnVlO2NvbnN0IGxpbmVzPVtg5Y+W5b6X5pelICR7V0suZGF0ZXMuam9pbigiLCIpfWBdOwogdHJ5ewogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICAgY29uc3QgY29kZXM9Wy4uLm5ldyBTZXQoKFdLLmNhcmRzW2RdfHxbXSkubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbik7CiAgIGZvcihjb25zdCB2IG9mIGNvZGVzKXsKICAgIGNvbnN0IHJzPVdLLmNhcmRzW2RdLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIik9PT12KTsKICAgIGNvbnN0IHE9cnMubWFwKHI9PnIucXVhbGl0eSkuZmlsdGVyKEJvb2xlYW4pOwogICAgbGluZXMucHVzaChgXG7ilqAke2R9IOmWi+WCrOWgtCR7dn3vvIgke3JzWzBdPy52ZW51ZU5hbWV8fCIife+8ieODrOODvOOCuSR7cnMubGVuZ3Rofe+8j+OCs+ODvOOCueS4jeaYjiR7cnMuZmlsdGVyKHI9PiEoci5zdXJmYWNlJiZyLmRpc3RhbmNlKSkubGVuZ3Rofe+8j+mojuaJi+asoCR7cS5yZWR1Y2UoKHMseCk9PnMrKHguaG9yc2VzLXguam9ja2V5RmlsbGVkKSwwKX3vvI/oqr/mlZnluKvmrKAke3EucmVkdWNlKChzLHgpPT5zKyh4LmhvcnNlcy14LnRyYWluZXJGaWxsZWQpLDApfWApOwogICAgY29uc3QgYmFkPXJzLmZpbmQocj0+ci5xdWFsaXR5JiYhci5xdWFsaXR5Lm9rKXx8cnNbMF0scm49KGJhZCYmYmFkLnJhY2VOdW1iZXIpfHwxO2xpbmVzLnB1c2goYO+8iOWVj+mhjOOBruOBguOCi+ODrOODvOOCuSAke3JufVIg44KS6Kq/44G544G+44GZ77yJYCk7dHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2RlYnVnLWVudHJ5P2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9JnJhY2U9JHtybn1gLFsxNTAwXSk7ZGVsZXRlIHgub2s7bGluZXMucHVzaChKU09OLnN0cmluZ2lmeSh4KSl9Y2F0Y2goZSl7bGluZXMucHVzaCgi6Ki65pat44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogICB9CiAgfQogfWZpbmFsbHl7JCgiZGJnR28iKS5kaXNhYmxlZD1mYWxzZX0KIG91dC52YWx1ZT1saW5lcy5qb2luKCJcbiIpOwp9OwokKCJkYmdDb3B5Iikub25jbGljaz1hc3luYygpPT57Y29uc3QgdD0kKCJkYmdPdXQiKS52YWx1ZTt0cnl7YXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCk7JCgiZGJnQ29weSIpLnRleHRDb250ZW50PSLjgrPjg5Tjg7zjgZfjgb7jgZfjgZ8ifWNhdGNoKGUpeyQoImRiZ091dCIpLnNlbGVjdCgpO2FsZXJ0KCLpgbjmip7jgZfjgb7jgZfjgZ/jgILjgrPjg5Tjg7zjgZfjgabjgY/jgaDjgZXjgYTjgIIiKX19OwokKCJmaWxlIikub25jaGFuZ2U9ZT0+e2NvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoZilpbXBvcnRGaWxlKGYpO2UudGFyZ2V0LnZhbHVlPSIifTsKCmlmKC9eaHR0cHM/Oi8udGVzdChsb2NhdGlvbi5wcm90b2NvbCkpJCgid3VybCIpLnZhbHVlPWxvY2F0aW9uLm9yaWdpbjtlbHNlICQoInd1cmwiKS52YWx1ZT0iaHR0cHM6Ly9rZWliYS1haS1wYXlvdXRzLmh0MTk5NTA4MjIud29ya2Vycy5kZXYiOwpyZW5kZXJHYXRlKCk7cmVuZGVyQWxsKCk7Cihhc3luYygpPT57dHJ5e2F3YWl0IG9wZW5EQigpO2F3YWl0IHNob3dTdGF0ZSgpO2F3YWl0IGJrSW5pdCgpfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kv53lrZjpoJjln5/jgpLplovjgZHjgb7jgZvjgpPvvJoke2VzYyhlLm1lc3NhZ2UpfVxu77yI44OX44Op44Kk44OZ44O844OI44OW44Op44Km44K644Gn44Gv5L2/44GI44Gq44GE44GT44Go44GM44GC44KK44G+44GZ77yJPC9zcGFuPmB9fSkoKTsKCjwvc2NyaXB0Pgo8L2JvZHk+PC9odG1sPgo=";
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
