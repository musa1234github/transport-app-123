import { useOutletContext } from "react-router-dom";
import React, { useState } from "react";
import * as XLSX from "xlsx";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
  Timestamp
} from "firebase/firestore";
import { db } from "../firebaseConfig";

const FACTORIES = ["MANIGARH", "ULTRATECH", "JSW"];

/* ===== SAFE NUMBER PARSING ===== */
const safeNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") {
    v = v.replace(/,/g, "").replace(/^[-–]/g, "").trim();
  }
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

/* ===== DATE PARSING (dd-mm-yy / dd-mm-yyyy / Excel serial) ===== */
const parseDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;

  if (typeof v === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + (v - 1) * 86400000);
    if (v > 60) date.setTime(date.getTime() - 86400000);
    return date;
  }

  const str = String(v).trim();

  const match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    let year = parseInt(match[3], 10);
    if (year < 100) year = year <= 50 ? year + 2000 : year + 1900;
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime()) && date.getDate() === day && date.getMonth() === month) return date;
  }

  const dotMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotMatch) {
    const day = parseInt(dotMatch[1], 10);
    const month = parseInt(dotMatch[2], 10) - 1;
    let year = parseInt(dotMatch[3], 10);
    if (year < 100) year = year <= 50 ? year + 2000 : year + 1900;
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime()) && date.getDate() === day && date.getMonth() === month) return date;
  }

  const isoMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (isoMatch) {
    const date = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    if (!isNaN(date.getTime())) return date;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed;

  console.warn(`Could not parse date: ${v}`);
  return null;
};

