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
  orderBy
} from "firebase/firestore";
import * as XLSX from "xlsx";

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

const normalizeDate = (d) => {
  if (!d) return null;
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// ===== FORMAT DATE FOR DISPLAY (dd-MM-yy) =====
const formatShortDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear().toString().slice(-2);
  return `${dd}-${mm}-${yy}`;
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

  /* âœ… MVC-style applied filters */
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

  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdTokenResult();
        setIsAdmin(!!token.claims.admin);
      }
    };
    checkAdmin();
  }, []);

  /* ================= FETCH DATA WITH FILTERS ================= */
  const fetchFilteredData = async () => {
    setLoading(true);
    setError("");
    try {
      let q = collection(db, "TblDispatch");
      let conditions = [];
      
      // STRATEGY 1: Try to use composite query (with single field or date-only)
      // Firestore has limits on composite queries, so we need to be careful
      
      // Build query conditions - LIMIT TO SIMPLE QUERIES TO AVOID INDEX ERRORS
      if (filterFactory && !fromDate && !toDate) {
        // Only factory filter - this should work without composite index
        const factoryId = Object.keys(factoryMap).find(key => factoryMap[key] === filterFactory);
        if (factoryId) {
          q = query(q, where("DisVid", "==", factoryId));
        } else {
          q = query(q, where("FactoryName", "==", filterFactory));
        }
      } else if (!filterFactory && (fromDate || toDate)) {
        // Only date filters - try to handle dates
        if (fromDate) {
          const startDate = new Date(fromDate);
          startDate.setHours(0, 0, 0, 0);
          q = query(q, where("DispatchDate", ">=", startDate));
        }
        if (toDate) {
          const endDate = new Date(toDate);
          endDate.setHours(23, 59, 59, 999);
          q = query(q, where("DispatchDate", "<=", endDate));
        }
      } else if (filterFactory && (fromDate || toDate)) {
        // Factory + date combination - MOST LIKELY TO CAUSE INDEX ERROR
        // We'll fetch all data and filter locally to avoid index issues
        console.log("Complex filter detected - using client-side filtering");
        // We'll handle this in the data processing step
      }
      
      // Get all documents (or filtered ones)
      const snapshot = await getDocs(q);
      const allData = snapshot.docs.map(ds => {
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

        row.FactoryName = row.FactoryName || factoryMap[row.DisVid] || "";
        row.BillNum = String(row.BillNum || "");

        return row;
      });

      // Apply complex filters client-side if needed
      let filteredData = allData;
      
      // If we have factory + date combination, filter client-side
      if (filterFactory && (fromDate || toDate)) {
        filteredData = allData.filter(row => {
          // Factory filter
          const matchesFactory = row.FactoryName === filterFactory || 
                                factoryMap[row.DisVid] === filterFactory;
          
          if (!matchesFactory) return false;
          
          // Date filters
          if (fromDate || toDate) {
            const rowDate = normalizeDate(row.DispatchDate);
            const from = fromDate ? normalizeDate(new Date(fromDate)) : null;
            const to = toDate ? normalizeDate(new Date(toDate)) : null;
            
            let matchesFromDate = true;
            let matchesToDate = true;

            if (from && rowDate) {
              matchesFromDate = rowDate.getTime() >= from.getTime();
            }
            if (to && rowDate) {
              const toEndOfDay = new Date(to);
              toEndOfDay.setDate(toEndOfDay.getDate() + 1);
              matchesToDate = rowDate.getTime() < toEndOfDay.getTime();
            }
            
            return matchesFromDate && matchesToDate;
          }
          
          return true;
        });
      }

      setDispatches(filteredData);
      setDataLoaded(true);
      
      // Show warning if we're doing client-side filtering
      if (filterFactory && (fromDate || toDate)) {
        setError("Note: Using client-side filtering for complex queries. For better performance, create Firestore composite indexes.");
      }
      
    } catch (error) {
      console.error("Error fetching data:", error);
      
      // Check if it's an index error
      if (error.code === 'failed-precondition' && error.message.includes('index')) {
        setError(`Firestore Index Required: ${error.message.split('You can create it here:')[1] || 'Please create the required index in Firebase Console'}`);
      } else {
        setError(`Error fetching data: ${error.message}. Trying alternative approach...`);
        
        // Fallback: Try to fetch all data and filter client-side
        try {
          const snapshot = await getDocs(collection(db, "TblDispatch"));
          const allData = snapshot.docs.map(ds => {
            const row = { id: ds.id, ...ds.data() };
            row.DisVid = String(row.DisVid || "");
            
            if (row.DispatchDate) {
              const d = row.DispatchDate.seconds
                ? new Date(row.DispatchDate.seconds * 1000)
                : new Date(row.DispatchDate);
              row.DispatchDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            }
            
            row.FactoryName = row.FactoryName || factoryMap[row.DisVid] || "";
            row.BillNum = String(row.BillNum || "");
            return row;
          });
          
          // Filter client-side
          let filteredData = allData;
          if (filterFactory || fromDate || toDate) {
            filteredData = allData.filter(row => {
              // Factory filter
              const matchesFactory = !filterFactory || 
                row.FactoryName === filterFactory || 
                factoryMap[row.DisVid] === filterFactory;
              
              if (!matchesFactory) return false;
              
              // Date filters
              if (fromDate || toDate) {
                const rowDate = normalizeDate(row.DispatchDate);
                const from = fromDate ? normalizeDate(new Date(fromDate)) : null;
                const to = toDate ? normalizeDate(new Date(toDate)) : null;
                
                let matchesFromDate = true;
                let matchesToDate = true;

                if (from && rowDate) {
                  matchesFromDate = rowDate.getTime() >= from.getTime();
                }
                if (to && rowDate) {
                  const toEndOfDay = new Date(to);
                  toEndOfDay.setDate(toEndOfDay.getDate() + 1);
                  matchesToDate = rowDate.getTime() < toEndOfDay.getTime();
                }
                
                return matchesFromDate && matchesToDate;
              }
              
              return true;
            });
          }
          
          setDispatches(filteredData);
          setDataLoaded(true);
          setError("Using client-side filtering due to Firestore index limitations. For better performance with combined filters, create composite indexes in Firebase Console.");
          
        } catch (fallbackError) {
          setError(`Failed to load data: ${fallbackError.message}`);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  /* ================= FETCH ALL DATA (for dropdowns) ================= */
  const fetchAllForDropdowns = async () => {
    try {
      const snapshot = await getDocs(collection(db, "TblDispatch"));
      const data = snapshot.docs.slice(-100).map(ds => {
        const row = { id: ds.id, ...ds.data() };
        row.DisVid = String(row.DisVid || "");
        row.FactoryName = row.FactoryName || factoryMap[row.DisVid] || "";
        row.BillNum = String(row.BillNum || "");
        return row;
      });
      setDispatches(data);
    } catch (error) {
      console.error("Error fetching dropdown data:", error);
      setError(`Error loading initial data: ${error.message}`);
    }
  };

  // Fetch dropdown data on initial load
  useEffect(() => {
    fetchAllForDropdowns();
  }, []);

  /* ================= GET UNIQUE FACTORIES FOR DROPDOWN ================= */
  const getUniqueFactories = () => {
    const factories = new Set();
    dispatches.forEach(d => {
      if (d.DisVid && factoryMap[d.DisVid]) {
        factories.add(factoryMap[d.DisVid]);
      } else if (d.FactoryName) {
        factories.add(d.FactoryName);
      }
    });
    return Array.from(factories).sort();
  };

  /* ================= APPLY FILTER (MVC BUTTON) ================= */
  const applyFilters = async () => {
    await fetchFilteredData();
    setAppliedFilters({
      searchTerm,
      filterFactory,
      fromDate,
      toDate
    });
    setCurrentPage(1);
  };

  /* ================= CLEAR FILTERS ================= */
  const clearFilters = async () => {
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
    setError("");
    
    // Reload minimal data for dropdowns only
    setDataLoaded(false);
    await fetchAllForDropdowns();
  };

  /* ================= EDIT ================= */
  const handleEdit = (row) => {
    setEditId(row.id);
    setEditChallan(row.ChallanNo || "");
    setEditBillNum(row.BillNum || "");
  };

  const handleSave = async (id) => {
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
  };

  const handleCancel = () => {
    setEditId(null);
    setEditChallan("");
    setEditBillNum("");
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

  /* ================= FILTER (APPLIED ONLY ON BUTTON CLICK) ================= */
  const filteredDispatches = dispatches.filter(d => {
    const liveSearch = String(searchTerm ?? "");
    const { filterFactory, fromDate, toDate } = appliedFilters;

    if (!searchTerm && !filterFactory && !fromDate && !toDate) {
      return true;
    }

    const terms = liveSearch
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const matchesSearch =
      terms.length === 0
        ? true
        : terms.every(term =>
          Object.values(d).some(v => {
            if (!v) return false;
            if (v instanceof Date) {
              return formatShortDate(v).toLowerCase().includes(term);
            }
            return v.toString().toLowerCase().includes(term);
          })
        );

    // Factory filtering
    const matchesFactory = filterFactory ? 
      (d.FactoryName === filterFactory || factoryMap[d.DisVid] === filterFactory) : true;

    // Date filtering logic
    const rowDate = normalizeDate(d.DispatchDate);
    const from = fromDate ? normalizeDate(new Date(fromDate)) : null;
    const to = toDate ? normalizeDate(new Date(toDate)) : null;

    let matchesFromDate = true;
    let matchesToDate = true;

    if (from && rowDate) {
      matchesFromDate = rowDate.getTime() >= from.getTime();
    }
    if (to && rowDate) {
      const toEndOfDay = new Date(to);
      toEndOfDay.setDate(toEndOfDay.getDate() + 1);
      matchesToDate = rowDate.getTime() < toEndOfDay.getTime();
    }

    return matchesSearch && matchesFactory && matchesFromDate && matchesToDate;
  });

  const totalRecords = dispatches.length;
  const filteredCount = filteredDispatches.length;
  const totalPages = Math.ceil(filteredCount / recordsPerPage);

  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = Math.min(startIndex + recordsPerPage, filteredCount);

  const paginatedDispatches = filteredDispatches.slice(
    startIndex,
    startIndex + recordsPerPage
  );

  const isAllSelected =
    paginatedDispatches.length > 0 &&
    paginatedDispatches.every(d => selectedIds.includes(d.id));

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
    XLSX.utils.book_append_sheet(wb, ws, "Billed Challan");
    XLSX.writeFile(wb, "Billed_Challan_Data.xlsx");
  };

  /* ================= UI ================= */
  const uniqueFactories = getUniqueFactories();

  return (
    <div style={{ padding: 20 }}>
      <h2>Billed Challan Data</h2>

      {/* ===== ERROR MESSAGE ===== */}
      {error && (
        <div style={{ 
          marginBottom: 15, 
          padding: 15, 
          backgroundColor: error.includes("Index Required") ? '#fff3cd' : '#f8d7da',
          borderRadius: 5,
          border: error.includes("Index Required") ? '1px solid #ffc107' : '1px solid #f5c6cb',
          color: error.includes("Index Required") ? '#856404' : '#721c24',
          fontSize: 14
        }}>
          <strong>{error.includes("Index Required") ? "⚠️ Index Notice" : "⚠️ Error"}:</strong> {error}
          {error.includes("You can create it here:") && (
            <div style={{ marginTop: 10 }}>
              <a 
                href={error.split('You can create it here:')[1]?.trim()} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  color: '#007bff',
                  textDecoration: 'underline'
                }}
              >
                Click here to create the required index
              </a>
            </div>
          )}
        </div>
      )}

      {/* ===== FILTER CONTROLS ===== */}
      <div style={{ 
        display: "flex", 
        gap: 10, 
        flexWrap: "wrap", 
        alignItems: "center", 
        marginBottom: 15,
        padding: 15,
        backgroundColor: '#f5f5f5',
        borderRadius: 5
      }}>
        <input
          placeholder="Search in results..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          disabled={!dataLoaded}
          style={{ 
            padding: 8, 
            border: "1px solid #ccc", 
            borderRadius: 4,
            width: 200,
            backgroundColor: !dataLoaded ? '#f0f0f0' : 'white'
          }}
        />

        {/* Factory Name Dropdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 12, color: '#666' }}>Factory Name</label>
          <select
            value={filterFactory}
            onChange={e => setFilterFactory(e.target.value)}
            style={{ 
              padding: 8, 
              border: "1px solid #ccc", 
              borderRadius: 4,
              minWidth: 150
            }}
          >
            <option value="">All Factories</option>
            {uniqueFactories.map(factory => (
              <option key={factory} value={factory}>
                {factory}
              </option>
            ))}
          </select>
        </div>

        {/* Date Filters */}
        <div style={{ display: "flex", flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 12, color: '#666' }}>From Date</label>
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
            style={{ 
              padding: 8, 
              border: "1px solid #ccc", 
              borderRadius: 4 
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 12, color: '#666' }}>To Date</label>
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
            style={{ 
              padding: 8, 
              border: "1px solid #ccc", 
              borderRadius: 4 
            }}
          />
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 10, marginLeft: 'auto', alignItems: 'flex-end' }}>
          <button
            onClick={applyFilters}
            disabled={loading}
            style={{ 
              padding: "8px 16px", 
              backgroundColor: loading ? "#ccc" : "#4CAF50", 
              color: "white", 
              border: "none", 
              borderRadius: 4, 
              cursor: loading ? "not-allowed" : "pointer",
              height: 36,
              minWidth: 120
            }}
          >
            {loading ? "Loading..." : "Apply Filters"}
          </button>

          <button
            onClick={clearFilters}
            style={{ 
              padding: "8px 16px", 
              backgroundColor: "#f44336", 
              color: "white", 
              border: "none", 
              borderRadius: 4, 
              cursor: "pointer",
              height: 36
            }}
          >
            Clear Filters
          </button>

          <button
            onClick={exportToExcel}
            disabled={filteredCount === 0}
            style={{ 
              padding: "8px 16px", 
              backgroundColor: filteredCount === 0 ? "#ccc" : "#2196F3", 
              color: "white", 
              border: "none", 
              borderRadius: 4, 
              cursor: filteredCount === 0 ? "not-allowed" : "pointer",
              height: 36
            }}
            title={filteredCount === 0 ? "No data to export" : "Export to Excel"}
          >
            Export Excel
          </button>
        </div>
      </div>

      {/* ===== LOADING INDICATOR ===== */}
      {loading && (
        <div style={{ 
          marginBottom: 15, 
          padding: 10, 
          backgroundColor: '#e8f5e8', 
          borderRadius: 5,
          fontSize: 14,
          color: '#2e7d32',
          textAlign: 'center'
        }}>
          <strong>Loading data...</strong> Please wait.
        </div>
      )}

      {/* ===== DATA NOT LOADED MESSAGE ===== */}
      {!dataLoaded && !loading && !error && (
        <div style={{ 
          marginBottom: 15, 
          padding: 20, 
          backgroundColor: '#fff3cd', 
          borderRadius: 5,
          border: '1px solid #ffc107',
          textAlign: 'center',
          fontSize: 16,
          color: '#856404'
        }}>
          <strong>No data loaded.</strong> Please apply filters to load data.
        </div>
      )}

      {/* ===== APPLIED FILTERS INDICATOR ===== */}
      {dataLoaded && (appliedFilters.filterFactory || appliedFilters.fromDate || appliedFilters.toDate) && (
        <div style={{ 
          marginBottom: 15, 
          padding: 10, 
          backgroundColor: '#e8f5e8', 
          borderRadius: 5,
          fontSize: 14,
          color: '#2e7d32'
        }}>
          <strong>Active Filters:</strong>
          {appliedFilters.filterFactory && <span style={{ marginLeft: 10 }}>Factory: {appliedFilters.filterFactory}</span>}
          {(appliedFilters.fromDate || appliedFilters.toDate) && (
            <span style={{ marginLeft: 10 }}>
              Date: {appliedFilters.fromDate ? formatShortDate(appliedFilters.fromDate) : 'Any'} 
              to {appliedFilters.toDate ? formatShortDate(appliedFilters.toDate) : 'Any'}
            </span>
          )}
          <span style={{ marginLeft: 10, float: 'right' }}>
            <strong>Loaded Records:</strong> {totalRecords}
          </span>
        </div>
      )}

      {/* ===== DATA TABLE ===== */}
      {dataLoaded && !loading && (
        <>
          {/* ===== SELECTED RECORDS DELETE BUTTON ===== */}
          {isAdmin && selectedIds.length > 0 && (
            <div style={{ 
              marginBottom: 15, 
              padding: 10, 
              backgroundColor: '#fff3cd', 
              borderRadius: 5,
              border: '1px solid #ffc107',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>
                <strong>{selectedIds.length}</strong> record(s) selected
              </span>
              <button
                onClick={handleDeleteSelected}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#dc3545",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: 'bold'
                }}
              >
                Delete Selected
              </button>
            </div>
          )}

          {/* ===== STATISTICS ===== */}
          <div style={{ 
            marginBottom: 15, 
            padding: 10, 
            backgroundColor: '#e3f2fd', 
            borderRadius: 5,
            fontSize: 14,
            color: '#1565c0'
          }}>
            <strong>Statistics:</strong>
            <span style={{ marginLeft: 10 }}>
              Total Records: {totalRecords} | 
            </span>
            <span style={{ marginLeft: 10 }}>
              Billed Records: {dispatches.filter(d => d.BillNum && d.BillNum.trim() !== "").length} | 
            </span>
            <span style={{ marginLeft: 10 }}>
              Unbilled Records: {dispatches.filter(d => !d.BillNum || d.BillNum.trim() === "").length}
            </span>
          </div>

          {/* ===== RECORD COUNT ===== */}
          <div style={{ 
            marginBottom: 10, 
            padding: 8, 
            backgroundColor: '#f8f9fa', 
            borderRadius: 5,
            border: '1px solid #dee2e6',
            fontSize: 14,
            color: '#495057'
          }}>
            Showing {filteredCount === 0 ? 0 : startIndex + 1}â€“{endIndex} of{" "}
            <strong>{filteredCount}</strong> filtered records
          </div>

          <div style={{ overflowX: "auto" }}>
            <table border="1" width="100%" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f2f2f2" }}>
                  {isAdmin && (
                    <th style={{ padding: 10, width: '50px' }}>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleSelectAll}
                        disabled={paginatedDispatches.length === 0}
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
                {paginatedDispatches.length > 0 ? (
                  paginatedDispatches.map(d => (
                    <tr key={d.id} style={{ 
                      borderBottom: "1px solid #ddd",
                      backgroundColor: d.BillNum && d.BillNum.trim() !== "" ? '#f0fff0' : 'inherit'
                    }}>
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
                              autoFocus
                            />
                          ) : col === "BillNum" && editId === d.id && isAdmin ? (
                            <input
                              value={editBillNum}
                              onChange={e => setEditBillNum(e.target.value)}
                              style={{ padding: 4, width: "100%" }}
                              placeholder="Enter Bill Number"
                            />
                          ) : col === "DispatchDate" ? (
                            formatShortDate(d[col])
                          ) : col === "BillNum" ? (
                            <span style={{ 
                              fontWeight: d[col] ? 'bold' : 'normal',
                              color: d[col] ? '#28a745' : '#dc3545',
                              backgroundColor: d[col] ? '#f0fff0' : '#fff5f5',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              display: 'inline-block'
                            }}>
                              {d[col] || "Unbilled"}
                            </span>
                          ) : col === "DispatchQuantity" ? (
                            <span style={{ fontWeight: 'bold' }}>
                              {d[col] ? parseFloat(d[col]).toFixed(2) : "0.00"}
                            </span>
                          ) : (
                            d[col] || "â€”"
                          )}
                        </td>
                      ))}

                      {isAdmin && (
                        <td style={{ padding: 10, whiteSpace: 'nowrap' }}>
                          {editId === d.id ? (
                            <>
                              <button
                                onClick={() => handleSave(d.id)}
                                style={{ 
                                  marginRight: 5, 
                                  padding: "5px 10px", 
                                  backgroundColor: "#28a745", 
                                  color: "white", 
                                  border: "none", 
                                  borderRadius: 3, 
                                  cursor: "pointer" 
                                }}
                              >
                                Save
                              </button>
                              <button
                                onClick={handleCancel}
                                style={{ 
                                  padding: "5px 10px", 
                                  backgroundColor: "#6c757d", 
                                  color: "white", 
                                  border: "none", 
                                  borderRadius: 3, 
                                  cursor: "pointer" 
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEdit(d)}
                                style={{ 
                                  marginRight: 5, 
                                  padding: "5px 10px", 
                                  backgroundColor: "#007bff", 
                                  color: "white", 
                                  border: "none", 
                                  borderRadius: 3, 
                                  cursor: "pointer" 
                                }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(d.id)}
                                style={{ 
                                  padding: "5px 10px", 
                                  backgroundColor: "#dc3545", 
                                  color: "white", 
                                  border: "none", 
                                  borderRadius: 3, 
                                  cursor: "pointer" 
                                }}
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
                      style={{ padding: 40, textAlign: "center", color: "#666" }}
                    >
                      No records found. Try adjusting your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ===== PAGINATION ===== */}
          {totalPages > 1 && (
            <div style={{ 
              marginTop: 20, 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-between",
              padding: 15,
              backgroundColor: '#f8f9fa',
              borderRadius: 5,
              border: '1px solid #dee2e6'
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: currentPage === 1 ? "#e9ecef" : "#007bff",
                    color: currentPage === 1 ? "#6c757d" : "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: currentPage === 1 ? "not-allowed" : "pointer"
                  }}
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
                      style={{
                        padding: "8px 12px",
                        backgroundColor: currentPage === pageNum ? "#0056b3" : "#007bff",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontWeight: currentPage === pageNum ? "bold" : "normal"
                      }}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                {totalPages > 5 && currentPage < totalPages - 2 && (
                  <>
                    <span style={{ padding: "0 5px" }}>...</span>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      style={{
                        padding: "8px 12px",
                        backgroundColor: "#007bff",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer"
                      }}
                    >
                      {totalPages}
                    </button>
                  </>
                )}

                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: currentPage === totalPages ? "#e9ecef" : "#007bff",
                    color: currentPage === totalPages ? "#6c757d" : "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer"
                  }}
                >
                  Next
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, color: "#495057" }}>
                  Page {currentPage} of {totalPages}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
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
                    style={{
                      width: "50px",
                      padding: "5px",
                      textAlign: "center",
                      border: "1px solid #ccc",
                      borderRadius: 4
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ShoBilledChallan;