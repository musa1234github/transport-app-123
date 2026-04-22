import React, { useEffect, useState, useMemo } from "react";
import { db } from "../firebaseConfig";
import "./OutstandingReport.css";

import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  endBefore,
  limitToLast,
  Timestamp
} from "firebase/firestore";
import * as XLSX from 'xlsx';

/* ===== SAFE DATE ===== */
const toDate = (v) => {
  if (!v) return null;
  if (v.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/* ===== SAFE NUMBER ===== */
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") v = v.replace(/,/g, "");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

/* ===== FORMAT DATE PROPERLY ===== */
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
    return "";
  }
};

/* ===== GET DISPATCH MONTH FROM DISPATCH DATES ===== */
const getDispatchMonth = (dispatchRows) => {
  if (!dispatchRows || dispatchRows.length === 0) return "";
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthsSet = new Set();
  dispatchRows.forEach(dispatch => {
    if (dispatch.DispatchDateStr) {
      const parts = dispatch.DispatchDateStr.split('-');
      if (parts.length === 3) {
        const month = parts[1];
        if (monthNames.includes(month)) {
          monthsSet.add(month);
        }
      }
    }
  });

  const monthsArray = Array.from(monthsSet).sort((a, b) => monthNames.indexOf(a) - monthNames.indexOf(b));
  return monthsArray.join(', ');
};

