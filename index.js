/* =========================================================
 * 競馬AI Cloudflare Workers
 * src/index.js
 *
 * 第1回 / 10
 * 基本設定・共通関数
 * ======================================================= */

const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-10-11-cpu-fix-1";

const HISTORICAL_DATA_START =
  "2019-01-01";


/* 開催場コード */

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
          "GET,HEAD,OPTIONS",

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

function getDateString(
  year,
  month,
  day
) {

  return (

    String(year)
      .padStart(4, "0") +

    "-" +

    String(month)
      .padStart(2, "0") +

    "-" +

    String(day)
      .padStart(2, "0")

  );

}


/* =========================================================
 * 月の日数
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

async function fetchJRAHtml(
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

function toAbsoluteJraUrl(
  href
) {

  let value =
    String(
      href || ""
    );

  if (!value) {
    return "";
  }

  value =
    value.replace(
      /&amp;/gi,
      "&"
    );

  value =
    value.replace(
      /\\u0026/g,
      "&"
    );

  if (
    value.startsWith("//")
  ) {

    return (
      "https:" +
      value
    );

  }

  if (
    value.startsWith("/")
  ) {

    return (
      JRA_BASE +
      value
    );

  }

  return value;

}
/* =========================================================
 * 第2回 / 10
 * JRAレースリンク取得・CNAME解析
 * ======================================================= */


