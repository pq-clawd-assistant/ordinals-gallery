// Lightweight unit tests for pagination logic
// Run with: `node tests.js` from the project root

// We don't import app.js directly (it's browser-focused). Instead we
// replicate the pagination logic against a mocked "fetchInscriptions".

async function fetchAllInscriptions(fetchPage, address, pageSize) {
  const PAGE_SIZE = pageSize ?? 60;
  let inscriptions = [];
  let offset = 0;
  let total = 0;

  // First page
  const first = await fetchPage(address, offset, PAGE_SIZE);
  total = first.total;
  inscriptions = inscriptions.concat(first.results);
  offset += first.results.length;

  // Subsequent pages
  while (inscriptions.length < total) {
    const next = await fetchPage(address, offset, PAGE_SIZE);
    if (!next.results || next.results.length === 0) break;
    inscriptions = inscriptions.concat(next.results);
    offset += next.results.length;
  }

  return { inscriptions, total };
}

function assert(condition, message) {
  if (!condition) {
    console.error("TEST FAILED:", message);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log("Running pagination tests...\n");

  // 1) Happy-path: 3 pages, 25 total (page size 10)
  {
    const total = 25;
    const pageSize = 10;
    const fetchPage = async (_address, offset, limit) => {
      const remaining = Math.max(0, total - offset);
      const size = Math.min(remaining, limit);
      const results = Array.from({ length: size }, (_, i) => ({
        id: `insc-${offset + i + 1}`,
      }));
      return { total, results };
    };

    const { inscriptions } = await fetchAllInscriptions(fetchPage, "test-address", pageSize);
    assert(
      inscriptions.length === total,
      `expected ${total} inscriptions but got ${inscriptions.length}`
    );
  }

  // 2) API returns fewer than requested (simulating Hiro "short" page)
  {
    const total = 23;
    const pageSize = 10;
    const fetchPage = async (_address, offset, limit) => {
      const remaining = Math.max(0, total - offset);
      // Simulate a shorter final page regardless of requested limit
      const size = Math.min(remaining, 7, limit);
      const results = Array.from({ length: size }, (_, i) => ({
        id: `short-${offset + i + 1}`,
      }));
      return { total, results };
    };

    const { inscriptions } = await fetchAllInscriptions(fetchPage, "test-address", pageSize);
    assert(
      inscriptions.length === total,
      `short-page: expected ${total} inscriptions but got ${inscriptions.length}`
    );
  }

  // 3) Safety: API lies about total and then returns empty page
  {
    const total = 50;
    const pageSize = 10;
    let calls = 0;
    const fetchPage = async (_address, offset, limit) => {
      calls += 1;
      if (calls > 3) {
        // Simulate API suddenly returning empty results early
        return { total, results: [] };
      }
      const remaining = Math.max(0, total - offset);
      const size = Math.min(remaining, limit);
      const results = Array.from({ length: size }, (_, i) => ({
        id: `lie-${offset + i + 1}`,
      }));
      return { total, results };
    };

    const { inscriptions } = await fetchAllInscriptions(fetchPage, "test-address", pageSize);
    assert(
      inscriptions.length <= total,
      `safety: expected at most ${total} inscriptions but got ${inscriptions.length}`
    );
  }

  console.log("All pagination tests completed. If you see no TEST FAILED messages, they passed.\n");
}

runTests().catch((err) => {
  console.error("Unexpected error in tests:", err);
  process.exitCode = 1;
});
