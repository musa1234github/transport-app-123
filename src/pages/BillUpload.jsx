import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./BillUpload.css";

const FACTORIES = ["MANIGARH", "ULTRATECH", "JSW"];

/* ===== SAFE NUMBER ===== */
const safeNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") v = v.replace(/,/g, "");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

/* ===== PARSE dd-mm-yy FORMAT ===== */
const parseDDMMYY = (v) => {
  if (!v) return null;

  if (v instanceof Date) return v;
  if (typeof v === "number") {
    return new Date(Math.round((v - 25569) * 86400 * 1000));
  }

  const str = String(v).trim();
  const match = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);

  if (match) {
    const d = parseInt(match[1], 10);
    const m = parseInt(match[2], 10) - 1;
    let y = parseInt(match[3], 10);
    if (y < 100) y = y <= 50 ? y + 2000 : y + 1900;
    const dt = new Date(y, m, d);
    if (!isNaN(dt.getTime())) return dt;
  }

  return null;
};

/* =====================================================
   ✅ BILL UPLOAD COMPONENT (ADMIN ONLY)
   ===================================================== */
const BillUpload = () => {
  const { userRole } = useOutletContext();

  const [file, setFile] = useState(null);
  const [factory, setFactory] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadLog, setUploadLog] = useState([]);
  const [progress, setProgress] = useState(0);

  const canUpload = userRole === "admin";

  if (!canUpload) {
    return (
      <div className="access-denied">
        <div className="denied-card">
          <svg className="denied-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H8m8-7V6a4 4 0 00-8 0v3m8 0h2a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2v-7a2 2 0 012-2h2" />
          </svg>
          <h3>Access Denied</h3>
          <p>This feature is only available for administrators.</p>
        </div>
      </div>
    );
  }

  /* ===== LOG HELPER ===== */
  const addLog = (message, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setUploadLog(prev =>
      [...prev, { timestamp, message, type }].slice(-20)
    );
  };

  /* ===== UPLOAD HANDLER ===== */
  const handleUpload = async () => {
    if (!file || !factory) {
      alert("Select Factory and Excel file");
      return;
    }

    setLoading(true);
    setUploadLog([]);
    setProgress(0);
    addLog(`Starting upload for ${factory} factory...`, "info");

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

        let success = 0, skipped = 0, failed = 0;
        const totalRows = rows.length - 1;

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every(v => v === null || v === "")) {
            skipped++;
            continue;
          }

          // Update progress
          setProgress(Math.round((i / totalRows) * 100));

          const challanNo = String(row[0] || "").trim();
          const quantity = safeNum(row[4]);
          const unitPrice = safeNum(row[6]);
          const finalPrice = safeNum(row[7]);
          const billNum = String(row[8] || "").trim();
          const billDate = parseDDMMYY(row[9]);
          const billType = String(row[10] || "").trim();
          const deliveryNum = String(row[11] || "").trim();

          if (!challanNo || !billNum || !billDate) {
            addLog(`Row ${i}: Missing required fields`, "warning");
            skipped++;
            continue;
          }

          try {
            const dq = query(
              collection(db, "TblDispatch"),
              where("ChallanNo", "==", challanNo),
              where("FactoryName", "==", factory)
            );

            const ds = await getDocs(dq);
            if (ds.empty) {
              addLog(`Row ${i}: Dispatch not found for challan ${challanNo}`, "warning");
              skipped++;
              continue;
            }

            const dispatchDoc = ds.docs[0];

            const bq = query(
              collection(db, "BillTable"),
              where("BillNum", "==", billNum),
              where("FactoryName", "==", factory)
            );

            const bs = await getDocs(bq);
            let billId;

            if (!bs.empty) {
              billId = bs.docs[0].id;
              addLog(`Row ${i}: Using existing bill ${billNum}`, "info");
            } else {
              const billRef = await addDoc(collection(db, "BillTable"), {
                BillNum: billNum,
                BillDate: billDate,
                BillType: billType,
                FactoryName: factory,
                CreatedOn: serverTimestamp()
              });
              billId = billRef.id;
              addLog(`Row ${i}: Created new bill ${billNum}`, "success");
            }

            await updateDoc(doc(db, "TblDispatch", dispatchDoc.id), {
              DispatchQuantity: quantity,
              UnitPrice: unitPrice,
              FinalPrice: finalPrice,
              DeliveryNum: deliveryNum,
              BillID: billId,
              BillNum: billNum,
              UpdatedAt: serverTimestamp()
            });

            success++;
            addLog(`Row ${i}: Successfully updated challan ${challanNo}`, "success");

          } catch (err) {
            failed++;
            addLog(`Row ${i}: Error - ${err.message}`, "error");
            console.error(`Error processing row ${i}:`, err);
          }
        }

        // Final progress update
        setProgress(100);
        
        // Show summary
        addLog(`Upload completed - Success: ${success}, Skipped: ${skipped}, Failed: ${failed}`, "info");
        
        setTimeout(() => {
          alert(`Upload completed\n✅ Success: ${success}\n⚠️ Skipped: ${skipped}\n❌ Failed: ${failed}`);
          setProgress(0);
        }, 500);

      } catch (err) {
        addLog(`Upload failed: ${err.message}`, "error");
        alert(err.message);
      } finally {
        setLoading(false);
      }
    };

    reader.readAsBinaryString(file);
  };

  /* ===== TEMPLATE ===== */
  const downloadTemplate = () => {
    const data = [
      ["ChallanNo", "col2", "col3", "col4", "Quantity", "col6", "UnitPrice", "FinalPrice", "BillNum", "BillDate", "BillType", "DeliveryNum"],
      ["CH-001", "", "", "", 100, "", 50, 4800, "BILL-001", "09-01-26", "Regular", "DEL-001"]
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Bill_Upload_Template.xlsx");
    
    addLog("Template downloaded successfully", "info");
  };

  /* ===== UI ===== */
  return (
    <div className="bill-upload-container">
      <div className="upload-card">
        <div className="upload-header">
          <h2 className="upload-title">
            <svg className="title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Upload Bill Data
          </h2>
          <p className="upload-subtitle">Upload Excel files to update bill information (Admin Only)</p>
        </div>

        <div className="upload-form">
          <div className="form-group">
            <label className="form-label">
              <svg className="label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Select Factory
            </label>
            <select 
              className="factory-select"
              value={factory} 
              onChange={e => setFactory(e.target.value)}
              disabled={loading}
            >
              <option value="">-- Select Factory --</option>
              {FACTORIES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">
              <svg className="label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Select Excel File
            </label>
            <div className="file-input-wrapper">
              <input 
                type="file" 
                className="file-input"
                accept=".xls,.xlsx,.csv" 
                onChange={e => {
                  setFile(e.target.files[0]);
                  addLog(`File selected: ${e.target.files[0]?.name}`, "info");
                }}
                disabled={loading}
              />
              {file && (
                <div className="file-info">
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">({(file.size / 1024).toFixed(1)} KB)</span>
                </div>
              )}
            </div>
          </div>

          {loading && (
            <div className="progress-container">
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <span className="progress-text">{progress}%</span>
            </div>
          )}

          <div className="button-group">
            <button 
              className="btn btn-primary"
              onClick={handleUpload} 
              disabled={loading || !file || !factory}
            >
              {loading ? (
                <>
                  <svg className="spinner" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  </svg>
                  Uploading...
                </>
              ) : (
                <>
                  <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                  </svg>
                  Upload Bill Data
                </>
              )}
            </button>

            <button 
              className="btn btn-secondary"
              onClick={downloadTemplate}
              disabled={loading}
            >
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Template
            </button>
          </div>

          <div className="template-note">
            <h4>Excel File Format:</h4>
            <p>Make sure your Excel file follows this structure:</p>
            <table className="format-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Field</th>
                  <th>Required</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>A</td><td>ChallanNo</td><td>✅</td></tr>
                <tr><td>E</td><td>Quantity</td><td>✅</td></tr>
                <tr><td>G</td><td>UnitPrice</td><td>✅</td></tr>
                <tr><td>H</td><td>FinalPrice</td><td>✅</td></tr>
                <tr><td>I</td><td>BillNum</td><td>✅</td></tr>
                <tr><td>J</td><td>BillDate (dd-mm-yy)</td><td>✅</td></tr>
                <tr><td>K</td><td>BillType</td><td>✅</td></tr>
                <tr><td>L</td><td>DeliveryNum</td><td>✅</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {uploadLog.length > 0 && (
          <div className="log-container">
            <div className="log-header">
              <h4>Upload Log</h4>
              <button 
                className="clear-log" 
                onClick={() => setUploadLog([])}
              >
                Clear Log
              </button>
            </div>
            <div className="log-content">
              {uploadLog.map((log, index) => (
                <div 
                  key={index} 
                  className={`log-entry log-${log.type}`}
                >
                  <span className="log-time">[{log.timestamp}]</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BillUpload;