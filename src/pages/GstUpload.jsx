import React, { useState, useEffect } from 'react';
import { db } from "../firebaseConfig";
import { collection, getDocs, query, orderBy, where, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import * as XLSX from 'xlsx';
import './GstUpload.css';

const GstUpload = () => {
    const [factories, setFactories] = useState([]);
    const [selectedFactoryId, setSelectedFactoryId] = useState(''); // This will store the Factory Name
    const [selectedFile, setSelectedFile] = useState(null);
    const [uploadSummary, setUploadSummary] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [previewData, setPreviewData] = useState([]);

    // Fetch factories on component mount
    useEffect(() => {
        fetchFactories();
    }, []);

    const fetchFactories = async () => {
        setIsLoading(true);
        try {
            // Using the same logic as FactoryList/DispatchUpload
            const q = query(collection(db, "factories"), orderBy("factoryName"));
            const snap = await getDocs(q);
            // We map to { value: factoryName, text: factoryName } to match the select options
            const data = snap.docs.map(d => ({
                value: d.data().factoryName,
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

        // Preview the file
        try {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            // Show first 5 rows as preview
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
        if (value instanceof Date) return value;

        // Handle Excel serial date
        if (typeof value === 'number') {
            return new Date(Math.round((value - 25569) * 86400 * 1000));
        }

        // Handle various string formats
        const str = String(value).trim();
        // Try YYYY-MM-DD
        if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return new Date(str);
        }
        // Try DD-MM-YYYY
        if (str.match(/^\d{2}-\d{2}-\d{4}$/)) {
            const [d, m, y] = str.split('-').map(Number);
            return new Date(y, m - 1, d);
        }

        return null;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        // Validation
        if (!selectedFactoryId) {
            setErrorMessage('Please select a factory');
            return;
        }

        if (!selectedFile) {
            setErrorMessage('Please select an Excel file to upload');
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
            const buffer = await selectedFile.arrayBuffer();
            const wb = XLSX.read(buffer);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            // Assume header is row 0
            // Columns expected: Bill Number, GST Amount, Bill Date, GST Update Date
            // We need to find the definition. 
            // Based on previous code: 1) GST Amount, 2) Bill Date, 3) GST Update Date. 
            // BUT WE NEED A KEY. I will assume Column 0 is Bill Number or Challan Number.
            // Let's assume Column 0 = Bill Number, 1 = GST Amount, 2 = Bill Date, 3 = GST Update Date
            // Skipping header row
            const dataRows = rows.slice(1);

            for (let i = 0; i < dataRows.length; i++) {
                const row = dataRows[i];
                if (!row || row.length === 0) continue;

                // Adjust these indices based on actual file format
                // For now, I'll try to match by Bill Number (Col 0)
                const billNum = row[0] ? String(row[0]).trim() : null;
                const gstAmount = row[1]; // Col 1
                const billDateRaw = row[2]; // Col 2
                const gstUpdateDateRaw = row[3]; // Col 3

                if (!billNum) {
                    failedRecords.push(`Row ${i + 2}: Missing Bill Number`);
                    failureCount++;
                    continue;
                }

                // Find the Bill in Firestore
                const q = query(
                    collection(db, "BillTable"),
                    where("BillNum", "==", billNum),
                    where("FactoryName", "==", selectedFactoryId)
                );
                const snap = await getDocs(q);

                if (snap.empty) {
                    failedRecords.push(`Row ${i + 2}: Bill "${billNum}" not found for factory ${selectedFactoryId}`);
                    failureCount++;
                    continue;
                }

                const docId = snap.docs[0].id;

                // Update the document
                try {
                    const updateData = {};
                    if (gstAmount !== undefined && gstAmount !== null && gstAmount !== '') {
                        updateData.GSTAmount = parseFloat(gstAmount);
                    }

                    const gstDate = parseDate(gstUpdateDateRaw);
                    if (gstDate) {
                        updateData.GSTUpdateDate = gstDate;
                    }

                    if (Object.keys(updateData).length > 0) {
                        updateData.UpdatedAt = serverTimestamp();
                        await updateDoc(doc(db, "BillTable", docId), updateData);
                        successCount++;
                        successfulRecords.push(`Bill ${billNum} updated`);
                    } else {
                        failedRecords.push(`Row ${i + 2}: No valid data to update for Bill ${billNum}`);
                        failureCount++;
                    }
                } catch (err) {
                    failedRecords.push(`Row ${i + 2}: Error updating bill ${billNum}: ${err.message}`);
                    failureCount++;
                }
            }

            setUploadSummary({
                successCount,
                failureCount,
                successfulRecords,
                failedRecords
            });

        } catch (error) {
            setErrorMessage('An error occurred while processing the file: ' + error.message);
            console.error('Upload error:', error);
        } finally {
            setIsUploading(false);
            // Reset file input
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
                    <strong>1) Bill Number</strong> (Required to match record)
                    <br />
                    <strong>2) GST Amount</strong>
                    <br />
                    <strong>3) Bill Date</strong> (yyyy-MM-dd)
                    <br />
                    <strong>4) GST Update Date</strong> (yyyy-MM-dd)
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