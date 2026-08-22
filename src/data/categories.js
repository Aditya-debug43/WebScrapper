import { marketplaces as marketplaceRows } from "./marketplaces";

// Canonical internal category tree — our own taxonomy, independent of any
// marketplace's. Four browsable levels:
//
//   L1 Department  →  L2 Category  →  L3 Subcategory  →  Product Type
//
// Product types hang off L3 subcategories and are what the attribute-definition
// registry keys on — so a Refrigerator, a Saree and a bag of Dog Food can carry
// completely different specs without any schema change.
//
// SCALE AND WHY IT MATTERS
// ------------------------
// This tree spans 14 departments and 125 product types, reaching well past
// electronics into grocery, pet supplies, automotive, stationery and toys. That
// breadth is the point of the exercise: it is easy to build a catalogue model
// that works for smartphones, and the interesting question is whether the SAME
// model, with no code change, represents a ₹45 pen and a ₹1.4L refrigerator.
// Every product type below reaches the catalogue through data inserts only —
// there is no per-category code anywhere in the app.
//
// Rows are assembled by small builders rather than written out longhand. The
// ids stay explicit (everything else joins on them), but `path` and `level` are
// derived from the parent, which removes the single most common authoring bug
// in a tree this size: a path that silently disagrees with its parentId.

const rows = [];
const bySlug = new Map();

function dept(id, name, slug) {
  const row = { id, parentId: null, level: 1, name, path: slug };
  rows.push(row);
  bySlug.set(id, row);
  return id;
}

function child(parentId, id, name, slug) {
  const parent = bySlug.get(parentId);
  if (!parent) throw new Error(`categories: unknown parent ${parentId} for ${id}`);
  const row = { id, parentId, level: parent.level + 1, name, path: `${parent.path}/${slug}` };
  rows.push(row);
  bySlug.set(id, row);
  return id;
}

// ============================== ELECTRONICS ==============================
const ELECTRONICS = dept("cat_electronics", "Electronics", "electronics");

const MOBILES = child(ELECTRONICS, "cat_mobiles_accessories", "Mobiles & Accessories", "mobiles-accessories");
child(MOBILES, "cat_smartphones", "Smartphones", "smartphones");
child(MOBILES, "cat_tablets", "Tablets", "tablets");
child(MOBILES, "cat_power_banks", "Power Banks", "power-banks");
child(MOBILES, "cat_phone_cases", "Phone Cases & Covers", "phone-cases");
child(MOBILES, "cat_charging_cables", "Charging Cables & Adapters", "charging-cables");

const COMPUTERS = child(ELECTRONICS, "cat_computers", "Computers", "computers");
child(COMPUTERS, "cat_laptops", "Laptops", "laptops");
child(COMPUTERS, "cat_monitors", "Monitors", "monitors");
child(COMPUTERS, "cat_input_devices", "Keyboards & Mice", "keyboards-mice");
child(COMPUTERS, "cat_printers", "Printers", "printers");
child(COMPUTERS, "cat_storage", "Storage Devices", "storage-devices");

const AUDIO = child(ELECTRONICS, "cat_audio", "Audio", "audio");
child(AUDIO, "cat_earbuds", "Wireless Earbuds", "wireless-earbuds");
child(AUDIO, "cat_headphones", "Over-Ear Headphones", "over-ear-headphones");
child(AUDIO, "cat_neckbands", "Neckband Earphones", "neckband-earphones");
child(AUDIO, "cat_speakers", "Bluetooth Speakers", "bluetooth-speakers");
child(AUDIO, "cat_soundbars", "Soundbars", "soundbars");

const TV_ENT = child(ELECTRONICS, "cat_tv_entertainment", "TVs & Home Entertainment", "tv-home-entertainment");
child(TV_ENT, "cat_televisions", "Televisions", "televisions");
child(TV_ENT, "cat_streaming_devices", "Streaming Devices", "streaming-devices");

const CAMERAS = child(ELECTRONICS, "cat_cameras", "Cameras", "cameras");
child(CAMERAS, "cat_action_cameras", "Action Cameras", "action-cameras");

// ============================ HOME & KITCHEN =============================
const HOME_KITCHEN = dept("cat_home_kitchen", "Home & Kitchen", "home-kitchen");

const LARGE_APP = child(HOME_KITCHEN, "cat_large_appliances", "Large Appliances", "large-appliances");
child(LARGE_APP, "cat_refrigerators", "Refrigerators", "refrigerators");
child(LARGE_APP, "cat_washing_machines", "Washing Machines", "washing-machines");
child(LARGE_APP, "cat_air_conditioners", "Air Conditioners", "air-conditioners");

const KITCHEN_APP = child(HOME_KITCHEN, "cat_kitchen_appliances", "Kitchen Appliances", "kitchen-appliances");
child(KITCHEN_APP, "cat_microwaves", "Microwave Ovens", "microwave-ovens");
child(KITCHEN_APP, "cat_mixer_grinders", "Mixer Grinders", "mixer-grinders");
child(KITCHEN_APP, "cat_kettles", "Electric Kettles", "electric-kettles");
child(KITCHEN_APP, "cat_induction_cooktops", "Induction Cooktops", "induction-cooktops");
child(KITCHEN_APP, "cat_air_fryers", "Air Fryers", "air-fryers");
child(KITCHEN_APP, "cat_water_purifiers", "Water Purifiers", "water-purifiers");
child(KITCHEN_APP, "cat_gas_stoves", "Gas Stoves", "gas-stoves");

const COOKWARE = child(HOME_KITCHEN, "cat_cookware_dining", "Cookware & Dining", "cookware-dining");
child(COOKWARE, "cat_pressure_cookers", "Pressure Cookers", "pressure-cookers");
child(COOKWARE, "cat_cookware_sets", "Cookware Sets", "cookware-sets");
child(COOKWARE, "cat_dinner_sets", "Dinner Sets", "dinner-sets");

const HOME_COMFORT = child(HOME_KITCHEN, "cat_home_comfort", "Home Comfort", "home-comfort");
child(HOME_COMFORT, "cat_ceiling_fans", "Ceiling Fans", "ceiling-fans");
child(HOME_COMFORT, "cat_air_coolers", "Air Coolers", "air-coolers");
child(HOME_COMFORT, "cat_vacuum_cleaners", "Vacuum Cleaners", "vacuum-cleaners");

// =========================== HOME & FURNITURE ============================
const FURNITURE = dept("cat_home_furniture", "Home & Furniture", "home-furniture");

const SEATING = child(FURNITURE, "cat_seating", "Seating", "seating");
child(SEATING, "cat_office_chairs", "Office Chairs", "office-chairs");
child(SEATING, "cat_sofas", "Sofas", "sofas");

const BEDROOM = child(FURNITURE, "cat_bedroom", "Bedroom Furniture", "bedroom-furniture");
child(BEDROOM, "cat_mattresses", "Mattresses", "mattresses");
child(BEDROOM, "cat_beds", "Beds", "beds");
child(BEDROOM, "cat_wardrobes", "Wardrobes", "wardrobes");

const STORAGE_FURN = child(FURNITURE, "cat_tables_storage", "Tables & Storage", "tables-storage");
child(STORAGE_FURN, "cat_study_tables", "Study Tables", "study-tables");
child(STORAGE_FURN, "cat_bookshelves", "Bookshelves", "bookshelves");

const FURNISHING = child(FURNITURE, "cat_home_furnishing", "Home Furnishing", "home-furnishing");
child(FURNISHING, "cat_bedsheets", "Bedsheets", "bedsheets");
child(FURNISHING, "cat_curtains", "Curtains", "curtains");

// ================================ FASHION ================================
const FASHION = dept("cat_fashion", "Fashion", "fashion");

const MENS = child(FASHION, "cat_mens_clothing", "Men's Clothing", "mens-clothing");
child(MENS, "cat_tshirts", "T-Shirts", "t-shirts");
child(MENS, "cat_casual_shirts", "Casual Shirts", "casual-shirts");
child(MENS, "cat_formal_shirts", "Formal Shirts", "formal-shirts");
child(MENS, "cat_jeans", "Jeans", "jeans");
child(MENS, "cat_trousers", "Trousers", "trousers");
child(MENS, "cat_kurtas", "Kurtas", "kurtas");

const WOMENS = child(FASHION, "cat_womens_clothing", "Women's Clothing", "womens-clothing");
child(WOMENS, "cat_kurtis", "Kurtis", "kurtis");
child(WOMENS, "cat_sarees", "Sarees", "sarees");
child(WOMENS, "cat_dresses", "Dresses", "dresses");
child(WOMENS, "cat_leggings", "Leggings", "leggings");

const FOOTWEAR = child(FASHION, "cat_footwear", "Footwear", "footwear");
child(FOOTWEAR, "cat_running_shoes", "Running Shoes", "running-shoes");
child(FOOTWEAR, "cat_sneakers", "Casual Sneakers", "casual-sneakers");
child(FOOTWEAR, "cat_formal_shoes", "Formal Shoes", "formal-shoes");
child(FOOTWEAR, "cat_sandals", "Sandals & Floaters", "sandals-floaters");

const BAGS_ACC = child(FASHION, "cat_bags_accessories", "Bags & Accessories", "bags-accessories");
child(BAGS_ACC, "cat_backpacks", "Backpacks", "backpacks");
child(BAGS_ACC, "cat_handbags", "Handbags", "handbags");
child(BAGS_ACC, "cat_wallets", "Wallets", "wallets");
child(BAGS_ACC, "cat_sunglasses", "Sunglasses", "sunglasses");

// ====================== BEAUTY & PERSONAL CARE ===========================
const BEAUTY = dept("cat_beauty", "Beauty & Personal Care", "beauty-personal-care");

const FRAGRANCES = child(BEAUTY, "cat_fragrances", "Fragrances", "fragrances");
child(FRAGRANCES, "cat_perfumes", "Perfumes", "perfumes");
child(FRAGRANCES, "cat_deodorants", "Deodorants", "deodorants");

const SKINCARE = child(BEAUTY, "cat_skincare", "Skincare", "skincare");
child(SKINCARE, "cat_face_wash", "Face Wash", "face-wash");
child(SKINCARE, "cat_moisturisers", "Moisturisers", "moisturisers");
child(SKINCARE, "cat_sunscreen", "Sunscreen", "sunscreen");
child(SKINCARE, "cat_face_serums", "Face Serums", "face-serums");

const MAKEUP = child(BEAUTY, "cat_makeup", "Makeup", "makeup");
child(MAKEUP, "cat_lipsticks", "Lipsticks", "lipsticks");
child(MAKEUP, "cat_foundation", "Foundation", "foundation");

const HAIRCARE = child(BEAUTY, "cat_haircare", "Hair Care", "hair-care");
child(HAIRCARE, "cat_shampoo", "Shampoo", "shampoo");
child(HAIRCARE, "cat_hair_oil", "Hair Oil", "hair-oil");

const GROOMING = child(BEAUTY, "cat_grooming_appliances", "Grooming Appliances", "grooming-appliances");
child(GROOMING, "cat_hair_dryers", "Hair Dryers", "hair-dryers");
child(GROOMING, "cat_trimmers", "Beard Trimmers", "beard-trimmers");

// ========================== SPORTS & FITNESS =============================
const SPORTS = dept("cat_sports_fitness", "Sports & Fitness", "sports-fitness");

const WEARABLES = child(SPORTS, "cat_wearables", "Wearable Tech", "wearable-tech");
child(WEARABLES, "cat_smartwatches", "Smartwatches", "smartwatches");
child(WEARABLES, "cat_fitness_bands", "Fitness Bands", "fitness-bands");

const FITNESS_EQ = child(SPORTS, "cat_fitness_equipment", "Fitness Equipment", "fitness-equipment");
child(FITNESS_EQ, "cat_yoga_mats", "Yoga Mats", "yoga-mats");
child(FITNESS_EQ, "cat_dumbbells", "Dumbbells", "dumbbells");
child(FITNESS_EQ, "cat_treadmills", "Treadmills", "treadmills");
child(FITNESS_EQ, "cat_resistance_bands", "Resistance Bands", "resistance-bands");

const SPORTS_GEAR = child(SPORTS, "cat_sports_gear", "Sports Gear", "sports-gear");
child(SPORTS_GEAR, "cat_cricket_bats", "Cricket Bats", "cricket-bats");
child(SPORTS_GEAR, "cat_badminton_rackets", "Badminton Rackets", "badminton-rackets");

