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
  jockey = jockey.replace(/^[☆★▲△\s]+/, "").trim();
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+Cjx0aXRsZT7nqbTppqzlpb3otbDjg4Tjg7zjg6s8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOX0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMH19CmJvZHl7bWFyZ2luOjA7YmFja2dyb3VuZDp2YXIoLS1iZyk7Y29sb3I6dmFyKC0tdHgpO2ZvbnQtZmFtaWx5Oi1hcHBsZS1zeXN0ZW0sQmxpbmtNYWNTeXN0ZW1Gb250LCJTZWdvZSBVSSIsc2Fucy1zZXJpZn0KaGVhZGVye2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxNHB4IDE2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxOXB4fQptYWlue21heC13aWR0aDo5MDBweDttYXJnaW46YXV0bztwYWRkaW5nOjEwcHh9CnNlY3Rpb257YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxNHB4O21hcmdpbjoxMHB4IDA7Ym94LXNoYWRvdzowIDFweCA0cHggIzAwMDF9Cmgye2ZvbnQtc2l6ZToxNnB4O21hcmdpbjowIDAgOHB4fQpidXR0b257Ym9yZGVyOjA7Ym9yZGVyLXJhZGl1czo5cHg7cGFkZGluZzoxMXB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1wcik7Y29sb3I6I2ZmZjtmb250LXdlaWdodDo3MDA7bWFyZ2luOjRweCA0cHggNHB4IDA7Zm9udC1zaXplOjE0cHh9CmJ1dHRvbjpkaXNhYmxlZHtvcGFjaXR5Oi40fWJ1dHRvbi5zdWJ7YmFja2dyb3VuZDojNjY3MDg1fQppbnB1dCxzZWxlY3QsdGV4dGFyZWF7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCU7Ym94LXNpemluZzpib3JkZXItYm94fQp0ZXh0YXJlYXt3aWR0aDoxMDAlO21pbi1oZWlnaHQ6MTIwcHg7Zm9udC1mYW1pbHk6aW5oZXJpdH0KLnNtYWxse2ZvbnQtc2l6ZToxM3B4O2NvbG9yOnZhcigtLXN1Yil9LnN0YXR1c3twYWRkaW5nOjlweDtiYWNrZ3JvdW5kOnZhcigtLWJnKTtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjhweDt3aGl0ZS1zcGFjZTpwcmUtd3JhcH0KLmdvb2R7Y29sb3I6IzEzNzMzMztmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6I2MyNmEwMDtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodH0KdGg6bnRoLWNoaWxkKC1uKzIpLHRkOm50aC1jaGlsZCgtbisyKXt0ZXh0LWFsaWduOmxlZnR9Ci5jYW5ke2JvcmRlcjoxcHggc29saWQgdmFyKC0tbG4pO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjlweDttYXJnaW46OHB4IDB9Ci5jaGlwe2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtc2l6ZToxMnB4O2JvcmRlci1yYWRpdXM6OTk5cHg7cGFkZGluZzoycHggOHB4O21hcmdpbjozcHggNHB4IDAgMDtiYWNrZ3JvdW5kOiNlZWYxZjU7Y29sb3I6IzM0NDA1NH0KLmNoaXAuYntiYWNrZ3JvdW5kOiNlMGYyZTY7Y29sb3I6IzEzNzMzM30uY2hpcC5ve2JhY2tncm91bmQ6I2ZmZWZjZjtjb2xvcjojOWE1YTAwfS5jaGlwLmd7YmFja2dyb3VuZDojZTZlOWVlO2NvbG9yOiM1ZDY4NzV9Ci5ydHtkaXNwbGF5OmlubGluZS1ibG9jaztmb250LXdlaWdodDo4MDA7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzowIDdweDtjb2xvcjojZmZmO2JhY2tncm91bmQ6Izk4YTJiM30KLnJ0LnJTe2JhY2tncm91bmQ6I2Q5MmQyMH0ucnQuckF7YmFja2dyb3VuZDojZjc5MDA5fS5ydC5yQntiYWNrZ3JvdW5kOiMxNjY3ZDl9Ci5yb3d7ZGlzcGxheTpmbGV4O2dhcDo4cHg7ZmxleC13cmFwOndyYXA7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbjo2cHggMH0KI2J1c3l7ZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDojMDAwODt6LWluZGV4OjIwO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyfQojYnVzeT5kaXZ7YmFja2dyb3VuZDp2YXIoLS1oZCk7Y29sb3I6I2ZmZjtwYWRkaW5nOjE4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O21heC13aWR0aDo4MCU7dGV4dC1hbGlnbjpjZW50ZXI7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Cjwvc3R5bGU+PC9oZWFkPjxib2R5Pgo8aGVhZGVyPueptOmmrOWlvei1sOODhOODvOODqyA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxM3B4Ij7ljZjkvZPniYggdjE8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgo8c2VjdGlvbj4KPGgyPuKRoCDjg4fjg7zjgr/lj5blvpfvvIjjgZPjga7jgqLjg5fjg6rjgaDjgZHjgaflrozntZDvvIk8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+SlJB5YWs5byP44GL44KJ44CB6YGO5Y6744Gu5oiQ57i+77yI5Lq65rCX44Gk44GN77yJ44Go6KSH5Yud44O75Y2Y5Yud44Gu5omV5oi744KS5Y+W5b6X44GX44Gm44CB44GT44Gu56uv5pyr44Gr5L+d5a2Y44GX44G+44GZ44CC5YWD44Gu44Ki44OX44Oq44KE44OQ44OD44Kv44Ki44OD44OX44Gv5LiN6KaB44Gn44GZ44CC5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZ44CCPC9kaXY+CjxkaXYgY2xhc3M9InJvdyBzbWFsbCI+5o6l57aa5YWIIDxpbnB1dCBpZD0id3VybCIgc3R5bGU9ImZsZXg6MTttaW4td2lkdGg6MjIwcHgiIHZhbHVlPSJodHRwczovL2tlaWJhLWFpLXBheW91dHMuaHQxOTk1MDgyMi53b3JrZXJzLmRldiI+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+5pyf6ZaTIDxpbnB1dCBpZD0ic3N0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+IOOAnCA8aW5wdXQgaWQ9InNlbmQiIHR5cGU9ImRhdGUiPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InN5bmNHbyI+6YGO5Y675oiQ57i+44Go5omV5oi744KS5Y+W5b6XPC9idXR0b24+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGlkPSJzeW5jU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYw8L2Rpdj4KPGRpdiBpZD0iZGF0YVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+CjxkZXRhaWxzPjxzdW1tYXJ5IGNsYXNzPSJzbWFsbCI+44OQ44OD44Kv44Ki44OD44OXSlNPTu+8j0NTVuOBi+OCieiqreOBv+i+vOOCgO+8iOS7u+aEj++8iTwvc3VtbWFyeT4KPGRpdiBjbGFzcz0ic21hbGwiPuWFg+OCouODl+ODquOBruODkOODg+OCr+OCouODg+ODl+OBjOOBguOCjOOBsOOAgeWPluW+l+OCkuecgeeVpeOBp+OBjeOBvuOBme+8iOWQjOOBmOaXpeOBr+mHjeikh+OBl+OBpuWPluOCiui+vOOBv+OBvuOBm+OCk++8ieOAgjwvZGl2Pgo8aW5wdXQgaWQ9ImZpbGUiIHR5cGU9ImZpbGUiIGFjY2VwdD0iLmpzb24sLmNzdixhcHBsaWNhdGlvbi9qc29uLHRleHQvY3N2Ij4KPC9kZXRhaWxzPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoC0yIOikh+WLneWbnuWPjueOh+OBruaknOiovDwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfmuIjjgb/jga7miJDnuL7jgajmiZXmiLvjgafjgIHmmYLns7vliJfvvIjjgZ3jga7ml6XjgojjgorliY3jga7miJDnuL7jgaDjgZHvvInjga7jg5Djg4Pjgq/jg4bjgrnjg4jjgpLjgZfjgb7jgZnjgILnqbTjgr7jg7zjg7Pjga/lrp/pmpvjga7kurrmsJfjgafliKTlrprjgZfjgIHlkITjg6zjg7zjgrkxMDDlhobjgZrjgaTos7zlhaXjgajku67lrprjgZfjgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InBheUV4cCIgY2xhc3M9InN1YiI+5omV5oi744KS5pu444GN5Ye644GXPC9idXR0b24+PGxhYmVsIGNsYXNzPSJzbWFsbCI+6Kqt44G/6L6844G/IDxpbnB1dCBpZD0icGF5SW1wIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uIj48L2xhYmVsPjwvZGl2Pgo8ZGl2IGlkPSJidE91dCIgY2xhc3M9InN0YXR1cyI+44OH44O844K/5Y+W5b6X44Gu44GC44Go44Gn5a6f6KGM44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGhIOODrOODvOOCueOCkumBuOOBtjwvaDI+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0idGFiV29ya2VyIiBjbGFzcz0ic3ViIj7lh7rppqzooajjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJ0YWJNYW51YWwiIGNsYXNzPSJzdWIiPuaJi+WFpeWKmzwvYnV0dG9uPjxidXR0b24gaWQ9InRhYlBhc3QiIGNsYXNzPSJzdWIiPumBjuWOu+ODrOODvOOCueOBp+ippuOBmTwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGlkPSJwYW5lV29ya2VyIiBzdHlsZT0iZGlzcGxheTpub25lIj4KIDxkaXYgY2xhc3M9InNtYWxsIj7ml6LlrZjjga5Xb3JrZXLjga4gL3JhY2UtY2FyZHMg44KS6Kqt44G/5Y+W44KL44Gg44GR44Gn44GZ77yI5aSJ5pu044GX44G+44Gb44KT77yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0id2RhdGUiIHR5cGU9ImRhdGUiPjwvZGl2PgogPGJ1dHRvbiBpZD0id2dldCI+6ZaL5YKs44O744Os44O844K544KS5Y+W5b6XPC9idXR0b24+PGJ1dHRvbiBpZD0ib2Rkc0dldCIgY2xhc3M9InN1YiIgZGlzYWJsZWQ+44Kq44OD44K644KS5Y+W5b6XPC9idXR0b24+PGJ1dHRvbiBpZD0id2FsbCIgY2xhc3M9InN1YiIgZGlzYWJsZWQ+5YWo44Os44O844K55LiA5ous6Kej5p6QPC9idXR0b24+PGRpdiBpZD0id3N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5Y+W5b6XPC9kaXY+PGRpdiBpZD0id2xpc3QiPjwvZGl2PjxkaXYgaWQ9ImFsbG91dCI+PC9kaXY+CjwvZGl2Pgo8ZGl2IGlkPSJwYW5lTWFudWFsIiBzdHlsZT0iZGlzcGxheTpub25lIj4KIDxkaXYgY2xhc3M9InNtYWxsIj4x6KGM44Gr44CM6aas55WqIOmmrOWQjeOAjeOAguS7u+aEj+OBp+acgOW+jOOBq+WNmOWLneOCquODg+OCuuOAguS+i++8mjxicj4xIOKXi+KXi+KXi+KXiyAzLjQ8YnI+MiDilrPilrPilrPilrM8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJtZGF0ZSIgdHlwZT0iZGF0ZSI+PHNlbGVjdCBpZD0ibXN1cmYiPjxvcHRpb24gdmFsdWU9IjEiPuiKnTwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjIiPuODgOODvOODiDwvb3B0aW9uPjwvc2VsZWN0PjxpbnB1dCBpZD0ibWRpc3QiIHR5cGU9Im51bWJlciIgc3RlcD0iMTAwIiB2YWx1ZT0iMTYwMCIgc3R5bGU9IndpZHRoOjkwcHgiPm08L2Rpdj4KIDx0ZXh0YXJlYSBpZD0ibXRleHQiIHBsYWNlaG9sZGVyPSIxIOmmrOWQjSYjMTA7MiDppqzlkI0iPjwvdGV4dGFyZWE+CiA8YnV0dG9uIGlkPSJtZ28iPuOBk+OBruODrOODvOOCueOCkuS9v+OBhjwvYnV0dG9uPgo8L2Rpdj4KPGRpdiBpZD0icGFuZVBhc3QiIHN0eWxlPSJkaXNwbGF5Om5vbmUiPgogPGRpdiBjbGFzcz0ic21hbGwiPuS/neWtmOa4iOOBv+OBrumBjuWOu+ODrOODvOOCueOCkuOAgeOBneOBruaXpeOCiOOCiuWJjeOBruODh+ODvOOCv+OBoOOBkeOBp+S6iOaDs+OBl+OBvuOBmeOAguWun+mam+OBruedgOmghuOCkuS4puOBueOBpueiuuiqjeOBp+OBjeOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9InBkYXRlIiB0eXBlPSJkYXRlIj48YnV0dG9uIGlkPSJwZ2V0Ij7jgZ3jga7ml6Xjga7jg6zjg7zjgrnkuIDopqc8L2J1dHRvbj48L2Rpdj4KIDxkaXYgaWQ9InBzdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuaXpeS7mOOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgjwvZGl2PjxkaXYgaWQ9InBsaXN0Ij48L2Rpdj4KPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGiIOeptOmmrOWlvei1sOOCkuino+aekDwvaDI+CjxkaXYgaWQ9InJhY2VsYWJlbCIgY2xhc3M9InNtYWxsIj7jg6zjg7zjgrnjgpLpgbjmip7jgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPGJ1dHRvbiBpZD0icnVuIiBkaXNhYmxlZD7op6PmnpDjgZnjgos8L2J1dHRvbj4KPGRpdiBpZD0ib3V0IiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYw8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaMg44GT44Gu44OE44O844Or44Gr44Gk44GE44GmPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPgrlpb3otbDnjofvvJ0z552A5YaF44Gr5YWl44KL56K6546H44Gu5o6o5a6a44CC57Sg54K544Gv44CM6aas44GuM+edgOWGheeOh++8iOWwkeaVsOi1sOOBr+e4ruWwj++8ieODu+ebtOi/kTPotbDjg7vlkIzmnaHku7bvvIjoip3jg4Av6Led6ZuiwrEyMDBt77yJ5a6f57i+44O75bm06b2i44O75Yil6aas5aC044G444Gu5pu/44KP44KK44CN44CCPGJyPgo8Yj4y44Gk44Gu44Oi44O844OJPC9iPu+8mjxicj4K44O744Kq44OD44K65pyq5YWl5Yqb77ya56m044K+44O844Oz44KS44CM44OE44O844Or5o6o5a6a44Gu5Lq65rCX77yI6aiO5omL5oiQ57i+6L6844G/77yJ44CN44Gn5Yik5a6a44CC5a6f6Zqb44Gu5Lq65rCX44Go44Gv57SENjcl44GX44GL5LiA6Ie044GX44G+44Gb44KT44CCPGJyPgrjg7vjgqrjg4PjgrrlhaXlipvvvJrnqbTjgr7jg7zjg7PjgpLlrp/pmpvjga7kurrmsJfjgafliKTlrprjgZfjgIHlppnlkbPjgoLlh7rjgZfjgb7jgZnjgILjgZPjgaHjgonjgYzmnKzmnaXjga7kvb/jgYTmlrnjgafjgZnjgII8YnI+CjxiPuaknOiovOe1kOaenO+8iDIwMjPjgJwyMDI25bm044O75pmC57O75YiX44O75YmN5Y2K5b6M5Y2K44Gn5ZCM5YK+5ZCR77yJPC9iPu+8mjxicj4K44O744Kq44OD44K65YWl5Yqb5pmC77ya56m044K+44O844Oz5YWo5L2T44GuM+edgOWGheeOhyDntIQ5JeOAgeODhOODvOODqzHkvY3lgJnoo5wg57SEMTjjgJwxOSXjgIHkuIrkvY0y6aCtIOe0hDE2JeOAgjxicj4K44O744Kq44OD44K65pyq5YWl5Yqb5pmC77ya56m044K+44O844Oz5YWo5L2TIOe0hDEzJeOAgTHkvY3lgJnoo5wg57SEMjcl44CB5LiK5L2NMumgrSDntIQyMyXvvIgx5L2N5YCZ6KOc44Gu57SENjcl44GM5a6f6Zqb44Gr5Lq65rCX6JaE77yJ44CCPGJyPgrooajnpLrjga7jgIzlpb3otbDnjofjgI3jga/jgIHjg6Ljg7zjg4njgZTjgajjgavpgY7ljrvlrp/nuL7jgbjlkIjjgo/jgZvjgZ/oo5zmraPlgKTjgafjgZnjgILjg6njg7Pjgq/jgoLjg6Ljg7zjg4nliKXjga7ln7rmupbjgafjgZnjgII8YnI+CuOCquODg+OCuuODu+S6uuawl+OBr+S6iOa4rOOCueOCs+OCouOBq+OBr+S9v+OBo+OBpuOBhOOBvuOBm+OCk+OAgumojuaJi+aIkOe4vuOBr+OAjOS6uuawl+OBruS7o+eQhuOAjeOBruWIpOWumuOBq+OBoOOBkeS9v+OBhOOAgeWAmeijnOOBrumghuS9jeS7mOOBkeOBq+OBr+S9v+OBhOOBvuOBm+OCk++8iOmghuS9jeS7mOOBkeOBq+WFpeOCjOOCi+OBqOaIkOe4vuOBjOS4i+OBjOOBo+OBn+OBn+OCge+8ieOAgjxicj4K6KSH5Yud5Zue5Y+O546H44Gv5omV5oi744OH44O844K/44GM44Gq44GE44Go5qSc6Ki844Gn44GN44G+44Gb44KT77yI4pGgLTLjgJzikaAtM+OBp+aknOiovOOBp+OBjeOBvuOBme+8ieOAggo8L2Rpdj4KPC9zZWN0aW9uPgo8L21haW4+CjxkaXYgaWQ9ImJ1c3kiPjxkaXYgaWQ9ImJ1c3lUZXh0Ij7lh6bnkIbkuK3igKY8L2Rpdj48L2Rpdj4KPHNjcmlwdD4KInVzZSBzdHJpY3QiOwovKiDnqbTppqzlpb3otbDjgqjjg7Pjgrjjg7PvvIjljZjkvZPniYjjg7vjg5bjg6njgqbjgrYvTm9kZeWFseeUqO+8ieOAguOCquODg+OCuuODu+S6uuawl+OBr+OCueOCs+OCouOBq+S9v+eUqOOBl+OBquOBhOOAgiAqLwpjb25zdCBVRT0oKCk9PnsKIC8qIOWun+ODh+ODvOOCv+aknOiovOOBp+mAhuWKueaenOOBoOOBo+OBn+aIkOWIhu+8iOmojuaJi+ODu+mWk+malO+8ieOBr+aXouWumuOBp09GRiAqLwogY29uc3QgREVGQVVMVD17am9ja2V5OmZhbHNlLGxheW9mZjpmYWxzZX07CiBjb25zdCBjbGFtcD0oeCxhLGIpPT5NYXRoLm1heChhLE1hdGgubWluKGIseCkpOwogY29uc3Qgc2lnbW9pZD14PT4xLygxK01hdGguZXhwKC14KSk7CiBjb25zdCBsb2dpdD1wPT57cD1jbGFtcChwLC4wMDEsLjk5OSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKIGNvbnN0IG5uPXM9PlN0cmluZyhzPz8iIikubm9ybWFsaXplKCJORktDIikudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXHNcdTMwMDBdKy9nLCIiKS5yZXBsYWNlKC9b44O7772lLu+8jlwt4oCQ4oCR4oCS4oCT4oCU4oCVJ+KAmWBdL2csIiIpLnJlcGxhY2UoL1vimIbimIXilrPilrLil4fil4ZdL2csIiIpOwogLyog6aiO5omL5ZCN77ya5YWI6aCt44Gu5qyn5a2X44Kk44OL44K344Oj44Or44KS6Zmk44GN44CB44OH44Og44O844Ot4oaS44OH44OgIOOBq+aPg+OBiOOCi++8iEpSQeOBriBDLuODh+ODoOODvOODrSDjgajpgY7ljrvjg4fjg7zjgr/jga4g77yj77yO44OH44OgIOOCkuS4gOiHtOOBleOBm+OCi++8iSAqLwogY29uc3Qgam5uPXM9PntsZXQgdj1ubihzKTt2PXYucmVwbGFjZSgvXlthLXpdKD89W+OCoS3jg7bjg7xdKS8sIiIpO3Y9di5yZXBsYWNlKC9e44OH44Og44O844OtLywi44OH44OgIik7cmV0dXJuIHZ9OwogY29uc3Qgc3VyZkNvZGU9cz0+e3M9U3RyaW5nKHN8fCIiKTtyZXR1cm4gL+iKnXx0dXJmL2kudGVzdChzKT8xOi/jg4B8ZGlydC9pLnRlc3Qocyk/Mjov6ZqcfGp1bXAvaS50ZXN0KHMpPzM6MH07CiBjb25zdCBkbnVtPWQ9Pk51bWJlcihTdHJpbmcoZHx8IiIpLnJlcGxhY2UoL1xEL2csIiIpLnNsaWNlKDAsOCkpfHwwOwogZnVuY3Rpb24gcGFyc2VEYXRlKHMpewogIHM9U3RyaW5nKHN8fCIiKTtsZXQgbT1zLm1hdGNoKC8oXGR7NH0pXER7MCw0fShcZHsxLDJ9KVxEezAsNH0oXGR7MSwyfSkvKTsKICBpZighbSlyZXR1cm4iIjtyZXR1cm4gYCR7bVsxXX0tJHttWzJdLnBhZFN0YXJ0KDIsIjAiKX0tJHttWzNdLnBhZFN0YXJ0KDIsIjAiKX1gOwogfQogZnVuY3Rpb24gY3N2Um93cyh0ZXh0KXsKICBjb25zdCBsaW5lcz1TdHJpbmcodGV4dHx8IiIpLnJlcGxhY2UoL15cdUZFRkYvLCIiKS5zcGxpdCgvXHI/XG4vKS5maWx0ZXIoeD0+eC50cmltKCkpOwogIGlmKCFsaW5lcy5sZW5ndGgpcmV0dXJuW107CiAgY29uc3Qgc3BsaXQ9bD0+e2NvbnN0IGE9W107bGV0IGM9IiIscT1mYWxzZTtmb3IobGV0IGk9MDtpPGwubGVuZ3RoO2krKyl7Y29uc3QgY2g9bFtpXTsKICAgaWYoY2g9PT0nIicpe2lmKHEmJmxbaSsxXT09PSciJyl7Yys9JyInO2krK31lbHNlIHE9IXF9ZWxzZSBpZihjaD09PSIsIiYmIXEpe2EucHVzaChjKTtjPSIifWVsc2UgYys9Y2h9YS5wdXNoKGMpO3JldHVybiBhfTsKICBjb25zdCBoZWFkPXNwbGl0KGxpbmVzWzBdKS5tYXAoeD0+eC50cmltKCkpO2NvbnN0IG91dD1bXTsKICBmb3IobGV0IGk9MTtpPGxpbmVzLmxlbmd0aDtpKyspe2NvbnN0IGE9c3BsaXQobGluZXNbaV0pLG89e307Zm9yKGxldCBqPTA7ajxoZWFkLmxlbmd0aDtqKyspb1toZWFkW2pdXT1hW2pdPz8iIjtvdXQucHVzaChvKX0KICByZXR1cm4gb3V0OwogfQogY29uc3QgZj12PT57Y29uc3Qgbj1wYXJzZUZsb2F0KFN0cmluZyh2Pz8iIikucmVwbGFjZSgvLC9nLCIiKSk7cmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKT9uOm51bGx9OwogLyog44OQ44OD44Kv44Ki44OD44OXL0NTVuOBrjHooYzihpLou73ph4/ooYwgKi8KIGZ1bmN0aW9uIHRvUm93KG8pewogIGNvbnN0IHNhPVN0cmluZyhvWyLmgKfpvaIiXXx8IiIpO2NvbnN0IGFtPXNhLm1hdGNoKC8oXGQrKS8pOwogIHJldHVybntyYWNlSWQ6U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/P29bIlVubmFtZWQ6IDAiXT8/IiIpLGRhdGU6cGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pLAogICBuYW1lOlN0cmluZyhvWyLppqzlkI0iXXx8by5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpubihvWyLppqzlkI0iXXx8by5ob3JzZSksam9ja2V5OmpubihvWyLpqI7miYsiXXx8by5qb2NrZXkpLGZpbmlzaDpmKG9bIuedgOmghiJdPz9vLmZpbmlzaCksCiAgIGRpc3Q6ZihvLmNvdXJzZV9sZW4/P29bIui3nemboiJdPz9vLmRpc3RhbmNlKXx8MCxzdXJmOnN1cmZDb2RlKG8ucmFjZV90eXBlfHxvWyLoip3jg4AiXXx8by5zdXJmYWNlKSwKICAgYWdlOmFtP051bWJlcihhbVsxXSk6bnVsbCxudW06ZihvWyLppqznlaoiXSkscG9wOmYob1si5Lq65rCXIl0pLG9kZHM6ZihvWyLljZjli50iXSl9OwogfQogLyog5oiQ57i+44K544OI44Ki77yI5pel5LuY5piH6aCG44GrIGFkZCDjgZnjgovvvIkgKi8KIGZ1bmN0aW9uIFN0b3JlKCl7dGhpcy5oPW5ldyBNYXAoKTt0aGlzLmo9bmV3IE1hcCgpfQogU3RvcmUucHJvdG90eXBlLmFkZD1mdW5jdGlvbihyKXsKICBpZihyLmZpbmlzaD09bnVsbHx8IXIuaG9yc2UpcmV0dXJuOwogIGNvbnN0IHQzPXIuZmluaXNoPj0xJiZyLmZpbmlzaDw9Mz8xOjA7CiAgbGV0IGg9dGhpcy5oLmdldChyLmhvcnNlKTtpZighaCl0aGlzLmguc2V0KHIuaG9yc2UsaD17bjowLHRvcDM6MCx3aW46MCxzdW06MCxsYXN0OiIiLHJ1bnM6W119KTsKICBoLm4rKztoLnRvcDMrPXQzO2lmKHIuZmluaXNoPT09MSloLndpbisrO2guc3VtKz1yLmZpbmlzaDtpZihyLmRhdGU+aC5sYXN0KWgubGFzdD1yLmRhdGU7CiAgaC5ydW5zLnB1c2goW2RudW0oci5kYXRlKSxyLmZpbmlzaCxyLmRpc3Qsci5zdXJmXSk7aWYoaC5ydW5zLmxlbmd0aD42KXtoLnJ1bnMuc29ydCgoYSxiKT0+YVswXS1iWzBdKTtoLnJ1bnMuc2hpZnQoKX0KICBpZihyLmpvY2tleSl7bGV0IGo9dGhpcy5qLmdldChyLmpvY2tleSk7aWYoIWopdGhpcy5qLnNldChyLmpvY2tleSxqPXtuOjAsdG9wMzowfSk7ai5uKys7ai50b3AzKz10M30KIH07CiBjb25zdCBsYXlvZmY9KGxhc3QsdGFyZ2V0KT0+e2lmKCFsYXN0KXJldHVybiAuNTtjb25zdCBhPShuZXcgRGF0ZSh0YXJnZXQpLW5ldyBEYXRlKGxhc3QpKS84NjRlNTsKICByZXR1cm4gYTwyMT8uNzI6YTw2MD8uNjI6YTwxMjA/LjU1OmE8MjQwPy40ODouNDJ9OwogLyogMemgreOBrue0oOeCuShsb2dpdCnjgajjgr/jgrDjgIJjb21wIOOBp+aIkOWIhuOCkk9OL09GRuOBp+OBjeOCi++8iOaknOiovOeUqO+8iSAqLwogZnVuY3Rpb24gaG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wPXt9KXsKICBjb21wPU9iamVjdC5hc3NpZ24oe30sREVGQVVMVCxjb21wKTtjb25zdCB1c2U9az0+Y29tcFtrXSE9PWZhbHNlJiZjb21wW2tdIT09MDsKICBjb25zdCBiPWNsYW1wKDMvTiwuMSwuNSksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxqPXN0b3JlLmouZ2V0KHIuam9ja2V5KTsKICBjb25zdCBydW5zPWg/aC5ydW5zOltdLG49aD9oLm46MCx0YWdzPVtdO2xldCB6PTAsY29uZj0i5L2OIjsKICBjb25zdCBwSD0oKGg/aC50b3AzOjApKzQqYikvKG4rNCk7eis9bG9naXQocEgpOwogIGlmKG4+PTIpY29uZj1uPj01PyLpq5giOiLkuK0iO2Vsc2UgdGFncy5wdXNoKHt0OiLlsaXmrbTkuI3otrMiLGM6ImcifSk7CiAgaWYobj49Myl7Y29uc3QgdDM9aC50b3AzL24sdz1oLndpbi9uOwogICBpZih0Mz49LjQwJiZ3PD0uMjApdGFncy5wdXNoKHt0OmDlloTmiKblnosgM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgZWxzZSBpZih0Mz49LjQ1KXRhZ3MucHVzaCh7dDpg5a6J5a6aIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGlmKHVzZSgiYXZnIikmJmguc3VtL248PTUpeis9LjEyfQogIGNvbnN0IHJjPXJ1bnMuc2xpY2UoLTMpOwogIGlmKHVzZSgicmVjZW50IikmJnJjLmxlbmd0aD49Mil7Y29uc3QgYzM9cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxhdmc9cmMucmVkdWNlKChzLHgpPT5zK3hbMV0sMCkvcmMubGVuZ3RoOwogICB6Kz0uMjIqKGMzL3JjLmxlbmd0aC1wSCkqMztpZihjMz49Mil0YWdzLnB1c2goe3Q6YOi/kSR7cmMubGVuZ3Rofei1sOOBpyR7YzN95ZueM+edgOWGhWAsYzoiYiJ9KTsKICAgY29uc3QgbGFzdD1ydW5zW3J1bnMubGVuZ3RoLTFdOwogICBpZihsYXN0JiZsYXN0WzFdPj04JiZuPj00JiZoLnRvcDMvbj49LjM1KXt6Kz0uMTU7dGFncy5wdXNoKHt0OmDliY3otbAke2xhc3RbMV19552A44GL44KJ5be744GN6L+U44GX5L2Z5ZywYCxjOiJvIn0pfQogICBpZihhdmc8PTQmJnJjLmxlbmd0aD49Myl6Kz0uMDh9CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwOwogIGlmKHVzZSgiY29uZCIpJiZzYyYmZGlzdCYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJk1hdGguYWJzKHhbMl0tZGlzdCk8PTIwMCk7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKXt6LT0uMzU7dGFncy5wdXNoKHt0OmAke3NjPT09MT8i5Yid44Gu6IqdIjoi5Yid44Gu44OA44O844OIIn3vvIjpgY7ljrvotbDjga/liKXppqzloLTvvIlgLGM6Im8ifSl9CiAgIGlmKGNyLmxlbmd0aD49Mil7Y29uc3QgdDM9Y3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxwYz0odDMrMipwSCkvKGNyLmxlbmd0aCsyKTsKICAgIHorPWNsYW1wKDIqKHBjLXBIKSwtLjUsLjUpO2lmKHQzPj0yKXRhZ3MucHVzaCh7dDpg5ZCM5p2h5Lu244GnJHt0M30vJHtjci5sZW5ndGh95ZueM+edgOWGhWAsYzoiYiJ9KX19CiAgaWYodXNlKCJqb2NrZXkiKSYmaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpLGRqPWNsYW1wKC42Kihsb2dpdChwSiktbG9naXQoYikpLC0uNCwuNSk7CiAgIHorPWRqO2lmKGRqPj0uMjUpdGFncy5wdXNoKHt0OmDpqI7miYvlpb3oqr8gM+edgOWGhSR7TWF0aC5yb3VuZChqLnRvcDMvai5uKjEwMCl9JWAsYzoiYiJ9KX0KICBpZih1c2UoImxheW9mZiIpJiZoJiZoLmxhc3Qpe2NvbnN0IGdhcD1NYXRoLnJvdW5kKChuZXcgRGF0ZShyYWNlLmRhdGUpLW5ldyBEYXRlKGgubGFzdCkpLzg2NGU1KTsKICAgeis9LjYqKGxheW9mZihoLmxhc3QscmFjZS5kYXRlKS0uNSk7aWYoZ2FwPj0xODApdGFncy5wdXNoKHt0OmAke2dhcH3ml6XjgbbjgopgLGM6Im8ifSl9CiAgaWYodXNlKCJhZ2UiKSl7Y29uc3QgYT1yLmFnZXx8NTtpZihhPT09Myl6Kz0uMTA7ZWxzZSBpZihhPT09NCl6Kz0uMDU7ZWxzZSBpZihhPj04KXt6LT0uMTU7dGFncy5wdXNoKHt0OmAke2F95q2zYCxjOiJvIn0pfX0KICByZXR1cm57eix0YWdzLGNvbmYsbn07CiB9CiAvKiAyMDIz5bm05Lul6ZmN44Gu5pmC57O75YiX5qSc6Ki844Gn44GuIOe0oOOBruWlvei1sOeOh+KGkueptOOCvuODvOODs+Wun+e4vu+8iOW5s+Wdh3AsIOWun+e4vu+8iSAqLwogY29uc3QgQ0FMPVtbMCwwXSxbLjAyMywuMDI4XSxbLjA0OCwuMDQ4XSxbLjA3NiwuMDU5XSxbLjEwNSwuMDcyXSxbLjEzNCwuMDgxXSxbLjE2NSwuMDg5XSxbLjE5MywuMTAxXSxbLjIyNCwuMTEwXSxbLjI1OSwuMTM1XSxbLjMwMywuMTY0XSxbLjM1OSwuMTc5XSxbLjQ3LC4yMDBdLFsxLC4yNV1dOwogLyog44Kq44OD44K644Gq44GX44Oi44O844OJ77yI5Lq65rCX44Gu5Luj55CG77yd6aiO5omL6L6844G/44Gu6aCG5L2N44Gn56m044K+44O844Oz44KS5Yik5a6a77yJ44Gu6KOc5q2j6KGo44CCMjAyM+W5tOS7pemZjeOBruaZguezu+WIl+aknOiovOOBp+S9nOaIkCAqLwogY29uc3QgQ0FMX1BST1hZPVtbMCwwXSxbMC4wMjMsMC4wMzldLFswLjA0OCwwLjA1OF0sWzAuMDc2LDAuMDg0XSxbMC4xMDUsMC4xMDddLFswLjEzNCwwLjEyNl0sWzAuMTY0LDAuMTQyXSxbMC4xOTMsMC4xNTddLFswLjIyNCwwLjE3OF0sWzAuMjU5LDAuMjE0XSxbMC4zMDEsMC4yNl0sWzAuMzUyLDAuMjc0XSxbMC40MjcsMC40MDRdXTsKIGZ1bmN0aW9uIGludGVycChULHApe2ZvcihsZXQgaT0xO2k8VC5sZW5ndGg7aSsrKWlmKHA8PVRbaV1bMF0pe2NvbnN0W2EsYl09VFtpLTFdLFtjLGRdPVRbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIFRbVC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBjYWxpYkZvcihwLG1vZGUpe3JldHVybiBtb2RlPT09Im9kZHMiP2ludGVycChDQUwscCk6aW50ZXJwKENBTF9QUk9YWSxwKX0KIGZ1bmN0aW9uIGNhbGliKHApe2ZvcihsZXQgaT0xO2k8Q0FMLmxlbmd0aDtpKyspaWYocDw9Q0FMW2ldWzBdKXtjb25zdFthLGJdPUNBTFtpLTFdLFtjLGRdPUNBTFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gQ0FMW0NBTC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBub3JtYWxpemVUb3AzKHpzLHRvdGFsKXtsZXQgbG89LTgsaGk9ODsKICBmb3IobGV0IGk9MDtpPDYwO2krKyl7Y29uc3QgYz0obG8raGkpLzIscz16cy5yZWR1Y2UoKGEseik9PmErc2lnbW9pZCh6K2MpLDApO2lmKHM+dG90YWwpaGk9YztlbHNlIGxvPWN9CiAgY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHpzLm1hcCh6PT5zaWdtb2lkKHorYykpfQogLyogSGFydmlsbGXms5Xjgafli53njofihpIz552A5YaF546HICovCiBmdW5jdGlvbiB0b3AzRnJvbVdpbihwdyl7Y29uc3QgVD1wdy5yZWR1Y2UoKGEsYik9PmErYiwwKSxwPXB3Lm1hcCh4PT54L1QpLG49cC5sZW5ndGgsb3V0PW5ldyBBcnJheShuKS5maWxsKDApOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2xldCBzPXBbaV07CiAgIGZvcihsZXQgaj0wO2o8bjtqKyspaWYoaiE9PWkpe3MrPXBbal0qcFtpXS8oMS1wW2pdKTsKICAgIGZvcihsZXQgaz0wO2s8bjtrKyspaWYoayE9PWkmJmshPT1qKXMrPXBbal0qcFtrXS8oMS1wW2pdKSpwW2ldLygxLXBbal0tcFtrXSl9CiAgIG91dFtpXT1zfXJldHVybiBvdXR9CiAvKiDjg6zjg7zjgrnop6PmnpDjgIJvZGRzIOOBr+S7u+aEj++8iOWFqOmgreWIhu+8ieOAgiAqLwogZnVuY3Rpb24gYW5hbHl6ZShyYWNlLHN0b3JlLG9kZHMsY29tcCxwb3BBcnIpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGg7CiAgY29uc3Qgc2M9Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wKSkscD1ub3JtYWxpemVUb3AzKHNjLm1hcCh4PT54LnopLE1hdGgubWluKDMsTikpOwogIGxldCBta3Q9bnVsbCxwb3A9bnVsbCxtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpe21rdD10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTtwb3A9b2Rkcy5tYXAobz0+MStvZGRzLmZpbHRlcih4PT54PG8pLmxlbmd0aCk7bW9kZT0ib2RkcyJ9CiAgZWxzZSBpZihwb3BBcnImJnBvcEFyci5sZW5ndGg9PT1OJiZwb3BBcnIuZXZlcnkoeD0+eD4wKSl7cG9wPXBvcEFyci5zbGljZSgpO21vZGU9Im9kZHMifSAvLyDlrp/pmpvjga7kurrmsJfpoIbkvY3jgaDjgZHliIbjgYvjgovjgajjgY3vvIjntZDmnpzjg5rjg7zjgrjnlLHmnaXvvIkKICBlbHNleyAvLyDjgqrjg4PjgrrjgoLkurrmsJfjgoLjgarjgYTjgajjgY3vvJrpqI7miYvmiJDnuL7jgb7jgaflkKvjgoHjgZ/jgrnjgrPjgqLjga7poIbkvY3jgpLjgIzkurrmsJfjga7ku6PnkIbjgI3jgavjgZnjgovvvIjlrp/pmpvjga7kurrmsJfjgajjga7nm7jplqIgMC41NeKGkjAuNjfvvIkKICAgY29uc3QgcHg9Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTix7am9ja2V5OnRydWUsbGF5b2ZmOmZhbHNlfSkueik7cG9wPXB4Lm1hcCh2PT4xK3B4LmZpbHRlcih4PT54PnYpLmxlbmd0aCl9CiAgY29uc3QgcmFuaz1wLm1hcCh2PT4xK3AuZmlsdGVyKHg9Png+dikubGVuZ3RoKTsKICBjb25zdCBjdXQ9TWF0aC5tYXgoNSxNYXRoLmNlaWwoTiouNCkpOwogIHJldHVybiBSLm1hcCgocixpKT0+KHtpLG5vOnIubnVtfHxpKzEsbmFtZTpyLm5hbWV8fHIuaG9yc2UscDpwW2ldLHBjOmNhbGliRm9yKHBbaV0sbW9kZSksbW9kZSwKICAgam46KHN0b3JlLmouZ2V0KHIuam9ja2V5KXx8e246MH0pLm4scmFuazpyYW5rW2ldLHBvcDpwb3BbaV0sCiAgIGhvbGU6Tj49NiYmcG9wW2ldPj1jdXQsbWt0Om1rdD9ta3RbaV06bnVsbCx2YWx1ZTpta3Q/Y2FsaWJGb3IocFtpXSwib2RkcyIpL21rdFtpXTpudWxsLAogICB0YWdzOnNjW2ldLnRhZ3MsY29uZjpzY1tpXS5jb25mLG46c2NbaV0ubixjdXR9KSk7CiB9CgogLyog5omV5oi744Gk44GN5pmC57O75YiX44OQ44OD44Kv44OG44K544OI44CCcmFjZXMg44Gv5pel5LuY5piH6aCGIFt7aWQsZGF0ZSxyb3dzfV3jgIFwYXlCeUlkIOOBryB7cmFjZUlkOntwbGFjZTpbe251bWJlcix5ZW59XX1944CCCiAgICDnqbTjgr7jg7zjg7Pjga/lrp/jgqrjg4PjgrrpoIbkvY3jgaflrprnvqnvvIjjg4Tjg7zjg6vjga7jgqrjg4PjgrrlhaXlipvjg6Ljg7zjg4njgajlkIzjgZjnirbms4HvvInjgILlkITjg6zjg7zjgrkxMDDlhobjgZrjgaTos7zlhaXjgIIgKi8KIGZ1bmN0aW9uIGJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsb3B0cyl7CiAgb3B0cz1vcHRzfHx7fTtjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiIixTUExJVD1vcHRzLnNwbGl0fHwiIjsKICBjb25zdCBuYW1lcz1bInRvcDEiLCJ0b3AyIiwidG9wMyIsImFsbEhvbGUiLCJ2YWx1ZSJdLHBlcj1bImFsbCIsIkEiLCJCIl07CiAgY29uc3QgUz17fTtmb3IoY29uc3QgbiBvZiBuYW1lcyl7U1tuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpU1tuXVtwXT17YmV0czowLGhpdHM6MCxyZXQ6MCxzcTowLHJhY2VzOjB9fQogIGNvbnN0IHN0b3JlPW5ldyBTdG9yZSgpO2xldCB1c2VkPTA7CiAgY29uc3QgYWRkPShuLHAsaGl0LHllbik9Pntjb25zdCB4PVNbbl1bcF07eC5iZXRzKys7aWYoaGl0KXguaGl0cysrO3gucmV0Kz15ZW47eC5zcSs9eWVuKnllbn07CiAgZm9yKGNvbnN0IHJjIG9mIHJhY2VzKXsKICAgY29uc3QgcGF5PXBheUJ5SWRbcmMuaWRdOwogICBpZihwYXkmJnBheS5wbGFjZSYmcGF5LnBsYWNlLmxlbmd0aCYmcmMuZGF0ZT49U1RBUlQpewogICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCk7CiAgICBjb25zdCBoYXNPZGRzPVIubGVuZ3RoPj02JiZSLmV2ZXJ5KHI9PnIub2Rkcz4xKSxoYXNQb3A9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5wb3A+MCk7CiAgICBpZihoYXNPZGRzfHxoYXNQb3ApewogICAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxydW5uZXJzOlJ9OwogICAgIGNvbnN0IHJlcz1oYXNPZGRzP2FuYWx5emUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTphbmFseXplKHJhY2Usc3RvcmUsbnVsbCxudWxsLFIubWFwKHI9PnIucG9wKSkseWVuPW5ldyBNYXAocGF5LnBsYWNlLm1hcCh4PT5beC5udW1iZXIseC55ZW5dKSk7CiAgICAgY29uc3QgaG9sZT1yZXMuZmlsdGVyKHg9PnguaG9sZSkuc29ydCgoYSxiKT0+Yi5wLWEucCk7CiAgICAgaWYoaG9sZS5sZW5ndGgpewogICAgICB1c2VkKys7Y29uc3QgcHI9U1BMSVQ/KHJjLmRhdGU8U1BMSVQ/IkEiOiJCIik6IkEiOwogICAgICBjb25zdCBwaWNrPShuLGxpc3QpPT57Zm9yKGNvbnN0IHggb2YgbGlzdCl7Y29uc3QgeT15ZW4uZ2V0KFJbeC5pXS5udW0pfHwwO2FkZChuLCJhbGwiLHk+MCx5KTthZGQobixwcix5PjAseSl9fTsKICAgICAgcGljaygidG9wMSIsaG9sZS5zbGljZSgwLDEpKTtwaWNrKCJ0b3AyIixob2xlLnNsaWNlKDAsMikpO3BpY2soInRvcDMiLGhvbGUuc2xpY2UoMCwzKSk7cGljaygiYWxsSG9sZSIsaG9sZSk7CiAgICAgIHBpY2soInZhbHVlIixob2xlLmZpbHRlcih4PT54LnZhbHVlPj0xLjMpKTsKICAgICB9CiAgICB9CiAgIH0KICAgZm9yKGNvbnN0IHIgb2YgcmMucm93cylzdG9yZS5hZGQocik7CiAgfQogIGNvbnN0IGZpbj17fTsKICBmb3IoY29uc3QgbiBvZiBuYW1lcyl7ZmluW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcil7Y29uc3QgeD1TW25dW3BdOwogICBpZigheC5iZXRzKXtmaW5bbl1bcF09e2JldHM6MH07Y29udGludWV9CiAgIGNvbnN0IG1lYW49eC5yZXQveC5iZXRzLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHguc3EveC5iZXRzLW1lYW4qbWVhbikpOwogICBmaW5bbl1bcF09e2JldHM6eC5iZXRzLGhpdFJhdGU6eC5oaXRzL3guYmV0cyxyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHguYmV0cykvMTAwfX19CiAgcmV0dXJue3JhY2VzOnVzZWQsc3RhdHM6ZmlufTsKIH0KIHJldHVybntiYWNrdGVzdCxjYWxpYixjYWxpYkZvcixqbm4sbm4sdG9Sb3csY3N2Um93cyxTdG9yZSxhbmFseXplLGhvcnNlU2NvcmUsbm9ybWFsaXplVG9wMyx0b3AzRnJvbVdpbixzdXJmQ29kZSxwYXJzZURhdGV9Owp9KSgpOwoKCi8qID09PT09IOOCouODl+ODquacrOS9kyA9PT09PSAqLwpjb25zdCAkPWlkPT5kb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7CmNvbnN0IGVzYz1zPT5TdHJpbmcocz8/IiIpLnJlcGxhY2UoL1smPD4iJ10vZyxtPT4oeyImIjoiJmFtcDsiLCI8IjoiJmx0OyIsIj4iOiImZ3Q7IiwnIic6IiZxdW90OyIsIiciOiImIzM5OyJ9W21dKSk7CmNvbnN0IHNsZWVwPShtcz0wKT0+bmV3IFByb21pc2Uocj0+c2V0VGltZW91dChyLG1zKSk7CmZ1bmN0aW9uIGJ1c3kob24sbXNnPSLlh6bnkIbkuK3igKYiKXskKCJidXN5Iikuc3R5bGUuZGlzcGxheT1vbj8iZmxleCI6Im5vbmUiOyQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9bXNnfQpsZXQgREI9bnVsbCxTVE9SRT1udWxsLFNUT1JFX0tFWT0iIixDVVI9bnVsbCxMQVNUUkVTPW51bGw7CmNvbnN0IFZFTlVFPXsiMDEiOiLmnK3luYwiLCIwMiI6IuWHvemkqCIsIjAzIjoi56aP5bO2IiwiMDQiOiLmlrDmvZ8iLCIwNSI6IuadseS6rCIsIjA2Ijoi5Lit5bGxIiwiMDciOiLkuK3kuqwiLCIwOCI6IuS6rOmDvSIsIjA5Ijoi6Ziq56WeIiwiMTAiOiLlsI/lgIkifTsKCi8qIC0tLSBJbmRleGVkRELvvIjjgZPjga7jg4Tjg7zjg6vlsILnlKjvvIkgLS0tICovCmZ1bmN0aW9uIG9wZW5EQigpe3JldHVybiBuZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgcj1pbmRleGVkREIub3BlbigidXBzZXRfdG9vbF9kYiIsMik7CiByLm9udXBncmFkZW5lZWRlZD1lPT57Y29uc3QgZD1lLnRhcmdldC5yZXN1bHQ7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygiZmlsZXMiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJmaWxlcyIpO2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoIm1ldGEiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJtZXRhIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygicGF5IikpZC5jcmVhdGVPYmplY3RTdG9yZSgicGF5Iil9Owogci5vbnN1Y2Nlc3M9KCk9PntEQj1yLnJlc3VsdDtvaygpfTtyLm9uZXJyb3I9KCk9Pm5nKHIuZXJyb3IpO3Iub25ibG9ja2VkPSgpPT5uZyhuZXcgRXJyb3IoIuS7luOBruOCv+ODluOBp+S9v+eUqOS4reOBp+OBmSIpKX0pfQpjb25zdCBpZGJBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJmaWxlcyIpLm9iamVjdFN0b3JlKCJmaWxlcyIpLmdldEFsbCgpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgaWRiUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJmaWxlcyIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYkNsZWFyPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKSxzdD10Lm9iamVjdFN0b3JlKCJmaWxlcyIpO3N0Lm9wZW5DdXJzb3IoKS5vbnN1Y2Nlc3M9ZT0+e2NvbnN0IGM9ZS50YXJnZXQucmVzdWx0O2lmKGMpe2lmKCFTdHJpbmcoYy5rZXkpLnN0YXJ0c1dpdGgoImxpdmU6IikpYy5kZWxldGUoKTtjLmNvbnRpbnVlKCl9fTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwoKLyog5Y+W44KK6L6844G/5riI44G/44Gu5YWo6KGM77yI44OQ44OD44Kv44Ki44OD44OXQ1NW77yL5Y+W5b6X5riI44G/44Gu5oiQ57i+77yJ44KS6aCG44Gr5rih44GZICovCmFzeW5jIGZ1bmN0aW9uIGZvckVhY2hSb3coY2IpewogY29uc3QgZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IobGV0IGk9MDtpPGZzLmxlbmd0aDtpKyspe2NvbnN0IGY9ZnNbaV07CiAgaWYoZi5saXZlKXtmb3IoY29uc3QgeCBvZiBmLnJvd3N8fFtdKWNiKGxpdmVSb3coeCkpfQogIGVsc2UgZm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpY2IoVUUudG9Sb3cobykpOwogIGlmKGklMz09PTIpYXdhaXQgc2xlZXAoMCl9Cn0KLyog44Os44O844K5SUTjgYvjgonplovlgqzloLTjg7tS55Wq5Y+377yIMTLmoYHjga5KUkHlvaLlvI/vvI/ml6Xku5gt6ZaL5YKs5aC0LVLlvaLlvI/jga7kuKHlr77lv5zvvIkgKi8KZnVuY3Rpb24gdmVudWVPZklkKGlkKXtyZXR1cm4gL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSg0LDYpOlN0cmluZyhpZCkuc3BsaXQoIi0iKVszXXx8IiJ9CmZ1bmN0aW9uIHJhY2VOb09mSWQoaWQpe3JldHVybiBOdW1iZXIoL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSgxMCwxMik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzRdfHwwKX0KCi8qIC0tLSDlj5bjgorovrzjgb8gLS0tICovCmFzeW5jIGZ1bmN0aW9uIGltcG9ydEZpbGUoZmlsZSl7CiBidXN5KHRydWUsIuODleOCoeOCpOODq+OCkuiqreOBv+i+vOOBv+S4reKAplxu5aSn44GN44GE44OV44Kh44Kk44Or44Gv5pWw5Y2B56eS44GL44GL44KK44G+44GZ44CCIik7YXdhaXQgc2xlZXAoMzApOwogdHJ5ewogIGNvbnN0IHRleHQ9YXdhaXQgZmlsZS50ZXh0KCk7bGV0IGl0ZW1zOwogIGlmKC9cLmNzdiQvaS50ZXN0KGZpbGUubmFtZSkpe2l0ZW1zPVt7dHlwZToicmFjZS1yZXN1bHRzIix5ZWFyOjAscGxhY2U6ZmlsZS5uYW1lLGNzdjp0ZXh0fV19CiAgZWxzZXtjb25zdCBqPUpTT04ucGFyc2UodGV4dCk7aXRlbXM9QXJyYXkuaXNBcnJheShqKT9qOihqLmZpbGVzfHxbal0pfQogIGl0ZW1zPWl0ZW1zLmZpbHRlcih4PT54JiZ0eXBlb2YgeC5jc3Y9PT0ic3RyaW5nIik7CiAgaWYoIWl0ZW1zLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoImNzduOCkuWQq+OCgOODh+ODvOOCv+OBjOimi+OBpOOBi+OCiuOBvuOBm+OCk+OAguODkOODg+OCr+OCouODg+ODl0pTT07jgYvjgIFDU1bjgpLpgbjjgpPjgafjgY/jgaDjgZXjgYTjgIIiKTsKICBhd2FpdCBpZGJDbGVhcigpO2xldCBuPTA7CiAgZm9yKGxldCBpPTA7aTxpdGVtcy5sZW5ndGg7aSsrKXtjb25zdCBpdD1pdGVtc1tpXTthd2FpdCBpZGJQdXQoYCR7aXQueWVhcn06JHtpdC5wbGFjZX06JHtpfWAse3llYXI6aXQueWVhcixwbGFjZTppdC5wbGFjZSxwbGFjZU5hbWU6aXQucGxhY2VOYW1lLGNzdjppdC5jc3Z9KTsKICAgbis9TWF0aC5tYXgoMCxpdC5jc3Yuc3BsaXQoIlxuIikubGVuZ3RoLTEpOyQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9YOS/neWtmOS4reKApiAke2krMX0vJHtpdGVtcy5sZW5ndGh9YDthd2FpdCBzbGVlcCgwKX0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iZ29vZCI+5Y+W44KK6L6844G/5a6M5LqG77yaJHtpdGVtcy5sZW5ndGh944OV44Kh44Kk44Or77yP57SEJHtuLnRvTG9jYWxlU3RyaW5nKCl96KGMPC9zcGFuPmA7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuWPluOCiui+vOOBv+OCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5e2J1c3koZmFsc2UpfQp9CmFzeW5jIGZ1bmN0aW9uIHNob3dTdGF0ZSgpewogdHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpLHBzPWF3YWl0IHBheUFsbCgpOwogIGNvbnN0IGJhc2U9ZnMuZmlsdGVyKGY9PiFmLmxpdmUpLGxpdmU9ZnMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCk7CiAgaWYoIWZzLmxlbmd0aCYmIXBzLmxlbmd0aCl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuODh+ODvOOCv+acquWPluW+l+OBp+OBmeOAguS4iuOBruOAjOmBjuWOu+aIkOe4vuOBqOaJleaIu+OCkuWPluW+l+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBsZD1saXZlLm1hcChmPT5mLmRhdGUpLnNvcnQoKSxuUmFjZXM9bGl2ZS5yZWR1Y2UoKHMsZik9PnMrbmV3IFNldChmLnJvd3MubWFwKHI9PnIucmFjZUlkKSkuc2l6ZSwwKTsKICBsZXQgaD0iIjsKICBpZihsaXZlLmxlbmd0aCloKz1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluW+l+a4iOOBv+OBruaIkOe4vu+8miR7bGl2ZS5sZW5ndGh95pel77yPJHtuUmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIgke2xkWzBdfeOAnCR7bGRbbGQubGVuZ3RoLTFdfe+8iTwvc3Bhbj5gOwogIGlmKGJhc2UubGVuZ3RoKXtjb25zdCB5cz1bLi4ubmV3IFNldChiYXNlLm1hcChmPT5mLnllYXIpKV0uc29ydCgpO2grPShoPyJcbiI6IiIpK2A8c3BhbiBjbGFzcz0iZ29vZCI+44OQ44OD44Kv44Ki44OD44OX77yaJHtiYXNlLmxlbmd0aH3jg5XjgqHjgqTjg6vvvIgke3lzWzBdfHwiLSJ944CcJHt5c1t5cy5sZW5ndGgtMV18fCItIn3lubTvvIk8L3NwYW4+YH0KICBjb25zdCBwcj1wcy5yZWR1Y2UoKHMscCk9PnMrKHAucmFjZXN8fFtdKS5sZW5ndGgsMCk7CiAgaCs9KGg/IlxuIjoiIikrKHBzLmxlbmd0aD9gPHNwYW4gY2xhc3M9Imdvb2QiPuaJleaIu++8miR7cHMubGVuZ3RofeaXpe+8jyR7cHIudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L3NwYW4+YDonPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu++8muacquWPluW+lzwvc3Bhbj4nKTsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPueiuuiqjeOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZSl9PC9zcGFuPmB9Cn0KLyogV29ya2Vy44GuIC9yZXN1bHRzIOOBruihjCDihpIg44OE44O844Or5YaF6YOo44Gu6KGMICovCmZ1bmN0aW9uIGxpdmVSb3coeCl7Y29uc3QgZj1wYXJzZUZsb2F0KFN0cmluZyh4LmZpbmlzaD8/IiIpLnJlcGxhY2UoL1teXGQuXS9nLCIiKSk7CiByZXR1cm57cmFjZUlkOlN0cmluZyh4LnJhY2VJZHx8IiIpLGRhdGU6VUUucGFyc2VEYXRlKHguZGF0ZSksbmFtZTpTdHJpbmcoeC5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpVRS5ubih4LmhvcnNlKSxqb2NrZXk6VUUuam5uKHguam9ja2V5KSwKICBmaW5pc2g6TnVtYmVyLmlzRmluaXRlKGYpJiZmPjA/ZjpudWxsLGRpc3Q6TnVtYmVyKHguZGlzdGFuY2UpfHwwLHN1cmY6VUUuc3VyZkNvZGUoeC5zdXJmYWNlKSxhZ2U6TnVtYmVyKHguYWdlKXx8bnVsbCxudW06TnVtYmVyKHgubnVtYmVyKXx8bnVsbCxwb3A6TnVtYmVyKHgucG9wKT4wP051bWJlcih4LnBvcCk6bnVsbCxvZGRzOm51bGx9fQovKiDlr77osaHml6XjgojjgorliY3jga7lsaXmrbTjgaDjgZHjgafjgrnjg4jjgqLjgpLkvZzjgosgKi8KYXN5bmMgZnVuY3Rpb24gYnVpbGRTdG9yZSh0YXJnZXQpewogaWYoU1RPUkUmJlNUT1JFX0tFWT09PXRhcmdldClyZXR1cm4gU1RPUkU7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTtpZighZnMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi6YGO5Y6744OH44O844K/44GM5pyq55m76Yyy44Gn44GZ44CCIik7CiBjb25zdCBzdD1uZXcgVUUuU3RvcmUoKTtsZXQgcm93cz0wLHVzZWQ9MDsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7CiAgYnVzeSh0cnVlLGDpgY7ljrvjg4fjg7zjgr/jgpLpm4boqIjkuK3igKYgJHtpKzF9LyR7ZnMubGVuZ3RofVxu77yIJHt0YXJnZXR944KI44KK5YmN44Gu44G/5L2/55So77yJYCk7CiAgaWYoZnNbaV0ubGl2ZSl7Zm9yKGNvbnN0IHggb2YgZnNbaV0ucm93c3x8W10pe2NvbnN0IHI9bGl2ZVJvdyh4KTtyb3dzKys7aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXR8fCFyLmhvcnNlKWNvbnRpbnVlO3N0LmFkZChyKTt1c2VkKys7aWYoci5kYXRlPihzdC5sYXN0RGF0ZXx8IiIpKXN0Lmxhc3REYXRlPXIuZGF0ZX19CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGZzW2ldLmNzdikpe2NvbnN0IHI9VUUudG9Sb3cobyk7cm93cysrO2lmKCFyLmRhdGV8fHIuZGF0ZT49dGFyZ2V0KWNvbnRpbnVlO3N0LmFkZChyKTt1c2VkKys7aWYoci5kYXRlPihzdC5sYXN0RGF0ZXx8IiIpKXN0Lmxhc3REYXRlPXIuZGF0ZX0KICBhd2FpdCBzbGVlcCgwKTsKIH0KIGJ1c3koZmFsc2UpO1NUT1JFPXN0O1NUT1JFX0tFWT10YXJnZXQ7U1RPUkUuY291bnQ9dXNlZDtyZXR1cm4gc3Q7Cn0KCi8qIC0tLSDjg6zjg7zjgrnpgbjmip4gLS0tICovCmZ1bmN0aW9uIHNob3dQYW5lKGspe2Zvcihjb25zdCBwIG9mWyJXb3JrZXIiLCJNYW51YWwiLCJQYXN0Il0pJCgicGFuZSIrcCkuc3R5bGUuZGlzcGxheT1wPT09az8iYmxvY2siOiJub25lIn0KJCgidGFiV29ya2VyIikub25jbGljaz0oKT0+c2hvd1BhbmUoIldvcmtlciIpOyQoInRhYk1hbnVhbCIpLm9uY2xpY2s9KCk9PnNob3dQYW5lKCJNYW51YWwiKTskKCJ0YWJQYXN0Iikub25jbGljaz0oKT0+c2hvd1BhbmUoIlBhc3QiKTsKZnVuY3Rpb24gc2V0UmFjZShyYWNlLGxhYmVsKXtpZihyYWNlLmtleSYmIXJhY2Uub2RkczApcmFjZS5vZGRzMD1vZGRzRm9yKHJhY2UpO0NVUj1yYWNlO0xBU1RSRVM9bnVsbDskKCJyYWNlbGFiZWwiKS50ZXh0Q29udGVudD1sYWJlbDskKCJydW4iKS5kaXNhYmxlZD1mYWxzZTskKCJvdXQiKS50ZXh0Q29udGVudD0i44CM6Kej5p6Q44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIn0KCi8qIFdvcmtlciAqLwpsZXQgV1JBQ0VTPVtdOwpsZXQgV0RJQUc9W107CmFzeW5jIGZ1bmN0aW9uIGZldGNoQ2FyZHMoYmFzZSxkLHZlbnVlQ29kZSl7CiBjb25zdCBxPXZlbnVlQ29kZT9gJnZlbnVlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHZlbnVlQ29kZSl9YDoiIjtsZXQgZXJyPSIiOwogZm9yKGxldCB0PTA7dDwzO3QrKyl7CiAgdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSR7cX1gKTsKICAgaWYoIXIub2spe2xldCBtPSIiO3RyeXttPShhd2FpdCByLmpzb24oKSkuZXJyb3J8fCIifWNhdGNoe310aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyLnN0YXR1c30gJHttfWAudHJpbSgpKX0KICAgY29uc3QgeD1hd2FpdCByLmpzb24oKTtyZXR1cm57cmFjZXM6QXJyYXkuaXNBcnJheSh4KT94Oih4LnJhY2VzfHxbXSksd2FybmluZzp4Lndhcm5pbmd8fCIifX0KICBjYXRjaChlKXtlcnI9ZS5tZXNzYWdlO2F3YWl0IHNsZWVwKDEyMDAqKHQrMSkpfQogfQogdGhyb3cgbmV3IEVycm9yKGVycnx8IuWPluW+l+OBp+OBjeOBvuOBm+OCkyIpOwp9CmZ1bmN0aW9uIHJlbmRlclZlbnVlQnV0dG9ucyhkKXsKIGNvbnN0IG5hbWVzPVsuLi5uZXcgU2V0KFdSQUNFUy5tYXAocj0+ci52ZW51ZU5hbWV8fHIudmVudWV8fCIiKSldOwogbGV0IGg9bmFtZXMubWFwKCh2LGkpPT5gPGJ1dHRvbiBkYXRhLXY9IiR7aX0iIGNsYXNzPSJzdWIiPiR7ZXNjKHYpfe+8iCR7V1JBQ0VTLmZpbHRlcihyPT4oci52ZW51ZU5hbWV8fHIudmVudWV8fCIiKT09PXYpLmxlbmd0aH1S77yJPC9idXR0b24+YCkuam9pbigiIik7CiBoKz1XRElBRy5maWx0ZXIoeD0+eC5lcnJ8fHguZW1wdHl8fHgucGFydGlhbCkubWFwKHg9PmA8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj4ke2VzYyh4Lm5hbWUpfe+8miR7eC5lcnI/IuWPluW+l+WkseaVl++8iCIrZXNjKHguZXJyKS5zbGljZSgwLDQwMCkrIu+8iSI6eC5wYXJ0aWFsP2Ake3guY291bnR9UuOBl+OBi+WPluW+l+OBp+OBjeOBpuOBhOOBvuOBm+OCk++8iOmAmuW4uOOBrzEw44CcMTJS77yJYDpg5Ye66LWw6aas44KS6Kqt44KB44Gq44GL44Gj44Gf44Os44O844K5ICR7eC5lbXB0eX1S77yI6Zmk5aSW77yJYH0gPGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLXJldHJ5PSIke2VzYyh4LmNvZGV8fCIiKX0iPuWGjeWPluW+lzwvYnV0dG9uPjwvZGl2PmApLmpvaW4oIiIpOwogJCgid2xpc3QiKS5pbm5lckhUTUw9aDsKICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtdl0iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+bGlzdFZlbnVlKG5hbWVzW2IuZGF0YXNldC52XSxkKSk7CiAkKCJ3bGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLXJldHJ5XSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5sb2FkVmVudWUoZCx7dmVudWVDb2RlOmIuZGF0YXNldC5yZXRyeSx2ZW51ZU5hbWU6IiJ9LHRydWUpKTsKfQphc3luYyBmdW5jdGlvbiBsb2FkVmVudWUoZCx2LHJlcmVuZGVyKXsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogY29uc3QgcHJldj1XRElBRy5maW5kKHg9PlN0cmluZyh4LmNvZGUpPT09U3RyaW5nKHYudmVudWVDb2RlKSk7CiBXUkFDRVM9V1JBQ0VTLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGUpIT09U3RyaW5nKHYudmVudWVDb2RlKSk7CiBXRElBRz1XRElBRy5maWx0ZXIoeD0+U3RyaW5nKHguY29kZSkhPT1TdHJpbmcodi52ZW51ZUNvZGUpKTsKIGNvbnN0IG5hbWU9di52ZW51ZU5hbWV8fChwcmV2JiZwcmV2Lm5hbWUpfHx2LnZlbnVlQ29kZTsKIHRyeXtjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLHYudmVudWVDb2RlKTsKICBjb25zdCBvaz1yYWNlcy5maWx0ZXIoYT0+KGEuaG9yc2VzfHxhLnJ1bm5lcnN8fFtdKS5sZW5ndGgpLGVtcHR5PXJhY2VzLmxlbmd0aC1vay5sZW5ndGg7CiAgV1JBQ0VTLnB1c2goLi4ub2spOwogIGNvbnN0IGVycnM9cmFjZXMuZmlsdGVyKGE9PmEuZXJyb3IpLm1hcChhPT5hLmVycm9yKTsKICBXRElBRy5wdXNoKHtjb2RlOnYudmVudWVDb2RlLG5hbWUsY291bnQ6b2subGVuZ3RoLGVtcHR5LHBhcnRpYWw6b2subGVuZ3RoPjAmJm9rLmxlbmd0aDwxMCxlcnI6IXJhY2VzLmxlbmd0aD8i44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIjooIW9rLmxlbmd0aCYmZXJycy5sZW5ndGg/ZXJyc1swXToiIil9KTsKIH1jYXRjaChlKXtXRElBRy5wdXNoKHtjb2RlOnYudmVudWVDb2RlLG5hbWUsY291bnQ6MCxlbXB0eTowLGVycjplLm1lc3NhZ2V9KX0KIGlmKHJlcmVuZGVyKXskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfvvIgke1dESUFHLm1hcCh4PT5gJHt4Lm5hbWV9JHt4LmNvdW50fVJgKS5qb2luKCLvvI8iKX3vvIlgOyQoIndhbGwiKS5kaXNhYmxlZD0hV1JBQ0VTLmxlbmd0aDskKCJvZGRzR2V0IikuZGlzYWJsZWQ9IVdSQUNFUy5sZW5ndGg7cmVuZGVyVmVudWVCdXR0b25zKGQpfQp9CiQoIndnZXQiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgid2RhdGUiKS52YWx1ZTtpZighZClyZXR1cm4gYWxlcnQoIuaXpeS7mOOCkumBuOaKnuOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IumWi+WCrOWgtOOCkueiuuiqjeS4reKApiI7JCgid2xpc3QiKS5pbm5lckhUTUw9IiI7JCgiYWxsb3V0IikuaW5uZXJIVE1MPSIiO1dSQUNFUz1bXTtXRElBRz1bXTtXREFURT1kOyQoIndhbGwiKS5kaXNhYmxlZD10cnVlOyQoIm9kZHNHZXQiKS5kaXNhYmxlZD10cnVlO09ERFM9e307CiBsZXQgdmVudWVzPW51bGw7CiBsZXQgbGlzdERpYWc9IiIsYXZhaWxEYXRlcz1bXTsKIHRyeXtjb25zdCByPWF3YWl0IGZldGNoKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2VuY29kZVVSSUNvbXBvbmVudChkKX0mbGlzdD0xYCk7aWYoci5vayl7Y29uc3QgeD1hd2FpdCByLmpzb24oKTt2ZW51ZXM9eC52ZW51ZXN8fFtdO2F2YWlsRGF0ZXM9eC5hdmFpbGFibGVEYXRlc3x8W107aWYoIXZlbnVlcy5sZW5ndGgpbGlzdERpYWc9SlNPTi5zdHJpbmdpZnkoeC5kaWFnbm9zdGljc3x8W10pLnNsaWNlKDAsNTAwKX19Y2F0Y2goZSl7fQogdHJ5ewogIGlmKHZlbnVlcyYmIXZlbnVlcy5sZW5ndGgmJmF2YWlsRGF0ZXMubGVuZ3RoJiYhYXZhaWxEYXRlcy5pbmNsdWRlcyhkKSl7CiAgICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtkfSDjga9KUkHjga7plovlgqzml6Xjgafjga/jgYLjgorjgb7jgZvjgpPjgIJcbuWFrOmWi+S4reOBrumWi+WCrOaXpe+8miR7YXZhaWxEYXRlcy5qb2luKCLjgIEiKX1gOwogICAkKCJ3bGlzdCIpLmlubmVySFRNTD1hdmFpbERhdGVzLm1hcCh4PT5gPGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLWQ9IiR7eH0iPiR7eH08L2J1dHRvbj5gKS5qb2luKCIiKTsKICAgJCgid2xpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1kXSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT57JCgid2RhdGUiKS52YWx1ZT1iLmRhdGFzZXQuZDskKCJ3Z2V0IikuY2xpY2soKX0pOwogICByZXR1cm47CiAgfQogIGlmKHZlbnVlcyYmdmVudWVzLmxlbmd0aCl7CiAgIGZvcihjb25zdCB2IG9mIHZlbnVlcyl7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PWDlj5blvpfkuK3igKYgJHt2LnZlbnVlTmFtZX3vvIgke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6X5riI44G/77yJYDthd2FpdCBsb2FkVmVudWUoZCx2LGZhbHNlKX0KICB9ZWxzZXsKICAgLy8g5penV29ya2Vy562J44Gn6ZaL5YKs5aC05LiA6Kan44GM5L2/44GI44Gq44GE5aC05ZCI77yaMeaXpeWIhuOCkuS4gOaLrOWPluW+lwogICAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IuS4gOaLrOWPluW+l+S4reKApiI7CiAgIGNvbnN0IHtyYWNlc309YXdhaXQgZmV0Y2hDYXJkcyhiYXNlLGQsIiIpOwogICBjb25zdCBvaz1yYWNlcy5maWx0ZXIoYT0+KGEuaG9yc2VzfHxhLnJ1bm5lcnN8fFtdKS5sZW5ndGgpO1dSQUNFUz1vazsKICAgaWYocmFjZXMubGVuZ3RoPm9rLmxlbmd0aClXRElBRy5wdXNoKHtjb2RlOiIiLG5hbWU6IuS4gOmDqCIsY291bnQ6b2subGVuZ3RoLGVtcHR5OnJhY2VzLmxlbmd0aC1vay5sZW5ndGgsZXJyOiIifSk7CiAgfQogIGlmKCFXUkFDRVMubGVuZ3RoKXskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IuWHuui1sOmmrOOBpOOBjeOBruODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCk+OBp+OBl+OBn+OAglxuIitXRElBRy5tYXAoeD0+YCR7eC5uYW1lfe+8miR7eC5lcnJ8fCLlh7rotbDppqzjgarjgZcifWApLmpvaW4oIlxuIikrKGxpc3REaWFnPyJcbuiouuaWre+8miIrbGlzdERpYWc6IiIpO3JlbmRlclZlbnVlQnV0dG9ucyhkKTtyZXR1cm59CiAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6XYCsoV0RJQUcubGVuZ3RoP2DvvIgke1dESUFHLm1hcCh4PT5gJHt4Lm5hbWV9JHt4LmNvdW50fVJgKS5qb2luKCLvvI8iKX3vvIlgOiIiKTsKICAkKCJ3YWxsIikuZGlzYWJsZWQ9ZmFsc2U7JCgib2Rkc0dldCIpLmRpc2FibGVkPWZhbHNlO3JlbmRlclZlbnVlQnV0dG9ucyhkKTsKIH1jYXRjaChlKXskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IuWPluW+l+OCqOODqeODvO+8miIrZS5tZXNzYWdlKyJcbu+8iFdvcmtlcuOBjOacquWFrOmWi++8j0NPUlPvvI/ml6Xku5jjgavplovlgqzjgarjgZfjgIHjga7lj6/og73mgKfvvIkifQp9OwpmdW5jdGlvbiBsaXN0VmVudWUodixkKXsKIGNvbnN0IHJzPVdSQUNFUy5maWx0ZXIocj0+KHIudmVudWVOYW1lfHxyLnZlbnVlfHwiIik9PT12KS5zb3J0KChhLGIpPT4oYS5yYWNlTnVtYmVyfHwwKS0oYi5yYWNlTnVtYmVyfHwwKSk7CiAkKCJ3bGlzdCIpLmlubmVySFRNTD1ycy5tYXAoKHIsayk9PmA8YnV0dG9uIGRhdGEtaz0iJHtrfSI+JHtyLnJhY2VOdW1iZXJ8fGsrMX1SICR7ZXNjKHIucmFjZU5hbWV8fCIiKX08L2J1dHRvbj5gKS5qb2luKCIiKTsKICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9Pntjb25zdCByPXJzW2IuZGF0YXNldC5rXTsKICBjb25zdCBocz0oci5ob3JzZXN8fHIucnVubmVycyk7CiAgY29uc3QgcmFjZT1ta1JhY2UocixkKTsKICBzZXRSYWNlKHJhY2UsYCR7ZH0gJHt2fSR7ci5yYWNlTnVtYmVyfHwiIn1SICR7ci5yYWNlTmFtZXx8IiJ977yIJHtyLnN1cmZhY2V8fCI/In0ke3IuZGlzdGFuY2V8fCI/In1t44O7JHtocy5sZW5ndGh96aCt77yJYCk7CiB9KTsKfQoKZnVuY3Rpb24gbWtSYWNlKHIsZCl7CiBjb25zdCBocz0oci5ob3JzZXN8fHIucnVubmVycyk7CiByZXR1cm57ZGF0ZTpkLGtleTpgJHtTdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIil9LSR7TnVtYmVyKHIucmFjZU51bWJlcil8fDB9YCxzdXJmOlVFLnN1cmZDb2RlKHIuc3VyZmFjZSksZGlzdDpOdW1iZXIoci5kaXN0YW5jZSl8fDAsCiAgcnVubmVyczpocy5tYXAoKGgsaSk9Pntjb25zdCBuYW1lPWguaG9yc2VOYW1lfHxoLmhvcnNlfHxoLm5hbWV8fCIiO3JldHVybntuYW1lLGhvcnNlOlVFLm5uKG5hbWUpLGpvY2tleTpVRS5qbm4oaC5qb2NrZXl8fCIiKSxhZ2U6aC5hZ2V8fG51bGwsbnVtOmguaG9yc2VOdW1iZXJ8fGgubnVtYmVyfHxpKzF9fSl9Owp9CmxldCBXREFURT0iIjsKLyog5YWo44Os44O844K55LiA5ous77ya5ZCE44Os44O844K544Gu56m06aas5YCZ6KOc77yI5LiK5L2NMumgre+8ieOCkuS4gOimp+OBq+OBmeOCiyAqLwphc3luYyBmdW5jdGlvbiBydW5BbGwoKXsKIGlmKCFXUkFDRVMubGVuZ3RoKXJldHVybjsKIGNvbnN0IGQ9V0RBVEU7bGV0IHRleHQ9YCR7ZH0g56m06aas5aW96LWw77yI5LiK5L2N5YCZ6KOc77yJXG5gOwogdHJ5ewogIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoZCk7CiAgY29uc3QgcnM9Wy4uLldSQUNFU10uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVOYW1lfHxhLnZlbnVlfHwiIikubG9jYWxlQ29tcGFyZShTdHJpbmcoYi52ZW51ZU5hbWV8fGIudmVudWV8fCIiKSwiamEiKXx8KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogIGNvbnN0IGdhcD1zdG9yZS5sYXN0RGF0ZT9NYXRoLnJvdW5kKChuZXcgRGF0ZShkKS1uZXcgRGF0ZShzdG9yZS5sYXN0RGF0ZSkpLzg2NGU1KTpudWxsOwogIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K65Y+N5pig77yaJHtPYmplY3Qua2V5cyhPRERTKS5sZW5ndGh944Os44O844K55YiG77yI5pyq5Y+W5b6X44Gu44Os44O844K544Gv44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJPC9kaXY+PGRpdiBjbGFzcz0ic21hbGwiPuWtpue/kuODh+ODvOOCv+acgOe1guaXpe+8miR7ZXNjKHN0b3JlLmxhc3REYXRlfHwi5LiN5piOIil977yP56m044K+44O844Oz44Gv44OE44O844Or5o6o5a6a44Gu5Lq65rCX77yI6aiO5omL5oiQ57i+6L6844G/77yJ44Gn5Yik5a6a44CC5a6f6Zqb44Gu5Lq65rCX44Go44Gv55Ww44Gq44KK44G+44GZPC9kaXY+YCx0SD0wLHROPTA7CiAgaWYoZ2FwIT1udWxsJiZnYXA+MTQpaCs9YDxkaXYgY2xhc3M9Indhcm4iPuKaoCDmnIDmlrDjga7miJDnuL7jgYwke2dhcH3ml6XliIblhaXjgaPjgabjgYTjgb7jgZvjgpPjgILnm7Tov5Hjga7lpb3otbDjg7vlh6HotbDjgYzlj43mmKDjgZXjgozjgarjgYTngrnjgavms6jmhI/jgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogIGgrPSI8YnI+IjsKICBycy5mb3JFYWNoKChyLGspPT57CiAgIGNvbnN0IHJhY2U9bWtSYWNlKHIsZCksbj1yYWNlLnJ1bm5lcnMubGVuZ3RoLHY9ci52ZW51ZU5hbWV8fHIudmVudWV8fCIiOwogICBjb25zdCBsYWJlbD1gJHt2fSR7ci5yYWNlTnVtYmVyfHxrKzF9UiAke3IucmFjZU5hbWV8fCIife+8iCR7ci5zdXJmYWNlfHwiPyJ9JHtyLmRpc3RhbmNlfHwiPyJ9beODuyR7bn3poK3vvIlgOwogICB0ZXh0Kz1gXG7ilqAke2xhYmVsfVxuYDsKICAgbGV0IGJvZHk9IiI7CiAgIGlmKG48Nilib2R5PSc8c3BhbiBjbGFzcz0ic21hbGwiPjbpoK3mnKrmuoDjga7jgZ/jgoHlr77osaHlpJY8L3NwYW4+JzsKICAgZWxzZXsKICAgIGNvbnN0IG9kPW9kZHNGb3IocmFjZSkscmVzPVVFLmFuYWx5emUocmFjZSxzdG9yZSxvZCksYz1yZXMuZmlsdGVyKHg9PnguaG9sZSkuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCwyKTt7Y29uc3QgbT1tYXRjaEluZm8ocmVzKTt0SCs9bS5oO3ROKz1tLm59CiAgICBib2R5PWMubWFwKHg9Pntjb25zdCB0Zz14LnRhZ3Muc2xpY2UoMCwyKS5tYXAodD0+dC50KS5qb2luKCLvvI8iKTsKICAgICB0ZXh0Kz1gICAke3gubm9955WqICR7eC5uYW1lfSAke3JhdGluZyh4LnBjLHgubW9kZSl9ICR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSUgJHt0Z31cbmA7CiAgICAgcmV0dXJuIGA8ZGl2PjxiPiR7ZXNjKHgubm8pfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHIke3JhdGluZyh4LnBjLHgubW9kZSl9Ij4ke3JhdGluZyh4LnBjLHgubW9kZSl9PC9zcGFuPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSXvvIjkv6HpoLzluqYke2VzYyh4LmNvbmYpfe+8iTwvc3Bhbj48YnI+YCt4LnRhZ3Muc2xpY2UoMCwzKS5tYXAodD0+YDxzcGFuIGNsYXNzPSJjaGlwICR7dC5jfSI+JHtlc2ModC50KX08L3NwYW4+YCkuam9pbigiIikrYDwvZGl2PmB9KS5qb2luKCIiKXx8JzxzcGFuIGNsYXNzPSJzbWFsbCI+56m044K+44O844Oz44Gr6Kmy5b2T44Gq44GXPC9zcGFuPic7CiAgIH0KICAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKGxhYmVsKX08L2I+PGJyPiR7Ym9keX08YnI+PGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLWs9IiR7a30iPuips+e0sOODu+OCquODg+OCuuWFpeWKmzwvYnV0dG9uPjwvZGl2PmA7CiAgfSk7CiAgaD1oLnJlcGxhY2UoJzxicj4nLGA8ZGl2IGNsYXNzPSJzbWFsbCI+5bGl5q2044Gu54Wn5ZCI77ya6aasICR7dEh9LyR7dE596aCt77yI6YGO5Y6744GrMui1sOS7peS4iuOBguOCi+mmrO+8iTwvZGl2PmArKHROJiZ0SDx0TiouNT8nPGRpdiBjbGFzcz0id2FybiBzbWFsbCI+4pqgIOeFp+WQiOOBp+OBjeOBn+mmrOOBjOWNiuWIhuacqua6gOOBp+OBmeOAguiLpemnkuaIpuOBjOS4reW/g+OBruaXpeOBr+ato+W4uOOBp+OBmeOBjOOAgeOBneOBhuOBp+OBquOBkeOCjOOBsOmmrOWQjeihqOiomOOBruS4jeS4gOiHtOOBruWPr+iDveaAp+OBjOOBguOCiuOBvuOBmeOAgjwvZGl2Pic6JycpKyc8YnI+Jyk7CiAgaCs9JzxidXR0b24gaWQ9ImNvcHlBbGwiPuS4gOimp+OCkuODhuOCreOCueODiOOBp+OCs+ODlOODvDwvYnV0dG9uPic7CiAgJCgiYWxsb3V0IikuaW5uZXJIVE1MPWg7CiAgJCgiYWxsb3V0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEta10iKS5mb3JFYWNoKGJ0PT5idC5vbmNsaWNrPSgpPT57Y29uc3Qgcj1yc1tidC5kYXRhc2V0LmtdO3NldFJhY2UobWtSYWNlKHIsZCksYCR7ZH0gJHtyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiJ9JHtyLnJhY2VOdW1iZXJ8fCIifVIgJHtyLnJhY2VOYW1lfHwiIn1gKTskKCJydW4iKS5zY3JvbGxJbnRvVmlldyh7YmVoYXZpb3I6InNtb290aCJ9KTtydW4obnVsbCl9KTsKICAkKCJjb3B5QWxsIikub25jbGljaz1hc3luYygpPT57dHJ5e2F3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHRleHQpOyQoImNvcHlBbGwiKS50ZXh0Q29udGVudD0i44Kz44OU44O844GX44G+44GX44GfIn1jYXRjaChlKXthbGVydCgi44Kz44OU44O844Gn44GN44G+44Gb44KT44Gn44GX44GfIil9fTsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJhbGxvdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kuIDmi6zop6PmnpDjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9CiQoIndhbGwiKS5vbmNsaWNrPXJ1bkFsbDsKLyog5omL5YWl5YqbICovCiQoIm1kYXRlIikudmFsdWU9bmV3IERhdGUoRGF0ZS5ub3coKSs4NjQwMDAwMCozKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwokKCJ3ZGF0ZSIpLnZhbHVlPSQoIm1kYXRlIikudmFsdWU7JCgicGRhdGUiKS52YWx1ZT0iMjAyNi0wNi0yMSI7CiQoIm1nbyIpLm9uY2xpY2s9KCk9PnsKIGNvbnN0IGxpbmVzPSQoIm10ZXh0IikudmFsdWUuc3BsaXQoL1xyP1xuLykubWFwKHM9PnMudHJpbSgpKS5maWx0ZXIoQm9vbGVhbikscnM9W10sb2Rkcz1bXTsKIGZvcihjb25zdCBsIG9mIGxpbmVzKXtjb25zdCBtPWwubWF0Y2goL14oXGR7MSwyfSlbXHMs44CAXSsoXFMrPykoPzpbXHMs44CAXSsoW1xkLl0rKSk/JC8pO2lmKG0pe3JzLnB1c2goe25hbWU6bVsyXSxob3JzZTpVRS5ubihtWzJdKSxqb2NrZXk6IiIsYWdlOm51bGwsbnVtOittWzFdfSk7b2Rkcy5wdXNoKG1bM10/K21bM106MCl9fQogaWYocnMubGVuZ3RoPDIpcmV0dXJuIGFsZXJ0KCLjgIzppqznlaog6aas5ZCN44CN44Gu5b2i5byP44GnMumgreS7peS4iuWFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogY29uc3QgcmFjZT17ZGF0ZTokKCJtZGF0ZSIpLnZhbHVlLHN1cmY6KyQoIm1zdXJmIikudmFsdWUsZGlzdDorJCgibWRpc3QiKS52YWx1ZXx8MCxydW5uZXJzOnJzLG9kZHMwOm9kZHMuZXZlcnkobz0+bz4xKT9vZGRzOm51bGx9Owogc2V0UmFjZShyYWNlLGAke3JhY2UuZGF0ZX0g5omL5YWl5Yqb77yIJHtyYWNlLnN1cmY9PT0xPyLoip0iOiLjg4Djg7zjg4gifSR7cmFjZS5kaXN0fW3jg7ske3JzLmxlbmd0aH3poK3vvIlgKTsKfTsKLyog6YGO5Y6744Os44O844K5ICovCmxldCBQUkFDRVM9W107CiQoInBnZXQiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgicGRhdGUiKS52YWx1ZTtpZighZClyZXR1cm47JCgicHN0YXR1cyIpLnRleHRDb250ZW50PSLmpJzntKLkuK3igKYiOyQoInBsaXN0IikuaW5uZXJIVE1MPSIiOwogdHJ5ewogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoci5kYXRlIT09ZHx8IXIucmFjZUlkKXJldHVybjtpZighbWFwLmhhcyhyLnJhY2VJZCkpbWFwLnNldChyLnJhY2VJZCxbXSk7bWFwLmdldChyLnJhY2VJZCkucHVzaChyKX0pOwogIFBSQUNFUz1bLi4ubWFwLmVudHJpZXMoKV0uZmlsdGVyKChbLHZdKT0+di5sZW5ndGg+PTYpLnNvcnQoKGEsYik9PnZlbnVlT2ZJZChhWzBdKS5sb2NhbGVDb21wYXJlKHZlbnVlT2ZJZChiWzBdKSl8fHJhY2VOb09mSWQoYVswXSktcmFjZU5vT2ZJZChiWzBdKSk7CiAgaWYoIVBSQUNFUy5sZW5ndGgpeyQoInBzdGF0dXMiKS50ZXh0Q29udGVudD0i44Gd44Gu5pel44Gu44Os44O844K544Gv5L+d5a2Y44OH44O844K/44Gr44GC44KK44G+44Gb44KT44CCIjtyZXR1cm59CiAgJCgicHN0YXR1cyIpLnRleHRDb250ZW50PWAke1BSQUNFUy5sZW5ndGh944Os44O844K5YDsKICBjb25zdCBsYWI9aWQ9PmAke1ZFTlVFW3ZlbnVlT2ZJZChpZCldfHx2ZW51ZU9mSWQoaWQpfSR7cmFjZU5vT2ZJZChpZCl9UmA7CiAgJCgicGxpc3QiKS5pbm5lckhUTUw9UFJBQ0VTLm1hcCgoW2lkLHZdLGspPT5gPGJ1dHRvbiBkYXRhLWs9IiR7a30iPiR7bGFiKGlkKX3vvIgke3ZbMF0uc3VyZj09PTE/IuiKnSI6IuODgCJ9JHt2WzBdLmRpc3R9beODuyR7di5sZW5ndGh96aCt77yJPC9idXR0b24+YCkuam9pbigiIik7CiAgJCgicGxpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b24iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+e2NvbnN0IFtpZCx2XT1QUkFDRVNbYi5kYXRhc2V0LmtdOwogICBjb25zdCBycz12LmZpbHRlcihyPT5yLmhvcnNlKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpLm1hcChyPT4oe25hbWU6ci5uYW1lfHxyLmhvcnNlLGhvcnNlOnIuaG9yc2Usam9ja2V5OnIuam9ja2V5LGFnZTpyLmFnZSxudW06ci5udW0sYWN0OnIuZmluaXNoLHBvcDpyLnBvcCxvZGRzQTpyLm9kZHN9KSk7CiAgIGNvbnN0IHJhY2U9e2RhdGU6ZCxzdXJmOnZbMF0uc3VyZixkaXN0OnZbMF0uZGlzdCxydW5uZXJzOnJzLHBhc3Q6dHJ1ZX07CiAgIHNldFJhY2UocmFjZSxgJHtkfSAke2xhYihpZCl977yI6YGO5Y6744Os44O844K544O7JHtycy5sZW5ndGh96aCt77yJYCk7fSk7CiB9Y2F0Y2goZSl7JCgicHN0YXR1cyIpLnRleHRDb250ZW50PSLjgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KfTsKCi8qIC0tLSDop6PmnpDjg7vooajnpLogLS0tICovCi8qIOODqeODs+OCr+OBr+ijnOato+W+jOOBruWlvei1sOeOh+OBp+WIpOWumu+8iOODouODvOODieOBlOOBqOOBq+eptOOCvuODvOODs+OBruW5s+Wdh+OBjOmBleOBhu+8muOCquODg+OCuuWFpeWKm+aZguOBr+e0hDkl44CB44Kq44OD44K644Gq44GX44Gv57SEMTMl77yJICovCmNvbnN0IHJhdGluZz0ocCxtb2RlKT0+bW9kZT09PSJvZGRzIj8ocD49LjE2PyJTIjpwPj0uMTI/IkEiOnA+PS4wOT8iQiI6IkMiKToocD49LjI0PyJTIjpwPj0uMTk/IkEiOnA+PS4xNT8iQiI6IkMiKTsKY29uc3QgYXZnTm90ZT1tb2RlPT5tb2RlPT09Im9kZHMiPyLntIQ5JSI6Iue0hDEzJSI7Ci8qIOWxpeattOOBrueFp+WQiOeKtuazge+8iOmmrOWQjeODu+mojuaJi+WQjeOBjOmBjuWOu+ODh+ODvOOCv+OBqOS4gOiHtOOBl+OBn+OBi++8iSAqLwpjb25zdCBtYXRjaEluZm89cmVzPT57Y29uc3Qgbj1yZXMubGVuZ3RoLGg9cmVzLmZpbHRlcih4PT54Lm4+PTIpLmxlbmd0aCxqPXJlcy5maWx0ZXIoeD0+eC5qbj49NSkubGVuZ3RoO3JldHVybntuLGgsan19Owphc3luYyBmdW5jdGlvbiBydW4ob2Rkc0luKXsKIGlmKCFDVVIpcmV0dXJuOwogdHJ5ewogIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoQ1VSLmRhdGUpOwogIGxldCBvZGRzPW9kZHNJbnx8bnVsbDsKICBpZighb2RkcyYmQ1VSLm9kZHMwKW9kZHM9Q1VSLm9kZHMwOwogIGlmKCFvZGRzJiZDVVIucGFzdCYmQ1VSLnJ1bm5lcnMuZXZlcnkocj0+ci5vZGRzQT4xKSlvZGRzPUNVUi5ydW5uZXJzLm1hcChyPT5yLm9kZHNBKTsKICBjb25zdCBwb3BBcnI9KCFvZGRzJiZDVVIucGFzdCYmQ1VSLnJ1bm5lcnMuZXZlcnkocj0+ci5wb3A+MCkpP0NVUi5ydW5uZXJzLm1hcChyPT5yLnBvcCk6bnVsbDsKICBjb25zdCByZXM9VUUuYW5hbHl6ZShDVVIsc3RvcmUsb2RkcyxudWxsLHBvcEFycik7CiAgTEFTVFJFUz17cmVzLG9kZHMsY291bnQ6c3RvcmUuY291bnR9O3JlbmRlcigpOwogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoIm91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuino+aekOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn0KZnVuY3Rpb24gcmVuZGVyKCl7CiBjb25zdHtyZXMsb2Rkcyxjb3VudH09TEFTVFJFUyxOPXJlcy5sZW5ndGgsY3V0PXJlc1swXS5jdXQscGFzdD0hIUNVUi5wYXN0OwogaWYoTjw2KXskKCJvdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj426aCt5pyq5rqA44Gu44Gf44KB56m06aas5Yik5a6a44Gu5a++6LGh5aSW44Gn44GZ44CCPC9zcGFuPic7cmV0dXJufQogY29uc3QgdXNlZD0hIXJlc1swXS5ta3QsY2FuZHM9cmVzLmZpbHRlcih4PT54LmhvbGUpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsNSk7CiBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPuS6uuawl+mghu+8miR7dXNlZD8i5YWl5Yqb44Kq44OD44K6Ijoi44OE44O844Or5o6o5a6a77yI6aiO5omL5oiQ57i+6L6844G/44O75a6f6Zqb44Gu5Lq65rCX44Go44Gv55Ww44Gq44KK44G+44GZ77yJIn3vvI/nqbTjgr7jg7zjg7PvvJoke2N1dH3nlarnm67ku6XpmY3vvIjlhagke0596aCt77yJ77yP5a2m57+SICR7Y291bnQudG9Mb2NhbGVTdHJpbmcoKX3ooYw8L2Rpdj5gOwoge2NvbnN0IG09bWF0Y2hJbmZvKHJlcyk7aCs9YDxkaXYgY2xhc3M9InNtYWxsIj7lsaXmrbTjga7nhaflkIjvvJrppqwgJHttLmh9LyR7bS5ufemgre+8iDLotbDku6XkuIrvvInvvI/pqI7miYsgJHttLmp9LyR7bS5ufemgrTwvZGl2PmA7aWYobS5oPG0ubiouNSloKz1gPGRpdiBjbGFzcz0id2FybiBzbWFsbCI+4pqgIOmBjuWOu+i1sOOCkueFp+WQiOOBp+OBjeOBn+mmrOOBjOWwkeOBquOBhOOBn+OCgeOAgeS6iOaDs+OBruS/oemgvOW6puOBr+S9juOCgeOBp+OBme+8iOaWsOmmrOaIpuODu+iLpemnkuaIpuOAgeOBvuOBn+OBr+mmrOWQjeihqOiomOOBrumBleOBhO+8ieOAgjwvZGl2PmB9CiBoKz0iPGJyPiI7CiBpZighY2FuZHMubGVuZ3RoKWgrPSc8c3BhbiBjbGFzcz0id2FybiI+56m044K+44O844Oz44Gr6Kmy5b2T6aas44GM44GE44G+44Gb44KT44CCPC9zcGFuPic7CiBjYW5kcy5mb3JFYWNoKCh4LGspPT57CiAgY29uc3QgY2hpcHM9eC50YWdzLm1hcCh0PT5gPHNwYW4gY2xhc3M9ImNoaXAgJHt0LmN9Ij4ke2VzYyh0LnQpfTwvc3Bhbj5gKS5qb2luKCIiKTsKICBjb25zdCByPUNVUi5ydW5uZXJzW3guaV07CiAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7aysxfS4gJHtlc2MoeC5ubyl955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgciR7cmF0aW5nKHgucGMseC5tb2RlKX0iPiR7cmF0aW5nKHgucGMseC5tb2RlKX08L3NwYW4+YDsKICBpZihwYXN0KWgrPWAgPHNwYW4gY2xhc3M9InNtYWxsIj7ihpIg57WQ5p6cICR7ci5hY3Q/PyItIn3nnYDvvIgke3IucG9wPz8iLSJ95Lq65rCX77yJJHtyLmFjdDw9Mz8iIOKchSI6IiJ9PC9zcGFuPmA7CiAgaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7lpb3otbDnjocgPGI+JHsoeC5wYyoxMDApLnRvRml4ZWQoMSl9JTwvYj7vvIjnqbTjgr7jg7zjg7PlubPlnYfjga8ke2F2Z05vdGUoeC5tb2RlKX3vvInvvI/kv6HpoLzluqYgJHtlc2MoeC5jb25mKX3vvIgke3gubn3otbDvvIlgOwogIGlmKHgubWt0IT1udWxsKWgrPWA8YnI+5biC5aC044Gu5oOz5a6aM+edgOWGhSAkeyh4Lm1rdCoxMDApLnRvRml4ZWQoMSl9JSDihpIg5aaZ5ZGzIDxiPiR7eC52YWx1ZT49Mz8iM+WAjeS7peS4iiI6eC52YWx1ZS50b0ZpeGVkKDIpKyLlgI0ifTwvYj4ke3gudmFsdWU+PTEuMz8iIPCflKUiOiIifWA7CiAgaCs9YDwvZGl2PjxkaXY+JHtjaGlwc3x8JzxzcGFuIGNsYXNzPSJzbWFsbCI+55uu56uL44Gk5qC55oug44Gq44GXPC9zcGFuPid9PC9kaXY+PC9kaXY+YDsKIH0pOwogaCs9YDxicj48Yj7lhajpoK3kuIDopqc8L2I+JHtwYXN0PyLvvIjlrp/pmpvjga7ntZDmnpzjgaTjgY3vvIkiOiLvvIjljZjli53jgqrjg4PjgrrjgpLlhaXjgozjgovjgajlppnlkbPjgpLoqIjnrpfvvIkifTx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqznlao8L3RoPjx0aD7ppqzlkI08L3RoPjx0aD7lpb3otbDnjoc8L3RoPjx0aD7poIbkvY08L3RoPjx0aD7jgqrjg4Pjgro8L3RoPiR7cGFzdD8iPHRoPue1kOaenDwvdGg+IjoiIn08L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgeCBvZiByZXMpe2NvbnN0IHI9Q1VSLnJ1bm5lcnNbeC5pXTsKICBoKz1gPHRyJHt4LmhvbGU/JyBzdHlsZT0iYmFja2dyb3VuZDojZmZiODAwMjIiJzonJ30+PHRkPiR7ZXNjKHgubm8pfTwvdGQ+PHRkPiR7ZXNjKHgubmFtZSl9PC90ZD48dGQ+JHsoeC5wYyoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPiR7eC5yYW5rfTwvdGQ+PHRkPjxpbnB1dCBjbGFzcz0ib2RkcyIgZGF0YS1pPSIke3guaX0iIHR5cGU9Im51bWJlciIgc3RlcD0iMC4xIiBtaW49IjEuMSIgaW5wdXRtb2RlPSJkZWNpbWFsIiB2YWx1ZT0iJHtvZGRzP29kZHNbeC5pXToiIn0iIHN0eWxlPSJ3aWR0aDo2MnB4O3BhZGRpbmc6NHB4Ij48L3RkPiR7cGFzdD9gPHRkPiR7ci5hY3Q/PyItIn3nnYA8L3RkPmA6IiJ9PC90cj5gfQogaCs9YDwvdGJvZHk+PC90YWJsZT48YnV0dG9uIGlkPSJyZWNhbGMiPuOCquODg+OCuuOCkuWPjeaYoOOBl+OBpuWGjeioiOeulzwvYnV0dG9uPjxidXR0b24gaWQ9ImNsZWFyb2RkcyIgY2xhc3M9InN1YiI+44Kq44OD44K644KS44Kv44Oq44KiPC9idXR0b24+YDsKICQoIm91dCIpLmlubmVySFRNTD1oOwogJCgicmVjYWxjIikub25jbGljaz0oKT0+e2NvbnN0IHY9Wy4uLmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiNvdXQgaW5wdXQub2RkcyIpXS5tYXAoZT0+cGFyc2VGbG9hdChlLnZhbHVlKSk7cnVuKHYuZXZlcnkobz0+bz4xKT92Om51bGwpfTsKICQoImNsZWFyb2RkcyIpLm9uY2xpY2s9KCk9PntDVVIub2RkczA9bnVsbDtDVVIucGFzdD1DVVIucGFzdDtMQVNUUkVTPW51bGw7cnVuKG51bGwpfTsKfQokKCJydW4iKS5vbmNsaWNrPSgpPT5ydW4obnVsbCk7CiQoImZpbGUiKS5vbmNoYW5nZT1lPT57Y29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZihmKWltcG9ydEZpbGUoZikudGhlbigoKT0+e2UudGFyZ2V0LnZhbHVlPSIifSl9OwoKLyogLS0tIOaJleaIu+ODu+aciOOBruWPluW+l+eKtuazge+8iEluZGV4ZWREQu+8iSAtLS0gKi8KY29uc3QgcGF5QWxsPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigicGF5Iikub2JqZWN0U3RvcmUoInBheSIpLmdldEFsbCgpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgcGF5UHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigicGF5IiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgicGF5IikucHV0KHYsayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgbWV0YUdldD1rPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigibWV0YSIpLm9iamVjdFN0b3JlKCJtZXRhIikuZ2V0KGspO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdCk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBtZXRhUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigibWV0YSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoIm1ldGEiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwphc3luYyBmdW5jdGlvbiBwYXlTdGF0ZSgpe2F3YWl0IHNob3dTdGF0ZSgpfQoKLyogLS0tIOWFsemAmuOBruWPluW+l++8iOWGjeippuihjOOBpOOBje+8iSAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gZmV0Y2hKU09OKHVybCl7CiBsZXQgZXJyPSIiOwogZm9yKGxldCB0PTA7dDwzO3QrKyl7dHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2godXJsKTtjb25zdCB4PWF3YWl0IHIuanNvbigpLmNhdGNoKCgpPT4oe30pKTtpZighci5va3x8eC5vaz09PWZhbHNlKXRocm93IG5ldyBFcnJvcih4LmVycm9yfHwoIkhUVFAgIityLnN0YXR1cykpO3JldHVybiB4fWNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7YXdhaXQgc2xlZXAoMTIwMCoodCsxKSl9fQogdGhyb3cgbmV3IEVycm9yKGVycik7Cn0KY29uc3QganN0WWVzdGVyZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzLTg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpjb25zdCBhZGREYXlzPShkLG4pPT5uZXcgRGF0ZShuZXcgRGF0ZShkKyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpK24qODY0ZTUpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmZ1bmN0aW9uIG1vbnRoc0JldHdlZW4oYSxiKXtjb25zdCBvdXQ9W107bGV0W3ksbV09YS5zbGljZSgwLDcpLnNwbGl0KCItIikubWFwKE51bWJlcik7Y29uc3RbeTIsbTJdPWIuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpOwogd2hpbGUoeTx5Mnx8KHk9PT15MiYmbTw9bTIpKXtvdXQucHVzaChgJHt5fS0ke1N0cmluZyhtKS5wYWRTdGFydCgyLCIwIil9YCk7bSsrO2lmKG0+MTIpe209MTt5Kyt9fXJldHVybiBvdXR9CgovKiAtLS0g4pGgIOODh+ODvOOCv+WPluW+l++8mumBjuWOu+aIkOe4vu+8iOS6uuawl+OBpOOBje+8ie+8i+aJleaIu+OCkuOAgemWi+WCrOaXpeOBlOOBqOOBq+WPluW+l+OBl+OBpuS/neWtmCAtLS0gKi8KY29uc3QgU1lOQ19CQVRDSD02LFNZTkNfUEFSQUxMRUw9MzsKbGV0IFNTVE9QPWZhbHNlLEJBQ0tVUF9EQVRFUz1udWxsOwokKCJzeW5jU3RvcCIpLm9uY2xpY2s9KCk9PntTU1RPUD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZX07CiQoInNlbmQiKS52YWx1ZT1qc3RZZXN0ZXJkYXkoKTsKYXN5bmMgZnVuY3Rpb24gYmFja3VwRGF0ZXMoKXsKIGlmKEJBQ0tVUF9EQVRFUylyZXR1cm4gQkFDS1VQX0RBVEVTOwogY29uc3Qgcz1uZXcgU2V0KCksZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IoY29uc3QgZiBvZiBmcyl7aWYoZi5saXZlKWNvbnRpbnVlO2Zvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKXtjb25zdCBkPVVFLnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKTtpZihkKXMuYWRkKGQpfWF3YWl0IHNsZWVwKDApfQogcmV0dXJuIEJBQ0tVUF9EQVRFUz1zOwp9CmFzeW5jIGZ1bmN0aW9uIGZldGNoRGF5KGJhc2UsZCl7CiBjb25zdCBkYXk9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1kYXk/ZGF0ZT0ke2R9YCk7CiBjb25zdCByYWNlcz1kYXkucmFjZXN8fFtdO2lmKCFyYWNlcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHJhY2VzLmxlbmd0aDtpKz1TWU5DX0JBVENIKWNodW5rcy5wdXNoKHJhY2VzLnNsaWNlKGksaStTWU5DX0JBVENIKS5tYXAoeD0+eC5jbmFtZSkpOwogY29uc3Qgcm93cz1bXSxwYXlvdXRzPVtdO2xldCBpZHg9MCxmYWlsZWROPTA7CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGlkeDxjaHVua3MubGVuZ3RoKXtjb25zdCBrPWlkeCsrOwogIGNvbnN0IHJlcz1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLXJlc3VsdHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gKTsKICByb3dzLnB1c2goLi4uKHJlcy5yb3dzfHxbXSkpO3BheW91dHMucHVzaCguLi4ocmVzLnBheW91dHN8fFtdKSk7ZmFpbGVkTis9KHJlcy5mYWlsZWR8fFtdKS5sZW5ndGh9fTsKIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oe2xlbmd0aDpNYXRoLm1pbihTWU5DX1BBUkFMTEVMLGNodW5rcy5sZW5ndGgpfSx3b3JrZXIpKTsKIGNvbnN0IGdvdD1uZXcgU2V0KHJvd3MubWFwKHI9PnIucmFjZUlkKSkuc2l6ZTsKIGZhaWxlZE49TWF0aC5tYXgoZmFpbGVkTixyYWNlcy5sZW5ndGgtZ290KTsKIHJldHVybntyb3dzLHBheW91dHMsZmFpbGVkTixyYWNlczpyYWNlcy5sZW5ndGh9Owp9CiQoInN5bmNHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiBjb25zdCBhPSQoInNzdGFydCIpLnZhbHVlfHwiMjAyMy0wMS0wMSIseWQ9anN0WWVzdGVyZGF5KCk7bGV0IGI9JCgic2VuZCIpLnZhbHVlfHx5ZDtpZihiPnlkKWI9eWQ7CiBpZihhPmIpeyQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5aeL5pel44GM57WC5LqG5pel44KI44KK5b6M44Gn44GZ44CCIjtyZXR1cm59CiBTU1RPUD1mYWxzZTskKCJzeW5jR28iKS5kaXNhYmxlZD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9ZmFsc2U7CiBjb25zdCBzdD17ZGF5czowLHJhY2VzOjAsc2tpcHBlZDowLGZhaWw6W10sdDA6RGF0ZS5ub3coKX07CiB0cnl7CiAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLkv53lrZjmuIjjgb/jg4fjg7zjgr/jgpLnorroqo3kuK3igKYiOwogIGNvbnN0IGZpbGVzPWF3YWl0IGlkYkFsbCgpLGhhdmVMaXZlPW5ldyBTZXQoZmlsZXMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkubWFwKGY9PmYuZGF0ZSkpOwogIGNvbnN0IGhhdmVQYXk9bmV3IFNldCgoYXdhaXQgcGF5QWxsKCkpLmZpbHRlcihwPT4hcC5mYWlsZWQpLm1hcChwPT5wLmRhdGUpKTsKICBjb25zdCBiaz1hd2FpdCBiYWNrdXBEYXRlcygpOwogIGNvbnN0IG1vbnRocz1tb250aHNCZXR3ZWVuKGEsYiksY3VyTW9udGg9eWQuc2xpY2UoMCw3KTsKICBmb3IobGV0IG1pPTA7bWk8bW9udGhzLmxlbmd0aDttaSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgbW9udGg9bW9udGhzW21pXTsKICAgaWYobW9udGg8Y3VyTW9udGgmJmF3YWl0IG1ldGFHZXQoIm1vbnRoOiIrbW9udGgpKXtjb250aW51ZX0KICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke21vbnRofe+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iemWi+WCrOaXpeOCkueiuuiqjeS4reKApiDlj5blvpfmuIjjgb8ke3N0LmRheXN95pelYDsKICAgbGV0IGRheXM7dHJ5e2RheXM9KGF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5cz9tb250aD0ke21vbnRofWApKS5kYXlzfHxbXX1jYXRjaChlKXtzdC5mYWlsLnB1c2goYCR7bW9udGh977yaJHtlLm1lc3NhZ2V9YCk7Y29udGludWV9CiAgIGRheXM9ZGF5cy5maWx0ZXIoZD0+ZD49YSYmZDw9Yik7bGV0IG1vbnRoT2s9dHJ1ZTsKICAgZm9yKGNvbnN0IGQgb2YgZGF5cyl7CiAgICBpZihTU1RPUCl7bW9udGhPaz1mYWxzZTticmVha30KICAgIGNvbnN0IG5lZWRSb3dzPSFoYXZlTGl2ZS5oYXMoZCkmJiFiay5oYXMoZCksbmVlZFBheT0haGF2ZVBheS5oYXMoZCk7CiAgICBpZighbmVlZFJvd3MmJiFuZWVkUGF5KXtzdC5za2lwcGVkKys7Y29udGludWV9CiAgICBjb25zdCBlbD1NYXRoLnJvdW5kKChEYXRlLm5vdygpLXN0LnQwKS8xMDAwKTsKICAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtkfSDjgpLlj5blvpfkuK3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvIlcbuWPluW+lyR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yP5aSx5pWXJHtzdC5mYWlsLmxlbmd0aH3vvI/ntYzpgY4ke01hdGguZmxvb3IoZWwvNjApfeWIhiR7ZWwlNjB956eSYDsKICAgIHRyeXsKICAgICBjb25zdCByPWF3YWl0IGZldGNoRGF5KGJhc2UsZCk7CiAgICAgaWYoci5mYWlsZWROKXttb250aE9rPWZhbHNlO3N0LmZhaWwucHVzaChgJHtkfe+8iCR7ci5mYWlsZWROfVLlpLHmlZfvvIlgKTtjb250aW51ZX0KICAgICBpZihuZWVkUm93cyl7YXdhaXQgaWRiUHV0KGBsaXZlOiR7ZH1gLHtsaXZlOnRydWUsZGF0ZTpkLHJvd3M6ci5yb3dzfSk7aGF2ZUxpdmUuYWRkKGQpfQogICAgIGF3YWl0IHBheVB1dChkLHtkYXRlOmQscmFjZXM6ci5wYXlvdXRzLGZhaWxlZDowfSk7aGF2ZVBheS5hZGQoZCk7CiAgICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yLnJhY2VzOwogICAgfWNhdGNoKGUpe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCl9CiAgICBhd2FpdCBzbGVlcCgyMDApOwogICB9CiAgIGlmKG1vbnRoT2smJm1vbnRoPGN1ck1vbnRoKWF3YWl0IG1ldGFQdXQoIm1vbnRoOiIrbW9udGgsdHJ1ZSk7CiAgfQogfWNhdGNoKGUpe3N0LmZhaWwucHVzaChTdHJpbmcoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5ewogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOyQoInN5bmNHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICAkKCJzeW5jU3RhdHVzIikuaW5uZXJIVE1MPWAke1NTVE9QPyLlgZzmraLjgZfjgb7jgZfjgZ/jgIIiOiLlrozkuobjgIIifeS7iuWbnuOBruWPluW+l++8miR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yI5L+d5a2Y5riI44G/44Gn44K544Kt44OD44OXICR7c3Quc2tpcHBlZH3ml6XvvIlgKyhzdC5mYWlsLmxlbmd0aD9gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIifVxu77yI44KC44GG5LiA5bqm5oq844GZ44Go44CB5aSx5pWX44GX44Gf5pel44Gg44GR44KE44KK55u044GX44G+44GZ77yJPC9zcGFuPmA6IiIpOwogIGF3YWl0IHNob3dTdGF0ZSgpOwogfQp9OwoKLyogLS0tIOaJleaIu+OBruabuOOBjeWHuuOBl+ODu+iqreOBv+i+vOOBvyAtLS0gKi8KJCgicGF5RXhwIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXJldHVybiBhbGVydCgi5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIik7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocHMpXSx7dHlwZToiYXBwbGljYXRpb24vanNvbiJ9KSk7CiBhLmRvd25sb2FkPWBrZWliYV9wYXlvdXRzXyR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApfS5qc29uYDthLmNsaWNrKCk7c2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApfTsKJCgicGF5SW1wIikub25jaGFuZ2U9YXN5bmMgZT0+ewogY29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZighZilyZXR1cm47CiB0cnl7Y29uc3Qgaj1KU09OLnBhcnNlKGF3YWl0IGYudGV4dCgpKTtjb25zdCBhcnI9QXJyYXkuaXNBcnJheShqKT9qOihqLnJhY2VzP1tqXTpbXSk7CiAgY29uc3QgYnlEYXRlPW5ldyBNYXAoKTsKICBmb3IoY29uc3QgeCBvZiBhcnIpe2lmKHgmJkFycmF5LmlzQXJyYXkoeC5yYWNlcykmJnguZGF0ZSlieURhdGUuc2V0KHguZGF0ZSx7ZGF0ZTp4LmRhdGUscmFjZXM6eC5yYWNlcyxmYWlsZWQ6eC5mYWlsZWR8fDB9KX0KICBmb3IoY29uc3RbZCxyXW9mIGJ5RGF0ZSlhd2FpdCBwYXlQdXQoZCxyKTsKICBhd2FpdCBzaG93U3RhdGUoKTsKIH1jYXRjaChlcnIpeyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+6Kqt44G/6L6844G/44Ko44Op44O877yaJHtlc2MoZXJyLm1lc3NhZ2UpfTwvc3Bhbj5gfQogZS50YXJnZXQudmFsdWU9IiI7Cn07CgovKiAtLS0g4pGgLTIg6KSH5Yud5Zue5Y+O546H44Gu5qSc6Ki8IC0tLSAqLwokKCJidFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogdHJ5ewogIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CC5YWI44Gr4pGg44Gn5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHBheUJ5SWQ9e307cHMuZm9yRWFjaChwPT4ocC5yYWNlc3x8W10pLmZvckVhY2goeD0+e3BheUJ5SWRbeC5yYWNlSWRdPXh9KSk7CiAgY29uc3Qgc3RhcnQ9JCgiYnRTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSI7CiAgY29uc3QgcGRhdGVzPXBzLm1hcChwPT5wLmRhdGUpLmZpbHRlcihkPT5kPj1zdGFydCkuc29ydCgpOwogIGlmKCFwZGF0ZXMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumWi+Wni+aXpeS7pemZjeOBruaJleaIu+OBjOOBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBzcGxpdD1wZGF0ZXNbTWF0aC5mbG9vcihwZGF0ZXMubGVuZ3RoLzIpXTsKICBidXN5KHRydWUsIuaIkOe4vuOCkuiqreOBv+i+vOOBv+S4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBtYXA9bmV3IE1hcCgpOwogIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKICBidXN5KHRydWUsIuODkOODg+OCr+ODhuOCueODiOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvdXQ9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7c3RhcnQsc3BsaXR9KTtidXN5KGZhbHNlKTsKICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK3vvIjln7rmupbvvIkiLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIrvvIjjgqrjg4Pjgrrlv4XopoHvvIkifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX08L3NwYW4+YDoiLSI7CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvdXQucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvI8ke3N0YXJ0feOAnO+8iOWJjeWNiu+8nSR7c3BsaXR944KI44KK5YmN44CB5b6M5Y2K77yd5Lul6ZmN77yJ77yP5ZCEMTAw5YaGPC9kaXY+PGJyPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7os7zlhaXmlbA8L3RoPjx0aD7nmoTkuK3njoc8L3RoPjx0aD7lm57lj47njocoOTUl5bmFKTwvdGg+PHRoPuWJjeWNijwvdGg+PHRoPuW+jOWNijwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW91dC5zdGF0c1trXTtpZighdi5hbGwuYmV0cyljb250aW51ZTsKICAgaCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7di5hbGwuYmV0cy50b0xvY2FsZVN0cmluZygpfTwvdGQ+PHRkPiR7KHYuYWxsLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD48Yj4ke2Modi5hbGwpfTwvYj48L3RkPjx0ZD4ke3YuQS5iZXRzP3BjdCh2LkEucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkIuYmV0cz9wY3Qodi5CLnJvaSk6Ii0ifTwvdGQ+PC90cj5gfQogIGgrPWA8L3Rib2R5PjwvdGFibGU+PGRpdiBjbGFzcz0ic21hbGwiPjxicj7opovmlrnvvJrjg4Tjg7zjg6vjga7osrfjgYTmlrnjga7lm57lj47njofjgYzjgIznqbTjgr7jg7zjg7PlhajpoK3jgI3jgojjgorjgIE5NSXluYXjgpLotoXjgYjjgabpq5jjgY/jgIHliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jgarjgonlirnmnpzjgYLjgorjgajliKTmlq3jgafjgY3jgb7jgZnjgILluYXjgYzph43jgarjgovloLTlkIjjga/jgIHlgbbnhLbjga7lj6/og73mgKfjgYzmrovjgorjgb7jgZnjgILlm57lj47njofjgYwxMDAl5pyq5rqA44Gq44KJ44CB5Yq55p6c44GM44GC44Gj44Gm44KC6LK344GE57aa44GR44KL44Go6LKg44GR44G+44GZ44CCPC9kaXY+YDsKICAkKCJidE91dCIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfTsKCi8qIC0tLSDjgqrjg4Pjgrrlj5blvpfvvIgvanJhLW9kZHPvvJrlvZPml6Xjg7vliY3ml6Xlo7Ljgorjga7ljZjli53jgqrjg4PjgrrvvIkgLS0tICovCmxldCBPRERTPXt9OwpmdW5jdGlvbiBvZGRzRm9yKHJhY2UpewogY29uc3QgbT1yYWNlJiZyYWNlLmtleT9PRERTW3JhY2Uua2V5XTpudWxsO2lmKCFtKXJldHVybiBudWxsOwogY29uc3QgYXJyPXJhY2UucnVubmVycy5tYXAocj0+bVtyLm51bV0pO3JldHVybiBhcnIuZXZlcnkobz0+bz4xKT9hcnI6bnVsbDsKfQokKCJvZGRzR2V0Iikub25jbGljaz1hc3luYygpPT57CiBpZighV1JBQ0VTLmxlbmd0aClyZXR1cm47CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKSxkPVdEQVRFO09ERFM9e307CiBjb25zdCB2ZW51ZXM9Wy4uLm5ldyBTZXQoV1JBQ0VTLm1hcChyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pOwogbGV0IGRpYWdBbGw9W10sZXJyPSIiOwogJCgib2Rkc0dldCIpLmRpc2FibGVkPXRydWU7CiB0cnl7CiAgZm9yKGxldCBpPTA7aTx2ZW51ZXMubGVuZ3RoO2krKyl7CiAgICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1g44Kq44OD44K65Y+W5b6X5Lit4oCmICR7aSsxfS8ke3ZlbnVlcy5sZW5ndGh96ZaL5YKs5aC0YDsKICAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzP2RhdGU9JHtkfSZ2ZW51ZT0ke3ZlbnVlc1tpXX1gKTsKICAgIGZvcihjb25zdCByIG9mICh4LnJhY2VzfHxbXSkpT0REU1tgJHtTdHJpbmcoci52ZW51ZUNvZGUpLnBhZFN0YXJ0KDIsIjAiKX0tJHtyLnJhY2VOb31gXT1yLm9kZHM7CiAgICBpZighKHgucmFjZXN8fFtdKS5sZW5ndGgpZGlhZ0FsbC5wdXNoKC4uLih4LmRpYWdub3N0aWNzfHxbXSkuc2xpY2UoMCw2KSk7CiAgIH1jYXRjaChlKXtlcnI9ZS5tZXNzYWdlO2RpYWdBbGwucHVzaCh7dmVudWU6dmVudWVzW2ldLGVycm9yOmUubWVzc2FnZX0pfQogIH0KIH1maW5hbGx5eyQoIm9kZHNHZXQiKS5kaXNhYmxlZD1mYWxzZX0KIGNvbnN0IG49T2JqZWN0LmtleXMoT0REUykubGVuZ3RoOwogJCgid3N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6X77yP44Kq44OD44K6ICR7bn3jg6zjg7zjgrnliIZgKyhuPyIiOiJcbuOCquODg+OCuuOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn++8iOeZuuWjsuWJjeOAgeOBvuOBn+OBr+eUu+mdouani+mAoOOBrumBleOBhO+8ieOAgiIrKGVycj8iXG7nkIbnlLHvvJoiK2VycjoiIikrKGRpYWdBbGwubGVuZ3RoPyJcbuiouuaWre+8miIrSlNPTi5zdHJpbmdpZnkoZGlhZ0FsbCkuc2xpY2UoMCw3MDApOiIiKSk7CiByZW5kZXJWZW51ZUJ1dHRvbnMoZCk7Cn07CgooYXN5bmMoKT0+e3RyeXthd2FpdCBvcGVuREIoKTthd2FpdCBzaG93U3RhdGUoKTthd2FpdCBwYXlTdGF0ZSgpfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kv53lrZjpoJjln5/jgpLplovjgZHjgb7jgZvjgpPvvJoke2VzYyhlLm1lc3NhZ2UpfVxu77yI44OX44Op44Kk44OZ44O844OI44OW44Op44Km44K644Gn44Gv5L2/44GI44Gq44GE44GT44Go44GM44GC44KK44G+44GZ77yJPC9zcGFuPmB9fSkoKTsKaWYoL15odHRwcz86Ly50ZXN0KGxvY2F0aW9uLnByb3RvY29sKSkkKCJ3dXJsIikudmFsdWU9bG9jYXRpb24ub3JpZ2luOwpzaG93UGFuZSgiUGFzdCIpOwoKPC9zY3JpcHQ+CjwvYm9keT4KPC9odG1sPgo=";
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