const PaymentUpload = () => {
  const { userRole } = useOutletContext();

  const [file, setFile] = useState(null);
  const [factory, setFactory] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadLog, setUploadLog] = useState([]);

  /* ===== ACCESS CONTROL ===== */
  if (userRole !== "admin") {
    return <h3 style={{ color: "red" }}>Access Denied</h3>;
  }

  const addLog = (message, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setUploadLog(prev => [...prev, { timestamp, message, type }].slice(-30));
  };

  const handleUpload = async () => {
    if (loading) return;

    if (!file || !factory) {
      alert("Select Factory and Excel file");
      return;
    }

    setLoading(true);
    setUploadLog([]);
    addLog(`Starting payment upload for ${factory}...`, "info");

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "binary", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

        if (rows.length <= 1) {
          addLog("Excel file is empty or has no data rows.", "warning");
          setLoading(false);
          return;
        }

        let success = 0;
        let skipped = 0;

        // --- BULK PREFETCH existing records to avoid per-row reads ---
        addLog("Prefetching existing records...", "info");

        const billNums = new Set();
        const payNums  = new Set();

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.every(v => v === null || v === "")) continue;
          const bn = String(r[0] || "").trim().toUpperCase();
          const pn = String(r[1] || "").trim().toUpperCase();
          if (bn) billNums.add(bn);
          if (pn) payNums.add(pn);
        }

        // Fetch existing BillTable docs in chunks of 30
        const billNums30 = Array.from(billNums);
        for (let i = 0; i < billNums30.length; i += 30) {
          const chunk = billNums30.slice(i, i + 30);
          const q = query(
            collection(db, "BillTable"),
            where("FactoryName", "==", factory),
            where("BillNum", "in", chunk)
          );
          await getDocs(q); // prefetch – warms cache, not strictly needed but keeps pattern
        }

        addLog(`Prefetch done. Processing ${rows.length - 1} rows...`, "info");

        // --- SINGLE BATCH for all writes ---
        let batch = writeBatch(db);
        let batchOps = 0;
        const seenRows = new Set();

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every(v => v === null || v === "")) continue;

          const billNumber    = String(row[0] || "").trim().toUpperCase();
          const paymentNumber = String(row[1] || "").trim().toUpperCase();
          const paymentDate   = parseDate(row[2]);
          const actualAmount  = safeNum(row[3]);
          const tds           = safeNum(row[4]);
          const gst           = safeNum(row[5]);
          const paymentReceived = safeNum(row[6]);
          const shortageStr   = String(row[7] || "").trim();
          const shortage      = safeNum(shortageStr.replace(/[-–]/g, "").trim());
          const billDate      = parseDate(row[8]);
          const billType      = String(row[9] || "").trim();

          // Skip duplicates within same file
          const rowKey = `${billNumber}_${paymentNumber}`;
          if (seenRows.has(rowKey)) { skipped++; continue; }
          seenRows.add(rowKey);

          // Validate required fields
          if (!billNumber || billNumber.length < 3) {
            addLog(`Row ${i}: skipped — invalid Bill Number`, "warning");
            skipped++; continue;
          }
          if (!paymentNumber || paymentNumber.length < 3) {
            addLog(`Row ${i}: skipped — invalid Payment Number`, "warning");
            skipped++; continue;
          }
          if (!paymentDate) {
            addLog(`Row ${i}: skipped — invalid date "${row[2]}" (use dd-mm-yy)`, "warning");
            skipped++; continue;
          }
          if (actualAmount <= 0) {
            addLog(`Row ${i}: skipped — Actual Amount must be > 0`, "warning");
            skipped++; continue;
          }
          if (paymentReceived < 0) {
            addLog(`Row ${i}: skipped — Negative Payment Received`, "warning");
            skipped++; continue;
          }

          // Flush batch if near limit
          if (batchOps >= 490) {
            addLog(`Committing batch (${batchOps} ops)...`, "info");
            await batch.commit();
            batch = writeBatch(db);
            batchOps = 0;
          }

          // Sanitize IDs: a "/" in a bill/payment number would silently create
          // a subcollection path (e.g. BillTable/JSW_100/07/001) which has no
          // security rule → permission-denied on write.
          const billId     = `${factory}_${billNumber}`.replace(/\//g, "_");
          const paymentId  = `${factory}_${paymentNumber}`.replace(/\//g, "_");
          console.log(`[ROW ${i}] billId="${billId}" | paymentId="${paymentId}"`);
          const billRef    = doc(db, "BillTable", billId);
          const paymentRef = doc(db, "PaymentTable", paymentId);

          // PaymentTable upsert
          batch.set(paymentRef, {
            DocNumber:   paymentNumber,
            PayRecDate:  Timestamp.fromDate(paymentDate),
            Shortage:    shortage,
            FactoryName: factory,
            UpdatedAt:   serverTimestamp(),
          }, { merge: true });
          batchOps++;

          // BillTable upsert
          const billData = {
            FactoryName:       factory,
            BillNum:           billNumber,
            PaymentReceived:   paymentReceived,
            ActualAmount:      actualAmount,
            Tds:               tds,
            Gst:               gst,
            PId:               paymentId,
            PaymentNumber:     paymentNumber,
            PaymentDocNumber:  paymentNumber,
            PaymentRecDate:    Timestamp.fromDate(paymentDate),
            PaymentShortage:   shortage,
            Shortage:          shortage,
            UpdatedAt:         serverTimestamp(),
          };
          if (billDate) billData.BillDate = Timestamp.fromDate(billDate);
          if (billType)  billData.BillType  = billType;

          batch.set(billRef, billData, { merge: true });
          batchOps++;

          success++;
          if (i % 50 === 0) addLog(`Processed ${i} rows...`, "info");
        }

        // Final commit
        if (batchOps > 0) {
          addLog(`Committing final batch (${batchOps} ops)...`, "info");
          await batch.commit();
        }

        setLoading(false);
        const summary = `Upload complete!\nSuccess: ${success}\nSkipped: ${skipped}`;
        addLog(summary, "success");
        alert(summary);

      } catch (error) {
        setLoading(false);
        const detail = `[${error.code || "error"}] ${error.message}`;
        console.error("Upload error:", error);
        addLog(`Upload failed: ${detail}`, "error");
        alert(`Upload failed: ${detail}`);
      }
    };

    reader.onerror = () => {
      setLoading(false);
      addLog("Error reading file", "error");
    };

    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const sampleData = [
      ["BillNumber","PaymentNumber","PaymentDate","ActualAmount","TDS","GST","PaymentReceived","Shortage","BillDate","BillType"],
      ["BILL-001","PAY-001","15-01-26",50000,2500,9000,48000,"500","01-01-26","Transport"],
      ["BILL-002","PAY-002","16-01-26",75000,3750,13500,72000,"250","05-01-26","Transport"],
      ["BILL-003","PAY-003","17-01-26",60000,3000,10800,57600,"-300","10-01-26","Loading"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PaymentTemplate");
    XLSX.writeFile(wb, `Payment_Upload_Template_${factory || "Generic"}.xlsx`);
    addLog("Template downloaded.", "info");
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
          onChange={e => setFactory(e.target.value)}
          style={{ width: "100%", padding: "10px", borderRadius: "4px", border: "1px solid #ced4da", fontSize: "16px" }}
        >
          <option value="">-- Select Factory --</option>
          {FACTORIES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Upload Section */}
      <div style={{ backgroundColor: "#f8f9fa", padding: "20px", borderRadius: "5px", marginBottom: "30px", border: "1px solid #dee2e6" }}>
        <h4>Upload Payment Excel File:</h4>
        <p style={{ margin: "10px 0", color: "#6c757d" }}>
          Excel must have columns: BillNumber, PaymentNumber, PaymentDate, ActualAmount, TDS, GST,
          PaymentReceived, Shortage, BillDate (optional), BillType (optional)
        </p>
        <p style={{ margin: "10px 0", color: "#6c757d", fontSize: "14px" }}>
          <strong>Important:</strong> Date format must be <strong>dd-mm-yy</strong> (e.g., 15-01-26).
        </p>

        <div style={{ marginBottom: "15px" }}>
          <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Select Excel File:</label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={e => {
              setFile(e.target.files[0]);
              if (e.target.files[0]) addLog(`Selected: ${e.target.files[0].name}`, "info");
            }}
            style={{ width: "100%", padding: "10px", borderRadius: "4px", border: "1px solid #ced4da" }}
          />
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={handleUpload}
            disabled={loading || !file || !factory}
            style={{
              padding: "10px 20px",
              backgroundColor: loading || !file || !factory ? "#cccccc" : "#28a745",
              color: "white", border: "none", borderRadius: "4px",
              cursor: loading || !file || !factory ? "not-allowed" : "pointer",
              fontSize: "16px", flex: 1
            }}
          >
            {loading ? "Uploading..." : "Upload Payments"}
          </button>

          <button
            onClick={downloadTemplate}
            style={{ padding: "10px 20px", backgroundColor: "#6c757d", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "16px", flex: 1 }}
          >
            Download Template
          </button>
        </div>
      </div>

      {/* Upload Log */}
      {uploadLog.length > 0 && (
        <div style={{ marginBottom: "30px", border: "1px solid #dee2e6", borderRadius: "5px", overflow: "hidden" }}>
          <div style={{ backgroundColor: "#343a40", color: "white", padding: "10px 15px", fontWeight: "bold" }}>
            Upload Log
          </div>
          <div style={{ maxHeight: "300px", overflowY: "auto", backgroundColor: "#f8f9fa" }}>
            {uploadLog.map((log, index) => (
              <div key={index} style={{
                padding: "8px 15px", borderBottom: "1px solid #dee2e6",
                fontFamily: "monospace", fontSize: "12px",
                color: log.type === "error" ? "#dc3545" : log.type === "warning" ? "#856404" : log.type === "success" ? "#28a745" : "#6c757d"
              }}>
                <span style={{ color: "#6c757d", marginRight: "10px" }}>[{log.timestamp}]</span>
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