// ========================== GROCERY & GOURMET ============================
const GROCERY = dept("cat_grocery", "Grocery & Gourmet", "grocery-gourmet");

const BEVERAGES = child(GROCERY, "cat_beverages", "Beverages", "beverages");
child(BEVERAGES, "cat_tea", "Tea", "tea");
child(BEVERAGES, "cat_coffee", "Coffee", "coffee");
child(BEVERAGES, "cat_health_drinks", "Health Drinks", "health-drinks");

const STAPLES = child(GROCERY, "cat_staples", "Staples", "staples");
child(STAPLES, "cat_rice", "Rice", "rice");
child(STAPLES, "cat_cooking_oil", "Cooking Oil", "cooking-oil");
child(STAPLES, "cat_spices", "Spices & Masala", "spices-masala");

const PACKAGED = child(GROCERY, "cat_packaged_foods", "Packaged Foods", "packaged-foods");
child(PACKAGED, "cat_biscuits", "Biscuits & Cookies", "biscuits-cookies");
child(PACKAGED, "cat_chocolates", "Chocolates", "chocolates");
child(PACKAGED, "cat_dry_fruits", "Dry Fruits & Nuts", "dry-fruits-nuts");

// ============================= BABY & KIDS ===============================
const BABY = dept("cat_baby_kids", "Baby & Kids", "baby-kids");

const BABY_CARE = child(BABY, "cat_baby_care", "Baby Care", "baby-care");
child(BABY_CARE, "cat_diapers", "Diapers", "diapers");
child(BABY_CARE, "cat_baby_wipes", "Baby Wipes", "baby-wipes");
child(BABY_CARE, "cat_baby_food", "Baby Food", "baby-food");
child(BABY_CARE, "cat_feeding_bottles", "Feeding Bottles", "feeding-bottles");

const BABY_GEAR = child(BABY, "cat_baby_gear", "Baby Gear", "baby-gear");
child(BABY_GEAR, "cat_strollers", "Strollers & Prams", "strollers-prams");

// ======================== BOOKS & STATIONERY =============================
const BOOKS_DEPT = dept("cat_stationery_books", "Books & Stationery", "books-stationery");

const BOOKS = child(BOOKS_DEPT, "cat_books", "Books", "books");
child(BOOKS, "cat_fiction_books", "Fiction", "fiction");
child(BOOKS, "cat_nonfiction_books", "Non-Fiction", "non-fiction");
child(BOOKS, "cat_exam_books", "Exam Preparation", "exam-preparation");
child(BOOKS, "cat_childrens_books", "Children's Books", "childrens-books");

const STATIONERY = child(BOOKS_DEPT, "cat_stationery", "Stationery", "stationery");
child(STATIONERY, "cat_notebooks", "Notebooks", "notebooks");
child(STATIONERY, "cat_pens", "Pens", "pens");

// ============================== AUTOMOTIVE ===============================
const AUTO = dept("cat_automotive", "Automotive", "automotive");

const CAR_ACC = child(AUTO, "cat_car_accessories", "Car Accessories", "car-accessories");
child(CAR_ACC, "cat_car_care", "Car Care", "car-care");
child(CAR_ACC, "cat_engine_oil", "Engine Oil", "engine-oil");
child(CAR_ACC, "cat_car_phone_holders", "Car Phone Holders", "car-phone-holders");

const BIKE_ACC = child(AUTO, "cat_bike_accessories", "Bike Accessories", "bike-accessories");
child(BIKE_ACC, "cat_helmets", "Helmets", "helmets");

// ========================== HEALTH & WELLNESS ============================
const HEALTH = dept("cat_health_wellness", "Health & Wellness", "health-wellness");

const SUPPLEMENTS = child(HEALTH, "cat_supplements", "Supplements", "supplements");
child(SUPPLEMENTS, "cat_protein_powder", "Protein Powder", "protein-powder");
child(SUPPLEMENTS, "cat_multivitamins", "Multivitamins", "multivitamins");

const MED_DEVICES = child(HEALTH, "cat_medical_devices", "Medical Devices", "medical-devices");
child(MED_DEVICES, "cat_bp_monitors", "BP Monitors", "bp-monitors");
child(MED_DEVICES, "cat_glucometers", "Glucometers", "glucometers");
child(MED_DEVICES, "cat_thermometers", "Thermometers", "thermometers");

// ============================= PET SUPPLIES ==============================
const PETS = dept("cat_pet_supplies", "Pet Supplies", "pet-supplies");

const PET_FOOD = child(PETS, "cat_pet_food", "Pet Food", "pet-food");
child(PET_FOOD, "cat_dog_food", "Dog Food", "dog-food");
child(PET_FOOD, "cat_cat_food", "Cat Food", "cat-food");

const PET_ACC = child(PETS, "cat_pet_accessories", "Pet Accessories", "pet-accessories");
child(PET_ACC, "cat_pet_grooming", "Pet Grooming", "pet-grooming");
child(PET_ACC, "cat_pet_toys", "Pet Toys", "pet-toys");

// ====================== TOOLS & HOME IMPROVEMENT =========================
const TOOLS = dept("cat_tools_improvement", "Tools & Home Improvement", "tools-home-improvement");

const POWER_TOOLS = child(TOOLS, "cat_power_tools", "Power Tools", "power-tools");
child(POWER_TOOLS, "cat_drills", "Drills", "drills");
child(POWER_TOOLS, "cat_screwdriver_sets", "Screwdriver Sets", "screwdriver-sets");

const ELECTRICALS = child(TOOLS, "cat_electricals", "Electricals", "electricals");
child(ELECTRICALS, "cat_led_bulbs", "LED Bulbs", "led-bulbs");
child(ELECTRICALS, "cat_extension_boards", "Extension Boards", "extension-boards");
child(ELECTRICALS, "cat_torches", "Torches", "torches");

// ============================= TOYS & GAMES ==============================
const TOYS = dept("cat_toys_games", "Toys & Games", "toys-games");

const TOYS_SUB = child(TOYS, "cat_toys", "Toys", "toys");
child(TOYS_SUB, "cat_soft_toys", "Soft Toys", "soft-toys");
child(TOYS_SUB, "cat_building_blocks", "Building Blocks", "building-blocks");
child(TOYS_SUB, "cat_rc_toys", "Remote Control Toys", "remote-control-toys");

const GAMES = child(TOYS, "cat_games", "Games", "games");
child(GAMES, "cat_board_games", "Board Games", "board-games");

export const categories = rows;

// ---------------------------------------------------------------------------
// Product types — the 4th browsable level, and the key the specification
// registry is scoped to. A subcategory can host more than one product type
// (Laptops → Everyday / Gaming), which is what makes the fourth level
// meaningful rather than decorative.
// ---------------------------------------------------------------------------
const ptypeRows = [];
function ptype(id, categoryId, name, schemaVersion) {
  if (!bySlug.has(categoryId)) throw new Error(`productTypes: unknown category ${categoryId} for ${id}`);
  ptypeRows.push({ id, categoryId, name, schemaVersion });
}

// -- Electronics
ptype("ptype_smartphone", "cat_smartphones", "Smartphones", "smartphone_v3");
ptype("ptype_tablet", "cat_tablets", "Tablets", "tablet_v1");
ptype("ptype_power_bank", "cat_power_banks", "Power Banks", "power_bank_v1");
ptype("ptype_phone_case", "cat_phone_cases", "Phone Cases", "phone_case_v1");
ptype("ptype_charging_cable", "cat_charging_cables", "Charging Cables", "charging_cable_v1");
ptype("ptype_laptop", "cat_laptops", "Everyday Laptops", "laptop_v1");
ptype("ptype_gaming_laptop", "cat_laptops", "Gaming Laptops", "gaming_laptop_v1");
ptype("ptype_monitor", "cat_monitors", "Monitors", "monitor_v1");
ptype("ptype_keyboard", "cat_input_devices", "Keyboards", "keyboard_v1");
ptype("ptype_mouse", "cat_input_devices", "Mice", "mouse_v1");
ptype("ptype_printer", "cat_printers", "Printers", "printer_v1");
ptype("ptype_external_ssd", "cat_storage", "External SSDs", "external_ssd_v1");
ptype("ptype_earbuds", "cat_earbuds", "Wireless Earbuds", "earbuds_v1");
ptype("ptype_headphones", "cat_headphones", "Over-Ear Headphones", "headphones_v1");
ptype("ptype_neckband", "cat_neckbands", "Neckband Earphones", "neckband_v1");
ptype("ptype_bluetooth_speaker", "cat_speakers", "Bluetooth Speakers", "bluetooth_speaker_v1");
ptype("ptype_soundbar", "cat_soundbars", "Soundbars", "soundbar_v1");
ptype("ptype_television", "cat_televisions", "Televisions", "television_v1");
ptype("ptype_streaming_device", "cat_streaming_devices", "Streaming Devices", "streaming_device_v1");
ptype("ptype_action_camera", "cat_action_cameras", "Action Cameras", "action_camera_v1");

// -- Home & Kitchen
ptype("ptype_refrigerator", "cat_refrigerators", "Refrigerators", "refrigerator_v1");
ptype("ptype_washing_machine", "cat_washing_machines", "Washing Machines", "washing_machine_v1");
ptype("ptype_air_conditioner", "cat_air_conditioners", "Air Conditioners", "air_conditioner_v1");
ptype("ptype_microwave", "cat_microwaves", "Microwave Ovens", "microwave_v1");
ptype("ptype_mixer_grinder", "cat_mixer_grinders", "Mixer Grinders", "mixer_grinder_v1");
ptype("ptype_electric_kettle", "cat_kettles", "Electric Kettles", "electric_kettle_v1");
ptype("ptype_induction_cooktop", "cat_induction_cooktops", "Induction Cooktops", "induction_cooktop_v1");
ptype("ptype_air_fryer", "cat_air_fryers", "Air Fryers", "air_fryer_v1");
ptype("ptype_water_purifier", "cat_water_purifiers", "Water Purifiers", "water_purifier_v1");
ptype("ptype_gas_stove", "cat_gas_stoves", "Gas Stoves", "gas_stove_v1");
ptype("ptype_pressure_cooker", "cat_pressure_cookers", "Pressure Cookers", "pressure_cooker_v1");
ptype("ptype_cookware_set", "cat_cookware_sets", "Cookware Sets", "cookware_set_v1");
ptype("ptype_dinner_set", "cat_dinner_sets", "Dinner Sets", "dinner_set_v1");
ptype("ptype_ceiling_fan", "cat_ceiling_fans", "Ceiling Fans", "ceiling_fan_v1");
ptype("ptype_air_cooler", "cat_air_coolers", "Air Coolers", "air_cooler_v1");
ptype("ptype_vacuum_cleaner", "cat_vacuum_cleaners", "Vacuum Cleaners", "vacuum_cleaner_v1");

// -- Home & Furniture
ptype("ptype_office_chair", "cat_office_chairs", "Office Chairs", "office_chair_v1");
ptype("ptype_sofa", "cat_sofas", "Sofas", "sofa_v1");
ptype("ptype_mattress", "cat_mattresses", "Mattresses", "mattress_v1");
ptype("ptype_bed", "cat_beds", "Beds", "bed_v1");
ptype("ptype_wardrobe", "cat_wardrobes", "Wardrobes", "wardrobe_v1");
ptype("ptype_study_table", "cat_study_tables", "Study Tables", "study_table_v1");
ptype("ptype_bookshelf", "cat_bookshelves", "Bookshelves", "bookshelf_v1");
ptype("ptype_bedsheet", "cat_bedsheets", "Bedsheets", "bedsheet_v1");
ptype("ptype_curtain", "cat_curtains", "Curtains", "curtain_v1");

// -- Fashion
ptype("ptype_tshirt", "cat_tshirts", "T-Shirts", "tshirt_v1");
ptype("ptype_casual_shirt", "cat_casual_shirts", "Casual Shirts", "casual_shirt_v1");
ptype("ptype_formal_shirt", "cat_formal_shirts", "Formal Shirts", "formal_shirt_v1");
ptype("ptype_jeans", "cat_jeans", "Jeans", "jeans_v1");
ptype("ptype_trousers", "cat_trousers", "Trousers", "trousers_v1");
ptype("ptype_kurta", "cat_kurtas", "Kurtas", "kurta_v1");
ptype("ptype_kurti", "cat_kurtis", "Kurtis", "kurti_v1");
ptype("ptype_saree", "cat_sarees", "Sarees", "saree_v1");
ptype("ptype_dress", "cat_dresses", "Dresses", "dress_v1");
ptype("ptype_leggings", "cat_leggings", "Leggings", "leggings_v1");
ptype("ptype_running_shoes", "cat_running_shoes", "Running Shoes", "running_shoes_v1");
ptype("ptype_sneakers", "cat_sneakers", "Casual Sneakers", "sneakers_v1");
ptype("ptype_formal_shoes", "cat_formal_shoes", "Formal Shoes", "formal_shoes_v1");
ptype("ptype_sandals", "cat_sandals", "Sandals & Floaters", "sandals_v1");
ptype("ptype_backpack", "cat_backpacks", "Backpacks", "backpack_v1");
ptype("ptype_handbag", "cat_handbags", "Handbags", "handbag_v1");
ptype("ptype_wallet", "cat_wallets", "Wallets", "wallet_v1");
ptype("ptype_sunglasses", "cat_sunglasses", "Sunglasses", "sunglasses_v1");

// -- Beauty & Personal Care
ptype("ptype_perfume", "cat_perfumes", "Perfumes", "perfume_v1");
ptype("ptype_deodorant", "cat_deodorants", "Deodorants", "deodorant_v1");
ptype("ptype_face_wash", "cat_face_wash", "Face Wash", "face_wash_v1");
ptype("ptype_moisturiser", "cat_moisturisers", "Moisturisers", "moisturiser_v1");
ptype("ptype_sunscreen", "cat_sunscreen", "Sunscreen", "sunscreen_v1");
ptype("ptype_face_serum", "cat_face_serums", "Face Serums", "face_serum_v1");
ptype("ptype_lipstick", "cat_lipsticks", "Lipsticks", "lipstick_v1");
ptype("ptype_foundation", "cat_foundation", "Foundation", "foundation_v1");
ptype("ptype_shampoo", "cat_shampoo", "Shampoo", "shampoo_v1");
ptype("ptype_hair_oil", "cat_hair_oil", "Hair Oil", "hair_oil_v1");
ptype("ptype_hair_dryer", "cat_hair_dryers", "Hair Dryers", "hair_dryer_v1");
ptype("ptype_trimmer", "cat_trimmers", "Beard Trimmers", "trimmer_v1");

// -- Sports & Fitness
ptype("ptype_smartwatch", "cat_smartwatches", "Smartwatches", "smartwatch_v1");
ptype("ptype_fitness_band", "cat_fitness_bands", "Fitness Bands", "fitness_band_v1");
ptype("ptype_yoga_mat", "cat_yoga_mats", "Yoga Mats", "yoga_mat_v1");
ptype("ptype_dumbbell", "cat_dumbbells", "Dumbbells", "dumbbell_v1");
ptype("ptype_treadmill", "cat_treadmills", "Treadmills", "treadmill_v1");
ptype("ptype_resistance_band", "cat_resistance_bands", "Resistance Bands", "resistance_band_v1");
ptype("ptype_cricket_bat", "cat_cricket_bats", "Cricket Bats", "cricket_bat_v1");
ptype("ptype_badminton_racket", "cat_badminton_rackets", "Badminton Rackets", "badminton_racket_v1");

// -- Grocery & Gourmet
ptype("ptype_tea", "cat_tea", "Tea", "tea_v1");
ptype("ptype_coffee", "cat_coffee", "Coffee", "coffee_v1");
ptype("ptype_health_drink", "cat_health_drinks", "Health Drinks", "health_drink_v1");
ptype("ptype_rice", "cat_rice", "Rice", "rice_v1");
ptype("ptype_cooking_oil", "cat_cooking_oil", "Cooking Oil", "cooking_oil_v1");
ptype("ptype_spices", "cat_spices", "Spices & Masala", "spices_v1");
ptype("ptype_biscuits", "cat_biscuits", "Biscuits & Cookies", "biscuits_v1");
ptype("ptype_chocolate", "cat_chocolates", "Chocolates", "chocolate_v1");
ptype("ptype_dry_fruits", "cat_dry_fruits", "Dry Fruits & Nuts", "dry_fruits_v1");

// -- Baby & Kids
ptype("ptype_diapers", "cat_diapers", "Diapers", "diapers_v1");
ptype("ptype_baby_wipes", "cat_baby_wipes", "Baby Wipes", "baby_wipes_v1");
ptype("ptype_baby_food", "cat_baby_food", "Baby Food", "baby_food_v1");
ptype("ptype_feeding_bottle", "cat_feeding_bottles", "Feeding Bottles", "feeding_bottle_v1");
ptype("ptype_stroller", "cat_strollers", "Strollers & Prams", "stroller_v1");

// -- Books & Stationery
ptype("ptype_fiction_book", "cat_fiction_books", "Fiction Books", "book_v1");
ptype("ptype_nonfiction_book", "cat_nonfiction_books", "Non-Fiction Books", "book_v1");
ptype("ptype_exam_book", "cat_exam_books", "Exam Preparation Books", "exam_book_v1");
ptype("ptype_childrens_book", "cat_childrens_books", "Children's Books", "book_v1");
ptype("ptype_notebook", "cat_notebooks", "Notebooks", "notebook_v1");
ptype("ptype_pen", "cat_pens", "Pens", "pen_v1");

// -- Automotive
ptype("ptype_car_care", "cat_car_care", "Car Care", "car_care_v1");
ptype("ptype_engine_oil", "cat_engine_oil", "Engine Oil", "engine_oil_v1");
ptype("ptype_car_phone_holder", "cat_car_phone_holders", "Car Phone Holders", "car_phone_holder_v1");
ptype("ptype_helmet", "cat_helmets", "Helmets", "helmet_v1");

// -- Health & Wellness
ptype("ptype_protein_powder", "cat_protein_powder", "Protein Powder", "protein_powder_v1");
ptype("ptype_multivitamin", "cat_multivitamins", "Multivitamins", "multivitamin_v1");
ptype("ptype_bp_monitor", "cat_bp_monitors", "BP Monitors", "bp_monitor_v1");
ptype("ptype_glucometer", "cat_glucometers", "Glucometers", "glucometer_v1");
ptype("ptype_thermometer", "cat_thermometers", "Thermometers", "thermometer_v1");