const OutstandingReport = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  /* ===== FILTER STATES ===== */
  const [searchBill, setSearchBill] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");

  /* ===== FACTORY STATES ===== */
  const [factories, setFactories] = useState([]);
  const [factoryFilter, setFactoryFilter] = useState("");
  const [loadingFactories, setLoadingFactories] = useState(false);

  /* ===== APPLY FILTERS STATE ===== */
  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: "",
    toDate: "",
    factory: ""
  });

  /* ===== CURSOR PAGINATION STATES ===== */
  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const BILLS_PER_PAGE = 30;

  /* ===== MEMORY STACK ===== */
  const [pageHistory, setPageHistory] = useState([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  const loadFactories = async () => {
    setLoadingFactories(true);
    try {
      const cached = localStorage.getItem("factories");
      if (cached) {
        setFactories(JSON.parse(cached));
        setLoadingFactories(false);
        return;
      }
      const snap = await getDocs(collection(db, "Factories"));
      const list = snap.docs.map(d => d.data().displayName || d.id);
      const sorted = list.sort();
      localStorage.setItem("factories", JSON.stringify(sorted));
      setFactories(sorted);
    } catch (err) {
      console.error("Error loading factories:", err);
    } finally {
      setLoadingFactories(false);
    }
  };

  useEffect(() => {
    loadFactories();
  }, []);

  /* ================= LOAD DATA ================= */
  const load = async () => {
    // Require at least a factory OR a date range — prevent full DB scan if empty
    if (!appliedFilters.factory && !appliedFilters.fromDate && !appliedFilters.toDate) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let queryConstraints = [];
      queryConstraints.push(orderBy("BillDate", "desc"));

      // Optional date range
      if (appliedFilters.fromDate) {
        const fromDateObj = new Date(appliedFilters.fromDate + "T00:00:00");
        queryConstraints.push(where("BillDate", ">=", Timestamp.fromDate(fromDateObj)));
      }

      if (appliedFilters.toDate) {
        const toDateObj = new Date(appliedFilters.toDate + "T23:59:59");
        queryConstraints.push(where("BillDate", "<=", Timestamp.fromDate(toDateObj)));
      }

      // Optional factory filter
      if (appliedFilters.factory) {
        queryConstraints.push(where("FactoryName", "==", appliedFilters.factory));
      }

      // Always fetch ALL matching records — filter unpaid/paid client-side
      const billQuery = query(
        collection(db, "BillTable"),
        ...queryConstraints
      );

      const billSnap = await getDocs(billQuery);
      const docs = billSnap.docs;

      const currentDate = new Date(); // To calculate Invoice Age

      setFirstDoc(null); setLastDoc(null);
      setHasNextPage(false); setHasPrevPage(false);

      const result = docs.map(b => {
        const bill = b.data();
        const billDateObj = toDate(bill.BillDate);
        const bId = b.id;

        let taxAmt = toNum(bill.TaxableAmount);
        let actualAmt = toNum(bill.ActualAmount);

        if (!actualAmt || actualAmt === 0) {
          actualAmt = toNum(bill.TaxableAmount);
          if (actualAmt > 0) {
            actualAmt = actualAmt * 1.18;
          } else {
            actualAmt = 0;
          }
        }

        const paymentReceived = toNum(bill.PaymentReceived);
            
        // Outstanding cannot be negative (overpayment treated as fully settled)
        const outstandingAmt = Math.max(0, actualAmt - paymentReceived);

        // Logic for Vendor Code
        let vendorCode = "";
        const fName = (bill.FactoryName || "").toUpperCase();
        if (fName.includes("ULTRA") || fName.includes("ULTRATECH")) {
          vendorCode = "2307082";
        }

        const fallbackMonthStr = billDateObj ? formatDate(billDateObj).split('-')[1] : null;

        const diffTime = billDateObj ? currentDate - billDateObj : 0;
        const diffDays = billDateObj ? Math.floor(diffTime / (1000 * 60 * 60 * 24)) : 0;

        return {
          BillID: bId,
          "Dispatch Month": bill.DispatchMonth || fallbackMonthStr || "N/A",
          "Invoice / Bill No.": bill.BillNum || "",
          "Vendor Code": vendorCode,
          "Plant code/ Name": bill.FactoryName || "",
          "Bill Type": bill.BillType || "",
          "BILL DATE": formatDate(billDateObj),
          "Invoice Age": diffDays,
          "Invoice Amount": toNum(actualAmt || 0),
          PaymentReceived: paymentReceived,
          PaymentNumber: bill.PaymentNumber || bill.PaymentNum || "",
          Outstanding: outstandingAmt
        };
      });


      const legacyOldBills = ["876", "877", "880", "885"];
      
      // We no longer filter by paid/unpaid based on user request. We show all.
      // But we still block the 60+ empty ghosts (using Invoice Amount > 0),
      // while safely matching the ends of the legacy bill strings (e.g. 2307082-26-876)
      let finalResult = result.filter(r => {
        const billNo = String(r["Invoice / Bill No."]).trim();
        return toNum(r["Invoice Amount"]) > 0 || legacyOldBills.some(old => billNo.endsWith(old));
      });

      setRows(finalResult);
      setDataLoaded(true);

    } catch (error) {
      console.error("Error loading data:", error);
      alert(`Error loading data: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    // Load when any filter changes (factory alone is enough, dates are optional)
    if (appliedFilters.factory || appliedFilters.fromDate || appliedFilters.toDate || appliedFilters.timestamp) {
      load();
    }
  }, [appliedFilters]);

  const applyFilters = () => {
    setFirstDoc(null); setLastDoc(null);
    setHasNextPage(false); setHasPrevPage(false);
    setPageHistory([]); setCurrentPageIndex(0);

    setAppliedFilters({
      fromDate,
      toDate: toDateFilter,
      factory: factoryFilter,
      timestamp: Date.now()
    });
  };

  const clearFilters = () => {
    setSearchBill(""); setFromDate(""); setToDateFilter("");
    setFactoryFilter("");
    setFirstDoc(null); setLastDoc(null);
    setHasNextPage(false); setHasPrevPage(false);
    setPageHistory([]); setCurrentPageIndex(0);

    setAppliedFilters({ fromDate: "", toDate: "", factory: "" });
    setRows([]); setDataLoaded(false);
  };

  const nextPage = () => {
    if (!hasNextPage) return;
    const nextIndex = currentPageIndex + 1;
    if (pageHistory[nextIndex]) {
       const p = pageHistory[nextIndex];
       setRows(p.rows); setFirstDoc(p.firstDoc); setLastDoc(p.lastDoc);
       setHasNextPage(p.hasNextPage); setHasPrevPage(true);
       setCurrentPageIndex(nextIndex);
       return;
    }
    load("next", lastDoc);
    setCurrentPageIndex(nextIndex);
  };

  const prevPage = () => {
    const prevIndex = currentPageIndex - 1;
    if (prevIndex < 0) return;
    const p = pageHistory[prevIndex];
    if (!p) return;
    setRows(p.rows); setFirstDoc(p.firstDoc); setLastDoc(p.lastDoc);
    setHasNextPage(p.hasNextPage); setHasPrevPage(prevIndex > 0);
    setCurrentPageIndex(prevIndex);
  };

  const filteredRows = useMemo(() => {
    let data = [...rows];
    if (searchBill.trim()) {
      const tokens = searchBill.toLowerCase().split(/\s+/);
      data = data.filter(r =>
        tokens.every(t =>
          (r["Plant code/ Name"] || "").toLowerCase().includes(t) ||
          (r["Invoice / Bill No."] || "").toLowerCase().includes(t) ||
          (r["BILL DATE"] || "").toLowerCase().includes(t)
        )
      );
    }
    return data;
  }, [rows, searchBill]);

  const pageTotals = useMemo(() => {
    let totalInv = 0;
    let totalPaid = 0;
    let totalOut = 0;
    filteredRows.forEach(r => {
      totalInv += toNum(r["Invoice Amount"]);
      totalPaid += toNum(r.PaymentReceived);
      totalOut += toNum(r.Outstanding);
    });
    return { totalInv, totalPaid, totalOut };
  }, [filteredRows]);

  const exportToExcel = () => {
    if (!dataLoaded || filteredRows.length === 0) {
      alert("No data to export! Please apply filters first.");
      return;
    }

    setExporting(true);
    try {
      const exportData = filteredRows.map(row => ({
        "Dispatch Month": row["Dispatch Month"],
        "Invoice / Bill No.": row["Invoice / Bill No."],
        "Vendor Code": row["Vendor Code"],
        "Plant code/ Name": row["Plant code/ Name"],
        "Bill Type": row["Bill Type"],
        "BILL DATE": row["BILL DATE"],
        "Invoice Age": row["Invoice Age"],
        "Invoice Amount": toNum(row["Invoice Amount"]),
        "Payment Received": toNum(row.PaymentReceived),
        "Outstanding": toNum(row.Outstanding)
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wscols = [
        { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }
      ];
      ws['!cols'] = wscols;

      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if (!ws[address]) continue;
        ws[address].s = { font: { bold: true }, fill: { fgColor: { rgb: "E0E0E0" } } };
      }

      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        const curCellAddress = XLSX.utils.encode_col(7) + (R + 1); // column H
        if (ws[curCellAddress]) ws[curCellAddress].z = '#,##0.00';
        
        const payCellAddress = XLSX.utils.encode_col(8) + (R + 1); // column I
        if (ws[payCellAddress]) ws[payCellAddress].z = '#,##0.00';

        const outCellAddress = XLSX.utils.encode_col(9) + (R + 1); // column J
        if (ws[outCellAddress]) ws[outCellAddress].z = '#,##0.00';
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Outstanding Report");

      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `Outstanding_Report_${dateStr}.xlsx`);
    } catch (error) {
      console.error("Error exporting data:", error);
    } finally {
       setExporting(false);
    }
  };

  return (
    <div className="outstanding-container">
      <h2>Outstanding Report</h2>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search by Plant, Bill No..."
          value={searchBill}
          onChange={e => setSearchBill(e.target.value)}
          className="filter-input"
        />

        <select
          value={factoryFilter}
          onChange={e => setFactoryFilter(e.target.value)}
          className="filter-input"
          disabled={loadingFactories}
        >
          <option value="">Select Factory</option>
          {factories.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>


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

        <button onClick={applyFilters} disabled={loading} className="filter-button apply-button">
          {loading ? 'Loading...' : 'Apply Filters'}
        </button>
        <button onClick={clearFilters} disabled={loading} className="filter-button clear-button">
          Clear Filters
        </button>

        <button
          onClick={exportToExcel}
          disabled={exporting || filteredRows.length === 0}
          className="export-button"
        >
          {exporting ? 'Exporting...' : 'Export to Excel'}
        </button>
      </div>

      {filteredRows.length > 0 && dataLoaded && (
        <div className="dashboard-summary">
          <div className="summary-card">
            <h4>Total Invoice</h4>
            <p>₹{pageTotals.totalInv.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="summary-card">
            <h4>Total Paid</h4>
            <p className="paid-text">₹{pageTotals.totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="summary-card outstanding-card">
            <h4>Total Outstanding</h4>
            <p className="outstanding-text">₹{pageTotals.totalOut.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        </div>
      )}

      {filteredRows.length > 0 && (
        <div className="pagination-controls">
          <button onClick={prevPage} disabled={loading || !hasPrevPage} className="filter-button" style={{ opacity: !hasPrevPage ? 0.5 : 1 }}>Previous</button>
          <span>Page {currentPageIndex + 1} | Records: {filteredRows.length}</span>
          <button onClick={nextPage} disabled={loading || !hasNextPage} className="filter-button" style={{ opacity: !hasNextPage ? 0.5 : 1 }}>Next</button>
        </div>
      )}

      {loading ? (
        <div className="loading-message">Loading data...</div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th className="table-header">Dispatch Month</th>
                <th className="table-header">Invoice / Bill No.</th>
                <th className="table-header">Vendor Code</th>
                <th className="table-header">Plant code/ Name</th>
                <th className="table-header">Bill Type</th>
                <th className="table-header">BILL DATE</th>
                <th className="table-header">Invoice Age</th>
                <th className="table-header">Invoice Amount</th>
                <th className="table-header">Payment Received</th>
                <th className="table-header">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, i) => (
                <tr key={r.BillID || i}>
                  <td className="table-cell">{r["Dispatch Month"]}</td>
                  <td className="table-cell">{r["Invoice / Bill No."]}</td>
                  <td className="table-cell">{r["Vendor Code"]}</td>
                  <td className="table-cell">{r["Plant code/ Name"]}</td>
                  <td className="table-cell">{r["Bill Type"]}</td>
                  <td className="table-cell">{r["BILL DATE"]}</td>
                  <td className="table-cell" style={{textAlign: 'center'}}>{r["Invoice Age"]}</td>
                  <td className="table-cell amount-cell">{toNum(r["Invoice Amount"]).toFixed(2)}</td>
                  <td className="table-cell amount-cell" style={{fontWeight: "600", color: "#10b981"}}>{toNum(r.PaymentReceived).toFixed(2)}</td>
                  <td className="table-cell amount-cell outstanding-text" style={{fontWeight: "600"}}>{toNum(r.Outstanding).toFixed(2)}</td>
                </tr>
              ))}
              {filteredRows.length === 0 && dataLoaded && (
                <tr>
                  <td colSpan="10" className="no-data-message">No matching records found.</td>
                </tr>
              )}
              {filteredRows.length === 0 && !dataLoaded && (
                <tr>
                  <td colSpan="10" className="no-data-message">Please select a Factory or date range to load data.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default OutstandingReport;
