import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { adminLogin, adminLogout, adminVerify } from "./storage.js";

/* ============================================================
   学マスサポートカードデッキメーカー
   所持サポカと育成条件から、スコアが最大になる編成（6枚）を計算する。
   利用者モード：サポカ登録／点数計算　管理者モード：マスターデータの編集・バックアップ
   ============================================================ */

/* ============================================================
   定数・初期データ
   ============================================================ */

// プランは4種。育成プランとして選べるのは「共通」を除く3種
const SELECTABLE_PLANS = ["センス", "ロジック", "アノマリー"];
const CARD_ATTRIBUTES = [...SELECTABLE_PLANS, "共通"];

const PLAN_COLORS = {
  "センス": { accent: "#4ade80", soft: "rgba(74,222,128,0.14)" },   // 緑
  "ロジック": { accent: "#2dd4bf", soft: "rgba(45,212,191,0.14)" },  // ティール
  "アノマリー": { accent: "#c77dff", soft: "rgba(199,125,255,0.14)" }, // 紫
  "共通": { accent: "#a8b0c0", soft: "rgba(168,176,192,0.16)" },     // グレー
};

const TENDENCY_COLORS = {
  "p_vo": { accent: "#ff5c6c", soft: "rgba(255,92,108,0.16)" }, // 赤
  "p_da": { accent: "#4da3ff", soft: "rgba(77,163,255,0.16)" }, // 青
  "p_vi": { accent: "#ffdd57", soft: "rgba(255,221,87,0.16)" }, // 黄
};
const TENDENCY_NEUTRAL_COLOR = { accent: "#b3a17a", soft: "rgba(179,161,122,0.16)" }; // 傾向なし（共通カードなど、暖色系グレーで「共通」プランの色と区別）
function tendencyColor(tendencyType) {
  return TENDENCY_COLORS[tendencyType] || TENDENCY_NEUTRAL_COLOR;
}

const RARITIES = ["SSR", "配布SSR", "SR"];
const RARITY_COLORS = {
  "SSR": { accent: "#ffd166", soft: "rgba(255,209,102,0.14)" },
  "配布SSR": { accent: "#9fe8b0", soft: "rgba(159,232,176,0.14)" },
  "SR": { accent: "#ffd700", soft: "rgba(255,215,0,0.16)" },
};
const SSR_RAINBOW_GRADIENT = "linear-gradient(90deg, #ff5c6c, #ffb347, #ffe066, #6be675, #4da3ff, #b98bff, #ff8ad1)";

const TENDENCY_STAT_IDS = ["p_vo", "p_da", "p_vi"];
const TENDENCY_LABELS = { p_vo: "Vo", p_da: "Da", p_vi: "Vi" };

// 傾向：メイン2属性の組み合わせ（残り1属性がサブ）
const MAIN_TYPE_DEFS = {
  VoDa: { mains: ["p_vo", "p_da"], sub: "p_vi", label: "Vo・Da" },
  DaVi: { mains: ["p_da", "p_vi"], sub: "p_vo", label: "Da・Vi" },
  ViVo: { mains: ["p_vi", "p_vo"], sub: "p_da", label: "Vi・Vo" },
};

function isMainStat(tendencyType, mainTypeKey) {
  const def = MAIN_TYPE_DEFS[mainTypeKey];
  if (!def || !tendencyType) return false;
  return def.mains.includes(tendencyType);
}

// 点数計算画面の「追加回数」の定義（paramIdの回数に perUnit×選択単位 を加算）
const MANUAL_COUNT_ADDITIONS = [
  { id: "fuwamoko_drink", label: "ふわもこPアイテムによるドリンク獲得", paramId: "p_drink_get", perUnit: 2, maxUnits: 7, unitNoun: "ドリンク" },
];

function seq(base, step = 1) {
  return [0, 1, 2, 3, 4].map((i) => base + i * step);
}

function valuesForAllRarities(base, step = 1) {
  const arr = seq(base, step);
  return { "SSR": [...arr], "配布SSR": [...arr], "SR": [...arr] };
}