// -- Pet Supplies
ptype("ptype_dog_food", "cat_dog_food", "Dog Food", "dog_food_v1");
ptype("ptype_cat_food", "cat_cat_food", "Cat Food", "cat_food_v1");
ptype("ptype_pet_grooming", "cat_pet_grooming", "Pet Grooming", "pet_grooming_v1");
ptype("ptype_pet_toy", "cat_pet_toys", "Pet Toys", "pet_toy_v1");

// -- Tools & Home Improvement
ptype("ptype_drill", "cat_drills", "Drills", "drill_v1");
ptype("ptype_screwdriver_set", "cat_screwdriver_sets", "Screwdriver Sets", "screwdriver_set_v1");
ptype("ptype_led_bulb", "cat_led_bulbs", "LED Bulbs", "led_bulb_v1");
ptype("ptype_extension_board", "cat_extension_boards", "Extension Boards", "extension_board_v1");
ptype("ptype_torch", "cat_torches", "Torches", "torch_v1");

// -- Toys & Games
ptype("ptype_soft_toy", "cat_soft_toys", "Soft Toys", "soft_toy_v1");
ptype("ptype_building_blocks", "cat_building_blocks", "Building Blocks", "building_blocks_v1");
ptype("ptype_rc_toy", "cat_rc_toys", "Remote Control Toys", "rc_toy_v1");
ptype("ptype_board_game", "cat_board_games", "Board Games", "board_game_v1");

export const productTypes = ptypeRows;

