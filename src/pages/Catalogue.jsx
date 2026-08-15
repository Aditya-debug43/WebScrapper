import { useCallback, useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useAsyncData } from "../utils/useAsyncData";
import { getCatalogue, SORT_OPTIONS } from "../api/catalogueService";
import ProductCard from "../components/product/ProductCard";
import CategoryRail from "../components/catalogue/CategoryRail";
import FacetGroup from "../components/catalogue/FacetGroup";
import LoadingState from "../components/common/LoadingState";
import Breadcrumbs from "../components/common/Breadcrumbs";
import "./Catalogue.css";

/**
 * All catalogue state lives in the URL. That keeps a filtered view shareable
 * and bookmarkable, and means opening a product and pressing Back returns to
 * exactly the same filtered result set.
 */
const SPEC_PREFIX = "spec_";

function readCsv(params, key) {
  const raw = params.get(key);
  return raw ? raw.split(",").filter(Boolean) : [];
}

export default function Catalogue() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryDraft, setQueryDraft] = useState(searchParams.get("q") ?? "");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  useEffect(() => {
    setQueryDraft(searchParams.get("q") ?? "");
  }, [searchParams]);

  const criteria = useMemo(() => {
    const specFilters = {};
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith(SPEC_PREFIX) && value) {
        specFilters[key.slice(SPEC_PREFIX.length)] = value.split(",").filter(Boolean);
      }
    }
    return {
      categoryId: searchParams.get("cat"),
      productTypeId: searchParams.get("pt"),
      query: searchParams.get("q") ?? "",
      brandIds: readCsv(searchParams, "brand"),
      priceBucketIds: readCsv(searchParams, "price"),
      ratingId: searchParams.get("rating"),
      marketplaceIds: readCsv(searchParams, "mp"),
      inStockOnly: searchParams.get("stock") === "1",
      specFilters,
      sort: searchParams.get("sort") ?? "relevance",
    };
  }, [searchParams]);

  const { data, loading } = useAsyncData(() => getCatalogue(criteria), [searchParams.toString()]);

  const update = useCallback(
    (mutate) => {
      const next = new URLSearchParams(searchParams);
      mutate(next);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams]
  );

  const toggleCsv = useCallback(
    (key, value) =>
      update((next) => {
        const current = (next.get(key) ?? "").split(",").filter(Boolean);
        const updated = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
        if (updated.length) next.set(key, updated.join(","));
        else next.delete(key);
      }),
    [update]
  );

  const setSingle = useCallback(
    (key, value) =>
      update((next) => {
        if (value == null || next.get(key) === value) next.delete(key);
        else next.set(key, value);
      }),
    [update]
  );

  const selectCategory = useCallback(
    (categoryId) =>
      update((next) => {
        // Changing scope clears facet selections — a RAM filter is meaningless
        // once you have navigated into Footwear.
        [...next.keys()].forEach((k) => {
          if (k.startsWith(SPEC_PREFIX) || ["brand", "price", "rating", "mp", "stock", "pt"].includes(k)) next.delete(k);
        });
        if (categoryId) next.set("cat", categoryId);
        else next.delete("cat");
      }),
    [update]
  );

  const selectProductType = useCallback(
    (productTypeId) =>
      update((next) => {
        [...next.keys()].forEach((k) => {
          if (k.startsWith(SPEC_PREFIX)) next.delete(k);
        });
        if (productTypeId) next.set("pt", productTypeId);
        else next.delete("pt");
      }),
    [update]
  );

  const clearAllFilters = useCallback(
    () =>
      update((next) => {
        [...next.keys()].forEach((k) => {
          if (k.startsWith(SPEC_PREFIX) || ["brand", "price", "rating", "mp", "stock"].includes(k)) next.delete(k);
        });
      }),
    [update]
  );

  const activeFilterCount =
    criteria.brandIds.length +
    criteria.priceBucketIds.length +
    criteria.marketplaceIds.length +
    (criteria.ratingId ? 1 : 0) +
    (criteria.inStockOnly ? 1 : 0) +
    Object.values(criteria.specFilters).reduce((sum, v) => sum + v.length, 0);

  function submitSearch(e) {
    e.preventDefault();
    update((next) => {
      if (queryDraft.trim()) next.set("q", queryDraft.trim());
      else next.delete("q");
    });
  }

  return (
    <div className="page catalogue-page">
      <Breadcrumbs
        items={[
          { label: "Catalogue", to: "/catalogue" },
          ...(data?.breadcrumb ?? []).map((c, i, arr) => ({
            label: c.name,
            to: i < arr.length - 1 ? `/catalogue?cat=${c.id}` : undefined,
          })),
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">
            {data?.breadcrumb?.length ? data.breadcrumb[data.breadcrumb.length - 1].name : "Product catalogue"}
          </h1>
          <p className="page-subtitle">
            Browse by department, narrow by the filters that actually apply to the category, then open a product to
            see its listings, competitors and pricing recommendation.
          </p>
        </div>
      </div>

      <div className="catalogue-layout">
        <aside className={`catalogue-sidebar${mobileFiltersOpen ? " open" : ""}`}>
          <div className="catalogue-sidebar-inner">
            <div className="catalogue-sidebar-mobile-head">
              <span>Filters</span>
              <button type="button" className="icon-btn" onClick={() => setMobileFiltersOpen(false)} aria-label="Close filters">
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            {data && (
              <CategoryRail
                breadcrumb={data.breadcrumb}
                childCategories={data.childCategories}
                productTypesInScope={data.productTypesInScope}
                activeProductTypeId={criteria.productTypeId}
                onSelectCategory={selectCategory}
                onSelectProductType={selectProductType}
              />
            )}

            {data && (
              <>
                <div className="catalogue-filters-head">
                  <span className="eyebrow">Filters</span>
                  {activeFilterCount > 0 && (
                    <button type="button" className="catalogue-clear" onClick={clearAllFilters}>
                      Clear ({activeFilterCount})
                    </button>
                  )}
                </div>

                <FacetGroup title="Brand" options={data.facets.brand} selected={criteria.brandIds} onToggle={(id) => toggleCsv("brand", id)} />
                <FacetGroup title="Price" options={data.facets.price} selected={criteria.priceBucketIds} onToggle={(id) => toggleCsv("price", id)} />
                <FacetGroup
                  title="Customer rating"
                  options={data.facets.rating}
                  selected={criteria.ratingId ? [criteria.ratingId] : []}
                  onToggle={(id) => setSingle("rating", id)}
                  singleSelect
                />
                {data.facets.specs.map((facet) => (
                  <FacetGroup
                    key={facet.key}
                    title={facet.label}
                    options={facet.options}
                    selected={criteria.specFilters[facet.key] ?? []}
                    onToggle={(id) => toggleCsv(`${SPEC_PREFIX}${facet.key}`, id)}
                  />
                ))}
                <FacetGroup title="Marketplace" options={data.facets.marketplace} selected={criteria.marketplaceIds} onToggle={(id) => toggleCsv("mp", id)} />
                <FacetGroup
                  title="Availability"
                  options={data.facets.availability}
                  selected={criteria.inStockOnly ? ["in_stock"] : []}
                  onToggle={() => setSingle("stock", criteria.inStockOnly ? null : "1")}
                />
              </>
            )}
          </div>
        </aside>

        <div className="catalogue-main">
          <div className="catalogue-toolbar">
            <form className="catalogue-search" onSubmit={submitSearch} role="search">
              <Search size={15} strokeWidth={2} />
              <input
                type="text"
                placeholder="Search products, brands, categories…"
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
              />
            </form>

            <button type="button" className="btn btn-secondary btn-sm catalogue-filter-toggle" onClick={() => setMobileFiltersOpen(true)}>
              <SlidersHorizontal size={14} strokeWidth={2} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>

            <div className="catalogue-sort">
              <label htmlFor="cat-sort">Sort</label>
              <select id="cat-sort" value={criteria.sort} onChange={(e) => setSingle("sort", e.target.value)}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {data && (
            <p className="catalogue-count">
              <strong>{data.total}</strong> {data.total === 1 ? "product" : "products"}
              {activeFilterCount > 0 && data.scopeTotal !== data.total && <> matched from {data.scopeTotal} in scope</>}
            </p>
          )}

          {loading && <LoadingState label="Loading catalogue…" />}

          {!loading && data?.total === 0 && (
            <div className="catalogue-empty card">
              <p>No products match these filters.</p>
              {activeFilterCount > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearAllFilters}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          <div className="catalogue-grid">
            {data?.results.map((summary) => (
              <ProductCard key={summary.product.id} summary={summary} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
