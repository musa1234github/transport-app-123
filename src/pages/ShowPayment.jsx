// ShowPayment.jsx
import React, { useEffect, useState, useMemo } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  updateDoc,
  doc,
  serverTimestamp,
  orderBy,
  limit,
  startAfter,
  endBefore,
  limitToLast
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import * as XLSX from 'xlsx';
import './ShowPayment.css';

/* ===== HELPER FUNCTIONS ===== */
const toDate = (v) => {
  if (!v) return null;
  if (v.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const toNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") v = v.replace(/,/g, "");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

const formatDate = (date) => {
  if (!date) return "";
  try {
    if (isNaN(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIndex = date.getMonth();
    const month = monthNames[monthIndex];
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  } catch (error) {
    console.error("Error formatting date:", date, error);
    return "";
  }
};

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

const ShowPayment = ({ userRole }) => {
  // Check if user is admin
  const isAdmin = userRole === "admin";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false); // Track if data has been loaded
  const [factories, setFactories] = useState([]); // Separate state for factories
  const [loadingFactories, setLoadingFactories] = useState(true); // Track factory loading

  /* ===== PAGINATION STATES ===== */
  // Cursor-based pagination states
  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const RECORDS_PER_PAGE = 20;

  // Kept for UI compatibility but logic changed
  const [pageCount, setPageCount] = useState(1); // Track abstract page number for UI

  /* ===== FILTER STATES ===== */
  const [searchTerm, setSearchTerm] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState("");
  const [paymentTypeFilter, setPaymentTypeFilter] = useState("");

  /* ===== APPLY FILTERS STATE ===== */
  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: "",
    toDate: "",
    searchTerm: "",
    factoryFilter: "",
    paymentTypeFilter: ""
  });

  /* ================= LOAD FACTORIES WITH CACHE ================= */
  const loadFactories = async (forceRefresh = false) => {
    setLoadingFactories(true);
    try {
      // Check cache first (7 day expiry for better performance)
      const CACHE_KEY = 'paymentFactoriesCache';
      const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

      if (!forceRefresh) {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          try {
            const { factories, timestamp } = JSON.parse(cached);
            const age = Date.now() - timestamp;

            if (age < CACHE_EXPIRY_MS) {
              const ageHours = Math.round(age / 1000 / 60 / 60);
              console.log(`Using cached factories for payment (age: ${ageHours} hours, expires in ${Math.round((CACHE_EXPIRY_MS - age) / 1000 / 60 / 60)} hours)`);
              setFactories(factories);
              setLoadingFactories(false);
              return;
            }
          } catch (e) {
            console.error('Cache parse error:', e);
          }
        }
      }

      // Cache miss or expired - load from Factories collection
      console.log('Loading factories from Factories collection...');

      try {
        // OPTIMIZED: Read from dedicated Factories collection (3-5 reads)
        // Instead of scanning all BillTable (100-5000 reads)
        const factoriesQuery = query(
          collection(db, "Factories"),
          where("hasPayments", "==", true)
        );

        const factoriesSnap = await getDocs(factoriesQuery);

        if (factoriesSnap.empty) {
          console.warn('⚠️ Factories collection is empty. Falling back to BillTable scan.');
          console.warn('💡 Run the migration script: node populate_factories_collection.js');

          // FALLBACK: If Factories collection doesn't exist yet, scan BillTable
          const billQuery = query(
            collection(db, "BillTable"),
            where("PaymentReceived", ">", 0)
          );
          const billSnap = await getDocs(billQuery);

          const factorySet = new Set();
          billSnap.docs.forEach(b => {
            const data = b.data();
            if (data.FactoryName) {
              factorySet.add(data.FactoryName);
            }
          });

          const factoriesList = Array.from(factorySet).sort();
          setFactories(factoriesList);

          // Cache for next time
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            factories: factoriesList,
            timestamp: Date.now()
          }));

          return;
        }

        // Extract factory names from Factories collection
        const factoriesList = factoriesSnap.docs
          .map(doc => doc.data().displayName || doc.id)
          .sort();

        console.log(`✅ Loaded ${factoriesList.length} factories from Factories collection (${factoriesSnap.docs.length} reads)`);
        setFactories(factoriesList);

        // Cache for next time
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          factories: factoriesList,
          timestamp: Date.now()
        }));

      } catch (error) {
        console.error('Error loading from Factories collection:', error);
        // If Factories collection doesn't exist, we'll get an error
        // The fallback logic above will handle it
        throw error;
      }

    } catch (error) {
      console.error("Error loading factories:", error);
    } finally {
      setLoadingFactories(false);
    }
  };

  /* ================= LOAD PAYMENT DATA WITH CURSOR PAGINATION ================= */
  const load = async (direction = 'initial', cursorDoc = null) => {
    setLoading(true);
    try {
      // Debug: Log applied filters to help with troubleshooting
      console.log("🔍 Applied Filters:", appliedFilters);

      // REQUIRE at least one filter to avoid full collection scan
      // Exception: If user explicitly wants to see "latest" payments, we allow it but limited to 20

      // Create base query constraints
      let queryConstraints = [];
      // Note: Removed PaymentReceived/HasPayment filter to avoid multiple range filter conflicts with BillDate
      // All bills will be fetched; filter by FactoryName and BillDate only

      const hasDateFilter = appliedFilters.fromDate || appliedFilters.toDate;

      // IMPORTANT: Add where clauses BEFORE orderBy for filters to work correctly

      // Add factory filter
      if (appliedFilters.factoryFilter) {
        queryConstraints.push(where("FactoryName", "==", appliedFilters.factoryFilter));
      }

      // Always filter and sort by PaymentRecDate
      if (appliedFilters.fromDate) {
        const fromDateObj = new Date(appliedFilters.fromDate);
        fromDateObj.setHours(0, 0, 0, 0);
        queryConstraints.push(where("PaymentRecDate", ">=", Timestamp.fromDate(fromDateObj)));
      }

      if (appliedFilters.toDate) {
        const toDateObj = new Date(appliedFilters.toDate);
        toDateObj.setHours(23, 59, 59, 999);
        queryConstraints.push(where("PaymentRecDate", "<=", Timestamp.fromDate(toDateObj)));
      }

      // Add orderBy AFTER where clauses - always by PaymentRecDate
      queryConstraints.push(orderBy("PaymentRecDate", "desc"));

      // Build query with cursor pagination
      let billQuery;
      if (direction === 'next' && cursorDoc) {
        billQuery = query(
          collection(db, "BillTable"),
          ...queryConstraints,
          startAfter(cursorDoc),
          limit(RECORDS_PER_PAGE + 1) // Fetch one extra to check for next page
        );
      } else if (direction === 'prev' && cursorDoc) {
        billQuery = query(
          collection(db, "BillTable"),
          ...queryConstraints,
          endBefore(cursorDoc),
          limitToLast(RECORDS_PER_PAGE + 1)
        );
      } else {
        // Initial load
        billQuery = query(
          collection(db, "BillTable"),
          ...queryConstraints,
          limit(RECORDS_PER_PAGE + 1)
        );
      }

      const billSnap = await getDocs(billQuery);
      const docs = billSnap.docs;

      // Check for more pages
      const hasMore = docs.length > RECORDS_PER_PAGE;
      // Get the actual docs to display (remove the extra check doc)
      const displayDocs = hasMore ? (direction === 'prev' ? docs.slice(1) : docs.slice(0, RECORDS_PER_PAGE)) : docs;

      // Correcting start/end slice for limitToLast if direction is prev is tricky without the extra logic,
      // but standard pattern:
      // If we used limit(N+1), we have [0...N]. Display [0...N-1].
      // If direction='prev' and we used limitToLast(N+1), we have [0...N]. Display [1...N].

      let finalDocs = displayDocs;
      if (direction === 'prev' && hasMore) {
        finalDocs = docs.slice(docs.length - RECORDS_PER_PAGE);
      } else if (hasMore) {
        finalDocs = docs.slice(0, RECORDS_PER_PAGE);
      } else {
        finalDocs = docs;
      }

      // Update cursors
      if (finalDocs.length > 0) {
        setFirstDoc(finalDocs[0]);
        setLastDoc(finalDocs[finalDocs.length - 1]);

        if (direction === 'next') {
          setHasNextPage(hasMore);
          setHasPrevPage(true);
        } else if (direction === 'prev') {
          setHasPrevPage(hasMore);
          setHasNextPage(true);
        } else {
          setHasNextPage(hasMore);
          setHasPrevPage(false);
          setPageCount(1); // Reset page count on initial load
        }

        // Update page count
        if (direction === 'next') setPageCount(prev => prev + 1);
        if (direction === 'prev') setPageCount(prev => Math.max(1, prev - 1));

      } else {
        setFirstDoc(null);
        setLastDoc(null);
        setHasNextPage(false);
        setHasPrevPage(false);
      }

      const billData = [];

      // Process bills - NO additional queries needed!
      // All data is now denormalized in BillTable
      finalDocs.forEach((billDoc) => {
        const bill = billDoc.data();

        billData.push({
          id: billDoc.id,
          FactoryName: bill.FactoryName || "",
          BillNum: bill.BillNum || "",
          BillDate: toDate(bill.BillDate) || null,
          PaymentReceived: toNum(bill.PaymentReceived),
          ActualAmount: toNum(bill.ActualAmount),
          Tds: toNum(bill.Tds),
          Gst: toNum(bill.Gst),
          PaymentNumber: bill.PaymentNumber || "",
          BillType: bill.BillType || "",
          // Use denormalized fields - NO queries to PaymentTable needed!
          PaymentDate: toDate(bill.PaymentRecDate) || null,
          Shortage: toNum(bill.PaymentShortage || bill.Shortage || 0),
          // Note: TotalShortage calculation would require aggregation query
          // For now, showing individual bill shortage. To add TotalShortage,
          // consider pre-calculating during upload or using Cloud Functions
          TotalShortage: 0, // Placeholder - can be calculated if needed
          BillDateObj: toDate(bill.BillDate),
          BillDateSortKey: formatDate(toDate(bill.BillDate))
        });
      });

      // No client-side sorting needed - Firestore orderBy("BillDate", "desc") already handles this
      // Removing redundant sort improves performance

      setRows(billData);
      setSelectedPayments([]);
      setSelectAll(false);
      setHasLoadedData(true);

    } catch (error) {
      console.error("Error loading payment data:", error);
      alert("Error loading data: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  /* ===== LOAD FACTORIES ON COMPONENT MOUNT ===== */
  useEffect(() => {
    loadFactories();
  }, []);

  /* ===== APPLY FILTERS FUNCTION ===== */
  const applyFilters = () => {
    setAppliedFilters({
      fromDate: fromDate,
      toDate: toDateFilter,
      searchTerm: searchTerm, // Keep for local search within page
      factoryFilter: factoryFilter,
      paymentTypeFilter: paymentTypeFilter
    });
  };

  // Trigger load when filters (excluding search term which is local) change
  // BUT only if we have explicitly applied them or on initial load
  useEffect(() => {
    if (hasLoadedData || (appliedFilters.factoryFilter || appliedFilters.fromDate || appliedFilters.toDate)) {
      load();
    }
  }, [appliedFilters.factoryFilter, appliedFilters.fromDate, appliedFilters.toDate]);

  // Handle manual "Apply Filters" button click
  const handleApplyClick = () => {
    setPageCount(1); // Reset to first page
    // Update appliedFilters - this will trigger the useEffect which calls load()
    setAppliedFilters({
      fromDate: fromDate,
      toDate: toDateFilter,
      searchTerm: searchTerm,
      factoryFilter: factoryFilter,
      paymentTypeFilter: paymentTypeFilter
    });
  };

  /* ===== CLEAR FILTERS FUNCTION ===== */
  const clearFilters = () => {
    setSearchTerm("");
    setFactoryFilter("");
    setPaymentTypeFilter("");
    setFromDate("");
    setToDateFilter("");
    setAppliedFilters({
      fromDate: "",
      toDate: "",
      searchTerm: "",
      factoryFilter: "",
      paymentTypeFilter: ""
    });
    setRows([]);
    setHasLoadedData(false);
    setSelectAll(false);
    setSelectedPayments([]);
  };



  /* ================= PAGINATION CALCULATIONS ================= */
  const filteredRows = rows.filter(r => {
    // Search filter (client-side for loaded page)
    if (searchTerm.trim()) {
      const tokens = searchTerm.toLowerCase().split(/\s+/);
      return tokens.every(t =>
        (r.FactoryName || "").toLowerCase().includes(t) ||
        (r.BillNum || "").toLowerCase().includes(t) ||
        (r.PaymentNumber || "").toLowerCase().includes(t) ||
        (r.BillType || "").toLowerCase().includes(t)
      );
    }
    return true;
  });

  // RECORDS ARE ALREADY PAGINATED BY SERVER
  const currentRecords = filteredRows;

  // Helper for pagination controls
  const nextPage = () => {
    if (hasNextPage && lastDoc) {
      load('next', lastDoc);
    }
  };

  const prevPage = () => {
    if (hasPrevPage && firstDoc) {
      load('prev', firstDoc);
    }
  };



  /* ===== CHECKBOX HANDLERS ===== */
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedPayments([]);
    } else {
      const allPaymentIds = currentRecords.map(row => row.id);
      setSelectedPayments(allPaymentIds);
    }
    setSelectAll(!selectAll);
  };

  const handleSelectPayment = (paymentId) => {
    if (selectedPayments.includes(paymentId)) {
      setSelectedPayments(selectedPayments.filter(id => id !== paymentId));
    } else {
      setSelectedPayments([...selectedPayments, paymentId]);
    }
  };

  /* ================= EXPORT TO EXCEL ================= */
  const exportToExcel = () => {
    if (!hasLoadedData) {
      alert("Please load data first by applying filters");
      return;
    }

    setExporting(true);
    try {
      // Prepare data for export
      const exportData = filteredRows.map(row => {
        return {
          "Factory Name": row.FactoryName || "",
          "Bill Number": row.BillNum || "",
          "Bill Date": row.BillDate ? formatDate(row.BillDate) : "",
          "Payment Number": row.PaymentNumber || "",
          "Payment Date": row.PaymentDate ? formatDate(row.PaymentDate) : "",
          "Actual Amount": toNum(row.ActualAmount),
          "TDS": toNum(row.Tds),
          "GST": toNum(row.Gst),
          "Payment Received": toNum(row.PaymentReceived),
          "Shortage": toNum(row.Shortage),
          "Total Shortage": toNum(row.TotalShortage),
          "Bill Type": row.BillType || ""
        };
      });

      if (exportData.length === 0) {
        alert("No data to export!");
        setExporting(false);
        return;
      }

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(exportData);

      // Set column widths
      const wscols = [
        { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 20 },
        { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
        { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 20 }
      ];
      ws['!cols'] = wscols;

      // Add header styling
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if (!ws[address]) continue;
        ws[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E0E0E0" } }
        };
      }

      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Payments Report");

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `Payments_Report_${dateStr}.xlsx`;

      // Export file
      XLSX.writeFile(wb, fileName);

      alert(`Exported ${exportData.length} payments to ${fileName}`);
    } catch (error) {
      console.error("Error exporting to Excel:", error);
      alert("Error exporting to Excel: " + error.message);
    } finally {
      setExporting(false);
    }
  };

  /* ================= EXPORT SELECTED PAYMENTS TO EXCEL ================= */
  const exportSelectedToExcel = () => {
    if (selectedPayments.length === 0) {
      alert("Please select payments to export");
      return;
    }

    setExporting(true);
    try {
      const selectedRows = filteredRows.filter(row => selectedPayments.includes(row.id));

      const exportData = selectedRows.map(row => {
        return {
          "Factory Name": row.FactoryName || "",
          "Bill Number": row.BillNum || "",
          "Bill Date": row.BillDate ? formatDate(row.BillDate) : "",
          "Payment Number": row.PaymentNumber || "",
          "Payment Date": row.PaymentDate ? formatDate(row.PaymentDate) : "",
          "Actual Amount": toNum(row.ActualAmount),
          "TDS": toNum(row.Tds),
          "GST": toNum(row.Gst),
          "Payment Received": toNum(row.PaymentReceived),
          "Shortage": toNum(row.Shortage),
          "Total Shortage": toNum(row.TotalShortage),
          "Bill Type": row.BillType || ""
        };
      });

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(exportData);

      // Set column widths
      const wscols = [
        { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 20 },
        { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
        { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 20 }
      ];
      ws['!cols'] = wscols;

      // Add header styling
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if (!ws[address]) continue;
        ws[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E0E0E0" } }
        };
      }

      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Selected Payments");

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `Selected_Payments_${selectedPayments.length}_${dateStr}.xlsx`;

      // Export file
      XLSX.writeFile(wb, fileName);

      alert(`Exported ${selectedPayments.length} selected payments to ${fileName}`);
    } catch (error) {
      console.error("Error exporting selected payments:", error);
      alert("Error exporting selected payments: " + error.message);
    } finally {
      setExporting(false);
    }
  };

  /* ===== DELETE/RESET PAYMENT FUNCTION ===== */
  const deleteSelectedPayments = async () => {
    if (selectedPayments.length === 0) {
      alert("Please select payments to reset");
      return;
    }

    setShowConfirmDelete(true);
  };

  const confirmDelete = async () => {
    setLoading(true);
    try {
      // Reset payment information for selected bills
      for (const billId of selectedPayments) {
        await updateDoc(doc(db, "BillTable", billId), {
          PaymentReceived: 0,
          ActualAmount: 0,
          Tds: 0,
          Gst: 0,
          PId: null,
          PaymentNumber: null,
          UpdatedAt: serverTimestamp()
        });
      }

      // Reload data
      await load();
      setSelectedPayments([]);
      setSelectAll(false);
      alert(`Successfully reset ${selectedPayments.length} payments`);
    } catch (error) {
      console.error("Error resetting payments:", error);
      alert(`Error resetting payments: ${error.message}`);
    } finally {
      setLoading(false);
      setShowConfirmDelete(false);
    }
  };

  return (
    <div className="container">
      <h1>Show Payment Report</h1>

      {/* ===== FILTER BAR ===== */}
      <div className="filter-bar">
        <div>
          <input
            type="text"
            placeholder="Search factory, bill no, payment no"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="filter-input"
          />
        </div>

        <div>
          <select
            value={factoryFilter}
            onChange={e => setFactoryFilter(e.target.value)}
            className="filter-select"
            disabled={loadingFactories && !hasLoadedData}
          >
            <option value="">Select Factory</option>
            {loadingFactories && !hasLoadedData ? (
              <option value="" disabled>Loading factories...</option>
            ) : (
              factories.map(f => (
                <option key={f} value={f}>{f}</option>
              ))
            )}
          </select>
          {loadingFactories && !hasLoadedData && (
            <span className="loading-text">Loading factories...</span>
          )}
        </div>

        <div className="date-filter-container">
          <label>From:</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            style={{ padding: 8 }}
          />
        </div>

        <div className="date-filter-container">
          <label>To:</label>
          <input
            type="date"
            value={toDateFilter}
            onChange={e => setToDateFilter(e.target.value)}
            style={{ padding: 8 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleApplyClick}
            disabled={loading}
            className="filter-button apply-button"
          >
            {loading ? 'Loading...' : hasLoadedData ? 'Apply Filters' : 'Load Data'}
          </button>
          <button
            onClick={clearFilters}
            disabled={!hasLoadedData || loading}
            className="filter-button clear-button"
          >
            Clear Filters
          </button>
        </div>

        {/* ===== EXPORT BUTTONS ===== */}
        <div className="export-button-group">
          <button
            onClick={exportToExcel}
            disabled={exporting || !hasLoadedData || filteredRows.length === 0}
            className="export-button export-all-button"
            title="Export all filtered payments to Excel"
          >
            {exporting ? 'Exporting...' : 'Export Visible to Excel'}
          </button>
          <div style={{ fontSize: '0.8em', marginTop: '5px', color: '#666' }}>
            Note: Exports only current page
          </div>

          {isAdmin && selectedPayments.length > 0 && (
            <button
              onClick={exportSelectedToExcel}
              disabled={exporting}
              className="export-button export-selected-button"
              title={`Export ${selectedPayments.length} selected payments to Excel`}
            >
              {exporting ? 'Exporting...' : `Export Selected (${selectedPayments.length})`}
            </button>
          )}
        </div>
      </div>

      {/* ===== LOAD DATA PROMPT ===== */}
      {!hasLoadedData && !loading && (
        <div className="data-prompt">
          <div className="prompt-content">
            <h3>No Data Loaded</h3>
            <p>Click <strong>"Load Data"</strong> to fetch payment records from the database.</p>
            <p>You can apply filters before loading to refine your results.</p>
            <button
              onClick={handleApplyClick}
              disabled={loading}
              className="filter-button apply-button"
              style={{ marginTop: '15px', padding: '10px 20px' }}
            >
              {loading ? 'Loading...' : 'Load Payment Data'}
            </button>
          </div>
        </div>
      )}

      {/* ===== PAGINATION CONTROLS ===== */}
      {hasLoadedData && (
        <div className="pagination-controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0' }}>
          <button
            onClick={prevPage}
            disabled={loading || !hasPrevPage}
            className="filter-button"
            style={{ opacity: !hasPrevPage ? 0.5 : 1 }}
          >
            Previous
          </button>
          <span>
            Page {pageCount} {loading && '(Loading...)'}
          </span>
          <button
            onClick={nextPage}
            disabled={loading || !hasNextPage}
            className="filter-button"
            style={{ opacity: !hasNextPage ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      )}

      {/* ===== DELETE & EXPORT CONTROLS (Only for Admin) ===== */}
      {hasLoadedData && isAdmin && (
        <div className={`selection-controls ${selectedPayments.length > 0 ? 'selection-controls-with-selection' : 'selection-controls-without-selection'}`}>
          <div>
            <span style={{ marginRight: 10 }}>
              <input
                type="checkbox"
                checked={selectAll && currentRecords.length > 0}
                onChange={handleSelectAll}
                disabled={currentRecords.length === 0 || loading}
                style={{ marginRight: 5 }}
              />
              Select All ({selectedPayments.length} selected)
            </span>
            <span style={{ color: '#666', fontSize: '14px', marginLeft: '20px' }}>
              Page Payments: {currentRecords.length}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            {selectedPayments.length > 0 && (
              <>
                <button
                  onClick={exportSelectedToExcel}
                  disabled={exporting}
                  className="export-button export-selected-button"
                >
                  {exporting ? 'Exporting...' : `Export ${selectedPayments.length} Selected`}
                </button>
                <button
                  onClick={deleteSelectedPayments}
                  disabled={loading}
                  className="filter-button delete-button"
                  style={{ backgroundColor: '#dc3545', fontWeight: 'bold' }}
                >
                  {loading ? 'Resetting...' : `Reset Selected (${selectedPayments.length})`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {loading && <div className="loading-message">Loading payment data...</div>}
      {exporting && <div className="exporting-message">Exporting to Excel...</div>}

      {/* ===== PAYMENT TABLE ===== */}
      {hasLoadedData && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                {/* Only show checkbox column for admin */}
                {isAdmin && (
                  <th className="table-header" style={{ textAlign: 'center', width: '40px' }}>
                    <input
                      type="checkbox"
                      checked={selectAll && currentRecords.length > 0}
                      onChange={handleSelectAll}
                      disabled={currentRecords.length === 0 || loading}
                    />
                  </th>
                )}
                <th className="table-header">Factory Name</th>
                <th className="table-header">Bill Number</th>
                <th className="table-header">Bill Date</th>
                <th className="table-header">Payment Number</th>
                <th className="table-header">Payment Date</th>
                <th className="table-header">Actual Amount</th>
                <th className="table-header">TDS</th>
                <th className="table-header">GST</th>
                <th className="table-header">Payment Received</th>
                <th className="table-header">Shortage</th>
                <th className="table-header">Bill Type</th>
              </tr>
            </thead>
            <tbody>
              {!loading && currentRecords.length > 0 ? (
                currentRecords.map((r, i) => (
                  <tr key={i} className={isAdmin && selectedPayments.includes(r.id) ? 'selected-row' : ''}>
                    {/* Only show checkbox for admin */}
                    {isAdmin && (
                      <td className="table-cell">
                        <input
                          type="checkbox"
                          checked={selectedPayments.includes(r.id)}
                          onChange={() => handleSelectPayment(r.id)}
                          disabled={loading}
                        />
                      </td>
                    )}
                    <td className="table-cell">{r.FactoryName}</td>
                    <td className="table-cell">{r.BillNum}</td>
                    <td className="table-cell">{r.BillDate ? formatDate(r.BillDate) : "N/A"}</td>
                    <td className="table-cell" style={{ fontWeight: r.PaymentNumber ? 'bold' : 'normal' }}>
                      {r.PaymentNumber || "N/A"}
                    </td>
                    <td className="table-cell">{r.PaymentDate ? formatDate(r.PaymentDate) : "N/A"}</td>
                    <td className="table-cell amount-cell">{formatCurrency(r.ActualAmount)}</td>
                    <td className="table-cell amount-cell">{formatCurrency(r.Tds)}</td>
                    <td className="table-cell amount-cell">{formatCurrency(r.Gst)}</td>
                    <td className="table-cell amount-cell currency-positive">
                      {formatCurrency(r.PaymentReceived)}
                    </td>
                    <td className="table-cell amount-cell currency-negative">
                      {formatCurrency(r.Shortage)}
                    </td>
                    <td className="table-cell">{r.BillType || "N/A"}</td>
                  </tr>
                ))
              ) : !loading && hasLoadedData && (
                <tr>
                  <td colSpan={isAdmin ? "12" : "11"} className="no-data-message">
                    No payment records found. Try adjusting your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== PAGINATION CONTROLS (Managed above) ===== */}

      {/* ===== DELETE CONFIRMATION MODAL (Only for Admin) ===== */}
      {isAdmin && showConfirmDelete && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ marginTop: 0, color: '#dc3545' }}>
              Confirm Reset Payments
            </h3>
            <p style={{ fontSize: '16px', marginBottom: 20 }}>
              Are you sure you want to reset {selectedPayments.length} selected payments?
              This will reset their payment information to zero.
            </p>
            <div className="warning-box">
              <strong>Note:</strong> This action cannot be undone.
            </div>
            <div className="modal-buttons">
              <button
                onClick={() => setShowConfirmDelete(false)}
                disabled={loading}
                className="modal-button cancel-button"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={loading}
                className="modal-button delete-button"
              >
                {loading ? 'Resetting...' : 'Yes, Reset Payments'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShowPayment;