import React, { useState } from "react";
import { db } from "../firebaseConfig";
import { collection, getDocs, doc, updateDoc, Timestamp } from "firebase/firestore";

/**
 * ONE-TIME MIGRATION TOOL
 * Converts BillDate string fields (e.g., "15-04-2026") to Firestore Timestamps
 * DELETE THIS FILE after migration is complete.
 */
const FixBillDates = () => {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const addLog = (msg) => setLog(prev => [...prev, msg]);

  const runMigration = async () => {
    if (!window.confirm("This will update old BillDate string fields to Timestamps.\n\nProceed?")) return;
    setRunning(true); setDone(false); setLog([]);
    try {
      addLog("🔍 Fetching all BillTable documents...");
      const snap = await getDocs(collection(db, "BillTable"));
      addLog(`📦 Total documents: ${snap.docs.length}`);
      let skipped = 0, updated = 0, failed = 0, nullCount = 0;

      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const billDate = data.BillDate;
        if (billDate && billDate.seconds !== undefined) { skipped++; continue; }
        if (!billDate) { nullCount++; addLog(`⚠️ Null BillDate: ${docSnap.id}`); continue; }
        if (typeof billDate === "string") {
          try {
            let parsedDate = null;
            if (/^\d{2}-\d{2}-\d{4}$/.test(billDate)) {
              const [day, month, year] = billDate.split("-");
              parsedDate = new Date(`${year}-${month}-${day}T00:00:00`);
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
              parsedDate = new Date(`${billDate}T00:00:00`);
            } else if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(billDate)) {
              parsedDate = new Date(billDate);
            }
            if (!parsedDate || isNaN(parsedDate.getTime())) {
              addLog(`❌ Cannot parse "${billDate}" — ${docSnap.id}`); failed++; continue;
            }
            await updateDoc(doc(db, "BillTable", docSnap.id), { BillDate: Timestamp.fromDate(parsedDate) });
            updated++;
            if (updated % 10 === 0) addLog(`✅ Updated ${updated} docs...`);
          } catch (err) { addLog(`❌ Error ${docSnap.id}: ${err.message}`); failed++; }
        } else { skipped++; }
      }
      addLog("─────────────────────────");
      addLog(`✅ Updated: ${updated}`);
      addLog(`⏭️ Skipped: ${skipped} (already Timestamps)`);
      addLog(`⚠️ Null:    ${nullCount}`);
      addLog(`❌ Failed:  ${failed}`);
      addLog("🎉 Done! Delete this page now.");
      setDone(true);
    } catch (err) { addLog(`💥 Fatal: ${err.message}`); }
    finally { setRunning(false); }
  };

  return (
    <div style={{ padding: 30, maxWidth: 800, margin: "0 auto", fontFamily: "monospace" }}>
      <h2 style={{ color: "#dc2626" }}>⚠️ BillDate Migration Tool</h2>
      <p style={{ color: "#6b7280", marginBottom: 20 }}>Converts old string BillDate fields to Firestore Timestamps. Run once, then delete.</p>
      <button onClick={runMigration} disabled={running || done} style={{
        padding: "12px 24px", background: running ? "#9ca3af" : done ? "#10b981" : "#dc2626",
        color: "white", border: "none", borderRadius: 6, cursor: running || done ? "not-allowed" : "pointer",
        fontWeight: 600, fontSize: 16, marginBottom: 24
      }}>
        {running ? "⏳ Running..." : done ? "✅ Done" : "🚀 Run Migration"}
      </button>
      {log.length > 0 && (
        <div style={{ background: "#111827", color: "#d1fae5", padding: 20, borderRadius: 8, maxHeight: 500, overflowY: "auto", fontSize: 13, lineHeight: "1.8" }}>
          {log.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
      {done && <p style={{ marginTop: 20, color: "#10b981", fontWeight: 600 }}>✅ Complete! You can now delete <code>FixBillDates.jsx</code> and its route in app.jsx.</p>}
    </div>
  );
};

export default FixBillDates;
