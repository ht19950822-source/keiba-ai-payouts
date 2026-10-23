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

async function discoverJRAEntryRacesForDate(date = null) {
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

  const allSeeds = [...seeds.values()];
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

      if (date == null || race.date === date) {
        matches.set(`${race.date}-${race.venueCode}-${race.raceNo}`, {
          ...race,
          entryInfo: extractJRAEntryInfo(html),
          htmlLength: html.length
        });
      }

      for (const link of links) {
        if (visited.has(link.cname) || queued.has(link.cname)) continue;
        if (date != null && link.date !== date) continue;
        if (queue.length >= maxPages) continue;
        queue.push(link);
        queued.add(link.cname);
      }
    } catch (error) {
      diagnostics.push({
        cname: race.cname,
        error: String(error?.message || error)
      });
      if (date == null || race.date === date) {
        matches.set(`${race.date}-${race.venueCode}-${race.raceNo}`, {
          ...race,
          entryInfo: { raceName: "", surface: "", distance: null, horses: [] },
          fetchError: String(error?.message || error)
        });
      }
    }
  }

  const result = [...matches.values()]
    .filter(race => date == null || race.date === date)
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

  if (result.length === 0) {
    const searchNote = date != null && sameDateSeeds.length === 0
      ? ` 指定日のリンクが入口ページにないため、先頭${Math.min(discoveryLimit, allSeeds.length)}件だけ追加探索しました。`
      : "";
    throw new Error(
      `JRA公式ページから${date || "次回開催"}の出馬表リンクを発見できませんでした。` +
      `JRAの出馬表公開状況、または公式ページのリンク構造を確認してください。` +
      searchNote +
      ` (seed=${seeds.size}, visited=${visited.size})`
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

async function handleRaceCards(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!isValidDateString(date)) {
    return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  }

  try {
    const races = await discoverJRAEntryRacesForDate(date);
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCxpbml0aWFsLXNjYWxlPTEsdmlld3BvcnQtZml0PWNvdmVyIj4KPHRpdGxlPuertummrEFJIHYxNi42PC90aXRsZT4KPHN0eWxlPgpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6I2YzZjVmNztjb2xvcjojMTcyMDJhO2ZvbnQtZmFtaWx5Oi1hcHBsZS1zeXN0ZW0sQmxpbmtNYWNTeXN0ZW1Gb250LCJTZWdvZSBVSSIsc2Fucy1zZXJpZn0KaGVhZGVye2JhY2tncm91bmQ6IzEwMTgyODtjb2xvcjojZmZmO3BhZGRpbmc6MTRweCAxNnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MjBweH0KbWFpbnttYXgtd2lkdGg6OTgwcHg7bWFyZ2luOmF1dG87cGFkZGluZzoxMnB4fQpzZWN0aW9ue2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxNHB4O21hcmdpbjoxMHB4IDA7Ym94LXNoYWRvdzowIDFweCA0cHggIzAwMDF9Cmgye2ZvbnQtc2l6ZToxN3B4O21hcmdpbjowIDAgOHB4fQpidXR0b257Ym9yZGVyOjA7Ym9yZGVyLXJhZGl1czo5cHg7cGFkZGluZzoxMXB4IDE0cHg7YmFja2dyb3VuZDojMTY2N2Q5O2NvbG9yOiNmZmY7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbjo0cHggNHB4IDRweCAwfQpidXR0b246ZGlzYWJsZWR7b3BhY2l0eTouNDV9CmlucHV0LHNlbGVjdHtwYWRkaW5nOjlweDtib3JkZXI6MXB4IHNvbGlkICNjY2QzZGM7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDojZmZmfQouc21hbGx7Zm9udC1zaXplOjEzcHg7Y29sb3I6IzVkNjg3NX0KLnN0YXR1c3twYWRkaW5nOjlweDtiYWNrZ3JvdW5kOiNmNmY4ZmE7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Ci5nb29ke2NvbG9yOiMxMzczMzM7Zm9udC13ZWlnaHQ6NzAwfS53YXJue2NvbG9yOiNhMTVjMDA7Zm9udC13ZWlnaHQ6NzAwfQp0YWJsZXt3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTNweH0KdGgsdGR7cGFkZGluZzo3cHggNHB4O2JvcmRlci1ib3R0b206MXB4IHNvbGlkICNlNWU3ZWI7dGV4dC1hbGlnbjpyaWdodH0KdGg6Zmlyc3QtY2hpbGQsdGQ6Zmlyc3QtY2hpbGQsdGg6bnRoLWNoaWxkKDIpLHRkOm50aC1jaGlsZCgyKXt0ZXh0LWFsaWduOmxlZnR9Ci5zY29yZXtmb250LXdlaWdodDo4MDA7Zm9udC1zaXplOjE2cHh9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6I2ZmZjg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6IzEwMTgyODtjb2xvcjojZmZmO3BhZGRpbmc6MThweDtib3JkZXItcmFkaXVzOjEycHg7bWF4LXdpZHRoOjgwJTt0ZXh0LWFsaWduOmNlbnRlcn0KPC9zdHlsZT4KPC9oZWFkPgo8Ym9keT4KPGhlYWRlcj7nq7bppqxBSSB2MTYuNjwvaGVhZGVyPgo8bWFpbj4KCjxzZWN0aW9uPgo8aDI+4pGgIOmBjuWOu+ODh+ODvOOCvzwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj4yMDE55bm05Lul6ZmN44CC44Kq44OD44K644O75Lq65rCX44GvQUnjg6Ljg4fjg6vlhaXlipvjgavkvb/nlKjjgZfjgb7jgZvjgpPjgILlj5blvpfjgZfjgZ9DU1bjga/nq6/mnKvlhoXjgavkv53lrZjjgZfjgb7jgZnjgII8L2Rpdj4KPGJ1dHRvbiBpZD0idXBkYXRlIj7pgY7ljrvjg4fjg7zjgr/jgpLlj5blvpfjg7vmm7TmlrA8L2J1dHRvbj4KPGJ1dHRvbiBpZD0icmVsb2FkIj7kv53lrZjjg4fjg7zjgr/jgpLlho3oqq3ovrw8L2J1dHRvbj4KPGRpdiBpZD0iZGF0YVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGhIOasoeWbnuODrOODvOOCuTwvaDI+CjxsYWJlbD7ml6Xku5jjgIA8aW5wdXQgaWQ9ImRhdGUiIHR5cGU9ImRhdGUiPjwvbGFiZWw+Cjxicj4KPGJ1dHRvbiBpZD0iZ2V0UmFjZXMiPumWi+WCrOODu+ODrOODvOOCueOCkuWPluW+lzwvYnV0dG9uPgo8ZGl2IGlkPSJyYWNlU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlj5blvpc8L2Rpdj4KPGRpdiBpZD0icmFjZUxpc3QiPjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoiDjg4fjg7zjgr/jga7jg5Djg4Pjgq/jgqLjg4Pjg5c8L2gyPgo8YnV0dG9uIGlkPSJiYWNrdXAiPuODkOODg+OCr+OCouODg+ODl+S/neWtmDwvYnV0dG9uPgo8ZGl2IGNsYXNzPSJzbWFsbCI+56uv5pyr5YaF44Gu6YGO5Y6744OH44O844K/44KSSlNPTuOBqOOBl+OBpuS/neWtmOOBl+OBvuOBmeOAgjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoyDjg4fjg7zjgr/nirbmhYs8L2gyPgo8ZGl2IGlkPSJzdGF0ZSIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGkIEFJ5LqI5oOzPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuWHuui1sOWJjeODh+ODvOOCv+OBruOBv+OBp+ioiOeul+OAgummrElEL+mmrOWQjeODu+mojuaJi0lEL+mojuaJi+WQjeOCkueFp+WQiOOBl+OAgeWvvuixoeODrOODvOOCueaXpeOCiOOCiuWJjeOBruWxpeattOOBoOOBkeOCkuWtpue/kuOBl+OBvuOBmeOAgjwvZGl2Pgo8YnV0dG9uIGlkPSJwcmVkaWN0IiBkaXNhYmxlZD5BSeS6iOaDs+OCkuWun+ihjDwvYnV0dG9uPgo8ZGl2IGlkPSJwcmVkaWN0aW9uIiBjbGFzcz0ic3RhdHVzIj7jg6zjg7zjgrnjgpLpgbjmip7jgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaUg5qSc6Ki8PC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuaZguezu+WIl+Wei+OBruaknOiovOapn+iDveOAguWkp+mHj+ODh+ODvOOCv+OBp+OBr+aZgumWk+OBjOOBi+OBi+OCi+OBn+OCgeOAgeW/heimgeaZguOBq+Wun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8YnV0dG9uIGlkPSJ2YWxpZGF0ZSIgZGlzYWJsZWQ+5qSc6Ki844KS5a6f6KGMPC9idXR0b24+CjxkaXYgaWQ9InZhbGlkYXRpb24iIGNsYXNzPSJzdGF0dXMiPumBjuWOu+ODh+ODvOOCv+WPluW+l+W+jOOBruODouODh+ODq+aknOiovOapn+iDveOBr+asoeautemajuOBp+i/veWKoOOBl+OBvuOBmeOAgjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRpiDjg6Ljg4fjg6vjga7jg6vjg7zjg6s8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+CuOCquODg+OCuuODu+S6uuawl+OCkkFJ5YWl5Yqb44Gr44GX44Gq44GE77yP5pyq5p2l44Gu57WQ5p6c44KS5a2m57+S44GX44Gq44GE77yP6aasSUTjg7vppqzlkI3jgIHpqI7miYtJROODu+mojuaJi+WQjeOCkueFp+WQiO+8j+WvvuixoeODrOODvOOCueaXpeOCiOOCiuWJjeOBruWxpeattOOBruOBv+S9v+eUqO+8j+mmrOWbuuacieWxpeattOOBjOS4jei2s+OBmeOCi+WgtOWQiOOBr+mojuaJi+ODu+OCs+ODvOOCueODu+i3nembouODu+mmrOWgtOetieOBuOODleOCqeODvOODq+ODkOODg+OCr+OAggo8L2Rpdj4KPC9zZWN0aW9uPgoKPC9tYWluPgo8ZGl2IGlkPSJidXN5Ij48ZGl2IGlkPSJidXN5VGV4dCI+5Yem55CG5Lit4oCmPC9kaXY+PC9kaXY+Cgo8c2NyaXB0PgoidXNlIHN0cmljdCI7Cgpjb25zdCBEQl9OQU1FPSJrZWliYV9haV9kYl92MTAiLCBEQl9WRVI9MTsKY29uc3QgVkVOVUVTPXsKICIwMSI6IjAxX3NhcHBvcm8iLCIwMiI6IjAyX2hha29kYXRlIiwiMDMiOiIwM19mdWt1c2hpbWEiLCIwNCI6IjA0X25paWdhdGEiLAogIjA1IjoiMDVfdG9reW8iLCIwNiI6IjA2X25ha2F5YW1hIiwiMDciOiIwN19jaHVreW8iLCIwOCI6IjA4X2t5b3RvIiwKICIwOSI6IjA5X2hhbnNoaW4iLCIxMCI6IjEwX2tva3VyYSIKfTsKY29uc3QgVkVOVUVfTkFNRVM9ewogIjAxIjoi5pyt5bmMIiwiMDIiOiLlh73ppKgiLCIwMyI6Iuemj+WztiIsIjA0Ijoi5paw5r2fIiwiMDUiOiLmnbHkuqwiLAogIjA2Ijoi5Lit5bGxIiwiMDciOiLkuK3kuqwiLCIwOCI6IuS6rOmDvSIsIjA5Ijoi6Ziq56WeIiwiMTAiOiLlsI/lgIkiCn07CmxldCBEQj1udWxsLEhJU1Q9bnVsbCxSQUNFUz1bXSxzZWxlY3RlZFJhY2U9bnVsbDsKbGV0IElEWD17aElkOm5ldyBNYXAoKSxoTmFtZTpuZXcgTWFwKCksaklkOm5ldyBNYXAoKSxqTmFtZTpuZXcgTWFwKCl9Owpjb25zdCAkPWlkPT5kb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7CgpmdW5jdGlvbiBidXN5KG9uLG1zZz0i5Yem55CG5Lit4oCmIil7CiAkKCJidXN5Iikuc3R5bGUuZGlzcGxheT1vbj8iZmxleCI6Im5vbmUiOwogJCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1tc2c7Cn0KZnVuY3Rpb24gc2xlZXAobXM9MCl7cmV0dXJuIG5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQocixtcykpO30KZnVuY3Rpb24gZXNjKHMpe3JldHVybiBTdHJpbmcocz8/IiIpLnJlcGxhY2UoL1smPD4iJ10vZyxtPT4oeyImIjoiJmFtcDsiLCI8IjoiJmx0OyIsIj4iOiImZ3Q7IiwnIic6IiZxdW90OyIsIiciOiImIzM5OyJ9W21dKSk7fQoKZnVuY3Rpb24gb3BlbkRCKCl7CiByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUscmVqZWN0KT0+ewogIGNvbnN0IHI9aW5kZXhlZERCLm9wZW4oREJfTkFNRSxEQl9WRVIpOwogIHIub251cGdyYWRlbmVlZGVkPWU9PnsKICAgY29uc3QgZGI9ZS50YXJnZXQucmVzdWx0OwogICBpZighZGIub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygiZmlsZXMiKSkgZGIuY3JlYXRlT2JqZWN0U3RvcmUoImZpbGVzIik7CiAgIGlmKCFkYi5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJtZXRhIikpIGRiLmNyZWF0ZU9iamVjdFN0b3JlKCJtZXRhIik7CiAgfTsKICByLm9uc3VjY2Vzcz0oKT0+e0RCPXIucmVzdWx0O3Jlc29sdmUoREIpfTsKICByLm9uZXJyb3I9KCk9PnJlamVjdChyLmVycm9yKTsKICByLm9uYmxvY2tlZD0oKT0+cmVqZWN0KG5ldyBFcnJvcigiSW5kZXhlZERC44GM5LuW44Gu44K/44OW44Gn5L2/55So5Lit44Gn44GZ44CCIikpOwogfSk7Cn0KZnVuY3Rpb24gYWxsKHN0b3JlKXsKIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSxyZWplY3QpPT57CiAgY29uc3QgdHg9REIudHJhbnNhY3Rpb24oc3RvcmUsInJlYWRvbmx5Iik7CiAgY29uc3QgcmVxPXR4Lm9iamVjdFN0b3JlKHN0b3JlKS5nZXRBbGwoKTsKICByZXEub25zdWNjZXNzPSgpPT5yZXNvbHZlKHJlcS5yZXN1bHR8fFtdKTsKICByZXEub25lcnJvcj0oKT0+cmVqZWN0KHJlcS5lcnJvcik7CiB9KTsKfQpmdW5jdGlvbiBwdXRGaWxlKGtleSx2YWx1ZSl7CiByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUscmVqZWN0KT0+ewogIGNvbnN0IHR4PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpOwogIHR4Lm9iamVjdFN0b3JlKCJmaWxlcyIpLnB1dCh2YWx1ZSxrZXkpOwogIHR4Lm9uY29tcGxldGU9cmVzb2x2ZTsKICB0eC5vbmVycm9yPSgpPT5yZWplY3QodHguZXJyb3IpOwogfSk7Cn0KZnVuY3Rpb24gZ2V0TWV0YShrZXkpewogcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLHJlamVjdCk9PnsKICBjb25zdCB0eD1EQi50cmFuc2FjdGlvbigibWV0YSIsInJlYWRvbmx5Iikscj10eC5vYmplY3RTdG9yZSgibWV0YSIpLmdldChrZXkpOwogIHIub25zdWNjZXNzPSgpPT5yZXNvbHZlKHIucmVzdWx0KTtyLm9uZXJyb3I9KCk9PnJlamVjdChyLmVycm9yKTsKIH0pOwp9CmZ1bmN0aW9uIHB1dE1ldGEoa2V5LHZhbHVlKXsKIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSxyZWplY3QpPT57CiAgY29uc3QgdHg9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTsKICB0eC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2YWx1ZSxrZXkpOwogIHR4Lm9uY29tcGxldGU9cmVzb2x2ZTt0eC5vbmVycm9yPSgpPT5yZWplY3QodHguZXJyb3IpOwogfSk7Cn0KCmZ1bmN0aW9uIG5vcm1Db2x1bW5OYW1lKHMpewogcmV0dXJuIFN0cmluZyhzPz8iIikucmVwbGFjZSgvXlx1RkVGRi8sIiIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1tcc19cLSgp77yI77yJXS9nLCIiKTsKfQpmdW5jdGlvbiBwaWNrKG8sa2V5cyl7CiBmb3IoY29uc3QgayBvZiBrZXlzKXsKICBpZihvJiZvW2tdIT09dW5kZWZpbmVkJiZvW2tdIT09bnVsbCYmU3RyaW5nKG9ba10pLnRyaW0oKSE9PSIiKXJldHVybiBTdHJpbmcob1trXSkudHJpbSgpOwogfQogLy8gQ1NW44Gu5YiX5ZCN44Gr56m655m944O744Ki44Oz44OA44O844K544Kz44Ki44O75aSn5bCP5paH5a2X44Gu6YGV44GE44GM44GC44Gj44Gm44KC54Wn5ZCI44GZ44KLCiBpZihvJiZ0eXBlb2Ygbz09PSJvYmplY3QiKXsKICBjb25zdCB3YW50ZWQ9bmV3IFNldChrZXlzLm1hcChub3JtQ29sdW1uTmFtZSkpOwogIGZvcihjb25zdCBbayx2XSBvZiBPYmplY3QuZW50cmllcyhvKSl7CiAgIGlmKHdhbnRlZC5oYXMobm9ybUNvbHVtbk5hbWUoaykpJiZ2IT09dW5kZWZpbmVkJiZ2IT09bnVsbCYmU3RyaW5nKHYpLnRyaW0oKSE9PSIiKXJldHVybiBTdHJpbmcodikudHJpbSgpOwogIH0KIH0KIHJldHVybiAiIjsKfQpmdW5jdGlvbiBudW0obyxrZXlzKXsKIGNvbnN0IHg9cGljayhvLGtleXMpLnJlcGxhY2UoLywvZywiIik7CiBjb25zdCBuPXBhcnNlRmxvYXQoeCk7cmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKT9uOm51bGw7Cn0KZnVuY3Rpb24gZGF0ZU9mKG8pewogbGV0IHM9cGljayhvLFsiZGF0ZSIsIuaXpeS7mCIsIumWi+WCrOaXpSIsInJhY2VfZGF0ZSIsIuW5tOaciOaXpSIsIumWi+WCrOW5tOaciOaXpSIsIumWi+WCrOaXpeS7mCIsIuaXpeS7mChZWVlZTU1ERCkiLCLlubTmnIjml6Xku5giLCJrYWlzYWlfZGF0ZSIsIumWi+WCrOW5tOaciOaXpShZWVlZTU1ERCkiXSk7CiBpZighcylyZXR1cm4gIiI7CiBzPXMudHJpbSgpLnJlcGxhY2UoL15bJyLigJzigJ1dK3xbJyLigJzigJ1dKyQvZywiIik7CiAvLyAyMDIwMDEwNeOAgTIwMjAtMDEtMDXjgIEyMDIwLzEvNeOAgTIwMjDlubQx5pyINeaXpeOAgeaXpeS7mOaZguWIu+S7mOOBjeOBruihqOiomOOBq+WvvuW/nAogbGV0IG09cy5tYXRjaCgvKD86XnxcRCkoXGR7NH0pXER7MCw0fShcZHsxLDJ9KVxEezAsNH0oXGR7MSwyfSkoPzpcRHwkKS8pOwogaWYoIW0pewogIGNvbnN0IGRpZ2l0cz1zLnJlcGxhY2UoL1xEL2csIiIpOwogIGlmKGRpZ2l0cy5sZW5ndGg+PTgpbT1bbnVsbCxkaWdpdHMuc2xpY2UoMCw0KSxkaWdpdHMuc2xpY2UoNCw2KSxkaWdpdHMuc2xpY2UoNiw4KV07CiB9CiBpZighbSlyZXR1cm4gIiI7CiBjb25zdCB5PU51bWJlcihtWzFdKSxtbz1OdW1iZXIobVsyXSksZD1OdW1iZXIobVszXSk7CiBpZih5PDE5MDB8fHk+MjEwMHx8bW88MXx8bW8+MTJ8fGQ8MXx8ZD4zMSlyZXR1cm4gIiI7CiByZXR1cm4gYCR7U3RyaW5nKHkpLnBhZFN0YXJ0KDQsIjAiKX0tJHtTdHJpbmcobW8pLnBhZFN0YXJ0KDIsIjAiKX0tJHtTdHJpbmcoZCkucGFkU3RhcnQoMiwiMCIpfWA7Cn0KZnVuY3Rpb24gbm9ybWFsaXplUm93KG8pewogcmV0dXJuIHsKICBkYXRlOmRhdGVPZihvKSxyYWNlSWQ6cGljayhvLFsicmFjZV9pZCIsInJhY2VJZCIsIuODrOODvOOCuUlEIiwiaWQiLCJVbm5hbWVkOiAwIiwiIiBdKSwKICBob3JzZUlkOnBpY2sobyxbImhvcnNlX2lkIiwiaG9yc2VJZCIsIummrElEIl0pLGhvcnNlOnBpY2sobyxbImhvcnNlIiwiaG9yc2VfbmFtZSIsIummrOWQjSIsIummrCJdKSwKICBqb2NrZXlJZDpwaWNrKG8sWyJqb2NrZXlfaWQiLCJqb2NrZXlJZCIsIumojuaJi0lEIl0pLGpvY2tleTpwaWNrKG8sWyJqb2NrZXkiLCJqb2NrZXlfbmFtZSIsIumojuaJiyJdKSwKICB0cmFpbmVyOnBpY2sobyxbInRyYWluZXIiLCJ0cmFpbmVyX25hbWUiLCLoqr/mlZnluKsiXSkscGxhY2U6cGljayhvLFsicGxhY2UiLCJ2ZW51ZSIsIuertummrOWgtCIsIumWi+WCrCJdKSwKICBkaXN0YW5jZTpudW0obyxbImRpc3RhbmNlIiwi6Led6ZuiIiwiY291cnNlX2xlbiIsIui3nemboihtKSJdKSxzdXJmYWNlOnBpY2sobyxbInN1cmZhY2UiLCLoip3jg4AiLCLjgrPjg7zjgrkiLCJyYWNlX3R5cGUiLCJyYWNlVHlwZSJdKSxnb2luZzpwaWNrKG8sWyJnb2luZyIsIummrOWgtCIsImdyb3VuZF9zdGF0ZSIsImdyb3VuZFN0YXRlIl0pLAogIGZpbmlzaDpudW0obyxbImZpbmlzaCIsIuedgOmghiIsIuedgCJdKSxmcmFtZTpudW0obyxbImZyYW1lIiwi5p6gIl0pLG51bWJlcjpudW0obyxbIm51bWJlciIsIummrOeVqiJdKSwKICBhZ2U6bnVtKG8sWyJhZ2UiLCLlubTpvaIiXSksc2V4OnBpY2sobyxbInNleCIsIuaApyJdKSx3ZWlnaHQ6bnVtKG8sWyJ3ZWlnaHQiLCLppqzkvZPph40iXSksCiAgb2RkczpudW0obyxbIm9kZHMiLCLjgqrjg4PjgroiXSkscG9wdWxhcml0eTpudW0obyxbInBvcHVsYXJpdHkiLCLkurrmsJciXSkKIH07Cn0KZnVuY3Rpb24gaGtleShyKXtyZXR1cm4gci5ob3JzZUlkP2BpZDoke3IuaG9yc2VJZH1gOihyLmhvcnNlP2BuYW1lOiR7ci5ob3JzZX1gOiIiKTt9CmZ1bmN0aW9uIGprZXkocil7cmV0dXJuIHIuam9ja2V5SWQ/YGlkOiR7ci5qb2NrZXlJZH1gOihyLmpvY2tleT9gbmFtZToke3Iuam9ja2V5fWA6IiIpO30KZnVuY3Rpb24gYnVpbGRJbmRleChyb3dzKXsKIElEWD17aElkOm5ldyBNYXAoKSxoTmFtZTpuZXcgTWFwKCksaklkOm5ldyBNYXAoKSxqTmFtZTpuZXcgTWFwKCl9OwogZm9yKGNvbnN0IHIgb2Ygcm93cyl7CiAgaWYoci5ob3JzZUlkJiZyLmhvcnNlKUlEWC5oSWQuc2V0KHIuaG9yc2VJZCxyLmhvcnNlKTsKICBpZihyLmhvcnNlKUlEWC5oTmFtZS5zZXQoci5ob3JzZSxyLmhvcnNlSWR8fCIiKTsKICBpZihyLmpvY2tleUlkJiZyLmpvY2tleSlJRFguaklkLnNldChyLmpvY2tleUlkLHIuam9ja2V5KTsKICBpZihyLmpvY2tleSlJRFguak5hbWUuc2V0KHIuam9ja2V5LHIuam9ja2V5SWR8fCIiKTsKIH0KfQpmdW5jdGlvbiByZXNvbHZlSG9yc2Uocil7CiBpZihyLmhvcnNlSWQpcmV0dXJuIGBpZDoke3IuaG9yc2VJZH1gOwogaWYoci5ob3JzZSYmSURYLmhOYW1lLmhhcyhyLmhvcnNlKSl7CiAgY29uc3QgaWQ9SURYLmhOYW1lLmdldChyLmhvcnNlKTtpZihpZClyZXR1cm4gYGlkOiR7aWR9YDsKIH0KIHJldHVybiByLmhvcnNlP2BuYW1lOiR7ci5ob3JzZX1gOiIiOwp9CmZ1bmN0aW9uIHJlc29sdmVKb2NrZXkocil7CiBpZihyLmpvY2tleUlkKXJldHVybiBgaWQ6JHtyLmpvY2tleUlkfWA7CiBpZihyLmpvY2tleSYmSURYLmpOYW1lLmhhcyhyLmpvY2tleSkpewogIGNvbnN0IGlkPUlEWC5qTmFtZS5nZXQoci5qb2NrZXkpO2lmKGlkKXJldHVybiBgaWQ6JHtpZH1gOwogfQogcmV0dXJuIHIuam9ja2V5P2BuYW1lOiR7ci5qb2NrZXl9YDoiIjsKfQoKCmZ1bmN0aW9uIGNzdlBhcnNlKHRleHQpewogY29uc3Qgcz1TdHJpbmcodGV4dHx8IiIpLnJlcGxhY2UoL15cdUZFRkYvLCIiKTsKIGNvbnN0IGxpbmVzPXMuc3BsaXQoL1xyP1xuLykuZmlsdGVyKHg9PngudHJpbSgpIT09IiIpOwogaWYoIWxpbmVzLmxlbmd0aClyZXR1cm4gW107CgogY29uc3QgZmlyc3Q9bGluZXNbMF07CiBjb25zdCB0YWJzPShmaXJzdC5tYXRjaCgvXHQvZyl8fFtdKS5sZW5ndGg7CiBjb25zdCBjb21tYXM9KGZpcnN0Lm1hdGNoKC8sL2cpfHxbXSkubGVuZ3RoOwogY29uc3QgZGVsaW1pdGVyPXRhYnM+Y29tbWFzPyJcdCI6IiwiOwoKIGZ1bmN0aW9uIHNwbGl0KGxpbmUpewogIGNvbnN0IGE9W107CiAgbGV0IGN1cj0iIixxPWZhbHNlOwoKICBmb3IobGV0IGk9MDtpPGxpbmUubGVuZ3RoO2krKyl7CiAgIGNvbnN0IGM9bGluZVtpXTsKCiAgIGlmKGM9PT0nIicpewogICAgaWYocSYmbGluZVtpKzFdPT09JyInKXsKICAgICBjdXIrPSciJzsKICAgICBpKys7CiAgICB9ZWxzZXsKICAgICBxPSFxOwogICAgfQogICB9ZWxzZSBpZihjPT09ZGVsaW1pdGVyJiYhcSl7CiAgICBhLnB1c2goY3VyKTsKICAgIGN1cj0iIjsKICAgfWVsc2V7CiAgICBjdXIrPWM7CiAgIH0KICB9CgogIGEucHVzaChjdXIpOwogIHJldHVybiBhOwogfQoKIGNvbnN0IGhlYWQ9c3BsaXQobGluZXNbMF0pLm1hcCh4PT54LnRyaW0oKSk7CiBjb25zdCBmaXJzdERhdGE9bGluZXMubGVuZ3RoPjE/c3BsaXQobGluZXNbMV0pOltdOwoKIC8vIEdpdEh1YueUseadpUNTVuOBp+OBr+OAgXJhY2VfaWTjgYxDU1bjga7jgqTjg7Pjg4fjg4Pjgq/jgrnliJfjgajjgZfjgabkv53lrZjjgZXjgozjgIEKIC8vIOODmOODg+ODgOODvOOBjOepuuashOOBvuOBn+OBryBVbm5hbWVkOiAwIOOBq+OBquOCi+OBk+OBqOOBjOOBguOCi+OAguWApOOBjDEy5qGB44Gu44Os44O844K5SUTjgarjgonliJflkI3jgpLoo5zmraPjgIIKIGlmKGhlYWQubGVuZ3RoICYmIGZpcnN0RGF0YS5sZW5ndGg9PT1oZWFkLmxlbmd0aCAmJgogICAgKCFoZWFkWzBdIHx8IC9edW5uYW1lZDo/XHMqMCQvaS50ZXN0KGhlYWRbMF0pKSAmJiAvXlxkezEyfSQvLnRlc3QoU3RyaW5nKGZpcnN0RGF0YVswXXx8IiIpLnRyaW0oKSkpewogIGhlYWRbMF09InJhY2VfaWQiOwogfQoKIC8vIOODh+ODvOOCv+OBruWFiOmgreOBjOODrOODvOOCuUlE44Gq44Gu44Gr44CB6KaL5Ye644GX44Gr44Gq44GE5aC05ZCI44Gv6KOc44GGCiBpZigKICBmaXJzdERhdGEubGVuZ3RoPT09aGVhZC5sZW5ndGgrMSAmJgogIC9eXGR7MTJ9JC8udGVzdChmaXJzdERhdGFbMF0pICYmCiAgIVsicmFjZV9pZCIsInJhY2VJZCIsIuODrOODvOOCuUlEIl0uaW5jbHVkZXMoaGVhZFswXSkKICl7CiAgaGVhZC51bnNoaWZ0KCJyYWNlX2lkIik7CiB9CgogY29uc3Qgb3V0PVtdOwoKIGZvcihsZXQgaT0xO2k8bGluZXMubGVuZ3RoO2krKyl7CiAgY29uc3QgYT1zcGxpdChsaW5lc1tpXSk7CiAgaWYoIWEubGVuZ3RoKWNvbnRpbnVlOwoKICBjb25zdCBvPXt9OwogIGZvcihsZXQgaj0wO2o8aGVhZC5sZW5ndGg7aisrKXsKICAgb1toZWFkW2pdXT1hW2pdPz8iIjsKICB9CiAgb3V0LnB1c2gobyk7CiB9CgogcmV0dXJuIG91dDsKfQoKZnVuY3Rpb24gcm93c0Zyb21WYWx1ZSh2KXsKIGlmKHY9PW51bGwpcmV0dXJuIFtdOwogaWYodHlwZW9mIHY9PT0ic3RyaW5nIil7CiAgdHJ5e2NvbnN0IGo9SlNPTi5wYXJzZSh2KTtyZXR1cm4gcm93c0Zyb21WYWx1ZShqKX1jYXRjaChfKXt9CiAgcmV0dXJuIGNzdlBhcnNlKHYpOwogfQogaWYoQXJyYXkuaXNBcnJheSh2KSlyZXR1cm4gdi5mbGF0TWFwKHJvd3NGcm9tVmFsdWUpOwogaWYodHlwZW9mIHY9PT0ib2JqZWN0Iil7CiAgaWYoQXJyYXkuaXNBcnJheSh2LnJvd3MpKXJldHVybiB2LnJvd3MuZmxhdE1hcChyb3dzRnJvbVZhbHVlKTsKICBpZihBcnJheS5pc0FycmF5KHYuZGF0YSkpcmV0dXJuIHYuZGF0YS5mbGF0TWFwKHJvd3NGcm9tVmFsdWUpOwogIGlmKHR5cGVvZiB2LmNzdj09PSJzdHJpbmciKXJldHVybiBjc3ZQYXJzZSh2LmNzdik7CiAgaWYodHlwZW9mIHYudGV4dD09PSJzdHJpbmciKXJldHVybiBjc3ZQYXJzZSh2LnRleHQpOwogIGlmKE9iamVjdC5rZXlzKHYpLmxlbmd0aClyZXR1cm4gW3ZdOwogfQogcmV0dXJuIFtdOwp9Cgphc3luYyBmdW5jdGlvbiBmYXN0U3RhdGUoKXsKIGNvbnN0IGZpbGVzPWF3YWl0IGFsbCgiZmlsZXMiKTsKIGxldCByb3dzPTAsbWluRGF0ZT0iIixtYXhEYXRlPSIiOwogY29uc3QgcmFjZVNldD1uZXcgU2V0KCksaG9yc2VTZXQ9bmV3IFNldCgpOwogZm9yKGNvbnN0IGYgb2YgZmlsZXMpewogIGNvbnN0IHJzPXJvd3NGcm9tVmFsdWUoZik7CiAgZm9yKGNvbnN0IG8gb2YgcnMpewogICByb3dzKys7CiAgIGNvbnN0IGQ9ZGF0ZU9mKG8pOwogICBpZihkJiYoIW1pbkRhdGV8fGQ8bWluRGF0ZSkpbWluRGF0ZT1kOwogICBpZihkJiYoIW1heERhdGV8fGQ+bWF4RGF0ZSkpbWF4RGF0ZT1kOwogICBjb25zdCByaWQ9cGljayhvLFsicmFjZV9pZCIsInJhY2VJZCIsIuODrOODvOOCuUlEIiwiVW5uYW1lZDogMCIsIiJdKTsKICAgY29uc3QgaG49cGljayhvLFsiaG9yc2VfaWQiLCJob3JzZUlkIiwi6aasSUQiXSl8fHBpY2sobyxbImhvcnNlIiwiaG9yc2VfbmFtZSIsIummrOWQjSIsIummrOWQjSJdKTsKICAgaWYocmlkKXJhY2VTZXQuYWRkKHJpZCk7CiAgIGlmKGhuKWhvcnNlU2V0LmFkZChobik7CiAgfQogIGF3YWl0IHNsZWVwKDApOwogfQogY29uc3Qgc3VtbWFyeT17cm93cyxyYWNlczpyYWNlU2V0LnNpemUsaG9yc2VzOmhvcnNlU2V0LnNpemUsbWluRGF0ZSxtYXhEYXRlLHVwZGF0ZWRBdDpEYXRlLm5vdygpfTsKIGF3YWl0IHB1dE1ldGEoInN1bW1hcnkiLHN1bW1hcnkpOwogJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Imdvb2QiPuS/neWtmOa4iOOBv+ODh+ODvOOCv++8miR7cm93cy50b0xvY2FsZVN0cmluZygpfeihjDwvc3Bhbj5gOwogJCgic3RhdGUiKS50ZXh0Q29udGVudD0KICBg57WQ5p6c6KGM5pWw77yaJHtyb3dzLnRvTG9jYWxlU3RyaW5nKCl96KGMXG5gKwogIGDjg6zjg7zjgrnmlbDvvJoke3JhY2VTZXQuc2l6ZSA/IHJhY2VTZXQuc2l6ZS50b0xvY2FsZVN0cmluZygpIDogIuODrOODvOOCuUlE5YiX44Gq44GX77yI6ZuG6KiI5LiN5Y+v77yJIn1cbmArCiAgYOmmrOaVsO+8miR7aG9yc2VTZXQuc2l6ZS50b0xvY2FsZVN0cmluZygpfVxuYCsKICBg5pyf6ZaT77yaJHttaW5EYXRlfHwiLSJ9IO+9niAke21heERhdGV8fCItIn1gOwogcmV0dXJuIHN1bW1hcnk7Cn0KCi8qIOOBk+OBk+OBjHYxNi4x44Gn5qyg44GR44Gm44GE44Gf5a6f6Zqb44Gu6YGO5Y6744OH44O844K/5Y+W5b6X5Yem55CGICovCgphc3luYyBmdW5jdGlvbiB1cGRhdGVEYXRhKCl7CiBpZighREIpYXdhaXQgb3BlbkRCKCk7CgogaWYoIWNvbmZpcm0oCiAgIkNsb3VkZmxhcmXjgavkv53lrZjmuIjjgb/jga7pgY7ljrvjg4fjg7zjgr/jgpJpUGhvbmXjgbjlj5bjgorovrzjgb/jgb7jgZnjgIJcblxuIisKICAi5pei5a2Y44Gu5L+d5a2Y44OH44O844K/44Gv5YmK6Zmk44GX44G+44Gb44KT44CCXG4iKwogICLlrozkuobjgb7jgafmmYLplpPjgYzjgYvjgYvjgovloLTlkIjjgYzjgYLjgorjgb7jgZnjgIJcblxuIisKICAi6ZaL5aeL44GX44G+44GZ44GL77yfIgogKSlyZXR1cm47CgogY29uc3QgV09SS0VSPSJodHRwczovL2tlaWJhLWFpLmh0MTk5NTA4MjIud29ya2Vycy5kZXYiOwogY29uc3QgeWVhcnM9W107CiBmb3IobGV0IHk9MjAxOTt5PD1uZXcgRGF0ZSgpLmdldEZ1bGxZZWFyKCk7eSsrKXllYXJzLnB1c2goeSk7CgogY29uc3QgdmVudWVzPU9iamVjdC5rZXlzKFZFTlVFUyk7CiBsZXQgZmlsZU9LPTAsZmlsZUZhaWw9MCxza2lwcGVkPTA7CiBjb25zdCBlcnJvcnM9W107CgogJCgidXBkYXRlIikuZGlzYWJsZWQ9dHJ1ZTsKICQoInJlbG9hZCIpLmRpc2FibGVkPXRydWU7CiBidXN5KHRydWUsIkNsb3VkZmxhcmXjga7pgY7ljrvjg4fjg7zjgr/jgpLnorroqo3jgZfjgabjgYTjgb7jgZnigKYiKTsKCiB0cnl7CiAgY29uc3QgdG90YWw9eWVhcnMubGVuZ3RoKnZlbnVlcy5sZW5ndGg7CiAgbGV0IGRvbmU9MDsKCiAgZm9yKGNvbnN0IHkgb2YgeWVhcnMpewogICBmb3IoY29uc3QgY29kZSBvZiB2ZW51ZXMpewogICAgZG9uZSsrOwoKICAgICQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9CiAgICAgYGlQaG9uZeOBuOmBjuWOu+ODh+ODvOOCv+S/neWtmOS4reKAplxuXG5gKwogICAgIGAke3l95bm0ICR7VkVOVUVfTkFNRVNbY29kZV19XG4ke2RvbmV9LyR7dG90YWx9YDsKCiAgICAkKCJkYXRhU3RhdHVzIikudGV4dENvbnRlbnQ9CiAgICAgYOWPluW+l+ODu+S/neWtmOS4re+8miR7eX3lubQgJHtWRU5VRV9OQU1FU1tjb2RlXX1cbmArCiAgICAgYOmAsuaNl++8miR7ZG9uZX0vJHt0b3RhbH1gOwoKICAgIHRyeXsKICAgICBjb25zdCB1cmw9CiAgICAgIGAke1dPUktFUn0vcmFjZS1yZXN1bHRzP3llYXI9JHt5fSZwbGFjZT0ke2VuY29kZVVSSUNvbXBvbmVudChjb2RlKX1gOwoKICAgICBjb25zdCByPWF3YWl0IGZldGNoKHVybCx7Y2FjaGU6Im5vLXN0b3JlIn0pOwogICAgIGlmKCFyLm9rKXRocm93IG5ldyBFcnJvcihgSFRUUCAke3Iuc3RhdHVzfWApOwoKICAgICBjb25zdCBjc3Y9YXdhaXQgci50ZXh0KCk7CiAgICAgY29uc3QgcGFyc2VkPWNzdlBhcnNlKGNzdik7CgogICAgIGlmKCFwYXJzZWQubGVuZ3RoKXsKICAgICAgc2tpcHBlZCsrOwogICAgICBjb250aW51ZTsKICAgICB9CgogICAgIGF3YWl0IHB1dEZpbGUoYHJhY2UtcmVzdWx0czoke3l9OiR7Y29kZX1gLHsKICAgICAgdHlwZToicmFjZS1yZXN1bHRzIiwKICAgICAgeWVhcjp5LAogICAgICBwbGFjZTpjb2RlLAogICAgICBwbGFjZU5hbWU6VkVOVUVfTkFNRVNbY29kZV0sCiAgICAgIGNzdgogICAgIH0pOwoKICAgICBmaWxlT0srKzsKICAgIH1jYXRjaChlKXsKICAgICBmaWxlRmFpbCsrOwogICAgIGVycm9ycy5wdXNoKAogICAgICBgJHt5feW5tCR7VkVOVUVfTkFNRVNbY29kZV1977yaJHtlPy5tZXNzYWdlfHxTdHJpbmcoZSl9YAogICAgICk7CiAgICB9CgogICAgYXdhaXQgc2xlZXAoMjApOwogICB9CiAgfQoKICBISVNUPW51bGw7CiAgY29uc3Qgcz1hd2FpdCBmYXN0U3RhdGUoKTsKCiAgYXdhaXQgcHV0TWV0YSgiZG93bmxvYWRTdGF0dXMiLHsKICAgZmlsZURvbmU6dG90YWwsCiAgIGZpbGVPSywKICAgZmlsZUZhaWwsCiAgIHNraXBwZWQsCiAgIGVycm9ycywKICAgdXBkYXRlZEF0OkRhdGUubm93KCkKICB9KTsKCiAgbGV0IG1zZz0KICAgYGlQaG9uZeOBuOOBruWPluOCiui+vOOBv+WujOS6hlxuXG5gKwogICBg5L+d5a2Y5oiQ5Yqf77yaJHtmaWxlT0t944OV44Kh44Kk44OrXG5gKwogICBg56m644OH44O844K/77yaJHtza2lwcGVkfeODleOCoeOCpOODq1xuYCsKICAgYOWPluW+l+WkseaVl++8miR7ZmlsZUZhaWx944OV44Kh44Kk44OrXG5gKwogICBg5L+d5a2Y44OH44O844K/77yaJHtzLnJvd3MudG9Mb2NhbGVTdHJpbmcoKX3ooYxgOwoKICBpZihlcnJvcnMubGVuZ3RoKXsKICAgbXNnKz0iXG5cbuWkseaVl+WGheWuue+8mlxuIitlcnJvcnMuc2xpY2UoMCwxNSkuam9pbigiXG4iKTsKICAgaWYoZXJyb3JzLmxlbmd0aD4xNSltc2crPWBcbuOBu+OBiyR7ZXJyb3JzLmxlbmd0aC0xNX3ku7ZgOwogIH0KCiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD0KICAgYDxzcGFuIGNsYXNzPSIke2ZpbGVGYWlsPyJ3YXJuIjoiZ29vZCJ9Ij4ke2VzYyhtc2cpfTwvc3Bhbj5gOwoKIH1jYXRjaChlKXsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPQogICBgPHNwYW4gY2xhc3M9Indhcm4iPuWPluOCiui+vOOBv+OCqOODqeODvO+8miR7ZXNjKGU/Lm1lc3NhZ2V8fFN0cmluZyhlKSl9PC9zcGFuPmA7CiB9ZmluYWxseXsKICAkKCJ1cGRhdGUiKS5kaXNhYmxlZD1mYWxzZTsKICAkKCJyZWxvYWQiKS5kaXNhYmxlZD1mYWxzZTsKICBidXN5KGZhbHNlKTsKIH0KfQoKZnVuY3Rpb24gZW1wdHlTdGF0KCl7cmV0dXJuIHtuOjAscDowLHAyOjAscDM6MCx0b3AzOjAsZmluaXNoOjAsbGFzdDoiIn07fQpmdW5jdGlvbiBhZGRTdGF0KG0sayxyKXsKIGlmKCFrKXJldHVybjsKIGxldCB4PW0uZ2V0KGspO2lmKCF4KXt4PWVtcHR5U3RhdCgpO20uc2V0KGsseCl9CiB4Lm4rKztpZihyLmZpbmlzaD09PTEpeC5wKys7aWYoci5maW5pc2g9PT0yKXgucDIrKztpZihyLmZpbmlzaD09PTMpeC5wMysrOwogaWYoci5maW5pc2g+PTEmJnIuZmluaXNoPD0zKXgudG9wMysrO2lmKHIuZmluaXNoKXguZmluaXNoKz1yLmZpbmlzaDsKIGlmKHIuZGF0ZT54Lmxhc3QpeC5sYXN0PXIuZGF0ZTsKfQphc3luYyBmdW5jdGlvbiBsb2FkSGlzdG9yeUZvclByZWRpY3Rpb24odGFyZ2V0RGF0ZSl7CiBpZihISVNUKXJldHVybiBISVNUOwogYnVzeSh0cnVlLCLpgY7ljrvjg4fjg7zjgr/jgpJBSeS6iOaDs+eUqOOBq+iqreOBv+i+vOOCk+OBp+OBhOOBvuOBmeKAplxu44OV44Kh44Kk44Or5Y2Y5L2N44Gn5bCR44GX44Ga44Gk5Yem55CG44GX44G+44GZ44CCIik7CiBhd2FpdCBzbGVlcCgyMCk7CiBjb25zdCBmaWxlcz1hd2FpdCBhbGwoImZpbGVzIik7CiBsZXQgc2Nhbm5lZD0wLHVzYWJsZT0wOwogLy8gMeWbnuebru+8mklE44Go6aas5ZCN44O76aiO5omL5ZCN44Gu5a++5b+c6KGo44Gg44GR44KS5L2c44KL44CC5YWo6KGM44KS44Oh44Oi44Oq44Gr44Gf44KB44Gq44GE44CCCiBmb3IobGV0IGZpPTA7Zmk8ZmlsZXMubGVuZ3RoO2ZpKyspewogIGNvbnN0IHJvd3M9cm93c0Zyb21WYWx1ZShmaWxlc1tmaV0pOwogIGZvcihsZXQgaT0wO2k8cm93cy5sZW5ndGg7aSsrKXsKICAgY29uc3Qgcj1ub3JtYWxpemVSb3cocm93c1tpXSk7CiAgIGlmKHIuaG9yc2VJZCYmci5ob3JzZSlJRFguaElkLnNldChyLmhvcnNlSWQsci5ob3JzZSk7CiAgIGlmKHIuaG9yc2UpSURYLmhOYW1lLnNldChyLmhvcnNlLHIuaG9yc2VJZHx8IiIpOwogICBpZihyLmpvY2tleUlkJiZyLmpvY2tleSlJRFguaklkLnNldChyLmpvY2tleUlkLHIuam9ja2V5KTsKICAgaWYoci5qb2NrZXkpSURYLmpOYW1lLnNldChyLmpvY2tleSxyLmpvY2tleUlkfHwiIik7CiAgfQogIHNjYW5uZWQrPXJvd3MubGVuZ3RoOwogICQoImRhdGFTdGF0dXMiKS50ZXh0Q29udGVudD1gQUnnlKjlsaXmrbTjgpLnorroqo3kuK3igKYgJHtzY2FubmVkLnRvTG9jYWxlU3RyaW5nKCl96KGMIC8g44OV44Kh44Kk44OrICR7ZmkrMX0vJHtmaWxlcy5sZW5ndGh9YDsKICByb3dzLmxlbmd0aD0wOwogIGF3YWl0IHNsZWVwKDApOwogfQogY29uc3QgaHM9bmV3IE1hcCgpLGpzPW5ldyBNYXAoKTtzY2FubmVkPTA7CiAvLyAy5Zue55uu77ya5a++6LGh5pel44KI44KK5YmN44Gu6KGM44Gg44GR44KS57Wx6KiI44G455u05o6l6ZuG6KiI44CC5YWo5bGl5q206YWN5YiX44KS5L2c44KJ44Gq44GE44CCCiBmb3IobGV0IGZpPTA7Zmk8ZmlsZXMubGVuZ3RoO2ZpKyspewogIGNvbnN0IHJvd3M9cm93c0Zyb21WYWx1ZShmaWxlc1tmaV0pOwogIGZvcihsZXQgaT0wO2k8cm93cy5sZW5ndGg7aSsrKXsKICAgY29uc3Qgcj1ub3JtYWxpemVSb3cocm93c1tpXSk7c2Nhbm5lZCsrOwogICBpZighci5kYXRlfHxyLmRhdGU+PXRhcmdldERhdGUpY29udGludWU7CiAgIHVzYWJsZSsrOwogICBhZGRTdGF0KGhzLHJlc29sdmVIb3JzZShyKSxyKTsKICAgYWRkU3RhdChqcyxyZXNvbHZlSm9ja2V5KHIpLHIpOwogIH0KICAkKCJkYXRhU3RhdHVzIikudGV4dENvbnRlbnQ9YEFJ55So5bGl5q2044KS6ZuG6KiI5Lit4oCmICR7c2Nhbm5lZC50b0xvY2FsZVN0cmluZygpfeihjCAvIOODleOCoeOCpOODqyAke2ZpKzF9LyR7ZmlsZXMubGVuZ3RofWA7CiAgcm93cy5sZW5ndGg9MDsKICBhd2FpdCBzbGVlcCgwKTsKIH0KIGNvbnN0IG1ldGE9YXdhaXQgZ2V0TWV0YSgic3VtbWFyeSIpOwogJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Imdvb2QiPuS/neWtmOa4iOOBv+ODh+ODvOOCv++8miR7KG1ldGE/LnJvd3N8fHNjYW5uZWQpLnRvTG9jYWxlU3RyaW5nKCl96KGMPC9zcGFuPmA7CiBISVNUPXtocyxqcyxjb3VudDp1c2FibGV9OwogYnVzeShmYWxzZSk7cmV0dXJuIEhJU1Q7Cn0KZnVuY3Rpb24gc3RhdHMocm93cyxrZXlGbil7CiBjb25zdCBtPW5ldyBNYXAoKTsKIGZvcihjb25zdCByIG9mIHJvd3MpewogIGNvbnN0IGs9a2V5Rm4ocik7aWYoIWspY29udGludWU7CiAgbGV0IHg9bS5nZXQoayk7CiAgaWYoIXgpbS5zZXQoayx4PXtuOjAscDowLHAyOjAscDM6MCx0b3AzOjAsZmluaXNoOjAsbGFzdDoiIn0pOwogIHgubisrO2lmKHIuZmluaXNoPT09MSl4LnArKztpZihyLmZpbmlzaD09PTIpeC5wMisrO2lmKHIuZmluaXNoPT09Myl4LnAzKys7CiAgaWYoci5maW5pc2g+PTEmJnIuZmluaXNoPD0zKXgudG9wMysrO2lmKHIuZmluaXNoKXguZmluaXNoKz1yLmZpbmlzaDsKICBpZihyLmRhdGU+eC5sYXN0KXgubGFzdD1yLmRhdGU7CiB9CiByZXR1cm4gbTsKfQpmdW5jdGlvbiBjbGFtcCh4LGEsYil7cmV0dXJuIE1hdGgubWF4KGEsTWF0aC5taW4oYix4KSl9CmZ1bmN0aW9uIHNpZ21vaWQoeCl7cmV0dXJuIDEvKDErTWF0aC5leHAoLXgpKX0KZnVuY3Rpb24gc2NvcmVGcm9tUHJvYmFiaWxpdHkocCl7cmV0dXJuIE1hdGgucm91bmQoY2xhbXAoMzArNzAqc2lnbW9pZCgocC0uMTApKjcpLDMwLDk3KSl9CmZ1bmN0aW9uIGxheW9mZihsYXN0LHRhcmdldCl7CiBpZighbGFzdClyZXR1cm4gLjU7CiBjb25zdCBhPShuZXcgRGF0ZSh0YXJnZXQpLW5ldyBEYXRlKGxhc3QpKS84NjQwMDAwMDsKIGlmKGE8MjEpcmV0dXJuIC43MjtpZihhPDYwKXJldHVybiAuNjI7aWYoYTwxMjApcmV0dXJuIC41NTtpZihhPDI0MClyZXR1cm4gLjQ4O3JldHVybiAuNDI7Cn0KZnVuY3Rpb24gcmF3U3RyZW5ndGgocixocyxqcyx0YXJnZXQpewogY29uc3QgaGs9cmVzb2x2ZUhvcnNlKHIpLGprPXJlc29sdmVKb2NrZXkociksaD1ocy5nZXQoaGspLGo9anMuZ2V0KGprKTtsZXQgeD0wOwogaWYoaCYmaC5uPj0yKXsKICB4Kz0xLjE1KigoaC5wL2gubiktLjEwKTt4Kz0uNzIqKChoLnRvcDMvaC5uKS0uMzApOwogIHgrPS4yNSooLjUtY2xhbXAoKGguZmluaXNoL2gubi02KS8xMCwwLDEpKTt4Kz0uMTAqKGxheW9mZihoLmxhc3QsdGFyZ2V0KS0uNSk7CiB9ZWxzZXsKICBpZihqJiZqLm4+PTUpeCs9LjY1Kigoai50b3AzL2oubiktLjMwKTsKICB4Kz0uMTAqKGxheW9mZihoPy5sYXN0LHRhcmdldCktLjUpOwogfQogY29uc3QgYWdlPXIuYWdlfHw1O2lmKGFnZT09PTMpeCs9LjAyNTtpZihhZ2U9PT00KXgrPS4wMTI7aWYoYWdlPj04KXgtPS4wMjU7CiBpZihyLmZyYW1lKXgrPSgoci5mcmFtZS00LjUpLzIwKSouMDE1O3JldHVybiB4Owp9CmZ1bmN0aW9uIHByb2JzKHNjb3Jlcyl7CiBjb25zdCBzPXNjb3Jlcy5tYXAoeD0+TWF0aC5leHAoeCkpLFQ9cy5yZWR1Y2UoKGEsYik9PmErYiwwKTsKIGNvbnN0IHAxPXMubWFwKHg9PngvVCk7CiBjb25zdCBwMj1zLm1hcCgoXyxpKT0+e2xldCB6PTA7Zm9yKGxldCBqPTA7ajxzLmxlbmd0aDtqKyspaWYoaiE9PWkpeis9c1tqXS9UKnNbaV0vKFQtc1tqXSk7cmV0dXJuIHp9KTsKIGNvbnN0IHAzPXMubWFwKChfLGkpPT57bGV0IHo9MDtmb3IobGV0IGo9MDtqPHMubGVuZ3RoO2orKylpZihqIT09aSlmb3IobGV0IGs9MDtrPHMubGVuZ3RoO2srKylpZihrIT09aSYmayE9PWopeis9c1tqXS9UKnNba10vKFQtc1tqXSkqc1tpXS8oVC1zW2pdLXNba10pO3JldHVybiB6fSk7CiByZXR1cm4ge3AxLHAyLHAzfTsKfQpmdW5jdGlvbiBwYWNlUHJlZGljdGlvbihydW5uZXJzKXsKIGNvbnN0IGxlYWQ9cnVubmVycy5maWx0ZXIocj0+ci5zdHlsZT09PSLpgIPjgZIifHxyLnN0eWxlPT09IuWFiOihjCIpOwogaWYobGVhZC5sZW5ndGg+PTQpcmV0dXJuWyLjg4/jgqQiLCLlhYjooYzli6Ljga7mlbDjgYzlpJrjgY/jgIHliY3ljYrjgYzmtYHjgozjgoTjgZnjgYQiXTsKIGlmKGxlYWQubGVuZ3RoPD0xKXJldHVyblsi44K544Ot44O8Iiwi6YCD44GS44O75YWI6KGM5YCZ6KOc44GM5bCR44Gq44GP44CB6ZqK5YiX44GM6JC944Gh552A44GN44KE44GZ44GEIl07CiByZXR1cm5bIuODn+ODieODqyIsIumAg+OBkuODu+WFiOihjOWLouOBjOmBqeW6puOBq+aPg+OBhuaomea6lueahOOBqua1geOCjCJdOwp9CmZ1bmN0aW9uIHN0eWxlT2Yocil7CiBjb25zdCBzPXBpY2socixbIuiEmuizqiIsInN0eWxlIiwicnVubmluZ19zdHlsZSJdKTtpZihzKXJldHVybiBzOwogY29uc3Qgbj1udW0ocixbIumAg+OBkuaMh+aVsCIsImZyb250X2luZGV4Il0pOwogcmV0dXJuIG4hPW51bGw/KG4+PS43PyLpgIPjgZIiOm4+PS40NT8i5YWI6KGMIjpuPj0uMj8i5beu44GXIjoi6L+96L68Iik6IiI7Cn0KYXN5bmMgZnVuY3Rpb24gYW5hbHl6ZVJhY2UocmFjZSl7CiBjb25zdCBoaXN0PWF3YWl0IGxvYWRIaXN0b3J5Rm9yUHJlZGljdGlvbihyYWNlLmRhdGUpLGhzPWhpc3QuaHMsanM9aGlzdC5qczsKIGNvbnN0IHJ1bm5lcnM9cmFjZS5ydW5uZXJzfHxbXSxlbnJpY2hlZD1ydW5uZXJzLm1hcChyPT4oey4uLnIsc3R5bGU6c3R5bGVPZihyKX0pKSxzdHJlbmd0aD1lbnJpY2hlZC5tYXAocj0+cmF3U3RyZW5ndGgocixocyxqcyxyYWNlLmRhdGUpKTsKIGNvbnN0IHBwPXByb2JzKHN0cmVuZ3RoKSxwYWNlPXBhY2VQcmVkaWN0aW9uKGVucmljaGVkKTsKIGxldCBtYXhMZWFkPS0xLGxlYWRIb3JzZT1udWxsOwogZW5yaWNoZWQuZm9yRWFjaCgocixpKT0+e2lmKChyLnN0eWxlPT09IumAg+OBkiJ8fHIuc3R5bGU9PT0i5YWI6KGMIikmJnN0cmVuZ3RoW2ldPm1heExlYWQpe21heExlYWQ9c3RyZW5ndGhbaV07bGVhZEhvcnNlPXJ9fSk7CiByZXR1cm57ZW5yaWNoZWQsc3RyZW5ndGgscHAscGFjZSxsZWFkSG9yc2UsdHJhaW5Db3VudDpoaXN0LmNvdW50fTsKfQpmdW5jdGlvbiByZW5kZXJQcmVkaWN0aW9uKHJlc3VsdCl7CiBjb25zdHtlbnJpY2hlZCxwcCxwYWNlLGxlYWRIb3JzZSx0cmFpbkNvdW50fT1yZXN1bHQ7CiBpZighQXJyYXkuaXNBcnJheShlbnJpY2hlZCl8fGVucmljaGVkLmxlbmd0aD09PTApewogICQoInByZWRpY3Rpb24iKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7lh7rotbDppqzjgpLlj5blvpfjgafjgY3jgabjgYTjgb7jgZvjgpPjgILplovlgqzml6XjgpLpgbjjgbPnm7TjgZfjgIHplovlgqzihpLjg6zjg7zjgrnjgpLlho3pgbjmip7jgZfjgabjgY/jgaDjgZXjgYTjgILmlLnlloTjgZfjgarjgYTloLTlkIjjga/lh7rppqzooajlj5blvpflgbTjga7jg4fjg7zjgr/lvaLlvI/jgpLnorroqo3jgZnjgovlv4XopoHjgYzjgYLjgorjgb7jgZnjgII8L3NwYW4+JzsKICByZXR1cm47CiB9CiBjb25zdCByb3dzPWVucmljaGVkLm1hcCgocixpKT0+KHtubzpyLm51bWJlcnx8ci5ob3JzZU51bWJlcnx8ci7ppqznlap8fGkrMSxuYW1lOnIuaG9yc2V8fHIuaG9yc2VfbmFtZXx8ci5ob3JzZU5hbWV8fHIubmFtZXx8ci7ppqzlkI18fCLlkI3np7DkuI3mmI4iLAogc2NvcmU6c2NvcmVGcm9tUHJvYmFiaWxpdHkocHAucDFbaV0pLHAxOnBwLnAxW2ldKjEwMCxwMjpwcC5wMltpXSoxMDAscDM6cHAucDNbaV0qMTAwLHRvcDoocHAucDFbaV0rcHAucDJbaV0rcHAucDNbaV0pKjEwMAogfSkpLnNvcnQoKGEsYik9PmIudG9wLWEudG9wKTsKIGxldCBoPWDmg7Plrprjg5rjg7zjgrnvvJo8Yj4ke3BhY2VbMF19PC9iPu+8iCR7cGFjZVsxXX3vvIk8YnI+YDsKIGgrPWDpgIPjgZLppqzkuojmg7PvvJo8Yj4ke2VzYyhsZWFkSG9yc2U/LmhvcnNlfHxsZWFkSG9yc2U/LmhvcnNlX25hbWV8fCLoqbLlvZPppqzjgarjgZciKX08L2I+PGJyPmA7CiBoKz1g5a2m57+S44OH44O844K/77yaJHt0cmFpbkNvdW50LnRvTG9jYWxlU3RyaW5nKCl96KGMPGJyPjxicj5gOwogaCs9YDx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqznlao8L3RoPjx0aD7ppqzlkI08L3RoPjx0aD7ngrnmlbA8L3RoPjx0aD4x552A546HPC90aD48dGg+MuedgOeOhzwvdGg+PHRoPjPnnYDnjoc8L3RoPjx0aD4z552A5YaF546HPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgeCBvZiByb3dzKWgrPWA8dHI+PHRkPiR7ZXNjKHgubm8pfTwvdGQ+PHRkPiR7ZXNjKHgubmFtZSl9PC90ZD48dGQgY2xhc3M9InNjb3JlIj4ke3guc2NvcmV9PC90ZD48dGQ+JHt4LnAxLnRvRml4ZWQoMil9JTwvdGQ+PHRkPiR7eC5wMi50b0ZpeGVkKDIpfSU8L3RkPjx0ZD4ke3gucDMudG9GaXhlZCgyKX0lPC90ZD48dGQ+PGI+JHt4LnRvcC50b0ZpeGVkKDIpfSU8L2I+PC90ZD48L3RyPmA7CiBoKz1gPC90Ym9keT48L3RhYmxlPmA7JCgicHJlZGljdGlvbiIpLmlubmVySFRNTD1oOwp9CmFzeW5jIGZ1bmN0aW9uIGZldGNoSlNPTih1cmwpe2NvbnN0IHI9YXdhaXQgZmV0Y2godXJsKTtpZighci5vayl0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyLnN0YXR1c31gKTtyZXR1cm4gYXdhaXQgci5qc29uKCl9CmFzeW5jIGZ1bmN0aW9uIGdldFJhY2VDYXJkcygpewogY29uc3QgZD0kKCJkYXRlIikudmFsdWU7CiBpZighZClyZXR1cm4gYWxlcnQoIuaXpeS7mOOCkumBuOaKnuOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwoKICQoInJhY2VTdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5YKs44KS5Y+W5b6X5Lit4oCmIjsKICQoInJhY2VMaXN0IikuaW5uZXJIVE1MPSIiOwoKIHRyeXsKICBjb25zdCB4PWF3YWl0IGZldGNoSlNPTigKICAgYGh0dHBzOi8va2VpYmEtYWkuaHQxOTk1MDgyMi53b3JrZXJzLmRldi9yYWNlLWNhcmRzP2RhdGU9JHtlbmNvZGVVUklDb21wb25lbnQoZCl9JmRpc2NvdmVyPTFgCiAgKTsKCiAgY29uc3QgYWxsUmFjZXM9QXJyYXkuaXNBcnJheSh4KQogICAgPyB4CiAgICA6ICh4LnJhY2VzfHx4LmRhdGF8fFtdKTsKCiAgaWYoIWFsbFJhY2VzLmxlbmd0aCl7CiAgICQoInJhY2VTdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5YKs44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44Gn44GX44Gf44CCIjsKICAgcmV0dXJuOwogIH0KCiAgLyoKICAgKiDjg6zjg7zjgrnjgpLplovlgqzloLTjgZTjgajjgavjgb7jgajjgoHjgosKICAgKi8KICBjb25zdCB2ZW51ZU1hcD17fTsKCiAgYWxsUmFjZXMuZm9yRWFjaChyPT57CiAgIGNvbnN0IGNvZGU9U3RyaW5nKAogICAgci52ZW51ZUNvZGV8fAogICAgci5qYmlzVmVudWVDb2RlfHwKICAgICIiCiAgICk7CgogICBpZighY29kZSlyZXR1cm47CgogICBpZighdmVudWVNYXBbY29kZV0pewogICAgdmVudWVNYXBbY29kZV09ewogICAgIGNvZGUsCiAgICAgbmFtZTpyLnZlbnVlTmFtZXx8IiIsCiAgICAgcmFjZXM6W10KICAgIH07CiAgIH0KCiAgIHZlbnVlTWFwW2NvZGVdLnJhY2VzLnB1c2gocik7CiAgfSk7CgogIFJBQ0VTPU9iamVjdC52YWx1ZXModmVudWVNYXApOwoKICAkKCJyYWNlU3RhdHVzIikudGV4dENvbnRlbnQ9CiAgIGAke1JBQ0VTLmxlbmd0aH3ku7bjga7plovlgqzjgpLlj5blvpfjgZfjgb7jgZfjgZ/jgIJgOwoKICAkKCJyYWNlTGlzdCIpLmlubmVySFRNTD0KICAgUkFDRVMubWFwKCh2LGkpPT4KICAgIGA8YnV0dG9uIGRhdGEtaT0iJHtpfSI+JHtlc2Modi5uYW1lfHxg6ZaL5YKsJHtpKzF9YCl9PC9idXR0b24+YAogICApLmpvaW4oIiIpOwoKICBbCiAgIC4uLiQoInJhY2VMaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uIikKICBdLmZvckVhY2goYj0+ewogICBiLm9uY2xpY2s9KCk9PmxvYWRWZW51ZShiLmRhdGFzZXQuaSk7CiAgfSk7CgogfWNhdGNoKGUpewogICQoInJhY2VTdGF0dXMiKS50ZXh0Q29udGVudD0KICAgIuWPluW+l+OCqOODqeODvO+8miIrZS5tZXNzYWdlOwogfQp9CmFzeW5jIGZ1bmN0aW9uIGxvYWRWZW51ZShpKXsKIGNvbnN0IHY9UkFDRVNbaV0sZD0kKCJkYXRlIikudmFsdWU7CiBjb25zdCByYWNlcz12LnJhY2VzfHxbXTsKCiBpZighcmFjZXMubGVuZ3RoKXsKICAkKCJyYWNlTGlzdCIpLmlubmVySFRNTD0i44Os44O844K544OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIjsKICByZXR1cm47CiB9CgogJCgicmFjZUxpc3QiKS5pbm5lckhUTUw9CiAgcmFjZXMKICAgLnNvcnQoKGEsYik9PgogICAgTnVtYmVyKGEucmFjZU51bWJlcnx8MCktTnVtYmVyKGIucmFjZU51bWJlcnx8MCkKICAgKQogICAubWFwKChyLGspPT4KICAgIGA8YnV0dG9uIGRhdGEtaT0iJHtrfSI+JHtlc2MoCiAgICAgIHIucmFjZU51bWJlciA/IGAke3IucmFjZU51bWJlcn1SYCA6IGAke2srMX1SYAogICAgKX0gJHtlc2Moci5yYWNlTmFtZXx8IiIpfTwvYnV0dG9uPmAKICAgKQogICAuam9pbigiIik7CgogY29uc3QgYnV0dG9ucz0KICAkKCJyYWNlTGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbiIpOwoKIHJhY2VzLmZvckVhY2goKHIsayk9PnsKICBidXR0b25zW2tdLm9uY2xpY2s9KCk9PnsKICAgc2VsZWN0ZWRSYWNlPW5vcm1hbGl6ZVJhY2UocixkLHYpOwogICAkKCJwcmVkaWN0aW9uIikudGV4dENvbnRlbnQ9CiAgICBgJHtzZWxlY3RlZFJhY2UubmFtZXx8c2VsZWN0ZWRSYWNlLnJhY2VOb3x8IuODrOODvOOCuSJ944KS6YG45oqe44GX44G+44GX44Gf44CC44CMQUnkuojmg7PjgpLlrp/ooYzjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJgOwogICAkKCJwcmVkaWN0IikuZGlzYWJsZWQ9ZmFsc2U7CiAgfTsKIH0pOwp9CmZ1bmN0aW9uIG5vcm1hbGl6ZVJhY2UocixkLHYpewogLy8gQVBJ44OQ44O844K444On44Oz44Gr44KI44Gj44GmIHJ1bm5lcnMg44GM56m66YWN5YiX44Gn44KCIGhvcnNlcyDjgavlh7rotbDppqzjgYzlhaXjgovjgZPjgajjgYzjgYLjgovjgIIKIC8vIOepuumFjeWIl+OBryB0cnV0aHkg44Gq44Gu44Gn44CB5pyA5Yid44Gu44CM56m644Gn44Gq44GE6YWN5YiX44CN44KS6YG444G244CCCiBjb25zdCBydW5uZXJDYW5kaWRhdGVzPVtyLnJ1bm5lcnMsci5ob3JzZXMsci5lbnRyaWVzLHIuZGF0YV07CiBjb25zdCBydW5uZXJzPXJ1bm5lckNhbmRpZGF0ZXMuZmluZChhPT5BcnJheS5pc0FycmF5KGEpJiZhLmxlbmd0aD4wKXx8W107CgogcmV0dXJuewogIGRhdGU6ZCwKICBuYW1lOnIubmFtZXx8ci5yYWNlTmFtZXx8IiIsCiAgcmFjZU5vOnIucmFjZU5vfHxyLnJhY2VOdW1iZXJ8fHIubnVtYmVyfHwiIiwKICBwbGFjZTpyLnBsYWNlfHxyLnZlbnVlTmFtZXx8di5wbGFjZXx8di5uYW1lfHwiIiwKICBydW5uZXJzOnJ1bm5lcnMubWFwKHg9Pih7CiAgIGhvcnNlSWQ6cGljayh4LFsKICAgICJob3JzZV9pZCIsCiAgICAiaG9yc2VJZCIsCiAgICAi6aasSUQiCiAgIF0pLAogICBob3JzZTpwaWNrKHgsWwogICAgImhvcnNlIiwKICAgICJob3JzZV9uYW1lIiwKICAgICJob3JzZU5hbWUiLAogICAgIm5hbWUiLAogICAgIummrOWQjSIKICAgXSksCiAgIGpvY2tleUlkOnBpY2soeCxbCiAgICAiam9ja2V5X2lkIiwKICAgICJqb2NrZXlJZCIsCiAgICAi6aiO5omLSUQiCiAgIF0pLAogICBqb2NrZXk6cGljayh4LFsKICAgICJqb2NrZXkiLAogICAgImpvY2tleV9uYW1lIiwKICAgICJqb2NrZXlOYW1lIiwKICAgICLpqI7miYvlkI0iLAogICAgIumojuaJiyIKICAgXSksCiAgIHRyYWluZXI6cGljayh4LFsKICAgICJ0cmFpbmVyIiwKICAgICJ0cmFpbmVyX25hbWUiLAogICAgIuiqv+aVmeW4qyIKICAgXSksCiAgIG51bWJlcjpudW0oeCxbCiAgICAibnVtYmVyIiwKICAgICJob3JzZU51bWJlciIsCiAgICAi6aas55WqIgogICBdKSwKICAgZnJhbWU6bnVtKHgsWwogICAgImZyYW1lIiwKICAgICLmnqAiCiAgIF0pLAogICBhZ2U6bnVtKHgsWwogICAgImFnZSIsCiAgICAi5bm06b2iIgogICBdKSwKICAgc3R5bGU6c3R5bGVPZih4KQogIH0pKQogfTsKfQphc3luYyBmdW5jdGlvbiBiYWNrdXAoKXsKIGNvbnN0IGZpbGVzPWF3YWl0IGFsbCgiZmlsZXMiKTsKIGNvbnN0IGJsb2I9bmV3IEJsb2IoW0pTT04uc3RyaW5naWZ5KGZpbGVzKV0se3R5cGU6ImFwcGxpY2F0aW9uL2pzb24ifSk7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTsKIGEuZG93bmxvYWQ9YGtlaWJhX2FpX2JhY2t1cF8ke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKX0uanNvbmA7YS5jbGljaygpOwogc2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApOwp9CmFzeW5jIGZ1bmN0aW9uIHJlbG9hZFN0YXRlKCl7CiAkKCJkYXRhU3RhdHVzIikudGV4dENvbnRlbnQ9IuS/neWtmOODh+ODvOOCv+OBrueKtuaFi+OCkueiuuiqjeS4reKApiI7JCgic3RhdGUiKS50ZXh0Q29udGVudD0i56K66KqN5Lit4oCmIjsKIHRyeXthd2FpdCBmYXN0U3RhdGUoKX1jYXRjaChlKXsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+6Kqt44G/6L6844G/44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlKX08L3NwYW4+YDsKICAkKCJzdGF0ZSIpLnRleHRDb250ZW50PSJJbmRleGVkRELjga7oqq3jgb/ovrzjgb/jgavlpLHmlZfjgZfjgb7jgZfjgZ/jgILpgY7ljrvjg4fjg7zjgr/jga/liYrpmaTjgZfjgarjgYTjgafjgY/jgaDjgZXjgYTjgIIiOwogfQp9CmFzeW5jIGZ1bmN0aW9uIGluaXQoKXsKIHRyeXthd2FpdCBvcGVuREIoKTthd2FpdCBmYXN0U3RhdGUoKX1jYXRjaChlKXsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+56K66KqN44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlKX08L3NwYW4+YDsKICAkKCJzdGF0ZSIpLnRleHRDb250ZW50PSLjg4fjg7zjgr/nirbmhYvjgpLnorroqo3jgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgIIiOwogfQp9CiQoInJlbG9hZCIpLm9uY2xpY2s9cmVsb2FkU3RhdGU7CiQoInVwZGF0ZSIpLm9uY2xpY2s9dXBkYXRlRGF0YTsKJCgiYmFja3VwIikub25jbGljaz1iYWNrdXA7CiQoImdldFJhY2VzIikub25jbGljaz1nZXRSYWNlQ2FyZHM7CiQoInByZWRpY3QiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGlmKCFzZWxlY3RlZFJhY2UpcmV0dXJuOwogdHJ5eyQoInByZWRpY3Rpb24iKS50ZXh0Q29udGVudD0iQUnkuojmg7PjgpLoqIjnrpfkuK3igKYiO3JlbmRlclByZWRpY3Rpb24oYXdhaXQgYW5hbHl6ZVJhY2Uoc2VsZWN0ZWRSYWNlKSl9CiBjYXRjaChlKXtidXN5KGZhbHNlKTskKCJwcmVkaWN0aW9uIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+QUnkuojmg7Pjgqjjg6njg7zvvJoke2VzYyhlPy5tZXNzYWdlfHxTdHJpbmcoZSkpfTwvc3Bhbj5gfQp9OwokKCJ2YWxpZGF0ZSIpLm9uY2xpY2s9KCk9PmFsZXJ0KCLmpJzoqLzmqZ/og73jga/pgY7ljrvjg4fjg7zjgr/lj5blvpflvozjgavov73liqDjgZfjgb7jgZnjgIIiKTsKJCgiZGF0ZSIpLnZhbHVlPW5ldyBEYXRlKERhdGUubm93KCkrODY0MDAwMDAqNykudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKaW5pdCgpOwo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==";
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
