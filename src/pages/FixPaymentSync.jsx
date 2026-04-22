import React, { useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where
} from "firebase/firestore";

/**
 * ONE-TIME SYNC TOOL
 * Reads all BillTable records where PaymentReceived > 0 (already correct)
 * and finds BillTable records that SHOULD have a payment but show 0.
 *
 * Since ShowPayment reads PaymentReceived from BillTable,
 * this tool finds bills where:
 *   - BillTable.PaymentReceived = 0 / null / missing
 *   - BUT the bill has PaymentNumber set (meaning payment was recorded)
 *
 * It then prompts you to confirm before updating those records.
 *
 * DELETE THIS FILE after running.
 */
const FixPaymentSync = () => {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [preview, setPreview] = useState([]);
  const [previewed, setPreviewed] = useState(false);

  const addLog = (msg) => setLog(prev => [...prev, msg]);

  // STEP 1: Preview which bills have a PaymentNumber but PaymentReceived = 0
  const runPreview = async () => {
    setRunning(true);
    setLog([]);
    setPreview([]);
    setPreviewed(false);
    try {
      addLog("🔍 Scanning BillTable for bills with PaymentNumber but PaymentReceived = 0...");
      const snap = await getDocs(collection(db, "BillTable"));
      addLog(`📦 Total documents: ${snap.docs.length}`);

      const broken = [];
      snap.docs.forEach(docSnap => {
        const data = docSnap.data();
        const payReceived = parseFloat(data.PaymentReceived) || 0;
        const hasPaymentNum = !!(data.PaymentNumber || data.PaymentNum);

        // Bills that have a payment number recorded but 0 payment received
        if (hasPaymentNum && payReceived === 0) {
          broken.push({
            id: docSnap.id,
            BillNum: data.BillNum || docSnap.id,
            FactoryName: data.FactoryName || "",
            PaymentNumber: data.PaymentNumber || data.PaymentNum || "",
            ActualAmount: parseFloat(data.ActualAmount) || 0,
            CurrentPaymentReceived: payReceived
          });
        }
      });

      if (broken.length === 0) {
        addLog("✅ No inconsistencies found! All paid bills have correct PaymentReceived values.");
        setPreviewed(true);
        setRunning(false);
        return;
      }

      addLog(`⚠️ Found ${broken.length} bills with PaymentNumber but PaymentReceived = 0:`);
      broken.forEach(b => {
        addLog(`  • ${b.BillNum} | ${b.FactoryName} | PayNo: ${b.PaymentNumber} | ActualAmt: ${b.ActualAmount.toFixed(2)}`);
      });
      addLog("─────────────────────────────");
      addLog("👆 Review the list above. These bills will NOT be auto-fixed because");
      addLog("   we don't know the correct PaymentReceived value without the payment records.");
      addLog("   Please check these bills manually in Firestore and update PaymentReceived.");

      setPreview(broken);
      setPreviewed(true);
    } catch (err) {
      addLog(`💥 Error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  // STEP 2: If PaymentReceived should equal ActualAmount for fully paid bills, fix them
  const fixFullyPaid = async () => {
    if (preview.length === 0) return;
    if (!window.confirm(
      `This will set PaymentReceived = ActualAmount for ${preview.length} bills.\n\n` +
      `Use this ONLY if all listed bills are FULLY paid.\n\nProceed?`
    )) return;

    setRunning(true);
    let updated = 0, failed = 0;
    try {
      for (const bill of preview) {
        try {
          if (bill.ActualAmount > 0) {
            await updateDoc(doc(db, "BillTable", bill.id), {
              PaymentReceived: bill.ActualAmount
            });
            updated++;
            addLog(`✅ Fixed: ${bill.BillNum} → PaymentReceived = ${bill.ActualAmount.toFixed(2)}`);
          } else {
            addLog(`⚠️ Skipped: ${bill.BillNum} (ActualAmount is 0, cannot auto-fix)`);
          }
        } catch (err) {
          addLog(`❌ Failed: ${bill.BillNum} — ${err.message}`);
          failed++;
        }
      }
      addLog("─────────────────────────────");
      addLog(`✅ Updated: ${updated} | ❌ Failed: ${failed}`);
      addLog("🎉 Done! Delete this page now.");
      setDone(true);
    } catch (err) {
      addLog(`💥 Fatal: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ padding: 30, maxWidth: 900, margin: "0 auto", fontFamily: "monospace" }}>
      <h2 style={{ color: "#dc2626" }}>⚠️ Fix PaymentReceived Sync Tool</h2>
      <p style={{ color: "#6b7280", marginBottom: 8 }}>
        Finds bills with a <code>PaymentNumber</code> recorded but <code>PaymentReceived = 0</code> in BillTable.
      </p>
      <p style={{ color: "#f59e0b", marginBottom: 20, fontWeight: 600 }}>
        ⚠️ Run "Preview" first. Only use "Fix Fully Paid" if you are sure all listed bills are fully paid.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <button onClick={runPreview} disabled={running} style={{
          padding: "10px 20px", background: running ? "#9ca3af" : "#2563eb",
          color: "white", border: "none", borderRadius: 6,
          cursor: running ? "not-allowed" : "pointer", fontWeight: 600
        }}>
          {running ? "⏳ Scanning..." : "🔍 Step 1: Preview Broken Bills"}
        </button>

        {previewed && preview.length > 0 && (
          <button onClick={fixFullyPaid} disabled={running || done} style={{
            padding: "10px 20px", background: done ? "#10b981" : "#dc2626",
            color: "white", border: "none", borderRadius: 6,
            cursor: running || done ? "not-allowed" : "pointer", fontWeight: 600
          }}>
            {done ? "✅ Done" : `🔧 Step 2: Fix ${preview.length} Bills (Set PaymentReceived = ActualAmount)`}
          </button>
        )}
      </div>

      {log.length > 0 && (
        <div style={{
          background: "#111827", color: "#d1fae5", padding: 20,
          borderRadius: 8, maxHeight: 500, overflowY: "auto",
          fontSize: 13, lineHeight: "1.8"
        }}>
          {log.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {previewed && preview.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ color: "#dc2626" }}>Bills to fix ({preview.length}):</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={{ padding: "8px", textAlign: "left", border: "1px solid #e5e7eb" }}>Bill No.</th>
                <th style={{ padding: "8px", textAlign: "left", border: "1px solid #e5e7eb" }}>Factory</th>
                <th style={{ padding: "8px", textAlign: "left", border: "1px solid #e5e7eb" }}>Payment No.</th>
                <th style={{ padding: "8px", textAlign: "right", border: "1px solid #e5e7eb" }}>Actual Amount</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((b, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                  <td style={{ padding: "8px", border: "1px solid #e5e7eb" }}>{b.BillNum}</td>
                  <td style={{ padding: "8px", border: "1px solid #e5e7eb" }}>{b.FactoryName}</td>
                  <td style={{ padding: "8px", border: "1px solid #e5e7eb" }}>{b.PaymentNumber}</td>
                  <td style={{ padding: "8px", border: "1px solid #e5e7eb", textAlign: "right" }}>
                    ₹{b.ActualAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default FixPaymentSync;
