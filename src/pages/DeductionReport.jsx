import React, { useState, useEffect, useMemo } from "react";
import { db, auth } from "../firebaseConfig";
import {
    collection,
    getDocs,
    query,
    where,
    Timestamp,
    orderBy,
    limit,
    deleteDoc,
    doc,
    updateDoc
} from "firebase/firestore";
import * as XLSX from "xlsx";
import "./DeductionReport.css";

// Friendly label → exact Firestore FactoryName value
const FACTORY_OPTIONS = [
    { label: "JSW", value: "JSW" },
    { label: "Manigarh", value: "MANIGARH" },
    { label: "Ultratech", value: "ULTRATECH" }
];

// Column sequence for the table
const COLUMN_SEQUENCE = [
    "ChallanNo",
    "Destination",
    "VehicleNo",
    "DispatchDate",
    "DispatchQuantity",
    "UnitPrice",
    "TotalPrice",
    "FinalPrice",
    "Difference",
    "PartyName",
    "FactoryName",
    "BillNum",
    "BillType"
];

// ===== FORMAT DATE FOR DISPLAY (dd-MM-yyyy) =====
const formatShortDate = (date) => {
    if (!date) return "";
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
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

const DeductionReport = () => {
    const [reportData, setReportData] = useState([]);
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
    const [limitHit, setLimitHit] = useState(false);

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

    /* ================= FACTORY OPTIONS ================= */
    useEffect(() => {
        setFactoryOptions(FACTORY_OPTIONS.map(f => f.label));
        setFactoriesLoaded(true);
    }, []);

    const chunkArray = (arr, size) => {
        const chunked = [];
        for (let i = 0; i < arr.length; i += size) {
            chunked.push(arr.slice(i, i + size));
        }
        return chunked;
    };

    /* ================= FETCH DATA ================= */
    const fetchFilteredData = async () => {
        if (!filterFactory && !fromDate && !toDate) {
            setError("Please apply at least one filter to load data.");
            setDataLoaded(false);
            setReportData([]);
            return;
        }

        setLoading(true);
        setError("");

        try {
            const constraints = [];

            // Factory filter — map label to exact Firestore FactoryName (case-sensitive)
            if (filterFactory) {
                const opt = FACTORY_OPTIONS.find(f => f.label === filterFactory);
                const factoryValue = opt ? opt.value : filterFactory;
                constraints.push(where("FactoryName", "==", factoryValue));
            }

            // Date range on DispatchDate (Firestore Timestamp)
            if (fromDate) {
                const fromObj = new Date(fromDate);
                fromObj.setHours(0, 0, 0, 0);
                constraints.push(where("DispatchDate", ">=", Timestamp.fromDate(fromObj)));
            }

            if (toDate) {
                const toObj = new Date(toDate);
                toObj.setHours(23, 59, 59, 999);
                constraints.push(where("DispatchDate", "<=", Timestamp.fromDate(toObj)));
            }

            if (fromDate || toDate) {
                constraints.push(orderBy("DispatchDate", "desc"));
            }

            const READ_LIMIT = 500;
            constraints.push(limit(READ_LIMIT));

            const q = query(collection(db, "TblDispatch"), ...constraints);
            const snapshot = await getDocs(q);

            console.log("[DeductionReport] Docs returned:", snapshot.docs.length);
            setLimitHit(snapshot.docs.length === READ_LIMIT);

            if (snapshot.empty) {
                setError("No records found. Try adjusting your filters.");
                setLoading(false);
                return;
            }

            const combinedData = [];

            snapshot.docs.forEach(d => {
                const row = { id: d.id, ...d.data() };

                // Only billed challans (BillNum must exist)
                if (!row.BillNum || String(row.BillNum).trim() === "") return;

                // Numeric values
                const dispatchQty = parseFloat(row.DispatchQuantity || 0);
                const unitPrice = parseFloat(row.UnitPrice || row.unit_price || 0);
                const finalPrice = parseFloat(row.FinalPrice || 0);

                // Difference = TotalPrice - FinalPrice
                // Only show if: FinalPrice was actually paid (> 0) but is less than expected TotalPrice
                const totalPrice = dispatchQty * unitPrice;
                const difference = (finalPrice > 0 && totalPrice > 0 && finalPrice < totalPrice)
                    ? totalPrice - finalPrice
                    : 0;

                // Skip: FinalPrice = 0 (not yet billed/paid) or no short-payment
                if (difference <= 0) return;

                // Parse DispatchDate
                let dispatchDate = null;
                if (row.DispatchDate) {
                    if (row.DispatchDate.toDate) {
                        dispatchDate = row.DispatchDate.toDate();
                    } else if (row.DispatchDate.seconds) {
                        dispatchDate = new Date(row.DispatchDate.seconds * 1000);
                    } else {
                        dispatchDate = new Date(row.DispatchDate);
                    }
                }

                // FactoryName is stored directly in TblDispatch
                const factName = row.FactoryName || "N/A";

                combinedData.push({
                    id: d.id,
                    ChallanNo: row.ChallanNo || "N/A",
                    Destination: row.Destination || "N/A",
                    VehicleNo: row.VehicleNo || row.TruckNo || "N/A",
                    DispatchDate: dispatchDate,
                    DispatchQuantity: dispatchQty,
                    UnitPrice: unitPrice,
                    FinalPrice: finalPrice,
                    TotalPrice: totalPrice,
                    Difference: difference,
                    PartyName: row.PartyName || "N/A",
                    FactoryName: factName,
                    BillNum: String(row.BillNum),
                    BillDate: null,
                    BillType: row.BillType || "N/A",
                    rawChallanNo: row.ChallanNo || "",
                    rawBillNum: String(row.BillNum || "")
                });
            });

            // Client-side sort by DispatchDate DESC (safe fallback)
            combinedData.sort((a, b) => {
                const aT = a.DispatchDate ? a.DispatchDate.getTime() : 0;
                const bT = b.DispatchDate ? b.DispatchDate.getTime() : 0;
                return bT - aT;
            });

            console.log(`[DeductionReport] Fetched ${snapshot.docs.length} docs → ${combinedData.length} have Difference > 0`);

            setReportData(combinedData);
            setDataLoaded(true);


        } catch (err) {
            console.error("Error loading data:", err);
            if (err.code === "failed-precondition" || (err.message && err.message.includes("index"))) {
                setError(
                    `Firestore requires a composite index for this query. ` +
                    `Please check your browser console for the direct Firebase link to create it.`
                );
            } else {
                setError(`Failed to load data: ${err.message}`);
            }
            setDataLoaded(false);
            setReportData([]);
        } finally {
            setLoading(false);
        }
    };

    /* ================= APPLY FILTERS ================= */
    const applyFilters = () => {
        if (!filterFactory && !fromDate && !toDate) {
            setError("Please select at least one filter (Factory, From Date, or To Date) to load data.");
            return;
        }

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
        setReportData([]);
        setDataLoaded(false);
        setError("");
        setLimitHit(false);
    };

    /* ================= CLIENT-SIDE SEARCH FILTER ================= */
    const filteredData = useMemo(() => {
        if (!dataLoaded) return [];

        return reportData.filter(d => {
            // Always exclude zero-difference rows
            if (!d.Difference || d.Difference <= 0) return false;

            const { searchTerm } = appliedFilters;

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
    }, [reportData, appliedFilters, dataLoaded]);

    /* ================= PAGINATION ================= */
    const totalRecords = reportData.length;
    const filteredCount = filteredData.length;
    const totalPages = Math.ceil(filteredCount / recordsPerPage);

    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = Math.min(startIndex + recordsPerPage, filteredCount);

    const paginatedData = filteredData.slice(startIndex, endIndex);

    const isAllSelected = paginatedData.length > 0 &&
        paginatedData.every(d => selectedIds.includes(d.id));

    /* ================= HANDLERS ================= */
    const handleEdit = (row) => {
        setEditId(row.id);
        setEditChallan(row.rawChallanNo || "");
        setEditBillNum(row.rawBillNum || "");
    };

    const handleSave = async (id) => {
        try {
            // Find the record to get its BillID
            const record = reportData.find(d => d.id === id);
            if (!record) return;

            const updates = {
                ChallanNo: editChallan
            };

            // If admin and BillNum is being edited, update the BillTable
            if (isAdmin && editBillNum !== undefined && record.BillNum !== editBillNum) {
                // You might need to update the BillTable here
                // This depends on your data structure
                console.log("Would update BillNum to:", editBillNum);
            }

            await updateDoc(doc(db, "TblDispatch", id), updates);

            setReportData(prev =>
                prev.map(d =>
                    d.id === id ? {
                        ...d,
                        ChallanNo: editChallan,
                        rawChallanNo: editChallan,
                        BillNum: isAdmin ? editBillNum : d.BillNum,
                        rawBillNum: isAdmin ? editBillNum : d.rawBillNum
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
            setReportData(prev => prev.filter(d => d.id !== id));
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
            await Promise.all(
                selectedIds.map(id =>
                    deleteDoc(doc(db, "TblDispatch", id))
                )
            );
            setReportData(prev => prev.filter(d => !selectedIds.includes(d.id)));
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
                prev.filter(id => !paginatedData.some(d => d.id === id))
            );
        } else {
            setSelectedIds(prev => [
                ...new Set([...prev, ...paginatedData.map(d => d.id)])
            ]);
        }
    };

    /* ================= EXPORT TO EXCEL ================= */
    const exportToExcel = () => {
        if (!filteredData.length) {
            setError("No data to export. Please apply filters first.");
            return;
        }

        const excelData = filteredData.map(d => {
            const row = {};
            COLUMN_SEQUENCE.forEach(k => {
                if (k === "DispatchDate" || k === "BillDate") {
                    row[k] = d[k] instanceof Date ? formatShortDate(d[k]) :
                        d[k]?.toDate ? formatShortDate(d[k].toDate()) :
                            d[k] || "N/A";
                } else if (k === "Difference") {
                    row[k] = d[k] ? d[k].toFixed(2) : "0.00";
                } else if (["DispatchQuantity", "UnitPrice", "FinalPrice"].includes(k)) {
                    row[k] = d[k] ? parseFloat(d[k]).toFixed(2) : "0.00";
                } else {
                    row[k] = d[k] || "—";
                }
            });
            return row;
        });

        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Deduction Report");
        XLSX.writeFile(wb, `Deduction_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
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

    /* ================= SUMMARY CALCULATIONS ================= */
    const summary = useMemo(() => {
        let totalDifference = 0;
        let positiveDifferences = 0;
        let totalDeduction = 0;

        reportData.forEach(d => {
            if (d.Difference > 0) {
                totalDifference += d.Difference;
                totalDeduction += d.Difference;
                positiveDifferences++;
            }
        });

        return { totalDifference, positiveDifferences, totalDeduction };
    }, [reportData]);

    /* ================= UI RENDER ================= */
    return (
        <div className="container">
            <h2>Deduction Report - Billed Challan Analysis</h2>

            {/* Instructions */}
            <div className="instructions">
                <strong>Instructions:</strong> Select filters (Factory Name, From Date, or To Date) and click "Apply Filters" to load data.
                The Difference column shows (Quantity × Unit Price) - Final Price.
            </div>

            {/* Error/Warning Message */}
            {error && (
                <div className={`message ${error.includes("Please select") || error.includes("cannot be after")
                    ? 'info'
                    : error.includes("No records found")
                        ? 'info'
                        : 'error'
                    }`}>
                    <strong>
                        {error.includes("Please select") || error.includes("cannot be after") || error.includes("No records found")
                            ? "ℹ️ Information"
                            : "⚠️ Error"}
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
                            {FACTORY_OPTIONS.map(f => (
                                <option key={f.value} value={f.label}>
                                    {f.label}
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

            {/* Deduction Summary Banner */}
            {dataLoaded && summary.totalDeduction > 0 && (
                <div className="deduction-summary-banner" style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '20px',
                    padding: '15px 20px',
                    backgroundColor: '#fff3cd',
                    border: '1px solid #ffc107',
                    borderLeft: '5px solid #ffc107',
                    borderRadius: '8px'
                }}>
                    <div className="deduction-icon" style={{ fontSize: '24px', marginRight: '15px' }}>⚠️</div>
                    <div className="deduction-info" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        color: '#856404'
                    }}>
                        <strong style={{ fontSize: '16px' }}>Total Deduction Summary</strong>
                        <span>Total Short Payment: <strong style={{ color: '#d32f2f' }}>
                            ₹ {summary.totalDeduction.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </strong></span>
                        <span>Affected Challans: <strong>{summary.positiveDifferences}</strong></span>
                    </div>
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
                            {" "}to {appliedFilters.toDate ? formatShortDate(appliedFilters.toDate) : 'Any'}
                        </span>
                    )}
                    <span className="loaded-records">
                        <strong>Loaded Records:</strong> {totalRecords}
                        {limitHit && (
                            <span className="limit-badge"> ⚠️ Limit 500</span>
                        )}
                    </span>
                </div>
            )}

            {/* Limit Warning Banner */}
            {limitHit && dataLoaded && (
                <div className="message limit-warning">
                    <strong>⚠️ Result Capped at 500 Records</strong> — Your query matched more than 500 records.
                    Please narrow your filters to see all data.
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
                        <span className="stat-item" style={{ color: '#d32f2f' }}>
                            Records with Deduction: {summary.positiveDifferences}
                        </span>
                        <span className="stat-item" style={{ color: '#d32f2f' }}>
                            Total Deduction: ₹ {summary.totalDeduction.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
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
                                                disabled={paginatedData.length === 0}
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
                                {paginatedData.length > 0 ? (
                                    paginatedData.map(d => (
                                        <tr
                                            key={d.id}
                                            className={d.Difference > 0 ? 'deduction-row' : ''}
                                        >
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
                                                        d[col] ? formatShortDate(d[col]) : "N/A"
                                                    ) : col === "BillDate" ? (
                                                        d[col]?.toDate ? formatShortDate(d[col].toDate()) :
                                                            d[col]?.seconds ? formatShortDate(new Date(d[col].seconds * 1000)) :
                                                                d[col] ? formatShortDate(d[col]) : "N/A"
                                                    ) : col === "DispatchQuantity" || col === "UnitPrice" || col === "TotalPrice" || col === "FinalPrice" ? (
                                                        <span className="quantity">
                                                            {d[col] ? parseFloat(d[col]).toFixed(2) : "0.00"}
                                                        </span>
                                                    ) : col === "Difference" ? (
                                                        <span style={{
                                                            color: d[col] > 0 ? '#d32f2f' : d[col] < 0 ? '#2e7d32' : 'inherit',
                                                            fontWeight: d[col] !== 0 ? 'bold' : 'normal'
                                                        }}>
                                                            {d[col] ? d[col].toFixed(2) : "0.00"}
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
                                            No records found with the current filters. Try adjusting your filters.
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
        </div>
    );
};

export default DeductionReport;