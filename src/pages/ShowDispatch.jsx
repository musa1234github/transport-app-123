import ExportDispatchButton from "../components/ExportDispatchButton";
import React, { useEffect, useState } from "react";
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

const FACTORY_NAME_FIXES = {
  MANIGARH: "MANIGARH"
};

const factoryMap = {
  "10": "JSW",
  "6": "MANIGARH",
  "7": "ULTRATECH",
};

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

const ShowDispatch = () => {
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

  // Applied filters
  const [appliedFilters, setAppliedFilters] = useState({
    searchTerm: "",
    filterFactory: "",
    fromDate: "",
    toDate: ""
  });

  const [editId, setEditId] = useState(null);
  const [editChallan, setEditChallan] = useState("");

  const recordsPerPage = 10;

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

  // Function to fetch data with filters
  const fetchDispatches = async () => {
    setLoading(true);
    try {
      let q = collection(db, "TblDispatch");
      
      // Build query based on filters
      const conditions = [];
      
      // Only add factory filter if selected
      if (appliedFilters.filterFactory) {
        // Filter by normalized factory name
        conditions.push(where("FactoryName", "==", appliedFilters.filterFactory));
        
        // Also check for DisVid mapping if the factory is from factoryMap
        const reverseMap = Object.entries(factoryMap).find(
          ([, value]) => value === appliedFilters.filterFactory
        );
        if (reverseMap) {
          const [disVid] = reverseMap;
          // If we have DisVid, we could add an OR condition, but Firestore doesn't support OR in the same query easily
          // We'll handle this in local filtering instead
        }
      }
      
      let querySnapshot;
      if (conditions.length > 0) {
        const firestoreQuery = query(q, ...conditions);
        querySnapshot = await getDocs(firestoreQuery);
      } else {
        querySnapshot = await getDocs(q);
      }
      
      const data = querySnapshot.docs.map(ds => {
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
        } else if (row.DisVid) {
          row.FactoryName = factoryMap[row.DisVid] || "";
        }

        return row;
      });

      // Apply additional local filtering for DisVid mapping and dates
      let filteredData = data;
      
      // Additional factory filtering for DisVid mapped records
      if (appliedFilters.filterFactory) {
        filteredData = filteredData.filter(d => {
          const recordFactory = d.FactoryName || "";
          return recordFactory === appliedFilters.filterFactory;
        });
      }
      
      // Apply date range filtering
      if (appliedFilters.fromDate || appliedFilters.toDate) {
        filteredData = filteredData.filter(d => {
          const rowDate = normalizeDate(d.DispatchDate);
          const from = appliedFilters.fromDate ? normalizeDate(new Date(appliedFilters.fromDate)) : null;
          const to = appliedFilters.toDate ? normalizeDate(new Date(appliedFilters.toDate)) : null;

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
        });
      }

      setDispatches(filteredData);
      setDataLoaded(true);
      setCurrentPage(1);
    } catch (error) {
      console.error("Error fetching dispatches:", error);
    } finally {
      setLoading(false);
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

    // Set applied filters
    setAppliedFilters({
      searchTerm,
      filterFactory: normalizedFactory,
      fromDate,
      toDate
    });
    
    // Don't fetch here - let useEffect handle it
  };

  // Fetch data when appliedFilters changes
  useEffect(() => {
    if (appliedFilters.filterFactory !== "" || appliedFilters.fromDate || appliedFilters.toDate) {
      fetchDispatches();
    }
  }, [appliedFilters]);

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
    setDispatches([]);
    setDataLoaded(false);
    setSelectedIds([]);
    setCurrentPage(1);
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

  /* ================= FILTER DATA FOR DISPLAY ================= */
  // Apply search filter to already loaded data
  const filteredDispatches = dataLoaded ? dispatches.filter(d => {
    const terms = appliedFilters.searchTerm
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) return true;

    return terms.every(term =>
      Object.values(d).some(v => {
        if (!v) return false;
        if (v instanceof Date) {
          return formatShortDate(v).toLowerCase().includes(term);
        }
        return v.toString().toLowerCase().includes(term);
      })
    );
  }) : [];

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
            disabled={filteredCount === 0}
            style={{ 
              padding: "8px 16px", 
              backgroundColor: filteredCount === 0 ? "#6c757d" : "#28a745", 
              color: "white", 
              border: "none", 
              borderRadius: 4, 
              cursor: filteredCount === 0 ? "not-allowed" : "pointer" 
            }}
          >
            Export Excel ({filteredCount})
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
            <table border="1" width="100%" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f2f2f2" }}>
                  {isAdmin && (
                    <th style={{ padding: 10 }}>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleSelectAll}
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
                    <tr key={d.id} style={{ borderBottom: "1px solid #ddd" }}>
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
                            />
                          ) : col === "DispatchDate" ? (
                            formatShortDate(d[col])
                          ) : (
                            d[col]
                          )}
                        </td>
                      ))}

                      {isAdmin && (
                        <td style={{ padding: 10 }}>
                          {editId === d.id ? (
                            <>
                              <button 
                                onClick={() => handleSave(d.id)}
                                style={{ marginRight: 5, padding: "5px 10px", backgroundColor: "#28a745", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
                              >
                                Save
                              </button>
                              <button 
                                onClick={handleCancel}
                                style={{ padding: "5px 10px", backgroundColor: "#6c757d", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button 
                                onClick={() => handleEdit(d)}
                                style={{ marginRight: 5, padding: "5px 10px", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
                              >
                                Edit
                              </button>
                              <button 
                                onClick={() => handleDelete(d.id)}
                                style={{ padding: "5px 10px", backgroundColor: "#dc3545", color: "white", border: "none", borderRadius: 3, cursor: "pointer" }}
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
                      style={{ padding: 20, textAlign: "center" }}
                    >
                      No records found for the selected filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 20, fontWeight: "bold", color: "#333" }}>
            Showing {filteredCount === 0 ? 0 : startIndex + 1}–{endIndex} of{" "}
            {filteredCount} records
          </div>

          {totalPages > 1 && (
            <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 5 }}>
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

              {[...Array(totalPages)].map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i + 1)}
                  style={{ 
                    padding: "8px 12px", 
                    backgroundColor: currentPage === i + 1 ? "#0056b3" : "#007bff", 
                    color: "white", 
                    border: "none", 
                    borderRadius: 4, 
                    cursor: "pointer",
                    fontWeight: currentPage === i + 1 ? "bold" : "normal" 
                  }}
                >
                  {i + 1}
                </button>
              ))}

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
          )}
        </>
      )}

      {/* Initial state - no data loaded yet */}
      {!loading && !dataLoaded && (
        <div style={{ 
          textAlign: "center", 
          padding: 40, 
          backgroundColor: "#f8f9fa", 
          borderRadius: 8,
          marginTop: 20
        }}>
          <p style={{ fontSize: 16, color: "#6c757d" }}>
            No data loaded yet. Please set your filters and click "Apply Filters" to load data.
          </p>
          <p style={{ fontSize: 14, color: "#6c757d", marginTop: 10 }}>
            This reduces unnecessary database reads and improves performance.
          </p>
        </div>
      )}
    </div>
  );
};

export default ShowDispatch;