/* =========================================================
 * JRA内部CNAME抽出
 *
 * 開催日ページなどに埋め込まれている
 * pw01srl / pw01sde のCNAMEを取得する。
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

function extractJRALinks(html, baseUrl = JRA_BASE) {

  const links = [];
  const seen = new Set();

  if (!html) {
    return links;
  }

  /*
   * JRAのHTMLには、レース結果ページへのURLが
   * hrefだけでなく、JavaScriptや属性内に
   * CNAMEとして埋め込まれている場合がある。
   *
   * そのため accessS.html の完全一致ではなく
   * CNAMEそのものを検索する。
   */

  const cnamePattern =
    /CNAME\s*=\s*["']?([^"'&<>\s#]+)["']?/gi;

  let match;

  while (
    (match = cnamePattern.exec(html)) !== null
  ) {

    let cname =
      match[1]
        .replace(/&amp;/gi, "&")
        .replace(/%26/gi, "&")
        .trim();

    /*
     * CNAMEの途中に余計な文字が付いている場合を除去
     */
    cname =
      cname.split('"')[0]
           .split("'")[0]
           .split(">")[0]
           .split("<")[0];

    if (
      !/^pw01sde\d+/i.test(cname)
    ) {
      continue;
    }

    const url =
      `${JRA_BASE}/JRADB/accessS.html?CNAME=${cname}`;

    if (!seen.has(url)) {

      seen.add(url);

      links.push(url);

    }

  }

  /*
   * 念のため通常のURL形式も拾う
   */
  const urlPattern =
    /(?:https?:\/\/[^"'<>\\s]+)?\/JRADB\/accessS\.html\?CNAME=([^"'<>\\s]+)/gi;

  while (
    (match = urlPattern.exec(html)) !== null
  ) {

    const cname =
      match[1]
        .replace(/&amp;/gi, "&")
        .replace(/["'<>\s]+$/, "");

    if (
      !/^pw01sde\d+/i.test(cname)
    ) {
      continue;
    }

    const url =
      `${JRA_BASE}/JRADB/accessS.html?CNAME=${cname}`;

    if (!seen.has(url)) {

      seen.add(url);

      links.push(url);

    }

  }

  return links;
}


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

function getJRARaceLinksFromPage(html, baseUrl, targetDate = null) {
  const rawLinks = extractJRALinks(html, baseUrl);

  const parsed = rawLinks
    .map(parseJRACname)
    .filter(Boolean);

  const filtered = targetDate
    ? parsed.filter(x => x.date === targetDate)
    : parsed;

  const seen = new Set();

  return filtered.filter(x => {
    const key = `${x.venueCode}-${x.raceNo}-${x.date}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}


async function getJRARaceLinksFromBase(
  date,
  venueCode,
  meetingDate
) {
  const year = date.slice(0, 4);

  const baseCandidates = [
    `https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde100${venueCode}${meetingDate}`,
    `https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde100${venueCode}${year}${meetingDate.slice(4)}`
  ];

  for (const url of baseCandidates) {
    try {
      const html = await fetchJRAHtml(url);

      if (!html || html.length < 1000) continue;

      const links = getJRARaceLinksFromPage(
        html,
        url,
        date
      );

      if (links.length > 0) {
        return links;
      }
    } catch {}
  }

  return [];
}


/* =========================================================
 * コース情報
 * ======================================================= */

function extractCourseInfo(
  html
) {

  const result = {

    surface: "",

    distance: null

  };


  const text =
    normalizeText(
      stripHtml(
        html
      )
    );


  /*
   * 例
   *
   * コース：1,800メートル（ダート・右）
   */

  let match =
    text.match(
      /コース[：:]\s*([\d,]+)\s*メートル\s*[（(]\s*([^・）)]+)[・）)]/i
    );


  if (match) {

    result.distance =
      toNumberOrNull(
        match[1]
      );


    const surface =
      normalizeText(
        match[2]
      );


    if (
      surface.includes("芝")
    ) {

      result.surface =
        "芝";

    } else if (
      surface.includes("ダート")
    ) {

      result.surface =
        "ダート";

    } else if (
      surface.includes("障害")
    ) {

      result.surface =
        "障害";

    }

  }


  /*
   * 距離の予備取得
   */

  if (
    !result.distance
  ) {

    match =
      text.match(
        /(\d{3,4})\s*メートル/i
      );


    if (match) {

      result.distance =
        toNumberOrNull(
          match[1]
        );

    }

  }


  /*
   * 馬場種別の予備取得
   */

  if (
    !result.surface
  ) {

    if (
      /ダート/.test(
        text
      )
    ) {

      result.surface =
        "ダート";

    } else if (
      /芝/.test(
        text
      )
    ) {

      result.surface =
        "芝";

    } else if (
      /障害/.test(
        text
      )
    ) {

      result.surface =
        "障害";

    }

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

async function fetchOneJRARace(
  date,
  venueCode,
  venueName,
  race
) {

  if (
    !race ||
    !race.url
  ) {

    throw new Error(
      "レースURLがありません。"
    );

  }


  const html =
    await fetchJRAHtml(
      race.url
    );


  const parsed =
    extractJRAResultInfo(
      html
    );


  return {

    date,

    venue:
      venueName,

    venueCode,

    raceNumber:
  race.raceNumber ??
  race.raceNo,

    raceName:
      parsed.raceName,

    surface:
      parsed.surface,

    distance:
      parsed.distance,

    weather:
      parsed.weather,

    trackCondition:
      parsed.trackCondition,

    horses:
      parsed.horses,

    rowCount:
      parsed.horses.length,

    url:
      race.url

  };

}


/* =========================================================
 * レース結果 → 学習用フラットデータ
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

function makeModelInput(
  horse
) {

  return {

    frame:
      horse.frame,

    number:
      horse.horseNumber,

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

    /*
     * popularityは意図的に入れない。
     */

  };

}


/* =========================================================
 * AI入力チェック
 * ======================================================= */

function validateModelInput(
  input
) {

  if (!input) {
    return false;
  }


  /*
   * 人気・オッズを
   * モデル入力に入れない。
   */

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "popularity"
    )
  ) {

    delete input.popularity;

  }


  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "odds"
    )
  ) {

    delete input.odds;

  }


  return true;

}


/* =========================================================
 * 勝率正規化
 * ======================================================= */

function normalizeWinProbabilities(
  values
) {

  const numbers =
    values.map(
      value =>
        Number.isFinite(
          Number(value)
        )
          ? Math.max(
              0,
              Number(value)
            )
          : 0
    );


  const total =
    numbers.reduce(
      (
        sum,
        value
      ) =>
        sum + value,

      0

    );


  if (
    total <= 0
  ) {

    const equal =
      numbers.length
        ? 1 / numbers.length
        : 0;


    return numbers.map(
      () =>
        equal
    );

  }


  return numbers.map(
    value =>
      value / total
  );

}


/* =========================================================
 * 予想スコア → 勝率
 * ======================================================= */

function scoresToWinProbabilities(
  scores
) {

  const safeScores = scores.map(score => {
    const value = Number(score);
    return Number.isFinite(value) ? value : 0;
  });

  if (safeScores.length === 0) return [];

  // スコアの単純割り算では点数差が勝率にほとんど反映されないため、softmaxで相対差を反映。
  // 温度12は暫定値。過去レースの時系列バックテストで校正するまでは確率の精度を保証しない。
  const temperature = 12;
  const maxScore = Math.max(...safeScores);
  const weights = safeScores.map(score => Math.exp((score - maxScore) / temperature));
  return normalizeWinProbabilities(weights);

}
/* =========================================================
 * 第4回 / 10
 * 過去走・モデル計算
 * ======================================================= */


/* =========================================================
 * 日付順ソート
 * ======================================================= */

function sortRowsChronologically(
  rows
) {

  return [...(
    rows || []
  )].sort(
    (a, b) => {

      const dateA =
        String(
          a.date || ""
        );

      const dateB =
        String(
          b.date || ""
        );

      if (
        dateA !== dateB
      ) {

        return dateA.localeCompare(
          dateB
        );

      }

      const raceA =
        Number(
          a.raceNumber || 0
        );

      const raceB =
        Number(
          b.raceNumber || 0
        );

      return raceA - raceB;

    }
  );

}


/* =========================================================
 * 馬名の正規化
 * ======================================================= */

function normalizeHorseName(
  name
) {

  return normalizeText(
    name
  )
    .replace(
      /\s+/g,
      ""
    );

}


/* =========================================================
 * 同一馬の過去走取得
 *
 * 現在のレースより前だけを使用する。
 * ======================================================= */

function getPastRuns(
  rows,
  horseName,
  currentDate
) {

  const target =
    normalizeHorseName(
      horseName
    );

  const date =
    String(
      currentDate || ""
    );


  if (
    !target ||
    !date
  ) {

    return [];

  }


  return sortRowsChronologically(
    (rows || [])
      .filter(
        row => {

          const rowHorse =
            normalizeHorseName(
              row.horse
            );

          return (
            rowHorse === target &&
            String(
              row.date || ""
            ) < date
          );

        }
      )
  );

}


/* =========================================================
 * 平均値
 * ======================================================= */

function average(
  values
) {

  const numbers =
    (values || [])
      .map(
        Number
      )
      .filter(
        Number.isFinite
      );


  if (
    numbers.length === 0
  ) {

    return null;

  }


  return (
    numbers.reduce(
      (
        sum,
        value
      ) =>
        sum + value,

      0
    ) /
    numbers.length
  );

}


/* =========================================================
 * 過去走特徴量
 * ======================================================= */

function buildPastRunFeatures(
  pastRuns
) {

  const runs =
    pastRuns || [];


  const recent =
    runs.slice(
      -5
    );


  const finishes =
    recent
      .map(
        row =>
          Number(
            row.finish
          )
      )
      .filter(
        Number.isFinite
      );


  const distances =
    recent
      .map(
        row =>
          Number(
            row.distance
          )
      )
      .filter(
        Number.isFinite
      );


  const last3Fs =
    recent
      .map(
        row =>
          Number(
            row.estimatedLast3F
          )
      )
      .filter(
        Number.isFinite
      );


  const wins =
    finishes.filter(
      value =>
        value === 1
    ).length;


  const top3 =
    finishes.filter(
      value =>
        value <= 3
    ).length;


  const averageFinish =
    average(
      finishes
    );


  const averageLast3F =
    average(
      last3Fs
    );


  const averageDistance =
    average(
      distances
    );


  return {

    pastRunCount:
      runs.length,

    recentRunCount:
      recent.length,

    wins,

    top3,

    winRate:
      recent.length
        ? wins / recent.length
        : 0,

    top3Rate:
      recent.length
        ? top3 / recent.length
        : 0,

    averageFinish,

    averageLast3F,

    averageDistance

  };

}


/* =========================================================
 * コース適性
 * ======================================================= */

function calculateCourseScore(
  horse,
  race,
  pastRuns
) {

  let score = 50;


  const surface =
    normalizeText(
      race.surface
    );


  const distance =
    Number(
      race.distance
    );


  const matchingSurface =
    pastRuns.filter(
      row =>
        surface &&
        normalizeText(
          row.surface
        ) === surface
    );


  if (
    matchingSurface.length > 0
  ) {

    score += Math.min(
      15,
      matchingSurface.length * 3
    );

  }


  if (
    Number.isFinite(
      distance
    )
  ) {

    const matchingDistance =
      pastRuns.filter(
        row => {

          const d =
            Number(
              row.distance
            );

          return (
            Number.isFinite(d) &&
            Math.abs(
              d - distance
            ) <= 200
          );

        }
      );


    score += Math.min(
      15,
      matchingDistance.length * 3
    );

  }


  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );

}


/* =========================================================
 * 安定性スコア
 * ======================================================= */

function calculateConsistencyScore(
  features
) {

  if (
    !features ||
    !features.recentRunCount
  ) {

    return 50;

  }


  let score = 50;


  if (
    features.averageFinish != null
  ) {

    if (
      features.averageFinish <= 3
    ) {

      score += 25;

    } else if (
      features.averageFinish <= 5
    ) {

      score += 15;

    } else if (
      features.averageFinish <= 8
    ) {

      score += 5;

    } else if (
      features.averageFinish >= 12
    ) {

      score -= 15;

    }

  }


  score +=
    features.top3Rate *
    25;


  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );

}


/* =========================================================
 * 馬ごとのモデルスコア
 * ======================================================= */

function calculateHorseScore(
  horse,
  race,
  pastRuns
) {

  const features =
    buildPastRunFeatures(
      pastRuns
    );


  const courseScore =
    calculateCourseScore(
      horse,
      race,
      pastRuns
    );


  const consistencyScore =
    calculateConsistencyScore(
      features
    );


  // 近走成績を「平均着順」だけに寄せず、勝率・複勝圏率・直近の内容を分けて評価する。
  // オッズ・人気は一切参照しない。これは学習済み確率ではなく、検証前の暫定スコア。
  const recentRuns = (pastRuns || []).slice(-5);
  const validFinishes = recentRuns
    .map(row => Number(row.finish))
    .filter(value => Number.isFinite(value) && value > 0);
  const avgFinish = validFinishes.length
    ? validFinishes.reduce((sum, value) => sum + value, 0) / validFinishes.length
    : null;
  const recentWinRate = validFinishes.length
    ? validFinishes.filter(value => value === 1).length / validFinishes.length
    : 0;
  const recentTop3Rate = validFinishes.length
    ? validFinishes.filter(value => value <= 3).length / validFinishes.length
    : 0;

  let recentFormScore = 50;
  if (avgFinish !== null) {
    // 着順の差を滑らかに反映し、1～3着と二桁着順の差が埋もれにくいようにする。
    recentFormScore = Math.max(5, Math.min(95, 78 - (avgFinish - 1) * 6.5));
  }
  const winScore = recentWinRate * 100;
  const top3Score = recentTop3Rate * 100;
  const recentScore = validFinishes.length
    ? Math.max(5, Math.min(95, 78 - (validFinishes[validFinishes.length - 1] - 1) * 6.5))
    : 50;

  let score =
    recentFormScore * 0.30 +
    winScore * 0.15 +
    top3Score * 0.15 +
    recentScore * 0.10 +
    consistencyScore * 0.15 +
    courseScore * 0.15;

  if (features.recentRunCount === 0) {
    // 履歴なしは、履歴のある馬と同等に見せず中立より少し低めに置く。
    score = 42;
  }


  /*
   * AI入力には
   * オッズ・人気を一切使用しない。
   */


  return Math.max(
    1,
    Math.min(
      99,
      Math.round(
        score
      )
    )
  );

}


/* =========================================================
 * レース全体を予想
 * ======================================================= */

function predictRace(
  race,
  historicalRows
) {

  const horses =
    race.horses || [];


  const scored =
    horses.map(
      horse => {

        const pastRuns =
          getPastRuns(
            historicalRows,
            horse.horseName ||
              horse.horse,
            race.date
          );


        const score =
          calculateHorseScore(
            horse,
            race,
            pastRuns
          );


        return {

          ...horse,

          score,

          pastRuns:
            pastRuns.length,

          modelInput:
            makeModelInput(
              horse
            )

        };

      }
    );


  const probabilities =
    scoresToWinProbabilities(
      scored.map(
        horse =>
          horse.score
      )
    );


  return scored.map(
    (
      horse,
      index
    ) => ({

      ...horse,

      winProbability:
        probabilities[index],

      winPercent:
        Number(
          (
            probabilities[index] *
            100
          ).toFixed(2)
        )

    })
  );

}


/* =========================================================
 * 3着内率の簡易推定
 * ======================================================= */

function addPlaceProbabilities(
  horses
) {

  const sorted =
    [...(
      horses || []
    )].sort(
      (a, b) =>
        b.winProbability -
        a.winProbability
    );


  return sorted.map(
    (
      horse,
      index
    ) => {

      const win =
        Number(
          horse.winProbability ||
          0
        );


      const positionFactor =
        Math.max(
          0.35,
          1 -
          index * 0.12
        );


      const second =
        win *
        0.82 *
        positionFactor;


      const third =
        win *
        0.68 *
        positionFactor;


      const inTheMoney =
        Math.min(
          0.98,
          win +
          second +
          third
        );


      return {

        ...horse,

        secondProbability:
          second,

        thirdProbability:
          third,

        inTheMoneyProbability:
          inTheMoney,

        secondPercent:
          Number(
            (
              second *
              100
            ).toFixed(2)
          ),

        thirdPercent:
          Number(
            (
              third *
              100
            ).toFixed(2)
          ),

        inTheMoneyPercent:
          Number(
            (
              inTheMoney *
              100
            ).toFixed(2)
          )

      };

    }

  );

}
/* =========================================================
 * 第5回 / 10
 * 過去データ保存・読み込み
 * ======================================================= */


/* =========================================================
 * Cloudflare KVが使える場合の読み込み
 * ======================================================= */

/* =========================================================
 * 履歴KV取得
 *
 * 旧形式:
 *   history_rows
 *
 * 新形式:
 *   history_day_YYYY-MM-DD
 *
 * 既存データを残したまま、新方式を追加する。
 * ======================================================= */

function getHistoryKV(env) {
  return (
    env?.HISTORY ||
    env?.KEIBA_HISTORY ||
    env?.DATA ||
    null
  );
}


/* =========================================================
 * 1日分の履歴キー
 * ======================================================= */

function makeHistoryDayKey(date) {
  if (!isValidDateString(date)) {
    throw new Error(
      "date は YYYY-MM-DD 形式で指定してください"
    );
  }

  return `history_day_${date}`;
}


/* =========================================================
 * 1日分の履歴を保存
 * ======================================================= */

async function saveHistoryDay(env, date, rows) {
  const kv = getHistoryKV(env);

  if (
    !kv ||
    typeof kv.put !== "function"
  ) {
    throw new Error(
      "HISTORY KV binding not configured"
    );
  }

  const safeRows =
    Array.isArray(rows)
      ? deduplicateHistoryRows(rows)
      : [];

  const key =
    makeHistoryDayKey(date);

  await kv.put(
    key,
    JSON.stringify(safeRows)
  );

  return {
    saved: true,
    key,
    rows: safeRows.length
  };
}


/* =========================================================
 * 1日分の履歴を取得
 * ======================================================= */

async function loadHistoryDay(env, date) {
  const kv = getHistoryKV(env);

  if (
    !kv ||
    typeof kv.get !== "function"
  ) {
    return [];
  }

  const key =
    makeHistoryDayKey(date);

  try {
    const data =
      await kv.get(
        key,
        "json"
      );

    return Array.isArray(data)
      ? data
      : [];

  } catch (error) {

    console.error(
      `history day load error: ${key}`,
      error
    );

    return [];
  }
}


/* =========================================================
 * 保存済み履歴を取得
 *
 * 既存の history_rows も読み込む。
 * 新方式の history_day_YYYY-MM-DD も読み込む。
 *
 * ※インポート処理そのものでは使用しない。
 * ======================================================= */

async function loadStoredHistory(env) {
  const kv = getHistoryKV(env);

  if (
    !kv ||
    typeof kv.get !== "function"
  ) {
    return [];
  }

  const allRows = [];

  /* -------------------------------------------------------
   * 旧形式 history_rows
   * ----------------------------------------------------- */

  try {
    const oldData =
      await kv.get(
        "history_rows",
        "json"
      );

    if (Array.isArray(oldData)) {
      allRows.push(...oldData);
    }

  } catch (error) {

    console.error(
      "history_rows load error",
      error
    );
  }


  /* -------------------------------------------------------
   * 新形式 history_day_YYYY-MM-DD
   *
   * KV list が利用できる場合のみ取得する。
   * ----------------------------------------------------- */

  if (typeof kv.list === "function") {

    try {

      let cursor = undefined;

      do {

        const result =
          await kv.list({
            prefix: "history_day_",
            ...(cursor
              ? { cursor }
              : {})
          });

        const keys =
          Array.isArray(result?.keys)
            ? result.keys
            : [];

        for (const item of keys) {

          const key =
            item?.name;

          if (
            !key ||
            key === "history_rows"
          ) {
            continue;
          }

          try {

            const data =
              await kv.get(
                key,
                "json"
              );

            if (Array.isArray(data)) {
              allRows.push(...data);
            }

          } catch (error) {

            console.error(
              `history day load error: ${key}`,
              error
            );
          }
        }

        cursor =
          result?.list_complete
            ? undefined
            : result?.cursor;

      } while (cursor);

    } catch (error) {

      console.error(
        "history day list error",
        error
      );
    }
  }


  return deduplicateHistoryRows(
    allRows
  );
}


/* =========================================================
 * Cloudflare KVへ保存
 *
 * 旧形式との互換性のため残す。
 *
 * 新しいインポート処理では、
 * saveHistoryDay() を使用する。
 * ======================================================= */

async function saveStoredHistory(
  env,
  rows
) {

  const kv = getHistoryKV(env);

  if (
    !kv ||
    typeof kv.put !== "function"
  ) {

    return {
      saved: false,
      reason:
        "KV binding not configured"
    };
  }

  try {

    const safeRows =
      Array.isArray(rows)
        ? rows
        : [];

    await kv.put(
      "history_rows",
      JSON.stringify(
        safeRows
      )
    );

    return {

      saved: true,

      rows:
        safeRows.length

    };

  } catch (error) {

    console.error(
      "history save error",
      error
    );

    return {

      saved: false,

      reason:
        String(
          error?.message ||
          error
        )

    };
  }
}


/* =========================================================
 * 重複除去
 * ======================================================= */

function deduplicateHistoryRows(
  rows
) {

  const map =
    new Map();

  for (
    const row of
      rows || []
  ) {

    const date =
      String(
        row.date || ""
      );

    const venue =
      String(
        row.venueCode || ""
      );

    const race =
      String(
        row.raceNumber || ""
      );

    const number =
      String(
        row.number || ""
      );

    const horse =
      normalizeHorseName(
        row.horse
      );

    const key =
      [
        date,
        venue,
        race,
        number,
        horse
      ].join("|");

    if (
      !map.has(key)
    ) {

      map.set(
        key,
        row
      );
    }
  }

  return Array.from(
    map.values()
  );
}


/* =========================================================
 * 保存データの期間
 * ======================================================= */

function getHistoryPeriod(
  rows
) {

  const dates =
    (rows || [])
      .map(
        row =>
          String(
            row.date || ""
          )
      )
      .filter(
        isValidDateString
      )
      .sort();

  if (
    dates.length === 0
  ) {

    return {
      start: null,
      end: null
    };
  }

  return {

    start:
      dates[0],

    end:
      dates[
        dates.length - 1
      ]

  };
}


/* =========================================================
 * レース数
 * ======================================================= */

function countHistoryRaces(
  rows
) {

  const races =
    new Set();

  for (
    const row of
      rows || []
  ) {

    if (
      !row.date ||
      !row.venueCode ||
      !row.raceNumber
    ) {
      continue;
    }

    races.add(
      makeRaceId(
        row.date,
        row.venueCode,
        row.raceNumber
      )
    );
  }

  return races.size;
}


/* =========================================================
 * 馬数
 * ======================================================= */

function countHistoryHorses(
  rows
) {

  const horses =
    new Set();

  for (
    const row of
      rows || []
  ) {

    const name =
      normalizeHorseName(
        row.horse
      );

    if (name) {
      horses.add(name);
    }
  }

  return horses.size;
}


/* =========================================================
 * 履歴統計
 * ======================================================= */

function getHistoryStats(
  rows
) {

  const safeRows =
    Array.isArray(rows)
      ? rows
      : [];

  const period =
    getHistoryPeriod(
      safeRows
    );

  return {

    rows:
      safeRows.length,

    races:
      countHistoryRaces(
        safeRows
      ),

    horses:
      countHistoryHorses(
        safeRows
      ),

    start:
      period.start,

    end:
      period.end

  };
}


/* =========================================================
 * JRA結果URL取得
 * ======================================================= */

async function discoverJRAResultUrlsByDate(date) {

  if (!isValidDateString(date)) {

    throw new Error(
      "date は YYYY-MM-DD 形式で指定してください"
    );
  }

  const races =
    await discoverJRARacesForDate(
      date
    );

  return races.map(race => ({

    date,

    venueCode:
      race.venueCode,

    venueName:
      race.venue ||
      race.venueName ||
      HISTORY_VENUES[
        race.venueCode
      ],

    venue:
      race.venue ||
      race.venueName ||
      HISTORY_VENUES[
        race.venueCode
      ],

    raceNo:
      race.raceNumber ||
      race.raceNo,

    raceNumber:
      race.raceNumber ||
      race.raceNo,

    url:
      race.url ||
      race.resultUrl ||
      null

  }));
}


/* =========================================================
 * 1日分の履歴をインポート
 *
 * ★重要
 *
 * ここでは過去の全履歴を読み込まない。
 *
 * JRA
 * ↓
 * 当日の全レース
 * ↓
 * 当日のrows
 * ↓
 * history_day_YYYY-MM-DD
 *
 * ======================================================= */

async function importHistoryDay(env, date) {
  if (!isValidDateString(date)) {
    throw new Error("date は YYYY-MM-DD 形式で指定してください");
  }

  const raceUrls = await discoverJRAResultUrlsByDate(date);
  const existingRows = await loadHistoryDay(env, date);
  const newRows = [];
  const failedRaces = [];

  if (raceUrls.length === 0) {
    return {
      ok: existingRows.length > 0,
      source: "JRA",
      date,
      discoveredRaces: 0,
      importedRaces: 0,
      importedRows: 0,
      totalRows: existingRows.length,
      storage: {
        saved: false,
        preserved: existingRows.length > 0,
        reason: "JRAのレースURLが見つかりませんでした。既存データは変更していません。"
      },
      failedRaces: [{ reason: "JRAのレースURLが見つかりませんでした" }]
    };
  }

  for (const race of raceUrls) {
    try {
      const result = await fetchOneJRARace(
        race.date,
        race.venueCode,
        race.venueName,
        race
      );

      if (!result || !Array.isArray(result.horses) || result.horses.length === 0) {
        failedRaces.push({
          venue: race.venueName,
          venueCode: race.venueCode,
          raceNo: race.raceNo,
          reason: "結果データが0頭"
        });
        continue;
      }

      const rows = raceResultToRows(result);
      if (Array.isArray(rows) && rows.length > 0) {
        newRows.push(...rows);
      } else {
        failedRaces.push({
          venue: race.venueName,
          venueCode: race.venueCode,
          raceNo: race.raceNo,
          reason: "結果行への変換が0件"
        });
      }
    } catch (error) {
      failedRaces.push({
        venue: race.venueName,
        venueCode: race.venueCode,
        raceNo: race.raceNo,
        reason: String(error?.message || error)
      });
      console.error(
        `履歴取得失敗: ${date} ${race.venueName} ${race.raceNo}R`,
        error
      );
    }
  }

  const freshRows = deduplicateHistoryRows(newRows);
  const dayRows = deduplicateHistoryRows([...existingRows, ...freshRows]);

  // 空の取得結果で、既存の保存済みデータを上書きしない。
  if (freshRows.length === 0) {
    return {
      ok: dayRows.length > 0,
      source: "JRA",
      date,
      discoveredRaces: raceUrls.length,
      importedRaces: 0,
      importedRows: 0,
      totalRows: dayRows.length,
      storage: {
        saved: false,
        preserved: dayRows.length > 0,
        reason: "新しい結果行を取得できなかったため、既存データを変更していません。"
      },
      failedRaces
    };
  }

  const saveResult = await saveHistoryDay(env, date, dayRows);
  const importedRaces = new Set(
    freshRows.map(row => `${row.date}-${row.venueCode}-${row.raceNumber}`)
  ).size;

  return {
    ok: saveResult.saved === true,
    source: "JRA",
    date,
    discoveredRaces: raceUrls.length,
    importedRaces,
    importedRows: freshRows.length,
    totalRows: dayRows.length,
    storage: saveResult,
    failedRaces
  };
}

/* =========================================================
 * 履歴取得の期間チェック
 * ======================================================= */

function normalizePeriod(from, to) {
  const start = from || HISTORICAL_DATA_START;
  const end = to || todayJST();

  if (!isValidDateString(start) || !isValidDateString(end)) {
    throw new Error("期間は YYYY-MM-DD 形式で指定してください");
  }

  if (start > end) {
    throw new Error("開始日は終了日以前にしてください");
  }

  return {
    from: start,
    to: end
  };
}

/* =========================================================
 * 日付列挙
 * ======================================================= */

function enumerateDates(
  from,
  to
) {

  const dates = [];


  let current =
    new Date(
      `${from}T00:00:00Z`
    );


  const end =
    new Date(
      `${to}T00:00:00Z`
    );


  while (
    current <= end
  ) {

    dates.push(
      current
        .toISOString()
        .slice(
          0,
          10
        )
    );


    current =
      new Date(
        current.getTime() +
        86400000
      );

  }


  return dates;

}


/* =========================================================
 * 月初・月末
 * ======================================================= */

function getMonthRange(
  year,
  month
) {

  const y =
    Number(year);


  const m =
    Number(month);


  const lastDay =
    getDaysInMonth(
      y,
      m
    );


  return {

    from:
      getDateString(
        y,
        m,
        1
      ),

    to:
      getDateString(
        y,
        m,
        lastDay
      )

  };

}
/* =========================================================
 * 第6回 / 10
 * 履歴取得・テスト用API
 * ======================================================= */


/* =========================================================
 * 指定期間の履歴インポート
 * ======================================================= */

async function importHistoryPeriod(env, from, to, maxDays = 31) {
  const period = normalizePeriod(from, to);

  const dates = enumerateDates(
    period.from,
    period.to
  );

  if (dates.length > maxDays) {
    throw new Error(
      `一度に取得できるのは${maxDays}日までです`
    );
  }

  const results = [];

  for (const date of dates) {
    try {
      const result = await importHistoryDay(
        env,
        date
      );

      results.push(result);
    } catch (error) {
      results.push({
        ok: false,
        date,
        error: String(error?.message || error)
      });
    }
  }

  const storedRows = await loadStoredHistory(env);
  const stats = getHistoryStats(storedRows);

  return {
    ok: true,
    from: period.from,
    to: period.to,
    days: results,
    totalRows: stats.rows,
    totalRaces: stats.races
  };
}

/* =========================================================
 * 履歴状態
 * ======================================================= */

async function handleHistoryStatus(
  env
) {

  const rows =
    await loadStoredHistory(
      env
    );


  return json({

    ok: true,

    source:
      "JRA",

    historicalDataStart:
      HISTORICAL_DATA_START,

    stats:
      getHistoryStats(
        rows
      )

  });

}


/* =========================================================
 * 履歴インポートAPI
 *
 * /import-history?date=2019-01-05
 *
 * または
 *
 * /import-history?from=2019-01-01&to=2019-01-05
 * ======================================================= */

async function handleImportHistory(request, env) {
  const url = new URL(request.url);

  const date = url.searchParams.get("date");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  try {
    if (date) {
      const result = await importHistoryDay(env, date);
      return json(result);
    }

    if (from || to) {
      const result = await importHistoryPeriod(
        env,
        from,
        to
      );
      return json(result);
    }

    return errorResponse(
      "date または from / to を指定してください",
      400
    );
  } catch (error) {
    return errorResponse(
      String(error?.message || error),
      500
    );
  }
}

/* =========================================================
 * JRA 2019年1月5日テスト
 * ======================================================= */

async function testJRA20190105(env) {

  const date = "2019-01-05";

  const venueCode = "06";
  const venue = "中山";
  const raceNo = 3;

  const meetingDate = "20190101";
  const dateKey = "20190105";

  const raceNoText =
    String(raceNo).padStart(2, "0");

  const cname =
    `pw01sde100${venueCode}${meetingDate}${raceNoText}${dateKey}`;

  const url =
    `${JRA_BASE}/JRADB/accessS.html?CNAME=${cname}`;

  const html =
    await fetchJRAHtml(url);

  const info =
    extractJRAResultInfo(html);

  const rows =
    info &&
    Array.isArray(info.horses)
      ? info.horses
      : [];

  return {

    ok: true,

    source: "JRA",

    test: "testJRA20190105",

    date,

    venueCode,

    venue,

    raceNo,

    url,

    htmlLength:
      html.length,

    rowCount:
      rows.length,

    rows:
      rows.slice(0, 5)

  };

}

/* =========================================================
 * 2019年1月履歴テスト
 * ======================================================= */

async function testHistory2019January(env) {

  const date = "2019-01-05";

  const venues = [
    {
      venueCode: "06",
      venue: "中山"
    },
    {
      venueCode: "08",
      venue: "京都"
    }
  ];

  const results = [];

  let totalRaces = 0;
  let totalRows = 0;

  for (const venueInfo of venues) {

    let raceCount = 0;
    let rowCount = 0;

    for (let raceNo = 1; raceNo <= 12; raceNo++) {

      try {

        /*
         * JRAのレース結果ページを直接生成する。
         *
         * 2019-01-05
         * 中山 = 06
         * 京都 = 08
         *
         * JRA CNAME:
         * pw01sde1006201901010320190105
         *
         * 形式:
         * pw01sde100
         * + venueCode
         * + meetingDate
         * + raceNo
         * + raceDate
         */

        const meetingDate = "20190101";
        const dateKey = date.replace(/-/g, "");

        const raceNoText =
          String(raceNo).padStart(2, "0");

        const cname =
          `pw01sde100${venueInfo.venueCode}${meetingDate}${raceNoText}${dateKey}`;

        const url =
          `${JRA_BASE}/JRADB/accessS.html?CNAME=${cname}`;

        const html =
          await fetchJRAHtml(url);

        if (!html || html.length < 1000) {
          continue;
        }

        const info =
          extractJRAResultInfo(
            html,
            {
              date,
              venueCode: venueInfo.venueCode,
              venue: venueInfo.venue,
              raceNo,
              url
            }
          );

        if (
          info &&
          Array.isArray(info.horses) &&
          info.horses.length > 0
        ) {
          raceCount++;
          rowCount += info.horses.length;
        }

      } catch (error) {

        console.error(
          "testHistory2019January race error",
          {
            date,
            venueCode:
              venueInfo.venueCode,
            raceNo,
            error:
              String(
                error.message ||
                error
              )
          }
        );

      }

    }

    totalRaces += raceCount;
    totalRows += rowCount;

    results.push({

      date,

      venueCode:
        venueInfo.venueCode,

      venue:
        venueInfo.venue,

      raceCount,

      rowCount

    });

  }

  return {

    ok: true,

    source:
      "JRA",

    test:
      "testHistory2019January",

    period:
      date,

    totalRaces,

    totalRows,

    results

  };

}

/* =========================================================
 * 2019-01-05 完全取得テスト
 * ======================================================= */

async function testJRAFullDay(
  env
) {

  const date =
    "2019-01-05";


  const results = [];


  for (
    const venueCode of
      [
        "06",
        "08"
      ]
  ) {

    try {

      const seedUrl =
        `${JRA_BASE}/JRADB/accessD.html?CNAME=pw01dde1001201901${date.replace(/-/g, "")}`;


      const seedHtml = await fetchJRAHtml(seedUrl);
      const races = getJRARaceLinksFromPage(
        seedHtml,
        seedUrl,
        date
      ).filter(race =>
        race.venueCode === venueCode &&
        race.raceNo >= 1 &&
        race.raceNo <= 12
      ).map(info => ({
        info,
        link: info.url
      }));


      const unique =
        new Map();


      for (
        const item of
          races
      ) {

        unique.set(
          item.info.raceNo,
          item
        );

      }


      let rowCount = 0;


      for (
        const item of
          unique.values()
      ) {

        try {

          const race =
            await fetchOneJRARace(
              date,
              venueCode,
              HISTORY_VENUES[
                venueCode
              ],
              {
                ...item.info,
                url:
                  item.link
              }
            );


          rowCount +=
            race.rowCount;

        } catch (_) {

          /* 1レース失敗は
             全体を止めない */

        }

      }


      results.push({

        date,

        venueCode,

        venue:
          HISTORY_VENUES[
            venueCode
          ],

        raceCount:
          unique.size,

        rowCount

      });

    } catch (
      error
    ) {

      results.push({

        date,

        venueCode,

        error:
          String(
            error.message ||
            error
          )

      });

    }

  }


  return {

    ok: true,

    source:
      "JRA",

    test:
      "testJRAFullDay",

    period:
      date,

    totalRaces:
      results.reduce(
        (
          sum,
          item
        ) =>
          sum +
          Number(
            item.raceCount || 0
          ),
        0
      ),

    totalRows:
      results.reduce(
        (
          sum,
          item
        ) =>
          sum +
          Number(
            item.rowCount || 0
          ),
        0
      ),

    results

  };

}


/* =========================================================
 * 保存データから指定日のレース取得
 * ======================================================= */

async function getStoredRaces(
  env,
  date
) {

  const rows =
    await loadStoredHistory(
      env
    );


  const map =
    new Map();


  for (
    const row of
      rows
  ) {

    if (
      String(
        row.date || ""
      ) !== date
    ) {

      continue;

    }


    const key =
      makeRaceId(
        row.date,
        row.venueCode,
        row.raceNumber
      );


    if (
      !map.has(key)
    ) {

      map.set(
        key,
        {

          raceId:
            key,

          date:
            row.date,

          venue:
            row.place,

          venueCode:
            row.venueCode,

          raceNumber:
            row.raceNumber,

          raceName:
            row.raceName,

          surface:
            row.surface,

          distance:
            row.distance,

          weather:
            row.weather,

          going:
            row.going,

          horses: []

        }
      );

    }


    map.get(
      key
    ).horses.push({

      finishPosition:
        row.finish,

      frame:
        row.frame,

      horseNumber:
        row.number,

      horseName:
        row.horse,

      age:
        row.age,

      sex:
        row.sex,

      weight:
        row.weight,

      jockey:
        row.jockey,

      trainer:
        row.trainer,

      horseWeight:
        row.horseWeight,

      horseWeightChange:
        row.horseWeightChange,

      time:
        row.time,

      estimatedLast3F:
        row.estimatedLast3F,

      corner:
        row.corner,

      popularity:
        row.popularity

    });

  }


  return Array.from(
    map.values()
  );

}
/* =========================================================
 * 第7回 / 10
 * 次回レース・レースカードAPI
 * ======================================================= */


/* =========================================================
 * 今日以降のJRA開催候補日
 * ======================================================= */

function getUpcomingDates(
  startDate,
  days = 14
) {

  const result = [];


  if (
    !isValidDateString(
      startDate
    )
  ) {

    return result;

  }


  const start =
    new Date(
      `${startDate}T00:00:00Z`
    );


  for (
    let i = 0;
    i < days;
    i++
  ) {

    const date =
      new Date(
        start.getTime() +
        i * 86400000
      );


    result.push(
      date
        .toISOString()
        .slice(
          0,
          10
        )
    );

  }


  return result;

}


/* =========================================================
 * 指定日のJRA開催情報取得
 * ======================================================= */

/* =========================================================
 * JRA POST取得
 *
 * JRAの過去レース検索では
 * CNAMEをPOSTで送るページがあるため使用する。
 * ======================================================= */

/* =========================================================
 * JRA POST取得
 * ======================================================= */

async function fetchJRAHtmlPost(
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

async function discoverJRARacesForDate(
  date
) {

  if (
    !isValidDateString(
      date
    )
  ) {

    throw new Error(
      "date は YYYY-MM-DD 形式で指定してください"
    );

  }


  const [
    year,
    month
  ] =
    date
      .split("-")
      .map(Number);


  /*
   * -------------------------------------------------------
   * 1.
   * 指定年月の開催日ページを取得
   * -----------------------------------------------------
   */

  const meetingCnames =
    await discoverJRAMeetingPages(
      year,
      month
    );


  const allFound =
    new Map();


  /*
   * -------------------------------------------------------
   * 2.
   * 各開催日ページを調査
   *
   * 通常は月内の開催日ページが
   * 数十件程度。
   * -----------------------------------------------------
   */

  for (
    const meetingCname
      of meetingCnames
  ) {

    try {

      const html =
        await fetchJRAHtmlPost(
          "/JRADB/accessS.html",
          meetingCname
        );


      if (
        !html ||
        html.length < 500
      ) {
        continue;
      }


      /*
       * この開催日ページから
       * レース結果CNAMEを取得
       */

      const raceCnames =
        extractJRAInternalCnames(
          html,
          "pw01sde"
        );


      for (
        const cname
          of raceCnames
      ) {

        try {

          const url =
            `${JRA_BASE}/JRADB/accessS.html?CNAME=` +
            encodeURIComponent(
              cname
            );


          const race =
            parseJRACname(
              url
            );


          if (!race) {
            continue;
          }


          /*
           * 指定日以外は除外
           */

          if (
            race.date !== date
          ) {
            continue;
          }


          /*
           * 開催場コード確認
           */

          if (
            !HISTORY_VENUES[
              race.venueCode
            ]
          ) {
            continue;
          }


          /*
           * レース番号確認
           */

          if (
            race.raceNo < 1 ||
            race.raceNo > 12
          ) {
            continue;
          }


          const key =
            makeRaceId(
              date,
              race.venueCode,
              race.raceNo
            );


          if (
            !allFound.has(key)
          ) {

            allFound.set(
              key,
              {

                ...race,

                venue:
                  HISTORY_VENUES[
                    race.venueCode
                  ],

                venueName:
                  HISTORY_VENUES[
                    race.venueCode
                  ],

                cname

              }
            );

          }

        } catch (error) {

          console.error(
            "race cname parse error",
            {
              cname,
              error:
                String(
                  error?.message ||
                  error
                )
            }
          );

        }

      }

    } catch (error) {

      console.error(
        "meeting discovery error",
        {
          meetingCname,

          error:
            String(
              error?.message ||
              error
            )
        }
      );

    }

  }


  /*
   * -------------------------------------------------------
   * 3.
   * レース番号順に整理
   * -----------------------------------------------------
   */

  return Array.from(
    allFound.values()
  )
    .filter(
      race =>
        race.date === date &&
        HISTORY_VENUES[
          race.venueCode
        ]
    )
    .sort(
      (a, b) => {

        const venueCompare =
          String(
            a.venueCode
          ).localeCompare(
            String(
              b.venueCode
            )
          );


        if (
          venueCompare !== 0
        ) {
          return venueCompare;
        }


        return (
          Number(
            a.raceNo
          ) -
          Number(
            b.raceNo
          )
        );

      }
    );

}
/* =========================================================
 * 次回開催日の探索
 * ======================================================= */


/* =========================================================
 * JRA出馬表リンク発見・解析（過去結果処理とは独立）
 *
 * 出馬表CNAMEの末尾コードはJRA側が発行する値のため、
 * レース番号から推測せず、公式ページ上のリンクから取得する。
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

function parseJRAEntryHorseRow(row) {
  const horseName = extractEntryHorseName(row);
  if (!horseName) return null;

  const cells = getEntryCells(row);
  let numberText = getCellTextAny(row, ["num", "umaban", "horse_num", "horseNumber", "HorseNum", "Umaban"]);
  if (!numberText) {
    // 枠番セルには画像のalt属性しかないことがあるため、先頭4セルの数値を調べる。
    for (const cell of cells.slice(0, 4)) {
      const value = String(cell.text || "").replace(/[^0-9]/g, "");
      const n = Number(value);
      if (value && Number.isInteger(n) && n >= 1 && n <= 18) {
        numberText = String(n);
        break;
      }
    }
  }
  const horseNumber = toNumberOrNull(numberText);
  if (horseNumber == null || horseNumber < 1 || horseNumber > 18) return null;

  const weightText = getCellTextAny(row, ["weight", "futan", "burden_weight"]);
  let jockey = getCellTextAny(row, ["jockey", "kisyu", "rider"]);
  if (!jockey) {
    const jockeyCell = cells.find(cell => /(?:jockey|kisyu|rider|Kisyu)/i.test(cell.attrs));
    jockey = jockeyCell?.text || "";
  }
  const jockeyRaw = jockey;
  jockey = cleanJockeyText(jockey.replace(/^[☆★▲△\s]+/, "").trim());
  const ageText = getCellTextAny(row, ["age", "sex_age", "sexage"]);
  const ageMatch = ageText.match(/([牡牝セ騙])\s*(\d+)/);
  const sex = ageMatch ? ageMatch[1] : "";
  const age = ageMatch ? Number(ageMatch[2]) : null;
  const trainer = getCellTextAny(row, ["trainer", "chokyo"]);

  return {
    finishPosition: null,
    frame: extractFrameNumber(row),
    horseNumber,
    horseName,
    sex,
    age,
    weight: toNumberOrNull(weightText.replace(/[^\d.]/g, "")),
    jockey,
    jockeyRaw,
    trainer,
    time: "",
    estimatedLast3F: null,
    horseWeight: null,
    horseWeightChange: null,
    corner: [],
    popularity: null
  };
}

/* 出馬表ページに載っている、そのレースの単勝・複勝オッズ画面（pw151ou…）へのリンクを拾う */
function findOddsCname(html) {
  const t = String(html || "").replace(/%2F/gi, "/");
  const m = t.match(/pw151ou[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/i);
  return m ? m[0] : "";
}

function extractJRAEntryInfo(html) {
  const result = {
    oddsCname: findOddsCname(html),
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

  const tbodies = String(html || "").match(/<tbody[\s\S]*?<\/tbody>/gi) || [];
  for (const tbody of tbodies) {
    const rows = tbody.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const horse = parseJRAEntryHorseRow(row);
      if (horse && horse.horseNumber != null) result.horses.push(horse);
    }
  }

  // Some JRA page variants place the entries in a table without tbody.
  if (result.horses.length === 0) {
    const rows = String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const horse = parseJRAEntryHorseRow(row);
      if (horse && horse.horseNumber != null) result.horses.push(horse);
    }
  }

  const seen = new Set();
  result.horses = result.horses.filter(horse => {
    if (seen.has(horse.horseNumber)) return false;
    seen.add(horse.horseNumber);
    return true;
  }).sort((a, b) => a.horseNumber - b.horseNumber);

  return result;
}

async function findNextJRARaces() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const startDate = jst.toISOString().slice(0, 10);

  const allRaces = await discoverJRAEntryRacesForDate();
  const upcoming = allRaces.filter(race => race.date >= startDate);
  if (upcoming.length === 0) return { date: null, races: [] };

  const nextDate = upcoming
    .map(race => race.date)
    .sort((a, b) => a.localeCompare(b))[0];

  return {
    date: nextDate,
    races: upcoming.filter(race => race.date === nextDate)
  };
}


async function handleNextRace() {

  try {

    const result =
      await findNextJRARaces();


    return json({

      ok: true,

      source:
        "JRA",

      date:
        result.date,

      raceCount:
        result.races.length,

      races:
        result.races.map(
          race => ({

            date:
              race.date,

            venue:
              race.venue,

            venueCode:
              race.venueCode,

            raceNumber:
              race.raceNumber ?? race.raceNo,

            url:
              race.url

          })
        )

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}


/* =========================================================
 * 指定日のレースカード取得
 * ======================================================= */

/* 指定日の開催場一覧だけを軽く調べる（出馬表本体は取らない） */
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

async function handleRaceCards(request) {
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
          oddsCname: parsed.oddsCname || "",
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


async function handleVenues(
  request
) {

  const url =
    new URL(
      request.url
    );


  const date =
    url.searchParams.get(
      "date"
    );


  if (
    date &&
    !isValidDateString(
      date
    )
  ) {

    return errorResponse(
      "dateが正しくありません。",
      400
    );

  }


  try {

    const races =
      date
        ? await discoverJRARacesForDate(
            date
          )
        : [];


    const venues =
      new Map();


    for (
      const race of
        races
    ) {

      if (
        !venues.has(
          race.venueCode
        )
      ) {

        venues.set(
          race.venueCode,
          {

            venueCode:
              race.venueCode,

            venue:
              race.venue,

            raceCount:
              0

          }
        );

      }


      venues.get(
        race.venueCode
      ).raceCount++;

    }


    return json({

      ok: true,

      source:
        "JRA",

      date,

      venues:
        Array.from(
          venues.values()
        )

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}
/* =========================================================
 * 第8回 / 10
 * レース予想API・確率計算
 * ======================================================= */


/* =========================================================
 * レース結果を予想用形式へ変換
 * ======================================================= */

function convertRaceForPrediction(
  race
) {

  return {

    date:
      race.date,

    venue:
      race.venue,

    venueCode:
      race.venueCode,

    raceNumber:
      race.raceNumber,

    raceName:
      race.raceName,

    surface:
      race.surface,

    distance:
      race.distance,

    weather:
      race.weather,

    trackCondition:
      race.trackCondition ||
      race.going,

    horses:
      race.horses || []

  };

}


/* =========================================================
 * 逃げ馬候補
 * ======================================================= */

function estimateFrontRunner(
  horses
) {

  if (
    !Array.isArray(
      horses
    ) ||
    horses.length === 0
  ) {

    return null;

  }


  /*
   * 過去のコーナー位置を利用。
   *
   * 先頭に近い数字が多い馬を
   * 逃げ候補として評価する。
   */

  const candidates =
    horses.map(
      horse => {

        const corners =
          Array.isArray(
            horse.corner
          )
            ? horse.corner
            : [];


        let frontScore = 0;


        for (
          const corner of
            corners
        ) {

          const numbers =
            String(
              corner
            )
              .match(
                /\d+/g
              ) || [];


          if (
            numbers.length === 0
          ) {

            continue;

          }


          const first =
            Number(
              numbers[0]
            );


          if (
            first === 1
          ) {

            frontScore += 5;

          } else if (
            first === 2
          ) {

            frontScore += 4;

          } else if (
            first <= 4
          ) {

            frontScore += 3;

          } else if (
            first <= 6
          ) {

            frontScore += 1;

          }

        }


        return {

          horse,

          frontScore

        };

      }
    );


  candidates.sort(
    (a, b) =>
      b.frontScore -
      a.frontScore
  );


  return candidates[0] || null;

}


/* =========================================================
 * 想定ペース
 * ======================================================= */

function estimatePace(
  horses
) {

  if (
    !Array.isArray(
      horses
    ) ||
    horses.length === 0
  ) {

    return "不明";

  }


  const scores =
    horses.map(
      horse => {

        const corners =
          Array.isArray(
            horse.corner
          )
            ? horse.corner
            : [];


        let score = 0;


        for (
          const corner of
            corners
        ) {

          const numbers =
            String(
              corner
            )
              .match(
                /\d+/g
              ) || [];


          if (
            numbers.length === 0
          ) {

            continue;

          }


          const first =
            Number(
              numbers[0]
            );


          if (
            first === 1
          ) {

            score += 5;

          } else if (
            first <= 3
          ) {

            score += 3;

          } else if (
            first <= 5
          ) {

            score += 1;

          }

        }


        return score;

      }
    );


  const frontCount =
    scores.filter(
      score =>
        score >= 5
    ).length;


  if (
    frontCount >= 4
  ) {

    return "ハイ";

  }


  if (
    frontCount <= 1
  ) {

    return "スロー";

  }


  return "ミドル";

}


/* =========================================================
 * 予想結果整形
 * ======================================================= */

function buildPredictionResult(
  race,
  historicalRows
) {

  const prediction =
    predictRace(
      race,
      historicalRows
    );


  const withPlaces =
    addPlaceProbabilities(
      prediction
    );


  const sorted =
    [...withPlaces].sort(
      (a, b) =>
        b.winProbability -
        a.winProbability
    );


  const front =
    estimateFrontRunner(
      race.horses || []
    );


  return {

    date:
      race.date,

    venue:
      race.venue,

    venueCode:
      race.venueCode,

    raceNumber:
      race.raceNumber,

    raceName:
      race.raceName,

    surface:
      race.surface,

    distance:
      race.distance,

    weather:
      race.weather,

    trackCondition:
      race.trackCondition,

    expectedPace:
      estimatePace(
        race.horses || []
      ),

    frontRunner:
      front
        ? {

            horseNumber:
              front.horse.horseNumber,

            horseName:
              front.horse.horseName,

            score:
              front.frontScore

          }
        : null,

    horses:
      sorted.map(
        horse => ({

          horseNumber:
            horse.horseNumber,

          horseName:
            horse.horseName,

          frame:
            horse.frame,

          score:
            horse.score,

          winPercent:
            horse.winPercent,

          secondPercent:
            horse.secondPercent,

          thirdPercent:
            horse.thirdPercent,

          inTheMoneyPercent:
            horse.inTheMoneyPercent,

          pastRuns:
            horse.pastRuns

        })
      )

  };

}


/* =========================================================
 * 単一レース予想
 *
 * /predict?date=...&venue=06&race=1
 * ======================================================= */

async function handlePredict(
  request,
  env
) {

  const url =
    new URL(
      request.url
    );


  const date =
    url.searchParams.get(
      "date"
    );


  const venueCode =
    url.searchParams.get(
      "venue"
    );


  const raceNumber =
    Number(
      url.searchParams.get(
        "race"
      )
    );


  if (
    !isValidDateString(
      date
    )
  ) {

    return errorResponse(
      "date=YYYY-MM-DD を指定してください。",
      400
    );

  }


  if (
    !venueCode
  ) {

    return errorResponse(
      "venueを指定してください。",
      400
    );

  }


  if (
    !Number.isFinite(
      raceNumber
    ) ||
    raceNumber < 1 ||
    raceNumber > 12
  ) {

    return errorResponse(
      "raceは1〜12で指定してください。",
      400
    );

  }


  try {

    const races =
      await discoverJRARacesForDate(
        date
      );


    const target =
      races.find(
        race =>
          race.venueCode ===
            venueCode &&
          race.raceNumber ===
            raceNumber
      );


    if (!target) {

      return errorResponse(
        "指定されたレースが見つかりません。",
        404
      );

    }


    const html =
      await fetchJRAHtml(
        target.url
      );


    const parsed =
      extractJRAResultInfo(
        html
      );


    const race =
      convertRaceForPrediction({

        date,

        venue:
          target.venue,

        venueCode,

        raceNumber,

        raceName:
          parsed.raceName,

        surface:
          parsed.surface,

        distance:
          parsed.distance,

        weather:
          parsed.weather,

        trackCondition:
          parsed.trackCondition,

        horses:
          parsed.horses

      });


    const historicalRows =
      await loadStoredHistory(
        env
      );


    const result =
      buildPredictionResult(
        race,
        historicalRows
      );


    return json({

      ok: true,

      source:
        "JRA",

      model: {

        oddsUsed:
          false,

        popularityUsed:
          false,

        historicalDataStart:
          HISTORICAL_DATA_START

      },

      prediction:
        result

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}


/* =========================================================
 * 指定日の全レース予想
 *
 * /predict-day?date=YYYY-MM-DD
 * ======================================================= */

async function handlePredictDay(
  request,
  env
) {

  const url =
    new URL(
      request.url
    );


  const date =
    url.searchParams.get(
      "date"
    );


  if (
    !isValidDateString(
      date
    )
  ) {

    return errorResponse(
      "date=YYYY-MM-DD を指定してください。",
      400
    );

  }


  try {

    const races =
      await discoverJRARacesForDate(
        date
      );


    const historicalRows =
      await loadStoredHistory(
        env
      );


    const predictions = [];


    for (
      const target of
        races
    ) {

      try {

        const html =
          await fetchJRAHtml(
            target.url
          );


        const parsed =
          extractJRAResultInfo(
            html
          );


        const race =
          convertRaceForPrediction({

            date,

            venue:
              target.venue,

            venueCode:
              target.venueCode,

            raceNumber:
              target.raceNumber,

            raceName:
              parsed.raceName,

            surface:
              parsed.surface,

            distance:
              parsed.distance,

            weather:
              parsed.weather,

            trackCondition:
              parsed.trackCondition,

            horses:
              parsed.horses

          });


        predictions.push(
          buildPredictionResult(
            race,
            historicalRows
          )
        );

      } catch (
        error
      ) {

        predictions.push({

          date,

          venue:
            target.venue,

          venueCode:
            target.venueCode,

          raceNumber:
            target.raceNumber,

          error:
            String(
              error.message ||
              error
            )

        });

      }

    }


    return json({

      ok: true,

      source:
        "JRA",

      date,

      raceCount:
        predictions.length,

      predictions

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}
/* =========================================================
 * 第9回 / 10
 * 結果API・デバッグAPI・ヘルスチェック
 * ======================================================= */


/* =========================================================
 * 指定日の結果取得
 *
 * /race-results?date=YYYY-MM-DD
 * ======================================================= */


function historyRowsToCSV(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return "";

  // Frontend-compatible names: the HTML recognizes race_id/raceId, horse/horse_name,
  // horse_no, and finish. The stored Worker rows use raceId, number, horse, and finish.
  const columns = [
    "date", "race_id", "venue", "venueCode", "raceNumber", "horse_no",
    "frame", "horse", "sex", "age", "jockey", "finish", "time",
    "popularity", "surface", "distance", "going", "trainer"
  ];

  const valueFor = (row, key) => {
    switch (key) {
      case "race_id": return row.raceId ?? row.race_id ?? "";
      case "venue": return row.place ?? row.venue ?? "";
      case "horse_no": return row.number ?? row.horse_no ?? row.horseNumber ?? "";
      case "horse": return row.horse ?? row.horseName ?? row.horse_name ?? "";
      case "finish": return row.finish ?? row.finishPosition ?? "";
      case "surface": return row.surface ?? row.race_type ?? "";
      case "going": return row.going ?? row.trackCondition ?? row.ground_state ?? "";
      default: return row[key] ?? "";
    }
  };

  const escapeCSV = value => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    columns.join(","),
    ...list.map(row => columns.map(key => escapeCSV(valueFor(row, key))).join(","))
  ].join("\r\n");
}


const HISTORY_CSV_DIRS = {
  "01": "01_sapporo", "02": "02_hakodate", "03": "03_fukushima",
  "04": "04_nigata", "05": "05_tokyo", "06": "06_nakayama",
  "07": "07_chukyo", "08": "08_kyoto", "09": "09_hanshin", "10": "10_kokura"
};

async function fetchHistoryCSVWithRetry(url, attempts = 3) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "keiba-ai-cloudflare", "Accept": "text/plain,application/vnd.github+json" },
        cf: { cacheTtl: 3600, cacheEverything: true }
      });
      lastStatus = response.status;
      if (response.ok) return { response, status: response.status };
      if (response.status === 404) return { response: null, status: 404 };
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    } catch (_) {
      lastStatus = 503;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return { response: null, status: lastStatus || 503 };
}

async function fetchExternalHistoryCSV(year, venueCode) {
  const dir = HISTORY_CSV_DIRS[venueCode];
  const csvUrl = `https://raw.githubusercontent.com/keibamar/keiba_ai_ver2.0/master/data/RaceResults/${dir}/${year}_race_results.csv`;
  const direct = await fetchHistoryCSVWithRetry(csvUrl);
  if (direct.response) {
    const csv = await direct.response.text();
    if (csv.trim().length > 20) return new Response(csv, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
    return errorResponse("GitHubの年次CSVが空でした。", 502);
  }

  // 京都は2021・2022年に開催がないため、空データを正常に返す。
  if (venueCode === "08" && (year === 2021 || year === 2022) && direct.status === 404) {
    return new Response("着順,枠番,馬番,馬名,性齢,斤量,騎手,タイム,着差,単勝,人気,馬体重,調教師,course_len,weather,race_type,ground_state,date,class,horse_id,jockey_id,通過,上り\n", { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" } });
  }

  // 年次CSVがない場合は、GitHub上のレース別CSVを少ない並列数で再構成する。
  if (direct.status === 404) {
    const apiUrl = `https://api.github.com/repos/keibamar/keiba_ai_ver2.0/contents/data/RaceResults/${dir}/${year}`;
    const listing = await fetchHistoryCSVWithRetry(apiUrl, 2);
    if (listing.response) {
      let files;
      try { files = (await listing.response.json()).filter(item => item.type === "file" && /\.csv$/i.test(item.name)); }
      catch (_) { files = []; }
      const chunks = [];
      for (let i = 0; i < files.length; i += 4) {
        const batch = files.slice(i, i + 4);
        const got = await Promise.all(batch.map(async item => {
          const result = await fetchHistoryCSVWithRetry(item.download_url, 2);
          if (!result.response) return "";
          try { return await result.response.text(); } catch (_) { return ""; }
        }));
        chunks.push(...got.filter(csv => csv.trim().length > 20));
      }
      if (chunks.length) {
        let header = ""; const rows = [];
        for (const csv of chunks) {
          const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
          if (!header && lines[0]) header = lines[0];
          rows.push(...lines.slice(1).filter(Boolean));
        }
        if (header && rows.length) return new Response(`${header}\n${rows.join("\n")}\n`, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
      }
    }
  }
  return errorResponse(`過去データを取得できませんでした（GitHub HTTP ${direct.status}）。時間をおいて再試行してください。`, direct.status === 404 ? 404 : 502);
}

async function handleRaceResults(
  request,
  env
) {
  const url = new URL(request.url);

  const date =
    url.searchParams.get("date");

  const yearParam =
    url.searchParams.get("year");

  const placeParam =
    url.searchParams.get("place");


  /*
   * ==================================================
   * date=YYYY-MM-DD
   *
   * 指定日のレースを取得
   * ==================================================
   */

  if (date) {

    if (!isValidDateString(date)) {

      return errorResponse(
        "date=YYYY-MM-DD を指定してください。",
        400
      );

    }

    try {

      const storedRaces =
        await getStoredRaces(
          env,
          date
        );

      if (
        storedRaces.length > 0
      ) {

        return json({
          ok: true,
          source: "JRA",
          date,
          sourceType: "stored",
          raceCount:
            storedRaces.length,
          races:
            storedRaces
        });

      }


      /*
       * 今回実際に成功した
       * 自動発見処理を使用
       */

      const races =
        await discoverJRARacesForDate(
          date
        );

      const results = [];


      for (
        const race of races
      ) {

        try {

          const result =
            await fetchOneJRARace(
              date,
              race.venueCode,
              race.venueName ||
                HISTORY_VENUES[
                  race.venueCode
                ] ||
                race.venueCode,
              race
            );

          if (result) {

            results.push(
              result
            );

          }

        } catch (error) {

          console.error(
            "レース取得失敗",
            {
              date,
              venueCode:
                race.venueCode,
              raceNo:
                race.raceNo,
              error:
                String(
                  error.message ||
                  error
                )
            }
          );

        }

      }


      return json({
        ok: true,
        source: "JRA",
        date,
        sourceType: "jra",
        raceCount:
          results.length,
        races:
          results
      });


    } catch (error) {

      return errorResponse(
        error.message ||
          String(error),
        500
      );

    }

  }


  /*
   * ==================================================
   * year=YYYY&place=XX
   *
   * 保存済み履歴をCSVとして返す
   * ==================================================
   */

  if (
    yearParam ||
    placeParam
  ) {

    const year =
      Number(yearParam);


    if (
      !Number.isInteger(year) ||
      year < 2019 ||
      year >
        new Date().getFullYear()
    ) {

      return errorResponse(
        "year は2019年以降の西暦4桁で指定してください。",
        400
      );

    }


    let venueCode =
      null;


    if (placeParam) {

      const normalizedPlace =
        String(
          placeParam
        ).trim();


      if (
        HISTORY_VENUES[
          normalizedPlace
        ]
      ) {

        venueCode =
          normalizedPlace;

      } else {

        const found =
          Object.entries(
            HISTORY_VENUES
          ).find(
            ([code, name]) =>
              name ===
              normalizedPlace
          );

        if (found) {

          venueCode =
            found[0];

        }

      }

    }


    if (!venueCode) {

      return errorResponse(
        "place は01〜10、または開催場名を指定してください。",
        400
      );

    }


    // 学習用の過去結果CSVはGitHubの年次データを返す。
    // KVに一部だけ保存された履歴を全年度データと誤認しない。
    return await fetchExternalHistoryCSV(year, venueCode);

  }


  return errorResponse(
    "date=YYYY-MM-DD または year=YYYY&place=01〜10 を指定してください。",
    400
  );
}


/* =========================================================
 * 指定レースのデバッグ
 *
 * /debug-race?date=...&venue=06&race=1
 * ======================================================= */

async function handleDebugRace(
  request
) {

  const url =
    new URL(
      request.url
    );


  const date =
    url.searchParams.get(
      "date"
    );


  const venueCode =
    url.searchParams.get(
      "venue"
    );


  const raceNumber =
    Number(
      url.searchParams.get(
        "race"
      )
    );


  if (
    !isValidDateString(
      date
    )
  ) {

    return errorResponse(
      "dateが正しくありません。",
      400
    );

  }


  if (
    !venueCode
  ) {

    return errorResponse(
      "venueがありません。",
      400
    );

  }


  if (
    !Number.isFinite(
      raceNumber
    )
  ) {

    return errorResponse(
      "raceが正しくありません。",
      400
    );

  }


  try {

    const races =
      await discoverJRAEntryRacesForDate(
        date
      );


    const target =
  races.find(
    race =>
      String(race.venueCode) ===
        String(venueCode) &&
      Number(race.raceNumber ?? race.raceNo) ===
        raceNumber
  );

    if (!target) {

      return errorResponse(
        "レースが見つかりません。",
        404
      );

    }


    const parsed =
      target.entryInfo ||
      { raceName: "", surface: "", distance: null, weather: "", trackCondition: "", horses: [] };


    return json({

      ok: true,

      source:
        "JRA",

      request: {

        date,

        venueCode,

        raceNumber

      },

      race: {

        venue:
          target.venue,

        raceName:
          parsed.raceName,

        surface:
          parsed.surface,

        distance:
          parsed.distance,

        weather:
          parsed.weather,

        trackCondition:
          parsed.trackCondition,

        horseCount:
          parsed.horses.length,

        horses:
          parsed.horses

      },

      debug: {

        url:
          target.url,

        htmlLength:
          target.htmlLength || null,

        cnameParsed:
          parseJRAEntryCname(target.cname)

      }

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}


/* =========================================================
 * JRA取得テスト
 * ======================================================= */

async function testJRAResult() {

  const date =
    "2019-01-05";


  const races =
    await discoverJRARacesForDate(
      date
    );


  const first =
    races[0];


  if (!first) {

    return {

      ok: false,

      source:
        "JRA",

      error:
        "レースを発見できませんでした。"

    };

  }


  const html =
    await fetchJRAHtml(
      first.url
    );


  const parsed =
    extractJRAResultInfo(
      html
    );


  return {

    ok: true,

    source:
      "JRA",

    test:
      "testJRAResult",

    date,

    venue:
      first.venue,

    venueCode:
      first.venueCode,

    raceNumber:
      first.raceNumber,

    raceName:
      parsed.raceName,

    surface:
      parsed.surface,

    distance:
      parsed.distance,

    horseCount:
      parsed.horses.length,

    htmlLength:
      html.length

  };

}


/* =========================================================
 * 2019-01-05保存テスト
 * ======================================================= */

async function testJRAStore(env) {

  const result =
    await importHistoryDay(
      env,
      "2019-01-20",
      "06"
    );

  const rows =
    await loadStoredHistory(env);

  return {
    ok: true,
    source: "JRA",
    test: "testJRAStore",
    import: result,
    stats:
      getHistoryStats(rows)
  };
}


async function testJRAAutoDiscover(
  env,
  date = "2019-01-20"
) {

  if (
    !isValidDateString(date)
  ) {

    return {
      ok: false,
      error:
        "dateが正しくありません。"
    };

  }

 /*
 * ==================================================
 * 1.
 * 2019-01-19の実在ページから同日のレースを発見
 * ==================================================
 */

  const seedUrls = [
  {
    venueCode: "06",
    venueName: "中山",
    url:
      "https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1006201901060620190119%2F1A"
  },
  {
    venueCode: "08",
    venueName: "京都",
    url:
      "https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1008201901060620190119%2FAE"
  },
  {
    venueCode: "07",
    venueName: "中京",
    url:
      "https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1007201901010620190119%2F25"
  }
];

const firstFound =
  new Map();
for (
  const seed of seedUrls
) {

  /*
   * seed URL自身を入口として登録
   */
  const seedRace =
    parseJRACname(
      seed.url
    );

  if (
    seedRace &&
    seedRace.date === date
  ) {

    seedRace.venueName =
      seed.venueName;

    const seedKey =
      makeRaceId(
        date,
        seedRace.venueCode,
        seedRace.raceNo
      );

    firstFound.set(
      seedKey,
      seedRace
    );

  }

  /*
   * seedページ内のレースリンクを探索
   */
  try {

    const html =
      await fetchJRAHtml(
        seed.url
      );

    if (
      !html ||
      html.length < 1000
    ) {
      continue;
    }

    const rawLinks =
      extractJRALinks(
        html,
        seed.url
      );

    const parsed =
      rawLinks
        .map(
          parseJRACname
        )
        .filter(
          Boolean
        );

    for (
      const race of parsed
    ) {

      if (
        race.date !== date
      ) {
        continue;
      }

      const key =
        makeRaceId(
          date,
          race.venueCode,
          race.raceNo
        );

      if (
        !firstFound.has(key)
      ) {

        firstFound.set(
          key,
          race
        );

      }

    }

  } catch (
    error
  ) {

    console.error(
      "first discovery error",
      {
        seed:
          seed.url,

        error:
          String(
            error.message ||
            error
          )
      }
    );

  }

}

  /*
   * ==================================================
   * 2.
   * 発見した1/6のページを開き、
   * 「pw01sde」だけでなく
   * 「sw01sde」も直接探す。
   *
   * JRAにはPC版と別形式の結果ページが存在するため、
   * ここではCNAME文字列を直接解析する。
   * ==================================================
   */

  const allFound =
    new Map();

  for (
    const race of
      firstFound.values()
  ) {

    try {

      const html =
        await fetchJRAHtml(
          race.url
        );

      if (
        !html ||
        html.length < 1000
      ) {
        continue;
      }

      /*
       * 自分自身
       */

      const selfKey =
        makeRaceId(
          date,
          race.venueCode,
          race.raceNo
        );

      allFound.set(
        selfKey,
        race
      );

      /*
       * ==================================================
       * HTML内のCNAMEを直接取得
       *
       * pw01sde / sw01sde の両方を見る
       * ==================================================
       */

      const cnamePattern =
        /(?:pw01sde|sw01sde)\d{4}\d{8}\d{2}\d{8}(?:\/[A-Za-z0-9]+)?/gi;

      const cnameSet =
        new Set();

      let match;

      while (
        (match =
          cnamePattern.exec(
            html
          )) !== null
      ) {

        cnameSet.add(
          match[0]
        );

      }

      /*
       * 発見したCNAMEを解析
       */

      for (
        const cname of
          cnameSet
      ) {

        const m =
          cname.match(
            /(?:pw01sde|sw01sde)(\d{4})(\d{8})(\d{2})(\d{8})(?:\/([^\/]+))?$/i
          );

        if (!m) {
          continue;
        }

        const venueCode =
          m[1].slice(-2);

        const actualDate =
          `${m[4].slice(0, 4)}-` +
          `${m[4].slice(4, 6)}-` +
          `${m[4].slice(6, 8)}`;

        if (
          actualDate !== date
        ) {
          continue;
        }

        const raceNo =
          Number(
            m[3]
          );

        if (
          !Number.isFinite(
            raceNo
          ) ||
          raceNo < 1 ||
          raceNo > 12
        ) {
          continue;
        }

        /*
         * PC版URLに統一する。
         *
         * sw01sdeで発見した場合でも、
         * 同じCNAMEをpw01sdeに置き換えて
         * 結果ページとして確認する。
         */

        const pwCname =
          cname.replace(
            /^sw01sde/i,
            "pw01sde"
          );

        const url =
          `${JRA_BASE}/JRADB/accessS.html` +
          `?CNAME=${pwCname}`;

        const key =
          makeRaceId(
            date,
            venueCode,
            raceNo
          );

        if (
          !allFound.has(key)
        ) {

          allFound.set(
            key,
            {

              type:
                "result",

              venueCode,

              meetingDate:
                m[2],

              raceNo,

              date:
                actualDate,

              url

            }

          );

        }

      }

    } catch (
      error
    ) {

      console.error(
        "same-day discovery error",
        {
          url:
            race.url,

          error:
            String(
              error.message ||
              error
            )
        }
      );

    }

  }

  /*
   * ==================================================
   * 3.
   * 整理
   * ==================================================
   */

  const races =
    Array.from(
      allFound.values()
    ).sort(
      (
        a,
        b
      ) => {

        if (
          String(
            a.venueCode
          ) !==
          String(
            b.venueCode
          )
        ) {

          return String(
            a.venueCode
          ).localeCompare(
            String(
              b.venueCode
            )
          );

        }

        return (
          Number(
            a.raceNo
          ) -
          Number(
            b.raceNo
          )
        );

      }
    );

  /*
   * ==================================================
   * 4.
   * 競馬場ごとのレース番号
   * ==================================================
   */

  const venueRaces =
    {};

  for (
    const race of
      races
  ) {

    if (
      !venueRaces[
        race.venueCode
      ]
    ) {

      venueRaces[
        race.venueCode
      ] = [];

    }

    venueRaces[
      race.venueCode
    ].push(
      race.raceNo
    );

  }

  return {

    ok: true,

    source:
      "JRA",

    date,

    method:
      "実在ページからpw01sde/sw01sdeのCNAMEを探索",

    firstDiscoveryCount:
      firstFound.size,

    finalFoundCount:
      races.length,

    venueRaces,

    venues:
      Object.keys(
        venueRaces
      ),

    races:
      races.map(
        x => ({

          venueCode:
            x.venueCode,

          venueName:
            HISTORY_VENUES[
              x.venueCode
            ] ||
            x.venueCode,

          meetingDate:
            x.meetingDate,

          raceNo:
            x.raceNo,

          date:
            x.date,

          url:
            x.url

        })
      )

  };

}

/* =========================================================
 * AIモデル情報
 * ======================================================= */

function getModelInfo() {

  return {

    version:
      WORKER_VERSION,

    historicalDataStart:
      HISTORICAL_DATA_START,

    inputPolicy: {

      odds:
        false,

      popularity:
        false,

      futureResults:
        false

    },

    probability: {

      normalizedWithinRace:
        true

    },

    ev: {

      enabled:
        false,

      note:
        "オッズを手入力した場合のみ別計算する設計"

    }

  };

}


/* =========================================================
 * ヘルスチェック
 * ======================================================= */

async function handleHealth(env) {

  return json({

    ok: true,

    service:
      "keiba-ai-cloudflare-worker",

    version:
      WORKER_VERSION,

    source:
      "JRA",

    jra:
      JRA_BASE,

    historicalDataStart:
      HISTORICAL_DATA_START,

    historyKVConfigured:
      !!getHistoryKV(env),

    model:
      getModelInfo(),

    routes: [

      "/health",

      "/next-race",

      "/race-cards",

      "/race-results",

      "/predict",

      "/predict-day",

      "/venues",

      "/history-status",

      "/import-history",

      "/debug-race",

      "/test-jra",

      "/test-jra-store",

      "/test-history-2019",

      "/test-jra-full-day"

    ]

  });

}
/* =========================================================
 * 第10回 / 10
 * 最終ルーター
 * ======================================================= */


/* =========================================================
 * 同梱Webアプリ（Netlifyの再デプロイ停止を回避）
 * ======================================================= */
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+Cjx0aXRsZT7nqbTppqzlpb3otbDjg4Tjg7zjg6s8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOX0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMH19CmJvZHl7bWFyZ2luOjA7YmFja2dyb3VuZDp2YXIoLS1iZyk7Y29sb3I6dmFyKC0tdHgpO2ZvbnQtZmFtaWx5Oi1hcHBsZS1zeXN0ZW0sQmxpbmtNYWNTeXN0ZW1Gb250LCJTZWdvZSBVSSIsc2Fucy1zZXJpZn0KaGVhZGVye2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxNHB4IDE2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxOXB4fQptYWlue21heC13aWR0aDo5MDBweDttYXJnaW46YXV0bztwYWRkaW5nOjEwcHh9CnNlY3Rpb257YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxNHB4O21hcmdpbjoxMHB4IDA7Ym94LXNoYWRvdzowIDFweCA0cHggIzAwMDF9Cmgye2ZvbnQtc2l6ZToxNnB4O21hcmdpbjowIDAgOHB4fQpidXR0b257Ym9yZGVyOjA7Ym9yZGVyLXJhZGl1czo5cHg7cGFkZGluZzoxMXB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1wcik7Y29sb3I6I2ZmZjtmb250LXdlaWdodDo3MDA7bWFyZ2luOjRweCA0cHggNHB4IDA7Zm9udC1zaXplOjE0cHh9CmJ1dHRvbjpkaXNhYmxlZHtvcGFjaXR5Oi40fWJ1dHRvbi5zdWJ7YmFja2dyb3VuZDojNjY3MDg1fQppbnB1dCxzZWxlY3QsdGV4dGFyZWF7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCU7Ym94LXNpemluZzpib3JkZXItYm94fQp0ZXh0YXJlYXt3aWR0aDoxMDAlO21pbi1oZWlnaHQ6MTIwcHg7Zm9udC1mYW1pbHk6aW5oZXJpdH0KLnNtYWxse2ZvbnQtc2l6ZToxM3B4O2NvbG9yOnZhcigtLXN1Yil9LnN0YXR1c3twYWRkaW5nOjlweDtiYWNrZ3JvdW5kOnZhcigtLWJnKTtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjhweDt3aGl0ZS1zcGFjZTpwcmUtd3JhcH0KLmdvb2R7Y29sb3I6IzEzNzMzMztmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6I2MyNmEwMDtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodH0KdGg6bnRoLWNoaWxkKC1uKzIpLHRkOm50aC1jaGlsZCgtbisyKXt0ZXh0LWFsaWduOmxlZnR9Ci5jYW5ke2JvcmRlcjoxcHggc29saWQgdmFyKC0tbG4pO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjlweDttYXJnaW46OHB4IDB9Ci5jaGlwe2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtc2l6ZToxMnB4O2JvcmRlci1yYWRpdXM6OTk5cHg7cGFkZGluZzoycHggOHB4O21hcmdpbjozcHggNHB4IDAgMDtiYWNrZ3JvdW5kOiNlZWYxZjU7Y29sb3I6IzM0NDA1NH0KLmNoaXAuYntiYWNrZ3JvdW5kOiNlMGYyZTY7Y29sb3I6IzEzNzMzM30uY2hpcC5ve2JhY2tncm91bmQ6I2ZmZWZjZjtjb2xvcjojOWE1YTAwfS5jaGlwLmd7YmFja2dyb3VuZDojZTZlOWVlO2NvbG9yOiM1ZDY4NzV9Ci5ydHtkaXNwbGF5OmlubGluZS1ibG9jaztmb250LXdlaWdodDo4MDA7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzowIDdweDtjb2xvcjojZmZmO2JhY2tncm91bmQ6Izk4YTJiM30KLnJ0LnJTe2JhY2tncm91bmQ6I2Q5MmQyMH0ucnQuckF7YmFja2dyb3VuZDojZjc5MDA5fS5ydC5yQntiYWNrZ3JvdW5kOiMxNjY3ZDl9Ci5yb3d7ZGlzcGxheTpmbGV4O2dhcDo4cHg7ZmxleC13cmFwOndyYXA7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbjo2cHggMH0KI2J1c3l7ZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDojMDAwODt6LWluZGV4OjIwO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyfQojYnVzeT5kaXZ7YmFja2dyb3VuZDp2YXIoLS1oZCk7Y29sb3I6I2ZmZjtwYWRkaW5nOjE4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O21heC13aWR0aDo4MCU7dGV4dC1hbGlnbjpjZW50ZXI7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Cjwvc3R5bGU+PC9oZWFkPjxib2R5Pgo8aGVhZGVyPueptOmmrOWlvei1sOODhOODvOODqyA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxM3B4Ij7ljZjkvZPniYggdjE8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgo8c2VjdGlvbj4KPGgyPuKYhSDmnKzml6Xjga7lpb3otbDnqbTppqw8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+44Oc44K/44OzMeOBpOOBp+OAjOWHuummrOihqOOBruWPluW+lyDihpIg44Kq44OD44K677yI5Y+W44KM44KM44Gw77yJ4oaSIOWFqOODrOODvOOCueOBrueptOmmrOWAmeijnOOAjeOCkuihqOekuuOBl+OBvuOBmeOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJzbWFsbCI+4pqgIOmBjuWOu+OBruaknOiovO+8iDIwMjPlubTjgJzjgIHmiZXmiLvjgaTjgY3vvInvvJrnqbTppqwx5L2N5YCZ6KOc44GuPGI+6KSH5Yud5Zue5Y+O546H44Gv57SENzLjgJw3NyU8L2I+77yIMTAwJeacqua6gO+8ieOBp+OBl+OBn+OAguW9k+OBn+OCiuOChOOBmeOBleOBruebruWuieOBqOOBl+OBpuOBiuS9v+OBhOOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0idGRhdGUiIHR5cGU9ImRhdGUiPjxidXR0b24gaWQ9InRvZGF5R28iPuWlvei1sOeptOmmrOOCkuihqOekujwvYnV0dG9uPjxidXR0b24gaWQ9InRvZGF5VXBkIiBjbGFzcz0ic3ViIj7mnIDmlrDjga7miJDnuL7jgavmm7TmlrA8L2J1dHRvbj48L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJhdXRvT2RkcyIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOOCquODg+OCuuOCkuiHquWLleOBp+abtOaWsOOBmeOCizwvbGFiZWw+IDxzZWxlY3QgaWQ9ImF1dG9NaW4iPjxvcHRpb24gdmFsdWU9IjMiPjPliIY8L29wdGlvbj48b3B0aW9uIHZhbHVlPSI1IiBzZWxlY3RlZD415YiGPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMTAiPjEw5YiGPC9vcHRpb24+PC9zZWxlY3Q+IOOBlOOBqCA8c3BhbiBpZD0iYXV0b0luZm8iPjwvc3Bhbj48L2Rpdj4KPGRpdiBpZD0idG9kYXlTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuaXpeS7mOOCkumBuOOCk+OBp+OAjOWlvei1sOeptOmmrOOCkuihqOekuuOAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAguaIkOe4vuOBjOWPpOOBhOOBqOOBjeOBr+WFiOOBq+OAjOacgOaWsOOBruaIkOe4vuOBq+abtOaWsOOAjeOCkuaKvOOBl+OBvuOBmeOAgjwvZGl2Pgo8ZGl2IGlkPSJ0b2RheU91dCI+PC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGgIOODh+ODvOOCv+WPluW+l++8iOOBk+OBruOCouODl+ODquOBoOOBkeOBp+WujOe1kO+8iTwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj5KUkHlhazlvI/jgYvjgonjgIHpgY7ljrvjga7miJDnuL7vvIjkurrmsJfjgaTjgY3vvInjgajopIfli53jg7vljZjli53jga7miZXmiLvjgpLlj5blvpfjgZfjgabjgIHjgZPjga7nq6/mnKvjgavkv53lrZjjgZfjgb7jgZnjgILlhYPjga7jgqLjg5fjg6rjgoTjg5Djg4Pjgq/jgqLjg4Pjg5fjga/kuI3opoHjgafjgZnjgILmraLjgoHjgabjgoLntprjgY3jgYvjgonlho3plovjgafjgY3jgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj7mjqXntprlhYggPGlucHV0IGlkPSJ3dXJsIiBzdHlsZT0iZmxleDoxO21pbi13aWR0aDoyMjBweCIgdmFsdWU9Imh0dHBzOi8va2VpYmEtYWktcGF5b3V0cy5odDE5OTUwODIyLndvcmtlcnMuZGV2Ij48L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij7mnJ/plpMgPGlucHV0IGlkPSJzc3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIzLTAxLTAxIj4g44CcIDxpbnB1dCBpZD0ic2VuZCIgdHlwZT0iZGF0ZSI+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY0dvIj7pgY7ljrvmiJDnuL7jgajmiZXmiLvjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJzeW5jU3RvcCIgY2xhc3M9InN1YiIgZGlzYWJsZWQ+5YGc5q2iPC9idXR0b24+PC9kaXY+CjxkaXYgaWQ9InN5bmNTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2Pgo8ZGl2IGlkPSJkYXRhU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7norroqo3kuK3igKY8L2Rpdj4KPGRldGFpbHM+PHN1bW1hcnkgY2xhc3M9InNtYWxsIj7jg5Djg4Pjgq/jgqLjg4Pjg5dKU09O77yPQ1NW44GL44KJ6Kqt44G/6L6844KA77yI5Lu75oSP77yJPC9zdW1tYXJ5Pgo8ZGl2IGNsYXNzPSJzbWFsbCI+5YWD44Ki44OX44Oq44Gu44OQ44OD44Kv44Ki44OD44OX44GM44GC44KM44Gw44CB5Y+W5b6X44KS55yB55Wl44Gn44GN44G+44GZ77yI5ZCM44GY5pel44Gv6YeN6KSH44GX44Gm5Y+W44KK6L6844G/44G+44Gb44KT77yJ44CCPC9kaXY+CjxpbnB1dCBpZD0iZmlsZSIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiwuY3N2LGFwcGxpY2F0aW9uL2pzb24sdGV4dC9jc3YiPgo8L2RldGFpbHM+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGgLTIg6KSH5Yud5Zue5Y+O546H44Gu5qSc6Ki8PC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruaIkOe4vuOBqOaJleaIu+OBp+OAgeaZguezu+WIl++8iOOBneOBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBoOOBke+8ieOBruODkOODg+OCr+ODhuOCueODiOOCkuOBl+OBvuOBmeOAgueptOOCvuODvOODs+OBr+Wun+mam+OBruS6uuawl+OBp+WIpOWumuOBl+OAgeWQhOODrOODvOOCuTEwMOWGhuOBmuOBpOizvOWFpeOBqOS7ruWumuOBl+OBvuOBmeOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPumWi+Wni+aXpSA8aW5wdXQgaWQ9ImJ0U3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIzLTAxLTAxIj48YnV0dG9uIGlkPSJidFJ1biI+5qSc6Ki844KS5a6f6KGMPC9idXR0b24+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0icGF5RXhwIiBjbGFzcz0ic3ViIj7miZXmiLvjgpLmm7jjgY3lh7rjgZc8L2J1dHRvbj48bGFiZWwgY2xhc3M9InNtYWxsIj7oqq3jgb/ovrzjgb8gPGlucHV0IGlkPSJwYXlJbXAiIHR5cGU9ImZpbGUiIGFjY2VwdD0iLmpzb24iPjwvbGFiZWw+PC9kaXY+CjxkaXYgaWQ9ImJ0T3V0IiBjbGFzcz0ic3RhdHVzIj7jg4fjg7zjgr/lj5blvpfjga7jgYLjgajjgaflrp/ooYzjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaEg44Os44O844K544KS6YG444G2PC9oMj4KPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJ0YWJXb3JrZXIiIGNsYXNzPSJzdWIiPuWHuummrOihqOOCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9InRhYk1hbnVhbCIgY2xhc3M9InN1YiI+5omL5YWl5YqbPC9idXR0b24+PGJ1dHRvbiBpZD0idGFiUGFzdCIgY2xhc3M9InN1YiI+6YGO5Y6744Os44O844K544Gn6Kmm44GZPC9idXR0b24+PC9kaXY+CjxkaXYgaWQ9InBhbmVXb3JrZXIiIHN0eWxlPSJkaXNwbGF5Om5vbmUiPgogPGRpdiBjbGFzcz0ic21hbGwiPuaXouWtmOOBrldvcmtlcuOBriAvcmFjZS1jYXJkcyDjgpLoqq3jgb/lj5bjgovjgaDjgZHjgafjgZnvvIjlpInmm7TjgZfjgb7jgZvjgpPvvInjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJ3ZGF0ZSIgdHlwZT0iZGF0ZSI+PC9kaXY+CiA8YnV0dG9uIGlkPSJ3Z2V0Ij7plovlgqzjg7vjg6zjg7zjgrnjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJvZGRzR2V0IiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJ3YWxsIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7lhajjg6zjg7zjgrnkuIDmi6zop6PmnpA8L2J1dHRvbj48ZGl2IGlkPSJ3c3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlj5blvpc8L2Rpdj48ZGl2IGlkPSJ3bGlzdCI+PC9kaXY+PGRpdiBpZD0iYWxsb3V0Ij48L2Rpdj4KPC9kaXY+CjxkaXYgaWQ9InBhbmVNYW51YWwiIHN0eWxlPSJkaXNwbGF5Om5vbmUiPgogPGRpdiBjbGFzcz0ic21hbGwiPjHooYzjgavjgIzppqznlaog6aas5ZCN44CN44CC5Lu75oSP44Gn5pyA5b6M44Gr5Y2Y5Yud44Kq44OD44K644CC5L6L77yaPGJyPjEg4peL4peL4peL4peLIDMuNDxicj4yIOKWs+KWs+KWs+KWszwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9Im1kYXRlIiB0eXBlPSJkYXRlIj48c2VsZWN0IGlkPSJtc3VyZiI+PG9wdGlvbiB2YWx1ZT0iMSI+6IqdPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMiI+44OA44O844OIPC9vcHRpb24+PC9zZWxlY3Q+PGlucHV0IGlkPSJtZGlzdCIgdHlwZT0ibnVtYmVyIiBzdGVwPSIxMDAiIHZhbHVlPSIxNjAwIiBzdHlsZT0id2lkdGg6OTBweCI+bTwvZGl2PgogPHRleHRhcmVhIGlkPSJtdGV4dCIgcGxhY2Vob2xkZXI9IjEg6aas5ZCNJiMxMDsyIOmmrOWQjSI+PC90ZXh0YXJlYT4KIDxidXR0b24gaWQ9Im1nbyI+44GT44Gu44Os44O844K544KS5L2/44GGPC9idXR0b24+CjwvZGl2Pgo8ZGl2IGlkPSJwYW5lUGFzdCIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5L+d5a2Y5riI44G/44Gu6YGO5Y6744Os44O844K544KS44CB44Gd44Gu5pel44KI44KK5YmN44Gu44OH44O844K/44Gg44GR44Gn5LqI5oOz44GX44G+44GZ44CC5a6f6Zqb44Gu552A6aCG44KS5Lim44G544Gm56K66KqN44Gn44GN44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0icGRhdGUiIHR5cGU9ImRhdGUiPjxidXR0b24gaWQ9InBnZXQiPuOBneOBruaXpeOBruODrOODvOOCueS4gOimpzwvYnV0dG9uPjwvZGl2PgogPGRpdiBpZD0icHN0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pel5LuY44KS6YG444KT44Gn44GP44Gg44GV44GE44CCPC9kaXY+PGRpdiBpZD0icGxpc3QiPjwvZGl2Pgo8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaIg56m06aas5aW96LWw44KS6Kej5p6QPC9oMj4KPGRpdiBpZD0icmFjZWxhYmVsIiBjbGFzcz0ic21hbGwiPuODrOODvOOCueOCkumBuOaKnuOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8YnV0dG9uIGlkPSJydW4iIGRpc2FibGVkPuino+aekOOBmeOCizwvYnV0dG9uPgo8ZGl2IGlkPSJvdXQiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoyDjgZPjga7jg4Tjg7zjg6vjgavjgaTjgYTjgaY8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+CjxiPuWlvei1sOeOhzwvYj7vvJ0z552A5YaF44Gr5YWl44KL56K6546H44Gu5o6o5a6a44CC6YGO5Y6744Gu5a6f57i+44OH44O844K/44GL44KJ6YeN44G/44KS5a2m57+S44GX44Gf44Oi44OH44Or44Gn6KiI566X44GX44G+44GZ77yI6YCa566X44GuM+edgOWGheeOh+ODu+OCr+ODqeOCueijnOato+OBl+OBn+aIkOe4vuODu+ebtOi/kTPotbDjg7vmnIDntYLnnYDpoIbjg7vlkIzmnaHku7bjga7lrp/nuL7jg7vplpPpmpTjg7vlubTpvaLjg7vmmIfntJrpmY3ntJrjg7vliJ3jga7oip3jg4Dmm7/jgo/jgorvvInjgII8YnI+CjxiPuOCr+ODqeOCuTwvYj7vvJrmnKrli53liKnvvI8x5Yud77yPMuWLne+8jzPli53vvI/jgqrjg7zjg5fjg7PjgpLljLrliKXjgZfjgIHkvY7jgYTjgq/jg6njgrnjgafjga7lpb3otbDjga/libLjgorlvJXjgY3jgIHpq5jjgYTjgq/jg6njgrnjgafjga7lh6HotbDjga/libLjgorlvJXjgY3jgb7jgZnjgILlnLDmlrnjga7jg4fjg7zjgr/jgYzlkKvjgb7jgozjgovloLTlkIjjga/jgIHjgZXjgonjgavlibLjgorlvJXjgY3jgb7jgZnvvIhKUkHjga7lhazlvI/jgrXjgqTjg4jjgavjga/lnLDmlrnjga7miJDnuL7jgYzjgarjgYTjgZ/jgoHjgIHkuK3lpK7jga7jgb/jga7lsaXmrbTjgafjgZnvvInjgII8YnI+CjxiPjLjgaTjga7jg6Ljg7zjg4k8L2I+77yaPGJyPgrjg7vjgqrjg4PjgrrmnKrlhaXlipvvvJrnqbTjgr7jg7zjg7PjgpLjgIzjg4Tjg7zjg6vmjqjlrprjga7kurrmsJfvvIjpqI7miYvmiJDnuL7ovrzjgb/vvInjgI3jgafliKTlrprjgILlrp/pmpvjga7kurrmsJfjgajjga7nm7jplqLjga8wLjc444Gn44GZ44CCPGJyPgrjg7vjgqrjg4PjgrrlhaXlipvvvIjjgb7jgZ/jga/pgY7ljrvjg6zjg7zjgrnjga7kurrmsJfpoIbkvY3vvInvvJrnqbTjgr7jg7zjg7PjgpLlrp/pmpvjga7kurrmsJfjgafliKTlrprjgZfjgb7jgZnjgILmnKzmnaXjga7kvb/jgYTmlrnjgafjgZnjgILluILloLTjgajjga7lt67jgoLlh7rjgZfjgb7jgZnjgYzjgIHmpJzoqLzjgafjga/lvZPjgZ/jgorjgavntZDjgbPku5jjgYvjgarjgYvjgaPjgZ/jgZ/jgoHlj4LogIPnqIvluqbjgavjgZfjgabjgY/jgaDjgZXjgYTjgII8YnI+CjxiPuihqOekuuOBruiqreOBv+aWuTwvYj7vvJrlpb3otbDnjofjga/jgIHjgZ3jga7ppqzjga7jgIznqbTjgr7jg7zjg7PlhoXjgafjga7lrp/nuL7jg5njg7zjgrnjga7norrnjofjgI3jgafjgZnjgILlsaXmrbTjga7jgarjgYTppqzjgoLjgIHpoK3mlbDjgYzlpJrjgZHjgozjgbDntIQy5Ymy44Gr44Gq44KK44G+44GZ77yIMTXpoK3nq4vjgabjgacz6aCt44GMM+edgOWGheOBq+WFpeOCi+OBn+OCge+8ieOAguipleS+oeODqeODs+OCr+OBr+OAgeeptOOCvuODvOODs+OBruW5s+Wdh+OBruS9leWAjeOBi+OBp+axuuOCgeOBpuOBhOOBvuOBmeOAgjxicj4KPGI+5qSc6Ki877yIMjAyNOW5tOS7pemZjeODu+Wtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iTwvYj7vvJo8YnI+CuODu+ODouODh+ODq+eyvuW6pu+8iOWvvuaVsOaQjeWkse+8ie+8muaXp+ODouODh+ODqzAuNDcxIOKGkiDmlrDjg6Ljg4fjg6swLjQ1MO+8iOWwj+OBleOBhOOBu+OBqeiJr+OBhO+8ieOAgjxicj4K44O744Kq44OD44K65YWl5Yqb5pmC77ya56m044K+44O844Oz5YWo5L2T44GuM+edgOWGheeOhyA5LjEl44Gr5a++44GX44CB5pen44Oi44OH44Or44GuMeS9jeWAmeijnDEzLjIlIOKGkiDmlrDjg6Ljg4fjg6sxNi41Je+8iOS4iuS9jTLpoK0xNS40Je+8ieOAgjxicj4K44O744Kq44OD44K65pyq5YWl5Yqb5pmC77ya56m044K+44O844Oz5YWo5L2TIDExLjUl44Gr5a++44GX44CB5pen44Oi44OH44OrMTguNSUg4oaSIOaWsOODouODh+ODqzIxLjMl77yI5LiK5L2NMumgrTE5Ljcl77yJ44CCPGJyPgrjg7vjg6njg7Pjgq/jgajlrp/nuL7vvJpT77yeQe+8nkLvvJ5D44Gu6aCG44GrM+edgOWGheeOh+OBjOS4i+OBjOOCiuOBvuOBme+8iOOCquODg+OCuuacquWFpeWKm+aZgu+8mjMzJe+8jzI0Je+8jzIwJe+8jzEzJe+8ieOAgjxicj4K44O7PGI+6KSH5Yud44Gu5Zue5Y+O546H44GMMTAwJeOCkui2heOBiOOCi+OBqOOBr+OAgeOBvuOBoOeiuuiqjeOBp+OBjeOBpuOBhOOBvuOBm+OCk+OAgjwvYj7lgJnoo5zjga/lvZPjgZ/jgovnorrnjofjgYzpq5jjgYTliIbjgIHphY3lvZPjgYzkvY7jgoHjgafjgZnjgILikaAtMuOBp+W/heOBmueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgjxicj4KPGI+5YCZ6KOc44Gu5p2h5Lu2PC9iPu+8muWun+e4vuOBruOBguOCi+mmrO+8iDPotbDku6XkuIrvvInjgaDjgZHjgpLlgJnoo5zjgavjgZfjgb7jgZnjgILlsaXmrbTjga7kuY/jgZfjgYTppqzjga/lpb3otbDnjofjgYzlkIzngrnjgavjgarjgorjgoTjgZnjgY/jgIHpoIbkvY3jgavmhI/lkbPjgYzjgarjgYTjgZ/jgoHjgafjgZnjgILmlrDppqzmiKbjgarjganjga/lr77osaHlpJbjgavjgarjgorjgb7jgZnjgII8YnI+CuOCquODg+OCuuODu+S6uuawl+OBr+S6iOa4rOOBruWFpeWKm+OBq+OBr+S9v+OBo+OBpuOBhOOBvuOBm+OCk++8iOS6uuawl+OBruS7o+eQhuODouODh+ODq+OBruWtpue/kuODqeODmeODq+OBqOOAgeeptOOCvuODvOODs+OBruWIpOWumuOAgeWmmeWRs+OBruavlOi8g+OBq+OBruOBv+S9v+eUqO+8ieOAguikh+WLneWbnuWPjueOh+OBr+OAgeaJleaIu+OCkuWPluW+l+OBl+OBn+OBguOBqOOBq+KRoC0y44Gn5qSc6Ki844Gn44GN44G+44GZ44CCCjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRpCDpiYTmnb/ou7jppqzvvIjopIfli53lnI/lhoUg57SEOTUl77yJPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBp+OAgTPnnYDku6XlhoXjgavlhaXjgovnorrnjofjgYzmpbXjgoHjgabpq5jjgYTppqzjgpLlh7rjgZfjgb7jgZnjgILpgY7ljrvjga7lrp/nuL7vvIgyMDI05bm05Lul6ZmN77yJ44Gn44CB44CM6YmE5p2/44CN44GvOTYl77yIOTUl5bmFIDk044CcOTkl77yJ44CB44CM5rqW6YmE5p2/44CN44GvODkl44CB44CM5aCF6Lu444CN44GvODQl44Gn44GX44Gf44CC6KSH5Yud44Gu6YWN5b2T44Gv5L2O44GE77yIMTAw44CcMTIw5YaG5YmN5b6M77yJ44Gu44Gn44CBPGI+44Ov44Kk44OJ44O76aas6YCj44O7M+mAo+ikh+OBquOBqeOBrui7uDwvYj7jgajjgZfjgabkvb/jgYbmg7PlrprjgafjgZnjgILjgqrjg4PjgrrjgYzjgarjgYTliY3ml6Xjga/jgIHliKTlrprjgafjgY3jgb7jgZvjgpPjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9ImFkYXRlIiB0eXBlPSJkYXRlIj48YnV0dG9uIGlkPSJheGlzR28iPumJhOadv+i7uOOBqOazouS5seW6puOCkuihqOekujwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGlkPSJheGlzU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7ml6Xku5jjgpLpgbjjgpPjgafmirzjgZfjgabjgY/jgaDjgZXjgYTvvIjlh7rppqzooajjgajjgqrjg4PjgrrjgpLlj5blvpfjgZfjgabjgIHikaTikaXjgpLlkIzmmYLjgavooajnpLrjgZfjgb7jgZnvvInjgII8L2Rpdj4KPGRpdiBpZD0iYXhpc091dCI+PC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGlIOWFqOODrOODvOOCueOBruazouS5seW6pu+8iFNTU+OAnEPvvIk8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+44CMM+edgOWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK77yd5Lq65rCX6JaE44GM57Wh44KA44CN44Os44O844K544Gr44Gq44KL56K6546H44Gn44CB562J57Sa44KS5LuY44GR44G+44GZ44CC6YGO5Y6744Gu5a6f57i+77yIMjAyNOW5tOS7pemZje+8ie+8mlNTUyA1N+OAnDY4JeOAgVNTIDUx44CcNjAl44CBUyA0M+OAnDQ2JeOAgUEgMzUl44CBQiAyNOOAnDI1JeOAgUMgOOOAnDkl77yI5YWo44Os44O844K55bmz5Z2H44GvMjguNSXvvInjgILjgqrjg4PjgrrjgYzjgYLjgozjgbDnsr7luqbjgYzkuIrjgYzjgorjgb7jgZnjgII8Yj7ojZLjgozjgoTjgZnjgZXjga7nm67lronjgafjgIHnqbTppqzjgYzlvZPjgZ/jgovjgYvjganjgYbjgYvjgajjga/liKXjgafjgZnjgII8L2I+PC9kaXY+CjxkaXYgaWQ9InVwc2V0T3V0IiBjbGFzcz0ic3RhdHVzIj7ikaTjga7jgIzpiYTmnb/ou7jjgajms6LkubHluqbjgpLooajnpLrjgI3jgpLmirzjgZnjgajjgIHjgZPjgZPjgavlhajjg6zjg7zjgrnjga7kuIDopqfjgYzlh7rjgb7jgZnjgII8L2Rpdj4KPC9zZWN0aW9uPgo8L21haW4+CjxkaXYgaWQ9ImJ1c3kiPjxkaXYgaWQ9ImJ1c3lUZXh0Ij7lh6bnkIbkuK3igKY8L2Rpdj48L2Rpdj4KPHNjcmlwdD4KInVzZSBzdHJpY3QiOwovKiDnqbTppqzlpb3otbDjgqjjg7Pjgrjjg7PvvIjljZjkvZPniYjjg7vjg5bjg6njgqbjgrYvTm9kZeWFseeUqO+8ieOAguOCquODg+OCuuODu+S6uuawl+OBr+OCueOCs+OCouOBq+S9v+eUqOOBl+OBquOBhOOAgiAqLwpjb25zdCBVRT0oKCk9PnsKIC8qIOWun+ODh+ODvOOCv+aknOiovOOBp+mAhuWKueaenOOBoOOBo+OBn+aIkOWIhu+8iOmojuaJi+ODu+mWk+malO+8ieOBr+aXouWumuOBp09GRiAqLwogY29uc3QgREVGQVVMVD17am9ja2V5OmZhbHNlLGxheW9mZjpmYWxzZX07CiBjb25zdCBjbGFtcD0oeCxhLGIpPT5NYXRoLm1heChhLE1hdGgubWluKGIseCkpOwogY29uc3Qgc2lnbW9pZD14PT4xLygxK01hdGguZXhwKC14KSk7CiBjb25zdCBsb2dpdD1wPT57cD1jbGFtcChwLC4wMDEsLjk5OSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKIGNvbnN0IG5uPXM9PlN0cmluZyhzPz8iIikubm9ybWFsaXplKCJORktDIikudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXHNcdTMwMDBdKy9nLCIiKS5yZXBsYWNlKC9b44O7772lLu+8jlwt4oCQ4oCR4oCS4oCT4oCU4oCVJ+KAmWBdL2csIiIpLnJlcGxhY2UoL1vimIbimIXilrPilrLil4fil4ZdL2csIiIpOwogLyog6aiO5omL5ZCN77ya5YWI6aCt44Gu5qyn5a2X44Kk44OL44K344Oj44Or44KS6Zmk44GN44CB44OH44Og44O844Ot4oaS44OH44OgIOOBq+aPg+OBiOOCi++8iEpSQeOBriBDLuODh+ODoOODvOODrSDjgajpgY7ljrvjg4fjg7zjgr/jga4g77yj77yO44OH44OgIOOCkuS4gOiHtOOBleOBm+OCi++8iSAqLwogY29uc3Qgam5uPXM9PntsZXQgdj1ubihTdHJpbmcocz8/IiIpLnJlcGxhY2UoL1xkezJ9KD86XC5cZCk/XHMqKD86a2d8772L772HKS9naSwiICIpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw4fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKOagl+adsXznvo7mtaYpL2csIiAiKSk7dj12LnJlcGxhY2UoL15bYS16XSg/PVvjgqEt44O244O8XSkvLCIiKTt2PXYucmVwbGFjZSgvXuODh+ODoOODvOODrS8sIuODh+ODoCIpO3JldHVybiB2fTsKIC8qIOOCr+ODqeOCueOBruautemaju+8mjA95LiN5piOIC8gLTE95Zyw5pa5IC8gMT3mlrDppqzjg7vmnKrli53liKkgLyAyPTHli50gLyAzPTLli50gLyA0PTPli50gLyA1PeOCquODvOODl+ODs+ODu+mHjeizniAqLwogY29uc3QgbGV2ZWxPZkxhYmVsPXQ9Pntjb25zdCBzPVN0cmluZyh0fHwiIik7aWYoL+WcsOaWuXxOQVIvLnRlc3QocykpcmV0dXJuIC0xO2lmKC/mlrDppqx85pyq5Yud5YipLy50ZXN0KHMpKXJldHVybiAxO2lmKC8x5YudfDUwMOS4hy8udGVzdChzKSlyZXR1cm4gMjtpZigvMuWLnXwxMDAw5LiHLy50ZXN0KHMpKXJldHVybiAzO2lmKC8z5YudfDE2MDDkuIcvLnRlc3QocykpcmV0dXJuIDQ7aWYoL+OCquODvOODl+ODs3zvvK/vvLB8T1B844Oq44K544OG44OD44OJfOmHjeiznnzvvKd8R1sxMjNJXS9pLnRlc3QocykpcmV0dXJuIDU7cmV0dXJuIDB9OwogY29uc3QgbGV2ZWxPZlByaXplPXA9PntwPU51bWJlcihwKTtyZXR1cm4gIShwPjApPzA6cDw9NzAwPzE6cDw9OTAwPzI6cDw9MTMwMD8zOnA8PTE4MDA/NDo1fTsKIGNvbnN0IGlzSnJhVmVudWU9Yz0+L14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKGN8fCIiKSk7CiBjb25zdCBzdXJmQ29kZT1zPT57cz1TdHJpbmcoc3x8IiIpO3JldHVybiAv6IqdfHR1cmYvaS50ZXN0KHMpPzE6L+ODgHxkaXJ0L2kudGVzdChzKT8yOi/pmpx8anVtcC9pLnRlc3Qocyk/MzowfTsKIGNvbnN0IGRudW09ZD0+TnVtYmVyKFN0cmluZyhkfHwiIikucmVwbGFjZSgvXEQvZywiIikuc2xpY2UoMCw4KSl8fDA7CiBmdW5jdGlvbiBwYXJzZURhdGUocyl7CiAgcz1TdHJpbmcoc3x8IiIpO2xldCBtPXMubWF0Y2goLyhcZHs0fSlcRHswLDR9KFxkezEsMn0pXER7MCw0fShcZHsxLDJ9KS8pOwogIGlmKCFtKXJldHVybiIiO3JldHVybiBgJHttWzFdfS0ke21bMl0ucGFkU3RhcnQoMiwiMCIpfS0ke21bM10ucGFkU3RhcnQoMiwiMCIpfWA7CiB9CiBmdW5jdGlvbiBjc3ZSb3dzKHRleHQpewogIGNvbnN0IGxpbmVzPVN0cmluZyh0ZXh0fHwiIikucmVwbGFjZSgvXlx1RkVGRi8sIiIpLnNwbGl0KC9ccj9cbi8pLmZpbHRlcih4PT54LnRyaW0oKSk7CiAgaWYoIWxpbmVzLmxlbmd0aClyZXR1cm5bXTsKICBjb25zdCBzcGxpdD1sPT57Y29uc3QgYT1bXTtsZXQgYz0iIixxPWZhbHNlO2ZvcihsZXQgaT0wO2k8bC5sZW5ndGg7aSsrKXtjb25zdCBjaD1sW2ldOwogICBpZihjaD09PSciJyl7aWYocSYmbFtpKzFdPT09JyInKXtjKz0nIic7aSsrfWVsc2UgcT0hcX1lbHNlIGlmKGNoPT09IiwiJiYhcSl7YS5wdXNoKGMpO2M9IiJ9ZWxzZSBjKz1jaH1hLnB1c2goYyk7cmV0dXJuIGF9OwogIGNvbnN0IGhlYWQ9c3BsaXQobGluZXNbMF0pLm1hcCh4PT54LnRyaW0oKSk7Y29uc3Qgb3V0PVtdOwogIGZvcihsZXQgaT0xO2k8bGluZXMubGVuZ3RoO2krKyl7Y29uc3QgYT1zcGxpdChsaW5lc1tpXSksbz17fTtmb3IobGV0IGo9MDtqPGhlYWQubGVuZ3RoO2orKylvW2hlYWRbal1dPWFbal0/PyIiO291dC5wdXNoKG8pfQogIHJldHVybiBvdXQ7CiB9CiBjb25zdCBmPXY9Pntjb25zdCBuPXBhcnNlRmxvYXQoU3RyaW5nKHY/PyIiKS5yZXBsYWNlKC8sL2csIiIpKTtyZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pP246bnVsbH07CiAvKiDjg5Djg4Pjgq/jgqLjg4Pjg5cvQ1NW44GuMeihjOKGkui7vemHj+ihjCAqLwogZnVuY3Rpb24gdG9Sb3cobyl7CiAgY29uc3Qgc2E9U3RyaW5nKG9bIuaAp+m9oiJdfHwiIik7Y29uc3QgYW09c2EubWF0Y2goLyhcZCspLyk7CiAgcmV0dXJue3JhY2VJZDpTdHJpbmcob1siIl0/P28ucmFjZV9pZD8/b1siVW5uYW1lZDogMCJdPz8iIiksZGF0ZTpwYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSksCiAgIG5hbWU6U3RyaW5nKG9bIummrOWQjSJdfHxvLmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOm5uKG9bIummrOWQjSJdfHxvLmhvcnNlKSxqb2NrZXk6am5uKG9bIumojuaJiyJdfHxvLmpvY2tleSksam5hbWU6U3RyaW5nKG9bIumojuaJiyJdfHxvLmpvY2tleXx8IiIpLnRyaW0oKSxmaW5pc2g6ZihvWyLnnYDpoIYiXT8/by5maW5pc2gpLAogICBkaXN0OmYoby5jb3Vyc2VfbGVuPz9vWyLot53pm6IiXT8/by5kaXN0YW5jZSl8fDAsc3VyZjpzdXJmQ29kZShvLnJhY2VfdHlwZXx8b1si6Iqd44OAIl18fG8uc3VyZmFjZSksCiAgIGFnZTphbT9OdW1iZXIoYW1bMV0pOm51bGwsbnVtOmYob1si6aas55WqIl0pLHBvcDpmKG9bIuS6uuawlyJdKSxvZGRzOmYob1si5Y2Y5YudIl0pLAogICBsdmw6KCgpPT57Y29uc3QgaWQ9U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/PyIiKTtpZigvXlxkezEyfSQvLnRlc3QoaWQpJiYhaXNKcmFWZW51ZShpZC5zbGljZSg0LDYpKSlyZXR1cm4gLTE7cmV0dXJuIGxldmVsT2ZMYWJlbChvWyJjbGFzcyJdfHxvLmNscyl9KSgpfTsKIH0KIC8qIOaIkOe4vuOCueODiOOCou+8iOaXpeS7mOaYh+mghuOBqyBhZGQg44GZ44KL77yJICovCiBmdW5jdGlvbiBTdG9yZSgpe3RoaXMuaD1uZXcgTWFwKCk7dGhpcy5qPW5ldyBNYXAoKX0KIFN0b3JlLnByb3RvdHlwZS5hZGQ9ZnVuY3Rpb24ocil7CiAgaWYoci5maW5pc2g9PW51bGx8fCFyLmhvcnNlKXJldHVybjsKICBjb25zdCB0Mz1yLmZpbmlzaD49MSYmci5maW5pc2g8PTM/MTowOwogIGxldCBoPXRoaXMuaC5nZXQoci5ob3JzZSk7aWYoIWgpdGhpcy5oLnNldChyLmhvcnNlLGg9e246MCx0b3AzOjAsd2luOjAsc3VtOjAsbGFzdDoiIixydW5zOltdLGx2Ont9fSk7CiAgaC5uKys7aC50b3AzKz10MztpZihyLmZpbmlzaD09PTEpaC53aW4rKztoLnN1bSs9ci5maW5pc2g7aWYoci5kYXRlPmgubGFzdCloLmxhc3Q9ci5kYXRlOwogIGNvbnN0IEw9ci5sdmx8fDA7KGgubHZbTF09aC5sdltMXXx8WzAsMF0pO2gubHZbTF1bMF0rKztoLmx2W0xdWzFdKz10MzsKICBoLnJ1bnMucHVzaChbZG51bShyLmRhdGUpLHIuZmluaXNoLHIuZGlzdCxyLnN1cmYsTF0pO2lmKGgucnVucy5sZW5ndGg+Nil7aC5ydW5zLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7aC5ydW5zLnNoaWZ0KCl9CiAgaWYoci5qb2NrZXkpe2xldCBqPXRoaXMuai5nZXQoci5qb2NrZXkpO2lmKCFqKXRoaXMuai5zZXQoci5qb2NrZXksaj17bjowLHRvcDM6MH0pO2oubisrO2oudG9wMys9dDN9CiB9OwogLyog6aiO5omL77ya5a6M5YWo5LiA6Ie04oaS77yI55+t44GE6KGo6KiY44Gq44KJ77yJ5YmN5pa55LiA6Ie044GnMeS6uuOBq+e1nuOCjOOCi+OBqOOBjeOBoOOBkeaOoeeUqCAqLwogU3RvcmUucHJvdG90eXBlLmpvY2tleT1mdW5jdGlvbihuYW1lKXsKICBpZighbmFtZSlyZXR1cm4gbnVsbDsKICBjb25zdCBqPXRoaXMuai5nZXQobmFtZSk7aWYoailyZXR1cm4gajsKICBpZihuYW1lLmxlbmd0aDwyfHxuYW1lLmxlbmd0aD40KXJldHVybiBudWxsOwogIGlmKCF0aGlzLl9qa3x8dGhpcy5famtTaXplIT09dGhpcy5qLnNpemUpe3RoaXMuX2prPVsuLi50aGlzLmoua2V5cygpXTt0aGlzLl9qa1NpemU9dGhpcy5qLnNpemV9CiAgY29uc3QgYz10aGlzLl9qay5maWx0ZXIoaz0+ay5zdGFydHNXaXRoKG5hbWUpfHwobmFtZS5sZW5ndGg+PTMmJmsuc3RhcnRzV2l0aChuYW1lLnNsaWNlKDAsLTEpKSYmbmFtZS5sZW5ndGg8PWsubGVuZ3RoKSk7CiAgcmV0dXJuIGMubGVuZ3RoPT09MT90aGlzLmouZ2V0KGNbMF0pOm51bGw7CiB9OwogY29uc3QgbGF5b2ZmPShsYXN0LHRhcmdldCk9PntpZighbGFzdClyZXR1cm4gLjU7Y29uc3QgYT0obmV3IERhdGUodGFyZ2V0KS1uZXcgRGF0ZShsYXN0KSkvODY0ZTU7CiAgcmV0dXJuIGE8MjE/LjcyOmE8NjA/LjYyOmE8MTIwPy41NTphPDI0MD8uNDg6LjQyfTsKIC8qID09PT09IOWun+e4vuOBi+OCieWtpue/kuOBl+OBn+ODouODh+ODq++8iOeJueW+tOmHj+KGkjPnnYDlhoXnjofvvIkgPT09PT0gKi8KIGNvbnN0IEZOPVsiYmlhcyIsIm9mZnNldCIsIm5sb2ciLCJub0hpc3QiLCJmUyIsImZDIiwiYXZnRiIsInIzc2hhcmUiLCJyM2F2ZyIsImxhc3QxIiwibGFzdEJpZyIsImNvbmREaWZmIiwiZmlyc3RTdXJmIiwiZ2FwU2hvcnQiLCJnYXBMb25nIiwiZ2FwVkxvbmciLCJhZ2UzIiwiYWdlNCIsImFnZTciLCJzdGVwVXAiLCJzdGVwRG93biIsIndpblJhdGUiXTsKIGNvbnN0IEZKPVsialJlbCIsImpsb2ciLCJqTWlzcyJdOwogLyog5L+C5pWw44GvIHRvb2xzL2ZpdF9tb2RlbC5qcyDjgaflrabnv5LvvIgyMDIw5bm044Cc44Gu5pmC57O75YiX44OH44O844K/77yJ44CCe30g44KS572u5o+bICovCiBjb25zdCBNT0RFTD17ImNvcmUiOlswLjA1Mjk5LDAuOTk2OTcsMC4wNDk1MSwtMC4yNDU0MywtMC41MjgxMiwwLjkxOTQ2LC0wLjUxNDc2LC0wLjM0Nzg2LC0wLjU3OTA0LC0wLjU1MTE4LDAuMTY3NzMsMS4xMTgyLC0wLjM1MzA1LC0wLjExMTI4LC0wLjIyNzI4LC0wLjQwMTI5LDAuMTM3NzEsMC4yMTY2MiwtMC4zOTY3MywtMC4zNTMwNSwwLjAwNjE3LC0wLjU5NTY0XSwiZnVsbCI6WzAuNDA0MzMsMS4zNzAwNywwLjA2MjUxLC0wLjEyMjc5LC0wLjUwMjMyLDAuODI5NzgsLTAuMzk4OTUsLTAuMzAwNzIsLTAuNTE1NTksLTAuNTI1MzIsMC4xNTgzMiwxLjA2Njk1LC0wLjM4Mzc3LC0wLjA3MjgyLC0wLjIyNTY4LC0wLjM1MSwwLjE1MDI1LDAuMjEyNTMsLTAuNDEzMzQsLTAuMzIzMTksMC4wMDcyNiwtMC45Mzc5MiwwLjUzNTU3LDAuMDAzNjUsLTAuMjA2MDVdfTsKIGZ1bmN0aW9uIGZlYXRzKHIsc3RvcmUscmFjZSxOLHdpdGhKKXsKICBjb25zdCBiPWNsYW1wKDMvTiwuMDgsLjUpLGxiPWxvZ2l0KGIpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksbj1oP2gubjowLEx0PXJhY2UubHZsfHwwOwogIGNvbnN0IHBTPSgoaD9oLnRvcDM6MCkrMypiKS8obiszKSxmUz1sb2dpdChwUyktbGI7CiAgLy8g44Kv44Op44K56KOc5q2j77ya5L2O44GE44Kv44Op44K577yI5Zyw5pa544KS5ZCr44KA77yJ44Gn44Gu5aW96LWw44Gv5Ymy44KK5byV44GN44CB6auY44GE44Kv44Op44K544Gn44Gu5Yeh6LWw44Gv5Ymy44KK5byV44GPCiAgbGV0IGZDPWZTOwogIGlmKGgmJkx0PjApe2xldCBIPTAsTT0wOwogICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhoLmx2KSl7Y29uc3QgTD1OdW1iZXIoayksW2NuLGN0XT1oLmx2W2tdO2NvbnN0IGc9TD09PTA/MDooTDwwPy0yOkwtTHQpOwogICAgSCs9Y3QqY2xhbXAoMSsuMypnLC40LDEuOCk7TSs9KGNuLWN0KSpjbGFtcCgxLS4zKmcsLjQsMS44KX0KICAgZkM9bG9naXQoKEgrMypiKS8oSCtNKzMpKS1sYn0KICBjb25zdCBydW5zPWg/aC5ydW5zOltdLHJjPXJ1bnMuc2xpY2UoLTMpLGxhc3RSPXJ1bnMubGVuZ3RoP3J1bnNbcnVucy5sZW5ndGgtMV06bnVsbDsKICBjb25zdCByM3NoYXJlPXJjLmxlbmd0aD9yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoL3JjLmxlbmd0aDowOwogIGNvbnN0IHIzYXZnPXJjLmxlbmd0aD9jbGFtcCgocmMucmVkdWNlKChhLHgpPT5hK3hbMV0sMCkvcmMubGVuZ3RoLTYpLzYsLTEsMik6MDsKICBjb25zdCBsYXN0MT1sYXN0Uj9jbGFtcCgobGFzdFJbMV0tNikvNiwtMSwyKTowLGxhc3RCaWc9bGFzdFImJmxhc3RSWzFdPj0xMD8xOjA7CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwO2xldCBjb25kRGlmZj0wLGZpcnN0U3VyZj0wOwogIGlmKHNjJiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmKCFkaXN0fHxNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApKTsKICAgaWYoY3IubGVuZ3RoKWNvbmREaWZmPShjci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoKzIqcFMpLyhjci5sZW5ndGgrMiktcFM7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKWZpcnN0U3VyZj0xfQogIGxldCBnYXA9bnVsbDtpZihoJiZoLmxhc3QmJnJhY2UuZGF0ZSlnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgY29uc3QgYT1yLmFnZXx8MDsKICBjb25zdCBzdGVwRD1sYXN0UiYmbGFzdFJbNF0+MCYmTHQ+MD9jbGFtcChMdC1sYXN0Uls0XSwtMywzKTowOwogIGNvbnN0IHg9WzEsbGIsTWF0aC5sb2coMStuKSxuPT09MD8xOjAsZlMsZkMsbj9jbGFtcCgoaC5zdW0vbi02KS82LC0xLDIpOjAscjNzaGFyZSxyM2F2ZyxsYXN0MSxsYXN0QmlnLGNvbmREaWZmLGZpcnN0U3VyZiwKICAgZ2FwIT1udWxsJiZnYXA8MjE/MTowLGdhcCE9bnVsbCYmZ2FwPjEyMD8xOjAsZ2FwIT1udWxsJiZnYXA+MjQwPzE6MCxhPT09Mz8xOjAsYT09PTQ/MTowLGE+PTc/MTowLHN0ZXBEPjA/c3RlcEQ6MCxzdGVwRDwwPy1zdGVwRDowLAogICBuPygoaC53aW4rLjMqYikvKG4rMS41KS1iKTowXTsKICBpZih3aXRoSil7Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpOwogICBpZihqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSk7eC5wdXNoKGxvZ2l0KHBKKS1sYixNYXRoLmxvZygxK2oubiksMCl9ZWxzZSB4LnB1c2goMCwwLDEpfQogIHJldHVybiB4OwogfQogY29uc3QgZG90PSh3LHgpPT57bGV0IHo9MDtmb3IobGV0IGk9MDtpPHgubGVuZ3RoO2krKyl6Kz0od1tpXXx8MCkqeFtpXTtyZXR1cm4gen07CiBjb25zdCBtb2RlbFo9KGtpbmQseCk9PmRvdChNT0RFTFtraW5kXSx4KTsKIC8qIDHpoK3jga7ntKDngrkobG9naXQp44Go44K/44Kw44CCY29tcCDjgafmiJDliIbjgpJPTi9PRkbjgafjgY3jgovvvIjmpJzoqLznlKjvvIkgKi8KIGZ1bmN0aW9uIGhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcD17fSl7CiAgY29tcD1PYmplY3QuYXNzaWduKHt9LERFRkFVTFQsY29tcCk7Y29uc3QgdXNlPWs9PmNvbXBba10hPT1mYWxzZSYmY29tcFtrXSE9PTA7CiAgY29uc3QgYj1jbGFtcCgzL04sLjEsLjUpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksaj1zdG9yZS5qLmdldChyLmpvY2tleSk7CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxuPWg/aC5uOjAsdGFncz1bXTtsZXQgej0wLGNvbmY9IuS9jiI7CiAgY29uc3QgcEg9KChoP2gudG9wMzowKSs0KmIpLyhuKzQpO3orPWxvZ2l0KHBIKTsKICBpZihuPj0yKWNvbmY9bj49NT8i6auYIjoi5LitIjtlbHNlIHRhZ3MucHVzaCh7dDoi5bGl5q205LiN6LazIixjOiJnIn0pOwogIGlmKG4+PTMpe2NvbnN0IHQzPWgudG9wMy9uLHc9aC53aW4vbjsKICAgaWYodDM+PS40MCYmdzw9LjIwKXRhZ3MucHVzaCh7dDpg5ZaE5oim5Z6LIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGVsc2UgaWYodDM+PS40NSl0YWdzLnB1c2goe3Q6YOWuieWumiAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBpZih1c2UoImF2ZyIpJiZoLnN1bS9uPD01KXorPS4xMn0KICBjb25zdCByYz1ydW5zLnNsaWNlKC0zKTsKICBpZih1c2UoInJlY2VudCIpJiZyYy5sZW5ndGg+PTIpe2NvbnN0IGMzPXJjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgsYXZnPXJjLnJlZHVjZSgocyx4KT0+cyt4WzFdLDApL3JjLmxlbmd0aDsKICAgeis9LjIyKihjMy9yYy5sZW5ndGgtcEgpKjM7aWYoYzM+PTIpdGFncy5wdXNoKHt0OmDov5Eke3JjLmxlbmd0aH3otbDjgacke2MzfeWbnjPnnYDlhoVgLGM6ImIifSk7CiAgIGNvbnN0IGxhc3Q9cnVuc1tydW5zLmxlbmd0aC0xXTsKICAgaWYobGFzdCYmbGFzdFsxXT49OCYmbj49NCYmaC50b3AzL24+PS4zNSl7eis9LjE1O3RhZ3MucHVzaCh7dDpg5YmN6LWwJHtsYXN0WzFdfeedgOOBi+OCieW3u+OBjei/lOOBl+S9meWcsGAsYzoibyJ9KX0KICAgaWYoYXZnPD00JiZyYy5sZW5ndGg+PTMpeis9LjA4fQogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDsKICBpZih1c2UoImNvbmQiKSYmc2MmJmRpc3QmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiZNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSl7ei09LjM1O3RhZ3MucHVzaCh7dDpgJHtzYz09PTE/IuWIneOBruiKnSI6IuWIneOBruODgOODvOODiCJ977yI6YGO5Y676LWw44Gv5Yil6aas5aC077yJYCxjOiJvIn0pfQogICBpZihjci5sZW5ndGg+PTIpe2NvbnN0IHQzPWNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgscGM9KHQzKzIqcEgpLyhjci5sZW5ndGgrMik7CiAgICB6Kz1jbGFtcCgyKihwYy1wSCksLS41LC41KTtpZih0Mz49Mil0YWdzLnB1c2goe3Q6YOWQjOadoeS7tuOBpyR7dDN9LyR7Y3IubGVuZ3RofeWbnjPnnYDlhoVgLGM6ImIifSl9fQogIGlmKHVzZSgiam9ja2V5IikmJmomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KSxkaj1jbGFtcCguNioobG9naXQocEopLWxvZ2l0KGIpKSwtLjQsLjUpOwogICB6Kz1kajtpZihkaj49LjI1KXRhZ3MucHVzaCh7dDpg6aiO5omL5aW96Kq/IDPnnYDlhoUke01hdGgucm91bmQoai50b3AzL2oubioxMDApfSVgLGM6ImIifSl9CiAgaWYodXNlKCJsYXlvZmYiKSYmaCYmaC5sYXN0KXtjb25zdCBnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgIHorPS42KihsYXlvZmYoaC5sYXN0LHJhY2UuZGF0ZSktLjUpO2lmKGdhcD49MTgwKXRhZ3MucHVzaCh7dDpgJHtnYXB95pel44G244KKYCxjOiJvIn0pfQogIGlmKHVzZSgiYWdlIikpe2NvbnN0IGE9ci5hZ2V8fDU7aWYoYT09PTMpeis9LjEwO2Vsc2UgaWYoYT09PTQpeis9LjA1O2Vsc2UgaWYoYT49OCl7ei09LjE1O3RhZ3MucHVzaCh7dDpgJHthfeats2AsYzoibyJ9KX19CiAgcmV0dXJue3osdGFncyxjb25mLG59OwogfQogLyogMjAyM+W5tOS7pemZjeOBruaZguezu+WIl+aknOiovOOBp+OBriDntKDjga7lpb3otbDnjofihpLnqbTjgr7jg7zjg7Plrp/nuL7vvIjlubPlnYdwLCDlrp/nuL7vvIkgKi8KIGNvbnN0IENBTD1bWzAsMC4wMV0sWzAuMDIyLDAuMDE3XSxbMC4wNDYsMC4wMjJdLFswLjA3NSwwLjA0Nl0sWzAuMTA1LDAuMDY4XSxbMC4xMzUsMC4wODJdLFswLjE2NSwwLjA5OF0sWzAuMTkzLDAuMTAzXSxbMC4yMjQsMC4xMzhdLFswLjI1OSwwLjE2MV0sWzAuMzAyLDAuMTg3XSxbMC4zNTgsMC4yMTFdLFswLjQ1NCwwLjIyOV1dOwogLyog44Kq44OD44K644Gq44GX44Oi44O844OJ77yI5Lq65rCX44Gu5Luj55CG77yd6aiO5omL6L6844G/44Gu5a2m57+S44Oi44OH44Or44Gu6aCG5L2N44Gn56m044K+44O844Oz44KS5Yik5a6a77yJ44Gu6KOc5q2j6KGo44CCMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+S9nOaIkCAqLwogY29uc3QgQ0FMX1BST1hZPVtbMCwwLjAxM10sWzAuMDIyLDAuMDIxXSxbMC4wNDYsMC4wMjhdLFswLjA3NSwwLjA1Nl0sWzAuMTA1LDAuMDg2XSxbMC4xMzUsMC4xMTFdLFswLjE2NSwwLjEzNF0sWzAuMTkzLDAuMTQ2XSxbMC4yMjQsMC4yMDFdLFswLjI1OSwwLjIxOV0sWzAuMzAxLDAuMjYxXSxbMC4zNTUsMC4yOTZdLFswLjQzOSwwLjM2N11dOwogZnVuY3Rpb24gaW50ZXJwKFQscCl7Zm9yKGxldCBpPTE7aTxULmxlbmd0aDtpKyspaWYocDw9VFtpXVswXSl7Y29uc3RbYSxiXT1UW2ktMV0sW2MsZF09VFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gVFtULmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIGNhbGliRm9yKHAsbW9kZSl7cmV0dXJuIG1vZGU9PT0ib2RkcyI/aW50ZXJwKENBTCxwKTppbnRlcnAoQ0FMX1BST1hZLHApfQogZnVuY3Rpb24gY2FsaWIocCl7Zm9yKGxldCBpPTE7aTxDQUwubGVuZ3RoO2krKylpZihwPD1DQUxbaV1bMF0pe2NvbnN0W2EsYl09Q0FMW2ktMV0sW2MsZF09Q0FMW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBDQUxbQ0FMLmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIG5vcm1hbGl6ZVRvcDMoenMsdG90YWwpe2xldCBsbz0tOCxoaT04OwogIGZvcihsZXQgaT0wO2k8NjA7aSsrKXtjb25zdCBjPShsbytoaSkvMixzPXpzLnJlZHVjZSgoYSx6KT0+YStzaWdtb2lkKHorYyksMCk7aWYocz50b3RhbCloaT1jO2Vsc2UgbG89Y30KICBjb25zdCBjPShsbytoaSkvMjtyZXR1cm4genMubWFwKHo9PnNpZ21vaWQoeitjKSl9CiAvKiBIYXJ2aWxsZeazleOBp+WLneeOh+KGkjPnnYDlhoXnjocgKi8KIGZ1bmN0aW9uIHRvcDNGcm9tV2luKHB3KXtjb25zdCBUPXB3LnJlZHVjZSgoYSxiKT0+YStiLDApLHA9cHcubWFwKHg9PngvVCksbj1wLmxlbmd0aCxvdXQ9bmV3IEFycmF5KG4pLmZpbGwoMCk7CiAgZm9yKGxldCBpPTA7aTxuO2krKyl7bGV0IHM9cFtpXTsKICAgZm9yKGxldCBqPTA7ajxuO2orKylpZihqIT09aSl7cys9cFtqXSpwW2ldLygxLXBbal0pOwogICAgZm9yKGxldCBrPTA7azxuO2srKylpZihrIT09aSYmayE9PWopcys9cFtqXSpwW2tdLygxLXBbal0pKnBbaV0vKDEtcFtqXS1wW2tdKX0KICAgb3V0W2ldPXN9cmV0dXJuIG91dH0KIC8qIOODrOODvOOCueino+aekOOAgm9kZHMg44Gv5Lu75oSP77yI5YWo6aCt5YiG77yJ44CCICovCiBjb25zdCBMVk49WyLkuI3mmI4iLCLmnKrli53liKkiLCIx5YudIiwiMuWLnSIsIjPli50iLCJPUCJdOwogZnVuY3Rpb24gZXh0cmFUYWdzKHRhZ3MscixzdG9yZSxyYWNlKXsKICBjb25zdCB0PXRhZ3Muc2xpY2UoKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLEx0PXJhY2UubHZsfHwwOwogIGlmKGgpe2NvbnN0IGxhc3Q9aC5ydW5zLmxlbmd0aD9oLnJ1bnNbaC5ydW5zLmxlbmd0aC0xXTpudWxsOwogICBpZihsYXN0JiZsYXN0WzRdPjAmJkx0PjAmJmxhc3RbNF0hPT1MdCl0LnVuc2hpZnQobGFzdFs0XTxMdD97dDpg5piH57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoibyJ9Ont0OmDpmY3ntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJiIn0pOwogICBpZihoLmx2JiZoLmx2Wy0xXSl0LnB1c2goe3Q6IuWcsOaWueOBp+OBruWHuui1sOOBguOCiu+8iOWJsuW8leipleS+oe+8iSIsYzoiZyJ9KX0KICByZXR1cm4gdH0KIC8qIOeptOmmrOWAmeijnO+8muWun+e4vuOBruOBguOCi+mmrO+8iDPotbDku6XkuIrvvInjgaDjgZHjgpLjgIHlpb3otbDnjofjga7pq5jjgYTpoIbjgasgayDpoK3jgILlsaXmrbTjga7kuY/jgZfjgYTppqzjga/lkIzngrnjgavjgarjgorjgoTjgZnjgY/jgIHpoIbkvY3jgavmhI/lkbPjgYzjgarjgYTjgZ/jgoHlr77osaHlpJYgKi8KIGZ1bmN0aW9uIHBpY2socmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLGspfQogZnVuY3Rpb24gYW5hbHl6ZShyYWNlLHN0b3JlLG9kZHMsY29tcCxwb3BBcnIpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGg7CiAgY29uc3Qgc2M9Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wKSk7CiAgY29uc3QgemM9TU9ERUwuY29yZT9SLm1hcChyPT5tb2RlbFooImNvcmUiLGZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSkpOnNjLm1hcCh4PT54LnopOwogIGNvbnN0IHA9bm9ybWFsaXplVG9wMyh6YyxNYXRoLm1pbigzLE4pKTsKICBsZXQgbWt0PW51bGwscG9wPW51bGwsbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXtta3Q9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7cG9wPW9kZHMubWFwKG89PjErb2Rkcy5maWx0ZXIoeD0+eDxvKS5sZW5ndGgpO21vZGU9Im9kZHMifQogIGVsc2UgaWYocG9wQXJyJiZwb3BBcnIubGVuZ3RoPT09TiYmcG9wQXJyLmV2ZXJ5KHg9Png+MCkpe3BvcD1wb3BBcnIuc2xpY2UoKTttb2RlPSJvZGRzIn0gLy8g5a6f6Zqb44Gu5Lq65rCX6aCG5L2N44Gg44GR5YiG44GL44KL44Go44GN77yI57WQ5p6c44Oa44O844K455Sx5p2l77yJCiAgZWxzZXsgLy8g44Kq44OD44K644KC5Lq65rCX44KC44Gq44GE44Go44GN77ya6aiO5omL5oiQ57i+44G+44Gn5ZCr44KB44Gf44K544Kz44Ki44Gu6aCG5L2N44KS44CM5Lq65rCX44Gu5Luj55CG44CN44Gr44GZ44KL77yI5a6f6Zqb44Gu5Lq65rCX44Go44Gu55u46ZaiIDAuNTXihpIwLjY377yJCiAgIGNvbnN0IHB4PU1PREVMLmZ1bGw/Ui5tYXAocj0+bW9kZWxaKCJmdWxsIixmZWF0cyhyLHN0b3JlLHJhY2UsTix0cnVlKSkpOlIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4se2pvY2tleTp0cnVlLGxheW9mZjpmYWxzZX0pLnopO3BvcD1weC5tYXAodj0+MStweC5maWx0ZXIoeT0+eT52KS5sZW5ndGgpfQogIGNvbnN0IHJhbms9cC5tYXAodj0+MStwLmZpbHRlcih4PT54PnYpLmxlbmd0aCk7CiAgY29uc3QgY3V0PU1hdGgubWF4KDUsTWF0aC5jZWlsKE4qLjQpKTsKICByZXR1cm4gUi5tYXAoKHIsaSk9Pih7aSxubzpyLm51bXx8aSsxLG5hbWU6ci5uYW1lfHxyLmhvcnNlLHA6cFtpXSxwYzpjYWxpYkZvcihwW2ldLG1vZGUpLG1vZGUsCiAgIGpuOihzdG9yZS5qb2NrZXkoci5qb2NrZXkpfHx7bjowfSkubixyYW5rOnJhbmtbaV0scG9wOnBvcFtpXSxiYXNlOk1hdGgubWluKC41LDMvTiksCiAgIGNhcmVlcjooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP3tuOmgubix0MzpoLnRvcDMsd2luOmgud2lufTpudWxsfSkoKSwKICAgcmVjZW50OigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5ydW5zLm1hcCh4PT54WzFdKTpbXX0pKCksCiAgIGpuYW1lOnIuam5hbWV8fCIiLGpzdGF0OigoKT0+e2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTtyZXR1cm4gaiYmai5uPj0xP3tuOmoubixyYXRlOmoudG9wMy9qLm59Om51bGx9KSgpLAogICBob2xlOk4+PTYmJnBvcFtpXT49Y3V0LG1rdDpta3Q/bWt0W2ldOm51bGwsdmFsdWU6bWt0P2NhbGliRm9yKHBbaV0sIm9kZHMiKS9ta3RbaV06bnVsbCwKICAgdGFnczpleHRyYVRhZ3Moc2NbaV0udGFncyxyLHN0b3JlLHJhY2UpLGNvbmY6c2NbaV0uY29uZixuOnNjW2ldLm4sY3V0fSkpOwogfQoKIC8qID09PT09IOmJhOadv+i7uOmmrOODu+azouS5seW6pu+8iOeptOmmrOS6iOaDs+OBqOOBr+WIpeOBruioiOeul+OAguS/guaVsOOBryB0b29scy9heGlzX3Vwc2V0X3N0dWR5LmpzIOOBp+Wtpue/kuOAgTIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafmpJzoqLzvvIkgPT09PT0gKi8KIGNvbnN0IEFYSVM9eyJ3UCI6WzAuMDUxOTMsMS4wMTQ4MywwLjA1MTQ4LC0wLjIwNjc2LC0wLjUzMjE2LDAuOTE0MzcsLTAuNDg0NjQsLTAuMzIxMTUsLTAuNTY4MDIsLTAuNTUxMzUsMC4xNzM0NSwxLjA5NzQsLTAuMjg0MDcsLTAuMTAzOTcsLTAuMjE2MTcsLTAuMzQ2NjgsMC4xNTkxMywwLjIyMTk2LC0wLjM4NzMyLC0wLjM0NjU4LDAuMDAzNywtMC41NjY0Nl0sIndPIjpbMC41NDI1OSwwLjE1NjYxLDAuMDU0MTQsLTAuMDQzNzEsLTAuMTQ1MjQsMC4xMzE3MSwtMC4xNDE3OCwtMC4xNjI2MywwLjA1MzE2LC0wLjAyMDk3LDAuMDAzOSwtMC4yOTg2NSwtMC4zMjMyMSwtMC4wMTM2NSwtMC4wOTUxOSwtMC4wNzgxOCwwLjAwMDYsLTAuMDIyOTEsLTAuMTEyMTMsMC4wMTc4MSwtMC4wNDc0NSwtMC4xMDg1MiwwLjI1NzIxLDAuNjMwNzFdLCJ1cHNldCI6eyJ0aHIiOjE1LCJtb2RlbHMiOnsicHJveHkiOlsyLjI0NTU5LDAuNjM4NDEsLTAuMDcwOCwtMC4wODE2MSwtMC4wNzc0MywwLjA5MTM3LDAuMTM4NDcsMC4wMDI3OSwtMC4zODkxOSwtMC42NDIxNywtMC41NTM4MSwtMC4wMTgzNywtMC40NDMxNywtMC43NjgyNSwtMC41MjM5MywtMi43MzU2MSwtMC4xNDkwOSwwLjExNDc3XSwib2RkcyI6Wy0wLjcyMzk2LDAuNDI4MDgsLTAuMDc0OTksLTAuMDYxNTQsLTAuMDA2NzUsMC4wNzI0MywwLjA3MDg1LC0wLjA0OTc0LC0wLjE1NTI4LC0wLjMyNTE2LC0wLjQxODI2LC0wLjMxMzUxLDAuMjA3NTcsLTAuMjM5LC0wLjI3OTAxLC0xLjgyMTA4LC0wLjAwODUyLDAuMDgzOTksMC4xNTAyNCwwLjM1MjQyLC0yLjAzODM5LDIuODU2NjgsMC4yMjkyOSwwLjcyMDg0LC0xLjk3Nzk3XX0sImdyYWRlcyI6eyJwcm94eSI6eyJjdXRzIjpbWyJTU1MiLDAuNTUwMzddLFsiU1MiLDAuNDg1NV0sWyJTIiwwLjQwNDI0XSxbIkEiLDAuMjk4OF0sWyJCIiwwLjE4OTU3XSxbIkMiLDAuMDA2MjldXSwicmF0ZXMiOnsiU1NTIjowLjU3NCwiU1MiOjAuNTA5LCJTIjowLjQzMywiQSI6MC4zNDcsIkIiOjAuMjQ0LCJDIjowLjA4OX0sImF2Z1MiOnsiU1NTIjoxNy4yLCJTUyI6MTUuMywiUyI6MTQuMiwiQSI6MTMuMSwiQiI6MTEuOCwiQyI6OS44fX0sIm9kZHMiOnsiY3V0cyI6W1siU1NTIiwwLjYwOTY4XSxbIlNTIiwwLjUxNTk1XSxbIlMiLDAuNDA4NTRdLFsiQSIsMC4yODc2N10sWyJCIiwwLjE3MzU5XSxbIkMiLDAuMDA3NjhdXSwicmF0ZXMiOnsiU1NTIjowLjY3OSwiU1MiOjAuNTk4LCJTIjowLjQ1NSwiQSI6MC4zNTIsIkIiOjAuMjQ2LCJDIjowLjA3OX0sImF2Z1MiOnsiU1NTIjoxOC41LCJTUyI6MTYuNCwiUyI6MTQuNSwiQSI6MTMuMywiQiI6MTEuOCwiQyI6OS42fX19fSwiYmFuZHMiOnsi6YmE5p2/Ijp7ImxvIjowLjkyLCJoaSI6MSwibiI6MTY2LCJyYXRlIjowLjk2MzksImxvOTUiOjAuOTM1NSwibjIiOjg3LCJyYXRlMiI6MC45NzcsInBlckRheSI6MC42Mn0sIua6lumJhOadvyI6eyJsbyI6MC44OCwiaGkiOjAuOTIsIm4iOjI3OSwicmF0ZSI6MC44ODUzLCJsbzk1IjowLjg0NzksIm4yIjoxMzksInJhdGUyIjowLjg5OTMsInBlckRheSI6MS4wNH0sIuWghei7uCI6eyJsbyI6MC44NCwiaGkiOjAuODgsIm4iOjQ3NCwicmF0ZSI6MC44NDE4LCJsbzk1IjowLjgwODksIm4yIjoyMjYsInJhdGUyIjowLjg0MDcsInBlckRheSI6MS43OH19fTsKIGZ1bmN0aW9uIGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgseGM9Ui5tYXAocj0+ZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKTsKICBjb25zdCBwUD1ub3JtYWxpemVUb3AzKHhjLm1hcCh4PT5kb3QoQVhJUy53UCx4KSksTWF0aC5taW4oMyxOKSk7CiAgbGV0IHBPPW51bGw7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCksbTM9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7CiAgIHBPPW5vcm1hbGl6ZVRvcDMoeGMubWFwKCh4LGkpPT5kb3QoQVhJUy53TyxbLi4ueCxNYXRoLmxvZyhwd1tpXSksbG9naXQoTWF0aC5taW4oLjk4LG0zW2ldKSldKSksTWF0aC5taW4oMyxOKSl9CiAgcmV0dXJue3BQLHBPLHhjfX0KIC8qIOmJhOadv+i7uOmmrO+8muOCquODg+OCuuOBjOOBguOCi+ODrOODvOOCueOBoOOBkeOAguS6iOa4rOeiuueOh+OBruWMuuWIhuOBlOOBqOOBq+OAgemBjuWOu+OBruWun+mam+OBrjPnnYDlhoXnjofjgpLmt7vjgYjjgosgKi8KIGZ1bmN0aW9uIGF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTtpZighYXAucE8pcmV0dXJuIG51bGw7CiAgY29uc3Qgb3V0PVtdO2FwLnBPLmZvckVhY2goKHAsaSk9PnsKICAgZm9yKGNvbnN0IGsgb2YgWyLpiYTmnb8iLCLmupbpiYTmnb8iLCLloIXou7giXSl7Y29uc3QgYj1BWElTLmJhbmRzW2tdO2lmKHA+PWIubG8mJnA8KGs9PT0i6YmE5p2/Ij8xLjAxOmIuaGkpKXtvdXQucHVzaCh7aSxwLHRpZXI6ayxyYXRlOmIucmF0ZSxsbzk1OmIubG85NSxuOmIubn0pO2JyZWFrfX19KTsKICByZXR1cm4gb3V0LnNvcnQoKGEsYik9PmIucC1hLnApfQogLyog5rOi5Lmx5bqm77yaU1NT44CcQ+OAgjPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkSAqLwogZnVuY3Rpb24gdXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHBzPWFwLnBQLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi1hKTsKICBjb25zdCBucz1SLm1hcChyPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLm46MH0pLG1vbnRoPU51bWJlcihTdHJpbmcocmFjZS5kYXRlKS5zbGljZSg1LDcpKXx8MCxMPXJhY2UubHZsfHwwOwogIGNvbnN0IGY9WzEsTi8xNixMPT09MT8xOjAsTD09PTI/MTowLEw9PT0zPzE6MCxMPT09ND8xOjAsTD09PTU/MTowLHJhY2Uuc3VyZj09PTE/MTowLChyYWNlLmRpc3R8fDApLzIwMDAsCiAgIG5zLmZpbHRlcihuPT5uPT09MCkubGVuZ3RoL04sbnMuZmlsdGVyKG49Pm48MykubGVuZ3RoL04sbnMucmVkdWNlKChhLG4pPT5hK01hdGgubG9nKDErbiksMCkvTi8zLAogICBwc1swXSxwc1sxXSxwc1syXSxwcy5yZWR1Y2UoKGEscCk9PmErcCpwLDApLHBzLmZpbHRlcihwPT5wPi41KS5sZW5ndGgvMyxtb250aD49NiYmbW9udGg8PTk/MTowXTsKICBsZXQgbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLnNvcnQoKGEsYik9PmItYSksb2Q9b2Rkcy5zbGljZSgpLnNvcnQoKGEsYik9PmEtYik7CiAgIGNvbnN0IGVudD0tcHcucmVkdWNlKChhLHApPT5hK3AqTWF0aC5sb2cocCksMCkvTWF0aC5sb2coTik7CiAgIGYucHVzaChwd1swXSxwd1sxXSxwd1swXStwd1sxXStwd1syXSxlbnQsTWF0aC5sb2cob2RbMF0pLE1hdGgubG9nKG9kWzFdKSxvZC5maWx0ZXIobz0+bzwxMCkubGVuZ3RoL04pO21vZGU9Im9kZHMifQogIGNvbnN0IHA9c2lnbW9pZChkb3QoQVhJUy51cHNldC5tb2RlbHNbbW9kZV0sZikpLEc9QVhJUy51cHNldC5ncmFkZXNbbW9kZV07CiAgbGV0IGdyYWRlPSJDIjtmb3IoY29uc3QgW2csY10gb2YgRy5jdXRzKXtpZihwPj1jKXtncmFkZT1nO2JyZWFrfX0KICByZXR1cm57Z3JhZGUscCxtb2RlLHJhdGU6Ry5yYXRlc1tncmFkZV0sYXZnUzpHLmF2Z1NbZ3JhZGVdfX0KCiAvKiDmiZXmiLvjgaTjgY3mmYLns7vliJfjg5Djg4Pjgq/jg4bjgrnjg4jjgIJyYWNlcyDjga/ml6Xku5jmmIfpoIYgW3tpZCxkYXRlLHJvd3N9XeOAgXBheUJ5SWQg44GvIHtyYWNlSWQ6e3BsYWNlOlt7bnVtYmVyLHllbn1dfX3jgIIKICAgIOeptOOCvuODvOODs+OBr+Wun+OCquODg+OCuumghuS9jeOBp+Wumue+qe+8iOODhOODvOODq+OBruOCquODg+OCuuWFpeWKm+ODouODvOODieOBqOWQjOOBmOeKtuazge+8ieOAguWQhOODrOODvOOCuTEwMOWGhuOBmuOBpOizvOWFpeOAgiAqLwogZnVuY3Rpb24gYmFja3Rlc3QocmFjZXMscGF5QnlJZCxvcHRzKXsKICBvcHRzPW9wdHN8fHt9O2NvbnN0IFNUQVJUPW9wdHMuc3RhcnR8fCIiLFNQTElUPW9wdHMuc3BsaXR8fCIiLE9PUz1vcHRzLm9vc3x8IiIsUFJPWFk9ISFvcHRzLnByb3h5OwogIGNvbnN0IG5hbWVzPVsidG9wMSIsInRvcDIiLCJ0b3AzIiwiYWxsSG9sZSIsInZhbHVlIiwiYXhpcyJdLHBlcj1bImFsbCIsIkEiLCJCIiwiQyJdOwogIGNvbnN0IFM9e307Zm9yKGNvbnN0IG4gb2YgbmFtZXMpe1Nbbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKVNbbl1bcF09e2JldHM6MCxoaXRzOjAscmV0OjAsc3E6MH19CiAgY29uc3QgU0VHPXt9OyAgIC8vIDHkvY3lgJnoo5zjga7mnaHku7bliKXvvIjlhajmnJ/plpPvvI/liY3ljYrvvI/lvozljYrvvIkKICBjb25zdCBzdG9yZT1uZXcgU3RvcmUoKTtsZXQgdXNlZD0wOwogIGNvbnN0IGFkZD0obixwLGhpdCx5ZW4pPT57Y29uc3QgeD1TW25dW3BdO3guYmV0cysrO2lmKGhpdCl4LmhpdHMrKzt4LnJldCs9eWVuO3guc3ErPXllbip5ZW59OwogIGNvbnN0IGFkZFNlZz0obGFiZWwscCx5ZW4pPT57Y29uc3QgZz1TRUdbbGFiZWxdPVNFR1tsYWJlbF18fHthbGw6e246MCxoOjAscjowLHE6MH0sQTp7bjowLGg6MCxyOjAscTowfSxCOntuOjAsaDowLHI6MCxxOjB9fTtmb3IoY29uc3QgayBvZiBbImFsbCIscF0pe2NvbnN0IHg9Z1trXTt4Lm4rKztpZih5ZW4+MCl4LmgrKzt4LnIrPXllbjt4LnErPXllbip5ZW59fTsKICBjb25zdCBBVj1QUk9YWT8uMTE1Oi4wOTE7CiAgZm9yKGNvbnN0IHJjIG9mIHJhY2VzKXsKICAgLy8g5omV5oi744GuSUTjga/jgIzml6Xku5gt6ZaL5YKs5aC0LVLnlarlj7fjgI3jgILjg5Djg4Pjgq/jgqLjg4Pjg5fjga4xMuahgUlE44Go44KC44CB5ZCM44GY5b2i5byP44GuSUTjgajjgoLntZDjgbPku5jjgZHjgosKICAgY29uc3Qgdk9mPS9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoNCw2KTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbM118fCIiLHJPZj1OdW1iZXIoL15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSgxMCwxMik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzRdfHwwKTsKICAgY29uc3QgcGF5PXBheUJ5SWRbcmMuaWRdfHxwYXlCeUlkW2Ake3JjLmRhdGV9LSR7dk9mfS0ke1N0cmluZyhyT2YpLnBhZFN0YXJ0KDIsIjAiKX1gXTsKICAgaWYocGF5JiZwYXkucGxhY2UmJnBheS5wbGFjZS5sZW5ndGgmJnJjLmRhdGU+PVNUQVJUKXsKICAgIC8vIOWHuui1sOihqOOBqOWQjOOBmOmmrOeVqumghuOBq+S4puOBueOCi++8iOWQjOeCueOBruOBqOOBjeOBruS4puOBs+OBp+edgOmghuOBjOa8j+OCjOOBquOBhOOCiOOBhuOBq++8iQogICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKTsKICAgIGNvbnN0IGhhc09kZHM9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5vZGRzPjEpLGhhc1BvcD1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLnBvcD4wKTsKICAgIGlmKFBST1hZP1IubGVuZ3RoPj02OihoYXNPZGRzfHxoYXNQb3ApKXsKICAgICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLHJ1bm5lcnM6Un07CiAgICAgY29uc3QgcmVzPVBST1hZP2FuYWx5emUocmFjZSxzdG9yZSxudWxsKTooaGFzT2Rkcz9hbmFseXplKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk6YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwsbnVsbCxSLm1hcChyPT5yLnBvcCkpKTsKICAgICBjb25zdCB5ZW49bmV3IE1hcChwYXkucGxhY2UubWFwKHg9Plt4Lm51bWJlcix4Lnllbl0pKTsKICAgICBjb25zdCBob2xlPXJlcy5maWx0ZXIoeD0+eC5ob2xlKS5zb3J0KChhLGIpPT5iLnAtYS5wKTsKICAgICBpZihob2xlLmxlbmd0aCl7CiAgICAgIHVzZWQrKztjb25zdCBwcj1TUExJVD8ocmMuZGF0ZTxTUExJVD8iQSI6IkIiKToiQSI7CiAgICAgIGNvbnN0IGJ1eT0obixsaXN0KT0+e2Zvcihjb25zdCB4IG9mIGxpc3Qpe2NvbnN0IHk9eWVuLmdldChSW3guaV0ubnVtKXx8MDthZGQobiwiYWxsIix5PjAseSk7YWRkKG4scHIseT4wLHkpO2lmKE9PUyYmcmMuZGF0ZT49T09TKWFkZChuLCJDIix5PjAseSl9fTsKICAgICAgYnV5KCJ0b3AxIixwaWNrKHJlcywxKSk7YnV5KCJ0b3AyIixwaWNrKHJlcywyKSk7YnV5KCJ0b3AzIixwaWNrKHJlcywzKSk7YnV5KCJhbGxIb2xlIixob2xlKTsKICAgICAgaWYoIVBST1hZKWJ1eSgidmFsdWUiLGhvbGUuZmlsdGVyKHg9PngudmFsdWU+PTEuMykpOwogICAgICBpZighUFJPWFkmJmhhc09kZHMpe2NvbnN0IGFwPWF4aXNQcm9icyhyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpO2lmKGFwLnBPKWJ1eSgiYXhpcyIsYXAucE8ubWFwKChwLGkpPT4oe2kscH0pKS5maWx0ZXIoeD0+eC5wPj1BWElTLmJhbmRzWyLpiYTmnb8iXS5sbykpfQogICAgICBjb25zdCB0PXBpY2socmVzLDEpWzBdOwogICAgICBpZih0KXtjb25zdCB5PXllbi5nZXQoUlt0LmldLm51bSl8fDAscj10LnBjL0FWLE49Ui5sZW5ndGg7CiAgICAgICBjb25zdCByYW5rPShyPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyIpOwogICAgICAgYWRkU2VnKCLjg6njg7Pjgq8iKyh0Lm48MiYmKHJhbms9PT0iUyJ8fHJhbms9PT0iQSIpPyJCIjpyYW5rKSxwcix5KTsKICAgICAgIGFkZFNlZyhOPD0xMD8i6aCt5pWwIOOAnDEwIjpOPD0xND8i6aCt5pWwIDEx44CcMTQiOiLpoK3mlbAgMTXjgJwiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2Uuc3VyZj09PTE/IuiKnSI6cmFjZS5zdXJmPT09Mj8i44OA44O844OIIjoi44Gd44Gu5LuWIixwcix5KTsKICAgICAgIGFkZFNlZyhyYWNlLmx2bD4wPyLjgq/jg6njgrkgIitMVk5bcmFjZS5sdmxdOiLjgq/jg6njgrkg5LiN5piOIixwcix5KTsKICAgICAgIGFkZFNlZyh0Lm4+PTU/IuWun+e4viA16LWw5Lul5LiKIjp0Lm4+PTM/IuWun+e4viAz44CcNOi1sCI6IuWun+e4viAz6LWw5pyq5rqAIixwcix5KX0KICAgICB9CiAgICB9CiAgIH0KICAgZm9yKGNvbnN0IHIgb2YgcmMucm93cylzdG9yZS5hZGQocik7CiAgfQogIGNvbnN0IGZpbj17fTsKICBmb3IoY29uc3QgbiBvZiBuYW1lcyl7ZmluW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcil7Y29uc3QgeD1TW25dW3BdOwogICBpZigheC5iZXRzKXtmaW5bbl1bcF09e2JldHM6MH07Y29udGludWV9CiAgIGNvbnN0IG1lYW49eC5yZXQveC5iZXRzLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHguc3EveC5iZXRzLW1lYW4qbWVhbikpOwogICBmaW5bbl1bcF09e2JldHM6eC5iZXRzLGhpdFJhdGU6eC5oaXRzL3guYmV0cyxyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHguYmV0cykvMTAwfX19CiAgY29uc3Qgc2Vncz17fTsKICBmb3IoY29uc3QgW2ssZ10gb2YgT2JqZWN0LmVudHJpZXMoU0VHKSl7c2Vnc1trXT17fTtmb3IoY29uc3QgcCBvZiBbImFsbCIsIkEiLCJCIl0pe2NvbnN0IHg9Z1twXTsKICAgaWYoIXgubil7c2Vnc1trXVtwXT17YmV0czowfTtjb250aW51ZX1jb25zdCBtZWFuPXguci94Lm4sc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5xL3gubi1tZWFuKm1lYW4pKTsKICAgc2Vnc1trXVtwXT17YmV0czp4Lm4saGl0UmF0ZTp4LmgveC5uLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5uKS8xMDB9fX0KICByZXR1cm57cmFjZXM6dXNlZCxzdGF0czpmaW4sc2Vnc307CiB9CiByZXR1cm57YXhpc1Byb2JzLGF4aXNQaWNrcyx1cHNldEdyYWRlLEFYSVMscGljayxmZWF0cyxNT0RFTCxGTixGSixsZXZlbE9mTGFiZWwsbGV2ZWxPZlByaXplLGJhY2t0ZXN0LGNhbGliLGNhbGliRm9yLGpubixubix0b1Jvdyxjc3ZSb3dzLFN0b3JlLGFuYWx5emUsaG9yc2VTY29yZSxub3JtYWxpemVUb3AzLHRvcDNGcm9tV2luLHN1cmZDb2RlLHBhcnNlRGF0ZX07Cn0pKCk7CgoKLyogPT09PT0g44Ki44OX44Oq5pys5L2TID09PT09ICovCmNvbnN0ICQ9aWQ9PmRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsKY29uc3QgZXNjPXM9PlN0cmluZyhzPz8iIikucmVwbGFjZSgvWyY8PiInXS9nLG09Pih7IiYiOiImYW1wOyIsIjwiOiImbHQ7IiwiPiI6IiZndDsiLCciJzoiJnF1b3Q7IiwiJyI6IiYjMzk7In1bbV0pKTsKY29uc3Qgc2xlZXA9KG1zPTApPT5uZXcgUHJvbWlzZShyPT5zZXRUaW1lb3V0KHIsbXMpKTsKZnVuY3Rpb24gYnVzeShvbixtc2c9IuWHpueQhuS4reKApiIpeyQoImJ1c3kiKS5zdHlsZS5kaXNwbGF5PW9uPyJmbGV4Ijoibm9uZSI7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1tc2d9CmxldCBEQj1udWxsLFNUT1JFPW51bGwsU1RPUkVfS0VZPSIiLENVUj1udWxsLExBU1RSRVM9bnVsbDsKY29uc3QgVkVOVUU9eyIwMSI6IuacreW5jCIsIjAyIjoi5Ye96aSoIiwiMDMiOiLnpo/ls7YiLCIwNCI6IuaWsOa9nyIsIjA1Ijoi5p2x5LqsIiwiMDYiOiLkuK3lsbEiLCIwNyI6IuS4reS6rCIsIjA4Ijoi5Lqs6YO9IiwiMDkiOiLpmKrnpZ4iLCIxMCI6IuWwj+WAiSJ9OwoKLyogLS0tIEluZGV4ZWREQu+8iOOBk+OBruODhOODvOODq+WwgueUqO+8iSAtLS0gKi8KZnVuY3Rpb24gb3BlbkRCKCl7cmV0dXJuIG5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCByPWluZGV4ZWREQi5vcGVuKCJ1cHNldF90b29sX2RiIiwyKTsKIHIub251cGdyYWRlbmVlZGVkPWU9Pntjb25zdCBkPWUudGFyZ2V0LnJlc3VsdDtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJmaWxlcyIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoImZpbGVzIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygibWV0YSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoIm1ldGEiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJwYXkiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJwYXkiKX07CiByLm9uc3VjY2Vzcz0oKT0+e0RCPXIucmVzdWx0O29rKCl9O3Iub25lcnJvcj0oKT0+bmcoci5lcnJvcik7ci5vbmJsb2NrZWQ9KCk9Pm5nKG5ldyBFcnJvcigi5LuW44Gu44K/44OW44Gn5L2/55So5Lit44Gn44GZIikpfSl9CmNvbnN0IGlkYkFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oImZpbGVzIikub2JqZWN0U3RvcmUoImZpbGVzIikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoImZpbGVzIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgaWRiQ2xlYXI9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpLHN0PXQub2JqZWN0U3RvcmUoImZpbGVzIik7c3Qub3BlbkN1cnNvcigpLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7aWYoIVN0cmluZyhjLmtleSkuc3RhcnRzV2l0aCgibGl2ZToiKSljLmRlbGV0ZSgpO2MuY29udGludWUoKX19O3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CgovKiDlj5bjgorovrzjgb/muIjjgb/jga7lhajooYzvvIjjg5Djg4Pjgq/jgqLjg4Pjg5dDU1bvvIvlj5blvpfmuIjjgb/jga7miJDnuL7vvInjgpLpoIbjgavmuKHjgZkgKi8KYXN5bmMgZnVuY3Rpb24gZm9yRWFjaFJvdyhjYil7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7Y29uc3QgZj1mc1tpXTsKICBpZihmLmxpdmUpe2Zvcihjb25zdCB4IG9mIGYucm93c3x8W10pY2IobGl2ZVJvdyh4KSl9CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSljYihVRS50b1JvdyhvKSk7CiAgaWYoaSUzPT09Milhd2FpdCBzbGVlcCgwKX0KfQovKiDjg6zjg7zjgrlJROOBi+OCiemWi+WCrOWgtOODu1Lnlarlj7fvvIgxMuahgeOBrkpSQeW9ouW8j++8j+aXpeS7mC3plovlgqzloLQtUuW9ouW8j+OBruS4oeWvvuW/nO+8iSAqLwpmdW5jdGlvbiB2ZW51ZU9mSWQoaWQpe3JldHVybiAvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzNdfHwiIn0KZnVuY3Rpb24gcmFjZU5vT2ZJZChpZCl7cmV0dXJuIE51bWJlcigvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDEwLDEyKTpTdHJpbmcoaWQpLnNwbGl0KCItIilbNF18fDApfQoKLyogLS0tIOWPluOCiui+vOOBvyAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gaW1wb3J0RmlsZShmaWxlKXsKIGJ1c3kodHJ1ZSwi44OV44Kh44Kk44Or44KS6Kqt44G/6L6844G/5Lit4oCmXG7lpKfjgY3jgYTjg5XjgqHjgqTjg6vjga/mlbDljYHnp5LjgYvjgYvjgorjgb7jgZnjgIIiKTthd2FpdCBzbGVlcCgzMCk7CiB0cnl7CiAgY29uc3QgdGV4dD1hd2FpdCBmaWxlLnRleHQoKTtsZXQgaXRlbXM7CiAgaWYoL1wuY3N2JC9pLnRlc3QoZmlsZS5uYW1lKSl7aXRlbXM9W3t0eXBlOiJyYWNlLXJlc3VsdHMiLHllYXI6MCxwbGFjZTpmaWxlLm5hbWUsY3N2OnRleHR9XX0KICBlbHNle2NvbnN0IGo9SlNPTi5wYXJzZSh0ZXh0KTtpdGVtcz1BcnJheS5pc0FycmF5KGopP2o6KGouZmlsZXN8fFtqXSl9CiAgaXRlbXM9aXRlbXMuZmlsdGVyKHg9PngmJnR5cGVvZiB4LmNzdj09PSJzdHJpbmciKTsKICBpZighaXRlbXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigiY3N244KS5ZCr44KA44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44CC44OQ44OD44Kv44Ki44OD44OXSlNPTuOBi+OAgUNTVuOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgiIpOwogIGF3YWl0IGlkYkNsZWFyKCk7bGV0IG49MDsKICBmb3IobGV0IGk9MDtpPGl0ZW1zLmxlbmd0aDtpKyspe2NvbnN0IGl0PWl0ZW1zW2ldO2F3YWl0IGlkYlB1dChgJHtpdC55ZWFyfToke2l0LnBsYWNlfToke2l9YCx7eWVhcjppdC55ZWFyLHBsYWNlOml0LnBsYWNlLHBsYWNlTmFtZTppdC5wbGFjZU5hbWUsY3N2Oml0LmNzdn0pOwogICBuKz1NYXRoLm1heCgwLGl0LmNzdi5zcGxpdCgiXG4iKS5sZW5ndGgtMSk7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1g5L+d5a2Y5Lit4oCmICR7aSsxfS8ke2l0ZW1zLmxlbmd0aH1gO2F3YWl0IHNsZWVwKDApfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5bjgorovrzjgb/lrozkuobvvJoke2l0ZW1zLmxlbmd0aH3jg5XjgqHjgqTjg6vvvI/ntIQke24udG9Mb2NhbGVTdHJpbmcoKX3ooYw8L3NwYW4+YDsKIH1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5Y+W44KK6L6844G/44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7YnVzeShmYWxzZSl9Cn0KYXN5bmMgZnVuY3Rpb24gc2hvd1N0YXRlKCl7CiB0cnl7Y29uc3QgZnM9YXdhaXQgaWRiQWxsKCkscHM9YXdhaXQgcGF5QWxsKCk7CiAgY29uc3QgYmFzZT1mcy5maWx0ZXIoZj0+IWYubGl2ZSksbGl2ZT1mcy5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoKTsKICBpZighZnMubGVuZ3RoJiYhcHMubGVuZ3RoKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+44OH44O844K/5pyq5Y+W5b6X44Gn44GZ44CC5LiK44Gu44CM6YGO5Y675oiQ57i+44Go5omV5oi744KS5Y+W5b6X44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IGxkPWxpdmUubWFwKGY9PmYuZGF0ZSkuc29ydCgpLG5SYWNlcz1saXZlLnJlZHVjZSgocyxmKT0+cytuZXcgU2V0KGYucm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplLDApOwogIGxldCBoPSIiOwogIGlmKGxpdmUubGVuZ3RoKWgrPWA8c3BhbiBjbGFzcz0iZ29vZCI+5Y+W5b6X5riI44G/44Gu5oiQ57i+77yaJHtsaXZlLmxlbmd0aH3ml6XvvI8ke25SYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iCR7bGRbMF1944CcJHtsZFtsZC5sZW5ndGgtMV1977yJPC9zcGFuPmA7CiAgaWYoYmFzZS5sZW5ndGgpe2NvbnN0IHlzPVsuLi5uZXcgU2V0KGJhc2UubWFwKGY9PmYueWVhcikpXS5zb3J0KCk7aCs9KGg/IlxuIjoiIikrYDxzcGFuIGNsYXNzPSJnb29kIj7jg5Djg4Pjgq/jgqLjg4Pjg5fvvJoke2Jhc2UubGVuZ3RofeODleOCoeOCpOODq++8iCR7eXNbMF18fCItIn3jgJwke3lzW3lzLmxlbmd0aC0xXXx8Ii0ifeW5tO+8iTwvc3Bhbj5gfQogIGNvbnN0IHByPXBzLnJlZHVjZSgocyxwKT0+cysocC5yYWNlc3x8W10pLmxlbmd0aCwwKTsKICBoKz0oaD8iXG4iOiIiKSsocHMubGVuZ3RoP2A8c3BhbiBjbGFzcz0iZ29vZCI+5omV5oi777yaJHtwcy5sZW5ndGh95pel77yPJHtwci50b0xvY2FsZVN0cmluZygpfeODrOODvOOCuTwvc3Bhbj5gOic8c3BhbiBjbGFzcz0id2FybiI+5omV5oi777ya5pyq5Y+W5b6XPC9zcGFuPicpOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9aDsKIH1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+56K66KqN44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlKX08L3NwYW4+YH0KfQovKiBXb3JrZXLjga4gL3Jlc3VsdHMg44Gu6KGMIOKGkiDjg4Tjg7zjg6vlhoXpg6jjga7ooYwgKi8KZnVuY3Rpb24gbGl2ZVJvdyh4KXtjb25zdCBmPXBhcnNlRmxvYXQoU3RyaW5nKHguZmluaXNoPz8iIikucmVwbGFjZSgvW15cZC5dL2csIiIpKTsKIHJldHVybntyYWNlSWQ6U3RyaW5nKHgucmFjZUlkfHwiIiksZGF0ZTpVRS5wYXJzZURhdGUoeC5kYXRlKSxuYW1lOlN0cmluZyh4LmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOlVFLm5uKHguaG9yc2UpLGpvY2tleTpVRS5qbm4oeC5qb2NrZXkpLAogIGZpbmlzaDpOdW1iZXIuaXNGaW5pdGUoZikmJmY+MD9mOm51bGwsZGlzdDpOdW1iZXIoeC5kaXN0YW5jZSl8fDAsc3VyZjpVRS5zdXJmQ29kZSh4LnN1cmZhY2UpLGFnZTpOdW1iZXIoeC5hZ2UpfHxudWxsLG51bTpOdW1iZXIoeC5udW1iZXIpfHxudWxsLHBvcDpOdW1iZXIoeC5wb3ApPjA/TnVtYmVyKHgucG9wKTpudWxsLG9kZHM6bnVsbCxqbmFtZTpTdHJpbmcoeC5qb2NrZXl8fCIiKS50cmltKCksCiAgbHZsOih4LnZlbnVlQ29kZSYmIS9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyh4LnZlbnVlQ29kZSkpKT8tMTooVUUubGV2ZWxPZkxhYmVsKHguY2xzKXx8VUUubGV2ZWxPZlByaXplKHgucHJpemUpKX19Ci8qIOWvvuixoeaXpeOCiOOCiuWJjeOBruWxpeattOOBoOOBkeOBp+OCueODiOOCouOCkuS9nOOCiyAqLwphc3luYyBmdW5jdGlvbiBidWlsZFN0b3JlKHRhcmdldCl7CiBpZihTVE9SRSYmU1RPUkVfS0VZPT09dGFyZ2V0KXJldHVybiBTVE9SRTsKIGNvbnN0IGZzPWF3YWl0IGlkYkFsbCgpO2lmKCFmcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLpgY7ljrvjg4fjg7zjgr/jgYzmnKrnmbvpjLLjgafjgZnjgIIiKTsKIGNvbnN0IHN0PW5ldyBVRS5TdG9yZSgpO2xldCByb3dzPTAsdXNlZD0wOwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXsKICBidXN5KHRydWUsYOmBjuWOu+ODh+ODvOOCv+OCkumbhuioiOS4reKApiAke2krMX0vJHtmcy5sZW5ndGh9XG7vvIgke3RhcmdldH3jgojjgorliY3jga7jgb/kvb/nlKjvvIlgKTsKICBpZihmc1tpXS5saXZlKXtmb3IoY29uc3QgeCBvZiBmc1tpXS5yb3dzfHxbXSl7Y29uc3Qgcj1saXZlUm93KHgpO3Jvd3MrKztpZighci5kYXRlfHxyLmRhdGU+PXRhcmdldHx8IXIuaG9yc2UpY29udGludWU7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlfX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZnNbaV0uY3N2KSl7Y29uc3Qgcj1VRS50b1JvdyhvKTtyb3dzKys7aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXQpY29udGludWU7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlfQogIGF3YWl0IHNsZWVwKDApOwogfQogYnVzeShmYWxzZSk7U1RPUkU9c3Q7U1RPUkVfS0VZPXRhcmdldDtTVE9SRS5jb3VudD11c2VkO3JldHVybiBzdDsKfQoKLyogLS0tIOODrOODvOOCuemBuOaKniAtLS0gKi8KZnVuY3Rpb24gc2hvd1BhbmUoayl7Zm9yKGNvbnN0IHAgb2ZbIldvcmtlciIsIk1hbnVhbCIsIlBhc3QiXSkkKCJwYW5lIitwKS5zdHlsZS5kaXNwbGF5PXA9PT1rPyJibG9jayI6Im5vbmUifQokKCJ0YWJXb3JrZXIiKS5vbmNsaWNrPSgpPT5zaG93UGFuZSgiV29ya2VyIik7JCgidGFiTWFudWFsIikub25jbGljaz0oKT0+c2hvd1BhbmUoIk1hbnVhbCIpOyQoInRhYlBhc3QiKS5vbmNsaWNrPSgpPT5zaG93UGFuZSgiUGFzdCIpOwpmdW5jdGlvbiBzZXRSYWNlKHJhY2UsbGFiZWwpe2lmKHJhY2Uua2V5JiYhcmFjZS5vZGRzMClyYWNlLm9kZHMwPW9kZHNGb3IocmFjZSk7Q1VSPXJhY2U7TEFTVFJFUz1udWxsOyQoInJhY2VsYWJlbCIpLnRleHRDb250ZW50PWxhYmVsOyQoInJ1biIpLmRpc2FibGVkPWZhbHNlOyQoIm91dCIpLnRleHRDb250ZW50PSLjgIzop6PmnpDjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIifQoKLyogV29ya2VyICovCmxldCBXUkFDRVM9W107CmxldCBXRElBRz1bXTsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hDYXJkcyhiYXNlLGQsdmVudWVDb2RlKXsKIGNvbnN0IHE9dmVudWVDb2RlP2AmdmVudWU9JHtlbmNvZGVVUklDb21wb25lbnQodmVudWVDb2RlKX1gOiIiO2xldCBlcnI9IiI7CiBmb3IobGV0IHQ9MDt0PDM7dCsrKXsKICB0cnl7Y29uc3Qgcj1hd2FpdCBmZXRjaChgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHtlbmNvZGVVUklDb21wb25lbnQoZCl9JHtxfWApOwogICBpZighci5vayl7bGV0IG09IiI7dHJ5e209KGF3YWl0IHIuanNvbigpKS5lcnJvcnx8IiJ9Y2F0Y2h7fXRocm93IG5ldyBFcnJvcihgSFRUUCAke3Iuc3RhdHVzfSAke219YC50cmltKCkpfQogICBjb25zdCB4PWF3YWl0IHIuanNvbigpO3JldHVybntyYWNlczpBcnJheS5pc0FycmF5KHgpP3g6KHgucmFjZXN8fFtdKSx3YXJuaW5nOngud2FybmluZ3x8IiJ9fQogIGNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7YXdhaXQgc2xlZXAoMTIwMCoodCsxKSl9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyfHwi5Y+W5b6X44Gn44GN44G+44Gb44KTIik7Cn0KZnVuY3Rpb24gcmVuZGVyVmVudWVCdXR0b25zKGQpewogY29uc3QgbmFtZXM9Wy4uLm5ldyBTZXQoV1JBQ0VTLm1hcChyPT5yLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiIpKV07CiBsZXQgaD1uYW1lcy5tYXAoKHYsaSk9PmA8YnV0dG9uIGRhdGEtdj0iJHtpfSIgY2xhc3M9InN1YiI+JHtlc2Modil977yIJHtXUkFDRVMuZmlsdGVyKHI9PihyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiIpPT09dikubGVuZ3RofVLvvIk8L2J1dHRvbj5gKS5qb2luKCIiKTsKIGgrPVdESUFHLmZpbHRlcih4PT54LmVycnx8eC5lbXB0eXx8eC5wYXJ0aWFsKS5tYXAoeD0+YDxkaXYgY2xhc3M9Indhcm4gc21hbGwiPiR7ZXNjKHgubmFtZSl977yaJHt4LmVycj8i5Y+W5b6X5aSx5pWX77yIIitlc2MoeC5lcnIpLnNsaWNlKDAsNDAwKSsi77yJIjp4LnBhcnRpYWw/YCR7eC5jb3VudH1S44GX44GL5Y+W5b6X44Gn44GN44Gm44GE44G+44Gb44KT77yI6YCa5bi444GvMTDjgJwxMlLvvIlgOmDlh7rotbDppqzjgpLoqq3jgoHjgarjgYvjgaPjgZ/jg6zjg7zjgrkgJHt4LmVtcHR5fVLvvIjpmaTlpJbvvIlgfSA8YnV0dG9uIGNsYXNzPSJzdWIiIGRhdGEtcmV0cnk9IiR7ZXNjKHguY29kZXx8IiIpfSI+5YaN5Y+W5b6XPC9idXR0b24+PC9kaXY+YCkuam9pbigiIik7CiAkKCJ3bGlzdCIpLmlubmVySFRNTD1oOwogJCgid2xpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS12XSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5saXN0VmVudWUobmFtZXNbYi5kYXRhc2V0LnZdLGQpKTsKICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtcmV0cnldIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PmxvYWRWZW51ZShkLHt2ZW51ZUNvZGU6Yi5kYXRhc2V0LnJldHJ5LHZlbnVlTmFtZToiIn0sdHJ1ZSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGxvYWRWZW51ZShkLHYscmVyZW5kZXIpewogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiBjb25zdCBwcmV2PVdESUFHLmZpbmQoeD0+U3RyaW5nKHguY29kZSk9PT1TdHJpbmcodi52ZW51ZUNvZGUpKTsKIFdSQUNFUz1XUkFDRVMuZmlsdGVyKHI9PlN0cmluZyhyLnZlbnVlQ29kZSkhPT1TdHJpbmcodi52ZW51ZUNvZGUpKTsKIFdESUFHPVdESUFHLmZpbHRlcih4PT5TdHJpbmcoeC5jb2RlKSE9PVN0cmluZyh2LnZlbnVlQ29kZSkpOwogY29uc3QgbmFtZT12LnZlbnVlTmFtZXx8KHByZXYmJnByZXYubmFtZSl8fHYudmVudWVDb2RlOwogdHJ5e2NvbnN0IHtyYWNlc309YXdhaXQgZmV0Y2hDYXJkcyhiYXNlLGQsdi52ZW51ZUNvZGUpOwogIGNvbnN0IG9rPXJhY2VzLmZpbHRlcihhPT4oYS5ob3JzZXN8fGEucnVubmVyc3x8W10pLmxlbmd0aCksZW1wdHk9cmFjZXMubGVuZ3RoLW9rLmxlbmd0aDsKICBXUkFDRVMucHVzaCguLi5vayk7CiAgY29uc3QgZXJycz1yYWNlcy5maWx0ZXIoYT0+YS5lcnJvcikubWFwKGE9PmEuZXJyb3IpOwogIFdESUFHLnB1c2goe2NvZGU6di52ZW51ZUNvZGUsbmFtZSxjb3VudDpvay5sZW5ndGgsZW1wdHkscGFydGlhbDpvay5sZW5ndGg+MCYmb2subGVuZ3RoPDEwLGVycjohcmFjZXMubGVuZ3RoPyLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiOighb2subGVuZ3RoJiZlcnJzLmxlbmd0aD9lcnJzWzBdOiIiKX0pOwogfWNhdGNoKGUpe1dESUFHLnB1c2goe2NvZGU6di52ZW51ZUNvZGUsbmFtZSxjb3VudDowLGVtcHR5OjAsZXJyOmUubWVzc2FnZX0pfQogaWYocmVyZW5kZXIpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l++8iCR7V0RJQUcubWFwKHg9PmAke3gubmFtZX0ke3guY291bnR9UmApLmpvaW4oIu+8jyIpfe+8iWA7JCgid2FsbCIpLmRpc2FibGVkPSFXUkFDRVMubGVuZ3RoOyQoIm9kZHNHZXQiKS5kaXNhYmxlZD0hV1JBQ0VTLmxlbmd0aDtyZW5kZXJWZW51ZUJ1dHRvbnMoZCl9Cn0KJCgid2dldCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgZD0kKCJ3ZGF0ZSIpLnZhbHVlO2lmKCFkKXJldHVybiBhbGVydCgi5pel5LuY44KS6YG45oqe44GX44Gm44GP44Gg44GV44GE44CCIik7CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5YKs5aC044KS56K66KqN5Lit4oCmIjskKCJ3bGlzdCIpLmlubmVySFRNTD0iIjskKCJhbGxvdXQiKS5pbm5lckhUTUw9IiI7V1JBQ0VTPVtdO1dESUFHPVtdO1dEQVRFPWQ7JCgid2FsbCIpLmRpc2FibGVkPXRydWU7JCgib2Rkc0dldCIpLmRpc2FibGVkPXRydWU7T0REUz17fTsKIGxldCB2ZW51ZXM9bnVsbDsKIGxldCBsaXN0RGlhZz0iIixhdmFpbERhdGVzPVtdO0FWQUlMPVtdOwogdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSZsaXN0PTFgKTtpZihyLm9rKXtjb25zdCB4PWF3YWl0IHIuanNvbigpO3ZlbnVlcz14LnZlbnVlc3x8W107YXZhaWxEYXRlcz14LmF2YWlsYWJsZURhdGVzfHxbXTtBVkFJTD1hdmFpbERhdGVzO2lmKCF2ZW51ZXMubGVuZ3RoKWxpc3REaWFnPUpTT04uc3RyaW5naWZ5KHguZGlhZ25vc3RpY3N8fFtdKS5zbGljZSgwLDUwMCl9fWNhdGNoKGUpe30KIHRyeXsKICBpZih2ZW51ZXMmJiF2ZW51ZXMubGVuZ3RoJiZhdmFpbERhdGVzLmxlbmd0aCYmIWF2YWlsRGF0ZXMuaW5jbHVkZXMoZCkpewogICAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZH0g44GvSlJB44Gu6ZaL5YKs5pel44Gn44Gv44GC44KK44G+44Gb44KT44CCXG7lhazplovkuK3jga7plovlgqzml6XvvJoke2F2YWlsRGF0ZXMuam9pbigi44CBIil9YDsKICAgJCgid2xpc3QiKS5pbm5lckhUTUw9YXZhaWxEYXRlcy5tYXAoeD0+YDxidXR0b24gY2xhc3M9InN1YiIgZGF0YS1kPSIke3h9Ij4ke3h9PC9idXR0b24+YCkuam9pbigiIik7CiAgICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtZF0iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+eyQoIndkYXRlIikudmFsdWU9Yi5kYXRhc2V0LmQ7JCgid2dldCIpLmNsaWNrKCl9KTsKICAgcmV0dXJuOwogIH0KICBpZih2ZW51ZXMmJnZlbnVlcy5sZW5ndGgpewogICBmb3IoY29uc3QgdiBvZiB2ZW51ZXMpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1g5Y+W5b6X5Lit4oCmICR7di52ZW51ZU5hbWV977yIJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l+a4iOOBv++8iWA7YXdhaXQgbG9hZFZlbnVlKGQsdixmYWxzZSl9CiAgfWVsc2V7CiAgIC8vIOaXp1dvcmtlcuetieOBp+mWi+WCrOWgtOS4gOimp+OBjOS9v+OBiOOBquOBhOWgtOWQiO+8mjHml6XliIbjgpLkuIDmi6zlj5blvpcKICAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLkuIDmi6zlj5blvpfkuK3igKYiOwogICBjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLCIiKTsKICAgY29uc3Qgb2s9cmFjZXMuZmlsdGVyKGE9PihhLmhvcnNlc3x8YS5ydW5uZXJzfHxbXSkubGVuZ3RoKTtXUkFDRVM9b2s7CiAgIGlmKHJhY2VzLmxlbmd0aD5vay5sZW5ndGgpV0RJQUcucHVzaCh7Y29kZToiIixuYW1lOiLkuIDpg6giLGNvdW50Om9rLmxlbmd0aCxlbXB0eTpyYWNlcy5sZW5ndGgtb2subGVuZ3RoLGVycjoiIn0pOwogIH0KICBpZighV1JBQ0VTLmxlbmd0aCl7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLlh7rotbDppqzjgaTjgY3jga7jg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpPjgafjgZfjgZ/jgIJcbiIrV0RJQUcubWFwKHg9PmAke3gubmFtZX3vvJoke3guZXJyfHwi5Ye66LWw6aas44Gq44GXIn1gKS5qb2luKCJcbiIpKyhsaXN0RGlhZz8iXG7oqLrmlq3vvJoiK2xpc3REaWFnOiIiKTtyZW5kZXJWZW51ZUJ1dHRvbnMoZCk7cmV0dXJufQogICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l2ArKFdESUFHLmxlbmd0aD9g77yIJHtXRElBRy5tYXAoeD0+YCR7eC5uYW1lfSR7eC5jb3VudH1SYCkuam9pbigi77yPIil977yJYDoiIik7CiAgJCgid2FsbCIpLmRpc2FibGVkPWZhbHNlOyQoIm9kZHNHZXQiKS5kaXNhYmxlZD1mYWxzZTtyZW5kZXJWZW51ZUJ1dHRvbnMoZCk7CiB9Y2F0Y2goZSl7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLlj5blvpfjgqjjg6njg7zvvJoiK2UubWVzc2FnZSsiXG7vvIhXb3JrZXLjgYzmnKrlhazplovvvI9DT1JT77yP5pel5LuY44Gr6ZaL5YKs44Gq44GX44CB44Gu5Y+v6IO95oCn77yJIn0KfTsKZnVuY3Rpb24gbGlzdFZlbnVlKHYsZCl7CiBjb25zdCBycz1XUkFDRVMuZmlsdGVyKHI9PihyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiIpPT09dikuc29ydCgoYSxiKT0+KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogJCgid2xpc3QiKS5pbm5lckhUTUw9cnMubWFwKChyLGspPT5gPGJ1dHRvbiBkYXRhLWs9IiR7a30iPiR7ci5yYWNlTnVtYmVyfHxrKzF9UiAke2VzYyhyLnJhY2VOYW1lfHwiIil9PC9idXR0b24+YCkuam9pbigiIik7CiAkKCJ3bGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbiIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT57Y29uc3Qgcj1yc1tiLmRhdGFzZXQua107CiAgY29uc3QgaHM9KHIuaG9yc2VzfHxyLnJ1bm5lcnMpOwogIGNvbnN0IHJhY2U9bWtSYWNlKHIsZCk7CiAgc2V0UmFjZShyYWNlLGAke2R9ICR7dn0ke3IucmFjZU51bWJlcnx8IiJ9UiAke3IucmFjZU5hbWV8fCIife+8iCR7ci5zdXJmYWNlfHwiPyJ9JHtyLmRpc3RhbmNlfHwiPyJ9beODuyR7aHMubGVuZ3Rofemgre+8iWApOwogfSk7Cn0KCmZ1bmN0aW9uIG1rUmFjZShyLGQpewogY29uc3QgaHM9KHIuaG9yc2VzfHxyLnJ1bm5lcnMpOwogcmV0dXJue2RhdGU6ZCxrZXk6YCR7U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpfS0ke051bWJlcihyLnJhY2VOdW1iZXIpfHwwfWAsc3VyZjpVRS5zdXJmQ29kZShyLnN1cmZhY2UpLGRpc3Q6TnVtYmVyKHIuZGlzdGFuY2UpfHwwLGx2bDpVRS5sZXZlbE9mTGFiZWwoci5jbGFzc05hbWUpfHxVRS5sZXZlbE9mTGFiZWwoci5yYWNlTmFtZSksCiAgcnVubmVyczpocy5tYXAoKGgsaSk9Pntjb25zdCBuYW1lPWguaG9yc2VOYW1lfHxoLmhvcnNlfHxoLm5hbWV8fCIiO3JldHVybntuYW1lLGhvcnNlOlVFLm5uKG5hbWUpLGpvY2tleTpVRS5qbm4oaC5qb2NrZXl8fCIiKSxqbmFtZTpTdHJpbmcoaC5qb2NrZXl8fCIiKS50cmltKCksYWdlOmguYWdlfHxudWxsLG51bTpoLmhvcnNlTnVtYmVyfHxoLm51bWJlcnx8aSsxfX0pLnNvcnQoKHgseSk9Pih4Lm51bXx8MCktKHkubnVtfHwwKSl9Owp9CmxldCBXREFURT0iIixBVkFJTD1bXTsKLyog5YWo44Os44O844K55LiA5ous77ya5ZCE44Os44O844K544Gu56m06aas5YCZ6KOc77yI5LiK5L2NMumgre+8ieOCkuS4gOimp+OBq+OBmeOCiyAqLwphc3luYyBmdW5jdGlvbiBydW5BbGwoYm94SWQ9ImFsbG91dCIpewogaWYoIVdSQUNFUy5sZW5ndGgpcmV0dXJuOwogY29uc3QgYm94PSQoYm94SWQpOwogY29uc3QgZD1XREFURTtsZXQgdGV4dD1gJHtkfSDnqbTppqzlpb3otbDvvIjkuIrkvY3lgJnoo5zvvIlcbmA7CiB0cnl7CiAgY29uc3Qgc3RvcmU9YXdhaXQgYnVpbGRTdG9yZShkKTsKICBjb25zdCBycz1bLi4uV1JBQ0VTXS5zb3J0KChhLGIpPT5TdHJpbmcoYS52ZW51ZU5hbWV8fGEudmVudWV8fCIiKS5sb2NhbGVDb21wYXJlKFN0cmluZyhiLnZlbnVlTmFtZXx8Yi52ZW51ZXx8IiIpLCJqYSIpfHwoYS5yYWNlTnVtYmVyfHwwKS0oYi5yYWNlTnVtYmVyfHwwKSk7CiAgY29uc3QgZ2FwPXN0b3JlLmxhc3REYXRlP01hdGgucm91bmQoKG5ldyBEYXRlKGQpLW5ldyBEYXRlKHN0b3JlLmxhc3REYXRlKSkvODY0ZTUpOm51bGw7CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4Pjgrrlj43mmKDvvJoke09iamVjdC5rZXlzKE9ERFMpLmxlbmd0aH3jg6zjg7zjgrnliIbvvIjmnKrlj5blvpfjga7jg6zjg7zjgrnjga/jg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIk8L2Rpdj48ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S44OH44O844K/5pyA57WC5pel77yaJHtlc2Moc3RvcmUubGFzdERhdGV8fCLkuI3mmI4iKX3vvI/nqbTjgr7jg7zjg7Pjga/jg4Tjg7zjg6vmjqjlrprjga7kurrmsJfvvIjpqI7miYvmiJDnuL7ovrzjgb/vvInjgafliKTlrprjgILlrp/pmpvjga7kurrmsJfjgajjga/nlbDjgarjgorjgb7jgZk8L2Rpdj5gLHRIPTAsdE49MCxqSD0wLGpNaXNzPVtdOwogIGlmKGdhcCE9bnVsbCYmZ2FwPjE0KWgrPWA8ZGl2IGNsYXNzPSJ3YXJuIj7imqAg5pyA5paw44Gu5oiQ57i+44GMJHtnYXB95pel5YiG5YWl44Gj44Gm44GE44G+44Gb44KT44CC55u06L+R44Gu5aW96LWw44O75Yeh6LWw44GM5Y+N5pig44GV44KM44Gq44GE54K544Gr5rOo5oSP44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKICBoKz0iPGJyPiI7CiAgcnMuZm9yRWFjaCgocixrKT0+ewogICBjb25zdCByYWNlPW1rUmFjZShyLGQpLG49cmFjZS5ydW5uZXJzLmxlbmd0aCx2PXIudmVudWVOYW1lfHxyLnZlbnVlfHwiIjsKICAgY29uc3QgbGFiZWw9YCR7dn0ke3IucmFjZU51bWJlcnx8aysxfVIgJHtyLnJhY2VOYW1lfHwiIn3vvIgke3Iuc3VyZmFjZXx8Ij8ifSR7ci5kaXN0YW5jZXx8Ij8ifW3jg7ske2596aCt77yJYDsKICAgdGV4dCs9YFxu4pagJHtsYWJlbH1cbmA7CiAgIGxldCBib2R5PSIiOwogICBpZihuPDYpYm9keT0nPHNwYW4gY2xhc3M9InNtYWxsIj426aCt5pyq5rqA44Gu44Gf44KB5a++6LGh5aSWPC9zcGFuPic7CiAgIGVsc2V7CiAgICBjb25zdCBvZD1vZGRzRm9yKHJhY2UpLHJlcz1VRS5hbmFseXplKHJhY2Usc3RvcmUsb2QpLGM9VUUucGljayhyZXMsMik7e2NvbnN0IG09bWF0Y2hJbmZvKHJlcyk7dEgrPW0uaDt0Tis9bS5uO2pIKz1tLmo7ak1pc3MucHVzaCguLi5tLm1pc3MpfQogICAgYm9keT1jLm1hcCh4PT57Y29uc3QgdGc9eC50YWdzLnNsaWNlKDAsMikubWFwKHQ9PnQudCkuam9pbigi77yPIik7CiAgICAgdGV4dCs9YCAgJHt4Lm5vfeeVqiAke3gubmFtZX0gJHtyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKX0gJHsoeC5wYyoxMDApLnRvRml4ZWQoMSl9JSAke3RnfVxuYDsKICAgICB0ZXh0Kz1gICAgICR7cmVjTGluZSh4KX3vvI8ke3guam5hbWV8fCLpqI7miYvkuI3mmI4ifVxuYDsKICAgICByZXR1cm4gYDxkaXY+PGI+JHtlc2MoeC5ubyl955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgciR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9Ij4ke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfTwvc3Bhbj4gPHNwYW4gY2xhc3M9InNtYWxsIj4keyh4LnBjKjEwMCkudG9GaXhlZCgxKX0l77yI56m044K+44O844Oz5bmz5Z2H44GuJHsoeC5wYy9BVkdbeC5tb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXSkudG9GaXhlZCgxKX3lgI3jg7vkv6HpoLzluqYke2VzYyh4LmNvbmYpfe+8iTwvc3Bhbj48YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyZWNMaW5lKHgpKX3vvI8ke2VzYyh4LmpuYW1lfHwi6aiO5omL5LiN5piOIil9PC9zcGFuPjxicj5gK3gudGFncy5zbGljZSgwLDMpLm1hcCh0PT5gPHNwYW4gY2xhc3M9ImNoaXAgJHt0LmN9Ij4ke2VzYyh0LnQpfTwvc3Bhbj5gKS5qb2luKCIiKStgPC9kaXY+YH0pLmpvaW4oIiIpfHwnPHNwYW4gY2xhc3M9InNtYWxsIj7lrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gu5YCZ6KOc44Gq44GX77yd5a++6LGh5aSWPC9zcGFuPic7CiAgIH0KICAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKGxhYmVsKX08L2I+PGJyPiR7Ym9keX08YnI+PGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLWs9IiR7a30iPuips+e0sOODu+OCquODg+OCuuWFpeWKmzwvYnV0dG9uPjwvZGl2PmA7CiAgfSk7CiAgaD1oLnJlcGxhY2UoJzxicj4nLGA8ZGl2IGNsYXNzPSJzbWFsbCI+5bGl5q2044Gu54Wn5ZCI77ya6aasICR7dEh9LyR7dE596aCt77yI6YGO5Y6744GrMui1sOS7peS4iu+8ie+8j+mojuaJiyAke2pIfS8ke3ROfemgrTwvZGl2PmArKGpNaXNzLmxlbmd0aCYmakg8dE4qLjY/YDxkaXYgY2xhc3M9Indhcm4gc21hbGwiPuKaoCDpqI7miYvjgpLpgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgafjgY3jgabjgYTjgarjgYTkvovvvJoke2VzYyhbLi4ubmV3IFNldChqTWlzcyldLnNsaWNlKDAsNikuam9pbigi44CBIikpfTwvZGl2PmA6IiIpKyh0TiYmdEg8dE4qLjU/JzxkaXYgY2xhc3M9Indhcm4gc21hbGwiPuKaoCDnhaflkIjjgafjgY3jgZ/ppqzjgYzljYrliIbmnKrmuoDjgafjgZnjgILoi6Xpp5LmiKbjgYzkuK3lv4Pjga7ml6Xjga/mraPluLjjgafjgZnjgYzjgIHjgZ3jgYbjgafjgarjgZHjgozjgbDppqzlkI3ooajoqJjjga7kuI3kuIDoh7Tjga7lj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgII8L2Rpdj4nOicnKSsnPGJyPicpOwogIGgrPSc8YnV0dG9uIGNsYXNzPSJjb3B5QWxsIj7kuIDopqfjgpLjg4bjgq3jgrnjg4jjgafjgrPjg5Tjg7w8L2J1dHRvbj4nOwogIGJveC5pbm5lckhUTUw9aDsKICBib3gucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEta10iKS5mb3JFYWNoKGJ0PT5idC5vbmNsaWNrPSgpPT57Y29uc3Qgcj1yc1tidC5kYXRhc2V0LmtdO3NldFJhY2UobWtSYWNlKHIsZCksYCR7ZH0gJHtyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiJ9JHtyLnJhY2VOdW1iZXJ8fCIifVIgJHtyLnJhY2VOYW1lfHwiIn1gKTskKCJydW4iKS5zY3JvbGxJbnRvVmlldyh7YmVoYXZpb3I6InNtb290aCJ9KTtydW4obnVsbCl9KTsKICBjb25zdCBjYj1ib3gucXVlcnlTZWxlY3RvcigiLmNvcHlBbGwiKTtjYi5vbmNsaWNrPWFzeW5jKCk9Pnt0cnl7YXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodGV4dCk7Y2IudGV4dENvbnRlbnQ9IuOCs+ODlOODvOOBl+OBvuOBl+OBnyJ9Y2F0Y2goZSl7YWxlcnQoIuOCs+ODlOODvOOBp+OBjeOBvuOBm+OCk+OBp+OBl+OBnyIpfX07CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7Ym94LmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuS4gOaLrOino+aekOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn0KJCgid2FsbCIpLm9uY2xpY2s9KCk9PnJ1bkFsbCgiYWxsb3V0Iik7Ci8qIOaJi+WFpeWKmyAqLwokKCJtZGF0ZSIpLnZhbHVlPW5ldyBEYXRlKERhdGUubm93KCkrODY0MDAwMDAqMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKJCgid2RhdGUiKS52YWx1ZT0kKCJtZGF0ZSIpLnZhbHVlOyQoInBkYXRlIikudmFsdWU9IjIwMjYtMDYtMjEiOwokKCJtZ28iKS5vbmNsaWNrPSgpPT57CiBjb25zdCBsaW5lcz0kKCJtdGV4dCIpLnZhbHVlLnNwbGl0KC9ccj9cbi8pLm1hcChzPT5zLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pLHJzPVtdLG9kZHM9W107CiBmb3IoY29uc3QgbCBvZiBsaW5lcyl7Y29uc3QgbT1sLm1hdGNoKC9eKFxkezEsMn0pW1xzLOOAgF0rKFxTKz8pKD86W1xzLOOAgF0rKFtcZC5dKykpPyQvKTtpZihtKXtycy5wdXNoKHtuYW1lOm1bMl0saG9yc2U6VUUubm4obVsyXSksam9ja2V5OiIiLGFnZTpudWxsLG51bTorbVsxXX0pO29kZHMucHVzaChtWzNdPyttWzNdOjApfX0KIGlmKHJzLmxlbmd0aDwyKXJldHVybiBhbGVydCgi44CM6aas55WqIOmmrOWQjeOAjeOBruW9ouW8j+OBpzLpoK3ku6XkuIrlhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgIIiKTsKIGNvbnN0IHJhY2U9e2RhdGU6JCgibWRhdGUiKS52YWx1ZSxzdXJmOiskKCJtc3VyZiIpLnZhbHVlLGRpc3Q6KyQoIm1kaXN0IikudmFsdWV8fDAscnVubmVyczpycyxvZGRzMDpvZGRzLmV2ZXJ5KG89Pm8+MSk/b2RkczpudWxsfTsKIHNldFJhY2UocmFjZSxgJHtyYWNlLmRhdGV9IOaJi+WFpeWKm++8iCR7cmFjZS5zdXJmPT09MT8i6IqdIjoi44OA44O844OIIn0ke3JhY2UuZGlzdH1t44O7JHtycy5sZW5ndGh96aCt77yJYCk7Cn07Ci8qIOmBjuWOu+ODrOODvOOCuSAqLwpsZXQgUFJBQ0VTPVtdOwokKCJwZ2V0Iikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBkPSQoInBkYXRlIikudmFsdWU7aWYoIWQpcmV0dXJuOyQoInBzdGF0dXMiKS50ZXh0Q29udGVudD0i5qSc57Si5Lit4oCmIjskKCJwbGlzdCIpLmlubmVySFRNTD0iIjsKIHRyeXsKICBjb25zdCBtYXA9bmV3IE1hcCgpOwogIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKHIuZGF0ZSE9PWR8fCFyLnJhY2VJZClyZXR1cm47aWYoIW1hcC5oYXMoci5yYWNlSWQpKW1hcC5zZXQoci5yYWNlSWQsW10pO21hcC5nZXQoci5yYWNlSWQpLnB1c2gocil9KTsKICBQUkFDRVM9Wy4uLm1hcC5lbnRyaWVzKCldLmZpbHRlcigoWyx2XSk9PnYubGVuZ3RoPj02KS5zb3J0KChhLGIpPT52ZW51ZU9mSWQoYVswXSkubG9jYWxlQ29tcGFyZSh2ZW51ZU9mSWQoYlswXSkpfHxyYWNlTm9PZklkKGFbMF0pLXJhY2VOb09mSWQoYlswXSkpOwogIGlmKCFQUkFDRVMubGVuZ3RoKXskKCJwc3RhdHVzIikudGV4dENvbnRlbnQ9IuOBneOBruaXpeOBruODrOODvOOCueOBr+S/neWtmOODh+ODvOOCv+OBq+OBguOCiuOBvuOBm+OCk+OAgiI7cmV0dXJufQogICQoInBzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtQUkFDRVMubGVuZ3RofeODrOODvOOCuWA7CiAgY29uc3QgbGFiPWlkPT5gJHtWRU5VRVt2ZW51ZU9mSWQoaWQpXXx8dmVudWVPZklkKGlkKX0ke3JhY2VOb09mSWQoaWQpfVJgOwogICQoInBsaXN0IikuaW5uZXJIVE1MPVBSQUNFUy5tYXAoKFtpZCx2XSxrKT0+YDxidXR0b24gZGF0YS1rPSIke2t9Ij4ke2xhYihpZCl977yIJHt2WzBdLnN1cmY9PT0xPyLoip0iOiLjg4AifSR7dlswXS5kaXN0fW3jg7ske3YubGVuZ3Rofemgre+8iTwvYnV0dG9uPmApLmpvaW4oIiIpOwogICQoInBsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9Pntjb25zdCBbaWQsdl09UFJBQ0VTW2IuZGF0YXNldC5rXTsKICAgY29uc3QgcnM9di5maWx0ZXIocj0+ci5ob3JzZSkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKS5tYXAocj0+KHtuYW1lOnIubmFtZXx8ci5ob3JzZSxob3JzZTpyLmhvcnNlLGpvY2tleTpyLmpvY2tleSxqbmFtZTpyLmpuYW1lfHwiIixhZ2U6ci5hZ2UsbnVtOnIubnVtLGFjdDpyLmZpbmlzaCxwb3A6ci5wb3Asb2Rkc0E6ci5vZGRzfSkpOwogICBjb25zdCByYWNlPXtkYXRlOmQsc3VyZjp2WzBdLnN1cmYsZGlzdDp2WzBdLmRpc3QsbHZsOnZbMF0ubHZsfHwwLHJ1bm5lcnM6cnMscGFzdDp0cnVlfTsKICAgc2V0UmFjZShyYWNlLGAke2R9ICR7bGFiKGlkKX3vvIjpgY7ljrvjg6zjg7zjgrnjg7ske3JzLmxlbmd0aH3poK3vvIlgKTt9KTsKIH1jYXRjaChlKXskKCJwc3RhdHVzIikudGV4dENvbnRlbnQ9IuOCqOODqeODvO+8miIrZS5tZXNzYWdlfQp9OwoKLyogLS0tIOino+aekOODu+ihqOekuiAtLS0gKi8KLyog44Op44Oz44Kv44Gv6KOc5q2j5b6M44Gu5aW96LWw546H44Gn5Yik5a6a77yI44Oi44O844OJ44GU44Go44Gr56m044K+44O844Oz44Gu5bmz5Z2H44GM6YGV44GG77ya44Kq44OD44K65YWl5Yqb5pmC44Gv57SEOSXjgIHjgqrjg4PjgrrjgarjgZfjga/ntIQxMyXvvIkgKi8KY29uc3QgQVZHPXtvZGRzOi4wOTEscHJveHk6LjExNX07ICAgLy8g56m044K+44O844Oz44Gu5a6f5ris5bmz5Z2H77yIMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk++8iQpjb25zdCByYXRpbmc9KHAsbW9kZSxuKT0+e2NvbnN0IHI9cC8oQVZHW21vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdKTtsZXQgaz1yPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyI7aWYobjwyJiYoaz09PSJTInx8az09PSJBIikpaz0iQiI7cmV0dXJuIGt9OyAgLy8g5bGl5q2044GMMei1sOS7peS4i+OBr0Ljgb7jgacKLyog5YCZ6KOc44GU44Go44Gu44CM5qC55oug44CN6KGo56S677ya5aW96LWw546H44Go44Gd44Gu6aas44Gu5a6f57i+44GM6aOf44GE6YGV44Gj44Gm6KaL44GI44Gq44GE44KI44GG44CB5a6f57i+44O75Z+65rqW44O76aiO5omL44KS5Lim44G544KLICovCmZ1bmN0aW9uIHJlY0xpbmUoeCl7CiBjb25zdCBwPVtdOwogcC5wdXNoKHguY2FyZWVyJiZ4LmNhcmVlci5uP2DpgJrnrpcke3guY2FyZWVyLm596LWwIDPnnYDlhoUke3guY2FyZWVyLnQzfeWbnu+8iCR7TWF0aC5yb3VuZCh4LmNhcmVlci50My94LmNhcmVlci5uKjEwMCl9Je+8iWA6IumAmueul++8muWxpeattOOBquOBlyIpOwogaWYoeC5yZWNlbnQmJngucmVjZW50Lmxlbmd0aClwLnB1c2goYOebtOi/kSAke3gucmVjZW50LnNsaWNlKC01KS5qb2luKCItIil9552AYCk7CiByZXR1cm4gcC5qb2luKCLvvI8iKTsKfQpmdW5jdGlvbiBiYXNlTGluZSh4KXtyZXR1cm4gYOeptOOCvuODvOODs+OBruW5s+WdhyAke2F2Z05vdGUoeC5tb2RlKX0g4oaSIOOBk+OBrummrOOBryR7KHgucGMvQVZHW3gubW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il0pLnRvRml4ZWQoMSl95YCN77yIU+KJpzIuMuWAje+8j0HiiacxLjflgI3vvI9C4omnMS4z5YCN77yJYH0KZnVuY3Rpb24gam9ja2V5TGluZSh4KXsKIGlmKCF4LmpuYW1lKXJldHVybiAi6aiO5omL77ya6Kqt44G/5Y+W44KM44Gm44GE44G+44Gb44KTIjsKIHJldHVybiB4LmpzdGF0JiZ4LmpzdGF0Lm4+PTU/YOmojuaJi++8miR7eC5qbmFtZX3vvIjpgY7ljrske3guanN0YXQubn3pqI7kuZcgM+edgOWGhSR7TWF0aC5yb3VuZCh4LmpzdGF0LnJhdGUqMTAwKX0l77yJYDpg6aiO5omL77yaJHt4LmpuYW1lfe+8iOmBjuWOu+ODh+ODvOOCv+OBq+ipsuW9k+OBquOBl+OAgeOBvuOBn+OBr+mojuS5l+OBjOWwkeOBquOBhO+8iWA7Cn0KY29uc3QgYXZnTm90ZT1tb2RlPT5tb2RlPT09Im9kZHMiPyLntIQ5JSI6Iue0hDEyJSI7Ci8qIOWxpeattOOBrueFp+WQiOeKtuazge+8iOmmrOWQjeODu+mojuaJi+WQjeOBjOmBjuWOu+ODh+ODvOOCv+OBqOS4gOiHtOOBl+OBn+OBi++8iSAqLwpjb25zdCBtYXRjaEluZm89cmVzPT57Y29uc3Qgbj1yZXMubGVuZ3RoLGg9cmVzLmZpbHRlcih4PT54Lm4+PTIpLmxlbmd0aCxqPXJlcy5maWx0ZXIoeD0+eC5qbj49NSkubGVuZ3RoO3JldHVybntuLGgsaixtaXNzOnJlcy5maWx0ZXIoeD0+eC5qbjw1JiZ4LmpuYW1lKS5tYXAoeD0+eC5qbmFtZSl9fTsKYXN5bmMgZnVuY3Rpb24gcnVuKG9kZHNJbil7CiBpZighQ1VSKXJldHVybjsKIHRyeXsKICBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKENVUi5kYXRlKTsKICBsZXQgb2Rkcz1vZGRzSW58fG51bGw7CiAgaWYoIW9kZHMmJkNVUi5vZGRzMClvZGRzPUNVUi5vZGRzMDsKICBpZighb2RkcyYmQ1VSLnBhc3QmJkNVUi5ydW5uZXJzLmV2ZXJ5KHI9PnIub2Rkc0E+MSkpb2Rkcz1DVVIucnVubmVycy5tYXAocj0+ci5vZGRzQSk7CiAgY29uc3QgcG9wQXJyPSghb2RkcyYmQ1VSLnBhc3QmJkNVUi5ydW5uZXJzLmV2ZXJ5KHI9PnIucG9wPjApKT9DVVIucnVubmVycy5tYXAocj0+ci5wb3ApOm51bGw7CiAgY29uc3QgcmVzPVVFLmFuYWx5emUoQ1VSLHN0b3JlLG9kZHMsbnVsbCxwb3BBcnIpOwogIExBU1RSRVM9e3JlcyxvZGRzLGNvdW50OnN0b3JlLmNvdW50fTtyZW5kZXIoKTsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJvdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7op6PmnpDjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9CmZ1bmN0aW9uIHJlbmRlcigpewogY29uc3R7cmVzLG9kZHMsY291bnR9PUxBU1RSRVMsTj1yZXMubGVuZ3RoLGN1dD1yZXNbMF0uY3V0LHBhc3Q9ISFDVVIucGFzdDsKIGlmKE48Nil7JCgib3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+Numgreacqua6gOOBruOBn+OCgeeptOmmrOWIpOWumuOBruWvvuixoeWkluOBp+OBmeOAgjwvc3Bhbj4nO3JldHVybn0KIGNvbnN0IHVzZWQ9ISFyZXNbMF0ubWt0LGNhbmRzPVVFLnBpY2socmVzLDUpOwogbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7kurrmsJfpoIbvvJoke3VzZWQ/IuWFpeWKm+OCquODg+OCuiI6IuODhOODvOODq+aOqOWumu+8iOmojuaJi+aIkOe4vui+vOOBv+ODu+Wun+mam+OBruS6uuawl+OBqOOBr+eVsOOBquOCiuOBvuOBme+8iSJ977yP56m044K+44O844Oz77yaJHtjdXR955Wq55uu5Lul6ZmN77yI5YWoJHtOfemgre+8ie+8j+Wtpue/kiAke2NvdW50LnRvTG9jYWxlU3RyaW5nKCl96KGMPC9kaXY+YDsKIHtjb25zdCBtPW1hdGNoSW5mbyhyZXMpO2grPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5bGl5q2044Gu54Wn5ZCI77ya6aasICR7bS5ofS8ke20ubn3poK3vvIgy6LWw5Lul5LiK77yJ77yP6aiO5omLICR7bS5qfS8ke20ubn3poK08L2Rpdj5gKyhtLm1pc3MubGVuZ3RoP2A8ZGl2IGNsYXNzPSJzbWFsbCI+6aiO5omL44Gu5pyq54Wn5ZCI77yaJHtlc2MobS5taXNzLnNsaWNlKDAsNikuam9pbigi44CBIikpfSR7bS5taXNzLmxlbmd0aD42PyIg4oCmIjoiIn08L2Rpdj5gOiIiKTtpZihtLmg8bS5uKi41KWgrPWA8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj7imqAg6YGO5Y676LWw44KS54Wn5ZCI44Gn44GN44Gf6aas44GM5bCR44Gq44GE44Gf44KB44CB5LqI5oOz44Gu5L+h6aC85bqm44Gv5L2O44KB44Gn44GZ77yI5paw6aas5oim44O76Iul6aeS5oim44CB44G+44Gf44Gv6aas5ZCN6KGo6KiY44Gu6YGV44GE77yJ44CCPC9kaXY+YH0KIGgrPSI8YnI+IjsKIGlmKCFjYW5kcy5sZW5ndGgpaCs9JzxzcGFuIGNsYXNzPSJ3YXJuIj7nqbTjgr7jg7zjg7PjgavjgIHlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gu5YCZ6KOc44GM44GE44G+44Gb44KT77yI5paw6aas5oim44O76Iul6aeS5oim44Gq44Gp77yJ44CC44GT44Gu44Os44O844K544Gv5a++6LGh5aSW44Gn44GZ44CCPC9zcGFuPic7CiBjYW5kcy5mb3JFYWNoKCh4LGspPT57CiAgY29uc3QgY2hpcHM9eC50YWdzLm1hcCh0PT5gPHNwYW4gY2xhc3M9ImNoaXAgJHt0LmN9Ij4ke2VzYyh0LnQpfTwvc3Bhbj5gKS5qb2luKCIiKTsKICBjb25zdCByPUNVUi5ydW5uZXJzW3guaV07CiAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7aysxfS4gJHtlc2MoeC5ubyl955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgciR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9Ij4ke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfTwvc3Bhbj5gOwogIGlmKHBhc3QpaCs9YCA8c3BhbiBjbGFzcz0ic21hbGwiPuKGkiDntZDmnpwgJHtyLmFjdD8/Ii0ifeedgO+8iCR7ci5wb3A/PyItIn3kurrmsJfvvIkke3IuYWN0PD0zPyIg4pyFIjoiIn08L3NwYW4+YDsKICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOhyA8Yj4keyh4LnBjKjEwMCkudG9GaXhlZCgxKX0lPC9iPu+8iOeptOOCvuODvOODs+W5s+WdhyAke2F2Z05vdGUoeC5tb2RlKX3vvInvvI/kv6HpoLzluqYgJHtlc2MoeC5jb25mKX08YnI+JHtlc2MocmVjTGluZSh4KSl9PGJyPiR7ZXNjKGJhc2VMaW5lKHgpKX08YnI+JHtlc2Moam9ja2V5TGluZSh4KSl9YDsKICBpZih4Lm1rdCE9bnVsbCloKz1gPGJyPuW4guWgtOOBruaDs+WumjPnnYDlhoUgJHsoeC5ta3QqMTAwKS50b0ZpeGVkKDEpfSUg4oaSIOW4guWgtOOBqOOBruW3riAke3gudmFsdWU+PTM/IjPlgI3ku6XkuIoiOngudmFsdWUudG9GaXhlZCgyKSsi5YCNIn3vvIjlj4LogIPvvJrmpJzoqLzjgafjga/lvZPjgZ/jgorjgavntZDjgbPku5jjgY3jgb7jgZvjgpPjgafjgZfjgZ/vvIlgOwogIGgrPWA8L2Rpdj48ZGl2PiR7Y2hpcHN8fCc8c3BhbiBjbGFzcz0ic21hbGwiPuebrueri+OBpOagueaLoOOBquOBlzwvc3Bhbj4nfTwvZGl2PjwvZGl2PmA7CiB9KTsKIGgrPWA8YnI+PGI+5YWo6aCt5LiA6KanPC9iPiR7cGFzdD8i77yI5a6f6Zqb44Gu57WQ5p6c44Gk44GN77yJIjoi77yI5Y2Y5Yud44Kq44OD44K644KS5YWl44KM44KL44Go5aaZ5ZGz44KS6KiI566X77yJIn08dGFibGU+PHRoZWFkPjx0cj48dGg+6aas55WqPC90aD48dGg+6aas5ZCNPC90aD48dGg+6aiO5omLPC90aD48dGg+5aW96LWw546HPC90aD48dGg+6aCG5L2NPC90aD48dGg+44Kq44OD44K6PC90aD4ke3Bhc3Q/Ijx0aD7ntZDmnpw8L3RoPiI6IiJ9PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IHggb2YgcmVzKXtjb25zdCByPUNVUi5ydW5uZXJzW3guaV07CiAgaCs9YDx0ciR7eC5ob2xlPycgc3R5bGU9ImJhY2tncm91bmQ6I2ZmYjgwMDIyIic6Jyd9Pjx0ZD4ke2VzYyh4Lm5vKX08L3RkPjx0ZD4ke2VzYyh4Lm5hbWUpfTwvdGQ+PHRkPiR7ZXNjKHguam5hbWV8fCI/Iil9PC90ZD48dGQ+JHsoeC5wYyoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPiR7eC5yYW5rfTwvdGQ+PHRkPjxpbnB1dCBjbGFzcz0ib2RkcyIgZGF0YS1pPSIke3guaX0iIHR5cGU9Im51bWJlciIgc3RlcD0iMC4xIiBtaW49IjEuMSIgaW5wdXRtb2RlPSJkZWNpbWFsIiB2YWx1ZT0iJHtvZGRzP29kZHNbeC5pXToiIn0iIHN0eWxlPSJ3aWR0aDo2MnB4O3BhZGRpbmc6NHB4Ij48L3RkPiR7cGFzdD9gPHRkPiR7ci5hY3Q/PyItIn3nnYA8L3RkPmA6IiJ9PC90cj5gfQogaCs9YDwvdGJvZHk+PC90YWJsZT48YnV0dG9uIGlkPSJyZWNhbGMiPuOCquODg+OCuuOCkuWPjeaYoOOBl+OBpuWGjeioiOeulzwvYnV0dG9uPjxidXR0b24gaWQ9ImNsZWFyb2RkcyIgY2xhc3M9InN1YiI+44Kq44OD44K644KS44Kv44Oq44KiPC9idXR0b24+YDsKICQoIm91dCIpLmlubmVySFRNTD1oOwogJCgicmVjYWxjIikub25jbGljaz0oKT0+e2NvbnN0IHY9Wy4uLmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiNvdXQgaW5wdXQub2RkcyIpXS5tYXAoZT0+cGFyc2VGbG9hdChlLnZhbHVlKSk7cnVuKHYuZXZlcnkobz0+bz4xKT92Om51bGwpfTsKICQoImNsZWFyb2RkcyIpLm9uY2xpY2s9KCk9PntDVVIub2RkczA9bnVsbDtDVVIucGFzdD1DVVIucGFzdDtMQVNUUkVTPW51bGw7cnVuKG51bGwpfTsKfQokKCJydW4iKS5vbmNsaWNrPSgpPT5ydW4obnVsbCk7CiQoImZpbGUiKS5vbmNoYW5nZT1lPT57Y29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZihmKWltcG9ydEZpbGUoZikudGhlbigoKT0+e2UudGFyZ2V0LnZhbHVlPSIifSl9OwoKLyogLS0tIOaJleaIu+ODu+aciOOBruWPluW+l+eKtuazge+8iEluZGV4ZWREQu+8iSAtLS0gKi8KY29uc3QgcGF5QWxsPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigicGF5Iikub2JqZWN0U3RvcmUoInBheSIpLmdldEFsbCgpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgcGF5UHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigicGF5IiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgicGF5IikucHV0KHYsayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgbWV0YUdldD1rPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigibWV0YSIpLm9iamVjdFN0b3JlKCJtZXRhIikuZ2V0KGspO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdCk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBtZXRhUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigibWV0YSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoIm1ldGEiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwphc3luYyBmdW5jdGlvbiBwYXlTdGF0ZSgpe2F3YWl0IHNob3dTdGF0ZSgpfQoKLyogLS0tIOWFsemAmuOBruWPluW+l++8iOWGjeippuihjOOBpOOBje+8iSAtLS0gKi8KbGV0IFNZTkNJTkc9ZmFsc2U7CmFzeW5jIGZ1bmN0aW9uIGZldGNoSlNPTih1cmwsd2FpdHNBcmcpewogbGV0IGVycj0iIjtjb25zdCB3YWl0cz13YWl0c0FyZ3x8d2luZG93Ll9fV0FJVFN8fFs0MDAwLDEyMDAwLDMwMDAwLDYwMDAwXTsKIGZvcihsZXQgdD0wO3Q8PXdhaXRzLmxlbmd0aDt0KyspewogIHRyeXsKICAgY29uc3Qgcj1hd2FpdCBmZXRjaCh1cmwpO2NvbnN0IHR4dD1hd2FpdCByLnRleHQoKTtsZXQgeD17fTt0cnl7eD1KU09OLnBhcnNlKHR4dCl9Y2F0Y2goZSl7fQogICBpZighci5va3x8eC5vaz09PWZhbHNlKXtjb25zdCBlPW5ldyBFcnJvcih4LmVycm9yfHxgSFRUUCAke3Iuc3RhdHVzfWArKHR4dCYmIXguZXJyb3I/YO+8iCR7dHh0LnJlcGxhY2UoL1xzKy9nLCIgIikuc2xpY2UoMCw1MCl977yJYDoiIikpO2Uuc3RhdHVzPXIuc3RhdHVzO3Rocm93IGV9CiAgIHJldHVybiB4OwogIH1jYXRjaChlKXsKICAgZXJyPWUubWVzc2FnZTtjb25zdCByZXRyeT0hZS5zdGF0dXN8fGUuc3RhdHVzPj01MDB8fGUuc3RhdHVzPT09NDI5OwogICBpZighcmV0cnl8fHQ9PT13YWl0cy5sZW5ndGgpYnJlYWs7CiAgIGlmKFNZTkNJTkcpJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWDmt7fpm5Hjga7jgZ/jgoEke01hdGgucm91bmQod2FpdHNbdF0vMTAwMCl956eS5b6F44Gj44Gm5YaN6Kmm6KGM44GX44G+44GZ4oCm77yIJHtlcnJ977yJYDsKICAgYXdhaXQgc2xlZXAod2FpdHNbdF0pOwogIH0KIH0KIHRocm93IG5ldyBFcnJvcihlcnIpOwp9CmNvbnN0IE1PREVMX1RSQUlOX0VORD0iMjAyNi0wNi0yMiI7ICAgLy8g54++5Zyo44Gu44Oi44OH44Or44Gv44CB44GT44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gn5a2m57+SCmNvbnN0IGpzdFllc3RlcmRheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMy04NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgYWRkRGF5cz0oZCxuKT0+bmV3IERhdGUobmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKStuKjg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpmdW5jdGlvbiBtb250aHNCZXR3ZWVuKGEsYil7Y29uc3Qgb3V0PVtdO2xldFt5LG1dPWEuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpO2NvbnN0W3kyLG0yXT1iLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTsKIHdoaWxlKHk8eTJ8fCh5PT09eTImJm08PW0yKSl7b3V0LnB1c2goYCR7eX0tJHtTdHJpbmcobSkucGFkU3RhcnQoMiwiMCIpfWApO20rKztpZihtPjEyKXttPTE7eSsrfX1yZXR1cm4gb3V0fQoKLyogLS0tIOKRoCDjg4fjg7zjgr/lj5blvpfvvJrpgY7ljrvmiJDnuL7vvIjkurrmsJfjgaTjgY3vvInvvIvmiZXmiLvjgpLjgIHplovlgqzml6XjgZTjgajjgavlj5blvpfjgZfjgabkv53lrZggLS0tICovCmNvbnN0IFNZTkNfQkFUQ0g9NCxTWU5DX1BBUkFMTEVMPTI7CmxldCBTU1RPUD1mYWxzZSxCQUNLVVBfREFURVM9bnVsbDsKJCgic3luY1N0b3AiKS5vbmNsaWNrPSgpPT57U1NUT1A9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWV9OwokKCJzZW5kIikudmFsdWU9anN0WWVzdGVyZGF5KCk7CmFzeW5jIGZ1bmN0aW9uIGJhY2t1cERhdGVzKCl7CiBpZihCQUNLVVBfREFURVMpcmV0dXJuIEJBQ0tVUF9EQVRFUzsKIGNvbnN0IHM9bmV3IFNldCgpLGZzPWF3YWl0IGlkYkFsbCgpOwogZm9yKGNvbnN0IGYgb2YgZnMpe2lmKGYubGl2ZSljb250aW51ZTtmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSl7Y29uc3QgZD1VRS5wYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSk7aWYoZClzLmFkZChkKX1hd2FpdCBzbGVlcCgwKX0KIHJldHVybiBCQUNLVVBfREFURVM9czsKfQphc3luYyBmdW5jdGlvbiBmZXRjaERheShiYXNlLGQpewogY29uc3QgZGF5PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5P2RhdGU9JHtkfWApOwogY29uc3QgcmFjZXM9ZGF5LnJhY2VzfHxbXTtpZighcmFjZXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIik7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSs9U1lOQ19CQVRDSCljaHVua3MucHVzaChyYWNlcy5zbGljZShpLGkrU1lOQ19CQVRDSCkubWFwKHg9PnguY25hbWUpKTsKIGNvbnN0IHJvd3M9W10scGF5b3V0cz1bXTtsZXQgaWR4PTAsZmFpbGVkTj0wOwogY29uc3Qgd29ya2VyPWFzeW5jKCk9Pnt3aGlsZShpZHg8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1pZHgrKzsKICBjb25zdCByZXM9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1yZXN1bHRzP2NuYW1lcz0ke2NodW5rc1trXS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCk7CiAgcm93cy5wdXNoKC4uLihyZXMucm93c3x8W10pKTtwYXlvdXRzLnB1c2goLi4uKHJlcy5wYXlvdXRzfHxbXSkpO2ZhaWxlZE4rPShyZXMuZmFpbGVkfHxbXSkubGVuZ3RofX07CiBhd2FpdCBQcm9taXNlLmFsbChBcnJheS5mcm9tKHtsZW5ndGg6TWF0aC5taW4oU1lOQ19QQVJBTExFTCxjaHVua3MubGVuZ3RoKX0sd29ya2VyKSk7CiBjb25zdCBnb3Q9bmV3IFNldChyb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemU7CiBmYWlsZWROPU1hdGgubWF4KGZhaWxlZE4scmFjZXMubGVuZ3RoLWdvdCk7CiByZXR1cm57cm93cyxwYXlvdXRzLGZhaWxlZE4scmFjZXM6cmFjZXMubGVuZ3RofTsKfQokKCJzeW5jR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogY29uc3QgYT0kKCJzc3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpO2xldCBiPSQoInNlbmQiKS52YWx1ZXx8eWQ7aWYoYj55ZCliPXlkOwogaWYoYT5iKXskKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IumWi+Wni+aXpeOBjOe1guS6huaXpeOCiOOCiuW+jOOBp+OBmeOAgiI7cmV0dXJufQogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoInN5bmNHbyIpLmRpc2FibGVkPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD1mYWxzZTsKIGNvbnN0IHN0PXtkYXlzOjAscmFjZXM6MCxza2lwcGVkOjAsZmFpbDpbXSx0MDpEYXRlLm5vdygpfTtsZXQgY29uc2VjPTA7CiB0cnl7CiAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLkv53lrZjmuIjjgb/jg4fjg7zjgr/jgpLnorroqo3kuK3igKYiOwogIGNvbnN0IGZpbGVzPWF3YWl0IGlkYkFsbCgpLGhhdmVMaXZlPW5ldyBTZXQoZmlsZXMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkubWFwKGY9PmYuZGF0ZSkpOwogIGNvbnN0IGhhdmVQYXk9bmV3IFNldCgoYXdhaXQgcGF5QWxsKCkpLmZpbHRlcihwPT4hcC5mYWlsZWQpLm1hcChwPT5wLmRhdGUpKTsKICBjb25zdCBiaz1hd2FpdCBiYWNrdXBEYXRlcygpOwogIGNvbnN0IG1vbnRocz1tb250aHNCZXR3ZWVuKGEsYiksY3VyTW9udGg9eWQuc2xpY2UoMCw3KTsKICBmb3IobGV0IG1pPTA7bWk8bW9udGhzLmxlbmd0aDttaSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgbW9udGg9bW9udGhzW21pXTsKICAgaWYobW9udGg8Y3VyTW9udGgmJmF3YWl0IG1ldGFHZXQoIm1vbnRoOiIrbW9udGgpKXtjb250aW51ZX0KICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke21vbnRofe+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iemWi+WCrOaXpeOCkueiuuiqjeS4reKApiDlj5blvpfmuIjjgb8ke3N0LmRheXN95pelYDsKICAgbGV0IGRheXM7dHJ5e2RheXM9KGF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5cz9tb250aD0ke21vbnRofWApKS5kYXlzfHxbXTtjb25zZWM9MH1jYXRjaChlKXtzdC5mYWlsLnB1c2goYCR7bW9udGh977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICBkYXlzPWRheXMuZmlsdGVyKGQ9PmQ+PWEmJmQ8PWIpO2xldCBtb250aE9rPXRydWU7CiAgIGZvcihjb25zdCBkIG9mIGRheXMpewogICAgaWYoU1NUT1Ape21vbnRoT2s9ZmFsc2U7YnJlYWt9CiAgICBjb25zdCBuZWVkUm93cz0haGF2ZUxpdmUuaGFzKGQpJiYhYmsuaGFzKGQpLG5lZWRQYXk9IWhhdmVQYXkuaGFzKGQpOwogICAgaWYoIW5lZWRSb3dzJiYhbmVlZFBheSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfQogICAgY29uc3QgZWw9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS1zdC50MCkvMTAwMCk7CiAgICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZH0g44KS5Y+W5b6X5Lit77yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJXG7lj5blvpcke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmA7CiAgICB0cnl7CiAgICAgY29uc3Qgcj1hd2FpdCBmZXRjaERheShiYXNlLGQpOwogICAgIGlmKHIuZmFpbGVkTil7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvIgke3IuZmFpbGVkTn1S5aSx5pWX77yJYCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICAgIGlmKG5lZWRSb3dzKXthd2FpdCBpZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTtoYXZlTGl2ZS5hZGQoZCl9CiAgICAgYXdhaXQgcGF5UHV0KGQse2RhdGU6ZCxyYWNlczpyLnBheW91dHMsZmFpbGVkOjB9KTtoYXZlUGF5LmFkZChkKTsKICAgICBzdC5kYXlzKys7c3QucmFjZXMrPXIucmFjZXM7Y29uc2VjPTA7CiAgICB9Y2F0Y2goZSl7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9fQogICAgYXdhaXQgc2xlZXAoNDAwKTsKICAgfQogICBpZihtb250aE9rJiZtb250aDxjdXJNb250aClhd2FpdCBtZXRhUHV0KCJtb250aDoiK21vbnRoLHRydWUpOwogIH0KIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goU3RyaW5nKGUubWVzc2FnZXx8ZSkpfQogZmluYWxseXsKICBTWU5DSU5HPWZhbHNlO1NUT1JFPW51bGw7U1RPUkVfS0VZPSIiOyQoInN5bmNHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICAkKCJzeW5jU3RhdHVzIikuaW5uZXJIVE1MPWAke3N0LnN0b3BwZWQ/IumAo+e2muOBl+OBpuWkseaVl+OBl+OBn+OBn+OCgeS4reaWreOBl+OBvuOBl+OBn++8iENsb3VkZmxhcmXlgbTjga7mt7fpm5Hjg7vliLbpmZDjga7lj6/og73mgKfvvInjgILlsJHjgZfmmYLplpPjgpLjgYrjgYTjgabjgoLjgYbkuIDluqbmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJcbiI6IiJ9JHtTU1RPUCYmIXN0LnN0b3BwZWQ/IuWBnOatouOBl+OBvuOBl+OBn+OAgiI6KHN0LnN0b3BwZWQ/IiI6IuWujOS6huOAgiIpfeS7iuWbnuOBruWPluW+l++8miR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yI5L+d5a2Y5riI44G/44Gn44K544Kt44OD44OXICR7c3Quc2tpcHBlZH3ml6XvvIlgKyhzdC5mYWlsLmxlbmd0aD9gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIifVxu77yI44KC44GG5LiA5bqm5oq844GZ44Go44CB5aSx5pWX44GX44Gf5pel44Gg44GR44KE44KK55u044GX44G+44GZ77yJPC9zcGFuPmA6IiIpOwogIGF3YWl0IHNob3dTdGF0ZSgpOwogfQp9OwoKLyogLS0tIOaJleaIu+OBruabuOOBjeWHuuOBl+ODu+iqreOBv+i+vOOBvyAtLS0gKi8KJCgicGF5RXhwIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXJldHVybiBhbGVydCgi5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIik7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocHMpXSx7dHlwZToiYXBwbGljYXRpb24vanNvbiJ9KSk7CiBhLmRvd25sb2FkPWBrZWliYV9wYXlvdXRzXyR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApfS5qc29uYDthLmNsaWNrKCk7c2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApfTsKJCgicGF5SW1wIikub25jaGFuZ2U9YXN5bmMgZT0+ewogY29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZighZilyZXR1cm47CiB0cnl7Y29uc3Qgaj1KU09OLnBhcnNlKGF3YWl0IGYudGV4dCgpKTtjb25zdCBhcnI9QXJyYXkuaXNBcnJheShqKT9qOihqLnJhY2VzP1tqXTpbXSk7CiAgY29uc3QgYnlEYXRlPW5ldyBNYXAoKTsKICBmb3IoY29uc3QgeCBvZiBhcnIpe2lmKHgmJkFycmF5LmlzQXJyYXkoeC5yYWNlcykmJnguZGF0ZSlieURhdGUuc2V0KHguZGF0ZSx7ZGF0ZTp4LmRhdGUscmFjZXM6eC5yYWNlcyxmYWlsZWQ6eC5mYWlsZWR8fDB9KX0KICBmb3IoY29uc3RbZCxyXW9mIGJ5RGF0ZSlhd2FpdCBwYXlQdXQoZCxyKTsKICBhd2FpdCBzaG93U3RhdGUoKTsKIH1jYXRjaChlcnIpeyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+6Kqt44G/6L6844G/44Ko44Op44O877yaJHtlc2MoZXJyLm1lc3NhZ2UpfTwvc3Bhbj5gfQogZS50YXJnZXQudmFsdWU9IiI7Cn07CgovKiAtLS0g4pGgLTIg6KSH5Yud5Zue5Y+O546H44Gu5qSc6Ki8IC0tLSAqLwokKCJidFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogdHJ5ewogIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CC5YWI44Gr4pGg44Gn5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHBheUJ5SWQ9e307cHMuZm9yRWFjaChwPT4ocC5yYWNlc3x8W10pLmZvckVhY2goeD0+e3BheUJ5SWRbeC5yYWNlSWRdPXh9KSk7CiAgY29uc3Qgc3RhcnQ9JCgiYnRTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSI7CiAgY29uc3QgcGRhdGVzPXBzLm1hcChwPT5wLmRhdGUpLmZpbHRlcihkPT5kPj1zdGFydCkuc29ydCgpOwogIGlmKCFwZGF0ZXMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumWi+Wni+aXpeS7pemZjeOBruaJleaIu+OBjOOBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBzcGxpdD1wZGF0ZXNbTWF0aC5mbG9vcihwZGF0ZXMubGVuZ3RoLzIpXTsKICBidXN5KHRydWUsIuaIkOe4vuOCkuiqreOBv+i+vOOBv+S4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBtYXA9bmV3IE1hcCgpOwogIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKICBidXN5KHRydWUsIuODkOODg+OCr+ODhuOCueODiOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvdXQ9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7c3RhcnQsc3BsaXQsb29zOk1PREVMX1RSQUlOX0VORH0pOwogIGJ1c3kodHJ1ZSwi44Kq44OD44K65pyq5YWl5Yqb44Gu5aC05ZCI44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dFA9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7c3RhcnQsc3BsaXQsb29zOk1PREVMX1RSQUlOX0VORCxwcm94eTp0cnVlfSk7YnVzeShmYWxzZSk7CiAgY29uc3QgTD17dG9wMToi44OE44O844OrMeS9jSIsdG9wMjoi5LiK5L2NMumgrSIsdG9wMzoi5LiK5L2NM+mgrSIsYWxsSG9sZToi56m044K+44O844Oz5YWo6aCt77yI5Z+65rqW77yJIix2YWx1ZToi5aaZ5ZGzMS4z5YCN5Lul5LiKIixheGlzOiLpiYTmnb/ou7jvvIgwLjky5Lul5LiK44O744Kq44OD44K65pmC77yJIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl9PC9zcGFuPmA6Ii0iOwogIGNvbnN0IHRibD0obyx0aXRsZSk9PnsKICAgbGV0IHQ9YDxiPiR7dGl0bGV9PC9iPjxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvLnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48dGg+5a2m57+S5b6MPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW8uc3RhdHNba107aWYoIXYuYWxsLmJldHMpY29udGludWU7CiAgICB0Kz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkMuYmV0cz9gJHtwY3Qodi5DLnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHYuQy5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt2LkMuYmV0cy50b0xvY2FsZVN0cmluZygpfe+8iTwvc3Bhbj5gOiItIn08L3RkPjwvdHI+YH0KICAgcmV0dXJuIHQrIjwvdGJvZHk+PC90YWJsZT4ifTsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPiR7c3RhcnR944Cc77yP5YmN5Y2K77ydJHtzcGxpdH3jgojjgorliY3jgIHlvozljYrvvJ3ku6XpmY3vvI/lkIQxMDDlhoY8L2Rpdj48YnI+YCt0Ymwob3V0LCLikaAg44Kq44OD44K65YWl5Yqb5pmC77yI5a6f6Zqb44Gu5Lq65rCX44Gn56m044K+44O844Oz44KS5Yik5a6a77yJIikrIjxicj4iK3RibChvdXRQLCLikaEg44Kq44OD44K65pyq5YWl5Yqb5pmC77yI44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgLy8g5p2h5Lu25Yil77yI44OE44O844OrMeS9jeOBruWbnuWPjueOh++8iQogIGNvbnN0IHNlZ1Jvd3M9T2JqZWN0LmVudHJpZXMob3V0LnNlZ3MpLmZpbHRlcigoWyx2XSk9PnYuYWxsLmJldHM+PTMwMCkuc29ydCgoYSxiKT0+YVswXTxiWzBdPy0xOjEpOwogIGlmKHNlZ1Jvd3MubGVuZ3RoKXtoKz1gPGJyPjxiPuKRoiDjg4Tjg7zjg6sx5L2N44Gu5p2h5Lu25Yil77yI4pGg44Gu5aC05ZCI77yJPC9iPjxkaXYgY2xhc3M9InNtYWxsIj7os7zlhaUzMDDlm57ku6XkuIrjga7mnaHku7bjga7jgb/jgILliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+5p2h5Lu2PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IFtrLHZdIG9mIHNlZ1Jvd3MpaCs9YDx0cj48dGQ+JHtlc2Moayl9PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+In0KICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxicj7opovmlrnvvJrjgIzlrabnv5LlvozjgI3jga/jgIHjg6Ljg4fjg6vjga7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIgke01PREVMX1RSQUlOX0VORH3ku6XpmY3vvInjgafjgIHmnIDjgoLkv6HpoLzjgafjgY3jgovliJfjgafjgZnjgILjgZ3jgozku6XliY3jga7mnJ/plpPjga/jgIHjg6Ljg4fjg6vjgYznrZTjgYjjgpLopovjgabjgYTjgovjgZ/jgoHjgIHjgoTjgoToia/jgY/lh7rjgb7jgZnjgILlm57lj47njofjga7jgIzCseOAjeOBrzk1JeOBruiqpOW3ruOBruW5heOBp+OAgTEwMCXjgpLkuIvlm57jgovkuIvpmZDjgarjgonliKnnm4rjgajjga/oqIDjgYjjgb7jgZvjgpPjgILmnaHku7bliKXjga/jgIHmjqLjgZnjgbvjganlgbbnhLbjga7pq5jjgYTmnaHku7bjgpLmi77jgYTjgoTjgZnjgYTjga7jgafjgIHliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jga7jgoLjga7jgaDjgZHjgpLlj4LogIPjgavjgZfjgabjgY/jgaDjgZXjgYTjgILlppnlkbPvvIjluILloLTjgajjga7lt67vvInjga/jgIHmpJzoqLzjgafln7rmupbjgojjgormgqrjgYvjgaPjgZ/jgZ/jgoHjgIHliKTmlq3jgavjga/kvb/jgo/jgarjgYTjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogICQoImJ0T3V0IikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOOCquODg+OCuuWPluW+l++8iC9qcmEtb2Rkc++8muW9k+aXpeODu+WJjeaXpeWjsuOCiuOBruWNmOWLneOCquODg+OCuu+8iSAtLS0gKi8KbGV0IE9ERFM9e307CmZ1bmN0aW9uIG9kZHNGb3IocmFjZSl7CiBjb25zdCBtPXJhY2UmJnJhY2Uua2V5P09ERFNbcmFjZS5rZXldOm51bGw7aWYoIW0pcmV0dXJuIG51bGw7CiBjb25zdCBhcnI9cmFjZS5ydW5uZXJzLm1hcChyPT5tW3IubnVtXSk7cmV0dXJuIGFyci5ldmVyeShvPT5vPjEpP2FycjpudWxsOwp9Ci8qIOOCquODg+OCuuWPluW+l++8muKRoOWHuummrOihqOOBi+OCieaLvuOBo+OBn+OCquODg+OCuueUu+mdouOCkuebtOaOpeiqreOCgCDihpIg4pGh5Y+W44KM44Gq44GL44Gj44Gf44Os44O844K544Gg44GR44CB44Oh44OL44Ol44O857WM55Sx44Gn6KOc44GG44CCCiAgIOabtOaWsOOBruOBqOOBjeOAgeWPluW+l+OBq+WkseaVl+OBl+OBn+ODrOODvOOCueOBruWJjeWbnuOBruOCquODg+OCuuOBr+a2iOOBleOBquOBhOOAgiAqLwpsZXQgT0REU19ESUFHPSIiOwphc3luYyBmdW5jdGlvbiBmZXRjaE9kZHMoKXsKIGlmKCFXUkFDRVMubGVuZ3RoKXJldHVybntnb3Q6MCx0b3RhbDowfTsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpLGQ9V0RBVEUsa2V5T2Y9cj0+YCR7U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpfS0ke051bWJlcihyLnJhY2VOdW1iZXIpfHwwfWA7CiBsZXQgZGlhZz1bXSxlcnI9IiI7CiAvLyDikaAg55u05o6l77yI5Ye66aas6KGo44Gr44Oq44Oz44Kv44GM44GC44KL44Os44O844K577yJCiBjb25zdCB3aXRoTGluaz1XUkFDRVMuZmlsdGVyKHI9PnIub2Rkc0NuYW1lKSxieUNuYW1lPW5ldyBNYXAod2l0aExpbmsubWFwKHI9PltyLm9kZHNDbmFtZSxyXSkpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8d2l0aExpbmsubGVuZ3RoO2krPTYpY2h1bmtzLnB1c2god2l0aExpbmsuc2xpY2UoaSxpKzYpLm1hcChyPT5yLm9kZHNDbmFtZSkpOwogbGV0IGNpPTA7CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGNpPGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9Y2krKzsKICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gLFsxNTAwXSk7CiAgIGZvcihjb25zdCBpdCBvZiAoeC5pdGVtc3x8W10pKXtjb25zdCByPWJ5Q25hbWUuZ2V0KGl0LmNuYW1lKTtpZihyKU9ERFNba2V5T2YocildPWl0Lm9kZHN9CiAgIGlmKCh4LmZhaWxlZHx8W10pLmxlbmd0aClkaWFnLnB1c2goLi4ueC5mYWlsZWQuc2xpY2UoMCwyKS5tYXAoZj0+Zi5yZWFzb24pKTsKICAgaWYoeC5zYW1wbGUmJiFPRERTX0RJQUcpT0REU19ESUFHPSLnlLvpnaLjga7kuIDpg6jvvJoiK1N0cmluZyh4LnNhbXBsZSkuc2xpY2UoMCwyNjApOwogIH1jYXRjaChlKXtlcnI9ZS5tZXNzYWdlfX19OwogYXdhaXQgUHJvbWlzZS5hbGwoW3dvcmtlcigpLHdvcmtlcigpXSk7CiAvLyDikaEg5Y+W44KM44Gq44GL44Gj44Gf44Os44O844K544KS44CB5pel5LuY44O76ZaL5YKs5aC044Gu44Oh44OL44Ol44O857WM55Sx44Gn6KOc44GGCiBjb25zdCBtaXNzaW5nPVdSQUNFUy5maWx0ZXIocj0+IU9ERFNba2V5T2YocildKTsKIGlmKG1pc3NpbmcubGVuZ3RoKXsKICBjb25zdCB2ZW51ZXM9Wy4uLm5ldyBTZXQobWlzc2luZy5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKTsKICBmb3IoY29uc3QgdiBvZiB2ZW51ZXMpewogICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/ZGF0ZT0ke2R9JnZlbnVlPSR7dn1gLFsxNTAwXSk7CiAgICBmb3IoY29uc3QgciBvZiAoeC5yYWNlc3x8W10pKU9ERFNbYCR7U3RyaW5nKHIudmVudWVDb2RlKS5wYWRTdGFydCgyLCIwIil9LSR7ci5yYWNlTm99YF09ci5vZGRzOwogICAgaWYoISh4LnJhY2VzfHxbXSkubGVuZ3RoKWRpYWcucHVzaCguLi4oeC5kaWFnbm9zdGljc3x8W10pLnNsaWNlKDAsNCkubWFwKHo9PnR5cGVvZiB6PT09InN0cmluZyI/ejpKU09OLnN0cmluZ2lmeSh6KSkpOwogICB9Y2F0Y2goZSl7ZXJyPWUubWVzc2FnZTtkaWFnLnB1c2goZS5tZXNzYWdlKX19CiB9CiBjb25zdCBnb3Q9V1JBQ0VTLmZpbHRlcihyPT5PRERTW2tleU9mKHIpXSkubGVuZ3RoOwogT0REU19ESUFHPWdvdD8iIjooT0REU19ESUFHKyhlcnI/Iu+8j+eQhueUse+8miIrZXJyOiIiKSsoZGlhZy5sZW5ndGg/Iu+8j+iouuaWre+8miIrWy4uLm5ldyBTZXQoZGlhZyldLmpvaW4oIiB8ICIpLnNsaWNlKDAsNTAwKToiIikpOwogcmV0dXJue2dvdCx0b3RhbDpXUkFDRVMubGVuZ3RofTsKfQokKCJvZGRzR2V0Iikub25jbGljaz1hc3luYygpPT57CiBpZighV1JBQ0VTLmxlbmd0aClyZXR1cm47CiAkKCJvZGRzR2V0IikuZGlzYWJsZWQ9dHJ1ZTtPRERTX0RJQUc9IiI7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLjgqrjg4Pjgrrlj5blvpfkuK3igKYiOwogdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2hPZGRzKCk7CiAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6X77yP44Kq44OD44K6ICR7ci5nb3R944Os44O844K55YiGYCsoci5nb3Q/IiI6Ilxu44Kq44OD44K644KS5Y+W5b6X44Gn44GN44G+44Gb44KT44Gn44GX44Gf77yI55m65aOy5YmN44CB44G+44Gf44Gv55S76Z2i5qeL6YCg44Gu6YGV44GE77yJ44CCIisoT0REU19ESUFHPyJcbiIrT0REU19ESUFHOiIiKSk7CiB9ZmluYWxseXskKCJvZGRzR2V0IikuZGlzYWJsZWQ9ZmFsc2V9CiByZW5kZXJWZW51ZUJ1dHRvbnMoV0RBVEUpOwp9OwoKLyogLS0tIOKYhSDmnKzml6Xjga7lpb3otbDnqbTppqzvvIjjg6/jg7Pjgr/jg4Pjg5fvvIkgLS0tICovCmNvbnN0IGpzdFRvZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwokKCJ0ZGF0ZSIpLnZhbHVlPWpzdFRvZGF5KCk7CiQoInRvZGF5R28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgidGRhdGUiKS52YWx1ZTtpZighZClyZXR1cm47CiAkKCJ0b2RheUdvIikuZGlzYWJsZWQ9dHJ1ZTskKCJ0b2RheU91dCIpLmlubmVySFRNTD0iIjskKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PSLlh7rppqzooajjgpLlj5blvpfkuK3igKYiOwogdHJ5ewogICQoIndkYXRlIikudmFsdWU9ZDthd2FpdCAkKCJ3Z2V0Iikub25jbGljaygpOwogIGlmKCFXUkFDRVMubGVuZ3RoKXsKICAgJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD0kKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ7CiAgIGlmKEFWQUlMLmxlbmd0aCl7JCgidG9kYXlPdXQiKS5pbm5lckhUTUw9QVZBSUwubWFwKHg9PmA8YnV0dG9uIGNsYXNzPSJzdWIiIGRhdGEtZD0iJHt4fSI+JHt4fTwvYnV0dG9uPmApLmpvaW4oIiIpOwogICAgJCgidG9kYXlPdXQiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1kXSIpLmZvckVhY2goYnQ9PmJ0Lm9uY2xpY2s9KCk9PnskKCJ0ZGF0ZSIpLnZhbHVlPWJ0LmRhdGFzZXQuZDskKCJ0b2RheUdvIikuY2xpY2soKX0pfQogICByZXR1cm59CiAgJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l+OAguOCquODg+OCuuOCkueiuuiqjeS4reKApmA7CiAgYXdhaXQgJCgib2Rkc0dldCIpLm9uY2xpY2soKTsKICBjb25zdCBuPU9iamVjdC5rZXlzKE9ERFMpLmxlbmd0aDsKICAkKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K577yP44Kq44OD44K6ICR7bn3jg6zjg7zjgrnliIZgKyhuPyIiOiLvvIjjgqrjg4PjgrrmnKrlj5blvpfvvJrjg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIkiKTsKICBhd2FpdCBydW5BbGwoInRvZGF5T3V0Iik7VE9EQVlfU0hPV049dHJ1ZTthdXRvU3RhcnQoKTsKIH1jYXRjaChlKXskKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PSLjgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KIGZpbmFsbHl7JCgidG9kYXlHbyIpLmRpc2FibGVkPWZhbHNlfQp9OwokKCJ0b2RheVVwZCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD0i5a2m57+S44OH44O844K/44Gu5pyA57WC5pel44KS56K66KqN5Lit4oCmIjsKIGxldCBtPSIiO2F3YWl0IGZvckVhY2hSb3cocj0+e2lmKHIuZGF0ZT5tKW09ci5kYXRlfSk7CiBjb25zdCBmcm9tPW0/YWRkRGF5cyhtLDEpOiIyMDIzLTAxLTAxIix0bz1qc3RZZXN0ZXJkYXkoKTsKIGlmKGZyb20+dG8peyQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YOWtpue/kuODh+ODvOOCv+OBr+OBmeOBp+OBq+acgOaWsOOBp+OBme+8iOacgOe1guaXpSAke21977yJ44CCYDtyZXR1cm59CiAkKCJzc3RhcnQiKS52YWx1ZT1mcm9tOyQoInNlbmQiKS52YWx1ZT10bzsKICQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZnJvbX3jgJwke3RvfSDjga7miJDnuL7jgpLlj5blvpfjgZfjgb7jgZnjgILpgLLmjZfjga/jgIzikaAg44OH44O844K/5Y+W5b6X44CN44Gu5qyE44Gr5Ye644G+44GZ44CCYDsKICQoInN5bmNHbyIpLmNsaWNrKCk7JCgic3luY1N0YXR1cyIpLnNjcm9sbEludG9WaWV3KHtiZWhhdmlvcjoic21vb3RoIn0pOwp9OwoKLyogLS0tIOKRpCDpiYTmnb/ou7jppqwgLyDikaUg5YWo44Os44O844K544Gu5rOi5Lmx5bqm77yI56m06aas5LqI5oOz44Go44Gv5Yil44Gu6KiI566X77yJIC0tLSAqLwpjb25zdCBHUkFERV9DT0xPUj17U1NTOiIjZDkyZDIwIixTUzoiI2YwNDQzOCIsUzoiI2Y3OTAwOSIsQToiIzE2NjdkOSIsQjoiIzY2NzA4NSIsQzoiIzk4YTJiMyJ9Owpjb25zdCBHUkFERV9PUkRFUj1bIlNTUyIsIlNTIiwiUyIsIkEiLCJCIiwiQyJdOwokKCJhZGF0ZSIpLnZhbHVlPWpzdFRvZGF5KCk7CmZ1bmN0aW9uIHJhY2VMYWJlbChyLG4pe3JldHVybiBgJHtyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiJ9JHtyLnJhY2VOdW1iZXJ8fCIifVIgJHtyLnJhY2VOYW1lfHwiIn3vvIgke3Iuc3VyZmFjZXx8Ij8ifSR7ci5kaXN0YW5jZXx8Ij8ifW3jg7ske2596aCt77yJYH0KYXN5bmMgZnVuY3Rpb24gcmVuZGVyQXhpc1Vwc2V0KGQpewogY29uc3Qgc3RvcmU9YXdhaXQgYnVpbGRTdG9yZShkKTsKIGNvbnN0IHJzPVsuLi5XUkFDRVNdLnNvcnQoKGEsYik9PlN0cmluZyhhLnZlbnVlQ29kZXx8YS52ZW51ZU5hbWV8fCIiKS5sb2NhbGVDb21wYXJlKFN0cmluZyhiLnZlbnVlQ29kZXx8Yi52ZW51ZU5hbWV8fCIiKSl8fChhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKIGNvbnN0IGNudD17fTtHUkFERV9PUkRFUi5mb3JFYWNoKGc9PmNudFtnXT0wKTsKIGNvbnN0IHVwUm93cz1bXSxheFJvd3M9W107bGV0IHdpdGhPZGRzPTAsc2tpcHBlZD0wOwogZm9yKGNvbnN0IHIgb2YgcnMpewogIGNvbnN0IHJhY2U9bWtSYWNlKHIsZCksbj1yYWNlLnJ1bm5lcnMubGVuZ3RoOwogIGlmKG48Nil7c2tpcHBlZCsrO2NvbnRpbnVlfQogIGNvbnN0IG9kPW9kZHNGb3IocmFjZSksYXA9VUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2QpOwogIGNvbnN0IGc9VUUudXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kLGFwKTtjbnRbZy5ncmFkZV0rKztpZihvZCl3aXRoT2RkcysrOwogIHVwUm93cy5wdXNoKHtsYWJlbDpyYWNlTGFiZWwocixuKSxnfSk7CiAgY29uc3QgcGlja3M9b2Q/VUUuYXhpc1BpY2tzKHJhY2Usc3RvcmUsb2QsYXApOm51bGw7CiAgaWYocGlja3MpZm9yKGNvbnN0IHggb2YgcGlja3MpYXhSb3dzLnB1c2goe2xhYmVsOnJhY2VMYWJlbChyLG4pLHgsbmFtZTpyYWNlLnJ1bm5lcnNbeC5pXS5uYW1lLG5vOnJhY2UucnVubmVyc1t4LmldLm51bSxqbmFtZTpyYWNlLnJ1bm5lcnNbeC5pXS5qbmFtZX0pOwogfQogLy8g4pGlIOazouS5seW6pgogbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHt1cFJvd3MubGVuZ3RofeODrOODvOOCue+8iOOCquODg+OCuuWPjeaYoCAke3dpdGhPZGRzfeODrOODvOOCue+8j+OBneOBruS7luOBr+ODhOODvOODq+aOqOWumu+8iSR7c2tpcHBlZD9g77yPNumgreacqua6gOOBp+WvvuixoeWkliAke3NraXBwZWR9YDoiIn08L2Rpdj5gOwogaCs9YDxkaXYgY2xhc3M9InJvdyI+YCtHUkFERV9PUkRFUi5tYXAoZz0+YDxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltnXX0iPiR7Z30gJHtjbnRbZ119PC9zcGFuPmApLmpvaW4oIiAiKStgPC9kaXY+YDsKIGgrPWA8dGFibGU+PHRoZWFkPjx0cj48dGg+44Os44O844K5PC90aD48dGg+PC90aD48dGg+562J57SaPC90aD48dGg+6YGO5Y6744Gu5rOi5Lmx546HPC90aD48dGg+5Yik5a6aPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgdSBvZiB1cFJvd3MpaCs9YDx0cj48dGQ+JHtlc2ModS5sYWJlbCl9PC90ZD48dGQ+PC90ZD48dGQ+PHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW3UuZy5ncmFkZV19Ij4ke3UuZy5ncmFkZX08L3NwYW4+PC90ZD48dGQ+JHtNYXRoLnJvdW5kKHUuZy5yYXRlKjEwMCl9JTwvdGQ+PHRkIGNsYXNzPSJzbWFsbCI+JHt1LmcubW9kZT09PSJvZGRzIj8i44Kq44OD44K6Ijoi5o6o5a6aIn08L3RkPjwvdHI+YDsKIGgrPWA8L3Rib2R5PjwvdGFibGU+PGRpdiBjbGFzcz0ic21hbGwiPjxicj7ms6LkubHnjofjga/jgIHjgZ3jga7nrYnntJrjga7jg6zjg7zjgrnjgafjgIwz552A5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GMMTXku6XkuIrjgI3jgavjgarjgaPjgZ/pgY7ljrvjga7libLlkIjjgafjgZnvvIjlhajjg6zjg7zjgrnlubPlnYcgMjguNSXvvInjgII8L2Rpdj5gOwogJCgidXBzZXRPdXQiKS5pbm5lckhUTUw9aDsKIC8vIOKRpCDpiYTmnb/ou7jppqwKIGxldCBhPWA8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K644GM5Y+W44KM44Gf44Os44O844K5ICR7d2l0aE9kZHN9LyR7dXBSb3dzLmxlbmd0aH3jgII8L2Rpdj5gOwogaWYoIXdpdGhPZGRzKWErPWA8ZGl2IGNsYXNzPSJ3YXJuIj7jgqrjg4PjgrrjgpLlj5blvpfjgafjgY3jgabjgYTjgarjgYTjgZ/jgoHjgIHpiYTmnb/ou7jppqzjga/liKTlrprjgafjgY3jgb7jgZvjgpPvvIjnmbrlo7Lplovlp4vlvozjgavjgIHjgoLjgYbkuIDluqbmirzjgZfjgabjgY/jgaDjgZXjgYTvvInjgII8L2Rpdj5gOwogZWxzZSBpZighYXhSb3dzLmxlbmd0aClhKz1gPGRpdiBjbGFzcz0id2FybiI+5pys5pel44Gv44CB6Kmy5b2T44GZ44KL6Lu46aas44GM44GE44G+44Gb44KT77yI44Kq44OD44K65Y+W5b6X5riI44G/44Gu44Os44O844K544Gu5Lit44Gr44CB5aCF6Lu45Lul5LiK44GM44GC44KK44G+44Gb44KT77yJ44CCPC9kaXY+YDsKIGZvcihjb25zdCB0IG9mIFsi6YmE5p2/Iiwi5rqW6YmE5p2/Iiwi5aCF6Lu4Il0pe2NvbnN0IGxpc3Q9YXhSb3dzLmZpbHRlcih6PT56LngudGllcj09PXQpO2lmKCFsaXN0Lmxlbmd0aCljb250aW51ZTsKICBhKz1gPGJyPjxiPiR7dH08L2I+PHNwYW4gY2xhc3M9InNtYWxsIj7vvIjpgY7ljrvjga7lrp/nuL4gJHsoVUUuQVhJUy5iYW5kc1t0XS5yYXRlKjEwMCkudG9GaXhlZCgwKX0l44O76Kmy5b2TJHtVRS5BWElTLmJhbmRzW3RdLm596aCt77yJPC9zcGFuPmA7CiAgZm9yKGNvbnN0IHogb2YgbGlzdClhKz1gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moei5sYWJlbCl9PC9iPjxicj4ke2VzYyh6Lm5vKX3nlaogJHtlc2Moei5uYW1lKX0gPHNwYW4gY2xhc3M9InNtYWxsIj7kuojmuKwgJHsoei54LnAqMTAwKS50b0ZpeGVkKDApfSUke3ouam5hbWU/Iu+8j+mojuaJi++8miIrZXNjKHouam5hbWUpOiIifTwvc3Bhbj48L2Rpdj5gfQogJCgiYXhpc091dCIpLmlubmVySFRNTD1hOwp9CiQoImF4aXNHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgZD0kKCJhZGF0ZSIpLnZhbHVlO2lmKCFkKXJldHVybjsKICQoImF4aXNHbyIpLmRpc2FibGVkPXRydWU7JCgiYXhpc091dCIpLmlubmVySFRNTD0iIjskKCJ1cHNldE91dCIpLnRleHRDb250ZW50PSLop6PmnpDkuK3igKYiOwogdHJ5ewogIGlmKCFXUkFDRVMubGVuZ3RofHxXREFURSE9PWQpewogICAkKCJheGlzU3RhdHVzIikudGV4dENvbnRlbnQ9IuWHuummrOihqOOCkuWPluW+l+S4reKApiI7JCgid2RhdGUiKS52YWx1ZT1kO2F3YWl0ICQoIndnZXQiKS5vbmNsaWNrKCk7CiAgIGlmKCFXUkFDRVMubGVuZ3RoKXskKCJheGlzU3RhdHVzIikudGV4dENvbnRlbnQ9JCgid3N0YXR1cyIpLnRleHRDb250ZW50OyQoInVwc2V0T3V0IikudGV4dENvbnRlbnQ9IuWHuummrOihqOOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAgiI7cmV0dXJufQogICAkKCJheGlzU3RhdHVzIikudGV4dENvbnRlbnQ9IuOCquODg+OCuuOCkueiuuiqjeS4reKApiI7YXdhaXQgJCgib2Rkc0dldCIpLm9uY2xpY2soKX0KICAkKCJheGlzU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnvvI/jgqrjg4PjgrogJHtPYmplY3Qua2V5cyhPRERTKS5sZW5ndGh944Os44O844K55YiGYDsKICBhd2FpdCByZW5kZXJBeGlzVXBzZXQoZCk7QVhJU19TSE9XTj10cnVlO2F1dG9TdGFydCgpOwogfWNhdGNoKGUpeyQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD0i44Ko44Op44O877yaIitlLm1lc3NhZ2U7JCgidXBzZXRPdXQiKS50ZXh0Q29udGVudD0iIn0KIGZpbmFsbHl7JCgiYXhpc0dvIikuZGlzYWJsZWQ9ZmFsc2V9Cn07CgovKiAtLS0g44Kq44OD44K644Gu6Ieq5YuV5pu05paw77yI5b2T5pel44Gu44G/77yJ77ya44Kq44OD44K65Y+W5b6XIOKGkiDooajnpLrkuK3jga7mrITvvIjimIXmnKzml6Xjg7vikaTikaXvvInjgpLoh6rli5Xjgaflho3oqIjnrpcgLS0tICovCmxldCBBVVRPX1Q9bnVsbCxBVVRPX05FWFQ9MCxBVVRPX0JVU1k9ZmFsc2UsQVVUT19MQVNUPSIiLFRPREFZX1NIT1dOPWZhbHNlLEFYSVNfU0hPV049ZmFsc2U7CmNvbnN0IGF1dG9Ncz0oKT0+d2luZG93Ll9fQVVUT19NU3x8TnVtYmVyKCQoImF1dG9NaW4iKS52YWx1ZSkqNjAwMDA7CmZ1bmN0aW9uIGF1dG9TdG9wKCl7aWYoQVVUT19UKWNsZWFySW50ZXJ2YWwoQVVUT19UKTtBVVRPX1Q9bnVsbDskKCJhdXRvSW5mbyIpLnRleHRDb250ZW50PSIifQphc3luYyBmdW5jdGlvbiByZWZyZXNoT2Rkc0FuZFZpZXdzKCl7CiBhd2FpdCBmZXRjaE9kZHMoKTsKIEFVVE9fTEFTVD1uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDExLDE5KTsKIGNvbnN0IG49T2JqZWN0LmtleXMoT0REUykubGVuZ3RoOwogaWYoVE9EQVlfU0hPV04peyQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnvvI/jgqrjg4PjgrogJHtufeODrOODvOOCueWIhu+8iCR7QVVUT19MQVNUfSDmm7TmlrDvvIlgO2F3YWl0IHJ1bkFsbCgidG9kYXlPdXQiKX0KIGlmKEFYSVNfU0hPV04peyQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCue+8j+OCquODg+OCuiAke25944Os44O844K55YiG77yIJHtBVVRPX0xBU1R9IOabtOaWsO+8iWA7YXdhaXQgcmVuZGVyQXhpc1Vwc2V0KFdEQVRFKX0KfQpmdW5jdGlvbiBhdXRvU3RhcnQoKXsKIGF1dG9TdG9wKCk7CiBpZighJCgiYXV0b09kZHMiKS5jaGVja2VkfHwhV1JBQ0VTLmxlbmd0aClyZXR1cm47CiBpZihXREFURTxqc3RUb2RheSgpKXskKCJhdXRvSW5mbyIpLnRleHRDb250ZW50PSLvvIjpgY7ljrvjga7ml6Xku5jjga7jgZ/jgoHoh6rli5Xmm7TmlrDjga/jgZfjgb7jgZvjgpPvvIkiO3JldHVybn0KIEFVVE9fTkVYVD1EYXRlLm5vdygpK2F1dG9NcygpOwogQVVUT19UPXNldEludGVydmFsKGFzeW5jKCk9PnsKICBjb25zdCBsZWZ0PUFVVE9fTkVYVC1EYXRlLm5vdygpOwogIGlmKGxlZnQ+MCl7JCgiYXV0b0luZm8iKS50ZXh0Q29udGVudD1g5qyh44Gu5pu05paw44G+44GnICR7TWF0aC5jZWlsKGxlZnQvMTAwMCl956eSYCsoQVVUT19MQVNUP2DvvI/mnIDntYLmm7TmlrAgJHtBVVRPX0xBU1R9YDoiIik7cmV0dXJufQogIGlmKEFVVE9fQlVTWSlyZXR1cm47QVVUT19CVVNZPXRydWU7JCgiYXV0b0luZm8iKS50ZXh0Q29udGVudD0i44Kq44OD44K644KS5pu05paw5Lit4oCmIjsKICB0cnl7YXdhaXQgcmVmcmVzaE9kZHNBbmRWaWV3cygpfWNhdGNoKGUpeyQoImF1dG9JbmZvIikudGV4dENvbnRlbnQ9IuabtOaWsOOCqOODqeODvO+8miIrZS5tZXNzYWdlfQogIGZpbmFsbHl7QVVUT19CVVNZPWZhbHNlO0FVVE9fTkVYVD1EYXRlLm5vdygpK2F1dG9NcygpfQogfSx3aW5kb3cuX19BVVRPX1RJQ0t8fDEwMDApOwp9CiQoImF1dG9PZGRzIikub25jaGFuZ2U9YXV0b1N0YXJ0OyQoImF1dG9NaW4iKS5vbmNoYW5nZT1hdXRvU3RhcnQ7CgooYXN5bmMoKT0+e3RyeXthd2FpdCBvcGVuREIoKTthd2FpdCBzaG93U3RhdGUoKTthd2FpdCBwYXlTdGF0ZSgpfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kv53lrZjpoJjln5/jgpLplovjgZHjgb7jgZvjgpPvvJoke2VzYyhlLm1lc3NhZ2UpfVxu77yI44OX44Op44Kk44OZ44O844OI44OW44Op44Km44K644Gn44Gv5L2/44GI44Gq44GE44GT44Go44GM44GC44KK44G+44GZ77yJPC9zcGFuPmB9fSkoKTsKaWYoL15odHRwcz86Ly50ZXN0KGxvY2F0aW9uLnByb3RvY29sKSkkKCJ3dXJsIikudmFsdWU9bG9jYXRpb24ub3JpZ2luOwpzaG93UGFuZSgiV29ya2VyIik7Cgo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==";
function serveApp() {
  const binary = atob(APP_HTML_BASE64);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

/* =========================================================
 * 払戻（複勝・単勝）取得 /payouts?date=YYYY-MM-DD[&venue=06]
 * 既存の結果ページ探索・取得処理を流用。保存はしない（読み取り専用）。
 * ======================================================= */
/* レース結果ページ（accessS）1レース分の払戻。文字コードに依存しないよう、馬番・円・人気だけを読む。
   raceId は URL の CNAME（…sde10 + 場2桁+年4桁+回2桁+日2桁+R2桁+日付8桁）から作る。 */
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

async function handlePayouts(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  if (!isValidDateString(date)) {
    return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  }
  try {
    let races = await discoverJRAResultUrlsByDate(date);
    if (venue) races = races.filter(r => String(r.venueCode) === String(venue));
    const out = [];
    const failed = [];
    for (const race of races) {
      try {
        if (!race.url) throw new Error("レースURLがありません");
        const html = await fetchJRAHtml(race.url);
        const p = extractJRARefund(html, race.url);
        if (!p.raceId || !p.place.length) throw new Error("払戻を解析できませんでした");
        out.push({ raceId: p.raceId, date, venueCode: p.venueCode, raceNo: p.raceNo, win: p.win, place: p.place });
      } catch (error) {
        failed.push({
          venueCode: race.venueCode,
          raceNo: race.raceNumber ?? race.raceNo,
          reason: String(error?.message || error)
        });
      }
    }
    return json({ ok: true, source: "JRA", date, discovered: races.length, count: out.length, races: out, failed });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}


/* =========================================================
 * 過去結果の取得（保存しない・読み取り専用）
 *   /results?date=YYYY-MM-DD&list=1          その日の開催場一覧
 *   /results?date=YYYY-MM-DD&venue=06        その開催場の結果行
 * 既存の結果ページ探索・解析（discoverJRAResultUrlsByDate / fetchOneJRARace / raceResultToRows）を流用。
 * ======================================================= */
async function handleResults(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  if (!isValidDateString(date)) {
    return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  }
  try {
    let races = await discoverJRAResultUrlsByDate(date);
    if (url.searchParams.get("list") === "1") {
      const map = new Map();
      for (const r of races) {
        if (!map.has(r.venueCode)) map.set(r.venueCode, { venueCode: r.venueCode, venueName: r.venueName || r.venueCode, races: 0 });
        map.get(r.venueCode).races++;
      }
      return json({ ok: true, source: "JRA", date, venues: [...map.values()] });
    }
    if (venue) races = races.filter(r => String(r.venueCode) === String(venue));
    const rows = [];
    const failed = [];
    for (const race of races) {
      try {
        const result = await fetchOneJRARace(race.date || date, race.venueCode, race.venueName, race);
        if (!result || !Array.isArray(result.horses) || !result.horses.length) throw new Error("結果が0頭");
        for (const r of raceResultToRows(result)) {
          rows.push({
            date: r.date, raceId: r.raceId, venueCode: r.venueCode, raceNumber: r.raceNumber,
            surface: r.surface, distance: r.distance, finish: r.finish, number: r.number,
            horse: r.horse, age: r.age, jockey: r.jockey
          });
        }
      } catch (error) {
        failed.push({ venueCode: race.venueCode, raceNo: race.raceNo, reason: String(error?.message || error) });
      }
    }
    return json({ ok: true, source: "JRA", date, discovered: races.length, count: rows.length, rows, failed });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}


/* =========================================================
 * 自己完結用API（過去成績・払戻・オッズ）
 *   /jra-days?month=YYYY-MM            その月の開催日
 *   /jra-day?date=YYYY-MM-DD           その日の全レース（結果ページのCNAME）
 *   /jra-results?cnames=a,b,c          レース結果（人気つき）＋払戻（最大8レース）
 *   /jra-odds?date=YYYY-MM-DD[&venue=] 単勝オッズ（レース前・当日）
 * すべて読み取り専用。保存はしない。
 * ======================================================= */
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
          horse: r.horse, age: r.age, jockey: r.jockey, pop: r.popularity ?? null
        });
      }
      const clsText = ((String(html).match(/<div class="cell class">\s*([^<]*?)\s*<\/div>/) || [])[1] || "").trim();
      const prizeM = String(html).match(/<li><span class="cap">1着<\/span><span class="num">([\d,]+)<\/span>/);
      const prize1 = prizeM ? Number(prizeM[1].replace(/,/g, "")) : null;
      for (const row of rows) { if (row.raceId === makeRaceId(race.date, race.venueCode, race.raceNo)) { row.cls = clsText; row.prize = prize1; } }
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
function parseJraOddsHtml(html) {
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
        items.push({ cname: c, odds: p.odds, count: n, method: p.method });
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
    const targets = [...raceLevel.keys()].filter(c => c.includes(compact));
    const races = [];
    for (const c of targets.slice(0, 14)) {
      try {
        const html = await fetchOddsPage(c);
        const p = parseJraOddsHtml(html);
        const m = c.match(/^pw151ou\d{2}(\d{2})\d{8}(\d{2})\d{8}/i);
        const venueCode = m ? m[1] : null, raceNo = m ? Number(m[2]) : null;
        const n = Object.keys(p.odds).length;
        diag.push({ step: "odds-race", cname: c, venueCode, raceNo, horses: n, method: p.method, htmlLength: html.length });
        if (n >= 4 && venueCode && raceNo && (!venueFilter || venueCode === String(venueFilter))) races.push({ venueCode, raceNo, odds: p.odds });
      } catch (error) {
        diag.push({ step: "odds-race", cname: c, error: String(error?.message || error) });
      }
    }
    return json({ ok: true, date, count: races.length, races, diagnostics: diag.slice(0, 24) });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error), diagnostics: diag }, 502);
  }
}

/* =========================================================
 * メインWorker
 * ======================================================= */

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    try {

      const url =
        new URL(
          request.url
        );


      const pathname =
        url.pathname;


      const method =
        request.method
          .toUpperCase();


      /* ---------------------------------------------------
       * CORS
       * ------------------------------------------------- */

      if (
        method ===
        "OPTIONS"
      ) {

        return handleOptions();

      }


      /* ---------------------------------------------------
       * GET以外
       * ------------------------------------------------- */

      if (
        method !==
        "GET" &&
        method !==
        "HEAD"
      ) {

        return errorResponse(
          "GET / HEAD / OPTIONS のみ対応しています。",
          405
        );

      }


      /* ---------------------------------------------------
       * Webアプリ本体
       * ------------------------------------------------- */

      if (pathname === "/jra-days") {
        return handleJraDays(request);
      }

      if (pathname === "/jra-day") {
        return handleJraDay(request);
      }

      if (pathname === "/jra-results") {
        return handleJraResults(request);
      }

      if (pathname === "/jra-odds") {
        return handleJraOdds(request);
      }

      if (pathname === "/results") {
        return handleResults(request);
      }

      if (pathname === "/payouts") {
        return handlePayouts(request);
      }

      if (pathname === "/" || pathname === "/index.html") {
        return serveApp();
      }

      /* ---------------------------------------------------
       * ヘルスチェック
       * ------------------------------------------------- */

      if (
        pathname ===
        "/health"
      ) {

        return handleHealth(env);

      }


      /* ---------------------------------------------------
       * 次回レース
       * ------------------------------------------------- */

      if (
        pathname ===
          "/next-race" ||
        pathname ===
          "/netlify/functions/next-race"
      ) {

        return handleNextRace();

      }


      /* ---------------------------------------------------
       * レースカード
       * ------------------------------------------------- */

      if (
        pathname ===
          "/race-cards" ||
        pathname ===
          "/netlify/functions/race-cards"
      ) {

        return handleRaceCards(
          request
        );

      }


      /* ---------------------------------------------------
       * レース結果
       * ------------------------------------------------- */

      if (
        pathname ===
          "/race-results" ||
        pathname ===
          "/netlify/functions/race-results"
      ) {

        return handleRaceResults(
          request,
          env
        );

      }


      /* ---------------------------------------------------
       * 次回レース予想
       * ------------------------------------------------- */

      if (
        pathname ===
        "/predict"
      ) {

        return handlePredict(
          request,
          env
        );

      }


      /* ---------------------------------------------------
       * 1日全レース予想
       * ------------------------------------------------- */

      if (
        pathname ===
        "/predict-day"
      ) {

        return handlePredictDay(
          request,
          env
        );

      }


      /* ---------------------------------------------------
       * 開催場
       * ------------------------------------------------- */

      if (
        pathname ===
        "/venues"
      ) {

        return handleVenues(
          request
        );

      }


      /* ---------------------------------------------------
       * 履歴状態
       * ------------------------------------------------- */

      if (
        pathname ===
        "/history-status"
      ) {

        return handleHistoryStatus(
          env
        );

      }


      /* ---------------------------------------------------
       * 履歴インポート
       * ------------------------------------------------- */

      if (
        pathname ===
        "/import-history"
      ) {

        return handleImportHistory(
          request,
          env
        );

      }


      /* ---------------------------------------------------
       * デバッグ
       * ------------------------------------------------- */

      if (
        pathname ===
        "/debug-race"
      ) {

        return handleDebugRace(
          request
        );

      }


      /* ---------------------------------------------------
       * JRA結果テスト
       * ------------------------------------------------- */

　　　　if (
        pathname ===
        "/test-jra"
      ) {

        try {

          return json(
            await testJRAResult()
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }
      /* ---------------------------------------------------
       * JRA 中山・京都 レースリンク解析テスト
       * ------------------------------------------------- */

      if (
        pathname ===
        "/test-jra-html"
      ) {

        try {

          const testUrls = [

  {
    name: "中山6R",
    url:
      "https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1006201901060620190119%2F1A"
  }

];
          const results = [];

          for (
            const test of
              testUrls
          ) {

            try {

              const html =
                await fetchJRAHtml(
                  test.url
                );

              const rawLinks =
                extractJRALinks(
                  html,
                  test.url
                );

              const parsedLinks =
                rawLinks
                  .map(
                    link =>
                      parseJRACname(
                        link
                      )
                  )
                  .filter(
                    Boolean
                  );

              const targetLinks =
                parsedLinks.filter(
                  race =>
                    race.date ===
                    "2019-01-19"
                );

              const pageLinks =
                getJRARaceLinksFromPage(
                  html,
                  test.url,
                  "2019-01-19"
                );

              results.push({

                name:
                  test.name,

                htmlLength:
                  html.length,

                rawLinkCount:
                  rawLinks.length,

                parsedLinkCount:
                  parsedLinks.length,

                targetDateCount:
                  targetLinks.length,

                pageLinkCount:
                  pageLinks.length,

                pageLinks:
                  pageLinks.slice(
                    0,
                    20
                  )

              });

            } catch (
              error
            ) {

              results.push({

                name:
                  test.name,

                error:
                  String(
                    error.message ||
                    error
                  )

              });

            }

          }

          return json({

            ok: true,

            date:
              "2019-01-19",

            results

          });

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }
    
      /* ---------------------------------------------------
       * JRA保存テスト
       * ------------------------------------------------- */

　　　　      if (
        pathname ===
        "/test-history-data"
      ) {

        try {

          const rows =
            await loadStoredHistory(
              env
            );

          return json({

            ok: true,

            storedRows:
              Array.isArray(rows)
                ? rows.length
                : 0,

            stats:
              getHistoryStats(
                Array.isArray(rows)
                  ? rows
                  : []
              ),

            firstRows:
              Array.isArray(rows)
                ? rows.slice(
                    0,
                    5
                  )
                : [],

            lastRows:
              Array.isArray(rows)
                ? rows.slice(
                    -5
                  )
                : []

          });

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }
      
      if (
        pathname ===
        "/test-jra-store"
      ) {

        try {

          return json(
            await testJRAStore(
              env
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


            if (
        pathname ===
        "/test-jra-auto"
      ) {

        try {

          return json(
            await testJRAAutoDiscover(
              env,
              "2019-01-19"
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


      /* ---------------------------------------------------
       * 2019年1月テスト
       * ------------------------------------------------- */

      if (
        pathname ===
        "/test-history-2019"
      ) {

        try {

          return json(
            await testHistory2019January(
              env
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


      /* ---------------------------------------------------
       * 2019年1月テスト
       * ------------------------------------------------- */

      if (
        pathname ===
        "/test-history-2019"
      ) {

        try {

          return json(
            await testHistory2019January(
              env
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


      /* ---------------------------------------------------
       * 2019-01-05完全テスト
       * ------------------------------------------------- */

      if (
        pathname ===
        "/test-jra-full-day"
      ) {

        try {

          return json(
            await testJRAFullDay(
              env
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


      /* ---------------------------------------------------
       * 404
       * ------------------------------------------------- */

      return json(

        {

          ok: false,

          error:
            "Not Found",

          path:
            pathname,

          availableRoutes: [

            "/health",

            "/next-race",

            "/race-cards",

            "/race-results",

            "/predict",

            "/predict-day",

            "/venues",

            "/history-status",

            "/import-history",

            "/debug-race",

            "/test-jra",

            "/test-jra-store",

            "/test-history-2019",

            "/test-jra-full-day"

          ]

        },

        404

      );

    } catch (
      error
    ) {

      /*
       * Worker全体の最終エラー捕捉。
       *
       * ここで例外をResponseに変換することで、
       * 以前のようなCloudflare 1101を
       * できるだけ防ぐ。
       */

      console.error(
        "Worker fatal error",
        error
      );


      return errorResponse(

        error &&
        error.message
          ? error.message
          : String(
              error ||
              "Unknown Worker Error"
            ),

        500

      );

    }

  }

};
