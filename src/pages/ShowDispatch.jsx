
import React, { useEffect, useState } from "react";
import { db, auth } from "../firebaseConfig";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  endBefore,
  limitToLast
} from "firebase/firestore";
import * as XLSX from "xlsx";

const FACTORY_NAME_FIXES = {
  MANIGARH: "MANIGARH"
};

const factoryMap = {
  "10": "JSW",
  "6": "MANIGARH",
  "7": "ULTRATECH",
};

const COLUMN_SEQUENCE = [
  "ChallanNo",
  "Destination",
  "VehicleNo",
  "DispatchDate",
  "DispatchQuantity",
  "PartyName",
  "Advance",
  "Diesel",
  "FactoryName"
];

// Factory options for filter dropdown
const FACTORY_OPTIONS = [
  "ACC MARATHA",
  "AMBUJA",
  "DALMIA",
  "MP BIRLA",
  "ORIENT",
  "MANIGARH",
  "ULTRATECH",
  "JSW"
];

const normalizeDate = (d) => {
  if (!d) return null;
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// Format date for display (dd-MM-yy)
const formatShortDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear().toString().slice(-2);
  return `${dd}-${mm}-${yy}`;
};

// Format date for input (YYYY-MM-DD)
const formatDateForInput = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const ShowDispatch = () => {
  const [dispatches, setDispatches] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [filterFactory, setFilterFactory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Applied filters
  const [appliedFilters, setAppliedFilters] = useState({
    searchTerm: "",
    filterFactory: "",
    fromDate: "",
    toDate: ""
  });

  // Cursor-based pagination state
  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);

  const [editId, setEditId] = useState(null);
  const [editChallan, setEditChallan] = useState("");

  const DOCS_PER_PAGE = 200; // Production-grade limit

  // Check admin status only on page load
  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdTokenResult();
        setIsAdmin(!!token.claims.admin);
      }
    };
    checkAdmin();
  }, []);

  // Function to fetch data with filters (cursor-based pagination)
  const fetchDispatches = async (direction = 'initial', cursorDoc = null) => {
    setLoading(true);
    try {
      // 🔥 CRITICAL: Require at least one filter to prevent reading entire database
      if (!appliedFilters.filterFactory && !appliedFilters.fromDate && !appliedFilters.toDate) {
        alert("Please select at least a factory or date range to load data");
        setLoading(false);
        return;
      }

      // Validate date range (365 days max)
      if (appliedFilters.fromDate && appliedFilters.toDate) {
        const from = new Date(appliedFilters.fromDate);
        const to = new Date(appliedFilters.toDate);
        const daysDiff = (to - from) / (1000 * 60 * 60 * 24);

        if (daysDiff > 365) {
          alert("Please select a date range less than 1 year to optimize performance");
          setLoading(false);
          return;
        }

        if (daysDiff < 0) {
          alert("'To Date' must be after 'From Date'");
          setLoading(false);
          return;
        }
      }

      let q = collection(db, "TblDispatch");

      // Build query based on filters
      const conditions = [];

      // Add factory filter if selected
      if (appliedFilters.filterFactory) {
        conditions.push(where("FactoryName", "==", appliedFilters.filterFactory));
      }

      // 🔥 TEMPORARY WORKAROUND: Only add date filters to Firestore if factory is NOT selected
      // This avoids requiring the composite index while it's still propagating
      // Local date filtering will be applied after fetch if both factory and date are selected
      const applyDatesInFirestore = !appliedFilters.filterFactory;

      if (applyDatesInFirestore && appliedFilters.fromDate) {
        const fromJS = normalizeDate(new Date(appliedFilters.fromDate));
        conditions.push(where("DispatchDate", ">=", fromJS));
      }

      if (applyDatesInFirestore && appliedFilters.toDate) {
        const toJS = normalizeDate(new Date(appliedFilters.toDate));
        toJS.setHours(23, 59, 59, 999);
        conditions.push(where("DispatchDate", "<=", toJS));
      }

      // 🔥 Build Firestore query with cursor-based pagination
      let firestoreQuery;

      // Determine if we should order by DispatchDate (only when date filters are ACTUALLY in Firestore query)
      const shouldOrderByDate = applyDatesInFirestore && (appliedFilters.fromDate || appliedFilters.toDate);

      if (direction === 'next' && cursorDoc) {
        // Next page: start after the last document
        if (shouldOrderByDate) {
          firestoreQuery = query(
            q,
            ...conditions,
            orderBy("DispatchDate", "desc"),
            startAfter(cursorDoc),
            limit(DOCS_PER_PAGE + 1)
          );
        } else {
          // Factory-only: no orderBy needed, just use document ID for ordering
          firestoreQuery = query(
            q,
            ...conditions,
            startAfter(cursorDoc),
            limit(DOCS_PER_PAGE + 1)
          );
        }
      } else if (direction === 'prev' && cursorDoc) {
        // Previous page: end before the first document
        if (shouldOrderByDate) {
          firestoreQuery = query(
            q,
            ...conditions,
            orderBy("DispatchDate", "desc"),
            endBefore(cursorDoc),
            limitToLast(DOCS_PER_PAGE + 1)
          );
        } else {
          firestoreQuery = query(
            q,
            ...conditions,
            endBefore(cursorDoc),
            limitToLast(DOCS_PER_PAGE + 1)
          );
        }
      } else {
        // Initial load or filter change
        if (shouldOrderByDate) {
          firestoreQuery = query(
            q,
            ...conditions,
            orderBy("DispatchDate", "desc"),
            limit(DOCS_PER_PAGE + 1)
          );
        } else {
          // Factory-only: no orderBy
          firestoreQuery = query(
            q,
            ...conditions,
            limit(DOCS_PER_PAGE + 1)
          );
        }
      }

      const querySnapshot = await getDocs(firestoreQuery);
      const docs = querySnapshot.docs;

      // Check if there are more pages
      const hasMore = docs.length > DOCS_PER_PAGE;
      const displayDocs = hasMore ? docs.slice(0, DOCS_PER_PAGE) : docs;

      // Update pagination state
      if (displayDocs.length > 0) {
        setFirstDoc(displayDocs[0]);
        setLastDoc(displayDocs[displayDocs.length - 1]);
        setHasNextPage(hasMore);

        // Fix: hasPrevPage should only be true if we've moved from initial position
        if (direction === 'next') {
          setHasPrevPage(true); // We moved forward, so previous is available
        } else if (direction === 'prev') {
          // Keep current state, we're going back
        } else if (direction === 'initial') {
          setHasPrevPage(false); // Initial load, no previous
        }
      } else {
        setFirstDoc(null);
        setLastDoc(null);
        setHasNextPage(false);
        setHasPrevPage(false);
      }

      console.log(`✅ Firestore read ${docs.length} documents (limit: ${DOCS_PER_PAGE})`);
      console.log(`📊 Has next page: ${hasMore}`);

      const data = displayDocs.map(ds => {
        const row = { id: ds.id, ...ds.data() };
        row.DisVid = String(row.DisVid || "");

        if (row.DispatchDate) {
          const d = row.DispatchDate.seconds
            ? new Date(row.DispatchDate.seconds * 1000)
            : new Date(row.DispatchDate);

          row.DispatchDate = new Date(
            d.getFullYear(),
            d.getMonth(),
            d.getDate()
          );
        }

        // Normalize FactoryName consistently
        if (row.FactoryName) {
          const upperFactory = row.FactoryName.toUpperCase();
          row.FactoryName = FACTORY_NAME_FIXES[upperFactory] || upperFactory;
        } else if (row.DisVid) {
          row.FactoryName = factoryMap[row.DisVid] || "";
        }

        return row;
      });

      // Apply additional local filtering for DisVid mapped records
      let filteredData = data;

      // Additional factory filtering for DisVid mapped records
      if (appliedFilters.filterFactory) {
        filteredData = filteredData.filter(d => {
          const recordFactory = d.FactoryName || "";
          return recordFactory === appliedFilters.filterFactory;
        });
      }

      // 🔥 Apply local date filtering when factory is selected (workaround for composite index)
      if (appliedFilters.filterFactory && appliedFilters.fromDate) {
        const fromDate = normalizeDate(new Date(appliedFilters.fromDate));
        filteredData = filteredData.filter(d => {
          if (!d.DispatchDate) return false;
          const recordDate = normalizeDate(d.DispatchDate);
          return recordDate >= fromDate;
        });
      }

      if (appliedFilters.filterFactory && appliedFilters.toDate) {
        const toDate = normalizeDate(new Date(appliedFilters.toDate));
        toDate.setHours(23, 59, 59, 999);
        filteredData = filteredData.filter(d => {
          if (!d.DispatchDate) return false;
          const recordDate = normalizeDate(d.DispatchDate);
          return recordDate <= toDate;
        });
      }

      setDispatches(filteredData);
      setDataLoaded(true);
    } catch (error) {
      console.error("Error fetching dispatches:", error);

      // Check if it's a composite index error
      if (error.message && error.message.includes("index")) {
        alert("⚠️ Composite Index Required\n\nFirebase needs a composite index for this query. Check the console for the auto-generated index creation link from Firebase.");
      } else {
        alert("Error loading data: " + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  /* ================= APPLY FILTERS ================= */
  const applyFilters = () => {
    // Normalize factory name to match data normalization
    let normalizedFactory = "";
    if (filterFactory) {
      // First check for direct match in fixes
      const fixedName = FACTORY_NAME_FIXES[filterFactory.toUpperCase()];
      if (fixedName) {
        normalizedFactory = fixedName;
      } else {
        // Use the factory name as-is but uppercase for consistency
        normalizedFactory = filterFactory.toUpperCase();
      }
    }

    // Reset pagination state when filters change
    setFirstDoc(null);
    setLastDoc(null);
    setHasNextPage(false);
    setHasPrevPage(false);

    // Set applied filters
    setAppliedFilters({
      searchTerm,
      filterFactory: normalizedFactory,
      fromDate,
      toDate
    });

    // Don't fetch here - let useEffect handle it
  };

  // Fetch data when appliedFilters changes (only if at least one filter is set)
  useEffect(() => {
    if (appliedFilters.filterFactory || appliedFilters.fromDate || appliedFilters.toDate) {
      fetchDispatches();
    }
  }, [appliedFilters]);

  /* ================= CLEAR FILTERS ================= */
  const clearFilters = () => {
    setSearchTerm("");
    setFilterFactory("");
    setFromDate("");
    setToDate("");
    setAppliedFilters({
      searchTerm: "",
      filterFactory: "",
      fromDate: "",
      toDate: ""
    });
    setDispatches([]);
    setDataLoaded(false);
    setSelectedIds([]);
    setFirstDoc(null);
    setLastDoc(null);
    setHasNextPage(false);
    setHasPrevPage(false);
  };

  /* ================= PAGINATION ================= */
  const handleNextPage = () => {
    if (hasNextPage && lastDoc) {
      fetchDispatches('next', lastDoc);
    }
  };

  const handlePrevPage = () => {
    if (hasPrevPage && firstDoc) {
      fetchDispatches('prev', firstDoc);
    }
  };

  /* ================= EDIT ================= */
  const handleEdit = (row) => {
    setEditId(row.id);
    setEditChallan(row.ChallanNo || "");
  };

  const handleSave = async (id) => {
    await updateDoc(doc(db, "TblDispatch", id), {
      ChallanNo: editChallan
    });

    setDispatches(prev =>
      prev.map(d =>
        d.id === id ? { ...d, ChallanNo: editChallan } : d
      )
    );

    setEditId(null);
    setEditChallan("");
  };

  const handleCancel = () => {
    setEditId(null);
    setEditChallan("");
  };

  /* ================= DELETE ================= */
  const handleDelete = async (id) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this record?")) return;

    await deleteDoc(doc(db, "TblDispatch", id));
    setDispatches(prev => prev.filter(d => d.id !== id));
    setSelectedIds(prev => prev.filter(sid => sid !== id));
  };

  const handleDeleteSelected = async () => {
    if (!isAdmin || !selectedIds.length) return;
    if (!window.confirm(`Delete ${selectedIds.length} records?`)) return;

    for (let id of selectedIds) {
      await deleteDoc(doc(db, "TblDispatch", id));
    }

    setDispatches(prev => prev.filter(d => !selectedIds.includes(d.id)));
    setSelectedIds([]);
  };

  /* ================= CHECKBOX ================= */
  const handleCheckboxChange = (id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(sid => sid !== id)
        : [...prev, id]
    );
  };

  /* ================= FILTER DATA FOR DISPLAY ================= */
  // Apply search filter to already loaded data (local search only)
  const filteredDispatches = dataLoaded ? dispatches.filter(d => {
    const terms = appliedFilters.searchTerm
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) return true;

    return terms.every(term =>
      Object.values(d).some(v => {
        if (!v) return false;
        if (v instanceof Date) {
          return formatShortDate(v).toLowerCase().includes(term);
        }
        return v.toString().toLowerCase().includes(term);
      })
    );
  }) : [];

  // Server-side pagination - no frontend slicing needed
  const displayDispatches = filteredDispatches;

  const isAllSelected =
    displayDispatches.length > 0 &&
    displayDispatches.every(d => selectedIds.includes(d.id));

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(prev =>
        prev.filter(id => !displayDispatches.some(d => d.id === id))
      );
    } else {
      setSelectedIds(prev => [
        ...new Set([...prev, ...displayDispatches.map(d => d.id)])
      ]);
    }
  };

  /* ================= EXCEL ================= */
  const exportToExcel = () => {
    if (!filteredDispatches.length) return;

    const excelData = filteredDispatches.map(d => {
      const row = {};
      COLUMN_SEQUENCE.forEach(k => {
        row[k] = d[k] instanceof Date ? formatShortDate(d[k]) : d[k];
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dispatch");
    XLSX.writeFile(wb, "Dispatch_Data.xlsx");
  };

  /* ================= UI ================= */
  return (
    <div style={{ padding: 20 }}>
      <h2>Dispatch Data</h2>

      {/* Filter Controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 15 }}>
        <input
          placeholder="Search..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
        />

        <select
          value={filterFactory}
          onChange={e => setFilterFactory(e.target.value)}
          style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
        >
          <option value="">All Factories</option>
          {FACTORY_OPTIONS.map((factory, index) => (
            <option key={index} value={factory}>
              {factory}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <label>From:</label>
          <input
            type="date"
            value={formatDateForInput(fromDate)}
            onChange={(e) => {
              const selectedDate = e.target.value;
              if (selectedDate) {
                const [year, month, day] = selectedDate.split('-');
                const localDate = new Date(year, month - 1, day);
                setFromDate(localDate);
              } else {
                setFromDate("");
              }
            }}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <label>To:</label>
          <input
            type="date"
            value={formatDateForInput(toDate)}
            onChange={(e) => {
              const selectedDate = e.target.value;
              if (selectedDate) {
                const [year, month, day] = selectedDate.split('-');
                const localDate = new Date(year, month - 1, day);
                setToDate(localDate);
              } else {
                setToDate("");
              }
            }}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
          />
        </div>

        <button
          onClick={applyFilters}
          disabled={loading}
          style={{
            padding: "8px 16px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer"
          }}
        >
          {loading ? "Loading..." : "Apply Filters"}
        </button>

        <button
          onClick={clearFilters}
          style={{
            padding: "8px 16px",
            backgroundColor: "#6c757d",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer"
          }}
        >
          Clear Filters
        </button>

        {dataLoaded && (
          <button
            onClick={exportToExcel}
            disabled={displayDispatches.length === 0}
            style={{
              padding: "8px 16px",
              backgroundColor: displayDispatches.length === 0 ? "#6c757d" : "#28a745",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: displayDispatches.length === 0 ? "not-allowed" : "pointer"
            }}
          >
            Export Current Page ({displayDispatches.length})
          </button>
        )}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div style={{ textAlign: "center", padding: 20 }}>
          Loading data...
        </div>
      )}

      {/* Data table */}
      {!loading && dataLoaded && (
        <>
          {isAdmin && selectedIds.length > 0 && (
            <button
              onClick={handleDeleteSelected}
              style={{
                marginTop: 10,
                padding: "8px 16px",
                backgroundColor: "#dc3545",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: "pointer"
              }}
            >
              Delete Selected ({selectedIds.length})
            </button>
          )}

          <div style={{ overflowX: "auto", marginTop: 20 }}>
            <table border="1" width="100%" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f2f2f2" }}>
                  {isAdmin && (
                    <th style={{ padding: 10 }}>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleSelectAll}
                      />
                    </th>
                  )}
                  {COLUMN_SEQUENCE.map(col => (
                    <th key={col} style={{ padding: 10, textAlign: "left" }}>{col}</th>
                  ))}
                  {isAdmin && <th style={{ padding: 10 }}>Action</th>}
                </tr>
              </thead>

              <tbody>
                {displayDispatches.length > 0 ? (
                  displayDispatches.map(d => (
                    <tr key={d.id} style={{ borderBottom: "1px solid #ddd" }}>
                      {isAdmin && (
                        <td style={{ padding: 10, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(d.id)}
                            onChange={() => handleCheckboxChange(d.id)}
                          />
                        </td>
                      )}

                      {COLUMN_SEQUENCE.map(col => (
                        <td key={col} style={{ padding: 10 }}>
                          {col === "ChallanNo" && editId === d.id ? (
                            <input
                              value={editChallan}
                              onChange={e => setEditChallan(e.target.value)}
                              style={{ padding: 4, width: "100%" }}
                            />
                          ) : col === "DispatchDate" ? (
                            formatShortDate(d[col])
                          ) : (
                            d[col]
                          )}
                        </td>
                      ))}

                      {isAdmin && (
                        <td style={{ padding: 10 }}>
                          {editId === d.id ? (
                            <>
                              <button
                                onClick={() => handleSave(d.id)}
                                style={{ marginRight: 5, padding: "5px 10px", backgroundColor: "#28a745", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
                              >
                                Save
                              </button>
                              <button
                                onClick={handleCancel}
                                style={{ padding: "5px 10px", backgroundColor: "#6c757d", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEdit(d)}
                                style={{ marginRight: 5, padding: "5px 10px", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(d.id)}
                                style={{ padding: "5px 10px", backgroundColor: "#dc3545", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={isAdmin ? COLUMN_SEQUENCE.length + 2 : COLUMN_SEQUENCE.length}
                      style={{ padding: 20, textAlign: "center" }}
                    >
                      No records found for the selected filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Record count and search notice */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: "bold", color: "#333", marginBottom: 5 }}>
              Showing {displayDispatches.length} record(s) on this page
            </div>
            <div style={{ fontSize: 13, color: "#6c757d", fontStyle: "italic" }}>
              💡 Search filters only the {displayDispatches.length} records currently loaded
            </div>
          </div>

          {/* Cursor-based pagination - Simple Previous/Next */}
          {(hasPrevPage || hasNextPage) && (
            <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 15 }}>
              <button
                disabled={!hasPrevPage}
                onClick={handlePrevPage}
                style={{
                  padding: "10px 20px",
                  backgroundColor: !hasPrevPage ? "#e9ecef" : "#007bff",
                  color: !hasPrevPage ? "#6c757d" : "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: !hasPrevPage ? "not-allowed" : "pointer",
                  fontWeight: "bold",
                  fontSize: 14
                }}
              >
                ← Previous
              </button>

              <span style={{ padding: "0 10px", color: "#495057", fontSize: 14 }}>
                Server-side pagination • Max {DOCS_PER_PAGE} records per page
              </span>

              <button
                disabled={!hasNextPage}
                onClick={handleNextPage}
                style={{
                  padding: "10px 20px",
                  backgroundColor: !hasNextPage ? "#e9ecef" : "#007bff",
                  color: !hasNextPage ? "#6c757d" : "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: !hasNextPage ? "not-allowed" : "pointer",
                  fontWeight: "bold",
                  fontSize: 14
                }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Initial state - no data loaded yet */}
      {!loading && !dataLoaded && (
        <div style={{
          textAlign: "center",
          padding: 40,
          backgroundColor: "#fff3cd",
          border: "2px solid #ffc107",
          borderRadius: 8,
          marginTop: 20
        }}>
          <p style={{ fontSize: 18, color: "#856404", fontWeight: "bold", marginBottom: 10 }}>
            ⚠️ Filter Required
          </p>
          <p style={{ fontSize: 16, color: "#856404" }}>
            Please select at least a <strong>factory</strong> or <strong>date range</strong> before clicking "Apply Filters".
          </p>
          <p style={{ fontSize: 14, color: "#856404", marginTop: 10 }}>
            This prevents reading the entire database and reduces Firebase costs.
          </p>
          <p style={{ fontSize: 13, color: "#856404", marginTop: 10, fontStyle: "italic" }}>
            Maximum date range: 365 days | Maximum results: 10,000 records
          </p>
        </div>
      )}
    </div>
  );
};

export default ShowDispatch;