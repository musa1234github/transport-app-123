import { useOutletContext } from "react-router-dom";
import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  addDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
  orderBy,
  limit,
  deleteDoc
} from "firebase/firestore";
import { db } from "../firebaseConfig";

const FACTORIES = ["MANIGARH", "ULTRATECH", "JSW"];

/* ===== SAFE NUMBER PARSING ===== */
const safeNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") {
    // Remove commas and handle negative signs/dashes
    v = v.replace(/,/g, "").replace(/^[-â€“]/g, "").trim();
  }
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

/* ===== UPDATED DATE PARSING FOR dd-mm-yy FORMAT ===== */
const parseDate = (v) => {
  if (!v) return null;

  // If it's already a Date object
  if (v instanceof Date) return v;

  // If it's an Excel serial number
  if (typeof v === "number") {
    // Excel date (Windows) starts from Jan 1, 1900
    const excelEpoch = new Date(1899, 11, 30);
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const date = new Date(excelEpoch.getTime() + (v - 1) * millisecondsPerDay);

    // Adjust for Excel's leap year bug
    if (v > 60) {
      date.setTime(date.getTime() - 24 * 60 * 60 * 1000);
    }

    return date;
  }

  const str = String(v).trim();

  // Primary format: dd-mm-yyyy or dd/mm/yyyy
  const match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // Months are 0-indexed in JS
    let year = parseInt(match[3], 10);

    // Handle 2-digit years
    if (year < 100) {
      year = year >= 0 && year <= 50 ? year + 2000 : year + 1900;
    }

    const date = new Date(year, month, day);
    if (!isNaN(date.getTime()) && date.getDate() === day && date.getMonth() === month) {
      return date;
    }
  }

  // Try dd.mm.yyyy (with dots)
  const dotMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotMatch) {
    const day = parseInt(dotMatch[1], 10);
    const month = parseInt(dotMatch[2], 10) - 1;
    let year = parseInt(dotMatch[3], 10);

    if (year < 100) {
      year = year >= 0 && year <= 50 ? year + 2000 : year + 1900;
    }

    const date = new Date(year, month, day);
    if (!isNaN(date.getTime()) && date.getDate() === day && date.getMonth() === month) {
      return date;
    }
  }

  // Try yyyy-mm-dd (ISO format)
  const isoMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);

    const date = new Date(year, month, day);
    if (!isNaN(date.getTime()) && date.getDate() === day && date.getMonth() === month) {
      return date;
    }
  }

  // Try mm-dd-yyyy (old format) as fallback
  const usMatch = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (usMatch) {
    const month = parseInt(usMatch[1], 10) - 1;
    const day = parseInt(usMatch[2], 10);
    let year = parseInt(usMatch[3], 10);

    if (year < 100) {
      year = year >= 0 && year <= 50 ? year + 2000 : year + 1900;
    }

    const date = new Date(year, month, day);
    if (!isNaN(date.getTime()) && date.getDate() === day && date.getMonth() === month) {
      return date;
    }
  }

  // Try standard Date parse as last resort
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  console.warn(`Could not parse date: ${v}`);
  return null;
};

/* ===== ENSURE FACTORY EXISTS IN FACTORIES COLLECTION ===== */
const ensureFactoryExists = async (factoryName) => {
  try {
    const factoryDocRef = doc(db, "Factories", factoryName);

    // Use setDoc with merge to create or update
    await setDoc(factoryDocRef, {
      displayName: factoryName,
      hasPayments: true,
      lastUpdated: serverTimestamp()
    }, { merge: true });

    console.log(`✅ Factory "${factoryName}" registered in Factories collection`);
  } catch (error) {
    console.error(`Failed to register factory "${factoryName}":`, error);
  }
};

