import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebaseConfig';
import {
    collection, getDocs, query, orderBy, where,
    updateDoc, doc, serverTimestamp, limit, startAfter, getCountFromServer
} from 'firebase/firestore';
import './GstReport.css';
import * as XLSX from 'xlsx';

/* ─── helpers ─────────────────────────────────────── */
const fmtDate = (val) => {
    if (!val) return '';
    try {
        const d = val?.toDate ? val.toDate() : new Date(val);
        if (isNaN(d)) return '';
        return d.toISOString().slice(0, 10);   // YYYY-MM-DD
    } catch { return ''; }
};

const fmtGst = (val) => {
    if (val == null || val === '') return '';
    const n = Number(val);
    return isNaN(n) ? String(val) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const getBillNum = (r) => r.BillNum ?? r.BillNumber ?? r.BillNo ?? r.billNumber ?? '';
const getGst = (r) => r.Gst ?? r.GSTAmount ?? r.GstAmount ?? '';
const getGstDate = (r) => r.GstReceivedDate ?? r.GSTUpdateDate ?? null;

/* ─── component ───────────────────────────────────── */
const GstReport = ({ userRole }) => {
    /* filter state */
    const [factories, setFactories] = useState([]);
    const [selectedFactory, setSelectedFactory] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [pageSize, setPageSize] = useState(10);

    /* server-side pagination state */
    const [rows, setRows] = useState([]);       // current page rows
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);        // total matching docs
    const [hasNextPage, setHasNextPage] = useState(false);
    const pageCursors = useRef([null]);     // index = page-1, value = startAfter cursor doc

    /* ui state */
    const [isLoading, setIsLoading] = useState(false);
    const [isPaging, setIsPaging] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [hasSearched, setHasSearched] = useState(false);

    /* edit modal */
    const [editRow, setEditRow] = useState(null);
    const [editDate, setEditDate] = useState('');
    const [saving, setSaving] = useState(false);

    /* export progress */
    const [exporting, setExporting] = useState(false);

    const isAdmin = userRole === 'admin';

    /* ── load factories once ── */
    useEffect(() => {
        const load = async () => {
            try {
                const snap = await getDocs(
                    query(collection(db, 'factories'), orderBy('factoryName'))
                );
                setFactories(snap.docs.map(d => ({ id: d.id, name: d.data().factoryName })));
            } catch (e) { console.error('Failed to load factories', e); }
        };
        load();
    }, []);

    /* ── base query builder (no limit/cursor) ── */
    const buildBaseQuery = (fac, from, to) =>
        query(
            collection(db, 'BillTable'),
            where('FactoryName', '==', fac),
            where('GstReceivedDate', '>=', from),
            where('GstReceivedDate', '<=', to),
            orderBy('GstReceivedDate', 'asc')
        );

    /* ── fetch one page from Firestore ── */
    const fetchPage = async (fac, from, to, cursorDoc, pgSize) => {
        let q = buildBaseQuery(fac, from, to);
        q = query(q, limit(pgSize + 1));          // +1 to detect if next page exists
        if (cursorDoc) q = query(q, startAfter(cursorDoc));

        const snap = await getDocs(q);
        const hasMore = snap.docs.length > pgSize;
        const docs = snap.docs.slice(0, pgSize);
        const data = docs.map(d => ({ id: d.id, ...d.data() }));
        return { data, lastDoc: docs[docs.length - 1] ?? null, hasMore };
    };

    /* ── initial search ── */
    const handleSearch = async () => {
        if (!selectedFactory) { setErrorMsg('Please select a factory.'); return; }
        if (!fromDate || !toDate) { setErrorMsg('Please select both From Date and To Date.'); return; }
        if (fromDate > toDate) { setErrorMsg('From Date must be before To Date.'); return; }

        setErrorMsg('');
        setIsLoading(true);
        setHasSearched(true);

        // reset cursors
        pageCursors.current = [null];

        const from = new Date(fromDate + 'T00:00:00');
        const to = new Date(toDate + 'T23:59:59');

        try {
            // Get total count (1 read, not charged per document)
            const countSnap = await getCountFromServer(buildBaseQuery(selectedFactory, from, to));
            setTotalCount(countSnap.data().count);

            // Fetch first page
            const { data, lastDoc, hasMore } = await fetchPage(selectedFactory, from, to, null, pageSize);
            setRows(data);
            setHasNextPage(hasMore);
            setCurrentPage(1);

            // Store cursor for page 2
            pageCursors.current = [null, lastDoc];
        } catch (e) {
            setErrorMsg('Failed to load data: ' + e.message);
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    /* ── navigate to a different page ── */
    const gotoPage = async (targetPage) => {
        if (targetPage < 1 || targetPage > totalPages || isPaging) return;
        setIsPaging(true);

        const from = new Date(fromDate + 'T00:00:00');
        const to = new Date(toDate + 'T23:59:59');

        try {
            const cursorDoc = pageCursors.current[targetPage - 1] ?? null;
            const { data, lastDoc, hasMore } = await fetchPage(selectedFactory, from, to, cursorDoc, pageSize);
            setRows(data);
            setHasNextPage(hasMore);
            setCurrentPage(targetPage);

            // Store cursor for next page if not already cached
            if (!pageCursors.current[targetPage]) {
                pageCursors.current[targetPage] = lastDoc;
            }
        } catch (e) {
            setErrorMsg('Failed to load page: ' + e.message);
        } finally {
            setIsPaging(false);
        }
    };

    /* ── page size change → restart from page 1 ── */
    const handlePageSizeChange = (newSize) => {
        setPageSize(newSize);
        pageCursors.current = [null];
        setCurrentPage(1);
        setRows([]);

        // re-fetch first page with new size
        if (!hasSearched || !selectedFactory || !fromDate || !toDate) return;
        const from = new Date(fromDate + 'T00:00:00');
        const to = new Date(toDate + 'T23:59:59');
        setIsPaging(true);
        fetchPage(selectedFactory, from, to, null, newSize)
            .then(({ data, lastDoc, hasMore }) => {
                setRows(data);
                setHasNextPage(hasMore);
                pageCursors.current = [null, lastDoc];
            })
            .catch(e => setErrorMsg('Failed: ' + e.message))
            .finally(() => setIsPaging(false));
    };

    /* ── clear ── */
    const handleClear = () => {
        setSelectedFactory('');
        setFromDate('');
        setToDate('');
        setRows([]);
        setHasSearched(false);
        setErrorMsg('');
        setCurrentPage(1);
        setTotalCount(0);
        pageCursors.current = [null];
    };

    /* ── excel export — reads all matching docs (once, on demand) ── */
    const handleExport = async () => {
        if (totalCount === 0) return;
        setExporting(true);

        const from = new Date(fromDate + 'T00:00:00');
        const to = new Date(toDate + 'T23:59:59');

        try {
            // Read all matching docs in batches of 500 to avoid Firestore limits
            const BATCH = 500;
            let allData = [];
            let cursor = null;

            do {
                let q = buildBaseQuery(selectedFactory, from, to);
                q = query(q, limit(BATCH));
                if (cursor) q = query(q, startAfter(cursor));

                const snap = await getDocs(q);
                const docs = snap.docs;
                allData = allData.concat(docs.map(d => ({ id: d.id, ...d.data() })));
                cursor = docs.length === BATCH ? docs[docs.length - 1] : null;
            } while (cursor);

            const exportData = allData.map(r => ({
                'Factory Name': r.FactoryName ?? '',
                'Bill Number': getBillNum(r),
                'Bill Date': fmtDate(r.BillDate),
                'GST Amount': getGst(r),
                'GST Received Date': fmtDate(getGstDate(r)),
            }));

            const ws = XLSX.utils.json_to_sheet(exportData);
            const colWidths = Object.keys(exportData[0]).map(key => ({
                wch: Math.max(key.length, ...exportData.map(row => String(row[key] ?? '').length)) + 2
            }));
            ws['!cols'] = colWidths;

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'GST Report');

            const fileName = `GST_Report_${selectedFactory}_${fromDate}_to_${toDate}.xlsx`;
            XLSX.writeFile(wb, fileName);
        } catch (e) {
            setErrorMsg('Export failed: ' + e.message);
        } finally {
            setExporting(false);
        }
    };

    /* ── pagination math ── */
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const startEntry = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const endEntry = Math.min(currentPage * pageSize, totalCount);

    /* page buttons (max 5 visible) */
    const getPageNumbers = () => {
        const half = 2;
        let start = Math.max(1, currentPage - half);
        let end = Math.min(totalPages, currentPage + half);
        if (currentPage <= half) end = Math.min(totalPages, 5);
        if (currentPage >= totalPages - half) start = Math.max(1, totalPages - 4);
        const pages = [];
        for (let i = start; i <= end; i++) pages.push(i);
        return pages;
    };
    const pageNumbers = getPageNumbers();

    /* ── edit modal handlers ── */
    const openEdit = (row) => {
        setEditRow(row);
        setEditDate(fmtDate(getGstDate(row)));
    };

    const handleSave = async () => {
        if (!editDate) { alert('Please select a GST Received Date.'); return; }
        setSaving(true);
        try {
            const dateVal = new Date(editDate + 'T00:00:00');
            await updateDoc(doc(db, 'BillTable', editRow.id), {
                GstReceivedDate: dateVal,
                UpdatedAt: serverTimestamp()
            });
            setRows(prev => prev.map(r =>
                r.id === editRow.id ? { ...r, GstReceivedDate: dateVal } : r
            ));
            setEditRow(null);
        } catch (e) {
            alert('Save failed: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const loading = isLoading || isPaging;

    /* ── render ── */
    return (
        <div className="gst-report-container">
            <h1 className="gst-report-title">GST Report</h1>

            {/* ── FILTER BAR ── */}
            <div className="gst-filter-bar">
                <div className="gst-filter-group">
                    <label className="gst-filter-label">Factory</label>
                    <select
                        id="gst-factory-select"
                        className="gst-filter-select"
                        value={selectedFactory}
                        onChange={e => setSelectedFactory(e.target.value)}
                    >
                        <option value="">-- Select Factory --</option>
                        {factories.map(f => (
                            <option key={f.id} value={f.name}>{f.name}</option>
                        ))}
                    </select>
                </div>

                <div className="gst-filter-group">
                    <label className="gst-filter-label">From Date</label>
                    <input
                        type="date"
                        id="gst-from-date"
                        className="gst-filter-input"
                        value={fromDate}
                        onChange={e => setFromDate(e.target.value)}
                    />
                </div>

                <div className="gst-filter-group">
                    <label className="gst-filter-label">To Date</label>
                    <input
                        type="date"
                        id="gst-to-date"
                        className="gst-filter-input"
                        value={toDate}
                        onChange={e => setToDate(e.target.value)}
                    />
                </div>

                <div className="gst-filter-buttons">
                    <button
                        id="gst-search-btn"
                        className="gst-btn gst-btn-search"
                        onClick={handleSearch}
                        disabled={loading}
                    >
                        {isLoading ? 'Loading…' : '🔍 Search'}
                    </button>
                    <button
                        id="gst-clear-btn"
                        className="gst-btn gst-btn-clear"
                        onClick={handleClear}
                        disabled={loading}
                    >
                        ✖ Clear
                    </button>
                </div>
            </div>

            {/* error */}
            {errorMsg && <div className="gst-error">{errorMsg}</div>}

            {/* ── TABLE CONTROLS ── */}
            {hasSearched && !isLoading && (
                <>
                    <div className="gst-table-controls">
                        <div className="gst-show-entries">
                            <span>Show</span>
                            <select
                                id="gst-page-size"
                                value={pageSize}
                                onChange={e => handlePageSizeChange(Number(e.target.value))}
                                disabled={loading}
                            >
                                {[10, 25, 50, 100].map(n => (
                                    <option key={n} value={n}>{n}</option>
                                ))}
                            </select>
                            <span>entries</span>
                        </div>

                        <div className="gst-info-badge">
                            {totalCount.toLocaleString()} record{totalCount !== 1 ? 's' : ''} found
                        </div>

                        <button
                            id="gst-export-btn"
                            className="gst-btn gst-btn-export"
                            onClick={handleExport}
                            disabled={totalCount === 0 || exporting}
                            title={totalCount === 0 ? 'No data to export' : `Export ${totalCount} records to Excel`}
                        >
                            {exporting ? '⏳ Exporting…' : `📥 Export Excel (${totalCount.toLocaleString()})`}
                        </button>
                    </div>

                    {/* ── TABLE ── */}
                    <div className="gst-table-wrapper" style={{ opacity: isPaging ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                        <table className="gst-table" id="gst-report-table">
                            <thead>
                                <tr>
                                    <th>Factory Name</th>
                                    <th>Bill Number</th>
                                    <th>Bill Date</th>
                                    <th>GST Amount</th>
                                    <th>GST Received Date</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="gst-no-data">
                                            No records found for the selected filters.
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((row, idx) => {
                                        const gstReceived = getGstDate(row);
                                        return (
                                            <tr key={row.id} className={idx % 2 === 0 ? '' : 'gst-row-alt'}>
                                                <td>{row.FactoryName ?? ''}</td>
                                                <td className="gst-bill-no">{getBillNum(row)}</td>
                                                <td>{fmtDate(row.BillDate)}</td>
                                                <td>{fmtGst(getGst(row))}</td>
                                                <td className={gstReceived ? '' : 'gst-empty-date'}>
                                                    {fmtDate(gstReceived)}
                                                </td>
                                                <td>
                                                    {isAdmin && (
                                                        <button
                                                            className="gst-edit-btn"
                                                            onClick={() => openEdit(row)}
                                                            id={`edit-btn-${row.id}`}
                                                        >
                                                            Edit
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* ── PAGINATION FOOTER ── */}
                    <div className="gst-pagination">
                        <div className="gst-pagination-info">
                            {totalCount === 0
                                ? 'Showing 0 entries'
                                : `Showing ${startEntry} to ${endEntry} of ${totalCount.toLocaleString()} entries`}
                        </div>

                        <div className="gst-pagination-buttons">
                            <button
                                className="gst-page-btn"
                                onClick={() => gotoPage(currentPage - 1)}
                                disabled={currentPage === 1 || loading}
                            >Previous</button>

                            {pageNumbers[0] > 1 && (
                                <>
                                    <button className="gst-page-btn" onClick={() => gotoPage(1)}>1</button>
                                    {pageNumbers[0] > 2 && <span className="gst-page-dots">…</span>}
                                </>
                            )}

                            {pageNumbers.map(p => (
                                <button
                                    key={p}
                                    className={`gst-page-btn ${p === currentPage ? 'gst-page-active' : ''}`}
                                    onClick={() => gotoPage(p)}
                                    disabled={loading}
                                >
                                    {p}
                                </button>
                            ))}

                            {pageNumbers[pageNumbers.length - 1] < totalPages && (
                                <>
                                    {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                                        <span className="gst-page-dots">…</span>
                                    )}
                                    <button className="gst-page-btn" onClick={() => gotoPage(totalPages)} disabled={loading}>
                                        {totalPages}
                                    </button>
                                </>
                            )}

                            <button
                                className="gst-page-btn"
                                onClick={() => gotoPage(currentPage + 1)}
                                disabled={currentPage === totalPages || !hasNextPage || loading}
                            >Next</button>
                        </div>
                    </div>
                </>
            )}

            {/* loading spinner */}
            {loading && (
                <div className="gst-loading">⏳ {isPaging ? 'Loading page…' : 'Loading records…'}</div>
            )}

            {/* prompt before search */}
            {!hasSearched && !isLoading && (
                <div className="gst-prompt">
                    Select a factory and date range, then click <strong>Search</strong> to load records.
                </div>
            )}

            {/* ── EDIT MODAL ── */}
            {editRow && (
                <div className="gst-modal-overlay" onClick={() => !saving && setEditRow(null)}>
                    <div className="gst-modal" onClick={e => e.stopPropagation()}>
                        <h3 className="gst-modal-title">Edit GST Received Date</h3>

                        <div className="gst-modal-row">
                            <span className="gst-modal-label">Bill Number:</span>
                            <span>{getBillNum(editRow) || '—'}</span>
                        </div>
                        <div className="gst-modal-row">
                            <span className="gst-modal-label">Bill Date:</span>
                            <span>{fmtDate(editRow.BillDate)}</span>
                        </div>
                        <div className="gst-modal-row">
                            <span className="gst-modal-label">GST Amount:</span>
                            <span>{fmtGst(getGst(editRow))}</span>
                        </div>

                        <div className="gst-modal-field">
                            <label className="gst-modal-label" htmlFor="modal-gst-date">
                                GST Received Date:
                            </label>
                            <input
                                id="modal-gst-date"
                                type="date"
                                value={editDate}
                                onChange={e => setEditDate(e.target.value)}
                                className="gst-filter-input"
                            />
                        </div>

                        <div className="gst-modal-actions">
                            <button
                                className="gst-btn gst-btn-save"
                                onClick={handleSave}
                                disabled={saving}
                                id="modal-save-btn"
                            >
                                {saving ? 'Saving…' : '✔ Save'}
                            </button>
                            <button
                                className="gst-btn gst-btn-cancel"
                                onClick={() => setEditRow(null)}
                                disabled={saving}
                                id="modal-cancel-btn"
                            >
                                ✖ Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GstReport;
