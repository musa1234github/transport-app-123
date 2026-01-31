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
import "./ShowBill.css"; // Import CSS file

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
  
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const monthsSet = new Set();
  
  dispatchRows.forEach(dispatch => {
    if (dispatch.DispatchDate) {
      const parts = dispatch.DispatchDate.split('-');
      if (parts.length === 3) {
        const month = parts[1];
        if (monthNames.includes(month)) {
          monthsSet.add(month);
        }
      }
    }
  });
  
  const monthsArray = Array.from(monthsSet).sort((a, b) => 
    monthNames.indexOf(a) - monthNames.indexOf(b)
  );
  
  return monthsArray.join(', ');
};

const ShowBill = ({ userRole }) => {
  const [rows, setRows] = useState([]);
  const [dispatchRows, setDispatchRows] = useState({});
  const [selectedBillId, setSelectedBillId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedBills, setSelectedBills] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false); // Track if data has been loaded
  const [factories, setFactories] = useState([]); // Separate state for factories
  const [loadingFactories, setLoadingFactories] = useState(true); // Track factory loading

  // Check if user is admin
  const isAdmin = userRole === "admin";

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

  /* ================= LOAD FACTORIES ON MOUNT ================= */
  const loadFactories = async () => {
    setLoadingFactories(true);
    try {
      const billQuery = query(collection(db, "BillTable"));
      const billSnap = await getDocs(billQuery);
      
      // Extract unique factory names from all bills
      const factorySet = new Set();
      billSnap.docs.forEach(b => {
        const data = b.data();
        if (data.FactoryName) {
          factorySet.add(data.FactoryName);
        }
      });
      
      const factoriesList = Array.from(factorySet).sort();
      setFactories(factoriesList);
    } catch (error) {
      console.error("Error loading factories:", error);
    } finally {
      setLoadingFactories(false);
    }
  };

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
            "Dispatch Month": "",
            "Factory Name": bill.FactoryName || "",
            "Bill Num": bill.BillNum || "",
            "LR Quantity": 0,
            "Bill Quantity": 0,
            "Taxable Amount": 0,
            "Final Price": 0,
            FINAL_RAW: 0,
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
      setDataLoaded(true); // Mark data as loaded
      
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

  /* ===== LOAD FACTORIES ON COMPONENT MOUNT ===== */
  useEffect(() => {
    loadFactories();
  }, []);

  /* ===== LOAD WHEN APPLIED FILTERS CHANGE ===== */
  useEffect(() => {
    // Only load data if appliedFilters have changed and data hasn't been loaded yet
    // OR if we're applying new filters
    if (Object.values(appliedFilters).some(filter => filter !== "")) {
      load();
    }
  }, [appliedFilters]);

  /* ===== APPLY FILTERS FUNCTION ===== */
  const applyFilters = () => {
    // Mark that we want to load data
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
    // Clear data when filters are cleared
    setRows([]);
    setDispatchRows({});
    setDataLoaded(false);
    setSelectedBills([]);
  };

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
    if (!dataLoaded || filteredRows.length === 0) {
      alert("No data to export! Please apply filters first.");
      return;
    }

    setExporting(true);
    try {
      // Prepare data for export
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
      
      // Set column widths
      const wscols = [
        { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }
      ];
      ws['!cols'] = wscols;

      // Add styling
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
      const allFilteredRows = filteredRows;
      const selectedRows = allFilteredRows.filter(row => selectedBills.includes(row.BillID));
      
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

      const ws = XLSX.utils.json_to_sheet(exportData);
      
      const wscols = [
        { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }
      ];
      ws['!cols'] = wscols;

      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if (!ws[address]) continue;
        ws[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E0E0E0" } }
        };
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Selected Bills");

      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `Selected_Bills_${selectedBills.length}_${dateStr}.xlsx`;

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
        const dispatchQuery = query(
          collection(db, "TblDispatch"),
          where("BillID", "==", billId)
        );
        
        const dispatchSnapshot = await getDocs(dispatchQuery);
        
        for (const dispatchDoc of dispatchSnapshot.docs) {
          await updateDoc(doc(db, "TblDispatch", dispatchDoc.id), {
            BillID: "",
            BillNum: "",
            UpdatedAt: serverTimestamp()
          });
        }
        
        await deleteDoc(doc(db, "BillTable", billId));
      }

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
    <div className="bill-report-container">
      <h2 className="bill-report-title">Bill Report</h2>

      {/* Show initial state message */}
      {!dataLoaded && rows.length === 0 && !loading && (
        <div className="no-data-container">
          <p>No data loaded. Please apply filters to load bills.</p>
        </div>
      )}

      {/* ===== FILTER BAR ===== */}
      <div className="filter-bar">
        <div>
          <input
            type="text"
            placeholder="Search factory, bill no, date, month"
            value={searchBill}
            onChange={e => setSearchBill(e.target.value)}
            className="filter-input filter-input-search"
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
          {loadingFactories && <span className="loading-text">Loading factories...</span>}
        </div>

        <div className="flex items-center gap-5">
          <label className="filter-label">From:</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="filter-input-date"
          />
        </div>

        <div className="flex items-center gap-5">
          <label className="filter-label">To:</label>
          <input
            type="date"
            value={toDateFilter}
            onChange={e => setToDateFilter(e.target.value)}
            className="filter-input-date"
          />
        </div>

        <div className="filter-button-group">
          <button 
            onClick={applyFilters}
            disabled={loading}
            className="filter-button filter-button-apply"
          >
            {loading ? 'Loading...' : 'Apply Filters'}
          </button>
          <button 
            onClick={clearFilters}
            disabled={loading}
            className="filter-button filter-button-clear"
          >
            Clear Filters
          </button>
        </div>

        {/* ===== EXPORT BUTTONS ===== */}
        <div className="export-button-group">
          <button 
            onClick={exportToExcel}
            disabled={exporting || !dataLoaded || filteredRows.length === 0}
            className="export-button export-button-all"
            title="Export all filtered bills to Excel"
          >
            {exporting ? 'Exporting...' : 'Export All to Excel'}
          </button>
          
          {isAdmin && selectedBills.length > 0 && (
            <button 
              onClick={exportSelectedToExcel}
              disabled={exporting}
              className="export-button export-button-selected"
              title={`Export ${selectedBills.length} selected bills to Excel`}
            >
              {exporting ? 'Exporting...' : `Export Selected (${selectedBills.length})`}
            </button>
          )}
        </div>

        {/* Applied filters indicator */}
        {(appliedFilters.fromDate || appliedFilters.toDate || appliedFilters.searchBill || appliedFilters.factoryFilter) && (
          <div className="applied-filters">
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

      {/* Show loading state */}
      {loading && <div className="loading-container">Loading data...</div>}
      {exporting && <div className="exporting-container">Exporting to Excel...</div>}

      {/* Only show table controls and data if data is loaded */}
      {dataLoaded && rows.length > 0 && (
        <>
          {/* ===== RECORDS PER PAGE SELECTOR ===== */}
          <div className="pagination-controls">
            <div className="records-selector">
              <span className="records-selector-label">Records per page:</span>
              <select 
                value={recordsPerPage} 
                onChange={handleRecordsPerPageChange}
                className="records-selector-select"
                disabled={loading}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
              
              <span className="records-info">
                Showing {indexOfFirstRecord + 1} to {Math.min(indexOfLastRecord, totalRecords)} of {totalRecords} records
              </span>
            </div>
            
            {/* Total records count */}
            <div className="total-records">
              Total Bills: {totalRecords}
            </div>
          </div>

          {/* ===== DELETE & EXPORT CONTROLS (Only for Admin) ===== */}
          {isAdmin && (
            <div className={`selection-controls ${selectedBills.length > 0 ? 'selection-controls-with-selection' : 'selection-controls-without-selection'}`}>
              <div className="selection-info">
                <span>
                  <input
                    type="checkbox"
                    checked={selectAll && displayRows.length > 0}
                    onChange={handleSelectAll}
                    disabled={displayRows.length === 0 || loading}
                    className="selection-checkbox"
                  />
                  Select All ({selectedBills.length} selected)
                </span>
                <span className="page-bills-info">
                  Page Bills: {displayRows.length}
                </span>
              </div>
              
              <div className="selection-actions">
                {selectedBills.length > 0 && (
                  <>
                    <button
                      onClick={exportSelectedToExcel}
                      disabled={exporting}
                      className="export-button export-button-selected"
                    >
                      {exporting ? 'Exporting...' : `Export ${selectedBills.length} Selected`}
                    </button>
                    <button
                      onClick={deleteSelectedBills}
                      disabled={deleting}
                      className="delete-button"
                    >
                      {deleting ? 'Deleting...' : `Delete Selected (${selectedBills.length})`}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ===== BILL TABLE ===== */}
          <div className="table-container">
            <table border="1" className="bill-table">
              <thead>
                <tr>
                  {/* Only show checkbox column for admin */}
                  {isAdmin && (
                    <th className="checkbox-column">
                      <input
                        type="checkbox"
                        checked={selectAll && displayRows.length > 0}
                        onChange={handleSelectAll}
                        disabled={displayRows.length === 0 || loading}
                      />
                    </th>
                  )}
                  <th>Dispatch Month</th>
                  <th>Factory Name</th>
                  <th>Bill Num</th>
                  <th>LR Quantity</th>
                  <th>Bill Quantity</th>
                  <th>Taxable Amount</th>
                  <th>Final Price</th>
                  <th>Actual Amount</th>
                  <th>TDS</th>
                  <th>GST</th>
                  <th>Bill Date</th>
                  <th>Bill Type</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.length > 0 ? (
                  displayRows.map((r, i) => (
                    <tr key={i} className={isAdmin && selectedBills.includes(r.BillID) ? 'selected-row' : ''}>
                      {/* Only show checkbox for admin */}
                      {isAdmin && (
                        <td className="checkbox-column">
                          <input
                            type="checkbox"
                            checked={selectedBills.includes(r.BillID)}
                            onChange={() => handleSelectBill(r.BillID)}
                            disabled={loading}
                          />
                        </td>
                      )}
                      <td style={{ fontWeight: r["Dispatch Month"] ? 'normal' : 'lighter' }}>
                        {r["Dispatch Month"] || "N/A"}
                      </td>
                      <td>{r["Factory Name"]}</td>
                      <td>{r["Bill Num"]}</td>
                      <td>{r["LR Quantity"]}</td>
                      <td>{r["Bill Quantity"]}</td>
                      <td>{r["Taxable Amount"]}</td>
                      <td>{r["Final Price"]}</td>
                      <td>{r["Actual Amount"]}</td>
                      <td>{r["TDS"]}</td>
                      <td>{r["GST"]}</td>
                      <td>{r["Bill Date"]}</td>
                      <td>{r["Bill Type"]}</td>
                      <td>
                        <button
                          onClick={() =>
                            setSelectedBillId(
                              selectedBillId === r.BillID ? null : r.BillID
                            )
                          }
                          className={`view-button ${selectedBillId === r.BillID ? 'view-button-active' : 'view-button-inactive'}`}
                        >
                          {selectedBillId === r.BillID ? "Hide" : "View"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={isAdmin ? "15" : "14"} className="no-data-container">
                      No bills found with current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ===== PAGINATION CONTROLS ===== */}
          {totalRecords > 0 && (
            <div className="pagination">
              <div className="pagination-left">
                <span className="pagination-info">Page {currentPage} of {totalPages}</span>
                
                {/* First and Previous buttons */}
                <button
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage === 1}
                  className="pagination-button pagination-button-first"
                  title="First Page"
                >
                  ««
                </button>
                
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="pagination-button pagination-button-prev"
                  title="Previous Page"
                >
                  «
                </button>
                
                {/* Page number buttons */}
                <div className="flex gap-5">
                  {/* Show first page if not in first 3 pages */}
                  {currentPage > 3 && (
                    <>
                      <button
                        onClick={() => handlePageChange(1)}
                        className="pagination-button pagination-button-number"
                      >
                        1
                      </button>
                      {currentPage > 4 && <span className="pagination-dots">...</span>}
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
                        className={`pagination-button ${currentPage === pageNum ? 'pagination-button-current' : 'pagination-button-number'}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  
                  {/* Show last page if not in last 3 pages */}
                  {currentPage < totalPages - 2 && (
                    <>
                      {currentPage < totalPages - 3 && <span className="pagination-dots">...</span>}
                      <button
                        onClick={() => handlePageChange(totalPages)}
                        className="pagination-button pagination-button-number"
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
                  className="pagination-button pagination-button-next"
                  title="Next Page"
                >
                  »
                </button>
                
                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage === totalPages}
                  className="pagination-button pagination-button-last"
                  title="Last Page"
                >
                  »»
                </button>
              </div>
              
              {/* Go to page input */}
              <div className="pagination-right">
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
                  className="pagination-go-to"
                />
                <span>of {totalPages}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== DISPATCH DETAILS ===== */}
      {selectedBillId && dispatchRows[selectedBillId] && (
        <>
          <h3 className="dispatch-title">
            Dispatch Details for Bill: {selectedBillId}
            {rows.find(r => r.BillID === selectedBillId)?.["Dispatch Month"] && (
              <span className="dispatch-months">
                Dispatch Month(s): {rows.find(r => r.BillID === selectedBillId)?.["Dispatch Month"]}
              </span>
            )}
          </h3>
          <div className="table-container">
            <table border="1" className="bill-table">
              <thead>
                <tr>
                  <th>Challan No</th>
                  <th>Dispatch Date</th>
                  <th>Vehicle No</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Final Price</th>
                  <th>LR No</th>
                  <th>Delivery No</th>
                </tr>
              </thead>
              <tbody>
                {getSortedDispatchRows(selectedBillId).map((d, i) => (
                  <tr key={i}>
                    <td>{d.ChallanNo}</td>
                    <td>{d.DispatchDate}</td>
                    <td>{d.VehicleNo}</td>
                    <td>{d.Quantity.toFixed(2)}</td>
                    <td>{d.UnitPrice.toFixed(2)}</td>
                    <td>{d.FinalPrice.toFixed(2)}</td>
                    <td>{d.LRNo}</td>
                    <td>{d.DeliveryNum}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ===== CONFIRM DELETE MODAL (Only for Admin) ===== */}
      {isAdmin && showConfirmDelete && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Confirm Delete</h3>
            <p>
              Are you sure you want to delete <strong>{selectedBills.length}</strong> selected bill(s)?
            </p>
            <p className="modal-note">
              <strong>Note:</strong> This will remove the bill from BillTable but keep the dispatch records (only removing their BillID link).
            </p>
            
            <div className="modal-actions">
              <button
                onClick={() => setShowConfirmDelete(false)}
                disabled={deleting}
                className="modal-button modal-button-cancel"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="modal-button modal-button-delete"
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