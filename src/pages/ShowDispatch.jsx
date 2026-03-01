
import React, { useEffect, useState, useRef, useMemo } from "react";
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
  limitToLast,
  Timestamp,
  writeBatch
} from "firebase/firestore";
import * as XLSX from "xlsx";
import { FixedSizeList as List } from "react-window";

const FACTORY_NAME_FIXES = {
  MANIGARH: "MANIGARH"
};

const factoryMap = {
  "10": "JSW",
  "6": "MANIGARH",
  "7": "ULTRATECH",
};

// Reverse lookup: factory name → DisVid value
const reverseFactoryMap = Object.fromEntries(
  Object.entries(factoryMap).map(([disVid, name]) => [name, disVid])
);
// Result: { JSW: "10", MANIGARH: "6", ULTRATECH: "7" }

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

const areEqual = (prevProps, nextProps) => {
  const { index, style: prevStyle, data: prevData } = prevProps;
  const { style: nextStyle, data: nextData } = nextProps;

  const prevItem = prevData.items[index];
  const nextItem = nextData.items[index];

  if (prevItem !== nextItem) return false;

  const isSelectedPrev = prevData.selectedSet.has(prevItem.id);
  const isSelectedNext = nextData.selectedSet.has(nextItem.id);
  if (isSelectedPrev !== isSelectedNext) return false;

  const isEditingPrev = prevData.editId === prevItem.id;
  const isEditingNext = nextData.editId === nextItem.id;
  if (isEditingPrev !== isEditingNext) return false;

  if (isEditingNext && prevData.editChallan !== nextData.editChallan) return false;

  if (prevData.isAdmin !== nextData.isAdmin) return false;
  if (prevData.gridTemplateColumns !== nextData.gridTemplateColumns) return false;
  if (prevStyle !== nextStyle) return false;

  return true;
};

