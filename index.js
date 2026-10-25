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

function extractJRAEntryInfo(html) {
  const result = {
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+Cjx0aXRsZT7nqbTppqzlpb3otbDjg4Tjg7zjg6s8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOX0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMH19CmJvZHl7bWFyZ2luOjA7YmFja2dyb3VuZDp2YXIoLS1iZyk7Y29sb3I6dmFyKC0tdHgpO2ZvbnQtZmFtaWx5Oi1hcHBsZS1zeXN0ZW0sQmxpbmtNYWNTeXN0ZW1Gb250LCJTZWdvZSBVSSIsc2Fucy1zZXJpZn0KaGVhZGVye2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxNHB4IDE2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxOXB4fQptYWlue21heC13aWR0aDo5MDBweDttYXJnaW46YXV0bztwYWRkaW5nOjEwcHh9CnNlY3Rpb257YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxNHB4O21hcmdpbjoxMHB4IDA7Ym94LXNoYWRvdzowIDFweCA0cHggIzAwMDF9Cmgye2ZvbnQtc2l6ZToxNnB4O21hcmdpbjowIDAgOHB4fQpidXR0b257Ym9yZGVyOjA7Ym9yZGVyLXJhZGl1czo5cHg7cGFkZGluZzoxMXB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1wcik7Y29sb3I6I2ZmZjtmb250LXdlaWdodDo3MDA7bWFyZ2luOjRweCA0cHggNHB4IDA7Zm9udC1zaXplOjE0cHh9CmJ1dHRvbjpkaXNhYmxlZHtvcGFjaXR5Oi40fWJ1dHRvbi5zdWJ7YmFja2dyb3VuZDojNjY3MDg1fQppbnB1dCxzZWxlY3QsdGV4dGFyZWF7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCU7Ym94LXNpemluZzpib3JkZXItYm94fQp0ZXh0YXJlYXt3aWR0aDoxMDAlO21pbi1oZWlnaHQ6MTIwcHg7Zm9udC1mYW1pbHk6aW5oZXJpdH0KLnNtYWxse2ZvbnQtc2l6ZToxM3B4O2NvbG9yOnZhcigtLXN1Yil9LnN0YXR1c3twYWRkaW5nOjlweDtiYWNrZ3JvdW5kOnZhcigtLWJnKTtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjhweDt3aGl0ZS1zcGFjZTpwcmUtd3JhcH0KLmdvb2R7Y29sb3I6IzEzNzMzMztmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6I2MyNmEwMDtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodH0KdGg6bnRoLWNoaWxkKC1uKzIpLHRkOm50aC1jaGlsZCgtbisyKXt0ZXh0LWFsaWduOmxlZnR9Ci5jYW5ke2JvcmRlcjoxcHggc29saWQgdmFyKC0tbG4pO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjlweDttYXJnaW46OHB4IDB9Ci5jaGlwe2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtc2l6ZToxMnB4O2JvcmRlci1yYWRpdXM6OTk5cHg7cGFkZGluZzoycHggOHB4O21hcmdpbjozcHggNHB4IDAgMDtiYWNrZ3JvdW5kOiNlZWYxZjU7Y29sb3I6IzM0NDA1NH0KLmNoaXAuYntiYWNrZ3JvdW5kOiNlMGYyZTY7Y29sb3I6IzEzNzMzM30uY2hpcC5ve2JhY2tncm91bmQ6I2ZmZWZjZjtjb2xvcjojOWE1YTAwfS5jaGlwLmd7YmFja2dyb3VuZDojZTZlOWVlO2NvbG9yOiM1ZDY4NzV9Ci5ydHtkaXNwbGF5OmlubGluZS1ibG9jaztmb250LXdlaWdodDo4MDA7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzowIDdweDtjb2xvcjojZmZmO2JhY2tncm91bmQ6Izk4YTJiM30KLnJ0LnJTe2JhY2tncm91bmQ6I2Q5MmQyMH0ucnQuckF7YmFja2dyb3VuZDojZjc5MDA5fS5ydC5yQntiYWNrZ3JvdW5kOiMxNjY3ZDl9Ci5yb3d7ZGlzcGxheTpmbGV4O2dhcDo4cHg7ZmxleC13cmFwOndyYXA7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbjo2cHggMH0KI2J1c3l7ZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDojMDAwODt6LWluZGV4OjIwO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyfQojYnVzeT5kaXZ7YmFja2dyb3VuZDp2YXIoLS1oZCk7Y29sb3I6I2ZmZjtwYWRkaW5nOjE4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O21heC13aWR0aDo4MCU7dGV4dC1hbGlnbjpjZW50ZXI7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Cjwvc3R5bGU+PC9oZWFkPjxib2R5Pgo8aGVhZGVyPueptOmmrOWlvei1sOODhOODvOODqyA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxM3B4Ij7ljZjkvZPniYggdjE8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgo8c2VjdGlvbj4KPGgyPuKYhSDmnKzml6Xjga7lpb3otbDnqbTppqw8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+44Oc44K/44OzMeOBpOOBp+OAjOWHuummrOihqOOBruWPluW+lyDihpIg44Kq44OD44K677yI5Y+W44KM44KM44Gw77yJ4oaSIOWFqOODrOODvOOCueOBrueptOmmrOWAmeijnOOAjeOCkuihqOekuuOBl+OBvuOBmeOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0idGRhdGUiIHR5cGU9ImRhdGUiPjxidXR0b24gaWQ9InRvZGF5R28iPuWlvei1sOeptOmmrOOCkuihqOekujwvYnV0dG9uPjxidXR0b24gaWQ9InRvZGF5VXBkIiBjbGFzcz0ic3ViIj7mnIDmlrDjga7miJDnuL7jgavmm7TmlrA8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0idG9kYXlTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuaXpeS7mOOCkumBuOOCk+OBp+OAjOWlvei1sOeptOmmrOOCkuihqOekuuOAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAguaIkOe4vuOBjOWPpOOBhOOBqOOBjeOBr+WFiOOBq+OAjOacgOaWsOOBruaIkOe4vuOBq+abtOaWsOOAjeOCkuaKvOOBl+OBvuOBmeOAgjwvZGl2Pgo8ZGl2IGlkPSJ0b2RheU91dCI+PC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGgIOODh+ODvOOCv+WPluW+l++8iOOBk+OBruOCouODl+ODquOBoOOBkeOBp+WujOe1kO+8iTwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj5KUkHlhazlvI/jgYvjgonjgIHpgY7ljrvjga7miJDnuL7vvIjkurrmsJfjgaTjgY3vvInjgajopIfli53jg7vljZjli53jga7miZXmiLvjgpLlj5blvpfjgZfjgabjgIHjgZPjga7nq6/mnKvjgavkv53lrZjjgZfjgb7jgZnjgILlhYPjga7jgqLjg5fjg6rjgoTjg5Djg4Pjgq/jgqLjg4Pjg5fjga/kuI3opoHjgafjgZnjgILmraLjgoHjgabjgoLntprjgY3jgYvjgonlho3plovjgafjgY3jgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj7mjqXntprlhYggPGlucHV0IGlkPSJ3dXJsIiBzdHlsZT0iZmxleDoxO21pbi13aWR0aDoyMjBweCIgdmFsdWU9Imh0dHBzOi8va2VpYmEtYWktcGF5b3V0cy5odDE5OTUwODIyLndvcmtlcnMuZGV2Ij48L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij7mnJ/plpMgPGlucHV0IGlkPSJzc3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIzLTAxLTAxIj4g44CcIDxpbnB1dCBpZD0ic2VuZCIgdHlwZT0iZGF0ZSI+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY0dvIj7pgY7ljrvmiJDnuL7jgajmiZXmiLvjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJzeW5jU3RvcCIgY2xhc3M9InN1YiIgZGlzYWJsZWQ+5YGc5q2iPC9idXR0b24+PC9kaXY+CjxkaXYgaWQ9InN5bmNTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2Pgo8ZGl2IGlkPSJkYXRhU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7norroqo3kuK3igKY8L2Rpdj4KPGRldGFpbHM+PHN1bW1hcnkgY2xhc3M9InNtYWxsIj7jg5Djg4Pjgq/jgqLjg4Pjg5dKU09O77yPQ1NW44GL44KJ6Kqt44G/6L6844KA77yI5Lu75oSP77yJPC9zdW1tYXJ5Pgo8ZGl2IGNsYXNzPSJzbWFsbCI+5YWD44Ki44OX44Oq44Gu44OQ44OD44Kv44Ki44OD44OX44GM44GC44KM44Gw44CB5Y+W5b6X44KS55yB55Wl44Gn44GN44G+44GZ77yI5ZCM44GY5pel44Gv6YeN6KSH44GX44Gm5Y+W44KK6L6844G/44G+44Gb44KT77yJ44CCPC9kaXY+CjxpbnB1dCBpZD0iZmlsZSIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiwuY3N2LGFwcGxpY2F0aW9uL2pzb24sdGV4dC9jc3YiPgo8L2RldGFpbHM+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGgLTIg6KSH5Yud5Zue5Y+O546H44Gu5qSc6Ki8PC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruaIkOe4vuOBqOaJleaIu+OBp+OAgeaZguezu+WIl++8iOOBneOBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBoOOBke+8ieOBruODkOODg+OCr+ODhuOCueODiOOCkuOBl+OBvuOBmeOAgueptOOCvuODvOODs+OBr+Wun+mam+OBruS6uuawl+OBp+WIpOWumuOBl+OAgeWQhOODrOODvOOCuTEwMOWGhuOBmuOBpOizvOWFpeOBqOS7ruWumuOBl+OBvuOBmeOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPumWi+Wni+aXpSA8aW5wdXQgaWQ9ImJ0U3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIzLTAxLTAxIj48YnV0dG9uIGlkPSJidFJ1biI+5qSc6Ki844KS5a6f6KGMPC9idXR0b24+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0icGF5RXhwIiBjbGFzcz0ic3ViIj7miZXmiLvjgpLmm7jjgY3lh7rjgZc8L2J1dHRvbj48bGFiZWwgY2xhc3M9InNtYWxsIj7oqq3jgb/ovrzjgb8gPGlucHV0IGlkPSJwYXlJbXAiIHR5cGU9ImZpbGUiIGFjY2VwdD0iLmpzb24iPjwvbGFiZWw+PC9kaXY+CjxkaXYgaWQ9ImJ0T3V0IiBjbGFzcz0ic3RhdHVzIj7jg4fjg7zjgr/lj5blvpfjga7jgYLjgajjgaflrp/ooYzjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaEg44Os44O844K544KS6YG444G2PC9oMj4KPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJ0YWJXb3JrZXIiIGNsYXNzPSJzdWIiPuWHuummrOihqOOCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9InRhYk1hbnVhbCIgY2xhc3M9InN1YiI+5omL5YWl5YqbPC9idXR0b24+PGJ1dHRvbiBpZD0idGFiUGFzdCIgY2xhc3M9InN1YiI+6YGO5Y6744Os44O844K544Gn6Kmm44GZPC9idXR0b24+PC9kaXY+CjxkaXYgaWQ9InBhbmVXb3JrZXIiIHN0eWxlPSJkaXNwbGF5Om5vbmUiPgogPGRpdiBjbGFzcz0ic21hbGwiPuaXouWtmOOBrldvcmtlcuOBriAvcmFjZS1jYXJkcyDjgpLoqq3jgb/lj5bjgovjgaDjgZHjgafjgZnvvIjlpInmm7TjgZfjgb7jgZvjgpPvvInjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJ3ZGF0ZSIgdHlwZT0iZGF0ZSI+PC9kaXY+CiA8YnV0dG9uIGlkPSJ3Z2V0Ij7plovlgqzjg7vjg6zjg7zjgrnjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJvZGRzR2V0IiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJ3YWxsIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7lhajjg6zjg7zjgrnkuIDmi6zop6PmnpA8L2J1dHRvbj48ZGl2IGlkPSJ3c3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlj5blvpc8L2Rpdj48ZGl2IGlkPSJ3bGlzdCI+PC9kaXY+PGRpdiBpZD0iYWxsb3V0Ij48L2Rpdj4KPC9kaXY+CjxkaXYgaWQ9InBhbmVNYW51YWwiIHN0eWxlPSJkaXNwbGF5Om5vbmUiPgogPGRpdiBjbGFzcz0ic21hbGwiPjHooYzjgavjgIzppqznlaog6aas5ZCN44CN44CC5Lu75oSP44Gn5pyA5b6M44Gr5Y2Y5Yud44Kq44OD44K644CC5L6L77yaPGJyPjEg4peL4peL4peL4peLIDMuNDxicj4yIOKWs+KWs+KWs+KWszwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9Im1kYXRlIiB0eXBlPSJkYXRlIj48c2VsZWN0IGlkPSJtc3VyZiI+PG9wdGlvbiB2YWx1ZT0iMSI+6IqdPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMiI+44OA44O844OIPC9vcHRpb24+PC9zZWxlY3Q+PGlucHV0IGlkPSJtZGlzdCIgdHlwZT0ibnVtYmVyIiBzdGVwPSIxMDAiIHZhbHVlPSIxNjAwIiBzdHlsZT0id2lkdGg6OTBweCI+bTwvZGl2PgogPHRleHRhcmVhIGlkPSJtdGV4dCIgcGxhY2Vob2xkZXI9IjEg6aas5ZCNJiMxMDsyIOmmrOWQjSI+PC90ZXh0YXJlYT4KIDxidXR0b24gaWQ9Im1nbyI+44GT44Gu44Os44O844K544KS5L2/44GGPC9idXR0b24+CjwvZGl2Pgo8ZGl2IGlkPSJwYW5lUGFzdCIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5L+d5a2Y5riI44G/44Gu6YGO5Y6744Os44O844K544KS44CB44Gd44Gu5pel44KI44KK5YmN44Gu44OH44O844K/44Gg44GR44Gn5LqI5oOz44GX44G+44GZ44CC5a6f6Zqb44Gu552A6aCG44KS5Lim44G544Gm56K66KqN44Gn44GN44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0icGRhdGUiIHR5cGU9ImRhdGUiPjxidXR0b24gaWQ9InBnZXQiPuOBneOBruaXpeOBruODrOODvOOCueS4gOimpzwvYnV0dG9uPjwvZGl2PgogPGRpdiBpZD0icHN0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pel5LuY44KS6YG444KT44Gn44GP44Gg44GV44GE44CCPC9kaXY+PGRpdiBpZD0icGxpc3QiPjwvZGl2Pgo8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaIg56m06aas5aW96LWw44KS6Kej5p6QPC9oMj4KPGRpdiBpZD0icmFjZWxhYmVsIiBjbGFzcz0ic21hbGwiPuODrOODvOOCueOCkumBuOaKnuOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8YnV0dG9uIGlkPSJydW4iIGRpc2FibGVkPuino+aekOOBmeOCizwvYnV0dG9uPgo8ZGl2IGlkPSJvdXQiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoyDjgZPjga7jg4Tjg7zjg6vjgavjgaTjgYTjgaY8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+CjxiPuWlvei1sOeOhzwvYj7vvJ0z552A5YaF44Gr5YWl44KL56K6546H44Gu5o6o5a6a44CC6YGO5Y6744Gu5a6f57i+44OH44O844K/44GL44KJ6YeN44G/44KS5a2m57+S44GX44Gf44Oi44OH44Or44Gn6KiI566X44GX44G+44GZ77yI6YCa566X44GuM+edgOWGheeOh+ODu+OCr+ODqeOCueijnOato+OBl+OBn+aIkOe4vuODu+ebtOi/kTPotbDjg7vmnIDntYLnnYDpoIbjg7vlkIzmnaHku7bjga7lrp/nuL7jg7vplpPpmpTjg7vlubTpvaLjg7vmmIfntJrpmY3ntJrjg7vliJ3jga7oip3jg4Dmm7/jgo/jgorvvInjgII8YnI+CjxiPuOCr+ODqeOCuTwvYj7vvJrmnKrli53liKnvvI8x5Yud77yPMuWLne+8jzPli53vvI/jgqrjg7zjg5fjg7PjgpLljLrliKXjgZfjgIHkvY7jgYTjgq/jg6njgrnjgafjga7lpb3otbDjga/libLjgorlvJXjgY3jgIHpq5jjgYTjgq/jg6njgrnjgafjga7lh6HotbDjga/libLjgorlvJXjgY3jgb7jgZnjgILlnLDmlrnjga7jg4fjg7zjgr/jgYzlkKvjgb7jgozjgovloLTlkIjjga/jgIHjgZXjgonjgavlibLjgorlvJXjgY3jgb7jgZnvvIhKUkHjga7lhazlvI/jgrXjgqTjg4jjgavjga/lnLDmlrnjga7miJDnuL7jgYzjgarjgYTjgZ/jgoHjgIHkuK3lpK7jga7jgb/jga7lsaXmrbTjgafjgZnvvInjgII8YnI+CjxiPjLjgaTjga7jg6Ljg7zjg4k8L2I+77yaPGJyPgrjg7vjgqrjg4PjgrrmnKrlhaXlipvvvJrnqbTjgr7jg7zjg7PjgpLjgIzjg4Tjg7zjg6vmjqjlrprjga7kurrmsJfvvIjpqI7miYvmiJDnuL7ovrzjgb/vvInjgI3jgafliKTlrprjgILlrp/pmpvjga7kurrmsJfjgajjga7nm7jplqLjga8wLjc444Gn44GZ44CCPGJyPgrjg7vjgqrjg4PjgrrlhaXlipvvvIjjgb7jgZ/jga/pgY7ljrvjg6zjg7zjgrnjga7kurrmsJfpoIbkvY3vvInvvJrnqbTjgr7jg7zjg7PjgpLlrp/pmpvjga7kurrmsJfjgafliKTlrprjgZfjgIHlppnlkbPjgoLlh7rjgZfjgb7jgZnjgILmnKzmnaXjga7kvb/jgYTmlrnjgafjgZnjgII8YnI+CjxiPuihqOekuuOBruiqreOBv+aWuTwvYj7vvJrlpb3otbDnjofjga/jgIHjgZ3jga7ppqzjga7jgIznqbTjgr7jg7zjg7PlhoXjgafjga7lrp/nuL7jg5njg7zjgrnjga7norrnjofjgI3jgafjgZnjgILlsaXmrbTjga7jgarjgYTppqzjgoLjgIHpoK3mlbDjgYzlpJrjgZHjgozjgbDntIQy5Ymy44Gr44Gq44KK44G+44GZ77yIMTXpoK3nq4vjgabjgacz6aCt44GMM+edgOWGheOBq+WFpeOCi+OBn+OCge+8ieOAguipleS+oeODqeODs+OCr+OBr+OAgeeptOOCvuODvOODs+OBruW5s+Wdh+OBruS9leWAjeOBi+OBp+axuuOCgeOBpuOBhOOBvuOBmeOAgjxicj4KPGI+5qSc6Ki877yIMjAyNOW5tOS7pemZjeODu+Wtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iTwvYj7vvJo8YnI+CuODu+ODouODh+ODq+eyvuW6pu+8iOWvvuaVsOaQjeWkse+8ie+8muaXp+ODouODh+ODqzAuNDcxIOKGkiDmlrDjg6Ljg4fjg6swLjQ1MO+8iOWwj+OBleOBhOOBu+OBqeiJr+OBhO+8ieOAgjxicj4K44O744Kq44OD44K65YWl5Yqb5pmC77ya56m044K+44O844Oz5YWo5L2T44GuM+edgOWGheeOhyDntIQ5JeOAgTHkvY3lgJnoo5wg57SEMjEl44CB5LiK5L2NMumgrSDntIQxOCXjgII8YnI+CuODu+OCquODg+OCuuacquWFpeWKm+aZgu+8mueptOOCvuODvOODs+WFqOS9kyDntIQxMiXjgIEx5L2N5YCZ6KOcIOe0hDI3JeOAgeS4iuS9jTLpoK0g57SEMjMl44CCPGJyPgrjg7vjg6njg7Pjgq/jgajlrp/nuL7vvJpT77yeQe+8nkLvvJ5D44Gu6aCG44GrM+edgOWGheeOh+OBjOS4i+OBjOOCiuOBvuOBmeOAgjxicj4K44Kq44OD44K644O75Lq65rCX44Gv5LqI5ris44Gu5YWl5Yqb44Gr44Gv5L2/44Gj44Gm44GE44G+44Gb44KT77yI5Lq65rCX44Gu5Luj55CG44Oi44OH44Or44Gu5a2m57+S44Op44OZ44Or44Go44CB56m044K+44O844Oz44Gu5Yik5a6a44CB5aaZ5ZGz44Gu5q+U6LyD44Gr44Gu44G/5L2/55So77yJ44CC6KSH5Yud5Zue5Y+O546H44Gv44CB5omV5oi744KS5Y+W5b6X44GX44Gf44GC44Go44Gr4pGgLTLjgafmpJzoqLzjgafjgY3jgb7jgZnjgIIKPC9kaXY+Cjwvc2VjdGlvbj4KPC9tYWluPgo8ZGl2IGlkPSJidXN5Ij48ZGl2IGlkPSJidXN5VGV4dCI+5Yem55CG5Lit4oCmPC9kaXY+PC9kaXY+CjxzY3JpcHQ+CiJ1c2Ugc3RyaWN0IjsKLyog56m06aas5aW96LWw44Ko44Oz44K444Oz77yI5Y2Y5L2T54mI44O744OW44Op44Km44K2L05vZGXlhbHnlKjvvInjgILjgqrjg4Pjgrrjg7vkurrmsJfjga/jgrnjgrPjgqLjgavkvb/nlKjjgZfjgarjgYTjgIIgKi8KY29uc3QgVUU9KCgpPT57CiAvKiDlrp/jg4fjg7zjgr/mpJzoqLzjgafpgIblirnmnpzjgaDjgaPjgZ/miJDliIbvvIjpqI7miYvjg7vplpPpmpTvvInjga/ml6LlrprjgadPRkYgKi8KIGNvbnN0IERFRkFVTFQ9e2pvY2tleTpmYWxzZSxsYXlvZmY6ZmFsc2V9OwogY29uc3QgY2xhbXA9KHgsYSxiKT0+TWF0aC5tYXgoYSxNYXRoLm1pbihiLHgpKTsKIGNvbnN0IHNpZ21vaWQ9eD0+MS8oMStNYXRoLmV4cCgteCkpOwogY29uc3QgbG9naXQ9cD0+e3A9Y2xhbXAocCwuMDAxLC45OTkpO3JldHVybiBNYXRoLmxvZyhwLygxLXApKX07CiBjb25zdCBubj1zPT5TdHJpbmcocz8/IiIpLm5vcm1hbGl6ZSgiTkZLQyIpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW1xzXHUzMDAwXSsvZywiIikucmVwbGFjZSgvW+ODu++9pS7vvI5cLeKAkOKAkeKAkuKAk+KAlOKAlSfigJlgXS9nLCIiKS5yZXBsYWNlKC9b4piG4piF4paz4pay4peH4peGXS9nLCIiKTsKIC8qIOmojuaJi+WQje+8muWFiOmgreOBruasp+Wtl+OCpOODi+OCt+ODo+ODq+OCkumZpOOBjeOAgeODh+ODoOODvOODreKGkuODh+ODoCDjgavmj4PjgYjjgovvvIhKUkHjga4gQy7jg4fjg6Djg7zjg60g44Go6YGO5Y6744OH44O844K/44GuIO+8o++8juODh+ODoCDjgpLkuIDoh7TjgZXjgZvjgovvvIkgKi8KIGNvbnN0IGpubj1zPT57bGV0IHY9bm4oU3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9cZHsyfSg/OlwuXGQpP1xzKig/OmtnfO+9i++9hykvZ2ksIiAiKS5yZXBsYWNlKC9b77yIKF1bXu+8iSldezAsOH1b77yJKV0vZywiICIpLnJlcGxhY2UoLyjmoJfmnbF8576O5rWmKS9nLCIgIikpO3Y9di5yZXBsYWNlKC9eW2Etel0oPz1b44KhLeODtuODvF0pLywiIik7dj12LnJlcGxhY2UoL17jg4fjg6Djg7zjg60vLCLjg4fjg6AiKTtyZXR1cm4gdn07CiAvKiDjgq/jg6njgrnjga7mrrXpmo7vvJowPeS4jeaYjiAvIC0xPeWcsOaWuSAvIDE95paw6aas44O75pyq5Yud5YipIC8gMj0x5YudIC8gMz0y5YudIC8gND0z5YudIC8gNT3jgqrjg7zjg5fjg7Pjg7vph43os54gKi8KIGNvbnN0IGxldmVsT2ZMYWJlbD10PT57Y29uc3Qgcz1TdHJpbmcodHx8IiIpO2lmKC/lnLDmlrl8TkFSLy50ZXN0KHMpKXJldHVybiAtMTtpZigv5paw6aasfOacquWLneWIqS8udGVzdChzKSlyZXR1cm4gMTtpZigvMeWLnXw1MDDkuIcvLnRlc3QocykpcmV0dXJuIDI7aWYoLzLli518MTAwMOS4hy8udGVzdChzKSlyZXR1cm4gMztpZigvM+WLnXwxNjAw5LiHLy50ZXN0KHMpKXJldHVybiA0O2lmKC/jgqrjg7zjg5fjg7N877yv77ywfE9QfOODquOCueODhuODg+ODiXzph43os55877ynfEdbMTIzSV0vaS50ZXN0KHMpKXJldHVybiA1O3JldHVybiAwfTsKIGNvbnN0IGxldmVsT2ZQcml6ZT1wPT57cD1OdW1iZXIocCk7cmV0dXJuICEocD4wKT8wOnA8PTcwMD8xOnA8PTkwMD8yOnA8PTEzMDA/MzpwPD0xODAwPzQ6NX07CiBjb25zdCBpc0pyYVZlbnVlPWM9Pi9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyhjfHwiIikpOwogY29uc3Qgc3VyZkNvZGU9cz0+e3M9U3RyaW5nKHN8fCIiKTtyZXR1cm4gL+iKnXx0dXJmL2kudGVzdChzKT8xOi/jg4B8ZGlydC9pLnRlc3Qocyk/Mjov6ZqcfGp1bXAvaS50ZXN0KHMpPzM6MH07CiBjb25zdCBkbnVtPWQ9Pk51bWJlcihTdHJpbmcoZHx8IiIpLnJlcGxhY2UoL1xEL2csIiIpLnNsaWNlKDAsOCkpfHwwOwogZnVuY3Rpb24gcGFyc2VEYXRlKHMpewogIHM9U3RyaW5nKHN8fCIiKTtsZXQgbT1zLm1hdGNoKC8oXGR7NH0pXER7MCw0fShcZHsxLDJ9KVxEezAsNH0oXGR7MSwyfSkvKTsKICBpZighbSlyZXR1cm4iIjtyZXR1cm4gYCR7bVsxXX0tJHttWzJdLnBhZFN0YXJ0KDIsIjAiKX0tJHttWzNdLnBhZFN0YXJ0KDIsIjAiKX1gOwogfQogZnVuY3Rpb24gY3N2Um93cyh0ZXh0KXsKICBjb25zdCBsaW5lcz1TdHJpbmcodGV4dHx8IiIpLnJlcGxhY2UoL15cdUZFRkYvLCIiKS5zcGxpdCgvXHI/XG4vKS5maWx0ZXIoeD0+eC50cmltKCkpOwogIGlmKCFsaW5lcy5sZW5ndGgpcmV0dXJuW107CiAgY29uc3Qgc3BsaXQ9bD0+e2NvbnN0IGE9W107bGV0IGM9IiIscT1mYWxzZTtmb3IobGV0IGk9MDtpPGwubGVuZ3RoO2krKyl7Y29uc3QgY2g9bFtpXTsKICAgaWYoY2g9PT0nIicpe2lmKHEmJmxbaSsxXT09PSciJyl7Yys9JyInO2krK31lbHNlIHE9IXF9ZWxzZSBpZihjaD09PSIsIiYmIXEpe2EucHVzaChjKTtjPSIifWVsc2UgYys9Y2h9YS5wdXNoKGMpO3JldHVybiBhfTsKICBjb25zdCBoZWFkPXNwbGl0KGxpbmVzWzBdKS5tYXAoeD0+eC50cmltKCkpO2NvbnN0IG91dD1bXTsKICBmb3IobGV0IGk9MTtpPGxpbmVzLmxlbmd0aDtpKyspe2NvbnN0IGE9c3BsaXQobGluZXNbaV0pLG89e307Zm9yKGxldCBqPTA7ajxoZWFkLmxlbmd0aDtqKyspb1toZWFkW2pdXT1hW2pdPz8iIjtvdXQucHVzaChvKX0KICByZXR1cm4gb3V0OwogfQogY29uc3QgZj12PT57Y29uc3Qgbj1wYXJzZUZsb2F0KFN0cmluZyh2Pz8iIikucmVwbGFjZSgvLC9nLCIiKSk7cmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKT9uOm51bGx9OwogLyog44OQ44OD44Kv44Ki44OD44OXL0NTVuOBrjHooYzihpLou73ph4/ooYwgKi8KIGZ1bmN0aW9uIHRvUm93KG8pewogIGNvbnN0IHNhPVN0cmluZyhvWyLmgKfpvaIiXXx8IiIpO2NvbnN0IGFtPXNhLm1hdGNoKC8oXGQrKS8pOwogIHJldHVybntyYWNlSWQ6U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/P29bIlVubmFtZWQ6IDAiXT8/IiIpLGRhdGU6cGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pLAogICBuYW1lOlN0cmluZyhvWyLppqzlkI0iXXx8by5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpubihvWyLppqzlkI0iXXx8by5ob3JzZSksam9ja2V5OmpubihvWyLpqI7miYsiXXx8by5qb2NrZXkpLGpuYW1lOlN0cmluZyhvWyLpqI7miYsiXXx8by5qb2NrZXl8fCIiKS50cmltKCksZmluaXNoOmYob1si552A6aCGIl0/P28uZmluaXNoKSwKICAgZGlzdDpmKG8uY291cnNlX2xlbj8/b1si6Led6ZuiIl0/P28uZGlzdGFuY2UpfHwwLHN1cmY6c3VyZkNvZGUoby5yYWNlX3R5cGV8fG9bIuiKneODgCJdfHxvLnN1cmZhY2UpLAogICBhZ2U6YW0/TnVtYmVyKGFtWzFdKTpudWxsLG51bTpmKG9bIummrOeVqiJdKSxwb3A6ZihvWyLkurrmsJciXSksb2RkczpmKG9bIuWNmOWLnSJdKSwKICAgbHZsOigoKT0+e2NvbnN0IGlkPVN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz8iIik7aWYoL15cZHsxMn0kLy50ZXN0KGlkKSYmIWlzSnJhVmVudWUoaWQuc2xpY2UoNCw2KSkpcmV0dXJuIC0xO3JldHVybiBsZXZlbE9mTGFiZWwob1siY2xhc3MiXXx8by5jbHMpfSkoKX07CiB9CiAvKiDmiJDnuL7jgrnjg4jjgqLvvIjml6Xku5jmmIfpoIbjgasgYWRkIOOBmeOCi++8iSAqLwogZnVuY3Rpb24gU3RvcmUoKXt0aGlzLmg9bmV3IE1hcCgpO3RoaXMuaj1uZXcgTWFwKCl9CiBTdG9yZS5wcm90b3R5cGUuYWRkPWZ1bmN0aW9uKHIpewogIGlmKHIuZmluaXNoPT1udWxsfHwhci5ob3JzZSlyZXR1cm47CiAgY29uc3QgdDM9ci5maW5pc2g+PTEmJnIuZmluaXNoPD0zPzE6MDsKICBsZXQgaD10aGlzLmguZ2V0KHIuaG9yc2UpO2lmKCFoKXRoaXMuaC5zZXQoci5ob3JzZSxoPXtuOjAsdG9wMzowLHdpbjowLHN1bTowLGxhc3Q6IiIscnVuczpbXSxsdjp7fX0pOwogIGgubisrO2gudG9wMys9dDM7aWYoci5maW5pc2g9PT0xKWgud2luKys7aC5zdW0rPXIuZmluaXNoO2lmKHIuZGF0ZT5oLmxhc3QpaC5sYXN0PXIuZGF0ZTsKICBjb25zdCBMPXIubHZsfHwwOyhoLmx2W0xdPWgubHZbTF18fFswLDBdKTtoLmx2W0xdWzBdKys7aC5sdltMXVsxXSs9dDM7CiAgaC5ydW5zLnB1c2goW2RudW0oci5kYXRlKSxyLmZpbmlzaCxyLmRpc3Qsci5zdXJmLExdKTtpZihoLnJ1bnMubGVuZ3RoPjYpe2gucnVucy5zb3J0KChhLGIpPT5hWzBdLWJbMF0pO2gucnVucy5zaGlmdCgpfQogIGlmKHIuam9ja2V5KXtsZXQgaj10aGlzLmouZ2V0KHIuam9ja2V5KTtpZighail0aGlzLmouc2V0KHIuam9ja2V5LGo9e246MCx0b3AzOjB9KTtqLm4rKztqLnRvcDMrPXQzfQogfTsKIC8qIOmojuaJi++8muWujOWFqOS4gOiHtOKGku+8iOefreOBhOihqOiomOOBquOCie+8ieWJjeaWueS4gOiHtOOBpzHkurrjgavntZ7jgozjgovjgajjgY3jgaDjgZHmjqHnlKggKi8KIFN0b3JlLnByb3RvdHlwZS5qb2NrZXk9ZnVuY3Rpb24obmFtZSl7CiAgaWYoIW5hbWUpcmV0dXJuIG51bGw7CiAgY29uc3Qgaj10aGlzLmouZ2V0KG5hbWUpO2lmKGopcmV0dXJuIGo7CiAgaWYobmFtZS5sZW5ndGg8Mnx8bmFtZS5sZW5ndGg+NClyZXR1cm4gbnVsbDsKICBpZighdGhpcy5famt8fHRoaXMuX2prU2l6ZSE9PXRoaXMuai5zaXplKXt0aGlzLl9qaz1bLi4udGhpcy5qLmtleXMoKV07dGhpcy5famtTaXplPXRoaXMuai5zaXplfQogIGNvbnN0IGM9dGhpcy5famsuZmlsdGVyKGs9Pmsuc3RhcnRzV2l0aChuYW1lKXx8KG5hbWUubGVuZ3RoPj0zJiZrLnN0YXJ0c1dpdGgobmFtZS5zbGljZSgwLC0xKSkmJm5hbWUubGVuZ3RoPD1rLmxlbmd0aCkpOwogIHJldHVybiBjLmxlbmd0aD09PTE/dGhpcy5qLmdldChjWzBdKTpudWxsOwogfTsKIGNvbnN0IGxheW9mZj0obGFzdCx0YXJnZXQpPT57aWYoIWxhc3QpcmV0dXJuIC41O2NvbnN0IGE9KG5ldyBEYXRlKHRhcmdldCktbmV3IERhdGUobGFzdCkpLzg2NGU1OwogIHJldHVybiBhPDIxPy43MjphPDYwPy42MjphPDEyMD8uNTU6YTwyNDA/LjQ4Oi40Mn07CiAvKiA9PT09PSDlrp/nuL7jgYvjgonlrabnv5LjgZfjgZ/jg6Ljg4fjg6vvvIjnibnlvrTph4/ihpIz552A5YaF546H77yJID09PT09ICovCiBjb25zdCBGTj1bImJpYXMiLCJvZmZzZXQiLCJubG9nIiwibm9IaXN0IiwiZlMiLCJmQyIsImF2Z0YiLCJyM3NoYXJlIiwicjNhdmciLCJsYXN0MSIsImxhc3RCaWciLCJjb25kRGlmZiIsImZpcnN0U3VyZiIsImdhcFNob3J0IiwiZ2FwTG9uZyIsImdhcFZMb25nIiwiYWdlMyIsImFnZTQiLCJhZ2U3Iiwic3RlcFVwIiwic3RlcERvd24iLCJ3aW5SYXRlIl07CiBjb25zdCBGSj1bImpSZWwiLCJqbG9nIiwiak1pc3MiXTsKIC8qIOS/guaVsOOBryB0b29scy9maXRfbW9kZWwuanMg44Gn5a2m57+S77yIMjAyMOW5tOOAnOOBruaZguezu+WIl+ODh+ODvOOCv++8ieOAgnt9IOOCkue9ruaPmyAqLwogY29uc3QgTU9ERUw9eyJjb3JlIjpbMC4wNTI5OSwwLjk5Njk3LDAuMDQ5NTEsLTAuMjQ1NDMsLTAuNTI4MTIsMC45MTk0NiwtMC41MTQ3NiwtMC4zNDc4NiwtMC41NzkwNCwtMC41NTExOCwwLjE2NzczLDEuMTE4MiwtMC4zNTMwNSwtMC4xMTEyOCwtMC4yMjcyOCwtMC40MDEyOSwwLjEzNzcxLDAuMjE2NjIsLTAuMzk2NzMsLTAuMzUzMDUsMC4wMDYxNywtMC41OTU2NF0sImZ1bGwiOlswLjQwNDMzLDEuMzcwMDcsMC4wNjI1MSwtMC4xMjI3OSwtMC41MDIzMiwwLjgyOTc4LC0wLjM5ODk1LC0wLjMwMDcyLC0wLjUxNTU5LC0wLjUyNTMyLDAuMTU4MzIsMS4wNjY5NSwtMC4zODM3NywtMC4wNzI4MiwtMC4yMjU2OCwtMC4zNTEsMC4xNTAyNSwwLjIxMjUzLC0wLjQxMzM0LC0wLjMyMzE5LDAuMDA3MjYsLTAuOTM3OTIsMC41MzU1NywwLjAwMzY1LC0wLjIwNjA1XX07CiBmdW5jdGlvbiBmZWF0cyhyLHN0b3JlLHJhY2UsTix3aXRoSil7CiAgY29uc3QgYj1jbGFtcCgzL04sLjA4LC41KSxsYj1sb2dpdChiKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLG49aD9oLm46MCxMdD1yYWNlLmx2bHx8MDsKICBjb25zdCBwUz0oKGg/aC50b3AzOjApKzMqYikvKG4rMyksZlM9bG9naXQocFMpLWxiOwogIC8vIOOCr+ODqeOCueijnOato++8muS9juOBhOOCr+ODqeOCue+8iOWcsOaWueOCkuWQq+OCgO+8ieOBp+OBruWlvei1sOOBr+WJsuOCiuW8leOBjeOAgemrmOOBhOOCr+ODqeOCueOBp+OBruWHoei1sOOBr+WJsuOCiuW8leOBjwogIGxldCBmQz1mUzsKICBpZihoJiZMdD4wKXtsZXQgSD0wLE09MDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoaC5sdikpe2NvbnN0IEw9TnVtYmVyKGspLFtjbixjdF09aC5sdltrXTtjb25zdCBnPUw9PT0wPzA6KEw8MD8tMjpMLUx0KTsKICAgIEgrPWN0KmNsYW1wKDErLjMqZywuNCwxLjgpO00rPShjbi1jdCkqY2xhbXAoMS0uMypnLC40LDEuOCl9CiAgIGZDPWxvZ2l0KChIKzMqYikvKEgrTSszKSktbGJ9CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxyYz1ydW5zLnNsaWNlKC0zKSxsYXN0Uj1ydW5zLmxlbmd0aD9ydW5zW3J1bnMubGVuZ3RoLTFdOm51bGw7CiAgY29uc3QgcjNzaGFyZT1yYy5sZW5ndGg/cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aC9yYy5sZW5ndGg6MDsKICBjb25zdCByM2F2Zz1yYy5sZW5ndGg/Y2xhbXAoKHJjLnJlZHVjZSgoYSx4KT0+YSt4WzFdLDApL3JjLmxlbmd0aC02KS82LC0xLDIpOjA7CiAgY29uc3QgbGFzdDE9bGFzdFI/Y2xhbXAoKGxhc3RSWzFdLTYpLzYsLTEsMik6MCxsYXN0QmlnPWxhc3RSJiZsYXN0UlsxXT49MTA/MTowOwogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDtsZXQgY29uZERpZmY9MCxmaXJzdFN1cmY9MDsKICBpZihzYyYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJighZGlzdHx8TWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKSk7CiAgIGlmKGNyLmxlbmd0aCljb25kRGlmZj0oY3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCsyKnBTKS8oY3IubGVuZ3RoKzIpLXBTOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSlmaXJzdFN1cmY9MX0KICBsZXQgZ2FwPW51bGw7aWYoaCYmaC5sYXN0JiZyYWNlLmRhdGUpZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogIGNvbnN0IGE9ci5hZ2V8fDA7CiAgY29uc3Qgc3RlcEQ9bGFzdFImJmxhc3RSWzRdPjAmJkx0PjA/Y2xhbXAoTHQtbGFzdFJbNF0sLTMsMyk6MDsKICBjb25zdCB4PVsxLGxiLE1hdGgubG9nKDErbiksbj09PTA/MTowLGZTLGZDLG4/Y2xhbXAoKGguc3VtL24tNikvNiwtMSwyKTowLHIzc2hhcmUscjNhdmcsbGFzdDEsbGFzdEJpZyxjb25kRGlmZixmaXJzdFN1cmYsCiAgIGdhcCE9bnVsbCYmZ2FwPDIxPzE6MCxnYXAhPW51bGwmJmdhcD4xMjA/MTowLGdhcCE9bnVsbCYmZ2FwPjI0MD8xOjAsYT09PTM/MTowLGE9PT00PzE6MCxhPj03PzE6MCxzdGVwRD4wP3N0ZXBEOjAsc3RlcEQ8MD8tc3RlcEQ6MCwKICAgbj8oKGgud2luKy4zKmIpLyhuKzEuNSktYik6MF07CiAgaWYod2l0aEope2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTsKICAgaWYoaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpO3gucHVzaChsb2dpdChwSiktbGIsTWF0aC5sb2coMStqLm4pLDApfWVsc2UgeC5wdXNoKDAsMCwxKX0KICByZXR1cm4geDsKIH0KIGNvbnN0IGRvdD0odyx4KT0+e2xldCB6PTA7Zm9yKGxldCBpPTA7aTx4Lmxlbmd0aDtpKyspeis9KHdbaV18fDApKnhbaV07cmV0dXJuIHp9OwogY29uc3QgbW9kZWxaPShraW5kLHgpPT5kb3QoTU9ERUxba2luZF0seCk7CiAvKiAx6aCt44Gu57Sg54K5KGxvZ2l0KeOBqOOCv+OCsOOAgmNvbXAg44Gn5oiQ5YiG44KST04vT0ZG44Gn44GN44KL77yI5qSc6Ki855So77yJICovCiBmdW5jdGlvbiBob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXA9e30pewogIGNvbXA9T2JqZWN0LmFzc2lnbih7fSxERUZBVUxULGNvbXApO2NvbnN0IHVzZT1rPT5jb21wW2tdIT09ZmFsc2UmJmNvbXBba10hPT0wOwogIGNvbnN0IGI9Y2xhbXAoMy9OLC4xLC41KSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLGo9c3RvcmUuai5nZXQoci5qb2NrZXkpOwogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10sbj1oP2gubjowLHRhZ3M9W107bGV0IHo9MCxjb25mPSLkvY4iOwogIGNvbnN0IHBIPSgoaD9oLnRvcDM6MCkrNCpiKS8obis0KTt6Kz1sb2dpdChwSCk7CiAgaWYobj49Miljb25mPW4+PTU/IumrmCI6IuS4rSI7ZWxzZSB0YWdzLnB1c2goe3Q6IuWxpeattOS4jei2syIsYzoiZyJ9KTsKICBpZihuPj0zKXtjb25zdCB0Mz1oLnRvcDMvbix3PWgud2luL247CiAgIGlmKHQzPj0uNDAmJnc8PS4yMCl0YWdzLnB1c2goe3Q6YOWWhOaIpuWeiyAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBlbHNlIGlmKHQzPj0uNDUpdGFncy5wdXNoKHt0OmDlronlrpogM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgaWYodXNlKCJhdmciKSYmaC5zdW0vbjw9NSl6Kz0uMTJ9CiAgY29uc3QgcmM9cnVucy5zbGljZSgtMyk7CiAgaWYodXNlKCJyZWNlbnQiKSYmcmMubGVuZ3RoPj0yKXtjb25zdCBjMz1yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLGF2Zz1yYy5yZWR1Y2UoKHMseCk9PnMreFsxXSwwKS9yYy5sZW5ndGg7CiAgIHorPS4yMiooYzMvcmMubGVuZ3RoLXBIKSozO2lmKGMzPj0yKXRhZ3MucHVzaCh7dDpg6L+RJHtyYy5sZW5ndGh96LWw44GnJHtjM33lm54z552A5YaFYCxjOiJiIn0pOwogICBjb25zdCBsYXN0PXJ1bnNbcnVucy5sZW5ndGgtMV07CiAgIGlmKGxhc3QmJmxhc3RbMV0+PTgmJm4+PTQmJmgudG9wMy9uPj0uMzUpe3orPS4xNTt0YWdzLnB1c2goe3Q6YOWJjei1sCR7bGFzdFsxXX3nnYDjgYvjgonlt7vjgY3ov5TjgZfkvZnlnLBgLGM6Im8ifSl9CiAgIGlmKGF2Zzw9NCYmcmMubGVuZ3RoPj0zKXorPS4wOH0KICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7CiAgaWYodXNlKCJjb25kIikmJnNjJiZkaXN0JiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmTWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKTsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpe3otPS4zNTt0YWdzLnB1c2goe3Q6YCR7c2M9PT0xPyLliJ3jga7oip0iOiLliJ3jga7jg4Djg7zjg4gife+8iOmBjuWOu+i1sOOBr+WIpemmrOWgtO+8iWAsYzoibyJ9KX0KICAgaWYoY3IubGVuZ3RoPj0yKXtjb25zdCB0Mz1jci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLHBjPSh0MysyKnBIKS8oY3IubGVuZ3RoKzIpOwogICAgeis9Y2xhbXAoMioocGMtcEgpLC0uNSwuNSk7aWYodDM+PTIpdGFncy5wdXNoKHt0OmDlkIzmnaHku7bjgacke3QzfS8ke2NyLmxlbmd0aH3lm54z552A5YaFYCxjOiJiIn0pfX0KICBpZih1c2UoImpvY2tleSIpJiZqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSksZGo9Y2xhbXAoLjYqKGxvZ2l0KHBKKS1sb2dpdChiKSksLS40LC41KTsKICAgeis9ZGo7aWYoZGo+PS4yNSl0YWdzLnB1c2goe3Q6YOmojuaJi+WlveiqvyAz552A5YaFJHtNYXRoLnJvdW5kKGoudG9wMy9qLm4qMTAwKX0lYCxjOiJiIn0pfQogIGlmKHVzZSgibGF5b2ZmIikmJmgmJmgubGFzdCl7Y29uc3QgZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogICB6Kz0uNioobGF5b2ZmKGgubGFzdCxyYWNlLmRhdGUpLS41KTtpZihnYXA+PTE4MCl0YWdzLnB1c2goe3Q6YCR7Z2FwfeaXpeOBtuOCimAsYzoibyJ9KX0KICBpZih1c2UoImFnZSIpKXtjb25zdCBhPXIuYWdlfHw1O2lmKGE9PT0zKXorPS4xMDtlbHNlIGlmKGE9PT00KXorPS4wNTtlbHNlIGlmKGE+PTgpe3otPS4xNTt0YWdzLnB1c2goe3Q6YCR7YX3mrbNgLGM6Im8ifSl9fQogIHJldHVybnt6LHRhZ3MsY29uZixufTsKIH0KIC8qIDIwMjPlubTku6XpmY3jga7mmYLns7vliJfmpJzoqLzjgafjga4g57Sg44Gu5aW96LWw546H4oaS56m044K+44O844Oz5a6f57i+77yI5bmz5Z2HcCwg5a6f57i+77yJICovCiBjb25zdCBDQUw9W1swLDAuMDFdLFswLjAyMiwwLjAxN10sWzAuMDQ2LDAuMDIyXSxbMC4wNzUsMC4wNDZdLFswLjEwNSwwLjA2OF0sWzAuMTM1LDAuMDgyXSxbMC4xNjUsMC4wOThdLFswLjE5MywwLjEwM10sWzAuMjI0LDAuMTM4XSxbMC4yNTksMC4xNjFdLFswLjMwMiwwLjE4N10sWzAuMzU4LDAuMjExXSxbMC40NTQsMC4yMjldXTsKIC8qIOOCquODg+OCuuOBquOBl+ODouODvOODie+8iOS6uuawl+OBruS7o+eQhu+8nemojuaJi+i+vOOBv+OBruWtpue/kuODouODh+ODq+OBrumghuS9jeOBp+eptOOCvuODvOODs+OCkuWIpOWumu+8ieOBruijnOato+ihqOOAgjIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafkvZzmiJAgKi8KIGNvbnN0IENBTF9QUk9YWT1bWzAsMC4wMTNdLFswLjAyMiwwLjAyMV0sWzAuMDQ2LDAuMDI4XSxbMC4wNzUsMC4wNTZdLFswLjEwNSwwLjA4Nl0sWzAuMTM1LDAuMTExXSxbMC4xNjUsMC4xMzRdLFswLjE5MywwLjE0Nl0sWzAuMjI0LDAuMjAxXSxbMC4yNTksMC4yMTldLFswLjMwMSwwLjI2MV0sWzAuMzU1LDAuMjk2XSxbMC40MzksMC4zNjddXTsKIGZ1bmN0aW9uIGludGVycChULHApe2ZvcihsZXQgaT0xO2k8VC5sZW5ndGg7aSsrKWlmKHA8PVRbaV1bMF0pe2NvbnN0W2EsYl09VFtpLTFdLFtjLGRdPVRbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIFRbVC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBjYWxpYkZvcihwLG1vZGUpe3JldHVybiBtb2RlPT09Im9kZHMiP2ludGVycChDQUwscCk6aW50ZXJwKENBTF9QUk9YWSxwKX0KIGZ1bmN0aW9uIGNhbGliKHApe2ZvcihsZXQgaT0xO2k8Q0FMLmxlbmd0aDtpKyspaWYocDw9Q0FMW2ldWzBdKXtjb25zdFthLGJdPUNBTFtpLTFdLFtjLGRdPUNBTFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gQ0FMW0NBTC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBub3JtYWxpemVUb3AzKHpzLHRvdGFsKXtsZXQgbG89LTgsaGk9ODsKICBmb3IobGV0IGk9MDtpPDYwO2krKyl7Y29uc3QgYz0obG8raGkpLzIscz16cy5yZWR1Y2UoKGEseik9PmErc2lnbW9pZCh6K2MpLDApO2lmKHM+dG90YWwpaGk9YztlbHNlIGxvPWN9CiAgY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHpzLm1hcCh6PT5zaWdtb2lkKHorYykpfQogLyogSGFydmlsbGXms5Xjgafli53njofihpIz552A5YaF546HICovCiBmdW5jdGlvbiB0b3AzRnJvbVdpbihwdyl7Y29uc3QgVD1wdy5yZWR1Y2UoKGEsYik9PmErYiwwKSxwPXB3Lm1hcCh4PT54L1QpLG49cC5sZW5ndGgsb3V0PW5ldyBBcnJheShuKS5maWxsKDApOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2xldCBzPXBbaV07CiAgIGZvcihsZXQgaj0wO2o8bjtqKyspaWYoaiE9PWkpe3MrPXBbal0qcFtpXS8oMS1wW2pdKTsKICAgIGZvcihsZXQgaz0wO2s8bjtrKyspaWYoayE9PWkmJmshPT1qKXMrPXBbal0qcFtrXS8oMS1wW2pdKSpwW2ldLygxLXBbal0tcFtrXSl9CiAgIG91dFtpXT1zfXJldHVybiBvdXR9CiAvKiDjg6zjg7zjgrnop6PmnpDjgIJvZGRzIOOBr+S7u+aEj++8iOWFqOmgreWIhu+8ieOAgiAqLwogY29uc3QgTFZOPVsi5LiN5piOIiwi5pyq5Yud5YipIiwiMeWLnSIsIjLli50iLCIz5YudIiwiT1AiXTsKIGZ1bmN0aW9uIGV4dHJhVGFncyh0YWdzLHIsc3RvcmUscmFjZSl7CiAgY29uc3QgdD10YWdzLnNsaWNlKCksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxMdD1yYWNlLmx2bHx8MDsKICBpZihoKXtjb25zdCBsYXN0PWgucnVucy5sZW5ndGg/aC5ydW5zW2gucnVucy5sZW5ndGgtMV06bnVsbDsKICAgaWYobGFzdCYmbGFzdFs0XT4wJiZMdD4wJiZsYXN0WzRdIT09THQpdC51bnNoaWZ0KGxhc3RbNF08THQ/e3Q6YOaYh+e0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6Im8ifTp7dDpg6ZmN57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoiYiJ9KTsKICAgaWYoaC5sdiYmaC5sdlstMV0pdC5wdXNoKHt0OiLlnLDmlrnjgafjga7lh7rotbDjgYLjgorvvIjlibLlvJXoqZXkvqHvvIkiLGM6ImcifSl9CiAgcmV0dXJuIHR9CiAvKiDnqbTppqzlgJnoo5zvvJrlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44KS5YSq5YWI44GX44Gm44CB5aW96LWw546H44Gu6auY44GE6aCG44GrIGsg6aCtICovCiBmdW5jdGlvbiBwaWNrKHJlcyxrKXtjb25zdCBob2xlPXJlcy5maWx0ZXIoeD0+eC5ob2xlKS5zb3J0KChhLGIpPT5iLnAtYS5wKTtyZXR1cm4gaG9sZS5maWx0ZXIoeD0+eC5uPj0zKS5jb25jYXQoaG9sZS5maWx0ZXIoeD0+eC5uPDMpKS5zbGljZSgwLGspfQogZnVuY3Rpb24gYW5hbHl6ZShyYWNlLHN0b3JlLG9kZHMsY29tcCxwb3BBcnIpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGg7CiAgY29uc3Qgc2M9Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wKSk7CiAgY29uc3QgemM9TU9ERUwuY29yZT9SLm1hcChyPT5tb2RlbFooImNvcmUiLGZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSkpOnNjLm1hcCh4PT54LnopOwogIGNvbnN0IHA9bm9ybWFsaXplVG9wMyh6YyxNYXRoLm1pbigzLE4pKTsKICBsZXQgbWt0PW51bGwscG9wPW51bGwsbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXtta3Q9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7cG9wPW9kZHMubWFwKG89PjErb2Rkcy5maWx0ZXIoeD0+eDxvKS5sZW5ndGgpO21vZGU9Im9kZHMifQogIGVsc2UgaWYocG9wQXJyJiZwb3BBcnIubGVuZ3RoPT09TiYmcG9wQXJyLmV2ZXJ5KHg9Png+MCkpe3BvcD1wb3BBcnIuc2xpY2UoKTttb2RlPSJvZGRzIn0gLy8g5a6f6Zqb44Gu5Lq65rCX6aCG5L2N44Gg44GR5YiG44GL44KL44Go44GN77yI57WQ5p6c44Oa44O844K455Sx5p2l77yJCiAgZWxzZXsgLy8g44Kq44OD44K644KC5Lq65rCX44KC44Gq44GE44Go44GN77ya6aiO5omL5oiQ57i+44G+44Gn5ZCr44KB44Gf44K544Kz44Ki44Gu6aCG5L2N44KS44CM5Lq65rCX44Gu5Luj55CG44CN44Gr44GZ44KL77yI5a6f6Zqb44Gu5Lq65rCX44Go44Gu55u46ZaiIDAuNTXihpIwLjY377yJCiAgIGNvbnN0IHB4PU1PREVMLmZ1bGw/Ui5tYXAocj0+bW9kZWxaKCJmdWxsIixmZWF0cyhyLHN0b3JlLHJhY2UsTix0cnVlKSkpOlIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4se2pvY2tleTp0cnVlLGxheW9mZjpmYWxzZX0pLnopO3BvcD1weC5tYXAodj0+MStweC5maWx0ZXIoeT0+eT52KS5sZW5ndGgpfQogIGNvbnN0IHJhbms9cC5tYXAodj0+MStwLmZpbHRlcih4PT54PnYpLmxlbmd0aCk7CiAgY29uc3QgY3V0PU1hdGgubWF4KDUsTWF0aC5jZWlsKE4qLjQpKTsKICByZXR1cm4gUi5tYXAoKHIsaSk9Pih7aSxubzpyLm51bXx8aSsxLG5hbWU6ci5uYW1lfHxyLmhvcnNlLHA6cFtpXSxwYzpjYWxpYkZvcihwW2ldLG1vZGUpLG1vZGUsCiAgIGpuOihzdG9yZS5qb2NrZXkoci5qb2NrZXkpfHx7bjowfSkubixyYW5rOnJhbmtbaV0scG9wOnBvcFtpXSxiYXNlOk1hdGgubWluKC41LDMvTiksCiAgIGNhcmVlcjooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP3tuOmgubix0MzpoLnRvcDMsd2luOmgud2lufTpudWxsfSkoKSwKICAgcmVjZW50OigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5ydW5zLm1hcCh4PT54WzFdKTpbXX0pKCksCiAgIGpuYW1lOnIuam5hbWV8fCIiLGpzdGF0OigoKT0+e2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTtyZXR1cm4gaiYmai5uPj0xP3tuOmoubixyYXRlOmoudG9wMy9qLm59Om51bGx9KSgpLAogICBob2xlOk4+PTYmJnBvcFtpXT49Y3V0LG1rdDpta3Q/bWt0W2ldOm51bGwsdmFsdWU6bWt0P2NhbGliRm9yKHBbaV0sIm9kZHMiKS9ta3RbaV06bnVsbCwKICAgdGFnczpleHRyYVRhZ3Moc2NbaV0udGFncyxyLHN0b3JlLHJhY2UpLGNvbmY6c2NbaV0uY29uZixuOnNjW2ldLm4sY3V0fSkpOwogfQoKIC8qIOaJleaIu+OBpOOBjeaZguezu+WIl+ODkOODg+OCr+ODhuOCueODiOOAgnJhY2VzIOOBr+aXpeS7mOaYh+mghiBbe2lkLGRhdGUscm93c31d44CBcGF5QnlJZCDjga8ge3JhY2VJZDp7cGxhY2U6W3tudW1iZXIseWVufV19feOAggogICAg56m044K+44O844Oz44Gv5a6f44Kq44OD44K66aCG5L2N44Gn5a6a576p77yI44OE44O844Or44Gu44Kq44OD44K65YWl5Yqb44Oi44O844OJ44Go5ZCM44GY54q25rOB77yJ44CC5ZCE44Os44O844K5MTAw5YaG44Ga44Gk6LO85YWl44CCICovCiBmdW5jdGlvbiBiYWNrdGVzdChyYWNlcyxwYXlCeUlkLG9wdHMpewogIG9wdHM9b3B0c3x8e307Y29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IiIsU1BMSVQ9b3B0cy5zcGxpdHx8IiIsT09TPW9wdHMub29zfHwiIjsKICBjb25zdCBuYW1lcz1bInRvcDEiLCJ0b3AyIiwidG9wMyIsImFsbEhvbGUiLCJ2YWx1ZSJdLHBlcj1bImFsbCIsIkEiLCJCIiwiQyJdOwogIGNvbnN0IFM9e307Zm9yKGNvbnN0IG4gb2YgbmFtZXMpe1Nbbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKVNbbl1bcF09e2JldHM6MCxoaXRzOjAscmV0OjAsc3E6MCxyYWNlczowfX0KICBjb25zdCBzdG9yZT1uZXcgU3RvcmUoKTtsZXQgdXNlZD0wOwogIGNvbnN0IGFkZD0obixwLGhpdCx5ZW4pPT57Y29uc3QgeD1TW25dW3BdO3guYmV0cysrO2lmKGhpdCl4LmhpdHMrKzt4LnJldCs9eWVuO3guc3ErPXllbip5ZW59OwogIGZvcihjb25zdCByYyBvZiByYWNlcyl7CiAgIC8vIOaJleaIu+OBrklE44Gv44CM5pel5LuYLemWi+WCrOWgtC1S55Wq5Y+344CN44CC44OQ44OD44Kv44Ki44OD44OX44GuMTLmoYFJROOBqOOCguOAgeWQjOOBmOW9ouW8j+OBrklE44Go44KC57WQ44Gz5LuY44GR44KLCiAgIGNvbnN0IHZPZj0vXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDQsNik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzNdfHwiIixyT2Y9TnVtYmVyKC9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoMTAsMTIpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVs0XXx8MCk7CiAgIGNvbnN0IHBheT1wYXlCeUlkW3JjLmlkXXx8cGF5QnlJZFtgJHtyYy5kYXRlfS0ke3ZPZn0tJHtTdHJpbmcock9mKS5wYWRTdGFydCgyLCIwIil9YF07CiAgIGlmKHBheSYmcGF5LnBsYWNlJiZwYXkucGxhY2UubGVuZ3RoJiZyYy5kYXRlPj1TVEFSVCl7CiAgICBjb25zdCBSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKTsKICAgIGNvbnN0IGhhc09kZHM9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5vZGRzPjEpLGhhc1BvcD1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLnBvcD4wKTsKICAgIGlmKGhhc09kZHN8fGhhc1BvcCl7CiAgICAgY29uc3QgcmFjZT17ZGF0ZTpyYy5kYXRlLHN1cmY6UlswXS5zdXJmLGRpc3Q6UlswXS5kaXN0LHJ1bm5lcnM6Un07CiAgICAgY29uc3QgcmVzPWhhc09kZHM/YW5hbHl6ZShyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpOmFuYWx5emUocmFjZSxzdG9yZSxudWxsLG51bGwsUi5tYXAocj0+ci5wb3ApKSx5ZW49bmV3IE1hcChwYXkucGxhY2UubWFwKHg9Plt4Lm51bWJlcix4Lnllbl0pKTsKICAgICBjb25zdCBob2xlPXJlcy5maWx0ZXIoeD0+eC5ob2xlKS5zb3J0KChhLGIpPT5iLnAtYS5wKTsKICAgICBpZihob2xlLmxlbmd0aCl7CiAgICAgIHVzZWQrKztjb25zdCBwcj1TUExJVD8ocmMuZGF0ZTxTUExJVD8iQSI6IkIiKToiQSI7CiAgICAgIGNvbnN0IHBpY2s9KG4sbGlzdCk9Pntmb3IoY29uc3QgeCBvZiBsaXN0KXtjb25zdCB5PXllbi5nZXQoUlt4LmldLm51bSl8fDA7YWRkKG4sImFsbCIseT4wLHkpO2FkZChuLHByLHk+MCx5KTtpZihPT1MmJnJjLmRhdGU+PU9PUylhZGQobiwiQyIseT4wLHkpfX07CiAgICAgIHBpY2soInRvcDEiLGhvbGUuc2xpY2UoMCwxKSk7cGljaygidG9wMiIsaG9sZS5zbGljZSgwLDIpKTtwaWNrKCJ0b3AzIixob2xlLnNsaWNlKDAsMykpO3BpY2soImFsbEhvbGUiLGhvbGUpOwogICAgICBwaWNrKCJ2YWx1ZSIsaG9sZS5maWx0ZXIoeD0+eC52YWx1ZT49MS4zKSk7CiAgICAgfQogICAgfQogICB9CiAgIGZvcihjb25zdCByIG9mIHJjLnJvd3Mpc3RvcmUuYWRkKHIpOwogIH0KICBjb25zdCBmaW49e307CiAgZm9yKGNvbnN0IG4gb2YgbmFtZXMpe2ZpbltuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpe2NvbnN0IHg9U1tuXVtwXTsKICAgaWYoIXguYmV0cyl7ZmluW25dW3BdPXtiZXRzOjB9O2NvbnRpbnVlfQogICBjb25zdCBtZWFuPXgucmV0L3guYmV0cyxzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnNxL3guYmV0cy1tZWFuKm1lYW4pKTsKICAgZmluW25dW3BdPXtiZXRzOnguYmV0cyxoaXRSYXRlOnguaGl0cy94LmJldHMscm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4LmJldHMpLzEwMH19fQogIHJldHVybntyYWNlczp1c2VkLHN0YXRzOmZpbn07CiB9CiByZXR1cm57cGljayxmZWF0cyxNT0RFTCxGTixGSixsZXZlbE9mTGFiZWwsbGV2ZWxPZlByaXplLGJhY2t0ZXN0LGNhbGliLGNhbGliRm9yLGpubixubix0b1Jvdyxjc3ZSb3dzLFN0b3JlLGFuYWx5emUsaG9yc2VTY29yZSxub3JtYWxpemVUb3AzLHRvcDNGcm9tV2luLHN1cmZDb2RlLHBhcnNlRGF0ZX07Cn0pKCk7CgoKLyogPT09PT0g44Ki44OX44Oq5pys5L2TID09PT09ICovCmNvbnN0ICQ9aWQ9PmRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsKY29uc3QgZXNjPXM9PlN0cmluZyhzPz8iIikucmVwbGFjZSgvWyY8PiInXS9nLG09Pih7IiYiOiImYW1wOyIsIjwiOiImbHQ7IiwiPiI6IiZndDsiLCciJzoiJnF1b3Q7IiwiJyI6IiYjMzk7In1bbV0pKTsKY29uc3Qgc2xlZXA9KG1zPTApPT5uZXcgUHJvbWlzZShyPT5zZXRUaW1lb3V0KHIsbXMpKTsKZnVuY3Rpb24gYnVzeShvbixtc2c9IuWHpueQhuS4reKApiIpeyQoImJ1c3kiKS5zdHlsZS5kaXNwbGF5PW9uPyJmbGV4Ijoibm9uZSI7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1tc2d9CmxldCBEQj1udWxsLFNUT1JFPW51bGwsU1RPUkVfS0VZPSIiLENVUj1udWxsLExBU1RSRVM9bnVsbDsKY29uc3QgVkVOVUU9eyIwMSI6IuacreW5jCIsIjAyIjoi5Ye96aSoIiwiMDMiOiLnpo/ls7YiLCIwNCI6IuaWsOa9nyIsIjA1Ijoi5p2x5LqsIiwiMDYiOiLkuK3lsbEiLCIwNyI6IuS4reS6rCIsIjA4Ijoi5Lqs6YO9IiwiMDkiOiLpmKrnpZ4iLCIxMCI6IuWwj+WAiSJ9OwoKLyogLS0tIEluZGV4ZWREQu+8iOOBk+OBruODhOODvOODq+WwgueUqO+8iSAtLS0gKi8KZnVuY3Rpb24gb3BlbkRCKCl7cmV0dXJuIG5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCByPWluZGV4ZWREQi5vcGVuKCJ1cHNldF90b29sX2RiIiwyKTsKIHIub251cGdyYWRlbmVlZGVkPWU9Pntjb25zdCBkPWUudGFyZ2V0LnJlc3VsdDtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJmaWxlcyIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoImZpbGVzIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygibWV0YSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoIm1ldGEiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJwYXkiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJwYXkiKX07CiByLm9uc3VjY2Vzcz0oKT0+e0RCPXIucmVzdWx0O29rKCl9O3Iub25lcnJvcj0oKT0+bmcoci5lcnJvcik7ci5vbmJsb2NrZWQ9KCk9Pm5nKG5ldyBFcnJvcigi5LuW44Gu44K/44OW44Gn5L2/55So5Lit44Gn44GZIikpfSl9CmNvbnN0IGlkYkFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oImZpbGVzIikub2JqZWN0U3RvcmUoImZpbGVzIikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoImZpbGVzIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgaWRiQ2xlYXI9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpLHN0PXQub2JqZWN0U3RvcmUoImZpbGVzIik7c3Qub3BlbkN1cnNvcigpLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7aWYoIVN0cmluZyhjLmtleSkuc3RhcnRzV2l0aCgibGl2ZToiKSljLmRlbGV0ZSgpO2MuY29udGludWUoKX19O3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CgovKiDlj5bjgorovrzjgb/muIjjgb/jga7lhajooYzvvIjjg5Djg4Pjgq/jgqLjg4Pjg5dDU1bvvIvlj5blvpfmuIjjgb/jga7miJDnuL7vvInjgpLpoIbjgavmuKHjgZkgKi8KYXN5bmMgZnVuY3Rpb24gZm9yRWFjaFJvdyhjYil7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7Y29uc3QgZj1mc1tpXTsKICBpZihmLmxpdmUpe2Zvcihjb25zdCB4IG9mIGYucm93c3x8W10pY2IobGl2ZVJvdyh4KSl9CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSljYihVRS50b1JvdyhvKSk7CiAgaWYoaSUzPT09Milhd2FpdCBzbGVlcCgwKX0KfQovKiDjg6zjg7zjgrlJROOBi+OCiemWi+WCrOWgtOODu1Lnlarlj7fvvIgxMuahgeOBrkpSQeW9ouW8j++8j+aXpeS7mC3plovlgqzloLQtUuW9ouW8j+OBruS4oeWvvuW/nO+8iSAqLwpmdW5jdGlvbiB2ZW51ZU9mSWQoaWQpe3JldHVybiAvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzNdfHwiIn0KZnVuY3Rpb24gcmFjZU5vT2ZJZChpZCl7cmV0dXJuIE51bWJlcigvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDEwLDEyKTpTdHJpbmcoaWQpLnNwbGl0KCItIilbNF18fDApfQoKLyogLS0tIOWPluOCiui+vOOBvyAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gaW1wb3J0RmlsZShmaWxlKXsKIGJ1c3kodHJ1ZSwi44OV44Kh44Kk44Or44KS6Kqt44G/6L6844G/5Lit4oCmXG7lpKfjgY3jgYTjg5XjgqHjgqTjg6vjga/mlbDljYHnp5LjgYvjgYvjgorjgb7jgZnjgIIiKTthd2FpdCBzbGVlcCgzMCk7CiB0cnl7CiAgY29uc3QgdGV4dD1hd2FpdCBmaWxlLnRleHQoKTtsZXQgaXRlbXM7CiAgaWYoL1wuY3N2JC9pLnRlc3QoZmlsZS5uYW1lKSl7aXRlbXM9W3t0eXBlOiJyYWNlLXJlc3VsdHMiLHllYXI6MCxwbGFjZTpmaWxlLm5hbWUsY3N2OnRleHR9XX0KICBlbHNle2NvbnN0IGo9SlNPTi5wYXJzZSh0ZXh0KTtpdGVtcz1BcnJheS5pc0FycmF5KGopP2o6KGouZmlsZXN8fFtqXSl9CiAgaXRlbXM9aXRlbXMuZmlsdGVyKHg9PngmJnR5cGVvZiB4LmNzdj09PSJzdHJpbmciKTsKICBpZighaXRlbXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigiY3N244KS5ZCr44KA44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44CC44OQ44OD44Kv44Ki44OD44OXSlNPTuOBi+OAgUNTVuOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgiIpOwogIGF3YWl0IGlkYkNsZWFyKCk7bGV0IG49MDsKICBmb3IobGV0IGk9MDtpPGl0ZW1zLmxlbmd0aDtpKyspe2NvbnN0IGl0PWl0ZW1zW2ldO2F3YWl0IGlkYlB1dChgJHtpdC55ZWFyfToke2l0LnBsYWNlfToke2l9YCx7eWVhcjppdC55ZWFyLHBsYWNlOml0LnBsYWNlLHBsYWNlTmFtZTppdC5wbGFjZU5hbWUsY3N2Oml0LmNzdn0pOwogICBuKz1NYXRoLm1heCgwLGl0LmNzdi5zcGxpdCgiXG4iKS5sZW5ndGgtMSk7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1g5L+d5a2Y5Lit4oCmICR7aSsxfS8ke2l0ZW1zLmxlbmd0aH1gO2F3YWl0IHNsZWVwKDApfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5bjgorovrzjgb/lrozkuobvvJoke2l0ZW1zLmxlbmd0aH3jg5XjgqHjgqTjg6vvvI/ntIQke24udG9Mb2NhbGVTdHJpbmcoKX3ooYw8L3NwYW4+YDsKIH1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5Y+W44KK6L6844G/44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7YnVzeShmYWxzZSl9Cn0KYXN5bmMgZnVuY3Rpb24gc2hvd1N0YXRlKCl7CiB0cnl7Y29uc3QgZnM9YXdhaXQgaWRiQWxsKCkscHM9YXdhaXQgcGF5QWxsKCk7CiAgY29uc3QgYmFzZT1mcy5maWx0ZXIoZj0+IWYubGl2ZSksbGl2ZT1mcy5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoKTsKICBpZighZnMubGVuZ3RoJiYhcHMubGVuZ3RoKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+44OH44O844K/5pyq5Y+W5b6X44Gn44GZ44CC5LiK44Gu44CM6YGO5Y675oiQ57i+44Go5omV5oi744KS5Y+W5b6X44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IGxkPWxpdmUubWFwKGY9PmYuZGF0ZSkuc29ydCgpLG5SYWNlcz1saXZlLnJlZHVjZSgocyxmKT0+cytuZXcgU2V0KGYucm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplLDApOwogIGxldCBoPSIiOwogIGlmKGxpdmUubGVuZ3RoKWgrPWA8c3BhbiBjbGFzcz0iZ29vZCI+5Y+W5b6X5riI44G/44Gu5oiQ57i+77yaJHtsaXZlLmxlbmd0aH3ml6XvvI8ke25SYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iCR7bGRbMF1944CcJHtsZFtsZC5sZW5ndGgtMV1977yJPC9zcGFuPmA7CiAgaWYoYmFzZS5sZW5ndGgpe2NvbnN0IHlzPVsuLi5uZXcgU2V0KGJhc2UubWFwKGY9PmYueWVhcikpXS5zb3J0KCk7aCs9KGg/IlxuIjoiIikrYDxzcGFuIGNsYXNzPSJnb29kIj7jg5Djg4Pjgq/jgqLjg4Pjg5fvvJoke2Jhc2UubGVuZ3RofeODleOCoeOCpOODq++8iCR7eXNbMF18fCItIn3jgJwke3lzW3lzLmxlbmd0aC0xXXx8Ii0ifeW5tO+8iTwvc3Bhbj5gfQogIGNvbnN0IHByPXBzLnJlZHVjZSgocyxwKT0+cysocC5yYWNlc3x8W10pLmxlbmd0aCwwKTsKICBoKz0oaD8iXG4iOiIiKSsocHMubGVuZ3RoP2A8c3BhbiBjbGFzcz0iZ29vZCI+5omV5oi777yaJHtwcy5sZW5ndGh95pel77yPJHtwci50b0xvY2FsZVN0cmluZygpfeODrOODvOOCuTwvc3Bhbj5gOic8c3BhbiBjbGFzcz0id2FybiI+5omV5oi777ya5pyq5Y+W5b6XPC9zcGFuPicpOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9aDsKIH1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+56K66KqN44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlKX08L3NwYW4+YH0KfQovKiBXb3JrZXLjga4gL3Jlc3VsdHMg44Gu6KGMIOKGkiDjg4Tjg7zjg6vlhoXpg6jjga7ooYwgKi8KZnVuY3Rpb24gbGl2ZVJvdyh4KXtjb25zdCBmPXBhcnNlRmxvYXQoU3RyaW5nKHguZmluaXNoPz8iIikucmVwbGFjZSgvW15cZC5dL2csIiIpKTsKIHJldHVybntyYWNlSWQ6U3RyaW5nKHgucmFjZUlkfHwiIiksZGF0ZTpVRS5wYXJzZURhdGUoeC5kYXRlKSxuYW1lOlN0cmluZyh4LmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOlVFLm5uKHguaG9yc2UpLGpvY2tleTpVRS5qbm4oeC5qb2NrZXkpLAogIGZpbmlzaDpOdW1iZXIuaXNGaW5pdGUoZikmJmY+MD9mOm51bGwsZGlzdDpOdW1iZXIoeC5kaXN0YW5jZSl8fDAsc3VyZjpVRS5zdXJmQ29kZSh4LnN1cmZhY2UpLGFnZTpOdW1iZXIoeC5hZ2UpfHxudWxsLG51bTpOdW1iZXIoeC5udW1iZXIpfHxudWxsLHBvcDpOdW1iZXIoeC5wb3ApPjA/TnVtYmVyKHgucG9wKTpudWxsLG9kZHM6bnVsbCxqbmFtZTpTdHJpbmcoeC5qb2NrZXl8fCIiKS50cmltKCksCiAgbHZsOih4LnZlbnVlQ29kZSYmIS9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyh4LnZlbnVlQ29kZSkpKT8tMTooVUUubGV2ZWxPZkxhYmVsKHguY2xzKXx8VUUubGV2ZWxPZlByaXplKHgucHJpemUpKX19Ci8qIOWvvuixoeaXpeOCiOOCiuWJjeOBruWxpeattOOBoOOBkeOBp+OCueODiOOCouOCkuS9nOOCiyAqLwphc3luYyBmdW5jdGlvbiBidWlsZFN0b3JlKHRhcmdldCl7CiBpZihTVE9SRSYmU1RPUkVfS0VZPT09dGFyZ2V0KXJldHVybiBTVE9SRTsKIGNvbnN0IGZzPWF3YWl0IGlkYkFsbCgpO2lmKCFmcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLpgY7ljrvjg4fjg7zjgr/jgYzmnKrnmbvpjLLjgafjgZnjgIIiKTsKIGNvbnN0IHN0PW5ldyBVRS5TdG9yZSgpO2xldCByb3dzPTAsdXNlZD0wOwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXsKICBidXN5KHRydWUsYOmBjuWOu+ODh+ODvOOCv+OCkumbhuioiOS4reKApiAke2krMX0vJHtmcy5sZW5ndGh9XG7vvIgke3RhcmdldH3jgojjgorliY3jga7jgb/kvb/nlKjvvIlgKTsKICBpZihmc1tpXS5saXZlKXtmb3IoY29uc3QgeCBvZiBmc1tpXS5yb3dzfHxbXSl7Y29uc3Qgcj1saXZlUm93KHgpO3Jvd3MrKztpZighci5kYXRlfHxyLmRhdGU+PXRhcmdldHx8IXIuaG9yc2UpY29udGludWU7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlfX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZnNbaV0uY3N2KSl7Y29uc3Qgcj1VRS50b1JvdyhvKTtyb3dzKys7aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXQpY29udGludWU7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlfQogIGF3YWl0IHNsZWVwKDApOwogfQogYnVzeShmYWxzZSk7U1RPUkU9c3Q7U1RPUkVfS0VZPXRhcmdldDtTVE9SRS5jb3VudD11c2VkO3JldHVybiBzdDsKfQoKLyogLS0tIOODrOODvOOCuemBuOaKniAtLS0gKi8KZnVuY3Rpb24gc2hvd1BhbmUoayl7Zm9yKGNvbnN0IHAgb2ZbIldvcmtlciIsIk1hbnVhbCIsIlBhc3QiXSkkKCJwYW5lIitwKS5zdHlsZS5kaXNwbGF5PXA9PT1rPyJibG9jayI6Im5vbmUifQokKCJ0YWJXb3JrZXIiKS5vbmNsaWNrPSgpPT5zaG93UGFuZSgiV29ya2VyIik7JCgidGFiTWFudWFsIikub25jbGljaz0oKT0+c2hvd1BhbmUoIk1hbnVhbCIpOyQoInRhYlBhc3QiKS5vbmNsaWNrPSgpPT5zaG93UGFuZSgiUGFzdCIpOwpmdW5jdGlvbiBzZXRSYWNlKHJhY2UsbGFiZWwpe2lmKHJhY2Uua2V5JiYhcmFjZS5vZGRzMClyYWNlLm9kZHMwPW9kZHNGb3IocmFjZSk7Q1VSPXJhY2U7TEFTVFJFUz1udWxsOyQoInJhY2VsYWJlbCIpLnRleHRDb250ZW50PWxhYmVsOyQoInJ1biIpLmRpc2FibGVkPWZhbHNlOyQoIm91dCIpLnRleHRDb250ZW50PSLjgIzop6PmnpDjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIifQoKLyogV29ya2VyICovCmxldCBXUkFDRVM9W107CmxldCBXRElBRz1bXTsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hDYXJkcyhiYXNlLGQsdmVudWVDb2RlKXsKIGNvbnN0IHE9dmVudWVDb2RlP2AmdmVudWU9JHtlbmNvZGVVUklDb21wb25lbnQodmVudWVDb2RlKX1gOiIiO2xldCBlcnI9IiI7CiBmb3IobGV0IHQ9MDt0PDM7dCsrKXsKICB0cnl7Y29uc3Qgcj1hd2FpdCBmZXRjaChgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHtlbmNvZGVVUklDb21wb25lbnQoZCl9JHtxfWApOwogICBpZighci5vayl7bGV0IG09IiI7dHJ5e209KGF3YWl0IHIuanNvbigpKS5lcnJvcnx8IiJ9Y2F0Y2h7fXRocm93IG5ldyBFcnJvcihgSFRUUCAke3Iuc3RhdHVzfSAke219YC50cmltKCkpfQogICBjb25zdCB4PWF3YWl0IHIuanNvbigpO3JldHVybntyYWNlczpBcnJheS5pc0FycmF5KHgpP3g6KHgucmFjZXN8fFtdKSx3YXJuaW5nOngud2FybmluZ3x8IiJ9fQogIGNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7YXdhaXQgc2xlZXAoMTIwMCoodCsxKSl9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyfHwi5Y+W5b6X44Gn44GN44G+44Gb44KTIik7Cn0KZnVuY3Rpb24gcmVuZGVyVmVudWVCdXR0b25zKGQpewogY29uc3QgbmFtZXM9Wy4uLm5ldyBTZXQoV1JBQ0VTLm1hcChyPT5yLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiIpKV07CiBsZXQgaD1uYW1lcy5tYXAoKHYsaSk9PmA8YnV0dG9uIGRhdGEtdj0iJHtpfSIgY2xhc3M9InN1YiI+JHtlc2Modil977yIJHtXUkFDRVMuZmlsdGVyKHI9PihyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiIpPT09dikubGVuZ3RofVLvvIk8L2J1dHRvbj5gKS5qb2luKCIiKTsKIGgrPVdESUFHLmZpbHRlcih4PT54LmVycnx8eC5lbXB0eXx8eC5wYXJ0aWFsKS5tYXAoeD0+YDxkaXYgY2xhc3M9Indhcm4gc21hbGwiPiR7ZXNjKHgubmFtZSl977yaJHt4LmVycj8i5Y+W5b6X5aSx5pWX77yIIitlc2MoeC5lcnIpLnNsaWNlKDAsNDAwKSsi77yJIjp4LnBhcnRpYWw/YCR7eC5jb3VudH1S44GX44GL5Y+W5b6X44Gn44GN44Gm44GE44G+44Gb44KT77yI6YCa5bi444GvMTDjgJwxMlLvvIlgOmDlh7rotbDppqzjgpLoqq3jgoHjgarjgYvjgaPjgZ/jg6zjg7zjgrkgJHt4LmVtcHR5fVLvvIjpmaTlpJbvvIlgfSA8YnV0dG9uIGNsYXNzPSJzdWIiIGRhdGEtcmV0cnk9IiR7ZXNjKHguY29kZXx8IiIpfSI+5YaN5Y+W5b6XPC9idXR0b24+PC9kaXY+YCkuam9pbigiIik7CiAkKCJ3bGlzdCIpLmlubmVySFRNTD1oOwogJCgid2xpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS12XSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5saXN0VmVudWUobmFtZXNbYi5kYXRhc2V0LnZdLGQpKTsKICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtcmV0cnldIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PmxvYWRWZW51ZShkLHt2ZW51ZUNvZGU6Yi5kYXRhc2V0LnJldHJ5LHZlbnVlTmFtZToiIn0sdHJ1ZSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGxvYWRWZW51ZShkLHYscmVyZW5kZXIpewogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiBjb25zdCBwcmV2PVdESUFHLmZpbmQoeD0+U3RyaW5nKHguY29kZSk9PT1TdHJpbmcodi52ZW51ZUNvZGUpKTsKIFdSQUNFUz1XUkFDRVMuZmlsdGVyKHI9PlN0cmluZyhyLnZlbnVlQ29kZSkhPT1TdHJpbmcodi52ZW51ZUNvZGUpKTsKIFdESUFHPVdESUFHLmZpbHRlcih4PT5TdHJpbmcoeC5jb2RlKSE9PVN0cmluZyh2LnZlbnVlQ29kZSkpOwogY29uc3QgbmFtZT12LnZlbnVlTmFtZXx8KHByZXYmJnByZXYubmFtZSl8fHYudmVudWVDb2RlOwogdHJ5e2NvbnN0IHtyYWNlc309YXdhaXQgZmV0Y2hDYXJkcyhiYXNlLGQsdi52ZW51ZUNvZGUpOwogIGNvbnN0IG9rPXJhY2VzLmZpbHRlcihhPT4oYS5ob3JzZXN8fGEucnVubmVyc3x8W10pLmxlbmd0aCksZW1wdHk9cmFjZXMubGVuZ3RoLW9rLmxlbmd0aDsKICBXUkFDRVMucHVzaCguLi5vayk7CiAgY29uc3QgZXJycz1yYWNlcy5maWx0ZXIoYT0+YS5lcnJvcikubWFwKGE9PmEuZXJyb3IpOwogIFdESUFHLnB1c2goe2NvZGU6di52ZW51ZUNvZGUsbmFtZSxjb3VudDpvay5sZW5ndGgsZW1wdHkscGFydGlhbDpvay5sZW5ndGg+MCYmb2subGVuZ3RoPDEwLGVycjohcmFjZXMubGVuZ3RoPyLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiOighb2subGVuZ3RoJiZlcnJzLmxlbmd0aD9lcnJzWzBdOiIiKX0pOwogfWNhdGNoKGUpe1dESUFHLnB1c2goe2NvZGU6di52ZW51ZUNvZGUsbmFtZSxjb3VudDowLGVtcHR5OjAsZXJyOmUubWVzc2FnZX0pfQogaWYocmVyZW5kZXIpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l++8iCR7V0RJQUcubWFwKHg9PmAke3gubmFtZX0ke3guY291bnR9UmApLmpvaW4oIu+8jyIpfe+8iWA7JCgid2FsbCIpLmRpc2FibGVkPSFXUkFDRVMubGVuZ3RoOyQoIm9kZHNHZXQiKS5kaXNhYmxlZD0hV1JBQ0VTLmxlbmd0aDtyZW5kZXJWZW51ZUJ1dHRvbnMoZCl9Cn0KJCgid2dldCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgZD0kKCJ3ZGF0ZSIpLnZhbHVlO2lmKCFkKXJldHVybiBhbGVydCgi5pel5LuY44KS6YG45oqe44GX44Gm44GP44Gg44GV44GE44CCIik7CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5YKs5aC044KS56K66KqN5Lit4oCmIjskKCJ3bGlzdCIpLmlubmVySFRNTD0iIjskKCJhbGxvdXQiKS5pbm5lckhUTUw9IiI7V1JBQ0VTPVtdO1dESUFHPVtdO1dEQVRFPWQ7JCgid2FsbCIpLmRpc2FibGVkPXRydWU7JCgib2Rkc0dldCIpLmRpc2FibGVkPXRydWU7T0REUz17fTsKIGxldCB2ZW51ZXM9bnVsbDsKIGxldCBsaXN0RGlhZz0iIixhdmFpbERhdGVzPVtdO0FWQUlMPVtdOwogdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSZsaXN0PTFgKTtpZihyLm9rKXtjb25zdCB4PWF3YWl0IHIuanNvbigpO3ZlbnVlcz14LnZlbnVlc3x8W107YXZhaWxEYXRlcz14LmF2YWlsYWJsZURhdGVzfHxbXTtBVkFJTD1hdmFpbERhdGVzO2lmKCF2ZW51ZXMubGVuZ3RoKWxpc3REaWFnPUpTT04uc3RyaW5naWZ5KHguZGlhZ25vc3RpY3N8fFtdKS5zbGljZSgwLDUwMCl9fWNhdGNoKGUpe30KIHRyeXsKICBpZih2ZW51ZXMmJiF2ZW51ZXMubGVuZ3RoJiZhdmFpbERhdGVzLmxlbmd0aCYmIWF2YWlsRGF0ZXMuaW5jbHVkZXMoZCkpewogICAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZH0g44GvSlJB44Gu6ZaL5YKs5pel44Gn44Gv44GC44KK44G+44Gb44KT44CCXG7lhazplovkuK3jga7plovlgqzml6XvvJoke2F2YWlsRGF0ZXMuam9pbigi44CBIil9YDsKICAgJCgid2xpc3QiKS5pbm5lckhUTUw9YXZhaWxEYXRlcy5tYXAoeD0+YDxidXR0b24gY2xhc3M9InN1YiIgZGF0YS1kPSIke3h9Ij4ke3h9PC9idXR0b24+YCkuam9pbigiIik7CiAgICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtZF0iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+eyQoIndkYXRlIikudmFsdWU9Yi5kYXRhc2V0LmQ7JCgid2dldCIpLmNsaWNrKCl9KTsKICAgcmV0dXJuOwogIH0KICBpZih2ZW51ZXMmJnZlbnVlcy5sZW5ndGgpewogICBmb3IoY29uc3QgdiBvZiB2ZW51ZXMpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1g5Y+W5b6X5Lit4oCmICR7di52ZW51ZU5hbWV977yIJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l+a4iOOBv++8iWA7YXdhaXQgbG9hZFZlbnVlKGQsdixmYWxzZSl9CiAgfWVsc2V7CiAgIC8vIOaXp1dvcmtlcuetieOBp+mWi+WCrOWgtOS4gOimp+OBjOS9v+OBiOOBquOBhOWgtOWQiO+8mjHml6XliIbjgpLkuIDmi6zlj5blvpcKICAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLkuIDmi6zlj5blvpfkuK3igKYiOwogICBjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLCIiKTsKICAgY29uc3Qgb2s9cmFjZXMuZmlsdGVyKGE9PihhLmhvcnNlc3x8YS5ydW5uZXJzfHxbXSkubGVuZ3RoKTtXUkFDRVM9b2s7CiAgIGlmKHJhY2VzLmxlbmd0aD5vay5sZW5ndGgpV0RJQUcucHVzaCh7Y29kZToiIixuYW1lOiLkuIDpg6giLGNvdW50Om9rLmxlbmd0aCxlbXB0eTpyYWNlcy5sZW5ndGgtb2subGVuZ3RoLGVycjoiIn0pOwogIH0KICBpZighV1JBQ0VTLmxlbmd0aCl7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLlh7rotbDppqzjgaTjgY3jga7jg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpPjgafjgZfjgZ/jgIJcbiIrV0RJQUcubWFwKHg9PmAke3gubmFtZX3vvJoke3guZXJyfHwi5Ye66LWw6aas44Gq44GXIn1gKS5qb2luKCJcbiIpKyhsaXN0RGlhZz8iXG7oqLrmlq3vvJoiK2xpc3REaWFnOiIiKTtyZW5kZXJWZW51ZUJ1dHRvbnMoZCk7cmV0dXJufQogICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l2ArKFdESUFHLmxlbmd0aD9g77yIJHtXRElBRy5tYXAoeD0+YCR7eC5uYW1lfSR7eC5jb3VudH1SYCkuam9pbigi77yPIil977yJYDoiIik7CiAgJCgid2FsbCIpLmRpc2FibGVkPWZhbHNlOyQoIm9kZHNHZXQiKS5kaXNhYmxlZD1mYWxzZTtyZW5kZXJWZW51ZUJ1dHRvbnMoZCk7CiB9Y2F0Y2goZSl7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLlj5blvpfjgqjjg6njg7zvvJoiK2UubWVzc2FnZSsiXG7vvIhXb3JrZXLjgYzmnKrlhazplovvvI9DT1JT77yP5pel5LuY44Gr6ZaL5YKs44Gq44GX44CB44Gu5Y+v6IO95oCn77yJIn0KfTsKZnVuY3Rpb24gbGlzdFZlbnVlKHYsZCl7CiBjb25zdCBycz1XUkFDRVMuZmlsdGVyKHI9PihyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiIpPT09dikuc29ydCgoYSxiKT0+KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogJCgid2xpc3QiKS5pbm5lckhUTUw9cnMubWFwKChyLGspPT5gPGJ1dHRvbiBkYXRhLWs9IiR7a30iPiR7ci5yYWNlTnVtYmVyfHxrKzF9UiAke2VzYyhyLnJhY2VOYW1lfHwiIil9PC9idXR0b24+YCkuam9pbigiIik7CiAkKCJ3bGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbiIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT57Y29uc3Qgcj1yc1tiLmRhdGFzZXQua107CiAgY29uc3QgaHM9KHIuaG9yc2VzfHxyLnJ1bm5lcnMpOwogIGNvbnN0IHJhY2U9bWtSYWNlKHIsZCk7CiAgc2V0UmFjZShyYWNlLGAke2R9ICR7dn0ke3IucmFjZU51bWJlcnx8IiJ9UiAke3IucmFjZU5hbWV8fCIife+8iCR7ci5zdXJmYWNlfHwiPyJ9JHtyLmRpc3RhbmNlfHwiPyJ9beODuyR7aHMubGVuZ3Rofemgre+8iWApOwogfSk7Cn0KCmZ1bmN0aW9uIG1rUmFjZShyLGQpewogY29uc3QgaHM9KHIuaG9yc2VzfHxyLnJ1bm5lcnMpOwogcmV0dXJue2RhdGU6ZCxrZXk6YCR7U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpfS0ke051bWJlcihyLnJhY2VOdW1iZXIpfHwwfWAsc3VyZjpVRS5zdXJmQ29kZShyLnN1cmZhY2UpLGRpc3Q6TnVtYmVyKHIuZGlzdGFuY2UpfHwwLGx2bDpVRS5sZXZlbE9mTGFiZWwoci5jbGFzc05hbWUpfHxVRS5sZXZlbE9mTGFiZWwoci5yYWNlTmFtZSksCiAgcnVubmVyczpocy5tYXAoKGgsaSk9Pntjb25zdCBuYW1lPWguaG9yc2VOYW1lfHxoLmhvcnNlfHxoLm5hbWV8fCIiO3JldHVybntuYW1lLGhvcnNlOlVFLm5uKG5hbWUpLGpvY2tleTpVRS5qbm4oaC5qb2NrZXl8fCIiKSxqbmFtZTpTdHJpbmcoaC5qb2NrZXl8fCIiKS50cmltKCksYWdlOmguYWdlfHxudWxsLG51bTpoLmhvcnNlTnVtYmVyfHxoLm51bWJlcnx8aSsxfX0pfTsKfQpsZXQgV0RBVEU9IiIsQVZBSUw9W107Ci8qIOWFqOODrOODvOOCueS4gOaLrO+8muWQhOODrOODvOOCueOBrueptOmmrOWAmeijnO+8iOS4iuS9jTLpoK3vvInjgpLkuIDopqfjgavjgZnjgosgKi8KYXN5bmMgZnVuY3Rpb24gcnVuQWxsKGJveElkPSJhbGxvdXQiKXsKIGlmKCFXUkFDRVMubGVuZ3RoKXJldHVybjsKIGNvbnN0IGJveD0kKGJveElkKTsKIGNvbnN0IGQ9V0RBVEU7bGV0IHRleHQ9YCR7ZH0g56m06aas5aW96LWw77yI5LiK5L2N5YCZ6KOc77yJXG5gOwogdHJ5ewogIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoZCk7CiAgY29uc3QgcnM9Wy4uLldSQUNFU10uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVOYW1lfHxhLnZlbnVlfHwiIikubG9jYWxlQ29tcGFyZShTdHJpbmcoYi52ZW51ZU5hbWV8fGIudmVudWV8fCIiKSwiamEiKXx8KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogIGNvbnN0IGdhcD1zdG9yZS5sYXN0RGF0ZT9NYXRoLnJvdW5kKChuZXcgRGF0ZShkKS1uZXcgRGF0ZShzdG9yZS5sYXN0RGF0ZSkpLzg2NGU1KTpudWxsOwogIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K65Y+N5pig77yaJHtPYmplY3Qua2V5cyhPRERTKS5sZW5ndGh944Os44O844K55YiG77yI5pyq5Y+W5b6X44Gu44Os44O844K544Gv44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJPC9kaXY+PGRpdiBjbGFzcz0ic21hbGwiPuWtpue/kuODh+ODvOOCv+acgOe1guaXpe+8miR7ZXNjKHN0b3JlLmxhc3REYXRlfHwi5LiN5piOIil977yP56m044K+44O844Oz44Gv44OE44O844Or5o6o5a6a44Gu5Lq65rCX77yI6aiO5omL5oiQ57i+6L6844G/77yJ44Gn5Yik5a6a44CC5a6f6Zqb44Gu5Lq65rCX44Go44Gv55Ww44Gq44KK44G+44GZPC9kaXY+YCx0SD0wLHROPTAsakg9MCxqTWlzcz1bXTsKICBpZihnYXAhPW51bGwmJmdhcD4xNCloKz1gPGRpdiBjbGFzcz0id2FybiI+4pqgIOacgOaWsOOBruaIkOe4vuOBjCR7Z2FwfeaXpeWIhuWFpeOBo+OBpuOBhOOBvuOBm+OCk+OAguebtOi/keOBruWlvei1sOODu+WHoei1sOOBjOWPjeaYoOOBleOCjOOBquOBhOeCueOBq+azqOaEj+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiAgaCs9Ijxicj4iOwogIHJzLmZvckVhY2goKHIsayk9PnsKICAgY29uc3QgcmFjZT1ta1JhY2UocixkKSxuPXJhY2UucnVubmVycy5sZW5ndGgsdj1yLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiI7CiAgIGNvbnN0IGxhYmVsPWAke3Z9JHtyLnJhY2VOdW1iZXJ8fGsrMX1SICR7ci5yYWNlTmFtZXx8IiJ977yIJHtyLnN1cmZhY2V8fCI/In0ke3IuZGlzdGFuY2V8fCI/In1t44O7JHtufemgre+8iWA7CiAgIHRleHQrPWBcbuKWoCR7bGFiZWx9XG5gOwogICBsZXQgYm9keT0iIjsKICAgaWYobjw2KWJvZHk9JzxzcGFuIGNsYXNzPSJzbWFsbCI+Numgreacqua6gOOBruOBn+OCgeWvvuixoeWkljwvc3Bhbj4nOwogICBlbHNlewogICAgY29uc3Qgb2Q9b2Rkc0ZvcihyYWNlKSxyZXM9VUUuYW5hbHl6ZShyYWNlLHN0b3JlLG9kKSxjPVVFLnBpY2socmVzLDIpO3tjb25zdCBtPW1hdGNoSW5mbyhyZXMpO3RIKz1tLmg7dE4rPW0ubjtqSCs9bS5qO2pNaXNzLnB1c2goLi4ubS5taXNzKX0KICAgIGJvZHk9Yy5tYXAoeD0+e2NvbnN0IHRnPXgudGFncy5zbGljZSgwLDIpLm1hcCh0PT50LnQpLmpvaW4oIu+8jyIpOwogICAgIHRleHQrPWAgICR7eC5ub33nlaogJHt4Lm5hbWV9ICR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9ICR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSUgJHt0Z31cbmA7CiAgICAgdGV4dCs9YCAgICAke3JlY0xpbmUoeCl977yPJHt4LmpuYW1lfHwi6aiO5omL5LiN5piOIn1cbmA7CiAgICAgcmV0dXJuIGA8ZGl2PjxiPiR7ZXNjKHgubm8pfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHIke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfSI+JHtyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKX08L3NwYW4+IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHsoeC5wYyoxMDApLnRvRml4ZWQoMSl9Je+8iOeptOOCvuODvOODs+W5s+Wdh+OBriR7KHgucGMvQVZHW3gubW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il0pLnRvRml4ZWQoMSl95YCN44O75L+h6aC85bqmJHtlc2MoeC5jb25mKX3vvIk8L3NwYW4+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2MocmVjTGluZSh4KSl977yPJHtlc2MoeC5qbmFtZXx8IumojuaJi+S4jeaYjiIpfTwvc3Bhbj48YnI+YCt4LnRhZ3Muc2xpY2UoMCwzKS5tYXAodD0+YDxzcGFuIGNsYXNzPSJjaGlwICR7dC5jfSI+JHtlc2ModC50KX08L3NwYW4+YCkuam9pbigiIikrYDwvZGl2PmB9KS5qb2luKCIiKXx8JzxzcGFuIGNsYXNzPSJzbWFsbCI+56m044K+44O844Oz44Gr6Kmy5b2T44Gq44GXPC9zcGFuPic7CiAgIH0KICAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKGxhYmVsKX08L2I+PGJyPiR7Ym9keX08YnI+PGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLWs9IiR7a30iPuips+e0sOODu+OCquODg+OCuuWFpeWKmzwvYnV0dG9uPjwvZGl2PmA7CiAgfSk7CiAgaD1oLnJlcGxhY2UoJzxicj4nLGA8ZGl2IGNsYXNzPSJzbWFsbCI+5bGl5q2044Gu54Wn5ZCI77ya6aasICR7dEh9LyR7dE596aCt77yI6YGO5Y6744GrMui1sOS7peS4iu+8ie+8j+mojuaJiyAke2pIfS8ke3ROfemgrTwvZGl2PmArKGpNaXNzLmxlbmd0aCYmakg8dE4qLjY/YDxkaXYgY2xhc3M9Indhcm4gc21hbGwiPuKaoCDpqI7miYvjgpLpgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgafjgY3jgabjgYTjgarjgYTkvovvvJoke2VzYyhbLi4ubmV3IFNldChqTWlzcyldLnNsaWNlKDAsNikuam9pbigi44CBIikpfTwvZGl2PmA6IiIpKyh0TiYmdEg8dE4qLjU/JzxkaXYgY2xhc3M9Indhcm4gc21hbGwiPuKaoCDnhaflkIjjgafjgY3jgZ/ppqzjgYzljYrliIbmnKrmuoDjgafjgZnjgILoi6Xpp5LmiKbjgYzkuK3lv4Pjga7ml6Xjga/mraPluLjjgafjgZnjgYzjgIHjgZ3jgYbjgafjgarjgZHjgozjgbDppqzlkI3ooajoqJjjga7kuI3kuIDoh7Tjga7lj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgII8L2Rpdj4nOicnKSsnPGJyPicpOwogIGgrPSc8YnV0dG9uIGNsYXNzPSJjb3B5QWxsIj7kuIDopqfjgpLjg4bjgq3jgrnjg4jjgafjgrPjg5Tjg7w8L2J1dHRvbj4nOwogIGJveC5pbm5lckhUTUw9aDsKICBib3gucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEta10iKS5mb3JFYWNoKGJ0PT5idC5vbmNsaWNrPSgpPT57Y29uc3Qgcj1yc1tidC5kYXRhc2V0LmtdO3NldFJhY2UobWtSYWNlKHIsZCksYCR7ZH0gJHtyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiJ9JHtyLnJhY2VOdW1iZXJ8fCIifVIgJHtyLnJhY2VOYW1lfHwiIn1gKTskKCJydW4iKS5zY3JvbGxJbnRvVmlldyh7YmVoYXZpb3I6InNtb290aCJ9KTtydW4obnVsbCl9KTsKICBjb25zdCBjYj1ib3gucXVlcnlTZWxlY3RvcigiLmNvcHlBbGwiKTtjYi5vbmNsaWNrPWFzeW5jKCk9Pnt0cnl7YXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodGV4dCk7Y2IudGV4dENvbnRlbnQ9IuOCs+ODlOODvOOBl+OBvuOBl+OBnyJ9Y2F0Y2goZSl7YWxlcnQoIuOCs+ODlOODvOOBp+OBjeOBvuOBm+OCk+OBp+OBl+OBnyIpfX07CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7Ym94LmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuS4gOaLrOino+aekOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn0KJCgid2FsbCIpLm9uY2xpY2s9KCk9PnJ1bkFsbCgiYWxsb3V0Iik7Ci8qIOaJi+WFpeWKmyAqLwokKCJtZGF0ZSIpLnZhbHVlPW5ldyBEYXRlKERhdGUubm93KCkrODY0MDAwMDAqMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKJCgid2RhdGUiKS52YWx1ZT0kKCJtZGF0ZSIpLnZhbHVlOyQoInBkYXRlIikudmFsdWU9IjIwMjYtMDYtMjEiOwokKCJtZ28iKS5vbmNsaWNrPSgpPT57CiBjb25zdCBsaW5lcz0kKCJtdGV4dCIpLnZhbHVlLnNwbGl0KC9ccj9cbi8pLm1hcChzPT5zLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pLHJzPVtdLG9kZHM9W107CiBmb3IoY29uc3QgbCBvZiBsaW5lcyl7Y29uc3QgbT1sLm1hdGNoKC9eKFxkezEsMn0pW1xzLOOAgF0rKFxTKz8pKD86W1xzLOOAgF0rKFtcZC5dKykpPyQvKTtpZihtKXtycy5wdXNoKHtuYW1lOm1bMl0saG9yc2U6VUUubm4obVsyXSksam9ja2V5OiIiLGFnZTpudWxsLG51bTorbVsxXX0pO29kZHMucHVzaChtWzNdPyttWzNdOjApfX0KIGlmKHJzLmxlbmd0aDwyKXJldHVybiBhbGVydCgi44CM6aas55WqIOmmrOWQjeOAjeOBruW9ouW8j+OBpzLpoK3ku6XkuIrlhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgIIiKTsKIGNvbnN0IHJhY2U9e2RhdGU6JCgibWRhdGUiKS52YWx1ZSxzdXJmOiskKCJtc3VyZiIpLnZhbHVlLGRpc3Q6KyQoIm1kaXN0IikudmFsdWV8fDAscnVubmVyczpycyxvZGRzMDpvZGRzLmV2ZXJ5KG89Pm8+MSk/b2RkczpudWxsfTsKIHNldFJhY2UocmFjZSxgJHtyYWNlLmRhdGV9IOaJi+WFpeWKm++8iCR7cmFjZS5zdXJmPT09MT8i6IqdIjoi44OA44O844OIIn0ke3JhY2UuZGlzdH1t44O7JHtycy5sZW5ndGh96aCt77yJYCk7Cn07Ci8qIOmBjuWOu+ODrOODvOOCuSAqLwpsZXQgUFJBQ0VTPVtdOwokKCJwZ2V0Iikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBkPSQoInBkYXRlIikudmFsdWU7aWYoIWQpcmV0dXJuOyQoInBzdGF0dXMiKS50ZXh0Q29udGVudD0i5qSc57Si5Lit4oCmIjskKCJwbGlzdCIpLmlubmVySFRNTD0iIjsKIHRyeXsKICBjb25zdCBtYXA9bmV3IE1hcCgpOwogIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKHIuZGF0ZSE9PWR8fCFyLnJhY2VJZClyZXR1cm47aWYoIW1hcC5oYXMoci5yYWNlSWQpKW1hcC5zZXQoci5yYWNlSWQsW10pO21hcC5nZXQoci5yYWNlSWQpLnB1c2gocil9KTsKICBQUkFDRVM9Wy4uLm1hcC5lbnRyaWVzKCldLmZpbHRlcigoWyx2XSk9PnYubGVuZ3RoPj02KS5zb3J0KChhLGIpPT52ZW51ZU9mSWQoYVswXSkubG9jYWxlQ29tcGFyZSh2ZW51ZU9mSWQoYlswXSkpfHxyYWNlTm9PZklkKGFbMF0pLXJhY2VOb09mSWQoYlswXSkpOwogIGlmKCFQUkFDRVMubGVuZ3RoKXskKCJwc3RhdHVzIikudGV4dENvbnRlbnQ9IuOBneOBruaXpeOBruODrOODvOOCueOBr+S/neWtmOODh+ODvOOCv+OBq+OBguOCiuOBvuOBm+OCk+OAgiI7cmV0dXJufQogICQoInBzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtQUkFDRVMubGVuZ3RofeODrOODvOOCuWA7CiAgY29uc3QgbGFiPWlkPT5gJHtWRU5VRVt2ZW51ZU9mSWQoaWQpXXx8dmVudWVPZklkKGlkKX0ke3JhY2VOb09mSWQoaWQpfVJgOwogICQoInBsaXN0IikuaW5uZXJIVE1MPVBSQUNFUy5tYXAoKFtpZCx2XSxrKT0+YDxidXR0b24gZGF0YS1rPSIke2t9Ij4ke2xhYihpZCl977yIJHt2WzBdLnN1cmY9PT0xPyLoip0iOiLjg4AifSR7dlswXS5kaXN0fW3jg7ske3YubGVuZ3Rofemgre+8iTwvYnV0dG9uPmApLmpvaW4oIiIpOwogICQoInBsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9Pntjb25zdCBbaWQsdl09UFJBQ0VTW2IuZGF0YXNldC5rXTsKICAgY29uc3QgcnM9di5maWx0ZXIocj0+ci5ob3JzZSkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKS5tYXAocj0+KHtuYW1lOnIubmFtZXx8ci5ob3JzZSxob3JzZTpyLmhvcnNlLGpvY2tleTpyLmpvY2tleSxqbmFtZTpyLmpuYW1lfHwiIixhZ2U6ci5hZ2UsbnVtOnIubnVtLGFjdDpyLmZpbmlzaCxwb3A6ci5wb3Asb2Rkc0E6ci5vZGRzfSkpOwogICBjb25zdCByYWNlPXtkYXRlOmQsc3VyZjp2WzBdLnN1cmYsZGlzdDp2WzBdLmRpc3QsbHZsOnZbMF0ubHZsfHwwLHJ1bm5lcnM6cnMscGFzdDp0cnVlfTsKICAgc2V0UmFjZShyYWNlLGAke2R9ICR7bGFiKGlkKX3vvIjpgY7ljrvjg6zjg7zjgrnjg7ske3JzLmxlbmd0aH3poK3vvIlgKTt9KTsKIH1jYXRjaChlKXskKCJwc3RhdHVzIikudGV4dENvbnRlbnQ9IuOCqOODqeODvO+8miIrZS5tZXNzYWdlfQp9OwoKLyogLS0tIOino+aekOODu+ihqOekuiAtLS0gKi8KLyog44Op44Oz44Kv44Gv6KOc5q2j5b6M44Gu5aW96LWw546H44Gn5Yik5a6a77yI44Oi44O844OJ44GU44Go44Gr56m044K+44O844Oz44Gu5bmz5Z2H44GM6YGV44GG77ya44Kq44OD44K65YWl5Yqb5pmC44Gv57SEOSXjgIHjgqrjg4PjgrrjgarjgZfjga/ntIQxMyXvvIkgKi8KY29uc3QgQVZHPXtvZGRzOi4wOTEscHJveHk6LjExNX07ICAgLy8g56m044K+44O844Oz44Gu5a6f5ris5bmz5Z2H77yIMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk++8iQpjb25zdCByYXRpbmc9KHAsbW9kZSxuKT0+e2NvbnN0IHI9cC8oQVZHW21vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdKTtsZXQgaz1yPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyI7aWYobjwyJiYoaz09PSJTInx8az09PSJBIikpaz0iQiI7cmV0dXJuIGt9OyAgLy8g5bGl5q2044GMMei1sOS7peS4i+OBr0Ljgb7jgacKLyog5YCZ6KOc44GU44Go44Gu44CM5qC55oug44CN6KGo56S677ya5aW96LWw546H44Go44Gd44Gu6aas44Gu5a6f57i+44GM6aOf44GE6YGV44Gj44Gm6KaL44GI44Gq44GE44KI44GG44CB5a6f57i+44O75Z+65rqW44O76aiO5omL44KS5Lim44G544KLICovCmZ1bmN0aW9uIHJlY0xpbmUoeCl7CiBjb25zdCBwPVtdOwogcC5wdXNoKHguY2FyZWVyJiZ4LmNhcmVlci5uP2DpgJrnrpcke3guY2FyZWVyLm596LWwIDPnnYDlhoUke3guY2FyZWVyLnQzfeWbnu+8iCR7TWF0aC5yb3VuZCh4LmNhcmVlci50My94LmNhcmVlci5uKjEwMCl9Je+8iWA6IumAmueul++8muWxpeattOOBquOBlyIpOwogaWYoeC5yZWNlbnQmJngucmVjZW50Lmxlbmd0aClwLnB1c2goYOebtOi/kSAke3gucmVjZW50LnNsaWNlKC01KS5qb2luKCItIil9552AYCk7CiByZXR1cm4gcC5qb2luKCLvvI8iKTsKfQpmdW5jdGlvbiBiYXNlTGluZSh4KXtyZXR1cm4gYOeptOOCvuODvOODs+OBruW5s+WdhyAke2F2Z05vdGUoeC5tb2RlKX0g4oaSIOOBk+OBrummrOOBryR7KHgucGMvQVZHW3gubW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il0pLnRvRml4ZWQoMSl95YCN77yIU+KJpzIuMuWAje+8j0HiiacxLjflgI3vvI9C4omnMS4z5YCN77yJYH0KZnVuY3Rpb24gam9ja2V5TGluZSh4KXsKIGlmKCF4LmpuYW1lKXJldHVybiAi6aiO5omL77ya6Kqt44G/5Y+W44KM44Gm44GE44G+44Gb44KTIjsKIHJldHVybiB4LmpzdGF0JiZ4LmpzdGF0Lm4+PTU/YOmojuaJi++8miR7eC5qbmFtZX3vvIjpgY7ljrske3guanN0YXQubn3pqI7kuZcgM+edgOWGhSR7TWF0aC5yb3VuZCh4LmpzdGF0LnJhdGUqMTAwKX0l77yJYDpg6aiO5omL77yaJHt4LmpuYW1lfe+8iOmBjuWOu+ODh+ODvOOCv+OBq+ipsuW9k+OBquOBl+OAgeOBvuOBn+OBr+mojuS5l+OBjOWwkeOBquOBhO+8iWA7Cn0KY29uc3QgYXZnTm90ZT1tb2RlPT5tb2RlPT09Im9kZHMiPyLntIQ5JSI6Iue0hDEyJSI7Ci8qIOWxpeattOOBrueFp+WQiOeKtuazge+8iOmmrOWQjeODu+mojuaJi+WQjeOBjOmBjuWOu+ODh+ODvOOCv+OBqOS4gOiHtOOBl+OBn+OBi++8iSAqLwpjb25zdCBtYXRjaEluZm89cmVzPT57Y29uc3Qgbj1yZXMubGVuZ3RoLGg9cmVzLmZpbHRlcih4PT54Lm4+PTIpLmxlbmd0aCxqPXJlcy5maWx0ZXIoeD0+eC5qbj49NSkubGVuZ3RoO3JldHVybntuLGgsaixtaXNzOnJlcy5maWx0ZXIoeD0+eC5qbjw1JiZ4LmpuYW1lKS5tYXAoeD0+eC5qbmFtZSl9fTsKYXN5bmMgZnVuY3Rpb24gcnVuKG9kZHNJbil7CiBpZighQ1VSKXJldHVybjsKIHRyeXsKICBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKENVUi5kYXRlKTsKICBsZXQgb2Rkcz1vZGRzSW58fG51bGw7CiAgaWYoIW9kZHMmJkNVUi5vZGRzMClvZGRzPUNVUi5vZGRzMDsKICBpZighb2RkcyYmQ1VSLnBhc3QmJkNVUi5ydW5uZXJzLmV2ZXJ5KHI9PnIub2Rkc0E+MSkpb2Rkcz1DVVIucnVubmVycy5tYXAocj0+ci5vZGRzQSk7CiAgY29uc3QgcG9wQXJyPSghb2RkcyYmQ1VSLnBhc3QmJkNVUi5ydW5uZXJzLmV2ZXJ5KHI9PnIucG9wPjApKT9DVVIucnVubmVycy5tYXAocj0+ci5wb3ApOm51bGw7CiAgY29uc3QgcmVzPVVFLmFuYWx5emUoQ1VSLHN0b3JlLG9kZHMsbnVsbCxwb3BBcnIpOwogIExBU1RSRVM9e3JlcyxvZGRzLGNvdW50OnN0b3JlLmNvdW50fTtyZW5kZXIoKTsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJvdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7op6PmnpDjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9CmZ1bmN0aW9uIHJlbmRlcigpewogY29uc3R7cmVzLG9kZHMsY291bnR9PUxBU1RSRVMsTj1yZXMubGVuZ3RoLGN1dD1yZXNbMF0uY3V0LHBhc3Q9ISFDVVIucGFzdDsKIGlmKE48Nil7JCgib3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+Numgreacqua6gOOBruOBn+OCgeeptOmmrOWIpOWumuOBruWvvuixoeWkluOBp+OBmeOAgjwvc3Bhbj4nO3JldHVybn0KIGNvbnN0IHVzZWQ9ISFyZXNbMF0ubWt0LGNhbmRzPVVFLnBpY2socmVzLDUpOwogbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7kurrmsJfpoIbvvJoke3VzZWQ/IuWFpeWKm+OCquODg+OCuiI6IuODhOODvOODq+aOqOWumu+8iOmojuaJi+aIkOe4vui+vOOBv+ODu+Wun+mam+OBruS6uuawl+OBqOOBr+eVsOOBquOCiuOBvuOBme+8iSJ977yP56m044K+44O844Oz77yaJHtjdXR955Wq55uu5Lul6ZmN77yI5YWoJHtOfemgre+8ie+8j+Wtpue/kiAke2NvdW50LnRvTG9jYWxlU3RyaW5nKCl96KGMPC9kaXY+YDsKIHtjb25zdCBtPW1hdGNoSW5mbyhyZXMpO2grPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5bGl5q2044Gu54Wn5ZCI77ya6aasICR7bS5ofS8ke20ubn3poK3vvIgy6LWw5Lul5LiK77yJ77yP6aiO5omLICR7bS5qfS8ke20ubn3poK08L2Rpdj5gKyhtLm1pc3MubGVuZ3RoP2A8ZGl2IGNsYXNzPSJzbWFsbCI+6aiO5omL44Gu5pyq54Wn5ZCI77yaJHtlc2MobS5taXNzLnNsaWNlKDAsNikuam9pbigi44CBIikpfSR7bS5taXNzLmxlbmd0aD42PyIg4oCmIjoiIn08L2Rpdj5gOiIiKTtpZihtLmg8bS5uKi41KWgrPWA8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj7imqAg6YGO5Y676LWw44KS54Wn5ZCI44Gn44GN44Gf6aas44GM5bCR44Gq44GE44Gf44KB44CB5LqI5oOz44Gu5L+h6aC85bqm44Gv5L2O44KB44Gn44GZ77yI5paw6aas5oim44O76Iul6aeS5oim44CB44G+44Gf44Gv6aas5ZCN6KGo6KiY44Gu6YGV44GE77yJ44CCPC9kaXY+YH0KIGgrPSI8YnI+IjsKIGlmKCFjYW5kcy5sZW5ndGgpaCs9JzxzcGFuIGNsYXNzPSJ3YXJuIj7nqbTjgr7jg7zjg7PjgavoqbLlvZPppqzjgYzjgYTjgb7jgZvjgpPjgII8L3NwYW4+JzsKIGNhbmRzLmZvckVhY2goKHgsayk9PnsKICBjb25zdCBjaGlwcz14LnRhZ3MubWFwKHQ9PmA8c3BhbiBjbGFzcz0iY2hpcCAke3QuY30iPiR7ZXNjKHQudCl9PC9zcGFuPmApLmpvaW4oIiIpOwogIGNvbnN0IHI9Q1VSLnJ1bm5lcnNbeC5pXTsKICBoKz1gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtrKzF9LiAke2VzYyh4Lm5vKX3nlaogJHtlc2MoeC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJydCByJHtyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKX0iPiR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9PC9zcGFuPmA7CiAgaWYocGFzdCloKz1gIDxzcGFuIGNsYXNzPSJzbWFsbCI+4oaSIOe1kOaenCAke3IuYWN0Pz8iLSJ9552A77yIJHtyLnBvcD8/Ii0ifeS6uuawl++8iSR7ci5hY3Q8PTM/IiDinIUiOiIifTwvc3Bhbj5gOwogIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5aW96LWw546HIDxiPiR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSU8L2I+77yI56m044K+44O844Oz5bmz5Z2HICR7YXZnTm90ZSh4Lm1vZGUpfe+8ie+8j+S/oemgvOW6piAke2VzYyh4LmNvbmYpfTxicj4ke2VzYyhyZWNMaW5lKHgpKX08YnI+JHtlc2MoYmFzZUxpbmUoeCkpfTxicj4ke2VzYyhqb2NrZXlMaW5lKHgpKX1gOwogIGlmKHgubWt0IT1udWxsKWgrPWA8YnI+5biC5aC044Gu5oOz5a6aM+edgOWGhSAkeyh4Lm1rdCoxMDApLnRvRml4ZWQoMSl9JSDihpIg5aaZ5ZGzIDxiPiR7eC52YWx1ZT49Mz8iM+WAjeS7peS4iiI6eC52YWx1ZS50b0ZpeGVkKDIpKyLlgI0ifTwvYj4ke3gudmFsdWU+PTEuMz8iIPCflKUiOiIifWA7CiAgaCs9YDwvZGl2PjxkaXY+JHtjaGlwc3x8JzxzcGFuIGNsYXNzPSJzbWFsbCI+55uu56uL44Gk5qC55oug44Gq44GXPC9zcGFuPid9PC9kaXY+PC9kaXY+YDsKIH0pOwogaCs9YDxicj48Yj7lhajpoK3kuIDopqc8L2I+JHtwYXN0PyLvvIjlrp/pmpvjga7ntZDmnpzjgaTjgY3vvIkiOiLvvIjljZjli53jgqrjg4PjgrrjgpLlhaXjgozjgovjgajlppnlkbPjgpLoqIjnrpfvvIkifTx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqznlao8L3RoPjx0aD7ppqzlkI08L3RoPjx0aD7pqI7miYs8L3RoPjx0aD7lpb3otbDnjoc8L3RoPjx0aD7poIbkvY08L3RoPjx0aD7jgqrjg4Pjgro8L3RoPiR7cGFzdD8iPHRoPue1kOaenDwvdGg+IjoiIn08L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgeCBvZiByZXMpe2NvbnN0IHI9Q1VSLnJ1bm5lcnNbeC5pXTsKICBoKz1gPHRyJHt4LmhvbGU/JyBzdHlsZT0iYmFja2dyb3VuZDojZmZiODAwMjIiJzonJ30+PHRkPiR7ZXNjKHgubm8pfTwvdGQ+PHRkPiR7ZXNjKHgubmFtZSl9PC90ZD48dGQ+JHtlc2MoeC5qbmFtZXx8Ij8iKX08L3RkPjx0ZD4keyh4LnBjKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+JHt4LnJhbmt9PC90ZD48dGQ+PGlucHV0IGNsYXNzPSJvZGRzIiBkYXRhLWk9IiR7eC5pfSIgdHlwZT0ibnVtYmVyIiBzdGVwPSIwLjEiIG1pbj0iMS4xIiBpbnB1dG1vZGU9ImRlY2ltYWwiIHZhbHVlPSIke29kZHM/b2Rkc1t4LmldOiIifSIgc3R5bGU9IndpZHRoOjYycHg7cGFkZGluZzo0cHgiPjwvdGQ+JHtwYXN0P2A8dGQ+JHtyLmFjdD8/Ii0ifeedgDwvdGQ+YDoiIn08L3RyPmB9CiBoKz1gPC90Ym9keT48L3RhYmxlPjxidXR0b24gaWQ9InJlY2FsYyI+44Kq44OD44K644KS5Y+N5pig44GX44Gm5YaN6KiI566XPC9idXR0b24+PGJ1dHRvbiBpZD0iY2xlYXJvZGRzIiBjbGFzcz0ic3ViIj7jgqrjg4PjgrrjgpLjgq/jg6rjgqI8L2J1dHRvbj5gOwogJCgib3V0IikuaW5uZXJIVE1MPWg7CiAkKCJyZWNhbGMiKS5vbmNsaWNrPSgpPT57Y29uc3Qgdj1bLi4uZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI291dCBpbnB1dC5vZGRzIildLm1hcChlPT5wYXJzZUZsb2F0KGUudmFsdWUpKTtydW4odi5ldmVyeShvPT5vPjEpP3Y6bnVsbCl9OwogJCgiY2xlYXJvZGRzIikub25jbGljaz0oKT0+e0NVUi5vZGRzMD1udWxsO0NVUi5wYXN0PUNVUi5wYXN0O0xBU1RSRVM9bnVsbDtydW4obnVsbCl9Owp9CiQoInJ1biIpLm9uY2xpY2s9KCk9PnJ1bihudWxsKTsKJCgiZmlsZSIpLm9uY2hhbmdlPWU9Pntjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKGYpaW1wb3J0RmlsZShmKS50aGVuKCgpPT57ZS50YXJnZXQudmFsdWU9IiJ9KX07CgovKiAtLS0g5omV5oi744O75pyI44Gu5Y+W5b6X54q25rOB77yISW5kZXhlZERC77yJIC0tLSAqLwpjb25zdCBwYXlBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJwYXkiKS5vYmplY3RTdG9yZSgicGF5IikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBwYXlQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJwYXkiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJwYXkiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBtZXRhR2V0PWs9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJtZXRhIikub2JqZWN0U3RvcmUoIm1ldGEiKS5nZXQoayk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0KTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IG1ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmFzeW5jIGZ1bmN0aW9uIHBheVN0YXRlKCl7YXdhaXQgc2hvd1N0YXRlKCl9CgovKiAtLS0g5YWx6YCa44Gu5Y+W5b6X77yI5YaN6Kmm6KGM44Gk44GN77yJIC0tLSAqLwpsZXQgU1lOQ0lORz1mYWxzZTsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hKU09OKHVybCl7CiBsZXQgZXJyPSIiO2NvbnN0IHdhaXRzPXdpbmRvdy5fX1dBSVRTfHxbNDAwMCwxMjAwMCwzMDAwMCw2MDAwMF07CiBmb3IobGV0IHQ9MDt0PD13YWl0cy5sZW5ndGg7dCsrKXsKICB0cnl7CiAgIGNvbnN0IHI9YXdhaXQgZmV0Y2godXJsKTtjb25zdCB0eHQ9YXdhaXQgci50ZXh0KCk7bGV0IHg9e307dHJ5e3g9SlNPTi5wYXJzZSh0eHQpfWNhdGNoKGUpe30KICAgaWYoIXIub2t8fHgub2s9PT1mYWxzZSl7Y29uc3QgZT1uZXcgRXJyb3IoeC5lcnJvcnx8YEhUVFAgJHtyLnN0YXR1c31gKyh0eHQmJiF4LmVycm9yP2DvvIgke3R4dC5yZXBsYWNlKC9ccysvZywiICIpLnNsaWNlKDAsNTApfe+8iWA6IiIpKTtlLnN0YXR1cz1yLnN0YXR1czt0aHJvdyBlfQogICByZXR1cm4geDsKICB9Y2F0Y2goZSl7CiAgIGVycj1lLm1lc3NhZ2U7Y29uc3QgcmV0cnk9IWUuc3RhdHVzfHxlLnN0YXR1cz49NTAwfHxlLnN0YXR1cz09PTQyOTsKICAgaWYoIXJldHJ5fHx0PT09d2FpdHMubGVuZ3RoKWJyZWFrOwogICBpZihTWU5DSU5HKSQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1g5re36ZuR44Gu44Gf44KBJHtNYXRoLnJvdW5kKHdhaXRzW3RdLzEwMDApfeenkuW+heOBo+OBpuWGjeippuihjOOBl+OBvuOBmeKApu+8iCR7ZXJyfe+8iWA7CiAgIGF3YWl0IHNsZWVwKHdhaXRzW3RdKTsKICB9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyKTsKfQpjb25zdCBNT0RFTF9UUkFJTl9FTkQ9IjIwMjYtMDYtMjIiOyAgIC8vIOePvuWcqOOBruODouODh+ODq+OBr+OAgeOBk+OBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBp+Wtpue/kgpjb25zdCBqc3RZZXN0ZXJkYXk9KCk9Pm5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMtODY0ZTUpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmNvbnN0IGFkZERheXM9KGQsbik9Pm5ldyBEYXRlKG5ldyBEYXRlKGQrIlQwMDowMDowMFoiKS5nZXRUaW1lKCkrbio4NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKZnVuY3Rpb24gbW9udGhzQmV0d2VlbihhLGIpe2NvbnN0IG91dD1bXTtsZXRbeSxtXT1hLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTtjb25zdFt5MixtMl09Yi5zbGljZSgwLDcpLnNwbGl0KCItIikubWFwKE51bWJlcik7CiB3aGlsZSh5PHkyfHwoeT09PXkyJiZtPD1tMikpe291dC5wdXNoKGAke3l9LSR7U3RyaW5nKG0pLnBhZFN0YXJ0KDIsIjAiKX1gKTttKys7aWYobT4xMil7bT0xO3krK319cmV0dXJuIG91dH0KCi8qIC0tLSDikaAg44OH44O844K/5Y+W5b6X77ya6YGO5Y675oiQ57i+77yI5Lq65rCX44Gk44GN77yJ77yL5omV5oi744KS44CB6ZaL5YKs5pel44GU44Go44Gr5Y+W5b6X44GX44Gm5L+d5a2YIC0tLSAqLwpjb25zdCBTWU5DX0JBVENIPTQsU1lOQ19QQVJBTExFTD0yOwpsZXQgU1NUT1A9ZmFsc2UsQkFDS1VQX0RBVEVTPW51bGw7CiQoInN5bmNTdG9wIikub25jbGljaz0oKT0+e1NTVE9QPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlfTsKJCgic2VuZCIpLnZhbHVlPWpzdFllc3RlcmRheSgpOwphc3luYyBmdW5jdGlvbiBiYWNrdXBEYXRlcygpewogaWYoQkFDS1VQX0RBVEVTKXJldHVybiBCQUNLVVBfREFURVM7CiBjb25zdCBzPW5ldyBTZXQoKSxmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihjb25zdCBmIG9mIGZzKXtpZihmLmxpdmUpY29udGludWU7Zm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpe2NvbnN0IGQ9VUUucGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pO2lmKGQpcy5hZGQoZCl9YXdhaXQgc2xlZXAoMCl9CiByZXR1cm4gQkFDS1VQX0RBVEVTPXM7Cn0KYXN5bmMgZnVuY3Rpb24gZmV0Y2hEYXkoYmFzZSxkKXsKIGNvbnN0IGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheT9kYXRlPSR7ZH1gKTsKIGNvbnN0IHJhY2VzPWRheS5yYWNlc3x8W107aWYoIXJhY2VzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyIpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krPVNZTkNfQkFUQ0gpY2h1bmtzLnB1c2gocmFjZXMuc2xpY2UoaSxpK1NZTkNfQkFUQ0gpLm1hcCh4PT54LmNuYW1lKSk7CiBjb25zdCByb3dzPVtdLHBheW91dHM9W107bGV0IGlkeD0wLGZhaWxlZE49MDsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoaWR4PGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9aWR4Kys7CiAgY29uc3QgcmVzPWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtcmVzdWx0cz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWApOwogIHJvd3MucHVzaCguLi4ocmVzLnJvd3N8fFtdKSk7cGF5b3V0cy5wdXNoKC4uLihyZXMucGF5b3V0c3x8W10pKTtmYWlsZWROKz0ocmVzLmZhaWxlZHx8W10pLmxlbmd0aH19OwogYXdhaXQgUHJvbWlzZS5hbGwoQXJyYXkuZnJvbSh7bGVuZ3RoOk1hdGgubWluKFNZTkNfUEFSQUxMRUwsY2h1bmtzLmxlbmd0aCl9LHdvcmtlcikpOwogY29uc3QgZ290PW5ldyBTZXQocm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplOwogZmFpbGVkTj1NYXRoLm1heChmYWlsZWROLHJhY2VzLmxlbmd0aC1nb3QpOwogcmV0dXJue3Jvd3MscGF5b3V0cyxmYWlsZWROLHJhY2VzOnJhY2VzLmxlbmd0aH07Cn0KJCgic3luY0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKIGNvbnN0IGE9JCgic3N0YXJ0IikudmFsdWV8fCIyMDIzLTAxLTAxIix5ZD1qc3RZZXN0ZXJkYXkoKTtsZXQgYj0kKCJzZW5kIikudmFsdWV8fHlkO2lmKGI+eWQpYj15ZDsKIGlmKGE+Yil7JCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLplovlp4vml6XjgYzntYLkuobml6XjgojjgorlvozjgafjgZnjgIIiO3JldHVybn0KIFNTVE9QPWZhbHNlO1NZTkNJTkc9dHJ1ZTskKCJzeW5jR28iKS5kaXNhYmxlZD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9ZmFsc2U7CiBjb25zdCBzdD17ZGF5czowLHJhY2VzOjAsc2tpcHBlZDowLGZhaWw6W10sdDA6RGF0ZS5ub3coKX07bGV0IGNvbnNlYz0wOwogdHJ5ewogICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i5L+d5a2Y5riI44G/44OH44O844K/44KS56K66KqN5Lit4oCmIjsKICBjb25zdCBmaWxlcz1hd2FpdCBpZGJBbGwoKSxoYXZlTGl2ZT1uZXcgU2V0KGZpbGVzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpLm1hcChmPT5mLmRhdGUpKTsKICBjb25zdCBoYXZlUGF5PW5ldyBTZXQoKGF3YWl0IHBheUFsbCgpKS5maWx0ZXIocD0+IXAuZmFpbGVkKS5tYXAocD0+cC5kYXRlKSk7CiAgY29uc3QgYms9YXdhaXQgYmFja3VwRGF0ZXMoKTsKICBjb25zdCBtb250aHM9bW9udGhzQmV0d2VlbihhLGIpLGN1ck1vbnRoPXlkLnNsaWNlKDAsNyk7CiAgZm9yKGxldCBtaT0wO21pPG1vbnRocy5sZW5ndGg7bWkrKyl7CiAgIGlmKFNTVE9QKWJyZWFrO2NvbnN0IG1vbnRoPW1vbnRoc1ttaV07CiAgIGlmKG1vbnRoPGN1ck1vbnRoJiZhd2FpdCBtZXRhR2V0KCJtb250aDoiK21vbnRoKSl7Y29udGludWV9CiAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHttb250aH3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvInplovlgqzml6XjgpLnorroqo3kuK3igKYg5Y+W5b6X5riI44G/JHtzdC5kYXlzfeaXpWA7CiAgIGxldCBkYXlzO3RyeXtkYXlzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheXM/bW9udGg9JHttb250aH1gKSkuZGF5c3x8W107Y29uc2VjPTB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke21vbnRofe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgZGF5cz1kYXlzLmZpbHRlcihkPT5kPj1hJiZkPD1iKTtsZXQgbW9udGhPaz10cnVlOwogICBmb3IoY29uc3QgZCBvZiBkYXlzKXsKICAgIGlmKFNTVE9QKXttb250aE9rPWZhbHNlO2JyZWFrfQogICAgY29uc3QgbmVlZFJvd3M9IWhhdmVMaXZlLmhhcyhkKSYmIWJrLmhhcyhkKSxuZWVkUGF5PSFoYXZlUGF5LmhhcyhkKTsKICAgIGlmKCFuZWVkUm93cyYmIW5lZWRQYXkpe3N0LnNraXBwZWQrKztjb250aW51ZX0KICAgIGNvbnN0IGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke2R9IOOCkuWPluW+l+S4re+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iVxu5Y+W5b6XJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvI/lpLHmlZcke3N0LmZhaWwubGVuZ3Rofe+8j+e1jOmBjiR7TWF0aC5mbG9vcihlbC82MCl95YiGJHtlbCU2MH3np5JgOwogICAgdHJ5ewogICAgIGNvbnN0IHI9YXdhaXQgZmV0Y2hEYXkoYmFzZSxkKTsKICAgICBpZihyLmZhaWxlZE4pe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgICBpZihuZWVkUm93cyl7YXdhaXQgaWRiUHV0KGBsaXZlOiR7ZH1gLHtsaXZlOnRydWUsZGF0ZTpkLHJvd3M6ci5yb3dzfSk7aGF2ZUxpdmUuYWRkKGQpfQogICAgIGF3YWl0IHBheVB1dChkLHtkYXRlOmQscmFjZXM6ci5wYXlvdXRzLGZhaWxlZDowfSk7aGF2ZVBheS5hZGQoZCk7CiAgICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yLnJhY2VzO2NvbnNlYz0wOwogICAgfWNhdGNoKGUpe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgIGF3YWl0IHNsZWVwKDQwMCk7CiAgIH0KICAgaWYobW9udGhPayYmbW9udGg8Y3VyTW9udGgpYXdhaXQgbWV0YVB1dCgibW9udGg6Iittb250aCx0cnVlKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJzeW5jR28iKS5kaXNhYmxlZD1mYWxzZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWU7CiAgJCgic3luY1N0YXR1cyIpLmlubmVySFRNTD1gJHtzdC5zdG9wcGVkPyLpgKPntprjgZfjgablpLHmlZfjgZfjgZ/jgZ/jgoHkuK3mlq3jgZfjgb7jgZfjgZ/vvIhDbG91ZGZsYXJl5YG044Gu5re36ZuR44O75Yi26ZmQ44Gu5Y+v6IO95oCn77yJ44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOiIifSR7U1NUT1AmJiFzdC5zdG9wcGVkPyLlgZzmraLjgZfjgb7jgZfjgZ/jgIIiOihzdC5zdG9wcGVkPyIiOiLlrozkuobjgIIiKX3ku4rlm57jga7lj5blvpfvvJoke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJYCsoc3QuZmFpbC5sZW5ndGg/YFxuPHNwYW4gY2xhc3M9Indhcm4iPuWkseaVlyAke3N0LmZhaWwubGVuZ3RofeS7tu+8miR7ZXNjKHN0LmZhaWwuc2xpY2UoMCw0KS5qb2luKCLjgIEiKSl9JHtzdC5mYWlsLmxlbmd0aD40PyIg4oCmIjoiIn1cbu+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeWkseaVl+OBl+OBn+aXpeOBoOOBkeOChOOCiuebtOOBl+OBvuOBme+8iTwvc3Bhbj5gOiIiKTsKICBhd2FpdCBzaG93U3RhdGUoKTsKIH0KfTsKCi8qIC0tLSDmiZXmiLvjga7mm7jjgY3lh7rjgZfjg7voqq3jgb/ovrzjgb8gLS0tICovCiQoInBheUV4cCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aClyZXR1cm4gYWxlcnQoIuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAgiIpOwogY29uc3QgYT1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJhIik7YS5ocmVmPVVSTC5jcmVhdGVPYmplY3RVUkwobmV3IEJsb2IoW0pTT04uc3RyaW5naWZ5KHBzKV0se3R5cGU6ImFwcGxpY2F0aW9uL2pzb24ifSkpOwogYS5kb3dubG9hZD1ga2VpYmFfcGF5b3V0c18ke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKX0uanNvbmA7YS5jbGljaygpO3NldFRpbWVvdXQoKCk9PlVSTC5yZXZva2VPYmplY3RVUkwoYS5ocmVmKSwxMDAwKX07CiQoInBheUltcCIpLm9uY2hhbmdlPWFzeW5jIGU9PnsKIGNvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoIWYpcmV0dXJuOwogdHJ5e2NvbnN0IGo9SlNPTi5wYXJzZShhd2FpdCBmLnRleHQoKSk7Y29uc3QgYXJyPUFycmF5LmlzQXJyYXkoaik/ajooai5yYWNlcz9bal06W10pOwogIGNvbnN0IGJ5RGF0ZT1uZXcgTWFwKCk7CiAgZm9yKGNvbnN0IHggb2YgYXJyKXtpZih4JiZBcnJheS5pc0FycmF5KHgucmFjZXMpJiZ4LmRhdGUpYnlEYXRlLnNldCh4LmRhdGUse2RhdGU6eC5kYXRlLHJhY2VzOngucmFjZXMsZmFpbGVkOnguZmFpbGVkfHwwfSl9CiAgZm9yKGNvbnN0W2Qscl1vZiBieURhdGUpYXdhaXQgcGF5UHV0KGQscik7CiAgYXdhaXQgc2hvd1N0YXRlKCk7CiB9Y2F0Y2goZXJyKXskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuiqreOBv+i+vOOBv+OCqOODqeODvO+8miR7ZXNjKGVyci5tZXNzYWdlKX08L3NwYW4+YH0KIGUudGFyZ2V0LnZhbHVlPSIiOwp9OwoKLyogLS0tIOKRoC0yIOikh+WLneWbnuWPjueOh+OBruaknOiovCAtLS0gKi8KJCgiYnRSdW4iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiOwogIGNvbnN0IHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3Qgc3BsaXQ9cGRhdGVzW01hdGguZmxvb3IocGRhdGVzLmxlbmd0aC8yKV07CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKICBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiAgYnVzeSh0cnVlLCLjg5Djg4Pjgq/jg4bjgrnjg4jkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0PVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkR9KTtidXN5KGZhbHNlKTsKICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK3vvIjln7rmupbvvIkiLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIrvvIjjgqrjg4Pjgrrlv4XopoHvvIkifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX08L3NwYW4+YDoiLSI7CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvdXQucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvI8ke3N0YXJ0feOAnO+8iOWJjeWNiu+8nSR7c3BsaXR944KI44KK5YmN44CB5b6M5Y2K77yd5Lul6ZmN77yJ77yP5ZCEMTAw5YaGPC9kaXY+PGJyPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7os7zlhaXmlbA8L3RoPjx0aD7nmoTkuK3njoc8L3RoPjx0aD7lm57lj47njocoOTUl5bmFKTwvdGg+PHRoPuWJjeWNijwvdGg+PHRoPuW+jOWNijwvdGg+PHRoPuWtpue/kuW+jDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW91dC5zdGF0c1trXTtpZighdi5hbGwuYmV0cyljb250aW51ZTsKICAgaCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7di5hbGwuYmV0cy50b0xvY2FsZVN0cmluZygpfTwvdGQ+PHRkPiR7KHYuYWxsLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD48Yj4ke2Modi5hbGwpfTwvYj48L3RkPjx0ZD4ke3YuQS5iZXRzP3BjdCh2LkEucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkIuYmV0cz9wY3Qodi5CLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5DLmJldHM/YCR7cGN0KHYuQy5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh2LkMuc2UqMTk2KS50b0ZpeGVkKDApfe+8iCR7di5DLmJldHMudG9Mb2NhbGVTdHJpbmcoKX3vvIk8L3NwYW4+YDoiLSJ9PC90ZD48L3RyPmB9CiAgaCs9YDwvdGJvZHk+PC90YWJsZT48ZGl2IGNsYXNzPSJzbWFsbCI+PGJyPuimi+aWue+8muOAjOWtpue/kuW+jOOAjeOBr+OAgeODouODh+ODq+OBruWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iCR7TU9ERUxfVFJBSU5fRU5EfeS7pemZje+8ieOBp+OAgeacgOOCguS/oemgvOOBp+OBjeOCi+WIl+OBp+OBmeOAguOBneOCjOS7peWJjeOBruacn+mWk+OBr+OAgeODouODh+ODq+OBjOetlOOBiOOCkuimi+OBpuOBhOOCi+OBn+OCgeOAgeOChOOChOiJr+OBj+WHuuOBvuOBmeOAguODhOODvOODq+OBruiyt+OBhOaWueOBruWbnuWPjueOh+OBjOOAjOeptOOCvuODvOODs+WFqOmgreOAjeOCiOOCiuOAgTk1JeW5heOCkui2heOBiOOBpumrmOOBj+OAgeWJjeWNiuODu+W+jOWNiuOBruS4oeaWueOBp+WQjOOBmOWQkeOBjeOBquOCieWKueaenOOBguOCiuOBqOWIpOaWreOBp+OBjeOBvuOBmeOAguW5heOBjOmHjeOBquOCi+WgtOWQiOOBr+OAgeWBtueEtuOBruWPr+iDveaAp+OBjOaui+OCiuOBvuOBmeOAguWbnuWPjueOh+OBjDEwMCXmnKrmuoDjgarjgonjgIHlirnmnpzjgYzjgYLjgaPjgabjgoLosrfjgYTntprjgZHjgovjgajosqDjgZHjgb7jgZnjgII8L2Rpdj5gOwogICQoImJ0T3V0IikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOOCquODg+OCuuWPluW+l++8iC9qcmEtb2Rkc++8muW9k+aXpeODu+WJjeaXpeWjsuOCiuOBruWNmOWLneOCquODg+OCuu+8iSAtLS0gKi8KbGV0IE9ERFM9e307CmZ1bmN0aW9uIG9kZHNGb3IocmFjZSl7CiBjb25zdCBtPXJhY2UmJnJhY2Uua2V5P09ERFNbcmFjZS5rZXldOm51bGw7aWYoIW0pcmV0dXJuIG51bGw7CiBjb25zdCBhcnI9cmFjZS5ydW5uZXJzLm1hcChyPT5tW3IubnVtXSk7cmV0dXJuIGFyci5ldmVyeShvPT5vPjEpP2FycjpudWxsOwp9CiQoIm9kZHNHZXQiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGlmKCFXUkFDRVMubGVuZ3RoKXJldHVybjsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpLGQ9V0RBVEU7T0REUz17fTsKIGNvbnN0IHZlbnVlcz1bLi4ubmV3IFNldChXUkFDRVMubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbik7CiBsZXQgZGlhZ0FsbD1bXSxlcnI9IiI7CiAkKCJvZGRzR2V0IikuZGlzYWJsZWQ9dHJ1ZTsKIHRyeXsKICBmb3IobGV0IGk9MDtpPHZlbnVlcy5sZW5ndGg7aSsrKXsKICAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PWDjgqrjg4Pjgrrlj5blvpfkuK3igKYgJHtpKzF9LyR7dmVudWVzLmxlbmd0aH3plovlgqzloLRgOwogICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/ZGF0ZT0ke2R9JnZlbnVlPSR7dmVudWVzW2ldfWApOwogICAgZm9yKGNvbnN0IHIgb2YgKHgucmFjZXN8fFtdKSlPRERTW2Ake1N0cmluZyhyLnZlbnVlQ29kZSkucGFkU3RhcnQoMiwiMCIpfS0ke3IucmFjZU5vfWBdPXIub2RkczsKICAgIGlmKCEoeC5yYWNlc3x8W10pLmxlbmd0aClkaWFnQWxsLnB1c2goLi4uKHguZGlhZ25vc3RpY3N8fFtdKS5zbGljZSgwLDYpKTsKICAgfWNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7ZGlhZ0FsbC5wdXNoKHt2ZW51ZTp2ZW51ZXNbaV0sZXJyb3I6ZS5tZXNzYWdlfSl9CiAgfQogfWZpbmFsbHl7JCgib2Rkc0dldCIpLmRpc2FibGVkPWZhbHNlfQogY29uc3Qgbj1PYmplY3Qua2V5cyhPRERTKS5sZW5ndGg7CiAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfvvI/jgqrjg4PjgrogJHtufeODrOODvOOCueWIhmArKG4/IiI6Ilxu44Kq44OD44K644KS5Y+W5b6X44Gn44GN44G+44Gb44KT44Gn44GX44Gf77yI55m65aOy5YmN44CB44G+44Gf44Gv55S76Z2i5qeL6YCg44Gu6YGV44GE77yJ44CCIisoZXJyPyJcbueQhueUse+8miIrZXJyOiIiKSsoZGlhZ0FsbC5sZW5ndGg/Ilxu6Ki65pat77yaIitKU09OLnN0cmluZ2lmeShkaWFnQWxsKS5zbGljZSgwLDcwMCk6IiIpKTsKIHJlbmRlclZlbnVlQnV0dG9ucyhkKTsKfTsKCi8qIC0tLSDimIUg5pys5pel44Gu5aW96LWw56m06aas77yI44Ov44Oz44K/44OD44OX77yJIC0tLSAqLwpjb25zdCBqc3RUb2RheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKJCgidGRhdGUiKS52YWx1ZT1qc3RUb2RheSgpOwokKCJ0b2RheUdvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBkPSQoInRkYXRlIikudmFsdWU7aWYoIWQpcmV0dXJuOwogJCgidG9kYXlHbyIpLmRpc2FibGVkPXRydWU7JCgidG9kYXlPdXQiKS5pbm5lckhUTUw9IiI7JCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD0i5Ye66aas6KGo44KS5Y+W5b6X5Lit4oCmIjsKIHRyeXsKICAkKCJ3ZGF0ZSIpLnZhbHVlPWQ7YXdhaXQgJCgid2dldCIpLm9uY2xpY2soKTsKICBpZighV1JBQ0VTLmxlbmd0aCl7CiAgICQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9JCgid3N0YXR1cyIpLnRleHRDb250ZW50OwogICBpZihBVkFJTC5sZW5ndGgpeyQoInRvZGF5T3V0IikuaW5uZXJIVE1MPUFWQUlMLm1hcCh4PT5gPGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLWQ9IiR7eH0iPiR7eH08L2J1dHRvbj5gKS5qb2luKCIiKTsKICAgICQoInRvZGF5T3V0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtZF0iKS5mb3JFYWNoKGJ0PT5idC5vbmNsaWNrPSgpPT57JCgidGRhdGUiKS52YWx1ZT1idC5kYXRhc2V0LmQ7JCgidG9kYXlHbyIpLmNsaWNrKCl9KX0KICAgcmV0dXJufQogICQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfjgILjgqrjg4PjgrrjgpLnorroqo3kuK3igKZgOwogIGF3YWl0ICQoIm9kZHNHZXQiKS5vbmNsaWNrKCk7CiAgY29uc3Qgbj1PYmplY3Qua2V5cyhPRERTKS5sZW5ndGg7CiAgJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCue+8j+OCquODg+OCuiAke25944Os44O844K55YiGYCsobj8iIjoi77yI44Kq44OD44K65pyq5Y+W5b6X77ya44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgYXdhaXQgcnVuQWxsKCJ0b2RheU91dCIpOwogfWNhdGNoKGUpeyQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9IuOCqOODqeODvO+8miIrZS5tZXNzYWdlfQogZmluYWxseXskKCJ0b2RheUdvIikuZGlzYWJsZWQ9ZmFsc2V9Cn07CiQoInRvZGF5VXBkIikub25jbGljaz1hc3luYygpPT57CiAkKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PSLlrabnv5Ljg4fjg7zjgr/jga7mnIDntYLml6XjgpLnorroqo3kuK3igKYiOwogbGV0IG09IiI7YXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoci5kYXRlPm0pbT1yLmRhdGV9KTsKIGNvbnN0IGZyb209bT9hZGREYXlzKG0sMSk6IjIwMjMtMDEtMDEiLHRvPWpzdFllc3RlcmRheSgpOwogaWYoZnJvbT50byl7JCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1g5a2m57+S44OH44O844K/44Gv44GZ44Gn44Gr5pyA5paw44Gn44GZ77yI5pyA57WC5pelICR7bX3vvInjgIJgO3JldHVybn0KICQoInNzdGFydCIpLnZhbHVlPWZyb207JCgic2VuZCIpLnZhbHVlPXRvOwogJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtmcm9tfeOAnCR7dG99IOOBruaIkOe4vuOCkuWPluW+l+OBl+OBvuOBmeOAgumAsuaNl+OBr+OAjOKRoCDjg4fjg7zjgr/lj5blvpfjgI3jga7mrITjgavlh7rjgb7jgZnjgIJgOwogJCgic3luY0dvIikuY2xpY2soKTskKCJzeW5jU3RhdHVzIikuc2Nyb2xsSW50b1ZpZXcoe2JlaGF2aW9yOiJzbW9vdGgifSk7Cn07CgooYXN5bmMoKT0+e3RyeXthd2FpdCBvcGVuREIoKTthd2FpdCBzaG93U3RhdGUoKTthd2FpdCBwYXlTdGF0ZSgpfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kv53lrZjpoJjln5/jgpLplovjgZHjgb7jgZvjgpPvvJoke2VzYyhlLm1lc3NhZ2UpfVxu77yI44OX44Op44Kk44OZ44O844OI44OW44Op44Km44K644Gn44Gv5L2/44GI44Gq44GE44GT44Go44GM44GC44KK44G+44GZ77yJPC9zcGFuPmB9fSkoKTsKaWYoL15odHRwcz86Ly50ZXN0KGxvY2F0aW9uLnByb3RvY29sKSkkKCJ3dXJsIikudmFsdWU9bG9jYXRpb24ub3JpZ2luOwpzaG93UGFuZSgiV29ya2VyIik7Cgo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==";
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

/* ---- オッズ（best effort：JRAのオッズ画面の構造は実物未確認。診断つき） ---- */
function parseJraOddsHtml(html) {
  const odds = {};
  const rows = String(html || "").split(/<tr[\s>]/i).slice(1);
  for (const row of rows) {
    const num = row.match(/<td[^>]*class="[^"]*\bnum\b[^"]*"[^>]*>\s*(\d{1,2})\s*<\/td>/i);
    if (!num) continue;
    let o = row.match(/class="[^"]*odds_tan[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([\d,]+\.\d)/i);
    if (!o) {
      // 馬名の後ろの最初の小数（単勝オッズ）
      const after = row.replace(/^[\s\S]*?class="[^"]*horse[^"]*"[\s\S]*?<\/td>/i, "");
      o = after.match(/>\s*(?:<[^>]+>\s*)*([\d,]+\.\d)\s*</);
    }
    if (o) odds[Number(num[1])] = Number(o[1].replace(/,/g, ""));
  }
  return odds;
}

async function handleJraOdds(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venueFilter = url.searchParams.get("venue");
  if (!isValidDateString(date)) return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  const compact = date.replace(/-/g, "");
  const diag = [];
  const cnameRe = /pw15o[a-z]{2}\d{2}[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/g;
  const collect = html => [...new Set(String(html || "").match(cnameRe) || [])];
  try {
    const top = await fetchJRAHtmlPost("/JRADB/accessO.html", "pw15oli00/6D");
    const topC = collect(top);
    diag.push({ step: "odds-top", htmlLength: top.length, cnames: topC.length, kinds: [...new Set(topC.map(c => c.slice(0, 9)))].slice(0, 8), sample: topC.slice(0, 5) });
    // 指定日を含むページ（開催場別）を開き、そこから単勝・複勝の画面（pw151ou）を集める
    let level1 = topC.filter(c => c.includes(compact));
    const raceLevel = new Map();
    const addRace = c => { if (/^pw151ou/i.test(c)) raceLevel.set(c, true); };
    topC.forEach(addRace);
    for (const c of level1.slice(0, 6)) {
      try {
        const html = await fetchJRAHtmlPost("/JRADB/accessO.html", c);
        const cs = collect(html);
        cs.forEach(addRace);
        diag.push({ step: "odds-level1", cname: c, htmlLength: html.length, found: cs.length, raceLevel: cs.filter(x => /^pw151ou/i.test(x)).length });
      } catch (error) {
        diag.push({ step: "odds-level1", cname: c, error: String(error?.message || error) });
      }
    }
    const targets = [...raceLevel.keys()].filter(c => c.includes(compact));
    const races = [];
    for (const c of targets.slice(0, 14)) {
      try {
        const html = await fetchJRAHtmlPost("/JRADB/accessO.html", c);
        const odds = parseJraOddsHtml(html);
        // 開催場コード・レース番号：CNAME（pw151ou10 + 開催場2桁 + 開催8桁 + R2桁 + 日付8桁）から読む
        const m = c.match(/^pw151ou\d{2}(\d{2})\d{8}(\d{2})\d{8}/i);
        const venueCode = m ? m[1] : null, raceNo = m ? Number(m[2]) : null;
        const n = Object.keys(odds).length;
        diag.push({ step: "odds-race", cname: c, venueCode, raceNo, horses: n, htmlLength: html.length });
        if (n >= 4 && venueCode && raceNo && (!venueFilter || venueCode === String(venueFilter))) races.push({ venueCode, raceNo, odds });
      } catch (error) {
        diag.push({ step: "odds-race", cname: c, error: String(error?.message || error) });
      }
    }
    return json({ ok: true, date, count: races.length, races, diagnostics: diag.slice(0, 20) });
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
