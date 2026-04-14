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
  serverTimestamp,
  writeBatch
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
        addLog(`Parsed ${totalRowsCount} rows from Excel file. Preparing data...`, "info");

        const parsedRows = [];
        const uniqueChallans = new Set();
        const uniqueBills = new Set();

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every(v => v === null || v === "")) {
            skipped++;
            continue;
          }

          let challanNo = String(row[0] || "").trim();
          const quantity = safeNum(row[4]);
          const unitPrice = safeNum(row[6]);
          const finalPrice = safeNum(row[7]);
          const billNum = String(row[8] || "").trim();
          const billDate = parseExcelDate(row[9], factory);
          const billTypeOrLR = String(row[10] || "").trim();
          const deliveryNum = String(row[11] || "").trim();

          // For MP BIRLA, clean up challan number (remove .0 if present)
          if (factory === "MP BIRLA" && challanNo.endsWith('.0')) {
            challanNo = challanNo.replace(/\.0$/, '');
          }

          if (challanNo) uniqueChallans.add(challanNo);
          if (billNum) uniqueBills.add(billNum);

          parsedRows.push({
            originalRowIndex: i,
            challanNo, quantity, unitPrice, finalPrice, billNum, billDate, billTypeOrLR, deliveryNum
          });
        }

        setProgress(10);
        addLog(`Prefetching data from database (Bulk Read Optimization)...`, "info");

        // --- BATCH PREFETCH DISPATCHES ---
        const dispatchMap = {};
        const challansArray = Array.from(uniqueChallans);
        for (let i = 0; i < challansArray.length; i += 30) {
          const chunk = challansArray.slice(i, i + 30);
          const dq = query(
            collection(db, "TblDispatch"),
            where("FactoryName", "==", factory),
            where("ChallanNo", "in", chunk)
          );
          const ds = await getDocs(dq);
          ds.forEach(d => {
            dispatchMap[d.data().ChallanNo] = { id: d.id, ...d.data() };
          });
        }

        // --- BATCH PREFETCH BILLS ---
        const billDbCache = {};
        const billsArray = Array.from(uniqueBills);
        for (let i = 0; i < billsArray.length; i += 30) {
          const chunk = billsArray.slice(i, i + 30);
          const bq = query(
            collection(db, "BillTable"),
            where("FactoryName", "==", factory),
            where("BillNum", "in", chunk)
          );
          const bs = await getDocs(bq);
          bs.forEach(d => {
            billDbCache[d.data().BillNum] = d.id;
          });
        }

        // --- PRE-AGGREGATE BILL TOTALS ---
        const billTotalsCache = {};
        
        for (let rowData of parsedRows) {
          const { challanNo, quantity, unitPrice, finalPrice, billNum, billDate, billTypeOrLR } = rowData;
          if (!billNum || !challanNo) continue;

          if (!billTotalsCache[billNum]) {
             billTotalsCache[billNum] = {
               LRQuantity: 0,
               BillQuantity: 0,
               TaxableAmount: 0,
               _totalFinalPrice: 0,
               _dispatchCount: 0,
               _fpValidCount: 0
             };
          }

          const fp = safeNum(finalPrice);
          const taxable = safeNum(unitPrice) * safeNum(quantity);
          const fpValid = fp > 0 && (taxable === 0 || fp <= taxable);

          billTotalsCache[billNum].LRQuantity += 1;
          billTotalsCache[billNum].BillQuantity += safeNum(quantity);
          billTotalsCache[billNum].TaxableAmount += taxable;
          billTotalsCache[billNum]._totalFinalPrice += fp;
          billTotalsCache[billNum]._dispatchCount += 1;
          billTotalsCache[billNum]._fpValidCount += fpValid ? 1 : 0;
        }

        const GST_RATE = 0.18;
        const TDS_RATE = 0.00984;

        // Finalize Bill Totals
        for (const bNum in billTotalsCache) {
          const bt = billTotalsCache[bNum];
          const allHaveFP = bt._dispatchCount > 0 && bt._fpValidCount === bt._dispatchCount;
          
          const base = allHaveFP ? bt._totalFinalPrice : bt.TaxableAmount;
          if (bt.TaxableAmount === 0 && base > 0) {
            bt.TaxableAmount = base;
          }

          bt.FinalPrice = (bt._totalFinalPrice === bt.TaxableAmount) ? 0 : bt._totalFinalPrice;
          bt.GST = base * GST_RATE;
          bt.TDS = base * TDS_RATE;
          bt.ActualAmount = base + bt.GST;

          // cleanup
          delete bt._totalFinalPrice;
          delete bt._dispatchCount;
          delete bt._fpValidCount;
        }

        setProgress(15);
        addLog(`Prefetch complete. Preparing batches for ultra-fast upload...`, "info");

        const batchLogs = [];
        const CHUNK_SIZE = 400; // Ensure we stay under 500 limit for nested ops
        let batch = writeBatch(db);
        let currentBatchOps = 0;
        let batchCount = 0;
        const batchTotal = Math.ceil(parsedRows.length / (CHUNK_SIZE / 2));  // Roughly

        const processedChallans = new Set();

        for (let i = 0; i < parsedRows.length; i++) {
          const rowData = parsedRows[i];
          const rowIndex = rowData.originalRowIndex;
          
          const { challanNo, quantity, unitPrice, finalPrice, billNum, billDate, billTypeOrLR, deliveryNum } = rowData;
          const billType = getBillType(billTypeOrLR, factory);

          // ❌ Duplicate inside same upload file
          if (processedChallans.has(challanNo)) {
            failedList.push({
              row: rowIndex + 1,
              challanNo,
              billNum,
              error: "Duplicate in file",
              reason: "Same challan repeated in upload"
            });
            failed++;
            continue;
          }
          processedChallans.add(challanNo);

          // VALIDATION
          if (!challanNo || !billNum || !billDate) {
            const reason = !challanNo ? "Missing ChallanNo" : 
                          !billNum ? "Missing BillNum" : "Invalid BillDate";
            
            failedList.push({
              row: rowIndex + 1,
              challanNo: challanNo || "Empty",
              billNum: billNum || "Empty",
              error: "Missing required fields",
              reason: reason
            });
            batchLogs.push({ msg: `Row ${rowIndex+1}: ${reason}`, type: "warning" });
            failed++;
            continue;
          }

          try {
            const dispatchDoc = dispatchMap[challanNo];

            // ❌ Dispatch not found
            if (!dispatchDoc) {
              failedList.push({
                row: rowIndex + 1,
                challanNo,
                billNum,
                error: "Dispatch not found",
                reason: `Challan ${challanNo} not found in ${factory} factory`
              });
              batchLogs.push({
                msg: `Row ${rowIndex+1}: Dispatch not found for challan ${challanNo}`,
                type: "warning"
              });
              failed++;
              continue;
            }
            
            // ❌ BLOCK DUPLICATE CHALLAN (already assigned to another bill)
            if (dispatchDoc.BillID && dispatchDoc.BillNum !== billNum) {
              failedList.push({
                row: rowIndex + 1,
                challanNo,
                billNum,
                error: "Duplicate Challan",
                reason: `Already assigned to Bill ${dispatchDoc.BillNum}`
              });

              batchLogs.push({
                msg: `Row ${rowIndex+1}: Challan ${challanNo} already used in Bill ${dispatchDoc.BillNum}`,
                type: "warning"
              });

              failed++;
              continue;
            }

            let billId;
            if (billDbCache[billNum]) {
              billId = billDbCache[billNum]; // Use cached
              // Also update the bill table natively if it already exists, just so its values are perfectly synced
              const existingBillRef = doc(db, "BillTable", billId);
              batch.set(existingBillRef, {
                ...billTotalsCache[billNum],
                UpdatedOn: serverTimestamp()
              }, { merge: true });
            } else {
              // Create new bill via Batch reference
              const newBillRef = doc(collection(db, "BillTable"));
              billId = newBillRef.id;
              billDbCache[billNum] = billId; // Cache immediately
              
              const billData = {
                BillNum: billNum,
                BillDate: billDate,
                BillType: billType,
                FactoryName: factory,
                ...billTotalsCache[billNum],
                CreatedOn: serverTimestamp()
              };
              
              if (factory === "JSW" && billTypeOrLR) {
                billData.LRNumber = billTypeOrLR;
              }
              if (factory === "MP BIRLA" && billTypeOrLR) {
                billData.OriginalBillType = billTypeOrLR;
              }
              
              batch.set(newBillRef, billData);
              currentBatchOps++;
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
            
            batch.update(doc(db, "TblDispatch", dispatchDoc.id), updateData);
            currentBatchOps++;
            success++;

            // COMMIT BATCH IF FULL
            if (currentBatchOps >= CHUNK_SIZE) {
              try {
                await batch.commit();
              } catch (e) {
                console.warn("Batch failed, retrying...", e);
                await new Promise(r => setTimeout(r, 1000));
                await batch.commit(); // Simple retry mechanism
              }
              
              batchCount++;
              
              // Smooth UI Progress every batch
              const currentProgress = 15 + Math.floor((i / parsedRows.length) * 85);
              setProgress(currentProgress);
              setCurrentRow(rowIndex);
              
              addLog(`Committed batch ${batchCount} (${i + 1}/${parsedRows.length} rows processed)`, "success");

              // Reset batch
              batch = writeBatch(db);
              currentBatchOps = 0;
            }

          } catch (err) {
            failedList.push({
              row: rowIndex + 1,
              challanNo: challanNo || "Unknown",
              billNum: billNum || "Unknown",
              error: err.message,
              reason: "Processing error"
            });
            failed++;
          }
        }

        // COMMIT REMAINING OPS
        if (currentBatchOps > 0) {
          try {
            await batch.commit();
          } catch (e) {
            await new Promise(r => setTimeout(r, 1000));
            await batch.commit();
          }
        }
        
        // Flush final warnings silently if too many
        if (batchLogs.length > 0) {
          setUploadLog(prev => {
            const newLogs = batchLogs.map(l => ({ timestamp: new Date().toLocaleTimeString(), message: l.msg, type: l.type }));
            return [...prev, ...newLogs].slice(-30);
          });
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