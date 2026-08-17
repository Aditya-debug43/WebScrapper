// Brand is a first-class entity, not a text column on Product: the catalogue
// filters on it, and the recommendation engine uses `tier` as a real input to
// its product-strength scoring.
export const brands = [
  // ---- mobiles / computing ----
  { id: "brand_samsung", name: "Samsung", aliasNames: ["SAMSUNG", "Samsung India"], tier: "mid", parentCompany: "Samsung Electronics" },
  { id: "brand_apple", name: "Apple", aliasNames: ["APPLE"], tier: "premium", parentCompany: "Apple Inc." },
  { id: "brand_xiaomi", name: "Redmi", aliasNames: ["Redmi by Xiaomi", "REDMI"], tier: "value", parentCompany: "Xiaomi Corporation" },
  { id: "brand_oneplus", name: "OnePlus", aliasNames: ["ONEPLUS"], tier: "mid", parentCompany: "OnePlus Technology" },
  { id: "brand_realme", name: "realme", aliasNames: ["Realme", "REALME"], tier: "value", parentCompany: "realme Mobile Telecommunications" },
  { id: "brand_vivo", name: "vivo", aliasNames: ["VIVO"], tier: "value", parentCompany: "vivo Mobile Communication" },
  { id: "brand_motorola", name: "Motorola", aliasNames: ["MOTOROLA", "Moto"], tier: "value", parentCompany: "Lenovo Group" },
  { id: "brand_nothing", name: "Nothing", aliasNames: ["NOTHING"], tier: "mid", parentCompany: "Nothing Technology" },
  { id: "brand_google", name: "Google", aliasNames: ["GOOGLE"], tier: "premium", parentCompany: "Alphabet Inc." },
  { id: "brand_dell", name: "Dell", aliasNames: ["DELL"], tier: "mid", parentCompany: "Dell Technologies" },
  { id: "brand_hp", name: "HP", aliasNames: ["Hewlett-Packard", "HP Inc."], tier: "value", parentCompany: "HP Inc." },
  { id: "brand_lenovo", name: "Lenovo", aliasNames: ["LENOVO"], tier: "mid", parentCompany: "Lenovo Group" },
  { id: "brand_asus", name: "ASUS", aliasNames: ["Asus", "ASUSTeK"], tier: "mid", parentCompany: "ASUSTeK Computer Inc." },
  { id: "brand_acer", name: "Acer", aliasNames: ["ACER"], tier: "value", parentCompany: "Acer Inc." },
  { id: "brand_msi", name: "MSI", aliasNames: ["Micro-Star International"], tier: "premium", parentCompany: "Micro-Star International" },

  // ---- audio ----
  { id: "brand_boat", name: "boAt", aliasNames: ["BOAT", "boAt Lifestyle"], tier: "value", parentCompany: "Imagine Marketing" },
  { id: "brand_jbl", name: "JBL", aliasNames: ["Jbl"], tier: "mid", parentCompany: "Harman International" },
  { id: "brand_sony", name: "Sony", aliasNames: ["SONY"], tier: "premium", parentCompany: "Sony Group Corporation" },
  { id: "brand_sennheiser", name: "Sennheiser", aliasNames: ["SENNHEISER"], tier: "premium", parentCompany: "Sennheiser electronic" },
  { id: "brand_noise", name: "Noise", aliasNames: ["NOISE", "Go Noise"], tier: "value", parentCompany: "Nexxbase Marketing" },
  { id: "brand_boult", name: "Boult", aliasNames: ["BOULT", "Boult Audio"], tier: "value", parentCompany: "Boult Audio" },
  { id: "brand_amazfit", name: "Amazfit", aliasNames: ["AMAZFIT", "Zepp"], tier: "mid", parentCompany: "Zepp Health" },
  { id: "brand_redmi", name: "Redmi", aliasNames: ["REDMI"], tier: "value", parentCompany: "Xiaomi Corporation" },
  { id: "brand_poco", name: "POCO", aliasNames: ["Poco"], tier: "value", parentCompany: "Xiaomi Corporation" },
  { id: "brand_infinix", name: "Infinix", aliasNames: ["INFINIX"], tier: "value", parentCompany: "Transsion Holdings" },
  { id: "brand_iqoo", name: "iQOO", aliasNames: ["IQOO", "iqoo"], tier: "mid", parentCompany: "vivo Communication" },

  // ---- power / accessories ----
  { id: "brand_anker", name: "Anker", aliasNames: ["ANKER", "Anker Soundcore"], tier: "mid", parentCompany: "Anker Innovations" },
  { id: "brand_ambrane", name: "Ambrane", aliasNames: ["AMBRANE"], tier: "value", parentCompany: "Ambrane India" },
  { id: "brand_mi", name: "Mi", aliasNames: ["Xiaomi", "MI"], tier: "value", parentCompany: "Xiaomi Corporation" },
  { id: "brand_syska", name: "Syska", aliasNames: ["SYSKA"], tier: "value", parentCompany: "Syska Group" },
  { id: "brand_urban", name: "URBN", aliasNames: ["Urbn", "URBAN"], tier: "value", parentCompany: "URBN Retail" },
  { id: "brand_zebronics", name: "Zebronics", aliasNames: ["ZEBRONICS", "Zeb"], tier: "value", parentCompany: "Zebronics India" },
  { id: "brand_portronics", name: "Portronics", aliasNames: ["PORTRONICS"], tier: "value", parentCompany: "Portronics Digital" },
  { id: "brand_duracell", name: "Duracell", aliasNames: ["DURACELL"], tier: "mid", parentCompany: "Berkshire Hathaway" },

  // ---- TV / large appliances ----
  { id: "brand_lg", name: "LG", aliasNames: ["LG Electronics"], tier: "mid", parentCompany: "LG Corporation" },
  { id: "brand_tcl", name: "TCL", aliasNames: ["Tcl"], tier: "value", parentCompany: "TCL Technology" },
  { id: "brand_hisense", name: "Hisense", aliasNames: ["HISENSE"], tier: "value", parentCompany: "Hisense Group" },
  { id: "brand_whirlpool", name: "Whirlpool", aliasNames: ["WHIRLPOOL"], tier: "mid", parentCompany: "Whirlpool Corporation" },
  { id: "brand_bosch", name: "Bosch", aliasNames: ["BOSCH"], tier: "premium", parentCompany: "Robert Bosch GmbH" },
  { id: "brand_ifb", name: "IFB", aliasNames: ["Ifb"], tier: "mid", parentCompany: "IFB Industries" },
  { id: "brand_godrej", name: "Godrej", aliasNames: ["GODREJ"], tier: "value", parentCompany: "Godrej Group" },
  { id: "brand_haier", name: "Haier", aliasNames: ["HAIER"], tier: "value", parentCompany: "Haier Group" },
  { id: "brand_voltas", name: "Voltas Beko", aliasNames: ["VOLTAS", "Voltas"], tier: "value", parentCompany: "Tata Group" },
  { id: "brand_vu", name: "VU", aliasNames: ["Vu Televisions"], tier: "value", parentCompany: "Vu Technologies" },
  { id: "brand_crompton", name: "Crompton", aliasNames: ["CROMPTON"], tier: "value", parentCompany: "Crompton Greaves" },

  // ---- kitchen ----
  { id: "brand_philips", name: "Philips", aliasNames: ["PHILIPS"], tier: "mid", parentCompany: "Koninklijke Philips" },
  { id: "brand_bajaj", name: "Bajaj", aliasNames: ["BAJAJ"], tier: "value", parentCompany: "Bajaj Electricals" },
  { id: "brand_prestige", name: "Prestige", aliasNames: ["PRESTIGE", "TTK Prestige"], tier: "mid", parentCompany: "TTK Prestige" },
  { id: "brand_havells", name: "Havells", aliasNames: ["HAVELLS"], tier: "mid", parentCompany: "Havells India" },
  { id: "brand_pigeon", name: "Pigeon", aliasNames: ["PIGEON"], tier: "value", parentCompany: "Stovekraft Limited" },
  { id: "brand_butterfly", name: "Butterfly", aliasNames: ["BUTTERFLY"], tier: "value", parentCompany: "Butterfly Gandhimathi" },
  { id: "brand_usha", name: "Usha", aliasNames: ["USHA"], tier: "mid", parentCompany: "Usha International" },

  // ---- furniture ----
  { id: "brand_green_soul", name: "Green Soul", aliasNames: ["GREEN SOUL"], tier: "mid", parentCompany: "Green Soul Ergonomics" },
  { id: "brand_featherlite", name: "Featherlite", aliasNames: ["FEATHERLITE"], tier: "premium", parentCompany: "Featherlite Products" },
  { id: "brand_nilkamal", name: "Nilkamal", aliasNames: ["NILKAMAL"], tier: "value", parentCompany: "Nilkamal Limited" },
  { id: "brand_wakefit", name: "Wakefit", aliasNames: ["WAKEFIT"], tier: "value", parentCompany: "Wakefit Innovations" },
  { id: "brand_cellbell", name: "CellBell", aliasNames: ["CELLBELL"], tier: "value", parentCompany: "CellBell India" },
  { id: "brand_da_urban", name: "Da URBAN", aliasNames: ["DA URBAN"], tier: "value", parentCompany: "Da URBAN Furniture" },

  // ---- fashion / footwear ----
  { id: "brand_nike", name: "Nike", aliasNames: ["NIKE"], tier: "premium", parentCompany: "Nike Inc." },
  { id: "brand_adidas", name: "Adidas", aliasNames: ["ADIDAS"], tier: "premium", parentCompany: "Adidas AG" },
  { id: "brand_puma", name: "Puma", aliasNames: ["PUMA"], tier: "mid", parentCompany: "Puma SE" },
  { id: "brand_campus", name: "Campus", aliasNames: ["CAMPUS"], tier: "value", parentCompany: "Campus Activewear" },
  { id: "brand_asics", name: "ASICS", aliasNames: ["Asics"], tier: "premium", parentCompany: "ASICS Corporation" },
  { id: "brand_levis", name: "Levi's", aliasNames: ["LEVIS", "Levi Strauss"], tier: "premium", parentCompany: "Levi Strauss & Co." },
  { id: "brand_us_polo", name: "U.S. Polo Assn.", aliasNames: ["US POLO ASSN", "USPA"], tier: "mid", parentCompany: "Arvind Fashions" },
  { id: "brand_roadster", name: "Roadster", aliasNames: ["ROADSTER"], tier: "value", parentCompany: "Myntra Designs" },
  { id: "brand_allen_solly", name: "Allen Solly", aliasNames: ["ALLEN SOLLY"], tier: "mid", parentCompany: "Aditya Birla Fashion" },
  { id: "brand_hrx", name: "HRX", aliasNames: ["Hrx"], tier: "value", parentCompany: "Myntra Designs" },
  { id: "brand_wrogn", name: "WROGN", aliasNames: ["Wrogn"], tier: "mid", parentCompany: "Universal Sportsbiz" },
  { id: "brand_jockey", name: "Jockey", aliasNames: ["JOCKEY"], tier: "mid", parentCompany: "Page Industries" },
  { id: "brand_sparx", name: "Sparx", aliasNames: ["SPARX"], tier: "value", parentCompany: "Relaxo Footwears" },
  { id: "brand_reebok", name: "Reebok", aliasNames: ["REEBOK"], tier: "mid", parentCompany: "Authentic Brands Group" },
  { id: "brand_skechers", name: "Skechers", aliasNames: ["SKECHERS"], tier: "premium", parentCompany: "Skechers USA" },
  { id: "brand_bata", name: "Bata", aliasNames: ["BATA"], tier: "value", parentCompany: "Bata India" },

  // ---- beauty ----
  { id: "brand_fogg", name: "Fogg", aliasNames: ["FOGG"], tier: "value", parentCompany: "Vini Cosmetics" },
  { id: "brand_wild_stone", name: "Wild Stone", aliasNames: ["WILD STONE"], tier: "value", parentCompany: "McNROE Consumer Products" },
  { id: "brand_park_avenue", name: "Park Avenue", aliasNames: ["PARK AVENUE"], tier: "mid", parentCompany: "Raymond Consumer Care" },
  { id: "brand_calvin_klein", name: "Calvin Klein", aliasNames: ["CALVIN KLEIN", "CK"], tier: "premium", parentCompany: "PVH Corp." },
  { id: "brand_engage", name: "Engage", aliasNames: ["ENGAGE"], tier: "value", parentCompany: "ITC Limited" },
  { id: "brand_denver", name: "Denver", aliasNames: ["DENVER"], tier: "value", parentCompany: "Denver India" },
  { id: "brand_beardo", name: "Beardo", aliasNames: ["BEARDO"], tier: "mid", parentCompany: "Marico Limited" },
  { id: "brand_villain", name: "Villain", aliasNames: ["VILLAIN"], tier: "mid", parentCompany: "Villain Lifestyle" },

  // ---- wearables ----
  { id: "brand_titan", name: "Titan", aliasNames: ["TITAN"], tier: "mid", parentCompany: "Titan Company" },
  { id: "brand_fireboltt", name: "Fire-Boltt", aliasNames: ["FIRE-BOLTT", "Fireboltt"], tier: "value", parentCompany: "Boltt Coach" },
  { id: "brand_garmin", name: "Garmin", aliasNames: ["GARMIN"], tier: "premium", parentCompany: "Garmin Ltd." },
];

export function getBrand(brandId) {
  return brands.find((b) => b.id === brandId) ?? null;
}

/** Tier as an ordinal, for strength scoring: value 0, mid 1, premium 2. */
export const TIER_RANK = { value: 0, mid: 1, premium: 2 };
