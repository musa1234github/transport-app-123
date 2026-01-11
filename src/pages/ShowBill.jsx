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
    // Ensure it's a valid date
    if (isNaN(date.getTime())) return "";
    
    // Format as dd-MMM-yyyy (e.g., 05-Jan-2026) to match Excel format
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

/* ===== FORMAT FOR SORTING ===== */
const formatDateForSort = (date) => {
  if (!date) return "";
  try {
    if (isNaN(date.getTime())) return "";
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch (error) {
    console.error("Error formatting date for sort:", date, error);
    return "";
  }
};

/* ===== GET DISPATCH MONTH FROM DISPATCH DATES ===== */
const getDispatchMonth = (dispatchRows) => {
  if (!dispatchRows || dispatchRows.length === 0) return "";
  
  // Get unique months from all dispatch dates
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const monthsSet = new Set();
  
  dispatchRows.forEach(dispatch => {
    if (dispatch.DispatchDate) {
      // Parse the formatted date (dd-MMM-yyyy)
      const parts = dispatch.DispatchDate.split('-');
      if (parts.length === 3) {
        const month = parts[1]; // This should be the 3-letter month
        if (monthNames.includes(month)) {
          monthsSet.add(month);
        }
      }
    }
  });
  
  // If multiple months, show them comma-separated
  const monthsArray = Array.from(monthsSet).sort((a, b) => 
    monthNames.indexOf(a) - monthNames.indexOf(b)
  );
  
  return monthsArray.join(', ');
};

const ShowBill = () => {
  const [rows, setRows] = useState([]);
  const [dispatchRows, setDispatchRows] = useState({});
  const [selectedBillId, setSelectedBillId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedBills, setSelectedBills] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);

  /* ===== PAGINATION STATES ===== */
  const [currentPage, setCurrentPage] = useState(1);
  const [recordsPerPage, setRecordsPerPage] = useState(20);

  /* ===== FILTER STATES ===== */
  const [searchBill, setSearchBill] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState("");

  /* ===== APPLY FILTERS STATE ===== */
  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: "",
    toDate: "",
    searchBill: "",
    factoryFilter: ""
  });

  /* ================= LOAD DATA ================= */
  const load = async () => {
    setLoading(true);
    try {
      // Create base query
      let queryConstraints = [orderBy("BillDate", "asc")];

      // Add date filters if they exist in appliedFilters
      if (appliedFilters.fromDate) {
        const fromDateObj = new Date(appliedFilters.fromDate);
        fromDateObj.setHours(0, 0, 0, 0);
        queryConstraints.push(where("BillDate", ">=", Timestamp.fromDate(fromDateObj)));
      }

      if (appliedFilters.toDate) {
        const toDateObj = new Date(appliedFilters.toDate);
        toDateObj.setHours(23, 59, 59, 999);
        queryConstraints.push(where("BillDate", "<=", Timestamp.fromDate(toDateObj)));
      }

      const billQuery = query(collection(db, "BillTable"), ...queryConstraints);

      const billSnap = await getDocs(billQuery);
      const dispSnap = await getDocs(collection(db, "TblDispatch"));

      const billMap = {};
      billSnap.docs.forEach(b => (billMap[b.id] = b.data()));

      const reportMap = {};
      const dispatchMap = {};

      dispSnap.docs.forEach(d => {
        const r = d.data();
        if (!r.BillID || !billMap[r.BillID]) return;

        const bill = billMap[r.BillID];
        const billDateObj = toDate(bill.BillDate);
        const billDateDisplay = formatDate(billDateObj);
        const billDateSortKey = formatDateForSort(billDateObj);

        if (!dispatchMap[r.BillID]) dispatchMap[r.BillID] = [];

        const dispatchDateObj = toDate(r.DispatchDate);
        const dispatchDateDisplay = formatDate(dispatchDateObj);
        const dispatchDateSortKey = formatDateForSort(dispatchDateObj);
        
        dispatchMap[r.BillID].push({
          id: d.id,
          ChallanNo: r.ChallanNo || "",
          DispatchDate: dispatchDateDisplay,
          DispatchDateSortKey: dispatchDateSortKey,
          Quantity: toNum(r.DispatchQuantity),
          UnitPrice: toNum(r.UnitPrice),
          FinalPrice: toNum(r.FinalPrice),
          VehicleNo: r.VehicleNo || "",
          LRNo: r.LRNo || "",
          DeliveryNum: r.DeliveryNum || ""
        });

        if (!reportMap[r.BillID]) {
          reportMap[r.BillID] = {
            BillID: r.BillID,
            "Dispatch Month": "", // Will be calculated later
            "Factory Name": bill.FactoryName || "",
            "Bill Num": bill.BillNum || "",
            "LR Quantity": 0,
            "Bill Quantity": 0,
            "Taxable Amount": 0,
            "Final Price": 0,
            FINAL_RAW: 0, // For internal calculation
            "Actual Amount": 0,
            "TDS": 0,
            "GST": 0,
            "Bill Date": billDateDisplay,
            "Bill Type": bill.BillType || "",
            BillDateObj: billDateObj,
            BillDateSortKey: billDateSortKey,
            HAS_ZERO_FINAL: false
          };
        }

        reportMap[r.BillID]["LR Quantity"] += 1;
        reportMap[r.BillID]["Bill Quantity"] += toNum(r.DispatchQuantity);

        const taxable = toNum(r.DispatchQuantity) * toNum(r.UnitPrice);
        const finalPrice = toNum(r.FinalPrice);

        reportMap[r.BillID]["Taxable Amount"] += taxable;
        reportMap[r.BillID].FINAL_RAW += finalPrice;

        if (finalPrice === 0) {
          reportMap[r.BillID].HAS_ZERO_FINAL = true;
        }
      });

      // Calculate dispatch month for each bill
      Object.keys(reportMap).forEach(billId => {
        if (dispatchMap[billId]) {
          reportMap[billId]["Dispatch Month"] = getDispatchMonth(dispatchMap[billId]);
        }
      });

      const result = Object.values(reportMap).map(r => {
        const totalTaxable = r["Taxable Amount"];
        const totalFinal = r.FINAL_RAW;

        const useFinal =
          !r.HAS_ZERO_FINAL &&
          totalFinal > 0 &&
          totalFinal < totalTaxable;

        const base = useFinal ? totalFinal : totalTaxable;

        // Calculate values according to Excel format
        const tds = base * 0.00984;
        const gst = base * 0.18;
        const actualAmount = base + gst;
        
        return {
          ...r,
          "LR Quantity": r["LR Quantity"],
          "Bill Quantity": r["Bill Quantity"].toFixed(2),
          "Taxable Amount": totalTaxable.toFixed(2),
          "Final Price": useFinal ? totalFinal.toFixed(2) : "0.00",
          "Actual Amount": actualAmount.toFixed(2),
          "TDS": tds.toFixed(2),
          "GST": gst.toFixed(2)
        };
      });

      // Sort by date (newest first by default)
      result.sort((a, b) => {
        if (a.BillDateObj && b.BillDateObj) {
          return b.BillDateObj - a.BillDateObj;
        }
        return 0;
      });

      setRows(result);
      setDispatchRows(dispatchMap);
      // Reset selected bills and pagination when data reloads
      setSelectedBills([]);
      setSelectAll(false);
      setCurrentPage(1);
    } catch (error) {
      console.error("Error loading data:", error);
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
      searchBill: searchBill,
      factoryFilter: factoryFilter
    });
  };

  /* ===== CLEAR FILTERS FUNCTION ===== */
  const clearFilters = () => {
    setSearchBill("");
    setFactoryFilter("");
    setFromDate("");
    setToDateFilter("");
    setAppliedFilters({
      fromDate: "",
      toDate: "",
      searchBill: "",
      factoryFilter: ""
    });
  };

  /* ===== FACTORY LIST ===== */
  const factories = useMemo(
    () => [...new Set(rows.map(r => r["Factory Name"]).filter(Boolean))],
    [rows]
  );

  /* ================= PAGINATION CALCULATIONS ================= */
  const filteredRows = useMemo(() => {
    let data = [...rows];

    // Search filter
    if (appliedFilters.searchBill.trim()) {
      const tokens = appliedFilters.searchBill.toLowerCase().split(/\s+/);
      data = data.filter(r =>
        tokens.every(t =>
          (r["Factory Name"] || "").toLowerCase().includes(t) ||
          (r["Bill Num"] || "").toLowerCase().includes(t) ||
          (r["Bill Date"] || "").toLowerCase().includes(t) ||
          (r["Dispatch Month"] || "").toLowerCase().includes(t)
        )
      );
    }

    // Factory filter
    if (appliedFilters.factoryFilter) {
      data = data.filter(
        r => (r["Factory Name"] || "").toLowerCase() === appliedFilters.factoryFilter.toLowerCase()
      );
    }

    // Client-side date filtering (as backup)
    if (appliedFilters.fromDate) {
      const fromDateObj = new Date(appliedFilters.fromDate);
      fromDateObj.setHours(0, 0, 0, 0);
      data = data.filter(r => {
        if (!r.BillDateObj) return false;
        return r.BillDateObj >= fromDateObj;
      });
    }

    if (appliedFilters.toDate) {
      const toDateObj = new Date(appliedFilters.toDate);
      toDateObj.setHours(23, 59, 59, 999);
      data = data.filter(r => {
        if (!r.BillDateObj) return false;
        return r.BillDateObj <= toDateObj;
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

  const displayRows = selectedBillId
    ? filteredRows.filter(r => r.BillID === selectedBillId)
    : currentRecords;

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

  // Sort dispatch rows by date
  const getSortedDispatchRows = (billId) => {
    if (!dispatchRows[billId]) return [];
    return [...dispatchRows[billId]].sort((a, b) => {
      return new Date(a.DispatchDateSortKey) - new Date(b.DispatchDateSortKey);
    });
  };

  /* ===== CHECKBOX HANDLERS ===== */
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedBills([]);
    } else {
      const allBillIds = displayRows.map(row => row.BillID);
      setSelectedBills(allBillIds);
    }
    setSelectAll(!selectAll);
  };

  const handleSelectBill = (billId) => {
    if (selectedBills.includes(billId)) {
      setSelectedBills(selectedBills.filter(id => id !== billId));
    } else {
      setSelectedBills([...selectedBills, billId]);
    }
  };

  /* ================= EXPORT TO EXCEL ================= */
  const exportToExcel = () => {
    setExporting(true);
    try {
      // Prepare data for export - in exact Excel format sequence
      const exportData = filteredRows.map(row => {
        return {
          "Dispatch Month": row["Dispatch Month"] || "",
          "Factory Name": row["Factory Name"] || "",
          "Bill Num": row["Bill Num"] || "",
          "LR Quantity": toNum(row["LR Quantity"]),
          "Bill Quantity": toNum(row["Bill Quantity"]),
          "Taxable Amount": toNum(row["Taxable Amount"]),
          "Final Price": toNum(row["Final Price"]),
          "Actual Amount": toNum(row["Actual Amount"]),
          "TDS": toNum(row["TDS"]),
          "GST": toNum(row["GST"]),
          "Bill Date": row["Bill Date"] || "",
          "Bill Type": row["Bill Type"] || ""
        };
      });

      if (exportData.length === 0) {
        alert("No data to export!");
        setExporting(false);
        return;
      }

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths to match Excel format
      const wscols = [
        { wch: 15 }, // Dispatch Month
        { wch: 20 }, // Factory Name
        { wch: 20 }, // Bill Num
        { wch: 12 }, // LR Quantity
        { wch: 15 }, // Bill Quantity
        { wch: 15 }, // Taxable Amount
        { wch: 15 }, // Final Price
        { wch: 15 }, // Actual Amount
        { wch: 12 }, // TDS
        { wch: 12 }, // GST
        { wch: 12 }, // Bill Date
        { wch: 20 }  // Bill Type
      ];
      ws['!cols'] = wscols;

      // Add some styling (bold headers)
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if (!ws[address]) continue;
        ws[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E0E0E0" } }
        };
      }

      // Format number columns with 2 decimal places
      const numberColumns = ["LR Quantity", "Bill Quantity", "Taxable Amount", "Final Price", 
                           "Actual Amount", "TDS", "GST"];
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
      XLSX.utils.book_append_sheet(wb, ws, "Bills Report");

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `Bills_Report_${dateStr}.xlsx`;

      // Export file
      XLSX.writeFile(wb, fileName);
      
      alert(`Exported ${exportData.length} bills to ${fileName}`);
    } catch (error) {
      console.error("Error exporting to Excel:", error);
      alert("Error exporting to Excel: " + error.message);
    } finally {
      setExporting(false);
    }
  };

  /* ================= EXPORT SELECTED BILLS TO EXCEL ================= */
  const exportSelectedToExcel = () => {
    if (selectedBills.length === 0) {
      alert("Please select bills to export");
      return;
    }

    setExporting(true);
    try {
      // Filter rows for selected bills
      const allFilteredRows = filteredRows;
      const selectedRows = allFilteredRows.filter(row => selectedBills.includes(row.BillID));
      
      // Prepare data for export - in exact Excel format sequence
      const exportData = selectedRows.map(row => {
        return {
          "Dispatch Month": row["Dispatch Month"] || "",
          "Factory Name": row["Factory Name"] || "",
          "Bill Num": row["Bill Num"] || "",
          "LR Quantity": toNum(row["LR Quantity"]),
          "Bill Quantity": toNum(row["Bill Quantity"]),
          "Taxable Amount": toNum(row["Taxable Amount"]),
          "Final Price": toNum(row["Final Price"]),
          "Actual Amount": toNum(row["Actual Amount"]),
          "TDS": toNum(row["TDS"]),
          "GST": toNum(row["GST"]),
          "Bill Date": row["Bill Date"] || "",
          "Bill Type": row["Bill Type"] || ""
        };
      });

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths
      const wscols = [
        { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }
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
      XLSX.utils.book_append_sheet(wb, ws, "Selected Bills");

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `Selected_Bills_${selectedBills.length}_${dateStr}.xlsx`;

      // Export file
      XLSX.writeFile(wb, fileName);
      
      alert(`Exported ${selectedBills.length} selected bills to ${fileName}`);
    } catch (error) {
      console.error("Error exporting selected bills:", error);
      alert("Error exporting selected bills: " + error.message);
    } finally {
      setExporting(false);
    }
  };

  /* ===== DELETE BILL FUNCTION ===== */
  const deleteSelectedBills = async () => {
    if (selectedBills.length === 0) {
      alert("Please select bills to delete");
      return;
    }

    setShowConfirmDelete(true);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      for (const billId of selectedBills) {
        // Find all dispatch records linked to this bill
        const dispatchQuery = query(
          collection(db, "TblDispatch"),
          where("BillID", "==", billId)
        );
        
        const dispatchSnapshot = await getDocs(dispatchQuery);
        
        // Remove BillID and BillNum from dispatch records
        for (const dispatchDoc of dispatchSnapshot.docs) {
          await updateDoc(doc(db, "TblDispatch", dispatchDoc.id), {
            BillID: "",
            BillNum: "",
            UpdatedAt: serverTimestamp()
          });
        }
        
        // Delete the bill from BillTable
        await deleteDoc(doc(db, "BillTable", billId));
      }

      // Reload data
      await load();
      alert(`Successfully deleted ${selectedBills.length} bill(s)`);
    } catch (error) {
      console.error("Error deleting bills:", error);
      alert(`Error deleting bills: ${error.message}`);
    } finally {
      setDeleting(false);
      setShowConfirmDelete(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Bill Report</h2>

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
            placeholder="Search factory, bill no, date, month"
            value={searchBill}
            onChange={e => setSearchBill(e.target.value)}
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
            title="Export all filtered bills to Excel"
          >
            {exporting ? 'Exporting...' : 'Export All to Excel'}
          </button>
          
          {selectedBills.length > 0 && (
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
              title={`Export ${selectedBills.length} selected bills to Excel`}
            >
              {exporting ? 'Exporting...' : `Export Selected (${selectedBills.length})`}
            </button>
          )}
        </div>

        {/* Applied filters indicator */}
        {(appliedFilters.fromDate || appliedFilters.toDate || appliedFilters.searchBill || appliedFilters.factoryFilter) && (
          <div style={{ fontSize: 12, color: '#666', display: 'flex', gap: 10, width: '100%', marginTop: 10 }}>
            {appliedFilters.fromDate || appliedFilters.toDate ? (
              <span>
                Date: {appliedFilters.fromDate || 'Any'} to {appliedFilters.toDate || 'Any'}
              </span>
            ) : null}
            {appliedFilters.searchBill && (
              <span>Search: "{appliedFilters.searchBill}"</span>
            )}
            {appliedFilters.factoryFilter && (
              <span>Factory: {appliedFilters.factoryFilter}</span>
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
        
        {/* Total records count */}
        <div style={{ fontWeight: 'bold', color: '#495057' }}>
          Total Bills: {totalRecords}
        </div>
      </div>

      {/* ===== DELETE & EXPORT CONTROLS ===== */}
      <div style={{ 
        marginBottom: 15, 
        padding: 10, 
        backgroundColor: selectedBills.length > 0 ? '#fff3cd' : '#e9ecef',
        borderRadius: 5,
        border: selectedBills.length > 0 ? '1px solid #ffc107' : '1px solid #dee2e6',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <span style={{ marginRight: 10 }}>
            <input
              type="checkbox"
              checked={selectAll && displayRows.length > 0}
              onChange={handleSelectAll}
              disabled={displayRows.length === 0 || loading}
              style={{ marginRight: 5 }}
            />
            Select All ({selectedBills.length} selected)
          </span>
          <span style={{ color: '#666', fontSize: '14px', marginLeft: '20px' }}>
            Page Bills: {displayRows.length}
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: 10 }}>
          {selectedBills.length > 0 && (
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
                {exporting ? 'Exporting...' : `Export ${selectedBills.length} Selected`}
              </button>
              <button
                onClick={deleteSelectedBills}
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
                {deleting ? 'Deleting...' : `Delete Selected (${selectedBills.length})`}
              </button>
            </>
          )}
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 20 }}>Loading data...</div>}
      {exporting && <div style={{ textAlign: 'center', padding: 10, color: '#2196F3' }}>Exporting to Excel...</div>}

      {/* ===== BILL TABLE ===== */}
      <div style={{ overflowX: 'auto' }}>
        <table border="1" width="100%" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <th style={{ padding: 10, textAlign: 'center', width: '40px' }}>
                <input
                  type="checkbox"
                  checked={selectAll && displayRows.length > 0}
                  onChange={handleSelectAll}
                  disabled={displayRows.length === 0 || loading}
                />
              </th>
              {/* UPDATED COLUMN SEQUENCE to match Excel file */}
              <th style={{ padding: 10 }}>Dispatch Month</th>
              <th style={{ padding: 10 }}>Factory Name</th>
              <th style={{ padding: 10 }}>Bill Num</th>
              <th style={{ padding: 10 }}>LR Quantity</th>
              <th style={{ padding: 10 }}>Bill Quantity</th>
              <th style={{ padding: 10 }}>Taxable Amount</th>
              <th style={{ padding: 10 }}>Final Price</th>
              <th style={{ padding: 10 }}>Actual Amount</th>
              <th style={{ padding: 10 }}>TDS</th>
              <th style={{ padding: 10 }}>GST</th>
              <th style={{ padding: 10 }}>Bill Date</th>
              <th style={{ padding: 10 }}>Bill Type</th>
              <th style={{ padding: 10 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {!loading && displayRows.length > 0 ? (
              displayRows.map((r, i) => (
                <tr key={i} style={{ 
                  textAlign: 'center',
                  backgroundColor: selectedBills.includes(r.BillID) ? '#f8d7da' : 'inherit'
                }}>
                  <td style={{ padding: 8, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedBills.includes(r.BillID)}
                      onChange={() => handleSelectBill(r.BillID)}
                      disabled={loading}
                    />
                  </td>
                  {/* UPDATED COLUMN SEQUENCE to match Excel file */}
                  <td style={{ padding: 8, fontWeight: r["Dispatch Month"] ? 'normal' : 'lighter' }}>
                    {r["Dispatch Month"] || "N/A"}
                  </td>
                  <td style={{ padding: 8 }}>{r["Factory Name"]}</td>
                  <td style={{ padding: 8 }}>{r["Bill Num"]}</td>
                  <td style={{ padding: 8 }}>{r["LR Quantity"]}</td>
                  <td style={{ padding: 8 }}>{r["Bill Quantity"]}</td>
                  <td style={{ padding: 8 }}>{r["Taxable Amount"]}</td>
                  <td style={{ padding: 8 }}>{r["Final Price"]}</td>
                  <td style={{ padding: 8 }}>{r["Actual Amount"]}</td>
                  <td style={{ padding: 8 }}>{r["TDS"]}</td>
                  <td style={{ padding: 8 }}>{r["GST"]}</td>
                  <td style={{ padding: 8 }}>{r["Bill Date"]}</td>
                  <td style={{ padding: 8 }}>{r["Bill Type"]}</td>
                  <td style={{ padding: 8 }}>
                    <button
                      onClick={() =>
                        setSelectedBillId(
                          selectedBillId === r.BillID ? null : r.BillID
                        )
                      }
                      style={{
                        padding: '5px 10px',
                        backgroundColor: selectedBillId === r.BillID ? '#6c757d' : '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        marginRight: '5px'
                      }}
                    >
                      {selectedBillId === r.BillID ? "Hide" : "View"}
                    </button>
                  </td>
                </tr>
              ))
            ) : !loading && (
              <tr>
                <td colSpan="15" style={{ textAlign: 'center', padding: 20 }}>
                  No bills found. Try adjusting your filters.
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
              {/* Show first page if not in first 3 pages */}
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
              
              {/* Show last page if not in last 3 pages */}
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

      {/* ===== DISPATCH DETAILS ===== */}
      {selectedBillId && dispatchRows[selectedBillId] && (
        <>
          <h3 style={{ marginTop: 30, marginBottom: 15 }}>
            Dispatch Details for Bill: {selectedBillId}
            {rows.find(r => r.BillID === selectedBillId)?.["Dispatch Month"] && (
              <span style={{ marginLeft: 20, fontSize: '16px', color: '#666' }}>
                Dispatch Month(s): {rows.find(r => r.BillID === selectedBillId)?.["Dispatch Month"]}
              </span>
            )}
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table border="1" width="100%" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f2f2f2' }}>
                  <th style={{ padding: 10 }}>Challan No</th>
                  <th style={{ padding: 10 }}>Dispatch Date</th>
                  <th style={{ padding: 10 }}>Vehicle No</th>
                  <th style={{ padding: 10 }}>Quantity</th>
                  <th style={{ padding: 10 }}>Unit Price</th>
                  <th style={{ padding: 10 }}>Final Price</th>
                  <th style={{ padding: 10 }}>LR No</th>
                  <th style={{ padding: 10 }}>Delivery No</th>
                </tr>
              </thead>
              <tbody>
                {getSortedDispatchRows(selectedBillId).map((d, i) => (
                  <tr key={i} style={{ textAlign: 'center' }}>
                    <td style={{ padding: 8 }}>{d.ChallanNo}</td>
                    <td style={{ padding: 8 }}>{d.DispatchDate}</td>
                    <td style={{ padding: 8 }}>{d.VehicleNo}</td>
                    <td style={{ padding: 8 }}>{d.Quantity.toFixed(2)}</td>
                    <td style={{ padding: 8 }}>{d.UnitPrice.toFixed(2)}</td>
                    <td style={{ padding: 8 }}>{d.FinalPrice.toFixed(2)}</td>
                    <td style={{ padding: 8 }}>{d.LRNo}</td>
                    <td style={{ padding: 8 }}>{d.DeliveryNum}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
            <h3 style={{ marginTop: 0, color: '#dc3545' }}>Confirm Delete</h3>
            <p>
              Are you sure you want to delete <strong>{selectedBills.length}</strong> selected bill(s)?
            </p>
            <p style={{ color: '#666', fontSize: '14px', marginTop: '10px' }}>
              <strong>Note:</strong> This will remove the bill from BillTable but keep the dispatch records (only removing their BillID link).
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
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShowBill;