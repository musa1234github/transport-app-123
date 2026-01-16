import React, { useEffect, useState, useMemo } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp
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
    console.error("Error formatting date:", date, error);
    return "";
  }
};

/* ===== FORMAT CURRENCY ===== */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

const ShowPayment = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);

  /* ===== PAGINATION STATES ===== */
  const [currentPage, setCurrentPage] = useState(1);
  const [recordsPerPage, setRecordsPerPage] = useState(20);

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

  /* ================= LOAD PAYMENT DATA ================= */
  const load = async () => {
    setLoading(true);
    try {
      // First get all bills with payments
      const billQuery = query(
        collection(db, "BillTable"),
        where("PaymentReceived", ">", 0)
      );
      
      const billSnap = await getDocs(billQuery);
      const billData = [];
      
      // Get payment details for each bill
      for (const billDoc of billSnap.docs) {
        const bill = billDoc.data();
        
        let paymentDetails = {};
        if (bill.PId) {
          // Fetch payment details from PaymentTable
          const paymentQuery = query(
            collection(db, "PaymentTable"),
            where("__name__", "==", bill.PId)
          );
          const paymentSnap = await getDocs(paymentQuery);
          if (!paymentSnap.empty) {
            const paymentData = paymentSnap.docs[0].data();
            paymentDetails = {
              DocNumber: paymentData.DocNumber || "",
              PayRecDate: toDate(paymentData.PayRecDate) || null,
              Shortage: paymentData.Shortage || 0
            };
          }
        }

        // Calculate total shortage for this payment number
        let totalShortage = 0;
        if (paymentDetails.DocNumber) {
          const shortageQuery = query(
            collection(db, "BillTable"),
            where("PaymentNumber", "==", paymentDetails.DocNumber)
          );
          const shortageSnap = await getDocs(shortageQuery);
          shortageSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.Shortage) {
              totalShortage += toNum(data.Shortage);
            }
          });
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
          PaymentDate: paymentDetails.PayRecDate,
          Shortage: paymentDetails.Shortage || 0,
          TotalShortage: totalShortage,
          BillDateObj: toDate(bill.BillDate),
          BillDateSortKey: formatDate(toDate(bill.BillDate))
        });
      }

      // Sort by payment date (newest first)
      billData.sort((a, b) => {
        if (a.PaymentDate && b.PaymentDate) {
          return b.PaymentDate - a.PaymentDate;
        }
        return 0;
      });

      setRows(billData);
      setSelectedPayments([]);
      setSelectAll(false);
      setCurrentPage(1);
    } catch (error) {
      console.error("Error loading payment data:", error);
    } finally {
      setLoading(false);
    }
  };

  /* ===== LOAD WHEN APPLIED FILTERS CHANGE ===== */
  useEffect(() => {
    load();
  }, [appliedFilters]);

  /* ===== APPLY FILTERS FUNCTION ===== */
  const applyFilters = () => {
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
  };

  /* ===== FACTORY LIST ===== */
  const factories = useMemo(
    () => [...new Set(rows.map(r => r.FactoryName).filter(Boolean))],
    [rows]
  );

  /* ===== PAYMENT TYPE LIST ===== */
  const paymentTypes = useMemo(() => {
    const types = new Set();
    rows.forEach(r => {
      if (r.PaymentNumber) types.add("Has Payment");
    });
    return Array.from(types);
  }, [rows]);

  /* ================= PAGINATION CALCULATIONS ================= */
  const filteredRows = useMemo(() => {
    let data = [...rows];

    // Search filter
    if (appliedFilters.searchTerm.trim()) {
      const tokens = appliedFilters.searchTerm.toLowerCase().split(/\s+/);
      data = data.filter(r =>
        tokens.every(t =>
          (r.FactoryName || "").toLowerCase().includes(t) ||
          (r.BillNum || "").toLowerCase().includes(t) ||
          (r.PaymentNumber || "").toLowerCase().includes(t) ||
          (r.BillType || "").toLowerCase().includes(t)
        )
      );
    }

    // Factory filter
    if (appliedFilters.factoryFilter) {
      data = data.filter(
        r => (r.FactoryName || "").toLowerCase() === appliedFilters.factoryFilter.toLowerCase()
      );
    }

    // Payment type filter
    if (appliedFilters.paymentTypeFilter === "Has Payment") {
      data = data.filter(r => r.PaymentNumber && r.PaymentNumber.trim() !== "");
    }

    // Date filtering
    if (appliedFilters.fromDate) {
      const fromDateObj = new Date(appliedFilters.fromDate);
      fromDateObj.setHours(0, 0, 0, 0);
      data = data.filter(r => {
        if (!r.PaymentDate) return false;
        return r.PaymentDate >= fromDateObj;
      });
    }

    if (appliedFilters.toDate) {
      const toDateObj = new Date(appliedFilters.toDate);
      toDateObj.setHours(23, 59, 59, 999);
      data = data.filter(r => {
        if (!r.PaymentDate) return false;
        return r.PaymentDate <= toDateObj;
      });
    }

    return data;
  }, [rows, appliedFilters]);

  // Calculate pagination values
  const totalRecords = filteredRows.length;
  const totalPages = Math.ceil(totalRecords / recordsPerPage);
  
  // Ensure current page is valid
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Get current page data
  const indexOfLastRecord = currentPage * recordsPerPage;
  const indexOfFirstRecord = indexOfLastRecord - recordsPerPage;
  const currentRecords = filteredRows.slice(indexOfFirstRecord, indexOfLastRecord);

  // Handle page change
  const handlePageChange = (pageNumber) => {
    if (pageNumber >= 1 && pageNumber <= totalPages) {
      setCurrentPage(pageNumber);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Handle records per page change
  const handleRecordsPerPageChange = (e) => {
    const newRecordsPerPage = parseInt(e.target.value);
    setRecordsPerPage(newRecordsPerPage);
    setCurrentPage(1);
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
        { wch: 20 }, // Factory Name
        { wch: 20 }, // Bill Number
        { wch: 12 }, // Bill Date
        { wch: 20 }, // Payment Number
        { wch: 12 }, // Payment Date
        { wch: 15 }, // Actual Amount
        { wch: 12 }, // TDS
        { wch: 12 }, // GST
        { wch: 15 }, // Payment Received
        { wch: 12 }, // Shortage
        { wch: 15 }, // Total Shortage
        { wch: 20 }  // Bill Type
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

      // Format number columns
      const numberColumns = ["Actual Amount", "TDS", "GST", "Payment Received", "Shortage", "Total Shortage"];
      const colIndexMap = {};
      Object.keys(exportData[0]).forEach((key, index) => {
        colIndexMap[key] = index;
      });

      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        numberColumns.forEach(colName => {
          const colIndex = colIndexMap[colName];
          if (colIndex !== undefined) {
            const cellAddress = XLSX.utils.encode_col(colIndex) + (R + 1);
            if (ws[cellAddress]) {
              ws[cellAddress].z = '#,##0.00';
            }
          }
        });
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

  /* ===== DELETE PAYMENT FUNCTION ===== */
  const deleteSelectedPayments = async () => {
    if (selectedPayments.length === 0) {
      alert("Please select payments to delete");
      return;
    }

    setShowConfirmDelete(true);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      for (const billId of selectedPayments) {
        // Reset payment fields in BillTable
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
      alert(`Successfully reset ${selectedPayments.length} payment(s)`);
    } catch (error) {
      console.error("Error deleting payments:", error);
      alert(`Error deleting payments: ${error.message}`);
    } finally {
      setDeleting(false);
      setShowConfirmDelete(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Payment Report</h2>

      {/* ===== FILTER BAR ===== */}
      <div style={{ 
        marginBottom: 15, 
        padding: 15, 
        backgroundColor: '#f5f5f5', 
        borderRadius: 5,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        alignItems: 'center'
      }}>
        <div>
          <input
            type="text"
            placeholder="Search factory, bill no, payment no"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ width: 250, padding: 8 }}
          />
        </div>

        <div>
          <select
            value={factoryFilter}
            onChange={e => setFactoryFilter(e.target.value)}
            style={{ padding: 8, width: 200 }}
          >
            <option value="">Select Factory</option>
            {factories.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={paymentTypeFilter}
            onChange={e => setPaymentTypeFilter(e.target.value)}
            style={{ padding: 8, width: 200 }}
          >
            <option value="">All Payments</option>
            {paymentTypes.map(pt => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <label>From:</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            style={{ padding: 8 }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
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
            onClick={applyFilters}
            disabled={loading}
            style={{ 
              padding: '8px 16px', 
              backgroundColor: '#4CAF50', 
              color: 'white', 
              border: 'none', 
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Loading...' : 'Apply Filters'}
          </button>
          <button 
            onClick={clearFilters}
            disabled={loading}
            style={{ 
              padding: '8px 16px', 
              backgroundColor: '#f44336', 
              color: 'white', 
              border: 'none', 
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            Clear Filters
          </button>
        </div>

        {/* ===== EXPORT BUTTONS ===== */}
        <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
          <button 
            onClick={exportToExcel}
            disabled={exporting || filteredRows.length === 0}
            style={{ 
              padding: '8px 16px', 
              backgroundColor: '#2196F3', 
              color: 'white', 
              border: 'none', 
              borderRadius: 4,
              cursor: (exporting || filteredRows.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (exporting || filteredRows.length === 0) ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 5
            }}
            title="Export all filtered payments to Excel"
          >
            {exporting ? 'Exporting...' : 'Export All to Excel'}
          </button>
          
          {selectedPayments.length > 0 && (
            <button 
              onClick={exportSelectedToExcel}
              disabled={exporting}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: '#FF9800', 
                color: 'white', 
                border: 'none', 
                borderRadius: 4,
                cursor: exporting ? 'not-allowed' : 'pointer',
                opacity: exporting ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
              title={`Export ${selectedPayments.length} selected payments to Excel`}
            >
              {exporting ? 'Exporting...' : `Export Selected (${selectedPayments.length})`}
            </button>
          )}
        </div>

        {/* Applied filters indicator */}
        {(appliedFilters.fromDate || appliedFilters.toDate || appliedFilters.searchTerm || appliedFilters.factoryFilter || appliedFilters.paymentTypeFilter) && (
          <div style={{ fontSize: 12, color: '#666', display: 'flex', gap: 10, width: '100%', marginTop: 10 }}>
            {appliedFilters.fromDate || appliedFilters.toDate ? (
              <span>
                Payment Date: {appliedFilters.fromDate || 'Any'} to {appliedFilters.toDate || 'Any'}
              </span>
            ) : null}
            {appliedFilters.searchTerm && (
              <span>Search: "{appliedFilters.searchTerm}"</span>
            )}
            {appliedFilters.factoryFilter && (
              <span>Factory: {appliedFilters.factoryFilter}</span>
            )}
            {appliedFilters.paymentTypeFilter && (
              <span>Type: {appliedFilters.paymentTypeFilter}</span>
            )}
          </div>
        )}
      </div>

      {/* ===== RECORDS PER PAGE SELECTOR ===== */}
      <div style={{ 
        marginBottom: 15, 
        padding: 10, 
        backgroundColor: '#f8f9fa', 
        borderRadius: 5,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        border: '1px solid #dee2e6'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 'bold' }}>Records per page:</span>
          <select 
            value={recordsPerPage} 
            onChange={handleRecordsPerPageChange}
            style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid #ccc' }}
            disabled={loading}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
          
          <span style={{ marginLeft: 20, color: '#666' }}>
            Showing {indexOfFirstRecord + 1} to {Math.min(indexOfLastRecord, totalRecords)} of {totalRecords} records
          </span>
        </div>
        
        <div style={{ fontWeight: 'bold', color: '#495057' }}>
          Total Payments: {totalRecords}
        </div>
      </div>

      {/* ===== DELETE & EXPORT CONTROLS ===== */}
      <div style={{ 
        marginBottom: 15, 
        padding: 10, 
        backgroundColor: selectedPayments.length > 0 ? '#fff3cd' : '#e9ecef',
        borderRadius: 5,
        border: selectedPayments.length > 0 ? '1px solid #ffc107' : '1px solid #dee2e6',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
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
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#FF9800',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: exporting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5
                }}
              >
                {exporting ? 'Exporting...' : `Export ${selectedPayments.length} Selected`}
              </button>
              <button
                onClick={deleteSelectedPayments}
                disabled={deleting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold'
                }}
              >
                {deleting ? 'Resetting...' : `Reset Selected (${selectedPayments.length})`}
              </button>
            </>
          )}
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 20 }}>Loading payment data...</div>}
      {exporting && <div style={{ textAlign: 'center', padding: 10, color: '#2196F3' }}>Exporting to Excel...</div>}

      {/* ===== PAYMENT TABLE ===== */}
      <div style={{ overflowX: 'auto' }}>
        <table border="1" width="100%" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <th style={{ padding: 10, textAlign: 'center', width: '40px' }}>
                <input
                  type="checkbox"
                  checked={selectAll && currentRecords.length > 0}
                  onChange={handleSelectAll}
                  disabled={currentRecords.length === 0 || loading}
                />
              </th>
              <th style={{ padding: 10 }}>Factory Name</th>
              <th style={{ padding: 10 }}>Bill Number</th>
              <th style={{ padding: 10 }}>Bill Date</th>
              <th style={{ padding: 10 }}>Payment Number</th>
              <th style={{ padding: 10 }}>Payment Date</th>
              <th style={{ padding: 10 }}>Actual Amount</th>
              <th style={{ padding: 10 }}>TDS</th>
              <th style={{ padding: 10 }}>GST</th>
              <th style={{ padding: 10 }}>Payment Received</th>
              <th style={{ padding: 10 }}>Shortage</th>
              <th style={{ padding: 10 }}>Bill Type</th>
            </tr>
          </thead>
          <tbody>
            {!loading && currentRecords.length > 0 ? (
              currentRecords.map((r, i) => (
                <tr key={i} style={{ 
                  textAlign: 'center',
                  backgroundColor: selectedPayments.includes(r.id) ? '#f8d7da' : 'inherit'
                }}>
                  <td style={{ padding: 8, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedPayments.includes(r.id)}
                      onChange={() => handleSelectPayment(r.id)}
                      disabled={loading}
                    />
                  </td>
                  <td style={{ padding: 8 }}>{r.FactoryName}</td>
                  <td style={{ padding: 8 }}>{r.BillNum}</td>
                  <td style={{ padding: 8 }}>{r.BillDate ? formatDate(r.BillDate) : "N/A"}</td>
                  <td style={{ padding: 8, fontWeight: r.PaymentNumber ? 'bold' : 'normal' }}>
                    {r.PaymentNumber || "N/A"}
                  </td>
                  <td style={{ padding: 8 }}>{r.PaymentDate ? formatDate(r.PaymentDate) : "N/A"}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{formatCurrency(r.ActualAmount)}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{formatCurrency(r.Tds)}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{formatCurrency(r.Gst)}</td>
                  <td style={{ padding: 8, textAlign: 'right', fontWeight: 'bold', color: '#28a745' }}>
                    {formatCurrency(r.PaymentReceived)}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right', color: r.Shortage > 0 ? '#dc3545' : '#28a745' }}>
                    {formatCurrency(r.Shortage)}
                  </td>
                  <td style={{ padding: 8 }}>{r.BillType || "N/A"}</td>
                </tr>
              ))
            ) : !loading && (
              <tr>
                <td colSpan="12" style={{ textAlign: 'center', padding: 20 }}>
                  No payment records found. Try adjusting your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== PAGINATION CONTROLS ===== */}
      {!loading && totalRecords > 0 && (
        <div style={{ 
          marginTop: 20, 
          padding: 15, 
          backgroundColor: '#f8f9fa', 
          borderRadius: 5,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: '1px solid #dee2e6'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontWeight: 'bold', marginRight: 10 }}>Page {currentPage} of {totalPages}</span>
            
            {/* First and Previous buttons */}
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              style={{
                padding: '8px 12px',
                backgroundColor: currentPage === 1 ? '#e9ecef' : '#007bff',
                color: currentPage === 1 ? '#6c757d' : 'white',
                border: 'none',
                borderRadius: 4,
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                fontWeight: 'bold'
              }}
              title="First Page"
            >
              ««
            </button>
            
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              style={{
                padding: '8px 12px',
                backgroundColor: currentPage === 1 ? '#e9ecef' : '#007bff',
                color: currentPage === 1 ? '#6c757d' : 'white',
                border: 'none',
                borderRadius: 4,
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
              }}
              title="Previous Page"
            >
              «
            </button>
            
            {/* Page number buttons */}
            <div style={{ display: 'flex', gap: 5 }}>
              {currentPage > 3 && (
                <>
                  <button
                    onClick={() => handlePageChange(1)}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  >
                    1
                  </button>
                  {currentPage > 4 && <span style={{ padding: '8px 0' }}>...</span>}
                </>
              )}
              
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
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
                    onClick={() => handlePageChange(pageNum)}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: currentPage === pageNum ? '#495057' : '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontWeight: currentPage === pageNum ? 'bold' : 'normal'
                    }}
                  >
                    {pageNum}
                  </button>
                );
              })}
              
              {currentPage < totalPages - 2 && (
                <>
                  {currentPage < totalPages - 3 && <span style={{ padding: '8px 0' }}>...</span>}
                  <button
                    onClick={() => handlePageChange(totalPages)}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  >
                    {totalPages}
                  </button>
                </>
              )}
            </div>
            
            {/* Next and Last buttons */}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              style={{
                padding: '8px 12px',
                backgroundColor: currentPage === totalPages ? '#e9ecef' : '#007bff',
                color: currentPage === totalPages ? '#6c757d' : 'white',
                border: 'none',
                borderRadius: 4,
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
              }}
              title="Next Page"
            >
              »
            </button>
            
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              style={{
                padding: '8px 12px',
                backgroundColor: currentPage === totalPages ? '#e9ecef' : '#007bff',
                color: currentPage === totalPages ? '#6c757d' : 'white',
                border: 'none',
                borderRadius: 4,
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                fontWeight: 'bold'
              }}
              title="Last Page"
            >
              »»
            </button>
          </div>
          
          {/* Go to page input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>Go to page:</span>
            <input
              type="number"
              min="1"
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const page = parseInt(e.target.value);
                if (page >= 1 && page <= totalPages) {
                  handlePageChange(page);
                }
              }}
              onBlur={(e) => {
                const page = parseInt(e.target.value);
                if (!page || page < 1 || page > totalPages) {
                  e.target.value = currentPage;
                }
              }}
              style={{
                width: '60px',
                padding: '5px',
                textAlign: 'center',
                border: '1px solid #ccc',
                borderRadius: 4
              }}
            />
            <span>of {totalPages}</span>
          </div>
        </div>
      )}

      {/* ===== CONFIRM DELETE MODAL ===== */}
      {showConfirmDelete && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '8px',
            maxWidth: '500px',
            width: '90%',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ marginTop: 0, color: '#dc3545' }}>Reset Payments</h3>
            <p>
              Are you sure you want to reset payment information for <strong>{selectedPayments.length}</strong> selected bill(s)?
            </p>
            <p style={{ color: '#666', fontSize: '14px', marginTop: '10px' }}>
              <strong>Note:</strong> This will reset payment received, TDS, GST, and payment number fields to zero/null, but will not delete the bill itself.
            </p>
            
            <div style={{ 
              marginTop: '25px', 
              display: 'flex', 
              justifyContent: 'flex-end',
              gap: '10px'
            }}>
              <button
                onClick={() => setShowConfirmDelete(false)}
                disabled={deleting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {deleting ? 'Resetting...' : 'Reset Payments'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShowPayment;