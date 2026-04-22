import React, { useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  updateDoc
} from "firebase/firestore";

/**
 * ONE-TIME MIGRATION SCRIPT
 * Adds an 'IsPaid' boolean field to all bills in BillTable.
 * 
 * Logic:
 * If PaymentReceived >= ActualAmount (or if fully paid based on payment values) => IsPaid = true
 * Else => IsPaid = false
 * 
 * DELETE THIS FILE AFTER RUNNING ONCE.
 */
const FixIsPaid = () => {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const addLog = (msg) => setLog(prev => [...prev, msg]);

  const toNum = (v) => {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "string") v = v.replace(/,/g, "");
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };

  const runMigration = async () => {
    if (!window.confirm("This will read ALL bills and add the 'IsPaid' field. Proceed?")) return;

    setRunning(true);
    setLog([]);
    addLog("🚀 Starting IsPaid migration...");

    try {
      const snap = await getDocs(collection(db, "BillTable"));
      addLog(`📦 Found ${snap.docs.length} bills in Database.`);

      let updatedCount = 0;
      let errorCount = 0;

      for (const b of snap.docs) {
        const data = b.data();
        
        let actualAmt = toNum(data.ActualAmount);
        let taxAmt = toNum(data.TaxableAmount);

        // Standard amount fallback
        if (actualAmt === 0 && taxAmt > 0) {
          actualAmt = taxAmt * 1.18;
        }

        const paymentReceived = toNum(data.PaymentReceived);
        
        // Define IsPaid logic: 
        // 1. If payment is explicitly > 0 and covers Actual Amount
        // 2. OR, if actualAmt is 0 but it has a payment recorded.
        // As a strict baseline: if PaymentReceived > 0 and Outstanding <= 0, it is Paid.
        let isPaid = false;
        
        if (paymentReceived > 0) {
           if (actualAmt > 0 && paymentReceived >= actualAmt) {
             isPaid = true;
           } else if (actualAmt === 0) {
             // If we have no invoice amount but payment is received, treat as fully settled.
             isPaid = true;
           }
        }

        try {
          await updateDoc(doc(db, "BillTable", b.id), {
            IsPaid: isPaid
          });
          updatedCount++;
          if (updatedCount % 50 === 0) {
             addLog(`🔄 Processed ${updatedCount} bills...`);
          }
        } catch (err) {
          errorCount++;
          addLog(`❌ Error on bill ${b.id}: ${err.message}`);
        }
      }

      addLog("────────────────────────────────────────");
      addLog(`✅ MIGRATION COMPLETE!`);
      addLog(`🎉 Successfully updated: ${updatedCount} bills.`);
      addLog(`⚠️ Errors encountered: ${errorCount}`);
      addLog("👉 You can now safely delete FixIsPaid.jsx and its route.");
      setDone(true);
    } catch (err) {
      addLog(`💥 Fatal Error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ padding: 40, maxWidth: 800, margin: "0 auto", fontFamily: "monospace" }}>
      <h2 style={{ color: "#2563eb" }}>🛠️ Database Migration: Add IsPaid Field</h2>
      <p style={{ color: "#4b5563", fontSize: 14, marginBottom: 24 }}>
        This script will loop through all existing bills and calculate whether they are fully paid or unpaid, permanently storing <code>IsPaid: true|false</code> in Firestore. This allows for lightning-fast server-side payment filtering.
      </p>

      <button 
        onClick={runMigration} 
        disabled={running || done}
        style={{
          padding: "12px 24px", 
          background: done ? "#10b981" : (running ? "#9ca3af" : "#2563eb"),
          color: "white", 
          border: "none", 
          borderRadius: 8,
          cursor: (running || done) ? "not-allowed" : "pointer", 
          fontWeight: "bold",
          fontSize: 16
        }}
      >
        {running ? "🔄 Migrating Database..." : (done ? "✅ Migration Complete" : "🚀 Run Migration")}
      </button>

      <div style={{
        marginTop: 30, background: "#111827", color: "#10b981", 
        padding: 20, borderRadius: 8, height: 400, overflowY: "auto", fontSize: 14, lineHeight: 1.6
      }}>
        {log.length === 0 && <span style={{color: "#6b7280"}}>Logs will appear here...</span>}
        {log.map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
};

export default FixIsPaid;
