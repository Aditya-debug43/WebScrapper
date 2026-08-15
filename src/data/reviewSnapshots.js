import { generateReviewSnapshotSeries } from "../utils/priceSeriesGenerator";
import { generatedReviewSnapshots } from "../utils/catalogueGenerator";

// Reviews accumulate per LISTING (per marketplace page), not per product —
// two platforms draw from different customer populations, so their counts
// and ratings are kept separate rather than averaged into one number.
// Stored as a time series: review_count only ever grows, and the *rate* of
// growth (velocity) is the demand proxy — which is lost if this were a
// single mutable column instead of a snapshot series.

export const reviewSnapshots = [
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_m14_6_128",
    startDate: "2025-05-04",
    points: 16,
    intervalDays: 30,
    startCount: 420,
    endCount: 9840,
    startRating: 4.1,
    endRating: 4.3,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_m14_6_128",
    startDate: "2025-05-06",
    points: 16,
    intervalDays: 30,
    startCount: 260,
    endCount: 6420,
    startRating: 4.2,
    endRating: 4.5,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_m14_8_256",
    startDate: "2025-05-04",
    points: 7,
    intervalDays: 65,
    startCount: 80,
    endCount: 1450,
    startRating: 4.0,
    endRating: 4.3,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_m14_8_256",
    startDate: "2025-05-07",
    points: 7,
    intervalDays: 65,
    startCount: 60,
    endCount: 1120,
    startRating: 4.1,
    endRating: 4.4,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_redminote13",
    startDate: "2025-02-12",
    points: 3,
    intervalDays: 90,
    startCount: 350,
    endCount: 11200,
    startRating: 4.0,
    endRating: 4.2,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_realme12x",
    startDate: "2025-01-22",
    points: 3,
    intervalDays: 90,
    startCount: 300,
    endCount: 9800,
    startRating: 3.9,
    endRating: 4.1,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_oneplusnordce4lite",
    startDate: "2025-04-17",
    points: 3,
    intervalDays: 60,
    startCount: 150,
    endCount: 5200,
    startRating: 4.2,
    endRating: 4.4,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_vivot3x",
    startDate: "2025-03-03",
    points: 3,
    intervalDays: 75,
    startCount: 200,
    endCount: 7100,
    startRating: 4.0,
    endRating: 4.2,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_iphone13",
    startDate: "2024-09-12",
    points: 3,
    intervalDays: 120,
    startCount: 900,
    endCount: 28400,
    startRating: 4.5,
    endRating: 4.7,
  }),

  // ---- expanded coverage on existing products ----
  ...generateReviewSnapshotSeries({
    listingId: "lst_meesho_redminote13",
    startDate: "2025-09-05",
    points: 3,
    intervalDays: 60,
    startCount: 50,
    endCount: 3200,
    startRating: 3.8,
    endRating: 4.0,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_oneplusnordce4lite",
    startDate: "2025-05-05",
    points: 3,
    intervalDays: 60,
    startCount: 100,
    endCount: 4100,
    startRating: 4.3,
    endRating: 4.5,
  }),

  // ---- iPhone 15 ----
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_iphone15",
    startDate: "2025-09-25",
    points: 4,
    intervalDays: 20,
    startCount: 200,
    endCount: 8900,
    startRating: 4.5,
    endRating: 4.7,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_iphone15",
    startDate: "2025-09-26",
    points: 4,
    intervalDays: 20,
    startCount: 150,
    endCount: 6700,
    startRating: 4.4,
    endRating: 4.6,
  }),

  // ---- Redmi A3 : budget tier — high volume, more modest ratings ----
  ...generateReviewSnapshotSeries({
    listingId: "lst_meesho_redmia3",
    startDate: "2025-06-10",
    points: 3,
    intervalDays: 40,
    startCount: 80,
    endCount: 5600,
    startRating: 3.6,
    endRating: 3.9,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_redmia3",
    startDate: "2025-06-08",
    points: 3,
    intervalDays: 40,
    startCount: 60,
    endCount: 4200,
    startRating: 3.7,
    endRating: 4.0,
  }),

  // ---- Laptops ----
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_ideapad_i3",
    startDate: "2025-07-08",
    points: 3,
    intervalDays: 50,
    startCount: 40,
    endCount: 1800,
    startRating: 4.0,
    endRating: 4.2,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_ideapad_i5",
    startDate: "2025-07-08",
    points: 3,
    intervalDays: 50,
    startCount: 30,
    endCount: 1400,
    startRating: 4.1,
    endRating: 4.3,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_ideapad_i5",
    startDate: "2025-07-15",
    points: 3,
    intervalDays: 50,
    startCount: 25,
    endCount: 950,
    startRating: 4.0,
    endRating: 4.2,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_dellinspiron15",
    startDate: "2025-05-25",
    points: 3,
    intervalDays: 45,
    startCount: 60,
    endCount: 2600,
    startRating: 4.2,
    endRating: 4.4,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_hppavilion15",
    startDate: "2025-04-15",
    points: 3,
    intervalDays: 45,
    startCount: 70,
    endCount: 3100,
    startRating: 4.1,
    endRating: 4.3,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_asusvivobook15",
    startDate: "2025-06-20",
    points: 3,
    intervalDays: 40,
    startCount: 35,
    endCount: 1500,
    startRating: 4.2,
    endRating: 4.4,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_asusvivobook15",
    startDate: "2025-06-25",
    points: 3,
    intervalDays: 40,
    startCount: 20,
    endCount: 780,
    startRating: 4.1,
    endRating: 4.3,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_macbookair_m2",
    startDate: "2025-03-08",
    points: 4,
    intervalDays: 40,
    startCount: 150,
    endCount: 5200,
    startRating: 4.6,
    endRating: 4.8,
  }),
  ...generateReviewSnapshotSeries({
    // Sparse on purpose — a niche gaming SKU that currently has no active
    // seller (see offers.js), but still carries reviews from when it did.
    listingId: "lst_fk_rogstrix",
    startDate: "2025-08-05",
    points: 2,
    intervalDays: 90,
    startCount: 5,
    endCount: 45,
    startRating: 4.3,
    endRating: 4.5,
  }),

  // ---- Wireless earbuds ----
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_boatairdopes141",
    startDate: "2025-02-08",
    points: 4,
    intervalDays: 40,
    startCount: 500,
    endCount: 42000,
    startRating: 3.9,
    endRating: 4.1,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_meesho_boatairdopes141",
    startDate: "2025-02-14",
    points: 4,
    intervalDays: 40,
    startCount: 300,
    endCount: 18000,
    startRating: 3.7,
    endRating: 3.9,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_realmebudst300",
    startDate: "2025-03-15",
    points: 3,
    intervalDays: 45,
    startCount: 100,
    endCount: 6800,
    startRating: 4.0,
    endRating: 4.2,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_oneplusbuds3",
    startDate: "2025-05-10",
    points: 3,
    intervalDays: 45,
    startCount: 90,
    endCount: 3900,
    startRating: 4.2,
    endRating: 4.4,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_galaxybudsfe",
    startDate: "2025-01-22",
    points: 3,
    intervalDays: 45,
    startCount: 120,
    endCount: 5100,
    startRating: 4.1,
    endRating: 4.3,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_fk_galaxybudsfe",
    startDate: "2025-01-24",
    points: 3,
    intervalDays: 45,
    startCount: 80,
    endCount: 3600,
    startRating: 4.0,
    endRating: 4.2,
  }),
  ...generateReviewSnapshotSeries({
    listingId: "lst_az_airpodspro2",
    startDate: "2024-11-10",
    points: 4,
    intervalDays: 90,
    startCount: 400,
    endCount: 19500,
    startRating: 4.6,
    endRating: 4.8,
  }),
  ...generatedReviewSnapshots,
];

const byListingId = (() => {
  const map = new Map();
  for (const row of reviewSnapshots) {
    let arr = map.get(row.listingId);
    if (!arr) map.set(row.listingId, (arr = []));
    arr.push(row);
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));
  return map;
})();

export function getReviewSnapshotsForListing(listingId) {
  return byListingId.get(listingId) ?? [];
}

export function getLatestReviewSnapshot(listingId) {
  const rows = getReviewSnapshotsForListing(listingId);
  return rows.length ? rows[rows.length - 1] : null;
}

/** Review velocity: change in review count per day between the latest two snapshots. */
export function getReviewVelocity(listingId) {
  const rows = getReviewSnapshotsForListing(listingId);
  if (rows.length < 2) return null;
  const [prev, latest] = rows.slice(-2);
  const days = (new Date(latest.capturedAt) - new Date(prev.capturedAt)) / 86400000;
  if (days <= 0) return null;
  return (latest.reviewCount - prev.reviewCount) / days;
}
