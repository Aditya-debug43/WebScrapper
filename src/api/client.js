// The future integration point. Every service function in this folder is
// already async and already returns plain JSON-shaped objects — today they
// resolve from the local mock data layer, but the call sites in pages never
// know that. Swapping the backend for the planned Java REST API means
// rewriting the bodies of the functions in this folder to call `request()`
// below instead of the mock joins in `src/data`; nothing in `src/pages` or
// `src/components` has to change.
//
//   getProducts()                  today: reads src/data/products.js
//                                   later: request("/products")
//
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API request failed: ${options.method ?? "GET"} ${path} -> ${res.status}`);
  }
  return res.json();
}

// A small artificial delay so loading states in the UI are visible and
// exercised even against instant in-memory mock data — removed automatically
// once real network latency exists.
export function mockDelay(ms = 120) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
