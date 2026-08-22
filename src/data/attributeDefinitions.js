// The category attribute schema registry.
//
// Governs which spec keys are legal for a given product type, at a given schema
// version — and, critically for the catalogue, WHICH of those specs are
// filterable and HOW. The filter sidebar is generated from these rows, so a new
// product type gets working, correctly-typed filters from a data insert alone.
// No filter is hardcoded in the UI.
//
// THIS FILE IS THE PROOF THAT THE MODEL GENERALISES.
// 125 product types share no common attribute. A Refrigerator has `capacity_l`
// and `star_rating`; a Saree has `fabric` and `saree_length_m`; a bag of Dog
// Food has `life_stage` and `pack_weight_kg`; a Pen has `tip_size_mm`. Nothing
// in the pricing engine, the catalogue service or the UI knows any of those
// names — they read this registry. Adding a 126th product type is a data
// insert, never a migration.
//
// Fields beyond the base schema:
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

// ---------------------------------------------------------------------------
// Reusable bucket sets. Shared where the semantics genuinely match, never
// merely because two numbers look similar.
// ---------------------------------------------------------------------------
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

const WATTAGE_BUCKETS = [
  { label: "Under 500 W", min: 0, max: 500 },
  { label: "500–999 W", min: 500, max: 1000 },
  { label: "1000 W & above", min: 1000, max: null },
];

const APPAREL_SIZE = ["XS", "S", "M", "L", "XL", "XXL"];

const PACK_WEIGHT_BUCKETS = [
  { label: "Under 500 g", min: 0, max: 0.5 },
  { label: "500 g – 1 kg", min: 0.5, max: 1.01 },
  { label: "1–5 kg", min: 1.01, max: 5.01 },
  { label: "5 kg & above", min: 5.01, max: null },
];

const rows = [];
const add = (...defs) => rows.push(...defs);

// =========================== ELECTRONICS ===================================

add(
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
);

add(
  def("ptype_tablet", "tablet_v1", "display_in", "Display Size", "decimal", "in", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 9\"", min: 0, max: 9 },
    { label: "9\"–11\"", min: 9, max: 11.1 },
    { label: "11\" & above", min: 11.1, max: null },
  ] }),
  def("ptype_tablet", "tablet_v1", "ram_gb", "RAM", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: RAM_BUCKETS }),
  def("ptype_tablet", "tablet_v1", "storage_gb", "Storage", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: STORAGE_BUCKETS }),
  def("ptype_tablet", "tablet_v1", "battery_mah", "Battery", "integer", "mAh", { pricing: true }),
  def("ptype_tablet", "tablet_v1", "has_cellular", "Cellular (SIM)", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_tablet", "tablet_v1", "os", "Operating System", "text", null, { filter: "enum" }),
);

add(
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
);

add(
  def("ptype_phone_case", "phone_case_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_phone_case", "phone_case_v1", "case_type", "Case Type", "text", null, { required: true, filter: "enum" }),
  def("ptype_phone_case", "phone_case_v1", "compatible_model", "Compatible Model", "text", null, { required: true, filter: "enum" }),
  def("ptype_phone_case", "phone_case_v1", "has_camera_protection", "Raised Camera Bezel", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_charging_cable", "charging_cable_v1", "connector_type", "Connector", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_charging_cable", "charging_cable_v1", "length_m", "Length", "decimal", "m", { required: true, pricing: true, filter: "enum" }),
  def("ptype_charging_cable", "charging_cable_v1", "max_watt", "Max Power", "integer", "W", { pricing: true, filter: "range", buckets: [
    { label: "Under 30 W", min: 0, max: 30 },
    { label: "30–65 W", min: 30, max: 66 },
    { label: "65 W & above", min: 66, max: null },
  ] }),
  def("ptype_charging_cable", "charging_cable_v1", "is_braided", "Braided", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
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
);

add(
  def("ptype_gaming_laptop", "gaming_laptop_v1", "ram_gb", "RAM", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: RAM_BUCKETS }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "storage_gb", "Storage", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: STORAGE_BUCKETS }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "processor", "Processor", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "gpu", "Graphics Card", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "refresh_rate_hz", "Refresh Rate", "integer", "Hz", { required: true, pricing: true, filter: "enum" }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "display_in", "Screen Size", "decimal", "in", { filter: "enum" }),
  def("ptype_gaming_laptop", "gaming_laptop_v1", "weight_kg", "Weight", "decimal", "kg", { pricing: true, higherIsBetter: false }),
);

add(
  def("ptype_monitor", "monitor_v1", "screen_size_in", "Screen Size", "decimal", "in", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 24\"", min: 0, max: 24 },
    { label: "24\"–27\"", min: 24, max: 27.1 },
    { label: "28\" & above", min: 27.1, max: null },
  ] }),
  def("ptype_monitor", "monitor_v1", "resolution", "Resolution", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_monitor", "monitor_v1", "refresh_rate_hz", "Refresh Rate", "integer", "Hz", { required: true, pricing: true, filter: "enum" }),
  def("ptype_monitor", "monitor_v1", "panel_type", "Panel Type", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_monitor", "monitor_v1", "response_time_ms", "Response Time", "integer", "ms", { pricing: true, higherIsBetter: false }),
);

add(
  def("ptype_keyboard", "keyboard_v1", "connectivity", "Connectivity", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_keyboard", "keyboard_v1", "switch_type", "Switch Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_keyboard", "keyboard_v1", "layout", "Layout", "text", null, { filter: "enum" }),
  def("ptype_keyboard", "keyboard_v1", "has_backlight", "Backlit", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_mouse", "mouse_v1", "connectivity", "Connectivity", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_mouse", "mouse_v1", "dpi", "Max DPI", "integer", null, { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 4000", min: 0, max: 4000 },
    { label: "4000–12000", min: 4000, max: 12001 },
    { label: "12000 & above", min: 12001, max: null },
  ] }),
  def("ptype_mouse", "mouse_v1", "buttons", "Buttons", "integer", null, { filter: "enum" }),
  def("ptype_mouse", "mouse_v1", "is_rechargeable", "Rechargeable", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_printer", "printer_v1", "print_technology", "Technology", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_printer", "printer_v1", "is_colour", "Colour Printing", "boolean", null, { required: true, pricing: true, filter: "boolean" }),
  def("ptype_printer", "printer_v1", "pages_per_min", "Print Speed", "integer", "ppm", { pricing: true, filter: "range", buckets: [
    { label: "Under 15 ppm", min: 0, max: 15 },
    { label: "15–25 ppm", min: 15, max: 26 },
    { label: "26 ppm & above", min: 26, max: null },
  ] }),
  def("ptype_printer", "printer_v1", "has_wifi", "Wi-Fi", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_printer", "printer_v1", "has_duplex", "Auto Duplex", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_external_ssd", "external_ssd_v1", "capacity_gb", "Capacity", "integer", "GB", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Up to 500 GB", min: 0, max: 501 },
    { label: "1 TB", min: 1000, max: 1025 },
    { label: "2 TB & above", min: 1025, max: null },
  ] }),
  def("ptype_external_ssd", "external_ssd_v1", "read_speed_mbps", "Read Speed", "integer", "MB/s", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 550 MB/s", min: 0, max: 550 },
    { label: "550–1050 MB/s", min: 550, max: 1051 },
    { label: "1050 MB/s & above", min: 1051, max: null },
  ] }),
  def("ptype_external_ssd", "external_ssd_v1", "interface", "Interface", "text", null, { filter: "enum" }),
  def("ptype_external_ssd", "external_ssd_v1", "is_rugged", "Shock Resistant", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
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
);