const Row = React.memo(({ index, style, data }) => {
  const d = data.items[index];
  const isSelected = data.selectedSet.has(d.id);

  return (
    <div style={{
      ...style,
      display: "grid",
      gridTemplateColumns: data.gridTemplateColumns,
      alignItems: "center",
      borderBottom: "1px solid #ddd",
      backgroundColor: "#fff"
    }}>
      {data.isAdmin && (
        <div style={{ padding: 10, textAlign: "center" }}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => data.handleCheckboxChange(d.id)}
          />
        </div>
      )}

      {COLUMN_SEQUENCE.map(col => (
        <div key={col} style={{ padding: 10, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {col === "ChallanNo" && data.editId === d.id ? (
            <input
              value={data.editChallan}
              onChange={e => data.setEditChallan(e.target.value)}
              style={{ padding: 4, width: "100%", boxSizing: "border-box" }}
            />
          ) : col === "DispatchDate" ? (
            formatShortDate(d[col])
          ) : (
            d[col]
          )}
        </div>
      ))}

      {data.isAdmin && (
        <div style={{ padding: 10 }}>
          {data.editId === d.id ? (
            <>
              <button
                onClick={() => data.handleSave(d.id)}
                style={{ marginRight: 5, padding: "5px 10px", backgroundColor: "#28a745", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
              >
                Save
              </button>
              <button
                onClick={data.handleCancel}
                style={{ padding: "5px 10px", backgroundColor: "#6c757d", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => data.handleEdit(d)}
                style={{ marginRight: 5, padding: "5px 10px", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
              >
                Edit
              </button>
              <button
                onClick={() => data.handleDelete(d.id)}
                style={{ padding: "5px 10px", backgroundColor: "#dc3545", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}, areEqual);

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

  const [filteredDispatches, setFilteredDispatches] = useState([]);
  const workerRef = useRef(null);
  const searchSeq = useRef(0);
  const setDataSeq = useRef(0); // Separate sequence for SET_DATA responses

  // Initialize worker
  useEffect(() => {
    workerRef.current = new Worker(
      new URL("../workers/dispatchFilter.worker.js", import.meta.url)
    );
    workerRef.current.onmessage = (e) => {
      const { seq, type: msgType, results } = e.data || {};

      // Route SET_DATA vs SEARCH responses via separate sequence guards
      if (msgType === "SET_DATA_DONE") {
        if (seq < setDataSeq.current) return;
        if (Array.isArray(results)) setFilteredDispatches(results);
        return;
      }

      // Default: SEARCH response
      if (seq !== undefined && seq < searchSeq.current) return;
      if (Array.isArray(results)) {
        setFilteredDispatches(results);
      } else if (Array.isArray(e.data)) {
        setFilteredDispatches(e.data);
      }
    };

    return () => workerRef.current.terminate();
  }, []);

  // Applied filters
  const [appliedFilters, setAppliedFilters] = useState({
    filterFactory: "",
    fromDate: "",
    toDate: ""
  });

  // Cursor-based pagination state
  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);

  // Caching Array Refs
  const [queryCache, setQueryCache] = useState({});
  const [prefetchCache, setPrefetchCache] = useState({});

  // Memory Stack Refs
  const [pageHistory, setPageHistory] = useState([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  const [editId, setEditId] = useState(null);
  const [editChallan, setEditChallan] = useState("");

  const DOCS_PER_PAGE = 100; // Production-grade limit

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

      // Build query conditions
      const conditions = [];

      // Factory filter — all records use FactoryName directly
      if (appliedFilters.filterFactory) {
        conditions.push(where("FactoryName", "==", appliedFilters.filterFactory));
      }

      if (appliedFilters.fromDate) {
        const fromJS = normalizeDate(new Date(appliedFilters.fromDate));
        conditions.push(where("DispatchDate", ">=", Timestamp.fromDate(fromJS)));
      }

      if (appliedFilters.toDate) {
        const toJS = normalizeDate(new Date(appliedFilters.toDate));
        toJS.setHours(23, 59, 59, 999);
        conditions.push(where("DispatchDate", "<=", Timestamp.fromDate(toJS)));
      }

      // Create cache key
      const cacheKey = JSON.stringify({
        filters: appliedFilters,
        direction,
        cursor: cursorDoc?.id || null
      });

      // CHECK CACHE
      if (queryCache[cacheKey]) {
        console.log("⚡ Using cached data");
        const cached = queryCache[cacheKey];
        setDispatches(cached.rows);
        setFirstDoc(cached.firstDoc);
        setLastDoc(cached.lastDoc);
        setHasNextPage(cached.hasNextPage);
        setHasPrevPage(cached.hasPrevPage);
        setDataLoaded(true);
        setLoading(false);
        return;
      }

      // Build Firestore query with cursor-based pagination
      let firestoreQuery;
      if (direction === 'next' && cursorDoc) {
        firestoreQuery = query(q, ...conditions, orderBy("DispatchDate", "desc"), startAfter(cursorDoc), limit(DOCS_PER_PAGE + 1));
      } else if (direction === 'prev' && cursorDoc) {
        firestoreQuery = query(q, ...conditions, orderBy("DispatchDate", "desc"), endBefore(cursorDoc), limitToLast(DOCS_PER_PAGE + 1));
      } else {
        firestoreQuery = query(q, ...conditions, orderBy("DispatchDate", "desc"), limit(DOCS_PER_PAGE + 1));
      }

      // PREFETCH CHECK
      let docs;
      const prefetchKey = JSON.stringify({
        filters: appliedFilters,
        direction,
        cursor: cursorDoc?.id || null
      });

      if (prefetchCache[prefetchKey]) {
        console.log("⚡ Using prefetched data");
        docs = prefetchCache[prefetchKey];
      } else {
        const querySnapshot = await getDocs(firestoreQuery);
        docs = querySnapshot.docs;
      }

      // Check if there are more pages
      const hasMore = docs.length > DOCS_PER_PAGE;
      const displayDocs = hasMore ? docs.slice(0, DOCS_PER_PAGE) : docs;

      // Update pagination state
      if (displayDocs.length > 0) {
        setFirstDoc(displayDocs[0]);
        setLastDoc(displayDocs[displayDocs.length - 1]);
        setHasNextPage(hasMore);
        setHasPrevPage(direction !== "initial");
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
        } else if (row.disvid) {
          row.FactoryName = factoryMap[String(row.disvid)] || "";
        }

        return row;
      });

      // Data is already factory-filtered and date-filtered by Firestore query
      const filteredData = data;

      setDispatches(filteredData);
      setDataLoaded(true);

      setQueryCache(prev => ({
        ...prev,
        [cacheKey]: {
          rows: filteredData,
          firstDoc: displayDocs.length > 0 ? displayDocs[0] : null,
          lastDoc: displayDocs.length > 0 ? displayDocs[displayDocs.length - 1] : null,
          hasNextPage: hasMore,
          hasPrevPage: direction !== 'initial'
        }
      }));

      // 🔥 Trigger Prefetching in Background
      if (displayDocs.length > 0 && hasMore) {
        prefetchNextPage(displayDocs[displayDocs.length - 1]);
      }

      setPageHistory(prev => {
        const newHistory = [...prev];
        newHistory[currentPageIndex] = {
          rows: filteredData,
          firstDoc: displayDocs.length > 0 ? displayDocs[0] : null,
          lastDoc: displayDocs.length > 0 ? displayDocs[displayDocs.length - 1] : null,
          hasNextPage: hasMore,
          hasPrevPage: direction !== 'initial'
        };
        return newHistory;
      });

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

  /* ================= PREFETCH NEXT PAGE ================= */
  const prefetchNextPage = async (cursorDoc) => {
    if (!cursorDoc) return;

    const cacheKey = JSON.stringify({
      filters: appliedFilters,
      direction: "next",
      cursor: cursorDoc.id
    });

    if (prefetchCache[cacheKey]) return;

    try {
      let conditions = [];

      if (appliedFilters.filterFactory) {
        conditions.push(where("FactoryName", "==", appliedFilters.filterFactory));
      }
      if (appliedFilters.fromDate) {
        const fromJS = normalizeDate(new Date(appliedFilters.fromDate));
        conditions.push(where("DispatchDate", ">=", Timestamp.fromDate(fromJS)));
      }
      if (appliedFilters.toDate) {
        const toJS = normalizeDate(new Date(appliedFilters.toDate));
        toJS.setHours(23, 59, 59, 999);
        conditions.push(where("DispatchDate", "<=", Timestamp.fromDate(toJS)));
      }

      const q = query(
        collection(db, "TblDispatch"),
        ...conditions,
        orderBy("DispatchDate", "desc"),
        startAfter(cursorDoc),
        limit(DOCS_PER_PAGE + 1)
      );

      const snap = await getDocs(q);

      setPrefetchCache(prev => ({
        ...prev,
        [cacheKey]: snap.docs
      }));

      console.log("⚡ Prefetched next Dispatch page");
    } catch (err) {
      console.log("Prefetch failed", err);
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
    setPageHistory([]);
    setCurrentPageIndex(0);

    // Set applied filters
    setAppliedFilters({
      filterFactory: normalizedFactory,
      fromDate,
      toDate
    });

    // Don't fetch here - let useEffect handle it
  };

  // Prevent double execution in StrictMode causing empty datasets via race condition arrays
  const fetchLockRef = useRef(false);

  // Fetch data when appliedFilters changes (only if at least one filter is set)
  useEffect(() => {
    if (!appliedFilters.filterFactory && !appliedFilters.fromDate && !appliedFilters.toDate) return;

    if (fetchLockRef.current) return;
    fetchLockRef.current = true;

    fetchDispatches().finally(() => {
      fetchLockRef.current = false;
    });
  }, [appliedFilters]);

  /* ================= CLEAR FILTERS ================= */
  const clearFilters = () => {
    setSearchTerm("");
    setFilterFactory("");
    setFromDate("");
    setToDate("");
    setAppliedFilters({
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
    setPageHistory([]);
    setCurrentPageIndex(0);
  };

  /* ================= PAGINATION ================= */
  const handleNextPage = () => {
    if (!hasNextPage) return;

    const nextIndex = currentPageIndex + 1;

    if (pageHistory[nextIndex]) {
      const p = pageHistory[nextIndex];

      setDispatches(p.rows);
      setFirstDoc(p.firstDoc);
      setLastDoc(p.lastDoc);
      setHasNextPage(p.hasNextPage);
      setHasPrevPage(true);

      setCurrentPageIndex(nextIndex);
      return;
    }

    fetchDispatches('next', lastDoc);
    setCurrentPageIndex(nextIndex);
  };

  const handlePrevPage = () => {
    const prevIndex = currentPageIndex - 1;
    if (prevIndex < 0) return;

    const p = pageHistory[prevIndex];
    if (!p) return;

    setDispatches(p.rows);
    setFirstDoc(p.firstDoc);
    setLastDoc(p.lastDoc);
    setHasNextPage(p.hasNextPage);
    setHasPrevPage(prevIndex > 0);

    setCurrentPageIndex(prevIndex);
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

    const batch = writeBatch(db);
    selectedIds.forEach(id => {
      batch.delete(doc(db, "TblDispatch", id));
    });

    await batch.commit();

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
  // Sync data to worker for background threading
  useEffect(() => {
    if (!workerRef.current) return;

    if (dataLoaded) {
      const seq = ++setDataSeq.current;
      console.log("📤 SET_DATA dispatches:", dispatches.length, "seq:", seq);
      workerRef.current.postMessage({
        type: "SET_DATA",
        data: dispatches,
        seq
      });
    } else {
      setFilteredDispatches([]);
    }
  }, [dispatches, dataLoaded]);

  // Sync search updates separately to leverage indexing without reloading data
  useEffect(() => {
    if (!workerRef.current || !dataLoaded) return;

    const seq = ++searchSeq.current;

    const t = setTimeout(() => {
      workerRef.current.postMessage({
        type: "SEARCH",
        searchTerm,
        seq
      });
    }, 150);

    return () => clearTimeout(t);
  }, [searchTerm, dataLoaded]);

  // Server-side pagination & Worker output
  const displayDispatches = searchTerm.trim() ? filteredDispatches : dispatches;

  const gridTemplateColumns = isAdmin
    ? `50px repeat(${COLUMN_SEQUENCE.length}, minmax(100px, 1fr)) 160px`
    : `repeat(${COLUMN_SEQUENCE.length}, minmax(100px, 1fr))`;

  const selectedSetRef = useRef(new Set());
  useEffect(() => {
    selectedSetRef.current = new Set(selectedIds);
  }, [selectedIds]);

  const itemData = useMemo(() => ({
    items: displayDispatches,
    selectedSet: selectedSetRef.current,
    gridTemplateColumns,
    isAdmin,
    editId,
    editChallan,
    setEditChallan,
    handleSave,
    handleCancel,
    handleEdit,
    handleDelete,
    handleCheckboxChange
  }), [
    displayDispatches,
    gridTemplateColumns,
    isAdmin,
    editId,
    editChallan
  ]);

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
            {/* Header */}
            <div style={{
              display: "grid",
              gridTemplateColumns,
              backgroundColor: "#f2f2f2",
              borderBottom: "2px solid #ccc",
              fontWeight: "bold",
              minWidth: isAdmin ? 1200 : 1000
            }}>
              {isAdmin && (
                <div style={{ padding: 10, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                  />
                </div>
              )}
              {COLUMN_SEQUENCE.map(col => (
                <div key={col} style={{ padding: 10 }}>{col}</div>
              ))}
              {isAdmin && <div style={{ padding: 10 }}>Action</div>}
            </div>

            {/* Virtualized Body */}
            {displayDispatches.length > 0 ? (
              <List
                height={600}
                itemCount={displayDispatches.length}
                itemSize={50}
                width={"100%"}
                itemData={itemData}
                itemKey={(index, data) => data.items[index].id}
                overscanCount={5}
                style={{ minWidth: isAdmin ? 1200 : 1000 }}
              >
                {Row}
              </List>
            ) : (
              <div style={{ padding: 20, textAlign: "center", borderBottom: "1px solid #ccc" }}>
                No records found for the selected filters
              </div>
            )}
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