const PaymentUpload = () => {
  const { userRole } = useOutletContext();

  const [file, setFile] = useState(null);
  const [factory, setFactory] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadLog, setUploadLog] = useState([]);

  /* ===== ACCESS CONTROL ===== */
  const canUpload = userRole === "admin";

  if (!canUpload) {
    return <h3 style={{ color: "red" }}>Access Denied</h3>;
  }

  const addLog = (message, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setUploadLog(prev => [...prev, { timestamp, message, type }].slice(-20));
  };

  const handleUndoLastUpload = async () => {
    setLoading(true);
    setUploadLog([]);
    addLog("Searching for most recent upload session...", "info");
    
    try {
        // Query only COMPLETED sessions. 
        // ⚠️ ENGINER'S NOTE: Needs Composite Index on [status] + [createdAt (desc)]
        const sessionQuery = query(
            collection(db, "UploadSessions"), 
            where("status", "==", "COMPLETED"),
            orderBy("createdAt", "desc"), 
            limit(1)
        );
        const sessionSnap = await getDocs(sessionQuery);
        
        if (sessionSnap.empty) {
            addLog("No eligible completed sessions found to undo.", "warning");
            setLoading(false);
            return;
        }
        
        const lastSession = sessionSnap.docs[0];
        const sessionId = lastSession.id;
        addLog(`Found Session: ${sessionId} (File: ${lastSession.data().fileName}). Fetching logs...`, "info");
        
        // ⚠️ ENGINER'S NOTE: Ensure Firestore Index exists on UploadLogs.sessionId for this query to work optimally!
        const logsQuery = query(collection(db, "UploadLogs"), where("sessionId", "==", sessionId));
        const logsSnap = await getDocs(logsQuery);
        
        if (logsSnap.empty) {
            addLog("No changes found for this session.", "warning");
            setLoading(false);
            return;
        }

        // Safer confirmation showing exactly what we are undoing BEFORE we commit
        if (!window.confirm(`⚠️ DANGER: Undo ${logsSnap.size} records from the last upload session? This will safely revert to their original state.`)) {
            setLoading(false);
            return;
        }
        
        let batch = writeBatch(db);
        let batchOpCount = 0;
        let restored = 0;
        let deleted = 0;
        
        for (const logDoc of logsSnap.docs) {
            const data = logDoc.data();
            const [colName, docId] = data.docPath.split("/");
            const docRef = doc(db, colName, docId);
            
            if (batchOpCount >= 450) {
                await batch.commit();
                batch = writeBatch(db);
                batchOpCount = 0;
            }
            
            if (data.action === "UPDATE") {
                // IMPORTANT: use merge: true to avoid overwriting fields added by other systems since
                batch.set(docRef, data.oldData, { merge: true });
                restored++;
            } else if (data.action === "CREATE") {
                // Soft Delete Strategy
                batch.set(docRef, { 
                    isDeleted: true,
                    deletedAt: serverTimestamp() 
                }, { merge: true });
                deleted++;
            }
            batchOpCount++;

            // Delete the audit log so DB doesn't bloat endlessly
            batch.delete(logDoc.ref);
            batchOpCount++;
        }

        if (batchOpCount > 0) {
            await batch.commit();
        }

        // Mark session as UNDONE to prevent multiple rollbacks, executed asynchronously outside batch tracking limits
        await updateDoc(doc(db, "UploadSessions", sessionId), { 
            status: "UNDONE",
            undoneAt: serverTimestamp()
        });
        
        addLog(`Undo complete. Restored: ${restored}, Deleted/Soft-Deleted: ${deleted} documents.`, "success");
        alert(`Undo Successful! Restored ${restored} updates, deleted ${deleted} creations.`);
    } catch (error) {
        console.error(error);
        addLog(`Undo failed: ${error.message}`, "error");
        alert("Undo failed!");
    }
    
    setLoading(false);
  };

  const handleUpload = async () => {
    if (loading) return; // Prevent accidental double-click parallel uploading operations
    
    if (!file || !factory) {
      alert("Select Factory and Excel file");
      return;
    }

    setLoading(true);
    setUploadLog([]);
    addLog(`Starting payment upload for ${factory}...`, "info");

    // Ensure factory exists in Factories collection
    await ensureFactoryExists(factory);

    // --- STUCK SESSION RECOVERY ---
    try {
        const stuckQuery = query(collection(db, "UploadSessions"), where("status", "==", "IN_PROGRESS"));
        const stuckSnap = await getDocs(stuckQuery);
        if (!stuckSnap.empty) {
            const recoveryBatch = writeBatch(db);
            stuckSnap.docs.forEach(d => {
                recoveryBatch.update(d.ref, { status: "FAILED", failedAt: serverTimestamp() });
            });
            await recoveryBatch.commit();
            addLog(`Recovered ${stuckSnap.size} stuck sessions (marked FAILED).`, "warning");
        }
    } catch (err) {
        console.error("Failed to recover stuck sessions:", err);
    }

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "binary", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

        if (rows.length <= 1) {
          setLoading(false);
          addLog("Excel file is empty", "warning");
          return;
        }

        // ⚠️ ENGINER'S NOTE: Manual log cleanup removed. Configure Firestore strictly applying Native TTL Policy on `UploadLogs.timestamp` field dynamically truncating > 30 Days.
        
        // --- NEW: CREATE UPLOAD SESSION ---
        const sessionRef = doc(collection(db, "UploadSessions"));
        const sessionId = sessionRef.id;
        await setDoc(sessionRef, {
          sessionId: sessionId,
          factory: factory,
          fileName: file.name,
          totalRows: rows.length - 1,
          uploadedBy: userRole, 
          status: "IN_PROGRESS",
          createdAt: serverTimestamp()
        });
        addLog(`Upload Session Created: ${sessionId} (Status: IN_PROGRESS)`, "info");

        let success = 0;
        let skipped = 0;
        let failed = 0;
        
        let batch = writeBatch(db);
        let batchOpCount = 0;
        
        const seenDocs = new Set(); // Prevents logging updates to the same doc twice in one session
        const billExistsCache = new Map(); // Strictly tracks BillTable existence avoiding fake invoice creations
        const seenRows = new Set(); // Prevent exact identical rows from overriding duplicates

        // Note: Audit Logging generates 1 read per unique document touched. Expected and optimal for tracking.
        addLog(`Found ${rows.length - 1} rows in Excel file. Uploading with Audit Tracking...`, "info");

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every(v => v === null || v === "")) continue;

          // Column mapping - Using dd-mm-yy format naturally casing combinations
          const billNumber = String(row[0] || "").trim().toUpperCase();
          const paymentNumber = String(row[1] || "").trim().toUpperCase();
          const paymentDate = parseDate(row[2]); // Expecting dd-mm-yy format
          const actualAmount = safeNum(row[3]);
          const tds = safeNum(row[4]);
          const gst = safeNum(row[5]);
          const paymentReceived = safeNum(row[6]);
          const shortageStr = String(row[7] || "").trim();

          const shortageCleaned = shortageStr.replace(/[-â€“]/g, "").trim();
          const shortage = safeNum(shortageCleaned);

          // Prevent exact duplicate processing within the same document loop
          const uniqueRowKey = `${billNumber}_${paymentNumber}`;
          if (seenRows.has(uniqueRowKey)) {
             skipped++;
             continue;
          }
          seenRows.add(uniqueRowKey);

          // Validate required fields and enforce format
          if (!billNumber || billNumber.length < 3) {
            addLog(`Row ${i} skipped: Invalid or Missing Bill Number`, "warning");
            skipped++;
            continue;
          }

          if (!paymentNumber || paymentNumber.length < 3) {
            addLog(`Row ${i} skipped: Invalid or Missing Payment Number`, "warning");
            skipped++;
            continue;
          }

          // Strict Financial Validations
          if (paymentReceived < 0) {
            addLog(`Row ${i} skipped: Negative Payment Received`, "warning");
            skipped++;
            continue;
          }
          
          if (actualAmount <= 0) {
            addLog(`Row ${i} skipped: Actual Amount must be strictly greater than 0`, "warning");
            skipped++;
            continue;
          }

          if (!paymentDate) {
            addLog(`Row ${i} skipped: Invalid Payment Date (${row[2]}) - Expected dd-mm-yy format`, "warning");
            skipped++;
            continue;
          }

          /* ===== COMMIT BATCH IF LIMIT REACHED ===== */
          if (batchOpCount >= 450) {
            addLog(`Committing batch writes (${batchOpCount} ops)...`, "info");
            await batch.commit();
            batch = writeBatch(db);
            batchOpCount = 0;
          }

          /* ===== DOC ID STRATEGY ===== */
          const billId = `${factory}_${billNumber}`;
          const paymentId = `${factory}_${paymentNumber}`;
          
          const billRef = doc(db, "BillTable", billId);
          const paymentRef = doc(db, "PaymentTable", paymentId);

          /* ===== STRICT VALIDATION & AUDIT LOGGING ===== */
          const billPath = `BillTable/${billId}`;
          const paymentPath = `PaymentTable/${paymentId}`;
          
          const docsToFetch = [];
          // Force fetch if we haven't resolved Bill existence yet
          if (!billExistsCache.has(billPath)) {
              docsToFetch.push({ ref: billRef, path: billPath });
          }
          if (!seenDocs.has(paymentPath)) {
              docsToFetch.push({ ref: paymentRef, path: paymentPath });
          }

          let currentBillExists = billExistsCache.get(billPath);
          let fetchedBillData = null;
          let fetchedPaymentData = null;

          if (docsToFetch.length > 0) {
            // Accelerate latency via parallel fetches
            const snapshots = await Promise.all(docsToFetch.map(item => getDoc(item.ref)));
            
            snapshots.forEach((snap, index) => {
               const path = docsToFetch[index].path;
               if (path === billPath) {
                   currentBillExists = snap.exists();
                   billExistsCache.set(billPath, currentBillExists);
                   fetchedBillData = snap;
               } else if (path === paymentPath) {
                   fetchedPaymentData = snap;
               }
            });
          }

          // Log a warning if Bill doesn't exist, but allow the upload to proceed
          if (!currentBillExists) {
              addLog(`Row ${i} warning: Bill ${billNumber} does not exist in DB yet - will be created`, "warning");
          }

          // Proceed with Audit Logging
          if (fetchedBillData && !seenDocs.has(billPath)) {
              batch.set(doc(collection(db, "UploadLogs")), {
                  sessionId: sessionId,
                  docPath: billPath,
                  action: fetchedBillData.exists() ? "UPDATE" : "CREATE",
                  oldData: fetchedBillData.exists() ? fetchedBillData.data() : null,
                  timestamp: serverTimestamp()
              });
              batchOpCount++;
              seenDocs.add(billPath);
          }

          if (fetchedPaymentData && !seenDocs.has(paymentPath)) {
              batch.set(doc(collection(db, "UploadLogs")), {
                  sessionId: sessionId,
                  docPath: paymentPath,
                  action: fetchedPaymentData.exists() ? "UPDATE" : "CREATE",
                  oldData: fetchedPaymentData.exists() ? fetchedPaymentData.data() : null,
                  timestamp: serverTimestamp()
              });
              batchOpCount++;
              seenDocs.add(paymentPath);
          }

          // Payment Table (Upsert)
          batch.set(paymentRef, {
            DocNumber: paymentNumber,
            PayRecDate: paymentDate,
            Shortage: shortage,
            FactoryName: factory,
            UpdatedAt: serverTimestamp(),
            // Ensure CreateOn exists if first time but don't strictly require it so we just keep UpdatedAt as main trace
          }, { merge: true });
          batchOpCount++;
          
          // Bill Table Update (Upsert to prevent full batch failure if bill doesn't exist)
          batch.set(billRef, {
            PaymentReceived: paymentReceived,
            ActualAmount: actualAmount,
            Tds: tds,
            Gst: gst,
            PId: paymentId,
            PaymentNumber: paymentNumber,
            // DENORMALIZED FIELDS - Eliminate N+1 queries to PaymentTable
            PaymentDocNumber: paymentNumber,
            PaymentRecDate: paymentDate,
            PaymentShortage: shortage,
            Shortage: shortage, // Keep for backward compatibility
            UpdatedAt: serverTimestamp()
          }, { merge: true });
          batchOpCount++;
          
          success++;
          if (i % 50 === 0) {
             addLog(`Processed ${i} rows...`, "info");
          }
        }

        if (batchOpCount > 0) {
          addLog(`Committing final batch writes (${batchOpCount} ops)...`, "info");
          await batch.commit();
        }
        
        // Finalize Session Status
        await updateDoc(sessionRef, { status: "COMPLETED", completedAt: serverTimestamp() });

        setLoading(false);

        const summary = `Upload completed:\nSuccess: ${success}\nSkipped: ${skipped}\nFailed: ${failed}`;
        addLog(summary, "info");
        alert(summary);
      } catch (error) {
        setLoading(false);
        addLog(`Upload failed: ${error.message}`, "error");
        alert(`Upload failed: ${error.message}`);
      }
    };

    reader.onerror = () => {
      setLoading(false);
      addLog("Error reading file", "error");
      alert("Error reading file");
    };

    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const sampleData = [
      ["BillNumber", "PaymentNumber", "PaymentDate", "ActualAmount", "TDS", "GST", "PaymentReceived", "Shortage"],
      ["BILL-001", "PAY-001", "15-01-26", 50000, 2500, 9000, 48000, "500"],
      ["BILL-002", "PAY-002", "16-01-26", 75000, 3750, 13500, 72000, "250"],
      ["BILL-003", "PAY-003", "17-01-26", 60000, 3000, 10800, 57600, "-300"]
    ];

    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PaymentTemplate");

    XLSX.writeFile(wb, `Payment_Upload_Template_${factory || 'Generic'}.xlsx`);
    addLog("Payment template downloaded", "info");
  };

  return (
    <div style={{ maxWidth: 800, margin: "30px auto", padding: "0 20px" }}>
      <h1 style={{ textAlign: "center", marginBottom: "30px" }}>Payment Upload</h1>

      {/* Factory Selection */}
      <div style={{ marginBottom: "25px", width: "200px" }}>
        <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>
          Select Factory:
        </label>
        <select
          value={factory}
          onChange={e => {
            setFactory(e.target.value);
          }}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "4px",
            border: "1px solid #ced4da",
            fontSize: "16px"
          }}
        >
          <option value="">-- Select Factory --</option>
          {FACTORIES.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* Upload Section */}
      <div style={{
        backgroundColor: "#f8f9fa",
        padding: "20px",
        borderRadius: "5px",
        marginBottom: "30px",
        border: "1px solid #dee2e6"
      }}>
        <h4>Upload Payment Excel File:</h4>
        <p style={{ margin: "10px 0", color: "#6c757d" }}>
          Excel must have columns: BillNumber, PaymentNumber, PaymentDate, ActualAmount, TDS, GST, PaymentReceived, Shortage
        </p>
        <p style={{ margin: "10px 0", color: "#6c757d", fontSize: "14px" }}>
          <strong>Important:</strong> Date format must be <strong>dd-mm-yy</strong> (e.g., 15-01-26)
        </p>

        <div style={{ marginBottom: "15px" }}>
          <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>
            Select Excel File:
          </label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={e => {
              setFile(e.target.files[0]);
              if (e.target.files[0]) {
                addLog(`Selected file: ${e.target.files[0].name}`, "info");
              }
            }}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "4px",
              border: "1px solid #ced4da"
            }}
          />
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={handleUpload}
            disabled={loading || !file || !factory}
            style={{
              padding: "10px 20px",
              backgroundColor: loading || !file || !factory ? "#cccccc" : "#28a745",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: loading || !file || !factory ? "not-allowed" : "pointer",
              fontSize: "16px",
              flex: 1
            }}
          >
            {loading ? "Uploading..." : "Upload Payments"}
          </button>
          
          <button
            onClick={handleUndoLastUpload}
            disabled={loading}
            style={{
              padding: "10px 20px",
              backgroundColor: loading ? "#cccccc" : "#dc3545",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "16px",
              flex: 1
            }}
          >
            Undo Last Upload
          </button>

          <button
            onClick={downloadTemplate}
            style={{
              padding: "10px 20px",
              backgroundColor: "#6c757d",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "16px",
              flex: 1
            }}
          >
            Download Template
          </button>
        </div>
      </div>

      {/* Upload Log */}
      {uploadLog.length > 0 && (
        <div style={{
          marginBottom: "30px",
          border: "1px solid #dee2e6",
          borderRadius: "5px",
          overflow: "hidden"
        }}>
          <div style={{
            backgroundColor: "#343a40",
            color: "white",
            padding: "10px 15px",
            fontWeight: "bold"
          }}>
            Upload Log
          </div>
          <div style={{
            maxHeight: "300px",
            overflowY: "auto",
            backgroundColor: "#f8f9fa"
          }}>
            {uploadLog.map((log, index) => (
              <div
                key={index}
                style={{
                  padding: "8px 15px",
                  borderBottom: "1px solid #dee2e6",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  color: log.type === "error" ? "#dc3545" :
                    log.type === "warning" ? "#ffc107" :
                      log.type === "success" ? "#28a745" : "#6c757d"
                }}
              >
                <span style={{ color: "#6c757d", marginRight: "10px" }}>
                  [{log.timestamp}]
                </span>
                {log.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentUpload;