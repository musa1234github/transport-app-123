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

const FACTORIES = ["MANIGARH", "ULTRATECH", "JSW", "MP BIRLA"];

/* ===== SAFE NUMBER ===== */
const safeNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") v = v.replace(/,/g, "");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

/* ===== ENHANCED DATE PARSER ===== */
const parseExcelDate = (v, factory) => {
  if (!v) return null;

  // If it's already a Date object
  if (v instanceof Date) return v;
  
  // Excel serial number (for dates stored as numbers)
  if (typeof v === "number") {
    return new Date(Math.round((v - 25569) * 86400 * 1000));
  }

  const str = String(v).trim();
  
  // Try multiple date formats
  // Format 1: dd-mm-yy or dd/mm/yy
  const match1 = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (match1) {
    const d = parseInt(match1[1], 10);
    const m = parseInt(match1[2], 10) - 1;
    let y = parseInt(match1[3], 10);
    if (y < 100) y = y <= 50 ? y + 2000 : y + 1900;
    const dt = new Date(y, m, d);
    if (!isNaN(dt.getTime())) return dt;
  }
  
  // Format 2: dd-mmm-yy (e.g., "17-Jul-25" for MP BIRLA)
  const match2 = str.match(/^(\d{1,2})[-/](\w{3})[-/](\d{2,4})$/i);
  if (match2) {
    const d = parseInt(match2[1], 10);
    const monthStr = match2[2].toLowerCase();
    let y = parseInt(match2[3], 10);
    if (y < 100) y = y <= 50 ? y + 2000 : y + 1900;
    
    const months = {
      'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
      'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };
    
    const m = months[monthStr];
    if (m !== undefined) {
      const dt = new Date(y, m, d);
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  return null;
};

/* ===== GET BILL TYPE ===== */
const getBillType = (billTypeOrLR, factory) => {
  if (factory === "JSW") {
    return "Regular";
  }
  // For MP BIRLA, column K contains bill type (like 5524.0, 5544.0)
  if (factory === "MP BIRLA") {
    const value = String(billTypeOrLR || "").trim();
    return value.replace(/\.0$/, "");
  }
  return String(billTypeOrLR || "").trim();
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
  const [failedChallans, setFailedChallans] = useState([]);
  const [progress, setProgress] = useState(0);
  const [currentRow, setCurrentRow] = useState(0);
  const [totalRows, setTotalRows] = useState(0);

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

  /* ===== DOWNLOAD FAILED CHALLANS AS CSV ===== */
  const downloadFailedChallans = () => {
    if (failedChallans.length === 0) {
      alert("No failed challans to download");
      return;
    }

    const headers = ["Row", "ChallanNo", "BillNum", "Error", "Reason"];
    const csvContent = [
      headers.join(","),
      ...failedChallans.map(challan => 
        [
          challan.row,
          `"${challan.challanNo}"`,
          `"${challan.billNum}"`,
          `"${challan.error}"`,
          `"${challan.reason || ''}"`
        ].join(",")
      )
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", `failed_challans_${factory}_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    addLog(`Downloaded ${failedChallans.length} failed challans as CSV`, "info");
  };

  /* ===== UPLOAD HANDLER ===== */
  const handleUpload = async () => {
    if (!file || !factory) {
      alert("Select Factory and Excel file");
      return;
    }

    setLoading(true);
    setProgress(0);
    setCurrentRow(0);
    setTotalRows(0);
    setUploadLog([]);
    setFailedChallans([]);
    addLog(`Starting upload for ${factory} factory...`, "info");

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

        let success = 0, skipped = 0, failed = 0;
        const totalRowsCount = rows.length - 1;
        setTotalRows(totalRowsCount);
        const failedList = [];

        // Update progress: parsing complete
        setProgress(5);
        addLog(`Parsed ${totalRowsCount} rows from Excel file`, "info");

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          setCurrentRow(i);
          
          // Calculate current progress percentage
          const currentProgress = 5 + Math.floor((i / rows.length) * 90);
          setProgress(currentProgress);
          
          if (!row || row.every(v => v === null || v === "")) {
            skipped++;
            continue;
          }

          // Map columns based on factory
          let challanNo, quantity, unitPrice, finalPrice, billNum, billDate, billTypeOrLR, deliveryNum;

          if (factory === "MP BIRLA") {
            challanNo = String(row[0] || "").trim();
            quantity = safeNum(row[4]);
            unitPrice = safeNum(row[6]);
            finalPrice = safeNum(row[7]);
            billNum = String(row[8] || "").trim();
            billDate = parseExcelDate(row[9], factory);
            billTypeOrLR = String(row[10] || "").trim();
            deliveryNum = String(row[11] || "").trim();
          } else {
            challanNo = String(row[0] || "").trim();
            quantity = safeNum(row[4]);
            unitPrice = safeNum(row[6]);
            finalPrice = safeNum(row[7]);
            billNum = String(row[8] || "").trim();
            billDate = parseExcelDate(row[9], factory);
            billTypeOrLR = String(row[10] || "").trim();
            deliveryNum = String(row[11] || "").trim();
          }

          // For MP BIRLA, clean up challan number (remove .0 if present)
          if (factory === "MP BIRLA" && challanNo.endsWith('.0')) {
            challanNo = challanNo.replace(/\.0$/, '');
          }

          const billType = getBillType(billTypeOrLR, factory);

          // VALIDATION
          if (!challanNo || !billNum || !billDate) {
            const reason = !challanNo ? "Missing ChallanNo" : 
                          !billNum ? "Missing BillNum" : "Invalid BillDate";
            
            failedList.push({
              row: i + 1,
              challanNo: challanNo || "Empty",
              billNum: billNum || "Empty",
              error: "Missing required fields",
              reason: reason
            });
            
            addLog(`Row ${i+1}: ${reason} (ChallanNo: ${challanNo || 'empty'}, BillNum: ${billNum || 'empty'})`, "warning");
            failed++;
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
              failedList.push({
                row: i + 1,
                challanNo,
                billNum,
                error: "Dispatch not found",
                reason: `Challan ${challanNo} not found in ${factory} factory`
              });
              addLog(`Row ${i+1}: Dispatch not found for challan ${challanNo} in ${factory}`, "warning");
              failed++;
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
              addLog(`Row ${i+1}: Using existing bill ${billNum}`, "info");
            } else {
              const billData = {
                BillNum: billNum,
                BillDate: billDate,
                BillType: billType,
                FactoryName: factory,
                CreatedOn: serverTimestamp()
              };
              
              if (factory === "JSW" && billTypeOrLR) {
                billData.LRNumber = billTypeOrLR;
              }
              
              if (factory === "MP BIRLA" && billTypeOrLR) {
                billData.OriginalBillType = billTypeOrLR;
              }
              
              const billRef = await addDoc(collection(db, "BillTable"), billData);
              billId = billRef.id;
              addLog(`Row ${i+1}: Created new bill ${billNum}`, "success");
            }

            const updateData = {
              DispatchQuantity: quantity,
              UnitPrice: unitPrice,
              FinalPrice: finalPrice,
              DeliveryNum: deliveryNum,
              BillID: billId,
              BillNum: billNum,
              UpdatedAt: serverTimestamp()
            };
            
            if (factory === "JSW" && billTypeOrLR) {
              updateData.LRNumber = billTypeOrLR;
            }
            
            await updateDoc(doc(db, "TblDispatch", dispatchDoc.id), updateData);

            success++;
            addLog(`Row ${i+1}: Successfully updated challan ${challanNo}`, "success");

          } catch (err) {
            failedList.push({
              row: i + 1,
              challanNo: challanNo || "Unknown",
              billNum: billNum || "Unknown",
              error: err.message,
              reason: "Processing error"
            });
            failed++;
            addLog(`Row ${i+1}: Failed challan ${challanNo || 'Unknown'} - ${err.message}`, "error");
            console.error(`Error processing row ${i+1}:`, err);
          }
        }

        // Update progress: processing complete
        setProgress(100);

        // Set failed challans after processing
        setFailedChallans(failedList);

        // Show summary
        const summaryMessage = `Upload completed\n✅ Success: ${success}\n⚠️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
        addLog(`Upload completed - Success: ${success}, Skipped: ${skipped}, Failed: ${failed}`, "info");
        
        if (failed > 0) {
          addLog(`${failed} challans failed to upload. Check "Failed Challans" section below.`, "error");
        }
        
        setTimeout(() => {
          if (failed > 0) {
            alert(`${summaryMessage}\n\n${failed} challan(s) failed. Check the "Failed Challans" section below for details.`);
          } else {
            alert(summaryMessage);
          }
        }, 500);

      } catch (err) {
        setProgress(0);
        addLog(`Upload failed: ${err.message}`, "error");
        alert(err.message);
      } finally {
        setLoading(false);
        // Reset progress after a delay
        setTimeout(() => {
          setProgress(0);
          setCurrentRow(0);
          setTotalRows(0);
        }, 2000);
      }
    };

    reader.readAsBinaryString(file);
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

          {/* Simple Progress Bar */}
          {loading && (
            <div className="progress-container">
              <div className="progress-info">
                <span className="progress-label">Processing: {currentRow} of {totalRows} rows</span>
                <span className="progress-percent">{progress}%</span>
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          )}

          <div className="factory-specific-note">
            {factory === "JSW" && (
              <div className="note-jsw">
                <strong>⚠️ JSW Format Note:</strong>
                <p>Column K should contain LR numbers. BillType will be set to "Regular" by default.</p>
              </div>
            )}
            {factory === "MP BIRLA" && (
              <div className="note-mp-birla">
                <strong>⚠️ MP BIRLA Format Note:</strong>
                <p>Column K contains BillType values (like 5524.0, 5544.0). ChallanNo may end with .0 which will be automatically cleaned.</p>
              </div>
            )}
          </div>

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
          </div>
        </div>

        {/* FAILED CHALLANS SECTION */}
        {failedChallans.length > 0 && (
          <div className="failed-container">
            <div className="failed-header">
              <h4>
                <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Failed Challans ({failedChallans.length})
              </h4>
              <button 
                className="btn btn-danger"
                onClick={downloadFailedChallans}
              >
                <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download as CSV
              </button>
            </div>
            <div className="failed-content">
              <table className="failed-table">
                <thead>
                  <tr>
                    <th>Row #</th>
                    <th>Challan No</th>
                    <th>Bill Number</th>
                    <th>Error</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {failedChallans.map((challan, index) => (
                    <tr key={index} className="failed-row">
                      <td>{challan.row}</td>
                      <td className="challan-cell">{challan.challanNo}</td>
                      <td className="bill-cell">{challan.billNum}</td>
                      <td className="error-cell">{challan.error}</td>
                      <td className="reason-cell">{challan.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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