add(
  def("ptype_headphones", "headphones_v1", "battery_life_hours", "Battery Life", "integer", "hrs", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 30 hrs", min: 0, max: 30 },
    { label: "30–49 hrs", min: 30, max: 50 },
    { label: "50 hrs & above", min: 50, max: null },
  ] }),
  def("ptype_headphones", "headphones_v1", "has_anc", "Active Noise Cancellation", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_headphones", "headphones_v1", "driver_size_mm", "Driver Size", "integer", "mm", { pricing: true, filter: "enum" }),
  def("ptype_headphones", "headphones_v1", "connectivity", "Connectivity", "text", null, { filter: "enum" }),
  def("ptype_headphones", "headphones_v1", "weight_g", "Weight", "integer", "g", { pricing: true, higherIsBetter: false }),
);

add(
  def("ptype_neckband", "neckband_v1", "battery_life_hours", "Battery Life", "integer", "hrs", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 20 hrs", min: 0, max: 20 },
    { label: "20–40 hrs", min: 20, max: 41 },
    { label: "40 hrs & above", min: 41, max: null },
  ] }),
  def("ptype_neckband", "neckband_v1", "driver_size_mm", "Driver Size", "integer", "mm", { pricing: true, filter: "enum" }),
  def("ptype_neckband", "neckband_v1", "has_anc", "Noise Cancellation", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_neckband", "neckband_v1", "water_resistance", "Water Resistance", "text", null, { filter: "enum" }),
);

add(
  def("ptype_bluetooth_speaker", "bluetooth_speaker_v1", "output_w", "Output Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 10 W", min: 0, max: 10 },
    { label: "10–30 W", min: 10, max: 31 },
    { label: "30 W & above", min: 31, max: null },
  ] }),
  def("ptype_bluetooth_speaker", "bluetooth_speaker_v1", "battery_life_hours", "Battery Life", "integer", "hrs", { required: true, pricing: true }),
  def("ptype_bluetooth_speaker", "bluetooth_speaker_v1", "water_resistance", "Water Resistance", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_bluetooth_speaker", "bluetooth_speaker_v1", "has_mic", "Built-in Mic", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_soundbar", "soundbar_v1", "output_w", "Output Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 100 W", min: 0, max: 100 },
    { label: "100–300 W", min: 100, max: 301 },
    { label: "300 W & above", min: 301, max: null },
  ] }),
  def("ptype_soundbar", "soundbar_v1", "channels", "Channel Configuration", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_soundbar", "soundbar_v1", "has_subwoofer", "Wireless Subwoofer", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_soundbar", "soundbar_v1", "has_dolby", "Dolby Audio", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
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
);

add(
  def("ptype_streaming_device", "streaming_device_v1", "max_resolution", "Max Resolution", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_streaming_device", "streaming_device_v1", "has_voice_remote", "Voice Remote", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_streaming_device", "streaming_device_v1", "storage_gb", "Storage", "integer", "GB", { pricing: true }),
  def("ptype_streaming_device", "streaming_device_v1", "platform", "Platform", "text", null, { filter: "enum" }),
);

add(
  def("ptype_action_camera", "action_camera_v1", "video_resolution", "Max Video", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_action_camera", "action_camera_v1", "photo_mp", "Photo Resolution", "integer", "MP", { pricing: true }),
  def("ptype_action_camera", "action_camera_v1", "has_stabilisation", "Image Stabilisation", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_action_camera", "action_camera_v1", "waterproof_m", "Waterproof Depth", "integer", "m", { pricing: true }),
);

// ========================== HOME & KITCHEN =================================

add(
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
);

add(
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
);

add(
  def("ptype_air_conditioner", "air_conditioner_v1", "capacity_ton", "Capacity", "decimal", "ton", { required: true, pricing: true, filter: "enum" }),
  def("ptype_air_conditioner", "air_conditioner_v1", "star_rating", "Energy Rating", "integer", "star", { required: true, pricing: true, filter: "enum" }),
  def("ptype_air_conditioner", "air_conditioner_v1", "ac_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_air_conditioner", "air_conditioner_v1", "has_inverter", "Inverter", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_air_conditioner", "air_conditioner_v1", "coil_material", "Coil Material", "text", null, { filter: "enum" }),
);

add(
  def("ptype_microwave", "microwave_v1", "capacity_l", "Capacity", "integer", "L", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 20 L", min: 0, max: 20 },
    { label: "20–25 L", min: 20, max: 26 },
    { label: "26 L & above", min: 26, max: null },
  ] }),
  def("ptype_microwave", "microwave_v1", "oven_type", "Oven Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_microwave", "microwave_v1", "power_w", "Power", "integer", "W", { pricing: true, filter: "enum" }),
  def("ptype_microwave", "microwave_v1", "has_auto_cook", "Auto-Cook Menu", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_mixer_grinder", "mixer_grinder_v1", "power_w", "Motor Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 600 W", min: 0, max: 600 },
    { label: "600–749 W", min: 600, max: 750 },
    { label: "750 W & above", min: 750, max: null },
  ] }),
  def("ptype_mixer_grinder", "mixer_grinder_v1", "jars", "Number of Jars", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_mixer_grinder", "mixer_grinder_v1", "speed_settings", "Speed Settings", "integer", null, { filter: "enum" }),
  def("ptype_mixer_grinder", "mixer_grinder_v1", "warranty_years", "Warranty", "integer", "yrs", { pricing: true, filter: "enum" }),
);

add(
  def("ptype_electric_kettle", "electric_kettle_v1", "capacity_l", "Capacity", "decimal", "L", { required: true, pricing: true, filter: "enum" }),
  def("ptype_electric_kettle", "electric_kettle_v1", "power_w", "Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: WATTAGE_BUCKETS }),
  def("ptype_electric_kettle", "electric_kettle_v1", "body_material", "Body Material", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_electric_kettle", "electric_kettle_v1", "has_auto_shutoff", "Auto Shut-off", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_induction_cooktop", "induction_cooktop_v1", "power_w", "Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: WATTAGE_BUCKETS }),
  def("ptype_induction_cooktop", "induction_cooktop_v1", "preset_menus", "Preset Menus", "integer", null, { pricing: true, filter: "enum" }),
  def("ptype_induction_cooktop", "induction_cooktop_v1", "panel_type", "Panel Type", "text", null, { filter: "enum" }),
  def("ptype_induction_cooktop", "induction_cooktop_v1", "has_timer", "Timer", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_air_fryer", "air_fryer_v1", "capacity_l", "Capacity", "decimal", "L", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 3 L", min: 0, max: 3 },
    { label: "3–5 L", min: 3, max: 5.1 },
    { label: "5 L & above", min: 5.1, max: null },
  ] }),
  def("ptype_air_fryer", "air_fryer_v1", "power_w", "Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: WATTAGE_BUCKETS }),
  def("ptype_air_fryer", "air_fryer_v1", "has_digital_display", "Digital Display", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_air_fryer", "air_fryer_v1", "max_temp_c", "Max Temperature", "integer", "°C", { pricing: true }),
);

add(
  def("ptype_water_purifier", "water_purifier_v1", "purification_type", "Purification", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_water_purifier", "water_purifier_v1", "capacity_l", "Storage Capacity", "decimal", "L", { required: true, pricing: true, filter: "enum" }),
  def("ptype_water_purifier", "water_purifier_v1", "has_uv", "UV Sterilisation", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_water_purifier", "water_purifier_v1", "filter_life_l", "Filter Life", "integer", "L", { pricing: true }),
);

add(
  def("ptype_gas_stove", "gas_stove_v1", "burners", "Burners", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_gas_stove", "gas_stove_v1", "body_material", "Body Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_gas_stove", "gas_stove_v1", "has_auto_ignition", "Auto Ignition", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_gas_stove", "gas_stove_v1", "burner_type", "Burner Type", "text", null, { filter: "enum" }),
);

add(
  def("ptype_pressure_cooker", "pressure_cooker_v1", "capacity_l", "Capacity", "decimal", "L", { required: true, pricing: true, filter: "enum" }),
  def("ptype_pressure_cooker", "pressure_cooker_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_pressure_cooker", "pressure_cooker_v1", "is_induction_compatible", "Induction Base", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_pressure_cooker", "pressure_cooker_v1", "lid_type", "Lid Type", "text", null, { filter: "enum" }),
);

add(
  def("ptype_cookware_set", "cookware_set_v1", "pieces", "Pieces", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_cookware_set", "cookware_set_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_cookware_set", "cookware_set_v1", "coating", "Coating", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_cookware_set", "cookware_set_v1", "is_induction_compatible", "Induction Base", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_dinner_set", "dinner_set_v1", "pieces", "Pieces", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_dinner_set", "dinner_set_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_dinner_set", "dinner_set_v1", "is_microwave_safe", "Microwave Safe", "boolean", null, { filter: "boolean" }),
  def("ptype_dinner_set", "dinner_set_v1", "is_dishwasher_safe", "Dishwasher Safe", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_ceiling_fan", "ceiling_fan_v1", "sweep_mm", "Sweep Size", "integer", "mm", { required: true, pricing: true, filter: "enum" }),
  def("ptype_ceiling_fan", "ceiling_fan_v1", "power_w", "Power Consumption", "integer", "W", { required: true, pricing: true, higherIsBetter: false }),
  def("ptype_ceiling_fan", "ceiling_fan_v1", "is_bldc", "BLDC Motor", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_ceiling_fan", "ceiling_fan_v1", "speed_rpm", "Speed", "integer", "RPM", { pricing: true }),
);

add(
  def("ptype_air_cooler", "air_cooler_v1", "tank_capacity_l", "Tank Capacity", "integer", "L", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 30 L", min: 0, max: 30 },
    { label: "30–60 L", min: 30, max: 61 },
    { label: "60 L & above", min: 61, max: null },
  ] }),
  def("ptype_air_cooler", "air_cooler_v1", "cooler_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_air_cooler", "air_cooler_v1", "air_throw_ft", "Air Throw", "integer", "ft", { pricing: true }),
  def("ptype_air_cooler", "air_cooler_v1", "has_remote", "Remote Control", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_vacuum_cleaner", "vacuum_cleaner_v1", "power_w", "Suction Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: WATTAGE_BUCKETS }),
  def("ptype_vacuum_cleaner", "vacuum_cleaner_v1", "vacuum_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_vacuum_cleaner", "vacuum_cleaner_v1", "is_cordless", "Cordless", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_vacuum_cleaner", "vacuum_cleaner_v1", "dust_capacity_l", "Dust Capacity", "decimal", "L", { pricing: true }),
);

// ========================= HOME & FURNITURE ================================

add(
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
);

add(
  def("ptype_sofa", "sofa_v1", "seater", "Seating Capacity", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_sofa", "sofa_v1", "upholstery", "Upholstery", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_sofa", "sofa_v1", "frame_material", "Frame Material", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_sofa", "sofa_v1", "is_convertible", "Convertible", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_mattress", "mattress_v1", "thickness_in", "Thickness", "integer", "in", { required: true, pricing: true, filter: "enum" }),
  def("ptype_mattress", "mattress_v1", "mattress_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_mattress", "mattress_v1", "size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_mattress", "mattress_v1", "firmness", "Firmness", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_mattress", "mattress_v1", "warranty_years", "Warranty", "integer", "yrs", { pricing: true, filter: "enum" }),
);

add(
  def("ptype_bed", "bed_v1", "size", "Size", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_bed", "bed_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_bed", "bed_v1", "has_storage", "Storage", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_bed", "bed_v1", "finish", "Finish", "text", null, { filter: "enum" }),
);

add(
  def("ptype_wardrobe", "wardrobe_v1", "doors", "Doors", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_wardrobe", "wardrobe_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_wardrobe", "wardrobe_v1", "has_mirror", "Mirror", "boolean", null, { filter: "boolean" }),
  def("ptype_wardrobe", "wardrobe_v1", "width_cm", "Width", "integer", "cm", { pricing: true }),
);

add(
  def("ptype_study_table", "study_table_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_study_table", "study_table_v1", "has_storage", "Storage Shelves", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_study_table", "study_table_v1", "width_cm", "Width", "integer", "cm", { pricing: true }),
  def("ptype_study_table", "study_table_v1", "is_foldable", "Foldable", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_bookshelf", "bookshelf_v1", "shelves", "Shelves", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_bookshelf", "bookshelf_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_bookshelf", "bookshelf_v1", "is_wall_mounted", "Wall Mounted", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_bedsheet", "bedsheet_v1", "size", "Size", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_bedsheet", "bedsheet_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_bedsheet", "bedsheet_v1", "thread_count", "Thread Count", "integer", null, { pricing: true, filter: "range", buckets: [
    { label: "Under 200", min: 0, max: 200 },
    { label: "200–400", min: 200, max: 401 },
    { label: "400 & above", min: 401, max: null },
  ] }),
  def("ptype_bedsheet", "bedsheet_v1", "pillow_covers", "Pillow Covers", "integer", null, { filter: "enum" }),
);

add(
  def("ptype_curtain", "curtain_v1", "length_ft", "Length", "integer", "ft", { required: true, pricing: true, filter: "enum" }),
  def("ptype_curtain", "curtain_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_curtain", "curtain_v1", "is_blackout", "Blackout", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_curtain", "curtain_v1", "pack_size", "Pack Size", "integer", null, { pricing: true, filter: "enum" }),
);

// ================================ FASHION ==================================
// Apparel is where a numeric-only similarity model falls apart: almost every
// attribute here is categorical, which is exactly why specSimilarity had to
// learn to compare text.

add(
  def("ptype_tshirt", "tshirt_v1", "size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "fit", "Fit", "text", null, { required: true, filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "sleeve", "Sleeve", "text", null, { filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "neck", "Neck", "text", null, { filter: "enum" }),
  def("ptype_tshirt", "tshirt_v1", "pattern", "Pattern", "text", null, { filter: "enum" }),
);

add(
  def("ptype_casual_shirt", "casual_shirt_v1", "size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_casual_shirt", "casual_shirt_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_casual_shirt", "casual_shirt_v1", "fit", "Fit", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_casual_shirt", "casual_shirt_v1", "sleeve", "Sleeve", "text", null, { filter: "enum" }),
  def("ptype_casual_shirt", "casual_shirt_v1", "pattern", "Pattern", "text", null, { filter: "enum" }),
);

add(
  def("ptype_formal_shirt", "formal_shirt_v1", "size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_formal_shirt", "formal_shirt_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_formal_shirt", "formal_shirt_v1", "fit", "Fit", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_formal_shirt", "formal_shirt_v1", "is_wrinkle_free", "Wrinkle Free", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_formal_shirt", "formal_shirt_v1", "collar_type", "Collar", "text", null, { filter: "enum" }),
);

add(
  def("ptype_jeans", "jeans_v1", "waist_in", "Waist", "integer", "in", { required: true, filter: "enum" }),
  def("ptype_jeans", "jeans_v1", "fit", "Fit", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_jeans", "jeans_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_jeans", "jeans_v1", "wash", "Wash", "text", null, { filter: "enum" }),
  def("ptype_jeans", "jeans_v1", "is_stretchable", "Stretchable", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_trousers", "trousers_v1", "waist_in", "Waist", "integer", "in", { required: true, filter: "enum" }),
  def("ptype_trousers", "trousers_v1", "fit", "Fit", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_trousers", "trousers_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_trousers", "trousers_v1", "occasion", "Occasion", "text", null, { filter: "enum" }),
);

add(
  def("ptype_kurta", "kurta_v1", "size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_kurta", "kurta_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_kurta", "kurta_v1", "sleeve", "Sleeve", "text", null, { filter: "enum" }),
  def("ptype_kurta", "kurta_v1", "occasion", "Occasion", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_kurta", "kurta_v1", "pattern", "Pattern", "text", null, { filter: "enum" }),
);

add(
  def("ptype_kurti", "kurti_v1", "size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_kurti", "kurti_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_kurti", "kurti_v1", "kurti_length", "Length", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_kurti", "kurti_v1", "occasion", "Occasion", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_kurti", "kurti_v1", "pattern", "Pattern", "text", null, { filter: "enum" }),
);

add(
  def("ptype_saree", "saree_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_saree", "saree_v1", "saree_length_m", "Length", "decimal", "m", { required: true, filter: "enum" }),
  def("ptype_saree", "saree_v1", "occasion", "Occasion", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_saree", "saree_v1", "has_blouse_piece", "Blouse Piece", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_saree", "saree_v1", "work_type", "Work", "text", null, { pricing: true, filter: "enum" }),
);

add(
  def("ptype_dress", "dress_v1", "size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_dress", "dress_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_dress", "dress_v1", "dress_length", "Length", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_dress", "dress_v1", "occasion", "Occasion", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_dress", "dress_v1", "pattern", "Pattern", "text", null, { filter: "enum" }),
);

add(
  def("ptype_leggings", "leggings_v1", "size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_leggings", "leggings_v1", "fabric", "Fabric", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_leggings", "leggings_v1", "waist_type", "Waist", "text", null, { filter: "enum" }),
  def("ptype_leggings", "leggings_v1", "pack_size", "Pack Size", "integer", null, { pricing: true, filter: "enum" }),
);

add(
  def("ptype_running_shoes", "running_shoes_v1", "size_uk", "Size (UK)", "integer", null, { required: true, filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "gender", "Gender", "text", null, { required: true, filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "upper_material", "Upper Material", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "sole_material", "Sole Material", "text", null, { filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "use_type", "Use Type", "text", null, { required: true, filter: "enum" }),
  def("ptype_running_shoes", "running_shoes_v1", "weight_g", "Weight", "integer", "g", { pricing: true, higherIsBetter: false }),
  def("ptype_running_shoes", "running_shoes_v1", "has_cushioning", "Cushioned Midsole", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_sneakers", "sneakers_v1", "size_uk", "Size (UK)", "integer", null, { required: true, filter: "enum" }),
  def("ptype_sneakers", "sneakers_v1", "gender", "Gender", "text", null, { required: true, filter: "enum" }),
  def("ptype_sneakers", "sneakers_v1", "upper_material", "Upper Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_sneakers", "sneakers_v1", "closure", "Closure", "text", null, { filter: "enum" }),
  def("ptype_sneakers", "sneakers_v1", "sole_material", "Sole Material", "text", null, { pricing: true, filter: "enum" }),
);

add(
  def("ptype_formal_shoes", "formal_shoes_v1", "size_uk", "Size (UK)", "integer", null, { required: true, filter: "enum" }),
  def("ptype_formal_shoes", "formal_shoes_v1", "upper_material", "Upper Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_formal_shoes", "formal_shoes_v1", "closure", "Closure", "text", null, { filter: "enum" }),
  def("ptype_formal_shoes", "formal_shoes_v1", "toe_shape", "Toe Shape", "text", null, { filter: "enum" }),
  def("ptype_formal_shoes", "formal_shoes_v1", "is_genuine_leather", "Genuine Leather", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_sandals", "sandals_v1", "size_uk", "Size (UK)", "integer", null, { required: true, filter: "enum" }),
  def("ptype_sandals", "sandals_v1", "gender", "Gender", "text", null, { required: true, filter: "enum" }),
  def("ptype_sandals", "sandals_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_sandals", "sandals_v1", "closure", "Closure", "text", null, { filter: "enum" }),
);

add(
  def("ptype_backpack", "backpack_v1", "capacity_l", "Capacity", "integer", "L", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 20 L", min: 0, max: 20 },
    { label: "20–35 L", min: 20, max: 36 },
    { label: "35 L & above", min: 36, max: null },
  ] }),
  def("ptype_backpack", "backpack_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_backpack", "backpack_v1", "has_laptop_sleeve", "Laptop Sleeve", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_backpack", "backpack_v1", "is_water_resistant", "Water Resistant", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_backpack", "backpack_v1", "compartments", "Compartments", "integer", null, { filter: "enum" }),
);

add(
  def("ptype_handbag", "handbag_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_handbag", "handbag_v1", "bag_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_handbag", "handbag_v1", "closure", "Closure", "text", null, { filter: "enum" }),
  def("ptype_handbag", "handbag_v1", "compartments", "Compartments", "integer", null, { filter: "enum" }),
);

add(
  def("ptype_wallet", "wallet_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_wallet", "wallet_v1", "card_slots", "Card Slots", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_wallet", "wallet_v1", "has_rfid_block", "RFID Blocking", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_wallet", "wallet_v1", "wallet_type", "Type", "text", null, { filter: "enum" }),
);

add(
  def("ptype_sunglasses", "sunglasses_v1", "frame_shape", "Frame Shape", "text", null, { required: true, filter: "enum" }),
  def("ptype_sunglasses", "sunglasses_v1", "frame_material", "Frame Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_sunglasses", "sunglasses_v1", "is_polarised", "Polarised", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_sunglasses", "sunglasses_v1", "uv_protection", "UV Protection", "text", null, { pricing: true, filter: "enum" }),
);

// ====================== BEAUTY & PERSONAL CARE =============================

add(
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
);

add(
  def("ptype_deodorant", "deodorant_v1", "volume_ml", "Volume", "integer", "ml", { required: true, pricing: true, filter: "enum" }),
  def("ptype_deodorant", "deodorant_v1", "gender", "Gender", "text", null, { required: true, filter: "enum" }),
  def("ptype_deodorant", "deodorant_v1", "form", "Form", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_deodorant", "deodorant_v1", "is_alcohol_free", "Alcohol Free", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_face_wash", "face_wash_v1", "volume_ml", "Volume", "integer", "ml", { required: true, pricing: true, filter: "enum" }),
  def("ptype_face_wash", "face_wash_v1", "skin_type", "Skin Type", "text", null, { required: true, filter: "enum" }),
  def("ptype_face_wash", "face_wash_v1", "key_ingredient", "Key Ingredient", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_face_wash", "face_wash_v1", "is_sulphate_free", "Sulphate Free", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_moisturiser", "moisturiser_v1", "volume_ml", "Volume", "integer", "ml", { required: true, pricing: true, filter: "enum" }),
  def("ptype_moisturiser", "moisturiser_v1", "skin_type", "Skin Type", "text", null, { required: true, filter: "enum" }),
  def("ptype_moisturiser", "moisturiser_v1", "key_ingredient", "Key Ingredient", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_moisturiser", "moisturiser_v1", "texture", "Texture", "text", null, { filter: "enum" }),
);

add(
  def("ptype_sunscreen", "sunscreen_v1", "spf", "SPF", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_sunscreen", "sunscreen_v1", "volume_ml", "Volume", "integer", "ml", { required: true, pricing: true, filter: "enum" }),
  def("ptype_sunscreen", "sunscreen_v1", "skin_type", "Skin Type", "text", null, { filter: "enum" }),
  def("ptype_sunscreen", "sunscreen_v1", "is_water_resistant", "Water Resistant", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_face_serum", "face_serum_v1", "volume_ml", "Volume", "integer", "ml", { required: true, pricing: true, filter: "enum" }),
  def("ptype_face_serum", "face_serum_v1", "key_ingredient", "Key Ingredient", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_face_serum", "face_serum_v1", "concentration_pct", "Concentration", "decimal", "%", { pricing: true }),
  def("ptype_face_serum", "face_serum_v1", "skin_concern", "Skin Concern", "text", null, { filter: "enum" }),
);

add(
  def("ptype_lipstick", "lipstick_v1", "finish", "Finish", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_lipstick", "lipstick_v1", "shade_family", "Shade Family", "text", null, { required: true, filter: "enum" }),
  def("ptype_lipstick", "lipstick_v1", "weight_g", "Weight", "decimal", "g", { pricing: true }),
  def("ptype_lipstick", "lipstick_v1", "is_transfer_proof", "Transfer Proof", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_foundation", "foundation_v1", "coverage", "Coverage", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_foundation", "foundation_v1", "finish", "Finish", "text", null, { required: true, filter: "enum" }),
  def("ptype_foundation", "foundation_v1", "volume_ml", "Volume", "integer", "ml", { pricing: true }),
  def("ptype_foundation", "foundation_v1", "has_spf", "Contains SPF", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_shampoo", "shampoo_v1", "volume_ml", "Volume", "integer", "ml", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 200 ml", min: 0, max: 200 },
    { label: "200–400 ml", min: 200, max: 401 },
    { label: "400 ml & above", min: 401, max: null },
  ] }),
  def("ptype_shampoo", "shampoo_v1", "hair_type", "Hair Type", "text", null, { required: true, filter: "enum" }),
  def("ptype_shampoo", "shampoo_v1", "key_ingredient", "Key Ingredient", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_shampoo", "shampoo_v1", "is_sulphate_free", "Sulphate Free", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_hair_oil", "hair_oil_v1", "volume_ml", "Volume", "integer", "ml", { required: true, pricing: true, filter: "enum" }),
  def("ptype_hair_oil", "hair_oil_v1", "base_oil", "Base Oil", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_hair_oil", "hair_oil_v1", "hair_concern", "Hair Concern", "text", null, { filter: "enum" }),
  def("ptype_hair_oil", "hair_oil_v1", "is_mineral_oil_free", "Mineral Oil Free", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_hair_dryer", "hair_dryer_v1", "power_w", "Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: WATTAGE_BUCKETS }),
  def("ptype_hair_dryer", "hair_dryer_v1", "heat_settings", "Heat Settings", "integer", null, { pricing: true, filter: "enum" }),
  def("ptype_hair_dryer", "hair_dryer_v1", "has_cool_shot", "Cool Shot", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_hair_dryer", "hair_dryer_v1", "is_foldable", "Foldable", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_trimmer", "trimmer_v1", "runtime_min", "Runtime", "integer", "min", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 60 min", min: 0, max: 60 },
    { label: "60–120 min", min: 60, max: 121 },
    { label: "120 min & above", min: 121, max: null },
  ] }),
  def("ptype_trimmer", "trimmer_v1", "length_settings", "Length Settings", "integer", null, { pricing: true, filter: "enum" }),
  def("ptype_trimmer", "trimmer_v1", "is_waterproof", "Washable", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_trimmer", "trimmer_v1", "blade_material", "Blade Material", "text", null, { filter: "enum" }),
);

// ========================== SPORTS & FITNESS ===============================

add(
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
);

add(
  def("ptype_fitness_band", "fitness_band_v1", "display_in", "Display Size", "decimal", "in", { required: true, pricing: true, filter: "enum" }),
  def("ptype_fitness_band", "fitness_band_v1", "battery_days", "Battery Life", "integer", "days", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 10 days", min: 0, max: 10 },
    { label: "10–15 days", min: 10, max: 16 },
    { label: "15 days & above", min: 16, max: null },
  ] }),
  def("ptype_fitness_band", "fitness_band_v1", "has_spo2", "SpO2 Monitor", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_fitness_band", "fitness_band_v1", "water_resistance", "Water Resistance", "text", null, { filter: "enum" }),
);

add(
  def("ptype_yoga_mat", "yoga_mat_v1", "thickness_mm", "Thickness", "integer", "mm", { required: true, pricing: true, filter: "enum" }),
  def("ptype_yoga_mat", "yoga_mat_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_yoga_mat", "yoga_mat_v1", "length_cm", "Length", "integer", "cm", { filter: "enum" }),
  def("ptype_yoga_mat", "yoga_mat_v1", "is_anti_slip", "Anti-Slip", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_dumbbell", "dumbbell_v1", "weight_kg", "Weight (per piece)", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 5 kg", min: 0, max: 5 },
    { label: "5–10 kg", min: 5, max: 10.1 },
    { label: "10 kg & above", min: 10.1, max: null },
  ] }),
  def("ptype_dumbbell", "dumbbell_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_dumbbell", "dumbbell_v1", "is_adjustable", "Adjustable", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_dumbbell", "dumbbell_v1", "pack_size", "Pack Size", "integer", null, { pricing: true, filter: "enum" }),
);

add(
  def("ptype_treadmill", "treadmill_v1", "motor_hp", "Motor Power", "decimal", "HP", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 2 HP", min: 0, max: 2 },
    { label: "2–4 HP", min: 2, max: 4.1 },
    { label: "4 HP & above", min: 4.1, max: null },
  ] }),
  def("ptype_treadmill", "treadmill_v1", "max_speed_kmph", "Max Speed", "integer", "km/h", { required: true, pricing: true }),
  def("ptype_treadmill", "treadmill_v1", "max_user_weight_kg", "Max User Weight", "integer", "kg", { pricing: true }),
  def("ptype_treadmill", "treadmill_v1", "is_foldable", "Foldable", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_treadmill", "treadmill_v1", "has_incline", "Incline", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_resistance_band", "resistance_band_v1", "resistance_level", "Resistance", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_resistance_band", "resistance_band_v1", "material", "Material", "text", null, { required: true, filter: "enum" }),
  def("ptype_resistance_band", "resistance_band_v1", "pack_size", "Pack Size", "integer", null, { pricing: true, filter: "enum" }),
);

add(
  def("ptype_cricket_bat", "cricket_bat_v1", "willow_type", "Willow", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_cricket_bat", "cricket_bat_v1", "bat_size", "Size", "text", null, { required: true, filter: "enum" }),
  def("ptype_cricket_bat", "cricket_bat_v1", "weight_g", "Weight", "integer", "g", { pricing: true }),
  def("ptype_cricket_bat", "cricket_bat_v1", "is_ready_to_play", "Ready to Play", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_badminton_racket", "badminton_racket_v1", "weight_g", "Weight", "integer", "g", { required: true, pricing: true, higherIsBetter: false }),
  def("ptype_badminton_racket", "badminton_racket_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_badminton_racket", "badminton_racket_v1", "balance", "Balance", "text", null, { filter: "enum" }),
  def("ptype_badminton_racket", "badminton_racket_v1", "max_tension_lbs", "Max String Tension", "integer", "lbs", { pricing: true }),
);

// ========================== GROCERY & GOURMET ==============================
// Grocery is where `pack_weight_kg` does most of the pricing work — a category
// where the single most price-relevant attribute is simply how much you get.

add(
  def("ptype_tea", "tea_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_tea", "tea_v1", "tea_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_tea", "tea_v1", "form", "Form", "text", null, { filter: "enum" }),
  def("ptype_tea", "tea_v1", "is_organic", "Organic", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_coffee", "coffee_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_coffee", "coffee_v1", "coffee_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_coffee", "coffee_v1", "roast", "Roast", "text", null, { filter: "enum" }),
  def("ptype_coffee", "coffee_v1", "is_single_origin", "Single Origin", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_health_drink", "health_drink_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_health_drink", "health_drink_v1", "flavour", "Flavour", "text", null, { filter: "enum" }),
  def("ptype_health_drink", "health_drink_v1", "target_group", "For", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_health_drink", "health_drink_v1", "protein_g_per_serving", "Protein per Serving", "decimal", "g", { pricing: true }),
);

add(
  def("ptype_rice", "rice_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_rice", "rice_v1", "rice_type", "Variety", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_rice", "rice_v1", "grain_length", "Grain", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_rice", "rice_v1", "aging_years", "Aged", "integer", "yrs", { pricing: true }),
);

add(
  def("ptype_cooking_oil", "cooking_oil_v1", "pack_volume_l", "Pack Size", "decimal", "L", { required: true, pricing: true, filter: "enum" }),
  def("ptype_cooking_oil", "cooking_oil_v1", "oil_type", "Oil Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_cooking_oil", "cooking_oil_v1", "extraction", "Extraction", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_cooking_oil", "cooking_oil_v1", "packaging", "Packaging", "text", null, { filter: "enum" }),
);

add(
  def("ptype_spices", "spices_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_spices", "spices_v1", "spice_type", "Spice", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_spices", "spices_v1", "form", "Form", "text", null, { filter: "enum" }),
  def("ptype_spices", "spices_v1", "is_organic", "Organic", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_biscuits", "biscuits_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_biscuits", "biscuits_v1", "biscuit_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_biscuits", "biscuits_v1", "flavour", "Flavour", "text", null, { filter: "enum" }),
  def("ptype_biscuits", "biscuits_v1", "is_sugar_free", "Sugar Free", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_chocolate", "chocolate_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_chocolate", "chocolate_v1", "chocolate_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_chocolate", "chocolate_v1", "cocoa_pct", "Cocoa Content", "integer", "%", { pricing: true }),
  def("ptype_chocolate", "chocolate_v1", "has_nuts", "Contains Nuts", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_dry_fruits", "dry_fruits_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_dry_fruits", "dry_fruits_v1", "nut_type", "Variety", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_dry_fruits", "dry_fruits_v1", "grade", "Grade", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_dry_fruits", "dry_fruits_v1", "is_roasted", "Roasted", "boolean", null, { filter: "boolean" }),
);

// ============================= BABY & KIDS =================================

add(
  def("ptype_diapers", "diapers_v1", "size", "Size", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_diapers", "diapers_v1", "count", "Count", "integer", null, { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 40", min: 0, max: 40 },
    { label: "40–80", min: 40, max: 81 },
    { label: "80 & above", min: 81, max: null },
  ] }),
  def("ptype_diapers", "diapers_v1", "diaper_style", "Style", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_diapers", "diapers_v1", "has_wetness_indicator", "Wetness Indicator", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_baby_wipes", "baby_wipes_v1", "count", "Count", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_baby_wipes", "baby_wipes_v1", "is_fragrance_free", "Fragrance Free", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_baby_wipes", "baby_wipes_v1", "is_alcohol_free", "Alcohol Free", "boolean", null, { filter: "boolean" }),
  def("ptype_baby_wipes", "baby_wipes_v1", "pack_size", "Pack Size", "integer", null, { pricing: true, filter: "enum" }),
);

add(
  def("ptype_baby_food", "baby_food_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_baby_food", "baby_food_v1", "stage", "Stage", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_baby_food", "baby_food_v1", "flavour", "Flavour", "text", null, { filter: "enum" }),
  def("ptype_baby_food", "baby_food_v1", "is_organic", "Organic", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_feeding_bottle", "feeding_bottle_v1", "capacity_ml", "Capacity", "integer", "ml", { required: true, pricing: true, filter: "enum" }),
  def("ptype_feeding_bottle", "feeding_bottle_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_feeding_bottle", "feeding_bottle_v1", "is_bpa_free", "BPA Free", "boolean", null, { filter: "boolean" }),
  def("ptype_feeding_bottle", "feeding_bottle_v1", "flow_rate", "Flow Rate", "text", null, { filter: "enum" }),
);

add(
  def("ptype_stroller", "stroller_v1", "max_weight_kg", "Max Child Weight", "integer", "kg", { required: true, pricing: true }),
  def("ptype_stroller", "stroller_v1", "is_foldable", "Foldable", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_stroller", "stroller_v1", "recline_positions", "Recline Positions", "integer", null, { pricing: true, filter: "enum" }),
  def("ptype_stroller", "stroller_v1", "has_reversible_handle", "Reversible Handle", "boolean", null, { pricing: true, filter: "boolean" }),
);

// ========================= BOOKS & STATIONERY ==============================
// Books demonstrate a schema with almost no numeric pricing signal at all —
// page count barely moves price, and `format` (paperback vs hardcover) moves it
// a great deal. A model that assumes numbers drive price learns nothing here.

add(
  def("ptype_fiction_book", "book_v1", "format", "Format", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_fiction_book", "book_v1", "language", "Language", "text", null, { required: true, filter: "enum" }),
  def("ptype_fiction_book", "book_v1", "pages", "Pages", "integer", null, { pricing: true }),
  def("ptype_fiction_book", "book_v1", "genre", "Genre", "text", null, { filter: "enum" }),
);

add(
  def("ptype_nonfiction_book", "book_v1", "format", "Format", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_nonfiction_book", "book_v1", "language", "Language", "text", null, { required: true, filter: "enum" }),
  def("ptype_nonfiction_book", "book_v1", "pages", "Pages", "integer", null, { pricing: true }),
  def("ptype_nonfiction_book", "book_v1", "subject", "Subject", "text", null, { filter: "enum" }),
);

add(
  def("ptype_exam_book", "exam_book_v1", "exam", "Exam", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_exam_book", "exam_book_v1", "format", "Format", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_exam_book", "exam_book_v1", "language", "Language", "text", null, { filter: "enum" }),
  def("ptype_exam_book", "exam_book_v1", "edition_year", "Edition", "integer", null, { pricing: true }),
);

add(
  def("ptype_childrens_book", "book_v1", "format", "Format", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_childrens_book", "book_v1", "age_group", "Age Group", "text", null, { required: true, filter: "enum" }),
  def("ptype_childrens_book", "book_v1", "pages", "Pages", "integer", null, { pricing: true }),
  def("ptype_childrens_book", "book_v1", "is_illustrated", "Illustrated", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_notebook", "notebook_v1", "pages", "Pages", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_notebook", "notebook_v1", "ruling", "Ruling", "text", null, { required: true, filter: "enum" }),
  def("ptype_notebook", "notebook_v1", "binding", "Binding", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_notebook", "notebook_v1", "pack_size", "Pack Size", "integer", null, { pricing: true, filter: "enum" }),
);

add(
  def("ptype_pen", "pen_v1", "pen_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_pen", "pen_v1", "tip_size_mm", "Tip Size", "decimal", "mm", { required: true, filter: "enum" }),
  def("ptype_pen", "pen_v1", "ink_colour", "Ink Colour", "text", null, { filter: "enum" }),
  def("ptype_pen", "pen_v1", "pack_size", "Pack Size", "integer", null, { pricing: true, filter: "enum" }),
);

// ============================== AUTOMOTIVE =================================

add(
  def("ptype_car_care", "car_care_v1", "product_type", "Product", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_car_care", "car_care_v1", "volume_ml", "Volume", "integer", "ml", { required: true, pricing: true, filter: "enum" }),
  def("ptype_car_care", "car_care_v1", "surface", "Surface", "text", null, { filter: "enum" }),
);

add(
  def("ptype_engine_oil", "engine_oil_v1", "volume_l", "Volume", "decimal", "L", { required: true, pricing: true, filter: "enum" }),
  def("ptype_engine_oil", "engine_oil_v1", "grade", "Grade", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_engine_oil", "engine_oil_v1", "oil_base", "Base", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_engine_oil", "engine_oil_v1", "engine_type", "Engine Type", "text", null, { filter: "enum" }),
);

add(
  def("ptype_car_phone_holder", "car_phone_holder_v1", "mount_type", "Mount Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_car_phone_holder", "car_phone_holder_v1", "is_magnetic", "Magnetic", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_car_phone_holder", "car_phone_holder_v1", "has_wireless_charging", "Wireless Charging", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_helmet", "helmet_v1", "helmet_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_helmet", "helmet_v1", "certification", "Certification", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_helmet", "helmet_v1", "shell_material", "Shell Material", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_helmet", "helmet_v1", "size", "Size", "text", null, { filter: "enum" }),
  def("ptype_helmet", "helmet_v1", "weight_g", "Weight", "integer", "g", { pricing: true, higherIsBetter: false }),
);

// ========================== HEALTH & WELLNESS ==============================

add(
  def("ptype_protein_powder", "protein_powder_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_protein_powder", "protein_powder_v1", "protein_type", "Protein Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_protein_powder", "protein_powder_v1", "protein_g_per_serving", "Protein per Serving", "decimal", "g", { required: true, pricing: true }),
  def("ptype_protein_powder", "protein_powder_v1", "flavour", "Flavour", "text", null, { filter: "enum" }),
);

add(
  def("ptype_multivitamin", "multivitamin_v1", "count", "Tablet Count", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_multivitamin", "multivitamin_v1", "form", "Form", "text", null, { required: true, filter: "enum" }),
  def("ptype_multivitamin", "multivitamin_v1", "target_group", "For", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_multivitamin", "multivitamin_v1", "is_vegetarian", "Vegetarian", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_bp_monitor", "bp_monitor_v1", "monitor_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_bp_monitor", "bp_monitor_v1", "memory_readings", "Memory", "integer", null, { pricing: true, filter: "enum" }),
  def("ptype_bp_monitor", "bp_monitor_v1", "has_irregular_heartbeat_detection", "Irregular Heartbeat Detection", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_bp_monitor", "bp_monitor_v1", "users_supported", "User Profiles", "integer", null, { filter: "enum" }),
);

add(
  def("ptype_glucometer", "glucometer_v1", "strips_included", "Strips Included", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_glucometer", "glucometer_v1", "test_time_sec", "Test Time", "integer", "sec", { pricing: true, higherIsBetter: false }),
  def("ptype_glucometer", "glucometer_v1", "memory_readings", "Memory", "integer", null, { pricing: true }),
  def("ptype_glucometer", "glucometer_v1", "sample_size_ul", "Sample Size", "decimal", "µL", { higherIsBetter: false }),
);

add(
  def("ptype_thermometer", "thermometer_v1", "thermometer_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_thermometer", "thermometer_v1", "measurement_time_sec", "Measurement Time", "integer", "sec", { pricing: true, higherIsBetter: false }),
  def("ptype_thermometer", "thermometer_v1", "has_fever_alarm", "Fever Alarm", "boolean", null, { filter: "boolean" }),
);

// ============================= PET SUPPLIES ================================

add(
  def("ptype_dog_food", "dog_food_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_dog_food", "dog_food_v1", "life_stage", "Life Stage", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_dog_food", "dog_food_v1", "food_form", "Form", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_dog_food", "dog_food_v1", "breed_size", "Breed Size", "text", null, { filter: "enum" }),
  def("ptype_dog_food", "dog_food_v1", "is_grain_free", "Grain Free", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_cat_food", "cat_food_v1", "pack_weight_kg", "Pack Size", "decimal", "kg", { required: true, pricing: true, filter: "range", buckets: PACK_WEIGHT_BUCKETS }),
  def("ptype_cat_food", "cat_food_v1", "life_stage", "Life Stage", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_cat_food", "cat_food_v1", "food_form", "Form", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_cat_food", "cat_food_v1", "flavour", "Flavour", "text", null, { filter: "enum" }),
);

add(
  def("ptype_pet_grooming", "pet_grooming_v1", "product_type", "Product", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_pet_grooming", "pet_grooming_v1", "pet_type", "For", "text", null, { required: true, filter: "enum" }),
  def("ptype_pet_grooming", "pet_grooming_v1", "volume_ml", "Volume", "integer", "ml", { pricing: true }),
);

add(
  def("ptype_pet_toy", "pet_toy_v1", "toy_type", "Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_pet_toy", "pet_toy_v1", "pet_type", "For", "text", null, { required: true, filter: "enum" }),
  def("ptype_pet_toy", "pet_toy_v1", "material", "Material", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_pet_toy", "pet_toy_v1", "size", "Size", "text", null, { filter: "enum" }),
);

// ====================== TOOLS & HOME IMPROVEMENT ===========================

add(
  def("ptype_drill", "drill_v1", "power_w", "Power", "integer", "W", { required: true, pricing: true, filter: "range", buckets: WATTAGE_BUCKETS }),
  def("ptype_drill", "drill_v1", "chuck_size_mm", "Chuck Size", "integer", "mm", { required: true, pricing: true, filter: "enum" }),
  def("ptype_drill", "drill_v1", "is_cordless", "Cordless", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_drill", "drill_v1", "has_hammer_function", "Hammer Function", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_screwdriver_set", "screwdriver_set_v1", "pieces", "Pieces", "integer", null, { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 20", min: 0, max: 20 },
    { label: "20–60", min: 20, max: 61 },
    { label: "60 & above", min: 61, max: null },
  ] }),
  def("ptype_screwdriver_set", "screwdriver_set_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_screwdriver_set", "screwdriver_set_v1", "has_magnetic_tip", "Magnetic Tip", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_led_bulb", "led_bulb_v1", "power_w", "Power", "integer", "W", { required: true, pricing: true, filter: "enum" }),
  def("ptype_led_bulb", "led_bulb_v1", "colour_temp", "Colour", "text", null, { required: true, filter: "enum" }),
  def("ptype_led_bulb", "led_bulb_v1", "pack_size", "Pack Size", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_led_bulb", "led_bulb_v1", "lumens", "Brightness", "integer", "lm", { pricing: true }),
  def("ptype_led_bulb", "led_bulb_v1", "is_smart", "Smart Bulb", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_extension_board", "extension_board_v1", "sockets", "Sockets", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_extension_board", "extension_board_v1", "cord_length_m", "Cord Length", "decimal", "m", { required: true, pricing: true, filter: "enum" }),
  def("ptype_extension_board", "extension_board_v1", "has_surge_protection", "Surge Protection", "boolean", null, { pricing: true, filter: "boolean" }),
  def("ptype_extension_board", "extension_board_v1", "usb_ports", "USB Ports", "integer", null, { pricing: true, filter: "enum" }),
);

add(
  def("ptype_torch", "torch_v1", "lumens", "Brightness", "integer", "lm", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 200 lm", min: 0, max: 200 },
    { label: "200–800 lm", min: 200, max: 801 },
    { label: "800 lm & above", min: 801, max: null },
  ] }),
  def("ptype_torch", "torch_v1", "is_rechargeable", "Rechargeable", "boolean", null, { required: true, pricing: true, filter: "boolean" }),
  def("ptype_torch", "torch_v1", "beam_distance_m", "Beam Distance", "integer", "m", { pricing: true }),
  def("ptype_torch", "torch_v1", "body_material", "Body Material", "text", null, { filter: "enum" }),
);

// ============================= TOYS & GAMES ================================

add(
  def("ptype_soft_toy", "soft_toy_v1", "height_cm", "Height", "integer", "cm", { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 30 cm", min: 0, max: 30 },
    { label: "30–60 cm", min: 30, max: 61 },
    { label: "60 cm & above", min: 61, max: null },
  ] }),
  def("ptype_soft_toy", "soft_toy_v1", "material", "Material", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_soft_toy", "soft_toy_v1", "age_group", "Age Group", "text", null, { filter: "enum" }),
  def("ptype_soft_toy", "soft_toy_v1", "is_washable", "Machine Washable", "boolean", null, { filter: "boolean" }),
);

add(
  def("ptype_building_blocks", "building_blocks_v1", "pieces", "Pieces", "integer", null, { required: true, pricing: true, filter: "range", buckets: [
    { label: "Under 100", min: 0, max: 100 },
    { label: "100–500", min: 100, max: 501 },
    { label: "500 & above", min: 501, max: null },
  ] }),
  def("ptype_building_blocks", "building_blocks_v1", "age_group", "Age Group", "text", null, { required: true, filter: "enum" }),
  def("ptype_building_blocks", "building_blocks_v1", "material", "Material", "text", null, { pricing: true, filter: "enum" }),
  def("ptype_building_blocks", "building_blocks_v1", "theme", "Theme", "text", null, { pricing: true, filter: "enum" }),
);

add(
  def("ptype_rc_toy", "rc_toy_v1", "vehicle_type", "Vehicle Type", "text", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_rc_toy", "rc_toy_v1", "scale", "Scale", "text", null, { filter: "enum" }),
  def("ptype_rc_toy", "rc_toy_v1", "range_m", "Control Range", "integer", "m", { pricing: true }),
  def("ptype_rc_toy", "rc_toy_v1", "is_rechargeable", "Rechargeable", "boolean", null, { pricing: true, filter: "boolean" }),
);

add(
  def("ptype_board_game", "board_game_v1", "min_players", "Min Players", "integer", null, { required: true, filter: "enum" }),
  def("ptype_board_game", "board_game_v1", "max_players", "Max Players", "integer", null, { required: true, pricing: true, filter: "enum" }),
  def("ptype_board_game", "board_game_v1", "age_group", "Age Group", "text", null, { required: true, filter: "enum" }),
  def("ptype_board_game", "board_game_v1", "play_time_min", "Play Time", "integer", "min", { pricing: true }),
  def("ptype_board_game", "board_game_v1", "game_type", "Type", "text", null, { pricing: true, filter: "enum" }),
);

export const attributeDefinitions = rows;

// Common apparel size vocabulary, exported so the catalogue seed can build
// variant families without restating it per product type.
export { APPAREL_SIZE };

// ---------------------------------------------------------------------------
// Indexed lookups. With ~500 attribute rows these are called often enough
// (every comparable-set build touches them per candidate) that a linear scan
// per call showed up in the catalogue build.
// ---------------------------------------------------------------------------
const byProductType = (() => {
  const map = new Map();
  for (const a of rows) {
    if (!map.has(a.productTypeId)) map.set(a.productTypeId, []);
    map.get(a.productTypeId).push(a);
  }
  return map;
})();

const filterableByProductType = new Map(
  [...byProductType.entries()].map(([k, v]) => [k, v.filter((a) => a.isFilterable)])
);
const pricingByProductType = new Map(
  [...byProductType.entries()].map(([k, v]) => [k, v.filter((a) => a.isPricingRelevant)])
);

export function getAttributeDefinitions(productTypeId, schemaVersion) {
  const all = byProductType.get(productTypeId) ?? [];
  return schemaVersion == null ? all : all.filter((a) => a.schemaVersion === schemaVersion);
}

/** The subset the catalogue turns into filter facets, in registry order. */
export function getFilterableAttributes(productTypeId) {
  return filterableByProductType.get(productTypeId) ?? [];
}

/** The subset the recommendation engine scores product strength on. */
export function getPricingRelevantAttributes(productTypeId) {
  return pricingByProductType.get(productTypeId) ?? [];
}
