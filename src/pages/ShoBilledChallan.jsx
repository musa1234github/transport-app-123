import React, { useEffect, useState, useCallback, useMemo } from "react";
import { db, auth } from "../firebaseConfig";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  query,
  where
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
  const [clientSideFiltering, setClientSideFiltering] = useState(false);
  
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

  /* ================= FETCH FACTORY OPTIONS ================= */
  useEffect(() => {
    const fetchFactoryOptions = async () => {
      try {
        const snapshot = await getDocs(collection(db, "TblDispatch"));
        const factoriesSet = new Set();
        
        snapshot.docs.slice(0, 50).forEach(ds => {
          const row = ds.data();
          const disVid = String(row.DisVid || "");
          
          if (factoryMap[disVid]) {
            factoriesSet.add(factoryMap[disVid]);
          } else if (row.FactoryName) {
            factoriesSet.add(row.FactoryName);
          }
        });
        
        setFactoryOptions(Array.from(factoriesSet).sort());
        setFactoriesLoaded(true);
      } catch (error) {
        console.error("Error fetching factory options:", error);
        setFactoryOptions([]);
        setFactoriesLoaded(true);
      }
    };
    
    fetchFactoryOptions();
  }, []);

  /* ================= FETCH DATA WITH FILTERS ================= */
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
    setClientSideFiltering(false);
    
    try {
      let q = collection(db, "TblDispatch");
      let snapshot;
      
      // SIMPLE FILTERING APPROACH - Get all and filter client-side
      // This avoids composite index errors completely
      snapshot = await getDocs(q);
      
      // Process all data
      let allData = snapshot.docs.map(ds => {
        const row = { id: ds.id, ...ds.data() };
        row.DisVid = String(row.DisVid || "");
        
        // Handle date conversion
        if (row.DispatchDate) {
          if (row.DispatchDate.toDate) {
            // Firestore Timestamp
            const dateObj = row.DispatchDate.toDate();
            row.DispatchDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
          } else if (row.DispatchDate.seconds) {
            // Timestamp object
            const dateObj = new Date(row.DispatchDate.seconds * 1000);
            row.DispatchDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
          } else {
            // Already Date or string
            const dateObj = new Date(row.DispatchDate);
            row.DispatchDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
          }
        }
        
        // Set FactoryName
        row.FactoryName = row.FactoryName || factoryMap[row.DisVid] || "";
        
        // Normalize BillNum
        row.BillNum = String(row.BillNum || "").trim();
        
        return row;
      });

      // Apply filters client-side
      let filteredData = allData.filter(row => {
        // Factory filter
        if (filterFactory) {
          const matchesFactory = row.FactoryName === filterFactory || 
                                 factoryMap[row.DisVid] === filterFactory;
          if (!matchesFactory) return false;
        }
        
        // Date filters
        if (fromDate || toDate) {
          const rowDate = normalizeDate(row.DispatchDate);
          const from = fromDate ? normalizeDate(new Date(fromDate)) : null;
          const to = toDate ? normalizeDate(new Date(toDate)) : null;

          // Check from date
          if (from && rowDate && rowDate.getTime() < from.getTime()) {
            return false;
          }
          
          // Check to date (include entire toDate)
          if (to && rowDate) {
            const toEndOfDay = new Date(to);
            toEndOfDay.setDate(toEndOfDay.getDate() + 1);
            if (rowDate.getTime() >= toEndOfDay.getTime()) {
              return false;
            }
          }
        }
        
        return true;
      });

      // Sort by date descending
      filteredData.sort((a, b) => {
        const dateA = a.DispatchDate ? new Date(a.DispatchDate).getTime() : 0;
        const dateB = b.DispatchDate ? new Date(b.DispatchDate).getTime() : 0;
        return dateB - dateA;
      });

      setDispatches(filteredData);
      setDataLoaded(true);
      setClientSideFiltering(true);
      
      if (filteredData.length === 0) {
        setError("No records found with the current filters.");
      } else {
        setError("Using client-side filtering for better performance with combined filters.");
      }
      
    } catch (error) {
      console.error("Error fetching data:", error);
      setError(`Failed to load data: ${error.message}`);
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
    setClientSideFiltering(false);
  };

  /* ================= CLIENT-SIDE SEARCH FILTER ================= */
  const filteredDispatches = useMemo(() => {
    if (!dataLoaded) return [];
    
    return dispatches.filter(d => {
      const { searchTerm } = appliedFilters;

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
      for (let id of selectedIds) {
        await deleteDoc(doc(db, "TblDispatch", id));
      }
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
  const exportToExcel = () => {
    if (!filteredDispatches.length) {
      setError("No data to export. Please apply filters first.");
      return;
    }

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
    XLSX.writeFile(wb, `Billed_Challan_${new Date().toISOString().split('T')[0]}.xlsx`);
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
  const billedCount = dispatches.filter(d => d.BillNum && d.BillNum.trim() !== "").length;
  const unbilledCount = dispatches.filter(d => !d.BillNum || d.BillNum.trim() === "").length;

  return (
    <div className="container">
      <h2>Billed Challan Data</h2>

      {/* Instructions */}
      <div className="instructions">
        <strong>Instructions:</strong> Select at least one filter (Factory Name, From Date, or To Date) and click "Apply Filters" to load data.
      </div>

      {/* Error/Warning Message */}
      {error && (
        <div className={`message ${error.includes("Please select") || error.includes("cannot be after") ? 'info' : error.includes("client-side") ? 'warning' : 'error'}`}>
          <strong>
            {error.includes("Please select") || error.includes("cannot be after") ? "ℹ️ Information" : 
             error.includes("client-side") ? "⚠️ Performance Notice" : "⚠️ Error"}
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
              to {appliedFilters.toDate ? formatShortDate(appliedFilters.toDate) : 'Any'}
            </span>
          )}
          {clientSideFiltering && <span className="client-filter-tag">(Client-side filtering)</span>}
          <span className="loaded-records">
            <strong>Loaded Records:</strong> {totalRecords}
          </span>
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
                    <tr key={d.id} className={d.BillNum ? 'billed-row' : 'unbilled-row'}>
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