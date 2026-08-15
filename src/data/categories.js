// Canonical internal category tree — our own taxonomy, independent of any
// marketplace's. Four browsable levels:
//
//   L1 Department  →  L2 Category  →  L3 Subcategory  →  Product Type
//
// Product types hang off L3 subcategories (see `productTypes` below) and are
// what the attribute-definition registry keys on — so a Refrigerator and a
// Running Shoe can carry completely different specs without any schema change.
//
// This is deliberately broad rather than exhaustive: it demonstrates that the
// structure scales past electronics, and adding a new department is a data
// insert, never a migration.

export const categories = [
  // ============================ ELECTRONICS ============================
  { id: "cat_electronics", parentId: null, level: 1, name: "Electronics", path: "electronics" },

  { id: "cat_mobiles_accessories", parentId: "cat_electronics", level: 2, name: "Mobiles & Accessories", path: "electronics/mobiles-accessories" },
  { id: "cat_smartphones", parentId: "cat_mobiles_accessories", level: 3, name: "Smartphones", path: "electronics/mobiles-accessories/smartphones" },
  { id: "cat_power_banks", parentId: "cat_mobiles_accessories", level: 3, name: "Power Banks", path: "electronics/mobiles-accessories/power-banks" },

  { id: "cat_computers", parentId: "cat_electronics", level: 2, name: "Computers", path: "electronics/computers" },
  { id: "cat_laptops", parentId: "cat_computers", level: 3, name: "Laptops", path: "electronics/computers/laptops" },

  { id: "cat_audio", parentId: "cat_electronics", level: 2, name: "Audio", path: "electronics/audio" },
  { id: "cat_earbuds", parentId: "cat_audio", level: 3, name: "Wireless Earbuds", path: "electronics/audio/wireless-earbuds" },
  { id: "cat_headphones", parentId: "cat_audio", level: 3, name: "Over-Ear Headphones", path: "electronics/audio/over-ear-headphones" },

  { id: "cat_tv_entertainment", parentId: "cat_electronics", level: 2, name: "TVs & Home Entertainment", path: "electronics/tv-home-entertainment" },
  { id: "cat_televisions", parentId: "cat_tv_entertainment", level: 3, name: "Televisions", path: "electronics/tv-home-entertainment/televisions" },

  // ========================== HOME & KITCHEN ==========================
  { id: "cat_home_kitchen", parentId: null, level: 1, name: "Home & Kitchen", path: "home-kitchen" },

  { id: "cat_large_appliances", parentId: "cat_home_kitchen", level: 2, name: "Large Appliances", path: "home-kitchen/large-appliances" },
  { id: "cat_refrigerators", parentId: "cat_large_appliances", level: 3, name: "Refrigerators", path: "home-kitchen/large-appliances/refrigerators" },
  { id: "cat_washing_machines", parentId: "cat_large_appliances", level: 3, name: "Washing Machines", path: "home-kitchen/large-appliances/washing-machines" },

  { id: "cat_kitchen_appliances", parentId: "cat_home_kitchen", level: 2, name: "Kitchen Appliances", path: "home-kitchen/kitchen-appliances" },
  { id: "cat_microwaves", parentId: "cat_kitchen_appliances", level: 3, name: "Microwave Ovens", path: "home-kitchen/kitchen-appliances/microwave-ovens" },
  { id: "cat_mixer_grinders", parentId: "cat_kitchen_appliances", level: 3, name: "Mixer Grinders", path: "home-kitchen/kitchen-appliances/mixer-grinders" },

  // ======================== HOME & FURNITURE ==========================
  { id: "cat_home_furniture", parentId: null, level: 1, name: "Home & Furniture", path: "home-furniture" },
  { id: "cat_seating", parentId: "cat_home_furniture", level: 2, name: "Seating", path: "home-furniture/seating" },
  { id: "cat_office_chairs", parentId: "cat_seating", level: 3, name: "Office Chairs", path: "home-furniture/seating/office-chairs" },

  // ============================= FASHION ==============================
  { id: "cat_fashion", parentId: null, level: 1, name: "Fashion", path: "fashion" },

  { id: "cat_mens_clothing", parentId: "cat_fashion", level: 2, name: "Men's Clothing", path: "fashion/mens-clothing" },
  { id: "cat_tshirts", parentId: "cat_mens_clothing", level: 3, name: "T-Shirts", path: "fashion/mens-clothing/t-shirts" },

  { id: "cat_footwear", parentId: "cat_fashion", level: 2, name: "Footwear", path: "fashion/footwear" },
  { id: "cat_running_shoes", parentId: "cat_footwear", level: 3, name: "Running Shoes", path: "fashion/footwear/running-shoes" },

  // ==================== BEAUTY & PERSONAL CARE ========================
  { id: "cat_beauty", parentId: null, level: 1, name: "Beauty & Personal Care", path: "beauty-personal-care" },
  { id: "cat_fragrances", parentId: "cat_beauty", level: 2, name: "Fragrances", path: "beauty-personal-care/fragrances" },
  { id: "cat_perfumes", parentId: "cat_fragrances", level: 3, name: "Perfumes", path: "beauty-personal-care/fragrances/perfumes" },

  // ======================== SPORTS & FITNESS ==========================
  { id: "cat_sports_fitness", parentId: null, level: 1, name: "Sports & Fitness", path: "sports-fitness" },
  { id: "cat_wearables", parentId: "cat_sports_fitness", level: 2, name: "Wearable Tech", path: "sports-fitness/wearable-tech" },
  { id: "cat_smartwatches", parentId: "cat_wearables", level: 3, name: "Smartwatches", path: "sports-fitness/wearable-tech/smartwatches" },
];