// ---------------------------------------------------------------------------
// Marketplace taxonomies — each platform's own tree, kept verbatim, mapped onto
// the canonical one.
//
// The hand-authored rows below carry REAL external node ids captured from the
// marketplaces, and are kept because they are the honest article. Everything
// else is derived: a marketplace that covers a department gets a mapping row
// for each leaf in it, with a confidence that reflects how closely that
// platform's tree resembles ours. A marketplace not covering a branch simply
// has no mapping row — itself a fact the coverage page reports rather than
// something to paper over.
// ---------------------------------------------------------------------------
const curatedMarketplaceCategories = [
  { id: "mpcat_fk_smartphones", marketplaceId: "mp_flipkart", externalNodeId: "tyy/4io/6may", rawPath: "Electronics > Mobiles & Accessories > Mobiles", mappedCategoryId: "cat_smartphones", mappingConfidence: 0.97, mappedBy: "rule" },
  { id: "mpcat_az_smartphones", marketplaceId: "mp_amazon_in", externalNodeId: "1389401031", rawPath: "Electronics > Mobiles & Accessories > Smartphones & Basic Mobiles > Smartphones", mappedCategoryId: "cat_smartphones", mappingConfidence: 0.99, mappedBy: "rule" },
  { id: "mpcat_meesho_smartphones", marketplaceId: "mp_meesho", externalNodeId: "electronics-mobiles", rawPath: "Electronics > Mobile Phones", mappedCategoryId: "cat_smartphones", mappingConfidence: 0.9, mappedBy: "model" },
  { id: "mpcat_fk_power_banks", marketplaceId: "mp_flipkart", externalNodeId: "tyy/4mr/k4d", rawPath: "Electronics > Mobile Accessories > Power Banks", mappedCategoryId: "cat_power_banks", mappingConfidence: 0.95, mappedBy: "rule" },
  { id: "mpcat_az_power_banks", marketplaceId: "mp_amazon_in", externalNodeId: "1389432011", rawPath: "Electronics > Accessories > Power Banks", mappedCategoryId: "cat_power_banks", mappingConfidence: 0.95, mappedBy: "rule" },
  { id: "mpcat_fk_laptops", marketplaceId: "mp_flipkart", externalNodeId: "6bo/b5g", rawPath: "Electronics > Computers > Laptops", mappedCategoryId: "cat_laptops", mappingConfidence: 0.98, mappedBy: "rule" },
  { id: "mpcat_az_laptops", marketplaceId: "mp_amazon_in", externalNodeId: "1375424031", rawPath: "Electronics > Computers & Accessories > Laptops", mappedCategoryId: "cat_laptops", mappingConfidence: 0.98, mappedBy: "rule" },
  { id: "mpcat_fk_earbuds", marketplaceId: "mp_flipkart", externalNodeId: "0sm/6ka", rawPath: "Electronics > Headphones > Wireless Earbuds", mappedCategoryId: "cat_earbuds", mappingConfidence: 0.96, mappedBy: "rule" },
  { id: "mpcat_az_earbuds", marketplaceId: "mp_amazon_in", externalNodeId: "1389432031", rawPath: "Electronics > Headphones, Earbuds & Accessories > Earbuds", mappedCategoryId: "cat_earbuds", mappingConfidence: 0.96, mappedBy: "rule" },
  { id: "mpcat_meesho_earbuds", marketplaceId: "mp_meesho", externalNodeId: "electronics-earphones", rawPath: "Electronics > Earphones", mappedCategoryId: "cat_earbuds", mappingConfidence: 0.88, mappedBy: "model" },
  { id: "mpcat_fk_headphones", marketplaceId: "mp_flipkart", externalNodeId: "0sm/lc3", rawPath: "Electronics > Headphones > Over-Ear Headphones", mappedCategoryId: "cat_headphones", mappingConfidence: 0.95, mappedBy: "rule" },
  { id: "mpcat_az_headphones", marketplaceId: "mp_amazon_in", externalNodeId: "1388921031", rawPath: "Electronics > Headphones > Over-Ear", mappedCategoryId: "cat_headphones", mappingConfidence: 0.94, mappedBy: "rule" },
  { id: "mpcat_fk_televisions", marketplaceId: "mp_flipkart", externalNodeId: "ckf/czl", rawPath: "TVs & Appliances > Televisions", mappedCategoryId: "cat_televisions", mappingConfidence: 0.98, mappedBy: "rule" },
  { id: "mpcat_az_televisions", marketplaceId: "mp_amazon_in", externalNodeId: "1389396031", rawPath: "Electronics > Home Entertainment > Televisions", mappedCategoryId: "cat_televisions", mappingConfidence: 0.98, mappedBy: "rule" },
  { id: "mpcat_fk_refrigerators", marketplaceId: "mp_flipkart", externalNodeId: "j9e/abm", rawPath: "TVs & Appliances > Refrigerators", mappedCategoryId: "cat_refrigerators", mappingConfidence: 0.97, mappedBy: "rule" },
  { id: "mpcat_az_refrigerators", marketplaceId: "mp_amazon_in", externalNodeId: "1380365031", rawPath: "Home & Kitchen > Large Appliances > Refrigerators", mappedCategoryId: "cat_refrigerators", mappingConfidence: 0.97, mappedBy: "rule" },
  { id: "mpcat_fk_washing_machines", marketplaceId: "mp_flipkart", externalNodeId: "j9e/abn", rawPath: "TVs & Appliances > Washing Machines", mappedCategoryId: "cat_washing_machines", mappingConfidence: 0.97, mappedBy: "rule" },
  { id: "mpcat_az_washing_machines", marketplaceId: "mp_amazon_in", externalNodeId: "1380369031", rawPath: "Home & Kitchen > Large Appliances > Washing Machines", mappedCategoryId: "cat_washing_machines", mappingConfidence: 0.97, mappedBy: "rule" },
  { id: "mpcat_fk_microwaves", marketplaceId: "mp_flipkart", externalNodeId: "j9e/kqm", rawPath: "TVs & Appliances > Kitchen Appliances > Microwave Ovens", mappedCategoryId: "cat_microwaves", mappingConfidence: 0.96, mappedBy: "rule" },
  { id: "mpcat_az_microwaves", marketplaceId: "mp_amazon_in", externalNodeId: "1380371031", rawPath: "Home & Kitchen > Kitchen Appliances > Microwave Ovens", mappedCategoryId: "cat_microwaves", mappingConfidence: 0.96, mappedBy: "rule" },
  { id: "mpcat_fk_mixer_grinders", marketplaceId: "mp_flipkart", externalNodeId: "j9e/kqn", rawPath: "TVs & Appliances > Kitchen Appliances > Mixer Grinders", mappedCategoryId: "cat_mixer_grinders", mappingConfidence: 0.95, mappedBy: "rule" },
  { id: "mpcat_meesho_mixer_grinders", marketplaceId: "mp_meesho", externalNodeId: "home-kitchen-mixers", rawPath: "Home & Kitchen > Mixers", mappedCategoryId: "cat_mixer_grinders", mappingConfidence: 0.86, mappedBy: "model" },
  { id: "mpcat_fk_office_chairs", marketplaceId: "mp_flipkart", externalNodeId: "wwe/8pk", rawPath: "Home & Furniture > Office Furniture > Chairs", mappedCategoryId: "cat_office_chairs", mappingConfidence: 0.94, mappedBy: "rule" },
  { id: "mpcat_az_office_chairs", marketplaceId: "mp_amazon_in", externalNodeId: "1380442031", rawPath: "Home & Kitchen > Furniture > Home Office Furniture > Chairs", mappedCategoryId: "cat_office_chairs", mappingConfidence: 0.93, mappedBy: "rule" },
  { id: "mpcat_fk_tshirts", marketplaceId: "mp_flipkart", externalNodeId: "clo/ash/ank", rawPath: "Clothing > Men's Clothing > T-Shirts", mappedCategoryId: "cat_tshirts", mappingConfidence: 0.96, mappedBy: "rule" },
  { id: "mpcat_meesho_tshirts", marketplaceId: "mp_meesho", externalNodeId: "men-tshirts", rawPath: "Men > T-Shirts", mappedCategoryId: "cat_tshirts", mappingConfidence: 0.92, mappedBy: "rule" },
  { id: "mpcat_myntra_tshirts", marketplaceId: "mp_myntra", externalNodeId: "men-tshirts", rawPath: "Men > Topwear > Tshirts", mappedCategoryId: "cat_tshirts", mappingConfidence: 0.98, mappedBy: "rule" },
  { id: "mpcat_fk_running_shoes", marketplaceId: "mp_flipkart", externalNodeId: "osp/cil/nit", rawPath: "Footwear > Men's Footwear > Sports Shoes > Running Shoes", mappedCategoryId: "cat_running_shoes", mappingConfidence: 0.95, mappedBy: "rule" },
  { id: "mpcat_az_running_shoes", marketplaceId: "mp_amazon_in", externalNodeId: "1983518031", rawPath: "Shoes & Handbags > Men's Shoes > Sports & Outdoor Shoes > Running Shoes", mappedCategoryId: "cat_running_shoes", mappingConfidence: 0.95, mappedBy: "rule" },
  { id: "mpcat_meesho_running_shoes", marketplaceId: "mp_meesho", externalNodeId: "men-sports-shoes", rawPath: "Men > Sports Shoes", mappedCategoryId: "cat_running_shoes", mappingConfidence: 0.87, mappedBy: "model" },
  { id: "mpcat_myntra_running_shoes", marketplaceId: "mp_myntra", externalNodeId: "men-sports-shoes", rawPath: "Men > Footwear > Sports Shoes", mappedCategoryId: "cat_running_shoes", mappingConfidence: 0.96, mappedBy: "rule" },
  { id: "mpcat_fk_perfumes", marketplaceId: "mp_flipkart", externalNodeId: "g9b/ave", rawPath: "Beauty & Personal Care > Fragrances > Perfumes", mappedCategoryId: "cat_perfumes", mappingConfidence: 0.94, mappedBy: "rule" },
  { id: "mpcat_az_perfumes", marketplaceId: "mp_amazon_in", externalNodeId: "1374357031", rawPath: "Beauty > Fragrance > Perfumes", mappedCategoryId: "cat_perfumes", mappingConfidence: 0.94, mappedBy: "rule" },
  { id: "mpcat_nykaa_perfumes", marketplaceId: "mp_nykaa", externalNodeId: "fragrance-perfume", rawPath: "Fragrance > Perfume", mappedCategoryId: "cat_perfumes", mappingConfidence: 0.99, mappedBy: "rule" },
  { id: "mpcat_fk_smartwatches", marketplaceId: "mp_flipkart", externalNodeId: "ajy/bwx", rawPath: "Electronics > Wearable Smart Devices > Smart Watches", mappedCategoryId: "cat_smartwatches", mappingConfidence: 0.96, mappedBy: "rule" },
  { id: "mpcat_az_smartwatches", marketplaceId: "mp_amazon_in", externalNodeId: "1350387031", rawPath: "Electronics > Wearable Technology > Smart Watches", mappedCategoryId: "cat_smartwatches", mappingConfidence: 0.96, mappedBy: "rule" },
  { id: "mpcat_meesho_power_banks", marketplaceId: "mp_meesho", externalNodeId: "electronics-powerbanks", rawPath: "Electronics > Power Banks", mappedCategoryId: "cat_power_banks", mappingConfidence: 0.87, mappedBy: "model" },
  { id: "mpcat_meesho_headphones", marketplaceId: "mp_meesho", externalNodeId: "electronics-headphones", rawPath: "Electronics > Headphones", mappedCategoryId: "cat_headphones", mappingConfidence: 0.84, mappedBy: "model" },
  { id: "mpcat_meesho_televisions", marketplaceId: "mp_meesho", externalNodeId: "electronics-tv", rawPath: "Electronics > Television", mappedCategoryId: "cat_televisions", mappingConfidence: 0.88, mappedBy: "model" },
  { id: "mpcat_meesho_refrigerators", marketplaceId: "mp_meesho", externalNodeId: "home-appliances-fridge", rawPath: "Home & Kitchen > Refrigerators", mappedCategoryId: "cat_refrigerators", mappingConfidence: 0.85, mappedBy: "model" },
  { id: "mpcat_meesho_microwaves", marketplaceId: "mp_meesho", externalNodeId: "home-appliances-microwave", rawPath: "Home & Kitchen > Microwave", mappedCategoryId: "cat_microwaves", mappingConfidence: 0.85, mappedBy: "model" },
  { id: "mpcat_meesho_office_chairs", marketplaceId: "mp_meesho", externalNodeId: "furniture-chairs", rawPath: "Furniture > Chairs", mappedCategoryId: "cat_office_chairs", mappingConfidence: 0.8, mappedBy: "model" },
  { id: "mpcat_meesho_perfumes", marketplaceId: "mp_meesho", externalNodeId: "beauty-perfumes", rawPath: "Beauty > Perfumes & Deodorants", mappedCategoryId: "cat_perfumes", mappingConfidence: 0.86, mappedBy: "model" },
  { id: "mpcat_meesho_smartwatches", marketplaceId: "mp_meesho", externalNodeId: "electronics-smartwatches", rawPath: "Electronics > Smart Watches", mappedCategoryId: "cat_smartwatches", mappingConfidence: 0.89, mappedBy: "model" },
];

