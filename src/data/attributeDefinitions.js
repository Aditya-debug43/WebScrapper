// The category attribute schema registry.
//
// Governs which spec keys are legal for a given product type, at a given
// schema version — and, critically for the catalogue, WHICH of those specs are
// filterable and HOW. The filter sidebar is generated from these rows, so a
// new product type gets working, correctly-typed filters from a data insert
// alone. No filter is hardcoded in the UI.
//
// Extra fields beyond the original schema:
//   isFilterable   — surface this attribute as a catalogue facet
//   filterType     — "enum" (discrete values) | "range" (numeric buckets) | "boolean"
//   buckets        — for range filters: [{ label, min, max }] (min inclusive, max exclusive)
//   higherIsBetter — for pricing-relevant numerics: does a bigger number mean a
//                    stronger product? Used by the recommendation engine's
//                    product-strength scoring, which must not assume that
//                    "more" is always "better" (e.g. laptop weight).

function def(productTypeId, schemaVersion, attributeKey, displayName, dataType, unit, opts = {}) {
  return {
    id: `attr_${productTypeId.replace("ptype_", "")}_${attributeKey}`,
    productTypeId,
    schemaVersion,
    attributeKey,
    displayName,
    dataType,
    unit,
    isRequired: opts.required ?? false,
    isPricingRelevant: opts.pricing ?? false,
    isFilterable: opts.filter != null,
    filterType: opts.filter ?? null,
    buckets: opts.buckets ?? null,
    higherIsBetter: opts.higherIsBetter ?? (opts.pricing ? true : null),
  };
}

const RAM_BUCKETS = [
  { label: "4 GB & below", min: 0, max: 5 },
  { label: "6 GB", min: 6, max: 7 },
  { label: "8 GB", min: 8, max: 9 },
  { label: "12 GB & above", min: 12, max: null },
];

const STORAGE_BUCKETS = [
  { label: "Up to 64 GB", min: 0, max: 65 },
  { label: "128 GB", min: 128, max: 129 },
  { label: "256 GB", min: 256, max: 257 },
  { label: "512 GB & above", min: 512, max: null },
];

