// ShowPayment.jsx
import React, { useEffect, useState } from "react";
import { collection, getDocs, query, where, Timestamp, updateDoc, doc, serverTimestamp } from "firebase/firestore";
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
  const factories = [...new Set(rows.map(r => r.FactoryName).filter(Boolean))];

  /* ===== PAYMENT TYPE LIST ===== */
  const paymentTypes = ["Has Payment"];

  /* ================= PAGINATION CALCULATIONS ================= */
  const filteredRows = rows.filter(r => {
    // Search filter
    if (appliedFilters.searchTerm.trim()) {
      const tokens = appliedFilters.searchTerm.toLowerCase().split(/\s+/);
      return tokens.every(t =>
        (r.FactoryName || "").toLowerCase().includes(t) ||
        (r.BillNum || "").toLowerCase().includes(t) ||
        (r.PaymentNumber || "").toLowerCase().includes(t) ||
        (r.BillType || "").toLowerCase().includes(t)
      );
    }
    return true;
  }).filter(r => {
    // Factory filter
    if (appliedFilters.factoryFilter) {
      return (r.FactoryName || "").toLowerCase() === appliedFilters.factoryFilter.toLowerCase();
    }
    return true;
  }).filter(r => {
    // Payment type filter
    if (appliedFilters.paymentTypeFilter === "Has Payment") {
      return r.PaymentNumber && r.PaymentNumber.trim() !== "";
    }
    return true;
  }).filter(r => {
    // Date filtering
    if (appliedFilters.fromDate) {
      const fromDateObj = new Date(appliedFilters.fromDate);
      fromDateObj.setHours(0, 0, 0, 0);
      if (!r.PaymentDate) return false;
      return r.PaymentDate >= fromDateObj;
    }
    return true;
  }).filter(r => {
    if (appliedFilters.toDate) {
      const toDateObj = new Date(appliedFilters.toDate);
      toDateObj.setHours(23, 59, 59, 999);
      if (!r.PaymentDate) return false;
      return r.PaymentDate <= toDateObj;
    }
    return true;
  });

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
            className="filter-select"
          >
            <option value="">All Payments</option>
            {paymentTypes.map(pt => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
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
            onClick={applyFilters}
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
            {exporting ? 'Exporting...' : 'Export All to Excel'}
          </button>
          
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

      {/* ===== RECORDS PER PAGE SELECTOR ===== */}
      <div className="records-selector">
        <div className="records-controls">
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

      {/* ===== DELETE & EXPORT CONTROLS (Only for Admin) ===== */}
      {isAdmin && (
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
                  No payment records found. Try adjusting your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== PAGINATION CONTROLS ===== */}
      {!loading && totalRecords > 0 && (
        <div className="pagination-container">
          <div className="pagination-controls">
            <span style={{ fontWeight: 'bold', marginRight: 10 }}>Page {currentPage} of {totalPages}</span>
            
            {/* First and Previous buttons */}
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className={`page-button ${currentPage === 1 ? 'disabled-page-button' : ''}`}
              title="First Page"
            >
              ««
            </button>
            
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className={`page-button ${currentPage === 1 ? 'disabled-page-button' : ''}`}
              title="Previous Page"
            >
              «
            </button>
            
            {/* Page number buttons */}
            <div style={{ display: 'flex', gap: 5 }}>
              {/* Show first page if not in first 3 pages */}
              {currentPage > 3 && totalPages > 1 && (
                <>
                  <button
                    onClick={() => handlePageChange(1)}
                    className="page-button"
                  >
                    1
                  </button>
                  {currentPage > 4 && <span style={{ padding: '8px 0' }}>...</span>}
                </>
              )}
              
              {/* Show pages around current page */}
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
                    className={`page-button ${currentPage === pageNum ? 'current-page-button' : ''}`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              
              {/* Show last page if not in last 3 pages */}
              {currentPage < totalPages - 2 && totalPages > 1 && (
                <>
                  {currentPage < totalPages - 3 && <span style={{ padding: '8px 0' }}>...</span>}
                  <button
                    onClick={() => handlePageChange(totalPages)}
                    className="page-button"
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
              className={`page-button ${currentPage === totalPages ? 'disabled-page-button' : ''}`}
              title="Next Page"
            >
              »
            </button>
            
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className={`page-button ${currentPage === totalPages ? 'disabled-page-button' : ''}`}
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
                if (page >= 1 && page <= totalPages) {
                  handlePageChange(page);
                } else {
                  e.target.value = currentPage;
                }
              }}
              className="go-to-page-input"
            />
          </div>
        </div>
      )}

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