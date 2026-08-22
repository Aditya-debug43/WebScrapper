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

import { breadthSeed } from "./catalogueSeedBreadth";
import { homeSeed } from "./catalogueSeedHome";
import { everydaySeed } from "./catalogueSeedEveryday";
import { depthSeed } from "./catalogueSeedDepth";

// The seed is authored across four files, split by department purely for
// readability. They are concatenated here and expanded by ONE generator into
// one entity graph — the split carries no structural meaning.
//
//   catalogueSeed.js (this file)  electronics, the original demo spine
//   catalogueSeedBreadth.js       fashion, beauty & personal care
//   catalogueSeedHome.js          home & kitchen, furniture, remaining electronics
//   catalogueSeedEveryday.js      grocery, baby, books, auto, health, pet, tools, toys, sports
const coreSeed = [
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

  // =========================================================================
  // COMPETITIVE DENSITY — added for the "compare against at least 5" work
  // =========================================================================
  // The constraint on competitor count was never the selection logic; it was
  // the catalogue. Measured before this block: the median product had 3
  // comparables, only 17 of 92 reached 5, and 9 of 16 product types held fewer
  // than 7 products in total — so for those types a 5th competitor could not
  // exist however the screening was tuned.
  //
  // What matters is DENSITY WITHIN A PRICE BAND, not headcount. A direct
  // competitor must sit inside 0.6×–1.7× of the target, so eight smartwatches
  // spread from ₹1,299 to ₹29,990 still leave the ₹1,299 model with almost no
  // rivals. Every product below was chosen to thicken a band that was thin,
  // with genuinely different specifications, brands and price points — never a
  // near-duplicate of something already present, which would inflate the count
  // without adding evidence.

  // ---- Smartwatches: the ₹1,300–₹2,200 budget band, and the ₹3k–₹12k gap ----
  { id: "boult_drift", name: "Boult Drift Smartwatch — Midnight Black", brand: "brand_boult", ptype: "ptype_smartwatch", variant: { colour: "Midnight Black" },
    specs: { display_in: 1.85, display_type: "LCD", battery_days: 7, has_gps: false, has_calling: true, water_resistance: "IP67" },
    price: 1399, mrp: 5999, rating: 4.0, reviews: 21000, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "noise_pulse3", name: "Noise Pulse 3 Smartwatch — Charcoal", brand: "brand_noise", ptype: "ptype_smartwatch", variant: { colour: "Charcoal" },
    specs: { display_in: 1.96, display_type: "AMOLED", battery_days: 7, has_gps: false, has_calling: true, water_resistance: "IP68" },
    price: 1599, mrp: 6499, rating: 4.1, reviews: 33000, mps: ["fk", "az"], sellers: 3, trend: "down" },
  { id: "fireboltt_phoenix", name: "Fire-Boltt Phoenix Ultra Smartwatch — Grey", brand: "brand_fireboltt", ptype: "ptype_smartwatch", variant: { colour: "Grey" },
    specs: { display_in: 1.39, display_type: "LCD", battery_days: 6, has_gps: false, has_calling: true, water_resistance: "IP67" },
    price: 1899, mrp: 8999, rating: 3.8, reviews: 26000, mps: ["fk", "mh"], sellers: 2, trend: "flat" },
  { id: "boat_lunar_call", name: "boAt Lunar Call Pro Smartwatch — Deep Blue", brand: "brand_boat", ptype: "ptype_smartwatch", variant: { colour: "Deep Blue" },
    specs: { display_in: 1.83, display_type: "AMOLED", battery_days: 5, has_gps: false, has_calling: true, water_resistance: "IP68" },
    price: 2199, mrp: 7990, rating: 4.0, reviews: 17400, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "amazfit_bip5", name: "Amazfit Bip 5 Smartwatch — Cream White", brand: "brand_amazfit", ptype: "ptype_smartwatch", variant: { colour: "Cream White" },
    specs: { display_in: 1.91, display_type: "LCD", battery_days: 10, has_gps: true, has_calling: true, water_resistance: "IP68" },
    price: 3499, mrp: 5999, rating: 4.3, reviews: 4800, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "amazfit_gts4mini", name: "Amazfit GTS 4 Mini Smartwatch — Flamingo Pink", brand: "brand_amazfit", ptype: "ptype_smartwatch", variant: { colour: "Flamingo Pink" },
    specs: { display_in: 1.65, display_type: "AMOLED", battery_days: 15, has_gps: true, has_calling: false, water_resistance: "5ATM" },
    price: 6999, mrp: 9999, rating: 4.4, reviews: 2600, mps: ["az"], sellers: 2, trend: "down" },
  { id: "noise_master", name: "Noise Master Buds Watch — Jet Black", brand: "brand_noise", ptype: "ptype_smartwatch", variant: { colour: "Jet Black" },
    specs: { display_in: 1.43, display_type: "AMOLED", battery_days: 7, has_gps: true, has_calling: true, water_resistance: "5ATM" },
    price: 11999, mrp: 17999, rating: 4.2, reviews: 1900, mps: ["fk", "az"], sellers: 2, trend: "down" },

  // ---- Earbuds: the sub-₹1,500 band, and ₹4k–₹8k ----
  { id: "boult_z40", name: "Boult Z40 Truly Wireless Earbuds — Black", brand: "brand_boult", ptype: "ptype_earbuds", variant: { colour: "Black" },
    specs: { battery_life_hours: 10, total_battery_hours: 60, has_anc: false, driver_size_mm: 10, bluetooth_version: "5.3", water_resistance: "IPX5", charging_type: "USB-C" },
    price: 799, mrp: 4999, rating: 4.1, reviews: 48000, mps: ["fk", "az"], sellers: 3, trend: "down" },
  { id: "boat_airdopes_161", name: "boAt Airdopes 161 Truly Wireless Earbuds — Cool Grey", brand: "brand_boat", ptype: "ptype_earbuds", variant: { colour: "Cool Grey" },
    specs: { battery_life_hours: 7, total_battery_hours: 40, has_anc: false, driver_size_mm: 13, bluetooth_version: "5.3", water_resistance: "IPX4", charging_type: "USB-C" },
    price: 899, mrp: 2990, rating: 4.0, reviews: 36000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "noise_buds_n1", name: "Noise Buds N1 Truly Wireless Earbuds — Jet Black", brand: "brand_noise", ptype: "ptype_earbuds", variant: { colour: "Jet Black" },
    specs: { battery_life_hours: 8, total_battery_hours: 45, has_anc: true, driver_size_mm: 10, bluetooth_version: "5.3", water_resistance: "IPX5", charging_type: "USB-C" },
    price: 1299, mrp: 3999, rating: 4.1, reviews: 24000, mps: ["fk", "az"], sellers: 2, trend: "flat" },
  { id: "boult_astra", name: "Boult Astra ANC Earbuds — Gunmetal", brand: "brand_boult", ptype: "ptype_earbuds", variant: { colour: "Gunmetal" },
    specs: { battery_life_hours: 9, total_battery_hours: 48, has_anc: true, driver_size_mm: 13, bluetooth_version: "5.4", water_resistance: "IPX5", charging_type: "USB-C" },
    price: 1899, mrp: 5999, rating: 4.2, reviews: 11500, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "oneplus_nord_buds3", name: "OnePlus Nord Buds 3 Pro — Starry Black", brand: "brand_oneplus", ptype: "ptype_earbuds", variant: { colour: "Starry Black" },
    specs: { battery_life_hours: 12, total_battery_hours: 44, has_anc: true, driver_size_mm: 12, bluetooth_version: "5.4", water_resistance: "IP55", charging_type: "USB-C" },
    price: 3299, mrp: 4499, rating: 4.3, reviews: 5600, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "realme_buds_air6", name: "realme Buds Air 6 Pro — Forest Grey", brand: "brand_realme", ptype: "ptype_earbuds", variant: { colour: "Forest Grey" },
    specs: { battery_life_hours: 11, total_battery_hours: 40, has_anc: true, driver_size_mm: 11, bluetooth_version: "5.3", water_resistance: "IPX5", charging_type: "USB-C" },
    price: 4999, mrp: 6999, rating: 4.2, reviews: 3400, mps: ["fk", "az"], sellers: 2, trend: "down" },

  // ---- Power banks: thicken the ₹1,000–₹2,500 core ----
  { id: "syska_pb_10000", name: "Syska Power Pro 100 (10000 mAh) — Black", brand: "brand_syska", ptype: "ptype_power_bank", variant: { capacity: "10000mAh", colour: "Black" },
    specs: { capacity_mah: 10000, output_w: 12, ports: 2, has_fast_charging: false, weight_g: 260 },
    price: 949, mrp: 1799, rating: 3.8, reviews: 9200, mps: ["fk", "mh"], sellers: 2, trend: "flat" },
  { id: "urban_pb_10000", name: "URBN 10000 mAh Slim Power Bank — Blue", brand: "brand_urban", ptype: "ptype_power_bank", variant: { capacity: "10000mAh", colour: "Blue" },
    specs: { capacity_mah: 10000, output_w: 22, ports: 2, has_fast_charging: true, weight_g: 228 },
    price: 1299, mrp: 2499, rating: 4.1, reviews: 15600, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "mi_pb_20000", name: "Mi Power Bank 3i (20000 mAh) — Black", brand: "brand_mi", ptype: "ptype_power_bank", variant: { capacity: "20000mAh", colour: "Black" },
    specs: { capacity_mah: 20000, output_w: 18, ports: 3, has_fast_charging: true, weight_g: 434 },
    price: 1599, mrp: 2999, rating: 4.3, reviews: 27000, mps: ["fk", "az"], sellers: 3, trend: "flat" },
  { id: "boat_pb_20000", name: "boAt Energyshroom PB400 (20000 mAh) — Navy", brand: "brand_boat", ptype: "ptype_power_bank", variant: { capacity: "20000mAh", colour: "Navy" },
    specs: { capacity_mah: 20000, output_w: 20, ports: 3, has_fast_charging: true, weight_g: 412 },
    price: 2299, mrp: 4499, rating: 4.0, reviews: 8700, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  // ---- Headphones: fill ₹1,700–₹7,000 ----
  { id: "boult_anchor", name: "Boult Anchor Over-Ear Headphones — Black", brand: "brand_boult", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 60, has_anc: false, driver_size_mm: 40, connectivity: "Bluetooth 5.3", weight_g: 210 },
    price: 1799, mrp: 4999, rating: 4.0, reviews: 13400, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "noise_three", name: "Noise Three Over-Ear Headphones — Charcoal", brand: "brand_noise", ptype: "ptype_headphones", variant: { colour: "Charcoal" },
    specs: { battery_life_hours: 70, has_anc: true, driver_size_mm: 40, connectivity: "Bluetooth 5.3", weight_g: 225 },
    price: 2999, mrp: 6999, rating: 4.1, reviews: 6900, mps: ["fk", "az"], sellers: 2, trend: "flat" },
  { id: "boat_rockerz_670", name: "boAt Rockerz 670 ANC Headphones — Black", brand: "brand_boat", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 70, has_anc: true, driver_size_mm: 40, connectivity: "Bluetooth 5.3", weight_g: 240 },
    price: 4499, mrp: 8990, rating: 4.2, reviews: 4200, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "jbl_tune770", name: "JBL Tune 770NC Wireless Headphones — Blue", brand: "brand_jbl", ptype: "ptype_headphones", variant: { colour: "Blue" },
    specs: { battery_life_hours: 70, has_anc: true, driver_size_mm: 40, connectivity: "Bluetooth 5.3", weight_g: 220 },
    price: 6999, mrp: 9999, rating: 4.4, reviews: 3100, mps: ["az", "fk"], sellers: 2, trend: "down" },

  // ---- Televisions: fill ₹12k–₹60k, which had four products across ₹48k ----
  { id: "vu_32_hd", name: "VU 32 inch HD Ready Smart LED TV", brand: "brand_vu", ptype: "ptype_television", variant: { size: "32 inch" },
    specs: { screen_size_in: 32, resolution: "HD Ready", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Android TV", hdmi_ports: 2 },
    price: 10990, mrp: 19990, rating: 4.0, reviews: 8900, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "redmi_32_hd", name: "Redmi 32 inch HD Ready Smart LED Fire TV", brand: "brand_redmi", ptype: "ptype_television", variant: { size: "32 inch" },
    specs: { screen_size_in: 32, resolution: "HD Ready", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Fire TV", hdmi_ports: 2 },
    price: 13499, mrp: 24999, rating: 4.2, reviews: 12400, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "vu_43_fhd", name: "VU 43 inch Full HD Smart LED TV", brand: "brand_vu", ptype: "ptype_television", variant: { size: "43 inch" },
    specs: { screen_size_in: 43, resolution: "Full HD", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Android TV", hdmi_ports: 3 },
    price: 21990, mrp: 34990, rating: 4.1, reviews: 5600, mps: ["fk"], sellers: 2, trend: "down" },
  { id: "redmi_43_4k", name: "Redmi 43 inch 4K Ultra HD Smart LED Fire TV", brand: "brand_redmi", ptype: "ptype_television", variant: { size: "43 inch" },
    specs: { screen_size_in: 43, resolution: "4K Ultra HD", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Fire TV", hdmi_ports: 3 },
    price: 27990, mrp: 42999, rating: 4.3, reviews: 7800, mps: ["az", "fk"], sellers: 3, trend: "down" },
  { id: "hisense_50_qled", name: "Hisense 50 inch 4K Ultra HD QLED Smart TV", brand: "brand_hisense", ptype: "ptype_television", variant: { size: "50 inch" },
    specs: { screen_size_in: 50, resolution: "4K Ultra HD", panel_type: "QLED", refresh_rate_hz: 60, smart_os: "Google TV", hdmi_ports: 3 },
    price: 42990, mrp: 64990, rating: 4.2, reviews: 2900, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "tcl_55_qled", name: "TCL 55 inch 4K QLED Google TV", brand: "brand_tcl", ptype: "ptype_television", variant: { size: "55 inch" },
    specs: { screen_size_in: 55, resolution: "4K Ultra HD", panel_type: "QLED", refresh_rate_hz: 120, smart_os: "Google TV", hdmi_ports: 4 },
    price: 54990, mrp: 89990, rating: 4.3, reviews: 2200, mps: ["fk", "az"], sellers: 2, trend: "down" },

  // ---- Gaming laptops: only 3 had a live price ----
  { id: "acer_nitro_v", name: "Acer Nitro V Gaming Laptop (Ryzen 5, 16GB, 512GB, RTX 3050)", brand: "brand_acer", ptype: "ptype_gaming_laptop", variant: { processor: "Ryzen 5", ram: "16GB", storage: "512GB" },
    specs: { ram_gb: 16, storage_gb: 512, processor: "AMD Ryzen 5 7535HS", gpu: "NVIDIA RTX 3050", refresh_rate_hz: 144, display_in: 15.6, weight_kg: 2.1 },
    price: 48990, mrp: 79999, rating: 4.1, reviews: 2400, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "hp_victus_i5", name: "HP Victus Gaming Laptop (Core i5, 16GB, 512GB, RTX 3050)", brand: "brand_hp", ptype: "ptype_gaming_laptop", variant: { processor: "Core i5", ram: "16GB", storage: "512GB" },
    specs: { ram_gb: 16, storage_gb: 512, processor: "Intel Core i5-12450H", gpu: "NVIDIA RTX 3050", refresh_rate_hz: 144, display_in: 15.6, weight_kg: 2.29 },
    price: 57990, mrp: 86999, rating: 4.2, reviews: 3100, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "asus_tuf_a15", name: "ASUS TUF Gaming A15 (Ryzen 7, 16GB, 512GB, RTX 4050)", brand: "brand_asus", ptype: "ptype_gaming_laptop", variant: { processor: "Ryzen 7", ram: "16GB", storage: "512GB" },
    specs: { ram_gb: 16, storage_gb: 512, processor: "AMD Ryzen 7 7435HS", gpu: "NVIDIA RTX 4050", refresh_rate_hz: 144, display_in: 15.6, weight_kg: 2.2 },
    price: 74990, mrp: 109990, rating: 4.3, reviews: 1800, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "lenovo_legion5", name: "Lenovo Legion 5 (Ryzen 7, 16GB, 1TB, RTX 4060)", brand: "brand_lenovo", ptype: "ptype_gaming_laptop", variant: { processor: "Ryzen 7", ram: "16GB", storage: "1TB" },
    specs: { ram_gb: 16, storage_gb: 1024, processor: "AMD Ryzen 7 7840HS", gpu: "NVIDIA RTX 4060", refresh_rate_hz: 165, display_in: 15.6, weight_kg: 2.4 },
    price: 94990, mrp: 139990, rating: 4.5, reviews: 1200, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "msi_katana_15", name: "MSI Katana 15 (Core i7, 16GB, 1TB, RTX 4060)", brand: "brand_msi", ptype: "ptype_gaming_laptop", variant: { processor: "Core i7", ram: "16GB", storage: "1TB" },
    specs: { ram_gb: 16, storage_gb: 1024, processor: "Intel Core i7-13620H", gpu: "NVIDIA RTX 4060", refresh_rate_hz: 144, display_in: 15.6, weight_kg: 2.25 },
    price: 89990, mrp: 129990, rating: 4.2, reviews: 950, mps: ["fk"], sellers: 2, trend: "down" },

  // ---- Refrigerators ----
  { id: "voltas_185l", name: "Voltas Beko 185 L Direct Cool Single Door Refrigerator", brand: "brand_voltas", ptype: "ptype_refrigerator", variant: { capacity: "185 L" },
    specs: { capacity_l: 185, door_type: "Single Door", star_rating: 3, defrost_type: "Direct Cool", has_inverter: false },
    price: 12490, mrp: 19990, rating: 4.0, reviews: 4600, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "haier_190l", name: "Haier 190 L Direct Cool Single Door Refrigerator", brand: "brand_haier", ptype: "ptype_refrigerator", variant: { capacity: "190 L" },
    specs: { capacity_l: 190, door_type: "Single Door", star_rating: 4, defrost_type: "Direct Cool", has_inverter: true },
    price: 15490, mrp: 23990, rating: 4.1, reviews: 5800, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "whirlpool_192l", name: "Whirlpool 192 L Direct Cool Single Door Refrigerator", brand: "brand_whirlpool", ptype: "ptype_refrigerator", variant: { capacity: "192 L" },
    specs: { capacity_l: 192, door_type: "Single Door", star_rating: 4, defrost_type: "Direct Cool", has_inverter: true },
    price: 17990, mrp: 26500, rating: 4.2, reviews: 7100, mps: ["fk", "az"], sellers: 3, trend: "flat" },
  { id: "haier_265l", name: "Haier 265 L Frost Free Double Door Refrigerator", brand: "brand_haier", ptype: "ptype_refrigerator", variant: { capacity: "265 L" },
    specs: { capacity_l: 265, door_type: "Double Door", star_rating: 3, defrost_type: "Frost Free", has_inverter: true },
    price: 24990, mrp: 38990, rating: 4.2, reviews: 3900, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "samsung_301l", name: "Samsung 301 L Frost Free Double Door Refrigerator", brand: "brand_samsung", ptype: "ptype_refrigerator", variant: { capacity: "301 L" },
    specs: { capacity_l: 301, door_type: "Double Door", star_rating: 3, defrost_type: "Frost Free", has_inverter: true },
    price: 32990, mrp: 47990, rating: 4.3, reviews: 2800, mps: ["fk", "az"], sellers: 2, trend: "down" },

  // ---- Washing machines ----
  { id: "voltas_65kg_top", name: "Voltas Beko 6.5 kg Fully Automatic Top Load Washing Machine", brand: "brand_voltas", ptype: "ptype_washing_machine", variant: { capacity: "6.5 kg" },
    specs: { capacity_kg: 6.5, load_type: "Top Load", is_fully_automatic: true, star_rating: 3, max_spin_rpm: 700 },
    price: 13490, mrp: 21990, rating: 3.9, reviews: 3400, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "godrej_7kg_top", name: "Godrej 7 kg Fully Automatic Top Load Washing Machine", brand: "brand_godrej", ptype: "ptype_washing_machine", variant: { capacity: "7 kg" },
    specs: { capacity_kg: 7, load_type: "Top Load", is_fully_automatic: true, star_rating: 4, max_spin_rpm: 720 },
    price: 15990, mrp: 24500, rating: 4.0, reviews: 4900, mps: ["fk", "az"], sellers: 2, trend: "flat" },
  { id: "haier_75kg_top", name: "Haier 7.5 kg Fully Automatic Top Load Washing Machine", brand: "brand_haier", ptype: "ptype_washing_machine", variant: { capacity: "7.5 kg" },
    specs: { capacity_kg: 7.5, load_type: "Top Load", is_fully_automatic: true, star_rating: 4, max_spin_rpm: 780 },
    price: 18490, mrp: 27990, rating: 4.1, reviews: 3200, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "lg_6kg_front", name: "LG 6 kg Fully Automatic Front Load Washing Machine", brand: "brand_lg", ptype: "ptype_washing_machine", variant: { capacity: "6 kg" },
    specs: { capacity_kg: 6, load_type: "Front Load", is_fully_automatic: true, star_rating: 5, max_spin_rpm: 1000 },
    price: 25990, mrp: 36990, rating: 4.4, reviews: 6100, mps: ["fk", "az"], sellers: 3, trend: "down" },
  { id: "samsung_7kg_front", name: "Samsung 7 kg Fully Automatic Front Load Washing Machine", brand: "brand_samsung", ptype: "ptype_washing_machine", variant: { capacity: "7 kg" },
    specs: { capacity_kg: 7, load_type: "Front Load", is_fully_automatic: true, star_rating: 5, max_spin_rpm: 1200 },
    price: 29990, mrp: 42990, rating: 4.3, reviews: 4400, mps: ["az", "fk"], sellers: 2, trend: "down" },

  // ---- Microwaves ----
  { id: "bajaj_17l_solo", name: "Bajaj 17 L Solo Microwave Oven — White", brand: "brand_bajaj", ptype: "ptype_microwave", variant: { capacity: "17 L" },
    specs: { capacity_l: 17, oven_type: "Solo", power_w: 700, has_auto_cook: true },
    price: 4490, mrp: 6490, rating: 4.0, reviews: 8200, mps: ["fk", "az"], sellers: 2, trend: "flat" },
  { id: "voltas_20l_solo", name: "Voltas Beko 20 L Solo Microwave Oven — Silver", brand: "brand_voltas", ptype: "ptype_microwave", variant: { capacity: "20 L" },
    specs: { capacity_l: 20, oven_type: "Solo", power_w: 800, has_auto_cook: true },
    price: 6290, mrp: 8990, rating: 4.1, reviews: 3900, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "godrej_23l_grill", name: "Godrej 23 L Grill Microwave Oven — Mirror", brand: "brand_godrej", ptype: "ptype_microwave", variant: { capacity: "23 L" },
    specs: { capacity_l: 23, oven_type: "Grill", power_w: 900, has_auto_cook: true },
    price: 9990, mrp: 14490, rating: 4.1, reviews: 2700, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "whirlpool_24l_convection", name: "Whirlpool 24 L Convection Microwave Oven — Black", brand: "brand_whirlpool", ptype: "ptype_microwave", variant: { capacity: "24 L" },
    specs: { capacity_l: 24, oven_type: "Convection", power_w: 900, has_auto_cook: true },
    price: 11990, mrp: 17990, rating: 4.2, reviews: 3300, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "samsung_28l_convection", name: "Samsung 28 L Convection Microwave Oven — Black", brand: "brand_samsung", ptype: "ptype_microwave", variant: { capacity: "28 L" },
    specs: { capacity_l: 28, oven_type: "Convection", power_w: 1000, has_auto_cook: true },
    price: 16990, mrp: 23990, rating: 4.3, reviews: 2100, mps: ["az", "fk"], sellers: 2, trend: "flat" },

  // ---- Mixer grinders ----
  { id: "pigeon_mg_550", name: "Pigeon Amaze Plus Mixer Grinder 550 W — White", brand: "brand_pigeon", ptype: "ptype_mixer_grinder", variant: { power: "550 W" },
    specs: { power_w: 550, jars: 3, speed_settings: 3, warranty_years: 2 },
    price: 1899, mrp: 3295, rating: 3.9, reviews: 21000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "butterfly_mg_750", name: "Butterfly Smart Mixer Grinder 750 W — Grey", brand: "brand_butterfly", ptype: "ptype_mixer_grinder", variant: { power: "750 W" },
    specs: { power_w: 750, jars: 4, speed_settings: 3, warranty_years: 2 },
    price: 2699, mrp: 5495, rating: 4.0, reviews: 14200, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "usha_mg_500", name: "Usha Imprint Mixer Grinder 500 W — Blue", brand: "brand_usha", ptype: "ptype_mixer_grinder", variant: { power: "500 W" },
    specs: { power_w: 500, jars: 3, speed_settings: 3, warranty_years: 2 },
    price: 2999, mrp: 4995, rating: 4.0, reviews: 6800, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "crompton_mg_750", name: "Crompton Ameo Mixer Grinder 750 W — Black", brand: "brand_crompton", ptype: "ptype_mixer_grinder", variant: { power: "750 W" },
    specs: { power_w: 750, jars: 3, speed_settings: 3, warranty_years: 5 },
    price: 3699, mrp: 6290, rating: 4.2, reviews: 9100, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "philips_mg_750_hl7756", name: "Philips HL7756 Mixer Grinder 750 W — Black", brand: "brand_philips", ptype: "ptype_mixer_grinder", variant: { power: "750 W" },
    specs: { power_w: 750, jars: 4, speed_settings: 3, warranty_years: 5 },
    price: 5299, mrp: 8495, rating: 4.3, reviews: 5400, mps: ["az", "fk"], sellers: 2, trend: "flat" },

  // ---- Office chairs ----
  { id: "cellbell_c104", name: "CellBell C104 Medium Back Office Chair — Black", brand: "brand_cellbell", ptype: "ptype_office_chair", variant: { colour: "Black" },
    specs: { back_type: "Medium Back", material: "Mesh", has_lumbar_support: false, has_adjustable_armrest: false, max_load_kg: 100, warranty_years: 1 },
    price: 3499, mrp: 7999, rating: 3.9, reviews: 12800, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "da_urban_mesh", name: "Da URBAN Ergo Mesh Office Chair — Black", brand: "brand_da_urban", ptype: "ptype_office_chair", variant: { colour: "Black" },
    specs: { back_type: "High Back", material: "Mesh", has_lumbar_support: true, has_adjustable_armrest: false, max_load_kg: 110, warranty_years: 1 },
    price: 5499, mrp: 11999, rating: 4.0, reviews: 7400, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "wakefit_ergo", name: "Wakefit Ergonomic Office Chair — Grey", brand: "brand_wakefit", ptype: "ptype_office_chair", variant: { colour: "Grey" },
    specs: { back_type: "High Back", material: "Mesh", has_lumbar_support: true, has_adjustable_armrest: true, max_load_kg: 110, warranty_years: 3 },
    price: 7499, mrp: 14999, rating: 4.2, reviews: 5900, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "green_soul_vienna", name: "Green Soul Vienna Pro Office Chair — Black", brand: "brand_green_soul", ptype: "ptype_office_chair", variant: { colour: "Black" },
    specs: { back_type: "High Back", material: "Mesh", has_lumbar_support: true, has_adjustable_armrest: true, max_load_kg: 120, warranty_years: 3 },
    price: 10990, mrp: 19999, rating: 4.3, reviews: 4100, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "nilkamal_exec", name: "Nilkamal Executive High Back Office Chair — Black", brand: "brand_nilkamal", ptype: "ptype_office_chair", variant: { colour: "Black" },
    specs: { back_type: "High Back", material: "Leatherette", has_lumbar_support: true, has_adjustable_armrest: true, max_load_kg: 120, warranty_years: 2 },
    price: 12990, mrp: 22990, rating: 4.0, reviews: 2200, mps: ["fk"], sellers: 2, trend: "flat" },

  // ---- Perfumes: the ₹700–₹3,500 gap was total ----
  { id: "engage_edp_men", name: "Engage Urge Eau de Parfum for Men (100 ml)", brand: "brand_engage", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Parfum", fragrance_family: "Woody", gender: "Men", longevity_hours: 6 },
    price: 449, mrp: 699, rating: 4.0, reviews: 31000, mps: ["fk", "mh"], sellers: 2, trend: "flat" },
  { id: "denver_hamilton", name: "Denver Hamilton Eau de Parfum (100 ml)", brand: "brand_denver", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Parfum", fragrance_family: "Aromatic", gender: "Men", longevity_hours: 7 },
    price: 599, mrp: 950, rating: 4.1, reviews: 24000, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "beardo_godfather", name: "Beardo Godfather Eau de Parfum (100 ml)", brand: "brand_beardo", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Parfum", fragrance_family: "Woody", gender: "Men", longevity_hours: 8 },
    price: 899, mrp: 1499, rating: 4.2, reviews: 12600, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "villain_bold", name: "Villain Bold Eau de Parfum (100 ml)", brand: "brand_villain", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Parfum", fragrance_family: "Oriental", gender: "Men", longevity_hours: 9 },
    price: 1299, mrp: 1999, rating: 4.1, reviews: 8300, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "park_avenue_premium", name: "Park Avenue Storm Eau de Parfum (100 ml)", brand: "brand_park_avenue", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Parfum", fragrance_family: "Aromatic", gender: "Men", longevity_hours: 8 },
    price: 1799, mrp: 2799, rating: 4.0, reviews: 5100, mps: ["fk", "az"], sellers: 2, trend: "down" },

  // ---- T-shirts ----
  { id: "hrx_round_m", name: "HRX Round Neck Cotton T-Shirt — Black (M)", brand: "brand_hrx", ptype: "ptype_tshirt", variant: { size: "M", colour: "Black" },
    specs: { size: "M", fabric: "Cotton", fit: "Regular", sleeve: "Half Sleeve", neck: "Round Neck", pattern: "Solid" },
    price: 399, mrp: 899, rating: 4.0, reviews: 28000, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "wrogn_polo_l", name: "WROGN Polo Neck Cotton T-Shirt — Navy (L)", brand: "brand_wrogn", ptype: "ptype_tshirt", variant: { size: "L", colour: "Navy" },
    specs: { size: "L", fabric: "Cotton", fit: "Slim", sleeve: "Half Sleeve", neck: "Polo Neck", pattern: "Solid" },
    price: 799, mrp: 1499, rating: 4.1, reviews: 9600, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "jockey_round_m", name: "Jockey Round Neck Cotton T-Shirt — Grey Melange (M)", brand: "brand_jockey", ptype: "ptype_tshirt", variant: { size: "M", colour: "Grey Melange" },
    specs: { size: "M", fabric: "Cotton", fit: "Regular", sleeve: "Half Sleeve", neck: "Round Neck", pattern: "Solid" },
    price: 599, mrp: 999, rating: 4.3, reviews: 15400, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "puma_polo_l", name: "Puma Polo Neck Cotton Blend T-Shirt — White (L)", brand: "brand_puma", ptype: "ptype_tshirt", variant: { size: "L", colour: "White" },
    specs: { size: "L", fabric: "Cotton Blend", fit: "Regular", sleeve: "Half Sleeve", neck: "Polo Neck", pattern: "Solid" },
    price: 999, mrp: 1799, rating: 4.2, reviews: 7200, mps: ["fk", "az"], sellers: 2, trend: "down" },

  // ---- Running shoes: fill ₹1,200–₹3,300 ----
  { id: "sparx_run_m", name: "Sparx Mesh Running Shoes — Grey (UK 8)", brand: "brand_sparx", ptype: "ptype_running_shoes", variant: { size: "UK 8", colour: "Grey" },
    specs: { size_uk: 8, gender: "Men", upper_material: "Mesh", sole_material: "EVA", use_type: "Running", weight_g: 290, has_cushioning: true },
    price: 1499, mrp: 2499, rating: 4.0, reviews: 19800, mps: ["fk", "mh"], sellers: 2, trend: "down" },
  { id: "bata_power_run", name: "Power by Bata Running Shoes — Black (UK 8)", brand: "brand_bata", ptype: "ptype_running_shoes", variant: { size: "UK 8", colour: "Black" },
    specs: { size_uk: 8, gender: "Men", upper_material: "Mesh", sole_material: "Phylon", use_type: "Running", weight_g: 275, has_cushioning: true },
    price: 1899, mrp: 3299, rating: 3.9, reviews: 11200, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "campus_max_run", name: "Campus Maxico Running Shoes — Navy (UK 8)", brand: "brand_campus", ptype: "ptype_running_shoes", variant: { size: "UK 8", colour: "Navy" },
    specs: { size_uk: 8, gender: "Men", upper_material: "Mesh", sole_material: "EVA", use_type: "Running", weight_g: 265, has_cushioning: true },
    price: 2199, mrp: 3599, rating: 4.1, reviews: 16400, mps: ["fk", "az"], sellers: 2, trend: "flat" },
  { id: "reebok_energy_run", name: "Reebok Energen Run Shoes — Black (UK 8)", brand: "brand_reebok", ptype: "ptype_running_shoes", variant: { size: "UK 8", colour: "Black" },
    specs: { size_uk: 8, gender: "Men", upper_material: "Mesh", sole_material: "EVA", use_type: "Running", weight_g: 255, has_cushioning: true },
    price: 2799, mrp: 4999, rating: 4.2, reviews: 6300, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "skechers_go_run", name: "Skechers GOrun Consistent Shoes — Charcoal (UK 8)", brand: "brand_skechers", ptype: "ptype_running_shoes", variant: { size: "UK 8", colour: "Charcoal" },
    specs: { size_uk: 8, gender: "Men", upper_material: "Mesh", sole_material: "Ultra Go", use_type: "Running", weight_g: 240, has_cushioning: true },
    price: 4499, mrp: 6999, rating: 4.4, reviews: 3800, mps: ["az", "fk"], sellers: 2, trend: "down" },

  // ---- Laptops: the ₹25k–₹45k working band ----
  { id: "hp_247_ryzen3", name: "HP 247 G9 (Ryzen 3, 8GB RAM, 512GB SSD)", brand: "brand_hp", ptype: "ptype_laptop", variant: { processor: "Ryzen 3", ram: "8GB", storage: "512GB" },
    specs: { ram_gb: 8, storage_gb: 512, storage_type: "SSD", processor: "AMD Ryzen 3 5425U", gpu: "Integrated AMD Radeon", display_in: 14, battery_hours: 8, weight_kg: 1.4 },
    price: 27990, mrp: 41999, rating: 4.0, reviews: 2900, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "lenovo_v15_i3", name: "Lenovo V15 (Core i3, 8GB RAM, 512GB SSD)", brand: "brand_lenovo", ptype: "ptype_laptop", variant: { processor: "Core i3", ram: "8GB", storage: "512GB" },
    specs: { ram_gb: 8, storage_gb: 512, storage_type: "SSD", processor: "Intel Core i3-1215U", gpu: "Integrated Intel UHD", display_in: 15.6, battery_hours: 7, weight_kg: 1.7 },
    price: 29990, mrp: 44999, rating: 3.9, reviews: 2100, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "acer_aspire_r5", name: "Acer Aspire 3 (Ryzen 5, 8GB RAM, 512GB SSD)", brand: "brand_acer", ptype: "ptype_laptop", variant: { processor: "Ryzen 5", ram: "8GB", storage: "512GB" },
    specs: { ram_gb: 8, storage_gb: 512, storage_type: "SSD", processor: "AMD Ryzen 5 7520U", gpu: "Integrated AMD Radeon", display_in: 15.6, battery_hours: 9, weight_kg: 1.78 },
    price: 34990, mrp: 49999, rating: 4.1, reviews: 3600, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "dell_vostro_i5", name: "Dell Vostro 3520 (Core i5, 8GB RAM, 512GB SSD)", brand: "brand_dell", ptype: "ptype_laptop", variant: { processor: "Core i5", ram: "8GB", storage: "512GB" },
    specs: { ram_gb: 8, storage_gb: 512, storage_type: "SSD", processor: "Intel Core i5-1235U", gpu: "Integrated Intel Iris Xe", display_in: 15.6, battery_hours: 8, weight_kg: 1.69 },
    price: 39990, mrp: 58999, rating: 4.1, reviews: 2400, mps: ["az", "fk"], sellers: 2, trend: "flat" },

  // ---- Smartphones: the ₹7k–₹20k mass band ----
  { id: "infinix_smart8", name: "Infinix Smart 8 (4GB RAM, 64GB) — Timber Black", brand: "brand_infinix", ptype: "ptype_smartphone", variant: { ram: "4GB", storage: "64GB", colour: "Timber Black" },
    specs: { ram_gb: 4, storage_gb: 64, battery_mah: 5000, display_in: 6.6, rear_camera_mp: 50, processor: "Unisoc T606", has_5g: false, refresh_rate_hz: 90, charging_w: 10 },
    price: 6999, mrp: 9999, rating: 4.0, reviews: 22000, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "poco_m6_5g", name: "POCO M6 5G (6GB RAM, 128GB) — Orion Blue", brand: "brand_poco", ptype: "ptype_smartphone", variant: { ram: "6GB", storage: "128GB", colour: "Orion Blue" },
    specs: { ram_gb: 6, storage_gb: 128, battery_mah: 5000, display_in: 6.74, rear_camera_mp: 50, processor: "Dimensity 6100+", has_5g: true, refresh_rate_hz: 90, charging_w: 18 },
    price: 9499, mrp: 14999, rating: 4.1, reviews: 34000, mps: ["fk", "az"], sellers: 3, trend: "down" },
  { id: "redmi_13c_5g", name: "Redmi 13C 5G (4GB RAM, 128GB) — Startrail Green", brand: "brand_redmi", ptype: "ptype_smartphone", variant: { ram: "4GB", storage: "128GB", colour: "Startrail Green" },
    specs: { ram_gb: 4, storage_gb: 128, battery_mah: 5000, display_in: 6.74, rear_camera_mp: 50, processor: "Dimensity 6100+", has_5g: true, refresh_rate_hz: 90, charging_w: 18 },
    price: 10499, mrp: 15999, rating: 4.0, reviews: 41000, mps: ["az", "fk"], sellers: 3, trend: "down" },
  { id: "infinix_note40", name: "Infinix Note 40 5G (8GB RAM, 256GB) — Titan Gold", brand: "brand_infinix", ptype: "ptype_smartphone", variant: { ram: "8GB", storage: "256GB", colour: "Titan Gold" },
    specs: { ram_gb: 8, storage_gb: 256, battery_mah: 5000, display_in: 6.78, rear_camera_mp: 108, processor: "Dimensity 7020", has_5g: true, refresh_rate_hz: 120, charging_w: 45 },
    price: 16999, mrp: 24999, rating: 4.1, reviews: 8900, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "iqoo_z9_5g", name: "iQOO Z9 5G (8GB RAM, 128GB) — Graphene Blue", brand: "brand_iqoo", ptype: "ptype_smartphone", variant: { ram: "8GB", storage: "128GB", colour: "Graphene Blue" },
    specs: { ram_gb: 8, storage_gb: 128, battery_mah: 5000, display_in: 6.67, rear_camera_mp: 50, processor: "Dimensity 7200", has_5g: true, refresh_rate_hz: 120, charging_w: 44 },
    price: 19999, mrp: 24999, rating: 4.3, reviews: 12700, mps: ["az", "fk"], sellers: 2, trend: "flat" },

  // ---- Second pass: bands still short of 5 after the first expansion -------
  // Measured, not guessed. Premium outliers (a ₹1.3L OLED, an ₹74k iPhone) are
  // deliberately left thin: a flagship genuinely has few peers in its band, and
  // the system reporting "2 direct competitors, coverage thin" there is the
  // correct answer rather than a gap to be papered over.

  { id: "ifb_65kg_top", name: "IFB 6.5 kg Fully Automatic Top Load Washing Machine", brand: "brand_ifb", ptype: "ptype_washing_machine", variant: { capacity: "6.5 kg" },
    specs: { capacity_kg: 6.5, load_type: "Top Load", is_fully_automatic: true, star_rating: 4, max_spin_rpm: 720 },
    price: 17490, mrp: 26990, rating: 4.1, reviews: 2600, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "whirlpool_65kg_top", name: "Whirlpool 6.5 kg Fully Automatic Top Load Washing Machine", brand: "brand_whirlpool", ptype: "ptype_washing_machine", variant: { capacity: "6.5 kg" },
    specs: { capacity_kg: 6.5, load_type: "Top Load", is_fully_automatic: true, star_rating: 3, max_spin_rpm: 740 },
    price: 14990, mrp: 23490, rating: 4.0, reviews: 5300, mps: ["fk", "az"], sellers: 2, trend: "flat" },

  { id: "lg_190l_single", name: "LG 190 L Direct Cool Single Door Refrigerator", brand: "brand_lg", ptype: "ptype_refrigerator", variant: { capacity: "190 L" },
    specs: { capacity_l: 190, door_type: "Single Door", star_rating: 5, defrost_type: "Direct Cool", has_inverter: true },
    price: 18990, mrp: 27490, rating: 4.3, reviews: 6700, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "godrej_192l_single", name: "Godrej 192 L Direct Cool Single Door Refrigerator", brand: "brand_godrej", ptype: "ptype_refrigerator", variant: { capacity: "192 L" },
    specs: { capacity_l: 192, door_type: "Single Door", star_rating: 3, defrost_type: "Direct Cool", has_inverter: false },
    price: 11490, mrp: 18990, rating: 3.9, reviews: 4100, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  { id: "wild_stone_edt", name: "Wild Stone Ultra Sensual Eau de Parfum (100 ml)", brand: "brand_wild_stone", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Parfum", fragrance_family: "Oriental", gender: "Men", longevity_hours: 7 },
    price: 699, mrp: 1099, rating: 4.0, reviews: 18700, mps: ["fk", "az"], sellers: 2, trend: "flat" },
  { id: "fogg_impressio", name: "Fogg Impressio Eau de Parfum (100 ml)", brand: "brand_fogg", ptype: "ptype_perfume", variant: { volume: "100 ml" },
    specs: { volume_ml: 100, concentration: "Eau de Parfum", fragrance_family: "Woody", gender: "Men", longevity_hours: 6 },
    price: 529, mrp: 799, rating: 4.0, reviews: 26400, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  { id: "lg_20l_solo", name: "LG 20 L Solo Microwave Oven — Black", brand: "brand_lg", ptype: "ptype_microwave", variant: { capacity: "20 L" },
    specs: { capacity_l: 20, oven_type: "Solo", power_w: 800, has_auto_cook: true },
    price: 5990, mrp: 8490, rating: 4.2, reviews: 5900, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "ifb_20l_solo", name: "IFB 20 L Solo Microwave Oven — White", brand: "brand_ifb", ptype: "ptype_microwave", variant: { capacity: "20 L" },
    specs: { capacity_l: 20, oven_type: "Solo", power_w: 800, has_auto_cook: false },
    price: 4990, mrp: 7290, rating: 4.0, reviews: 3100, mps: ["fk", "az"], sellers: 2, trend: "flat" },

  { id: "wakefit_mesh_mid", name: "Wakefit Mesh Mid Back Office Chair — Black", brand: "brand_wakefit", ptype: "ptype_office_chair", variant: { colour: "Black" },
    specs: { back_type: "Medium Back", material: "Mesh", has_lumbar_support: true, has_adjustable_armrest: false, max_load_kg: 100, warranty_years: 1 },
    price: 4499, mrp: 9999, rating: 4.0, reviews: 8600, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "green_soul_beast", name: "Green Soul Beast Gaming Chair — Black Red", brand: "brand_green_soul", ptype: "ptype_office_chair", variant: { colour: "Black Red" },
    specs: { back_type: "High Back", material: "Leatherette", has_lumbar_support: true, has_adjustable_armrest: true, max_load_kg: 120, warranty_years: 3 },
    price: 13490, mrp: 24999, rating: 4.2, reviews: 3600, mps: ["az", "fk"], sellers: 2, trend: "down" },

  { id: "hisense_32_hd", name: "Hisense 32 inch HD Ready Smart LED TV", brand: "brand_hisense", ptype: "ptype_television", variant: { size: "32 inch" },
    specs: { screen_size_in: 32, resolution: "HD Ready", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Google TV", hdmi_ports: 2 },
    price: 12490, mrp: 22990, rating: 4.1, reviews: 6400, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "samsung_55_crystal", name: "Samsung 55 inch Crystal 4K Smart LED TV", brand: "brand_samsung", ptype: "ptype_television", variant: { size: "55 inch" },
    specs: { screen_size_in: 55, resolution: "4K Ultra HD", panel_type: "LED", refresh_rate_hz: 60, smart_os: "Tizen", hdmi_ports: 3 },
    price: 47990, mrp: 74900, rating: 4.2, reviews: 4800, mps: ["fk", "az"], sellers: 3, trend: "down" },
  { id: "lg_55_4k", name: "LG 55 inch 4K Ultra HD Smart LED TV", brand: "brand_lg", ptype: "ptype_television", variant: { size: "55 inch" },
    specs: { screen_size_in: 55, resolution: "4K Ultra HD", panel_type: "LED", refresh_rate_hz: 60, smart_os: "webOS", hdmi_ports: 3 },
    price: 66990, mrp: 99990, rating: 4.3, reviews: 3200, mps: ["az", "fk"], sellers: 2, trend: "down" },

  { id: "jbl_tune520", name: "JBL Tune 520BT Wireless Headphones — Black", brand: "brand_jbl", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 57, has_anc: false, driver_size_mm: 33, connectivity: "Bluetooth 5.3", weight_g: 160 },
    price: 3299, mrp: 5999, rating: 4.2, reviews: 7800, mps: ["az", "fk"], sellers: 2, trend: "down" },
  { id: "sony_whch520", name: "Sony WH-CH520 Wireless Headphones — Blue", brand: "brand_sony", ptype: "ptype_headphones", variant: { colour: "Blue" },
    specs: { battery_life_hours: 50, has_anc: false, driver_size_mm: 30, connectivity: "Bluetooth 5.2", weight_g: 147 },
    price: 3990, mrp: 5990, rating: 4.3, reviews: 6200, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "jbl_live670", name: "JBL Live 670NC Wireless Headphones — Black", brand: "brand_jbl", ptype: "ptype_headphones", variant: { colour: "Black" },
    specs: { battery_life_hours: 65, has_anc: true, driver_size_mm: 40, connectivity: "Bluetooth 5.3", weight_g: 208 },
    price: 8990, mrp: 14999, rating: 4.3, reviews: 2400, mps: ["az", "fk"], sellers: 2, trend: "down" },

  { id: "boat_airdopes_131", name: "boAt Airdopes 131 Truly Wireless Earbuds — Active Black", brand: "brand_boat", ptype: "ptype_earbuds", variant: { colour: "Active Black" },
    specs: { battery_life_hours: 6, total_battery_hours: 30, has_anc: false, driver_size_mm: 13, bluetooth_version: "5.1", water_resistance: "IPX4", charging_type: "Micro USB" },
    price: 699, mrp: 2490, rating: 3.9, reviews: 52000, mps: ["fk", "mh"], sellers: 2, trend: "flat" },
  { id: "boult_k40", name: "Boult K40 Truly Wireless Earbuds — Black", brand: "brand_boult", ptype: "ptype_earbuds", variant: { colour: "Black" },
    specs: { battery_life_hours: 8, total_battery_hours: 48, has_anc: false, driver_size_mm: 13, bluetooth_version: "5.3", water_resistance: "IPX5", charging_type: "USB-C" },
    price: 649, mrp: 3999, rating: 4.0, reviews: 33000, mps: ["fk", "az"], sellers: 2, trend: "down" },

  { id: "fireboltt_dream", name: "Fire-Boltt Dream AMOLED Smartwatch — Rose Gold", brand: "brand_fireboltt", ptype: "ptype_smartwatch", variant: { colour: "Rose Gold" },
    specs: { display_in: 1.43, display_type: "AMOLED", battery_days: 7, has_gps: false, has_calling: true, water_resistance: "IP67" },
    price: 3299, mrp: 12999, rating: 3.9, reviews: 9800, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "noise_diva2", name: "Noise Diva 2 Smartwatch — Rose Pink", brand: "brand_noise", ptype: "ptype_smartwatch", variant: { colour: "Rose Pink" },
    specs: { display_in: 1.52, display_type: "AMOLED", battery_days: 7, has_gps: false, has_calling: true, water_resistance: "IP68" },
    price: 2799, mrp: 7999, rating: 4.0, reviews: 7200, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "amazfit_gtr_mini", name: "Amazfit GTR Mini Smartwatch — Midnight Black", brand: "brand_amazfit", ptype: "ptype_smartwatch", variant: { colour: "Midnight Black" },
    specs: { display_in: 1.28, display_type: "AMOLED", battery_days: 14, has_gps: true, has_calling: false, water_resistance: "5ATM" },
    price: 9499, mrp: 14999, rating: 4.4, reviews: 1700, mps: ["az", "fk"], sellers: 2, trend: "flat" },
  { id: "titan_crest", name: "Titan Crest AMOLED Smartwatch — Silver", brand: "brand_titan", ptype: "ptype_smartwatch", variant: { colour: "Silver" },
    specs: { display_in: 1.43, display_type: "AMOLED", battery_days: 7, has_gps: false, has_calling: true, water_resistance: "IP68" },
    price: 6495, mrp: 11995, rating: 4.1, reviews: 2900, mps: ["fk", "az"], sellers: 2, trend: "down" },

  { id: "hrx_run_m", name: "HRX Cushioned Running Shoes — Black (UK 8)", brand: "brand_hrx", ptype: "ptype_running_shoes", variant: { size: "UK 8", colour: "Black" },
    specs: { size_uk: 8, gender: "Men", upper_material: "Mesh", sole_material: "EVA", use_type: "Running", weight_g: 285, has_cushioning: true },
    price: 1299, mrp: 2799, rating: 3.9, reviews: 14700, mps: ["fk", "mh"], sellers: 2, trend: "down" },

  { id: "ambrane_pb_10000_pd", name: "Ambrane PowerLit 10000 PD (10000 mAh) — Black", brand: "brand_ambrane", ptype: "ptype_power_bank", variant: { capacity: "10000mAh", colour: "Black" },
    specs: { capacity_mah: 10000, output_w: 20, ports: 2, has_fast_charging: true, weight_g: 235 },
    price: 1399, mrp: 2499, rating: 4.0, reviews: 11800, mps: ["fk", "az"], sellers: 2, trend: "down" },
  { id: "syska_pb_20000", name: "Syska Power Pro 200 (20000 mAh) — Black", brand: "brand_syska", ptype: "ptype_power_bank", variant: { capacity: "20000mAh", colour: "Black" },
    specs: { capacity_mah: 20000, output_w: 22, ports: 3, has_fast_charging: true, weight_g: 425 },
    price: 1999, mrp: 3999, rating: 3.9, reviews: 6400, mps: ["fk", "mh"], sellers: 2, trend: "flat" },
];

// One array, four source files.
export const catalogueSeed = [...coreSeed, ...breadthSeed, ...homeSeed, ...everydaySeed, ...depthSeed];
