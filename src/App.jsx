
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const API_URL = `${API_BASE_URL}/api/tenders`;
const REFRESH_URL = `${API_BASE_URL}/api/refresh`;

function getStatus(tender) {
  if (tender.status) {
    const status = String(tender.status).toLowerCase();

    if (status === "open") return "Open";
    if (status === "expired") return "Expired";
  }

  const deadline =
    tender.submission_deadline_iso || tender.submission_deadline;

  if (!deadline) return "Unknown";

  let parsedDeadline;

  // Handle Indian dates such as 02-11-2026.
  if (/^\d{2}-\d{2}-\d{4}$/.test(String(deadline))) {
    const [day, month, year] = String(deadline).split("-").map(Number);
    parsedDeadline = new Date(year, month - 1, day, 23, 59, 59);
  } else {
    parsedDeadline = new Date(deadline);
  }

  if (Number.isNaN(parsedDeadline.getTime())) return "Unknown";

  return parsedDeadline.getTime() >= Date.now() ? "Open" : "Expired";
}

function formatDate(value) {
  if (!value) return "Not available";

  let date;

  if (/^\d{2}-\d{2}-\d{4}$/.test(String(value))) {
    const [day, month, year] = String(value).split("-").map(Number);
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function getDeadline(tender) {
  return tender.submission_deadline_iso || tender.submission_deadline;
}

function getTenderLinks(tender) {
  const links = Array.isArray(tender.links) ? tender.links : [];

  const normalizedLinks = links
    .map((link) => {
      if (typeof link === "string") {
        return { url: link, label: "" };
      }

      return {
        url: link.url || link.href || "",
        label: link.label || link.text || "",
      };
    })
    .filter((link) => link.url.startsWith("http"));

  if (tender.source_url) {
    normalizedLinks.push({
      url: tender.source_url,
      label: "Source",
    });
  }

  return normalizedLinks.filter(
    (link, index, array) =>
      array.findIndex((item) => item.url === link.url) === index
  );
}

function getBestLinks(tender) {
  const links = getTenderLinks(tender);

  const pdf = links.find(
    (link) =>
      /\.pdf(?:$|[?#])/i.test(link.url) ||
      /pdf|document|bid document/i.test(link.label)
  );

  const bid = links.find(
    (link) =>
      /bidplus|gem\.gov\.in/i.test(link.url) &&
      !/\.pdf(?:$|[?#])/i.test(link.url)
  );

  const source =
    links.find((link) => link.url === tender.source_url) || links[0];

  return { pdf, bid, source };
}

function App() {
  const [tenders, setTenders] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const fetchTenders = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(refresh ? REFRESH_URL : API_URL, {
        method: refresh ? "POST" : "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = await response.json();

      const records = Array.isArray(data)
        ? data
        : Array.isArray(data.tenders)
          ? data.tenders
          : Array.isArray(data.results)
            ? data.results
            : [];

      setTenders(records);
      setLastUpdated(new Date());
      setCurrentPage(1);
    } catch (err) {
      console.error("Tender loading error:", err);
      setError(
        "Could not load tender data. Make sure the FastAPI backend is running at http://127.0.0.1:8000."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenders();
  }, [fetchTenders]);

  // Reset pagination whenever search or status changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter]);

  const enrichedTenders = useMemo(
    () =>
      tenders.map((tender) => ({
        ...tender,
        computedStatus: getStatus(tender),
      })),
    [tenders]
  );

  const counts = useMemo(
    () => ({
      total: enrichedTenders.length,
      open: enrichedTenders.filter(
        (tender) => tender.computedStatus === "Open"
      ).length,
      expired: enrichedTenders.filter(
        (tender) => tender.computedStatus === "Expired"
      ).length,
      unknown: enrichedTenders.filter(
        (tender) => tender.computedStatus === "Unknown"
      ).length,
    }),
    [enrichedTenders]
  );

  const filteredTenders = useMemo(() => {
    const query = search.trim().toLowerCase();

    return enrichedTenders.filter((tender) => {
      const matchesSearch =
        !query ||
        [
          tender.tender_id,
          tender.title,
          tender.organization,
          tender.eligibility_criteria,
          tender.description,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));

      const matchesStatus =
        statusFilter === "All" ||
        tender.computedStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [enrichedTenders, search, statusFilter]);

  // Pagination calculations apply AFTER search and status filtering.
  const totalPages = Math.ceil(filteredTenders.length / itemsPerPage);
  const safeTotalPages = Math.max(1, totalPages);
  const safeCurrentPage = Math.min(currentPage, safeTotalPages);

  const startIndex = (safeCurrentPage - 1) * itemsPerPage;
  const endIndex = Math.min(
    startIndex + itemsPerPage,
    filteredTenders.length
  );

  const paginatedTenders = filteredTenders.slice(startIndex, endIndex);

  const pageNumbers = useMemo(() => {
    const pages = new Set([
      1,
      safeTotalPages,
      safeCurrentPage - 1,
      safeCurrentPage,
      safeCurrentPage + 1,
    ]);

    return [...pages]
      .filter((page) => page >= 1 && page <= safeTotalPages)
      .sort((a, b) => a - b);
  }, [safeTotalPages, safeCurrentPage]);

  const changePage = (page) => {
    const nextPage = Math.min(Math.max(page, 1), safeTotalPages);
    setCurrentPage(nextPage);

    document.getElementById("tenders")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="TenderTrack home">
          <span className="brand-icon">T</span>
          <span>
            <strong>TenderTrack</strong>
            <small>Opportunity Intelligence</small>
          </span>
        </a>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="sidebar-nav">
          <a href="#dashboard" className="nav-link active">
            <span className="nav-icon">▦</span>
            Dashboard
          </a>

          <a
            href="#tenders"
            className="nav-link"
            onClick={() => {
              setStatusFilter("All");
              setCurrentPage(1);
            }}
          >
            <span className="nav-icon">▤</span>
            All Tenders
            <span className="nav-count">{counts.total}</span>
          </a>

          <button
            type="button"
            className="nav-link"
            onClick={() => {
              setStatusFilter("Open");
              setCurrentPage(1);
              document.getElementById("tenders")?.scrollIntoView({
                behavior: "smooth",
              });
            }}
          >
            <span className="nav-icon">◷</span>
            Active Opportunities
          </button>

          <button
            type="button"
            className="nav-link"
            onClick={() => {
              setStatusFilter("Expired");
              setCurrentPage(1);
              document.getElementById("tenders")?.scrollIntoView({
                behavior: "smooth",
              });
            }}
          >
            <span className="nav-icon">✓</span>
            Expired Tenders
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="source-card">
            <span className="source-card-icon">↗</span>
            <div>
              <strong>Public Sources</strong>
              <p>Tracking government opportunities</p>
            </div>
          </div>

          <div className="sidebar-footer">
            <span className="connection-dot" />
            Tender dashboard
            <span className="version">v1.0</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Dashboard</strong>
          </div>

          <div className="topbar-right">
            <span className="live-indicator">
              <span className="connection-dot" />
              Dashboard connected
            </span>
            <div className="avatar">TT</div>
          </div>
        </header>

        <section className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">TENDER MANAGEMENT</p>
              <h1>Government Tender Dashboard</h1>
              <p className="page-description">
                Discover, monitor and manage government tender opportunities
                from one place.
              </p>
            </div>

            <button
              type="button"
              className={`refresh-button ${loading ? "is-loading" : ""}`}
              onClick={() => fetchTenders(true)}
              disabled={loading}
              title="Reload tender data from your backend"
            >
              <span className="refresh-icon" aria-hidden="true">
                ↻
              </span>
              <span>{loading ? "Refreshing..." : "Refresh Data"}</span>
            </button>
          </div>

          <section className="welcome-banner">
            <div className="welcome-copy">
              <span className="welcome-tag">
                <span className="welcome-tag-dot" />
                YOUR OPPORTUNITY OVERVIEW
              </span>
              <h2>Find the right tenders. Never miss a deadline.</h2>
              <p>
                Review published opportunities, check submission deadlines
                and open the original tender documents.
              </p>
            </div>

            <div className="banner-art" aria-hidden="true">
              <div className="art-circle art-circle-one" />
              <div className="art-circle art-circle-two" />
              <div className="art-document">
                <div className="art-document-heading" />
                <div className="art-document-line" />
                <div className="art-document-line short" />
                <div className="art-document-line" />
                <div className="art-check">✓</div>
              </div>
              <div className="art-sparkle">✦</div>
            </div>
          </section>

          <section className="stats-grid" aria-label="Tender statistics">
            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-label">Total Tenders</span>
                <span className="stat-icon icon-blue">▤</span>
              </div>
              <div className="stat-number">{counts.total}</div>
              <p className="stat-caption">Collected tender records</p>
              <div className="stat-progress">
                <span className="progress-blue" />
              </div>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-label">Open Opportunities</span>
                <span className="stat-icon icon-green">↗</span>
              </div>
              <div className="stat-number">{counts.open}</div>
              <p className="stat-caption">Deadlines not yet passed</p>
              <div className="stat-progress">
                <span
                  className="progress-green"
                  style={{
                    width: `${
                      counts.total ? (counts.open / counts.total) * 100 : 0
                    }%`,
                  }}
                />
              </div>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-label">Expired Tenders</span>
                <span className="stat-icon icon-red">◷</span>
              </div>
              <div className="stat-number">{counts.expired}</div>
              <p className="stat-caption">Submission deadlines passed</p>
              <div className="stat-progress">
                <span
                  className="progress-red"
                  style={{
                    width: `${
                      counts.total ? (counts.expired / counts.total) * 100 : 0
                    }%`,
                  }}
                />
              </div>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-label">Unconfirmed Status</span>
                <span className="stat-icon icon-orange">!</span>
              </div>
              <div className="stat-number">{counts.unknown}</div>
              <p className="stat-caption">Need deadline verification</p>
              <div className="stat-progress">
                <span
                  className="progress-orange"
                  style={{
                    width: `${
                      counts.total ? (counts.unknown / counts.total) * 100 : 0
                    }%`,
                  }}
                />
              </div>
            </article>
          </section>

          <section className="tenders-section" id="tenders">
            <div className="section-heading">
              <div>
                <h2>Latest Tenders</h2>
                <p>Browse available records and review tender details.</p>
              </div>

              <span className="record-count">
                {filteredTenders.length}{" "}
                {filteredTenders.length === 1 ? "record" : "records"}
              </span>
            </div>

            <div className="filter-toolbar">
              <div className="search-box">
                <span className="search-icon" aria-hidden="true">
                  ⌕
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by tender ID, title or department..."
                  aria-label="Search tenders"
                />
                {search && (
                  <button
                    className="clear-search"
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              <label className="status-filter">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="All">All statuses</option>
                  <option value="Open">Open</option>
                  <option value="Expired">Expired</option>
                  <option value="Unknown">Unknown</option>
                </select>
              </label>
            </div>

            {error && (
              <div className="error-message" role="alert">
                <span className="error-icon">!</span>
                <div>
                  <strong>Unable to load tender data</strong>
                  <p>{error}</p>
                  <button type="button" onClick={() => fetchTenders()}>
                    Try again
                  </button>
                </div>
              </div>
            )}

            {loading && tenders.length === 0 ? (
              <div className="loading-state">
                <span className="loading-spinner" />
                <strong>Loading tender opportunities...</strong>
                <p>Connecting to your tender database.</p>
              </div>
            ) : !error && filteredTenders.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">⌕</div>
                <h3>No tenders found</h3>
                <p>
                  {tenders.length === 0
                    ? "No tender records are available yet."
                    : "Try another search term or change the status filter."}
                </p>
                {(search || statusFilter !== "All") && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("All");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="tender-list">
                  {paginatedTenders.map((tender, index) => {
                    const { pdf, bid, source } = getBestLinks(tender);
                    const deadline = getDeadline(tender);
                    const status = tender.computedStatus;

                    return (
                      <article
                        className="tender-card"
                        key={
                          tender.tender_id ||
                          `${tender.title || "tender"}-${startIndex + index}`
                        }
                      >
                        <div className="tender-card-main">
                          <div className="tender-icon">📄</div>

                          <div className="tender-information">
                            <div className="tender-title-row">
                              <h3>{tender.title || "Untitled tender"}</h3>
                              <span
                                className={`status-badge status-${status.toLowerCase()}`}
                              >
                                <span className="status-dot" />
                                {status}
                              </span>
                            </div>

                            <div className="tender-meta">
                              <span>
                                <span className="meta-symbol">#</span>
                                {tender.tender_id || "ID unavailable"}
                              </span>
                              <span className="meta-separator">·</span>
                              <span>
                                <span className="meta-symbol">▦</span>
                                {tender.organization ||
                                  "Organization unavailable"}
                              </span>
                            </div>

                            <div className="tender-details">
                              <div className="detail-item">
                                <span className="detail-label">
                                  SUBMISSION DEADLINE
                                </span>
                                <span className="detail-value">
                                  <span className="calendar-icon">▦</span>
                                  {formatDate(deadline)}
                                </span>
                              </div>

                              <div className="detail-item">
                                <span className="detail-label">
                                  ESTIMATED VALUE
                                </span>
                                <span className="detail-value">
                                  {tender.estimated_value != null &&
                                  tender.estimated_value !== ""
                                    ? tender.estimated_value
                                    : "Not disclosed"}
                                </span>
                              </div>

                              <div className="detail-item">
                                <span className="detail-label">
                                  PUBLISHED / STARTED
                                </span>
                                <span className="detail-value">
                                  {formatDate(tender.start_date)}
                                </span>
                              </div>
                            </div>

                            {tender.eligibility_criteria && (
                              <div className="eligibility">
                                <strong>Eligibility:</strong>{" "}
                                {tender.eligibility_criteria}
                              </div>
                            )}

                            <div className="tender-actions">
                              {bid && (
                                <a
                                  className="text-link"
                                  href={bid.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View Bid Details <span>↗</span>
                                </a>
                              )}

                              {pdf && (
                                <a
                                  className="text-link pdf-link"
                                  href={pdf.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View PDF <span>↗</span>
                                </a>
                              )}

                              {!bid && !pdf && source && (
                                <a
                                  className="text-link"
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open Source <span>↗</span>
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {/* Pagination controls */}
                {filteredTenders.length > 0 && (
                  <div className="pagination">
                    <div className="pagination-info">
                      Showing <strong>{startIndex + 1}</strong>–
                      <strong>{endIndex}</strong> of{" "}
                      <strong>{filteredTenders.length}</strong> tenders
                    </div>

                    <div className="pagination-controls">
                      <button
                        type="button"
                        className="pagination-btn pagination-prev"
                        onClick={() => changePage(safeCurrentPage - 1)}
                        disabled={safeCurrentPage === 1}
                      >
                        ← Previous
                      </button>

                      {pageNumbers.map((page, index) => (
                        <span className="pagination-page-wrap" key={page}>
                          {index > 0 &&
                            page - pageNumbers[index - 1] > 1 && (
                              <span className="pagination-dots">…</span>
                            )}

                          <button
                            type="button"
                            className={`pagination-btn pagination-number ${
                              safeCurrentPage === page ? "active" : ""
                            }`}
                            onClick={() => changePage(page)}
                            aria-label={`Go to page ${page}`}
                            aria-current={
                              safeCurrentPage === page ? "page" : undefined
                            }
                          >
                            {page}
                          </button>
                        </span>
                      ))}

                      <button
                        type="button"
                        className="pagination-btn pagination-next"
                        onClick={() => changePage(safeCurrentPage + 1)}
                        disabled={safeCurrentPage === safeTotalPages}
                      >
                        Next →
                      </button>
                    </div>

                    <label className="pagination-size-label">
                      <span>Per page</span>
                      <select
                        className="pagination-size"
                        value={itemsPerPage}
                        onChange={(event) => {
                          setItemsPerPage(Number(event.target.value));
                          setCurrentPage(1);
                        }}
                        aria-label="Tenders per page"
                      >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                      </select>
                    </label>
                  </div>
                )}
              </>
            )}

            <div className="list-footer">
              <span>
                Showing {filteredTenders.length} filtered of {counts.total}{" "}
                total tenders
              </span>
              <span>
                Last refreshed:{" "}
                {lastUpdated
                  ? lastUpdated.toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Not yet"}
              </span>
            </div>
          </section>

          <footer className="page-footer">
            <span>© {new Date().getFullYear()} TenderTrack</span>
            <span>
              Data source: publicly available tender records · Verify details
              on the original portal before applying.
            </span>
          </footer>
        </section>
      </main>
    </div>
  );
}

export default App;
