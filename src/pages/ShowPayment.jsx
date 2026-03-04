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
  orderBy
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

  const [allRows, setAllRows] = useState([]);   // All fetched records
  const [loading, setLoading] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hasRequestedData, setHasRequestedData] = useState(false);
  const [factories, setFactories] = useState([]); // Separate state for factories
  const [loadingFactories, setLoadingFactories] = useState(true); // Track factory loading

  /* ===== CLIENT-SIDE PAGINATION STATES ===== */
  const RECORDS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1); // 1-indexed

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
  // Ensure these factories are always present regardless of Firestore state
  const REQUIRED_FACTORIES = ["JSW"];

  const mergeRequiredFactories = (list) => {
    const merged = new Set(list);
    REQUIRED_FACTORIES.forEach(f => merged.add(f));
    return Array.from(merged).sort();
  };

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
              // Always merge required factories in case cache is stale
              const merged = mergeRequiredFactories(factories);
              const ageHours = Math.round(age / 1000 / 60 / 60);
              console.log(`Using cached factories for payment (age: ${ageHours} hours). Merged required factories.`);

              // If merged list differs from cached, update the cache
              if (merged.length !== factories.length) {
                localStorage.setItem(CACHE_KEY, JSON.stringify({
                  factories: merged,
                  timestamp // preserve original timestamp so it expires naturally
                }));
              }

              setFactories(merged);
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

          const factoriesList = mergeRequiredFactories(Array.from(factorySet));
          setFactories(factoriesList);

          // Cache for next time
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            factories: factoriesList,
            timestamp: Date.now()
          }));

          return;
        }

        // Extract factory names from Factories collection, always include required factories
        const rawList = factoriesSnap.docs.map(doc => doc.data().displayName || doc.id);
        const factoriesList = mergeRequiredFactories(rawList);

        console.log(`✅ Loaded ${factoriesList.length} factories (${factoriesSnap.docs.length} from Firestore + required merges)`);
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
      // Even on error, make sure required factories are available
      setFactories(prev => mergeRequiredFactories(prev));
    } finally {
      setLoadingFactories(false);
    }
  };

  /* ================= PROCESS DOCS INTO BILL DATA ================= */
  const processDocs = (docs, fromDateObj, toDateObj, hasDateFilter) => {
    const billData = [];
    docs.forEach((billDoc) => {
      const bill = billDoc.data();

      // Resolve payment date: prefer PaymentRecDate, fallback to PaymentDate field
      const paymentRecDate = toDate(bill.PaymentRecDate) || toDate(bill.PaymentDate) || null;

      // CLIENT-SIDE SAFETY NET: verify each record actually falls in range
      if (hasDateFilter) {
        if (!paymentRecDate) return;
        if (fromDateObj && paymentRecDate < fromDateObj) return;
        if (toDateObj && paymentRecDate > toDateObj) return;
      }

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
        PaymentDate: paymentRecDate,
        Shortage: toNum(bill.PaymentShortage || bill.Shortage || 0),
        TotalShortage: 0,
        BillDateObj: toDate(bill.BillDate),
        BillDateSortKey: formatDate(toDate(bill.BillDate))
      });
    });
    return billData;
  };

  /* ================= LOAD ALL MATCHING PAYMENT DATA ================= */
  // Uses client-side pagination to avoid composite index requirement.
  // Fetches ALL records matching the filter and paginates in memory.
  const load = async () => {
    setLoading(true);
    try {
      console.log("🔍 Applied Filters:", appliedFilters);

      const hasDateFilter = appliedFilters.fromDate || appliedFilters.toDate;
      let fromDateObj = null;
      let toDateObj = null;

      let queryConstraints = [];

      // Add factory filter
      if (appliedFilters.factoryFilter) {
        queryConstraints.push(where("FactoryName", "==", appliedFilters.factoryFilter));
      }

      // Add date range filter on PaymentRecDate
      if (appliedFilters.fromDate) {
        fromDateObj = new Date(appliedFilters.fromDate);
        fromDateObj.setHours(0, 0, 0, 0);
        queryConstraints.push(where("PaymentRecDate", ">=", Timestamp.fromDate(fromDateObj)));
      }
      if (appliedFilters.toDate) {
        toDateObj = new Date(appliedFilters.toDate);
        toDateObj.setHours(23, 59, 59, 999);
        queryConstraints.push(where("PaymentRecDate", "<=", Timestamp.fromDate(toDateObj)));
      }

      // orderBy must come after where clauses
      queryConstraints.push(orderBy("PaymentRecDate", "desc"));

      // Fetch ALL matching records — no limit, no cursor
      // This avoids composite index requirement for startAfter/endBefore
      const billQuery = query(collection(db, "BillTable"), ...queryConstraints);
      const billSnap = await getDocs(billQuery);

      console.log(`📦 Firestore returned ${billSnap.docs.length} docs`);

      const billData = processDocs(billSnap.docs, fromDateObj, toDateObj, hasDateFilter);

      console.log(`✅ Total matching records: ${billData.length}`);

      setAllRows(billData);
      setCurrentPage(1);        // Reset to first page
      setSelectedPayments([]);
      setSelectAll(false);

    } catch (error) {
      console.error("Error loading payment data:", error);
      alert("Error loading data: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  /* ================= CLIENT-SIDE PAGINATION ================= */
  // Derive current page rows from allRows whenever allRows or currentPage changes
  const totalPages = Math.max(1, Math.ceil(allRows.length / RECORDS_PER_PAGE));
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  const nextPage = () => {
    if (hasNextPage) setCurrentPage(prev => prev + 1);
  };
  const prevPage = () => {
    if (hasPrevPage) setCurrentPage(prev => prev - 1);
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

  // Trigger load when filters change or on initial mount
  useEffect(() => {
    if (hasRequestedData) {
      load();
    }
  }, [appliedFilters.factoryFilter, appliedFilters.fromDate, appliedFilters.toDate, hasRequestedData]);

  // Handle manual "Apply Filters" button click
  const handleApplyClick = () => {
    setCurrentPage(1); // Reset to first page
    setHasRequestedData(true);
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
    setAllRows([]);
    setCurrentPage(1);
    setHasRequestedData(false);
    setSelectAll(false);
    setSelectedPayments([]);
  };



  /* ================= CLIENT-SIDE SEARCH + PAGINATION ================= */
  // Apply search filter across ALL records first
  const filteredRows = allRows.filter(r => {
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

  // Slice filteredRows for current page display
  const pageStart = (currentPage - 1) * RECORDS_PER_PAGE;
  const currentRecords = filteredRows.slice(pageStart, pageStart + RECORDS_PER_PAGE);



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
    if (filteredRows.length === 0) {
      alert("No data available to export");
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
            disabled={loadingFactories}
          >
            <option value="">Select Factory</option>
            {loadingFactories ? (
              <option value="" disabled>Loading factories...</option>
            ) : (
              factories.map(f => (
                <option key={f} value={f}>{f}</option>
              ))
            )}
          </select>
          {loadingFactories && (
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
            {loading ? 'Loading...' : 'Apply Filters'}
          </button>
          <button
            onClick={clearFilters}
            disabled={loading}
            className="filter-button clear-button"
          >
            Clear Filters
          </button>
        </div>

        {/* ===== EXPORT BUTTONS ===== */}
        <div className="export-button-group">
          <button
            onClick={exportToExcel}
            disabled={exporting || filteredRows.length === 0}
            className="export-button export-all-button"
            title="Export all filtered payments to Excel"
          >
            {exporting ? 'Exporting...' : 'Export Visible to Excel'}
          </button>
          <div style={{ fontSize: '0.8em', marginTop: '5px', color: '#666' }}>
            Note: Exports all {filteredRows.length} matching records
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

      {/* ===== PAGINATION CONTROLS ===== */}
      {allRows.length > 0 && (
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
            Page {currentPage} of {totalPages} &nbsp;|&nbsp; Total Records: {filteredRows.length}
            {loading && ' (Loading...)'}
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
      {allRows.length > 0 && isAdmin && (
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
            ) : !loading && (
              <tr>
                <td colSpan={isAdmin ? "12" : "11"} className="no-data-message">
                  {!hasRequestedData ? "Click 'Apply Filters' to load payment records." : "No payment records found. Try adjusting your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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