// How closely each marketplace's own tree resembles ours, and how it labels a
// mapping it had to infer rather than match outright.
const MAPPING_PROFILE = {
  mp_flipkart: { confidence: 0.95, mappedBy: "rule", prefix: "fk" },
  mp_amazon_in: { confidence: 0.96, mappedBy: "rule", prefix: "az" },
  mp_meesho: { confidence: 0.84, mappedBy: "model", prefix: "meesho" },
  mp_myntra: { confidence: 0.94, mappedBy: "rule", prefix: "myntra" },
  mp_ajio: { confidence: 0.91, mappedBy: "rule", prefix: "ajio" },
  mp_nykaa: { confidence: 0.95, mappedBy: "rule", prefix: "nykaa" },
};

function departmentOf(categoryId) {
  let current = bySlug.get(categoryId);
  while (current && current.parentId) current = bySlug.get(current.parentId);
  return current?.id ?? null;
}

function buildMarketplaceCategories(marketplaceRows) {
  const out = [...curatedMarketplaceCategories];
  const seen = new Set(out.map((r) => `${r.marketplaceId}::${r.mappedCategoryId}`));

  for (const mp of marketplaceRows) {
    const profile = MAPPING_PROFILE[mp.id];
    if (!profile) continue;
    for (const leaf of rows.filter((r) => ptypeRows.some((p) => p.categoryId === r.id))) {
      const dep = departmentOf(leaf.id);
      if (mp.categoryAffinity && !mp.categoryAffinity.includes(dep)) continue;
      const key = `${mp.id}::${leaf.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `mpcat_${profile.prefix}_${leaf.id.replace("cat_", "")}`,
        marketplaceId: mp.id,
        externalNodeId: `${profile.prefix}-${leaf.path.split("/").slice(-2).join("-")}`,
        rawPath: leaf.path.split("/").map((s) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())).join(" > "),
        mappedCategoryId: leaf.id,
        mappingConfidence: profile.confidence,
        mappedBy: profile.mappedBy,
      });
    }
  }
  return out;
}

// marketplaces.js does not import categories.js, so this direction is safe.
export const marketplaceCategories = buildMarketplaceCategories(marketplaceRows);

// ---------------------------------------------------------------------------
// Lookups. Indexed rather than scanned — with 125 product types and ~700
// marketplace-category rows, the previous `.find()`-per-call pattern turned
// category resolution into a measurable cost inside the catalogue build.
// ---------------------------------------------------------------------------
const categoryById = new Map(rows.map((c) => [c.id, c]));
const productTypeById = new Map(ptypeRows.map((p) => [p.id, p]));
const childrenByParent = (() => {
  const map = new Map();
  for (const c of rows) {
    const key = c.parentId ?? "__root__";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  }
  return map;
})();
const productTypesByCategory = (() => {
  const map = new Map();
  for (const p of ptypeRows) {
    if (!map.has(p.categoryId)) map.set(p.categoryId, []);
    map.get(p.categoryId).push(p);
  }
  return map;
})();

export function getCategoryPath(categoryId) {
  const path = [];
  let current = categoryById.get(categoryId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? categoryById.get(current.parentId) : null;
  }
  return path;
}

export function getCategory(categoryId) {
  return categoryById.get(categoryId) ?? null;
}

export function getChildCategories(parentId) {
  return childrenByParent.get(parentId) ?? [];
}

export function getDepartments() {
  return childrenByParent.get("__root__") ?? [];
}

export function getProductType(productTypeId) {
  return productTypeById.get(productTypeId) ?? null;
}

export function getProductTypesForCategory(categoryId) {
  return productTypesByCategory.get(categoryId) ?? [];
}

/** The L1 department a category ultimately sits under. */
export function getDepartmentId(categoryId) {
  return departmentOf(categoryId);
}

/** All category IDs at or beneath `categoryId` — powers "everything under Electronics". */
export function getCategorySubtreeIds(categoryId) {
  const out = [categoryId];
  const walk = (parentId) => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      out.push(child.id);
      walk(child.id);
    }
  };
  walk(categoryId);
  return out;
}
