// Compact seed definitions for the breadth of the catalogue.
//
// WHY A SEED + GENERATOR RATHER THAN HAND-WRITTEN ROWS:
// the original demo products (Galaxy M14 family and their comparables) are
// hand-authored in products.js/listings.js/offers.js because they carry
// deliberately irregular detail — stockouts, parser-version switches, promo
// stacks, a listing with no seller. That hand-authoring does not scale to a
// browsable catalogue.
//
// Everything below is expanded by utils/catalogueGenerator.js into REAL
// entities in the same arrays, with the same relationships and the same ID
// conventions: one Product, one Listing per marketplace, 1–3 Offers per
// listing (each with its own Seller), a full daily Price Observation series
// per offer, and a Review Snapshot series per listing. Nothing here is a
// shortcut around the data model — it is the same model, authored densely.
//
// `price` is the CURRENT CHEAPEST landed price in rupees. The generator
// guarantees the final observation of the cheapest offer lands exactly on it,
// so the catalogue card, the marketplace comparison and the price-history
// chart can never disagree.
//
// mps: 'fk' Flipkart · 'az' Amazon.in · 'mh' Meesho
// trend: 'down' (typical lifecycle decay) · 'flat' · 'up' (post-launch recovery)

export const catalogueSeed = [
  // ============================== SMARTPHONES ==============================
  { id: "moto_g84", name: "Motorola G84 5G (12GB RAM, 256GB) — Viva Magenta", brand: "brand_motorola", ptype: "ptype_smartphone", variant: { ram: "12GB", storage: "256GB", colour: "Viva Magenta" },
    specs: { ram_gb: 12, storage_gb: 256, battery_mah: 5000, display_in: 6.55, rear_camera_mp: 50, processor: "Snapdragon 695", has_5g: true, refresh_rate_hz: 120, charging_w: 33 },
    price: 15999, mrp: 19999, rating: 4.2, reviews: 12400, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "nothing_2a", name: "Nothing Phone (2a) (8GB RAM, 128GB) — Black", brand: "brand_nothing", ptype: "ptype_smartphone", variant: { ram: "8GB", storage: "128GB", colour: "Black" },
    specs: { ram_gb: 8, storage_gb: 128, battery_mah: 5000, display_in: 6.7, rear_camera_mp: 50, processor: "Dimensity 7200 Pro", has_5g: true, refresh_rate_hz: 120, charging_w: 45 },
    price: 23999, mrp: 25999, rating: 4.4, reviews: 8900, mps: ["fk", "az"], sellers: 2, trend: "flat" },
  { id: "pixel_8a", name: "Google Pixel 8a (8GB RAM, 128GB) — Bay", brand: "brand_google", ptype: "ptype_smartphone", variant: { ram: "8GB", storage: "128GB", colour: "Bay" },
    specs: { ram_gb: 8, storage_gb: 128, battery_mah: 4492, display_in: 6.1, rear_camera_mp: 64, processor: "Google Tensor G3", has_5g: true, refresh_rate_hz: 120, charging_w: 18 },
    price: 41999, mrp: 52999, rating: 4.5, reviews: 5200, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "galaxy_s23fe", name: "Samsung Galaxy S23 FE (8GB RAM, 128GB) — Mint", brand: "brand_samsung", ptype: "ptype_smartphone", variant: { ram: "8GB", storage: "128GB", colour: "Mint" },
    specs: { ram_gb: 8, storage_gb: 128, battery_mah: 4500, display_in: 6.4, rear_camera_mp: 50, processor: "Exynos 2200", has_5g: true, refresh_rate_hz: 120, charging_w: 25 },
    price: 34999, mrp: 59999, rating: 4.4, reviews: 7600, mps: ["fk", "az"], sellers: 3, trend: "down" },
  { id: "narzo_70", name: "realme NARZO 70 5G (6GB RAM, 128GB) — Ice Blue", brand: "brand_realme", ptype: "ptype_smartphone", variant: { ram: "6GB", storage: "128GB", colour: "Ice Blue" },
    specs: { ram_gb: 6, storage_gb: 128, battery_mah: 5000, display_in: 6.67, rear_camera_mp: 50, processor: "Dimensity 7050", has_5g: true, refresh_rate_hz: 120, charging_w: 45 },
    price: 13499, mrp: 16999, rating: 4.1, reviews: 9800, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "redmi_note13pro", name: "Redmi Note 13 Pro 5G (8GB RAM, 256GB) — Midnight Black", brand: "brand_xiaomi", ptype: "ptype_smartphone", variant: { ram: "8GB", storage: "256GB", colour: "Midnight Black" },
    specs: { ram_gb: 8, storage_gb: 256, battery_mah: 5100, display_in: 6.67, rear_camera_mp: 200, processor: "Snapdragon 7s Gen 2", has_5g: true, refresh_rate_hz: 120, charging_w: 67 },
    price: 21999, mrp: 26999, rating: 4.3, reviews: 15600, mps: ["fk", "az"], sellers: 3, trend: "down" },

  // ============================== POWER BANKS ==============================
  { id: "mi_pb_10000", name: "Mi Power Bank 3i (10000 mAh) — Black", brand: "brand_mi", ptype: "ptype_power_bank", variant: { capacity: "10000mAh", colour: "Black" },
    specs: { capacity_mah: 10000, output_w: 18, ports: 2, has_fast_charging: true, weight_g: 251 },
    price: 1199, mrp: 1999, rating: 4.2, reviews: 34000, mps: ["fk", "az"], sellers: 2, trend: "flat" },
  { id: "ambrane_pb_20000", name: "Ambrane Stylo Pro (20000 mAh) — Black", brand: "brand_ambrane", ptype: "ptype_power_bank", variant: { capacity: "20000mAh", colour: "Black" },
    specs: { capacity_mah: 20000, output_w: 22, ports: 3, has_fast_charging: true, weight_g: 420 },
    price: 1799, mrp: 2999, rating: 4.0, reviews: 18000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "anker_pb_20000", name: "Anker PowerCore 20000 (65W) — Black", brand: "brand_anker", ptype: "ptype_power_bank", variant: { capacity: "20000mAh", colour: "Black" },
    specs: { capacity_mah: 20000, output_w: 65, ports: 3, has_fast_charging: true, weight_g: 460 },
    price: 4999, mrp: 6999, rating: 4.5, reviews: 6200, mps: ["az"], sellers: 1, trend: "flat" },
  { id: "boat_pb_10000", name: "boAt Energyshroom PB300 (10000 mAh) — Grey", brand: "brand_boat", ptype: "ptype_power_bank", variant: { capacity: "10000mAh", colour: "Grey" },
    specs: { capacity_mah: 10000, output_w: 20, ports: 2, has_fast_charging: true, weight_g: 240 },
    price: 1099, mrp: 1999, rating: 4.0, reviews: 12000, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  // ============================ EVERYDAY LAPTOPS ===========================
  { id: "acer_aspire_lite", name: "Acer Aspire Lite (Core i5, 8GB RAM, 512GB SSD)", brand: "brand_acer", ptype: "ptype_laptop", variant: { processor: "Core i5", ram: "8GB", storage: "512GB" },
    specs: { ram_gb: 8, storage_gb: 512, storage_type: "SSD", processor: "Intel Core i5-1235U", gpu: "Integrated Intel Iris Xe", display_in: 15.6, battery_hours: 8, weight_kg: 1.59 },
    price: 36990, mrp: 52999, rating: 4.1, reviews: 3200, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "hp_15s_i3", name: "HP 15s (Core i3, 8GB RAM, 512GB SSD)", brand: "brand_hp", ptype: "ptype_laptop", variant: { processor: "Core i3", ram: "8GB", storage: "512GB" },
    specs: { ram_gb: 8, storage_gb: 512, storage_type: "SSD", processor: "Intel Core i3-1315U", gpu: "Integrated Intel UHD", display_in: 15.6, battery_hours: 9, weight_kg: 1.59 },
    price: 31990, mrp: 42999, rating: 4.0, reviews: 4100, mps: ["fk"], sellers: 1, trend: "down" },
  { id: "macbook_air_m3", name: "Apple MacBook Air M3 (8GB RAM, 256GB SSD) — Starlight", brand: "brand_apple", ptype: "ptype_laptop", variant: { ram: "8GB", storage: "256GB", colour: "Starlight" },
    specs: { ram_gb: 8, storage_gb: 256, storage_type: "SSD", processor: "Apple M3", gpu: "Apple M3 10-core GPU", display_in: 13.6, battery_hours: 18, weight_kg: 1.24 },
    price: 104900, mrp: 114900, rating: 4.8, reviews: 2100, mps: ["az"], sellers: 2, trend: "flat" },

  // ============================= GAMING LAPTOPS ============================
  { id: "lenovo_loq", name: "Lenovo LOQ (Core i5, 16GB RAM, 512GB SSD, RTX 3050)", brand: "brand_lenovo", ptype: "ptype_gaming_laptop", variant: { processor: "Core i5", ram: "16GB", storage: "512GB" },
    specs: { ram_gb: 16, storage_gb: 512, processor: "Intel Core i5-12450HX", gpu: "NVIDIA RTX 3050", refresh_rate_hz: 144, display_in: 15.6, weight_kg: 2.4 },
    price: 64990, mrp: 89999, rating: 4.3, reviews: 2800, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "msi_thin_gf63", name: "MSI Thin GF63 (Core i5, 8GB RAM, 512GB SSD, RTX 2050)", brand: "brand_msi", ptype: "ptype_gaming_laptop", variant: { processor: "Core i5", ram: "8GB", storage: "512GB" },
    specs: { ram_gb: 8, storage_gb: 512, processor: "Intel Core i5-12450H", gpu: "NVIDIA RTX 2050", refresh_rate_hz: 144, display_in: 15.6, weight_kg: 1.86 },
    price: 52990, mrp: 74990, rating: 4.1, reviews: 1900, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "hp_victus", name: "HP Victus (Ryzen 5, 16GB RAM, 512GB SSD, RTX 4050)", brand: "brand_hp", ptype: "ptype_gaming_laptop", variant: { processor: "Ryzen 5", ram: "16GB", storage: "512GB" },
    specs: { ram_gb: 16, storage_gb: 512, processor: "AMD Ryzen 5 7535HS", gpu: "NVIDIA RTX 4050", refresh_rate_hz: 144, display_in: 15.6, weight_kg: 2.29 },
    price: 69990, mrp: 89999, rating: 4.2, reviews: 2400, mps: ["fk"], sellers: 2, trend: "flat" },

  // ============================ WIRELESS EARBUDS ===========================
  { id: "jbl_tune230", name: "JBL Tune 230NC TWS — Black", brand: "brand_jbl", ptype: "ptype_earbuds", variant: { colour: "Black" },
    specs: { battery_life_hours: 10, total_battery_hours: 40, has_anc: true, driver_size_mm: 6, bluetooth_version: "5.2", water_resistance: "IPX4", charging_type: "USB-C" },
    price: 3499, mrp: 5999, rating: 4.2, reviews: 8900, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "noise_buds_vs104", name: "Noise Buds VS104 — Jet Black", brand: "brand_noise", ptype: "ptype_earbuds", variant: { colour: "Jet Black" },
    specs: { battery_life_hours: 10, total_battery_hours: 45, has_anc: false, driver_size_mm: 13, bluetooth_version: "5.3", water_resistance: "IPX5", charging_type: "USB-C" },
    price: 1099, mrp: 3999, rating: 3.9, reviews: 24000, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  // ========================== OVER-EAR HEADPHONES ==========================
  { id: "sony_wh1000xm4", name: "Sony WH-1000XM4 Wireless Headphones — Black", brand: "brand_sony", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 30, has_anc: true, driver_size_mm: 40, connectivity: "Bluetooth", weight_g: 254 },
    price: 19990, mrp: 29990, rating: 4.7, reviews: 12400, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "boat_rockerz550", name: "boAt Rockerz 550 — Black", brand: "brand_boat", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 20, has_anc: false, driver_size_mm: 50, connectivity: "Bluetooth", weight_g: 245 },
    price: 1499, mrp: 4990, rating: 4.1, reviews: 32000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "jbl_tune760nc", name: "JBL Tune 760NC — Black", brand: "brand_jbl", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 50, has_anc: true, driver_size_mm: 40, connectivity: "Bluetooth", weight_g: 220 },
    price: 5999, mrp: 9999, rating: 4.3, reviews: 7800, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "sennheiser_hd450bt", name: "Sennheiser HD 450BT — Black", brand: "brand_sennheiser", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 30, has_anc: true, driver_size_mm: 32, connectivity: "Bluetooth", weight_g: 238 },
    price: 9990, mrp: 14990, rating: 4.4, reviews: 3100, mps: ["az"], sellers: 1, trend: "down" },

  // ============================== TELEVISIONS ==============================
  { id: "tcl_43_4k", name: "TCL 43\" 4K Ultra HD Smart LED TV", brand: "brand_tcl", ptype: "ptype_television", variant: { size: "43 inch" },
    specs: { screen_size_in: 43, resolution: "4K Ultra HD", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Google TV", hdmi_ports: 3 },
    price: 24990, mrp: 39990, rating: 4.1, reviews: 6700, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "samsung_43_4k", name: "Samsung 43\" Crystal 4K Smart TV", brand: "brand_samsung", ptype: "ptype_television", variant: { size: "43 inch" },
    specs: { screen_size_in: 43, resolution: "4K Ultra HD", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Tizen", hdmi_ports: 3 },
    price: 32990, mrp: 47900, rating: 4.3, reviews: 8900, mps: ["fk", "az"], sellers: 3, trend: "down" },
  { id: "lg_55_oled", name: "LG 55\" OLED evo 4K Smart TV", brand: "brand_lg", ptype: "ptype_television", variant: { size: "55 inch" },
    specs: { screen_size_in: 55, resolution: "4K Ultra HD", panel_type: "OLED", refresh_rate_hz: 120, smart_os: "webOS", hdmi_ports: 4 },
    price: 129990, mrp: 199990, rating: 4.7, reviews: 2300, mps: ["az"], sellers: 2, trend: "down" },
  { id: "hisense_50_4k", name: "Hisense 50\" QLED 4K Smart TV", brand: "brand_hisense", ptype: "ptype_television", variant: { size: "50 inch" },
    specs: { screen_size_in: 50, resolution: "4K Ultra HD", panel_type: "QLED", refresh_rate_hz: 60, smart_os: "Google TV", hdmi_ports: 3 },
    price: 36990, mrp: 59990, rating: 4.0, reviews: 4200, mps: ["fk"], sellers: 2, trend: "down" },
  { id: "sony_55_4k", name: "Sony BRAVIA 55\" 4K Smart TV", brand: "brand_sony", ptype: "ptype_television", variant: { size: "55 inch" },
    specs: { screen_size_in: 55, resolution: "4K Ultra HD", panel_type: "LED", refresh_rate_hz: 120, smart_os: "Google TV", hdmi_ports: 4 },
    price: 79990, mrp: 99900, rating: 4.6, reviews: 3400, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "tcl_32_hd", name: "TCL 32\" HD Ready Smart LED TV", brand: "brand_tcl", ptype: "ptype_television", variant: { size: "32 inch" },
    specs: { screen_size_in: 32, resolution: "HD Ready", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Android TV", hdmi_ports: 2 },
    price: 11990, mrp: 19990, rating: 3.9, reviews: 15000, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  // ============================= REFRIGERATORS =============================
  { id: "lg_260_double", name: "LG 260 L Frost Free Double Door Refrigerator", brand: "brand_lg", ptype: "ptype_refrigerator", variant: { capacity: "260 L" },
    specs: { capacity_l: 260, door_type: "Double Door", star_rating: 3, defrost_type: "Frost Free", has_inverter: true },
    price: 27990, mrp: 38990, rating: 4.3, reviews: 5600, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "samsung_192_single", name: "Samsung 192 L Direct Cool Single Door Refrigerator", brand: "brand_samsung", ptype: "ptype_refrigerator", variant: { capacity: "192 L" },
    specs: { capacity_l: 192, door_type: "Single Door", star_rating: 4, defrost_type: "Direct Cool", has_inverter: true },
    price: 16990, mrp: 22900, rating: 4.2, reviews: 8900, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "whirlpool_240_double", name: "Whirlpool 240 L Frost Free Double Door Refrigerator", brand: "brand_whirlpool", ptype: "ptype_refrigerator", variant: { capacity: "240 L" },
    specs: { capacity_l: 240, door_type: "Double Door", star_rating: 2, defrost_type: "Frost Free", has_inverter: false },
    price: 22490, mrp: 32900, rating: 4.0, reviews: 4300, mps: ["fk"], sellers: 2, trend: "down" },
  { id: "godrej_180_single", name: "Godrej 180 L Direct Cool Single Door Refrigerator", brand: "brand_godrej", ptype: "ptype_refrigerator", variant: { capacity: "180 L" },
    specs: { capacity_l: 180, door_type: "Single Door", star_rating: 3, defrost_type: "Direct Cool", has_inverter: false },
    price: 13990, mrp: 18500, rating: 3.9, reviews: 6200, mps: ["fk", "mh"], sellers: 2, trend: "flat" },
  { id: "bosch_559_side", name: "Bosch 559 L Side by Side Refrigerator", brand: "brand_bosch", ptype: "ptype_refrigerator", variant: { capacity: "559 L" },
    specs: { capacity_l: 559, door_type: "Side by Side", star_rating: 3, defrost_type: "Frost Free", has_inverter: true },
    price: 78990, mrp: 109900, rating: 4.5, reviews: 900, mps: ["az"], sellers: 1, trend: "down" },

  // =========================== WASHING MACHINES ============================
  { id: "lg_7_front", name: "LG 7 kg Fully Automatic Front Load Washing Machine", brand: "brand_lg", ptype: "ptype_washing_machine", variant: { capacity: "7 kg" },
    specs: { capacity_kg: 7, load_type: "Front Load", is_fully_automatic: true, star_rating: 5, max_spin_rpm: 1200 },
    price: 31990, mrp: 42990, rating: 4.4, reviews: 4100, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "samsung_65_top", name: "Samsung 6.5 kg Fully Automatic Top Load Washing Machine", brand: "brand_samsung", ptype: "ptype_washing_machine", variant: { capacity: "6.5 kg" },
    specs: { capacity_kg: 6.5, load_type: "Top Load", is_fully_automatic: true, star_rating: 4, max_spin_rpm: 700 },
    price: 16490, mrp: 21900, rating: 4.2, reviews: 7800, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "ifb_8_front", name: "IFB 8 kg Fully Automatic Front Load Washing Machine", brand: "brand_ifb", ptype: "ptype_washing_machine", variant: { capacity: "8 kg" },
    specs: { capacity_kg: 8, load_type: "Front Load", is_fully_automatic: true, star_rating: 5, max_spin_rpm: 1400 },
    price: 38990, mrp: 51990, rating: 4.3, reviews: 2600, mps: ["az"], sellers: 2, trend: "down" },
  { id: "whirlpool_75_top", name: "Whirlpool 7.5 kg Fully Automatic Top Load Washing Machine", brand: "brand_whirlpool", ptype: "ptype_washing_machine", variant: { capacity: "7.5 kg" },
    specs: { capacity_kg: 7.5, load_type: "Top Load", is_fully_automatic: true, star_rating: 5, max_spin_rpm: 740 },
    price: 18990, mrp: 25500, rating: 4.1, reviews: 5300, mps: ["fk"], sellers: 2, trend: "flat" },
  { id: "bosch_7_front", name: "Bosch 7 kg Fully Automatic Front Load Washing Machine", brand: "brand_bosch", ptype: "ptype_washing_machine", variant: { capacity: "7 kg" },
    specs: { capacity_kg: 7, load_type: "Front Load", is_fully_automatic: true, star_rating: 5, max_spin_rpm: 1200 },
    price: 34990, mrp: 46990, rating: 4.5, reviews: 1800, mps: ["az", "fk"], sellers: 2, trend: "down" },

  // ============================ MICROWAVE OVENS ============================
  { id: "lg_28_convection", name: "LG 28 L Convection Microwave Oven", brand: "brand_lg", ptype: "ptype_microwave", variant: { capacity: "28 L" },
    specs: { capacity_l: 28, oven_type: "Convection", power_w: 900, has_auto_cook: true },
    price: 14990, mrp: 21990, rating: 4.3, reviews: 3400, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "samsung_23_solo", name: "Samsung 23 L Solo Microwave Oven", brand: "brand_samsung", ptype: "ptype_microwave", variant: { capacity: "23 L" },
    specs: { capacity_l: 23, oven_type: "Solo", power_w: 800, has_auto_cook: true },
    price: 7490, mrp: 10900, rating: 4.1, reviews: 5600, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "ifb_20_grill", name: "IFB 20 L Grill Microwave Oven", brand: "brand_ifb", ptype: "ptype_microwave", variant: { capacity: "20 L" },
    specs: { capacity_l: 20, oven_type: "Grill", power_w: 800, has_auto_cook: true },
    price: 8990, mrp: 12490, rating: 4.0, reviews: 2800, mps: ["fk"], sellers: 1, trend: "flat" },
  { id: "bajaj_17_solo", name: "Bajaj 17 L Solo Microwave Oven", brand: "brand_bajaj", ptype: "ptype_microwave", variant: { capacity: "17 L" },
    specs: { capacity_l: 17, oven_type: "Solo", power_w: 700, has_auto_cook: false },
    price: 5290, mrp: 7499, rating: 3.8, reviews: 4100, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  // ============================ MIXER GRINDERS =============================
  { id: "philips_mg_750", name: "Philips HL7756 750W Mixer Grinder (3 Jars)", brand: "brand_philips", ptype: "ptype_mixer_grinder", variant: { power: "750 W" },
    specs: { power_w: 750, jars: 3, speed_settings: 3, warranty_years: 2 },
    price: 3995, mrp: 5795, rating: 4.3, reviews: 12000, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "bajaj_mg_500", name: "Bajaj Rex 500W Mixer Grinder (3 Jars)", brand: "brand_bajaj", ptype: "ptype_mixer_grinder", variant: { power: "500 W" },
    specs: { power_w: 500, jars: 3, speed_settings: 3, warranty_years: 1 },
    price: 2299, mrp: 3699, rating: 4.0, reviews: 18000, mps: ["fk", "mh"], sellers: 2, trend: "flat" },
  { id: "prestige_mg_750", name: "Prestige Iris 750W Mixer Grinder (4 Jars)", brand: "brand_prestige", ptype: "ptype_mixer_grinder", variant: { power: "750 W" },
    specs: { power_w: 750, jars: 4, speed_settings: 3, warranty_years: 2 },
    price: 4495, mrp: 6795, rating: 4.2, reviews: 8900, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "havells_mg_600", name: "Havells Sprint 600W Mixer Grinder (3 Jars)", brand: "brand_havells", ptype: "ptype_mixer_grinder", variant: { power: "600 W" },
    specs: { power_w: 600, jars: 3, speed_settings: 3, warranty_years: 5 },
    price: 3299, mrp: 4995, rating: 4.1, reviews: 5400, mps: ["fk"], sellers: 1, trend: "down" },

  // ============================= OFFICE CHAIRS =============================
  { id: "green_soul_high", name: "Green Soul Beast High Back Mesh Office Chair", brand: "brand_green_soul", ptype: "ptype_office_chair", variant: { back: "High Back", colour: "Black" },
    specs: { back_type: "High Back", material: "Mesh", has_lumbar_support: true, has_adjustable_armrest: true, max_load_kg: 120, warranty_years: 3 },
    price: 8999, mrp: 17999, rating: 4.3, reviews: 9800, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "featherlite_exec", name: "Featherlite Executive High Back Leatherette Chair", brand: "brand_featherlite", ptype: "ptype_office_chair", variant: { back: "High Back", colour: "Black" },
    specs: { back_type: "High Back", material: "Leatherette", has_lumbar_support: true, has_adjustable_armrest: true, max_load_kg: 110, warranty_years: 5 },
    price: 14990, mrp: 22990, rating: 4.4, reviews: 2100, mps: ["az"], sellers: 1, trend: "flat" },
  { id: "nilkamal_mid", name: "Nilkamal Mid Back Fabric Office Chair", brand: "brand_nilkamal", ptype: "ptype_office_chair", variant: { back: "Mid Back", colour: "Grey" },
    specs: { back_type: "Mid Back", material: "Fabric", has_lumbar_support: false, has_adjustable_armrest: false, max_load_kg: 90, warranty_years: 1 },
    price: 4290, mrp: 7500, rating: 3.8, reviews: 3400, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "green_soul_mid", name: "Green Soul Vienna Mid Back Mesh Office Chair", brand: "brand_green_soul", ptype: "ptype_office_chair", variant: { back: "Mid Back", colour: "Black" },
    specs: { back_type: "Mid Back", material: "Mesh", has_lumbar_support: true, has_adjustable_armrest: false, max_load_kg: 100, warranty_years: 2 },
    price: 6499, mrp: 12999, rating: 4.1, reviews: 6700, mps: ["fk", "az"], sellers: 2, trend: "down" },

  // ================================ T-SHIRTS ===============================
  { id: "roadster_round_m", name: "Roadster Solid Round Neck T-Shirt — Navy", brand: "brand_roadster", ptype: "ptype_tshirt", variant: { size: "M", colour: "Navy" },
    specs: { size: "M", fabric: "Cotton", fit: "Regular", sleeve: "Half Sleeve", neck: "Round Neck", pattern: "Solid" },
    price: 499, mrp: 1299, rating: 4.1, reviews: 22000, mps: ["fk", "mh"], sellers: 2, trend: "flat" },
  { id: "us_polo_polo_l", name: "U.S. Polo Assn. Solid Polo T-Shirt — White", brand: "brand_us_polo", ptype: "ptype_tshirt", variant: { size: "L", colour: "White" },
    specs: { size: "L", fabric: "Cotton", fit: "Slim", sleeve: "Half Sleeve", neck: "Polo Neck", pattern: "Solid" },
    price: 1299, mrp: 2499, rating: 4.3, reviews: 8900, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "levis_round_m", name: "Levi's Printed Round Neck T-Shirt — Black", brand: "brand_levis", ptype: "ptype_tshirt", variant: { size: "M", colour: "Black" },
    specs: { size: "M", fabric: "Cotton", fit: "Slim", sleeve: "Half Sleeve", neck: "Round Neck", pattern: "Printed" },
    price: 899, mrp: 1799, rating: 4.2, reviews: 5600, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "puma_dryfit_l", name: "Puma dryCELL Training T-Shirt — Grey", brand: "brand_puma", ptype: "ptype_tshirt", variant: { size: "L", colour: "Grey" },
    specs: { size: "L", fabric: "Polyester", fit: "Regular", sleeve: "Half Sleeve", neck: "Round Neck", pattern: "Solid" },
    price: 749, mrp: 1499, rating: 4.0, reviews: 11000, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "allen_solly_polo_m", name: "Allen Solly Striped Polo T-Shirt — Blue", brand: "brand_allen_solly", ptype: "ptype_tshirt", variant: { size: "M", colour: "Blue" },
    specs: { size: "M", fabric: "Cotton Blend", fit: "Regular", sleeve: "Half Sleeve", neck: "Polo Neck", pattern: "Striped" },
    price: 1099, mrp: 1999, rating: 4.2, reviews: 4300, mps: ["fk"], sellers: 1, trend: "flat" },
  { id: "roadster_full_xl", name: "Roadster Solid Full Sleeve T-Shirt — Olive", brand: "brand_roadster", ptype: "ptype_tshirt", variant: { size: "XL", colour: "Olive" },
    specs: { size: "XL", fabric: "Cotton", fit: "Regular", sleeve: "Full Sleeve", neck: "Round Neck", pattern: "Solid" },
    price: 649, mrp: 1499, rating: 4.0, reviews: 9800, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  // ============================= RUNNING SHOES =============================
  { id: "nike_revolution7", name: "Nike Revolution 7 Running Shoes — Black", brand: "brand_nike", ptype: "ptype_running_shoes", variant: { size: "UK 9", colour: "Black" },
    specs: { size_uk: 9, gender: "Men", upper_material: "Mesh", sole_material: "Rubber", use_type: "Road Running", weight_g: 280, has_cushioning: true },
    price: 3995, mrp: 4995, rating: 4.4, reviews: 6700, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "adidas_galaxy6", name: "Adidas Galaxy 6 Running Shoes — Grey", brand: "brand_adidas", ptype: "ptype_running_shoes", variant: { size: "UK 8", colour: "Grey" },
    specs: { size_uk: 8, gender: "Men", upper_material: "Mesh", sole_material: "Rubber", use_type: "Road Running", weight_g: 300, has_cushioning: true },
    price: 3499, mrp: 4999, rating: 4.3, reviews: 5400, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "puma_flyer", name: "Puma Flyer Runner Shoes — Blue", brand: "brand_puma", ptype: "ptype_running_shoes", variant: { size: "UK 9", colour: "Blue" },
    specs: { size_uk: 9, gender: "Men", upper_material: "Mesh", sole_material: "Rubber", use_type: "Road Running", weight_g: 290, has_cushioning: true },
    price: 2499, mrp: 4499, rating: 4.1, reviews: 8900, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "campus_oxyfit", name: "Campus Oxyfit Running Shoes — Black", brand: "brand_campus", ptype: "ptype_running_shoes", variant: { size: "UK 8", colour: "Black" },
    specs: { size_uk: 8, gender: "Men", upper_material: "Mesh", sole_material: "EVA", use_type: "Road Running", weight_g: 320, has_cushioning: false },
    price: 1199, mrp: 1999, rating: 3.9, reviews: 24000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "asics_gel", name: "ASICS GEL-Contend 8 Running Shoes — White", brand: "brand_asics", ptype: "ptype_running_shoes", variant: { size: "UK 9", colour: "White" },
    specs: { size_uk: 9, gender: "Men", upper_material: "Mesh", sole_material: "Rubber", use_type: "Road Running", weight_g: 265, has_cushioning: true },
    price: 7999, mrp: 10999, rating: 4.6, reviews: 1800, mps: ["az"], sellers: 1, trend: "down" },
  { id: "adidas_women_run", name: "Adidas Duramo SL Women's Running Shoes — Pink", brand: "brand_adidas", ptype: "ptype_running_shoes", variant: { size: "UK 6", colour: "Pink" },
    specs: { size_uk: 6, gender: "Women", upper_material: "Mesh", sole_material: "Rubber", use_type: "Road Running", weight_g: 250, has_cushioning: true },
    price: 3299, mrp: 4799, rating: 4.2, reviews: 3200, mps: ["fk", "az"], sellers: 2, trend: "down" },

  // ================================ PERFUMES ===============================
  { id: "fogg_scent", name: "Fogg Scent Xpressio Perfume (100 ml)", brand: "brand_fogg", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Parfum", fragrance_family: "Woody", gender: "Men", longevity_hours: 8 },
    price: 399, mrp: 750, rating: 4.1, reviews: 34000, mps: ["fk", "mh"], sellers: 2, trend: "flat" },
  { id: "wild_stone_ultra", name: "Wild Stone Ultra Sensual Perfume (100 ml)", brand: "brand_wild_stone", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Toilette", fragrance_family: "Aromatic", gender: "Men", longevity_hours: 6 },
    price: 549, mrp: 999, rating: 4.0, reviews: 18000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "park_avenue_perfume", name: "Park Avenue Storm Perfume (100 ml)", brand: "brand_park_avenue", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Parfum", fragrance_family: "Fresh", gender: "Men", longevity_hours: 8 },
    price: 699, mrp: 1250, rating: 4.1, reviews: 9800, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "calvin_klein_one", name: "Calvin Klein CK One Eau de Toilette (100 ml)", brand: "brand_calvin_klein", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Toilette", fragrance_family: "Citrus", gender: "Unisex", longevity_hours: 10 },
    price: 3499, mrp: 5500, rating: 4.5, reviews: 4200, mps: ["az", "fk"], sellers: 2, trend: "down" },

  // ===================== DENSITY FILLERS ============================
  // Added after an audit showed several categories had products stranded at
  // the extremes of their price range with no peers, which correctly caused
  // the engine to refuse a recommendation. A real category has products
  // between the cheap and the flagship; these fill those gaps so the
  // comparable-set gates have something legitimate to work with.
  { id: "boat_rockerz551", name: "boAt Rockerz 551ANC — Black", brand: "brand_boat", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 40, has_anc: true, driver_size_mm: 40, connectivity: "Bluetooth", weight_g: 250 },
    price: 2499, mrp: 5990, rating: 4.0, reviews: 14000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "jbl_tune520bt", name: "JBL Tune 520BT — Blue", brand: "brand_jbl", ptype: "ptype_headphones", variant: { colour: "Blue" },
    specs: { battery_life_hours: 57, has_anc: false, driver_size_mm: 33, connectivity: "Bluetooth", weight_g: 160 },
    price: 3499, mrp: 5999, rating: 4.2, reviews: 9200, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "sony_whch720n", name: "Sony WH-CH720N Wireless Headphones — Black", brand: "brand_sony", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 35, has_anc: true, driver_size_mm: 30, connectivity: "Bluetooth", weight_g: 192 },
    price: 8990, mrp: 14990, rating: 4.4, reviews: 5600, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "noise_three_headphones", name: "Noise Three Over-Ear Headphones — Grey", brand: "brand_noise", ptype: "ptype_headphones", variant: { colour: "Grey" },
    specs: { battery_life_hours: 60, has_anc: false, driver_size_mm: 40, connectivity: "Bluetooth", weight_g: 230 },
    price: 1999, mrp: 4999, rating: 3.9, reviews: 11000, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  { id: "sony_wf1000xm4", name: "Sony WF-1000XM4 True Wireless Earbuds — Black", brand: "brand_sony", ptype: "ptype_earbuds", variant: { colour: "Black" },
    specs: { battery_life_hours: 8, total_battery_hours: 24, has_anc: true, driver_size_mm: 6, bluetooth_version: "5.2", water_resistance: "IPX4", charging_type: "Wireless" },
    price: 14990, mrp: 21990, rating: 4.5, reviews: 6100, mps: ["az", "fk"], sellers: 2, trend: "down" },

  { id: "samsung_55_qled", name: "Samsung 55\" QLED 4K Smart TV", brand: "brand_samsung", ptype: "ptype_television", variant: { size: "55 inch" },
    specs: { screen_size_in: 55, resolution: "4K Ultra HD", panel_type: "QLED", refresh_rate_hz: 120, smart_os: "Tizen", hdmi_ports: 4 },
    price: 62990, mrp: 89900, rating: 4.4, reviews: 4100, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "lg_65_qned", name: "LG 65\" QNED 4K Smart TV", brand: "brand_lg", ptype: "ptype_television", variant: { size: "65 inch" },
    specs: { screen_size_in: 65, resolution: "4K Ultra HD", panel_type: "QLED", refresh_rate_hz: 120, smart_os: "webOS", hdmi_ports: 4 },
    price: 109990, mrp: 159990, rating: 4.5, reviews: 1600, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "tcl_43_hd_budget", name: "TCL 43\" Full HD Smart LED TV", brand: "brand_tcl", ptype: "ptype_television", variant: { size: "43 inch" },
    specs: { screen_size_in: 43, resolution: "Full HD", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Android TV", hdmi_ports: 2 },
    price: 18990, mrp: 29990, rating: 4.0, reviews: 9800, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  { id: "titan_talk_s", name: "Titan Talk S Smartwatch — Silver", brand: "brand_titan", ptype: "ptype_smartwatch", variant: { colour: "Silver" },
    specs: { display_in: 1.7, display_type: "AMOLED", battery_days: 6, has_gps: false, has_calling: true, water_resistance: "IP68" },
    price: 8995, mrp: 14995, rating: 4.2, reviews: 4200, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "noise_pro_6", name: "Noise Pro 6 GPS Smartwatch — Black", brand: "brand_noise", ptype: "ptype_smartwatch", variant: { colour: "Black" },
    specs: { display_in: 1.46, display_type: "AMOLED", battery_days: 4, has_gps: true, has_calling: true, water_resistance: "5ATM" },
    price: 15999, mrp: 24999, rating: 4.1, reviews: 3100, mps: ["fk", "az"], sellers: 2, trend: "down" },

  { id: "anker_pb_10000_pd", name: "Anker PowerCore 10000 PD — Black", brand: "brand_anker", ptype: "ptype_power_bank", variant: { capacity: "10000mAh", colour: "Black" },
    specs: { capacity_mah: 10000, output_w: 30, ports: 2, has_fast_charging: true, weight_g: 195 },
    price: 2999, mrp: 4499, rating: 4.4, reviews: 8200, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "ambrane_pb_27000", name: "Ambrane PowerLit 27000 (65W) — Black", brand: "brand_ambrane", ptype: "ptype_power_bank", variant: { capacity: "27000mAh", colour: "Black" },
    specs: { capacity_mah: 27000, output_w: 65, ports: 3, has_fast_charging: true, weight_g: 520 },
    price: 3999, mrp: 6999, rating: 4.1, reviews: 4600, mps: ["fk", "az"], sellers: 2, trend: "down" },

  { id: "asus_zenbook_oled", name: "ASUS Zenbook 14 OLED (Core i7, 16GB RAM, 512GB SSD)", brand: "brand_asus", ptype: "ptype_laptop", variant: { processor: "Core i7", ram: "16GB", storage: "512GB" },
    specs: { ram_gb: 16, storage_gb: 512, storage_type: "SSD", processor: "Intel Core i7-1355U", gpu: "Integrated Intel Iris Xe", display_in: 14, battery_hours: 13, weight_kg: 1.28 },
    price: 89990, mrp: 119990, rating: 4.5, reviews: 1400, mps: ["az", "fk"], sellers: 2, trend: "down" },

  // ---- Deliberate test fixtures for two engine behaviours that otherwise
  // had no representative in the dataset, so their code paths went unexercised.

  // Case D — CURRENTLY ON PROMOTION. `promoNow` keeps a discount running right
  // up to today, so the current market sits well below the 90-day normal. The
  // engine should notice the market is promotionally depressed and lean toward
  // the normal level rather than treating the dip as the new baseline.
  { id: "jbl_go4_speaker_promo", name: "JBL Wave Buds 2 — Black", brand: "brand_jbl", ptype: "ptype_earbuds", variant: { colour: "Black" },
    specs: { battery_life_hours: 8, total_battery_hours: 40, has_anc: true, driver_size_mm: 10, bluetooth_version: "5.3", water_resistance: "IP54", charging_type: "USB-C" },
    price: 2299, mrp: 5999, rating: 4.2, reviews: 7400, mps: ["fk", "az"], sellers: 2, trend: "flat", promoNow: true },

  // Case F — TIGHT MRP. A no-frills model whose printed MRP sits only just
  // above its selling price, well inside the competitive band. Any premium the
  // engine wants to take should be cut off by the MRP ceiling.
  { id: "noise_basic_tightmrp", name: "Noise Fit Play Smartwatch — Jet Black", brand: "brand_noise", ptype: "ptype_smartwatch", variant: { colour: "Jet Black" },
    specs: { display_in: 1.81, display_type: "LCD", battery_days: 7, has_gps: false, has_calling: true, water_resistance: "IP68" },
    price: 1299, mrp: 1329, rating: 4.0, reviews: 18500, mps: ["fk", "mh"], sellers: 2, trend: "flat" },

  // Case H — PAID SHIPPING. Every other generated offer ships free, so the
  // shipping rung of the price ladder was never exercised outside the curated
  // Galaxy M14 data. `shipping` is charged on top of the selling price, so the
  // comparison price a buyer actually pays is higher than the number on the
  // page — and the engine must benchmark on the higher one.
  { id: "zebronics_zeb_pb", name: "Zebronics Zeb-PG10000 Power Bank (10000 mAh) — Blue", brand: "brand_zebronics", ptype: "ptype_power_bank", variant: { capacity: "10000mAh", colour: "Blue" },
    specs: { capacity_mah: 10000, output_w: 20, ports: 2, has_fast_charging: true, weight_g: 245 },
    price: 1149, mrp: 1999, rating: 3.9, reviews: 8600, mps: ["mh", "fk"], sellers: 2, trend: "flat", shipping: 79 },

  // Case I — CURRENTLY OUT OF STOCK. Every seller of this product has gone out
  // of stock in the last few days. There is no price a buyer can pay today, so
  // the engine must refuse rather than quote the last price it happened to see.
  // Its historical observations remain, which is exactly the trap: a naive
  // implementation reads the final row and reports a live price.
  { id: "portronics_oos", name: "Portronics Power Plate 11 (10000 mAh) — Black", brand: "brand_portronics", ptype: "ptype_power_bank", variant: { capacity: "10000mAh", colour: "Black" },
    specs: { capacity_mah: 10000, output_w: 22, ports: 3, has_fast_charging: true, weight_g: 232 },
    price: 1249, mrp: 2199, rating: 4.0, reviews: 5400, mps: ["fk", "az"], sellers: 2, trend: "flat", outOfStockDays: 6 },

  // Case J — ONE SELLER OUT OF STOCK, the rest trading. The out-of-stock offer
  // is the CHEAPEST on the listing, so any code path that forgets to filter on
  // availability will report an unbuyable price as the market floor.
  // NOTE: this is the one seed where the catalogue card will NOT show `price`.
  // `price` is the cheapest landed price, and here that offer is unbuyable, so
  // the card shows the cheapest IN-STOCK price (₹1,434) instead. That gap is
  // the whole point of the fixture — the invariant is about the cheapest price
  // a buyer can actually pay.
  { id: "duracell_pb_partial", name: "Duracell Ultra 10000 mAh Power Bank — Grey", brand: "brand_duracell", ptype: "ptype_power_bank", variant: { capacity: "10000mAh", colour: "Grey" },
    specs: { capacity_mah: 10000, output_w: 20, ports: 2, has_fast_charging: true, weight_g: 238 },
    price: 1399, mrp: 2499, rating: 4.1, reviews: 3900, mps: ["az", "fk"], sellers: 3, trend: "flat", cheapestOfferOutOfStockDays: 9 },

  // ============================== SMARTWATCHES =============================
  { id: "noise_colorfit", name: "Noise ColorFit Pro 5 Smartwatch — Jet Black", brand: "brand_noise", ptype: "ptype_smartwatch", variant: { colour: "Jet Black" },
    specs: { display_in: 1.85, display_type: "AMOLED", battery_days: 7, has_gps: false, has_calling: true, water_resistance: "IP68" },
    price: 1799, mrp: 5999, rating: 4.0, reviews: 42000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "fireboltt_ninja", name: "Fire-Boltt Ninja Call Pro Smartwatch — Black", brand: "brand_fireboltt", ptype: "ptype_smartwatch", variant: { colour: "Black" },
    specs: { display_in: 1.83, display_type: "LCD", battery_days: 8, has_gps: false, has_calling: true, water_resistance: "IP67" },
    price: 1499, mrp: 7999, rating: 3.9, reviews: 38000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "boat_wave", name: "boAt Wave Call 2 Smartwatch — Active Black", brand: "brand_boat", ptype: "ptype_smartwatch", variant: { colour: "Active Black" },
    specs: { display_in: 1.83, display_type: "LCD", battery_days: 7, has_gps: false, has_calling: true, water_resistance: "IP68" },
    price: 1299, mrp: 6990, rating: 3.9, reviews: 29000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "titan_smart", name: "Titan Smart 2 Smartwatch — Black", brand: "brand_titan", ptype: "ptype_smartwatch", variant: { colour: "Black" },
    specs: { display_in: 1.78, display_type: "AMOLED", battery_days: 5, has_gps: false, has_calling: true, water_resistance: "IP68" },
    price: 4995, mrp: 9995, rating: 4.2, reviews: 6700, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "galaxy_watch6", name: "Samsung Galaxy Watch6 (44mm, Bluetooth) — Graphite", brand: "brand_samsung", ptype: "ptype_smartwatch", variant: { size: "44mm", colour: "Graphite" },
    specs: { display_in: 1.5, display_type: "AMOLED", battery_days: 2, has_gps: true, has_calling: true, water_resistance: "5ATM" },
    price: 24999, mrp: 32999, rating: 4.4, reviews: 3400, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "garmin_forerunner", name: "Garmin Forerunner 165 GPS Running Smartwatch — Black", brand: "brand_garmin", ptype: "ptype_smartwatch", variant: { colour: "Black" },
    specs: { display_in: 1.3, display_type: "AMOLED", battery_days: 11, has_gps: true, has_calling: false, water_resistance: "5ATM" },
    price: 29990, mrp: 34990, rating: 4.7, reviews: 900, mps: ["az"], sellers: 1, trend: "flat" },
];