// Product types are the 4th browsable level and the key the specification
// registry is scoped to. A single subcategory can host several product types
// (Laptops → Laptop / Gaming Laptop), which is what makes the fourth level
// meaningful rather than decorative.
export const productTypes = [
  { id: "ptype_smartphone", categoryId: "cat_smartphones", name: "Smartphones", schemaVersion: "smartphone_v3" },
  { id: "ptype_power_bank", categoryId: "cat_power_banks", name: "Power Banks", schemaVersion: "power_bank_v1" },
  { id: "ptype_laptop", categoryId: "cat_laptops", name: "Everyday Laptops", schemaVersion: "laptop_v1" },
  { id: "ptype_gaming_laptop", categoryId: "cat_laptops", name: "Gaming Laptops", schemaVersion: "gaming_laptop_v1" },
  { id: "ptype_earbuds", categoryId: "cat_earbuds", name: "Wireless Earbuds", schemaVersion: "earbuds_v1" },
  { id: "ptype_headphones", categoryId: "cat_headphones", name: "Over-Ear Headphones", schemaVersion: "headphones_v1" },
  { id: "ptype_television", categoryId: "cat_televisions", name: "Televisions", schemaVersion: "television_v1" },
  { id: "ptype_refrigerator", categoryId: "cat_refrigerators", name: "Refrigerators", schemaVersion: "refrigerator_v1" },
  { id: "ptype_washing_machine", categoryId: "cat_washing_machines", name: "Washing Machines", schemaVersion: "washing_machine_v1" },
  { id: "ptype_microwave", categoryId: "cat_microwaves", name: "Microwave Ovens", schemaVersion: "microwave_v1" },
  { id: "ptype_mixer_grinder", categoryId: "cat_mixer_grinders", name: "Mixer Grinders", schemaVersion: "mixer_grinder_v1" },
  { id: "ptype_office_chair", categoryId: "cat_office_chairs", name: "Office Chairs", schemaVersion: "office_chair_v1" },
  { id: "ptype_tshirt", categoryId: "cat_tshirts", name: "T-Shirts", schemaVersion: "tshirt_v1" },
  { id: "ptype_running_shoes", categoryId: "cat_running_shoes", name: "Running Shoes", schemaVersion: "running_shoes_v1" },
  { id: "ptype_perfume", categoryId: "cat_perfumes", name: "Perfumes", schemaVersion: "perfume_v1" },
  { id: "ptype_smartwatch", categoryId: "cat_smartwatches", name: "Smartwatches", schemaVersion: "smartwatch_v1" },
];

// Each marketplace's own taxonomy, kept verbatim, mapped onto the canonical
// tree. Only the branches actually captured so far are listed — a marketplace
// not covering a branch simply has no mapping row, which is itself a fact the
// coverage page reports rather than something to paper over.
export const marketplaceCategories = [
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

  { id: "mpcat_fk_running_shoes", marketplaceId: "mp_flipkart", externalNodeId: "osp/cil/nit", rawPath: "Footwear > Men's Footwear > Sports Shoes > Running Shoes", mappedCategoryId: "cat_running_shoes", mappingConfidence: 0.95, mappedBy: "rule" },
  { id: "mpcat_az_running_shoes", marketplaceId: "mp_amazon_in", externalNodeId: "1983518031", rawPath: "Shoes & Handbags > Men's Shoes > Sports & Outdoor Shoes > Running Shoes", mappedCategoryId: "cat_running_shoes", mappingConfidence: 0.95, mappedBy: "rule" },
  { id: "mpcat_meesho_running_shoes", marketplaceId: "mp_meesho", externalNodeId: "men-sports-shoes", rawPath: "Men > Sports Shoes", mappedCategoryId: "cat_running_shoes", mappingConfidence: 0.87, mappedBy: "model" },

  { id: "mpcat_fk_perfumes", marketplaceId: "mp_flipkart", externalNodeId: "g9b/ave", rawPath: "Beauty & Personal Care > Fragrances > Perfumes", mappedCategoryId: "cat_perfumes", mappingConfidence: 0.94, mappedBy: "rule" },
  { id: "mpcat_az_perfumes", marketplaceId: "mp_amazon_in", externalNodeId: "1374357031", rawPath: "Beauty > Fragrance > Perfumes", mappedCategoryId: "cat_perfumes", mappingConfidence: 0.94, mappedBy: "rule" },

  { id: "mpcat_fk_smartwatches", marketplaceId: "mp_flipkart", externalNodeId: "ajy/bwx", rawPath: "Electronics > Wearable Smart Devices > Smart Watches", mappedCategoryId: "cat_smartwatches", mappingConfidence: 0.96, mappedBy: "rule" },
  { id: "mpcat_az_smartwatches", marketplaceId: "mp_amazon_in", externalNodeId: "1350387031", rawPath: "Electronics > Wearable Technology > Smart Watches", mappedCategoryId: "cat_smartwatches", mappingConfidence: 0.96, mappedBy: "rule" },

  // Meesho's tree is shallower than Flipkart's or Amazon's, so several of its
  // nodes map upward to a canonical leaf with lower confidence — exactly the
  // situation the confidence score and `mappedBy` exist to record.
  { id: "mpcat_meesho_power_banks", marketplaceId: "mp_meesho", externalNodeId: "electronics-powerbanks", rawPath: "Electronics > Power Banks", mappedCategoryId: "cat_power_banks", mappingConfidence: 0.87, mappedBy: "model" },
  { id: "mpcat_meesho_headphones", marketplaceId: "mp_meesho", externalNodeId: "electronics-headphones", rawPath: "Electronics > Headphones", mappedCategoryId: "cat_headphones", mappingConfidence: 0.84, mappedBy: "model" },
  { id: "mpcat_meesho_televisions", marketplaceId: "mp_meesho", externalNodeId: "electronics-tv", rawPath: "Electronics > Television", mappedCategoryId: "cat_televisions", mappingConfidence: 0.88, mappedBy: "model" },
  { id: "mpcat_meesho_refrigerators", marketplaceId: "mp_meesho", externalNodeId: "home-appliances-fridge", rawPath: "Home & Kitchen > Refrigerators", mappedCategoryId: "cat_refrigerators", mappingConfidence: 0.85, mappedBy: "model" },
  { id: "mpcat_meesho_microwaves", marketplaceId: "mp_meesho", externalNodeId: "home-appliances-microwave", rawPath: "Home & Kitchen > Microwave", mappedCategoryId: "cat_microwaves", mappingConfidence: 0.85, mappedBy: "model" },
  { id: "mpcat_meesho_office_chairs", marketplaceId: "mp_meesho", externalNodeId: "furniture-chairs", rawPath: "Furniture > Chairs", mappedCategoryId: "cat_office_chairs", mappingConfidence: 0.8, mappedBy: "model" },
  { id: "mpcat_meesho_perfumes", marketplaceId: "mp_meesho", externalNodeId: "beauty-perfumes", rawPath: "Beauty > Perfumes & Deodorants", mappedCategoryId: "cat_perfumes", mappingConfidence: 0.86, mappedBy: "model" },
  { id: "mpcat_meesho_smartwatches", marketplaceId: "mp_meesho", externalNodeId: "electronics-smartwatches", rawPath: "Electronics > Smart Watches", mappedCategoryId: "cat_smartwatches", mappingConfidence: 0.89, mappedBy: "model" },
];

export function getCategoryPath(categoryId) {
  const path = [];
  let current = categories.find((c) => c.id === categoryId);
  while (current) {
    path.unshift(current);
    current = categories.find((c) => c.id === current.parentId);
  }
  return path;
}

export function getCategory(categoryId) {
  return categories.find((c) => c.id === categoryId) ?? null;
}

export function getChildCategories(parentId) {
  return categories.filter((c) => c.parentId === parentId);
}

export function getDepartments() {
  return categories.filter((c) => c.level === 1);
}

export function getProductType(productTypeId) {
  return productTypes.find((p) => p.id === productTypeId) ?? null;
}

export function getProductTypesForCategory(categoryId) {
  return productTypes.filter((p) => p.categoryId === categoryId);
}

/** All category IDs at or beneath `categoryId` — powers "everything under Electronics". */
export function getCategorySubtreeIds(categoryId) {
  const out = [categoryId];
  const walk = (parentId) => {
    for (const child of categories.filter((c) => c.parentId === parentId)) {
      out.push(child.id);
      walk(child.id);
    }
  };
  walk(categoryId);
  return out;
}