// パラメータの初期データ（maxCount＝発動回数の上限、lessonDependent＝メイン属性のカードのみ回数を数える、countGroup＝同じ実イベントの上限違い）
const DEFAULT_PARAMETERS = [
  {
    "id": "p_sp_lesson_end",
    "name": "SPレッスン終了時",
    "lessonDependent": true,
    "valuesByRarity": {
      "SSR": [
        13,
        17,
        null,
        null,
        null
      ],
      "配布SSR": [
        9,
        13,
        null,
        null,
        null
      ],
      "SR": [
        7,
        13,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_lesson_end",
    "name": "レッスン終了時",
    "lessonDependent": true,
    "valuesByRarity": {
      "SSR": [
        4,
        6,
        null,
        null,
        null
      ],
      "配布SSR": [
        3,
        4,
        null,
        null,
        null
      ],
      "SR": [
        2,
        4,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_20cards_sp_lesson_end_max4",
    "name": "20枚_SPレッスン終了時:上限4",
    "valuesByRarity": {
      "SSR": [
        15,
        21,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        8,
        15,
        null,
        null,
        null
      ]
    },
    "maxCount": 4
  },
  {
    "id": "p_skillget",
    "name": "スキルカード獲得",
    "valuesByRarity": {
      "SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        1,
        2,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_acardget",
    "name": "Aカード獲得",
    "valuesByRarity": {
      "SSR": [
        2,
        3,
        null,
        null,
        null
      ],
      "配布SSR": [
        1,
        2,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_mcardget",
    "name": "Mカード獲得",
    "valuesByRarity": {
      "SSR": [
        2,
        3,
        null,
        null,
        null
      ],
      "配布SSR": [
        1,
        2,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_ssrget",
    "name": "SSRカード獲得",
    "valuesByRarity": {
      "SSR": [
        5,
        6,
        null,
        null,
        null
      ],
      "配布SSR": [
        3,
        5,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_cardup",
    "name": "カード強化",
    "valuesByRarity": {
      "SSR": [
        3,
        4,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        2,
        3,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_acardup",
    "name": "Aカード強化",
    "valuesByRarity": {
      "SSR": [
        7,
        9,
        null,
        null,
        null
      ],
      "配布SSR": [
        5,
        7,
        null,
        null,
        null
      ],
      "SR": [
        4,
        6,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_mcardup",
    "name": "Mカード強化",
    "valuesByRarity": {
      "SSR": [
        7,
        9,
        null,
        null,
        null
      ],
      "配布SSR": [
        5,
        7,
        null,
        null,
        null
      ],
      "SR": [
        4,
        6,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_sakujo",
    "name": "削除",
    "valuesByRarity": {
      "SSR": [
        8,
        11,
        null,
        null,
        null
      ],
      "配布SSR": [
        6,
        8,
        null,
        null,
        null
      ],
      "SR": [
        4,
        8,
        null,
        null,
        null
      ]
    },
    "maxCount": null,
    "countGroup": "sakujo"
  },
  {
    "id": "p_sakujo_max4",
    "name": "スキルカード削除時:上限4",
    "valuesByRarity": {
      "SSR": [
        15,
        20,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 4,
    "countGroup": "sakujo"
  },
  {
    "id": "p_acard_sakujo_max3",
    "name": "Aカード削除:上限3",
    "valuesByRarity": {
      "SSR": [
        17,
        22,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        8,
        16,
        null,
        null,
        null
      ]
    },
    "maxCount": 3
  },
  {
    "id": "p_mcard_sakujo_max3",
    "name": "Mカード削除:上限3",
    "valuesByRarity": {
      "SSR": [
        17,
        22,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        8,
        16,
        null,
        null,
        null
      ]
    },
    "maxCount": 3
  },
  {
    "id": "p_henkan_max3",
    "name": "カード変換:上限3",
    "valuesByRarity": {
      "SSR": [
        16,
        21,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        8,
        16,
        null,
        null,
        null
      ]
    },
    "maxCount": 3
  },
  {
    "id": "p_henkan_kihon_max3",
    "name": "基本カード変換:上限3",
    "valuesByRarity": {
      "SSR": [
        27,
        39,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 3
  },
  {
    "id": "p_jugyou",
    "name": "授業・営業終了時",
    "valuesByRarity": {
      "SSR": [
        5,
        7,
        null,
        null,
        null
      ],
      "配布SSR": [
        4,
        5,
        null,
        null,
        null
      ],
      "SR": [
        3,
        5,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_katsudou",
    "name": "活動支給/差し入れ",
    "valuesByRarity": {
      "SSR": [
        12,
        17,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        6,
        11,
        null,
        null,
        null
      ]
    },
    "maxCount": null,
    "countGroup": "katsudou"
  },
  {
    "id": "p_katsudou_max2",
    "name": "活動支給・差し入れ選択時:上限2",
    "valuesByRarity": {
      "SSR": [
        28,
        38,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        13,
        26,
        null,
        null,
        null
      ]
    },
    "maxCount": 2,
    "countGroup": "katsudou"
  },
  {
    "id": "p_odekake",
    "name": "お出かけ",
    "valuesByRarity": {
      "SSR": [
        11,
        15,
        null,
        null,
        null
      ],
      "配布SSR": [
        8,
        11,
        null,
        null,
        null
      ],
      "SR": [
        5,
        10,
        null,
        null,
        null
      ]
    },
    "maxCount": null,
    "countGroup": "odekake"
  },
  {
    "id": "p_odekake_max2",
    "name": "おでかけ終了時:上限2",
    "valuesByRarity": {
      "SSR": [
        28,
        38,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 2,
    "countGroup": "odekake"
  },
  {
    "id": "p_yasumu",
    "name": "休む",
    "valuesByRarity": {
      "SSR": [
        17,
        22,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        9,
        17,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_soudan",
    "name": "相談",
    "valuesByRarity": {
      "SSR": [
        14,
        18,
        null,
        null,
        null
      ],
      "配布SSR": [
        9,
        14,
        null,
        null,
        null
      ],
      "SR": [
        7,
        14,
        null,
        null,
        null
      ]
    },
    "maxCount": null,
    "countGroup": "soudan"
  },
  {
    "id": "p_soudan_max2",
    "name": "相談選択時:上限2",
    "valuesByRarity": {
      "SSR": [
        28,
        38,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 2,
    "countGroup": "soudan"
  },
  {
    "id": "p_soudan_drink_koukan",
    "name": "相談ドリンク交換",
    "valuesByRarity": {
      "SSR": [
        8,
        11,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        4,
        8,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_soudan_kokan_max5",
    "name": "相談でのスキルカード交換:上限5",
    "valuesByRarity": {
      "SSR": [
        18,
        21,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 5
  },
  {
    "id": "p_tokubetsu_max3",
    "name": "特別指導開始時:上限3",
    "valuesByRarity": {
      "SSR": [
        18,
        25,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        9,
        18,
        null,
        null,
        null
      ]
    },
    "maxCount": 3
  },
  {
    "id": "p_customize_max6",
    "name": "カスタマイズ:上限6",
    "valuesByRarity": {
      "SSR": [
        8,
        11,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        5,
        8,
        null,
        null,
        null
      ]
    },
    "maxCount": 6
  },
  {
    "id": "p_shikenend_max2",
    "name": "試験終了時:上限2",
    "valuesByRarity": {
      "SSR": [
        17,
        22,
        null,
        null,
        null
      ],
      "配布SSR": [
        11,
        17,
        null,
        null,
        null
      ],
      "SR": [
        9,
        17,
        null,
        null,
        null
      ]
    },
    "maxCount": 2
  },
  {
    "id": "p_15cards_shikenend_max5",
    "name": "15枚_試験・オーディション終了時:上限5",
    "valuesByRarity": {
      "SSR": [
        26,
        37,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 5
  },
  {
    "id": "p_drink_get",
    "name": "ドリンク獲得",
    "valuesByRarity": {
      "SSR": [
        4,
        5,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": null,
    "countGroup": "drink_get"
  },
  {
    "id": "p_drink_get_max10",
    "name": "Pドリンク獲得時:上限10",
    "valuesByRarity": {
      "SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        3,
        6,
        null,
        null,
        null
      ]
    },
    "maxCount": 10,
    "countGroup": "drink_get"
  },
  {
    "id": "p_item_get_max6",
    "name": "Pアイテム獲得時:上限6",
    "valuesByRarity": {
      "SSR": [
        11,
        15,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        6,
        11,
        null,
        null,
        null
      ]
    },
    "maxCount": 6,
    "countGroup": "item_get"
  },
  {
    "id": "p_shuchu",
    "name": "集中カード獲得",
    "valuesByRarity": {
      "SSR": [
        3,
        4,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        2,
        3,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_koucho",
    "name": "好調カード獲得",
    "valuesByRarity": {
      "SSR": [
        3,
        4,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        2,
        3,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_genki",
    "name": "元気カード獲得",
    "valuesByRarity": {
      "SSR": [
        3,
        4,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_yaruki",
    "name": "やる気カード獲得",
    "valuesByRarity": {
      "SSR": [
        3,
        4,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        2,
        3,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_kouinshou",
    "name": "好印象カード獲得",
    "valuesByRarity": {
      "SSR": [
        3,
        4,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        2,
        3,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_onzon",
    "name": "温存カード獲得",
    "valuesByRarity": {
      "SSR": [
        3,
        4,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        2,
        3,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_zenryoku",
    "name": "全力カード獲得",
    "valuesByRarity": {
      "SSR": [
        3,
        4,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        2,
        3,
        null,
        null,
        null
      ]
    },
    "maxCount": null
  },
  {
    "id": "p_shuchu8cards_skillget_max4",
    "name": "所持集中8枚_スキルカード獲得時:上限4",
    "valuesByRarity": {
      "SSR": [
        16,
        22,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 4
  },
  {
    "id": "p_kouinshou8cards_skillget_max4",
    "name": "所持好印象8枚_スキルカード獲得時:上限4",
    "valuesByRarity": {
      "SSR": [
        16,
        22,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 4
  },
  {
    "id": "p_onzon8cards_skillget_max4",
    "name": "所持温存8枚_スキルカード獲得時:上限4",
    "valuesByRarity": {
      "SSR": [
        16,
        22,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 4
  },
  {
    "id": "p_zenryoku8cards_skillget_max4",
    "name": "所持全力8枚_スキルカード獲得時:上限4",
    "valuesByRarity": {
      "SSR": [
        16,
        22,
        null,
        null,
        null
      ],
      "配布SSR": [
        0,
        0,
        null,
        null,
        null
      ],
      "SR": [
        0,
        0,
        null,
        null,
        null
      ]
    },
    "maxCount": 4
  }
];

// サブ枠1（固定値／レッスンボーナス）の数値テーブルと倍率
const DEFAULT_FIRST_SLOT_CONFIG = {
  mainMultiplier: 1.4,
  subMultiplier: 0.35,
  fixedValueTable: {
    "SSR": [52, 55, 59, 62, 65],
    "配布SSR": [52, 55, 59, 62, 65],
    "SR": [37, 40, 43, 46, 49],
  },
};

// シナリオ進行パターンは、通常パラメータの回数・レッスン終了時系の傾向別回数・編成枚数と確定サポカの初期値を持つ。
// 好調・集中などの状態カードの回数はカード種別方針側で管理する。
const CARD_TYPE_POLICY_PARAM_IDS = ["p_koucho", "p_shuchu", "p_genki", "p_yaruki", "p_kouinshou", "p_onzon", "p_zenryoku"];

// 新規作成時の回数の初期値（上限があるものは上限値、それ以外は0）
function zeroCountsFor(paramList) {
  const relevant = paramList.filter((p) => !p.lessonDependent && !CARD_TYPE_POLICY_PARAM_IDS.includes(p.id));
  const groups = buildParamCountGroups(relevant);
  const c = {};
  groups.forEach((g) => {
    const caps = g.members.map((m) => m.maxCount).filter((v) => v != null);
    const def = caps.length > 0 ? Math.min(...caps) : 0;
    g.ids.forEach((id) => { c[id] = def; });
  });
  return c;
}
function zeroCounts() {
  return zeroCountsFor(DEFAULT_PARAMETERS);
}

// countGroupが同じパラメータを1つの入力欄にまとめる（allowedIds指定時は代表IDが含まれるものだけ返す）
function buildParamCountGroups(parameters, allowedIds) {
  const groups = {};
  const order = [];
  parameters.forEach((p) => {
    if (p.lessonDependent) return;
    const key = p.countGroup || p.id;
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(p);
  });
  let result = order.map((key) => {
    const members = groups[key];
    const base = members.find((m) => m.maxCount == null) || members[0];
    return { key: base.id, base, members, ids: members.map((m) => m.id) };
  });
  if (allowedIds) result = result.filter((g) => allowedIds.has(g.key));
  return result;
}
function makePattern(id, name, overrides) {
  return { id, name, counts: { ...zeroCounts(), ...overrides } };
}

const DEFAULT_SCENARIOS = [
  {
    "id": "sc_hif",
    "name": "HIF",
    "patterns": [
      {
        "id": "hif_normal",
        "name": "通常育成",
        "counts": {
          "p_20cards_sp_lesson_end_max4": 4,
          "p_cardup": 4,
          "p_acardup": 2,
          "p_mcardup": 2,
          "p_sakujo": 4,
          "p_acard_sakujo_max3": 2,
          "p_mcard_sakujo_max3": 2,
          "p_henkan_max3": 3,
          "p_skillget": 20,
          "p_acardget": 6,
          "p_mcardget": 10,
          "p_ssrget": 8,
          "p_jugyou": 6,
          "p_katsudou": 5,
          "p_soudan": 2,
          "p_odekake": 1,
          "p_yasumu": 0,
          "p_shikenend_max2": 5,
          "p_tokubetsu_max3": 1,
          "p_drink_get": 12,
          "p_soudan_drink_koukan": 4,
          "p_customize_max6": 4,
          "p_item_get_max6": 4,
          "p_katsudou_max2": 5,
          "p_odekake_max2": 1,
          "p_soudan_max2": 2,
          "p_drink_get_max10": 12,
          "p_sakujo_max4": 4,
          "p_henkan_kihon_max3": 3,
          "p_shuchu8cards_skillget_max4": 4,
          "p_kouinshou8cards_skillget_max4": 4,
          "p_onzon8cards_skillget_max4": 4,
          "p_15cards_shikenend_max5": 5,
          "p_zenryoku8cards_skillget_max4": 4,
          "p_soudan_kokan_max5": 2
        },
        "distributionByMainType": {
          "VoDa": {
            "p_vo": 4,
            "p_da": 4,
            "p_vi": 0
          },
          "DaVi": {
            "p_vo": 0,
            "p_da": 4,
            "p_vi": 4
          },
          "ViVo": {
            "p_vo": 4,
            "p_da": 0,
            "p_vi": 4
          }
        },
        "formationDefaults": {
          "VoDa": {
            "counts": {
              "p_vo": 3,
              "p_da": 3,
              "p_vi": 0
            },
            "spCounts": {
              "p_vo": 1,
              "p_da": 1,
              "p_vi": 0
            }
          },
          "DaVi": {
            "counts": {
              "p_vo": 0,
              "p_da": 3,
              "p_vi": 3
            },
            "spCounts": {
              "p_vo": 0,
              "p_da": 1,
              "p_vi": 1
            }
          },
          "ViVo": {
            "counts": {
              "p_vo": 3,
              "p_da": 0,
              "p_vi": 3
            },
            "spCounts": {
              "p_vo": 1,
              "p_da": 0,
              "p_vi": 1
            }
          }
        }
      },
      {
        "id": "hif_fuwamoko_da4",
        "name": "ふわもこDa4枚育成",
        "counts": {
          "p_20cards_sp_lesson_end_max4": 4,
          "p_cardup": 4,
          "p_acardup": 2,
          "p_mcardup": 2,
          "p_sakujo": 4,
          "p_acard_sakujo_max3": 2,
          "p_mcard_sakujo_max3": 2,
          "p_henkan_max3": 3,
          "p_skillget": 20,
          "p_acardget": 6,
          "p_mcardget": 10,
          "p_ssrget": 8,
          "p_jugyou": 6,
          "p_katsudou": 5,
          "p_soudan": 3,
          "p_odekake": 1,
          "p_yasumu": 0,
          "p_shikenend_max2": 5,
          "p_tokubetsu_max3": 0,
          "p_drink_get": 26,
          "p_soudan_drink_koukan": 12,
          "p_customize_max6": 0,
          "p_item_get_max6": 4,
          "p_katsudou_max2": 5,
          "p_odekake_max2": 1,
          "p_soudan_max2": 3,
          "p_drink_get_max10": 26,
          "p_sakujo_max4": 4,
          "p_onzon8cards_skillget_max4": 4,
          "p_15cards_shikenend_max5": 5,
          "p_soudan_kokan_max5": 3,
          "p_kouinshou8cards_skillget_max4": 4,
          "p_shuchu8cards_skillget_max4": 4,
          "p_henkan_kihon_max3": 3,
          "p_zenryoku8cards_skillget_max4": 4
        },
        "defaultLockedCards": [
          {
            "cardId": "c7",
            "asRental": false
          }
        ],
        "distributionByMainType": {
          "VoDa": {
            "p_vo": 1,
            "p_da": 7,
            "p_vi": 0
          },
          "DaVi": {
            "p_vo": 0,
            "p_da": 7,
            "p_vi": 1
          },
          "ViVo": {
            "p_vo": 0,
            "p_da": 7,
            "p_vi": 1
          }
        },
        "formationDefaults": {
          "VoDa": {
            "counts": {
              "p_vo": 2,
              "p_da": 4,
              "p_vi": 0
            },
            "spCounts": {
              "p_vo": 0,
              "p_da": 2,
              "p_vi": 0
            }
          },
          "DaVi": {
            "counts": {
              "p_vo": 0,
              "p_da": 4,
              "p_vi": 2
            },
            "spCounts": {
              "p_vo": 0,
              "p_da": 2,
              "p_vi": 0
            }
          },
          "ViVo": {
            "counts": {
              "p_vo": 0,
              "p_da": 4,
              "p_vi": 2
            },
            "spCounts": {
              "p_vo": 0,
              "p_da": 2,
              "p_vi": 0
            }
          }
        }
      }
    ],
    "cardTypePolicies": [
      {
        "id": "hif_ctp_sense",
        "name": "センス",
        "counts": {
          "p_koucho": 7,
          "p_shuchu": 7,
          "p_genki": 5
        }
      },
      {
        "id": "hif_ctp_logic_yaruki",
        "name": "ロジック（やる気型）",
        "counts": {
          "p_yaruki": 8,
          "p_kouinshou": 0,
          "p_genki": 10
        }
      },
      {
        "id": "hif_ctp_logic_kouinshou",
        "name": "ロジック（好印象型）",
        "counts": {
          "p_yaruki": 6,
          "p_kouinshou": 11,
          "p_genki": 5
        }
      },
      {
        "id": "hif_ctp_anomaly_tsuyoki",
        "name": "アノマリー（強気型）",
        "counts": {
          "p_onzon": 8,
          "p_zenryoku": 2,
          "p_genki": 5
        }
      },
      {
        "id": "hif_ctp_anomaly_zenryoku",
        "name": "アノマリー（全力型）",
        "counts": {
          "p_onzon": 2,
          "p_zenryoku": 8,
          "p_genki": 5
        }
      }
    ]
  }
];

const DEFAULT_CARDS = [
  {
    "id": "c1",
    "name": "いつか、きっと花開く",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "誓いの花びら",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_cardup",
      "p_yasumu",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c2",
    "name": "ほっとけないクラスメイト",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "朝一の助け舟",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_cardup",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c3",
    "name": "思惑とガクガク",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "私が見つけた逸材メモ",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 13,
      "linkedParam": "p_lesson_end"
    }
  },
  {
    "id": "c4",
    "name": "マイペース、マイライフ",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "一緒にお昼寝ポプリ",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 13,
      "linkedParam": "p_lesson_end"
    }
  },
  {
    "id": "c5",
    "name": "実食！例のSSD",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "例のSSDの秘密",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 13,
      "linkedParam": "p_lesson_end"
    }
  },
  {
    "id": "c6",
    "name": "嬉し恥ずかし夢心地",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "お姉さま大百科",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      null,
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 26,
      "linkedParam": "p_shikenend_max2"
    }
  },
  {
    "id": "c7",
    "name": "ふわふわでワクワク",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ふわふわでもこもこ",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c8",
    "name": "魅惑の大腿四頭筋",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "ストレッチ談議",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c9",
    "name": "ほっぺた、ぷに",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "手作りのご褒美",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      null,
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 26,
      "linkedParam": "p_shikenend_max2"
    }
  },
  {
    "id": "c10",
    "name": "てとりあしとり",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "ご指導ご鞭撻",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c11",
    "name": "愛無き暗記は難しい",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "打倒！墾田永年私財法",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      null,
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 26,
      "linkedParam": "p_shikenend_max2"
    }
  },
  {
    "id": "c12",
    "name": "のらりくらりしっかり",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "おアツイ視線",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c13",
    "name": "今はあえて、背を向けて",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "美鈴からの贈り物",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c14",
    "name": "体当たりのラブコール",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "お姉ちゃんだもの！",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c15",
    "name": "きみは、自慢の生徒です",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "信頼の証",
    "hasSP": true,
    "tendencyType": null,
    "firstSlot": "none",
    "subParams": [
      null,
      null,
      null,
      null,
      null
    ],
    "exValueParamEvent": 0,
    "exValueItem": 0
  },
  {
    "id": "c16",
    "name": "ほら、一緒に持と♪",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "夢にあふれた大荷物",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_acardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c17",
    "name": "まじか。",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "光のステージ",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c18",
    "name": "あら、奇遇ね",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "スカウト遮り帽",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c19",
    "name": "また、あんなに無理をして",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "曇りをぬぐったタオル",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_odekake",
      "p_mcardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c20",
    "name": "私の目に狂いはない",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "仲直りのきっかけ",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_jugyou",
      "p_cardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c21",
    "name": "可愛いと可愛いで可愛い！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "ティーパーティ",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_acardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c22",
    "name": "おいしい顔、いただき～！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "心のアルバム",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_cardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c23",
    "name": "まるで王子様みたいな",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "星のリトルプリンス",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c24",
    "name": "お疲れ様、千奈ちゃん。",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "陽だまりの生徒会室",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_acardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c25",
    "name": "次の桜の季節には。",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "花萌ゆ季節",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_cardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c26",
    "name": "ぐぬぬぬぬ…………！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "悔しさの象徴",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_katsudou",
      "p_mcardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c27",
    "name": "お姉ちゃんに任せなさい！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "満開ペアヘアピン",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_cardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c28",
    "name": "あなたにも作ってあげる！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "得体のしれないモノ",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_yasumu",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c29",
    "name": "はじめてのお友達",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "全力サポート",
    "hasSP": true,
    "tendencyType": null,
    "firstSlot": "none",
    "subParams": [
      null,
      null,
      null,
      null,
      null
    ],
    "exValueParamEvent": 0,
    "exValueItem": 0
  },
  {
    "id": "c30",
    "name": "こいつらめんどくさー",
    "image": "",
    "plan": "センス",
    "rarity": "配布SSR",
    "itemKind": "card",
    "itemName": "喧嘩するほど仲がいい",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c31",
    "name": "わたしたち、やればできる",
    "image": "",
    "plan": "ロジック",
    "rarity": "配布SSR",
    "itemKind": "card",
    "itemName": "ダメダメクッキング",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c32",
    "name": "仕事のつもりで臨みなさい",
    "image": "",
    "plan": "共通",
    "rarity": "配布SSR",
    "itemKind": "card",
    "itemName": "新生徒会爆誕！",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_mcardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c33",
    "name": "何やってるんだろう、",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "天川ラーメン巡り",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_cardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c34",
    "name": "イヤホンはんぶんこ",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "なに聴いてるの？",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_yasumu",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c35",
    "name": "第2回教室パーティー！",
    "image": "",
    "plan": "共通",
    "rarity": "配布SSR",
    "itemKind": "card",
    "itemName": "薄れゆく壁",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c36",
    "name": "パシャッとキメポ",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "キメ顔で自撮り",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_yasumu",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c37",
    "name": "まだ上がりませんように！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "みずたまりスキップ",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c38",
    "name": "晴れたね",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "虹かけるクロス",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_yasumu",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c39",
    "name": "どりゃぎゃ",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ダブルボトル",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 6,
      "linkedParam": "p_koucho"
    }
  },
  {
    "id": "c40",
    "name": "「ア」じゃなくて「エ」！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "お泊り猛勉強",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_mcardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c41",
    "name": "かちこちストレッチ",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "咲季オススメマット",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 6,
      "linkedParam": "p_kouinshou"
    }
  },
  {
    "id": "c42",
    "name": "もうっ！　冷たいよ！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "負けず嫌いの勲章",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c43",
    "name": "一時休戦です",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "はじける水しぶき",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c44",
    "name": "海、楽しまなきゃ！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "可愛い隠しバスタオル",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      null,
      "p_yasumu",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 6,
      "linkedParam": "p_yaruki"
    }
  },
  {
    "id": "c45",
    "name": "夏を楽しみましょう！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "オーバーパワーボール",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_soudan_drink_koukan",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c46",
    "name": "第五種接近遭遇",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ウチュウジンデアル",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 6,
      "linkedParam": "p_shuchu"
    }
  },
  {
    "id": "c47",
    "name": "花火、やりませんか……？",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "交わる感情",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_acardget",
      null,
      "p_sp_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c48",
    "name": "やさしさ、あったかい",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "切れた鼻緒が結んだ絆",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c49",
    "name": "夏を満喫するわよ！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "873シューター",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_mcardup",
      null,
      "p_sp_lesson_end",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c50",
    "name": "ふわふわなお面？",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ハンターの戦利品",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c51",
    "name": "あっちも行きたいですわ！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "ほっこりまんぷく",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_acardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c52",
    "name": "キュッと締めて",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "きっかけの帯",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_soudan_drink_koukan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c53",
    "name": "ゆっくりと過ごしましょう",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "その本、おもしろい？",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_soudan_drink_koukan",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c54",
    "name": "りっぱなすすき！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "大きくてつやつや",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_odekake",
      null,
      "p_sp_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c55",
    "name": "新たな挑戦の成功ですわ！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "とうちょーのきろく",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_acardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": {
      "perTrigger": 15,
      "linkedParam": "p_jugyou"
    }
  },
  {
    "id": "c56",
    "name": "1人たりとも欠ける事なく",
    "image": "",
    "plan": "共通",
    "rarity": "配布SSR",
    "itemKind": "item",
    "itemName": "みんなの教科書",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      null,
      "p_soudan",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c57",
    "name": "二人ならあっという間だね",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "とろけた時間",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_jugyou",
      null,
      "p_cardup",
      "p_sp_lesson_end",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c58",
    "name": "ブレイクタイムは珈琲で",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "優しさミルクシュガー",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_soudan_drink_koukan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c59",
    "name": "似合うんじゃない？",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "いじっぱりバルーン",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c60",
    "name": "千奈の恩返し",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "お嬢様の恩返し",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_sakujo",
      null,
      "p_sp_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c61",
    "name": "すっかり秋色ですわね！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "つやつやでふさふさ",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_koucho",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c62",
    "name": "興味深い飲み物",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "気になる……",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c63",
    "name": "会長、準備は万端です",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "会長の完璧な計画",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_mcardup",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c64",
    "name": "SSDのひみつ",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ぜったいマル秘レシピ",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c65",
    "name": "食欲の秋なんです",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "ごちそうさまでした",
    "hasSP": true,
    "tendencyType": null,
    "firstSlot": "none",
    "subParams": [
      null,
      null,
      null,
      null,
      null
    ],
    "exValueParamEvent": 0,
    "exValueItem": 0
  },
  {
    "id": "c66",
    "name": "トンボをつかまえて",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "小さい秋見つけた",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_cardup",
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c67",
    "name": "そろそろ焼けたかな？",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "ほかほか焼き芋",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c68",
    "name": "バズっちゃお！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "こうかい……？",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      "p_soudan",
      null,
      "p_odekake",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c69",
    "name": "ぜったい追いついてやる！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "紅葉ランニング",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_jugyou",
      null,
      "p_cardup",
      "p_sp_lesson_end",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c70",
    "name": "サンマ、バタバタ",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "旬の味わい",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_cardup",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c71",
    "name": "プロデュースって大変ね",
    "image": "",
    "plan": "アノマリー",
    "rarity": "配布SSR",
    "itemKind": "item",
    "itemName": "アイドルパワー測定機",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      null,
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c72",
    "name": "さみだれ",
    "image": "",
    "plan": "アノマリー",
    "rarity": "配布SSR",
    "itemKind": "card",
    "itemName": "雨宿りのバス停",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c73",
    "name": "キラキラして綺麗～っ！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "光の夜",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_soudan",
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c74",
    "name": "ディカプルエックスエル！",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "イケてるセーター",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c75",
    "name": "あったかいね",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "ぬくもりふたりぶん",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_mcardget",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c76",
    "name": "きゅる～んωポーズッ☆",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "カワイイのつくり方",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 6,
      "linkedParam": "p_yaruki"
    }
  },
  {
    "id": "c77",
    "name": "待ちなさーい！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "はいぼくせんげん",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_acardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c78",
    "name": "カロリー/2でハッピー×2",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ほっこりはんぶんこ",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      "p_cardup",
      null,
      "p_sp_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c79",
    "name": "もう一度、最初から！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "練習再開！",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c80",
    "name": "これが私達の、3年間",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "すごすぎるバトン",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c81",
    "name": "はいっ、みんなも一緒に♪",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "ぜったいいっぱい！",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      null,
      "p_odekake",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c82",
    "name": "目指すはテッペン",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "トレーナーの優しさ",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      null,
      "p_soudan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c83",
    "name": "まだまだのばしてー",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "体ほぐしローラー",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      null,
      "p_odekake",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c84",
    "name": "基礎＞応用",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "うるおいのどケア",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      null,
      "p_skillget",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c85",
    "name": "バレンタイン♡会議中ーっ！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "バレンタイン大作戦！",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_sakujo",
      null,
      "p_acardup",
      "p_sp_lesson_end",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c86",
    "name": "SSCの爆誕",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "愛情レインボー",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c87",
    "name": "絶対にお渡ししますわっ！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "お姉さまビッグラブ",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c88",
    "name": "まごころを込めて",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "ディテールが肝心",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_odekake",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c89",
    "name": "あなたたちのことが好き",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "ゆうじょーのきろく",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c90",
    "name": "ピューとシューの二重奏",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "草笛ハーモニー",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      "p_mcardup",
      null,
      "p_jugyou",
      "p_kouinshou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c91",
    "name": "新生活のはじまりだね",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "体力自慢の本気",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_lesson_end",
      "p_onzon",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": {
      "perTrigger": 15,
      "linkedParam": "p_odekake"
    }
  },
  {
    "id": "c92",
    "name": "虫愛ずる王子様",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "小さなお客さん",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_cardup",
      null,
      "p_odekake",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c93",
    "name": "ひとりで立てますか？",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "ひとりだちシューズ",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c94",
    "name": "ここから始まるんだね！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "夢へのスタートライン",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_sakujo",
      null,
      "p_sp_lesson_end",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c95",
    "name": "ガールズ♡トーク",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ギャルめいきんぐ！",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      "p_odekake",
      null,
      "p_sp_lesson_end",
      "p_mcardup",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 0,
      "linkedParam": "p_sp_lesson_end"
    }
  },
  {
    "id": "c96",
    "name": "相手にとって不足なしよ！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "対戦お願いします！",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcard_sakujo_max3",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c97",
    "name": "奥義、三重とび！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "絆のなわとび",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_mcardup",
      null,
      "p_jugyou",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 6,
      "linkedParam": "p_zenryoku"
    }
  },
  {
    "id": "c98",
    "name": "さあ、もう一戦！",
    "image": "",
    "plan": "共通",
    "rarity": "配布SSR",
    "itemKind": "card",
    "itemName": "勝負はこれから！",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c99",
    "name": "相変わらず不器用ね",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "幼馴染の意地",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_kouinshou",
      null,
      "p_sp_lesson_end",
      "p_odekake",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c100",
    "name": "屈辱の2位",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "噛み締めたタオル",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_odekake",
      null,
      "p_shikenend_max2",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c101",
    "name": "利用し合うのが友達！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "パワーをくれるモノ",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      "p_shikenend_max2",
      null,
      "p_henkan_max3",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 20
  },
  {
    "id": "c102",
    "name": "2名様、ご案内～♪",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "お残しにんじん",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_odekake",
      null,
      "p_cardup",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": {
      "perTrigger": 6,
      "linkedParam": "p_genki"
    }
  },
  {
    "id": "c103",
    "name": "ひとりごとです",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "思い出カタメコイメ",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_henkan_max3",
      null,
      "p_sp_lesson_end",
      "p_acard_sakujo_max3",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c104",
    "name": "主菓子、甘い、薄茶、渋み",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "おもてなしの気持ち",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c105",
    "name": "わたしと美鈴、超仲良し",
    "image": "",
    "plan": "共通",
    "rarity": "配布SSR",
    "itemKind": "item",
    "itemName": "勝利より大切なもの",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_acardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c106",
    "name": "よくやったな、倉本",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "居残りの生徒会室",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_drink_get",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c107",
    "name": "あん・どぅ・とろわっ！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "のびのびバンド",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_cardup",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c108",
    "name": "すっかり仲良しって感じ♪",
    "image": "",
    "plan": "センス",
    "rarity": "配布SSR",
    "itemKind": "item",
    "itemName": "勝利をその手に",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c109",
    "name": "迷子のおしらせです",
    "image": "",
    "plan": "ロジック",
    "rarity": "配布SSR",
    "itemKind": "item",
    "itemName": "迷子のお呼び出し",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_mcardget",
      "p_mcardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c110",
    "name": "みんなの意見を聞かせて♪",
    "image": "",
    "plan": "アノマリー",
    "rarity": "配布SSR",
    "itemKind": "item",
    "itemName": "麻央にぴったし",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_jugyou",
      "p_acardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c111",
    "name": "推し活なひととき、だね！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "おとものミミズク",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_kouinshou",
      null,
      "p_customize_max6",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c112",
    "name": "ばたんきゅー",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "へとへとできゅー",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_mcard_sakujo_max3",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c113",
    "name": "いつも頑張ってるね。",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "包まれるやさしさ",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_sakujo",
      null,
      "p_sp_lesson_end",
      "p_drink_get",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c114",
    "name": "むず×2ふぁっしょんしょー",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "お似合いネクタイ",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_shuchu",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c115",
    "name": "どんな関係なんですか？",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "手作りサブスク弁当",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_genki",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c116",
    "name": "お母さんか！",
    "image": "",
    "plan": "共通",
    "rarity": "配布SSR",
    "itemKind": "item",
    "itemName": "好き嫌い禁止！",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c117",
    "name": "放っておけない気になる子",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "面白くて心配な子",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_sakujo",
      null,
      "p_soudan_drink_koukan",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c118",
    "name": "スパルタ＆スパイス",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ビシッバシッ竹刀",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_onzon",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c119",
    "name": "いつまでも続けばいいのに",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "夏夜に咲く思い出",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_drink_get",
      null,
      "p_sp_lesson_end",
      "p_ssrget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c120",
    "name": "今日は見学なんです",
    "image": "",
    "plan": "共通",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "おさぼりタオル",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_mcard_sakujo_max3",
      null,
      "p_sp_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c121",
    "name": "盛り上げてこー！",
    "image": "",
    "plan": "共通",
    "rarity": "配布SSR",
    "itemKind": "item",
    "itemName": "わいわいタンバリン",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c122",
    "name": "おい、来てやったぞ",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "ピークタイムフラッグ",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_drink_get",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 60
  },
  {
    "id": "c123",
    "name": "ちべたなひととき",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ふっかつのアイス",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_skillget",
      null,
      "p_sp_lesson_end",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 30
  },
  {
    "id": "c124",
    "name": "おっと、危ないよ",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "体力作りの教材？",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_jugyou",
      null,
      "p_sp_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 60
  },
  {
    "id": "c125",
    "name": "師弟の修行",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "落ち葉つかみの型",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_customize_max6",
      null,
      "p_sp_lesson_end",
      "p_yaruki",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 60
  },
  {
    "id": "c126",
    "name": "vギャルピーーースッv",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "しぼまない思い出",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_katsudou",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c127",
    "name": "トゲトゲ注意報",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "かごいっぱいの成果",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_ssrget",
      null,
      "p_tokubetsu_max3",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 30
  },
  {
    "id": "c128",
    "name": "ちょっと詳しいんです！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "月刊アニメトーク♪",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_20cards_sp_lesson_end_max4",
      "p_customize_max6",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c129",
    "name": "腹筋で背筋で体幹キープ！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "メリハリストレッチ",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_kouinshou",
      null,
      "p_sp_lesson_end",
      "p_item_get_max6",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 30
  },
  {
    "id": "c130",
    "name": "これはーーお城ッ！！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "お礼のティーセット",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_katsudou",
      null,
      "p_koucho",
      "p_customize_max6",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 30
  },
  {
    "id": "c131",
    "name": "はっぴぃはろうぃ～～ん！",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "びっくり仮装グッズ",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 40
  },
  {
    "id": "c132",
    "name": "大運動会、開催っ！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "勝利をつかめ！",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_jugyou",
      "p_20cards_sp_lesson_end_max4",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c133",
    "name": "月村手毬、興味深いわね",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "対象、ロックオン",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_katsudou",
      null,
      "p_sp_lesson_end",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c134",
    "name": "あったか足ツボマッサージ",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "激痛のちぽかぽか",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_customize_max6",
      null,
      "p_odekake",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c135",
    "name": "クールダウンが大切よ！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "ほぐれるひととき",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_soudan",
      null,
      "p_ssrget",
      "p_jugyou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c136",
    "name": "ごきげんような挨拶♪",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ごきげんようレッスン",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_item_get_max6",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c137",
    "name": "レディ・セット、ゴー！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "奥義、受け流し！",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_item_get_max6",
      "p_acardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c138",
    "name": "眠れる森の王子様",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "おひるねブランケット",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_20cards_sp_lesson_end_max4",
      null,
      "p_sakujo",
      "p_tokubetsu_max3",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c139",
    "name": "ぜったいに取るんだ！",
    "image": "",
    "plan": "共通",
    "rarity": "配布SSR",
    "itemKind": "card",
    "itemName": "執念キャッチャー",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_ssrget",
      null,
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c140",
    "name": "仲直りしましょう",
    "image": "",
    "plan": "共通",
    "rarity": "配布SSR",
    "itemKind": "card",
    "itemName": "月明かりに包まれて",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_jugyou",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c141",
    "name": "やっと見つけたぞ！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "寝心地は良好",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c142",
    "name": "バディ？",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "お直し刺繍セット",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_sakujo",
      null,
      "p_sp_lesson_end",
      "p_item_get_max6",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c143",
    "name": "メリクリ、おねーちゃん♪",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "いたずらサンタさん",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_ssrget",
      null,
      "p_sp_lesson_end",
      "p_cardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c144",
    "name": "ピコピコでポーン",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "たたいてかぶって",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_onzon",
      null,
      "p_sp_lesson_end",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c145",
    "name": "なぜこんなところにッ！？",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "完全制覇でポン",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_ssrget",
      "p_sp_lesson_end",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 60
  },
  {
    "id": "c146",
    "name": "佑芽ソリレース、疾走！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ゲレンデを駆ける赤",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_20cards_sp_lesson_end_max4",
      null,
      "p_onzon",
      "p_item_get_max6",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 15
  },
  {
    "id": "c147",
    "name": "自分と向き合う時間だ",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "無我の境地",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_koucho",
      null,
      "p_sp_lesson_end",
      "p_20cards_sp_lesson_end_max4",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c148",
    "name": "堂々とサボってる！？",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "あこがれ不良ムーブ",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_kouinshou",
      "p_ssrget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c149",
    "name": "ぐつぐつ、いいにおい♪",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "味見はいかが",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_20cards_sp_lesson_end_max4",
      null,
      "p_katsudou",
      "p_henkan_max3",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c150",
    "name": "手毬のリサイタル、だね",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "寒空リサイタル",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_mcardget",
      null,
      "p_sp_lesson_end",
      "p_ssrget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c151",
    "name": "おひさま笑顔、満開ふたつ",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "そっくりワンワン",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      "p_tokubetsu_max3",
      null,
      "p_shikenend_max2",
      "p_item_get_max6",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 40
  },
  {
    "id": "c152",
    "name": "思い出の宝箱だ、ね",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "ふれんどめもりーず",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_katsudou",
      null,
      "p_shikenend_max2",
      "p_mcardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c153",
    "name": "仲良しの証",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "はじめてのけんか？",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_item_get_max6",
      null,
      "p_cardup",
      "p_tokubetsu_max3",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 30
  },
  {
    "id": "c154",
    "name": "かかってらっしゃい！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "お姉ちゃん、参戦！",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_20cards_sp_lesson_end_max4",
      null,
      "p_genki",
      "p_mcardget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c155",
    "name": "一番星と王子様",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "幸せの詰め合わせ",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 40
  },
  {
    "id": "c156",
    "name": "合格おめでとう！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "花海メモリアル",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_ssrget",
      "p_shuchu",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 70
  },
  {
    "id": "c157",
    "name": "洗濯物のバランスタワー",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "お洗濯の必需品",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_skillget",
      null,
      "p_item_get_max6",
      "p_henkan_max3",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c158",
    "name": "あたしの勝ち、ですね〜！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "せーのでぱくっ！",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_katsudou",
      null,
      "p_ssrget",
      null,
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c159",
    "name": "お近づきの印☆",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ほくほくハンバーガー",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_soudan",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 20
  },
  {
    "id": "c160",
    "name": "進化したお弁当、気になる",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "咲季の完全食・改",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_sp_lesson_end",
      null,
      "p_item_get_max6",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c161",
    "name": "騎士とおてんば姫",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "演技のたしなみ",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_skillget",
      "p_20cards_sp_lesson_end_max4",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c162",
    "name": "長旅おつかれさま！",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "夢を叶えるために",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_koucho",
      null,
      "p_20cards_sp_lesson_end_max4",
      null,
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c163",
    "name": "ひっぱりじゅーなん",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "切磋琢磨のタオル",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      "p_katsudou",
      null,
      "p_onzon",
      "p_item_get_max6",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 30
  },
  {
    "id": "c164",
    "name": "パーティー楽しみだねっ！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "おかいものバッグ",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_acardup",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c165",
    "name": "上かッ！！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "頭上に注意！",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_20cards_sp_lesson_end_max4",
      null,
      "p_lesson_end",
      "p_ssrget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c166",
    "name": "パクパクもぐもぐ",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "もぐもぐ定食",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      "p_skillget",
      null,
      "p_henkan_max3",
      "p_item_get_max6",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c167",
    "name": "貸せ、手本を見せてやる！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "めちゃかわプリ",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_item_get_max6",
      null,
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c168",
    "name": "オシャレもメイクも♪",
    "image": "",
    "plan": "センス",
    "rarity": "配布SSR",
    "itemKind": "item",
    "itemName": "ぴったしコレクション",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_odekake",
      "p_shikenend_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c169",
    "name": "みいつけた。",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "迷子のゆくえ",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_genki",
      "p_katsudou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c170",
    "name": "あなたとふたり、電車で",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "ガタゴトすやすや",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_20cards_sp_lesson_end_max4",
      "p_ssrget",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c171",
    "name": "のんびり美味しいひととき",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "のんびりアフタヌーン",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_20cards_sp_lesson_end_max4",
      "p_skillget",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c172",
    "name": "･･････騒々しいお祭りね",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "想定外のチケット",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_shikenend_max2",
      null,
      "p_odekake_max2",
      "p_sp_lesson_end",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c173",
    "name": "私たちも成長していくぞ！",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "夢の手助け",
    "hasSP": true,
    "tendencyType": null,
    "firstSlot": "none",
    "subParams": [
      "p_katsudou_max2",
      null,
      "p_soudan_max2",
      "p_odekake_max2",
      null
    ],
    "exValueParamEvent": 0,
    "exValueItem": 0
  },
  {
    "id": "c174",
    "name": "私を楽しませろ",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "お手並み拝見",
    "hasSP": true,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_katsudou_max2",
      "p_mcardup",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c175",
    "name": "ゆずれないもの",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "懐かしパーティー論争",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_katsudou_max2",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 20
  },
  {
    "id": "c176",
    "name": "どーなっちゃうの〜？",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "恋心のゆくえ",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_tokubetsu_max3",
      null,
      "p_sp_lesson_end",
      "p_katsudou_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c177",
    "name": "おでん、通りま～すッ！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "あつあつはふはふ",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_ssrget",
      null,
      "p_sp_lesson_end",
      "p_odekake_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c178",
    "name": "ゆるるんあくび顔",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "居眠り注意！",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_katsudou_max2",
      null,
      "p_sp_lesson_end",
      "p_onzon",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 20
  },
  {
    "id": "c179",
    "name": "次の曲は〜ッあの曲だ！！",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "全力おうえんうちわ",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_sakujo_max4",
      null,
      "p_sp_lesson_end",
      "p_kouinshou8cards_skillget_max4",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c180",
    "name": "ずっしりスイカでりしゃす",
    "image": "",
    "plan": "ロジック",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ドキドキ目隠し",
    "hasSP": false,
    "tendencyType": "p_da",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_kouinshou",
      null,
      "p_20cards_sp_lesson_end_max4",
      "p_skillget",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 60
  },
  {
    "id": "c181",
    "name": "インタビューお願いします",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "注目インタビュー！",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_onzon8cards_skillget_max4",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c182",
    "name": "風紀が乱れるぞ！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "ぴらっ♪",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_soudan_kokan_max5",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c183",
    "name": "奇遇な必然",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "きっちりファン装備",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_sakujo",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 40
  },
  {
    "id": "c184",
    "name": "食レポ、得意かも！",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "大満足レポート♪",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_onzon8cards_skillget_max4",
      null,
      "p_sp_lesson_end",
      "p_katsudou_max2",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 25
  },
  {
    "id": "c185",
    "name": "こんにゃくなきもだめし",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SR",
    "itemKind": "item",
    "itemName": "ほっぺたぺたり",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_sp_lesson_end",
      "p_20cards_sp_lesson_end_max4",
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 40
  },
  {
    "id": "c186",
    "name": "大切な思い出、またひとつ",
    "image": "",
    "plan": "センス",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "真夏に咲く太陽",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_sakujo_max4",
      null,
      "p_sp_lesson_end",
      "p_shuchu8cards_skillget_max4",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 20
  },
  {
    "id": "c187",
    "name": "おやすみのふたり",
    "image": "",
    "plan": "センス",
    "rarity": "SR",
    "itemKind": "card",
    "itemName": "のんびりすやすや",
    "hasSP": true,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      null,
      "p_drink_get_max10",
      "p_sp_lesson_end",
      null,
      null
    ],
    "exValueParamEvent": 15,
    "exValueItem": 0
  },
  {
    "id": "c188",
    "name": "イクラ～♪ウニ～♪",
    "image": "",
    "plan": "ロジック",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "たらふくすし放題♪",
    "hasSP": true,
    "tendencyType": "p_vi",
    "firstSlot": "fixed",
    "subParams": [
      null,
      null,
      "p_item_get_max6",
      "p_kouinshou",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 0
  },
  {
    "id": "c189",
    "name": "もうすぐ本番ですね",
    "image": "",
    "plan": "共通",
    "rarity": "SSR",
    "itemKind": "item",
    "itemName": "素敵なお仕事",
    "hasSP": false,
    "tendencyType": "p_vi",
    "firstSlot": "none",
    "subParams": [
      null,
      null,
      "p_henkan_kihon_max3",
      "p_15cards_shikenend_max5",
      null
    ],
    "exValueParamEvent": 20,
    "exValueItem": 75
  },
  {
    "id": "c1790554823599",
    "name": "わたしに、まかせて",
    "image": "",
    "plan": "アノマリー",
    "rarity": "SSR",
    "itemKind": "card",
    "itemName": "うたたねレポート",
    "hasSP": false,
    "tendencyType": "p_vo",
    "firstSlot": "lessonBonus",
    "subParams": [
      "p_zenryoku8cards_skillget_max4",
      null,
      "p_sp_lesson_end",
      "p_soudan_kokan_max5",
      null
    ],
    "exValueParamEvent": 0,
    "exValueItem": 0
  }
];

const DEFAULT_OWNERSHIP = {"c1": 4, "c2": 4, "c3": 4, "c4": 4, "c5": 4, "c6": 4, "c7": 4, "c8": 4, "c9": 4, "c10": 4, "c11": 4, "c12": 4, "c13": 4, "c14": 4, "c15": 4, "c16": 4, "c17": 4, "c18": 4, "c19": 4, "c20": 4, "c21": 4, "c22": 4, "c23": 4, "c24": 4, "c25": 4, "c26": 4, "c27": 4, "c28": 4, "c29": 4, "c30": 4, "c31": 4, "c32": 4, "c33": 4, "c34": 4, "c35": 4, "c36": 4, "c37": 4, "c38": 4, "c39": 4, "c40": 4, "c41": 4, "c42": 4, "c43": 4, "c44": 4, "c45": 4, "c46": 4, "c47": 4, "c48": 4, "c49": 4, "c50": 4, "c51": 4, "c52": 4, "c53": 4, "c54": 4, "c55": 4, "c56": 4, "c57": 4, "c58": 4, "c59": 4, "c60": 4, "c61": 4, "c62": 4, "c63": 4, "c64": 4, "c65": 4, "c66": 4, "c67": 4, "c68": 4, "c69": 4, "c70": 4, "c71": 4, "c72": 4, "c73": 4, "c74": 4, "c75": 4, "c76": 4, "c77": 4, "c78": 4, "c79": 4, "c80": 4, "c81": 4, "c82": 4, "c83": 4, "c84": 4, "c85": 4, "c86": 4, "c87": 4, "c88": 4, "c89": 4, "c90": 4, "c91": 4, "c92": 4, "c93": 4, "c94": 4, "c95": 4, "c96": 4, "c97": 4, "c98": 4, "c99": 4, "c100": 4, "c101": 4, "c102": 4, "c103": 4, "c104": 4, "c105": 4, "c106": 4, "c107": 4, "c108": 4, "c109": 4, "c110": 4, "c111": 4, "c112": 4, "c113": 4, "c114": 4, "c115": 4, "c116": 4, "c117": 4, "c118": 4, "c119": 4, "c120": 4, "c121": 4, "c122": 4, "c123": 4, "c124": 4, "c125": 4, "c126": 4, "c127": 4, "c128": 4, "c129": 4, "c130": 4, "c131": 4, "c132": 4, "c133": 4, "c134": 4, "c135": 4, "c136": 4, "c137": 4, "c138": 4, "c139": 4, "c140": 4, "c141": 4, "c142": 4, "c143": 4, "c144": 4, "c145": 4, "c146": 4, "c147": 4, "c148": 4, "c149": 4, "c150": 4, "c151": 4, "c152": 4, "c153": 4, "c154": 4, "c155": 4, "c156": 4, "c157": 4, "c158": 4, "c159": 4, "c160": 4, "c161": 4, "c162": 4, "c163": 4, "c164": 4, "c165": 4, "c166": 4, "c167": 4, "c168": 4, "c169": 4, "c170": 4, "c171": 4, "c172": 4, "c173": 4, "c174": 4, "c175": 4, "c176": 4, "c177": 4, "c178": 4, "c179": 4, "c180": 4, "c181": 4, "c182": 4, "c183": 4, "c184": 4, "c185": 4, "c186": 4, "c187": 4, "c188": 4, "c189": 4, "c1790554823599": 4}; // 初期状態は全カード4凸所持とする（ユーザーの利用実態に合わせた初期値）
const DEFAULT_SETTINGS = {
  plan: "センス",
  mainType: "VoDa",
  scenarioId: "sc_hif",
  patternId: "hif_normal",
  cardTypePolicyId: "hif_ctp_sense",
  counts: { p_vo: 3, p_da: 3, p_vi: 0 },
  spCounts: { p_vo: 1, p_da: 1, p_vi: 0 },
  includeExParamEvent: true,
  includeExItem: true,
  exItemDiscount: 1, // 回数制限なし（パラメータ連動）のPアイテムパラメータで、理論値から何回分マイナスして計算するか（0〜3）
  enableManualCountAdditions: false,
  manualCountAdditions: {},
  enableLockedCards: false,
  lockedCards: [], // [{ cardId, asRental }]
  ssrOnlyFormation: true, // trueの場合、自動選出（自前候補・レンタル候補）はSSR・配布SSRのみを対象にする
};

const TOKUTSU_LABELS = ["未所持", "0凸", "1凸", "2凸", "3凸", "4凸"]; // index -1 => 0, 0..4 => 1..5

/* ============================================================
   永続化ヘルパー（window.storage）
   ============================================================ */

async function loadOrInit(key, fallback, shared) {
  try {
    const res = await window.storage.get(key, shared);
    if (res && res.value != null) return JSON.parse(res.value);
    throw new Error("empty");
  } catch (e) {
    // 読み込み失敗時もデフォルトは書き込まない（保存済みデータを上書きしないため）
    return fallback;
  }
}

async function persist(key, value, shared) {
  try {
    await window.storage.set(key, JSON.stringify(value), shared);
  } catch (e) {
    console.error("保存に失敗しました", key, e);
  }
}

/* ---------- パラメータIDの移行処理（旧ID→新ID）。何度適用しても結果は変わらない。
   mergeSource: true は、統合時に値の優先度が低い側 ---------- */
const PARAM_MIGRATIONS = {
  "p_askillget": { newId: "p_acardget", oldName: "Aスキル獲得", newName: "Aカード獲得" },
  "p_mskillget": { newId: "p_mcardget", oldName: "Mスキル獲得", newName: "Mカード獲得" },
  "p_skillup": { newId: "p_cardup", oldName: "スキル強化", newName: "カード強化" },
  "p_askillup": { newId: "p_acardup", oldName: "Aスキル強化", newName: "Aカード強化" },
  "p_mskillup": { newId: "p_mcardup", oldName: "Mスキル強化", newName: "Mカード強化" },
  "p_tokubetsu": { newId: "p_tokubetsu_max3", oldName: "特別指導開始時", newName: "特別指導開始時:上限3" },
  "p_shikenend": { newId: "p_shikenend_max2", oldName: "試験終了時2回版", newName: "試験終了時:上限2" },
  "p_sp20": { newId: "p_20cards_sp_lesson_end_max4", oldName: "SPレッスン（20枚）", newName: "20枚_SPレッスン終了時:上限4", mergeSource: true },
  "p_mskill_sakujo": { newId: "p_mcard_sakujo_max3", oldName: "Mスキル削除", newName: "Mカード削除:上限3" },
  "p_askill_sakujo": { newId: "p_acard_sakujo_max3", oldName: "Aスキル削除", newName: "Aカード削除:上限3" },
  "p_henkan": { newId: "p_henkan_max3", oldName: "変換", newName: "カード変換:上限3" },
  "p_drink_koukan": { newId: "p_soudan_drink_koukan", oldName: "Pドリンク交換", newName: "相談ドリンク交換" },
  "p_item_get": { newId: "p_item_get_max6", oldName: "Pアイテム獲得", newName: "Pアイテム獲得時:上限6", mergeSource: true },
  "p_customize": { newId: "p_customize_max6", oldName: "カスタマイズ", newName: "カスタマイズ:上限6" },
  "p_henkan_kihon": { newId: "p_henkan_kihon_max3", oldName: "変換（名前に「基本」を含むスキルカードのみ対象）", newName: "基本カード変換:上限3" },
  "p_shikenend_15cards": { newId: "p_15cards_shikenend_max5", oldName: "試験・オーディション終了時（所持スキルカード15枚以上）", newName: "15枚_試験・オーディション終了時:上限5" },
  "p_sp_lesson_end_20cards": { newId: "p_20cards_sp_lesson_end_max4", oldName: "SPレッスン終了時（所持スキルカード20枚以上）", newName: "20枚_SPレッスン終了時:上限4" },
  "p_skillget_shuchu8cards": { newId: "p_shuchu8cards_skillget_max4", oldName: "スキルカード獲得時（所持集中カード8枚以上）", newName: "所持集中8枚_スキルカード獲得時:上限4" },
  "p_skillget_onzon8cards": { newId: "p_onzon8cards_skillget_max4", oldName: "スキルカード獲得時（所持温存カード8枚以上）", newName: "所持温存8枚_スキルカード獲得時:上限4" },
  "p_katsudou_2": { newId: "p_katsudou_max2", oldName: "活動支給・差し入れ選択時（2回版）", newName: "活動支給・差し入れ選択時:上限2" },
  "p_drink_get_10": { newId: "p_drink_get_max10", oldName: "Pドリンク獲得時（10回版）", newName: "Pドリンク獲得時:上限10" },
  "p_sakujo_4": { newId: "p_sakujo_max4", oldName: "スキルカード削除時（4回版）", newName: "スキルカード削除時:上限4" },
  "p_soudan_kokan_5": { newId: "p_soudan_kokan_max5", oldName: "相談でのスキルカード交換（5回版）", newName: "相談でのスキルカード交換:上限5" },
  "p_skillget_kouinshou8cards": { newId: "p_kouinshou8cards_skillget_max4", oldName: "スキルカード獲得時（所持好印象カード8枚以上）", newName: "所持好印象8枚_スキルカード獲得時:上限4" },
  "p_odekake_2": { newId: "p_odekake_max2", oldName: "おでかけ終了時（2回版）", newName: "おでかけ終了時:上限2" },
  "p_soudan_2": { newId: "p_soudan_max2", oldName: "相談選択時（2回版）", newName: "相談選択時:上限2" },
  "p_henkan_3": { newId: "p_henkan_max3", oldName: "スキルカードチェンジ時（3回版）", newName: "カード変換:上限3", mergeSource: true },
  "p_item_get_6": { newId: "p_item_get_max6", oldName: "Pアイテム獲得時（6回版）", newName: "Pアイテム獲得時:上限6" },
  "p_item_get_time_max6": { newId: "p_item_get_max6", oldName: "Pアイテム獲得時:上限6", newName: "Pアイテム獲得時:上限6" },
  "p1790554984415": { newId: "p_zenryoku8cards_skillget_max4", oldName: "スキルカード獲得時（所持全力カード8枚以上）", newName: "所持全力8枚_スキルカード獲得時:上限4" },
};
const mapParamId = (id) => (typeof id === "string" && PARAM_MIGRATIONS[id] ? PARAM_MIGRATIONS[id].newId : id);

function mergeParamDefs(a, b, finalName) {
  const valuesByRarity = {};
  const rarities = new Set([...Object.keys(a.valuesByRarity || {}), ...Object.keys(b.valuesByRarity || {})]);
  rarities.forEach((r) => {
    const x = (a.valuesByRarity || {})[r] || [];
    const y = (b.valuesByRarity || {})[r] || [];
    const len = Math.max(x.length, y.length);
    const arr = [];
    for (let i = 0; i < len; i++) {
      const vx = x[i], vy = y[i];
      if (typeof vx === "number" && vx !== 0) arr.push(vx);
      else if (typeof vy === "number" && vy !== 0) arr.push(vy);
      else if (typeof vx === "number" || typeof vy === "number") arr.push(0);
      else arr.push(null);
    }
    valuesByRarity[r] = arr;
  });
  return { ...a, name: finalName, valuesByRarity, maxCount: a.maxCount ?? b.maxCount ?? null };
}

function migrateParameters(list) {
  if (!Array.isArray(list)) return list;
  const out = [];
  const indexById = {};
  let changed = false;
  list.forEach((p) => {
    if (!p || typeof p !== "object" || !p.id) { out.push(p); return; }
    const mig = PARAM_MIGRATIONS[p.id];
    let q = p;
    if (mig) {
      changed = true;
      q = { ...p, id: mig.newId };
      if (p.name === mig.oldName) q.name = mig.newName;
    }
    if (indexById[q.id] !== undefined) {
      // 同じ新IDが2つ以上ある（統合対象）：1つにまとめる
      changed = true;
      const i = indexById[q.id];
      const finalName = [out[i].name, q.name].find((n) => Object.values(PARAM_MIGRATIONS).some((m) => m.newId === q.id && m.newName === n)) || out[i].name;
      // 統合先（元から残る側）の値を優先し、空・0の段階だけ統合元の値で補う
      const incomingIsSource = !!(mig && mig.mergeSource);
      out[i] = incomingIsSource ? mergeParamDefs(out[i], q, finalName) : mergeParamDefs(q, out[i], finalName);
    } else {
      indexById[q.id] = out.length;
      out.push(q);
    }
  });
  return changed ? out : list;
}

function migrateCards(list) {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const out = list.map((c) => {
    if (!c || typeof c !== "object") return c;
    let q = c;
    if (Array.isArray(c.subParams) && c.subParams.some((id) => id && PARAM_MIGRATIONS[id])) {
      q = { ...q, subParams: c.subParams.map((id) => (id ? mapParamId(id) : id)) };
      changed = true;
    }
    const ev = c.exValueItem;
    if (ev && typeof ev === "object" && ev.linkedParam && PARAM_MIGRATIONS[ev.linkedParam]) {
      q = { ...q, exValueItem: { ...ev, linkedParam: mapParamId(ev.linkedParam) } };
      changed = true;
    }
    return q;
  });
  return changed ? out : list;
}

function migrateScenarios(list) {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const walk = (o) => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === "object") {
      const r = {};
      Object.keys(o).forEach((k) => {
        const nk = mapParamId(k);
        if (nk !== k) changed = true;
        const nv = walk(o[k]);
        if (nk in r && typeof r[nk] === "number" && typeof nv === "number") r[nk] = Math.max(r[nk], nv);
        else r[nk] = nv;
      });
      return r;
    }
    if (typeof o === "string" && PARAM_MIGRATIONS[o]) { changed = true; return mapParamId(o); }
    return o;
  };
  const out = walk(list);
  return changed ? out : list;
}

// 一度だけ実行する修正（実行済みフラグで管理）
const ONE_TIME_FIX_KEY = "master:migration:paramids:v1";
// 保存済みパラメータの値・上限・countGroupを初期データにそろえる（一度だけ実行）
const PARAM_VALUE_SYNC_KEY = "master:migration:paramvalues:v1";
function syncParamValuesToDefaults(params) {
  if (!Array.isArray(params)) return params;
  const defs = {};
  DEFAULT_PARAMETERS.forEach((d) => { defs[d.id] = d; });
  return params.map((q) => {
    const d = q && defs[q.id];
    if (!d) return q;
    const out = { ...q, valuesByRarity: JSON.parse(JSON.stringify(d.valuesByRarity)), maxCount: d.maxCount ?? null };
    if (d.countGroup) out.countGroup = d.countGroup; else delete out.countGroup;
    return out;
  });
}

function applyOneTimeMasterFixes(parameters, cards) {
  const params = Array.isArray(parameters) ? parameters.map((p) => (p && p.id === "p_drink_get" && p.name === "Pドリンク獲得" ? { ...p, name: "ドリンク獲得" } : p)) : parameters;
  const cs = Array.isArray(cards) ? cards.map((c) => (c && c.id === "c168" && c.name === "オシャレもメイクも♪" && c.rarity === "SSR" ? { ...c, rarity: "配布SSR" } : c)) : cards;
  return { params, cards: cs };
}

// 画像を縮小してBase64のdata URLに変換する
function resizeImageFileToDataUrl(file, maxSize, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height);
        height = maxSize;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => callback(null);
    img.src = e.target.result;
  };
  reader.onerror = () => callback(null);
  reader.readAsDataURL(file);
}

/* ============================================================
   所持状況データの検証ヘルパー
   ============================================================ */

function sanitizeOwnershipObject(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const sanitized = {};
  let droppedCount = 0;
  Object.entries(parsed).forEach(([cardId, level]) => {
    const n = Number(level);
    if (!Number.isFinite(n)) { droppedCount++; return; }
    sanitized[cardId] = Math.max(-1, Math.min(4, Math.round(n)));
  });
  return { sanitized, droppedCount };
}

function stripBOM(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/* ============================================================
   簡易CSVヘルパー（所持状況バックアップ用）
   ============================================================ */

function csvField(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvStringify(rows) {
  return rows.map((row) => row.map(csvField).join(",")).join("\n");
}
function csvParse(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (ch === "\r") {
      // 無視（\r\n対応）
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

/* ============================================================
   スコア計算ロジック
   ============================================================ */

function findParam(parameters, id) {
  return parameters.find((p) => p.id === id) || null;
}

// 各枠が強化される凸レベル。現在の凸レベル以下の要素数が、valuesByRarityのインデックスになる
const SUBPARAM_SLOT_STRENGTHEN_LEVELS = [
  [2],       // 2枠目（subParams[0]）：2凸のみ強化 → 2段階
  [1, 2, 3, 4], // 3枠目（subParams[1]）：毎凸強化 → 5段階
  [3],       // 4枠目（subParams[2]）：3凸のみ強化 → 2段階
  [4],       // 5枠目（subParams[3]）：完凸のみ強化 → 2段階
  [1, 4],    // 6枠目（subParams[4]）：1凸・完凸で強化 → 3段階
];

function subParamStageIndex(slotIndex, tokutsuLevel) {
  const strengthenLevels = SUBPARAM_SLOT_STRENGTHEN_LEVELS[slotIndex] || [1, 2, 3, 4];
  return strengthenLevels.filter((lv) => lv <= tokutsuLevel).length;
}

function slotStageCount(slotIndex) {
  const strengthenLevels = SUBPARAM_SLOT_STRENGTHEN_LEVELS[slotIndex] || [1, 2, 3, 4];
  return strengthenLevels.length + 1;
}

function paramDefinedStageCount(param) {
  let max = 0;
  RARITIES.forEach((r) => {
    const arr = param.valuesByRarity?.[r] || [];
    let count = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== null && arr[i] !== undefined) count = i + 1;
    }
    if (count > max) max = count;
  });
  return max;
}

// 発動回数：カード種別方針を優先し、追加回数を加算して、上限でクランプする
function effectiveCount(param, pattern, cardTypePolicy, extraCounts) {
  const fromPolicy = cardTypePolicy?.counts?.[param.id];
  const base = fromPolicy != null ? fromPolicy : (pattern.counts?.[param.id] || 0);
  const extra = extraCounts?.[param.id] || 0;
  const raw = base + extra;
  if (param.maxCount == null) return raw;
  return Math.min(raw, param.maxCount);
}

// レッスン終了時系の回数（パターン×傾向のVo/Da/Vi別回数）
function effectiveLessonCount(param, lessonCounts, tendencyType) {
  const raw = lessonCounts?.[tendencyType] || 0;
  if (param.maxCount == null) return raw;
  return Math.min(raw, param.maxCount);
}

// カード1枚のスコアを計算する（サブ枠2〜6＋サブ枠1＋EXステータス）
function cardScore(card, tokutsuLevel, pattern, parameters, mainType, firstSlotConfig, exOptions, lessonCounts, cardTypePolicy, extraCounts) {
  if (tokutsuLevel < 0 || !pattern) return { total: 0, breakdown: [] };
  const includeExParamEvent = exOptions?.includeExParamEvent !== false;
  const includeExItem = exOptions?.includeExItem !== false;
  const isMain = isMainStat(card.tendencyType, mainType);
  const subParams = card.subParams || [];
  let total = 0;
  const breakdown = [];

  for (let slotIndex = 0; slotIndex < subParams.length; slotIndex++) {
    const paramId = subParams[slotIndex];
    if (!paramId) continue;
    const param = findParam(parameters, paramId);
    if (!param) continue;
    let count;
    if (param.lessonDependent) {
      count = isMain ? effectiveLessonCount(param, lessonCounts, card.tendencyType) : 0;
    } else {
      count = effectiveCount(param, pattern, cardTypePolicy, extraCounts);
    }
    const stageIndex = subParamStageIndex(slotIndex, tokutsuLevel);
    const rarityValues = param.valuesByRarity?.[card.rarity] || param.valuesByRarity?.["SSR"] || [];
    const value = rarityValues[stageIndex] ?? 0;
    const contribution = count * value;
    breakdown.push({ param, contribution, count, value, isZero: contribution === 0 });
    total += contribution;
  }

  if (card.firstSlot && card.firstSlot !== "none" && firstSlotConfig) {
    const table = firstSlotConfig.fixedValueTable?.[card.rarity] || firstSlotConfig.fixedValueTable?.["SSR"] || [];
    const base = table[tokutsuLevel] ?? 0;
    let contribution = 0;
    let label = "";
    if (card.firstSlot === "fixed") {
      contribution = base;
      label = `固定値（${isMain ? "メイン" : "サブ"}）`;
    } else if (card.firstSlot === "lessonBonus") {
      const mult = isMain ? firstSlotConfig.mainMultiplier : firstSlotConfig.subMultiplier;
      contribution = base * mult;
      label = `レッスンボーナス（${isMain ? "メイン" : "サブ"}）`;
    }
    breakdown.push({ param: { id: "firstSlot", name: label }, contribution, isFirstSlot: true, isZero: contribution === 0 });
    total += contribution;
  }

  // EXステータス（点数を直接加算）
  if (includeExParamEvent && card.exValueParamEvent) {
    breakdown.push({ param: { id: "ex_paramevent", name: "パラメータイベントパラメータ" }, contribution: card.exValueParamEvent, isEx: true });
    total += card.exValueParamEvent;
  }
  if (includeExItem && card.itemKind === "item" && card.exValueItem != null) {
    const ev = card.exValueItem;
    if (typeof ev === "object") {
      const linkedParam = findParam(parameters, ev.linkedParam);
      const rawCount = linkedParam && !linkedParam.lessonDependent ? effectiveCount(linkedParam, pattern, cardTypePolicy, extraCounts) : 0;
      // 理論値からexItemDiscount回分を引いて見積もる
      const discount = Math.max(0, Math.min(3, exOptions?.exItemDiscount || 0));
      const count = Math.max(0, rawCount - discount);
      const value = ev.perTrigger || 0;
      const contribution = count * value;
      const label = `Pアイテムパラメータ（${linkedParam ? linkedParam.name : (ev.linkedParam || "?")}連動）`;
      breakdown.push({ param: { id: "ex_item", name: label }, contribution, isEx: true, count, value, isZero: contribution === 0 });
      total += contribution;
    } else if (ev) {
      breakdown.push({ param: { id: "ex_item", name: "Pアイテムパラメータ" }, contribution: ev, isEx: true });
      total += ev;
    }
  }
  breakdown.sort((a, b) => b.contribution - a.contribution);
  return { total, breakdown };
}

// 編成：確定サポカ → 属性ごとの自動選出（SP指定枠を優先） → レンタル（最大1枚。不足を埋めるか、スコアが上がる置き換えのみ）
function buildFormation({ cards, ownership, settings, pattern, cardTypePolicy, parameters, firstSlotConfig, extraCounts }) {
  const mainType = settings.mainType;
  const counts = settings.counts || {};
  const spCounts = settings.spCounts || {};
  const exOptions = { includeExParamEvent: settings.includeExParamEvent !== false, includeExItem: settings.includeExItem !== false, exItemDiscount: settings.exItemDiscount || 0 };
  const lessonCounts = pattern?.distributionByMainType?.[mainType] || { p_vo: 0, p_da: 0, p_vi: 0 };
  const eligible = cards.filter((c) => c.plan === settings.plan || c.plan === "共通");
  const rarityOk = (c) => !settings.ssrOnlyFormation || c.rarity === "SSR" || c.rarity === "配布SSR";
  const autoPool = eligible.filter(rarityOk); // 自動選出（自前候補・レンタル候補）の対象。確定サポカ（手動指定）はこの制限を受けない。
  const scoreCard = (c, lvl) => cardScore(c, lvl, pattern, parameters, mainType, firstSlotConfig, exOptions, lessonCounts, cardTypePolicy, extraCounts);

  const ownedAll = autoPool
    .filter((c) => (ownership[c.id] ?? -1) >= 0)
    .map((c) => {
      const lvl = ownership[c.id];
      const { total, breakdown } = scoreCard(c, lvl);
      return { card: c, tokutsu: lvl, score: total, breakdown };
    });

  // 確定サポカ（レンタル指定は先頭1枚のみ有効）
  const lockedList = (settings.lockedCards || []).filter((lc) => lc && lc.cardId);
  let lockedRentalEntry = null;
  const lockedOwnEntries = []; // { stat, entry }
  let rentalAlreadyLocked = false;
  lockedList.forEach((lc) => {
    const card = eligible.find((c) => c.id === lc.cardId);
    if (!card || !card.tendencyType) return; // 対象プラン外・傾向未設定のカードは対象外
    if (lc.asRental && !rentalAlreadyLocked) {
      const { total, breakdown } = scoreCard(card, 4);
      lockedRentalEntry = { card, tokutsu: 4, score: total, breakdown };
      rentalAlreadyLocked = true;
    } else {
      const lvl = ownership[card.id] ?? -1;
      if (lvl < 0) return; // 自前固定は所持している必要がある
      const { total, breakdown } = scoreCard(card, lvl);
      lockedOwnEntries.push({ stat: card.tendencyType, entry: { card, tokutsu: lvl, score: total, breakdown } });
    }
  });

  const used = new Set();
  const picksByStat = {}; // stat -> { spPicked: [...], restPicked: [...] }
  const shortfalls = {};

  // 確定サポカ（自前固定）を各属性の枠に先取りする
  TENDENCY_STAT_IDS.forEach((stat) => { picksByStat[stat] = { spPicked: [], restPicked: [] }; });
  lockedOwnEntries.forEach(({ stat, entry }) => {
    if (used.has(entry.card.id)) return;
    picksByStat[stat].restPicked.push(entry);
    used.add(entry.card.id);
  });
  if (lockedRentalEntry) used.add(lockedRentalEntry.card.id);

  TENDENCY_STAT_IDS.forEach((stat) => {
    const lockedCount = picksByStat[stat].restPicked.length; // 確定サポカ（自前固定）ぶん
    const totalQuota = Math.max(0, counts[stat] || 0);
    if (totalQuota <= lockedCount) return; // 既に確定サポカだけで枠が埋まっている（超過分はそのまま残す）
    const spQuota = Math.max(0, Math.min(totalQuota, Math.max(0, spCounts[stat] || 0)) - picksByStat[stat].restPicked.filter((e) => e.card.hasSP).length);

    const pool = ownedAll
      .filter((e) => e.card.tendencyType === stat && !used.has(e.card.id))
      .sort((a, b) => b.score - a.score);

    // SP指定分：SP持ちのスコア上位から確保
    const spPicked = pool.filter((e) => e.card.hasSP).slice(0, spQuota);
    spPicked.forEach((e) => used.add(e.card.id));

    // 残り：同じ属性の中でSP有無を問わずスコア上位から補充（確定サポカぶんは差し引く）
    const remaining = totalQuota - lockedCount - spPicked.length;
    const restPicked = pool.filter((e) => !used.has(e.card.id)).slice(0, remaining);
    restPicked.forEach((e) => used.add(e.card.id));

    picksByStat[stat] = { spPicked, restPicked: [...picksByStat[stat].restPicked, ...restPicked] };

    const shortfall = totalQuota - lockedCount - (spPicked.length + restPicked.length);
    if (shortfall > 0) shortfalls[stat] = shortfall;
  });

  // レンタル（最大1枚）
  const lockedOwnIds = new Set(lockedOwnEntries.map((e) => e.entry.card.id));
  let rentals = [];
  if (lockedRentalEntry) {
    rentals = [lockedRentalEntry];
  } else {
    let bestCandidate = null; // { stat, rentalEntry, removeEntry(or null), netChange }
    TENDENCY_STAT_IDS.forEach((stat) => {
      const totalQuota = Math.max(0, counts[stat] || 0);
      if (totalQuota <= 0) return;
      const usedIds = new Set();
      Object.values(picksByStat).forEach((g) => [...g.spPicked, ...g.restPicked].forEach((e) => usedIds.add(e.card.id)));
      const rentalPool = autoPool
        .filter((c) => c.tendencyType === stat && !usedIds.has(c.id))
        .map((c) => {
          const { total, breakdown } = scoreCard(c, 4);
          return { card: c, tokutsu: 4, score: total, breakdown };
        })
        .sort((a, b) => b.score - a.score);
      const bestRental = rentalPool[0];
      if (!bestRental) return;

      if (shortfalls[stat] > 0) {
        // 不足分を埋める：置き換え対象なし、そのままスコアが加算されるので必ず採用候補になる
        const netChange = bestRental.score;
        if (!bestCandidate || netChange > bestCandidate.netChange) {
          bestCandidate = { stat, rentalEntry: bestRental, removeEntry: null, netChange };
        }
      } else {
        // 置き換えでスコアが上がる場合のみ候補にする
        const { spPicked, restPicked } = picksByStat[stat];
        const removableRest = restPicked.filter((e) => !lockedOwnIds.has(e.card.id));
        const removableSp = spPicked.filter((e) => !lockedOwnIds.has(e.card.id));
        const removable = removableRest.length ? removableRest : removableSp;
        if (!removable.length) return;
        const weakest = removable.reduce((min, e) => (e.score < min.score ? e : min), removable[0]);
        const netChange = bestRental.score - weakest.score;
        if (netChange > 0 && (!bestCandidate || netChange > bestCandidate.netChange)) {
          bestCandidate = { stat, rentalEntry: bestRental, removeEntry: weakest, netChange };
        }
      }
    });

    if (bestCandidate) {
      if (bestCandidate.removeEntry) {
        const g = picksByStat[bestCandidate.stat];
        const removeId = bestCandidate.removeEntry.card.id;
        g.spPicked = g.spPicked.filter((e) => e.card.id !== removeId);
        g.restPicked = g.restPicked.filter((e) => e.card.id !== removeId);
      } else {
        shortfalls[bestCandidate.stat] = Math.max(0, (shortfalls[bestCandidate.stat] || 0) - 1);
        if (shortfalls[bestCandidate.stat] === 0) delete shortfalls[bestCandidate.stat];
      }
      rentals = [bestCandidate.rentalEntry];
    }
  }

  const ownSlots = Object.values(picksByStat)
    .flatMap((g) => [...g.spPicked, ...g.restPicked])
    .sort((a, b) => b.score - a.score);

  const allSlots = [...ownSlots, ...rentals];
  const teamTotal = allSlots.reduce((s, e) => s + e.score, 0);

  return { ownSlots, rentals, ownedScored: ownedAll, teamTotal, shortfalls };
}

/* ============================================================
   小さな UI 部品
   ============================================================ */

function SegButton({ active, onClick, children, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: 999,
        border: `1px solid ${active ? color : "rgba(255,255,255,0.18)"}`,
        background: active ? color : "transparent",
        color: active ? "#151225" : "rgba(245,240,255,0.75)",
        fontWeight: active ? 700 : 500,
        fontSize: 13,
        cursor: "pointer",
        transition: "all 0.15s ease",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

// ≡ハンドルのドラッグで並べ替えできるボタン列（HTML5 Drag and Drop）
function DraggableSegButtonList({ items, activeId, onSelect, onReorder, color }) {
  const dragIndexRef = useRef(null);
  const [overIndex, setOverIndex] = useState(null);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
      {items.map((item, idx) => (
        <div
          key={item.id}
          onDragOver={(e) => { e.preventDefault(); setOverIndex(idx); }}
          onDragLeave={() => setOverIndex((cur) => (cur === idx ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            const from = dragIndexRef.current;
            setOverIndex(null);
            if (from == null || from === idx) return;
            onReorder(from, idx);
            dragIndexRef.current = null;
          }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 2,
            outline: overIndex === idx ? "2px dashed rgba(255,255,255,0.4)" : "none",
            borderRadius: 999,
          }}
        >
          <span
            draggable
            onDragStart={() => { dragIndexRef.current = idx; }}
            onDragEnd={() => { dragIndexRef.current = null; setOverIndex(null); }}
            style={{ cursor: "grab", fontSize: 14, color: "rgba(245,240,255,0.35)", userSelect: "none", padding: "0 3px" }}
          >≡</span>
          <SegButton active={activeId === item.id} onClick={() => onSelect(item.id)} color={color}>
            {item.name}
          </SegButton>
        </div>
      ))}
    </div>
  );
}

function PlanTag({ plan, small }) {
  const c = PLAN_COLORS[plan] || PLAN_COLORS["共通"];
  return (
    <span
      style={{
        display: "inline-block",
        padding: small ? "1px 8px" : "3px 10px",
        borderRadius: 999,
        fontSize: small ? 11 : 12,
        fontWeight: 700,
        color: c.accent,
        background: c.soft,
        border: `1px solid ${c.accent}55`,
      }}
    >
      {plan}
    </span>
  );
}

function RarityTag({ rarity, small }) {
  if (!rarity) return null;
  if (rarity === "SSR") {
    return (
      <span
        style={{
          display: "inline-block",
          padding: small ? "1px 8px" : "3px 10px",
          borderRadius: 6,
          fontSize: small ? 10.5 : 12,
          fontWeight: 900,
          letterSpacing: 0.5,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.3)",
        }}
      >
        <span
          style={{
            backgroundImage: SSR_RAINBOW_GRADIENT,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
          }}
        >
          {rarity}
        </span>
      </span>
    );
  }
  const c = RARITY_COLORS[rarity] || RARITY_COLORS["SR"];
  return (
    <span
      style={{
        display: "inline-block",
        padding: small ? "1px 8px" : "3px 10px",
        borderRadius: 6,
        fontSize: small ? 10.5 : 12,
        fontWeight: 800,
        color: c.accent,
        background: c.soft,
        border: `1px solid ${c.accent}55`,
        letterSpacing: 0.5,
      }}
    >
      {rarity}
    </span>
  );
}

function TendencyTag({ tendencyType, small }) {
  if (!tendencyType) return null;
  const c = tendencyColor(tendencyType);
  return (
    <span
      style={{
        display: "inline-block",
        padding: small ? "1px 7px" : "3px 9px",
        borderRadius: 6,
        fontSize: small ? 10.5 : 12,
        fontWeight: 800,
        color: c.accent,
        background: c.soft,
        border: `1px solid ${c.accent}66`,
      }}
    >
      {TENDENCY_LABELS[tendencyType]}
    </span>
  );
}

function CardThumb({ card, size = 44, colorMode = "tendency" }) {
  const c = colorMode === "tendency" ? tendencyColor(card.tendencyType) : (PLAN_COLORS[card.plan] || PLAN_COLORS["共通"]);
  if (card.image) {
    return (
      <img
        src={card.image}
        alt=""
        style={{ width: size, height: size, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: `1px solid ${c.accent}66` }}
        onError={(e) => { e.target.style.display = "none"; }}
      />
    );
  }
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 10, flexShrink: 0,
        background: `linear-gradient(160deg, ${c.accent}55, ${c.accent}22)`,
        border: `1px solid ${c.accent}66`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, color: c.accent, fontSize: size * 0.38,
      }}
    >
      {card.name ? card.name[0] : "?"}
    </div>
  );
}

function CardChip({ entry, highlight, rental, onClick }) {
  const c = tendencyColor(entry.card.tendencyType);
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        borderRadius: 16,
        padding: "14px 12px",
        background: `linear-gradient(160deg, ${c.soft}, rgba(20,17,35,0.9))`,
        border: `1.5px solid ${c.accent}66`,
        boxShadow: highlight ? `0 0 0 2px ${c.accent}55, 0 8px 24px -8px ${c.accent}66` : "none",
        height: "100%",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {rental && (
        <div style={{ position: "absolute", top: -9, left: 10, fontSize: 10, fontWeight: 700, color: "#151225", background: "#ffd166", padding: "1px 8px", borderRadius: 999 }}>
          レンタル
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <CardThumb card={entry.card} colorMode="tendency" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f5f0ff", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.card.name}</div>
          <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
            <PlanTag plan={entry.card.plan} small />
            {entry.card.rarity && <RarityTag rarity={entry.card.rarity} small />}
            <TendencyTag tendencyType={entry.card.tendencyType} small />
            {entry.card.hasSP && <span style={{ fontSize: 10, color: "#ffd166", border: "1px solid #ffd16688", borderRadius: 6, padding: "0 5px" }}>SP</span>}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "rgba(245,240,255,0.6)" }}>{TOKUTSU_LABELS[entry.tokutsu + 1]}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: c.accent, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
        {Math.round(entry.score)}
      </div>
    </div>
  );
}

/* ---------- スコア内訳パネル ---------- */

function ScoreBreakdown({ entry, onClose }) {
  if (!entry) return null;
  const c = tendencyColor(entry.card.tendencyType);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,8,18,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 50, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#181428", border: `1px solid ${c.accent}55`, borderRadius: 18,
          padding: 20, maxWidth: 420, width: "100%", maxHeight: "80vh", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <CardThumb card={entry.card} size={52} colorMode="tendency" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f5f0ff" }}>{entry.card.name}</div>
            <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
              <PlanTag plan={entry.card.plan} small />
              {entry.card.rarity && <RarityTag rarity={entry.card.rarity} small />}
              <TendencyTag tendencyType={entry.card.tendencyType} small />
              <span style={{ fontSize: 11, color: "rgba(245,240,255,0.5)" }}>{TOKUTSU_LABELS[entry.tokutsu + 1]}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ ...dangerBtn, border: "1px solid rgba(255,255,255,0.2)", color: "rgba(245,240,255,0.7)" }}>閉じる</button>
        </div>
        <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)", marginBottom: 10 }}>点数の内訳</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {entry.breakdown.length === 0 && (
            <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.5)" }}>加算される項目がありません。</div>
          )}
          {entry.breakdown.map((b, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 6 }}>
              <div style={{ color: b.isZero ? "#ffd166" : "rgba(245,240,255,0.8)" }}>
                {b.param.name}
                {b.count != null && b.value != null && <span style={{ color: "rgba(245,240,255,0.45)", marginLeft: 6 }}>（{b.count}回 × {b.value}）</span>}
                {b.isZero && <span style={{ marginLeft: 6, fontSize: 10.5 }}>⚠0点</span>}
              </div>
              <div style={{ fontWeight: 700, color: b.isZero ? "rgba(245,240,255,0.4)" : c.accent, fontVariantNumeric: "tabular-nums" }}>+{Math.round(b.contribution)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 }}>
          <div style={{ color: "rgba(245,240,255,0.7)" }}>合計スコア</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#ffd166" }}>{Math.round(entry.score)}</div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   メインアプリ
   ============================================================ */

export default function SupportCardDeckMaker() {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("user"); // "user" | "admin"
  const [isAdmin, setIsAdmin] = useState(false); // 管理者ログイン済みか（サーバーで検証したトークンの有無）
  const [showLogin, setShowLogin] = useState(false);
  const [userTab, setUserTab] = useState("register"); // "register" | "score"

  const [parameters, setParameters] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [cards, setCards] = useState([]);
  const [firstSlotConfig, setFirstSlotConfig] = useState(null);
  const [ownership, setOwnership] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [savedNote, setSavedNote] = useState("");

  useEffect(() => {
    (async () => {
      const [p0, sc0, c0, fsc, own, sett] = await Promise.all([
        loadOrInit("master:parameters:v11", DEFAULT_PARAMETERS, true),
        loadOrInit("master:scenarios:v9", DEFAULT_SCENARIOS, true),
        loadOrInit("master:cards:v12", DEFAULT_CARDS, true),
        loadOrInit("master:firstslot:v2", DEFAULT_FIRST_SLOT_CONFIG, true),
        loadOrInit("user:ownership", DEFAULT_OWNERSHIP, false),
        loadOrInit("user:settings:v9", DEFAULT_SETTINGS, false),
      ]);
      let p = migrateParameters(p0);
      const sc = migrateScenarios(sc0);
      let c = migrateCards(c0);
      let fixDone = false;
      try { fixDone = !!(await window.storage.get(ONE_TIME_FIX_KEY, true)); } catch (e) { fixDone = false; }
      if (!fixDone) {
        const fixed = applyOneTimeMasterFixes(p, c);
        p = fixed.params;
        c = fixed.cards;
        persist(ONE_TIME_FIX_KEY, "done", true);
      }
      let valuesSynced = false;
      try { valuesSynced = !!(await window.storage.get(PARAM_VALUE_SYNC_KEY, true)); } catch (e) { valuesSynced = false; }
      if (!valuesSynced) {
        p = syncParamValuesToDefaults(p);
        persist(PARAM_VALUE_SYNC_KEY, "done", true);
      }
      if (JSON.stringify(p) !== JSON.stringify(p0)) persist("master:parameters:v11", p, true);
      if (JSON.stringify(sc) !== JSON.stringify(sc0)) persist("master:scenarios:v9", sc, true);
      if (JSON.stringify(c) !== JSON.stringify(c0)) persist("master:cards:v12", c, true);
      setParameters(p);
      setScenarios(sc);
      setCards(c);
      setFirstSlotConfig(fsc);
      setOwnership(own);
      setSettings(sett);
      setLoading(false);
    })();
  }, []);

  // 保存済みの管理者トークンが有効なら、再読み込み後もログイン状態を維持する。
  useEffect(() => {
    adminVerify().then(setIsAdmin);
    const onExpired = () => {
      setIsAdmin(false);
      setMode("user");
      flash("管理者ログインの有効期限が切れました。もう一度ログインしてください");
    };
    window.addEventListener("admin-expired", onExpired);
    return () => window.removeEventListener("admin-expired", onExpired);
  }, []);

  const handleLogout = () => {
    adminLogout();
    setIsAdmin(false);
    setMode("user");
  };

  const flash = (msg) => {
    setSavedNote(msg);
    setTimeout(() => setSavedNote(""), 1500);
  };

  const updateOwnership = useCallback((cardId, level) => {
    setOwnership((prev) => {
      const next = { ...prev, [cardId]: level };
      persist("user:ownership", next, false);
      return next;
    });
  }, []);

  const replaceOwnership = useCallback((next) => {
    setOwnership(next);
    persist("user:ownership", next, false);
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      persist("user:settings:v9", next, false);
      return next;
    });
  }, []);

  const replaceSettings = useCallback((next) => {
    setSettings(next);
    persist("user:settings:v9", next, false);
  }, []);

  const saveMasterCards = (raw) => { if (!isAdmin) return; const next = migrateCards(raw); setCards(next); persist("master:cards:v12", next, true); flash("カードを保存しました"); };
  const saveMasterScenarios = (raw) => { if (!isAdmin) return; const next = migrateScenarios(raw); setScenarios(next); persist("master:scenarios:v9", next, true); flash("育成シナリオを保存しました"); };
  const saveMasterParams = (raw) => { if (!isAdmin) return; const next = migrateParameters(raw); setParameters(next); persist("master:parameters:v11", next, true); flash("パラメータを保存しました"); };
  const saveFirstSlotConfig = (next) => { if (!isAdmin) return; setFirstSlotConfig(next); persist("master:firstslot:v2", next, true); flash("固定値／レッスンボーナス設定を保存しました"); };

  const currentScenario = scenarios.find((s) => s.id === settings.scenarioId) || scenarios[0];
  const currentPattern = currentScenario?.patterns.find((p) => p.id === settings.patternId) || currentScenario?.patterns[0];
  const currentCardTypePolicy = currentScenario?.cardTypePolicies?.find((p) => p.id === settings.cardTypePolicyId) || null;

  const extraCounts = useMemo(() => {
    if (!settings.enableManualCountAdditions) return {};
    const out = {};
    MANUAL_COUNT_ADDITIONS.forEach((def) => {
      const units = settings.manualCountAdditions?.[def.id] || 0;
      if (units > 0) out[def.paramId] = (out[def.paramId] || 0) + units * def.perUnit;
    });
    return out;
  }, [settings.enableManualCountAdditions, settings.manualCountAdditions]);

  const formation = useMemo(() => {
    if (loading || !parameters.length || !currentPattern || !cards.length || !firstSlotConfig) return null;
    return buildFormation({ cards, ownership, settings, pattern: currentPattern, cardTypePolicy: currentCardTypePolicy, parameters, firstSlotConfig, extraCounts });
  }, [loading, cards, ownership, settings, currentPattern, currentCardTypePolicy, parameters, firstSlotConfig, extraCounts]);

  if (loading) {
    return (
      <div style={wrapStyle}>
        <div style={{ color: "#f5f0ff", padding: 40, textAlign: "center" }}>読み込み中…</div>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Kosugi+Maru&family=Noto+Sans+JP:wght@400;500;700;900&display=swap');
        * { box-sizing: border-box; font-family: 'Noto Sans JP', sans-serif; }
        .sco-heading { font-family: 'Kosugi Maru', sans-serif; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 8px; }
        select { color-scheme: dark; }
        select option { background-color: #1c1830; color: #f5f0ff; }
      `}</style>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 20px 60px" }}>
        {/* ヘッダー */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="sco-heading" style={{ fontSize: 26, fontWeight: 700, color: "#f5f0ff", letterSpacing: 1 }}>
              学マスサポートカードデッキメーカー
            </div>
            <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.55)", marginTop: 4 }}>
              手持ちと育成方針から、指定した枚数構成でのサポカ編成スコアを計算します
            </div>
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <SegButton active={mode === "user"} onClick={() => setMode("user")} color="#ff6fae">利用者モード</SegButton>
              <SegButton active={mode === "admin"} onClick={() => setMode("admin")} color="#5ec8ff">管理者モード</SegButton>
              <button onClick={handleLogout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.25)", color: "rgba(245,240,255,0.7)", borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>ログアウト</button>
            </div>
          )}
        </div>

        {(mode === "user" || !isAdmin) && (
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <SegButton active={userTab === "register"} onClick={() => setUserTab("register")} color="#ff6fae">サポカ登録</SegButton>
            <SegButton active={userTab === "score"} onClick={() => setUserTab("score")} color="#ff6fae">点数計算</SegButton>
          </div>
        )}

        {savedNote && (
          <div
            style={{
              position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 200,
              fontSize: 12.5, color: "#151225", background: "#ffd166",
              padding: "8px 18px", borderRadius: 999, fontWeight: 700,
              boxShadow: "0 8px 24px -6px rgba(0,0,0,0.5)", whiteSpace: "nowrap",
            }}
          >
            {savedNote}
          </div>
        )}

        {mode === "user" || !isAdmin ? (
          userTab === "register" ? (
            <RegisterView cards={cards} ownership={ownership} updateOwnership={updateOwnership} replaceOwnership={replaceOwnership} />
          ) : (
            <ScoreView
              scenarios={scenarios}
              settings={settings}
              formation={formation}
              updateSettings={updateSettings}
              cards={cards}
              ownership={ownership}
              parameters={parameters}
              firstSlotConfig={firstSlotConfig}
              currentPattern={currentPattern}
              currentCardTypePolicy={currentCardTypePolicy}
              extraCounts={extraCounts}
            />
          )
        ) : (
          <AdminView
            parameters={parameters}
            scenarios={scenarios}
            cards={cards}
            firstSlotConfig={firstSlotConfig}
            saveParams={saveMasterParams}
            saveScenarios={saveMasterScenarios}
            saveCards={saveMasterCards}
            saveFirstSlotConfig={saveFirstSlotConfig}
            ownership={ownership}
            settings={settings}
            replaceOwnership={replaceOwnership}
            updateSettingsFull={replaceSettings}
            flash={flash}
          />
        )}

        {/* 管理者ログイン（一般の利用者には小さなリンクだけ表示） */}
        {!isAdmin && (
          <div style={{ marginTop: 40, textAlign: "center" }}>
            <button onClick={() => setShowLogin(true)} style={{ background: "transparent", border: "none", color: "rgba(245,240,255,0.35)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
              管理者ログイン
            </button>
          </div>
        )}
      </div>

      {showLogin && (
        <AdminLoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => { setIsAdmin(true); setShowLogin(false); setMode("admin"); }}
        />
      )}
    </div>
  );
}

/* ---------- 管理者ログイン画面（パスワードはサーバーで照合する） ---------- */
function AdminLoginModal({ onClose, onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await adminLogin(password);
      onSuccess();
    } catch (e) {
      setError(e.message || "ログインに失敗しました");
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#1c1830", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 16, padding: 24, width: "100%", maxWidth: 340 }}>
        <div className="sco-heading" style={{ fontSize: 18, fontWeight: 700, marginBottom: 14, color: "#f5f0ff" }}>管理者ログイン</div>
        <input
          type="password"
          autoFocus
          value={password}
          placeholder="パスワード"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "#f5f0ff", fontSize: 14 }}
        />
        {error && <div style={{ color: "#ff8a9b", fontSize: 12.5, marginTop: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <SegButton active={false} onClick={onClose} color="#a8b0c0">キャンセル</SegButton>
          <SegButton active={true} onClick={submit} color="#5ec8ff">{busy ? "確認中…" : "ログイン"}</SegButton>
        </div>
      </div>
    </div>
  );
}

const wrapStyle = {
  minHeight: "100%",
  background: "radial-gradient(ellipse at top, #211c37 0%, #14121f 55%, #0e0c17 100%)",
  color: "#f5f0ff",
};

/* ---------- 利用者モード：サポカ登録ページ ---------- */

function RegisterView({ cards, ownership, updateOwnership, replaceOwnership }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("plan"); // "plan" | "name" | "rarity"
  const [planFilter, setPlanFilter] = useState("all");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [tendencyFilter, setTendencyFilter] = useState("all");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [backupFormat, setBackupFormat] = useState("csv"); // "csv" | "json"
  const [backupText, setBackupText] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const fileInputRef = useRef(null);
  const [registerMsg, setRegisterMsg] = useState("");
  const flashRegister = (msg) => {
    setRegisterMsg(msg);
    setTimeout(() => setRegisterMsg(""), 1500);
  };

  const attributeOrder = { "センス": 0, "ロジック": 1, "アノマリー": 2, "共通": 3 };
  const rarityOrder = RARITIES.reduce((acc, r, i) => ({ ...acc, [r]: i }), {});

  const visibleCards = useMemo(() => {
    let list = cards.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
    if (planFilter !== "all") list = list.filter((c) => c.plan === planFilter);
    if (rarityFilter !== "all") list = list.filter((c) => c.rarity === rarityFilter);
    if (tendencyFilter !== "all") list = list.filter((c) => c.tendencyType === tendencyFilter);
    if (ownedOnly) list = list.filter((c) => (ownership[c.id] ?? -1) >= 0);
    list = [...list].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "ja");
      if (sortKey === "rarity") {
        const diff = (rarityOrder[a.rarity] ?? 9) - (rarityOrder[b.rarity] ?? 9);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, "ja");
      }
      const diff = (attributeOrder[a.plan] ?? 9) - (attributeOrder[b.plan] ?? 9);
      return diff !== 0 ? diff : a.name.localeCompare(b.name, "ja");
    });
    return list;
  }, [cards, query, sortKey, planFilter, rarityFilter, tendencyFilter, ownedOnly, ownership]);

  const ownedCount = Object.values(ownership).filter((v) => v >= 0).length;

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(null); // null | "unowned" | "maxed"

  const requestAllUnowned = () => setBulkPending("unowned");
  const requestAllMaxOwned = () => setBulkPending("maxed");
  const cancelBulk = () => setBulkPending(null);
  const confirmBulk = () => {
    if (bulkPending === "unowned") {
      replaceOwnership({});
      flashRegister("全てのサポカを未所持にしました");
    } else if (bulkPending === "maxed") {
      const next = {};
      cards.forEach((c) => { next[c.id] = 4; });
      replaceOwnership(next);
      flashRegister("全てのサポカを4凸（完凸）にしました");
    }
    setBulkPending(null);
  };

  const sortedCardsById = () => [...cards].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const buildOwnershipCsvRows = () => {
    const rows = [["ID", "カード名", "レアリティ", "タイプ", "所持状況"]];
    sortedCardsById().forEach((c) => {
      const level = ownership[c.id] ?? -1;
      rows.push([c.id, c.name, c.rarity || "", c.tendencyType ? TENDENCY_LABELS[c.tendencyType] : "", TOKUTSU_LABELS[level + 1]]);
    });
    return rows;
  };

  const exportOwnership = () => {
    if (backupFormat === "csv") {
      setBackupText(csvStringify(buildOwnershipCsvRows()));
    } else {
      setBackupText(JSON.stringify(ownership, null, 2));
    }
    setShowBackup(true);
    setBackupMsg("");
  };

  // CSVテキストを所持状況に反映する（不明な表記の件数を返す）
  const applyCsvText = (text) => {
    const rows = csvParse(stripBOM(text).trim());
    if (!rows.length) throw new Error("empty");
    const header = rows[0].map((h) => h.trim());
    const idIdx = header.findIndex((h) => /^(id|ID)$/.test(h));
    const statusIdx = header.findIndex((h) => /所持状況|status/i.test(h));
    if (idIdx === -1 || statusIdx === -1) throw new Error("format");
    const statusToLevel = {};
    TOKUTSU_LABELS.forEach((label, idx) => { statusToLevel[label] = idx - 1; });
    const sanitized = {};
    let dropped = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const id = (r[idIdx] || "").trim();
      if (!id) continue;
      const statusText = (r[statusIdx] || "").trim().normalize("NFKC"); // 全角数字（４凸）も半角に揃える
      if (statusText in statusToLevel) {
        sanitized[id] = statusToLevel[statusText];
      } else if (statusText === "無凸") {
        sanitized[id] = 0;
      } else if (statusText === "完凸") {
        sanitized[id] = 4;
      } else {
        // 数字が読み取れない表記は無視する
        const m = statusText.match(/-?\d+/);
        if (m) sanitized[id] = Math.max(-1, Math.min(4, Math.round(Number(m[0]))));
        else if (statusText) dropped++;
      }
    }
    replaceOwnership(sanitized);
    return dropped;
  };

  const importOwnership = () => {
    if (backupFormat === "csv") {
      try {
        const dropped = applyCsvText(backupText);
        setBackupMsg(dropped > 0 ? `CSVを読み込みました（不明な状態表記${dropped}件は無視しました）。` : "CSVを読み込みました。");
      } catch (e) {
        setBackupMsg("読み込みに失敗しました。CSV形式（ID・所持状況の列を含む）を確認してください。");
      }
      return;
    }
    try {
      const parsed = JSON.parse(stripBOM(backupText));
      const result = sanitizeOwnershipObject(parsed);
      if (!result) throw new Error("format");
      replaceOwnership(result.sanitized);
      setBackupMsg(result.droppedCount > 0 ? `所持状況を読み込みました（不正な値${result.droppedCount}件は無視しました）。` : "所持状況を読み込みました。");
    } catch (e) {
      setBackupMsg("読み込みに失敗しました。JSON形式を確認してください。");
    }
  };
  const copyBackupText = async () => {
    try {
      await navigator.clipboard.writeText(backupText);
      setBackupMsg("クリップボードにコピーしました。");
    } catch (e) {
      setBackupMsg("コピーに失敗しました。テキストを手動で選択してコピーしてください。");
    }
  };

  // UTF-8 BOM付きで保存（Excel対応）
  const downloadOwnershipCsv = () => {
    const csvText = csvStringify(buildOwnershipCsvRows());
    const blob = new Blob(["\uFEFF" + csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `サポカ所持状況_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setBackupText(csvText);
    setShowBackup(true);
    setBackupMsg("CSVファイルをダウンロードしました。");
  };

  const triggerCsvFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handleCsvFileSelected = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result;
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch (decodeErr) {
        // Excelの「CSV」保存はShift-JISになることがあるため、UTF-8で読めなければ読み直す
        try { text = new TextDecoder("shift_jis").decode(buf); } catch (e2) { text = new TextDecoder("utf-8").decode(buf); }
      }
      setBackupText(text);
      try {
        const dropped = applyCsvText(text);
        setBackupMsg(dropped > 0 ? `CSVファイルを読み込みました（不明な状態表記${dropped}件は無視しました）。` : "CSVファイルを読み込みました。");
      } catch (err) {
        setBackupMsg("読み込みに失敗しました。CSV形式（ID・所持状況の列を含む）を確認してください。");
      }
    };
    reader.onerror = () => setBackupMsg("ファイルの読み込みに失敗しました。");
    reader.readAsArrayBuffer(file);
    e.target.value = ""; // 同じファイルを再選択できるようにリセット
  };

  return (
    <div>
      <Panel title="自分のサポカを登録" help={HELP.register}>
        <div style={{ fontSize: 12, color: "rgba(245,240,255,0.55)", marginBottom: 14 }}>
          所持しているカードの凸数を選択してください。
          （現在の所持カード数：{ownedCount}枚）
        </div>

        <div style={{ marginBottom: 14 }}>
          <button onClick={() => { setBulkOpen((v) => !v); setBulkPending(null); }} style={{ ...inputStyle, cursor: "pointer" }}>
            {bulkOpen ? "一括変更を閉じる" : "一括変更する"}
          </button>
          {registerMsg && <span style={{ marginLeft: 10, fontSize: 12, color: "#ffd166" }}>{registerMsg}</span>}
          {bulkOpen && (
            <div style={{ marginTop: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12, maxWidth: 480 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={requestAllUnowned} style={primaryBtn}>全て未所持にする</button>
                <button onClick={requestAllMaxOwned} style={primaryBtn}>全て完凸（4凸）にする</button>
              </div>
              {bulkPending && (
                <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.06)" }}>
                  <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.85)", marginBottom: 8 }}>
                    {bulkPending === "unowned"
                      ? `所持しているすべてのサポカ（${cards.length}枚）を「未所持」にします。よろしいですか？`
                      : `すべてのサポカ（${cards.length}枚）を「4凸（完凸）」にします。よろしいですか？`}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={confirmBulk} style={dangerBtn}>実行する</button>
                    <button onClick={cancelBulk} style={{ ...inputStyle, cursor: "pointer" }}>キャンセル</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前で検索"
            style={{ ...inputStyle, minWidth: 220 }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "rgba(245,240,255,0.55)" }}>並び替え：</span>
            <SegButton active={sortKey === "plan"} onClick={() => setSortKey("plan")} color="#ffd166">属性順</SegButton>
            <SegButton active={sortKey === "rarity"} onClick={() => setSortKey("rarity")} color="#ffd166">レア度順</SegButton>
            <SegButton active={sortKey === "name"} onClick={() => setSortKey("name")} color="#ffd166">名前順</SegButton>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "rgba(245,240,255,0.55)" }}>属性：</span>
            <SegButton active={planFilter === "all"} onClick={() => setPlanFilter("all")} color="#5ec8ff">すべて</SegButton>
            {CARD_ATTRIBUTES.map((pl) => (
              <SegButton key={pl} active={planFilter === pl} onClick={() => setPlanFilter(pl)} color={PLAN_COLORS[pl].accent}>{pl}</SegButton>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "rgba(245,240,255,0.55)" }}>レア度：</span>
            <SegButton active={rarityFilter === "all"} onClick={() => setRarityFilter("all")} color="#5ec8ff">すべて</SegButton>
            {RARITIES.map((r) => (
              <SegButton key={r} active={rarityFilter === r} onClick={() => setRarityFilter(r)} color={RARITY_COLORS[r].accent}>{r}</SegButton>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "rgba(245,240,255,0.55)" }}>タイプ：</span>
            <SegButton active={tendencyFilter === "all"} onClick={() => setTendencyFilter("all")} color="#5ec8ff">すべて</SegButton>
            {TENDENCY_STAT_IDS.map((id) => (
              <SegButton key={id} active={tendencyFilter === id} onClick={() => setTendencyFilter(id)} color={tendencyColor(id).accent}>{TENDENCY_LABELS[id]}</SegButton>
            ))}
          </div>
          <label style={{ fontSize: 12, color: "rgba(245,240,255,0.6)", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} />
            所持済みのみ表示
          </label>
          <button onClick={exportOwnership} style={{ ...inputStyle, cursor: "pointer", marginLeft: "auto" }}>所持状況のバックアップ</button>
        </div>

        {showBackup && (
          <div style={{ marginBottom: 16, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "rgba(245,240,255,0.55)" }}>形式：</span>
              <SegButton active={backupFormat === "csv"} onClick={() => { setBackupFormat("csv"); setBackupMsg(""); }} color="#ffd166">CSV</SegButton>
              <SegButton active={backupFormat === "json"} onClick={() => { setBackupFormat("json"); setBackupMsg(""); }} color="#ffd166">JSON</SegButton>
              <button onClick={exportOwnership} style={{ ...inputStyle, cursor: "pointer", marginLeft: "auto" }}>この形式で書き出す</button>
            </div>
            {backupFormat === "csv" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <button onClick={downloadOwnershipCsv} style={{ ...inputStyle, cursor: "pointer" }}>ファイルをダウンロード</button>
                <button onClick={triggerCsvFileUpload} style={{ ...inputStyle, cursor: "pointer" }}>ファイルをアップロード</button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileSelected}
                  style={{ display: "none" }}
                />
              </div>
            )}
            <textarea
              value={backupText}
              onChange={(e) => setBackupText(e.target.value)}
              rows={8}
              style={{ ...inputStyle, width: "100%", fontFamily: "monospace", fontSize: 11.5, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={copyBackupText} style={{ ...inputStyle, cursor: "pointer" }}>コピー</button>
              <button onClick={importOwnership} style={primaryBtn}>読み込む</button>
              <button onClick={() => { setShowBackup(false); setBackupMsg(""); }} style={{ ...inputStyle, cursor: "pointer" }}>閉じる</button>
              {backupMsg && <span style={{ fontSize: 12, color: "#ffd166" }}>{backupMsg}</span>}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {visibleCards.map((c) => {
            const tc = tendencyColor(c.tendencyType);
            return (
            <div key={c.id} style={{ border: `1px solid ${tc.accent}55`, borderRadius: 12, padding: 10, background: `${tc.soft}` }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <CardThumb card={c} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                    <PlanTag plan={c.plan} small />
                    {c.rarity && <RarityTag rarity={c.rarity} small />}
                    <TendencyTag tendencyType={c.tendencyType} small />
                    {c.hasSP && <span style={{ fontSize: 10, color: "#ffd166", border: "1px solid #ffd16688", borderRadius: 6, padding: "0 5px" }}>SP</span>}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: "rgba(245,240,255,0.5)", marginBottom: 6 }}>
                {c.itemKind === "card" ? "Pカード" : "Pアイテム"}: {c.itemName || "（未設定）"}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {TOKUTSU_LABELS.map((label, idx) => {
                  const level = idx - 1;
                  const active = (ownership[c.id] ?? -1) === level;
                  return (
                    <button
                      key={label}
                      onClick={() => updateOwnership(c.id, level)}
                      style={{
                        fontSize: 11,
                        padding: "3px 7px",
                        borderRadius: 7,
                        border: `1px solid ${active ? tc.accent : "rgba(255,255,255,0.15)"}`,
                        background: active ? tc.accent : "transparent",
                        color: active ? "#151225" : "rgba(245,240,255,0.6)",
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            );
          })}
          {!visibleCards.length && (
            <div style={{ fontSize: 13, color: "rgba(245,240,255,0.5)" }}>該当するカードが見つかりません。</div>
          )}
        </div>
      </Panel>
    </div>
  );
}

/* ---------- 利用者モード：点数計算ページ ---------- */

function ScoreView({ scenarios, settings, formation, updateSettings, cards, ownership, parameters, firstSlotConfig, currentPattern, currentCardTypePolicy, extraCounts }) {
  const [checkCardId, setCheckCardId] = useState(null);
  const [checkCardSearch, setCheckCardSearch] = useState("");
  const [checkTokutsu, setCheckTokutsu] = useState(4);
  const [detail, setDetail] = useState(null);
  const [rankTab, setRankTab] = useState("all"); // "all" | "p_vo" | "p_da" | "p_vi"
  const [lockedSearch, setLockedSearch] = useState("");
  const counts = settings.counts || { p_vo: 0, p_da: 0, p_vi: 0 };
  const spCounts = settings.spCounts || { p_vo: 0, p_da: 0, p_vi: 0 };

  const setCount = (id, value) => {
    const v = Math.max(0, Number(value) || 0);
    const nextCounts = { ...counts, [id]: v };
    const nextSp = { ...spCounts, [id]: Math.min(spCounts[id] || 0, v) };
    updateSettings({ counts: nextCounts, spCounts: nextSp });
  };
  const setSp = (id, value) => {
    const v = Math.max(0, Math.min(Number(value) || 0, counts[id] || 0));
    updateSettings({ spCounts: { ...spCounts, [id]: v } });
  };

  const currentScenario = scenarios.find((s) => s.id === settings.scenarioId) || scenarios[0];
  const patterns = currentScenario?.patterns || [];
  const cardTypePolicies = (currentScenario?.cardTypePolicies || []).filter((p) => p.name.startsWith(settings.plan));
  const totalCount = TENDENCY_STAT_IDS.reduce((s, id) => s + (counts[id] || 0), 0);

  const formationDefaultsPatch = (mainType, patternId) => {
    const p = patterns.find((pt) => pt.id === patternId);
    const def = p?.formationDefaults?.[mainType];
    if (!def) return {};
    return { counts: def.counts, spCounts: def.spCounts };
  };

  const selectScenario = (scenarioId) => {
    const sc = scenarios.find((s) => s.id === scenarioId);
    const firstCtp = sc?.cardTypePolicies?.find((p) => p.name.startsWith(settings.plan)) || sc?.cardTypePolicies?.[0];
    const firstPatternId = sc?.patterns[0]?.id;
    updateSettings({ scenarioId, patternId: firstPatternId, cardTypePolicyId: firstCtp?.id || null, ...formationDefaultsPatch(settings.mainType, firstPatternId) });
  };

  const selectPattern = (patternId) => {
    const p = patterns.find((pt) => pt.id === patternId);
    const patch = { patternId, ...formationDefaultsPatch(settings.mainType, patternId) };
    if (p?.defaultManualCountAdditions) {
      patch.enableManualCountAdditions = true;
      patch.manualCountAdditions = p.defaultManualCountAdditions;
    }
    if (p?.defaultLockedCards) {
      patch.enableLockedCards = true;
      patch.lockedCards = p.defaultLockedCards;
    }
    updateSettings(patch);
  };

  const selectPlan = (plan) => {
    const firstCtp = currentScenario?.cardTypePolicies?.find((p) => p.name.startsWith(plan)) || null;
    updateSettings({ plan, cardTypePolicyId: firstCtp?.id || null });
  };

  const selectMainType = (key) => {
    updateSettings({ mainType: key, ...formationDefaultsPatch(key, settings.patternId) });
  };

  const setManualUnits = (defId, units) => {
    updateSettings({ manualCountAdditions: { ...(settings.manualCountAdditions || {}), [defId]: units } });
  };

  const lockedCards = settings.lockedCards || [];
  const lockedSearchResults = useMemo(() => {
    const q = lockedSearch.trim().toLowerCase();
    let list = cards.filter((c) => c.plan === settings.plan || c.plan === "共通");
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "ja")).slice(0, 30);
  }, [cards, lockedSearch, settings.plan]);

  const addLockedCard = (cardId) => {
    if (lockedCards.length >= 6 || lockedCards.some((lc) => lc.cardId === cardId)) return;
    updateSettings({ lockedCards: [...lockedCards, { cardId, asRental: false }] });
  };
  const removeLockedCard = (cardId) => {
    updateSettings({ lockedCards: lockedCards.filter((lc) => lc.cardId !== cardId) });
  };
  const toggleLockedRental = (cardId, asRental) => {
    updateSettings({ lockedCards: lockedCards.map((lc) => (lc.cardId === cardId ? { ...lc, asRental } : lc)) });
  };

  const usedIds = new Set([...formation.ownSlots, ...formation.rentals].map((e) => e.card.id));
  const runnersUp = {};
  TENDENCY_STAT_IDS.forEach((stat) => {
    runnersUp[stat] = formation.ownedScored
      .filter((e) => e.card.tendencyType === stat && !usedIds.has(e.card.id))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
  });

  const rankPool = [...formation.ownedScored].sort((a, b) => b.score - a.score);
  const rankFiltered = rankTab === "all" ? rankPool : rankPool.filter((e) => e.card.tendencyType === rankTab);
  const rankTop10 = rankFiltered.slice(0, 10);

  const checkCardSearchResults = useMemo(() => {
    const q = checkCardSearch.trim().toLowerCase();
    let list = cards;
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "ja")).slice(0, 30);
  }, [cards, checkCardSearch]);
  const checkCard = cards.find((c) => c.id === checkCardId) || null;
  const exOptionsForCheck = { includeExParamEvent: settings.includeExParamEvent !== false, includeExItem: settings.includeExItem !== false, exItemDiscount: settings.exItemDiscount || 0 };
  const lessonCountsForCheck = currentPattern?.distributionByMainType?.[settings.mainType] || { p_vo: 0, p_da: 0, p_vi: 0 };
  const checkResult = (checkCard && currentPattern && firstSlotConfig)
    ? cardScore(checkCard, checkTokutsu, currentPattern, parameters, settings.mainType, firstSlotConfig, exOptionsForCheck, lessonCountsForCheck, currentCardTypePolicy, extraCounts)
    : null;

  return (
    <div>
      <Panel title="育成条件" help={HELP.conditions}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <FieldLabel>プラン</FieldLabel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {SELECTABLE_PLANS.map((pl) => (
                <SegButton key={pl} active={settings.plan === pl} onClick={() => selectPlan(pl)} color={PLAN_COLORS[pl].accent}>
                  {pl}
                </SegButton>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>傾向</FieldLabel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(MAIN_TYPE_DEFS).map(([key, def]) => (
                <SegButton key={key} active={settings.mainType === key} onClick={() => selectMainType(key)} color="#b98bff">
                  {def.label}型（サブ：{TENDENCY_LABELS[def.sub]}）
                </SegButton>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>育成シナリオ</FieldLabel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {scenarios.map((s) => (
                <SegButton key={s.id} active={settings.scenarioId === s.id} onClick={() => selectScenario(s.id)} color="#5ec8ff">
                  {s.name}
                </SegButton>
              ))}
            </div>
            <FieldLabel>シナリオ進行パターン</FieldLabel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {patterns.map((p) => (
                <SegButton key={p.id} active={settings.patternId === p.id} onClick={() => selectPattern(p.id)} color="#5ec8ff">
                  {p.name}
                </SegButton>
              ))}
            </div>
            <FieldLabel>カード種別方針</FieldLabel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {cardTypePolicies.map((p) => (
                <SegButton key={p.id} active={settings.cardTypePolicyId === p.id} onClick={() => updateSettings({ cardTypePolicyId: p.id })} color="#4ade80">
                  {p.name}
                </SegButton>
              ))}
              {!cardTypePolicies.length && (
                <span style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>現在のプランに対応するカード種別方針が登録されていません。</span>
              )}
            </div>
          </div>

          <div>
            <FieldLabel>編成枚数指定</FieldLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {TENDENCY_STAT_IDS.map((id) => (
                <div key={id} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.7)", width: 24 }}>{TENDENCY_LABELS[id]}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: "rgba(245,240,255,0.5)" }}>編成枚数</span>
                    <input type="number" min={0} max={6} value={counts[id] ?? 0} onChange={(e) => setCount(id, e.target.value)} style={{ ...inputStyle, width: 60 }} />
                    <span style={{ fontSize: 11.5, color: "rgba(245,240,255,0.5)" }}>枚</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: "rgba(245,240,255,0.5)" }}>うちSP</span>
                    <input type="number" min={0} max={counts[id] ?? 0} value={spCounts[id] ?? 0} onChange={(e) => setSp(id, e.target.value)} style={{ ...inputStyle, width: 60 }} />
                    <span style={{ fontSize: 11.5, color: "rgba(245,240,255,0.5)" }}>枚</span>
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                fontSize: 12,
                marginTop: 8,
                fontWeight: 700,
                color: totalCount === 6 ? "rgba(245,240,255,0.55)" : "#ff8a8a",
              }}
            >
              {totalCount === 6
                ? `合計 ${totalCount} 枚指定中`
                : `⚠ 合計が${totalCount}枚になっています。必ず合計6枚になるように調整してください。`}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!settings.ssrOnlyFormation}
                onChange={(e) => updateSettings({ ssrOnlyFormation: e.target.checked })}
              />
              SSR・配布SSRのみで自動選出する（SRは対象から除外）
            </label>
          </div>

          <div>
            <FieldLabel>EXステータスの計算対象</FieldLabel>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12.5, color: "rgba(245,240,255,0.75)", display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={settings.includeExParamEvent !== false}
                  onChange={(e) => updateSettings({ includeExParamEvent: e.target.checked })}
                />
                パラメータイベントパラメータを含める
              </label>
              <label style={{ fontSize: 12.5, color: "rgba(245,240,255,0.75)", display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={settings.includeExItem !== false}
                  onChange={(e) => updateSettings({ includeExItem: e.target.checked })}
                />
                Pアイテムパラメータを含める
              </label>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.75)", marginBottom: 4 }}>
                Pアイテムパラメータ（回数制限なし・パラメータ連動分）の見積もり
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[0, 1, 2, 3].map((d) => (
                  <SegButton
                    key={d}
                    active={(settings.exItemDiscount || 0) === d}
                    onClick={() => updateSettings({ exItemDiscount: d })}
                    color="#ffd166"
                  >
                    {d === 0 ? "理論値" : `理論値－${d}`}
                  </SegButton>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12.5, color: "rgba(245,240,255,0.8)", display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={!!settings.enableManualCountAdditions}
                onChange={(e) => updateSettings({ enableManualCountAdditions: e.target.checked })}
              />
              追加回数を手動調整する
            </label>
            {settings.enableManualCountAdditions && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {MANUAL_COUNT_ADDITIONS.map((def) => {
                  const units = settings.manualCountAdditions?.[def.id] || 0;
                  return (
                    <div key={def.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.75)", minWidth: 220 }}>{def.label}</div>
                      <select value={units} onChange={(e) => setManualUnits(def.id, Number(e.target.value))} style={{ ...inputStyle, width: 160 }}>
                        <option value={0}>なし</option>
                        {Array.from({ length: def.maxUnits }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>{n}回（{n * def.perUnit}{def.unitNoun}）</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: 12.5, color: "rgba(245,240,255,0.8)", display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={!!settings.enableLockedCards}
                onChange={(e) => updateSettings({ enableLockedCards: e.target.checked })}
              />
              確定サポカを設定する（最大6枚）
            </label>
            {settings.enableLockedCards && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {lockedCards.map((lc) => {
                    const card = cards.find((c) => c.id === lc.cardId);
                    if (!card) return null;
                    return (
                      <div key={lc.cardId} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${tendencyColor(card.tendencyType).accent}55`, borderRadius: 10, padding: "6px 10px" }}>
                        <CardThumb card={card} size={30} />
                        <div style={{ fontSize: 12.5, flex: 1, minWidth: 120 }}>{card.name}</div>
                        <label style={{ fontSize: 11.5, color: "rgba(245,240,255,0.7)", display: "flex", alignItems: "center", gap: 5 }}>
                          <input type="radio" name={`rental-${lc.cardId}`} checked={!lc.asRental} onChange={() => toggleLockedRental(lc.cardId, false)} />
                          自前で確定
                        </label>
                        <label style={{ fontSize: 11.5, color: "rgba(245,240,255,0.7)", display: "flex", alignItems: "center", gap: 5 }}>
                          <input type="radio" name={`rental-${lc.cardId}`} checked={!!lc.asRental} onChange={() => toggleLockedRental(lc.cardId, true)} />
                          レンタルで確定
                        </label>
                        <button onClick={() => removeLockedCard(lc.cardId)} style={dangerBtn}>外す</button>
                      </div>
                    );
                  })}
                  {!lockedCards.length && (
                    <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>まだ確定サポカが設定されていません。</div>
                  )}
                </div>
                {lockedCards.length < 6 ? (
                  <>
                    <input
                      value={lockedSearch}
                      onChange={(e) => setLockedSearch(e.target.value)}
                      placeholder="名前で検索して追加（未入力ですべて表示）"
                      style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                      {lockedSearchResults.map((c) => {
                        const already = lockedCards.some((lc) => lc.cardId === c.id);
                        return (
                          <button
                            key={c.id}
                            onClick={() => addLockedCard(c.id)}
                            disabled={already}
                            style={{
                              display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                              padding: "5px 8px", borderRadius: 8, cursor: already ? "default" : "pointer",
                              border: "1px solid rgba(255,255,255,0.1)", background: already ? "rgba(255,255,255,0.04)" : "transparent",
                              color: already ? "rgba(245,240,255,0.35)" : "#f5f0ff", opacity: already ? 0.6 : 1,
                            }}
                          >
                            <CardThumb card={c} size={24} />
                            <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                            {already && <span style={{ fontSize: 10, color: "rgba(245,240,255,0.4)" }}>追加済み</span>}
                          </button>
                        );
                      })}
                      {!lockedSearchResults.length && (
                        <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)", padding: 6 }}>該当するカードが見つかりません。</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>確定サポカは最大6枚まで設定できます。</div>
                )}
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="推奨編成" help={HELP.formation}>
        {TENDENCY_STAT_IDS.map((id) => {
          const shortfall = formation.shortfalls?.[id];
          if (!shortfall) return null;
          return (
            <div key={id} style={{ marginBottom: 8, fontSize: 12.5, color: "#ffd166" }}>
              ⚠ {TENDENCY_LABELS[id]}の指定枚数に対して所持カードが{shortfall}枚不足しています。「サポカ登録」で所持カードを増やすか、指定枚数を調整してください。
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
          {formation.ownSlots.map((e) => (
            <CardChip key={e.card.id} entry={e} highlight onClick={() => setDetail(e)} />
          ))}
          {formation.rentals.map((e) => (
            <CardChip key={"rental-" + e.card.id} entry={e} rental onClick={() => setDetail(e)} />
          ))}
          {!formation.ownSlots.length && !formation.rentals.length && (
            <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)", padding: 12 }}>「育成条件」で編成枚数を指定してください。</div>
          )}
        </div>
        <div style={{ fontSize: 13, color: "rgba(245,240,255,0.7)" }}>
          編成合計スコア：<span style={{ fontSize: 20, fontWeight: 800, color: "#ffd166" }}>{Math.round(formation.teamTotal)}</span>
          <span style={{ marginLeft: 10, fontSize: 11, color: "rgba(245,240,255,0.45)" }}>（自前{formation.ownSlots.length}枚 + レンタル{formation.rentals.length}枚）</span>
        </div>
      </Panel>

      <Panel title="次点のサポートカード" help={HELP.runnerUp}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {TENDENCY_STAT_IDS.map((stat) => (
            <div key={stat}>
              <FieldLabel>{TENDENCY_LABELS[stat]}</FieldLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                {runnersUp[stat].map((e) => (
                  <CardChip key={e.card.id} entry={e} onClick={() => setDetail(e)} />
                ))}
                {!runnersUp[stat].length && (
                  <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)", padding: 8 }}>該当する候補がありません。</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="編成の内訳（6枚全て）" help={HELP.breakdown}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[...formation.ownSlots.map((e) => ({ e, rental: false })), ...formation.rentals.map((e) => ({ e, rental: true }))].map(({ e, rental }, idx) => {
            const c = tendencyColor(e.card.tendencyType);
            const zeroEntries = e.breakdown.filter((b) => b.isZero);
            return (
              <div key={(rental ? "rental-" : "own-") + e.card.id} style={{ border: `1px solid ${c.accent}55`, borderRadius: 14, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                  <CardThumb card={e.card} size={40} colorMode="tendency" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#f5f0ff" }}>
                      {idx + 1}. {e.card.name}
                      {rental && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#151225", background: "#ffd166", padding: "1px 7px", borderRadius: 999 }}>レンタル</span>}
                    </div>
                    <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                      <PlanTag plan={e.card.plan} small />
                      {e.card.rarity && <RarityTag rarity={e.card.rarity} small />}
                      <TendencyTag tendencyType={e.card.tendencyType} small />
                      <span style={{ fontSize: 10.5, color: "rgba(245,240,255,0.5)" }}>{TOKUTSU_LABELS[e.tokutsu + 1]}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: c.accent, fontVariantNumeric: "tabular-nums" }}>{Math.round(e.score)}点</div>
                </div>

                {zeroEntries.length > 0 && (
                  <div style={{ fontSize: 11, color: "#ffd166", marginBottom: 8 }}>
                    ⚠ 0点の項目が{zeroEntries.length}件あります：{zeroEntries.map((b) => b.param.name).join("、")}
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {e.breakdown.length === 0 && (
                    <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>加算される項目がありません。</div>
                  )}
                  {e.breakdown.map((b, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: b.isZero ? "#ffd166" : "rgba(245,240,255,0.75)" }}>
                      <div>
                        {b.param.name}
                        {b.count != null && b.value != null && <span style={{ color: "rgba(245,240,255,0.45)", marginLeft: 6 }}>（{b.value}点 × {b.count}回）</span>}
                        {b.isZero && <span style={{ marginLeft: 6, fontSize: 10 }}>⚠</span>}
                      </div>
                      <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{Math.round(b.contribution)}点</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, color: "#f5f0ff", marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div>カード合計</div>
                  <div>{Math.round(e.score)}点</div>
                </div>
              </div>
            );
          })}
          {!formation.ownSlots.length && !formation.rentals.length && (
            <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>「育成条件」で編成枚数を指定してください。</div>
          )}
        </div>
      </Panel>

      <Panel title="この育成条件でのランキング（所持カードTOP10）" help={HELP.ranking}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <SegButton active={rankTab === "all"} onClick={() => setRankTab("all")} color="#5ec8ff">すべて</SegButton>
          {TENDENCY_STAT_IDS.map((stat) => (
            <SegButton key={stat} active={rankTab === stat} onClick={() => setRankTab(stat)} color="#5ec8ff">{TENDENCY_LABELS[stat]}のみ</SegButton>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rankTop10.map((e, i) => {
            const c = tendencyColor(e.card.tendencyType);
            return (
              <div
                key={e.card.id}
                onClick={() => setDetail(e)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                  borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)",
                  background: i < 3 ? c.soft : "rgba(255,255,255,0.02)",
                  cursor: "pointer",
                }}
              >
                <div style={{ width: 22, textAlign: "center", fontSize: 12, fontWeight: 700, color: "rgba(245,240,255,0.5)" }}>{i + 1}</div>
                <CardThumb card={e.card} size={34} colorMode="tendency" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.card.name}</div>
                  <div style={{ display: "flex", gap: 5, marginTop: 2, flexWrap: "wrap" }}>
                    <PlanTag plan={e.card.plan} small />
                    <TendencyTag tendencyType={e.card.tendencyType} small />
                    <span style={{ fontSize: 10.5, color: "rgba(245,240,255,0.5)" }}>{TOKUTSU_LABELS[e.tokutsu + 1]}</span>
                  </div>
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: c.accent, fontVariantNumeric: "tabular-nums" }}>{Math.round(e.score)}</div>
              </div>
            );
          })}
          {!rankTop10.length && (
            <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>該当する所持カードがありません。</div>
          )}
        </div>
      </Panel>

      <Panel title="サポカの点数を調べる" help={HELP.checker}>

        {checkCard ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <CardThumb card={checkCard} size={40} colorMode="tendency" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{checkCard.name}</div>
                <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                  <PlanTag plan={checkCard.plan} small />
                  {checkCard.rarity && <RarityTag rarity={checkCard.rarity} small />}
                  <TendencyTag tendencyType={checkCard.tendencyType} small />
                </div>
              </div>
              <button onClick={() => setCheckCardId(null)} style={dangerBtn}>選び直す</button>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {[0, 1, 2, 3, 4].map((lvl) => (
                <SegButton key={lvl} active={checkTokutsu === lvl} onClick={() => setCheckTokutsu(lvl)} color="#5ec8ff">
                  {TOKUTSU_LABELS[lvl + 1]}
                </SegButton>
              ))}
            </div>

            {checkResult && (
              <div style={{ border: `1px solid ${tendencyColor(checkCard.tendencyType).accent}55`, borderRadius: 14, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.7)" }}>合計スコア</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#ffd166" }}>{Math.round(checkResult.total)}点</div>
                </div>
                {checkResult.breakdown.filter((b) => b.isZero).length > 0 && (
                  <div style={{ fontSize: 11, color: "#ffd166", marginBottom: 8 }}>
                    ⚠ 0点の項目が{checkResult.breakdown.filter((b) => b.isZero).length}件あります：{checkResult.breakdown.filter((b) => b.isZero).map((b) => b.param.name).join("、")}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {checkResult.breakdown.length === 0 && (
                    <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>加算される項目がありません。</div>
                  )}
                  {checkResult.breakdown.map((b, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: b.isZero ? "#ffd166" : "rgba(245,240,255,0.75)" }}>
                      <div>
                        {b.param.name}
                        {b.count != null && b.value != null && <span style={{ color: "rgba(245,240,255,0.45)", marginLeft: 6 }}>（{b.value}点 × {b.count}回）</span>}
                        {b.isZero && <span style={{ marginLeft: 6, fontSize: 10 }}>⚠</span>}
                      </div>
                      <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{Math.round(b.contribution)}点</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <input
              value={checkCardSearch}
              onChange={(e) => setCheckCardSearch(e.target.value)}
              placeholder="名前で検索して選択（未入力ですべて表示）"
              style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
              {checkCardSearchResults.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCheckCardId(c.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                    padding: "5px 8px", borderRadius: 8, cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#f5f0ff",
                  }}
                >
                  <CardThumb card={c} size={24} colorMode="tendency" />
                  <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                </button>
              ))}
              {!checkCardSearchResults.length && (
                <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)", padding: 6 }}>該当するカードが見つかりません。</div>
              )}
            </div>
          </div>
        )}
      </Panel>

      {detail && <ScoreBreakdown entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/* ---------- 管理者モード（CMS） ---------- */

function AdminView({ parameters, scenarios, cards, firstSlotConfig, saveParams, saveScenarios, saveCards, saveFirstSlotConfig, ownership, settings, replaceOwnership, updateSettingsFull, flash }) {
  const [tab, setTab] = useState("params");
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <SegButton active={tab === "params"} onClick={() => setTab("params")} color="#5ec8ff">パラメータ管理</SegButton>
        <SegButton active={tab === "scenarios"} onClick={() => setTab("scenarios")} color="#5ec8ff">育成シナリオ管理</SegButton>
        <SegButton active={tab === "cards"} onClick={() => setTab("cards")} color="#5ec8ff">カードマスター管理</SegButton>
        <SegButton active={tab === "backup"} onClick={() => setTab("backup")} color="#5ec8ff">バックアップ</SegButton>
      </div>
      <div style={{ fontSize: 12, color: "#ffd166", marginBottom: 16 }}>
        ※ ここでの編集内容は全ユーザーに共有されるマスターデータです。
      </div>
      {tab === "params" && (
        <>
          <FirstSlotAdmin config={firstSlotConfig} save={saveFirstSlotConfig} />
          <ParamsAdmin parameters={parameters} cards={cards} save={saveParams} />
        </>
      )}
      {tab === "scenarios" && <ScenariosAdmin parameters={parameters} scenarios={scenarios} cards={cards} save={saveScenarios} />}
      {tab === "cards" && <CardsAdmin parameters={parameters} cards={cards} save={saveCards} />}
      {tab === "backup" && (
        <MasterBackupAdmin
          parameters={parameters} scenarios={scenarios} cards={cards} firstSlotConfig={firstSlotConfig}
          saveParams={saveParams} saveScenarios={saveScenarios} saveCards={saveCards} saveFirstSlotConfig={saveFirstSlotConfig}
          ownership={ownership} settings={settings} replaceOwnership={replaceOwnership} updateSettingsFull={updateSettingsFull}
          flash={flash}
        />
      )}
    </div>
  );
}

/* ---------- 管理者モード：サブ枠1（固定値／レッスンボーナス／なし）設定 ---------- */

function FirstSlotAdmin({ config, save }) {
  if (!config) return null;
  const updateMultiplier = (key, v) => save({ ...config, [key]: Math.max(0, Number(v) || 0) });
  const updateTable = (rarity, idx, v) => {
    const table = { ...config.fixedValueTable };
    const arr = [...(table[rarity] || [0, 0, 0, 0, 0])];
    arr[idx] = Number(v) || 0;
    table[rarity] = arr;
    save({ ...config, fixedValueTable: table });
  };

  return (
    <Panel title="サブ枠1：固定値／レッスンボーナス／なし の設定" help={HELP.firstSlot}>
      <div style={{ display: "flex", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <FieldLabel>メイン倍率（傾向と一致する場合）</FieldLabel>
          <input type="number" step="0.1" value={config.mainMultiplier} onChange={(e) => updateMultiplier("mainMultiplier", e.target.value)} style={{ ...inputStyle, width: 90 }} />
        </div>
        <div>
          <FieldLabel>サブ倍率（傾向と一致しない場合）</FieldLabel>
          <input type="number" step="0.1" value={config.subMultiplier} onChange={(e) => updateMultiplier("subMultiplier", e.target.value)} style={{ ...inputStyle, width: 90 }} />
        </div>
      </div>
      <FieldLabel>固定値テーブル（レアリティ × 凸数）</FieldLabel>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={thStyle}>レアリティ</th>
            {TOKUTSU_LABELS.slice(1).map((l) => <th key={l} style={thStyle}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {RARITIES.map((r) => (
            <tr key={r}>
              <td style={tdStyle}><RarityTag rarity={r} small /></td>
              {[0, 1, 2, 3, 4].map((idx) => (
                <td style={tdStyle} key={idx}>
                  <input type="number" value={config.fixedValueTable?.[r]?.[idx] ?? 0} onChange={(e) => updateTable(r, idx, e.target.value)} style={{ ...inputStyle, width: 60 }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function ParamsAdmin({ parameters, cards, save }) {
  const [name, setName] = useState("");
  const [rarityTab, setRarityTab] = useState(RARITIES[0]);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const cardsUsingParam = (id) => (cards || []).filter((c) => (c.subParams || []).includes(id));

  const add = () => {
    if (!name.trim()) return;
    const id = "p" + Date.now();
    save([...parameters, { id, name: name.trim(), valuesByRarity: valuesForAllRarities(0, 0), maxCount: null }]);
    setName("");
  };
  const requestRemove = (id) => {
    const using = cardsUsingParam(id);
    if (using.length > 0) {
      setPendingDeleteId(id);
    } else {
      save(parameters.filter((p) => p.id !== id));
    }
  };
  const confirmRemove = () => {
    save(parameters.filter((p) => p.id !== pendingDeleteId));
    setPendingDeleteId(null);
  };
  const updateName = (id, v) => {
    save(parameters.map((p) => (p.id === id ? { ...p, name: v } : p)));
  };
  const updateValue = (id, idx, v) => {
    save(parameters.map((p) => {
      if (p.id !== id) return p;
      const table = { ...(p.valuesByRarity || {}) };
      const arr = [...(table[rarityTab] || [0, 0, 0, 0, 0])];
      arr[idx] = Number(v) || 0;
      table[rarityTab] = arr;
      return { ...p, valuesByRarity: table };
    }));
  };
  const toggleMaxCount = (id, checked) => {
    save(parameters.map((p) => (p.id === id ? { ...p, maxCount: checked ? (p.maxCount ?? 1) : null } : p)));
  };
  const updateMaxCount = (id, v) => {
    save(parameters.map((p) => (p.id === id ? { ...p, maxCount: Math.max(0, Number(v) || 0) } : p)));
  };
  const moveParam = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    const next = [...parameters];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    save(next);
  };
  const dragParamIndexRef = useRef(null);
  const [overParamIndex, setOverParamIndex] = useState(null);

  const STAGE_LABELS = ["1段階目", "2段階目", "3段階目", "4段階目", "5段階目"];

  return (
    <Panel title="パラメータ一覧" help={HELP.params}>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "rgba(245,240,255,0.55)" }}>編集するレアリティ：</span>
        {RARITIES.map((r) => (
          <SegButton key={r} active={rarityTab === r} onClick={() => setRarityTab(r)} color={RARITY_COLORS[r].accent}>{r}</SegButton>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 16 }}>
        <thead>
          <tr>
            <th style={thStyle}></th>
            <th style={thStyle}>パラメータ名</th>
            {STAGE_LABELS.map((l) => <th key={l} style={thStyle}>{l}</th>)}
            <th style={thStyle}>上限あり</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {parameters.map((p, idx) => (
            <tr
              key={p.id}
              onDragOver={(e) => { e.preventDefault(); setOverParamIndex(idx); }}
              onDragLeave={() => setOverParamIndex((cur) => (cur === idx ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragParamIndexRef.current;
                setOverParamIndex(null);
                if (from == null || from === idx) return;
                moveParam(from, idx);
                dragParamIndexRef.current = null;
              }}
              style={{ outline: overParamIndex === idx ? "2px dashed rgba(255,255,255,0.4)" : "none" }}
            >
              <td style={{ ...tdStyle, width: 28 }}>
                <span
                  draggable
                  onDragStart={() => { dragParamIndexRef.current = idx; }}
                  onDragEnd={() => { dragParamIndexRef.current = null; setOverParamIndex(null); }}
                  style={{ cursor: "grab", fontSize: 16, color: "rgba(245,240,255,0.4)", userSelect: "none", display: "inline-block", padding: "0 6px" }}
                >≡</span>
              </td>
              <td style={tdStyle}>
                <input
                  value={p.name}
                  onChange={(e) => updateName(p.id, e.target.value)}
                  style={{ ...inputStyle, width: 180 }}
                />
                {p.lessonDependent && <span style={{ marginLeft: 6, fontSize: 10, color: "#ffd166" }}>（メイン限定）</span>}
              </td>
              {[0, 1, 2, 3, 4].map((stageIdx) => (
                <td style={tdStyle} key={stageIdx}>
                  <input type="number" value={p.valuesByRarity?.[rarityTab]?.[stageIdx] ?? 0} onChange={(e) => updateValue(p.id, stageIdx, e.target.value)} style={{ ...inputStyle, width: 56 }} />
                </td>
              ))}
              <td style={tdStyle}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={p.maxCount != null} onChange={(e) => toggleMaxCount(p.id, e.target.checked)} />
                  <input
                    type="number"
                    min={0}
                    disabled={p.maxCount == null}
                    value={p.maxCount ?? ""}
                    onChange={(e) => updateMaxCount(p.id, e.target.value)}
                    style={{ ...inputStyle, width: 60, opacity: p.maxCount == null ? 0.4 : 1 }}
                  />
                </label>
              </td>
              <td style={tdStyle}>
                <button onClick={() => requestRemove(p.id)} style={dangerBtn}>削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新しい項目名（例：チェンジ回数の効果）" style={inputStyle} />
        <button onClick={add} style={primaryBtn}>追加</button>
      </div>

      {pendingDeleteId && (() => {
        const target = parameters.find((p) => p.id === pendingDeleteId);
        const using = cardsUsingParam(pendingDeleteId);
        return (
          <div
            onClick={() => setPendingDeleteId(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(10,8,18,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: "#181428", border: "1px solid #ff8a8a55", borderRadius: 18, padding: 20, maxWidth: 420, width: "100%" }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: "#f5f0ff", marginBottom: 10 }}>
                「{target?.name}」は{using.length}枚のカードで使用中です
              </div>
              <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.7)", marginBottom: 10 }}>
                削除すると、これらのカードのサブパラメータから該当項目が静かに無効化されます（0点扱いになります）。よろしいですか？
              </div>
              <div style={{ fontSize: 11.5, color: "rgba(245,240,255,0.5)", marginBottom: 14, maxHeight: 120, overflowY: "auto" }}>
                {using.map((c) => c.name).join("、")}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={confirmRemove} style={dangerBtn}>削除する</button>
                <button onClick={() => setPendingDeleteId(null)} style={{ ...inputStyle, cursor: "pointer" }}>キャンセル</button>
              </div>
            </div>
          </div>
        );
      })()}
    </Panel>
  );
}

function ScenariosAdmin({ parameters, scenarios, cards, save }) {
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id);
  const scenario = scenarios.find((s) => s.id === scenarioId) || scenarios[0];
  const [patternId, setPatternId] = useState(scenario?.patterns[0]?.id);
  const pattern = scenario?.patterns.find((p) => p.id === patternId) || scenario?.patterns[0];
  const [cardTypePolicyId, setCardTypePolicyId] = useState(scenario?.cardTypePolicies?.[0]?.id);
  const cardTypePolicy = scenario?.cardTypePolicies?.find((p) => p.id === cardTypePolicyId) || scenario?.cardTypePolicies?.[0];

  const [newScenarioName, setNewScenarioName] = useState("");
  const [newPatternName, setNewPatternName] = useState("");
  const [newCardTypePolicyName, setNewCardTypePolicyName] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null); // { kind: "pattern" | "cardTypePolicy", id, name }
  const [lockedCardSearch, setLockedCardSearch] = useState("");

  const pickScenario = (id) => {
    setScenarioId(id);
    const sc = scenarios.find((s) => s.id === id);
    setPatternId(sc?.patterns[0]?.id);
    setCardTypePolicyId(sc?.cardTypePolicies?.[0]?.id);
  };

  const addScenario = () => {
    if (!newScenarioName.trim()) return;
    const newPattern = {
      id: "pt" + Date.now(),
      name: "通常育成",
      counts: zeroCountsFor(parameters),
      distributionByMainType: {
        VoDa: { p_vo: 0, p_da: 0, p_vi: 0 },
        DaVi: { p_vo: 0, p_da: 0, p_vi: 0 },
        ViVo: { p_vo: 0, p_da: 0, p_vi: 0 },
      },
      formationDefaults: {},
    };
    const id = "sc" + Date.now();
    const next = [...scenarios, { id, name: newScenarioName.trim(), patterns: [newPattern] }];
    save(next);
    setNewScenarioName("");
    setScenarioId(id);
    setPatternId(newPattern.id);
  };
  const removeScenario = (id) => {
    if (scenarios.length <= 1) return; // 最後の1つを消すと画面が描画できなくなるため削除不可
    const next = scenarios.filter((s) => s.id !== id);
    save(next);
    if (scenarioId === id) pickScenario(next[0]?.id);
  };
  const renameScenario = (id, v) => {
    save(scenarios.map((s) => (s.id === id ? { ...s, name: v } : s)));
  };
  const moveScenario = (fromIdx, toIdx) => {
    const next = [...scenarios];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    save(next);
  };
  const moveCardTypePolicyOrder = (fromIdx, toIdx) => {
    if (!scenario) return;
    const next = scenarios.map((s) => {
      if (s.id !== scenario.id) return s;
      const arr = [...(s.cardTypePolicies || [])];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return { ...s, cardTypePolicies: arr };
    });
    save(next);
  };
  const movePatternOrder = (fromIdx, toIdx) => {
    if (!scenario) return;
    const next = scenarios.map((s) => {
      if (s.id !== scenario.id) return s;
      const arr = [...s.patterns];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return { ...s, patterns: arr };
    });
    save(next);
  };

  const addPattern = () => {
    if (!newPatternName.trim() || !scenario) return;
    const newP = {
      id: "pt" + Date.now(),
      name: newPatternName.trim(),
      counts: zeroCountsFor(parameters),
      distributionByMainType: {
        VoDa: { p_vo: 0, p_da: 0, p_vi: 0 },
        DaVi: { p_vo: 0, p_da: 0, p_vi: 0 },
        ViVo: { p_vo: 0, p_da: 0, p_vi: 0 },
      },
      formationDefaults: {},
    };
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, patterns: [...s.patterns, newP] } : s));
    save(next);
    setPatternId(newP.id);
    setNewPatternName("");
  };
  const duplicatePattern = () => {
    if (!pattern || !scenario) return;
    const copy = { ...pattern, id: "pt" + Date.now(), name: pattern.name + "（複製）" };
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, patterns: [...s.patterns, copy] } : s));
    save(next);
    setPatternId(copy.id);
  };
  const removePattern = (id) => {
    if (!scenario) return;
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, patterns: s.patterns.filter((p) => p.id !== id) } : s));
    save(next);
    const sc = next.find((s) => s.id === scenario.id);
    if (patternId === id) setPatternId(sc?.patterns[0]?.id);
  };
  const renamePattern = (id, v) => {
    if (!scenario) return;
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, patterns: s.patterns.map((p) => (p.id === id ? { ...p, name: v } : p)) } : s));
    save(next);
  };
  const requestRemovePattern = (id) => {
    const target = scenario?.patterns.find((p) => p.id === id);
    setPendingDelete({ kind: "pattern", id, name: target?.name || "" });
  };

  const updateCount = (paramIds, value) => {
    if (!scenario || !pattern) return;
    // 入力値は実際の発生回数。上限でのクランプは点数計算時に行う
    const v = Math.max(0, Number(value) || 0);
    const ids = Array.isArray(paramIds) ? paramIds : [paramIds];
    const next = scenarios.map((s) => {
      if (s.id !== scenario.id) return s;
      return {
        ...s,
        patterns: s.patterns.map((p) => {
          if (p.id !== pattern.id) return p;
          const newCounts = { ...p.counts };
          ids.forEach((id) => { newCounts[id] = v; });
          return { ...p, counts: newCounts };
        }),
      };
    });
    save(next);
  };

  const updatePatternDistribution = (mainTypeKey, stat, value) => {
    if (!scenario || !pattern) return;
    const v = Math.max(0, Number(value) || 0);
    const next = scenarios.map((s) => {
      if (s.id !== scenario.id) return s;
      return {
        ...s,
        patterns: s.patterns.map((p) => {
          if (p.id !== pattern.id) return p;
          const current = p.distributionByMainType?.[mainTypeKey] || { p_vo: 0, p_da: 0, p_vi: 0 };
          return {
            ...p,
            distributionByMainType: { ...p.distributionByMainType, [mainTypeKey]: { ...current, [stat]: v } },
          };
        }),
      };
    });
    save(next);
  };
  const updatePatternFormationDefault = (mainTypeKey, field, stat, value) => {
    if (!scenario || !pattern) return;
    const v = Math.max(0, Number(value) || 0);
    const next = scenarios.map((s) => {
      if (s.id !== scenario.id) return s;
      return {
        ...s,
        patterns: s.patterns.map((p) => {
          if (p.id !== pattern.id) return p;
          const currentDef = p.formationDefaults?.[mainTypeKey] || { counts: { p_vo: 0, p_da: 0, p_vi: 0 }, spCounts: { p_vo: 0, p_da: 0, p_vi: 0 } };
          const currentField = currentDef[field] || { p_vo: 0, p_da: 0, p_vi: 0 };
          return {
            ...p,
            formationDefaults: {
              ...p.formationDefaults,
              [mainTypeKey]: { ...currentDef, [field]: { ...currentField, [stat]: v } },
            },
          };
        }),
      };
    });
    save(next);
  };

  const patternLockedCards = pattern?.defaultLockedCards || [];
  const addPatternLockedCard = (cardId) => {
    if (!scenario || !pattern || patternLockedCards.length >= 6 || patternLockedCards.some((lc) => lc.cardId === cardId)) return;
    const nextLocked = [...patternLockedCards, { cardId, asRental: false }];
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, patterns: s.patterns.map((p) => (p.id === pattern.id ? { ...p, defaultLockedCards: nextLocked } : p)) } : s));
    save(next);
  };
  const removePatternLockedCard = (cardId) => {
    if (!scenario || !pattern) return;
    const nextLocked = patternLockedCards.filter((lc) => lc.cardId !== cardId);
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, patterns: s.patterns.map((p) => (p.id === pattern.id ? { ...p, defaultLockedCards: nextLocked } : p)) } : s));
    save(next);
  };
  const togglePatternLockedRental = (cardId, asRental) => {
    if (!scenario || !pattern) return;
    const nextLocked = patternLockedCards.map((lc) => (lc.cardId === cardId ? { ...lc, asRental } : lc));
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, patterns: s.patterns.map((p) => (p.id === pattern.id ? { ...p, defaultLockedCards: nextLocked } : p)) } : s));
    save(next);
  };
  const patternLockedSearchResults = (cards || [])
    .filter((c) => !lockedCardSearch.trim() || c.name.includes(lockedCardSearch.trim()))
    .slice(0, 30);

  const addCardTypePolicy = () => {
    if (!newCardTypePolicyName.trim() || !scenario) return;
    const newP = { id: "ctp" + Date.now(), name: newCardTypePolicyName.trim(), counts: {} };
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, cardTypePolicies: [...(s.cardTypePolicies || []), newP] } : s));
    save(next);
    setCardTypePolicyId(newP.id);
    setNewCardTypePolicyName("");
  };
  const duplicateCardTypePolicy = () => {
    if (!cardTypePolicy || !scenario) return;
    const copy = { ...cardTypePolicy, id: "ctp" + Date.now(), name: cardTypePolicy.name + "（複製）" };
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, cardTypePolicies: [...(s.cardTypePolicies || []), copy] } : s));
    save(next);
    setCardTypePolicyId(copy.id);
  };
  const removeCardTypePolicy = (id) => {
    if (!scenario) return;
    const next = scenarios.map((s) => (s.id === scenario.id ? { ...s, cardTypePolicies: (s.cardTypePolicies || []).filter((p) => p.id !== id) } : s));
    save(next);
    const sc = next.find((s) => s.id === scenario.id);
    if (cardTypePolicyId === id) setCardTypePolicyId(sc?.cardTypePolicies?.[0]?.id);
  };
  const requestRemoveCardTypePolicy = (id) => {
    const target = scenario?.cardTypePolicies?.find((p) => p.id === id);
    setPendingDelete({ kind: "cardTypePolicy", id, name: target?.name || "" });
  };
  const confirmPendingDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "pattern") removePattern(pendingDelete.id);
    else if (pendingDelete.kind === "cardTypePolicy") removeCardTypePolicy(pendingDelete.id);
    setPendingDelete(null);
  };
  const updateCardTypePolicyCount = (paramId, value) => {
    if (!scenario || !cardTypePolicy) return;
    const v = Math.max(0, Number(value) || 0);
    const next = scenarios.map((s) => {
      if (s.id !== scenario.id) return s;
      return {
        ...s,
        cardTypePolicies: (s.cardTypePolicies || []).map((p) => (p.id === cardTypePolicy.id ? { ...p, counts: { ...p.counts, [paramId]: v } } : p)),
      };
    });
    save(next);
  };
  const CARD_TYPE_POLICY_PARAM_LABELS = {
    p_koucho: "好調カード獲得", p_shuchu: "集中カード獲得", p_genki: "元気カード獲得",
    p_yaruki: "やる気カード獲得", p_kouinshou: "好印象カード獲得", p_onzon: "温存カード獲得", p_zenryoku: "全力カード獲得",
  };

  if (!scenario) {
    return (
      <Panel title="育成シナリオ">
        <div style={{ display: "flex", gap: 8 }}>
          <input value={newScenarioName} onChange={(e) => setNewScenarioName(e.target.value)} placeholder="新しいシナリオ名（例：NIA）" style={inputStyle} />
          <button onClick={addScenario} style={primaryBtn}>シナリオ追加</button>
        </div>
      </Panel>
    );
  }

  return (
    <div>
      <Panel title="育成シナリオとシナリオ進行パターン" help={HELP.scenarios}>

        <FieldLabel>① 育成シナリオ</FieldLabel>
        <DraggableSegButtonList items={scenarios} activeId={scenarioId} onSelect={pickScenario} onReorder={moveScenario} color="#5ec8ff" />
        {scenario && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "rgba(245,240,255,0.55)" }}>選択中のシナリオ名：</span>
            <input value={scenario.name} onChange={(e) => renameScenario(scenario.id, e.target.value)} style={{ ...inputStyle, maxWidth: 260 }} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input value={newScenarioName} onChange={(e) => setNewScenarioName(e.target.value)} placeholder="新しいシナリオ名（例：NIA）" style={inputStyle} />
          <button onClick={addScenario} style={primaryBtn}>シナリオ追加</button>
          <button onClick={() => removeScenario(scenario.id)} disabled={scenarios.length <= 1} style={{ ...dangerBtn, opacity: scenarios.length <= 1 ? 0.4 : 1, cursor: scenarios.length <= 1 ? "not-allowed" : "pointer" }}>このシナリオを削除</button>
        </div>

        <FieldLabel>② シナリオ進行パターン（{scenario.name}）</FieldLabel>
        <DraggableSegButtonList items={scenario.patterns} activeId={patternId} onSelect={setPatternId} onReorder={movePatternOrder} color="#ff6fae" />
        {pattern && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "rgba(245,240,255,0.55)" }}>選択中のパターン名：</span>
            <input value={pattern.name} onChange={(e) => renamePattern(pattern.id, e.target.value)} style={{ ...inputStyle, maxWidth: 260 }} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <input value={newPatternName} onChange={(e) => setNewPatternName(e.target.value)} placeholder="新しいパターン名（例：ふわもこDa4枚育成）" style={inputStyle} />
          <button onClick={addPattern} style={primaryBtn}>パターン追加</button>
          {pattern && <button onClick={duplicatePattern} style={{ ...inputStyle, cursor: "pointer" }}>このパターンを複製</button>}
          {pattern && <button onClick={() => requestRemovePattern(pattern.id)} style={dangerBtn}>このパターンを削除</button>}
        </div>

        {pattern && (() => {
          const shownGroups = buildParamCountGroups(parameters.filter((p) => !CARD_TYPE_POLICY_PARAM_IDS.includes(p.id)));
          return (
            <>
              <FieldLabel>パラメータ回数（想定発動回数）</FieldLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginBottom: 20 }}>
                {shownGroups.map((g) => (
                  <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 12.5 }}>
                      {g.base.name}
                      {g.base.maxCount != null && <span style={{ marginLeft: 5, fontSize: 10, color: "#ffd166" }}>（上限{g.base.maxCount}）</span>}
                      {g.members.length > 1 && (
                        <div style={{ fontSize: 10, color: "rgba(245,240,255,0.4)", marginTop: 2 }}>
                          同じ回数を共有：{g.members.filter((m) => m.id !== g.key).map((m) => `${m.name}（上限${m.maxCount}）`).join("、")}
                        </div>
                      )}
                    </div>
                    <input type="number" min={0} value={pattern.counts?.[g.key] ?? 0} onChange={(e) => updateCount(g.ids, e.target.value)} style={{ ...inputStyle, width: 70 }} />
                  </div>
                ))}
              </div>

              <FieldLabel>SPレッスン終了時・レッスン終了時の傾向別回数</FieldLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
                {Object.entries(MAIN_TYPE_DEFS).map(([key, def]) => (
                  <div key={key}>
                    <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.7)", marginBottom: 4 }}>{def.label}型のとき（サブ：{TENDENCY_LABELS[def.sub]}）</div>
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                      {TENDENCY_STAT_IDS.map((stat) => (
                        <div key={stat} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12.5, color: "rgba(245,240,255,0.7)", width: 22 }}>{TENDENCY_LABELS[stat]}</span>
                          <input
                            type="number"
                            min={0}
                            value={pattern.distributionByMainType?.[key]?.[stat] ?? 0}
                            onChange={(e) => updatePatternDistribution(key, stat, e.target.value)}
                            style={{ ...inputStyle, width: 64 }}
                          />
                          <span style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>回</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <FieldLabel>編成枚数指定のデフォルト値</FieldLabel>
              <div style={{ marginBottom: 20 }}>
                {Object.entries(MAIN_TYPE_DEFS).map(([key, def]) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.7)", marginBottom: 4 }}>{def.label}型のとき</div>
                    {["counts", "spCounts"].map((field) => (
                      <div key={field} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: "rgba(245,240,255,0.5)", width: 70 }}>{field === "counts" ? "編成枚数" : "うちSP持ち"}</span>
                        {TENDENCY_STAT_IDS.map((stat) => (
                          <div key={stat} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 11.5, color: "rgba(245,240,255,0.6)" }}>{TENDENCY_LABELS[stat]}</span>
                            <input
                              type="number"
                              min={0}
                              value={pattern.formationDefaults?.[key]?.[field]?.[stat] ?? 0}
                              onChange={(e) => updatePatternFormationDefault(key, field, stat, e.target.value)}
                              style={{ ...inputStyle, width: 56 }}
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <FieldLabel>確定サポカのデフォルト</FieldLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {patternLockedCards.map((lc) => {
                  const card = (cards || []).find((c) => c.id === lc.cardId);
                  if (!card) return null;
                  return (
                    <div key={lc.cardId} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "6px 10px" }}>
                      <div style={{ fontSize: 12.5, flex: 1, minWidth: 120 }}>{card.name}</div>
                      <label style={{ fontSize: 11.5, color: "rgba(245,240,255,0.7)", display: "flex", alignItems: "center", gap: 5 }}>
                        <input type="radio" name={`admin-rental-${lc.cardId}`} checked={!lc.asRental} onChange={() => togglePatternLockedRental(lc.cardId, false)} />
                        自前で確定
                      </label>
                      <label style={{ fontSize: 11.5, color: "rgba(245,240,255,0.7)", display: "flex", alignItems: "center", gap: 5 }}>
                        <input type="radio" name={`admin-rental-${lc.cardId}`} checked={!!lc.asRental} onChange={() => togglePatternLockedRental(lc.cardId, true)} />
                        レンタルで確定
                      </label>
                      <button onClick={() => removePatternLockedCard(lc.cardId)} style={dangerBtn}>外す</button>
                    </div>
                  );
                })}
                {!patternLockedCards.length && (
                  <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>確定サポカのデフォルトは設定されていません。</div>
                )}
              </div>
              {patternLockedCards.length < 6 ? (
                <>
                  <input
                    value={lockedCardSearch}
                    onChange={(e) => setLockedCardSearch(e.target.value)}
                    placeholder="名前で検索して追加（未入力ですべて表示）"
                    style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                    {patternLockedSearchResults.map((c) => {
                      const already = patternLockedCards.some((lc) => lc.cardId === c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => addPatternLockedCard(c.id)}
                          disabled={already}
                          style={{
                            display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                            padding: "5px 8px", borderRadius: 8, cursor: already ? "default" : "pointer",
                            border: "1px solid rgba(255,255,255,0.1)", background: already ? "rgba(255,255,255,0.04)" : "transparent",
                            color: already ? "rgba(245,240,255,0.35)" : "#f5f0ff", opacity: already ? 0.6 : 1,
                          }}
                        >
                          <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                          {already && <span style={{ fontSize: 10, color: "rgba(245,240,255,0.4)" }}>追加済み</span>}
                        </button>
                      );
                    })}
                    {!patternLockedSearchResults.length && (
                      <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)", padding: 6 }}>該当するカードが見つかりません。</div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)" }}>確定サポカのデフォルトは最大6枚までです。</div>
              )}
            </>
          );
        })()}
      </Panel>

      <Panel title="カード種別方針" help={HELP.cardTypePolicy}>

        <DraggableSegButtonList items={scenario.cardTypePolicies || []} activeId={cardTypePolicyId} onSelect={setCardTypePolicyId} onReorder={moveCardTypePolicyOrder} color="#4ade80" />
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <input value={newCardTypePolicyName} onChange={(e) => setNewCardTypePolicyName(e.target.value)} placeholder="新しいカード種別方針名（例：ロジック（やる気型））" style={inputStyle} />
          <button onClick={addCardTypePolicy} style={primaryBtn}>カード種別方針追加</button>
          {cardTypePolicy && <button onClick={duplicateCardTypePolicy} style={{ ...inputStyle, cursor: "pointer" }}>このカード種別方針を複製</button>}
          {cardTypePolicy && <button onClick={() => requestRemoveCardTypePolicy(cardTypePolicy.id)} style={dangerBtn}>このカード種別方針を削除</button>}
        </div>

        {cardTypePolicy && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {CARD_TYPE_POLICY_PARAM_IDS.map((paramId) => {
              const knownParam = parameters.find((p) => p.id === paramId);
              return (
                <div key={paramId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 12.5 }}>
                    {knownParam ? knownParam.name : CARD_TYPE_POLICY_PARAM_LABELS[paramId]}
                    {!knownParam && <span style={{ marginLeft: 5, fontSize: 10, color: "#ff8a8a" }}>（未登録のパラメータIDです）</span>}
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={cardTypePolicy.counts?.[paramId] ?? 0}
                    onChange={(e) => updateCardTypePolicyCount(paramId, e.target.value)}
                    style={{ ...inputStyle, width: 70 }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {pendingDelete && (
        <div
          onClick={() => setPendingDelete(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(10,8,18,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#181428", border: "1px solid #ff8a8a55", borderRadius: 18, padding: 20, maxWidth: 420, width: "100%" }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f5f0ff", marginBottom: 10 }}>
              「{pendingDelete.name}」（{pendingDelete.kind === "pattern" ? "シナリオ進行パターン" : "カード種別方針"}）を削除しますか？
            </div>
            <div style={{ fontSize: 12.5, color: "rgba(245,240,255,0.7)", marginBottom: 14 }}>
              この操作は取り消せません。このシナリオでこの{pendingDelete.kind === "pattern" ? "シナリオ進行パターン" : "カード種別方針"}を選択している利用者は、削除後は別のものを選び直す必要があります。
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={confirmPendingDelete} style={dangerBtn}>削除する</button>
              <button onClick={() => setPendingDelete(null)} style={{ ...inputStyle, cursor: "pointer" }}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CardsAdmin({ parameters, cards, save }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("plan"); // "plan" | "name" | "rarity"
  const [planFilter, setPlanFilter] = useState("all");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [tendencyFilter, setTendencyFilter] = useState("all");
  const [paramFilter, setParamFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(cards[0]?.id);
  const [imageMsg, setImageMsg] = useState("");
  const selected = cards.find((c) => c.id === selectedId);

  useEffect(() => {
    setImageMsg("");
  }, [selectedId]);

  const attributeOrder = { "センス": 0, "ロジック": 1, "アノマリー": 2, "共通": 3 };
  const rarityOrder = RARITIES.reduce((acc, r, i) => ({ ...acc, [r]: i }), {});
  const visibleCards = useMemo(() => {
    let list = cards.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
    if (planFilter !== "all") list = list.filter((c) => c.plan === planFilter);
    if (rarityFilter !== "all") list = list.filter((c) => c.rarity === rarityFilter);
    if (tendencyFilter !== "all") list = list.filter((c) => c.tendencyType === tendencyFilter);
    if (paramFilter !== "all") list = list.filter((c) => (c.subParams || []).includes(paramFilter));
    list = [...list].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "ja");
      if (sortKey === "rarity") {
        const diff = (rarityOrder[a.rarity] ?? 9) - (rarityOrder[b.rarity] ?? 9);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, "ja");
      }
      const diff = (attributeOrder[a.plan] ?? 9) - (attributeOrder[b.plan] ?? 9);
      return diff !== 0 ? diff : a.name.localeCompare(b.name, "ja");
    });
    return list;
  }, [cards, query, sortKey, planFilter, rarityFilter, tendencyFilter, paramFilter]);

  // 絞り込みで選択中のカードが外れたら先頭を選択する
  useEffect(() => {
    if (visibleCards.length && !visibleCards.some((c) => c.id === selectedId)) {
      setSelectedId(visibleCards[0].id);
    }
  }, [visibleCards, selectedId]);

  const addCard = () => {
    const id = "c" + Date.now();
    const next = [...cards, {
      id, name: "新規カード", image: "", plan: "共通", rarity: "SR",
      itemKind: "item", itemName: "",
      hasSP: false, tendencyType: null, firstSlot: "none",
      subParams: [null, null, null, null, null],
      exValueParamEvent: 0, exValueItem: 0,
    }];
    save(next);
    setSelectedId(id);
  };
  const duplicateCard = () => {
    if (!selected) return;
    const id = "c" + Date.now();
    const next = [...cards, { ...selected, id, name: selected.name + "（複製）" }];
    save(next);
    setSelectedId(id);
  };
  const removeCard = (id) => {
    const next = cards.filter((c) => c.id !== id);
    save(next);
    if (selectedId === id) setSelectedId(next[0]?.id);
  };
  const patchCard = (patch) => save(cards.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)));
  const patchSub = (idx, paramId) => {
    const subs = [...(selected.subParams || [null, null, null, null, null])];
    subs[idx] = paramId || null;
    patchCard({ subParams: subs });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを連続選択しても onChange が発火するようにリセット
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageMsg("画像ファイルを選択してください。");
      return;
    }
    setImageMsg("読み込み中…");
    resizeImageFileToDataUrl(file, 240, (dataUrl) => {
      if (!dataUrl) {
        setImageMsg("画像の読み込みに失敗しました。");
        return;
      }
      patchCard({ image: dataUrl });
      setImageMsg("画像を反映しました（自動的に縮小して保存されます）。");
    });
  };

  return (
    <Panel title="サポートカード一覧" help={HELP.cards}>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
        {/* 左：検索・並び替え・一覧 */}
        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前で検索"
            style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <SegButton active={sortKey === "plan"} onClick={() => setSortKey("plan")} color="#ffd166">属性順</SegButton>
            <SegButton active={sortKey === "rarity"} onClick={() => setSortKey("rarity")} color="#ffd166">レア度順</SegButton>
            <SegButton active={sortKey === "name"} onClick={() => setSortKey("name")} color="#ffd166">名前順</SegButton>
          </div>
          <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 6 }}>
            <option value="all">属性で絞り込み：すべて</option>
            {CARD_ATTRIBUTES.map((pl) => <option key={pl} value={pl}>{pl}</option>)}
          </select>
          <select value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 6 }}>
            <option value="all">レア度で絞り込み：すべて</option>
            {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={tendencyFilter} onChange={(e) => setTendencyFilter(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 6 }}>
            <option value="all">タイプで絞り込み：すべて</option>
            {TENDENCY_STAT_IDS.map((id) => <option key={id} value={id}>{TENDENCY_LABELS[id]}</option>)}
          </select>
          <select value={paramFilter} onChange={(e) => setParamFilter(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }}>
            <option value="all">使用パラメータで絞り込み：すべて</option>
            {parameters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 420, overflowY: "auto" }}>
            {visibleCards.map((c) => {
              const tc = tendencyColor(c.tendencyType);
              return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                  padding: "6px 8px", borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${selectedId === c.id ? tc.accent : "transparent"}`,
                  background: selectedId === c.id ? tc.soft : "transparent",
                  color: "#f5f0ff",
                }}
              >
                <CardThumb card={c} size={26} />
                <span style={{ fontSize: 12.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                {c.rarity && <RarityTag rarity={c.rarity} small />}
                <PlanTag plan={c.plan} small />
              </button>
              );
            })}
            {!visibleCards.length && (
              <div style={{ fontSize: 12, color: "rgba(245,240,255,0.5)", padding: 8 }}>該当なし</div>
            )}
          </div>
          <button onClick={addCard} style={{ ...primaryBtn, width: "100%", marginTop: 10 }}>+ カード追加</button>
        </div>

        {/* 右：詳細編集 */}
        {selected && (
          <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 16 }}>
            <FieldLabel>基本情報</FieldLabel>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
              <CardThumb card={selected} size={64} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 240 }}>
                <input value={selected.name} onChange={(e) => patchCard({ name: e.target.value })} placeholder="カード名" style={inputStyle} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ ...inputStyle, cursor: "pointer", display: "inline-block" }}>
                    画像ファイルをアップロード
                    <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
                  </label>
                  {selected.image && (
                    <button onClick={() => { patchCard({ image: "" }); setImageMsg(""); }} style={dangerBtn}>画像をクリア</button>
                  )}
                </div>
                {imageMsg && <div style={{ fontSize: 11, color: "#ffd166" }}>{imageMsg}</div>}
              </div>
            </div>

            <FieldLabel>属性・レアリティ・傾向タイプ・アイテム区分</FieldLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 11, color: "rgba(245,240,255,0.5)", marginBottom: 4 }}>属性</div>
                <select value={selected.plan} onChange={(e) => patchCard({ plan: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                  {CARD_ATTRIBUTES.map((pl) => <option key={pl} value={pl}>{pl}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(245,240,255,0.5)", marginBottom: 4 }}>レアリティ</div>
                <select value={selected.rarity || ""} onChange={(e) => patchCard({ rarity: e.target.value || null })} style={{ ...inputStyle, width: "100%" }}>
                  <option value="">（未設定）</option>
                  {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(245,240,255,0.5)", marginBottom: 4 }}>傾向タイプ（Vo/Da/Vi）</div>
                <select value={selected.tendencyType || ""} onChange={(e) => patchCard({ tendencyType: e.target.value || null })} style={{ ...inputStyle, width: "100%" }}>
                  <option value="">（なし）</option>
                  {TENDENCY_STAT_IDS.map((id) => <option key={id} value={id}>{TENDENCY_LABELS[id]}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(245,240,255,0.5)", marginBottom: 4 }}>アイテム区分</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <SegButton active={selected.itemKind === "item"} onClick={() => patchCard({ itemKind: "item" })} color="#ffd166">Pアイテム</SegButton>
                  <SegButton active={selected.itemKind === "card"} onClick={() => patchCard({ itemKind: "card" })} color="#ffd166">Pカード</SegButton>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(245,240,255,0.5)", marginBottom: 4 }}>アイテム/カード名</div>
                <input value={selected.itemName} onChange={(e) => patchCard({ itemName: e.target.value })} placeholder="必須" style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={selected.hasSP} onChange={(e) => patchCard({ hasSP: e.target.checked })} />
                  SPレッスン発生率UP 持ち
                </label>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(245,240,255,0.5)", marginBottom: 4 }}>EXステータス：パラメータイベントパラメータ（点数）</div>
                <input
                  type="number"
                  value={selected.exValueParamEvent || 0}
                  onChange={(e) => patchCard({ exValueParamEvent: Number(e.target.value) || 0 })}
                  style={{ ...inputStyle, width: "100%" }}
                  placeholder="加算点数"
                />
              </div>
              {selected.itemKind === "item" && (() => {
                const isLinked = selected.exValueItem != null && typeof selected.exValueItem === "object";
                return (
                  <div>
                    <div style={{ fontSize: 11, color: "rgba(245,240,255,0.5)", marginBottom: 4 }}>EXステータス：Pアイテムパラメータ</div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <SegButton
                        active={!isLinked}
                        onClick={() => patchCard({ exValueItem: isLinked ? 0 : (selected.exValueItem || 0) })}
                        color="#ffd166"
                      >
                        数値（回数制限あり）
                      </SegButton>
                      <SegButton
                        active={isLinked}
                        onClick={() => patchCard({ exValueItem: { perTrigger: typeof selected.exValueItem === "number" ? selected.exValueItem : 0, linkedParam: parameters[0]?.id || "" } })}
                        color="#ffd166"
                      >
                        回数制限なし（パラメータ連動）
                      </SegButton>
                    </div>
                    {isLinked ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          type="number"
                          value={selected.exValueItem.perTrigger || 0}
                          onChange={(e) => patchCard({ exValueItem: { ...selected.exValueItem, perTrigger: Number(e.target.value) || 0 } })}
                          placeholder="1回あたりの点数"
                          style={{ ...inputStyle, width: 140 }}
                        />
                        <select
                          value={selected.exValueItem.linkedParam || ""}
                          onChange={(e) => patchCard({ exValueItem: { ...selected.exValueItem, linkedParam: e.target.value } })}
                          style={{ ...inputStyle, width: 200 }}
                        >
                          <option value="">（連動先パラメータ未選択）</option>
                          {parameters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    ) : (
                      <input
                        type="number"
                        value={typeof selected.exValueItem === "number" ? selected.exValueItem : 0}
                        onChange={(e) => patchCard({ exValueItem: Number(e.target.value) || 0 })}
                        style={{ ...inputStyle, width: "100%" }}
                        placeholder="加算点数"
                      />
                    )}
                  </div>
                );
              })()}
            </div>

            <FieldLabel>サブ枠1</FieldLabel>
            <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
              <SegButton active={selected.firstSlot === "lessonBonus"} onClick={() => patchCard({ firstSlot: "lessonBonus" })} color="#ffd166">レッスンボーナス</SegButton>
              <SegButton active={selected.firstSlot === "fixed"} onClick={() => patchCard({ firstSlot: "fixed" })} color="#ffd166">固定値</SegButton>
              <SegButton active={selected.firstSlot === "none" || !selected.firstSlot} onClick={() => patchCard({ firstSlot: "none" })} color="#ffd166">なし</SegButton>
            </div>

            <FieldLabel>サブパラメータ（2〜6枠目、最大5つ）</FieldLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 18 }}>
              {["2枠目（毎凸ではなく2凸で強化・2段階）", "3枠目（毎凸強化・5段階）", "4枠目（3凸で強化・2段階）", "5枠目（完凸で強化・2段階）", "6枠目（1凸・完凸で強化・3段階）"].map((label, idx) => {
                const paramId = selected.subParams?.[idx];
                const param = paramId ? parameters.find((p) => p.id === paramId) : null;
                const neededStages = slotStageCount(idx);
                const definedStages = param ? paramDefinedStageCount(param) : 0;
                const mismatch = param && definedStages > 0 && definedStages < neededStages;
                return (
                  <div key={idx}>
                    <div style={{ fontSize: 10, color: "rgba(245,240,255,0.4)", marginBottom: 3 }}>{label}</div>
                    <select value={selected.subParams?.[idx] || ""} onChange={(e) => patchSub(idx, e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                      <option value="">（なし）</option>
                      {parameters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {mismatch && (
                      <div style={{ fontSize: 10, color: "#ffd166", marginTop: 3 }}>
                        ⚠ このパラメータは{definedStages}段階分しか値が無く、この枠が必要とする{neededStages}段階に足りません。パラメータ管理で値を追加するか、他の枠に配置してください。
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={duplicateCard} style={{ ...inputStyle, cursor: "pointer" }}>このカードを複製</button>
              <button onClick={() => removeCard(selected.id)} style={dangerBtn}>このカードを削除</button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ---------- インポート時のエラー位置（行番号）特定ヘルパー ---------- */

// JSON.parse が失敗した位置（position）を行・列番号に変換して読みやすいメッセージにする
function describeJsonSyntaxError(text, error) {
  const match = /position (\d+)/.exec(error && error.message || "");
  if (!match) return "JSONとして読み取れませんでした。構文（カンマ・括弧の対応など）を確認してください。";
  const pos = parseInt(match[1], 10);
  let line = 1, col = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === "\n") { line++; col = 1; } else { col++; }
  }
  const lineText = text.split("\n")[line - 1] || "";
  const snippet = lineText.trim().slice(0, 80);
  return `JSONの構文エラーです（${line}行目 ${col}文字目付近）。${snippet ? "該当行： " + snippet : ""}`;
}

// text中の index より前にある改行の数を数える
function countNewlinesBefore(text, index) {
  let count = 0;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") count++;
  return count;
}

// startIndex以降にある「[ ... ]」（トップレベル配列）の各要素が何行目から始まるかを返す
function mapArrayItemLinesFrom(text, startIndex) {
  let idx = startIndex;
  const len = text.length;
  while (idx < len && /\s/.test(text[idx])) idx++;
  if (text[idx] !== "[") return null;
  let line = 1 + countNewlinesBefore(text, idx);
  const lines = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let itemStartPending = false;
  for (; idx < len; idx++) {
    const ch = text[idx];
    if (ch === "\n") line++;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "[" || ch === "{") {
      if (ch === "[" && depth === 0) { depth = 1; itemStartPending = true; continue; }
      if (depth === 1 && itemStartPending) { lines.push(line); itemStartPending = false; }
      depth++;
      continue;
    }
    if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1) {
      if (ch === ",") { itemStartPending = true; continue; }
      if (itemStartPending && !/\s/.test(ch)) { lines.push(line); itemStartPending = false; }
    }
  }
  return lines;
}

function mapTopLevelArrayItemLines(text) {
  return mapArrayItemLinesFrom(text, 0);
}

// text中で "key": [ という並びを探し、その "[" の位置を返す（オブジェクトのプロパティとして配列を持つ場合用）
function findKeyArrayStart(text, key) {
  const re = new RegExp('"' + key + '"\\s*:\\s*\\[');
  const m = re.exec(text);
  if (!m) return null;
  return m.index + m[0].lastIndexOf("[");
}

function lineMapForKey(text, key) {
  const start = findKeyArrayStart(text, key);
  if (start == null) return null;
  return mapArrayItemLinesFrom(text, start);
}

// バリデーションメッセージ（"3件目：..." や "カード名：..." 形式）に、
// 分かっている範囲で「◯行目付近」を付け加える
function annotateMessagesWithLines(messages, parsedArray, lineMap) {
  if (!lineMap || !messages || !messages.length) return messages || [];
  return messages.map((msg) => {
    const idxMatch = msg.match(/^(\d+)件目/);
    if (idxMatch) {
      const idx = parseInt(idxMatch[1], 10) - 1;
      const line = lineMap[idx];
      return line ? msg.replace(/^(\d+)件目/, `$1件目（${line}行目付近）`) : msg;
    }
    if (!Array.isArray(parsedArray)) return msg;
    const parts = msg.split("：");
    // 「ラベル：本文」形式（ラベルがid/nameの場合）と、
    // 「本文：値」形式（値がidの場合、例：「idが重複しています：xxx」）の両方に対応する
    const head = parts[0];
    const tail = parts.length > 1 ? parts[parts.length - 1] : null;
    const headIdx = parsedArray.findIndex((item) => item && typeof item === "object" && (item.id === head || item.name === head));
    if (headIdx >= 0 && lineMap[headIdx] != null) {
      return msg.replace(head + "：", `${head}（${lineMap[headIdx]}行目付近）：`);
    }
    if (tail) {
      const tailIdx = parsedArray.findIndex((item) => item && typeof item === "object" && (item.id === tail || item.name === tail));
      if (tailIdx >= 0 && lineMap[tailIdx] != null) {
        return `${msg}（${lineMap[tailIdx]}行目付近）`;
      }
    }
    return msg;
  });
}

/* ---------- 汎用：単一データの書き出し／読み込みブロック ---------- */

function BackupBlock({ title, description, data, onImport, validate, placeholder }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState(null); // { type: "error"|"success", lines: string[] }

  const exportData = () => {
    setText(JSON.stringify(data, null, 2));
    setMsg(null);
  };

  const importData = () => {
    let parsed;
    const cleanText = stripBOM(text);
    try {
      parsed = JSON.parse(cleanText);
    } catch (e) {
      setMsg({ type: "error", lines: [describeJsonSyntaxError(cleanText, e)] });
      return;
    }
    const result = validate ? validate(parsed) : { errors: [], warnings: [] };
    const lineMap = Array.isArray(parsed) ? mapTopLevelArrayItemLines(cleanText) : null;
    const errors = annotateMessagesWithLines(result.errors, parsed, lineMap);
    const warnings = annotateMessagesWithLines(result.warnings, parsed, lineMap);
    if (errors.length) {
      setMsg({ type: "error", lines: errors });
      return;
    }
    onImport(parsed);
    const lines = ["読み込みました。"];
    if (warnings.length) lines.push(...warnings);
    setMsg({ type: warnings.length ? "warning" : "success", lines });
  };

  return (
    <Panel title={title} help={[{ title: "このバックアップについて", body: description }]}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={exportData} style={primaryBtn}>書き出す</button>
        <button onClick={importData} style={{ ...inputStyle, cursor: "pointer" }}>読み込む</button>
      </div>
      {msg && (
        <div style={{ marginBottom: 10, fontSize: 12, color: msg.type === "error" ? "#ff8a8a" : "#ffd166" }}>
          {msg.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={placeholder}
        style={{ ...inputStyle, width: "100%", fontFamily: "monospace", fontSize: 11.5, resize: "vertical" }}
      />
    </Panel>
  );
}

/* ---------- インポート時のバリデーション ---------- */

function validateParametersImport(parsed) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(parsed)) {
    errors.push("配列（[...]）の形式である必要があります。");
    return { errors, warnings };
  }
  const seenIds = new Set();
  parsed.forEach((p, i) => {
    if (!p || typeof p !== "object") { errors.push(`${i + 1}件目：オブジェクトではありません。`); return; }
    if (!p.id || typeof p.id !== "string") errors.push(`${i + 1}件目：idが未設定です。`);
    else if (seenIds.has(p.id)) errors.push(`idが重複しています：${p.id}`);
    else seenIds.add(p.id);
    if (!p.name || typeof p.name !== "string") warnings.push(`${p.id || i + 1}：nameが未設定です。`);
    if (p.valuesByRarity && typeof p.valuesByRarity !== "object") warnings.push(`${p.id || i + 1}：valuesByRarityの形式が不正です。`);
    if (p.maxCount != null && typeof p.maxCount !== "number") warnings.push(`${p.id || i + 1}：maxCountは数値かnullである必要があります。`);
  });
  return { errors, warnings };
}

function validateScenariosImport(parsed, parameters) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(parsed)) {
    errors.push("配列（[...]）の形式である必要があります。");
    return { errors, warnings };
  }
  const knownParamIds = new Set((parameters || []).map((p) => mapParamId(p.id)));
  const unknownRefs = new Set();
  parsed.forEach((s, i) => {
    if (!s || typeof s !== "object") { errors.push(`${i + 1}件目：オブジェクトではありません。`); return; }
    if (!s.id || !s.name) warnings.push(`${i + 1}件目：id/nameが未設定です。`);
    if (!Array.isArray(s.patterns)) { errors.push(`${s.name || i + 1}：patternsが配列ではありません。`); return; }
    s.patterns.forEach((p) => {
      if (!p || typeof p !== "object" || !p.counts) { warnings.push(`${s.name}のパターン「${p?.name || "?"}」：countsが未設定です。`); return; }
      Object.keys(p.counts).forEach((paramId) => {
        if (!knownParamIds.has(mapParamId(paramId))) unknownRefs.add(paramId);
      });
      if (!p.distributionByMainType) {
        warnings.push(`${s.name}のパターン「${p.name || "?"}」：distributionByMainType（SPレッスン終了時・レッスン終了時の傾向別回数）が未設定です。`);
      }
    });
    (s.cardTypePolicies || []).forEach((ctp) => {
      if (!ctp || typeof ctp !== "object" || !ctp.counts) {
        warnings.push(`${s.name}のカード種別方針「${ctp?.name || "?"}」：countsが未設定です。`);
        return;
      }
      Object.keys(ctp.counts).forEach((paramId) => {
        if (!knownParamIds.has(mapParamId(paramId))) unknownRefs.add(paramId);
      });
    });
  });
  if (unknownRefs.size) {
    warnings.push(`現在のパラメータ一覧に存在しないIDが参照されています：${[...unknownRefs].join("、")}（0点扱いになります）`);
  }
  return { errors, warnings };
}

function validateCardsImport(parsed, parameters) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(parsed)) {
    errors.push("配列（[...]）の形式である必要があります。");
    return { errors, warnings };
  }
  const knownParamIds = new Set((parameters || []).map((p) => mapParamId(p.id)));
  const seenIds = new Set();
  const unknownRefs = new Set();
  parsed.forEach((c, i) => {
    const label = c?.name || c?.id || `${i + 1}件目`;
    if (!c || typeof c !== "object") { errors.push(`${i + 1}件目：オブジェクトではありません。`); return; }
    if (!c.id || typeof c.id !== "string") errors.push(`${label}：idが未設定です。`);
    else if (seenIds.has(c.id)) errors.push(`idが重複しています：${c.id}`);
    else seenIds.add(c.id);
    if (c.plan && !CARD_ATTRIBUTES.includes(c.plan)) warnings.push(`${label}：planが不正な値です（${c.plan}）。`);
    if (c.rarity && !RARITIES.includes(c.rarity)) warnings.push(`${label}：rarityが不正な値です（${c.rarity}）。`);
    if (c.firstSlot && !["fixed", "lessonBonus", "none"].includes(c.firstSlot)) warnings.push(`${label}：firstSlotが不正な値です（${c.firstSlot}）。`);
    if (c.tendencyType && !TENDENCY_STAT_IDS.includes(c.tendencyType)) warnings.push(`${label}：tendencyTypeが不正な値です（${c.tendencyType}）。`);
    if (c.subParams && (!Array.isArray(c.subParams) || c.subParams.length !== 5)) warnings.push(`${label}：subParamsは要素数5の配列である必要があります。`);
    (c.subParams || []).forEach((pid) => { if (pid && !knownParamIds.has(mapParamId(pid))) unknownRefs.add(pid); });
    if (c.exValueItem != null && typeof c.exValueItem === "object") {
      if (typeof c.exValueItem.perTrigger !== "number") warnings.push(`${label}：exValueItem.perTriggerが数値ではありません。`);
      if (!c.exValueItem.linkedParam) warnings.push(`${label}：exValueItem.linkedParamが未設定です。`);
      else if (!knownParamIds.has(mapParamId(c.exValueItem.linkedParam))) unknownRefs.add(c.exValueItem.linkedParam);
    }
  });
  if (unknownRefs.size) {
    warnings.push(`現在のパラメータ一覧に存在しないIDが参照されています：${[...unknownRefs].join("、")}（0点扱いになります）`);
  }
  return { errors, warnings };
}

/* ---------- 管理者モード：マスターデータのバックアップ（種類ごとに個別） ---------- */

function MasterBackupAdmin({ parameters, scenarios, cards, firstSlotConfig, saveParams, saveScenarios, saveCards, saveFirstSlotConfig, ownership, settings, replaceOwnership, updateSettingsFull, flash }) {
  return (
    <div>
      <FullBackupAdmin
        parameters={parameters}
        scenarios={scenarios}
        cards={cards}
        firstSlotConfig={firstSlotConfig}
        ownership={ownership}
        settings={settings}
        saveParams={saveParams}
        saveScenarios={saveScenarios}
        saveCards={saveCards}
        saveFirstSlotConfig={saveFirstSlotConfig}
        replaceOwnership={replaceOwnership}
        updateSettingsFull={updateSettingsFull}
        flash={flash}
      />
      <BackupBlock
        title="パラメータのバックアップ・復元"
        description="パラメータ一覧（レアリティ×凸ごとの効果実数値・発動上限）だけをJSONで書き出し／読み込みします。"
        data={parameters}
        validate={validateParametersImport}
        onImport={(p) => { saveParams(p); flash && flash("パラメータを復元しました"); }}
        placeholder='[{"id": "p_xxx", "name": "...", "valuesByRarity": {...}, "maxCount": null}, ...]'
      />
      <BackupBlock
        title="育成シナリオのバックアップ・復元"
        description="育成シナリオ・シナリオ進行パターンだけをJSONで書き出し／読み込みします。"
        data={scenarios}
        validate={(p) => validateScenariosImport(p, parameters)}
        onImport={(p) => { saveScenarios(p); flash && flash("育成シナリオを復元しました"); }}
        placeholder='[{"id": "sc_xxx", "name": "...", "patterns": [...], "cardTypePolicies": [...]}, ...]'
      />
      <BackupBlock
        title="カードマスターのバックアップ・復元"
        description="サポートカードの一覧だけをJSONで書き出し／読み込みします。大量のカードをテキストエディタで一括編集・追加したいときにも使えます。"
        data={cards}
        validate={(p) => validateCardsImport(p, parameters)}
        onImport={(p) => { saveCards(p); flash && flash("カードマスターを復元しました"); }}
        placeholder='[{"id": "c_xxx", "name": "...", ...}, ...]'
      />
      <BackupBlock
        title="サブ枠1設定のバックアップ・復元"
        description="固定値テーブル・メイン/サブ倍率だけをJSONで書き出し／読み込みします。"
        data={firstSlotConfig}
        validate={(p) => (p && typeof p === "object" && !Array.isArray(p)) ? { errors: [], warnings: [] } : { errors: ["オブジェクト（{...}）の形式である必要があります。"], warnings: [] }}
        onImport={(p) => { saveFirstSlotConfig(p); flash && flash("サブ枠1設定を復元しました"); }}
        placeholder='{"mainMultiplier": 1.5, "subMultiplier": 0.5, "fixedValueTable": {...}}'
      />
    </div>
  );
}

/* ---------- 管理者モード：全データ一括バックアップ ---------- */

function FullBackupAdmin({ parameters, scenarios, cards, firstSlotConfig, ownership, settings, saveParams, saveScenarios, saveCards, saveFirstSlotConfig, replaceOwnership, updateSettingsFull, flash }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState(null); // { type, lines }

  const exportAll = () => {
    const payload = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      master: { parameters, scenarios, cards, firstSlotConfig },
      user: { ownership, settings },
    };
    setText(JSON.stringify(payload, null, 2));
    setMsg(null);
  };

  const importAll = () => {
    const rawText = stripBOM(text);
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      setMsg({ type: "error", lines: [describeJsonSyntaxError(rawText, err)] });
      return;
    }
    if (!parsed || typeof parsed !== "object" || (!parsed.master && !parsed.user)) {
      setMsg({ type: "error", lines: ["全データバックアップの形式ではないようです（master／userのいずれかが必要です）。"] });
      return;
    }
    const lines = [];
    const m = parsed.master || {};
    const u = parsed.user || {};
    const effectiveParams = Array.isArray(m.parameters) ? m.parameters : parameters;

    if (m.parameters !== undefined) {
      const r = validateParametersImport(m.parameters);
      const lineMap = lineMapForKey(rawText, "parameters");
      if (r.errors.length) lines.push("パラメータ：復元しませんでした。" + annotateMessagesWithLines(r.errors, m.parameters, lineMap).join(" / "));
      else { saveParams(m.parameters); lines.push("パラメータを復元しました。"); lines.push(...annotateMessagesWithLines(r.warnings, m.parameters, lineMap)); }
    }
    if (m.scenarios !== undefined) {
      const r = validateScenariosImport(m.scenarios, effectiveParams);
      const lineMap = lineMapForKey(rawText, "scenarios");
      if (r.errors.length) lines.push("育成シナリオ：復元しませんでした。" + annotateMessagesWithLines(r.errors, m.scenarios, lineMap).join(" / "));
      else { saveScenarios(m.scenarios); lines.push("育成シナリオを復元しました。"); lines.push(...annotateMessagesWithLines(r.warnings, m.scenarios, lineMap)); }
    }
    if (m.cards !== undefined) {
      const r = validateCardsImport(m.cards, effectiveParams);
      const lineMap = lineMapForKey(rawText, "cards");
      if (r.errors.length) lines.push("カードマスター：復元しませんでした。" + annotateMessagesWithLines(r.errors, m.cards, lineMap).join(" / "));
      else { saveCards(m.cards); lines.push("カードマスターを復元しました。"); lines.push(...annotateMessagesWithLines(r.warnings, m.cards, lineMap)); }
    }
    if (m.firstSlotConfig !== undefined) {
      if (m.firstSlotConfig && typeof m.firstSlotConfig === "object" && !Array.isArray(m.firstSlotConfig)) {
        saveFirstSlotConfig(m.firstSlotConfig);
        lines.push("サブ枠1設定を復元しました。");
      } else {
        lines.push("サブ枠1設定：復元しませんでした（オブジェクト形式ではありません）。");
      }
    }
    if (u.ownership !== undefined) {
      const r = sanitizeOwnershipObject(u.ownership);
      if (!r) lines.push("所持状況：復元しませんでした（形式が不正です）。");
      else {
        replaceOwnership(r.sanitized);
        lines.push(r.droppedCount > 0 ? `所持状況を復元しました（不正な値${r.droppedCount}件は無視しました）。` : "所持状況を復元しました。");
      }
    }
    if (u.settings !== undefined) {
      if (u.settings && typeof u.settings === "object" && !Array.isArray(u.settings)) {
        updateSettingsFull({ ...DEFAULT_SETTINGS, ...u.settings });
        lines.push("設定を復元しました。");
      } else {
        lines.push("設定：復元しませんでした（オブジェクト形式ではありません）。");
      }
    }
    if (!lines.length) lines.push("復元できる項目が見つかりませんでした。");
    setMsg({ type: "warning", lines });
    flash && flash("全データの復元処理が完了しました");
  };

  return (
    <Panel title="全データ一括バックアップ・復元" help={HELP.fullBackup}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={exportAll} style={primaryBtn}>書き出す</button>
        <button onClick={importAll} style={{ ...inputStyle, cursor: "pointer" }}>読み込む</button>
      </div>
      {msg && (
        <div style={{ marginBottom: 10, fontSize: 12, color: msg.type === "error" ? "#ff8a8a" : "#ffd166" }}>
          {msg.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder='{"master": {...}, "user": {...}}'
        style={{ ...inputStyle, width: "100%", fontFamily: "monospace", fontSize: 11.5, resize: "vertical" }}
      />
    </Panel>
  );
}

/* ============================================================
   画面ヘルプの内容（各パネル右上の「？」から表示）
   ============================================================ */

const HELP = {
  register: [
    { title: "所持状況の登録", body: "「未所持」のままのカードはレンタル候補として扱われます。" },
    { title: "バックアップ（CSV）", body: "CSVはID・カード名・レアリティ・タイプ・所持状況（未所持／0凸〜4凸）の5列です。カード名・レアリティ・タイプは読みやすさのための列で、読み込み時はIDと所持状況の列だけを基準に反映します。Excel等で編集してから貼り付けても構いません。ファイルのダウンロード／アップロードでも、テキスト欄と同じ内容を扱えます。" },
    { title: "バックアップ（JSON）", body: "テキストをコピーして保管しておくと、別環境へ引き継げます。保管していたテキストを貼り付けて「読み込む」を押すと、所持状況を復元できます。" },
  ],
  conditions: [
    { title: "傾向", body: "メインとなる2属性を選びます。残り1属性は自動的にサブ扱いになります。\n傾向・シナリオ進行パターンを切り替えると、「編成枚数指定」がその組み合わせ用の初期値に自動的に置き換わります。" },
    { title: "シナリオ進行パターン", body: "通常パラメータの回数に加えて、SPレッスン終了時・レッスン終了時のVo/Da/Vi別回数（傾向ごと）や、編成枚数指定のデフォルト値も含まれます。" },
    { title: "カード種別方針", body: "現在のプランに応じた候補のみ表示されます。プラン固有の状態カード（好調・集中・元気・やる気・好印象・温存・全力）の取得回数を、進行パターンとは独立して決めます。" },
    { title: "編成枚数指定", body: "Vo／Da／Viそれぞれ何枚編成し、そのうちSP持ちを何枚にするかを指定します。合計6枚になるように指定してください（このうち1枚がレンタルに置き換わる場合があります）。\n指定した属性・枚数の範囲内でのみスコア上位から自動選出します（属性をまたいだ自動補充は行いません）。\nレンタルは最大1枚まで使用されます。「自前の最弱カードをレンタルに置き換えた方が実際に高得点になる属性」または「枚数が不足している属性」がある場合に、その中で最もスコアが伸びる1箇所へ自動的に割り当てられます。どの属性でも置き換えでスコアが上がらない場合は、レンタルは使用されず全て自前カードで編成されます。" },
    { title: "SSR・配布SSRのみで自動選出", body: "オンにすると、自前候補・レンタル候補ともにSSR・配布SSRのカードだけが選出対象になります（SRは自動選出の候補から外れます）。「確定サポカ」で手動指定したカードはこの制限を受けません。" },
    { title: "EXステータスの計算対象", body: "チェックを外すと、そのEXステータスは編成のスコア計算・自動選出から除外されます（カード自体のデータは変わりません）。" },
    { title: "Pアイテムパラメータの見積もり", body: "回数制限なし（パラメータ連動）のPアイテムは、そのPアイテムを最速で入手できた場合の回数（理論値）を基準に計算します。実際には最速入手は稀なため、ここで選んだ回数分だけ紐づく回数を減らして見積もれます（0〜3回分、最低0回）。回数制限ありのPアイテム（固定値）やサポートカード自体の回数には影響しません。" },
    { title: "追加回数の手動調整", body: "ここで指定した回数は、対応するパラメータの回数にそのまま上乗せされます（シナリオ側の回数設定・カード種別方針の回数と合算されます）。" },
    { title: "確定サポカ", body: "確定サポカはスコアに関わらず必ず編成に含まれます。「レンタルで確定」は最大1枚のみ有効です（2枚目以降は自前確定として扱われます）。" },
  ],
  formation: [
    { title: "点数の内訳", body: "カードをタップすると点数の内訳を確認できます。" },
  ],
  runnerUp: [
    { title: "次点のサポートカード", body: "推奨編成・レンタルに選ばれなかった中で、属性ごとにスコアが高い順に2枚ずつ表示します（所持カードのみが対象）。" },
  ],
  breakdown: [
    { title: "編成の内訳", body: "推奨編成に含まれる6枚（自前＋レンタル）それぞれの点数内訳です。0点の項目は発動していない（回数が0、または現在の傾向でサブ扱いなど）ことを示す注意サインです。" },
  ],
  ranking: [
    { title: "ランキング", body: "現在の育成条件（プラン・傾向・シナリオ・パターン・EXステータス設定）でスコアを計算した、所持カードの順位です。推奨編成・次点カードもここに含まれます。" },
  ],
  checker: [
    { title: "サポカの点数を調べる", body: "任意の1枚を選んで、任意の凸数（無凸〜完凸）での点数を確認できます（現在の育成条件で計算します）。" },
  ],
  firstSlot: [
    { title: "サブ枠1", body: "すべてのサポートカードのサブパラメータ1枠目は「固定値」「レッスンボーナス」「なし」のいずれかです（カードごとの設定は「カードマスター管理」で行います）。\n固定値は、レアリティ・凸数ごとの数値がそのまま得点になります。\nレッスンボーナスは、そのカードの傾向タイプが現在選択中の「傾向」でメイン扱いなら固定値×メイン倍率、サブ扱いなら固定値×サブ倍率が得点になります。" },
  ],
  params: [
    { title: "効果実数値", body: "「行動1回あたりの効果値」は固定値と同じくレアリティによって異なるため、レアリティごとに5段階の値を設定します。育成シナリオ側で設定した「回数」と掛け合わせて評価点を計算します。" },
    { title: "「段階」について", body: "「段階」は必ずしも凸数と一致しません。カードのどのサブ枠（2〜6枠目）にこのパラメータを設定するかによって、凸を重ねたときにどの段階まで強化されるかが変わるためです（カードマスター管理側の枠の位置で自動的に決まります）。\n迷ったら「1段階目＝初期値」「5段階目＝完凸時の最終値」として、間の3段階は目安の中間値を入れておけば問題ありません。" },
    { title: "並べ替え", body: "左端の「≡」をドラッグして並べ替えできます。この並び順は、カードマスター管理のサブパラメータ選択欄など、パラメータの一覧が表示される他の場所にも反映されます。" },
  ],
  scenarios: [
    { title: "シナリオと進行パターン", body: "同じ「通常育成」という名前のパターンでも、シナリオが違えば回数はまったく別物として管理します。まずシナリオを選び、その中の進行パターン（例：通常育成／ふわもこDa4枚育成）ごとに各パラメータの回数を設定してください。\nSPレッスン終了時・レッスン終了時の傾向別回数、編成枚数指定のデフォルト値、確定サポカのデフォルトも、すべてパターンの中で設定します。" },
    { title: "並べ替え", body: "左端の「≡」をドラッグして、シナリオ・進行パターンを並べ替えできます。" },
    { title: "パラメータ回数", body: "好調・集中・元気・やる気・好印象・温存・全力はカード種別方針で管理するため、ここには表示されません。設定していない項目は0回として扱われます。\n同じ実イベントの上限違いバージョン（例：活動支給／差し入れ と その2回版）は1つの入力欄にまとめてあり、入力した回数がそのまま両方に使われます（上限によるクランプは計算時にパラメータごとに行われます）。" },
    { title: "傾向別回数", body: "選択中の傾向（VoDa/DaVi/ViVo）ごとに、Vo/Da/Vi別の回数を定義します。\n例：「通常育成」は傾向の2つのメイン属性に均等配分。「ふわもこDa4枚育成」はDaを7回固定し、残り1回を傾向のもう一方のメイン属性に割り当てる（ViVo傾向の場合はViに割り当てる）、といった設定ができます。" },
    { title: "編成枚数指定のデフォルト値", body: "ここで編集した内容は、利用者モードで該当の傾向・パターンを選び直したときに反映されます（すでに入力済みの設定を自動で上書きすることはありません）。" },
    { title: "確定サポカのデフォルト", body: "例：「通常育成」は確定サポカなし、「ふわもこDa4枚育成」は「ふわふわでワクワク」を確定枠にする、といった使い方ができます。最大6枚まで設定できます。\n利用者が手動で設定した確定サポカは、ここでは変更されません（パターンを選び直した瞬間にだけ、ここでの内容で上書きされます）。" },
  ],
  cardTypePolicy: [
    { title: "カード種別方針", body: "プラン（センス／ロジック／アノマリー）ごとに、そのプランでよく取得する状態カード（好調・集中・元気・やる気・好印象・温存・全力）の取得回数を定義します。\n点数計算画面では、現在選択中のプランに応じた候補だけが選べます（名前が「センス」「ロジック」「アノマリー」で始まるものが対象です）。\nSSRカードの獲得枚数はここではなく、シナリオ進行パターン側で管理します。" },
    { title: "並べ替え", body: "左端の「≡」をドラッグして並べ替えできます。" },
  ],
  cards: [
    { title: "カードの設定項目", body: "カードには名前・画像・レアリティ・Pアイテム/Pカード・傾向タイプ・サブ枠1（固定値/レッスンボーナス/なし）・サブパラメータ（2〜6枠目、通常のパラメータ）・属性を設定します。\n凸ごとの数値の違いは「パラメータ管理」「サブ枠1の固定値テーブル」側で管理するため、ここでは設定しません。" },
    { title: "EXステータス", body: "「パラメータイベントパラメータ」（全カード共通）と「Pアイテムパラメータ」（Pアイテムのみ）の2種類を、それぞれ点数として直接加算できます（特定パラメータへの紐づけはありません）。\nPアイテムパラメータの「回数制限なし」は、連動先パラメータの発動回数（シナリオ側の回数設定）×1回あたりの点数で自動計算されます。" },
    { title: "画像", body: "アップロードした画像は自動的に縮小してカードデータ内に保存されます。大量にアップロードすると保存容量の上限に達する場合があるため、枚数が多い場合はご注意ください。" },
    { title: "サブパラメータの強化段階", body: "各枠は凸による強化タイミングが決まっています：2枠目=2凸で強化（2段階）／3枠目=毎凸強化（5段階）／4枠目=3凸で強化（2段階）／5枠目=完凸で強化（2段階）／6枠目=1凸と完凸で強化（3段階）。\nパラメータ管理側の値は、その枠が実際に強化された回数ぶんの段階目が自動的に使われます。" },
  ],
  fullBackup: [
    { title: "全データ一括バックアップ", body: "パラメータ・育成シナリオ・カードマスター・サブ枠1設定・所持状況・設定をまとめて1つのJSONとして書き出し／読み込みします。ブラウザのデータが消えたときの復旧用に、定期的にコピーして控えておくことをおすすめします。\n読み込み時は項目ごとに内容を検証し、問題のある項目だけをスキップして残りを復元します。" },
  ],
};

/* ---------- 共通レイアウト部品 ---------- */

function HelpButton({ title, topics }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`${title}の説明を表示`}
        title="説明を表示"
        style={{ width: 26, height: 26, borderRadius: 999, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.06)", color: "rgba(245,240,255,0.85)", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0, padding: 0 }}
      >
        ？
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,8,20,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 580, maxHeight: "82vh", overflowY: "auto", background: "#1c1830", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 16, padding: "18px 22px 22px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
              <div className="sco-heading" style={{ fontSize: 15, fontWeight: 700, color: "#f5f0ff" }}>{title}の説明</div>
              <button onClick={() => setOpen(false)} aria-label="閉じる" style={{ background: "transparent", border: "none", color: "rgba(245,240,255,0.7)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {topics.map((t, i) => (
                <div key={i}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#ffd166", marginBottom: 4 }}>{t.title}</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.8, color: "rgba(245,240,255,0.82)", whiteSpace: "pre-line" }}>{t.body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Panel({ title, help, children }) {
  return (
    <div style={{ marginBottom: 22, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: "18px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div className="sco-heading" style={{ fontSize: 15, fontWeight: 700, color: "#f5f0ff" }}>{title}</div>
        {help && help.length > 0 && <HelpButton title={title} topics={help} />}
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 12, color: "rgba(245,240,255,0.6)", marginBottom: 6 }}>{children}</div>;
}

const inputStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  color: "#f5f0ff",
  padding: "6px 10px",
  fontSize: 13,
};
const primaryBtn = { ...inputStyle, background: "#ff6fae", color: "#151225", fontWeight: 700, cursor: "pointer", border: "none" };
const dangerBtn = { ...inputStyle, background: "transparent", color: "#ff8a8a", border: "1px solid #ff8a8a55", cursor: "pointer", fontSize: 11, padding: "3px 8px" };
const thStyle = { textAlign: "left", padding: "6px 8px", color: "rgba(245,240,255,0.5)", borderBottom: "1px solid rgba(255,255,255,0.1)", fontWeight: 500 };
const tdStyle = { padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" };
