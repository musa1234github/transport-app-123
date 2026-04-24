import React, { useEffect, useState, useCallback, useMemo } from "react";
import { db, auth } from "../firebaseConfig";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  query,
  where,
  Timestamp,
  orderBy,
  limit
} from "firebase/firestore";
import * as XLSX from "xlsx";
import './ShoBilledChallan.css';

const factoryMap = {
  "10": "JSW",
  "6": "Manigar",
  "7": "Ultratech"
};

// Updated column sequence - Removed Diesel and Advance
const COLUMN_SEQUENCE = [
  "ChallanNo",
  "Destination",
  "VehicleNo",
  "DispatchDate",
  "DispatchQuantity",
  "PartyName",
  "FactoryName",
  "BillNum"
];

// ===== FORMAT DATE FOR DISPLAY (dd-MM-yyyy) =====
const formatShortDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

// ===== FORMAT DATE FOR INPUT (YYYY-MM-DD) =====
const formatDateForInput = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const ShoBilledChallan = () => {
  const [dispatches, setDispatches] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterFactory, setFilterFactory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [error, setError] = useState("");
  const [limitHit, setLimitHit] = useState(false);


  // For factory dropdown
  const [factoryOptions, setFactoryOptions] = useState([]);
  const [factoriesLoaded, setFactoriesLoaded] = useState(false);

  /* MVC-style applied filters */
  const [appliedFilters, setAppliedFilters] = useState({
    searchTerm: "",
    filterFactory: "",
    fromDate: "",
    toDate: ""
  });

  const [editId, setEditId] = useState(null);
  const [editChallan, setEditChallan] = useState("");
  const [editBillNum, setEditBillNum] = useState("");

  const recordsPerPage = 10;

  // Check admin status
  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        try {
          const token = await auth.currentUser.getIdTokenResult();
          setIsAdmin(!!token.claims.admin);
        } catch (error) {
          console.error("Error checking admin status:", error);
        }
      }
    };
    checkAdmin();
  }, []);

  /* ================= FACTORY OPTIONS (from hard-coded map — 0 extra reads) ================= */
  useEffect(() => {
    // Derive factory list directly from the factoryMap constant — no Firestore read needed.
    const options = [...new Set(Object.values(factoryMap))].sort();
    setFactoryOptions(options);
    setFactoriesLoaded(true);
  }, []);

  /* ================= FETCH DATA WITH SERVER-SIDE FILTERS ================= */
  const fetchFilteredData = async () => {
    // Validate at least one filter is applied
    if (!filterFactory && !fromDate && !toDate) {
      setError("Please apply at least one filter to load data.");
      setDataLoaded(false);
      setDispatches([]);
      return;
    }

    setLoading(true);
    setError("");

    try {
      // ── Build server-side query constraints ──────────────────────────────
      const constraints = [];

      // 1. Factory filter — Firestore WHERE on FactoryName
      if (filterFactory) {
        constraints.push(where("FactoryName", "==", filterFactory));
      }

      // 2. Date range — convert JS Date → Firestore Timestamp for WHERE clauses
      if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        constraints.push(where("DispatchDate", ">=", Timestamp.fromDate(from)));
      }

      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        constraints.push(where("DispatchDate", "<=", Timestamp.fromDate(to)));
      }

      // 3. Conditionally Order By DispatchDate (required only if Date filter exists)
      if (fromDate || toDate) {
        constraints.push(orderBy("DispatchDate", "desc"));
      }

      // 4. Cap reads at 500 
      const READ_LIMIT = 500;
      constraints.push(limit(READ_LIMIT));

      const q = query(collection(db, "TblDispatch"), ...constraints);
      
      console.log("🛠️ BilledChallan (TblDispatch) Query Conditions:", constraints.map(c => ({
        field: c._query?.filters?.[0]?.field?.segments?.[0], 
        op: c._query?.filters?.[0]?.op, 
        val: c._query?.filters?.[0]?.value?.internalValue
      })));

      const snapshot = await getDocs(q);

      console.log("Docs returned:", snapshot.docs.length);

      if (snapshot.docs.length > 0) {
        console.log(`📊 BilledChallan Docs fetched: ${snapshot.docs.length}`);
        
        // Detailed logging of each document to catch mismatches
        snapshot.docs.forEach(d => {
          const data = d.data();
          const rawDate = data.DispatchDate;
          console.log(`📄 BILLED CHALLAN DOC [${d.id}]:`, {
            FactoryName: data.FactoryName,
            DispatchDate: rawDate?.toDate ? rawDate.toDate().toString() : rawDate,
            ChallanNo: data.ChallanNo,
            BillNum: data.BillNum
          });
        });
        
        const sampleDoc = snapshot.docs[0].data();
        console.log("=== 🔍 DIAGNOSTIC: RAW FIRESTORE DOCUMENT ===");
        console.log("ID:", snapshot.docs[0].id);
        console.log("Raw Data:", sampleDoc);
        console.log("-> DisVid value:", sampleDoc.DisVid, "| type:", typeof sampleDoc.DisVid);
        console.log("-> DispatchDate type:", sampleDoc.DispatchDate?.constructor?.name || typeof sampleDoc.DispatchDate);
        console.log("=============================================");
      }

      // Warn user if cap was hit
      setLimitHit(snapshot.docs.length === READ_LIMIT);
      // ────────────────────────────────────────────────────────────────────

      const resultData = snapshot.docs.map(ds => {
        const row = { id: ds.id, ...ds.data() };
        row.DisVid = String(row.DisVid || "");

        // Convert Firestore Timestamp → plain JS Date (date-only, no time)
        if (row.DispatchDate) {
          let dateObj;
          if (row.DispatchDate.toDate) {
            dateObj = row.DispatchDate.toDate();
          } else if (row.DispatchDate.seconds) {
            dateObj = new Date(row.DispatchDate.seconds * 1000);
          } else {
            dateObj = new Date(row.DispatchDate);
          }
          row.DispatchDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
        }

        // Fallback FactoryName from DisVid map if missing
        row.FactoryName = row.FactoryName || factoryMap[row.DisVid] || "";

        // Normalize BillNum
        row.BillNum = String(row.BillNum || "").trim();

        return row;
      });

      setDispatches(resultData);
      setDataLoaded(true);

      if (resultData.length === 0) {
        setError("No records found with the current filters.");
      }

    } catch (err) {
      console.error("Error fetching data:", err);
      // Composite index missing — surface the Firebase Console link from the error message
      if (err.message && err.message.includes("index")) {
        const indexUrlMatch = err.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
        const indexUrl = indexUrlMatch ? indexUrlMatch[0] : null;

        if (indexUrl) {
          if (window.confirm("⚠️ Composite Index Required\n\nFirebase needs a composite index for this query. Would you like to open the Firebase Console to create it now?")) {
            window.open(indexUrl, "_blank");
            setError("Index creation page opened in a new tab. Please create the index, wait 1-2 minutes, and then refresh.");
          } else {
            setError("Firestore requires a composite index. Check the console for the link.");
          }
        } else {
          setError(
            `Firestore requires a composite index for this query. ` +
            `Please open the browser console, click the index-creation link provided by Firebase, ` +
            `wait ~1 min, then try again.`
          );
        }
      } else {
        setError(`Failed to load data: ${err.message}`);
      }
      setDataLoaded(false);
      setDispatches([]);
    } finally {
      setLoading(false);
    }
  };

  /* ================= APPLY FILTERS ================= */
  const applyFilters = () => {
    // Validate at least one filter is applied
    if (!filterFactory && !fromDate && !toDate) {
      setError("Please select at least one filter (Factory, From Date, or To Date) to load data.");
      return;
    }

    // Validate date range
    if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      if (from > to) {
        setError("From Date cannot be after To Date.");
        return;
      }
    }

    setAppliedFilters({
      searchTerm,
      filterFactory,
      fromDate,
      toDate
    });
    setCurrentPage(1);
    setSelectedIds([]);

    // Fetch data
    fetchFilteredData();
  };

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
    setCurrentPage(1);
    setSelectedIds([]);
    setDispatches([]);
    setDataLoaded(false);
    setError("");
    setLimitHit(false);
  };

  /* ================= CLIENT-SIDE SEARCH FILTER ================= */
  const filteredDispatches = useMemo(() => {
    if (!dataLoaded) return [];

    return dispatches.filter(d => {
      const { searchTerm, filterFactory } = appliedFilters;

      // Factory filter (client-side fallback to ensure strict match)
      if (filterFactory && d.FactoryName && d.FactoryName !== filterFactory) {
        return false;
      }

      // Search term filtering
      if (searchTerm) {
        const terms = searchTerm.toLowerCase().trim().split(/\s+/).filter(Boolean);
        const matchesSearch = terms.every(term => {
          return Object.values(d).some(v => {
            if (!v) return false;
            if (v instanceof Date) {
              return formatShortDate(v).toLowerCase().includes(term);
            }
            return v.toString().toLowerCase().includes(term);
          });
        });
        if (!matchesSearch) return false;
      }

      return true;
    });
  }, [dispatches, appliedFilters, dataLoaded]);

  /* ================= PAGINATION ================= */
  const totalRecords = dispatches.length;
  const filteredCount = filteredDispatches.length;
  const totalPages = Math.ceil(filteredCount / recordsPerPage);

  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = Math.min(startIndex + recordsPerPage, filteredCount);

  const paginatedDispatches = filteredDispatches.slice(startIndex, endIndex);

  const isAllSelected = paginatedDispatches.length > 0 &&
    paginatedDispatches.every(d => selectedIds.includes(d.id));

  /* ================= HANDLERS ================= */
  const handleEdit = (row) => {
    setEditId(row.id);
    setEditChallan(row.ChallanNo || "");
    setEditBillNum(row.BillNum || "");
  };

  const handleSave = async (id) => {
    try {
      const updates = {
        ChallanNo: editChallan
      };

      if (isAdmin && editBillNum !== undefined) {
        updates.BillNum = editBillNum;
      }

      await updateDoc(doc(db, "TblDispatch", id), updates);

      setDispatches(prev =>
        prev.map(d =>
          d.id === id ? {
            ...d,
            ChallanNo: editChallan,
            BillNum: isAdmin ? editBillNum : d.BillNum
          } : d
        )
      );

      setEditId(null);
      setEditChallan("");
      setEditBillNum("");
    } catch (error) {
      console.error("Error saving:", error);
      setError(`Failed to save changes: ${error.message}`);
    }
  };

  const handleCancel = () => {
    setEditId(null);
    setEditChallan("");
    setEditBillNum("");
  };

  const handleDelete = async (id) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this record?")) return;

    try {
      await deleteDoc(doc(db, "TblDispatch", id));
      setDispatches(prev => prev.filter(d => d.id !== id));
      setSelectedIds(prev => prev.filter(sid => sid !== id));
    } catch (error) {
      console.error("Error deleting:", error);
      setError(`Failed to delete record: ${error.message}`);
    }
  };

  const handleDeleteSelected = async () => {
    if (!isAdmin || !selectedIds.length) return;
    if (!window.confirm(`Delete ${selectedIds.length} record(s)?`)) return;

    try {
      await Promise.all(
        selectedIds.map(id =>
          deleteDoc(doc(db, "TblDispatch", id))
        )
      );
      setDispatches(prev => prev.filter(d => !selectedIds.includes(d.id)));
      setSelectedIds([]);
    } catch (error) {
      console.error("Error deleting selected:", error);
      setError(`Failed to delete records: ${error.message}`);
    }
  };

  const handleCheckboxChange = (id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(sid => sid !== id)
        : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(prev =>
        prev.filter(id => !paginatedDispatches.some(d => d.id === id))
      );
    } else {
      setSelectedIds(prev => [
        ...new Set([...prev, ...paginatedDispatches.map(d => d.id)])
      ]);
    }
  };

  /* ================= EXPORT TO EXCEL ================= */
  const exportToExcel = async () => {
    // Validate filters are applied
    if (!appliedFilters.filterFactory && !appliedFilters.fromDate && !appliedFilters.toDate) {
      setError("Please apply filters first to load data for export.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // ── Build fresh query constraints for ALL data ──────────────────────────────
      const constraints = [];

      if (appliedFilters.filterFactory) {
        constraints.push(where("FactoryName", "==", appliedFilters.filterFactory));
      }

      if (appliedFilters.fromDate) {
        const from = new Date(appliedFilters.fromDate);
        from.setHours(0, 0, 0, 0);
        constraints.push(where("DispatchDate", ">=", Timestamp.fromDate(from)));
      }

      if (appliedFilters.toDate) {
        const to = new Date(appliedFilters.toDate);
        to.setHours(23, 59, 59, 999);
        constraints.push(where("DispatchDate", "<=", Timestamp.fromDate(to)));
      }

      constraints.push(orderBy("DispatchDate", "desc"));
      // ❌ NO LIMIT HERE - Fetch all records in range
      // ────────────────────────────────────────────────────────────────────

      const q = query(collection(db, "TblDispatch"), ...constraints);
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setError("No records found for the selected filters.");
        return;
      }

      let allRecords = snapshot.docs.map(ds => {
        const row = { id: ds.id, ...ds.data() };
        // Normalize date
        if (row.DispatchDate) {
          let dateObj;
          if (row.DispatchDate.toDate) {
            dateObj = row.DispatchDate.toDate();
          } else if (row.DispatchDate.seconds) {
            dateObj = new Date(row.DispatchDate.seconds * 1000);
          } else {
            dateObj = new Date(row.DispatchDate);
          }
          row.DispatchDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
        }
        row.BillNum = String(row.BillNum || "").trim();
        return row;
      });

      // Apply client-side search term if present (matching UI behavior)
      if (appliedFilters.searchTerm) {
        const term = appliedFilters.searchTerm.toLowerCase().trim();
        const searchTerms = term.split(/\s+/).filter(Boolean);
        allRecords = allRecords.filter(d => {
          return searchTerms.every(t => {
            return Object.values(d).some(v => {
              if (!v) return false;
              if (v instanceof Date) {
                return formatShortDate(v).toLowerCase().includes(t);
              }
              return v.toString().toLowerCase().includes(t);
            });
          });
        });
      }

      if (allRecords.length === 0) {
        setError("No records match your search term.");
        return;
      }

      // Friendly column names
      const HEADER_MAP = {
        ChallanNo: "Challan No",
        Destination: "Destination",
        VehicleNo: "Vehicle No",
        DispatchDate: "Dispatch Date",
        DispatchQuantity: "Quantity",
        PartyName: "Party Name",
        FactoryName: "Factory",
        BillNum: "Bill Number"
      };

      const excelData = allRecords.map(d => {
        const row = {};
        COLUMN_SEQUENCE.forEach(k => {
          const header = HEADER_MAP[k] || k;
          if (d[k] instanceof Date) {
            row[header] = d[k];
          } else if (k === "DispatchQuantity" && d[k]) {
            const num = parseFloat(d[k]);
            row[header] = isNaN(num) ? d[k] : num;
          } else {
            row[header] = d[k];
          }
        });
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(excelData, { cellDates: true });

      // Auto column width
      const colWidths = Object.keys(excelData[0]).map(key => ({
        wch: Math.max(
          key.length,
          ...excelData.map(row => String(row[key] || "").length)
        ) + 2
      }));
      ws['!cols'] = colWidths;

      // Date format (Dispatch Date column)
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        const cell = XLSX.utils.encode_cell({ r: R, c: 3 });
        if (ws[cell]) ws[cell].z = 'dd-mm-yy';
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "All Challan Data");
      XLSX.writeFile(
        wb,
        `Dispatch_Export_${new Date().toISOString().split('T')[0]}.xlsx`
      );

    } catch (err) {
      console.error("Export error:", err);
      setError(`Export failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  /* ================= DATE HANDLERS ================= */
  const handleFromDateChange = (e) => {
    const value = e.target.value;
    if (value) {
      const [year, month, day] = value.split('-');
      setFromDate(new Date(year, month - 1, day));
    } else {
      setFromDate("");
    }
  };

  const handleToDateChange = (e) => {
    const value = e.target.value;
    if (value) {
      const [year, month, day] = value.split('-');
      setToDate(new Date(year, month - 1, day));
    } else {
      setToDate("");
    }
  };

  /* ================= UI RENDER ================= */
  const billedCount = useMemo(() =>
    dispatches.filter(d => d.BillNum && d.BillNum.trim() !== "").length,
    [dispatches]);

  const unbilledCount = useMemo(() =>
    dispatches.filter(d => !d.BillNum || d.BillNum.trim() === "").length,
    [dispatches]);

  return (
    <div className="container">
      <h2>Billed Challan Data</h2>

      {/* Instructions */}
      <div className="instructions">
        <strong>Instructions:</strong> Select at least one filter (Factory Name, From Date, or To Date) and click "Apply Filters" to load data.
      </div>

      {/* Error/Warning Message */}
      {error && (
        <div className={`message ${error.includes("Please select") || error.includes("cannot be after")
          ? 'info'
          : error.includes("No records found")
            ? 'info'
            : 'error'
          }`}>
          <strong>
            {error.includes("Please select") || error.includes("cannot be after") || error.includes("No records found")
              ? "ℹ️ Information"
              : "⚠️ Error"}
          </strong> {error}
        </div>
      )}

      {/* Filter Controls */}
      <div className="filter-container">
        <div className="filter-group">
          <div className="filter-input">
            <label>Factory Name</label>
            <select
              value={filterFactory}
              onChange={e => setFilterFactory(e.target.value)}
              disabled={!factoriesLoaded}
            >
              <option value="">Select Factory</option>
              {factoryOptions.map(factory => (
                <option key={factory} value={factory}>
                  {factory}
                </option>
              ))}
            </select>
            {!factoriesLoaded && <span className="loading-text">Loading factories...</span>}
          </div>

          <div className="filter-input">
            <label>From Date (Dispatch Date)</label>
            <input
              type="date"
              value={fromDate ? formatDateForInput(fromDate) : ""}
              onChange={handleFromDateChange}
            />
          </div>

          <div className="filter-input">
            <label>To Date (Dispatch Date)</label>
            <input
              type="date"
              value={toDate ? formatDateForInput(toDate) : ""}
              onChange={handleToDateChange}
            />
          </div>

          <div className="filter-input">
            <label>Search in Results</label>
            <input
              type="text"
              placeholder="Search loaded data..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              disabled={!dataLoaded}
            />
          </div>
        </div>

        <div className="filter-actions">
          <button
            onClick={applyFilters}
            disabled={loading || (!filterFactory && !fromDate && !toDate)}
            className="btn btn-primary"
          >
            {loading ? "Loading..." : "Apply Filters"}
          </button>

          <button
            onClick={clearFilters}
            disabled={loading}
            className="btn btn-secondary"
          >
            Clear Filters
          </button>

          <button
            onClick={exportToExcel}
            disabled={!dataLoaded || filteredCount === 0}
            className="btn btn-export"
          >
            📊 Export Excel
          </button>
        </div>
      </div>

      {/* Loading Indicator */}
      {loading && (
        <div className="loading-indicator">
          <div className="spinner"></div>
          <strong>Loading data...</strong> Please wait.
        </div>
      )}

      {/* Applied Filters Indicator */}
      {dataLoaded && (appliedFilters.filterFactory || appliedFilters.fromDate || appliedFilters.toDate) && (
        <div className="active-filters">
          <strong>Active Filters:</strong>
          {appliedFilters.filterFactory && <span className="filter-tag">Factory: {appliedFilters.filterFactory}</span>}
          {(appliedFilters.fromDate || appliedFilters.toDate) && (
            <span className="filter-tag">
              Dispatch Date: {appliedFilters.fromDate ? formatShortDate(appliedFilters.fromDate) : 'Any'}
              {" "}to {appliedFilters.toDate ? formatShortDate(appliedFilters.toDate) : 'Any'}
            </span>
          )}
          <span className="loaded-records">
            <strong>Loaded Records:</strong> {totalRecords}
            {limitHit && (
              <span className="limit-badge"> ⚠️ Limit 500</span>
            )}
          </span>
        </div>
      )}

      {/* Limit Warning Banner */}
      {limitHit && dataLoaded && (
        <div className="message limit-warning">
          <strong>⚠️ Result Capped at 500 Records</strong> — Your query matched more than 500 records.
          Please narrow your filters (e.g. shorter date range or select a specific factory) to see all data.
        </div>
      )}

      {/* Data Table Section */}
      {dataLoaded && !loading && (
        <>
          {/* Selected Records Delete Button */}
          {isAdmin && selectedIds.length > 0 && (
            <div className="selection-banner">
              <span>
                <strong>{selectedIds.length}</strong> record(s) selected
              </span>
              <button
                onClick={handleDeleteSelected}
                className="btn btn-danger"
              >
                Delete Selected
              </button>
            </div>
          )}

          {/* Statistics */}
          <div className="statistics">
            <strong>Statistics:</strong>
            <span className="stat-item">Total Records: {totalRecords}</span>
            <span className="stat-item">Filtered Records: {filteredCount}</span>
            <span className="stat-item billed">Billed Records: {billedCount}</span>
            <span className="stat-item unbilled">Unbilled Records: {unbilledCount}</span>
          </div>

          {/* Record Count */}
          <div className="record-count">
            Showing {filteredCount === 0 ? 0 : startIndex + 1}–{endIndex} of{" "}
            <strong>{filteredCount}</strong> filtered records
          </div>

          {/* Table */}
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  {isAdmin && (
                    <th className="checkbox-column">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleSelectAll}
                        disabled={paginatedDispatches.length === 0}
                      />
                    </th>
                  )}
                  {COLUMN_SEQUENCE.map(col => (
                    <th key={col}>{col}</th>
                  ))}
                  {isAdmin && <th className="action-column">Action</th>}
                </tr>
              </thead>

              <tbody>
                {paginatedDispatches.length > 0 ? (
                  paginatedDispatches.map(d => (
                    <tr
                      key={d.id}
                      className={d.BillNum ? 'billed-row' : 'unbilled-row'}
                    >
                      {isAdmin && (
                        <td className="checkbox-cell">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(d.id)}
                            onChange={() => handleCheckboxChange(d.id)}
                          />
                        </td>
                      )}

                      {COLUMN_SEQUENCE.map(col => (
                        <td key={col}>
                          {col === "ChallanNo" && editId === d.id ? (
                            <input
                              className="edit-input"
                              value={editChallan}
                              onChange={e => setEditChallan(e.target.value)}
                              autoFocus
                            />
                          ) : col === "BillNum" && editId === d.id && isAdmin ? (
                            <input
                              className="edit-input"
                              value={editBillNum}
                              onChange={e => setEditBillNum(e.target.value)}
                              placeholder="Enter Bill Number"
                            />
                          ) : col === "DispatchDate" ? (
                            formatShortDate(d[col])
                          ) : col === "BillNum" ? (
                            <span className={`bill-number ${d[col] ? 'has-bill' : 'no-bill'}`}>
                              {d[col] || "Unbilled"}
                            </span>
                          ) : col === "DispatchQuantity" ? (
                            <span className="quantity">
                              {d[col] ? parseFloat(d[col]).toFixed(2) : "0.00"}
                            </span>
                          ) : (
                            d[col] || "—"
                          )}
                        </td>
                      ))}

                      {isAdmin && (
                        <td className="action-cell">
                          {editId === d.id ? (
                            <>
                              <button
                                onClick={() => handleSave(d.id)}
                                className="btn-action btn-save"
                              >
                                Save
                              </button>
                              <button
                                onClick={handleCancel}
                                className="btn-action btn-cancel"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEdit(d)}
                                className="btn-action btn-edit"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(d.id)}
                                className="btn-action btn-delete"
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
                      className="no-results"
                    >
                      No dispatch records found with the current filters. Try adjusting your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <div className="pagination-controls">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                  className="btn-pagination"
                >
                  Prev
                </button>

                {[...Array(Math.min(5, totalPages))].map((_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  if (pageNum < 1 || pageNum > totalPages) return null;

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`btn-pagination ${currentPage === pageNum ? 'active' : ''}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                {totalPages > 5 && currentPage < totalPages - 2 && (
                  <>
                    <span className="ellipsis">...</span>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      className="btn-pagination"
                    >
                      {totalPages}
                    </button>
                  </>
                )}

                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}
                  className="btn-pagination"
                >
                  Next
                </button>
              </div>

              <div className="page-navigation">
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <div className="goto-page">
                  <span>Go to:</span>
                  <input
                    type="number"
                    min="1"
                    max={totalPages}
                    value={currentPage}
                    onChange={(e) => {
                      const page = parseInt(e.target.value);
                      if (page >= 1 && page <= totalPages) {
                        setCurrentPage(page);
                      }
                    }}
                    onBlur={(e) => {
                      const page = parseInt(e.target.value);
                      if (!page || page < 1 || page > totalPages) {
                        e.target.value = currentPage;
                      }
                    }}
                    className="page-input"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* No Data Loaded Message */}
      {!dataLoaded && !loading && !error && (
        <div className="no-data-placeholder">
          <div className="placeholder-icon">📊</div>
          <h3>No Data Loaded</h3>
          <p>Select at least one filter and click "Apply Filters" to load dispatch data.</p>
          <div className="placeholder-tips">
            <div className="tip">
              <strong>Tip:</strong> Use the factory dropdown to filter by factory name.
            </div>
            <div className="tip">
              <strong>Tip:</strong> Use date filters to load dispatch data within a specific period.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShoBilledChallan;