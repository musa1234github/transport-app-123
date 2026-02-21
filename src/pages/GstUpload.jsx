import React, { useState, useEffect } from 'react';
import { db } from "../firebaseConfig";
import { collection, getDocs, query, orderBy, where, updateDoc, doc, serverTimestamp, limit } from "firebase/firestore";
import * as XLSX from 'xlsx';
import './GstUpload.css';

const GstUpload = () => {
    const [factories, setFactories] = useState([]);
    const [selectedFactoryId, setSelectedFactoryId] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [uploadSummary, setUploadSummary] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [previewData, setPreviewData] = useState([]);

    useEffect(() => {
        fetchFactories();
    }, []);

    const fetchFactories = async () => {
        setIsLoading(true);
        try {
            const q = query(collection(db, "factories"), orderBy("factoryName"));
            const snap = await getDocs(q);
            const data = snap.docs.map(d => ({
                value: d.data().factoryName,  // ← exact text used for BillTable query
                text: d.data().factoryName
            }));
            setFactories(data);
            setErrorMessage('');
        } catch (error) {
            setErrorMessage('Failed to load factories. Please try again.');
            console.error('Error fetching factories:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setSelectedFile(file);
        setErrorMessage('');
        setUploadSummary(null);
        setPreviewData([]);

        try {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (rows.length > 0) {
                setPreviewData(rows.slice(0, 6));
            }
        } catch (err) {
            setErrorMessage("Failed to read file preview.");
        }
    };

    const handleFactoryChange = (event) => {
        setSelectedFactoryId(event.target.value);
        setErrorMessage('');
    };

    const parseDate = (value) => {
        if (!value) return null;

        // Already a Date object
        if (value instanceof Date) return value;

        // Excel serial number
        if (typeof value === "number") {
            const date = new Date((value - 25569) * 86400 * 1000);
            return isNaN(date) ? null : date;
        }

        const str = String(value).trim();

        // Normalize separators: / and . → -
        const normalized = str.replace(/[./]/g, "-");

        // YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
            const d = new Date(normalized);
            return isNaN(d) ? null : d;
        }

        // DD-MM-YYYY  (also covers DD/MM/YYYY and DD.MM.YYYY after normalize)
        if (/^\d{2}-\d{2}-\d{4}$/.test(normalized)) {
            const [day, month, year] = normalized.split("-").map(Number);
            const d = new Date(year, month - 1, day);
            return isNaN(d) ? null : d;
        }

        // Fallback — like .NET TryParse
        const d = new Date(str);
        return isNaN(d) ? null : d;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!selectedFactoryId) {
            setErrorMessage('Please select a factory');
            return;
        }

        if (!selectedFile) {
            setErrorMessage('Please select an Excel file');
            return;
        }

        setIsUploading(true);
        setErrorMessage('');
        setUploadSummary(null);

        let successCount = 0;
        let failureCount = 0;
        let successfulRecords = [];
        let failedRecords = [];

        try {
            // ── 1. LOAD ALL FACTORY BILLS ONCE ──────────────────────────────
            // BillTable is the correct source — it has BillDate, Gst and FactoryName.
            console.log(`[GstUpload] Querying BillTable where FactoryName == "${selectedFactoryId}"`);

            const billQuery = query(
                collection(db, "BillTable"),
                where("FactoryName", "==", selectedFactoryId)
            );
            const billSnap = await getDocs(billQuery);

            // Debug: show a sample doc so you can see the EXACT FactoryName stored
            if (billSnap.docs.length > 0) {
                const sample = billSnap.docs[0].data();
                console.log("[GstUpload] ✅ Records found! Sample doc:", sample);
                console.log("[GstUpload] FactoryName in Firestore:", JSON.stringify(sample.FactoryName));
            } else {
                // Load one random doc so you can see the actual FactoryName value stored
                const sampleSnap = await getDocs(query(collection(db, "BillTable"), limit(1)));
                if (sampleSnap.docs.length > 0) {
                    const sampleData = sampleSnap.docs[0].data();
                    console.warn("[GstUpload] ⚠️ 0 bills matched. You selected:", JSON.stringify(selectedFactoryId));
                    console.warn("[GstUpload] ⚠️ BillTable actual FactoryName value:", JSON.stringify(sampleData.FactoryName));
                    console.warn("[GstUpload] ⚠️ Full sample doc:", sampleData);
                } else {
                    console.warn("[GstUpload] ⚠️ BillTable collection appears to be empty!");
                }
            }

            // Build O(1) lookup map  key = "YYYY-M-D_gstInt"
            const billMap = new Map();
            billSnap.docs.forEach(d => {
                const data = d.data();

                // DEBUG: show raw Firestore doc so we can see exact field names
                console.log("[GstUpload] PaymentTable doc fields:", JSON.stringify(Object.keys(data)), "| BillDate:", data.BillDate, "| Gst:", data.Gst, "| GSTAmount:", data.GSTAmount);

                // Firestore Timestamp → JS Date
                const billDateRaw = data.BillDate?.toDate
                    ? data.BillDate.toDate()
                    : data.BillDate ? new Date(data.BillDate) : null;
                if (!billDateRaw || isNaN(billDateRaw)) {
                    console.warn("[GstUpload] Skipped doc (bad BillDate):", d.id, data.BillDate);
                    return;
                }

                const dateKey =
                    billDateRaw.getFullYear() + "-" +
                    (billDateRaw.getMonth() + 1) + "-" +
                    billDateRaw.getDate();

                // Support: Gst (ASP.NET) + common React casings
                const rawGst =
                    data.Gst ?? data.GSTAmount ?? data.GstAmount ?? data.gstAmount ?? null;
                if (rawGst == null) {
                    console.warn("[GstUpload] Skipped doc (no GST field):", d.id, "fields:", Object.keys(data));
                    return;
                }

                // Math.trunc strips decimals on BOTH sides so e.g. 2430.2 (Excel)
                // and 2430.20 (Firestore) both become 2430 and always match.
                const gstInt = Math.trunc(Number(rawGst));
                const key = `${dateKey}_${gstInt}`;
                console.log("[GstUpload] Map key added:", key);
                billMap.set(key, d);
            });

            console.log(`[GstUpload] Loaded ${billMap.size} BillTable records for factory "${selectedFactoryId}"`);

            // ── 2. READ EXCEL ────────────────────────────────────────────────
            const buffer = await selectedFile.arrayBuffer();
            const wb = XLSX.read(buffer);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            const dataRows = rows.slice(1); // skip header

            // ── 3. MATCH EACH ROW AGAINST IN-MEMORY MAP ──────────────────────
            for (let i = 0; i < dataRows.length; i++) {
                const row = dataRows[i];
                if (!row || row.length === 0) continue;

                // Column 0 → GST Amount | Column 1 → Bill Date | Column 2 → GST Update Date
                const gstAmount = parseFloat(row[0]);
                const billDate = parseDate(row[1]);
                const gstUpdateDate = parseDate(row[2]);

                if (isNaN(gstAmount)) {
                    failedRecords.push(`Row ${i + 2}: Invalid GST Amount`);
                    failureCount++;
                    continue;
                }
                if (!billDate) {
                    failedRecords.push(`Row ${i + 2}: Invalid Bill Date`);
                    failureCount++;
                    continue;
                }
                if (!gstUpdateDate) {
                    failedRecords.push(`Row ${i + 2}: Invalid GST Update Date`);
                    failureCount++;
                    continue;
                }

                const dateKey =
                    billDate.getFullYear() + "-" +
                    (billDate.getMonth() + 1) + "-" +
                    billDate.getDate();

                // Math.trunc on Excel value matches the same trunc applied to Firestore data above,
                // so any decimal difference (e.g. 2430.2 vs 2430.20) is safely ignored.
                const key = `${dateKey}_${Math.trunc(gstAmount)}`;

                // DEBUG: log first 3 Excel keys so you can compare with map keys above
                if (i < 3) console.log(`[GstUpload] Excel key (row ${i + 2}):`, key);

                const matchedDoc = billMap.get(key);

                if (!matchedDoc) {
                    failedRecords.push(
                        `Row ${i + 2}: No match found (GST ${Math.trunc(gstAmount)}, Date ${billDate.toLocaleDateString()})`
                    );
                    failureCount++;
                    continue;
                }

                // ── 4. UPDATE GstReceivedDate in BillTable ─────────────────
                try {
                    await updateDoc(doc(db, "BillTable", matchedDoc.id), {
                        GstReceivedDate: gstUpdateDate,
                        UpdatedAt: serverTimestamp()
                    });
                    successCount++;
                    successfulRecords.push(`Updated Bill ID: ${matchedDoc.id}`);
                } catch (err) {
                    failedRecords.push(`Row ${i + 2}: Update error - ${err.message}`);
                    failureCount++;
                }
            }

            setUploadSummary({ successCount, failureCount, successfulRecords, failedRecords });

        } catch (error) {
            setErrorMessage("Upload error: " + error.message);
            console.error(error);
        } finally {
            setIsUploading(false);
            const fileInput = document.getElementById('file-input');
            if (fileInput) fileInput.value = '';
            setSelectedFile(null);
        }
    };

    const renderSummary = () => {
        if (!uploadSummary) return null;

        const { successCount, failureCount, successfulRecords, failedRecords } = uploadSummary;

        return (
            <div className={`summary-alert ${failureCount > 0 ? 'alert-warning' : 'alert-success'}`}>
                <strong>Upload Summary:</strong>
                <br />
                Records Uploaded Successfully: {successCount}
                <br />
                Records Failed to Upload: {failureCount}

                {failedRecords && failedRecords.length > 0 && (
                    <>
                        <br />
                        <strong>Failed Record Info:</strong>
                        <div className="failed-records-list">
                            {failedRecords.map((record, index) => (
                                <div key={index} className="failed-record-item">
                                    {record}
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {successfulRecords && successfulRecords.length > 0 && (
                    <>
                        <br />
                        <strong>Successful Record Info (First 10):</strong>
                        <div className="successful-records-list">
                            {successfulRecords.slice(0, 10).map((record, index) => (
                                <div key={index} className="successful-record-item">
                                    {record}
                                </div>
                            ))}
                            {successfulRecords.length > 10 && <div>...and {successfulRecords.length - 10} more</div>}
                        </div>
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="gst-upload-container">
            <h1 className="page-title">Upload GST Update Data</h1>

            <div className="instructions-panel">
                <p>
                    Please ensure your Excel file has headers in the first row and columns in the following order:
                    <br />
                    <strong>1) GST Amount</strong>
                    <br />
                    <strong>2) Bill Date</strong>
                    <br />
                    <strong>3) GST Update Date</strong>
                </p>
            </div>

            {renderSummary()}

            {errorMessage && (
                <div className="alert alert-danger">
                    <strong>Error:</strong> {errorMessage}
                </div>
            )}

            <form onSubmit={handleSubmit} className="upload-form">
                <div className="form-group">
                    <label htmlFor="factory-select">Select Factory:</label>
                    <select
                        id="factory-select"
                        value={selectedFactoryId}
                        onChange={handleFactoryChange}
                        className="form-control"
                        required
                        disabled={isLoading || isUploading}
                    >
                        <option value="">-- Select Factory --</option>
                        {factories.map((factory, idx) => (
                            <option key={idx} value={factory.value}>
                                {factory.text}
                            </option>
                        ))}
                    </select>
                    {isLoading && <span className="loading-indicator">Loading factories...</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="file-input">Select Excel File to Upload:</label>
                    <input
                        type="file"
                        id="file-input"
                        accept=".xlsx,.xls,.xlsm,.xlsb"
                        onChange={handleFileChange}
                        className="form-control"
                        required
                        disabled={isUploading}
                    />
                    {selectedFile && (
                        <span className="file-info">Selected: {selectedFile.name}</span>
                    )}
                </div>

                {/* Data Preview */}
                {previewData.length > 0 && (
                    <div className="form-group">
                        <label>File Preview (First 5 Rows):</label>
                        <div style={{ overflowX: 'auto', background: '#f8f9fa', padding: '10px', fontSize: '0.8rem' }}>
                            <table border="1" style={{ borderCollapse: 'collapse', width: '100%' }}>
                                <thead>
                                    <tr>
                                        {previewData[0].map((head, i) => <th key={i} style={{ padding: '4px' }}>{head}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewData.slice(1).map((row, i) => (
                                        <tr key={i}>
                                            {row.map((cell, j) => <td key={j} style={{ padding: '4px' }}>{cell}</td>)}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isLoading || isUploading || !selectedFactoryId || !selectedFile}
                >
                    {isUploading ? 'Uploading...' : 'Upload & Update'}
                </button>
            </form>
        </div>
    );
};

export default GstUpload;