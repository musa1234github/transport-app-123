import { useOutletContext } from "react-router-dom";
import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  addDoc,
  serverTimestamp
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

  const handleUpload = async () => {
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

        let success = 0;
        let skipped = 0;
        let failed = 0;
        const paymentMap = new Map();

        addLog(`Found ${rows.length - 1} rows in Excel file`, "info");

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every(v => v === null || v === "")) continue;

          // Column mapping - Using dd-mm-yy format
          const billNumber = String(row[0] || "").trim();
          const paymentNumber = String(row[1] || "").trim();
          const paymentDate = parseDate(row[2]); // Expecting dd-mm-yy format
          const actualAmount = safeNum(row[3]);
          const tds = safeNum(row[4]);
          const gst = safeNum(row[5]);
          const paymentReceived = safeNum(row[6]);
          const shortageStr = String(row[7] || "").trim();

          const shortageCleaned = shortageStr.replace(/[-â€“]/g, "").trim();
          const shortage = safeNum(shortageCleaned);

          addLog(`Processing row ${i}: Bill ${billNumber}, Payment ${paymentNumber}`, "info");

          // Validate required fields
          if (!billNumber) {
            addLog(`Row ${i} skipped: Missing Bill Number`, "warning");
            skipped++;
            continue;
          }

          if (!paymentNumber) {
            addLog(`Row ${i} skipped: Missing Payment Number`, "warning");
            skipped++;
            continue;
          }

          if (paymentReceived === 0) {
            addLog(`Row ${i} skipped: Payment Received is 0`, "warning");
            skipped++;
            continue;
          }

          if (!paymentDate) {
            addLog(`Row ${i} skipped: Invalid Payment Date (${row[2]}) - Expected dd-mm-yy format`, "warning");
            skipped++;
            continue;
          }

          /* ===== FIND BILL ===== */
          const billQuery = query(
            collection(db, "BillTable"),
            where("BillNum", "==", billNumber)
          );

          const billSnapshot = await getDocs(billQuery);
          const billDoc = billSnapshot.docs.find(doc =>
            doc.data().FactoryName === factory
          );

          if (!billDoc) {
            addLog(`Row ${i} skipped: Bill ${billNumber} not found in ${factory}`, "warning");
            skipped++;
            continue;
          }

          const billId = billDoc.id;

          /* ===== FIND OR CREATE PAYMENT ===== */
          let paymentId = null;

          if (!paymentMap.has(paymentNumber)) {
            const paymentQuery = query(
              collection(db, "PaymentTable"),
              where("DocNumber", "==", paymentNumber)
            );

            const paymentSnapshot = await getDocs(paymentQuery);

            if (!paymentSnapshot.empty) {
              paymentId = paymentSnapshot.docs[0].id;
              paymentMap.set(paymentNumber, { id: paymentId, exists: true });
              addLog(`Row ${i}: Using existing payment ${paymentNumber}`, "info");
              
              // Update existing payment date if needed
              await updateDoc(doc(db, "PaymentTable", paymentId), {
                PayRecDate: paymentDate,
                Shortage: shortage,
                UpdatedAt: serverTimestamp()
              });
            } else {
              try {
                const paymentRef = await addDoc(collection(db, "PaymentTable"), {
                  DocNumber: paymentNumber,
                  PayRecDate: paymentDate,
                  Shortage: shortage,
                  FactoryName: factory,
                  CreatedOn: serverTimestamp()
                });

                paymentId = paymentRef.id;
                paymentMap.set(paymentNumber, { id: paymentId, exists: false });
                addLog(`Row ${i}: Created new payment ${paymentNumber}`, "success");
              } catch (error) {
                addLog(`Row ${i}: Failed to create payment ${paymentNumber}: ${error.message}`, "error");
                failed++;
                continue;
              }
            }
          } else {
            paymentId = paymentMap.get(paymentNumber).id;
          }

          /* ===== UPDATE BILL WITH PAYMENT INFO ===== */
          try {
            await updateDoc(doc(db, "BillTable", billId), {
              PaymentReceived: paymentReceived,
              ActualAmount: actualAmount,
              Tds: tds,
              Gst: gst,
              PId: paymentId,
              PaymentNumber: paymentNumber,
              UpdatedAt: serverTimestamp()
            });

            success++;
            addLog(`Row ${i}: Updated Bill ${billNumber} with payment ${paymentNumber} (${paymentReceived})`, "success");
          } catch (error) {
            failed++;
            addLog(`Row ${i}: Failed to update Bill ${billNumber}: ${error.message}`, "error");
          }
        }

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
      ["BILL-001", "PAY-001", "15-01-2026", 50000, 2500, 9000, 48000, "500"],
      ["BILL-002", "PAY-002", "16-01-2026", 75000, 3750, 13500, 72000, "250"],
      ["BILL-003", "PAY-003", "17-01-2026", 60000, 3000, 10800, 57600, "-300"]
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
          <strong>Important:</strong> Date format must be <strong>dd-mm-yyyy</strong> (e.g., 15-01-2026)
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