export const attributeDefinitions = [
  // ------------------------------- SMARTPHONES -------------------------------
  def("ptype_smartphone", "smartphone_v3", "ram_gb", "RAM", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: RAM_BUCKETS }),
  def("ptype_smartphone", "smartphone_v3", "storage_gb", "Storage", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: STORAGE_BUCKETS }),
  def("ptype_smartphone", "smartphone_v3", "battery_mah", "Battery", "integer", "mAh", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 5000 mAh", min: 0, max: 5000 },
    { label: "5000–5999 mAh", min: 5000, max: 6000 },
    { label: "6000 mAh & above", min: 6000, max: null },
  ] }),
  def("ptype_smartphone", "smartphone_v3", "display_in", "Display Size", "decimal", "in", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 6.2\"", min: 0, max: 6.2 },
    { label: "6.2\"–6.6\"", min: 6.2, max: 6.61 },
    { label: "6.6\" & above", min: 6.61, max: null },
  ] }),
  def("ptype_smartphone", "smartphone_v3", "rear_camera_mp", "Rear Camera", "integer", "MP", { pricing: true, filter: "range", buckets: [
    { label: "Under 50 MP", min: 0, max: 50 },
    { label: "50 MP", min: 50, max: 51 },
    { label: "64 MP & above", min: 64, max: null },
  ] }),
  def("ptype_smartphone", "smartphone_v3", "processor", "Processor", "text", null, { filter: "enum" }),
  def("ptype_smartphone", "smartphone_v3", "has_5g", "5G", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_smartphone", "smartphone_v3", "refresh_rate_hz", "Refresh Rate", "integer", "Hz", { filter: "enum" }),
  def("ptype_smartphone", "smartphone_v3", "charging_w", "Charging Speed", "integer", "W", {}),

  // ------------------------------- POWER BANKS -------------------------------
  def("ptype_power_bank", "power_bank_v1", "capacity_mah", "Capacity", "integer", "mAh", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 10,000 mAh", min: 0, max: 10000 },
    { label: "10,000–19,999 mAh", min: 10000, max: 20000 },
    { label: "20,000 mAh & above", min: 20000, max: null },
  ] }),
  def("ptype_power_bank", "power_bank_v1", "output_w", "Max Output", "integer", "W", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 20 W", min: 0, max: 20 },
    { label: "20–44 W", min: 20, max: 45 },
    { label: "45 W & above", min: 45, max: null },
  ] }),
  def("ptype_power_bank", "power_bank_v1", "ports", "Ports", "integer", null, { filter: "enum" }),
  def("ptype_power_bank", "power_bank_v1", "has_fast_charging", "Fast Charging", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_power_bank", "power_bank_v1", "weight_g", "Weight", "integer", "g", { pricing: true, higherIsBetter: false }),

  // ----------------------------- EVERYDAY LAPTOPS ----------------------------
  def("ptype_laptop", "laptop_v1", "ram_gb", "RAM", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: RAM_BUCKETS }),
  def("ptype_laptop", "laptop_v1", "storage_gb", "Storage", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: STORAGE_BUCKETS }),
  def("ptype_laptop", "laptop_v1", "storage_type", "Storage Type", "text", null, { required: true, filter: "enum" }),
  def("ptype_laptop", "laptop_v1", "processor", "Processor", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_laptop", "laptop_v1", "gpu", "Graphics", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_laptop", "laptop_v1", "display_in", "Screen Size", "decimal", "in", { required: true, filter: "range", buckets: [
    { label: "Under 14\"", min: 0, max: 14 },
    { label: "14\"–15.5\"", min: 14, max: 15.6 },
    { label: "15.6\" & above", min: 15.6, max: null },
  ] }),
  def("ptype_laptop", "laptop_v1", "battery_hours", "Battery Life", "integer", "hrs", { pricing: true, filter: "range", buckets: [
    { label: "Under 8 hrs", min: 0, max: 8 },
    { label: "8–11 hrs", min: 8, max: 12 },
    { label: "12 hrs & above", min: 12, max: null },
  ] }),
  def("ptype_laptop", "laptop_v1", "weight_kg", "Weight", "decimal", "kg", { pricing: true, higherIsBetter: false }),

  // ------------------------------ GAMING LAPTOPS -----------------------------
  def("ptype_gaming_laptop", "gaming_laptop_v1", "ram_gb", "RAM", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: RAM_BUCKETS }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "storage_gb", "Storage", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: STORAGE_BUCKETS }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "processor", "Processor", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "gpu", "Graphics Card", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "refresh_rate_hz", "Refresh Rate", "integer", "Hz", { required: true, pricing: true, filter: "enum" }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "display_in", "Screen Size", "decimal", "in", { filter: "enum" }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "weight_kg", "Weight", "decimal", "kg", { pricing: true, higherIsBetter: false }),

  // ----------------------------- WIRELESS EARBUDS ----------------------------
  def("ptype_earbuds", "earbuds_v1", "battery_life_hours", "Battery Life (buds)", "decimal", "hrs", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 6 hrs", min: 0, max: 6 },
    { label: "6–8 hrs", min: 6, max: 8.1 },
    { label: "8 hrs & above", min: 8.1, max: null },
  ] }),
  def("ptype_earbuds", "earbuds_v1", "total_battery_hours", "Battery Life (with case)", "integer", "hrs", { pricing: true, filter: "range", buckets: [
    { label: "Under 30 hrs", min: 0, max: 30 },
    { label: "30–40 hrs", min: 30, max: 41 },
    { label: "40 hrs & above", min: 41, max: null },
  ] }),
  def("ptype_earbuds", "earbuds_v1", "has_anc", "Active Noise Cancellation", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_earbuds", "earbuds_v1", "driver_size_mm", "Driver Size", "integer", "mm", { filter: "enum" }),
  def("ptype_earbuds", "earbuds_v1", "bluetooth_version", "Bluetooth Version", "text", null, { filter: "enum" }),
  def("ptype_earbuds", "earbuds_v1", "water_resistance", "Water Resistance", "text", null, { filter: "enum" }),
  def("ptype_earbuds", "earbuds_v1", "charging_type", "Charging Type", "text", null, { filter: "enum" }),

  // --------------------------- OVER-EAR HEADPHONES ---------------------------
  def("ptype_headphones", "headphones_v1", "battery_life_hours", "Battery Life", "integer", "hrs", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 30 hrs", min: 0, max: 30 },
    { label: "30–49 hrs", min: 30, max: 50 },
    { label: "50 hrs & above", min: 50, max: null },
  ] }),
  def("ptype_headphones", "headphones_v1", "has_anc", "Active Noise Cancellation", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_headphones", "headphones_v1", "driver_size_mm", "Driver Size", "integer", "mm", { pricing: true, filter: "enum" }),
  def("ptype_headphones", "headphones_v1", "connectivity", "Connectivity", "text", null, { filter: "enum" }),
  def("ptype_headphones", "headphones_v1", "weight_g", "Weight", "integer", "g", { pricing: true, higherIsBetter: false }),

  // ------------------------------- TELEVISIONS -------------------------------
  def("ptype_television", "television_v1", "screen_size_in", "Screen Size", "integer", "in", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Up to 32\"", min: 0, max: 33 },
    { label: "40\"–43\"", min: 40, max: 44 },
    { label: "50\"–55\"", min: 50, max: 56 },
    { label: "65\" & above", min: 65, max: null },
  ] }),
  def("ptype_television", "television_v1", "resolution", "Resolution", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_television", "television_v1", "panel_type", "Panel Type", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_television", "television_v1", "refresh_rate_hz", "Refresh Rate", "integer", "Hz", { pricing: true, filter: "enum" }),
  def("ptype_television", "television_v1", "smart_os", "Smart OS", "text", null, { filter: "enum" }),
  def("ptype_television", "television_v1", "hdmi_ports", "HDMI Ports", "integer", null, { filter: "enum" }),

  // ------------------------------ REFRIGERATORS ------------------------------
  def("ptype_refrigerator", "refrigerator_v1", "capacity_l", "Capacity", "integer", "L", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 200 L", min: 0, max: 200 },
    { label: "200–299 L", min: 200, max: 300 },
    { label: "300–499 L", min: 300, max: 500 },
    { label: "500 L & above", min: 500, max: null },
  ] }),
  def("ptype_refrigerator", "refrigerator_v1", "door_type", "Door Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_refrigerator", "refrigerator_v1", "star_rating", "Energy Rating", "integer", "star", { pricing: true, filter: "enum" }),
  def("ptype_refrigerator", "refrigerator_v1", "defrost_type", "Defrost Type", "text", null, { filter: "enum" }),
  def("ptype_refrigerator", "refrigerator_v1", "has_inverter", "Inverter Compressor", "boolean", null, { pricing: true, filter: "boolean" }),

  // ----------------------------- WASHING MACHINES ----------------------------
  def("ptype_washing_machine", "washing_machine_v1", "capacity_kg", "Capacity", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 7 kg", min: 0, max: 7 },
    { label: "7–8 kg", min: 7, max: 8.1 },
    { label: "8 kg & above", min: 8.1, max: null },
  ] }),
  def("ptype_washing_machine", "washing_machine_v1", "load_type", "Load Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_washing_machine", "washing_machine_v1", "is_fully_automatic", "Fully Automatic", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_washing_machine", "washing_machine_v1", "star_rating", "Energy Rating", "integer", "star", { pricing: true, filter: "enum" }),
  def("ptype_washing_machine", "washing_machine_v1", "max_spin_rpm", "Max Spin Speed", "integer", "RPM", { pricing: true, filter: "range", buckets: [
    { label: "Under 1000 RPM", min: 0, max: 1000 },
    { label: "1000–1199 RPM", min: 1000, max: 1200 },
    { label: "1200 RPM & above", min: 1200, max: null },
  ] }),

  // ----------------------------- MICROWAVE OVENS -----------------------------
  def("ptype_microwave", "microwave_v1", "capacity_l", "Capacity", "integer", "L", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 20 L", min: 0, max: 20 },
    { label: "20–25 L", min: 20, max: 26 },
    { label: "26 L & above", min: 26, max: null },
  ] }),
  def("ptype_microwave", "microwave_v1", "oven_type", "Oven Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_microwave", "microwave_v1", "power_w", "Power", "integer", "W", { pricing: true, filter: "enum" }),
  def("ptype_microwave", "microwave_v1", "has_auto_cook", "Auto-Cook Menu", "boolean", null, { filter: "boolean" }),

  // ------------------------------ MIXER GRINDERS -----------------------------
  def("ptype_mixer_grinder", "mixer_grinder_v1", "power_w", "Motor Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 600 W", min: 0, max: 600 },
    { label: "600–749 W", min: 600, max: 750 },
    { label: "750 W & above", min: 750, max: null },
  ] }),
  def("ptype_mixer_grinder", "mixer_grinder_v1", "jars", "Number of Jars", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_mixer_grinder", "mixer_grinder_v1", "speed_settings", "Speed Settings", "integer", null, { filter: "enum" }),
  def("ptype_mixer_grinder", "mixer_grinder_v1", "warranty_years", "Warranty", "integer", "yrs", { pricing: true, filter: "enum" }),

  // ------------------------------ OFFICE CHAIRS ------------------------------
  def("ptype_office_chair", "office_chair_v1", "back_type", "Back Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_office_chair", "office_chair_v1", "material", "Material", "text", null, { required: true, filter: "enum" }),
  def("ptype_office_chair", "office_chair_v1", "has_lumbar_support", "Lumbar Support", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_office_chair", "office_chair_v1", "has_adjustable_armrest", "Adjustable Armrests", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_office_chair", "office_chair_v1", "max_load_kg", "Max Load", "integer", "kg", { pricing: true, filter: "range", buckets: [
    { label: "Under 100 kg", min: 0, max: 100 },
    { label: "100–120 kg", min: 100, max: 121 },
    { label: "120 kg & above", min: 121, max: null },
  ] }),
  def("ptype_office_chair", "office_chair_v1", "warranty_years", "Warranty", "integer", "yrs", { pricing: true, filter: "enum" }),

  // --------------------------------- T-SHIRTS --------------------------------
  def("ptype_tshirt", "tshirt_v1", "size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "fit", "Fit", "text", null, { required: true, filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "sleeve", "Sleeve", "text", null, { filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "neck", "Neck", "text", null, { filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "pattern", "Pattern", "text", null, { filter: "enum" }),

  // ------------------------------ RUNNING SHOES ------------------------------
  def("ptype_running_shoes", "running_shoes_v1", "size_uk", "Size (UK)", "integer", null, { required: true, filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "gender", "Gender", "text", null, { required: true, filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "upper_material", "Upper Material", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "sole_material", "Sole Material", "text", null, { filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "use_type", "Use Type", "text", null, { required: true, filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "weight_g", "Weight", "integer", "g", { pricing: true, higherIsBetter: false }),
  def("ptype_running_shoes", "running_shoes_v1", "has_cushioning", "Cushioned Midsole", "boolean", null, { pricing: true, filter: "boolean" }),

  // --------------------------------- PERFUMES --------------------------------
  def("ptype_perfume", "perfume_v1", "volume_ml", "Volume", "integer", "ml", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 50 ml", min: 0, max: 50 },
    { label: "50–100 ml", min: 50, max: 101 },
    { label: "100 ml & above", min: 101, max: null },
  ] }),
  def("ptype_perfume", "perfume_v1", "concentration", "Concentration", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_perfume", "perfume_v1", "fragrance_family", "Fragrance Family", "text", null, { filter: "enum" }),
  def("ptype_perfume", "perfume_v1", "gender", "Gender", "text", null, { required: true, filter: "enum" }),
  def("ptype_perfume", "perfume_v1", "longevity_hours", "Longevity", "integer", "hrs", { pricing: true, filter: "range", buckets: [
    { label: "Under 6 hrs", min: 0, max: 6 },
    { label: "6–9 hrs", min: 6, max: 10 },
    { label: "10 hrs & above", min: 10, max: null },
  ] }),

  // ------------------------------- SMARTWATCHES ------------------------------
  def("ptype_smartwatch", "smartwatch_v1", "display_in", "Display Size", "decimal", "in", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 1.5\"", min: 0, max: 1.5 },
    { label: "1.5\"–1.8\"", min: 1.5, max: 1.81 },
    { label: "1.8\" & above", min: 1.81, max: null },
  ] }),
  def("ptype_smartwatch", "smartwatch_v1", "display_type", "Display Type", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_smartwatch", "smartwatch_v1", "battery_days", "Battery Life", "integer", "days", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 5 days", min: 0, max: 5 },
    { label: "5–9 days", min: 5, max: 10 },
    { label: "10 days & above", min: 10, max: null },
  ] }),
  def("ptype_smartwatch", "smartwatch_v1", "has_gps", "Built-in GPS", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_smartwatch", "smartwatch_v1", "has_calling", "Bluetooth Calling", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_smartwatch", "smartwatch_v1", "water_resistance", "Water Resistance", "text", null, { filter: "enum" }),
];

export function getAttributeDefinitions(productTypeId, schemaVersion) {
  return attributeDefinitions.filter(
    (a) => a.productTypeId === productTypeId && (schemaVersion == null || a.schemaVersion === schemaVersion)
  );
}

/** The subset the catalogue turns into filter facets, in registry order. */
export function getFilterableAttributes(productTypeId) {
  return attributeDefinitions.filter((a) => a.productTypeId === productTypeId && a.isFilterable);
}

/** The subset the recommendation engine scores product strength on. */
export function getPricingRelevantAttributes(productTypeId) {
  return attributeDefinitions.filter((a) => a.productTypeId === productTypeId && a.isPricingRelevant);
}
